/**
 * Streaming Engine and Summary Output
 * Handles ChatGPT-style streaming text reveal and summary updates
 */

// Module-level state for scrolling and debouncing
let scrollTimeout = null;
let pendingScrollTarget = null;

// ==================== STREAMING ENGINE ====================
// Modern ChatGPT-style streaming text reveal with intelligent pausing

export const streamingEngine = {
    queue: [],
    isStreaming: false,
    isPaused: false,
    currentStreamController: null,
    charDelay: 10, // milliseconds per character (very fast streaming)

    // Add content to the streaming queue
    enqueue(contentWrapper, shouldPause, onComplete, options = {}) {
        console.log('[STREAMING] Enqueuing content for streaming', {
            hasInteractive: shouldPause,
            queueLength: this.queue.length,
            options
        });

        this.queue.push({
            wrapper: contentWrapper,
            shouldPause,
            onComplete,
            options
        });

        // Start processing if not already streaming
        if (!this.isStreaming) {
            this.processQueue();
        }
    },

    // Process the streaming queue
    async processQueue() {
        if (this.queue.length === 0) {
            this.isStreaming = false;
            console.log('[STREAMING] Queue empty, streaming stopped');
            return;
        }

        if (this.isPaused) {
            console.log('[STREAMING] Streaming paused, waiting for resume');
            return;
        }

        this.isStreaming = true;
        const item = this.queue.shift();

        console.log('[STREAMING] Processing queue item', {
            shouldPause: item.shouldPause,
            remainingInQueue: this.queue.length,
            action: item.options?.action || 'streamIn'
        });

        if (item.options?.action === 'unstream') {
            await this.unstreamElement(item.wrapper, item.onComplete);
        } else if (item.options?.action === 'wait') {
            await this.delay(item.options.duration || 1000);
            if (item.onComplete) item.onComplete();
        } else {
            await this.streamElement(item.wrapper, item.shouldPause, item.options);
            if (item.onComplete) item.onComplete();
        }

        // Continue with next item unless paused
        if (!this.isPaused) {
            this.processQueue();
        }
    },

    // Stream removal of an element's content (reverse typing)
    async unstreamElement(wrapper, onComplete) {
        console.log('[STREAMING] ◄◄◄ Starting unstream of element');

        if (!wrapper || !wrapper.parentNode) {
            console.log('[STREAMING] Wrapper missing, skipping unstream');
            if (onComplete) onComplete();
            return;
        }

        // Get text content to unstream
        const textContent = wrapper.textContent || '';

        // Create streaming container
        const streamContainer = document.createElement('div');
        streamContainer.className = 'streaming-container';
        streamContainer.style.display = 'inline';

        // Create cursor
        const cursor = document.createElement('span');
        cursor.className = 'streaming-cursor';
        cursor.textContent = '▋';

        // Replace content with streaming setup
        wrapper.innerHTML = '';
        wrapper.appendChild(streamContainer);
        wrapper.appendChild(cursor);

        let currentText = textContent;
        streamContainer.textContent = currentText;

        // Unstream character by character
        while (currentText.length > 0) {
            if (this.isPaused) {
                wrapper.remove();
                break;
            }

            currentText = currentText.slice(0, -1);
            streamContainer.textContent = currentText;

            await this.delay(this.charDelay);
        }

        // Clean up
        cursor.remove();
        wrapper.remove();

        console.log('[STREAMING] Unstream complete');

        if (onComplete) onComplete();
    },

    // Stream a single element's content
    async streamElement(wrapper, shouldPauseAfter, options = {}) {
        console.log('[STREAMING] ►►► Starting stream of element', {
            willPauseAfter: shouldPauseAfter,
            timestamp: new Date().toISOString(),
            forceStream: options?.forceStream
        });

        // Show the wrapper immediately (override CSS display:none on .new-content-entry)
        wrapper.style.display = 'block';
        wrapper.style.opacity = '1';
        console.log('[STREAMING] Wrapper opacity set to 1 (visible)');

        // Extract all text content and HTML structure
        const originalHTML = wrapper.innerHTML;
        const textContent = wrapper.textContent || '';

        // Check for interactive elements first
        const interactiveElements = wrapper.querySelectorAll('button, select, input, textarea, [onclick]');
        const hasInteractiveElements = interactiveElements.length > 0;

        console.log('[STREAMING] Content analysis:', {
            textLength: textContent.length,
            hasInteractive: hasInteractiveElements,
            interactiveCount: interactiveElements.length,
            textPreview: textContent.substring(0, 200) + '...'
        });

        // OPTIMIZATION: Only stream short content character-by-character
        // For long content (>200 chars), show instantly to avoid delays
        const MAX_STREAM_LENGTH = 200;
        const shouldStreamFully = options.forceStream || (textContent.length <= MAX_STREAM_LENGTH && textContent.length >= 20);

        console.log('[STREAMING] Streaming decision:', {
            textLength: textContent.length,
            maxStreamLength: MAX_STREAM_LENGTH,
            shouldStreamFully,
            willShowInstantly: !options.forceStream && (textContent.length < 20 || textContent.length > MAX_STREAM_LENGTH)
        });

        if (!options.forceStream && (textContent.length < 20 || textContent.length > MAX_STREAM_LENGTH)) {
            console.log('[STREAMING] ⚡ INSTANT DISPLAY MODE', {
                reason: textContent.length < 20 ? 'too short' : 'too long for streaming',
                length: textContent.length
            });

            // Show interactive elements if present
            if (hasInteractiveElements && shouldPauseAfter) {
                console.log('[STREAMING] Has interactive elements, setting up pause...');
                // Small delay for visual effect
                await this.delay(100);

                const firstInteractive = interactiveElements[0];
                console.log('[STREAMING] Adding highlight to first interactive:', firstInteractive.tagName);
                firstInteractive.classList.add('streaming-paused-interactive');

                // Scroll to show the first interactive element (the buttons/controls)
                const summary1 = document.getElementById('summary1');
                if (summary1 && firstInteractive) {
                    requestAnimationFrame(() => {
                        const interactiveTop = firstInteractive.getBoundingClientRect().top;
                        const summary1Top = summary1.getBoundingClientRect().top;
                        const relativeTop = interactiveTop - summary1Top + summary1.scrollTop;
                        const targetScroll = Math.max(0, relativeTop - 100); // 100px buffer above
                        summary1.scrollTop = targetScroll;
                        console.log('[STREAMING] Scrolled to show interactive element');
                    });
                }

                // Pause streaming
                this.isPaused = true;
                console.log('[STREAMING] isPaused set to TRUE');

                // Set up auto-resume
                this.setupAutoResume(firstInteractive, interactiveElements);

                console.log('[STREAMING] ⏸️  PAUSED at interactive element (instant display mode)');
            } else {
                console.log('[STREAMING] No interactive pause needed');
            }
            console.log('[STREAMING] ✓✓ Instant display complete, returning');
            return;
        }

        // Stream short content with animation
        console.log('[STREAMING] Starting character-by-character streaming');

        // Hide interactive elements initially
        interactiveElements.forEach(el => {
            el.style.opacity = '0';
            el.style.transition = 'opacity 0.3s ease-in';
        });

        // Create a streaming container
        const streamContainer = document.createElement('div');
        streamContainer.className = 'streaming-container';
        streamContainer.style.display = 'inline';

        // Create cursor
        const cursor = document.createElement('span');
        cursor.className = 'streaming-cursor';
        cursor.textContent = '▋';

        // Clear wrapper and add streaming elements
        wrapper.innerHTML = '';
        wrapper.appendChild(streamContainer);
        wrapper.appendChild(cursor);

        // Stream the text content character by character
        let displayedText = '';

        for (let i = 0; i < textContent.length; i++) {
            if (this.isPaused) {
                // If paused, show remaining text instantly
                displayedText = textContent;
                break;
            }

            displayedText += textContent[i];
            streamContainer.textContent = displayedText;

            // Smooth scroll to keep cursor visible
            this.scrollToKeepVisible(cursor);

            await this.delay(this.charDelay);
        }

        // Remove cursor
        cursor.remove();

        // Restore original HTML to preserve formatting and structure
        wrapper.innerHTML = originalHTML;

        console.log('[STREAMING] Character streaming complete');

        console.log('[STREAMING] Text streaming complete, showing interactive elements');

        // Show interactive elements with fade-in
        if (hasInteractiveElements) {
            await this.delay(100); // Small delay before showing interactive elements

            const updatedInteractiveElements = wrapper.querySelectorAll('button, select, input, textarea, [onclick]');
            updatedInteractiveElements.forEach(el => {
                el.style.opacity = '1';
            });

            if (shouldPauseAfter) {
                console.log('[STREAMING] Interactive elements present, pausing for user interaction');

                // Highlight the first interactive element
                if (updatedInteractiveElements.length > 0) {
                    const firstInteractive = updatedInteractiveElements[0];
                    firstInteractive.classList.add('streaming-paused-interactive');

                    // Scroll to show the interactive element
                    const summary1 = document.getElementById('summary1');
                    if (summary1 && firstInteractive) {
                        requestAnimationFrame(() => {
                            const interactiveTop = firstInteractive.getBoundingClientRect().top;
                            const summary1Top = summary1.getBoundingClientRect().top;
                            const relativeTop = interactiveTop - summary1Top + summary1.scrollTop;
                            const targetScroll = Math.max(0, relativeTop - 100); // 100px buffer above
                            summary1.scrollTop = targetScroll;
                            console.log('[STREAMING] Scrolled to show interactive element after streaming');
                        });
                    }

                    // Pause streaming
                    this.isPaused = true;

                    // Set up auto-resume on any interaction
                    this.setupAutoResume(firstInteractive, updatedInteractiveElements);
                }
            }
        }

        console.log('[STREAMING] ✓✓✓ Element streaming FULLY COMPLETE');
    },

    // Check if an element is interactive (requires user decision)
    isInteractiveElement(element) {
        const tagName = element.tagName.toLowerCase();

        // Check for interactive tags
        if (['button', 'select', 'input', 'textarea'].includes(tagName)) {
            return true;
        }

        // Check for elements with click handlers or certain classes
        if (element.onclick ||
            element.getAttribute('onclick') ||
            element.classList.contains('btn') ||
            element.classList.contains('button') ||
            element.classList.contains('dropdown') ||
            element.querySelector('button, select, input')) {
            return true;
        }

        return false;
    },

    // Set up automatic resume when user interacts with any interactive element
    setupAutoResume(highlightedElement, allInteractiveElements) {
        const resumeHandler = (event) => {
            console.log('[STREAMING] User interaction detected, resuming stream');

            // Remove highlight from all elements
            allInteractiveElements.forEach(el => {
                el.classList.remove('streaming-paused-interactive');
            });

            // Resume streaming
            this.resume();

            // Remove listeners from all elements
            allInteractiveElements.forEach(el => {
                el.removeEventListener('click', resumeHandler);
                el.removeEventListener('change', resumeHandler);
            });
        };

        // Add listeners to all interactive elements
        allInteractiveElements.forEach(el => {
            el.addEventListener('click', resumeHandler, { once: true });
            el.addEventListener('change', resumeHandler, { once: true });
        });
    },

    // Scroll to keep the streaming cursor visible
    scrollToKeepVisible(cursor) {
        const summary1 = document.getElementById('summary1');
        if (!summary1 || !cursor.parentNode) return;

        const cursorRect = cursor.getBoundingClientRect();
        const containerRect = summary1.getBoundingClientRect();

        // Check if cursor is below viewport
        if (cursorRect.bottom > containerRect.bottom - 50) {
            const scrollAmount = cursorRect.bottom - containerRect.bottom + 50;
            summary1.scrollTop += scrollAmount;
        }
    },

    // Resume streaming after pause
    resume() {
        console.log('[STREAMING] Resuming streaming');
        this.isPaused = false;
        this.processQueue();
    },

    // Stop all streaming and clear queue
    stop() {
        console.log('[STREAMING] Stopping all streaming');
        this.queue = [];
        this.isStreaming = false;
        this.isPaused = false;

        if (this.currentStreamController) {
            this.currentStreamController.abort();
            this.currentStreamController = null;
        }
    },

    // Utility delay function
    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
};

// Utility: strip emoji/icon characters from text before rendering in summary1
function stripSummaryEmojis(text) {
    if (!text || typeof text !== 'string') return text;

    // Regex for common emojis and symbols often used in AI headers
    const emojiRegex = /[\u{1F300}-\u{1F9FF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F900}-\u{1F9FF}\u{1F1E0}-\u{1F1FF}]/gu;

    // Replace found emojis with empty string
    return text.replace(emojiRegex, '').trim();
}

// Function to append content to summary1
export function appendToSummary1(content, clearExisting = false, isTransient = false, options = {}) {
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('[SUMMARY1 DEBUG] appendToSummary1 called with:', {
        contentLength: content?.length,
        clearExisting,
        isTransient,
        options,
        timestamp: new Date().toISOString()
    });
    console.log('[SUMMARY1 DEBUG] Full content:', content);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    const summary1 = document.getElementById('summary1');
    if (!summary1) {
        console.error('[DEBUG] summary1 element not found');
        return;
    }

    try {
        // Clear existing content if requested
        if (clearExisting) {
            // Stop any active streaming
            streamingEngine.stop();

            summary1.innerHTML = '';
            // Reset scroll tracking when clearing content
            pendingScrollTarget = null;
            if (scrollTimeout) {
                clearTimeout(scrollTimeout);
                scrollTimeout = null;
            }
            // Re-add loading spinner container if it was cleared
            const loadingSpinner = document.getElementById('summaryLoadingSpinner');
            if (!loadingSpinner) {
                const spinnerDiv = document.createElement('div');
                spinnerDiv.id = 'summaryLoadingSpinner';
                spinnerDiv.className = 'summary-loading-spinner hidden';
                spinnerDiv.innerHTML = '<div class="spinner-circle"></div><span class="loading-text">Processing...</span>';
                summary1.appendChild(spinnerDiv);
            }
        }

        // Hide loading spinner when content is being added
        if (window.hideSummaryLoading) window.hideSummaryLoading();

        // Normalise content for summary1: strip emojis/icons so typography stays clean
        const sanitizedContent = typeof content === 'string' ? stripSummaryEmojis(content) : content;

        // Check if content is already HTML
        const isHtml = typeof sanitizedContent === 'string' && /<[a-z][\s\S]*>/i.test(sanitizedContent);
        console.log('[DEBUG] Content type check:', { isHtml });

        let processedContent;
        if (isHtml) {
            // If content is already HTML, use it directly
            processedContent = sanitizedContent;
        } else {
            // If content is markdown, parse it with marked
            if (!window.marked) {
                console.error('[DEBUG] Marked library not loaded');
                processedContent = sanitizedContent;
            } else {
                try {
                    processedContent = window.marked.parse(sanitizedContent);
                    console.log('[DEBUG] Marked parsing successful');
                } catch (parseError) {
                    console.error('[DEBUG] Error parsing with marked:', parseError);
                    processedContent = sanitizedContent;
                }
            }
        }

        // Create a temporary container to sanitize the content
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = processedContent;

        // Create a wrapper div for the new content
        const newContentWrapper = document.createElement('div');
        newContentWrapper.className = 'new-content-entry';
        if (isTransient) {
            newContentWrapper.setAttribute('data-transient', 'true');
            newContentWrapper.classList.add('transient-message');
        }
        newContentWrapper.innerHTML = tempDiv.innerHTML;

        // Append the sanitized content to DOM
        summary1.appendChild(newContentWrapper);
        console.log('[SUMMARY1 DEBUG] Content appended to DOM successfully', isTransient ? '(transient)' : '(permanent)');
        console.log('[SUMMARY1 DEBUG] Wrapper innerHTML:', newContentWrapper.innerHTML);
        console.log('[SUMMARY1 DEBUG] Wrapper textContent length:', newContentWrapper.textContent?.length);

        // STREAMING DECISION POINT
        if (options.streamEffect === 'in-out') {
            console.log('[SUMMARY1 DEBUG] ✓ STREAM TRANSIENT PATH - appearing and disappearing by stream');

            // Start hidden and collapsed
            newContentWrapper.style.opacity = '0';
            newContentWrapper.style.display = 'none'; // Hide from layout until streamed

            // 1. Stream In
            streamingEngine.enqueue(
                newContentWrapper,
                false,
                () => {
                    console.log('[SUMMARY1 DEBUG] Stream transient IN complete');
                    if (window.updateSummaryVisibility) window.updateSummaryVisibility();
                    if (window.updateSummaryCriticalStatus) window.updateSummaryCriticalStatus();
                },
                { forceStream: true, action: 'streamIn' }
            );

            // 2. Wait
            streamingEngine.enqueue(
                null,
                false,
                null,
                { action: 'wait', duration: options.transientDelay || 5000 }
            );

            // 3. Stream Out
            streamingEngine.enqueue(
                newContentWrapper,
                false,
                () => {
                    // On removal complete
                    console.log('[SUMMARY1 DEBUG] Stream transient removal complete');
                    if (window.updateSummaryVisibility) window.updateSummaryVisibility();
                    if (window.updateSummaryCriticalStatus) window.updateSummaryCriticalStatus();
                },
                { action: 'unstream' }
            );

        } else if (isTransient) {
            // Transient messages: show instantly, no streaming, auto-remove after delay
            console.log('[SUMMARY1 DEBUG] ✓ TRANSIENT PATH - showing instantly, will auto-remove after 5s');
            newContentWrapper.style.display = 'block'; // Override CSS display:none on .new-content-entry
            newContentWrapper.style.opacity = '1';

            // Auto-remove transient messages after 5 seconds
            setTimeout(() => {
                if (newContentWrapper.parentNode) {
                    console.log('[SUMMARY1 DEBUG] Auto-removing transient message');
                    newContentWrapper.style.transition = 'opacity 0.5s ease-out, max-height 0.5s ease-out';
                    newContentWrapper.style.opacity = '0';
                    newContentWrapper.style.maxHeight = '0';
                    newContentWrapper.style.overflow = 'hidden';

                    setTimeout(() => {
                        if (newContentWrapper.parentNode) {
                            newContentWrapper.remove();
                        }
                    }, 500);
                }
            }, 5000);

            // Don't scroll for transient messages - they're temporary
            console.log('[SUMMARY1 DEBUG] Transient content shown (no scroll)');
        } else {
            // Permanent content: use streaming engine
            console.log('[SUMMARY1 DEBUG] ✓ PERMANENT PATH - queueing for streaming');

            // Check if content has interactive elements
            const hasInteractive = streamingEngine.isInteractiveElement(newContentWrapper) ||
                newContentWrapper.querySelector('button, select, input, textarea, [onclick]');

            const interactiveElements = newContentWrapper.querySelectorAll('button, select, input, textarea, [onclick]');
            console.log('[SUMMARY1 DEBUG] Interactive elements check:', {
                hasInteractive,
                elementCount: interactiveElements.length,
                elementTypes: Array.from(interactiveElements).map(el => el.tagName)
            });

            // Enqueue for streaming
            console.log('[SUMMARY1 DEBUG] Enqueueing content to streaming engine...');
            streamingEngine.enqueue(
                newContentWrapper,
                hasInteractive, // Should pause after streaming if interactive
                () => {
                    // On completion callback
                    console.log('[SUMMARY1 DEBUG] ✓✓✓ Streaming COMPLETE for this content block');
                    if (window.updateSummaryVisibility) window.updateSummaryVisibility();
                    if (window.updateSummaryCriticalStatus) window.updateSummaryCriticalStatus();
                }
            );
        }

        // Update summary visibility for transient messages
        if (isTransient) {
            setTimeout(() => {
                if (window.updateSummaryVisibility) window.updateSummaryVisibility();
                if (window.updateSummaryCriticalStatus) window.updateSummaryCriticalStatus();
            }, 100);
        }

    } catch (error) {
        console.error('[DEBUG] Error in appendToSummary1:', error);
        // Fallback to direct content append if something goes wrong
        summary1.innerHTML += content;
        // Update visibility even on error
        setTimeout(() => {
            if (window.updateSummaryVisibility) window.updateSummaryVisibility();
            if (window.updateSummaryCriticalStatus) window.updateSummaryCriticalStatus();
        }, 100);
    }
}
