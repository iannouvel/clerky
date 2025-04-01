// Import TipTap modules directly from CDN
import { Editor, Extension, Mark } from 'https://esm.sh/@tiptap/core@2.2.0';
import StarterKit from 'https://esm.sh/@tiptap/starter-kit@2.2.0';
import Placeholder from 'https://esm.sh/@tiptap/extension-placeholder@2.2.0';

// Define a custom mark for tracked changes
const TrackChange = Mark.create({
  name: 'trackChange',
  
  addOptions() {
    return {
      HTMLAttributes: {
        class: 'track-change',
      },
    }
  },
  
  parseHTML() {
    return [
      {
        tag: 'span.track-change',
      },
    ]
  },
  
  renderHTML({ HTMLAttributes }) {
    return ['span', { class: 'track-change', ...HTMLAttributes }, 0]
  },
  
  addCommands() {
    return {
      setTrackChange: attributes => ({ commands }) => {
        return commands.setMark(this.name, attributes)
      },
      toggleTrackChange: attributes => ({ commands }) => {
        return commands.toggleMark(this.name, attributes)
      },
      unsetTrackChange: () => ({ commands }) => {
        return commands.unsetMark(this.name)
      },
    }
  },
})

// Function to create and append a button to a toolbar
function createToolbarButton(toolbar, icon, title, action) {
  const button = document.createElement('button');
  button.type = 'button';
  button.innerHTML = icon;
  button.title = title;
  button.addEventListener('click', action);
  toolbar.appendChild(button);
  return button;
}

// Function to create and initialize the editor toolbar
function createEditorToolbar(editor, container) {
  if (!editor || !container) return null;
  
  // Create toolbar container
  const toolbar = document.createElement('div');
  toolbar.className = 'tiptap-toolbar';
  
  // Bold
  const boldButton = createToolbarButton(
    toolbar,
    '<i class="fas fa-bold"></i>',
    'Bold',
    () => editor.chain().focus().toggleBold().run()
  );
  
  // Italic
  const italicButton = createToolbarButton(
    toolbar,
    '<i class="fas fa-italic"></i>',
    'Italic',
    () => editor.chain().focus().toggleItalic().run()
  );
  
  // Heading 1
  const h1Button = createToolbarButton(
    toolbar,
    '<i class="fas fa-heading"></i><sup>1</sup>',
    'Heading 1',
    () => editor.chain().focus().toggleHeading({ level: 1 }).run()
  );
  
  // Heading 2
  const h2Button = createToolbarButton(
    toolbar,
    '<i class="fas fa-heading"></i><sup>2</sup>',
    'Heading 2',
    () => editor.chain().focus().toggleHeading({ level: 2 }).run()
  );
  
  // Bullet List
  const bulletListButton = createToolbarButton(
    toolbar,
    '<i class="fas fa-list-ul"></i>',
    'Bullet List',
    () => editor.chain().focus().toggleBulletList().run()
  );
  
  // Numbered List
  const numberedListButton = createToolbarButton(
    toolbar,
    '<i class="fas fa-list-ol"></i>',
    'Numbered List',
    () => editor.chain().focus().toggleOrderedList().run()
  );
  
  // Update toolbar button states
  editor.on('selectionUpdate', () => {
    boldButton.classList.toggle('is-active', editor.isActive('bold'));
    italicButton.classList.toggle('is-active', editor.isActive('italic'));
    h1Button.classList.toggle('is-active', editor.isActive('heading', { level: 1 }));
    h2Button.classList.toggle('is-active', editor.isActive('heading', { level: 2 }));
    bulletListButton.classList.toggle('is-active', editor.isActive('bulletList'));
    numberedListButton.classList.toggle('is-active', editor.isActive('orderedList'));
  });
  
  // Insert the toolbar before the editor element
  container.parentNode.insertBefore(toolbar, container);
  
  return toolbar;
}

// Function to initialize TipTap editor on a specific element
export function initializeTipTap(element, placeholder = 'Start typing...') {
  if (!element) {
    console.error('Element not found for TipTap initialization');
    return null;
  }
  
  try {
    const editor = new Editor({
      element,
      extensions: [
        StarterKit,
        Placeholder.configure({
          placeholder,
        }),
        TrackChange,
      ],
      content: element.innerHTML || '',
      onUpdate: ({ editor }) => {
        // Dispatch a custom event that we can listen for
        const event = new CustomEvent('tiptap-update', { 
          detail: { 
            html: editor.getHTML(),
            text: editor.getText() 
          } 
        });
        element.dispatchEvent(event);
      },
    });

    // Create toolbar
    createEditorToolbar(editor, element);
    
    return editor;
  } catch (error) {
    console.error('Error initializing TipTap:', error);
    return null;
  }
}

// Helper function to get content from editor
export function getEditorContent(editor, format = 'html') {
  if (!editor) return '';
  
  return format === 'html' ? editor.getHTML() : editor.getText();
}

// Helper function to set content in editor
export function setEditorContent(editor, content, format = 'html') {
  if (!editor) return;
  
  if (format === 'html') {
    editor.commands.setContent(content);
  } else {
    editor.commands.setContent(content);
  }
}

// Function to apply track changes to the editor content based on the suggestions
export function applyTrackChanges(editor, originalText, suggestedText) {
  if (!editor) return;
  
  // Store original content
  const originalContent = editor.getHTML();
  
  // First, set the suggested content
  editor.commands.setContent(suggestedText);
  
  // We'd ideally perform a diff here, but for simplicity, we'll just mark the entire content
  // as a track change. In a real implementation, you'd want to use a diffing algorithm
  // to only mark the changed parts.
  editor.commands.selectAll();
  editor.commands.setTrackChange();
  
  return originalContent; // Return the original content so it can be restored if needed
}

// Function to accept all track changes
export function acceptAllTrackChanges(editor) {
  if (!editor) return;
  
  // Simply remove the track-change mark from the entire document
  editor.commands.unsetTrackChange();
}

// Function to reject all track changes
export function rejectAllTrackChanges(editor, originalContent) {
  if (!editor) return;
  
  // Restore the original content
  editor.commands.setContent(originalContent);
} 