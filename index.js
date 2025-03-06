// index.js - Functionality specific to index.html

// Import Firebase modules
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import { getAnalytics } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-analytics.js';
import { getFirestore, doc, getDoc } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { getAuth, GoogleAuthProvider, signInWithPopup, onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import { checkServerHealth } from './script.js';

// Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyCU4dfGi4vHg_ek-l2V0uksFCv1jL4KV_g",
  authDomain: "clerky-b3be8.firebaseapp.com",
  projectId: "clerky-b3be8",
  storageBucket: "clerky-b3be8.firebasestorage.app",
  messagingSenderId: "193460924609",
  appId: "1:193460924609:web:6e2c696c87292d4a222440",
  measurementId: "G-V07DP1ELDR"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);
const db = getFirestore(app);
const auth = getAuth(app);

// Declare these variables at the top level of your script
let filenames = [];
let summaries = [];
let guidanceDataLoaded = false;

// Main initialization
document.addEventListener('DOMContentLoaded', async function() {
    // Initialize UI
    const loading = document.getElementById('loading');
    const landingPage = document.getElementById('landingPage');
    const mainContent = document.getElementById('mainContent');
    const googleSignInBtn = document.getElementById('googleSignInBtn');
    const signOutBtn = document.getElementById('signOutBtn');
    const userName = document.getElementById('userName');
    
    // Function to show main content and hide the landing page
    function showMainContent() {
        landingPage.classList.add('hidden');
        mainContent.classList.remove('hidden');
        loading.classList.add('hidden');
    }
    
    // Function to show landing page and hide the main content
    function showLandingPage() {
        landingPage.classList.remove('hidden');
        mainContent.classList.add('hidden');
        loading.classList.add('hidden');
    }
    
    // Set up authentication listener
    auth.onAuthStateChanged(async user => {
        if (user) {
            // User is signed in
            if (userName) {
                userName.textContent = user.displayName || user.email;
                userName.classList.remove('hidden');
            }
            
            // Update UI based on user
            await updateUI(user);
            showMainContent();
        } else {
            // User is signed out
            showLandingPage();
        }
    });
    
    // Set up sign-in button
    if (googleSignInBtn) {
        googleSignInBtn.addEventListener('click', async () => {
            try {
                const provider = new GoogleAuthProvider();
                await signInWithPopup(auth, provider);
                // Auth state change will trigger UI update
            } catch (error) {
                console.error('Error signing in:', error);
                alert('Error signing in: ' + error.message);
            }
        });
    }
    
    // Set up sign-out button
    if (signOutBtn) {
        signOutBtn.addEventListener('click', async () => {
            try {
                await signOut(auth);
                // Auth state change will trigger UI update
            } catch (error) {
                console.error('Error signing out:', error);
                alert('Error signing out: ' + error.message);
            }
        });
    }
    
    // Set up button event listeners
    setupButtonEventListeners();
    
    // Check server health
    checkServerHealth();
});

// Function to check if user is Ian Nouvel
function isAdminUser(user) {
    return user && user.email === 'ian.nouvel@gmail.com';
}

// Function to update button visibility based on user
function updateButtonVisibility(user) {
    const devBtn = document.getElementById('devBtn');
    const testBtn = document.getElementById('testBtn');
    
    if (devBtn) {
        devBtn.style.display = isAdminUser(user) ? 'inline-block' : 'none';
    }
    
    if (testBtn) {
        testBtn.style.display = isAdminUser(user) ? 'inline-block' : 'none';
    }
}

// Update the updateUI function to include button visibility
async function updateUI(user) {
    // Update button visibility based on user
    updateButtonVisibility(user);
    
    // Load data
    await Promise.all([
        loadPrompts(),
        loadLinks(),
        loadGuidelines()
    ]);
}

// Set up all button event listeners
function setupButtonEventListeners() {
    // Navigation buttons
    const promptsBtn = document.getElementById('promptsBtn');
    const guidelinesBtn = document.getElementById('guidelinesBtn');
    const recordBtn = document.getElementById('recordBtn');
    const actionBtn = document.getElementById('actionBtn');
    const generateClinicalNoteBtn = document.getElementById('generateClinicalNoteBtn');
    const xCheckBtn = document.getElementById('xCheckBtn');
    const devBtn = document.getElementById('devBtn');
    const proformaBtn = document.getElementById('proformaBtn');
    const savePromptsBtn = document.getElementById('savePromptsBtn');
    const obsProformaBtn = document.getElementById('obsProformaBtn');
    const gynProformaBtn = document.getElementById('gynProformaBtn');
    const populateProformaBtn = document.getElementById('populateProformaBtn');
    const addIssueBtn = document.getElementById('addIssueBtn');
    
    // Tab navigation
    const tabs = document.querySelectorAll('.tab');
    const mainSection = document.getElementById('mainSection');
    const promptsSection = document.getElementById('promptsSection');
    const guidelinesSection = document.getElementById('guidelinesSection');
    const workflowsView = document.getElementById('workflowsView');
    const threeColumnView = document.getElementById('threeColumnView');
    const proformaView = document.getElementById('proformaView');
    
    // Set up tab navigation
    tabs.forEach(tab => {
        tab.addEventListener('click', function() {
            const tabName = this.getAttribute('data-tab');
            
            // Remove active class from all tabs
            tabs.forEach(t => t.classList.remove('active'));
            
            // Add active class to clicked tab
            this.classList.add('active');
            
            // Hide all sections
            mainSection.classList.add('hidden');
            promptsSection.classList.add('hidden');
            guidelinesSection.classList.add('hidden');
            
            // Show the selected section
            if (tabName === 'main') {
                mainSection.classList.remove('hidden');
            } else if (tabName === 'prompts') {
                promptsSection.classList.remove('hidden');
            } else if (tabName === 'guidelines') {
                guidelinesSection.classList.remove('hidden');
            } else if (tabName === 'workflows') {
                mainSection.classList.remove('hidden');
                workflowsView.classList.remove('hidden');
                threeColumnView.classList.add('hidden');
                proformaView.classList.add('hidden');
            }
        });
    });
    
    // Set up algos button
    if (devBtn) {
        devBtn.addEventListener('click', function() {
            window.open('dev.html', '_blank');
        });
    }
    
    // Set up proforma button
    if (proformaBtn) {
        proformaBtn.addEventListener('click', function() {
            threeColumnView.classList.add('hidden');
            workflowsView.classList.add('hidden');
            proformaView.classList.remove('hidden');
        });
    }
    
    // Set up proforma toggle buttons
    if (obsProformaBtn && gynProformaBtn) {
        const obsProforma = document.getElementById('obsProforma');
        const gynProforma = document.getElementById('gynProforma');
        
        obsProformaBtn.addEventListener('click', function() {
            obsProformaBtn.classList.add('active');
            gynProformaBtn.classList.remove('active');
            obsProforma.classList.remove('hidden');
            gynProforma.classList.add('hidden');
        });
        
        gynProformaBtn.addEventListener('click', function() {
            gynProformaBtn.classList.add('active');
            obsProformaBtn.classList.remove('active');
            gynProforma.classList.remove('hidden');
            obsProforma.classList.add('hidden');
        });
    }
    
    // Set up populate proforma button
    if (populateProformaBtn) {
        populateProformaBtn.addEventListener('click', function() {
            const populateSpinner = document.getElementById('populateSpinner');
            const populateText = document.getElementById('populateText');
            
            populateSpinner.style.display = 'inline-block';
            populateText.style.display = 'none';
            
            // Get the active proforma type
            const isObstetric = document.getElementById('obsProformaBtn').classList.contains('active');
            const type = isObstetric ? 'obstetric' : 'gynaecology';
            
            // Get the proforma summary text
            const summaryText = document.getElementById('proformaSummary').value;
            
            // Call the API to populate the proforma
            fetch(`${SERVER_URL}/populateProforma`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    text: summaryText,
                    type: type
                })
            })
            .then(response => response.json())
            .then(data => {
                if (data.success) {
                    // Populate the proforma fields
                    populateProformaFields(data.data, type);
                } else {
                    alert('Error populating proforma: ' + data.message);
                }
            })
            .catch(error => {
                console.error('Error:', error);
                alert('Error populating proforma: ' + error.message);
            })
            .finally(() => {
                populateSpinner.style.display = 'none';
                populateText.style.display = 'inline-block';
            });
        });
    }
    
    // Set up prompts button
    if (promptsBtn) {
        promptsBtn.addEventListener('click', function() {
            tabs.forEach(t => t.classList.remove('active'));
            document.querySelector('.tab[data-tab="prompts"]').classList.add('active');
            
            mainSection.classList.add('hidden');
            promptsSection.classList.remove('hidden');
            guidelinesSection.classList.add('hidden');
        });
    }
    
    // Set up guidelines button
    if (guidelinesBtn) {
        guidelinesBtn.addEventListener('click', function() {
            tabs.forEach(t => t.classList.remove('active'));
            document.querySelector('.tab[data-tab="guidelines"]').classList.add('active');
            
            mainSection.classList.add('hidden');
            promptsSection.classList.add('hidden');
            guidelinesSection.classList.remove('hidden');
        });
    }
    
    // Set up save prompts button
    if (savePromptsBtn) {
        savePromptsBtn.addEventListener('click', savePrompts);
    }
    
    // Set up add issue button
    if (addIssueBtn) {
        addIssueBtn.addEventListener('click', async function() {
            const issueText = prompt('Enter a new issue:');
            if (issueText && issueText.trim() !== '') {
                // Create a new issue div
                const issueDiv = document.createElement('div');
                issueDiv.className = 'accordion-item';
                
                const issueHeader = document.createElement('div');
                issueHeader.className = 'accordion-header';
                issueHeader.textContent = issueText;
                
                const issueContent = document.createElement('div');
                issueContent.className = 'accordion-content';
                
                issueDiv.appendChild(issueHeader);
                issueDiv.appendChild(issueContent);
                
                // Add the issue to the guidelines container
                document.getElementById('suggestedGuidelines').appendChild(issueDiv);
                
                // Set up accordion behavior
                issueHeader.addEventListener('click', function() {
                    this.classList.toggle('active');
                    const content = this.nextElementSibling;
                    content.style.display = this.classList.contains('active') ? 'block' : 'none';
                });
                
                // Update guidelines for the new issue
                await updateGuidelines(issueText, issueDiv);
            }
        });
    }
}

// Function to load prompts from localStorage
function loadPrompts() {
    const promptIssues = document.getElementById('promptIssues');
    const promptGuidelines = document.getElementById('promptGuidelines');
    const promptNoteGenerator = document.getElementById('promptNoteGenerator');
    
    // Load prompts from localStorage or use defaults
    const prompts = JSON.parse(localStorage.getItem('prompts')) || {};
    
    if (promptIssues && prompts.issues) {
        promptIssues.value = prompts.issues;
    }
    
    if (promptGuidelines && prompts.guidelines) {
        promptGuidelines.value = prompts.guidelines;
    }
    
    if (promptNoteGenerator && prompts.noteGenerator) {
        promptNoteGenerator.value = prompts.noteGenerator;
    }
}

// Function to save prompts to localStorage
function savePrompts() {
    const promptIssues = document.getElementById('promptIssues');
    const promptGuidelines = document.getElementById('promptGuidelines');
    const promptNoteGenerator = document.getElementById('promptNoteGenerator');
    
    // Create prompts object
    const prompts = {
        issues: promptIssues ? promptIssues.value : '',
        guidelines: promptGuidelines ? promptGuidelines.value : '',
        noteGenerator: promptNoteGenerator ? promptNoteGenerator.value : ''
    };
    
    // Save to localStorage
    localStorage.setItem('prompts', JSON.stringify(prompts));
    
    // Show confirmation
    alert('Prompts saved successfully!');
}

// Function to load links
async function loadLinks() {
    const linksList = document.getElementById('linksList');
    
    if (!linksList) return;
    
    try {
        const response = await fetch('https://raw.githubusercontent.com/iannouvel/clerky/main/links.json');
        if (!response.ok) {
            throw new Error('Failed to load links');
        }
        
        const links = await response.json();
        
        // Clear existing links
        linksList.innerHTML = '';
        
        // Add links to the list
        links.forEach(link => {
            const li = document.createElement('li');
            const a = document.createElement('a');
            
            a.href = link.url;
            a.textContent = link.title;
            a.target = '_blank';
            a.className = 'guideline-link';
            
            li.appendChild(a);
            linksList.appendChild(li);
        });
    } catch (error) {
        console.error('Error loading links:', error);
    }
}

// Function to load guidelines
async function loadGuidelines() {
    const guidelinesList = document.getElementById('guidelinesList');
    
    if (!guidelinesList) return;
    
    try {
        const response = await fetch('https://raw.githubusercontent.com/iannouvel/clerky/main/list_of_guidelines.txt');
        if (!response.ok) {
            throw new Error('Failed to load guidelines');
        }
        
        const text = await response.text();
        const guidelines = text.split('\n').filter(line => line.trim() !== '');
        
        // Clear existing guidelines
        guidelinesList.innerHTML = '';
        
        // Add guidelines to the list
        guidelines.forEach(guideline => {
            const li = document.createElement('li');
            const a = document.createElement('a');
            
            a.href = `https://github.com/iannouvel/clerky/raw/main/guidance/${guideline}`;
            a.textContent = guideline.replace(/\.(txt|pdf)$/i, '');
            a.target = '_blank';
            a.className = 'guideline-link';
            
            li.appendChild(a);
            guidelinesList.appendChild(li);
        });
    } catch (error) {
        console.error('Error loading guidelines:', error);
    }
}

// Function to update guidelines for an issue
async function updateGuidelines(issueText, issueDiv) {
    try {
        // Get the prompts
        const prompts = await getPrompts();
        
        // Create the prompt for guidelines
        const prompt = `${prompts.guidelines}\n\n${issueText}`;
        
        // Call the API to get guidelines
        const response = await fetch(`${SERVER_URL}/getGuidelines`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ prompt })
        });
        
        if (!response.ok) {
            throw new Error('Failed to get guidelines');
        }
        
        const data = await response.json();
        
        if (!data.success) {
            throw new Error(data.message || 'Failed to get guidelines');
        }
        
        // Parse the guidelines
        const guidelines = data.guidelines.split('\n').filter(line => line.trim() !== '');
        
        // Create the guidelines list
        const guidelinesList = document.createElement('ul');
        guidelinesList.className = 'guidelines-list';
        
        // Add guidelines to the list
        guidelines.forEach(guideline => {
            const li = document.createElement('li');
            const a = document.createElement('a');
            
            a.href = `https://github.com/iannouvel/clerky/raw/main/guidance/${guideline}`;
            a.textContent = guideline.replace(/\.(txt|pdf)$/i, '');
            a.target = '_blank';
            a.className = 'guideline-link';
            
            // Add apply button
            const applyBtn = document.createElement('button');
            applyBtn.textContent = 'Apply';
            applyBtn.className = 'apply-btn';
            applyBtn.addEventListener('click', async function(e) {
                e.preventDefault();
                e.stopPropagation();
                
                // Get the clinical situation
                const clinicalSituation = document.getElementById('summary').textContent;
                
                // Apply the guideline
                await applyGuideline(guideline, clinicalSituation);
            });
            
            li.appendChild(a);
            li.appendChild(applyBtn);
            guidelinesList.appendChild(li);
        });
        
        // Add the guidelines list to the issue content
        const issueContent = issueDiv.querySelector('.accordion-content');
        issueContent.innerHTML = '';
        issueContent.appendChild(guidelinesList);
        
    } catch (error) {
        console.error('Error updating guidelines:', error);
        
        // Show error in the issue content
        const issueContent = issueDiv.querySelector('.accordion-content');
        issueContent.innerHTML = `<p class="error">Error: ${error.message}</p>`;
    }
}

// Function to apply a guideline to a clinical situation
async function applyGuideline(guideline, clinicalSituation) {
    try {
        // Call the API to apply the guideline
        const response = await fetch(`${SERVER_URL}/applyGuideline`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                guideline,
                clinicalSituation
            })
        });
        
        if (!response.ok) {
            throw new Error('Failed to apply guideline');
        }
        
        const data = await response.json();
        
        if (!data.success) {
            throw new Error(data.message || 'Failed to apply guideline');
        }
        
        // Show the result in a popup
        showPopup(data.result);
        
    } catch (error) {
        console.error('Error applying guideline:', error);
        alert('Error applying guideline: ' + error.message);
    }
}

// Function to show a popup
function showPopup(content) {
    // Create popup elements
    const overlay = document.createElement('div');
    overlay.className = 'popup-overlay';
    
    const popup = document.createElement('div');
    popup.className = 'popup';
    
    const popupHeader = document.createElement('div');
    popupHeader.className = 'popup-header';
    
    const popupTitle = document.createElement('h2');
    popupTitle.textContent = 'Guideline Application';
    
    const closeButton = document.createElement('button');
    closeButton.className = 'popup-close';
    closeButton.innerHTML = '&times;';
    
    const popupContent = document.createElement('div');
    popupContent.className = 'popup-content';
    popupContent.innerHTML = content;
    
    // Assemble popup
    popupHeader.appendChild(popupTitle);
    popupHeader.appendChild(closeButton);
    
    popup.appendChild(popupHeader);
    popup.appendChild(popupContent);
    
    overlay.appendChild(popup);
    
    // Add to document
    document.body.appendChild(overlay);
    
    // Function to remove popup
    const removePopup = () => {
        document.body.removeChild(overlay);
    };
    
    // Add event listeners
    closeButton.addEventListener('click', removePopup);
    overlay.addEventListener('click', function(e) {
        if (e.target === overlay) {
            removePopup();
        }
    });
    
    // Return elements and remove function
    return {
        overlay,
        popup,
        removePopup
    };
}

// Function to get prompts
async function getPrompts() {
    // Try to load prompts from localStorage
    const storedPrompts = JSON.parse(localStorage.getItem('prompts')) || {};
    
    // Default prompts
    const defaultPrompts = {
        issues: 'Please determine the significant clinical issues within this clinical scenario.',
        guidelines: 'Please provide filenames of the 3 most relevant guidelines for the following clinical text.',
        noteGenerator: 'Please write a concise clinical note using medical terminology suitable for healthcare professionals.'
    };
    
    // Return stored prompts or defaults
    return {
        issues: storedPrompts.issues || defaultPrompts.issues,
        guidelines: storedPrompts.guidelines || defaultPrompts.guidelines,
        noteGenerator: storedPrompts.noteGenerator || defaultPrompts.noteGenerator
    };
} 