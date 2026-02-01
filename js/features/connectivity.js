/**
 * Connectivity Monitoring
 * Handles online/offline state detection and user notifications
 */

/**
 * Initialize connectivity listeners for online/offline detection
 * @param {Function} updateUserFn - Function to display messages to the user
 */
export function initializeConnectivityMonitoring(updateUserFn) {
    window.addEventListener('online', () => {
        console.log('[NETWORK] Connection restored');
        if (updateUserFn) {
            updateUserFn('Connection restored. You are back online.', false);
        }
        // Clear message after 5 seconds
        setTimeout(() => {
            const statusEl = document.getElementById('serverStatusMessage');
            if (statusEl && statusEl.textContent === 'Connection restored. You are back online.') {
                const timestamp = new Date().toISOString().substr(11, 12);
                console.log(`[STATUS ${timestamp}] HIDING (connectivity: online timeout)`, {
                    message: statusEl.textContent,
                    hasOngoingWorkflows: !!(window.workflowInProgress || window.isAnalysisRunning || window.sequentialProcessingActive)
                });
                statusEl.style.display = 'none';
            }
        }, 5000);

        // Attempt to reconnect listeners if needed or rely on Firestore auto-reconnect
        if (window.cacheManager) {
            // Signal cache manager we are back online if relevant
        }
    });

    window.addEventListener('offline', () => {
        console.log('[NETWORK] Connection lost');
        if (updateUserFn) {
            updateUserFn('Connection lost. Switching to offline mode (cached data).', true);
        }
    });
}

/**
 * Check if the browser is currently online
 * @returns {boolean}
 */
export function isOnline() {
    return navigator.onLine;
}
