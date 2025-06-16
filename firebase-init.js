// Import Firebase modules
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { getAuth, GoogleAuthProvider, signInWithPopup } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';

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
        const files = Array.from(fileInput.files);
        const uploadSpinner = document.getElementById('uploadSpinner');
        const uploadText = document.getElementById('uploadText');
        
        if (files.length === 0) {
            alert('Please select at least one file to upload');
            return;
        }

        // Show spinner and update text
        uploadSpinner.style.display = 'inline-block';
        uploadText.textContent = `Uploading ${files.length} file${files.length > 1 ? 's' : ''}...`;

        try {
            console.log(`Attempting to upload ${files.length} files:`, files.map(f => f.name));
            
            // Get the current user's Firebase ID token
            const user = auth.currentUser;
            if (!user) {
                throw new Error('Please sign in first');
            }
            console.log('User is signed in:', user.email);
            const token = await user.getIdToken();
            console.log('Retrieved ID token');

            // Filter out duplicate files if status is available
            const filesToUpload = files.filter(file => {
                if (file.status && file.status === 'duplicate') {
                    console.log(`Skipping duplicate file: ${file.name}`);
                    return false;
                }
                return true;
            });

            const duplicateCount = files.length - filesToUpload.length;
            
            if (filesToUpload.length === 0) {
                alert('All selected files are duplicates. No files will be uploaded.');
                return;
            }

            if (duplicateCount > 0) {
                uploadText.textContent = `Uploading ${filesToUpload.length} files (${duplicateCount} duplicates skipped)...`;
            }

            let successCount = 0;
            let failedFiles = [];
            let skippedFiles = [];

            // Upload files one by one
            for (let i = 0; i < filesToUpload.length; i++) {
                const file = filesToUpload[i];
                uploadText.textContent = `Uploading ${i + 1}/${filesToUpload.length}: ${file.name}`;
                
                try {
                    // Create FormData object for this file
                    const formData = new FormData();
                    formData.append('file', file);

                    // Attempt upload with retries
                    await attemptUpload(formData, token);
                    successCount++;
                    console.log(`Successfully uploaded: ${file.name}`);
                } catch (error) {
                    console.error(`Failed to upload ${file.name}:`, error);
                    failedFiles.push({ name: file.name, error: error.message });
                }
            }

            // Add skipped duplicates to the summary
            files.forEach(file => {
                if (file.status === 'duplicate') {
                    skippedFiles.push({ name: file.name, reason: 'Duplicate content detected' });
                }
            });

            // Show results
            let message = '';
            
            if (successCount === filesToUpload.length && filesToUpload.length === files.length) {
                message = `All ${files.length} files uploaded successfully!`;
            } else {
                message = `Upload Summary:\n`;
                message += `• Successfully uploaded: ${successCount} files\n`;
                
                if (failedFiles.length > 0) {
                    message += `• Failed uploads: ${failedFiles.length} files\n`;
                }
                
                if (skippedFiles.length > 0) {
                    message += `• Skipped duplicates: ${skippedFiles.length} files\n`;
                }
                
                message += `\n`;
                
                if (failedFiles.length > 0) {
                    message += 'Failed files:\n';
                    failedFiles.forEach(f => message += `• ${f.name}: ${f.error}\n`);
                    message += '\n';
                }
                
                if (skippedFiles.length > 0) {
                    message += 'Skipped duplicates:\n';
                    skippedFiles.forEach(f => message += `• ${f.name}: ${f.reason}\n`);
                }
            }
            
            alert(message);
            
            // Dispatch a custom event to notify that guidelines should be reloaded
            if (successCount > 0) {
                window.dispatchEvent(new CustomEvent('reloadGuidelines'));
            }
            
            // Clear the file input and file list
            fileInput.value = '';
            if (window.selectedFiles) {
                window.selectedFiles = [];
            }
            const fileList = document.getElementById('fileList');
            if (fileList) {
                fileList.style.display = 'none';
                fileList.innerHTML = '';
            }
            
        } catch (error) {
            console.error('Error during upload process:', error);
            alert(`Upload process failed: ${error.message}`);
        } finally {
            // Hide spinner and restore text
            uploadSpinner.style.display = 'none';
            uploadText.textContent = 'Upload to GitHub';
        }
    });
} 