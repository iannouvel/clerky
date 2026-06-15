#!/usr/bin/env node
/**
 * reconcile-proposed-values.js <guidelineId> [--commit]
 *
 * Curate a guideline's already-generated proposedNewValues into the global
 * canonicalValues registry. THIN WRAPPER around the shared engine
 * required-values.curateProposedAgainstRegistry — the same curation generation
 * now runs automatically. Use this to (re)consolidate an OLD guideline whose
 * proposedNewValues predate the standardised pipeline.
 *
 * DRY-RUN by default (writes nothing); --commit applies registry changes. After
 * --commit, regenerate the guideline's requiredValues so its proposed fragments
 * map onto the freshly-promoted canonical entries.
 */
require('dotenv').config();
const path = require('path');
const fs = require('fs');
const admin = require('firebase-admin');
const RV = require('../modules/required-values');

const SA_PATH = path.join(__dirname, '..', 'server', 'config', 'serviceAccountKey.json');
const GUIDELINE_ID = process.argv[2];
const COMMIT = process.argv.includes('--commit');

if (!GUIDELINE_ID) { console.error('Usage: node reconcile-proposed-values.js <guidelineId> [--commit]'); process.exit(2); }

(async () => {
    if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(require(SA_PATH)) });
    const db = admin.firestore();

    const gdoc = await db.collection('guidelines').doc(GUIDELINE_ID).get();
    if (!gdoc.exists) { console.error('Guideline not found'); process.exit(1); }
    const proposedList = (gdoc.data().requiredValues?.proposedNewValues || []).map(p => ({
        proposedId: p.proposedId || p.id,
        label: p.label || p.proposedId || p.id,
        type: p.type,
        options: Array.isArray(p.options) && p.options.length ? p.options : null,
        subjective: p.subjective === true,
        usedByPPs: p.usedByPPs || [],
    }));
    console.log(`Proposed-new on ${GUIDELINE_ID}: ${proposedList.length}  (${COMMIT ? 'COMMIT' : 'DRY-RUN'})`);
    if (!proposedList.length) { console.log('Nothing to reconcile.'); process.exit(0); }

    const r = await RV.curateProposedAgainstRegistry(db, proposedList, { commit: COMMIT, fromGuideline: GUIDELINE_ID });

    console.log(`\n=== Reconciliation plan ===`);
    console.log(`Proposed in: ${proposedList.length}`);
    console.log(`  → mapped onto existing globals:  ${r.mapped}  (aliases extended on ${r.aliasExtendedEntries} entries)`);
    console.log(`  → NEW globals promoted (≥2 fragments): ${r.promoted.length}`);
    console.log(`  → left guideline-local (singletons):   ${r.localProposed.length}`);
    console.log(`  → dropped:  ${r.dropped}`);
    console.log(`Registry ${r.registryBefore} → ${r.registryAfter}  (clean, deduped)`);

    console.log(`\nPromoted globals (top 25 by fragments collapsed):`);
    r.promoted.sort((a, b) => b.fragments - a.fragments).slice(0, 25)
        .forEach(c => console.log(`  ${c.fragments}× → ${c.id} [${c.type}] "${c.label}"  aliases: ${(c.aliases || []).slice(0, 4).join(' | ')}`));

    const outFile = path.join(__dirname, '..', 'tests', `.reconcile-${GUIDELINE_ID}.json`);
    fs.writeFileSync(outFile, JSON.stringify({
        guidelineId: GUIDELINE_ID, proposedIn: proposedList.length,
        mapped: r.mapped, dropped: r.dropped, promotedCount: r.promoted.length, leftLocal: r.localProposed.length,
        registryBefore: r.registryBefore, registryAfter: r.registryAfter,
        promotedConcepts: r.promoted,
    }, null, 2));
    console.log(`\nPlan saved: ${outFile}`);
    console.log(COMMIT
        ? `\nCOMMITTED. Next: regenerate requiredValues for ${GUIDELINE_ID} so its fragments map onto the new canonical entries.`
        : `\nDRY-RUN — nothing written. Re-run with --commit to apply.`);
    process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
