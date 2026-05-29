/**
 * Call /getPracticePointSuggestions with a known note, then immediately fetch
 * the server's in-memory log buffer to see [PER-POINT] applicability decisions.
 *
 * Usage: node diagnose-perpoint.js [guidelineId]
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');

const AUTH_STATE_PATH = path.join(__dirname, '..', 'tests', '.auth', 'state.json');
const SERVER_URL = process.env.CLERKY_SERVER_URL || 'https://clerky-uzni.onrender.com';
const GUIDELINE_ID = process.argv[2] || 'bjog-2026-whitworth-reduced-fetal-movements-green-top-guideline-no-57';

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

// Use the v4 pre-note as our test input
const v4 = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'tests', '.compliance-eval-rfm-v4.json'), 'utf8'));
const transcript = v4.scenarios[0].preNote;

(async () => {
  const token = getAuthTokenFromState();
  if (!token) { console.error('No token'); process.exit(1); }

  console.log(`Calling /getPracticePointSuggestions for ${GUIDELINE_ID}...`);
  console.log(`Note: ${transcript.substring(0, 200)}...\n`);

  const t0 = Date.now();
  const sresp = await fetch(`${SERVER_URL}/getPracticePointSuggestions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ transcript, guidelineId: GUIDELINE_ID, skipSenseCheck: true }),
  });
  const sdata = await sresp.json();
  console.log(`Took ${Math.round((Date.now() - t0) / 1000)}s; HTTP ${sresp.status}`);
  console.log(`Suggestions returned: ${sdata.suggestions?.length || sdata.suggestionsCount || 0}`);
  if (sdata.suggestions) {
    for (const s of sdata.suggestions) {
      console.log(`  - [PP${s.practicePointSerialNumber || '?'}] ${(s.suggestion || '').slice(0, 100)}`);
    }
  }

  console.log('\nFetching server logs...');
  const lresp = await fetch(`${SERVER_URL}/logs?limit=500`, {
    headers: { authorization: `Bearer ${token}` },
  });
  const ldata = await lresp.json();
  const lines = (ldata.logs || []).map(l => l.message || '').filter(Boolean);

  // Filter for relevant lines
  const perPointLines = lines.filter(l => l.includes('[PER-POINT]') || l.includes('[APPLICABILITY]') || l.includes('[SEMANTIC-SUGGESTIONS]') || l.includes('[PRACTICE-POINT-LOAD]') || l.includes('[RAG]'));
  console.log(`\n=== Relevant log lines (${perPointLines.length}) ===\n`);
  for (const l of perPointLines) console.log(l);
})().catch(e => { console.error(e); process.exit(1); });
