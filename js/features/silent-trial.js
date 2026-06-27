/**
 * Silent-Trial scoring panel  (CLERKY-CE-001 Part B / ST-003)
 * ---------------------------------------------------------------------------
 * Self-contained, additive, plain-script (no module imports). Activates ONLY in
 * silent-trial mode (silent-trial.html → ?trial=1 / sessionStorage flag). Reads
 * Clerky's own suggestions from window.currentSuggestions and lets a clinician
 * rate each on the ST-003 graded scale (Accuracy / Relevance / Usefulness 1–4,
 * Citation category, binary Safety flag), capture the recall reference standard
 * (Fully / Partially / Missed), see the CE-001 §B4 endpoints compute live, and
 * export rows shaped for the CLERKY-ST-001 workbook. Scores persist in
 * localStorage per case so a reload doesn't lose work.
 *
 * Nothing here touches the clinical pipeline — it only READS currentSuggestions.
 */
(function () {
    'use strict';

    function trialModeOn() {
        try {
            const p = new URLSearchParams(window.location.search);
            return p.has('trial') || sessionStorage.getItem('clerkySilentTrialMode') === '1';
        } catch (e) { return false; }
    }
    if (!trialModeOn()) return;

    // --- Disable tooling nav in trial mode (tooltip "Disabled in trial") ---------
    // These open editing/admin surfaces that have no place in a clinician's trial
    // run. We tag + visually disable them and block clicks in the capture phase,
    // so it works regardless of when script.js attaches their handlers.
    const DISABLED_NAV_IDS = ['preferencesPanelBtn', 'testBtn', 'promptsPanelBtn',
        'guidelinesPanelBtn', 'workflowsPanelBtn', 'devPanelBtn', 'linksPanelBtn'];
    function applyTrialNavLock() {
        DISABLED_NAV_IDS.forEach(id => {
            const b = document.getElementById(id);
            if (!b || b.dataset.trialDisabled) return;
            b.dataset.trialDisabled = '1';
            b.setAttribute('title', 'Disabled in trial');
            b.setAttribute('aria-disabled', 'true');
            b.style.opacity = '0.45';
            b.style.cursor = 'not-allowed';
        });
    }
    document.addEventListener('click', function (e) {
        const t = e.target.closest && e.target.closest('[data-trial-disabled="1"]');
        if (t) { e.preventDefault(); e.stopImmediatePropagation(); }
    }, true);
    function scheduleNavLock() { applyTrialNavLock(); setTimeout(applyTrialNavLock, 1500); setTimeout(applyTrialNavLock, 4000); }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', scheduleNavLock); else scheduleNavLock();

    const CITATION_OPTS = [
        'Correct & verifiable',
        'Right source, wrong section',
        'Unverifiable',
        'Wrong/fabricated source'
    ];
    const AXES = [
        { key: 'accuracy',   label: 'Accuracy',   hint: '4 fully · 3 mostly · 2 partial · 1 inaccurate' },
        { key: 'relevance',  label: 'Relevance',  hint: '4 highly · 3 w/ caveats · 2 marginal · 1 irrelevant' },
        { key: 'usefulness', label: 'Usefulness', hint: '4 highly useful · 3 useful · 2 low value · 1 not useful' }
    ];

    // ---- state ----
    let caseId = 'ST-001';
    let state = load();          // { [suggestionId]: {accuracy,relevance,usefulness,citation,safety,mapsTo} }
    let refRows = loadRefs();    // [{refId, text, source, status}]

    function storeKey() { return 'clerkySilentTrial:' + caseId; }
    function refKey() { return 'clerkySilentTrialRefs:' + caseId; }
    function load() { try { return JSON.parse(localStorage.getItem('clerkySilentTrial:ST-001') || '{}'); } catch (e) { return {}; } }
    function save() { try { localStorage.setItem(storeKey(), JSON.stringify(state)); } catch (e) {} }
    function loadRefs() { try { return JSON.parse(localStorage.getItem('clerkySilentTrialRefs:ST-001') || '[]'); } catch (e) { return []; } }
    function saveRefs() { try { localStorage.setItem(refKey(), JSON.stringify(refRows)); } catch (e) {} }

    const CANDIDATE_REFS = [
        ['R1', 'In-labour CBG hourly, target 4–7 mmol/L', 'UHSussex Diabetes / NICE NG3'],
        ['R2', 'Start VRII if labour glucose ≥7.0 mmol/L', 'UHSussex Diabetes'],
        ['R3', 'Insulin handling in labour (basal continue / short-acting plan)', 'UHSussex Diabetes'],
        ['R4', 'Neonatal hypoglycaemia plan (neonatal team, early feeding, newborn CBG)', 'NICE NG3 §1.5'],
        ['R5', 'Continuous fetal monitoring in established labour', 'UHSussex / NICE NG3'],
        ['R6', 'Bishop score / cervical assessment before IOL', 'NICE NG207'],
        ['R7', 'Aspirin dose 150 mg / review stop at term', 'UHSussex Diabetes'],
        ['R8', 'Antenatal colostrum harvesting from 36 weeks', 'UHSussex Diabetes'],
        ['R9', 'Postnatal diabetes plan + HbA1c ~12 weeks', 'UHSussex Diabetes'],
        ['R10', 'VTE risk assessment + prophylaxis decision', 'RCOG GTG 37a'],
        ['R11', 'IV access + group & save on admission', 'Trust IOL'],
        ['R12', 'Anaesthetic awareness / early epidural discussion', 'Trust intrapartum']
    ];

    // ---- metrics (mirror CLERKY-ST-001 / ST-003 §2 thresholds) ----
    function pct(n, d) { return d > 0 ? n / d : null; }
    function fmtPct(x) { return x == null ? '—' : (x * 100).toFixed(0) + '%'; }
    function computeMetrics() {
        const rows = Object.values(state).filter(r => r && (r.accuracy || r.relevance || r.usefulness || r.citation || r.safety));
        const acc = rows.filter(r => r.accuracy);
        const rel = rows.filter(r => r.relevance);
        const use = rows.filter(r => r.usefulness);
        const cit = rows.filter(r => r.citation);
        const saf = rows.filter(r => r.safety);
        const mean = a => a.length ? (a.reduce((s, x) => s + x, 0) / a.length) : null;
        const refScored = refRows.filter(r => r.status);
        return {
            n: rows.length,
            precision: pct(rel.filter(r => r.relevance >= 3).length, rel.length),
            correctness: pct(acc.filter(r => r.accuracy >= 3).length, acc.length),
            usefulnessMean: mean(use.map(r => r.usefulness)),
            misCitation: pct(cit.filter(r => r.citation !== 'Correct & verifiable').length, cit.length),
            harmRate: pct(saf.filter(r => r.safety === 'Y').length, saf.length),
            recall: pct(refScored.filter(r => r.status === 'Fully').length, refScored.length),
            accMean: mean(acc.map(r => r.accuracy)),
            relMean: mean(rel.map(r => r.relevance))
        };
    }

    // ---- DOM helpers ----
    function el(tag, css, html) { const e = document.createElement(tag); if (css) e.style.cssText = css; if (html != null) e.innerHTML = html; return e; }
    function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

    // ---- floating button + panel ----
    let panel;
    // Top-centre, floating in the header band. Reuse the .logo class so it matches
    // the "clerky" header button exactly (font, colour, translucent pill, hover);
    // inline styles only handle positioning.
    const btn = el('button', 'position:fixed;top:10px;left:50%;transform:translateX(-50%);z-index:99998;', 'Silent Trial');
    btn.className = 'logo';
    btn.onclick = () => { if (!panel) buildPanel(); panel.style.display = panel.style.display === 'none' ? 'flex' : 'none'; if (panel.style.display !== 'none') refresh(); };
    document.addEventListener('DOMContentLoaded', () => document.body.appendChild(btn));
    if (document.readyState !== 'loading') document.body.appendChild(btn);

    function buildPanel() {
        panel = el('div', 'position:fixed;top:0;right:0;width:min(560px,96vw);height:100vh;z-index:99999;display:flex;flex-direction:column;background:var(--bg-primary,#0f1620);color:var(--text-primary,#e6edf3);box-shadow:-6px 0 24px rgba(0,0,0,.4);font:14px/1.4 system-ui;');
        // header
        const ver = (document.getElementById('appVersion') || {}).textContent || '?';
        const tester = (() => { try { return localStorage.getItem('clerkyTesterInitials') || ''; } catch (e) { return ''; } })();
        const head = el('div', 'flex:0 0 auto;padding:12px 16px;border-bottom:1px solid rgba(255,255,255,.12);');
        head.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:center;">
              <strong style="font-size:15px;">Silent-Trial scoring</strong>
              <button id="st-close" style="background:none;border:none;color:inherit;font-size:20px;cursor:pointer;">×</button>
            </div>
            <div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap;font-size:12px;opacity:.85;">
              <label>Case <input id="st-case" value="${esc(caseId)}" style="width:70px;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.2);color:inherit;border-radius:6px;padding:3px 6px;"></label>
              <span>Clerky v${esc(ver)}</span>
              <span>Scorer ${esc(tester || '—')}</span>
            </div>
            <p style="margin:8px 0 0;font-size:11px;opacity:.7;">Rate each suggestion per ST-003 (4 = best). Scores save automatically. Run an analysis first, then “Load suggestions”.</p>`;
        panel.appendChild(head);

        // scroll body
        const body = el('div', 'flex:1 1 auto;overflow-y:auto;padding:12px 16px;');
        body.id = 'st-body';
        panel.appendChild(body);

        // footer metrics + actions
        const foot = el('div', 'flex:0 0 auto;padding:10px 16px;border-top:1px solid rgba(255,255,255,.12);background:rgba(0,0,0,.15);');
        foot.id = 'st-foot';
        panel.appendChild(foot);

        document.body.appendChild(panel);
        head.querySelector('#st-close').onclick = () => panel.style.display = 'none';
        head.querySelector('#st-case').onchange = (e) => { caseId = (e.target.value || 'ST-001').trim(); state = JSON.parse(localStorage.getItem(storeKey()) || '{}'); refRows = JSON.parse(localStorage.getItem(refKey()) || '[]'); refresh(); };
        refresh();
    }

    function btnStyle(active) {
        return 'min-width:30px;padding:4px 0;margin:0 2px;border-radius:6px;cursor:pointer;font:600 13px system-ui;border:1px solid ' +
            (active ? '#3fa7c4;background:#1f4e5f;color:#fff' : 'rgba(255,255,255,.25);background:transparent;color:inherit');
    }

    function refresh() {
        if (!panel) return;
        const body = panel.querySelector('#st-body');
        body.innerHTML = '';

        // --- suggestions section ---
        const sugHead = el('div', 'display:flex;justify-content:space-between;align-items:center;margin:4px 0 8px;');
        sugHead.innerHTML = `<strong>Suggestions</strong>`;
        const loadBtn = el('button', 'padding:5px 10px;border-radius:6px;border:1px solid #3fa7c4;background:#1f4e5f;color:#fff;cursor:pointer;font:600 12px system-ui;', 'Load suggestions');
        loadBtn.onclick = () => refresh();
        sugHead.appendChild(loadBtn);
        body.appendChild(sugHead);

        const suggestions = Array.isArray(window.currentSuggestions) ? window.currentSuggestions : [];
        if (!suggestions.length) {
            body.appendChild(el('p', 'opacity:.7;font-size:13px;', 'No suggestions in memory yet. Run the analysis (Analyse → accept the guideline checkpoint → let suggestions generate), then click <em>Load suggestions</em>.'));
        }

        suggestions.forEach((s, i) => {
            const id = s.id || ('idx-' + i);
            const itemId = 'C' + (i + 1);
            state[id] = state[id] || {};
            const sc = state[id];
            const card = el('div', 'border:1px solid rgba(255,255,255,.15);border-radius:8px;padding:10px;margin-bottom:10px;');
            const guideline = s.guidelineTitle || s.guideline || s.guidelineId || '';
            const text = s.suggestedText || s.context || s.text || '(no text)';
            card.appendChild(el('div', 'font-size:11px;opacity:.6;margin-bottom:4px;', `${itemId} · ${esc((s.category || '').toString().toUpperCase())}${s.priority ? ' · ' + esc(s.priority) : ''}${guideline ? ' · ' + esc(guideline) : ''}`));
            card.appendChild(el('div', 'font-size:13px;margin-bottom:8px;', esc(text)));

            // axis button groups
            AXES.forEach(ax => {
                const row = el('div', 'display:flex;align-items:center;gap:6px;margin:4px 0;');
                row.appendChild(el('span', 'width:78px;font-size:12px;opacity:.85;', ax.label));
                [1, 2, 3, 4].forEach(v => {
                    const b = el('button', btnStyle(sc[ax.key] === v), String(v));
                    b.title = ax.hint;
                    b.onclick = () => { sc[ax.key] = (sc[ax.key] === v ? null : v); save(); refresh(); };
                    row.appendChild(b);
                });
                card.appendChild(row);
            });

            // citation
            const cRow = el('div', 'display:flex;align-items:center;gap:6px;margin:4px 0;');
            cRow.appendChild(el('span', 'width:78px;font-size:12px;opacity:.85;', 'Citation'));
            const sel = el('select', 'flex:1;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.2);color:inherit;border-radius:6px;padding:4px;');
            sel.appendChild(el('option', '', '— select —'));
            CITATION_OPTS.forEach(o => { const op = el('option', '', esc(o)); op.value = o; if (sc.citation === o) op.selected = true; sel.appendChild(op); });
            sel.onchange = () => { sc.citation = sel.value || null; save(); refresh(); };
            cRow.appendChild(sel);
            card.appendChild(cRow);

            // safety flag + maps-to
            const sRow = el('div', 'display:flex;align-items:center;gap:6px;margin:6px 0 0;');
            sRow.appendChild(el('span', 'width:78px;font-size:12px;opacity:.85;', 'Safety harm?'));
            ['N', 'Y'].forEach(v => {
                const active = sc.safety === v;
                const b = el('button', btnStyle(active) + (v === 'Y' && active ? ';background:#7a1f1f;border-color:#c44' : ''), v);
                b.onclick = () => { sc.safety = (sc.safety === v ? null : v); save(); refresh(); };
                sRow.appendChild(b);
            });
            const maps = el('input', 'flex:1;margin-left:8px;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.2);color:inherit;border-radius:6px;padding:4px 6px;');
            maps.placeholder = 'Maps to Ref ID (e.g. R1)';
            maps.value = sc.mapsTo || '';
            maps.onchange = () => { sc.mapsTo = maps.value.trim(); save(); };
            sRow.appendChild(maps);
            card.appendChild(sRow);

            body.appendChild(card);
        });

        // --- reference standard / recall ---
        const refHead = el('div', 'display:flex;justify-content:space-between;align-items:center;margin:16px 0 8px;');
        refHead.innerHTML = `<strong>Reference standard (recall)</strong>`;
        const wrap = el('div', 'display:flex;gap:6px;');
        const addBtn = el('button', 'padding:4px 8px;border-radius:6px;border:1px solid rgba(255,255,255,.3);background:transparent;color:inherit;cursor:pointer;font-size:12px;', '+ row');
        addBtn.onclick = () => { refRows.push({ refId: 'R' + (refRows.length + 1), text: '', source: '', status: '' }); saveRefs(); refresh(); };
        const seedBtn = el('button', 'padding:4px 8px;border-radius:6px;border:1px solid rgba(255,255,255,.3);background:transparent;color:inherit;cursor:pointer;font-size:12px;', 'Load candidate');
        seedBtn.title = 'Seed R1–R12 from the candidate ground truth (facilitator). Use only after the panel has set its own — see ST-002.';
        seedBtn.onclick = () => { if (!refRows.length || confirm('Replace current reference rows with the candidate R1–R12?')) { refRows = CANDIDATE_REFS.map(([refId, text, source]) => ({ refId, text, source, status: '' })); saveRefs(); refresh(); } };
        wrap.appendChild(seedBtn); wrap.appendChild(addBtn);
        refHead.appendChild(wrap);
        body.appendChild(refHead);

        refRows.forEach((r, i) => {
            const row = el('div', 'display:flex;gap:4px;align-items:center;margin-bottom:6px;');
            const idIn = el('input', 'width:44px;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.2);color:inherit;border-radius:6px;padding:4px;font-size:12px;'); idIn.value = r.refId; idIn.onchange = () => { r.refId = idIn.value.trim(); saveRefs(); };
            const txt = el('input', 'flex:1;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.2);color:inherit;border-radius:6px;padding:4px;font-size:12px;'); txt.value = r.text; txt.placeholder = 'required point'; txt.onchange = () => { r.text = txt.value.trim(); saveRefs(); };
            const sel = el('select', 'background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.2);color:inherit;border-radius:6px;padding:4px;font-size:12px;');
            ['', 'Fully', 'Partially', 'Missed'].forEach(o => { const op = el('option', '', o || '— surfaced? —'); op.value = o; if (r.status === o) op.selected = true; sel.appendChild(op); });
            sel.onchange = () => { r.status = sel.value; saveRefs(); refresh(); };
            const del = el('button', 'background:none;border:none;color:#c66;cursor:pointer;font-size:16px;', '×'); del.onclick = () => { refRows.splice(i, 1); saveRefs(); refresh(); };
            row.appendChild(idIn); row.appendChild(txt); row.appendChild(sel); row.appendChild(del);
            body.appendChild(row);
        });

        renderFooter();
    }

    function renderFooter() {
        const m = computeMetrics();
        const foot = panel.querySelector('#st-foot');
        const chip = (label, val, ok) => `<div style="flex:1 1 30%;min-width:120px;background:rgba(255,255,255,.05);border-radius:6px;padding:6px 8px;">
            <div style="font-size:10px;opacity:.65;">${label}</div>
            <div style="font-size:15px;font-weight:600;color:${ok == null ? 'inherit' : (ok ? '#7ed492' : '#e88')};">${val}</div></div>`;
        foot.innerHTML = `
            <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px;">
              ${chip('Precision (Rel≥3)', fmtPct(m.precision), m.precision == null ? null : m.precision >= 0.8)}
              ${chip('Correctness (Acc≥3)', fmtPct(m.correctness), m.correctness == null ? null : m.correctness >= 0.9)}
              ${chip('Usefulness (mean)', m.usefulnessMean == null ? '—' : m.usefulnessMean.toFixed(2), m.usefulnessMean == null ? null : m.usefulnessMean >= 3)}
              ${chip('Mis-citation', fmtPct(m.misCitation), m.misCitation == null ? null : m.misCitation <= 0.05)}
              ${chip('Harm rate', fmtPct(m.harmRate), m.harmRate == null ? null : m.harmRate <= 0.01)}
              ${chip('Recall (Fully)', fmtPct(m.recall), m.recall == null ? null : m.recall >= 0.8)}
            </div>
            <div style="display:flex;gap:8px;">
              <button id="st-json" style="flex:1;padding:7px;border-radius:6px;border:none;background:#1f4e5f;color:#fff;cursor:pointer;font:600 12px system-ui;">Export JSON</button>
              <button id="st-csv" style="flex:1;padding:7px;border-radius:6px;border:1px solid rgba(255,255,255,.3);background:transparent;color:inherit;cursor:pointer;font:600 12px system-ui;">Export CSV (workbook)</button>
              <button id="st-reset" style="padding:7px 10px;border-radius:6px;border:1px solid #c66;background:transparent;color:#e88;cursor:pointer;font-size:12px;">Reset</button>
            </div>
            <p style="margin:6px 0 0;font-size:10px;opacity:.55;">n=${m.n} scored. Targets shown are the ST-001 defaults; confirm in the workbook. CSV columns match ST-001 tabs 2 & 3.</p>`;
        foot.querySelector('#st-json').onclick = exportJSON;
        foot.querySelector('#st-csv').onclick = exportCSV;
        foot.querySelector('#st-reset').onclick = () => { if (confirm('Clear all scores for ' + caseId + '?')) { state = {}; refRows = []; save(); saveRefs(); refresh(); } };
    }

    // ---- exports ----
    function collectRows() {
        const suggestions = Array.isArray(window.currentSuggestions) ? window.currentSuggestions : [];
        return suggestions.map((s, i) => {
            const id = s.id || ('idx-' + i);
            const sc = state[id] || {};
            return {
                caseId, itemId: 'C' + (i + 1),
                suggestion: s.suggestedText || s.context || s.text || '',
                citedSource: s.sourceQuote ? (s.guidelineTitle || s.guideline || s.guidelineId || '') : (s.guidelineTitle || s.guideline || s.guidelineId || ''),
                accuracy: sc.accuracy || '', relevance: sc.relevance || '', usefulness: sc.usefulness || '',
                citation: sc.citation || '', safety: sc.safety || '', mapsTo: sc.mapsTo || ''
            };
        });
    }
    function dl(name, text, type) {
        const blob = new Blob([text], { type: type || 'text/plain' });
        const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }
    function csvCell(v) { v = String(v == null ? '' : v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
    function exportJSON() {
        const ver = (document.getElementById('appVersion') || {}).textContent || '';
        const tester = (() => { try { return localStorage.getItem('clerkyTesterInitials') || ''; } catch (e) { return ''; } })();
        const out = { caseId, clerkyVersion: ver, scorer: tester, scenario: 'CLERKY-ST-CASE-001',
            metrics: computeMetrics(), suggestions: collectRows(), referenceStandard: refRows };
        dl(`silent-trial_${caseId}.json`, JSON.stringify(out, null, 2), 'application/json');
    }
    function exportCSV() {
        const rows = collectRows();
        const head3 = ['Case ID', 'Item ID', 'Clerky suggestion (verbatim)', 'Cited source', 'Accuracy (1-4)', 'Relevance (1-4)', 'Usefulness (1-4)', 'Citation (category)', 'Safety flag (Y/N)', 'Maps to Ref ID'];
        const lines3 = [head3.join(',')].concat(rows.map(r => [r.caseId, r.itemId, r.suggestion, r.citedSource, r.accuracy, r.relevance, r.usefulness, r.citation, r.safety, r.mapsTo].map(csvCell).join(',')));
        const head2 = ['Case ID', 'Ref ID', 'Applicable recommendation / required documentation', 'Source guideline + section', 'Adjudicated? (Y/N)', 'Surfaced by Clerky? (Fully/Partially/Missed)'];
        const lines2 = [head2.join(',')].concat(refRows.map(r => [caseId, r.refId, r.text, r.source, '', r.status].map(csvCell).join(',')));
        dl(`silent-trial_${caseId}_tab3-clerky-scoring.csv`, lines3.join('\n'), 'text/csv');
        setTimeout(() => dl(`silent-trial_${caseId}_tab2-reference-standard.csv`, lines2.join('\n'), 'text/csv'), 300);
    }

    console.log('[SILENT-TRIAL] scoring panel active for case', caseId);
})();
