// Import Firebase modules
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import { getAnalytics } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-analytics.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';

// Minimal Firebase configuration for client-side
const firebaseConfig = {
    apiKey: "AIzaSyCU4dfGi4vHg_ek-l2V0uksFCv1jL4KV_g",  // This is public and required for client auth
    authDomain: "clerky-b3be8.firebaseapp.com",          // Public domain for auth
    projectId: "clerky-b3be8"                            // Public project identifier
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);
const db = getFirestore(app);
const auth = getAuth(app);

// Export initialized instances
export { app, analytics, db, auth }; 