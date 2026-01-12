// Import Firebase instances from firebase-init.js
import { app, db, auth } from './firebase-init.js';
import { GoogleAuthProvider, signInWithPopup, onAuthStateChanged, signOut, signInWithRedirect, getRedirectResult } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import { getAnalytics } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-analytics.js';
import { doc, getDoc, setDoc, collection, onSnapshot } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

// Make auth available globally - ADD THIS LINE
window.auth = auth;

// Load and display version number from package.json
async function loadVersionNumber() {
    try {
        const response = await fetch('./package.json?v=' + Date.now());
        const packageData = await response.json();
        const versionElement = document.getElementById('appVersion');
        if (versionElement && packageData.version) {
            versionElement.textContent = packageData.version;
            console.log('[VERSION] App version updated to:', packageData.version);
        }
    } catch (error) {
        // Fail silently - version number is not critical for app functionality
    }
}

// Call loadVersionNumber when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadVersionNumber);
} else {
    loadVersionNumber();
}

// ===== Shared AI Model Preference Helpers =====

// Fetch the user's current AI provider preference from the server.
// Falls back to DeepSeek if anything goes wrong.

// Global variable to store relevant guidelines
let relevantGuidelines = null;

// Global variables for programmatic change tracking
window.programmaticChangeHistory = [];
window.hasColoredChanges = false;
window.currentChangeIndex = -1;

// ===== Mobile Detection & Layout Management =====

// Global mobile state
window.isMobile = false;
window.mobileView = 'userInput'; // 'userInput' or 'summary1'

// Mobile settings overlay state
let mobileSettingsInitialized = false;
let mobileSettingsOverlayOpen = false;
let userPreferencesOriginalParent = null;
let userPreferencesOriginalNextSibling = null;

function openMobileSettingsOverlay() {
    if (!window.isMobile) return;

    const overlay = document.getElementById('mobileSettingsOverlay');
    const bodyContainer = document.getElementById('mobileSettingsBody');
    const panel = document.getElementById('userPreferencesPanel');

    if (!overlay || !bodyContainer || !panel) {
        console.warn('[MOBILE] Mobile settings elements not found');
        return;
    }

    // Remember original placement on first open
    if (!userPreferencesOriginalParent) {
        userPreferencesOriginalParent = panel.parentElement;
        userPreferencesOriginalNextSibling = panel.nextSibling;
    }

    // Move preferences panel into the overlay body
    if (panel.parentElement !== bodyContainer) {
        bodyContainer.appendChild(panel);
    }

    overlay.classList.remove('hidden');
    document.body.classList.add('mobile-settings-open');
    mobileSettingsOverlayOpen = true;
}

function closeMobileSettingsOverlay() {
    const overlay = document.getElementById('mobileSettingsOverlay');
    const panel = document.getElementById('userPreferencesPanel');

    if (overlay) {
        overlay.classList.add('hidden');
    }

    // Move the panel back to its original location so desktop layout is unchanged
    if (panel && userPreferencesOriginalParent) {
        if (userPreferencesOriginalNextSibling && userPreferencesOriginalNextSibling.parentElement === userPreferencesOriginalParent) {
            userPreferencesOriginalParent.insertBefore(panel, userPreferencesOriginalNextSibling);
        } else {
            userPreferencesOriginalParent.appendChild(panel);
        }
    }

    document.body.classList.remove('mobile-settings-open');
    mobileSettingsOverlayOpen = false;
}

function initializeMobileSettingsOverlay() {
    if (mobileSettingsInitialized) return;

    const toggleBtn = document.getElementById('mobileSettingsToggleBtn');
    const overlay = document.getElementById('mobileSettingsOverlay');
    const closeBtn = document.getElementById('mobileSettingsCloseBtn');

    if (!toggleBtn || !overlay) {
        // Elements may not be ready yet
        return;
    }

    toggleBtn.addEventListener('click', () => {
        if (mobileSettingsOverlayOpen) {
            closeMobileSettingsOverlay();
        } else {
            openMobileSettingsOverlay();
        }
    });

    if (closeBtn) {
        closeBtn.addEventListener('click', () => {
            closeMobileSettingsOverlay();
        });
    }

    // Close when clicking outside the dialog
    overlay.addEventListener('click', (event) => {
        if (event.target === overlay) {
            closeMobileSettingsOverlay();
        }
    });

    // Close on Escape key
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && mobileSettingsOverlayOpen) {
            closeMobileSettingsOverlay();
        }
    });

    mobileSettingsInitialized = true;
}

// Detect if device is mobile based on viewport width and user agent
function detectMobile() {
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
    const isMobileWidth = viewportWidth <= 768;

    // User agent detection for additional mobile device detection
    const userAgent = navigator.userAgent || navigator.vendor || window.opera;
    const isMobileUA = /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/i.test(userAgent.toLowerCase());

    const wasMobile = window.isMobile;
    window.isMobile = isMobileWidth || (isMobileUA && viewportWidth <= 1024);

    // If mobile state changed, update layout
    if (wasMobile !== window.isMobile) {
        applyMobileLayout();
    }

    return window.isMobile;
}

// Apply mobile layout changes
function applyMobileLayout() {
    const body = document.body;
    const mainContent = document.getElementById('mainContent');
    const chatbotLayout = document.getElementById('chatbotLayout');
    const mobileToggleContainer = document.getElementById('mobileViewToggle');
    const mobileSettingsToggleBtn = document.getElementById('mobileSettingsToggleBtn');

    // If mainContent doesn't exist yet, try again after a short delay
    if (!mainContent) {
        // Retry after a short delay if elements aren't ready
        setTimeout(() => {
            if (document.getElementById('mainContent')) {
                applyMobileLayout();
            }
        }, 100);
        return;
    }

    if (window.isMobile) {
        body.classList.add('mobile-mode');
        mainContent.classList.add('mobile-mode');
        initializeMobileSettingsOverlay();

        // Hide mobile toggle buttons (not needed with chatbot layout)
        if (mobileToggleContainer) {
            mobileToggleContainer.classList.add('hidden');
        }

        if (mobileSettingsToggleBtn) {
            mobileSettingsToggleBtn.classList.remove('hidden');
        }
    } else {
        // Ensure any open mobile settings overlay is closed when leaving mobile mode
        if (mobileSettingsOverlayOpen) {
            closeMobileSettingsOverlay();
        }

        body.classList.remove('mobile-mode');
        mainContent.classList.remove('mobile-mode');

        // Hide mobile toggle buttons
        if (mobileToggleContainer) {
            mobileToggleContainer.classList.add('hidden');
        }

        if (mobileSettingsToggleBtn) {
            mobileSettingsToggleBtn.classList.add('hidden');
        }
    }
}

// Switch between userInput and summary1 views on mobile
function switchMobileView(view) {
    if (!window.isMobile) return;

    const userInputCol = document.querySelector('.user-input-col');
    const summaryCol = document.querySelector('.summary-col');
    const userInputBtn = document.getElementById('mobileViewUserInputBtn');
    const summaryBtn = document.getElementById('mobileViewSummaryBtn');

    window.mobileView = view;
    sessionStorage.setItem('mobileView', view);

    if (view === 'userInput') {
        if (userInputCol) {
            userInputCol.style.display = 'flex';
            // Ensure TipTap editor is properly visible when switching to userInput
            const editorElement = userInputCol.querySelector('.tiptap-editor');
            if (editorElement && window.editors && window.editors.userInput) {
                // Small delay to ensure DOM update completes
                setTimeout(() => {
                    try {
                        window.editors.userInput.commands.focus();
                    } catch (e) {
                        // Editor might not be ready, ignore
                    }
                }, 100);
            }
        }
        if (summaryCol) summaryCol.style.display = 'none';
        if (userInputBtn) userInputBtn.classList.add('active');
        if (summaryBtn) summaryBtn.classList.remove('active');
    } else {
        if (userInputCol) userInputCol.style.display = 'none';
        if (summaryCol) {
            summaryCol.style.display = 'flex';
            // Scroll to top of summary when switching to it
            const summaryPane = summaryCol.querySelector('#summary1');
            if (summaryPane) {
                setTimeout(() => {
                    summaryPane.scrollTop = 0;
                }, 50);
            }
        }
        if (userInputBtn) userInputBtn.classList.remove('active');
        if (summaryBtn) summaryBtn.classList.add('active');
    }
}

// Initialize mobile detection on page load and resize
function initializeMobileDetection() {
    detectMobile();

    // Listen for window resize
    let resizeTimeout;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(() => {
            detectMobile();
        }, 150);
    });

    // Set up mobile view toggle buttons
    const userInputBtn = document.getElementById('mobileViewUserInputBtn');
    const summaryBtn = document.getElementById('mobileViewSummaryBtn');

    if (userInputBtn) {
        userInputBtn.addEventListener('click', () => switchMobileView('userInput'));
    }

    if (summaryBtn) {
        summaryBtn.addEventListener('click', () => switchMobileView('summary1'));
    }
}

// Initialize mobile detection when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeMobileDetection);
} else {
    initializeMobileDetection();
}

// ===== Connectivity Monitoring =====
function initializeConnectivityConnection() {
    window.addEventListener('online', () => {
        console.log('[NETWORK] Connection restored');
        updateUser('Connection restored. You are back online.', false);
        // Clear message after 5 seconds
        setTimeout(() => {
            const statusEl = document.getElementById('serverStatusMessage');
            if (statusEl && statusEl.textContent === 'Connection restored. You are back online.') {
                statusEl.style.display = 'none';
            }
        }, 5000);

        // Attempt to reconnect listeners if needed or rely on Firestore auto-reconnect
        if (window.cacheManager) {
            // Signal cache manager we are back online if relevant
        }
    });

    window.addEventListener('offline', () => {
        console.log('[NETWORK] Connection lost');
        updateUser('Connection lost. Switching to offline mode (cached data).', true); // Keep confusing/persistent message? No, keep it visible.
        // Actually updateUser logic hides non-loading messages. Let's make it look like a persistent warning or just a notification.
        // Re-using updateUser with isLoading=false means it auto-hides. 
        // Let's rely on standard behavior for now.
    });
}
// Initialize connectivity listeners
initializeConnectivityConnection();

// Add disclaimer check function
async function checkDisclaimerAcceptance() {
    const user = auth.currentUser;
    if (!user) {
        console.log('[DEBUG] No user authenticated, skipping disclaimer check');
        return true; // Allow access if no user (will be handled by auth flow)
    }

    try {
        console.log('[DEBUG] Checking disclaimer acceptance for user:', user.uid);
        const disclaimerRef = doc(db, 'disclaimerAcceptance', user.uid);
        const disclaimerDoc = await getDoc(disclaimerRef);

        if (!disclaimerDoc.exists()) {
            console.log('[DEBUG] No disclaimer acceptance found, redirecting to disclaimer page');
            window.location.href = 'disclaimer.html';
            return false;
        }

        // Check if disclaimer was accepted today
        const acceptanceData = disclaimerDoc.data();
        const acceptanceTime = acceptanceData.acceptanceTime.toDate();
        const today = new Date();
        const isToday = acceptanceTime.toDateString() === today.toDateString();

        console.log('[DEBUG] Disclaimer acceptance check:', {
            acceptanceTime: acceptanceTime.toDateString(),
            today: today.toDateString(),
            isToday: isToday
        });

        if (!isToday) {
            console.log('[DEBUG] Disclaimer not accepted today, redirecting to disclaimer page');
            window.location.href = 'disclaimer.html';
            return false;
        }

        console.log('[DEBUG] Disclaimer accepted today, allowing access');
        return true;
    } catch (error) {
        console.error('[ERROR] Error checking disclaimer acceptance:', error);
        // On error, redirect to disclaimer page to be safe
        window.location.href = 'disclaimer.html';
        return false;
    }
}

// PII Review Interface Function - now uses Summary column instead of popup
async function showPIIReviewInterface(originalText, piiAnalysis) {
    return new Promise((resolve) => {
        // Get consolidated PII matches
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
        showPIIReviewInSummary(originalText, piiAnalysis, consolidatedMatches, resolve);
    });
}

// ===== One-at-a-Time PII Review Workflow =====

// Global state for PII review
window.currentPIIReview = null;

// New function to handle PII review in Summary column - ONE AT A TIME
function showPIIReviewInSummary(originalText, piiAnalysis, consolidatedMatches, resolve) {
    console.log('[PII REVIEW] Starting one-at-a-time review with', consolidatedMatches.length, 'matches');

    // Store the review data globally
    window.currentPIIReview = {
        originalText,
        consolidatedMatches,
        resolve,
        currentIndex: 0,
        decisions: [] // Track decisions for all matches
    };

    // Show the first match
    showCurrentPIIMatch();
}

// Display the current PII match being reviewed
function showCurrentPIIMatch() {
    const review = window.currentPIIReview;
    if (!review) return;

    const { consolidatedMatches, currentIndex, decisions } = review;
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
            updateSummaryCriticalStatus();
        }, 100);
    } else {
        appendToSummary1(reviewHtml, true);
        // Note: updateSummaryCriticalStatus will be called by appendToSummary1
    }

    // Show PII buttons in fixedButtonRow
    const piiActionsGroup = document.getElementById('piiActionsGroup');
    const suggestionActionsGroup = document.getElementById('suggestionActionsGroup');
    const clerkingButtonsGroup = document.getElementById('clerkingButtonsGroup');
    const piiPrevBtn = document.getElementById('piiPrevBtn');

    if (piiActionsGroup) {
        piiActionsGroup.style.display = 'flex';
        if (suggestionActionsGroup) suggestionActionsGroup.style.display = 'none';
        if (clerkingButtonsGroup) clerkingButtonsGroup.style.display = 'none';

        // Update Previous button visibility
        if (piiPrevBtn) {
            piiPrevBtn.style.display = currentIndex > 0 ? 'flex' : 'none';
        }
    }
}

// Scroll summary1 to show the PII review buttons
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
    updateUser(
        `Privacy review complete: ${replacementsCount} item${replacementsCount !== 1 ? 's' : ''} anonymised, ${keptOriginal} kept original.`,
        false
    );

    // Resolve the promise
    review.resolve({
        approved: true,
        anonymisedText,
        replacementsCount
    });

    // Clean up
    window.currentPIIReview = null;

    // Hide PII buttons
    const piiActionsGroup = document.getElementById('piiActionsGroup');
    if (piiActionsGroup) {
        piiActionsGroup.style.display = 'none';
    }
}

// Cancel the entire PII review
window.cancelPIIReview = function () {
    const review = window.currentPIIReview;
    if (!review) return;

    console.log('[PII REVIEW] Review cancelled by user');

    // Clear highlighting
    clearHighlightInEditor();

    const reviewContainer = document.getElementById('pii-review-current');
    if (reviewContainer) {
        reviewContainer.remove();
    }

    // Inform user via status message
    updateUser('Privacy review cancelled – original text will be used without anonymisation.', false);

    // Resolve with cancellation
    review.resolve({
        approved: false,
        anonymisedText: review.originalText,
        replacementsCount: 0
    });

    // Clean up
    window.currentPIIReview = null;

    // Hide PII buttons
    const piiActionsGroup = document.getElementById('piiActionsGroup');
    if (piiActionsGroup) {
        piiActionsGroup.style.display = 'none';
    }
};

// Helper to escape HTML entities
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Helper to safely apply modification suggestions to the userInput content.
// Returns { content, didReplace } and leaves it up to the caller to decide
// how to handle cases where the original text is no longer present.
function applySuggestionTextReplacement(currentContent, originalText, replacementText) {
    if (!originalText || typeof originalText !== 'string') {
        console.warn('[DEBUG] applySuggestionTextReplacement: No originalText provided');
        return { content: currentContent, didReplace: false };
    }

    const escapedOriginal = originalText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(escapedOriginal, 'gi');

    if (!regex.test(currentContent)) {
        console.warn('[DEBUG] applySuggestionTextReplacement: Original text not found in current content', {
            originalTextSnippet: originalText.slice(0, 120)
        });
        return { content: currentContent, didReplace: false };
    }

    const newContent = currentContent.replace(regex, replacementText);
    return { content: newContent, didReplace: true };
}

// Helper to unescape HTML entities
function unescapeHtml(text) {
    const div = document.createElement('div');
    div.innerHTML = text;
    return div.textContent;
}

// Helper to apply colored replacements only to specific tokens
function applyColoredReplacements(anonymisedText, replacements) {
    // The anonymisedText already has replacements applied, so we need to color the replacement text
    let html = escapeHtml(anonymisedText);

    // Color each replacement text (not the original text)
    replacements.forEach(({ findText, replacementText }) => {
        const escapedReplacement = escapeHtml(replacementText).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(escapedReplacement, 'gi');
        const coloredReplacement = `<span style="color: #D97706; font-weight: bold;">${escapeHtml(replacementText)}</span>`;
        html = html.replace(regex, coloredReplacement);
    });

    // Convert newlines to <br> for HTML display
    html = html.replace(/\n/g, '<br>');

    return `<p>${html}</p>`;
}

// ===== Text Highlighting Utilities for Review Workflows =====

/**
 * Highlight specific text in the TipTap editor with a given color
 * @param {string} text - The text to highlight
 * @param {string} color - The color to use (default: blue #3B82F6)
 * @returns {boolean} - True if text was found and highlighted, false otherwise
 */
function highlightTextInEditor(text, color = '#3B82F6') {
    const editor = window.editors?.userInput;
    if (!editor) {
        console.warn('[HIGHLIGHT] Editor not available');
        return false;
    }

    try {
        // Clear any existing highlights first
        clearHighlightInEditor();

        // Get the current content
        const content = editor.getText();

        // Find the text position
        const startPos = content.toLowerCase().indexOf(text.toLowerCase());
        if (startPos === -1) {
            console.warn('[HIGHLIGHT] Text not found in editor:', text);
            return false;
        }

        const endPos = startPos + text.length;

        // Select the text range
        editor.commands.setTextSelection({ from: startPos + 1, to: endPos + 1 });

        // Apply the color
        editor.commands.setColor(color);

        // Deselect to show the highlighting
        editor.commands.setTextSelection(endPos + 1);

        console.log('[HIGHLIGHT] Text highlighted successfully:', text.substring(0, 50));
        return true;
    } catch (error) {
        console.error('[HIGHLIGHT] Error highlighting text:', error);
        return false;
    }
}

/**
 * Clear all blue highlighting from the editor
 */
function clearHighlightInEditor() {
    const editor = window.editors?.userInput;
    if (!editor) {
        return;
    }

    try {
        // Get the current JSON content to preserve structure
        const json = editor.getJSON();

        // Recursively remove blue color marks
        const removeBlueHighlight = (node) => {
            if (node.marks) {
                node.marks = node.marks.filter(mark => {
                    if (mark.type === 'textStyle' && mark.attrs?.color === '#3B82F6') {
                        return false; // Remove blue highlights
                    }
                    return true;
                });
            }
            if (node.content) {
                node.content.forEach(removeBlueHighlight);
            }
        };

        if (json.content) {
            json.content.forEach(removeBlueHighlight);
        }

        // Update the editor content
        editor.commands.setContent(json);

        console.log('[HIGHLIGHT] Cleared blue highlighting');
    } catch (error) {
        console.error('[HIGHLIGHT] Error clearing highlights:', error);
    }
}

/**
 * Scroll the specified text into view in the editor
 * @param {string} text - The text to scroll to
 * @returns {boolean} - True if scrolled successfully
 */
function scrollTextIntoView(text) {
    const editor = window.editors?.userInput;
    if (!editor) {
        console.warn('[SCROLL] Editor not available');
        return false;
    }

    try {
        const editorElement = document.getElementById('userInput');
        if (!editorElement) {
            return false;
        }

        const proseMirror = editorElement.querySelector('.ProseMirror');
        if (!proseMirror) {
            return false;
        }

        // Get all text nodes in the editor
        const walker = document.createTreeWalker(
            proseMirror,
            NodeFilter.SHOW_TEXT,
            null,
            false
        );

        let node;
        let foundNode = null;

        // Find the text node containing our text
        while (node = walker.nextNode()) {
            if (node.textContent.toLowerCase().includes(text.toLowerCase())) {
                foundNode = node;
                break;
            }
        }

        if (foundNode) {
            // Get the parent element to scroll to
            const parentElement = foundNode.parentElement;
            if (parentElement) {
                // Scroll with some padding
                parentElement.scrollIntoView({
                    behavior: 'smooth',
                    block: 'center',
                    inline: 'nearest'
                });

                console.log('[SCROLL] Scrolled text into view:', text.substring(0, 50));
                return true;
            }
        }

        console.warn('[SCROLL] Text not found for scrolling:', text);
        return false;
    } catch (error) {
        console.error('[SCROLL] Error scrolling text:', error);
        return false;
    }
}

// Helper functions for TipTap programmatic change tracking
function getUserInputContent() {
    const editor = window.editors?.userInput;
    if (editor && editor.getText) {
        return editor.getText();
    }
    return '';
}

function setUserInputContent(content, isProgrammatic = false, changeType = 'Content Update', replacements = null, isHtml = false) {
    const editor = window.editors?.userInput;

    if (!editor || !editor.commands) {
        console.error('[PROGRAMMATIC] TipTap editor not ready');
        return;
    }

    // Safe content handling for logging
    const safeContent = typeof content === 'string' ? content : (content?.toString() ?? '');

    // Log every programmatic change to console
    if (isProgrammatic) {
        console.log('═══════════════════════════════════════════════');
        console.log('[PROGRAMMATIC CHANGE]');
        console.log('Type:', changeType);
        console.log('Length:', safeContent.length, 'characters');
        console.log('Preview:', safeContent.substring(0, 150) + (safeContent.length > 150 ? '...' : ''));
        console.log('═══════════════════════════════════════════════');

        // Store the state BEFORE the change (for undo)
        const stateBeforeChange = editor.getJSON();

        // Only apply amber color for PII and Guideline Suggestions changes
        const shouldColor = changeType.includes('PII') || changeType.includes('Guideline Suggestions');

        if (isHtml) {
            // Directly set HTML content
            editor.commands.setContent(safeContent);
        } else if (shouldColor) {
            // Set content with amber color
            if (replacements && replacements.length > 0) {
                // Only color the specific replacements
                const html = applyColoredReplacements(safeContent, replacements);
                editor.commands.setContent(html);
            } else {
                // Color the entire content (for wholesale replacements like AI generation)
                editor.commands.setContent(`<p><span style="color: #D97706">${escapeHtml(safeContent).replace(/\n/g, '</span></p><p><span style="color: #D97706">')}</span></p>`);
            }

            window.hasColoredChanges = true;
            updateClearFormattingButton();
        } else {
            // Set content without coloring for other programmatic changes
            // Convert newlines to HTML - use <br> for single line breaks, <p> for paragraphs
            // First, normalize multiple consecutive blank lines into single blank lines
            const normalizedContent = safeContent.replace(/\n{3,}/g, '\n\n');

            // Split by double newlines (paragraph breaks) and single newlines (line breaks)
            const paragraphs = normalizedContent.split('\n\n');
            const htmlContent = paragraphs
                .filter(para => para.trim().length > 0)
                .map(para => {
                    // Within each paragraph, convert single newlines to <br>
                    const lines = para.split('\n').map(line => escapeHtml(line)).join('<br>');
                    return `<p>${lines}</p>`;
                })
                .join('');
            editor.commands.setContent(htmlContent);
        }

        // Store change in history AFTER applying the change
        // Store stateBeforeChange for undo, and we'll use the current state for redo
        window.programmaticChangeHistory.push({
            type: changeType,
            content: safeContent,
            timestamp: new Date(),
            editorState: editor.getJSON(), // State AFTER the change (for redo)
            editorStateBefore: stateBeforeChange // State BEFORE the change (for undo)
        });
        window.currentChangeIndex = window.programmaticChangeHistory.length - 1;

        // Update undo/redo button states
        updateUndoRedoButtons();
    } else {
        if (isHtml) {
            editor.commands.setContent(safeContent);
        } else {
            // Regular content update without coloring
            // Convert newlines to HTML - use <br> for single line breaks, <p> for paragraphs
            // First, normalize multiple consecutive blank lines into single blank lines
            const normalizedContent = safeContent.replace(/\n{3,}/g, '\n\n');

            // Split by double newlines (paragraph breaks) and single newlines (line breaks)
            const paragraphs = normalizedContent.split('\n\n');
            const htmlContent = paragraphs
                .filter(para => para.trim().length > 0)
                .map(para => {
                    // Within each paragraph, convert single newlines to <br>
                    const lines = para.split('\n').map(line => escapeHtml(line)).join('<br>');
                    return `<p>${lines}</p>`;
                })
                .join('');
            editor.commands.setContent(htmlContent);
        }
    }

    // Manually update Analyse/Reset button visibility after programmatic content changes
    const hasContent = safeContent.trim().length > 0;
    updateAnalyseAndResetButtons(hasContent);

    // Update button visibility after content is set (with small delay to ensure TipTap has processed)
    setTimeout(() => {
        updateChatbotButtonVisibility();
    }, 100);
}

function updateClearFormattingButton() {
    const btn = document.getElementById('clearFormattingBtn');
    if (btn) {
        btn.style.display = window.hasColoredChanges ? 'inline-block' : 'none';
        console.log('[DEBUG] Clear formatting button visibility:', btn.style.display);
    }
}

// Function to display relevant guidelines in the summary
function displayRelevantGuidelines(categories) {
    if (!categories || typeof categories !== 'object') {
        console.error('[DEBUG] Invalid categories data:', categories);
        return;
    }

    // Helper function to extract numeric relevance score from descriptive format
    function extractRelevanceScore(relevanceText) {
        if (typeof relevanceText === 'number') {
            return relevanceText; // Already numeric
        }

        // Extract score from formats like "high relevance (score 0.8-1.0)" or "0.85"
        const match = relevanceText.match(/score\s+([\d.]+)(?:-[\d.]+)?|^([\d.]+)$/);
        if (match) {
            return parseFloat(match[1] || match[2]);
        }

        // Fallback based on text description
        const text = relevanceText.toLowerCase();
        if (text.includes('high') || text.includes('most')) return 0.9;
        if (text.includes('medium') || text.includes('potentially')) return 0.65;
        if (text.includes('low') || text.includes('less')) return 0.35;
        if (text.includes('not') || text.includes('irrelevant')) return 0.1;

        return 0.5; // Default fallback
    }

    // Store ALL relevant guidelines (exclude notRelevant) globally
    const allRelevantGuidelines = [
        ...(categories.mostRelevant || []).map(g => ({ ...g, category: 'mostRelevant' })),
        ...(categories.potentiallyRelevant || []).map(g => ({ ...g, category: 'potentiallyRelevant' })),
        ...(categories.lessRelevant || []).map(g => ({ ...g, category: 'lessRelevant' }))
        // Exclude notRelevant as they're truly not applicable for checking
    ];

    window.relevantGuidelines = allRelevantGuidelines.map(g => ({
        id: g.id, // Use clean document ID only
        title: g.title,
        filename: g.filename || g.title, // Keep both for compatibility
        originalFilename: g.originalFilename || g.title, // Preserve original filename if available
        downloadUrl: g.downloadUrl, // Preserve downloadUrl if available
        relevance: extractRelevanceScore(g.relevance), // Convert to numeric score
        category: g.category,
        originalRelevance: g.relevance, // Keep original for display purposes
        organisation: g.organisation // Preserve organisation for display
    }));

    // Enhanced logging to verify storage
    // console.log('[DEBUG] Stored relevant guidelines:', {
    //     total: window.relevantGuidelines.length,
    //     byCategory: {
    //         mostRelevant: window.relevantGuidelines.filter(g => g.category === 'mostRelevant').length,
    //         potentiallyRelevant: window.relevantGuidelines.filter(g => g.category === 'potentiallyRelevant').length,
    //         lessRelevant: window.relevantGuidelines.filter(g => g.category === 'lessRelevant').length
    //     },
    //     samples: window.relevantGuidelines.slice(0, 3).map(g => ({
    //         id: g.id, // Use the mapped 'id' property
    //         title: g.title.substring(0, 50) + '...',
    //         score: g.relevance,
    //         category: g.category
    //     }))
    // });

    let formattedGuidelines = '';

    // Helper function to create PDF download link
    function createPdfDownloadLink(guideline) {
        if (!guideline) {
            // console.warn('[DEBUG] No guideline provided to createPdfDownloadLink');
            return '';
        }

        // Get full guideline data from globalGuidelines if available (has downloadUrl/originalFilename)
        const fullGuidelineData = window.globalGuidelines?.[guideline.id];
        const guidelineToUse = fullGuidelineData || guideline;

        // Only use downloadUrl field if available
        let downloadUrl;
        if (guidelineToUse.downloadUrl) {
            downloadUrl = guidelineToUse.downloadUrl;
            // console.log('[DEBUG] Using stored downloadUrl:', downloadUrl);
        } else if (guidelineToUse.originalFilename) {
            // Use original filename if available
            const encodedFilename = encodeURIComponent(guidelineToUse.originalFilename);
            downloadUrl = `https://github.com/iannouvel/clerky/raw/main/guidance/${encodedFilename}`;
            // console.log('[DEBUG] Constructed downloadUrl from originalFilename:', downloadUrl);
        } else {
            // No reliable download information available - don't show a link
            const displayTitle = guidelineToUse.displayName || guidelineToUse.humanFriendlyName || guidelineToUse.title || guidelineToUse.id;
            console.warn('[PDF-LINK] Missing PDF download link for guideline:', {
                id: guideline.id,
                title: displayTitle,
                hasDownloadUrl: !!guidelineToUse.downloadUrl,
                hasOriginalFilename: !!guidelineToUse.originalFilename,
                hasFilename: !!guidelineToUse.filename,
                checkedGlobalGuidelines: !!fullGuidelineData,
                allAvailableFields: Object.keys(guidelineToUse)
            });
            return '';
        }

        // console.log('[DEBUG] Created PDF download link:', {
        //     guidelineId: guideline.id,
        //     guidelineTitle: guideline.title,
        //     downloadUrl: downloadUrl
        // });

        return `<a href="${downloadUrl}" target="_blank" title="Download PDF" class="pdf-download-link">📄</a>`;
    }

    // Generate HTML instead of markdown to properly handle the PDF links
    let htmlContent = '';

    // Add Most Relevant Guidelines
    if (categories.mostRelevant && categories.mostRelevant.length > 0) {
        htmlContent += '<h2>Most Relevant Guidelines</h2><ul>';
        categories.mostRelevant.forEach(g => {
            const pdfLink = createPdfDownloadLink(g);
            // Use clean display title helper
            const guidelineData = window.globalGuidelines?.[g.id];
            const displayTitle = getCleanDisplayTitle(g, guidelineData);
            // Use organisation if available, otherwise fall back to hospitalTrust
            const org = g.organisation || g.hospitalTrust || guidelineData?.organisation || guidelineData?.hospitalTrust || null;
            const orgDisplay = org ? ` - ${abbreviateOrganization(org)}` : '';
            htmlContent += `<li>${displayTitle}${orgDisplay} (${g.relevance}) ${pdfLink}</li>`;
        });
        htmlContent += '</ul>';
    }

    // Add Potentially Relevant Guidelines
    if (categories.potentiallyRelevant && categories.potentiallyRelevant.length > 0) {
        htmlContent += '<h2>Potentially Relevant Guidelines</h2><ul>';
        categories.potentiallyRelevant.forEach(g => {
            const pdfLink = createPdfDownloadLink(g);
            // Use clean display title helper
            const guidelineData = window.globalGuidelines?.[g.id];
            const displayTitle = getCleanDisplayTitle(g, guidelineData);
            // Use organisation if available, otherwise fall back to hospitalTrust
            const org = g.organisation || g.hospitalTrust || guidelineData?.organisation || guidelineData?.hospitalTrust || null;
            const orgDisplay = org ? ` - ${abbreviateOrganization(org)}` : '';
            htmlContent += `<li>${displayTitle}${orgDisplay} (${g.relevance}) ${pdfLink}</li>`;
        });
        htmlContent += '</ul>';
    }

    // Add Less Relevant Guidelines
    if (categories.lessRelevant && categories.lessRelevant.length > 0) {
        htmlContent += '<h2>Less Relevant Guidelines</h2><ul>';
        categories.lessRelevant.forEach(g => {
            const pdfLink = createPdfDownloadLink(g);
            // Use clean display title helper
            const guidelineData = window.globalGuidelines?.[g.id];
            const displayTitle = getCleanDisplayTitle(g, guidelineData);
            // Use organisation if available, otherwise fall back to hospitalTrust
            const org = g.organisation || g.hospitalTrust || guidelineData?.organisation || guidelineData?.hospitalTrust || null;
            const orgDisplay = org ? ` - ${abbreviateOrganization(org)}` : '';
            htmlContent += `<li>${displayTitle}${orgDisplay} (${g.relevance}) ${pdfLink}</li>`;
        });
        htmlContent += '</ul>';
    }

    // Add Not Relevant Guidelines
    if (categories.notRelevant && categories.notRelevant.length > 0) {
        htmlContent += '<h2>Not Relevant Guidelines</h2><ul>';
        categories.notRelevant.forEach(g => {
            const pdfLink = createPdfDownloadLink(g);
            // Use clean display title helper
            const guidelineData = window.globalGuidelines?.[g.id];
            const displayTitle = getCleanDisplayTitle(g, guidelineData);
            // Use organisation if available, otherwise fall back to hospitalTrust
            const org = g.organisation || g.hospitalTrust || guidelineData?.organisation || guidelineData?.hospitalTrust || null;
            const orgDisplay = org ? ` - ${abbreviateOrganization(org)}` : '';
            htmlContent += `<li>${displayTitle}${orgDisplay} (${g.relevance}) ${pdfLink}</li>`;
        });
        htmlContent += '</ul>';
    }

    formattedGuidelines = htmlContent;

    // Create and display the new guideline selection interface
    createGuidelineSelectionInterface(categories, allRelevantGuidelines);
}

// Central helper to manage Analyse/Reset button visibility and state
function updateAnalyseAndResetButtons(hasContent) {
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

// Expose helper globally so inline scripts (e.g. TipTap initialiser in index.html) can use it
window.updateAnalyseAndResetButtons = updateAnalyseAndResetButtons;

// Helper function to get a clean display title for a guideline
function getCleanDisplayTitle(g, guidelineData) {
    const gId = g?.id || 'unknown';

    // *** DEBUG: Log input parameters ***
    console.log(`[DISPLAY DEBUG] getCleanDisplayTitle for: ${gId}`, {
        g_displayName: g?.displayName,
        guidelineData_displayName: guidelineData?.displayName,
        g_humanFriendlyName: g?.humanFriendlyName,
        guidelineData_humanFriendlyName: guidelineData?.humanFriendlyName,
        g_title: g?.title,
        guidelineData_title: guidelineData?.title
    });

    // Guardrail: Never trust displayName if it looks like an AI reasoning dump / markdown block
    function normaliseGuidelineDisplayName(value) {
        if (!value || typeof value !== 'string') return null;
        return value.replace(/\s+/g, ' ').trim();
    }

    function isSafeGuidelineDisplayName(value) {
        if (!value || typeof value !== 'string') return false;

        // Hard limits to prevent rendering “garbage” blobs
        if (value.length > 220) return false;
        if (/[<>]/.test(value)) return false; // avoid accidental HTML-ish content
        if (/[\r\n]/.test(value)) return false;

        const lower = value.toLowerCase();
        if (lower.includes('reasoning summary')) return false;
        if (lower.includes('final display name')) return false;
        if (value.includes('```')) return false;
        if (value.includes('**')) return false;
        if (value.includes('•')) return false;

        return true;
    }

    // If displayName exists, use it directly (it should already be in the correct format: humanFriendlyName + organisation/hospitalTrust)
    // Check g.displayName first since g is the enriched object that should have displayName from localData
    if (g?.displayName) {
        const candidate = normaliseGuidelineDisplayName(g.displayName);
        if (candidate && isSafeGuidelineDisplayName(candidate)) {
            console.log(`[DISPLAY DEBUG] → Using g.displayName: "${candidate}"`);
            return candidate;
        }
        console.warn(`[DISPLAY DEBUG] → Ignoring suspicious g.displayName for ${gId}`);
    }
    if (guidelineData?.displayName) {
        const candidate = normaliseGuidelineDisplayName(guidelineData.displayName);
        if (candidate && isSafeGuidelineDisplayName(candidate)) {
            console.log(`[DISPLAY DEBUG] → Using guidelineData.displayName: "${candidate}"`);
            return candidate;
        }
        console.warn(`[DISPLAY DEBUG] → Ignoring suspicious guidelineData.displayName for ${gId}`);
    }

    console.log(`[DISPLAY DEBUG] → No displayName found, using fallback chain`);

    // Fallback: Get the best available title, preferring humanFriendlyName over title
    let rawTitle = guidelineData?.humanFriendlyName ||
        g?.humanFriendlyName ||
        guidelineData?.title ||
        g?.title ||
        g?.id;

    // Strip ALL scope/trust/Unknown patterns from the title (only if displayName doesn't exist)
    if (rawTitle && typeof rawTitle === 'string') {
        // Remove patterns like " - Local - UHSussex - Unknown"
        rawTitle = rawTitle.replace(/\s*-\s*Local\s*-\s*[^-]+\s*-\s*Unknown\s*/gi, '');
        // Remove patterns like " - National - Unknown"
        rawTitle = rawTitle.replace(/\s*-\s*National\s*-\s*Unknown\s*/gi, '');
        // Remove patterns like " - Local - [trust name]"
        rawTitle = rawTitle.replace(/\s*-\s*Local\s*-\s*[^-]+\s*/gi, '');
        // Remove patterns like " - National - [org name]"
        rawTitle = rawTitle.replace(/\s*-\s*National\s*-\s*[^-]+\s*/gi, '');
        // Remove any remaining " - Unknown"
        rawTitle = rawTitle.replace(/\s*-\s*Unknown\s*/gi, '');
        // Remove any standalone "Unknown" (not part of a word)
        rawTitle = rawTitle.replace(/\bUnknown\b/gi, '').trim();
        // Clean up any double spaces or trailing dashes
        rawTitle = rawTitle.replace(/\s+/g, ' ').replace(/\s*-\s*$/, '').trim();
    }

    // If title is just an ID (like "052" or "052-pdf"), try to construct a better name
    if (rawTitle && (rawTitle.match(/^[\d-]+(\.pdf)?$/i) || rawTitle.length < 5)) {
        // Try to get a better name from humanFriendlyName or construct from ID
        const betterName = guidelineData?.humanFriendlyName ||
            g?.humanFriendlyName ||
            guidelineData?.title ||
            g?.title;

        if (betterName && betterName !== rawTitle && !betterName.includes('Unknown')) {
            rawTitle = betterName;
            // Strip patterns again from the better name
            rawTitle = rawTitle.replace(/\s*-\s*Local\s*-\s*[^-]+\s*-\s*Unknown\s*/gi, '');
            rawTitle = rawTitle.replace(/\s*-\s*National\s*-\s*Unknown\s*/gi, '');
            rawTitle = rawTitle.replace(/\s*-\s*Local\s*-\s*[^-]+\s*/gi, '');
            rawTitle = rawTitle.replace(/\s*-\s*National\s*-\s*[^-]+\s*/gi, '');
            rawTitle = rawTitle.replace(/\s*-\s*Unknown\s*/gi, '');
            rawTitle = rawTitle.replace(/\bUnknown\b/gi, '').trim();
            rawTitle = rawTitle.replace(/\s+/g, ' ').replace(/\s*-\s*$/, '').trim();
        } else {
            // Construct a name from the ID (e.g., "052-pdf" -> "Guideline 052")
            const idPart = (g?.id || '').replace(/[-_]/g, ' ').replace(/\.pdf$/i, '').trim();
            rawTitle = `Guideline ${idPart}`;
        }
    }

    const finalResult = rawTitle || g?.id;
    console.log(`[DISPLAY DEBUG] → Final result for ${gId}: "${finalResult}"`);
    return finalResult;
}

// New function to create guideline selection interface with checkboxes
// Displays a flat list sorted by similarity score (highest first), with only top guideline pre-selected
function createGuidelineSelectionInterface(categories, allRelevantGuidelines) {
    console.log('[DEBUG] createGuidelineSelectionInterface called with:', {
        categories: categories,
        allRelevantGuidelinesLength: allRelevantGuidelines?.length || 0
    });

    // Check parallel preference to adjust UI accordingly
    const isParallelMode = typeof loadParallelAnalysisPreference === 'function' && loadParallelAnalysisPreference();

    // Helper function to extract numeric relevance score (redefined for scope)
    function extractRelevanceScoreLocal(relevanceText) {
        if (typeof relevanceText === 'number') {
            return relevanceText; // Already numeric
        }

        // Extract score from formats like "high relevance (score 0.8-1.0)" or "0.85"
        const match = relevanceText.match(/score\s+([\d.]+)(?:-[\d.]+)?|^([\d.]+)$/);
        if (match) {
            return parseFloat(match[1] || match[2]);
        }

        // Fallback based on text description
        const text = relevanceText.toLowerCase();
        if (text.includes('high') || text.includes('most')) return 0.9;
        if (text.includes('medium') || text.includes('potentially')) return 0.65;
        if (text.includes('low') || text.includes('less')) return 0.35;
        if (text.includes('not') || text.includes('irrelevant')) return 0.1;

        return 0.5; // Default fallback
    }

    // Combine ALL relevant guidelines (exclude notRelevant)
    const allGuidelinesFlat = [
        ...(categories.mostRelevant || []),
        ...(categories.potentiallyRelevant || []),
        ...(categories.lessRelevant || [])
        // Exclude notRelevant from the selection interface entirely
    ];

    // Sort by relevance score descending (highest first)
    allGuidelinesFlat.sort((a, b) => {
        const scoreA = extractRelevanceScoreLocal(a.relevance);
        const scoreB = extractRelevanceScoreLocal(b.relevance);
        return scoreB - scoreA;
    });

    // Store all guidelines globally for processing
    window.relevantGuidelines = allGuidelinesFlat.map(g => ({
        id: g.id, // Use clean document ID only
        title: g.title,
        filename: g.filename || g.title, // Keep both for compatibility
        originalFilename: g.originalFilename || g.title, // Preserve original filename if available
        downloadUrl: g.downloadUrl, // Preserve downloadUrl if available
        relevance: extractRelevanceScoreLocal(g.relevance), // Convert to numeric score
        originalRelevance: g.relevance, // Keep original for display purposes
        organisation: g.organisation // Preserve organisation for display
    }));

    console.log('[DEBUG] Set window.relevantGuidelines (flat list):', {
        total: window.relevantGuidelines.length,
        topScore: window.relevantGuidelines[0]?.relevance,
        bottomScore: window.relevantGuidelines[window.relevantGuidelines.length - 1]?.relevance
    });

    // Helper function to create PDF viewer link
    function createPdfViewerLink(guideline) {
        if (!guideline || !guideline.id) return '';

        // Create link data for viewer (no context/verbatim quote for selection interface)
        const linkData = {
            guidelineId: guideline.id,
            searchText: null // No search text for selection interface
        };

        // Create a simple, direct link with text (emojis get stripped by DOM processing)
        return `<a href="#" data-link-data='${JSON.stringify(linkData)}' class="guideline-link guideline-pdf-link" rel="noopener noreferrer" title="View PDF" style="text-decoration: none; cursor: pointer; color: var(--text-primary); font-size: 0.9em; margin-left: 10px !important; display: inline-block; width: auto; flex-shrink: 0;">[PDF]</a>`;
    }

    // Helper function to format relevance score
    function formatRelevanceScore(relevanceValue) {
        console.log('[DEBUG] formatRelevanceScore called with:', {
            value: relevanceValue,
            type: typeof relevanceValue
        });

        // If it's already a number, format it nicely
        if (typeof relevanceValue === 'number') {
            const percentage = Math.round(relevanceValue * 100);
            return `${percentage}%`;
        }

        // If it's a string, extract numeric score
        if (typeof relevanceValue === 'string') {
            const numericScore = extractRelevanceScoreLocal(relevanceValue);
            const percentage = Math.round(numericScore * 100);
            console.log('[DEBUG] Extracted score:', {
                original: relevanceValue,
                numeric: numericScore,
                percentage: percentage
            });
            return `${percentage}%`;
        }

        // Fallback for unexpected types
        console.warn('[DEBUG] Unexpected relevance value type:', typeof relevanceValue, relevanceValue);
        return '50%';
    }

    // Create the new guideline selection interface - flat list sorted by similarity score
    const headerTitle = isParallelMode
        ? '📋 Guidelines Identified for Analysis'
        : '📋 Select Guidelines for Guideline Suggestions';

    const headerDesc = isParallelMode
        ? 'The following guidelines have been identified and will be analyzed automatically.'
        : 'Select guidelines to check against. Only likely relevant guidelines are pre-selected.';

    let htmlContent = `
        <div class="guideline-selection-interface">
            <div class="selection-header">
                <h2>${headerTitle}</h2>
                <p>${headerDesc}</p>
            </div>
    `;

    // Display all guidelines in a single flat list, sorted by score (already sorted above)
    if (allGuidelinesFlat.length > 0) {
        htmlContent += '<div class="guidelines-list">';
        allGuidelinesFlat.forEach((g, index) => {
            const pdfLink = createPdfViewerLink(g);
            // Use clean display title helper
            const guidelineData = window.globalGuidelines?.[g.id];

            const displayTitle = getCleanDisplayTitle(g, guidelineData);
            // If displayName exists, it already includes organisation/hospitalTrust, so don't add it again
            const hasDisplayName = guidelineData?.displayName || g.displayName;
            let orgDisplay = '';
            if (!hasDisplayName) {
                const org = g.organisation || g.hospitalTrust || guidelineData?.organisation || guidelineData?.hospitalTrust || null;
                orgDisplay = org ? ` - ${abbreviateOrganization(org)}` : '';
            }
            // Include PDF link if available
            const pdfLinkHtml = pdfLink || '';

            // Pre-check only Most Relevant and Potentially Relevant guidelines (score >= 0.6)
            // Less Relevant (score < 0.6) are unchecked by default
            const numericScore = extractRelevanceScoreLocal(g.relevance);
            const shouldBeChecked = numericScore >= 0.6;
            const isChecked = shouldBeChecked ? 'checked="checked"' : '';

            // Conditional checkbox rendering
            const checkboxHtml = isParallelMode
                ? '' // No checkbox in parallel mode
                : `<input type="checkbox" 
                       class="guideline-checkbox" 
                       data-guideline-id="${g.id}" 
                       style="margin-right: 4px;"
                       ${isChecked}>`;

            const labelStyle = isParallelMode ? 'cursor: default;' : 'cursor: pointer;';

            htmlContent += `
                <div class="guideline-item">
                    <label class="guideline-checkbox-label" style="${labelStyle}">
                        ${checkboxHtml}
                        <div class="guideline-info">
                            <div class="guideline-content">
                                <span class="guideline-title">${displayTitle}${orgDisplay}</span>
                                <span style="font-size: 0.8em; color: #666; margin-left: 8px;">(${formatRelevanceScore(g.relevance)})</span>
                                ${pdfLinkHtml}
                            </div>
                        </div>
                    </label>
                </div>
            `;
        });
        htmlContent += '</div>';
    }

    htmlContent += `
        </div>
        
        <style>
        .guideline-selection-interface {
            background: var(--bg-secondary);
            border: 1px solid var(--border-color);
            border-radius: 8px;
            padding: 20px;
            margin: 20px 0;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            /* Keep the whole guideline interface within the visible summary pane */
            max-height: min(60vh, 600px);
            overflow-y: auto;
            overflow-x: hidden;
            box-sizing: border-box;
        }
        
        .selection-header h2 {
            margin: 0 0 10px 0;
            color: var(--text-primary);
            font-size: 1.3em;
        }
        
        .selection-header p {
            margin: 0 0 15px 0;
            color: var(--text-secondary);
            line-height: 1.5;
        }
        
        .guideline-category {
            margin: 20px 0;
        }
        
        .guideline-category h3 {
            margin: 0 0 10px 0;
            color: var(--text-primary);
            font-size: 1.1em;
            border-bottom: 1px solid #dee2e6;
            padding-bottom: 5px;
        }
        
        .guidelines-list {
            border: 1px solid #ddd;
            border-radius: 4px;
            background: var(--bg-secondary);
        }
        
        .guideline-item {
            border-bottom: 1px solid #eee;
            transition: background 0.2s;
        }
        
        .guideline-item:hover {
            background: var(--bg-tertiary);
        }
        
        .guideline-item:last-child {
            border-bottom: none;
        }
        
        .guideline-checkbox-label {
            display: flex;
            align-items: center;
            padding: 12px 15px 12px 15px;
            cursor: pointer;
            width: 100%;
            box-sizing: border-box;
            overflow: hidden;
        }
        
        .guideline-checkbox {
            margin-right: 4px !important;
            width: 18px;
            height: 18px;
            cursor: pointer;
            flex-shrink: 0;
        }
        
        .guideline-info {
            flex: 1;
            min-width: 0;
            overflow: hidden;
            margin-left: 8px !important;
        }
        
        .guideline-title {
            font-weight: 500;
            color: var(--text-primary);
            line-height: 1.3;
            min-width: 0;
            word-wrap: break-word;
            overflow-wrap: break-word;
            margin: 0;
            padding: 0;
            vertical-align: baseline;
        }
        
        .guideline-content {
            display: flex;
            flex-wrap: wrap;
            align-items: baseline;
            gap: 0;
            min-width: 0;
            width: 100%;
            max-width: 100%;
        }
        
        .guideline-selection-interface .pdf-download-link {
            text-decoration: none !important;
            color: #dc3545 !important;
            font-size: 1.1em;
            background: none !important;
            padding: 0 !important;
            margin: 0 !important;
            border: none !important;
            box-shadow: none !important;
            border-radius: 0 !important;
            display: inline-block !important;
            width: auto !important;
            height: auto !important;
            flex-shrink: 0;
            white-space: nowrap;
            min-width: 0;
        }
        
        .guideline-selection-interface .pdf-download-link:empty {
            display: none;
        }
        
        .pdf-download-link-placeholder {
            visibility: hidden;
            width: 0;
            min-width: 0;
            flex-shrink: 0;
        }
        
        .selection-info {
            background: #e3f2fd;
            padding: 12px;
            border-radius: 4px;
            margin-top: 20px;
            font-size: 0.9em;
            color: #1976d2;
        }
        </style>
    `;

    htmlContent += `</div>`; // Close the main container div

    // Append the generated HTML to the summary view - PERMANENT so it stays visible
    appendToSummary1(htmlContent, false, false); // Permanent - stays until user processes guidelines

    // Show the selection buttons in the button container (only in manual mode)
    if (!isParallelMode) {
        showSelectionButtons();
    }

    // Apply spacing styles via JavaScript (CSS gets overridden by #summary1 * reset)
    setTimeout(() => {
        document.querySelectorAll('.guideline-checkbox').forEach(el => el.style.cssText += 'margin-right: 4px !important;');
        document.querySelectorAll('.guideline-info').forEach(el => el.style.cssText += 'margin-left: 4px !important;');
        document.querySelectorAll('.guideline-pdf-link').forEach(el => el.style.setProperty('margin-left', '10px', 'important'));
    }, 50);
}

// Function to update the process button text based on selected guideline count
function updateProcessButtonText() {
    const checkedCheckboxes = document.querySelectorAll('.guideline-checkbox:checked');
    const count = checkedCheckboxes.length;
    const processBtn = document.querySelector('.process-selected-btn');

    if (processBtn) {
        const btnText = processBtn.querySelector('.btn-text');
        const isSingular = count === 1;

        if (btnText) {
            btnText.textContent = isSingular ? 'Process Selected Guideline' : 'Process Selected Guidelines';
        }

        // Update title attribute as well
        processBtn.title = isSingular ? 'Process selected guideline' : 'Process selected guidelines';
    }
}

// Function to show update messages to the user in the fixed button row
function updateUser(message, isLoading = false) {
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
            statusEl.style.display = 'none';
            statusEl.textContent = '';
            return;
        }
    }

    if (message) {
        // When loading, show spinner + message; otherwise just text
        if (isLoading) {
            statusEl.innerHTML = `<span class="spinner-small"></span><span style="margin-left: 6px;">${message}</span>`;
        } else {
            statusEl.textContent = message;
        }

        statusEl.style.display = 'flex';

        // Auto-hide non-loading messages after a short delay
        if (!isLoading) {
            const currentMessage = statusEl.textContent;
            setTimeout(() => {
                // Only hide if nothing has changed since we scheduled the hide
                if (statusEl.textContent === currentMessage) {
                    statusEl.style.display = 'none';
                    statusEl.textContent = '';
                }
            }, 5000);
        }
    } else {
        // Explicit clear
        statusEl.style.display = 'none';
        statusEl.textContent = '';
    }
}

// Function to show selection buttons in the fixed button row
function showSelectionButtons() {
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
    updateProcessButtonText();

    // Use event delegation on document to handle checkbox changes (works for dynamically created checkboxes)
    // Remove any existing listener first to avoid duplicates
    if (window.guidelineCheckboxChangeHandler) {
        document.removeEventListener('change', window.guidelineCheckboxChangeHandler);
    }

    // Create and store the handler function
    window.guidelineCheckboxChangeHandler = function (event) {
        if (event.target && event.target.classList.contains('guideline-checkbox')) {
            updateProcessButtonText();
        }
    };

    // Add event listener using delegation
    document.addEventListener('change', window.guidelineCheckboxChangeHandler);

    console.log('[DEBUG] Selection buttons added to fixed button row', buttonsGroup);
}

// Function to hide selection buttons from the button container
function hideSelectionButtons() {
    const buttonsGroup = document.getElementById('selectionButtonsGroup') || document.querySelector('.selection-buttons-group');
    if (buttonsGroup) {
        buttonsGroup.remove();
        console.log('[DEBUG] Selection buttons removed from button container');
    }
}

// Global reset handler - clears input, summary, and action UIs when idle
function handleGlobalReset() {
    console.log('[DEBUG] Reset button clicked');

    // Stop any active analysis/workflow
    if (window.analysisAbortController) {
        console.log('[DEBUG] Aborting active analysis');
        window.analysisAbortController.abort();
        window.analysisAbortController = null;
    }
    // Immediately reset Analyse button progress UI if helper is available
    if (typeof updateAnalyseButtonProgress === 'function') {
        // No args → reset to default idle state ('Analyse', no spinner)
        updateAnalyseButtonProgress();
    }

    // Clear user input (TipTap editor)
    const editor = window.editors?.userInput;
    if (editor) {
        editor.commands.setContent('');
    }

    // Clear summary content (except loading spinner)
    const summary1 = document.getElementById('summary1');
    const loadingSpinner = document.getElementById('summaryLoadingSpinner');
    if (summary1) {
        Array.from(summary1.children).forEach(child => {
            if (!loadingSpinner || child !== loadingSpinner) {
                summary1.removeChild(child);
            }
        });
    }

    // Remove any injected clinical issues panel
    const clinicalPanel = document.getElementById('clinicalIssuesPanel');
    if (clinicalPanel && clinicalPanel.parentNode) {
        clinicalPanel.parentNode.removeChild(clinicalPanel);
    }

    // Hide any clerking or guideline selection buttons
    const clerkingButtonsGroup = document.getElementById('clerkingButtonsGroup');
    if (clerkingButtonsGroup) {
        clerkingButtonsGroup.style.display = 'none';
    }
    hideSelectionButtons();

    // Reset any suggestion-review buttons and state in the fixed button row
    if (typeof updateSuggestionActionButtons === 'function') {
        // Clear current review state so helper hides the suggestion group
        window.currentSuggestionReview = null;
        updateSuggestionActionButtons();
    } else {
        const suggestionActionsGroup = document.getElementById('suggestionActionsGroup');
        if (suggestionActionsGroup) {
            suggestionActionsGroup.style.display = 'none';
        }
    }

    // Cancel any active PII review and hide its buttons
    if (typeof window.cancelPIIReview === 'function') {
        window.cancelPIIReview();
    } else {
        const piiActionsGroup = document.getElementById('piiActionsGroup');
        if (piiActionsGroup) {
            piiActionsGroup.style.display = 'none';
        }
    }

    // Clear server status message in the fixed button row
    const serverStatusMessage = document.getElementById('serverStatusMessage');
    if (serverStatusMessage) {
        serverStatusMessage.style.display = 'none';
        serverStatusMessage.textContent = '';
    }

    // Clear any multi-guideline selection state if helper is available
    if (typeof window.clearMultiGuidelineState === 'function') {
        window.clearMultiGuidelineState();
    }

    // Clear proforma inputs (both obstetric and gynaecology)
    const proformaInputs = document.querySelectorAll('.proforma-input');
    proformaInputs.forEach(input => {
        if (input.tagName === 'INPUT' || input.tagName === 'TEXTAREA') {
            input.value = '';
        } else if (input.tagName === 'SELECT') {
            input.selectedIndex = 0;
        }
    });

    // Clear transient messages and hide summary section if now empty
    if (typeof removeTransientMessages === 'function') {
        removeTransientMessages();
    }
    updateSummaryVisibility();

    // Reset processing flags and sequential state after UI has been cleared
    window.workflowInProgress = false;
    window.sequentialProcessingActive = false;
    window.isAnalysisRunning = false;
    window.sequentialProcessingQueue = [];
    window.sequentialProcessingIndex = 0;

    // Update analyse/reset button state based on cleared content
    const hasContent = !!window.editors?.userInput?.getText()?.trim().length;
    updateAnalyseAndResetButtons(hasContent);

    console.log('[DEBUG] Global reset completed');
}

function createGuidelineElement(guideline) {
    const div = document.createElement('div');
    div.className = 'guideline-item';
    div.innerHTML = `
                            <h4>${guideline.humanFriendlyTitle || guideline.title}</h4>
        <p>Relevance: ${(guideline.relevance * 100).toFixed(1)}%</p>
        <button onclick="checkAgainstGuidelines('${guideline.id}')">Check Against This Guideline</button>
    `;
    return div;
}

// Application state flags
let isInitialized = false;
let clinicalIssuesLoaded = false;
let guidanceDataLoaded = false;

// Clinical data storage
let clinicalIssues = {
    obstetrics: [],
    gynaecology: []
};
let AIGeneratedListOfIssues = [];
let guidelinesForEachIssue = [];

// File and content storage
let filenames = [];
let summaries = [];

// Global data storage
let globalGuidelines = null;
let globalPrompts = null;

// Chat History State
let chatHistory = [];
let currentChatId = null;

// Add session management
let currentSessionId = null;

// Global variables for guideline suggestions
let currentAdviceSession = null;
let currentSuggestions = [];
let userDecisions = {};

// Initialize marked library
function initializeMarked() {
    console.log('Starting marked library initialization...');
    return new Promise((resolve, reject) => {
        if (window.marked) {
            console.log('Marked library already loaded');
            resolve();
            return;
        }

        console.log('Creating marked script element...');
        const markedScript = document.createElement('script');
        markedScript.src = 'https://cdn.jsdelivr.net/npm/marked/marked.min.js';
        markedScript.onload = function () {
            console.log('Marked script loaded successfully');
            window.marked = marked;
            console.log('Marked library initialized');
            resolve();
        };
        markedScript.onerror = function (error) {
            console.error('Error loading marked library:', error);
            reject(error);
        };
        console.log('Appending marked script to document head...');
        document.head.appendChild(markedScript);
    });
}

// Make loadClinicalIssues available globally
window.loadClinicalIssues = async function () {
    console.log('Starting loadClinicalIssues...');
    if (clinicalIssuesLoaded) {
        console.log('Clinical issues already loaded');
        return;
    }

    try {
        console.log('Fetching clinical_issues.json...');
        const response = await fetch('clinical_issues.json');
        console.log('Fetch response status:', response.status);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        console.log('Parsing JSON response...');
        const data = await response.json();
        console.log('Clinical issues data loaded:', data);
        clinicalIssues = data;
        clinicalIssuesLoaded = true;
        console.log('Clinical issues loaded successfully');
    } catch (error) {
        console.error('Error loading clinical issues:', error);
        throw error;
    }
};

// Show main content
function showMainContent() {
    console.log('Starting showMainContent...');
    const loading = document.getElementById('loading');
    const landingPage = document.getElementById('landingPage');
    const mainContent = document.getElementById('mainContent');

    console.log('Elements found:', {
        loading: !!loading,
        landingPage: !!landingPage,
        mainContent: !!mainContent
    });

    if (loading) {
        console.log('Hiding loading screen...');
        loading.classList.add('hidden');
    }
    if (landingPage) {
        console.log('Hiding landing page...');
        landingPage.classList.add('hidden');
    }
    if (mainContent) {
        console.log('Showing main content...');
        mainContent.classList.remove('hidden');
    }
}

// Helper to sync guidelines in batches to avoid timeout
async function syncGuidelinesInBatches(idToken, batchSize = 3, maxBatches = 20) {
    console.log(`[BATCH_SYNC] Starting batch sync with batchSize=${batchSize}, maxBatches=${maxBatches}`);

    let totalProcessed = 0;
    let totalSucceeded = 0;
    let totalFailed = 0;
    let batchCount = 0;
    let remaining = 1; // Start with 1 to enter the loop

    try {
        while (remaining > 0 && batchCount < maxBatches) {
            batchCount++;
            console.log(`[BATCH_SYNC] Starting batch ${batchCount}...`);

            const response = await fetch(`${window.SERVER_URL}/syncGuidelinesBatch`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${idToken}`
                },
                body: JSON.stringify({ batchSize })
            });

            if (!response.ok) {
                console.error(`[BATCH_SYNC] Batch ${batchCount} failed with status ${response.status}`);
                break;
            }

            const result = await response.json();
            console.log(`[BATCH_SYNC] Batch ${batchCount} result:`, result);

            totalProcessed += result.processed || 0;
            totalSucceeded += result.succeeded || 0;
            totalFailed += result.failed || 0;
            remaining = result.remaining || 0;

            console.log(`[BATCH_SYNC] Progress: ${totalSucceeded} succeeded, ${totalFailed} failed, ${remaining} remaining`);

            // If no more remaining, we're done
            if (remaining === 0) {
                console.log('[BATCH_SYNC] All guidelines synced!');
                break;
            }

            // Small delay between batches to avoid overwhelming the server
            if (remaining > 0) {
                console.log(`[BATCH_SYNC] Waiting 2 seconds before next batch...`);
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
        }

        return {
            success: true,
            totalProcessed,
            totalSucceeded,
            totalFailed,
            batchesRun: batchCount,
            remaining
        };

    } catch (error) {
        console.error('[BATCH_SYNC] Error during batch sync:', error);
        return {
            success: false,
            error: error.message,
            totalProcessed,
            totalSucceeded,
            totalFailed
        };
    }
}

// Helper to repair content for guidelines with missing content/condensed
async function repairGuidelineContent(idToken, batchSize = 5, maxBatches = 10) {
    console.log(`[CONTENT_REPAIR] Starting content repair with batchSize=${batchSize}, maxBatches=${maxBatches}`);

    let totalProcessed = 0;
    let totalSucceeded = 0;
    let totalFailed = 0;
    let batchCount = 0;
    let remaining = 1; // Start with 1 to enter the loop

    try {
        while (remaining > 0 && batchCount < maxBatches) {
            batchCount++;
            console.log(`[CONTENT_REPAIR] Starting batch ${batchCount}...`);

            const response = await fetch(`${window.SERVER_URL}/repairGuidelineContent`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${idToken}`
                },
                body: JSON.stringify({ batchSize })
            });

            if (!response.ok) {
                console.error(`[CONTENT_REPAIR] Batch ${batchCount} failed with status ${response.status}`);
                break;
            }

            const result = await response.json();
            console.log(`[CONTENT_REPAIR] Batch ${batchCount} result:`, result);

            totalProcessed += result.processed || 0;
            totalSucceeded += result.succeeded || 0;
            totalFailed += result.failed || 0;
            remaining = result.remaining || 0;

            console.log(`[CONTENT_REPAIR] Progress: ${totalSucceeded} succeeded, ${totalFailed} failed, ${remaining} remaining`);

            // If no more remaining, we're done
            if (remaining === 0) {
                console.log('[CONTENT_REPAIR] All guidelines repaired!');
                break;
            }

            // Small delay between batches to avoid overwhelming the server
            if (remaining > 0) {
                console.log(`[CONTENT_REPAIR] Waiting 3 seconds before next batch...`);
                await new Promise(resolve => setTimeout(resolve, 3000));
            }
        }

        return {
            success: true,
            totalProcessed,
            totalSucceeded,
            totalFailed,
            batchesRun: batchCount,
            remaining
        };

    } catch (error) {
        console.error('[CONTENT_REPAIR] Error during content repair:', error);
        return {
            success: false,
            error: error.message,
            totalProcessed,
            totalSucceeded,
            totalFailed
        };
    }
}

// Make repair function available globally for console use
window.repairGuidelineContent = async function () {
    const user = auth.currentUser;
    if (!user) {
        console.error('[CONTENT_REPAIR] User not authenticated');
        return;
    }

    const idToken = await user.getIdToken();
    const result = await repairGuidelineContent(idToken, 3, 20); // 3 at a time, max 20 batches

    if (result.success) {
        console.log('[CONTENT_REPAIR] ✅ Repair completed:', result);
        // Reload guidelines after repair
        window.guidelinesLoading = false;
        await loadGuidelinesFromFirestore();
    } else {
        console.error('[CONTENT_REPAIR] ❌ Repair failed:', result);
    }

    return result;
};

// Helper function to find missing guidelines between GitHub and Firestore
window.findMissingGuidelines = async function () {
    try {
        console.log('[MISSING_GUIDELINES] Comparing GitHub and Firestore...');

        const user = auth.currentUser;
        if (!user) {
            throw new Error('User not authenticated');
        }
        const idToken = await user.getIdToken();

        // Get GitHub guidelines list
        console.log('[MISSING_GUIDELINES] Fetching GitHub guidelines...');
        const response = await fetch(`${window.SERVER_URL}/getGuidelinesList`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${idToken}`
            }
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const guidelinesString = await response.text();
        const githubGuidelines = guidelinesString.split('\n').filter(line => line.trim());

        // Get Firestore guidelines
        console.log('[MISSING_GUIDELINES] Fetching Firestore guidelines...');
        const guidelinesCol = window.firestoreCollection(window.db, 'guidelines');
        const firestoreSnapshot = await window.firestoreGetDocs(guidelinesCol);
        const firestoreIds = new Set();
        firestoreSnapshot.forEach(doc => {
            firestoreIds.add(doc.id);
        });

        console.log('[MISSING_GUIDELINES] GitHub count:', githubGuidelines.length);
        console.log('[MISSING_GUIDELINES] Firestore count:', firestoreIds.size);

        // First, detect duplicates in GitHub (different filenames that generate the same ID)
        const githubIdMap = new Map(); // Map of ID -> array of filenames
        const duplicates = [];

        for (const githubName of githubGuidelines) {
            // Match server.js generateCleanDocId() logic exactly:
            const withoutExtension = githubName.replace(/\.[^/.]+$/, '');
            let slug = withoutExtension
                .toLowerCase()
                .replace(/[^a-z0-9\s-]/g, '')
                .replace(/\s+/g, '-')
                .replace(/-+/g, '-')
                .replace(/^-|-$/g, '');

            const extension = githubName.match(/\.[^/.]+$/)?.[0];
            if (extension && extension.toLowerCase() === '.pdf') {
                slug = `${slug}-pdf`;
            }

            if (!githubIdMap.has(slug)) {
                githubIdMap.set(slug, []);
            }
            githubIdMap.get(slug).push(githubName);
        }

        // Find duplicates
        for (const [id, filenames] of githubIdMap.entries()) {
            if (filenames.length > 1) {
                duplicates.push({ id, filenames, count: filenames.length });
            }
        }

        if (duplicates.length > 0) {
            console.log(`[MISSING_GUIDELINES] ⚠️ Found ${duplicates.length} duplicate IDs in GitHub:`);
            console.table(duplicates);
        }

        // Find missing guidelines
        // Use the same ID generation logic as server.js generateCleanDocId()
        const missing = [];
        for (const githubName of githubGuidelines) {
            // Match server.js generateCleanDocId() logic exactly:
            // 1. Remove file extension
            const withoutExtension = githubName.replace(/\.[^/.]+$/, '');

            // 2. Convert to slug: lowercase, replace special chars with hyphens
            let slug = withoutExtension
                .toLowerCase()
                .replace(/[^a-z0-9\s-]/g, '') // Remove special characters except spaces and hyphens
                .replace(/\s+/g, '-') // Replace spaces with hyphens
                .replace(/-+/g, '-') // Replace multiple hyphens with single hyphen
                .replace(/^-|-$/g, ''); // Remove leading/trailing hyphens

            // 3. Add file extension back if it was a PDF
            const extension = githubName.match(/\.[^/.]+$/)?.[0];
            if (extension && extension.toLowerCase() === '.pdf') {
                slug = `${slug}-pdf`;
            }

            const cleanId = slug;

            if (!firestoreIds.has(cleanId)) {
                missing.push({
                    filename: githubName,
                    expectedId: cleanId
                });
            }
        }

        console.log('[MISSING_GUIDELINES] 📋 Missing guidelines:', missing.length);
        console.table(missing);

        // Also log in a copyable format
        if (missing.length > 0) {
            console.log('\n[MISSING_GUIDELINES] ===== COPYABLE FORMAT =====');
            missing.forEach((item, index) => {
                console.log(`${index + 1}. Filename: ${item.filename}`);
                console.log(`   Expected ID: ${item.expectedId}`);
            });
            console.log('[MISSING_GUIDELINES] ==============================\n');
        } else {
            console.log('[MISSING_GUIDELINES] ✅ No missing guidelines - GitHub and Firestore are in sync!');
        }

        // Return in multiple formats for easy access
        const result = {
            count: missing.length,
            missing: missing,
            duplicates: duplicates,
            duplicateCount: duplicates.length,
            // String format for easy copying
            summary: missing.length > 0
                ? missing.map((item, i) => `${i + 1}. ${item.filename} (ID: ${item.expectedId})`).join('\n')
                : 'No missing guidelines',
            // Array of just filenames
            filenames: missing.map(item => item.filename),
            // Array of just IDs
            ids: missing.map(item => item.expectedId),
            // Explanation of the discrepancy
            explanation: duplicates.length > 0
                ? `GitHub has ${githubGuidelines.length} files but ${githubIdMap.size} unique IDs. ${duplicates.length} duplicate ID(s) account for the difference.`
                : 'GitHub and Firestore counts match.'
        };

        console.log('[MISSING_GUIDELINES] Result object:', result);

        return result;
    } catch (error) {
        console.error('[MISSING_GUIDELINES] Error:', error);
        return null;
    }
};

// Helper function to compare duplicate files and recommend which to keep
window.compareDuplicates = async function (duplicateId) {
    try {
        console.log('[COMPARE_DUPLICATES] Analyzing duplicate files for ID:', duplicateId);

        const user = window.auth.currentUser;
        if (!user) {
            throw new Error('User not authenticated');
        }
        const idToken = await user.getIdToken();

        // First, find the duplicates
        const result = await findMissingGuidelines();
        const duplicate = result.duplicates.find(d => d.id === duplicateId);

        if (!duplicate) {
            console.error('[COMPARE_DUPLICATES] No duplicate found with ID:', duplicateId);
            return null;
        }

        console.log('[COMPARE_DUPLICATES] Found duplicate:', duplicate);

        // Get file info from GitHub for each duplicate
        const fileInfoPromises = duplicate.filenames.map(async (filename) => {
            try {
                const response = await fetch(
                    `https://api.github.com/repos/iannouvel/clerky/contents/guidance/${encodeURIComponent(filename)}`,
                    {
                        headers: {
                            'Accept': 'application/vnd.github.v3+json'
                        }
                    }
                );

                if (!response.ok) {
                    return { filename, error: 'Failed to fetch' };
                }

                const data = await response.json();
                return {
                    filename: filename,
                    size: data.size,
                    sha: data.sha,
                    downloadUrl: data.download_url
                };
            } catch (error) {
                return { filename, error: error.message };
            }
        });

        const fileInfos = await Promise.all(fileInfoPromises);

        // Check which one is in Firestore
        const guidelinesCol = window.firestoreCollection(window.db, 'guidelines');
        const firestoreSnapshot = await window.firestoreGetDocs(guidelinesCol);
        let firestoreMatch = null;

        firestoreSnapshot.forEach(doc => {
            if (doc.id === duplicateId) {
                firestoreMatch = {
                    id: doc.id,
                    filename: doc.data().filename,
                    originalFilename: doc.data().originalFilename,
                    title: doc.data().title,
                    humanFriendlyName: doc.data().humanFriendlyName
                };
            }
        });

        console.log('[COMPARE_DUPLICATES] Firestore document:', firestoreMatch);
        console.log('[COMPARE_DUPLICATES] File information:');
        console.table(fileInfos);

        // Make recommendation
        let recommendation = {
            duplicateId: duplicateId,
            files: fileInfos,
            firestoreDocument: firestoreMatch,
            recommendation: null,
            reasoning: []
        };

        // Determine which file to keep
        const validFiles = fileInfos.filter(f => !f.error);

        if (validFiles.length === 0) {
            recommendation.recommendation = 'Cannot determine - no file info available';
        } else if (validFiles.length === 1) {
            recommendation.recommendation = `Keep: ${validFiles[0].filename}`;
            recommendation.reasoning.push('Only one file has valid metadata');
        } else {
            // Compare file sizes - larger is usually better (more complete)
            const largestFile = validFiles.reduce((max, f) => f.size > max.size ? f : max);

            // Check if one matches Firestore
            let firestoreFile = null;
            if (firestoreMatch) {
                firestoreFile = validFiles.find(f =>
                    f.filename === firestoreMatch.filename ||
                    f.filename === firestoreMatch.originalFilename
                );
            }

            if (firestoreFile) {
                recommendation.recommendation = `Keep: ${firestoreFile.filename}`;
                recommendation.reasoning.push('This file is currently stored in Firestore');
                recommendation.toDelete = validFiles.filter(f => f.filename !== firestoreFile.filename).map(f => f.filename);
            } else {
                recommendation.recommendation = `Keep: ${largestFile.filename}`;
                recommendation.reasoning.push(`Largest file (${largestFile.size} bytes)`);
                recommendation.toDelete = validFiles.filter(f => f.filename !== largestFile.filename).map(f => f.filename);
            }
        }

        console.log('\n[COMPARE_DUPLICATES] ===== RECOMMENDATION =====');
        console.log('Duplicate ID:', duplicateId);
        console.log('Files:', duplicate.filenames);
        console.log('');
        console.log('✅ KEEP:', recommendation.recommendation);
        if (recommendation.toDelete) {
            console.log('❌ DELETE:', recommendation.toDelete);
        }
        console.log('');
        console.log('Reasoning:', recommendation.reasoning.join('; '));
        console.log('[COMPARE_DUPLICATES] ==============================\n');

        return recommendation;
    } catch (error) {
        console.error('[COMPARE_DUPLICATES] Error:', error);
        return null;
    }
};

// Update loadGuidelinesFromFirestore to load from Firestore
async function getGitHubGuidelinesCount() {
    try {
        console.log('[DEBUG] Getting GitHub guidelines count...');

        const user = auth.currentUser;
        if (!user) {
            throw new Error('User not authenticated');
        }
        const idToken = await user.getIdToken();

        const response = await fetch(`${window.SERVER_URL}/getGuidelinesList`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${idToken}`
            }
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const guidelinesString = await response.text();
        const guidelinesList = guidelinesString.split('\n').filter(line => line.trim());
        console.log('[DEBUG] GitHub guidelines count:', guidelinesList.length);
        return guidelinesList.length;
    } catch (error) {
        console.error('[DEBUG] Error getting GitHub guidelines count:', error);
        return null; // Return null on error to avoid triggering sync
    }
}

// Function to check if a guideline has complete metadata
function checkMetadataCompleteness(guideline) {
    const essentialFields = [
        'humanFriendlyName',
        'organisation',
        'yearProduced',
        'title',
        'summary',
        'keywords'
    ];

    const missingFields = [];
    const incompleteFields = [];

    essentialFields.forEach(field => {
        const value = guideline[field];
        if (!value || value === 'N/A' || value === 'Not available' || value === '' || value === null || value === undefined) {
            missingFields.push(field);
        } else if (typeof value === 'string' && value.length < 3) {
            incompleteFields.push(field);
        } else if (Array.isArray(value) && value.length === 0) {
            incompleteFields.push(field);
        }
    });

    return {
        isComplete: missingFields.length === 0 && incompleteFields.length === 0,
        missingFields,
        incompleteFields,
        completenessScore: ((essentialFields.length - missingFields.length - incompleteFields.length) / essentialFields.length) * 100
    };
}

// Function to automatically enhance metadata for guidelines with gaps
async function autoEnhanceIncompleteMetadata(guidelines, options = {}) {
    const {
        maxConcurrent = 3,
        minCompleteness = 70,
        dryRun = false,
        onProgress = null
    } = options;

    // Blacklist of guidelines with known content extraction issues
    const PROBLEMATIC_GUIDELINES = [
        'piis0002937822004781-pdf',  // PDF extraction fails - corrupted or protected PDF
        'PIIS0002937822004781',      // Alternative ID format
        // Add more problematic guidelines here as discovered
    ];

    // Prevent multiple concurrent enhancement runs in the same session
    if (window.enhancementInProgress) {
        console.log('[METADATA] Enhancement already in progress, skipping...');
        return {
            success: true,
            message: 'Enhancement already in progress',
            processed: 0,
            enhanced: 0
        };
    }

    window.enhancementInProgress = true;

    try {
        console.log('[METADATA] Starting automatic metadata enhancement...');

        // Identify guidelines that need enhancement
        const guidelinesNeedingEnhancement = guidelines.filter(guideline => {
            // Skip blacklisted guidelines
            if (PROBLEMATIC_GUIDELINES.includes(guideline.id) ||
                PROBLEMATIC_GUIDELINES.includes(guideline.title) ||
                PROBLEMATIC_GUIDELINES.includes(guideline.filename) ||
                PROBLEMATIC_GUIDELINES.includes(guideline.originalFilename)) {
                console.log(`[METADATA] Skipping blacklisted guideline: ${guideline.title || guideline.id}`);
                return false;
            }

            const completeness = checkMetadataCompleteness(guideline);

            // Skip if already processed recently (using multiple fields for tracking)
            const lastEnhanced = guideline.lastMetadataEnhancement || guideline.lastUpdated || guideline.dateAdded;
            if (lastEnhanced) {
                const daysSinceEnhancement = (Date.now() - new Date(lastEnhanced).getTime()) / (1000 * 60 * 60 * 24);
                if (daysSinceEnhancement < 1 && completeness.completenessScore >= minCompleteness) { // Reduced from 7 days to 1 day
                    console.log(`[METADATA] Skipping ${guideline.title || guideline.id} - enhanced recently and complete (${completeness.completenessScore.toFixed(1)}%)`);
                    return false;
                }
            }

            // Also skip if completeness is already good enough
            if (completeness.completenessScore >= minCompleteness) {
                console.log(`[METADATA] Skipping ${guideline.title || guideline.id} - already complete (${completeness.completenessScore.toFixed(1)}%)`);
                return false;
            }

            return true;
        });

        if (guidelinesNeedingEnhancement.length === 0) {
            console.log('[METADATA] All guidelines have complete metadata');
            return {
                success: true,
                message: 'All guidelines have complete metadata',
                processed: 0,
                enhanced: 0
            };
        }

        console.log(`[METADATA] Found ${guidelinesNeedingEnhancement.length} guidelines needing enhancement`);

        if (dryRun) {
            const report = guidelinesNeedingEnhancement.map(g => {
                const completeness = checkMetadataCompleteness(g);
                return {
                    id: g.id,
                    title: g.title,
                    completenessScore: completeness.completenessScore,
                    missingFields: completeness.missingFields,
                    incompleteFields: completeness.incompleteFields
                };
            });

            console.log('[METADATA] Dry run report:', report);
            return {
                success: true,
                message: `Dry run: ${guidelinesNeedingEnhancement.length} guidelines would be enhanced`,
                dryRunReport: report
            };
        }

        let processed = 0;
        let enhanced = 0;
        const errors = [];

        // Process guidelines in batches to avoid overwhelming the server
        for (let i = 0; i < guidelinesNeedingEnhancement.length; i += maxConcurrent) {
            const batch = guidelinesNeedingEnhancement.slice(i, i + maxConcurrent);

            const batchPromises = batch.map(async (guideline) => {
                try {
                    console.log(`[METADATA] Enhancing metadata for: ${guideline.title || guideline.id}`);

                    if (onProgress) {
                        onProgress({
                            current: processed + 1,
                            total: guidelinesNeedingEnhancement.length,
                            guideline: guideline.title || guideline.id
                        });
                    }

                    // Check what fields are missing
                    const completeness = checkMetadataCompleteness(guideline);
                    const fieldsToEnhance = [...completeness.missingFields, ...completeness.incompleteFields];

                    // Call the enhancement function
                    await enhanceGuidelineMetadata(guideline.id, fieldsToEnhance);
                    enhanced++;

                    console.log(`[METADATA] Successfully enhanced: ${guideline.title || guideline.id}`);

                } catch (error) {
                    console.error(`[METADATA] Error enhancing ${guideline.title || guideline.id}:`, error);

                    // Check if it's a "no content" error and handle gracefully
                    if (error.message && error.message.includes('No content available for AI analysis')) {
                        console.log(`[METADATA] Skipping ${guideline.title || guideline.id} - no content available for analysis`);
                    } else {
                        errors.push({
                            guidelineId: guideline.id,
                            title: guideline.title,
                            error: error.message
                        });
                    }
                }

                processed++;
            });

            // Wait for batch to complete
            await Promise.all(batchPromises);

            // Small delay between batches to avoid rate limiting
            if (i + maxConcurrent < guidelinesNeedingEnhancement.length) {
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }

        console.log(`[METADATA] Enhancement complete: ${enhanced}/${processed} guidelines enhanced`);

        return {
            success: true,
            message: `Enhanced ${enhanced} out of ${processed} guidelines`,
            processed,
            enhanced,
            errors: errors.length > 0 ? errors : undefined
        };

    } catch (error) {
        console.error('[METADATA] Error in auto enhancement:', error);
        return {
            success: false,
            error: error.message
        };
    } finally {
        // Always clear the in-progress flag
        window.enhancementInProgress = false;
    }
}

// Helper function to fetch content from Firebase Storage
async function fetchContentFromStorage(storageUrl) {
    try {
        if (!storageUrl) return null;

        console.log('[STORAGE] Fetching content from:', storageUrl);
        const response = await fetch(storageUrl);

        if (!response.ok) {
            console.error('[STORAGE] Failed to fetch from Storage:', response.status);
            return null;
        }

        const content = await response.text();
        console.log('[STORAGE] Successfully fetched content:', content.length, 'characters');
        return content;
    } catch (error) {
        console.error('[STORAGE] Error fetching from Storage:', error);
        return null;
    }
}

// Helper function to get guideline content, fetching from Storage if needed
async function getGuidelineContent(guideline) {
    const result = {
        content: guideline.content,
        condensed: guideline.condensed,
        summary: guideline.summary
    };

    // Fetch from Storage if content is stored there
    if (guideline.contentInStorage || guideline.contentStorageUrl) {
        if (guideline.contentStorageUrl && !guideline.content) {
            result.content = await fetchContentFromStorage(guideline.contentStorageUrl);
        }
        if (guideline.condensedStorageUrl && !guideline.condensed) {
            result.condensed = await fetchContentFromStorage(guideline.condensedStorageUrl);
        }
        if (guideline.summaryStorageUrl && !guideline.summary) {
            result.summary = await fetchContentFromStorage(guideline.summaryStorageUrl);
        }
    }

    return result;
}

// Expose helper to global scope for console access
window.getGuidelineContent = getGuidelineContent;

async function loadGuidelinesFromFirestore() {
    // Prevent multiple simultaneous guideline loads
    if (window.guidelinesLoading || window.guidelinesLoaded) {
        console.log('[DEBUG] ⏭️ Guidelines loading already in progress or completed, skipping...');

        // Return cached guidelines if available
        if (window.guidelines && window.guidelines.length > 0) {
            console.log('[DEBUG] Returning cached guidelines:', window.guidelines.length);
            return window.guidelines;
        }

        // If we don't have cached guidelines but think they're loaded, reset the flag
        console.log('[DEBUG] Guidelines marked as loaded but cache is empty, resetting...');
        window.guidelinesLoaded = false;
        window.guidelinesLoading = false;
    }

    window.guidelinesLoading = true;

    try {
        // Try to get from IndexedDB cache first
        if (window.cacheManager) {
            const cachedGuidelines = await window.cacheManager.getGuidelines();
            if (cachedGuidelines && cachedGuidelines.length > 0) {
                console.log('[DEBUG] ⚡ Loaded guidelines from IndexedDB cache:', cachedGuidelines.length);

                // Store in global variables
                window.guidelinesList = cachedGuidelines.map(g => ({
                    id: g.id,
                    title: g.title
                }));
                window.guidelinesSummaries = cachedGuidelines.map(g => g.summary);
                window.guidelinesKeywords = cachedGuidelines.map(g => g.keywords);
                window.guidelinesCondensed = cachedGuidelines.map(g => g.condensed);

                window.globalGuidelines = cachedGuidelines.reduce((acc, g) => {
                    acc[g.id] = {
                        id: g.id,
                        title: g.title,
                        displayName: g.displayName || null,
                        humanFriendlyName: g.humanFriendlyName || g.human_friendly_name || g.title,
                        content: g.content,
                        summary: g.summary,
                        keywords: g.keywords,
                        condensed: g.condensed,
                        organisation: g.organisation,
                        downloadUrl: g.downloadUrl,
                        originalFilename: g.originalFilename,
                        hospitalTrust: g.hospitalTrust || null,  // CRITICAL for filtering
                        scope: g.scope || null  // CRITICAL for filtering
                    };
                    return acc;
                }, {});

                window.guidelinesLoaded = true;
                window.guidelinesLoading = false;
                return cachedGuidelines;
            }
        }

        console.log('[DEBUG] Loading guidelines from Firestore...');

        // Get user ID token - only refresh if expired (not forcing refresh for better performance)
        const user = auth.currentUser;
        if (!user) {
            throw new Error('User not authenticated');
        }
        const idToken = await user.getIdToken(); // Use cached token if still valid

        // Fetch guidelines from Firestore
        const response = await fetch(`${window.SERVER_URL}/getAllGuidelines`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${idToken}`
            }
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const result = await response.json();
        if (!result.success || !result.guidelines) {
            throw new Error('Invalid response format from server');
        }

        const guidelines = result.guidelines;
        const firestoreCount = guidelines.length;
        console.log('[DEBUG] Loaded guidelines from Firestore:', firestoreCount);

        // Save to IndexedDB cache in background
        if (window.cacheManager) {
            window.cacheManager.saveGuidelines(guidelines).catch(err => {
                console.warn('[DEBUG] Failed to cache guidelines:', err);
            });
        }

        // Guideline sync moved to background - see syncGuidelinesInBackground()

        // Check content status - reduced logging for cleaner startup
        const contentStatus = checkContentStatus(guidelines);

        // Only log if there are significant content issues
        if (contentStatus.stats.nullContent > 0 || contentStatus.stats.nullCondensed > 0) {
            console.log('[CONTENT_STATUS] Missing content detected:', {
                nullContent: contentStatus.stats.nullContent,
                nullCondensed: contentStatus.stats.nullCondensed,
                missingBoth: contentStatus.stats.missingBoth
            });
        }

        // Store in global variables using document ID as key
        window.guidelinesList = guidelines.map(g => ({
            id: g.id,
            title: g.title
        }));
        window.guidelinesSummaries = guidelines.map(g => g.summary);
        window.guidelinesKeywords = guidelines.map(g => g.keywords);
        window.guidelinesCondensed = guidelines.map(g => g.condensed);

        // Store full guideline data using document ID as key
        window.globalGuidelines = guidelines.reduce((acc, g) => {
            acc[g.id] = {
                id: g.id,
                title: g.title,
                displayName: g.displayName || null,
                humanFriendlyName: g.humanFriendlyName || g.human_friendly_name || g.title,
                content: g.content,
                summary: g.summary,
                keywords: g.keywords,
                condensed: g.condensed,
                organisation: g.organisation,
                downloadUrl: g.downloadUrl,
                originalFilename: g.originalFilename,
                hospitalTrust: g.hospitalTrust || null,  // CRITICAL for filtering
                scope: g.scope || null  // CRITICAL for filtering
            };
            return acc;
        }, {});

        console.log('[DEBUG] Guidelines loaded and stored in global variables');
        window.guidelinesLoaded = true;

        // Firestore listener setup moved to background - see setupGuidelinesListenerInBackground()

        return guidelines;
    } catch (error) {
        console.error('[DEBUG] Error loading guidelines from Firestore:', error);
        throw error;
    } finally {
        window.guidelinesLoading = false;
    }
}

// Function to set up Firestore listener for guideline changes
function setupGuidelinesListener() {
    console.log('[FIRESTORE_LISTENER] Setting up guidelines change listener...');

    // Track the previous count to detect changes
    let previousGuidelineCount = 0;
    let isInitialLoad = true;

    try {
        // Listen for changes to the guidelines collection using v9 syntax
        window.guidelinesListener = onSnapshot(collection(db, 'guidelines'), async (snapshot) => {
            const currentCount = snapshot.size;

            // Get changed documents
            const changes = snapshot.docChanges();
            const addedDocs = changes.filter(change => change.type === 'added');
            const modifiedDocs = changes.filter(change => change.type === 'modified');

            // Check if this is the initial load
            if (isInitialLoad) {
                console.log(`[FIRESTORE_LISTENER] Initial load detected - ${currentCount} guidelines in collection`);
                previousGuidelineCount = currentCount;
                isInitialLoad = false;
                return; // Skip processing on initial load
            }

            // Only log and process if there are actual changes
            if (addedDocs.length > 0 || modifiedDocs.length > 0) {
                console.log(`[FIRESTORE_LISTENER] Guidelines collection changed - Count: ${currentCount} (previous: ${previousGuidelineCount})`);
            }

            // Check if count has changed (new guidelines added or removed)
            const countChanged = currentCount !== previousGuidelineCount;

            if (addedDocs.length > 0) {
                console.log(`[FIRESTORE_LISTENER] ${addedDocs.length} new guidelines detected`);

                // Process new guidelines for content
                for (const change of addedDocs) {
                    const guidelineData = change.doc.data();
                    const guidelineId = change.doc.id;

                    console.log(`[FIRESTORE_LISTENER] Processing new guideline: ${guidelineData.title || guidelineId}`);

                    // Trigger content processing if needed
                    if (!guidelineData.content || !guidelineData.condensed) {
                        console.log(`[FIRESTORE_LISTENER] Triggering content processing for: ${guidelineId}`);
                        await processGuidelineContent(guidelineId);
                    }
                }
            }
        }, (error) => {
            // Error callback for Firestore listener
            console.warn('[FIRESTORE_LISTENER] Listener encountered an error (likely network issue):', error.code, error.message);

            // If it's a permission error, it's serious. If it's a network error, we can ignore it mostly as the offline cache takes over.
            if (error.code === 'permission-denied') {
                updateUser('Access denied to guidelines. Please check your permissions.', false);
            } else if (error.code === 'unavailable' || error.message.includes('offline')) {
                // Network issue - offline listener will handle the UI notification
                console.log('[FIRESTORE_LISTENER] Pausing listener logs due to network disconnection.');
            }
        });

        // When guideline count changes, trigger comprehensive metadata completion
        if (countChanged && previousGuidelineCount > 0) {
            console.log(`[METADATA_COMPLETION] 🎯 Guideline count changed (${previousGuidelineCount} → ${currentCount}). Skipping automatic metadata completion to avoid memory issues.`);

            // NOTE: Automatic metadata completion disabled to prevent server memory crashes
            // The batch sync endpoint handles metadata extraction inline
            // await triggerMetadataCompletionForAll();

            // Invalidate cache when changes detected
            if (window.cacheManager) {
                window.cacheManager.clearGuidelinesCache().catch(err => {
                    console.warn('[FIRESTORE_LISTENER] Failed to clear cache:', err);
                });
            }

            // Refresh guidelines data after processing
            setTimeout(() => {
                window.guidelinesLoading = false; // Reset flag to allow reload
                loadGuidelinesFromFirestore();
            }, 3000);
        } else if (addedDocs.length > 0) {
            // If only processing new guidelines without count change detection
            // Invalidate cache when new guidelines are added
            if (window.cacheManager) {
                window.cacheManager.clearGuidelinesCache().catch(err => {
                    console.warn('[FIRESTORE_LISTENER] Failed to clear cache:', err);
                });
            }

            setTimeout(() => {
                window.guidelinesLoading = false; // Reset flag to allow reload
                loadGuidelinesFromFirestore();
            }, 2000);
        }

        // Update the previous count for next comparison
        previousGuidelineCount = currentCount;

        if (modifiedDocs.length > 0) {
            console.log(`[FIRESTORE_LISTENER] ${modifiedDocs.length} guidelines updated`);

            // Invalidate cache when guidelines are modified
            if (window.cacheManager) {
                window.cacheManager.clearGuidelinesCache().catch(err => {
                    console.warn('[FIRESTORE_LISTENER] Failed to clear cache:', err);
                });
            }

            // Update global variables with modified data
            modifiedDocs.forEach(change => {
                const guidelineData = change.doc.data();
                const guidelineId = change.doc.id;

                if (window.globalGuidelines && window.globalGuidelines[guidelineId]) {
                    window.globalGuidelines[guidelineId] = {
                        ...window.globalGuidelines[guidelineId],
                        ...guidelineData
                    };
                    console.log(`[FIRESTORE_LISTENER] Updated local data for: ${guidelineData.title || guidelineId}`);
                }
            });

            // Reload guidelines to get fresh data
            setTimeout(() => {
                window.guidelinesLoading = false; // Reset flag to allow reload
                loadGuidelinesFromFirestore();
            }, 1000);
        }
    }, (error) => {
        console.error('[FIRESTORE_LISTENER] Error in guidelines listener:', error);
    });

    console.log('[FIRESTORE_LISTENER] Guidelines listener set up successfully');

} catch (error) {
    console.error('[FIRESTORE_LISTENER] Failed to set up guidelines listener:', error);
}
}

// Function to process content for a single guideline (triggered by listener)
async function processGuidelineContent(guidelineId) {
    try {
        console.log(`[CONTENT_PROCESSOR] Processing content for: ${guidelineId}`);

        const user = auth.currentUser;
        if (!user) {
            console.error('[CONTENT_PROCESSOR] User not authenticated');
            return;
        }

        const idToken = await user.getIdToken();

        const response = await fetch(`${window.SERVER_URL}/processGuidelineContent`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${idToken}`
            },
            body: JSON.stringify({ guidelineId })
        });

        if (response.ok) {
            const result = await response.json();
            console.log(`[CONTENT_PROCESSOR] Content processing result:`, result);
            return result;
        } else {
            const errorText = await response.text();
            console.error(`[CONTENT_PROCESSOR] Failed to process content:`, errorText);
        }
    } catch (error) {
        console.error(`[CONTENT_PROCESSOR] Error processing content:`, error);
    }
}

// Background sync function - runs after page is interactive
async function syncGuidelinesInBackground() {
    try {
        const user = auth.currentUser;
        if (!user) return;

        const idToken = await user.getIdToken();
        const currentCount = window.guidelinesList ? window.guidelinesList.length : 0;

        // Check if we need to sync more guidelines from GitHub
        const githubCount = await getGitHubGuidelinesCount();
        if (githubCount !== null && githubCount > currentCount) {
            console.log(`[BACKGROUND_SYNC] GitHub has ${githubCount} guidelines but Firestore only has ${currentCount}. Syncing...`);

            // Use batch sync to avoid timeouts
            const syncResult = await syncGuidelinesInBatches(idToken, 3); // Process 3 at a time

            if (syncResult.success) {
                console.log('[BACKGROUND_SYNC] Sync completed successfully:', syncResult);

                // Reload guidelines after sync
                window.guidelinesLoading = false; // Reset flag
                await loadGuidelinesFromFirestore();
            } else {
                console.warn('[BACKGROUND_SYNC] Sync failed:', await syncResponse.text());
            }
        } else if (githubCount !== null) {
            console.log(`[BACKGROUND_SYNC] Guidelines up to date: GitHub=${githubCount}, Firestore=${currentCount}`);
        }
    } catch (error) {
        console.warn('[BACKGROUND_SYNC] Error during background sync:', error);
    }
}

// Setup Firestore listener in background
function setupGuidelinesListenerInBackground() {
    if (!window.guidelinesListener) {
        setupGuidelinesListener();
    }
}

// Make functions available globally
window.loadGuidelinesFromFirestore = loadGuidelinesFromFirestore;
window.syncGuidelinesInBackground = syncGuidelinesInBackground;
window.setupGuidelinesListenerInBackground = setupGuidelinesListenerInBackground;

// Function to show error messages
function showError(message) {
    alert(message);
    console.error('Error:', message);
}

// Guidelines caching functions to optimize payload size
const GUIDELINES_CACHE_KEY = 'clerky_guidelines_cache';
const CACHE_VERSION_KEY = 'clerky_cache_version';
const CACHE_VERSION = '1.0.0';

function getCachedGuidelines() {
    try {
        const cacheVersion = localStorage.getItem(CACHE_VERSION_KEY);
        if (cacheVersion !== CACHE_VERSION) {
            // Clear cache if version doesn't match
            localStorage.removeItem(GUIDELINES_CACHE_KEY);
            localStorage.setItem(CACHE_VERSION_KEY, CACHE_VERSION);
            return [];
        }

        const cached = localStorage.getItem(GUIDELINES_CACHE_KEY);
        return cached ? JSON.parse(cached) : [];
    } catch (error) {
        console.warn('[CACHE] Error reading cached guidelines:', error);
        return [];
    }
}

function setCachedGuidelines(guidelines) {
    try {
        localStorage.setItem(GUIDELINES_CACHE_KEY, JSON.stringify(guidelines));
        localStorage.setItem(CACHE_VERSION_KEY, CACHE_VERSION);
        console.log('[CACHE] Guidelines cached successfully:', guidelines.length);
    } catch (error) {
        console.warn('[CACHE] Error caching guidelines:', error);
        // If localStorage is full, try to clear and retry
        if (error.name === 'QuotaExceededError') {
            try {
                localStorage.removeItem(GUIDELINES_CACHE_KEY);
                localStorage.setItem(GUIDELINES_CACHE_KEY, JSON.stringify(guidelines));
                console.log('[CACHE] Guidelines cached after clearing space');
            } catch (retryError) {
                console.error('[CACHE] Failed to cache even after clearing:', retryError);
            }
        }
    }
}

function getOptimizedGuidelinesPayload(currentGuidelines, cachedGuidelines) {
    const payload = {
        newGuidelines: [],
        updatedGuidelines: [],
        hasFullCache: cachedGuidelines.length > 0,
        totalCount: currentGuidelines.length
    };

    // Create maps for faster lookup
    const cachedMap = new Map();
    cachedGuidelines.forEach(g => {
        cachedMap.set(g.id, g);
    });

    // Compare current guidelines with cached ones
    currentGuidelines.forEach(guideline => {
        const cached = cachedMap.get(guideline.id);

        if (!cached) {
            // New guideline
            payload.newGuidelines.push(guideline);
        } else {
            // Check if guideline has been updated (simple hash comparison)
            const currentHash = generateGuidelineHash(guideline);
            const cachedHash = generateGuidelineHash(cached);

            if (currentHash !== cachedHash) {
                // Updated guideline
                payload.updatedGuidelines.push(guideline);
            }
        }
    });

    // Update cache with current guidelines
    setCachedGuidelines(currentGuidelines);

    return payload;
}

function generateGuidelineHash(guideline) {
    // Simple hash based on key properties
    const hashString = `${guideline.id}-${guideline.title}-${guideline.summary || ''}-${guideline.condensed || ''}`;
    return hashString.length + (guideline.keywords ? guideline.keywords.join('') : '');
}

// Cache management functions for debugging
function clearGuidelinesCache() {
    localStorage.removeItem(GUIDELINES_CACHE_KEY);
    localStorage.removeItem(CACHE_VERSION_KEY);
    console.log('[CACHE] Guidelines cache cleared');
}

function getCacheInfo() {
    const cached = getCachedGuidelines();
    const cacheSize = localStorage.getItem(GUIDELINES_CACHE_KEY)?.length || 0;
    return {
        count: cached.length,
        size: `${Math.round(cacheSize / 1024)}KB`,
        version: localStorage.getItem(CACHE_VERSION_KEY) || 'none'
    };
}

// Expose cache functions globally for debugging
window.clearGuidelinesCache = clearGuidelinesCache;
window.getCacheInfo = getCacheInfo;

// Clinical Note Undo/Redo History System
window.clinicalNoteHistory = [];
window.clinicalNoteHistoryIndex = -1;

// Function to push current state to history
function pushToHistory(text) {
    // Remove any future history if we're not at the end
    window.clinicalNoteHistory = window.clinicalNoteHistory.slice(0, window.clinicalNoteHistoryIndex + 1);

    // Add new state
    window.clinicalNoteHistory.push(text);
    window.clinicalNoteHistoryIndex = window.clinicalNoteHistory.length - 1;

    // Limit history to 50 entries to prevent memory issues
    if (window.clinicalNoteHistory.length > 50) {
        window.clinicalNoteHistory.shift();
        window.clinicalNoteHistoryIndex--;
    }

    updateUndoRedoButtons();
}

// Function to undo - steps through programmatic changes
function undo() {
    const editor = window.editors?.userInput;
    if (!editor) return;

    if (window.currentChangeIndex > 0 && window.programmaticChangeHistory.length > 0) {
        const currentChange = window.programmaticChangeHistory[window.currentChangeIndex];
        // Use editorStateBefore to go back to the state before this change
        const stateToRestore = currentChange.editorStateBefore ||
            (window.currentChangeIndex > 0 ? window.programmaticChangeHistory[window.currentChangeIndex - 1].editorState : null);

        if (stateToRestore) {
            window.currentChangeIndex--;
            console.log('[UNDO] Reverting to before change:', currentChange.type);
            editor.commands.setContent(stateToRestore);
            updateUndoRedoButtons();
        } else {
            // Fall back to TipTap's built-in undo
            editor.commands.undo();
            updateUndoRedoButtons();
        }
    } else if (window.currentChangeIndex === 0 && window.programmaticChangeHistory.length > 0) {
        // At the first programmatic change, undo to the state before it
        const firstChange = window.programmaticChangeHistory[0];
        if (firstChange.editorStateBefore) {
            window.currentChangeIndex = -1;
            console.log('[UNDO] Reverting to state before first programmatic change');
            editor.commands.setContent(firstChange.editorStateBefore);
            updateUndoRedoButtons();
        } else {
            // Use TipTap's built-in undo
            editor.commands.undo();
            updateUndoRedoButtons();
        }
    } else {
        // Use TipTap's built-in undo
        editor.commands.undo();
        updateUndoRedoButtons();
    }
}

// Function to redo - steps through programmatic changes
function redo() {
    const editor = window.editors?.userInput;
    if (!editor) return;

    if (window.currentChangeIndex < window.programmaticChangeHistory.length - 1) {
        window.currentChangeIndex++;
        const change = window.programmaticChangeHistory[window.currentChangeIndex];
        console.log('[REDO] Advancing to change:', change.type);
        // Use editorState which is the state AFTER this change was applied
        editor.commands.setContent(change.editorState);
        updateUndoRedoButtons();
    } else {
        // Use TipTap's built-in redo
        editor.commands.redo();
        updateUndoRedoButtons();
    }
}

// Function to update button states
function updateUndoRedoButtons() {
    const undoBtn = document.getElementById('undoBtn');
    const redoBtn = document.getElementById('redoBtn');
    const editor = window.editors?.userInput;

    // Check if we have programmatic changes to track
    const hasProgrammaticHistory = window.programmaticChangeHistory && window.programmaticChangeHistory.length > 0;

    if (hasProgrammaticHistory) {
        // Use programmatic change history for button states
        if (undoBtn) {
            // Enable undo if we're at index 0 or higher (can undo to before first change)
            // Disable only if we're already before the first change (index -1)
            undoBtn.disabled = window.currentChangeIndex < 0;
        }
        if (redoBtn) {
            // Disable redo if we're at the last change
            // Enable redo if currentChangeIndex < length - 1 (including -1)
            redoBtn.disabled = window.currentChangeIndex >= window.programmaticChangeHistory.length - 1;
        }
    } else if (editor) {
        // Fall back to TipTap's built-in undo/redo state
        if (undoBtn) {
            undoBtn.disabled = !editor.can().undo();
        }
        if (redoBtn) {
            redoBtn.disabled = !editor.can().redo();
        }
    } else {
        // Fall back to clinical note history if no editor
        if (undoBtn) {
            undoBtn.disabled = window.clinicalNoteHistoryIndex <= 0;
        }
        if (redoBtn) {
            redoBtn.disabled = window.clinicalNoteHistoryIndex >= window.clinicalNoteHistory.length - 1;
        }
    }
}

// Initialize TipTap editor integration when ready
function initializeTipTapIntegration() {
    // Prevent multiple initializations
    if (window.tiptapIntegrationInitialized) {
        console.log('[TIPTAP] Integration already initialized, skipping');
        return;
    }

    const editor = window.editors?.userInput;
    if (!editor) {
        console.warn('[TIPTAP] Editor not ready, waiting for tiptapReady event');
        return;
    }

    console.log('[TIPTAP] Initializing integration');
    window.tiptapIntegrationInitialized = true;

    // Initialize history with empty content
    pushToHistory('');

    // Listen for content updates
    editor.on('update', () => {
        const content = editor.getText();
        if (content !== window.clinicalNoteHistory[window.clinicalNoteHistoryIndex]) {
            pushToHistory(content);
        }
    });

    // Update undo/redo button states based on TipTap history
    editor.on('transaction', () => {
        updateUndoRedoButtons();
    });

    // Wire up undo/redo buttons
    const undoBtn = document.getElementById('undoBtn');
    const redoBtn = document.getElementById('redoBtn');
    const clearFormattingBtn = document.getElementById('clearFormattingBtn');

    if (undoBtn) {
        undoBtn.addEventListener('click', undo);
    }
    if (redoBtn) {
        redoBtn.addEventListener('click', redo);
    }
    if (clearFormattingBtn) {
        clearFormattingBtn.addEventListener('click', () => {
            console.log('[CLEAR] Removing all color formatting');
            const plainText = editor.getText();
            editor.commands.setContent(plainText);
            window.hasColoredChanges = false;
            window.programmaticChangeHistory = [];
            window.currentChangeIndex = -1;
            updateClearFormattingButton();
        });
    }

    console.log('[TIPTAP] Integration complete');

    // Add a function to clear the editor
    window.clearEditor = function () {
        const editor = window.editors?.userInput;
        if (editor && editor.commands) {
            editor.commands.clearContent();
            editor.commands.focus();
            console.log('[TIPTAP] Editor cleared');
        }
    };

    // Nuclear option - force editor to be editable by any means necessary
    window.nuclearFixEditor = function () {
        console.log('[NUCLEAR] Applying nuclear fix...');
        const editor = window.editors?.userInput;
        const pm = document.querySelector('#userInput .ProseMirror');

        if (pm) {
            // Remove all existing styles that might block
            pm.style.cssText = '';

            // Apply new styles
            pm.setAttribute('contenteditable', 'true');
            pm.setAttribute('tabindex', '0');
            pm.style.padding = '12px';
            pm.style.minHeight = '150px';
            pm.style.cursor = 'text';
            pm.style.userSelect = 'text';
            pm.style.webkitUserSelect = 'text';
            pm.style.pointerEvents = 'auto';
            pm.style.position = 'relative';
            pm.style.zIndex = '1000';
            pm.style.background = 'white';

            // Focus it
            pm.focus();

            // Try to place cursor at the end
            const range = document.createRange();
            const sel = window.getSelection();
            if (pm.childNodes.length > 0) {
                range.setStart(pm.childNodes[0], 0);
                range.collapse(true);
                sel.removeAllRanges();
                sel.addRange(range);
            }

            console.log('[NUCLEAR] Nuclear fix applied - try typing now');
        }
    };
}

// ===== Chatbot-style UX Functions =====

// Show/hide action buttons based on input content
function updateChatbotButtonVisibility() {
    const editor = window.editors?.userInput;
    const analyseBtn = document.getElementById('analyseBtn');
    const summarySection = document.getElementById('summarySection');

    if (!editor || !summarySection) return;

    const content = editor.getText().trim();
    const hasContent = content.length > 0;

    // The analyse button visibility is controlled by the summarySection visibility
    // Just ensure the button is enabled when content exists
    if (analyseBtn && hasContent) {
        analyseBtn.disabled = false;
    }
}

// Show/hide summary section based on content
function updateSummaryVisibility() {
    const summarySection = document.getElementById('summarySection');
    const summary1 = document.getElementById('summary1');
    const loadingSpinner = document.getElementById('summaryLoadingSpinner');
    const clinicalPanel = document.getElementById('clinicalIssuesPanel');

    if (!summarySection || !summary1) return;

    // Check if loading spinner is visible
    const isLoading = loadingSpinner && !loadingSpinner.classList.contains('hidden');

    // Check if summary has actual *visible* content (excluding loading spinner)
    const contentElements = Array.from(summary1.children).filter(
        child => child.id !== 'summaryLoadingSpinner'
    );

    const hasVisibleContent = contentElements.some(child => {
        const style = window.getComputedStyle(child);
        const text = child.textContent ? child.textContent.trim() : '';
        return (
            style.display !== 'none' &&
            style.visibility !== 'hidden' &&
            child.offsetHeight > 0 &&
            text.length > 0
        );
    });

    // Explicit decision UIs that should always be visible in summary1
    const hasPIIReview = !!document.getElementById('pii-review-current');
    const hasSuggestionReview = !!document.getElementById('suggestion-review-current');
    const hasSuggestionList = !!summary1.querySelector('.dynamic-advice-container');
    const hasGuidelineSelection = !!summary1.querySelector('.guideline-selection-interface');

    const hasDecisionUI = hasPIIReview || hasSuggestionReview || hasSuggestionList || hasGuidelineSelection;

    // Treat visible clinical issues panel as content so the section stays open
    const hasClinicalPanel = clinicalPanel && !clinicalPanel.classList.contains('hidden');

    // Show summary if loading, has visible content, or has any decision UI
    if (isLoading || hasVisibleContent || hasClinicalPanel || hasDecisionUI) {
        summarySection.classList.remove('hidden');
    } else {
        summarySection.classList.add('hidden');
    }
}

// Update summary critical status based on interactive content
window.updateSummaryCriticalStatus = function updateSummaryCriticalStatus() {
    const summarySection = document.getElementById('summarySection');
    const summary1 = document.getElementById('summary1');

    if (!summarySection || !summary1) return;

    // Check for any interactive elements
    const hasInteractive = summary1.querySelector('button, input, select, textarea, [onclick]');

    if (hasInteractive) {
        summarySection.classList.add('critical');
        console.log('[SUMMARY] Critical mode activated - interactive content detected');

        // Auto-scroll to the most relevant interactive UI after layout settles.
        // Prefer PII review (if present), otherwise scroll to the Test/clerking selector panel,
        // otherwise fall back to the first interactive element.
        setTimeout(() => {
            const piiReview = document.getElementById('pii-review-current');
            if (piiReview) {
                scrollToPIIReviewButtons();
                return;
            }

            const clinicalPanel = document.getElementById('clinicalIssuesPanel');
            if (clinicalPanel && typeof clinicalPanel.scrollIntoView === 'function') {
                clinicalPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                const dropdown = clinicalPanel.querySelector('select');
                if (dropdown && typeof dropdown.focus === 'function') dropdown.focus();
                return;
            }

            const firstInteractive = summary1.querySelector('button, input, select, textarea, [onclick]');
            if (firstInteractive && typeof firstInteractive.scrollIntoView === 'function') {
                firstInteractive.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }
        }, 200);
    } else {
        summarySection.classList.remove('critical');
        console.log('[SUMMARY] Critical mode deactivated - no interactive content');
    }
}

// Show loading spinner in summary
function showSummaryLoading() {
    const summarySection = document.getElementById('summarySection');
    const summary1 = document.getElementById('summary1');
    const loadingSpinner = document.getElementById('summaryLoadingSpinner');

    if (!summary1 || !loadingSpinner) return;

    // Determine if there's already real content/decision UI in summary1
    const hasRealContent =
        summary1.textContent.trim().length > 0 ||
        Array.from(summary1.children).some(child => child.id !== 'summaryLoadingSpinner');

    const sectionVisible = summarySection && !summarySection.classList.contains('hidden');

    // If there's no existing content and the section is hidden, avoid popping up
    // an empty summary panel with just \"Processing...\" – use serverStatusMessage instead.
    if (!sectionVisible && !hasRealContent) {
        return;
    }

    if (summarySection) {
        summarySection.classList.remove('hidden');
        summarySection.classList.add('loading');
    }

    // Show loading spinner over existing content/decision UI
    loadingSpinner.classList.remove('hidden');
}

// Hide loading spinner in summary
function hideSummaryLoading() {
    const loadingSpinner = document.getElementById('summaryLoadingSpinner');
    const summarySection = document.getElementById('summarySection');

    if (loadingSpinner) {
        loadingSpinner.classList.add('hidden');
    }

    if (summarySection) {
        summarySection.classList.remove('loading');
    }

    // Update visibility after hiding spinner
    updateSummaryVisibility();
}

// Initialize chatbot UX functionality
function initializeChatbotUX() {
    const editor = window.editors?.userInput;
    if (!editor) {
        console.warn('[CHATBOT] Editor not ready, waiting for tiptapReady event');
        return;
    }

    console.log('[CHATBOT] Initializing chatbot UX');

    // Listen for content updates to show/hide buttons
    editor.on('update', () => {
        updateChatbotButtonVisibility();
    });

    // Hide record button when editor is focused (user is typing)
    const recordBtn = document.getElementById('recordBtn');
    if (recordBtn) {
        editor.on('focus', () => {
            recordBtn.classList.add('hidden-while-typing');
        });

        editor.on('blur', () => {
            recordBtn.classList.remove('hidden-while-typing');
        });
    }

    // Initial button visibility check
    updateChatbotButtonVisibility();

    // Initial summary visibility check
    updateSummaryVisibility();

    console.log('[CHATBOT] Chatbot UX initialized');
}

// Listen for TipTap ready event
window.addEventListener('tiptapReady', () => {
    initializeTipTapIntegration();
    initializeChatbotUX();
});

// Also try to initialize if TipTap is already loaded
document.addEventListener('DOMContentLoaded', function () {
    setTimeout(initializeTipTapIntegration, 500);

    // Additional fix - ensure editor is editable after everything loads
    setTimeout(() => {
        const editor = window.editors?.userInput;
        if (editor) {
            console.log('[TIPTAP] Final editability check and fix');
            const proseMirror = document.querySelector('#userInput .ProseMirror');
            if (proseMirror) {
                // Visibility guards
                const el = document.getElementById('userInput');
                if (el) {
                    el.style.display = 'block';
                    el.style.visibility = 'visible';
                }
                proseMirror.style.display = 'block';
                proseMirror.style.visibility = 'visible';
                // Interactivity
                proseMirror.setAttribute('contenteditable', 'true');
                proseMirror.setAttribute('tabindex', '0');
                proseMirror.style.pointerEvents = 'auto';
                proseMirror.style.cursor = 'text';
                proseMirror.style.userSelect = 'text';
                console.log('[TIPTAP] Final visibility & editability fix applied');
            }
        }
    }, 2000);
});

async function findRelevantGuidelines(suppressHeader = false, scope = null, hospitalTrust = null) {
    const findGuidelinesBtn = document.getElementById('findGuidelinesBtn');
    const originalText = findGuidelinesBtn?.textContent || 'Find Guidelines';

    try {
        const transcript = getUserInputContent();
        if (!transcript) {
            alert('Please enter some text first');
            return;
        }

        // Set loading state
        if (findGuidelinesBtn) {
            findGuidelinesBtn.classList.add('loading');
            findGuidelinesBtn.disabled = true;
        }

        // Initialize the guideline search summary (unless called from process workflow)
        if (!suppressHeader) {
            let searchProgress = '## Finding Relevant Guidelines\n\n';
            appendToOutputField(searchProgress, false);
        }

        // ANONYMISATION STEP: Check and anonymise clinical data before sending to server
        console.log('[ANONYMISER] Checking transcript for PII before processing...');
        let anonymisedTranscript = transcript;
        let anonymisationInfo = null;

        try {
            // Check if anonymiser is available
            if (typeof window.clinicalAnonymiser !== 'undefined') {
                // Check for PII first
                const piiAnalysis = await window.clinicalAnonymiser.checkForPII(transcript);
                console.log('[ANONYMISER] PII Analysis:', piiAnalysis);

                if (piiAnalysis.containsPII) {
                    console.log('[ANONYMISER] PII detected, showing review interface...');

                    // Show PII review interface
                    const reviewResult = await showPIIReviewInterface(transcript, piiAnalysis);

                    if (reviewResult.approved) {
                        // Use the user-approved anonymised text
                        anonymisedTranscript = reviewResult.anonymisedText;
                        anonymisationInfo = {
                            originalLength: transcript.length,
                            anonymisedLength: anonymisedTranscript.length,
                            replacementsCount: reviewResult.replacementsCount,
                            riskLevel: piiAnalysis.riskLevel,
                            piiTypes: piiAnalysis.piiTypes,
                            userReviewed: true
                        };

                        console.log('[ANONYMISER] User approved anonymisation:', anonymisationInfo);

                        // Surface outcome via status message (decision itself happens in the PII UI)
                        const redactedCount = reviewResult.replacementsCount;
                        const itemLabel = redactedCount === 1 ? 'item' : 'items';
                        updateUser(`Privacy protection applied: ${redactedCount} personal ${itemLabel} redacted.`, false);
                    } else {
                        // User cancelled the review, use original transcript
                        console.log('[ANONYMISER] User cancelled PII review, using original transcript');
                        anonymisedTranscript = transcript;
                        updateUser('Privacy review cancelled – using original transcript.', false);
                    }
                } else {
                    console.log('[ANONYMISER] No significant PII detected');
                    updateUser('Privacy check complete – no significant personal information detected.', false);
                }
            } else {
                console.warn('[ANONYMISER] Anonymiser not available, using original transcript');
            }
        } catch (anonymisationError) {
            console.error('[ANONYMISER] Error during anonymisation:', anonymisationError);
            // Continue with original transcript if anonymisation fails
            anonymisedTranscript = transcript;
        }

        // Get user ID token
        const user = auth.currentUser;
        if (!user) {
            alert('Please sign in to use this feature');
            return;
        }
        const idToken = await user.getIdToken();

        // Update progress
        updateUser('Loading guidelines from database...', true);

        // Get guidelines and summaries from Firestore
        let guidelines = await loadGuidelinesFromFirestore();

        // Filter guidelines by scope if specified
        if (scope) {
            console.log('[DEBUG] Filtering guidelines by scope:', { scope, hospitalTrust, beforeFilter: guidelines.length });
            guidelines = filterGuidelinesByScope(guidelines, scope, hospitalTrust);
            console.log('[DEBUG] After filtering:', guidelines.length, 'guidelines');

            if (guidelines.length === 0) {
                const noGuidelinesMsg = 'No guidelines found for the selected scope.';
                updateUser(noGuidelinesMsg, false);
                alert('No guidelines found for the selected scope. Please try a different option or check your trust selection.');
                return;
            }

            // Add scope info via status message
            const scopeInfo = scope === 'national'
                ? `Searching ${guidelines.length} national guidelines...`
                : scope === 'local'
                    ? `Searching ${guidelines.length} local guidelines for ${hospitalTrust}...`
                    : `Searching ${guidelines.length} guidelines (National + ${hospitalTrust})...`;
            updateUser(scopeInfo, true);
        }

        console.log('[DEBUG] Sample guideline from Firestore before processing:', {
            sampleGuideline: guidelines[0],
            allKeys: guidelines[0] ? Object.keys(guidelines[0]) : 'no guidelines',
            hasDownloadUrl: !!(guidelines[0] && guidelines[0].downloadUrl),
            downloadUrlValue: guidelines[0] ? guidelines[0].downloadUrl : 'no guideline'
        });

        // Format guidelines with comprehensive information for better relevancy matching
        // PRESERVE downloadUrl and other important fields for the server
        const guidelinesList = guidelines.map(g => ({
            id: g.id,
            title: g.title,
            summary: g.summary,
            condensed: g.condensed,
            keywords: g.keywords,
            downloadUrl: g.downloadUrl, // Important: preserve downloadUrl
            originalFilename: g.originalFilename, // Important: preserve originalFilename  
            filename: g.filename, // Important: preserve filename
            organisation: g.organisation // Important: preserve organisation for display
        }));

        console.log('[DEBUG] Sample guideline being sent to server:', {
            sampleGuideline: guidelinesList[0],
            allKeys: guidelinesList[0] ? Object.keys(guidelinesList[0]) : 'no guidelines',
            hasDownloadUrl: !!(guidelinesList[0] && guidelinesList[0].downloadUrl),
            downloadUrlValue: guidelinesList[0] ? guidelinesList[0].downloadUrl : 'no most relevant'
        });

        // Update progress with guideline count
        const analyzeMessage = `Analysing transcript against ${guidelinesList.length} available guidelines...`;
        updateUser(analyzeMessage, true);

        console.log('[DEBUG] Sending request to /findRelevantGuidelines with:', {
            transcriptLength: anonymisedTranscript.length,
            originalLength: transcript.length,
            guidelinesCount: guidelinesList.length,
            anonymisationApplied: anonymisationInfo !== null
        });

        // AGGRESSIVE OPTIMIZATION: Only send metadata, let server load full guidelines
        console.log('[DEBUG] Using server-side guidelines loading for maximum payload reduction');
        console.log('[DEBUG] Guidelines available:', {
            totalGuidelines: guidelinesList.length,
            payloadSize: 'minimal - metadata only'
        });

        // Check for abort before fetch
        if (window.analysisAbortController?.signal.aborted) {
            throw new Error('Analysis cancelled');
        }

        updateUser('Finding relevant guidelines...', true);

        const response = await fetch(`${window.SERVER_URL}/findRelevantGuidelines`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${idToken}`
            },
            body: JSON.stringify({
                transcript: anonymisedTranscript, // Use anonymised transcript
                guidelinesCount: guidelinesList.length, // Just send count for verification
                loadGuidelinesOnServer: true, // Flag to load guidelines server-side
                anonymisationInfo: anonymisationInfo, // Include anonymisation metadata
                scope: scope, // Include scope filtering
                hospitalTrust: hospitalTrust // Include hospital trust for local filtering
            }),
            signal: window.analysisAbortController?.signal
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('[DEBUG] Server error response:', {
                status: response.status,
                statusText: response.statusText,
                errorText
            });
            throw new Error(`Server error: ${response.status} - ${errorText}`);
        }

        const data = await response.json();
        if (!data.success) {
            updateUser('Error finding guidelines', false);
            throw new Error(data.error || 'Failed to find relevant guidelines');
        }

        updateUser('Guidelines found', false);

        console.log('[DEBUG] Server response categories structure:', {
            categories: data.categories,
            mostRelevantCount: data.categories.mostRelevant?.length || 0,
            sampleMostRelevant: data.categories.mostRelevant?.[0],
            sampleKeys: data.categories.mostRelevant?.[0] ? Object.keys(data.categories.mostRelevant[0]) : 'no most relevant',
            hasDownloadUrl: !!(data.categories.mostRelevant?.[0] && data.categories.mostRelevant[0].downloadUrl),
            downloadUrlValue: data.categories.mostRelevant?.[0] ? data.categories.mostRelevant[0].downloadUrl : 'no most relevant',
            sampleRelevanceValue: data.categories.mostRelevant?.[0] ? data.categories.mostRelevant[0].relevance : 'no most relevant',
            sampleRelevanceType: data.categories.mostRelevant?.[0] ? typeof data.categories.mostRelevant[0].relevance : 'no most relevant'
        });

        // *** DEBUG: Log all guideline IDs returned from server ***
        const allServerGuidelineIds = [
            ...(data.categories.mostRelevant || []).map(g => g.id),
            ...(data.categories.potentiallyRelevant || []).map(g => g.id),
            ...(data.categories.lessRelevant || []).map(g => g.id)
        ];
        console.log('[DISPLAY DEBUG] ═══════════════════════════════════════════════════');
        console.log('[DISPLAY DEBUG] Server returned guideline IDs:', allServerGuidelineIds);
        console.log('[DISPLAY DEBUG] Total IDs:', allServerGuidelineIds.length);
        console.log('[DISPLAY DEBUG] ═══════════════════════════════════════════════════');

        // Enrich server response with local cached data AND filter by user's scope/hospitalTrust prefs
        // This is the ONLY place filtering happens - simple and easy to debug
        const filteredCategories = {};
        let totalBeforeFilter = 0;
        let totalAfterFilter = 0;

        for (const [category, guidelines] of Object.entries(data.categories)) {
            totalBeforeFilter += (guidelines || []).length;

            filteredCategories[category] = (guidelines || [])
                .map(g => {
                    // Server only sends {id, relevance} - look up full data from client cache
                    const fullGuidelineData = window.globalGuidelines?.[g.id];

                    if (!fullGuidelineData) {
                        console.warn(`[DEBUG] No cached data found for guideline ${g.id}`);
                        // Fallback: return minimal object with just id and relevance
                        return {
                            id: g.id,
                            relevance: g.relevance,
                            title: g.id,
                            displayName: null
                        };
                    }

                    // Combine: full cached data + relevance score from server
                    return {
                        ...fullGuidelineData,  // All Firestore fields (displayName, hospitalTrust, organisation, etc.)
                        relevance: g.relevance // Relevance score from server
                    };
                })
                .filter(g => {
                    // *** DEBUG: Log hospitalTrust value for each guideline being filtered ***
                    const gHospitalTrust = g.hospitalTrust;
                    const shouldInclude = (() => {
                        // Filter based on user's scope/hospitalTrust preferences
                        if (!scope || scope === 'national') {
                            // National only - exclude guidelines with hospitalTrust set
                            return !gHospitalTrust;
                        } else if (scope === 'local') {
                            // Local only - must match user's hospitalTrust
                            return gHospitalTrust === hospitalTrust;
                        } else if (scope === 'both') {
                            // National + user's trust - include if no hospitalTrust OR matches user's trust
                            if (!gHospitalTrust) return true; // National guideline
                            return gHospitalTrust === hospitalTrust; // Matches user's trust
                        }
                        return true; // Default: include
                    })();

                    // Log filtering decision for each guideline
                    console.log(`[FILTER DEBUG] ${g.id}:`, {
                        hospitalTrust: gHospitalTrust,
                        userTrust: hospitalTrust,
                        scope: scope,
                        matches: gHospitalTrust === hospitalTrust,
                        included: shouldInclude
                    });

                    return shouldInclude;
                });

            totalAfterFilter += filteredCategories[category].length;
        }

        console.log('[DEBUG] Filtered server results by user prefs:', {
            scope,
            hospitalTrust,
            totalBeforeFilter,
            totalAfterFilter,
            filtered: totalBeforeFilter - totalAfterFilter
        });

        // Update progress with completion
        const completionMessage = 'Analysis complete – categorising relevant guidelines...';
        updateUser(completionMessage, true);

        // Process and display the results with the new selection interface
        createGuidelineSelectionInterface(filteredCategories, window.relevantGuidelines);

        // Add final summary via status message
        const totalRelevant = (filteredCategories.mostRelevant?.length || 0) +
            (filteredCategories.potentiallyRelevant?.length || 0) +
            (filteredCategories.lessRelevant?.length || 0);

        const summaryMessage = `Found ${totalRelevant} relevant guidelines. Most: ${filteredCategories.mostRelevant?.length || 0}, potentially: ${filteredCategories.potentiallyRelevant?.length || 0}, less relevant: ${filteredCategories.lessRelevant?.length || 0}.`;

        updateUser(summaryMessage, false);
    } catch (error) {
        console.error('[DEBUG] Error in findRelevantGuidelines:', {
            error: error.message,
            stack: error.stack
        });

        // Display error via status message (alert also shown below)
        const errorMessage = `Error finding relevant guidelines: ${error.message}`;
        updateUser(errorMessage, false);

        alert('Error finding relevant guidelines: ' + error.message);
    } finally {
        // Reset button state
        if (findGuidelinesBtn) {
            findGuidelinesBtn.classList.remove('loading');
            findGuidelinesBtn.textContent = originalText;
            findGuidelinesBtn.disabled = false;
        }
    }
}

// Function to generate clinical note
async function generateClinicalNote() {
    console.log('[DEBUG] Starting generateClinicalNote function');
    const button = document.getElementById('generateClinicalNoteBtn');
    const originalText = button.textContent;
    button.textContent = 'Generating...';
    button.disabled = true;

    try {
        // Get the transcript content from userInput field
        const userInputValue = getUserInputContent();
        let transcript = userInputValue;

        console.log('[DEBUG] Getting transcript from userInput:', {
            userInputLength: userInputValue?.length,
            userInputPreview: userInputValue?.substring(0, 100) + '...'
        });

        if (!transcript || transcript.trim() === '') {
            console.error('[DEBUG] No transcript content found in either source');
            throw new Error('No transcript found or transcript is empty');
        }

        // ANONYMISATION STEP: Check and anonymise clinical data before sending to server
        console.log('[ANONYMISER] Checking transcript for PII before generating clinical note...');
        let anonymisedTranscript = transcript;
        let anonymisationInfo = null;

        try {
            // Check if anonymiser is available
            if (typeof window.clinicalAnonymiser !== 'undefined') {
                // Check for PII first
                const piiAnalysis = await window.clinicalAnonymiser.checkForPII(transcript);
                console.log('[ANONYMISER] PII Analysis:', piiAnalysis);

                if (piiAnalysis.containsPII) {
                    console.log('[ANONYMISER] PII detected, showing review interface...');

                    // Show PII review interface
                    const reviewResult = await showPIIReviewInterface(transcript, piiAnalysis);

                    if (reviewResult.approved) {
                        // Use the user-approved anonymised text
                        anonymisedTranscript = reviewResult.anonymisedText;
                        anonymisationInfo = {
                            originalLength: transcript.length,
                            anonymisedLength: anonymisedTranscript.length,
                            replacementsCount: reviewResult.replacementsCount,
                            riskLevel: piiAnalysis.riskLevel,
                            piiTypes: piiAnalysis.piiTypes,
                            userReviewed: true
                        };

                        console.log('[ANONYMISER] User approved anonymisation:', anonymisationInfo);

                        // Surface outcome via status message (decision itself happens in the PII UI)
                        const redactedCount = reviewResult.replacementsCount;
                        const itemLabel = redactedCount === 1 ? 'item' : 'items';
                        updateUser(`Privacy protection applied: ${redactedCount} personal ${itemLabel} redacted.`, false);
                    } else {
                        // User cancelled the review, use original transcript
                        console.log('[ANONYMISER] User cancelled PII review, using original transcript');
                        anonymisedTranscript = transcript;
                        updateUser('Privacy review cancelled – using original transcript.', false);
                    }
                } else {
                    console.log('[ANONYMISER] No significant PII detected');
                    updateUser('Privacy check complete – no significant personal information detected.', false);
                }
            } else {
                console.warn('[ANONYMISER] Anonymiser not available, using original transcript');
            }
        } catch (anonymisationError) {
            console.error('[ANONYMISER] Error during anonymisation:', anonymisationError);
            // Continue with original transcript if anonymisation fails
            anonymisedTranscript = transcript;
        }

        // Get the current user using imported auth object
        const user = auth.currentUser;
        if (!user) {
            console.error('[DEBUG] No authenticated user found');
            throw new Error('User not authenticated');
        }
        console.log('[DEBUG] User authenticated:', {
            email: user.email,
            uid: user.uid
        });

        // Get ID token for authentication
        const idToken = await user.getIdToken();
        console.log('[DEBUG] Got ID token');

        updateUser('Generating clinical note...', true);

        console.log('[DEBUG] Sending request to server...');
        const response = await fetch(`${window.SERVER_URL}/generateClinicalNote`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${idToken}`
            },
            body: JSON.stringify({
                transcript: anonymisedTranscript, // Use anonymised transcript
                anonymisationInfo: anonymisationInfo // Include anonymisation metadata
            })
        });

        console.log('[DEBUG] Server response status:', response.status);
        if (!response.ok) {
            const errorText = await response.text();
            console.error('[DEBUG] Server response error:', {
                status: response.status,
                errorText
            });
            throw new Error(`Failed to generate clinical note: ${response.status} ${errorText}`);
        }

        const data = await response.json();
        console.log('[DEBUG] Server response data:', {
            success: data.success,
            noteLength: data.note?.length
        });

        if (!data.success || !data.note) {
            console.error('[DEBUG] Invalid response format:', data);
            updateUser('Error generating note', false);
            throw new Error('Invalid response format from server');
        }

        updateUser('Clinical note generated', false);

        // Replace the user input with the generated note
        console.log('[DEBUG] Replacing user input with generated note');
        setUserInputContent(data.note, true, 'AI Generated Clinical Note');
        console.log('[DEBUG] Note replaced in user input successfully');

    } catch (error) {
        console.error('[DEBUG] Error in generateClinicalNote:', {
            error: error.message,
            stack: error.stack
        });
        updateUser('Error generating note', false);
        alert(`Error generating clinical note: ${error.message}`);
    } finally {
        // Reset button state
        button.textContent = originalText;
        button.disabled = false;
        console.log('[DEBUG] generateClinicalNote function completed');
    }
}

// Function to append content to summary1
// Debounced scrolling to handle rapid successive content additions
let scrollTimeout = null;
let pendingScrollTarget = null;

// Function to remove all transient messages from summary1
function removeTransientMessages() {
    console.log('[DEBUG] removeTransientMessages called');
    const summary1 = document.getElementById('summary1');
    if (!summary1) {
        console.error('[DEBUG] summary1 element not found');
        return;
    }

    const transientElements = summary1.querySelectorAll('[data-transient="true"]');
    console.log(`[DEBUG] Found ${transientElements.length} transient messages to remove`);

    transientElements.forEach((element, index) => {
        // Fade out animation
        element.style.transition = 'opacity 0.3s ease-out, max-height 0.3s ease-out';
        element.style.opacity = '0';
        element.style.maxHeight = '0';
        element.style.overflow = 'hidden';

        // Remove after animation completes
        setTimeout(() => {
            element.remove();
            console.log(`[DEBUG] Removed transient message ${index + 1}`);

            // After the last element is removed, re-evaluate visibility
            if (index === transientElements.length - 1) {
                setTimeout(() => {
                    if (typeof updateSummaryVisibility === 'function') {
                        updateSummaryVisibility();
                    }
                }, 50);
            }
        }, 300);
    });
}

// ==================== ANALYSE BUTTON PROGRESS INDICATOR ====================

function updateAnalyseButtonProgress(stepText = null, isActive = false) {
    const analyseBtn = document.getElementById('analyseBtn');
    const analyseSpinner = document.getElementById('analyseSpinner');
    const btnIcon = analyseBtn?.querySelector('.btn-icon');
    const btnText = analyseBtn?.querySelector('.btn-text');

    if (!analyseBtn) {
        console.warn('[PROGRESS] Analyse button not found');
        return;
    }

    console.log('[PROGRESS] Updating analyse button:', { stepText, isActive });

    if (isActive && stepText) {
        // Show progress with spinner
        if (analyseSpinner) analyseSpinner.style.display = 'inline-block';
        if (btnIcon) btnIcon.style.display = 'none';
        if (btnText) btnText.textContent = stepText;
        analyseBtn.disabled = true;
    } else if (stepText) {
        // Show completion message briefly, then reset
        if (analyseSpinner) analyseSpinner.style.display = 'none';
        if (btnIcon) btnIcon.style.display = 'inline';
        if (btnText) btnText.textContent = stepText;
        analyseBtn.disabled = false;

        // Reset after 2 seconds
        setTimeout(() => {
            if (btnIcon) btnIcon.style.display = 'inline';
            if (btnText) btnText.textContent = 'Analyse';
        }, 2000);
    } else {
        // Reset to default state
        if (analyseSpinner) analyseSpinner.style.display = 'none';
        if (btnIcon) btnIcon.style.display = 'inline';
        if (btnText) btnText.textContent = 'Analyse';
        analyseBtn.disabled = false;
    }
}

// ==================== END ANALYSE BUTTON PROGRESS ====================

// ==================== STREAMING ENGINE FOR SUMMARY1 ====================
// Modern ChatGPT-style streaming text reveal with intelligent pausing

const streamingEngine = {
    queue: [],
    isStreaming: false,
    isPaused: false,
    currentStreamController: null,
    charDelay: 10, // milliseconds per character (very fast streaming)

    // Add content to the streaming queue
    enqueue(contentWrapper, shouldPause, onComplete, options = {}) {
        console.log('[STREAMING] Enqueuing content for streaming', {
            hasInteractive: shouldPause,
            queueLength: this.queue.length,
            options
        });

        this.queue.push({
            wrapper: contentWrapper,
            shouldPause,
            onComplete,
            options
        });

        // Start processing if not already streaming
        if (!this.isStreaming) {
            this.processQueue();
        }
    },

    // Process the streaming queue
    async processQueue() {
        if (this.queue.length === 0) {
            this.isStreaming = false;
            console.log('[STREAMING] Queue empty, streaming stopped');
            return;
        }

        if (this.isPaused) {
            console.log('[STREAMING] Streaming paused, waiting for resume');
            return;
        }

        this.isStreaming = true;
        const item = this.queue.shift();

        console.log('[STREAMING] Processing queue item', {
            shouldPause: item.shouldPause,
            remainingInQueue: this.queue.length,
            action: item.options?.action || 'streamIn'
        });

        if (item.options?.action === 'unstream') {
            await this.unstreamElement(item.wrapper, item.onComplete);
        } else if (item.options?.action === 'wait') {
            await this.delay(item.options.duration || 1000);
            if (item.onComplete) item.onComplete();
        } else {
            await this.streamElement(item.wrapper, item.shouldPause, item.options);
            if (item.onComplete) item.onComplete();
        }

        // Continue with next item unless paused
        if (!this.isPaused) {
            this.processQueue();
        }
    },

    // Stream removal of an element's content (reverse typing)
    async unstreamElement(wrapper, onComplete) {
        console.log('[STREAMING] ◄◄◄ Starting unstream of element');

        if (!wrapper || !wrapper.parentNode) {
            console.log('[STREAMING] Wrapper missing, skipping unstream');
            if (onComplete) onComplete();
            return;
        }

        // Get text content to unstream
        const textContent = wrapper.textContent || '';

        // Create streaming container
        const streamContainer = document.createElement('div');
        streamContainer.className = 'streaming-container';
        streamContainer.style.display = 'inline';

        // Create cursor
        const cursor = document.createElement('span');
        cursor.className = 'streaming-cursor';
        cursor.textContent = '▋';

        // Replace content with streaming setup
        wrapper.innerHTML = '';
        wrapper.appendChild(streamContainer);
        wrapper.appendChild(cursor);

        let currentText = textContent;
        streamContainer.textContent = currentText;

        // Unstream character by character
        while (currentText.length > 0) {
            if (this.isPaused) {
                wrapper.remove();
                break;
            }

            currentText = currentText.slice(0, -1);
            streamContainer.textContent = currentText;

            await this.delay(this.charDelay);
        }

        // Clean up
        cursor.remove();
        wrapper.remove();

        console.log('[STREAMING] Unstream complete');

        if (onComplete) onComplete();
    },

    // Stream a single element's content
    async streamElement(wrapper, shouldPauseAfter, options = {}) {
        console.log('[STREAMING] ►►► Starting stream of element', {
            willPauseAfter: shouldPauseAfter,
            timestamp: new Date().toISOString(),
            forceStream: options?.forceStream
        });

        // Show the wrapper immediately
        wrapper.style.display = ''; // Restore default display (block)
        wrapper.style.opacity = '1';
        console.log('[STREAMING] Wrapper opacity set to 1 (visible)');

        // Extract all text content and HTML structure
        const originalHTML = wrapper.innerHTML;
        const textContent = wrapper.textContent || '';

        // Check for interactive elements first
        const interactiveElements = wrapper.querySelectorAll('button, select, input, textarea, [onclick]');
        const hasInteractiveElements = interactiveElements.length > 0;

        console.log('[STREAMING] Content analysis:', {
            textLength: textContent.length,
            hasInteractive: hasInteractiveElements,
            interactiveCount: interactiveElements.length,
            textPreview: textContent.substring(0, 200) + '...'
        });

        // OPTIMIZATION: Only stream short content character-by-character
        // For long content (>200 chars), show instantly to avoid delays
        const MAX_STREAM_LENGTH = 200;
        const shouldStreamFully = options.forceStream || (textContent.length <= MAX_STREAM_LENGTH && textContent.length >= 20);

        console.log('[STREAMING] Streaming decision:', {
            textLength: textContent.length,
            maxStreamLength: MAX_STREAM_LENGTH,
            shouldStreamFully,
            willShowInstantly: !options.forceStream && (textContent.length < 20 || textContent.length > MAX_STREAM_LENGTH)
        });

        if (!options.forceStream && (textContent.length < 20 || textContent.length > MAX_STREAM_LENGTH)) {
            console.log('[STREAMING] ⚡ INSTANT DISPLAY MODE', {
                reason: textContent.length < 20 ? 'too short' : 'too long for streaming',
                length: textContent.length
            });

            // Show interactive elements if present
            if (hasInteractiveElements && shouldPauseAfter) {
                console.log('[STREAMING] Has interactive elements, setting up pause...');
                // Small delay for visual effect
                await this.delay(100);

                const firstInteractive = interactiveElements[0];
                console.log('[STREAMING] Adding highlight to first interactive:', firstInteractive.tagName);
                firstInteractive.classList.add('streaming-paused-interactive');

                // Scroll to show the first interactive element (the buttons/controls)
                const summary1 = document.getElementById('summary1');
                if (summary1 && firstInteractive) {
                    requestAnimationFrame(() => {
                        const interactiveTop = firstInteractive.getBoundingClientRect().top;
                        const summary1Top = summary1.getBoundingClientRect().top;
                        const relativeTop = interactiveTop - summary1Top + summary1.scrollTop;
                        const targetScroll = Math.max(0, relativeTop - 100); // 100px buffer above
                        summary1.scrollTop = targetScroll;
                        console.log('[STREAMING] Scrolled to show interactive element');
                    });
                }

                // Pause streaming
                this.isPaused = true;
                console.log('[STREAMING] isPaused set to TRUE');

                // Set up auto-resume
                this.setupAutoResume(firstInteractive, interactiveElements);

                console.log('[STREAMING] ⏸️  PAUSED at interactive element (instant display mode)');
            } else {
                console.log('[STREAMING] No interactive pause needed');
            }
            console.log('[STREAMING] ✓✓ Instant display complete, returning');
            return;
        }

        // Stream short content with animation
        console.log('[STREAMING] Starting character-by-character streaming');

        // Hide interactive elements initially
        interactiveElements.forEach(el => {
            el.style.opacity = '0';
            el.style.transition = 'opacity 0.3s ease-in';
        });

        // Create a streaming container
        const streamContainer = document.createElement('div');
        streamContainer.className = 'streaming-container';
        streamContainer.style.display = 'inline';

        // Create cursor
        const cursor = document.createElement('span');
        cursor.className = 'streaming-cursor';
        cursor.textContent = '▋';

        // Clear wrapper and add streaming elements
        wrapper.innerHTML = '';
        wrapper.appendChild(streamContainer);
        wrapper.appendChild(cursor);

        // Stream the text content character by character
        let displayedText = '';

        for (let i = 0; i < textContent.length; i++) {
            if (this.isPaused) {
                // If paused, show remaining text instantly
                displayedText = textContent;
                break;
            }

            displayedText += textContent[i];
            streamContainer.textContent = displayedText;

            // Smooth scroll to keep cursor visible
            this.scrollToKeepVisible(cursor);

            await this.delay(this.charDelay);
        }

        // Remove cursor
        cursor.remove();

        // Restore original HTML to preserve formatting and structure
        wrapper.innerHTML = originalHTML;

        console.log('[STREAMING] Character streaming complete');

        console.log('[STREAMING] Text streaming complete, showing interactive elements');

        // Show interactive elements with fade-in
        if (hasInteractiveElements) {
            await this.delay(100); // Small delay before showing interactive elements

            const updatedInteractiveElements = wrapper.querySelectorAll('button, select, input, textarea, [onclick]');
            updatedInteractiveElements.forEach(el => {
                el.style.opacity = '1';
            });

            if (shouldPauseAfter) {
                console.log('[STREAMING] Interactive elements present, pausing for user interaction');

                // Highlight the first interactive element
                if (updatedInteractiveElements.length > 0) {
                    const firstInteractive = updatedInteractiveElements[0];
                    firstInteractive.classList.add('streaming-paused-interactive');

                    // Scroll to show the interactive element
                    const summary1 = document.getElementById('summary1');
                    if (summary1 && firstInteractive) {
                        requestAnimationFrame(() => {
                            const interactiveTop = firstInteractive.getBoundingClientRect().top;
                            const summary1Top = summary1.getBoundingClientRect().top;
                            const relativeTop = interactiveTop - summary1Top + summary1.scrollTop;
                            const targetScroll = Math.max(0, relativeTop - 100); // 100px buffer above
                            summary1.scrollTop = targetScroll;
                            console.log('[STREAMING] Scrolled to show interactive element after streaming');
                        });
                    }

                    // Pause streaming
                    this.isPaused = true;

                    // Set up auto-resume on any interaction
                    this.setupAutoResume(firstInteractive, updatedInteractiveElements);
                }
            }
        }

        console.log('[STREAMING] ✓✓✓ Element streaming FULLY COMPLETE');
    },

    // Check if an element is interactive (requires user decision)
    isInteractiveElement(element) {
        const tagName = element.tagName.toLowerCase();

        // Check for interactive tags
        if (['button', 'select', 'input', 'textarea'].includes(tagName)) {
            return true;
        }

        // Check for elements with click handlers or certain classes
        if (element.onclick ||
            element.getAttribute('onclick') ||
            element.classList.contains('btn') ||
            element.classList.contains('button') ||
            element.classList.contains('dropdown') ||
            element.querySelector('button, select, input')) {
            return true;
        }

        return false;
    },

    // Set up automatic resume when user interacts with any interactive element
    setupAutoResume(highlightedElement, allInteractiveElements) {
        const resumeHandler = (event) => {
            console.log('[STREAMING] User interaction detected, resuming stream');

            // Remove highlight from all elements
            allInteractiveElements.forEach(el => {
                el.classList.remove('streaming-paused-interactive');
            });

            // Resume streaming
            this.resume();

            // Remove listeners from all elements
            allInteractiveElements.forEach(el => {
                el.removeEventListener('click', resumeHandler);
                el.removeEventListener('change', resumeHandler);
            });
        };

        // Add listeners to all interactive elements
        allInteractiveElements.forEach(el => {
            el.addEventListener('click', resumeHandler, { once: true });
            el.addEventListener('change', resumeHandler, { once: true });
        });
    },

    // Scroll to keep the streaming cursor visible
    scrollToKeepVisible(cursor) {
        const summary1 = document.getElementById('summary1');
        if (!summary1 || !cursor.parentNode) return;

        const cursorRect = cursor.getBoundingClientRect();
        const containerRect = summary1.getBoundingClientRect();

        // Check if cursor is below viewport
        if (cursorRect.bottom > containerRect.bottom - 50) {
            const scrollAmount = cursorRect.bottom - containerRect.bottom + 50;
            summary1.scrollTop += scrollAmount;
        }
    },

    // Resume streaming after pause
    resume() {
        console.log('[STREAMING] Resuming streaming');
        this.isPaused = false;
        this.processQueue();
    },

    // Stop all streaming and clear queue
    stop() {
        console.log('[STREAMING] Stopping all streaming');
        this.queue = [];
        this.isStreaming = false;
        this.isPaused = false;

        if (this.currentStreamController) {
            this.currentStreamController.abort();
            this.currentStreamController = null;
        }
    },

    // Utility delay function
    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
};

// ==================== END STREAMING ENGINE ====================

// Utility: strip emoji/icon characters from text before rendering in summary1
function stripSummaryEmojis(text) {
    if (!text || typeof text !== 'string') return text;

    try {
        // Preferred: use Unicode property escapes for pictographic symbols
        const emojiRegex = /\p{Extended_Pictographic}/gu;
        return text.replace(emojiRegex, '');
    } catch (e) {
        // Fallback for environments without Unicode property escapes:
        // remove common emoji/icon blocks
        const basicEmojiRegex = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu;
        return text.replace(basicEmojiRegex, '');
    }
}

function appendToSummary1(content, clearExisting = false, isTransient = false, options = {}) {
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('[SUMMARY1 DEBUG] appendToSummary1 called with:', {
        contentLength: content?.length,
        clearExisting,
        isTransient,
        options,
        timestamp: new Date().toISOString()
    });
    console.log('[SUMMARY1 DEBUG] Full content:', content);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    const summary1 = document.getElementById('summary1');
    if (!summary1) {
        console.error('[DEBUG] summary1 element not found');
        return;
    }

    try {
        // Clear existing content if requested
        if (clearExisting) {
            // Stop any active streaming
            streamingEngine.stop();

            summary1.innerHTML = '';
            // Reset scroll tracking when clearing content
            pendingScrollTarget = null;
            if (scrollTimeout) {
                clearTimeout(scrollTimeout);
                scrollTimeout = null;
            }
            // Re-add loading spinner container if it was cleared
            const loadingSpinner = document.getElementById('summaryLoadingSpinner');
            if (!loadingSpinner) {
                const spinnerDiv = document.createElement('div');
                spinnerDiv.id = 'summaryLoadingSpinner';
                spinnerDiv.className = 'summary-loading-spinner hidden';
                spinnerDiv.innerHTML = '<div class="spinner-circle"></div><span class="loading-text">Processing...</span>';
                summary1.appendChild(spinnerDiv);
            }
        }

        // Hide loading spinner when content is being added
        hideSummaryLoading();

        // Normalise content for summary1: strip emojis/icons so typography stays clean
        const sanitizedContent = typeof content === 'string' ? stripSummaryEmojis(content) : content;

        // Check if content is already HTML
        const isHtml = typeof sanitizedContent === 'string' && /<[a-z][\s\S]*>/i.test(sanitizedContent);
        console.log('[DEBUG] Content type check:', { isHtml });

        let processedContent;
        if (isHtml) {
            // If content is already HTML, use it directly
            processedContent = sanitizedContent;
        } else {
            // If content is markdown, parse it with marked
            if (!window.marked) {
                console.error('[DEBUG] Marked library not loaded');
                processedContent = sanitizedContent;
            } else {
                try {
                    processedContent = window.marked.parse(sanitizedContent);
                    console.log('[DEBUG] Marked parsing successful');
                } catch (parseError) {
                    console.error('[DEBUG] Error parsing with marked:', parseError);
                    processedContent = sanitizedContent;
                }
            }
        }

        // Create a temporary container to sanitize the content
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = processedContent;

        // Create a wrapper div for the new content
        const newContentWrapper = document.createElement('div');
        newContentWrapper.className = 'new-content-entry';
        if (isTransient) {
            newContentWrapper.setAttribute('data-transient', 'true');
            newContentWrapper.classList.add('transient-message');
        }
        newContentWrapper.innerHTML = tempDiv.innerHTML;

        // Append the sanitized content to DOM
        summary1.appendChild(newContentWrapper);
        console.log('[SUMMARY1 DEBUG] Content appended to DOM successfully', isTransient ? '(transient)' : '(permanent)');
        console.log('[SUMMARY1 DEBUG] Wrapper innerHTML:', newContentWrapper.innerHTML);
        console.log('[SUMMARY1 DEBUG] Wrapper textContent length:', newContentWrapper.textContent?.length);

        // STREAMING DECISION POINT
        if (options.streamEffect === 'in-out') {
            console.log('[SUMMARY1 DEBUG] ✓ STREAM TRANSIENT PATH - appearing and disappearing by stream');

            // Start hidden and collapsed
            newContentWrapper.style.opacity = '0';
            newContentWrapper.style.display = 'none'; // Hide from layout until streamed

            // 1. Stream In
            streamingEngine.enqueue(
                newContentWrapper,
                false,
                () => {
                    console.log('[SUMMARY1 DEBUG] Stream transient IN complete');
                    updateSummaryVisibility();
                    updateSummaryCriticalStatus();
                },
                { forceStream: true, action: 'streamIn' }
            );

            // 2. Wait
            streamingEngine.enqueue(
                null,
                false,
                null,
                { action: 'wait', duration: options.transientDelay || 5000 }
            );

            // 3. Stream Out
            streamingEngine.enqueue(
                newContentWrapper,
                false,
                () => {
                    // On removal complete
                    console.log('[SUMMARY1 DEBUG] Stream transient removal complete');
                    updateSummaryVisibility();
                    updateSummaryCriticalStatus();
                },
                { action: 'unstream' }
            );

        } else if (isTransient) {
            // Transient messages: show instantly, no streaming, auto-remove after delay
            console.log('[SUMMARY1 DEBUG] ✓ TRANSIENT PATH - showing instantly, will auto-remove after 5s');
            newContentWrapper.style.opacity = '1';

            // Auto-remove transient messages after 5 seconds
            setTimeout(() => {
                if (newContentWrapper.parentNode) {
                    console.log('[SUMMARY1 DEBUG] Auto-removing transient message');
                    newContentWrapper.style.transition = 'opacity 0.5s ease-out, max-height 0.5s ease-out';
                    newContentWrapper.style.opacity = '0';
                    newContentWrapper.style.maxHeight = '0';
                    newContentWrapper.style.overflow = 'hidden';

                    setTimeout(() => {
                        if (newContentWrapper.parentNode) {
                            newContentWrapper.remove();
                        }
                    }, 500);
                }
            }, 5000);

            // Don't scroll for transient messages - they're temporary
            console.log('[SUMMARY1 DEBUG] Transient content shown (no scroll)');
        } else {
            // Permanent content: use streaming engine
            console.log('[SUMMARY1 DEBUG] ✓ PERMANENT PATH - queueing for streaming');

            // Check if content has interactive elements
            const hasInteractive = streamingEngine.isInteractiveElement(newContentWrapper) ||
                newContentWrapper.querySelector('button, select, input, textarea, [onclick]');

            const interactiveElements = newContentWrapper.querySelectorAll('button, select, input, textarea, [onclick]');
            console.log('[SUMMARY1 DEBUG] Interactive elements check:', {
                hasInteractive,
                elementCount: interactiveElements.length,
                elementTypes: Array.from(interactiveElements).map(el => el.tagName)
            });

            // Enqueue for streaming
            console.log('[SUMMARY1 DEBUG] Enqueueing content to streaming engine...');
            streamingEngine.enqueue(
                newContentWrapper,
                hasInteractive, // Should pause after streaming if interactive
                () => {
                    // On completion callback
                    console.log('[SUMMARY1 DEBUG] ✓✓✓ Streaming COMPLETE for this content block');
                    updateSummaryVisibility();
                    updateSummaryCriticalStatus();
                }
            );
        }

        // Update summary visibility for transient messages
        if (isTransient) {
            setTimeout(() => {
                updateSummaryVisibility();
                updateSummaryCriticalStatus();
            }, 100);
        }

    } catch (error) {
        console.error('[DEBUG] Error in appendToSummary1:', error);
        // Fallback to direct content append if something goes wrong
        summary1.innerHTML += content;
        // Update visibility even on error
        setTimeout(() => {
            updateSummaryVisibility();
            updateSummaryCriticalStatus();
        }, 100);
    }
}

// Helper for decision-only UIs in summary1.
// Use this for new code that renders interactive panels where the user must make a choice.
function appendDecisionUIToSummary(htmlContent, clearExisting = false, options = {}) {
    appendToSummary1(htmlContent, clearExisting, false, options);
}

// Function to replace content in the user input field
function appendToOutputField(content, clearExisting = true, isHtml = false) {
    console.log('[DEBUG] appendToOutputField called (now replacing user input) with:', {
        contentLength: content?.length,
        clearExisting,
        isHtml,
        contentPreview: content?.substring(0, 100) + '...'
    });

    const userInput = document.getElementById('userInput');
    if (!userInput) {
        console.error('[DEBUG] userInput element not found');
        return;
    }

    try {
        let processedContent = content;

        if (isHtml) {
            // If isHtml is explicitly true, trust the content
            processedContent = content;
        } else if (/<[a-z][\s\S]*>/i.test(content)) {
            // If HTML is detected but isHtml is false, strip tags (legacy behavior)
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = content;
            processedContent = tempDiv.textContent || tempDiv.innerText || '';
        }

        if (clearExisting) {
            setUserInputContent(processedContent, true, 'Content Replacement', null, isHtml);
        } else {
            // If appending, we need to get current content as HTML if new content is HTML
            const editor = window.editors?.userInput;
            if (editor) {
                const currentContent = isHtml ? editor.getHTML() : getUserInputContent();
                const separator = isHtml ? '<br><br>' : '\n\n';
                const newContent = currentContent + separator + processedContent;
                setUserInputContent(newContent, true, 'Content Addition', null, isHtml);
            } else {
                // Fallback
                const currentContent = getUserInputContent();
                setUserInputContent(currentContent + '\n\n' + processedContent, true, 'Content Addition', null, false);
            }
        }

        console.log('[DEBUG] Content replaced in user input successfully');
    } catch (error) {
        console.error('[DEBUG] Error in appendToOutputField:', error);
        setUserInputContent(content, true, 'Error Recovery');
    }
}

// Helper: ensure text is anonymised before outbound requests
async function ensureAnonymisedForOutbound(originalText) {
    let anonymisedText = originalText;
    let anonymisationInfo = null;

    try {
        if (typeof window.clinicalAnonymiser !== 'undefined') {
            const piiAnalysis = await window.clinicalAnonymiser.checkForPII(originalText);
            if (piiAnalysis.containsPII) {
                const reviewResult = await showPIIReviewInterface(originalText, piiAnalysis);
                if (reviewResult.approved) {
                    anonymisedText = reviewResult.anonymisedText;
                    anonymisationInfo = {
                        originalLength: originalText.length,
                        anonymisedLength: anonymisedText.length,
                        replacementsCount: reviewResult.replacementsCount,
                        riskLevel: piiAnalysis.riskLevel,
                        piiTypes: piiAnalysis.piiTypes,
                        userReviewed: true
                    };
                }
            }
        }
    } catch (error) {
        console.warn('[ANONYMISER] Error during ensureAnonymisedForOutbound:', error);
        anonymisedText = originalText;
    }

    return { anonymisedText, anonymisationInfo };
}

// Update checkAgainstGuidelines to use stored relevant guidelines
async function checkAgainstGuidelines(suppressHeader = false) {
    const checkGuidelinesBtn = document.getElementById('checkGuidelinesBtn');
    const originalText = checkGuidelinesBtn.textContent;

    try {
        console.log('[DEBUG] Starting checkAgainstGuidelines...');

        const transcript = getUserInputContent();
        if (!transcript) {
            console.log('[DEBUG] No transcript found in userInput');
            alert('Please enter some text first');
            return;
        }
        console.log('[DEBUG] Transcript length:', transcript.length);

        if (!window.relevantGuidelines || window.relevantGuidelines.length === 0) {
            console.log('[DEBUG] No relevant guidelines found in window.relevantGuidelines');
            console.log('[DEBUG] window.relevantGuidelines:', window.relevantGuidelines);
            alert('Please find relevant guidelines first');
            return;
        }
        console.log('[DEBUG] Number of relevant guidelines:', window.relevantGuidelines.length);

        // Set loading state
        checkGuidelinesBtn.classList.add('loading');
        checkGuidelinesBtn.disabled = true;

        // Get user ID token
        const user = auth.currentUser;
        if (!user) {
            console.log('[DEBUG] No authenticated user found');
            alert('Please sign in to use this feature');
            return;
        }
        console.log('[DEBUG] User authenticated:', { email: user.email, uid: user.uid });

        const idToken = await user.getIdToken();
        console.log('[DEBUG] Got ID token');

        // Ensure anonymisation before outbound calls
        let anonymisedTranscript = transcript;
        try {
            if (typeof ensureAnonymisedForOutbound === 'function') {
                const { anonymisedText } = await ensureAnonymisedForOutbound(transcript);
                anonymisedTranscript = anonymisedText || transcript;
            } else if (typeof window.clinicalAnonymiser !== 'undefined') {
                // Fallback inline anonymisation if helper is unavailable
                const piiAnalysis = await window.clinicalAnonymiser.checkForPII(transcript);
                if (piiAnalysis.containsPII) {
                    const reviewResult = await showPIIReviewInterface(transcript, piiAnalysis);
                    if (reviewResult.approved) {
                        anonymisedTranscript = reviewResult.anonymisedText;
                    }
                }
            }
        } catch (anonError) {
            console.warn('[ANONYMISER] Proceeding without anonymisation due to error:', anonError);
            anonymisedTranscript = transcript;
        }

        // Check if guidelines are loaded in cache
        console.log('[DEBUG] Checking guideline cache status:', {
            hasGlobalGuidelines: !!window.globalGuidelines,
            cacheSize: window.globalGuidelines ? Object.keys(window.globalGuidelines).length : 0,
            cacheKeys: window.globalGuidelines ? Object.keys(window.globalGuidelines) : []
        });

        // Reload guidelines from Firestore to ensure we have the latest data
        try {
            console.log('[DEBUG] Reloading guidelines from Firestore...');
            const guidelines = await window.loadGuidelinesFromFirestore();
            console.log('[DEBUG] Reloaded guidelines from Firestore:', {
                success: !!guidelines,
                count: guidelines?.length || 0
            });
        } catch (error) {
            console.error('[DEBUG] Failed to reload guidelines:', error);
            throw new Error('Failed to load guidelines from Firestore');
        }

        // Initialize the analysis summary (unless called from process workflow)
        let formattedAnalysis = '';
        if (!suppressHeader) {
            formattedAnalysis = '## Analysis Against Guidelines\n\n';
            appendToOutputField(formattedAnalysis, true);
        }

        let successCount = 0;
        let errorCount = 0;

        // Helper function to find guideline by multiple matching criteria
        function findGuidelineInCache(targetGuideline) {
            // Method 1: Direct key lookup (original method)
            let found = window.globalGuidelines[targetGuideline.id];
            if (found) {
                console.log(`[DEBUG] Found guideline by direct ID: ${targetGuideline.id}`);
                return found;
            }

            // Method 2: Search by filename match
            const guidelines = Object.values(window.globalGuidelines);
            found = guidelines.find(g =>
                g.filename === targetGuideline.id ||
                (g.title && g.title === targetGuideline.id)
            );
            if (found) {
                console.log(`[DEBUG] Found guideline by filename match: ${targetGuideline.id} -> ${found.id}`);
                return found;
            }

            // Method 3: Search by title similarity
            const targetTitle = targetGuideline.humanFriendlyTitle || targetGuideline.title || targetGuideline.id;
            if (targetTitle && targetTitle.length > 5) {
                found = guidelines.find(g => {
                    if (!g.title) return false;

                    // Normalize titles for comparison
                    const normalizeTitle = (title) => title.toLowerCase()
                        .replace(/[^a-z0-9\s]/g, ' ')
                        .replace(/\s+/g, ' ')
                        .trim();

                    const normalizedTarget = normalizeTitle(targetTitle);
                    const normalizedGuideline = normalizeTitle(g.title);

                    // Check for exact match first
                    if (normalizedTarget === normalizedGuideline) return true;

                    // Check for substantial overlap (80% match)
                    const targetWords = normalizedTarget.split(' ').filter(w => w.length > 2);
                    const guidelineWords = normalizedGuideline.split(' ').filter(w => w.length > 2);

                    if (targetWords.length === 0 || guidelineWords.length === 0) return false;

                    const matchedWords = targetWords.filter(word =>
                        guidelineWords.some(gWord => gWord.includes(word) || word.includes(gWord))
                    );

                    const similarity = matchedWords.length / Math.max(targetWords.length, guidelineWords.length);
                    return similarity >= 0.6; // 60% word overlap threshold
                });

                if (found) {
                    console.log(`[DEBUG] Found guideline by title similarity: "${targetTitle}" -> "${found.title}" (${found.id})`);
                    return found;
                }
            }

            // Method 4: Search by partial filename match (for cases like "ESHRE - PCOS - 2023.pdf" vs "ESHRE - PCOS - 2023")
            found = guidelines.find(g => {
                if (!g.filename || !targetGuideline.id) return false;

                const normalizeFilename = (filename) => filename.toLowerCase()
                    .replace('.pdf', '')
                    .replace(/[^a-z0-9\s]/g, ' ')
                    .replace(/\s+/g, ' ')
                    .trim();

                const normalizedTarget = normalizeFilename(targetGuideline.id);
                const normalizedFilename = normalizeFilename(g.filename);

                return normalizedTarget.includes(normalizedFilename) ||
                    normalizedFilename.includes(normalizedTarget);
            });

            if (found) {
                console.log(`[DEBUG] Found guideline by partial filename match: ${targetGuideline.id} -> ${found.filename} (${found.id})`);
                return found;
            }

            return null;
        }

        // Get most relevant guidelines (filter by category)
        const mostRelevantGuidelines = window.relevantGuidelines.filter(g => g.category === 'mostRelevant');

        console.log('[DEBUG] Found most relevant guidelines:', {
            total: mostRelevantGuidelines.length,
            guidelines: mostRelevantGuidelines.map(g => ({ id: g.id, title: g.title, relevance: g.relevance }))
        });

        // Determine which guidelines to process
        let guidelinesToProcess = [];
        const MAX_AUTO_PROCESS = 5;

        if (mostRelevantGuidelines.length === 0) {
            throw new Error('No "most relevant" guidelines found. Please ensure guidelines have been properly categorized.');
        } else if (mostRelevantGuidelines.length <= MAX_AUTO_PROCESS) {
            // Auto-process all if 5 or fewer
            guidelinesToProcess = mostRelevantGuidelines;
            console.log(`[DEBUG] Auto-processing all ${guidelinesToProcess.length} most relevant guidelines`);
        } else {
            // Show selection interface if more than 5
            console.log(`[DEBUG] Found ${mostRelevantGuidelines.length} most relevant guidelines, showing selection interface`);

            const selectionMessage = `
                <div class="guideline-auto-selection">
                    <h4>📋 Multiple Relevant Guidelines Found</h4>
                    <p>Found <strong>${mostRelevantGuidelines.length}</strong> highly relevant guidelines. To ensure timely processing, we'll analyze the <strong>top ${MAX_AUTO_PROCESS}</strong> by default.</p>
                    <div class="auto-selected-guidelines">
                        <p><strong>Selected for analysis:</strong></p>
                        <ul>
                            ${mostRelevantGuidelines.slice(0, MAX_AUTO_PROCESS).map(g => {
                const guidelineData = window.globalGuidelines[g.id];
                const displayTitle = guidelineData?.humanFriendlyTitle || guidelineData?.title || g.title || g.id;
                return `<li>${displayTitle} <span class="relevance">(relevance: ${g.relevance || 'N/A'})</span></li>`;
            }).join('')}
                        </ul>
                    </div>
                    <p><em>💡 After this analysis, you can use "Make Advice Dynamic" to select different guidelines or include additional ones.</em></p>
                </div>
                
                <style>
                .guideline-auto-selection {
                    background: #e8f4fd;
                    border: 1px solid #2196f3;
                    border-radius: 6px;
                    padding: 15px;
                    margin: 10px 0;
                }
                .guideline-auto-selection h4 {
                    margin: 0 0 10px 0;
                    color: #1976d2;
                }
                .auto-selected-guidelines {
                    background: white;
                    border-radius: 4px;
                    padding: 10px;
                    margin: 10px 0;
                }
                .auto-selected-guidelines ul {
                    margin: 5px 0 0 0;
                    padding-left: 20px;
                }
                .auto-selected-guidelines li {
                    margin-bottom: 5px;
                    color: #1976d2;
                }
                .relevance {
                    color: #666;
                    font-size: 0.9em;
                }
                </style>
            `;

            appendToOutputField(selectionMessage, true);

            // Use top 5 guidelines
            guidelinesToProcess = mostRelevantGuidelines.slice(0, MAX_AUTO_PROCESS);
        }

        // Update UI to show guidelines being processed (status bar only)
        const processingStatus = `Analysing against ${guidelinesToProcess.length} most relevant guideline${guidelinesToProcess.length > 1 ? 's' : ''}...`;
        updateUser(processingStatus, true);

        // Process guidelines in parallel for better performance
        const guidelinePromises = guidelinesToProcess.map(async (relevantGuideline, index) => {
            const guidelineData = findGuidelineInCache(relevantGuideline);
            const guidelineTitle = guidelineData?.humanFriendlyTitle || guidelineData?.title || relevantGuideline.filename || relevantGuideline.title;

            console.log(`[DEBUG] Processing guideline ${index + 1}/${guidelinesToProcess.length}: ${guidelineTitle}`);

            try {
                if (!guidelineData) {
                    console.error('[DEBUG] Guideline not found in cache:', {
                        title: guidelineTitle,
                        availableGuidelines: Object.keys(window.globalGuidelines)
                    });

                    return {
                        guideline: guidelineTitle,
                        error: 'Guideline not found in cache. Please try finding relevant guidelines again.',
                        analysis: null,
                        success: false
                    };
                }

                // Send to server for analysis
                const response = await fetch(`${window.SERVER_URL}/analyzeNoteAgainstGuideline`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${idToken}`
                    },
                    body: JSON.stringify({
                        transcript: anonymisedTranscript,
                        guideline: guidelineData.id
                    })
                });

                console.log(`[DEBUG] Server response for ${guidelineTitle}:`, {
                    status: response.status,
                    ok: response.ok,
                    statusText: response.statusText
                });

                if (!response.ok) {
                    const errorText = await response.text();
                    console.error('[DEBUG] Server error response:', {
                        status: response.status,
                        statusText: response.statusText,
                        errorText,
                        guideline: guidelineTitle
                    });

                    // Try to parse the error message
                    let errorMessage = 'Server error';
                    try {
                        const errorJson = JSON.parse(errorText);
                        errorMessage = errorJson.error || errorMessage;
                    } catch (e) {
                        errorMessage = errorText || errorMessage;
                    }

                    return {
                        guideline: guidelineTitle,
                        error: errorMessage,
                        analysis: null,
                        success: false
                    };
                }

                const result = await response.json();
                if (!result.success) {
                    return {
                        guideline: guidelineTitle,
                        error: result.error || 'Analysis failed',
                        analysis: null,
                        success: false
                    };
                }

                return {
                    guideline: guidelineTitle,
                    analysis: result.analysis,
                    success: true
                };

            } catch (error) {
                console.error(`[DEBUG] Error processing guideline ${guidelineTitle}:`, error);
                return {
                    guideline: guidelineTitle,
                    error: error.message,
                    analysis: null,
                    success: false
                };
            }
        });

        // Wait for all guidelines to be processed
        console.log('[DEBUG] Waiting for all guideline processing to complete...');
        const results = await Promise.all(guidelinePromises);

        // Process results
        results.forEach(result => {
            if (result.success) {
                const analysisSection = `### ${result.guideline}\n\n${result.analysis}\n\n`;
                formattedAnalysis += analysisSection;
                successCount++;
                appendToOutputField(analysisSection, true);
            } else {
                const errorSection = `### ${result.guideline}\n\n⚠️ Error: ${result.error}\n\n`;
                formattedAnalysis += errorSection;
                errorCount++;
                appendToOutputField(errorSection, true); // Append, don't clear
            }
        });

        // Add summary of results
        console.log('[DEBUG] Analysis summary:', {
            successCount,
            errorCount,
            guidelinesProcessed: guidelinesToProcess.length,
            totalRelevantGuidelines: window.relevantGuidelines.length,
            analyzedMultiple: guidelinesToProcess.length > 1
        });

        const summarySection = `\n## Summary\n\nAnalyzed against ${guidelinesToProcess.length} most relevant guideline${guidelinesToProcess.length > 1 ? 's' : ''}${successCount > 0 ? ' successfully' : ''}.\n`;
        const failureSection = errorCount > 0 ? `${errorCount} analysis failed.\n` : '';
        const additionalInfo = `\n*Note: Found ${window.relevantGuidelines.length} relevant guidelines total, analyzed against the top ${guidelinesToProcess.length} most relevant.*\n`;
        const finalSummary = summarySection + failureSection + additionalInfo;

        formattedAnalysis += finalSummary;
        appendToOutputField(finalSummary, true); // Append, don't clear

        // Store the latest analysis result and guideline data for guideline suggestions
        if (successCount > 0) {
            console.log('[DEBUG] Storing analysis result for guideline suggestions');

            // Store the combined analysis and the guidelines that were processed
            const processedGuidelineData = guidelinesToProcess.map(g => {
                const guidelineData = window.globalGuidelines[g.id];
                return {
                    id: g.id,
                    title: guidelineData?.humanFriendlyTitle || guidelineData?.title || g.title || g.id,
                    relevance: g.relevance || 'N/A'
                };
            });

            window.latestAnalysis = {
                analysis: formattedAnalysis,
                transcript: transcript,
                guidelineId: processedGuidelineData[0].id, // For backward compatibility
                guidelineTitle: processedGuidelineData[0].title, // For backward compatibility
                processedGuidelines: processedGuidelineData,
                multiGuideline: guidelinesToProcess.length > 1,
                analysisResults: results, // Store all results for auto-processing
                timestamp: new Date().toISOString()
            };

            // If multiple guidelines were processed, automatically generate combined suggestions
            if (guidelinesToProcess.length > 1) {
                console.log('[DEBUG] Auto-generating combined suggestions for', successCount, 'successful guidelines');

                // Filter to only successful results
                const successfulResults = results.filter(r => !r.error);

                // Add a small delay to let the analysis display complete
                setTimeout(async () => {
                    try {
                        await generateCombinedInteractiveSuggestions(successfulResults);
                    } catch (error) {
                        console.error('[DEBUG] Error auto-generating combined suggestions:', error);
                        // Show the fallback button if auto-generation fails
                        const makeDynamicAdviceBtn = document.getElementById('makeDynamicAdviceBtn');
                        if (makeDynamicAdviceBtn) {
                            makeDynamicAdviceBtn.style.display = 'inline-block';
                            console.log('[DEBUG] Showed fallback guideline suggestions button');
                        }
                    }
                }, 1000);
            } else {
                // For single guideline, show the "Make Advice Dynamic" button as before
                const makeDynamicAdviceBtn = document.getElementById('makeDynamicAdviceBtn');
                if (makeDynamicAdviceBtn) {
                    makeDynamicAdviceBtn.style.display = 'inline-block';
                    console.log('[DEBUG] Made guideline suggestions button visible for single guideline');
                }
            }
        }

        debouncedSaveState(); // Save state after checking guidelines

    } catch (error) {
        console.error('[DEBUG] Error in checkAgainstGuidelines:', error);
        alert(`Error checking guidelines: ${error.message}`);
    } finally {
        // Reset button state
        checkGuidelinesBtn.classList.remove('loading');
        checkGuidelinesBtn.disabled = false;
        console.log('[DEBUG] checkAgainstGuidelines completed');
    }
}

// Guideline Suggestions function - converts guideline analysis into interactive suggestions
async function dynamicAdvice(transcript, analysis, guidelineId, guidelineTitle) {
    console.log('[DEBUG] dynamicAdvice function called', {
        transcriptLength: transcript?.length,
        analysisLength: analysis?.length,
        guidelineId,
        guidelineTitle
    });

    try {
        // Get user ID token
        const user = auth.currentUser;
        if (!user) {
            console.log('[DEBUG] dynamicAdvice: No authenticated user found');
            throw new Error('User not authenticated');
        }

        const idToken = await user.getIdToken();
        console.log('[DEBUG] dynamicAdvice: Got ID token');

        updateUser(`Generating suggestions for ${guidelineTitle}...`, true);

        // Call the dynamicAdvice API with retry logic
        console.log('[DEBUG] dynamicAdvice: Calling API endpoint');
        let response;
        let retryCount = 0;
        const maxRetries = 3;

        while (retryCount <= maxRetries) {
            try {
                response = await fetch(`${window.SERVER_URL}/dynamicAdvice`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${idToken}`
                    },
                    body: JSON.stringify({
                        transcript,
                        analysis,
                        guidelineId,
                        guidelineTitle
                    })
                });

                // If successful, break out of retry loop
                if (response.ok) {
                    break;
                }

                // If 502/503/504 (server errors), retry
                if ([502, 503, 504].includes(response.status)) {
                    throw new Error(`Server error ${response.status} - retrying...`);
                }

                // For other errors, don't retry
                break;

            } catch (error) {
                retryCount++;
                console.log(`[DEBUG] dynamicAdvice: Attempt ${retryCount} failed:`, error.message);

                if (retryCount <= maxRetries) {
                    const waitTime = Math.min(1000 * Math.pow(2, retryCount - 1), 10000); // Exponential backoff, max 10s
                    console.log(`[DEBUG] dynamicAdvice: Waiting ${waitTime}ms before retry ${retryCount}/${maxRetries}`);
                    await new Promise(resolve => setTimeout(resolve, waitTime));
                } else {
                    throw error;
                }
            }
        }

        console.log('[DEBUG] dynamicAdvice: API response received', {
            status: response.status,
            ok: response.ok,
            statusText: response.statusText
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('[DEBUG] dynamicAdvice: API error response:', {
                status: response.status,
                statusText: response.statusText,
                errorText
            });
            throw new Error(`API error: ${response.status} - ${errorText}`);
        }

        const result = await response.json();
        console.log('[DEBUG] dynamicAdvice: API result received', {
            success: result.success,
            sessionId: result.sessionId,
            suggestionsCount: result.suggestions?.length,
            guidelineId: result.guidelineId,
            guidelineTitle: result.guidelineTitle
        });

        if (!result.success) {
            updateUser('Error generating suggestions', false);
            throw new Error(result.error || 'Guideline suggestions generation failed');
        }

        updateUser('Suggestions generated', false);

        // Store session data globally and ensure unique suggestion IDs
        currentAdviceSession = result.sessionId;

        // Add session prefix to suggestion IDs to prevent conflicts in sequential processing
        const prefixedSuggestions = (result.suggestions || []).map(suggestion => ({
            ...suggestion,
            originalId: suggestion.id, // Keep original ID for server communication
            id: `${result.sessionId}-${suggestion.id}`, // Use prefixed ID for DOM elements
            guidelineId: result.guidelineId, // Add guideline info for feedback tracking
            guidelineTitle: result.guidelineTitle
        }));

        currentSuggestions = prefixedSuggestions;
        userDecisions = {};

        // Store guideline info globally for feedback submission
        window.currentGuidelineId = result.guidelineId;
        window.currentGuidelineTitle = result.guidelineTitle;

        console.log('[DEBUG] dynamicAdvice: Stored session data', {
            sessionId: currentAdviceSession,
            suggestionsCount: currentSuggestions.length,
            firstSuggestionId: currentSuggestions[0]?.id,
            firstOriginalId: currentSuggestions[0]?.originalId
        });

        // Display interactive suggestions using appendToOutputField (use prefixed suggestions)
        await displayInteractiveSuggestions(prefixedSuggestions, result.guidelineTitle, result.guidelineId, result.guidelineFilename);

        return result;

    } catch (error) {
        console.error('[DEBUG] dynamicAdvice: Error in function:', {
            error: error.message,
            stack: error.stack,
            transcriptLength: transcript?.length,
            analysisLength: analysis?.length
        });

        // Surface error via status bar instead of populating summary1
        updateUser(`Error generating interactive suggestions: ${error.message}`, false);

        throw error;
    }
}

// ===== Practice Point-Based Suggestions (Fast Path) =====

// Function to get practice point suggestions using pre-extracted auditable elements
async function getPracticePointSuggestions(transcript, guidelineId) {
    console.log('[PRACTICE-POINTS] Getting suggestions for guideline:', guidelineId);

    try {
        const user = auth.currentUser;
        if (!user) {
            throw new Error('User not authenticated');
        }
        const idToken = await user.getIdToken();

        updateUser(`Analysing practice points...`, true);

        const response = await fetch(`${window.SERVER_URL}/getPracticePointSuggestions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${idToken}`
            },
            body: JSON.stringify({
                transcript,
                guidelineId
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('[PRACTICE-POINTS] API error:', errorText);
            throw new Error(`API error: ${response.status}`);
        }

        const result = await response.json();
        console.log('[PRACTICE-POINTS] Result:', {
            success: result.success,
            totalPracticePoints: result.totalPracticePoints,
            relevantPracticePoints: result.relevantPracticePoints,
            suggestionsCount: result.suggestions?.length
        });

        if (!result.success) {
            throw new Error(result.error || 'Failed to get practice point suggestions');
        }

        updateUser(`Found ${result.relevantPracticePoints} relevant practice points`, false);
        return result;

    } catch (error) {
        console.error('[PRACTICE-POINTS] Error:', error);
        updateUser(`Error: ${error.message}`, false);
        throw error;
    }
}

// Display practice point suggestions using the existing one-at-a-time UI
async function displayPracticePointSuggestions(result) {
    console.log('[PRACTICE-POINTS] Displaying suggestions:', result.suggestions?.length);
    console.log('[PRACTICE-POINTS] 3-step summary:', {
        total: result.totalPracticePoints,
        relevant: result.relevantPracticePoints,
        important: result.importantPracticePoints,
        compliant: result.compliantCount,
        nonCompliant: result.nonCompliantCount
    });

    if (!result.suggestions || result.suggestions.length === 0) {
        const message = result.message || 'Plan aligns with guideline recommendations.';
        updateUser(message, false);

        // Build summary of what was filtered
        let filterSummary = '';
        if (result.totalPracticePoints > 0) {
            filterSummary = `
                <div style="background: var(--bg-tertiary); border: 1px solid #22c55e; border-radius: 6px; padding: 15px; margin: 15px 0;">
                    <p style="margin: 0 0 10px 0; font-size: 0.95em; color: var(--text-primary); font-weight: 600;">📊 Analysis Summary</p>
                    <p style="margin: 0; font-size: 0.9em; color: var(--text-secondary);">
                        ${result.totalPracticePoints} practice points analysed
                        → ${result.relevantPracticePoints || 0} relevant to this patient
                        → ${result.importantPracticePoints || 0} clinically important
                        → <strong style="color: #22c55e;">${result.compliantCount || 0} compliant</strong>
                    </p>
                </div>
            `;
        }

        // Show the same interactive interface structure with compliant message
        const compliantHtml = `
            <div class="dynamic-advice-container" id="suggestion-review-current">
                <div style="display: flex; justify-content: space-between; align-items: baseline; margin: 0 0 15px 0;">
                    <h3 style="color: #16a34a; margin: 0;">✅ Guideline Review Complete</h3>
                    <p style="margin: 0; font-size: 13px; color: #666; text-align: right;"><em>Guideline: ${result.guidelineTitle || 'Unknown'}</em></p>
                </div>
                <div class="suggestion-current" style="background: #f0fdf4; border: 2px solid #16a34a; padding: 20px; margin: 10px 0; border-radius: 6px;">
                    <div style="text-align: center; padding: 20px 0;">
                        <div style="font-size: 48px; margin-bottom: 15px;">🎉</div>
                        <h4 style="color: #16a34a; margin: 0 0 10px 0; font-size: 1.3em;">Care is Compliant</h4>
                        <p style="color: #166534; margin: 0; font-size: 1em;">
                            The clinical note aligns with all relevant guideline recommendations.
                        </p>
                    </div>
                    ${filterSummary}
                </div>
                <div style="margin-top: 15px; text-align: center; font-size: 13px; color: #666;">No suggestions required</div>
            </div>
        `;
        appendToSummary1(compliantHtml, true);
        return;
    }

    // Convert 3-step results to suggestion format for existing UI
    // Defensive cleanup: model outputs can sometimes contain adjacent duplicated phrases.
    function dedupeAdjacentRepeatText(value) {
        if (value === null || value === undefined) return '';
        let s = String(value).replace(/\s+/g, ' ').trim();
        if (!s) return '';

        const fullRepeat = s.match(/^(.+?)(?:\s+\1)+$/);
        if (fullRepeat && fullRepeat[1]) {
            s = fullRepeat[1].trim();
        }

        let words = s.split(' ');
        let changed = true;
        while (changed) {
            changed = false;
            for (let len = Math.floor(words.length / 2); len >= 3; len--) {
                const a = words.slice(words.length - 2 * len, words.length - len).join(' ');
                const b = words.slice(words.length - len).join(' ');
                if (a && a === b) {
                    words = words.slice(0, words.length - len);
                    changed = true;
                    break;
                }
            }
        }

        return words.join(' ').trim();
    }

    const suggestions = result.suggestions.map((point, index) => {
        // Build context based on new 3-step format
        let contextParts = [];
        contextParts.push(`**${point.name}**`);

        const issueText = point.issue ? dedupeAdjacentRepeatText(point.issue) : '';
        const descriptionText = point.description ? dedupeAdjacentRepeatText(point.description) : '';

        if (issueText) {
            contextParts.push(`\n\n**Issue:** ${issueText}`);
        }

        // Avoid displaying duplicated context when upstream fields mirror each other.
        // This commonly happens when an API maps `description` from the same source as `issue`.
        if (descriptionText && (!issueText || descriptionText !== issueText)) {
            contextParts.push(`\n\n${descriptionText}`);
        }

        return {
            id: `pp-${result.guidelineId}-${point.id || index + 1}`,
            originalId: point.id || index + 1,
            originalText: null,
            suggestedText: point.suggestion || point.name,
            context: contextParts.join(''),
            category: 'addition',
            priority: point.priority || point.significance || 'high',
            guidelineReference: point.name,
            hasVerbatimQuote: !!(point.verbatimQuote && point.verbatimQuote.length > 10),
            verbatimQuote: point.verbatimQuote,
            guidelineId: result.guidelineId,
            guidelineTitle: result.guidelineTitle
        };
    });

    // Store session data
    currentAdviceSession = `pp-${result.guidelineId}-${Date.now()}`;
    currentSuggestions = suggestions;
    userDecisions = {};

    window.currentGuidelineId = result.guidelineId;
    window.currentGuidelineTitle = result.guidelineTitle;

    // Display using existing one-at-a-time UI
    await displayInteractiveSuggestions(
        suggestions,
        result.guidelineTitle,
        result.guidelineId,
        result.guidelineFilename
    );
}

// ===== One-at-a-Time Guideline Suggestions Workflow =====

// Global state for guideline suggestions review  
window.currentSuggestionReview = null;

// Helper function to determine optimal insertion point for new text
async function determineInsertionPoint(suggestion, clinicalNote) {
    try {
        console.log('[DEBUG] determineInsertionPoint: Calling server API');

        const idToken = await firebase.auth().currentUser.getIdToken();
        const response = await fetch(`${window.SERVER_URL}/determineInsertionPoint`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${idToken}`
            },
            body: JSON.stringify({
                suggestion,
                clinicalNote
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('[DEBUG] determineInsertionPoint: API error:', errorText);
            throw new Error(`Failed to determine insertion point: ${response.status}`);
        }

        const result = await response.json();
        console.log('[DEBUG] determineInsertionPoint: Received result:', result);

        return result.insertionPoint;
    } catch (error) {
        console.error('[DEBUG] determineInsertionPoint: Error:', error);
        // Fallback to appending at end
        return {
            section: 'end',
            insertionMethod: 'append',
            reasoning: 'Fallback due to error'
        };
    }
}

// Helper function to extract section content from clinical note
function extractSectionContent(clinicalNote, sectionName, subsectionName = null) {
    console.log('[DEBUG] extractSectionContent:', { sectionName, subsectionName });

    // Find the main section
    const sectionPatterns = [
        new RegExp(`^${sectionName}:`, 'im'),
        new RegExp(`^${sectionName}\\s*$`, 'im'),
        new RegExp(`^${sectionName}\\s*-`, 'im'),
        new RegExp(`${sectionName}:`, 'i')
    ];

    let sectionStartIndex = -1;
    let matchedPattern = null;

    for (const pattern of sectionPatterns) {
        const match = clinicalNote.match(pattern);
        if (match) {
            sectionStartIndex = match.index;
            matchedPattern = match[0];
            break;
        }
    }

    if (sectionStartIndex === -1) {
        console.warn('[DEBUG] extractSectionContent: Section not found:', sectionName);
        return null;
    }

    // Get content after section header
    const afterSection = clinicalNote.slice(sectionStartIndex + matchedPattern.length);

    // Find where this section ends (next main section or end of document)
    const commonSections = ['Situation', 'Issues', 'Background', 'Assessment', 'Discussion', 'Plan', 'Recommendation'];
    let nextSectionIndex = -1;

    for (const nextSection of commonSections) {
        if (nextSection === sectionName) continue;

        const nextPatterns = [
            new RegExp(`\n${nextSection}:`, 'i'),
            new RegExp(`\n${nextSection}\\s*$`, 'm'),
            new RegExp(`\n${nextSection}\\s*-`, 'i')
        ];

        for (const pattern of nextPatterns) {
            const match = afterSection.match(pattern);
            if (match && (nextSectionIndex === -1 || match.index < nextSectionIndex)) {
                nextSectionIndex = match.index;
            }
        }
    }

    // Extract section content
    let sectionContent = nextSectionIndex !== -1
        ? afterSection.slice(0, nextSectionIndex)
        : afterSection;

    // If we have a subsection, extract that specific content
    if (subsectionName) {
        console.log('[DEBUG] extractSectionContent: Looking for subsection:', subsectionName);

        const subsectionPatterns = [
            new RegExp(`\\*\\*\\s*${subsectionName}\\s*:\\*\\*`, 'i'),
            new RegExp(`\\*\\s*\\*\\*${subsectionName}:\\*\\*`, 'i'),
            new RegExp(`-\\s*\\*\\*${subsectionName}:\\*\\*`, 'i'),
            new RegExp(`\\d+\\.\\s*\\*\\*${subsectionName}:\\*\\*`, 'i'),
            new RegExp(`${subsectionName}:`, 'i')
        ];

        let subsectionStartIndex = -1;
        let subsectionMatchedPattern = null;

        for (const pattern of subsectionPatterns) {
            const match = sectionContent.match(pattern);
            if (match) {
                subsectionStartIndex = match.index;
                subsectionMatchedPattern = match[0];
                break;
            }
        }

        if (subsectionStartIndex === -1) {
            console.warn('[DEBUG] extractSectionContent: Subsection not found:', subsectionName);
            return null;
        }

        // Find where subsection ends (next subsection or section end)
        const afterSubsection = sectionContent.slice(subsectionStartIndex + subsectionMatchedPattern.length);
        const nextSubsectionPattern = /\n[\*\-]?\s*\*\*[^:]+:\*\*/;
        const nextSubMatch = afterSubsection.match(nextSubsectionPattern);

        sectionContent = nextSubMatch
            ? afterSubsection.slice(0, nextSubMatch.index)
            : afterSubsection;

        return {
            content: sectionContent.trim(),
            startIndex: sectionStartIndex + matchedPattern.length + subsectionStartIndex + subsectionMatchedPattern.length,
            endIndex: sectionStartIndex + matchedPattern.length + subsectionStartIndex + subsectionMatchedPattern.length + sectionContent.length,
            headerPattern: subsectionMatchedPattern
        };
    }

    // Return main section content
    return {
        content: sectionContent.trim(),
        startIndex: sectionStartIndex + matchedPattern.length,
        endIndex: sectionStartIndex + matchedPattern.length + sectionContent.length,
        headerPattern: matchedPattern
    };
}

// Helper function to replace section content in clinical note
function replaceSectionContent(clinicalNote, sectionName, subsectionName, oldContent, newContent) {
    console.log('[DEBUG] replaceSectionContent:', { sectionName, subsectionName, oldContentLength: oldContent.length, newContentLength: newContent.length });

    // Normalise spacing: collapse extra blank/whitespace-only lines inside the section content
    // so added items sit flush with preceding items rather than being separated by empty lines.
    // Apply to all sections to ensure consistent formatting when incorporating suggestions.
    newContent = newContent.replace(/\n\s*\n/g, '\n');

    // Extract the section to get boundaries
    const sectionInfo = extractSectionContent(clinicalNote, sectionName, subsectionName);
    if (!sectionInfo) {
        console.error('[DEBUG] replaceSectionContent: Could not extract section');
        return clinicalNote; // Return unchanged if section not found
    }

    // Replace the content
    const before = clinicalNote.slice(0, sectionInfo.startIndex);
    const after = clinicalNote.slice(sectionInfo.endIndex);

    // Add appropriate spacing
    const newContentWithSpacing = '\n' + newContent.trim();

    return before + newContentWithSpacing + after;
}

// Helper function to detect list pattern in text
function detectListPattern(text, startPos = 0) {
    console.log('[DEBUG] detectListPattern: Analysing text from position', startPos);

    // Get text from startPos to analyse
    const textToAnalyse = text.slice(startPos);

    // Patterns to detect different list types
    const patterns = {
        // Numbered lists: "1. ", "2. ", "3. " etc
        numbered: /^(\s*)(\d+)\.\s/gm,
        // Bullet points: "* " or "• "
        bullet: /^(\s*)[\*•]\s/gm,
        // Hyphen lists: "- "
        hyphen: /^(\s*)-\s/gm
    };

    let detectedType = 'none';
    let lastItemNumber = null;
    let indentation = '';
    let matches = [];

    // Check for numbered lists first (most specific)
    patterns.numbered.lastIndex = 0;
    let match;
    while ((match = patterns.numbered.exec(textToAnalyse)) !== null) {
        matches.push({
            type: 'numbered',
            number: parseInt(match[2]),
            indentation: match[1],
            index: match.index
        });
    }

    if (matches.length > 0) {
        // Get the last numbered item
        const lastMatch = matches[matches.length - 1];
        detectedType = 'numbered';
        lastItemNumber = lastMatch.number;
        indentation = lastMatch.indentation;
        console.log('[DEBUG] detectListPattern: Found numbered list, last item:', lastItemNumber);
        return { type: detectedType, lastItemNumber, indentation };
    }

    // Check for bullet points
    patterns.bullet.lastIndex = 0;
    match = null;
    while ((match = patterns.bullet.exec(textToAnalyse)) !== null) {
        detectedType = 'bullet';
        indentation = match[1];
    }

    if (detectedType === 'bullet') {
        console.log('[DEBUG] detectListPattern: Found bullet list');
        return { type: detectedType, lastItemNumber: null, indentation };
    }

    // Check for hyphen lists
    patterns.hyphen.lastIndex = 0;
    match = null;
    while ((match = patterns.hyphen.exec(textToAnalyse)) !== null) {
        detectedType = 'hyphen';
        indentation = match[1];
    }

    if (detectedType === 'hyphen') {
        console.log('[DEBUG] detectListPattern: Found hyphen list');
        return { type: detectedType, lastItemNumber: null, indentation };
    }

    console.log('[DEBUG] detectListPattern: No list pattern detected');
    return { type: 'none', lastItemNumber: null, indentation: '' };
}

// Helper function to format text as a list item
function formatAsListItem(text, listInfo) {
    console.log('[DEBUG] formatAsListItem:', { listInfo, textLength: text.length });

    if (!listInfo || listInfo.type === 'none') {
        // No list formatting needed
        return text;
    }

    // Clean the text (remove leading/trailing whitespace from each line)
    const cleanedText = text.trim();

    // Split into lines for multi-line handling
    const lines = cleanedText.split('\n');
    const indentation = listInfo.indentation || '';

    let formattedText = '';

    switch (listInfo.type) {
        case 'numbered':
            const nextNumber = (listInfo.lastItemNumber || 0) + 1;
            // First line gets the number
            formattedText = `${indentation}${nextNumber}. ${lines[0]}`;
            // Subsequent lines get indented to align with text (not the number)
            if (lines.length > 1) {
                const continueIndent = indentation + '   '; // 3 spaces for "N. "
                for (let i = 1; i < lines.length; i++) {
                    formattedText += '\n' + continueIndent + lines[i].trim();
                }
            }
            break;

        case 'bullet':
            // First line gets the bullet
            formattedText = `${indentation}* ${lines[0]}`;
            // Subsequent lines get indented to align
            if (lines.length > 1) {
                const continueIndent = indentation + '  '; // 2 spaces for "* "
                for (let i = 1; i < lines.length; i++) {
                    formattedText += '\n' + continueIndent + lines[i].trim();
                }
            }
            break;

        case 'hyphen':
            // First line gets the hyphen
            formattedText = `${indentation}- ${lines[0]}`;
            // Subsequent lines get indented to align
            if (lines.length > 1) {
                const continueIndent = indentation + '  '; // 2 spaces for "- "
                for (let i = 1; i < lines.length; i++) {
                    formattedText += '\n' + continueIndent + lines[i].trim();
                }
            }
            break;

        default:
            formattedText = text;
    }

    console.log('[DEBUG] formatAsListItem: Formatted text:', formattedText.substring(0, 100));
    return formattedText;
}

// Helper function to insert text at the determined point
function insertTextAtPoint(currentContent, newText, insertionPoint) {
    console.log('[DEBUG] insertTextAtPoint:', {
        contentLength: currentContent.length,
        newTextLength: newText.length,
        insertionPoint
    });

    // Normalize inserted text by trimming leading/trailing blank lines only
    const cleanedNewText = (typeof newText === 'string' ? newText : '').replace(/^\s*\n+/, '').replace(/\n+\s*$/, '');

    // Helper to compute appropriate prefix spacing to avoid duplicate blank lines
    function computePrefixSpacing(text, insertPos) {
        if (insertPos <= 0) return '';
        const before = text.slice(0, insertPos);
        if (/\n\n$/.test(before)) return '';
        if (/\n$/.test(before)) return '\n';
        return '\n\n';
    }

    // Helper to compute appropriate suffix spacing to avoid duplicate blank lines
    function computeSuffixSpacing(text, insertPos) {
        const after = text.slice(insertPos);
        if (/^\n\n/.test(after)) return '';
        if (/^\n/.test(after)) return '';
        return '\n\n';
    }

    const { section, subsection, insertionMethod, anchorText, listType, lastItemNumber } = insertionPoint;

    // Handle appendToList insertion method with nested subsection support
    if ((insertionMethod === 'appendToList' || insertionMethod === 'append') && section) {
        // Find the main section
        const sectionPatterns = [
            new RegExp(`^${section}:`, 'im'),
            new RegExp(`^${section}\\s*$`, 'im'),
            new RegExp(`^${section}\\s*-`, 'im'),
            new RegExp(`${section}:`, 'i')
        ];

        let sectionStartIndex = -1;
        let matchedPattern = null;

        for (const pattern of sectionPatterns) {
            const match = currentContent.match(pattern);
            if (match) {
                sectionStartIndex = match.index;
                matchedPattern = match[0];
                break;
            }
        }

        if (sectionStartIndex !== -1) {
            console.log('[DEBUG] insertTextAtPoint: Found section', section, 'at index', sectionStartIndex);

            // Get the section content (from section start to end)
            const afterSection = currentContent.slice(sectionStartIndex + matchedPattern.length);

            // Find where this section ends
            const commonSections = ['Situation', 'Issues', 'Background', 'Assessment', 'Discussion', 'Plan', 'Recommendation'];
            let nextSectionIndex = -1;

            for (const nextSection of commonSections) {
                if (nextSection === section) continue;

                const nextPatterns = [
                    new RegExp(`\n${nextSection}:`, 'i'),
                    new RegExp(`\n${nextSection}\\s*$`, 'm'),
                    new RegExp(`\n${nextSection}\\s*-`, 'i')
                ];

                for (const pattern of nextPatterns) {
                    const match = afterSection.match(pattern);
                    if (match && (nextSectionIndex === -1 || match.index < nextSectionIndex)) {
                        nextSectionIndex = match.index;
                    }
                }
            }

            // Extract section content
            const sectionContent = nextSectionIndex !== -1
                ? afterSection.slice(0, nextSectionIndex)
                : afterSection;

            // If we have a subsection, find it within the section content
            let targetContent = sectionContent;
            let targetStartInSection = 0;

            if (subsection) {
                console.log('[DEBUG] insertTextAtPoint: Looking for subsection', subsection);

                // Look for subsection patterns (markdown bold, bullet points, etc.)
                const subsectionPatterns = [
                    new RegExp(`\\*\\*\\s*${subsection}\\s*:\\*\\*`, 'i'),  // "** Counselling:**"
                    new RegExp(`\\*\\s*\\*\\*${subsection}:\\*\\*`, 'i'),   // "* **Counselling:**"
                    new RegExp(`-\\s*\\*\\*${subsection}:\\*\\*`, 'i'),     // "- **Counselling:**"
                    new RegExp(`\\d+\\.\\s*\\*\\*${subsection}:\\*\\*`, 'i'), // "1. **Counselling:**"
                    new RegExp(`${subsection}:`, 'i')                       // "Counselling:"
                ];

                let subsectionStartIndex = -1;
                let subsectionMatchedPattern = null;

                for (const pattern of subsectionPatterns) {
                    const match = sectionContent.match(pattern);
                    if (match) {
                        subsectionStartIndex = match.index;
                        subsectionMatchedPattern = match[0];
                        break;
                    }
                }

                if (subsectionStartIndex !== -1) {
                    console.log('[DEBUG] insertTextAtPoint: Found subsection at index', subsectionStartIndex);

                    // Find where subsection ends (next subsection or section end)
                    const afterSubsection = sectionContent.slice(subsectionStartIndex + subsectionMatchedPattern.length);

                    // Look for next subsection (starts with * ** or - ** or number. **)
                    const nextSubsectionPattern = /\n[\*\-]?\s*\*\*[^:]+:\*\*/;
                    const nextSubMatch = afterSubsection.match(nextSubsectionPattern);

                    if (nextSubMatch) {
                        targetContent = afterSubsection.slice(0, nextSubMatch.index);
                        targetStartInSection = subsectionStartIndex + subsectionMatchedPattern.length;
                    } else {
                        targetContent = afterSubsection;
                        targetStartInSection = subsectionStartIndex + subsectionMatchedPattern.length;
                    }
                } else {
                    console.warn('[DEBUG] insertTextAtPoint: Subsection not found, using entire section');
                }
            }

            // Detect list pattern in the target content or use provided listType
            let listInfo;
            if (insertionMethod === 'appendToList' && listType && listType !== 'none') {
                // Use provided list info from AI
                listInfo = {
                    type: listType,
                    lastItemNumber: lastItemNumber,
                    indentation: ''
                };
                console.log('[DEBUG] insertTextAtPoint: Using AI-provided list info:', listInfo);
            } else {
                // Auto-detect list pattern
                listInfo = detectListPattern(targetContent, 0);
                console.log('[DEBUG] insertTextAtPoint: Auto-detected list info:', listInfo);
            }

            // Format the new text as a list item if applicable
            let textToInsert = cleanedNewText;
            if (listInfo.type !== 'none') {
                textToInsert = formatAsListItem(cleanedNewText, listInfo);
                console.log('[DEBUG] insertTextAtPoint: Formatted as list item');
            }

            // Calculate final insertion position
            const insertPosition = sectionStartIndex + matchedPattern.length + targetStartInSection + targetContent.length;

            console.log('[DEBUG] insertTextAtPoint: Final insertion at position', insertPosition);

            // Insert with appropriate spacing
            // For list items or when appending to existing content, use single newline
            // For non-list additions, use double newline (blank line)
            let prefix;
            if (listInfo.type !== 'none' || insertionMethod === 'appendToList') {
                // List item: use single newline spacing
                const before = currentContent.slice(0, insertPosition);
                if (/\n$/.test(before)) {
                    prefix = ''; // Already has newline
                } else {
                    prefix = '\n';
                }
            } else {
                // Non-list: use normal spacing logic (can add blank line)
                prefix = computePrefixSpacing(currentContent, insertPosition);
            }
            const suffix = nextSectionIndex !== -1 ? '' : '';

            return currentContent.slice(0, insertPosition) + prefix + textToInsert + suffix + currentContent.slice(insertPosition);
        } else {
            console.warn('[DEBUG] insertTextAtPoint: Section not found:', section, '- appending to end');
            let base = currentContent.replace(/[ \t]+$/, '').replace(/\n{3,}$/, '\n\n');
            const trailing = (base.match(/\n+$/) || [''])[0].length;
            const spacing = base.trim() ? (trailing >= 2 ? '' : (trailing === 1 ? '\n' : '\n\n')) : '';
            return base + spacing + cleanedNewText;
        }
    }

    // Legacy: If method is append to a section (old behavior, kept for backwards compatibility)
    if (insertionMethod === 'append' && section && !subsection) {
        // Find the section in the document
        // Try different section header formats: "Section:", "Section", "Section -", etc.
        const sectionPatterns = [
            new RegExp(`^${section}:`, 'im'),           // "Discussion:"
            new RegExp(`^${section}\\s*$`, 'im'),       // "Discussion"
            new RegExp(`^${section}\\s*-`, 'im'),       // "Discussion -"
            new RegExp(`${section}:`, 'i')              // "Discussion:" anywhere in line
        ];

        let sectionStartIndex = -1;
        let matchedPattern = null;

        for (const pattern of sectionPatterns) {
            const match = currentContent.match(pattern);
            if (match) {
                sectionStartIndex = match.index;
                matchedPattern = match[0];
                break;
            }
        }

        if (sectionStartIndex !== -1) {
            console.log('[DEBUG] insertTextAtPoint: Found section', section, 'at index', sectionStartIndex);

            // Find where this section ends (start of next section or end of document)
            // Look for the next section header after this one
            const afterSection = currentContent.slice(sectionStartIndex + matchedPattern.length);

            // Common section names to look for
            const commonSections = ['Situation', 'Issues', 'Background', 'Assessment', 'Discussion', 'Plan', 'Recommendation'];
            let nextSectionIndex = -1;

            for (const nextSection of commonSections) {
                if (nextSection === section) continue; // Skip current section

                const nextPatterns = [
                    new RegExp(`\n${nextSection}:`, 'i'),
                    new RegExp(`\n${nextSection}\\s*$`, 'm'),
                    new RegExp(`\n${nextSection}\\s*-`, 'i')
                ];

                for (const pattern of nextPatterns) {
                    const match = afterSection.match(pattern);
                    if (match && (nextSectionIndex === -1 || match.index < nextSectionIndex)) {
                        nextSectionIndex = match.index;
                    }
                }
            }

            // Calculate insertion position
            let insertPosition;
            if (nextSectionIndex !== -1) {
                // Insert before the next section
                insertPosition = sectionStartIndex + matchedPattern.length + nextSectionIndex;
                console.log('[DEBUG] insertTextAtPoint: Inserting before next section at position', insertPosition);
                const prefix = computePrefixSpacing(currentContent, insertPosition);
                return currentContent.slice(0, insertPosition) + prefix + cleanedNewText + currentContent.slice(insertPosition);
            } else {
                // No next section found, append to end of document (this section is last)
                console.log('[DEBUG] insertTextAtPoint: Section is last, appending to end');
                // Trim trailing spaces and cap trailing newlines to avoid extra blank lines
                let base = currentContent.replace(/[ \t]+$/, '').replace(/\n{3,}$/, '\n\n');
                const trailing = (base.match(/\n+$/) || [''])[0].length;
                const spacing = base.trim() ? (trailing >= 2 ? '' : (trailing === 1 ? '\n' : '\n\n')) : '';
                return base + spacing + cleanedNewText;
            }
        } else {
            console.warn('[DEBUG] insertTextAtPoint: Section not found:', section, '- appending to end');
            // Trim trailing spaces and cap trailing newlines to avoid extra blank lines
            let base = currentContent.replace(/[ \t]+$/, '').replace(/\n{3,}$/, '\n\n');
            const trailing = (base.match(/\n+$/) || [''])[0].length;
            const spacing = base.trim() ? (trailing >= 2 ? '' : (trailing === 1 ? '\n' : '\n\n')) : '';
            return base + spacing + cleanedNewText;
        }
    }

    // For insertAfter or insertBefore with anchor text
    if (anchorText && (insertionMethod === 'insertAfter' || insertionMethod === 'insertBefore')) {
        const anchorIndex = currentContent.indexOf(anchorText);

        if (anchorIndex !== -1) {
            if (insertionMethod === 'insertAfter') {
                const insertPosition = anchorIndex + anchorText.length;
                const prefix = computePrefixSpacing(currentContent, insertPosition);
                // No forced trailing spacing to avoid creating an extra blank line
                return currentContent.slice(0, insertPosition) + prefix + cleanedNewText + currentContent.slice(insertPosition);
            } else { // insertBefore
                const suffix = computeSuffixSpacing(currentContent, anchorIndex);
                return currentContent.slice(0, anchorIndex) + cleanedNewText + suffix + currentContent.slice(anchorIndex);
            }
        } else {
            console.warn('[DEBUG] insertTextAtPoint: Anchor text not found, appending to end');
            const spacing = currentContent.trim() ? (/\n\n$/.test(currentContent) ? '' : (/\n$/.test(currentContent) ? '\n' : '\n\n')) : '';
            return currentContent + spacing + cleanedNewText;
        }
    }

    // Fallback: append to end
    console.warn('[DEBUG] insertTextAtPoint: Using fallback - appending to end');
    // Trim trailing spaces and cap trailing newlines to avoid extra blank lines
    let base = currentContent.replace(/[ \t]+$/, '').replace(/\n{3,}$/, '\n\n');
    const trailing = (base.match(/\n+$/) || [''])[0].length;
    const spacing = base.trim() ? (trailing >= 2 ? '' : (trailing === 1 ? '\n' : '\n\n')) : '';
    return base + spacing + cleanedNewText;
}

// Helper function to extract quoted text from context
function extractQuotedText(context) {
    if (!context) return null;

    // Find all text within quotation marks (both single and double quotes)
    const quotePatterns = [
        /'([^']{10,})'/g,  // Single quotes with at least 10 chars
        /"([^"]{10,})"/g,  // Double quotes with at least 10 chars
        /'([^']{10,})'/g,  // Curly single quotes
        /"([^"]{10,})"/g   // Curly double quotes
    ];

    let allQuotes = [];

    for (const pattern of quotePatterns) {
        let match;
        while ((match = pattern.exec(context)) !== null) {
            allQuotes.push(match[1]);
        }
    }

    if (allQuotes.length === 0) {
        return null;
    }

    // Return the longest quote (most likely to be the actual guideline quote)
    allQuotes.sort((a, b) => b.length - a.length);
    let longestQuote = allQuotes[0];

    // Clean the quote for PDF search - remove citation markers and formatting
    longestQuote = cleanQuoteForSearch(longestQuote);

    console.log('[DEBUG] Extracted quote from context:', {
        totalQuotes: allQuotes.length,
        longestQuoteLength: longestQuote.length,
        quotePrevie: longestQuote.substring(0, 50) + '...'
    });

    return longestQuote;
}

// Helper function to clean quotes for PDF search
function cleanQuoteForSearch(quote) {
    if (!quote) return quote;

    // Remove common citation patterns that might not be in the PDF
    let cleaned = quote
        // Remove evidence level citations: [Evidence level 1-3], [Grade A-D], [Grade GPP], etc.
        .replace(/\s*\[Evidence level [^\]]+\]/gi, '')
        .replace(/\s*\[Grade [^\]]+\]/gi, '')
        .replace(/\s*\[Level [^\]]+\]/gi, '')
        .replace(/\s*\[Quality: [^\]]+\]/gi, '')
        .replace(/\s*\[Recommendation: [^\]]+\]/gi, '')
        // Remove reference numbers like [1], [2-5], etc.
        .replace(/\s*\[[0-9,\-–—]+\]/g, '')
        // Remove extra whitespace and normalize
        .replace(/\s+/g, ' ')
        .trim();

    console.log('[DEBUG] Cleaned quote for search:', {
        original: quote.substring(0, 100),
        cleaned: cleaned.substring(0, 100),
        removedChars: quote.length - cleaned.length
    });

    return cleaned;
}

// Helper function to extract key medical terms for fallback search
function extractKeyTermsForSearch(context, suggestedText) {
    if (!context && !suggestedText) return null;

    const combinedText = (context || '') + ' ' + (suggestedText || '');

    // Medical terms that are likely to be unique and searchable in guidelines
    // Priority: specific clinical terms > general medical terms
    const medicalPatterns = [
        // Specific measurements and thresholds (very searchable)
        /\d+(?:\.\d+)?\s*(?:weeks?|wk|w)\b/gi,  // gestational ages like "28 weeks"
        /\d+(?:\.\d+)?\s*(?:ml|mg|mcg|g|kg|mmol|mm|cm)\b/gi,  // measurements
        /\d+(?:st|nd|rd|th)\s*(?:centile|percentile)/gi,  // percentiles
        /(?:>|<|≥|≤)\s*\d+/g,  // thresholds

        // Clinical conditions (highly specific)
        /(?:vasa\s+)?praevia/gi,
        /placenta\s+(?:praevia|accreta|percreta)/gi,
        /(?:fetal|foetal)\s+(?:growth\s+)?restriction/gi,
        /intrauterine\s+growth\s+restriction/gi,
        /pre[\-\s]?eclampsia/gi,
        /gestational\s+diabetes/gi,
        /post[\-\s]?partum\s+haemorrhage/gi,
        /caesarean\s+(?:section|delivery)/gi,

        // Procedures and investigations
        /ultrasound|USS|scan/gi,
        /amniocentesis/gi,
        /cordocentesis/gi,
        /doppler/gi,
        /antenatal\s+steroids?/gi,
        /corticosteroids?/gi,

        // Timing terms
        /(?:first|second|third)\s+trimester/gi,
        /elective\s+delivery/gi,
        /planned\s+delivery/gi,
        /timing\s+of\s+delivery/gi
    ];

    let foundTerms = [];

    for (const pattern of medicalPatterns) {
        const matches = combinedText.match(pattern);
        if (matches) {
            foundTerms.push(...matches.map(m => m.trim().toLowerCase()));
        }
    }

    // Deduplicate and take most specific terms (longer = more specific)
    foundTerms = [...new Set(foundTerms)].sort((a, b) => b.length - a.length);

    if (foundTerms.length === 0) {
        // Fallback: extract words with 6+ characters that are likely medical terms
        const words = combinedText.split(/\s+/).filter(w =>
            w.length >= 6 &&
            !/^(should|would|could|because|however|therefore|important|emphasizes?)$/i.test(w)
        );
        // Take first 3-4 significant words
        const significantWords = words.slice(0, 4).map(w => w.toLowerCase().replace(/[^a-z]/g, ''));
        if (significantWords.length >= 2) {
            foundTerms = significantWords;
        }
    }

    if (foundTerms.length === 0) {
        return null;
    }

    // Build search phrase from top terms (up to 6 words for better matching)
    const searchPhrase = foundTerms.slice(0, 6).join(' ');

    console.log('[DEBUG] extractKeyTermsForSearch: Generated fallback search phrase', {
        termsFound: foundTerms.length,
        searchPhrase: searchPhrase,
        preview: searchPhrase.substring(0, 80)
    });

    return searchPhrase;
}

// Helper function to create guideline viewer link
function createGuidelineViewerLink(guidelineId, guidelineTitle, guidelineFilename, context, hasVerbatimQuote, suggestedText) {
    if (!guidelineId && !guidelineFilename) {
        return '<em>Guideline reference not available</em>';
    }

    const linkText = guidelineTitle || guidelineFilename || 'View Guideline PDF';

    // Extract search text from context ONLY if hasVerbatimQuote is explicitly true
    let searchText = null;
    let searchType = null;  // Track whether this is 'verbatim' or 'fallback' search

    if (context && hasVerbatimQuote === true) {
        const decodedContext = unescapeHtml(context);

        // First, try to extract an explicit quoted segment (used by processWorkflow and audit flows)
        searchText = extractQuotedText(decodedContext);

        // Fallback: if there are no explicit quotes but we were told this is a verbatim quote
        // (e.g. Ask-Guidelines provides a plain snippet via the REF marker), treat the entire
        // context as the search text, after cleaning it for PDF search.
        if (!searchText) {
            const rawContext = decodedContext.trim();
            if (rawContext.length >= 10) {
                const cleanedContext = cleanQuoteForSearch(rawContext);
                if (cleanedContext && cleanedContext.length >= 10) {
                    searchText = cleanedContext;
                    searchType = 'verbatim';
                    console.log('[DEBUG] createGuidelineViewerLink: Using full context as fallback search text', {
                        length: searchText.length,
                        preview: searchText.substring(0, 80) + '...'
                    });
                } else {
                    console.log('[DEBUG] createGuidelineViewerLink: Cleaned context too short for fallback search text', {
                        rawLength: rawContext.length,
                        cleanedLength: cleanedContext ? cleanedContext.length : 0
                    });
                }
            } else {
                console.log('[DEBUG] createGuidelineViewerLink: Context too short for fallback search text', {
                    rawLength: rawContext.length
                });
            }
        } else {
            searchType = 'verbatim';
            console.log('[DEBUG] Extracted search text for PDF.js viewer from quoted context:', searchText.substring(0, 80) + '...');
        }
    } else if (hasVerbatimQuote === false || !hasVerbatimQuote) {
        // NEW: When no verbatim quote, try to extract key medical terms for a keyword-based search
        console.log('[DEBUG] hasVerbatimQuote is false/undefined - attempting fallback keyword search');

        const decodedContext = context ? unescapeHtml(context) : null;
        searchText = extractKeyTermsForSearch(decodedContext, suggestedText);

        if (searchText) {
            searchType = 'fallback';
            console.log('[DEBUG] createGuidelineViewerLink: Using keyword fallback search', {
                searchText: searchText,
                source: 'context + suggestedText'
            });
        } else {
            console.log('[DEBUG] createGuidelineViewerLink: No fallback search terms found - opening PDF to first page');
        }
    }

    // Store search text and guideline ID for auth handler to use
    const linkData = {
        guidelineId: guidelineId,
        searchText: searchText
    };

    // We no longer append any explanatory note after links; the guideline
    // name and context in the surrounding text provide sufficient clarity.
    const paraphraseNote = '';

    // Create link with data-link-data; the actual click is handled by a
    // delegated listener in index.html so we don't rely on inline onclick.
    // TipTap will preserve data-link-data via the custom Link extension.
    // Use simple underlined styling without bold or colour changes so links
    // integrate cleanly with surrounding text.
    //
    // Note: we intentionally avoid target="_blank" here because if the click handler
    // isn't wired up (e.g. in non-editor surfaces), the browser would open a useless
    // index.html# tab. Our click handler opens the PDF viewer in a new tab/window.
    return `<a href="#" data-link-data='${JSON.stringify(linkData)}' class="guideline-link" rel="noopener noreferrer" style="text-decoration: underline; font-weight: normal; cursor: pointer;">📄 ${escapeHtml(linkText)}</a>${paraphraseNote}`;
}

/**
 * Shared helper function to parse [[CITATION:guidelineId|searchText]] markers in AI responses
 * and convert them to clickable PDF links.
 * 
 * @param {string} answerText - The raw answer text containing citation markers
 * @param {Array} guidelinesUsed - Array of guideline objects with id and title properties
 * @param {string} callerName - Name of calling function for debug logging
 * @returns {Object} - { formattedAnswer, stats: { totalCitations, withQuotes, withoutQuotes } }
 */
function parseCitationsToLinks(answerText, guidelinesUsed, callerName = 'parseCitationsToLinks') {
    // Build maps from IDs/titles to canonical IDs and titles,
    // so citations can use either and still resolve to the correct PDF,
    // and links can always display the guideline name.
    const guidelineIdMap = new Map();
    const guidelineTitleMap = new Map();

    if (Array.isArray(guidelinesUsed)) {
        guidelinesUsed.forEach(g => {
            if (!g) return;
            const id = g.id ? String(g.id) : null;
            const title = g.title ? String(g.title) : null;
            if (id) {
                guidelineIdMap.set(id, id);
                guidelineIdMap.set(id.toLowerCase(), id);
                if (title) {
                    guidelineTitleMap.set(id, title);
                }
            }
            if (title && id) {
                guidelineIdMap.set(title, id);
                guidelineIdMap.set(title.toLowerCase(), id);
            }
        });
    }

    console.log(`[DEBUG] ${callerName}: guidelineIdMap keys:`, Array.from(guidelineIdMap.keys()));

    // Citation regex pattern: [[CITATION:guidelineId|searchText]]
    // searchText may be empty if no verbatim quote was found
    const citationRegex = /\[\[CITATION:([^|]+)\|([^\]]*)\]\]/g;

    // Escape HTML and preserve newlines
    let processedText = escapeHtml(answerText).replace(/\n/g, '<br>');

    let citationCount = 0;
    let withQuotes = 0;
    let withoutQuotes = 0;

    const formattedAnswer = processedText.replace(citationRegex, (match, guidelineId, searchText) => {
        citationCount += 1;

        const rawId = guidelineId.trim();
        const decodedSearch = searchText ? unescapeHtml(searchText).trim() : '';
        const hasQuote = decodedSearch.length >= 5;

        if (hasQuote) {
            withQuotes += 1;
        } else {
            withoutQuotes += 1;
        }

        // Resolve the canonical guideline ID (handles cases where AI uses title instead of ID)
        const canonicalId =
            guidelineIdMap.get(rawId) ||
            guidelineIdMap.get(rawId.toLowerCase()) ||
            rawId;

        // Get the guideline title for display
        const displayTitle =
            guidelineTitleMap.get(canonicalId) ||
            (Array.isArray(guidelinesUsed)
                ? (guidelinesUsed.find(g => String(g.id) === String(canonicalId))?.title || '').trim()
                : '') ||
            canonicalId;

        console.log(`[DEBUG] ${callerName}: Processing citation`, {
            citationNum: citationCount,
            guidelineId: canonicalId,
            hasQuote,
            searchPreview: decodedSearch.substring(0, 50)
        });

        // Create the link with or without search text
        return createGuidelineViewerLink(
            canonicalId,
            displayTitle,
            null, // filename not needed if ID provided
            hasQuote ? decodedSearch : null,
            hasQuote
        );
    });

    console.log(`[DEBUG] ${callerName}: Citation processing complete`, {
        totalCitations: citationCount,
        withQuotes,
        withoutQuotes
    });

    return {
        formattedAnswer,
        stats: {
            totalCitations: citationCount,
            withQuotes,
            withoutQuotes
        }
    };
}

// Function to prepare auth token for viewer
window.prepareViewerAuth = async function (event, linkElement) {
    try {
        event.preventDefault(); // Prevent default navigation

        console.log('[DEBUG] Preparing auth token for PDF.js viewer...');
        const user = firebase.auth().currentUser;
        if (!user) {
            console.error('[DEBUG] No user authenticated');
            alert('Please sign in to view guidelines');
            return;
        }

        // Get fresh ID token
        const idToken = await user.getIdToken();

        // Get link data from data attribute
        const linkDataStr = linkElement.getAttribute('data-link-data');
        if (!linkDataStr) {
            console.error('[DEBUG] No link data found');
            return;
        }

        const linkData = JSON.parse(linkDataStr);
        const { guidelineId, searchText } = linkData;

        console.log('[DEBUG] Building PDF.js viewer URL:', { guidelineId, hasSearchText: !!searchText });

        // Build the complete PDF URL with token
        // Use SERVER_URL (Render backend) for API calls, not GitHub Pages origin
        const baseUrl = window.SERVER_URL || window.location.origin;
        const pdfUrl = `${baseUrl}/api/pdf/${guidelineId}?token=${encodeURIComponent(idToken)}`;

        // Build PDF.js viewer URL with the PDF file URL
        let viewerUrl = `/pdfjs/web/viewer.html?file=${encodeURIComponent(pdfUrl)}`;

        // Add search hash parameters if we have quoted text
        if (searchText) {
            const searchHash = `#search=${encodeURIComponent(searchText)}&phrase=true&highlightAll=true&caseSensitive=false`;
            viewerUrl += searchHash;
            console.log('═══════════════════════════════════════════════════════════════');
            console.log('[Clerky] 🔍 VERBATIM QUOTE BEING SENT TO PDF VIEWER:');
            console.log('───────────────────────────────────────────────────────────────');
            console.log(searchText);
            console.log('───────────────────────────────────────────────────────────────');
            console.log('[Clerky] Quote length:', searchText.length, 'characters');
            console.log('[Clerky] Guideline ID:', guidelineId);
            console.log('═══════════════════════════════════════════════════════════════');
        }

        console.log('[DEBUG] Opening PDF.js viewer with full URL:', viewerUrl);

        // Open in new window
        window.open(viewerUrl, '_blank', 'noopener,noreferrer');

    } catch (error) {
        console.error('[DEBUG] Error preparing auth token:', error);
        alert('Failed to prepare authentication. Please try again.');
    }
};

// Display interactive suggestions in outputField ONE AT A TIME
async function displayInteractiveSuggestions(suggestions, guidelineTitle, guidelineId, guidelineFilename) {
    console.log('[DEBUG] displayInteractiveSuggestions called', {
        suggestionsCount: suggestions?.length,
        guidelineTitle,
        guidelineId,
        guidelineFilename
    });

    if (!suggestions || suggestions.length === 0) {
        console.log('[DEBUG] displayInteractiveSuggestions: No suggestions to display');
        const noSuggestionsHtml = `
            <div class="dynamic-advice-container">
                <h3>💡 Interactive Suggestions</h3>
                <p>No specific suggestions were generated from the guideline analysis.</p>
                <p><em>Guideline: ${guidelineTitle || 'Unknown'}</em></p>
            </div>
        `;
        // Inform user that no suggestions were generated via status bar
        updateUser(`No specific suggestions were generated from the guideline analysis (${guidelineTitle || 'Unknown'}).`, false);
        return;
    }

    // Store the review data globally
    window.currentSuggestionReview = {
        suggestions,
        guidelineTitle,
        guidelineId,
        guidelineFilename,
        currentIndex: 0,
        decisions: []
    };

    // Show the first suggestion
    showCurrentSuggestion();
}

// TEMP PLACEHOLDER - old code follows but won't be called
function OLD_displayInteractiveSuggestions_UNUSED(suggestions, guidelineTitle) {
    // Create the interactive suggestions HTML
    let suggestionsHtml = `
        <div class="dynamic-advice-container">
            <div class="advice-header">
                <h3>💡 Interactive Suggestions</h3>
                <p><em>From: ${guidelineTitle || 'Guideline Analysis'}</em></p>
                <p class="advice-instructions">Review each suggestion below. You can <strong>Accept</strong>, <strong>Reject</strong>, or <strong>Modify</strong> the proposed changes.</p>
                <div class="advice-explanation">
                    <p><strong>Note:</strong> Some suggestions identify <em>missing elements</em> (gaps in documentation) rather than existing text that needs changes. These are marked with ⚠️ and represent content that should be added to improve compliance with guidelines.</p>
                </div>
            </div>
            <div class="suggestions-list">
    `;

    // Add each suggestion
    suggestions.forEach((suggestion, index) => {
        // Processing each suggestion

        const priorityClass = `priority-${suggestion.priority || 'medium'}`;
        const categoryIcon = getCategoryIcon(suggestion.category);

        suggestionsHtml += `
            <div class="suggestion-item ${priorityClass}" data-suggestion-id="${suggestion.id}">
                <div class="suggestion-header">
                    <div class="suggestion-info">
                        <span class="category-icon">${categoryIcon}</span>
                        <span class="suggestion-id">#${index + 1}</span>
                        <span class="priority-badge ${priorityClass}">${suggestion.priority || 'medium'}</span>
                    </div>
                    <div class="guideline-ref">${suggestion.guidelineReference || ''}</div>
                </div>
                
                <div class="suggestion-content">
                    ${suggestion.originalText ? `
                        <div class="original-text">
                            <label>${getOriginalTextLabel(suggestion.originalText, suggestion.category)}</label>
                            <div class="text-preview ${suggestion.category === 'addition' ? 'missing-element' : ''}">"${suggestion.originalText}"</div>
                        </div>
                    ` : ''}
                    
                    <div class="suggested-text">
                        <label>Suggested ${suggestion.category || 'change'}:</label>
                        <div class="text-preview suggested">"${suggestion.suggestedText}"</div>
                    </div>
                    
                    <div class="suggestion-context">
                        <label>Why this change is suggested:</label>
                        <p>${suggestion.context}</p>
                    </div>
                </div>
                
                <div class="suggestion-actions">
                    <button class="action-btn accept-btn" style="background: #27ae60 !important; color: white !important;" onclick="handleSuggestionAction('${suggestion.id}', 'accept')">
                        ✅ Accept
                    </button>
                    <button class="action-btn reject-btn" style="background: #e74c3c !important; color: white !important;" onclick="handleSuggestionAction('${suggestion.id}', 'reject')">
                        ❌ Reject
                    </button>
                    <button class="action-btn modify-btn" style="background: #f39c12 !important; color: white !important;" onclick="handleSuggestionAction('${suggestion.id}', 'modify')">
                        ✏️ Modify
                    </button>
                </div>
                
                <div class="modify-section" id="modify-${suggestion.id}" style="display: none;">
                    <label for="modify-text-${suggestion.id}">Your modified text:</label>
                    <textarea id="modify-text-${suggestion.id}" class="modify-textarea" 
                              placeholder="Enter your custom text here...">${suggestion.suggestedText}</textarea>
                    <div class="modify-actions">
                        <button class="action-btn confirm-btn" style="background: #00b894 !important; color: white !important;" onclick="confirmModification('${suggestion.id}')">
                            ✅ Confirm Modification
                        </button>
                        <button class="action-btn cancel-btn" style="background: #636e72 !important; color: white !important;" onclick="cancelModification('${suggestion.id}')">
                            ❌ Cancel
                        </button>
                    </div>
                </div>
                
                <div class="decision-status" id="status-${suggestion.id}" style="display: none;">
                    <!-- Status will be updated by JavaScript -->
                </div>
            </div>
        `;
    });

    // Add apply all button (with unique IDs based on current session)
    const buttonId = `applyAllDecisionsBtn-${currentAdviceSession}`;
    const summaryId = `decisionsSummary-${currentAdviceSession}`;

    suggestionsHtml += `
            </div>
            <div class="advice-footer">
                <div class="decisions-summary" id="${summaryId}">
                    Changes apply immediately when you Accept, Reject, or Modify each suggestion.
                </div>
            </div>
        </div>
    `;

    console.log('[DEBUG] displayInteractiveSuggestions: Adding suggestions HTML to outputField', {
        buttonId,
        summaryId,
        currentSession: currentAdviceSession
    });
    appendToSummary1(suggestionsHtml, false);

    // Add a data attribute to mark this as the current session's suggestions
    setTimeout(() => {
        const dynamicAdviceContainer = document.querySelector('.dynamic-advice-container:last-of-type');
        if (dynamicAdviceContainer) {
            dynamicAdviceContainer.setAttribute('data-session-id', currentAdviceSession);
            dynamicAdviceContainer.classList.add('active-session');
        }
    }, 100);

    // Update the decisions summary
    updateDecisionsSummary();
    debouncedSaveState(); // Save state after displaying suggestions
}

// Helper function to set button applying state
function setSuggestionButtonApplying(buttonId, isApplying) {
    const button = document.getElementById(buttonId);
    if (!button) return;

    if (isApplying) {
        // Store original text if not already stored
        if (!button.dataset.originalText) {
            button.dataset.originalText = button.textContent.trim();
        }
        button.textContent = '⏳ Applying...';
        button.disabled = true;
        button.style.opacity = '0.7';
        button.style.cursor = 'wait';
    } else {
        // Restore original text
        if (button.dataset.originalText) {
            button.textContent = button.dataset.originalText;
            delete button.dataset.originalText;
        }
        button.disabled = false;
        button.style.opacity = '1';
        button.style.cursor = 'pointer';
    }
}

// Helper function to set all action buttons to applying state
function setAllSuggestionButtonsApplying(isApplying) {
    setSuggestionButtonApplying('suggestionAcceptBtn', isApplying);
    setSuggestionButtonApplying('suggestionRejectBtn', isApplying);
    setSuggestionButtonApplying('suggestionModifyBtn', isApplying);
    setSuggestionButtonApplying('suggestionSkipBtn', isApplying);
    setSuggestionButtonApplying('suggestionCancelBtn', isApplying);
}

// Update fixed button row state for suggestion review
function updateSuggestionActionButtons() {
    const review = window.currentSuggestionReview;
    const suggestionActionsGroup = document.getElementById('suggestionActionsGroup');
    const clerkyButtonsGroup = document.getElementById('clerkyButtonsGroup');

    if (!review) {
        // Hide suggestion buttons, show standard buttons
        if (suggestionActionsGroup) suggestionActionsGroup.style.display = 'none';
        // Delegate standard button visibility to central helper
        const hasContent = !!window.editors?.userInput?.getText()?.trim().length;
        updateAnalyseAndResetButtons(hasContent);
        return;
    }

    // Show suggestion buttons, hide standard buttons
    if (suggestionActionsGroup) suggestionActionsGroup.style.display = 'flex';
    // While in suggestion review, hide analyse but keep reset visible
    updateAnalyseAndResetButtons(true);
    if (clerkyButtonsGroup) clerkyButtonsGroup.style.display = 'none'; // Hide clerky buttons if present

    // Update specific buttons
    const prevBtn = document.getElementById('suggestionPrevBtn');
    if (prevBtn) {
        prevBtn.style.display = review.currentIndex > 0 ? 'flex' : 'none';
        prevBtn.onclick = () => navigateSuggestion(-1);
    }

    const acceptBtn = document.getElementById('suggestionAcceptBtn');
    if (acceptBtn) acceptBtn.onclick = () => handleCurrentSuggestionAction('accept');

    const rejectBtn = document.getElementById('suggestionRejectBtn');
    if (rejectBtn) rejectBtn.onclick = () => handleCurrentSuggestionAction('reject');

    const modifyBtn = document.getElementById('suggestionModifyBtn');
    if (modifyBtn) modifyBtn.onclick = () => showModifySection();

    const skipBtn = document.getElementById('suggestionSkipBtn');
    if (skipBtn) skipBtn.onclick = () => handleCurrentSuggestionAction('skip');

    const cancelBtn = document.getElementById('suggestionCancelBtn');
    if (cancelBtn) cancelBtn.onclick = () => cancelSuggestionReview();

    // Ensure buttons are not in applying state when updating
    setAllSuggestionButtonsApplying(false);
}

// Display the current suggestion being reviewed
async function showCurrentSuggestion() {
    const review = window.currentSuggestionReview;
    if (!review) return;

    const { suggestions, guidelineTitle, guidelineId, guidelineFilename, currentIndex, decisions } = review;
    const totalSuggestions = suggestions.length;

    if (currentIndex >= totalSuggestions) {
        completeSuggestionReview();
        return;
    }

    // Update buttons in fixed row
    updateSuggestionActionButtons();

    const suggestion = suggestions[currentIndex];
    const progressText = `${currentIndex + 1} of ${totalSuggestions}`;
    const categoryIcon = getCategoryIcon(suggestion.category);

    console.log('[ADVICE] Showing suggestion', progressText);

    if (suggestion.originalText) {
        highlightTextInEditor(suggestion.originalText);
        scrollTextIntoView(suggestion.originalText);
    }

    // Pre-fetch insertion point in background for additions (to speed up acceptance)
    if ((suggestion.category === 'addition' || !suggestion.originalText) && !suggestion.cachedInsertionPoint) {
        console.log('[DEBUG] showCurrentSuggestion: Pre-fetching insertion point in background');
        const currentContent = getUserInputContent();
        determineInsertionPoint(suggestion, currentContent).then(insertionPoint => {
            suggestion.cachedInsertionPoint = insertionPoint;
            console.log('[DEBUG] showCurrentSuggestion: Cached insertion point:', insertionPoint);
        }).catch(error => {
            console.error('[DEBUG] showCurrentSuggestion: Error pre-fetching insertion point:', error);
        });
    }

    // Create guideline link with context for quote extraction
    // Pass suggestedText for fallback keyword search when no verbatim quote is available
    const guidelineLink = createGuidelineViewerLink(guidelineId, guidelineTitle, guidelineFilename, suggestion.context, suggestion.hasVerbatimQuote, suggestion.suggestedText);

    const suggestionHtml = `
        <div class="dynamic-advice-container" id="suggestion-review-current">
            <div style="display: flex; justify-content: space-between; align-items: baseline; margin: 0 0 15px 0;">
                <h3 style="color: #2563eb; margin: 0;">💡 Suggestion ${progressText} (${suggestion.priority || 'medium'} priority)</h3>
                <p style="margin: 0; font-size: 13px; color: #666; text-align: right;"><em>From: ${guidelineTitle || 'Guideline Analysis'}</em></p>
            </div>
            <div class="suggestion-current" style="background: #f5f5f5; border: 2px solid #3B82F6; padding: 15px; margin: 10px 0; border-radius: 6px;">
                <div style="margin: 0 0 15px 0;"><strong style="color: #2563eb;">${categoryIcon} ${suggestion.category || 'Suggestion'}:</strong></div>
                ${suggestion.originalText ? `<div style="margin: 0 0 15px 0; padding: 10px; background: #fff; border-radius: 4px;"><strong style="color: #dc2626;">${getOriginalTextLabel(suggestion.originalText, suggestion.category)}</strong> <span style="background: #fef3c7; padding: 4px 8px; border-radius: 3px; display: inline;">"${escapeHtml(suggestion.originalText)}"</span></div>` : ''}
                <div style="margin: 0 0 15px 0; padding: 10px; background: #fff; border-radius: 4px;"><strong style="color: #16a34a;">Suggested:</strong> <span style="background: #dcfce7; padding: 4px 8px; border-radius: 3px; display: inline;">"${escapeHtml(suggestion.suggestedText)}"</span></div>
                <div style="margin: 0 0 15px 0; padding: 10px; background: #eff6ff; border-radius: 4px; border-left: 3px solid #3b82f6;"><strong>Why:</strong> ${escapeHtml(suggestion.context)}</div>
                <div style="margin: 0; padding: 10px; background: #f0f9ff; border-radius: 4px; border-left: 3px solid #0ea5e9;"><strong>Link:</strong> ${guidelineLink}</div>
            </div>
            <div class="modify-section" id="modify-section-current" style="display: none; background: #fef3c7; border: 2px solid #eab308; padding: 15px; margin: 10px 0; border-radius: 6px;">
                <label for="modify-textarea-current" style="display: block; margin-bottom: 8px; font-weight: bold;">Your modified text:</label>
                <textarea id="modify-textarea-current" style="width: 100%; min-height: 80px; padding: 10px; border: 1px solid #ddd; border-radius: 4px; font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif; font-size: 16px; box-sizing: border-box;" placeholder="Enter your custom text here...">${escapeHtml(suggestion.suggestedText)}</textarea>
                <div style="margin-top: 10px;">
                    <button onclick="confirmCurrentModification()" style="background: #16a34a; color: white; padding: 10px 20px; border: none; border-radius: 4px; cursor: pointer; font-size: 14px; font-weight: bold;">✅ Confirm</button>
                    <button onclick="hideModifySection()" style="background: #6c757d; color: white; padding: 10px 20px; border: none; border-radius: 4px; cursor: pointer; font-size: 14px; margin-left: 10px;">❌ Cancel</button>
                </div>
            </div>
            <!-- Navigation buttons moved to fixed bottom row -->
            <div style="margin-top: 15px; text-align: center; font-size: 13px; color: #666;">${decisions.length} decision${decisions.length !== 1 ? 's' : ''} made • ${totalSuggestions - currentIndex - 1} remaining</div>
        </div>
    `;

    const existingReview = document.getElementById('suggestion-review-current');
    if (existingReview && existingReview.parentElement) {
        existingReview.outerHTML = suggestionHtml;
    } else {
        appendToSummary1(suggestionHtml, true);
    }
}

window.showModifySection = function () { document.getElementById('modify-section-current').style.display = 'block'; };
window.hideModifySection = function () { document.getElementById('modify-section-current').style.display = 'none'; };

window.handleCurrentSuggestionAction = async function (action) {
    const review = window.currentSuggestionReview;
    if (!review) return;
    const suggestion = review.suggestions[review.currentIndex];

    // Set button to applying state
    const buttonMap = {
        'accept': 'suggestionAcceptBtn',
        'reject': 'suggestionRejectBtn',
        'skip': 'suggestionSkipBtn'
    };
    const buttonId = buttonMap[action];
    if (buttonId) {
        setSuggestionButtonApplying(buttonId, true);
    }

    try {
        // Heuristic: adjust insertion target for certain additions (e.g., tumour markers → Plan)
        function adjustInsertionPointForSuggestion(suggestion, insertionPoint, currentContent) {
            try {
                const text = (suggestion?.suggestedText || '').toLowerCase();
                const isAddPrefix = /^\s*add[:\-]/i.test(suggestion?.suggestedText || '');
                const mentionsTumourMarkers = /(alpha[\s\-]?fetoprotein|afp|beta[\s\-]?hcg|β[\s\-]?hcg|tumou?r\s+markers?)/i.test(suggestion?.suggestedText || '');
                const mentionsReferralOrPlan = /(refer|mdt|review|follow\s*up|counsel|consent)/i.test(suggestion?.suggestedText || '');

                // Prefer Plan for action-oriented additions (tests to arrange, referrals, etc.)
                if (suggestion?.category === 'addition' && (isAddPrefix || mentionsTumourMarkers || mentionsReferralOrPlan)) {
                    // If a Plan section exists in the note, target Plan; else keep original but append at end
                    const hasPlanSection = /(^|\n)Plan\s*:|(^|\n)Plan\s*$/im.test(currentContent);
                    if (hasPlanSection) {
                        // Preserve subsection from AI if present
                        return {
                            section: 'Plan',
                            subsection: insertionPoint.subsection || null,
                            reasoning: 'Action-oriented addition placed under Plan by client heuristic'
                        };
                    }
                    // No Plan section found – fall back to end append
                    return {
                        section: 'end',
                        subsection: null,
                        reasoning: 'No Plan section found; appending to end'
                    };
                }
            } catch (e) {
                console.warn('[DEBUG] adjustInsertionPointForSuggestion: error applying heuristic', e);
            }
            // Return insertion point with preserved metadata
            return insertionPoint;
        }

        // Intercept reject action to show feedback modal
        if (action === 'reject') {
            const suggestionId = `current-review-${review.currentIndex}`;
            showFeedbackModal(suggestionId, suggestion, (feedbackReason) => {
                // Record decision with feedback
                review.decisions.push({
                    suggestion,
                    action: 'reject',
                    feedbackReason: feedbackReason
                });

                console.log('[FEEDBACK] Recorded rejection in one-at-a-time review', {
                    index: review.currentIndex,
                    hasFeedback: !!feedbackReason,
                    feedbackLength: feedbackReason.length
                });

                // Continue to next suggestion
                clearHighlightInEditor();
                review.currentIndex++;
                showCurrentSuggestion();

                // Restore button state after modal callback completes
                if (buttonId) {
                    setSuggestionButtonApplying(buttonId, false);
                }
            });
            return; // Don't continue with normal flow - button state restored in callback
        }

        // For non-reject actions, continue normally
        review.decisions.push({ suggestion, action });

        if (action === 'accept' && suggestion.suggestedText) {
            const currentContent = getUserInputContent();
            let newContent;

            // Handle additions (missing documentation) vs modifications (replacing existing text)
            if (suggestion.category === 'addition' || !suggestion.originalText) {
                // Addition: use new AI incorporation workflow
                console.log('[DEBUG] handleCurrentSuggestionAction: Using AI incorporation for addition');

                try {
                    // Use cached insertion point if available, otherwise fetch it now
                    let insertionPoint = suggestion.cachedInsertionPoint;
                    if (!insertionPoint) {
                        console.log('[DEBUG] handleCurrentSuggestionAction: No cached insertion point, fetching now');
                        insertionPoint = await determineInsertionPoint(suggestion, currentContent);
                    } else {
                        console.log('[DEBUG] handleCurrentSuggestionAction: Using cached insertion point');
                    }

                    // Apply client-side heuristic adjustment
                    insertionPoint = adjustInsertionPointForSuggestion(suggestion, insertionPoint, currentContent);
                    console.log('[DEBUG] handleCurrentSuggestionAction: Insertion point:', insertionPoint);

                    // Extract section content
                    const sectionInfo = extractSectionContent(currentContent, insertionPoint.section, insertionPoint.subsection);

                    if (!sectionInfo) {
                        console.error('[DEBUG] handleCurrentSuggestionAction: Could not extract section, falling back to simple append');
                        newContent = currentContent + '\n' + suggestion.suggestedText;
                        setUserInputContent(newContent, true, 'Guideline Suggestions - Addition', [{ findText: '', replacementText: suggestion.suggestedText }]);
                    } else {
                        // Call AI to incorporate suggestion into section
                        console.log('[DEBUG] handleCurrentSuggestionAction: Calling incorporateSuggestion API');
                        const idToken = await firebase.auth().currentUser.getIdToken();
                        const response = await fetch(`${window.SERVER_URL}/incorporateSuggestion`, {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                'Authorization': `Bearer ${idToken}`
                            },
                            body: JSON.stringify({
                                sectionName: insertionPoint.section,
                                subsectionName: insertionPoint.subsection,
                                currentSectionContent: sectionInfo.content,
                                suggestionText: suggestion.suggestedText
                            })
                        });

                        if (!response.ok) {
                            throw new Error(`Failed to incorporate suggestion: ${response.status}`);
                        }

                        const result = await response.json();
                        console.log('[DEBUG] handleCurrentSuggestionAction: Incorporation result:', result.insertionLocation);

                        // Replace section content with modified version
                        newContent = replaceSectionContent(
                            currentContent,
                            insertionPoint.section,
                            insertionPoint.subsection,
                            sectionInfo.content,
                            result.modifiedSectionContent
                        );

                        setUserInputContent(newContent, true, 'Guideline Suggestions - Addition', [{ findText: '', replacementText: suggestion.suggestedText }]);
                    }
                } catch (error) {
                    console.error('[DEBUG] handleCurrentSuggestionAction: Error incorporating suggestion:', error);
                    // Fallback to simple append - use single newline to avoid inappropriate blank lines
                    newContent = currentContent + '\n' + suggestion.suggestedText;
                    setUserInputContent(newContent, true, 'Guideline Suggestions - Addition (Fallback)', [{ findText: '', replacementText: suggestion.suggestedText }]);
                }
            } else if (suggestion.originalText) {
                // Modification/Deletion: try exact replacement first
                let replacementResult = applySuggestionTextReplacement(
                    currentContent,
                    suggestion.originalText,
                    suggestion.suggestedText
                );

                if (replacementResult.didReplace) {
                    newContent = replacementResult.content;
                    setUserInputContent(newContent, true, 'Guideline Suggestions - Accepted', [
                        { findText: suggestion.originalText, replacementText: suggestion.suggestedText }
                    ]);
                } else {
                    // Fallback: use AI section-merging workflow to fold the new text into the correct section
                    try {
                        // Reuse cached insertion point if available, otherwise fetch it now
                        let insertionPoint = suggestion.cachedInsertionPoint;
                        if (!insertionPoint) {
                            console.log('[DEBUG] handleCurrentSuggestionAction: No cached insertion point for modification, fetching now');
                            insertionPoint = await determineInsertionPoint(suggestion, currentContent);
                        } else {
                            console.log('[DEBUG] handleCurrentSuggestionAction: Using cached insertion point for modification');
                        }

                        // Apply client-side heuristic adjustment (same as for additions)
                        insertionPoint = adjustInsertionPointForSuggestion(suggestion, insertionPoint, currentContent);
                        console.log('[DEBUG] handleCurrentSuggestionAction (modification): Insertion point:', insertionPoint);

                        // Extract section content
                        const sectionInfo = extractSectionContent(currentContent, insertionPoint.section, insertionPoint.subsection);

                        if (!sectionInfo) {
                            console.error('[DEBUG] handleCurrentSuggestionAction (modification): Could not extract section, falling back to simple append');
                            newContent = currentContent + '\n' + suggestion.suggestedText;
                            setUserInputContent(newContent, true, 'Guideline Suggestions - Accepted (Fallback Append)', [
                                { findText: '', replacementText: suggestion.suggestedText }
                            ]);
                        } else {
                            console.log('[DEBUG] handleCurrentSuggestionAction (modification): Calling incorporateSuggestion API with originalText');
                            const idToken = await firebase.auth().currentUser.getIdToken();
                            const response = await fetch(`${window.SERVER_URL}/incorporateSuggestion`, {
                                method: 'POST',
                                headers: {
                                    'Content-Type': 'application/json',
                                    'Authorization': `Bearer ${idToken}`
                                },
                                body: JSON.stringify({
                                    sectionName: insertionPoint.section,
                                    subsectionName: insertionPoint.subsection,
                                    currentSectionContent: sectionInfo.content,
                                    suggestionText: suggestion.suggestedText,
                                    originalText: suggestion.originalText
                                })
                            });

                            if (!response.ok) {
                                throw new Error(`Failed to incorporate suggestion (modification): ${response.status}`);
                            }

                            const result = await response.json();
                            console.log('[DEBUG] handleCurrentSuggestionAction (modification): Incorporation result:', result.insertionLocation);

                            // Replace section content with modified version
                            newContent = replaceSectionContent(
                                currentContent,
                                insertionPoint.section,
                                insertionPoint.subsection,
                                sectionInfo.content,
                                result.modifiedSectionContent
                            );

                            setUserInputContent(newContent, true, 'Guideline Suggestions - Accepted (AI Section Merge)', [
                                { findText: suggestion.originalText, replacementText: suggestion.suggestedText }
                            ]);
                        }
                    } catch (error) {
                        console.error('[DEBUG] handleCurrentSuggestionAction (modification): Error incorporating via AI, falling back to append:', error);
                        // Final fallback: append suggested text so it is at least present in the note
                        // Use single newline to avoid inappropriate blank lines
                        newContent = currentContent + '\n' + suggestion.suggestedText;
                        setUserInputContent(newContent, true, 'Guideline Suggestions - Accepted (AI Fallback Append)', [
                            { findText: '', replacementText: suggestion.suggestedText }
                        ]);
                    }
                }
            }
        }

        clearHighlightInEditor();
        review.currentIndex++;
        showCurrentSuggestion();
    } finally {
        // Restore button state (only if not reject, as reject restores in callback)
        if (buttonId && action !== 'reject') {
            setSuggestionButtonApplying(buttonId, false);
        }
    }
};

window.confirmCurrentModification = async function () {
    const review = window.currentSuggestionReview;
    if (!review) return;
    const modifyTextarea = document.getElementById('modify-textarea-current');
    if (!modifyTextarea) return;
    const modifiedText = modifyTextarea.value.trim();
    if (!modifiedText) { alert('Please enter some text.'); return; }

    // Set modify button to applying state
    setSuggestionButtonApplying('suggestionModifyBtn', true);

    try {
        const suggestion = review.suggestions[review.currentIndex];
        review.decisions.push({ suggestion, action: 'modify', modifiedText });

        const currentContent = getUserInputContent();
        let newContent;

        // Handle additions (missing documentation) vs modifications (replacing existing text)
        if (suggestion.category === 'addition' || !suggestion.originalText) {
            // Addition: fold the modified text into the correct section/list using the same
            // AI insertion pipeline as for accepted additions, rather than appending at the end.
            try {
                let insertionPoint = suggestion.cachedInsertionPoint;
                if (!insertionPoint) {
                    console.log('[DEBUG] confirmCurrentModification: No cached insertion point for addition, fetching now');
                    insertionPoint = await determineInsertionPoint(suggestion, currentContent);
                } else {
                    console.log('[DEBUG] confirmCurrentModification: Using cached insertion point for addition');
                }

                insertionPoint = adjustInsertionPointForSuggestion(suggestion, insertionPoint, currentContent);
                console.log('[DEBUG] confirmCurrentModification (addition): Insertion point:', insertionPoint);

                const sectionInfo = extractSectionContent(currentContent, insertionPoint.section, insertionPoint.subsection);

                if (!sectionInfo) {
                    console.error('[DEBUG] confirmCurrentModification (addition): Could not extract section, falling back to simple append');
                    const spacing = currentContent.trim() ? '\n\n' : '';
                    newContent = currentContent + spacing + modifiedText;
                    setUserInputContent(newContent, true, 'Guideline Suggestions - Modified Addition (Fallback Append)', [
                        { findText: '', replacementText: modifiedText }
                    ]);
                } else {
                    console.log('[DEBUG] confirmCurrentModification (addition): Calling incorporateSuggestion API with modifiedText');
                    const idToken = await firebase.auth().currentUser.getIdToken();
                    const body = {
                        sectionName: insertionPoint.section,
                        subsectionName: insertionPoint.subsection,
                        currentSectionContent: sectionInfo.content,
                        suggestionText: modifiedText
                    };
                    // If we have an original reference text (e.g. an existing bullet), pass it so
                    // the AI can update/merge that line rather than always adding a new one.
                    if (suggestion.originalText) {
                        body.originalText = suggestion.originalText;
                    }

                    const response = await fetch(`${window.SERVER_URL}/incorporateSuggestion`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${idToken}`
                        },
                        body: JSON.stringify(body)
                    });

                    if (!response.ok) {
                        throw new Error(`Failed to incorporate modified addition: ${response.status}`);
                    }

                    const result = await response.json();
                    console.log('[DEBUG] confirmCurrentModification (addition): Incorporation result:', result.insertionLocation);

                    newContent = replaceSectionContent(
                        currentContent,
                        insertionPoint.section,
                        insertionPoint.subsection,
                        sectionInfo.content,
                        result.modifiedSectionContent
                    );

                    setUserInputContent(newContent, true, 'Guideline Suggestions - Modified Addition', [
                        { findText: suggestion.originalText || '', replacementText: modifiedText }
                    ]);
                }
            } catch (error) {
                console.error('[DEBUG] confirmCurrentModification (addition): Error incorporating via AI, falling back to append:', error);
                const spacing = currentContent.trim() ? '\n\n' : '';
                newContent = currentContent + spacing + modifiedText;
                setUserInputContent(newContent, true, 'Guideline Suggestions - Modified Addition (AI Fallback Append)', [
                    { findText: '', replacementText: modifiedText }
                ]);
            }
        } else if (suggestion.originalText) {
            // Modification: try to replace existing text with user's modified version
            let replacementResult = applySuggestionTextReplacement(
                currentContent,
                suggestion.originalText,
                modifiedText
            );

            if (replacementResult.didReplace) {
                newContent = replacementResult.content;
                setUserInputContent(newContent, true, 'Guideline Suggestions - Modified', [
                    { findText: suggestion.originalText, replacementText: modifiedText }
                ]);
            } else {
                // Fallback: use AI section-merging workflow with the user's modified text
                try {
                    let insertionPoint = suggestion.cachedInsertionPoint;
                    if (!insertionPoint) {
                        console.log('[DEBUG] confirmCurrentModification: No cached insertion point for modification, fetching now');
                        insertionPoint = await determineInsertionPoint(suggestion, currentContent);
                    } else {
                        console.log('[DEBUG] confirmCurrentModification: Using cached insertion point for modification');
                    }

                    insertionPoint = adjustInsertionPointForSuggestion(suggestion, insertionPoint, currentContent);
                    console.log('[DEBUG] confirmCurrentModification: Insertion point:', insertionPoint);

                    const sectionInfo = extractSectionContent(currentContent, insertionPoint.section, insertionPoint.subsection);

                    if (!sectionInfo) {
                        console.error('[DEBUG] confirmCurrentModification: Could not extract section, falling back to simple append');
                        newContent = currentContent + '\n' + modifiedText;
                        setUserInputContent(newContent, true, 'Guideline Suggestions - Modified (Fallback Append)', [
                            { findText: '', replacementText: modifiedText }
                        ]);
                    } else {
                        console.log('[DEBUG] confirmCurrentModification: Calling incorporateSuggestion API with originalText and modifiedText');
                        const idToken = await firebase.auth().currentUser.getIdToken();
                        const response = await fetch(`${window.SERVER_URL}/incorporateSuggestion`, {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                'Authorization': `Bearer ${idToken}`
                            },
                            body: JSON.stringify({
                                sectionName: insertionPoint.section,
                                subsectionName: insertionPoint.subsection,
                                currentSectionContent: sectionInfo.content,
                                suggestionText: modifiedText,
                                originalText: suggestion.originalText
                            })
                        });

                        if (!response.ok) {
                            throw new Error(`Failed to incorporate modified suggestion: ${response.status}`);
                        }

                        const result = await response.json();
                        console.log('[DEBUG] confirmCurrentModification: Incorporation result:', result.insertionLocation);

                        newContent = replaceSectionContent(
                            currentContent,
                            insertionPoint.section,
                            insertionPoint.subsection,
                            sectionInfo.content,
                            result.modifiedSectionContent
                        );

                        setUserInputContent(newContent, true, 'Guideline Suggestions - Modified (AI Section Merge)', [
                            { findText: suggestion.originalText, replacementText: modifiedText }
                        ]);
                    }
                } catch (error) {
                    console.error('[DEBUG] confirmCurrentModification: Error incorporating via AI, falling back to append:', error);
                    // Use single newline to avoid inappropriate blank lines
                    newContent = currentContent + '\n' + modifiedText;
                    setUserInputContent(newContent, true, 'Guideline Suggestions - Modified (AI Fallback Append)', [
                        { findText: '', replacementText: modifiedText }
                    ]);
                }
            }
        }

        clearHighlightInEditor();
        review.currentIndex++;
        showCurrentSuggestion();
    } finally {
        // Restore button state
        setSuggestionButtonApplying('suggestionModifyBtn', false);
    }
};

window.navigateSuggestion = function (direction) {
    const review = window.currentSuggestionReview;
    if (!review) return;
    clearHighlightInEditor();
    if (direction < 0 && review.currentIndex > 0) {
        review.currentIndex--;
        if (review.decisions.length > review.currentIndex) review.decisions.pop();
    }
    showCurrentSuggestion();
};

async function completeSuggestionReview() {
    const review = window.currentSuggestionReview;
    if (!review) return;
    clearHighlightInEditor();
    const accepted = review.decisions.filter(d => d.action === 'accept').length;
    const rejected = review.decisions.filter(d => d.action === 'reject').length;
    const modified = review.decisions.filter(d => d.action === 'modify').length;
    const skipped = review.suggestions.length - review.decisions.length;

    // Submit feedback from one-at-a-time review
    submitFeedbackFromReview(review);

    const completionHtml = `<div style="background: #d4edda; border: 1px solid #c3e6cb; color: #155724; padding: 15px; margin: 10px 0; border-radius: 6px;"><strong>✅ Suggestions Review Complete</strong><br>${accepted} accepted • ${rejected} rejected • ${modified} modified • ${skipped} skipped</div>`;
    const reviewContainer = document.getElementById('suggestion-review-current');
    if (reviewContainer) reviewContainer.outerHTML = ''; // Remove review UI

    // Summarise outcomes via status bar instead of summary1 banner
    updateUser(
        `Suggestions review complete: ${accepted} accepted, ${rejected} rejected, ${modified} modified, ${skipped} skipped.`,
        false
    );
    window.currentSuggestionReview = null;

    // Update buttons state
    updateSuggestionActionButtons();
    // Re-evaluate whether summary1 should still be visible now that the review UI is gone
    if (typeof updateSummaryVisibility === 'function') {
        updateSummaryVisibility();
    }

    // Check if we're in sequential processing mode and need to move to next guideline
    if (window.sequentialProcessingActive) {
        console.log('[DEBUG] completeSuggestionReview: Sequential processing active, checking for next guideline');
        const queue = window.sequentialProcessingQueue || [];
        const currentIndex = window.sequentialProcessingIndex || 0;

        console.log('[DEBUG] completeSuggestionReview: Queue status:', {
            queueLength: queue.length,
            currentIndex: currentIndex,
            hasMore: currentIndex < queue.length - 1
        });

        if (currentIndex < queue.length - 1) {
            // Move to next guideline
            window.sequentialProcessingIndex = currentIndex + 1;
            const nextGuidelineId = queue[currentIndex + 1];
            const nextStepNumber = currentIndex + 2;

            console.log(`[DEBUG] completeSuggestionReview: Moving to guideline ${nextStepNumber}/${queue.length}`);

            // Update status display if it exists
            const statusDiv = document.getElementById('processing-status');
            if (statusDiv) {
                statusDiv.innerHTML = queue.map((id, index) => {
                    const guideline = window.relevantGuidelines.find(g => g.id === id);
                    const title = getGuidelineDisplayName(id, guideline);
                    const shortTitle = title.length > 50 ? title.substring(0, 47) + '...' : title;

                    let className = 'processing-step pending';
                    let emoji = '⏳';

                    if (index < window.sequentialProcessingIndex) {
                        className = 'processing-step completed';
                        emoji = '✅';
                    } else if (index === window.sequentialProcessingIndex) {
                        className = 'processing-step current';
                        emoji = '🔄';
                    }

                    return `<div class="${className}">${emoji} ${index + 1}. ${shortTitle}</div>`;
                }).join('');
            }

            // Show transition message in status bar
            const transitionMessage = 'Incorporating changes and preparing for next guideline...';
            updateUser(transitionMessage, true);

            // Process next guideline after a short delay
            setTimeout(async () => {
                try {
                    const processingStepMessage = `Processing guideline ${nextStepNumber}/${queue.length}...`;
                    updateUser(processingStepMessage, true);
                    await processSingleGuideline(nextGuidelineId, nextStepNumber, queue.length);
                } catch (error) {
                    console.error('[DEBUG] Error processing next guideline after completion:', error);
                    const errorMessage = `Error processing guideline ${nextStepNumber}: ${error.message}`;
                    updateUser(errorMessage, false);
                }
            }, 1000);
        } else {
            // All guidelines processed – report via status bar
            console.log('[DEBUG] completeSuggestionReview: All guidelines complete!');
            window.sequentialProcessingActive = false;
            updateAnalyseButtonProgress('All Guidelines Complete!', false);

            // Remove any remaining transient messages (progress indicators, processing status, etc.)
            removeTransientMessages();

            // Wait briefly for animation to complete
            await new Promise(resolve => setTimeout(resolve, 350));

            const finalMessage = `
                <div class="sequential-processing-complete">
                    <h3>🎉 All Guidelines Processed!</h3>
                    <p>Successfully processed all ${queue.length} selected guidelines.</p>
                </div>
            `;
            updateUser(`All ${queue.length} selected guidelines processed successfully.`, false);
        }
    }
}

window.cancelSuggestionReview = function () {
    const review = window.currentSuggestionReview;
    if (!review) return;

    // Set cancel button to applying state
    setSuggestionButtonApplying('suggestionCancelBtn', true);

    try {
        clearHighlightInEditor();
        const reviewContainer = document.getElementById('suggestion-review-current');
        if (reviewContainer) reviewContainer.outerHTML = '';
        updateUser('Suggestions review cancelled – no changes were applied.', false);
        window.currentSuggestionReview = null;

        // Update buttons state
        updateSuggestionActionButtons();
    } finally {
        // Restore button state
        setSuggestionButtonApplying('suggestionCancelBtn', false);
    }
};

// Get category icon for suggestion type
function getCategoryIcon(category) {
    const icons = {
        'addition': '➕',
        'modification': '✏️',
        'deletion': '🗑️',
        'formatting': '📝',
        'default': '💡'
    };
    return icons[category] || icons.default;
}

// Get appropriate label for original text based on category and content
function getOriginalTextLabel(originalText, category) {
    if (category === 'addition') {
        // For additions, we're usually dealing with missing elements
        if (originalText.toLowerCase().startsWith('no ') || originalText.toLowerCase().startsWith('did not') || originalText.toLowerCase().includes('missing')) {
            return 'Gap identified:';
        } else if (originalText.toLowerCase().startsWith('missing:') || originalText.toLowerCase().startsWith('gap:')) {
            return 'Issue found:';
        } else {
            return 'Missing element:';
        }
    } else if (category === 'modification') {
        return 'Current text:';
    } else if (category === 'deletion') {
        return 'Text to remove:';
    } else {
        return 'Current text:';
    }
}

// Handle suggestion actions (accept, reject, modify)
function handleSuggestionAction(suggestionId, action) {
    console.log('[DEBUG] handleSuggestionAction called', {
        suggestionId,
        action,
        currentChatId: window.currentChatId,
        hasCurrentSuggestions: !!window.currentSuggestions,
        currentSuggestionsCount: window.currentSuggestions?.length || 0
    });

    const suggestionElement = document.querySelector(`[data-suggestion-id="${suggestionId}"]`);
    if (!suggestionElement) {
        console.error('[DEBUG] handleSuggestionAction: Suggestion element not found:', suggestionId);
        return;
    }

    // Find the suggestion data
    const suggestion = currentSuggestions.find(s => s.id === suggestionId);
    if (!suggestion) {
        console.error('[DEBUG] handleSuggestionAction: Suggestion data not found:', suggestionId);

        // Show helpful error message to user
        const errorMessage = `
            <div style="background: #fff3cd; border: 1px solid #ffeaa7; border-radius: 6px; padding: 15px; margin: 10px 0; color: #856404;">
                <h4>⚠️ Action Not Available</h4>
                <p><strong>Issue:</strong> You're trying to interact with suggestions from a different chat session.</p>
                <p><strong>Solution:</strong> Please switch back to the original chat where these suggestions were generated, or generate new suggestions in the current chat.</p>
                <p><small>Suggestion ID: ${suggestionId} | Current Chat: ${window.currentChatId}</small></p>
            </div>
        `;

        // Find the suggestion container and add the error message
        const suggestionContainer = suggestionElement.closest('.suggestion-item');
        if (suggestionContainer) {
            suggestionContainer.insertAdjacentHTML('afterend', errorMessage);

            // Remove the error message after 10 seconds
            setTimeout(() => {
                const errorDiv = suggestionContainer.nextElementSibling;
                if (errorDiv && errorDiv.innerHTML.includes('Action Not Available')) {
                    errorDiv.remove();
                }
            }, 10000);
        }

        return;
    }

    console.log('[DEBUG] handleSuggestionAction: Processing action', {
        suggestionId,
        action,
        suggestionFound: !!suggestion
    });

    if (action === 'modify') {
        // Show modify section
        const modifySection = document.getElementById(`modify-${suggestionId}`);
        if (modifySection) {
            modifySection.style.display = 'block';
            console.log('[DEBUG] handleSuggestionAction: Showing modify section');
        }
        return;
    }

    // For reject action, prompt for optional feedback
    if (action === 'reject') {
        promptForRejectionFeedback(suggestionId, suggestion);
        return;
    }

    // For accept, record the decision and apply immediately
    userDecisions[suggestionId] = {
        action: action,
        suggestion: suggestion,
        timestamp: new Date().toISOString()
    };

    console.log('[DEBUG] handleSuggestionAction: Recorded decision', {
        suggestionId,
        action,
        totalDecisions: Object.keys(userDecisions).length
    });

    // Apply the change immediately if accepted
    if (action === 'accept' && suggestion.suggestedText) {
        const currentContent = getUserInputContent();
        let newContent;
        let replacements;

        // Handle additions (missing documentation) vs modifications (replacing existing text)
        if (suggestion.category === 'addition' || !suggestion.originalText) {
            // Addition: append the suggested text to the end of the document
            // Use single newline to avoid inappropriate blank lines between content
            const spacing = currentContent.trim() ? '\n' : '';
            newContent = currentContent + spacing + suggestion.suggestedText;
            replacements = [{
                findText: '',
                replacementText: suggestion.suggestedText
            }];
        } else {
            // Modification/Deletion: replace existing text
            newContent = currentContent.replace(
                new RegExp(suggestion.originalText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'),
                suggestion.suggestedText
            );
            replacements = [{
                findText: suggestion.originalText,
                replacementText: suggestion.suggestedText
            }];
        }

        setUserInputContent(newContent, true, 'Guideline Suggestions - Accepted', replacements);
        console.log('[DEBUG] handleSuggestionAction: Applied accepted suggestion immediately');
    }

    // Update UI to show decision
    updateSuggestionStatus(suggestionId, action);
    updateDecisionsSummary();
    debouncedSaveState(); // Save state after a decision is made
}

// ========================================
// SHARED FEEDBACK MODAL WITH SPEECH-TO-TEXT
// ========================================

// Global speech recognition instance
let currentSpeechRecognition = null;

// Shared feedback modal function with speech-to-text capability
function showFeedbackModal(suggestionId, suggestion, onSubmitCallback) {
    console.log('[FEEDBACK] Showing feedback modal:', suggestionId);

    // Check speech recognition support
    const hasSpeechRecognition = 'webkitSpeechRecognition' in window || 'SpeechRecognition' in window;

    // Create modal HTML with speech-to-text button
    const modalHtml = `
        <div id="feedback-modal-${suggestionId}" class="feedback-modal" style="
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.5);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 10000;
        ">
            <div class="feedback-modal-content" style="
                background: white;
                border-radius: 8px;
                padding: 30px;
                max-width: 600px;
                width: 90%;
                box-shadow: 0 4px 20px rgba(0,0,0,0.3);
            ">
                <h3 style="margin-top: 0; color: #2563eb;">💡 Help Us Learn</h3>
                <p style="margin-bottom: 20px; color: #666;">Why is this suggestion not appropriate? (optional)</p>
                <p style="font-size: 14px; color: #888; margin-bottom: 15px;">
                    <strong>Suggestion:</strong> ${suggestion.suggestedText?.substring(0, 150) || 'N/A'}${suggestion.suggestedText?.length > 150 ? '...' : ''}
                </p>
                <div style="position: relative;">
                    <textarea 
                        id="feedback-textarea-${suggestionId}" 
                        placeholder="E.g., 'This was SVD, not AVD - cord gases not required for spontaneous delivery'"
                        style="
                            width: 100%;
                            min-height: 100px;
                            padding: 12px;
                            padding-right: ${hasSpeechRecognition ? '50px' : '12px'};
                            border: 1px solid #ddd;
                            border-radius: 4px;
                            font-family: inherit;
                            font-size: 14px;
                            resize: vertical;
                        "
                    ></textarea>
                    ${hasSpeechRecognition ? `
                    <button 
                        id="speech-btn-${suggestionId}"
                        onclick="toggleSpeechRecognition('${suggestionId}')"
                        style="
                            position: absolute;
                            right: 10px;
                            top: 10px;
                            background: #f3f4f6;
                            border: 2px solid #d1d5db;
                            border-radius: 50%;
                            width: 36px;
                            height: 36px;
                            cursor: pointer;
                            display: flex;
                            align-items: center;
                            justify-content: center;
                            transition: all 0.2s;
                        "
                        title="Click to speak your feedback"
                    >
                        <span style="font-size: 18px;">🎤</span>
                    </button>
                    <div id="speech-status-${suggestionId}" style="
                        display: none;
                        margin-top: 8px;
                        font-size: 12px;
                        color: #dc2626;
                        font-weight: bold;
                    ">
                        🔴 Listening... (click microphone to stop)
                    </div>
                    ` : `
                    <div style="margin-top: 8px; font-size: 12px; color: #6b7280; font-style: italic;">
                        💡 Tip: Speech-to-text is not supported in your browser
                    </div>
                    `}
                </div>
                <div style="display: flex; gap: 10px; margin-top: 20px; justify-content: flex-end;">
                    <button 
                        onclick="submitFeedbackModal('${suggestionId}', true)"
                        style="
                            background: #2563eb;
                            color: white;
                            border: none;
                            padding: 10px 20px;
                            border-radius: 4px;
                            cursor: pointer;
                            font-weight: bold;
                        "
                    >Submit Feedback</button>
                    <button 
                        onclick="submitFeedbackModal('${suggestionId}', false)"
                        style="
                            background: #6c757d;
                            color: white;
                            border: none;
                            padding: 10px 20px;
                            border-radius: 4px;
                            cursor: pointer;
                        "
                    >Skip</button>
                </div>
            </div>
        </div>
    `;

    // Add modal to page
    document.body.insertAdjacentHTML('beforeend', modalHtml);

    // Store the callback for later use
    window[`feedbackCallback_${suggestionId}`] = onSubmitCallback;

    // Focus on textarea
    setTimeout(() => {
        const textarea = document.getElementById(`feedback-textarea-${suggestionId}`);
        if (textarea) textarea.focus();
    }, 100);
}

// Toggle speech recognition
window.toggleSpeechRecognition = function (suggestionId) {
    const speechBtn = document.getElementById(`speech-btn-${suggestionId}`);
    const speechStatus = document.getElementById(`speech-status-${suggestionId}`);
    const textarea = document.getElementById(`feedback-textarea-${suggestionId}`);

    if (!speechBtn || !textarea) return;

    // If already recording, stop it
    if (currentSpeechRecognition) {
        currentSpeechRecognition.stop();
        currentSpeechRecognition = null;
        speechBtn.style.background = '#f3f4f6';
        speechBtn.style.borderColor = '#d1d5db';
        if (speechStatus) speechStatus.style.display = 'none';
        return;
    }

    // Check browser support
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
        alert('Speech recognition is not supported in your browser. Please use Chrome, Edge, or Safari.');
        return;
    }

    // Create new recognition instance
    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-GB'; // British English

    let finalTranscript = textarea.value;

    recognition.onstart = () => {
        console.log('[SPEECH] Recognition started');
        speechBtn.style.background = '#fee2e2';
        speechBtn.style.borderColor = '#dc2626';
        if (speechStatus) speechStatus.style.display = 'block';
    };

    recognition.onresult = (event) => {
        let interimTranscript = '';

        for (let i = event.resultIndex; i < event.results.length; i++) {
            const transcript = event.results[i][0].transcript;
            if (event.results[i].isFinal) {
                finalTranscript += (finalTranscript ? ' ' : '') + transcript;
            } else {
                interimTranscript += transcript;
            }
        }

        // Update textarea with final + interim results
        textarea.value = finalTranscript + (interimTranscript ? ' ' + interimTranscript : '');
    };

    recognition.onerror = (event) => {
        console.error('[SPEECH] Recognition error:', event.error);
        currentSpeechRecognition = null;
        speechBtn.style.background = '#f3f4f6';
        speechBtn.style.borderColor = '#d1d5db';
        if (speechStatus) speechStatus.style.display = 'none';

        if (event.error === 'no-speech') {
            // Silent error - just stop
        } else if (event.error === 'not-allowed') {
            alert('Microphone access was denied. Please enable microphone permissions for this site.');
        } else {
            alert('Speech recognition error: ' + event.error);
        }
    };

    recognition.onend = () => {
        console.log('[SPEECH] Recognition ended');
        currentSpeechRecognition = null;
        speechBtn.style.background = '#f3f4f6';
        speechBtn.style.borderColor = '#d1d5db';
        if (speechStatus) speechStatus.style.display = 'none';

        // Keep the final transcript in the textarea
        textarea.value = finalTranscript;
    };

    // Start recognition
    currentSpeechRecognition = recognition;
    recognition.start();
};

// Submit feedback from modal (shared function)
window.submitFeedbackModal = function (suggestionId, includeFeedback) {
    console.log('[FEEDBACK] Submitting feedback from modal:', suggestionId, includeFeedback);

    // Stop any ongoing speech recognition
    if (currentSpeechRecognition) {
        currentSpeechRecognition.stop();
        currentSpeechRecognition = null;
    }

    // Get feedback text if provided
    let feedbackReason = '';
    if (includeFeedback) {
        const textarea = document.getElementById(`feedback-textarea-${suggestionId}`);
        feedbackReason = textarea ? textarea.value.trim() : '';
    }

    // Remove modal
    const modal = document.getElementById(`feedback-modal-${suggestionId}`);
    if (modal) modal.remove();

    // Call the stored callback
    const callback = window[`feedbackCallback_${suggestionId}`];
    if (callback) {
        callback(feedbackReason);
        delete window[`feedbackCallback_${suggestionId}`];
    }
};

// Submit feedback from one-at-a-time review workflow
function submitFeedbackFromReview(review) {
    if (!review || !review.decisions || review.decisions.length === 0) {
        return;
    }

    // Extract feedback entries from decisions
    const feedbackEntries = review.decisions
        .filter(d => (d.action === 'reject' || d.action === 'modify') &&
            (d.feedbackReason || d.modifiedText))
        .map((d, index) => ({
            suggestionId: `review-${index}`,
            action: d.action,
            rejectionReason: d.feedbackReason || '',
            modifiedText: d.modifiedText || null,
            originalSuggestion: d.suggestion.originalText || '',
            suggestedText: d.suggestion.suggestedText || '',
            clinicalScenario: window.latestAnalysis?.transcript?.substring(0, 500) || ''
        }));

    if (feedbackEntries.length === 0) {
        console.log('[FEEDBACK] No feedback to submit from review');
        return;
    }

    // Get guideline info from the review
    const guidelineId = review.guidelineId || window.currentGuidelineId;
    const guidelineTitle = review.guidelineTitle || window.currentGuidelineTitle || 'Unknown';

    if (!guidelineId) {
        console.log('[FEEDBACK] No guideline ID available for feedback submission');
        return;
    }

    console.log('[FEEDBACK] Submitting feedback from one-at-a-time review:', {
        guidelineId,
        entriesCount: feedbackEntries.length
    });

    // Submit to backend
    submitGuidelineFeedbackBatch(guidelineId, guidelineTitle, feedbackEntries);
}

// Legacy function for backwards compatibility (batch workflow)
function promptForRejectionFeedback(suggestionId, suggestion) {
    showFeedbackModal(suggestionId, suggestion, (feedbackReason) => {
        // Find the suggestion data
        const suggestionData = currentSuggestions.find(s => s.id === suggestionId);
        if (!suggestionData) {
            console.error('[FEEDBACK] Suggestion data not found:', suggestionId);
            return;
        }

        // Record the rejection decision with optional feedback
        userDecisions[suggestionId] = {
            action: 'reject',
            suggestion: suggestionData,
            timestamp: new Date().toISOString(),
            feedbackReason: feedbackReason
        };

        console.log('[FEEDBACK] Recorded rejection with feedback', {
            suggestionId,
            hasFeedback: !!feedbackReason,
            feedbackLength: feedbackReason.length
        });

        // Update UI to show decision
        updateSuggestionStatus(suggestionId, 'reject');
        updateDecisionsSummary();
        debouncedSaveState();

        // Check if all suggestions for this guideline have been processed
        checkAndSubmitGuidelineFeedback();
    });
}

// Submit rejection feedback (or skip)
window.submitRejectionFeedback = function (suggestionId, includeFeedback) {
    console.log('[FEEDBACK] Submitting rejection feedback:', suggestionId, includeFeedback);

    // Get feedback text if provided
    let feedbackReason = '';
    if (includeFeedback) {
        const textarea = document.getElementById(`feedback-textarea-${suggestionId}`);
        feedbackReason = textarea ? textarea.value.trim() : '';
    }

    // Find the suggestion data
    const suggestion = currentSuggestions.find(s => s.id === suggestionId);
    if (!suggestion) {
        console.error('[FEEDBACK] Suggestion data not found:', suggestionId);
        return;
    }

    // Record the rejection decision with optional feedback
    userDecisions[suggestionId] = {
        action: 'reject',
        suggestion: suggestion,
        timestamp: new Date().toISOString(),
        feedbackReason: feedbackReason
    };

    console.log('[FEEDBACK] Recorded rejection with feedback', {
        suggestionId,
        hasFeedback: !!feedbackReason,
        feedbackLength: feedbackReason.length
    });

    // Remove modal
    const modal = document.getElementById(`feedback-modal-${suggestionId}`);
    if (modal) modal.remove();

    // Update UI to show decision
    updateSuggestionStatus(suggestionId, 'reject');
    updateDecisionsSummary();
    debouncedSaveState();

    // Check if all suggestions for this guideline have been processed
    checkAndSubmitGuidelineFeedback();
};

// Check if all suggestions from a guideline have been processed and submit feedback
function checkAndSubmitGuidelineFeedback() {
    if (!currentSuggestions || currentSuggestions.length === 0) {
        return;
    }

    // Group suggestions by guideline
    const guidelineGroups = {};
    currentSuggestions.forEach(suggestion => {
        // Extract guideline info from suggestion or session
        const guidelineId = suggestion.guidelineId || window.currentGuidelineId;
        if (guidelineId) {
            if (!guidelineGroups[guidelineId]) {
                guidelineGroups[guidelineId] = {
                    guidelineId: guidelineId,
                    guidelineTitle: suggestion.guidelineTitle || window.currentGuidelineTitle || 'Unknown',
                    suggestions: []
                };
            }
            guidelineGroups[guidelineId].suggestions.push(suggestion);
        }
    });

    // Check each guideline group
    Object.keys(guidelineGroups).forEach(guidelineId => {
        const group = guidelineGroups[guidelineId];
        const allProcessed = group.suggestions.every(s => userDecisions[s.id]);

        if (allProcessed) {
            // Collect feedback entries for this guideline
            const feedbackEntries = group.suggestions
                .map(s => {
                    const decision = userDecisions[s.id];
                    if (!decision) return null;

                    // Only include rejections and modifications with feedback
                    if ((decision.action === 'reject' || decision.action === 'modify') &&
                        (decision.feedbackReason || decision.modifiedText)) {
                        return {
                            suggestionId: s.originalId || s.id,
                            action: decision.action,
                            rejectionReason: decision.feedbackReason || '',
                            modifiedText: decision.modifiedText || null,
                            originalSuggestion: s.originalText || '',
                            suggestedText: s.suggestedText || '',
                            clinicalScenario: window.latestAnalysis?.transcript?.substring(0, 500) || ''
                        };
                    }
                    return null;
                })
                .filter(entry => entry !== null);

            if (feedbackEntries.length > 0) {
                console.log('[FEEDBACK] Submitting feedback batch for guideline:', guidelineId, feedbackEntries.length, 'entries');
                submitGuidelineFeedbackBatch(guidelineId, group.guidelineTitle, feedbackEntries);
            }
        }
    });
}

// Wire up global reset button once DOM is ready (top-level, not gated by feedback flows)
document.addEventListener('DOMContentLoaded', () => {
    const resetBtn = document.getElementById('resetBtn');
    if (resetBtn) {
        resetBtn.addEventListener('click', handleGlobalReset);
    } else {
        console.warn('[DEBUG] resetBtn not found when wiring global reset handler');
    }
});

// Submit feedback batch to backend
async function submitGuidelineFeedbackBatch(guidelineId, guidelineTitle, feedbackEntries) {
    try {
        console.log('[FEEDBACK] Submitting feedback batch:', {
            guidelineId,
            entriesCount: feedbackEntries.length
        });

        // Get user token
        const user = auth.currentUser;
        if (!user) {
            console.log('[FEEDBACK] No authenticated user, skipping feedback submission');
            return;
        }

        const idToken = await user.getIdToken();

        // Submit to backend (fire and forget - don't wait)
        fetch(`${window.SERVER_URL}/submitGuidelineFeedback`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${idToken}`
            },
            body: JSON.stringify({
                guidelineId: guidelineId,
                sessionId: currentAdviceSession || `manual_${Date.now()}`,
                feedbackEntries: feedbackEntries,
                transcript: window.latestAnalysis?.transcript || ''
            })
        })
            .then(response => response.json())
            .then(result => {
                console.log('[FEEDBACK] Feedback submission result:', result);
                if (result.success && result.feedbackCount > 0) {
                    // Show subtle thank you notification
                    showFeedbackThankYou();
                }
            })
            .catch(error => {
                console.error('[FEEDBACK] Error submitting feedback:', error);
                // Fail silently - don't disrupt user workflow
            });

    } catch (error) {
        console.error('[FEEDBACK] Error in submitGuidelineFeedbackBatch:', error);
    }
}

// Show thank you notification for feedback
function showFeedbackThankYou() {
    const notification = document.createElement('div');
    notification.style.cssText = `
        position: fixed;
        bottom: 20px;
        right: 20px;
        background: #10b981;
        color: white;
        padding: 15px 20px;
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        z-index: 9999;
        font-size: 14px;
        animation: slideIn 0.3s ease-out;
    `;
    notification.innerHTML = '✅ Thank you for your feedback - helping improve future suggestions!';
    document.body.appendChild(notification);

    setTimeout(() => {
        notification.style.opacity = '0';
        notification.style.transition = 'opacity 0.3s';
        setTimeout(() => notification.remove(), 300);
    }, 4000);
}

// Confirm modification with custom text
function confirmModification(suggestionId) {
    console.log('[DEBUG] confirmModification called', { suggestionId });

    const modifyTextarea = document.getElementById(`modify-text-${suggestionId}`);
    if (!modifyTextarea) {
        console.error('[DEBUG] confirmModification: Modify textarea not found:', suggestionId);
        return;
    }

    const modifiedText = modifyTextarea.value.trim();
    if (!modifiedText) {
        alert('Please enter some text for the modification.');
        return;
    }

    // Find the suggestion data
    const suggestion = currentSuggestions.find(s => s.id === suggestionId);
    if (!suggestion) {
        console.error('[DEBUG] confirmModification: Suggestion data not found:', suggestionId);
        return;
    }

    // Record the modification decision
    userDecisions[suggestionId] = {
        action: 'modify',
        modifiedText: modifiedText,
        suggestion: suggestion,
        timestamp: new Date().toISOString()
    };

    console.log('[DEBUG] confirmModification: Recorded modification', {
        suggestionId,
        modifiedTextLength: modifiedText.length,
        totalDecisions: Object.keys(userDecisions).length
    });

    // Apply the modification immediately
    const currentContent = getUserInputContent();
    let newContent;
    let replacements;

    // Handle additions (missing documentation) vs modifications (replacing existing text)
    if (suggestion.category === 'addition' || !suggestion.originalText) {
        // Addition: append the modified text to the end of the document
        const spacing = currentContent.trim() ? '\n\n' : '';
        newContent = currentContent + spacing + modifiedText;
        replacements = [{
            findText: '',
            replacementText: modifiedText
        }];
    } else {
        // Modification: replace existing text with user's modified version
        newContent = currentContent.replace(
            new RegExp(suggestion.originalText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'),
            modifiedText
        );
        replacements = [{
            findText: suggestion.originalText,
            replacementText: modifiedText
        }];
    }

    setUserInputContent(newContent, true, 'Guideline Suggestions - Modified', replacements);
    console.log('[DEBUG] confirmModification: Applied modified suggestion immediately');

    // Hide modify section and update UI
    const modifySection = document.getElementById(`modify-${suggestionId}`);
    if (modifySection) {
        modifySection.style.display = 'none';
    }

    updateSuggestionStatus(suggestionId, 'modify', modifiedText);
    updateDecisionsSummary();
    debouncedSaveState(); // Save state after modification

    // Check if all suggestions for this guideline have been processed
    checkAndSubmitGuidelineFeedback();
}

// Cancel modification
function cancelModification(suggestionId) {
    console.log('[DEBUG] cancelModification called', { suggestionId });

    const modifySection = document.getElementById(`modify-${suggestionId}`);
    if (modifySection) {
        modifySection.style.display = 'none';
    }

    // Remove any existing decision for this suggestion
    if (userDecisions[suggestionId]) {
        delete userDecisions[suggestionId];
        console.log('[DEBUG] cancelModification: Removed decision for suggestion:', suggestionId);
    }

    // Reset status
    const statusElement = document.getElementById(`status-${suggestionId}`);
    if (statusElement) {
        statusElement.style.display = 'none';
        statusElement.innerHTML = '';
    }

    // Show the action buttons again since decision was cancelled
    const actionButtonsElement = document.querySelector(`[data-suggestion-id="${suggestionId}"] .suggestion-actions`);
    if (actionButtonsElement) {
        actionButtonsElement.style.display = 'flex';
        actionButtonsElement.style.opacity = '1';
        actionButtonsElement.style.transform = 'scale(1)';
        console.log('[DEBUG] cancelModification: Restored action buttons for suggestion:', suggestionId);
    }

    // Show the suggestion element again if it was hidden
    const suggestionElement = document.querySelector(`[data-suggestion-id="${suggestionId}"]`);
    if (suggestionElement) {
        suggestionElement.classList.remove('hiding', 'decision-accepted', 'decision-rejected', 'decision-modified');
        suggestionElement.style.display = 'block';
        console.log('[DEBUG] cancelModification: Restored suggestion visibility for:', suggestionId);
    }

    updateDecisionsSummary();
    debouncedSaveState(); // Save state after cancelling
}

// Update suggestion status UI
function updateSuggestionStatus(suggestionId, action, modifiedText = null) {
    const statusElement = document.getElementById(`status-${suggestionId}`);
    if (!statusElement) {
        console.error('[DEBUG] updateSuggestionStatus: Status element not found:', suggestionId);
        return;
    }

    let statusHtml = '';
    let statusClass = '';

    switch (action) {
        case 'accept':
            statusHtml = '<span class="status-icon">✅</span> <strong>Accepted</strong> - This suggestion will be applied';
            statusClass = 'decision-accepted';
            break;
        case 'reject':
            statusHtml = '<span class="status-icon">❌</span> <strong>Rejected</strong> - This suggestion will be ignored';
            statusClass = 'decision-rejected';
            break;
        case 'modify':
            statusHtml = `<span class="status-icon">✏️</span> <strong>Modified</strong> - Will use your custom text: "<em>${modifiedText?.substring(0, 100)}${modifiedText?.length > 100 ? '...' : ''}</em>"`;
            statusClass = 'decision-modified';
            break;
    }

    statusElement.innerHTML = statusHtml;
    statusElement.className = `decision-status ${statusClass}`;
    statusElement.style.display = 'block';

    // Hide the action buttons after decision is made with animation
    const actionButtonsElement = document.querySelector(`[data-suggestion-id="${suggestionId}"] .suggestion-actions`);
    if (actionButtonsElement) {
        actionButtonsElement.style.opacity = '0';
        actionButtonsElement.style.transform = 'scale(0.95)';
        setTimeout(() => {
            actionButtonsElement.style.display = 'none';
        }, 300);
    }

    // Update suggestion item styling and then hide the entire suggestion with animation
    const suggestionElement = document.querySelector(`[data-suggestion-id="${suggestionId}"]`);
    if (suggestionElement) {
        suggestionElement.classList.remove('decision-accepted', 'decision-rejected', 'decision-modified');
        suggestionElement.classList.add(statusClass);

        // Hide the entire suggestion after a brief delay to let user see the status
        setTimeout(() => {
            suggestionElement.classList.add('hiding');

            // After animation completes, completely hide the element
            setTimeout(() => {
                suggestionElement.style.display = 'none';
            }, 500);
        }, 1500); // Wait 1.5 seconds to let user see the decision status
    }
}

// Update decisions summary (now just shows progress since changes apply immediately)
function updateDecisionsSummary() {
    if (!currentAdviceSession) {
        return;
    }

    const summaryElement = document.getElementById(`decisionsSummary-${currentAdviceSession}`);

    if (!summaryElement) {
        // Element not found - this is OK since we removed the Apply All button
        return;
    }

    const totalSuggestions = currentSuggestions.length;
    const totalDecisions = Object.keys(userDecisions).length;
    const decisions = Object.values(userDecisions);

    const acceptedCount = decisions.filter(d => d.action === 'accept').length;
    const rejectedCount = decisions.filter(d => d.action === 'reject').length;
    const modifiedCount = decisions.filter(d => d.action === 'modify').length;

    // Show progress summary
    let summaryText = '';
    if (totalDecisions === 0) {
        summaryText = `Changes apply immediately when you Accept, Reject, or Modify each suggestion.`;
    } else {
        summaryText = `Progress: ${totalDecisions}/${totalSuggestions} decisions made. `;
        summaryText += `Accepted: ${acceptedCount}, Rejected: ${rejectedCount}, Modified: ${modifiedCount}`;
    }

    summaryElement.textContent = summaryText;
}

// Helper function to check authentication status
async function checkAuthenticationStatus() {
    try {
        const user = auth.currentUser;
        if (!user) {
            return { isValid: false, error: 'User not authenticated' };
        }

        // Try to get a token to verify auth is working
        await user.getIdToken(false); // Don't force refresh for this check
        return { isValid: true };

    } catch (error) {
        console.warn('[DEBUG] Authentication check failed:', error.message);
        return {
            isValid: false,
            error: error.message,
            needsRefresh: error.code === 'auth/network-request-failed' ||
                error.message.includes('securetoken.googleapis.com')
        };
    }
}

// Apply all user decisions
async function applyAllDecisions() {
    console.log('[DEBUG] applyAllDecisions called', {
        sessionId: currentAdviceSession,
        totalDecisions: Object.keys(userDecisions).length
    });

    if (!currentAdviceSession) {
        console.error('[DEBUG] applyAllDecisions: No active advice session');
        alert('No active advice session found. Please generate suggestions first.');
        return;
    }

    if (Object.keys(userDecisions).length === 0) {
        console.error('[DEBUG] applyAllDecisions: No decisions to apply');
        alert('Please make some decisions on the suggestions first.');
        return;
    }

    // Check authentication status before proceeding
    console.log('[DEBUG] applyAllDecisions: Checking authentication status...');
    const authStatus = await checkAuthenticationStatus();
    if (!authStatus.isValid) {
        console.error('[DEBUG] applyAllDecisions: Authentication check failed:', authStatus.error);

        if (authStatus.needsRefresh) {
            const shouldRefresh = confirm(
                'Your authentication session appears to have expired or there\'s a connectivity issue. ' +
                'Would you like to refresh the page to re-authenticate? ' +
                '(Click Cancel to try anyway)'
            );
            if (shouldRefresh) {
                window.location.reload();
                return;
            }
        }
    }

    const applyButton = document.getElementById(`applyAllDecisionsBtn-${currentAdviceSession}`);
    const applySpinner = applyButton?.querySelector('.apply-spinner');
    const applyText = applyButton?.querySelector('.apply-text');

    try {
        // Update UI to show loading state
        if (applyButton) applyButton.disabled = true;
        if (applySpinner) applySpinner.style.display = 'inline';
        if (applyText) applyText.textContent = 'Applying decisions...';

        console.log('[DEBUG] applyAllDecisions: UI updated to loading state');

        // Prepare decisions data for API (map prefixed IDs back to original IDs)
        const decisionsData = {};
        Object.entries(userDecisions).forEach(([prefixedId, decision]) => {
            // Find the original ID by looking up the suggestion
            const suggestion = currentSuggestions.find(s => s.id === prefixedId);
            const originalId = suggestion ? suggestion.originalId : prefixedId;

            decisionsData[originalId] = {
                action: decision.action,
                modifiedText: decision.modifiedText || null
            };
        });

        console.log('[DEBUG] applyAllDecisions: Prepared decisions data', {
            decisionsCount: Object.keys(decisionsData).length,
            actions: Object.values(decisionsData).map(d => d.action)
        });

        // Get user ID token with retry logic
        const user = auth.currentUser;
        if (!user) {
            throw new Error('User not authenticated');
        }

        let idToken;
        let tokenAttempts = 0;
        const maxTokenAttempts = 3;

        while (tokenAttempts < maxTokenAttempts) {
            try {
                console.log(`[DEBUG] applyAllDecisions: Getting ID token (attempt ${tokenAttempts + 1}/${maxTokenAttempts})`);

                // Try to get fresh token, with force refresh on retry attempts
                idToken = await user.getIdToken(tokenAttempts > 0);
                console.log('[DEBUG] applyAllDecisions: Got ID token successfully');
                break;

            } catch (tokenError) {
                tokenAttempts++;
                console.error(`[DEBUG] applyAllDecisions: Token attempt ${tokenAttempts} failed:`, {
                    error: tokenError.message,
                    code: tokenError.code,
                    willRetry: tokenAttempts < maxTokenAttempts
                });

                if (tokenAttempts >= maxTokenAttempts) {
                    // If all token attempts failed, provide a more user-friendly error
                    if (tokenError.code === 'auth/network-request-failed' ||
                        tokenError.message.includes('securetoken.googleapis.com') ||
                        tokenError.message.includes('are-blocked')) {
                        throw new Error('Authentication service temporarily unavailable. Please check your internet connection and try again in a few moments.');
                    } else {
                        throw new Error(`Authentication failed: ${tokenError.message}. Please sign out and sign back in.`);
                    }
                }

                // Wait before retry (exponential backoff)
                const delay = Math.min(1000 * Math.pow(2, tokenAttempts - 1), 5000);
                console.log(`[DEBUG] applyAllDecisions: Waiting ${delay}ms before retry...`);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }

        // Call the applyDynamicAdvice API with retry logic
        console.log('[DEBUG] applyAllDecisions: Calling API endpoint');
        let response;
        let apiAttempts = 0;
        const maxApiAttempts = 2;

        while (apiAttempts < maxApiAttempts) {
            try {
                console.log(`[DEBUG] applyAllDecisions: API call attempt ${apiAttempts + 1}/${maxApiAttempts}`);

                response = await fetch(`${window.SERVER_URL}/applyDynamicAdvice`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${idToken}`
                    },
                    body: JSON.stringify({
                        sessionId: currentAdviceSession,
                        decisions: decisionsData
                    })
                });

                // If we get a response, break out of retry loop
                break;

            } catch (fetchError) {
                apiAttempts++;
                console.error(`[DEBUG] applyAllDecisions: API attempt ${apiAttempts} failed:`, {
                    error: fetchError.message,
                    willRetry: apiAttempts < maxApiAttempts
                });

                if (apiAttempts >= maxApiAttempts) {
                    throw new Error(`Network error: ${fetchError.message}. Please check your internet connection and try again.`);
                }

                // Wait before retry
                const delay = 2000;
                console.log(`[DEBUG] applyAllDecisions: Waiting ${delay}ms before API retry...`);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }

        console.log('[DEBUG] applyAllDecisions: API response received', {
            status: response.status,
            ok: response.ok
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('[DEBUG] applyAllDecisions: API error response:', {
                status: response.status,
                errorText
            });
            throw new Error(`API error: ${response.status} - ${errorText}`);
        }

        const result = await response.json();
        console.log('[DEBUG] applyAllDecisions: API result received', {
            success: result.success,
            originalLength: result.originalTranscript?.length,
            updatedLength: result.updatedTranscript?.length,
            changesSummary: result.changesSummary
        });

        if (!result.success) {
            throw new Error(result.error || 'Failed to apply decisions');
        }

        // Display the process results in Summary field
        const summaryHtml = `
            <div class="apply-results">
                <h3>🎉 Decisions Applied Successfully!</h3>
                <div class="changes-summary">
                    <h4>Changes Summary:</h4>
                    <ul>
                        <li><strong>Accepted:</strong> ${result.changesSummary.accepted} suggestions</li>
                        <li><strong>Modified:</strong> ${result.changesSummary.modified} suggestions</li>
                        <li><strong>Rejected:</strong> ${result.changesSummary.rejected} suggestions</li>
                        <li><strong>Total processed:</strong> ${result.changesSummary.total} suggestions</li>
                    </ul>
                </div>
                <div class="transcript-actions">
                    <button onclick="copyUpdatedTranscript()" class="action-btn">📋 Copy Updated Transcript</button>
                    <button onclick="replaceOriginalTranscript()" class="action-btn">🔄 Replace Original Transcript</button>
                </div>
            </div>
        `;

        appendToSummary1(summaryHtml, false); // Decision panel: shows Copy/Replace actions

        // Replace the user input with the updated transcript text
        const transcriptOutput = `${result.updatedTranscript}`;
        appendToOutputField(transcriptOutput, true);

        // Store the updated transcript globally for actions
        window.lastUpdatedTranscript = result.updatedTranscript;

        console.log('[DEBUG] applyAllDecisions: Results displayed successfully');
        debouncedSaveState();

        // Trigger compliance scoring after successful application of changes
        await triggerComplianceScoring(result.originalTranscript, result.updatedTranscript, result.changesSummary);

        // Check if we're in sequential processing mode and need to continue to next guideline
        if (window.sequentialProcessingActive) {
            const queue = window.sequentialProcessingQueue || [];
            const currentIndex = window.sequentialProcessingIndex || 0;

            if (currentIndex < queue.length - 1) {
                // Move to next guideline
                window.sequentialProcessingIndex = currentIndex + 1;
                const nextGuidelineId = queue[currentIndex + 1];
                const nextStepNumber = currentIndex + 2;

                console.log(`[DEBUG] Sequential processing: Moving to guideline ${nextStepNumber}/${queue.length}`);

                // Update status display
                const statusDiv = document.getElementById('processing-status');
                if (statusDiv) {
                    statusDiv.innerHTML = queue.map((id, index) => {
                        const guideline = window.relevantGuidelines.find(g => g.id === id);
                        const title = getGuidelineDisplayName(id, guideline);
                        const shortTitle = title.length > 50 ? title.substring(0, 47) + '...' : title;

                        let className = 'processing-step pending';
                        let emoji = '⏳';

                        if (index < window.sequentialProcessingIndex) {
                            className = 'processing-step completed';
                            emoji = '✅';
                        } else if (index === window.sequentialProcessingIndex) {
                            className = 'processing-step current';
                            emoji = '🔄';
                        }

                        return `<div class="${className}">${emoji} ${index + 1}. ${shortTitle}</div>`;
                    }).join('');
                }

                // Show transition message via status bar
                const transitionMessage = 'Incorporating changes and preparing for next guideline...';
                updateUser(transitionMessage, true);

                // Update the transcript with applied changes automatically
                if (result.updatedTranscript) {
                    setUserInputContent(result.updatedTranscript, true, 'Guideline Suggestions Update');
                    console.log('[DEBUG] Sequential processing: Updated transcript automatically');
                }

                // Process next guideline after a brief delay
                setTimeout(async () => {
                    try {
                        const processingStepMessage = `Processing guideline ${nextStepNumber}/${queue.length}...`;
                        updateUser(processingStepMessage, true);

                        await processSingleGuideline(nextGuidelineId, nextStepNumber, queue.length);
                    } catch (error) {
                        console.error(`[DEBUG] Error processing next guideline ${nextGuidelineId}:`, error);

                        // Show detailed error with retry option
                        const errorMessage = `
                            <div class="sequential-processing-error">
                                <h4>❌ Error Processing Guideline ${nextStepNumber}</h4>
                                <p><strong>Error:</strong> ${error.message}</p>
                                <p>This is often due to server deployment or network issues.</p>
                                <div class="error-actions">
                                    <button onclick="retryCurrentGuideline()" class="retry-btn" style="background: #f39c12; color: white; padding: 8px 16px; border: none; border-radius: 4px; cursor: pointer; margin: 5px;">
                                        🔄 Retry This Guideline
                                    </button>
                                    <button onclick="skipCurrentGuideline()" class="skip-btn" style="background: #6c757d; color: white; padding: 8px 16px; border: none; border-radius: 4px; cursor: pointer; margin: 5px;">
                                        ⏭️ Skip This Guideline
                                    </button>
                                </div>
                            </div>
                            
                            <style>
                            .sequential-processing-error {
                                background: #fff3cd;
                                border: 1px solid #ffc107;
                                border-radius: 6px;
                                padding: 15px;
                                margin: 15px 0;
                                color: #856404;
                            }
                            .error-actions {
                                margin-top: 10px;
                            }
                            </style>
                        `;
                        appendToOutputField(errorMessage, false);
                    }
                }, 1000);

            } else {
                // All guidelines completed
                window.sequentialProcessingActive = false;

                // Update final status
                const statusDiv = document.getElementById('processing-status');
                if (statusDiv) {
                    statusDiv.innerHTML = queue.map((id, index) => {
                        const guideline = window.relevantGuidelines.find(g => g.id === id);
                        const title = getGuidelineDisplayName(id, guideline);
                        const shortTitle = title.length > 50 ? title.substring(0, 47) + '...' : title;
                        return `<div class="processing-step completed">✅ ${index + 1}. ${shortTitle}</div>`;
                    }).join('');
                }

                // Show completion message
                const finalMessage = `
                    <div class="sequential-processing-complete">
                        <h3>🎉 Sequential Processing Complete!</h3>
                        <p>Successfully processed ${queue.length} guidelines sequentially.</p>
                        <p><strong>All changes have been incorporated into your transcript.</strong></p>
                    </div>
                    
                    <style>
                    .sequential-processing-complete {
                        background: #d4edda;
                        border: 1px solid #28a745;
                        border-radius: 6px;
                        padding: 15px;
                        margin: 15px 0;
                        color: #155724;
                    }
                    </style>
                `;

                updateUser('Sequential processing completed for all selected guidelines.', false);
                console.log('[DEBUG] Sequential processing completed successfully');
            }
        }

    } catch (error) {
        console.error('[DEBUG] applyAllDecisions: Error applying decisions:', {
            error: error.message,
            stack: error.stack
        });

        // Provide specific guidance based on error type
        let errorGuidance = 'Please try again or contact support if the problem persists.';
        let showRefreshButton = false;

        if (error.message.includes('Authentication service temporarily unavailable') ||
            error.message.includes('securetoken.googleapis.com') ||
            error.message.includes('are-blocked')) {
            errorGuidance = `
                <p>This appears to be a temporary authentication service issue. You can try:</p>
                <ul>
                    <li>Wait a few minutes and try again</li>
                    <li>Check your internet connection</li>
                    <li>Refresh the page and sign in again</li>
                    <li>Try using a different network if available</li>
                </ul>
            `;
            showRefreshButton = true;
        } else if (error.message.includes('Authentication failed')) {
            errorGuidance = `
                <p>Your authentication session may have expired. Please:</p>
                <ul>
                    <li>Sign out and sign back in</li>
                    <li>Refresh the page</li>
                    <li>Clear your browser cache if the issue persists</li>
                </ul>
            `;
            showRefreshButton = true;
        } else if (error.message.includes('Network error')) {
            errorGuidance = `
                <p>There was a network connectivity issue. Please:</p>
                <ul>
                    <li>Check your internet connection</li>
                    <li>Try again in a few moments</li>
                    <li>Contact support if the issue persists</li>
                </ul>
            `;
        }

        const refreshButtonHtml = showRefreshButton ? `
            <div style="margin-top: 15px;">
                <button onclick="window.location.reload()" class="action-btn" style="background: #007bff; color: white; padding: 8px 16px; border: none; border-radius: 4px; cursor: pointer;">
                    🔄 Refresh Page
                </button>
            </div>
        ` : '';

        const errorHtml = `
            <div class="apply-error">
                <h3>❌ Error applying decisions</h3>
                <p><strong>Error:</strong> ${error.message}</p>
                ${errorGuidance}
                ${refreshButtonHtml}
            </div>
        `;
        updateUser('Error applying guideline decisions. Please refresh and try again.', false);

    } finally {
        // Reset UI state
        if (applyButton) applyButton.disabled = false;
        if (applySpinner) applySpinner.style.display = 'none';
        if (applyText) applyText.textContent = 'Apply All Decisions';
    }
}

// Helper function to copy updated transcript
function copyUpdatedTranscript() {
    if (window.lastUpdatedTranscript) {
        navigator.clipboard.writeText(window.lastUpdatedTranscript).then(() => {
            alert('Updated transcript copied to clipboard!');
        }).catch(err => {
            console.error('Failed to copy transcript:', err);
            alert('Failed to copy transcript. Please select and copy manually.');
        });
    }
}

// Helper function to replace original transcript in userInput
function replaceOriginalTranscript() {
    if (window.lastUpdatedTranscript) {
        setUserInputContent(window.lastUpdatedTranscript, true, 'Transcript Replacement');
        alert('Original transcript has been replaced with the updated version!');
        debouncedSaveState();
    }
}

// Modify initializeApp to auto-sync guidelines if needed
async function initializeApp() {
    console.log('[DEBUG] Starting initializeApp...');

    try {
        console.log('[DEBUG] Initializing marked library...');
        await initializeMarked();
        console.log('[DEBUG] Marked library initialized successfully');

        console.log('[DEBUG] Setting up Firebase auth state listener...');
        // Auth state change handler is now in the new initializeMainApp function
        // The auth state change handler will handle showing/hiding the loading screen

        console.log('[DEBUG] initializeApp completed successfully');
    } catch (error) {
        console.error('[ERROR] Failed to initialize app:', error);
        throw error;
    }
}

function setupGoogleSignIn() {
    const signInButton = document.getElementById('googleSignInBtn');
    if (signInButton) {
        // Check if listener is already set up
        if (signInButton.hasAttribute('data-listener-setup')) {
            console.log('[DEBUG] Google Sign-in button listener already set up');
            return;
        }

        console.log('[DEBUG] Setting up Google Sign-in button listener...');

        let isSigningIn = false; // Prevent concurrent sign-in attempts

        signInButton.addEventListener('click', async () => {
            if (isSigningIn) {
                console.log('[DEBUG] Sign-in already in progress, ignoring click');
                return;
            }

            try {
                isSigningIn = true;
                console.log('[DEBUG] Google Sign-in button clicked');
                const provider = new window.firebase.auth.GoogleAuthProvider();
                const result = await window.firebase.auth.signInWithPopup(provider);
                console.log('[DEBUG] Sign-in successful:', result.user.email);
            } catch (error) {
                console.error('[ERROR] Sign-in failed:', error);
                if (error.code !== 'auth/cancelled-popup-request') {
                    alert('Sign-in failed: ' + error.message);
                }
            } finally {
                isSigningIn = false;
            }
        });

        // Mark that listener has been set up
        signInButton.setAttribute('data-listener-setup', 'true');
        console.log('[DEBUG] Google Sign-in button listener set up successfully');
    } else {
        console.log('[DEBUG] Google Sign-in button not found');
    }
}

// Start initialization when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    console.log('DOM loaded, starting initialization...');

    // Ensure mode selection page is hidden on initial load
    const modeSelectionPage = document.getElementById('modeSelectionPage');
    if (modeSelectionPage) {
        modeSelectionPage.classList.add('hidden');
        console.log('[DEBUG] Ensured mode selection page is hidden on DOM load');
    }

    // Skip full initialization on audit page - only load functions
    if (window.AUDIT_PAGE) {
        console.log('Audit page detected, skipping DOM-dependent initialization');
        return;
    }

    initializeApp().catch(error => {
        console.error('Failed to initialize application:', error);
        isInitialized = true;
        // Don't show main content here - let auth state change handler handle it
        // showMainContent();
    });

    // Add click handler for generate clinical note button
    const generateClinicalNoteBtn = document.getElementById('generateClinicalNoteBtn');
    if (generateClinicalNoteBtn) {
        generateClinicalNoteBtn.addEventListener('click', generateClinicalNote);
    }

    // Add click handler for find relevant guidelines button
    const findGuidelinesBtn = document.getElementById('findGuidelinesBtn');
    if (findGuidelinesBtn) {
        findGuidelinesBtn.addEventListener('click', findRelevantGuidelines);
    }

    // Add click handlers for mode selection buttons
    const guidelineSuggestionsBtn = document.getElementById('guidelineSuggestionsBtn');
    const askGuidelinesBtn = document.getElementById('askGuidelinesBtn');
    const auditBtnMode = document.getElementById('auditBtn');
    const learnTopicBtn = document.getElementById('learnTopicBtn');

    if (guidelineSuggestionsBtn) {
        guidelineSuggestionsBtn.addEventListener('click', () => {
            window.selectedMode = 'guideline-suggestions';
            transitionToMainContent();
        });
    }

    if (askGuidelinesBtn) {
        askGuidelinesBtn.addEventListener('click', () => {
            window.selectedMode = 'ask-guidelines';
            transitionToMainContent();
        });
    }

    if (auditBtnMode) {
        auditBtnMode.addEventListener('click', () => {
            alert('Audit feature is coming soon!');
        });
    }

    if (learnTopicBtn) {
        learnTopicBtn.addEventListener('click', () => {
            alert('Learn a Topic feature is coming soon!');
        });
    }

    // Function to transition from mode selection to main content
    function transitionToMainContent() {
        const modeSelectionPage = document.getElementById('modeSelectionPage');
        const mainContent = document.getElementById('mainContent');

        if (modeSelectionPage) {
            modeSelectionPage.classList.add('hidden');
        }

        if (mainContent) {
            mainContent.classList.remove('hidden');
        }

        console.log('[DEBUG] Transitioned to main content with mode:', window.selectedMode);
    }

    // Make transitionToMainContent globally accessible
    window.transitionToMainContent = transitionToMainContent;

    // Add click handler for dev button
    const devBtn = document.getElementById('devBtn');
    if (devBtn) {
        devBtn.addEventListener('click', () => {
            console.log('[DEBUG] Dev button clicked, redirecting to dev page...');
            window.location.href = 'dev.html';
        });
    }

    // Add click handler for prompts button
    const promptsBtn = document.getElementById('promptsBtn');
    if (promptsBtn) {
        promptsBtn.addEventListener('click', () => {
            console.log('[DEBUG] Prompts button clicked, redirecting to prompts page...');
            window.location.href = 'prompts.html';
        });
    }

    // Add click handler for guidelines button
    const guidelinesBtn = document.getElementById('guidelinesBtn');
    if (guidelinesBtn) {
        guidelinesBtn.addEventListener('click', () => {
            console.log('[DEBUG] Guidelines button clicked, redirecting to guidelines page...');
            window.location.href = 'guidelines.html';
        });
    }

    // Add click handler for audit button
    const auditBtn = document.getElementById('auditBtn');
    if (auditBtn) {
        auditBtn.addEventListener('click', () => {
            console.log('[DEBUG] Audit button clicked, redirecting to audit page...');
            window.location.href = 'audit.html';
            // Close settings menu
            const settingsMenu = document.getElementById('settingsMenu');
            if (settingsMenu) {
                settingsMenu.classList.add('hidden');
            }
        });
    }

    // Add click handler for settings button
    // Settings button and menu removed from top bar - now in left panel

    // Add click handler for Preferences button
    // Handle preferences button from settings menu (if it still exists)
    const preferencesBtn = document.getElementById('preferencesBtn');
    if (preferencesBtn) {
        preferencesBtn.addEventListener('click', async () => {
            console.log('[DEBUG] Preferences button clicked');
            await showPreferencesModal();
            // Close settings menu
            if (settingsMenu) {
                settingsMenu.classList.add('hidden');
            }
        });
    }

    // Handle preferences button from left panel
    const preferencesPanelBtn = document.getElementById('preferencesPanelBtn');
    if (preferencesPanelBtn) {
        preferencesPanelBtn.addEventListener('click', async () => {
            console.log('[DEBUG] Preferences panel button clicked');
            await showPreferencesModal();
        });
    }

    // Add click handler for Hospital Trust button
    const hospitalTrustBtn = document.getElementById('hospitalTrustBtn');
    if (hospitalTrustBtn) {
        hospitalTrustBtn.addEventListener('click', async () => {
            console.log('[DEBUG] Hospital Trust button clicked');
            await showHospitalTrustModal();
        });
    }

    // Add click handler for "New Chat" button
    const newChatBtn = document.getElementById('newChatBtn');
    if (newChatBtn) {
        newChatBtn.addEventListener('click', startNewChat);
    }

    // Add click handler for test button - now generates fake clinical interactions
    const testBtn = document.getElementById('testBtn');
    if (testBtn) {
        testBtn.addEventListener('click', async () => {
            console.log('[DEBUG] Test button clicked - showing clinical issues dropdown...');
            await showClinicalIssuesDropdown();
        });
    }

    // Add click handlers for new panel buttons - navigate to dedicated pages where available
    const promptsPanelBtn = document.getElementById('promptsPanelBtn');
    if (promptsPanelBtn) {
        promptsPanelBtn.addEventListener('click', () => {
            console.log('[DEBUG] Prompts panel button clicked - navigating to prompts.html');
            window.location.href = 'prompts.html';
        });
    }

    const guidelinesPanelBtn = document.getElementById('guidelinesPanelBtn');
    if (guidelinesPanelBtn) {
        guidelinesPanelBtn.addEventListener('click', () => {
            console.log('[DEBUG] Guidelines panel button clicked - navigating to guidelines.html');
            window.location.href = 'guidelines.html';
        });
    }

    const workflowsPanelBtn = document.getElementById('workflowsPanelBtn');
    if (workflowsPanelBtn) {
        workflowsPanelBtn.addEventListener('click', () => {
            console.log('[DEBUG] Workflows panel button clicked - navigating to workflows.html');
            window.location.href = 'workflows.html';
        });
    }

    const devPanelBtn = document.getElementById('devPanelBtn');
    if (devPanelBtn) {
        devPanelBtn.addEventListener('click', () => {
            console.log('[DEBUG] Dev panel button clicked - navigating to dev.html');
            window.location.href = 'dev.html';
        });
    }

    // Lazy-load helpful external links into the in-app Links panel
    let linksLoaded = false;
    async function loadLinksIfNeeded() {
        if (linksLoaded) return;

        const linksList = document.getElementById('linksList');
        if (!linksList) return;

        try {
            const response = await fetch('links.txt');
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            const text = await response.text();
            linksList.innerHTML = '';

            text.split('\n').forEach(line => {
                const trimmed = line.trim();
                if (!trimmed) return;

                const parts = trimmed.split(';');
                if (parts.length < 2) return;

                const label = parts[0].trim();
                const url = parts[1].trim();
                if (!label || !url) return;

                const li = document.createElement('li');
                const a = document.createElement('a');
                a.href = url;
                a.textContent = label;
                a.target = '_blank';
                a.rel = 'noopener noreferrer';
                li.appendChild(a);
                linksList.appendChild(li);
            });

            linksLoaded = true;
        } catch (error) {
            console.error('Failed to load links:', error);
            linksList.innerHTML = '<li>Failed to load links. Please try again later.</li>';
        }
    }

    const linksPanelBtn = document.getElementById('linksPanelBtn');
    if (linksPanelBtn) {
        linksPanelBtn.addEventListener('click', () => {
            console.log('[DEBUG] Links panel button clicked');
            showSection('linksSection');
            loadLinksIfNeeded();
        });
    }

    // Function to show a section and hide others
    function showSection(sectionId) {
        // Hide main content views
        const threeColumnView = document.getElementById('threeColumnView');
        const workflowsView = document.getElementById('workflowsView');
        const proformaView = document.getElementById('proformaView');

        if (threeColumnView) threeColumnView.classList.add('hidden');
        if (workflowsView) workflowsView.classList.add('hidden');
        if (proformaView) proformaView.classList.add('hidden');

        // Hide all section containers
        const sections = ['promptsSection', 'guidelinesSection', 'devSection', 'linksSection'];
        sections.forEach(id => {
            const section = document.getElementById(id);
            if (section) section.classList.add('hidden');
        });

        // Show the requested section
        if (sectionId === 'workflowsView') {
            if (workflowsView) workflowsView.classList.remove('hidden');
        } else if (sectionId === 'threeColumnView') {
            // Show main chatbot view
            if (threeColumnView) threeColumnView.classList.remove('hidden');
        } else {
            const section = document.getElementById(sectionId);
            if (section) section.classList.remove('hidden');
        }

        console.log('[DEBUG] Showing section:', sectionId);
    }

    // Add logo click handler to return to main view
    const logoLink = document.querySelector('.logo-link');
    if (logoLink) {
        logoLink.addEventListener('click', (e) => {
            e.preventDefault(); // Prevent page reload
            console.log('[DEBUG] Logo clicked - returning to main view');
            showSection('threeColumnView');
        });
    }

    // Add click handler for generate transcript button
    const directFakeTranscriptBtn = document.getElementById('directFakeTranscriptBtn');
    if (directFakeTranscriptBtn) {
        directFakeTranscriptBtn.addEventListener('click', async () => {
            console.log('[DEBUG] Generate transcript button clicked...');
            const spinner = document.getElementById('directFakeTranscriptSpinner');
            const text = document.getElementById('directFakeTranscriptText');
            try {
                spinner.style.display = 'inline-block';
                text.textContent = 'Generating...';
                const response = await fetch(`${window.SERVER_URL}/generateTranscript`);
                const data = await response.json();
                if (data.success) {
                    document.getElementById('summary1').textContent = data.transcript;
                } else {
                    throw new Error(data.message || 'Failed to generate transcript');
                }
            } catch (error) {
                console.error('Failed to generate transcript:', error);
                alert('Failed to generate transcript: ' + error.message);
            } finally {
                spinner.style.display = 'none';
                text.textContent = 'Generate Transcript';
            }
        });
    }

    // Add click handler for action button
    const actionBtn = document.getElementById('actionBtn');
    if (actionBtn) {
        actionBtn.addEventListener('click', async () => {
            console.log('[DEBUG] Action button clicked...');
            const spinner = document.getElementById('actionSpinner');
            const text = document.getElementById('actionText');
            try {
                spinner.style.display = 'inline-block';
                text.textContent = 'Processing...';
                // TODO: Implement action functionality
                alert('Action functionality not yet implemented');
            } catch (error) {
                console.error('Action failed:', error);
                alert('Action failed: ' + error.message);
            } finally {
                spinner.style.display = 'none';
                text.textContent = 'Process';
            }
        });
    }

    // Add click handler for x-check button
    const xCheckBtn = document.getElementById('xCheckBtn');
    if (xCheckBtn) {
        xCheckBtn.addEventListener('click', async () => {
            console.log('[DEBUG] X-check button clicked...');
            const spinner = document.getElementById('xCheckSpinner');
            const text = document.getElementById('xCheckText');
            try {
                spinner.style.display = 'inline-block';
                text.textContent = 'Verifying...';
                // TODO: Implement x-check functionality
                alert('X-check functionality not yet implemented');
            } catch (error) {
                console.error('X-check failed:', error);
                alert('X-check failed: ' + error.message);
            } finally {
                spinner.style.display = 'none';
                text.textContent = 'Verify';
            }
        });
    }

    // Add click handler for sign out button
    const signOutBtn = document.getElementById('signOutBtn');
    if (signOutBtn) {
        signOutBtn.addEventListener('click', async () => {
            console.log('[DEBUG] Sign out button clicked...');
            try {
                await auth.signOut();
                window.location.reload();
            } catch (error) {
                console.error('Sign out failed:', error);
                alert('Failed to sign out: ' + error.message);
            }
        });
    }

    // Add click handler for save note button
    const saveNoteBtn = document.getElementById('saveNoteBtn');
    if (saveNoteBtn) {
        saveNoteBtn.addEventListener('click', () => {
            console.log('[DEBUG] Save note button clicked...');
            const userInputContent = getUserInputContent();
            if (userInputContent.trim()) {
                document.getElementById('summary1').textContent = userInputContent;
                setUserInputContent('', false);
            }
        });
    }

    // Add click handler for clear button
    const clearNoteBtn = document.getElementById('clearNoteBtn');
    if (clearNoteBtn) {
        clearNoteBtn.addEventListener('click', () => {
            console.log('[DEBUG] Clear button clicked...');
            setUserInputContent('', false);
        });
    }

    // Add click handler for check guidelines button
    const checkGuidelinesBtn = document.getElementById('checkGuidelinesBtn');
    if (checkGuidelinesBtn) {
        checkGuidelinesBtn.addEventListener('click', async () => {
            console.log('[DEBUG] Check guidelines button clicked...');
            await checkAgainstGuidelines();
        });
    }

    // Add click handler for process workflow button
    // Add click handler for analyse button
    const analyseBtn = document.getElementById('analyseBtn');
    const analyseSpinner = document.getElementById('analyseSpinner');
    if (analyseSpinner) {
        // Ensure spinner is hidden on initialization
        analyseSpinner.style.display = 'none';
    }

    // Global abort controller for cancelling analysis
    window.analysisAbortController = null;
    window.isAnalysisRunning = false;

    // Helper function to transform button to "Stop" mode
    function transformToStopButton() {
        if (!analyseBtn) return;
        const btnIcon = analyseBtn.querySelector('.btn-icon');
        const btnText = analyseBtn.querySelector('.btn-text');
        if (btnIcon) btnIcon.textContent = '⏹';
        if (btnText) btnText.textContent = 'Stop';
        analyseBtn.classList.add('stop-mode');
        window.isAnalysisRunning = true;
    }

    // Helper function to restore button to "Analyse" mode
    function restoreAnalyseButton() {
        if (!analyseBtn) return;
        const btnIcon = analyseBtn.querySelector('.btn-icon');
        const btnText = analyseBtn.querySelector('.btn-text');
        if (btnIcon) btnIcon.textContent = '🔍';
        if (btnText) btnText.textContent = 'Analyse';
        analyseBtn.classList.remove('stop-mode');
        window.isAnalysisRunning = false;
        if (analyseSpinner) analyseSpinner.style.display = 'none';
        // Keep button hidden after analysis completes
        analyseBtn.style.display = 'none';
    }

    if (analyseBtn) {
        // Prevent duplicate event listeners
        if (analyseBtn.dataset.listenerAttached === 'true') {
            console.log('[DEBUG] Analyse button listener already attached, skipping');
        } else {
            console.log('[DEBUG] Attaching analyse button listener');
            analyseBtn.dataset.listenerAttached = 'true';

            analyseBtn.addEventListener('click', async () => {
                // Check if we're in stop mode
                if (window.isAnalysisRunning && window.analysisAbortController) {
                    console.log('[DEBUG] Stop button clicked - cancelling analysis');
                    window.analysisAbortController.abort();
                    window.analysisAbortController = null;
                    restoreAnalyseButton();

                    // Show cancellation message via status bar
                    const cancelMessage = 'Analysis cancelled by user.';
                    updateUser(cancelMessage, false);
                    hideSummaryLoading();
                    // Keep button hidden after cancellation
                    if (analyseBtn) analyseBtn.style.display = 'none';
                    return;
                }

                // Check if workflow is already in progress
                if (window.workflowInProgress) {
                    console.log('[DEBUG] Analyse button clicked but workflow already in progress, ignoring');
                    return;
                }

                // Get user input text
                const editor = window.editors?.userInput;
                if (!editor) {
                    alert('Editor not available. Please try again.');
                    return;
                }

                const inputText = editor.getHTML();
                const plainText = editor.getText().trim();

                if (!plainText) {
                    alert('Please enter some text to analyse.');
                    return;
                }

                // Show loading state
                const btnIcon = analyseBtn.querySelector('.btn-icon');
                const btnText = analyseBtn.querySelector('.btn-text');
                if (btnIcon) btnIcon.textContent = '⏳';
                if (btnText) btnText.textContent = 'Detecting...';
                analyseBtn.disabled = true;

                // Detect if input is a question or clinical note using LLM
                const isQuestion = await detectInputType(plainText);
                console.log('[DEBUG] Analyse button clicked, detected type:', isQuestion ? 'question' : 'clinical note');

                // Restore button state
                if (btnIcon) btnIcon.textContent = '🔍';
                if (btnText) btnText.textContent = 'Analyse';
                analyseBtn.disabled = false;

                // Create new abort controller for this analysis
                window.analysisAbortController = new AbortController();
                transformToStopButton();

                // Hide the analyse button once analysis starts
                window.analyseButtonUsed = true;
                if (analyseBtn) {
                    analyseBtn.style.display = 'none';
                }

                try {
                    // Route to appropriate function based on detected type
                    if (isQuestion) {
                        // Set mode for ask-guidelines workflow
                        window.selectedMode = 'ask-guidelines';
                        await askGuidelinesQuestion();
                    } else {
                        // Set mode for guideline-suggestions (dynamic advice) workflow
                        window.selectedMode = 'guideline-suggestions';
                        await processWorkflow();
                    }
                } catch (error) {
                    // Check if error is due to abort
                    if (error.name === 'AbortError' || window.analysisAbortController?.signal.aborted) {
                        console.log('[DEBUG] Analysis was aborted');
                        return;
                    }
                    throw error;
                } finally {
                    // Only restore if not already aborted
                    if (!window.analysisAbortController?.signal.aborted) {
                        restoreAnalyseButton();
                    }
                    window.analysisAbortController = null;
                }
            });
        }
    }

    // Add click handler for make advice dynamic button
    const makeDynamicAdviceBtn = document.getElementById('makeDynamicAdviceBtn');
    if (makeDynamicAdviceBtn) {
        makeDynamicAdviceBtn.addEventListener('click', async () => {
            console.log('[DEBUG] Make Advice Dynamic button clicked...');

            // Check if we have analysis data available
            if (!window.latestAnalysis) {
                console.log('[DEBUG] No latest analysis found');
                alert('Please run "Check against guidelines" first to generate analysis data.');
                return;
            }

            // Check if we have relevant guidelines
            if (!window.relevantGuidelines || window.relevantGuidelines.length === 0) {
                console.log('[DEBUG] No relevant guidelines found');
                alert('Please find relevant guidelines first.');
                return;
            }

            // Get most relevant guidelines for selection
            const mostRelevantGuidelines = window.relevantGuidelines.filter(g => g.category === 'mostRelevant');

            if (mostRelevantGuidelines.length === 0) {
                console.log('[DEBUG] No most relevant guidelines found');
                alert('No "most relevant" guidelines found. Please ensure guidelines have been properly categorized.');
                return;
            }

            console.log('[DEBUG] Found most relevant guidelines:', {
                count: mostRelevantGuidelines.length,
                guidelines: mostRelevantGuidelines.map(g => ({ id: g.id, title: g.title }))
            });

            // Show guideline selection interface
            await showGuidelineSelectionInterface(mostRelevantGuidelines);
        });
    }

    // Add click handler for add issue button
    const addIssueBtn = document.getElementById('addIssueBtn');
    if (addIssueBtn) {
        addIssueBtn.addEventListener('click', () => {
            console.log('[DEBUG] Add issue button clicked...');
            // TODO: Implement add issue functionality
            alert('Add issue functionality not yet implemented');
        });
    }

    // Add click handlers for proforma buttons
    const obsProformaBtn = document.getElementById('obsProformaBtn');
    const gynProformaBtn = document.getElementById('gynProformaBtn');
    if (obsProformaBtn && gynProformaBtn) {
        obsProformaBtn.addEventListener('click', () => {
            console.log('[DEBUG] Obstetric proforma button clicked...');
            obsProformaBtn.classList.add('active');
            gynProformaBtn.classList.remove('active');
            document.getElementById('obsProforma').classList.remove('hidden');
            document.getElementById('gynProforma').classList.add('hidden');
        });

        gynProformaBtn.addEventListener('click', () => {
            console.log('[DEBUG] Gynaecology proforma button clicked...');
            gynProformaBtn.classList.add('active');
            obsProformaBtn.classList.remove('active');
            document.getElementById('gynProforma').classList.remove('hidden');
            document.getElementById('obsProforma').classList.add('hidden');
        });
    }

    // Add click handler for populate proforma button
    const populateProformaBtn = document.getElementById('populateProformaBtn');
    if (populateProformaBtn) {
        populateProformaBtn.addEventListener('click', async () => {
            console.log('[DEBUG] Populate proforma button clicked...');
            const spinner = document.getElementById('populateSpinner');
            const text = document.getElementById('populateText');
            try {
                spinner.style.display = 'inline-block';
                text.textContent = 'Populating...';
                // TODO: Implement populate proforma functionality
                alert('Populate proforma functionality not yet implemented');
            } catch (error) {
                console.error('Populate proforma failed:', error);
                alert('Failed to populate proforma: ' + error.message);
            } finally {
                spinner.style.display = 'none';
                text.textContent = 'Populate';
            }
        });
    }

    // Add click handler for save prompts button
    const savePromptsBtn = document.getElementById('savePromptsBtn');
    if (savePromptsBtn) {
        savePromptsBtn.addEventListener('click', async () => {
            console.log('[DEBUG] Save prompts button clicked...');
            try {
                const prompts = {
                    issues: document.getElementById('promptIssues').value,
                    guidelines: document.getElementById('promptGuidelines').value,
                    noteGenerator: document.getElementById('promptNoteGenerator').value
                };
                const response = await fetch(`${window.SERVER_URL}/updatePrompts`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${await auth.currentUser.getIdToken()}`
                    },
                    body: JSON.stringify({ updatedPrompts: prompts })
                });
                const data = await response.json();
                if (data.success) {
                    alert('Prompts saved successfully!');
                } else {
                    throw new Error(data.message || 'Failed to save prompts');
                }
            } catch (error) {
                console.error('Failed to save prompts:', error);
                alert('Failed to save prompts: ' + error.message);
            }
        });
    }

    // Add click handlers for test buttons
    const testServerBtn = document.getElementById('testServerBtn');
    const testGitHubBtn = document.getElementById('testGitHubBtn');
    const testOpenAIBtn = document.getElementById('testOpenAIBtn');

    if (testServerBtn) {
        testServerBtn.addEventListener('click', async () => {
            console.log('[DEBUG] Test server button clicked...');
            try {
                const response = await fetch(`${window.SERVER_URL}/test`);
                const data = await response.json();
                alert(data.message || 'Server is running!');
            } catch (error) {
                console.error('Server test failed:', error);
                alert('Server test failed: ' + error.message);
            }
        });
    }

    if (testGitHubBtn) {
        testGitHubBtn.addEventListener('click', async () => {
            console.log('[DEBUG] Test GitHub button clicked...');
            try {
                const response = await fetch(`${window.SERVER_URL}/testGitHub`);
                const data = await response.json();
                alert(data.message || 'GitHub access is working!');
            } catch (error) {
                console.error('GitHub test failed:', error);
                alert('GitHub test failed: ' + error.message);
            }
        });
    }

    if (testOpenAIBtn) {
        testOpenAIBtn.addEventListener('click', async () => {
            console.log('[DEBUG] Test OpenAI button clicked...');
            try {
                const response = await fetch(`${window.SERVER_URL}/testOpenAI`);
                const data = await response.json();
                alert(data.message || 'OpenAI access is working!');
            } catch (error) {
                console.error('OpenAI test failed:', error);
                alert('OpenAI test failed: ' + error.message);
            }
        });
    }

    // Listen for changes on the main text input to auto-save
    // Wait for TipTap editor to be ready
    window.addEventListener('tiptapReady', () => {
        const editor = window.editors?.userInput;
        if (editor) {
            editor.on('update', debouncedSaveState);
        }
    });

    // --- Speech Recognition Setup ---
    const recordBtn = document.getElementById('recordBtn');
    const userInputEl = document.getElementById('userInput');
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    let recognition;
    let isRecording = false;
    let finalTranscript = '';

    if (SpeechRecognition) {
        recognition = new SpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = 'en-US';

        recognition.onstart = () => {
            isRecording = true;
            finalTranscript = getUserInputContent();
            recordBtn.classList.add('recording');
            recordBtn.innerHTML = `<span id="recordSymbol" class="record-symbol"></span>`;
            console.log('Speech recognition started.');
        };

        recognition.onend = () => {
            isRecording = false;
            recordBtn.classList.remove('recording');
            recordBtn.innerHTML = `<span id="recordSymbol" class="record-symbol"></span>`;
            debouncedSaveState();
            console.log('Speech recognition ended.');
        };

        recognition.onerror = (event) => {
            console.error('Speech recognition error:', event.error);
            alert(`Speech recognition error: ${event.error}. Please ensure microphone access is granted.`);
            isRecording = false;
        };

        recognition.onresult = (event) => {
            let interimTranscript = '';
            let currentFinalTranscript = '';

            for (let i = event.resultIndex; i < event.results.length; ++i) {
                const transcriptPart = event.results[i][0].transcript;
                if (event.results[i].isFinal) {
                    currentFinalTranscript += transcriptPart;
                } else {
                    interimTranscript += transcriptPart;
                }
            }

            // Append newly finalized parts to the stored final transcript
            if (currentFinalTranscript) {
                // Add a space if the previous text doesn't end with one
                if (finalTranscript.length > 0 && !/\s$/.test(finalTranscript)) {
                    finalTranscript += ' ';
                }
                finalTranscript += currentFinalTranscript;
            }

            setUserInputContent(finalTranscript + interimTranscript, false);
        };

        recordBtn.addEventListener('click', () => {
            if (isRecording) {
                recognition.stop();
            } else {
                recognition.start();
            }
        });

    } else {
        console.warn('Speech Recognition not supported by this browser.');
        if (recordBtn) recordBtn.style.display = 'none';
    }
    // --- End Speech Recognition ---
});

// Logging utility
const Logger = {
    levels: {
        DEBUG: 'debug',
        INFO: 'info',
        WARN: 'warn',
        ERROR: 'error'
    },

    _formatMessage(level, message, data = null) {
        const timestamp = new Date().toISOString();
        const formattedMessage = `[${timestamp}] [${level.toUpperCase()}] ${message}`;
        return data ? `${formattedMessage} ${JSON.stringify(data)}` : formattedMessage;
    },

    debug(message, data = null) {
        if (process.env.NODE_ENV === 'development') {
            console.debug(this._formatMessage(this.levels.DEBUG, message, data));
        }
    },

    info(message, data = null) {
        console.info(this._formatMessage(this.levels.INFO, message, data));
    },

    warn(message, data = null) {
        console.warn(this._formatMessage(this.levels.WARN, message, data));
    },

    error(message, data = null) {
        console.error(this._formatMessage(this.levels.ERROR, message, data));
    }
};

// Replace console.log calls with Logger
// Example usage:
// Logger.debug('Starting initializeApp...');
// Logger.info('Application initialized successfully', { userId: user.uid });
// Logger.error('Failed to load data', { error: error.message, stack: error.stack });

// Make guideline suggestions functions globally accessible for onclick handlers
window.handleSuggestionAction = handleSuggestionAction;
window.confirmModification = confirmModification;
window.cancelModification = cancelModification;
window.copyUpdatedTranscript = copyUpdatedTranscript;
window.replaceOriginalTranscript = replaceOriginalTranscript;
window.applyAllDecisions = applyAllDecisions;
window.generateFakeClinicalInteraction = generateFakeClinicalInteraction;
window.switchChat = switchChat;
window.deleteChat = deleteChat;
window.startNewChat = startNewChat;

// Button Loading State Helper Functions
function setButtonLoading(button, isLoading, originalText = null) {
    if (!button) return;

    if (isLoading) {
        // Store original text if not already stored
        if (!button.dataset.originalText) {
            button.dataset.originalText = button.innerHTML;
        }
        button.disabled = true;
        button.innerHTML = '<span class="spinner-inline"></span> Saving...';
        button.classList.add('loading');
    } else {
        button.disabled = false;
        button.innerHTML = originalText || button.dataset.originalText || 'Save';
        button.classList.remove('loading');
        delete button.dataset.originalText;
    }
}

// Hospital Trust Management Functions
async function showHospitalTrustModal() {
    console.log('[DEBUG] Showing hospital trust modal');

    const modal = document.getElementById('hospitalTrustModal');
    const trustSelect = document.getElementById('trustSelect');
    const currentTrustDisplay = document.getElementById('currentTrustDisplay');
    const saveTrustBtn = document.getElementById('saveTrustBtn');
    const clearTrustBtn = document.getElementById('clearTrustBtn');
    const trustSearchInput = document.getElementById('trustSearchInput');
    const closeBtn = document.getElementById('closeHospitalTrustModal');

    if (!modal) {
        console.error('[ERROR] Hospital trust modal not found');
        return;
    }

    // Show modal
    modal.classList.remove('hidden');

    // Load current trust selection
    try {
        const response = await fetch(`${window.SERVER_URL}/getUserHospitalTrust`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${await auth.currentUser.getIdToken()}`
            }
        });

        const result = await response.json();
        if (result.success && result.hospitalTrust) {
            currentTrustDisplay.textContent = result.hospitalTrust;
            if (trustSelect) {
                trustSelect.value = result.hospitalTrust;
            }
        } else {
            currentTrustDisplay.textContent = 'None selected';
        }
    } catch (error) {
        console.error('[ERROR] Failed to load current hospital trust:', error);
        currentTrustDisplay.textContent = 'Error loading selection';
    }

    // Load trusts list
    await loadHospitalTrustsList();

    // Add event listeners
    if (saveTrustBtn) {
        saveTrustBtn.onclick = async () => {
            await saveHospitalTrustSelection();
        };
    }

    if (clearTrustBtn) {
        clearTrustBtn.onclick = async () => {
            await clearHospitalTrustSelection();
        };
    }

    if (trustSearchInput) {
        trustSearchInput.oninput = () => {
            filterTrustsList(trustSearchInput.value);
        };
    }

    // Close button handler
    if (closeBtn) {
        closeBtn.onclick = async () => {
            modal.classList.add('hidden');
            // Reopen preferences modal if we came from there
            if (window.openedTrustModalFromPreferences) {
                window.openedTrustModalFromPreferences = false;
                await showPreferencesModal();
            }
        };
    }

    // Close modal when clicking outside
    modal.onclick = async (event) => {
        if (event.target === modal) {
            modal.classList.add('hidden');
            // Reopen preferences modal if we came from there
            if (window.openedTrustModalFromPreferences) {
                window.openedTrustModalFromPreferences = false;
                await showPreferencesModal();
            }
        }
    };
}

async function loadHospitalTrustsList() {
    console.log('[DEBUG] Loading hospital trusts list');

    const trustSelect = document.getElementById('trustSelect');
    if (!trustSelect) {
        console.error('[ERROR] Trust select element not found');
        return;
    }

    try {
        const response = await fetch(`${window.SERVER_URL}/getHospitalTrustsList`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${await auth.currentUser.getIdToken()}`
            }
        });

        const result = await response.json();
        if (result.success && result.trusts) {
            trustSelect.innerHTML = '<option value="">-- Select a trust --</option>';
            result.trusts.forEach(trust => {
                const option = document.createElement('option');
                option.value = trust;
                option.textContent = trust;
                trustSelect.appendChild(option);
            });

            // Store full list for filtering
            window.hospitalTrustsList = result.trusts;

            console.log('[DEBUG] Loaded', result.trusts.length, 'hospital trusts');
        } else {
            throw new Error('Failed to load trusts list');
        }
    } catch (error) {
        console.error('[ERROR] Failed to load hospital trusts list:', error);
        trustSelect.innerHTML = '<option value="">Error loading trusts</option>';
    }
}

function filterTrustsList(searchTerm) {
    const trustSelect = document.getElementById('trustSelect');
    const trusts = window.hospitalTrustsList || [];

    if (!trustSelect) return;

    const currentValue = trustSelect.value;
    const lowerSearchTerm = searchTerm.toLowerCase();

    // Filter trusts based on search term
    const filteredTrusts = trusts.filter(trust =>
        trust.toLowerCase().includes(lowerSearchTerm)
    );

    // Rebuild select options
    trustSelect.innerHTML = '<option value="">-- Select a trust --</option>';
    filteredTrusts.forEach(trust => {
        const option = document.createElement('option');
        option.value = trust;
        option.textContent = trust;
        trustSelect.appendChild(option);
    });

    // Restore selection if it's in filtered list
    if (filteredTrusts.includes(currentValue)) {
        trustSelect.value = currentValue;
    }
}

async function saveHospitalTrustSelection() {
    console.log('[DEBUG] Saving hospital trust selection');

    const trustSelect = document.getElementById('trustSelect');
    const currentTrustDisplay = document.getElementById('currentTrustDisplay');
    const saveTrustBtn = document.getElementById('saveTrustBtn');

    if (!trustSelect || !trustSelect.value) {
        alert('Please select a hospital trust');
        return;
    }

    const selectedTrust = trustSelect.value;

    // Show loading state on button
    setButtonLoading(saveTrustBtn, true);

    try {
        const response = await fetch(`${window.SERVER_URL}/updateUserHospitalTrust`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${await auth.currentUser.getIdToken()}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ hospitalTrust: selectedTrust })
        });

        const result = await response.json();
        if (result.success) {
            currentTrustDisplay.textContent = selectedTrust;

            // Update saved guideline scope selection if it was using local/both
            const savedScope = await loadGuidelineScopeSelection();
            if (savedScope && (savedScope.scope === 'local' || savedScope.scope === 'both')) {
                const updatedSelection = {
                    scope: savedScope.scope,
                    hospitalTrust: selectedTrust
                };
                await saveGuidelineScopeSelection(updatedSelection);
                console.log('[DEBUG] Updated guideline scope selection with new trust:', updatedSelection);
            }

            alert(`Hospital trust updated to: ${selectedTrust}\n\nGuidelines will now be filtered and prioritised for your trust.`);

            // Reload guidelines to reflect the new trust selection
            if (window.loadGuidelinesFromFirestore) {
                await window.loadGuidelinesFromFirestore();
            }

            // Refresh sidebar displays to show the new trust
            await loadAndDisplayUserPreferences();
            await loadAndDisplayUserSettings();

            // Restore button state
            setButtonLoading(saveTrustBtn, false, 'Save Selection');

            // Close modal
            document.getElementById('hospitalTrustModal').classList.add('hidden');

            // Reopen preferences modal if we came from there
            if (window.openedTrustModalFromPreferences) {
                window.openedTrustModalFromPreferences = false;
                await showPreferencesModal();
            }
        } else {
            throw new Error(result.error || 'Failed to update hospital trust');
        }
    } catch (error) {
        console.error('[ERROR] Failed to save hospital trust:', error);
        // Restore button state on error
        setButtonLoading(saveTrustBtn, false, 'Save Selection');
        alert('Failed to save hospital trust selection. Please try again.');
    }
}

async function clearHospitalTrustSelection() {
    console.log('[DEBUG] Clearing hospital trust selection');

    const currentTrustDisplay = document.getElementById('currentTrustDisplay');
    const trustSelect = document.getElementById('trustSelect');
    const clearTrustBtn = document.getElementById('clearTrustBtn');

    if (!confirm('Are you sure you want to clear your hospital trust selection?')) {
        return;
    }

    // Show loading state on button
    setButtonLoading(clearTrustBtn, true);

    try {
        const response = await fetch(`${window.SERVER_URL}/updateUserHospitalTrust`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${await auth.currentUser.getIdToken()}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ hospitalTrust: null })
        });

        const result = await response.json();
        if (result.success) {
            currentTrustDisplay.textContent = 'None selected';
            if (trustSelect) {
                trustSelect.value = '';
            }

            // Clear saved guideline scope selection if it was using local/both
            const savedScope = await loadGuidelineScopeSelection();
            if (savedScope && (savedScope.scope === 'local' || savedScope.scope === 'both')) {
                await clearGuidelineScopeSelection();
                console.log('[DEBUG] Cleared guideline scope selection because trust was cleared');
            }

            alert('Hospital trust selection cleared.\n\nYou will now see all national guidelines.');

            // Reload guidelines
            if (window.loadGuidelinesFromFirestore) {
                await window.loadGuidelinesFromFirestore();
            }

            // Refresh sidebar displays to show cleared trust
            await loadAndDisplayUserPreferences();
            await loadAndDisplayUserSettings();

            // Restore button state
            setButtonLoading(clearTrustBtn, false, 'Clear Selection');

            // Close modal
            document.getElementById('hospitalTrustModal').classList.add('hidden');

            // Reopen preferences modal if we came from there
            if (window.openedTrustModalFromPreferences) {
                window.openedTrustModalFromPreferences = false;
                await showPreferencesModal();
            }
        } else {
            throw new Error(result.error || 'Failed to clear hospital trust');
        }
    } catch (error) {
        console.error('[ERROR] Failed to clear hospital trust:', error);
        // Restore button state on error
        setButtonLoading(clearTrustBtn, false, 'Clear Selection');
        alert('Failed to clear hospital trust selection. Please try again.');
    }
}

// Preferences Modal Functions
// Available AI models with their display names and model identifiers
const AVAILABLE_MODELS = [
    // Free/Ultra-cheap tier (Groq agentic)
    { name: 'Groq', model: 'groq/compound', displayName: 'Groq Compound (Agentic)' },
    { name: 'Groq', model: 'groq/compound-mini', displayName: 'Groq Compound Mini' },
    { name: 'Groq', model: 'moonshotai/kimi-k2-instruct', displayName: 'Groq (Kimi K2)' },
    // Very cheap tier
    { name: 'DeepSeek', model: 'deepseek-chat', displayName: 'DeepSeek' },
    { name: 'Groq', model: 'llama-3.1-8b-instant', displayName: 'Groq (Llama 3.1 8B Fast)' },
    { name: 'Gemini', model: 'gemini-3-flash-preview', displayName: 'Gemini 3 Flash' },
    { name: 'Gemini', model: 'gemini-2.5-flash', displayName: 'Gemini 2.5 Flash' },
    { name: 'Groq', model: 'openai/gpt-oss-20b', displayName: 'Groq (GPT OSS 20B)' },
    { name: 'Groq', model: 'meta-llama/llama-4-scout-17b-16e-instruct', displayName: 'Groq (Llama 4 Scout)' },
    // xAI Grok models
    { name: 'Grok', model: 'grok-4-1-fast-reasoning', displayName: 'Grok 4.1 Fast' },
    { name: 'Grok', model: 'grok-4-1-fast-non-reasoning', displayName: 'Grok 4.1 Fast (Non-Reasoning)' },
    { name: 'Grok', model: 'grok-4-fast-reasoning', displayName: 'Grok 4 Fast' },
    { name: 'Grok', model: 'grok-4-fast-non-reasoning', displayName: 'Grok 4 Fast (Non-Reasoning)' },
    { name: 'Grok', model: 'grok-4-0709', displayName: 'Grok 4 (Flagship)' },
    // More Groq models
    { name: 'Groq', model: 'openai/gpt-oss-120b', displayName: 'Groq (GPT OSS 120B)' },
    { name: 'Mistral', model: 'mistral-large-latest', displayName: 'Mistral Large' },
    { name: 'Groq', model: 'meta-llama/llama-4-maverick-17b-128e-instruct', displayName: 'Groq (Llama 4 Maverick)' },
    { name: 'Groq', model: 'qwen/qwen3-32b', displayName: 'Groq (Qwen3 32B)' },
    // Mid-range models
    { name: 'Groq', model: 'llama-3.3-70b-versatile', displayName: 'Groq (Llama 3.3 70B)' },
    { name: 'Anthropic', model: 'claude-3-haiku-20240307', displayName: 'Claude 3 Haiku' },
    { name: 'Groq', model: 'moonshotai/kimi-k2-instruct-0905', displayName: 'Groq (Kimi K2 262K)' },
    { name: 'Anthropic', model: 'claude-haiku-4-5', displayName: 'Claude Haiku 4.5' },
    // High-quality models
    { name: 'OpenAI', model: 'gpt-4.1', displayName: 'GPT-4.1' },
    { name: 'Anthropic', model: 'claude-sonnet-4-5', displayName: 'Claude Sonnet 4.5' },
    { name: 'Anthropic', model: 'claude-opus-4-5', displayName: 'Claude Opus 4.5' },
    // Legacy models
    { name: 'OpenAI', model: 'gpt-4o', displayName: 'GPT-4o' },
    { name: 'OpenAI', model: 'gpt-4o-mini', displayName: 'GPT-4o Mini' },
    { name: 'OpenAI', model: 'gpt-3.5-turbo', displayName: 'GPT-3.5 Turbo (Legacy)' }
];

// ---- Chunk distribution provider preferences ----
async function fetchChunkDistributionProviders() {
    try {
        const user = auth.currentUser;
        if (!user) {
            return AVAILABLE_MODELS.map(m => m.name);
        }

        const token = await user.getIdToken();
        const response = await fetch(`${window.SERVER_URL || 'https://clerky-uzni.onrender.com'}/getChunkDistributionProviders`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            }
        });

        if (!response.ok) {
            return AVAILABLE_MODELS.map(m => m.name);
        }

        const data = await response.json().catch(() => ({}));
        if (data && data.success && Array.isArray(data.providers)) {
            // Only return the providers the user has explicitly enabled
            // Don't add back missing providers - that would defeat the purpose of deselecting them
            const valid = data.providers.filter(p => AVAILABLE_MODELS.some(m => m.name === p));
            console.log('[CHUNK PREF] Loaded enabled providers:', valid);
            return valid;
        }

        // Default: all providers enabled (for new users who haven't set preferences)
        console.log('[CHUNK PREF] No saved preferences, using all providers');
        return AVAILABLE_MODELS.map(m => m.name);
    } catch (error) {
        console.error('[CHUNK PREF] Error fetching chunk distribution providers:', error);
        return AVAILABLE_MODELS.map(m => m.name);
    }
}

async function saveChunkDistributionProviders(providers) {
    try {
        const user = auth.currentUser;
        if (!user) {
            console.warn('[CHUNK PREF] Cannot save chunk distribution providers, user not authenticated');
            return false;
        }

        const token = await user.getIdToken();
        const response = await fetch(`${window.SERVER_URL || 'https://clerky-uzni.onrender.com'}/updateChunkDistributionProviders`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ providers })
        });

        const data = await response.json().catch(() => ({}));
        if (!response.ok && response.status !== 202) {
            console.error('[CHUNK PREF] Failed to save chunk distribution providers:', data);
            return false;
        }

        return true;
    } catch (error) {
        console.error('[CHUNK PREF] Error saving chunk distribution providers:', error);
        return false;
    }
}

function renderChunkDistributionProvidersList(enabledProviders) {
    const container = document.getElementById('chunkDistributionProvidersList');
    if (!container) return;

    container.innerHTML = '';

    const enabledSet = new Set(enabledProviders || []);

    AVAILABLE_MODELS.forEach((model) => {
        const row = document.createElement('div');
        // Important: do NOT use 'model-preference-item' here, otherwise saving model order
        // will accidentally include these rows and break /updateModelPreferences.
        row.className = 'chunk-provider-item';
        row.style.cursor = 'default';
        row.draggable = false;

        const isEnabled = enabledSet.has(model.name);

        row.innerHTML = `
            <div class="model-preference-number" style="width:28px;"> </div>
            <div class="model-preference-name">${model.displayName}</div>
            <div class="model-preference-model">${model.name}</div>
            <div style="margin-left:auto;display:flex;align-items:center;gap:8px;">
                <label style="display:flex;align-items:center;gap:6px;cursor:pointer;">
                    <input type="checkbox" class="chunk-provider-checkbox" data-provider="${model.name}" ${isEnabled ? 'checked' : ''} />
                    <span>Use for chunks</span>
                </label>
            </div>
        `;

        container.appendChild(row);
    });
}

function getSelectedChunkDistributionProviders() {
    const inputs = Array.from(document.querySelectorAll('.chunk-provider-checkbox'));
    return inputs.filter(i => i.checked).map(i => i.dataset.provider).filter(Boolean);
}

// ---- Fast RAG (vector search) preferences ----
async function fetchUserRAGPreferences() {
    const user = auth.currentUser;
    if (!user) {
        return { useRAGSearch: false, ragReranking: true, ragTopK: 20, vectorDBAvailable: false, vectorDBRecords: 0 };
    }

    const token = await user.getIdToken();

    // Timeout so the preferences modal never "hangs"
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    try {
        const response = await fetch(`${window.SERVER_URL || 'https://clerky-uzni.onrender.com'}/getUserRAGPreference`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            signal: controller.signal
        });
        clearTimeout(timeoutId);

        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json().catch(() => ({}));

        return {
            useRAGSearch: !!data.useRAGSearch,
            ragReranking: data.ragReranking ?? true,
            ragTopK: data.ragTopK ?? 20,
            vectorDBAvailable: !!data.vectorDBAvailable,
            vectorDBRecords: data.vectorDBRecords || 0
        };
    } catch (err) {
        clearTimeout(timeoutId);
        console.warn('[RAG PREF] Failed to fetch RAG preferences:', err);
        return { useRAGSearch: false, ragReranking: true, ragTopK: 20, vectorDBAvailable: false, vectorDBRecords: 0, error: err.message };
    }
}

async function saveUserRAGPreferences(preferences) {
    try {
        const user = auth.currentUser;
        if (!user) {
            console.warn('[RAG PREF] Cannot save preferences, user not authenticated');
            return false;
        }

        const token = await user.getIdToken();
        const response = await fetch(`${window.SERVER_URL || 'https://clerky-uzni.onrender.com'}/updateUserRAGPreference`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify(preferences)
        });

        const data = await response.json().catch(() => ({}));
        if (!response.ok && response.status !== 202) {
            console.error('[RAG PREF] Failed to save preferences:', data);
            return false;
        }

        console.log('[RAG PREF] Saved:', preferences);
        return true;
    } catch (err) {
        console.error('[RAG PREF] Error saving preferences:', err);
        return false;
    }
}

// Fetch user's model preference order from backend
async function fetchUserModelPreferences() {
    try {
        const user = auth.currentUser;
        if (!user) {
            console.log('[MODEL PREF] No authenticated user, using default order');
            return AVAILABLE_MODELS.map(m => m.model);
        }

        const token = await user.getIdToken();
        const response = await fetch(`${window.SERVER_URL || 'https://clerky-uzni.onrender.com'}/getModelPreferences`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            }
        });

        if (!response.ok) {
            console.warn('[MODEL PREF] Failed to fetch preferences, using default order');
            return AVAILABLE_MODELS.map(m => m.model);
        }

        const data = await response.json();
        if (data && data.success && Array.isArray(data.modelOrder)) {
            console.log('[MODEL PREF] Loaded model preferences:', data.modelOrder);
            // Validate that all models are present (use model id as unique key)
            const validOrder = data.modelOrder.filter(modelId =>
                AVAILABLE_MODELS.some(m => m.model === modelId)
            );
            // Add any missing models to the end
            const missingModels = AVAILABLE_MODELS
                .map(m => m.model)
                .filter(modelId => !validOrder.includes(modelId));
            return [...validOrder, ...missingModels];
        }

        return AVAILABLE_MODELS.map(m => m.model);
    } catch (error) {
        console.error('[MODEL PREF] Error fetching model preferences, using default order:', error);
        return AVAILABLE_MODELS.map(m => m.model);
    }
}

// Save user's model preference order to backend
async function saveUserModelPreferences(modelOrder) {
    try {
        const user = auth.currentUser;
        if (!user) {
            console.warn('[MODEL PREF] Cannot save preferences, user not authenticated');
            return false;
        }

        const token = await user.getIdToken();
        const response = await fetch(`${window.SERVER_URL || 'https://clerky-uzni.onrender.com'}/updateModelPreferences`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ modelOrder })
        });

        const data = await response.json().catch(() => ({}));
        if (!response.ok && response.status !== 202) {
            console.error('[MODEL PREF] Failed to save preferences:', data);
            return false;
        } else {
            console.log('[MODEL PREF] Model preferences saved:', modelOrder, data.warning ? '(with warning)' : '');
            return true;
        }
    } catch (err) {
        console.error('[MODEL PREF] Error saving model preferences:', err);
        return false;
    }
}

// Render model preferences list with drag and drop
let draggedModelElement = null;

function renderModelPreferencesList(modelOrder) {
    const listContainer = document.getElementById('modelPreferencesList');
    if (!listContainer) {
        console.error('[MODEL PREF] Model preferences list container not found');
        return;
    }

    listContainer.innerHTML = '';
    draggedModelElement = null;

    modelOrder.forEach((modelId, index) => {
        const model = AVAILABLE_MODELS.find(m => m.model === modelId);
        if (!model) return;

        const item = document.createElement('div');
        item.className = 'model-preference-item';
        item.draggable = true;
        item.dataset.modelName = modelId;

        item.innerHTML = `
            <div class="model-preference-number">${index + 1}</div>
            <div class="model-preference-name">${model.displayName}</div>
            <div class="model-preference-model">${model.model}</div>
            <div class="model-preference-drag-handle">⋮⋮</div>
        `;

        // Drag and drop handlers
        item.addEventListener('dragstart', (e) => {
            draggedModelElement = item;
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', ''); // Required for Firefox
            item.classList.add('dragging');
        });

        item.addEventListener('dragend', () => {
            item.classList.remove('dragging');
            draggedModelElement = null;
        });

        item.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';

            if (draggedModelElement && draggedModelElement !== item) {
                const allItems = Array.from(listContainer.querySelectorAll('.model-preference-item'));
                const draggingIndex = allItems.indexOf(draggedModelElement);
                const currentIndex = allItems.indexOf(item);

                if (draggingIndex < currentIndex) {
                    listContainer.insertBefore(draggedModelElement, item.nextSibling);
                } else {
                    listContainer.insertBefore(draggedModelElement, item);
                }
                updateModelPreferenceNumbers();
            }
        });

        item.addEventListener('drop', (e) => {
            e.preventDefault();
            if (draggedModelElement) {
                updateModelPreferenceNumbers();
            }
        });

        listContainer.appendChild(item);
    });
}

// Update the number badges after reordering
function updateModelPreferenceNumbers() {
    const items = document.querySelectorAll('#modelPreferencesList .model-preference-item');
    items.forEach((item, index) => {
        const numberEl = item.querySelector('.model-preference-number');
        if (numberEl) {
            numberEl.textContent = index + 1;
        }
    });
}

// Get current model order from the DOM
function getCurrentModelOrder() {
    const items = Array.from(document.querySelectorAll('#modelPreferencesList .model-preference-item'));
    return items.map(item => item.dataset.modelName).filter(Boolean);
}

async function showPreferencesModal() {
    console.log('[DEBUG] Showing preferences modal');

    const modal = document.getElementById('preferencesModal');
    const closeBtn = document.getElementById('closePreferencesModal');
    const preferencesTrustDisplay = document.getElementById('preferencesTrustDisplay');
    const preferencesScopeDisplay = document.getElementById('preferencesScopeDisplay');
    const preferencesChangeTrustBtn = document.getElementById('preferencesChangeTrustBtn');
    const preferencesSelectTrustBtn = document.getElementById('preferencesSelectTrustBtn');
    const preferencesClearTrustBtn = document.getElementById('preferencesClearTrustBtn');
    const preferencesNationalBtn = document.getElementById('preferencesNationalBtn');
    const preferencesLocalBtn = document.getElementById('preferencesLocalBtn');
    const preferencesBothBtn = document.getElementById('preferencesBothBtn');
    const preferencesSaveBtn = document.getElementById('preferencesSaveBtn');

    if (!modal) {
        console.error('[ERROR] Preferences modal not found');
        return;
    }

    // Show modal
    modal.classList.remove('hidden');

    // Load current trust selection
    let currentTrust = null;
    try {
        const response = await fetch(`${window.SERVER_URL}/getUserHospitalTrust`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${await auth.currentUser.getIdToken()}`
            }
        });

        const result = await response.json();
        if (result.success && result.hospitalTrust) {
            currentTrust = result.hospitalTrust;
            preferencesTrustDisplay.textContent = currentTrust;
            preferencesChangeTrustBtn.classList.remove('hidden');
            preferencesSelectTrustBtn.classList.add('hidden');
        } else {
            preferencesTrustDisplay.textContent = 'None selected';
            preferencesChangeTrustBtn.classList.add('hidden');
            preferencesSelectTrustBtn.classList.remove('hidden');
        }
    } catch (error) {
        console.error('[ERROR] Failed to load current hospital trust:', error);
        preferencesTrustDisplay.textContent = 'Error loading selection';
        preferencesChangeTrustBtn.classList.add('hidden');
        preferencesSelectTrustBtn.classList.remove('hidden');
    }

    // Load current guideline scope selection
    const savedScope = await loadGuidelineScopeSelection();
    if (savedScope) {
        let scopeText = '';
        if (savedScope.scope === 'national') {
            scopeText = 'National Guidelines';
        } else if (savedScope.scope === 'local') {
            scopeText = `Local Guidelines (${savedScope.hospitalTrust || 'Trust'})`;
        } else if (savedScope.scope === 'both') {
            scopeText = `Both (National + ${savedScope.hospitalTrust || 'Trust'})`;
        }
        preferencesScopeDisplay.textContent = scopeText;

        // Highlight selected button
        preferencesNationalBtn.classList.remove('selected');
        preferencesLocalBtn.classList.remove('selected');
        preferencesBothBtn.classList.remove('selected');

        if (savedScope.scope === 'national') {
            preferencesNationalBtn.classList.add('selected');
        } else if (savedScope.scope === 'local') {
            preferencesLocalBtn.classList.add('selected');
        } else if (savedScope.scope === 'both') {
            preferencesBothBtn.classList.add('selected');
        }
    } else {
        preferencesScopeDisplay.textContent = 'Not set';
        preferencesNationalBtn.classList.remove('selected');
        preferencesLocalBtn.classList.remove('selected');
        preferencesBothBtn.classList.remove('selected');
    }

    // Keep Local/Both clickable even if no trust is set; handlers will prompt the user to select a trust.
    // Disabling these buttons caused confusing "stop" cursor and made it feel broken.
    if (preferencesLocalBtn) preferencesLocalBtn.disabled = false;
    if (preferencesBothBtn) preferencesBothBtn.disabled = false;

    // Load and display model preferences
    try {
        const modelOrder = await fetchUserModelPreferences();
        renderModelPreferencesList(modelOrder);
    } catch (error) {
        console.error('[ERROR] Failed to load model preferences:', error);
        // Use default order on error
        renderModelPreferencesList(AVAILABLE_MODELS.map(m => m.name));
    }

    // Load and display chunk distribution provider preferences
    try {
        const enabledProviders = await fetchChunkDistributionProviders();
        renderChunkDistributionProvidersList(enabledProviders);
    } catch (error) {
        console.error('[ERROR] Failed to load chunk distribution provider preferences:', error);
        renderChunkDistributionProvidersList(AVAILABLE_MODELS.map(m => m.name));
    }

    // Load and display Fast RAG preferences
    const useRAGSearchInput = document.getElementById('useRAGSearch');
    const ragRerankingInput = document.getElementById('ragReranking');
    const ragStatusEl = document.getElementById('ragStatus');
    const ragInfoTextEl = document.getElementById('ragInfoText');
    const ragSubOptionsEl = document.getElementById('ragSubOptions');

    const setRagUiState = ({ vectorDBAvailable, vectorDBRecords, useRAGSearch, ragReranking, error }) => {
        if (!useRAGSearchInput || !ragStatusEl || !ragInfoTextEl) return;

        if (!vectorDBAvailable) {
            useRAGSearchInput.checked = false;
            useRAGSearchInput.disabled = true;
            ragStatusEl.textContent = 'Unavailable';
            ragInfoTextEl.textContent = error
                ? `Vector database status: unavailable (${error})`
                : 'Vector database status: unavailable (server not configured)';
            if (ragSubOptionsEl) ragSubOptionsEl.classList.add('hidden');
            return;
        }

        useRAGSearchInput.disabled = false;
        useRAGSearchInput.checked = !!useRAGSearch;
        if (ragRerankingInput) ragRerankingInput.checked = ragReranking ?? true;

        ragStatusEl.textContent = useRAGSearchInput.checked ? 'Enabled' : 'Disabled';
        ragInfoTextEl.textContent = `Vector database status: ready (${vectorDBRecords || 0} records)`;

        if (ragSubOptionsEl) {
            ragSubOptionsEl.classList.toggle('hidden', !useRAGSearchInput.checked);
        }
    };

    const handleRagToggleChange = () => {
        if (!useRAGSearchInput || !ragStatusEl || !ragSubOptionsEl) return;
        ragStatusEl.textContent = useRAGSearchInput.checked ? 'Enabled' : 'Disabled';
        ragSubOptionsEl.classList.toggle('hidden', !useRAGSearchInput.checked);
    };

    if (useRAGSearchInput && ragStatusEl && ragInfoTextEl) {
        ragStatusEl.textContent = 'Loading...';
        ragInfoTextEl.textContent = 'Vector database status: checking...';
        try {
            const ragPrefs = await fetchUserRAGPreferences();
            setRagUiState(ragPrefs);
        } catch (e) {
            setRagUiState({ vectorDBAvailable: false, vectorDBRecords: 0, useRAGSearch: false, ragReranking: true, error: e.message });
        }
        useRAGSearchInput.removeEventListener('change', handleRagToggleChange);
        useRAGSearchInput.addEventListener('change', handleRagToggleChange);
    }

    // Set up event handlers
    const handleChangeTrustClick = async () => {
        console.log('[DEBUG] Change Trust clicked in preferences');
        modal.classList.add('hidden');
        // Set flag so hospital trust modal knows to reopen preferences when done
        window.openedTrustModalFromPreferences = true;
        await showHospitalTrustModal();
        // Note: showHospitalTrustModal returns immediately after showing modal,
        // preferences modal will be reopened by the trust modal's save/clear/close handlers
    };

    const handleSelectTrustClick = async () => {
        console.log('[DEBUG] Select Trust clicked in preferences');
        modal.classList.add('hidden');
        // Set flag so hospital trust modal knows to reopen preferences when done
        window.openedTrustModalFromPreferences = true;
        await showHospitalTrustModal();
        // Note: showHospitalTrustModal returns immediately after showing modal,
        // preferences modal will be reopened by the trust modal's save/clear/close handlers
    };

    const handleClearTrustClick = async () => {
        console.log('[DEBUG] Clear Trust clicked in preferences');
        if (!confirm('Are you sure you want to clear your hospital trust selection?')) {
            return;
        }

        try {
            const response = await fetch(`${window.SERVER_URL}/updateUserHospitalTrust`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${await auth.currentUser.getIdToken()}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ hospitalTrust: null })
            });

            const result = await response.json();
            if (result.success) {
                // Clear saved guideline scope selection if it was using local/both
                const savedScope = loadGuidelineScopeSelection();
                if (savedScope && (savedScope.scope === 'local' || savedScope.scope === 'both')) {
                    clearGuidelineScopeSelection();
                }

                // Reload preferences modal
                await showPreferencesModal();
            } else {
                throw new Error(result.error || 'Failed to clear hospital trust');
            }
        } catch (error) {
            console.error('[ERROR] Failed to clear hospital trust:', error);
            alert('Failed to clear hospital trust selection. Please try again.');
        }
    };

    let selectedScope = savedScope ? savedScope.scope : null;

    const handleNationalClick = () => {
        console.log('[DEBUG] National scope selected in preferences');
        selectedScope = 'national';
        preferencesNationalBtn.classList.add('selected');
        preferencesLocalBtn.classList.remove('selected');
        preferencesBothBtn.classList.remove('selected');
        preferencesScopeDisplay.textContent = 'National Guidelines';
    };

    const handleLocalClick = () => {
        if (!currentTrust) {
            alert('Please select a hospital trust first.');
            return;
        }
        console.log('[DEBUG] Local scope selected in preferences');
        selectedScope = 'local';
        preferencesNationalBtn.classList.remove('selected');
        preferencesLocalBtn.classList.add('selected');
        preferencesBothBtn.classList.remove('selected');
        preferencesScopeDisplay.textContent = `Local Guidelines (${currentTrust})`;
    };

    const handleBothClick = () => {
        if (!currentTrust) {
            alert('Please select a hospital trust first.');
            return;
        }
        console.log('[DEBUG] Both scope selected in preferences');
        selectedScope = 'both';
        preferencesNationalBtn.classList.remove('selected');
        preferencesLocalBtn.classList.remove('selected');
        preferencesBothBtn.classList.add('selected');
        preferencesScopeDisplay.textContent = `Both (National + ${currentTrust})`;
    };

    const handleSaveClick = async () => {
        console.log('[DEBUG] Save Preferences clicked');

        // Show loading state on button
        setButtonLoading(preferencesSaveBtn, true);

        try {
            // Save guideline scope selection if one was selected
            if (selectedScope) {
                const scopeSelection = {
                    scope: selectedScope,
                    hospitalTrust: (selectedScope === 'local' || selectedScope === 'both') ? currentTrust : null
                };
                await saveGuidelineScopeSelection(scopeSelection);
                console.log('[DEBUG] Saved guideline scope selection:', scopeSelection);
            }

            // Save model preferences
            const modelOrder = getCurrentModelOrder();
            if (modelOrder.length > 0) {
                const saved = await saveUserModelPreferences(modelOrder);
                if (saved) {
                    console.log('[DEBUG] Saved model preferences:', modelOrder);
                    // Update main panel display with new preferred model
                    const modelDisplay = document.getElementById('mainModelDisplay');
                    if (modelDisplay && modelOrder.length > 0) {
                        const firstModelId = modelOrder[0];
                        const model = AVAILABLE_MODELS.find(m => m.model === firstModelId);
                        if (model) {
                            modelDisplay.textContent = model.displayName;
                        } else {
                            modelDisplay.textContent = firstModel;
                        }
                    }
                } else {
                    console.warn('[DEBUG] Failed to save model preferences');
                }
            }

            // Save chunk distribution provider preferences
            const chunkProviders = getSelectedChunkDistributionProviders();
            if (chunkProviders.length > 0) {
                const savedChunkProviders = await saveChunkDistributionProviders(chunkProviders);
                if (!savedChunkProviders) {
                    console.warn('[CHUNK PREF] Failed to save chunk distribution providers');
                }
            } else {
                console.warn('[CHUNK PREF] No providers selected for chunk distribution; keeping previous setting');
            }

            // Save Fast RAG preferences (if present on this page)
            if (useRAGSearchInput && ragRerankingInput && !useRAGSearchInput.disabled) {
                const ragPrefsToSave = {
                    useRAGSearch: !!useRAGSearchInput.checked,
                    ragReranking: !!ragRerankingInput.checked,
                    ragTopK: 20
                };
                const savedRag = await saveUserRAGPreferences(ragPrefsToSave);
                if (!savedRag) {
                    console.warn('[RAG PREF] Failed to save Fast RAG preferences');
                }
            }

            // Refresh sidebar displays to show the new preferences
            await loadAndDisplayUserPreferences();
            await loadAndDisplayUserSettings();

            // Restore button state
            setButtonLoading(preferencesSaveBtn, false, 'Save Preferences');

            // Close modal
            modal.classList.add('hidden');

            // Remove event listeners
            preferencesChangeTrustBtn.removeEventListener('click', handleChangeTrustClick);
            preferencesSelectTrustBtn.removeEventListener('click', handleSelectTrustClick);
            preferencesClearTrustBtn.removeEventListener('click', handleClearTrustClick);
            preferencesNationalBtn.removeEventListener('click', handleNationalClick);
            preferencesLocalBtn.removeEventListener('click', handleLocalClick);
            preferencesBothBtn.removeEventListener('click', handleBothClick);
            preferencesSaveBtn.removeEventListener('click', handleSaveClick);
            closeBtn.removeEventListener('click', handleCloseClick);
            if (useRAGSearchInput) useRAGSearchInput.removeEventListener('change', handleRagToggleChange);

            alert('Preferences saved successfully!');
        } catch (error) {
            console.error('[ERROR] Failed to save preferences:', error);
            // Restore button state on error
            setButtonLoading(preferencesSaveBtn, false, 'Save Preferences');
            alert('Failed to save preferences. Please try again.');
        }
    };

    // Parallel Analysis Preference
    const enableParallelAnalysisInput = document.getElementById('enableParallelAnalysis');
    if (enableParallelAnalysisInput) {
        enableParallelAnalysisInput.checked = loadParallelAnalysisPreference();
    }

    // Override handleSaveClick to include our new preference
    // Note: We are redefining the function here, but we need to make sure the event listener uses THIS version.
    // However, since handleSaveClick is const, we can't redefine it. We need to inject our logic into the existing function body or wrap it.
    // The previous attempt failed because I tried to replace the whole function but missed the context.

    // Better approach: Since we are inside showPreferencesModal, we can add a specific listener for our new input or modify the save handler.
    // But modifying the save handler is tricky with find-replace.
    // Let's TRY effectively replacing the START of handleSaveClick to inject our saving logic.

    const originalHandleSaveClick = handleSaveClick;
    const newHandleSaveClick = async () => {
        // Save Parallel Analysis Preference
        if (enableParallelAnalysisInput) {
            saveParallelAnalysisPreference(enableParallelAnalysisInput.checked);
        }
        await originalHandleSaveClick();
    };

    // Re-bind the save button
    preferencesSaveBtn.removeEventListener('click', handleSaveClick);
    preferencesSaveBtn.addEventListener('click', newHandleSaveClick);


    const handleCloseClick = () => {
        console.log('[DEBUG] Close preferences modal clicked');
        modal.classList.add('hidden');

        // Remove event listeners
        preferencesChangeTrustBtn.removeEventListener('click', handleChangeTrustClick);
        preferencesSelectTrustBtn.removeEventListener('click', handleSelectTrustClick);
        preferencesClearTrustBtn.removeEventListener('click', handleClearTrustClick);
        preferencesNationalBtn.removeEventListener('click', handleNationalClick);
        preferencesLocalBtn.removeEventListener('click', handleLocalClick);
        preferencesBothBtn.removeEventListener('click', handleBothClick);
        preferencesSaveBtn.removeEventListener('click', handleSaveClick);
        closeBtn.removeEventListener('click', handleCloseClick);
        if (useRAGSearchInput) useRAGSearchInput.removeEventListener('change', handleRagToggleChange);
    };

    // Add event listeners
    preferencesChangeTrustBtn.addEventListener('click', handleChangeTrustClick);
    preferencesSelectTrustBtn.addEventListener('click', handleSelectTrustClick);
    preferencesClearTrustBtn.addEventListener('click', handleClearTrustClick);
    preferencesNationalBtn.addEventListener('click', handleNationalClick);
    preferencesLocalBtn.addEventListener('click', handleLocalClick);
    preferencesBothBtn.addEventListener('click', handleBothClick);
    preferencesSaveBtn.addEventListener('click', handleSaveClick);
    closeBtn.addEventListener('click', handleCloseClick);
}

// Parallel Analysis Preference Functions
function loadParallelAnalysisPreference() {
    try {
        const pref = localStorage.getItem('clerky_parallel_analysis');
        return pref === 'true';
    } catch (e) {
        console.error('Error loading parallel analysis preference:', e);
        return false;
    }
}

function saveParallelAnalysisPreference(enabled) {
    try {
        localStorage.setItem('clerky_parallel_analysis', enabled);
        console.log(`[PREF] Saved Parallel Analysis preference: ${enabled}`);
    } catch (e) {
        console.error('Error saving parallel analysis preference:', e);
    }
}

// Guideline Scope Selection Modal Functions
let guidelineScopeResolve = null; // Promise resolver for scope selection

// Save guideline scope selection to Firestore
async function saveGuidelineScopeSelection(scopeSelection) {
    try {
        const user = auth.currentUser;
        if (!user) {
            console.warn('[DEBUG] Cannot save guideline scope, user not authenticated');
            return false;
        }

        const token = await user.getIdToken();
        const response = await fetch(`${window.SERVER_URL}/updateUserGuidelineScope`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ guidelineScope: scopeSelection })
        });

        const result = await response.json();
        if (result.success) {
            console.log('[DEBUG] Saved guideline scope selection to Firestore:', scopeSelection);
            return true;
        } else {
            console.error('[ERROR] Failed to save guideline scope selection:', result.error);
            return false;
        }
    } catch (error) {
        console.error('[ERROR] Failed to save guideline scope selection:', error);
        return false;
    }
}

// Load guideline scope selection from Firestore
async function loadGuidelineScopeSelection() {
    try {
        const user = auth.currentUser;
        if (!user) {
            console.warn('[DEBUG] Cannot load guideline scope, user not authenticated');
            return null;
        }

        const token = await user.getIdToken();
        const response = await fetch(`${window.SERVER_URL}/getUserGuidelineScope`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        const result = await response.json();
        if (result.success && result.guidelineScope) {
            console.log('[DEBUG] Loaded guideline scope selection from Firestore:', result.guidelineScope);
            // Include the short trust name from the server response
            if (result.shortTrustName) {
                result.guidelineScope.shortTrustName = result.shortTrustName;
            }
            return result.guidelineScope;
        } else {
            console.log('[DEBUG] No guideline scope preference found');
            return null;
        }
    } catch (error) {
        console.error('[ERROR] Failed to load guideline scope selection:', error);
        return null;
    }
}

// Detect if user input is a question or a clinical note using LLM via server
async function detectInputType(text) {
    if (!text || text.trim().length === 0) {
        return false; // Empty text defaults to clinical note
    }

    try {
        const user = auth.currentUser;
        if (!user) {
            console.warn('[DEBUG] Cannot detect input type, user not authenticated');
            return false; // Default to clinical note
        }

        const token = await user.getIdToken();
        const response = await fetch(`${window.SERVER_URL}/detectInputType`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ text: text.trim() })
        });

        const result = await response.json();
        if (result.success && result.isQuestion !== undefined) {
            console.log('[DEBUG] Input type detected:', result.type, result.isQuestion);
            return result.isQuestion;
        } else {
            console.error('[ERROR] Failed to detect input type:', result.error);
            // Default to clinical note on error
            return false;
        }
    } catch (error) {
        console.error('[ERROR] Error detecting input type:', error);
        // Default to clinical note on error
        return false;
    }
}

// Load and display user preferences in the main preferences panel
async function loadAndDisplayUserPreferences() {
    const trustDisplay = document.getElementById('mainTrustDisplay');
    const scopeDisplay = document.getElementById('mainScopeDisplay');
    const modelDisplay = document.getElementById('mainModelDisplay');

    if (!trustDisplay || !scopeDisplay || !modelDisplay) {
        console.warn('[DEBUG] Main preferences display elements not found');
        return;
    }

    // Load hospital trust
    try {
        const user = auth.currentUser;
        if (user) {
            const idToken = await user.getIdToken();
            const response = await fetch(`${window.SERVER_URL}/getUserHospitalTrust`, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${idToken}`
                }
            });

            const result = await response.json();
            if (result.success && result.hospitalTrust) {
                // Use the short name from the database if available, otherwise fall back to client-side abbreviation
                trustDisplay.textContent = result.shortName || abbreviateHospitalTrust(result.hospitalTrust);
            } else {
                trustDisplay.textContent = 'Not set';
            }
        } else {
            trustDisplay.textContent = 'Not set';
        }
    } catch (error) {
        console.error('[ERROR] Failed to load hospital trust:', error);
        trustDisplay.textContent = 'Error loading';
    }

    // Load guideline scope preference
    try {
        const savedScope = await loadGuidelineScopeSelection();
        if (savedScope) {
            let scopeText = '';
            // Use short name from database if available, otherwise fall back to client-side abbreviation
            const trustAbbrev = savedScope.shortTrustName || (savedScope.hospitalTrust ? abbreviateHospitalTrust(savedScope.hospitalTrust) : '');
            if (savedScope.scope === 'national') {
                scopeText = 'National';
            } else if (savedScope.scope === 'local') {
                scopeText = trustAbbrev || 'Local';
            } else if (savedScope.scope === 'both') {
                scopeText = trustAbbrev ? `National + ${trustAbbrev}` : 'National + Local';
            }
            scopeDisplay.textContent = scopeText;
        } else {
            scopeDisplay.textContent = 'Not set';
        }
    } catch (error) {
        console.error('[ERROR] Failed to load guideline scope:', error);
        scopeDisplay.textContent = 'Error loading';
    }

    // Load and display current preferred AI model
    try {
        const modelOrder = await fetchUserModelPreferences();
        if (modelOrder && modelOrder.length > 0) {
            const firstModelId = modelOrder[0];
            const model = AVAILABLE_MODELS.find(m => m.model === firstModelId);
            if (model) {
                modelDisplay.textContent = model.displayName;
            } else {
                modelDisplay.textContent = firstModelId;
            }
        } else {
            // Default to first model in AVAILABLE_MODELS
            modelDisplay.textContent = AVAILABLE_MODELS[0].displayName;
        }
    } catch (error) {
        console.error('[ERROR] Failed to load model preferences:', error);
        modelDisplay.textContent = 'Error loading';
    }

    // Setup inline editing handlers for main panel
    setupMainPreferencesEditing();
}

// Setup click handlers for main preferences panel values
function setupMainPreferencesEditing() {
    const trustDisplay = document.getElementById('mainTrustDisplay');
    const scopeDisplay = document.getElementById('mainScopeDisplay');
    const modelDisplay = document.getElementById('mainModelDisplay');

    // Helper to open preferences modal
    const openPreferences = async () => {
        console.log('[DEBUG] Preference value clicked - opening preferences modal');
        await showPreferencesModal();
        // Reload preferences after modal closes to update display
        await loadAndDisplayUserPreferences();
    };

    // Make preference values clickable to open preferences modal
    if (trustDisplay) {
        trustDisplay.addEventListener('click', openPreferences);
        trustDisplay.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                openPreferences();
            }
        });
    }

    if (scopeDisplay) {
        scopeDisplay.addEventListener('click', openPreferences);
        scopeDisplay.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                openPreferences();
            }
        });
    }

    if (modelDisplay) {
        modelDisplay.addEventListener('click', openPreferences);
        modelDisplay.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                openPreferences();
            }
        });
    }
}

// Load and display user settings on mode selection page
async function loadAndDisplayUserSettings() {
    const trustDisplay = document.getElementById('settingsTrustDisplay');
    const scopeDisplay = document.getElementById('settingsScopeDisplay');

    if (!trustDisplay || !scopeDisplay) {
        console.warn('[DEBUG] Settings display elements not found');
        return;
    }

    // Load hospital trust
    try {
        const user = auth.currentUser;
        if (user) {
            const idToken = await user.getIdToken();
            const response = await fetch(`${window.SERVER_URL}/getUserHospitalTrust`, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${idToken}`
                }
            });

            const result = await response.json();
            if (result.success && result.hospitalTrust) {
                trustDisplay.textContent = abbreviateHospitalTrust(result.hospitalTrust);
            } else {
                trustDisplay.textContent = 'Not set';
            }
        } else {
            trustDisplay.textContent = 'Not set';
        }
    } catch (error) {
        console.error('[ERROR] Failed to load hospital trust:', error);
        trustDisplay.textContent = 'Error loading';
    }

    // Load guideline scope preference
    try {
        const savedScope = await loadGuidelineScopeSelection();
        if (savedScope) {
            let scopeText = '';
            // Use short name from database if available, otherwise use full trust name
            const trustName = savedScope.shortTrustName || savedScope.hospitalTrust || 'Trust';
            if (savedScope.scope === 'national') {
                scopeText = 'National Guidelines';
            } else if (savedScope.scope === 'local') {
                scopeText = `Local Guidelines (${trustName})`;
            } else if (savedScope.scope === 'both') {
                scopeText = `Both (National + ${trustName})`;
            }
            scopeDisplay.textContent = scopeText;
        } else {
            scopeDisplay.textContent = 'Not set';
        }
    } catch (error) {
        console.error('[ERROR] Failed to load guideline scope:', error);
        scopeDisplay.textContent = 'Error loading';
    }

    // Setup inline editing handlers
    setupInlineEditing();
}

// Setup inline editing functionality for settings
function setupInlineEditing() {
    const editTrustBtn = document.getElementById('editTrustBtn');
    const editScopeBtn = document.getElementById('editScopeBtn');
    const openTrustModalBtn = document.getElementById('openTrustModalBtn');
    const cancelTrustEditBtn = document.getElementById('cancelTrustEditBtn');
    const cancelScopeEditBtn = document.getElementById('cancelScopeEditBtn');
    const scopeNationalBtn = document.getElementById('scopeNationalBtn');
    const scopeLocalBtn = document.getElementById('scopeLocalBtn');
    const scopeBothBtn = document.getElementById('scopeBothBtn');
    const trustEditMode = document.getElementById('trustEditMode');
    const scopeEditMode = document.getElementById('scopeEditMode');
    const trustSettingItem = document.getElementById('trustSettingItem');
    const scopeSettingItem = document.getElementById('scopeSettingItem');

    // Trust editing
    if (editTrustBtn && openTrustModalBtn && cancelTrustEditBtn && trustEditMode) {
        editTrustBtn.addEventListener('click', () => {
            trustEditMode.classList.remove('hidden');
            editTrustBtn.style.display = 'none';
        });

        openTrustModalBtn.addEventListener('click', async () => {
            await showHospitalTrustModal();
            // Reload settings after trust selection
            await loadAndDisplayUserSettings();
            // Exit edit mode
            trustEditMode.classList.add('hidden');
            editTrustBtn.style.display = '';
        });

        cancelTrustEditBtn.addEventListener('click', () => {
            trustEditMode.classList.add('hidden');
            editTrustBtn.style.display = '';
        });
    }

    // Scope editing
    if (editScopeBtn && cancelScopeEditBtn && scopeEditMode) {
        let selectedScope = null;

        editScopeBtn.addEventListener('click', async () => {
            // Load current scope to highlight selected button
            const savedScope = await loadGuidelineScopeSelection();
            if (savedScope) {
                selectedScope = savedScope.scope;
                // Highlight the selected button
                scopeNationalBtn.classList.remove('selected');
                scopeLocalBtn.classList.remove('selected');
                scopeBothBtn.classList.remove('selected');
                if (savedScope.scope === 'national') {
                    scopeNationalBtn.classList.add('selected');
                } else if (savedScope.scope === 'local') {
                    scopeLocalBtn.classList.add('selected');
                } else if (savedScope.scope === 'both') {
                    scopeBothBtn.classList.add('selected');
                }
            }

            scopeEditMode.classList.remove('hidden');
            editScopeBtn.style.display = 'none';
        });

        const handleScopeSelection = async (scope) => {
            // Warn user if workflow is in progress
            if (window.workflowInProgress || window.sequentialProcessingActive) {
                const proceed = confirm('A workflow is currently in progress. Changing the scope now will not affect the current analysis, but will be used for future analyses. Continue?');
                if (!proceed) {
                    return;
                }
            }

            // Get current trust
            let currentTrust = null;
            try {
                const user = auth.currentUser;
                if (user) {
                    const idToken = await user.getIdToken();
                    const response = await fetch(`${window.SERVER_URL}/getUserHospitalTrust`, {
                        method: 'GET',
                        headers: {
                            'Authorization': `Bearer ${idToken}`
                        }
                    });
                    const result = await response.json();
                    if (result.success && result.hospitalTrust) {
                        currentTrust = result.hospitalTrust;
                    }
                }
            } catch (error) {
                console.error('[ERROR] Failed to load hospital trust:', error);
            }

            // Check if trust is required
            if ((scope === 'local' || scope === 'both') && !currentTrust) {
                alert('Please select a hospital trust first.');
                return;
            }

            selectedScope = scope;

            // Update button states
            scopeNationalBtn.classList.remove('selected');
            scopeLocalBtn.classList.remove('selected');
            scopeBothBtn.classList.remove('selected');

            if (scope === 'national') {
                scopeNationalBtn.classList.add('selected');
            } else if (scope === 'local') {
                scopeLocalBtn.classList.add('selected');
            } else if (scope === 'both') {
                scopeBothBtn.classList.add('selected');
            }

            // Save immediately
            const scopeSelection = {
                scope: scope,
                hospitalTrust: (scope === 'local' || scope === 'both') ? currentTrust : null
            };

            const success = await saveGuidelineScopeSelection(scopeSelection);
            if (success) {
                // Update display
                let scopeText = '';
                if (scope === 'national') {
                    scopeText = 'National Guidelines';
                } else if (scope === 'local') {
                    scopeText = `Local Guidelines (${currentTrust})`;
                } else if (scope === 'both') {
                    scopeText = `Both (National + ${currentTrust})`;
                }
                document.getElementById('settingsScopeDisplay').textContent = scopeText;

                // Exit edit mode
                scopeEditMode.classList.add('hidden');
                editScopeBtn.style.display = '';

                console.log('[DEBUG] Scope selection updated (workflow will not restart):', scopeSelection);
            } else {
                alert('Failed to save guideline scope preference. Please try again.');
            }
        };

        if (scopeNationalBtn) {
            scopeNationalBtn.addEventListener('click', () => handleScopeSelection('national'));
        }

        if (scopeLocalBtn) {
            scopeLocalBtn.addEventListener('click', () => handleScopeSelection('local'));
        }

        if (scopeBothBtn) {
            scopeBothBtn.addEventListener('click', () => handleScopeSelection('both'));
        }

        cancelScopeEditBtn.addEventListener('click', () => {
            scopeEditMode.classList.add('hidden');
            editScopeBtn.style.display = '';
        });
    }
}

// Show mode selection page
async function showModeSelectionPage() {
    const modeSelectionPage = document.getElementById('modeSelectionPage');
    const landingPage = document.getElementById('landingPage');
    const mainContent = document.getElementById('mainContent');

    if (!modeSelectionPage) {
        console.error('[ERROR] Mode selection page element not found');
        return;
    }

    // Hide other views
    if (landingPage) landingPage.classList.add('hidden');
    if (mainContent) mainContent.classList.add('hidden');

    // Show mode selection page
    modeSelectionPage.classList.remove('hidden');

    // Load and display user settings
    await loadAndDisplayUserSettings();

    console.log('[DEBUG] Mode selection page shown');
}

// Clear saved guideline scope selection
async function clearGuidelineScopeSelection() {
    try {
        const user = auth.currentUser;
        if (!user) {
            console.warn('[DEBUG] Cannot clear guideline scope, user not authenticated');
            return false;
        }

        const token = await user.getIdToken();
        const response = await fetch(`${window.SERVER_URL}/updateUserGuidelineScope`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ guidelineScope: null })
        });

        const result = await response.json();
        if (result.success) {
            console.log('[DEBUG] Cleared guideline scope selection from Firestore');
            return true;
        } else {
            console.error('[ERROR] Failed to clear guideline scope selection:', result.error);
            return false;
        }
    } catch (error) {
        console.error('[ERROR] Failed to clear guideline scope selection:', error);
        return false;
    }
}

async function showGuidelineScopeModal() {
    console.log('[DEBUG] Showing guideline scope modal');

    const modal = document.getElementById('guidelineScopeModal');
    const scopeTrustDisplay = document.getElementById('scopeTrustDisplay');
    const applyNationalBtn = document.getElementById('applyNationalBtn');
    const applyLocalBtn = document.getElementById('applyLocalBtn');
    const applyBothBtn = document.getElementById('applyBothBtn');
    const changeTrustBtn = document.getElementById('changeTrustBtn');
    const selectTrustBtn = document.getElementById('selectTrustBtn');
    const closeBtn = document.getElementById('closeGuidelineScopeModal');

    if (!modal) {
        console.error('[ERROR] Guideline scope modal not found');
        return Promise.reject(new Error('Modal not found'));
    }

    // Show modal
    modal.classList.remove('hidden');

    // Load current trust selection
    let userHospitalTrust = null;
    try {
        const response = await fetch(`${window.SERVER_URL}/getUserHospitalTrust`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${await auth.currentUser.getIdToken()}`
            }
        });

        const result = await response.json();
        if (result.success && result.hospitalTrust) {
            userHospitalTrust = result.hospitalTrust;
            scopeTrustDisplay.textContent = userHospitalTrust;

            // Show "Change Trust" button, hide "Select Trust" button
            changeTrustBtn.classList.remove('hidden');
            selectTrustBtn.classList.add('hidden');

            // Enable all buttons
            applyNationalBtn.disabled = false;
            applyLocalBtn.disabled = false;
            applyBothBtn.disabled = false;
        } else {
            scopeTrustDisplay.textContent = 'None selected';

            // Show "Select Trust" button, hide "Change Trust" button
            changeTrustBtn.classList.add('hidden');
            selectTrustBtn.classList.remove('hidden');

            // Enable national button, disable local and both buttons
            applyNationalBtn.disabled = false;
            applyLocalBtn.disabled = true;
            applyBothBtn.disabled = true;
        }
    } catch (error) {
        console.error('[ERROR] Failed to load current hospital trust:', error);
        scopeTrustDisplay.textContent = 'Error loading selection';

        // Show "Select Trust" button, hide "Change Trust" button
        changeTrustBtn.classList.add('hidden');
        selectTrustBtn.classList.remove('hidden');

        // Enable national button, disable local and both buttons
        applyNationalBtn.disabled = false;
        applyLocalBtn.disabled = true;
        applyBothBtn.disabled = true;
    }

    // Return a promise that resolves when user selects a scope
    return new Promise((resolve, reject) => {
        guidelineScopeResolve = resolve;

        // Set up button click handlers
        const handleNationalClick = async () => {
            console.log('[DEBUG] User selected: National guidelines');
            const selection = { scope: 'national', hospitalTrust: userHospitalTrust };
            await saveGuidelineScopeSelection(selection);
            cleanup();
            resolve(selection);
        };

        const handleLocalClick = async () => {
            console.log('[DEBUG] User selected: Local guidelines');
            const selection = { scope: 'local', hospitalTrust: userHospitalTrust };
            await saveGuidelineScopeSelection(selection);
            cleanup();
            resolve(selection);
        };

        const handleBothClick = async () => {
            console.log('[DEBUG] User selected: Both guidelines');
            const selection = { scope: 'both', hospitalTrust: userHospitalTrust };
            await saveGuidelineScopeSelection(selection);
            cleanup();
            resolve(selection);
        };

        const handleChangeTrustClick = async () => {
            console.log('[DEBUG] User clicked: Change Trust');
            await showHospitalTrustModal();
            // After trust selection, refresh the modal
            cleanup();
            const newSelection = await showGuidelineScopeModal();
            resolve(newSelection);
        };

        const handleSelectTrustClick = async () => {
            console.log('[DEBUG] User clicked: Select Trust');
            await showHospitalTrustModal();
            // After trust selection, refresh the modal
            cleanup();
            const newSelection = await showGuidelineScopeModal();
            resolve(newSelection);
        };

        const handleCloseClick = () => {
            console.log('[DEBUG] User closed modal');
            cleanup();
            reject(new Error('User cancelled scope selection'));
        };

        const cleanup = () => {
            modal.classList.add('hidden');
            applyNationalBtn.removeEventListener('click', handleNationalClick);
            applyLocalBtn.removeEventListener('click', handleLocalClick);
            applyBothBtn.removeEventListener('click', handleBothClick);
            changeTrustBtn.removeEventListener('click', handleChangeTrustClick);
            selectTrustBtn.removeEventListener('click', handleSelectTrustClick);
            closeBtn.removeEventListener('click', handleCloseClick);
        };

        // Add event listeners
        applyNationalBtn.addEventListener('click', handleNationalClick);
        applyLocalBtn.addEventListener('click', handleLocalClick);
        applyBothBtn.addEventListener('click', handleBothClick);
        changeTrustBtn.addEventListener('click', handleChangeTrustClick);
        selectTrustBtn.addEventListener('click', handleSelectTrustClick);
        closeBtn.addEventListener('click', handleCloseClick);
    });
}

// Filter guidelines by scope
function filterGuidelinesByScope(guidelines, scope, hospitalTrust) {
    console.log('[DEBUG] Filtering guidelines by scope:', { scope, hospitalTrust, totalGuidelines: guidelines.length });

    if (!guidelines || guidelines.length === 0) {
        console.log('[DEBUG] No guidelines to filter');
        return [];
    }

    let filtered = [];

    if (scope === 'national') {
        // Only national guidelines
        filtered = guidelines.filter(g => {
            const guidelineScope = g.scope || 'national';
            return guidelineScope === 'national';
        });
        console.log('[DEBUG] Filtered to national guidelines:', filtered.length);
    } else if (scope === 'local') {
        // Only local guidelines for the user's trust
        if (!hospitalTrust) {
            console.log('[DEBUG] No hospital trust selected, cannot filter local guidelines');
            return [];
        }
        filtered = guidelines.filter(g => {
            const guidelineScope = g.scope || 'national';
            return guidelineScope === 'local' && g.hospitalTrust === hospitalTrust;
        });
        console.log('[DEBUG] Filtered to local guidelines for', hospitalTrust, ':', filtered.length);
    } else if (scope === 'both') {
        // National guidelines + local guidelines for user's trust
        filtered = guidelines.filter(g => {
            const guidelineScope = g.scope || 'national';
            if (guidelineScope === 'national') {
                return true;
            }
            if (guidelineScope === 'local' && hospitalTrust && g.hospitalTrust === hospitalTrust) {
                return true;
            }
            return false;
        });
        console.log('[DEBUG] Filtered to both guidelines:', filtered.length);
    } else {
        // Default: return all
        filtered = guidelines;
        console.log('[DEBUG] No scope filtering applied, returning all guidelines');
    }

    return filtered;
}

// Store selected scope globally
window.selectedGuidelineScope = null;

// Show clinical issues dropdown as a block within summary1 (and use bottom bar buttons)
async function showClinicalIssuesDropdown() {
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

        // Always render a single Test panel instance (avoid stacking multiple panels off-screen)
        const panelHtml = `
<div id=\"clinicalIssuesPanel\" class=\"clinical-issues-selector\">
    <h3>⚡ Load Clinical Clerking</h3>
    <p>Select a clinical issue to instantly load a realistic pre-generated clinical clerking using SBAR format:</p>
    
    <div class=\"issue-category\">
        <h4>Clinical Issues</h4>
        <select id=\"clinical-issues-dropdown\" class=\"clinical-dropdown\">
            <option value=\"\">Select a clinical issue...</option>
        </select>
    </div>
    
    <div id=\"generation-status\" class=\"generation-status\" style=\"display: none;\"></div>
</div>`;

        // Replace existing summary content so the Test panel is always visible
        appendToSummary1(panelHtml, true, false);

        // Ensure the clinical issues panel exists inside summary1
        const clinicalPanel = document.getElementById('clinicalIssuesPanel');

        const clinicalDropdown = document.getElementById('clinical-issues-dropdown');
        const generateBtn = document.getElementById('generate-interaction-btn');
        const randomBtn = document.getElementById('random-issue-btn');
        const regenerateBtn = document.getElementById('regenerate-clerking-btn');
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
        clinicalDropdown.innerHTML = '<option value=\"\">Select a clinical issue...</option>';

        // Add options from Firebase data
        // Note: we intentionally exclude gynaecology from the "Test" dropdown.
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

        // Ensure summary visibility and scroll/focus the Test panel so it’s obvious
        updateSummaryVisibility();
        updateSummaryCriticalStatus();
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

            if (generateBtn) {
                generateBtn.disabled = !hasSelection;
            }
            if (regenerateBtn) {
                regenerateBtn.disabled = !hasSelection;
            }
        }

        if (clinicalDropdown) {
            clinicalDropdown.addEventListener('change', updateGenerateButton);
        }

        // Helper to completely clean up the test UI
        function hideClinicalIssuesPanel() {
            const panel = document.getElementById('clinicalIssuesPanel');
            if (panel && panel.parentNode) {
                panel.parentNode.removeChild(panel);
            }

            const buttonsGroup = document.getElementById('clerkingButtonsGroup');
            if (buttonsGroup) {
                buttonsGroup.style.display = 'none';
            }

            updateSummaryVisibility();
        }

        if (generateBtn) {
            generateBtn.onclick = async () => {
                const selectedIssue = clinicalDropdown?.value || '';

                if (selectedIssue) {
                    await generateFakeClinicalInteraction(selectedIssue);
                    // After loading clerking, remove the test UI
                    hideClinicalIssuesPanel();
                }
            };
        }

        if (randomBtn) {
            randomBtn.onclick = async () => {
                if (!clinicalDropdown) return;

                // Get all available options from the dropdown (excluding the default option)
                const options = Array.from(clinicalDropdown.options).filter(option =>
                    option.value && option.value.trim() !== ''
                );

                if (options.length > 0) {
                    // Pick a random option
                    const randomOption = options[Math.floor(Math.random() * options.length)];
                    const randomIssue = randomOption.value;

                    // Set the dropdown to the random selection
                    clinicalDropdown.value = randomIssue;

                    // Update the generate button state
                    updateGenerateButton();

                    // Automatically generate the interaction
                    await generateFakeClinicalInteraction(randomIssue);

                    // After loading clerking, remove the test UI
                    hideClinicalIssuesPanel();
                } else {
                    console.error('No clinical issues available for random selection');
                    updateUser('Error: No clinical issues available for random selection.', false);
                }
            };
        }

        if (regenerateBtn) {
            regenerateBtn.onclick = async () => {
                const selectedIssue = clinicalDropdown?.value || '';

                if (selectedIssue) {
                    // Force regeneration of the transcript
                    await generateFakeClinicalInteraction(selectedIssue, true);
                    // After regeneration, remove the test UI for consistency
                    hideClinicalIssuesPanel();
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
        updateUser(`Error loading clinical issues: ${error.message}. Please try again or contact support.`, false);
    }
}

// Generate fake clinical interaction based on selected issue
async function generateFakeClinicalInteraction(selectedIssue, forceRegenerate = false) {
    console.log('[DEBUG] generateFakeClinicalInteraction called with:', selectedIssue, 'forceRegenerate:', forceRegenerate);

    const generateBtn = document.getElementById('generate-interaction-btn');
    const regenerateBtn = document.getElementById('regenerate-clerking-btn');
    const generateSpinner = document.getElementById('generate-spinner');
    const regenerateSpinner = document.getElementById('regenerate-spinner');
    const generateText = document.getElementById('generate-text');
    const regenerateText = document.getElementById('regenerate-text');
    const statusDiv = document.getElementById('generation-status');

    try {
        // Update UI to show loading state
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

        // Find the condition in our cached data
        const condition = ClinicalConditionsService.findCondition(selectedIssue);

        if (!condition) {
            throw new Error(`Clinical condition not found: ${selectedIssue}`);
        }

        console.log('[DEBUG] Found condition:', {
            id: condition.id,
            name: condition.name,
            category: condition.category,
            hasTranscript: condition.hasTranscript
        });

        let transcript = null;
        let isGenerated = false;

        // Check if we have a cached transcript and not forcing regeneration
        if (condition.hasTranscript && condition.transcript && !forceRegenerate) {
            transcript = condition.transcript;
            console.log('[DEBUG] Using cached transcript:', {
                transcriptLength: transcript.length,
                lastGenerated: condition.lastGenerated
            });
        } else {
            // Generate new transcript using Firebase service
            const action = forceRegenerate ? 'Regenerating' : 'Generating new';
            console.log(`[DEBUG] ${action} transcript...`);
            if (statusDiv) {
                statusDiv.innerHTML = `<p>🔄 ${action} clinical interaction for: <strong>${selectedIssue}</strong></p>`;
            }

            const result = await ClinicalConditionsService.generateTranscript(condition.id, forceRegenerate);

            console.log('[DEBUG] ClinicalConditionsService.generateTranscript returned:', {
                resultExists: !!result,
                resultKeys: result ? Object.keys(result) : 'no result',
                success: result?.success,
                hasTranscript: !!result?.transcript,
                transcriptLength: result?.transcript?.length,
                cached: result?.cached,
                generated: result?.generated,
                transcriptPreview: result?.transcript ? result.transcript.substring(0, 200) + '...' : 'NO TRANSCRIPT',
                fullResult: result
            });

            transcript = result.transcript;
            isGenerated = !result.cached;

            console.log('[DEBUG] Generated transcript result - processed:', {
                transcriptAssigned: !!transcript,
                transcriptLength: transcript?.length,
                isGenerated: isGenerated,
                transcriptType: typeof transcript,
                transcriptPreview: transcript ? transcript.substring(0, 100) + '...' : 'NO TRANSCRIPT'
            });
        }

        if (!transcript) {
            throw new Error(`Failed to get transcript for clinical issue: ${selectedIssue}`);
        }

        // Update status
        if (statusDiv) {
            const statusText = isGenerated ? 'Generated new' : 'Loaded cached';
            statusDiv.innerHTML = `<p>✅ ${statusText} clinical interaction for: <strong>${selectedIssue}</strong></p>`;
        }

        // Put the transcript in the user input textarea
        const userInput = document.getElementById('userInput');
        console.log('[DEBUG] userInput element check:', {
            elementFound: !!userInput,
            elementId: userInput?.id,
            elementType: userInput?.tagName,
            hasTranscript: !!transcript,
            currentValue: userInput?.value?.length || 0
        });

        if (transcript) {
            setUserInputContent(transcript, true, 'Fake Clinical Interaction');
            console.log('[DEBUG] Transcript added to user input textarea:', {
                transcriptLength: transcript.length,
                preview: transcript.substring(0, 100) + '...'
            });

            // Explicitly update button visibility after programmatic content update
            setTimeout(() => {
                updateChatbotButtonVisibility();
            }, 200);
        } else {
            console.error('[DEBUG] Failed to add transcript to userInput:', {
                hasTranscript: !!transcript,
                transcriptType: typeof transcript
            });
        }

        // Show success message via status bar instead of summary1
        const performanceText = forceRegenerate
            ? 'regenerated with updated formatting'
            : (isGenerated ? 'generated using AI' : 'loaded instantly from cache');
        const actionText = forceRegenerate ? 'Regenerated' : 'Loaded';
        const successMessage = `${actionText} clinical interaction for ${selectedIssue} (${condition.category}); ` +
            `transcript length ~${Math.round(transcript.split(' ').length)} words, ${performanceText}.`;
        updateUser(successMessage, false);

    } catch (error) {
        console.error('[DEBUG] Error loading fake clinical interaction:', {
            error: error.message,
            stack: error.stack,
            selectedIssue
        });

        // Update UI to show error
        if (statusDiv) {
            statusDiv.innerHTML = `<p>❌ Error: ${error.message}</p>`;
        }

        // Surface error via status bar instead of summary1
        const errorMessage = `Error loading clinical interaction for ${selectedIssue}: ${error.message}`;
        updateUser(errorMessage, false);

    } finally {
        // Reset button states
        if (generateBtn) generateBtn.disabled = false;
        if (regenerateBtn) regenerateBtn.disabled = false;
        if (generateSpinner) generateSpinner.style.display = 'none';
        if (regenerateSpinner) regenerateSpinner.style.display = 'none';
        if (generateText) generateText.textContent = 'Load Clerking';
        if (regenerateText) regenerateText.textContent = 'Regenerate Clerking';

        console.log('[DEBUG] generateFakeClinicalInteraction cleanup completed');
    }
}

// Comprehensive workflow processing function
async function processWorkflow() {
    console.log('[DEBUG] processWorkflow started');

    // Prevent multiple simultaneous workflow executions
    if (window.workflowInProgress) {
        console.log('[DEBUG] processWorkflow: Already in progress, ignoring duplicate call');
        return;
    }

    // Prevent workflow restart if we're already processing guidelines
    if (window.sequentialProcessingActive) {
        console.log('[DEBUG] processWorkflow: Guidelines are being processed, ignoring workflow restart');
        return;
    }

    // Set flag to prevent duplicate executions
    window.workflowInProgress = true;

    const analyseBtn = document.getElementById('analyseBtn');
    const analyseSpinner = document.getElementById('analyseSpinner');

    // Check for abort signal
    if (window.analysisAbortController?.signal.aborted) {
        console.log('[DEBUG] processWorkflow: Already aborted');
        window.workflowInProgress = false;
        return;
    }

    try {
        // Check if we have transcript content
        const transcript = getUserInputContent();
        if (!transcript) {
            alert('Please enter some text first');
            return;
        }

        // Button state is already set by the click handler

        // Use status bar for progress; avoid popping summary1 open during workflow
        updateUser('Starting complete workflow processing...', true);

        // Show a visible progress indicator in summary1 to keep user informed
        // Removed per user request to save vertical space
        // appendToSummary1(..., true);

        // Step 1: Select Guideline Scope (check for persisted selection first)
        console.log('[DEBUG] processWorkflow: Step 1 - Check for persisted guideline scope selection');
        updateAnalyseButtonProgress('Checking Guidelines Scope...', true);
        updateUser('Checking guideline scope...', true);

        let scopeSelection;

        // Check if we have a persisted selection
        const savedScopeSelection = await loadGuidelineScopeSelection();

        if (savedScopeSelection) {
            // Verify the saved selection is still valid (check if trust still exists if local/both)
            if (savedScopeSelection.scope === 'local' || savedScopeSelection.scope === 'both') {
                // Need to verify the hospital trust is still valid
                try {
                    updateUser('Verifying hospital trust...', true);
                    const response = await fetch(`${window.SERVER_URL}/getUserHospitalTrust`, {
                        method: 'GET',
                        headers: {
                            'Authorization': `Bearer ${await auth.currentUser.getIdToken()}`
                        }
                    });
                    const result = await response.json();
                    if (result.success && result.hospitalTrust) {
                        // Trust exists, use saved selection (but update trust name in case it changed)
                        scopeSelection = {
                            scope: savedScopeSelection.scope,
                            hospitalTrust: result.hospitalTrust
                        };
                        console.log('[DEBUG] processWorkflow: Using persisted scope selection:', scopeSelection);
                    } else {
                        // Trust no longer exists, need to reselect
                        console.log('[DEBUG] processWorkflow: Saved selection invalid (no trust), showing modal');
                        scopeSelection = await showGuidelineScopeModal();
                    }
                } catch (error) {
                    console.error('[ERROR] Failed to verify hospital trust, showing modal:', error);
                    scopeSelection = await showGuidelineScopeModal();
                }
            } else {
                // National scope doesn't need trust verification
                scopeSelection = savedScopeSelection;
                console.log('[DEBUG] processWorkflow: Using persisted scope selection:', scopeSelection);
            }
        } else {
            // No saved selection, show modal
            console.log('[DEBUG] processWorkflow: No persisted selection, showing guideline scope selection modal');
            updateUser('Step 1: Select which guidelines to apply...', true);

            try {
                scopeSelection = await showGuidelineScopeModal();
                console.log('[DEBUG] processWorkflow: User selected scope:', scopeSelection);
            } catch (error) {
                console.log('[DEBUG] processWorkflow: Scope selection cancelled:', error.message);
                updateUser('Scope selection cancelled.', false);
                return; // Exit workflow if user cancels
            }
        }

        // Store the selection globally
        window.selectedGuidelineScope = scopeSelection;

        const scopeMessage = scopeSelection.scope === 'national'
            ? 'National guidelines selected.'
            : scopeSelection.scope === 'local'
                ? `Local guidelines selected (${scopeSelection.hospitalTrust}).`
                : `Both national and ${scopeSelection.hospitalTrust} guidelines selected.`;

        updateUser(scopeMessage, false);

        console.log('[DEBUG] processWorkflow: Starting step 2 - Find Relevant Guidelines');
        updateAnalyseButtonProgress('Finding Relevant Guidelines...', true);
        updateUser('Step 2: Finding relevant guidelines...', true);

        // Check for abort before starting step 2
        if (window.analysisAbortController?.signal.aborted) {
            throw new Error('Analysis cancelled');
        }

        try {
            await findRelevantGuidelines(true, scopeSelection.scope, scopeSelection.hospitalTrust); // Pass scope parameters

            // Check for abort after step 2
            if (window.analysisAbortController?.signal.aborted) {
                throw new Error('Analysis cancelled');
            }

            console.log('[DEBUG] processWorkflow: Step 2 completed successfully');
            updateAnalyseButtonProgress('Guidelines Found', false);

            const step1Complete = 'Step 2 complete: relevant guidelines identified.';
            updateUser(step1Complete, false);

        } catch (error) {
            // Check if error is due to abort
            if (error.name === 'AbortError' || window.analysisAbortController?.signal.aborted) {
                throw new Error('Analysis cancelled');
            }
            console.error('[DEBUG] processWorkflow: Step 2 failed:', error.message);
            throw new Error(`Step 2 (Find Guidelines) failed: ${error.message}`);
        }

        // Check if we have relevant guidelines before proceeding
        console.log('[DEBUG] processWorkflow: Checking relevant guidelines:', {
            hasRelevantGuidelines: !!window.relevantGuidelines,
            guidelinesLength: window.relevantGuidelines?.length || 0,
            guidelinesArray: window.relevantGuidelines
        });

        if (!window.relevantGuidelines || window.relevantGuidelines.length === 0) {
            throw new Error('No relevant guidelines were found. Cannot proceed with analysis.');
        }

        // CHECK PARALLEL ANALYSIS PREFERENCE
        if (loadParallelAnalysisPreference()) {
            console.log('[DEBUG] processWorkflow: Parallel Analysis ENABLED - skipping selection');
            updateAnalyseButtonProgress('Processing Guidelines Concurrently...', true);

            updateUser(
                `Step 3: Processing ${window.relevantGuidelines.length} relevant guidelines concurrently...`,
                true
            );

            // Execute Parallel Analysis
            await runParallelAnalysis(window.relevantGuidelines);

            // Workflow Complete for Parallel mode
            console.log('[DEBUG] processWorkflow: Parallel workflow finished successfully');

        } else {
            // SEQUENTIAL / MANUAL SELECTION FLOW
            console.log('[DEBUG] processWorkflow: Step 2 completed - now showing guideline selection interface');
            updateAnalyseButtonProgress('Select Guidelines to Process', false);

            // Step 3: Show Guideline Selection Interface
            updateUser(
                `Step 3: Select guidelines to process – found ${window.relevantGuidelines.length} relevant guidelines.`,
                false
            );

            // The workflow now pauses here - user needs to manually select guidelines and click "Process Selected Guidelines"
            console.log('[DEBUG] processWorkflow: Workflow paused - waiting for user to select and process guidelines');
        }

        console.log('[DEBUG] processWorkflow: Complete workflow finished successfully');

    } catch (error) {
        // Check if error is due to abort
        if (error.name === 'AbortError' || error.message === 'Analysis cancelled' || window.analysisAbortController?.signal.aborted) {
            console.log('[DEBUG] processWorkflow: Analysis was cancelled');
            // Don't show error alert for user-initiated cancellation
            window.workflowInProgress = false; // Clear flag before returning
            return;
        }

        console.error('[DEBUG] processWorkflow: Workflow failed:', {
            error: error.message,
            stack: error.stack
        });

        // Display error in outputField
        const errorMessage = `\n❌ **Workflow Error:** ${error.message}\n\n` +
            `The workflow was interrupted. You can try running individual steps manually or contact support if the problem persists.\n\n`;
        appendToOutputField(errorMessage, true);

        alert(`Workflow failed: ${error.message}`);

    } finally {
        // Button state is restored by the click handler's finally block
        // Hide summary loading spinner (content has been added via appendToSummary1)
        hideSummaryLoading();

        // Clear the workflow in progress flag
        window.workflowInProgress = false;

        console.log('[DEBUG] processWorkflow: Cleanup completed');
    }
}

// --- Chat History Management ---

let saveStateTimeout = null;

// Function to generate AI summary for chat content
async function generateChatSummary(userInput) {
    if (!userInput || userInput.trim().length === 0) {
        return 'Empty chat';
    }

    // Check if user is authenticated
    if (!window.auth || !window.auth.currentUser) {
        console.warn('[CHAT_SUMMARY] User not authenticated, using fallback');
        return userInput.substring(0, 40).replace(/\n/g, ' ') + (userInput.length > 40 ? '...' : '');
    }

    try {
        const idToken = await window.auth.currentUser.getIdToken();

        // Create AbortController for timeout
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout

        const response = await fetch(`${window.SERVER_URL}/generateChatSummary`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${idToken}`
            },
            body: JSON.stringify({
                userInput: userInput.trim()
            }),
            signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const result = await response.json();
        if (result.success && result.summary) {
            return result.summary;
        } else {
            throw new Error(result.error || 'Failed to generate summary');
        }
    } catch (error) {
        console.error('[CHAT_SUMMARY] Error generating summary:', error);
        // Fallback to simple preview
        return userInput.substring(0, 40).replace(/\n/g, ' ') + (userInput.length > 40 ? '...' : '');
    }
}

// Function to format date in the requested format
function formatChatDate(timestamp) {
    const date = new Date(timestamp);
    const day = date.getDate();
    const suffix = getDaySuffix(day);
    const month = date.toLocaleDateString('en-GB', { month: 'long' });
    const year = date.getFullYear();
    const time = date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

    return `${month} ${day}${suffix} (${time})`;
}

function getDaySuffix(day) {
    if (day >= 11 && day <= 13) return 'th';
    switch (day % 10) {
        case 1: return 'st';
        case 2: return 'nd';
        case 3: return 'rd';
        default: return 'th';
    }
}

async function saveChatToFirestore(chat) {
    const user = window.auth.currentUser;
    if (!user) {
        console.warn('Cannot save chat to Firestore: user not authenticated');
        return false;
    }

    try {
        const idToken = await user.getIdToken();
        const response = await fetch(`${window.SERVER_URL}/saveChatHistory`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${idToken}`
            },
            body: JSON.stringify({
                chat: {
                    ...chat,
                    lastUpdated: new Date().toISOString(),
                    userId: user.uid
                }
            })
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const result = await response.json();
        if (result.success) {
            // Chat saved to Firestore
            return true;
        } else {
            throw new Error(result.error || 'Unknown error saving chat');
        }
    } catch (error) {
        console.error('[FIRESTORE] Error saving chat:', error);
        return false;
    }
}

// COMMENTED OUT - Chat history functionality no longer used
/*
async function loadChatHistoryFromFirestore() {
    const user = window.auth.currentUser;
    if (!user) {
        console.warn('Cannot load chat history from Firestore: user not authenticated');
        return [];
    }

    try {
        const idToken = await user.getIdToken();
        const response = await fetch(`${window.SERVER_URL}/getChatHistory`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${idToken}`
            }
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const result = await response.json();
        if (result.success) {
            const chats = result.chats || [];
            console.log(`[FIRESTORE] Loaded ${chats.length} chats from Firestore`);
            return chats;
        } else {
            throw new Error(result.error || 'Unknown error loading chat history');
        }
    } catch (error) {
        console.error('[FIRESTORE] Error loading chat history:', error);
        return [];
    }
}
*/

async function deleteChatFromFirestore(chatId) {
    const user = window.auth.currentUser;
    if (!user) {
        console.warn('Cannot delete chat from Firestore: user not authenticated');
        return false;
    }

    try {
        const idToken = await user.getIdToken();
        const response = await fetch(`${window.SERVER_URL}/deleteChatHistory`, {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${idToken}`
            },
            body: JSON.stringify({
                chatId: chatId.toString()
            })
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const result = await response.json();
        if (result.success) {
            console.log(`[FIRESTORE] Deleted chat: ${chatId}`);
            return true;
        } else {
            throw new Error(result.error || 'Unknown error deleting chat');
        }
    } catch (error) {
        console.error('[FIRESTORE] Error deleting chat:', error);
        return false;
    }
}

async function migrateChatHistoryToFirestore() {
    const user = window.auth.currentUser;
    if (!user) return;

    try {
        const savedHistory = localStorage.getItem('chatHistory');
        if (!savedHistory) return;

        const localChats = JSON.parse(savedHistory);
        console.log(`[MIGRATION] Migrating ${localChats.length} chats to Firestore...`);

        // Check if we already have chats in Firestore to avoid duplicates
        const existingChats = await loadChatHistoryFromFirestore();
        const existingChatIds = new Set(existingChats.map(chat => chat.id));

        let migratedCount = 0;
        for (const chat of localChats) {
            if (!existingChatIds.has(chat.id)) {
                const success = await saveChatToFirestore(chat);
                if (success) migratedCount++;
            }
        }

        if (migratedCount > 0) {
            console.log(`[MIGRATION] Successfully migrated ${migratedCount} chats to Firestore`);
            // Clear localStorage after successful migration
            localStorage.removeItem('chatHistory');
            console.log('[MIGRATION] Cleared localStorage chat history after migration');
        }
    } catch (error) {
        console.error('[MIGRATION] Error migrating chat history:', error);
    }
}

function debouncedSaveState() {
    if (saveStateTimeout) {
        clearTimeout(saveStateTimeout);
    }
    saveStateTimeout = setTimeout(async () => {
        try {
            await saveCurrentChatState();
        } catch (error) {
            console.error('[CHAT] Error in debounced save:', error);
        }
    }, 1500); // Save 1.5 seconds after the last change
}

function getChatState() {
    return {
        userInputContent: getUserInputContent(),
        relevantGuidelines: window.relevantGuidelines,
        latestAnalysis: window.latestAnalysis,
        currentAdviceSession: window.currentAdviceSession,
        currentSuggestions: window.currentSuggestions,
        userDecisions: window.userDecisions,
        lastUpdatedTranscript: window.lastUpdatedTranscript
    };
}

function loadChatState(state) {
    setUserInputContent(state.userInputContent || '', false);
    window.relevantGuidelines = state.relevantGuidelines || null;
    window.latestAnalysis = state.latestAnalysis || null;
    window.currentAdviceSession = state.currentAdviceSession || null;
    window.currentSuggestions = state.currentSuggestions || [];
    window.userDecisions = state.userDecisions || {};
    window.lastUpdatedTranscript = state.lastUpdatedTranscript || null;

    // Mark suggestion containers as active/inactive based on current session
    setTimeout(() => {
        markSuggestionContainersState();
    }, 100);
}

function markSuggestionContainersState() {
    const allContainers = document.querySelectorAll('.dynamic-advice-container');
    allContainers.forEach(container => {
        const sessionId = container.getAttribute('data-session-id');
        if (sessionId === window.currentAdviceSession) {
            container.classList.add('active-session');
            container.classList.remove('inactive-session');
        } else if (sessionId) {
            container.classList.remove('active-session');
            container.classList.add('inactive-session');

            // Add a visual overlay to inactive sessions
            if (!container.querySelector('.inactive-overlay')) {
                const overlay = document.createElement('div');
                overlay.className = 'inactive-overlay';
                overlay.innerHTML = `
                    <div style="background: rgba(0,0,0,0.8); color: white; padding: 10px; border-radius: 4px; text-align: center; margin: 10px;">
                        💤 <strong>Inactive Session</strong><br>
                        <small>Switch back to the original chat to interact with these suggestions</small>
                    </div>
                `;
                overlay.style.cssText = `
                    position: absolute;
                    top: 0;
                    left: 0;
                    right: 0;
                    bottom: 0;
                    background: rgba(255, 255, 255, 0.9);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    z-index: 10;
                    border-radius: 6px;
                `;
                container.style.position = 'relative';
                container.appendChild(overlay);
            }
        }
    });
}

async function saveCurrentChatState() {
    if (!currentChatId) return;

    const chatIndex = chatHistory.findIndex(chat => chat.id === currentChatId);
    if (chatIndex === -1) {
        console.warn(`Could not find chat with id ${currentChatId} to save.`);
        return;
    }

    const state = getChatState();

    // Generate summary with error handling
    let previewText = 'New chat...';
    try {
        if (state.userInputContent && state.userInputContent.trim().length > 0) {
            previewText = await generateChatSummary(state.userInputContent);
        }
    } catch (error) {
        console.error('[CHAT] Error generating chat summary:', error);
        // Fallback to simple preview
        previewText = state.userInputContent.substring(0, 40).replace(/\n/g, ' ') + (state.userInputContent.length > 40 ? '...' : '') || 'New chat...';
    }

    chatHistory[chatIndex].state = state;
    chatHistory[chatIndex].preview = previewText;

    // Move the current chat to the top of the list
    const currentChat = chatHistory.splice(chatIndex, 1)[0];
    chatHistory.unshift(currentChat);

    // Save to Firestore (with fallback to localStorage)
    const firestoreSuccess = await saveChatToFirestore(currentChat);
    if (!firestoreSuccess) {
        // Fallback to localStorage if Firestore fails
        try {
            localStorage.setItem('chatHistory', JSON.stringify(chatHistory));
            console.log(`[CHAT] Saved to localStorage as fallback for chat: ${currentChatId}`);
        } catch (localStorageError) {
            console.error('[CHAT] Both Firestore and localStorage save failed:', localStorageError);
            // If localStorage is full, clear it and try again
            if (localStorageError.name === 'QuotaExceededError') {
                localStorage.removeItem('chatHistory');
                console.log('[CHAT] Cleared localStorage due to quota exceeded');
                try {
                    localStorage.setItem('chatHistory', JSON.stringify([currentChat]));
                    console.log('[CHAT] Saved current chat only to localStorage');
                } catch (retryError) {
                    console.error('[CHAT] Failed to save even after clearing localStorage:', retryError);
                }
            }
        }
    }

    renderChatHistory(); // Re-render to show updated preview and order
    console.log(`[CHAT] Saved state for chat: ${currentChatId}`);
}

async function startNewChat() {
    await saveCurrentChatState(); // Save the state of the chat we are leaving

    const newChatId = Date.now();
    currentChatId = newChatId;

    const newChat = {
        id: newChatId,
        preview: 'New chat...',
        state: {
            userInputContent: ''
        }
    };

    chatHistory.unshift(newChat);
    loadChatState(newChat.state);

    // Save new chat to Firestore (with localStorage fallback)
    const firestoreSuccess = await saveChatToFirestore(newChat);
    if (!firestoreSuccess) {
        try {
            localStorage.setItem('chatHistory', JSON.stringify(chatHistory));
        } catch (error) {
            console.error('[CHAT] Failed to save new chat:', error);
        }
    }

    renderChatHistory();
    document.getElementById('userInput').focus();
    console.log(`[CHAT] Started new chat: ${newChatId}`);
}

async function switchChat(chatId) {
    if (chatId === currentChatId) return;

    await saveCurrentChatState(); // Save the current chat before switching

    const chat = chatHistory.find(c => c.id === chatId);
    if (chat) {
        currentChatId = chatId;
        loadChatState(chat.state);
        renderChatHistory();
        console.log(`[CHAT] Switched to chat: ${chatId}`);
    } else {
        console.error(`[CHAT] Could not find chat with id: ${chatId}`);
    }
}

async function deleteChat(chatId, event) {
    event.stopPropagation(); // Prevent switchChat from firing

    if (!confirm('Are you sure you want to delete this chat?')) return;

    // Delete from Firestore first
    await deleteChatFromFirestore(chatId);

    // Remove from local array
    chatHistory = chatHistory.filter(c => c.id !== chatId);

    // Update localStorage as backup
    try {
        localStorage.setItem('chatHistory', JSON.stringify(chatHistory));
    } catch (error) {
        console.warn('[CHAT] Failed to update localStorage after delete:', error);
    }

    if (currentChatId === chatId) {
        // If we deleted the active chat, load the newest one or start fresh
        if (chatHistory.length > 0) {
            await switchChat(chatHistory[0].id);
        } else {
            await startNewChat();
        }
    }

    renderChatHistory();
    console.log(`[CHAT] Deleted chat: ${chatId}`);
}


// COMMENTED OUT - Chat history functionality no longer used
/*
function renderChatHistory() {
    const historyList = document.getElementById('historyList');
    
    if (!historyList) {
        console.error('[DEBUG] historyList element not found!');
        return;
    }

    console.log('[DEBUG] renderChatHistory called with:', {
        chatHistoryLength: chatHistory.length,
        currentChatId: currentChatId,
        historyListExists: !!historyList
    });

    historyList.innerHTML = '';
    
    if (chatHistory.length === 0) {
        historyList.innerHTML = '<div class="no-chats">No chat history yet</div>';
        console.log('[DEBUG] No chat history to render');
        return;
    }
    
    chatHistory.forEach((chat, index) => {
        console.log(`[DEBUG] Rendering chat ${index}:`, {
            id: chat.id,
            preview: chat.preview,
            isActive: chat.id === currentChatId
        });
        
        const item = document.createElement('div');
        item.className = `history-item ${chat.id === currentChatId ? 'active' : ''}`;
        item.setAttribute('data-chat-id', chat.id);
        item.onclick = () => switchChat(chat.id);
        
        const chatDate = formatChatDate(chat.id);
        item.innerHTML = `
            <div class="history-item-title">${chatDate}: ${chat.preview}</div>
            <button class="delete-chat-btn" onclick="deleteChat(${chat.id}, event)" title="Delete Chat">&times;</button>
        `;
        historyList.appendChild(item);
    });
    
    console.log(`[DEBUG] renderChatHistory completed, historyList.children.length: ${historyList.children.length}`);
}
*/

// COMMENTED OUT - Chat history functionality no longer used
/*
async function initializeChatHistory() {
    // Prevent multiple simultaneous chat history initializations
    if (window.chatHistoryInitializing || window.chatHistoryInitialized) {
        console.log('[DEBUG] ⏭️ Chat history initialization already in progress or completed, skipping...');
        return;
    }
    
    window.chatHistoryInitializing = true;
    console.log('[DEBUG] Initializing chat history...');
    
    // Check if required elements exist
    const historyList = document.getElementById('historyList');
    const historyColumn = document.getElementById('historyColumn');
    console.log('[DEBUG] DOM elements check:', {
        historyList: !!historyList,
        historyColumn: !!historyColumn,
        historyListDisplay: historyList ? getComputedStyle(historyList).display : 'not found',
        historyColumnDisplay: historyColumn ? getComputedStyle(historyColumn).display : 'not found'
    });
    
    // First, try to migrate any existing localStorage data to Firestore
    await migrateChatHistoryToFirestore();
    
    // Load chat history from Firestore
    try {
        chatHistory = await loadChatHistoryFromFirestore();
        console.log('[DEBUG] Loaded chat history from Firestore:', {
            count: chatHistory.length,
            chatIds: chatHistory.map(c => c.id),
            firstChatPreview: chatHistory[0] ? {
                id: chatHistory[0].id,
                title: chatHistory[0].title,
                preview: chatHistory[0].preview
            } : 'none'
        });
    } catch (error) {
        console.error('[DEBUG] Error loading chat history from Firestore:', error);
        
        // Fallback to localStorage if Firestore fails
        const savedHistory = localStorage.getItem('chatHistory');
        if (savedHistory) {
            try {
                chatHistory = JSON.parse(savedHistory);
                console.log('[DEBUG] Loaded chat history from localStorage (fallback):', {
                    count: chatHistory.length
                });
            } catch (parseError) {
                console.error('[DEBUG] Error parsing saved chat history:', parseError);
                chatHistory = [];
            }
        } else {
            chatHistory = [];
        }
    }

    // Always start with a fresh chat on client load
    console.log('[DEBUG] Starting fresh chat on client load');
    try {
        await startNewChat();
        console.log('[DEBUG] Started new chat, currentChatId:', currentChatId);
    } catch (error) {
        console.error('[DEBUG] Error starting new chat:', error);
    }
    
    console.log('[DEBUG] About to call renderChatHistory...');
    renderChatHistory();
    
    window.chatHistoryInitialized = true;
    console.log('[DEBUG] Chat history initialization completed');
    window.chatHistoryInitializing = false;
}
*/

// Add debugging to the main app initialization
async function initializeMainApp() {
    // Prevent multiple simultaneous initializations
    if (window.mainAppInitializing || window.mainAppInitialized) {
        console.log('[DEBUG] ⏭️ Main app initialization already in progress or completed, skipping...');
        return;
    }

    window.mainAppInitializing = true;

    try {
        console.log('[DEBUG] Initializing main app features...');
        console.log('[DEBUG] DOM ready state:', document.readyState);
        console.log('[DEBUG] Available elements:', {
            historyList: !!document.getElementById('historyList'),
            historyColumn: !!document.getElementById('historyColumn'),
            transcriptColumn: !!document.getElementById('transcriptColumn'),
            userInput: !!document.getElementById('userInput'),
            summary1: !!document.getElementById('summary1')
        });

        // Initialize chat history - COMMENTED OUT (functionality no longer used)
        // console.log('[DEBUG] Calling initializeChatHistory...');
        // await initializeChatHistory();

        // Load clinical conditions and guidelines in parallel for faster startup
        console.log('[DEBUG] ⚡ Loading clinical conditions and guidelines in parallel...');
        const startTime = performance.now();

        try {
            const [conditionsResult, guidelinesResult] = await Promise.allSettled([
                ClinicalConditionsService.loadConditions(),
                window.loadGuidelinesFromFirestore()
            ]);

            const endTime = performance.now();
            console.log(`[DEBUG] ⚡ Parallel loading completed in ${(endTime - startTime).toFixed(0)}ms`);

            // Check conditions result
            if (conditionsResult.status === 'fulfilled') {
                const summary = ClinicalConditionsService.getSummary();
                console.log('[DEBUG] Clinical conditions loaded successfully:', summary);
            } else {
                console.error('[DEBUG] Failed to load clinical conditions:', conditionsResult.reason);
            }

            // Check guidelines result
            if (guidelinesResult.status === 'fulfilled') {
                console.log('[DEBUG] Guidelines loaded successfully during initialization');
            } else {
                console.warn('[DEBUG] Error during initial loadGuidelinesFromFirestore call:', guidelinesResult.reason?.message);
            }
        } catch (error) {
            console.error('[DEBUG] Unexpected error during parallel loading:', error);
            // Don't throw - allow app to continue functioning
        }

        window.mainAppInitialized = true;
        console.log('[DEBUG] Main app initialization completed');

        // Dispatch event to signal that critical data has loaded
        // This triggers deferred initializations like TipTap editor
        window.dispatchEvent(new CustomEvent('criticalDataLoaded'));
        console.log('[DEBUG] ⚡ Critical data loaded event dispatched');

        // Show main content and hide loading screen immediately
        const loading = document.getElementById('loading');
        const mainContent = document.getElementById('mainContent');

        if (loading) {
            loading.classList.add('hidden');
            console.log('[DEBUG] Loading screen hidden - app ready for use');
        }

        if (mainContent) {
            mainContent.classList.remove('hidden');
            console.log('[DEBUG] Main content shown - app ready for use');
        }

        // Start background tasks after page is interactive
        setTimeout(() => {
            console.log('[DEBUG] Starting background tasks...');
            window.syncGuidelinesInBackground();
            window.setupGuidelinesListenerInBackground();
            // Ensure metadata completion is checked each startup (runs in background)
            if (typeof window.scheduleBackgroundMetadataCompletion === 'function') {
                window.scheduleBackgroundMetadataCompletion(['summary']);
            }
        }, 1000);
    } catch (error) {
        console.error('[DEBUG] Error initializing main app:', error);
        console.error('[DEBUG] Error stack:', error.stack);

        // Hide loading screen and show main content immediately even if there's an error
        const loading = document.getElementById('loading');
        const mainContent = document.getElementById('mainContent');

        if (loading) {
            loading.classList.add('hidden');
            console.log('[DEBUG] Loading screen hidden due to initialization error');
        }

        if (mainContent) {
            mainContent.classList.remove('hidden');
            console.log('[DEBUG] Main content shown despite initialization error');
        }
    } finally {
        window.mainAppInitializing = false;
    }
}

// Add debugging to the auth state change handler
window.auth.onAuthStateChanged(async (user) => {
    // Track app start time for loading screen minimum display duration
    if (!window.appStartTime) {
        window.appStartTime = Date.now();
    }

    console.log('[DEBUG] Auth state changed:', {
        hasUser: !!user,
        userEmail: user?.email,
        userDisplayName: user?.displayName
    });

    const loading = document.getElementById('loading');
    const landingPage = document.getElementById('landingPage');
    const mainContent = document.getElementById('mainContent');

    console.log('[DEBUG] Page elements found:', {
        loading: !!loading,
        landingPage: !!landingPage,
        mainContent: !!mainContent
    });

    // Ensure loading screen is visible during auth state check
    if (loading) {
        loading.classList.remove('hidden');
    }

    if (user) {
        console.log('[DEBUG] User authenticated, checking disclaimer acceptance');

        // Check disclaimer acceptance first
        const disclaimerAccepted = await checkDisclaimerAcceptance();
        if (!disclaimerAccepted) {
            console.log('[DEBUG] Disclaimer not accepted, user will be redirected');
            return; // The checkDisclaimerAcceptance function will handle the redirect
        }

        console.log('[DEBUG] Disclaimer accepted, starting initialization');
        // Keep main content hidden until initialization is complete
        if (landingPage) landingPage.classList.add('hidden');
        if (mainContent) mainContent.classList.add('hidden'); // Keep hidden during initialization

        // Update user info
        const userLabel = document.getElementById('userLabel');
        const userName = document.getElementById('userName');
        if (userLabel && userName) {
            userName.textContent = user.displayName || user.email || 'User';
            userName.classList.remove('hidden');
            console.log('[DEBUG] Updated user info display');
        }

        // Ensure mode selection page is hidden before initialization
        const modeSelectionPagePre = document.getElementById('modeSelectionPage');
        if (modeSelectionPagePre) {
            modeSelectionPagePre.classList.add('hidden');
        }

        // Initialize app immediately
        await initializeMainApp();

        // Hide loading screen and show main content directly
        // Reuse existing variables declared at top of function
        const loadingAfterInit = document.getElementById('loading');
        const modeSelectionPage = document.getElementById('modeSelectionPage');
        const mainContentAfterInit = document.getElementById('mainContent');

        if (loadingAfterInit) {
            loadingAfterInit.classList.add('hidden');
        }
        if (modeSelectionPage) {
            modeSelectionPage.classList.add('hidden');
        }
        if (mainContentAfterInit) {
            mainContentAfterInit.classList.remove('hidden');
        }

        // Load and display user preferences in the preferences panel
        await loadAndDisplayUserPreferences();

        // Double-check mode selection page is hidden (defensive)
        if (modeSelectionPage && !modeSelectionPage.classList.contains('hidden')) {
            console.warn('[DEBUG] Mode selection page was visible, hiding it now');
            modeSelectionPage.classList.add('hidden');
        }

    } else {
        console.log('[DEBUG] User not authenticated, showing landing page');

        // Show landing page immediately
        if (loading) {
            loading.classList.add('hidden');
        }
        if (mainContent) {
            mainContent.classList.add('hidden');
        }
        if (landingPage) {
            landingPage.classList.remove('hidden');
        }

        // Set up Google Sign-in button listener
        setupGoogleSignIn();
    }
});

// Helper function to abbreviate hospital trust names
function abbreviateHospitalTrust(trustName) {
    if (!trustName) return '';

    // Common abbreviations for hospital trusts
    const mapping = {
        'University Hospitals Sussex NHS Foundation Trust': 'UHSussex',
        'University Hospitals Sussex': 'UHSussex',
        'UHSussex': 'UHSussex',
        'NHS Foundation Trust': '',
        'NHS Trust': '',
    };

    // Check for exact match first
    if (mapping[trustName]) {
        return mapping[trustName];
    }

    // Try to find partial matches and replace
    let abbreviated = trustName;
    for (const [full, abbrev] of Object.entries(mapping)) {
        if (abbreviated.includes(full)) {
            abbreviated = abbreviated.replace(full, abbrev).trim();
        }
    }

    // If it contains "University Hospitals", try to extract key parts
    if (abbreviated.includes('University Hospitals')) {
        const parts = abbreviated.split('University Hospitals');
        if (parts.length > 1) {
            const location = parts[1].split('NHS')[0].trim();
            if (location) {
                // Extract key location name
                const words = location.split(' ');
                if (words.length > 0) {
                    // Take first significant word (skip common words)
                    const significantWord = words.find(w => !['and', 'of', 'the'].includes(w.toLowerCase())) || words[0];
                    return 'UH' + significantWord;
                }
            }
        }
    }

    // Remove common suffixes
    abbreviated = abbreviated.replace(/\s+NHS\s+Foundation\s+Trust$/i, '');
    abbreviated = abbreviated.replace(/\s+NHS\s+Trust$/i, '');

    // Default: return as is if reasonable length, otherwise truncate
    if (abbreviated.length > 25) {
        return abbreviated.substring(0, 25) + '...';
    }

    return abbreviated || trustName;
}

// Helper function to standardize guideline titles for better display
function abbreviateOrganization(orgName) {
    if (!orgName) return '';

    const mapping = {
        // Major International Organizations
        'World Health Organization': 'WHO',
        'World Health Organisation': 'WHO',
        'WHO': 'WHO',

        // UK Organizations
        'Royal College of Obstetricians and Gynaecologists': 'RCOG',
        'Royal College of Obstetricians & Gynaecologists': 'RCOG',
        'RCOG': 'RCOG',
        'National Institute for Health and Care Excellence': 'NICE',
        'National Institute for Health and Clinical Excellence': 'NICE',
        'NICE': 'NICE',
        'British Medical Association': 'BMA',
        'BMA': 'BMA',
        'Royal College of Physicians': 'RCP',
        'RCP': 'RCP',
        'Royal College of Surgeons': 'RCS',
        'RCS': 'RCS',
        'Royal College of General Practitioners': 'RCGP',
        'RCGP': 'RCGP',
        'Royal College of Midwives': 'RCM',
        'RCM': 'RCM',
        'Royal College of Nursing': 'RCN',
        'RCN': 'RCN',

        // US Organizations
        'American College of Obstetricians and Gynecologists': 'ACOG',
        'American College of Obstetricians & Gynecologists': 'ACOG',
        'ACOG': 'ACOG',
        'American Medical Association': 'AMA',
        'AMA': 'AMA',
        'Centers for Disease Control and Prevention': 'CDC',
        'CDC': 'CDC',
        'Food and Drug Administration': 'FDA',
        'FDA': 'FDA',
        'American Academy of Pediatrics': 'AAP',
        'AAP': 'AAP',

        // European Organizations
        'European Society of Human Reproduction and Embryology': 'ESHRE',
        'ESHRE': 'ESHRE',
        'European Medicines Agency': 'EMA',
        'EMA': 'EMA',
        'European Society of Cardiology': 'ESC',
        'ESC': 'ESC',
        'International Federation of Gynecology and Obstetrics': 'FIGO',
        'International Federation of Gynaecology and Obstetrics': 'FIGO',
        'FIGO': 'FIGO',

        // Hospital Trusts and Local Organizations
        'University Hospitals Sussex NHS Foundation Trust': 'University Hospitals Sussex',
        'University Hospitals Sussex': 'University Hospitals Sussex',
        'Sussex University Hospitals': 'University Hospitals Sussex',
        'University Hospital Sussex': 'University Hospitals Sussex',
        'Brighton and Sussex University Hospitals': 'Brighton & Sussex UH',
        'Brighton & Sussex University Hospitals': 'Brighton & Sussex UH',
        'NHS Foundation Trust': 'NHS Trust',
        'Foundation Trust': 'NHS Trust',

        // Common Abbreviations and Variations
        'Department of Health': 'DOH',
        'Department of Health and Social Care': 'DHSC',
        'Public Health England': 'PHE',
        'Health and Safety Executive': 'HSE',
        'Medicines and Healthcare products Regulatory Agency': 'MHRA',
        'MHRA': 'MHRA',

        // Internal/Local Guidelines (make them more user-friendly)
        'Maternity Services': 'Maternity',
        'Obstetrics and Gynaecology': 'Obs & Gynae',
        'Obstetrics & Gynaecology': 'Obs & Gynae',
        'Emergency Department': 'Emergency Dept',
        'Accident and Emergency': 'A&E',
        'Intensive Care Unit': 'ICU',
        'Neonatal Intensive Care Unit': 'NICU',
        'Special Care Baby Unit': 'SCBU'
    };

    // Direct mapping first
    if (mapping[orgName]) {
        return mapping[orgName];
    }

    // Partial matching for complex names
    for (const [key, value] of Object.entries(mapping)) {
        if (orgName.toLowerCase().includes(key.toLowerCase()) ||
            key.toLowerCase().includes(orgName.toLowerCase())) {
            return value;
        }
    }

    // Special handling for internal codes and hospital names
    // Remove common suffixes that don't add value
    let cleaned = orgName
        .replace(/NHS Foundation Trust$/i, 'NHS Trust')
        .replace(/Foundation Trust$/i, 'NHS Trust')
        .replace(/University Hospitals?/i, 'UH')
        .replace(/Hospital Trust$/i, 'Hospital')
        .replace(/^(MP|CG|SP|MD|GP)\d+\s*-?\s*/i, '') // Remove internal codes like MP053, CG12004
        .trim();

    // If no match found, return the cleaned name (but truncated if too long)
    return cleaned.length > 25 ? cleaned.substring(0, 22) + '...' : cleaned;
}

// Function to enhance metadata for a guideline using AI
async function enhanceGuidelineMetadata(guidelineId, specificFields = null) {
    try {
        // Get user ID token
        const user = auth.currentUser;
        if (!user) {
            console.error('[METADATA] User not authenticated for metadata enhancement');
            return;
        }
        const idToken = await user.getIdToken();

        console.log(`[DEBUG] Enhancing metadata for guideline: ${guidelineId}`);

        const response = await fetch(`${window.SERVER_URL}/enhanceGuidelineMetadata`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${idToken}`
            },
            body: JSON.stringify({
                guidelineId,
                specificFields
            })
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || `Server error: ${response.status}`);
        }

        const result = await response.json();

        if (result.success) {
            console.log('[DEBUG] Metadata enhancement successful:', result);

            // Check if this should be silent (from auto-enhancement) or show a detailed message
            if (result.silent || window.enhancementInProgress) {
                // Silent mode - just log basic info
                console.log(`[METADATA] Enhanced ${result.enhancedFields?.length || 0} fields for guideline ${guidelineId}`);
            } else {
                // Interactive mode - build detailed message but still just log it
                let message = result.message + '\n\n';

                if (result.enhancedFields && result.enhancedFields.length > 0) {
                    message += 'Enhanced fields:\n';
                    result.enhancedFields.forEach(field => {
                        const action = field.action === 'added' ? 'Added' : 'Enhanced';
                        message += `• ${action} ${field.field}: "${field.newValue}"\n`;
                    });
                }

                if (result.errors && result.errors.length > 0) {
                    message += '\nWarnings:\n';
                    result.errors.forEach(error => {
                        message += `• ${error}\n`;
                    });
                }

                // Log the detailed result 
                console.log('[METADATA] Enhancement result:', message);
            }

            // Note: Guidelines are automatically updated in Firestore via the server
            // Avoiding reload to prevent infinite enhancement loops
            console.log('[DEBUG] Metadata enhancement completed - data updated in Firestore');

            return result;
        } else {
            throw new Error(result.error || 'Enhancement failed');
        }

    } catch (error) {
        console.error('[DEBUG] Error enhancing metadata:', error);
        console.error(`[METADATA] Enhancement failed: ${error.message}`);
        throw error;
    }
}

// Function to batch enhance metadata for multiple guidelines
async function batchEnhanceMetadata(guidelineIds, fieldsToEnhance = null) {
    try {
        // Get user ID token
        const user = auth.currentUser;
        if (!user) {
            console.error('[METADATA] User not authenticated for batch enhancement');
            return;
        }
        const idToken = await user.getIdToken();

        console.log(`[DEBUG] Batch enhancing metadata for ${guidelineIds.length} guidelines`);

        // Log progress instead of showing popup
        const progressMessage = `Starting batch enhancement for ${guidelineIds.length} guidelines...\nThis may take a few minutes.`;
        console.log('[METADATA] Batch enhancement starting:', progressMessage);

        const response = await fetch(`${window.SERVER_URL}/batchEnhanceMetadata`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${idToken}`
            },
            body: JSON.stringify({
                guidelineIds,
                fieldsToEnhance
            })
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || `Server error: ${response.status}`);
        }

        const result = await response.json();

        if (result.success) {
            console.log('[DEBUG] Batch metadata enhancement completed:', result);

            // Display summary results
            let message = result.message + '\n\n';
            message += `Summary:\n`;
            message += `• Total guidelines: ${result.summary.totalGuidelines}\n`;
            message += `• Successfully enhanced: ${result.summary.successful}\n`;
            message += `• Failed: ${result.summary.failed}\n`;
            message += `• Total fields enhanced: ${result.summary.totalFieldsEnhanced}\n`;

            if (result.summary.totalErrors > 0) {
                message += `• Total errors: ${result.summary.totalErrors}\n`;
            }

            // Log the batch result instead of showing popup
            console.log('[METADATA] Batch enhancement result:', message);

            // Note: Guidelines are automatically updated in Firestore via the server
            // Avoiding reload to prevent infinite enhancement loops
            console.log('[DEBUG] Batch enhancement completed - data updated in Firestore');

            return result;
        } else {
            throw new Error(result.error || 'Batch enhancement failed');
        }

    } catch (error) {
        console.error('[DEBUG] Error in batch enhancement:', error);
        console.error(`[METADATA] Batch enhancement failed: ${error.message}`);
        throw error;
    }
}

// Generic function to trigger metadata completion for specified fields
async function triggerMetadataCompletionForAll(targetFields = null) {
    try {
        // Define default priority order - humanFriendlyName first for 100% completion goal
        const defaultFieldOrder = [
            'humanFriendlyName',
            'organisation',
            'yearProduced',
            'title',
            'summary',
            'keywords'
        ];

        const fieldsToProcess = targetFields || defaultFieldOrder;
        console.log(`[METADATA_COMPLETION] Starting completion for fields: ${fieldsToProcess.join(', ')}`);

        const response = await fetch('https://clerky-uzni.onrender.com/ensureMetadataCompletion', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${await window.auth.currentUser.getIdToken()}`
            },
            body: JSON.stringify({ targetFields: fieldsToProcess })
        });

        const result = await response.json();

        if (result.success) {
            console.log(`[METADATA_COMPLETION] ✅ Metadata completion finished:`, {
                total: result.total,
                processed: result.processed,
                fieldsCompleted: result.fieldsCompleted,
                overallCompletionRate: result.overallCompletionRate
            });

            // Log field-specific completion rates
            if (result.fieldResults) {
                result.fieldResults.forEach(fieldResult => {
                    console.log(`[METADATA_COMPLETION] ${fieldResult.field}: ${fieldResult.completionRate}% complete (${fieldResult.completed}/${fieldResult.total})`);

                    if (fieldResult.completionRate === 100) {
                        console.log(`[METADATA_COMPLETION] 🎉 100% ${fieldResult.field} completion achieved!`);
                    }
                });
            }
        } else {
            console.error('[METADATA_COMPLETION] ❌ Metadata completion failed:', result.error);
        }

        return result;
    } catch (error) {
        console.error('[METADATA_COMPLETION] ❌ Error triggering metadata completion:', error);
        return { success: false, error: error.message };
    }
}

// Schedule a background metadata completion check (defaults to summaries)
function scheduleBackgroundMetadataCompletion(targetFields = ['summary'], options = {}) {
    const {
        retryDelay = 2000,
        maxRetries = 5
    } = options;

    if (!Array.isArray(targetFields) || targetFields.length === 0) {
        targetFields = ['summary'];
    }

    if (!window.__metadataCompletionState) {
        window.__metadataCompletionState = {
            scheduled: false,
            attempts: 0
        };
    }

    const state = window.__metadataCompletionState;
    if (state.scheduled) {
        console.log('[METADATA_COMPLETION] Background check already scheduled, skipping new request.');
        return;
    }

    state.scheduled = true;
    state.attempts = 0;

    console.log(`[METADATA_COMPLETION] Scheduling background check for fields: ${targetFields.join(', ')}`);

    const attemptTrigger = async () => {
        const user = window.auth?.currentUser;
        if (!user) {
            state.attempts += 1;
            if (state.attempts <= maxRetries) {
                console.log(`[METADATA_COMPLETION] Auth not ready (attempt ${state.attempts}/${maxRetries}), retrying in ${retryDelay}ms...`);
                setTimeout(attemptTrigger, retryDelay);
            } else {
                console.warn('[METADATA_COMPLETION] Auth not available after maximum retries. Metadata check aborted.');
                state.scheduled = false;
            }
            return;
        }

        try {
            const promise = triggerMetadataCompletionForAll(targetFields);
            if (promise && typeof promise.then === 'function') {
                promise
                    .catch(error => {
                        console.error('[METADATA_COMPLETION] Background check failed:', error);
                    })
                    .finally(() => {
                        console.log('[METADATA_COMPLETION] Background check finished.');
                        state.scheduled = false;
                    });
            } else {
                console.warn('[METADATA_COMPLETION] Background check promise not returned as expected.');
                state.scheduled = false;
            }
        } catch (error) {
            console.error('[METADATA_COMPLETION] Error scheduling background check:', error);
            state.scheduled = false;
        }
    };

    setTimeout(attemptTrigger, 0);
}

// Make functions globally available
window.enhanceGuidelineMetadata = enhanceGuidelineMetadata;
window.batchEnhanceMetadata = batchEnhanceMetadata;
window.checkMetadataCompleteness = checkMetadataCompleteness;
window.autoEnhanceIncompleteMetadata = autoEnhanceIncompleteMetadata;
window.showMetadataProgress = showMetadataProgress;
window.hideMetadataProgress = hideMetadataProgress;
window.triggerMetadataCompletionForAll = triggerMetadataCompletionForAll;
window.scheduleBackgroundMetadataCompletion = scheduleBackgroundMetadataCompletion;

// Testing helper - trigger completion for specific fields only
window.testMetadataCompletion = async function (fields = ['humanFriendlyName']) {
    console.log(`[TEST] Triggering metadata completion for: ${fields.join(', ')}`);
    return await triggerMetadataCompletionForAll(fields);
};

// Function to show metadata enhancement progress to user
function showMetadataProgress(message, isComplete = false) {
    // Create or update progress notification
    let progressDiv = document.getElementById('metadata-progress');

    if (!progressDiv) {
        progressDiv = document.createElement('div');
        progressDiv.id = 'metadata-progress';
        progressDiv.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: #f0f9ff;
            border: 1px solid #0ea5e9;
            border-radius: 8px;
            padding: 12px 16px;
            max-width: 300px;
            z-index: 1000;
            font-size: 14px;
            box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
        `;
        document.body.appendChild(progressDiv);
    }

    progressDiv.innerHTML = `
        <div style="display: flex; align-items: center; gap: 8px;">
            ${isComplete ?
            '<div style="width: 12px; height: 12px; background: #10b981; border-radius: 50%;"></div>' :
            '<div style="width: 12px; height: 12px; border: 2px solid #0ea5e9; border-top: 2px solid transparent; border-radius: 50%; animation: spin 1s linear infinite;"></div>'
        }
            <span>${message}</span>
        </div>
    `;

    // Add animation keyframe if not already added
    if (!document.getElementById('metadata-progress-styles')) {
        const style = document.createElement('style');
        style.id = 'metadata-progress-styles';
        style.textContent = `
            @keyframes spin {
                0% { transform: rotate(0deg); }
                100% { transform: rotate(360deg); }
            }
        `;
        document.head.appendChild(style);
    }

    // Auto-hide completed messages after 5 seconds
    if (isComplete) {
        setTimeout(() => {
            if (progressDiv && progressDiv.parentNode) {
                progressDiv.remove();
            }
        }, 5000);
    }
}

// Function to hide metadata progress
function hideMetadataProgress() {
    const progressDiv = document.getElementById('metadata-progress');
    if (progressDiv && progressDiv.parentNode) {
        progressDiv.remove();
    }
}

// Show guideline selection interface for multi-guideline guideline suggestions
async function showGuidelineSelectionInterface(mostRelevantGuidelines) {
    console.log('[DEBUG] showGuidelineSelectionInterface called with', mostRelevantGuidelines.length, 'guidelines');

    // Create the selection interface HTML
    const selectionHtml = `
        <div class="guideline-selection-container">
            <div class="selection-header">
                <h3>🎯 Select Guidelines for Guideline Suggestions</h3>
                <p>Choose which guidelines to include in your guideline suggestions generation. Multiple guidelines will be processed in parallel for faster results.</p>
                <div class="selection-stats">
                    <span><strong>${mostRelevantGuidelines.length}</strong> most relevant guidelines available</span>
                </div>
            </div>
            
            <div class="selection-controls">
                <button type="button" class="selection-btn select-all-btn" onclick="selectAllGuidelines(true)">
                    ✅ Select All
                </button>
                <button type="button" class="selection-btn deselect-all-btn" onclick="selectAllGuidelines(false)">
                    ❌ Deselect All
                </button>
            </div>
            
            <div class="guidelines-selection-list">
                ${mostRelevantGuidelines.map((guideline, index) => {
        const guidelineData = window.globalGuidelines[guideline.id];
        const displayTitle = guidelineData?.displayName || guideline.displayName || guidelineData?.humanFriendlyName || guideline.humanFriendlyName || guideline.title || guideline.id;
        const organization = guidelineData?.organisation || 'Unknown';
        const relevanceScore = guideline.relevance || 'N/A';

        return `
                        <div class="guideline-selection-item" data-guideline-id="${guideline.id}">
                            <div class="selection-checkbox">
                                <input type="checkbox" id="guideline-${index}" checked="checked" 
                                       data-guideline-id="${guideline.id}" class="guideline-checkbox">
                                <label for="guideline-${index}"></label>
                            </div>
                            <div class="guideline-info">
                                <div class="guideline-content">
                                    <span class="guideline-title">${displayTitle}</span>
                                    <span class="organization">${organization}</span>
                                    <span class="relevance-score">Relevance: ${relevanceScore}</span>
                                </div>
                            </div>
                            <div class="guideline-actions">
                                ${guidelineData?.downloadUrl ? `
                                    <a href="${guidelineData.downloadUrl}" target="_blank" class="pdf-link" title="Download PDF">
                                        📄 PDF
                                    </a>
                                ` : ''}
                            </div>
                        </div>
                    `;
    }).join('')}
            </div>
            
            <div class="selection-actions">
                <button type="button" class="action-btn primary generate-advice-btn" onclick="generateMultiGuidelineAdvice()">
                    <span class="btn-icon">🚀</span>
                    <span class="btn-text">Generate Guideline Suggestions</span>
                    <span class="btn-spinner" style="display: none;">⏳</span>
                </button>
                <button type="button" class="action-btn secondary cancel-selection-btn" onclick="cancelGuidelineSelection()">
                    Cancel
                </button>
            </div>
            
            <div class="selection-info">
                <p><strong>How it works:</strong></p>
                <ul>
                    <li>Selected guidelines will be processed simultaneously for faster results</li>
                    <li>All "Very Important Recommendations" will be combined and presented together</li>
                    <li>You can accept, reject, or modify suggestions from all guidelines</li>
                    <li>Processing time scales with the number of selected guidelines</li>
                </ul>
            </div>
        </div>
        
        <style>
        .guideline-selection-container {
            background: var(--bg-secondary);
            border: 1px solid var(--border-color);
            border-radius: 8px;
            padding: 20px;
            margin: 20px 0;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        }
        
        .selection-header h3 {
            margin: 0 0 10px 0;
            color: var(--text-primary);
            font-size: 1.2em;
        }
        
        .selection-header p {
            margin: 0 0 15px 0;
            color: var(--text-secondary);
            line-height: 1.5;
        }
        
        .selection-stats {
            background: #e3f2fd;
            padding: 8px 12px;
            border-radius: 4px;
            font-size: 0.9em;
            color: #1976d2;
        }
        
        .selection-controls {
            margin: 15px 0;
            display: flex;
            gap: 10px;
        }
        
        .selection-btn {
            padding: 8px 16px;
            border: 1px solid #ddd;
            border-radius: 4px;
            background: var(--bg-secondary);
            cursor: pointer;
            font-size: 0.9em;
            transition: all 0.2s;
        }
        
        .selection-btn:hover {
            background: var(--bg-tertiary);
            border-color: #007bff;
        }
        
        .guidelines-selection-list {
            max-height: 400px;
            overflow-y: auto;
            border: 1px solid #ddd;
            border-radius: 4px;
            background: var(--bg-secondary);
            margin: 15px 0;
        }
        
        .guideline-selection-item {
            display: flex;
            align-items: center;
            padding: 12px 15px;
            border-bottom: 1px solid #eee;
            transition: background 0.2s;
        }
        
        .guideline-selection-item:hover {
            background: var(--bg-tertiary);
        }
        
        .guideline-selection-item:last-child {
            border-bottom: none;
        }
        
        .selection-checkbox {
            margin-right: 15px;
            position: relative;
        }
        
        .guideline-checkbox {
            width: 18px;
            height: 18px;
            cursor: pointer;
            margin-right: 4px !important;
        }
        
        .guideline-info {
            flex: 1;
            margin-left: 8px !important;
        }
        
        .guideline-content {
            display: flex;
            align-items: center;
            gap: 12px;
            flex-wrap: wrap;
        }
        
        .guideline-title {
            font-weight: 500;
            color: var(--text-primary);
            line-height: 1.3;
            flex: 1;
            min-width: 0;
        }
        
        .organization {
            font-weight: 500;
            color: var(--text-secondary);
            font-size: 0.9em;
            white-space: nowrap;
        }
        
        .relevance-score {
            color: #28a745;
            font-size: 0.9em;
            font-weight: 500;
            white-space: nowrap;
        }
        
        .guideline-actions {
            margin-left: 15px;
        }
        
        .pdf-link {
            text-decoration: none;
            color: #dc3545;
            font-size: 0.9em;
            padding: 4px 8px;
            border-radius: 3px;
            transition: background 0.2s;
        }
        
        .pdf-link:hover {
            background: var(--bg-tertiary);
            text-decoration: none;
        }
        
        .selection-actions {
            margin: 20px 0 15px 0;
            display: flex;
            gap: 10px;
            align-items: center;
        }
        
        .action-btn {
            padding: 10px 20px;
            border: none;
            border-radius: 5px;
            cursor: pointer;
            font-size: 0.95em;
            font-weight: 500;
            display: flex;
            align-items: center;
            gap: 8px;
            transition: all 0.2s;
        }
        
        .action-btn.primary {
            background: #007bff;
            color: white;
        }
        
        .action-btn.primary:hover {
            background: #0056b3;
        }
        
        .action-btn.primary:disabled {
            background: #6c757d;
            cursor: not-allowed;
        }
        
        .action-btn.secondary {
            background: #6c757d;
            color: white;
        }
        
        .action-btn.secondary:hover {
            background: #545b62;
        }
        
        .selection-info {
            background: #fff3cd;
            border: 1px solid #ffeaa7;
            border-radius: 4px;
            padding: 15px;
            font-size: 0.9em;
        }
        
        .selection-info p {
            margin: 0 0 10px 0;
            font-weight: 500;
            color: #856404;
        }
        
        .selection-info ul {
            margin: 0;
            padding-left: 20px;
            color: #856404;
        }
        
        .selection-info li {
            margin-bottom: 5px;
            line-height: 1.4;
        }
        </style>
    `;

    // Display the selection interface
    appendToOutputField(selectionHtml, false);

    console.log('[DEBUG] Guideline selection interface displayed');
}

// Helper function to select/deselect all guidelines
function selectAllGuidelines(select) {
    const checkboxes = document.querySelectorAll('.guideline-checkbox');
    checkboxes.forEach(checkbox => {
        checkbox.checked = select;
    });

    // Update button text after selection change
    updateProcessButtonText();

    console.log('[DEBUG] ' + (select ? 'Selected' : 'Deselected') + ' all guidelines');
}

// Make functions globally accessible
window.selectAllGuidelines = selectAllGuidelines;
window.processSelectedGuidelines = processSelectedGuidelines;

// Cancel guideline selection
function cancelGuidelineSelection() {
    // Just scroll to the end, the selection interface will remain visible but user can continue with other actions
    console.log('[DEBUG] Guideline selection cancelled');
}

// NEW: Process selected guidelines sequentially (one-by-one)
async function processSelectedGuidelines(event) {
    console.log('[DEBUG] processSelectedGuidelines function called!');

    // Prevent event propagation and default behavior
    if (event) {
        event.preventDefault();
        event.stopPropagation();
    }

    const button = event?.target?.closest('.process-selected-btn') || document.querySelector('.process-selected-btn');

    if (!button) {
        console.error('[DEBUG] Process button not found!');
        alert('Process button not found. Please try refreshing the page.');
        return;
    }

    // Prevent double-clicking
    if (button.disabled) {
        console.log('[DEBUG] Button already processing, ignoring click');
        return;
    }

    const originalText = button.textContent;

    try {
        // Get all checked guidelines
        const checkedCheckboxes = document.querySelectorAll('.guideline-checkbox:checked');
        console.log('[DEBUG] Found checkboxes:', checkedCheckboxes.length);

        const selectedGuidelineIds = Array.from(checkedCheckboxes).map(cb => cb.dataset.guidelineId);
        console.log('[DEBUG] Selected guideline IDs:', selectedGuidelineIds);

        if (selectedGuidelineIds.length === 0) {
            alert('Please select at least one guideline to process');
            return;
        }

        // Set loading state
        button.disabled = true;
        button.innerHTML = '⏳ Processing...';

        updateUser(`Processing ${selectedGuidelineIds.length} guidelines...`, true);

        console.log('[DEBUG] Starting sequential processing of selected guidelines:', selectedGuidelineIds);
        updateAnalyseButtonProgress(`Processing ${selectedGuidelineIds.length} Guidelines...`, true);

        // Remove the guideline selection interface (it's permanent, not transient)
        const guidelineInterface = document.querySelector('.guideline-selection-interface');
        if (guidelineInterface) {
            console.log('[DEBUG] Removing guideline selection interface');
            guidelineInterface.style.transition = 'opacity 0.3s ease-out, max-height 0.3s ease-out';
            guidelineInterface.style.opacity = '0';
            guidelineInterface.style.maxHeight = '0';
            guidelineInterface.style.overflow = 'hidden';

            setTimeout(() => {
                if (guidelineInterface.parentNode) {
                    guidelineInterface.parentNode.remove(); // Remove the wrapper too
                }
            }, 300);
        }

        // Hide the selection buttons from the button container
        hideSelectionButtons();

        // Remove all transient messages (progress indicators, etc.)
        removeTransientMessages();

        // Add a brief delay to let the fade animation complete
        await new Promise(resolve => setTimeout(resolve, 350));

        // Add a clean final summary of what was selected via status bar
        updateUser(
            `Processing ${selectedGuidelineIds.length} selected guidelines to generate interactive suggestions...`,
            true
        );

        // Set up sequential processing globals
        window.sequentialProcessingActive = true;
        window.sequentialProcessingQueue = selectedGuidelineIds;
        window.sequentialProcessingIndex = 0;

        const sequentialProcessingMessage = `
            <div class="sequential-processing-container">
                <div class="processing-status" id="processing-status"></div>
            </div>
            <style>
            .sequential-processing-container {
                background: #e8f5e8;
                border: 1px solid #4caf50;
                border-radius: 6px;
                padding: 15px 0;
            }
            .processing-status {
                margin-top: 10px;
                font-family: monospace;
                font-size: 0.9em;
            }
            .processing-step {
                padding: 5px 0;
                border-bottom: 1px solid #ddd;
            }
            .processing-step.current {
                background: #fff3cd;
                font-weight: bold;
                padding: 8px;
                border-radius: 4px;
            }
            .processing-step.completed {
                color: #28a745;
            }
            .processing-step.pending {
                color: #6c757d;
            }
            </style>
        `;

        appendToSummary1(sequentialProcessingMessage, false, true); // Transient structural container only

        // Function to update status display
        function updateSequentialStatus() {
            const statusDiv = document.getElementById('processing-status');
            if (statusDiv) {
                statusDiv.innerHTML = selectedGuidelineIds.map((id, index) => {
                    const guideline = window.relevantGuidelines.find(g => g.id === id);
                    const title = getGuidelineDisplayName(id, guideline);
                    const shortTitle = title.length > 50 ? title.substring(0, 47) + '...' : title;

                    let className = 'processing-step pending';
                    let emoji = '⏳';

                    if (index < window.sequentialProcessingIndex) {
                        className = 'processing-step completed';
                        emoji = '✅';
                    } else if (index === window.sequentialProcessingIndex) {
                        className = 'processing-step current';
                        emoji = '🔄';
                    }

                    return `<div class="${className}">${emoji} ${index + 1}. ${shortTitle}</div>`;
                }).join('');
            }
        }

        // Process only the first guideline - rest will be handled by applyAllDecisions
        const i = 0;
        const guidelineId = selectedGuidelineIds[i];
        const stepNumber = i + 1;

        // Update status display for first guideline
        updateSequentialStatus();

        console.log(`[DEBUG] Processing guideline ${stepNumber}/${selectedGuidelineIds.length}: ${guidelineId}`);

        // Update status bar for first guideline
        const processingStepMessage = `Processing guideline ${stepNumber}/${selectedGuidelineIds.length}...`;
        updateUser(processingStepMessage, true);

        try {
            // Process only the first guideline - the rest will be handled in applyAllDecisions
            await processSingleGuideline(guidelineId, stepNumber, selectedGuidelineIds.length);

        } catch (error) {
            console.error(`[DEBUG] Error processing guideline ${guidelineId}:`, error);
            const errorMessage = `❌ **Error processing guideline ${stepNumber}:** ${error.message}\n\n`;
            appendToOutputField(errorMessage, true);
        }

        // Don't show completion message yet - will be shown when all guidelines are done

    } catch (error) {
        console.error('[DEBUG] Error in processSelectedGuidelines:', error);
        updateUser('Error processing guidelines', false);
        const errorMessage = `\n❌ **Sequential Processing Error:** ${error.message}\n\nPlease try again or contact support if the problem persists.\n`;
        appendToOutputField(errorMessage, true);
        alert('Error processing selected guidelines: ' + error.message);

    } finally {
        // Reset button state
        button.disabled = false;
        button.textContent = originalText;
        if (!document.getElementById('serverStatusMessage').textContent.includes('Error')) {
            updateUser('', false);
        }
    }
}

// Helper function to get the display name for a guideline consistently
function getGuidelineDisplayName(guidelineId, guideline = null, guidelineData = null) {
    // Get guideline from relevantGuidelines if not provided
    if (!guideline) {
        guideline = window.relevantGuidelines?.find(g => g.id === guidelineId);
    }

    // Get guidelineData from globalGuidelines if not provided
    if (!guidelineData) {
        guidelineData = window.globalGuidelines?.[guidelineId];
    }

    // Use the SAME logic as the selection interface (including safety guardrails)
    const safeGuideline = guideline || { id: guidelineId };
    return getCleanDisplayTitle(safeGuideline, guidelineData) || guidelineId;
}

// Function to process a single guideline (extracted from existing checkAgainstGuidelines logic)
async function processSingleGuideline(guidelineId, stepNumber, totalSteps) {
    console.log(`[DEBUG] processSingleGuideline called for: ${guidelineId}`);

    const transcript = getUserInputContent();
    if (!transcript) {
        throw new Error('No transcript found');
    }

    // Get user authentication
    const user = auth.currentUser;
    if (!user) {
        throw new Error('User not authenticated');
    }
    const idToken = await user.getIdToken();

    // Find the guideline in our global cache
    const targetGuideline = window.relevantGuidelines.find(g => g.id === guidelineId);
    if (!targetGuideline) {
        throw new Error(`Guideline ${guidelineId} not found in relevant guidelines`);
    }

    // Find the full guideline data
    const guidelineData = window.globalGuidelines[guidelineId];
    if (!guidelineData) {
        throw new Error(`Guideline data not found for ${guidelineId}`);
    }

    // Get the display name using the helper function
    const displayName = getGuidelineDisplayName(guidelineId, targetGuideline, guidelineData);

    console.log(`[DEBUG] Processing guideline: ${displayName}`);

    // Update progress button
    updateAnalyseButtonProgress(`Processing Guideline ${stepNumber}/${totalSteps}`, true);

    const analyzeMessage = `Analysing against: ${displayName}`;
    updateUser(analyzeMessage, true);

    // Use practice point-based suggestions (fast path using pre-extracted auditable elements)
    window.latestAnalysis = {
        transcript: transcript,
        analysis: null,
        guidelineId: guidelineId,
        guidelineTitle: displayName
    };

    try {
        // Get and display practice point suggestions
        const result = await getPracticePointSuggestions(transcript, guidelineId);
        await displayPracticePointSuggestions(result);
    } catch (practicePointError) {
        console.error(`[DEBUG] Error with practice point suggestions for ${guidelineId}:`, practicePointError);

        // Fallback to original dynamicAdvice method if practice points fail
        console.log(`[DEBUG] Falling back to dynamicAdvice for ${guidelineId}`);
        try {
            const analysisToUse = `Clinical transcript analysis for guideline compliance check against: ${displayName}. ` +
                `This analysis focuses on identifying areas where the clinical documentation can be improved according to the specific guideline requirements.`;

            await dynamicAdvice(
                transcript,
                analysisToUse,
                guidelineId,
                displayName
            );
        } catch (dynamicError) {
            console.error(`[DEBUG] Fallback also failed for ${guidelineId}:`, dynamicError);
            const errorMessage = `⚠️ **Note:** Guideline suggestions generation failed for this guideline: ${dynamicError.message}\n\n`;
            appendToOutputField(errorMessage, true);
        }
    }

    console.log(`[DEBUG] Successfully processed guideline: ${guidelineId}`);
}

// Make the function globally accessible
// Make the function globally accessible
window.processSelectedGuidelines = processSelectedGuidelines;

// PARALLEL ANALYSIS FUNCTIONS

async function runParallelAnalysis(guidelines) {
    console.log('[DEBUG] Starting Parallel Analysis for', guidelines.length, 'guidelines');

    // Hide selection buttons if they exist
    if (typeof hideSelectionButtons === 'function') {
        hideSelectionButtons();
    }

    // Create a container for the aggregated results
    const containerId = 'parallel-analysis-results-' + Date.now();
    const resultsContainerHtml = `
        <div id="${containerId}" class="parallel-analysis-container" style="max-height: calc(100vh - 250px); overflow-y: auto; padding-right: 10px;">
            <div class="parallel-status" style="margin-bottom: 20px; padding: 15px; background: var(--bg-tertiary); border-radius: 8px; border: 1px solid var(--border-color); color: var(--text-primary);">
                <strong><i class="fas fa-layer-group"></i> Parallel Analysis in Progress</strong><br>
                <span id="${containerId}-status-text">Starting workers...</span>
                <div class="progress-bar-container" style="margin-top: 10px; background: var(--bg-input); height: 8px; border-radius: 4px; overflow: hidden;">
                    <div id="${containerId}-progress" style="width: 0%; height: 100%; background: #4caf50; transition: width 0.3s ease;"></div>
                </div>
            </div>
            <div id="${containerId}-output"></div>
        </div>
    `;
    appendToSummary1(resultsContainerHtml, false);

    const statusText = document.getElementById(`${containerId}-status-text`);
    const progressBar = document.getElementById(`${containerId}-progress`);
    const outputContainer = document.getElementById(`${containerId}-output`);

    let completedCount = 0;
    const total = guidelines.length;

    // Map guidelines to promises
    const analysisPromises = guidelines.map(async (guideline, index) => {
        try {
            // Get full data
            const guidelineData = window.globalGuidelines[guideline.id];
            const displayName = getGuidelineDisplayName(guideline.id, guideline, guidelineData);

            // Analyze
            const suggestions = await getPracticePointSuggestions(
                window.editors?.userInput?.getText() || getUserInputContent(),
                guideline.id
            );

            completedCount++;
            if (progressBar) progressBar.style.width = `${(completedCount / total) * 100}%`;
            if (statusText) statusText.textContent = `Analyzed ${completedCount} of ${total}: ${displayName}`;

            return {
                status: 'fulfilled',
                guidelineId: guideline.id,
                displayName: displayName,
                suggestions: suggestions,
                relevance: guideline.relevance || 0,
                originalIndex: index
            };
        } catch (error) {
            console.error(`[PARALLEL] Error analyzing ${guideline.id}:`, error);
            completedCount++;
            if (progressBar) progressBar.style.width = `${(completedCount / total) * 100}%`;

            return {
                status: 'rejected',
                guidelineId: guideline.id,
                error: error.message
            };
        }
    });

    // Wait for all
    const results = await Promise.all(analysisPromises);

    // Filter and Sort Results
    // Note: `r.suggestions` is the full result object from getPracticePointSuggestions
    // which has a `suggestions` array property inside it
    const successfulResults = results
        .filter(r => r.status === 'fulfilled' && r.suggestions && r.suggestions.suggestions && r.suggestions.suggestions.length > 0);

    // Flatten all suggestions from successful results
    let allSuggestions = [];

    // Priority mapping for sorting
    const priorityMap = {
        'critical': 4,
        'high': 3,
        'important': 2,
        'medium': 2,
        'low': 1,
        'info': 1
    };

    if (successfulResults.length > 0) {
        successfulResults.forEach(r => {
            if (r.suggestions && r.suggestions.suggestions) {
                r.suggestions.suggestions.forEach(s => {
                    // Add source guideline info to the suggestion object
                    s.sourceGuidelineName = r.displayName;
                    s.sourceGuidelineId = r.guidelineId;
                    allSuggestions.push(s);
                });
            }
        });

        // Sort suggestions by priority (Critical > High > Medium > Low)
        allSuggestions.sort((a, b) => {
            const pA = priorityMap[(a.type || a.priority || 'info').toLowerCase()] || 0;
            const pB = priorityMap[(b.type || b.priority || 'info').toLowerCase()] || 0;
            return pB - pA; // Descending order
        });
    }

    console.log(`[PARALLEL] Completed. ${successfulResults.length} successful analyses. Found ${allSuggestions.length} total suggestions.`);

    // Hide the selection interface now that we have results
    const selectionInterface = document.querySelector('.guideline-selection-interface');
    if (selectionInterface) {
        selectionInterface.style.display = 'none';
    }

    // Calculate priority counts for status message
    const priorityCounts = { 'High': 0, 'Medium': 0, 'Low': 0 };
    allSuggestions.forEach(s => {
        const type = (s.type || s.priority || 'info').toLowerCase();
        if (type === 'critical' || type === 'high') priorityCounts['High']++;
        else if (type === 'important' || type === 'medium') priorityCounts['Medium']++;
        else priorityCounts['Low']++;
    });

    // Generate simplified status message
    let statusParts = [];
    if (priorityCounts['High'] > 0) statusParts.push(`${priorityCounts['High']} High`);
    if (priorityCounts['Medium'] > 0) statusParts.push(`${priorityCounts['Medium']} Medium`);

    if (priorityCounts['Low'] > 0) statusParts.push(`${priorityCounts['Low']} Low`);

    let statusSummary = statusParts.length > 0
        ? statusParts.join(', ') + ' priority issues found'
        : 'No specific issues found';

    if (statusText) {
        statusText.innerHTML = `<strong>Analysis Complete</strong><br>${statusSummary}`;
        statusText.parentElement.style.background = 'var(--bg-tertiary)';
        statusText.parentElement.style.border = '1px solid var(--accent-color)';

        // Ephemeral message: Remove after 3 seconds to save vertical space
        setTimeout(() => {
            if (statusText.parentElement) {
                statusText.parentElement.style.transition = 'opacity 0.5s ease-out, height 0.5s ease-out, padding 0.5s ease-out, margin 0.5s ease-out';
                statusText.parentElement.style.opacity = '0';
                statusText.parentElement.style.height = '0';
                statusText.parentElement.style.padding = '0';
                statusText.parentElement.style.margin = '0';
                statusText.parentElement.style.overflow = 'hidden';

                // Remove from DOM after transition
                setTimeout(() => {
                    if (statusText.parentElement) statusText.parentElement.remove();
                }, 500);
            }
        }, 3000);
    }

    // Display Aggregated Results (Flat List)
    if (allSuggestions.length === 0) {
        outputContainer.innerHTML = '<div class="alert alert-info">Analysis complete, but no specific suggestions were found for the provided clinical text based on these guidelines.</div>';
    } else {
        // Clear container
        outputContainer.innerHTML = '';

        // Create a single container for the flat list
        const suggestionsList = document.createElement('div');
        suggestionsList.className = 'suggestions-flat-list';

        // Add Title

        // Group suggestions by priority
        const groupedSuggestions = {
            high: [],
            medium: [],
            low: []
        };

        allSuggestions.forEach((suggestion, index) => {
            const priority = (suggestion.type || suggestion.priority || 'info').toLowerCase();
            const suggestionItem = { ...suggestion, originalIndex: index }; // Keep track of original index if needed for IDs

            if (priority === 'critical' || priority === 'high') {
                groupedSuggestions.high.push(suggestionItem);
            } else if (priority === 'important' || priority === 'medium') {
                groupedSuggestions.medium.push(suggestionItem);
            } else {
                groupedSuggestions.low.push(suggestionItem);
            }
        });

        // Add Title with stats
        const titleParts = [];
        if (groupedSuggestions.high.length > 0) titleParts.push(`${groupedSuggestions.high.length} High Priority`);
        if (groupedSuggestions.medium.length > 0) titleParts.push(`${groupedSuggestions.medium.length} Medium Priority`);
        if (groupedSuggestions.low.length > 0) titleParts.push(`${groupedSuggestions.low.length} Low Priority`);

        const titleText = `Clinical Suggestions: ${titleParts.join(' and ')}`;
        const titleHtml = `<h3 style="margin: 20px 0 15px 0; color: var(--text-primary); font-size: 1.1em; border-bottom: 2px solid var(--accent-color); padding-bottom: 8px; display: inline-block;">${titleText}</h3>`;

        // Function to render a list of suggestions
        const renderSuggestionList = (suggestions, priorityLabel) => {
            if (suggestions.length === 0) return '';

            const sectionHeader = `<h4 style="margin: 15px 0 10px 0; font-size: 1em; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.5px;">${priorityLabel}</h4>`;

            const cardsHtml = suggestions.map((suggestion) => {
                // Safely access suggestion properties with fallbacks
                const suggestionText = suggestion.suggestion || suggestion.recommendation || suggestion.name || suggestion.issue || suggestion.text || 'No text available';
                const suggestionType = suggestion.type || suggestion.priority || 'info';
                // Use 'why' field if available, fallback to notCoveredBy or reasoning/rationale
                const suggestionReasoning = suggestion.why || suggestion.notCoveredBy || suggestion.reasoning || suggestion.rationale || suggestion.source || 'Based on guideline recommendations';
                const sourceName = suggestion.sourceGuidelineName || 'Unknown Guideline';

                // Create a unique ID for this suggestion card
                // Use random number to ensure uniqueness even if re-rendered
                const uniqueId = Math.floor(Math.random() * 100000);
                const suggestionId = `suggestion-${Date.now()}-${uniqueId}`;

                // Store text in a data attribute for easy access (escaped)
                const escapedText = suggestionText.replace(/"/g, '&quot;');

                return `
                <div id="${suggestionId}" class="suggestion-card" data-original-text="${escapedText}" style="background: var(--bg-secondary); border: 1px solid var(--border-color); border-radius: 6px; padding: 15px; margin-bottom: 15px; box-shadow: 0 2px 4px rgba(0,0,0,0.05); transition: all 0.3s ease;">
                    <div class="suggestion-header" style="display: flex; justify-content: flex-end; align-items: flex-start; margin-bottom: 10px;">
                        <span style="font-size: 0.8em; color: var(--text-secondary); max-width: 100%; text-align: right; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${sourceName}">
                           Guideline: ${sourceName}
                        </span>
                    </div>
                    
                    <div id="${suggestionId}-content" class="suggestion-content">
                        <p id="${suggestionId}-text" style="margin: 0 0 10px 0;"><strong>Suggestion:</strong> <span class="text-content">${suggestionText}</span></p>
                        <p style="margin: 0; color: var(--text-secondary); font-size: 0.9em;"><strong>Why:</strong> ${suggestionReasoning}</p>
                    </div>
                    
                    <div id="${suggestionId}-edit-mode" class="suggestion-edit-mode" style="display: none; margin-bottom: 10px;">
                        <textarea id="${suggestionId}-editor" class="form-control" style="width: 100%; min-height: 80px; margin-bottom: 10px; padding: 8px; border-radius: 4px; border: 1px solid var(--border-color); background: var(--bg-input); color: var(--text-primary);">${suggestionText}</textarea>
                        <div style="display: flex; gap: 10px;">
                            <button class="btn-sm btn-success" onclick="saveModifiedSuggestion('${suggestionId}')">Save</button>
                            <button class="btn-sm btn-secondary" onclick="cancelModification('${suggestionId}')">Cancel</button>
                        </div>
                    </div>

                     <div id="${suggestionId}-actions" class="suggestion-actions" style="margin-top: 10px; padding-top: 10px; border-top: 1px dashed var(--border-light); display: flex; gap: 8px; flex-wrap: wrap;">
                        <button class="btn-xs btn-success" style="color: white; border: none; padding: 5px 10px; border-radius: 4px; cursor: pointer; background-color: #28a745;" onclick="acceptParallelSuggestion('${suggestionId}')">
                            <i class="fas fa-check"></i> Accept
                        </button>
                        <button class="btn-xs btn-warning" style="color: #212529; border: none; padding: 5px 10px; border-radius: 4px; cursor: pointer; background-color: #ffc107;" onclick="modifyParallelSuggestion('${suggestionId}')">
                            <i class="fas fa-edit"></i> Modify
                        </button>
                        <button class="btn-xs btn-danger" style="color: white; border: none; padding: 5px 10px; border-radius: 4px; cursor: pointer; background-color: #dc3545;" onclick="rejectParallelSuggestion('${suggestionId}')">
                            <i class="fas fa-times"></i> Reject
                        </button>
                    </div>
                </div>
            `;
            }).join('');

            return sectionHeader + cardsHtml;
        };

        let suggestionsHtml = '';
        if (groupedSuggestions.high.length > 0) suggestionsHtml += renderSuggestionList(groupedSuggestions.high, 'High Priority');
        if (groupedSuggestions.medium.length > 0) suggestionsHtml += renderSuggestionList(groupedSuggestions.medium, 'Medium Priority');
        if (groupedSuggestions.low.length > 0) suggestionsHtml += renderSuggestionList(groupedSuggestions.low, 'Low Priority');


        // Global handlers for Parallel Analysis Suggestion interactivity

        window.acceptParallelSuggestion = function (suggestionId) {
            const card = document.getElementById(suggestionId);
            if (!card) return;

            // Get the text to accept (check if it was modified or use original)
            // We can grab it directly from the DOM to get the most current version
            const textElement = card.querySelector('.text-content');
            const textToInsert = textElement ? textElement.textContent : '';

            if (!textToInsert) return;

            // Use the global editor instance to insert text
            if (window.editors && window.editors.userInput) {
                // Add a newline before if needed, or just insert block
                // TipTap insertContent handles block nodes well
                window.editors.userInput.commands.insertContent(`\n${textToInsert}`);

                // Visual feedback
                card.style.borderColor = '#28a745';
                card.style.backgroundColor = 'rgba(40, 167, 69, 0.1)';

                const actionsDiv = document.getElementById(`${suggestionId}-actions`);
                if (actionsDiv) {
                    actionsDiv.innerHTML = `<span style="color: #28a745; font-weight: bold;"><i class="fas fa-check-circle"></i> Accepted</span>`;
                }

                // Optional: Fade out and remove after a delay? 
                // User might want to keep record, so just marking as accepted is better.
                // But to declutter, we could shrink it. Let's just mark it for now.
            } else {
                console.warn('Editor not found, cannot insert suggestion');
                alert('Could not find the editor to insert text.');
            }
        };

        window.rejectParallelSuggestion = function (suggestionId) {
            const card = document.getElementById(suggestionId);
            if (!card) return;

            // Visual feedback - slide up and remove
            card.style.opacity = '0';
            card.style.transform = 'translateY(-10px)';

            setTimeout(() => {
                card.remove();

                // interactions to check if any suggestions remain?
                // For now just removing it is sufficient
            }, 300);
        };

        window.modifyParallelSuggestion = function (suggestionId) {
            const contentDiv = document.getElementById(`${suggestionId}-content`);
            const editModeDiv = document.getElementById(`${suggestionId}-edit-mode`);
            const actionsDiv = document.getElementById(`${suggestionId}-actions`);

            if (contentDiv && editModeDiv && actionsDiv) {
                contentDiv.style.display = 'none';
                actionsDiv.style.display = 'none';
                editModeDiv.style.display = 'block';

                // Focus the textarea
                const textarea = document.getElementById(`${suggestionId}-editor`);
                if (textarea) textarea.focus();
            }
        };

        window.saveModifiedSuggestion = function (suggestionId) {
            const textarea = document.getElementById(`${suggestionId}-editor`);
            const textSpan = document.querySelector(`#${suggestionId} .text-content`);
            const contentDiv = document.getElementById(`${suggestionId}-content`);
            const editModeDiv = document.getElementById(`${suggestionId}-edit-mode`);
            const actionsDiv = document.getElementById(`${suggestionId}-actions`);

            if (textarea && textSpan) {
                textSpan.textContent = textarea.value;
            }

            if (contentDiv && editModeDiv && actionsDiv) {
                contentDiv.style.display = 'block';
                actionsDiv.style.display = 'flex';
                editModeDiv.style.display = 'none';
            }
        };

        window.cancelModification = function (suggestionId) {
            const contentDiv = document.getElementById(`${suggestionId}-content`);
            const editModeDiv = document.getElementById(`${suggestionId}-edit-mode`);
            const actionsDiv = document.getElementById(`${suggestionId}-actions`);
            // Reset textarea to current text content? Or original? 
            // Usually Cancel means "discard changes in textarea".

            // Reset textarea to matches what is currently in textSpan (which is the last saved state)
            const textarea = document.getElementById(`${suggestionId}-editor`);
            const textSpan = document.querySelector(`#${suggestionId} .text-content`);
            if (textarea && textSpan) {
                textarea.value = textSpan.textContent;
            }

            if (contentDiv && editModeDiv && actionsDiv) {
                contentDiv.style.display = 'block';
                actionsDiv.style.display = 'flex';
                editModeDiv.style.display = 'none';
            }
        };

        suggestionsList.innerHTML = titleHtml + suggestionsHtml;
        outputContainer.appendChild(suggestionsList);
    }
}

// Helper functions for sequential processing error handling
window.retryCurrentGuideline = async function () {
    if (!window.sequentialProcessingActive) return;

    const queue = window.sequentialProcessingQueue || [];
    const currentIndex = window.sequentialProcessingIndex || 0;
    const guidelineId = queue[currentIndex];
    const stepNumber = currentIndex + 1;

    console.log('[DEBUG] Retrying current guideline:', guidelineId);

    const retryMessage = `**🔄 Retrying Guideline ${stepNumber}...**\n\n`;
    appendToOutputField(retryMessage, true);

    try {
        await processSingleGuideline(guidelineId, stepNumber, queue.length);
    } catch (error) {
        console.error('[DEBUG] Retry failed:', error);
        const failMessage = `❌ **Retry failed:** ${error.message}\n\nYou can try again or skip this guideline.\n\n`;
        appendToOutputField(failMessage, true);
    }
};

window.skipCurrentGuideline = function () {
    if (!window.sequentialProcessingActive) return;

    const queue = window.sequentialProcessingQueue || [];
    const currentIndex = window.sequentialProcessingIndex || 0;
    const stepNumber = currentIndex + 1;

    console.log('[DEBUG] Skipping current guideline');

    const skipMessage = `**⏭️ Skipped Guideline ${stepNumber}**\n\n`;
    appendToOutputField(skipMessage, true);

    // Move to next guideline or complete sequence
    if (currentIndex < queue.length - 1) {
        window.sequentialProcessingIndex = currentIndex + 1;
        const nextGuidelineId = queue[currentIndex + 1];
        const nextStepNumber = currentIndex + 2;

        setTimeout(async () => {
            try {
                const processingStepMessage = `Processing guideline ${nextStepNumber}/${queue.length}...`;
                updateUser(processingStepMessage, true);
                await processSingleGuideline(nextGuidelineId, nextStepNumber, queue.length);
            } catch (error) {
                console.error('[DEBUG] Error processing next guideline after skip:', error);
            }
        }, 500);
    } else {
        // All done
        window.sequentialProcessingActive = false;
        const finalMessage = `Sequential processing complete: processed ${currentIndex + 1} of ${queue.length} guidelines (${queue.length - currentIndex - 1} skipped).`;
        updateUser(finalMessage, false);
    }
};

// Generate guideline suggestions for multiple selected guidelines
async function generateMultiGuidelineAdvice() {
    // console.log('[DEBUG] generateMultiGuidelineAdvice called');

    // Get selected guidelines
    const selectedCheckboxes = document.querySelectorAll('.guideline-checkbox:checked');
    const selectedGuidelineIds = Array.from(selectedCheckboxes).map(cb => cb.dataset.guidelineId);

    if (selectedGuidelineIds.length === 0) {
        alert('Please select at least one guideline to generate advice.');
        return;
    }

    console.log('🔄 Processing', selectedGuidelineIds.length, 'selected guidelines');

    // Update UI to show loading state
    const generateBtn = document.querySelector('.generate-advice-btn');
    const btnText = generateBtn.querySelector('.btn-text');
    const btnSpinner = generateBtn.querySelector('.btn-spinner');
    const btnIcon = generateBtn.querySelector('.btn-icon');

    const originalText = btnText.textContent;
    btnText.textContent = 'Processing Guidelines...';
    btnIcon.style.display = 'none';
    btnSpinner.style.display = 'inline';
    generateBtn.disabled = true;

    try {
        // Get the selected guidelines data
        const selectedGuidelines = selectedGuidelineIds.map(id => {
            const relevantGuideline = window.relevantGuidelines.find(g => g.id === id);
            const guidelineData = window.globalGuidelines[id];
            const displayTitle = guidelineData?.humanFriendlyTitle || guidelineData?.title || relevantGuideline?.title || id;

            return {
                id: id,
                title: displayTitle,
                relevance: relevantGuideline?.relevance || 'N/A',
                data: guidelineData
            };
        });

        console.log('📋 Selected guidelines:', selectedGuidelines.map(g => g.title));

        // Validate essential data
        if (!window.latestAnalysis || !window.latestAnalysis.transcript) {
            throw new Error('No clinical transcript available. Please enter a transcript first.');
        }

        // Add progress message
        const progressHtml = `
            <div class="multi-guideline-progress">
                <h3>🔄 Processing Multiple Guidelines</h3>
                <p>Generating guideline suggestions from ${selectedGuidelines.length} selected guideline${selectedGuidelines.length > 1 ? 's' : ''}...</p>
                <div class="processing-list">
                    ${selectedGuidelines.map(g => `
                        <div class="processing-item" data-guideline-id="${g.id}">
                            <span class="processing-status">⏳</span>
                            <span class="processing-title">${g.title}</span>
                        </div>
                    `).join('')}
                </div>
                <p><em>Guidelines are being processed in parallel for faster results.</em></p>
            </div>
            
            <style>
            .multi-guideline-progress {
                background: #e3f2fd;
                border: 1px solid #2196f3;
                border-radius: 8px;
                padding: 20px;
                margin: 20px 0;
            }
            
            .multi-guideline-progress h3 {
                margin: 0 0 10px 0;
                color: #1976d2;
            }
            
            .processing-list {
                margin: 15px 0;
            }
            
            .processing-item {
                display: flex;
                align-items: center;
                gap: 10px;
                padding: 5px 0;
                color: #1976d2;
            }
            
            .processing-status {
                width: 20px;
                text-align: center;
            }
            </style>
        `;

        appendToOutputField(progressHtml, true);

        // Call the multi-guideline guideline suggestions function
        await multiGuidelineDynamicAdvice(selectedGuidelines);

    } catch (error) {
        console.error('❌ Error in generateMultiGuidelineAdvice:', error);

        const errorHtml = `
            <div class="multi-guideline-error">
                <h3>❌ Error Processing Guidelines</h3>
                <p><strong>Error:</strong> ${error.message}</p>
                <p>Please try again or select fewer guidelines.</p>
            </div>
        `;

        appendToOutputField(errorHtml, true);
        alert(`Error generating multi-guideline advice: ${error.message}`);

    } finally {
        // Reset button state
        btnText.textContent = originalText;
        btnIcon.style.display = 'inline';
        btnSpinner.style.display = 'none';
        generateBtn.disabled = false;
    }
}

// Multi-guideline guideline suggestions - processes multiple guidelines in parallel
async function multiGuidelineDynamicAdvice(selectedGuidelines) {
    console.log('🔄 Processing', selectedGuidelines.length, 'guidelines in parallel...');

    try {
        // Get user ID token
        const user = auth.currentUser;
        if (!user) {
            throw new Error('User not authenticated');
        }

        const idToken = await user.getIdToken();

        // Validate essential data again
        if (!window.latestAnalysis || !window.latestAnalysis.transcript || !window.latestAnalysis.analysis) {
            throw new Error('Essential data missing. Please ensure you have entered a transcript and it has been analyzed.');
        }

        // Update processing status for each guideline
        const updateProcessingStatus = (guidelineId, status, emoji = '⏳') => {
            const statusElement = document.querySelector(`[data-guideline-id="${guidelineId}"] .processing-status`);
            if (statusElement) {
                statusElement.textContent = emoji;
                // console.log(`Updated status for ${guidelineId}: ${status}`);
            }
        };

        // Process all guidelines in parallel with proper error handling
        console.log('⚡ Starting parallel processing...');

        const guidelinePromises = selectedGuidelines.map(async (guideline, index) => {
            try {
                updateProcessingStatus(guideline.id, 'processing', '🔄');

                console.log(`📋 Processing ${index + 1}/${selectedGuidelines.length}: ${guideline.title}`);

                // Validate individual guideline data
                if (!guideline.id || !guideline.title) {
                    throw new Error(`Invalid guideline data for ${guideline.title || 'unknown guideline'}`);
                }

                // Call the dynamicAdvice API for this specific guideline
                const response = await fetch(`${window.SERVER_URL}/dynamicAdvice`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${idToken}`
                    },
                    body: JSON.stringify({
                        transcript: window.latestAnalysis.transcript,
                        analysis: window.latestAnalysis.analysis,
                        guidelineId: guideline.id,
                        guidelineTitle: guideline.title
                    })
                });

                if (!response.ok) {
                    const errorText = await response.text();
                    throw new Error(`API error (${response.status}): ${errorText}`);
                }

                const result = await response.json();

                if (!result.success) {
                    throw new Error(result.error || 'Guideline suggestions generation failed');
                }

                updateProcessingStatus(guideline.id, 'completed', '✅');

                console.log(`✅ Completed: ${guideline.title} (${result.suggestions?.length || 0} suggestions)`);

                return {
                    guideline: guideline,
                    result: result,
                    success: true
                };

            } catch (error) {
                console.error(`❌ Error processing ${guideline.title}:`, error.message);
                updateProcessingStatus(guideline.id, 'error', '❌');

                return {
                    guideline: guideline,
                    error: error.message,
                    success: false
                };
            }
        });

        // Wait for all guidelines to be processed
        console.log('⏳ Waiting for all processing to complete...');
        const results = await Promise.allSettled(guidelinePromises);

        // Process results from Promise.allSettled
        const processedResults = results.map(result => {
            if (result.status === 'fulfilled') {
                return result.value;
            } else {
                // Handle rejected promises
                console.error('Promise rejected:', result.reason);
                return {
                    guideline: { title: 'Unknown', id: 'unknown' },
                    error: result.reason?.message || 'Promise rejected',
                    success: false
                };
            }
        });

        // Separate successful and failed results
        const successfulResults = processedResults.filter(r => r.success);
        const failedResults = processedResults.filter(r => !r.success);

        console.log('📊 Processing completed:', {
            total: processedResults.length,
            successful: successfulResults.length,
            failed: failedResults.length
        });

        // Update progress completion
        const progressContainer = document.querySelector('.multi-guideline-progress');
        if (progressContainer) {
            const completionHtml = `
                <div class="processing-completion">
                    <p><strong>Processing Complete!</strong></p>
                    <p>✅ Successfully processed: ${successfulResults.length} guideline${successfulResults.length !== 1 ? 's' : ''}</p>
                    ${failedResults.length > 0 ? `<p>❌ Failed: ${failedResults.length} guideline${failedResults.length !== 1 ? 's' : ''}</p>` : ''}
                </div>
            `;
            progressContainer.innerHTML += completionHtml;
        }

        if (successfulResults.length === 0) {
            throw new Error('No guidelines were successfully processed. Please check the error messages above and try again.');
        }

        // Combine and display all suggestions from successful results
        await displayCombinedSuggestions(successfulResults, failedResults);

        // Store session data globally (using the first successful result as base)
        const firstResult = successfulResults[0].result;
        currentAdviceSession = firstResult.sessionId;
        currentSuggestions = []; // Will be populated with combined suggestions
        userDecisions = {};

        console.log('✅ Multi-guideline guideline suggestions completed successfully');

    } catch (error) {
        console.error('❌ Error in multiGuidelineDynamicAdvice:', error);

        const errorHtml = `
            <div class="multi-guideline-error">
                <h3>❌ Error Processing Multiple Guidelines</h3>
                <p><strong>Error:</strong> ${error.message}</p>
                <p>Please try again or contact support if the problem persists.</p>
            </div>
        `;
        appendToOutputField(errorHtml, true);

        throw error;
    }
}

// Display combined suggestions from multiple guidelines
async function displayCombinedSuggestions(successfulResults, failedResults) {
    console.log('📋 Combining suggestions from', successfulResults.length, 'successful guidelines');

    // Validate input
    if (!successfulResults || !Array.isArray(successfulResults)) {
        throw new Error('Invalid successful results provided to displayCombinedSuggestions');
    }

    // Combine all suggestions from successful results
    let allSuggestions = [];
    let suggestionCounter = 1;

    successfulResults.forEach((result, index) => {
        if (!result || !result.result) {
            console.warn(`⚠️ Invalid result at index ${index}, skipping`);
            return;
        }

        const suggestions = result.result.suggestions || [];
        suggestions.forEach(suggestion => {
            // Validate suggestion structure
            if (!suggestion || typeof suggestion !== 'object') {
                console.warn(`⚠️ Invalid suggestion in ${result.guideline?.title || 'unknown guideline'}, skipping`);
                return;
            }

            // Add guideline source information and renumber
            allSuggestions.push({
                ...suggestion,
                id: `multi_${suggestionCounter++}`,
                sourceGuideline: result.guideline?.title || 'Unknown Guideline',
                sourceGuidelineId: result.guideline?.id || 'unknown',
                sourceGuidelineFilename: result.result?.guidelineFilename || null,
                originalId: suggestion.id
            });
        });
    });

    console.log('💡 Combined', allSuggestions.length, 'suggestions from', successfulResults.length, 'guidelines');

    // Group suggestions by priority and category for better organization
    const priorityOrder = { 'high': 1, 'medium': 2, 'low': 3 };
    allSuggestions.sort((a, b) => {
        const priorityA = priorityOrder[a.priority] || 2;
        const priorityB = priorityOrder[b.priority] || 2;
        return priorityA - priorityB;
    });

    // Create the combined suggestions header
    let combinedHtml = `
        <div class="combined-advice-container">
            <div class="combined-header">
                <h3>💡 Combined Interactive Suggestions</h3>
                <div class="combined-stats">
                    <p>Generated from <strong>${successfulResults.length}</strong> guideline${successfulResults.length > 1 ? 's' : ''} with <strong>${allSuggestions.length}</strong> total recommendation${allSuggestions.length !== 1 ? 's' : ''}</p>
                    <div class="source-guidelines">
                        <strong>Source Guidelines:</strong>
                        <ul>
                            ${successfulResults.map(r => `
                                <li>
                                    <span class="guideline-name">${r.guideline.title}</span>
                                    <span class="suggestion-count">(${r.result.suggestions?.length || 0} suggestions)</span>
                                </li>
                            `).join('')}
                        </ul>
                    </div>
                </div>
                ${failedResults.length > 0 ? `
                    <div class="failed-guidelines">
                        <p><strong>⚠️ Note:</strong> ${failedResults.length} guideline${failedResults.length > 1 ? 's' : ''} failed to process:</p>
                        <ul>
                            ${failedResults.map(r => `
                                <li>${r.guideline.title} - ${r.error}</li>
                            `).join('')}
                        </ul>
                    </div>
                ` : ''}
                <p class="advice-instructions">Review each suggestion below. You can <strong>Accept</strong>, <strong>Reject</strong>, or <strong>Modify</strong> the proposed changes. Suggestions are sorted by priority.</p>
            </div>
            <div class="suggestions-list">
    `;

    if (allSuggestions.length === 0) {
        combinedHtml += `
                <div class="no-suggestions">
                    <p>No specific suggestions were generated from the processed guidelines.</p>
                    <p>This may indicate that the clinical documentation already aligns well with the guideline recommendations.</p>
                </div>
        `;
    } else {
        // Add each combined suggestion
        allSuggestions.forEach((suggestion, index) => {
            const priorityClass = `priority-${suggestion.priority || 'medium'}`;
            const categoryIcon = getCategoryIcon(suggestion.category);

            combinedHtml += `
                <div class="suggestion-item ${priorityClass}" data-suggestion-id="${suggestion.id}">
                    <div class="suggestion-header">
                        <div class="suggestion-info">
                            <span class="category-icon">${categoryIcon}</span>
                            <span class="suggestion-id">#${index + 1}</span>
                            <span class="priority-badge ${priorityClass}">${suggestion.priority || 'medium'}</span>
                            <span class="source-guideline">from ${suggestion.sourceGuideline}</span>
                        </div>
                        <div class="guideline-ref">${suggestion.guidelineReference || ''}</div>
                    </div>
                    
                    <div class="suggestion-content">
                        ${suggestion.originalText ? `
                            <div class="original-text">
                                <label>${getOriginalTextLabel(suggestion.originalText, suggestion.category)}</label>
                                <div class="text-preview ${suggestion.category === 'addition' ? 'missing-element' : ''}">"${suggestion.originalText}"</div>
                            </div>
                        ` : ''}
                        
                        <div class="suggested-text">
                            <label>Suggested ${suggestion.category || 'change'}:</label>
                            <div class="text-preview suggested">"${suggestion.suggestedText}"</div>
                        </div>
                        
                        <div class="suggestion-context">
                            <label>Why this change is suggested:</label>
                            <p>${suggestion.context}</p>
                        </div>
                        
                        <div class="guideline-link-section" style="margin-top: 10px; padding: 10px; background: var(--bg-tertiary); border-radius: 4px; border-left: 3px solid #0ea5e9;">
                            <label style="font-weight: bold;">Guideline:</label>
                            ${createGuidelineViewerLink(suggestion.sourceGuidelineId, suggestion.sourceGuideline, suggestion.sourceGuidelineFilename, suggestion.context, suggestion.hasVerbatimQuote, suggestion.suggestedText)}
                        </div>
                    </div>
                    
                    <div class="suggestion-actions">
                        <button class="action-btn accept-btn" onclick="handleSuggestionAction('${suggestion.id}', 'accept')">
                            ✅ Accept
                        </button>
                        <button class="action-btn reject-btn" onclick="handleSuggestionAction('${suggestion.id}', 'reject')">
                            ❌ Reject
                        </button>
                        <button class="action-btn modify-btn" onclick="handleSuggestionAction('${suggestion.id}', 'modify')">
                            ✏️ Modify
                        </button>
                    </div>
                    
                    <div class="modify-section" id="modify-${suggestion.id}" style="display: none;">
                        <label for="modify-text-${suggestion.id}">Your modified text:</label>
                        <textarea id="modify-text-${suggestion.id}" class="modify-textarea" 
                                  placeholder="Enter your custom text here...">${suggestion.suggestedText}</textarea>
                        <div class="modify-actions">
                            <button class="action-btn confirm-btn" onclick="confirmModification('${suggestion.id}')">
                                ✅ Confirm Modification
                            </button>
                            <button class="action-btn cancel-btn" onclick="cancelModification('${suggestion.id}')">
                                ❌ Cancel
                            </button>
                        </div>
                    </div>
                    
                    <div class="suggestion-status" id="status-${suggestion.id}" style="display: none;">
                        <!-- Status will be updated by JavaScript -->
                    </div>
                </div>
            `;
        });
    }

    combinedHtml += `
            </div>
            
            ${allSuggestions.length > 0 ? `
                <div class="combined-actions">
                    <div class="bulk-actions">
                        <h4>Bulk Actions</h4>
                        <div class="bulk-buttons">
                            <button class="action-btn bulk-accept-btn" onclick="bulkAcceptSuggestions('high')">
                                ✅ Accept All High Priority
                            </button>
                            <button class="action-btn bulk-accept-btn" onclick="bulkAcceptSuggestions('all')">
                                ✅ Accept All Suggestions
                            </button>
                            <button class="action-btn bulk-reject-btn" onclick="bulkRejectSuggestions('all')">
                                ❌ Reject All Suggestions
                            </button>
                        </div>
                    </div>
                    
                    <div class="final-actions">
                        <h4>Final Actions</h4>
                        <div class="decision-summary" id="decisionsSummary">
                            <p>Make your decisions above, then apply changes to your transcript.</p>
                        </div>
                        <div class="final-buttons">
                            <button class="action-btn primary apply-btn" onclick="applyAllDecisions()">
                                🚀 Apply All Decisions
                            </button>
                            <button class="action-btn secondary copy-btn" onclick="copyUpdatedTranscript()">
                                📋 Copy Updated Transcript
                            </button>
                        </div>
                    </div>
                </div>
            ` : ''}
        </div>
        
        <style>
        .combined-advice-container {
            background: #f8f9fa;
            border: 2px solid #007bff;
            border-radius: 8px;
            padding: 20px;
            margin: 20px 0;
        }
        
        .combined-header h3 {
            margin: 0 0 15px 0;
            color: #007bff;
            font-size: 1.3em;
        }
        
        .combined-stats {
            background: #e3f2fd;
            padding: 15px;
            border-radius: 6px;
            margin-bottom: 15px;
        }
        
        .combined-stats p {
            margin: 0 0 10px 0;
            font-weight: 500;
            color: #1976d2;
        }
        
        .source-guidelines ul {
            margin: 10px 0 0 0;
            padding-left: 20px;
        }
        
        .source-guidelines li {
            margin-bottom: 5px;
            color: #1976d2;
        }
        
        .guideline-name {
            font-weight: 500;
        }
        
        .suggestion-count {
            color: #666;
            font-size: 0.9em;
        }
        
        .failed-guidelines {
            background: #fff3cd;
            border: 1px solid #ffc107;
            border-radius: 4px;
            padding: 10px;
            margin-bottom: 15px;
        }
        
        .failed-guidelines p {
            margin: 0 0 5px 0;
            color: #856404;
            font-weight: 500;
        }
        
        .failed-guidelines ul {
            margin: 5px 0 0 0;
            padding-left: 20px;
            color: #856404;
        }
        
        .source-guideline {
            background: #e3f2fd;
            color: #1976d2;
            padding: 2px 6px;
            border-radius: 3px;
            font-size: 0.8em;
            font-weight: 500;
        }
        
        .combined-actions {
            margin-top: 30px;
            padding-top: 20px;
            border-top: 2px solid #dee2e6;
        }
        
        .bulk-actions, .final-actions {
            margin-bottom: 20px;
        }
        
        .bulk-actions h4, .final-actions h4 {
            margin: 0 0 10px 0;
            color: #495057;
        }
        
        .bulk-buttons, .final-buttons {
            display: flex;
            gap: 10px;
            flex-wrap: wrap;
        }
        
        .bulk-accept-btn {
            background: #28a745;
            color: white;
        }
        
        .bulk-reject-btn {
            background: #dc3545;
            color: white;
        }
        
        .decision-summary {
            background: #fff;
            border: 1px solid #dee2e6;
            border-radius: 4px;
            padding: 10px;
            margin-bottom: 10px;
            min-height: 40px;
        }
        
        .no-suggestions {
            text-align: center;
            padding: 40px 20px;
            color: #6c757d;
        }
        
        .no-suggestions p {
            margin-bottom: 10px;
        }
        </style>
    `;

    try {
        // Display the combined suggestions
        appendToOutputField(combinedHtml, false);

        // Update global suggestions for existing functionality
        currentSuggestions = allSuggestions;

        console.log('✅ Combined suggestions displayed successfully');

    } catch (error) {
        console.error('❌ Error displaying combined suggestions:', error);

        const errorHtml = `
            <div class="display-error">
                <h3>❌ Error Displaying Suggestions</h3>
                <p><strong>Error:</strong> ${error.message}</p>
                <p>Please try refreshing the page or contact support if the problem persists.</p>
            </div>
        `;

        appendToOutputField(errorHtml, false);
        throw error;
    }
}

// Bulk accept suggestions based on priority filter
function bulkAcceptSuggestions(priorityFilter) {
    console.log('📋 Bulk accepting suggestions with filter:', priorityFilter);

    const suggestions = document.querySelectorAll('.suggestion-item');
    let actionCount = 0;

    suggestions.forEach(suggestionElement => {
        const suggestionId = suggestionElement.dataset.suggestionId;

        // Check if this suggestion matches the filter
        let shouldAccept = false;
        if (priorityFilter === 'all') {
            shouldAccept = true;
        } else if (priorityFilter === 'high') {
            const priorityBadge = suggestionElement.querySelector('.priority-badge');
            shouldAccept = priorityBadge && priorityBadge.textContent.trim() === 'high';
        }

        if (shouldAccept) {
            // Skip if already processed
            const statusElement = suggestionElement.querySelector(`#status-${suggestionId}`);
            if (statusElement && statusElement.style.display !== 'none') {
                return; // Already processed
            }

            handleSuggestionAction(suggestionId, 'accept');
            actionCount++;
        }
    });

    console.log(`✅ Bulk accepted ${actionCount} suggestions with filter: ${priorityFilter}`);

    // Update decisions summary
    setTimeout(() => {
        updateDecisionsSummary();
    }, 100);
}

// Bulk reject suggestions
function bulkRejectSuggestions(priorityFilter) {
    console.log('📋 Bulk rejecting suggestions with filter:', priorityFilter);

    const suggestions = document.querySelectorAll('.suggestion-item');
    let actionCount = 0;

    suggestions.forEach(suggestionElement => {
        const suggestionId = suggestionElement.dataset.suggestionId;

        // Check if this suggestion matches the filter
        let shouldReject = false;
        if (priorityFilter === 'all') {
            shouldReject = true;
        } else if (priorityFilter === 'high') {
            const priorityBadge = suggestionElement.querySelector('.priority-badge');
            shouldReject = priorityBadge && priorityBadge.textContent.trim() === 'high';
        }

        if (shouldReject) {
            // Skip if already processed
            const statusElement = suggestionElement.querySelector(`#status-${suggestionId}`);
            if (statusElement && statusElement.style.display !== 'none') {
                return; // Already processed
            }

            handleSuggestionAction(suggestionId, 'reject');
            actionCount++;
        }
    });

    console.log(`✅ Bulk rejected ${actionCount} suggestions with filter: ${priorityFilter}`);

    // Update decisions summary
    setTimeout(() => {
        updateDecisionsSummary();
    }, 100);
}

// Automatically generate combined interactive suggestions from multiple analysis results
async function generateCombinedInteractiveSuggestions(analysisResults) {
    console.log('🔄 Generating combined suggestions from', analysisResults.length, 'analysis results');

    try {
        // Get user ID token
        const user = auth.currentUser;
        if (!user) {
            throw new Error('User not authenticated');
        }

        const idToken = await user.getIdToken();

        // Prepare analysis data for each guideline
        const guidelineAnalyses = analysisResults.map(result => ({
            guidelineId: result.guideline,
            guidelineTitle: result.guidelineTitle || result.guideline,
            analysis: result.analysis
        }));

        console.log('📡 Sending multiple analyses to API...');

        // Send all analyses to the guideline suggestions API
        const response = await fetch(`${window.SERVER_URL}/multiGuidelineDynamicAdvice`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${idToken}`
            },
            body: JSON.stringify({
                transcript: window.latestAnalysis.transcript,
                guidelineAnalyses: guidelineAnalyses
            })
        });

        console.log('📡 API response status:', response.status);

        if (!response.ok) {
            const errorText = await response.text();
            console.error('❌ Multi-guideline API error:', errorText);
            throw new Error(`API error: ${response.status} - ${errorText}`);
        }

        const result = await response.json();
        console.log('✅ API result received:', {
            success: result.success,
            sessionId: result.sessionId,
            totalSuggestions: result.combinedSuggestions?.length
        });

        if (!result.success) {
            throw new Error(result.error || 'Multi-guideline guideline suggestions generation failed');
        }

        // Store session data globally
        currentAdviceSession = result.sessionId;
        currentSuggestions = result.combinedSuggestions || [];
        userDecisions = {};

        // Display combined suggestions
        await displayCombinedInteractiveSuggestions(result.combinedSuggestions, result.guidelinesSummary);

        return result;

    } catch (error) {
        console.error('❌ Error generating combined suggestions:', error);

        // Fallback to single guideline approach
        console.log('🔄 Falling back to single guideline guideline suggestions');
        const firstResult = analysisResults[0];
        await dynamicAdvice(
            window.latestAnalysis.transcript,
            firstResult.analysis,
            firstResult.guideline,
            firstResult.guidelineTitle || firstResult.guideline
        );
    }
}

// Display combined interactive suggestions from multiple guidelines
async function displayCombinedInteractiveSuggestions(suggestions, guidelinesSummary) {
    // Use the same one-at-a-time approach as displayInteractiveSuggestions
    const guidelineTitle = `${guidelinesSummary?.length || 0} Guidelines Combined`;
    return displayInteractiveSuggestions(suggestions, guidelineTitle);
}

async function OLD_displayCombinedInteractiveSuggestions_UNUSED(suggestions, guidelinesSummary) {
    console.log('[DEBUG] displayCombinedInteractiveSuggestions called', {
        suggestionsCount: suggestions?.length,
        guidelinesSummary: guidelinesSummary?.length
    });

    if (!suggestions || suggestions.length === 0) {
        const noSuggestionsHtml = `
            <div class="dynamic-advice-container">
                <h3>💡 Combined Interactive Suggestions</h3>
                <p>No specific suggestions were generated from the multi-guideline analysis.</p>
                <p><em>Analyzed: ${guidelinesSummary?.length || 0} guidelines</em></p>
            </div>
        `;
        updateUser('No specific suggestions were generated from the multi-guideline analysis.', false);
        return;
    }

    // Group suggestions by source guideline
    const suggestionsByGuideline = {};
    suggestions.forEach(suggestion => {
        const source = suggestion.sourceGuideline || 'Unknown Guideline';
        if (!suggestionsByGuideline[source]) {
            suggestionsByGuideline[source] = [];
        }
        suggestionsByGuideline[source].push(suggestion);
    });

    // Create bulk action controls
    const bulkControlsHtml = `
        <div class="bulk-actions">
            <h4>Bulk Actions</h4>
            <div class="bulk-buttons">
                <button onclick="bulkAcceptSuggestions('high')" class="bulk-btn accept-btn">Accept All High Priority</button>
                <button onclick="bulkRejectSuggestions('low')" class="bulk-btn reject-btn">Reject All Low Priority</button>
                <button onclick="bulkAcceptSuggestions('all')" class="bulk-btn accept-btn">Accept All</button>
                <button onclick="bulkRejectSuggestions('all')" class="bulk-btn reject-btn">Reject All</button>
            </div>
        </div>
    `;

    // Create suggestions HTML grouped by guideline
    let groupedSuggestionsHtml = '';
    let suggestionIndex = 1;

    Object.entries(suggestionsByGuideline).forEach(([guideline, guidelineSuggestions]) => {
        groupedSuggestionsHtml += `
            <div class="guideline-group">
                <h4 class="guideline-source">📋 From: ${guideline}</h4>
        `;

        guidelineSuggestions.forEach(suggestion => {
            const suggestionId = `suggestion-${suggestionIndex}`;
            const priorityClass = suggestion.priority === 'high' ? 'high' :
                suggestion.priority === 'medium' ? 'medium' : 'low';
            const categoryIcon = getCategoryIcon(suggestion.category);
            const originalTextLabel = getOriginalTextLabel(suggestion.originalText, suggestion.category);

            groupedSuggestionsHtml += `
                <div class="suggestion-item ${priorityClass}" data-suggestion-id="${suggestionId}" data-source-guideline="${guideline}">
                    <div class="suggestion-header">
                        <span class="suggestion-icon">${suggestion.category === 'gap' ? '➕' : '✏️'}</span>
                        <span class="suggestion-number">#${suggestionIndex}</span>
                        <span class="priority-badge ${priorityClass}">${suggestion.priority}</span>
                        <span class="category-label">${categoryIcon} ${suggestion.category}</span>
                    </div>
                    
                    <div class="suggestion-content">
                        <h4>${suggestion.title || 'Suggestion'}</h4>
                        
                        ${suggestion.originalText ? `
                            <div class="original-text">
                                <strong>${originalTextLabel}:</strong>
                                <div class="text-content">"${suggestion.originalText}"</div>
                            </div>
                        ` : `
                            <div class="gap-identified">
                                <strong>Gap identified:</strong> <span class="gap-content">"${suggestion.gapDescription || 'Missing documentation identified'}"</span>
                            </div>
                        `}
                        
                        <div class="suggested-text">
                            <strong>${suggestion.category === 'gap' ? 'Suggested addition:' : 'Suggested modification:'}</strong> <span class="suggestion-text" id="suggestion-text-${suggestionId}">"${suggestion.suggestedText}"</span>
                        </div>
                        
                        <div class="suggestion-reason">
                            <strong>Why this change is suggested:</strong>
                            <p>${suggestion.reason}</p>
                        </div>
                    </div>
                    
                    <div class="suggestion-actions">
                        <button onclick="handleSuggestionAction('${suggestionId}', 'accept')" class="action-btn accept-btn" id="accept-${suggestionId}">✅ Accept</button>
                        <button onclick="handleSuggestionAction('${suggestionId}', 'reject')" class="action-btn reject-btn" id="reject-${suggestionId}">❌ Reject</button>
                        <button onclick="handleSuggestionAction('${suggestionId}', 'modify')" class="action-btn modify-btn" id="modify-${suggestionId}">✏️ Modify</button>
                    </div>
                    
                    <div class="modification-area" id="modification-${suggestionId}" style="display: none;">
                        <textarea id="modification-text-${suggestionId}" placeholder="Enter your modified version...">${suggestion.suggestedText}</textarea>
                        <div class="modification-buttons">
                            <button onclick="confirmModification('${suggestionId}')" class="action-btn accept-btn">Confirm</button>
                            <button onclick="cancelModification('${suggestionId}')" class="action-btn reject-btn">Cancel</button>
                        </div>
                    </div>
                    
                    <div class="suggestion-status" id="status-${suggestionId}"></div>
                </div>
            `;

            // Store suggestion data globally
            currentSuggestions.push({
                id: suggestionId,
                ...suggestion
            });

            suggestionIndex++;
        });

        groupedSuggestionsHtml += '</div>';
    });

    // Create the complete HTML
    const suggestionsHtml = `
        <div class="dynamic-advice-container multi-guideline">
            <div class="advice-header">
                <h3>💡 Combined Interactive Suggestions</h3>
                <p><em>From: ${guidelinesSummary?.length || Object.keys(suggestionsByGuideline).length} guidelines analyzed</em></p>
                <p class="advice-instructions">Review each suggestion below. You can <strong>Accept</strong>, <strong>Reject</strong>, or <strong>Modify</strong> the proposed changes.</p>
                <div class="advice-explanation">
                    <p><strong>Note:</strong> Some suggestions identify <em>missing elements</em> (gaps in documentation) rather than existing text that needs changes. These are marked with ⚠️ and represent content that should be added to improve compliance with guidelines.</p>
                </div>
            </div>
            
            ${bulkControlsHtml}
            
            <div class="suggestions-list">
                ${groupedSuggestionsHtml}
            </div>
            
            <div class="decisions-summary" id="decisions-summary">
                <div class="summary-stats">
                    <span id="accepted-count">0</span> accepted, 
                    <span id="rejected-count">0</span> rejected, 
                    <span id="modified-count">0</span> modified, 
                    <span id="pending-count">${suggestions.length}</span> pending
                </div>
            </div>
            
            <div class="apply-decisions">
                <button onclick="applyAllDecisions()" class="apply-btn" id="apply-decisions-btn" disabled>Apply All Decisions</button>
                <p class="apply-note">Review your decisions above, then click "Apply All Decisions" to update the transcript.</p>
            </div>
        </div>
    `;

    console.log('[DEBUG] displayCombinedInteractiveSuggestions: Adding suggestions HTML to summary1');
    appendToSummary1(suggestionsHtml, false); // Decision UI: combined interactive suggestions

    // Update the decisions summary
    updateDecisionsSummary();
}

// Process guidelines one at a time for content repair
async function diagnoseAndRepairContent() {
    // Prevent multiple simultaneous repairs
    if (window.contentRepairInProgress) {
        console.log('[REPAIR] ⏳ Content repair already in progress, skipping...');
        return;
    }

    window.contentRepairInProgress = true;
    console.log('[REPAIR] 🔧 Starting comprehensive content repair process...');
    console.log('[REPAIR] This will process guidelines one at a time to avoid timeouts');

    try {
        // Get user ID token
        const user = auth.currentUser;
        if (!user) {
            console.error('[REPAIR] ❌ User not authenticated');
            throw new Error('User not authenticated');
        }

        console.log('[REPAIR] ✅ User authenticated, getting ID token...');
        const idToken = await user.getIdToken();

        // First, get the list of guidelines needing content
        console.log('[REPAIR] 📋 Getting list of guidelines needing content...');
        const listResponse = await fetch(`${window.SERVER_URL}/getGuidelinesNeedingContent`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${idToken}`
            }
        });

        if (!listResponse.ok) {
            const errorText = await listResponse.text();
            throw new Error(`Failed to get guidelines list: ${listResponse.status} - ${errorText}`);
        }

        const listResult = await listResponse.json();
        const guidelinesNeedingContent = listResult.guidelines || [];

        console.log(`[REPAIR] 📊 Found ${guidelinesNeedingContent.length} guidelines needing content processing`);

        if (guidelinesNeedingContent.length === 0) {
            showMetadataProgress('✅ All guidelines already have complete content!', true);
            setTimeout(() => hideMetadataProgress(), 3000);
            return;
        }

        // Process guidelines one at a time
        let processed = 0;
        let successful = 0;
        let failed = 0;

        for (const guideline of guidelinesNeedingContent) {
            try {
                processed++;
                const progress = `🔧 Processing ${processed}/${guidelinesNeedingContent.length}: ${guideline.title}`;
                showMetadataProgress(progress, false);

                console.log(`[REPAIR] 📄 Processing guideline ${processed}/${guidelinesNeedingContent.length}: ${guideline.id}`);

                const processResponse = await fetch(`${window.SERVER_URL}/processGuidelineContent`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${idToken}`
                    },
                    body: JSON.stringify({
                        guidelineId: guideline.id
                    })
                });

                if (processResponse.ok) {
                    const processResult = await processResponse.json();
                    if (processResult.success && processResult.updated) {
                        successful++;
                        console.log(`[REPAIR] ✅ Successfully processed: ${guideline.title}`);
                    } else {
                        console.log(`[REPAIR] ⏭️ No processing needed for: ${guideline.title}`);
                    }
                } else {
                    failed++;
                    const errorText = await processResponse.text();
                    console.error(`[REPAIR] ❌ Failed to process ${guideline.title}: ${errorText}`);
                }

                // Small delay between requests to avoid overwhelming the server
                await new Promise(resolve => setTimeout(resolve, 500));

            } catch (error) {
                failed++;
                console.error(`[REPAIR] ❌ Error processing ${guideline.title}:`, error);
            }
        }

        console.log(`[REPAIR] 📈 Processing complete: ${successful} successful, ${failed} failed, ${processed} total`);

        if (failed === 0) {
            showMetadataProgress(`✅ Content repair completed! Successfully processed ${successful} guidelines.`, true);
        } else {
            showMetadataProgress(`⚠️ Content repair completed with some issues: ${successful} successful, ${failed} failed.`, true);
        }

        // Auto-hide after 5 seconds
        setTimeout(() => {
            hideMetadataProgress();
        }, 5000);

        // Note: Guidelines will be automatically updated via Firestore listeners
        if (successful > 0) {
            console.log('[REPAIR] ✅ Guidelines updated in Firestore, changes will reflect automatically');
        }

    } catch (error) {
        console.error('[REPAIR] ❌ Content repair error:', error);

        showMetadataProgress(`❌ Content repair failed: ${error.message}`, true);

        // Auto-hide error after 10 seconds
        setTimeout(() => {
            hideMetadataProgress();
        }, 10000);

        throw error;

    } finally {
        console.log('[REPAIR] 🏁 Content repair process finished, flag reset');
        window.contentRepairInProgress = false;
    }
}

// Function to check content status during load
function checkContentStatus(guidelines) {
    const stats = {
        total: guidelines.length,
        nullContent: 0,
        nullCondensed: 0,
        missingBoth: 0,
        hasContent: 0,
        hasCondensed: 0,
        fullyPopulated: 0
    };

    const problematicGuidelines = [];

    guidelines.forEach(guideline => {
        const hasContent = guideline.content && guideline.content !== null && guideline.content.trim().length > 0;
        const hasCondensed = guideline.condensed && guideline.condensed !== null && guideline.condensed.trim().length > 0;

        if (hasContent) stats.hasContent++;
        if (hasCondensed) stats.hasCondensed++;
        if (hasContent && hasCondensed) stats.fullyPopulated++;

        if (!hasContent) {
            stats.nullContent++;
            problematicGuidelines.push({
                id: guideline.id,
                title: guideline.title || guideline.humanFriendlyName || 'Unknown',
                issue: 'null_content'
            });
        }

        if (!hasCondensed) {
            stats.nullCondensed++;
            if (!problematicGuidelines.find(p => p.id === guideline.id)) {
                problematicGuidelines.push({
                    id: guideline.id,
                    title: guideline.title || guideline.humanFriendlyName || 'Unknown',
                    issue: 'null_condensed'
                });
            } else {
                // Update existing entry to indicate both are missing
                const existing = problematicGuidelines.find(p => p.id === guideline.id);
                existing.issue = 'missing_both';
            }
        }

        if (!hasContent && !hasCondensed) {
            stats.missingBoth++;
        }
    });

    return { stats, problematicGuidelines };
}

// Global function for manual content repair (can be called from console)
window.repairContent = async function () {
    console.log('🔧 Manual content repair triggered from console...');
    try {
        await diagnoseAndRepairContent();
        console.log('✅ Manual content repair completed successfully!');
    } catch (error) {
        console.error('❌ Manual content repair failed:', error);
    }
};

// Make content status checking available globally for debugging
window.checkContentStatus = checkContentStatus;
window.diagnoseAndRepairContent = diagnoseAndRepairContent;

// Make chat history functions available globally for debugging
window.testFirestoreChat = async function () {
    console.log('🧪 Testing Firestore chat history...');
    try {
        const user = window.auth.currentUser;
        if (!user) {
            console.error('❌ You must be logged in to test Firestore chat history');
            return;
        }

        console.log('📊 Current chat history status:', {
            currentChatId: currentChatId,
            chatHistoryLength: chatHistory.length,
            userAuthenticated: !!user,
            userId: user.uid
        });

        // Test loading from Firestore
        const firestoreChats = await loadChatHistoryFromFirestore();
        console.log('📥 Loaded from Firestore:', firestoreChats.length, 'chats');

        // Test saving current chat
        if (currentChatId) {
            const currentChat = chatHistory.find(c => c.id === currentChatId);
            if (currentChat) {
                const saveSuccess = await saveChatToFirestore(currentChat);
                console.log('💾 Save test result:', saveSuccess ? '✅ Success' : '❌ Failed');
            }
        }

        console.log('✅ Firestore chat history test completed!');
    } catch (error) {
        console.error('❌ Firestore chat history test failed:', error);
    }
};

window.clearAllChatHistory = async function () {
    if (!confirm('Are you sure you want to delete ALL chat history? This cannot be undone.')) {
        return;
    }

    console.log('🗑️ Clearing all chat history...');
    try {
        const user = window.auth.currentUser;
        if (!user) {
            console.error('❌ You must be logged in to clear chat history');
            return;
        }

        // Delete all chats from Firestore
        const firestoreChats = await loadChatHistoryFromFirestore();
        for (const chat of firestoreChats) {
            await deleteChatFromFirestore(chat.id);
        }

        // Clear local data
        chatHistory = [];
        localStorage.removeItem('chatHistory');

        // Start fresh
        await startNewChat();

        console.log('✅ All chat history cleared successfully!');
    } catch (error) {
        console.error('❌ Failed to clear chat history:', error);
    }
};

// ========== DEBUGGING AND TROUBLESHOOTING HELPERS ==========

// Comprehensive debugging helper for multi-guideline processing
window.debugMultiGuideline = function () {
    console.group('🔍 Multi-Guideline Debug Information');

    // Check essential data
    console.log('📊 Essential Data Status:');
    console.log('  - window.latestAnalysis:', !!window.latestAnalysis);
    console.log('  - transcript available:', !!(window.latestAnalysis?.transcript));
    console.log('  - analysis available:', !!(window.latestAnalysis?.analysis));
    console.log('  - relevantGuidelines:', window.relevantGuidelines?.length || 0);
    console.log('  - globalGuidelines loaded:', !!(window.globalGuidelines && Object.keys(window.globalGuidelines).length > 0));

    // Check user authentication
    const user = window.auth?.currentUser;
    console.log('👤 Authentication Status:');
    console.log('  - User authenticated:', !!user);
    console.log('  - User email:', user?.email || 'N/A');

    // Check selected guidelines
    const selectedCheckboxes = document.querySelectorAll('.guideline-checkbox:checked');
    console.log('📋 Selection Status:');
    console.log('  - Selected guidelines:', selectedCheckboxes.length);
    if (selectedCheckboxes.length > 0) {
        console.log('  - Selected IDs:', Array.from(selectedCheckboxes).map(cb => cb.dataset.guidelineId));
    }

    // Check current session state
    console.log('🗂️ Session State:');
    console.log('  - currentAdviceSession:', currentAdviceSession);
    console.log('  - currentSuggestions:', currentSuggestions?.length || 0);
    console.log('  - userDecisions:', Object.keys(userDecisions || {}).length);

    // Server connectivity
    console.log('🌐 Server Configuration:');
    console.log('  - SERVER_URL:', window.SERVER_URL);

    console.groupEnd();

    // Return summary for programmatic use
    return {
        hasEssentialData: !!(window.latestAnalysis?.transcript && window.latestAnalysis?.analysis),
        isUserAuthenticated: !!user,
        selectedCount: selectedCheckboxes.length,
        hasRelevantGuidelines: (window.relevantGuidelines?.length || 0) > 0,
        serverConfigured: !!window.SERVER_URL
    };
};

// Test function to validate multi-guideline setup
window.testMultiGuidelineSetup = async function () {
    console.log('🧪 Testing Multi-Guideline Setup...');

    const debug = window.debugMultiGuideline();
    const issues = [];

    if (!debug.hasEssentialData) {
        issues.push('❌ Missing essential data (transcript/analysis). Please enter and analyze a clinical transcript first.');
    }

    if (!debug.isUserAuthenticated) {
        issues.push('❌ User not authenticated. Please sign in first.');
    }

    if (!debug.hasRelevantGuidelines) {
        issues.push('❌ No relevant guidelines available. Please find relevant guidelines first.');
    }

    if (!debug.serverConfigured) {
        issues.push('❌ Server URL not configured.');
    }

    if (debug.selectedCount === 0) {
        issues.push('⚠️ No guidelines selected. Please select at least one guideline for processing.');
    }

    if (issues.length === 0) {
        console.log('✅ Multi-guideline setup looks good! Ready for processing.');
        return true;
    } else {
        console.log('❌ Issues found:');
        issues.forEach(issue => console.log('  ' + issue));
        return false;
    }
};

// Manual trigger for multi-guideline processing with validation
window.runMultiGuidelineAdvice = async function () {
    console.log('🚀 Manual Multi-Guideline Advice Trigger');

    const isReady = await window.testMultiGuidelineSetup();
    if (!isReady) {
        console.log('❌ Setup validation failed. Please resolve the issues above.');
        return;
    }

    try {
        await generateMultiGuidelineAdvice();
    } catch (error) {
        console.error('❌ Multi-guideline processing failed:', error);
        throw error;
    }
};

// Clear all current selections and state
window.clearMultiGuidelineState = function () {
    console.log('🧹 Clearing multi-guideline state...');

    // Clear selections
    const checkboxes = document.querySelectorAll('.guideline-checkbox:checked');
    checkboxes.forEach(cb => cb.checked = false);

    // Clear session state
    currentAdviceSession = null;
    currentSuggestions = [];
    userDecisions = {};

    // Clear any progress displays
    const progressContainers = document.querySelectorAll('.multi-guideline-progress, .multi-guideline-error');
    progressContainers.forEach(container => container.remove());

    console.log('✅ Multi-guideline state cleared');
};

console.log('🔧 Multi-guideline debugging helpers loaded. Use:');
console.log('  - window.debugMultiGuideline() - Check current state');
console.log('  - window.testMultiGuidelineSetup() - Validate setup');
console.log('  - window.runMultiGuidelineAdvice() - Manual trigger');
console.log('  - window.clearMultiGuidelineState() - Reset state');

// ============================================
// FIREBASE-BASED CLINICAL CONDITIONS SERVICE
// ============================================

// Global cache for clinical conditions from Firebase
let clinicalConditionsFirebaseCache = null;
let clinicalConditionsFirebaseLoadPromise = null;

// Service to manage clinical conditions from Firebase
const ClinicalConditionsService = {
    // Load clinical conditions from server on startup
    async loadConditions() {
        if (clinicalConditionsFirebaseLoadPromise) {
            return clinicalConditionsFirebaseLoadPromise;
        }

        clinicalConditionsFirebaseLoadPromise = this._fetchConditionsFromServer();
        return clinicalConditionsFirebaseLoadPromise;
    },

    // Normalize category names (merge American/British spellings)
    _normalizeCategories(conditions) {
        // If there's both 'gynecology' and 'gynaecology', merge into 'gynaecology'
        if (conditions.gynecology && conditions.gynaecology) {
            console.log('[CLINICAL-SERVICE] Merging gynecology into gynaecology');
            // Merge conditions from gynecology into gynaecology
            conditions.gynaecology = { ...conditions.gynaecology, ...conditions.gynecology };
            delete conditions.gynecology;
        } else if (conditions.gynecology && !conditions.gynaecology) {
            console.log('[CLINICAL-SERVICE] Renaming gynecology to gynaecology');
            // Just rename if only American spelling exists
            conditions.gynaecology = conditions.gynecology;
            delete conditions.gynecology;
        }
        return conditions;
    },

    async _fetchConditionsFromServer() {
        try {
            // Try to get from IndexedDB cache first
            if (window.cacheManager) {
                const cachedConditions = await window.cacheManager.getClinicalConditions();
                if (cachedConditions) {
                    console.log('[CLINICAL-SERVICE] ⚡ Loaded clinical conditions from IndexedDB cache');
                    // Normalize categories before caching
                    const normalized = this._normalizeCategories(cachedConditions);
                    clinicalConditionsFirebaseCache = normalized;
                    return normalized;
                }
            }

            console.log('[CLINICAL-SERVICE] Loading clinical conditions from Firebase...');

            const user = auth.currentUser;
            if (!user) {
                throw new Error('User not authenticated');
            }

            const idToken = await user.getIdToken(); // Only refresh if expired (was: true - force refresh)

            const response = await fetch(`${window.SERVER_URL}/clinicalConditions`, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${idToken}`,
                    'Content-Type': 'application/json'
                }
            });

            if (!response.ok) {
                throw new Error(`Failed to load clinical conditions: ${response.status}`);
            }

            const data = await response.json();

            if (!data.success) {
                throw new Error(data.error || 'Failed to load clinical conditions');
            }

            // Check if Firebase collection is empty
            const totalConditions = data.summary?.totalConditions || 0;
            if (totalConditions === 0) {
                console.log('[CLINICAL-SERVICE] Firebase collection is empty, initializing...');
                await this._initializeFirebaseCollection();

                // Retry loading after initialization
                const retryResponse = await fetch(`${window.SERVER_URL}/clinicalConditions`, {
                    method: 'GET',
                    headers: {
                        'Authorization': `Bearer ${idToken}`,
                        'Content-Type': 'application/json'
                    }
                });

                if (retryResponse.ok) {
                    const retryData = await retryResponse.json();
                    if (retryData.success && retryData.summary?.totalConditions > 0) {
                        // Normalize categories before caching
                        const normalizedConditions = this._normalizeCategories(retryData.conditions);
                        clinicalConditionsFirebaseCache = normalizedConditions;

                        // Save normalized data to IndexedDB cache in background
                        if (window.cacheManager) {
                            window.cacheManager.saveClinicalConditions(normalizedConditions).catch(err => {
                                console.warn('[CLINICAL-SERVICE] Failed to cache conditions:', err);
                            });
                        }

                        console.log('[CLINICAL-SERVICE] Successfully loaded clinical conditions after initialization:', {
                            totalCategories: Object.keys(clinicalConditionsFirebaseCache).length,
                            totalConditions: retryData.summary.totalConditions,
                            categoriesWithCounts: retryData.summary.categoriesWithCounts
                        });
                        return clinicalConditionsFirebaseCache;
                    }
                }

                // If initialization didn't work, fall back to JSON
                console.log('[CLINICAL-SERVICE] Initialization failed, falling back to JSON...');
                return this._loadFromJsonFallback();
            }

            // Normalize categories before caching
            const normalizedConditions = this._normalizeCategories(data.conditions);
            clinicalConditionsFirebaseCache = normalizedConditions;

            // Save normalized data to IndexedDB cache in background
            if (window.cacheManager) {
                window.cacheManager.saveClinicalConditions(normalizedConditions).catch(err => {
                    console.warn('[CLINICAL-SERVICE] Failed to cache conditions:', err);
                });
            }

            console.log('[CLINICAL-SERVICE] Successfully loaded clinical conditions:', {
                totalCategories: Object.keys(clinicalConditionsFirebaseCache).length,
                totalConditions: data.summary.totalConditions,
                categoriesWithCounts: data.summary.categoriesWithCounts
            });

            return clinicalConditionsFirebaseCache;

        } catch (error) {
            console.error('[CLINICAL-SERVICE] Error loading clinical conditions:', error);
            // Fallback to JSON file if Firebase fails
            return this._loadFromJsonFallback();
        }
    },

    async _initializeFirebaseCollection() {
        try {
            console.log('[CLINICAL-SERVICE] Initializing Firebase collection...');

            const user = auth.currentUser;
            if (!user) {
                throw new Error('User not authenticated');
            }

            const idToken = await user.getIdToken();

            const response = await fetch(`${window.SERVER_URL}/initializeClinicalConditions`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${idToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({})
            });

            if (!response.ok) {
                throw new Error(`Failed to initialize clinical conditions: ${response.status}`);
            }

            const data = await response.json();

            if (!data.success) {
                throw new Error(data.error || 'Failed to initialize clinical conditions');
            }

            console.log('[CLINICAL-SERVICE] Firebase collection initialized successfully:', data.message);
            return true;

        } catch (error) {
            console.error('[CLINICAL-SERVICE] Error initializing Firebase collection:', error);
            throw error;
        }
    },

    async _loadFromJsonFallback() {
        console.log('[CLINICAL-SERVICE] Falling back to JSON file...');

        try {
            const response = await fetch('./clinical_issues.json');
            if (!response.ok) {
                throw new Error(`Failed to load clinical issues JSON: ${response.status}`);
            }

            const clinicalIssues = await response.json();

            // Convert to the same format as Firebase
            const conditions = {};
            for (const [category, issues] of Object.entries(clinicalIssues)) {
                conditions[category] = {};
                issues.forEach(issue => {
                    conditions[category][issue] = {
                        id: `${category}-${issue.toLowerCase().replace(/[^a-z0-9]/g, '-')}`,
                        name: issue,
                        category: category,
                        transcript: null, // No pre-generated transcripts in fallback
                        hasTranscript: false,
                        metadata: {
                            source: 'json-fallback'
                        }
                    };
                });
            }

            clinicalConditionsFirebaseCache = conditions;

            console.log('[CLINICAL-SERVICE] Loaded from JSON fallback:', {
                totalCategories: Object.keys(conditions).length,
                totalConditions: Object.values(conditions).reduce((sum, cat) => sum + Object.keys(cat).length, 0)
            });

            return conditions;

        } catch (error) {
            console.error('[CLINICAL-SERVICE] Error loading JSON fallback:', error);
            throw error;
        }
    },

    // Get all conditions (cached)
    getConditions() {
        return clinicalConditionsFirebaseCache;
    },

    // Get conditions by category
    getConditionsByCategory(category) {
        return clinicalConditionsFirebaseCache?.[category] || {};
    },

    // Find a specific condition
    findCondition(conditionName) {
        if (!clinicalConditionsFirebaseCache) return null;

        for (const [category, conditions] of Object.entries(clinicalConditionsFirebaseCache)) {
            if (conditions[conditionName]) {
                return conditions[conditionName];
            }
        }
        return null;
    },

    // Generate transcript for a specific condition
    async generateTranscript(conditionId, forceRegenerate = false) {
        try {
            console.log('[CLINICAL-SERVICE] Generating transcript for condition:', conditionId);

            const user = auth.currentUser;
            if (!user) {
                throw new Error('User not authenticated');
            }

            const idToken = await user.getIdToken();

            const response = await fetch(`${window.SERVER_URL}/generateTranscript/${conditionId}`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${idToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ forceRegenerate })
            });

            console.log('[CLINICAL-SERVICE] Server response status:', response.status, response.statusText);

            if (!response.ok) {
                const errorText = await response.text();
                console.error('[CLINICAL-SERVICE] Server error response:', errorText);
                throw new Error(`Failed to generate transcript: ${response.status} - ${errorText}`);
            }

            const data = await response.json();

            console.log('[CLINICAL-SERVICE] Server response data:', {
                success: data.success,
                hasTranscript: !!data.transcript,
                transcriptLength: data.transcript?.length,
                cached: data.cached,
                generated: data.generated,
                condition: data.condition,
                transcriptPreview: data.transcript ? data.transcript.substring(0, 200) + '...' : 'NO TRANSCRIPT',
                fullDataKeys: Object.keys(data)
            });

            if (!data.success) {
                throw new Error(data.error || 'Failed to generate transcript');
            }

            if (!data.transcript) {
                console.error('[CLINICAL-SERVICE] No transcript in server response:', data);
                throw new Error('No transcript received from server');
            }

            // Update cache if transcript was generated/retrieved
            if (data.transcript && clinicalConditionsFirebaseCache) {
                const condition = this.findConditionById(conditionId);
                if (condition) {
                    // Find and update the condition in cache
                    for (const [category, conditions] of Object.entries(clinicalConditionsFirebaseCache)) {
                        for (const [name, cond] of Object.entries(conditions)) {
                            if (cond.id === conditionId) {
                                clinicalConditionsFirebaseCache[category][name].transcript = data.transcript;
                                clinicalConditionsFirebaseCache[category][name].hasTranscript = true;
                                clinicalConditionsFirebaseCache[category][name].lastGenerated = data.generated || data.lastGenerated;
                                break;
                            }
                        }
                    }
                }
            }

            return data;

        } catch (error) {
            console.error('[CLINICAL-SERVICE] Error generating transcript:', error);
            throw error;
        }
    },

    // Helper to find condition by ID
    findConditionById(conditionId) {
        if (!clinicalConditionsFirebaseCache) return null;

        for (const [category, conditions] of Object.entries(clinicalConditionsFirebaseCache)) {
            for (const [name, condition] of Object.entries(conditions)) {
                if (condition.id === conditionId) {
                    return condition;
                }
            }
        }
        return null;
    },

    // Get summary statistics
    getSummary() {
        if (!clinicalConditionsFirebaseCache) return null;

        const summary = {
            totalCategories: Object.keys(clinicalConditionsFirebaseCache).length,
            totalConditions: 0,
            conditionsWithTranscripts: 0,
            categoriesWithCounts: {}
        };

        for (const [category, conditions] of Object.entries(clinicalConditionsFirebaseCache)) {
            const categoryCount = Object.keys(conditions).length;
            const categoryWithTranscripts = Object.values(conditions).filter(c => c.hasTranscript).length;

            summary.totalConditions += categoryCount;
            summary.conditionsWithTranscripts += categoryWithTranscripts;
            summary.categoriesWithCounts[category] = {
                total: categoryCount,
                withTranscripts: categoryWithTranscripts
            };
        }

        return summary;
    }
};

// Ask Guidelines Question functionality
async function askGuidelinesQuestion() {
    const analyseBtn = document.getElementById('analyseBtn');
    const analyseSpinner = document.getElementById('analyseSpinner');

    // Check for abort signal
    if (window.analysisAbortController?.signal.aborted) {
        console.log('[DEBUG] askGuidelinesQuestion: Already aborted');
        return;
    }

    try {
        const question = getUserInputContent();
        if (!question) {
            alert('Please enter a question first');
            return;
        }

        // Button state is already set by the click handler

        // Update user status - starting Q&A flow
        updateUser('Preparing to ask guidelines your question...', true);

        // Question text is already visible in the input; use status bar for progress instead of summary1

        // Get user ID token (needed for loading preferences)
        const user = auth.currentUser;
        if (!user) {
            alert('Please sign in to use this feature');
            return;
        }

        // Update user status - getting authentication
        updateUser('Checking sign-in and loading your preferences...', true);

        const idToken = await user.getIdToken();

        // Check for saved scope preference first
        console.log('[DEBUG] askGuidelinesQuestion: Checking for saved scope preference');
        let scopeSelection;
        const savedScopeSelection = await loadGuidelineScopeSelection();

        if (savedScopeSelection) {
            // Verify the saved selection is still valid (check if trust still exists if local/both)
            if (savedScopeSelection.scope === 'local' || savedScopeSelection.scope === 'both') {
                // Update user status while we verify hospital trust
                updateUser('Checking guideline scope...', true);

                // Need to verify the hospital trust is still valid
                try {
                    const response = await fetch(`${window.SERVER_URL}/getUserHospitalTrust`, {
                        method: 'GET',
                        headers: {
                            'Authorization': `Bearer ${idToken}`
                        }
                    });
                    const result = await response.json();
                    if (result.success && result.hospitalTrust) {
                        // Trust exists, use saved selection (but update trust name in case it changed)
                        scopeSelection = {
                            scope: savedScopeSelection.scope,
                            hospitalTrust: result.hospitalTrust
                        };
                        console.log('[DEBUG] askGuidelinesQuestion: Using saved scope selection:', scopeSelection);
                    } else {
                        // Trust no longer exists, need to reselect
                        console.log('[DEBUG] askGuidelinesQuestion: Saved selection invalid (no trust), showing modal');
                        try {
                            updateUser('Select which guidelines to use for this question...', true);
                            scopeSelection = await showGuidelineScopeModal();
                        } catch (error) {
                            // Check if error is due to abort
                            if (error.name === 'AbortError' || error.message === 'Analysis cancelled' || window.analysisAbortController?.signal.aborted) {
                                throw new Error('Analysis cancelled');
                            }
                            console.log('[DEBUG] askGuidelinesQuestion: Scope selection cancelled:', error.message);
                            updateUser('Scope selection cancelled.', false);
                            return; // Exit if user cancels
                        }
                    }
                } catch (error) {
                    // Check if error is due to abort
                    if (error.name === 'AbortError' || error.message === 'Analysis cancelled' || window.analysisAbortController?.signal.aborted) {
                        updateUser('Analysis cancelled', false);
                        throw new Error('Analysis cancelled');
                    }
                    console.error('[ERROR] Failed to verify hospital trust, showing modal:', error);
                    try {
                        updateUser('Select which guidelines to use for this question...', true);
                        scopeSelection = await showGuidelineScopeModal();
                    } catch (modalError) {
                        // Check if error is due to abort
                        if (modalError.name === 'AbortError' || modalError.message === 'Analysis cancelled' || window.analysisAbortController?.signal.aborted) {
                            updateUser('Analysis cancelled', false);
                            throw new Error('Analysis cancelled');
                        }
                        console.log('[DEBUG] askGuidelinesQuestion: Scope selection cancelled:', modalError.message);
                        updateUser('Scope selection cancelled.', false);
                        return; // Exit if user cancels
                    }
                }
            } else {
                // National scope doesn't need trust verification
                scopeSelection = savedScopeSelection;
                console.log('[DEBUG] askGuidelinesQuestion: Using saved scope selection:', scopeSelection);
            }
        } else {
            // No saved selection, show modal
            console.log('[DEBUG] askGuidelinesQuestion: No saved selection, showing guideline scope selection modal');
            try {
                updateUser('Select which guidelines to use for this question...', true);
                scopeSelection = await showGuidelineScopeModal();
            } catch (error) {
                // Check if error is due to abort
                if (error.name === 'AbortError' || error.message === 'Analysis cancelled' || window.analysisAbortController?.signal.aborted) {
                    updateUser('Analysis cancelled', false);
                    throw new Error('Analysis cancelled');
                }
                console.log('[DEBUG] askGuidelinesQuestion: Scope selection cancelled:', error.message);
                updateUser('Scope selection cancelled.', false);
                return; // Exit if user cancels
            }
        }

        // Check for abort after scope selection
        if (window.analysisAbortController?.signal.aborted) {
            updateUser('Analysis cancelled', false);
            throw new Error('Analysis cancelled');
        }

        console.log('[DEBUG] askGuidelinesQuestion: Using scope selection:', scopeSelection);

        // Store the selection globally
        window.selectedGuidelineScope = scopeSelection;

        const scopeMessage = scopeSelection.scope === 'national'
            ? 'National guidelines selected.'
            : scopeSelection.scope === 'local'
                ? `Local guidelines selected (${scopeSelection.hospitalTrust}).`
                : `Both national and ${scopeSelection.hospitalTrust} guidelines selected.`;

        updateUser(scopeMessage, false);

        // Update user status - scope confirmed
        updateUser('Guideline scope confirmed. Loading guidelines...', true);

        // Update progress (status bar only)
        const loadingMessage = 'Loading guidelines from database...';
        updateUser(loadingMessage, true);

        // Get guidelines and summaries from Firestore (reuse existing logic)
        let guidelines = await loadGuidelinesFromFirestore();

        // Filter guidelines by scope
        console.log('[DEBUG] Filtering guidelines by scope:', { scope: scopeSelection.scope, hospitalTrust: scopeSelection.hospitalTrust, beforeFilter: guidelines.length });
        guidelines = filterGuidelinesByScope(guidelines, scopeSelection.scope, scopeSelection.hospitalTrust);
        console.log('[DEBUG] After filtering:', guidelines.length, 'guidelines');

        if (guidelines.length === 0) {
            const noGuidelinesMsg = 'No guidelines found for the selected scope.';
            updateUser(noGuidelinesMsg, false);
            alert('No guidelines found for the selected scope. Please try a different option or check your trust selection.');
            return;
        }

        // Add scope info via status bar
        const scopeInfo = scopeSelection.scope === 'national'
            ? `Searching ${guidelines.length} national guidelines...`
            : scopeSelection.scope === 'local'
                ? `Searching ${guidelines.length} local guidelines for ${scopeSelection.hospitalTrust}...`
                : `Searching ${guidelines.length} guidelines (National + ${scopeSelection.hospitalTrust})...`;
        updateUser(scopeInfo, true);

        // Format guidelines for relevancy matching
        updateUser(`Analysing your question against ${guidelines.length} guidelines...`, true);

        const guidelinesList = guidelines.map(g => ({
            id: g.id,
            title: g.title,
            summary: g.summary,
            condensed: g.condensed,
            keywords: g.keywords,
            downloadUrl: g.downloadUrl,
            originalFilename: g.originalFilename,
            filename: g.filename,
            organisation: g.organisation
        }));

        // Update progress with guideline count
        const analyzeMessage = `Analysing question against ${guidelinesList.length} available guidelines...`;
        updateUser(analyzeMessage, true);

        // Let user know we’re finding most relevant guidelines
        updateUser('Finding the most relevant guidelines for your question...', true);

        console.log('[DEBUG] Sending request to /findRelevantGuidelines for question:', {
            questionLength: question.length,
            guidelinesCount: guidelinesList.length
        });

        // Check for abort before fetch
        if (window.analysisAbortController?.signal.aborted) {
            throw new Error('Analysis cancelled');
        }

        // Use same optimised pattern as main findRelevantGuidelines function
        const response = await fetch(`${window.SERVER_URL}/findRelevantGuidelines`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${idToken}`
            },
            body: JSON.stringify({
                transcript: question,
                guidelinesCount: guidelinesList.length, // Just send count for verification
                loadGuidelinesOnServer: true, // Flag to load guidelines server-side
                anonymisationInfo: null, // No anonymisation needed for questions
                scope: scopeSelection.scope, // Include scope filtering
                hospitalTrust: scopeSelection.hospitalTrust // Include hospital trust for local filtering
            }),
            signal: window.analysisAbortController?.signal
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Server error: ${response.status} - ${errorText}`);
        }

        const data = await response.json();
        if (!data.success) {
            updateUser('Error finding relevant guidelines', false);
            throw new Error(data.error || 'Failed to find relevant guidelines');
        }

        // Update progress with completion
        const completionMessage = 'Analysis complete – processing most relevant guidelines...';
        updateUser(completionMessage, true);

        updateUser('Guidelines found. Preparing detailed answer...', true);

        // Automatically select the top 3 most relevant guidelines
        const allGuidelines = [];

        // Properly handle categories as an object (not array)
        const categoryKeys = ['mostRelevant', 'potentiallyRelevant', 'lessRelevant'];
        categoryKeys.forEach(categoryKey => {
            if (data.categories[categoryKey] && Array.isArray(data.categories[categoryKey])) {
                data.categories[categoryKey].forEach(guideline => {
                    allGuidelines.push({
                        ...guideline,
                        relevanceScore: extractRelevanceScore(guideline.relevance)
                    });
                });
            }
        });

        // Sort by relevance score and take top 3
        const selectedGuidelines = allGuidelines
            .sort((a, b) => b.relevanceScore - a.relevanceScore)
            .slice(0, 3);

        console.log('[DEBUG] askGuidelinesQuestion: Selected guidelines:', {
            totalFound: allGuidelines.length,
            selectedCount: selectedGuidelines.length,
            selected: selectedGuidelines.map(g => ({ id: g.id, title: g.title, relevanceScore: g.relevanceScore }))
        });

        // Check if we have any guidelines to process
        if (selectedGuidelines.length === 0) {
            updateUser('No relevant guidelines found for this question', false);
            const noGuidelinesMessage = `## ℹ️ No Relevant Guidelines Found\n\n` +
                `Unfortunately, no guidelines were found to be relevant to your question:\n\n` +
                `**"${question}"**\n\n` +
                `This could happen if:\n` +
                `- Your question is very specific and doesn't match available guidelines\n` +
                `- The question is outside the scope of the current guideline database\n` +
                `- There was an issue with the analysis process\n\n` +
                `**Suggestions:**\n` +
                `- Try rephrasing your question more generally\n` +
                `- Include more clinical context or keywords\n` +
                `- Check if your question relates to obstetrics, gynaecology, or general medical guidelines\n\n`;

            updateUser(
                'No highly relevant guidelines found for this question. Try rephrasing, adding clinical context, or broadening the query.',
                false
            );
            return; // Exit early, don't try to process empty guidelines
        }

        // Check for abort before second fetch
        if (window.analysisAbortController?.signal.aborted) {
            throw new Error('Analysis cancelled');
        }

        // Process the selected guidelines
        const response2 = await fetch(`${window.SERVER_URL}/askGuidelinesQuestion`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${idToken}`
            },
            body: JSON.stringify({
                question: question,
                relevantGuidelines: selectedGuidelines
            }),
            signal: window.analysisAbortController?.signal
        });

        if (!response2.ok) {
            const errorText = await response2.text();
            throw new Error(`Server error: ${response2.status} - ${errorText}`);
        }

        const data2 = await response2.json();
        if (!data2.success) {
            updateUser('Error answering your guideline question', false);
            console.error('[DEBUG] askGuidelinesQuestion: Server error', {
                error: data2.error,
                traceId: data2.traceId
            });
            throw new Error(data2.error || 'Failed to process guidelines');
        }

        // Log trace ID for debugging correlation with server logs
        console.log('[DEBUG] askGuidelinesQuestion: Response received', {
            traceId: data2.traceId,
            answerLength: data2.answer?.length,
            guidelinesUsedCount: data2.guidelinesUsed?.length,
            aiProvider: data2.ai_provider
        });

        // Parse citations in the answer and convert to clickable links
        const { formattedAnswer } = parseCitationsToLinks(
            data2.answer,
            data2.guidelinesUsed,
            'askGuidelinesQuestion'
        );

        // Display the answer with HTML formatting
        const selectedGuidelinesList = data2.guidelinesUsed.map(g => {
            if (!g || !g.id) return '';
            const title = g.title ? g.title : g.id;
            // Use createGuidelineViewerLink with hasVerbatimQuote=false so the
            // guideline link simply opens the PDF (no specific search/highlight).
            const link = createGuidelineViewerLink(
                String(g.id),
                title,
                null,
                null,
                false
            );
            return `<li>${link}</li>`;
        }).join('');

        const answerMessage = `<h2>Guidelines Used</h2>` +
            `<ul>${selectedGuidelinesList}</ul>` +
            `<hr>` +
            `<h2>Answer</h2>` +
            `<div class="guideline-answer">${formattedAnswer}</div>`;

        appendToOutputField(answerMessage, true, true); // Display in output field, clear existing content, isHtml=true

        // Final user status - success
        updateUser('Answer generated from guidelines', false);

    } catch (error) {
        // Check if error is due to abort
        if (error.name === 'AbortError' || error.message === 'Analysis cancelled' || window.analysisAbortController?.signal.aborted) {
            console.log('[DEBUG] askGuidelinesQuestion: Analysis was cancelled');
            updateUser('Analysis cancelled', false);
            // Don't show error alert for user-initiated cancellation
            return;
        }

        console.error('[DEBUG] Error in askGuidelinesQuestion:', {
            error: error.message,
            stack: error.stack
        });

        // Surface error to top-level status instead of summary1
        const errorMessage = `Error finding relevant guidelines: ${error.message}`;
        updateUser(errorMessage, false);

        alert('Error finding relevant guidelines: ' + error.message);
    } finally {
        // Button state is restored by the click handler's finally block
        // Hide summary loading spinner
        hideSummaryLoading();
    }
}

// Helper function to extract relevance score from text
function extractRelevanceScore(relevanceText) {
    const match = relevanceText.match(/Relevance:\s*(\d+(\.\d+)?)/i);
    return match ? parseFloat(match[1]) : 0;
}

// Make Q&A functions globally accessible
// Define the selectAllQuestionGuidelines function
function selectAllQuestionGuidelines() {
    const guidelines = document.querySelectorAll('.question-guideline');
    guidelines.forEach(guideline => {
        guideline.checked = true;
        guideline.dispatchEvent(new Event('change'));
    });
}

window.selectAllQuestionGuidelines = selectAllQuestionGuidelines;
window.processQuestionAgainstGuidelines = processQuestionAgainstGuidelines;
window.cancelGuidelineSelection = cancelGuidelineSelection;

// Process question against selected guidelines
async function processQuestionAgainstGuidelines() {
    const searchBtn = document.querySelector('.search-guidelines-btn');
    const btnSpinner = document.querySelector('.search-guidelines-btn .btn-spinner');
    const btnText = document.querySelector('.search-guidelines-btn .btn-text');
    const originalText = btnText.textContent;

    try {
        // Get selected guidelines
        const selectedCheckboxes = document.querySelectorAll('.question-guideline-checkbox:checked');
        if (selectedCheckboxes.length === 0) {
            alert('Please select at least one guideline to search');
            return;
        }

        const selectedGuidelineIds = Array.from(selectedCheckboxes).map(cb => cb.dataset.guidelineId);
        const question = window.currentQuestion;

        if (!question) {
            alert('Question not found. Please try again.');
            return;
        }

        // Set loading state
        searchBtn.disabled = true;
        btnSpinner.style.display = 'inline-block';
        btnText.textContent = 'Searching...';

        // Get user ID token
        const user = auth.currentUser;
        if (!user) {
            alert('Please sign in to use this feature');
            return;
        }
        const idToken = await user.getIdToken();

        // Start the search process
        let searchProgress = `\n## 🔍 Searching Guidelines for Your Answer\n\n`;
        searchProgress += `**Question:** ${question}\n\n`;
        searchProgress += `**Selected Guidelines:** ${selectedGuidelineIds.length}\n\n`;
        searchProgress += `**Status:** Processing guidelines...\n\n`;
        appendToOutputField(searchProgress, false);

        // Get the relevant guidelines data from the global state
        const relevantGuidelines = window.relevantGuidelines || [];
        const selectedGuidelines = relevantGuidelines.filter(g => selectedGuidelineIds.includes(g.id));

        if (selectedGuidelines.length === 0) {
            throw new Error('Selected guidelines not found in relevant guidelines data');
        }

        console.log('[DEBUG] processQuestionAgainstGuidelines: Calling new endpoint with:', {
            questionLength: question.length,
            selectedGuidelinesCount: selectedGuidelines.length,
            guidelines: selectedGuidelines.map(g => ({ id: g.id, title: g.title }))
        });

        // Call the new askGuidelinesQuestion endpoint
        const response = await fetch(`${window.SERVER_URL}/askGuidelinesQuestion`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${idToken}`
            },
            body: JSON.stringify({
                question: question,
                relevantGuidelines: selectedGuidelines
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Server error: ${response.status} - ${errorText}`);
        }

        const data = await response.json();
        if (!data.success) {
            throw new Error(data.error || 'Failed to get answer from guidelines');
        }

        // Parse citations in the answer and convert to clickable links
        const { formattedAnswer } = parseCitationsToLinks(
            data.answer,
            data.guidelinesUsed,
            'processQuestionAgainstGuidelines'
        );

        // Display the comprehensive answer with HTML formatting
        const guidelinesUsedList = (data.guidelinesUsed || []).map(g => {
            if (!g || !g.id) return '';
            const title = g.title ? g.title : g.id;
            const link = createGuidelineViewerLink(
                String(g.id),
                title,
                null,
                null,
                false
            );
            return `<li>${link}</li>`;
        }).join('');

        const answerMessage = `<h2>Guidelines Used</h2>` +
            `<ul>${guidelinesUsedList}</ul>` +
            `<hr>` +
            `<h2>💡 Answer Based on Guidelines</h2>` +
            `<p><strong>Question:</strong> ${escapeHtml(question)}</p>` +
            `<p><strong>Guidelines Used:</strong> ${data.guidelinesUsed?.length || 0}</p>` +
            `<hr>` +
            `<div class="guideline-answer">${formattedAnswer}</div>` +
            `<hr>` +
            `<p style="font-size: 0.8em; color: var(--text-secondary);"><em>Answer generated using ${data.ai_provider || 'AI'} (${data.ai_model || 'unknown model'})</em></p>`;

        appendToOutputField(answerMessage, false, true);

    } catch (error) {
        console.error('[DEBUG] Error in processQuestionAgainstGuidelines:', error);

        const errorMessage = `\n❌ **Error searching guidelines:** ${error.message}\n\nPlease try again or contact support if the problem persists.\n`;
        appendToOutputField(errorMessage, false);

        alert('Error searching guidelines: ' + error.message);
    } finally {
        // Reset button state
        searchBtn.disabled = false;
        btnSpinner.style.display = 'none';
        btnText.textContent = originalText;
    }
}

// Compliance Scoring Functions

// Trigger compliance scoring after guideline suggestions are applied
async function triggerComplianceScoring(originalTranscript, updatedTranscript, changesSummary) {
    try {
        console.log('[DEBUG] triggerComplianceScoring called', {
            originalLength: originalTranscript?.length,
            updatedLength: updatedTranscript?.length,
            changesSummary
        });

        // Only score if we have the necessary data and there were actual changes
        if (!originalTranscript || !changesSummary || changesSummary.total === 0) {
            console.log('[DEBUG] triggerComplianceScoring: Skipping - no changes to score');
            return;
        }

        // Get the current guideline information
        const currentGuideline = getCurrentGuidelineInfo();
        if (!currentGuideline.id) {
            console.log('[DEBUG] triggerComplianceScoring: Skipping - no current guideline identified');
            return;
        }

        // Show scoring initiation message via status bar
        const scoringInitMessage = 'Generating compliance score for the original clinical note...';
        updateUser(scoringInitMessage, true);

        // Generate the recommended changes summary for scoring
        const recommendedChanges = generateRecommendedChangesSummary();

        // Call the compliance scoring endpoint
        await performComplianceScoring(
            originalTranscript,
            recommendedChanges,
            currentGuideline.id,
            currentGuideline.title
        );

    } catch (error) {
        console.error('[DEBUG] triggerComplianceScoring: Error:', error);

        const errorMessage = `Compliance scoring error: ${error.message}`;
        updateUser(errorMessage, false);
    }
}

// Get current guideline information from the session
function getCurrentGuidelineInfo() {
    // Try to get guideline info from various sources
    let guidelineId = null;
    let guidelineTitle = null;

    // Check if we have a current advice session with guideline info
    if (window.latestAnalysis && window.latestAnalysis.guidelineId) {
        guidelineId = window.latestAnalysis.guidelineId;
        guidelineTitle = window.latestAnalysis.guidelineTitle;
    }

    // Fallback: check current suggestions for guideline info
    if (!guidelineId && currentSuggestions && currentSuggestions.length > 0) {
        const firstSuggestion = currentSuggestions[0];
        if (firstSuggestion.guidelineReference) {
            guidelineTitle = firstSuggestion.guidelineReference;
        }
    }

    // Fallback: check relevant guidelines for the most recent one
    if (!guidelineId && window.relevantGuidelines && window.relevantGuidelines.length > 0) {
        const mostRelevant = window.relevantGuidelines.find(g => g.category === 'mostRelevant') ||
            window.relevantGuidelines[0];
        guidelineId = mostRelevant.id;
        guidelineTitle = mostRelevant.title;
    }

    return {
        id: guidelineId,
        title: guidelineTitle || 'Unknown Guideline'
    };
}

// Generate a summary of recommended changes for scoring
function generateRecommendedChangesSummary() {
    if (!currentSuggestions || currentSuggestions.length === 0) {
        return 'No specific recommendations were generated.';
    }

    let summary = 'Recommended Changes Summary:\n\n';

    currentSuggestions.forEach((suggestion, index) => {
        const decision = userDecisions[suggestion.id];
        const status = decision ? decision.action : 'not decided';

        summary += `${index + 1}. ${suggestion.category.toUpperCase()}: ${suggestion.context}\n`;
        summary += `   Original: "${suggestion.originalText}"\n`;
        summary += `   Suggested: "${suggestion.suggestedText}"\n`;
        summary += `   Priority: ${suggestion.priority}\n`;
        summary += `   User Decision: ${status}\n\n`;
    });

    return summary;
}

// Perform the actual compliance scoring API call
async function performComplianceScoring(originalTranscript, recommendedChanges, guidelineId, guidelineTitle) {
    try {
        console.log('[DEBUG] performComplianceScoring called', {
            transcriptLength: originalTranscript.length,
            changesLength: recommendedChanges.length,
            guidelineId,
            guidelineTitle
        });

        // Get user authentication
        const user = auth.currentUser;
        if (!user) {
            throw new Error('User not authenticated');
        }
        const idToken = await user.getIdToken();

        // Call the scoring endpoint
        const response = await fetch(`${window.SERVER_URL}/scoreCompliance`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${idToken}`
            },
            body: JSON.stringify({
                originalTranscript,
                recommendedChanges,
                guidelineId,
                guidelineTitle
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`API error (${response.status}): ${errorText}`);
        }

        const result = await response.json();

        if (!result.success) {
            throw new Error(result.error || 'Compliance scoring failed');
        }

        console.log('[DEBUG] performComplianceScoring: Success', {
            overallScore: result.scoring.overallScore,
            category: result.scoring.category
        });

        // Display the compliance scoring results
        await displayComplianceScoring(result.scoring, result.guidelineTitle);

    } catch (error) {
        console.error('[DEBUG] performComplianceScoring: Error:', error);
        throw error;
    }
}

// Display compliance scoring results in the UI
async function displayComplianceScoring(scoring, guidelineTitle) {
    console.log('[DEBUG] displayComplianceScoring called', {
        overallScore: scoring.overallScore,
        category: scoring.category
    });

    // Determine score colour based on category
    const getScoreColour = (category) => {
        switch (category) {
            case 'Excellent': return '#28a745';
            case 'Good': return '#17a2b8';
            case 'Needs Improvement': return '#ffc107';
            case 'Poor': return '#dc3545';
            default: return '#6c757d';
        }
    };

    const scoreColour = getScoreColour(scoring.category);

    // Create the compliance scoring display HTML
    const scoringHtml = `
        <div class="compliance-scoring-results">
            <div class="scoring-header">
                <h3>📊 Compliance Assessment Results</h3>
                <p><em>Assessment against: ${guidelineTitle}</em></p>
            </div>
            
            <div class="overall-score">
                <div class="score-circle" style="border-color: ${scoreColour};">
                    <div class="score-number" style="color: ${scoreColour};">${scoring.overallScore}</div>
                    <div class="score-label">Overall Score</div>
                </div>
                <div class="score-category" style="color: ${scoreColour};">
                    <strong>${scoring.category}</strong>
                </div>
            </div>

            <div class="dimension-scores">
                <h4>📈 Detailed Breakdown</h4>
                <div class="dimensions-grid">
                    <div class="dimension-item">
                        <div class="dimension-name">Completeness</div>
                        <div class="dimension-score">${scoring.dimensionScores.completeness}/100</div>
                        <div class="dimension-weight">(40% weight)</div>
                    </div>
                    <div class="dimension-item">
                        <div class="dimension-name">Accuracy</div>
                        <div class="dimension-score">${scoring.dimensionScores.accuracy}/100</div>
                        <div class="dimension-weight">(35% weight)</div>
                    </div>
                    <div class="dimension-item">
                        <div class="dimension-name">Clinical Appropriateness</div>
                        <div class="dimension-score">${scoring.dimensionScores.clinicalAppropriateness}/100</div>
                        <div class="dimension-weight">(25% weight)</div>
                    </div>
                </div>
            </div>

            ${scoring.strengths && scoring.strengths.length > 0 ? `
                <div class="scoring-section strengths">
                    <h4>✅ Strengths Identified</h4>
                    <ul>
                        ${scoring.strengths.map(strength => `<li>${strength}</li>`).join('')}
                    </ul>
                </div>
            ` : ''}

            ${scoring.improvementAreas && scoring.improvementAreas.length > 0 ? `
                <div class="scoring-section improvements">
                    <h4>🎯 Areas for Improvement</h4>
                    <ul>
                        ${scoring.improvementAreas.map(area => `<li>${area}</li>`).join('')}
                    </ul>
                </div>
            ` : ''}

            <div class="key-findings">
                <h4>🔍 Key Findings</h4>
                ${scoring.keyFindings.wellDocumented && scoring.keyFindings.wellDocumented.length > 0 ? `
                    <div class="findings-group">
                        <strong>Well Documented:</strong>
                        <ul class="findings-list good">
                            ${scoring.keyFindings.wellDocumented.map(item => `<li>${item}</li>`).join('')}
                        </ul>
                    </div>
                ` : ''}
                
                ${scoring.keyFindings.missingElements && scoring.keyFindings.missingElements.length > 0 ? `
                    <div class="findings-group">
                        <strong>Missing Elements:</strong>
                        <ul class="findings-list missing">
                            ${scoring.keyFindings.missingElements.map(item => `<li>${item}</li>`).join('')}
                        </ul>
                    </div>
                ` : ''}
                
                ${scoring.keyFindings.needsRevision && scoring.keyFindings.needsRevision.length > 0 ? `
                    <div class="findings-group">
                        <strong>Needs Revision:</strong>
                        <ul class="findings-list revision">
                            ${scoring.keyFindings.needsRevision.map(item => `<li>${item}</li>`).join('')}
                        </ul>
                    </div>
                ` : ''}
            </div>

            <div class="compliance-insights">
                <h4>💡 Compliance Insights</h4>
                <p>${scoring.complianceInsights}</p>
            </div>
        </div>

        <style>
        .compliance-scoring-results {
            background: var(--bg-secondary);
            border: 2px solid #17a2b8;
            border-radius: 12px;
            padding: 25px;
            margin: 20px 0;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        }

        .scoring-header h3 {
            margin: 0 0 10px 0;
            color: #17a2b8;
            font-size: 1.4em;
        }

        .scoring-header p {
            margin: 0 0 20px 0;
            color: var(--text-secondary);
            font-style: italic;
        }

        .overall-score {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 30px;
            margin: 25px 0;
            padding: 20px;
            background: var(--bg-primary);
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }

        .score-circle {
            width: 120px;
            height: 120px;
            border: 6px solid;
            border-radius: 50%;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            background: var(--bg-primary);
        }

        .score-number {
            font-size: 2.5em;
            font-weight: bold;
            line-height: 1;
        }

        .score-label {
            font-size: 0.9em;
            color: var(--text-secondary);
            margin-top: 5px;
        }

        .score-category {
            font-size: 1.5em;
            font-weight: bold;
        }

        .dimension-scores {
            margin: 25px 0;
        }

        .dimension-scores h4 {
            margin: 0 0 15px 0;
            color: var(--text-primary);
        }

        .dimensions-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 15px;
        }

        .dimension-item {
            background: var(--bg-primary);
            padding: 15px;
            border-radius: 6px;
            text-align: center;
            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
        }

        .dimension-name {
            font-weight: 600;
            color: var(--text-primary);
            margin-bottom: 8px;
        }

        .dimension-score {
            font-size: 1.8em;
            font-weight: bold;
            color: #17a2b8;
            margin-bottom: 5px;
        }

        .dimension-weight {
            font-size: 0.85em;
            color: var(--text-secondary);
        }

        .scoring-section {
            margin: 20px 0;
            padding: 15px;
            border-radius: 6px;
        }

        .strengths {
            background: rgba(40, 167, 69, 0.15);
            border-left: 4px solid #28a745;
        }

        .improvements {
            background: rgba(255, 193, 7, 0.15);
            border-left: 4px solid #ffc107;
        }

        .scoring-section h4 {
            margin: 0 0 10px 0;
            color: var(--text-primary);
        }

        .scoring-section ul {
            margin: 0;
            padding-left: 20px;
        }

        .scoring-section li {
            margin-bottom: 8px;
            line-height: 1.4;
        }

        .key-findings {
            margin: 20px 0;
            padding: 15px;
            background: var(--bg-primary);
            border-radius: 6px;
            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
        }

        .key-findings h4 {
            margin: 0 0 15px 0;
            color: var(--text-primary);
        }

        .findings-group {
            margin-bottom: 15px;
        }

        .findings-group strong {
            color: var(--text-primary);
        }

        .findings-list {
            margin: 5px 0 0 0;
            padding-left: 20px;
        }

        .findings-list.good li {
            color: #28a745;
        }

        .findings-list.missing li {
            color: #dc3545;
        }

        .findings-list.revision li {
            color: #ffc107;
        }

        .compliance-insights {
            margin: 20px 0 0 0;
            padding: 15px;
            background: rgba(23, 162, 184, 0.15);
            border-radius: 6px;
            border-left: 4px solid #17a2b8;
        }

        .compliance-insights h4 {
            margin: 0 0 10px 0;
            color: #1976d2;
        }

        .compliance-insights p {
            margin: 0;
            line-height: 1.5;
            color: var(--text-primary);
        }

        .compliance-scoring-init, .compliance-scoring-error {
            background: var(--bg-secondary);
            border: 2px solid #17a2b8;
            border-radius: 8px;
            padding: 20px;
            margin: 15px 0;
            text-align: center;
        }

        .compliance-scoring-error {
            border-color: #dc3545;
            background: rgba(220, 53, 69, 0.15);
        }

        .scoring-spinner {
            font-size: 1.2em;
            margin-top: 10px;
        }

        @media (max-width: 768px) {
            .overall-score {
                flex-direction: column;
                gap: 15px;
            }
            
            .dimensions-grid {
                grid-template-columns: 1fr;
            }
        }
        </style>
    `;

    // Remove the loading message and add the results
    const loadingElements = document.querySelectorAll('.compliance-scoring-init');
    loadingElements.forEach(el => el.remove());

    appendToSummary1(scoringHtml, false);

    console.log('[DEBUG] displayComplianceScoring: Results displayed successfully');
}

// Function to auto-adjust summary1 height to fit content
function initializeSummaryAutoHeight() {
    const summary1 = document.getElementById('summary1');
    if (!summary1) return;

    const adjustHeight = () => {
        // Force height to auto and disable flex-grow so it shrinks to content
        summary1.style.setProperty('height', 'auto', 'important');
        summary1.style.setProperty('flex', '0 0 auto', 'important');
        summary1.style.setProperty('min-height', '0', 'important');
    };

    // Create observer to monitor content changes
    const observer = new MutationObserver((mutations) => {
        // Debug what's inside summary1 when it changes
        if (summary1.children.length > 0) {
            console.log('[DEBUG] Summary1 content changed. Children:', summary1.children.length);
            // Check for empty new-content-entry divs which might be causing whitespace
            const emptyEntries = Array.from(summary1.querySelectorAll('.new-content-entry')).filter(el => {
                // Use a more robust check for emptiness including whitespace
                const hasText = el.textContent.trim().length > 0;
                const hasMedia = el.querySelector('img, svg, video, input, select, textarea, button, hr');
                // Check if it has height but no visible content (could be margin collapse or padding)
                const style = window.getComputedStyle(el);
                const hasHeight = el.offsetHeight > 0;

                // Log suspicious entries
                if (!hasText && !hasMedia && hasHeight) {
                    console.log('[DEBUG] Suspicious empty entry found:', {
                        height: el.offsetHeight,
                        html: el.innerHTML,
                        classes: el.className
                    });
                    return true;
                }
                return false;
            });

            if (emptyEntries.length > 0) {
                console.log('[DEBUG] Found empty content entries:', emptyEntries.length);
                // Hide them to fix the whitespace
                emptyEntries.forEach(el => {
                    el.style.display = 'none';
                    console.log('[DEBUG] Hidden empty entry');
                });
            }
        }
        adjustHeight();
    });

    observer.observe(summary1, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true
    });

    // Initial adjustment
    adjustHeight();

    console.log('[DEBUG] Summary1 auto-height observer initialized');
}

// Initialize on load
document.addEventListener('DOMContentLoaded', initializeSummaryAutoHeight);