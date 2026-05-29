require('dotenv').config();
const path = require('path');
const fs = require('fs');
const admin = require('firebase-admin');
const SA_PATH = path.join(__dirname, '..', 'server', 'config', 'serviceAccountKey.json');
const GUIDELINE_ID = 'bjog-2026-whitworth-reduced-fetal-movements-green-top-guideline-no-57';
const OUT = path.join(__dirname, '..', 'tests', '.rfm-guideline-content.txt');

(async () => {
  if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(require(SA_PATH)) });
  const db = admin.firestore();
  const doc = await db.collection('guidelines').doc(GUIDELINE_ID).get();
  const data = doc.data();
  fs.writeFileSync(OUT, data.content || '');
  console.log(`Wrote ${data.content.length} chars to ${OUT}`);
  console.log(`Title: ${data.title}`);
  console.log(`Summary: ${data.summary}`);
})();
