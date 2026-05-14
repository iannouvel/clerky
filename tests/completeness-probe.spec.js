/**
 * Completeness Probe
 *
 * Pastes a fixed clinical note, clicks Analyse Note, and observes every
 * completeness suggestion (Phase 1 only). Captures the full suggestion
 * object from window.suggestionWizardState for each, then Skips to move on.
 *
 * Does NOT proceed to scope/guideline phases. Writes captured data to
 * tests/.last-probe-result.json.
 *
 * Run:
 *   npx playwright test tests/completeness-probe.spec.js --headed
 */
import { test, expect } from '@playwright/test';
import path from 'path';
import fs from 'fs';

const AUTH_STATE_PATH = path.join(import.meta.dirname, '.auth', 'state.json');
const RESULT_PATH = path.join(import.meta.dirname, '.last-probe-result.json');
const WIZARD_TIMEOUT = 90_000;
const ACTION_DELAY = 700;

const TEST_NOTE = `Clinical Note
Date: 12th May 2026
Patient: Mrs. A.B.
Age: 28
Gestation: 34 weeks
Parity: G3P2 (2x prev SVD)

History:
Mrs. A.B., a 28-year-old G3P2 woman, presents with reduced fetal movements over 24 hours. She denies bleeding, contractions, or leakage of fluid.

Examination:
Vitals within normal limits. Fundal height consistent with dates. Fetal heart rate within normal limits on CTG. No abnormalities on ultrasound.

Assessment:
Reduced fetal movements at 34 weeks. Reassuring CTG. Requires further investigation.

Plan:
1. Admit for monitoring
2. Repeat CTG
3. Ultrasound for AFI and EFW
4. Education on fetal movement counting
5. Close follow-up until delivery`;

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

/**
 * Capture the entire current suggestion object plus contextual wizard state.
 */
async function captureFullState(page) {
  return page.evaluate(() => {
    const state = window.suggestionWizardState;
    if (!state || !state.queue || state.currentIndex >= state.queue.length) {
      return null;
    }
    const current = state.queue[state.currentIndex];
    // Deep clone to strip any non-serialisable bits
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
  // Wait for the button to actually be visible (headless can briefly detach/re-render between suggestions)
  try {
    await skipBtn.waitFor({ state: 'visible', timeout: 5000 });
  } catch {
    return false;
  }
  await skipBtn.click();
  return true;
}

/**
 * Wait until the wizard advances to a new suggestion (currentIndex changes),
 * the wizard closes, or a downstream modal (scope/checkpoint) appears.
 * Returns 'advanced' | 'closed' | 'phase-ended' | 'timeout'.
 */
async function waitForWizardAdvance(page, prevIndex, timeoutMs = 8000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    // Downstream modal => completeness phase ended
    const scope = await page.locator('#guidelineScopeModal').isVisible().catch(() => false);
    if (scope) return 'phase-ended';
    const checkpoint = await page.locator('#checkpoint-analyse-btn').isVisible().catch(() => false);
    if (checkpoint) return 'phase-ended';

    // Wizard panel hidden => closed
    const wizardVisible = await page.locator('#wizardPanel').isVisible().catch(() => false);
    if (!wizardVisible) return 'closed';

    const idx = await page.evaluate(() => {
      const s = window.suggestionWizardState;
      if (!s || !s.queue) return null;
      if (s.currentIndex >= s.queue.length) return -1; // queue exhausted
      return s.currentIndex;
    }).catch(() => null);

    if (idx === -1) return 'closed';
    if (idx !== null && idx !== prevIndex) return 'advanced';

    await page.waitForTimeout(150);
  }
  return 'timeout';
}

test.describe('Completeness Probe', () => {
  test.use({ storageState: AUTH_STATE_PATH });
  test.setTimeout(300_000);

  test.beforeEach(async ({ page }) => {
    if (!fs.existsSync(AUTH_STATE_PATH)) {
      test.skip(true, 'No auth state. Run auth setup first.');
    }
    await page.goto('/');
    await page.waitForLoadState('load');

    const editorVisible = await page.locator('#userInput .ProseMirror')
      .waitFor({ state: 'visible', timeout: 30_000 })
      .then(() => true).catch(() => false);
    if (!editorVisible) test.skip(true, 'Not logged in.');

    // Dismiss cookie banner if present
    const cookieBanner = page.locator('#cookie-consent-banner button:has-text("Reject Non-Essential")').first();
    if (await cookieBanner.isVisible().catch(() => false)) {
      await cookieBanner.click();
      await page.waitForTimeout(300);
    }
  });

  test('probe completeness suggestions for fixed note', async ({ page }) => {
    const log = (m) => console.log(`  [PROBE] ${m}`);

    await typeIntoEditor(page, TEST_NOTE);
    await page.waitForTimeout(800);
    const typed = await getNoteContent(page);
    expect(typed.length).toBeGreaterThan(50);
    log(`Note typed (${typed.length} chars)`);

    const analyseBtn = page.locator('#analyseNoteBtn');
    await expect(analyseBtn).toBeVisible({ timeout: 5000 });
    await analyseBtn.click();
    log('Clicked Analyse Note');

    // Wait for wizard or completion
    const outcome = await Promise.race([
      page.locator('#wizardPanel').waitFor({ state: 'visible', timeout: WIZARD_TIMEOUT })
        .then(() => 'wizard'),
      page.locator('#analyseNoteBtn .btn-text:has-text("Analyse Note")').waitFor({ state: 'visible', timeout: WIZARD_TIMEOUT })
        .then(() => 'complete'),
    ]).catch(() => 'timeout');

    log(`Initial wait outcome: ${outcome}`);

    const captured = [];
    const seenIndices = new Set();

    if (outcome === 'wizard') {
      const maxIterations = 60;
      let iter = 0;

      while (await isWizardVisible(page) && iter < maxIterations) {
        iter++;

        // If a scope modal has appeared, completeness phase is over — stop.
        const scopeModalVisible = await page.locator('#guidelineScopeModal').isVisible().catch(() => false);
        if (scopeModalVisible) {
          log('Scope modal appeared — completeness phase ended; stopping probe.');
          break;
        }
        const checkpointVisible = await page.locator('#checkpoint-analyse-btn').isVisible().catch(() => false);
        if (checkpointVisible) {
          log('Checkpoint modal appeared — completeness phase ended; stopping probe.');
          break;
        }

        const snapshot = await captureFullState(page);
        if (!snapshot) {
          await page.waitForTimeout(800);
          continue;
        }

        // Avoid double-capturing the same suggestion index
        const key = `${snapshot.index}|${snapshot.current?.text || snapshot.current?.suggestion || ''}`;
        if (!seenIndices.has(key)) {
          seenIndices.add(key);
          captured.push(snapshot);
          const c = snapshot.current || {};
          log(`Suggestion ${snapshot.index + 1}/${snapshot.total}: type=${c.type || c.inputType || c.dataType || 'n/a'} | text="${(c.text || c.suggestion || '').slice(0, 70)}"`);
        }

        const prevIndex = snapshot.index;
        const skipped = await clickSkip(page);
        if (!skipped) {
          log('Skip button not found — breaking loop');
          break;
        }

        // Headless-tolerant wait: the Skip button briefly detaches while the
        // next suggestion mounts. Wait for the wizard to actually advance
        // (currentIndex change), close, or for completeness phase to end.
        const advanceOutcome = await waitForWizardAdvance(page, prevIndex, 8000);
        if (advanceOutcome === 'closed') {
          log('Wizard closed after skip — completeness phase ended.');
          break;
        }
        if (advanceOutcome === 'phase-ended') {
          log('Downstream modal appeared after skip — completeness phase ended.');
          break;
        }
        if (advanceOutcome === 'timeout') {
          log('Timed out waiting for wizard to advance — breaking loop');
          break;
        }
        // Small settle delay so the new suggestion is fully rendered
        await page.waitForTimeout(200);
      }

      log(`Captured ${captured.length} completeness suggestions across ${iter} iterations`);
    } else if (outcome === 'complete') {
      log('Phase 1 finished immediately — no completeness suggestions');
    } else {
      log('Initial wait timed out');
    }

    // Persist results
    const result = {
      noteUsed: TEST_NOTE,
      capturedAt: new Date().toISOString(),
      outcome,
      total: captured.length,
      suggestions: captured,
    };
    fs.writeFileSync(RESULT_PATH, JSON.stringify(result, null, 2));
    log(`Wrote ${captured.length} captured suggestions to ${RESULT_PATH}`);

    // Sanity assertion — we ran without crashing; don't enforce content.
    expect(result).toBeTruthy();
  });
});
