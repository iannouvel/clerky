/**
 * Comments management for TipTap editor
 * This class provides functionality to add, edit, resolve, and delete comments
 * in a TipTap rich text editor instance.
 */
class Comments {
    constructor() {
        this.comments = [];
        this.nextId = 1;
        this.listeners = [];
        this.currentUser = {
            name: 'Anonymous User',
            id: 'user-' + Math.random().toString(36).substr(2, 9)
        };
    }

    /**
     * Add a new comment
     * @param {Object} comment Comment object with text, range information
     * @returns {Object} The created comment
     */
    addComment(comment) {
        const timestamp = new Date().toISOString();
        const newComment = {
            id: this.nextId++,
            text: comment.text,
            range: comment.range,
            createdBy: this.currentUser,
            createdAt: timestamp,
            updatedAt: timestamp,
            resolved: false,
            replies: []
        };
        this.comments.push(newComment);
        this.notifyListeners();
        return newComment;
    }

    /**
     * Edit an existing comment
     * @param {number} id Comment ID
     * @param {string} text New comment text
     * @returns {Object|null} Updated comment or null if not found
     */
    editComment(id, text) {
        const comment = this.comments.find(c => c.id === id);
        if (!comment) return null;
        
        comment.text = text;
        comment.updatedAt = new Date().toISOString();
        this.notifyListeners();
        return comment;
    }

    /**
     * Resolve or unresolve a comment
     * @param {number} id Comment ID
     * @param {boolean} resolved Resolved status
     * @returns {Object|null} Updated comment or null if not found
     */
    resolveComment(id, resolved = true) {
        const comment = this.comments.find(c => c.id === id);
        if (!comment) return null;

        comment.resolved = resolved;
        comment.updatedAt = new Date().toISOString();
        this.notifyListeners();
        return comment;
    }

    /**
     * Delete a comment
     * @param {number} id Comment ID
     * @returns {boolean} True if comment was deleted
     */
    deleteComment(id) {
        const initialLength = this.comments.length;
        this.comments = this.comments.filter(c => c.id !== id);
        const deleted = initialLength > this.comments.length;
        if (deleted) {
            this.notifyListeners();
        }
        return deleted;
    }

    /**
     * Get all comments
     * @returns {Array} All comments
     */
    getComments() {
        return [...this.comments];
    }

    /**
     * Get a specific comment by ID
     * @param {number} id Comment ID
     * @returns {Object|null} Comment or null if not found
     */
    getComment(id) {
        return this.comments.find(c => c.id === id) || null;
    }

    /**
     * Add a reply to a comment
     * @param {number} commentId Comment ID
     * @param {string} text Reply text
     * @returns {Object|null} Updated comment or null if not found
     */
    addReply(commentId, text) {
        const comment = this.comments.find(c => c.id === commentId);
        if (!comment) return null;

        const reply = {
            id: Math.random().toString(36).substr(2, 9),
            text,
            createdBy: this.currentUser,
            createdAt: new Date().toISOString()
        };

        comment.replies.push(reply);
        comment.updatedAt = reply.createdAt;
        this.notifyListeners();
        return comment;
    }

    /**
     * Add a listener for comment changes
     * @param {Function} listener Callback function
     */
    addListener(listener) {
        if (typeof listener === 'function') {
            this.listeners.push(listener);
        }
    }

    /**
     * Remove a listener
     * @param {Function} listener Callback function to remove
     */
    removeListener(listener) {
        this.listeners = this.listeners.filter(l => l !== listener);
    }

    /**
     * Notify all listeners of changes
     */
    notifyListeners() {
        this.listeners.forEach(listener => {
            try {
                listener(this.comments);
            } catch (error) {
                console.error('Error in comment listener:', error);
            }
        });
    }

    /**
     * Set the current user
     * @param {Object} user User object with name and id
     */
    setCurrentUser(user) {
        if (user && user.name) {
            this.currentUser = {
                name: user.name,
                id: user.id || ('user-' + Math.random().toString(36).substr(2, 9))
            };
        }
    }
}

// Expose globally
window.Comments = Comments;

/**
 * Create the UI for comments and integrate with the editor
 * @param {Object} editor TipTap editor instance
 * @param {Comments} commentsManager Comments manager instance
 * @returns {Object} UI control functions
 */
function createCommentUI(editor, commentsManager) {
    if (!commentsManager) {
        commentsManager = new Comments();
    }

    // Create container for comments UI
    const container = document.createElement('div');
    container.className = 'tiptap-comments-container';

    // Create header
    const header = document.createElement('div');
    header.className = 'tiptap-comments-header';
    header.innerHTML = '<h3>Comments</h3>';

    // Create list for comments
    const commentsList = document.createElement('div');
    commentsList.className = 'tiptap-comments-list';

    // Create form for adding comments
    const commentForm = document.createElement('form');
    commentForm.className = 'tiptap-comment-form';
    commentForm.style.display = 'none';
    commentForm.innerHTML = `
        <textarea placeholder="Add a comment..."></textarea>
        <div class="tiptap-comment-form-actions">
            <button type="button" class="cancel-btn">Cancel</button>
            <button type="submit" class="submit-btn">Comment</button>
        </div>
    `;

    // Assemble the container
    container.appendChild(header);
    container.appendChild(commentsList);
    container.appendChild(commentForm);

    // Position the container next to the editor
    const editorContainer = editor.options.element.parentElement;
    editorContainer.style.position = 'relative';
    editorContainer.appendChild(container);

    // Update the comments list
    const updateCommentsList = () => {
        const comments = commentsManager.getComments();
        commentsList.innerHTML = '';

        if (comments.length === 0) {
            commentsList.innerHTML = '<p class="no-comments">No comments yet</p>';
            return;
        }

        comments.forEach(comment => {
            const commentEl = document.createElement('div');
            commentEl.className = 'tiptap-comment';
            if (comment.resolved) {
                commentEl.classList.add('resolved');
            }

            const commentHeader = document.createElement('div');
            commentHeader.className = 'tiptap-comment-header';
            
            const commentAuthor = document.createElement('span');
            commentAuthor.className = 'comment-author';
            commentAuthor.textContent = comment.createdBy.name;
            
            const commentDate = document.createElement('span');
            commentDate.className = 'comment-date';
            commentDate.textContent = new Date(comment.createdAt).toLocaleString();
            
            commentHeader.appendChild(commentAuthor);
            commentHeader.appendChild(commentDate);

            const commentText = document.createElement('div');
            commentText.className = 'comment-text';
            commentText.textContent = comment.text;

            const commentActions = document.createElement('div');
            commentActions.className = 'comment-actions';

            const resolveBtn = document.createElement('button');
            resolveBtn.textContent = comment.resolved ? 'Unresolve' : 'Resolve';
            resolveBtn.onclick = () => {
                commentsManager.resolveComment(comment.id, !comment.resolved);
                updateCommentsList();
                highlightCommentedText();
            };

            const editBtn = document.createElement('button');
            editBtn.textContent = 'Edit';
            editBtn.onclick = () => {
                const newText = prompt('Edit comment', comment.text);
                if (newText !== null) {
                    commentsManager.editComment(comment.id, newText);
                    updateCommentsList();
                }
            };

            const deleteBtn = document.createElement('button');
            deleteBtn.textContent = 'Delete';
            deleteBtn.onclick = () => {
                if (confirm('Are you sure you want to delete this comment?')) {
                    commentsManager.deleteComment(comment.id);
                    updateCommentsList();
                    highlightCommentedText();
                }
            };

            commentActions.appendChild(resolveBtn);
            commentActions.appendChild(editBtn);
            commentActions.appendChild(deleteBtn);

            commentEl.appendChild(commentHeader);
            commentEl.appendChild(commentText);
            commentEl.appendChild(commentActions);

            // Add replies if any
            if (comment.replies && comment.replies.length > 0) {
                const repliesContainer = document.createElement('div');
                repliesContainer.className = 'comment-replies';
                
                comment.replies.forEach(reply => {
                    const replyEl = document.createElement('div');
                    replyEl.className = 'comment-reply';
                    
                    const replyHeader = document.createElement('div');
                    replyHeader.className = 'reply-header';
                    replyHeader.innerHTML = `<span class="reply-author">${reply.createdBy.name}</span> <span class="reply-date">${new Date(reply.createdAt).toLocaleString()}</span>`;
                    
                    const replyText = document.createElement('div');
                    replyText.className = 'reply-text';
                    replyText.textContent = reply.text;
                    
                    replyEl.appendChild(replyHeader);
                    replyEl.appendChild(replyText);
                    repliesContainer.appendChild(replyEl);
                });
                
                commentEl.appendChild(repliesContainer);
            }

            // Add reply form
            const replyForm = document.createElement('form');
            replyForm.className = 'reply-form';
            replyForm.innerHTML = `
                <input type="text" placeholder="Reply to this comment..." />
                <button type="submit">Reply</button>
            `;
            
            replyForm.onsubmit = (e) => {
                e.preventDefault();
                const input = replyForm.querySelector('input');
                const text = input.value.trim();
                
                if (text) {
                    commentsManager.addReply(comment.id, text);
                    updateCommentsList();
                    input.value = '';
                }
            };
            
            commentEl.appendChild(replyForm);
            commentsList.appendChild(commentEl);
        });
    };

    // Highlight commented text in the editor
    const highlightCommentedText = () => {
        // Clear existing highlights
        const content = editor.getHTML();
        const cleanContent = content.replace(/<mark class="comment-highlight"[^>]*>(.*?)<\/mark>/g, '$1');
        editor.commands.setContent(cleanContent);

        // Add new highlights for each comment
        const comments = commentsManager.getComments().filter(c => !c.resolved);
        
        if (comments.length === 0) return;
        
        // Implement highlighting logic here
        // This is a simplified version - a full implementation would need to handle
        // ranges and positions correctly based on the editor's content
        
        // For now, we'll just add a data attribute to the editor to show there are comments
        editor.options.element.setAttribute('data-has-comments', 'true');
    };

    // Show the comment form
    const showCommentForm = () => {
        const selection = editor.state.selection;
        if (selection.empty) {
            alert('Please select some text to comment on');
            return;
        }

        // Store the current selection
        const range = {
            from: selection.from,
            to: selection.to,
            text: editor.state.doc.textBetween(selection.from, selection.to)
        };

        commentForm.dataset.range = JSON.stringify(range);
        commentForm.style.display = 'block';
        commentForm.querySelector('textarea').focus();
    };

    // Initialize event listeners
    commentForm.onsubmit = (e) => {
        e.preventDefault();
        const textarea = commentForm.querySelector('textarea');
        const text = textarea.value.trim();
        
        if (!text) return;
        
        const range = JSON.parse(commentForm.dataset.range || '{}');
        if (!range.from || !range.to) return;
        
        commentsManager.addComment({
            text,
            range
        });
        
        textarea.value = '';
        commentForm.style.display = 'none';
        updateCommentsList();
        highlightCommentedText();
    };

    commentForm.querySelector('.cancel-btn').onclick = () => {
        commentForm.style.display = 'none';
        commentForm.querySelector('textarea').value = '';
    };

    // Listen for comment changes
    commentsManager.addListener(() => {
        updateCommentsList();
    });

    // Initial render
    updateCommentsList();

    // Return the UI control functions
    return {
        container,
        addComment: showCommentForm,
        updateComments: updateCommentsList,
        highlightComments: highlightCommentedText
    };
}

// Expose globally
window.createCommentUI = createCommentUI;

// Add CSS for comments
const commentsStyle = document.createElement('style');
commentsStyle.textContent = `
    .tiptap-comments-container {
        width: 250px;
        position: absolute;
        top: 0;
        right: -270px;
        background: #f8f9fa;
        border: 1px solid #e0e0e0;
        border-radius: 4px;
        max-height: 100%;
        overflow-y: auto;
    }

    .tiptap-comments-header {
        padding: 8px 12px;
        border-bottom: 1px solid #e0e0e0;
        background: #f0f0f0;
    }

    .tiptap-comments-header h3 {
        margin: 0;
        font-size: 16px;
        font-weight: 600;
    }

    .tiptap-comments-list {
        padding: 8px;
    }

    .tiptap-comment {
        margin-bottom: 12px;
        padding: 8px;
        background: white;
        border-radius: 4px;
        box-shadow: 0 1px 3px rgba(0,0,0,0.1);
    }

    .tiptap-comment.resolved {
        opacity: 0.6;
    }

    .tiptap-comment-header {
        display: flex;
        justify-content: space-between;
        margin-bottom: 4px;
        font-size: 12px;
    }

    .comment-author {
        font-weight: 600;
    }

    .comment-date {
        color: #666;
    }

    .comment-text {
        font-size: 14px;
        margin-bottom: 8px;
    }

    .comment-actions {
        display: flex;
        gap: 8px;
    }

    .comment-actions button {
        background: none;
        border: none;
        font-size: 12px;
        color: #0066cc;
        cursor: pointer;
        padding: 2px 4px;
    }

    .comment-actions button:hover {
        text-decoration: underline;
    }

    .tiptap-comment-form {
        padding: 8px;
        border-top: 1px solid #e0e0e0;
    }

    .tiptap-comment-form textarea {
        width: 100%;
        min-height: 80px;
        padding: 8px;
        border: 1px solid #ccc;
        border-radius: 4px;
        margin-bottom: 8px;
        font-family: inherit;
        resize: vertical;
    }

    .tiptap-comment-form-actions {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
    }

    .tiptap-comment-form-actions button {
        padding: 4px 8px;
        border-radius: 4px;
        cursor: pointer;
    }

    .cancel-btn {
        background: none;
        border: 1px solid #ccc;
    }

    .submit-btn {
        background: #0066cc;
        color: white;
        border: none;
    }

    .comment-highlight {
        background-color: rgba(255, 230, 0, 0.3);
        cursor: pointer;
    }

    .comment-replies {
        margin-top: 8px;
        padding-top: 8px;
        border-top: 1px solid #e0e0e0;
    }

    .comment-reply {
        padding: 4px 8px;
        margin-bottom: 4px;
        background: #f5f5f5;
        border-radius: 4px;
        font-size: 13px;
    }

    .reply-header {
        display: flex;
        justify-content: space-between;
        font-size: 11px;
        margin-bottom: 2px;
    }

    .reply-author {
        font-weight: 600;
    }

    .reply-date {
        color: #666;
    }

    .reply-form {
        display: flex;
        margin-top: 8px;
    }

    .reply-form input {
        flex: 1;
        padding: 4px 8px;
        border: 1px solid #ccc;
        border-radius: 4px;
        font-size: 12px;
    }

    .reply-form button {
        padding: 4px 8px;
        margin-left: 4px;
        background: #0066cc;
        color: white;
        border: none;
        border-radius: 4px;
        font-size: 12px;
        cursor: pointer;
    }

    .no-comments {
        color: #666;
        font-style: italic;
        text-align: center;
        padding: 16px 0;
    }
`;

document.head.appendChild(commentsStyle); 