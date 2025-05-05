// tiptap-editor.js - Fallback implementations and helpers

// Store active editors
const editors = {};

// Initialize TipTap editor function - falls back to window.initializeTipTap if available
export function initializeTipTap(element, placeholder) {
    // If window.initializeTipTap exists, use it
    if (window.initializeTipTap) {
        const editor = window.initializeTipTap(element, placeholder);
        if (editor) {
            editors[element.id] = editor;
            return editor;
        }
    }

    // Create a fallback textarea editor
    console.warn(`Using fallback editor for ${element.id}`);
    const textarea = document.createElement('textarea');
    textarea.className = 'fallback-editor';
    // Use placeholder from the element attribute or from the parameter
    const placeholderText = element.getAttribute('placeholder') || placeholder || 'Start typing...';
    textarea.placeholder = placeholderText;
    textarea.value = element.innerHTML || '';
    
    // Clear element and append textarea
    element.innerHTML = '';
    element.appendChild(textarea);
    
    // Create simple editor interface object
    const fallbackEditor = {
        element: element,
        textarea: textarea,
        getHTML: () => textarea.value,
        getText: () => textarea.value,
        commands: {
            setContent: (content) => {
                textarea.value = content;
            }
        }
    };
    
    // Add change listener
    textarea.addEventListener('input', () => {
        const event = new CustomEvent('tiptap-update', {
            detail: {
                html: textarea.value,
                text: textarea.value
            }
        });
        element.dispatchEvent(event);
    });
    
    // Store in editors object
    editors[element.id] = fallbackEditor;
    
    return fallbackEditor;
}

// Get editor content
export function getEditorContent(editor, format = 'html') {
    if (!editor) {
        return '';
    }
    
    // Check if it's our fallback editor
    if (editor.textarea) {
        return editor.textarea.value;
    }
    
    // Otherwise use standard TipTap methods
    return format === 'html' ? editor.getHTML() : editor.getText();
}

// Set editor content
export function setEditorContent(editor, content) {
    if (!editor) {
        return;
    }
    
    // Check if it's our fallback editor
    if (editor.textarea) {
        editor.textarea.value = content;
        return;
    }
    
    // Otherwise use standard TipTap methods
    editor.commands.setContent(content);
}

// Track changes implementation (simplified version that just replaces content)
export function applyTrackChanges(editor, originalContent, newContent) {
    setEditorContent(editor, newContent);
    return {
        changes: [{
            id: 'change-1',
            type: 'replace',
            text: 'Content updated'
        }]
    };
}

// Accept all changes
export function acceptAllTrackChanges(editor) {
    // In our simplified version, we already have the new content
    return true;
}

// Reject all changes
export function rejectAllTrackChanges(editor, originalContent) {
    setEditorContent(editor, originalContent);
    return true;
}

// Accept a specific change
export function acceptChange(editor, changeId) {
    // In our simplified version, just keep the current content
    return true;
}

// Reject a specific change
export function rejectChange(editor, changeId) {
    // In our simplified version, this would require more complex tracking
    return true;
}

// Get track changes
export function getTrackChanges(editor) {
    // Return a placeholder change
    return [{
        id: 'change-1',
        type: 'replace',
        text: 'Content updated'
    }];
}

// Make functions available on the window object as well
window.initializeTipTap = initializeTipTap;
window.getEditorContent = getEditorContent;
window.setEditorContent = setEditorContent;
window.applyTrackChanges = applyTrackChanges;
window.acceptAllTrackChanges = acceptAllTrackChanges;
window.rejectAllTrackChanges = rejectAllTrackChanges;
window.acceptChange = acceptChange;
window.rejectChange = rejectChange;
window.getTrackChanges = getTrackChanges; 