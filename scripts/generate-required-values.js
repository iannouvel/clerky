#!/usr/bin/env node
/**
 * generate-required-values.js <guidelineId>
 *
 * For a given guideline, derives the list of required clinical values that
 * its practice points depend on. Maps to canonical-catalogue IDs where
 * possible; emits proposed new IDs otherwise.
 *
 * Pipeline:
 *   1. Load guideline + PPs from Firestore.
 *   2. Load canonical values catalogue from canonicalValues collection
 *      (falls back to server/data/canonical_values.bootstrap.json if empty).
 *   3. For each PP: one LLM call returning the data points it depends on,
 *      with extraction hints.
 *   4. Map each returned data point to a canonical id via:
 *        - exact id match
 *        - alias match
 *        - LLM-assisted fuzzy match
 *        - propose new id if no match
 *   5. Save the per-guideline JSON to guideline.requiredValues.
 *
 * Output JSON shape (saved to Firestore):
 * {
 *   schemaVersion: '1.0',
 *   generatedAt: <ISO>,
 *   ppCount: 34,
 *   values: [
 *     { id: 'gestational_age_weeks', usedByPPs: [4, 8, 9, ...], isRequired: true },
 *     { id: 'bmi', usedByPPs: [10, 18], isRequired: false },
 *     ...
 *   ],
 *   proposedNewValues: [
 *     { proposedId: '...', label: '...', usedByPPs: [...], ... },
 *     ...
 *   ]
 * }
 */
require('dotenv').config();
const path = require('path');
const fs = require('fs');
const admin = require('firebase-admin');

const SA_PATH = path.join(__dirname, '..', 'server', 'config', 'serviceAccountKey.json');
const BOOTSTRAP_PATH = path.join(__dirname, '..', 'server', 'data', 'canonical_values.bootstrap.json');
const SCHEMA_VERSION = '1.0';
const GUIDELINE_ID = process.argv[2];

if (!GUIDELINE_ID) {
    console.error('Usage: node generate-required-values.js <guidelineId>');
    process.exit(2);
}

// ----- Helpers ------------------------------------------------------------

function normaliseStr(s) {
    return (s || '').toLowerCase().trim().replace(/[_\-\s]+/g, ' ');
}

async function loadCanonicalCatalogue(db) {
    // Try Firestore first; fall back to repo bootstrap
    const snap = await db.collection('canonicalValues').get();
    if (!snap.empty) {
        const values = {};
        snap.forEach(d => { values[d.id] = d.data(); });
        return { source: 'firestore', values };
    }
    if (fs.existsSync(BOOTSTRAP_PATH)) {
        const j = JSON.parse(fs.readFileSync(BOOTSTRAP_PATH, 'utf8'));
        return { source: 'bootstrap', values: j.values || {} };
    }
    return { source: 'empty', values: {} };
}

// Match an extracted data point name to a canonical id
function matchToCanonical(extractedName, catalogue) {
    const target = normaliseStr(extractedName);
    if (!target) return null;
    for (const [id, v] of Object.entries(catalogue)) {
        if (normaliseStr(id) === target) return id;
        if (normaliseStr(v.label) === target) return id;
        for (const a of (v.aliases || [])) {
            if (normaliseStr(a) === target) return id;
        }
    }
    // Substring fallback (e.g. extracted "gestational age" → "gestational_age_weeks")
    for (const [id, v] of Object.entries(catalogue)) {
        const haystack = [id, v.label, ...(v.aliases || [])].map(normaliseStr).join(' | ');
        if (haystack.includes(target) || target.split(' ').every(w => haystack.includes(w))) return id;
    }
    return null;
}

// ----- Per-PP LLM call ----------------------------------------------------

async function callGemini(systemPrompt, userPrompt) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GOOGLE_AI_API_KEY}`;
    const resp = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            systemInstruction: { parts: [{ text: systemPrompt }] },
            contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
            generationConfig: {
                temperature: 0,
                maxOutputTokens: 4000,
                responseMimeType: 'application/json',
                thinkingConfig: { thinkingBudget: 0 },
            },
        }),
    });
    if (!resp.ok) throw new Error(`Gemini ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
    const j = await resp.json();
    return j?.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

const PER_PP_SYSTEM = `You analyse a single clinical practice point and identify the clinical data values it depends on.

A data value is a specific, atomic piece of clinical information that must be known (from the note, the patient, or asked) before the practice point can be reliably applied. Examples: gestational_age, bmi, smoking_status, ctg_result, presence_of_rfm.

Rules:
- Each value is ATOMIC — one fact. "BMI" is one value; "BMI > 30" is not a value (it's a condition derived from BMI).
- A value should be needed for either (a) determining applicability (the condition) or (b) assessing compliance (the action).
- Use snake_case ids.
- Output a JSON array; no prose.`;

function buildPerPPPrompt(pp, serial) {
    return `PRACTICE POINT #${serial}:
NAME: ${pp.name}

CONDITION: ${pp.condition || '(none)'}

ACTION: ${pp.action || '(none)'}

DESCRIPTION:
${pp.description || '(none)'}

What atomic clinical data values does THIS practice point depend on? Return JSON only:
{
  "values": [
    {
      "name": "snake_case id (e.g. gestational_age_weeks)",
      "label": "human-readable label",
      "type": "number | boolean | enum | string | date",
      "purpose": "applicability | compliance | both",
      "rationale": "1 sentence on why this PP needs this value"
    }
  ]
}`;
}

async function extractValuesForPP(pp, serial) {
    const text = await callGemini(PER_PP_SYSTEM, buildPerPPPrompt(pp, serial));
    try {
        const cleaned = text.trim().replace(/^```json\s*/i, '').replace(/```\s*$/, '');
        const j = JSON.parse(cleaned);
        return Array.isArray(j.values) ? j.values : [];
    } catch (e) {
        console.warn(`  PP#${serial}: parse failed (${e.message})`);
        return [];
    }
}

// ----- LLM-assisted mapping of proposed-new to canonical ------------------

const MAP_SYSTEM = `You map clinical-data concepts to a canonical catalogue.

You receive: (a) a CATALOGUE of existing canonical clinical-data values, each with an id, label, and short description; and (b) a list of PROPOSED concepts an LLM extracted from a guideline's practice points.

For each proposed concept, decide whether it is semantically equivalent to an existing catalogue entry, or genuinely new.

Equivalence rules:
- Different wording for the same fact = equivalent. "presence_of_rfm" ≡ "rfm_present"; "sfh_measured" ≡ "symphysis_fundal_height_measured"; "fetal_heartbeat_confirmed_doppler" ≡ "fetal_heart_auscultated".
- Sub-elements of a multi-valued catalogue entry = equivalent. e.g. "ultrasound_includes_biometry" maps to "uss_biometry_documented" (the catalogue value already captures the biometry component).
- "Is pregnant" — virtually always true in O&G context; map to existing "encounter_type" or similar if present, otherwise flag as too-broad-to-be-useful (consider mapping to closest).
- Conditions/comparisons (e.g. "BMI > 30", "age over 35") are NOT new values — they are derived from existing values ("bmi", "maternal_age_years").

If a proposed concept is genuinely new (no equivalent and not a derived condition), confirm it as new. Output JSON only.`;

function buildMapPrompt(catalogue, proposedList) {
    const catalogueStr = Object.entries(catalogue).map(([id, v]) => {
        const aliases = (v.aliases || []).slice(0, 3).join(', ');
        return `  - ${id}  |  ${v.label}  |  ${(v.description || '').slice(0, 100)}${aliases ? `  |  aliases: ${aliases}` : ''}`;
    }).join('\n');

    const proposedStr = proposedList.map((p, i) => {
        return `  [${i}] proposed_id=${p.proposedId}  type=${p.type}  label="${p.label}"`;
    }).join('\n');

    return `CATALOGUE (existing canonical values):
${catalogueStr}

PROPOSED concepts to map:
${proposedStr}

For each proposed concept, return either a mapping to an existing canonical id, or confirm genuinely new. Return JSON only:
{
  "mappings": [
    { "index": 0, "decision": "map_to_canonical", "canonicalId": "rfm_present", "reason": "synonym" },
    { "index": 1, "decision": "confirm_new", "reason": "genuinely new — not in catalogue and not a derived condition" },
    { "index": 2, "decision": "drop", "reason": "trivially true in O&G context, no audit value" }
  ]
}

Valid decisions: "map_to_canonical" (provide canonicalId), "confirm_new" (keep as new), "drop" (not useful as an atomic value).`;
}

async function mapProposedToCanonical(catalogue, proposedList) {
    if (proposedList.length === 0) return { mappings: [] };
    const BATCH = 25;
    const allMappings = [];
    for (let start = 0; start < proposedList.length; start += BATCH) {
        const batch = proposedList.slice(start, start + BATCH);
        const text = await callGemini(MAP_SYSTEM, buildMapPrompt(catalogue, batch));
        try {
            const cleaned = text.trim().replace(/^```json\s*/i, '').replace(/```\s*$/, '');
            const j = JSON.parse(cleaned);
            for (const m of (j.mappings || [])) {
                // Re-base index to the global proposedList
                if (typeof m.index === 'number') allMappings.push({ ...m, index: m.index + start });
            }
        } catch (e) {
            console.warn(`Mapping batch [${start}..${start + batch.length - 1}]: parse failed (${e.message})`);
        }
    }
    return { mappings: allMappings };
}

// ----- Aggregation --------------------------------------------------------

function aggregate(perPPResults, catalogue) {
    const usedByMap = new Map(); // canonicalId → Set of PP serials
    const proposedNew = new Map(); // proposedId → { label, type, usedByPPs, rationales }

    for (const { serial, values } of perPPResults) {
        for (const v of values) {
            const matchId = matchToCanonical(v.name, catalogue) || matchToCanonical(v.label, catalogue);
            if (matchId) {
                if (!usedByMap.has(matchId)) usedByMap.set(matchId, new Set());
                usedByMap.get(matchId).add(serial);
            } else {
                const proposedId = (v.name || '').toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_|_$/g, '');
                if (!proposedNew.has(proposedId)) {
                    proposedNew.set(proposedId, {
                        proposedId,
                        label: v.label || v.name,
                        type: v.type || 'unknown',
                        usedByPPs: new Set(),
                        rationales: [],
                    });
                }
                const e = proposedNew.get(proposedId);
                e.usedByPPs.add(serial);
                if (v.rationale) e.rationales.push(`PP#${serial}: ${v.rationale}`);
            }
        }
    }

    const values = [...usedByMap.entries()]
        .map(([id, ppSet]) => ({ id, usedByPPs: [...ppSet].sort((a, b) => a - b) }))
        .sort((a, b) => b.usedByPPs.length - a.usedByPPs.length);

    const proposedNewValues = [...proposedNew.values()]
        .map(p => ({ ...p, usedByPPs: [...p.usedByPPs].sort((a, b) => a - b) }))
        .sort((a, b) => b.usedByPPs.length - a.usedByPPs.length);

    return { values, proposedNewValues };
}

// ----- Concurrency helper -------------------------------------------------

async function runConcurrent(items, fn, concurrency) {
    const out = new Array(items.length);
    let idx = 0;
    async function worker() {
        while (true) {
            const i = idx++;
            if (i >= items.length) break;
            try { out[i] = await fn(items[i], i); }
            catch (e) { out[i] = { _error: e.message }; console.warn(`item ${i} failed: ${e.message.slice(0, 80)}`); }
        }
    }
    await Promise.all(Array.from({ length: concurrency }, worker));
    return out;
}

// ----- Main ---------------------------------------------------------------

(async () => {
    if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(require(SA_PATH)) });
    const db = admin.firestore();

    const doc = await db.collection('guidelines').doc(GUIDELINE_ID).get();
    if (!doc.exists) { console.error(`Guideline ${GUIDELINE_ID} not found`); process.exit(1); }
    const g = doc.data();
    const pps = g.practicePoints || [];
    console.log(`Guideline: ${g.title}`);
    console.log(`Practice points: ${pps.length}`);

    const { source, values: catalogue } = await loadCanonicalCatalogue(db);
    console.log(`Catalogue source: ${source}; ${Object.keys(catalogue).length} canonical values`);

    console.log(`\nExtracting required values per PP...`);
    const t0 = Date.now();
    const perPPResults = await runConcurrent(
        pps.map((pp, i) => ({ serial: i + 1, pp })),
        async ({ serial, pp }) => {
            const vals = await extractValuesForPP(pp, serial);
            return { serial, values: vals };
        },
        4
    );
    console.log(`Per-PP extraction took ${Math.round((Date.now() - t0) / 1000)}s`);

    const initial = aggregate(perPPResults, catalogue);
    console.log(`\nInitial: ${initial.values.length} matched, ${initial.proposedNewValues.length} proposed-new (pre-LLM-map)`);

    // LLM-assisted mapping pass — collapse proposed-new entries that are actually
    // equivalents of existing canonical ids (the string matcher misses synonyms,
    // reorderings, and sub-element wording).
    console.log(`\nRunning LLM mapping pass on ${initial.proposedNewValues.length} proposed-new values...`);
    const mapResult = await mapProposedToCanonical(catalogue, initial.proposedNewValues);
    const mappingsByIndex = new Map((mapResult.mappings || []).map(m => [m.index, m]));

    let mappedToCanonical = 0;
    let confirmedNew = 0;
    let dropped = 0;
    const stillNew = [];
    const usedByMap = new Map(); // canonicalId → Set of PP serials (rebuilt after mapping)
    for (const v of initial.values) {
        usedByMap.set(v.id, new Set(v.usedByPPs));
    }
    for (let i = 0; i < initial.proposedNewValues.length; i++) {
        const proposed = initial.proposedNewValues[i];
        const m = mappingsByIndex.get(i);
        if (m?.decision === 'map_to_canonical' && m.canonicalId && catalogue[m.canonicalId]) {
            if (!usedByMap.has(m.canonicalId)) usedByMap.set(m.canonicalId, new Set());
            for (const pp of proposed.usedByPPs) usedByMap.get(m.canonicalId).add(pp);
            mappedToCanonical++;
        } else if (m?.decision === 'drop') {
            dropped++;
        } else {
            // confirm_new (or no decision — treat as new)
            stillNew.push({ ...proposed, llmRationale: m?.reason || '' });
            confirmedNew++;
        }
    }

    const values = [...usedByMap.entries()]
        .map(([id, ppSet]) => ({ id, usedByPPs: [...ppSet].sort((a, b) => a - b) }))
        .sort((a, b) => b.usedByPPs.length - a.usedByPPs.length);
    const proposedNewValues = stillNew;

    console.log(`Mapping pass: ${mappedToCanonical} mapped to canonical, ${confirmedNew} confirmed new, ${dropped} dropped.`);

    console.log(`\n=== Aggregated required values (${values.length}) ===`);
    for (const v of values) {
        console.log(`  ${v.id.padEnd(45)} used by PPs ${v.usedByPPs.join(', ')}`);
    }

    if (proposedNewValues.length > 0) {
        console.log(`\n=== Proposed new canonical values (${proposedNewValues.length}) — for review ===`);
        for (const p of proposedNewValues) {
            console.log(`  proposed_id: ${p.proposedId.padEnd(45)} type=${p.type}  used by PPs ${p.usedByPPs.join(', ')}`);
            console.log(`    label: ${p.label}`);
            if (p.llmRationale) console.log(`    llm note: ${p.llmRationale.slice(0, 150)}`);
        }
    }

    const payload = {
        schemaVersion: SCHEMA_VERSION,
        generatedAt: new Date().toISOString(),
        ppCount: pps.length,
        catalogueSource: source,
        values,
        proposedNewValues,
    };

    // Save to a file first for review; Firestore write requires --commit flag
    const outFile = path.join(__dirname, '..', 'tests', `.required-values-${GUIDELINE_ID}.json`);
    fs.writeFileSync(outFile, JSON.stringify(payload, null, 2));
    console.log(`\nSaved preview to ${outFile}`);
    console.log(`\nTo persist to Firestore guideline.requiredValues, re-run with --commit`);

    if (process.argv.includes('--commit')) {
        await db.collection('guidelines').doc(GUIDELINE_ID).update({
            requiredValues: payload,
        });
        console.log(`Wrote requiredValues to guideline ${GUIDELINE_ID}`);
    }
})().catch(e => { console.error(e); process.exit(1); });
