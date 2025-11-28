// Core Firebase initialization module
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { getAuth, GoogleAuthProvider, signInWithPopup, setPersistence, browserLocalPersistence } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';

// Firebase configuration - using environment variables for security
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

// Make auth available globally with backward compatibility
window.auth = auth;
window.firebase = { 
    auth: () => auth,
    authInstance: auth
};

// Expose GoogleAuthProvider and signInWithPopup
window.firebase.auth.GoogleAuthProvider = GoogleAuthProvider;
window.firebase.auth.signInWithPopup = (provider) => signInWithPopup(auth, provider);

// Export initialized instances
export { app, db, auth }; 