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
        return result.insertionPoint;
    } catch (error) {
        console.warn('[DEBUG] Insertion point determination failed, falling back:', error);
        return { section: 'end', insertionMethod: 'append' };
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
    if ((suggestion.category === 'addition' || !suggestion.originalText) && !suggestion.cachedInsertionPoint) {
        determineInsertionPoint(suggestion, getUserInputContent()).then(pt => {
            suggestion.cachedInsertionPoint = pt;
        }).catch(err => console.warn('Pre-fetch failed', err));
    }

    const guidelineLink = createGuidelineViewerLink(
        review.guidelineId, review.guidelineTitle, review.guidelineFilename,
        suggestion.context, suggestion.hasVerbatimQuote, suggestion.suggestedText
    );

    const suggestionHtml = `
        <div class="dynamic-advice-container" id="suggestion-review-current">
            <div style="display: flex; justify-content: space-between; align-items: baseline; margin: 0 0 15px 0;">
                <h3 style="color: #2563eb; margin: 0;">💡 Suggestion ${progressText} (${suggestion.priority || 'medium'} priority)</h3>
                <p style="margin: 0; font-size: 13px; color: #666; text-align: right;"><em>From: ${review.guidelineTitle || 'Guideline Analysis'}</em></p>
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
            <div style="margin-top: 15px; text-align: center; font-size: 13px; color: #666;">${review.decisions.length} decision${review.decisions.length !== 1 ? 's' : ''} made • ${review.suggestions.length - review.currentIndex - 1} remaining</div>
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
    if (acceptBtn) acceptBtn.onclick = () => handleCurrentSuggestionAction('accept');
    const rejectBtn = document.getElementById('suggestionRejectBtn');
    if (rejectBtn) rejectBtn.onclick = () => handleCurrentSuggestionAction('reject');
    const modifyBtn = document.getElementById('suggestionModifyBtn');
    if (modifyBtn) modifyBtn.onclick = () => showModifySection();
    const skipBtn = document.getElementById('suggestionSkipBtn');
    if (skipBtn) skipBtn.onclick = () => handleCurrentSuggestionAction('skip');
    const cancelBtn = document.getElementById('suggestionCancelBtn');
    if (cancelBtn) cancelBtn.onclick = () => cancelSuggestionReview();

    setAllSuggestionButtonsApplying(false);
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

export function completeSuggestionReview() {
    const review = currentSuggestionReview;
    if (!review) return;
    clearHighlightInEditor();
    submitFeedbackFromReview(review);
    const accepted = review.decisions.filter(d => d.action === 'accept').length;
    const rejected = review.decisions.filter(d => d.action === 'reject').length;
    const reviewContainer = document.getElementById('suggestion-review-current');
    if (reviewContainer) reviewContainer.outerHTML = '';

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

