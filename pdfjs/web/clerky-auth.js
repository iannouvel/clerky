// Clerky PDF.js Authentication Handler
// This script handles authentication and disables origin checks for cross-origin PDF loading
// Note: Authentication token is now included in the file URL query parameter

(function() {
    'use strict';
    
    console.log('[Clerky Auth] PDF.js viewer initialized');
    
    // Disable PDF.js file origin validation to allow cross-origin PDFs
    // This is safe because we're using Firebase auth tokens for authentication
    if (typeof PDFViewerApplicationOptions !== 'undefined') {
        PDFViewerApplicationOptions.set('isEvalSupported', false);
        console.log('[Clerky Auth] Disabled eval for security');
    }
    
    // Override the file validation check and trigger search when PDF loads
    window.addEventListener('webviewerloaded', function() {
        console.log('[Clerky Auth] Webviewer loaded, configuring for cross-origin PDFs');
        
        // Check if there's a search term in the URL hash
        const hash = window.location.hash;
        const searchMatch = hash.match(/[#&]search=([^&]+)/);
        
        if (searchMatch && searchMatch[1]) {
            const searchTerm = decodeURIComponent(searchMatch[1]);
            console.log('[Clerky Auth] Search term detected in URL:', searchTerm.substring(0, 100) + '...');
            
            // Wait for PDF to be fully loaded, then trigger search
            document.addEventListener('pagesloaded', function() {
                console.log('[Clerky Auth] PDF pages loaded, triggering search...');
                
                if (!window.PDFViewerApplication || !window.PDFViewerApplication.eventBus) {
                    console.warn('[Clerky Auth] PDFViewerApplication not available for search trigger');
                    return;
                }
                
                // Track search state
                let searchCompleted = false;
                let pollAttempts = 0;
                const maxPollAttempts = 20; // Poll for up to 4 seconds (20 * 200ms)
                
                // Function to check and report search results
                const checkSearchResults = function() {
                    const findController = window.PDFViewerApplication?.pdfFindController;
                    
                    if (!findController) {
                        pollAttempts++;
                        if (pollAttempts < maxPollAttempts) {
                            setTimeout(checkSearchResults, 200);
                        } else {
                            console.warn('[PDF Search] Search timed out - find controller not available');
                        }
                        return;
                    }
                    
                    // Check if search has completed (matchCount is set, even if 0)
                    const matchCount = findController.matchCount;
                    const stateStates = findController.stateStates || {};
                    const isSearching = findController.state === stateStates.FIND_SEARCHING;
                    
                    // Consider search complete if:
                    // 1. Not searching, OR
                    // 2. matchCount is defined (even if 0, meaning search finished with no results)
                    if ((!isSearching || matchCount !== undefined) && matchCount !== undefined) {
                        // Search completed
                        if (!searchCompleted) {
                            searchCompleted = true;
                            const currentMatch = findController.selected && findController.selected.index !== -1
                                ? findController.selected.index + 1
                                : 0;
                            
                            if (matchCount > 0) {
                                console.log(`✅ [PDF Search] Found ${matchCount} match(es) for: "${searchTerm.substring(0, 80)}${searchTerm.length > 80 ? '...' : ''}"`);
                                if (currentMatch > 0) {
                                    console.log(`   📍 Currently viewing match ${currentMatch} of ${matchCount}`);
                                }
                            } else {
                                console.warn(`❌ [PDF Search] No matches found for: "${searchTerm.substring(0, 80)}${searchTerm.length > 80 ? '...' : ''}"`);
                                console.warn('   💡 Possible reasons:');
                                console.warn('      • Quoted text doesn\'t match PDF exactly (formatting/spacing differences)');
                                console.warn('      • Text contains citation markers not present in PDF');
                                console.warn('      • Text appears in different form in PDF');
                            }
                        }
                    } else if (pollAttempts < maxPollAttempts) {
                        // Still searching, poll again
                        pollAttempts++;
                        setTimeout(checkSearchResults, 200);
                    } else {
                        // Timeout
                        if (!searchCompleted) {
                            console.warn('[PDF Search] Search timed out after 4 seconds');
                            const finalMatchCount = findController.matchCount || 0;
                            if (finalMatchCount > 0) {
                                console.log(`⚠️ [PDF Search] Found ${finalMatchCount} match(es), but search may still be in progress`);
                            }
                        }
                    }
                };
                
                // Trigger the search
                console.log(`[PDF Search] Searching for: "${searchTerm.substring(0, 80)}${searchTerm.length > 80 ? '...' : ''}"`);
                
                window.PDFViewerApplication.eventBus.dispatch('find', {
                    source: window,
                    type: '',
                    query: searchTerm,
                    phraseSearch: true,
                    caseSensitive: false,
                    entireWord: false,
                    highlightAll: true,
                    findPrevious: false,
                    matchDiacritics: false
                });
                
                // Start polling for results after a brief delay to let search begin
                setTimeout(() => {
                    checkSearchResults();
                }, 300);
            }, { once: true });
        }
    });
    
    // Get URL parameters
    const urlParams = new URLSearchParams(window.location.search);
    const fileUrl = urlParams.get('file');
    
    if (!fileUrl) {
        console.error('[Clerky Auth] No file URL provided');
        return;
    }
    
    console.log('[Clerky Auth] File URL:', fileUrl);
    
    // Check if file URL includes token
    if (fileUrl.includes('token=')) {
        console.log('[Clerky Auth] Auth token detected in file URL');
    } else {
        console.warn('[Clerky Auth] No auth token found in file URL - PDF loading may fail');
    }
    
    // Log when PDF.js starts loading
    window.addEventListener('DOMContentLoaded', function() {
        console.log('[Clerky Auth] PDF.js viewer DOM ready');
    });
    
    console.log('[Clerky Auth] Authentication handler initialized successfully');
})();

