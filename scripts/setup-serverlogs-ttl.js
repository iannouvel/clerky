/**
 * Register a Firestore TTL policy on serverLogs.expireAt so flow-trace logs are
 * auto-deleted ~24h after they expire (retention is set by FLOW_TTL_MS in server.js,
 * which writes the expireAt timestamp). Idempotent — safe to re-run.
 *
 * Uses the service account (server/config/serviceAccountKey.json) — no gcloud needed.
 * Usage: node scripts/setup-serverlogs-ttl.js [collectionGroup] [field]
 */
const path = require('path');
const { GoogleAuth } = require('google-auth-library');
const SA = require(path.join(__dirname, '..', 'server', 'config', 'serviceAccountKey.json'));

const PROJECT = SA.project_id;
const GROUP = process.argv[2] || 'serverLogs';
const FIELD = process.argv[3] || 'expireAt';

(async () => {
  const auth = new GoogleAuth({
    credentials: SA,
    scopes: ['https://www.googleapis.com/auth/datastore'],
  });
  const client = await auth.getClient();
  const name = `projects/${PROJECT}/databases/(default)/collectionGroups/${GROUP}/fields/${FIELD}`;
  const url = `https://firestore.googleapis.com/v1/${name}?updateMask=ttlConfig`;

  console.log(`Enabling TTL on ${GROUP}.${FIELD} (project ${PROJECT})...`);
  try {
    const res = await client.request({
      url,
      method: 'PATCH',
      data: { ttlConfig: {} }, // empty config = enable TTL on this field
    });
    console.log('OK — TTL policy submitted. Response:');
    console.log(JSON.stringify(res.data, null, 2));
    console.log('\nNote: the policy takes a few minutes to become active (state: CREATING -> ACTIVE).');
    console.log('Check status: node scripts/setup-serverlogs-ttl.js --status');
  } catch (e) {
    const detail = e.response?.data ? JSON.stringify(e.response.data, null, 2) : e.message;
    console.error('FAILED:', detail);
    console.error('\nIf this is a permissions error, the service account needs the');
    console.error('"Cloud Datastore Owner" (or Editor) role, or set the TTL manually in the');
    console.error('Firebase console: Firestore > serverLogs > expireAt > "Enable TTL".');
    process.exit(1);
  }
})();
