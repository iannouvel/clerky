#!/usr/bin/env node
/**
 * Read feedback submissions from Firestore.
 * Requires Firebase Admin SDK service account key.
 *
 * Setup (one-time):
 *   1. Go to Firebase Console → Project Settings → Service accounts
 *   2. Click "Generate new private key" → save as scripts/serviceAccount.json
 *   3. npm install firebase-admin  (or: cd scripts && npm install firebase-admin)
 *
 * Usage:
 *   node scripts/read-feedback.js              # last 20 submissions
 *   node scripts/read-feedback.js --limit 50   # last 50
 *   node scripts/read-feedback.js --full       # include full state snapshots
 */

const path = require('path');
const args = process.argv.slice(2);

const limitArg = args.indexOf('--limit');
const LIMIT = limitArg !== -1 ? parseInt(args[limitArg + 1], 10) : 20;
const FULL = args.includes('--full');

// Look for serviceAccount.json next to this script or at repo root
const candidates = [
    path.resolve(__dirname, 'serviceAccount.json'),
    path.resolve(__dirname, '..', 'serviceAccount.json'),
];

let serviceAccountPath = null;
for (const p of candidates) {
    try {
        require('fs').accessSync(p);
        serviceAccountPath = p;
        break;
    } catch (_) {}
}

if (!serviceAccountPath) {
    console.error([
        'ERROR: serviceAccount.json not found.',
        '',
        'To set up:',
        '  1. Firebase Console → Project Settings → Service accounts',
        '  2. "Generate new private key" → save as scripts/serviceAccount.json',
        '  3. It is already in .gitignore — never commit it.',
    ].join('\n'));
    process.exit(1);
}

let admin;
try {
    admin = require('firebase-admin');
} catch (_) {
    console.error([
        'ERROR: firebase-admin is not installed.',
        '',
        'Run:  npm install firebase-admin',
        'Then retry.',
    ].join('\n'));
    process.exit(1);
}

const serviceAccount = require(serviceAccountPath);

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    projectId: serviceAccount.project_id,
});

const db = admin.firestore();

async function main() {
    const snap = await db.collection('feedback')
        .orderBy('submittedAt', 'desc')
        .limit(LIMIT)
        .get();

    if (snap.empty) {
        console.log('No feedback submissions found.');
        return;
    }

    const sep = '─'.repeat(60);
    console.log(`\n=== ${snap.size} feedback submission(s) (newest first) ===\n`);

    let i = 1;
    snap.forEach((docSnap) => {
        const d = docSnap.data();
        const ts = d.submittedAt ? d.submittedAt.toDate().toISOString() : 'unknown time';

        console.log(`${sep}`);
        console.log(`#${i + 1}  ${ts}`);
        console.log(`ID: ${docSnap.id}`);
        console.log(`User: ${d.userEmail || 'anonymous'}`);
        console.log(`\nEXPLANATION:\n  ${d.userExplanation || '(none)'}`);

        if (d.lastInteraction) {
            const li = d.lastInteraction;
            console.log(`\nLAST ACTION:`);
            console.log(`  Button: "${li.buttonLabel}" (id: ${li.buttonId})`);
            console.log(`  At:     ${li.timestamp}`);
            if (FULL && li.stateBefore) {
                console.log(`  State before:`);
                console.log('    view:    ' + li.stateBefore.activeView);
                console.log('    editor:  ' + (li.stateBefore.editorText || '').slice(0, 120).replace(/\n/g, ' '));
                console.log('    summary: ' + (li.stateBefore.summaryText || '').slice(0, 120).replace(/\n/g, ' '));
            }
        } else {
            console.log(`\nLAST ACTION: (none recorded)`);
        }

        if (FULL && d.currentState) {
            const cs = d.currentState;
            console.log(`\nCURRENT STATE (at time of feedback):`);
            console.log('  view:    ' + cs.activeView);
            console.log('  editor:  ' + (cs.editorText || '').slice(0, 120).replace(/\n/g, ' '));
            console.log('  summary: ' + (cs.summaryText || '').slice(0, 120).replace(/\n/g, ' '));
        }

        console.log('');
    });

    console.log(`${sep}`);
    console.log(`\nTip: run with --full to include editor/summary content snapshots`);
    console.log(`     run with --limit N to fetch more records\n`);
}

main().catch(err => {
    console.error('ERROR:', err.message);
    process.exit(1);
});
