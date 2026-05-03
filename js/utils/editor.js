import { escapeHtml } from './text.js';
import { updateClearFormattingButton, updateAnalyseAndResetButtons } from '../ui/status.js';

/**
 * Highlight specific text in the TipTap editor with a given color
 * @param {string} text - The text to highlight
 * @param {string} color - The color to use (default: blue #3B82F6)
 * @returns {boolean} - True if text was found and highlighted, false otherwise
 */
export function highlightTextInEditor(text, color = '#3B82F6') {
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
export function clearHighlightInEditor() {
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
 * Temporarily bold newly inserted text in the TipTap editor for 3 seconds, then remove bold.
 * @param {string} text - The text to bold
 */
export function flashBoldInEditor(text) {
    const editor = window.editors?.userInput;
    if (!editor || !text) return;

    try {
        const content = editor.getText();
        const startPos = content.toLowerCase().indexOf(text.toLowerCase());
        if (startPos === -1) return;

        const from = startPos + 1;
        const to = from + text.length;

        editor.commands.setTextSelection({ from, to });
        editor.commands.setBold();
        editor.commands.setTextSelection(to);

        setTimeout(() => {
            try {
                const updatedContent = editor.getText();
                const pos = updatedContent.toLowerCase().indexOf(text.toLowerCase());
                if (pos !== -1) {
                    editor.commands.setTextSelection({ from: pos + 1, to: pos + 1 + text.length });
                    editor.commands.unsetBold();
                    editor.commands.setTextSelection(pos + 1 + text.length);
                }
            } catch (_) { /* text may have changed, ignore */ }
        }, 3000);
    } catch (error) {
        console.error('[BOLD FLASH] Error:', error);
    }
}

/**
 * Scroll the specified text into view in the editor
 * @param {string} text - The text to scroll to
 * @returns {boolean} - True if scrolled successfully
 */
export function scrollTextIntoView(text) {
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

// Import helper functions for TipTap programmatic change tracking
export function getUserInputContent() {
    const editor = window.editors?.userInput;
    if (editor && editor.getText) {
        return editor.getText();
    }
    return '';
}

export function setUserInputContent(content, isProgrammatic = false, changeType = 'Content Update', replacements = null, isHtml = false) {
    const editor = window.editors?.userInput;

    if (!editor || !editor.commands) {
        console.warn('[PROGRAMMATIC] TipTap editor not ready — queuing content until tiptapReady');
        window.addEventListener('tiptapReady', () => {
            setUserInputContent(content, isProgrammatic, changeType, replacements, isHtml);
        }, { once: true });
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
        if (window.programmaticChangeHistory) {
            window.programmaticChangeHistory.push({
                type: changeType,
                content: safeContent,
                timestamp: new Date(),
                editorState: editor.getJSON(), // State AFTER the change (for redo)
                editorStateBefore: stateBeforeChange // State BEFORE the change (for undo)
            });
            window.currentChangeIndex = window.programmaticChangeHistory.length - 1;
        }

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

export function appendToOutputField(content, clearExisting = true, isHtml = false) {
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

// Function to update button states
export function updateUndoRedoButtons() {
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
        const historyIndex = window.clinicalNoteHistoryIndex ?? 0;
        const historyLength = window.clinicalNoteHistory?.length ?? 0;

        if (undoBtn) {
            undoBtn.disabled = historyIndex <= 0;
        }
        if (redoBtn) {
            redoBtn.disabled = historyIndex >= historyLength - 1;
        }
    }
}

// Show/hide action buttons based on input content
export function updateChatbotButtonVisibility() {
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

// ---- Replacement preview state ----
// Stores editor content before any preview is applied, so we can cleanly restore it.
let _contentBeforePreview = null;
// When a suggestion replaces existing text, stores { originalText, suggestionText } for rendering.
let _replacementPreview = null;
// Track insertion point line number so we can retrieve edited text later
let _insertionLineIndex = -1;

/** @returns {{ originalText: string, suggestionText: string } | null} */
export function getReplacementPreview() { return _replacementPreview; }
/** @returns {string | null} The editor text content before the preview was applied */
export function getContentBeforePreview() { return _contentBeforePreview; }
/** Clear replacement state (called after accept or when preview is dismissed) */
export function clearReplacementState() { _replacementPreview = null; _contentBeforePreview = null; }
/** @returns {number} The line index where the insertion will occur */
export function getInsertionLineIndex() { return _insertionLineIndex; }
/**
 * Get the actual text at the insertion point from the editor.
 * This may have been edited by the user from the original suggestion.
 * @returns {string} The text at the insertion point, or empty string if not found
 */
export function getEditedInsertionText() {
    const editor = window.editors?.userInput;
    if (!editor || _insertionLineIndex < 0) return '';

    const lines = editor.getText().split('\n');
    if (_insertionLineIndex >= lines.length) return '';

    const line = lines[_insertionLineIndex];
    // Extract just the text content, removing the placeholder marker if present
    return line.replace(INSERTION_PLACEHOLDER, '').trim();
}

/**
 * Placeholder text inserted into the note to show where a suggestion will land.
 * Styled in green via CSS class "insertion-placeholder".
 */
export const INSERTION_PLACEHOLDER = '⟨TEXT TO BE INSERTED HERE⟩';

/**
 * Insert a styled placeholder into the TipTap content at the predicted insertion
 * point for the given suggestion. The placeholder lives in TipTap's actual document
 * (not in injected DOM) so it cannot leak into saved content unexpectedly.
 *
 * List-aware: if inserting after a numbered plan item, prefixes with the next number.
 * If inserting after a dashed bullet, prefixes with "- ".
 *
 * @param {Object} suggestion - The suggestion object (replace_pattern, missing_info, target_section, evidence)
 * @returns {boolean} - True if preview was placed
 */
export function showInsertionPreview(suggestion) {
    clearInsertionPreview();

    const editor = window.editors?.userInput;
    if (!editor) return false;

    const content = editor.getText();
    if (!content?.trim()) return false;

    // Snapshot content before preview for clean restoration
    _contentBeforePreview = content;

    const lines = content.split('\n');
    const replacePattern = suggestion?.replace_pattern;
    const missingInfo = (suggestion?.missing_info || '').trim();
    const targetSection = suggestion?.target_section || suggestion?.evidence || '';

    let insertIdx = lines.length; // default: append
    let replaceExisting = false;

    // Guideline suggestion fields (from /dynamicAdvice)
    const originalText = suggestion?.originalText || '';
    const guidelineRef = suggestion?.guidelineReference || '';
    const category = suggestion?.category || '';

    // 1. Exact replace_pattern match — placeholder replaces that line in-place
    if (replacePattern) {
        const idx = lines.findIndex(l => l.includes(replacePattern));
        if (idx !== -1) { insertIdx = idx; replaceExisting = true; }
    }

    // 2. missing_info as a standalone label line (case-insensitive)
    if (!replaceExisting && missingInfo) {
        const idx = lines.findIndex(l => l.trim().toLowerCase() === missingInfo.toLowerCase());
        if (idx !== -1) { insertIdx = idx; replaceExisting = true; }
    }

    // 3. For modification suggestions: find originalText in the note and replace it
    if (!replaceExisting && category === 'modification' && originalText && !originalText.startsWith('Missing:') && !originalText.startsWith('Gap:')) {
        const snippet = originalText.slice(0, 60).toLowerCase();
        const idx = lines.findIndex(l => l.toLowerCase().includes(snippet));
        if (idx !== -1) {
            insertIdx = idx;
            replaceExisting = true;
            // Store replacement preview state for strikethrough rendering
            const suggestionText = suggestion?.suggestion || '';
            if (suggestionText) {
                _replacementPreview = {
                    originalText: originalText,
                    suggestionText: suggestionText
                };
            }
        }
    }

    // 3b. Keyword fallback: if originalText was stale (not found in current note after edits),
    //     try matching the suggestion text against note lines by keyword overlap.
    if (!replaceExisting && suggestion?.suggestion) {
        const suggWords = new Set(
            suggestion.suggestion.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(w => w.length > 3)
        );
        if (suggWords.size >= 3) {
            let bestIdx = -1, bestScore = 0;
            for (let i = 0; i < lines.length; i++) {
                const lineWords = lines[i].toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/);
                const overlap = lineWords.filter(w => suggWords.has(w)).length;
                // Score = overlap as fraction of suggestion keywords, but require >=40% and >=3 words
                const score = overlap / suggWords.size;
                if (overlap >= 3 && score >= 0.4 && score > bestScore) {
                    bestScore = score;
                    bestIdx = i;
                }
            }
            if (bestIdx !== -1) {
                insertIdx = bestIdx;
                replaceExisting = true;
                _replacementPreview = {
                    originalText: lines[bestIdx].trim(),
                    suggestionText: suggestion.suggestion
                };
                console.log(`[PREVIEW] Keyword fallback matched line ${bestIdx} (score: ${bestScore.toFixed(2)})`);
            }
        }
    }

    // 4. After the target section heading (completeness items) or guideline reference (guideline suggestions)
    const sectionHint = targetSection || guidelineRef;
    if (!replaceExisting && sectionHint) {
        const lowerTarget = sectionHint.toLowerCase().replace(/[^a-z0-9]/g, '');
        const idx = lines.findIndex(l => l.toLowerCase().replace(/[^a-z0-9]/g, '').includes(lowerTarget));
        if (idx !== -1) {
            // Find the end of that section (next blank line or end of content)
            let sectionEnd = idx;
            for (let i = idx + 1; i < lines.length; i++) {
                if (lines[i].trim() === '' && i > idx + 1) break;
                sectionEnd = i;
            }
            insertIdx = sectionEnd + 1;
        }
    }

    // Detect list context from the line at or before the insertion point
    const contextLine = (lines[replaceExisting ? insertIdx : insertIdx - 1] || '').trimStart();
    let placeholder = INSERTION_PLACEHOLDER;
    const numberedMatch = contextLine.match(/^(\d+)\.\s/);
    const dashedMatch = contextLine.match(/^[-–]\s/);
    if (numberedMatch) {
        placeholder = `${parseInt(numberedMatch[1], 10) + 1}. ${INSERTION_PLACEHOLDER}`;
    } else if (dashedMatch) {
        placeholder = `- ${INSERTION_PLACEHOLDER}`;
    }

    // Build new content with placeholder
    const newLines = [...lines];
    if (replaceExisting) {
        newLines[insertIdx] = placeholder;
    } else {
        newLines.splice(insertIdx, 0, placeholder);
    }

    // Store insertion line index for later retrieval of edited text
    _insertionLineIndex = replaceExisting ? insertIdx : insertIdx;

    // Convert to HTML, styling the placeholder line in green
    const html = _buildHtmlWithPlaceholder(newLines.join('\n'));
    editor.commands.setContent(html);

    // Scroll placeholder into view and select it to indicate editability
    setTimeout(() => {
        const pm = document.querySelector('#userInput .ProseMirror');
        if (!pm) return;
        const walker = document.createTreeWalker(pm, NodeFilter.SHOW_TEXT);
        let node;
        while ((node = walker.nextNode())) {
            if (node.textContent.includes(INSERTION_PLACEHOLDER)) {
                node.parentElement?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                // Select the placeholder text to make it obvious it can be edited
                try {
                    const range = document.createRange();
                    range.selectNodeContents(node);
                    const selection = window.getSelection();
                    selection.removeAllRanges();
                    selection.addRange(range);
                } catch (e) {
                    console.log('[PREVIEW] Could not select placeholder text');
                }
                break;
            }
        }
    }, 50);

    console.log('[PREVIEW] Placeholder inserted at line', insertIdx, replaceExisting ? '(replacing existing)' : '(new line)');
    return true;
}

/**
 * Remove the insertion placeholder from the note content.
 * Safe to call even if no placeholder is present.
 */
export function clearInsertionPreview() {
    const editor = window.editors?.userInput;
    if (!editor) return;

    // Replacement preview: restore from pre-preview snapshot
    if (_replacementPreview && _contentBeforePreview !== null) {
        const normalised = _contentBeforePreview.replace(/\n{3,}/g, '\n\n');
        const html = normalised.split('\n\n')
            .filter(p => p.trim())
            .map(p => `<p>${p.split('\n').map(l => escapeHtml(l)).join('<br>')}</p>`)
            .join('');
        editor.commands.setContent(html || '<p></p>');
        _replacementPreview = null;
        _contentBeforePreview = null;
        _insertionLineIndex = -1;
        console.log('[PREVIEW] Replacement preview cleared (restored from snapshot)');
        return;
    }

    _contentBeforePreview = null;
    _insertionLineIndex = -1;

    // Standard placeholder: filter out placeholder lines
    const text = editor.getText();
    if (!text.includes(INSERTION_PLACEHOLDER)) return;

    const cleaned = text.split('\n')
        .filter(l => !l.includes(INSERTION_PLACEHOLDER))
        .join('\n');

    // Rebuild HTML without placeholder and set directly (no history entry)
    const normalised = cleaned.replace(/\n{3,}/g, '\n\n');
    const html = normalised.split('\n\n')
        .filter(p => p.trim())
        .map(p => `<p>${p.split('\n').map(l => escapeHtml(l)).join('<br>')}</p>`)
        .join('');
    editor.commands.setContent(html || '<p></p>');
    console.log('[PREVIEW] Placeholder cleared');
}

/**
 * Build HTML content where lines containing INSERTION_PLACEHOLDER are styled in green.
 * All other content is plain-escaped.
 */
function _buildHtmlWithPlaceholder(text) {
    const normalised = text.replace(/\n{3,}/g, '\n\n');
    return normalised.split('\n\n')
        .filter(p => p.trim())
        .map(p => {
            const lines = p.split('\n').map(line => {
                if (line.includes(INSERTION_PLACEHOLDER)) {
                    if (_replacementPreview) {
                        // Replacement mode: show old text strikethrough + new text in green
                        const oldHtml = `<span style="text-decoration:line-through; color:#e53935; opacity:0.7;">${escapeHtml(_replacementPreview.originalText)}</span>`;
                        // Use inline styles instead of CSS class (TipTap may strip classes)
                        const newHtml = `<span style="color:#2e7d32; background:rgba(76,175,80,0.12); border:1px dashed #4caf50; border-radius:3px; padding:1px 5px; font-style:italic; font-weight:600; font-size:0.93em;">${escapeHtml(_replacementPreview.suggestionText)}</span>`;
                        return `${oldHtml}<br>${newHtml}`;
                    }
                    // Standard mode: show placeholder text in green
                    const parts = line.split(INSERTION_PLACEHOLDER);
                    const prefix = escapeHtml(parts[0] || '');
                    // Use inline styles instead of CSS class (TipTap may strip classes)
                    return `${prefix}<span style="color:#2e7d32; background:rgba(76,175,80,0.12); border:1px dashed #4caf50; border-radius:3px; padding:1px 5px; font-style:italic; font-weight:600; font-size:0.93em;">${escapeHtml(INSERTION_PLACEHOLDER)}</span>`;
                }
                return escapeHtml(line);
            });
            return `<p>${lines.join('<br>')}</p>`;
        })
        .join('');
}

/**
 * Helper to apply color to replacing text
 * @param {string} text - Original text
 * @param {Array} replacements - Array of replacement objects or strings
 * @returns {string} HTML string
 */
function applyColoredReplacements(text, replacements) {
    if (!text) return '';
    let html = escapeHtml(text);
    if (!replacements || replacements.length === 0) {
        return html.replace(/\n/g, '<br>');
    }

    replacements.forEach(rep => {
        let target = '';
        if (typeof rep === 'string') {
            target = rep;
        } else if (typeof rep === 'object') {
            target = rep.replacement || rep.text || '';
        }

        if (target) {
            const escapedTarget = escapeHtml(target);
            // Robust check to avoid infinite recursion if target is part of span tag (unlikely due to escape, but...)
            if (html.includes(escapedTarget)) {
                html = html.split(escapedTarget).join(`<span style="color: #D97706">${escapedTarget}</span>`);
            }
        }
    });

    return html.replace(/\n/g, '<br>');
}
