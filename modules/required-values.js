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
// --- cache freshness ------------------------------------------------------

// Millis of the guideline's last practice-point regeneration (Firestore
// Timestamp, or admin export shape), or null if never recorded.
function ppRegenMillis(g) {
    const t = g && g.practicePointsRegeneratedAt;
    if (!t) return null;
    if (typeof t.toMillis === 'function') return t.toMillis();
    if (typeof t._seconds === 'number') return t._seconds * 1000;
    if (typeof t.seconds === 'number') return t.seconds * 1000;
    return null;
}

// A cached requiredValues is valid only if its schema matches AND it was
// generated AFTER the last practice-point regeneration. requiredValues are
// derived from practicePoints, so a PP rebuild (e.g. the backfill) makes any
// older requiredValues stale. Returning false here makes the cache-only path
// treat it as a miss → background-warm regenerates it from the current PPs.
// This auto-heals drift without coupling to the PP-regeneration code path.
function isRequiredValuesFresh(g) {
    const rv = g && g.requiredValues;
    if (!rv || rv.schemaVersion !== SCHEMA_VERSION) return false;
    const ppAt = ppRegenMillis(g);
    if (ppAt == null) return true; // no PP-regen timestamp to compare → accept cache
    const rvAt = rv.generatedAt ? Date.parse(rv.generatedAt) : NaN;
    if (!Number.isFinite(rvAt)) return false; // can't prove fresh → treat as stale
    return rvAt >= ppAt;
}

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

    if (!opts.forceRegenerate && isRequiredValuesFresh(g)) {
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
 * Read a guideline's cached requiredValues WITHOUT generating. Returns null if
 * not cached (or stale schema). Generation is expensive (one LLM call per PP)
 * and must never run inside a user request — use this on the live path.
 */
async function getCachedRequiredValues(db, guidelineId) {
    const doc = await db.collection('guidelines').doc(guidelineId).get();
    if (!doc.exists) return null;
    const g = doc.data();
    if (isRequiredValuesFresh(g)) {
        return { ...g.requiredValues, _source: 'cache' };
    }
    return null; // missing or stale (older than last PP regen) → caller warms it
}

/**
 * Compute the union of requiredValues across multiple guidelines, joined
 * with the canonical catalogue for label, type, extractionHint, prompt etc.
 *
 * @param {Object} db
 * @param {string[]} guidelineIds
 * @param {Object} [opts]
 * @param {boolean} [opts.cacheOnly=false] - read cached values only; never
 *   generate (generation = one LLM call per PP × many guidelines = minutes).
 *   Guidelines without a cache are collected in the returned `missing` array.
 * @returns {Promise<Object>} { values:[...], catalogueSize, missing:[guidelineId] }
 */
async function aggregateAcrossGuidelines(db, guidelineIds, opts = {}) {
    const catalogue = await loadCatalogue(db);
    const seen = new Map(); // canonicalId → { value, using: [{guidelineId, pps}] }
    const missing = [];

    for (const gId of guidelineIds) {
        const rv = opts.cacheOnly
            ? await getCachedRequiredValues(db, gId)
            : await getOrGenerateRequiredValues(db, gId);
        if (!rv) { missing.push(gId); continue; }
        for (const v of (rv.values || [])) {
            if (!seen.has(v.id)) seen.set(v.id, { value: catalogue[v.id], using: [] });
            seen.get(v.id).using.push({ guidelineId: gId, pps: v.usedByPPs });
        }
    }

    const values = [...seen.entries()]
        .map(([id, { value, using }]) => ({ id, ...(value || {}), usingGuidelines: using }))
        .filter(v => v.label) // skip canonical ids we couldn't resolve
        .sort((a, b) => (b.usingGuidelines.length) - (a.usingGuidelines.length));

    return { values, catalogueSize: Object.keys(catalogue).length, missing };
}

// ----- Value extraction from note -----------------------------------------

const EXTRACT_SYSTEM = `You extract specified clinical data values from a clinical note.

For each requested value, decide whether the value can be determined from the note — either by direct documentation OR by clinical reasoning from other documented facts. If yes, return the value with the supporting evidence. If no, mark it as missing. Be conservative: when in genuine doubt, mark missing.

Express each value as a faithful, concise natural-language answer that reflects the real clinical picture — including temporal scope (this pregnancy versus a previous one), qualifiers, and any uncertainty — rather than forcing it into a fixed category. Where a value lists options, treat them only as a guide to the kind of answer expected, not a constraint: when the documented situation does not fit a clean option, describe it accurately in your own words. In particular, a condition documented only as history or as occurring in a previous pregnancy must not be reported as the patient's current status — say so explicitly instead.

When you apply clinical reasoning, your "evidence" field MUST:
  (a) cite the documented fact you reasoned FROM (verbatim quote);
  (b) name the rule you applied;
  (c) state the SCOPE of the reasoning explicitly (this pregnancy vs prior pregnancies — these are different).

CLINICAL REASONING RULES — apply only where the documented fact UNAMBIGUOUSLY determines the requested value:

==== Parity rules — PRIOR PREGNANCIES ONLY ====

If parity is documented as G1P0 (primigravida = first pregnancy, no previous pregnancies), then the following PRIOR-PREGNANCY values are FALSE by definition (no prior pregnancies = no prior obstetric events):
  - previous_sga_baby = false  (no previous baby at all)
  - previous_stillbirth = false  (no previous baby at all)
  - placental_issues_history = false  (this value is STRICTLY about prior pregnancies; current-pregnancy placental concerns belong on USS values, not here)

Evidence format: "G1P0 / primigravida — first pregnancy, so by definition no [previous SGA / stillbirth / prior-pregnancy placental history]."

DO NOT apply parity reasoning to:
  - previous_rfm_investigations_normal — this is about PRIOR EPISODES IN THIS PREGNANCY (not prior pregnancies). A primigravida can have had an earlier RFM episode at an earlier gestation in the same pregnancy. Parity does NOT determine this.
  - current-pregnancy USS findings, current placental position, current placental concerns — these are scoped to this pregnancy, not prior pregnancies.

==== Multiparous patients ====

For G2P1+ patients, default the prior-pregnancy values to false ONLY when the note explicitly characterises the previous pregnancy as uncomplicated (e.g. "previous SVD at term, no complications", "uneventful previous pregnancy"). Otherwise leave missing — multiparous patients can have history that simply isn't recorded in this note.

==== RFM episode rules — THIS PREGNANCY ====

If the note explicitly states this is a first RFM episode in this pregnancy ("first episode of RFM", "no prior RFM in this pregnancy", "first time presenting with reduced movements"):
  - first_or_recurrent_rfm_episode = "first"
  - previous_rfm_investigations_normal = false  (no earlier episode in this pregnancy means no prior investigations to have been normal)

If the note describes a SECOND or recurrent RFM episode IN THIS PREGNANCY AND describes the previous investigation outcome:
  - first_or_recurrent_rfm_episode = "recurrent_second" or "recurrent_three_or_more" as appropriate
  - previous_rfm_investigations_normal = true or false based on what the note says about the previous investigations

If the note describes a recurrent episode but is SILENT on the outcome of previous investigations:
  - first_or_recurrent_rfm_episode = "recurrent_second" or higher
  - previous_rfm_investigations_normal = MISSING (don't guess)

==== Explicit "no risk factors" documentation ====

If the note documents an explicit risk-factor review with normal findings ("non-smoker, BMI 24, age 28, no PMH"), set the individual risk-factor values per what is documented:
  - smoking_status = whatever the note says (never_smoker / ex_smoker / current_smoker)
  - hypertension_status = "none" if explicitly stated as absent
  - diabetes_status = "none" if explicitly stated as absent
  - bmi = the documented number
  - maternal_age_years = the documented number

Only auto-fill these from a risk-review summary if the wording is clear. Vague phrases like "no significant PMH" do NOT cover smoking/BMI/age — those are demographics/lifestyle, not PMH.

==== Multiple pregnancy ====

multiple_pregnancy = true if note mentions twins, triplets, MCDA, DCDA, MCMA, "multiple pregnancy". Otherwise default to false (singleton is the standard assumption in UK obstetrics unless stated).

==== Encounter type ====

encounter_type maps from explicit context phrases:
  - "attended triage with RFM" / "MAU attendance for RFM" / "DAU for RFM" → "acute_rfm_presentation"
  - "booking visit" → "booking"
  - "routine antenatal review" / "scheduled appointment" → "routine_antenatal"
  - "growth scan review" / "growth review" → "growth_review"
  - "postnatal review" → "post_natal"

==== When to mark missing ====

If a documented fact is ambiguous, if the reasoning rule above doesn't apply cleanly, or if the note simply doesn't cover the topic — mark the value as missing rather than guessing. It is far better to ask the user than to assume.

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
- Only set found=true if the value is genuinely documented (or follows unambiguously from the note). If the note is silent, found=false.
- Express the value in natural language that faithfully reflects what the note documents, carrying any temporal scope, qualifier, or uncertainty. Listed options are a guide to the kind of answer, not a straitjacket — a faithful phrase is better than a clean but misleading label.
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

// ----- Relevance filter ----------------------------------------------------

const RELEVANCE_SYSTEM = `You decide which candidate clinical data values are actually relevant to gather for a specific patient, given their clinical note.

The candidate values are pooled from several guidelines that were matched to this note. Because a matched guideline may only partly apply, some candidates belong to a different stage of the patient's care or to an unrelated clinical problem, and are not relevant to this particular encounter.

For each candidate, judge whether a competent clinician reviewing THIS note would consider that value pertinent to the patient's current presentation and stage of care. Reason from the note: why the patient is being seen, where they are in their clinical journey (for example whether the pregnancy is ongoing or already concluded, or whether the problem is obstetric, gynaecological, or neonatal), and whether the value could plausibly bear on this patient's assessment, management, or safety.

A value that belongs to a stage of care the patient has already passed, or to a clinical problem this patient does not have, is not relevant — even though a matched guideline lists it.

Be inclusive at the margin: if a value could reasonably matter to this patient, keep it. Only exclude values that are clearly inapplicable to this scenario. When genuinely unsure, keep it.

Return strict JSON only.`;

function buildRelevancePrompt(note, valuesList) {
    const valuesStr = valuesList.map(v => {
        const desc = v.prompt || v.description || '';
        return `  - ${v.id}: ${v.label}${desc ? ` — ${desc.slice(0, 160)}` : ''}`;
    }).join('\n');

    return `CLINICAL NOTE:
${note}

CANDIDATE VALUES:
${valuesStr}

For each candidate value, decide whether it is clinically relevant to gather for THIS patient. Return JSON only:
{
  "results": [
    { "id": "<value id>", "relevant": true | false, "reason": "<short clinical reason>" }
  ]
}`;
}

/**
 * Given a clinical note and a list of candidate required values, return which
 * are clinically relevant to gather for THIS patient. Values pooled from
 * partially-applicable guidelines (e.g. antenatal fetal-surveillance values on
 * a postnatal note) are filtered out. Runs as its own LLM pass — separate from
 * extraction, which only judges whether a value is documented.
 *
 * Fails open: on any error, every value is treated as relevant (no filtering).
 *
 * @param {string} note
 * @param {Array<{id:string,label:string,prompt?:string,description?:string}>} valuesList
 * @returns {Promise<{results: Array<{id:string,relevant:boolean,reason:string}>}>}
 */
async function filterValuesByRelevance(note, valuesList) {
    if (!note || !note.trim() || !Array.isArray(valuesList) || valuesList.length === 0) {
        return { results: (valuesList || []).map(v => ({ id: v.id, relevant: true, reason: '' })) };
    }

    const BATCH = 25;
    const out = [];
    for (let i = 0; i < valuesList.length; i += BATCH) {
        const batch = valuesList.slice(i, i + BATCH);
        try {
            const text = await callGemini(RELEVANCE_SYSTEM, buildRelevancePrompt(note, batch));
            const parsed = parseJSON(text);
            const byId = new Map((parsed?.results || []).map(r => [r.id, r]));
            for (const v of batch) {
                const r = byId.get(v.id);
                // Fail open: if the model didn't return a verdict for this value, keep it.
                out.push(r && typeof r.relevant === 'boolean'
                    ? { id: v.id, relevant: r.relevant, reason: r.reason || '' }
                    : { id: v.id, relevant: true, reason: '' });
            }
        } catch (e) {
            for (const v of batch) out.push({ id: v.id, relevant: true, reason: '' });
        }
    }
    return { results: out };
}

// ----- Best-effort inference of values the note didn't document ------------

const INFER_SYSTEM = `You complete a structured set of clinical data values for a clinical note, on behalf of a clinician who will review every answer you give.

You receive the clinical note and a list of values that an earlier, deliberately conservative pass did not capture. For each, make your best determination and say whether you could determine it at all.

"Determinable" means you can settle the answer — and a negative or absent answer still counts as settling it. It does NOT mean you can confirm the answer is positive.

Two kinds of value must be handled very differently:

1. Documentation and process checks — whether something was documented, recorded, noted, advised, discussed, done, or measured DURING THIS ENCOUNTER. The note IS the record of the encounter, so you can ALWAYS settle these from the note: if the note contains it, the answer is the positive value; if the note does not, the answer is the negative value (e.g. false / not documented). Absence from the note is itself the answer. These are ALWAYS determinable — never mark a documentation or process check as not determinable, and never leave it for the clinician just because the note is silent; silence is the answer.

2. Patient measurements, observations, and past history — values that exist independently of this note, such as a measured number, a lifestyle factor, or an event in a previous pregnancy. The note may simply have omitted these. Provide a value ONLY when the note states it or it follows unambiguously from what the note states. If the note gives you no basis, mark it not determinable and leave it for the clinician. Never infer, estimate, or guess a measurement or a history detail the note does not support — absence of mention is NOT evidence of absence for this kind of value, and an unfilled value is far safer than a fabricated one.

The deciding question for each value is whether it asks about THIS encounter's record — what was written, advised, discussed, or done at this visit (kind 1) — or about a fact, measurement, or past event that exists whether or not anyone wrote it down (kind 2). Answer kind 1 from the note, taking the negative value when the note is silent; leave kind 2 blank unless the note supplies it.

Express every answer as a faithful, concise natural-language value that carries any needed context, scope, or qualifier. Where a value's type or options are given, treat them as a guide to the kind of answer expected, not a rigid constraint — prefer an accurate phrase over a clean but misleading category.

Return strict JSON only.`;

function buildInferPrompt(note, valuesList) {
    const valuesStr = valuesList.map(v => {
        const opts = v.options ? ` (options: ${v.options.join(', ')})` : '';
        const unit = v.unit ? ` (unit: ${v.unit})` : '';
        const q = v.prompt ? `\n      question: ${v.prompt}` : '';
        return `  - ${v.id}: ${v.label}${unit}${opts}
      type: ${v.type}${q}`;
    }).join('\n');

    return `CLINICAL NOTE:
${note}

VALUES TO DETERMINE:
${valuesStr}

For each value, return JSON only:
{
  "filled": [
    {
      "id": "<value id>",
      "determinable": true | false,
      "value": <typed value if determinable, else null>,
      "confidence": 0.0-1.0,
      "reason": "<one line: what in the note — or its absence — led to this answer>"
    }
  ]
}

Rules:
- determinable=true only when the note (or the documented absence, for a documentation/process check) settles the answer.
- For measurements and past history with no basis in the note, set determinable=false and value=null.
- Express value as a faithful natural-language answer carrying any needed context or scope; listed options are a guide, not a constraint.`;
}

/**
 * Best-effort fill of values the conservative extraction left blank. Documentation
 * /process flags are answered from the note (absence ⇒ the negative answer);
 * measurements and history are filled only when the note supports them, never
 * fabricated. Each result is reviewable by the clinician downstream.
 *
 * Fails open: on any error, values are returned as not determinable.
 *
 * @param {string} note
 * @param {Array<{id,label,type,prompt?,options?,unit?}>} valuesList
 * @returns {Promise<{filled: Array<{id,determinable,value,confidence,reason}>}>}
 */
async function inferMissingValues(note, valuesList) {
    if (!note || !note.trim() || !Array.isArray(valuesList) || valuesList.length === 0) {
        return { filled: [] };
    }
    const BATCH = 15;
    const out = [];
    for (let i = 0; i < valuesList.length; i += BATCH) {
        const batch = valuesList.slice(i, i + BATCH);
        try {
            const text = await callGemini(INFER_SYSTEM, buildInferPrompt(note, batch));
            const parsed = parseJSON(text);
            const byId = new Map((parsed?.filled || []).map(r => [r.id, r]));
            for (const v of batch) {
                const r = byId.get(v.id);
                out.push(r && r.determinable === true
                    ? { id: v.id, determinable: true, value: r.value, confidence: r.confidence ?? null, reason: r.reason || '' }
                    : { id: v.id, determinable: false, value: null, confidence: null, reason: r?.reason || '' });
            }
        } catch (e) {
            for (const v of batch) out.push({ id: v.id, determinable: false, value: null, confidence: null, reason: '' });
        }
    }
    return { filled: out };
}

// ----- Note augmentation with user-supplied values ------------------------

const AUGMENT_SYSTEM = `You incorporate user-supplied clinical values into an existing clinical note.

You receive: (a) the original note, and (b) a list of confirmed clinical values the user provided.

Your job: produce a revised note that incorporates the user-supplied values into clinically appropriate places. Rules:
- Preserve the original note's structure, voice, abbreviations, and existing content. Do not paraphrase or restructure parts of the note that are already there.
- Insert each supplied value either inline (when it naturally fits in an existing sentence/section), or in a clearly-labelled "Confirmed background:" block if the note has no natural place for it.
- Keep additions concise and use standard UK obstetric phrasing.
- Do not invent details beyond what the supplied values give you. Do not contradict the existing note.
- Do not duplicate values already documented in the note — if a value is already there, leave it alone.
- Output the full revised note text only. No JSON, no commentary, no markdown fences.`;

function buildAugmentPrompt(note, values) {
    const valuesStr = values.map(v => {
        const label = v.label || v.id;
        const val = (v.value === null || v.value === undefined || v.value === '') ? '(unknown)' : String(v.value);
        return `  - ${label}: ${val}`;
    }).join('\n');

    return `ORIGINAL NOTE:
${note}

CONFIRMED CLINICAL VALUES TO INCORPORATE:
${valuesStr}

Return the revised note text only.`;
}

// callGemini-text — same wrapper, but plain-text response (no JSON mode)
async function callGeminiText(systemPrompt, userPrompt) {
    const apiKey = process.env.GOOGLE_AI_API_KEY;
    if (!apiKey) throw new Error('GOOGLE_AI_API_KEY not set');
    const url = `${GEMINI_URL_BASE}/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
    const generationConfig = {
        temperature: 0,
        maxOutputTokens: 4000,
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
    if (!resp.ok) throw new Error(`Gemini ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
    const json = await resp.json();
    return json?.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

/**
 * Augment a note with user-supplied clinical values, weaving them into
 * clinically-appropriate places via an LLM call.
 *
 * @param {string} note - original note text
 * @param {Array<{id:string,label:string,type:string,value:any}>} values - confirmed values to add
 * @returns {Promise<string>} augmented note
 */
async function augmentNoteWithValues(note, values) {
    if (!note || !Array.isArray(values) || values.length === 0) return note;
    const augmented = await callGeminiText(AUGMENT_SYSTEM, buildAugmentPrompt(note, values));
    return (augmented || note).trim();
}

module.exports = {
    SCHEMA_VERSION,
    getOrGenerateRequiredValues,
    getCachedRequiredValues,
    aggregateAcrossGuidelines,
    extractValuesFromNote,
    filterValuesByRelevance,
    inferMissingValues,
    augmentNoteWithValues,
    loadCatalogue,
};
