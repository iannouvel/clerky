/**
 * Suggestions and Interaction Features
 * Handles interactive suggestion review, application, and feedback
 */

import { auth } from '../../firebase-init.js';
import { SERVER_URL } from '../api/config.js';
import { escapeHtml, unescapeHtml } from '../utils/text.js';
import {
    getUserInputContent,
    setUserInputContent,
    appendToOutputField,
    scrollTextIntoView,
    highlightTextInEditor,
    clearHighlightInEditor,
    updateChatbotButtonVisibility
} from '../utils/editor.js';
import { updateUser, updateAnalyseAndResetButtons, setButtonLoading } from '../ui/status.js';
import { performComplianceScoring, displayComplianceScoring } from './analysis.js';
import { createGuidelineViewerLink } from './guidelines.js';
import { appendToSummary1 } from '../ui/streaming.js';

// Module state
export let currentSuggestions = [];
export let userDecisions = {};
export let currentAdviceSession = null;
export let currentSuggestionReview = null; // Wizard state
export let pendingInsertions = new Map(); // Track pending insertions (suggestion ID -> preview state)

/**
 * Unified logic for inserting suggestion text into the note.
 * Used by both wizard and non-wizard suggestion paths.
 * Handles:
 * - Replacing existing text (if replace_pattern matches)
 * - Section-based placement (using target_section)
 * - New section creation (if createSection flag set)
 * - Fallback to end of note
 * @param {string} textToInsert - The text to insert
 * @param {Object} suggestion - The suggestion object with optional replace_pattern, target_section, etc.
 * @param {string} currentContent - The current note content
 * @returns {string} The updated note content
 */
export function applySuggestionInsertion(textToInsert, suggestion, currentContent) {
    if (!textToInsert) return currentContent;

    // 1. Try to replace existing text (highest priority)
    if (suggestion?.replace_pattern && currentContent.includes(suggestion.replace_pattern)) {
        return currentContent.replace(suggestion.replace_pattern, textToInsert);
    }

    // 2. Try to place in target section
    if (suggestion?.target_section) {
        const sectionInfo = extractSectionContent(currentContent, suggestion.target_section);
        if (sectionInfo) {
            // Insert at the end of the target section
            return currentContent.slice(0, sectionInfo.endIndex) + '\n' + textToInsert + currentContent.slice(sectionInfo.endIndex);
        }
        // If section not found but should create new section
        if (suggestion?.createSection && suggestion?.newSectionTitle) {
            return currentContent + '\n\n' + suggestion.newSectionTitle + ':\n' + textToInsert;
        }
    }

    // 3. Fallback: append to end of note
    return currentContent + '\n' + textToInsert;
}

// Helper to set session state
export function setSuggestionSession(sessionId, suggestions) {
    currentAdviceSession = sessionId;
    currentSuggestions = suggestions || [];
    userDecisions = {};
}

// Helper to get category icon
export function getCategoryIcon(category) {
    switch ((category || '').toLowerCase()) {
        case 'addition': return '➕';
        case 'modification': return '✏️';
        case 'deletion': return '🗑️';
        default: return '💡';
    }
}

// Helper to get original text label
export function getOriginalTextLabel(originalText, category) {
    if (category === 'addition') {
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

// --- Text Manipulation Helpers ---

export function extractSectionContent(clinicalNote, sectionName, subsectionName = null) {
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

    if (sectionStartIndex === -1) return null;

    const afterSection = clinicalNote.slice(sectionStartIndex + matchedPattern.length);
    const commonSections = ['Situation', 'Issues', 'Background', 'Assessment', 'Discussion', 'Plan', 'Recommendation', 'History', 'Examination', 'Impression'];
    let nextSectionIndex = -1;

    for (const nextSection of commonSections) {
        if (nextSection === sectionName) continue;
        const nextPatterns = [
            new RegExp(`\\n${nextSection}:`, 'i'),
            new RegExp(`\\n${nextSection}\\s*$`, 'm')
        ];
        for (const pattern of nextPatterns) {
            const match = afterSection.match(pattern);
            if (match && (nextSectionIndex === -1 || match.index < nextSectionIndex)) {
                nextSectionIndex = match.index;
            }
        }
    }

    let sectionContent = nextSectionIndex !== -1
        ? afterSection.slice(0, nextSectionIndex)
        : afterSection;

    if (subsectionName) {
        const subsectionPatterns = [
            new RegExp(`\\*\\*\\s*${subsectionName}\\s*:\\*\\*`, 'i'),
            new RegExp(`\\*\\s*\\*\\*${subsectionName}:\\*\\*`, 'i'),
            new RegExp(`${subsectionName}:`, 'i')
        ];

        let subsectionStartIndex = -1;
        let subsectionMatchedPattern = null;

        for (const pattern of subsectionPatterns) {
            const subMatch = sectionContent.match(pattern);
            if (subMatch) {
                subsectionStartIndex = subMatch.index;
                subsectionMatchedPattern = subMatch[0];
                break;
            }
        }

        if (subsectionStartIndex === -1) return null;

        const afterSubsection = sectionContent.slice(subsectionStartIndex + subsectionMatchedPattern.length);
        const nextSubMatch = afterSubsection.match(/\n[\*\-]?\s*\*\*[^\:]+:\*\*/);

        sectionContent = nextSubMatch
            ? afterSubsection.slice(0, nextSubMatch.index)
            : afterSubsection;

        return {
            content: sectionContent.trim(),
            startIndex: sectionStartIndex + matchedPattern.length + subsectionStartIndex + subsectionMatchedPattern.length,
            endIndex: sectionStartIndex + matchedPattern.length + subsectionStartIndex + subsectionMatchedPattern.length + sectionContent.length
        };
    }

    return {
        content: sectionContent.trim(),
        startIndex: sectionStartIndex + matchedPattern.length,
        endIndex: sectionStartIndex + matchedPattern.length + sectionContent.length
    };
}

export function replaceSectionContent(clinicalNote, sectionName, subsectionName, oldContent, newContent) {
    const sectionInfo = extractSectionContent(clinicalNote, sectionName, subsectionName);
    if (!sectionInfo) return clinicalNote;
    // Simple replace within content for now, assuming uniqueness or better relative splice in future
    return clinicalNote.replace(oldContent, newContent);
}

export function applySuggestionTextReplacement(content, originalText, suggestedText) {
    if (!content || !originalText) {
        return { didReplace: false, newContent: content, error: 'Missing content or original text' };
    }

    if (content.includes(originalText)) {
        return {
            didReplace: true,
            newContent: content.replace(originalText, suggestedText)
        };
    }

    const escapedOriginal = originalText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
    const regex = new RegExp(escapedOriginal, 'i');

    if (regex.test(content)) {
        return {
            didReplace: true,
            newContent: content.replace(regex, suggestedText)
        };
    }

    return { didReplace: false, newContent: content, error: 'Original text not found' };
}

export async function determineInsertionPoint(suggestion, clinicalNote) {
    try {
        const user = auth.currentUser;
        if (!user) throw new Error('User not authenticated');
        const idToken = await user.getIdToken();

        const response = await fetch(`${SERVER_URL}/determineInsertionPoint`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
            body: JSON.stringify({ suggestion, clinicalNote })
        });

        if (!response.ok) throw new Error(`Status ${response.status}`);
        const result = await response.json();
        return result.updatedNote || null;
    } catch (error) {
        console.warn('[DEBUG] Insertion failed, will fall back to append:', error);
        return null;
    }
}

export function insertTextAtPoint(currentContent, newText, insertionPoint) {
    const cleanedNewText = newText.trim();
    if (insertionPoint.section === 'end' || !insertionPoint.section) {
        return currentContent + '\n\n' + cleanedNewText;
    }
    const regex = new RegExp(`^${insertionPoint.section}[:\\-]?`, 'mi');
    const match = regex.exec(currentContent);
    if (match) {
        const idx = match.index + match[0].length;
        const before = currentContent.slice(0, idx);
        const after = currentContent.slice(idx);
        return before + '\n' + cleanedNewText + after;
    }
    return currentContent + '\n\n' + cleanedNewText;
}

export function showSuggestionPreview(suggestion, currentContent) {
    // Create a preview of the suggestion in the note with green highlighting
    let previewContent;
    const greenBox = '<div style="background-color: #dcfce7; border-left: 4px solid #10b981; padding: 12px; margin: 10px 0; border-radius: 4px;">' +
        '<span style="color: #047857; font-weight: 600;">📋 Pending Insertion (not yet confirmed)</span>\n' +
        escapeHtml(suggestion.suggestedText) +
        '</div>';

    if (suggestion.category === 'addition' || !suggestion.originalText) {
        // Use unified insertion logic with green preview box
        previewContent = applySuggestionInsertion(greenBox, suggestion, currentContent);
    } else {
        // For replacements, highlight the replacement
        previewContent = currentContent.replace(
            suggestion.originalText,
            '<div style="background-color: #dcfce7; border-left: 4px solid #10b981; padding: 12px; margin: 10px 0; border-radius: 4px;">' +
            '<span style="color: #047857; font-weight: 600;">📋 Pending Replacement (not yet confirmed)</span>\n' +
            escapeHtml(suggestion.suggestedText) +
            '</div>'
        );
    }

    setUserInputContent(previewContent, true, 'Suggestion Preview');
    pendingInsertions.set(`preview_${suggestion.id || Date.now()}`, {
        suggestion,
        content: currentContent,
        previewContent
    });
}

export function confirmPendingInsertion(suggestion, currentContent) {
    // Permanently add the suggestion to the note
    let finalContent;

    if (suggestion.category === 'addition' || !suggestion.originalText) {
        // Use unified insertion logic
        finalContent = applySuggestionInsertion(suggestion.suggestedText, suggestion, currentContent);
    } else {
        const res = applySuggestionTextReplacement(currentContent, suggestion.originalText, suggestion.suggestedText);
        finalContent = res.newContent;
    }

    setUserInputContent(finalContent, true, 'Wizard Accept');
    pendingInsertions.delete(`preview_${suggestion.id || Date.now()}`);
}

export function removePendingInsertion(suggestion, originalContent) {
    // Revert to original content, removing the pending insertion preview
    setUserInputContent(originalContent, true, 'Suggestion Rejected');
    pendingInsertions.delete(`preview_${suggestion.id || Date.now()}`);
}

// --- Wizard Logic (One-At-A-Time) ---

export async function displayInteractiveSuggestions(suggestions, guidelineTitle, guidelineId, guidelineFilename) {
    if (!suggestions || suggestions.length === 0) {
        updateUser(`No specific suggestions were generated via ${guidelineTitle || 'guideline'}.`, false);
        return;
    }
    currentSuggestionReview = {
        suggestions,
        guidelineTitle,
        guidelineId,
        guidelineFilename,
        currentIndex: 0,
        decisions: []
    };
    window.currentSuggestionReview = currentSuggestionReview;
    showCurrentSuggestion();
}

export async function showCurrentSuggestion() {
    const review = currentSuggestionReview;
    if (!review) return;

    if (review.currentIndex >= review.suggestions.length) {
        completeSuggestionReview();
        return;
    }
    updateSuggestionActionButtons();

    const suggestion = review.suggestions[review.currentIndex];
    const progressText = `${review.currentIndex + 1} of ${review.suggestions.length}`;
    const categoryIcon = getCategoryIcon(suggestion.category);

    if (suggestion.originalText) {
        highlightTextInEditor(suggestion.originalText);
        scrollTextIntoView(suggestion.originalText);
    }

    const guidelineLink = createGuidelineViewerLink(
        review.guidelineId, review.guidelineTitle, review.guidelineFilename,
        suggestion.context, suggestion.hasVerbatimQuote, suggestion.suggestedText
    );

    // Determine priority color
    const priorityColors = {
        high: '#dc2626',
        medium: '#f59e0b',
        low: '#10b981'
    };
    const priorityColor = priorityColors[suggestion.priority || 'medium'] || priorityColors.medium;
    const priorityBg = {
        high: '#fee2e2',
        medium: '#fef3c7',
        low: '#dcfce7'
    };
    const priorityBgColor = priorityBg[suggestion.priority || 'medium'] || priorityBg.medium;

    // Calculate progress percentage
    const progressPercent = ((review.currentIndex + 1) / review.suggestions.length) * 100;

    const suggestionHtml = `
        <div class="dynamic-advice-container" id="suggestion-review-current">
            <!-- Progress bar -->
            <div style="width: 100%; height: 4px; background: #e5e7eb; border-radius: 2px; margin-bottom: 15px; overflow: hidden;">
                <div style="width: ${progressPercent}%; height: 100%; background: #3b82f6; transition: width 0.3s ease;"></div>
            </div>

            <!-- Header with priority badge -->
            <div style="display: flex; justify-content: space-between; align-items: center; margin: 0 0 15px 0; flex-wrap: wrap; gap: 10px;">
                <div style="display: flex; align-items: center; gap: 10px;">
                    <h3 style="color: #2563eb; margin: 0;">💡 Suggestion ${progressText}</h3>
                    <span style="background: ${priorityBgColor}; color: ${priorityColor}; padding: 4px 12px; border-radius: 12px; font-weight: 600; font-size: 12px; text-transform: uppercase;">● ${suggestion.priority || 'medium'}</span>
                </div>
                <p style="margin: 0; font-size: 12px; color: #666;"><em>📋 ${review.guidelineTitle || 'Guideline'}</em></p>
            </div>

            <!-- Main suggestion box -->
            <div class="suggestion-current" style="background: #f5f5f5; border: 2px solid #3B82F6; padding: 15px; margin: 10px 0; border-radius: 8px;">
                <!-- Category -->
                <div style="margin: 0 0 12px 0; padding-bottom: 12px; border-bottom: 1px solid #e5e7eb;"><strong style="color: #2563eb; font-size: 15px;">${categoryIcon} ${(suggestion.category || 'Suggestion').charAt(0).toUpperCase() + (suggestion.category || 'Suggestion').slice(1)}</strong></div>

                <!-- Original text (if modification) -->
                ${suggestion.originalText ? `<div style="margin: 0 0 12px 0; padding: 10px; background: #fff; border-radius: 4px; border-left: 3px solid #dc2626;"><strong style="color: #dc2626; font-size: 14px;">${getOriginalTextLabel(suggestion.originalText, suggestion.category)}</strong><br><span style="background: #fef3c7; padding: 6px 10px; border-radius: 3px; display: inline-block; margin-top: 6px; font-size: 13px;">"${escapeHtml(suggestion.originalText)}"</span></div>` : ''}

                <!-- Suggested text -->
                <div style="margin: 0 0 12px 0; padding: 10px; background: #fff; border-radius: 4px; border-left: 3px solid #16a34a;"><strong style="color: #16a34a; font-size: 14px;">✅ Suggested text:</strong><br><span style="background: #dcfce7; padding: 6px 10px; border-radius: 3px; display: inline-block; margin-top: 6px; font-size: 13px;">"${escapeHtml(suggestion.suggestedText)}"</span></div>

                <!-- Clinical context with quote -->
                <div style="margin: 0 0 12px 0; padding: 12px; background: #eff6ff; border-radius: 4px; border-left: 4px solid #3b82f6;">
                    <strong style="color: #1e40af; font-size: 14px; display: block; margin-bottom: 8px;">📖 Evidence & Rationale:</strong>
                    <p style="margin: 0; color: #1e3a8a; font-size: 13px; line-height: 1.5;">${escapeHtml(suggestion.context)}</p>
                </div>

                <!-- Guideline reference and link -->
                <div style="margin: 0; padding: 10px; background: #f0f9ff; border-radius: 4px; border-left: 3px solid #0ea5e9; display: flex; justify-content: space-between; align-items: center;">
                    <div>
                        <strong style="color: #0369a1; font-size: 14px; display: block;">🔗 Guideline Reference</strong>
                        <p style="margin: 4px 0 0 0; color: #0c4a6e; font-size: 12px;">${suggestion.guidelineReference || 'Clinical guideline'}</p>
                    </div>
                    <div style="text-align: right; font-size: 12px;">${guidelineLink}</div>
                </div>
            </div>

            <!-- Preview confirmation message -->
            <div id="preview-message-current" style="display: none; background: #dcfce7; border: 2px solid #10b981; padding: 12px; margin: 10px 0; border-radius: 6px; color: #047857; font-weight: 500;">
                ✅ Preview shown in your note (green highlight) — click <strong>Confirm</strong> to accept or <strong>Dismiss</strong> to cancel
            </div>

            <!-- Modify section -->
            <div class="modify-section" id="modify-section-current" style="display: none; background: #fef3c7; border: 2px solid #eab308; padding: 15px; margin: 10px 0; border-radius: 6px;">
                <label for="modify-textarea-current" style="display: block; margin-bottom: 8px; font-weight: bold; color: #92400e;">✏️ Edit your text:</label>
                <textarea id="modify-textarea-current" style="width: 100%; min-height: 80px; padding: 10px; border: 1px solid #ddd; border-radius: 4px; font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif; font-size: 14px; box-sizing: border-box;" placeholder="Enter your custom text here...">${escapeHtml(suggestion.suggestedText)}</textarea>
                <div style="margin-top: 10px;">
                    <button onclick="confirmCurrentModification()" style="background: #16a34a; color: white; padding: 10px 20px; border: none; border-radius: 4px; cursor: pointer; font-size: 14px; font-weight: bold;">✅ Confirm</button>
                    <button onclick="hideModifySection()" style="background: #6c757d; color: white; padding: 10px 20px; border: none; border-radius: 4px; cursor: pointer; font-size: 14px; margin-left: 10px;">❌ Cancel</button>
                </div>
            </div>

            <!-- Status footer -->
            <div style="margin-top: 15px; padding-top: 10px; border-top: 1px solid #e5e7eb; display: flex; justify-content: space-between; align-items: center; font-size: 12px; color: #666;">
                <span>✅ ${review.decisions.length} decision${review.decisions.length !== 1 ? 's' : ''} made</span>
                <span>${review.suggestions.length - review.currentIndex - 1} more suggestion${review.suggestions.length - review.currentIndex - 1 !== 1 ? 's' : ''}</span>
            </div>
        </div>
    `;

    const existingReview = document.getElementById('suggestion-review-current');
    if (existingReview && existingReview.parentElement) {
        existingReview.outerHTML = suggestionHtml;
    } else {
        appendToSummary1(suggestionHtml, true);
    }
}

export function updateSuggestionActionButtons() {
    const review = currentSuggestionReview;
    const suggestionActionsGroup = document.getElementById('suggestionActionsGroup');
    const clerkyButtonsGroup = document.getElementById('clerkyButtonsGroup');

    if (!review) {
        if (suggestionActionsGroup) suggestionActionsGroup.style.display = 'none';
        const hasContent = !!getUserInputContent()?.trim().length;
        updateAnalyseAndResetButtons(hasContent);
        return;
    }

    if (suggestionActionsGroup) suggestionActionsGroup.style.display = 'flex';
    updateAnalyseAndResetButtons(true);
    if (clerkyButtonsGroup) clerkyButtonsGroup.style.display = 'none';

    // Hook up buttons
    const prevBtn = document.getElementById('suggestionPrevBtn');
    if (prevBtn) {
        prevBtn.style.display = review.currentIndex > 0 ? 'flex' : 'none';
        prevBtn.onclick = () => navigateSuggestion(-1);
    }

    const acceptBtn = document.getElementById('suggestionAcceptBtn');
    if (acceptBtn) {
        acceptBtn.textContent = '👁️ Preview';
        acceptBtn.onclick = () => previewCurrentSuggestion();
    }
    const rejectBtn = document.getElementById('suggestionRejectBtn');
    if (rejectBtn) {
        rejectBtn.textContent = '❌ Reject';
        rejectBtn.onclick = () => handleCurrentSuggestionAction('reject');
    }
    const modifyBtn = document.getElementById('suggestionModifyBtn');
    if (modifyBtn) {
        modifyBtn.textContent = '✏️ Modify';
        modifyBtn.onclick = () => showModifySection();
    }
    const skipBtn = document.getElementById('suggestionSkipBtn');
    if (skipBtn) {
        skipBtn.textContent = '⏭️ Skip';
        skipBtn.onclick = () => handleCurrentSuggestionAction('skip');
    }
    const cancelBtn = document.getElementById('suggestionCancelBtn');
    if (cancelBtn) {
        cancelBtn.textContent = '🚫 Cancel';
        cancelBtn.onclick = () => cancelSuggestionReview();
    }

    setAllSuggestionButtonsApplying(false);
}

export function previewCurrentSuggestion() {
    const review = currentSuggestionReview;
    if (!review) return;
    const suggestion = review.suggestions[review.currentIndex];

    // Show preview in the note
    const currentContent = getUserInputContent();
    showSuggestionPreview(suggestion, currentContent);

    // Show message and update buttons for confirmation
    const previewMsg = document.getElementById('preview-message-current');
    if (previewMsg) previewMsg.style.display = 'block';

    // Update buttons for confirm/cancel flow
    const acceptBtn = document.getElementById('suggestionAcceptBtn');
    if (acceptBtn) {
        acceptBtn.textContent = '✅ Confirm';
        acceptBtn.onclick = () => confirmAndAcceptSuggestion();
    }

    const rejectBtn = document.getElementById('suggestionRejectBtn');
    if (rejectBtn) {
        rejectBtn.textContent = '❌ Dismiss Preview';
        rejectBtn.onclick = () => dismissPreviewAndReject();
    }
}

export function confirmAndAcceptSuggestion() {
    const review = currentSuggestionReview;
    if (!review) return;
    const suggestion = review.suggestions[review.currentIndex];
    const currentContent = getUserInputContent();

    // The content already has the preview, so we just need to remove the preview markers
    // and clean up the pending insertion
    let finalContent = currentContent
        .replace(/<div style="background-color: #dcfce7;[^>]*>[^<]*<span[^>]*>📋 Pending Insertion[^<]*<\/span>\n/g, '')
        .replace(/<\/div>\n?$/g, '');

    // Clean up any dangling HTML markers
    finalContent = finalContent.replace(/<div style="background-color: #dcfce7;[^>]*>\n?$/gm, '').trim();

    review.decisions.push({ suggestion, action: 'accept' });
    setUserInputContent(finalContent, true, 'Wizard Accept - Confirmed');
    clearHighlightInEditor();
    review.currentIndex++;

    // Track accepted suggestions for smarter formatting on final review
    if (!review.acceptedSuggestions) {
        review.acceptedSuggestions = [];
    }
    review.acceptedSuggestions.push(suggestion);

    showCurrentSuggestion();
}

export function dismissPreviewAndReject() {
    const review = currentSuggestionReview;
    if (!review) return;
    const suggestion = review.suggestions[review.currentIndex];

    showFeedbackModal(`current-review-${review.currentIndex}`, suggestion, (reason) => {
        review.decisions.push({ suggestion, action: 'reject', feedbackReason: reason });
        clearHighlightInEditor();
        review.currentIndex++;
        showCurrentSuggestion();
    });
}

function setSuggestionButtonApplying(buttonId, isApplying) {
    const button = document.getElementById(buttonId);
    if (!button) return;
    if (isApplying) {
        button.dataset.originalText = button.textContent;
        button.textContent = '⏳';
        button.disabled = true;
    } else {
        if (button.dataset.originalText) button.textContent = button.dataset.originalText;
        button.disabled = false;
    }
}
function setAllSuggestionButtonsApplying(isApplying) {
    ['suggestionAcceptBtn', 'suggestionRejectBtn', 'suggestionModifyBtn', 'suggestionSkipBtn', 'suggestionCancelBtn']
        .forEach(id => setSuggestionButtonApplying(id, isApplying));
}

export function navigateSuggestion(direction) {
    const review = currentSuggestionReview;
    if (!review) return;
    clearHighlightInEditor();
    if (direction < 0 && review.currentIndex > 0) {
        review.currentIndex--;
        if (review.decisions.length > review.currentIndex) review.decisions.pop();
    }
    showCurrentSuggestion();
}

// Consolidate and organize note for better structure and readability
function consolidateNoteFormat(noteContent) {
    // Clean up duplicate content and organize into logical sections
    // Remove obvious duplicate lines (exact matches)
    const lines = noteContent.split('\n');
    const seen = new Set();
    const consolidated = [];

    for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed && !seen.has(trimmed)) {
            consolidated.push(line);
            seen.add(trimmed);
        } else if (!trimmed) {
            // Keep blank lines to preserve structure
            if (consolidated[consolidated.length - 1]?.trim() !== '') {
                consolidated.push(line);
            }
        }
    }

    // Join back and clean up multiple consecutive blank lines
    let result = consolidated.join('\n');
    result = result.replace(/\n\n\n+/g, '\n\n'); // Max 2 consecutive newlines

    return result;
}

export function completeSuggestionReview() {
    const review = currentSuggestionReview;
    if (!review) return;
    clearHighlightInEditor();
    submitFeedbackFromReview(review);
    const accepted = review.decisions.filter(d => d.action === 'accept').length;
    const rejected = review.decisions.filter(d => d.action === 'reject').length;
    const reviewContainer = document.getElementById('suggestion-review-current');
    if (reviewContainer) reviewContainer.outerHTML = '';

    // Consolidate note formatting to remove duplicates and organize better
    const currentNoteContent = getUserInputContent();
    const consolidatedContent = consolidateNoteFormat(currentNoteContent);
    if (consolidatedContent !== currentNoteContent) {
        setUserInputContent(consolidatedContent, false, 'Wizard Consolidate');
    }

    updateUser(`Review complete: ${accepted} accepted, ${rejected} rejected.`, false);
    currentSuggestionReview = null;
    window.currentSuggestionReview = null;
    updateSuggestionActionButtons();

    // Check if we're in sequential processing mode and need to move to next guideline
    if (window.sequentialProcessingActive) {
        console.log('[DEBUG] completeSuggestionReview: Sequential processing active, checking for next guideline');
        const queue = window.sequentialProcessingQueue || [];
        const currentIndex = window.sequentialProcessingIndex || 0;

        if (currentIndex < queue.length - 1) {
            window.sequentialProcessingIndex = currentIndex + 1;
            const nextGuidelineId = queue[currentIndex + 1];
            const nextStepNumber = currentIndex + 2;

            updateUser('Incorporating changes and preparing for next guideline...', true);

            setTimeout(async () => {
                try {
                    updateUser(`Processing guideline ${nextStepNumber}/${queue.length}...`, true);
                    if (typeof window.processSingleGuideline === 'function') {
                        await window.processSingleGuideline(nextGuidelineId, nextStepNumber, queue.length);
                    }
                } catch (error) {
                    console.error('[DEBUG] Error processing next guideline:', error);
                    updateUser(`Error processing guideline ${nextStepNumber}: ${error.message}`, false);
                }
            }, 1000);
        } else {
            console.log('[DEBUG] completeSuggestionReview: All guidelines complete!');
            window.sequentialProcessingActive = false;
            if (typeof window.updateAnalyseButtonProgress === 'function') window.updateAnalyseButtonProgress('All Guidelines Complete!', false);
            if (typeof window.removeTransientMessages === 'function') window.removeTransientMessages();
            updateUser(`All ${queue.length} selected guidelines processed successfully.`, false);
        }
    }
}

export function cancelSuggestionReview() {
    clearHighlightInEditor();
    const reviewContainer = document.getElementById('suggestion-review-current');
    if (reviewContainer) reviewContainer.outerHTML = '';
    updateUser('Suggestion review cancelled.', false);
    currentSuggestionReview = null;
    window.currentSuggestionReview = null;
    updateSuggestionActionButtons();
}

export function showModifySection() {
    const el = document.getElementById('modify-section-current');
    if (el) el.style.display = 'block';
}
export function hideModifySection() {
    const el = document.getElementById('modify-section-current');
    if (el) el.style.display = 'none';
}

export async function handleCurrentSuggestionAction(action) {
    const review = currentSuggestionReview;
    if (!review) return;
    const suggestion = review.suggestions[review.currentIndex];

    if (action === 'reject') {
        showFeedbackModal(`current-review-${review.currentIndex}`, suggestion, (reason) => {
            review.decisions.push({ suggestion, action: 'reject', feedbackReason: reason });
            clearHighlightInEditor();
            review.currentIndex++;
            showCurrentSuggestion();
        });
        return;
    }

    if (action === 'accept') {
        review.decisions.push({ suggestion, action: 'accept' });
        const currentContent = getUserInputContent();
        let newContent;
        if (suggestion.category === 'addition' || !suggestion.originalText) {
            newContent = currentContent + '\n' + suggestion.suggestedText;
        } else {
            const res = applySuggestionTextReplacement(currentContent, suggestion.originalText, suggestion.suggestedText);
            newContent = res.newContent;
        }
        setUserInputContent(newContent, true, 'Wizard Accept');
    }
    if (action === 'skip') review.decisions.push({ suggestion, action: 'skip' });

    clearHighlightInEditor();
    review.currentIndex++;
    showCurrentSuggestion();
}

export async function confirmCurrentModification() {
    const review = currentSuggestionReview;
    if (!review) return;
    const ta = document.getElementById('modify-textarea-current');
    const modifiedText = ta ? ta.value.trim() : '';
    if (!modifiedText) return alert('Enter text');

    const suggestion = review.suggestions[review.currentIndex];
    review.decisions.push({ suggestion, action: 'modify', modifiedText });

    const currentContent = getUserInputContent();
    let newContent;
    if (suggestion.originalText) {
        const res = applySuggestionTextReplacement(currentContent, suggestion.originalText, modifiedText);
        newContent = res.newContent;
    } else {
        newContent = currentContent + '\n' + modifiedText;
    }
    setUserInputContent(newContent, true, 'Wizard Modify');
    clearHighlightInEditor();
    review.currentIndex++;
    showCurrentSuggestion();
}

// --- Combined / Parallel Logic (Legacy) ---

export async function generateCombinedInteractiveSuggestions(analysisResults) {
    try {
        const user = auth.currentUser;
        if (!user) throw new Error('User not authenticated');
        const idToken = await user.getIdToken();

        const guidelineAnalyses = analysisResults.map(result => ({
            guidelineId: result.guideline,
            guidelineTitle: result.guidelineTitle || result.guideline,
            analysis: result.analysis
        }));

        const response = await fetch(`${SERVER_URL}/multiGuidelineDynamicAdvice`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
            body: JSON.stringify({
                transcript: getUserInputContent(), // Assume window.latestAnalysis.transcript matches editor
                guidelineAnalyses
            })
        });

        if (!response.ok) throw new Error(`API error: ${response.status}`);
        const result = await response.json();
        if (!result.success) throw new Error(result.error);

        currentAdviceSession = result.sessionId;
        currentSuggestions = result.combinedSuggestions || [];
        userDecisions = {};

        await displayCombinedInteractiveSuggestions(result.combinedSuggestions, result.guidelinesSummary);
        return result;
    } catch (error) {
        console.error('Combined generation failed', error);
        // Fallback?
    }
}

export async function displayCombinedInteractiveSuggestions(suggestions, guidelinesSummary) {
    // If strict One-At-A-Time desired:
    // const guidelineTitle = `${guidelinesSummary?.length || 0} Guidelines Combined`;
    // return displayInteractiveSuggestions(suggestions, guidelineTitle);

    // BUT we want the Combined View (List) which was implemented in displayCombinedSuggestions
    return displayCombinedSuggestions([], [], suggestions); // Refactored signature
}

// Rewriting displayCombinedSuggestions to match new module
export async function displayCombinedSuggestions(successfulResults, failedResults, directSuggestions = null) {
    let allSuggestions = directSuggestions || [];

    // If not provided directly, extract from results
    if (allSuggestions.length === 0 && successfulResults) {
        let suggestionCounter = 1;
        successfulResults.forEach(r => {
            const ags = r.result?.suggestions || [];
            ags.forEach(s => {
                allSuggestions.push({
                    ...s,
                    id: `multi_${suggestionCounter++}`,
                    sourceGuideline: r.guideline?.title,
                    sourceGuidelineId: r.guideline?.id,
                    sourceGuidelineFilename: r.result?.guidelineFilename,
                    originalId: s.id
                });
            });
        });
    }

    currentSuggestions = allSuggestions; // Sync global state

    let combinedHtml = `<div class="combined-advice-container"><h3>💡 Combined Suggestions</h3><div class="suggestions-list">`;

    allSuggestions.forEach((s, idx) => {
        const pClass = `priority-${s.priority || 'medium'}`;
        combinedHtml += `
            <div class="suggestion-item ${pClass}" data-suggestion-id="${s.id}">
                <div class="suggestion-header"><span>#${idx + 1} ${getCategoryIcon(s.category)} ${s.priority}</span> <span>${s.sourceGuideline || ''}</span></div>
                <div class="suggestion-content">
                    ${s.originalText ? `<div class="original">"${escapeHtml(s.originalText)}"</div>` : ''}
                    <div class="suggested">"${escapeHtml(s.suggestedText)}"</div>
                    <div class="context">${escapeHtml(s.context)}</div>
                    <div class="link">${createGuidelineViewerLink(s.sourceGuidelineId, s.sourceGuideline, s.sourceGuidelineFilename, s.context)}</div>
                </div>
                <div class="suggestion-actions">
                    <button class="action-btn accept-btn" onclick="handleSuggestionAction('${s.id}', 'accept')">✅ Accept</button>
                    <button class="action-btn reject-btn" onclick="handleSuggestionAction('${s.id}', 'reject')">❌ Reject</button>
                    <button class="action-btn modify-btn" onclick="handleSuggestionAction('${s.id}', 'modify')">✏️ Modify</button>
                </div>
                <div class="modify-section" id="modify-${s.id}" style="display:none">
                     <textarea id="modify-text-${s.id}">${escapeHtml(s.suggestedText)}</textarea>
                     <button onclick="confirmModification('${s.id}')">Confirm</button>
                </div>
                <div id="status-${s.id}" style="display:none"></div>
            </div>
        `;
    });

    combinedHtml += `</div>
        <div class="combined-actions">
             <button onclick="bulkAcceptSuggestions('all')">Accept All</button>
             <button onclick="bulkRejectSuggestions('all')">Reject All</button>
             <button onclick="applyAllDecisions()">Apply Applied Decisions (Batch)</button>
        </div>
    </div>`;
}

// Function to handle cancelling the modification of a specific suggestion
export function cancelModification(suggestionId) {
    const modifySection = document.getElementById(`modify-${suggestionId}`);
    if (modifySection) {
        modifySection.style.display = 'none';

        // Also hide status if it was showing
        const statusDiv = document.getElementById(`status-${suggestionId}`);
        if (statusDiv) statusDiv.innerHTML = '';
    }
}

export function bulkAcceptSuggestions(filter) {
    const items = document.querySelectorAll('.suggestion-item');
    items.forEach(el => {
        const id = el.dataset.suggestionId;
        // Check filter ...
        const status = document.getElementById(`status-${id}`);
        if (status && status.style.display !== 'none') return;
        handleSuggestionAction(id, 'accept');
    });
}
export function bulkRejectSuggestions(filter) {
    const items = document.querySelectorAll('.suggestion-item');
    items.forEach(el => {
        const id = el.dataset.suggestionId;
        const status = document.getElementById(`status-${id}`);
        if (status && status.style.display !== 'none') return;
        handleSuggestionAction(id, 'reject');
    });
}

export async function handleSuggestionAction(suggestionId, action) {
    const suggestion = currentSuggestions.find(s => s.id === suggestionId);
    if (!suggestion) return;

    if (action === 'modify') {
        const el = document.getElementById(`modify-${suggestionId}`);
        if (el) el.style.display = 'block';
        return;
    }
    if (action === 'reject') {
        showFeedbackModal(suggestionId, suggestion, (reason) => {
            userDecisions[suggestionId] = { action: 'reject', suggestion, feedbackReason: reason };
            updateSuggestionStatus(suggestionId, 'reject');
            updateDecisionsSummary();
        });
        return;
    }
    if (action === 'accept') {
        userDecisions[suggestionId] = { action: 'accept', suggestion };
        const content = getUserInputContent();
        let newContent;
        if (suggestion.originalText) {
            newContent = applySuggestionTextReplacement(content, suggestion.originalText, suggestion.suggestedText).newContent;
        } else {
            newContent = content + '\n' + suggestion.suggestedText;
        }
        setUserInputContent(newContent, true, 'Accepted');
        updateSuggestionStatus(suggestionId, 'accept');
        updateDecisionsSummary();
    }
}
export function confirmModification(suggestionId) {
    const ta = document.getElementById(`modify-text-${suggestionId}`);
    if (!ta) return;
    const txt = ta.value;
    const suggestion = currentSuggestions.find(s => s.id === suggestionId);
    userDecisions[suggestionId] = { action: 'modify', suggestion, modifiedText: txt };
    // apply
    const content = getUserInputContent();
    let newContent;
    if (suggestion.originalText) {
        newContent = applySuggestionTextReplacement(content, suggestion.originalText, txt).newContent;
    } else {
        newContent = content + '\n' + txt;
    }
    setUserInputContent(newContent, true, 'Modified');
    updateSuggestionStatus(suggestionId, 'modify');
    updateDecisionsSummary();
}
export function updateSuggestionStatus(suggestionId, action) {
    const statusEl = document.getElementById(`status-${suggestionId}`);
    if (!statusEl) return;
    let icon = action === 'accept' ? '✅' : (action === 'reject' ? '❌' : '✏️');
    statusEl.innerHTML = `<span>${icon} ${action}</span>`;
    statusEl.style.display = 'block';
    const actionsEl = document.querySelector(`[data-suggestion-id="${suggestionId}"] .suggestion-actions`);
    if (actionsEl) actionsEl.style.display = 'none';
}
export function updateDecisionsSummary() {
    const el = document.getElementById('decisionsSummary');
    if (el) {
        const count = Object.keys(userDecisions).length;
        el.textContent = `${count} decisions applied.`;
    }
}
export async function applyAllDecisions() {
    alert('Decisions have been applied immediately.');
}

// --- Feedback Logic ---

export function showFeedbackModal(suggestionId, suggestion, callback) {
    const existing = document.getElementById(`feedback-modal-${suggestionId}`);
    if (existing) existing.remove();
    const modalHtml = `
        <div id="feedback-modal-${suggestionId}" style="position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 10000; display: flex; justify-content: center; align-items: center;">
            <div style="background: white; padding: 20px; border-radius: 8px; width: 400px; max-width: 90%;">
                <h4>Reason for Rejection (Optional)</h4>
                <textarea id="feedback-textarea-${suggestionId}" style="width: 100%; height: 100px; margin: 10px 0;"></textarea>
                <div style="display: flex; justify-content: flex-end; gap: 10px;">
                    <button id="fb-submit-${suggestionId}" style="background: #2563eb; color: white; padding: 8px 16px; border: none; border-radius: 4px;">Submit</button>
                    <button id="fb-skip-${suggestionId}" style="background: #9ca3af; color: white; padding: 8px 16px; border: none; border-radius: 4px;">Skip Feedback</button>
                </div>
            </div>
        </div>
    `;
    document.body.insertAdjacentHTML('beforeend', modalHtml);
    const submitBtn = document.getElementById(`fb-submit-${suggestionId}`);
    const skipBtn = document.getElementById(`fb-skip-${suggestionId}`);
    const finish = (providedReason) => {
        document.getElementById(`feedback-modal-${suggestionId}`).remove();
        if (callback) callback(providedReason);
    };
    submitBtn.onclick = () => {
        const txt = document.getElementById(`feedback-textarea-${suggestionId}`).value.trim();
        finish(txt);
    };
    skipBtn.onclick = () => finish('');
}

export function submitFeedbackFromReview(review) {
    if (!review || !review.decisions) return;
    const entries = review.decisions
        .filter(d => d.action === 'reject' && d.feedbackReason)
        .map(d => ({
            suggestionId: d.suggestion.id,
            rejectionReason: d.feedbackReason,
            originalSuggestion: d.suggestion.originalText
        }));
    if (entries.length > 0) {
        submitGuidelineFeedbackBatch(review.guidelineId, review.guidelineTitle, entries);
    }
}
export async function submitGuidelineFeedbackBatch(guidelineId, guidelineTitle, feedbackEntries) {
    try {
        const user = auth.currentUser;
        if (!user) return;
        const idToken = await user.getIdToken();
        fetch(`${SERVER_URL}/submitGuidelineFeedback`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
            body: JSON.stringify({
                guidelineId,
                sessionId: currentAdviceSession,
                feedbackEntries,
                transcript: getUserInputContent()
            })
        }).then(r => r.json()).then(res => {
            if (res.success) showFeedbackThankYou();
        });
    } catch (e) { console.error(e); }
}
export function showFeedbackThankYou() {
    const el = document.createElement('div');
    el.textContent = '✅ Feedback submitted. Thank you!';
    el.style.cssText = 'position: fixed; bottom: 20px; right: 20px; background: #10b981; color: white; padding: 15px; border-radius: 8px; z-index: 9999;';
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 4000);
}

// Assignments
window.handleSuggestionAction = handleSuggestionAction;
window.applyAllDecisions = applyAllDecisions;
window.handleCurrentSuggestionAction = handleCurrentSuggestionAction;
window.confirmCurrentModification = confirmCurrentModification;
window.navigateSuggestion = navigateSuggestion;
window.showModifySection = showModifySection;
window.hideModifySection = hideModifySection;
window.cancelSuggestionReview = cancelSuggestionReview;
window.confirmModification = confirmModification;
window.bulkAcceptSuggestions = bulkAcceptSuggestions;
window.bulkRejectSuggestions = bulkRejectSuggestions;
window.previewCurrentSuggestion = previewCurrentSuggestion;
window.confirmAndAcceptSuggestion = confirmAndAcceptSuggestion;
window.dismissPreviewAndReject = dismissPreviewAndReject;

