#!/usr/bin/env node
/**
 * Upload the bootstrap canonical-values JSON to Firestore (canonicalValues collection).
 *
 * Each value becomes a doc keyed by its id. Re-running with --merge updates
 * existing docs without overwriting fields not in the bootstrap.
 *
 * Usage: node upload-canonical-values.js [--merge]
 */
require('dotenv').config();
const path = require('path');
const fs = require('fs');
const admin = require('firebase-admin');

const SA_PATH = path.join(__dirname, '..', 'server', 'config', 'serviceAccountKey.json');
const BOOTSTRAP_PATH = path.join(__dirname, '..', 'server', 'data', 'canonical_values.bootstrap.json');
const MERGE = process.argv.includes('--merge');

(async () => {
    if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(require(SA_PATH)) });
    const db = admin.firestore();

    const j = JSON.parse(fs.readFileSync(BOOTSTRAP_PATH, 'utf8'));
    const values = j.values || {};
    const ids = Object.keys(values);
    console.log(`Uploading ${ids.length} canonical values to Firestore (merge=${MERGE})...`);

    let written = 0;
    for (const id of ids) {
        const v = { id, ...values[id], schemaVersion: j.schemaVersion, lastUpdated: admin.firestore.FieldValue.serverTimestamp() };
        await db.collection('canonicalValues').doc(id).set(v, { merge: MERGE });
        written++;
    }
    console.log(`Wrote ${written} canonical values.`);
})().catch(e => { console.error(e); process.exit(1); });
