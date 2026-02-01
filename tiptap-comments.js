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

    console.log(`[TIPTAP] Attaching event listeners to editor DOM:`, editorElement);
    console.log(`[TIPTAP] Editor DOM tag:`, editorElement.tagName, `contenteditable:`, editorElement.contentEditable);

    // Log ALL beforeinput events to see what's happening
    editorElement.addEventListener('beforeinput', (event) => {
      console.log('[TIPTAP BEFOREINPUT] <<<', {
        inputType: event.inputType,
        data: event.data,
        target: event.target.tagName
      });

      // Prevent any list-related formatting or deletions
      if (event.inputType === 'insertOrderedList' ||
          event.inputType === 'insertUnorderedList' ||
          event.inputType === 'formatSetBlockTextDirection' ||
          event.inputType === 'insertReplacementText' ||
          event.inputType === 'deleteContentBackward' ||
          event.inputType === 'deleteContentForward' ||
          event.inputType === 'deleteByCut' ||
          event.inputType.includes('formatSet') ||
          event.inputType.includes('formatRemove') ||
          event.inputType.includes('formatApply')) {
        console.log('[TIPTAP] ⛔ ⛔ ⛔ BLOCKING:', event.inputType);
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        return false;
      }
    }, true); // Use capture phase

    // Also log ALL input events
    editorElement.addEventListener('input', (event) => {
      console.log('[TIPTAP INPUT] >>>', {
        inputType: event.inputType,
        data: event.data
      });
    }, true);

    console.log(`[TIPTAP] Event listeners attached successfully for: ${elementId}`);
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