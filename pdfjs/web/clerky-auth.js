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
                
                // Use PDF.js's EventBus to trigger search
                if (window.PDFViewerApplication && window.PDFViewerApplication.eventBus) {
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
                    console.log('[Clerky Auth] Search triggered via EventBus');
                } else {
                    console.warn('[Clerky Auth] PDFViewerApplication not available for search trigger');
                }
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

