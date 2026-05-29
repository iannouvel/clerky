#!/usr/bin/env node
/**
 * pp-calibrate.js <ppSerial>
 *
 * Runs ALL working judges against ONE PP's 10 scenarios and reports the
 * mismatches in detail. Use this iteratively while refining a PP's wording
 * or its scenarios.
 *
 * Reads from tests/.pp-scenario-bank.json. You may pass:
 *   --name="<override PP name>"           # to try alternative PP wording
 *   --quote="<override verbatim>"         # to try alternative quote
 *   --note-c1="<override C1 note>"        # to try alternative scenario
 *   --bank=<path>                         # custom bank file
 *
 * If all judges score 10/10, exits 0. Otherwise exits 1 and prints the
 * mismatches with each judge's reasoning.
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');

const BANK = path.join(__dirname, '..', 'tests', '.pp-scenario-bank.json');

const JUDGES = [
    { id: 'gemini-2.5-flash', kind: 'gemini', model: 'gemini-2.5-flash' },
    { id: 'gemini-2.0-flash', kind: 'gemini', model: 'gemini-2.0-flash' },
    { id: 'claude-sonnet-4-6', kind: 'anthropic', model: 'claude-sonnet-4-6' },
    { id: 'deepseek-chat', kind: 'deepseek', model: 'deepseek-chat' },
    { id: 'gpt-4o-mini', kind: 'openai', model: 'gpt-4o-mini' },
];

const JUDGE_SYSTEM = `You are a senior UK clinician auditing a clinical note for compliance with a single practice point from a clinical guideline. You are precise and you do not invent content that isn't in the note.

For the given practice point:

1. Is it APPLICABLE to this patient based on what the note documents? If the triggering condition is not met, it is not applicable.

2. If applicable, is the note COMPLIANT? Compliance means either:
   - The required action is documented as having been done (the specific value or finding is written in the note), OR
   - The required action was actively considered and reasoned out as not indicated for this patient.
   - Silence is NOT compliance.

CRITICAL: Do not infer that an action was performed because other related actions are documented. If a list of observations contains T, HR, RR, SpO2 but not BP, then BP was NOT measured — do not assume it was "part of the observations". Only credit actions whose specific results or values are literally in the note.

Stay strictly faithful to the verbatim guideline wording. Do not invent stricter standards than the guideline actually imposes.

Return strict JSON only.`;

function buildJudgePrompt(note, pp, guidelineTitle) {
    const lines = [
        `GUIDELINE: ${guidelineTitle}`,
        ``,
        `PRACTICE POINT #${pp.serial}:`,
        `NAME: ${pp.name}`,
    ];
    if (pp.description) lines.push('', `DESCRIPTION: ${pp.description}`);
    if (pp.condition) lines.push('', `CONDITION (when this PP applies): ${pp.condition}`);
    if (pp.action) lines.push('', `ACTION (what must be done): ${pp.action}`);
    if (pp.verbatimQuote) lines.push('', `VERBATIM GUIDELINE QUOTE: ${pp.verbatimQuote}`);
    if (pp.ruleType) lines.push('', `RULE TYPE: ${pp.ruleType}`);
    lines.push('', `CLINICAL NOTE:`, note);
    lines.push('', `Return JSON in this exact shape:
{
  "applicable": true | false,
  "compliant": "yes" | "partial" | "no" | "na",
  "reason": "<1-2 sentences>",
  "confidence": 0.0
}

Rules:
- If applicable is false, set compliant to "na".
- "yes" = action documented as done, OR actively reasoned out as not indicated.
- "partial" = action partially documented but not unambiguously complete.
- "no" = action not mentioned, despite being applicable.`);
    return lines.join('\n');
}

function parseJSON(text) {
    const cleaned = (text || '').trim().replace(/^```json\s*/i, '').replace(/```\s*$/, '');
    try { return JSON.parse(cleaned); } catch (_) {}
    const s = cleaned.indexOf('{'), e = cleaned.lastIndexOf('}');
    if (s !== -1 && e > s) { try { return JSON.parse(cleaned.slice(s, e + 1)); } catch (_) {} }
    return null;
}

async function callGemini(model, system, user) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GOOGLE_AI_API_KEY}`;
    // Gemini 2.5 uses internal "thinking" tokens that count against maxOutputTokens.
    // Disable thinking and give a generous output cap so we never truncate the JSON.
    const genConfig = { temperature: 0, topP: 0.1, maxOutputTokens: 4000, responseMimeType: 'application/json' };
    if (model.startsWith('gemini-2.5')) genConfig.thinkingConfig = { thinkingBudget: 0 };
    const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: user }] }],
        generationConfig: genConfig,
    })});
    if (!r.ok) throw new Error(`${r.status}: ${(await r.text()).slice(0, 120)}`);
    const j = await r.json();
    return j?.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

async function callOpenAI(model, system, user) {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'content-type': 'application/json' },
        body: JSON.stringify({ model, messages: [{ role: 'system', content: system }, { role: 'user', content: user }], temperature: 0, response_format: { type: 'json_object' }, max_tokens: 800 }),
    });
    if (!r.ok) throw new Error(`${r.status}: ${(await r.text()).slice(0, 120)}`);
    const j = await r.json();
    return j?.choices?.[0]?.message?.content || '';
}

async function callDeepSeek(model, system, user) {
    const r = await fetch('https://api.deepseek.com/chat/completions', {
        method: 'POST',
        headers: { authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`, 'content-type': 'application/json' },
        body: JSON.stringify({ model, messages: [{ role: 'system', content: system }, { role: 'user', content: user }], temperature: 0, response_format: { type: 'json_object' }, max_tokens: 800 }),
    });
    if (!r.ok) throw new Error(`${r.status}: ${(await r.text()).slice(0, 120)}`);
    const j = await r.json();
    return j?.choices?.[0]?.message?.content || '';
}

async function callAnthropic(model, system, user) {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({ model, max_tokens: 800, system, messages: [{ role: 'user', content: user }] }),
    });
    if (!r.ok) throw new Error(`${r.status}: ${(await r.text()).slice(0, 120)}`);
    const j = await r.json();
    return j?.content?.[0]?.text || '';
}

async function callJudge(j, system, user) {
    if (j.kind === 'gemini') return callGemini(j.model, system, user);
    if (j.kind === 'openai') return callOpenAI(j.model, system, user);
    if (j.kind === 'deepseek') return callDeepSeek(j.model, system, user);
    if (j.kind === 'anthropic') return callAnthropic(j.model, system, user);
    throw new Error('Unknown judge');
}

function verdict(p) {
    if (!p) return '??';
    if (p.applicable === false || p.compliant === 'na') return 'na';
    return p.compliant;
}

function isCorrect(label, v) {
    if (label === 'compliant') return v === 'yes';
    if (label === 'non_compliant') return v === 'no';
    return false;
}

function parseArgs() {
    const out = { serial: null, overrides: {}, bank: BANK };
    for (let i = 2; i < process.argv.length; i++) {
        const a = process.argv[i];
        if (!a.startsWith('--')) { out.serial = parseInt(a, 10); continue; }
        if (a.startsWith('--bank=')) out.bank = a.slice('--bank='.length);
        else if (a.startsWith('--name=')) out.overrides.name = a.slice('--name='.length);
        else if (a.startsWith('--quote=')) out.overrides.verbatimQuote = a.slice('--quote='.length);
    }
    return out;
}

(async () => {
    const args = parseArgs();
    if (!args.serial) { console.error('Usage: node pp-calibrate.js <ppSerial> [--name="..."] [--quote="..."]'); process.exit(2); }
    const bank = JSON.parse(fs.readFileSync(args.bank, 'utf8'));
    const pp = bank.scenarios.find(s => s.serial === args.serial);
    if (!pp) { console.error(`PP #${args.serial} not in bank`); process.exit(2); }
    if (args.overrides.name) pp.name = args.overrides.name;
    if (args.overrides.verbatimQuote) pp.verbatimQuote = args.overrides.verbatimQuote;

    const scenarios = [...(pp.compliant || []).map(s => ({ ...s, label: 'compliant' })),
                      ...(pp.non_compliant || []).map(s => ({ ...s, label: 'non_compliant' }))];
    console.log(`\nPP #${pp.serial}: ${pp.name}`);
    console.log(`Verbatim: "${pp.verbatimQuote || pp.name}"\n`);
    console.log(`Scenarios: ${scenarios.length} (${(pp.compliant||[]).length} compliant, ${(pp.non_compliant||[]).length} non-compliant)`);
    console.log(`Judges: ${JUDGES.map(j=>j.id).join(', ')}\n`);

    // Helper: call judge with up-to-2 retries if response unparseable.
    async function judgeWithRetry(j, userPrompt) {
        let lastRaw = '';
        for (let attempt = 0; attempt < 3; attempt++) {
            try {
                const raw = await callJudge(j, JUDGE_SYSTEM, userPrompt);
                lastRaw = raw;
                const parsed = parseJSON(raw);
                if (parsed) return { verdict: verdict(parsed), reason: (parsed.reason||'').slice(0, 240) };
                await new Promise(r => setTimeout(r, 1500));
            } catch (e) {
                if (attempt === 2) return { verdict: 'ERR', error: e.message.slice(0, 80) };
                await new Promise(r => setTimeout(r, 1500));
            }
        }
        return { verdict: '??', error: 'unparseable after 3 tries', raw: lastRaw.slice(0, 120) };
    }

    const results = [];
    for (const sc of scenarios) {
        const userPrompt = buildJudgePrompt(sc.note, pp, bank.guideline);
        const outcomes = {};
        await Promise.all(JUDGES.map(async (j) => { outcomes[j.id] = await judgeWithRetry(j, userPrompt); }));
        results.push({ id: sc.id, label: sc.label, note: sc.note, outcomes });
    }

    // Print per-scenario grid
    console.log(' ID   exp ' + JUDGES.map(j => j.id.slice(0, 10).padEnd(11)).join(''));
    console.log(' ' + '-'.repeat(7 + 11 * JUDGES.length));
    let total = 0, correct = 0;
    const mismatches = [];
    for (const r of results) {
        const exp = r.label === 'compliant' ? 'yes' : 'no';
        const cells = JUDGES.map(j => {
            const o = r.outcomes[j.id];
            const ok = isCorrect(r.label, o.verdict);
            total++; if (ok) correct++;
            return ((ok ? '✓ ' : '✗ ') + (o.verdict||'?')).padEnd(11);
        });
        console.log(' ' + r.id.padEnd(4) + ' ' + exp.padEnd(4) + cells.join(''));
        JUDGES.forEach(j => {
            const o = r.outcomes[j.id];
            if (!isCorrect(r.label, o.verdict)) mismatches.push({ scId: r.id, label: r.label, expected: exp, judge: j.id, got: o.verdict, note: r.note, error: o.error });
        });
    }
    console.log(`\nTotal: ${correct}/${total} (${Math.round(100*correct/total)}%)`);

    if (mismatches.length === 0) {
        console.log(`\n✓ PP #${pp.serial} is fully calibrated. All judges agree with ground truth.`);
        process.exit(0);
    }

    console.log(`\n=== ${mismatches.length} MISMATCH${mismatches.length>1?'ES':''} ===`);
    for (const m of mismatches) {
        const o = results.find(r => r.id === m.scId).outcomes[m.judge];
        console.log(`\n[${m.scId} ${m.label}] ${m.judge}: expected ${m.expected}, got ${m.got}`);
        if (o.reason) console.log(`  reason: ${o.reason}`);
        if (o.error) console.log(`  error: ${o.error}`);
        console.log(`  note: ${m.note.split('\n').slice(0,3).join(' | ').slice(0, 200)}...`);
    }

    process.exit(1);
})().catch(e => { console.error(e); process.exit(2); });
