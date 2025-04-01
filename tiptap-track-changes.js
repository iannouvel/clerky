/**
 * Track Changes management for TipTap editor
 * This class provides functionality to track, accept, and reject changes
 * in a TipTap rich text editor instance.
 */
class TrackChanges {
    constructor() {
        this.changes = [];
        this.nextId = 1;
        this.tracking = false;
        this.listeners = [];
        this.currentUser = {
            name: 'Anonymous User',
            id: 'user-' + Math.random().toString(36).substr(2, 9)
        };
    }

    /**
     * Start tracking changes
     */
    startTracking() {
        this.tracking = true;
        this.notifyListeners();
    }

    /**
     * Stop tracking changes
     */
    stopTracking() {
        this.tracking = false;
        this.notifyListeners();
    }

    /**
     * Toggle tracking state
     * @returns {boolean} New tracking state
     */
    toggleTracking() {
        this.tracking = !this.tracking;
        this.notifyListeners();
        return this.tracking;
    }

    /**
     * Check if tracking is active
     * @returns {boolean} Tracking state
     */
    isTracking() {
        return this.tracking;
    }

    /**
     * Record a text insertion
     * @param {Object} insertion Object with position and text information
     * @returns {Object} The recorded change
     */
    recordInsertion(insertion) {
        if (!this.tracking) return null;
        
        const change = {
            id: this.nextId++,
            type: 'insertion',
            position: insertion.position,
            text: insertion.text,
            createdBy: this.currentUser,
            createdAt: new Date().toISOString(),
            accepted: false,
            rejected: false
        };
        
        this.changes.push(change);
        this.notifyListeners();
        return change;
    }

    /**
     * Record a text deletion
     * @param {Object} deletion Object with position and text information
     * @returns {Object} The recorded change
     */
    recordDeletion(deletion) {
        if (!this.tracking) return null;
        
        const change = {
            id: this.nextId++,
            type: 'deletion',
            position: deletion.position,
            text: deletion.text,
            createdBy: this.currentUser,
            createdAt: new Date().toISOString(),
            accepted: false,
            rejected: false
        };
        
        this.changes.push(change);
        this.notifyListeners();
        return change;
    }

    /**
     * Accept a specific change
     * @param {number} id Change ID
     * @returns {Object|null} The accepted change or null if not found
     */
    acceptChange(id) {
        const change = this.changes.find(c => c.id === id);
        if (!change) return null;
        
        change.accepted = true;
        change.rejected = false;
        this.notifyListeners();
        return change;
    }

    /**
     * Reject a specific change
     * @param {number} id Change ID
     * @returns {Object|null} The rejected change or null if not found
     */
    rejectChange(id) {
        const change = this.changes.find(c => c.id === id);
        if (!change) return null;
        
        change.rejected = true;
        change.accepted = false;
        this.notifyListeners();
        return change;
    }

    /**
     * Accept all pending changes
     * @returns {number} Number of changes accepted
     */
    acceptAllChanges() {
        let count = 0;
        this.changes.forEach(change => {
            if (!change.accepted && !change.rejected) {
                change.accepted = true;
                change.rejected = false;
                count++;
            }
        });
        
        if (count > 0) {
            this.notifyListeners();
        }
        
        return count;
    }

    /**
     * Reject all pending changes
     * @returns {number} Number of changes rejected
     */
    rejectAllChanges() {
        let count = 0;
        this.changes.forEach(change => {
            if (!change.accepted && !change.rejected) {
                change.rejected = true;
                change.accepted = false;
                count++;
            }
        });
        
        if (count > 0) {
            this.notifyListeners();
        }
        
        return count;
    }

    /**
     * Get all changes
     * @returns {Array} All changes
     */
    getChanges() {
        return [...this.changes];
    }

    /**
     * Get pending changes (not accepted or rejected)
     * @returns {Array} Pending changes
     */
    getPendingChanges() {
        return this.changes.filter(c => !c.accepted && !c.rejected);
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

    /**
     * Add a listener for changes
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
                listener(this.changes, this.tracking);
            } catch (error) {
                console.error('Error in track changes listener:', error);
            }
        });
    }

    /**
     * Clear all changes
     */
    clearChanges() {
        this.changes = [];
        this.notifyListeners();
    }
}

// Expose globally
window.TrackChanges = TrackChanges;

/**
 * Create the UI for track changes and integrate with the editor
 * @param {Object} editor TipTap editor instance
 * @param {TrackChanges} trackChangesManager Track changes manager instance
 * @returns {Object} UI control functions
 */
function createTrackChangesUI(editor, trackChangesManager) {
    if (!trackChangesManager) {
        trackChangesManager = new TrackChanges();
    }

    // Create container for track changes UI
    const container = document.createElement('div');
    container.className = 'tiptap-track-changes-container';

    // Create header
    const header = document.createElement('div');
    header.className = 'tiptap-track-changes-header';
    header.innerHTML = '<h3>Track Changes</h3>';

    // Create toggle button
    const toggleBtn = document.createElement('button');
    toggleBtn.className = 'track-changes-toggle';
    toggleBtn.textContent = trackChangesManager.isTracking() ? 'Tracking: ON' : 'Tracking: OFF';
    toggleBtn.onclick = () => {
        const tracking = trackChangesManager.toggleTracking();
        toggleBtn.textContent = tracking ? 'Tracking: ON' : 'Tracking: OFF';
        toggleBtn.classList.toggle('active', tracking);
    };
    toggleBtn.classList.toggle('active', trackChangesManager.isTracking());

    // Create actions container
    const actionsContainer = document.createElement('div');
    actionsContainer.className = 'track-changes-actions';

    // Create accept all button
    const acceptAllBtn = document.createElement('button');
    acceptAllBtn.className = 'accept-all-btn';
    acceptAllBtn.textContent = 'Accept All';
    acceptAllBtn.onclick = () => {
        trackChangesManager.acceptAllChanges();
        updateChangesList();
    };

    // Create reject all button
    const rejectAllBtn = document.createElement('button');
    rejectAllBtn.className = 'reject-all-btn';
    rejectAllBtn.textContent = 'Reject All';
    rejectAllBtn.onclick = () => {
        trackChangesManager.rejectAllChanges();
        updateChangesList();
    };

    // Add buttons to actions container
    actionsContainer.appendChild(acceptAllBtn);
    actionsContainer.appendChild(rejectAllBtn);

    // Create list for changes
    const changesList = document.createElement('div');
    changesList.className = 'tiptap-changes-list';

    // Assemble the container
    container.appendChild(header);
    container.appendChild(toggleBtn);
    container.appendChild(actionsContainer);
    container.appendChild(changesList);

    // Position the container next to the editor
    const editorContainer = editor.options.element.parentElement;
    editorContainer.style.position = 'relative';
    
    // Position after comments container if it exists
    const commentsContainer = editorContainer.querySelector('.tiptap-comments-container');
    if (commentsContainer) {
        commentsContainer.after(container);
    } else {
        editorContainer.appendChild(container);
    }

    // Update the changes list
    const updateChangesList = () => {
        const changes = trackChangesManager.getChanges();
        changesList.innerHTML = '';

        if (changes.length === 0) {
            changesList.innerHTML = '<p class="no-changes">No changes tracked</p>';
            return;
        }

        // Group changes by type to display in sections
        const pendingChanges = changes.filter(c => !c.accepted && !c.rejected);
        const acceptedChanges = changes.filter(c => c.accepted);
        const rejectedChanges = changes.filter(c => c.rejected);

        // Create sections
        if (pendingChanges.length > 0) {
            const pendingSection = createChangesSection('Pending Changes', pendingChanges);
            changesList.appendChild(pendingSection);
        }

        if (acceptedChanges.length > 0) {
            const acceptedSection = createChangesSection('Accepted Changes', acceptedChanges);
            changesList.appendChild(acceptedSection);
        }

        if (rejectedChanges.length > 0) {
            const rejectedSection = createChangesSection('Rejected Changes', rejectedChanges);
            changesList.appendChild(rejectedSection);
        }
    };

    // Helper to create a section of changes
    const createChangesSection = (title, changes) => {
        const section = document.createElement('div');
        section.className = 'changes-section';
        
        const sectionTitle = document.createElement('h4');
        sectionTitle.className = 'section-title';
        sectionTitle.textContent = title;
        section.appendChild(sectionTitle);
        
        changes.forEach(change => {
            const changeEl = document.createElement('div');
            changeEl.className = 'tiptap-change';
            changeEl.classList.add(change.type);
            
            if (change.accepted) {
                changeEl.classList.add('accepted');
            } else if (change.rejected) {
                changeEl.classList.add('rejected');
            }
            
            const changeHeader = document.createElement('div');
            changeHeader.className = 'change-header';
            
            const changeType = document.createElement('span');
            changeType.className = 'change-type';
            changeType.textContent = change.type === 'insertion' ? 'Added' : 'Deleted';
            
            const changeUser = document.createElement('span');
            changeUser.className = 'change-user';
            changeUser.textContent = `by ${change.createdBy.name}`;
            
            const changeDate = document.createElement('span');
            changeDate.className = 'change-date';
            changeDate.textContent = new Date(change.createdAt).toLocaleString();
            
            changeHeader.appendChild(changeType);
            changeHeader.appendChild(changeUser);
            changeHeader.appendChild(changeDate);
            
            const changeText = document.createElement('div');
            changeText.className = 'change-text';
            changeText.textContent = `"${change.text}"`;
            
            changeEl.appendChild(changeHeader);
            changeEl.appendChild(changeText);
            
            // Add actions for pending changes
            if (!change.accepted && !change.rejected) {
                const changeActions = document.createElement('div');
                changeActions.className = 'change-actions';
                
                const acceptBtn = document.createElement('button');
                acceptBtn.className = 'accept-btn';
                acceptBtn.textContent = 'Accept';
                acceptBtn.onclick = () => {
                    trackChangesManager.acceptChange(change.id);
                    updateChangesList();
                    visualizeChanges();
                };
                
                const rejectBtn = document.createElement('button');
                rejectBtn.className = 'reject-btn';
                rejectBtn.textContent = 'Reject';
                rejectBtn.onclick = () => {
                    trackChangesManager.rejectChange(change.id);
                    updateChangesList();
                    visualizeChanges();
                };
                
                changeActions.appendChild(acceptBtn);
                changeActions.appendChild(rejectBtn);
                changeEl.appendChild(changeActions);
            }
            
            section.appendChild(changeEl);
        });
        
        return section;
    };

    // Apply visual indicators for tracked changes in the editor
    const visualizeChanges = () => {
        // This would be a more complex implementation in a production system
        // It would need to use the editor's state and transaction API to show
        // visual indicators for insertions and deletions
        
        // For now, we'll keep it simple and just add a class to the editor
        const pendingChanges = trackChangesManager.getPendingChanges();
        editor.options.element.classList.toggle('has-track-changes', pendingChanges.length > 0);
    };

    // Setup editor listeners to capture changes
    // This is a simplified example - a real implementation would hook into
    // the editor's transaction system to accurately capture all changes
    const setupEditorListeners = () => {
        // For demonstration purposes only - in a real implementation, you would
        // need to register NodeViews or use the transaction API to track changes
        editor.on('update', ({ editor, transaction }) => {
            if (!trackChangesManager.isTracking()) return;
            
            // This is a placeholder - a real implementation would diff the
            // content between states to determine what changed
            console.log('Editor updated - in a real implementation, changes would be tracked here');
        });
    };

    // Register listeners
    trackChangesManager.addListener(() => {
        updateChangesList();
        visualizeChanges();
    });

    // Initialize
    setupEditorListeners();
    updateChangesList();
    visualizeChanges();

    // Return the UI control functions
    return {
        container,
        updateChangesList,
        visualizeChanges
    };
}

// Expose globally
window.createTrackChangesUI = createTrackChangesUI;

// Add CSS for track changes
const trackChangesStyle = document.createElement('style');
trackChangesStyle.textContent = `
    .tiptap-track-changes-container {
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

    /* If comments container exists, position this below it */
    .tiptap-comments-container + .tiptap-track-changes-container {
        top: auto;
        margin-top: 10px;
    }

    .tiptap-track-changes-header {
        padding: 8px 12px;
        border-bottom: 1px solid #e0e0e0;
        background: #f0f0f0;
    }

    .tiptap-track-changes-header h3 {
        margin: 0;
        font-size: 16px;
        font-weight: 600;
    }

    .track-changes-toggle {
        display: block;
        width: calc(100% - 16px);
        margin: 8px;
        padding: 6px;
        background: #f0f0f0;
        border: 1px solid #ccc;
        border-radius: 4px;
        cursor: pointer;
        font-weight: 500;
    }

    .track-changes-toggle.active {
        background: #d1e7dd;
        border-color: #a3d0c3;
    }

    .track-changes-actions {
        display: flex;
        padding: 8px;
        gap: 8px;
        border-bottom: 1px solid #e0e0e0;
    }

    .track-changes-actions button {
        flex: 1;
        padding: 4px 8px;
        background: #f8f9fa;
        border: 1px solid #ccc;
        border-radius: 4px;
        cursor: pointer;
    }

    .accept-all-btn {
        color: #0a6b29;
    }

    .reject-all-btn {
        color: #842029;
    }

    .tiptap-changes-list {
        padding: 8px;
    }

    .changes-section {
        margin-bottom: 16px;
    }

    .section-title {
        margin: 0 0 8px 0;
        font-size: 14px;
        font-weight: 500;
        color: #666;
    }

    .tiptap-change {
        margin-bottom: 12px;
        padding: 8px;
        background: white;
        border-left: 3px solid #ccc;
        border-radius: 0 4px 4px 0;
        box-shadow: 0 1px 3px rgba(0,0,0,0.1);
    }

    .tiptap-change.insertion {
        border-left-color: #0a6b29;
    }

    .tiptap-change.deletion {
        border-left-color: #842029;
    }

    .tiptap-change.accepted {
        opacity: 0.7;
    }

    .tiptap-change.rejected {
        opacity: 0.5;
        text-decoration: line-through;
    }

    .change-header {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
        margin-bottom: 4px;
        font-size: 12px;
    }

    .change-type {
        font-weight: 600;
    }

    .change-user {
        color: #666;
    }

    .change-date {
        color: #666;
        font-size: 11px;
        flex-basis: 100%;
    }

    .change-text {
        font-size: 14px;
        margin-bottom: 8px;
        word-break: break-word;
    }

    .change-actions {
        display: flex;
        gap: 8px;
    }

    .change-actions button {
        flex: 1;
        background: none;
        border: 1px solid #ccc;
        padding: 3px 6px;
        border-radius: 3px;
        cursor: pointer;
        font-size: 12px;
    }

    .accept-btn {
        color: #0a6b29;
    }

    .accept-btn:hover {
        background: #d1e7dd;
    }

    .reject-btn {
        color: #842029;
    }

    .reject-btn:hover {
        background: #f8d7da;
    }

    .no-changes {
        color: #666;
        font-style: italic;
        text-align: center;
        padding: 16px 0;
    }

    /* Visual indicators for tracked changes in the editor */
    .has-track-changes {
        background-color: rgba(255, 255, 220, 0.3);
    }
`;

document.head.appendChild(trackChangesStyle); 