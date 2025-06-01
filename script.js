// Import Firebase instances from firebase-init.js
import { app, db, auth } from './firebase-init.js';
import { GoogleAuthProvider, signInWithPopup, onAuthStateChanged, signOut, signInWithRedirect, getRedirectResult } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import { getAnalytics } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-analytics.js';
import { doc, getDoc, setDoc } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

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

// Function to load guidelines from GitHub
async function loadGuidelinesFromGitHub() {
    console.log('[DEBUG] Starting loadGuidelinesFromGitHub...');
    try {
        console.log('[DEBUG] Fetching guidelines from GitHub...');
        const response = await fetch('https://raw.githubusercontent.com/iannouvel/clerky/main/guidance/summary/list_of_summaries.json');
        console.log('[DEBUG] GitHub response status:', response.status);
        
        if (!response.ok) {
            console.error('[DEBUG] GitHub fetch failed:', {
                status: response.status,
                statusText: response.statusText
            });
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        console.log('[DEBUG] Parsing GitHub response...');
        const data = await response.json();
        console.log('[DEBUG] Guidelines loaded successfully:', {
            totalGuidelines: Object.keys(data).length,
            sampleGuidelines: Object.entries(data).slice(0, 3)
        });
        
        globalGuidelines = data;
        console.log('[DEBUG] Guidelines stored in globalGuidelines');
        return data;
    } catch (error) {
        console.error('[DEBUG] Error in loadGuidelinesFromGitHub:', {
            error: error.message,
            stack: error.stack
        });
        throw error;
    }
}

// Make loadGuidelinesFromGitHub available globally
window.loadGuidelinesFromGitHub = loadGuidelinesFromGitHub;

// Modify initializeApp to load guidelines
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
                    
                    console.log('[DEBUG] Loading guidelines from GitHub...');
                    await window.loadGuidelinesFromGitHub();
                    console.log('[DEBUG] Guidelines loaded successfully');
                    
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

// Modify findRelevantGuidelines to use the loaded guidelines
async function findRelevantGuidelines() {
    console.log('[DEBUG] findRelevantGuidelines started');
    
    const button = document.getElementById('findGuidelinesBtn');
    if (!button) {
        console.error('[DEBUG] findGuidelinesBtn not found');
        return;
    }

    try {
        // Disable button and show loading state
        button.disabled = true;
        button.innerHTML = '<span class="spinner">&#x21BB;</span> Finding...';

        // Get the transcript content
        const summary1 = document.getElementById('summary1');
        const userInput = document.getElementById('userInput');
        const transcript = (summary1?.textContent || '') + '\n' + (userInput?.value || '');
        
        console.log('[DEBUG] Transcript sources:', {
            summary1Length: summary1?.textContent?.length || 0,
            userInputLength: userInput?.value?.length || 0,
            totalLength: transcript.length
        });

        if (!transcript.trim()) {
            throw new Error('No transcript content found');
        }

        // Get the current user
        const user = auth.currentUser;
        if (!user) {
            throw new Error('User not authenticated');
        }

        // Get the ID token
        const idToken = await user.getIdToken();
        console.log('[DEBUG] Got ID token for user:', user.uid);

        // Make the API request
        const response = await fetch(`${SERVER_URL}/handleGuidelines`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${idToken}`
            },
            body: JSON.stringify({
                prompt: transcript,
                filenames: window.guidelinesList || [],
                summaries: window.guidelinesSummaries || []
            })
        });

        console.log('[DEBUG] Server response status:', response.status);
        
        if (!response.ok) {
            throw new Error(`Server responded with status: ${response.status}`);
        }

        const data = await response.json();
        console.log('[DEBUG] Server response data:', data);

        if (!data.success) {
            throw new Error(data.message || 'Failed to get relevant guidelines');
        }

        // Process the guidelines
        let formattedGuidelines = 'Relevant Guidelines\n';
        
        // Process each category
        const categories = ['mostRelevant', 'potentiallyRelevant', 'lessRelevant', 'notRelevant'];
        const categoryTitles = {
            mostRelevant: 'Most Relevant Guidelines',
            potentiallyRelevant: 'Potentially Relevant Guidelines',
            lessRelevant: 'Less Relevant Guidelines',
            notRelevant: 'Not Relevant Guidelines'
        };

        categories.forEach(category => {
            if (data.categories[category] && data.categories[category].length > 0) {
                formattedGuidelines += `\n${categoryTitles[category]}\n`;
                data.categories[category].forEach(guideline => {
                    // Split by colon and trim both parts
                    const [name, relevance] = guideline.name.split(':').map(part => part.trim());
                    formattedGuidelines += `${name}\n`;
                });
            }
        });

        // Append the formatted guidelines to summary1
        appendToSummary1(formattedGuidelines);
        console.log('[DEBUG] Guidelines appended to summary1');

    } catch (error) {
        console.error('[DEBUG] Error in findRelevantGuidelines:', error);
        alert('Failed to find relevant guidelines: ' + error.message);
    } finally {
        // Re-enable button and restore original text
        button.disabled = false;
        button.innerHTML = 'Find Relevant Guidelines';
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

        // Get the current user
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

// Function to check note against selected guidelines
async function checkAgainstGuidelines() {
    console.log('[DEBUG] Starting checkAgainstGuidelines function');
    const button = document.getElementById('checkGuidelinesBtn');
    const originalText = button.textContent;
    button.textContent = 'Checking Guidelines...';
    button.disabled = true;

    try {
        // Get the note content from either summary1 or userInput
        let note = document.getElementById('summary1')?.textContent;
        const userInput = document.getElementById('userInput')?.value;
        
        // Use userInput if summary1 is empty
        if ((!note || note.trim() === '') && userInput && userInput.trim() !== '') {
            note = userInput;
        }

        if (!note || note.trim() === '') {
            throw new Error('No note found or note is empty');
        }

        // Get the current user
        const user = auth.currentUser;
        if (!user) {
            throw new Error('User not authenticated');
        }

        // Get ID token for authentication
        const idToken = await user.getIdToken();

        // Get the most relevant guideline from the stored guidelines
        console.log('[DEBUG] Checking stored guidelines:', window.guidelinesForEachIssue);
        if (!window.guidelinesForEachIssue?.mostRelevant?.length) {
            throw new Error('Please use "Find Relevant Guidelines" first to identify relevant guidelines');
        }

        const mostRelevantGuideline = window.guidelinesForEachIssue.mostRelevant[0];
        console.log('[DEBUG] Most relevant guideline:', mostRelevantGuideline);
        
        // Get the full guideline content
        const response = await fetch(`${window.SERVER_URL}/getGuidelineContent`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${idToken}`
            },
            body: JSON.stringify({ filename: mostRelevantGuideline.name })
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Failed to fetch guideline content: ${response.status} ${errorText}`);
        }

        const guidelineData = await response.json();
        if (!guidelineData.success) {
            throw new Error(guidelineData.message || 'Failed to fetch guideline content');
        }

        // Get recommendations using the new prompt
        const recommendationsResponse = await fetch(`${window.SERVER_URL}/getRecommendations`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${idToken}`
            },
            body: JSON.stringify({
                note: note,
                guideline: guidelineData.content,
                promptType: 'guidelineRecommendations'
            })
        });

        if (!recommendationsResponse.ok) {
            const errorText = await recommendationsResponse.text();
            throw new Error(`Failed to get recommendations: ${recommendationsResponse.status} ${errorText}`);
        }

        const recommendationsData = await recommendationsResponse.json();
        if (!recommendationsData.success) {
            throw new Error(recommendationsData.message || 'Failed to get recommendations');
        }

        // Display the recommendations in summary1
        appendToSummary1(`\nRecommendations for ${mostRelevantGuideline.name}:\n${recommendationsData.recommendations}`);

    } catch (error) {
        console.error('[DEBUG] Error in checkAgainstGuidelines:', error);
        alert(`Error checking guidelines: ${error.message}`);
    } finally {
        button.textContent = originalText;
        button.disabled = false;
        console.log('[DEBUG] checkAgainstGuidelines function completed');
    }
}

// ... rest of the existing code ...
