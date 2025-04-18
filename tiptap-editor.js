// Import TipTap modules directly from CDN
import { Editor, Extension, Mark } from 'https://esm.sh/@tiptap/core@2.2.0';
import StarterKit from 'https://esm.sh/@tiptap/starter-kit@2.2.0';
import Placeholder from 'https://esm.sh/@tiptap/extension-placeholder@2.2.0';
// Import diff-match-patch for better change detection
import * as diffMatchPatch from 'https://esm.sh/diff-match-patch@1.0.5';

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
  
  addAttributes() {
    return {
      id: {
        default: null,
        parseHTML: element => element.getAttribute('data-change-id'),
        renderHTML: attributes => {
          if (!attributes.id) {
            return {}
          }
          return {
            'data-change-id': attributes.id,
          }
        },
      },
      type: {
        default: 'addition',
        parseHTML: element => element.getAttribute('data-change-type'),
        renderHTML: attributes => {
          if (!attributes.type) {
            return {}
          }
          return {
            'data-change-type': attributes.type,
            class: `track-change track-change-${attributes.type}`,
          }
        },
      }
    }
  },
  
  parseHTML() {
    return [
      {
        tag: 'span[data-change-id]',
        getAttrs: element => {
          return { 
            id: element.getAttribute('data-change-id'),
            type: element.getAttribute('data-change-type') || 'addition'
          }
        }
      },
      {
        tag: 'span.track-change',
      },
    ]
  },
  
  renderHTML({ HTMLAttributes }) {
    return ['span', { 
      class: `track-change track-change-${HTMLAttributes.type || 'addition'}`, 
      'data-change-id': HTMLAttributes.id,
      'data-change-type': HTMLAttributes.type || 'addition',
      ...HTMLAttributes 
    }, 0]
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
      acceptChange: id => ({ state, dispatch }) => {
        // Find marks with the specific ID and remove them, keeping the content
        if (dispatch) {
          const { tr } = state
          state.doc.descendants((node, pos) => {
            if (node.marks.length) {
              node.marks.forEach(mark => {
                if (mark.type.name === this.name && mark.attrs.id === id) {
                  tr.removeMark(pos, pos + node.nodeSize, mark.type)
                }
              })
            }
          })
          return dispatch(tr)
        }
        return true
      },
      rejectChange: id => ({ state, dispatch }) => {
        // If it's a deletion, we remove the mark and the content
        // If it's an addition, we remove the content and the mark
        if (dispatch) {
          const { tr } = state
          const positions = []
          
          state.doc.descendants((node, pos) => {
            if (node.marks.length) {
              node.marks.forEach(mark => {
                if (mark.type.name === this.name && mark.attrs.id === id) {
                  if (mark.attrs.type === 'addition') {
                    positions.push({ from: pos, to: pos + node.nodeSize })
                  } else {
                    tr.removeMark(pos, pos + node.nodeSize, mark.type)
                  }
                }
              })
            }
          })
          
          // Delete additions (we do this in reverse order to avoid position shifts)
          positions.sort((a, b) => b.from - a.from)
          positions.forEach(({ from, to }) => {
            tr.delete(from, to)
          })
          
          return dispatch(tr)
        }
        return true
      }
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
  if (!editor) return null;
  
  // Store original content
  const originalContent = editor.getHTML();
  
  try {
    // First set the suggested text as the editor content
    editor.commands.setContent(suggestedText);
    
    // Storage for all changes to be applied
    const changes = [];
    let changeCounter = 0;
    
    // First, try to identify italicized text (<i> tags) which indicate changes from crossCheck
    const italicRegex = /<i>(.*?)<\/i>/g;
    let match;
    let italicizedChanges = [];
    
    // Make a copy of the suggested text for regex processing
    let textForProcessing = suggestedText;
    
    // Find all italicized text
    while ((match = italicRegex.exec(textForProcessing)) !== null) {
      italicizedChanges.push({
        text: match[1],
        index: match.index,
        length: match[0].length
      });
    }
    
    console.log('Found italicized changes:', italicizedChanges);
    
    // If we found italicized changes, process them
    if (italicizedChanges.length > 0) {
      // Process the current editor state to find the positions of the italicized text
      let editorText = editor.getText();
      let htmlContent = editor.getHTML();
      
      italicizedChanges.forEach(change => {
        // Try to find this text without HTML tags in the editor content
        const textToFind = change.text.replace(/<[^>]*>/g, '');
        const position = editorText.indexOf(textToFind);
        
        if (position !== -1) {
          const changeId = `change-${changeCounter++}`;
          
          changes.push({
            id: changeId,
            type: 'addition',
            text: textToFind,
            from: editor.state.doc.resolve(position).pos,
            to: editor.state.doc.resolve(position + textToFind.length).pos
          });
        }
      });
      
      // If we found positions for the changes, mark them for track changes
      if (changes.length > 0) {
        changes.forEach(change => {
          // For content additions, mark the added content
          editor.commands.setTextSelection({
            from: change.from,
            to: change.to
          });
          editor.commands.setTrackChange({
            id: change.id,
            type: change.type
          });
        });
        
        return {
          originalContent,
          changes
        };
      }
    }
    
    // If no italicized changes were found or processed, fall back to diff-based approach
    // Create a new instance of DiffMatchPatch
    const dmp = new diffMatchPatch.diff_match_patch();
    
    // Calculate differences using diff-match-patch
    const diffs = dmp.diff_main(
      originalText.replace(/<[^>]*>/g, ''), // Strip HTML for better text comparison
      suggestedText.replace(/<[^>]*>/g, '')
    );
    
    // Cleanup semantic differences - combine nearby edits
    dmp.diff_cleanupSemantic(diffs);
    
    // Reset changes array and counter for diff-based approach
    const diffChanges = [];
    changeCounter = 0;
    
    // Process the diffs
    diffs.forEach((diff, index) => {
      const [operation, text] = diff;
      
      if (text.trim().length === 0) return; // Skip empty changes
      
      // operation: -1 for deletion, 0 for unchanged, 1 for insertion
      if (operation !== 0) {
        const type = operation === 1 ? 'addition' : 'deletion';
        const changeId = `change-${changeCounter++}`;
        
        // Try to find this text in the editor content
        const editorText = editor.getText();
        let startPos = -1;
        
        if (operation === 1) { // Addition
          startPos = editorText.indexOf(text);
          if (startPos !== -1) {
            diffChanges.push({
              id: changeId,
              type,
              text: text,
              from: editor.state.doc.resolve(startPos).pos,
              to: editor.state.doc.resolve(startPos + text.length).pos
            });
          }
        } else if (operation === -1) { // Deletion
          // For deletions, we might need special handling
          // This is simplified - in a real implementation you'd need more sophisticated
          // handling of deletions with context
          const prevDiff = index > 0 ? diffs[index - 1] : null;
          const nextDiff = index < diffs.length - 1 ? diffs[index + 1] : null;
          
          // Use context from surrounding unchanged text
          let context = '';
          if (prevDiff && prevDiff[0] === 0) {
            context += prevDiff[1].slice(-20); // Last 20 chars of prev context
          }
          if (nextDiff && nextDiff[0] === 0) {
            context += nextDiff[1].slice(0, 20); // First 20 chars of next context
          }
          
          // Find position based on context
          if (context) {
            startPos = editorText.indexOf(context);
            if (startPos !== -1) {
              // This would add a deleted element at the context position
              // In a real implementation, you'd need to calculate the exact position
              const pos = editor.state.doc.resolve(startPos).pos;
              
              // Insert deleted content with markup
              const deleteNode = document.createElement('span');
              deleteNode.classList.add('track-change', 'track-change-deletion');
              deleteNode.setAttribute('data-change-id', changeId);
              deleteNode.setAttribute('data-change-type', 'deletion');
              deleteNode.textContent = text;
              
              // This would be a more complex operation in a real implementation
              // Simplified here by just adding a comment
              diffChanges.push({
                id: changeId,
                type: 'deletion-comment',
                text: `[Deleted: ${text}]`
              });
            }
          }
        }
      }
    });
    
    // Apply all the changes
    diffChanges.forEach(change => {
      if (change.type === 'addition' || change.type === 'modification') {
        // For content additions, mark the added content
        editor.commands.setTextSelection({
          from: change.from,
          to: change.to
        });
        editor.commands.setTrackChange({
          id: change.id,
          type: change.type
        });
      } else if (change.type === 'deletion-comment') {
        // For deletions, we could insert a comment or special marker
        // This would be handled differently in a real implementation
        console.log(`Deletion: ${change.text} (ID: ${change.id})`);
      }
    });
    
    return {
      originalContent,
      changes: diffChanges.length > 0 ? diffChanges : changes
    };
  } catch (error) {
    console.error('Error applying track changes:', error);
    
    // Fallback to simpler method if diff fails
    editor.commands.setContent(suggestedText);
    editor.commands.selectAll();
    editor.commands.setTrackChange({
      id: 'change-all',
      type: 'modification'
    });
    
    return {
      originalContent,
      changes: [{
        id: 'change-all',
        type: 'modification',
        from: 0,
        to: suggestedText.length
      }]
    };
  }
}

// Function to accept all track changes
export function acceptAllTrackChanges(editor) {
  if (!editor) return;
  
  // Find all track change marks and remove them, keeping the content
  const tr = editor.state.tr;
  editor.state.doc.descendants((node, pos) => {
    if (node.marks.length) {
      node.marks.forEach(mark => {
        if (mark.type.name === 'trackChange') {
          tr.removeMark(pos, pos + node.nodeSize, mark.type);
        }
      });
    }
  });
  
  editor.view.dispatch(tr);
}

// Function to reject all track changes
export function rejectAllTrackChanges(editor, originalContent) {
  if (!editor) return;
  
  // The simplest way is to just restore the original content
  editor.commands.setContent(originalContent);
}

// Function to accept a specific change
export function acceptChange(editor, changeId) {
  if (!editor) return;
  
  editor.commands.acceptChange(changeId);
}

// Function to reject a specific change
export function rejectChange(editor, changeId) {
  if (!editor) return;
  
  editor.commands.rejectChange(changeId);
}

// Function to get all changes in the editor
export function getTrackChanges(editor) {
  if (!editor) return [];
  
  const changes = [];
  const changeIds = new Set();
  
  editor.state.doc.descendants((node, pos) => {
    if (node.marks.length) {
      node.marks.forEach(mark => {
        if (mark.type.name === 'trackChange' && mark.attrs.id && !changeIds.has(mark.attrs.id)) {
          changeIds.add(mark.attrs.id);
          changes.push({
            id: mark.attrs.id,
            type: mark.attrs.type,
            text: node.text,
            from: pos,
            to: pos + node.nodeSize
          });
        }
      });
    }
  });
  
  return changes;
} 