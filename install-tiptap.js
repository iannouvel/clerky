/**
 * This script downloads TipTap libraries from UNPKG for offline use.
 * Run with: node install-tiptap.js
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

// Create a libs directory if it doesn't exist
const libsDir = path.join(__dirname, 'libs');
if (!fs.existsSync(libsDir)) {
  fs.mkdirSync(libsDir);
}

// URLs to download
const urls = [
  'https://unpkg.com/@tiptap/core@2.2.0/dist/index.js',
  'https://unpkg.com/@tiptap/starter-kit@2.2.0/dist/index.js',
  'https://unpkg.com/@tiptap/extension-placeholder@2.2.0/dist/index.js'
];

// Download each file
urls.forEach(url => {
  const filename = url.split('/').pop();
  const packageName = url.split('/')[3].replace('@', '');
  const destDir = path.join(libsDir, packageName);
  
  // Create package directory if it doesn't exist
  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
  }
  
  const destPath = path.join(destDir, filename);
  
  console.log(`Downloading ${url} to ${destPath}...`);
  
  const file = fs.createWriteStream(destPath);
  https.get(url, response => {
    response.pipe(file);
    file.on('finish', () => {
      file.close();
      console.log(`Downloaded ${url}`);
    });
  }).on('error', err => {
    fs.unlink(destPath);
    console.error(`Error downloading ${url}: ${err.message}`);
  });
});

console.log('Starting download...');
console.log('After downloads complete, update tiptap-editor.js to use local imports:');
console.log('import { Editor } from "./libs/tiptap-core/index.js";');
console.log('import StarterKit from "./libs/tiptap-starter-kit/index.js";');
console.log('import Placeholder from "./libs/tiptap-extension-placeholder/index.js";'); 