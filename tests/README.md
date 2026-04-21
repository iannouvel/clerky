# Clerky AI Automated Tests

Comprehensive Playwright test suite for [clerkyai.health](https://clerkyai.health) - testing authentication, guideline discovery, AI-powered question answering, user preferences, and UI/UX.

## Setup

1. Install dependencies:
```bash
npm install
```

2. Install Playwright browsers (first time only):
```bash
npx playwright install
```

## Running Tests

### Run all tests (headless)
```bash
npm test
```

### Run tests with UI (interactive mode)
```bash
npm run test:ui
```

### Run tests in headed mode (see browser)
```bash
npm run test:headed
```

### Run specific test file
```bash
npx playwright test tests/auth.spec.js
```

### Run tests in specific browser
```bash
npx playwright test --project=chromium
npx playwright test --project=firefox
npx playwright test --project=webkit
```

### Debug mode (step through tests)
```bash
npm run test:debug
```

### View test report
```bash
npm run test:report
```

## Test Structure

```
tests/
├── auth.spec.js                  # Authentication flow tests
├── guideline-discovery.spec.js   # Guideline search and discovery
├── question-answering.spec.js    # AI-powered Q&A system
├── preferences.spec.js           # User settings and preferences
├── ui-ux.spec.js                # UI/UX and accessibility tests
└── README.md                     # This file
```

## Test Coverage

### Authentication Tests (`auth.spec.js`)
- Homepage loading
- Login button visibility
- Firebase auth modal opening
- Auth state persistence
- Sign-out functionality

### Guideline Discovery Tests (`guideline-discovery.spec.js`)
- Search interface display
- Clinical question processing
- Guideline results display
- Guideline detail navigation
- Relevant section highlighting
- Empty/invalid query handling
- Loading states
- Filter/sort functionality

### Question Answering Tests (`question-answering.spec.js`)
- AI-generated answers
- Guideline citation in answers
- Conversation context maintenance
- Medical information formatting
- Complex multi-part questions
- Clinical accuracy verification
- Copy/share functionality
- Medical terminology handling
- Clinical disclaimer presence
- Rapid successive questions

### Preferences Tests (`preferences.spec.js`)
- Settings page access
- Theme preference persistence
- Guideline source customization
- Notification preferences
- User profile display
- Privacy settings
- Language/region selection
- Keyboard shortcuts
- Help documentation access
- Accessibility features
- Terms of service links

### UI/UX Tests (`ui-ux.spec.js`)
- Mobile responsiveness
- No horizontal scroll on mobile
- Heading hierarchy
- Color contrast
- Focusable elements
- Image alt text
- Form labels
- Performance (load time)
- Network error handling
- Skip navigation links
- Console errors
- Copyright/version info
- Dark mode support

## Configuration

Test configuration is in `playwright.config.js`. Key settings:

- **Base URL**: `https://clerkyai.health`
- **Timeout**: 60 seconds per test
- **Retries**: 2 on CI, 0 locally
- **Browsers**: Chromium, Firefox, WebKit, Mobile Chrome, Mobile Safari
- **Screenshots**: Captured on failure
- **Videos**: Retained on failure
- **Traces**: Collected on first retry

## Writing New Tests

Follow this pattern:

```javascript
import { test, expect } from '@playwright/test';

test.describe('Feature Name', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
  });

  test('should do something', async ({ page }) => {
    // Test implementation
    const element = page.locator('selector');
    await expect(element).toBeVisible();
  });
});
```

## CI/CD Integration

Tests can be integrated into GitHub Actions or other CI/CD pipelines:

```yaml
- name: Install dependencies
  run: npm ci

- name: Install Playwright browsers
  run: npx playwright install --with-deps

- name: Run tests
  run: npm test
```

## Debugging Tips

1. **Use UI Mode**: `npm run test:ui` - Interactive test runner with time travel debugging
2. **Use Debug Mode**: `npm run test:debug` - Step through tests in browser
3. **View Traces**: Test traces are saved on failure - open with `npx playwright show-trace`
4. **Screenshots**: Check `test-results/` folder for failure screenshots
5. **Console Logs**: Add `await page.pause()` to pause test execution

## Test Data

- Tests run against production (`clerkyai.health`)
- No test accounts or mock data currently configured
- Some tests may require authentication to work fully
- Consider setting up Firebase emulator for auth testing

## Maintenance

- Update selectors if UI changes
- Add new tests when features are added
- Keep Playwright updated: `npm update @playwright/test`
- Review test results regularly

## Resources

- [Playwright Documentation](https://playwright.dev)
- [Playwright API Reference](https://playwright.dev/docs/api/class-playwright)
- [Best Practices](https://playwright.dev/docs/best-practices)

## Support

For issues or questions about the test suite, contact the development team or open an issue in the repository.
