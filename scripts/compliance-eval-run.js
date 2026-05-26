#!/usr/bin/env node
/**
 * Compliance-eval harness.
 *
 * For each of N guidelines (default: top 10 by practice-point count):
 *   1. Pick the guideline from Firestore.
 *   2. AI-generate a deliberately incomplete pre-refinement clinical note.
 *   3. (Stage 2) Drive Playwright through clerkyai.health, agent
 *      accepts/skips suggestions, capture the post-refinement note.
 *   4. (Stage 2) Judge LLM scores both notes against every practice point
 *      in that guideline (compliant / partial / no / na, with evidence).
 *   5. (Stage 3) Render a PDF report: cover page + one page per guideline.
 *
 * Flags:
 *   --limit=N            How many guidelines to run (default 10)
 *   --guidelines=id1,id2 Override the auto-pick with specific guideline IDs
 *   --dry-run            Skip agent + judge; just pick + generate pre-notes
 *   --out=path           Output JSON path (default tests/.compliance-eval-<ts>.json)
 *
 * Run:
 *   ANTHROPIC_API_KEY=sk-ant-... node scripts/compliance-eval-run.js --dry-run
 */

require('dotenv').config();

const path = require('path');
const fs = require('fs');
const admin = require('firebase-admin');

// ----- Config -------------------------------------------------------------
const REPO_ROOT = path.join(__dirname, '..');
const SA_PATH = path.join(REPO_ROOT, 'server', 'config', 'serviceAccountKey.json');
const DEFAULT_LIMIT = 10;
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_MODEL = process.env.COMPLIANCE_EVAL_MODEL || 'claude-sonnet-4-6';
const GEMINI_URL_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const GEMINI_MODEL = process.env.COMPLIANCE_EVAL_GEMINI_MODEL || 'gemini-2.5-flash';

// ----- CLI args -----------------------------------------------------------
function parseArgs(argv) {
    const out = { limit: DEFAULT_LIMIT, guidelines: null, dryRun: false, outPath: null };
    for (const a of argv.slice(2)) {
        if (a === '--dry-run') out.dryRun = true;
        else if (a.startsWith('--limit=')) out.limit = parseInt(a.split('=')[1], 10);
        else if (a.startsWith('--guidelines=')) out.guidelines = a.split('=')[1].split(',').map(s => s.trim()).filter(Boolean);
        else if (a.startsWith('--out=')) out.outPath = a.split('=')[1];
    }
    return out;
}

// ----- Firebase init ------------------------------------------------------
function initFirebase() {
    if (!fs.existsSync(SA_PATH)) {
        console.error(`Service account key not found at ${SA_PATH}`);
        process.exit(1);
    }
    admin.initializeApp({ credential: admin.credential.cert(require(SA_PATH)) });
    return admin.firestore();
}

// ----- Guideline picker ---------------------------------------------------

/**
 * Fetch all guidelines, return the top N by practice-point count.
 * If overrideIds is provided, fetch those specifically (preserves order).
 */
async function pickGuidelines(db, limit, overrideIds) {
    const snap = await db.collection('guidelines').get();
    const all = [];
    snap.forEach(doc => {
        const data = doc.data();
        const pps = Array.isArray(data.practicePoints) ? data.practicePoints : [];
        all.push({
            id: doc.id,
            title: data.displayName || data.humanFriendlyName || data.title || data.filename || doc.id,
            organisation: data.organisation || data.organization || '',
            ppCount: pps.length,
            practicePoints: pps,
        });
    });

    if (overrideIds && overrideIds.length) {
        const byId = new Map(all.map(g => [g.id, g]));
        const picked = overrideIds.map(id => byId.get(id)).filter(Boolean);
        const missing = overrideIds.filter(id => !byId.has(id));
        if (missing.length) console.warn(`Warning: guideline IDs not found in Firestore: ${missing.join(', ')}`);
        return picked;
    }

    return all
        .filter(g => g.ppCount > 0)
        .sort((a, b) => b.ppCount - a.ppCount)
        .slice(0, limit);
}

// ----- LLM helpers --------------------------------------------------------

function looksLikePlaceholder(k) {
    return !k || /your[_-]?(api[_-]?key|openai|anthropic|deepseek|google)/i.test(k);
}

async function callAnthropic(systemPrompt, userPrompt, maxTokens = 1024) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (looksLikePlaceholder(apiKey)) throw new Error('ANTHROPIC_API_KEY not set');

    const resp = await fetch(ANTHROPIC_URL, {
        method: 'POST',
        headers: {
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json',
        },
        body: JSON.stringify({
            model: ANTHROPIC_MODEL,
            max_tokens: maxTokens,
            system: systemPrompt,
            messages: [{ role: 'user', content: userPrompt }],
        }),
    });

    if (!resp.ok) {
        const txt = await resp.text();
        throw new Error(`Anthropic ${resp.status}: ${txt.slice(0, 300)}`);
    }
    const json = await resp.json();
    return json?.content?.[0]?.text || '';
}

async function callGemini(systemPrompt, userPrompt, maxTokens = 1024) {
    const apiKey = process.env.GOOGLE_AI_API_KEY;
    if (looksLikePlaceholder(apiKey)) throw new Error('GOOGLE_AI_API_KEY not set');

    const url = `${GEMINI_URL_BASE}/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
    const resp = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            systemInstruction: { parts: [{ text: systemPrompt }] },
            contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
            generationConfig: { temperature: 0.4, maxOutputTokens: maxTokens },
        }),
    });

    if (!resp.ok) {
        const txt = await resp.text();
        throw new Error(`Gemini ${resp.status}: ${txt.slice(0, 300)}`);
    }
    const json = await resp.json();
    return json?.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

async function callLLM(systemPrompt, userPrompt, maxTokens = 1024) {
    // Prefer Anthropic for note generation (matches doctor-brain.js pattern).
    // Fall back to Gemini if Anthropic key absent or fails.
    if (!looksLikePlaceholder(process.env.ANTHROPIC_API_KEY)) {
        try { return await callAnthropic(systemPrompt, userPrompt, maxTokens); }
        catch (e) {
            if (looksLikePlaceholder(process.env.GOOGLE_AI_API_KEY)) throw e;
            console.warn(`Anthropic failed (${e.message.slice(0, 80)}), falling back to Gemini`);
        }
    }
    return await callGemini(systemPrompt, userPrompt, maxTokens);
}

// ----- Pre-note generator -------------------------------------------------

const PRENOTE_SYSTEM = `You are a junior UK doctor writing a brief clinical note in your normal style. Your notes are realistic but, like every junior's, not perfectly complete against every guideline — you sometimes omit examinations, miss documentation of risk factors, forget to record specific monitoring, etc.

You write the kind of note a clinician on a busy shift would actually write: shorthand, abbreviations, sentence fragments are fine. Plain text only — no HTML, no markdown, no headings labelled "Pre-note". Just the body of the note.`;

function buildPrenotePrompt(guideline) {
    // Sample 3-5 practice points to seed the scenario without exhaustively
    // covering the guideline. We want the agent to have room to improve the
    // note; an already-compliant note has no headroom for comparison.
    const seedCount = Math.min(5, Math.max(3, Math.floor(guideline.ppCount / 4)));
    const seeds = sampleSeedPoints(guideline.practicePoints, seedCount);

    const seedsList = seeds.map((s, i) => `  ${i + 1}. ${s.name}`).join('\n');

    return `Write a brief clinical note for a patient where the following guideline is clinically relevant:

GUIDELINE: ${guideline.title}
${guideline.organisation ? `ORGANISATION: ${guideline.organisation}\n` : ''}
The note should describe a single patient encounter (admission, review, or assessment) where this guideline applies. Pick a realistic clinical scenario consistent with the guideline.

To anchor the scenario, here are SOME of the practice points from this guideline — your note should describe a patient to whom several of these are relevant, but you should deliberately leave gaps (omit details, miss documentation, forget some elements). Don't try to be comprehensive:

${seedsList}

Write 6-12 lines of clinical note text in plain prose / shorthand. Realistic British clinical style. No HTML. No section labels at the top. Just the note itself.`;
}

function sampleSeedPoints(practicePoints, n) {
    const copy = [...practicePoints];
    const out = [];
    while (out.length < n && copy.length) {
        const idx = Math.floor(Math.random() * copy.length);
        out.push(copy.splice(idx, 1)[0]);
    }
    return out;
}

async function generatePreNote(guideline) {
    const text = await callLLM(PRENOTE_SYSTEM, buildPrenotePrompt(guideline), 1200);
    return text.trim();
}

// ----- Main ---------------------------------------------------------------

async function main() {
    const args = parseArgs(process.argv);
    const db = initFirebase();

    console.log('=== Compliance-eval harness ===');
    console.log(`Mode: ${args.dryRun ? 'DRY-RUN (picker + pre-notes only)' : 'FULL (not yet implemented — coming in stage 2)'}`);
    console.log('');

    // 1. Pick guidelines
    console.log(args.guidelines
        ? `Picking ${args.guidelines.length} guideline(s) by ID override`
        : `Picking top ${args.limit} guideline(s) by practice-point count`);
    const guidelines = await pickGuidelines(db, args.limit, args.guidelines);

    if (guidelines.length === 0) {
        console.error('No guidelines picked — aborting.');
        process.exit(1);
    }

    console.log('\nPicked:');
    guidelines.forEach((g, i) => {
        console.log(`  ${i + 1}. [${g.ppCount} PPs] ${g.title}  (${g.id})`);
    });
    console.log('');

    // 2. Generate pre-notes
    console.log('Generating pre-refinement notes...');
    const scenarios = [];
    for (const [i, g] of guidelines.entries()) {
        process.stdout.write(`  [${i + 1}/${guidelines.length}] ${g.id} ... `);
        try {
            const preNote = await generatePreNote(g);
            scenarios.push({
                guidelineId: g.id,
                guidelineTitle: g.title,
                organisation: g.organisation,
                ppCount: g.ppCount,
                practicePoints: g.practicePoints,
                preNote,
                postNote: null,        // filled by stage 2
                scoring: null,         // filled by stage 2
            });
            console.log(`OK (${preNote.length} chars)`);
        } catch (e) {
            console.log(`FAILED: ${e.message.slice(0, 120)}`);
            scenarios.push({
                guidelineId: g.id,
                guidelineTitle: g.title,
                organisation: g.organisation,
                ppCount: g.ppCount,
                practicePoints: g.practicePoints,
                preNote: null,
                preNoteError: e.message,
                postNote: null,
                scoring: null,
            });
        }
    }

    // 3. Save
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const outPath = args.outPath || path.join(REPO_ROOT, 'tests', `.compliance-eval-${ts}.json`);
    const result = {
        startedAt: new Date().toISOString(),
        stage: args.dryRun ? 'dry-run' : 'full',
        modelUsed: ANTHROPIC_MODEL,
        scenarioCount: scenarios.length,
        scenarios,
    };
    fs.writeFileSync(outPath, JSON.stringify(result, null, 2));
    console.log(`\nWrote ${outPath}`);

    // 4. Print a preview of the pre-notes so the user can sanity-check
    console.log('\n=== PRE-NOTE PREVIEWS ===');
    for (const s of scenarios) {
        console.log(`\n--- ${s.guidelineTitle} (${s.guidelineId}) ---`);
        if (s.preNote) {
            const preview = s.preNote.split('\n').slice(0, 4).join('\n');
            console.log(preview + (s.preNote.split('\n').length > 4 ? '\n...' : ''));
        } else {
            console.log(`[ERROR] ${s.preNoteError}`);
        }
    }

    if (!args.dryRun) {
        console.log('\n[stage 2/3 not yet implemented — re-run with --dry-run for now]');
    }

    await admin.app().delete();
    process.exit(0);
}

main().catch(err => {
    console.error('FATAL:', err);
    process.exit(1);
});
