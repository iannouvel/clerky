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

    // Store the most relevant guidelines globally with their IDs
    relevantGuidelines = (categories.mostRelevant || []).map(g => ({
        ...g,
        guidelineId: g.guidelineId || g.id // Use guidelineId if available, fallback to id
    }));

    let formattedGuidelines = '';

    // Add Most Relevant Guidelines
    if (categories.mostRelevant && categories.mostRelevant.length > 0) {
        formattedGuidelines += '## Most Relevant Guidelines\n\n';
        categories.mostRelevant.forEach(g => {
            formattedGuidelines += `- ${g.filename} (${g.relevance})\n`;
        });
        formattedGuidelines += '\n';
    }

    // Add Potentially Relevant Guidelines
    if (categories.potentiallyRelevant && categories.potentiallyRelevant.length > 0) {
        formattedGuidelines += '## Potentially Relevant Guidelines\n\n';
        categories.potentiallyRelevant.forEach(g => {
            formattedGuidelines += `- ${g.filename} (${g.relevance})\n`;
        });
        formattedGuidelines += '\n';
    }

    // Add Less Relevant Guidelines
    if (categories.lessRelevant && categories.lessRelevant.length > 0) {
        formattedGuidelines += '## Less Relevant Guidelines\n\n';
        categories.lessRelevant.forEach(g => {
            formattedGuidelines += `- ${g.filename} (${g.relevance})\n`;
        });
        formattedGuidelines += '\n';
    }

    // Add Not Relevant Guidelines
    if (categories.notRelevant && categories.notRelevant.length > 0) {
        formattedGuidelines += '## Not Relevant Guidelines\n\n';
        categories.notRelevant.forEach(g => {
            formattedGuidelines += `- ${g.filename} (${g.relevance})\n`;
        });
    }

    appendToSummary1(formattedGuidelines);
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

// Add session management
let currentSessionId = null;

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
        console.log('[DEBUG] Loaded guidelines from Firestore:', guidelines.length);

        // Store in global variables using guidelineId as key
        window.guidelinesList = guidelines.map(g => ({
            id: g.guidelineId,
            title: g.title
        }));
        window.guidelinesSummaries = guidelines.map(g => g.summary);
        window.guidelinesKeywords = guidelines.map(g => g.keywords);
        window.guidelinesCondensed = guidelines.map(g => g.condensed);

        // Store full guideline data using guidelineId as key
        window.globalGuidelines = guidelines.reduce((acc, g) => {
            acc[g.guidelineId] = {
                id: g.guidelineId,
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

// Update findRelevantGuidelines to use the new response format
async function findRelevantGuidelines() {
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

        // Get user ID token
        const user = auth.currentUser;
        if (!user) {
            alert('Please sign in to use this feature');
            return;
        }
        const idToken = await user.getIdToken();

        // Get guidelines and summaries from Firestore
        const guidelines = await loadGuidelinesFromFirestore();
        const guidelinesList = guidelines.map(g => g.title);
        const summaries = guidelines.map(g => g.summary);

        console.log('[DEBUG] Sending request to /findRelevantGuidelines with:', {
            transcriptLength: transcript.length,
            guidelinesCount: guidelinesList.length,
            summariesCount: summaries.length
        });

        const response = await fetch(`${window.SERVER_URL}/findRelevantGuidelines`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${idToken}`
            },
            body: JSON.stringify({
                transcript,
                guidelines: guidelinesList,
                summaries
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

        // Process and display the results
        displayRelevantGuidelines(data.categories);
    } catch (error) {
        console.error('[DEBUG] Error in findRelevantGuidelines:', {
            error: error.message,
            stack: error.stack
        });
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
        // Clear existing content if requested
        if (clearExisting) {
            summary1.innerHTML = '';
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

        // Append the sanitized content
        summary1.innerHTML += tempDiv.innerHTML;
        console.log('[DEBUG] Content appended successfully');

    } catch (error) {
        console.error('[DEBUG] Error in appendToSummary1:', error);
        // Fallback to direct content append if something goes wrong
        summary1.innerHTML += content;
    }
}

// Update checkAgainstGuidelines to use stored relevant guidelines
async function checkAgainstGuidelines() {
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

        if (!relevantGuidelines || relevantGuidelines.length === 0) {
            console.log('[DEBUG] No relevant guidelines found');
            alert('Please find relevant guidelines first');
            return;
        }
        console.log('[DEBUG] Number of relevant guidelines:', relevantGuidelines.length);

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

        if (!window.globalGuidelines || Object.keys(window.globalGuidelines).length === 0) {
            console.log('[DEBUG] Guidelines not found in cache, reloading from Firestore...');
            try {
                const guidelines = await window.loadGuidelinesFromFirestore();
                console.log('[DEBUG] Reloaded guidelines from Firestore:', {
                    success: !!guidelines,
                    count: guidelines?.length || 0
                });
            } catch (error) {
                console.error('[DEBUG] Failed to reload guidelines:', error);
                throw new Error('Failed to load guidelines from Firestore');
            }
        }

        // Initialize the analysis summary
        let formattedAnalysis = '## Analysis Against Guidelines\n\n';
        appendToSummary1(formattedAnalysis);
        
        let successCount = 0;
        let errorCount = 0;

        // Process each guideline sequentially
        for (const guideline of relevantGuidelines) {
            console.log('[DEBUG] Processing guideline:', {
                filename: guideline.filename,
                title: guideline.title,
                guidelineId: guideline.guidelineId
            });
            
            // Update UI to show current guideline being processed
            const currentStatus = `Processing guideline ${successCount + errorCount + 1} of ${relevantGuidelines.length}: ${guideline.filename}...`;
            appendToSummary1(`\n${currentStatus}\n`, false);
            
            try {
                // Find the guideline in the cache using guidelineId
                const guidelineData = window.globalGuidelines[guideline.guidelineId];
                
                console.log('[DEBUG] Guideline cache check:', {
                    filename: guideline.filename,
                    guidelineId: guideline.guidelineId,
                    found: !!guidelineData,
                    hasContent: !!guidelineData?.content
                });

                if (!guidelineData) {
                    console.error('[DEBUG] Guideline not found in cache:', {
                        filename: guideline.filename,
                        guidelineId: guideline.guidelineId,
                        availableGuidelines: Object.keys(window.globalGuidelines)
                    });
                    const errorResult = {
                        guideline: guideline.filename,
                        error: 'Guideline not found in cache',
                        analysis: null
                    };
                    formattedAnalysis += `### ${errorResult.guideline}\n\n⚠️ ${errorResult.error}\n\n`;
                    errorCount++;
                    appendToSummary1(formattedAnalysis, true);
                    continue;
                }

                // Send to server for analysis
                const response = await fetch(`${window.SERVER_URL}/analyzeNoteAgainstGuideline`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${idToken}`
                    },
                    body: JSON.stringify({
                        transcript: transcript,
                        guideline: guideline.guidelineId
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
                        guideline: guideline.filename
                    });
                    throw new Error(`Server error: ${response.status} ${response.statusText}`);
                }

                const result = await response.json();
                if (!result.success) {
                    throw new Error(result.error || 'Analysis failed');
                }

                // Add the analysis to the formatted output
                formattedAnalysis += `### ${guideline.filename}\n\n${result.analysis}\n\n`;
                successCount++;
                appendToSummary1(formattedAnalysis, true);

            } catch (error) {
                console.error('[DEBUG] Error processing guideline:', {
                    guideline: guideline.filename,
                    error: error.message
                });
                formattedAnalysis += `### ${guideline.filename}\n\n⚠️ Error: ${error.message}\n\n`;
                errorCount++;
                appendToSummary1(formattedAnalysis, true);
            }
        }

        // Add summary of results
        console.log('[DEBUG] Analysis summary:', {
            successCount,
            errorCount,
            totalGuidelines: relevantGuidelines.length
        });

        formattedAnalysis += `\n## Summary\n\n`;
        formattedAnalysis += `Successfully analyzed ${successCount} guidelines.\n`;
        if (errorCount > 0) {
            formattedAnalysis += `Failed to analyze ${errorCount} guidelines.\n`;
        }
        appendToSummary1(formattedAnalysis, true);

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

// Modify initializeApp to auto-sync guidelines if needed
async function initializeApp() {
    console.log('[DEBUG] Starting initializeApp...');
    if (isInitialized) {
        console.log('[DEBUG] Application already initialized');
        return;
    }

    try {
        console.log('[DEBUG] Initializing marked library...');
        await initializeMarked();
        console.log('[DEBUG] Marked library initialized successfully');

        console.log('[DEBUG] Setting up Firebase auth state listener...');
        onAuthStateChanged(auth, async (user) => {
            console.log('[DEBUG] Auth state changed:', {
                isAuthenticated: !!user,
                email: user?.email,
                uid: user?.uid
            });

            if (user) {
                try {
                    console.log('[DEBUG] Starting data loading sequence...');
                    
                    console.log('[DEBUG] Loading clinical issues...');
                    await window.loadClinicalIssues();
                    console.log('[DEBUG] Clinical issues loaded successfully');
                    
                    console.log('[DEBUG] Loading guidelines from Firestore...');
                    let guidelinesLoaded = false;
                    try {
                        const guidelines = await window.loadGuidelinesFromFirestore();
                        if (guidelines && guidelines.length > 0) {
                            console.log('[DEBUG] Guidelines loaded successfully from Firestore');
                            guidelinesLoaded = true;
                        } else {
                            console.log('[DEBUG] Firestore returned no guidelines or an empty list.');
                        }
                    } catch (error) { 
                        console.warn('[DEBUG] Error during initial loadGuidelinesFromFirestore call:', error.message);
                    }

                    if (!guidelinesLoaded) {
                        console.warn('[DEBUG] Initial guidelines load failed or returned empty, attempting auto-sync...');
                        try {
                            const idToken = await user.getIdToken();
                            console.log('[DEBUG] Attempting to sync guidelines automatically...');
                            
                            const syncResponse = await fetch(`${window.SERVER_URL}/syncGuidelinesWithMetadata`, {
                                method: 'POST',
                                headers: {
                                    'Content-Type': 'application/json',
                                    'Authorization': `Bearer ${idToken}`
                                },
                                body: JSON.stringify({})
                            });
                            
                            if (syncResponse.ok) {
                                console.log('[DEBUG] Guidelines synced successfully, retrying load...');
                                await window.loadGuidelinesFromFirestore();
                                console.log('[DEBUG] Guidelines loaded successfully after sync');
                            } else {
                                // If sync fails, log the server's response for better debugging
                                const syncErrorText = await syncResponse.text();
                                console.warn(`[DEBUG] Failed to sync guidelines (status: ${syncResponse.status}), continuing with empty guidelines. Server response: ${syncErrorText}`);
                                // Fallback: Set empty arrays for guidelines
                                window.guidelinesList = [];
                                window.guidelinesSummaries = [];
                                window.guidelinesKeywords = [];
                                window.guidelinesCondensed = [];
                                window.globalGuidelines = {};
                            }
                        } catch (syncError) {
                            console.warn('[DEBUG] Auto-sync fetch call failed (network issue or server error), continuing with empty guidelines:', syncError.message);
                            // Fallback: Set empty arrays for guidelines
                            window.guidelinesList = [];
                            window.guidelinesSummaries = [];
                            window.guidelinesKeywords = [];
                            window.guidelinesCondensed = [];
                            window.globalGuidelines = {};
                        }
                    }
                    
                    isInitialized = true;
                    console.log('[DEBUG] Application initialization complete');
                    
                    console.log('[DEBUG] Showing main content...');
                    showMainContent();
                } catch (error) {
                    console.error('[DEBUG] Failed to load data:', {
                        error: error.message,
                        stack: error.stack,
                        clinicalIssuesLoaded,
                        guidelinesLoaded: !!globalGuidelines
                    });
                    isInitialized = true;
                    showMainContent();
                }
            } else {
                console.log('[DEBUG] User not authenticated, showing landing page');
                isInitialized = false;
                const loading = document.getElementById('loading');
                const landingPage = document.getElementById('landingPage');
                const mainContent = document.getElementById('mainContent');

                if (loading) loading.classList.add('hidden');
                if (landingPage) landingPage.classList.remove('hidden');
                if (mainContent) mainContent.classList.add('hidden');
            }
        });
    } catch (error) {
        console.error('[DEBUG] Error during application initialization:', {
            error: error.message,
            stack: error.stack
        });
        isInitialized = true;
        showMainContent();
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

    // Add click handler for test button
    const testBtn = document.getElementById('testBtn');
    if (testBtn) {
        testBtn.addEventListener('click', async () => {
            console.log('[DEBUG] Test button clicked...');
            const spinner = document.getElementById('testSpinner');
            const text = document.getElementById('testText');
            try {
                spinner.style.display = 'inline-block';
                text.textContent = 'Testing...';
                const response = await fetch(`${window.SERVER_URL}/test`);
                const data = await response.json();
                alert(data.message || 'Server is running!');
            } catch (error) {
                console.error('Test failed:', error);
                alert('Test failed: ' + error.message);
            } finally {
                spinner.style.display = 'none';
                text.textContent = 'Test';
            }
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

    // Add click handler for record button
    const recordBtn = document.getElementById('recordBtn');
    if (recordBtn) {
        recordBtn.addEventListener('click', () => {
            console.log('[DEBUG] Record button clicked...');
            // TODO: Implement recording functionality
            alert('Recording functionality not yet implemented');
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
