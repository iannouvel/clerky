// Import Firebase instances from firebase-init.js
import { app, db, auth } from './firebase-init.js';
import { GoogleAuthProvider, signInWithPopup, onAuthStateChanged, signOut, signInWithRedirect, getRedirectResult } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import { getAnalytics } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-analytics.js';
import { doc, getDoc, setDoc } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

// Make auth globally available for functions in index.html
window.auth = auth;

// Set up auth state listener early
onAuthStateChanged(auth, (user) => {
  console.log('Auth state changed:', user ? 'User logged in' : 'User logged out');
  if (user) {
    console.log('User authenticated:', user.email);
    // Update UI for authenticated user
    updateUI(user);
  } else {
    console.log('No user authenticated');
    // Update UI for non-authenticated user
    updateUI(null);
  }
});

// Add this global variable to store the selected issue
let selectedClinicalIssue = null;
let selectedClinicalIssueType = null;

// Update the generateFakeTranscript function to use the selected issue
async function generateFakeTranscript() {
  console.log('=== generateFakeTranscript START ===');
  try {
    // Get user token
    const user = auth.currentUser;
    if (!user) {
      console.error('No user found');
      throw new Error('User not authenticated. Please log in first.');
    }
    console.log('Got user');

    // Get prompt based on if an issue was selected
    let enhancedPrompt;
    if (selectedClinicalIssue) {
      console.log('Using selected clinical issue for prompt:', selectedClinicalIssue);
      
      // Fetch prompts from config file
      const promptsResponse = await fetch('https://raw.githubusercontent.com/iannouvel/clerky/main/prompts.json');
      if (!promptsResponse.ok) {
        throw new Error(`Failed to fetch prompts: ${promptsResponse.status}`);
      }
      const prompts = await promptsResponse.json();
      
      // Use the testTranscript prompt from config
      if (!prompts.testTranscript || !prompts.testTranscript.prompt) {
        throw new Error('Test transcript prompt not found in configuration');
      }
      
      // Create a prompt with the selected issue
      enhancedPrompt = `${prompts.testTranscript.prompt} 
      
The clinical scenario should focus on a patient with ${selectedClinicalIssue}.`;
      
      console.log('Using enhanced prompt with selected issue');
    } else {
      // Fallback to generic prompt if no issue selected
      console.log('Using simple placeholder prompt (no issue selected)');
      enhancedPrompt = "Generate a medical transcript for a patient consultation";
    }

    // Get token
    console.log('Getting auth token');
    const token = await user.getIdToken();
    if (!token) {
      console.error('Failed to get token');
      throw new Error('Failed to get authentication token');
    }
    console.log('Got auth token');

    // Make API request
    console.log('Making API request');
    const response = await fetch('https://clerky-uzni.onrender.com/generateFakeClinicalInteraction', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        prompt: enhancedPrompt,
        model: typeof getUserAIPreference === 'function' ? getUserAIPreference() : 'DeepSeek'
      })
    });

    if (!response.ok) {
      throw new Error(`API request failed with status: ${response.status}`);
    }

    const data = await response.json();
    console.log('API response received');

    // Check for valid response
    if (data.success && data.response && data.response.content) {
      console.log('Data contains response content');
      
      // Simple content setting logic
      const activePane = document.querySelector('.transcript-pane.active');
      if (!activePane) {
        console.error('No active pane found');
        throw new Error('No active transcript pane found');
      }
      
      console.log('Found active pane, setting content');
      
      // Initialize TipTap if needed
      if (!activePane._tiptapEditor && typeof initializeTipTap === 'function') {
        console.log('Initializing editor for active pane');
        initializeTipTap(activePane);
      }
      
      // Set content with fallbacks
      if (activePane._tiptapEditor) {
        console.log('Setting content via editor API');
        setEditorContent(activePane._tiptapEditor, data.response.content);
      } else {
        console.log('Setting content directly to pane');
        const textarea = activePane.querySelector('textarea');
        if (textarea) {
          textarea.value = data.response.content;
        } else {
          activePane.innerHTML = data.response.content;
        }
      }
      
      console.log('Content set successfully');
      return data.response.content;
    } else {
      console.error('Invalid response format');
      throw new Error('Invalid response format from server');
    }
  } catch (error) {
    console.error('Error generating fake transcript:', error);
    throw error;
  } finally {
    console.log('=== generateFakeTranscript END ===');
  }
}

// Make generateFakeTranscript available globally
window.generateFakeTranscript = generateFakeTranscript;

// Set up sign out functionality
document.addEventListener('DOMContentLoaded', function() {
  const signOutBtn = document.getElementById('signOutBtn');
  if (signOutBtn) {
    signOutBtn.addEventListener('click', async function() {
      try {
        await signOut(auth);
        console.log('User signed out successfully');
        // UI will be updated by the auth state listener
      } catch (error) {
        console.error('Error signing out:', error);
        alert('Error signing out: ' + error.message);
      }
    });
    console.log('Sign out button set up');
  }
});

// Using global functions instead of importing from tiptap-editor.js
// window.initializeTipTap, window.getEditorContent, and window.setEditorContent are defined in index.html

// TipTap editors
let clinicalNoteEditor = null;
let summaryEditor = null;
let historyEditor = null;

// Store original content before track changes
let originalClinicalNoteContent = null;

// Initialize Analytics
const analytics = getAnalytics(app);

// Declare these variables at the top level of your script
let filenames = [];
let summaries = [];
let guidanceDataLoaded = false;

const SERVER_URL = 'https://clerky-uzni.onrender.com';

// Global state variables for tracking issues and guidelines
let AIGeneratedListOfIssues = [];
let guidelinesForEachIssue = [];

// Add these at the top level of your script
let currentModel = 'OpenAI'; // Track current model

// Global debug utility for tracking all user interactions
(function setupGlobalEventTracking() {
    console.log("🔍 Setting up global event tracking for debugging");
    
    // Debug configuration
    window.debugConfig = {
        enabled: true,           // Master switch
        trackClicks: true,       // Track button clicks
        trackInputs: true,       // Track input changes
        trackForms: true,        // Track form submissions
        trackKeyboard: true,     // Track keyboard events
        trackFocus: true,        // Track focus/blur events
        trackTipTap: true,       // Track TipTap editor events
        logLevel: 'verbose'      // 'verbose', 'normal', 'minimal'
    };
    
    // Helper to check if debugging is enabled for a category
    function isDebuggingEnabled(category) {
        return window.debugConfig.enabled && window.debugConfig[category];
    }
    
    // Debug logger that respects configuration
    window.debugLog = function(category, emoji, message, details) {
        if (!isDebuggingEnabled(category)) return;
        
        if (window.debugConfig.logLevel === 'minimal') {
            console.log(`${emoji} ${message}`);
        } else if (window.debugConfig.logLevel === 'normal' || !details) {
            console.log(`${emoji} ${message}`);
        } else {
            console.log(`${emoji} ${message}`);
            console.log(`  ${details}`);
        }
    };
    
    // Utility functions to control debugging
    window.disableDebugging = function() {
        window.debugConfig.enabled = false;
        console.log("🚫 Debugging disabled");
    };
    
    window.enableDebugging = function() {
        window.debugConfig.enabled = true;
        console.log("✅ Debugging enabled");
    };
    
    window.setDebugCategories = function(categories) {
        Object.keys(categories).forEach(key => {
            if (window.debugConfig.hasOwnProperty(key)) {
                window.debugConfig[key] = categories[key];
            }
        });
        console.log("🔧 Debug categories updated:", window.debugConfig);
    };
    
    function setupTracking() {
        console.log("📊 Initializing event tracking...");
        
        // Track all button clicks
        document.addEventListener('click', function(e) {
            if (!isDebuggingEnabled('trackClicks')) return;
            
            const target = e.target;
            
            // Check if clicked element is a button or inside a button
            const button = target.closest('button');
            if (button) {
                const id = button.id || 'unnamed-button';
                const text = button.textContent.trim();
                const classes = Array.from(button.classList).join(', ');
                
                window.debugLog('trackClicks', '🖱️', `BUTTON CLICK: id="${id}", text="${text}"`, 
                    `classes="${classes}", parent=${button.parentElement ? button.parentElement.tagName : 'none'}`);
            }
        }, true);  // Use capturing to ensure we catch all events
        
        // Track all input changes
        document.addEventListener('input', function(e) {
            if (!isDebuggingEnabled('trackInputs')) return;
            
            const target = e.target;
            
            if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') {
                const id = target.id || 'unnamed-input';
                const type = target.type || target.tagName.toLowerCase();
                let valueInfo = '';
                
                // Only log the value length for privacy, unless it's a checkbox or radio
                if (target.type === 'checkbox' || target.type === 'radio') {
                    valueInfo = `Value: ${target.checked ? 'checked' : 'unchecked'}`;
                } else {
                    valueInfo = `Value length: ${target.value.length} characters`;
                }
                
                window.debugLog('trackInputs', '⌨️', `INPUT CHANGE: id="${id}", type="${type}"`, valueInfo);
            }
        }, true);  // Use capturing
        
        // Track form submissions
        document.addEventListener('submit', function(e) {
            if (!isDebuggingEnabled('trackForms')) return;
            
            const form = e.target;
            const id = form.id || 'unnamed-form';
            const inputCount = form.querySelectorAll('input, textarea, select').length;
            
            window.debugLog('trackForms', '📝', `FORM SUBMIT: id="${id}"`, `Contains ${inputCount} input elements`);
        }, true);
        
        // Track keyboard events (keys pressed)
        document.addEventListener('keydown', function(e) {
            if (!isDebuggingEnabled('trackKeyboard')) return;
            
            // Don't log modifier keys by themselves
            if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) {
                return;
            }
            
            // Build key combination string
            let keyCombo = '';
            if (e.ctrlKey) keyCombo += 'Ctrl+';
            if (e.shiftKey) keyCombo += 'Shift+';
            if (e.altKey) keyCombo += 'Alt+';
            if (e.metaKey) keyCombo += 'Meta+';
            keyCombo += e.key;
            
            // Log keyboard event with target element info
            const targetElement = e.target;
            const targetInfo = targetElement.tagName + 
                (targetElement.id ? ` id="${targetElement.id}"` : '') + 
                (targetElement.className ? ` class="${targetElement.className}"` : '');
            
            window.debugLog('trackKeyboard', '⌨️', `KEY PRESSED: ${keyCombo}`, `on ${targetInfo}`);
        }, true);
        
        // Track focus events
        document.addEventListener('focus', function(e) {
            if (!isDebuggingEnabled('trackFocus')) return;
            
            const target = e.target;
            const id = target.id || 'unnamed-element';
            const tagName = target.tagName.toLowerCase();
            
            window.debugLog('trackFocus', '👁️', `FOCUS: ${tagName}${id ? ` id="${id}"` : ''}`);
        }, true);
        
        // Track blur events
        document.addEventListener('blur', function(e) {
            if (!isDebuggingEnabled('trackFocus')) return;
            
            const target = e.target;
            const id = target.id || 'unnamed-element';
            const tagName = target.tagName.toLowerCase();
            
            window.debugLog('trackFocus', '🚶', `BLUR: ${tagName}${id ? ` id="${id}"` : ''}`);
        }, true);
        
        // Track TipTap editor interactions
        // This needs to be added after TipTap is initialized
        function setupTipTapTracking() {
            if (!isDebuggingEnabled('trackTipTap')) return;
            
            if (clinicalNoteEditor) {
                console.log("📄 Setting up TipTap clinical note editor tracking");
                // Check if the editor has the 'on' method before using it
                if (clinicalNoteEditor.on && typeof clinicalNoteEditor.on === 'function') {
                    clinicalNoteEditor.on('update', ({ editor }) => {
                        window.debugLog('trackTipTap', '📄', 'CLINICAL NOTE EDITOR UPDATED', 
                            `Content length: ${editor.getHTML().length} characters`);
                    });
                } else {
                    console.log("📄 Clinical note editor does not support event tracking");
                }
            }
            
            if (summaryEditor) {
                console.log("📄 Setting up TipTap summary editor tracking");
                // Check if the editor has the 'on' method before using it
                if (summaryEditor.on && typeof summaryEditor.on === 'function') {
                    summaryEditor.on('update', ({ editor }) => {
                        window.debugLog('trackTipTap', '📄', 'SUMMARY EDITOR UPDATED', 
                            `Content length: ${editor.getHTML().length} characters`);
                    });
                } else {
                    console.log("📄 Summary editor does not support event tracking");
                }
            }
            
            if (historyEditor) {
                console.log("📄 Setting up TipTap history editor tracking");
                // Check if the editor has the 'on' method before using it
                if (historyEditor.on && typeof historyEditor.on === 'function') {
                    historyEditor.on('update', ({ editor }) => {
                        window.debugLog('trackTipTap', '📄', 'HISTORY EDITOR UPDATED', 
                            `Content length: ${editor.getHTML().length} characters`);
                    });
                } else {
                    console.log("📄 History editor does not support event tracking");
                }
            }
        }
        
        // Check TipTap editors periodically
        const tipTapCheckInterval = setInterval(() => {
            if (clinicalNoteEditor || summaryEditor || historyEditor) {
                try {
                    setupTipTapTracking();
                } catch (error) {
                    console.error("Error setting up TipTap tracking:", error);
                }
                clearInterval(tipTapCheckInterval);
            }
        }, 1000);
        
        // Clear interval after 10 seconds regardless to prevent memory leaks
        setTimeout(() => {
            clearInterval(tipTapCheckInterval);
            console.log("TipTap check interval cleared (timeout)");
        }, 10000);
        
        console.log("✅ Global event tracking initialized successfully");
    }
    
    // Try to set up immediately
    if (document.readyState !== 'loading') {
        setupTracking();
    } else {
        // Or wait for DOM to be fully loaded
        document.addEventListener('DOMContentLoaded', setupTracking);
    }
    
    // Also set up when window is fully loaded
    window.addEventListener('load', function() {
        console.log("🌐 Window fully loaded, ensuring tracking is set up");
        setupTracking();
    });
})();

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

// Simplified server health check just returns true without UI updates
async function checkServerHealth() {
    // Simply return true as we now have retry logic for all server calls
    return true;
}

// Simplified ensureServerHealth function
async function ensureServerHealth() {
    // We now have retry logic for server calls, so no need to check health upfront
    return true;
}

// Initialize TipTap editors with fallback support
function initializeEditors() {
    console.log('Initializing editors...');
    
    // Check if TipTap is available
    if (!window.tiptap && !window.initializeTipTap) {
        console.error('TipTap libraries not loaded properly. Using fallback editors.');
        createFallbackEditors();
        return;
    }
    
    try {
        // Initialize summary editor
        const summaryElement = document.getElementById('summary');
        if (summaryElement) {
            summaryEditor = window.initializeTipTap(summaryElement, 'Enter transcript here...');
            
            // Listen for tiptap-update events
            if (summaryEditor) {
                summaryElement.addEventListener('tiptap-update', (event) => {
                    console.log('Summary updated:', event.detail.html);
                });
            }
        }
        
        // Initialize history editor
        const historyElement = document.getElementById('history');
        if (historyElement) {
            historyEditor = window.initializeTipTap(historyElement, 'Enter patient history here...');
            
            // Listen for tiptap-update events
            if (historyEditor) {
                historyElement.addEventListener('tiptap-update', (event) => {
                    console.log('History updated:', event.detail.html);
                });
            }
        }
        
        // Initialize clinical note editor
        const clinicalNoteOutput = document.getElementById('clinicalNoteOutput');
        if (clinicalNoteOutput) {
            clinicalNoteEditor = window.initializeTipTap(clinicalNoteOutput, 'Write clinical note here...');
        }
        
        console.log('Editors initialized successfully:', {
            summary: !!summaryEditor,
            history: !!historyEditor,
            clinicalNote: !!clinicalNoteEditor
        });
    } catch (error) {
        console.error('Error initializing editors:', error);
        createFallbackEditors();
    }
}

// Create simple textarea fallbacks if TipTap fails
function createFallbackEditors() {
    // Create summary fallback
    const summaryElement = document.getElementById('summary');
    if (summaryElement && !summaryElement.querySelector('textarea')) {
        const textarea = document.createElement('textarea');
        textarea.className = 'fallback-editor';
        textarea.placeholder = summaryElement.getAttribute('placeholder') || 'Enter transcript here...';
        textarea.id = 'summary-fallback';
        summaryElement.innerHTML = '';
        summaryElement.appendChild(textarea);
    }
    
    // Create history fallback
    const historyElement = document.getElementById('history');
    if (historyElement && !historyElement.querySelector('textarea')) {
        const textarea = document.createElement('textarea');
        textarea.className = 'fallback-editor';
        textarea.placeholder = historyElement.getAttribute('placeholder') || 'Enter patient history here...';
        textarea.id = 'history-fallback';
        historyElement.innerHTML = '';
        historyElement.appendChild(textarea);
    }
    
    // Create clinical note fallback if needed
    const clinicalNoteElement = document.getElementById('clinicalNoteOutput');
    if (clinicalNoteElement && !clinicalNoteElement.querySelector('textarea')) {
        const textarea = document.createElement('textarea');
        textarea.className = 'fallback-editor';
        textarea.placeholder = 'Clinical note will appear here...';
        textarea.id = 'clinicalNote-fallback';
        clinicalNoteElement.innerHTML = '';
        clinicalNoteElement.appendChild(textarea);
    }
    
    console.log('Fallback editors created successfully');
}

// Define handleAction at the top level
async function handleAction() {
    console.log('=== handleAction ===');
    
    // Define retry settings
    const MAX_RETRIES = 3;
    const RETRY_DELAYS = [2000, 4000, 8000]; // 2, 4, 8 seconds

    // Helper function to delay execution
    const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
    
    const actionBtn = document.getElementById('actionBtn');
    const actionSpinner = document.getElementById('actionSpinner');
    const actionText = document.getElementById('actionText');

    // Reset the global arrays at the start of each action
    AIGeneratedListOfIssues = [];
    guidelinesForEachIssue = [];

    // Get text content using our getter function
    const summaryText = getSummaryContent();

    if (!summaryText) {
        alert('Please enter some text first');
        return;
    }

    // Show loading state
    if (actionBtn && actionSpinner && actionText) {
        actionBtn.disabled = true;
        actionSpinner.style.display = 'inline-block';
        actionText.style.display = 'none';
    }

    let lastError = null;

    try {
        // Get the current user's ID token
        const user = auth.currentUser;
        if (!user) {
            throw new Error('Please sign in first');
        }
        const token = await user.getIdToken();

        // Fetch prompts
        console.log('Fetching prompts...');
        const prompts = await fetch('https://raw.githubusercontent.com/iannouvel/clerky/main/prompts.json')
            .then(response => {
                if (!response.ok) {
                    throw new Error(`Failed to fetch prompts: ${response.status} ${response.statusText}`);
                }
                return response.json();
            })
            .catch(error => {
                console.error('Prompts fetch failed:', error);
                throw new Error('Failed to load prompts configuration');
            });

        // Prepare the prompt
        const issuesPrompt = `${prompts.issues.prompt}

Clinical Summary:
${summaryText}`;

        // Make the API request with retries
        for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
            try {
                if (attempt > 0) {
                    console.log(`Retry attempt ${attempt}/${MAX_RETRIES} for handleIssues after ${RETRY_DELAYS[attempt-1]/1000} seconds...`);
                }
                
                console.log(`Sending request to server (attempt ${attempt+1}/${MAX_RETRIES+1})...`);
                const issuesResponse = await fetch(`${SERVER_URL}/handleIssues`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`,
                        'Accept': 'application/json'
                    },
                    body: JSON.stringify({ prompt: issuesPrompt })
                });

                // Check if the response is valid
                if (!issuesResponse.ok) {
                    const errorText = await issuesResponse.text().catch(e => 'Could not read error response');
                    throw new Error(`Server returned ${issuesResponse.status} ${issuesResponse.statusText} - ${errorText}`);
                }

                // Try to parse the response as JSON
                const issuesData = await issuesResponse.json();
                console.log('Response data:', issuesData);
                
                if (!issuesData.success) {
                    throw new Error(issuesData.message || 'Server returned unsuccessful response');
                }

                // Check if the response contains an issues array
                if (issuesData.issues && Array.isArray(issuesData.issues)) {
                    console.log('Successfully processed issues:', issuesData.issues.length);
                    
                    // Call displayIssues with the issues array
                    await displayIssues(issuesData.issues, prompts);
                    
                    // Success - break out of the retry loop
                    return issuesData;
                }
                // Check for legacy response format (response field)
                else if (issuesData.response) {
                    // Extract the content from the response object if needed
                    const responseText = issuesData.response && typeof issuesData.response === 'object' 
                        ? issuesData.response.content 
                        : issuesData.response;
                        
                    if (!responseText) {
                        throw new Error('Invalid response format from server');
                    }

                    // Successfully processed the response
                    console.log('Successfully processed issues (legacy format)');
                    
                    // Call displayIssues with the AI response
                    await displayIssues(responseText, prompts);
                    
                    // Success - break out of the retry loop
                    return issuesData;
                }
                else {
                    throw new Error('Invalid response format from server - missing issues array or response field');
                }

            } catch (error) {
                lastError = error;
                console.error(`Error processing issues (attempt ${attempt+1}/${MAX_RETRIES+1}):`, error.message);
                
                // If this isn't the last attempt, wait before retrying
                if (attempt < MAX_RETRIES) {
                    const retryDelay = RETRY_DELAYS[attempt];
                    console.log(`Will retry handleIssues in ${retryDelay/1000} seconds...`);
                    await delay(retryDelay);
                }
            }
        }
        
        // If we've exhausted all retries, throw the last error
        console.error(`Failed to process issues after ${MAX_RETRIES+1} attempts`);
        throw lastError || new Error('Failed to process issues after multiple attempts');
        
    } catch (error) {
        console.error('Error in handleAction:', {
            message: error.message,
            stack: error.stack,
            type: error.name
        });

        // Show user-friendly error message
        const errorMessage = error.message.includes('Please sign in') ? error.message :
            'Failed to process the text. Please try again later.';
        
        alert(errorMessage);
        throw error;

    } finally {
        // Reset UI state
        if (actionBtn && actionSpinner && actionText) {
            actionBtn.disabled = false;
            actionSpinner.style.display = 'none';
            actionText.style.display = 'inline-block';
        }
        console.log('=== handleAction completed ===');
    }
}

// Make handleAction available globally immediately
window.handleAction = handleAction;

// Modified DOMContentLoaded event listener
document.addEventListener('DOMContentLoaded', function() {
    console.log('=== DOMContentLoaded START ===');
    
    // Set up Google Sign In button
    const googleSignInBtn = document.getElementById('googleSignInBtn');
    if (googleSignInBtn) {
        console.log('Setting up Google Sign In button');
        googleSignInBtn.addEventListener('click', async function() {
            try {
                const provider = new GoogleAuthProvider();
                console.log('Attempting to sign in with Google...');
                
                // Try popup first
                try {
                    const result = await signInWithPopup(auth, provider);
                    console.log('Sign in successful:', result.user.email);
                    updateUI(result.user);
                } catch (popupError) {
                    console.error('Popup sign in failed, trying redirect:', popupError);
                    // If popup fails, try redirect
                    await signInWithRedirect(auth, provider);
                }
            } catch (error) {
                console.error('Google sign in error:', error);
                alert('Sign in failed: ' + error.message);
            }
        });
        console.log('Google Sign In button setup complete');
    } else {
        console.warn('Google Sign In button not found');
    }
    
    // Set up Action button (Process button)
    const actionBtn = document.getElementById('actionBtn');
    if (actionBtn) {
        actionBtn.addEventListener('click', async function() {
            console.log('Action button clicked, calling handleAction()');
            try {
                await handleAction();
            } catch (error) {
                console.error('Error in handleAction:', error);
            }
        });
        console.log('Action button listener set up');
    } else {
        console.warn('Action button not found');
    }
    
    // Set up Generate Clinical Note button (Note button)
    const generateClinicalNoteBtn = document.getElementById('generateClinicalNoteBtn');
    if (generateClinicalNoteBtn) {
        generateClinicalNoteBtn.addEventListener('click', async function() {
            console.log('Note button clicked');
            const spinner = document.getElementById('spinner');
            const generateText = document.getElementById('generateText');
            
            // Show spinner and hide text
            if (spinner && generateText) {
                spinner.style.display = 'inline-block';
                generateText.style.display = 'none';
                this.disabled = true;
            }
            
            try {
                const user = auth.currentUser;
                if (!user) {
                    throw new Error('Please sign in first');
                }
                
                // Get the summary content
                const summaryText = getSummaryContent();
                if (!summaryText) {
                    throw new Error('No transcript to process. Please enter some text first.');
                }
                
                // Get token for authentication
                const token = await user.getIdToken();
                
                // Fetch prompts
                const prompts = await fetch('https://raw.githubusercontent.com/iannouvel/clerky/main/prompts.json')
                    .then(response => {
                        if (!response.ok) {
                            throw new Error(`Failed to fetch prompts: ${response.status} ${response.statusText}`);
                        }
                        return response.json();
                    });
                
                // Use clinical note prompt from config
                if (!prompts.clinicalNote || !prompts.clinicalNote.prompt) {
                    throw new Error('Clinical note prompt not found in configuration');
                }
                
                // Prepare the prompt with the transcript
                const notePrompt = `${prompts.clinicalNote.prompt.replace('{{text}}', summaryText)}`;
                
                // Call the API to generate the note
                const response = await fetch(`${SERVER_URL}/generateFakeClinicalInteraction`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                    },
                    body: JSON.stringify({ 
                        prompt: notePrompt,
                        model: typeof getUserAIPreference === 'function' ? getUserAIPreference() : 'DeepSeek'
                    })
                });
                
                if (!response.ok) {
                    throw new Error(`API request failed with status: ${response.status}`);
                }
                
                const data = await response.json();
                
                // Check for valid response
                if (data.success && data.response) {
                    // Get the actual content
                    const noteContent = data.response.content || data.response;
                    
                    // Set the generated note in the clinical note editor or as copy in history
                    if (historyEditor) {
                        setEditorContent(historyEditor, noteContent);
                    } else {
                        // Fallback
                        const historyElement = document.getElementById('history');
                        if (historyElement) {
                            historyElement.innerHTML = noteContent;
                        }
                    }
                    
                    console.log('Clinical note generated and set successfully');
                } else {
                    throw new Error('Invalid response format from server');
                }
            } catch (error) {
                console.error('Error generating clinical note:', error);
                alert('Error: ' + error.message);
            } finally {
                // Reset button state
                if (spinner && generateText) {
                    spinner.style.display = 'none';
                    generateText.style.display = 'inline-block';
                    this.disabled = false;
                }
            }
        });
        console.log('Note button listener set up');
    } else {
        console.warn('Note button not found');
    }
    
    // Load guideline summaries
    console.log('Loading guideline summaries...');
    loadGuidelineSummaries();
    
    // Continue with the rest of initialization
    initializeEditors();
    initializeTranscriptTabs();
    
    console.log('=== DOMContentLoaded END ===');
});

// Add this after the other button declarations in the DOMContentLoaded event listener
const proformaBtn = document.getElementById('proformaBtn');
const threeColumnView = document.getElementById('threeColumnView');
const proformaView = document.getElementById('proformaView');

// Add this to the event listener section
if (proformaBtn) {
    proformaBtn.addEventListener('click', function() {
        // Toggle button active state
        proformaBtn.classList.toggle('active');
        
        // Toggle between views
        const isProformaView = proformaBtn.classList.contains('active');
        
        // Show/hide appropriate views
        threeColumnView.style.display = isProformaView ? 'none' : 'grid';
        proformaView.style.display = isProformaView ? 'flex' : 'none';
        
        // Copy content from main summary to proforma summary if switching to proforma view
        if (isProformaView) {
            const proformaSummary = document.getElementById('proformaSummary');
            const mainSummary = document.getElementById('summary');
            proformaSummary.value = mainSummary.value;
        }
    });
}

// Add this to sync the content between textareas
const mainSummary = document.getElementById('summary');
const proformaSummary = document.getElementById('proformaSummary');

if (mainSummary && proformaSummary) {
    mainSummary.addEventListener('input', function() {
        proformaSummary.value = this.value;
    });

    proformaSummary.addEventListener('input', function() {
        mainSummary.value = this.value;
    });
}

// Add this after the other DOM element declarations in the DOMContentLoaded event listener
const clerkyTitle = document.querySelector('.center-title');

// Update the clerky title click handler
if (clerkyTitle) {
    clerkyTitle.addEventListener('click', function() {
        // Hide all sections first
        mainSection.classList.remove('hidden');
        promptsSection.classList.add('hidden');
        linksSection.classList.add('hidden');
        guidelinesSection.classList.add('hidden');
        
        // Switch back to three-column view
        threeColumnView.style.display = 'flex';
        proformaView.style.display = 'none';
        
        // Update proforma button state
        proformaBtn.classList.remove('active');
        
        // Update tab states if they exist
        tabs.forEach(tab => {
            if (tab.dataset.tab === 'main') {
                tab.classList.add('active');
            } else {
                tab.classList.remove('active');
            }
        });
    });
}

// Add this after your other DOM content loaded event listeners
const obsProformaBtn = document.getElementById('obsProformaBtn');
const gynProformaBtn = document.getElementById('gynProformaBtn');
const obsProforma = document.getElementById('obsProforma');
const gynProforma = document.getElementById('gynProforma');

obsProformaBtn.addEventListener('click', () => {
    obsProformaBtn.classList.add('active');
    gynProformaBtn.classList.remove('active');
    obsProforma.classList.remove('hidden');
    gynProforma.classList.add('hidden');
});

gynProformaBtn.addEventListener('click', () => {
    gynProformaBtn.classList.add('active');
    obsProformaBtn.classList.remove('active');
    gynProforma.classList.remove('hidden');
    obsProforma.classList.add('hidden');
});

// Add after your other DOM content loaded event listeners
const populateProformaBtn = document.getElementById('populateProformaBtn');

populateProformaBtn.addEventListener('click', async () => {
    const transcript = document.getElementById('proformaSummary').value;

    if (!transcript.trim()) {
        alert('Please enter a transcript first');
        return;
    }

    // Show spinner and hide text
    const populateSpinner = document.getElementById('populateSpinner');
    const populateText = document.getElementById('populateText');
    populateSpinner.style.display = 'inline-block';
    populateText.style.display = 'none';
    populateProformaBtn.disabled = true;

    try {
        const isObstetric = !obsProforma.classList.contains('hidden');
        const proformaType = isObstetric ? 'obstetric' : 'gynaecological';
        
        const prompt = `Please extract relevant information from the following clinical transcript to populate a ${proformaType} proforma. 
        Return ONLY a JSON object (no markdown, no code blocks) with the following structure:
        ${getProformaStructure(proformaType)}
        
        Only include fields where information is available in the transcript. Use null for missing values.
        
        Transcript:
        ${transcript}`;

        const response = await fetch(`${SERVER_URL}/generateFakeClinicalInteraction`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt })
        });

        if (!response.ok) {
            throw new Error('Failed to get AI response');
        }

        const data = await response.json();

        if (data.success) {
            // Extract the content from the response object if needed
            let jsonStr = data.response && typeof data.response === 'object' 
                ? data.response.content 
                : data.response;
                
            if (!jsonStr) {
                console.error('Invalid response format:', data.response);
                throw new Error('Invalid response format from server');
            }
            
            jsonStr = jsonStr.replace(/```json\n?/g, '');
            jsonStr = jsonStr.replace(/```\n?/g, '');
            jsonStr = jsonStr.trim();
            
            const proformaData = JSON.parse(jsonStr);
            
            populateProformaFields(proformaData, proformaType);
        } else {
            throw new Error(data.message || 'Failed to process response');
        }
    } catch (error) {
        alert('Failed to populate proforma. Please try again.');
    } finally {
        // Reset button state
        populateSpinner.style.display = 'none';
        populateText.style.display = 'inline-block';
        populateProformaBtn.disabled = false;
    }
});

// Helper function to get the proforma structure for the prompt
function getProformaStructure(type) {
    if (type === 'obstetric') {
        return `{
            "demographics": {
                "name": string,
                "age": number,
                "hospitalNo": string,
                "date": string (YYYY-MM-DD format),
                "time": string (HH:mm format)
            },
            "obstetricHistory": {
                "gravida": number,
                "para": number,
                "edd": string (YYYY-MM-DD format),
                "gestation": string,
                "previousDeliveries": string
            },
            "currentPregnancy": {
                "antenatalCare": "regular" | "irregular",
                "bloodGroup": string,
                "rhesus": string,
                "bookingBMI": number,
                "complications": string
            },
            "currentAssessment": {
                "presentingComplaint": string,
                "contractions": boolean,
                "fetalMovements": "normal" | "reduced",
                "vaginalLoss": "none" | "show" | "liquor" | "blood"
            },
            "examination": {
                "bp": string,
                "pulse": number,
                "temp": number,
                "fundalHeight": number,
                "lie": string,
                "presentation": string,
                "fh": number
            }
        }`;
    } else {
        return `{
            "demographics": {
                "name": string,
                "age": number,
                "hospitalNo": string,
                "date": string (YYYY-MM-DD format),
                "time": string (HH:mm format)
            },
            "presentingComplaint": string,
            "gynaecologicalHistory": {
                "lmp": string,
                "menstrualCycle": "regular" | "irregular",
                "contraception": string,
                "previousSurgery": string
            },
            "obstetricHistory": {
                "gravida": number,
                "para": number,
                "details": string
            },
            "examination": {
                "bp": string,
                "pulse": number,
                "temp": number,
                "abdominalExam": string,
                "vaginalExam": string
            }
        }`;
    }
}

// Function to update the AI model
async function updateAIModel() {
    const modelToggle = document.getElementById('modelToggle');
    
    // Store original button state
    const originalText = modelToggle.textContent;
    
    // Define retry settings
    const MAX_RETRIES = 3;
    const RETRY_DELAYS = [2000, 4000, 8000]; // 2, 4, 8 seconds

    // Helper function to delay execution
    const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
    
    // Show loading state
    modelToggle.disabled = true;
    modelToggle.textContent = 'Updating...';
    
    let lastError = null;
    
    try {
        const user = auth.currentUser;
        if (!user) {
            // Redirect to login page if not authenticated
            window.location.href = 'login.html';
            return;
        }
        
        // Toggle model preference
        currentModel = currentModel === 'OpenAI' ? 'DeepSeek' : 'OpenAI';
        
        // Get the current Firebase token
        const firebaseToken = await user.getIdToken();
        if (!firebaseToken) {
            throw new Error('Failed to get authentication token');
        }
        
        // Try the request with retries
        for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
            try {
                if (attempt > 0) {
                    console.log(`Retry attempt ${attempt}/${MAX_RETRIES} for updating AI model after ${RETRY_DELAYS[attempt-1]/1000} seconds...`);
                }
                
                console.log(`Sending request to update AI preference (attempt ${attempt+1}/${MAX_RETRIES+1})...`);
                // Send request to update AI preference
                const response = await fetch(`${SERVER_URL}/updateAIPreference`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${firebaseToken}`
                    },
                    body: JSON.stringify({ provider: currentModel })
                });
                
                // If we get a successful response, process it
                if (response.ok || response.status === 202) {
                    const responseData = await response.json();
                    console.log('Server response:', responseData);
                    
                    // Accept both 200 OK and 202 Accepted responses
                    currentModel = responseData.provider;
                    const modelName = currentModel === 'OpenAI' ? 'gpt-3.5-turbo' : 'deepseek-chat';
                    modelToggle.textContent = `AI: ${currentModel} (${modelName})`;
                    modelToggle.classList.toggle('active', currentModel === 'DeepSeek');
                    
                    // Show warning if preference might not persist
                    if (responseData.warning) {
                        console.warn('Warning from server:', responseData.warning);
                        // Optional: Display warning to user
                    }
                    
                    console.log('Successfully updated AI model to:', currentModel);
                    return; // Success, exit the function
                } else {
                    // If we get a non-OK response, throw to retry
                    const errorText = await response.text().catch(e => 'Could not read error response');
                    throw new Error(`Server returned ${response.status} ${response.statusText} - ${errorText}`);
                }
            } catch (error) {
                lastError = error;
                console.error(`Error updating AI model (attempt ${attempt+1}/${MAX_RETRIES+1}):`, error.message);
                
                // If this isn't the last attempt, wait before retrying
                if (attempt < MAX_RETRIES) {
                    const retryDelay = RETRY_DELAYS[attempt];
                    console.log(`Will retry updating AI model in ${retryDelay/1000} seconds...`);
                    await delay(retryDelay);
                }
            }
        }
        
        // If we've exhausted all retries, throw the last error
        console.error(`Failed to update AI model after ${MAX_RETRIES+1} attempts`);
        throw lastError || new Error('Failed to update AI model after multiple attempts');
    } catch (error) {
        console.error('Error updating AI model:', error);
        // Restore original button state
        modelToggle.textContent = originalText;
        modelToggle.disabled = false;
        alert('Failed to update AI model. Please try again later.');
    } finally {
        // Make sure button is re-enabled regardless of outcome
        modelToggle.disabled = false;
    }
}

// Add this function to initialize the model toggle
async function initializeModelToggle() {
    const modelToggle = document.getElementById('modelToggle');
    if (!modelToggle) return;

    // Define retry settings
    const MAX_RETRIES = 3;
    const RETRY_DELAYS = [2000, 4000, 8000]; // 2, 4, 8 seconds

    // Helper function to delay execution
    const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

    let lastError = null;

    try {
        const user = auth.currentUser;
        if (!user) {
            modelToggle.disabled = true;
            return;
        }

        // Get the current Firebase token
        const firebaseToken = await user.getIdToken();
        if (!firebaseToken) {
            throw new Error('Failed to get authentication token');
        }

        // Try the request with retries
        for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
            try {
                if (attempt > 0) {
                    console.log(`Retry attempt ${attempt}/${MAX_RETRIES} for model toggle after ${RETRY_DELAYS[attempt-1]/1000} seconds...`);
                }

                // Get user's AI preference from the server
                console.log(`Fetching AI preference (attempt ${attempt+1}/${MAX_RETRIES+1})...`);
                const response = await fetch(`${SERVER_URL}/updateAIPreference`, {
                    method: 'GET',
                    headers: {
                        'Authorization': `Bearer ${firebaseToken}`
                    }
                });

                if (response.ok) {
                    const data = await response.json();
                    currentModel = data.provider;
                    const modelName = currentModel === 'OpenAI' ? 'gpt-3.5-turbo' : 'deepseek-chat';
                    modelToggle.textContent = `AI: ${currentModel} (${modelName})`;
                    modelToggle.classList.toggle('active', currentModel === 'DeepSeek');
                    console.log('Successfully initialized model toggle with preference:', currentModel);
                    return; // Success, exit the function
                } else {
                    // If we get a non-OK response, throw to retry
                    const errorText = await response.text().catch(e => 'Could not read error response');
                    throw new Error(`Server returned ${response.status} ${response.statusText} - ${errorText}`);
                }
            } catch (error) {
                lastError = error;
                console.error(`Error initializing model toggle (attempt ${attempt+1}/${MAX_RETRIES+1}):`, error.message);
                
                // If this isn't the last attempt, wait before retrying
                if (attempt < MAX_RETRIES) {
                    const retryDelay = RETRY_DELAYS[attempt];
                    console.log(`Will retry model toggle in ${retryDelay/1000} seconds...`);
                    await delay(retryDelay);
                }
            }
        }
        
        // If we've exhausted all retries, fall back to a default
        console.error(`Failed to get AI preference after ${MAX_RETRIES+1} attempts, using default`);
        modelToggle.textContent = `AI: DeepSeek (deepseek-chat)`;
        modelToggle.classList.add('active');
        throw lastError || new Error('Failed to initialize model toggle after multiple attempts');
    } catch (error) {
        console.error('Error initializing model toggle:', error);
        // Don't disable the toggle, just show default
        modelToggle.textContent = `AI: DeepSeek (deepseek-chat)`;
    }
}

// Update the displayIssues function to use the global arrays
async function displayIssues(response, prompts) {
    console.log('=== displayIssues ===');
    console.log('Input response:', response);
    
    // Parse the AI response into an array of issues
    let issues = [];
    
    // If response is already an array, use it directly
    if (Array.isArray(response)) {
        issues = response;
    } 
    // If it's a string, parse the text into an array of issues
    else if (typeof response === 'string') {
        // Split by new lines and clean up each issue
        issues = response.split('\n')
            .map(line => line.trim())
            .filter(line => line.length > 0)
            // Remove numbering if present (like "1. ", "2. ", etc.)
            .map(line => line.replace(/^\d+[\.\)\-]\s*/, '').trim())
            // Remove bullet points if present
            .map(line => line.replace(/^[\-\*•]\s*/, '').trim())
            .filter(line => line.length > 0);
    }
    
    console.log('Parsed issues:', {
        issuesCount: issues?.length,
        hasPrompts: !!prompts,
        guidanceDataLoaded,
        filenamesCount: filenames.length,
        summariesCount: summaries.length
    });
    
    // Store the parsed issues in our global array
    AIGeneratedListOfIssues = issues;
    guidelinesForEachIssue = new Array(issues.length).fill([]);

    const suggestedGuidelinesDiv = document.getElementById('suggestedGuidelines');
    if (!suggestedGuidelinesDiv) {
        console.error('suggestedGuidelinesDiv not found in DOM');
        return;
    }
    suggestedGuidelinesDiv.innerHTML = '';

    if (!issues || issues.length === 0) {
        console.log('No issues provided, displaying "No clinical issues" message');
        const noIssuesDiv = document.createElement('div');
        noIssuesDiv.textContent = 'No clinical issues identified.';
        suggestedGuidelinesDiv.appendChild(noIssuesDiv);
        return;
    }

    // Process each issue
    for (let i = 0; i < issues.length; i++) {
        const issue = issues[i];
        console.log(`Processing issue ${i + 1}:`, issue);
        
        // Create issue container
        const issueDiv = document.createElement('div');
        issueDiv.className = 'accordion-item';
        issueDiv.style.textAlign = 'left';
        
        // Remove prefix hyphen if present
        const cleanIssue = issue.startsWith('-') ? issue.substring(1).trim() : issue;
        
        // Create issue header
        const issueTitle = document.createElement('h4');
        issueTitle.className = 'accordion-header';
        
        // Create header content wrapper for flex layout
        const headerContent = document.createElement('div');
        headerContent.style.display = 'flex';
        headerContent.style.justifyContent = 'space-between';
        headerContent.style.alignItems = 'center';
        headerContent.style.width = '100%';
        headerContent.style.padding = '0';
        headerContent.style.margin = '0';
        headerContent.style.minHeight = '0';
        headerContent.style.height = 'auto';
        
        // Add issue text (editable)
        const issueText = document.createElement('span');
        issueText.contentEditable = true;
        issueText.textContent = cleanIssue;
        issueText.style.padding = '0';
        issueText.style.margin = '0';
        issueText.style.lineHeight = '1';
        issueText.style.display = 'inline-block';
        issueText.style.verticalAlign = 'middle';
        
        // Create delete button (trash can icon)
        const deleteBtn = document.createElement('button');
        deleteBtn.innerHTML = '🗑️';
        deleteBtn.className = 'delete-btn';
        deleteBtn.style.background = 'none';
        deleteBtn.style.border = 'none';
        deleteBtn.style.cursor = 'pointer';
        deleteBtn.style.fontSize = '1rem';
        deleteBtn.style.padding = '0';
        deleteBtn.style.margin = '0';
        deleteBtn.style.lineHeight = '1';
        deleteBtn.style.marginLeft = '8px';
        deleteBtn.style.display = 'flex';
        deleteBtn.style.alignItems = 'center';
        deleteBtn.style.justifyContent = 'center';
        deleteBtn.onclick = (e) => {
            e.stopPropagation(); // Prevent accordion toggle
            if (confirm('Are you sure you want to delete this issue?')) {
                issueDiv.remove();
            }
        };
        
        // Assemble header
        headerContent.appendChild(issueText);
        headerContent.appendChild(deleteBtn);
        issueTitle.appendChild(headerContent);
        
        // Add click handler for accordion functionality
        issueTitle.addEventListener('click', function() {
            // Toggle active class on the header
            this.classList.toggle('active');
            // Toggle the content visibility
            const content = this.nextElementSibling;
            if (content.style.maxHeight && content.style.maxHeight !== '0px') {
                content.style.maxHeight = '0px';
                content.style.padding = '0px';
            } else {
                content.style.padding = '12px';
                content.style.maxHeight = content.scrollHeight + 12 + 'px';
            }
        });
        
        issueDiv.appendChild(issueTitle);

        // Create content container
        const contentDiv = document.createElement('div');
        contentDiv.className = 'accordion-content';
        contentDiv.style.maxHeight = '0px';
        contentDiv.style.padding = '0px';
        contentDiv.style.overflow = 'hidden';
        contentDiv.style.transition = 'all 0.3s ease-out';

        try {
            // Get relevant guidelines for this issue
            const guidelinesData = await findRelevantGuidelines(cleanIssue, prompts, i);
            
            if (guidelinesData.success && guidelinesData.guidelines) {
                // Create list for guidelines
                const guidelinesList = document.createElement('ul');
                guidelinesList.className = 'guidelines-list';

                // Add each guideline
                guidelinesData.guidelines.forEach((guideline, index) => {
                    console.log(`Processing guideline ${index + 1}:`, guideline);
                    
                    const listItem = document.createElement('li');
                    
                    // Create guideline link
                    const guidelineLink = document.createElement('a');
                    const pdfGuideline = guideline.replace(/\.txt$/i, '.pdf');
                    guidelineLink.href = `https://github.com/iannouvel/clerky/raw/main/guidance/${encodeURIComponent(pdfGuideline)}`;
                    // Remove .txt suffix from display text
                    guidelineLink.textContent = guideline.replace(/\.txt$/i, '');
                    guidelineLink.target = '_blank';
                    
                    // Create algo link
                    const algoLink = document.createElement('a');
                    const htmlFilename = guideline.replace(/\.txt$/i, '.html');
                    algoLink.href = `https://iannouvel.github.io/clerky/algos/${encodeURIComponent(htmlFilename)}`;
                    algoLink.textContent = 'Algo';
                    algoLink.target = '_blank';
                    algoLink.style.marginLeft = '10px';
                    
                    // Add apply button
                    const applyButton = document.createElement('button');
                    applyButton.textContent = 'Apply';
                    applyButton.className = 'apply-btn';
                    applyButton.style.marginLeft = '10px';
                    applyButton.onclick = async () => {
                        try {
                            const response = await applyGuideline(guideline, cleanIssue);
                            showPopup(response);
                        } catch (error) {
                            console.error('Error applying guideline:', error);
                            alert('Failed to apply guideline. Please try again.');
                        }
                    };
                    
                    // Assemble list item
                    listItem.appendChild(guidelineLink);
                    listItem.appendChild(algoLink);
                    listItem.appendChild(applyButton);
                    guidelinesList.appendChild(listItem);
                });

                contentDiv.appendChild(guidelinesList);
            }
        } catch (error) {
            console.error('Error processing guidelines for issue:', error);
            const errorDiv = document.createElement('div');
            errorDiv.className = 'error-message';
            errorDiv.textContent = 'Error loading guidelines for this issue.';
            contentDiv.appendChild(errorDiv);
        }

        issueDiv.appendChild(contentDiv);
        suggestedGuidelinesDiv.appendChild(issueDiv);
    }

    // Add click handler for the "+" button
    const addIssueBtn = document.getElementById('addIssueBtn');
    if (addIssueBtn) {
        addIssueBtn.onclick = () => {
            // Create a new issue with default text
            const newIssue = 'New Issue';
            const issues = [...AIGeneratedListOfIssues, newIssue];
            AIGeneratedListOfIssues = issues;
            displayIssues(issues, prompts);
            
            // Find the newly added issue and trigger a click to expand it
            const lastIssue = suggestedGuidelinesDiv.lastElementChild;
            if (lastIssue) {
                const header = lastIssue.querySelector('.accordion-header');
                if (header) {
                    const textElement = header.querySelector('[contenteditable]');
                    if (textElement) {
                        // Focus and select the text for immediate editing
                        textElement.focus();
                        const range = document.createRange();
                        range.selectNodeContents(textElement);
                        const selection = window.getSelection();
                        selection.removeAllRanges();
                        selection.addRange(range);
                    }
                    // Expand the accordion
                    header.click();
                }
            }
        };
    }

    // Log the final state of our global arrays
    console.log('Final state of global arrays:', {
        issues: AIGeneratedListOfIssues,
        guidelines: guidelinesForEachIssue
    });
}

// Make handleAction and displayIssues available globally
window.handleAction = handleAction;
window.displayIssues = displayIssues;

// Add the missing getPrompts function
async function getPrompts() {
    try {
        const response = await fetch(`${SERVER_URL}/getPrompts`);
        if (!response.ok) {
            throw new Error(`Server responded with ${response.status}: ${response.statusText}`);
        }
        const data = await response.json();
        return data.prompts || {};
    } catch (error) {
        console.error('Error fetching prompts:', error);
        return {}; // Return empty object as fallback
    }
}

// Make getPrompts available globally
window.getPrompts = getPrompts;

// Add event listener for dev button
document.getElementById('devBtn').addEventListener('click', function() {
    window.open('dev.html', '_blank');
});

// Function to create and show popup
function showPopup(content) {
    // Create popup container
    const popup = document.createElement('div');
    popup.className = 'popup';
    
    // Create close button
    const closeButton = document.createElement('button');
    closeButton.textContent = '×';
    closeButton.className = 'popup-close';
    
    // Create overlay
    const overlay = document.createElement('div');
    overlay.className = 'overlay';
    
    // Create content container
    const contentDiv = document.createElement('div');
    contentDiv.className = 'popup-content';
    contentDiv.innerHTML = content; // Use innerHTML to render HTML content
    
    // Function to remove popup and overlay
    const removePopup = () => {
        popup.remove();
        overlay.remove();
    };
    
    // Add click handlers
    closeButton.onclick = removePopup;
    overlay.onclick = removePopup;
    
    // Assemble popup
    popup.appendChild(closeButton);
    popup.appendChild(contentDiv);
    document.body.appendChild(overlay);
    document.body.appendChild(popup);
    
    // Return an object with the elements and remove function
    return {
        popup,
        overlay,
        remove: removePopup
    };
}

// Function to apply guideline to clinical situation
async function applyGuideline(guideline, clinicalSituation) {
    try {
        const user = auth.currentUser;
        if (!user) {
            throw new Error('Please sign in first');
        }
        const token = await user.getIdToken();

        const prompts = await getPrompts();
        
        if (!prompts || !prompts.applyGuideline) {
            throw new Error('Application configuration error: Missing applyGuideline prompt');
        }

        if (!prompts.applyGuideline.prompt) {
            throw new Error('Application configuration error: Invalid applyGuideline prompt structure');
        }

        const prompt = prompts.applyGuideline.prompt
            .replace('{{guideline}}', guideline)
            .replace('{{situation}}', clinicalSituation);

        const response = await fetch(`${SERVER_URL}/generateFakeClinicalInteraction`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ prompt })
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error('Failed to get AI response: ' + errorText);
        }

        const data = await response.json();
        
        if (data.success) {
            return data.response;
        } else {
            throw new Error(data.message || 'Failed to process response');
        }
    } catch (error) {
        throw error;
    }
}

// Function to find relevant guidelines for a clinical issue
async function findRelevantGuidelines(issue, prompts, issueIndex) {
    console.log('Finding relevant guidelines for issue:', issue);
    
    const guidelinesPrompt = prompts.guidelines.prompt
        .replace('{{text}}', issue)
        .replace('{{guidelines}}', filenames.map((filename, i) => `${filename}: ${summaries[i]}`).join('\n'));
    
    const guidelinesRequestData = {
        prompt: guidelinesPrompt,
        filenames: filenames,
        summaries: summaries
    };
    
    console.log('Guidelines request data prepared:', {
        promptLength: guidelinesPrompt.length,
        filenamesCount: guidelinesRequestData.filenames.length,
        summariesCount: guidelinesRequestData.summaries.length
    });

    // Define retry settings
    const MAX_RETRIES = 3;
    const RETRY_DELAYS = [2000, 4000, 8000]; // 2, 4, 8 seconds

    // Helper function to delay execution
    const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

    let lastError = null;
    
    // Try the request with retries
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
            const user = auth.currentUser;
            if (!user) {
                throw new Error('Please sign in first');
            }
            const token = await user.getIdToken();
            
            if (attempt > 0) {
                console.log(`Retry attempt ${attempt}/${MAX_RETRIES} after ${RETRY_DELAYS[attempt-1]/1000} seconds...`);
            }
            
            console.log('Making request to handleGuidelines endpoint...');
            const guidelinesResponse = await fetch(`${SERVER_URL}/handleGuidelines`, {
                method: 'POST',
                credentials: 'include',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                    'Accept': 'application/json'
                },
                body: JSON.stringify(guidelinesRequestData)
            });

            console.log('Guidelines response received:', {
                ok: guidelinesResponse.ok,
                status: guidelinesResponse.status,
                statusText: guidelinesResponse.statusText
            });

            // If we get a successful response, parse and return it
            if (guidelinesResponse.ok) {
                const guidelinesData = await guidelinesResponse.json();
                console.log('Guidelines data parsed:', {
                    success: guidelinesData.success,
                    guidelinesCount: guidelinesData.guidelines?.length
                });

                // Store the guidelines in our global array at the correct index
                if (guidelinesData.success && Array.isArray(guidelinesData.guidelines)) {
                    guidelinesForEachIssue[issueIndex] = guidelinesData.guidelines;
                }
                
                return guidelinesData;
            } else {
                // If we get a 502 or other server error, throw so we can retry
                throw new Error(`Server returned ${guidelinesResponse.status} ${guidelinesResponse.statusText}`);
            }
        } catch (error) {
            lastError = error;
            console.error(`Error finding relevant guidelines (attempt ${attempt+1}/${MAX_RETRIES+1}):`, error.message);
            
            // If this isn't the last attempt, wait before retrying
            if (attempt < MAX_RETRIES) {
                const retryDelay = RETRY_DELAYS[attempt];
                console.log(`Will retry in ${retryDelay/1000} seconds...`);
                await delay(retryDelay);
            }
        }
    }
    
    // If we've exhausted all retries, throw the last error
    console.error(`Failed to get guidelines after ${MAX_RETRIES+1} attempts`);
    throw lastError;
}

// For setting clinical note content
function setClinicalNoteContent(content) {
    // Redirect to summary editor instead
    if (summaryEditor) {
        setEditorContent(summaryEditor, content);
    } else {
        const summaryElement = document.getElementById('summary');
        if (summaryElement) {
            summaryElement.innerHTML = content;
        }
    }
    
    // Also update the hidden clinicalNoteOutput for compatibility
    if (clinicalNoteEditor) {
        setEditorContent(clinicalNoteEditor, content);
    }
}

// For getting clinical note content
function getClinicalNoteContent() {
    // Get content from summary editor instead
    if (summaryEditor) {
        return getEditorContent(summaryEditor);
    } else {
        const summaryElement = document.getElementById('summary');
        return summaryElement ? summaryElement.innerHTML : '';
    }
}

// For setting summary content
function setSummaryContent(content) {
    console.log('=== setSummaryContent START ===');
    console.log('Content to set:', content);
    
    try {
        // Get the active transcript pane
        let activePane = document.querySelector('.transcript-pane.active');
        console.log('Active transcript pane found:', activePane);
        
        if (!activePane) {
            console.error('No active transcript pane found');
            // Try to find any transcript pane
            const anyPane = document.querySelector('.transcript-pane');
            if (anyPane) {
                console.log('Found inactive transcript pane, activating it');
                anyPane.classList.add('active');
                const tabId = anyPane.id.replace('summary', '');
                const tab = document.querySelector(`.transcript-tab[data-tab="${tabId}"]`);
                if (tab) {
                    tab.classList.add('active');
                }
                activePane = anyPane;
            } else {
                console.error('No transcript panes found at all');
                return;
            }
        }

        // Try to get the TipTap editor instance
        const editor = activePane._tiptapEditor;
        console.log('TipTap editor instance:', editor);
        
        if (editor) {
            console.log('Using TipTap editor to set content');
            editor.commands.setContent(content);
            console.log('Content set in TipTap editor');
        } else {
            console.log('No TipTap editor found, using fallback textarea');
            let textarea = activePane.querySelector('.fallback-editor');
            if (!textarea) {
                console.log('No fallback textarea found, creating one');
                textarea = document.createElement('textarea');
                textarea.className = 'fallback-editor';
                textarea.style.width = '100%';
                textarea.style.height = '100%';
                textarea.style.minHeight = '200px';
                textarea.style.boxSizing = 'border-box';
                textarea.style.padding = '10px';
                textarea.style.border = '1px solid #ccc';
                textarea.style.borderRadius = '4px';
                textarea.style.resize = 'vertical';
                activePane.innerHTML = '';
                activePane.appendChild(textarea);
            }
            console.log('Setting content in fallback textarea');
            textarea.value = content;
            console.log('Content set in fallback textarea');
        }
    } catch (error) {
        console.error('Error in setSummaryContent:', error);
        console.error('Error stack:', error.stack);
    }
    
    console.log('=== setSummaryContent END ===');
}

// For getting summary content
function getSummaryContent() {
    // Find the active transcript pane
    const activePane = document.querySelector('.transcript-pane.active');
    if (!activePane) {
        console.error('No active transcript pane found');
        return '';
    }

    // Try to get the TipTap editor instance if it exists
    const editor = activePane._tiptapEditor;
    
    if (editor && typeof editor.getHTML === 'function') {
        // If we have a valid TipTap editor, use it
        return editor.getHTML();
    } else {
        // Fallback to direct HTML getting
        const fallbackTextarea = activePane.querySelector('.fallback-editor');
        if (fallbackTextarea) {
            return fallbackTextarea.value;
        }
        return activePane.innerHTML;
    }
}

// Function to add track changes toolbar
function addTrackChangesToolbar(changesResult) {
    console.log("Adding track changes toolbar with result:", changesResult);
    
    // Remove any existing toolbar first
    const existingToolbar = document.querySelector('.track-changes-toolbar');
    if (existingToolbar) {
        console.log("Removing existing toolbar");
        existingToolbar.remove();
    }
    
    // Create the toolbar
    const toolbar = document.createElement('div');
    toolbar.className = 'track-changes-toolbar';
    
    // Add header
    const header = document.createElement('div');
    header.className = 'track-changes-header';
    header.innerHTML = '<h3>Review Suggested Changes</h3>';
    toolbar.appendChild(header);
    
    // Create global action buttons
    const globalActions = document.createElement('div');
    globalActions.className = 'track-changes-global-actions';
    
    // Add accept all button
    const acceptAllBtn = document.createElement('button');
    acceptAllBtn.className = 'accept-btn';
    acceptAllBtn.textContent = 'Accept All Changes';
    acceptAllBtn.addEventListener('click', () => {
        console.log("Accept all changes clicked");
        acceptAllTrackChanges(summaryEditor);
        toolbar.remove(); // Remove toolbar after accepting
    });
    
    // Add reject all button
    const rejectAllBtn = document.createElement('button');
    rejectAllBtn.className = 'reject-btn';
    rejectAllBtn.textContent = 'Reject All Changes';
    rejectAllBtn.addEventListener('click', () => {
        console.log("Reject all changes clicked");
        rejectAllTrackChanges(summaryEditor, originalClinicalNoteContent);
        toolbar.remove(); // Remove toolbar after rejecting
    });
    
    // Add buttons to global actions
    globalActions.appendChild(acceptAllBtn);
    globalActions.appendChild(rejectAllBtn);
    toolbar.appendChild(globalActions);
    
    // Create individual changes section
    const changes = getTrackChanges(summaryEditor);
    console.log("Retrieved changes for toolbar:", changes);
    
    if (changes.length > 0) {
        console.log(`Creating changes section for ${changes.length} changes`);
        const changesSection = document.createElement('div');
        changesSection.className = 'track-changes-list';
        
        const changesTitle = document.createElement('h4');
        changesTitle.textContent = 'Individual Changes';
        changesSection.appendChild(changesTitle);
        
        // Create a list of changes
        const changesList = document.createElement('ul');
        changesList.className = 'changes-list';
        
        changes.forEach((change, index) => {
            console.log(`Processing change #${index + 1}: ${change.id}, type: ${change.type}, text: "${change.text}"`);
            const changeItem = document.createElement('li');
            changeItem.className = `change-item change-type-${change.type}`;
            changeItem.setAttribute('data-change-id', change.id);
            
            // Preview of the change
            const changePreview = document.createElement('div');
            changePreview.className = 'change-preview';
            changePreview.textContent = change.text || '[formatting change]';
            changeItem.appendChild(changePreview);
            
            // Change actions
            const changeActions = document.createElement('div');
            changeActions.className = 'change-actions';
            
            // Accept button
            const acceptBtn = document.createElement('button');
            acceptBtn.className = 'accept-btn small';
            acceptBtn.textContent = 'Accept';
            acceptBtn.addEventListener('click', () => {
                console.log(`Accept button clicked for change: ${change.id}`);
                acceptChange(summaryEditor, change.id);
                changeItem.classList.add('accepted');
                checkAllChangesProcessed();
            });
            changeActions.appendChild(acceptBtn);
            
            // Reject button
            const rejectBtn = document.createElement('button');
            rejectBtn.className = 'reject-btn small';
            rejectBtn.textContent = 'Reject';
            rejectBtn.addEventListener('click', () => {
                console.log(`Reject button clicked for change: ${change.id}`);
                rejectChange(summaryEditor, change.id);
                changeItem.classList.add('rejected');
                checkAllChangesProcessed();
            });
            changeActions.appendChild(rejectBtn);
            
            changeItem.appendChild(changeActions);
            changesList.appendChild(changeItem);
        });
        
        changesSection.appendChild(changesList);
        toolbar.appendChild(changesSection);
    } else {
        // If we couldn't identify individual changes
        console.warn("No individual changes could be identified for the track changes toolbar");
        const noChangesMsg = document.createElement('p');
        noChangesMsg.className = 'no-individual-changes';
        noChangesMsg.textContent = 'Individual changes could not be identified. Please use Accept All or Reject All.';
        toolbar.appendChild(noChangesMsg);
    }
    
    // Function to check if all changes have been processed
    function checkAllChangesProcessed() {
        const remainingChanges = changesList.querySelectorAll('li:not(.accepted):not(.rejected)');
        console.log(`Remaining changes to process: ${remainingChanges.length}`);
        if (remainingChanges.length === 0) {
            // All changes have been processed, remove the toolbar
            console.log("All changes have been processed, removing toolbar");
            setTimeout(() => {
                toolbar.remove();
            }, 1000);
        }
    }
    
    // Add toolbar to the editor container
    const editorContainer = document.getElementById('summary').parentNode;
    editorContainer.insertBefore(toolbar, document.getElementById('summary'));
    console.log("Track changes toolbar added to the DOM");
}

// Function to test track changes (accessible from console)
window.testTrackChanges = function() {
    try {
        const originalContent = getSummaryContent();
        if (!originalContent) {
            console.error('No content found in summary editor');
            return { success: false, error: 'No content to test with' };
        }
        
        originalClinicalNoteContent = originalContent;
        
        // Create a modified version of the content with some changes
        const modifiedContent = originalContent
            .replace(/patient/gi, '<b>patient</b>')
            .replace(/the/gi, 'THE')
            .replace(/and/gi, 'AND')
            .replace(/risk/gi, 'RISK FACTOR')
            .replace(/symptoms/gi, '<i>symptoms and signs</i>');
        
        console.log('Original content:', originalContent);
        console.log('Modified content:', modifiedContent);
        
        // Verify editor is available
        if (!summaryEditor) {
            console.error('Summary editor not initialized');
            return { success: false, error: 'Editor not initialized' };
        }
        
        // Add toolbar and apply track changes
        console.log('Applying track changes...');
        const changesResult = applyTrackChanges(summaryEditor, originalContent, modifiedContent);
        console.log('Track changes result:', changesResult);
        
        addTrackChangesToolbar(changesResult);
        
        console.log('Track changes applied. Use the toolbar to accept or reject changes.');
        return {
            success: true,
            changesCount: changesResult?.changes?.length || 0
        };
    } catch (error) {
        console.error('Error testing track changes:', error);
        return {
            success: false,
            error: error.message,
            stack: error.stack
        };
    }
};

// Function to show scenario selection popup
function showScenarioSelectionPopup() {
    console.log("Starting showScenarioSelectionPopup");
    console.log("filenames available:", filenames);
    
    if (!filenames || filenames.length === 0) {
        alert("No guidelines found. Please try again later.");
        return;
    }

    // Create popup content with guideline-based scenarios
    const popupContent = `
        <h3>Select a Clinical Scenario</h3>
        <div class="popup-grid">
            <form id="scenarioForm">
                ${filenames.map((guideline, index) => `
                    <label>
                        <input type="radio" 
                               name="scenario" 
                               value="${guideline}" 
                               ${index === 0 ? 'checked' : ''}>
                        <span>${guideline.replace(/\.txt$/i, '')}</span>
                    </label>
                `).join('')}
            </form>
        </div>
        <div class="button-group">
            <button id="scenario_cancel_btn" class="secondary">Cancel</button>
            <button id="scenario_generate_btn" class="primary">Generate Scenario</button>
        </div>
    `;

    // Show popup
    const popup = showPopup(popupContent);
    
    // Add event listeners using standard DOM methods
    document.getElementById('scenario_cancel_btn').addEventListener('click', function() {
        console.log("Closing scenario selection popup");
        popup.remove();
    });
    
    document.getElementById('scenario_generate_btn').addEventListener('click', async function(event) {
        console.log("Generate scenario button clicked");
        const button = event.currentTarget;
        const selectedScenario = document.querySelector('input[name="scenario"]:checked');
        
        if (!selectedScenario) {
            alert('Please select a scenario first.');
            return;
        }
        
        console.log("Selected scenario:", selectedScenario.value);

        // Disable the button and show loading state
        button.disabled = true;
        button.innerHTML = '<span class="spinner">&#x21BB;</span> Generating...';

        try {
            // Get the current user's ID token
            const user = auth.currentUser;
            if (!user) {
                throw new Error('Please sign in first');
            }
            const token = await user.getIdToken();
            console.log("Got user token");

            // Generate random patient data inline instead of using the function
            console.log("Generating random patient data inline");
            const age = Math.floor(Math.random() * (65 - 18 + 1)) + 18;
            const bmi = (Math.random() * (40 - 18.5) + 18.5).toFixed(1);
            const previousPregnancies = Math.floor(Math.random() * 6);
            console.log("Random patient data:", { age, bmi, previousPregnancies });

            // Fetch prompts
            console.log("Fetching prompts");
            const prompts = await fetch('https://raw.githubusercontent.com/iannouvel/clerky/main/prompts.json')
                .then(response => {
                    if (!response.ok) {
                        throw new Error(`Failed to fetch prompts: ${response.status} ${response.statusText}`);
                    }
                    return response.json();
                })
                .catch(error => {
                    console.error('Prompts fetch failed:', error);
                    throw new Error('Failed to load prompts configuration');
                });

            console.log("Prompts fetched:", prompts);
            if (!prompts.testTranscript || !prompts.testTranscript.prompt) {
                throw new Error('Test transcript prompt configuration is missing');
            }

            // Append the specific patient data and selected guideline to the prompt
            const enhancedPrompt = `${prompts.testTranscript.prompt}\n\nMake the age ${age}, the BMI ${bmi} and the number of prior pregnancies ${previousPregnancies}\n\nBase the clinical scenario on the following guideline: ${selectedScenario.value}`;
            console.log("Enhanced prompt created");

            // Make the request to generate the scenario
            console.log("Making API request to generateTranscript");
            const response = await fetch(`${SERVER_URL}/generateFakeClinicalInteraction`, {
                method: 'POST',
                credentials: 'include',
                headers: { 
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                    'Accept': 'application/json'
                },
                body: JSON.stringify({ prompt: enhancedPrompt })
            });

            if (!response.ok) {
                throw new Error(`Server error: ${response.status} ${response.statusText}`);
            }

            console.log("API response received");
            const data = await response.json();
            console.log("API data:", data);
            
            // Set the generated content in the editor
            if (summaryEditor) {
                console.log("Setting content in editor");
                try {
                    // Extract the actual text content from the response
                    let contentText = "";
                    
                    if (data.response && typeof data.response === 'object' && data.response.content) {
                        // If response is an object with content property
                        contentText = data.response.content;
                    } else if (data.response && typeof data.response === 'string') {
                        // If response is a string
                        contentText = data.response;
                    } else if (data.content && typeof data.content === 'string') {
                        // If content is a string
                        contentText = data.content;
                    } else {
                        // Fallback to stringifying the response
                        contentText = JSON.stringify(data.response || data.content || "No content returned");
                    }
                    
                    // Format the content to be compatible with TipTap
                    // Replace markdown with HTML
                    contentText = contentText
                        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')  // Bold
                        .replace(/\*(.*?)\*/g, '<em>$1</em>')              // Italic
                        .replace(/\n/g, '<br />');                         // Line breaks
                    
                    // Set the content as HTML
                    summaryEditor.commands.setContent(contentText);
                    console.log("Content set in editor successfully");
                } catch (error) {
                    console.error("Error setting editor content:", error);
                    // Fallback to a simple text setting method
                    summaryEditor.commands.setContent("Error displaying content. Raw response: " + JSON.stringify(data));
                }
            }

            // Remove the popup
            console.log("Removing popup");
            popup.remove();
            document.querySelector('.overlay').remove();
            console.log("Popup removed");
        } catch (error) {
            console.error('Error generating scenario:', error);
            console.error('Error stack:', error.stack);
            alert(error.message || 'Failed to generate scenario. Please try again.');
        } finally {
            // Reset button state
            button.disabled = false;
            button.textContent = 'Generate Scenario';
        }
    });
}

// Modify the test button click handler
// testBtn.addEventListener('click', generateFakeTranscript);

// Clear all previous test button handlers and implement a single clean solution
(() => {
    console.log("🧹 Cleaning up all test button handlers");
    
    // Wait for DOM to be fully loaded
    window.addEventListener('load', () => {
        console.log("🌐 Window loaded - Setting up test button definitively");
        
        const testBtn = document.getElementById('testBtn');
        if (!testBtn) {
            console.error("❌ Test button not found");
            return;
        }
        
        // Remove all existing event listeners by cloning
        const newTestBtn = testBtn.cloneNode(true);
        testBtn.parentNode.replaceChild(newTestBtn, testBtn);
        
        console.log("🔄 Adding clean click handler to test button");
        
        // Add new handler
        newTestBtn.addEventListener('click', function() {
            console.log("🔘 Test button clicked - Showing popup");
            
            // Check if guidelines are loaded
            if (typeof filenames === 'undefined' || !filenames.length || !guidanceDataLoaded) {
                console.warn("⚠️ Guidelines not loaded yet");
                alert('Please wait for guidelines to load before generating a test scenario.');
                return;
            }
            
            console.log("📋 Creating popup with " + filenames.length + " guidelines");
            
            try {
                // Create popup content
                const popupContent = `
                    <h3>Select a Clinical Scenario</h3>
                    <div class="popup-grid">
                        <form id="test_scenario_form">
                            ${filenames.map((guideline, index) => `
                                <label>
                                    <input type="radio" 
                                           name="test_scenario" 
                                           value="${guideline}" 
                                           ${index === 0 ? 'checked' : ''}>
                                    <span>${guideline.replace(/\.txt$/i, '')}</span>
                                </label>
                            `).join('')}
                        </form>
                    </div>
                    <div class="button-group">
                        <button id="test_cancel_btn" class="secondary">Cancel</button>
                        <button id="test_generate_btn" class="primary">Generate Scenario</button>
                    </div>
                `;
                
                console.log("🪟 Creating popup with showPopup");
                // Show the popup
                const popupObj = showPopup(popupContent);
                console.log("🪟 Popup created:", popupObj);
                
                // Add button event listeners directly
                const cancelBtn = document.getElementById('test_cancel_btn');
                if (cancelBtn) {
                    console.log("✅ Cancel button found, adding listener");
                    cancelBtn.onclick = function() {
                        console.log("❌ Cancel clicked");
                        popupObj.remove();
                    };
                } else {
                    console.error("❌ Cancel button not found in DOM");
                }
                
                const generateBtn = document.getElementById('test_generate_btn');
                if (generateBtn) {
                    console.log("✅ Generate button found, adding listener");
                    generateBtn.onclick = async function() {
                        console.log("✅ Generate clicked");
                        const button = this;
                        const selectedScenario = document.querySelector('input[name="test_scenario"]:checked');
                        
                        if (!selectedScenario) {
                            alert('Please select a scenario first.');
                            return;
                        }
                        
                        // Visual feedback
                        button.disabled = true;
                        button.innerHTML = '<span class="spinner">&#x21BB;</span> Generating...';
                        
                        try {
                            // Get auth token
                            const user = auth.currentUser;
                            if (!user) {
                                throw new Error('Please sign in first');
                            }
                            const token = await user.getIdToken();
                            
                            // Generate random patient data
                            const age = Math.floor(Math.random() * (65 - 18 + 1)) + 18;
                            const bmi = (Math.random() * (40 - 18.5) + 18.5).toFixed(1);
                            const previousPregnancies = Math.floor(Math.random() * 6);
                            
                            // Fetch prompts from GitHub
                            const prompts = await fetch('https://raw.githubusercontent.com/iannouvel/clerky/main/prompts.json')
                                .then(response => {
                                    if (!response.ok) {
                                        throw new Error(`Failed to fetch prompts: ${response.status} ${response.statusText}`);
                                    }
                                    return response.json();
                                });
                            
                            if (!prompts.testTranscript || !prompts.testTranscript.prompt) {
                                throw new Error('Test transcript prompt configuration is missing');
                            }
                            
                            // Create enhanced prompt with guideline
                            const enhancedPrompt = `${prompts.testTranscript.prompt}\n\nMake the age ${age}, the BMI ${bmi} and the number of prior pregnancies ${previousPregnancies}\n\nBase the clinical scenario on the following guideline: ${selectedScenario.value}`;
                            
                            // Make API request
                            const response = await fetch(`${SERVER_URL}/generateFakeClinicalInteraction`, {
                                method: 'POST',
                                credentials: 'include',
                                headers: { 
                                    'Content-Type': 'application/json',
                                    'Authorization': `Bearer ${token}`,
                                    'Accept': 'application/json'
                                },
                                body: JSON.stringify({ prompt: enhancedPrompt })
                            });
                            
                            if (!response.ok) {
                                throw new Error(`Server error: ${response.status} ${response.statusText}`);
                            }
                            
                            const data = await response.json();
                            
                            // Update editor content
                            if (summaryEditor) {
                                console.log("Setting content in editor");
                                try {
                                    // Extract the actual text content from the response
                                    let contentText = "";
                                    
                                    if (data.response && typeof data.response === 'object' && data.response.content) {
                                        // If response is an object with content property
                                        contentText = data.response.content;
                                    } else if (data.response && typeof data.response === 'string') {
                                        // If response is a string
                                        contentText = data.response;
                                    } else if (data.content && typeof data.content === 'string') {
                                        // If content is a string
                                        contentText = data.content;
                                    } else {
                                        // Fallback to stringifying the response
                                        contentText = JSON.stringify(data.response || data.content || "No content returned");
                                    }
                                    
                                    // Format the content to be compatible with TipTap
                                    // Replace markdown with HTML
                                    contentText = contentText
                                        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')  // Bold
                                        .replace(/\*(.*?)\*/g, '<em>$1</em>')              // Italic
                                        .replace(/\n/g, '<br />');                         // Line breaks
                                    
                                    // Set the content as HTML
                                    summaryEditor.commands.setContent(contentText);
                                    console.log("Content set in editor successfully");
                                } catch (error) {
                                    console.error("Error setting editor content:", error);
                                    // Fallback to a simple text setting method
                                    summaryEditor.commands.setContent("Error displaying content. Raw response: " + JSON.stringify(data));
                                }
                            }
                            
                            // Close popup
                            popupObj.remove();
                            
                        } catch (error) {
                            console.error('Error generating scenario:', error);
                            alert(error.message || 'Failed to generate scenario. Please try again.');
                        } finally {
                            button.disabled = false;
                            button.textContent = 'Generate Scenario';
                        }
                    };
                } else {
                    console.error("❌ Generate button not found in DOM");
                }
            } catch (error) {
                console.error("❌ Error displaying popup:", error);
                console.error("Stack trace:", error.stack);
                alert("An error occurred. Please check the console for details.");
            }
        });
        
        console.log("✅ Test button setup complete");
    });
})();

// Initialize the test button functionality
// console.log("Initializing test button scenario selection");
// setupTestButtonScenarioSelection();

// Removing the conflicting generateFakeTranscript reference to fix the error
// testBtn.addEventListener('click', generateFakeTranscript); // THIS LINE CAUSES THE ERROR

// Create a debug function to show the current state
window.debugClerky = function() {
    const debugInfo = {
        filenames: window.filenames ? window.filenames.length : 'undefined',
        guidanceDataLoaded: window.guidanceDataLoaded,
        testBtn: document.getElementById('testBtn') ? 'found' : 'not found',
        showPopup: typeof window.showPopup === 'function' ? 'defined' : 'undefined',
        auth: window.auth ? 'defined' : 'undefined',
        currentUser: window.auth?.currentUser ? 'logged in' : 'not logged in',
        clinicalNoteEditor: window.clinicalNoteEditor ? 'defined' : 'undefined',
        SERVER_URL: window.SERVER_URL
    };
    
    console.log("DEBUG INFO:", debugInfo);
    alert("Debug info logged to console");
    
    // Try to log window.generateScenario which is causing the error
    try {
        console.log("window.generateScenario:", window.generateScenario);
    } catch (e) {
        console.log("Error accessing window.generateScenario:", e);
    }
};

// Fix test button on page load
window.addEventListener('DOMContentLoaded', function() {
    console.log("🔄 Ensuring test button functionality is set up");
    (function fixTestButton() {
        console.log("🔧 Fixing test button");
        // Wait for DOM to be ready
        function init() {
            const testBtn = document.getElementById('testBtn');
            if (!testBtn) {
                console.error("❌ Test button not found");
                return;
            }
            
            console.log("✅ Test button found");
            
            // Remove all existing event listeners by cloning
            const newTestBtn = testBtn.cloneNode(true);
            testBtn.parentNode.replaceChild(newTestBtn, testBtn);
            
            // Direct test handler that calls generateFakeTranscript 
            newTestBtn.addEventListener('click', async function() {
                console.log("🔘 Test button clicked - Calling generateFakeTranscript directly");
                
                // Show spinner
                const spinner = document.getElementById('testSpinner');
                const text = document.getElementById('testText');
                if (spinner) spinner.style.display = 'inline-block';
                if (text) text.style.display = 'none';
                this.disabled = true;
                
                try {
                    await generateFakeTranscript();
                } catch (error) {
                    console.error("❌ Error generating fake transcript:", error);
                    alert("Failed to generate transcript: " + error.message);
                } finally {
                    // Reset button
                    if (spinner) spinner.style.display = 'none';
                    if (text) text.style.display = 'inline-block';
                    this.disabled = false;
                }
            });
        }
        
        // Execute immediately
        init();
    })();
});

// Fix Test Button on Page Load
document.addEventListener('DOMContentLoaded', function() {
    console.log("🔄 Fixing test button on DOMContentLoaded");
    const testBtn = document.getElementById('testBtn');
    
    if (testBtn) {
        // Remove existing listeners by cloning
        const newBtn = testBtn.cloneNode(true);
        testBtn.parentNode.replaceChild(newBtn, testBtn);
        
        // Add new click handler
        newBtn.addEventListener('click', function() {
            prepareClinicalIssuesAndShowPopup();
        });
        
        console.log("✅ Test button fixed successfully");
    } else {
        console.error("❌ Test button not found in DOM");
    }
});

// This is the final and definitive fix for the test button, added after all other code, to ensure it overrides any previous event handlers
// to ensure it overrides any previous event handlers
window.addEventListener('load', () => {
    console.log("📌 FINAL TEST BUTTON FIX");
    
    // Get the test button
    const testBtn = document.getElementById('testBtn');
    if (!testBtn) {
        console.error("❌ Test button not found at final fix");
        return;
    }
    
    console.log("✅ Test button found, removing all event listeners");
    
    // Clone to remove all event listeners
    const newTestBtn = testBtn.cloneNode(true);
    testBtn.parentNode.replaceChild(newTestBtn, testBtn);
    
    // Check if generateFakeTranscript is available in window
    if (typeof window.generateFakeTranscript !== 'function') {
        console.error("❌ window.generateFakeTranscript is not a function, creating a temporary function");
        
        // Create a temporary function that will be replaced when the real one loads
        window.generateFakeTranscript = async function() {
            console.log("🚨 Using temporary generateFakeTranscript function");
            alert("The generateFakeTranscript function is still loading. Please try again in a few seconds.");
        };
    }
    
    // Add final event handler
    newTestBtn.addEventListener('click', function() {
        console.log("🔘 Test button clicked - Showing clinical issues popup");
        prepareClinicalIssuesAndShowPopup();
    });
    
    console.log("✅ Test button fixed successfully - FINAL FIX");
});

// Global variables for clinical issues
let clinicalIssues = {
  obstetrics: [],
  gynecology: []
};
let clinicalIssuesLoaded = false;

// Load clinical issues from JSON file
async function loadClinicalIssues(retryCount = 0) {
  const MAX_RETRIES = 3;
  console.log('=== loadClinicalIssues ===');
  
  try {
    console.log('Attempting to load clinical issues...');
    const response = await fetch('clinical_issues.json');
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
      obstetricIssues: data.obstetrics.length,
      gynecologyIssues: data.gynecology.length
    });
    
    // Store the data
    clinicalIssues = data;
    
    console.log('Clinical issues loaded successfully:', {
      obstetricIssues: clinicalIssues.obstetrics.length,
      gynecologyIssues: clinicalIssues.gynecology.length
    });
    
    clinicalIssuesLoaded = true;
    console.log('Clinical issues loaded on page load');
    return true;
  } catch (error) {
    console.error('Error in loadClinicalIssues:', {
      error: error.message,
      type: error.name,
      retryCount,
      maxRetries: MAX_RETRIES
    });
    
    if (retryCount < MAX_RETRIES) {
      console.log(`Retrying... (Attempt ${retryCount + 1} of ${MAX_RETRIES})`);
      // Wait for 1 second before retrying
      await new Promise(resolve => setTimeout(resolve, 1000));
      return loadClinicalIssues(retryCount + 1);
    }
    
    console.error('Max retries exceeded. Using fallback clinical issues list.');
    // Create a minimal fallback list if loading fails
    clinicalIssues = {
      obstetrics: ["Preeclampsia", "Gestational diabetes", "Preterm labor"],
      gynecology: ["Endometriosis", "PCOS", "Fibroids"]
    };
    clinicalIssuesLoaded = true;
    return false;
  }
}

// Function to show clinical issue selection popup
function showClinicalIssueSelectionPopup() {
    console.log("Starting showClinicalIssueSelectionPopup");
    
    if (!clinicalIssues || (!clinicalIssues.obstetrics.length && !clinicalIssues.gynecology.length)) {
        alert("No clinical issues found. Please try again later.");
        return;
    }

    // Combine and sort all issues alphabetically
    const allIssues = [...clinicalIssues.obstetrics, ...clinicalIssues.gynecology].sort();
    
    // Create popup content with a single sorted list of issues and buttons at the top
    const popupContent = `
        <h3>Select a Clinical Issue</h3>
        <div class="search-box">
            <input type="text" id="issue-search" placeholder="Search issues..." autocomplete="off">
        </div>
        <div class="button-group">
            <button id="issue_cancel_btn" class="secondary">Cancel</button>
            <button id="issue_generate_btn" class="primary">Generate Scenario</button>
        </div>
        <div class="popup-grid">
            <form id="clinical_issue_form">
                ${allIssues.map((issue, index) => {
                    // Determine if this is an obstetric or gynecologic issue
                    const isObstetric = clinicalIssues.obstetrics.includes(issue);
                    const type = isObstetric ? "obstetrics" : "gynecology";
                    const typeLabel = isObstetric ? "OB" : "GYN";
                    
                    return `
                        <label class="issue-item">
                            <input type="radio" 
                                   name="clinical_issue" 
                                   value="${issue}" 
                                   data-type="${type}"
                                   ${index === 0 ? 'checked' : ''}>
                            <div>
                                <span>${issue}</span>
                                <span class="type-tag ${type}">${typeLabel}</span>
                            </div>
                        </label>
                    `;
                }).join('')}
            </form>
        </div>
    `;

    // Show popup
    const popupObj = showPopup(popupContent);
    
    // Add search functionality
    const searchInput = document.getElementById('issue-search');
    if (searchInput) {
        searchInput.focus();
        searchInput.addEventListener('input', function() {
            const searchTerm = this.value.toLowerCase();
            document.querySelectorAll('.issue-item').forEach(item => {
                const issueText = item.querySelector('span').textContent.toLowerCase();
                if (issueText.includes(searchTerm)) {
                    item.style.display = 'flex';
                } else {
                    item.style.display = 'none';
                }
            });
        });
    }
    
    // Add event listeners using standard DOM methods
    document.getElementById('issue_cancel_btn').addEventListener('click', function() {
        console.log("Closing clinical issue selection popup");
        popupObj.remove();
    });
    
    document.getElementById('issue_generate_btn').addEventListener('click', async function(event) {
        console.log("Generate scenario button clicked");
        const button = event.currentTarget;
        const selectedIssue = document.querySelector('input[name="clinical_issue"]:checked');
        
        if (!selectedIssue) {
            alert('Please select a clinical issue first.');
            return;
        }
        
        // Store the selected issue in global variables
        selectedClinicalIssue = selectedIssue.value;
        selectedClinicalIssueType = selectedIssue.dataset.type;
        console.log("Selected issue:", selectedClinicalIssue);
        console.log("Issue type:", selectedClinicalIssueType);

        // Disable the button and show loading state
        button.disabled = true;
        button.innerHTML = '<span class="spinner">&#x21BB;</span> Generating...';

        try {
            console.log("Calling generateFakeTranscript directly with selected issue");
            
            // Check if the function exists
            if (typeof window.generateFakeTranscript !== 'function') {
                console.error("window.generateFakeTranscript is not a function:", window.generateFakeTranscript);
                throw new Error("generateFakeTranscript function not available");
            }
            
            // Call the function
            console.log("Calling window.generateFakeTranscript()");
            await window.generateFakeTranscript();
            console.log("window.generateFakeTranscript() completed successfully");
            
            // Reset the selected issue after generating (optional)
            // selectedClinicalIssue = null;
            // selectedClinicalIssueType = null;
            
            // Close the popup
            popupObj.remove();
        } catch (error) {
            console.error("Error generating transcript:", error);
            console.error("Error stack:", error.stack);
            alert('An error occurred while generating the scenario: ' + error.message);
        } finally {
            // Re-enable the button and restore its text
            button.disabled = false;
            button.innerHTML = 'Generate Scenario';
        }
    });
}

// This will be a common helper function to check and load clinical issues
async function prepareClinicalIssuesAndShowPopup() {
    console.log("🔘 Test button clicked");
    
    // First check if clinical issues are loaded
    if (!clinicalIssuesLoaded) {
        console.warn("⚠️ Clinical issues not loaded yet");
        // Try to load clinical issues
        try {
            await loadClinicalIssues();
            showClinicalIssueSelectionPopup();
        } catch (error) {
            console.error("Failed to load clinical issues:", error);
            alert('Failed to load clinical issues. Using a limited set of issues.');
            showClinicalIssueSelectionPopup();
        }
    } else {
        showClinicalIssueSelectionPopup();
    }
}

// Make loadClinicalIssues available globally
window.loadClinicalIssues = loadClinicalIssues;

// Add GDPR-related functions
function logConsentStatus(userId, consentData) {
    // If logged in, save the user's consent preferences to the database
    if (userId && db) {
        try {
            const consentRef = doc(db, 'userConsent', userId);
            setDoc(consentRef, {
                userId: userId,
                consent: consentData,
                timestamp: new Date()
            }, { merge: true });
            console.log('Consent preferences saved to database');
        } catch (error) {
            console.error('Error saving consent preferences:', error);
        }
    }
}

function enablePrivacyFeatures() {
    // Listen for consent updates
    window.addEventListener('cookieConsentUpdated', function(event) {
        const consentData = event.detail;
        console.log('Consent updated:', consentData);
        
        // Update tracking behavior based on consent
        applyConsentPreferences(consentData);
        
        // Log consent if user is authenticated
        if (auth.currentUser) {
            logConsentStatus(auth.currentUser.uid, consentData);
        }
    });
}

function applyConsentPreferences(consentData) {
    // Implement functionality to respect user preferences
    if (!consentData.analytics) {
        // Disable any analytics tracking
        console.log('Analytics tracking disabled per user preference');
        // Implement actual disabling of analytics here
    }
    
    // Apply preferences for other cookie categories as needed
}

// Initialize privacy features when the document is ready
document.addEventListener('DOMContentLoaded', function() {
    // ... existing DOMContentLoaded code ...
    
    // Enable privacy features
    enablePrivacyFeatures();
    
    // Load cookie consent script if not already loaded
    if (!document.getElementById('cookie-consent-script')) {
        const script = document.createElement('script');
        script.id = 'cookie-consent-script';
        script.src = 'cookie-consent.js';
        document.body.appendChild(script);
    }
});

// Initialize transcript tabs
function initializeTranscriptTabs() {
    const tabs = document.querySelectorAll('.transcript-tab');
    const panes = document.querySelectorAll('.transcript-pane');
    const newTabBtn = document.querySelector('.new-tab');

    // Initialize each pane with a fallback editor
    panes.forEach(pane => {
        if (!pane.querySelector('.fallback-editor')) {
            const textarea = document.createElement('textarea');
            textarea.className = 'fallback-editor';
            textarea.placeholder = pane.getAttribute('placeholder') || 'Enter transcript here...';
            
            // Set explicit styles to ensure proper sizing
            textarea.style.width = '100%';
            textarea.style.height = '100%';
            textarea.style.minHeight = '200px';
            textarea.style.boxSizing = 'border-box';
            textarea.style.padding = '10px';
            textarea.style.border = '1px solid #ccc';
            textarea.style.borderRadius = '4px';
            textarea.style.resize = 'vertical';
            
            // Clear pane content and append the textarea
            pane.innerHTML = '';
            pane.appendChild(textarea);
        }
    });

    // Handle tab switching
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            // Remove active class from all tabs and panes
            tabs.forEach(t => t.classList.remove('active'));
            panes.forEach(p => p.classList.remove('active'));

            // Add active class to clicked tab and corresponding pane
            tab.classList.add('active');
            const paneId = `summary${tab.getAttribute('data-tab')}`;
            const pane = document.getElementById(paneId);
            if (pane) {
                pane.classList.add('active');
            }
        });

        // Handle tab closing
        const closeBtn = tab.querySelector('.tab-close');
        if (closeBtn) {
            closeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                
                // Don't close if it's the last tab
                if (tabs.length <= 1) {
                    return;
                }

                // Remove the tab and its corresponding pane
                const tabNumber = tab.getAttribute('data-tab');
                const paneId = `summary${tabNumber}`;
                const pane = document.getElementById(paneId);
                
                if (pane) {
                    pane.remove();
                }
                tab.remove();

                // Activate the previous tab
                const previousTab = tabs[Array.from(tabs).indexOf(tab) - 1];
                if (previousTab) {
                    previousTab.click();
                }
            });
        }
    });

    // Handle new tab creation
    if (newTabBtn) {
        newTabBtn.addEventListener('click', () => {
            const tabCount = tabs.length;
            const newTabNumber = tabCount + 1;
            
            // Create new tab
            const newTab = document.createElement('div');
            newTab.className = 'transcript-tab';
            newTab.setAttribute('data-tab', newTabNumber);
            newTab.innerHTML = `<span class="tab-close">&times;</span>`;
            
            // Create new pane with fallback editor
            const newPane = document.createElement('div');
            newPane.id = `summary${newTabNumber}`;
            newPane.className = 'transcript-pane';
            newPane.setAttribute('placeholder', 'Enter transcript here...');
            
            const textarea = document.createElement('textarea');
            textarea.className = 'fallback-editor';
            textarea.placeholder = 'Enter transcript here...';
            
            // Set explicit styles to ensure proper sizing
            textarea.style.width = '100%';
            textarea.style.height = '100%';
            textarea.style.minHeight = '200px';
            textarea.style.boxSizing = 'border-box';
            textarea.style.padding = '10px';
            textarea.style.border = '1px solid #ccc';
            textarea.style.borderRadius = '4px';
            textarea.style.resize = 'vertical';
            
            newPane.appendChild(textarea);
            
            // Add new elements to DOM
            newTabBtn.parentElement.insertBefore(newTab, newTabBtn);
            document.querySelector('.transcript-content').appendChild(newPane);
            
            // Activate the new tab
            newTab.click();
        });
    }
    
    // Ensure the first tab is active if none are active
    const activeTab = document.querySelector('.transcript-tab.active');
    if (!activeTab && tabs.length > 0) {
        tabs[0].click();
    }
}

// Add to your existing DOMContentLoaded event listener
document.addEventListener('DOMContentLoaded', function() {
    // ... existing initialization code ...
    
    initializeTranscriptTabs();
    
    // ... rest of your initialization code ...
});

// ... existing code ...
// Function to get the user's AI preference
function getUserAIPreference() {
    // Check if we have a stored preference
    const aiModelToggle = document.getElementById('ai-model-toggle');
    if (aiModelToggle) {
        return aiModelToggle.checked ? 'OpenAI' : 'DeepSeek';
    }
    
    // Default to DeepSeek if toggle isn't available
    console.log('AI model toggle not found, defaulting to DeepSeek');
    return 'DeepSeek';
}

// Helper function to enhance a prompt template with patient data
function enhancePrompt(promptTemplate, patientData) {
    console.log('Enhancing prompt with patient data');
    
    let enhanced = promptTemplate;
    
    // Replace placeholders with actual patient data
    if (typeof enhanced === 'string') {
        // Replace common placeholders
        enhanced = enhanced
            .replace(/\{patientName\}/g, patientData.name)
            .replace(/\{patientAge\}/g, patientData.age)
            .replace(/\{patientGender\}/g, patientData.gender)
            .replace(/\{chiefComplaint\}/g, patientData.chiefComplaint);
            
        // Replace any other fields that might be in the patient data
        Object.keys(patientData).forEach(key => {
            enhanced = enhanced.replace(new RegExp(`\\{${key}\\}`, 'g'), patientData[key]);
        });
    } else if (typeof enhanced === 'object') {
        // If the prompt is an object, add the patient data to it
        enhanced = {
            ...enhanced,
            patientData: patientData
        };
    }
    
    return enhanced;
}

// Stub implementations for track changes functions
// These were previously imported from tiptap-editor.js
function applyTrackChanges(editor, originalContent, newContent) {
    if (window.applyTrackChanges) {
        return window.applyTrackChanges(editor, originalContent, newContent);
    }
    
    // Simple fallback implementation
    setEditorContent(editor, newContent);
    return {
        changes: [{
            id: 'change-1',
            type: 'replace',
            text: 'Content updated'
        }]
    };
}

function acceptAllTrackChanges(editor) {
    if (window.acceptAllTrackChanges) {
        return window.acceptAllTrackChanges(editor);
    }
    
    // Simple fallback
    return true;
}

function rejectAllTrackChanges(editor, originalContent) {
    if (window.rejectAllTrackChanges) {
        return window.rejectAllTrackChanges(editor, originalContent);
    }
    
    // Simple fallback
    if (originalContent) {
        setEditorContent(editor, originalContent);
    }
    return true;
}

function acceptChange(editor, changeId) {
    if (window.acceptChange) {
        return window.acceptChange(editor, changeId);
    }
    
    // Simple fallback
    return true;
}

function rejectChange(editor, changeId) {
    if (window.rejectChange) {
        return window.rejectChange(editor, changeId);
    }
    
    // Simple fallback
    return true;
}

function getTrackChanges(editor) {
    if (window.getTrackChanges) {
        return window.getTrackChanges(editor);
    }
    
    // Simple fallback
    return [{
        id: 'change-1',
        type: 'replace',
        text: 'Content updated'
    }];
}

// Add proper updateUI function to handle authentication state
function updateUI(user) {
    console.log('updateUI called with user:', user ? 'authenticated' : 'undefined');
    
    try {
        // Get UI elements that need to be updated
        const loadingDiv = document.getElementById('loading');
        const mainContent = document.getElementById('mainContent');
        const landingPage = document.getElementById('landingPage');
        const userNameSpan = document.getElementById('userName');
        
        // Hide loading indicator
        if (loadingDiv) {
            loadingDiv.classList.add('hidden');
        }
        
        if (user) {
            // User is authenticated - show main content
            console.log('User authenticated, showing main content');
            if (mainContent) {
                mainContent.classList.remove('hidden');
            }
            
            if (landingPage) {
                landingPage.classList.add('hidden');
            }
            
            // Update user name display
            if (userNameSpan) {
                userNameSpan.textContent = user.displayName || user.email || 'User';
                userNameSpan.classList.remove('hidden');
            }
            
            // Show admin-only buttons for specific user
            const isAdmin = user.email === 'inouvel@gmail.com';
            if (typeof updateButtonVisibility === 'function') {
                updateButtonVisibility(isAdmin);
            }
        } else {
            // No user - show landing page
            console.log('No user, showing landing page');
            if (mainContent) {
                mainContent.classList.add('hidden');
            }
            
            if (landingPage) {
                landingPage.classList.remove('hidden');
            }
            
            if (userNameSpan) {
                userNameSpan.classList.add('hidden');
            }
        }
    } catch (error) {
        console.error('Error in updateUI:', error);
    }
}

// Function to show/hide admin-only buttons
function updateButtonVisibility(isAdmin) {
    try {
        const adminButtons = [
            'testBtn',
            'promptsBtn',
            'guidelinesBtn',
            'algosBtn',
            'linksBtn',
            'workflowsBtn',
            'proformaBtn',
            'exportBtn',
            'devBtn'
        ];
        
        // Always show these buttons
        const alwaysShowButtons = [
            'recordBtn',
            'actionBtn',
            'generateClinicalNoteBtn'
        ];
        
        // Show/hide admin buttons based on isAdmin flag
        adminButtons.forEach(btnId => {
            const btn = document.getElementById(btnId);
            if (btn) {
                btn.style.display = isAdmin ? 'inline-block' : 'none';
            }
        });
        
        // Ensure core buttons are always visible
        alwaysShowButtons.forEach(btnId => {
            const btn = document.getElementById(btnId);
            if (btn) {
                btn.style.display = 'inline-block';
            }
        });
    } catch (error) {
        console.error('Error updating button visibility:', error);
    }
}

// Speech recognition setup
let recognition = null;
let currentTranscript = '';
if ('webkitSpeechRecognition' in window) {
    recognition = new webkitSpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
}

// Audio recording functionality
let mediaRecorder = null;
let audioChunks = [];
let isRecording = false;
let recordingStartTime = null;

// Set up record button functionality
document.addEventListener('DOMContentLoaded', function() {
    const recordBtn = document.getElementById('recordBtn');
    const recordSymbol = document.getElementById('recordSymbol');
    
    if (recognition) {
        recognition.onresult = function(event) {
            const activePane = document.querySelector('.transcript-pane.active');
            if (!activePane) return;
            
            let finalTranscript = '';
            let interimTranscript = '';
            
            for (let i = event.resultIndex; i < event.results.length; i++) {
                const transcript = event.results[i][0].transcript;
                if (event.results[i].isFinal) {
                    finalTranscript += transcript;
                    currentTranscript += transcript; // Add to our maintained transcript
                } else {
                    interimTranscript += transcript;
                }
            }
            
            if (activePane._tiptapEditor) {
                // Keep the existing content and add new content
                const newContent = currentTranscript + 
                    (interimTranscript ? `<span class="interim">${interimTranscript}</span>` : '');
                activePane._tiptapEditor.commands.setContent(newContent);
            } else {
                const textarea = activePane.querySelector('textarea');
                if (textarea) {
                    textarea.value = currentTranscript + interimTranscript;
                }
            }
        };
        
        recognition.onerror = function(event) {
            console.error('Speech recognition error:', event.error);
            if (event.error === 'no-speech' || event.error === 'audio-capture') {
                // Restart recognition if it stopped due to no speech
                if (isRecording) {
                    recognition.start();
                }
            }
        };
        
        recognition.onend = function() {
            // Restart recognition if we're still recording
            if (isRecording) {
                recognition.start();
            }
        };
    }
    
    if (recordBtn) {
        recordBtn.addEventListener('click', async function() {
            try {
                if (!isRecording) {
                    // Reset transcript when starting new recording
                    currentTranscript = '';
                    
                    // Start recording
                    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                    mediaRecorder = new MediaRecorder(stream);
                    audioChunks = [];
                    recordingStartTime = Date.now();
                    
                    mediaRecorder.ondataavailable = (event) => {
                        if (event.data.size > 0) {
                            audioChunks.push(event.data);
                        }
                    };
                    
                    mediaRecorder.onstop = async () => {
                        const recordingDuration = Math.round((Date.now() - recordingStartTime) / 1000);
                        
                        // Get the active transcript pane
                        const activePane = document.querySelector('.transcript-pane.active');
                        if (activePane) {
                            // Add recording information to the transcript
                            const recordingInfo = `\n[Audio recording: ${recordingDuration} seconds]\n`;
                            
                            if (activePane._tiptapEditor) {
                                const currentContent = activePane._tiptapEditor.getHTML();
                                activePane._tiptapEditor.commands.setContent(currentContent + recordingInfo);
                            } else {
                                const textarea = activePane.querySelector('textarea');
                                if (textarea) {
                                    textarea.value += recordingInfo;
                                }
                            }
                        }
                        
                        // Clean up
                        stream.getTracks().forEach(track => track.stop());
                        recordingStartTime = null;
                    };
                    
                    // Start recording with a 1-second timeslice
                    mediaRecorder.start(1000);
                    
                    // Start speech recognition
                    if (recognition) {
                        recognition.start();
                    }
                    
                    isRecording = true;
                    recordSymbol.style.backgroundColor = '#00FF00'; // Change to green while recording
                    recordBtn.textContent = 'Stop Recording';
                } else {
                    // Stop recording
                    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
                        mediaRecorder.stop();
                    }
                    
                    // Stop speech recognition
                    if (recognition) {
                        recognition.stop();
                    }
                    
                    isRecording = false;
                    recordSymbol.style.backgroundColor = '#FF0000'; // Change back to red
                    recordBtn.textContent = 'Record';
                }
            } catch (error) {
                console.error('Error with audio recording:', error);
                alert('Error accessing microphone: ' + error.message);
                isRecording = false;
                recordSymbol.style.backgroundColor = '#FF0000';
                recordBtn.textContent = 'Record';
                recordingStartTime = null;
                
                // Stop speech recognition if it's running
                if (recognition) {
                    recognition.stop();
                }
            }
        });
        console.log('Record button listener set up');
    } else {
        console.warn('Record button not found');
    }
});



