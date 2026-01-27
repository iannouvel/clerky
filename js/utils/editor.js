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
