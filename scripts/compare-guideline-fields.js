require('dotenv').config();
const path = require('path');
const admin = require('firebase-admin');
const SA_PATH = path.join(__dirname, '..', 'server', 'config', 'serviceAccountKey.json');
(async () => {
  if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(require(SA_PATH)) });
  const db = admin.firestore();
  const ids = [
    'bjog-2026-whitworth-reduced-fetal-movements-green-top-guideline-no-57',
    'gtg-2015-reduced-fetal-movements-pdf',
  ];
  for (const id of ids) {
    const doc = await db.collection('guidelines').doc(id).get();
    const d = doc.data() || {};
    const summary = {};
    for (const k of Object.keys(d).sort()) {
      const v = d[k];
      if (Array.isArray(v)) summary[k] = `[Array len=${v.length}]`;
      else if (typeof v === 'string' && v.length > 80) summary[k] = `[String len=${v.length}]`;
      else if (typeof v === 'object' && v !== null) summary[k] = `[Object keys=${Object.keys(v).length}]`;
      else summary[k] = v;
    }
    console.log(`\n=== ${id} ===`);
    console.log(JSON.stringify(summary, null, 2));
  }
})();
