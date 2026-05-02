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

// Function to export feedback from dev.html
async function exportFeedbackFromUI() {
  if (skipExport) {
    console.log('⏭️  Skipping feedback export (--no-export flag set)\n');
    return [];
  }

  console.log('📤 Exporting feedback from feedback.html...\n');

  let feedbackItems = [];
  const browser = await chromium.launch();

  try {
    const context = await browser.newContext({
      acceptDownloads: true,
    });
    const page = await context.newPage();

    // Navigate to feedback.html with file protocol
    const feedbackHtmlPath = path.join(__dirname, 'feedback.html');
    const fileUrl = 'file:///' + feedbackHtmlPath.replace(/\\/g, '/');

    await page.goto(fileUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000); // Wait for Firebase and JS to initialize

    // Look for the export button
    const exportBtn = page.locator('#feedbackExportBtn');

    try {
      const isVisible = await exportBtn.isVisible({ timeout: 3000 }).catch(() => false);

      if (!isVisible) {
        console.log('⚠️  Feedback export button not found on the page\n');
        console.log('💡 Tip: Make sure feedback.html is accessible and Firebase has loaded\n');
      } else {
        // Set up download listener BEFORE clicking
        let downloadData = null;
        const downloadPromise = page.waitForEvent('download', { timeout: 8000 });

        await exportBtn.click();
        console.log('   Clicked export button, waiting for download...');

        try {
          const download = await downloadPromise;
          const fileName = download.suggestedFilename();
          const filePath = path.join(downloadDir, fileName);
          await download.saveAs(filePath);

          // Read the exported JSON
          const feedbackJSON = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
          feedbackItems = feedbackJSON || [];
          console.log(`✅ Exported ${feedbackItems.length} feedback item(s)\n`);
        } catch (downloadErr) {
          console.log(`⚠️  Download error: ${downloadErr.message}\n`);
          console.log('💡 The export button may not be functional in file:// protocol. You can manually export from feedback.html in your browser.\n');
        }
      }
    } catch (err) {
      console.log(`⚠️  Error checking export button: ${err.message}\n`);
    }

    await context.close();
  } catch (err) {
    console.log(`⚠️  Error exporting feedback: ${err.message}\n`);
  } finally {
    await browser.close();
  }

  // If no items exported via browser, try to find manually exported feedback files
  if (feedbackItems.length === 0) {
    console.log('💡 Looking for manually exported feedback files...\n');

    try {
      // Look for feedback-export-*.json files in the project directory
      const files = fs.readdirSync(__dirname);
      const feedbackFiles = files.filter(f => f.match(/^feedback-export-.*\.json$/));

      if (feedbackFiles.length > 0) {
        // Use the most recent one
        const mostRecent = feedbackFiles.sort().pop();
        const filePath = path.join(__dirname, mostRecent);
        const feedbackJSON = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        feedbackItems = feedbackJSON || [];
        console.log(`✅ Found and loaded ${mostRecent} (${feedbackItems.length} items)\n`);
      } else {
        console.log('⚠️  No exported feedback files found\n');
        console.log('💡 To use the full loop:\n');
        console.log('   1. Open feedback.html in your browser\n');
        console.log('   2. Click "Export JSON"\n');
        console.log('   3. Save the file as feedback-export-*.json in this directory\n');
        console.log('   4. Run the agent again\n');
      }
    } catch (err) {
      console.log(`⚠️  Error looking for feedback files: ${err.message}\n`);
    }
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
