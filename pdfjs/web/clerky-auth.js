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
        console.log('═══════════════════════════════════════════════════════════════');
        console.log('[Clerky Auth] 🔍 VERBATIM QUOTE TO SEARCH FOR:');
        console.log('───────────────────────────────────────────────────────────────');
        console.log(searchTerm);
        console.log('───────────────────────────────────────────────────────────────');
        console.log('[Clerky Auth] Quote length:', searchTerm.length, 'characters');
        console.log('═══════════════════════════════════════════════════════════════');
        
        // Function to trigger the search
        const triggerSearch = function() {
            console.log('[Clerky Auth] PDF pages loaded, triggering fuzzy search...');
            
            if (!window.PDFViewerApplication) {
                console.warn('[Clerky Auth] PDFViewerApplication not available for search trigger');
                return;
            }
            
            if (!window.PDFViewerApplication.eventBus) {
                console.warn('[Clerky Auth] PDFViewerApplication.eventBus not available for search trigger');
                return;
            }
            
            // Debug log
            console.log('[Clerky Auth] PDFViewerApplication state:', {
                hasPdfDocument: !!window.PDFViewerApplication.pdfDocument,
                hasEventBus: !!window.PDFViewerApplication.eventBus,
                hasFindController: !!window.PDFViewerApplication.findController,
                availableKeys: Object.keys(window.PDFViewerApplication).slice(0, 20)
            });
            
            // Normalise the incoming search term for PDF search while still
            // preserving useful structure (ellipses, etc.) for variant generation.
            const normaliseSearchTermForPdf = function(text) {
                if (!text) return '';
                
                let cleaned = String(text);
                
                // Strip common trademark / copyright symbols that often differ between
                // AI output and the actual PDF text.
                cleaned = cleaned.replace(/[™®©]/g, '');
                
                // Normalise number-unit spacing, e.g. "1ml" -> "1 ml"
                cleaned = cleaned.replace(/(\d+)\s*([a-zA-Z]+)\b/g, '$1 $2');
                
                // Normalise American to British spellings (UK medical guidelines use British)
                // This is critical for medical terms like magnesium sulfate/sulphate
                const americanToBritish = {
                    'sulfate': 'sulphate',
                    'sulfur': 'sulphur',
                    'anemia': 'anaemia',
                    'anemic': 'anaemic',
                    'anesthesia': 'anaesthesia',
                    'anesthetic': 'anaesthetic',
                    'cesarean': 'caesarean',
                    'cesarian': 'caesarean',
                    'edema': 'oedema',
                    'esophagus': 'oesophagus',
                    'estrogen': 'oestrogen',
                    'fetus': 'foetus',
                    'fetal': 'foetal',
                    'gynecology': 'gynaecology',
                    'gynecological': 'gynaecological',
                    'hemoglobin': 'haemoglobin',
                    'hemorrhage': 'haemorrhage',
                    'hemorrhagic': 'haemorrhagic',
                    'hemolytic': 'haemolytic',
                    'pediatric': 'paediatric',
                    'pediatrics': 'paediatrics',
                    'labor': 'labour',
                    'tumor': 'tumour',
                    'tumor': 'tumour',
                    'fiber': 'fibre',
                    'liter': 'litre',
                    'meter': 'metre',
                    'center': 'centre',
                    'color': 'colour',
                    'behavior': 'behaviour',
                    'leukemia': 'leukaemia',
                    'diarrhea': 'diarrhoea',
                    'maneuver': 'manoeuvre',
                    'orthopedic': 'orthopaedic'
                };
                
                // Apply American to British conversions (case-insensitive)
                for (const [american, british] of Object.entries(americanToBritish)) {
                    const regex = new RegExp(american, 'gi');
                    cleaned = cleaned.replace(regex, match => {
                        // Preserve case of first letter
                        if (match[0] === match[0].toUpperCase()) {
                            return british.charAt(0).toUpperCase() + british.slice(1);
                        }
                        return british;
                    });
                }
                
                // Collapse whitespace
                cleaned = cleaned.replace(/\s+/g, ' ').trim();
                
                return cleaned;
            };

            // Generate search variants for fuzzy matching (from exact to increasingly fuzzy)
            const generateSearchVariants = function(originalText) {
                const variants = [];
                
                const baseText = normaliseSearchTermForPdf(originalText) || originalText || '';
                if (!baseText) {
                    return variants;
                }

                // If the text contains ellipses, add a high-priority variant using the
                // longest contiguous segment without the ellipsis. This helps when AI
                // output compresses text with "..." that does not exist in the PDF.
                const ellipsisSplit = baseText.split(/\s*(?:\.{3}|…)+\s*/).map(p => p.trim()).filter(Boolean);
                if (ellipsisSplit.length > 1) {
                    const longestSegment = ellipsisSplit.reduce((a, b) => (b.length > a.length ? b : a), '');
                    if (longestSegment && longestSegment.length >= 10) {
                        variants.push({
                            query: longestSegment,
                            phraseSearch: true,
                            description: 'segment without ellipsis'
                        });
                    }
                }

                // 1. Exact phrase (already cleaned of basic noise)
                variants.push({
                    query: baseText,
                    phraseSearch: true,
                    description: 'exact phrase'
                });
                
                // 2. Try removing punctuation
                const noPunctuation = baseText.replace(/[.,;:!?]/g, '');
                if (noPunctuation !== baseText) {
                    variants.push({
                        query: noPunctuation,
                        phraseSearch: true,
                        description: 'without punctuation'
                    });
                }
                
                // 3. Try first significant sentence (if multi-sentence)
                const sentences = baseText.split(/[.!?]+/).filter(s => s.trim().length > 20);
                if (sentences.length > 1 && sentences[0].trim().length > 30) {
                    variants.push({
                        query: sentences[0].trim(),
                        phraseSearch: true,
                        description: 'first sentence'
                    });
                }
                
                // 4. Try key phrases (chunks of 10+ words)
                const words = baseText.split(/\s+/);
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
                
                // 5. NUMERIC-FOCUSED VARIANT: If the text contains numeric values
                // (times, doses, percentiles), build a phrase around them.
                // This is critical for medical guidelines where numbers matter.
                const numericPattern = /\d+(?:[-–—]\d+)?(?:st|nd|rd|th)?/gi;
                const numericMatches = baseText.match(numericPattern);
                if (numericMatches && numericMatches.length > 0) {
                    // Find the position of the first numeric in the word list
                    const firstNumeric = numericMatches[0];
                    const numIdx = words.findIndex(w => w.match(numericPattern));
                    if (numIdx !== -1) {
                        // Build a 5-7 word window around the numeric
                        const windowStart = Math.max(0, numIdx - 2);
                        const windowEnd = Math.min(words.length, numIdx + 5);
                        const numericPhrase = words.slice(windowStart, windowEnd).join(' ');
                        if (numericPhrase.length >= 10) {
                            variants.push({
                                query: numericPhrase,
                                phraseSearch: true,
                                description: 'numeric window phrase'
                            });
                        }
                    }
                    
                    // Also try just the numeric with a few surrounding words
                    // This helps when the exact phrasing differs but the number is key
                    if (words.length >= 3) {
                        const numericWords = words.filter(w => w.match(numericPattern) || w.length >= 4);
                        if (numericWords.length >= 2 && numericWords.length <= 8) {
                            variants.push({
                                query: numericWords.join(' '),
                                phraseSearch: false, // Allow flexibility in word order
                                description: 'numeric keywords'
                            });
                        }
                    }
                }
                
                // 6. Tail phrase: last 6–8 words, which often carry the specific
                // threshold or condition (e.g. "EFW >90th centile").
                if (words.length >= 6) {
                    const tailSize = Math.min(8, words.length);
                    const tail = words.slice(words.length - tailSize).join(' ');
                    variants.push({
                        query: tail,
                        phraseSearch: true,
                        description: 'tail phrase'
                    });
                }
                
                // 7. Try first 10 words as phrase
                if (words.length > 10) {
                    variants.push({
                        query: words.slice(0, 10).join(' '),
                        phraseSearch: true,
                        description: 'first 10 words'
                    });
                }
                
                // 8. Last resort: search for distinctive words (5+ chars, not common)
                const commonWords = new Set(['the', 'and', 'for', 'that', 'this', 'with', 'from', 'have', 'been', 'should', 'would', 'could']);
                const distinctiveWordList = words
                    .filter(w => w.length >= 5 && !commonWords.has(w.toLowerCase()))
                    .slice(0, 6);
                const distinctiveWords = distinctiveWordList.join(' ');
                if (distinctiveWordList.length >= 1) {
                    variants.push({
                        query: distinctiveWords,
                        phraseSearch: false, // Allow words in any order
                        description: 'distinctive keywords'
                    });
                }

                // 9. For short snippets, add an "all keywords" variant to ensure we at
                // least land near any occurrence of the combined terms.
                if (words.length > 1 && words.length <= 10) {
                    variants.push({
                        query: words.join(' '),
                        phraseSearch: false,
                        description: 'all keywords'
                    });
                }
                
                // Log variant summary for debugging
                console.log('[PDF Search] Generated', variants.length, 'search variants:', 
                    variants.map(v => v.description).join(', '));
                
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
                    const findController = window.PDFViewerApplication?.findController;
                    
                    if (!findController) {
                        pollAttempts++;
                        if (pollAttempts < maxPollAttempts) {
                            setTimeout(checkSearchResults, 200);
                        } else {
                            console.warn('[PDF Search] Find controller lost or search timed out, trying next variant...');
                            currentVariantIndex++;
                            tryNextVariant();
                        }
                        return;
                    }
                    
                    // Check multiple properties to detect successful search
                    const matchCount = findController.matchCount;
                    const matchesCount = findController.matchesCount;
                    const pageMatches = findController.pageMatches;
                    const selected = findController.selected;
                    
                    // Debug logging on first few attempts
                    if (pollAttempts < 3) {
                        console.log(`[PDF Search Debug] Poll ${pollAttempts + 1}:`, {
                            matchCount,
                            matchesCount,
                            hasPageMatches: !!pageMatches,
                            pageMatchesType: typeof pageMatches,
                            selected,
                            state: findController.state,
                            highlightAll: findController.highlightAll
                        });
                    }
                    
                    // Determine if search is complete and successful
                    // Check various indicators that matches were found
                    const hasMatches = matchCount > 0 || 
                                      matchesCount?.total > 0 ||
                                      (pageMatches && Object.keys(pageMatches).some(key => pageMatches[key]?.length > 0)) ||
                                      (selected?.matchIdx !== undefined && selected?.matchIdx >= 0);
                    
                    // Check if search is complete (not still searching)
                    const stateStates = findController.stateStates || {};
                    const isSearching = findController.state === stateStates.FIND_SEARCHING;
                    const isComplete = !isSearching && (matchCount !== null || matchesCount !== null || pageMatches !== null);
                    
                    if (hasMatches && !searchCompleted) {
                        // Success! Matches found
                        searchCompleted = true;
                        const totalMatches = matchCount || matchesCount?.total || 
                                           (pageMatches ? Object.values(pageMatches).reduce((sum, arr) => sum + (arr?.length || 0), 0) : 0);
                        const currentMatch = selected?.matchIdx !== undefined && selected?.matchIdx >= 0
                            ? selected.matchIdx + 1
                            : (selected?.index !== undefined && selected?.index >= 0 ? selected.index + 1 : 0);
                        
                        if (currentVariantIndex === 0) {
                            console.log(`✅ [PDF Search] Found ${totalMatches || 'multiple'} exact match(es)`);
                        } else {
                            console.log(`✅ [PDF Search] Found ${totalMatches || 'multiple'} match(es) using ${variant.description}`);
                            console.log(`   ℹ️  Exact phrase didn't match - this is a fuzzy match`);
                        }
                        if (currentMatch > 0) {
                            console.log(`   📍 Currently viewing match ${currentMatch}${totalMatches ? ' of ' + totalMatches : ''}`);
                        }
                        return; // Stop polling, search successful
                    } else if (isComplete && !hasMatches && !searchCompleted) {
                        // Search completed but no matches found
                        console.log(`   ⚠️  No matches with ${variant.description}`);
                        currentVariantIndex++;
                        setTimeout(() => tryNextVariant(), 100);
                        return;
                    } else if (pollAttempts < maxPollAttempts) {
                        // Still searching or waiting
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
                // Using new PDF.js API: query must be array (single element for phrase, multiple for words)
                window.PDFViewerApplication.eventBus.dispatch('find', {
                    source: window,
                    type: '',
                    query: variant.phraseSearch ? [variant.query] : variant.query.split(/\s+/),
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
        };
        
        // Set up the pagesloaded listener
        document.addEventListener('pagesloaded', function(e) {
            console.log('[Clerky Auth] pagesloaded event fired!', e);
            // Wait for find controller before triggering search
            waitForFindController(triggerSearch);
        }, { once: true });
        
        // Also poll to check if pages are loaded (in case event is missed)
        let pollCount = 0;
        const maxPolls = 20; // Poll for up to 10 seconds
        const pollInterval = setInterval(() => {
            pollCount++;
            console.log(`[Clerky Auth] Polling attempt ${pollCount}/${maxPolls} - checking if PDF loaded...`);
            
            if (window.PDFViewerApplication && window.PDFViewerApplication.pdfDocument) {
                console.log('[Clerky Auth] PDF detected as loaded via polling');
                clearInterval(pollInterval);
                // Remove the event listener since we're triggering manually
                document.removeEventListener('pagesloaded', triggerSearch);
                // Wait for find controller before triggering search
                waitForFindController(triggerSearch);
            } else if (pollCount >= maxPolls) {
                console.error('[Clerky Auth] Gave up waiting for PDF to load after polling');
                clearInterval(pollInterval);
            }
        }, 500);
        
        // Listen for retry search event (fired after successful PDF upload retry)
        document.addEventListener('clerky-retry-search', function(e) {
            console.log('[Clerky Auth] Received clerky-retry-search event');
            if (e.detail && e.detail.searchTerm) {
                console.log('[Clerky Auth] Re-triggering search after PDF retry...');
                triggerSearch();
            }
        });
        
        // Wait specifically for find controller to be available
        function waitForFindController(callback) {
            let findControllerPollCount = 0;
            const maxFindControllerPolls = 40; // Poll for up to 8 seconds
            
            console.log('[Clerky Auth] Waiting for find controller to initialize...');
            
            // Debug: Check what's available on PDFViewerApplication
            if (window.PDFViewerApplication) {
                const pdfFindProps = Object.keys(window.PDFViewerApplication).filter(key => key.toLowerCase().includes('find'));
                console.log('[Clerky Auth] PDFViewerApplication available, total properties:', Object.keys(window.PDFViewerApplication).length);
                console.log('[Clerky Auth] Properties with "find" in name:', pdfFindProps);
                console.log('[Clerky Auth] Find property values:', pdfFindProps.map(key => ({ 
                    key, 
                    value: window.PDFViewerApplication[key],
                    type: typeof window.PDFViewerApplication[key]
                })));
            }
            
            const findControllerInterval = setInterval(() => {
                findControllerPollCount++;
                
                if (window.PDFViewerApplication?.findController) {
                    console.log(`[Clerky Auth] Find controller available after ${findControllerPollCount} polls, triggering search`);
                    clearInterval(findControllerInterval);
                    callback();
                } else if (findControllerPollCount >= maxFindControllerPolls) {
                    console.error('[Clerky Auth] Find controller not available after 8 seconds');
                    console.error('[Clerky Auth] Available on PDFViewerApplication:', window.PDFViewerApplication ? Object.keys(window.PDFViewerApplication) : 'PDFViewerApplication not found');
                    console.error('[Clerky Auth] Attempting search anyway - it may fail');
                    clearInterval(findControllerInterval);
                    // Try the search anyway - maybe the controller is there but named differently
                    callback();
                } else if (findControllerPollCount % 5 === 0) {
                    console.log(`[Clerky Auth] Still waiting for find controller... (${findControllerPollCount}/${maxFindControllerPolls})`);
                }
            }, 200);
        }
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
    
    // Auto-retry functionality: Upload missing PDFs from GitHub and retry
    let retryAttempted = false;
    const currentFileUrl = fileUrl; // Store fileUrl for use in error handlers
    
    // Function to show user-friendly status messages
    function showUploadStatus(message, isError = false) {
        // Remove existing status overlay if present
        let statusOverlay = document.getElementById('clerky-upload-status');
        if (!statusOverlay) {
            statusOverlay = document.createElement('div');
            statusOverlay.id = 'clerky-upload-status';
            statusOverlay.style.cssText = `
                position: fixed;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                background: white;
                border: 2px solid #3b82f6;
                border-radius: 8px;
                padding: 24px 32px;
                box-shadow: 0 10px 25px rgba(0, 0, 0, 0.2);
                z-index: 10000;
                max-width: 500px;
                text-align: center;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            `;
            document.body.appendChild(statusOverlay);
        }
        
        statusOverlay.innerHTML = `
            <div style="margin-bottom: 16px;">
                ${isError ? '❌' : '⏳'}
            </div>
            <div style="font-size: 18px; font-weight: 600; color: #1f2937; margin-bottom: 8px;">
                ${isError ? 'Upload Failed' : 'Preparing PDF'}
            </div>
            <div style="font-size: 14px; color: #6b7280; line-height: 1.5;">
                ${message}
            </div>
            ${!isError ? `
                <div style="margin-top: 16px;">
                    <div style="display: inline-block; width: 40px; height: 40px; border: 4px solid #e5e7eb; border-top-color: #3b82f6; border-radius: 50%; animation: spin 1s linear infinite;"></div>
                </div>
                <style>
                    @keyframes spin {
                        to { transform: rotate(360deg); }
                    }
                </style>
            ` : ''}
        `;
        
        if (isError) {
            statusOverlay.style.borderColor = '#ef4444';
        }
    }
    
    function hideUploadStatus() {
        const statusOverlay = document.getElementById('clerky-upload-status');
        if (statusOverlay) {
            statusOverlay.remove();
        }
    }
    
    // Intercept PDF.js loading errors to auto-upload missing PDFs
    const originalOpen = window.PDFViewerApplication?.open;
    if (originalOpen) {
        window.PDFViewerApplication.open = async function(args) {
            try {
                return await originalOpen.call(this, args);
            } catch (error) {
                // Check if this is a 404 error indicating PDF is missing from Storage
                if (error && error.message && error.message.includes('Missing PDF')) {
                    console.log('[Clerky Auth] PDF loading failed, checking if auto-upload is needed...');
                    
                    // Extract guidelineId from the file URL
                    const pdfUrl = args?.url || args?.src || currentFileUrl;
                    if (pdfUrl && pdfUrl.includes('/api/pdf/')) {
                        const match = pdfUrl.match(/\/api\/pdf\/([^?]+)/);
                        if (match && !retryAttempted) {
                            const guidelineId = match[1];
                            console.log('[Clerky Auth] Attempting auto-upload for guideline:', guidelineId);
                            retryAttempted = true;
                            
                            try {
                                // Get auth token from URL
                                const tokenMatch = pdfUrl.match(/[?&]token=([^&]+)/);
                                const token = tokenMatch ? decodeURIComponent(tokenMatch[1]) : null;
                                
                                if (!token) {
                                    console.error('[Clerky Auth] No auth token found for auto-upload');
                                    throw error; // Re-throw original error
                                }
                                
                                // Show loading message
                                if (window.PDFViewerApplication) {
                                    const loadingBar = document.querySelector('.loadingBar');
                                    if (loadingBar) {
                                        loadingBar.textContent = 'PDF not found in Storage. Uploading from GitHub...';
                                    }
                                }
                                
                                // Call upload endpoint
                                const serverUrl = pdfUrl.match(/https?:\/\/[^/]+/)?.[0] || window.location.origin;
                                const uploadResponse = await fetch(`${serverUrl}/uploadMissingPdf`, {
                                    method: 'POST',
                                    headers: {
                                        'Content-Type': 'application/json',
                                        'Authorization': `Bearer ${token}`
                                    },
                                    body: JSON.stringify({ guidelineId })
                                });
                                
                                const uploadResult = await uploadResponse.json();
                                
                                if (uploadResult.success) {
                                    console.log('[Clerky Auth] PDF uploaded successfully, retrying load...');
                                    
                                    // Retry loading the PDF
                                    setTimeout(() => {
                                        retryAttempted = false; // Reset for retry
                                        return originalOpen.call(this, args);
                                    }, 1000);
                                    return; // Don't throw error, retry is in progress
                                } else {
                                    console.error('[Clerky Auth] Auto-upload failed:', uploadResult.error);
                                    throw new Error(`Failed to upload PDF: ${uploadResult.error}`);
                                }
                            } catch (uploadError) {
                                console.error('[Clerky Auth] Error during auto-upload:', uploadError);
                                throw error; // Re-throw original error
                            }
                        }
                    }
                }
                
                // Re-throw error if we couldn't handle it
                throw error;
            }
        };
    }
    
    // Also intercept fetch errors for PDF loading
    const originalFetch = window.fetch;
    window.fetch = async function(...args) {
        const response = await originalFetch.apply(this, args);
        
        // Check if this is a PDF request that failed with 404
        if (!response.ok && response.status === 404) {
            const url = args[0];
            if (typeof url === 'string' && url.includes('/api/pdf/')) {
                try {
                    // Clone response to read error without consuming the original
                    const responseClone = response.clone();
                    const errorData = await responseClone.json().catch(() => null);
                    
                    if (errorData && errorData.error === 'PDF file not found in Firebase Storage' && !retryAttempted) {
                        console.log('[Clerky Auth] PDF not found in Storage, attempting auto-upload...');
                        
                        const match = url.match(/\/api\/pdf\/([^?]+)/);
                        if (match) {
                            const guidelineId = match[1];
                            retryAttempted = true;
                            
                            // Get token from URL
                            const tokenMatch = url.match(/[?&]token=([^&]+)/);
                            const token = tokenMatch ? decodeURIComponent(tokenMatch[1]) : null;
                            
                            if (token) {
                                const serverUrl = url.match(/https?:\/\/[^/]+/)?.[0] || window.location.origin;
                                
                                // Show user-friendly status message
                                showUploadStatus('PDF not found in storage. Uploading from GitHub...');
                                
                                try {
                                    console.log('[Clerky Auth] Calling uploadMissingPdf for:', guidelineId);
                                    
                                    // Update status during upload
                                    setTimeout(() => {
                                        showUploadStatus('Downloading PDF from GitHub... This may take a moment.');
                                    }, 1000);
                                    
                                    const uploadResponse = await originalFetch(`${serverUrl}/uploadMissingPdf`, {
                                        method: 'POST',
                                        headers: {
                                            'Content-Type': 'application/json',
                                            'Authorization': `Bearer ${token}`
                                        },
                                        body: JSON.stringify({ guidelineId })
                                    });
                                    
                                    const uploadResult = await uploadResponse.json();
                                    
                                    if (uploadResult.success) {
                                        console.log('[Clerky Auth] PDF uploaded successfully, retrying fetch...');
                                        
                                        // Update status for reload
                                        showUploadStatus('PDF uploaded successfully! Loading PDF...');
                                        
                                        // Reset retry flag for the retry attempt
                                        retryAttempted = false;
                                        
                                        // Retry the original fetch
                                        const retryResponse = await originalFetch.apply(this, args);
                                        
                                        // Hide status overlay after a short delay to show it loaded
                                        setTimeout(() => {
                                            hideUploadStatus();
                                        }, 500);
                                        
                                        // After successful retry, we need to re-trigger the search
                                        // because the original pagesloaded/polling setup may have already fired/completed
                                        console.log('[Clerky Auth] Setting up post-retry search trigger...');
                                        setTimeout(() => {
                                            // Re-check for search term and trigger search if PDF is loaded
                                            const hash = window.location.hash;
                                            const searchMatch = hash.match(/[#&]search=([^&]+)/);
                                            
                                            if (searchMatch && searchMatch[1]) {
                                                const searchTerm = decodeURIComponent(searchMatch[1]);
                                                console.log('[Clerky Auth] Post-retry: Re-triggering search for:', searchTerm.substring(0, 50) + '...');
                                                
                                                // Poll for PDF to be ready and findController to be available
                                                let postRetryPolls = 0;
                                                const maxPostRetryPolls = 30; // 15 seconds
                                                
                                                const postRetryPollInterval = setInterval(() => {
                                                    postRetryPolls++;
                                                    
                                                    if (window.PDFViewerApplication?.pdfDocument && window.PDFViewerApplication?.findController) {
                                                        console.log('[Clerky Auth] Post-retry: PDF and findController ready, triggering search');
                                                        clearInterval(postRetryPollInterval);
                                                        
                                                        // Dispatch a custom event that will trigger the search
                                                        document.dispatchEvent(new CustomEvent('clerky-retry-search', { detail: { searchTerm } }));
                                                    } else if (postRetryPolls >= maxPostRetryPolls) {
                                                        console.error('[Clerky Auth] Post-retry: Gave up waiting for PDF/findController after 15 seconds');
                                                        clearInterval(postRetryPollInterval);
                                                    } else if (postRetryPolls % 5 === 0) {
                                                        console.log(`[Clerky Auth] Post-retry: Waiting for PDF to load... (${postRetryPolls}/${maxPostRetryPolls})`);
                                                    }
                                                }, 500);
                                            }
                                        }, 1000); // Wait a second for the PDF to start loading
                                        
                                        return retryResponse;
                                    } else {
                                        console.error('[Clerky Auth] Auto-upload failed:', uploadResult.error);
                                        showUploadStatus(`Upload failed: ${uploadResult.error || 'Unknown error'}`, true);
                                        retryAttempted = false; // Reset so user can try again
                                        
                                        // Hide error after 5 seconds
                                        setTimeout(() => {
                                            hideUploadStatus();
                                        }, 5000);
                                    }
                                } catch (uploadError) {
                                    console.error('[Clerky Auth] Error during auto-upload:', uploadError);
                                    showUploadStatus(`Upload error: ${uploadError.message}`, true);
                                    retryAttempted = false; // Reset so user can try again
                                    
                                    // Hide error after 5 seconds
                                    setTimeout(() => {
                                        hideUploadStatus();
                                    }, 5000);
                                }
                            } else {
                                console.error('[Clerky Auth] No auth token found in URL for auto-upload');
                                showUploadStatus('Authentication error. Please try again.', true);
                                retryAttempted = false;
                                
                                setTimeout(() => {
                                    hideUploadStatus();
                                }, 5000);
                            }
                        }
                    }
                } catch (e) {
                    // Not JSON or other error, continue with original response
                    console.log('[Clerky Auth] Error checking response:', e.message);
                }
            }
        }
        
        return response;
    };
    
    console.log('[Clerky Auth] Authentication handler initialized successfully');
    console.log('[Clerky Auth] Auto-retry functionality enabled');
})();

