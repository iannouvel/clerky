require('dotenv').config();
const fs = require('fs');
const path = require('path');

const AUTH_STATE_PATH = path.join(__dirname, '..', 'tests', '.auth', 'state.json');
const SERVER_URL = process.env.CLERKY_SERVER_URL || 'https://clerky-uzni.onrender.com';
const GUIDELINE_ID = 'bjog-2026-whitworth-reduced-fetal-movements-green-top-guideline-no-57';
const RUNS = parseInt(process.argv[2], 10) || 3;

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

const v4 = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'tests', '.compliance-eval-rfm-v4.json'), 'utf8'));
const transcript = v4.scenarios[0].preNote;

// Topic classifier for suggestions
function classify(text) {
  const t = (text || '').toLowerCase();
  if (/sfh|symphysis|fundal/.test(t)) return 'SFH (#5)';
  if (/blood pressure|^bp\b|measure bp/.test(t)) return 'BP (#6)';
  if (/urinalysis|urine dip|proteinuria|urine test/.test(t)) return 'Urinalysis (#7)';
  if (/handheld doppler|auscultate.*heart|fh.*doppler/.test(t)) return 'Doppler (#3)';
  if (/2 hour|left side|left lateral|focused assessment|unsure.*movement/.test(t)) return '2hr-advice (#16)';
  if (/kick chart|count.*to.*10|formal.*counting/.test(t)) return 'No-kick-chart (#2)';
  if (/plateau|32 weeks|increase until/.test(t)) return 'Plateau-counsel (#29)';
  if (/third trimester.*not expected|reduction.*frequency.*not expected|report.*reduction/.test(t)) return 'TT-counsel (#30)';
  if (/first.*felt|18.*20 weeks|primiparous.*later/.test(t)) return 'First-felt-counsel (#28)';
  if (/risk factor|fgr|stillbirth|smoking|bmi|previous sga/.test(t)) return 'Risk-factor (#18)';
  if (/ultrasound|biometry|liquor|umbilical artery doppler|growth scan|efw/.test(t)) return 'USS (#9/10/11)';
  if (/expedite|induction|iol/.test(t)) return 'Expedite-discussion';
  if (/document.*reassur|no indication to expedite/.test(t)) return 'Reassure-no-expedite';
  if (/comprehensive|document.*history.*examination/.test(t)) return 'Comprehensive-doc (#27)';
  return 'OTHER';
}

(async () => {
  const token = getAuthTokenFromState();
  if (!token) { console.error('No token'); process.exit(1); }

  const topicCounts = new Map();
  const allRuns = [];

  for (let i = 1; i <= RUNS; i++) {
    console.log(`\n=== Run ${i} ===`);
    const t0 = Date.now();
    const r = await fetch(`${SERVER_URL}/getPracticePointSuggestions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ transcript, guidelineId: GUIDELINE_ID, skipSenseCheck: true }),
    });
    const d = await r.json();
    const sugg = d.suggestions || [];
    console.log(`  Took ${Math.round((Date.now() - t0) / 1000)}s; ${sugg.length} suggestions`);
    const seen = new Set();
    for (const s of sugg) {
      const topic = classify(s.suggestion || s.name || '');
      seen.add(topic);
      console.log(`    [${topic}] ${(s.suggestion || '').slice(0, 90)}`);
    }
    allRuns.push(seen);
    for (const t of seen) topicCounts.set(t, (topicCounts.get(t) || 0) + 1);
  }

  console.log(`\n=== Topic frequency across ${RUNS} runs ===`);
  const sorted = [...topicCounts.entries()].sort((a, b) => b[1] - a[1]);
  for (const [t, c] of sorted) {
    console.log(`  ${c}/${RUNS}  ${t}`);
  }
})().catch(e => { console.error(e); process.exit(1); });
