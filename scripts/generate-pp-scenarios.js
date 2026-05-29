#!/usr/bin/env node
/**
 * generate-pp-scenarios.js
 *
 * For each PP in the BJOG 2026 RFM guideline, ask Gemini to generate
 * 5 compliant + 5 non-compliant realistic clinical notes (10-20 lines each).
 *
 * Output: tests/.pp-scenario-bank.json
 */

require('dotenv').config();
const path = require('path');
const fs = require('fs');
const admin = require('firebase-admin');

const SA_PATH = path.join(__dirname, '..', 'server', 'config', 'serviceAccountKey.json');
const GUIDELINE_ID = 'bjog-2026-whitworth-reduced-fetal-movements-green-top-guideline-no-57';
const OUTPUT = path.join(__dirname, '..', 'tests', '.pp-scenario-bank.json');
const GEMINI_MODEL = 'gemini-2.5-flash';
const GEMINI_URL_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const CONCURRENCY = 4;

const GEN_SYSTEM = `You are a UK obstetric clinician writing realistic clinical notes for a test bank.

You will be given ONE practice point from a maternity guideline, plus the verbatim guideline quote.

Your job: write 10 realistic clinical notes (10-20 lines each, in normal UK note style — bullet points, SBAR, or prose are all acceptable). Five must clearly demonstrate COMPLIANCE with the specific practice point (the action was done as specified, or actively reasoned out as not indicated). Five must clearly demonstrate NON-COMPLIANCE (the action is silent from the note, or was actively replaced with something else, or was dismissed without justification).

Crucial rules:
- Each note must describe a complete patient encounter — admission, review, or assessment — with realistic background, observations, history, plan. Not a one-sentence vignette.
- The compliance / non-compliance signal must be UNAMBIGUOUS for the specific practice point given — even if the note covers other clinical actions.
- Stay faithful to the verbatim guideline wording. Do not invent stricter standards (e.g. don't require "immediate" if the guideline only says "on presentation").
- Non-compliance is silence or explicit replacement of the required action — NOT a delay if the guideline doesn't specify timing.
- Vary the scenarios — different gestations, parities, settings (MAU, triage, community, antenatal clinic), and clinical backgrounds.
- British English; standard UK obstetric terminology and abbreviations.

Return strict JSON only:
{
  "compliant": [
    { "id": "C1", "note": "<full clinical note>" },
    { "id": "C2", "note": "..." },
    { "id": "C3", "note": "..." },
    { "id": "C4", "note": "..." },
    { "id": "C5", "note": "..." }
  ],
  "non_compliant": [
    { "id": "I1", "note": "..." },
    { "id": "I2", "note": "..." },
    { "id": "I3", "note": "..." },
    { "id": "I4", "note": "..." },
    { "id": "I5", "note": "..." }
  ]
}`;

function buildGenPrompt(pp, guidelineTitle) {
    return `GUIDELINE: ${guidelineTitle}

PRACTICE POINT #${pp.serial}:
NAME: ${pp.name}

DESCRIPTION: ${pp.description || ''}

CONDITION (when it applies): ${pp.condition || ''}

ACTION (what should be done): ${pp.action || ''}

VERBATIM GUIDELINE QUOTE: ${pp.verbatimQuote || pp.name}

Generate 5 compliant + 5 non-compliant scenarios as JSON.`;
}

async function callGemini(system, user, retries = 2) {
    const apiKey = process.env.GOOGLE_AI_API_KEY;
    if (!apiKey) throw new Error('GOOGLE_AI_API_KEY missing');
    const url = `${GEMINI_URL_BASE}/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
    let lastErr;
    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            const resp = await fetch(url, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                    systemInstruction: { parts: [{ text: system }] },
                    contents: [{ role: 'user', parts: [{ text: user }] }],
                    generationConfig: { temperature: 0.7, maxOutputTokens: 6000, responseMimeType: 'application/json' },
                }),
            });
            if (!resp.ok) {
                const t = await resp.text();
                if (resp.status === 429 || resp.status >= 500) {
                    lastErr = new Error(`Gemini ${resp.status}`);
                    await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
                    continue;
                }
                throw new Error(`Gemini ${resp.status}: ${t.slice(0, 200)}`);
            }
            const j = await resp.json();
            return j?.candidates?.[0]?.content?.parts?.[0]?.text || '';
        } catch (e) { lastErr = e; }
    }
    throw lastErr;
}

function parseJSON(text) {
    const cleaned = (text || '').trim().replace(/^```json\s*/i, '').replace(/```\s*$/, '');
    try { return JSON.parse(cleaned); } catch (_) {}
    const s = cleaned.indexOf('{'), e = cleaned.lastIndexOf('}');
    if (s !== -1 && e > s) { try { return JSON.parse(cleaned.slice(s, e + 1)); } catch (_) {} }
    return null;
}

async function generateForPP(pp, guidelineTitle) {
    const text = await callGemini(GEN_SYSTEM, buildGenPrompt(pp, guidelineTitle));
    const parsed = parseJSON(text);
    if (!parsed) throw new Error('Unparseable JSON');
    if (!parsed.compliant || !parsed.non_compliant) throw new Error('Missing compliant/non_compliant');
    return parsed;
}

async function runConcurrent(items, fn, concurrency) {
    const out = new Array(items.length);
    let idx = 0;
    async function worker() {
        while (true) {
            const i = idx++;
            if (i >= items.length) break;
            try { out[i] = await fn(items[i], i); }
            catch (e) { out[i] = { _error: e.message }; console.warn(`  [${items[i].serial}] ${items[i].name.slice(0,60)}... ERR: ${e.message.slice(0,80)}`); }
        }
    }
    const workers = Array.from({ length: concurrency }, worker);
    await Promise.all(workers);
    return out;
}

(async () => {
    if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(require(SA_PATH)) });
    const db = admin.firestore();

    const doc = await db.collection('guidelines').doc(GUIDELINE_ID).get();
    const g = doc.data();
    const guidelineTitle = (g.humanFriendlyTitle || g.title || '').replace(/â/g, '-');
    const pps = (g.practicePoints || []).map((p, i) => ({ ...p, serial: i + 1 }));

    console.log(`Generating scenarios for ${pps.length} PPs in: ${guidelineTitle}\n`);

    const t0 = Date.now();
    const results = await runConcurrent(pps, async (pp, i) => {
        const r = await generateForPP(pp, guidelineTitle);
        console.log(`  [${pp.serial}/${pps.length}] ${pp.name.slice(0, 70)}... C=${r.compliant.length} I=${r.non_compliant.length}`);
        return { serial: pp.serial, name: pp.name, condition: pp.condition, action: pp.action, verbatimQuote: pp.verbatimQuote, description: pp.description, ...r };
    }, CONCURRENCY);

    const ok = results.filter(r => !r._error);
    const fail = results.filter(r => r._error);
    console.log(`\nGenerated ${ok.length}/${results.length} PPs successfully in ${Math.round((Date.now()-t0)/1000)}s`);
    if (fail.length) console.log(`Failed: ${fail.length}`);

    const out = { guideline: guidelineTitle, generatedAt: new Date().toISOString(), ppCount: ok.length, scenarios: results };
    fs.writeFileSync(OUTPUT, JSON.stringify(out, null, 2));
    console.log(`Saved: ${OUTPUT}`);
})().catch(e => { console.error(e); process.exit(1); });
