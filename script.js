// Import Firebase instances from firebase-init.js
import { app, db, auth } from './firebase-init.js';
import { GoogleAuthProvider, signInWithPopup, onAuthStateChanged, signOut, signInWithRedirect, getRedirectResult } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import { getAnalytics } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-analytics.js';
import { doc, getDoc, setDoc } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

// Make auth available globally - ADD THIS LINE
window.auth = auth;

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
        filename: g.filename || g.title, // Keep both for compatibility
        originalFilename: g.originalFilename || g.title, // Preserve original filename if available
        downloadUrl: g.downloadUrl, // Preserve downloadUrl if available
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

        // Enhanced debugging - log the full guideline object structure
        console.log('[DEBUG] createPdfDownloadLink called with guideline:', {
            fullObject: guideline,
            allKeys: Object.keys(guideline),
            hasDownloadUrl: !!guideline.downloadUrl,
            hasOriginalFilename: !!guideline.originalFilename,
            hasFilename: !!guideline.filename,
            downloadUrlValue: guideline.downloadUrl,
            originalFilenameValue: guideline.originalFilename,
            filenameValue: guideline.filename,
            id: guideline.id,
            title: guideline.title
        });

        // Only use downloadUrl field if available
        let downloadUrl;
        if (guideline.downloadUrl) {
            downloadUrl = guideline.downloadUrl;
            console.log('[DEBUG] Using stored downloadUrl:', downloadUrl);
        } else if (guideline.originalFilename) {
            // Use original filename if available
            const encodedFilename = encodeURIComponent(guideline.originalFilename);
            downloadUrl = `https://github.com/iannouvel/clerky/raw/main/guidance/${encodedFilename}`;
            console.log('[DEBUG] Constructed downloadUrl from originalFilename:', downloadUrl);
        } else {
            // No reliable download information available - don't show a link
            console.warn('[DEBUG] No downloadUrl or originalFilename available for guideline:', {
                id: guideline.id,
                title: guideline.title,
                allAvailableFields: Object.keys(guideline),
                fullGuidelineObject: guideline
            });
            console.warn('[DEBUG] Database should provide downloadUrl or originalFilename field');
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
        
        console.log('[DEBUG] Sample guideline from Firestore before processing:', {
            sampleGuideline: guidelines[0],
            allKeys: guidelines[0] ? Object.keys(guidelines[0]) : 'no guidelines',
            hasDownloadUrl: !!(guidelines[0] && guidelines[0].downloadUrl),
            downloadUrlValue: guidelines[0] ? guidelines[0].downloadUrl : 'no guideline'
        });
        
        // Format guidelines with comprehensive information for better relevancy matching
        // PRESERVE downloadUrl and other important fields for the server
        const guidelinesList = guidelines.map(g => ({
            id: g.id,
            title: g.title,
            summary: g.summary,
            condensed: g.condensed,
            keywords: g.keywords,
            downloadUrl: g.downloadUrl, // Important: preserve downloadUrl
            originalFilename: g.originalFilename, // Important: preserve originalFilename  
            filename: g.filename // Important: preserve filename
        }));
        
        console.log('[DEBUG] Sample guideline being sent to server:', {
            sampleGuideline: guidelinesList[0],
            allKeys: guidelinesList[0] ? Object.keys(guidelinesList[0]) : 'no guidelines',
            hasDownloadUrl: !!(guidelinesList[0] && guidelinesList[0].downloadUrl),
            downloadUrlValue: guidelinesList[0] ? guidelinesList[0].downloadUrl : 'no guideline'
        });

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

        console.log('[DEBUG] Server response categories structure:', {
            categories: data.categories,
            mostRelevantCount: data.categories.mostRelevant?.length || 0,
            sampleMostRelevant: data.categories.mostRelevant?.[0],
            sampleKeys: data.categories.mostRelevant?.[0] ? Object.keys(data.categories.mostRelevant[0]) : 'no most relevant',
            hasDownloadUrl: !!(data.categories.mostRelevant?.[0] && data.categories.mostRelevant[0].downloadUrl),
            downloadUrlValue: data.categories.mostRelevant?.[0] ? data.categories.mostRelevant[0].downloadUrl : 'no most relevant'
        });

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

    // Show the suggestion element again if it was hidden
    const suggestionElement = document.querySelector(`[data-suggestion-id="${suggestionId}"]`);
    if (suggestionElement) {
        suggestionElement.classList.remove('hiding', 'decision-accepted', 'decision-rejected', 'decision-modified');
        suggestionElement.style.display = 'block';
        console.log('[DEBUG] cancelModification: Restored suggestion visibility for:', suggestionId);
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

    // Update suggestion item styling and then hide the entire suggestion with animation
    const suggestionElement = document.querySelector(`[data-suggestion-id="${suggestionId}"]`);
    if (suggestionElement) {
        suggestionElement.classList.remove('decision-accepted', 'decision-rejected', 'decision-modified');
        suggestionElement.classList.add(statusClass);
        
        // Hide the entire suggestion after a brief delay to let user see the status
        setTimeout(() => {
            suggestionElement.classList.add('hiding');
            
            // After animation completes, completely hide the element
            setTimeout(() => {
                suggestionElement.style.display = 'none';
                console.log('[DEBUG] updateSuggestionStatus: Completely hidden suggestion element:', suggestionId);
            }, 500);
        }, 1500); // Wait 1.5 seconds to let user see the decision status
        
        console.log('[DEBUG] updateSuggestionStatus: Scheduled suggestion hiding for:', suggestionId);
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
            
            // Initialize app features
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
    const signInButton = document.getElementById('googleSignInBtn');
    if (signInButton) {
        // Check if listener is already set up
        if (signInButton.hasAttribute('data-listener-setup')) {
            console.log('[DEBUG] Google Sign-in button listener already set up');
            return;
        }
        
        console.log('[DEBUG] Setting up Google Sign-in button listener...');
        
        let isSigningIn = false; // Prevent concurrent sign-in attempts
        
        signInButton.addEventListener('click', async () => {
            if (isSigningIn) {
                console.log('[DEBUG] Sign-in already in progress, ignoring click');
                return;
            }
            
            try {
                isSigningIn = true;
                console.log('[DEBUG] Google Sign-in button clicked');
                const provider = new window.firebase.auth.GoogleAuthProvider();
                const result = await window.firebase.auth.signInWithPopup(provider);
                console.log('[DEBUG] Sign-in successful:', result.user.email);
            } catch (error) {
                console.error('[ERROR] Sign-in failed:', error);
                if (error.code !== 'auth/cancelled-popup-request') {
                    alert('Sign-in failed: ' + error.message);
                }
            } finally {
                isSigningIn = false;
            }
        });
        
        // Mark that listener has been set up
        signInButton.setAttribute('data-listener-setup', 'true');
        console.log('[DEBUG] Google Sign-in button listener set up successfully');
    } else {
        console.log('[DEBUG] Google Sign-in button not found');
    }
}

// Start initialization when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    console.log('DOM loaded, starting initialization...');
    initializeApp().catch(error => {
        console.error('Failed to initialize application:', error);
        isInitialized = true;
        showMainContent();
    });

    // Add click handler for generate clinical note button
    const generateClinicalNoteBtn = document.getElementById('generateClinicalNoteBtn');
    if (generateClinicalNoteBtn) {
        generateClinicalNoteBtn.addEventListener('click', generateClinicalNote);
    }

    // Add click handler for find relevant guidelines button
    const findGuidelinesBtn = document.getElementById('findGuidelinesBtn');
    if (findGuidelinesBtn) {
        findGuidelinesBtn.addEventListener('click', findRelevantGuidelines);
    }

    // Add click handler for dev button
    const devBtn = document.getElementById('devBtn');
    if (devBtn) {
        devBtn.addEventListener('click', () => {
            console.log('[DEBUG] Dev button clicked, redirecting to dev page...');
            window.location.href = 'dev.html';
        });
    }

    // Add click handler for prompts button
    const promptsBtn = document.getElementById('promptsBtn');
    if (promptsBtn) {
        promptsBtn.addEventListener('click', () => {
            console.log('[DEBUG] Prompts button clicked, redirecting to prompts page...');
            window.location.href = 'prompts.html';
        });
    }

    // Add click handler for guidelines button
    const guidelinesBtn = document.getElementById('guidelinesBtn');
    if (guidelinesBtn) {
        guidelinesBtn.addEventListener('click', () => {
            console.log('[DEBUG] Guidelines button clicked, redirecting to guidelines page...');
            window.location.href = 'guidelines.html';
        });
    }

    // Add click handler for settings button
    const settingsBtn = document.getElementById('settingsBtn');
    const settingsMenu = document.getElementById('settingsMenu');
    const settingsContainer = document.getElementById('settingsContainer');
    if (settingsBtn && settingsMenu) {
        settingsBtn.addEventListener('click', (event) => {
            event.stopPropagation();
            settingsMenu.classList.toggle('hidden');
        });
        
        // Close menu if clicking outside
        window.addEventListener('click', (event) => {
            if (!settingsMenu.classList.contains('hidden') && !settingsContainer.contains(event.target)) {
                settingsMenu.classList.add('hidden');
            }
        });
    }

    // Add click handler for "New Chat" button
    const newChatBtn = document.getElementById('newChatBtn');
    if (newChatBtn) {
        newChatBtn.addEventListener('click', startNewChat);
    }

    // Add click handler for test button - now generates fake clinical interactions
    const testBtn = document.getElementById('testBtn');
    if (testBtn) {
        testBtn.addEventListener('click', async () => {
            console.log('[DEBUG] Test button clicked - showing clinical issues dropdown...');
            await showClinicalIssuesDropdown();
        });
    }

    // Add click handler for generate transcript button
    const directFakeTranscriptBtn = document.getElementById('directFakeTranscriptBtn');
    if (directFakeTranscriptBtn) {
        directFakeTranscriptBtn.addEventListener('click', async () => {
            console.log('[DEBUG] Generate transcript button clicked...');
            const spinner = document.getElementById('directFakeTranscriptSpinner');
            const text = document.getElementById('directFakeTranscriptText');
            try {
                spinner.style.display = 'inline-block';
                text.textContent = 'Generating...';
                const response = await fetch(`${window.SERVER_URL}/generateTranscript`);
                const data = await response.json();
                if (data.success) {
                    document.getElementById('summary1').textContent = data.transcript;
                } else {
                    throw new Error(data.message || 'Failed to generate transcript');
                }
            } catch (error) {
                console.error('Failed to generate transcript:', error);
                alert('Failed to generate transcript: ' + error.message);
            } finally {
                spinner.style.display = 'none';
                text.textContent = 'Generate Transcript';
            }
        });
    }

    // Add click handler for action button
    const actionBtn = document.getElementById('actionBtn');
    if (actionBtn) {
        actionBtn.addEventListener('click', async () => {
            console.log('[DEBUG] Action button clicked...');
            const spinner = document.getElementById('actionSpinner');
            const text = document.getElementById('actionText');
            try {
                spinner.style.display = 'inline-block';
                text.textContent = 'Processing...';
                // TODO: Implement action functionality
                alert('Action functionality not yet implemented');
            } catch (error) {
                console.error('Action failed:', error);
                alert('Action failed: ' + error.message);
            } finally {
                spinner.style.display = 'none';
                text.textContent = 'Process';
            }
        });
    }

    // Add click handler for x-check button
    const xCheckBtn = document.getElementById('xCheckBtn');
    if (xCheckBtn) {
        xCheckBtn.addEventListener('click', async () => {
            console.log('[DEBUG] X-check button clicked...');
            const spinner = document.getElementById('xCheckSpinner');
            const text = document.getElementById('xCheckText');
            try {
                spinner.style.display = 'inline-block';
                text.textContent = 'Verifying...';
                // TODO: Implement x-check functionality
                alert('X-check functionality not yet implemented');
            } catch (error) {
                console.error('X-check failed:', error);
                alert('X-check failed: ' + error.message);
            } finally {
                spinner.style.display = 'none';
                text.textContent = 'Verify';
            }
        });
    }

    // Add click handler for sign out button
    const signOutBtn = document.getElementById('signOutBtn');
    if (signOutBtn) {
        signOutBtn.addEventListener('click', async () => {
            console.log('[DEBUG] Sign out button clicked...');
            try {
                await auth.signOut();
                window.location.reload();
            } catch (error) {
                console.error('Sign out failed:', error);
                alert('Failed to sign out: ' + error.message);
            }
        });
    }

    // Add click handler for save note button
    const saveNoteBtn = document.getElementById('saveNoteBtn');
    if (saveNoteBtn) {
        saveNoteBtn.addEventListener('click', () => {
            console.log('[DEBUG] Save note button clicked...');
            const userInput = document.getElementById('userInput');
            if (userInput && userInput.value.trim()) {
                document.getElementById('summary1').textContent = userInput.value;
                userInput.value = '';
            }
        });
    }

    // Add click handler for clear button
    const clearNoteBtn = document.getElementById('clearNoteBtn');
    if (clearNoteBtn) {
        clearNoteBtn.addEventListener('click', () => {
            console.log('[DEBUG] Clear button clicked...');
            const userInput = document.getElementById('userInput');
            if (userInput) {
                userInput.value = '';
            }
        });
    }

    // Add click handler for check guidelines button
    const checkGuidelinesBtn = document.getElementById('checkGuidelinesBtn');
    if (checkGuidelinesBtn) {
        checkGuidelinesBtn.addEventListener('click', async () => {
            console.log('[DEBUG] Check guidelines button clicked...');
            await checkAgainstGuidelines();
        });
    }

    // Add click handler for process workflow button
    const processBtn = document.getElementById('processBtn');
    if (processBtn) {
        processBtn.addEventListener('click', async () => {
            console.log('[DEBUG] Process button clicked...');
            await processWorkflow();
        });
    }

    // Add click handler for make advice dynamic button
    const makeDynamicAdviceBtn = document.getElementById('makeDynamicAdviceBtn');
    if (makeDynamicAdviceBtn) {
        makeDynamicAdviceBtn.addEventListener('click', async () => {
            console.log('[DEBUG] Make Advice Dynamic button clicked...');
            
            // Check if we have analysis data available
            if (!window.latestAnalysis) {
                console.log('[DEBUG] No latest analysis found');
                alert('Please run "Check against guidelines" first to generate analysis data.');
                return;
            }

            console.log('[DEBUG] Using latest analysis data:', {
                transcriptLength: window.latestAnalysis.transcript?.length,
                analysisLength: window.latestAnalysis.analysis?.length,
                guidelineId: window.latestAnalysis.guidelineId,
                guidelineTitle: window.latestAnalysis.guidelineTitle,
                timestamp: window.latestAnalysis.timestamp
            });

            const dynamicSpinner = document.getElementById('dynamicAdviceSpinner');
            const makeDynamicAdviceBtn = document.getElementById('makeDynamicAdviceBtn');
            
            try {
                // Update UI to show loading state
                if (dynamicSpinner) dynamicSpinner.style.display = 'inline';
                if (makeDynamicAdviceBtn) makeDynamicAdviceBtn.disabled = true;

                console.log('[DEBUG] Starting dynamic advice generation...');
                
                // Call the dynamic advice function
                await dynamicAdvice(
                    window.latestAnalysis.transcript,
                    window.latestAnalysis.analysis,
                    window.latestAnalysis.guidelineId,
                    window.latestAnalysis.guidelineTitle
                );

                console.log('[DEBUG] Dynamic advice generation completed successfully');

            } catch (error) {
                console.error('[DEBUG] Error in Make Advice Dynamic:', {
                    error: error.message,
                    stack: error.stack,
                    latestAnalysis: window.latestAnalysis
                });
                alert(`Error generating dynamic advice: ${error.message}`);
            } finally {
                // Reset UI state
                if (dynamicSpinner) dynamicSpinner.style.display = 'none';
                if (makeDynamicAdviceBtn) makeDynamicAdviceBtn.disabled = false;
            }
        });
    }

    // Add click handler for add issue button
    const addIssueBtn = document.getElementById('addIssueBtn');
    if (addIssueBtn) {
        addIssueBtn.addEventListener('click', () => {
            console.log('[DEBUG] Add issue button clicked...');
            // TODO: Implement add issue functionality
            alert('Add issue functionality not yet implemented');
        });
    }

    // Add click handlers for proforma buttons
    const obsProformaBtn = document.getElementById('obsProformaBtn');
    const gynProformaBtn = document.getElementById('gynProformaBtn');
    if (obsProformaBtn && gynProformaBtn) {
        obsProformaBtn.addEventListener('click', () => {
            console.log('[DEBUG] Obstetric proforma button clicked...');
            obsProformaBtn.classList.add('active');
            gynProformaBtn.classList.remove('active');
            document.getElementById('obsProforma').classList.remove('hidden');
            document.getElementById('gynProforma').classList.add('hidden');
        });

        gynProformaBtn.addEventListener('click', () => {
            console.log('[DEBUG] Gynaecology proforma button clicked...');
            gynProformaBtn.classList.add('active');
            obsProformaBtn.classList.remove('active');
            document.getElementById('gynProforma').classList.remove('hidden');
            document.getElementById('obsProforma').classList.add('hidden');
        });
    }

    // Add click handler for populate proforma button
    const populateProformaBtn = document.getElementById('populateProformaBtn');
    if (populateProformaBtn) {
        populateProformaBtn.addEventListener('click', async () => {
            console.log('[DEBUG] Populate proforma button clicked...');
            const spinner = document.getElementById('populateSpinner');
            const text = document.getElementById('populateText');
            try {
                spinner.style.display = 'inline-block';
                text.textContent = 'Populating...';
                // TODO: Implement populate proforma functionality
                alert('Populate proforma functionality not yet implemented');
            } catch (error) {
                console.error('Populate proforma failed:', error);
                alert('Failed to populate proforma: ' + error.message);
            } finally {
                spinner.style.display = 'none';
                text.textContent = 'Populate';
            }
        });
    }

    // Add click handler for save prompts button
    const savePromptsBtn = document.getElementById('savePromptsBtn');
    if (savePromptsBtn) {
        savePromptsBtn.addEventListener('click', async () => {
            console.log('[DEBUG] Save prompts button clicked...');
            try {
                const prompts = {
                    issues: document.getElementById('promptIssues').value,
                    guidelines: document.getElementById('promptGuidelines').value,
                    noteGenerator: document.getElementById('promptNoteGenerator').value
                };
                const response = await fetch(`${window.SERVER_URL}/updatePrompts`, {
                    method: 'POST',
                    headers: { 
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${await auth.currentUser.getIdToken()}`
                    },
                    body: JSON.stringify({ updatedPrompts: prompts })
                });
                const data = await response.json();
                if (data.success) {
                    alert('Prompts saved successfully!');
                } else {
                    throw new Error(data.message || 'Failed to save prompts');
                }
            } catch (error) {
                console.error('Failed to save prompts:', error);
                alert('Failed to save prompts: ' + error.message);
            }
        });
    }

    // Add click handlers for test buttons
    const testServerBtn = document.getElementById('testServerBtn');
    const testGitHubBtn = document.getElementById('testGitHubBtn');
    const testOpenAIBtn = document.getElementById('testOpenAIBtn');

    if (testServerBtn) {
        testServerBtn.addEventListener('click', async () => {
            console.log('[DEBUG] Test server button clicked...');
            try {
                const response = await fetch(`${window.SERVER_URL}/test`);
                const data = await response.json();
                alert(data.message || 'Server is running!');
            } catch (error) {
                console.error('Server test failed:', error);
                alert('Server test failed: ' + error.message);
            }
        });
    }

    if (testGitHubBtn) {
        testGitHubBtn.addEventListener('click', async () => {
            console.log('[DEBUG] Test GitHub button clicked...');
            try {
                const response = await fetch(`${window.SERVER_URL}/testGitHub`);
                const data = await response.json();
                alert(data.message || 'GitHub access is working!');
            } catch (error) {
                console.error('GitHub test failed:', error);
                alert('GitHub test failed: ' + error.message);
            }
        });
    }
        
    if (testOpenAIBtn) {
        testOpenAIBtn.addEventListener('click', async () => {
            console.log('[DEBUG] Test OpenAI button clicked...');
            try {
                const response = await fetch(`${window.SERVER_URL}/testOpenAI`);
                const data = await response.json();
                alert(data.message || 'OpenAI access is working!');
            } catch (error) {
                console.error('OpenAI test failed:', error);
                alert('OpenAI test failed: ' + error.message);
            }
        });
    }

    // Listen for changes on the main text input to auto-save
    const userInput = document.getElementById('userInput');
    if (userInput) {
        userInput.addEventListener('input', debouncedSaveState);
    }

    // --- Speech Recognition Setup ---
    const recordBtn = document.getElementById('recordBtn');
    const userInputEl = document.getElementById('userInput');
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    let recognition;
    let isRecording = false;
    let finalTranscript = '';

    if (SpeechRecognition) {
        recognition = new SpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = 'en-US';

        recognition.onstart = () => {
            isRecording = true;
            finalTranscript = userInputEl.value;
            recordBtn.classList.add('recording');
            recordBtn.innerHTML = `<span id="recordSymbol" class="record-symbol"></span>Stop`;
            console.log('Speech recognition started.');
        };

        recognition.onend = () => {
            isRecording = false;
            recordBtn.classList.remove('recording');
            recordBtn.innerHTML = `<span id="recordSymbol" class="record-symbol"></span>Record`;
            debouncedSaveState();
            console.log('Speech recognition ended.');
        };

        recognition.onerror = (event) => {
            console.error('Speech recognition error:', event.error);
            alert(`Speech recognition error: ${event.error}. Please ensure microphone access is granted.`);
            isRecording = false;
        };

        recognition.onresult = (event) => {
            let interimTranscript = '';
            let currentFinalTranscript = '';

            for (let i = event.resultIndex; i < event.results.length; ++i) {
                const transcriptPart = event.results[i][0].transcript;
                if (event.results[i].isFinal) {
                    currentFinalTranscript += transcriptPart;
                } else {
                    interimTranscript += transcriptPart;
                }
            }
            
            // Append newly finalized parts to the stored final transcript
            if (currentFinalTranscript) {
                // Add a space if the previous text doesn't end with one
                if (finalTranscript.length > 0 && !/\s$/.test(finalTranscript)) {
                    finalTranscript += ' ';
                }
                finalTranscript += currentFinalTranscript;
            }

            userInputEl.value = finalTranscript + interimTranscript;
        };

        recordBtn.addEventListener('click', () => {
            if (isRecording) {
                recognition.stop();
            } else {
                recognition.start();
            }
        });

    } else {
        console.warn('Speech Recognition not supported by this browser.');
        if (recordBtn) recordBtn.style.display = 'none';
    }
    // --- End Speech Recognition ---
});

// Logging utility
const Logger = {
    levels: {
        DEBUG: 'debug',
        INFO: 'info',
        WARN: 'warn',
        ERROR: 'error'
    },
    
    _formatMessage(level, message, data = null) {
        const timestamp = new Date().toISOString();
        const formattedMessage = `[${timestamp}] [${level.toUpperCase()}] ${message}`;
        return data ? `${formattedMessage} ${JSON.stringify(data)}` : formattedMessage;
    },
    
    debug(message, data = null) {
        if (process.env.NODE_ENV === 'development') {
            console.debug(this._formatMessage(this.levels.DEBUG, message, data));
        }
    },
    
    info(message, data = null) {
        console.info(this._formatMessage(this.levels.INFO, message, data));
    },
    
    warn(message, data = null) {
        console.warn(this._formatMessage(this.levels.WARN, message, data));
    },
    
    error(message, data = null) {
        console.error(this._formatMessage(this.levels.ERROR, message, data));
    }
};

// Replace console.log calls with Logger
// Example usage:
// Logger.debug('Starting initializeApp...');
// Logger.info('Application initialized successfully', { userId: user.uid });
// Logger.error('Failed to load data', { error: error.message, stack: error.stack });

// Make dynamic advice functions globally accessible for onclick handlers
window.handleSuggestionAction = handleSuggestionAction;
window.confirmModification = confirmModification;
window.cancelModification = cancelModification;
window.copyUpdatedTranscript = copyUpdatedTranscript;
window.replaceOriginalTranscript = replaceOriginalTranscript;
window.applyAllDecisions = applyAllDecisions;
window.generateFakeClinicalInteraction = generateFakeClinicalInteraction;
window.switchChat = switchChat;
window.deleteChat = deleteChat;
window.startNewChat = startNewChat;

// Show clinical issues dropdown in summary1
async function showClinicalIssuesDropdown() {
    console.log('[DEBUG] showClinicalIssuesDropdown called');
    
    try {
        // Load clinical issues from JSON file
        const response = await fetch('./clinical_issues.json');
        if (!response.ok) {
            throw new Error(`Failed to load clinical issues: ${response.status}`);
        }
        
        const clinicalIssues = await response.json();
        console.log('[DEBUG] Loaded clinical issues:', {
            obstetrics: clinicalIssues.obstetrics?.length,
            gynecology: clinicalIssues.gynecology?.length
        });
        
        // Create dropdown HTML
        let dropdownHtml = `
            <div class="clinical-issues-selector">
                <h3>🧪 Generate Fake Clinical Interaction</h3>
                <p>Select a clinical issue to generate a realistic clinical interaction scenario:</p>
                
                <div class="issue-category">
                    <h4>Clinical Issues</h4>
                    <select id="clinical-issues-dropdown" class="clinical-dropdown">
                        <option value="">Select a clinical issue...</option>
                        <optgroup label="Obstetrics">
        `;
        
        // Add obstetrics options
        clinicalIssues.obstetrics.forEach((issue, index) => {
            dropdownHtml += `<option value="${issue}">${issue}</option>`;
        });
        
        dropdownHtml += `
                        </optgroup>
                        <optgroup label="Gynecology">
        `;
        
        // Add gynecology options
        clinicalIssues.gynecology.forEach((issue, index) => {
            dropdownHtml += `<option value="${issue}">${issue}</option>`;
        });
        
        dropdownHtml += `
                        </optgroup>
                    </select>
                </div>
                
                <div class="action-buttons">
                    <button id="generate-interaction-btn" class="nav-btn primary" disabled>
                        <span id="generate-spinner" class="spinner" style="display: none;"></span>
                        <span id="generate-text">Generate Interaction</span>
                    </button>
                    <button id="cancel-generation-btn" class="nav-btn secondary">Cancel</button>
                </div>
                
                <div id="generation-status" class="generation-status" style="display: none;"></div>
            </div>
        `;
        
        // Display in summary1
        appendToSummary1(dropdownHtml, true); // Clear existing content
        
        // Add event listeners for the single dropdown
        const clinicalDropdown = document.getElementById('clinical-issues-dropdown');
        const generateBtn = document.getElementById('generate-interaction-btn');
        const cancelBtn = document.getElementById('cancel-generation-btn');
        
        function updateGenerateButton() {
            const selectedValue = clinicalDropdown?.value || '';
            const hasSelection = selectedValue.trim() !== '';
            
            if (generateBtn) {
                generateBtn.disabled = !hasSelection;
            }
        }
        
        if (clinicalDropdown) {
            clinicalDropdown.addEventListener('change', updateGenerateButton);
        }
        
        if (generateBtn) {
            generateBtn.addEventListener('click', async () => {
                const selectedIssue = clinicalDropdown?.value || '';
                
                if (selectedIssue) {
                    await generateFakeClinicalInteraction(selectedIssue);
                }
            });
        }
        
        if (cancelBtn) {
            cancelBtn.addEventListener('click', () => {
                appendToSummary1('Clinical interaction generation cancelled.\n\n', true);
            });
        }
        
    } catch (error) {
        console.error('[DEBUG] Error showing clinical issues dropdown:', error);
        appendToSummary1(`❌ **Error loading clinical issues:** ${error.message}\n\nPlease try again or contact support.\n\n`, true);
    }
}

// Generate fake clinical interaction based on selected issue
async function generateFakeClinicalInteraction(selectedIssue) {
    console.log('[DEBUG] generateFakeClinicalInteraction called with:', selectedIssue);
    
    const generateBtn = document.getElementById('generate-interaction-btn');
    const generateSpinner = document.getElementById('generate-spinner');
    const generateText = document.getElementById('generate-text');
    const statusDiv = document.getElementById('generation-status');
    
    try {
        // Update UI to show loading state
        if (generateBtn) generateBtn.disabled = true;
        if (generateSpinner) generateSpinner.style.display = 'inline';
        if (generateText) generateText.textContent = 'Generating...';
        if (statusDiv) {
            statusDiv.style.display = 'block';
            statusDiv.innerHTML = `<p>🔄 Generating realistic clinical interaction for: <strong>${selectedIssue}</strong></p>`;
        }
        
        // Load prompts.json to get the testTranscript prompt
        console.log('[DEBUG] Loading prompts.json...');
        const promptsResponse = await fetch('./prompts.json');
        if (!promptsResponse.ok) {
            throw new Error(`Failed to load prompts: ${promptsResponse.status}`);
        }
        
        const prompts = await promptsResponse.json();
        const testTranscriptPrompt = prompts.testTranscript?.prompt;
        
        if (!testTranscriptPrompt) {
            throw new Error('Test transcript prompt not found in prompts.json');
        }
        
        // Combine the prompt with the selected clinical issue
        const fullPrompt = testTranscriptPrompt + selectedIssue;
        console.log('[DEBUG] Generated prompt:', {
            promptLength: fullPrompt.length,
            clinicalIssue: selectedIssue
        });
        
        // Get user authentication
        const user = auth.currentUser;
        if (!user) {
            throw new Error('User not authenticated');
        }
        
        const idToken = await user.getIdToken();
        console.log('[DEBUG] Got authentication token');
        
        // Call the API with the correct prompt format
        console.log('[DEBUG] Calling generateFakeClinicalInteraction API...');
        const response = await fetch(`${window.SERVER_URL}/generateFakeClinicalInteraction`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${idToken}`
            },
            body: JSON.stringify({
                prompt: fullPrompt
            })
        });
        
        console.log('[DEBUG] API response received:', {
            status: response.status,
            ok: response.ok,
            statusText: response.statusText
        });
        
        if (!response.ok) {
            const errorText = await response.text();
            console.error('[DEBUG] API error response:', {
                status: response.status,
                statusText: response.statusText,
                errorText
            });
            throw new Error(`API error: ${response.status} - ${errorText}`);
        }
        
        const result = await response.json();
        
        // Log the full response structure for debugging
        console.log('[DEBUG] Full API response structure:', {
            success: result.success,
            hasResponse: !!result.response,
            hasTranscript: !!result.transcript,
            responseKeys: result.response ? Object.keys(result.response) : 'no response object',
            resultKeys: Object.keys(result),
            fullResult: result
        });
        
        // Extract the actual transcript content from the response structure
        const transcript = result.response?.content || result.transcript || null;
        
        console.log('[DEBUG] Transcript extraction result:', {
            transcript: transcript,
            transcriptLength: transcript?.length,
            transcriptPreview: transcript ? transcript.substring(0, 200) + '...' : 'NO TRANSCRIPT'
        });
        
        if (!result.success) {
            throw new Error(result.error || 'Failed to generate clinical interaction');
        }
        
        if (!transcript) {
            throw new Error('No transcript content received from server');
        }
        
        // Update status
        if (statusDiv) {
            statusDiv.innerHTML = `<p>✅ Successfully generated clinical interaction for: <strong>${selectedIssue}</strong></p>`;
        }
        
        // Put the generated transcript in the user input textarea
        const userInput = document.getElementById('userInput');
        console.log('[DEBUG] userInput element check:', {
            elementFound: !!userInput,
            elementId: userInput?.id,
            elementType: userInput?.tagName,
            hasTranscript: !!transcript,
            currentValue: userInput?.value?.length || 0
        });
        
        if (userInput && transcript) {
            userInput.value = transcript;
            console.log('[DEBUG] Transcript added to user input textarea:', {
                transcriptLength: transcript.length,
                newValueLength: userInput.value.length,
                assignmentSuccessful: userInput.value === transcript,
                preview: transcript.substring(0, 100) + '...'
            });
        } else {
            console.error('[DEBUG] Failed to add transcript to userInput:', {
                hasUserInput: !!userInput,
                hasTranscript: !!transcript,
                transcriptType: typeof transcript
            });
        }
        
        // Show success message in summary1 (append, don't clear)
        const successMessage = `## ✅ Fake Clinical Interaction Generated\n\n` +
                              `**Clinical Issue:** ${selectedIssue}\n\n` +
                              `**Status:** Successfully generated realistic clinical interaction scenario\n\n` +
                              `**Transcript Length:** ${transcript.length} characters\n\n` +
                              `**Next Steps:** The generated transcript has been placed in the input area. You can now:\n` +
                              `- Use "Find Relevant Guidelines" to analyze it against clinical guidelines\n` +
                              `- Use "Process" to run the complete workflow\n` +
                              `- Edit the transcript if needed before analysis\n\n`;
        
        appendToSummary1(successMessage, false); // Don't clear existing content
        
    } catch (error) {
        console.error('[DEBUG] Error generating fake clinical interaction:', {
            error: error.message,
            stack: error.stack,
            selectedIssue
        });
        
        // Update UI to show error
        if (statusDiv) {
            statusDiv.innerHTML = `<p>❌ Error: ${error.message}</p>`;
        }
        
        // Show error message in summary1 (append, don't clear)
        const errorMessage = `## ❌ Generation Failed\n\n` +
                            `**Error:** ${error.message}\n\n` +
                            `**Selected Issue:** ${selectedIssue}\n\n` +
                            `Please try again or contact support if the problem persists.\n\n`;
        
        appendToSummary1(errorMessage, false); // Don't clear existing content
        
    } finally {
        // Reset button state
        if (generateBtn) generateBtn.disabled = false;
        if (generateSpinner) generateSpinner.style.display = 'none';
        if (generateText) generateText.textContent = 'Generate Interaction';
        
        console.log('[DEBUG] generateFakeClinicalInteraction cleanup completed');
    }
}

// Comprehensive workflow processing function
async function processWorkflow() {
    console.log('[DEBUG] processWorkflow started');
    
    const processBtn = document.getElementById('processBtn');
    const processSpinner = document.getElementById('processSpinner');
    const originalText = processBtn?.textContent || 'Process';
    
    try {
        // Check if we have transcript content
        const transcript = document.getElementById('userInput').value;
        if (!transcript) {
            alert('Please enter some text first');
            return;
        }

        // Set loading state
        if (processBtn) processBtn.disabled = true;
        if (processSpinner) processSpinner.style.display = 'inline';

        // Initialize the workflow summary
        const workflowStart = '# Complete Workflow Processing\n\nStarting comprehensive analysis workflow...\n\n';
        appendToSummary1(workflowStart);

        console.log('[DEBUG] processWorkflow: Starting step 1 - Find Relevant Guidelines');
        
        // Step 1: Find Relevant Guidelines
        const step1Status = '## Step 1: Finding Relevant Guidelines\n\n';
        appendToSummary1(step1Status, false);
        
        try {
            await findRelevantGuidelines(true); // Suppress header since we show our own step header
            console.log('[DEBUG] processWorkflow: Step 1 completed successfully');
            
            const step1Complete = '✅ **Step 1 Complete:** Relevant guidelines identified\n\n';
            appendToSummary1(step1Complete, false);
            
        } catch (error) {
            console.error('[DEBUG] processWorkflow: Step 1 failed:', error.message);
            throw new Error(`Step 1 (Find Guidelines) failed: ${error.message}`);
        }

        // Check if we have relevant guidelines before proceeding
        if (!window.relevantGuidelines || window.relevantGuidelines.length === 0) {
            console.log('[DEBUG] processWorkflow: No relevant guidelines found, cannot proceed');
            throw new Error('No relevant guidelines were found. Cannot proceed with analysis.');
        }

        console.log('[DEBUG] processWorkflow: Starting step 2 - Check Against Guidelines');
        
        // Step 2: Check Against Guidelines
        const step2Status = '## Step 2: Analysing Against Guidelines\n\n';
        appendToSummary1(step2Status, false);
        
        try {
            await checkAgainstGuidelines(true); // Suppress header since we show our own step header
            console.log('[DEBUG] processWorkflow: Step 2 completed successfully');
            
            const step2Complete = '✅ **Step 2 Complete:** Guideline analysis finished\n\n';
            appendToSummary1(step2Complete, false);
            
        } catch (error) {
            console.error('[DEBUG] processWorkflow: Step 2 failed:', error.message);
            throw new Error(`Step 2 (Check Guidelines) failed: ${error.message}`);
        }

        // Check if we have analysis data before proceeding
        if (!window.latestAnalysis) {
            console.log('[DEBUG] processWorkflow: No analysis data found, cannot proceed');
            throw new Error('No analysis data was generated. Cannot proceed with dynamic advice.');
        }

        console.log('[DEBUG] processWorkflow: Starting step 3 - Make Advice Dynamic');
        
        // Step 3: Make Advice Dynamic
        const step3Status = '## Step 3: Creating Interactive Suggestions\n\n';
        appendToSummary1(step3Status, false);
        
        try {
            await dynamicAdvice(
                window.latestAnalysis.transcript,
                window.latestAnalysis.analysis,
                window.latestAnalysis.guidelineId,
                window.latestAnalysis.guidelineTitle
            );
            console.log('[DEBUG] processWorkflow: Step 3 completed successfully');
            
            const step3Complete = '✅ **Step 3 Complete:** Interactive suggestions ready\n\n';
            appendToSummary1(step3Complete, false);
            
            // Hide the "Make Advice Dynamic" button since it's now redundant
            const makeDynamicAdviceBtn = document.getElementById('makeDynamicAdviceBtn');
            if (makeDynamicAdviceBtn) {
                makeDynamicAdviceBtn.style.display = 'none';
                console.log('[DEBUG] processWorkflow: Hidden makeDynamicAdviceBtn as it\'s now redundant');
            }
            
        } catch (error) {
            console.error('[DEBUG] processWorkflow: Step 3 failed:', error.message);
            throw new Error(`Step 3 (Dynamic Advice) failed: ${error.message}`);
        }

        // Workflow completion summary
        const workflowComplete = `## 🎉 Workflow Complete!\n\n` +
                                `All three steps have been completed successfully:\n` +
                                `1. ✅ Found relevant guidelines\n` +
                                `2. ✅ Analyzed against most relevant guideline\n` +
                                `3. ✅ Generated interactive suggestions\n\n` +
                                `**Next Steps:** Review the suggestions above and make your decisions (Accept/Reject/Modify), then click "Apply All Decisions" to update your transcript.\n\n`;
        
        appendToSummary1(workflowComplete, false);
        
        console.log('[DEBUG] processWorkflow: Complete workflow finished successfully');

    } catch (error) {
        console.error('[DEBUG] processWorkflow: Workflow failed:', {
            error: error.message,
            stack: error.stack
        });
        
        // Display error in summary1
        const errorMessage = `\n❌ **Workflow Error:** ${error.message}\n\n` +
                            `The workflow was interrupted. You can try running individual steps manually or contact support if the problem persists.\n\n`;
        appendToSummary1(errorMessage, false);
        
        alert(`Workflow failed: ${error.message}`);
        
    } finally {
        // Reset button state
        if (processBtn) {
            processBtn.disabled = false;
            processBtn.textContent = originalText;
        }
        if (processSpinner) processSpinner.style.display = 'none';
        
        console.log('[DEBUG] processWorkflow: Cleanup completed');
    }
}

// --- Chat History Management ---

let saveStateTimeout = null;

function debouncedSaveState() {
    if (saveStateTimeout) {
        clearTimeout(saveStateTimeout);
    }
    saveStateTimeout = setTimeout(() => {
        saveCurrentChatState();
    }, 1500); // Save 1.5 seconds after the last change
}

function getChatState() {
    const userInput = document.getElementById('userInput');
    const summary1 = document.getElementById('summary1');
    return {
        userInputContent: userInput ? userInput.value : '',
        summary1Content: summary1 ? summary1.innerHTML : '',
        relevantGuidelines: window.relevantGuidelines,
        latestAnalysis: window.latestAnalysis,
        currentAdviceSession: window.currentAdviceSession,
        currentSuggestions: window.currentSuggestions,
        userDecisions: window.userDecisions,
        lastUpdatedTranscript: window.lastUpdatedTranscript
    };
}

function loadChatState(state) {
    document.getElementById('userInput').value = state.userInputContent || '';
    document.getElementById('summary1').innerHTML = state.summary1Content || '';
    window.relevantGuidelines = state.relevantGuidelines || null;
    window.latestAnalysis = state.latestAnalysis || null;
    window.currentAdviceSession = state.currentAdviceSession || null;
    window.currentSuggestions = state.currentSuggestions || [];
    window.userDecisions = state.userDecisions || {};
    window.lastUpdatedTranscript = state.lastUpdatedTranscript || null;
}

function saveCurrentChatState() {
    if (!currentChatId) return;

    const chatIndex = chatHistory.findIndex(chat => chat.id === currentChatId);
    if (chatIndex === -1) {
        console.warn(`Could not find chat with id ${currentChatId} to save.`);
        return;
    }

    const state = getChatState();
    const previewText = state.userInputContent.substring(0, 40).replace(/\n/g, ' ') || 'Empty chat';

    chatHistory[chatIndex].state = state;
    chatHistory[chatIndex].preview = `${previewText}...`;
    
    // Move the current chat to the top of the list
    const currentChat = chatHistory.splice(chatIndex, 1)[0];
    chatHistory.unshift(currentChat);
    
    localStorage.setItem('chatHistory', JSON.stringify(chatHistory));
    renderChatHistory(); // Re-render to show updated preview and order
    console.log(`[CHAT] Saved state for chat: ${currentChatId}`);
}

function startNewChat() {
    saveCurrentChatState(); // Save the state of the chat we are leaving

    const newChatId = Date.now();
    currentChatId = newChatId;

    const newChat = {
        id: newChatId,
        title: `Chat - ${new Date(newChatId).toLocaleString()}`,
        preview: 'New chat...',
        state: {
            userInputContent: '',
            summary1Content: ''
        }
    };
    
    chatHistory.unshift(newChat);
    loadChatState(newChat.state);

    localStorage.setItem('chatHistory', JSON.stringify(chatHistory));
    renderChatHistory();
    document.getElementById('userInput').focus();
    console.log(`[CHAT] Started new chat: ${newChatId}`);
}

function switchChat(chatId) {
    if (chatId === currentChatId) return;

    saveCurrentChatState(); // Save the current chat before switching

    const chat = chatHistory.find(c => c.id === chatId);
    if (chat) {
        currentChatId = chatId;
        loadChatState(chat.state);
        renderChatHistory();
        console.log(`[CHAT] Switched to chat: ${chatId}`);
    } else {
        console.error(`[CHAT] Could not find chat with id: ${chatId}`);
    }
}

function deleteChat(chatId, event) {
    event.stopPropagation(); // Prevent switchChat from firing

    if (!confirm('Are you sure you want to delete this chat?')) return;

    chatHistory = chatHistory.filter(c => c.id !== chatId);
    localStorage.setItem('chatHistory', JSON.stringify(chatHistory));

    if (currentChatId === chatId) {
        // If we deleted the active chat, load the newest one or start fresh
        if (chatHistory.length > 0) {
            switchChat(chatHistory[0].id);
        } else {
            startNewChat();
        }
    }
    
    renderChatHistory();
    console.log(`[CHAT] Deleted chat: ${chatId}`);
}


function renderChatHistory() {
    console.log('[DEBUG] renderChatHistory called');
    const historyList = document.getElementById('historyList');
    
    console.log('[DEBUG] renderChatHistory:', {
        historyListExists: !!historyList,
        chatHistoryLength: chatHistory.length,
        currentChatId: currentChatId,
        chatHistoryData: chatHistory
    });
    
    if (!historyList) {
        console.error('[DEBUG] historyList element not found!');
        return;
    }

    historyList.innerHTML = '';
    console.log('[DEBUG] Cleared historyList innerHTML');
    
    if (chatHistory.length === 0) {
        console.log('[DEBUG] No chat history to render');
        historyList.innerHTML = '<div class="no-chats">No chat history yet</div>';
        return;
    }
    
    chatHistory.forEach((chat, index) => {
        console.log(`[DEBUG] Rendering chat ${index}:`, {
            id: chat.id,
            title: chat.title,
            preview: chat.preview,
            isActive: chat.id === currentChatId
        });
        
        const item = document.createElement('div');
        item.className = `history-item ${chat.id === currentChatId ? 'active' : ''}`;
        item.setAttribute('data-chat-id', chat.id);
        item.onclick = () => switchChat(chat.id);
        
        item.innerHTML = `
            <div class="history-item-title">${chat.title}</div>
            <div class="history-item-preview">${chat.preview}</div>
            <button class="delete-chat-btn" onclick="deleteChat(${chat.id}, event)" title="Delete Chat">&times;</button>
        `;
        historyList.appendChild(item);
        console.log(`[DEBUG] Added chat item ${index} to historyList`);
    });
    
    console.log('[DEBUG] renderChatHistory completed, historyList.children.length:', historyList.children.length);
}

function initializeChatHistory() {
    console.log('[DEBUG] Initializing chat history...');
    
    // Check if required elements exist
    const historyList = document.getElementById('historyList');
    const historyColumn = document.getElementById('historyColumn');
    console.log('[DEBUG] DOM elements check:', {
        historyList: !!historyList,
        historyColumn: !!historyColumn,
        historyListDisplay: historyList ? getComputedStyle(historyList).display : 'not found',
        historyColumnDisplay: historyColumn ? getComputedStyle(historyColumn).display : 'not found'
    });
    
    // Check localStorage
    const savedHistory = localStorage.getItem('chatHistory');
    console.log('[DEBUG] localStorage check:', {
        hasSavedHistory: !!savedHistory,
        savedHistoryLength: savedHistory ? savedHistory.length : 0,
        savedHistoryPreview: savedHistory ? savedHistory.substring(0, 200) + '...' : 'none'
    });
    
    if (savedHistory) {
        try {
            chatHistory = JSON.parse(savedHistory);
            console.log('[DEBUG] Loaded chat history from localStorage:', {
                count: chatHistory.length,
                chatIds: chatHistory.map(c => c.id),
                firstChatPreview: chatHistory[0] ? {
                    id: chatHistory[0].id,
                    title: chatHistory[0].title,
                    preview: chatHistory[0].preview
                } : 'none'
            });
        } catch (error) {
            console.error('[DEBUG] Error parsing saved chat history:', error);
            chatHistory = [];
        }
    } else {
        console.log('[DEBUG] No saved chat history found');
        chatHistory = [];
    }

    if (chatHistory.length > 0) {
        currentChatId = chatHistory[0].id;
        console.log('[DEBUG] Setting current chat ID to:', currentChatId);
        try {
            loadChatState(chatHistory[0].state);
            console.log('[DEBUG] Loaded most recent chat state');
        } catch (error) {
            console.error('[DEBUG] Error loading chat state:', error);
        }
    } else {
        console.log('[DEBUG] No chat history found, starting new chat');
        try {
            startNewChat();
            console.log('[DEBUG] Started new chat, currentChatId:', currentChatId);
        } catch (error) {
            console.error('[DEBUG] Error starting new chat:', error);
        }
    }
    
    console.log('[DEBUG] About to call renderChatHistory...');
    renderChatHistory();
    console.log('[DEBUG] Chat history initialization completed');
}

// Add debugging to the main app initialization
async function initializeMainApp() {
    try {
        console.log('[DEBUG] Initializing main app features...');
        console.log('[DEBUG] DOM ready state:', document.readyState);
        console.log('[DEBUG] Available elements:', {
            historyList: !!document.getElementById('historyList'),
            historyColumn: !!document.getElementById('historyColumn'),
            transcriptColumn: !!document.getElementById('transcriptColumn'),
            userInput: !!document.getElementById('userInput'),
            summary1: !!document.getElementById('summary1')
        });
        
        // Initialize chat history
        console.log('[DEBUG] Calling initializeChatHistory...');
        initializeChatHistory();
        
        // Load guidelines from Firestore on app initialization
        console.log('[DEBUG] Loading guidelines from Firestore...');
        try {
            await window.loadGuidelinesFromFirestore();
            console.log('[DEBUG] Guidelines loaded successfully during initialization');
        } catch (error) {
            console.warn('[DEBUG] Error during initial loadGuidelinesFromFirestore call:', error.message);
            // Don't throw - allow app to continue functioning even if guidelines fail to load
        }
        
        console.log('[DEBUG] Main app initialization completed');
    } catch (error) {
        console.error('[DEBUG] Error initializing main app:', error);
        console.error('[DEBUG] Error stack:', error.stack);
    }
}

// Add debugging to the auth state change handler
window.auth.onAuthStateChanged(async (user) => {
    console.log('[DEBUG] Auth state changed:', {
        hasUser: !!user,
        userEmail: user?.email,
        userDisplayName: user?.displayName
    });
    
    const loading = document.getElementById('loading');
    const landingPage = document.getElementById('landingPage');
    const mainContent = document.getElementById('mainContent');

    console.log('[DEBUG] Page elements found:', {
        loading: !!loading,
        landingPage: !!landingPage,
        mainContent: !!mainContent
    });

    if (user) {
        console.log('[DEBUG] User authenticated, showing main content');
        loading.classList.add('hidden');
        landingPage.classList.add('hidden');
        mainContent.classList.remove('hidden');
        
        // Update user info
        const userLabel = document.getElementById('userLabel');
        const userName = document.getElementById('userName');
        if (userLabel && userName) {
            userName.textContent = user.displayName || user.email || 'User';
            userName.classList.remove('hidden');
            console.log('[DEBUG] Updated user info display');
        }
        
        // Small delay to ensure DOM is fully rendered
        setTimeout(async () => {
            console.log('[DEBUG] Delayed initialization starting...');
            await initializeMainApp();
        }, 100);
        
    } else {
        console.log('[DEBUG] User not authenticated, showing landing page');
        loading.classList.add('hidden');
        mainContent.classList.add('hidden');
        landingPage.classList.remove('hidden');
        
        // Set up Google Sign-in button listener
        setupGoogleSignIn();
    }
});
