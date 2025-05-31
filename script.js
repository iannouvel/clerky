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
    console.log('[DEBUG] Starting findRelevantGuidelines function');
    const button = document.getElementById('findGuidelinesBtn');
    const originalText = button.textContent;
    button.textContent = 'Finding Guidelines...';
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
            throw new Error('User not authenticated');
        }
        console.log('[DEBUG] User authenticated:', {
            email: user.email,
            uid: user.uid
        });

        // Get ID token for authentication
        const idToken = await user.getIdToken();
        console.log('[DEBUG] Got ID token');

        // Ensure guidelines are loaded
        if (!globalGuidelines) {
            console.log('[DEBUG] Guidelines not loaded, fetching from GitHub...');
            await window.loadGuidelinesFromGitHub();
        }

        // Prepare guidelines data for the server
        const guidelinesData = Object.entries(globalGuidelines).map(([filename, summary]) => ({
            filename,
            summary
        }));
        console.log('[DEBUG] Prepared guidelines data:', {
            totalGuidelines: guidelinesData.length,
            sampleGuidelines: guidelinesData.slice(0, 3)
        });

        // First, get relevant guidelines
        console.log('[DEBUG] Sending request to server...');
        const guidelinesResponse = await fetch(`${window.SERVER_URL}/handleGuidelines`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${idToken}`
            },
            body: JSON.stringify({
                prompt: transcript,
                filenames: guidelinesData.map(g => g.filename),
                summaries: guidelinesData.map(g => g.summary)
            })
        });

        console.log('[DEBUG] Server response status:', guidelinesResponse.status);
        if (!guidelinesResponse.ok) {
            const errorText = await guidelinesResponse.text();
            console.error('[DEBUG] Server response error:', {
                status: guidelinesResponse.status,
                errorText
            });
            throw new Error(`Failed to fetch guidelines: ${guidelinesResponse.status} ${errorText}`);
        }

        const responseData = await guidelinesResponse.json();
        console.log('[DEBUG] Server response data:', {
            success: responseData.success,
            categories: {
                mostRelevant: responseData.categories.mostRelevant?.length || 0,
                potentiallyRelevant: responseData.categories.potentiallyRelevant?.length || 0,
                lessRelevant: responseData.categories.lessRelevant?.length || 0,
                notRelevant: responseData.categories.notRelevant?.length || 0
            }
        });

        // Add detailed logging of returned guidelines
        console.log('[DEBUG] Detailed guidelines breakdown:');
        console.log('Most Relevant Guidelines:', responseData.categories.mostRelevant);
        console.log('Potentially Relevant Guidelines:', responseData.categories.potentiallyRelevant);
        console.log('Less Relevant Guidelines:', responseData.categories.lessRelevant);
        console.log('Not Relevant Guidelines:', responseData.categories.notRelevant);

        if (!responseData.success) {
            throw new Error(responseData.message || 'Failed to fetch guidelines');
        }

        // Store guidelines in global variable
        window.guidelinesForEachIssue = responseData.categories;
        console.log('[DEBUG] Stored guidelines in global variable');

        // Update the UI with the guidelines
        const suggestedGuidelines = document.getElementById('suggestedGuidelines');
        if (suggestedGuidelines) {
            console.log('[DEBUG] Updating UI with guidelines...');
            let html = '<div class="accordion">';
            
            // Most Relevant Guidelines
            if (responseData.categories.mostRelevant.length > 0) {
                html += `
                    <div class="accordion-item">
                        <h2 class="accordion-header">
                            <button class="accordion-button" type="button" data-bs-toggle="collapse" data-bs-target="#mostRelevantGuidelines">
                                Most Relevant Guidelines (${responseData.categories.mostRelevant.length})
                            </button>
                        </h2>
                        <div id="mostRelevantGuidelines" class="accordion-collapse collapse show">
                            <div class="accordion-body">
                                <ul class="list-group">`;
                responseData.categories.mostRelevant.forEach(guideline => {
                    html += `
                        <li class="list-group-item">
                            <strong>${guideline.name}</strong>
                            <span class="badge bg-success float-end">${guideline.probability}</span>
                        </li>`;
                });
                html += `
                                </ul>
                            </div>
                        </div>
                    </div>`;
            }

            // Potentially Relevant Guidelines
            if (responseData.categories.potentiallyRelevant.length > 0) {
                html += `
                    <div class="accordion-item">
                        <h2 class="accordion-header">
                            <button class="accordion-button collapsed" type="button" data-bs-toggle="collapse" data-bs-target="#potentiallyRelevantGuidelines">
                                Potentially Relevant Guidelines (${responseData.categories.potentiallyRelevant.length})
                            </button>
                        </h2>
                        <div id="potentiallyRelevantGuidelines" class="accordion-collapse collapse">
                            <div class="accordion-body">
                                <ul class="list-group">`;
                responseData.categories.potentiallyRelevant.forEach(guideline => {
                    html += `
                        <li class="list-group-item">
                            <strong>${guideline.name}</strong>
                            <span class="badge bg-warning float-end">${guideline.probability}</span>
                        </li>`;
                });
                html += `
                                </ul>
                            </div>
                        </div>
                    </div>`;
            }

            // Less Relevant Guidelines
            if (responseData.categories.lessRelevant.length > 0) {
                html += `
                    <div class="accordion-item">
                        <h2 class="accordion-header">
                            <button class="accordion-button collapsed" type="button" data-bs-toggle="collapse" data-bs-target="#lessRelevantGuidelines">
                                Less Relevant Guidelines (${responseData.categories.lessRelevant.length})
                            </button>
                        </h2>
                        <div id="lessRelevantGuidelines" class="accordion-collapse collapse">
                            <div class="accordion-body">
                                <ul class="list-group">`;
                responseData.categories.lessRelevant.forEach(guideline => {
                    html += `
                        <li class="list-group-item">
                            <strong>${guideline.name}</strong>
                            <span class="badge bg-info float-end">${guideline.probability}</span>
                        </li>`;
                });
                html += `
                                </ul>
                            </div>
                        </div>
                    </div>`;
            }

            // Not Relevant Guidelines
            if (responseData.categories.notRelevant.length > 0) {
                html += `
                    <div class="accordion-item">
                        <h2 class="accordion-header">
                            <button class="accordion-button collapsed" type="button" data-bs-toggle="collapse" data-bs-target="#notRelevantGuidelines">
                                Not Relevant Guidelines (${responseData.categories.notRelevant.length})
                            </button>
                        </h2>
                        <div id="notRelevantGuidelines" class="accordion-collapse collapse">
                            <div class="accordion-body">
                                <ul class="list-group">`;
                responseData.categories.notRelevant.forEach(guideline => {
                    html += `
                        <li class="list-group-item">
                            <strong>${guideline.name}</strong>
                            <span class="badge bg-secondary float-end">${guideline.probability}</span>
                        </li>`;
                });
                html += `
                                </ul>
                            </div>
                        </div>
                    </div>`;
            }

            html += '</div>';
            suggestedGuidelines.innerHTML = html;
            console.log('Updated UI with guidelines');
                } else {
            console.warn('suggestedGuidelines element not found');
        }

            } catch (error) {
        console.error('[DEBUG] Error in findRelevantGuidelines:', {
            error: error.message,
            stack: error.stack
        });
        alert(`Error finding guidelines: ${error.message}`);
    } finally {
        button.textContent = originalText;
        button.disabled = false;
        console.log('[DEBUG] findRelevantGuidelines function completed');
    }
}

// Function to generate clinical note
async function generateClinicalNote() {
    console.log('Starting clinical note generation...');
    const spinner = document.getElementById('spinner');
    const generateText = document.getElementById('generateText');
    const summary1 = document.getElementById('summary1');

    try {
        // Show loading state
        spinner.style.display = 'inline-block';
        generateText.textContent = 'Generating...';

        // Get the transcript content
        const transcript = summary1.textContent;
        if (!transcript) {
            throw new Error('No transcript content found');
        }

        // Get the user's ID token
        const user = auth.currentUser;
            if (!user) {
            throw new Error('User not authenticated');
                }
                const token = await user.getIdToken();

        // Generate the clinical note
        console.log('Generating clinical note...');
        const noteResponse = await fetch(`${window.SERVER_URL}/generateClinicalNote`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ transcript })
        });

                if (!noteResponse.ok) {
            throw new Error(`Server responded with status: ${noteResponse.status}`);
                }
                
        const noteData = await noteResponse.json();
                if (!noteData.success) {
            throw new Error(noteData.message || 'Failed to generate clinical note');
        }

        // Update the transcript pane with the generated note
        summary1.innerHTML = marked.parse(noteData.note);
        console.log('Clinical note generated successfully');

            } catch (error) {
        console.error('Error in note generation process:', error);
        alert('Failed to generate clinical note: ' + error.message);
            } finally {
        // Reset button state
        spinner.style.display = 'none';
        generateText.textContent = 'Note';
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

        // Get the most relevant guideline from the previously generated list
        const mostRelevantGuideline = document.querySelector('#mostRelevantGuidelines .list-group-item');
        if (!mostRelevantGuideline) {
            throw new Error('Please use "Find Relevant Guidelines" first to identify relevant guidelines');
        }

        const guidelineName = mostRelevantGuideline.querySelector('strong').textContent;
        
        // Get the full guideline content
        const response = await fetch(`${window.SERVER_URL}/getGuidelineContent`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${idToken}`
            },
            body: JSON.stringify({ filename: guidelineName })
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

        // Display the recommendations
        const suggestedGuidelines = document.getElementById('suggestedGuidelines');
        if (suggestedGuidelines) {
            let html = `
                <div class="accordion">
                    <div class="accordion-item">
                        <h2 class="accordion-header">
                            <button class="accordion-button" type="button" data-bs-toggle="collapse" data-bs-target="#guidelineRecommendations">
                                Recommendations for ${guidelineName}
                            </button>
                        </h2>
                        <div id="guidelineRecommendations" class="accordion-collapse collapse show">
                            <div class="accordion-body">
                                ${marked.parse(recommendationsData.recommendations)}
                            </div>
                        </div>
                    </div>
                </div>`;
            suggestedGuidelines.innerHTML = html;
        }

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
