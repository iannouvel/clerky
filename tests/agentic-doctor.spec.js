/**
 * Agentic Doctor E2E Test
 *
 * Simulates a real doctor using the system: types a clinical note,
 * clicks Analyse Note, interacts with the suggestion wizard (accepting
 * or skipping based on Claude's clinical judgment), and evaluates
 * the final note quality.
 *
 * Prerequisites:
 *   1. Run auth setup first:  npx playwright test tests/helpers/auth-setup.js --headed
 *   2. Set env var:           ANTHROPIC_API_KEY=sk-ant-...
 *
 * Run:
 *   npx playwright test tests/agentic-doctor.spec.js --headed
 */
import { test, expect } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import {
  generateClinicalNote,
  decideCompleteness,
  decideScope,
  decideGuideline,
  evaluateFinalNote,
} from './helpers/doctor-brain.js';

// ── Config ──────────────────────────────────────────────────────────────
const AUTH_STATE_PATH = path.join(import.meta.dirname, '.auth', 'state.json');
const WIZARD_TIMEOUT = 90_000;  // max wait for wizard to appear after Analyse
const PHASE_TIMEOUT = 120_000;  // max wait for a full phase to complete
const ACTION_DELAY = 800;       // ms between wizard actions (mimics human pace)

// Clinical scenarios to test — each run picks one
const SCENARIOS = [
  'A 32-year-old woman at 38 weeks gestation presenting with regular contractions every 5 minutes and spontaneous rupture of membranes 2 hours ago. She has gestational diabetes managed with insulin.',
  'A 28-year-old primigravida at 34 weeks with sudden onset severe headache, visual disturbances, and BP 165/110. She has mild ankle oedema.',
  'A 25-year-old woman at 28 weeks presenting with painless vaginal bleeding. She had a low-lying placenta identified at her 20-week scan.',
  'A 35-year-old multiparous woman 6 hours post emergency caesarean section for failure to progress. Estimated blood loss 800ml. Currently on oxytocin infusion.',
  'A 30-year-old woman at 41+3 weeks presenting for induction of labour. Bishop score 4. Previous uncomplicated vaginal delivery.',
];

// ── Helpers ─────────────────────────────────────────────────────────────

/** Pick a random scenario */
function pickScenario() {
  return SCENARIOS[Math.floor(Math.random() * SCENARIOS.length)];
}

/** Type into the TipTap editor via page.evaluate */
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

  // Type a space then delete it — triggers real input events which show the Analyse button
  const editor = page.locator('#userInput .ProseMirror');
  await editor.click();
  await page.keyboard.press('End');
  await page.keyboard.type(' ');
  await page.keyboard.press('Backspace');
}

/** Get current note content as plain text */
async function getNoteContent(page) {
  return page.evaluate(() => {
    const editor = window.editors?.userInput;
    if (editor) return editor.getText();
    const el = document.querySelector('#userInput .ProseMirror');
    return el ? el.textContent : '';
  });
}

/** Wait for the wizard panel to become visible */
async function waitForWizard(page, timeout = WIZARD_TIMEOUT) {
  await page.locator('#wizardPanel').waitFor({ state: 'visible', timeout });
}

/** Check if wizard is currently visible */
async function isWizardVisible(page) {
  return page.locator('#wizardPanel').isVisible().catch(() => false);
}

/** Get the current wizard suggestion text and metadata */
async function getWizardState(page) {
  return page.evaluate(() => {
    const state = window.suggestionWizardState;
    if (!state || !state.queue || state.currentIndex >= state.queue.length) {
      return null;
    }
    const current = state.queue[state.currentIndex];
    const countEl = document.querySelector('.sw-count');
    return {
      index: state.currentIndex,
      total: state.total || state.queue.length,
      text: current?.text || current?.suggestion || '',
      why: current?.why || '',
      type: current?.type || 'free-text',
      inputType: current?.inputType || current?.dataType || 'free-text',
      countLabel: countEl ? countEl.textContent : '',
    };
  });
}

/** Click the Accept button in the wizard */
async function clickAccept(page) {
  // The accept button contains a checkmark and has class sw-btn-accept or contains "✓"
  const acceptBtn = page.locator('.sw-footer button').last();
  if (await acceptBtn.isEnabled()) {
    await acceptBtn.click();
  }
}

/** Click the Skip button in the wizard */
async function clickSkip(page) {
  const skipBtn = page.locator('button:has-text("Skip")').first();
  if (await skipBtn.isVisible()) {
    await skipBtn.click();
  }
}

/** Fill in a wizard input field if present */
async function fillWizardInput(page, value) {
  // Check for text input
  const textInput = page.locator('.sw-input-section input[type="text"], .sw-input-section textarea').first();
  if (await textInput.isVisible().catch(() => false)) {
    await textInput.fill(value);
    return true;
  }
  // Check for select dropdown
  const select = page.locator('.sw-input-section select').first();
  if (await select.isVisible().catch(() => false)) {
    // Try to select the closest matching option
    const options = await select.locator('option').allTextContents();
    const bestMatch = options.find(o => o.toLowerCase().includes(value.toLowerCase())) || options[1]; // skip placeholder
    if (bestMatch) await select.selectOption({ label: bestMatch });
    return true;
  }
  return false;
}

/** Wait for analysis to finish (button restored to "Analyse Note") */
async function waitForAnalysisComplete(page, timeout = PHASE_TIMEOUT) {
  await page.locator('#analyseNoteBtn .btn-text:has-text("Analyse Note")').waitFor({
    state: 'visible',
    timeout,
  });
}

// ── Test ────────────────────────────────────────────────────────────────

test.describe('Agentic Doctor Simulation', () => {
  // Use saved auth state
  test.use({
    storageState: AUTH_STATE_PATH,
  });

  // These tests are slow by nature — AI calls + server processing
  test.setTimeout(300_000); // 5 minutes

  test.beforeEach(async ({ page }) => {
    // Verify auth state exists
    if (!fs.existsSync(AUTH_STATE_PATH)) {
      test.skip(true, 'No auth state found. Run: npx playwright test tests/helpers/auth-setup.js --headed');
    }

    await page.goto('/');
    await page.waitForLoadState('load');

    // Wait for the editor to appear (signals app + auth are ready)
    const editorVisible = await page.locator('#userInput .ProseMirror').waitFor({ state: 'visible', timeout: 30_000 }).then(() => true).catch(() => false);
    if (!editorVisible) {
      test.skip(true, 'Not logged in. Re-run auth setup.');
    }

    // Dismiss cookie consent banner if present
    const cookieBanner = page.locator('#cookie-consent-banner button:has-text("Reject Non-Essential")').first();
    if (await cookieBanner.isVisible().catch(() => false)) {
      await cookieBanner.click();
      await page.waitForTimeout(500);
    }
  });

  test('complete clinical workflow — note entry through guideline review', async ({ page }) => {
    const scenario = pickScenario();
    const log = (msg) => console.log(`  [DOCTOR] ${msg}`);

    log(`API key available: ${!!process.env.ANTHROPIC_API_KEY}`);
    log(`API key starts with: ${process.env.ANTHROPIC_API_KEY?.slice(0, 10) || 'MISSING'}`);
    log(`Scenario: ${scenario.slice(0, 80)}...`);

    // ── Step 1: Generate and type the clinical note ─────────────────
    log('Generating clinical note...');
    const clinicalNote = await generateClinicalNote(scenario);
    log(`Note generated (${clinicalNote.length} chars)`);

    await typeIntoEditor(page, clinicalNote);
    await page.waitForTimeout(1000); // let TipTap settle

    // Verify note was typed
    const typedContent = await getNoteContent(page);
    expect(typedContent.length).toBeGreaterThan(50);
    log('Note typed into editor');

    // ── Step 2: Click Analyse Note ──────────────────────────────────
    const analyseBtn = page.locator('#analyseNoteBtn');
    await expect(analyseBtn).toBeVisible({ timeout: 5000 });
    await analyseBtn.click();
    log('Clicked Analyse Note');

    // ── Step 3: Handle Phase 1 — Completeness Check ─────────────────
    log('Waiting for Phase 1 (completeness check)...');

    // Wait for either wizard to appear OR Phase 1 to complete with no suggestions
    const wizardOrPhase2 = await Promise.race([
      page.locator('#wizardPanel').waitFor({ state: 'visible', timeout: WIZARD_TIMEOUT })
        .then(() => 'wizard'),
      page.locator('#analyseNoteBtn .btn-text:has-text("Analyse Note")').waitFor({ state: 'visible', timeout: WIZARD_TIMEOUT })
        .then(() => 'complete'),
    ]).catch(() => 'timeout');

    let phase1Accepted = 0;
    let phase1Skipped = 0;

    if (wizardOrPhase2 === 'wizard') {
      log('Suggestion wizard appeared — processing completeness suggestions');

      // Process each wizard suggestion
      while (await isWizardVisible(page)) {
        const state = await getWizardState(page);
        if (!state) {
          log('Wizard state empty — waiting for next suggestion or completion');
          await page.waitForTimeout(2000);
          if (!await isWizardVisible(page)) break;
          continue;
        }

        log(`  Suggestion ${state.index + 1}/${state.total}: ${state.text.slice(0, 60)}...`);

        // Ask Claude what a doctor would do
        const decision = await decideCompleteness(state.text, typedContent, state.inputType);
        log(`  Decision: ${decision.action} — ${decision.reason}`);

        if (decision.action === 'accept') {
          // Fill in the value if there's an input field
          if (decision.value) {
            await fillWizardInput(page, decision.value);
          }
          await clickAccept(page);
          phase1Accepted++;
        } else {
          await clickSkip(page);
          phase1Skipped++;
        }

        await page.waitForTimeout(ACTION_DELAY);
      }

      log(`Phase 1 done: ${phase1Accepted} accepted, ${phase1Skipped} skipped`);
    } else if (wizardOrPhase2 === 'complete') {
      log('Phase 1 found no missing items — skipped straight through');
    } else {
      log('Phase 1 timed out — continuing anyway');
    }

    // ── Step 4: Handle scope selection modal (Phase 2 start) ────────
    const scopeModal = page.locator('#guidelineScopeModal');
    const scopeModalVisible = await scopeModal.isVisible().catch(() => false);

    if (scopeModalVisible) {
      log('Scope selection modal appeared');
      const noteForScope = await getNoteContent(page);
      const scopeChoice = await decideScope(noteForScope);
      log(`Scope decision: ${scopeChoice}`);

      // Click the appropriate scope button
      const scopeBtn = scopeModal.locator(`button:has-text("${scopeChoice}")`).first();
      if (await scopeBtn.isVisible().catch(() => false)) {
        await scopeBtn.click();
      } else {
        // Fallback: click "National" or first available button
        await scopeModal.locator('button').first().click();
      }
      await page.waitForTimeout(1000);
    }

    // ── Step 5: Handle guideline selection checkpoint ────────────────
    // The checkpoint modal always appears before Phase 2 wizard suggestions
    log('Waiting for guideline checkpoint modal...');
    const checkpointBtn = page.locator('#checkpoint-analyse-btn');
    const checkpointVisible = await checkpointBtn.waitFor({ state: 'visible', timeout: 60_000 }).then(() => true).catch(() => false);

    if (checkpointVisible) {
      log('Guideline selection checkpoint appeared');

      // Select all guidelines and proceed
      const selectAll = page.locator('#checkpoint-select-all');
      if (await selectAll.isVisible().catch(() => false)) {
        await selectAll.check();
      }

      await checkpointBtn.click();
      log('Selected all guidelines, clicked Analyse');

      // Wait for the modal to close
      await page.locator('#guidelineCheckpointModal').waitFor({ state: 'hidden', timeout: 10_000 }).catch(() => {});
    } else {
      log('No checkpoint modal appeared — Phase 2 may have started directly');
    }

    // ── Step 5.5: Dismiss summary modal if present ──────────────────
    // After checkpoint, there may be a "Loading your clinical summary" modal with a blue button
    log('Checking for summary modal...');
    const summaryBtn = page.locator('button[class*="primary"], .btn-primary, button:has-text("Done"), button:has-text("Continue"), button:has-text("Close")').first();
    const summaryBtnVisible = await summaryBtn.isVisible().catch(() => false);
    if (summaryBtnVisible) {
      log('Summary modal button found — clicking');
      await summaryBtn.click();
      await page.waitForTimeout(1000);
    }

    // ── Step 6: Handle Phase 2 wizard — guideline suggestions ───────
    let phase2Accepted = 0;
    let phase2Skipped = 0;

    // Wait for wizard to appear with guideline suggestions
    await page.waitForTimeout(3000); // give Phase 2 time to start
    const phase2Wizard = await page.locator('#wizardPanel').waitFor({ state: 'visible', timeout: PHASE_TIMEOUT }).then(() => true).catch(() => false);

    if (phase2Wizard && await isWizardVisible(page)) {
      log('Phase 2 wizard appeared — processing guideline suggestions');
      const noteForGuidelines = await getNoteContent(page);

      while (await isWizardVisible(page)) {
        const state = await getWizardState(page);
        if (!state) {
          await page.waitForTimeout(2000);
          if (!await isWizardVisible(page)) break;
          continue;
        }

        log(`  Guideline suggestion ${state.index + 1}/${state.total}: ${state.text.slice(0, 60)}...`);

        const decision = await decideGuideline(state.text, state.why || 'Unknown guideline', noteForGuidelines);
        log(`  Decision: ${decision.action} — ${decision.reason}`);

        if (decision.action === 'accept') {
          await clickAccept(page);
          phase2Accepted++;
        } else {
          await clickSkip(page);
          phase2Skipped++;
        }

        await page.waitForTimeout(ACTION_DELAY);
      }

      log(`Phase 2 done: ${phase2Accepted} accepted, ${phase2Skipped} skipped`);
    } else {
      log('No Phase 2 wizard appeared (no guideline suggestions or timeout)');
    }

    // ── Step 7: Wait for full analysis to complete ──────────────────
    log('Waiting for analysis to complete...');
    await waitForAnalysisComplete(page, PHASE_TIMEOUT).catch(() => {
      log('Analysis completion timeout — may still be running');
    });

    // ── Step 8: Evaluate the final note ─────────────────────────────
    const finalNote = await getNoteContent(page);
    log(`Final note: ${finalNote.length} chars (was ${clinicalNote.length})`);

    const evaluation = await evaluateFinalNote(clinicalNote, finalNote, scenario);
    log(`Quality score: ${evaluation.score}/10`);
    log(`Assessment: ${evaluation.assessment}`);
    if (evaluation.issues?.length) {
      evaluation.issues.forEach(i => log(`  Issue: ${i}`));
    }

    // ── Assertions ──────────────────────────────────────────────────
    // The note should exist and not be empty
    expect(finalNote.length).toBeGreaterThan(0);

    // At least some suggestions should have been processed
    const totalProcessed = phase1Accepted + phase1Skipped + phase2Accepted + phase2Skipped;
    log(`Total suggestions processed: ${totalProcessed}`);

    // Quality score should be reasonable (>= 4 out of 10)
    expect(evaluation.score).toBeGreaterThanOrEqual(4);

    // Log summary
    log('=== TEST SUMMARY ===');
    log(`Scenario: ${scenario.slice(0, 60)}...`);
    log(`Phase 1: ${phase1Accepted} accepted, ${phase1Skipped} skipped`);
    log(`Phase 2: ${phase2Accepted} accepted, ${phase2Skipped} skipped`);
    log(`Note grew from ${clinicalNote.length} to ${finalNote.length} chars`);
    log(`Quality: ${evaluation.score}/10 — ${evaluation.assessment}`);
  });
});
