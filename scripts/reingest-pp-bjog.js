require('dotenv').config();
const fs = require('fs');
const path = require('path');

const AUTH_STATE_PATH = path.join(__dirname, '..', 'tests', '.auth', 'state.json');
const SERVER_URL = process.env.CLERKY_SERVER_URL || 'https://clerky-uzni.onrender.com';
const GUIDELINE_ID = 'bjog-2026-whitworth-reduced-fetal-movements-green-top-guideline-no-57';

function getAuthTokenFromState() {
  const raw = JSON.parse(fs.readFileSync(AUTH_STATE_PATH, 'utf8'));
  const origins = raw.origins || [];
  for (const o of origins) {
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
  if (!token) { console.error('No auth token'); process.exit(1); }
  console.log(`Calling /reingestGuideline for ${GUIDELINE_ID}...`);
  const r = await fetch(`${SERVER_URL}/reingestGuideline`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ guidelineId: GUIDELINE_ID }),
  });
  const text = await r.text();
  console.log(`HTTP ${r.status}`);
  console.log(text.slice(0, 2000));
})();
