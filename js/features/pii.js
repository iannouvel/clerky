import { escapeHtml } from '../utils/text.js';
import { highlightTextInEditor, clearHighlightInEditor, scrollTextIntoView } from '../utils/editor.js';

// Global state for PII review managed within this module
// but exposed to window for legacy compatibility if needed
window.currentPIIReview = null;

/**
 * PII Review Interface Function - now uses Summary column instead of popup
 * @param {string} originalText 
 * @param {object} piiAnalysis 
 * @param {object} callbacks - { appendToSummary1, updateSummaryCriticalStatus, updateUser }
 */
export async function showPIIReviewInterface(originalText, piiAnalysis, callbacks) {
    return new Promise((resolve) => {
        // Get consolidated PII matches
        // Assumes window.clinicalAnonymiser is available (loaded from services/anonymisation.js)
        const consolidatedMatches = window.clinicalAnonymiser.consolidatePIIMatches(piiAnalysis.matches);

        // Add replacement property to each match
        consolidatedMatches.forEach(match => {
            match.replacement = match.replacement || 'redacted';
        });

        // If there are no matches to review, return success immediately
        if (consolidatedMatches.length === 0) {
            console.log('[PII REVIEW] No PII matches to review, skipping interface');
            resolve({
                approved: true,
                anonymisedText: originalText,
                replacementsCount: 0
            });
            return;
        }

        // Show PII review in Summary column instead of popup
        showPIIReviewInSummary(originalText, piiAnalysis, consolidatedMatches, resolve, callbacks);
    });
}

// ===== One-at-a-Time PII Review Workflow =====

function showPIIReviewInSummary(originalText, piiAnalysis, consolidatedMatches, resolve, callbacks) {
    console.log('[PII REVIEW] Starting one-at-a-time review with', consolidatedMatches.length, 'matches');

    // Store the review data globally
    window.currentPIIReview = {
        originalText,
        consolidatedMatches,
        resolve,
        currentIndex: 0,
        decisions: [], // Track decisions for all matches
        callbacks // Store callbacks for usage in other functions
    };

    // Show the first match
    showCurrentPIIMatch();
}

// Display the current PII match being reviewed
function showCurrentPIIMatch() {
    const review = window.currentPIIReview;
    if (!review) return;

    const { consolidatedMatches, currentIndex, decisions, callbacks } = review;
    const { appendToSummary1, updateSummaryCriticalStatus } = callbacks;
    const totalMatches = consolidatedMatches.length;

    // Check if we're done
    if (currentIndex >= totalMatches) {
        completePIIReview();
        return;
    }

    const currentMatch = consolidatedMatches[currentIndex];
    const progressText = `${currentIndex + 1} of ${totalMatches}`;

    console.log('[PII REVIEW] Showing match', progressText, ':', currentMatch.text);

    // Highlight the text in blue and scroll to it
    const highlighted = highlightTextInEditor(currentMatch.text);
    if (highlighted) {
        scrollTextIntoView(currentMatch.text);
    } else {
        console.warn('[PII REVIEW] Could not highlight text:', currentMatch.text);
    }

    // Get default action from match
    const defaultReplacement = currentMatch.replacement || 'redacted';

    // Create the review HTML for this one match
    const reviewHtml = `
        <div class="pii-review-container" id="pii-review-current">
            <h3 style="color: #d32f2f; margin: 0 0 15px 0;">🔒 Privacy Review (${progressText})</h3>
            <p style="margin: 0 0 10px 0; font-size: 14px; color: var(--text-secondary);">
                Personal information detected. Please choose an action:
            </p>
            
            <div class="pii-current-match" style="background: var(--bg-tertiary); border: 2px solid #3B82F6; padding: 15px; margin: 10px 0; border-radius: 6px;">
                <div style="margin: 0 0 10px 0;">
                    <strong style="color: #d32f2f;">Found:</strong> 
                    <span style="background: var(--bg-secondary); padding: 4px 8px; border-radius: 3px; font-family: monospace;">"${escapeHtml(currentMatch.text)}"</span>
                </div>
                <div style="margin: 15px 0;">
                    <label style="display: block; margin-bottom: 8px; cursor: pointer;">
                        <input type="radio" name="pii-current-action" value="replace" checked style="margin-right: 8px;">
                        Replace with <strong style="color: #28a745;">"${escapeHtml(defaultReplacement)}"</strong>
                    </label>
                    <label style="display: block; cursor: pointer;">
                        <input type="radio" name="pii-current-action" value="keep" style="margin-right: 8px;">
                        Keep original text
                    </label>
                </div>
            </div>
            
            <div style="margin-top: 15px; text-align: center; font-size: 13px; color: var(--text-secondary);">
                ${decisions.length} decision${decisions.length !== 1 ? 's' : ''} made • ${totalMatches - currentIndex - 1} remaining
            </div>
        </div>
    `;

    // Replace the review container in summary
    const existingReview = document.getElementById('pii-review-current');
    if (existingReview && existingReview.parentElement) {
        existingReview.outerHTML = reviewHtml;
        // Update critical status
        setTimeout(() => {
            if (typeof updateSummaryCriticalStatus === 'function') {
                updateSummaryCriticalStatus();
            }
        }, 100);
    } else {
        if (typeof appendToSummary1 === 'function') {
            appendToSummary1(reviewHtml, true);
        }
        // Note: updateSummaryCriticalStatus will be called by appendToSummary1
    }

    // Show PII buttons in fixedButtonRow
    togglePIIButtons(true, currentIndex);
}

function togglePIIButtons(show, currentIndex = 0) {
    const piiActionsGroup = document.getElementById('piiActionsGroup');
    const suggestionActionsGroup = document.getElementById('suggestionActionsGroup');
    const clerkingButtonsGroup = document.getElementById('clerkingButtonsGroup');
    const piiPrevBtn = document.getElementById('piiPrevBtn');

    if (piiActionsGroup) {
        piiActionsGroup.style.display = show ? 'flex' : 'none';

        if (show) {
            if (suggestionActionsGroup) suggestionActionsGroup.style.display = 'none';
            if (clerkingButtonsGroup) clerkingButtonsGroup.style.display = 'none';

            // Update Previous button visibility
            if (piiPrevBtn) {
                piiPrevBtn.style.display = currentIndex > 0 ? 'flex' : 'none';
            }
        }
    }
}

// Scroll summary1 to show the PII review buttons
// Exporting to window for button clicks in DOM although ideally should be event listener
window.scrollToPIIReviewButtons = function scrollToPIIReviewButtons(maxAttempts = 10) {
    const summary1 = document.getElementById('summary1');
    const reviewContainer = document.getElementById('pii-review-current');

    if (!summary1) {
        console.warn('[PII REVIEW] Cannot scroll: summary1 not found');
        return;
    }

    if (!reviewContainer) {
        if (maxAttempts > 0) {
            // Retry after a short delay if container isn't ready yet (e.g., still streaming)
            setTimeout(() => scrollToPIIReviewButtons(maxAttempts - 1), 100);
            return;
        }
        console.warn('[PII REVIEW] Cannot scroll: review container not found after retries');
        return;
    }

    // Find the navigation buttons container
    const buttonsContainer = reviewContainer.querySelector('.pii-navigation');
    if (!buttonsContainer) {
        if (maxAttempts > 0) {
            // Retry after a short delay if buttons aren't ready yet
            setTimeout(() => scrollToPIIReviewButtons(maxAttempts - 1), 100);
            return;
        }
        console.warn('[PII REVIEW] Buttons container not found after retries');
        return;
    }

    // Wait for buttons to be fully rendered (have dimensions)
    const buttonsRect = buttonsContainer.getBoundingClientRect();
    if (buttonsRect.height === 0 && maxAttempts > 0) {
        setTimeout(() => scrollToPIIReviewButtons(maxAttempts - 1), 100);
        return;
    }

    // Calculate scroll position to show buttons
    const summaryRect = summary1.getBoundingClientRect();

    // Check if buttons are below the visible area
    if (buttonsRect.bottom > summaryRect.bottom) {
        // Calculate how much to scroll
        const scrollAmount = buttonsRect.bottom - summaryRect.bottom + 20; // Add 20px padding
        summary1.scrollTop += scrollAmount;
        console.log('[PII REVIEW] Scrolled summary1 to show buttons');
    } else if (buttonsRect.top < summaryRect.top) {
        // Buttons are above visible area, scroll up to show them
        const scrollAmount = buttonsRect.top - summaryRect.top - 20; // Add 20px padding
        summary1.scrollTop += scrollAmount;
        console.log('[PII REVIEW] Scrolled summary1 up to show buttons');
    } else {
        console.log('[PII REVIEW] Buttons are already visible');
    }
}

// Handle user decision on current PII match
window.handlePIIDecision = function (action) {
    const review = window.currentPIIReview;
    if (!review) return;

    const currentMatch = review.consolidatedMatches[review.currentIndex];

    // If action is from button click, use it; otherwise get from radio
    let finalAction = action;
    if (action === 'replace' || action === 'keep' || action === 'skip') {
        // Use the action parameter
    } else {
        // Get from radio selection
        const selectedRadio = document.querySelector('input[name="pii-current-action"]:checked');
        finalAction = selectedRadio ? selectedRadio.value : 'keep';
    }

    console.log('[PII REVIEW] Decision:', finalAction, 'for match:', currentMatch.text);

    // Record the decision
    review.decisions.push({
        match: currentMatch,
        action: finalAction
    });

    // Clear the blue highlighting
    clearHighlightInEditor();

    // Move to next match
    review.currentIndex++;

    // Show next match or complete
    showCurrentPIIMatch();
};

// Navigate between PII matches
window.navigatePIIReview = function (direction) {
    const review = window.currentPIIReview;
    if (!review) return;

    // Clear current highlighting
    clearHighlightInEditor();

    // If going back, remove the last decision
    if (direction < 0 && review.currentIndex > 0) {
        review.currentIndex--;
        // Remove the last decision if it exists
        if (review.decisions.length > review.currentIndex) {
            review.decisions.pop();
        }
    }

    // Show the match at current index
    showCurrentPIIMatch();
};

// Complete the PII review and apply all decisions
function completePIIReview() {
    const review = window.currentPIIReview;
    if (!review) return;

    const { updateUser } = review.callbacks;

    console.log('[PII REVIEW] Completing review with', review.decisions.length, 'decisions');

    // Clear any remaining highlighting
    clearHighlightInEditor();

    // Apply all decisions
    let anonymisedText = review.originalText;
    let replacementsCount = 0;
    const replacements = [];

    review.decisions.forEach(({ match, action }) => {
        if (action === 'replace') {
            const replacement = match.replacement || 'redacted';
            anonymisedText = anonymisedText.replace(
                new RegExp(match.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'),
                replacement
            );
            replacements.push({
                findText: match.text,
                replacementText: replacement
            });
            replacementsCount++;
        }
    });

    const reviewContainer = document.getElementById('pii-review-current');
    if (reviewContainer) {
        reviewContainer.remove();
    }

    // Summarise outcome via status message instead of summary1 content
    const keptOriginal = review.decisions.length - replacementsCount;
    if (typeof updateUser === 'function') {
        updateUser(
            `Privacy review complete: ${replacementsCount} item${replacementsCount !== 1 ? 's' : ''} anonymised, ${keptOriginal} kept original.`,
            false
        );
    }

    // Resolve the promise
    review.resolve({
        approved: true,
        anonymisedText,
        replacementsCount
    });

    // Clean up
    window.currentPIIReview = null;

    // Hide PII buttons
    togglePIIButtons(false);
}

// Cancel the entire PII review
window.cancelPIIReview = function () {
    const review = window.currentPIIReview;
    if (!review) return;

    const { updateUser } = review.callbacks;

    console.log('[PII REVIEW] Review cancelled by user');

    // Clear highlighting
    clearHighlightInEditor();

    const reviewContainer = document.getElementById('pii-review-current');
    if (reviewContainer) {
        reviewContainer.remove();
    }

    // Inform user via status message
    if (typeof updateUser === 'function') {
        updateUser('Privacy review cancelled – original text will be used without anonymisation.', false);
    }

    // Resolve with cancellation
    review.resolve({
        approved: false,
        anonymisedText: review.originalText,
        replacementsCount: 0
    });

    // Clean up
    window.currentPIIReview = null;

    // Hide PII buttons
    togglePIIButtons(false);
};
