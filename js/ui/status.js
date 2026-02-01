/**
 * UI Status and Button Management
 * Handles status messages and button visibility/state
 */

/**
 * Helper function to log all changes to serverStatusMessage
 * @param {string} action - Description of the action being taken
 * @param {string} message - The message being set (or empty for clear)
 * @param {boolean} isLoading - Whether loading state is active
 */
function logStatusChange(action, message, isLoading = false) {
    const timestamp = new Date().toISOString().substr(11, 12);
    const callerStack = new Error().stack.split('\n')[3]?.trim() || 'unknown';

    console.log(`[STATUS ${timestamp}] ${action}`, {
        message: message || '(clearing)',
        isLoading,
        hasOngoingWorkflows: !!(window.workflowInProgress || window.isAnalysisRunning || window.sequentialProcessingActive || window.parallelAnalysisActive),
        caller: callerStack
    });
}

/**
 * Display a status message to the user in the fixed button row
 * @param {string} message - Message to display, or empty string/null to clear
 * @param {boolean} isLoading - Whether to show a loading spinner
 * @param {boolean} forceClear - If true, clears message even during ongoing workflows (default: false)
 */
export function updateUser(message, isLoading = false, forceClear = false) {
    const statusEl = document.getElementById('serverStatusMessage');

    if (!statusEl) {
        console.warn('[STATUS] serverStatusMessage element not found');
        return;
    }

    // Avoid duplicate "Finding relevant guidelines..." indicators in the fixed button row:
    // the Analyse button already shows this progress state with a spinner/text.
    if (message && isLoading && /finding\s+relevant\s+guidelines/i.test(message)) {
        const analyseSpinner = document.getElementById('analyseSpinner');
        const analyseSpinnerVisible = !!(
            analyseSpinner &&
            window.getComputedStyle(analyseSpinner).display !== 'none'
        );

        if (analyseSpinnerVisible) {
            // Ensure we don't leave stale status text visible.
            logStatusChange('HIDING (duplicate with analyze button)', message, isLoading);
            statusEl.style.display = 'none';
            statusEl.textContent = '';
            return;
        }
    }

    if (message) {
        // When loading, show spinner + message; otherwise just text
        if (isLoading) {
            logStatusChange('SHOWING (loading)', message, isLoading);
            statusEl.innerHTML = `<span class="spinner-small"></span><span style="margin-left: 6px;">${message}</span>`;
        } else {
            logStatusChange('SHOWING (static)', message, isLoading);
            statusEl.textContent = message;
        }

        statusEl.style.display = 'flex';

        // Auto-hide non-loading messages after a short delay
        if (!isLoading) {
            const currentMessage = statusEl.textContent;
            setTimeout(() => {
                // Only hide if nothing has changed since we scheduled the hide
                // AND there are no ongoing workflows
                const hasOngoingWorkflows = !!(window.workflowInProgress || window.isAnalysisRunning || window.sequentialProcessingActive);

                if (statusEl.textContent === currentMessage) {
                    if (hasOngoingWorkflows) {
                        logStatusChange('AUTO-HIDE BLOCKED (ongoing workflow detected)', currentMessage, false);
                        console.log('[STATUS] Preserving message during workflow. Will remain visible.');
                    } else {
                        logStatusChange('AUTO-HIDING (5s timeout)', currentMessage, false);
                        statusEl.style.display = 'none';
                        statusEl.textContent = '';
                    }
                }
            }, 5000);
        }
    } else {
        // Check if there are ongoing operations - if so, preserve message unless forceClear is true
        const hasOngoingWorkflows = !!(window.workflowInProgress || window.isAnalysisRunning || window.sequentialProcessingActive);

        if (hasOngoingWorkflows && !forceClear) {
            const currentMessage = statusEl.textContent;
            logStatusChange('PRESERVING (ongoing workflow, use forceClear to override)', currentMessage, false);
            console.log('[STATUS] Message preserved during ongoing workflow. Current message:', currentMessage);
            // Don't clear - preserve the current message
            return;
        }

        if (hasOngoingWorkflows && forceClear) {
            logStatusChange('CLEARING (forceClear=true despite ongoing workflow)', '', false);
        } else {
            logStatusChange('CLEARING', '', false);
        }

        // Explicit clear
        statusEl.style.display = 'none';
        statusEl.textContent = '';
    }
}

/**
 * Central helper to manage Analyse/Reset button visibility and state
 * @param {boolean} hasContent - Whether the input field has content
 */
export function updateAnalyseAndResetButtons(hasContent) {
    const analyseBtn = document.getElementById('analyseBtn');
    const resetBtn = document.getElementById('resetBtn');

    // Analyse button only appears when there is content
    if (analyseBtn) {
        analyseBtn.style.display = hasContent ? 'flex' : 'none';
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
