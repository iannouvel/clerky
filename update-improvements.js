#!/usr/bin/env node

/**
 * Update improvements.json with test results
 *
 * Usage:
 *   node update-improvements.js <version> [--passed|--failed] [--notes="..."]
 *
 * Examples:
 *   node update-improvements.js v9.0.249 --passed --notes="Data awareness filter working correctly"
 *   node update-improvements.js v9.0.249 --failed --notes="Filter failed on blood pressure suggestions"
 */

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
if (args.length < 2) {
  console.error('Usage: node update-improvements.js <version> [--passed|--failed] [--notes="..."]');
  process.exit(1);
}

const version = args[0];
const passed = args.includes('--passed');
const failed = args.includes('--failed');
const notesArg = args.find(arg => arg.startsWith('--notes='));
const notes = notesArg ? notesArg.split('=')[1] : '';

if (!passed && !failed) {
  console.error('Must specify --passed or --failed');
  process.exit(1);
}

// Read improvements.json
const filePath = path.join(__dirname, 'improvements.json');
let improvements = {};

try {
  if (fs.existsSync(filePath)) {
    improvements = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  }
} catch (err) {
  console.error('Error reading improvements.json:', err.message);
  process.exit(1);
}

// Ensure the version entry exists
if (!improvements[version]) {
  console.error(`Version ${version} not found in improvements.json`);
  process.exit(1);
}

// Ensure testResults array exists
if (!Array.isArray(improvements[version].testResults)) {
  improvements[version].testResults = [];
}

// Add new test result
const testResult = {
  testedAt: new Date().toISOString().split('T')[0],
  passed: passed,
  notes: notes || (passed ? 'Test passed' : 'Test failed'),
};

improvements[version].testResults.push(testResult);

// Update status based on latest test result
if (passed) {
  improvements[version].status = 'resolved';
} else {
  improvements[version].status = 'testing'; // Keep testing if failed
}

// Write back to file
try {
  fs.writeFileSync(filePath, JSON.stringify(improvements, null, 2), 'utf-8');
  console.log(`✅ Updated ${version} with test result: ${passed ? 'PASSED' : 'FAILED'}`);
  console.log(`   Status: ${improvements[version].status}`);
  console.log(`   Notes: ${notes}`);
  console.log(`\nImprovement entry:`);
  console.log(JSON.stringify(improvements[version], null, 2));
} catch (err) {
  console.error('Error writing improvements.json:', err.message);
  process.exit(1);
}
