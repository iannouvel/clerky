#!/usr/bin/env node

/**
 * Automated improvement testing script
 *
 * 1. Exports feedback from dev.html
 * 2. Creates improvements from new feedback items
 * 3. Tests all improvements with "testing" status
 * 4. Records results and commits changes
 *
 * Usage:
 *   node test-all-improvements.js [--no-export]
 *   --no-export: Skip feedback export, just test existing improvements
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { chromium } = require('playwright');

const improvementsPath = path.join(__dirname, 'improvements.json');
const skipExport = process.argv.includes('--no-export');
const downloadDir = path.join(__dirname, '.playwright-downloads');

// Ensure download directory exists
if (!fs.existsSync(downloadDir)) {
  fs.mkdirSync(downloadDir, { recursive: true });
}

// Read improvements.json
let improvements = {};
try {
  if (fs.existsSync(improvementsPath)) {
    improvements = JSON.parse(fs.readFileSync(improvementsPath, 'utf-8'));
  }
} catch (err) {
  console.error('❌ Error reading improvements.json:', err.message);
  process.exit(1);
}

// Function to export feedback from dev.html Feedback tab
async function exportFeedbackFromUI() {
  if (skipExport) {
    console.log('⏭️  Skipping feedback export (--no-export flag set)\n');
    return [];
  }

  console.log('📤 Exporting feedback from dev.html/Feedback tab...\n');

  let feedbackItems = [];
  const browser = await chromium.launch();

  try {
    const context = await browser.newContext();
    const page = await context.newPage();

    // Navigate to dev.html
    const devHtmlPath = path.join(__dirname, 'dev.html');
    const fileUrl = 'file:///' + devHtmlPath.replace(/\\/g, '/');

    console.log('   Opening dev.html...');
    await page.goto(fileUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);

    // Try to trigger feedback loading directly via JavaScript
    console.log('   Triggering feedback load via JavaScript...');

    await page.evaluate(() => {
      // Show the feedback content div
      const feedbackContent = document.getElementById('feedbackContent');
      if (feedbackContent) {
        feedbackContent.style.display = 'block';
      }

      // Mark button as active
      const feedbackBtn = document.querySelector('button[data-content="feedbackContent"]');
      if (feedbackBtn) {
        feedbackBtn.classList.add('active');
      }

      // Try to call loadFeedback if it exists
      if (typeof loadFeedback === 'function') {
        loadFeedback();
      }
    });

    console.log('   Waiting for feedback to load from Firestore...');
    // Wait longer for Firebase to fetch data
    await page.waitForTimeout(4000);

    // Extract feedback data from the page
    try {
      const debugInfo = await page.evaluate(() => {
        return {
          cacheExists: !!window._feedbackCache,
          cacheLength: window._feedbackCache?.length || 0,
          tableRows: document.querySelectorAll('#feedbackTableBody tr').length,
          feedbackBtnActive: document.querySelector('button[data-content="feedbackContent"]')?.classList.contains('active'),
          contentVisible: document.getElementById('feedbackContent')?.style.display !== 'none'
        };
      });

      console.log(`   Debug: Cache=${debugInfo.cacheLength}, Rows=${debugInfo.tableRows}, Active=${debugInfo.feedbackBtnActive}, Visible=${debugInfo.contentVisible}`);

      const data = await page.evaluate(() => {
        // Try to access the feedback cache that dev.js populates
        if (window._feedbackCache && window._feedbackCache.length > 0) {
          return { source: 'cache', data: window._feedbackCache };
        }

        // If that fails, try to find the table data
        const rows = document.querySelectorAll('#feedbackTableBody tr');
        if (rows.length > 0) {
          return {
            source: 'table',
            data: Array.from(rows).map(row => ({
              id: row.getAttribute('data-id') || 'unknown',
              timestamp: row.cells[0]?.textContent.trim() || new Date().toISOString(),
              user: row.cells[1]?.textContent.trim() || 'unknown',
              feedback: row.cells[2]?.textContent.trim() || '',
              context: row.cells[3]?.textContent.trim() || '',
              status: row.cells[4]?.textContent.trim() || 'unactioned'
            }))
          };
        }
        return { source: 'none', data: [] };
      });

      if (data.data && data.data.length > 0) {
        feedbackItems = data.data;
        console.log(`✅ Exported ${feedbackItems.length} feedback item(s) from ${data.source}\n`);
      } else {
        console.log(`⚠️  No feedback items found (${data.source})\n`);
        console.log('💡 Tip: Make sure dev.html has loaded and the Feedback tab shows data\n');
      }
    } catch (evalErr) {
      console.log(`⚠️  Error reading feedback data: ${evalErr.message}\n`);
    }

    await context.close();
  } catch (err) {
    console.log(`⚠️  Error accessing dev.html: ${err.message}\n`);
  } finally {
    await browser.close();
  }

  return feedbackItems;
}

// Export feedback and create improvements
(async () => {
  const feedbackItems = await exportFeedbackFromUI();

  // Create improvements from new feedback items
  if (feedbackItems.length > 0) {
    console.log('📝 Creating improvements from feedback...\n');

    let newImprovements = [];

    for (const feedback of feedbackItems) {
      // Skip if this feedback is already addressed
      const alreadyAddressed = Object.values(improvements).some(imp =>
        imp.relatedFeedback?.includes(feedback.id)
      );

      if (alreadyAddressed) continue;

      // Generate version number
      const versions = Object.keys(improvements)
        .filter(k => k.startsWith('v'))
        .map(k => {
          const match = k.match(/v(\d+)\.(\d+)\.(\d+)/);
          return match ? parseInt(match[3]) : 0;
        });

      const nextPatch = Math.max(...versions, 248) + 1;
      const nextVersion = `v9.0.${nextPatch}`;

      if (improvements[nextVersion]) continue; // Skip if exists

      const improvement = {
        title: feedback.summary || feedback.category || 'Feedback-driven improvement',
        description: feedback.feedback || feedback.issue || 'From user feedback',
        relatedFeedback: [feedback.id],
        status: 'testing',
        implementation: {
          commit: 'N/A',
          files: [],
          description: 'Implementation pending'
        },
        testPlan: [
          `Verify fix for: ${feedback.summary || 'user feedback'}`,
          'Manual test the reported scenario',
          'Ensure no regressions'
        ],
        testResults: []
      };

      improvements[nextVersion] = improvement;
      newImprovements.push(nextVersion);

      console.log(`✅ Created ${nextVersion}: ${improvement.title}`);
    }

    if (newImprovements.length > 0) {
      fs.writeFileSync(improvementsPath, JSON.stringify(improvements, null, 2), 'utf-8');
      console.log(`\n📝 Updated improvements.json with ${newImprovements.length} new improvement(s)\n`);
    }
  }

  // Re-fetch testing versions (new improvements may have been added)
  const updatedTestingVersions = Object.entries(improvements)
    .filter(([key, entry]) => entry.status === 'testing' && typeof entry === 'object')
    .map(([version]) => version);

  if (updatedTestingVersions.length === 0) {
    console.log('✅ No improvements in "testing" status to test.\n');
    return;
  }

  // Continue with testing
  console.log(`\n🧪 Running tests for ${updatedTestingVersions.length} improvement(s)...\n`);

  const testResults = [];

    for (const version of updatedTestingVersions) {
    const improvement = improvements[version];
    const title = improvement.title || 'Unknown';

    // Derive test pattern from version and title
    // Pattern: "assess v9.0.249 data awareness filter"
    const testPattern = `assess ${version} ${title.toLowerCase()}`;

    console.log(`📋 Testing ${version}: ${title}`);
    console.log(`   Pattern: "${testPattern}"`);

    try {
      // Run the playwright test
      const testCommand = `npx playwright test tests/agentic-doctor.spec.js --grep "${testPattern}"`;
      const output = execSync(testCommand, { encoding: 'utf-8', stdio: 'pipe' });

      // Check if test passed by looking for "passed" in output
      const passed = output.includes('1 passed') || output.includes('✓');

      // Extract notes from test output if available
      let notes = '';
      const detailsMatch = output.match(/Details: (.+?)(?:\n|$)/);
      if (detailsMatch) {
        notes = detailsMatch[1];
      }

      if (passed) {
        console.log(`   ✅ PASSED`);
        if (notes) console.log(`   ${notes}`);
        testResults.push({ version, passed: true, notes });
      } else {
        console.log(`   ❌ FAILED`);
        testResults.push({ version, passed: false, notes: notes || 'Test failed' });
      }
    } catch (err) {
      // Test failed
      console.log(`   ❌ FAILED (error running test)`);
      testResults.push({ version, passed: false, notes: err.message || 'Test execution failed' });
    }

    console.log('');
  }

  // Record results directly in improvements.json
  console.log('📝 Recording test results...\n');

  for (const { version, passed, notes } of testResults) {
    try {
      if (!improvements[version].testResults) {
        improvements[version].testResults = [];
      }

      // Add test result
      const testResult = {
        testedAt: new Date().toISOString().split('T')[0],
        passed: passed,
        notes: notes || (passed ? 'Test passed' : 'Test failed'),
      };

      improvements[version].testResults.push(testResult);

      // Update status
      if (passed) {
        improvements[version].status = 'resolved';
      } else {
        improvements[version].status = 'testing';
      }

      console.log(`✅ Updated ${version} with test result: ${passed ? 'PASSED' : 'FAILED'}`);
      if (notes) console.log(`   ${notes}`);
    } catch (err) {
      console.error(`❌ Failed to record result for ${version}:`, err.message);
    }
  }

  // Write updated improvements.json
  try {
    fs.writeFileSync(improvementsPath, JSON.stringify(improvements, null, 2), 'utf-8');
    console.log('\n✅ Updated improvements.json');
  } catch (err) {
    console.error('❌ Error writing improvements.json:', err.message);
    process.exit(1);
  }

  // Commit and push if any tests passed
  const passedCount = testResults.filter(r => r.passed).length;

  if (passedCount > 0) {
    console.log(`\n🚀 Committing and pushing ${passedCount} resolved improvement(s)...\n`);

    try {
      // Pull first to get latest remote changes
      console.log('📥 Pulling latest changes...');
      execSync('git pull --rebase', { stdio: 'inherit' });

      // Reload improvements.json in case it changed
      improvements = JSON.parse(fs.readFileSync(improvementsPath, 'utf-8'));

      // Stage improvements.json
      execSync('git add improvements.json', { stdio: 'inherit' });

      // Get current version to calculate next
      const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf-8'));
      const currentVersion = packageJson.version;
      const [major, minor, patch] = currentVersion.split('.');
      const nextVersion = `v${major}.${minor}.${parseInt(patch) + 1}`;

      // Commit with version prefix
      const commitMsg = `${nextVersion} Record passing tests for ${passedCount} improvement(s)`;
      execSync(`git commit -m "${commitMsg}"`, { stdio: 'inherit' });

      // Push
      execSync('git push', { stdio: 'inherit' });

      console.log(`\n✅ Successfully pushed ${passedCount} improvement(s)!`);
    } catch (err) {
      console.error('\n❌ Error during git operations:', err.message);
      process.exit(1);
    }
  } else {
    console.log('\n⚠️  No improvements passed testing. Skipping commit.');
  }
})().catch(err => {
  console.error('❌ Fatal error:', err.message);
  process.exit(1);
});
