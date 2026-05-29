require('dotenv').config();
const path = require('path');
const admin = require('firebase-admin');
const SA_PATH = path.join(__dirname, '..', 'server', 'config', 'serviceAccountKey.json');
const docId = process.argv[2];
(async () => {
  if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(require(SA_PATH)) });
  const db = admin.firestore();
  const doc = await db.collection('auditTranscripts').doc(docId).get();
  if (!doc.exists) { console.error(`Doc ${docId} not found`); process.exit(1); }
  const d = doc.data();
  console.log('Doc keys:', Object.keys(d));
  console.log('guidelineId:', d.guidelineId);
  console.log('\n--- transcript (correct variant) ---');
  console.log((d.transcript || '').slice(0, 2000));
  console.log('\n--- incorrectScripts[0] ---');
  const inc = (d.incorrectScripts || [])[0];
  if (inc) {
    console.log('Keys:', Object.keys(inc));
    console.log((inc.incorrectTranscript || inc.transcript || '').slice(0, 2000));
  }
})();
