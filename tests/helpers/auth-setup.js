/**
 * Auth setup for Playwright tests.
 *
 * Google blocks OAuth in automated browsers, so we grab the session
 * from your real Chrome profile instead.
 *
 * Two modes:
 *   Mode 1 (automatic): Launches Chrome using your real profile.
 *           Close all Chrome windows first, then run: npm run test:auth
 *
 *   Mode 2 (manual fallback): If mode 1 fails, paste a script in your
 *           browser console — see instructions printed on failure.
 */
import { test as setup, chromium } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import os from 'os';

const AUTH_STATE_PATH = path.join(import.meta.dirname, '..', '.auth', 'state.json');

// Find the real Chrome user data directory
function getChromeUserDataDir() {
  const platform = os.platform();
  const home = os.homedir();
  if (platform === 'win32') return path.join(home, 'AppData', 'Local', 'Google', 'Chrome', 'User Data');
  if (platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'Google', 'Chrome');
  return path.join(home, '.config', 'google-chrome'); // Linux
}

setup('save auth state', async () => {
  // Ensure .auth directory exists
  const authDir = path.dirname(AUTH_STATE_PATH);
  if (!fs.existsSync(authDir)) fs.mkdirSync(authDir, { recursive: true });

  const chromeDataDir = getChromeUserDataDir();
  console.log(`\nUsing Chrome profile: ${chromeDataDir}`);
  console.log('IMPORTANT: Close all Chrome windows before running this!\n');

  let context;
  try {
    // Launch using real Chrome profile — already logged into Google
    context = await chromium.launchPersistentContext(chromeDataDir, {
      headless: false,
      channel: 'chrome',
      viewport: { width: 1280, height: 720 },
      args: ['--disable-extensions'],  // avoid extension conflicts
    });
  } catch (err) {
    console.error('\nFailed to launch with Chrome profile.');
    console.error('Make sure ALL Chrome windows are closed first.\n');
    console.error('Error:', err.message);
    printManualInstructions();
    throw err;
  }

  const page = context.pages()[0] || await context.newPage();
  await page.goto('https://clerkyai.health');
  await page.waitForLoadState('networkidle');

  // Check if already logged in from the Chrome profile
  const loggedIn = await page.locator('#userInput[contenteditable]').isVisible().catch(() => false);

  if (!loggedIn) {
    console.log('Not logged in yet. Clicking sign-in...');

    // Try clicking the sign-in button — should work without popup issues
    // since this is the real Chrome with real Google session
    const signInBtn = page.locator('button:has-text("Sign in with Google"), .google-sign-in, [data-provider="google"]').first();
    if (await signInBtn.isVisible().catch(() => false)) {
      await signInBtn.click();
    }

    console.log('Waiting for login to complete (up to 2 minutes)...');
    await page.locator('#userInput[contenteditable]').waitFor({ state: 'visible', timeout: 120_000 });
  }

  console.log('Logged in! Saving auth state...');
  await page.waitForTimeout(3000);

  // Export localStorage manually since persistent contexts don't support storageState well
  const storageData = await page.evaluate(() => {
    const storage = {};
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      storage[key] = localStorage.getItem(key);
    }
    return {
      cookies: document.cookie,
      localStorage: storage,
      origin: window.location.origin,
    };
  });

  // Build Playwright-compatible storage state
  const state = {
    cookies: [],
    origins: [{
      origin: storageData.origin,
      localStorage: Object.entries(storageData.localStorage).map(([name, value]) => ({ name, value })),
    }],
  };

  fs.writeFileSync(AUTH_STATE_PATH, JSON.stringify(state, null, 2));
  console.log(`\nAuth state saved to ${AUTH_STATE_PATH}`);

  await context.close();
});

function printManualInstructions() {
  console.log(`
╔══════════════════════════════════════════════════════════════╗
║  MANUAL FALLBACK — if automatic mode doesn't work:          ║
║                                                              ║
║  1. Open Chrome and go to https://clerkyai.health            ║
║  2. Log in normally                                          ║
║  3. Open DevTools (F12) → Console tab                        ║
║  4. Paste this and press Enter:                              ║
║                                                              ║
║     copy(JSON.stringify({cookies:[],origins:[{               ║
║       origin:location.origin,                                ║
║       localStorage:Object.entries(localStorage)              ║
║         .map(([k,v])=>({name:k,value:v}))}]},null,2))       ║
║                                                              ║
║  5. Create the file tests/.auth/state.json                   ║
║  6. Paste the clipboard contents into it                     ║
║  7. Run: npm run test:agentic                                ║
╚══════════════════════════════════════════════════════════════╝
`);
}
