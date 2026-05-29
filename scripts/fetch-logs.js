require('dotenv').config();
const fs = require('fs');
const path = require('path');
const AUTH_STATE_PATH = path.join(__dirname, '..', 'tests', '.auth', 'state.json');
const SERVER_URL = process.env.CLERKY_SERVER_URL || 'https://clerky-uzni.onrender.com';

function getAuthTokenFromState() {
  const raw = JSON.parse(fs.readFileSync(AUTH_STATE_PATH, 'utf8'));
  for (const o of raw.origins || []) {
    for (const item of (o.localStorage || [])) {
      if (item.name && item.name.startsWith('firebase:authUser:')) {
        const data = JSON.parse(item.value);
        return data?.stsTokenManager?.accessToken;
      }
    }
  }
  return null;
}

(async () => {
  const token = getAuthTokenFromState();
  const filter = process.argv[2] || '';
  const r = await fetch(`${SERVER_URL}/logs?limit=500`, { headers: { authorization: `Bearer ${token}` } });
  const d = await r.json();
  console.log(`Total in buffer: ${d.total}; returned: ${d.count}; max: ${d.maxBufferSize}`);
  console.log(`Oldest: ${d.logs[0]?.timestamp}; Newest: ${d.logs[d.logs.length - 1]?.timestamp}`);
  const lines = (d.logs || []).map(l => `[${l.timestamp}] ${l.message}`);
  const filtered = filter ? lines.filter(l => l.includes(filter)) : lines;
  console.log(`\nMatching "${filter}" (${filtered.length} of ${lines.length}):`);
  for (const l of filtered) console.log(l);
})();
