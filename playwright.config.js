import { defineConfig, devices } from '@playwright/test';

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
    },
  ],

  // Run local dev server before starting tests (optional)
  // webServer: {
  //   command: 'npm run start',
  //   url: 'http://localhost:3000',
  //   reuseExistingServer: !process.env.CI,
  // },
});
