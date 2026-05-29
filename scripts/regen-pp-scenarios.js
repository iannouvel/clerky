#!/usr/bin/env node
/**
 * regen-pp-scenarios.js <ppSerial> --ids=C3,C5,I1 --instruction="..."
 *
 * Regenerates specific scenarios for a PP with tighter instructions.
 * Writes back to tests/.pp-scenario-bank.json (after backing it up).
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');

const BANK = path.join(__dirname, '..', 'tests', '.pp-scenario-bank.json');

const GEN_SYSTEM = `You are a UK obstetric clinician writing realistic clinical notes for a test bank.

Write ONE clinical note (10-20 lines, realistic UK note style) for the given practice point, matching the requested label and following the specific framing instructions exactly.

Crucial:
- Each note describes a complete patient encounter with background, observations, history, plan.
- The compliance / non-compliance signal must be UNAMBIGUOUS.
- Stay strictly faithful to the verbatim guideline wording.
- British English; standard UK obstetric terminology and abbreviations.

Return strict JSON only: { "note": "<full clinical note>" }`;

function buildPrompt(pp, scenario, instruction, guidelineTitle) {
    return `GUIDELINE: ${guidelineTitle}

PRACTICE POINT #${pp.serial}:
${pp.name}

VERBATIM GUIDELINE QUOTE: ${pp.verbatimQuote}

REGENERATE SCENARIO ID: ${scenario.id}
EXPECTED LABEL: ${scenario.expectedLabel === 'compliant' ? 'COMPLIANT (must demonstrate the action was clearly done)' : 'NON-COMPLIANT (must clearly show the action was not done, with no ambiguity)'}

SPECIFIC FRAMING INSTRUCTIONS:
${instruction}

Return JSON: { "note": "<the clinical note>" }`;
}

async function callGemini(system, user) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GOOGLE_AI_API_KEY}`;
    const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: user }] }],
        generationConfig: { temperature: 0.5, maxOutputTokens: 4000, responseMimeType: 'application/json', thinkingConfig: { thinkingBudget: 0 } },
    })});
    if (!r.ok) throw new Error(`${r.status}: ${(await r.text()).slice(0, 120)}`);
    const j = await r.json();
    return j?.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

function parseJSON(text) {
    const cleaned = (text || '').trim().replace(/^```json\s*/i, '').replace(/```\s*$/, '');
    try { return JSON.parse(cleaned); } catch (_) {}
    const s = cleaned.indexOf('{'), e = cleaned.lastIndexOf('}');
    if (s !== -1 && e > s) { try { return JSON.parse(cleaned.slice(s, e + 1)); } catch (_) {} }
    return null;
}

function parseArgs() {
    const out = { serial: null, ids: [], instruction: '' };
    for (let i = 2; i < process.argv.length; i++) {
        const a = process.argv[i];
        if (!a.startsWith('--')) out.serial = parseInt(a, 10);
        else if (a.startsWith('--ids=')) out.ids = a.slice('--ids='.length).split(',').map(s => s.trim());
        else if (a.startsWith('--instruction=')) out.instruction = a.slice('--instruction='.length);
    }
    return out;
}

(async () => {
    const args = parseArgs();
    if (!args.serial || !args.ids.length || !args.instruction) {
        console.error('Usage: node regen-pp-scenarios.js <ppSerial> --ids=C3,I1 --instruction="..."');
        process.exit(2);
    }
    const bank = JSON.parse(fs.readFileSync(BANK, 'utf8'));
    const pp = bank.scenarios.find(s => s.serial === args.serial);
    if (!pp) { console.error(`PP #${args.serial} not in bank`); process.exit(2); }

    fs.writeFileSync(BANK + '.pre-regen-' + Date.now() + '.bak', JSON.stringify(bank, null, 2));

    for (const scId of args.ids) {
        const isCompliant = scId.startsWith('C');
        const arr = isCompliant ? pp.compliant : pp.non_compliant;
        const idx = arr.findIndex(s => s.id === scId);
        if (idx < 0) { console.warn(`  ${scId}: not found`); continue; }
        const prompt = buildPrompt(pp, { id: scId, expectedLabel: isCompliant ? 'compliant' : 'non_compliant' }, args.instruction, bank.guideline);
        const text = await callGemini(GEN_SYSTEM, prompt);
        const parsed = parseJSON(text);
        if (!parsed || !parsed.note) { console.warn(`  ${scId}: failed to parse`); continue; }
        arr[idx] = { id: scId, note: parsed.note };
        console.log(`  ${scId}: regenerated (${parsed.note.length} chars)`);
    }

    fs.writeFileSync(BANK, JSON.stringify(bank, null, 2));
    console.log('Bank updated.');
})().catch(e => { console.error(e); process.exit(1); });
