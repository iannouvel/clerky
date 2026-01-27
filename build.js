const fs = require('fs');
const path = require('path');

// Create dist directory if it doesn't exist
if (!fs.existsSync('dist')) {
    fs.mkdirSync('dist');
}

// Create subdirectories
const subdirs = ['algos', 'guidance', 'data'];
subdirs.forEach(dir => {
    if (!fs.existsSync(path.join('dist', dir))) {
        fs.mkdirSync(path.join('dist', dir), { recursive: true });
    }
});

// Copy all HTML, CSS, JS files and assets
const filesToCopy = [
    'index.html',
    'styles.css',
    'script.js',
    'dev.html',
    'dev.js',
    'prompts.html',
    'guidelines.html',
    'viewer.html',
    'viewer.js',
    'audit.html',
    'algos.html',
    'workflows.html',
    'algoprompts.html',
    'disclaimer.html',
    'privacy-policy.html',
    'data-breach-plan.html',
    'data-processing-agreement.html',
    'data-rights.html',
    'tiptap-test.html',
    'tiptap-cdn.html',
    'cookie-consent.js',
    'firebase-init.js',
    'version-loader.js',
    'tiptap-styles.css',
    'tiptap-comments.js',
    'install-tiptap.js',
    'security-tests.js',
    'favicon.ico',
    'favicon.svg',
    'site.webmanifest',
    'web-app-manifest-192x192.png',
    'web-app-manifest-512x512.png',
    'apple-touch-icon.png',
    'favicon-96x96.png',
    'prompts.json',
    'clinical-issues.json',
    'clinical_issues.json',
    'significant_terms.json',
    'list_of_guidelines.txt',
    'links.txt',
    'all_pdfs.txt',
    'package.json'
];

filesToCopy.forEach(file => {
    if (fs.existsSync(file)) {
        fs.copyFileSync(file, path.join('dist', file));
        console.log(`Copied ${file} to dist/`);
    } else {
        console.log(`Warning: ${file} not found, skipping...`);
    }
});

// Copy algos directory
if (fs.existsSync('algos')) {
    const algoFiles = fs.readdirSync('algos');
    algoFiles.forEach(file => {
        if (file.endsWith('.html')) {
            fs.copyFileSync(path.join('algos', file), path.join('dist', 'algos', file));
            console.log(`Copied algos/${file} to dist/algos/`);
        }
    });
}

// Copy guidance directory
if (fs.existsSync('guidance')) {
    const guidanceFiles = fs.readdirSync('guidance');
    guidanceFiles.forEach(file => {
        const srcPath = path.join('guidance', file);
        const destPath = path.join('dist', 'guidance', file);
        if (fs.statSync(srcPath).isFile()) {
            fs.copyFileSync(srcPath, destPath);
            console.log(`Copied guidance/${file} to dist/guidance/`);
        }
    });
}

// Copy CNAME file
if (fs.existsSync('CNAME')) {
    fs.copyFileSync('CNAME', path.join('dist', 'CNAME'));
    console.log('Copied CNAME to dist/');
}



// Helper to copy directory recursively
function copyDirectory(src, dest) {
    if (!fs.existsSync(dest)) {
        fs.mkdirSync(dest, { recursive: true });
    }

    const entries = fs.readdirSync(src, { withFileTypes: true });

    for (const entry of entries) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);

        if (entry.isDirectory()) {
            copyDirectory(srcPath, destPath);
        } else {
            fs.copyFileSync(srcPath, destPath);
            // console.log(`Copied ${srcPath} to ${destPath}`); 
        }
    }
    console.log(`Copied directory ${src} to ${dest}`);
}

// Copy js directory recursively
if (fs.existsSync('js')) {
    copyDirectory('js', path.join('dist', 'js'));
}

console.log('Build complete!'); 