/**
 * Clinical Interaction Feature
 * UI and logic for generating simulated clinical interactions/clerkings
 */

import { ClinicalConditionsService } from './clinicalData.js';
import { updateUser } from '../ui/status.js';
import { appendToSummary1 } from '../ui/streaming.js';
import { setUserInputContent, updateChatbotButtonVisibility, getUserInputContent } from '../utils/editor.js';

// Track currently loaded condition for updating
let currentLoadedCondition = null;
let editorChangeListener = null;

// Show clinical issues dropdown as a block within summary1
export async function showClinicalIssuesDropdown() {
    console.log('[DEBUG] showClinicalIssuesDropdown called');

    try {
        // Load clinical conditions from Firebase (with fallback to JSON)
        await ClinicalConditionsService.loadConditions();
        const clinicalConditions = ClinicalConditionsService.getConditions();

        if (!clinicalConditions) {
            throw new Error('Failed to load clinical conditions');
        }

        console.log('[DEBUG] Loaded clinical conditions:', ClinicalConditionsService.getSummary());

        const summarySection = document.getElementById('summarySection');
        if (summarySection) {
            summarySection.classList.remove('hidden');
        }

        // Always render a single Test panel instance
        const panelHtml = `
<div id="clinicalIssuesPanel" class="clinical-issues-selector">
    <h3>⚡ Load Clinical Clerking</h3>
    <p>Select a clinical issue to instantly load a realistic pre-generated clinical clerking using SBAR format:</p>
    
    <div class="issue-category">
        <h4>Clinical Issues</h4>
        <select id="clinical-issues-dropdown" class="clinical-dropdown">
            <option value="">Select a clinical issue...</option>
        </select>
    </div>
    
    <div id="generation-status" class="generation-status" style="display: none;"></div>
</div>`;

        // Replace existing summary content so the Test panel is always visible
        // using clearExisting=true, isUserInteraction=false
        appendToSummary1(panelHtml, true, false);

        // Ensure the clinical issues panel exists inside summary1
        const clinicalPanel = document.getElementById('clinicalIssuesPanel');
        const clinicalDropdown = document.getElementById('clinical-issues-dropdown');

        // Button references (assumed to be in the DOM from index.html or layout)
        const generateBtn = document.getElementById('generate-interaction-btn');
        const randomBtn = document.getElementById('random-issue-btn');
        const regenerateBtn = document.getElementById('regenerate-clerking-btn');
        const updateBtn = document.getElementById('update-clerking-btn');
        const cancelBtn = document.getElementById('cancel-generation-btn');

        if (!clinicalPanel || !clinicalDropdown) {
            console.error('[DEBUG] Clinical issues panel elements not found after injection');
            updateUser('Error: Unable to initialise clinical issues panel.', false);
            return;
        }

        // Show the buttons in the button container
        const clerkingButtonsGroup = document.getElementById('clerkingButtonsGroup');
        if (clerkingButtonsGroup) {
            clerkingButtonsGroup.style.display = 'flex';
        }

        // Reset dropdown options
        clinicalDropdown.innerHTML = '<option value="">Select a clinical issue...</option>';

        // Add options from Firebase data
        const excludedTestCategories = new Set(['gynaecology', 'gynecology']);
        Object.entries(clinicalConditions).forEach(([category, conditions]) => {
            const categoryKey = String(category || '').toLowerCase();
            if (excludedTestCategories.has(categoryKey)) {
                return;
            }

            const categoryLabel = String(category || '').charAt(0).toUpperCase() + String(category || '').slice(1);
            const optgroup = document.createElement('optgroup');
            optgroup.label = categoryLabel;

            Object.entries(conditions).forEach(([conditionName, conditionData]) => {
                const option = document.createElement('option');
                const hasTranscript = conditionData.hasTranscript ? ' ✓' : '';
                option.value = conditionName;
                option.dataset.conditionId = conditionData.id;
                option.textContent = `${conditionName}${hasTranscript}`;
                optgroup.appendChild(option);
            });

            clinicalDropdown.appendChild(optgroup);
        });

        // Ensure summary visibility
        if (window.updateSummaryVisibility) window.updateSummaryVisibility();
        if (window.updateSummaryCriticalStatus) window.updateSummaryCriticalStatus();

        requestAnimationFrame(() => {
            if (summarySection && typeof summarySection.scrollIntoView === 'function') {
                summarySection.scrollIntoView({ behavior: 'smooth', block: 'end' });
            }
            if (clinicalPanel && typeof clinicalPanel.scrollIntoView === 'function') {
                clinicalPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }
            if (clinicalDropdown && typeof clinicalDropdown.focus === 'function') {
                clinicalDropdown.focus();
            }
        });

        function updateGenerateButton() {
            const selectedValue = clinicalDropdown?.value || '';
            const hasSelection = selectedValue.trim() !== '';

            if (generateBtn) generateBtn.disabled = !hasSelection;
            if (regenerateBtn) regenerateBtn.disabled = !hasSelection;
        }

        if (clinicalDropdown) {
            clinicalDropdown.addEventListener('change', updateGenerateButton);
        }

        // Button Event Handlers
        if (generateBtn) {
            generateBtn.onclick = async () => {
                const selectedIssue = clinicalDropdown?.value || '';
                if (selectedIssue) {
                    await generateFakeClinicalInteraction(selectedIssue);
                    hideClinicalIssuesPanel();
                }
            };
        }

        if (randomBtn) {
            randomBtn.onclick = async () => {
                if (!clinicalDropdown) return;
                const options = Array.from(clinicalDropdown.options).filter(option =>
                    option.value && option.value.trim() !== ''
                );

                if (options.length > 0) {
                    // Prioritize issues without saved transcripts (no checkmark)
                    const optionsWithoutTranscript = options.filter(option =>
                        !option.textContent.includes(' ✓')
                    );

                    // Pick from options without saved transcripts first, otherwise from all
                    const poolToChooseFrom = optionsWithoutTranscript.length > 0
                        ? optionsWithoutTranscript
                        : options;

                    const randomOption = poolToChooseFrom[Math.floor(Math.random() * poolToChooseFrom.length)];
                    clinicalDropdown.value = randomOption.value;
                    updateGenerateButton();
                    await generateFakeClinicalInteraction(randomOption.value);
                    hideClinicalIssuesPanel();
                } else {
                    updateUser('Error: No clinical issues available for random selection.', false);
                }
            };
        }

        if (regenerateBtn) {
            regenerateBtn.onclick = async () => {
                const selectedIssue = clinicalDropdown?.value || '';
                if (selectedIssue) {
                    await generateFakeClinicalInteraction(selectedIssue, true);
                    hideClinicalIssuesPanel();
                }
            };
        }

        if (updateBtn) {
            updateBtn.onclick = async () => {
                if (!currentLoadedCondition) {
                    updateUser('Error: No clerking loaded to update.', false);
                    return;
                }

                const updateSpinner = document.getElementById('update-spinner');
                const updateText = document.getElementById('update-text');

                try {
                    // Show loading state
                    if (updateBtn) updateBtn.disabled = true;
                    if (updateSpinner) updateSpinner.style.display = 'inline';
                    if (updateText) updateText.textContent = 'Updating...';

                    // Get current editor content
                    const currentContent = getUserInputContent();

                    if (!currentContent || currentContent.trim() === '') {
                        throw new Error('No content to save');
                    }

                    // Update the transcript
                    await ClinicalConditionsService.updateTranscript(currentLoadedCondition.id, currentContent);

                    updateUser(`Updated test clerking: ${currentLoadedCondition.name}`, false);

                } catch (error) {
                    console.error('[DEBUG] Error updating clerking:', error);
                    updateUser(`Error updating clerking: ${error.message}`, false);
                } finally {
                    // Reset button state
                    if (updateBtn) updateBtn.disabled = false;
                    if (updateSpinner) updateSpinner.style.display = 'none';
                    if (updateText) updateText.textContent = 'Update Saved Version';
                }
            };
        }

        if (cancelBtn) {
            cancelBtn.onclick = () => {
                hideClinicalIssuesPanel();
                updateUser('Clinical interaction generation cancelled.', false);
            };
        }

    } catch (error) {
        console.error('[DEBUG] Error showing clinical issues dropdown:', error);
        updateUser(`Error loading clinical issues: ${error.message}. Please try again.`, false);
    }
}

// Generate fake clinical interaction based on selected issue
export async function generateFakeClinicalInteraction(selectedIssue, forceRegenerate = false) {
    console.log('[DEBUG] generateFakeClinicalInteraction called with:', selectedIssue, 'forceRegenerate:', forceRegenerate);

    const generateBtn = document.getElementById('generate-interaction-btn');
    const regenerateBtn = document.getElementById('regenerate-clerking-btn');
    const generateSpinner = document.getElementById('generate-spinner');
    const regenerateSpinner = document.getElementById('regenerate-spinner');
    const generateText = document.getElementById('generate-text');
    const regenerateText = document.getElementById('regenerate-text');
    const statusDiv = document.getElementById('generation-status');

    try {
        // UI Loading State
        if (generateBtn) generateBtn.disabled = true;
        if (regenerateBtn) regenerateBtn.disabled = true;

        if (forceRegenerate) {
            if (regenerateSpinner) regenerateSpinner.style.display = 'inline';
            if (regenerateText) regenerateText.textContent = 'Regenerating...';
        } else {
            if (generateSpinner) generateSpinner.style.display = 'inline';
            if (generateText) generateText.textContent = 'Loading...';
        }

        if (statusDiv) {
            statusDiv.style.display = 'block';
            const action = forceRegenerate ? 'Regenerating' : 'Loading';
            statusDiv.innerHTML = `<p>📋 ${action} clinical interaction for: <strong>${selectedIssue}</strong></p>`;
        }

        // Find the condition in cached data
        const condition = ClinicalConditionsService.findCondition(selectedIssue);

        if (!condition) {
            throw new Error(`Clinical condition not found: ${selectedIssue}`);
        }

        let transcript = null;
        let isGenerated = false;

        // Check cache
        if (condition.hasTranscript && condition.transcript && !forceRegenerate) {
            transcript = condition.transcript;
            console.log('[DEBUG] Using cached transcript');
        } else {
            // Generate new
            const result = await ClinicalConditionsService.generateTranscript(condition.id, forceRegenerate);
            transcript = result.transcript;
            isGenerated = !result.cached; // Logic depends on server response fields
        }

        if (!transcript) {
            throw new Error(`Failed to get transcript for clinical issue: ${selectedIssue}`);
        }

        if (statusDiv) {
            const statusText = isGenerated ? 'Generated new' : 'Loaded cached';
            statusDiv.innerHTML = `<p>✅ ${statusText} clinical interaction for: <strong>${selectedIssue}</strong></p>`;
        }

        // Update User Input
        setUserInputContent(transcript, true, 'Fake Clinical Interaction');

        // Track the currently loaded condition for updating
        currentLoadedCondition = {
            id: condition.id,
            name: selectedIssue,
            category: condition.category
        };

        // Setup change detection to show Update button only after edits
        setupUpdateButtonOnChange();

        setTimeout(() => {
            updateChatbotButtonVisibility();
        }, 200);

        // Status Bar Update
        const performanceText = forceRegenerate
            ? 'regenerated with updated formatting'
            : (isGenerated ? 'generated using AI' : 'loaded instantly from cache');
        const actionText = forceRegenerate ? 'Regenerated' : 'Loaded';
        const successMessage = `${actionText} clinical interaction for ${selectedIssue} (${condition.category}); transcript length ~${Math.round(transcript.split(' ').length)} words, ${performanceText}.`;

        updateUser(successMessage, false);

    } catch (error) {
        console.error('[DEBUG] Error loading fake clinical interaction:', error);

        if (statusDiv) {
            statusDiv.innerHTML = `<p>❌ Error: ${error.message}</p>`;
        }
        updateUser(`Error loading clinical interaction for ${selectedIssue}: ${error.message}`, false);

    } finally {
        // Reset button states
        if (generateBtn) generateBtn.disabled = false;
        if (regenerateBtn) regenerateBtn.disabled = false;
        if (generateSpinner) generateSpinner.style.display = 'none';
        if (regenerateSpinner) regenerateSpinner.style.display = 'none';
        if (generateText) generateText.textContent = 'Load Clerking';
        if (regenerateText) regenerateText.textContent = 'Regenerate Clerking';
    }
}

// Setup listener to show Update button only after user makes changes
function setupUpdateButtonOnChange() {
    const editor = window.editors?.userInput;
    const updateBtn = document.getElementById('update-clerking-btn');

    if (!editor || !updateBtn) {
        console.warn('[CLINICAL] Cannot setup change listener - editor or button not found');
        return;
    }

    // Hide the button initially
    updateBtn.style.display = 'none';

    // Remove any existing listener
    if (editorChangeListener) {
        editor.off('update', editorChangeListener);
    }

    // Create new listener
    editorChangeListener = () => {
        // Show button on first edit
        if (updateBtn.style.display === 'none') {
            updateBtn.style.display = 'inline-block';
        }
    };

    // Attach listener
    editor.on('update', editorChangeListener);

    console.log('[CLINICAL] Change detection enabled for Update button');
}

// Helper to clean up the test UI
function hideClinicalIssuesPanel() {
    const panel = document.getElementById('clinicalIssuesPanel');
    if (panel && panel.parentNode) {
        panel.parentNode.removeChild(panel);
    }

    const buttonsGroup = document.getElementById('clerkingButtonsGroup');
    if (buttonsGroup) {
        buttonsGroup.style.display = 'none';
    }

    // Hide update button and remove change listener
    const updateBtn = document.getElementById('update-clerking-btn');
    if (updateBtn) {
        updateBtn.style.display = 'none';
    }

    const editor = window.editors?.userInput;
    if (editor && editorChangeListener) {
        editor.off('update', editorChangeListener);
        editorChangeListener = null;
    }

    if (window.updateSummaryVisibility) window.updateSummaryVisibility();
}
