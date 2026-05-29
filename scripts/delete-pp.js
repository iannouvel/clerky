require('dotenv').config();
const path = require('path');
const fs = require('fs');
const admin = require('firebase-admin');
const SA_PATH = path.join(__dirname, '..', 'server', 'config', 'serviceAccountKey.json');
const GUIDELINE_ID = 'bjog-2026-whitworth-reduced-fetal-movements-green-top-guideline-no-57';

const serials = process.argv.slice(2).map(n => parseInt(n, 10)).filter(Boolean);
if (serials.length === 0) { console.error('Usage: node delete-pp.js <serial1> [serial2] ...'); process.exit(2); }

// Sort descending so deletes don't shift remaining indices we still want to delete
serials.sort((a, b) => b - a);

(async () => {
  if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(require(SA_PATH)) });
  const db = admin.firestore();
  const docRef = db.collection('guidelines').doc(GUIDELINE_ID);
  const doc = await docRef.get();
  const data = doc.data();
  const pps = [...data.practicePoints];
  fs.writeFileSync(path.join(__dirname, '..', 'tests', `.pre-delete-pps-${Date.now()}.bak.json`), JSON.stringify(pps, null, 2));

  for (const s of serials) {
    const idx = s - 1;
    if (idx < 0 || idx >= pps.length) {
      console.warn(`PP #${s} out of range`);
      continue;
    }
    const removed = pps.splice(idx, 1);
    console.log(`Deleted PP #${s}: ${removed[0]?.name?.slice(0, 100) || '(unknown)'}`);
  }

  await docRef.update({ practicePoints: pps });
  console.log(`\nFirestore now has ${pps.length} PPs.`);
})();
