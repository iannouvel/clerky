require('dotenv').config();
const path = require('path');
const fs = require('fs');
const admin = require('firebase-admin');
const SA_PATH = path.join(__dirname, '..', 'server', 'config', 'serviceAccountKey.json');
const GUIDELINE_ID = 'bjog-2026-whitworth-reduced-fetal-movements-green-top-guideline-no-57';
const serial = parseInt(process.argv[2], 10);
const fieldsJson = process.argv[3];

(async () => {
  if (!fieldsJson) { console.error('Usage: node update-pp.js <serial> \'{"name":"...","action":"..."}\''); process.exit(2); }
  const updates = JSON.parse(fieldsJson);
  if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(require(SA_PATH)) });
  const db = admin.firestore();
  const docRef = db.collection('guidelines').doc(GUIDELINE_ID);
  const doc = await docRef.get();
  const data = doc.data();
  const pps = data.practicePoints;
  const before = JSON.stringify(pps[serial - 1], null, 2);
  fs.writeFileSync(path.join(__dirname, '..', 'tests', `.pp${serial}-pre-update-${Date.now()}.bak.json`), before);
  pps[serial - 1] = { ...pps[serial - 1], ...updates };
  await docRef.update({ practicePoints: pps });
  console.log(`Updated PP #${serial}:`);
  console.log(JSON.stringify(pps[serial - 1], null, 2));
})();
