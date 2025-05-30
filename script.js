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
    return new Promise((resolve, reject) => {
        if (window.marked) {
            console.log('Marked library already loaded');
            resolve();
            return;
        }

        const markedScript = document.createElement('script');
        markedScript.src = 'https://cdn.jsdelivr.net/npm/marked/marked.min.js';
        markedScript.onload = function() {
            window.marked = marked;
            console.log('Marked library loaded successfully');
            resolve();
        };
        markedScript.onerror = function(error) {
            console.error('Error loading marked library:', error);
            reject(error);
        };
        document.head.appendChild(markedScript);
    });
}

// Make loadClinicalIssues available globally
window.loadClinicalIssues = async function() {
    if (clinicalIssuesLoaded) {
        console.log('Clinical issues already loaded');
        return;
    }

    try {
        const response = await fetch(`${window.SERVER_URL}/api/clinical-issues`);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json();
        clinicalIssues = data;
        clinicalIssuesLoaded = true;
        console.log('Clinical issues loaded successfully');
    } catch (error) {
        console.error('Error loading clinical issues:', error);
        throw error;
    }
};

// Initialize the application
async function initializeApp() {
    if (isInitialized) {
        console.log('Application already initialized');
        return;
    }

    try {
        // Initialize marked library first
        await initializeMarked();

        // Initialize Firebase auth state listener
        onAuthStateChanged(auth, async (user) => {
            if (user) {
                console.log('User is signed in:', user.email);
                // Load clinical issues after user is authenticated
                try {
                    await window.loadClinicalIssues();
                    isInitialized = true;
                    console.log('Application initialized successfully');
                } catch (error) {
                    console.error('Failed to initialize application:', error);
                }
            } else {
                console.log('User is signed out');
                isInitialized = false;
            }
        });

    } catch (error) {
        console.error('Error during application initialization:', error);
        throw error;
    }
}

// Start initialization when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    initializeApp().catch(error => {
        console.error('Failed to initialize application:', error);
    });
});

// ... rest of the existing code ...
