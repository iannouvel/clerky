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

// Load feedback resolutions tracking
let resolutions = {};
try {
    resolutions = require('./feedback_resolutions.json');
} catch (_) {
    // File doesn't exist yet or can't be read - that's ok
}

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
        const fbId = docSnap.id;
        const resolution = resolutions[fbId];

        console.log(`${sep}`);
        console.log(`#${i + 1}  ${ts}`);
        console.log(`ID: ${fbId}`);
        console.log(`User: ${d.userEmail || 'anonymous'}`);

        if (resolution) {
            console.log(`✅ STATUS: RESOLVED (${resolution.version})`);
            console.log(`   Issue: ${resolution.issue}`);
            console.log(`   Resolution: ${resolution.resolution}`);
        } else {
            console.log(`⏳ STATUS: UNRESOLVED`);
        }

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

        if (d.currentState) {
            const cs = d.currentState;
            const editorPreview = (cs.editorText || '').slice(0, FULL ? 2000 : 300).replace(/\n/g, ' ');
            console.log(`\nEDITOR NOTE (at time of feedback):`);
            console.log(`  ${editorPreview}${(cs.editorText || '').length > (FULL ? 2000 : 300) ? '…' : ''}`);
            if (FULL && cs.summaryText) {
                console.log(`\nSUMMARY PANEL:`);
                console.log('  ' + cs.summaryText.slice(0, 400).replace(/\n/g, '\n  '));
            }
        }

        if (d.wizardState) {
            const ws = d.wizardState;
            console.log(`\nWIZARD STATE:`);
            console.log(`  Step ${ws.currentIndex + 1} of ${ws.total}`);
            if (ws.currentSuggestion) {
                const s = ws.currentSuggestion;
                const text = s.suggestion || s.text || s.recommendation || s.missing_info || '';
                console.log(`  Current: "${text.slice(0, 120)}"`);
                if (s.guidelineTitle || s.sourceGuidelineName) {
                    console.log(`  Guideline: ${s.guidelineTitle || s.sourceGuidelineName}`);
                }
            }
            if (FULL && ws.allSuggestions?.length > 0) {
                console.log(`  All suggestions:`);
                ws.allSuggestions.forEach((s, idx) => {
                    const text = s.suggestion || s.text || s.recommendation || s.missing_info || '';
                    console.log(`    ${idx + 1}. ${text.slice(0, 100)}`);
                });
            }
        }

        if (d.lastAiContext) {
            const ctx = d.lastAiContext;
            console.log(`\nLAST AI CONTEXT (${ctx.source}, ${ctx.timestamp?.slice(0, 16) || ''}):`);
            if (ctx.source === 'completeness') {
                console.log(`  ${ctx.itemCount} missing info item(s) identified:`);
                (ctx.items || []).forEach((item, idx) => {
                    console.log(`    ${idx + 1}. [${item.data_type_and_options?.type || '?'}] ${item.missing_info}`);
                });
            } else if (ctx.source === 'guidelines') {
                console.log(`  ${ctx.guidelineCount} guideline(s) analysed:`);
                (ctx.guidelines || []).forEach(g => {
                    console.log(`    • ${g.title} — ${g.suggestionCount} suggestion(s)`);
                    if (FULL) {
                        (g.suggestions || []).forEach((s, idx) => {
                            console.log(`        ${idx + 1}. ${s.text.slice(0, 100)}`);
                        });
                    }
                });
            }
        }

        console.log('');
    });

    console.log(`${sep}`);
    console.log(`\n✅ = Resolved (added to feedback_resolutions.json)`);
    console.log(`⏳ = Unresolved (no resolution tracked yet)\n`);
    console.log(`Tips:`);
    console.log(`  run with --full to include full editor text, summary panel, all wizard suggestions, and guideline details`);
    console.log(`  run with --limit N to fetch more records (default: 20)`);
    console.log(`  edit feedback_resolutions.json to mark feedback as resolved\n`);
}

main().catch(err => {
    console.error('ERROR:', err.message);
    process.exit(1);
});
