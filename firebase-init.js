// Import Firebase modules
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
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
const db = getFirestore(app);
const auth = getAuth(app);

// Make auth available globally
window.firebase = { auth };

// Export initialized instances
export { app, db, auth };

document.getElementById('uploadForm').addEventListener('submit', async function(e) {
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

        // Send the file to the server
        const response = await fetch('https://clerky-uzni.onrender.com/uploadGuideline', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`
            },
            body: formData
        });

        console.log('Server response status:', response.status);
        if (!response.ok) {
            const error = await response.text();
            console.error('Server error response:', error);
            throw new Error(error);
        }

        const result = await response.json();
        console.log('Upload successful:', result);
        alert('Guideline uploaded successfully!');
        
        // Reload the guidelines list
        await loadGuidelines();
        
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