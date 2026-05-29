#!/usr/bin/env node
/**
 * judge-pp-scenarios.js
 *
 * Reads tests/.pp-scenario-bank.json and judges every scenario against
 * a panel of LLMs. Produces an aggregate accuracy report per PP and overall.
 */

require('dotenv').config();
const path = require('path');
const fs = require('fs');

const BANK = path.join(__dirname, '..', 'tests', '.pp-scenario-bank.json');
const OUTPUT = path.join(__dirname, '..', 'tests', '.pp-scenario-judgments.json');
const REPORT_MD = path.join(__dirname, '..', 'tests', '.pp-scenario-report.md');
const CONCURRENCY = 6;

const GEMINI_URL_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const DEEPSEEK_URL = 'https://api.deepseek.com/chat/completions';

// Five distinct judges. Anthropic kept in the panel; if credits are out, it'll
// just error and be counted as such.
const JUDGES = [
    { id: 'gemini-2.5-flash', kind: 'gemini', model: 'gemini-2.5-flash' },
    { id: 'gemini-2.0-flash', kind: 'gemini', model: 'gemini-2.0-flash' },
    { id: 'gpt-4o-mini', kind: 'openai', model: 'gpt-4o-mini' },
    { id: 'deepseek-chat', kind: 'deepseek', model: 'deepseek-chat' },
    { id: 'claude-sonnet-4-6', kind: 'anthropic', model: 'claude-sonnet-4-6' },
];

const JUDGE_SYSTEM = `You are a senior UK clinician auditing a clinical note for compliance with a single practice point from a clinical guideline. You are precise and you do not invent content that isn't in the note.

For the given practice point:

1. Is it APPLICABLE to this patient based on what the note documents? If the triggering condition is not met, it is not applicable.

2. If applicable, is the note COMPLIANT? Compliance means either:
   - The required action is documented as having been done, OR
   - The required action was actively considered and reasoned out as not indicated for this patient.
   - Silence is NOT compliance.

Stay strictly faithful to the verbatim guideline wording. Do not invent stricter standards than the guideline actually imposes.

Return strict JSON only.`;

function buildJudgePrompt(note, pp, guidelineTitle) {
    return `GUIDELINE: ${guidelineTitle}

PRACTICE POINT #${pp.serial}:
${pp.name}

VERBATIM GUIDELINE QUOTE: ${pp.verbatimQuote || pp.name}

CLINICAL NOTE:
${note}

Return JSON in this exact shape:
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
- "no" = action not mentioned, despite being applicable.`;
}

function parseJSON(text) {
    const cleaned = (text || '').trim().replace(/^```json\s*/i, '').replace(/```\s*$/, '');
    try { return JSON.parse(cleaned); } catch (_) {}
    const s = cleaned.indexOf('{'), e = cleaned.lastIndexOf('}');
    if (s !== -1 && e > s) { try { return JSON.parse(cleaned.slice(s, e + 1)); } catch (_) {} }
    return null;
}

// ----- Provider calls --------------------------------------------------------

async function callGemini(model, system, user, retries = 2) {
    const apiKey = process.env.GOOGLE_AI_API_KEY;
    const url = `${GEMINI_URL_BASE}/${model}:generateContent?key=${apiKey}`;
    let lastErr;
    for (let i = 0; i <= retries; i++) {
        try {
            const resp = await fetch(url, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                    systemInstruction: { parts: [{ text: system }] },
                    contents: [{ role: 'user', parts: [{ text: user }] }],
                    generationConfig: { temperature: 0, topP: 0.1, maxOutputTokens: 800, responseMimeType: 'application/json' },
                }),
            });
            if (!resp.ok) {
                const t = await resp.text();
                if (resp.status === 429 || resp.status >= 500) { lastErr = new Error(`${resp.status}`); await new Promise(r => setTimeout(r, 2000 * (i + 1))); continue; }
                throw new Error(`${resp.status}: ${t.slice(0, 120)}`);
            }
            const j = await resp.json();
            return j?.candidates?.[0]?.content?.parts?.[0]?.text || '';
        } catch (e) { lastErr = e; }
    }
    throw lastErr;
}

async function callOpenAI(model, system, user, retries = 2) {
    const apiKey = process.env.OPENAI_API_KEY;
    let lastErr;
    for (let i = 0; i <= retries; i++) {
        try {
            const resp = await fetch(OPENAI_URL, {
                method: 'POST',
                headers: { 'authorization': `Bearer ${apiKey}`, 'content-type': 'application/json' },
                body: JSON.stringify({
                    model,
                    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
                    temperature: 0,
                    response_format: { type: 'json_object' },
                    max_tokens: 800,
                }),
            });
            if (!resp.ok) {
                const t = await resp.text();
                if (resp.status === 429 || resp.status >= 500) { lastErr = new Error(`${resp.status}`); await new Promise(r => setTimeout(r, 2000 * (i + 1))); continue; }
                throw new Error(`${resp.status}: ${t.slice(0, 120)}`);
            }
            const j = await resp.json();
            return j?.choices?.[0]?.message?.content || '';
        } catch (e) { lastErr = e; }
    }
    throw lastErr;
}

async function callDeepSeek(model, system, user, retries = 2) {
    const apiKey = process.env.DEEPSEEK_API_KEY;
    let lastErr;
    for (let i = 0; i <= retries; i++) {
        try {
            const resp = await fetch(DEEPSEEK_URL, {
                method: 'POST',
                headers: { 'authorization': `Bearer ${apiKey}`, 'content-type': 'application/json' },
                body: JSON.stringify({
                    model,
                    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
                    temperature: 0,
                    response_format: { type: 'json_object' },
                    max_tokens: 800,
                }),
            });
            if (!resp.ok) {
                const t = await resp.text();
                if (resp.status === 429 || resp.status >= 500) { lastErr = new Error(`${resp.status}`); await new Promise(r => setTimeout(r, 2000 * (i + 1))); continue; }
                throw new Error(`${resp.status}: ${t.slice(0, 120)}`);
            }
            const j = await resp.json();
            return j?.choices?.[0]?.message?.content || '';
        } catch (e) { lastErr = e; }
    }
    throw lastErr;
}

async function callAnthropic(model, system, user, retries = 1) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    let lastErr;
    for (let i = 0; i <= retries; i++) {
        try {
            const resp = await fetch(ANTHROPIC_URL, {
                method: 'POST',
                headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
                body: JSON.stringify({
                    model,
                    max_tokens: 800,
                    system,
                    messages: [{ role: 'user', content: user }],
                }),
            });
            if (!resp.ok) {
                const t = await resp.text();
                throw new Error(`${resp.status}: ${t.slice(0, 120)}`);
            }
            const j = await resp.json();
            return j?.content?.[0]?.text || '';
        } catch (e) { lastErr = e; if (i < retries) await new Promise(r => setTimeout(r, 1500)); }
    }
    throw lastErr;
}

async function callJudge(judge, system, user) {
    if (judge.kind === 'gemini') return callGemini(judge.model, system, user);
    if (judge.kind === 'openai') return callOpenAI(judge.model, system, user);
    if (judge.kind === 'deepseek') return callDeepSeek(judge.model, system, user);
    if (judge.kind === 'anthropic') return callAnthropic(judge.model, system, user);
    throw new Error('Unknown judge kind');
}

// ----- Main ---------------------------------------------------------------

function verdict(parsed) {
    if (!parsed) return '??';
    if (parsed.applicable === false || parsed.compliant === 'na') return 'na';
    return parsed.compliant;
}

function isCorrect(label, v) {
    if (label === 'compliant') return v === 'yes';
    if (label === 'non_compliant') return v === 'no';
    return false;
}

async function runConcurrent(items, fn, concurrency) {
    const out = new Array(items.length);
    let idx = 0;
    async function worker() {
        while (true) {
            const i = idx++;
            if (i >= items.length) break;
            try { out[i] = await fn(items[i], i); }
            catch (e) { out[i] = { _error: e.message }; }
        }
    }
    await Promise.all(Array.from({ length: concurrency }, worker));
    return out;
}

(async () => {
    const bank = JSON.parse(fs.readFileSync(BANK, 'utf8'));
    const guidelineTitle = bank.guideline;
    const ppEntries = bank.scenarios.filter(s => !s._error);
    console.log(`Bank: ${ppEntries.length} PPs, ${guidelineTitle}`);
    console.log(`Judges: ${JUDGES.map(j => j.id).join(', ')}\n`);

    // Build flat list of (pp, scenario, label) tasks
    const tasks = [];
    for (const pp of ppEntries) {
        const ppMeta = { serial: pp.serial, name: pp.name, verbatimQuote: pp.verbatimQuote };
        (pp.compliant || []).forEach(s => tasks.push({ pp: ppMeta, scId: s.id, label: 'compliant', note: s.note }));
        (pp.non_compliant || []).forEach(s => tasks.push({ pp: ppMeta, scId: s.id, label: 'non_compliant', note: s.note }));
    }
    console.log(`Total scenarios: ${tasks.length}`);
    console.log(`Total judge calls: ${tasks.length * JUDGES.length}\n`);

    const t0 = Date.now();
    let done = 0;
    const results = await runConcurrent(tasks, async (task) => {
        const userPrompt = buildJudgePrompt(task.note, task.pp, guidelineTitle);
        const judgeOutcomes = {};
        for (const judge of JUDGES) {
            try {
                const text = await callJudge(judge, JUDGE_SYSTEM, userPrompt);
                const parsed = parseJSON(text);
                const v = verdict(parsed);
                judgeOutcomes[judge.id] = { verdict: v, correct: isCorrect(task.label, v), reason: (parsed?.reason || '').slice(0, 120) };
            } catch (e) { judgeOutcomes[judge.id] = { verdict: 'ERR', correct: false, error: e.message.slice(0, 80) }; }
        }
        done++;
        if (done % 20 === 0 || done === tasks.length) {
            const pct = Math.round(100 * done / tasks.length);
            const elapsed = Math.round((Date.now() - t0) / 1000);
            console.log(`  ${done}/${tasks.length} (${pct}%) elapsed=${elapsed}s`);
        }
        return { ...task, judges: judgeOutcomes };
    }, CONCURRENCY);

    // Aggregate per-PP, per-judge
    const perPP = {};
    for (const r of results) {
        const k = r.pp.serial;
        if (!perPP[k]) perPP[k] = { serial: r.pp.serial, name: r.pp.name, scenarios: [], judgeCorrect: {} };
        perPP[k].scenarios.push(r);
        for (const judge of JUDGES) {
            const o = r.judges[judge.id] || {};
            perPP[k].judgeCorrect[judge.id] = (perPP[k].judgeCorrect[judge.id] || 0) + (o.correct ? 1 : 0);
        }
    }

    const perJudge = {};
    for (const judge of JUDGES) perJudge[judge.id] = { correct: 0, total: 0, errors: 0 };
    for (const r of results) {
        for (const judge of JUDGES) {
            const o = r.judges[judge.id] || {};
            perJudge[judge.id].total++;
            if (o.correct) perJudge[judge.id].correct++;
            if (o.verdict === 'ERR') perJudge[judge.id].errors++;
        }
    }

    const out = { guideline: guidelineTitle, completedAt: new Date().toISOString(), judges: JUDGES.map(j => j.id), perJudge, perPP: Object.values(perPP), results };
    fs.writeFileSync(OUTPUT, JSON.stringify(out, null, 2));

    // Markdown report
    const lines = [];
    lines.push(`# PP Scenario Eval — ${guidelineTitle}\n`);
    lines.push(`Generated: ${new Date().toISOString()}\n`);
    lines.push(`Judges: ${JUDGES.map(j => j.id).join(', ')}\n`);
    lines.push(`Scenarios: ${tasks.length} (${ppEntries.length} PPs × 10)\n`);
    lines.push(`\n## Overall accuracy per judge\n\n`);
    lines.push(`| Judge | Correct | Total | % | Errors |\n|---|---|---|---|---|\n`);
    for (const judge of JUDGES) {
        const p = perJudge[judge.id];
        lines.push(`| ${judge.id} | ${p.correct} | ${p.total} | ${Math.round(100*p.correct/p.total)}% | ${p.errors} |\n`);
    }
    lines.push(`\n## Per-PP — PPs where any judge scored <10/10\n\n`);
    lines.push(`| # | PP | ` + JUDGES.map(j=>j.id).join(' | ') + ` |\n`);
    lines.push(`|---|---|` + JUDGES.map(()=>'---').join('|') + `|\n`);
    Object.values(perPP).sort((a,b)=>a.serial-b.serial).forEach(pp=>{
        const cells = JUDGES.map(j=>pp.judgeCorrect[j.id]+'/10');
        const anyMiss = JUDGES.some(j=>pp.judgeCorrect[j.id]<10);
        if (anyMiss) lines.push(`| ${pp.serial} | ${pp.name.slice(0,80)} | ${cells.join(' | ')} |\n`);
    });
    lines.push(`\n## Per-PP — perfect scores\n\n`);
    Object.values(perPP).sort((a,b)=>a.serial-b.serial).forEach(pp=>{
        const allTen = JUDGES.every(j=>pp.judgeCorrect[j.id]===10);
        if (allTen) lines.push(`- #${pp.serial}: ${pp.name}\n`);
    });
    fs.writeFileSync(REPORT_MD, lines.join(''));

    console.log(`\n=== SUMMARY ===`);
    for (const judge of JUDGES) {
        const p = perJudge[judge.id];
        console.log(`${judge.id.padEnd(22)} ${p.correct}/${p.total} (${Math.round(100*p.correct/p.total)}%)  errors=${p.errors}`);
    }
    console.log(`\nJSON: ${OUTPUT}`);
    console.log(`Report: ${REPORT_MD}`);
})().catch(e => { console.error(e); process.exit(1); });
