#!/usr/bin/env node
/**
 * Build script for BSOTs Azure Static Web App
 * Copies only the necessary files for the BSOTs triage board prototype
 */

const fs = require('fs');
const path = require('path');

const DIST_DIR = path.join(__dirname, 'dist-bsots');

// Files to copy from root
const ROOT_FILES = [
  'BSOTs.html',
  'BSOTs-admin.html',
  'BSOTs.css',
  'styles.css',
  'firebase-init.js',
  'favicon.ico'
];

// Directories to copy
const DIRS_TO_COPY = [
  'js/bsots'
];

// Clean dist directory
if (fs.existsSync(DIST_DIR)) {
  fs.rmSync(DIST_DIR, { recursive: true, force: true });
}
fs.mkdirSync(DIST_DIR, { recursive: true });

// Copy root files
console.log('Copying root files...');
ROOT_FILES.forEach(file => {
  const src = path.join(__dirname, file);
  const dest = path.join(DIST_DIR, file);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, dest);
    console.log(`  ✓ ${file}`);
  } else {
    console.warn(`  ⚠ ${file} not found, skipping`);
  }
});

// Copy BSOTs.html as index.html (Azure requires index.html as entry point)
const bsotsHtml = path.join(__dirname, 'BSOTs.html');
const indexHtml = path.join(DIST_DIR, 'index.html');
if (fs.existsSync(bsotsHtml)) {
  fs.copyFileSync(bsotsHtml, indexHtml);
  console.log('  ✓ index.html (copy of BSOTs.html)');
}

// Copy directories recursively
console.log('\nCopying directories...');
DIRS_TO_COPY.forEach(dir => {
  const src = path.join(__dirname, dir);
  const dest = path.join(DIST_DIR, dir);
  if (fs.existsSync(src)) {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    copyDirRecursive(src, dest);
    console.log(`  ✓ ${dir}/`);
  } else {
    console.warn(`  ⚠ ${dir} not found, skipping`);
  }
});

console.log('\n✅ BSOTs build complete in dist-bsots/');

// Helper: recursive directory copy
function copyDirRecursive(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}
