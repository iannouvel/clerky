// Clerky PDF.js Authentication Handler
// This script intercepts PDF.js file loading to add authentication tokens

(function() {
    'use strict';
    
    console.log('[Clerky Auth] Initializing PDF.js authentication handler');
    
    // Get URL parameters
    const urlParams = new URLSearchParams(window.location.search);
    const fileUrl = urlParams.get('file');
    const authToken = urlParams.get('token');
    
    if (!fileUrl) {
        console.error('[Clerky Auth] No file URL provided');
        return;
    }
    
    if (!authToken) {
        console.error('[Clerky Auth] No authentication token provided');
        alert('Authentication required. Please click the link from the main application.');
        return;
    }
    
    console.log('[Clerky Auth] File URL:', fileUrl);
    console.log('[Clerky Auth] Token present:', !!authToken);
    
    // Override PDFViewerApplication file opening to add auth header
    if (typeof PDFViewerApplicationOptions !== 'undefined') {
        // Set custom HTTP headers for PDF loading
        const originalGetDocument = pdfjsLib.getDocument;
        pdfjsLib.getDocument = function(params) {
            console.log('[Clerky Auth] Intercepting PDF load request');
            
            // If params is a string (URL), convert to object
            if (typeof params === 'string') {
                params = { url: params };
            }
            
            // Add authentication header
            if (!params.httpHeaders) {
                params.httpHeaders = {};
            }
            params.httpHeaders['Authorization'] = `Bearer ${authToken}`;
            
            console.log('[Clerky Auth] Added Authorization header to PDF request');
            
            // Call original getDocument with modified params
            return originalGetDocument.call(pdfjsLib, params);
        };
    }
    
    // Also set up fetch interceptor as backup
    const originalFetch = window.fetch;
    window.fetch = function(url, options) {
        // Check if this is a request to our API
        if (url && (url.toString().includes('/api/pdf/') || url.toString().includes(fileUrl))) {
            console.log('[Clerky Auth] Intercepting fetch request to:', url);
            
            options = options || {};
            options.headers = options.headers || {};
            options.headers['Authorization'] = `Bearer ${authToken}`;
            
            console.log('[Clerky Auth] Added Authorization header to fetch request');
        }
        
        return originalFetch.call(window, url, options);
    };
    
    console.log('[Clerky Auth] Authentication handler initialized successfully');
})();

