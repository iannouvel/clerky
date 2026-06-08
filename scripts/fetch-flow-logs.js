/**
 * Read durable server flow-marker logs (the [TAG] console lines persisted to the
 * Firestore `serverLogs` collection by server.js). Survives Render restarts and
 * works across instances, unlike the volatile /logs in-memory buffer.
 *
 * Usage:
 *   node scripts/fetch-flow-logs.js [minutes] [filterSubstring]
 *   node scripts/fetch-flow-logs.js 15                 # last 15 min, all tags
 *   node scripts/fetch-flow-logs.js 15 VERBATIM        # last 15 min, lines containing VERBATIM
 *   node scripts/fetch-flow-logs.js 15 PER-POINT,DROP  # comma = OR of substrings
 */
require('dotenv').config();
const path = require('path');
const admin = require('firebase-admin');
const SA_PATH = path.join(__dirname, '..', 'server', 'config', 'serviceAccountKey.json');
if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(require(SA_PATH)) });
const db = admin.firestore();

const minutes = parseFloat(process.argv[2] || '15');
const filters = (process.argv[3] || '').split(',').map(s => s.trim()).filter(Boolean);
const sinceIso = new Date(Date.now() - minutes * 60000).toISOString();

(async () => {
  // ts is an ISO string field; range query then order client-side to avoid index needs.
  const snap = await db.collection('serverLogs').where('ts', '>=', sinceIso).get();
  let rows = [];
  snap.forEach(d => { const x = d.data(); rows.push({ ts: x.ts, level: x.level, instance: x.instance, message: x.message }); });
  rows.sort((a, b) => (a.ts < b.ts ? -1 : 1));
  if (filters.length) rows = rows.filter(r => filters.some(f => r.message.includes(f)));
  console.log(`serverLogs since ${sinceIso} (${minutes} min) — ${rows.length} lines${filters.length ? ` matching [${filters.join(', ')}]` : ''}:\n`);
  for (const r of rows) {
    const t = r.ts.slice(11, 23);
    const lv = r.level === 'error' ? '✗' : r.level === 'warn' ? '!' : ' ';
    console.log(`${t} ${lv} [i${r.instance}] ${r.message}`);
  }
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
