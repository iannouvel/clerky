#!/usr/bin/env node
/**
 * Render a compliance-eval JSON result file as a PDF report.
 *
 * Layout:
 *   - Cover page: run metadata, overall pre/post scores, bar chart of all guidelines
 *   - One page per guideline: scores, delta, per-practice-point table with
 *     pre/post traffic-light verdicts and evidence quotes
 *   - Final page: review queue (low-confidence verdicts for adjudication)
 *
 * Usage:
 *   node scripts/compliance-eval-report.js tests/.compliance-eval-<ts>.json [out.pdf]
 *
 * Or programmatic:
 *   const { renderReport } = require('./compliance-eval-report');
 *   await renderReport(resultObj, '/path/to/out.pdf');
 */

const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

// ----- Helpers ------------------------------------------------------------

function escapeHtml(s) {
    return String(s ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function verdictMarker(verdict) {
    switch ((verdict || '').toLowerCase()) {
        case 'yes':     return { glyph: '✓',   cls: 'v-yes',     label: 'Compliant' };
        case 'partial': return { glyph: '◐',  cls: 'v-partial', label: 'Partial' };
        case 'no':      return { glyph: '✗',   cls: 'v-no',      label: 'Not compliant' };
        case 'na':      return { glyph: '–',   cls: 'v-na',      label: 'Not applicable' };
        default:        return { glyph: '?',   cls: 'v-unknown', label: 'Unknown' };
    }
}

function fmtDate(iso) {
    if (!iso) return '';
    try { return new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }); }
    catch { return iso; }
}

// ----- Chart --------------------------------------------------------------

/** Inline SVG: paired bars (pre vs post) per guideline. */
function renderBarChart(scenarios) {
    const valid = scenarios.filter(s => s.preScore && !s.preScore.error && s.postScore && !s.postScore.error);
    if (valid.length === 0) return '<p class="muted">No scored scenarios to chart.</p>';

    const W = 720, rowH = 38, padTop = 30, padBot = 30, padLeft = 220, padRight = 60;
    const H = padTop + padBot + rowH * valid.length;
    const chartW = W - padLeft - padRight;

    const rows = valid.map((s, i) => {
        const y = padTop + i * rowH;
        const preW = (s.preScore.scorePercent / 100) * chartW;
        const postW = (s.postScore.scorePercent / 100) * chartW;
        const labelText = s.guidelineTitle.length > 32
            ? s.guidelineTitle.slice(0, 29) + '…'
            : s.guidelineTitle;
        return `
          <text x="${padLeft - 8}" y="${y + 14}" class="row-label" text-anchor="end">${escapeHtml(labelText)}</text>
          <rect x="${padLeft}" y="${y + 4}"  width="${preW}"  height="10" class="bar-pre"/>
          <rect x="${padLeft}" y="${y + 18}" width="${postW}" height="10" class="bar-post"/>
          <text x="${padLeft + Math.max(preW, postW) + 6}" y="${y + 14}" class="bar-val">${s.preScore.scorePercent}% → ${s.postScore.scorePercent}%</text>
        `;
    }).join('');

    // Gridlines at 0/25/50/75/100
    const grid = [0, 25, 50, 75, 100].map(p => {
        const x = padLeft + (p / 100) * chartW;
        return `<line x1="${x}" y1="${padTop - 4}" x2="${x}" y2="${H - padBot + 4}" class="gridline"/>
                <text x="${x}" y="${H - padBot + 18}" class="grid-label" text-anchor="middle">${p}%</text>`;
    }).join('');

    return `
    <svg viewBox="0 0 ${W} ${H + 30}" class="chart" preserveAspectRatio="xMidYMid meet">
      <style>
        .chart { font-family: -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif; }
        .row-label { font-size: 11px; fill: #333; }
        .bar-pre  { fill: #b8c5d6; }
        .bar-post { fill: #2c6e49; }
        .bar-val  { font-size: 10px; fill: #555; }
        .gridline { stroke: #e5e7eb; stroke-width: 1; }
        .grid-label { font-size: 9px; fill: #999; }
        .legend-sq { width: 12px; height: 12px; }
      </style>
      ${grid}
      ${rows}
    </svg>
    <div class="legend">
      <span><span class="swatch pre"></span> Pre-refinement</span>
      <span><span class="swatch post"></span> Post-refinement</span>
    </div>`;
}

// ----- Per-guideline page ------------------------------------------------

function renderGuidelinePage(scenario, idx, total) {
    const pre = scenario.preScore || {};
    const post = scenario.postScore || {};
    const preOK = pre && !pre.error;
    const postOK = post && !post.error;
    const delta = (preOK && postOK) ? (post.scorePercent - pre.scorePercent) : null;
    const deltaSign = delta == null ? '' : (delta >= 0 ? '+' : '');
    const deltaClass = delta == null ? '' : (delta > 0 ? 'delta-pos' : delta < 0 ? 'delta-neg' : 'delta-zero');

    // PP table — index by serial for stable join across pre and post
    const ppByPre = new Map((pre.perPP || []).map(r => [r.serial, r]));
    const ppByPost = new Map((post.perPP || []).map(r => [r.serial, r]));
    const allSerials = Array.from(new Set([
        ...(pre.perPP || []).map(r => r.serial),
        ...(post.perPP || []).map(r => r.serial),
    ])).sort((a, b) => a - b);

    const rows = allSerials.map(serial => {
        const r1 = ppByPre.get(serial) || {};
        const r2 = ppByPost.get(serial) || {};
        const m1 = verdictMarker(r1.compliant);
        const m2 = verdictMarker(r2.compliant);
        const ppText = r2.ppText || r1.ppText || `Practice point #${serial}`;
        const evidence = r2.compliant === 'yes' && r2.evidence ? r2.evidence : '';
        return `
          <tr>
            <td class="pp-serial">${escapeHtml(String(serial))}</td>
            <td class="pp-text">${escapeHtml(ppText)}</td>
            <td class="verdict ${m1.cls}" title="${m1.label}">${m1.glyph}</td>
            <td class="verdict ${m2.cls}" title="${m2.label}">${m2.glyph}</td>
            <td class="evidence">${escapeHtml(evidence)}</td>
          </tr>`;
    }).join('');

    const summaryHTML = preOK && postOK ? `
      <div class="score-grid">
        <div class="score-cell"><div class="label">Pre-refinement</div><div class="val">${pre.scorePercent}%</div><div class="sub">${pre.compliantCount}/${pre.applicableCount} applicable PPs</div></div>
        <div class="score-cell"><div class="label">Post-refinement</div><div class="val">${post.scorePercent}%</div><div class="sub">${post.compliantCount}/${post.applicableCount} applicable PPs</div></div>
        <div class="score-cell delta ${deltaClass}"><div class="label">Δ</div><div class="val">${deltaSign}${delta}pp</div><div class="sub">${post.applicableCount} applicable</div></div>
      </div>` : `
      <div class="muted">Scoring incomplete — pre or post failed.</div>`;

    return `
    <section class="page guideline-page">
      <header>
        <div class="page-num">Guideline ${idx + 1} of ${total}</div>
        <h2>${escapeHtml(scenario.guidelineTitle)}</h2>
        <div class="meta">
          <span><strong>ID:</strong> ${escapeHtml(scenario.guidelineId)}</span>
          ${scenario.organisation ? `<span><strong>Org:</strong> ${escapeHtml(scenario.organisation)}</span>` : ''}
          <span><strong>Practice points:</strong> ${scenario.ppCount}</span>
          <span><strong>Phase-2 accepts:</strong> ${scenario.phase2Accepted ?? '—'}</span>
        </div>
      </header>

      ${summaryHTML}

      <h3>Pre-refinement note</h3>
      <pre class="note pre-note">${escapeHtml(scenario.preNote || '[no pre-note]')}</pre>

      <h3>Post-refinement note</h3>
      <pre class="note post-note">${escapeHtml(scenario.postNote || '[no post-note — agent did not complete]')}</pre>

      <h3>Practice-point compliance</h3>
      <table class="pp-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Practice point</th>
            <th>Pre</th>
            <th>Post</th>
            <th>Evidence (post-refinement, if compliant)</th>
          </tr>
        </thead>
        <tbody>${rows || '<tr><td colspan="5" class="muted">No practice-point verdicts available.</td></tr>'}</tbody>
      </table>
    </section>`;
}

// ----- Cover page --------------------------------------------------------

function renderCover(result) {
    const o = result.overall;
    const overallHTML = o ? `
      <div class="overall-grid">
        <div class="big-cell"><div class="label">Avg pre-score</div><div class="big">${o.averagePreScorePercent}%</div></div>
        <div class="big-cell"><div class="label">Avg post-score</div><div class="big">${o.averagePostScorePercent}%</div></div>
        <div class="big-cell ${o.averageDeltaPercent > 0 ? 'delta-pos' : o.averageDeltaPercent < 0 ? 'delta-neg' : ''}">
          <div class="label">Avg Δ</div>
          <div class="big">${o.averageDeltaPercent >= 0 ? '+' : ''}${o.averageDeltaPercent}pp</div>
        </div>
        <div class="big-cell"><div class="label">Scored</div><div class="big">${o.scenariosWithBothScores}/${result.scenarioCount}</div></div>
      </div>` : '<p class="muted">No overall aggregate available — run did not complete scoring on any scenario.</p>';

    return `
    <section class="page cover-page">
      <header>
        <h1>Clerky compliance evaluation</h1>
        <p class="subtitle">Practice-point compliance: pre- vs post-refinement notes</p>
      </header>

      <table class="meta-table">
        <tr><th>Run started</th><td>${escapeHtml(fmtDate(result.startedAt))}</td></tr>
        <tr><th>Run completed</th><td>${escapeHtml(fmtDate(result.completedAt))}</td></tr>
        <tr><th>Scenarios</th><td>${result.scenarioCount}</td></tr>
        <tr><th>Pre-note model</th><td>${escapeHtml(result.modelUsed || '')}</td></tr>
        <tr><th>Judge model</th><td>${escapeHtml(result.judgeModel || '')}</td></tr>
        <tr><th>Review queue</th><td>${(result.reviewQueue || []).length} low-confidence verdicts</td></tr>
        ${result.aborted ? `<tr><th>Aborted</th><td>${escapeHtml(result.abortReason || 'unknown')}</td></tr>` : ''}
      </table>

      <h2>Overall</h2>
      ${overallHTML}

      <h2>Per-guideline comparison</h2>
      ${renderBarChart(result.scenarios)}
    </section>`;
}

// ----- Review queue page -------------------------------------------------

function renderReviewQueue(result) {
    const q = result.reviewQueue || [];
    if (q.length === 0) {
        return `
        <section class="page review-page">
          <header><h2>Review queue</h2></header>
          <p class="muted">No low-confidence verdicts — judge was confident on every practice point.</p>
        </section>`;
    }
    const rows = q.map((r, i) => `
      <tr>
        <td>${i + 1}</td>
        <td class="rq-guideline">${escapeHtml(r.guidelineTitle)}</td>
        <td>${escapeHtml(r.phase)}</td>
        <td>${escapeHtml(String(r.ppSerial))}</td>
        <td class="pp-text">${escapeHtml(r.ppText)}</td>
        <td class="verdict ${verdictMarker(r.verdict).cls}">${verdictMarker(r.verdict).glyph}</td>
        <td>${(r.confidence ?? 0).toFixed(2)}</td>
        <td class="evidence">${escapeHtml(r.reason || '')}</td>
      </tr>`).join('');
    return `
    <section class="page review-page">
      <header><h2>Review queue (${q.length} low-confidence verdicts)</h2>
      <p class="muted">These verdicts had confidence below the floor. Adjudicate manually; corrections become regression cases for future judge calibration.</p></header>
      <table class="rq-table">
        <thead><tr><th>#</th><th>Guideline</th><th>Phase</th><th>PP#</th><th>Practice point</th><th>Verdict</th><th>Conf</th><th>Reason</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </section>`;
}

// ----- Stylesheet --------------------------------------------------------

const CSS = `
  @page { size: A4; margin: 15mm; }
  html, body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #1a1a1a; }
  body { margin: 0; }
  .page { page-break-after: always; padding: 0; }
  .page:last-child { page-break-after: auto; }
  header { border-bottom: 2px solid #2c6e49; padding-bottom: 8px; margin-bottom: 16px; }
  h1 { font-size: 24px; margin: 0 0 4px 0; }
  h2 { font-size: 16px; margin: 16px 0 8px 0; color: #2c6e49; }
  h3 { font-size: 13px; margin: 14px 0 6px 0; color: #444; text-transform: uppercase; letter-spacing: 0.04em; }
  .subtitle { color: #555; margin: 0; }
  .muted { color: #888; font-style: italic; font-size: 11px; }
  .page-num { font-size: 10px; color: #888; text-transform: uppercase; letter-spacing: 0.08em; }

  /* Cover */
  .meta-table { width: 100%; border-collapse: collapse; font-size: 11px; margin: 12px 0; }
  .meta-table th { text-align: left; width: 140px; padding: 4px 8px; color: #555; font-weight: 600; }
  .meta-table td { padding: 4px 8px; }
  .overall-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin: 8px 0 16px 0; }
  .big-cell { border: 1px solid #e5e7eb; border-radius: 6px; padding: 12px; text-align: center; }
  .big-cell .label { font-size: 10px; color: #888; text-transform: uppercase; letter-spacing: 0.05em; }
  .big-cell .big { font-size: 28px; font-weight: 700; color: #1a1a1a; margin-top: 4px; }
  .delta-pos .big { color: #2c6e49; }
  .delta-neg .big { color: #b91c1c; }

  /* Chart */
  .chart { width: 100%; max-width: 720px; }
  .legend { display: flex; gap: 16px; font-size: 11px; margin-top: 6px; }
  .legend .swatch { display: inline-block; width: 10px; height: 10px; margin-right: 4px; vertical-align: middle; }
  .legend .swatch.pre { background: #b8c5d6; }
  .legend .swatch.post { background: #2c6e49; }

  /* Guideline page */
  .guideline-page .meta { font-size: 10px; color: #555; display: flex; gap: 12px; flex-wrap: wrap; margin-top: 4px; }
  .score-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; margin: 12px 0; }
  .score-cell { border: 1px solid #e5e7eb; border-radius: 4px; padding: 10px; text-align: center; }
  .score-cell .label { font-size: 10px; color: #888; text-transform: uppercase; letter-spacing: 0.05em; }
  .score-cell .val { font-size: 24px; font-weight: 700; margin: 2px 0; }
  .score-cell .sub { font-size: 10px; color: #888; }
  .score-cell.delta .val { color: #1a1a1a; }
  .score-cell.delta.delta-pos .val { color: #2c6e49; }
  .score-cell.delta.delta-neg .val { color: #b91c1c; }

  pre.note { white-space: pre-wrap; word-wrap: break-word; font-family: "SF Mono", Menlo, Consolas, monospace; font-size: 9.5px; background: #f9fafb; border: 1px solid #e5e7eb; padding: 8px 10px; border-radius: 4px; max-height: 180px; overflow: hidden; }
  pre.post-note { background: #f0f7f2; }

  /* PP table */
  table.pp-table { width: 100%; border-collapse: collapse; font-size: 10px; margin-top: 6px; }
  table.pp-table th { background: #f3f4f6; padding: 6px 8px; text-align: left; font-weight: 600; font-size: 9.5px; border-bottom: 1px solid #d1d5db; }
  table.pp-table td { padding: 5px 8px; border-bottom: 1px solid #f3f4f6; vertical-align: top; }
  td.pp-serial { width: 24px; color: #888; }
  td.pp-text { width: 38%; }
  td.evidence { font-style: italic; color: #555; font-size: 9.5px; }
  td.verdict { width: 30px; text-align: center; font-size: 14px; font-weight: 600; }
  .v-yes { color: #2c6e49; }
  .v-partial { color: #b45309; }
  .v-no { color: #b91c1c; }
  .v-na { color: #9ca3af; }
  .v-unknown { color: #6b7280; }

  /* Review queue */
  table.rq-table { width: 100%; border-collapse: collapse; font-size: 9.5px; }
  table.rq-table th { background: #fef3c7; padding: 6px 8px; text-align: left; font-weight: 600; border-bottom: 1px solid #d97706; }
  table.rq-table td { padding: 5px 8px; border-bottom: 1px solid #f3f4f6; vertical-align: top; }
  .rq-guideline { width: 18%; }
`;

// ----- Main renderer -----------------------------------------------------

function renderHTML(result) {
    const scenariosForReport = (result.scenarios || []).filter(s => s.preNote);
    const pages = [
        renderCover(result),
        ...scenariosForReport.map((s, i) => renderGuidelinePage(s, i, scenariosForReport.length)),
        renderReviewQueue(result),
    ];
    return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Clerky compliance eval</title>
<style>${CSS}</style></head><body>${pages.join('\n')}</body></html>`;
}

async function renderReport(result, outPdfPath) {
    const html = renderHTML(result);
    const browser = await chromium.launch({ headless: true });
    try {
        const context = await browser.newContext();
        const page = await context.newPage();
        await page.setContent(html, { waitUntil: 'load' });
        await page.pdf({
            path: outPdfPath,
            format: 'A4',
            margin: { top: '15mm', right: '15mm', bottom: '15mm', left: '15mm' },
            printBackground: true,
        });
    } finally {
        await browser.close();
    }
    return outPdfPath;
}

// ----- CLI ---------------------------------------------------------------

async function cli() {
    const args = process.argv.slice(2);
    if (args.length < 1 || args[0] === '--help' || args[0] === '-h') {
        console.log('Usage: node scripts/compliance-eval-report.js <results.json> [out.pdf]');
        process.exit(args.length < 1 ? 1 : 0);
    }
    const inputPath = path.resolve(args[0]);
    if (!fs.existsSync(inputPath)) {
        console.error(`Input not found: ${inputPath}`);
        process.exit(1);
    }
    const result = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
    const outPath = args[1]
        ? path.resolve(args[1])
        : inputPath.replace(/\.json$/, '.pdf');
    console.log(`Rendering ${inputPath} → ${outPath}`);
    await renderReport(result, outPath);
    console.log('Done.');
}

module.exports = { renderReport, renderHTML };

if (require.main === module) {
    cli().catch(err => {
        console.error('FATAL:', err);
        process.exit(1);
    });
}
