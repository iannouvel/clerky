require('dotenv').config();
const path = require('path');
const admin = require('firebase-admin');
const SA_PATH = path.join(__dirname, '..', 'server', 'config', 'serviceAccountKey.json');
(async () => {
  if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(require(SA_PATH)) });
  const db = admin.firestore();
  const snap = await db.collection('auditTranscripts').get();
  console.log(`Total: ${snap.size}`);
  for (const doc of snap.docs) {
    const d = doc.data();
    console.log(`\n${doc.id}`);
    console.log(`  guidelineId: ${d.guidelineId}`);
    console.log(`  name: ${d.name || d.title || '(none)'}`);
    console.log(`  hasCorrect: ${!!d.correctTranscript || !!d.transcripts?.correct}`);
    console.log(`  hasIncorrect: ${!!d.incorrectTranscript || !!d.transcripts?.incorrect}`);
    if (d.transcripts) console.log(`  transcripts.keys: ${Object.keys(d.transcripts).join(', ')}`);
    if (d.incorrectTranscript) console.log(`  incorrect preview: ${d.incorrectTranscript.slice(0, 150)}...`);
    else if (d.transcripts?.incorrect) console.log(`  incorrect preview: ${d.transcripts.incorrect.slice(0, 150)}...`);
  }
})();
