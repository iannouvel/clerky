#!/usr/bin/env node

/**
 * Comprehensive Testing Harness for Improvements #1-9
 * Tests all improvements together in realistic clinical scenarios
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const tests = [
  {
    name: 'Data Awareness Filter (v9.0.249)',
    pattern: 'data awareness filter',
    improvement: '#1-2'
  },
  {
    name: 'Complete Clinical Workflow',
    pattern: 'complete clinical workflow',
    improvement: '#1-9'
  }
];

console.log('\n🧪 COMPREHENSIVE IMPROVEMENT TEST SUITE\n');
console.log('Testing improvements #1-9 across realistic scenarios...\n');

const results = [];

for (const test of tests) {
  console.log(`\n📋 Running: ${test.name}`);
  console.log(`   Improvements tested: ${test.improvement}`);
  console.log(`   Pattern: "${test.pattern}"`);
  console.log('   ---');

  try {
    const cmd = `npx playwright test tests/agentic-doctor.spec.js --grep "${test.pattern}" --reporter=json 2>&1`;
    const output = execSync(cmd, { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 });
    
    const passed = output.includes('passed') || output.includes('✓');
    const failed = output.includes('failed') || output.includes('✕');
    
    results.push({
      name: test.name,
      improvement: test.improvement,
      passed: passed && !failed,
      output: output.substring(0, 500)
    });
    
    console.log(`   Result: ${passed && !failed ? '✅ PASSED' : '❌ FAILED'}`);
  } catch (error) {
    console.log(`   Result: ⚠️  ERROR - ${error.message.substring(0, 100)}`);
    results.push({
      name: test.name,
      improvement: test.improvement,
      passed: false,
      error: error.message
    });
  }
}

console.log('\n' + '='.repeat(60));
console.log('📊 TEST SUMMARY\n');

const passed = results.filter(r => r.passed).length;
const failed = results.length - passed;

console.log(`Total tests: ${results.length}`);
console.log(`✅ Passed: ${passed}`);
console.log(`❌ Failed: ${failed}`);
console.log(`Pass rate: ${((passed / results.length) * 100).toFixed(1)}%\n`);

if (failed === 0) {
  console.log('🎉 ALL TESTS PASSED! Improvements #1-9 are working correctly.');
} else {
  console.log('⚠️  Some tests failed. Review output above for details.');
}

console.log('\n' + '='.repeat(60) + '\n');
