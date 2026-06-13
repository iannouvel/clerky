#!/usr/bin/env node
/**
 * reconcile-proposed-values.js <guidelineId> [--commit]
 *
 * Curate a guideline's proposedNewValues into the global canonicalValues
 * registry via an LLM, so the same concept stops fragmenting across PPs/
 * guidelines. For each proposed value the model decides:
 *   - MAP    → it means an existing registry entry; optionally add the proposed
 *              phrasing to that entry's aliases (never changes its meaning).
 *   - NEW    → it (and any equivalent proposeds) form a genuinely new concept;
 *              mint one clean canonical entry with aliases for the variants.
 *   - DROP   → derived condition / trivially-true / noise.
 *
 * DRY-RUN by default: prints the reconciliation plan and writes nothing.
 * With --commit: adds aliases to existing canonical docs and creates new ones.
 *
 * Registry-integrity guardrails:
 *   - existing entries are only ever EXTENDED (aliases added) — never re-typed
 *     or re-labelled.
 *   - new entries get a clean snake_case id, label, type, aliases.
 */
require('dotenv').config();
const path = require('path');
const fs = require('fs');
const admin = require('firebase-admin');

const SA_PATH = path.join(__dirname, '..', 'server', 'config', 'serviceAccountKey.json');
const GUIDELINE_ID = process.argv[2];
const COMMIT = process.argv.includes('--commit');
const MODEL = process.env.REQUIRED_VALUES_GEMINI_MODEL || 'gemini-2.5-flash';

if (!GUIDELINE_ID) { console.error('Usage: node reconcile-proposed-values.js <guidelineId> [--commit]'); process.exit(2); }

function normaliseStr(s) { return (s || '').toLowerCase().trim().replace(/[_\-\s]+/g, ' '); }

async function callGemini(system, user) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${process.env.GOOGLE_AI_API_KEY}`;
    const generationConfig = { temperature: 0, maxOutputTokens: 8192, responseMimeType: 'application/json' };
    if (/gemini-2\.5/.test(MODEL)) generationConfig.thinkingConfig = { thinkingBudget: 0 };
    const resp = await fetch(url, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents: [{ role: 'user', parts: [{ text: user }] }], generationConfig }),
    });
    if (!resp.ok) throw new Error(`Gemini ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
    const j = await resp.json();
    return j?.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

function parseJSON(text) {
    const c = (text || '').trim().replace(/^```json\s*/i, '').replace(/```\s*$/, '');
    try { return JSON.parse(c); } catch (_) {}
    const s = c.indexOf('{'), e = c.lastIndexOf('}');
    if (s !== -1 && e > s) { try { return JSON.parse(c.slice(s, e + 1)); } catch (_) {} }
    return null;
}

const RECONCILE_SYSTEM = `You curate a registry of canonical clinical data values. Each registry entry is a single atomic clinical fact with an id, a label, a type, and alias phrasings.

You receive the current REGISTRY and a batch of PROPOSED values an extractor derived from clinical-guideline practice points. The extractor is verbose and inconsistent: it coins several different names for the same underlying fact, and sometimes proposes things the registry already holds under different wording.

Reconcile each proposed value with as little duplication as possible. For each, choose exactly one action:
- "map": it means the same atomic fact as an existing registry entry → give that entry's id. If the proposed wording is a useful phrasing the entry does not already list, also give it as an alias to add.
- "new": it is genuinely not in the registry. Assign it to a new canonical concept. Proposed values in this batch that mean the SAME fact must share one concept key, so equivalents collapse into a single entry. Give the concept a clean snake_case "conceptKey", a clear "label", a "type" (number | boolean | enum | string | date), and collect the variant phrasings as "aliases".
- "drop": not a useful atomic value — a derived condition/comparison, something trivially true in this clinical context, or noise.

Principles:
- Prefer reusing or extending an existing entry over creating a new one. Create new only when nothing existing captures the fact.
- One atomic fact per concept. Do not merge genuinely different facts because they are topically related.
- Never change the meaning of an existing entry; you may only contribute alias phrasings.

Return strict JSON only.`;

function buildPrompt(registry, batch) {
    const reg = Object.entries(registry).map(([id, v]) => `  - ${id} | ${v.label} | type:${v.type}${(v.aliases || []).length ? ' | aliases: ' + (v.aliases || []).slice(0, 4).join(', ') : ''}`).join('\n');
    const prop = batch.map((p, i) => `  [${i}] ${p.label} (type:${p.type || 'unknown'})`).join('\n');
    return `REGISTRY:\n${reg}\n\nPROPOSED (batch):\n${prop}\n\nReturn JSON only:\n{\n  "decisions": [\n    { "i": 0, "action": "map", "canonicalId": "...", "alias": "optional phrasing to add" },\n    { "i": 1, "action": "new", "conceptKey": "snake_case_key", "label": "Clear label", "type": "enum", "aliases": ["variant a","variant b"] },\n    { "i": 2, "action": "drop", "reason": "derived condition" }\n  ]\n}`;
}

(async () => {
    if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(require(SA_PATH)) });
    const db = admin.firestore();

    // Load registry
    const snap = await db.collection('canonicalValues').get();
    const registry = {};
    snap.forEach(d => { registry[d.id] = d.data(); });
    console.log(`Registry: ${Object.keys(registry).length} canonical values`);

    // Load the guideline's proposed-new
    const gdoc = await db.collection('guidelines').doc(GUIDELINE_ID).get();
    if (!gdoc.exists) { console.error('Guideline not found'); process.exit(1); }
    const proposed = (gdoc.data().requiredValues?.proposedNewValues || []).map(p => ({ proposedId: p.proposedId, label: p.label || p.proposedId, type: p.type, options: Array.isArray(p.options) && p.options.length ? p.options : null, subjective: p.subjective === true, ppCount: (p.usedByPPs || []).length }));
    console.log(`Proposed-new on ${GUIDELINE_ID}: ${proposed.length}`);
    if (!proposed.length) { console.log('Nothing to reconcile.'); process.exit(0); }

    // Sort by label so near-duplicate phrasings land in the same batch → better clustering
    proposed.sort((a, b) => normaliseStr(a.label).localeCompare(normaliseStr(b.label)));

    const BATCH = 40;
    const aliasAdds = new Map(); // existing-canonicalId → Set(alias)
    const enrichExisting = new Map(); // existing-canonicalId → { options?, neverInfer? } additive enrichment
    const newConcepts = new Map(); // conceptKey → { conceptKey, label, type, options, subjective, aliases:Set, fromProposed:[] }
    let mapped = 0, dropped = 0;

    // Additively enrich an existing canonical entry with an under-specified field:
    // options it lacks, and the neverInfer flag for a subjective grading. Never
    // re-types or re-labels — only fills in fields that are absent.
    const enrich = (id, p) => {
        if (!originalIds.has(id)) return;
        const cur = registry[id] || {};
        const e = enrichExisting.get(id) || {};
        if (p.options && !(Array.isArray(cur.options) && cur.options.length) && !e.options) e.options = p.options;
        if (p.subjective && cur.neverInfer !== true) e.neverInfer = true;
        if (Object.keys(e).length) enrichExisting.set(id, e);
    };

    // Live, GROWING registry: starts as the 56 canonical values, but each new
    // concept minted by a batch is added immediately so later batches can map
    // their fragments to it instead of re-minting. This is what makes "check the
    // global before creating a new one" actually work across the whole set.
    const originalIds = new Set(Object.keys(registry));
    const liveRegistry = {};
    for (const [id, v] of Object.entries(registry)) liveRegistry[id] = { label: v.label, type: v.type, aliases: [...(v.aliases || [])] };

    const addAliasTo = (id, ...phrasings) => {
        const reg = liveRegistry[id]; if (!reg) return;
        for (const ph of phrasings) { if (ph && !reg.aliases.includes(ph)) reg.aliases.push(ph); }
        if (originalIds.has(id)) {
            if (!aliasAdds.has(id)) aliasAdds.set(id, new Set());
            for (const ph of phrasings) if (ph) aliasAdds.get(id).add(ph);
        } else {
            const c = newConcepts.get(id);
            if (c) for (const ph of phrasings) if (ph) c.aliases.add(ph);
        }
    };

    for (let start = 0; start < proposed.length; start += BATCH) {
        const batch = proposed.slice(start, start + BATCH);
        let parsed = null;
        try { parsed = parseJSON(await callGemini(RECONCILE_SYSTEM, buildPrompt(liveRegistry, batch))); } catch (e) { console.warn(`batch ${start}: ${e.message}`); }
        for (const d of (parsed?.decisions || [])) {
            const p = batch[d.i];
            if (!p) continue;
            // Carry a proposed value's definition hints (options for an enum, the
            // subjective flag) onto whichever concept it lands on.
            const carryToNew = (key) => {
                const c = newConcepts.get(key); if (!c) return;
                if (!c.options && p.options) c.options = p.options;
                if (p.subjective) c.subjective = true;
            };
            if (d.action === 'map' && d.canonicalId && liveRegistry[d.canonicalId]) {
                // map to an existing OR already-minted concept; record the phrasing as an alias
                if (!originalIds.has(d.canonicalId)) { newConcepts.get(d.canonicalId)?.fromProposed.push(p.proposedId); carryToNew(d.canonicalId); }
                else { mapped++; enrich(d.canonicalId, p); }
                addAliasTo(d.canonicalId, d.alias, p.label);
            } else if (d.action === 'drop') {
                dropped++;
            } else if (d.action === 'new' && d.conceptKey) {
                const key = d.conceptKey;
                if (liveRegistry[key] && originalIds.has(key)) { // collides with a curated id → treat as map
                    mapped++; enrich(key, p); addAliasTo(key, ...(d.aliases || []), p.label);
                } else {
                    if (!newConcepts.has(key)) {
                        newConcepts.set(key, { conceptKey: key, label: d.label || p.label, type: d.type || p.type || 'string', options: null, subjective: false, aliases: new Set(), fromProposed: [] });
                        liveRegistry[key] = { label: d.label || p.label, type: d.type || p.type || 'string', aliases: [] }; // grow registry NOW
                    }
                    newConcepts.get(key).fromProposed.push(p.proposedId);
                    carryToNew(key);
                    addAliasTo(key, ...(d.aliases || []), p.label);
                }
            } else {
                if (!newConcepts.has(p.proposedId)) { newConcepts.set(p.proposedId, { conceptKey: p.proposedId, label: p.label, type: p.type || 'string', options: p.options || null, subjective: p.subjective === true, aliases: new Set([p.label]), fromProposed: [p.proposedId] }); liveRegistry[p.proposedId] = { label: p.label, type: p.type || 'string', aliases: [p.label] }; }
            }
        }
        process.stdout.write(`  reconciled ${Math.min(start + BATCH, proposed.length)}/${proposed.length}  (registry now ${Object.keys(liveRegistry).length})   \r`);
    }
    console.log('');

    // PROMOTION GATE: only corroborated concepts (collapsed ≥2 distinct proposed
    // fragments) become new globals — clearly-real, already-deduped. Singletons
    // stay guideline-local (the gather's frequency gate decides those).
    const PROMOTE_MIN_FRAGMENTS = 2;
    const promote = [...newConcepts.values()].filter(c => c.fromProposed.length >= PROMOTE_MIN_FRAGMENTS).sort((a, b) => b.fromProposed.length - a.fromProposed.length);
    const local = newConcepts.size - promote.length;

    console.log(`\n=== Reconciliation plan ===`);
    console.log(`Proposed in: ${proposed.length}`);
    console.log(`  → mapped onto existing globals:  ${mapped}  (aliases added to ${aliasAdds.size} entries)`);
    console.log(`  → NEW globals to promote (≥${PROMOTE_MIN_FRAGMENTS} fragments): ${promote.length}`);
    console.log(`  → left guideline-local (singletons): ${local}`);
    console.log(`  → dropped:  ${dropped}`);
    console.log(`Registry would grow ${Object.keys(registry).length} → ${Object.keys(registry).length + promote.length}  (clean, deduped)`);

    console.log(`\nPromoted globals (top 20 by fragments collapsed):`);
    promote.slice(0, 20).forEach(c => console.log(`  ${c.fromProposed.length}× → ${c.conceptKey} [${c.type}] "${c.label}"  aliases: ${[...c.aliases].slice(0, 4).join(' | ')}`));
    const scr = promote.filter(c => /screen|ogtt|gtt|glucose tolerance|hba1c|gdm|test/i.test(c.conceptKey + ' ' + c.label + ' ' + [...c.aliases].join(' ')));
    console.log(`\nScreening/diagnosis globals that would be promoted: ${scr.map(c => c.conceptKey).join(', ') || '(none)'}`);

    // Save plan for review
    const out = {
        guidelineId: GUIDELINE_ID, proposedIn: proposed.length, mapped, dropped,
        promotedCount: promote.length, leftLocal: local,
        aliasAdds: [...aliasAdds.entries()].map(([id, s]) => ({ canonicalId: id, add: [...s] })),
        promotedConcepts: promote.map(c => ({ ...c, aliases: [...c.aliases] })),
    };
    const outFile = path.join(__dirname, '..', 'tests', `.reconcile-${GUIDELINE_ID}.json`);
    fs.writeFileSync(outFile, JSON.stringify(out, null, 2));
    console.log(`\nPlan saved: ${outFile}`);

    if (!COMMIT) { console.log('\nDRY-RUN — nothing written. Re-run with --commit to apply.'); process.exit(0); }

    // Apply: add aliases to existing, additively enrich existing, create new canonical docs
    let writes = 0;
    const allExistingIds = new Set([...aliasAdds.keys(), ...enrichExisting.keys()]);
    for (const id of allExistingIds) {
        const existing = registry[id]; if (!existing) continue;
        const patch = {};
        const s = aliasAdds.get(id);
        if (s) patch.aliases = Array.from(new Set([...(existing.aliases || []), ...s])).filter(Boolean);
        const e = enrichExisting.get(id);
        if (e?.options) patch.options = e.options;
        if (e?.neverInfer) patch.neverInfer = true;
        if (Object.keys(patch).length) { await db.collection('canonicalValues').doc(id).set(patch, { merge: true }); writes++; }
    }
    for (const c of promote) {
        const id = c.conceptKey;
        await db.collection('canonicalValues').doc(id).set({
            label: c.label, type: c.type, aliases: [...c.aliases].filter(Boolean),
            ...(c.options ? { options: c.options } : {}),
            ...(c.subjective ? { neverInfer: true } : {}),
            description: '', extractionHint: '', prompt: c.label.endsWith('?') ? c.label : `${c.label}?`,
            _origin: 'reconciled', _fromGuideline: GUIDELINE_ID,
        }, { merge: true }); writes++;
    }
    const enrichCount = [...enrichExisting.values()].length;
    console.log(`\nCOMMITTED ${writes} registry writes (${aliasAdds.size} alias-extensions + ${enrichCount} enrichments + ${promote.length} new globals).`);
    process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
