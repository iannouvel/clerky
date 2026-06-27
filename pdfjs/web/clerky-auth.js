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
        const searchTerm = decodeURIComponent(searchMatch[1].replace(/\+/g, ' '));

        // Kill the search race: strip the #search hash so PDF.js's BUILT-IN viewer
        // hash handler does NOT also auto-search and compete with (then overwrite)
        // our deterministic phrase search. clerky-auth.js runs before viewer.js, so
        // clearing the hash now means viewer.js reads an empty initialBookmark and
        // leaves the search entirely to us. We keep our own copy in `searchTerm`.
        try { history.replaceState(null, '', window.location.pathname + window.location.search); } catch (e) {}

        console.log('═══════════════════════════════════════════════════════════════');
        console.log('[Clerky Auth] 🔍 VERBATIM QUOTE TO SEARCH FOR:');
        console.log('───────────────────────────────────────────────────────────────');
        console.log(searchTerm);
        console.log('───────────────────────────────────────────────────────────────');
        console.log('[Clerky Auth] Quote length:', searchTerm.length, 'characters');
        console.log('═══════════════════════════════════════════════════════════════');

        // A light, LOSSY normaliser used ONLY as a fallback variant (for AI-paraphrased
        // quotes that aren't verbatim). Never applied to the first/exact attempt, so it
        // can't break a quote that already matches the PDF verbatim.
        const normaliseSearchTermForPdf = function(text) {
            if (!text) return '';
            let cleaned = String(text);
            cleaned = cleaned.replace(/[™®©]/g, '');                       // strip trademark/copyright marks
            cleaned = cleaned.replace(/(\d+)\s*([a-zA-Z]+)\b/g, '$1 $2');  // "5mg" -> "5 mg"
            const americanToBritish = {
                sulfate: 'sulphate', sulfur: 'sulphur', anemia: 'anaemia', anemic: 'anaemic',
                anesthesia: 'anaesthesia', anesthetic: 'anaesthetic', cesarean: 'caesarean',
                cesarian: 'caesarean', edema: 'oedema', esophagus: 'oesophagus', estrogen: 'oestrogen',
                fetus: 'foetus', fetal: 'foetal', gynecology: 'gynaecology', gynecological: 'gynaecological',
                hemoglobin: 'haemoglobin', hemorrhage: 'haemorrhage', hemorrhagic: 'haemorrhagic',
                hemolytic: 'haemolytic', pediatric: 'paediatric', pediatrics: 'paediatrics', labor: 'labour',
                tumor: 'tumour', fiber: 'fibre', liter: 'litre', meter: 'metre', center: 'centre',
                color: 'colour', behavior: 'behaviour', leukemia: 'leukaemia', diarrhea: 'diarrhoea',
                maneuver: 'manoeuvre', orthopedic: 'orthopaedic'
            };
            for (const [american, british] of Object.entries(americanToBritish)) {
                cleaned = cleaned.replace(new RegExp(american, 'gi'), (match) =>
                    match[0] === match[0].toUpperCase() ? british.charAt(0).toUpperCase() + british.slice(1) : british);
            }
            return cleaned.replace(/\s+/g, ' ').trim();
        };

        // Build PHRASE-ONLY search variants, most specific first. We NEVER fall back to
        // scattered keyword matching (multiple separate words), which lands on a stray
        // word on the wrong page. The worst case here is a SHORTER contiguous phrase,
        // which still lands in the right passage/region.
        const buildPhraseVariants = function(raw) {
            const variants = [];
            const add = (q, desc) => {
                q = (q || '').trim();
                if (q.length >= 8 && !variants.some(v => v.query === q)) variants.push({ query: q, desc });
            };
            const collapsed = String(raw).replace(/\s+/g, ' ').trim();
            add(collapsed, 'exact verbatim');
            add(collapsed.replace(/^[\s•\-–—"'(]+/, '').replace(/[\s.,;:•]+$/, ''), 'trimmed');
            add(normaliseSearchTermForPdf(collapsed), 'normalised');
            const words = collapsed.split(' ').filter(Boolean);
            [16, 12, 9, 6].forEach(n => { if (words.length > n) add(words.slice(0, n).join(' '), 'first ' + n + ' words'); });
            if (words.length >= 12) {
                const start = Math.floor(words.length * 0.3);
                add(words.slice(start, start + 7).join(' '), 'middle phrase');
            }
            return variants;
        };

        // Run a SINGLE phrase search and resolve {found,total}. Detection is event-based
        // (the only reliable signal in this PDF.js build); a clear-step before each search
        // prevents a previous attempt's still-streaming counts from bleeding in.
        const runPhraseSearch = function(query) {
            return new Promise(function(resolve) {
                const app = window.PDFViewerApplication;
                const bus = app && app.eventBus;
                if (!bus) { resolve({ found: false, total: 0 }); return; }
                let maxTotal = 0, done = false, lastChange = 0;
                const onCount = (e) => { const t = e && e.matchesCount && e.matchesCount.total; if (typeof t === 'number' && t > maxTotal) { maxTotal = t; lastChange = Date.now(); } };
                // Only treat NOT_FOUND as terminal when nothing has been counted, so a
                // genuine miss resolves promptly without waiting out the hard cap.
                const onState = (e) => { if (e && e.state === 1 /* NOT_FOUND */ && maxTotal === 0) finish(); };
                const finish = function() {
                    if (done) return; done = true;
                    bus.off('updatefindmatchescount', onCount);
                    bus.off('updatefindcontrolstate', onState);
                    resolve({ found: maxTotal > 0, total: maxTotal });
                };
                bus.on('updatefindmatchescount', onCount);
                bus.on('updatefindcontrolstate', onState);
                // Clear any prior search (empty query) so stale counts can't bleed in.
                bus.dispatch('find', { source: window, type: '', query: '', caseSensitive: false, entireWord: false, highlightAll: true, findPrevious: false, matchDiacritics: false });
                setTimeout(function() {
                    // query as a STRING => phrase search (an Array would be multi-term/scattered).
                    bus.dispatch('find', { source: window, type: '', query: query, caseSensitive: false, entireWord: false, highlightAll: true, findPrevious: false, matchDiacritics: false });
                    // Wait for the search to actually COMPLETE rather than a fixed window:
                    // a fresh page must extract text from every page first, which can take
                    // several seconds for a long PDF. Resolve once counts stabilise, or on
                    // a hard cap. (NOT_FOUND resolves immediately via onState above.)
                    const t0 = Date.now();
                    const poll = setInterval(function() {
                        if (done) { clearInterval(poll); return; }
                        const now = Date.now();
                        if (maxTotal > 0 && now - lastChange > 500) { clearInterval(poll); finish(); }
                        else if (now - t0 > 8000) { clearInterval(poll); finish(); }
                    }, 150);
                }, 150);
            });
        };

        // Try each phrase variant in order; stop at the first that lands.
        // Guarded so the multiple ready-signals (pagesloaded / documentloaded / poll)
        // can't kick off competing searches — only the first to arrive runs.
        let searchStarted = false;
        const triggerSearch = async function() {
            if (searchStarted) return;
            searchStarted = true;
            console.log('[Clerky Auth] PDF ready, running phrase search…');
            if (!window.PDFViewerApplication || !window.PDFViewerApplication.eventBus) {
                console.warn('[Clerky Auth] PDFViewerApplication/eventBus not available for search');
                return;
            }
            const variants = buildPhraseVariants(searchTerm);
            console.log('[PDF Search] phrase variants:', variants.map(v => v.desc).join(', '));
            for (let i = 0; i < variants.length; i++) {
                const v = variants[i];
                console.log(`🔍 [PDF Search] ${i + 1}/${variants.length} (${v.desc}): "${v.query.substring(0, 80)}${v.query.length > 80 ? '…' : ''}"`);
                const r = await runPhraseSearch(v.query);
                if (r.found) {
                    console.log(`✅ [PDF Search] landed via ${v.desc} (${r.total} match${r.total > 1 ? 'es' : ''})`);
                    return;
                }
                console.log(`   ✗ no match: ${v.desc}`);
            }
            console.warn('❌ [PDF Search] no phrase variant matched — PDF opened at page 1');
        };

        // Wait specifically for the find controller to be available, then search.
        const waitForFindController = function(callback) {
            let polls = 0;
            const maxPolls = 40; // up to 8s
            const interval = setInterval(() => {
                polls++;
                if (window.PDFViewerApplication?.findController) {
                    console.log(`[Clerky Auth] Find controller ready after ${polls} polls`);
                    clearInterval(interval);
                    callback();
                } else if (polls >= maxPolls) {
                    console.error('[Clerky Auth] Find controller not available after 8s — attempting search anyway');
                    clearInterval(interval);
                    callback();
                }
            }, 200);
        };

        // Trigger once pages are loaded (event), with a polling fallback in case it's missed.
        document.addEventListener('pagesloaded', function(e) {
            console.log('[Clerky Auth] pagesloaded event fired');
            waitForFindController(triggerSearch);
        }, { once: true });

        // Backstop: fire as soon as PDF.js reports the document loaded, however late.
        // On a slow/cold first fetch the document can arrive after the polling cap below
        // would once have given up; this event has no time limit. waitForFindController →
        // triggerSearch is safe to reach from whichever path wins first.
        document.addEventListener('documentloaded', function() {
            console.log('[Clerky Auth] documentloaded event fired');
            waitForFindController(triggerSearch);
        }, { once: true });

        let pollCount = 0;
        const maxPolls = 120; // up to 60s — tolerate cold/slow first loads (e.g. Render cold start + cross-region fetch)
        const pollInterval = setInterval(() => {
            pollCount++;
            if (window.PDFViewerApplication && window.PDFViewerApplication.pdfDocument) {
                clearInterval(pollInterval);
                waitForFindController(triggerSearch);
            } else if (pollCount >= maxPolls) {
                console.error('[Clerky Auth] Gave up waiting for PDF to load (60s)');
                clearInterval(pollInterval);
            }
        }, 500);

        // Re-trigger after a successful PDF upload retry.
        document.addEventListener('clerky-retry-search', function(e) {
            console.log('[Clerky Auth] Re-triggering search after PDF retry');
            waitForFindController(triggerSearch);
        });
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
