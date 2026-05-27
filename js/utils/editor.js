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

    // In replacement mode, the placeholder line is rendered as
    //   <strikethrough-original><br><green-new>
    // which `editor.getText()` splits into two adjacent `\n`-separated lines:
    // the strikethrough sits at `_insertionLineIndex`, the user-editable green text
    // at `_insertionLineIndex + 1`. Reading from the strikethrough line would
    // hand the caller the original text — and a "replace original with original"
    // becomes a silent no-op when the wizard accepts the suggestion.
    const targetIndex = _replacementPreview ? _insertionLineIndex + 1 : _insertionLineIndex;
    if (targetIndex >= lines.length) {
        // Defensive fallback — the rendered layout has shifted (e.g. user collapsed lines),
        // so prefer the stored suggestion text over returning nothing.
        return _replacementPreview?.suggestionText || '';
    }

    const line = lines[targetIndex];
    const edited = line.replace(INSERTION_PLACEHOLDER, '').trim();

    // showInsertionPreview() prepends a list prefix ("5. " or "- ") when inserting after a
    // numbered or dashed line. That prefix lives OUTSIDE the editable green placeholder span,
    // so clicking Insert without typing leaves the line as just the bare prefix (e.g. "5.").
    // Returning that truthy string makes the wizard treat the prefix as user-edited content
    // and insert it verbatim, producing lines like "5. 5." with no suggestion text.
    // Treat a bare list prefix as "no edit" so the caller falls back to the suggestion text.
    const stripped = edited.replace(/^(\d+\.\s*|[-–]\s*)/, '').trim();
    if (!stripped) return '';

    return edited;
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

    // Snapshot content before preview for clean restoration. This snapshot is
    // also what the accept handler uses to call the LLM placement endpoint,
    // so even if a future edit to this function reintroduces a destructive
    // path, the accept side still sees the original note.
    _contentBeforePreview = content;

    const lines = content.split('\n');
    const targetSection = suggestion?.target_section || suggestion?.evidence || '';
    const guidelineRef = suggestion?.guidelineReference || '';

    // ADDITIVE-ONLY PREVIEW
    // ─────────────────────
    // The preview is purely visual hinting. The real insertion logic runs on
    // accept, via /determineSingleSuggestionInsertionPoint. So we never
    // replace existing lines here — we only insert a new placeholder line at
    // a sensible position:
    //   1. End of target section, if a target section is named and found
    //   2. End of the note otherwise
    //
    // The previous behaviour matched suggestions to existing lines by
    // replace_pattern / missing_info / originalText / keyword overlap and
    // marked those whole lines for replacement. For a single-paragraph note,
    // every keyword-overlap match was "the whole note is one line", which
    // wiped the note on accept. Removed.
    let insertIdx = lines.length; // default: append at end of note

    const sectionHint = targetSection || guidelineRef;
    if (sectionHint) {
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

    // Detect list context from the line before the insertion point so the
    // placeholder picks up "2. " / "- " formatting from a surrounding list.
    const contextLine = (lines[insertIdx - 1] || '').trimStart();
    let placeholder = INSERTION_PLACEHOLDER;
    const numberedMatch = contextLine.match(/^(\d+)\.\s/);
    const dashedMatch = contextLine.match(/^[-–]\s/);
    if (numberedMatch) {
        placeholder = `${parseInt(numberedMatch[1], 10) + 1}. ${INSERTION_PLACEHOLDER}`;
    } else if (dashedMatch) {
        placeholder = `- ${INSERTION_PLACEHOLDER}`;
    }

    // Always splice a new placeholder line in — never overwrite an existing line.
    const newLines = [...lines];
    newLines.splice(insertIdx, 0, placeholder);

    // Store insertion line index for later retrieval of edited text
    _insertionLineIndex = insertIdx;

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

    console.log('[PREVIEW] Placeholder inserted at line', insertIdx, '(new line)');
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

// ----- Diff-preview accept flow -----------------------------------------
// New flow (replaces the placeholder preview for guideline suggestions):
//   1. Wizard Accept → server returns marked-up note with <del>/<ins> tags
//   2. renderDiffMarkup() renders it with red strikethrough + green inserts
//   3. User reviews (and can edit inline before deciding)
//   4. Apply → applyDiffMarkup() strips markup, normalises styling
//      Discard → discardDiffMarkup() restores from snapshot

const DEL_STYLE = 'text-decoration: line-through; color: #dc2626; background: rgba(220, 38, 38, 0.08);';
const INS_STYLE = 'color: #16a34a; background: rgba(22, 163, 74, 0.08); text-decoration: underline;';

/**
 * Render the LLM's marked-up note in the editor with visible diff styling.
 * Converts <del>...</del> to red strikethrough spans and <ins>...</ins> to
 * green underlined spans. Snapshots the prior note for discardDiffMarkup().
 *
 * The pre-preview snapshot may already be set by showInsertionPreview (it
 * runs when the suggestion first surfaces). We preserve it. If not set,
 * we capture the current editor text as the baseline for revert.
 */
export function renderDiffMarkup(markupText) {
    const editor = window.editors?.userInput;
    if (!editor || typeof markupText !== 'string' || !markupText) return false;

    // Capture snapshot if not already taken (so Discard can revert).
    if (_contentBeforePreview === null) {
        _contentBeforePreview = editor.getText() || '';
    }

    // Process del/ins markup GLOBALLY (across newlines), not per-line — the
    // LLM frequently wraps multi-paragraph blocks in <ins>...</ins>, so a
    // per-line transform would see an opener with no matching closer and
    // escape the whole block as raw text. We walk the whole string, then
    // split into paragraphs/lines afterwards. Newlines inside a del/ins
    // block are preserved by converting them to <br> tags inline.
    const DEL_OPEN = '<del>', DEL_CLOSE = '</del>';
    const INS_OPEN = '<ins>', INS_CLOSE = '</ins>';

    // Step 1: build an array of segments, each tagged as plain | ins | del.
    const segments = [];
    let i = 0;
    while (i < markupText.length) {
        if (markupText.startsWith(DEL_OPEN, i)) {
            const end = markupText.indexOf(DEL_CLOSE, i + DEL_OPEN.length);
            if (end === -1) {
                segments.push({ kind: 'plain', text: markupText.slice(i) });
                break;
            }
            segments.push({ kind: 'del', text: markupText.slice(i + DEL_OPEN.length, end) });
            i = end + DEL_CLOSE.length;
        } else if (markupText.startsWith(INS_OPEN, i)) {
            const end = markupText.indexOf(INS_CLOSE, i + INS_OPEN.length);
            if (end === -1) {
                segments.push({ kind: 'plain', text: markupText.slice(i) });
                break;
            }
            segments.push({ kind: 'ins', text: markupText.slice(i + INS_OPEN.length, end) });
            i = end + INS_CLOSE.length;
        } else {
            const nextDel = markupText.indexOf(DEL_OPEN, i);
            const nextIns = markupText.indexOf(INS_OPEN, i);
            let next;
            if (nextDel === -1) next = nextIns;
            else if (nextIns === -1) next = nextDel;
            else next = Math.min(nextDel, nextIns);
            if (next === -1) {
                segments.push({ kind: 'plain', text: markupText.slice(i) });
                break;
            }
            segments.push({ kind: 'plain', text: markupText.slice(i, next) });
            i = next;
        }
    }

    // Step 2: split each segment by paragraph breaks (blank lines). A
    // segment may straddle a paragraph boundary if the LLM wrapped a
    // multi-paragraph block in del/ins — we need to close and reopen the
    // styled span around the paragraph break so each <p> is well-formed.
    function renderSegmentInline(seg) {
        // Inline rendering: newlines (within a single paragraph) become <br>.
        const escapedLines = seg.text.split('\n').map(l => escapeHtml(l));
        const inner = escapedLines.join('<br>');
        if (seg.kind === 'del') return `<span style="${DEL_STYLE}">${inner}</span>`;
        if (seg.kind === 'ins') return `<span style="${INS_STYLE}">${inner}</span>`;
        return inner;
    }

    // Flatten the segments into paragraphs by splitting on \n\n boundaries.
    // Within a styled segment, paragraph breaks must close the span and
    // reopen it in the next paragraph.
    const paragraphs = [''];
    function pushToCurrent(html) {
        paragraphs[paragraphs.length - 1] += html;
    }
    function startParagraph() {
        paragraphs.push('');
    }

    for (const seg of segments) {
        // Split the segment's text on paragraph breaks (\n\n+).
        const parts = seg.text.split(/\n\n+/);
        parts.forEach((part, idx) => {
            if (idx > 0) startParagraph();
            if (!part) return;
            pushToCurrent(renderSegmentInline({ kind: seg.kind, text: part }));
        });
    }

    const html = paragraphs
        .filter(p => p.trim())
        .map(p => `<p>${p}</p>`)
        .join('');

    editor.commands.setContent(html || '<p></p>');
    console.log('[DIFF] Markup rendered (' + segments.length + ' segments, ' + paragraphs.length + ' paragraphs)');
    return true;
}

/**
 * Apply the diff-preview: strip <del>-styled spans entirely, unwrap
 * <ins>-styled spans (keep text, drop styling). Returns the clean text.
 *
 * Robust to user inline edits: it works on the current editor HTML, so any
 * text the user added themselves outside the styled spans is preserved.
 */
export function applyDiffMarkup() {
    const editor = window.editors?.userInput;
    if (!editor) return null;

    const html = editor.getHTML();
    const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
    const root = doc.body.firstChild;
    if (!root) return null;

    // Process spans by style. Order matters: remove deletions first, then
    // unwrap insertions, so deleted-content isn't accidentally promoted.
    Array.from(root.querySelectorAll('span')).forEach(span => {
        const style = span.getAttribute('style') || '';
        if (/line-through/i.test(style)) {
            span.remove();
        } else if (/#16a34a/i.test(style)) {
            const textNode = doc.createTextNode(span.textContent || '');
            span.parentNode?.replaceChild(textNode, span);
        }
    });
    // Defensive: also remove native <s>/<del> elements (LLM may emit raw
    // tags that TipTap parses as native marks rather than styled spans).
    Array.from(root.querySelectorAll('s, del')).forEach(el => el.remove());
    // Unwrap native <ins> elements too
    Array.from(root.querySelectorAll('ins')).forEach(el => {
        const textNode = doc.createTextNode(el.textContent || '');
        el.parentNode?.replaceChild(textNode, el);
    });

    editor.commands.setContent(root.innerHTML || '<p></p>');
    _contentBeforePreview = null;
    _insertionLineIndex = -1;
    _replacementPreview = null;
    console.log('[DIFF] Markup applied');
    return editor.getText();
}

/**
 * Discard the diff-preview: restore the editor from the pre-preview snapshot.
 */
export function discardDiffMarkup() {
    const editor = window.editors?.userInput;
    if (!editor) return false;
    if (_contentBeforePreview === null) return false;

    const text = _contentBeforePreview;
    const normalised = text.replace(/\n{3,}/g, '\n\n');
    const html = normalised.split('\n\n')
        .filter(p => p.trim())
        .map(p => `<p>${p.split('\n').map(l => escapeHtml(l)).join('<br>')}</p>`)
        .join('');
    editor.commands.setContent(html || '<p></p>');
    _contentBeforePreview = null;
    _insertionLineIndex = -1;
    _replacementPreview = null;
    console.log('[DIFF] Markup discarded (restored from snapshot)');
    return true;
}

/**
 * True when the editor is currently showing a diff preview (snapshot exists).
 */
export function isDiffPreviewActive() {
    return _contentBeforePreview !== null;
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
