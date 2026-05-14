/**
 * Dynamic Advice Probe (Phase 2 — guideline suggestions)
 *
 * Pastes a fixed clinical note, clicks Analyse Note, skips every Phase 1
 * (completeness) suggestion, passes through the checkpoint modal, then
 * captures every Phase 2 (dynamicAdviceSystemPrompt) suggestion object
 * verbatim from window.suggestionWizardState. Skips through them so the
 * full queue is observed.
 *
 * Writes captured Phase 2 suggestions to tests/.last-dynamic-advice-probe-result.json.
 *
 * Run:
 *   npx playwright test tests/dynamic-advice-probe.spec.js
 */
import { test, expect } from '@playwright/test';
import path from 'path';
import fs from 'fs';

const AUTH_STATE_PATH = path.join(import.meta.dirname, '.auth', 'state.json');
const RESULT_PATH = path.join(import.meta.dirname, '.last-dynamic-advice-probe-result.json');
const WIZARD_TIMEOUT = 90_000;
const PHASE2_WAIT_TIMEOUT = 180_000;

const TEST_NOTE = `Clinical Note
Date: 12th May 2026
Patient: Mrs. K.L.
Age: 32
Gestation: 32+4 weeks
Parity: G2P1 (1 x prev SVD)

History:
Mrs. K.L. presents to MAU with sudden onset painless vaginal bleeding that started 2 hours ago, approximately 200ml estimated. She denies contractions, pain, or leakage of fluid. Fetal movements are normal. Known major placenta praevia on 20-week anomaly scan, asymptomatic until today.

Examination:
BP 118/76, HR 92, temp 36.7°C, respiratory rate 16, SpO2 99% on air. Abdomen soft, non-tender, no contractions palpated. Fundal height appropriate for dates. Fetal heart rate 145 bpm, reactive on CTG.

Assessment:
APH secondary to known major placenta praevia at 32+4 weeks. Currently haemodynamically stable.

Plan:
1. Admit for observation
2. Group and save sent
3. Continuous CTG
4. Senior obstetric review`;

async function typeIntoEditor(page, text) {
  await page.evaluate((content) => {
    const editor = window.editors?.userInput;
    if (editor) {
      editor.commands.setContent(`<p>${content.replace(/\n/g, '</p><p>')}</p>`);
    } else {
      const el = document.querySelector('#userInput .ProseMirror');
      if (el) {
        el.innerHTML = `<p>${content.replace(/\n/g, '</p><p>')}</p>`;
      }
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

/** Capture the entire current suggestion object plus contextual wizard state. */
async function captureFullState(page) {
  return page.evaluate(() => {
    const state = window.suggestionWizardState;
    if (!state || !state.queue || state.currentIndex >= state.queue.length) {
      return null;
    }
    const current = state.queue[state.currentIndex];
    let safeCurrent;
    try {
      safeCurrent = JSON.parse(JSON.stringify(current));
    } catch (e) {
      safeCurrent = { error: 'failed to clone', message: e.message };
    }
    return {
      index: state.currentIndex,
      total: state.total || state.queue.length,
      phase: state.phase || state.currentPhase || null,
      current: safeCurrent,
    };
  });
}

async function clickSkip(page) {
  const skipBtn = page.locator('button:has-text("Skip")').first();
  try {
    await skipBtn.waitFor({ state: 'visible', timeout: 5000 });
  } catch {
    return false;
  }
  await skipBtn.click();
  return true;
}

/**
 * Wait until the wizard advances (currentIndex changes), closes, or a
 * downstream modal appears. Returns 'advanced' | 'closed' | 'phase-ended' | 'timeout'.
 */
async function waitForWizardAdvance(page, prevIndex, timeoutMs = 8000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const scope = await page.locator('#guidelineScopeModal').isVisible().catch(() => false);
    if (scope) return 'phase-ended';
    const checkpoint = await page.locator('#checkpoint-analyse-btn').isVisible().catch(() => false);
    if (checkpoint) return 'phase-ended';

    const wizardVisible = await page.locator('#wizardPanel').isVisible().catch(() => false);
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

test.describe('Dynamic Advice Probe (Phase 2)', () => {
  test.use({ storageState: AUTH_STATE_PATH });
  test.setTimeout(600_000); // 10 min — Phase 1 + checkpoint + Phase 2 can be long

  test.beforeEach(async ({ page }) => {
    if (!fs.existsSync(AUTH_STATE_PATH)) {
      test.skip(true, 'No auth state. Run auth setup first.');
    }
    await page.goto('/');
    await page.waitForLoadState('load');
    console.log('  [DYN-PROBE] navigated, URL:', page.url());

    // The app may redirect to disclaimer.html if daily disclaimer not yet accepted.
    // Wait briefly for that JS-driven redirect, then handle either case.
    try {
      await page.waitForURL(/disclaimer\.html/i, { timeout: 5000 });
      console.log('  [DYN-PROBE] redirected to disclaimer page:', page.url());
    } catch { /* not redirected; already on main */ }

    page.on('console', (msg) => {
      const t = msg.text();
      if (/disclaimer|Accept|onAuthStateChanged|Setting up/.test(t)) {
        console.log('  [PAGE-LOG]', t);
      }
    });

    const acceptBtn = page.locator('#acceptButton');
    if (await acceptBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      // The page's onAuthStateChanged async handler needs to attach the click listener.
      // Wait for that "Setting up accept button click handler" log, or just give it time.
      await page.waitForTimeout(2500);
      await acceptBtn.click();
      console.log('  [DYN-PROBE] clicked daily disclaimer Accept');
      // Wait to be redirected back to main app (Firestore write + 1s timeout + redirect)
      await page.waitForURL((url) => !/disclaimer/i.test(url.toString()), { timeout: 60_000 }).catch(() => {});
      await page.waitForLoadState('load');
      console.log('  [DYN-PROBE] post-disclaimer URL:', page.url());
    }

    const editorVisible = await page.locator('#userInput .ProseMirror')
      .waitFor({ state: 'visible', timeout: 30_000 })
      .then(() => true).catch(() => false);
    console.log('  [DYN-PROBE] editorVisible=', editorVisible);
    if (!editorVisible) {
      const bodyText = await page.locator('body').innerText().catch(() => '');
      console.log('  [DYN-PROBE] body snippet:', bodyText.slice(0, 500));
      test.skip(true, 'Not logged in.');
    }

    const cookieBanner = page.locator('#cookie-consent-banner button:has-text("Reject Non-Essential")').first();
    if (await cookieBanner.isVisible().catch(() => false)) {
      await cookieBanner.click();
      await page.waitForTimeout(300);
    }
  });

  test('probe Phase 2 dynamic advice suggestions for fixed APH/placenta praevia note', async ({ page }) => {
    const log = (m) => console.log(`  [DYN-PROBE] ${m}`);

    await typeIntoEditor(page, TEST_NOTE);
    await page.waitForTimeout(800);
    const typed = await getNoteContent(page);
    expect(typed.length).toBeGreaterThan(50);
    log(`Note typed (${typed.length} chars)`);

    const analyseBtn = page.locator('#analyseNoteBtn');
    await expect(analyseBtn).toBeVisible({ timeout: 5000 });
    await analyseBtn.click();
    log('Clicked Analyse Note');

    // ── Phase 1: skip through every completeness suggestion ────────────
    const phase1Outcome = await Promise.race([
      page.locator('#wizardPanel').waitFor({ state: 'visible', timeout: WIZARD_TIMEOUT })
        .then(() => 'wizard'),
      page.locator('#guidelineScopeModal').waitFor({ state: 'visible', timeout: WIZARD_TIMEOUT })
        .then(() => 'scope'),
      page.locator('#checkpoint-analyse-btn').waitFor({ state: 'visible', timeout: WIZARD_TIMEOUT })
        .then(() => 'checkpoint'),
    ]).catch(() => 'timeout');

    log(`Phase 1 initial wait outcome: ${phase1Outcome}`);

    let phase1Skipped = 0;

    if (phase1Outcome === 'wizard') {
      log('Phase 1 wizard appeared — skipping all completeness suggestions');
      const maxIterations = 80;
      let iter = 0;

      while (await isWizardVisible(page) && iter < maxIterations) {
        iter++;

        // Stop if downstream modal appears (Phase 1 ended)
        const scopeModalVisible = await page.locator('#guidelineScopeModal').isVisible().catch(() => false);
        if (scopeModalVisible) {
          log('Scope modal appeared during Phase 1 — Phase 1 ended');
          break;
        }
        const checkpointVisible = await page.locator('#checkpoint-analyse-btn').isVisible().catch(() => false);
        if (checkpointVisible) {
          log('Checkpoint modal appeared during Phase 1 — Phase 1 ended');
          break;
        }

        const snapshot = await captureFullState(page);
        if (!snapshot) {
          await page.waitForTimeout(800);
          continue;
        }

        const prevIndex = snapshot.index;
        const skipped = await clickSkip(page);
        if (!skipped) {
          log('Skip button not found in Phase 1 — breaking');
          break;
        }
        phase1Skipped++;

        const advanceOutcome = await waitForWizardAdvance(page, prevIndex, 8000);
        if (advanceOutcome === 'closed') {
          log('Wizard closed — Phase 1 ended');
          break;
        }
        if (advanceOutcome === 'phase-ended') {
          log('Downstream modal appeared after skip — Phase 1 ended');
          break;
        }
        if (advanceOutcome === 'timeout') {
          log('Phase 1 wizard advance timed out — breaking');
          break;
        }
        await page.waitForTimeout(150);
      }

      log(`Phase 1 done: skipped ${phase1Skipped} suggestions across ${iter} iterations`);
    } else if (phase1Outcome === 'scope' || phase1Outcome === 'checkpoint') {
      log('Phase 1 had no suggestions — straight to scope/checkpoint');
    } else {
      log('Phase 1 timed out — continuing anyway');
    }

    // ── Handle scope modal if present ──────────────────────────────────
    const scopeModal = page.locator('#guidelineScopeModal');
    if (await scopeModal.isVisible().catch(() => false)) {
      log('Scope modal visible — clicking first scope option');
      const firstScopeBtn = scopeModal.locator('button').first();
      if (await firstScopeBtn.isVisible().catch(() => false)) {
        await firstScopeBtn.click();
      }
      await page.waitForTimeout(1000);
    }

    // ── Handle checkpoint modal ────────────────────────────────────────
    log('Waiting for guideline checkpoint modal...');
    const checkpointBtn = page.locator('#checkpoint-analyse-btn');
    const checkpointVisible = await checkpointBtn.waitFor({ state: 'visible', timeout: 90_000 })
      .then(() => true).catch(() => false);

    if (checkpointVisible) {
      log('Checkpoint modal appeared');
      const selectAll = page.locator('#checkpoint-select-all');
      if (await selectAll.isVisible().catch(() => false)) {
        await selectAll.check().catch(() => {});
      }
      await page.evaluate(() => {
        const btn = document.getElementById('checkpoint-analyse-btn');
        if (btn) btn.click();
      });
      log('Selected all guidelines, clicked Analyse');
      await page.locator('#guidelineCheckpointModal').waitFor({ state: 'hidden', timeout: 15_000 }).catch(() => {});
    } else {
      log('No checkpoint modal — Phase 2 may not start. Continuing to wait anyway.');
    }

    // Dismiss any summary modal that may appear
    await page.waitForTimeout(1500);
    const summaryBtn = page.locator('button[class*="primary"], .btn-primary, button:has-text("Done"), button:has-text("Continue"), button:has-text("Close")').first();
    if (await summaryBtn.isVisible().catch(() => false)) {
      log('Summary modal visible — clicking primary button');
      await summaryBtn.click().catch(() => {});
      await page.waitForTimeout(800);
    }

    // ── Phase 2: capture every dynamic advice suggestion ───────────────
    log('Waiting for Phase 2 wizard...');
    const phase2Visible = await page.locator('#wizardPanel')
      .waitFor({ state: 'visible', timeout: PHASE2_WAIT_TIMEOUT })
      .then(() => true).catch(() => false);

    const captured = [];
    const seenKeys = new Set();

    if (phase2Visible) {
      log('Phase 2 wizard visible — capturing suggestions');
      const maxIterations = 80;
      let iter = 0;

      while (await isWizardVisible(page) && iter < maxIterations) {
        iter++;

        const snapshot = await captureFullState(page);
        if (!snapshot) {
          await page.waitForTimeout(800);
          continue;
        }

        const c = snapshot.current || {};
        const key = `${snapshot.index}|${(c.originalText || c.text || '').slice(0, 80)}`;
        if (!seenKeys.has(key)) {
          seenKeys.add(key);
          captured.push(snapshot);
          log(`Phase 2 suggestion ${snapshot.index + 1}/${snapshot.total}: category=${c.category || 'n/a'} priority=${c.priority || 'n/a'} hasVerbatim=${c.hasVerbatimQuote ?? 'n/a'}`);
          log(`   originalText: ${(c.originalText || c.text || '').slice(0, 100)}`);
        }

        const prevIndex = snapshot.index;
        const skipped = await clickSkip(page);
        if (!skipped) {
          log('Skip button not found in Phase 2 — breaking');
          break;
        }

        const advanceOutcome = await waitForWizardAdvance(page, prevIndex, 8000);
        if (advanceOutcome === 'closed') {
          log('Phase 2 wizard closed — done');
          break;
        }
        if (advanceOutcome === 'timeout') {
          log('Phase 2 wizard advance timed out — breaking');
          break;
        }
        await page.waitForTimeout(150);
      }

      log(`Captured ${captured.length} Phase 2 suggestions across ${iter} iterations`);
    } else {
      log('Phase 2 wizard did not appear within timeout');
    }

    const result = {
      noteUsed: TEST_NOTE,
      capturedAt: new Date().toISOString(),
      phase1Skipped,
      phase2Total: captured.length,
      suggestions: captured,
    };
    fs.writeFileSync(RESULT_PATH, JSON.stringify(result, null, 2));
    log(`Wrote ${captured.length} Phase 2 suggestions to ${RESULT_PATH}`);

    expect(result).toBeTruthy();
  });
});
