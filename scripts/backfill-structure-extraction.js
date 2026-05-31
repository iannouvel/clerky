/**
 * Eager backfill: re-run practice-point extraction so every guideline picks up
 * structure-aware section chunking. Each regeneration job derives the PDF
 * `structure` (outline / font headings → sectionAnchors) on demand and persists
 * it, then extracts practice points chunked by real section boundaries.
 *
 * Modes:
 *   node scripts/backfill-structure-extraction.js <guidelineId>
 *       → regenerate ONE guideline (async) and poll until complete. Use this to
 *         validate output before the full run.
 *
 *   node scripts/backfill-structure-extraction.js --all
 *       → DRY RUN: report how many guidelines would be processed, do nothing.
 *
 *   node scripts/backfill-structure-extraction.js --all --confirm
 *       → EAGER: queue background regeneration for ALL guidelines (processAll).
 *         Heavy + long (hundreds of guidelines × LLM calls). Poll batch status.
 *
 * Auth: reuses the Playwright saved token at tests/.auth/state.json. If the
 * server returns 401/403, refresh it first:  node scripts/refresh-playwright-auth.js
 */
require('dotenv').config();
const path = require('path');
const fs = require('fs');

const AUTH_STATE_PATH = path.join(__dirname, '..', 'tests', '.auth', 'state.json');
const SERVER_URL = process.env.CLERKY_SERVER_URL || 'https://clerky-uzni.onrender.com';

function getAuthToken() {
    const raw = JSON.parse(fs.readFileSync(AUTH_STATE_PATH, 'utf8'));
    for (const o of raw.origins || []) {
        for (const item of (o.localStorage || [])) {
            if (item.name && item.name.startsWith('firebase:authUser:')) {
                return JSON.parse(item.value)?.stsTokenManager?.accessToken;
            }
        }
    }
    return null;
}

async function post(endpoint, body, token) {
    const resp = await fetch(`${SERVER_URL}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body)
    });
    const text = await resp.text();
    let data; try { data = JSON.parse(text); } catch { data = text; }
    return { status: resp.status, data };
}

async function get(endpoint, token) {
    const resp = await fetch(`${SERVER_URL}${endpoint}`, {
        headers: { Authorization: `Bearer ${token}` }
    });
    const text = await resp.text();
    let data; try { data = JSON.parse(text); } catch { data = text; }
    return { status: resp.status, data };
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
    const args = process.argv.slice(2);
    const all = args.includes('--all');
    const confirm = args.includes('--confirm');
    const guidelineId = args.find(a => !a.startsWith('--'));

    const token = getAuthToken();
    if (!token) { console.error('No auth token in tests/.auth/state.json. Run: node scripts/refresh-playwright-auth.js'); process.exit(1); }

    if (!all && !guidelineId) {
        console.error('Usage:\n  node scripts/backfill-structure-extraction.js <guidelineId>\n  node scripts/backfill-structure-extraction.js --all [--confirm]');
        process.exit(2);
    }

    // ── Single guideline (validation) ──
    if (guidelineId) {
        console.log(`Regenerating practice points for ${guidelineId} (async)…`);
        const { status, data } = await post('/regeneratePracticePoints', { guidelineId, async: true }, token);
        if (status !== 200) { console.error(`HTTP ${status}:`, data); process.exit(1); }
        const jobId = data.jobId;
        console.log(`Job started: ${jobId}. Polling…\n`);

        for (let i = 0; i < 240; i++) { // up to ~20 min
            await sleep(5000);
            const st = await get(`/getExtractionJobStatus?jobId=${encodeURIComponent(jobId)}`, token);
            const j = st.data || {};
            process.stdout.write(`\r[${j.status || '?'}] ${j.step || ''} ${j.stepMessage || ''}`.slice(0, 110).padEnd(112));
            if (j.status === 'complete') { console.log(`\n\n✅ Complete: ${j.count} practice points`); process.exit(0); }
            if (j.status === 'error') { console.log(`\n\n❌ Error: ${j.error}`); process.exit(1); }
        }
        console.log('\n\nTimed out waiting for job (it may still be running on the server).');
        process.exit(0);
    }

    // ── All guidelines (eager) ──
    if (!confirm) {
        console.log('DRY RUN (--all without --confirm). Counting guidelines…');
        const admin = require('firebase-admin');
        const SA_PATH = path.join(__dirname, '..', 'server', 'config', 'serviceAccountKey.json');
        if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(require(SA_PATH)) });
        const snap = await admin.firestore().collection('guidelines').get();
        let withContent = 0;
        snap.forEach(d => { const x = d.data(); if (x.condensed || x.content) withContent++; });
        console.log(`Would queue ~${withContent} guidelines (of ${snap.size} total) for regeneration.`);
        console.log('Re-run with --confirm to actually start the eager backfill.');
        process.exit(0);
    }

    console.log('EAGER backfill: queueing regeneration for ALL guidelines (processAll)…');
    const { status, data } = await post('/regeneratePracticePoints', { processAll: true }, token);
    if (status !== 200) { console.error(`HTTP ${status}:`, data); process.exit(1); }
    console.log(`Queued ${data.queued} guidelines. batchId=${data.batchId}`);
    console.log('Polling batch status (server processes in the background)…\n');

    for (let i = 0; i < 100000; i++) {
        await sleep(15000);
        const st = await get(`/api/batch-status/${encodeURIComponent(data.batchId)}`, token);
        const b = st.data || {};
        if (b && typeof b.total === 'number') {
            console.log(`  ${(b.completed || 0) + (b.failed || 0)}/${b.total}  (ok ${b.completed || 0}, failed ${b.failed || 0})`);
            if ((b.completed || 0) + (b.failed || 0) >= b.total) { console.log('\n✅ Batch complete.'); process.exit(0); }
        } else {
            console.log('  (batch status not available yet)');
        }
    }
})().catch(e => { console.error(e); process.exit(1); });
