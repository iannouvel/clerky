// Import Firebase instances from firebase-init.js
import { app, db, auth } from './firebase-init.js';
import { GoogleAuthProvider, signInWithPopup, onAuthStateChanged, signOut, signInWithRedirect, getRedirectResult } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import { getAnalytics } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-analytics.js';
import { doc, getDoc, setDoc } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

// Global variable to store relevant guidelines
let relevantGuidelines = null;

// Function to display relevant guidelines in the summary
function displayRelevantGuidelines(categories) {
    if (!categories || typeof categories !== 'object') {
        console.error('[DEBUG] Invalid categories data:', categories);
        return;
    }

    // Helper function to extract numeric relevance score from descriptive format
    function extractRelevanceScore(relevanceText) {
        if (typeof relevanceText === 'number') {
            return relevanceText; // Already numeric
        }
        
        // Extract score from formats like "high relevance (score 0.8-1.0)" or "0.85"
        const match = relevanceText.match(/score\s+([\d.]+)(?:-[\d.]+)?|^([\d.]+)$/);
        if (match) {
            return parseFloat(match[1] || match[2]);
        }
        
        // Fallback based on text description
        const text = relevanceText.toLowerCase();
        if (text.includes('high') || text.includes('most')) return 0.9;
        if (text.includes('medium') || text.includes('potentially')) return 0.65;
        if (text.includes('low') || text.includes('less')) return 0.35;
        if (text.includes('not') || text.includes('irrelevant')) return 0.1;
        
        return 0.5; // Default fallback
    }

    // Store ALL relevant guidelines (exclude notRelevant) globally
    const allRelevantGuidelines = [
        ...(categories.mostRelevant || []).map(g => ({...g, category: 'mostRelevant'})),
        ...(categories.potentiallyRelevant || []).map(g => ({...g, category: 'potentiallyRelevant'})),
        ...(categories.lessRelevant || []).map(g => ({...g, category: 'lessRelevant'}))
        // Exclude notRelevant as they're truly not applicable for checking
    ];

    window.relevantGuidelines = allRelevantGuidelines.map(g => ({
        id: g.id, // Use clean document ID only
        title: g.title,
        filename: g.title, // Add filename property that some code may expect
        relevance: extractRelevanceScore(g.relevance), // Convert to numeric score
        category: g.category,
        originalRelevance: g.relevance // Keep original for display purposes
    }));

    // Enhanced logging to verify storage
    console.log('[DEBUG] Stored relevant guidelines:', {
        total: window.relevantGuidelines.length,
        byCategory: {
            mostRelevant: window.relevantGuidelines.filter(g => g.category === 'mostRelevant').length,
            potentiallyRelevant: window.relevantGuidelines.filter(g => g.category === 'potentiallyRelevant').length,
            lessRelevant: window.relevantGuidelines.filter(g => g.category === 'lessRelevant').length
        },
        samples: window.relevantGuidelines.slice(0, 3).map(g => ({
            id: g.id, // Use the mapped 'id' property
            title: g.title.substring(0, 50) + '...',
            score: g.relevance,
            category: g.category
        }))
    });

    let formattedGuidelines = '';

    // Helper function to create PDF download link
    function createPdfDownloadLink(guideline) {
        if (!guideline) {
            console.warn('[DEBUG] No guideline provided to createPdfDownloadLink');
            return '';
        }

        // Use the downloadUrl field if available, otherwise fall back to constructing from filename
        let downloadUrl;
        if (guideline.downloadUrl) {
            downloadUrl = guideline.downloadUrl;
            console.log('[DEBUG] Using stored downloadUrl:', downloadUrl);
        } else if (guideline.filename) {
            // Fallback: construct URL from filename (with proper encoding)
            const encodedFilename = encodeURIComponent(guideline.filename);
            downloadUrl = `https://github.com/iannouvel/clerky/raw/main/guidance/${encodedFilename}`;
            console.log('[DEBUG] Constructed downloadUrl from filename:', downloadUrl);
        } else {
            console.warn('[DEBUG] No downloadUrl or filename available for guideline:', guideline);
            return '';
        }
        
        console.log('[DEBUG] Created PDF download link:', {
            guidelineId: guideline.id,
            guidelineTitle: guideline.title,
            downloadUrl: downloadUrl
        });
        
        return `<a href="${downloadUrl}" target="_blank" title="Download PDF" class="pdf-download-link">📄</a>`;
    }

    // Generate HTML instead of markdown to properly handle the PDF links
    let htmlContent = '';

    // Add Most Relevant Guidelines
    if (categories.mostRelevant && categories.mostRelevant.length > 0) {
        htmlContent += '<h2>Most Relevant Guidelines</h2><ul>';
        categories.mostRelevant.forEach(g => {
            const pdfLink = createPdfDownloadLink(g);
            htmlContent += `<li>${g.title} (${g.relevance}) ${pdfLink}</li>`;
        });
        htmlContent += '</ul>';
    }

    // Add Potentially Relevant Guidelines
    if (categories.potentiallyRelevant && categories.potentiallyRelevant.length > 0) {
        htmlContent += '<h2>Potentially Relevant Guidelines</h2><ul>';
        categories.potentiallyRelevant.forEach(g => {
            const pdfLink = createPdfDownloadLink(g);
            htmlContent += `<li>${g.title} (${g.relevance}) ${pdfLink}</li>`;
        });
        htmlContent += '</ul>';
    }

    // Add Less Relevant Guidelines
    if (categories.lessRelevant && categories.lessRelevant.length > 0) {
        htmlContent += '<h2>Less Relevant Guidelines</h2><ul>';
        categories.lessRelevant.forEach(g => {
            const pdfLink = createPdfDownloadLink(g);
            htmlContent += `<li>${g.title} (${g.relevance}) ${pdfLink}</li>`;
        });
        htmlContent += '</ul>';
    }

    // Add Not Relevant Guidelines
    if (categories.notRelevant && categories.notRelevant.length > 0) {
        htmlContent += '<h2>Not Relevant Guidelines</h2><ul>';
        categories.notRelevant.forEach(g => {
            const pdfLink = createPdfDownloadLink(g);
            htmlContent += `<li>${g.title} (${g.relevance}) ${pdfLink}</li>`;
        });
        htmlContent += '</ul>';
    }

    formattedGuidelines = htmlContent;

    appendToSummary1(formattedGuidelines);
}

function createGuidelineElement(guideline) {
    const div = document.createElement('div');
    div.className = 'guideline-item';
    div.innerHTML = `
                            <h4>${guideline.humanFriendlyTitle || guideline.title}</h4>
        <p>Relevance: ${(guideline.relevance * 100).toFixed(1)}%</p>
        <button onclick="checkAgainstGuidelines('${guideline.id}')">Check Against This Guideline</button>
    `;
    return div;
}

// Application state flags
let isInitialized = false;
let clinicalIssuesLoaded = false;
let guidanceDataLoaded = false;

// Clinical data storage
let clinicalIssues = {
    obstetrics: [],
    gynecology: []
};
let AIGeneratedListOfIssues = [];
let guidelinesForEachIssue = [];

// File and content storage
let filenames = [];
let summaries = [];

// Global data storage
let globalGuidelines = null;
let globalPrompts = null;

// Chat History State
let chatHistory = [];
let currentChatId = null;

// Add session management
let currentSessionId = null;

// Global variables for dynamic advice
let currentAdviceSession = null;
let currentSuggestions = [];
let userDecisions = {};

// Initialize marked library
function initializeMarked() {
    console.log('Starting marked library initialization...');
    return new Promise((resolve, reject) => {
        if (window.marked) {
            console.log('Marked library already loaded');
            resolve();
            return;
        }

        console.log('Creating marked script element...');
        const markedScript = document.createElement('script');
        markedScript.src = 'https://cdn.jsdelivr.net/npm/marked/marked.min.js';
        markedScript.onload = function() {
            console.log('Marked script loaded successfully');
            window.marked = marked;
            console.log('Marked library initialized');
            resolve();
        };
        markedScript.onerror = function(error) {
            console.error('Error loading marked library:', error);
            reject(error);
        };
        console.log('Appending marked script to document head...');
        document.head.appendChild(markedScript);
    });
}

// Make loadClinicalIssues available globally
window.loadClinicalIssues = async function() {
    console.log('Starting loadClinicalIssues...');
    if (clinicalIssuesLoaded) {
        console.log('Clinical issues already loaded');
        return;
    }

    try {
        console.log('Fetching clinical_issues.json...');
        const response = await fetch('clinical_issues.json');
        console.log('Fetch response status:', response.status);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        console.log('Parsing JSON response...');
        const data = await response.json();
        console.log('Clinical issues data loaded:', data);
        clinicalIssues = data;
        clinicalIssuesLoaded = true;
        console.log('Clinical issues loaded successfully');
    } catch (error) {
        console.error('Error loading clinical issues:', error);
        throw error;
    }
};

// Show main content
function showMainContent() {
    console.log('Starting showMainContent...');
    const loading = document.getElementById('loading');
    const landingPage = document.getElementById('landingPage');
    const mainContent = document.getElementById('mainContent');

    console.log('Elements found:', {
        loading: !!loading,
        landingPage: !!landingPage,
        mainContent: !!mainContent
    });

    if (loading) {
        console.log('Hiding loading screen...');
        loading.classList.add('hidden');
    }
    if (landingPage) {
        console.log('Hiding landing page...');
        landingPage.classList.add('hidden');
    }
    if (mainContent) {
        console.log('Showing main content...');
        mainContent.classList.remove('hidden');
    }
}

// Update loadGuidelinesFromFirestore to load from Firestore
async function getGitHubGuidelinesCount() {
    try {
        console.log('[DEBUG] Getting GitHub guidelines count...');
        
        const user = auth.currentUser;
        if (!user) {
            throw new Error('User not authenticated');
        }
        const idToken = await user.getIdToken();

        const response = await fetch(`${window.SERVER_URL}/getGuidelinesList`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${idToken}`
            }
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const guidelinesString = await response.text();
        const guidelinesList = guidelinesString.split('\n').filter(line => line.trim());
        console.log('[DEBUG] GitHub guidelines count:', guidelinesList.length);
        return guidelinesList.length;
    } catch (error) {
        console.error('[DEBUG] Error getting GitHub guidelines count:', error);
        return null; // Return null on error to avoid triggering sync
    }
}

async function loadGuidelinesFromFirestore() {
    try {
        console.log('[DEBUG] Loading guidelines from Firestore...');
        
        // Get user ID token using the imported auth object
        const user = auth.currentUser;
        if (!user) {
            throw new Error('User not authenticated');
        }
        const idToken = await user.getIdToken();

        // Fetch guidelines from Firestore
        const response = await fetch(`${window.SERVER_URL}/getAllGuidelines`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${idToken}`
            }
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const result = await response.json();
        if (!result.success || !result.guidelines) {
            throw new Error('Invalid response format from server');
        }

        const guidelines = result.guidelines;
        const firestoreCount = guidelines.length;
        console.log('[DEBUG] Loaded guidelines from Firestore:', firestoreCount);

        // Check if we need to sync more guidelines from GitHub
        const githubCount = await getGitHubGuidelinesCount();
        if (githubCount !== null && githubCount > firestoreCount) {
            console.log(`[DEBUG] GitHub has ${githubCount} guidelines but Firestore only has ${firestoreCount}. Triggering sync...`);
            
            try {
                const syncResponse = await fetch(`${window.SERVER_URL}/syncGuidelinesWithMetadata`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${idToken}`
                    },
                    body: JSON.stringify({})
                });

                if (syncResponse.ok) {
                    const syncResult = await syncResponse.json();
                    console.log('[DEBUG] Sync completed successfully:', syncResult);
                    
                    // Reload guidelines after sync
                    const updatedResponse = await fetch(`${window.SERVER_URL}/getAllGuidelines`, {
                        method: 'GET',
                        headers: {
                            'Authorization': `Bearer ${idToken}`
                        }
                    });
                    
                    if (updatedResponse.ok) {
                        const updatedResult = await updatedResponse.json();
                        if (updatedResult.success && updatedResult.guidelines) {
                            const updatedGuidelines = updatedResult.guidelines;
                            console.log('[DEBUG] Reloaded guidelines after sync:', updatedGuidelines.length);
                            
                            // Use the updated guidelines
                            guidelines.length = 0; // Clear the array
                            guidelines.push(...updatedGuidelines); // Add updated guidelines
                        }
                    }
                } else {
                    const syncError = await syncResponse.text();
                    console.warn('[DEBUG] Sync failed:', syncError);
                }
            } catch (syncError) {
                console.warn('[DEBUG] Sync error:', syncError);
            }
        } else if (githubCount !== null) {
            console.log(`[DEBUG] Guidelines count is up to date: GitHub=${githubCount}, Firestore=${firestoreCount}`);
        }

        // Store in global variables using document ID as key
        window.guidelinesList = guidelines.map(g => ({
            id: g.id,
            title: g.title
        }));
        window.guidelinesSummaries = guidelines.map(g => g.summary);
        window.guidelinesKeywords = guidelines.map(g => g.keywords);
        window.guidelinesCondensed = guidelines.map(g => g.condensed);

        // Store full guideline data using document ID as key
        window.globalGuidelines = guidelines.reduce((acc, g) => {
            acc[g.id] = {
                id: g.id,
                title: g.title,
                content: g.content,
                summary: g.summary,
                keywords: g.keywords,
                condensed: g.condensed
            };
            return acc;
        }, {});

        console.log('[DEBUG] Guidelines loaded and stored in global variables');
        return guidelines;
    } catch (error) {
        console.error('[DEBUG] Error loading guidelines from Firestore:', error);
        throw error;
    }
}

// Make loadGuidelinesFromFirestore available globally
window.loadGuidelinesFromFirestore = loadGuidelinesFromFirestore;

// Function to show error messages
function showError(message) {
    alert(message);
    console.error('Error:', message);
}

async function findRelevantGuidelines(suppressHeader = false) {
    const findGuidelinesBtn = document.getElementById('findGuidelinesBtn');
    const originalText = findGuidelinesBtn.textContent;
    
    try {
        const transcript = document.getElementById('userInput').value;
        if (!transcript) {
            alert('Please enter some text first');
            return;
        }

        // Set loading state
        findGuidelinesBtn.classList.add('loading');
        findGuidelinesBtn.disabled = true;

        // Initialize the guideline search summary (unless called from process workflow)
        if (!suppressHeader) {
            let searchProgress = '## Finding Relevant Guidelines\n\n';
            appendToSummary1(searchProgress);
        }

        // Get user ID token
        const user = auth.currentUser;
        if (!user) {
            alert('Please sign in to use this feature');
            return;
        }
        const idToken = await user.getIdToken();

        // Update progress
        const loadingMessage = 'Loading guidelines from database...\n';
        appendToSummary1(loadingMessage, false);

        // Get guidelines and summaries from Firestore
        const guidelines = await loadGuidelinesFromFirestore();
        
        // Format guidelines with comprehensive information for better relevancy matching
        const guidelinesList = guidelines.map(g => ({
            id: g.id,
            title: g.title,
            summary: g.summary,
            condensed: g.condensed,
            keywords: g.keywords
        }));

        // Update progress with guideline count
        const analyzeMessage = `Analysing transcript against ${guidelinesList.length} available guidelines...\n`;
        appendToSummary1(analyzeMessage, false);

        console.log('[DEBUG] Sending request to /findRelevantGuidelines with:', {
            transcriptLength: transcript.length,
            guidelinesCount: guidelinesList.length
        });

        const response = await fetch(`${window.SERVER_URL}/findRelevantGuidelines`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${idToken}`
            },
            body: JSON.stringify({
                transcript,
                guidelines: guidelinesList
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('[DEBUG] Server error response:', {
                status: response.status,
                statusText: response.statusText,
                errorText
            });
            throw new Error(`Server error: ${response.status} - ${errorText}`);
        }

        const data = await response.json();
        if (!data.success) {
            throw new Error(data.error || 'Failed to find relevant guidelines');
        }

        // Update progress with completion
        const completionMessage = 'Analysis complete! Categorising relevant guidelines...\n\n';
        appendToSummary1(completionMessage, false);

        // Process and display the results
        displayRelevantGuidelines(data.categories);

        // Add final summary
        const totalRelevant = (data.categories.mostRelevant?.length || 0) + 
                            (data.categories.potentiallyRelevant?.length || 0) + 
                            (data.categories.lessRelevant?.length || 0);
        
        const summaryMessage = `## Summary\n\nFound ${totalRelevant} relevant guidelines out of ${guidelinesList.length} total guidelines.\n\n` +
                              `**Most Relevant:** ${data.categories.mostRelevant?.length || 0} guidelines\n` +
                              `**Potentially Relevant:** ${data.categories.potentiallyRelevant?.length || 0} guidelines\n` +
                              `**Less Relevant:** ${data.categories.lessRelevant?.length || 0} guidelines\n\n` +
                              `💡 **Tip:** Click on the 📄 PDF links next to any guideline to download the full document.\n\n` +
                              `Guidelines are now ready for analysis. Use "Check against guidelines" to proceed.\n`;
        
        appendToSummary1(summaryMessage, false);
    } catch (error) {
        console.error('[DEBUG] Error in findRelevantGuidelines:', {
            error: error.message,
            stack: error.stack
        });
        
        // Display error in summary1
        const errorMessage = `\n❌ **Error finding relevant guidelines:** ${error.message}\n\nPlease try again or contact support if the problem persists.\n`;
        appendToSummary1(errorMessage, false);
        
        alert('Error finding relevant guidelines: ' + error.message);
    } finally {
        // Reset button state
        findGuidelinesBtn.classList.remove('loading');
        findGuidelinesBtn.textContent = originalText;
        findGuidelinesBtn.disabled = false;
    }
}

// Function to generate clinical note
async function generateClinicalNote() {
    console.log('[DEBUG] Starting generateClinicalNote function');
    const button = document.getElementById('generateClinicalNoteBtn');
    const originalText = button.textContent;
    button.textContent = 'Generating...';
    button.disabled = true;

    try {
        // Get the transcript content from either summary1 or userInput
        let transcript = document.getElementById('summary1')?.textContent;
        const userInput = document.getElementById('userInput')?.value;
        
        console.log('[DEBUG] Checking transcript sources:', {
            summary1Length: transcript?.length,
            userInputLength: userInput?.length,
            summary1Preview: transcript?.substring(0, 100) + '...',
            userInputPreview: userInput?.substring(0, 100) + '...'
        });

        // Use userInput if summary1 is empty
        if ((!transcript || transcript.trim() === '') && userInput && userInput.trim() !== '') {
            console.log('[DEBUG] Using content from userInput field');
            transcript = userInput;
        }

        if (!transcript || transcript.trim() === '') {
            console.error('[DEBUG] No transcript content found in either source');
            throw new Error('No transcript found or transcript is empty');
        }

        // Get the current user using imported auth object
        const user = auth.currentUser;
        if (!user) {
            console.error('[DEBUG] No authenticated user found');
            throw new Error('User not authenticated');
        }
        console.log('[DEBUG] User authenticated:', {
            email: user.email,
            uid: user.uid
        });

        // Get ID token for authentication
        const idToken = await user.getIdToken();
        console.log('[DEBUG] Got ID token');

        console.log('[DEBUG] Sending request to server...');
        const response = await fetch(`${window.SERVER_URL}/generateClinicalNote`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${idToken}`
            },
            body: JSON.stringify({ transcript })
        });

        console.log('[DEBUG] Server response status:', response.status);
        if (!response.ok) {
            const errorText = await response.text();
            console.error('[DEBUG] Server response error:', {
                status: response.status,
                errorText
            });
            throw new Error(`Failed to generate clinical note: ${response.status} ${errorText}`);
        }

        const data = await response.json();
        console.log('[DEBUG] Server response data:', {
            success: data.success,
            noteLength: data.note?.length
        });

        if (!data.success || !data.note) {
            console.error('[DEBUG] Invalid response format:', data);
            throw new Error('Invalid response format from server');
        }

        // Append the generated note to summary1
        console.log('[DEBUG] Appending note to summary1');
        appendToSummary1(marked.parse(data.note), true);
        console.log('[DEBUG] Note appended successfully');

    } catch (error) {
        console.error('[DEBUG] Error in generateClinicalNote:', {
            error: error.message,
            stack: error.stack
        });
        alert(`Error generating clinical note: ${error.message}`);
    } finally {
        // Reset button state
        button.textContent = originalText;
        button.disabled = false;
        console.log('[DEBUG] generateClinicalNote function completed');
    }
}

// Function to append content to summary1
// Debounced scrolling to handle rapid successive content additions
let scrollTimeout = null;
let pendingScrollTarget = null;

function appendToSummary1(content, clearExisting = false) {
    console.log('[DEBUG] appendToSummary1 called with:', {
        contentLength: content?.length,
        clearExisting,
        contentPreview: content?.substring(0, 100) + '...'
    });

    const summary1 = document.getElementById('summary1');
    if (!summary1) {
        console.error('[DEBUG] summary1 element not found');
        return;
    }

    try {
        // Store the initial scroll position if not clearing existing content
        const initialScrollTop = clearExisting ? 0 : summary1.scrollTop;
        const initialScrollHeight = clearExisting ? 0 : summary1.scrollHeight;

        // Clear existing content if requested
        if (clearExisting) {
            summary1.innerHTML = '';
            // Reset scroll tracking when clearing content
            pendingScrollTarget = null;
            if (scrollTimeout) {
                clearTimeout(scrollTimeout);
                scrollTimeout = null;
            }
        }

        // Check if content is already HTML
        const isHtml = /<[a-z][\s\S]*>/i.test(content);
        console.log('[DEBUG] Content type check:', { isHtml });

        let processedContent;
        if (isHtml) {
            // If content is already HTML, use it directly
            processedContent = content;
        } else {
            // If content is markdown, parse it with marked
            if (!window.marked) {
                console.error('[DEBUG] Marked library not loaded');
                processedContent = content;
            } else {
                try {
                    processedContent = window.marked.parse(content);
                    console.log('[DEBUG] Marked parsing successful');
                } catch (parseError) {
                    console.error('[DEBUG] Error parsing with marked:', parseError);
                    processedContent = content;
                }
            }
        }

        // Create a temporary container to sanitize the content
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = processedContent;

        // Create a wrapper div for the new content to help with scrolling
        const newContentWrapper = document.createElement('div');
        newContentWrapper.className = 'new-content-entry';
        newContentWrapper.innerHTML = tempDiv.innerHTML;

        // Append the sanitized content
        summary1.appendChild(newContentWrapper);
        console.log('[DEBUG] Content appended successfully');

        // Store the first new content element for scrolling (if we don't have one yet)
        if (!pendingScrollTarget || clearExisting) {
            pendingScrollTarget = newContentWrapper;
            console.log('[DEBUG] Set new scroll target');
        }

        // Clear any existing scroll timeout
        if (scrollTimeout) {
            clearTimeout(scrollTimeout);
        }

        // Set up debounced scrolling - only scroll after content additions have stopped for 300ms
        scrollTimeout = setTimeout(() => {
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    try {
                        // If clearing existing content, scroll to top
                        if (clearExisting) {
                            summary1.scrollTop = 0;
                            console.log('[DEBUG] Scrolled to top (cleared existing content)');
                        } else if (pendingScrollTarget) {
                            // Calculate the scroll position to show the top of the first new content
                            const newContentOffsetTop = pendingScrollTarget.offsetTop;
                            const containerHeight = summary1.clientHeight;
                            
                            // Position the scroll so the top of the new content is visible
                            // Add a small buffer (20px) to ensure it's clearly visible
                            const targetScrollTop = Math.max(0, newContentOffsetTop - 20);
                            
                            summary1.scrollTop = targetScrollTop;
                            
                            console.log('[DEBUG] Debounced scroll to show top of first new content:', {
                                newContentOffsetTop,
                                containerHeight,
                                targetScrollTop,
                                finalScrollTop: summary1.scrollTop,
                                summary1ScrollHeight: summary1.scrollHeight
                            });
                        }

                        // Reset the scroll target after scrolling
                        pendingScrollTarget = null;
                        scrollTimeout = null;

                    } catch (scrollError) {
                        console.error('[DEBUG] Error in debounced scroll:', scrollError);
                        // Simple fallback
                        try {
                            if (!clearExisting && pendingScrollTarget) {
                                const maxScroll = summary1.scrollHeight - summary1.clientHeight;
                                const newContentHeight = pendingScrollTarget.offsetHeight;
                                const targetScroll = Math.max(0, maxScroll - newContentHeight - 50);
                                summary1.scrollTop = targetScroll;
                                console.log('[DEBUG] Fallback scroll completed');
                            }
                        } catch (fallbackError) {
                            console.error('[DEBUG] Fallback scroll also failed:', fallbackError);
                        }
                        
                        // Reset tracking even if scroll failed
                        pendingScrollTarget = null;
                        scrollTimeout = null;
                    }
                });
            });
        }, 300); // Wait 300ms after the last content addition before scrolling

    } catch (error) {
        console.error('[DEBUG] Error in appendToSummary1:', error);
        // Fallback to direct content append if something goes wrong
        summary1.innerHTML += content;
    }
}

// Update checkAgainstGuidelines to use stored relevant guidelines
async function checkAgainstGuidelines(suppressHeader = false) {
    const checkGuidelinesBtn = document.getElementById('checkGuidelinesBtn');
    const originalText = checkGuidelinesBtn.textContent;
    
    try {
        console.log('[DEBUG] Starting checkAgainstGuidelines...');
        
        const transcript = document.getElementById('userInput').value;
        if (!transcript) {
            console.log('[DEBUG] No transcript found in userInput');
            alert('Please enter some text first');
            return;
        }
        console.log('[DEBUG] Transcript length:', transcript.length);

        if (!window.relevantGuidelines || window.relevantGuidelines.length === 0) {
            console.log('[DEBUG] No relevant guidelines found in window.relevantGuidelines');
            console.log('[DEBUG] window.relevantGuidelines:', window.relevantGuidelines);
            alert('Please find relevant guidelines first');
            return;
        }
        console.log('[DEBUG] Number of relevant guidelines:', window.relevantGuidelines.length);

        // Set loading state
        checkGuidelinesBtn.classList.add('loading');
        checkGuidelinesBtn.disabled = true;

        // Get user ID token
        const user = auth.currentUser;
        if (!user) {
            console.log('[DEBUG] No authenticated user found');
            alert('Please sign in to use this feature');
            return;
        }
        console.log('[DEBUG] User authenticated:', { email: user.email, uid: user.uid });
        
        const idToken = await user.getIdToken();
        console.log('[DEBUG] Got ID token');

        // Check if guidelines are loaded in cache
        console.log('[DEBUG] Checking guideline cache status:', {
            hasGlobalGuidelines: !!window.globalGuidelines,
            cacheSize: window.globalGuidelines ? Object.keys(window.globalGuidelines).length : 0,
            cacheKeys: window.globalGuidelines ? Object.keys(window.globalGuidelines) : []
        });

        // Reload guidelines from Firestore to ensure we have the latest data
        try {
            console.log('[DEBUG] Reloading guidelines from Firestore...');
            const guidelines = await window.loadGuidelinesFromFirestore();
            console.log('[DEBUG] Reloaded guidelines from Firestore:', {
                success: !!guidelines,
                count: guidelines?.length || 0
            });
        } catch (error) {
            console.error('[DEBUG] Failed to reload guidelines:', error);
            throw new Error('Failed to load guidelines from Firestore');
        }

        // Initialize the analysis summary (unless called from process workflow)
        let formattedAnalysis = '';
        if (!suppressHeader) {
            formattedAnalysis = '## Analysis Against Guidelines\n\n';
            appendToSummary1(formattedAnalysis);
        }
        
        let successCount = 0;
        let errorCount = 0;

        // Helper function to find guideline by multiple matching criteria
        function findGuidelineInCache(targetGuideline) {
            // Method 1: Direct key lookup (original method)
            let found = window.globalGuidelines[targetGuideline.id];
            if (found) {
                console.log(`[DEBUG] Found guideline by direct ID: ${targetGuideline.id}`);
                return found;
            }

            // Method 2: Search by filename match
            const guidelines = Object.values(window.globalGuidelines);
            found = guidelines.find(g => 
                g.filename === targetGuideline.id || 
                (g.title && g.title === targetGuideline.id)
            );
            if (found) {
                console.log(`[DEBUG] Found guideline by filename match: ${targetGuideline.id} -> ${found.id}`);
                return found;
            }

            // Method 3: Search by title similarity
            const targetTitle = targetGuideline.humanFriendlyTitle || targetGuideline.title || targetGuideline.id;
            if (targetTitle && targetTitle.length > 5) {
                found = guidelines.find(g => {
                    if (!g.title) return false;
                    
                    // Normalize titles for comparison
                    const normalizeTitle = (title) => title.toLowerCase()
                        .replace(/[^a-z0-9\s]/g, ' ')
                        .replace(/\s+/g, ' ')
                        .trim();
                    
                    const normalizedTarget = normalizeTitle(targetTitle);
                    const normalizedGuideline = normalizeTitle(g.title);
                    
                    // Check for exact match first
                    if (normalizedTarget === normalizedGuideline) return true;
                    
                    // Check for substantial overlap (80% match)
                    const targetWords = normalizedTarget.split(' ').filter(w => w.length > 2);
                    const guidelineWords = normalizedGuideline.split(' ').filter(w => w.length > 2);
                    
                    if (targetWords.length === 0 || guidelineWords.length === 0) return false;
                    
                    const matchedWords = targetWords.filter(word => 
                        guidelineWords.some(gWord => gWord.includes(word) || word.includes(gWord))
                    );
                    
                    const similarity = matchedWords.length / Math.max(targetWords.length, guidelineWords.length);
                    return similarity >= 0.6; // 60% word overlap threshold
                });
                
                if (found) {
                    console.log(`[DEBUG] Found guideline by title similarity: "${targetTitle}" -> "${found.title}" (${found.id})`);
                    return found;
                }
            }

            // Method 4: Search by partial filename match (for cases like "ESHRE - PCOS - 2023.pdf" vs "ESHRE - PCOS - 2023")
            found = guidelines.find(g => {
                if (!g.filename || !targetGuideline.id) return false;
                
                const normalizeFilename = (filename) => filename.toLowerCase()
                    .replace('.pdf', '')
                    .replace(/[^a-z0-9\s]/g, ' ')
                    .replace(/\s+/g, ' ')
                    .trim();
                
                const normalizedTarget = normalizeFilename(targetGuideline.id);
                const normalizedFilename = normalizeFilename(g.filename);
                
                return normalizedTarget.includes(normalizedFilename) || 
                       normalizedFilename.includes(normalizedTarget);
            });
            
            if (found) {
                console.log(`[DEBUG] Found guideline by partial filename match: ${targetGuideline.id} -> ${found.filename} (${found.id})`);
                return found;
            }

            return null;
        }

        // Process only the most relevant guideline (first one in the list)
        const mostRelevantGuideline = window.relevantGuidelines[0];
        const guidelineData = findGuidelineInCache(mostRelevantGuideline);
                    const guidelineTitle = guidelineData?.humanFriendlyTitle || guidelineData?.title || mostRelevantGuideline.filename || mostRelevantGuideline.title;
        
        console.log('[DEBUG] Processing most relevant guideline:', {
            guidelineId: mostRelevantGuideline.id,
            title: guidelineTitle,
            found: !!guidelineData,
            searchedFor: {
                id: mostRelevantGuideline.id,
                title: mostRelevantGuideline.humanFriendlyTitle || mostRelevantGuideline.title,
                filename: mostRelevantGuideline.filename
            },
            availableKeys: guidelineData ? 'found' : `not found in ${Object.keys(window.globalGuidelines).length} keys`,
            totalRelevantGuidelines: window.relevantGuidelines.length
        });
        
        // Update UI to show current guideline being processed
        const currentStatus = `Analysing against most relevant guideline: ${guidelineTitle}...`;
        appendToSummary1(`\n${currentStatus}\n`, false);
        
        try {
            if (!guidelineData) {
                console.error('[DEBUG] Guideline not found in cache:', {
                    title: guidelineTitle,
                    availableGuidelines: Object.keys(window.globalGuidelines)
                });
                
                const errorResult = {
                    guideline: guidelineTitle,
                    error: 'Guideline not found in cache. Please try finding relevant guidelines again.',
                    analysis: null
                };
                const errorSection = `### ${errorResult.guideline}\n\n⚠️ ${errorResult.error}\n\n`;
                formattedAnalysis += errorSection;
                errorCount++;
                appendToSummary1(errorSection, false); // Append, don't clear
            } else {

                // Send to server for analysis
                const response = await fetch(`${window.SERVER_URL}/analyzeNoteAgainstGuideline`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${idToken}`
                    },
                    body: JSON.stringify({
                        transcript: transcript,
                        guideline: guidelineData.id
                    })
                });

                console.log('[DEBUG] Server response:', {
                    status: response.status,
                    ok: response.ok,
                    statusText: response.statusText
                });

                if (!response.ok) {
                    const errorText = await response.text();
                    console.error('[DEBUG] Server error response:', {
                        status: response.status,
                        statusText: response.statusText,
                        errorText,
                        guideline: guidelineTitle
                    });
                    
                    // Try to parse the error message
                    let errorMessage = 'Server error';
                    try {
                        const errorJson = JSON.parse(errorText);
                        errorMessage = errorJson.error || errorMessage;
                    } catch (e) {
                        errorMessage = errorText || errorMessage;
                    }
                    
                    throw new Error(errorMessage);
                }

                const result = await response.json();
                if (!result.success) {
                    throw new Error(result.error || 'Analysis failed');
                }

                // Add the analysis to the formatted output
                const analysisSection = `### ${guidelineTitle}\n\n${result.analysis}\n\n`;
                formattedAnalysis += analysisSection;
                successCount++;
                appendToSummary1(analysisSection, false); // Append, don't clear
            }
        } catch (error) {
            console.error('[DEBUG] Error processing guideline:', {
                guideline: guidelineTitle,
                error: error.message
            });
            const errorSection = `### ${guidelineTitle}\n\n⚠️ Error: ${error.message}\n\n`;
            formattedAnalysis += errorSection;
            errorCount++;
            appendToSummary1(errorSection, false); // Append, don't clear
        }

        // Add summary of results
        console.log('[DEBUG] Analysis summary:', {
            successCount,
            errorCount,
            totalRelevantGuidelines: window.relevantGuidelines.length,
            analyzedMostRelevant: true
        });

        const summarySection = `\n## Summary\n\nAnalyzed against the most relevant guideline${successCount > 0 ? ' successfully' : ''}.\n`;
        const failureSection = errorCount > 0 ? `Analysis failed.\n` : '';
        const additionalInfo = `\n*Note: Found ${window.relevantGuidelines.length} relevant guidelines total, analyzed against the most relevant one.*\n`;
        const finalSummary = summarySection + failureSection + additionalInfo;
        
        formattedAnalysis += finalSummary;
        appendToSummary1(finalSummary, false); // Append, don't clear

        // Store the latest analysis result and guideline data for dynamic advice
        if (successCount > 0) {
            console.log('[DEBUG] Storing analysis result for dynamic advice');
            window.latestAnalysis = {
                analysis: formattedAnalysis,
                transcript: transcript,
                guidelineId: mostRelevantGuideline.id,
                guidelineTitle: guidelineTitle,
                timestamp: new Date().toISOString()
            };
            
            // Show the "Make Advice Dynamic" button
            const makeDynamicAdviceBtn = document.getElementById('makeDynamicAdviceBtn');
            if (makeDynamicAdviceBtn) {
                makeDynamicAdviceBtn.style.display = 'inline-block';
                console.log('[DEBUG] Made dynamic advice button visible');
            }
        }

        debouncedSaveState(); // Save state after checking guidelines

    } catch (error) {
        console.error('[DEBUG] Error in checkAgainstGuidelines:', error);
        alert(`Error checking guidelines: ${error.message}`);
    } finally {
        // Reset button state
        checkGuidelinesBtn.classList.remove('loading');
        checkGuidelinesBtn.disabled = false;
        console.log('[DEBUG] checkAgainstGuidelines completed');
    }
}

// Dynamic Advice function - converts guideline analysis into interactive suggestions
async function dynamicAdvice(transcript, analysis, guidelineId, guidelineTitle) {
    console.log('[DEBUG] dynamicAdvice function called', {
        transcriptLength: transcript?.length,
        analysisLength: analysis?.length,
        guidelineId,
        guidelineTitle
    });

    try {
        // Get user ID token
        const user = auth.currentUser;
        if (!user) {
            console.log('[DEBUG] dynamicAdvice: No authenticated user found');
            throw new Error('User not authenticated');
        }
        
        const idToken = await user.getIdToken();
        console.log('[DEBUG] dynamicAdvice: Got ID token');

        // Call the dynamicAdvice API
        console.log('[DEBUG] dynamicAdvice: Calling API endpoint');
        const response = await fetch(`${window.SERVER_URL}/dynamicAdvice`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${idToken}`
            },
            body: JSON.stringify({
                transcript,
                analysis,
                guidelineId,
                guidelineTitle
            })
        });

        console.log('[DEBUG] dynamicAdvice: API response received', {
            status: response.status,
            ok: response.ok,
            statusText: response.statusText
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('[DEBUG] dynamicAdvice: API error response:', {
                status: response.status,
                statusText: response.statusText,
                errorText
            });
            throw new Error(`API error: ${response.status} - ${errorText}`);
        }

        const result = await response.json();
        console.log('[DEBUG] dynamicAdvice: API result received', {
            success: result.success,
            sessionId: result.sessionId,
            suggestionsCount: result.suggestions?.length,
            guidelineId: result.guidelineId,
            guidelineTitle: result.guidelineTitle
        });

        if (!result.success) {
            throw new Error(result.error || 'Dynamic advice generation failed');
        }

        // Store session data globally
        currentAdviceSession = result.sessionId;
        currentSuggestions = result.suggestions || [];
        userDecisions = {};

        console.log('[DEBUG] dynamicAdvice: Stored session data', {
            sessionId: currentAdviceSession,
            suggestionsCount: currentSuggestions.length
        });

        // Display interactive suggestions using appendToSummary1
        await displayInteractiveSuggestions(result.suggestions, result.guidelineTitle);

        return result;

    } catch (error) {
        console.error('[DEBUG] dynamicAdvice: Error in function:', {
            error: error.message,
            stack: error.stack,
            transcriptLength: transcript?.length,
            analysisLength: analysis?.length
        });
        
        // Display error message using appendToSummary1
        const errorHtml = `
            <div class="dynamic-advice-error">
                <h3>❌ Error generating interactive suggestions</h3>
                <p><strong>Error:</strong> ${error.message}</p>
                <p>The original analysis is still available above.</p>
            </div>
        `;
        appendToSummary1(errorHtml, false);
        
        throw error;
    }
}

// Display interactive suggestions in summary1
async function displayInteractiveSuggestions(suggestions, guidelineTitle) {
    console.log('[DEBUG] displayInteractiveSuggestions called', {
        suggestionsCount: suggestions?.length,
        guidelineTitle
    });

    if (!suggestions || suggestions.length === 0) {
        console.log('[DEBUG] displayInteractiveSuggestions: No suggestions to display');
        const noSuggestionsHtml = `
            <div class="dynamic-advice-container">
                <h3>💡 Interactive Suggestions</h3>
                <p>No specific suggestions were generated from the guideline analysis.</p>
                <p><em>Guideline: ${guidelineTitle || 'Unknown'}</em></p>
            </div>
        `;
        appendToSummary1(noSuggestionsHtml, false);
        return;
    }

    console.log('[DEBUG] displayInteractiveSuggestions: Creating suggestions HTML');

    // Create the interactive suggestions HTML
    let suggestionsHtml = `
        <div class="dynamic-advice-container">
            <div class="advice-header">
                <h3>💡 Interactive Suggestions</h3>
                <p><em>From: ${guidelineTitle || 'Guideline Analysis'}</em></p>
                <p class="advice-instructions">Review each suggestion below. You can <strong>Accept</strong>, <strong>Reject</strong>, or <strong>Modify</strong> the proposed changes.</p>
                <div class="advice-explanation">
                    <p><strong>Note:</strong> Some suggestions identify <em>missing elements</em> (gaps in documentation) rather than existing text that needs changes. These are marked with ⚠️ and represent content that should be added to improve compliance with guidelines.</p>
                </div>
            </div>
            <div class="suggestions-list">
    `;

    // Add each suggestion
    suggestions.forEach((suggestion, index) => {
        console.log('[DEBUG] displayInteractiveSuggestions: Processing suggestion', {
            index,
            id: suggestion.id,
            category: suggestion.category,
            priority: suggestion.priority
        });

        const priorityClass = `priority-${suggestion.priority || 'medium'}`;
        const categoryIcon = getCategoryIcon(suggestion.category);
        
        suggestionsHtml += `
            <div class="suggestion-item ${priorityClass}" data-suggestion-id="${suggestion.id}">
                <div class="suggestion-header">
                    <div class="suggestion-info">
                        <span class="category-icon">${categoryIcon}</span>
                        <span class="suggestion-id">#${index + 1}</span>
                        <span class="priority-badge ${priorityClass}">${suggestion.priority || 'medium'}</span>
                    </div>
                    <div class="guideline-ref">${suggestion.guidelineReference || ''}</div>
                </div>
                
                <div class="suggestion-content">
                    ${suggestion.originalText ? `
                        <div class="original-text">
                            <label>${getOriginalTextLabel(suggestion.originalText, suggestion.category)}</label>
                            <div class="text-preview ${suggestion.category === 'addition' ? 'missing-element' : ''}">"${suggestion.originalText}"</div>
                        </div>
                    ` : ''}
                    
                    <div class="suggested-text">
                        <label>Suggested ${suggestion.category || 'change'}:</label>
                        <div class="text-preview suggested">"${suggestion.suggestedText}"</div>
                    </div>
                    
                    <div class="suggestion-context">
                        <label>Why this change is suggested:</label>
                        <p>${suggestion.context}</p>
                    </div>
                </div>
                
                <div class="suggestion-actions">
                    <button class="action-btn accept-btn" onclick="handleSuggestionAction('${suggestion.id}', 'accept')">
                        ✅ Accept
                    </button>
                    <button class="action-btn reject-btn" onclick="handleSuggestionAction('${suggestion.id}', 'reject')">
                        ❌ Reject
                    </button>
                    <button class="action-btn modify-btn" onclick="handleSuggestionAction('${suggestion.id}', 'modify')">
                        ✏️ Modify
                    </button>
                </div>
                
                <div class="modify-section" id="modify-${suggestion.id}" style="display: none;">
                    <label for="modify-text-${suggestion.id}">Your modified text:</label>
                    <textarea id="modify-text-${suggestion.id}" class="modify-textarea" 
                              placeholder="Enter your custom text here...">${suggestion.suggestedText}</textarea>
                    <div class="modify-actions">
                        <button class="action-btn confirm-btn" onclick="confirmModification('${suggestion.id}')">
                            ✅ Confirm Modification
                        </button>
                        <button class="action-btn cancel-btn" onclick="cancelModification('${suggestion.id}')">
                            ❌ Cancel
                        </button>
                    </div>
                </div>
                
                <div class="decision-status" id="status-${suggestion.id}" style="display: none;">
                    <!-- Status will be updated by JavaScript -->
                </div>
            </div>
        `;
    });

    // Add apply all button
    suggestionsHtml += `
            </div>
            <div class="advice-footer">
                <button id="applyAllDecisionsBtn" class="apply-all-btn" onclick="applyAllDecisions()" disabled>
                    <span class="apply-spinner" style="display: none;">⏳</span>
                    <span class="apply-text">Apply All Decisions</span>
                </button>
                <div class="decisions-summary" id="decisionsSummary">
                    Make your decisions above, then click "Apply All Decisions" to update the transcript.
                </div>
            </div>
        </div>
    `;

    console.log('[DEBUG] displayInteractiveSuggestions: Adding suggestions HTML to summary1');
    appendToSummary1(suggestionsHtml, false);

    // Update the decisions summary
    updateDecisionsSummary();
    debouncedSaveState(); // Save state after displaying suggestions
}

// Get category icon for suggestion type
function getCategoryIcon(category) {
    const icons = {
        'addition': '➕',
        'modification': '✏️',
        'deletion': '🗑️',
        'formatting': '📝',
        'default': '💡'
    };
    return icons[category] || icons.default;
}

// Get appropriate label for original text based on category and content
function getOriginalTextLabel(originalText, category) {
    if (category === 'addition') {
        // For additions, we're usually dealing with missing elements
        if (originalText.toLowerCase().startsWith('no ') || originalText.toLowerCase().startsWith('did not') || originalText.toLowerCase().includes('missing')) {
            return 'Gap identified:';
        } else if (originalText.toLowerCase().startsWith('missing:') || originalText.toLowerCase().startsWith('gap:')) {
            return 'Issue found:';
        } else {
            return 'Missing element:';
        }
    } else if (category === 'modification') {
        return 'Current text:';
    } else if (category === 'deletion') {
        return 'Text to remove:';
    } else {
        return 'Current text:';
    }
}

// Handle suggestion actions (accept, reject, modify)
function handleSuggestionAction(suggestionId, action) {
    console.log('[DEBUG] handleSuggestionAction called', {
        suggestionId,
        action
    });

    const suggestionElement = document.querySelector(`[data-suggestion-id="${suggestionId}"]`);
    if (!suggestionElement) {
        console.error('[DEBUG] handleSuggestionAction: Suggestion element not found:', suggestionId);
        return;
    }

    // Find the suggestion data
    const suggestion = currentSuggestions.find(s => s.id === suggestionId);
    if (!suggestion) {
        console.error('[DEBUG] handleSuggestionAction: Suggestion data not found:', suggestionId);
        return;
    }

    console.log('[DEBUG] handleSuggestionAction: Processing action', {
        suggestionId,
        action,
        suggestionFound: !!suggestion
    });

    if (action === 'modify') {
        // Show modify section
        const modifySection = document.getElementById(`modify-${suggestionId}`);
        if (modifySection) {
            modifySection.style.display = 'block';
            console.log('[DEBUG] handleSuggestionAction: Showing modify section');
        }
        return;
    }

    // For accept/reject, record the decision immediately
    userDecisions[suggestionId] = {
        action: action,
        suggestion: suggestion,
        timestamp: new Date().toISOString()
    };

    console.log('[DEBUG] handleSuggestionAction: Recorded decision', {
        suggestionId,
        action,
        totalDecisions: Object.keys(userDecisions).length
    });

    // Update UI to show decision
    updateSuggestionStatus(suggestionId, action);
    updateDecisionsSummary();
    debouncedSaveState(); // Save state after a decision is made
}

// Confirm modification with custom text
function confirmModification(suggestionId) {
    console.log('[DEBUG] confirmModification called', { suggestionId });

    const modifyTextarea = document.getElementById(`modify-text-${suggestionId}`);
    if (!modifyTextarea) {
        console.error('[DEBUG] confirmModification: Modify textarea not found:', suggestionId);
        return;
    }

    const modifiedText = modifyTextarea.value.trim();
    if (!modifiedText) {
        alert('Please enter some text for the modification.');
        return;
    }

    // Find the suggestion data
    const suggestion = currentSuggestions.find(s => s.id === suggestionId);
    if (!suggestion) {
        console.error('[DEBUG] confirmModification: Suggestion data not found:', suggestionId);
        return;
    }

    // Record the modification decision
    userDecisions[suggestionId] = {
        action: 'modify',
        modifiedText: modifiedText,
        suggestion: suggestion,
        timestamp: new Date().toISOString()
    };

    console.log('[DEBUG] confirmModification: Recorded modification', {
        suggestionId,
        modifiedTextLength: modifiedText.length,
        totalDecisions: Object.keys(userDecisions).length
    });

    // Hide modify section and update UI
    const modifySection = document.getElementById(`modify-${suggestionId}`);
    if (modifySection) {
        modifySection.style.display = 'none';
    }

    updateSuggestionStatus(suggestionId, 'modify', modifiedText);
    updateDecisionsSummary();
    debouncedSaveState(); // Save state after modification
}

// Cancel modification
function cancelModification(suggestionId) {
    console.log('[DEBUG] cancelModification called', { suggestionId });

    const modifySection = document.getElementById(`modify-${suggestionId}`);
    if (modifySection) {
        modifySection.style.display = 'none';
    }

    // Remove any existing decision for this suggestion
    if (userDecisions[suggestionId]) {
        delete userDecisions[suggestionId];
        console.log('[DEBUG] cancelModification: Removed decision for suggestion:', suggestionId);
    }

    // Reset status
    const statusElement = document.getElementById(`status-${suggestionId}`);
    if (statusElement) {
        statusElement.style.display = 'none';
        statusElement.innerHTML = '';
    }

    // Show the action buttons again since decision was cancelled
    const actionButtonsElement = document.querySelector(`[data-suggestion-id="${suggestionId}"] .suggestion-actions`);
    if (actionButtonsElement) {
        actionButtonsElement.style.display = 'flex';
        actionButtonsElement.style.opacity = '1';
        actionButtonsElement.style.transform = 'scale(1)';
        console.log('[DEBUG] cancelModification: Restored action buttons for suggestion:', suggestionId);
    }

    updateDecisionsSummary();
    debouncedSaveState(); // Save state after cancelling
}

// Update suggestion status UI
function updateSuggestionStatus(suggestionId, action, modifiedText = null) {
    console.log('[DEBUG] updateSuggestionStatus called', {
        suggestionId,
        action,
        hasModifiedText: !!modifiedText
    });

    const statusElement = document.getElementById(`status-${suggestionId}`);
    if (!statusElement) {
        console.error('[DEBUG] updateSuggestionStatus: Status element not found:', suggestionId);
        return;
    }

    let statusHtml = '';
    let statusClass = '';

    switch (action) {
        case 'accept':
            statusHtml = '<span class="status-icon">✅</span> <strong>Accepted</strong> - This suggestion will be applied';
            statusClass = 'decision-accepted';
            break;
        case 'reject':
            statusHtml = '<span class="status-icon">❌</span> <strong>Rejected</strong> - This suggestion will be ignored';
            statusClass = 'decision-rejected';
            break;
        case 'modify':
            statusHtml = `<span class="status-icon">✏️</span> <strong>Modified</strong> - Will use your custom text: "<em>${modifiedText?.substring(0, 100)}${modifiedText?.length > 100 ? '...' : ''}</em>"`;
            statusClass = 'decision-modified';
            break;
    }

    statusElement.innerHTML = statusHtml;
    statusElement.className = `decision-status ${statusClass}`;
    statusElement.style.display = 'block';

    // Hide the action buttons after decision is made with animation
    const actionButtonsElement = document.querySelector(`[data-suggestion-id="${suggestionId}"] .suggestion-actions`);
    if (actionButtonsElement) {
        actionButtonsElement.style.opacity = '0';
        actionButtonsElement.style.transform = 'scale(0.95)';
        setTimeout(() => {
            actionButtonsElement.style.display = 'none';
        }, 300);
        console.log('[DEBUG] updateSuggestionStatus: Hidden action buttons for suggestion:', suggestionId);
    }

    // Update suggestion item styling
    const suggestionElement = document.querySelector(`[data-suggestion-id="${suggestionId}"]`);
    if (suggestionElement) {
        suggestionElement.classList.remove('decision-accepted', 'decision-rejected', 'decision-modified');
        suggestionElement.classList.add(statusClass);
    }
}

// Update decisions summary and enable/disable apply button
function updateDecisionsSummary() {
    console.log('[DEBUG] updateDecisionsSummary called', {
        totalSuggestions: currentSuggestions.length,
        totalDecisions: Object.keys(userDecisions).length
    });

    const summaryElement = document.getElementById('decisionsSummary');
    const applyButton = document.getElementById('applyAllDecisionsBtn');
    
    if (!summaryElement || !applyButton) {
        console.error('[DEBUG] updateDecisionsSummary: Required elements not found');
        return;
    }

    const totalSuggestions = currentSuggestions.length;
    const totalDecisions = Object.keys(userDecisions).length;
    const decisions = Object.values(userDecisions);
    
    const acceptedCount = decisions.filter(d => d.action === 'accept').length;
    const rejectedCount = decisions.filter(d => d.action === 'reject').length;
    const modifiedCount = decisions.filter(d => d.action === 'modify').length;

    console.log('[DEBUG] updateDecisionsSummary: Decision counts', {
        total: totalDecisions,
        accepted: acceptedCount,
        rejected: rejectedCount,
        modified: modifiedCount
    });

    let summaryText = '';
    if (totalDecisions === 0) {
        summaryText = `Make your decisions above, then click "Apply All Decisions" to update the transcript.`;
        applyButton.disabled = true;
    } else if (totalDecisions < totalSuggestions) {
        summaryText = `Progress: ${totalDecisions}/${totalSuggestions} decisions made. `;
        summaryText += `Accepted: ${acceptedCount}, Rejected: ${rejectedCount}, Modified: ${modifiedCount}`;
        applyButton.disabled = true;
    } else {
        summaryText = `All decisions made! Accepted: ${acceptedCount}, Rejected: ${rejectedCount}, Modified: ${modifiedCount}`;
        applyButton.disabled = false;
    }

    summaryElement.textContent = summaryText;
}

// Apply all user decisions
async function applyAllDecisions() {
    console.log('[DEBUG] applyAllDecisions called', {
        sessionId: currentAdviceSession,
        totalDecisions: Object.keys(userDecisions).length
    });

    if (!currentAdviceSession) {
        console.error('[DEBUG] applyAllDecisions: No active advice session');
        alert('No active advice session found. Please generate suggestions first.');
        return;
    }

    if (Object.keys(userDecisions).length === 0) {
        console.error('[DEBUG] applyAllDecisions: No decisions to apply');
        alert('Please make some decisions on the suggestions first.');
        return;
    }

    const applyButton = document.getElementById('applyAllDecisionsBtn');
    const applySpinner = applyButton?.querySelector('.apply-spinner');
    const applyText = applyButton?.querySelector('.apply-text');

    try {
        // Update UI to show loading state
        if (applyButton) applyButton.disabled = true;
        if (applySpinner) applySpinner.style.display = 'inline';
        if (applyText) applyText.textContent = 'Applying decisions...';

        console.log('[DEBUG] applyAllDecisions: UI updated to loading state');

        // Prepare decisions data for API
        const decisionsData = {};
        Object.entries(userDecisions).forEach(([suggestionId, decision]) => {
            decisionsData[suggestionId] = {
                action: decision.action,
                modifiedText: decision.modifiedText || null
            };
        });

        console.log('[DEBUG] applyAllDecisions: Prepared decisions data', {
            decisionsCount: Object.keys(decisionsData).length,
            actions: Object.values(decisionsData).map(d => d.action)
        });

        // Get user ID token
        const user = auth.currentUser;
        if (!user) {
            throw new Error('User not authenticated');
        }
        
        const idToken = await user.getIdToken();
        console.log('[DEBUG] applyAllDecisions: Got ID token');

        // Call the applyDynamicAdvice API
        console.log('[DEBUG] applyAllDecisions: Calling API endpoint');
        const response = await fetch(`${window.SERVER_URL}/applyDynamicAdvice`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${idToken}`
            },
            body: JSON.stringify({
                sessionId: currentAdviceSession,
                decisions: decisionsData
            })
        });

        console.log('[DEBUG] applyAllDecisions: API response received', {
            status: response.status,
            ok: response.ok
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('[DEBUG] applyAllDecisions: API error response:', {
                status: response.status,
                errorText
            });
            throw new Error(`API error: ${response.status} - ${errorText}`);
        }

        const result = await response.json();
        console.log('[DEBUG] applyAllDecisions: API result received', {
            success: result.success,
            originalLength: result.originalTranscript?.length,
            updatedLength: result.updatedTranscript?.length,
            changesSummary: result.changesSummary
        });

        if (!result.success) {
            throw new Error(result.error || 'Failed to apply decisions');
        }

        // Display the results using appendToSummary1
        const resultsHtml = `
            <div class="apply-results">
                <h3>🎉 Decisions Applied Successfully!</h3>
                <div class="changes-summary">
                    <h4>Changes Summary:</h4>
                    <ul>
                        <li><strong>Accepted:</strong> ${result.changesSummary.accepted} suggestions</li>
                        <li><strong>Modified:</strong> ${result.changesSummary.modified} suggestions</li>
                        <li><strong>Rejected:</strong> ${result.changesSummary.rejected} suggestions</li>
                        <li><strong>Total processed:</strong> ${result.changesSummary.total} suggestions</li>
                    </ul>
                </div>
                <div class="updated-transcript">
                    <h4>Updated Transcript:</h4>
                    <div class="transcript-content">${result.updatedTranscript.replace(/\n/g, '<br>')}</div>
                </div>
                <div class="transcript-actions">
                    <button onclick="copyUpdatedTranscript()" class="action-btn">📋 Copy Updated Transcript</button>
                    <button onclick="replaceOriginalTranscript()" class="action-btn">🔄 Replace Original Transcript</button>
                </div>
            </div>
        `;

        appendToSummary1(resultsHtml, false);

        // Store the updated transcript globally for actions
        window.lastUpdatedTranscript = result.updatedTranscript;

        console.log('[DEBUG] applyAllDecisions: Results displayed successfully');
        debouncedSaveState();

    } catch (error) {
        console.error('[DEBUG] applyAllDecisions: Error applying decisions:', {
            error: error.message,
            stack: error.stack
        });

        const errorHtml = `
            <div class="apply-error">
                <h3>❌ Error applying decisions</h3>
                <p><strong>Error:</strong> ${error.message}</p>
                <p>Please try again or contact support if the problem persists.</p>
            </div>
        `;
        appendToSummary1(errorHtml, false);

    } finally {
        // Reset UI state
        if (applyButton) applyButton.disabled = false;
        if (applySpinner) applySpinner.style.display = 'none';
        if (applyText) applyText.textContent = 'Apply All Decisions';
    }
}

// Helper function to copy updated transcript
function copyUpdatedTranscript() {
    if (window.lastUpdatedTranscript) {
        navigator.clipboard.writeText(window.lastUpdatedTranscript).then(() => {
            alert('Updated transcript copied to clipboard!');
        }).catch(err => {
            console.error('Failed to copy transcript:', err);
            alert('Failed to copy transcript. Please select and copy manually.');
        });
    }
}

// Helper function to replace original transcript in userInput
function replaceOriginalTranscript() {
    if (window.lastUpdatedTranscript) {
        const userInput = document.getElementById('userInput');
        if (userInput) {
            userInput.value = window.lastUpdatedTranscript;
            alert('Original transcript has been replaced with the updated version!');
            debouncedSaveState();
        }
    }
}

// Modify initializeApp to auto-sync guidelines if needed
async function initializeApp() {
    console.log('[DEBUG] Starting initializeApp...');

        console.log('[DEBUG] Initializing marked library...');
        await initializeMarked();
        console.log('[DEBUG] Marked library initialized successfully');

        console.log('[DEBUG] Setting up Firebase auth state listener...');
    window.auth.onAuthStateChanged(async (user) => {
        console.log('[DEBUG] Auth state changed:', user);
        const loading = document.getElementById('loading');
        const landingPage = document.getElementById('landingPage');
        const mainContent = document.getElementById('mainContent');

            if (user) {
            console.log('[DEBUG] User authenticated:', user.displayName || user.email);
            loading.classList.add('hidden');
            landingPage.classList.add('hidden');
            mainContent.classList.remove('hidden');
            
            // Update user info
            const userLabel = document.getElementById('userLabel');
            const userName = document.getElementById('userName');
            if (userLabel && userName) {
                userName.textContent = user.displayName || user.email || 'User';
                userName.classList.remove('hidden');
            }
            
            // Initialize app features - make sure this is called
            await initializeMainApp();
        } else {
            console.log('[DEBUG] User not authenticated, showing landing page');
            loading.classList.add('hidden');
            mainContent.classList.add('hidden');
            landingPage.classList.remove('hidden');
            
            // Set up Google Sign-in button listener
            setupGoogleSignIn();
        }
    });
}

function setupGoogleSignIn() {
    const googleSignInBtn = document.getElementById('googleSignInBtn');
    if (googleSignInBtn) {
        console.log('[DEBUG] Setting up Google Sign-in button listener...');
        
        // Remove any existing listeners
        googleSignInBtn.replaceWith(googleSignInBtn.cloneNode(true));
        const newGoogleSignInBtn = document.getElementById('googleSignInBtn');
        
        newGoogleSignInBtn.addEventListener('click', async () => {
            console.log('[DEBUG] Google Sign-in button clicked');
            try {
                const provider = new window.firebase.auth.GoogleAuthProvider();
                provider.addScope('email');
                provider.addScope('profile');
                
                console.log('[DEBUG] Attempting to sign in with popup...');
                const result = await window.auth.signInWithPopup(provider);
                console.log('[DEBUG] Sign-in successful:', result.user.displayName || result.user.email);
                } catch (error) {
                console.error('[ERROR] Sign-in failed:', error);
                alert('Sign-in failed: ' + error.message);
                }
        });
        
        console.log('[DEBUG] Google Sign-in button listener set up successfully');
    } else {
        console.error('[ERROR] Google Sign-in button not found');
    }
}

// Initialize main app features after authentication
async function initializeMainApp() {
    console.log('[DEBUG] Initializing main app features...');
    
    // Initialize chat history
    initializeChatHistory();
    
    // Load any existing chat state
    const savedChatId = localStorage.getItem('currentChatId');
    if (savedChatId) {
        console.log('[DEBUG] Loading saved chat:', savedChatId);
        switchChat(savedChatId);
    } else {
        console.log('[DEBUG] No saved chat found, starting fresh');
        // Auto-save current state as the first chat if there's content
        const userInput = document.getElementById('userInput');
        const summary1 = document.getElementById('summary1');
        if (userInput?.value || summary1?.innerHTML) {
            saveCurrentChatState();
        }
    }
    
    // Set up auto-save
    const userInput = document.getElementById('userInput');
    if (userInput) {
        userInput.addEventListener('input', debouncedSaveState);
    }
    
    console.log('[DEBUG] Main app features initialized');
}

// Debounced save function to prevent excessive saves
let saveTimeout;
function debouncedSaveState() {
    clearTimeout(saveTimeout);
    saveTimeout = setTimeout(() => {
        saveCurrentChatState();
    }, 1000); // Save 1 second after user stops typing
}

// Get current chat state
function getChatState() {
    const userInput = document.getElementById('userInput');
    const summary1 = document.getElementById('summary1');
    
    return {
        userInput: userInput ? userInput.value : '',
        summary1: summary1 ? summary1.innerHTML : '',
        timestamp: new Date().toISOString()
    };
}

// Load chat state
function loadChatState(state) {
    console.log('[DEBUG] Loading chat state:', state);
    
    const userInput = document.getElementById('userInput');
    const summary1 = document.getElementById('summary1');
    
    if (userInput) userInput.value = state.userInput || '';
    if (summary1) summary1.innerHTML = state.summary1 || '';
}

// Save current chat state
function saveCurrentChatState() {
    const currentState = getChatState();
    
    // Don't save empty states
    if (!currentState.userInput && !currentState.summary1) {
        return;
    }
    
    const currentChatId = localStorage.getItem('currentChatId');
    const allChats = JSON.parse(localStorage.getItem('chatHistory') || '{}');
    
    let chatId = currentChatId;
    if (!chatId) {
        chatId = 'chat_' + Date.now();
        localStorage.setItem('currentChatId', chatId);
    }
    
    // Create title from content or timestamp
    let title = 'Untitled Chat';
    if (currentState.userInput) {
        title = currentState.userInput.substring(0, 50).trim();
        if (title.length < currentState.userInput.length) title += '...';
    } else if (currentState.summary1) {
        const textContent = currentState.summary1.replace(/<[^>]*>/g, '').substring(0, 50).trim();
        if (textContent) {
            title = textContent;
            if (title.length < textContent.length) title += '...';
        }
    }
    
    allChats[chatId] = {
        title,
        timestamp: currentState.timestamp,
        state: currentState
    };
    
    localStorage.setItem('chatHistory', JSON.stringify(allChats));
    renderChatHistory();
    
    console.log('[DEBUG] Saved chat state:', { chatId, title });
}

// Start new chat
function startNewChat() {
    console.log('[DEBUG] Starting new chat...');
    
    // Save current chat if it has content
    saveCurrentChatState();
    
    // Clear current content
    const userInput = document.getElementById('userInput');
    const summary1 = document.getElementById('summary1');
    
    if (userInput) userInput.value = '';
    if (summary1) summary1.innerHTML = '';
    
    // Generate new chat ID
    const newChatId = 'chat_' + Date.now();
    localStorage.setItem('currentChatId', newChatId);
    
    renderChatHistory();
    console.log('[DEBUG] New chat started:', newChatId);
}

// Switch to existing chat
function switchChat(chatId) {
    console.log('[DEBUG] Switching to chat:', chatId);
    
    const allChats = JSON.parse(localStorage.getItem('chatHistory') || '{}');
    const chat = allChats[chatId];
    
    if (chat) {
        localStorage.setItem('currentChatId', chatId);
        loadChatState(chat.state);
        renderChatHistory();
    } else {
        console.error('[DEBUG] Chat not found:', chatId);
    }
}

// Delete chat
function deleteChat(chatId, event) {
    event.stopPropagation();
    console.log('[DEBUG] Deleting chat:', chatId);
    
    const allChats = JSON.parse(localStorage.getItem('chatHistory') || '{}');
    delete allChats[chatId];
    localStorage.setItem('chatHistory', JSON.stringify(allChats));
    
    // If we deleted the current chat, start a new one
    const currentChatId = localStorage.getItem('currentChatId');
    if (currentChatId === chatId) {
        localStorage.removeItem('currentChatId');
        startNewChat();
    }
    
    renderChatHistory();
}

// Render chat history in sidebar
function renderChatHistory() {
    const historyList = document.getElementById('historyList');
    if (!historyList) return;
    
    const allChats = JSON.parse(localStorage.getItem('chatHistory') || '{}');
    const currentChatId = localStorage.getItem('currentChatId');
    
    // Sort chats by timestamp (newest first)
    const sortedChats = Object.entries(allChats).sort((a, b) => 
        new Date(b[1].timestamp) - new Date(a[1].timestamp)
    );
    
    historyList.innerHTML = '';
    
    sortedChats.forEach(([chatId, chat]) => {
        const chatItem = document.createElement('div');
        chatItem.className = `history-item ${chatId === currentChatId ? 'active' : ''}`;
        chatItem.onclick = () => switchChat(chatId);
        
        const date = new Date(chat.timestamp).toLocaleDateString();
        const time = new Date(chat.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        
        chatItem.innerHTML = `
            <div class="history-item-title">${chat.title}</div>
            <div class="history-item-preview">${date} ${time}</div>
            <button class="delete-chat-btn" onclick="deleteChat('${chatId}', event)">×</button>
        `;
        
        historyList.appendChild(chatItem);
    });
    
    console.log('[DEBUG] Rendered chat history:', sortedChats.length, 'chats');
}

// Initialize chat history system
function initializeChatHistory() {
    console.log('[DEBUG] Initializing chat history...');
    
    // Render existing history
    renderChatHistory();
    
    // Set up event listeners
    const newChatBtn = document.getElementById('newChatBtn');
    if (newChatBtn) {
        newChatBtn.onclick = startNewChat;
    }
    
    console.log('[DEBUG] Chat history initialized');
}
