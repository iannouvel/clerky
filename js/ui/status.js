/**
 * UI Status and Button Management
 * Handles status messages and button visibility/state
 */

/**
 * Helper function to log all changes to status channels
 */
function logStatusChange(action, message, isLoading = false, channel = 'main') {
    const timestamp = new Date().toISOString().substr(11, 12);
    const callerStack = new Error().stack.split('\n')[3]?.trim() || 'unknown';
    console.log(`[STATUS ${timestamp}] [${channel}] ${action}`, {
        message: message || '(clearing)',
        isLoading,
        hasOngoingWorkflows: !!(window.workflowInProgress || window.isAnalysisRunning || window.sequentialProcessingActive || window.parallelAnalysisActive),
        caller: callerStack
    });
}

/**
 * Show/hide the parent #serverStatusMessage container based on whether either channel has content.
 */
function syncContainerVisibility(containerEl) {
    const anyVisible = Array.from(containerEl.children).some(
        c => c.style.display !== 'none' && c.innerHTML.trim()
    );
    containerEl.style.display = anyVisible ? 'flex' : 'none';
}

/**
 * Display a status message to the user in the fixed button row.
 *
 * @param {string} message - Message to display, or empty/null to clear
 * @param {boolean} isLoading - Whether to show a loading spinner
 * @param {boolean} forceClear - Clear even during ongoing workflows (default: false)
 * @param {string} channel - 'main' (default) or 'background' — selects which status row to update
 */
export function updateUser(message, isLoading = false, forceClear = false, channel = 'main') {
    const containerEl = document.getElementById('serverStatusMessage');
    if (!containerEl) {
        console.warn('[STATUS] serverStatusMessage element not found');
        return;
    }

    // Resolve channel element; fall back to container if no channel divs present (backwards-compat)
    const channelEl = document.getElementById(`statusChannel-${channel}`) || containerEl;

    if (message) {
        if (isLoading) {
            logStatusChange('SHOWING (loading)', message, isLoading, channel);
            channelEl.innerHTML = `<span class="spinner-small"></span><span style="margin-left: 6px;">${message}</span>`;
        } else {
            logStatusChange('SHOWING (static)', message, isLoading, channel);
            channelEl.textContent = message;
        }
        channelEl.style.display = 'flex';
        syncContainerVisibility(containerEl);

        // Auto-hide non-loading messages after 5 s
        if (!isLoading) {
            const snapshot = channelEl.innerHTML;
            setTimeout(() => {
                if (channelEl.innerHTML !== snapshot) return; // message changed — leave it
                const hasOngoingWorkflows = !!(window.workflowInProgress || window.isAnalysisRunning || window.sequentialProcessingActive);
                // Background channel always auto-hides; main channel waits for workflows to finish
                if (channel === 'background' || !hasOngoingWorkflows) {
                    logStatusChange('AUTO-HIDING (5s timeout)', snapshot, false, channel);
                    channelEl.style.display = 'none';
                    channelEl.innerHTML = '';
                    syncContainerVisibility(containerEl);
                } else {
                    logStatusChange('AUTO-HIDE BLOCKED (ongoing workflow)', snapshot, false, channel);
                }
            }, 5000);
        }
    } else {
        // Clear this channel
        const hasOngoingWorkflows = !!(window.workflowInProgress || window.isAnalysisRunning || window.sequentialProcessingActive);
        if (channel === 'main' && hasOngoingWorkflows && !forceClear) {
            logStatusChange('PRESERVING (ongoing workflow)', channelEl.textContent, false, channel);
            return;
        }
        logStatusChange('CLEARING', '', false, channel);
        channelEl.style.display = 'none';
        channelEl.innerHTML = '';
        syncContainerVisibility(containerEl);
    }
}

/**
 * Central helper to manage Analyse/Reset button visibility and state
 * @param {boolean} hasContent - Whether the input field has content
 */
export function updateAnalyseAndResetButtons(hasContent) {
    // Support split buttons (new) and legacy analyseBtn
    const analyseBtn = document.getElementById('analyseBtn');
    const checkCompletenessBtn = document.getElementById('checkCompletenessBtn');
    const checkGuidelinesBtn2 = document.getElementById('checkGuidelinesBtn2');
    const resetBtn = document.getElementById('resetBtn');

    // Legacy single button
    if (analyseBtn) {
        analyseBtn.style.display = hasContent ? 'flex' : 'none';
    }

    // Split buttons — show when there is content and no analysis is running
    const isRunning = !!(window.workflowInProgress || window.isAnalysisRunning);
    if (checkCompletenessBtn) {
        checkCompletenessBtn.style.display = (hasContent && !isRunning) ? 'flex' : 'none';
    }
    if (checkGuidelinesBtn2) {
        checkGuidelinesBtn2.style.display = (hasContent && !isRunning) ? 'flex' : 'none';
    }

    // Reset button should remain visible at all times in the fixed bar
    if (resetBtn) {
        resetBtn.style.display = 'flex';
        // Disable Reset when there is nothing meaningful to clear
        const hasWorkflows = !!(window.workflowInProgress || window.isAnalysisRunning || window.sequentialProcessingActive);
        resetBtn.disabled = !hasContent && !hasWorkflows;
    }
}

/**
 * Show selection buttons in the fixed button row
 * @param {Function} updateProcessButtonTextFn - Function to update process button text
 */
export function showSelectionButtons(updateProcessButtonTextFn) {
    const buttonContainer = document.getElementById('fixedButtonRow');
    if (!buttonContainer) {
        console.warn('[DEBUG] Fixed button row not found');
        return;
    }

    // Remove existing buttons if any (cleanup first)
    const existingGroup = document.getElementById('selectionButtonsGroup');
    if (existingGroup) {
        console.log('[DEBUG] Removing existing selection buttons before adding new ones');
        existingGroup.remove();
    }

    // Create the buttons group
    const buttonsGroup = document.createElement('div');
    buttonsGroup.id = 'selectionButtonsGroup';
    buttonsGroup.className = 'selection-buttons-group';
    buttonsGroup.style.display = 'flex'; // Force display
    buttonsGroup.style.visibility = 'visible'; // Force visibility
    buttonsGroup.innerHTML = `
        <button type="button" class="action-btn primary process-selected-btn" onclick="processSelectedGuidelines(event)" title="Process selected guidelines">
            <span class="btn-icon">🚀</span>
            <span class="btn-text">Process Selected Guidelines</span>
        </button>
        <button type="button" class="selection-btn select-all-btn" onclick="selectAllGuidelines(true)" title="Select all guidelines">
            ✅ Select All
        </button>
        <button type="button" class="selection-btn deselect-all-btn" onclick="selectAllGuidelines(false)" title="Deselect all guidelines">
            ❌ Deselect All
        </button>
    `;

    // Insert after Analyse button (before clerking buttons)
    const analyseBtn = document.getElementById('analyseBtn');
    if (analyseBtn && analyseBtn.nextSibling) {
        buttonContainer.insertBefore(buttonsGroup, analyseBtn.nextSibling);
    } else {
        buttonContainer.appendChild(buttonsGroup);
    }

    // Update button text based on initial selection count
    if (updateProcessButtonTextFn) {
        updateProcessButtonTextFn();
    }

    // Use event delegation on document to handle checkbox changes (works for dynamically created checkboxes)
    // Remove any existing listener first to avoid duplicates
    if (window.guidelineCheckboxChangeHandler) {
        document.removeEventListener('change', window.guidelineCheckboxChangeHandler);
    }

    // Create and store the handler function
    window.guidelineCheckboxChangeHandler = function (event) {
        if (event.target && event.target.classList.contains('guideline-checkbox')) {
            if (updateProcessButtonTextFn) {
                updateProcessButtonTextFn();
            }
        }
    };

    // Add event listener using delegation
    document.addEventListener('change', window.guidelineCheckboxChangeHandler);

    console.log('[DEBUG] Selection buttons added to fixed button row', buttonsGroup);
}

/**
 * Hide selection buttons from the button container
 */
export function hideSelectionButtons() {
    const buttonsGroup = document.getElementById('selectionButtonsGroup') || document.querySelector('.selection-buttons-group');
    if (buttonsGroup) {
        buttonsGroup.remove();
        console.log('[DEBUG] Selection buttons removed from button container');
    }
}

/**
 * Update the clear formatting button visibility
 */
export function updateClearFormattingButton() {
    const btn = document.getElementById('clearFormattingBtn');
    if (btn) {
        btn.style.display = window.hasColoredChanges ? 'inline-block' : 'none';
        console.log('[DEBUG] Clear formatting button visibility:', btn.style.display);
    }
}

/**
 * Set a button to loading state
 * @param {HTMLElement} button - The button element
 * @param {boolean} isLoading - Whether to show loading state
 * @param {string} originalText - The original button text to restore
 */
export function setButtonLoading(button, isLoading, originalText = null) {
    if (!button) return;

    if (isLoading) {
        button.dataset.originalText = button.textContent;
        button.disabled = true;
        button.innerHTML = '<span class="spinner-small"></span> Loading...';
    } else {
        button.disabled = false;
        button.textContent = originalText || button.dataset.originalText || 'Submit';
    }
}
