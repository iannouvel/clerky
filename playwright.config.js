import { defineConfig, devices } from '@playwright/test';
import fs from 'fs';
import path from 'path';

// Load .env manually (avoids CJS/ESM issues with dotenv)
try {
  const envPath = path.resolve('.env');
  const envContent = fs.readFileSync(envPath, 'utf8');
  for (const line of envContent.split('\n')) {
    const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
    if (match && !process.env[match[1]]) {
      process.env[match[1]] = (match[2] || '').replace(/^["']|["']$/g, '');
    }
  }
} catch {}

/**
 * Playwright configuration for clerkyai.health testing
 * @see https://playwright.dev/docs/test-configuration
 */
export default defineConfig({
  testDir: './tests',

  // Maximum time one test can run
  timeout: 60 * 1000,

  // Run tests sequentially to avoid disk/memory pressure
  fullyParallel: false,

  // Fail the build on CI if you accidentally left test.only in the source code
  forbidOnly: !!process.env.CI,

  // No retries locally
  retries: 0,

  // Limit concurrent workers to reduce resource usage
  workers: 2,

  // Lightweight reporter - no HTML (creates large asset folders)
  reporter: [
    ['list'],
  ],

  // Shared settings for all projects
  use: {
    // Base URL for tests
    baseURL: 'https://clerkyai.health',

    // No screenshots, video, or traces - these eat disk space fast
    screenshot: 'off',
    video: 'off',
    trace: 'off',

    // Set viewport
    viewport: { width: 1280, height: 720 },
  },

  // Chromium only for now - add more browsers once stable
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      testIgnore: /agentic|auth-setup/,  // skip slow tests by default
    },
    {
      name: 'agentic',
      use: {
        ...devices['Desktop Chrome'],
        // Record video for agentic tests so we can review the "doctor" session
        video: 'retain-on-failure',
      },
      testMatch: /agentic.*\.spec/,
      timeout: 300_000,  // 5 minutes per test
    },
    {
      name: 'auth-setup',
      use: {
        ...devices['Desktop Chrome'],
        channel: 'chrome',  // use real Chrome — Google blocks Playwright's Chromium for OAuth
      },
      testMatch: /auth-setup/,
      timeout: 180_000,
    },
  ],

  // Run local dev server before starting tests (optional)
  // webServer: {
  //   command: 'npm run start',
  //   url: 'http://localhost:3000',
  //   reuseExistingServer: !process.env.CI,
  // },
});
