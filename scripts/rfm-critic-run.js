#!/usr/bin/env node
/**
 * RFM consultant-critic agent.
 *
 * For each RFM scenario:
 *  - Drives a headless Playwright browser against https://clerkyai.health
 *  - Pastes the note, clicks Analyse Note
 *  - Skips every completeness suggestion (we only care about guideline phase)
 *  - In Phase 2, selects only the RFM guideline at the checkpoint modal
 *  - For each guideline suggestion, asks Claude (the "consultant critic")
 *    whether the suggestion is clinically appropriate given THIS note
 *  - If the critic flags a genuine clinical concern, submits feedback via
 *    the wizard's Feedback button (real UI path — not direct Firestore write)
 *
 * The critic is told to look for the same kinds of concerns a UK consultant
 * actually voiced when reviewing VBAC suggestions:
 *   - Wrong gestation/pathway/timing
 *   - Already documented in the note
 *   - Assumes facts not in the note
 *   - Verbatim quote doesn't support the suggestion
 *   - Wrong section placement
 *   - Unsafe or unnatural wording
 * It IGNORES mechanical issues (bundling, US spellings, etc.).
 *
 * Run:
 *   ANTHROPIC_API_KEY=sk-ant-... node scripts/rfm-critic-run.js
 */

require('dotenv').config();

const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');
const admin = require('firebase-admin');
const { SCENARIOS } = require('./rfm-scenarios');

// ----- Config -------------------------------------------------------------
const REPO_ROOT = path.join(__dirname, '..');
const AUTH_STATE_PATH = path.join(REPO_ROOT, 'tests', '.auth', 'state.json');
const SUMMARY_PATH = path.join(REPO_ROOT, 'tests', '.rfm-critic-summary.json');
const RAW_LOG_PATH = path.join(REPO_ROOT, 'tests', '.rfm-critic-raw.json');

const WIZARD_TIMEOUT = 90_000;
const PHASE_TIMEOUT = 180_000;
const PER_NOTE_CAP_MS = 12 * 60 * 1000;
const TOTAL_TIME_CAP_MS = 3 * 60 * 60 * 1000;
const ACTION_DELAY = 600;

const RFM_GUIDELINE_TITLE_MATCH = /reduced fetal movement/i;
const OPENAI_MODEL = process.env.RFM_CRITIC_MODEL || 'gpt-4o';
const ANTHROPIC_MODEL = 'claude-sonnet-4-6';
const CRITIC_MAX_TOKENS = 800;

// ----- Firebase admin init ------------------------------------------------
const serviceAccount = require(path.join(REPO_ROOT, 'server', 'config', 'serviceAccountKey.json'));
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

// ----- Anthropic critic ---------------------------------------------------

const CRITIC_SYSTEM = `You are a senior UK obstetric consultant reviewing AI-generated suggestions for a clinical note about reduced fetal movements (RFM). You read carefully and you are sceptical, but fair.

You are evaluating clinical appropriateness, accuracy, and safety — NOT mechanical or structural issues. Specifically:

You FLAG genuine clinical concerns:
- The suggestion's premise doesn't match this patient (wrong gestation, wrong episode number, wrong pathway, wrong risk profile, action premised on something the note neither documents nor plans)
- What the suggestion asks for is already documented in the note (the system should have recognised it as done)
- The suggestion asserts or assumes a patient fact that isn't in the note
- The verbatim quote from the guideline doesn't actually support this specific recommendation
- The suggestion would be placed in the wrong section (e.g., a future action ending up in Examination, a finding ending up in Plan)
- The suggested wording is clinically unnatural — not how a UK consultant would write it
- The suggestion is unsafe or omits a critical consideration

You DO NOT flag:
- "This bundles two things" or other structural critiques
- US vs UK spellings
- Capitalisation, punctuation, formatting
- Tonal preferences
- The fact that other things could also have been suggested
- Anything a clinician would shrug at

If the suggestion is clinically sound for this patient, even if not perfectly worded, you say so. Your job is to find the suggestions a working consultant would actually push back on.

Return strict JSON, no surrounding text.`;

function buildCriticPrompt(note, suggestion) {
    const fields = [];
    fields.push(`SUGGESTION TEXT: ${suggestion.suggestion || suggestion.text || ''}`);
    if (suggestion.why) fields.push(`WHY (per system): ${suggestion.why}`);
    if (suggestion.verbatimQuote) fields.push(`VERBATIM QUOTE FROM GUIDELINE: "${suggestion.verbatimQuote}"`);
    if (suggestion.originalText) fields.push(`ORIGINAL TEXT TO REPLACE: "${suggestion.originalText}"`);
    if (suggestion.target_section) fields.push(`TARGET SECTION: ${suggestion.target_section}`);
    if (suggestion.practicePointNumber) fields.push(`PRACTICE POINT #: ${suggestion.practicePointNumber}`);

    return `CLINICAL NOTE:
${note}

AI SUGGESTION:
${fields.join('\n')}

Evaluate this suggestion against the note.

Return JSON in this exact shape:
{
  "has_issue": true|false,
  "issue_type": "wrong_pathway_or_gestation"|"already_documented"|"assumes_undocumented_fact"|"verbatim_quote_irrelevant"|"wrong_placement"|"unsafe"|"unnatural_wording"|"other"|"none",
  "explanation": "<clinical critique a consultant would write — 1-3 sentences, specific to what's wrong with THIS suggestion for THIS patient. Quote the relevant line from the note if useful>",
  "severity": "minor"|"moderate"|"serious"
}

If has_issue is false, set issue_type to "none" and explanation to "" and severity to "minor".`;
}

async function askCriticOpenAI(note, suggestion) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error('OPENAI_API_KEY not set');

    const body = {
        model: OPENAI_MODEL,
        max_tokens: CRITIC_MAX_TOKENS,
        temperature: 0.2,
        response_format: { type: 'json_object' },
        messages: [
            { role: 'system', content: CRITIC_SYSTEM },
            { role: 'user', content: buildCriticPrompt(note, suggestion) }
        ],
    };

    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
            'authorization': `Bearer ${apiKey}`,
            'content-type': 'application/json',
        },
        body: JSON.stringify(body),
    });

    if (!resp.ok) {
        const txt = await resp.text();
        throw new Error(`OpenAI ${resp.status}: ${txt.substring(0, 200)}`);
    }
    const json = await resp.json();
    const text = json?.choices?.[0]?.message?.content || '';
    return parseCriticJSON(text);
}

async function askCriticAnthropic(note, suggestion) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');

    const body = {
        model: ANTHROPIC_MODEL,
        max_tokens: CRITIC_MAX_TOKENS,
        system: CRITIC_SYSTEM,
        messages: [{ role: 'user', content: buildCriticPrompt(note, suggestion) }],
    };

    const resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json',
        },
        body: JSON.stringify(body),
    });

    if (!resp.ok) {
        const txt = await resp.text();
        throw new Error(`Anthropic ${resp.status}: ${txt.substring(0, 200)}`);
    }
    const json = await resp.json();
    const text = json?.content?.[0]?.text || '';
    return parseCriticJSON(text);
}

function parseCriticJSON(text) {
    const cleaned = (text || '').trim().replace(/^```json\s*/i, '').replace(/```\s*$/, '');
    try {
        return JSON.parse(cleaned);
    } catch (e) {
        const start = cleaned.indexOf('{');
        const end = cleaned.lastIndexOf('}');
        if (start !== -1 && end > start) {
            try { return JSON.parse(cleaned.slice(start, end + 1)); } catch (_) {}
        }
        // Last resort: regex-extract the key fields. Critic responses may be
        // truncated mid-string by Gemini's output budget; the partial fields
        // we DO have are still useful enough to feed into feedback.
        const block = start !== -1 ? cleaned.slice(start) : cleaned;
        const hasIssueMatch = block.match(/"has_issue"\s*:\s*(true|false)/);
        const issueTypeMatch = block.match(/"issue_type"\s*:\s*"([^"]*)"/);
        const explainMatch = block.match(/"explanation"\s*:\s*"([^"]*(?:\\.[^"]*)*)/);
        const severityMatch = block.match(/"severity"\s*:\s*"([^"]*)"/);
        if (hasIssueMatch) {
            const explanation = (explainMatch?.[1] || '').replace(/\\n/g, ' ').trim();
            return {
                has_issue: hasIssueMatch[1] === 'true',
                issue_type: issueTypeMatch?.[1] || 'other',
                explanation,
                severity: severityMatch?.[1] || 'minor',
                _parsedFromTruncated: true,
            };
        }
        throw new Error(`Failed to parse critic JSON: ${cleaned.substring(0, 200)}`);
    }
}

async function askCriticGemini(note, suggestion) {
    const apiKey = process.env.GOOGLE_AI_API_KEY;
    if (!apiKey) throw new Error('GOOGLE_AI_API_KEY not set');

    const model = process.env.RFM_CRITIC_GEMINI_MODEL || 'gemini-2.5-flash';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    const body = {
        systemInstruction: { parts: [{ text: CRITIC_SYSTEM }] },
        contents: [{ role: 'user', parts: [{ text: buildCriticPrompt(note, suggestion) }] }],
        generationConfig: {
            // Determinism over creativity: lower stochasticity so iteration-to-iteration
            // comparisons reflect prompt-change signal rather than critic-LLM noise.
            temperature: 0,
            topP: 0.1,
            maxOutputTokens: 4000,
        },
    };

    const resp = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
    });

    if (!resp.ok) {
        const txt = await resp.text();
        throw new Error(`Gemini ${resp.status}: ${txt.substring(0, 200)}`);
    }
    const json = await resp.json();
    const candidate = json?.candidates?.[0];
    const text = candidate?.content?.parts?.[0]?.text || '';
    if (!text) {
        const finishReason = candidate?.finishReason || 'unknown';
        const safetyRatings = candidate?.safetyRatings || [];
        throw new Error(`Empty Gemini response (finishReason=${finishReason}, safety=${JSON.stringify(safetyRatings).slice(0, 120)})`);
    }
    return parseCriticJSON(text);
}

// Use whichever provider has a real key. Order: Gemini → Anthropic → OpenAI.
function looksLikePlaceholder(k) {
    return !k || /your[_-]?(api[_-]?key|openai|anthropic|deepseek|google)/i.test(k);
}

async function askCritic(note, suggestion) {
    if (!looksLikePlaceholder(process.env.GOOGLE_AI_API_KEY)) {
        return await askCriticGemini(note, suggestion);
    }
    if (!looksLikePlaceholder(process.env.ANTHROPIC_API_KEY)) {
        return await askCriticAnthropic(note, suggestion);
    }
    if (!looksLikePlaceholder(process.env.OPENAI_API_KEY)) {
        return await askCriticOpenAI(note, suggestion);
    }
    throw new Error('No working LLM API key found in env');
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
        try { safe = JSON.parse(JSON.stringify(current)); } catch (e) { safe = { error: e.message }; }
        return {
            index: s.currentIndex,
            total: s.total || s.queue.length,
            phase: s.phase || s.currentPhase || null,
            current: safe,
        };
    });
}

async function waitForWizardAdvance(page, prevIndex, timeoutMs = 8000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        const scope = await page.locator('#guidelineScopeModal').isVisible().catch(() => false);
        if (scope) return 'phase-ended';
        const checkpoint = await page.locator('#checkpoint-analyse-btn').isVisible().catch(() => false);
        if (checkpoint) return 'phase-ended';
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

async function clickSkip(page) {
    const btn = page.locator('button:has-text("Skip")').first();
    try { await btn.waitFor({ state: 'visible', timeout: 5000 }); }
    catch { return false; }
    await btn.click();
    return true;
}

async function submitFeedbackViaUI(page, explanation) {
    // The wizard feedback modal is dynamically created with id=`wizard-feedback-${Date.now()}`
    // and inner elements named `${id}-text`, `${id}-submit`, `${id}-skip`.
    //
    // Defensive housekeeping: previous modals can hang around in the DOM if a prior
    // submission errored. Strip them BEFORE clicking so we never end up with multiple
    // matching elements. Match ONLY the modal root id (wizard-feedback-<digits>), not
    // its child elements like wizard-feedback-<digits>-context.
    const MODAL_ROOT_RE_STR = '^wizard-feedback-\\d+$';
    await page.evaluate((re) => {
        const r = new RegExp(re);
        document.querySelectorAll('div[id^="wizard-feedback-"]').forEach(el => {
            if (r.test(el.id)) el.remove();
        });
    }, MODAL_ROOT_RE_STR).catch(() => {});

    try {
        const feedbackBtn = page.locator('.sw-btn-feedback').first();
        if (!await feedbackBtn.isVisible().catch(() => false)) {
            console.log('  [feedback-submit] feedback button not visible');
            return false;
        }
        await feedbackBtn.click();

        // Wait for the modal root element to be created.
        await page.waitForFunction((reStr) => {
            const r = new RegExp(reStr);
            return Array.from(document.querySelectorAll('div[id^="wizard-feedback-"]')).some(el => r.test(el.id));
        }, MODAL_ROOT_RE_STR, { timeout: 5000 });

        const modalId = await page.evaluate((reStr) => {
            const r = new RegExp(reStr);
            const modals = Array.from(document.querySelectorAll('div[id^="wizard-feedback-"]')).filter(el => r.test(el.id));
            return modals[modals.length - 1]?.id || null;
        }, MODAL_ROOT_RE_STR);
        if (!modalId) {
            console.log('  [feedback-submit] no modal id found');
            return false;
        }

        await page.fill(`#${modalId}-text`, explanation);
        await page.click(`#${modalId}-submit`);

        // Wait for modal to be removed from DOM
        await page.waitForFunction((id) => !document.getElementById(id), modalId, { timeout: 5000 }).catch(() => {});
        return true;
    } catch (e) {
        console.log('  [feedback-submit] failed:', e.message.slice(0, 200));
        // Cleanup again so leftover modals don't block subsequent clicks
        await page.evaluate((reStr) => {
            const r = new RegExp(reStr);
            document.querySelectorAll('div[id^="wizard-feedback-"]').forEach(el => {
                if (r.test(el.id)) el.remove();
            });
        }, MODAL_ROOT_RE_STR).catch(() => {});
        return false;
    }
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
    const visible = await modal.isVisible().catch(() => false);
    if (!visible) return false;
    log('Scope modal — picking National');
    const btn = modal.locator('button:has-text("National")').first();
    if (await btn.isVisible().catch(() => false)) {
        await btn.click();
    } else {
        await modal.locator('button').first().click();
    }
    await page.waitForTimeout(800);
    return true;
}

async function selectOnlyRFMGuideline(page, log) {
    // Wait for the checkpoint modal to render
    const ready = await page.locator('#checkpoint-analyse-btn').waitFor({ state: 'visible', timeout: 60_000 })
        .then(() => true).catch(() => false);
    if (!ready) return false;

    log('Checkpoint modal visible — selecting only RFM guideline');

    // Uncheck everything, then check the RFM guideline by title match
    const matched = await page.evaluate((pattern) => {
        const re = new RegExp(pattern, 'i');
        const rows = Array.from(document.querySelectorAll('.checkpoint-guidelines-list > div'));
        let matchedTitles = [];
        rows.forEach(row => {
            const cb = row.querySelector('.checkpoint-cb');
            if (!cb) return;
            const titleSpan = row.querySelector('span');
            const title = titleSpan?.textContent?.trim() || '';
            if (re.test(title)) {
                cb.checked = true;
                matchedTitles.push(title);
            } else {
                cb.checked = false;
            }
        });
        // Trigger the count-update listener by dispatching a change event
        const anyCb = document.querySelector('.checkpoint-cb');
        if (anyCb) anyCb.dispatchEvent(new Event('change', { bubbles: true }));
        return matchedTitles;
    }, RFM_GUIDELINE_TITLE_MATCH.source);

    log(`Matched ${matched.length} guideline(s): ${matched.slice(0, 3).join(' | ')}`);

    if (matched.length === 0) {
        log('No RFM guideline found in checkpoint — clicking Cancel');
        await page.evaluate(() => {
            const btn = document.getElementById('checkpoint-cancel-btn');
            if (btn) btn.click();
        });
        return false;
    }

    // Click Analyse (via JS click to dodge fixed-position visibility issues)
    await page.evaluate(() => {
        const btn = document.getElementById('checkpoint-analyse-btn');
        if (btn) btn.click();
    });
    await page.locator('#guidelineCheckpointModal').waitFor({ state: 'hidden', timeout: 10_000 }).catch(() => {});
    return true;
}

async function dismissSummaryModal(page) {
    // After checkpoint, a summary modal sometimes appears
    const btn = page.locator('button[class*="primary"], .btn-primary, button:has-text("Done"), button:has-text("Continue"), button:has-text("Close")').first();
    if (await btn.isVisible().catch(() => false)) {
        await btn.click();
        await page.waitForTimeout(800);
    }
}

// ----- Per-scenario runner ------------------------------------------------

async function processScenario(page, scenario, rawLog) {
    const log = (m) => console.log(`  [${scenario.id}] ${m}`);
    log(`Starting: ${scenario.label}`);
    const noteStart = Date.now();

    await page.goto('https://clerkyai.health/', { waitUntil: 'load' });
    const editorVisible = await page.locator('#userInput .ProseMirror')
        .waitFor({ state: 'visible', timeout: 30_000 })
        .then(() => true).catch(() => false);
    if (!editorVisible) return { status: 'auth-expired' };

    await dismissCookieBanner(page);
    await typeIntoEditor(page, scenario.text);
    await page.waitForTimeout(700);
    const typed = await getNoteContent(page);
    log(`Note typed (${typed.length} chars)`);

    await page.locator('#analyseNoteBtn').click();
    log('Clicked Analyse');

    // Phase 1: completeness — skip everything
    const phase1Outcome = await Promise.race([
        page.locator('#wizardPanel').waitFor({ state: 'visible', timeout: WIZARD_TIMEOUT }).then(() => 'wizard'),
        page.locator('#guidelineScopeModal').waitFor({ state: 'visible', timeout: WIZARD_TIMEOUT }).then(() => 'scope-modal'),
        page.locator('#checkpoint-analyse-btn').waitFor({ state: 'visible', timeout: WIZARD_TIMEOUT }).then(() => 'checkpoint'),
    ]).catch(() => 'timeout');
    log(`Phase 1 outcome: ${phase1Outcome}`);

    if (phase1Outcome === 'wizard') {
        // Skip every completeness suggestion
        let skipped = 0;
        const maxSkip = 40;
        while (await isWizardVisible(page) && skipped < maxSkip) {
            const scope = await page.locator('#guidelineScopeModal').isVisible().catch(() => false);
            if (scope) break;
            const cp = await page.locator('#checkpoint-analyse-btn').isVisible().catch(() => false);
            if (cp) break;
            const snap = await captureWizardState(page);
            if (!snap) { await page.waitForTimeout(800); continue; }
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

    // Handle scope modal (if present)
    await handleScopeModal(page, log);

    // Select only RFM guideline
    const selected = await selectOnlyRFMGuideline(page, log);
    if (!selected) {
        log('Could not select RFM guideline — bailing on this scenario');
        return { status: 'no-rfm-guideline', captured: 0, critiquedCount: 0, submitted: 0 };
    }

    await dismissSummaryModal(page);

    // Phase 2: guideline suggestions
    await page.waitForTimeout(2500);
    const phase2Visible = await page.locator('#wizardPanel').waitFor({ state: 'visible', timeout: PHASE_TIMEOUT })
        .then(() => true).catch(() => false);

    const noteForCritic = await getNoteContent(page);
    const critiqued = [];
    let submitted = 0;

    if (phase2Visible) {
        log('Phase 2 wizard visible — beginning critic loop');
        const seenIndices = new Set();
        const maxIter = 80;
        let iter = 0;
        while (await isWizardVisible(page) && iter < maxIter) {
            iter++;
            if (Date.now() - noteStart > PER_NOTE_CAP_MS) {
                log('Per-note time cap exceeded — stopping');
                break;
            }
            const snap = await captureWizardState(page);
            if (!snap) { await page.waitForTimeout(700); continue; }
            const key = `${snap.index}|${(snap.current?.suggestion || snap.current?.text || '').slice(0, 80)}`;
            if (seenIndices.has(key)) {
                // Already processed this one — try to advance
                if (!await clickSkip(page)) break;
                await waitForWizardAdvance(page, snap.index, 6000);
                continue;
            }
            seenIndices.add(key);

            const c = snap.current || {};
            const textSnippet = (c.suggestion || c.text || '').slice(0, 80);
            log(`Suggestion ${snap.index + 1}/${snap.total}: "${textSnippet}"`);

            // Ask the critic
            let critique = null;
            try {
                critique = await askCritic(noteForCritic, c);
            } catch (e) {
                log(`  Critic call failed: ${e.message}`);
            }

            const entry = {
                wizardIndex: snap.index,
                suggestionText: c.suggestion || c.text || '',
                why: c.why || '',
                verbatimQuote: c.verbatimQuote || '',
                originalText: c.originalText || null,
                target_section: c.target_section || null,
                practicePointNumber: c.practicePointNumber || null,
                sourceGuidelineId: c.sourceGuidelineId || null,
                critique,
                feedbackSubmitted: false,
            };

            if (critique?.has_issue && critique.explanation && critique.explanation.length > 30) {
                log(`  CRITIC FLAGGED [${critique.severity || '?'}|${critique.issue_type || '?'}]: ${critique.explanation.slice(0, 100)}`);
                const ok = await submitFeedbackViaUI(page, critique.explanation);
                if (ok) {
                    entry.feedbackSubmitted = true;
                    submitted++;
                    log('  ✅ Feedback submitted via UI');
                } else {
                    log('  ❌ Feedback submission failed');
                }
            } else if (critique) {
                log(`  Critic OK — no issue`);
            }

            critiqued.push(entry);

            const prevIdx = snap.index;
            if (!await clickSkip(page)) break;
            const adv = await waitForWizardAdvance(page, prevIdx, 8000);
            if (adv === 'closed' || adv === 'phase-ended') break;
            if (adv === 'timeout') {
                log('Advance timed out — breaking');
                break;
            }
            await page.waitForTimeout(ACTION_DELAY);
        }
        log(`Critiqued ${critiqued.length} suggestions; ${submitted} flagged and submitted`);
    } else {
        log('Phase 2 wizard never appeared');
    }

    rawLog.push({
        scenarioId: scenario.id,
        scenarioLabel: scenario.label,
        pass: scenario._pass || 1,
        critiquedCount: critiqued.length,
        submitted,
        critiqued,
    });

    return { status: 'ok', captured: critiqued.length, critiquedCount: critiqued.length, submitted };
}

// ----- Main ---------------------------------------------------------------

async function main() {
    if (!fs.existsSync(AUTH_STATE_PATH)) {
        console.error('No auth state at', AUTH_STATE_PATH);
        process.exit(1);
    }
    // Critic prefers Gemini (only working key here); Anthropic/OpenAI are optional fallbacks.
    if (!process.env.GOOGLE_AI_API_KEY && !process.env.ANTHROPIC_API_KEY && !process.env.OPENAI_API_KEY) {
        console.error('No LLM API key found in env');
        process.exit(1);
    }

    // Self-heal: refresh auth tokens + today's disclaimer acceptance so the run doesn't
    // silently fail on stale state.json or after midnight UTC.
    try {
        console.log('Refreshing Playwright auth state before run...');
        require('child_process').execSync('node scripts/refresh-playwright-auth.js', {
            cwd: path.join(__dirname, '..'),
            stdio: 'inherit',
        });
    } catch (e) {
        console.log('Auth refresh failed (continuing with existing state):', e.message);
    }

    const runStart = Date.now();
    const summary = {
        startedAt: new Date().toISOString(),
        scenariosProcessed: 0,
        totalSuggestionsCritiqued: 0,
        totalFeedbackSubmitted: 0,
        scenarios: [],
        aborted: false,
        abortReason: null,
    };
    const rawLog = [];

    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ storageState: AUTH_STATE_PATH });
    const page = await context.newPage();
    page.on('pageerror', e => console.log('  [pageerror]', e.message));

    // Filter to specific scenarios via CLI args; default = all
    const onlyIds = process.argv.slice(2).filter(a => a.startsWith('RFM_'));
    const toRun = onlyIds.length > 0
        ? SCENARIOS.filter(s => onlyIds.includes(s.id))
        : SCENARIOS;
    // --repeat=N runs the full scenario set N times and aggregates. Used to average
    // out critic-LLM stochasticity when comparing prompt iterations.
    const repeatArg = process.argv.find(a => a.startsWith('--repeat='));
    const REPEAT = repeatArg ? Math.max(1, parseInt(repeatArg.split('=')[1], 10)) : 1;
    console.log(`Will run ${toRun.length} scenario(s) × ${REPEAT} pass(es): ${toRun.map(s => s.id).join(', ')}`);

    for (let pass = 0; pass < REPEAT; pass++) {
    if (REPEAT > 1) console.log(`\n========== PASS ${pass + 1} of ${REPEAT} ==========\n`);
    for (const scenario of toRun) {
        // Tag each rawLog entry with the pass number for later aggregation
        scenario._pass = pass + 1;
        if (Date.now() - runStart > TOTAL_TIME_CAP_MS) {
            summary.aborted = true;
            summary.abortReason = 'total-time-cap';
            break;
        }
        try {
            const r = await processScenario(page, scenario, rawLog);
            if (r.status === 'auth-expired') {
                summary.aborted = true;
                summary.abortReason = 'auth-expired';
                summary.scenarios.push({ id: scenario.id, status: 'auth-expired' });
                break;
            }
            summary.scenariosProcessed++;
            summary.totalSuggestionsCritiqued += (r.critiquedCount || 0);
            summary.totalFeedbackSubmitted += (r.submitted || 0);
            summary.scenarios.push({
                id: scenario.id,
                label: scenario.label,
                status: r.status,
                critiqued: r.critiquedCount,
                submitted: r.submitted,
            });
        } catch (e) {
            console.log(`  [${scenario.id}] FATAL: ${e.message}`);
            summary.scenarios.push({ id: scenario.id, status: 'error', error: e.message });
        }
        summary.lastUpdatedAt = new Date().toISOString();
        fs.writeFileSync(SUMMARY_PATH, JSON.stringify(summary, null, 2));
        fs.writeFileSync(RAW_LOG_PATH, JSON.stringify(rawLog, null, 2));
        await page.waitForTimeout(3000);
    }
    } // end pass loop

    await browser.close();
    summary.completedAt = new Date().toISOString();
    fs.writeFileSync(SUMMARY_PATH, JSON.stringify(summary, null, 2));
    fs.writeFileSync(RAW_LOG_PATH, JSON.stringify(rawLog, null, 2));

    console.log('\n===== RFM CRITIC SUMMARY =====');
    console.log(`Scenarios processed: ${summary.scenariosProcessed}`);
    console.log(`Suggestions critiqued: ${summary.totalSuggestionsCritiqued}`);
    console.log(`Feedback docs submitted: ${summary.totalFeedbackSubmitted}`);
    if (summary.aborted) console.log(`Aborted: ${summary.abortReason}`);

    await admin.app().delete();
    process.exit(0);
}

main().catch(err => {
    console.error('FATAL:', err);
    try {
        fs.writeFileSync(SUMMARY_PATH, JSON.stringify({
            status: 'fatal-error',
            error: err.message,
            stack: err.stack,
            timestamp: new Date().toISOString(),
        }, null, 2));
    } catch {}
    process.exit(1);
});
