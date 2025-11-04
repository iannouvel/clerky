// Import Firebase modules
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import { getFirestore, collection, getDocs } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { getAuth, GoogleAuthProvider, signInWithPopup, setPersistence, browserLocalPersistence } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';

// Firebase configuration for client-side
const firebaseConfig = {
    apiKey: "AIzaSyAF5y6k9THaRKxLZemqcYDj4y_EgCcDbX8",
    authDomain: "clerky-b3be8.firebaseapp.com",
    projectId: "clerky-b3be8",
    storageBucket: "clerky-b3be8.appspot.com",
    messagingSenderId: "193460924609",
    appId: "1:193460924609:web:6e2c696c87292d4a222440",
    measurementId: "G-V07DP1ELDR"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

// Set authentication persistence to remember users across browser sessions
setPersistence(auth, browserLocalPersistence)
    .then(() => {
        console.log('[DEBUG] Firebase auth persistence set to LOCAL - users will be remembered');
        
        // Check if there's already a user signed in
        const currentUser = auth.currentUser;
        if (currentUser) {
            console.log('[DEBUG] User already signed in on page load:', currentUser.email);
        } else {
            console.log('[DEBUG] No user signed in on page load');
        }
    })
    .catch((error) => {
        console.error('[ERROR] Failed to set auth persistence:', error);
    });

// Make auth and db available globally with backward compatibility
window.auth = auth;
window.db = db;  // Make Firestore available globally
window.firestoreCollection = collection;  // Make collection function available
window.firestoreGetDocs = getDocs;  // Make getDocs function available
window.firebase = { 
    auth: () => auth,
    authInstance: auth,
    firestore: () => db,
    firestoreInstance: db
};

// Expose GoogleAuthProvider and signInWithPopup
window.firebase.auth.GoogleAuthProvider = GoogleAuthProvider;
window.firebase.auth.signInWithPopup = (provider) => signInWithPopup(auth, provider);

// Export initialized instances
export { app, db, auth, collection, getDocs };

// Constants for retry logic
const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY = 2000; // 2 seconds

// Helper function to delay execution
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// Function to attempt upload with retries
async function attemptUpload(formData, token, retryCount = 0) {
    try {
        const response = await fetch('https://clerky-uzni.onrender.com/uploadGuideline', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`
            },
            body: formData
        });

        console.log('Server response status:', response.status);
        
        if (response.ok) {
            const result = await response.json();
            console.log('Upload successful:', result);
            return result;
        }

        // If we get a 502 Bad Gateway or CORS error and haven't exceeded retries
        if ((response.status === 502 || response.status === 0) && retryCount < MAX_RETRIES) {
            const retryDelay = INITIAL_RETRY_DELAY * Math.pow(2, retryCount);
            console.log(`Retrying upload in ${retryDelay/1000} seconds... (Attempt ${retryCount + 1}/${MAX_RETRIES})`);
            await delay(retryDelay);
            return attemptUpload(formData, token, retryCount + 1);
        }

        const error = await response.text();
        throw new Error(error || `HTTP error! status: ${response.status}`);
    } catch (error) {
        // If it's a network error and we haven't exceeded retries
        if ((error.name === 'TypeError' || error.message.includes('Failed to fetch')) && retryCount < MAX_RETRIES) {
            const retryDelay = INITIAL_RETRY_DELAY * Math.pow(2, retryCount);
            console.log(`Retrying upload in ${retryDelay/1000} seconds... (Attempt ${retryCount + 1}/${MAX_RETRIES})`);
            await delay(retryDelay);
            return attemptUpload(formData, token, retryCount + 1);
        }
        throw error;
    }
}

// NOTE: Upload form submission handler DISABLED here because guidelines.html
// already has its own handler that properly includes scope, nation, and hospitalTrust.
// Having two handlers was causing files to be uploaded twice, with the second upload
// overwriting the first with default "national" scope values.
//
// If you need to re-enable this for other pages, make sure to:
// 1. Check if guidelines.html is loaded to avoid duplicate handlers
// 2. Include scope/nation/hospitalTrust fields in the FormData
//
// const uploadForm = document.getElementById('uploadForm');
// if (uploadForm) {
//     ... handler code commented out ...
// } 