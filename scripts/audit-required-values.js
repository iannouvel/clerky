require('dotenv').config();
const path = require('path');
const admin = require('firebase-admin');
const SA_PATH = path.join(__dirname, '..', 'server', 'config', 'serviceAccountKey.json');
const GUIDELINE_ID = process.argv[2] || 'bjog-2026-whitworth-reduced-fetal-movements-green-top-guideline-no-57';

(async () => {
  if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(require(SA_PATH)) });
  const db = admin.firestore();
  const doc = await db.collection('guidelines').doc(GUIDELINE_ID).get();
  const g = doc.data();
  console.log(`Guideline: ${g.title}`);
  console.log(`Guideline-level keys: ${Object.keys(g).filter(k => !['practicePoints','content','condensed','summary'].includes(k)).join(', ')}`);

  const requiredFromGuideline = g.requiredValues || g.dataFieldsRequired || null;
  console.log(`\nGuideline-level requiredValues / dataFieldsRequired:`);
  console.log(`  ${requiredFromGuideline ? JSON.stringify(requiredFromGuideline) : '(none)'}`);

  console.log(`\n=== Per-PP dataFieldsRequired audit ===`);
  const pps = g.practicePoints || [];
  const valueCounts = new Map();
  for (let i = 0; i < pps.length; i++) {
    const pp = pps[i];
    const fields = pp.dataFieldsRequired || [];
    console.log(`  PP#${String(i+1).padStart(2)}: ${fields.length === 0 ? '(none)' : fields.join(', ')}`);
    for (const f of fields) valueCounts.set(f, (valueCounts.get(f) || 0) + 1);
  }

  console.log(`\n=== Aggregated value-frequency across all ${pps.length} PPs ===`);
  const sorted = [...valueCounts.entries()].sort((a, b) => b[1] - a[1]);
  for (const [v, c] of sorted) console.log(`  ${c}x  ${v}`);

  console.log(`\n=== Union (de-duplicated) ===`);
  console.log(`  ${sorted.length} unique values across all PPs`);
})();
