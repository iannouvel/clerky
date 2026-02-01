// Import TipTap modules from CDN
import { Editor } from 'https://esm.sh/@tiptap/core@2.1.13';
import StarterKit from 'https://esm.sh/@tiptap/starter-kit@2.1.13';
import Placeholder from 'https://esm.sh/@tiptap/extension-placeholder@2.1.13';
import TextStyle from 'https://esm.sh/@tiptap/extension-text-style@2.1.13';
import Color from 'https://esm.sh/@tiptap/extension-color@2.1.13';

// Store editor instances
const editors = {};

// Make editors globally accessible
window.editors = editors;

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
  
  // Initialize the user input editor (Clinical Note field)
  editors.userInput = initEditor('userInput', 'Record a transcript, enter a clinical note or ask a question here...');
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
        StarterKit.configure({
          // Disable auto-list creation to allow manual numbered lists
          orderedList: false,
          bulletList: false,
          listItem: false
        }),
        TextStyle,
        Color,
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