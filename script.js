// Import Firebase instances from firebase-init.js
import { app, db, auth } from './firebase-init.js';
import { GoogleAuthProvider, signInWithPopup, onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import { getAnalytics } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-analytics.js';
import { doc, getDoc } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

// Initialize Analytics
const analytics = getAnalytics(app);

// Global state variables
let filenames = [];
let summaries = [];
let guidanceDataLoaded = false;
let actionSpinner = null;
let actionText = null;

const SERVER_URL = 'https://clerky-uzni.onrender.com';

// Function to load guidance data
async function loadGuidelineSummaries(retryCount = 0) {
    const MAX_RETRIES = 3;
    console.log('=== loadGuidelineSummaries ===');
    console.log('Current state:', {
        guidanceDataLoaded,
        filenamesLength: filenames.length,
        summariesLength: summaries.length,
        retryCount
    });
    
    try {
        console.log('Attempting to fetch guideline summaries from GitHub...');
        const response = await fetch('https://raw.githubusercontent.com/iannouvel/clerky/main/guidance/summary/list_of_summaries.json');
        console.log('Fetch response:', {
            ok: response.ok,
            status: response.status,
            statusText: response.statusText
        });
        
        if (!response.ok) {
            throw new Error('Network response was not ok: ' + response.status + ' ' + response.statusText);
        }
        
        console.log('Parsing JSON response...');
        const data = await response.json();
        console.log('JSON parsed successfully. Data structure:', {
            keys: Object.keys(data).length,
            hasData: !!data,
            sampleKey: Object.keys(data)[0]
        });
        
        // Store the data
        filenames = Object.keys(data);
        summaries = Object.values(data);
        
        console.log('Data stored successfully:', {
            filenamesLoaded: filenames.length,
            summariesLoaded: summaries.length,
            samplesMatch: filenames.length === summaries.length
        });
        
        guidanceDataLoaded = true;
        return true;
    } catch (error) {
        console.error('Error in loadGuidelineSummaries:', {
            error: error.message,
            type: error.name,
            retryCount,
            maxRetries: MAX_RETRIES
        });
        
        if (retryCount < MAX_RETRIES) {
            console.log(`Retrying... (Attempt ${retryCount + 1} of ${MAX_RETRIES})`);
            // Wait for 1 second before retrying
            await new Promise(resolve => setTimeout(resolve, 1000));
            return loadGuidelineSummaries(retryCount + 1);
        }
        
        console.error('Max retries exceeded. Showing error to user.');
        // If we've exhausted retries, show an error message to the user
        const errorDiv = document.createElement('div');
        errorDiv.className = 'error-message';
        errorDiv.textContent = 'Failed to load guidelines. Please refresh the page and try again.';
        document.body.insertBefore(errorDiv, document.body.firstChild);
        
        return false;
    }
}

// Define handleAction at the top level
async function handleAction(retryCount = 0) {
    console.log('=== Legacy handleAction started ===');
    
    // Initialize UI elements if not already done
    if (!actionSpinner) actionSpinner = document.getElementById('actionSpinner');
    if (!actionText) actionText = document.getElementById('actionText');
    
    if (actionSpinner && actionText) {
        actionSpinner.style.display = 'inline-block';
        actionText.style.display = 'none';
    }

    try {
        const user = auth.currentUser;
        if (!user) {
            throw new Error('Please sign in first');
        }
        const token = await user.getIdToken();

        const prompts = await fetch('https://raw.githubusercontent.com/iannouvel/clerky/main/prompts.json').then(response => response.json());
        const summaryDiv = document.getElementById('summary');
        if (!summaryDiv) {
            throw new Error('Summary div not found');
        }
        
        const summaryText = summaryDiv.textContent.trim();
        if (!summaryText) {
            throw new Error('Please provide a summary text.');
        }

        console.log('Sending request to server with summary:', summaryText.substring(0, 100) + '...');

        const issuesPrompt = `${prompts.issues.prompt}

Please identify and return a concise list of clinical issues, following these rules:
1. Merge any symptom/condition with its monitoring/management
2. Merge any related conditions
3. Keep medical terminology precise and concise
4. Include relevant context in the merged issue where appropriate
5. Return ONLY the final merged list, one issue per line

Clinical Summary:
${summaryText}`;

        const issuesResponse = await fetch(`${SERVER_URL}/handleIssues`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`,
                'Accept': 'application/json'
            },
            body: JSON.stringify({ 
                prompt: issuesPrompt
            })
        });

        if (!issuesResponse.ok) {
            throw new Error(`Server error: ${issuesResponse.status} ${issuesResponse.statusText}`);
        }

        console.log('Server response received');
        const issuesData = await issuesResponse.json();
        console.log('Response data:', issuesData);

        if (!issuesData.success) {
            throw new Error(`Server error: ${issuesData.message || 'Unknown error'}`);
        }

        // Return the data for React components
        return {
            success: true,
            issues: issuesData.issues || []
        };
    } catch (error) {
        console.error('Error in legacy handleAction:', {
            message: error.message,
            stack: error.stack,
            type: error.name
        });
        
        if (retryCount < 2 && 
            (error.message.includes('Failed to fetch') || 
             error.message.includes('Connection reset'))) {
            console.log(`Retrying handleAction (attempt ${retryCount + 1})...`);
            await new Promise(resolve => setTimeout(resolve, 2000));
            return handleAction(retryCount + 1);
        }
        
        // Show error to user
        alert(error.message || 'An error occurred while processing. Please try again.');
        throw error;
    } finally {
        if (actionSpinner && actionText) {
            actionSpinner.style.display = 'none';
            actionText.style.display = 'inline-block';
        }
        console.log('=== Legacy handleAction completed ===');
    }
}

// Make functions available globally
window.handleAction = handleAction;
window.displayIssues = async function(issues, prompts) {
    try {
        console.log('=== displayIssues started ===');
        // ... rest of displayIssues function ...
    } catch (error) {
        console.error('Error in displayIssues:', error);
        alert('Error displaying issues. Please try again.');
    }
};
window.getPrompts = async function() {
    try {
        console.log('Fetching prompts from GitHub');
        const response = await fetch('https://raw.githubusercontent.com/iannouvel/clerky/main/prompts.json');
        if (!response.ok) {
            throw new Error(`Failed to fetch prompts: ${response.status} ${response.statusText}`);
        }
        const defaultPrompts = await response.json();
        console.log('Fetched prompts successfully');
        return defaultPrompts;
    } catch (error) {
        console.error('Error fetching prompts:', error);
        return {
            issues: {
                prompt: "Please analyze this clinical scenario and identify the major issues..."
            },
            guidelines: {
                prompt: "Please identify relevant guidelines for this issue..."
            }
        };
    }
};

// Modified DOMContentLoaded event listener
document.addEventListener('DOMContentLoaded', async function() {
    try {
        const loaded = await loadGuidelineSummaries();
        if (!loaded) {
            console.error('Failed to load guideline summaries');
            return;
        }

        // Initialize UI elements
        actionSpinner = document.getElementById('actionSpinner');
        actionText = document.getElementById('actionText');
        
        // Get button elements
        const actionBtn = document.getElementById('actionBtn');
        const workflowsBtn = document.getElementById('workflowsBtn');

        // Add event listeners with error handling
        if (actionBtn) {
            actionBtn.addEventListener('click', async () => {
                try {
                    await handleAction();
                } catch (error) {
                    console.error('Error in action button click:', error);
                }
            });
        } else {
            console.warn('Action button not found in DOM');
        }

        if (workflowsBtn) {
            workflowsBtn.addEventListener('click', () => {
                try {
                    window.open('workflows.html', '_blank');
                } catch (error) {
                    console.error('Error opening workflows:', error);
                    alert('Error opening workflows page. Please try again.');
                }
            });
        } else {
            console.warn('Workflows button not found in DOM');
        }

        // ... rest of the initialization code ...
    } catch (error) {
        console.error('Error during initialization:', {
            message: error.message,
            stack: error.stack,
            type: error.name
        });
        alert('Error initializing application. Please refresh the page.');
    }
});

// ... rest of the code ...