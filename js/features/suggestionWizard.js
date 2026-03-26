import { flashBoldInEditor, showInsertionPreview, clearInsertionPreview } from '../utils/editor.js';

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

        // Clear any previous insertion preview when moving between suggestions
        if (typeof clearInsertionPreview === 'function') clearInsertionPreview();

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
              </div>`
            : '';

        const sectionLabel = dataTypeOptions ? 'Missing Information:' : 'Suggestion:';
        const acceptLabel = dataTypeOptions ? 'Add to Note &#x2713;' : 'Insert &#x2713;';
        const backDisabled = state.currentIndex === 0 ? 'disabled' : '';
        const phaseLabelText = (phaseLabel || 'AI Suggestions').toUpperCase();

        container.innerHTML = `
            <div class="sw-wrap">
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
                <button class="sw-btn sw-btn-insert" onclick="acceptWizardSuggestion('${uniqueId}', this)">
                  <span class="wizard-accept-spinner" style="display:none; margin-right:4px;">&#x27F3;</span>
                  ${acceptLabel}
                </button>
              </div>
            </div>
        `;

        // Show insertion preview in editor
        if (typeof showInsertionPreview === 'function') {
            setTimeout(() => {
                const anchor = contextText || suggestion.target_section || '';
                showInsertionPreview(suggestionText, anchor, 'after');
            }, 200);
        }
    };

    // _wizardClose: clears preview, empties container, hides panel, calls onComplete
    window._wizardClose = function () {
        if (typeof clearInsertionPreview === 'function') clearInsertionPreview();
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
                    const joined = parts.map(f => `${f.label}: ${f.value}`).join(', ');
                    textToInsert = label ? `${label}: ${joined}` : joined;
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
            // Clear inline preview before modifying content
            if (typeof clearInsertionPreview === 'function') clearInsertionPreview();

            const currentContent = getUserInputContent();

            const currentSuggestion = window.suggestionWizardState?.queue[window.suggestionWizardState?.currentIndex];

            // Try replace_pattern (explicit from AI) or fuzzy-match missing_info as a standalone line
            const replacePattern = currentSuggestion?.replace_pattern;
            const missingInfo = currentSuggestion?.missing_info || '';
            let newContent;

            if (replacePattern && currentContent.includes(replacePattern)) {
                // AI identified an exact placeholder line — replace it in-place
                newContent = currentContent.replace(replacePattern, textToInsert);
                console.log('[WIZARD] Replaced placeholder line in-place:', replacePattern);
            } else {
                // Fuzzy fallback: check if missing_info appears as a standalone line (case-insensitive)
                const lines = currentContent.split('\n');
                const matchIdx = lines.findIndex(line => line.trim().toLowerCase() === missingInfo.trim().toLowerCase());
                if (matchIdx !== -1) {
                    lines[matchIdx] = textToInsert;
                    newContent = lines.join('\n');
                    console.log('[WIZARD] Fuzzy-replaced standalone line matching missing_info:', missingInfo);
                } else {
                    // Normal AI-guided insertion
                    const suggestionForInsertion = {
                        suggestedText: textToInsert,
                        category: 'addition',
                        targetSection: currentSuggestion?.target_section || null
                    };
                    try {
                        const updatedNote = await determineInsertionPoint(suggestionForInsertion, currentContent);
                        if (updatedNote) {
                            newContent = updatedNote;
                            console.log('[WIZARD] AI inserted suggestion directly into note');
                        } else {
                            throw new Error('No updated note returned');
                        }
                    } catch (insertError) {
                        console.warn('[WIZARD] AI insertion failed, falling back to append:', insertError);
                        const spacing = currentContent.endsWith('\n') ? '' : '\n';
                        newContent = currentContent + spacing + textToInsert;
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
