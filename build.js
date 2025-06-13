const fs = require('fs');
const path = require('path');

// Create dist directory if it doesn't exist
if (!fs.existsSync('dist')) {
    fs.mkdirSync('dist');
}

// Copy static files
const filesToCopy = [
    'index.html',
    'styles.css',
    'script.js',
    'cookie-consent.js',
    'firebase-init.js',
    'favicon.ico',
    'favicon.svg',
    'site.webmanifest',
    'web-app-manifest-192x192.png',
    'web-app-manifest-512x512.png',
    'apple-touch-icon.png',
    'favicon-96x96.png'
];

filesToCopy.forEach(file => {
    if (fs.existsSync(file)) {
        fs.copyFileSync(file, path.join('dist', file));
        console.log(`Copied ${file} to dist/`);
    }
});

// Copy CNAME file
fs.copyFileSync('CNAME', path.join('dist', 'CNAME'));
console.log('Copied CNAME to dist/');

console.log('Build complete!'); 