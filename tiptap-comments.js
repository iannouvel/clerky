// Import TipTap modules from CDN
import { Editor } from 'https://esm.sh/@tiptap/core@2.1.13';
import Document from 'https://esm.sh/@tiptap/extension-document@2.1.13';
import Paragraph from 'https://esm.sh/@tiptap/extension-paragraph@2.1.13';
import Text from 'https://esm.sh/@tiptap/extension-text@2.1.13';
import Bold from 'https://esm.sh/@tiptap/extension-bold@2.1.13';
import Italic from 'https://esm.sh/@tiptap/extension-italic@2.1.13';
import History from 'https://esm.sh/@tiptap/extension-history@2.1.13';
import HardBreak from 'https://esm.sh/@tiptap/extension-hard-break@2.1.13';
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
        // Absolute minimum - only what's required for editor to work
        Document,
        Paragraph,
        Text,
        // History for undo/redo
        History,
        // Styling extensions (no inputRules)
        TextStyle,
        Color,
        // Placeholder
        Placeholder.configure({
          placeholder
        })
      ],
      content: '',
      autofocus: false,
      editable: true,
      enableInputRules: false,
      enablePasteRules: false,
      editorProps: {
        attributes: {
          // Disable browser autocorrect/autocomplete
          spellcheck: 'true',
          autocorrect: 'off',
          autocomplete: 'off',
          autocapitalize: 'off'
        }
      }
    });

    // Add keyboard event listener to prevent browser auto-formatting
    const editorElement = editor.view.dom;

    // Log all beforeinput events to debug what's happening
    editorElement.addEventListener('beforeinput', (event) => {
      // Log the event for debugging
      if (event.data === ' ' || event.inputType.includes('delete') || event.inputType.includes('format')) {
        console.log('[TIPTAP BEFOREINPUT]', {
          inputType: event.inputType,
          data: event.data,
          dataTransfer: event.dataTransfer
        });
      }

      // Prevent any list-related formatting
      if (event.inputType === 'insertOrderedList' ||
          event.inputType === 'insertUnorderedList' ||
          event.inputType === 'formatSetBlockTextDirection' ||
          event.inputType === 'insertReplacementText' ||
          event.inputType.includes('formatSet') ||
          event.inputType.includes('formatRemove')) {
        console.log('[TIPTAP] ⛔ BLOCKING auto-formatting:', event.inputType);
        event.preventDefault();
        event.stopPropagation();
        return false;
      }
    }, true); // Use capture phase

    // Also log input events to see what actually happened
    editorElement.addEventListener('input', (event) => {
      if (event.inputType.includes('delete') || event.inputType.includes('format') || event.inputType.includes('insert')) {
        console.log('[TIPTAP INPUT]', {
          inputType: event.inputType,
          data: event.data
        });
      }
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