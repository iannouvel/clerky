/**
 * Clinical Interaction Feature
 * UI and logic for generating simulated clinical interactions/clerkings
 */

import { ClinicalConditionsService } from './clinicalData.js';
import { updateUser } from '../ui/status.js';
import { appendToSummary1 } from '../ui/streaming.js';
import { setUserInputContent, updateChatbotButtonVisibility, getUserInputContent } from '../utils/editor.js';
import { auth } from '../../firebase-init.js';
import { SERVER_URL } from '../api/config.js';

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
        <div id="add-new-issue-row" style="display:none; margin-top:8px; gap:8px; align-items:center;">
            <input id="new-issue-input" type="text" placeholder="Enter new clinical issue name..." style="flex:1; padding:6px 10px; border:1px solid var(--border-color, #ccc); border-radius:4px; font-size:13px; background:var(--bg-primary, #fff); color:var(--text-primary, #333);" />
            <button id="add-issue-btn" style="padding:6px 14px; font-size:13px; border-radius:4px; border:1px solid #28a745; background:#28a745; color:#fff; cursor:pointer; white-space:nowrap;">Add</button>
            <button id="cancel-add-issue-btn" style="padding:6px 14px; font-size:13px; border-radius:4px; border:1px solid var(--border-color, #ccc); background:var(--bg-secondary, #f5f5f5); color:var(--text-primary, #333); cursor:pointer;">Cancel</button>
        </div>
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

        // Add "Add new issue..." option at the bottom
        const addNewOption = document.createElement('option');
        addNewOption.value = '__add_new__';
        addNewOption.textContent = '+ Add new issue...';
        clinicalDropdown.appendChild(addNewOption);

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

        const addNewRow = document.getElementById('add-new-issue-row');
        const newIssueInput = document.getElementById('new-issue-input');
        const addIssueBtn = document.getElementById('add-issue-btn');
        const cancelAddBtn = document.getElementById('cancel-add-issue-btn');

        function updateGenerateButton() {
            const selectedValue = clinicalDropdown?.value || '';
            const isAddNew = selectedValue === '__add_new__';
            const hasSelection = selectedValue.trim() !== '' && !isAddNew;

            if (generateBtn) generateBtn.disabled = !hasSelection;
            if (regenerateBtn) regenerateBtn.disabled = !hasSelection;

            // Show/hide the add-new input row
            if (addNewRow) {
                addNewRow.style.display = isAddNew ? 'flex' : 'none';
                if (isAddNew && newIssueInput) {
                    newIssueInput.value = '';
                    newIssueInput.focus();
                }
            }
        }

        if (clinicalDropdown) {
            clinicalDropdown.addEventListener('change', updateGenerateButton);
        }

        // "Add" button for new custom issue
        if (addIssueBtn) {
            addIssueBtn.onclick = async () => {
                const issueName = (newIssueInput?.value || '').trim();
                if (!issueName) {
                    updateUser('Please enter a clinical issue name.', false);
                    return;
                }

                try {
                    addIssueBtn.disabled = true;
                    addIssueBtn.textContent = 'Adding...';

                    const user = auth.currentUser;
                    if (!user) throw new Error('User not authenticated');
                    const idToken = await user.getIdToken();

                    // Create the condition in Firestore
                    const resp = await fetch(`${SERVER_URL}/addClinicalCondition`, {
                        method: 'POST',
                        headers: { 'Authorization': `Bearer ${idToken}`, 'Content-Type': 'application/json' },
                        body: JSON.stringify({ name: issueName, category: 'obstetrics' })
                    });

                    if (!resp.ok) {
                        const errText = await resp.text();
                        throw new Error(errText);
                    }

                    const data = await resp.json();
                    if (!data.success) throw new Error(data.error || 'Failed to add condition');

                    // Add the new option to the dropdown (in the Obstetrics optgroup)
                    let obsGroup = Array.from(clinicalDropdown.querySelectorAll('optgroup'))
                        .find(g => g.label.toLowerCase() === 'obstetrics');
                    if (!obsGroup) {
                        obsGroup = document.createElement('optgroup');
                        obsGroup.label = 'Obstetrics';
                        // Insert before the "Add new issue..." option
                        clinicalDropdown.insertBefore(obsGroup, addNewOption);
                    }

                    const newOpt = document.createElement('option');
                    newOpt.value = issueName;
                    newOpt.dataset.conditionId = data.conditionId;
                    newOpt.textContent = issueName;
                    obsGroup.appendChild(newOpt);

                    // Select the new option and hide the add row
                    clinicalDropdown.value = issueName;
                    if (addNewRow) addNewRow.style.display = 'none';
                    updateGenerateButton();

                    // Also update the local cache
                    const cache = ClinicalConditionsService.getConditions();
                    if (cache && cache.obstetrics) {
                        cache.obstetrics[issueName] = {
                            id: data.conditionId,
                            name: issueName,
                            category: 'obstetrics',
                            transcript: null,
                            hasTranscript: false
                        };
                    }

                    updateUser(`Added new clinical issue: ${issueName}. Click "Load Clerking" to generate a transcript.`, false);

                } catch (err) {
                    console.error('[CLINICAL] Error adding new issue:', err);
                    updateUser(`Error adding issue: ${err.message}`, false);
                } finally {
                    addIssueBtn.disabled = false;
                    addIssueBtn.textContent = 'Add';
                }
            };
        }

        // Cancel button for add-new row
        if (cancelAddBtn) {
            cancelAddBtn.onclick = () => {
                clinicalDropdown.value = '';
                if (addNewRow) addNewRow.style.display = 'none';
                updateGenerateButton();
            };
        }

        // Enter key in the new issue input triggers Add
        if (newIssueInput) {
            newIssueInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    addIssueBtn?.click();
                }
            });
        }

        // Button Event Handlers
        if (generateBtn) {
            generateBtn.onclick = async () => {
                const selectedIssue = clinicalDropdown?.value || '';
                if (selectedIssue && selectedIssue !== '__add_new__') {
                    await generateFakeClinicalInteraction(selectedIssue);
                    hideClinicalIssuesPanel();
                }
            };
        }

        if (randomBtn) {
            randomBtn.onclick = async () => {
                if (!clinicalDropdown) return;
                const options = Array.from(clinicalDropdown.options).filter(option =>
                    option.value && option.value.trim() !== '' && option.value !== '__add_new__'
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
