import { flashBoldInEditor, showInsertionPreview, clearInsertionPreview, INSERTION_PLACEHOLDER, getReplacementPreview, getContentBeforePreview, clearReplacementState } from '../utils/editor.js';

/**
 * Opens the PDF for a guideline in a new tab.
 * Fetches a fresh auth token at click time so the link never expires.
 * Appends a #search fragment as best-effort text highlight (works in PDF.js-based viewers).
 */
window.openGuidelinePdf = async function(guidelineId, searchText) {
    if (!guidelineId) return;
    try {
        const user = window.auth?.currentUser;
        if (!user) { console.warn('[WIZARD] Not authenticated — cannot open guideline PDF'); return; }
        const idToken = await user.getIdToken();
        const base = `${window.SERVER_URL}/api/pdf/${encodeURIComponent(guidelineId)}?token=${encodeURIComponent(idToken)}`;
        const url = searchText ? `${base}#search=${encodeURIComponent(searchText)}` : base;
        window.open(url, '_blank');
    } catch (e) {
        console.error('[WIZARD] Failed to open guideline PDF:', e);
    }
};

// Tracks the pending showInsertionPreview timeout so stale timeouts can be cancelled
let _previewTimeout = null;

/**
 * Initialize the suggestion wizard in the given container
 * @param {HTMLElement} container - The container element to render the wizard into
 * @param {Array} suggestions - List of suggestions to display
 * @param {Object} callbacks - callbacks for interacting with the main app/editor
 */
export function initializeSuggestionWizard(container, suggestions, callbacks) {
    const {
        getUserInputContent,
        setUserInputContent,
        determineInsertionPoint,
        insertTextAtPoint,
        onComplete,
        phaseLabel
    } = callbacks;

    if (!container) {
        console.error('[WIZARD] Container not found');
        return;
    }

    // Ensure guideline selection interface is hidden when wizard takes over
    document.querySelector('.guideline-selection-interface')?.remove();

    if (!suggestions || suggestions.length === 0) {
        container.innerHTML = '<div class="alert alert-info">Analysis complete, but no specific suggestions were found.</div>';
        return;
    }

    // Initialize state
    window.suggestionWizardState = {
        queue: suggestions,
        currentIndex: 0,
        total: suggestions.length
    };

    // Render an appropriate input control for a structured missing-info item
    function renderStructuredInput(id, missingInfo, dto) {
        const escapedLabel = (missingInfo || '').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
        const notesHtml = '';
        switch (dto.type) {
            case 'numeric':
                return `<div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
                    <input type="number" step="any" id="${id}-structured-input" data-missing-info="${escapedLabel}"
                        placeholder="Enter value…"
                        style="padding:6px 10px; border-radius:4px; border:1px solid var(--border-color); background:var(--bg-input); color:var(--text-primary); width:130px; font-size:1em;">
                    ${dto.units ? `<span style="color:var(--text-secondary); font-size:0.9em;">${dto.units}</span>` : ''}
                </div>${notesHtml}`;
            case 'binary':
            case 'categorical': {
                const options = (dto.options || [])
                    .map(opt => `<option value="${opt.replace(/"/g, '&quot;')}">${opt}</option>`)
                    .join('');
                return `<select id="${id}-structured-input" data-missing-info="${escapedLabel}"
                    style="padding:6px 10px; border-radius:4px; border:1px solid var(--border-color); background:var(--bg-input); color:var(--text-primary); font-size:1em; cursor:pointer; max-width:100%;">
                    <option value="">— select —</option>
                    ${options}
                </select>${notesHtml}`;
            }
            case 'multi_select': {
                const checkboxes = (dto.options || []).map((opt, i) => {
                    const optId = `${id}-ms-${i}`;
                    const escaped = opt.replace(/"/g, '&quot;');
                    return `<label style="display:flex; align-items:center; gap:8px; padding:4px 0; cursor:pointer; color:var(--text-primary);">
                        <input type="checkbox" id="${optId}" class="${id}-ms-checkbox" value="${escaped}"
                            style="width:15px; height:15px; cursor:pointer; flex-shrink:0;">
                        <span style="font-size:0.93em;">${opt}</span>
                    </label>`;
                }).join('');
                const otherField = dto.allow_other !== false
                    ? `<div style="margin-top:8px;">
                        <label style="font-size:0.82em; color:var(--text-secondary); display:block; margin-bottom:3px;">Other (specify):</label>
                        <input type="text" id="${id}-ms-other" placeholder="Type here…"
                            style="width:100%; padding:6px 10px; border-radius:4px; border:1px solid var(--border-color); background:var(--bg-input); color:var(--text-primary); font-size:0.93em; box-sizing:border-box;">
                    </div>`
                    : '';
                return `<div id="${id}-structured-input" data-missing-info="${escapedLabel}" data-type="multi_select"
                    style="display:flex; flex-direction:column; gap:2px;">
                    ${checkboxes}
                    ${otherField}
                </div>${notesHtml}`;
            }
            case 'compound': {
                const fields = (dto.fields || []).map((f, i) => {
                    const fid = `${id}-compound-${i}`;
                    const escapedFieldLabel = f.label.replace(/"/g, '&quot;');
                    const unitsLower = (f.units || '').toLowerCase();
                    const labelLower = (f.label || '').toLowerCase();
                    const isDateField = unitsLower.includes('date') || labelLower === 'date';
                    const isGestationField = unitsLower.includes('gestation') || unitsLower.includes('weeks') || labelLower.includes('gestation');
                    const inputEl = Array.isArray(f.options) && f.options.length > 0
                        ? `<select id="${fid}" class="${id}-compound-field" data-label="${escapedFieldLabel}"
                               style="padding:6px 10px; border-radius:4px; border:1px solid var(--border-color); background:var(--bg-input); color:var(--text-primary); font-size:1em; cursor:pointer;">
                               <option value="">— select —</option>
                               ${f.options.map(o => `<option value="${o.replace(/"/g,'&quot;')}">${o}</option>`).join('')}
                           </select>`
                        : isDateField
                        ? `<input type="date" id="${fid}" class="${id}-compound-field" data-label="${escapedFieldLabel}"
                               style="padding:6px 10px; border-radius:4px; border:1px solid var(--border-color); background:var(--bg-input); color:var(--text-primary); font-size:1em;">`
                        : isGestationField
                        ? `<input type="text" id="${fid}" class="${id}-compound-field" data-label="${escapedFieldLabel}"
                               placeholder="e.g. 28+3"
                               style="padding:6px 10px; border-radius:4px; border:1px solid var(--border-color); background:var(--bg-input); color:var(--text-primary); width:120px; font-size:1em;">`
                        : `<input type="number" step="any" id="${fid}" class="${id}-compound-field" data-label="${escapedFieldLabel}"
                               placeholder="Enter value…"
                               style="padding:6px 10px; border-radius:4px; border:1px solid var(--border-color); background:var(--bg-input); color:var(--text-primary); width:120px; font-size:1em;">
                           ${f.units ? `<span style="color:var(--text-secondary); font-size:0.9em;">${f.units}</span>` : ''}`;
                    return `<div style="display:flex; align-items:center; gap:8px; margin-bottom:6px;">
                        <label for="${fid}" style="font-size:0.88em; color:var(--text-secondary); min-width:120px;">${f.label}:</label>
                        ${inputEl}
                    </div>`;
                }).join('');
                return `<div id="${id}-structured-input" data-missing-info="${escapedLabel}" data-type="compound">
                    ${fields}
                </div>${notesHtml}`;
            }
            case 'free_text':
            default: {
                const prefill = (dto.suggested_content || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
                const placeholder = prefill ? '' : 'Enter details…';
                return `<textarea id="${id}-structured-input" data-missing-info="${escapedLabel}"
                    placeholder="${placeholder}"
                    style="width:100%; height:100%; min-height:80px; padding:8px 10px; border-radius:4px; border:1px solid var(--border-color); background:var(--bg-input); color:var(--text-primary); font-size:0.95em; font-family:inherit; resize:none; box-sizing:border-box;">${prefill}</textarea>${notesHtml}`;
            }
        }
    }

    // Returns true if the suggestion is no longer needed given the current note content
    const isSuggestionStale = (suggestion) => {
        const noteContent = getUserInputContent() || '';
        const replacePattern = suggestion.replace_pattern;
        const missingInfo = (suggestion.missing_info || '').trim();

        // If a replace_pattern was set and it no longer exists in the note, the placeholder
        // was already replaced — this suggestion is done
        if (replacePattern && !noteContent.includes(replacePattern)) {
            return true;
        }

        // If missing_info now appears in the note as "Label: <value>" (i.e. it's been filled in),
        // skip it
        if (missingInfo) {
            const escapedLabel = missingInfo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            if (new RegExp(escapedLabel + '\\s*:', 'i').test(noteContent)) {
                return true;
            }
        }

        return false;
    };

    // Define Renderer
    const renderCurrentSuggestion = () => {
        const state = window.suggestionWizardState;

        if (!container) return;

        // Cancel any pending preview timeout and clear any existing preview
        if (_previewTimeout) { clearTimeout(_previewTimeout); _previewTimeout = null; }
        clearInsertionPreview();

        // Auto-skip suggestions whose information is already present in the note
        while (state.currentIndex < state.total && isSuggestionStale(state.queue[state.currentIndex])) {
            console.log('[WIZARD] Auto-skipping stale suggestion:', state.queue[state.currentIndex].missing_info);
            state.currentIndex++;
        }

        // Check for completion
        if (state.currentIndex >= state.total) {
            container.innerHTML = `
                <div class="sw-wrap">
                  <div class="sw-header">
                    <span class="sw-title">AI Suggestions</span>
                    <button class="sw-close-btn" onclick="window._wizardClose()">&#x2715;</button>
                  </div>
                  <div class="sw-body" style="text-align:center; padding:30px;">
                    <div style="font-size:2.5em; margin-bottom:16px;">&#x2713;</div>
                    <h3 style="color:var(--text-primary); margin:0 0 8px 0;">Review Complete</h3>
                    <p style="color:var(--text-secondary); margin:0;">All ${state.total} suggestion${state.total === 1 ? '' : 's'} reviewed.</p>
                  </div>
                </div>
            `;
            setTimeout(() => window._wizardClose(), 800);
            return;
        }

        const suggestion = state.queue[state.currentIndex];
        const currentNumber = state.currentIndex + 1;
        const total = state.total;

        // Safely access properties
        const suggestionText = suggestion.suggestion || suggestion.recommendation || suggestion.name || suggestion.issue || suggestion.text || suggestion.title || suggestion.description || suggestion.content || suggestion.advice || 'No text available';
        const suggestionReasoning = suggestion.why || suggestion.notCoveredBy || suggestion.reasoning || suggestion.rationale || suggestion.source || 'Based on guideline recommendations';
        const sourceName = suggestion.sourceGuidelineName || suggestion.guidelineTitle || '';
        const sourceGuidelineId = suggestion.sourceGuidelineId || suggestion.guidelineId || '';
        const verbatimQuote = suggestion.verbatimQuote || '';
        const contextText = suggestion.evidence || '';
        const dataTypeOptions = suggestion.data_type_and_options || null;

        const escapedText = suggestionText.replace(/"/g, '&quot;');
        const uniqueId = `suggestion-wizard-${Date.now()}`;

        // Priority styling
        const priority = (suggestion.type || suggestion.priority || 'info').toLowerCase();
        let priorityColor = '#43a047';
        let priorityLabel = 'Low Priority';

        if (priority === 'critical' || priority === 'high') {
            priorityColor = '#e53935';
            priorityLabel = 'High Priority';
        } else if (priority === 'medium' || priority === 'important') {
            priorityColor = '#fb8c00';
            priorityLabel = 'Medium Priority';
        }

        // Source badge
        const mergeSource = suggestion._source || null;
        let sourceBadgeHtml = '';
        if (mergeSource) {
            const badgeColors = {
                'both': { bg: '#e8f5e9', border: '#4caf50', text: '#2e7d32', label: 'Confirmed by guideline' },
                'reasoning_only': { bg: '#fff3e0', border: '#ff9800', text: '#e65100', label: 'Clinical reasoning' },
                'guideline_only': { bg: '#e3f2fd', border: '#2196f3', text: '#1565c0', label: 'Guideline identified' }
            };
            const badge = badgeColors[mergeSource] || badgeColors['guideline_only'];
            const elementLabel = suggestion._element === 'management' ? 'Management' : 'Assessment';
            sourceBadgeHtml = `<span style="display:inline-block; font-size:0.7em; padding:2px 8px; border-radius:10px; background:${badge.bg}; border:1px solid ${badge.border}; color:${badge.text}; margin-left:8px; vertical-align:middle;">${badge.label}</span><span style="display:inline-block; font-size:0.7em; padding:2px 8px; border-radius:10px; background:var(--bg-tertiary); border:1px solid var(--border-color); color:var(--text-secondary); margin-left:4px; vertical-align:middle;">${elementLabel}</span>`;
        }

        // Source link
        const sourceLinkHtml = sourceGuidelineId
            ? `<div class="sw-source-link">Source: <a href="#" onclick="openGuidelinePdf('${sourceGuidelineId.replace(/'/g, "\\'")}', '${verbatimQuote.replace(/'/g, "\\'").substring(0, 120)}'); return false;" title="Open guideline PDF">${sourceName}</a></div>`
            : '';

        // Verbatim quote block
        const quoteHtml = verbatimQuote
            ? `<div class="sw-quote">&ldquo;${verbatimQuote}&rdquo;</div>`
            : '';

        // Structured input section
        const inputSectionHtml = dataTypeOptions
            ? `<div class="sw-input-section">
                <div class="sw-input-label">Enter the missing information:</div>
                ${renderStructuredInput(uniqueId, suggestion.missing_info || suggestionText, dataTypeOptions)}
                <div id="${uniqueId}-preview-container" class="sw-input-preview-container" style="margin-top: 12px; padding: 10px; background: #f0f9ff; border-radius: 4px; border-left: 3px solid #0ea5e9; display: none;">
                  <div style="font-size: 0.85em; color: #0c4a6e; font-weight: 500; margin-bottom: 6px;">📋 Preview of text to insert:</div>
                  <div id="${uniqueId}-preview-text" style="background: white; padding: 8px; border-radius: 3px; font-size: 0.9em; color: #1e3a8a; line-height: 1.4; border-left: 2px solid #0ea5e9; padding-left: 10px; font-family: 'Courier New', monospace;">
                    [Select a value above to see preview]
                  </div>
                </div>
              </div>`
            : '';

        const sectionLabel = dataTypeOptions ? 'Missing Information:' : 'Suggestion:';
        const acceptLabel = dataTypeOptions ? 'Add to Note &#x2713;' : 'Insert &#x2713;';
        const backDisabled = state.currentIndex === 0 ? 'disabled' : '';
        const phaseLabelText = (phaseLabel || 'AI Suggestions').toUpperCase();

        container.innerHTML = `
            <div class="sw-wrap" id="${uniqueId}">
              <div class="sw-header">
                <span class="sw-title">Suggestions</span>
                <span class="sw-count">${currentNumber} / ${total}</span>
                <button class="sw-close-btn" onclick="window._wizardClose()">&#x2715;</button>
              </div>
              <div class="sw-body">
                <div class="sw-suggestion-why">
                  <div class="sw-suggestion-text sw-text-content" data-raw="${escapedText}">${suggestionText}</div>
                  <div class="sw-why-sentence">${suggestionReasoning}${sourceLinkHtml}</div>
                </div>
                ${inputSectionHtml}
              </div>
              <div class="sw-footer" id="${uniqueId}-actions">
                <button class="sw-btn" onclick="prevWizardSuggestion()" ${backDisabled}>&#x25C4; Back</button>
                <button class="sw-btn" onclick="skipWizardSuggestion()">Skip</button>
                <button class="sw-btn sw-btn-feedback" onclick="openWizardFeedbackModal()">Feedback</button>
                <button class="sw-btn sw-btn-insert" onclick="acceptWizardSuggestion('${uniqueId}', this)">
                  <span class="wizard-accept-spinner" style="display:none; margin-right:4px;">&#x27F3;</span>
                  ${acceptLabel}
                </button>
              </div>
            </div>
        `;

        // Attach live preview listeners for structured inputs
        if (dataTypeOptions && dataTypeOptions.type) {
            setTimeout(() => {
                const mainInput = document.getElementById(`${uniqueId}-structured-input`);
                const previewContainer = document.getElementById(`${uniqueId}-preview-container`);
                const previewText = document.getElementById(`${uniqueId}-preview-text`);

                if (mainInput && previewContainer && previewText) {
                    const updatePreview = () => {
                        let inputValue = '';

                        if (dataTypeOptions.type === 'multi_select') {
                            const checkboxes = document.querySelectorAll(`.${uniqueId}-ms-checkbox:checked`);
                            const otherField = document.getElementById(`${uniqueId}-ms-other`);
                            const selected = Array.from(checkboxes).map(cb => cb.value);
                            if (otherField && otherField.value.trim()) selected.push(otherField.value.trim());
                            inputValue = selected.join(', ');
                        } else if (dataTypeOptions.type === 'compound') {
                            const fields = document.querySelectorAll(`.${uniqueId}-compound-field`);
                            const parts = Array.from(fields).map(f => {
                                const label = f.dataset.label || '';
                                return f.value ? `${label}: ${f.value}` : null;
                            }).filter(Boolean);
                            inputValue = parts.join(', ');
                        } else {
                            inputValue = mainInput.value || '';
                        }

                        // Build preview text using suggested_content template
                        if (inputValue.trim()) {
                            const suggestedContent = dataTypeOptions.suggested_content || '';
                            const previewHtml = suggestedContent ?
                                suggestedContent.replace(/\{value\}/g, inputValue) :
                                `${suggestion.missing_info || 'Missing Info'}: ${inputValue}`;
                            previewText.textContent = previewHtml;
                            previewContainer.style.display = 'block';
                        } else {
                            previewContainer.style.display = 'none';
                        }
                    };

                    // Attach listeners based on input type
                    if (dataTypeOptions.type === 'multi_select') {
                        document.querySelectorAll(`.${uniqueId}-ms-checkbox`).forEach(cb => {
                            cb.addEventListener('change', updatePreview);
                        });
                        const otherField = document.getElementById(`${uniqueId}-ms-other`);
                        if (otherField) otherField.addEventListener('input', updatePreview);
                    } else if (dataTypeOptions.type === 'compound') {
                        document.querySelectorAll(`.${uniqueId}-compound-field`).forEach(f => {
                            f.addEventListener('change', updatePreview);
                            f.addEventListener('input', updatePreview);
                        });
                    } else {
                        mainInput.addEventListener('change', updatePreview);
                        mainInput.addEventListener('input', updatePreview);
                    }
                }
            }, 50);
        }

        // Show insertion placeholder in editor (cancel any stale pending timeout first)
        if (_previewTimeout) { clearTimeout(_previewTimeout); _previewTimeout = null; }
        _previewTimeout = setTimeout(() => {
            _previewTimeout = null;
            showInsertionPreview(suggestion);
        }, 200);
    };

    // _wizardClose: clears preview, empties container, hides panel, calls onComplete
    window._wizardClose = function () {
        if (_previewTimeout) { clearTimeout(_previewTimeout); _previewTimeout = null; }
        clearInsertionPreview();
        container.innerHTML = '';
        const wizardPanel = document.getElementById('wizardPanel');
        if (wizardPanel) {
            wizardPanel.style.display = 'none';
            document.getElementById('editorWizardRow')?.classList.remove('wizard-active');
        }
        if (onComplete) onComplete();
    };

    // Backwards compat
    window.closeSuggestionWizard = () => window._wizardClose();

    window.nextWizardSuggestion = function () {
        window.suggestionWizardState.currentIndex++;
        renderCurrentSuggestion();
    };

    window.prevWizardSuggestion = function () {
        if (window.suggestionWizardState.currentIndex > 0) {
            window.suggestionWizardState.currentIndex--;
            renderCurrentSuggestion();
        }
    };

    window.skipWizardSuggestion = function () {
        window.nextWizardSuggestion();
    };

    window.rejectWizardSuggestion = function () {
        window.nextWizardSuggestion();
    };

    // Helper: Format compound field data via LLM for natural language
    async function formatCompoundFieldData(fieldLabel, parts) {
        if (!parts || parts.length === 0) return '';

        const fieldStr = parts.map(f => `${f.label}: ${f.value}`).join(', ');

        try {
            const user = window.auth?.currentUser;
            if (!user) return `${fieldLabel}: ${fieldStr}`;

            const idToken = await user.getIdToken();
            const resp = await fetch(`${window.SERVER_URL}/formatClinicalData`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
                body: JSON.stringify({ fieldLabel, fieldData: fieldStr })
            });

            if (!resp.ok) {
                console.warn('[WIZARD] Formatting endpoint failed, using raw format');
                return `${fieldLabel}: ${fieldStr}`;
            }

            const result = await resp.json();
            return result.formatted || `${fieldLabel}: ${fieldStr}`;
        } catch (err) {
            console.warn('[WIZARD] Error formatting compound field:', err);
            return `${fieldLabel}: ${fieldStr}`;
        }
    }

    window.acceptWizardSuggestion = async function (id, btn) {
        const card = document.getElementById(id);
        const textEl = card ? card.querySelector('.sw-text-content') : null;

        const structuredInputEl = document.getElementById(`${id}-structured-input`);
        let textToInsert = '';

        if (structuredInputEl) {
            const label = structuredInputEl.dataset.missingInfo || '';
            if (structuredInputEl.dataset.type === 'multi_select') {
                // Collect checked options
                const checked = Array.from(structuredInputEl.querySelectorAll(`.${id}-ms-checkbox:checked`))
                    .map(cb => cb.value)
                    .filter(v => v && v !== 'None of the above');
                const otherInput = structuredInputEl.querySelector(`#${id}-ms-other`);
                const otherVal = otherInput?.value?.trim();
                if (otherVal) checked.push(otherVal);
                // If only "None of the above" was selected or nothing, record that
                const noneChecked = structuredInputEl.querySelector(`.${id}-ms-checkbox[value="None of the above"]:checked`);
                if (checked.length === 0 && noneChecked) {
                    textToInsert = label ? `${label}: None` : 'None';
                } else if (checked.length > 0) {
                    textToInsert = label ? `${label}: ${checked.join(', ')}` : checked.join(', ');
                }
            } else if (structuredInputEl.dataset.type === 'compound') {
                const parts = Array.from(structuredInputEl.querySelectorAll(`.${id}-compound-field`))
                    .map(f => ({ label: f.dataset.label, value: f.value?.trim() }))
                    .filter(f => f.value);
                if (parts.length > 0) {
                    textToInsert = await formatCompoundFieldData(label, parts);
                }
            } else {
                const inputValue = structuredInputEl.value?.trim();
                if (inputValue) {
                    // For free_text (textarea): the user writes their own prose — insert as-is.
                    // For select/number inputs: prepend the label so the value has context in the note.
                    const isTextarea = structuredInputEl.tagName === 'TEXTAREA';
                    textToInsert = (!isTextarea && label) ? `${label}: ${inputValue}` : inputValue;
                }
            }
        }

        if (!textToInsert) {
            if (textEl && textEl.dataset.raw) {
                textToInsert = textEl.dataset.raw;
            } else if (textEl) {
                textToInsert = textEl.textContent.trim();
            }
        }

        if (!textToInsert) {
            alert('Empty suggestion text.');
            return;
        }

        if (!window.editors || !window.editors.userInput) {
            alert('Editor not found.');
            return;
        }

        // Show spinner on button
        if (btn) {
            btn.disabled = true;
            const spinner = btn.querySelector('.wizard-accept-spinner');
            if (spinner) spinner.style.display = 'inline';
        }
        if (typeof updateUser === 'function') updateUser('Applying change...', true);

        try {
            const currentContent = getUserInputContent();
            let newContent;

            // Replacement preview path: suggestion replaces existing text in the note
            const replacementPreview = getReplacementPreview();
            const contentSnapshot = getContentBeforePreview();
            if (replacementPreview && contentSnapshot) {
                const lines = contentSnapshot.split('\n');
                const idx = lines.findIndex(l => l.includes(replacementPreview.originalText));
                if (idx !== -1) {
                    lines[idx] = lines[idx].replace(replacementPreview.originalText, textToInsert);
                    newContent = lines.join('\n');
                    console.log('[WIZARD] Replaced original text with accepted suggestion');
                } else {
                    // originalText not found in snapshot — append as fallback
                    newContent = contentSnapshot + '\n' + textToInsert;
                    console.log('[WIZARD] Replacement target not found in snapshot, appended');
                }
                clearReplacementState();
            // Standard placeholder path
            } else if (currentContent.includes(INSERTION_PLACEHOLDER)) {
                const lines = currentContent.split('\n');
                const phIdx = lines.findIndex(l => l.includes(INSERTION_PLACEHOLDER));
                // Preserve any list prefix (e.g. "6. " or "- ") that was added by the preview
                lines[phIdx] = lines[phIdx].replace(INSERTION_PLACEHOLDER, textToInsert);
                newContent = lines.join('\n');
                console.log('[WIZARD] Replaced insertion placeholder with accepted text');
            } else {
                // Fallback: placeholder wasn't found (e.g. user edited note while wizard open)
                const currentSuggestion = window.suggestionWizardState?.queue[window.suggestionWizardState?.currentIndex];
                const replacePattern = currentSuggestion?.replace_pattern;
                const missingInfo = currentSuggestion?.missing_info || '';

                if (replacePattern && currentContent.includes(replacePattern)) {
                    newContent = currentContent.replace(replacePattern, textToInsert);
                    console.log('[WIZARD] Fallback: replaced replace_pattern');
                } else {
                    const lines = currentContent.split('\n');
                    const matchIdx = lines.findIndex(l => l.trim().toLowerCase() === missingInfo.trim().toLowerCase());
                    if (matchIdx !== -1) {
                        lines[matchIdx] = textToInsert;
                        newContent = lines.join('\n');
                        console.log('[WIZARD] Fallback: fuzzy-replaced missing_info line');
                    } else {
                        try {
                            const updatedNote = await determineInsertionPoint(
                                { suggestedText: textToInsert, category: 'addition', targetSection: currentSuggestion?.target_section || null },
                                currentContent
                            );
                            newContent = updatedNote || (currentContent + '\n' + textToInsert);
                        } catch {
                            newContent = currentContent + '\n' + textToInsert;
                        }
                    }
                }
            }

            setUserInputContent(newContent, true, 'Wizard Suggestion - Accepted', [{ findText: '', replacementText: textToInsert }]);

            // Briefly bold the inserted text so the user can see where it landed
            setTimeout(() => flashBoldInEditor(textToInsert), 150);

            console.log('[WIZARD] Suggestion accepted and inserted:', textToInsert.substring(0, 50) + '...');
            window.nextWizardSuggestion();
        } catch (error) {
            console.error('[WIZARD] Error accepting suggestion:', error);
            alert('Error inserting suggestion: ' + error.message);
        } finally {
            if (btn) {
                btn.disabled = false;
                const spinner = btn.querySelector('.wizard-accept-spinner');
                if (spinner) spinner.style.display = 'none';
            }
        }
    };

    // Initial render
    renderCurrentSuggestion();
}

// Open feedback modal for wizard suggestion, including practice point reference
window.openWizardFeedbackModal = function() {
    const state = window.suggestionWizardState;
    if (!state || state.currentIndex >= state.queue.length) return;

    const suggestion = state.queue[state.currentIndex];
    if (!suggestion) return;

    const modalId = `wizard-feedback-${Date.now()}`;
    // Use practicePointNumber if available; otherwise use practice_point_reference or sourceGuidelineId
    const practicePointRef = suggestion.practicePointNumber
        ? `Practice Point #${suggestion.practicePointNumber}`
        : suggestion.practice_point_reference || suggestion.sourceGuidelineId || '(not specified)';
    const sourceGuidelineTitle = suggestion.sourceGuidelineTitle || 'Unknown Guideline';
    const priorityColor = suggestion.priority === 'high' ? '#dc2626' : suggestion.priority === 'medium' ? '#f59e0b' : '#6b7280';
    const contextId = `${modalId}-context`;

    // Safely escape HTML
    const escapeHtml = (text) => {
        if (!text) return '';
        return String(text).replace(/</g, '&lt;').replace(/>/g, '&gt;');
    };

    // Prepare full context for display and storage
    const wizardState = window.suggestionWizardState ? {
        currentIndex: window.suggestionWizardState.currentIndex,
        total: window.suggestionWizardState.total,
        currentSuggestion: suggestion,
        allSuggestions: window.suggestionWizardState.queue || []
    } : null;

    const fullContext = {
        wizardState,
        aiContext: window._lastAiContext || null,
        lastInteraction: window._lastInteraction || null,
        uiState: {
            activeView: document.querySelector('[data-active-view]')?.getAttribute('data-active-view') || 'unknown',
            editorText: typeof window.getUserInputContent === 'function' ? window.getUserInputContent() : '',
            summaryText: document.getElementById('summary1')?.textContent || ''
        }
    };

    const modalHtml = `
        <div id="${modalId}" style="position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 11000; display: flex; justify-content: center; align-items: center;">
            <div style="background: white; padding: 24px; border-radius: 8px; width: 600px; max-width: 95%; max-height: 85vh; overflow-y: auto; box-shadow: 0 10px 40px rgba(0,0,0,0.3);">
                <h3 style="margin: 0 0 16px 0; color: var(--text-primary);">Feedback on Missing Information</h3>

                <div style="background: #f9fafb; border-left: 4px solid ${priorityColor}; padding: 12px; margin-bottom: 16px; border-radius: 4px;">
                    <div style="display: flex; justify-content: space-between; align-items: start; gap: 12px;">
                        <div style="flex: 1;">
                            <p style="margin: 0 0 8px 0; color: var(--text-primary); font-weight: 500;">${escapeHtml(suggestion.missing_info || suggestion.suggestion || '')}</p>
                            <p style="margin: 0; color: var(--text-secondary); font-size: 0.9em;">${escapeHtml(suggestion.importance_and_management_impact || suggestion.why || '')}</p>
                        </div>
                        <span style="background: ${priorityColor}; color: white; padding: 4px 8px; border-radius: 3px; font-size: 0.85em; white-space: nowrap; font-weight: 500;">${suggestion.priority || 'medium'}</span>
                    </div>
                </div>

                <div style="background: #f3f4f6; padding: 12px; margin-bottom: 12px; border-radius: 4px;">
                    <div style="margin-bottom: 8px;"><strong style="color: #1f2937;">Guideline:</strong> ${escapeHtml(sourceGuidelineTitle)}</div>
                    <div style="font-family: 'Courier New', monospace; font-size: 0.85em;"><strong style="color: #1f2937;">Reference:</strong> <code>${escapeHtml(practicePointRef)}</code></div>
                </div>

                <div style="background: #f0fdf4; padding: 12px; margin-bottom: 16px; border-radius: 4px; font-size: 0.9em; color: #166534;">
                    <strong>Target Section:</strong> ${escapeHtml(suggestion.target_section || 'Not specified')}
                </div>

                <p style="color: var(--text-primary); margin: 16px 0 8px 0; font-weight: 500;">Tell us why you're rejecting this suggestion:</p>
                <textarea id="${modalId}-text" placeholder="Enter your feedback (optional)" style="width: 100%; height: 100px; margin: 0 0 16px 0; padding: 8px; border: 1px solid var(--border-color); border-radius: 4px; font-family: system-ui; font-size: 0.95em; resize: vertical; box-sizing: border-box;"></textarea>

                <details style="margin-bottom: 16px; background: #f9fafb; padding: 12px; border-radius: 4px; border: 1px solid var(--border-color);">
                    <summary style="cursor: pointer; font-weight: 500; color: #1f2937; margin-bottom: 8px;">📋 View Full Context (${wizardState ? `${wizardState.currentIndex + 1} of ${wizardState.total}` : 'N/A'})</summary>
                    <div id="${contextId}" style="font-size: 0.85em; color: var(--text-secondary); max-height: 300px; overflow-y: auto; font-family: 'Courier New', monospace; white-space: pre-wrap; word-break: break-word; background: white; padding: 8px; border-radius: 3px; margin-top: 8px;">
                        ${JSON.stringify(fullContext, null, 2).substring(0, 2000)}...
                    </div>
                </details>

                <div style="display: flex; justify-content: flex-end; gap: 10px;">
                    <button id="${modalId}-skip" style="background: #9ca3af; color: white; padding: 8px 16px; border: none; border-radius: 4px; cursor: pointer; font-weight: 500;">Skip</button>
                    <button id="${modalId}-submit" style="background: #2563eb; color: white; padding: 8px 16px; border: none; border-radius: 4px; cursor: pointer; font-weight: 500;">Submit Feedback</button>
                </div>
            </div>
        </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHtml);
    const modal = document.getElementById(modalId);
    const textArea = document.getElementById(`${modalId}-text`);
    const submitBtn = document.getElementById(`${modalId}-submit`);
    const skipBtn = document.getElementById(`${modalId}-skip`);

    const closeModal = () => modal.remove();

    submitBtn.onclick = async () => {
        const feedback = textArea.value.trim();
        if (feedback) {
            await window.submitWizardSuggestionFeedback(suggestion, feedback);
        }
        closeModal();
    };

    skipBtn.onclick = closeModal;

    // Focus textarea for immediate typing
    setTimeout(() => textArea.focus(), 100);
};

// Submit feedback for a wizard suggestion, including practice point reference
window.submitWizardSuggestionFeedback = async function(suggestion, feedbackReason) {
    if (!feedbackReason || !suggestion) return;

    try {
        const user = window.auth?.currentUser;
        if (!user) {
            console.warn('[WIZARD-FEEDBACK] Not authenticated');
            return;
        }

        if (!window.db) {
            console.warn('[WIZARD-FEEDBACK] Firestore not initialized');
            return;
        }

        // Save full suggestion context to Firestore feedback collection
        const feedbackData = {
            userExplanation: feedbackReason,
            userEmail: user.email,
            // Save complete suggestion object with all context
            suggestion: {
                text: suggestion.suggestion || suggestion.missing_info,
                missing_info: suggestion.missing_info || '',
                why: suggestion.why || suggestion.importance_and_management_impact || '',
                importance_and_management_impact: suggestion.importance_and_management_impact || '',
                priority: suggestion.priority || 'medium',
                target_section: suggestion.target_section || null,
                data_type_and_options: suggestion.data_type_and_options || null,
                category: suggestion.category || null,
                verbatimQuote: suggestion.verbatimQuote || '',
                significance: suggestion.significance || '',
                sourceGuidelineId: suggestion.sourceGuidelineId || null,
                sourceGuidelineTitle: suggestion.sourceGuidelineTitle || null,
                practicePointNumber: suggestion.practicePointNumber || null
            },
            practice_point_reference: suggestion.practice_point_reference || suggestion.sourceGuidelineId || null,
            practicePointNumber: suggestion.practicePointNumber || null,
            sourceGuidelineId: suggestion.sourceGuidelineId || null,
            sourceGuidelineTitle: suggestion.sourceGuidelineTitle || null,
            phase: suggestion.phase || 'practice-points',
            lastAction: 'Send Feedback',
            submittedAt: new Date(),
            status: 'open'
        };

        // Add complete context (matches old feedback detail structure)
        if (window.suggestionWizardState) {
            feedbackData.wizardState = {
                currentIndex: window.suggestionWizardState.currentIndex,
                total: window.suggestionWizardState.total,
                currentSuggestion: suggestion,
                allSuggestions: window.suggestionWizardState.queue || []
            };
        }

        // Add AI context if available
        if (window._lastAiContext) {
            feedbackData.aiContext = window._lastAiContext;
        }

        // Add last interaction info
        if (window._lastInteraction) {
            feedbackData.lastInteraction = window._lastInteraction;
        }

        // Add full UI state for reconstruction
        feedbackData.uiState = {
            activeView: document.querySelector('[data-active-view]')?.getAttribute('data-active-view') || 'unknown',
            editorText: typeof window.getUserInputContent === 'function' ? window.getUserInputContent() : '',
            summaryText: document.getElementById('summary1')?.textContent || '',
            timestamp: new Date().toISOString()
        };

        // Add full note snapshot
        if (typeof window.getUserInputContent === 'function') {
            feedbackData.noteSnapshot = window.getUserInputContent().substring(0, 5000);
        }

        const docRef = await window.db.collection('feedback').add(feedbackData);
        console.log('[WIZARD-FEEDBACK] Feedback submitted with practice point:', suggestion.practice_point_reference, 'Doc:', docRef.id);
    } catch (error) {
        console.error('[WIZARD-FEEDBACK] Error submitting feedback:', error);
    }
}
