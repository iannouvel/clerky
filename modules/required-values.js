/**
 * Required-values generator (server-side).
 *
 * For a given guideline, derives the union of clinical values its PPs depend on,
 * mapped to canonical-catalogue ids. Two passes:
 *   1. Per-PP extraction (Gemini 2.5 Flash, temp 0, JSON output).
 *   2. LLM-assisted mapping of proposed concepts to canonical ids (batched).
 *
 * Caches to guideline.requiredValues on first generation; subsequent calls
 * read from the cache.
 *
 * Also exposes extractValuesFromNote(): given a clinical note and the union
 * of required values, returns which are documented in the note (with confidence).
 */
const GEMINI_URL_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const GEMINI_MODEL = process.env.REQUIRED_VALUES_GEMINI_MODEL || 'gemini-2.5-flash';
const SCHEMA_VERSION = '1.0';

// ----- Gemini call wrapper (json-mode, temp 0, thinkingBudget 0) ----------

async function callGemini(systemPrompt, userPrompt) {
    const apiKey = process.env.GOOGLE_AI_API_KEY;
    if (!apiKey) throw new Error('GOOGLE_AI_API_KEY not set');
    const url = `${GEMINI_URL_BASE}/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
    const generationConfig = {
        temperature: 0,
        maxOutputTokens: 4000,
        responseMimeType: 'application/json',
    };
    if (/gemini-2\.5/.test(GEMINI_MODEL)) {
        generationConfig.thinkingConfig = { thinkingBudget: 0 };
    }
    const resp = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            systemInstruction: { parts: [{ text: systemPrompt }] },
            contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
            generationConfig,
        }),
    });
    if (!resp.ok) {
        const txt = await resp.text();
        throw new Error(`Gemini ${resp.status}: ${txt.slice(0, 200)}`);
    }
    const json = await resp.json();
    return json?.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

function parseJSON(text) {
    const cleaned = (text || '').trim().replace(/^```json\s*/i, '').replace(/```\s*$/, '');
    try { return JSON.parse(cleaned); } catch (_) {}
    const s = cleaned.indexOf('{'), e = cleaned.lastIndexOf('}');
    if (s !== -1 && e > s) {
        try { return JSON.parse(cleaned.slice(s, e + 1)); } catch (_) {}
    }
    return null;
}

// ----- Per-PP extraction --------------------------------------------------

const PER_PP_SYSTEM = `You analyse a single clinical practice point and identify the clinical data values it depends on.

A data value is a specific, atomic piece of clinical information that must be known (from the note, the patient, or asked) before the practice point can be reliably applied.

Rules:
- Each value is ATOMIC — one fact. "BMI" is one value; "BMI > 30" is not a value (it's a condition derived from BMI).
- A value should be needed for either (a) determining applicability (the condition) or (b) assessing compliance (the action).
- Use snake_case ids.
- Output JSON only.`;

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
      "name": "snake_case id",
      "label": "human-readable label",
      "type": "number | boolean | enum | string | date",
      "purpose": "applicability | compliance | both"
    }
  ]
}`;
}

async function extractValuesForPP(pp, serial) {
    try {
        const text = await callGemini(PER_PP_SYSTEM, buildPerPPPrompt(pp, serial));
        const parsed = parseJSON(text);
        return Array.isArray(parsed?.values) ? parsed.values : [];
    } catch (e) {
        return [];
    }
}

// ----- Mapping to canonical -----------------------------------------------

function normaliseStr(s) {
    return (s || '').toLowerCase().trim().replace(/[_\-\s]+/g, ' ');
}

function matchToCanonical(extractedName, catalogue) {
    const target = normaliseStr(extractedName);
    if (!target) return null;
    for (const [id, v] of Object.entries(catalogue)) {
        if (normaliseStr(id) === target) return id;
        if (normaliseStr(v.label) === target) return id;
        for (const a of (v.aliases || [])) if (normaliseStr(a) === target) return id;
    }
    for (const [id, v] of Object.entries(catalogue)) {
        const haystack = [id, v.label, ...(v.aliases || [])].map(normaliseStr).join(' | ');
        if (haystack.includes(target) || target.split(' ').every(w => haystack.includes(w))) return id;
    }
    return null;
}

const MAP_SYSTEM = `You map clinical-data concepts to a canonical catalogue.

For each PROPOSED concept, decide whether it is semantically equivalent to an existing CATALOGUE entry, or genuinely new.

Equivalence rules:
- Different wording for the same fact = equivalent.
- Sub-elements of a multi-valued catalogue entry = equivalent.
- Conditions/comparisons ("BMI > 30") are NOT new values — they are derived from existing values ("bmi").
- "Is pregnant" — trivial in O&G; drop.

Output JSON only.`;

function buildMapPrompt(catalogue, proposedList) {
    const catalogueStr = Object.entries(catalogue).map(([id, v]) => {
        const aliases = (v.aliases || []).slice(0, 3).join(', ');
        return `  - ${id} | ${v.label} | ${(v.description || '').slice(0, 100)}${aliases ? ` | aliases: ${aliases}` : ''}`;
    }).join('\n');

    const proposedStr = proposedList.map((p, i) => `  [${i}] id=${p.proposedId} type=${p.type} label="${p.label}"`).join('\n');

    return `CATALOGUE:
${catalogueStr}

PROPOSED:
${proposedStr}

Return JSON only:
{
  "mappings": [
    { "index": 0, "decision": "map_to_canonical", "canonicalId": "...", "reason": "..." },
    { "index": 1, "decision": "confirm_new", "reason": "..." },
    { "index": 2, "decision": "drop", "reason": "..." }
  ]
}`;
}

async function mapProposedToCanonical(catalogue, proposedList) {
    if (proposedList.length === 0) return [];
    const BATCH = 25;
    const all = [];
    for (let start = 0; start < proposedList.length; start += BATCH) {
        const batch = proposedList.slice(start, start + BATCH);
        try {
            const text = await callGemini(MAP_SYSTEM, buildMapPrompt(catalogue, batch));
            const parsed = parseJSON(text);
            for (const m of (parsed?.mappings || [])) {
                if (typeof m.index === 'number') all.push({ ...m, index: m.index + start });
            }
        } catch (e) { /* swallow; treat as confirm_new by default */ }
    }
    return all;
}

// ----- Aggregation --------------------------------------------------------

function aggregate(perPPResults, catalogue) {
    const usedByMap = new Map(); // canonicalId → Set of PP serials
    const proposed = new Map();

    for (const { serial, values } of perPPResults) {
        for (const v of values) {
            const matchId = matchToCanonical(v.name, catalogue) || matchToCanonical(v.label, catalogue);
            if (matchId) {
                if (!usedByMap.has(matchId)) usedByMap.set(matchId, new Set());
                usedByMap.get(matchId).add(serial);
            } else {
                const id = (v.name || '').toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_|_$/g, '');
                if (!proposed.has(id)) {
                    proposed.set(id, { proposedId: id, label: v.label || v.name, type: v.type || 'unknown', usedByPPs: new Set() });
                }
                proposed.get(id).usedByPPs.add(serial);
            }
        }
    }

    return {
        usedByMap,
        proposedList: [...proposed.values()].map(p => ({ ...p, usedByPPs: [...p.usedByPPs].sort((a, b) => a - b) })),
    };
}

async function runConcurrent(items, fn, concurrency) {
    const out = new Array(items.length);
    let i = 0;
    async function worker() {
        while (true) {
            const k = i++;
            if (k >= items.length) break;
            try { out[k] = await fn(items[k], k); } catch (_) { out[k] = null; }
        }
    }
    await Promise.all(Array.from({ length: concurrency }, worker));
    return out;
}

async function loadCatalogue(db) {
    const snap = await db.collection('canonicalValues').get();
    const values = {};
    snap.forEach(d => { values[d.id] = d.data(); });
    return values;
}

/**
 * Get the requiredValues for a guideline. If cached on the guideline doc,
 * return immediately. Otherwise generate and save.
 *
 * @param {Object} db - Firestore instance
 * @param {string} guidelineId
 * @param {Object} [opts]
 * @param {boolean} [opts.forceRegenerate=false] - skip cache and rebuild
 * @returns {Promise<Object>} { schemaVersion, generatedAt, ppCount, values: [{id,usedByPPs}], proposedNewValues: [...] }
 */
async function getOrGenerateRequiredValues(db, guidelineId, opts = {}) {
    const docRef = db.collection('guidelines').doc(guidelineId);
    const doc = await docRef.get();
    if (!doc.exists) throw new Error(`Guideline not found: ${guidelineId}`);
    const g = doc.data();

    if (!opts.forceRegenerate && g.requiredValues && g.requiredValues.schemaVersion === SCHEMA_VERSION) {
        return { ...g.requiredValues, _source: 'cache' };
    }

    const pps = g.practicePoints || [];
    if (pps.length === 0) {
        const empty = { schemaVersion: SCHEMA_VERSION, generatedAt: new Date().toISOString(), ppCount: 0, values: [], proposedNewValues: [] };
        await docRef.update({ requiredValues: empty });
        return { ...empty, _source: 'generated_empty' };
    }

    const catalogue = await loadCatalogue(db);

    const perPPResults = await runConcurrent(
        pps.map((pp, i) => ({ serial: i + 1, pp })),
        async ({ serial, pp }) => ({ serial, values: await extractValuesForPP(pp, serial) }),
        4
    );

    const { usedByMap, proposedList } = aggregate(perPPResults.filter(r => r), catalogue);

    const mappings = await mapProposedToCanonical(catalogue, proposedList);
    const mIdx = new Map(mappings.map(m => [m.index, m]));

    const stillNew = [];
    for (let i = 0; i < proposedList.length; i++) {
        const proposed = proposedList[i];
        const m = mIdx.get(i);
        if (m?.decision === 'map_to_canonical' && m.canonicalId && catalogue[m.canonicalId]) {
            if (!usedByMap.has(m.canonicalId)) usedByMap.set(m.canonicalId, new Set());
            for (const pp of proposed.usedByPPs) usedByMap.get(m.canonicalId).add(pp);
        } else if (m?.decision === 'drop') {
            // skip
        } else {
            stillNew.push({ ...proposed, llmRationale: m?.reason || '' });
        }
    }

    const values = [...usedByMap.entries()]
        .map(([id, ppSet]) => ({ id, usedByPPs: [...ppSet].sort((a, b) => a - b) }))
        .sort((a, b) => b.usedByPPs.length - a.usedByPPs.length);

    const payload = {
        schemaVersion: SCHEMA_VERSION,
        generatedAt: new Date().toISOString(),
        ppCount: pps.length,
        values,
        proposedNewValues: stillNew,
    };

    await docRef.update({ requiredValues: payload });
    return { ...payload, _source: 'generated' };
}

/**
 * Compute the union of requiredValues across multiple guidelines, joined
 * with the canonical catalogue for label, type, extractionHint, prompt etc.
 *
 * @param {Object} db
 * @param {string[]} guidelineIds
 * @returns {Promise<Object>} { values: [{id, label, type, ..., usingGuidelines:[{id, pps}]}], catalogueSize }
 */
async function aggregateAcrossGuidelines(db, guidelineIds) {
    const catalogue = await loadCatalogue(db);
    const seen = new Map(); // canonicalId → { value, using: [{guidelineId, pps}] }

    for (const gId of guidelineIds) {
        const rv = await getOrGenerateRequiredValues(db, gId);
        for (const v of (rv.values || [])) {
            if (!seen.has(v.id)) seen.set(v.id, { value: catalogue[v.id], using: [] });
            seen.get(v.id).using.push({ guidelineId: gId, pps: v.usedByPPs });
        }
    }

    const values = [...seen.entries()]
        .map(([id, { value, using }]) => ({ id, ...(value || {}), usingGuidelines: using }))
        .filter(v => v.label) // skip canonical ids we couldn't resolve
        .sort((a, b) => (b.usingGuidelines.length) - (a.usingGuidelines.length));

    return { values, catalogueSize: Object.keys(catalogue).length };
}

// ----- Value extraction from note -----------------------------------------

const EXTRACT_SYSTEM = `You extract specified clinical data values from a clinical note.

For each requested value, look in the note for evidence that the value is documented. If found, return the extracted value plus a verbatim quote from the note as evidence. If the value is not documented or cannot be determined, mark it as "missing".

Return strict JSON only.`;

function buildExtractPrompt(note, valuesList) {
    const valuesStr = valuesList.map(v => {
        const opts = v.options ? ` (options: ${v.options.join(', ')})` : '';
        const unit = v.unit ? ` (unit: ${v.unit})` : '';
        return `  - ${v.id}: ${v.label}${unit}${opts}
      type: ${v.type}
      hint: ${v.extractionHint || '(none)'}`;
    }).join('\n');

    return `CLINICAL NOTE:
${note}

VALUES TO EXTRACT:
${valuesStr}

For each value, return JSON only:
{
  "extracted": [
    {
      "id": "<value id>",
      "found": true | false,
      "value": <typed value if found, or null if missing>,
      "evidence": "<verbatim quote from note supporting this value, or empty string>",
      "confidence": 0.0-1.0
    }
  ]
}

Rules:
- Only set found=true if the value is genuinely documented. If the note is silent, found=false.
- value type must match the declared type (number/boolean/enum/string).
- For enum, value must be one of the listed options.
- Be conservative — if uncertain, set found=false and explain in evidence.`;
}

async function extractValuesFromNote(note, valuesList) {
    if (!note || !note.trim() || !Array.isArray(valuesList) || valuesList.length === 0) {
        return { extracted: [] };
    }

    // Batch into chunks of 15 to keep token usage and response size bounded
    const BATCH = 15;
    const out = [];
    for (let i = 0; i < valuesList.length; i += BATCH) {
        const batch = valuesList.slice(i, i + BATCH);
        try {
            const text = await callGemini(EXTRACT_SYSTEM, buildExtractPrompt(note, batch));
            const parsed = parseJSON(text);
            for (const e of (parsed?.extracted || [])) out.push(e);
        } catch (e) {
            // On error, mark all in batch as missing
            for (const v of batch) out.push({ id: v.id, found: false, value: null, evidence: '', confidence: 0, _error: 'extract-failed' });
        }
    }
    return { extracted: out };
}

module.exports = {
    SCHEMA_VERSION,
    getOrGenerateRequiredValues,
    aggregateAcrossGuidelines,
    extractValuesFromNote,
    loadCatalogue,
};
