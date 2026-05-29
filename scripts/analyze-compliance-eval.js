const fs = require('fs');
const file = process.argv[2] || 'tests/.compliance-eval-rfm-recalibrated.json';
const data = JSON.parse(fs.readFileSync(file, 'utf8'));
const s = data.scenarios[0];

const pre = s.preScore.perPP;
const post = s.postScore.perPP;

const verdictOrder = { no: 0, partial: 1, yes: 2, na: -1 };

console.log(`Guideline: ${s.guidelineTitle}`);
console.log(`Pre-note (${s.preNote.length} chars), Post-note (${s.postNote.length} chars)`);
console.log(`Pre score: ${s.preScore.applicableCount ? Math.round(100*s.preScore.compliantCount/s.preScore.applicableCount) : '?'}% (${s.preScore.compliantCount}/${s.preScore.applicableCount} applicable)`);
console.log(`Post score: ${s.postScore.applicableCount ? Math.round(100*s.postScore.compliantCount/s.postScore.applicableCount) : '?'}% (${s.postScore.compliantCount}/${s.postScore.applicableCount} applicable)`);
console.log(`Phase 2 accepted: ${s.phase2Accepted}`);

console.log('\n=== Pre vs Post per PP (applicable only) ===');
console.log(' PP | Pre      | Post     | Change | PP wording');
console.log(' ---+----------+----------+--------+-----------');
for (let i = 0; i < pre.length; i++) {
  const p = pre[i], q = post[i];
  if (p.applicable === false && q.applicable === false) continue;
  const pv = p._error ? 'ERR' : p.compliant;
  const qv = q._error ? 'ERR' : q.compliant;
  const changed = pv !== qv ? (verdictOrder[qv] > verdictOrder[pv] ? '↑ IMPROVED' : verdictOrder[qv] < verdictOrder[pv] ? '↓ DROPPED' : '~ changed') : '';
  console.log(` #${String(p.serial).padStart(2)} | ${pv.padEnd(8)} | ${qv.padEnd(8)} | ${changed.padEnd(11)} | ${p.ppText.slice(0,80)}`);
}

console.log('\n=== Post-note FAILURES — applicable PPs not met ===');
for (const q of post) {
  if (q.applicable === false || q.compliant === 'yes' || q.compliant === 'na') continue;
  console.log(`\n--- PP #${q.serial} (verdict: ${q.compliant}, confidence: ${q.confidence}) ---`);
  console.log(`PP: ${q.ppText}`);
  console.log(`Applicability: ${q.applicability_reason || '(none)'}`);
  console.log(`Evidence: ${q.evidence || '(none)'}`);
  console.log(`Reason: ${q.reason}`);
}

console.log('\n=== Improvements from pre to post ===');
for (let i = 0; i < pre.length; i++) {
  const p = pre[i], q = post[i];
  if (verdictOrder[q.compliant] > verdictOrder[p.compliant]) {
    console.log(`  PP #${p.serial}: ${p.compliant} → ${q.compliant}: ${p.ppText.slice(0,80)}`);
  }
}

console.log('\n=== Regressions (post worse than pre) ===');
for (let i = 0; i < pre.length; i++) {
  const p = pre[i], q = post[i];
  if (verdictOrder[q.compliant] < verdictOrder[p.compliant] && verdictOrder[q.compliant] >= 0) {
    console.log(`  PP #${p.serial}: ${p.compliant} → ${q.compliant}: ${p.ppText.slice(0,80)}`);
  }
}

console.log('\n=== Parse errors / judge issues ===');
for (const arr of [['pre', pre], ['post', post]]) {
  for (const v of arr[1]) {
    if (v._error || v.applicable === null) {
      console.log(`  [${arr[0]}] PP #${v.serial}: ${v._error || 'applicable=null'}: ${v.ppText.slice(0,80)}`);
    }
  }
}

console.log('\n=== Applicable counts ===');
const preApp = pre.filter(p => p.applicable !== false).length;
const postApp = post.filter(p => p.applicable !== false).length;
console.log(`  Pre applicable (incl. errors): ${preApp}/${pre.length}`);
console.log(`  Post applicable (incl. errors): ${postApp}/${post.length}`);

console.log('\n=== NA reasons (applicable=false) ===');
for (const q of post) {
  if (q.applicable === false) {
    console.log(`  PP #${q.serial}: ${q.applicability_reason?.slice(0,140) || '(none)'}`);
  }
}
