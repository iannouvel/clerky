require('dotenv').config();
const path = require('path');
const fs = require('fs');
const admin = require('firebase-admin');
const SA_PATH = path.join(__dirname, '..', 'server', 'config', 'serviceAccountKey.json');
const GUIDELINE_ID = 'bjog-2026-whitworth-reduced-fetal-movements-green-top-guideline-no-57';
const BANK = path.join(__dirname, '..', 'tests', '.pp-scenario-bank.json');
const serial = parseInt(process.argv[2], 10);

(async () => {
  if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(require(SA_PATH)) });
  const db = admin.firestore();
  const doc = await db.collection('guidelines').doc(GUIDELINE_ID).get();
  const pps = doc.data().practicePoints;
  const bank = JSON.parse(fs.readFileSync(BANK, 'utf8'));
  const target = bank.scenarios.find(s => s.serial === serial);
  if (!target) { console.error(`PP #${serial} not in bank`); process.exit(2); }
  const src = pps[serial - 1];
  fs.writeFileSync(BANK + `.pre-rehydrate-${serial}-${Date.now()}.bak`, JSON.stringify(bank, null, 2));
  target.name = src.name;
  target.description = src.description;
  target.condition = src.condition;
  target.action = src.action;
  target.verbatimQuote = src.verbatimQuote;
  target.ruleType = src.ruleType;
  fs.writeFileSync(BANK, JSON.stringify(bank, null, 2));
  console.log(`Re-hydrated PP #${serial} context from Firestore.`);
})();
