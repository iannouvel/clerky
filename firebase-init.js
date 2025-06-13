// Import Firebase modules
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';

// Firebase configuration for client-side
const firebaseConfig = {
    apiKey: "AIzaSyCU4dfGi4vHg_ek-l2V0uksFCv1jL4KV_g",
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

// Make auth available globally with backward compatibility
// This ensures both firebase.auth() and firebase.auth work
window.firebase = { 
    auth: () => auth,  // Function that returns the auth instance
    authInstance: auth // Direct access to auth instance
};

// Export initialized instances
export { app, db, auth };

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

const uploadForm = document.getElementById('uploadForm');
if (uploadForm) {
    uploadForm.addEventListener('submit', async function(e) {
        e.preventDefault();
        
        const fileInput = document.getElementById('guidelineFile');
        const file = fileInput.files[0];
        const uploadSpinner = document.getElementById('uploadSpinner');
        const uploadText = document.getElementById('uploadText');
        
        if (!file) {
            alert('Please select a file to upload');
            return;
        }

        // Show spinner and hide text
        uploadSpinner.style.display = 'inline-block';
        uploadText.style.display = 'none';

        try {
            console.log('Attempting to upload file:', file.name);
            // Get the current user's Firebase ID token
            const user = auth.currentUser;
            if (!user) {
                throw new Error('Please sign in first');
            }
            console.log('User is signed in:', user.email);
            const token = await user.getIdToken();
            console.log('Retrieved ID token');

            // Create FormData object
            const formData = new FormData();
            formData.append('file', file);

            // Attempt upload with retries
            const result = await attemptUpload(formData, token);
            alert('Guideline uploaded successfully!');
            
            // Dispatch a custom event to notify that guidelines should be reloaded
            window.dispatchEvent(new CustomEvent('reloadGuidelines'));
            
            // Clear the file input
            fileInput.value = '';
        } catch (error) {
            console.error('Error uploading guideline:', error);
            alert(`Failed to upload guideline: ${error.message}`);
        } finally {
            // Hide spinner and show text
            uploadSpinner.style.display = 'none';
            uploadText.style.display = 'inline-block';
        }
    });
} 