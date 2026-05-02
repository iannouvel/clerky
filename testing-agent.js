#!/usr/bin/env node

/**
 * Automated Testing & Feedback Agent
 *
 * Runs comprehensive agentic tests, captures failures as feedback,
 * automatically creates improvements.json entries, and optionally tests them.
 *
 * Usage:
 *   node testing-agent.js [--auto-test]
 *   --auto-test: Automatically run improvements agent after creating entries
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const improvementsPath = path.join(__dirname, 'improvements.json');
const autoTest = process.argv.includes('--auto-test');

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

console.log('\n======================================');
console.log('  Testing & Feedback Agent');
console.log('======================================\n');

console.log('🧪 Running comprehensive agentic tests...\n');
console.log('(You should see test progress below)\n');

let testsPassed = true;

try {
  execSync('npx playwright test tests/agentic-doctor.spec.js', {
    stdio: 'inherit'
  });
  testsPassed = true;
} catch (err) {
  testsPassed = false;
}

if (testsPassed) {
  console.log('\n✅ All tests passed! No feedback to generate.\n');
  process.exit(0);
}

// If tests failed, try to parse results for improvements
console.log('\n📋 Parsing test results...\n');

let testResults = {};
try {
  const output = execSync('npx playwright test tests/agentic-doctor.spec.js --reporter=json 2>/dev/null', {
    encoding: 'utf-8',
    stdio: 'pipe',
    timeout: 120000
  });
  testResults = JSON.parse(output);
} catch (err) {
  console.log('⚠️  Could not parse detailed results, but tests were run.\n');
  testResults = { suites: [] };
}

// Extract failures from JSON results
const failures = [];
if (testResults.suites) {
  for (const suite of testResults.suites) {
    if (suite.specs) {
      for (const spec of suite.specs) {
        if (spec.tests) {
          for (const test of spec.tests) {
            if (test.status === 'failed' || test.status === 'flaky') {
              failures.push({
                title: test.title || 'Unknown Test',
                file: test.file || 'Unknown',
                error: test.error?.message || 'Test failed',
                status: test.status
              });
            }
          }
        }
      }
    }
  }
}

if (failures.length === 0) {
  console.log('✅ All tests passed! No feedback to generate.\n');
  process.exit(0);
}

console.log(`📋 Found ${failures.length} test failure(s). Creating improvements...\n`);

const newImprovements = [];

for (const failure of failures) {
  // Generate version number (v9.0.XXX)
  const versions = Object.keys(improvements)
    .filter(k => k.startsWith('v'))
    .map(k => {
      const match = k.match(/v(\d+)\.(\d+)\.(\d+)/);
      return match ? parseInt(match[3]) : 0;
    });

  const nextPatch = Math.max(...versions, 248) + 1;
  const nextVersion = `v9.0.${nextPatch}`;

  // Skip if this version already exists
  if (improvements[nextVersion]) {
    console.log(`⏭️  Skipping ${nextVersion} (already exists)`);
    continue;
  }

  // Generate improvement entry from failure
  const testName = failure.title
    .replace(/^assess /, '') // Remove "assess" prefix
    .replace(/— .+$/, '') // Remove details after em-dash
    .trim();

  const improvement = {
    title: testName || `Fix: ${failure.error.substring(0, 50)}...`,
    description: `Test failure detected: ${failure.error.substring(0, 100)}...`,
    relatedFeedback: [],
    status: 'testing',
    implementation: {
      commit: 'N/A',
      files: [],
      description: 'Implementation pending'
    },
    testPlan: [
      `Agentic: Run test '${failure.title}' - should pass`,
      'Manual: Verify the fix resolves the original issue',
      'Console: Check for error messages or warnings'
    ],
    testResults: []
  };

  improvements[nextVersion] = improvement;
  newImprovements.push(nextVersion);

  console.log(`✅ Created ${nextVersion}: ${improvement.title}`);
}

// Write updated improvements.json
try {
  fs.writeFileSync(improvementsPath, JSON.stringify(improvements, null, 2), 'utf-8');
  console.log(`\n📝 Updated improvements.json with ${newImprovements.length} new improvement(s)\n`);
} catch (err) {
  console.error('❌ Error writing improvements.json:', err.message);
  process.exit(1);
}

// Optionally run improvements agent
if (autoTest && newImprovements.length > 0) {
  console.log('🚀 Auto-testing new improvements...\n');
  try {
    execSync('node test-all-improvements.js', { stdio: 'inherit' });
  } catch (err) {
    console.log('⚠️  Improvements agent encountered an error (see above)');
  }
} else if (newImprovements.length > 0) {
  console.log('💡 Next step: run `node run-improvements-agent.bat` to test the new improvements\n');
}
