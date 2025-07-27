// Core Firebase initialization module - TEMPLATE
// Copy this file to firebase-core.js and add your actual API key
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { getAuth, GoogleAuthProvider, signInWithPopup } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';

// Firebase configuration - REPLACE WITH YOUR ACTUAL CONFIG
const firebaseConfig = {
    apiKey: "YOUR_API_KEY_HERE",
    authDomain: "your-project.firebaseapp.com",
    projectId: "your-project-id",
    storageBucket: "your-project.appspot.com",
    messagingSenderId: "your-sender-id",
    appId: "your-app-id",
    measurementId: "your-measurement-id"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

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