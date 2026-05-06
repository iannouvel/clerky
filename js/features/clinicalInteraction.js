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

// Show clinical issues dropdown as a modal
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

        // Get modal and body elements
        const modal = document.getElementById('clinicalClerkingModal');
        const modalBody = document.getElementById('clinicalClerkingBody');

        if (!modal || !modalBody) {
            console.error('[DEBUG] Clinical clerking modal elements not found');
            updateUser('Error: Unable to initialise clinical clerking modal.', false);
            return;
        }

        // Clear existing content
        modalBody.innerHTML = '';

        // Create modal content
        const container = document.createElement('div');
        container.className = 'clinical-clerking-container';

        let html = `
            <h3>⚡ Load Clinical Clerking</h3>
            <p>Select a clinical issue to instantly load a realistic pre-generated clinical clerking using SBAR format:</p>

            <div class="clinical-issue-section">
                <label for="clinical-issues-dropdown">Clinical Issues</label>
                <select id="clinical-issues-dropdown" class="clinical-dropdown">
                    <option value="">Select a clinical issue...</option>
                </select>
            </div>

            <div class="clinical-add-section">
                <label>Add New Clinical Issue</label>
                <div class="clinical-add-row">
                    <input id="new-issue-input" type="text" placeholder="Enter a clinical issue name..." />
                    <button id="add-issue-btn" class="clinical-add-btn">Add</button>
                </div>
            </div>

            <div class="clinical-modal-actions">
                <button id="modal-load-clerking-btn" class="nav-btn primary" disabled>Load Clerking</button>
                <button id="modal-random-issue-btn" class="nav-btn secondary">Random Issue</button>
                <button id="modal-cancel-btn" class="nav-btn secondary">Cancel</button>
            </div>
        `;

        container.innerHTML = html;
        modalBody.appendChild(container);

        // Get elements
        const clinicalDropdown = document.getElementById('clinical-issues-dropdown');
        const newIssueInput = document.getElementById('new-issue-input');
        const addIssueBtn = document.getElementById('add-issue-btn');
        const loadBtn = document.getElementById('modal-load-clerking-btn');
        const randomBtn = document.getElementById('modal-random-issue-btn');
        const cancelBtn = document.getElementById('modal-cancel-btn');

        // Populate dropdown
        clinicalDropdown.innerHTML = '<option value="">Select a clinical issue...</option>';

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

        // Show modal
        modal.classList.remove('hidden');
        document.body.appendChild(modal);

        requestAnimationFrame(() => {
            clinicalDropdown.focus();
        });

        // Update button state
        function updateLoadButton() {
            const selectedValue = clinicalDropdown?.value || '';
            const hasSelection = selectedValue.trim() !== '';
            if (loadBtn) loadBtn.disabled = !hasSelection;
        }

        clinicalDropdown.addEventListener('change', updateLoadButton);

        // Add issue button
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

                // Find or create the Obstetrics optgroup
                let obsGroup = Array.from(clinicalDropdown.querySelectorAll('optgroup'))
                    .find(g => g.label.toLowerCase() === 'obstetrics');
                if (!obsGroup) {
                    obsGroup = document.createElement('optgroup');
                    obsGroup.label = 'Obstetrics';
                    clinicalDropdown.appendChild(obsGroup);
                }

                // Insert alphabetically within the optgroup
                const newOpt = document.createElement('option');
                newOpt.value = issueName;
                newOpt.dataset.conditionId = data.conditionId;
                newOpt.textContent = issueName;

                const existingOpts = Array.from(obsGroup.querySelectorAll('option'));
                const insertBefore = existingOpts.find(o => o.textContent.localeCompare(issueName, undefined, { sensitivity: 'base' }) > 0);
                if (insertBefore) {
                    obsGroup.insertBefore(newOpt, insertBefore);
                } else {
                    obsGroup.appendChild(newOpt);
                }

                clinicalDropdown.value = issueName;
                updateLoadButton();
                newIssueInput.value = '';

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

                if (window.cacheManager?.saveClinicalConditions && cache) {
                    window.cacheManager.saveClinicalConditions(cache).catch(() => {});
                }

                updateUser(`Added "${issueName}". Click "Load Clerking" to generate a transcript.`, false);

            } catch (err) {
                console.error('[CLINICAL] Error adding new issue:', err);
                updateUser(`Error adding issue: ${err.message}`, false);
            } finally {
                addIssueBtn.disabled = false;
                addIssueBtn.textContent = 'Add';
            }
        };

        // Enter key in input triggers Add
        newIssueInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                addIssueBtn?.click();
            }
        });

        // Load button
        loadBtn.onclick = async () => {
            const selectedIssue = clinicalDropdown?.value || '';
            if (selectedIssue) {
                hideClinicalClerkingModal();
                await generateFakeClinicalInteraction(selectedIssue);
            }
        };

        // Random button
        randomBtn.onclick = async () => {
            const options = Array.from(clinicalDropdown.options).filter(option =>
                option.value && option.value.trim() !== ''
            );

            if (options.length > 0) {
                const optionsWithoutTranscript = options.filter(option =>
                    !option.textContent.includes(' ✓')
                );

                const poolToChooseFrom = optionsWithoutTranscript.length > 0
                    ? optionsWithoutTranscript
                    : options;

                const randomOption = poolToChooseFrom[Math.floor(Math.random() * poolToChooseFrom.length)];
                hideClinicalClerkingModal();
                await generateFakeClinicalInteraction(randomOption.value);
            } else {
                updateUser('Error: No clinical issues available for random selection.', false);
            }
        };

        // Cancel button
        cancelBtn.onclick = () => {
            hideClinicalClerkingModal();
            updateUser('Clinical interaction generation cancelled.', false);
        };

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
function hideClinicalClerkingModal() {
    const modal = document.getElementById('clinicalClerkingModal');
    if (modal) {
        modal.classList.add('hidden');
    }

    const updateBtn = document.getElementById('update-clerking-btn');
    if (updateBtn) {
        updateBtn.style.display = 'none';
    }

    const editor = window.editors?.userInput;
    if (editor && editorChangeListener) {
        editor.off('update', editorChangeListener);
        editorChangeListener = null;
    }
}
