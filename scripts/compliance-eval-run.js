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
const { chromium } = require('playwright');

// ----- Config -------------------------------------------------------------
const REPO_ROOT = path.join(__dirname, '..');
const SA_PATH = path.join(REPO_ROOT, 'server', 'config', 'serviceAccountKey.json');
const AUTH_STATE_PATH = path.join(REPO_ROOT, 'tests', '.auth', 'state.json');
const DEFAULT_LIMIT = 10;
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_MODEL = process.env.COMPLIANCE_EVAL_MODEL || 'claude-sonnet-4-6';
const GEMINI_URL_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const GEMINI_MODEL = process.env.COMPLIANCE_EVAL_GEMINI_MODEL || 'gemini-2.5-flash';

// Playwright timing
const WIZARD_TIMEOUT = 90_000;
const PHASE_TIMEOUT = 180_000;
const PER_NOTE_CAP_MS = 12 * 60 * 1000;
const TOTAL_TIME_CAP_MS = 3 * 60 * 60 * 1000;
const ACTION_DELAY = 400;

// Judge tuning
const JUDGE_CONFIDENCE_FLOOR = 0.6; // verdicts below this go into reviewQueue
const JUDGE_MAX_CONCURRENCY = 4;    // parallel judge calls per note

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

// ----- Playwright helpers -------------------------------------------------

async function typeIntoEditor(page, text) {
    await page.evaluate((content) => {
        const editor = window.editors?.userInput;
        if (editor) {
            editor.commands.setContent(`<p>${content.replace(/\n/g, '</p><p>')}</p>`);
        } else {
            const el = document.querySelector('#userInput .ProseMirror');
            if (el) el.innerHTML = `<p>${content.replace(/\n/g, '</p><p>')}</p>`;
        }
    }, text);
    const editor = page.locator('#userInput .ProseMirror');
    await editor.click();
    await page.keyboard.press('End');
    await page.keyboard.type(' ');
    await page.keyboard.press('Backspace');
}

async function getNoteContent(page) {
    return page.evaluate(() => {
        const editor = window.editors?.userInput;
        if (editor) return editor.getText();
        const el = document.querySelector('#userInput .ProseMirror');
        return el ? el.textContent : '';
    });
}

async function isWizardVisible(page) {
    return page.locator('#wizardPanel').isVisible().catch(() => false);
}

async function captureWizardState(page) {
    return page.evaluate(() => {
        const s = window.suggestionWizardState;
        if (!s || !s.queue || s.currentIndex >= s.queue.length) return null;
        const current = s.queue[s.currentIndex];
        let safe;
        try { safe = JSON.parse(JSON.stringify(current)); } catch (e) { safe = {}; }
        return {
            index: s.currentIndex,
            total: s.total || s.queue.length,
            current: safe,
        };
    });
}

async function waitForWizardAdvance(page, prevIndex, timeoutMs = 8000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        const scope = await page.locator('#guidelineScopeModal').isVisible().catch(() => false);
        if (scope) return 'phase-ended';
        const cp = await page.locator('#checkpoint-analyse-btn').isVisible().catch(() => false);
        if (cp) return 'phase-ended';
        const wizardVisible = await isWizardVisible(page);
        if (!wizardVisible) return 'closed';
        const idx = await page.evaluate(() => {
            const s = window.suggestionWizardState;
            if (!s || !s.queue) return null;
            if (s.currentIndex >= s.queue.length) return -1;
            return s.currentIndex;
        }).catch(() => null);
        if (idx === -1) return 'closed';
        if (idx !== null && idx !== prevIndex) return 'advanced';
        await page.waitForTimeout(150);
    }
    return 'timeout';
}

async function clickAccept(page) {
    // Accept button is the last button in the wizard footer
    const btn = page.locator('.sw-footer button').last();
    try { await btn.waitFor({ state: 'visible', timeout: 4000 }); }
    catch { return false; }
    if (!await btn.isEnabled().catch(() => false)) return false;
    await btn.click();
    return true;
}

async function clickSkip(page) {
    const btn = page.locator('button:has-text("Skip")').first();
    try { await btn.waitFor({ state: 'visible', timeout: 4000 }); }
    catch { return false; }
    await btn.click();
    return true;
}

async function dismissCookieBanner(page) {
    const banner = page.locator('#cookie-consent-banner button:has-text("Reject Non-Essential")').first();
    if (await banner.isVisible().catch(() => false)) {
        await banner.click();
        await page.waitForTimeout(300);
    }
}

async function handleScopeModal(page, log) {
    const modal = page.locator('#guidelineScopeModal');
    if (!await modal.isVisible().catch(() => false)) return false;
    log('Scope modal — picking National');
    const btn = modal.locator('button:has-text("National")').first();
    if (await btn.isVisible().catch(() => false)) await btn.click();
    else await modal.locator('button').first().click();
    await page.waitForTimeout(800);
    return true;
}

/**
 * At the checkpoint modal, select ONLY the guideline whose id or title matches.
 * The checkpoint UI uses the guideline title for display, so we match on
 * either the exact id (data-attr if present) or a regex against the title.
 */
async function selectOnlyGuideline(page, guidelineId, guidelineTitle, log) {
    const ready = await page.locator('#checkpoint-analyse-btn')
        .waitFor({ state: 'visible', timeout: 60_000 })
        .then(() => true).catch(() => false);
    if (!ready) return false;

    log(`Checkpoint modal visible — selecting "${guidelineTitle}"`);

    const matched = await page.evaluate(({ id, titlePattern }) => {
        const titleRe = new RegExp(titlePattern, 'i');
        const rows = Array.from(document.querySelectorAll('.checkpoint-guidelines-list > div'));
        const matchedTitles = [];
        rows.forEach(row => {
            const cb = row.querySelector('.checkpoint-cb');
            if (!cb) return;
            const titleSpan = row.querySelector('span');
            const title = titleSpan?.textContent?.trim() || '';
            const rowId = row.dataset?.guidelineId || row.dataset?.id || '';
            const isMatch = (id && rowId === id) || titleRe.test(title);
            cb.checked = isMatch;
            if (isMatch) matchedTitles.push(title);
        });
        const anyCb = document.querySelector('.checkpoint-cb');
        if (anyCb) anyCb.dispatchEvent(new Event('change', { bubbles: true }));
        return matchedTitles;
    }, { id: guidelineId, titlePattern: escapeRegex(guidelineTitle) });

    log(`Matched ${matched.length} row(s): ${matched.slice(0, 3).join(' | ')}`);

    if (matched.length === 0) {
        log('No matching guideline in checkpoint — clicking Cancel');
        await page.evaluate(() => {
            const btn = document.getElementById('checkpoint-cancel-btn');
            if (btn) btn.click();
        });
        return false;
    }

    await page.evaluate(() => {
        const btn = document.getElementById('checkpoint-analyse-btn');
        if (btn) btn.click();
    });
    await page.locator('#guidelineCheckpointModal').waitFor({ state: 'hidden', timeout: 10_000 }).catch(() => {});
    return true;
}

function escapeRegex(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function dismissSummaryModal(page) {
    const btn = page.locator('button[class*="primary"], .btn-primary, button:has-text("Done"), button:has-text("Continue"), button:has-text("Close")').first();
    if (await btn.isVisible().catch(() => false)) {
        await btn.click();
        await page.waitForTimeout(600);
    }
}

// ----- Agent loop ---------------------------------------------------------

/**
 * Drive Clerky for one scenario.
 *
 * Design decision: Phase 1 (completeness) suggestions are SKIPPED in this
 * harness. Reasoning: we are measuring whether Clerky's guideline-driven
 * refinements lift compliance against practice points. Phase 1 asks the user
 * to fill in missing data points (BP, age, etc.) — accepting those would
 * inject content the agent has to invent, which adds noise that isn't about
 * Clerky's capability. Phase 2 guideline suggestions are accepted in bulk to
 * give Clerky maximum opportunity to lift the note.
 *
 * If we later want to model "doctor in the loop" behaviour, gate this with
 * a --phase1=accept|decide flag and reuse doctor-brain's decideCompleteness.
 */
async function runScenarioThroughClerky(page, scenario, log) {
    await page.goto('https://clerkyai.health/', { waitUntil: 'load' });
    const editorReady = await page.locator('#userInput .ProseMirror')
        .waitFor({ state: 'visible', timeout: 30_000 })
        .then(() => true).catch(() => false);
    if (!editorReady) return { status: 'auth-expired', postNote: null };

    await dismissCookieBanner(page);
    await typeIntoEditor(page, scenario.preNote);
    await page.waitForTimeout(700);

    const typed = await getNoteContent(page);
    log(`Note typed (${typed.length} chars)`);

    await page.locator('#analyseNoteBtn').click();
    log('Clicked Analyse');

    // Phase 1: race between wizard, scope modal, and checkpoint button
    const phase1Outcome = await Promise.race([
        page.locator('#wizardPanel').waitFor({ state: 'visible', timeout: WIZARD_TIMEOUT }).then(() => 'wizard'),
        page.locator('#guidelineScopeModal').waitFor({ state: 'visible', timeout: WIZARD_TIMEOUT }).then(() => 'scope'),
        page.locator('#checkpoint-analyse-btn').waitFor({ state: 'visible', timeout: WIZARD_TIMEOUT }).then(() => 'checkpoint'),
    ]).catch(() => 'timeout');
    log(`Phase 1 outcome: ${phase1Outcome}`);

    if (phase1Outcome === 'wizard') {
        let skipped = 0;
        const maxSkip = 40;
        while (await isWizardVisible(page) && skipped < maxSkip) {
            const scopeNow = await page.locator('#guidelineScopeModal').isVisible().catch(() => false);
            if (scopeNow) break;
            const cpNow = await page.locator('#checkpoint-analyse-btn').isVisible().catch(() => false);
            if (cpNow) break;
            const snap = await captureWizardState(page);
            if (!snap) { await page.waitForTimeout(700); continue; }
            const prevIdx = snap.index;
            if (!await clickSkip(page)) break;
            const adv = await waitForWizardAdvance(page, prevIdx, 8000);
            if (adv === 'closed' || adv === 'phase-ended') break;
            if (adv === 'timeout') break;
            skipped++;
            await page.waitForTimeout(200);
        }
        log(`Skipped ${skipped} completeness suggestions`);
    }

    await handleScopeModal(page, log);

    const selected = await selectOnlyGuideline(page, scenario.guidelineId, scenario.guidelineTitle, log);
    if (!selected) return { status: 'no-guideline-match', postNote: null };

    await dismissSummaryModal(page);

    // Phase 2: guideline suggestions — accept everything to maximise refinement
    await page.waitForTimeout(2500);
    const phase2Visible = await page.locator('#wizardPanel')
        .waitFor({ state: 'visible', timeout: PHASE_TIMEOUT })
        .then(() => true).catch(() => false);

    let accepted = 0;
    if (phase2Visible) {
        log('Phase 2 wizard visible — accepting suggestions');
        const seen = new Set();
        const maxIter = 80;
        let iter = 0;
        const startedAt = Date.now();
        while (await isWizardVisible(page) && iter < maxIter) {
            iter++;
            if (Date.now() - startedAt > PER_NOTE_CAP_MS) {
                log('Per-note cap exceeded — stopping');
                break;
            }
            const snap = await captureWizardState(page);
            if (!snap) { await page.waitForTimeout(700); continue; }
            const key = `${snap.index}|${(snap.current?.suggestion || snap.current?.text || '').slice(0, 80)}`;
            if (seen.has(key)) {
                if (!await clickSkip(page)) break;
                await waitForWizardAdvance(page, snap.index, 6000);
                continue;
            }
            seen.add(key);

            const prevIdx = snap.index;
            // Try Accept first; if it doesn't advance, fall back to Skip so we don't deadlock
            const acceptOk = await clickAccept(page);
            let adv = acceptOk
                ? await waitForWizardAdvance(page, prevIdx, 8000)
                : 'timeout';
            if (adv === 'timeout' || !acceptOk) {
                if (!await clickSkip(page)) break;
                adv = await waitForWizardAdvance(page, prevIdx, 8000);
            } else {
                accepted++;
            }
            if (adv === 'closed' || adv === 'phase-ended') break;
            await page.waitForTimeout(ACTION_DELAY);
        }
        log(`Phase 2 done: ${accepted} accepted (or auto-skipped on stuck)`);
    } else {
        log('Phase 2 wizard never appeared');
    }

    // Wait for the Analyse button to come back (signals end of pipeline)
    await page.locator('#analyseNoteBtn .btn-text:has-text("Analyse Note")')
        .waitFor({ state: 'visible', timeout: PHASE_TIMEOUT })
        .catch(() => {});

    const postNote = await getNoteContent(page);
    return { status: 'ok', postNote, phase2Accepted: accepted };
}

// ----- Judge --------------------------------------------------------------

const JUDGE_SYSTEM = `You are a senior UK clinician auditing a clinical note for compliance with a single practice point from a clinical guideline. You are precise and you do not invent content that isn't in the note.

For the given practice point you must decide:

1. Is the practice point APPLICABLE to this patient? Many practice points are conditional ("If patient is Rh-negative, do X"). If the note does not establish the triggering condition, the point may be not applicable — but be honest about uncertainty.

2. If applicable, is the note COMPLIANT? Compliance means either:
   - The required action is documented as having been done, OR
   - The required action was actively considered and reasoned out as not indicated for this patient (e.g. "anti-D not given — Rh positive"). Active reasoned consideration counts as compliance.
   - Silence is NOT compliance. If the action might have been done but isn't documented, that's "no".

3. Cite EVIDENCE — a verbatim quote from the note that supports your verdict, if any. Use the exact words from the note.

Return strict JSON only. No prose around it.`;

function buildJudgePrompt(note, pp, guidelineTitle) {
    const ppText = pp.name || pp.title || pp.text || '';
    return `GUIDELINE: ${guidelineTitle}

PRACTICE POINT #${pp.serial || '?'}:
${ppText}

CLINICAL NOTE:
${note}

Return JSON in this exact shape:
{
  "applicable": true | false,
  "applicability_reason": "<1 sentence: why this practice point does or doesn't apply to this patient>",
  "compliant": "yes" | "partial" | "no" | "na",
  "evidence": "<verbatim quote from the note supporting compliance, or empty string>",
  "reason": "<1-2 sentences explaining the verdict>",
  "confidence": 0.0
}

Rules:
- If applicable is false, set compliant to "na".
- "yes" = action documented as done, OR actively considered and reasoned out as not indicated.
- "partial" = action partially documented or hinted at but not unambiguously complete.
- "no" = action not mentioned at all, despite being applicable.
- Set confidence below 0.6 when you genuinely cannot tell — do not guess.`;
}

function parseJudgeJSON(text) {
    const cleaned = (text || '').trim().replace(/^```json\s*/i, '').replace(/```\s*$/, '');
    try { return JSON.parse(cleaned); } catch (_) {}
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start !== -1 && end > start) {
        try { return JSON.parse(cleaned.slice(start, end + 1)); } catch (_) {}
    }
    return null;
}

async function callJudge(systemPrompt, userPrompt) {
    // Prefer Gemini (cheap, deterministic at temp 0) — falls back to Anthropic if unavailable.
    if (!looksLikePlaceholder(process.env.GOOGLE_AI_API_KEY)) {
        const url = `${GEMINI_URL_BASE}/${GEMINI_MODEL}:generateContent?key=${process.env.GOOGLE_AI_API_KEY}`;
        const resp = await fetch(url, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                systemInstruction: { parts: [{ text: systemPrompt }] },
                contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
                generationConfig: { temperature: 0, topP: 0.1, maxOutputTokens: 1500 },
            }),
        });
        if (!resp.ok) throw new Error(`Gemini judge ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
        const json = await resp.json();
        return json?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    }
    if (!looksLikePlaceholder(process.env.ANTHROPIC_API_KEY)) {
        return await callAnthropic(systemPrompt, userPrompt, 1500);
    }
    throw new Error('No judge LLM API key available');
}

async function judgePracticePoint(note, pp, guidelineTitle) {
    if (!note || !note.trim()) {
        return {
            applicable: false,
            applicability_reason: 'No note provided',
            compliant: 'na',
            evidence: '',
            reason: 'Note is empty',
            confidence: 1.0,
            _error: 'empty-note',
        };
    }
    try {
        const text = await callJudge(JUDGE_SYSTEM, buildJudgePrompt(note, pp, guidelineTitle));
        const parsed = parseJudgeJSON(text);
        if (!parsed) {
            return {
                applicable: null, compliant: 'no', evidence: '', reason: 'Judge response unparseable',
                confidence: 0, _error: 'parse-failed', _raw: text.slice(0, 300),
            };
        }
        // Normalise
        parsed.compliant = String(parsed.compliant || 'no').toLowerCase();
        if (!['yes', 'partial', 'no', 'na'].includes(parsed.compliant)) parsed.compliant = 'no';
        parsed.confidence = typeof parsed.confidence === 'number' ? parsed.confidence : 0;
        return parsed;
    } catch (e) {
        return {
            applicable: null, compliant: 'no', evidence: '', reason: `Judge call failed: ${e.message.slice(0, 120)}`,
            confidence: 0, _error: 'call-failed',
        };
    }
}

/**
 * Score a note against every practice point in a guideline.
 * Runs judge calls with bounded concurrency to control rate-limits.
 */
async function scoreNote(note, practicePoints, guidelineTitle, label, log) {
    const results = new Array(practicePoints.length);
    let cursor = 0;

    async function worker() {
        while (true) {
            const i = cursor++;
            if (i >= practicePoints.length) return;
            const pp = practicePoints[i];
            const r = await judgePracticePoint(note, pp, guidelineTitle);
            results[i] = { serial: pp.serial || (i + 1), ppText: pp.name || pp.title || '', ...r };
            if (i === 0 || (i + 1) % 5 === 0 || i === practicePoints.length - 1) {
                log(`    ${label}: judged ${i + 1}/${practicePoints.length}`);
            }
        }
    }

    const workers = Array.from({ length: Math.min(JUDGE_MAX_CONCURRENCY, practicePoints.length) }, worker);
    await Promise.all(workers);

    return aggregateScore(results);
}

function aggregateScore(perPP) {
    const applicable = perPP.filter(r => r.applicable !== false);
    const compliantCount = applicable.filter(r => r.compliant === 'yes').length;
    const partialCount = applicable.filter(r => r.compliant === 'partial').length;
    const nonCompliantCount = applicable.filter(r => r.compliant === 'no').length;
    const naCount = perPP.length - applicable.length;
    const lowConfidence = perPP.filter(r => (r.confidence || 0) < JUDGE_CONFIDENCE_FLOOR);
    // Score: compliant = 1.0, partial = 0.5, no = 0. Out of total applicable.
    const denom = applicable.length || 1;
    const score = (compliantCount + 0.5 * partialCount) / denom;
    return {
        perPP,
        applicableCount: applicable.length,
        compliantCount,
        partialCount,
        nonCompliantCount,
        naCount,
        lowConfidenceCount: lowConfidence.length,
        score, // 0..1
        scorePercent: Math.round(score * 100),
    };
}

// ----- Auth refresh self-heal --------------------------------------------

function refreshAuthIfPossible() {
    try {
        console.log('Refreshing Playwright auth state before run...');
        require('child_process').execSync('node scripts/refresh-playwright-auth.js', {
            cwd: REPO_ROOT,
            stdio: 'inherit',
        });
    } catch (e) {
        console.log('Auth refresh failed (continuing with existing state):', e.message);
    }
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

    // 3. Save initial state (so the JSON exists even if a later stage crashes)
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const outPath = args.outPath || path.join(REPO_ROOT, 'tests', `.compliance-eval-${ts}.json`);
    const result = {
        startedAt: new Date().toISOString(),
        stage: args.dryRun ? 'dry-run' : 'full',
        modelUsed: ANTHROPIC_MODEL,
        judgeModel: GEMINI_MODEL,
        scenarioCount: scenarios.length,
        scenarios,
        reviewQueue: [],
        overall: null,
    };
    fs.writeFileSync(outPath, JSON.stringify(result, null, 2));
    console.log(`\nWrote ${outPath}`);

    // 4. Pre-note preview (sanity-check)
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

    if (args.dryRun) {
        await admin.app().delete();
        process.exit(0);
        return;
    }

    // 5. Agent loop + judge — full mode only
    if (!fs.existsSync(AUTH_STATE_PATH)) {
        console.error(`\nNo Playwright auth state at ${AUTH_STATE_PATH}.`);
        console.error('Run a manual login first, then retry. Aborting agent phase.');
        await admin.app().delete();
        process.exit(1);
    }

    refreshAuthIfPossible();

    console.log('\n=== AGENT + JUDGE PHASE ===');
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ storageState: AUTH_STATE_PATH });
    const page = await context.newPage();
    page.on('pageerror', e => console.log('  [pageerror]', e.message));

    const runStart = Date.now();
    let abortReason = null;

    for (const [i, scenario] of scenarios.entries()) {
        const log = (m) => console.log(`  [${scenario.guidelineId}] ${m}`);
        console.log(`\n[${i + 1}/${scenarios.length}] ${scenario.guidelineTitle}`);

        if (Date.now() - runStart > TOTAL_TIME_CAP_MS) {
            abortReason = 'total-time-cap';
            log('Total time cap reached — stopping');
            break;
        }
        if (!scenario.preNote) {
            log('No pre-note (generation failed earlier) — skipping');
            continue;
        }

        // 5a. Drive agent through Clerky
        let agentResult;
        try {
            agentResult = await runScenarioThroughClerky(page, scenario, log);
        } catch (e) {
            log(`Agent run failed: ${e.message.slice(0, 150)}`);
            agentResult = { status: 'agent-error', postNote: null, error: e.message };
        }
        scenario.agentStatus = agentResult.status;
        scenario.postNote = agentResult.postNote;
        scenario.phase2Accepted = agentResult.phase2Accepted || 0;

        if (agentResult.status === 'auth-expired') {
            abortReason = 'auth-expired';
            log('Auth state appears expired — aborting run');
            break;
        }

        // 5b. Score both notes
        log('Scoring pre-note...');
        try {
            scenario.preScore = await scoreNote(scenario.preNote, scenario.practicePoints, scenario.guidelineTitle, 'pre', log);
            log(`  Pre score: ${scenario.preScore.scorePercent}% (${scenario.preScore.compliantCount}/${scenario.preScore.applicableCount} applicable)`);
        } catch (e) {
            log(`Pre-score failed: ${e.message}`);
            scenario.preScore = { error: e.message };
        }

        if (scenario.postNote) {
            log('Scoring post-note...');
            try {
                scenario.postScore = await scoreNote(scenario.postNote, scenario.practicePoints, scenario.guidelineTitle, 'post', log);
                log(`  Post score: ${scenario.postScore.scorePercent}% (${scenario.postScore.compliantCount}/${scenario.postScore.applicableCount} applicable)`);
                if (scenario.preScore && !scenario.preScore.error) {
                    const delta = scenario.postScore.scorePercent - scenario.preScore.scorePercent;
                    log(`  Δ = ${delta >= 0 ? '+' : ''}${delta} percentage points`);
                }
            } catch (e) {
                log(`Post-score failed: ${e.message}`);
                scenario.postScore = { error: e.message };
            }
        } else {
            log('No post-note (agent failed) — skipping post-score');
            scenario.postScore = null;
        }

        // 5c. Build reviewQueue entries for low-confidence verdicts
        for (const phase of ['preScore', 'postScore']) {
            const s = scenario[phase];
            if (!s || !s.perPP) continue;
            for (const r of s.perPP) {
                if ((r.confidence || 0) < JUDGE_CONFIDENCE_FLOOR) {
                    result.reviewQueue.push({
                        guidelineId: scenario.guidelineId,
                        guidelineTitle: scenario.guidelineTitle,
                        phase: phase === 'preScore' ? 'pre' : 'post',
                        ppSerial: r.serial,
                        ppText: r.ppText,
                        verdict: r.compliant,
                        confidence: r.confidence,
                        reason: r.reason,
                    });
                }
            }
        }

        // 5d. Save incrementally so a crash doesn't lose progress
        fs.writeFileSync(outPath, JSON.stringify(result, null, 2));
    }

    await browser.close();

    // 6. Overall aggregate
    const valid = scenarios.filter(s => s.preScore && !s.preScore.error && s.postScore && !s.postScore.error);
    if (valid.length > 0) {
        const avgPre = valid.reduce((a, s) => a + s.preScore.scorePercent, 0) / valid.length;
        const avgPost = valid.reduce((a, s) => a + s.postScore.scorePercent, 0) / valid.length;
        result.overall = {
            scenariosWithBothScores: valid.length,
            averagePreScorePercent: Math.round(avgPre),
            averagePostScorePercent: Math.round(avgPost),
            averageDeltaPercent: Math.round(avgPost - avgPre),
            totalReviewQueueEntries: result.reviewQueue.length,
        };
    }
    result.completedAt = new Date().toISOString();
    result.aborted = !!abortReason;
    result.abortReason = abortReason;
    fs.writeFileSync(outPath, JSON.stringify(result, null, 2));

    console.log('\n=== SUMMARY ===');
    if (result.overall) {
        console.log(`Scenarios scored: ${result.overall.scenariosWithBothScores}/${scenarios.length}`);
        console.log(`Avg pre-score:  ${result.overall.averagePreScorePercent}%`);
        console.log(`Avg post-score: ${result.overall.averagePostScorePercent}%`);
        console.log(`Avg delta:      ${result.overall.averageDeltaPercent >= 0 ? '+' : ''}${result.overall.averageDeltaPercent}pp`);
        console.log(`Review queue:   ${result.overall.totalReviewQueueEntries} low-confidence verdicts for adjudication`);
    } else {
        console.log('No scenarios produced both pre- and post-scores.');
    }
    if (abortReason) console.log(`Aborted: ${abortReason}`);
    console.log(`Full results: ${outPath}`);
    console.log('\n[stage 3 — PDF report — not yet implemented]');

    await admin.app().delete();
    process.exit(0);
}

main().catch(err => {
    console.error('FATAL:', err);
    process.exit(1);
});
