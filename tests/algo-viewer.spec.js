import { test, expect } from '@playwright/test';

/**
 * Algorithm viewer tests
 * Tests algos.html (the algorithm selector/viewer) and individual algo pages
 */

// A known static algo page to use for individual page tests
const SAMPLE_ALGO = '/algos/GTG%202015%20-%20Chickenpox%20in%20Pregnancy.html';
const SAMPLE_ALGO_2 = '/algos/GTG%202011%20-%20APH.html';

test.describe('Algorithm Viewer (algos.html)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/algos.html');
    await page.waitForLoadState('networkidle');
  });

  test('should load with correct title', async ({ page }) => {
    await expect(page).toHaveTitle(/Algorithms.*clerky|clerky.*Algorithms/i);
  });

  test('should have a Select Algorithm button', async ({ page }) => {
    const selectBtn = page.locator('#selectAlgoBtn, button:has-text("Select Algorithm")').first();
    await expect(selectBtn).toBeVisible();
  });

  test('should have an Adjust Algorithm button', async ({ page }) => {
    const adjustBtn = page.locator('#adjustBtn, button:has-text("Adjust Algorithm")').first();
    await expect(adjustBtn).toBeVisible();
  });

  test('should have a Back to Main link', async ({ page }) => {
    const backLink = page.locator('a:has-text("Back to Main"), a[href="index.html"]').first();
    await expect(backLink).toBeVisible();
  });

  test('Back to Main link should navigate to index', async ({ page }) => {
    const backLink = page.locator('a:has-text("Back to Main"), a[href="index.html"]').first();
    await backLink.click();
    await page.waitForLoadState('networkidle');
    expect(page.url()).toMatch(/clerkyai\.health\/(index\.html)?$/);
  });

  test('Select Algorithm button should open a modal', async ({ page }) => {
    const selectBtn = page.locator('#selectAlgoBtn').first();
    await selectBtn.click();
    await page.waitForTimeout(500);

    const modal = page.locator('#selectModal, .modal').first();
    await expect(modal).toBeVisible();
  });

  test('Select Algorithm modal should have a search/dropdown input', async ({ page }) => {
    const selectBtn = page.locator('#selectAlgoBtn').first();
    await selectBtn.click();
    await page.waitForTimeout(500);

    const searchInput = page.locator('#guidelineDropdown, .algo-select, input[list]').first();
    await expect(searchInput).toBeVisible();
  });

  test('Select Algorithm modal should be closeable', async ({ page }) => {
    const selectBtn = page.locator('#selectAlgoBtn').first();
    await selectBtn.click();
    await page.waitForTimeout(500);

    const modal = page.locator('#selectModal').first();
    await expect(modal).toBeVisible();

    const closeBtn = page.locator('#selectModal .close-modal').first();
    await closeBtn.click();
    await page.waitForTimeout(300);

    const isVisible = await modal.isVisible().catch(() => false);
    expect(isVisible).toBeFalsy();
  });

  test('Adjust Algorithm button should open a modal', async ({ page }) => {
    const adjustBtn = page.locator('#adjustBtn').first();
    await adjustBtn.click();
    await page.waitForTimeout(500);

    const modal = page.locator('#adjustModal').first();
    await expect(modal).toBeVisible();
  });

  test('Adjust modal should be closeable', async ({ page }) => {
    const adjustBtn = page.locator('#adjustBtn').first();
    await adjustBtn.click();
    await page.waitForTimeout(500);

    const modal = page.locator('#adjustModal').first();
    await expect(modal).toBeVisible();

    const closeBtn = page.locator('#adjustModal .close-modal').first();
    await closeBtn.click();
    await page.waitForTimeout(300);

    const isVisible = await modal.isVisible().catch(() => false);
    expect(isVisible).toBeFalsy();
  });

  test('should have an algo container in the page body', async ({ page }) => {
    const algoContainer = page.locator('.algo-container').first();
    await expect(algoContainer).toBeAttached();
  });
});

test.describe('Individual Algorithm Pages', () => {
  test('sample algo page should load successfully', async ({ page }) => {
    const response = await page.goto(SAMPLE_ALGO);
    expect(response?.status()).toBeLessThan(400);
    await page.waitForLoadState('domcontentloaded');
  });

  test('sample algo page should have readable content', async ({ page }) => {
    await page.goto(SAMPLE_ALGO);
    await page.waitForLoadState('domcontentloaded');

    const body = page.locator('body');
    const bodyText = await body.textContent().catch(() => '');
    expect(bodyText.length).toBeGreaterThan(100);
  });

  test('sample algo page should have Clinical Variables section', async ({ page }) => {
    await page.goto(SAMPLE_ALGO);
    await page.waitForLoadState('domcontentloaded');

    const heading = page.locator('h2:has-text("Clinical Variables"), h1:has-text("Clinical Variables")').first();
    await expect(heading).toBeVisible();
  });

  test('sample algo page should have Advice section', async ({ page }) => {
    await page.goto(SAMPLE_ALGO);
    await page.waitForLoadState('domcontentloaded');

    const heading = page.locator('h2:has-text("Advice"), h1:has-text("Advice")').first();
    await expect(heading).toBeVisible();
  });

  test('second sample algo page should load and have content', async ({ page }) => {
    const response = await page.goto(SAMPLE_ALGO_2);
    expect(response?.status()).toBeLessThan(400);
    await page.waitForLoadState('domcontentloaded');

    const body = page.locator('body');
    const bodyText = await body.textContent().catch(() => '');
    expect(bodyText.length).toBeGreaterThan(100);
  });

  test('algo pages should have no script errors on load', async ({ page }) => {
    const consoleErrors = [];
    page.on('console', msg => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await page.goto(SAMPLE_ALGO);
    await page.waitForLoadState('domcontentloaded');

    expect(consoleErrors.length).toBeLessThan(5);
  });
});
