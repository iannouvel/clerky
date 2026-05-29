/**
 * Clone an existing auditTranscript and re-point it at a different guidelineId.
 *
 * Usage: node clone-audit-transcript.js <sourceDocId> <newGuidelineId> [newDocId]
 *
 * The new doc carries the same transcript / incorrectScripts content but is
 * tagged for the new guideline, so the compliance-eval harness picks it up as
 * a fixed test scenario for that guideline.
 */
require('dotenv').config();
const path = require('path');
const admin = require('firebase-admin');
const SA_PATH = path.join(__dirname, '..', 'server', 'config', 'serviceAccountKey.json');

const sourceId = process.argv[2];
const newGuidelineId = process.argv[3];
const newDocId = process.argv[4];

if (!sourceId || !newGuidelineId) {
  console.error('Usage: node clone-audit-transcript.js <sourceDocId> <newGuidelineId> [newDocId]');
  process.exit(2);
}

(async () => {
  if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(require(SA_PATH)) });
  const db = admin.firestore();

  const source = await db.collection('auditTranscripts').doc(sourceId).get();
  if (!source.exists) { console.error(`Source ${sourceId} not found`); process.exit(1); }
  const data = source.data();

  const clone = {
    ...data,
    guidelineId: newGuidelineId,
    clonedFrom: sourceId,
    clonedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  let docRef;
  if (newDocId) docRef = db.collection('auditTranscripts').doc(newDocId);
  else docRef = db.collection('auditTranscripts').doc();

  await docRef.set(clone);
  console.log(`Cloned ${sourceId} -> ${docRef.id}`);
  console.log(`  guidelineId: ${newGuidelineId}`);
  console.log(`  transcript chars: ${(clone.transcript || '').length}`);
  console.log(`  incorrectScripts: ${(clone.incorrectScripts || []).length}`);
})();
