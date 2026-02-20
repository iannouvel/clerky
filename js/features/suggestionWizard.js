import { scrollTextIntoView } from '../utils/editor.js';

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

    // Define Renderer
    const renderCurrentSuggestion = () => {
        const state = window.suggestionWizardState;

        if (!container) return;

        // Check for completion
        if (state.currentIndex >= state.total) {
            if (onComplete) {
                container.innerHTML = `
                    <div class="suggestions-complete" style="text-align: center; padding: 30px;">
                        <h3 style="color: var(--text-primary);">Missing Information Review Complete</h3>
                        <p style="color: var(--text-secondary);">Loading management recommendations...</p>
                    </div>
                `;
                setTimeout(() => onComplete(), 800);
            } else {
                container.innerHTML = `
                    <div class="suggestions-complete" style="text-align: center; padding: 30px;">
                        <span style="font-size: 3em; display: block; margin-bottom: 20px;">🎉</span>
                        <h3 style="color: var(--text-primary);">Review Complete</h3>
                        <p style="color: var(--text-secondary);">You have reviewed all ${state.total} suggestions.</p>
                        <button class="btn btn-primary" onclick="window.closeSuggestionWizard('${container.id}')" style="margin-top: 20px;">Close Review</button>
                    </div>
                `;
            }
            return;
        }

        const suggestion = state.queue[state.currentIndex];
        const currentNumber = state.currentIndex + 1;
        const total = state.total;

        // Safely access properties
        const suggestionText = suggestion.suggestion || suggestion.recommendation || suggestion.name || suggestion.issue || suggestion.text || suggestion.title || suggestion.description || suggestion.content || suggestion.advice || 'No text available';
        const suggestionReasoning = suggestion.why || suggestion.notCoveredBy || suggestion.reasoning || suggestion.rationale || suggestion.source || 'Based on guideline recommendations';
        const sourceName = suggestion.sourceGuidelineName || 'Unknown Guideline';
        const contextText = suggestion.evidence || ''; // For focusing

        // Formatting
        const escapedText = suggestionText.replace(/"/g, '&quot;');
        const uniqueId = `suggestion-wizard-${Date.now()}`;

        // Priority Styling
        const priority = (suggestion.type || suggestion.priority || 'info').toLowerCase();
        let priorityColor = 'var(--text-secondary)';
        let priorityLabel = 'Suggestion';

        if (priority === 'critical' || priority === 'high') {
            priorityColor = '#d32f2f'; // Softer Red (Material Design Red 700)
            priorityLabel = 'High Priority Suggestion';
        } else if (priority === 'medium' || priority === 'important') {
            priorityColor = '#f57c00'; // Darker Orange (Material Design Orange 700)
            priorityLabel = 'Medium Priority Suggestion';
        } else {
            priorityColor = '#388e3c'; // Darker Green (Material Design Green 700)
            priorityLabel = 'Low Priority Suggestion';
        }

        const labelColor = 'var(--text-primary)';

        // Calculate Counts for Header
        let highCount = 0, medCount = 0, lowCount = 0;
        state.queue.forEach(s => {
            const p = (s.type || s.priority || 'info').toLowerCase();
            if (p === 'critical' || p === 'high') highCount++;
            else if (p === 'medium' || p === 'important') medCount++;
            else lowCount++;
        });

        // Build Header HTML
        let summaryParts = [];
        if (highCount > 0) summaryParts.push(`${highCount} high`);
        if (medCount > 0) summaryParts.push(`${medCount} medium`);
        if (lowCount > 0) summaryParts.push(`${lowCount} low`);

        const summaryString = `${phaseLabel || 'Clinical Suggestions'}: ${summaryParts.join(', ')} priority`;

        // Build Upcoming List HTML (Text Only)
        let upcomingHtml = '';
        const upcomingSuggestions = state.queue.slice(state.currentIndex + 1);
        if (upcomingSuggestions.length > 0) {
            upcomingHtml += `<div class="upcoming-suggestions" style="margin-top: 20px; border-top: 1px dashed var(--border-color); padding-top: 15px;">`;

            // Group by simple priority for display
            const upcomingHigh = upcomingSuggestions.filter(s => ['critical', 'high'].includes((s.type || s.priority || '').toLowerCase()));
            const upcomingMed = upcomingSuggestions.filter(s => ['medium', 'important'].includes((s.type || s.priority || '').toLowerCase()));
            const upcomingLow = upcomingSuggestions.filter(s => !['critical', 'high', 'medium', 'important'].includes((s.type || s.priority || '').toLowerCase()));

            const renderGroup = (title, items, color) => {
                if (items.length === 0) return '';

                // Show only first 3 items
                const displayItems = items.slice(0, 3);
                const hasMore = items.length > 3;

                let html = `<div style="margin-bottom: 15px;">
                    <div style="font-size: 0.8em; font-weight: 600; color: white; text-transform: uppercase; margin-bottom: 5px;">${items.length} ${title}</div>`;
                displayItems.forEach(item => {
                    const text = item.suggestion || item.recommendation || item.name || item.issue || item.text || item.action || item.what || item.title || item.description || item.content || item.advice || '';
                    if (text) {
                        html += `<div style="font-size: 0.9em; color: var(--text-secondary); margin-bottom: 4px; padding-left: 10px; border-left: 2px solid ${color}; opacity: 0.7;">${text}</div>`;
                    }
                });
                if (hasMore) {
                    html += `<div style="font-size: 0.85em; color: var(--text-tertiary); margin-top: 6px; padding-left: 10px; font-style: italic;">...and ${items.length - 3} more</div>`;
                }
                html += `</div>`;
                return html;
            };

            upcomingHtml += renderGroup('Upcoming High Priority Suggestions', upcomingHigh, '#d32f2f');
            upcomingHtml += renderGroup('Upcoming Medium Priority Suggestions', upcomingMed, '#f57c00');
            upcomingHtml += renderGroup('Upcoming Low Priority Suggestions', upcomingLow, '#388e3c');

            upcomingHtml += `</div>`;
        }

        container.innerHTML = `
            <div class="suggestion-wizard-container" style="width: 100%; margin: 0 auto;">
                
                <!-- Global Summary Header -->
                <div class="wizard-summary-header" style="text-align: left; margin-bottom: 15px; font-weight: 500; color: var(--text-primary); font-size: 1.1em;">
                    ${summaryString}
                </div>

                <!-- Two-Column Layout -->
                <div class="wizard-columns" style="display: flex; gap: 20px; align-items: flex-start;">
                    
                    <!-- Left Column: Active Suggestion -->
                    <div class="wizard-left-column" style="flex: 1; min-width: 0;">
                        <div class="suggestion-wizard-card" id="${uniqueId}" style="background: var(--bg-secondary); border: 1px solid var(--border-color); border-radius: 8px; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.1);">
                            
                            <!-- Header with Progress -->
                            <div class="wizard-header" style="background: rgba(0,0,0,0.03); padding: 10px 15px; border-bottom: 1px solid var(--border-color); display: flex; justify-content: space-between; align-items: center;">
                                <span style="font-size: 0.85em; font-weight: 600; color: ${labelColor}; text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 2px solid ${priorityColor}; padding-bottom: 2px;">
                                    ${priorityLabel}
                                </span>
                                <span style="font-size: 0.85em; color: var(--text-secondary);">
                                    ${currentNumber} of ${total}
                                </span>
                            </div>

                            <!-- Main Content -->
                            <div class="wizard-body" style="padding: 20px;">
                                
                                <!-- Suggestion Box (The Change) -->
                                <div style="margin-bottom: 20px;">
                                    <div class="text-content" data-raw-suggestion="${escapedText}" style="font-size: 1.1em; font-weight: 500; color: var(--text-primary); line-height: 1.4;">
                                        <span style="font-size: 0.7em; text-transform: uppercase; color: var(--text-secondary); font-weight: 600;">Suggested Action:</span> ${suggestionText}
                                    </div>
                                </div>

                                <!-- Reasoning Box -->
                                <div style="margin-bottom: 20px; background: rgba(0,0,0,0.02); padding: 12px; border-radius: 6px; border-left: 3px solid var(--accent-color);">
                                    <div style="font-size: 0.95em; color: var(--text-secondary);">
                                        <span style="font-size: 0.8em; text-transform: uppercase; font-weight: 600;">Why:</span> ${suggestionReasoning}
                                    </div>
                                    <div style="margin-top: 8px; font-size: 0.8em; color: var(--text-tertiary); text-align: left;">
                                        Source: ${sourceName}
                                    </div>
                                </div>

                                <!-- Editor for Modify Mode (Hidden by default) -->
                                <div id="${uniqueId}-edit-mode" style="display: none; margin-bottom: 15px;">
                                    <label style="display: block; font-size: 0.75em; text-transform: uppercase; color: var(--text-secondary); margin-bottom: 5px;">Edit Suggestion</label>
                                    <textarea id="${uniqueId}-editor" class="form-control" style="width: 100%; min-height: 80px; padding: 10px; border-radius: 6px; border: 1px solid var(--border-color); background: var(--bg-input); color: var(--text-primary); font-family: inherit;">${suggestionText}</textarea>
                                    <div style="display: flex; gap: 10px; margin-top: 10px;">
                                        <button class="btn-sm btn-success" onclick="saveWizardModification('${uniqueId}')">Save & Update</button>
                                        <button class="btn-sm btn-secondary" onclick="cancelWizardModification('${uniqueId}')">Cancel</button>
                                    </div>
                                </div>

                            </div>

                            <!-- Action Bar -->
                            <div id="${uniqueId}-actions" class="wizard-actions" style="padding: 15px; border-top: 1px solid var(--border-color); display: flex; gap: 10px; flex-wrap: wrap; justify-content: flex-start; background: var(--bg-secondary);">
                                    <!-- Navigation only -->
                                <button class="wizard-suggestion-btn" onclick="prevWizardSuggestion()" ${state.currentIndex === 0 ? 'disabled' : ''}>
                                    ⬅ Back
                                </button>

                                <button class="wizard-suggestion-btn" onclick="enableWizardModify('${uniqueId}')">
                                        ✏️ Modify
                                </button>
                                <button class="wizard-suggestion-btn" onclick="skipWizardSuggestion()">
                                        Skip ⏭
                                </button>
                                <button class="wizard-suggestion-btn" onclick="rejectWizardSuggestion('${uniqueId}')">
                                        Reject ❌
                                </button>
                                <button class="wizard-suggestion-btn" onclick="acceptWizardSuggestion('${uniqueId}')">
                                        Accept & Next ✅
                                </button>
                            </div>

                        </div>
                    </div>

                    <!-- Right Column: Upcoming Suggestions -->
                    <div class="wizard-right-column" style="flex: 1; min-width: 0;">
                        ${upcomingHtml || '<div style="color: var(--text-secondary); font-style: italic;">No more upcoming suggestions.</div>'}
                    </div>
                    
                </div>
            </div>
        `;

        // Auto-focus logic
        if (contextText && typeof scrollTextIntoView === 'function') {
            setTimeout(() => {
                scrollTextIntoView(contextText);
            }, 100);
        }
    };

    // Attach Global Handlers
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

    window.acceptWizardSuggestion = async function (id) {
        const card = document.getElementById(id);
        const textEl = card.querySelector('.text-content');

        const editorEl = document.getElementById(`${id}-editor`);
        let textToInsert = '';

        if (editorEl && editorEl.value && editorEl.value.trim()) {
            textToInsert = editorEl.value.trim();
        } else if (textEl && textEl.dataset.rawSuggestion) {
            textToInsert = textEl.dataset.rawSuggestion;
        } else if (textEl) {
            textToInsert = textEl.textContent.replace(/^\s*Suggested Action:\s*/i, '').trim();
        }

        if (!textToInsert) {
            alert('Empty suggestion text.');
            return;
        }

        if (!window.editors || !window.editors.userInput) {
            alert('Editor not found.');
            return;
        }

        try {
            const currentContent = getUserInputContent();

            const suggestionForInsertion = {
                suggestedText: textToInsert,
                category: 'addition'
            };

            let newContent;
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

            setUserInputContent(newContent, true, 'Wizard Suggestion - Accepted', [{ findText: '', replacementText: textToInsert }]);

            console.log('[WIZARD] Suggestion accepted and inserted:', textToInsert.substring(0, 50) + '...');
            window.nextWizardSuggestion();
        } catch (error) {
            console.error('[WIZARD] Error accepting suggestion:', error);
            alert('Error inserting suggestion: ' + error.message);
        }
    };

    window.rejectWizardSuggestion = function (id) {
        window.nextWizardSuggestion();
    };

    window.skipWizardSuggestion = function () {
        window.nextWizardSuggestion();
    };

    window.enableWizardModify = function (id) {
        const editMode = document.getElementById(`${id}-edit-mode`);
        const actions = document.getElementById(`${id}-actions`);

        if (editMode && actions) {
            editMode.style.display = 'block';
            actions.style.display = 'none';
        }
    };

    window.saveWizardModification = function (id) {
        const editor = document.getElementById(`${id}-editor`);
        const display = document.querySelector(`#${id} .text-content`);
        const editMode = document.getElementById(`${id}-edit-mode`);
        const actions = document.getElementById(`${id}-actions`);

        if (editor && display) {
            const modifiedText = editor.value.trim();
            display.textContent = modifiedText;
            display.dataset.rawSuggestion = modifiedText;

            editMode.style.display = 'none';
            actions.style.display = 'flex';
        }
    };

    window.cancelWizardModification = function (id) {
        const editMode = document.getElementById(`${id}-edit-mode`);
        const actions = document.getElementById(`${id}-actions`);

        if (editMode && actions) {
            editMode.style.display = 'none';
            actions.style.display = 'flex';
        }
    };

    window.closeSuggestionWizard = function (containerId) {
        // Find the container, or use the one we have
        const c = document.getElementById(containerId) || container;
        if (c) {
            c.innerHTML = '';
        }
    }

    // Initial render
    renderCurrentSuggestion();
}
