require('dotenv').config();
const path = require('path');
const admin = require('firebase-admin');
const SA_PATH = path.join(__dirname, '..', 'server', 'config', 'serviceAccountKey.json');
const GUIDELINE_ID = 'bjog-2026-whitworth-reduced-fetal-movements-green-top-guideline-no-57';
const serial = parseInt(process.argv[2], 10);
(async () => {
  if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(require(SA_PATH)) });
  const db = admin.firestore();
  const doc = await db.collection('guidelines').doc(GUIDELINE_ID).get();
  const pp = doc.data().practicePoints[serial - 1];
  console.log(JSON.stringify(pp, null, 2));
})();
