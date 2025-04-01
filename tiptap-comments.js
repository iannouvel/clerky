// Import TipTap modules
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';

// Store editor instances
const editors = {};

// Initialize TipTap editors when document is ready
document.addEventListener('DOMContentLoaded', () => {
  console.log('Initializing TipTap editors with ES modules...');
  initTipTapEditors();
});

function initTipTapEditors() {
  // Initialize the summary editor
  editors.summary = initEditor('summary', 'Type or paste transcript here...');
  
  // Initialize the clinical note editor
  editors.clinicalNote = initEditor('clinicalNoteOutput', 'Clinical note will appear here...');
}

function initEditor(elementId, placeholder) {
  const element = document.getElementById(elementId);
  
  if (!element) {
    console.warn(`Element with id ${elementId} not found.`);
    return null;
  }
  
  // Create editor instance
  try {
    console.log(`Creating editor for element: ${elementId}`);
    const editor = new Editor({
      element,
      extensions: [
        StarterKit,
        Placeholder.configure({
          placeholder
        })
      ],
      content: '',
      autofocus: false,
      editable: true
    });
    
    console.log(`Editor created successfully for: ${elementId}`);
    return editor;
  } catch (error) {
    console.error('Error initializing TipTap editor:', error);
    return null;
  }
}

// Helper to get editor content
export function getEditorContent(editorId) {
  const editor = editors[editorId === 'clinicalNoteOutput' ? 'clinicalNote' : editorId];
  return editor ? editor.getHTML() : '';
}

// Helper to set editor content
export function setEditorContent(editorId, content) {
  const editor = editors[editorId === 'clinicalNoteOutput' ? 'clinicalNote' : editorId];
  if (editor) {
    editor.commands.setContent(content);
  }
} 