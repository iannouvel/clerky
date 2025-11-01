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
    
    // Check if there's a search term in the URL hash (do this early)
    const hash = window.location.hash;
    const searchMatch = hash.match(/[#&]search=([^&]+)/);
    
    if (searchMatch && searchMatch[1]) {
        const searchTerm = decodeURIComponent(searchMatch[1]);
        console.log('[Clerky Auth] Search term detected in URL:', searchTerm.substring(0, 100) + '...');
        
        // Set up the pagesloaded listener immediately
        document.addEventListener('pagesloaded', function() {
            console.log('[Clerky Auth] PDF pages loaded, triggering fuzzy search...');
            
            if (!window.PDFViewerApplication || !window.PDFViewerApplication.eventBus) {
                console.warn('[Clerky Auth] PDFViewerApplication not available for search trigger');
                return;
            }
            
            // Generate search variants for fuzzy matching (from exact to increasingly fuzzy)
            const generateSearchVariants = function(text) {
                const variants = [];
                
                // 1. Exact phrase (already cleaned of citations)
                variants.push({
                    query: text,
                    phraseSearch: true,
                    description: 'exact phrase'
                });
                
                // 2. Try removing punctuation
                const noPunctuation = text.replace(/[.,;:!?]/g, '');
                if (noPunctuation !== text) {
                    variants.push({
                        query: noPunctuation,
                        phraseSearch: true,
                        description: 'without punctuation'
                    });
                }
                
                // 3. Try first significant sentence (if multi-sentence)
                const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 20);
                if (sentences.length > 1 && sentences[0].trim().length > 30) {
                    variants.push({
                        query: sentences[0].trim(),
                        phraseSearch: true,
                        description: 'first sentence'
                    });
                }
                
                // 4. Try key phrases (chunks of 10+ words)
                const words = text.split(/\s+/);
                if (words.length > 15) {
                    // Take middle portion (often the most specific)
                    const start = Math.floor(words.length * 0.2);
                    const end = Math.ceil(words.length * 0.8);
                    const middleChunk = words.slice(start, end).join(' ');
                    if (middleChunk.length > 50) {
                        variants.push({
                            query: middleChunk,
                            phraseSearch: true,
                            description: 'middle portion'
                        });
                    }
                }
                
                // 5. Try first 10 words as phrase
                if (words.length > 10) {
                    variants.push({
                        query: words.slice(0, 10).join(' '),
                        phraseSearch: true,
                        description: 'first 10 words'
                    });
                }
                
                // 6. Last resort: search for distinctive words (5+ chars, not common)
                const commonWords = new Set(['the', 'and', 'for', 'that', 'this', 'with', 'from', 'have', 'been', 'should', 'would', 'could']);
                const distinctiveWords = words
                    .filter(w => w.length >= 5 && !commonWords.has(w.toLowerCase()))
                    .slice(0, 5)
                    .join(' ');
                if (distinctiveWords && distinctiveWords.split(/\s+/).length >= 3) {
                    variants.push({
                        query: distinctiveWords,
                        phraseSearch: false, // Allow words in any order
                        description: 'distinctive keywords'
                    });
                }
                
                return variants;
            };
            
            const searchVariants = generateSearchVariants(searchTerm);
            let currentVariantIndex = 0;
            let searchCompleted = false;
            
            // Function to try next search variant
            const tryNextVariant = function() {
                if (currentVariantIndex >= searchVariants.length) {
                    console.error('❌ [PDF Search] All search strategies failed');
                    console.log('   Original query:', searchTerm.substring(0, 100));
                    console.log('   💡 The text may not exist in this PDF or is significantly reformatted');
                    return;
                }
                
                const variant = searchVariants[currentVariantIndex];
                console.log(`🔍 [PDF Search] Attempt ${currentVariantIndex + 1}/${searchVariants.length}: Searching ${variant.description}...`);
                console.log(`   Query: "${variant.query.substring(0, 80)}${variant.query.length > 80 ? '...' : ''}"`);
                
                let pollAttempts = 0;
                const maxPollAttempts = 20;
                
                const checkSearchResults = function() {
                    const findController = window.PDFViewerApplication?.pdfFindController;
                    
                    if (!findController) {
                        pollAttempts++;
                        if (pollAttempts < maxPollAttempts) {
                            setTimeout(checkSearchResults, 200);
                        } else {
                            console.warn('[PDF Search] Find controller not available, trying next variant...');
                            currentVariantIndex++;
                            tryNextVariant();
                        }
                        return;
                    }
                    
                    const matchCount = findController.matchCount;
                    const stateStates = findController.stateStates || {};
                    const isSearching = findController.state === stateStates.FIND_SEARCHING;
                    
                    if ((!isSearching || matchCount !== undefined) && matchCount !== undefined) {
                        // Search completed
                        if (matchCount > 0) {
                            // Success!
                            if (!searchCompleted) {
                                searchCompleted = true;
                                const currentMatch = findController.selected && findController.selected.index !== -1
                                    ? findController.selected.index + 1
                                    : 0;
                                
                                if (currentVariantIndex === 0) {
                                    console.log(`✅ [PDF Search] Found ${matchCount} exact match(es)`);
                                } else {
                                    console.log(`✅ [PDF Search] Found ${matchCount} match(es) using ${variant.description}`);
                                    console.log(`   ℹ️  Exact phrase didn't match - this is a fuzzy match`);
                                }
                                if (currentMatch > 0) {
                                    console.log(`   📍 Currently viewing match ${currentMatch} of ${matchCount}`);
                                }
                            }
                        } else {
                            // No matches, try next variant
                            console.log(`   ⚠️  No matches with ${variant.description}`);
                            currentVariantIndex++;
                            setTimeout(() => tryNextVariant(), 100);
                        }
                    } else if (pollAttempts < maxPollAttempts) {
                        pollAttempts++;
                        setTimeout(checkSearchResults, 200);
                    } else {
                        // Timeout, try next variant
                        console.warn(`   ⏱️  Search timed out for ${variant.description}`);
                        currentVariantIndex++;
                        tryNextVariant();
                    }
                };
                
                // Trigger the search with current variant
                window.PDFViewerApplication.eventBus.dispatch('find', {
                    source: window,
                    type: '',
                    query: variant.query,
                    phraseSearch: variant.phraseSearch,
                    caseSensitive: false,
                    entireWord: false,
                    highlightAll: true,
                    findPrevious: false,
                    matchDiacritics: false
                });
                
                // Start polling for results
                setTimeout(() => {
                    checkSearchResults();
                }, 300);
            };
            
            // Start with first variant
            console.log(`[PDF Search] Starting fuzzy search with ${searchVariants.length} strategies`);
            tryNextVariant();
        }, { once: true });
    }
    
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

