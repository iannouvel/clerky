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
});

// ... rest of the existing code ...
