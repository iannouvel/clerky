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

// Use the global marked object
const marked = window.marked;

// ... rest of the existing code ...
