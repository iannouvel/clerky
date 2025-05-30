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

// Initialize the application
async function initializeApp() {
    console.log('Starting initializeApp...');
    if (isInitialized) {
        console.log('Application already initialized');
        return;
    }

    try {
        console.log('Initializing marked library...');
        await initializeMarked();
        console.log('Marked library initialized successfully');

        console.log('Setting up Firebase auth state listener...');
        onAuthStateChanged(auth, async (user) => {
            console.log('Auth state changed:', user ? 'User signed in' : 'User signed out');
            if (user) {
                console.log('User details:', { email: user.email, uid: user.uid });
                try {
                    console.log('Loading clinical issues...');
                    await window.loadClinicalIssues();
                    isInitialized = true;
                    console.log('Showing main content...');
                    showMainContent();
                    console.log('Application initialized successfully');
                } catch (error) {
                    console.error('Failed to load clinical issues:', error);
                    isInitialized = true;
                    showMainContent();
                }
            } else {
                console.log('User is signed out, showing landing page...');
                isInitialized = false;
                const loading = document.getElementById('loading');
                const landingPage = document.getElementById('landingPage');
                const mainContent = document.getElementById('mainContent');

                console.log('Elements found:', {
                    loading: !!loading,
                    landingPage: !!landingPage,
                    mainContent: !!mainContent
                });

                if (loading) loading.classList.add('hidden');
                if (landingPage) landingPage.classList.remove('hidden');
                if (mainContent) mainContent.classList.add('hidden');
            }
        });

    } catch (error) {
        console.error('Error during application initialization:', error);
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
});

// Function to find relevant guidelines
async function findRelevantGuidelines() {
    console.log('Starting findRelevantGuidelines function');
    const button = document.getElementById('findGuidelinesBtn');
    const originalText = button.textContent;
    button.textContent = 'Finding Guidelines...';
    button.disabled = true;

    try {
        // Get the transcript content
        const transcript = document.getElementById('summary1').textContent;
        console.log('Retrieved transcript:', transcript.substring(0, 100) + '...');

        if (!transcript) {
            throw new Error('No transcript found');
        }

        // Get the current user
        const user = auth.currentUser;
        if (!user) {
            throw new Error('User not authenticated');
        }
        console.log('User authenticated:', user.email);

        // Get ID token for authentication
        const idToken = await user.getIdToken();
        console.log('Got ID token');

        // First, get relevant guidelines
        console.log('Fetching relevant guidelines...');
        const guidelinesResponse = await fetch(`${window.SERVER_URL}/handleGuidelines`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${idToken}`
            },
            body: JSON.stringify({
                prompt: transcript,
                filenames: window.guidelinesForEachIssue.map(g => g.filename),
                summaries: window.guidelinesForEachIssue.map(g => g.summary)
            })
        });

        console.log('Guidelines response status:', guidelinesResponse.status);
        if (!guidelinesResponse.ok) {
            const errorText = await guidelinesResponse.text();
            console.error('Guidelines response error:', errorText);
            throw new Error(`Failed to fetch guidelines: ${guidelinesResponse.status} ${errorText}`);
        }

        const guidelinesData = await guidelinesResponse.json();
        console.log('Guidelines response data:', guidelinesData);

        if (!guidelinesData.success) {
            throw new Error(guidelinesData.message || 'Failed to fetch guidelines');
        }

        // Store guidelines in global variable
        window.guidelinesForEachIssue = guidelinesData.categories;
        console.log('Stored guidelines in global variable:', window.guidelinesForEachIssue);

        // Update the UI with the guidelines
        const suggestedGuidelines = document.getElementById('suggestedGuidelines');
        if (suggestedGuidelines) {
            let html = '<div class="accordion">';
            
            // Most Relevant Guidelines
            if (guidelinesData.categories.mostRelevant.length > 0) {
                html += `
                    <div class="accordion-item">
                        <h2 class="accordion-header">
                            <button class="accordion-button" type="button" data-bs-toggle="collapse" data-bs-target="#mostRelevantGuidelines">
                                Most Relevant Guidelines (${guidelinesData.categories.mostRelevant.length})
                            </button>
                        </h2>
                        <div id="mostRelevantGuidelines" class="accordion-collapse collapse show">
                            <div class="accordion-body">
                                <ul class="list-group">`;
                guidelinesData.categories.mostRelevant.forEach(guideline => {
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
            if (guidelinesData.categories.potentiallyRelevant.length > 0) {
                html += `
                    <div class="accordion-item">
                        <h2 class="accordion-header">
                            <button class="accordion-button collapsed" type="button" data-bs-toggle="collapse" data-bs-target="#potentiallyRelevantGuidelines">
                                Potentially Relevant Guidelines (${guidelinesData.categories.potentiallyRelevant.length})
                            </button>
                        </h2>
                        <div id="potentiallyRelevantGuidelines" class="accordion-collapse collapse">
                            <div class="accordion-body">
                                <ul class="list-group">`;
                guidelinesData.categories.potentiallyRelevant.forEach(guideline => {
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
            if (guidelinesData.categories.lessRelevant.length > 0) {
                html += `
                    <div class="accordion-item">
                        <h2 class="accordion-header">
                            <button class="accordion-button collapsed" type="button" data-bs-toggle="collapse" data-bs-target="#lessRelevantGuidelines">
                                Less Relevant Guidelines (${guidelinesData.categories.lessRelevant.length})
                            </button>
                        </h2>
                        <div id="lessRelevantGuidelines" class="accordion-collapse collapse">
                            <div class="accordion-body">
                                <ul class="list-group">`;
                guidelinesData.categories.lessRelevant.forEach(guideline => {
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
            if (guidelinesData.categories.notRelevant.length > 0) {
                html += `
                    <div class="accordion-item">
                        <h2 class="accordion-header">
                            <button class="accordion-button collapsed" type="button" data-bs-toggle="collapse" data-bs-target="#notRelevantGuidelines">
                                Not Relevant Guidelines (${guidelinesData.categories.notRelevant.length})
                            </button>
                        </h2>
                        <div id="notRelevantGuidelines" class="accordion-collapse collapse">
                            <div class="accordion-body">
                                <ul class="list-group">`;
                guidelinesData.categories.notRelevant.forEach(guideline => {
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
        console.error('Error in findRelevantGuidelines:', error);
        alert(`Error finding guidelines: ${error.message}`);
    } finally {
        button.textContent = originalText;
        button.disabled = false;
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

// ... rest of the existing code ...
