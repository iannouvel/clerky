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

// Global variable to store relevant guidelines
let relevantGuidelines = null;

// Global variables for programmatic change tracking
window.programmaticChangeHistory = [];
window.hasColoredChanges = false;
window.currentChangeIndex = -1;

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
    const defaultReplacement = currentMatch.replacement || '[REDACTED]';

    // Create the review HTML for this one match
    const reviewHtml = `
        <div class="pii-review-container" id="pii-review-current">
            <h3 style="color: #d32f2f; margin: 0 0 15px 0;">🔒 Privacy Review (${progressText})</h3>
            <p style="margin: 0 0 10px 0; font-size: 14px; color: #666;">
                Personal information detected. Please choose an action:
            </p>
            
            <div class="pii-current-match" style="background: #f5f5f5; border: 2px solid #3B82F6; padding: 15px; margin: 10px 0; border-radius: 6px;">
                <div style="margin: 0 0 10px 0;">
                    <strong style="color: #d32f2f;">Found:</strong> 
                    <span style="background: #fff; padding: 4px 8px; border-radius: 3px; font-family: monospace;">"${escapeHtml(currentMatch.text)}"</span>
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
            
            <div class="pii-navigation" style="margin-top: 20px; display: flex; gap: 10px; justify-content: center; flex-wrap: wrap;">
                ${currentIndex > 0 ? `
                    <button onclick="navigatePIIReview(-1)" style="background: #6c757d; color: white; padding: 10px 20px; border: none; border-radius: 4px; cursor: pointer; font-size: 14px;">
                        ⬅ Previous
                    </button>
                ` : ''}
                <button onclick="handlePIIDecision('replace')" style="background: #28a745; color: white; padding: 10px 20px; border: none; border-radius: 4px; cursor: pointer; font-size: 14px; font-weight: bold;">
                    ✅ Replace
                </button>
                <button onclick="handlePIIDecision('keep')" style="background: #17a2b8; color: white; padding: 10px 20px; border: none; border-radius: 4px; cursor: pointer; font-size: 14px;">
                    📝 Keep
                </button>
                <button onclick="handlePIIDecision('skip')" style="background: #ffc107; color: #000; padding: 10px 20px; border: none; border-radius: 4px; cursor: pointer; font-size: 14px;">
                    ⏭ Skip
                </button>
                <button onclick="cancelPIIReview()" style="background: #dc3545; color: white; padding: 10px 20px; border: none; border-radius: 4px; cursor: pointer; font-size: 14px;">
                    ❌ Cancel All
                </button>
            </div>
            
            <div style="margin-top: 15px; text-align: center; font-size: 13px; color: #666;">
                ${decisions.length} decision${decisions.length !== 1 ? 's' : ''} made • ${totalMatches - currentIndex - 1} remaining
            </div>
        </div>
    `;

    // Replace the review container in summary
    const existingReview = document.getElementById('pii-review-current');
    if (existingReview && existingReview.parentElement) {
        existingReview.outerHTML = reviewHtml;
    } else {
        appendToSummary1(reviewHtml, true);
    }
}

// Handle user decision on current PII match
window.handlePIIDecision = function(action) {
    const review = window.currentPIIReview;
    if (!review) return;

    const currentMatch = review.consolidatedMatches[review.currentIndex];
    
    // If action is from button click, use it; otherwise get from radio
    let finalAction = action;
    if (action === 'replace' || action === 'keep') {
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
window.navigatePIIReview = function(direction) {
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
            const replacement = match.replacement || '[REDACTED]';
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

    // Update the Clinical Note with anonymised text
    if (replacementsCount > 0) {
        pushToHistory(getUserInputContent());
        setUserInputContent(anonymisedText, true, 'PII Anonymization', replacements);
    }

    // Show completion message
    const completionHtml = `
        <div style="background: #d4edda; border: 1px solid #c3e6cb; color: #155724; padding: 15px; margin: 10px 0; border-radius: 6px;">
            <strong>✅ Privacy Review Complete</strong><br>
            ${replacementsCount} item${replacementsCount !== 1 ? 's' : ''} anonymised • ${review.decisions.length - replacementsCount} kept original
        </div>
    `;
    
    const reviewContainer = document.getElementById('pii-review-current');
    if (reviewContainer) {
        reviewContainer.outerHTML = completionHtml;
    } else {
        appendToSummary1(completionHtml, false);
    }

    // Resolve the promise
    review.resolve({
        approved: true,
        anonymisedText,
        replacementsCount
    });

    // Clean up
    window.currentPIIReview = null;
}

// Cancel the entire PII review
window.cancelPIIReview = function() {
    const review = window.currentPIIReview;
    if (!review) return;

    console.log('[PII REVIEW] Review cancelled by user');

    // Clear highlighting
    clearHighlightInEditor();

    // Show cancellation message
    const cancelHtml = `
        <div style="background: #fff3cd; border: 1px solid #ffeeba; color: #856404; padding: 15px; margin: 10px 0; border-radius: 6px;">
            <strong>⚠️ Privacy Review Cancelled</strong><br>
            Original text will be used without anonymisation
        </div>
    `;
    
    const reviewContainer = document.getElementById('pii-review-current');
    if (reviewContainer) {
        reviewContainer.outerHTML = cancelHtml;
    } else {
        appendToSummary1(cancelHtml, false);
    }

    // Resolve with cancellation
    review.resolve({
        approved: false,
        anonymisedText: review.originalText,
        replacementsCount: 0
    });

    // Clean up
    window.currentPIIReview = null;
};

// Helper to escape HTML entities
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
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

function setUserInputContent(content, isProgrammatic = false, changeType = 'Content Update', replacements = null) {
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
        
        // Store change in history
        window.programmaticChangeHistory.push({
            type: changeType,
            content: safeContent,
            timestamp: new Date(),
            editorState: editor.getJSON()
        });
        window.currentChangeIndex = window.programmaticChangeHistory.length - 1;
        
        // Only apply amber color for PII and Dynamic Advice changes
        const shouldColor = changeType.includes('PII') || changeType.includes('Dynamic Advice');
        
        if (shouldColor) {
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
        ...(categories.mostRelevant || []).map(g => ({...g, category: 'mostRelevant'})),
        ...(categories.potentiallyRelevant || []).map(g => ({...g, category: 'potentiallyRelevant'})),
        ...(categories.lessRelevant || []).map(g => ({...g, category: 'lessRelevant'}))
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

        // Enhanced debugging - log the full guideline object structure
        // console.log('[DEBUG] createPdfDownloadLink called with guideline:', {
        //     fullObject: guideline,
        //     allKeys: Object.keys(guideline),
        //     hasDownloadUrl: !!guideline.downloadUrl,
        //     hasOriginalFilename: !!guideline.originalFilename,
        //     hasFilename: !!guideline.filename,
        //     downloadUrl: guideline.downloadUrl,
        //     originalFilename: guideline.originalFilename,
        //     filename: guideline.filename,
        //     id: guideline.id,
        //     title: guideline.title
        // });

        // Only use downloadUrl field if available
        let downloadUrl;
        if (guideline.downloadUrl) {
            downloadUrl = guideline.downloadUrl;
            // console.log('[DEBUG] Using stored downloadUrl:', downloadUrl);
        } else if (guideline.originalFilename) {
            // Use original filename if available
            const encodedFilename = encodeURIComponent(guideline.originalFilename);
            downloadUrl = `https://github.com/iannouvel/clerky/raw/main/guidance/${encodedFilename}`;
            // console.log('[DEBUG] Constructed downloadUrl from originalFilename:', downloadUrl);
        } else {
            // No reliable download information available - don't show a link
            // console.warn('[DEBUG] No downloadUrl or originalFilename available for guideline:', {
            //     id: guideline.id,
            //     title: guideline.title,
            //     allAvailableFields: Object.keys(guideline),
            //     fullGuidelineObject: guideline
            // });
            // console.warn('[DEBUG] Database should provide downloadUrl or originalFilename field');
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
            // Use humanFriendlyName from database, fallback to title
            const guidelineData = window.globalGuidelines?.[g.id];
            const displayTitle = guidelineData?.humanFriendlyName || g.humanFriendlyName || g.title;
            const orgDisplay = g.organisation ? ` - ${abbreviateOrganization(g.organisation)}` : '';
            htmlContent += `<li>${displayTitle}${orgDisplay} (${g.relevance}) ${pdfLink}</li>`;
        });
        htmlContent += '</ul>';
    }

    // Add Potentially Relevant Guidelines
    if (categories.potentiallyRelevant && categories.potentiallyRelevant.length > 0) {
        htmlContent += '<h2>Potentially Relevant Guidelines</h2><ul>';
        categories.potentiallyRelevant.forEach(g => {
            const pdfLink = createPdfDownloadLink(g);
            // Use humanFriendlyName from database, fallback to title
            const guidelineData = window.globalGuidelines?.[g.id];
            const displayTitle = guidelineData?.humanFriendlyName || g.humanFriendlyName || g.title;
            const orgDisplay = g.organisation ? ` - ${abbreviateOrganization(g.organisation)}` : '';
            htmlContent += `<li>${displayTitle}${orgDisplay} (${g.relevance}) ${pdfLink}</li>`;
        });
        htmlContent += '</ul>';
    }

    // Add Less Relevant Guidelines
    if (categories.lessRelevant && categories.lessRelevant.length > 0) {
        htmlContent += '<h2>Less Relevant Guidelines</h2><ul>';
        categories.lessRelevant.forEach(g => {
            const pdfLink = createPdfDownloadLink(g);
            // Use humanFriendlyName from database, fallback to title
            const guidelineData = window.globalGuidelines?.[g.id];
            const displayTitle = guidelineData?.humanFriendlyName || g.humanFriendlyName || g.title;
            const orgDisplay = g.organisation ? ` - ${abbreviateOrganization(g.organisation)}` : '';
            htmlContent += `<li>${displayTitle}${orgDisplay} (${g.relevance}) ${pdfLink}</li>`;
        });
        htmlContent += '</ul>';
    }

    // Add Not Relevant Guidelines
    if (categories.notRelevant && categories.notRelevant.length > 0) {
        htmlContent += '<h2>Not Relevant Guidelines</h2><ul>';
        categories.notRelevant.forEach(g => {
            const pdfLink = createPdfDownloadLink(g);
            // Use humanFriendlyName from database, fallback to title
            const guidelineData = window.globalGuidelines?.[g.id];
            const displayTitle = guidelineData?.humanFriendlyName || g.humanFriendlyName || g.title;
            const orgDisplay = g.organisation ? ` - ${abbreviateOrganization(g.organisation)}` : '';
            htmlContent += `<li>${displayTitle}${orgDisplay} (${g.relevance}) ${pdfLink}</li>`;
        });
        htmlContent += '</ul>';
    }

    formattedGuidelines = htmlContent;

    // Create and display the new guideline selection interface
    createGuidelineSelectionInterface(categories, allRelevantGuidelines);
}

// New function to create guideline selection interface with checkboxes
function createGuidelineSelectionInterface(categories, allRelevantGuidelines) {
    console.log('[DEBUG] createGuidelineSelectionInterface called with:', {
        categories: categories,
        allRelevantGuidelinesLength: allRelevantGuidelines?.length || 0
    });

    // Store ALL relevant guidelines (exclude notRelevant) globally
    const allRelevantGuidelinesArray = [
        ...(categories.mostRelevant || []).map(g => ({...g, category: 'mostRelevant'})),
        ...(categories.potentiallyRelevant || []).map(g => ({...g, category: 'potentiallyRelevant'})),
        ...(categories.lessRelevant || []).map(g => ({...g, category: 'lessRelevant'}))
        // Exclude notRelevant as they're truly not applicable for checking
    ];

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

    window.relevantGuidelines = allRelevantGuidelinesArray.map(g => ({
        id: g.id, // Use clean document ID only
        title: g.title,
        filename: g.filename || g.title, // Keep both for compatibility
        originalFilename: g.originalFilename || g.title, // Preserve original filename if available
        downloadUrl: g.downloadUrl, // Preserve downloadUrl if available
        relevance: extractRelevanceScoreLocal(g.relevance), // Convert to numeric score
        category: g.category,
        originalRelevance: g.relevance, // Keep original for display purposes
        organisation: g.organisation // Preserve organisation for display
    }));

    console.log('[DEBUG] Set window.relevantGuidelines:', {
        total: window.relevantGuidelines.length,
        byCategory: {
            mostRelevant: window.relevantGuidelines.filter(g => g.category === 'mostRelevant').length,
            potentiallyRelevant: window.relevantGuidelines.filter(g => g.category === 'potentiallyRelevant').length,
            lessRelevant: window.relevantGuidelines.filter(g => g.category === 'lessRelevant').length
        }
    });

    // Helper function to create PDF download link
    function createPdfDownloadLink(guideline) {
        if (!guideline) return '';

        let downloadUrl;
        if (guideline.downloadUrl) {
            downloadUrl = guideline.downloadUrl;
        } else if (guideline.originalFilename) {
            const encodedFilename = encodeURIComponent(guideline.originalFilename);
            downloadUrl = `https://github.com/iannouvel/clerky/raw/main/guidance/${encodedFilename}`;
        } else {
            return '';
        }
        
        return `<a href="${downloadUrl}" target="_blank" title="Download PDF" class="pdf-download-link">📄</a>`;
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

    // Create the new guideline selection interface
    let htmlContent = `
        <div class="guideline-selection-interface">
            <div class="selection-header">
                <h2>📋 Select Guidelines for Dynamic Advice</h2>
                <p>Check which guidelines to generate dynamic advice for. Most relevant guidelines are pre-selected.</p>
                <div class="selection-controls">
                    <button type="button" class="selection-btn select-all-btn" onclick="selectAllGuidelines(true)">
                        ✅ Select All
                    </button>
                    <button type="button" class="selection-btn deselect-all-btn" onclick="selectAllGuidelines(false)">
                        ❌ Deselect All
                    </button>
                    <button type="button" class="action-btn primary process-selected-btn" onclick="processSelectedGuidelines()">
                        <span class="btn-icon">🚀</span>
                        <span class="btn-text">Process Selected Guidelines</span>
                    </button>
                </div>
            </div>
    `;

    // Add Most Relevant Guidelines (auto-checked)
    if (categories.mostRelevant && categories.mostRelevant.length > 0) {
        htmlContent += '<div class="guideline-category"><h3>🎯 Most Relevant Guidelines</h3><div class="guidelines-list">';
        categories.mostRelevant.forEach((g, index) => {
            const pdfLink = createPdfDownloadLink(g);
            // Use humanFriendlyName from database, fallback to title
            const guidelineData = window.globalGuidelines?.[g.id];
            const displayTitle = guidelineData?.humanFriendlyName || g.humanFriendlyName || g.title;
            const orgDisplay = g.organisation ? ` - ${abbreviateOrganization(g.organisation)}` : '';
            
            htmlContent += `
                <div class="guideline-item">
                    <label class="guideline-checkbox-label">
                        <input type="checkbox" 
                               class="guideline-checkbox" 
                               data-guideline-id="${g.id}" 
                               data-category="mostRelevant"
                               checked="checked">
                        <span class="checkmark"></span>
                        <div class="guideline-info">
                            <div class="guideline-content">
                                <span class="guideline-title">${displayTitle}${orgDisplay}</span>
                                <span class="relevance">${formatRelevanceScore(g.relevance)}</span>
                                ${pdfLink}
                            </div>
                        </div>
                    </label>
                </div>
            `;
        });
        htmlContent += '</div></div>';
    }

    // Add Potentially Relevant Guidelines (not checked)
    if (categories.potentiallyRelevant && categories.potentiallyRelevant.length > 0) {
        htmlContent += '<div class="guideline-category"><h3>⚠️ Potentially Relevant Guidelines</h3><div class="guidelines-list">';
        categories.potentiallyRelevant.forEach((g, index) => {
            const pdfLink = createPdfDownloadLink(g);
            // Use humanFriendlyName from database, fallback to title
            const guidelineData = window.globalGuidelines?.[g.id];
            const displayTitle = guidelineData?.humanFriendlyName || g.humanFriendlyName || g.title;
            const orgDisplay = g.organisation ? ` - ${abbreviateOrganization(g.organisation)}` : '';
            
            htmlContent += `
                <div class="guideline-item">
                    <label class="guideline-checkbox-label">
                        <input type="checkbox" 
                               class="guideline-checkbox" 
                               data-guideline-id="${g.id}" 
                               data-category="potentiallyRelevant">
                        <span class="checkmark"></span>
                        <div class="guideline-info">
                            <div class="guideline-content">
                                <span class="guideline-title">${displayTitle}${orgDisplay}</span>
                                <span class="relevance">${formatRelevanceScore(g.relevance)}</span>
                                ${pdfLink}
                            </div>
                        </div>
                    </label>
                </div>
            `;
        });
        htmlContent += '</div></div>';
    }

    // Add Less Relevant Guidelines (not checked)
    if (categories.lessRelevant && categories.lessRelevant.length > 0) {
        htmlContent += '<div class="guideline-category"><h3>📉 Less Relevant Guidelines</h3><div class="guidelines-list">';
        categories.lessRelevant.forEach((g, index) => {
            const pdfLink = createPdfDownloadLink(g);
            // Use humanFriendlyName from database, fallback to title
            const guidelineData = window.globalGuidelines?.[g.id];
            const displayTitle = guidelineData?.humanFriendlyName || g.humanFriendlyName || g.title;
            const orgDisplay = g.organisation ? ` - ${abbreviateOrganization(g.organisation)}` : '';
            
            htmlContent += `
                <div class="guideline-item">
                    <label class="guideline-checkbox-label">
                        <input type="checkbox" 
                               class="guideline-checkbox" 
                               data-guideline-id="${g.id}" 
                               data-category="lessRelevant">
                        <span class="checkmark"></span>
                        <div class="guideline-info">
                            <div class="guideline-content">
                                <span class="guideline-title">${displayTitle}${orgDisplay}</span>
                                <span class="relevance">${formatRelevanceScore(g.relevance)}</span>
                                ${pdfLink}
                            </div>
                        </div>
                    </label>
                </div>
            `;
        });
        htmlContent += '</div></div>';
    }

    // Add Not Relevant Guidelines (for completeness, not checked)
    if (categories.notRelevant && categories.notRelevant.length > 0) {
        htmlContent += '<div class="guideline-category"><h3>❌ Not Relevant Guidelines</h3><div class="guidelines-list">';
        categories.notRelevant.forEach((g, index) => {
            const pdfLink = createPdfDownloadLink(g);
            // Use humanFriendlyName from database, fallback to title
            const guidelineData = window.globalGuidelines?.[g.id];
            const displayTitle = guidelineData?.humanFriendlyName || g.humanFriendlyName || g.title;
            const orgDisplay = g.organisation ? ` - ${abbreviateOrganization(g.organisation)}` : '';
            
            htmlContent += `
                <div class="guideline-item">
                    <label class="guideline-checkbox-label">
                        <input type="checkbox" 
                               class="guideline-checkbox" 
                               data-guideline-id="${g.id}" 
                               data-category="notRelevant">
                        <span class="checkmark"></span>
                        <div class="guideline-info">
                            <div class="guideline-content">
                                <span class="guideline-title">${displayTitle}${orgDisplay}</span>
                                <span class="relevance">${formatRelevanceScore(g.relevance)}</span>
                                ${pdfLink}
                            </div>
                        </div>
                    </label>
                </div>
            `;
        });
        htmlContent += '</div></div>';
    }

    htmlContent += `
            <div class="selection-info">
                <p><strong>How it works:</strong> Selected guidelines will be processed one-by-one. After each guideline is processed and changes are incorporated into your transcript, the system will move to the next selected guideline.</p>
            </div>
        </div>
        
        <style>
        .guideline-selection-interface {
            background: #f8f9fa;
            border: 1px solid #dee2e6;
            border-radius: 8px;
            padding: 20px;
            margin: 20px 0;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        }
        
        .selection-header h2 {
            margin: 0 0 10px 0;
            color: #2c3e50;
            font-size: 1.3em;
        }
        
        .selection-header p {
            margin: 0 0 15px 0;
            color: #6c757d;
            line-height: 1.5;
        }
        
        .selection-controls {
            margin: 15px 0;
            display: flex;
            gap: 10px;
            flex-wrap: wrap;
        }
        
        .selection-btn {
            padding: 8px 16px;
            border: 1px solid #ddd;
            border-radius: 4px;
            background: white;
            cursor: pointer;
            font-size: 0.9em;
            transition: all 0.2s;
        }
        
        .guideline-selection-interface .action-btn {
            padding: 8px 16px;
            border: 1px solid #ddd;
            border-radius: 4px;
            cursor: pointer;
            font-size: 0.9em;
            transition: all 0.2s;
        }
        
        .action-btn.primary {
            background: #007bff;
            color: white;
            border-color: #007bff;
            font-weight: 500;
        }
        
        .selection-btn:hover {
            background: #f8f9fa;
            border-color: #007bff;
        }
        
        .guideline-selection-interface .action-btn:hover {
            background: #f8f9fa;
            border-color: #007bff;
        }
        
        .action-btn.primary:hover {
            background: #0056b3;
        }
        
        .guideline-category {
            margin: 20px 0;
        }
        
        .guideline-category h3 {
            margin: 0 0 10px 0;
            color: #2c3e50;
            font-size: 1.1em;
            border-bottom: 1px solid #dee2e6;
            padding-bottom: 5px;
        }
        
        .guidelines-list {
            border: 1px solid #ddd;
            border-radius: 4px;
            background: white;
        }
        
        .guideline-item {
            border-bottom: 1px solid #eee;
            transition: background 0.2s;
        }
        
        .guideline-item:hover {
            background: #f8f9fa;
        }
        
        .guideline-item:last-child {
            border-bottom: none;
        }
        
        .guideline-checkbox-label {
            display: flex;
            align-items: center;
            padding: 12px 15px;
            cursor: pointer;
            width: 100%;
        }
        
        .guideline-checkbox {
            margin-right: 12px;
            width: 18px;
            height: 18px;
            cursor: pointer;
        }
        
        .guideline-info {
            flex: 1;
        }
        
        .guideline-title {
            font-weight: 500;
            color: #2c3e50;
            line-height: 1.3;
            flex: 1;
            min-width: 0;
        }
        
        .guideline-content {
            display: flex;
            align-items: center;
            gap: 12px;
            flex-wrap: wrap;
        }
        
        .relevance {
            color: #28a745;
            font-weight: 500;
            white-space: nowrap;
            font-size: 0.9em;
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
            display: inline !important;
            width: auto !important;
            height: auto !important;
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

    // Append the generated HTML to the summary view
    appendToSummary1(htmlContent, false);
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

// Global variables for dynamic advice
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
        markedScript.onload = function() {
            console.log('Marked script loaded successfully');
            window.marked = marked;
            console.log('Marked library initialized');
            resolve();
        };
        markedScript.onerror = function(error) {
            console.error('Error loading marked library:', error);
            reject(error);
        };
        console.log('Appending marked script to document head...');
        document.head.appendChild(markedScript);
    });
}

// Make loadClinicalIssues available globally
window.loadClinicalIssues = async function() {
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
window.repairGuidelineContent = async function() {
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
window.findMissingGuidelines = async function() {
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
window.compareDuplicates = async function(duplicateId) {
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
                        humanFriendlyName: g.humanFriendlyName || g.human_friendly_name || g.title,
                        content: g.content,
                        summary: g.summary,
                        keywords: g.keywords,
                        condensed: g.condensed,
                        organisation: g.organisation,
                        downloadUrl: g.downloadUrl,
                        originalFilename: g.originalFilename
                    };
                    return acc;
                }, {});

                window.guidelinesLoaded = true;
                window.guidelinesLoading = false;
                return cachedGuidelines;
            }
        }
        
        console.log('[DEBUG] Loading guidelines from Firestore...');
        
        // Get user ID token using the imported auth object with force refresh to prevent 403 errors
        const user = auth.currentUser;
        if (!user) {
            throw new Error('User not authenticated');
        }
        const idToken = await user.getIdToken(true); // Force refresh token

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
                humanFriendlyName: g.humanFriendlyName || g.human_friendly_name || g.title,
                content: g.content,
                summary: g.summary,
                keywords: g.keywords,
                condensed: g.condensed,
                organisation: g.organisation,
                downloadUrl: g.downloadUrl,
                originalFilename: g.originalFilename
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
            
            // When guideline count changes, trigger comprehensive metadata completion
            if (countChanged && previousGuidelineCount > 0) {
                console.log(`[METADATA_COMPLETION] 🎯 Guideline count changed (${previousGuidelineCount} → ${currentCount}). Skipping automatic metadata completion to avoid memory issues.`);
                
                // NOTE: Automatic metadata completion disabled to prevent server memory crashes
                // The batch sync endpoint handles metadata extraction inline
                // await triggerMetadataCompletionForAll();
                
                // Refresh guidelines data after processing
                setTimeout(() => {
                    window.guidelinesLoading = false; // Reset flag to allow reload
                    loadGuidelinesFromFirestore();
                }, 3000);
            } else if (addedDocs.length > 0) {
                // If only processing new guidelines without count change detection
                setTimeout(() => {
                    window.guidelinesLoading = false; // Reset flag to allow reload
                    loadGuidelinesFromFirestore();
                }, 2000);
            }
            
            // Update the previous count for next comparison
            previousGuidelineCount = currentCount;
            
            if (modifiedDocs.length > 0) {
                console.log(`[FIRESTORE_LISTENER] ${modifiedDocs.length} guidelines updated`);
                
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
    
    if (window.currentChangeIndex > 0) {
        window.currentChangeIndex--;
        const change = window.programmaticChangeHistory[window.currentChangeIndex];
        console.log('[UNDO] Reverting to change:', change.type);
        editor.commands.setContent(change.editorState);
        updateUndoRedoButtons();
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
    
    if (undoBtn) {
        undoBtn.disabled = window.clinicalNoteHistoryIndex <= 0;
    }
    if (redoBtn) {
        redoBtn.disabled = window.clinicalNoteHistoryIndex >= window.clinicalNoteHistory.length - 1;
    }
}

// Initialize TipTap editor integration when ready
function initializeTipTapIntegration() {
    const editor = window.editors?.userInput;
    if (!editor) {
        console.warn('[TIPTAP] Editor not ready, waiting for tiptapReady event');
        return;
    }
    
    console.log('[TIPTAP] Initializing integration');
    
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
    window.clearEditor = function() {
        const editor = window.editors?.userInput;
        if (editor && editor.commands) {
            editor.commands.clearContent();
            editor.commands.focus();
            console.log('[TIPTAP] Editor cleared');
        }
    };
    
    // Nuclear option - force editor to be editable by any means necessary
    window.nuclearFixEditor = function() {
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

// Listen for TipTap ready event
window.addEventListener('tiptapReady', initializeTipTapIntegration);

// Also try to initialize if TipTap is already loaded
document.addEventListener('DOMContentLoaded', function() {
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

async function findRelevantGuidelines(suppressHeader = false) {
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
                        
                        // Add anonymisation notice to the summary
                        const anonymisationNotice = `\n🔒 **Privacy Protection Applied**\n` +
                            `- ${reviewResult.replacementsCount} personal ${reviewResult.replacementsCount === 1 ? 'item' : 'items'} redacted\n` +
                            `- Clinical information preserved\n\n`;
                        appendToSummary1(anonymisationNotice, false);
                    } else {
                        // User cancelled the review, use original transcript
                        console.log('[ANONYMISER] User cancelled PII review, using original transcript');
                        anonymisedTranscript = transcript;
                        appendToSummary1('\n⚠️ **Privacy Note:** PII review was cancelled, using original data\n\n', false);
                    }
                } else {
                    console.log('[ANONYMISER] No significant PII detected');
                    appendToSummary1('\n✅ **Privacy Check:** No significant personal information detected\n\n', false);
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
        const loadingMessage = 'Loading guidelines from database...\n';
        appendToSummary1(loadingMessage, false);

        // Get guidelines and summaries from Firestore
        const guidelines = await loadGuidelinesFromFirestore();
        
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
        const analyzeMessage = `Analysing transcript against ${guidelinesList.length} available guidelines...\n`;
        appendToSummary1(analyzeMessage, false);

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
                anonymisationInfo: anonymisationInfo // Include anonymisation metadata
            })
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
            throw new Error(data.error || 'Failed to find relevant guidelines');
        }

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

        // Update progress with completion
        const completionMessage = 'Analysis complete! Categorising relevant guidelines...\n\n';
        appendToSummary1(completionMessage, false);

        // Process and display the results with the new selection interface
        createGuidelineSelectionInterface(data.categories, window.relevantGuidelines);

        // Add final summary
        const totalRelevant = (data.categories.mostRelevant?.length || 0) + 
                            (data.categories.potentiallyRelevant?.length || 0) + 
                            (data.categories.lessRelevant?.length || 0);
        
        const summaryMessage = `## Summary\n\nFound ${totalRelevant} relevant guidelines out of ${guidelinesList.length} total guidelines.\n\n` +
                              `**Most Relevant:** ${data.categories.mostRelevant?.length || 0} guidelines\n` +
                              `**Potentially Relevant:** ${data.categories.potentiallyRelevant?.length || 0} guidelines\n` +
                              `**Less Relevant:** ${data.categories.lessRelevant?.length || 0} guidelines\n\n` +
                              `💡 **Tip:** Click on the 📄 PDF links next to any guideline to download the full document.\n\n` +
                              `Guidelines are now ready for analysis. Use "Check against guidelines" to proceed.\n`;
        
        appendToSummary1(summaryMessage, false);
    } catch (error) {
        console.error('[DEBUG] Error in findRelevantGuidelines:', {
            error: error.message,
            stack: error.stack
        });
        
        // Display error in summary1
        const errorMessage = `\n❌ **Error finding relevant guidelines:** ${error.message}\n\nPlease try again or contact support if the problem persists.\n`;
        appendToSummary1(errorMessage, false);
        
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
                        
                        // Add anonymisation notice to the summary
                        const anonymisationNotice = `\n🔒 **Privacy Protection Applied**\n` +
                            `- ${reviewResult.replacementsCount} personal ${reviewResult.replacementsCount === 1 ? 'item' : 'items'} redacted\n` +
                            `- Clinical information preserved\n\n`;
                        appendToSummary1(anonymisationNotice, false);
                    } else {
                        // User cancelled the review, use original transcript
                        console.log('[ANONYMISER] User cancelled PII review, using original transcript');
                        anonymisedTranscript = transcript;
                        appendToSummary1('\n⚠️ **Privacy Note:** PII review was cancelled, using original data\n\n', false);
                    }
                } else {
                    console.log('[ANONYMISER] No significant PII detected');
                    appendToSummary1('\n✅ **Privacy Check:** No significant personal information detected\n\n', false);
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
            throw new Error('Invalid response format from server');
        }

        // Replace the user input with the generated note
        console.log('[DEBUG] Replacing user input with generated note');
        setUserInputContent(data.note, true, 'AI Generated Clinical Note');
        console.log('[DEBUG] Note replaced in user input successfully');

    } catch (error) {
        console.error('[DEBUG] Error in generateClinicalNote:', {
            error: error.message,
            stack: error.stack
        });
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

function appendToSummary1(content, clearExisting = false) {
    console.log('[DEBUG] appendToSummary1 called with:', {
        contentLength: content?.length,
        clearExisting,
        contentPreview: content?.substring(0, 100) + '...'
    });

    const summary1 = document.getElementById('summary1');
    if (!summary1) {
        console.error('[DEBUG] summary1 element not found');
        return;
    }

    try {
        // Store the initial scroll position if not clearing existing content
        const initialScrollTop = clearExisting ? 0 : summary1.scrollTop;
        const initialScrollHeight = clearExisting ? 0 : summary1.scrollHeight;

        // Clear existing content if requested
        if (clearExisting) {
            summary1.innerHTML = '';
            // Reset scroll tracking when clearing content
            pendingScrollTarget = null;
            if (scrollTimeout) {
                clearTimeout(scrollTimeout);
                scrollTimeout = null;
            }
        }

        // Check if content is already HTML
        const isHtml = /<[a-z][\s\S]*>/i.test(content);
        console.log('[DEBUG] Content type check:', { isHtml });

        let processedContent;
        if (isHtml) {
            // If content is already HTML, use it directly
            processedContent = content;
        } else {
            // If content is markdown, parse it with marked
            if (!window.marked) {
                console.error('[DEBUG] Marked library not loaded');
                processedContent = content;
            } else {
                try {
                    processedContent = window.marked.parse(content);
                    console.log('[DEBUG] Marked parsing successful');
                } catch (parseError) {
                    console.error('[DEBUG] Error parsing with marked:', parseError);
                    processedContent = content;
                }
            }
        }

        // Create a temporary container to sanitize the content
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = processedContent;

        // Create a wrapper div for the new content to help with scrolling
        const newContentWrapper = document.createElement('div');
        newContentWrapper.className = 'new-content-entry';
        newContentWrapper.innerHTML = tempDiv.innerHTML;

        // Append the sanitized content
        summary1.appendChild(newContentWrapper);
        console.log('[DEBUG] Content appended successfully');

        // Store the first new content element for scrolling (if we don't have one yet)
        if (!pendingScrollTarget || clearExisting) {
            pendingScrollTarget = newContentWrapper;
            console.log('[DEBUG] Set new scroll target');
        }

        // Clear any existing scroll timeout
        if (scrollTimeout) {
            clearTimeout(scrollTimeout);
        }

        // Set up debounced scrolling - only scroll after content additions have stopped for 300ms
        scrollTimeout = setTimeout(() => {
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    try {
                        // If clearing existing content, scroll to top
                        if (clearExisting) {
                            summary1.scrollTop = 0;
                            console.log('[DEBUG] Scrolled to top (cleared existing content)');
                        } else if (pendingScrollTarget) {
                            // Calculate the scroll position to show the top of the first new content
                            const newContentOffsetTop = pendingScrollTarget.offsetTop;
                            const containerHeight = summary1.clientHeight;
                            
                            // Position the scroll so the top of the new content is visible
                            // Add a small buffer (20px) to ensure it's clearly visible
                            const targetScrollTop = Math.max(0, newContentOffsetTop - 20);
                            
                            summary1.scrollTop = targetScrollTop;
                            
                            console.log('[DEBUG] Debounced scroll to show top of first new content:', {
                                newContentOffsetTop,
                                containerHeight,
                                targetScrollTop,
                                finalScrollTop: summary1.scrollTop,
                                summary1ScrollHeight: summary1.scrollHeight
                            });
                        }

                        // Reset the scroll target after scrolling
                        pendingScrollTarget = null;
                        scrollTimeout = null;

                    } catch (scrollError) {
                        console.error('[DEBUG] Error in debounced scroll:', scrollError);
                        // Simple fallback
                        try {
                            if (!clearExisting && pendingScrollTarget) {
                                const maxScroll = summary1.scrollHeight - summary1.clientHeight;
                                const newContentHeight = pendingScrollTarget.offsetHeight;
                                const targetScroll = Math.max(0, maxScroll - newContentHeight - 50);
                                summary1.scrollTop = targetScroll;
                                console.log('[DEBUG] Fallback scroll completed');
                            }
                        } catch (fallbackError) {
                            console.error('[DEBUG] Fallback scroll also failed:', fallbackError);
                        }
                        
                        // Reset tracking even if scroll failed
                        pendingScrollTarget = null;
                        scrollTimeout = null;
                    }
                });
            });
        }, 300); // Wait 300ms after the last content addition before scrolling

    } catch (error) {
        console.error('[DEBUG] Error in appendToSummary1:', error);
        // Fallback to direct content append if something goes wrong
        summary1.innerHTML += content;
    }
}

// Function to replace content in the user input field
function appendToOutputField(content, clearExisting = true) {
    console.log('[DEBUG] appendToOutputField called (now replacing user input) with:', {
        contentLength: content?.length,
        clearExisting,
        contentPreview: content?.substring(0, 100) + '...'
    });

    const userInput = document.getElementById('userInput');
    if (!userInput) {
        console.error('[DEBUG] userInput element not found');
        return;
    }

    try {
        // Strip HTML tags for plain text display in textarea
        let processedContent = content;
        if (/<[a-z][\s\S]*>/i.test(content)) {
            // Remove HTML tags and convert to plain text
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = content;
            processedContent = tempDiv.textContent || tempDiv.innerText || '';
        }

        if (clearExisting) {
            setUserInputContent(processedContent, true, 'Content Replacement');
        } else {
            const currentContent = getUserInputContent();
            setUserInputContent(currentContent + '\n\n' + processedContent, true, 'Content Addition');
        }

        console.log('[DEBUG] Content replaced in user input successfully');
    } catch (error) {
        console.error('[DEBUG] Error in appendToOutputField:', error);
        setUserInputContent(content, true, 'Error Recovery');
    }
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
        
        // Update UI to show guidelines being processed
        const processingStatus = `Analysing against ${guidelinesToProcess.length} most relevant guideline${guidelinesToProcess.length > 1 ? 's' : ''}...\n\n`;
        appendToSummary1(processingStatus, false);
        
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
                        transcript: transcript,
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

        // Store the latest analysis result and guideline data for dynamic advice
        if (successCount > 0) {
            console.log('[DEBUG] Storing analysis result for dynamic advice');
            
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
                            console.log('[DEBUG] Showed fallback dynamic advice button');
                        }
                    }
                }, 1000);
            } else {
                // For single guideline, show the "Make Advice Dynamic" button as before
                const makeDynamicAdviceBtn = document.getElementById('makeDynamicAdviceBtn');
                if (makeDynamicAdviceBtn) {
                    makeDynamicAdviceBtn.style.display = 'inline-block';
                    console.log('[DEBUG] Made dynamic advice button visible for single guideline');
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

// Dynamic Advice function - converts guideline analysis into interactive suggestions
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
            throw new Error(result.error || 'Dynamic advice generation failed');
        }

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
        
        // Display error message using appendToOutputField
        const errorHtml = `
            <div class="dynamic-advice-error">
                <h3>❌ Error generating interactive suggestions</h3>
                <p><strong>Error:</strong> ${error.message}</p>
                <p>The original analysis is still available above.</p>
            </div>
        `;
        appendToSummary1(errorHtml, false);
        
        throw error;
    }
}

// ===== One-at-a-Time Dynamic Advice Workflow =====

// Global state for dynamic advice review  
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

// Helper function to insert text at the determined point
function insertTextAtPoint(currentContent, newText, insertionPoint) {
    console.log('[DEBUG] insertTextAtPoint:', {
        contentLength: currentContent.length,
        newTextLength: newText.length,
        insertionPoint
    });

    const { section, insertionMethod, anchorText } = insertionPoint;

    // If method is append to a section, find the section and append within it
    if (insertionMethod === 'append' && section) {
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
                return currentContent.slice(0, insertPosition) + '\n\n' + newText + currentContent.slice(insertPosition);
            } else {
                // No next section found, append to end of document (this section is last)
                console.log('[DEBUG] insertTextAtPoint: Section is last, appending to end');
                const spacing = currentContent.trim() ? '\n\n' : '';
                return currentContent + spacing + newText;
            }
        } else {
            console.warn('[DEBUG] insertTextAtPoint: Section not found:', section, '- appending to end');
            const spacing = currentContent.trim() ? '\n\n' : '';
            return currentContent + spacing + newText;
        }
    }

    // For insertAfter or insertBefore with anchor text
    if (anchorText && (insertionMethod === 'insertAfter' || insertionMethod === 'insertBefore')) {
        const anchorIndex = currentContent.indexOf(anchorText);
        
        if (anchorIndex !== -1) {
            if (insertionMethod === 'insertAfter') {
                const insertPosition = anchorIndex + anchorText.length;
                return currentContent.slice(0, insertPosition) + '\n\n' + newText + '\n\n' + currentContent.slice(insertPosition);
            } else { // insertBefore
                return currentContent.slice(0, anchorIndex) + newText + '\n\n' + currentContent.slice(anchorIndex);
            }
        } else {
            console.warn('[DEBUG] insertTextAtPoint: Anchor text not found, appending to end');
            const spacing = currentContent.trim() ? '\n\n' : '';
            return currentContent + spacing + newText;
        }
    }

    // Fallback: append to end
    console.warn('[DEBUG] insertTextAtPoint: Using fallback - appending to end');
    const spacing = currentContent.trim() ? '\n\n' : '';
    return currentContent + spacing + newText;
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

// Helper function to create guideline viewer link
function createGuidelineViewerLink(guidelineId, guidelineTitle, guidelineFilename, context, hasVerbatimQuote) {
    if (!guidelineId && !guidelineFilename) {
        return '<em>Guideline reference not available</em>';
    }

    const linkText = guidelineTitle || guidelineFilename || 'View Guideline PDF';
    
    // Extract search text from context if available AND hasVerbatimQuote is true
    let searchText = null;
    if (context && hasVerbatimQuote !== false) {
        const decodedContext = unescapeHtml(context);
        searchText = extractQuotedText(decodedContext);
        console.log('[DEBUG] Extracted search text for PDF.js viewer:', searchText ? searchText.substring(0, 50) + '...' : 'none');
    }
    
    // Store search text and guideline ID for auth handler to use
    const linkData = {
        guidelineId: guidelineId,
        searchText: searchText
    };
    
    // Add note if hasVerbatimQuote is false (paraphrased content)
    const paraphraseNote = hasVerbatimQuote === false 
        ? ' <span style="color: #f59e0b; font-size: 12px; font-weight: normal;">(Guideline recommendation paraphrased)</span>' 
        : '';
    
    // Create link with onclick to build authenticated URL and open viewer
    // We'll build the final URL in prepareViewerAuth to include the fresh token
    return `<a href="#" data-link-data='${JSON.stringify(linkData)}' target="_blank" rel="noopener noreferrer" onclick="prepareViewerAuth(event, this); return false;" style="color: #0ea5e9; text-decoration: underline; font-weight: 500;">📄 ${escapeHtml(linkText)}</a>${paraphraseNote}`;
}

// Function to prepare auth token for viewer
window.prepareViewerAuth = async function(event, linkElement) {
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
            console.log('[DEBUG] Added search parameters:', {
                searchTextLength: searchText.length,
                searchTextPreview: searchText.substring(0, 100) + '...',
                fullSearchText: searchText,
                encodedLength: encodeURIComponent(searchText).length
            });
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
        appendToSummary1(noSuggestionsHtml, false);
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
    const guidelineLink = createGuidelineViewerLink(guidelineId, guidelineTitle, guidelineFilename, suggestion.context, suggestion.hasVerbatimQuote);

    const suggestionHtml = `
        <div class="dynamic-advice-container" id="suggestion-review-current">
            <h3 style="color: #2563eb; margin: 0 0 15px 0;">💡 Suggestion ${progressText} (${suggestion.priority || 'medium'} priority)</h3>
            <p style="margin: 0 0 10px 0; font-size: 13px; color: #666;"><em>From: ${guidelineTitle || 'Guideline Analysis'}</em></p>
            <div class="suggestion-current" style="background: #f5f5f5; border: 2px solid #3B82F6; padding: 15px; margin: 10px 0; border-radius: 6px;">
                <div style="margin: 0 0 15px 0;"><strong style="color: #2563eb;">${categoryIcon} ${suggestion.category || 'Suggestion'}:</strong></div>
                ${suggestion.originalText ? `<div style="margin: 0 0 15px 0; padding: 10px; background: #fff; border-radius: 4px;"><strong style="color: #dc2626;">${getOriginalTextLabel(suggestion.originalText, suggestion.category)}</strong><br><span style="font-family: monospace; background: #fef3c7; padding: 4px 8px; border-radius: 3px; display: inline-block; margin-top: 5px;">"${escapeHtml(suggestion.originalText)}"</span></div>` : ''}
                <div style="margin: 0 0 15px 0; padding: 10px; background: #fff; border-radius: 4px;"><strong style="color: #16a34a;">Suggested:</strong><br><span style="font-family: monospace; background: #dcfce7; padding: 4px 8px; border-radius: 3px; display: inline-block; margin-top: 5px;">"${escapeHtml(suggestion.suggestedText)}"</span></div>
                <div style="margin: 0 0 15px 0; padding: 10px; background: #eff6ff; border-radius: 4px; border-left: 3px solid #3b82f6;"><strong>Why:</strong> ${escapeHtml(suggestion.context)}</div>
                <div style="margin: 0; padding: 10px; background: #f0f9ff; border-radius: 4px; border-left: 3px solid #0ea5e9;"><strong>Link:</strong> ${guidelineLink}</div>
            </div>
            <div class="modify-section" id="modify-section-current" style="display: none; background: #fef3c7; border: 2px solid #eab308; padding: 15px; margin: 10px 0; border-radius: 6px;">
                <label for="modify-textarea-current" style="display: block; margin-bottom: 8px; font-weight: bold;">Your modified text:</label>
                <textarea id="modify-textarea-current" style="width: 100%; min-height: 80px; padding: 10px; border: 1px solid #ddd; border-radius: 4px; font-family: monospace;" placeholder="Enter your custom text here...">${escapeHtml(suggestion.suggestedText)}</textarea>
                <div style="margin-top: 10px;">
                    <button onclick="confirmCurrentModification()" style="background: #16a34a; color: white; padding: 10px 20px; border: none; border-radius: 4px; cursor: pointer; font-size: 14px; font-weight: bold;">✅ Confirm</button>
                    <button onclick="hideModifySection()" style="background: #6c757d; color: white; padding: 10px 20px; border: none; border-radius: 4px; cursor: pointer; font-size: 14px; margin-left: 10px;">❌ Cancel</button>
                </div>
            </div>
            <div class="suggestion-navigation" style="margin-top: 20px; display: flex; gap: 10px; justify-content: center; flex-wrap: wrap;">
                ${currentIndex > 0 ? `<button onclick="navigateSuggestion(-1)" style="background: #6c757d; color: white; padding: 10px 20px; border: none; border-radius: 4px; cursor: pointer; font-size: 14px;">⬅ Previous</button>` : ''}
                <button onclick="handleCurrentSuggestionAction('accept')" style="background: #16a34a; color: white; padding: 10px 20px; border: none; border-radius: 4px; cursor: pointer; font-size: 14px; font-weight: bold;">✅ Accept</button>
                <button onclick="handleCurrentSuggestionAction('reject')" style="background: #dc2626; color: white; padding: 10px 20px; border: none; border-radius: 4px; cursor: pointer; font-size: 14px;">❌ Reject</button>
                <button onclick="showModifySection()" style="background: #f59e0b; color: white; padding: 10px 20px; border: none; border-radius: 4px; cursor: pointer; font-size: 14px;">✏️ Modify</button>
                <button onclick="handleCurrentSuggestionAction('skip')" style="background: #64748b; color: white; padding: 10px 20px; border: none; border-radius: 4px; cursor: pointer; font-size: 14px;">⏭ Skip</button>
                <button onclick="cancelSuggestionReview()" style="background: #991b1b; color: white; padding: 10px 20px; border: none; border-radius: 4px; cursor: pointer; font-size: 14px;">❌ Cancel All</button>
            </div>
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

window.showModifySection = function() { document.getElementById('modify-section-current').style.display = 'block'; };
window.hideModifySection = function() { document.getElementById('modify-section-current').style.display = 'none'; };

window.handleCurrentSuggestionAction = async function(action) {
    const review = window.currentSuggestionReview;
    if (!review) return;
    const suggestion = review.suggestions[review.currentIndex];
    review.decisions.push({ suggestion, action });
    
    if (action === 'accept' && suggestion.suggestedText) {
        const currentContent = getUserInputContent();
        let newContent;
        
        // Handle additions (missing documentation) vs modifications (replacing existing text)
        if (suggestion.category === 'addition' || !suggestion.originalText) {
            // Addition: use smart insertion to determine best location
            console.log('[DEBUG] handleCurrentSuggestionAction: Using smart insertion for addition');
            
            // Use cached insertion point if available, otherwise fetch it now
            let insertionPoint = suggestion.cachedInsertionPoint;
            if (!insertionPoint) {
                console.log('[DEBUG] handleCurrentSuggestionAction: No cached insertion point, fetching now');
                insertionPoint = await determineInsertionPoint(suggestion, currentContent);
            } else {
                console.log('[DEBUG] handleCurrentSuggestionAction: Using cached insertion point');
            }
            console.log('[DEBUG] handleCurrentSuggestionAction: Insertion point:', insertionPoint);
            
            // Insert at determined point
            newContent = insertTextAtPoint(currentContent, suggestion.suggestedText, insertionPoint);
            setUserInputContent(newContent, true, 'Dynamic Advice - Addition', [{findText: '', replacementText: suggestion.suggestedText}]);
        } else if (suggestion.originalText) {
            // Modification/Deletion: replace existing text
            newContent = currentContent.replace(new RegExp(suggestion.originalText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), suggestion.suggestedText);
            setUserInputContent(newContent, true, 'Dynamic Advice - Accepted', [{findText: suggestion.originalText, replacementText: suggestion.suggestedText}]);
        }
    }
    
    clearHighlightInEditor();
    review.currentIndex++;
    showCurrentSuggestion();
};

window.confirmCurrentModification = function() {
    const review = window.currentSuggestionReview;
    if (!review) return;
    const modifyTextarea = document.getElementById('modify-textarea-current');
    if (!modifyTextarea) return;
    const modifiedText = modifyTextarea.value.trim();
    if (!modifiedText) { alert('Please enter some text.'); return; }
    const suggestion = review.suggestions[review.currentIndex];
    review.decisions.push({ suggestion, action: 'modify', modifiedText });
    
    const currentContent = getUserInputContent();
    let newContent;
    
    // Handle additions (missing documentation) vs modifications (replacing existing text)
    if (suggestion.category === 'addition' || !suggestion.originalText) {
        // Addition: append the modified text to the end of the document
        const spacing = currentContent.trim() ? '\n\n' : '';
        newContent = currentContent + spacing + modifiedText;
        setUserInputContent(newContent, true, 'Dynamic Advice - Modified Addition', [{findText: '', replacementText: modifiedText}]);
    } else if (suggestion.originalText) {
        // Modification: replace existing text with user's modified version
        newContent = currentContent.replace(new RegExp(suggestion.originalText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), modifiedText);
        setUserInputContent(newContent, true, 'Dynamic Advice - Modified', [{findText: suggestion.originalText, replacementText: modifiedText}]);
    }
    
    clearHighlightInEditor();
    review.currentIndex++;
    showCurrentSuggestion();
};

window.navigateSuggestion = function(direction) {
    const review = window.currentSuggestionReview;
    if (!review) return;
    clearHighlightInEditor();
    if (direction < 0 && review.currentIndex > 0) {
        review.currentIndex--;
        if (review.decisions.length > review.currentIndex) review.decisions.pop();
    }
    showCurrentSuggestion();
};

function completeSuggestionReview() {
    const review = window.currentSuggestionReview;
    if (!review) return;
    clearHighlightInEditor();
    const accepted = review.decisions.filter(d => d.action === 'accept').length;
    const rejected = review.decisions.filter(d => d.action === 'reject').length;
    const modified = review.decisions.filter(d => d.action === 'modify').length;
    const skipped = review.suggestions.length - review.decisions.length;
    const completionHtml = `<div style="background: #d4edda; border: 1px solid #c3e6cb; color: #155724; padding: 15px; margin: 10px 0; border-radius: 6px;"><strong>✅ Suggestions Review Complete</strong><br>${accepted} accepted • ${rejected} rejected • ${modified} modified • ${skipped} skipped</div>`;
    const reviewContainer = document.getElementById('suggestion-review-current');
    if (reviewContainer) reviewContainer.outerHTML = completionHtml; else appendToSummary1(completionHtml, false);
    window.currentSuggestionReview = null;
    
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
                    const title = guideline ? (guideline.title || id) : id;
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
            
            // Show transition message
            const transitionMessage = `\n**Incorporating changes and preparing for next guideline...**\n\n`;
            appendToSummary1(transitionMessage, false);
            
            // Process next guideline after a short delay
            setTimeout(async () => {
                try {
                    const processingStepMessage = `<h4>🔄 Processing Guideline ${nextStepNumber}/${queue.length}</h4>\n`;
                    appendToSummary1(processingStepMessage, false);
                    await processSingleGuideline(nextGuidelineId, nextStepNumber, queue.length);
                } catch (error) {
                    console.error('[DEBUG] Error processing next guideline after completion:', error);
                    const errorMessage = `❌ **Error processing guideline ${nextStepNumber}:** ${error.message}\n\n`;
                    appendToSummary1(errorMessage, false);
                }
            }, 1000);
        } else {
            // All guidelines processed
            console.log('[DEBUG] completeSuggestionReview: All guidelines complete!');
            window.sequentialProcessingActive = false;
            const finalMessage = `
                <div class="sequential-processing-complete">
                    <h3>🎉 All Guidelines Processed!</h3>
                    <p>Successfully processed all ${queue.length} selected guidelines.</p>
                </div>
            `;
            appendToSummary1(finalMessage, false);
        }
    }
}

window.cancelSuggestionReview = function() {
    const review = window.currentSuggestionReview;
    if (!review) return;
    clearHighlightInEditor();
    const cancelHtml = `<div style="background: #fff3cd; border: 1px solid #ffeeba; color: #856404; padding: 15px; margin: 10px 0; border-radius: 6px;"><strong>⚠️ Suggestions Review Cancelled</strong><br>No changes were applied</div>`;
    const reviewContainer = document.getElementById('suggestion-review-current');
    if (reviewContainer) reviewContainer.outerHTML = cancelHtml; else appendToSummary1(cancelHtml, false);
    window.currentSuggestionReview = null;
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
            const spacing = currentContent.trim() ? '\n\n' : '';
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
        
        setUserInputContent(newContent, true, 'Dynamic Advice - Accepted', replacements);
        console.log('[DEBUG] handleSuggestionAction: Applied accepted suggestion immediately');
    }

    // Update UI to show decision
    updateSuggestionStatus(suggestionId, action);
    updateDecisionsSummary();
    debouncedSaveState(); // Save state after a decision is made
}

// Prompt for optional feedback when rejecting a suggestion
function promptForRejectionFeedback(suggestionId, suggestion) {
    console.log('[FEEDBACK] Prompting for rejection feedback:', suggestionId);
    
    // Create modal HTML
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
                <textarea 
                    id="feedback-textarea-${suggestionId}" 
                    placeholder="E.g., 'This was SVD, not AVD - cord gases not required for spontaneous delivery'"
                    style="
                        width: 100%;
                        min-height: 100px;
                        padding: 12px;
                        border: 1px solid #ddd;
                        border-radius: 4px;
                        font-family: inherit;
                        font-size: 14px;
                        resize: vertical;
                    "
                ></textarea>
                <div style="display: flex; gap: 10px; margin-top: 20px; justify-content: flex-end;">
                    <button 
                        onclick="submitRejectionFeedback('${suggestionId}', true)"
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
                        onclick="submitRejectionFeedback('${suggestionId}', false)"
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
    
    // Focus on textarea
    setTimeout(() => {
        const textarea = document.getElementById(`feedback-textarea-${suggestionId}`);
        if (textarea) textarea.focus();
    }, 100);
}

// Submit rejection feedback (or skip)
window.submitRejectionFeedback = function(suggestionId, includeFeedback) {
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
    
    setUserInputContent(newContent, true, 'Dynamic Advice - Modified', replacements);
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

        appendToSummary1(summaryHtml, false);
        
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
                        const title = guideline ? (guideline.title || id) : id;
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
                
                // Show transition message
                const transitionMessage = `\n**Incorporating changes and preparing for next guideline...**\n\n`;
                appendToSummary1(transitionMessage, false);
                
                // Update the transcript with applied changes automatically
                if (result.updatedTranscript) {
                    setUserInputContent(result.updatedTranscript, true, 'Dynamic Advice Update');
                    console.log('[DEBUG] Sequential processing: Updated transcript automatically');
                }
                
                // Process next guideline after a brief delay
                setTimeout(async () => {
                    try {
                                const processingStepMessage = `<h4>🔄 Processing Guideline ${nextStepNumber}/${queue.length}</h4>\n`;
        appendToSummary1(processingStepMessage, false);
                        
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
                        const title = guideline ? (guideline.title || id) : id;
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
                
                appendToSummary1(finalMessage, false);
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
        appendToSummary1(errorHtml, false);

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

    // Add click handler for ask guidelines question button
    const askGuidelinesQuestionBtn = document.getElementById('askGuidelinesQuestionBtn');
    if (askGuidelinesQuestionBtn) {
        askGuidelinesQuestionBtn.addEventListener('click', askGuidelinesQuestion);
    }

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
            console.log('[DEBUG] Audit button clicked, opening audit page in new tab...');
            window.open('audit.html', '_blank');
        });
    }

    // Add click handler for settings button
    const settingsBtn = document.getElementById('settingsBtn');
    const settingsMenu = document.getElementById('settingsMenu');
    const settingsContainer = document.getElementById('settingsContainer');
    if (settingsBtn && settingsMenu) {
        settingsBtn.addEventListener('click', (event) => {
            event.stopPropagation();
            settingsMenu.classList.toggle('hidden');
        });
        
        // Close menu if clicking outside
        window.addEventListener('click', (event) => {
            if (!settingsMenu.classList.contains('hidden') && !settingsContainer.contains(event.target)) {
                settingsMenu.classList.add('hidden');
            }
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
    const processBtn = document.getElementById('processBtn');
    if (processBtn) {
        processBtn.addEventListener('click', async () => {
            console.log('[DEBUG] Process button clicked...');
            await processWorkflow();
        });
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
            recordBtn.innerHTML = `<span id="recordSymbol" class="record-symbol"></span>Stop`;
            console.log('Speech recognition started.');
        };

        recognition.onend = () => {
            isRecording = false;
            recordBtn.classList.remove('recording');
            recordBtn.innerHTML = `<span id="recordSymbol" class="record-symbol"></span>Record`;
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

// Make dynamic advice functions globally accessible for onclick handlers
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

// Show clinical issues dropdown in summary1
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
        
        // Create dropdown HTML
        let dropdownHtml = `
            <div class="clinical-issues-selector">
                <h3>⚡ Load Clinical Clerking (Fast Mode)</h3>
                <p>Select a clinical issue to instantly load a realistic pre-generated clinical clerking using SBAR format:</p>
                
                <div class="issue-category">
                    <h4>Clinical Issues</h4>
                    <select id="clinical-issues-dropdown" class="clinical-dropdown">
                        <option value="">Select a clinical issue...</option>
        `;
        
        // Add options from Firebase data
        Object.entries(clinicalConditions).forEach(([category, conditions]) => {
            const categoryLabel = category.charAt(0).toUpperCase() + category.slice(1);
            
            dropdownHtml += `
                        <optgroup label="${categoryLabel}">
            `;
            
            Object.entries(conditions).forEach(([conditionName, conditionData]) => {
                const hasTranscript = conditionData.hasTranscript ? ' ✓' : '';
                dropdownHtml += `<option value="${conditionName}" data-condition-id="${conditionData.id}">${conditionName}${hasTranscript}</option>`;
            });
            
            dropdownHtml += `
                        </optgroup>
            `;
        });
        
        dropdownHtml += `
                    </select>
                </div>
                
                <div class="action-buttons">
                    <button id="generate-interaction-btn" class="nav-btn primary" disabled>
                        <span id="generate-spinner" class="spinner" style="display: none;"></span>
                        <span id="generate-text">Load Clerking</span>
                    </button>
                    <button id="random-issue-btn" class="nav-btn secondary">
                        <span id="random-spinner" class="spinner" style="display: none;"></span>
                        <span id="random-text">Random Issue</span>
                    </button>
                    <button id="regenerate-clerking-btn" class="nav-btn secondary" disabled>
                        <span id="regenerate-spinner" class="spinner" style="display: none;"></span>
                        <span id="regenerate-text">Regenerate Clerking</span>
                    </button>
                    <button id="cancel-generation-btn" class="nav-btn secondary">Cancel</button>
                </div>
                
                <div id="generation-status" class="generation-status" style="display: none;"></div>
            </div>
        `;
        
        // Display in summary1
        appendToSummary1(dropdownHtml, true); // Clear existing content
        
        // Add event listeners for the single dropdown
        const clinicalDropdown = document.getElementById('clinical-issues-dropdown');
        const generateBtn = document.getElementById('generate-interaction-btn');
        const randomBtn = document.getElementById('random-issue-btn');
        const regenerateBtn = document.getElementById('regenerate-clerking-btn');
        const cancelBtn = document.getElementById('cancel-generation-btn');
        
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
        
        if (generateBtn) {
            generateBtn.addEventListener('click', async () => {
                const selectedIssue = clinicalDropdown?.value || '';
                
                if (selectedIssue) {
                    await generateFakeClinicalInteraction(selectedIssue);
                }
            });
        }
        
        if (randomBtn) {
            randomBtn.addEventListener('click', async () => {
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
                } else {
                    console.error('No clinical issues available for random selection');
                    appendToSummary1('❌ **Error:** No clinical issues available for random selection.\n\n', true);
                }
            });
        }
        
        if (regenerateBtn) {
            regenerateBtn.addEventListener('click', async () => {
                const selectedIssue = clinicalDropdown?.value || '';
                
                if (selectedIssue) {
                    // Force regeneration of the transcript
                    await generateFakeClinicalInteraction(selectedIssue, true);
                }
            });
        }
        
        if (cancelBtn) {
            cancelBtn.addEventListener('click', () => {
                appendToSummary1('Clinical interaction generation cancelled.\n\n', true);
            });
        }
        
    } catch (error) {
        console.error('[DEBUG] Error showing clinical issues dropdown:', error);
        appendToSummary1(`❌ **Error loading clinical issues:** ${error.message}\n\nPlease try again or contact support.\n\n`, true);
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
        } else {
            console.error('[DEBUG] Failed to add transcript to userInput:', {
                hasTranscript: !!transcript,
                transcriptType: typeof transcript
            });
        }
        
        // Show success message in summary1 (append, don't clear)
        const performanceText = forceRegenerate ? '🔄 Regenerated with updated formatting' : (isGenerated ? '🔄 Generated using AI' : '⚡ Instant loading from Firebase cache');
        const actionText = forceRegenerate ? 'Regenerated' : 'Loaded';
        const successMessage = `## ✅ Clinical Interaction ${actionText}\n\n` +
                              `**Clinical Issue:** ${selectedIssue}\n\n` +
                              `**Category:** ${condition.category}\n\n` +
                              `**Status:** Successfully ${actionText.toLowerCase()} clinical interaction scenario\n\n` +
                              `**Transcript Length:** ${transcript.length} characters (~${Math.round(transcript.split(' ').length)} words)\n\n` +
                              `**Performance:** ${performanceText}\n\n` +
                              `**Next Steps:** The transcript has been placed in the input area. You can now:\n` +
                              `- Use "Dynamic Advice" to get interactive suggestions based on clinical guidelines\n` +
                              `- Edit the transcript if needed before analysis\n` +
                              `- Save or clear the transcript using the respective buttons\n\n`;
        
        appendToSummary1(successMessage, false); // Don't clear existing content
        
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
        
        // Show error message in summary1 (append, don't clear)
        const errorMessage = `## ❌ Loading Failed\n\n` +
                            `**Error:** ${error.message}\n\n` +
                            `**Selected Issue:** ${selectedIssue}\n\n` +
                            `This might indicate the transcript database needs to be regenerated or the selected issue is not available in the pre-generated transcripts.\n\n`;
        
        appendToSummary1(errorMessage, false); // Don't clear existing content
        
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
    
    const processBtn = document.getElementById('processBtn');
    const processSpinner = document.getElementById('processSpinner');
    const originalText = processBtn?.textContent || 'Process';
    
    try {
        // Check if we have transcript content
        const transcript = getUserInputContent();
        if (!transcript) {
            alert('Please enter some text first');
            return;
        }

        // Set loading state
        if (processBtn) processBtn.disabled = true;
        if (processSpinner) processSpinner.style.display = 'inline';

        // Initialize the workflow summary
        const workflowStart = '# Complete Workflow Processing\n\nStarting comprehensive analysis workflow...\n\n';
        appendToSummary1(workflowStart, false);

        console.log('[DEBUG] processWorkflow: Starting step 1 - Find Relevant Guidelines');
        
        // Step 1: Find Relevant Guidelines
        const step1Status = '## Step 1: Finding Relevant Guidelines\n\n';
        appendToSummary1(step1Status, false);
        
        try {
            await findRelevantGuidelines(true); // Suppress header since we show our own step header
            console.log('[DEBUG] processWorkflow: Step 1 completed successfully');
            
            const step1Complete = '✅ **Step 1 Complete:** Relevant guidelines identified\n\n';
            appendToSummary1(step1Complete, false);
            
        } catch (error) {
            console.error('[DEBUG] processWorkflow: Step 1 failed:', error.message);
            throw new Error(`Step 1 (Find Guidelines) failed: ${error.message}`);
        }

        // Check if we have relevant guidelines before proceeding
        console.log('[DEBUG] processWorkflow: Checking relevant guidelines:', {
            hasRelevantGuidelines: !!window.relevantGuidelines,
            guidelinesLength: window.relevantGuidelines?.length || 0,
            guidelinesArray: window.relevantGuidelines
        });
        
        if (!window.relevantGuidelines || window.relevantGuidelines.length === 0) {
            console.log('[DEBUG] processWorkflow: No relevant guidelines found, cannot proceed');
            throw new Error('No relevant guidelines were found. Cannot proceed with analysis.');
        }

        console.log('[DEBUG] processWorkflow: Step 1 completed - now showing guideline selection interface');
        
        // Step 2: Show Guideline Selection Interface
        const step2Status = `## Step 2: Select Guidelines to Process\n\n` +
                           `✅ **Step 1 Complete:** Found ${window.relevantGuidelines.length} relevant guidelines\n\n` +
                           `**Next:** Use the interface above to select which guidelines to process. ` +
                           `Most relevant guidelines are pre-selected. Click "Process Selected Guidelines" when ready.\n\n` +
                           `📝 **Note:** Guidelines will be processed one-by-one, with each guideline's suggestions ` +
                           `incorporated before moving to the next guideline.\n\n`;
        
        appendToSummary1(step2Status, false);
        
        // The workflow now pauses here - user needs to manually select guidelines and click "Process Selected Guidelines"
        console.log('[DEBUG] processWorkflow: Workflow paused - waiting for user to select and process guidelines');
        
        console.log('[DEBUG] processWorkflow: Complete workflow finished successfully');

    } catch (error) {
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
        // Reset button state
        if (processBtn) {
            processBtn.disabled = false;
            processBtn.textContent = originalText;
        }
        if (processSpinner) processSpinner.style.display = 'none';
        
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
        landingPage.classList.add('hidden');
        mainContent.classList.add('hidden'); // Keep hidden during initialization
        
        // Update user info
        const userLabel = document.getElementById('userLabel');
        const userName = document.getElementById('userName');
        if (userLabel && userName) {
            userName.textContent = user.displayName || user.email || 'User';
            userName.classList.remove('hidden');
            console.log('[DEBUG] Updated user info display');
        }
        
        // Initialize app immediately
        await initializeMainApp();
        
        // Fallback timeout to hide loading screen and show main content after 10 seconds
        setTimeout(() => {
            const loading = document.getElementById('loading');
            const mainContent = document.getElementById('mainContent');
            
            if (loading && !loading.classList.contains('hidden')) {
                loading.classList.add('hidden');
                console.log('[DEBUG] Loading screen hidden due to timeout');
            }
            
            if (mainContent && mainContent.classList.contains('hidden')) {
                mainContent.classList.remove('hidden');
                console.log('[DEBUG] Main content shown due to timeout');
            }
        }, 10000);
        
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

// Make functions globally available
window.enhanceGuidelineMetadata = enhanceGuidelineMetadata;
window.batchEnhanceMetadata = batchEnhanceMetadata;
window.checkMetadataCompleteness = checkMetadataCompleteness;
window.autoEnhanceIncompleteMetadata = autoEnhanceIncompleteMetadata;
window.showMetadataProgress = showMetadataProgress;
window.hideMetadataProgress = hideMetadataProgress;
window.triggerMetadataCompletionForAll = triggerMetadataCompletionForAll;

// Testing helper - trigger completion for specific fields only
window.testMetadataCompletion = async function(fields = ['humanFriendlyName']) {
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

// Show guideline selection interface for multi-guideline dynamic advice
async function showGuidelineSelectionInterface(mostRelevantGuidelines) {
    console.log('[DEBUG] showGuidelineSelectionInterface called with', mostRelevantGuidelines.length, 'guidelines');

    // Create the selection interface HTML
    const selectionHtml = `
        <div class="guideline-selection-container">
            <div class="selection-header">
                <h3>🎯 Select Guidelines for Dynamic Advice</h3>
                <p>Choose which guidelines to include in your dynamic advice generation. Multiple guidelines will be processed in parallel for faster results.</p>
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
                    const displayTitle = guidelineData?.humanFriendlyName || guideline.humanFriendlyName || guideline.title || guideline.id;
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
                    <span class="btn-text">Generate Dynamic Advice</span>
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
            background: #f8f9fa;
            border: 1px solid #dee2e6;
            border-radius: 8px;
            padding: 20px;
            margin: 20px 0;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        }
        
        .selection-header h3 {
            margin: 0 0 10px 0;
            color: #2c3e50;
            font-size: 1.2em;
        }
        
        .selection-header p {
            margin: 0 0 15px 0;
            color: #6c757d;
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
            background: white;
            cursor: pointer;
            font-size: 0.9em;
            transition: all 0.2s;
        }
        
        .selection-btn:hover {
            background: #f8f9fa;
            border-color: #007bff;
        }
        
        .guidelines-selection-list {
            max-height: 400px;
            overflow-y: auto;
            border: 1px solid #ddd;
            border-radius: 4px;
            background: white;
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
            background: #f8f9fa;
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
        }
        
        .guideline-info {
            flex: 1;
        }
        
        .guideline-content {
            display: flex;
            align-items: center;
            gap: 12px;
            flex-wrap: wrap;
        }
        
        .guideline-title {
            font-weight: 500;
            color: #2c3e50;
            line-height: 1.3;
            flex: 1;
            min-width: 0;
        }
        
        .organization {
            font-weight: 500;
            color: #6c757d;
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
            background: #f8f9fa;
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
async function processSelectedGuidelines() {
    console.log('[DEBUG] processSelectedGuidelines function called!');
    const button = document.querySelector('.process-selected-btn');
    
    if (!button) {
        console.error('[DEBUG] Process button not found!');
        alert('Process button not found. Please try refreshing the page.');
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

        console.log('[DEBUG] Starting sequential processing of selected guidelines:', selectedGuidelineIds);

        // Set up sequential processing globals
        window.sequentialProcessingActive = true;
        window.sequentialProcessingQueue = selectedGuidelineIds;
        window.sequentialProcessingIndex = 0;

        const sequentialProcessingMessage = `
            <div class="sequential-processing-container">
                <h3>🔄 Sequential Guideline Processing</h3>
                <p>Processing ${selectedGuidelineIds.length} selected guidelines one-by-one...</p>
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
        
        appendToSummary1(sequentialProcessingMessage, false);

        // Function to update status display
        function updateSequentialStatus() {
            const statusDiv = document.getElementById('processing-status');
            if (statusDiv) {
                statusDiv.innerHTML = selectedGuidelineIds.map((id, index) => {
                    const guideline = window.relevantGuidelines.find(g => g.id === id);
                    const title = guideline ? (guideline.title || id) : id;
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
            
            const processingStepMessage = `
                <h4>🔄 Processing Guideline ${stepNumber}/${selectedGuidelineIds.length}</h4>
            `;
            appendToSummary1(processingStepMessage, false);

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
        const errorMessage = `\n❌ **Sequential Processing Error:** ${error.message}\n\nPlease try again or contact support if the problem persists.\n`;
        appendToOutputField(errorMessage, true);
        alert('Error processing selected guidelines: ' + error.message);
        
    } finally {
        // Reset button state
        button.disabled = false;
        button.textContent = originalText;
    }
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

    console.log(`[DEBUG] Processing guideline: ${guidelineData.humanFriendlyTitle || guidelineData.title}`);

    const analyzeMessage = `Analyzing against: **${guidelineData.humanFriendlyTitle || guidelineData.title}**\n\n`;
    appendToSummary1(analyzeMessage, false);

    // Directly generate dynamic advice for this guideline without server analysis
    // Store the latest analysis for potential dynamic advice
    window.latestAnalysis = {
        transcript: transcript,
        analysis: null, // No separate analysis step
        guidelineId: guidelineId,
        guidelineTitle: guidelineData.humanFriendlyTitle || guidelineData.title
    };

    // Automatically generate dynamic advice for this guideline
    const dynamicAdviceTitle = `### 🎯 Interactive Suggestions for: ${guidelineData.humanFriendlyTitle || guidelineData.title}\n\n`;
    appendToSummary1(dynamicAdviceTitle, false);

    try {
        // For sequential processing, use existing analysis if available, otherwise create a basic one
        let analysisToUse = window.latestAnalysis?.analysis;
        if (!analysisToUse) {
            // Create a basic analysis description for this guideline
            analysisToUse = `Clinical transcript analysis for guideline compliance check against: ${guidelineData.humanFriendlyTitle || guidelineData.title}. ` +
                           `This analysis focuses on identifying areas where the clinical documentation can be improved according to the specific guideline requirements.`;
        }
        
        await dynamicAdvice(
            transcript,
            analysisToUse,
            guidelineId,
            guidelineData.humanFriendlyTitle || guidelineData.title
        );
    } catch (dynamicError) {
        console.error(`[DEBUG] Error generating dynamic advice for ${guidelineId}:`, dynamicError);
        const dynamicErrorMessage = `⚠️ **Note:** Dynamic advice generation failed for this guideline: ${dynamicError.message}\n\n`;
        appendToOutputField(dynamicErrorMessage, true);
    }

    console.log(`[DEBUG] Successfully processed guideline: ${guidelineId}`);
}

// Make the function globally accessible
window.processSelectedGuidelines = processSelectedGuidelines;

// Helper functions for sequential processing error handling
window.retryCurrentGuideline = async function() {
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

window.skipCurrentGuideline = function() {
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
                        const processingStepMessage = `<h4>🔄 Processing Guideline ${nextStepNumber}/${queue.length}</h4>\n`;
        appendToSummary1(processingStepMessage, false);
                await processSingleGuideline(nextGuidelineId, nextStepNumber, queue.length);
            } catch (error) {
                console.error('[DEBUG] Error processing next guideline after skip:', error);
            }
        }, 500);
    } else {
        // All done
        window.sequentialProcessingActive = false;
        const finalMessage = `
            <div class="sequential-processing-complete">
                <h3>🎉 Sequential Processing Complete!</h3>
                <p>Processed ${currentIndex + 1} of ${queue.length} guidelines (${queue.length - currentIndex - 1} skipped).</p>
            </div>
        `;
        appendToSummary1(finalMessage, false);
    }
};

// Generate dynamic advice for multiple selected guidelines
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
                <p>Generating dynamic advice from ${selectedGuidelines.length} selected guideline${selectedGuidelines.length > 1 ? 's' : ''}...</p>
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
        
        // Call the multi-guideline dynamic advice function
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

// Multi-guideline dynamic advice - processes multiple guidelines in parallel
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
                    throw new Error(result.error || 'Dynamic advice generation failed');
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
        
        console.log('✅ Multi-guideline dynamic advice completed successfully');
        
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
                        
                        <div class="guideline-link-section" style="margin-top: 10px; padding: 10px; background: #f0f9ff; border-radius: 4px; border-left: 3px solid #0ea5e9;">
                            <label style="font-weight: bold;">Guideline:</label>
                            ${createGuidelineViewerLink(suggestion.sourceGuidelineId, suggestion.sourceGuideline, suggestion.sourceGuidelineFilename, suggestion.context)}
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

        // Send all analyses to the dynamic advice API
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
            throw new Error(result.error || 'Multi-guideline dynamic advice generation failed');
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
        console.log('🔄 Falling back to single guideline dynamic advice');
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
        appendToSummary1(noSuggestionsHtml, false);
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
                                <strong>Gap identified:</strong>
                                <div class="gap-content">"${suggestion.gapDescription || 'Missing documentation identified'}"</div>
                            </div>
                        `}
                        
                        <div class="suggested-text">
                            <strong>${suggestion.category === 'gap' ? 'Suggested addition:' : 'Suggested modification:'}</strong>
                            <div class="suggestion-text" id="suggestion-text-${suggestionId}">"${suggestion.suggestedText}"</div>
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
    appendToSummary1(suggestionsHtml, false);

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
window.repairContent = async function() {
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
window.testFirestoreChat = async function() {
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

window.clearAllChatHistory = async function() {
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
window.debugMultiGuideline = function() {
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
window.testMultiGuidelineSetup = async function() {
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
window.runMultiGuidelineAdvice = async function() {
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
window.clearMultiGuidelineState = function() {
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
    
    async _fetchConditionsFromServer() {
        try {
            // Try to get from IndexedDB cache first
            if (window.cacheManager) {
                const cachedConditions = await window.cacheManager.getClinicalConditions();
                if (cachedConditions) {
                    console.log('[CLINICAL-SERVICE] ⚡ Loaded clinical conditions from IndexedDB cache');
                    clinicalConditionsFirebaseCache = cachedConditions;
                    return cachedConditions;
                }
            }
            
            console.log('[CLINICAL-SERVICE] Loading clinical conditions from Firebase...');
            
            const user = auth.currentUser;
            if (!user) {
                throw new Error('User not authenticated');
            }
            
            const idToken = await user.getIdToken(true); // Force refresh token
            
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
                        clinicalConditionsFirebaseCache = retryData.conditions;
                        
                        // Save to IndexedDB cache in background
                        if (window.cacheManager) {
                            window.cacheManager.saveClinicalConditions(retryData.conditions).catch(err => {
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
            
            clinicalConditionsFirebaseCache = data.conditions;
            
            // Save to IndexedDB cache in background
            if (window.cacheManager) {
                window.cacheManager.saveClinicalConditions(data.conditions).catch(err => {
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
    const askQuestionBtn = document.getElementById('askGuidelinesQuestionBtn');
    const questionSpinner = document.getElementById('askQuestionSpinner');
    const originalText = askQuestionBtn.textContent;
    
    try {
        const question = getUserInputContent();
        if (!question) {
            alert('Please enter a question first');
            return;
        }

        // Set loading state
        askQuestionBtn.classList.add('loading');
        askQuestionBtn.disabled = true;
        questionSpinner.style.display = 'inline-block';

        // Initialize the question search summary
        let searchProgress = '## Asking Guidelines A Question\n\n';
        searchProgress += `**Your Question:** ${question}\n\n`;
        appendToSummary1(searchProgress);

        // Get user ID token
        const user = auth.currentUser;
        if (!user) {
            alert('Please sign in to use this feature');
            return;
        }
        const idToken = await user.getIdToken();

        // Update progress
        const loadingMessage = 'Loading guidelines from database...\n';
        appendToSummary1(loadingMessage, false);

        // Get guidelines and summaries from Firestore (reuse existing logic)
        const guidelines = await loadGuidelinesFromFirestore();
        
        // Format guidelines for relevancy matching
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
        const analyzeMessage = `Analysing question against ${guidelinesList.length} available guidelines...\n`;
        appendToSummary1(analyzeMessage, false);

        console.log('[DEBUG] Sending request to /findRelevantGuidelines for question:', {
            questionLength: question.length,
            guidelinesCount: guidelinesList.length
        });

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
                anonymisationInfo: null // No anonymisation needed for questions
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Server error: ${response.status} - ${errorText}`);
        }

        const data = await response.json();
        if (!data.success) {
            throw new Error(data.error || 'Failed to find relevant guidelines');
        }

        // Update progress with completion
        const completionMessage = 'Analysis complete! Processing most relevant guidelines...\n\n';
        appendToSummary1(completionMessage, false);

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
            
            appendToSummary1(noGuidelinesMessage, false);
            return; // Exit early, don't try to process empty guidelines
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
            })
        });

        if (!response2.ok) {
            const errorText = await response2.text();
            throw new Error(`Server error: ${response2.status} - ${errorText}`);
        }

        const data2 = await response2.json();
        if (!data2.success) {
            throw new Error(data2.error || 'Failed to process guidelines');
        }

        // Display the answer
        const selectedGuidelinesList = data2.guidelinesUsed.map(g => `- ${g.title}`).join('\n');
        const finalOutput = `## Guidelines Used\n${selectedGuidelinesList}\n\n## Answer\n${data2.answer}`;
        appendToOutputField(finalOutput, true); // Display in output field, clear existing content

    } catch (error) {
        console.error('[DEBUG] Error in askGuidelinesQuestion:', {
            error: error.message,
            stack: error.stack
        });
        
        // Display error in summary1 field
        const errorMessage = `\n❌ **Error finding relevant guidelines:** ${error.message}\n\nPlease try again or contact support if the problem persists.\n`;
        appendToSummary1(errorMessage, false);
        
        alert('Error finding relevant guidelines: ' + error.message);
    } finally {
        // Reset button state
        askQuestionBtn.classList.remove('loading');
        askQuestionBtn.disabled = false;
        questionSpinner.style.display = 'none';
        askQuestionBtn.textContent = originalText;
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

        // Display the comprehensive answer
        const answerMessage = `## 💡 Answer Based on Guidelines\n\n` +
                             `**Question:** ${question}\n\n` +
                             `**Guidelines Used:** ${data.guidelinesUsed?.length || 0}\n\n` +
                             `**Answer:**\n\n${data.answer}\n\n` +
                             `---\n\n` +
                             `*Answer generated using ${data.ai_provider || 'AI'} (${data.ai_model || 'unknown model'})*\n\n`;
        
        appendToOutputField(answerMessage, false);

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

// Trigger compliance scoring after dynamic advice is applied
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

        // Show scoring initiation message
        const scoringInitMessage = `
            <div class="compliance-scoring-init">
                <h3>📊 Generating Compliance Score...</h3>
                <p>Analysing how well the original clinical note complied with guideline requirements.</p>
                <div class="scoring-spinner">⏳ Processing...</div>
            </div>
        `;
        appendToSummary1(scoringInitMessage, false);

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
        
        const errorMessage = `
            <div class="compliance-scoring-error">
                <h3>❌ Compliance Scoring Error</h3>
                <p>Unable to generate compliance score: ${error.message}</p>
            </div>
        `;
        appendToSummary1(errorMessage, false);
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
            background: #f8f9fa;
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
            color: #6c757d;
            font-style: italic;
        }

        .overall-score {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 30px;
            margin: 25px 0;
            padding: 20px;
            background: white;
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
            background: white;
        }

        .score-number {
            font-size: 2.5em;
            font-weight: bold;
            line-height: 1;
        }

        .score-label {
            font-size: 0.9em;
            color: #6c757d;
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
            color: #495057;
        }

        .dimensions-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 15px;
        }

        .dimension-item {
            background: white;
            padding: 15px;
            border-radius: 6px;
            text-align: center;
            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
        }

        .dimension-name {
            font-weight: 600;
            color: #495057;
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
            color: #6c757d;
        }

        .scoring-section {
            margin: 20px 0;
            padding: 15px;
            border-radius: 6px;
        }

        .strengths {
            background: #d4edda;
            border-left: 4px solid #28a745;
        }

        .improvements {
            background: #fff3cd;
            border-left: 4px solid #ffc107;
        }

        .scoring-section h4 {
            margin: 0 0 10px 0;
            color: #495057;
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
            background: white;
            border-radius: 6px;
            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
        }

        .key-findings h4 {
            margin: 0 0 15px 0;
            color: #495057;
        }

        .findings-group {
            margin-bottom: 15px;
        }

        .findings-group strong {
            color: #495057;
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
            background: #e3f2fd;
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
            color: #495057;
        }

        .compliance-scoring-init, .compliance-scoring-error {
            background: #f8f9fa;
            border: 2px solid #17a2b8;
            border-radius: 8px;
            padding: 20px;
            margin: 15px 0;
            text-align: center;
        }

        .compliance-scoring-error {
            border-color: #dc3545;
            background: #f8d7da;
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