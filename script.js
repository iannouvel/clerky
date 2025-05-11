// Import Firebase instances from firebase-init.js
import { app, db, auth } from './firebase-init.js';
import { GoogleAuthProvider, signInWithPopup, onAuthStateChanged, signOut, signInWithRedirect, getRedirectResult } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import { getAnalytics } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-analytics.js';
import { doc, getDoc, setDoc } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

// Make auth globally available for functions in index.html
window.auth = auth;

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
    const summaryElement = document.getElementById('summary');

    // Reset the global arrays at the start of each action
    AIGeneratedListOfIssues = [];
    guidelinesForEachIssue = [];

    if (!summaryElement) {
        throw new Error('Summary text area not found');
    }

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
document.addEventListener('DOMContentLoaded', async function() {
    try {
        const loaded = await loadGuidelineSummaries();
        
        if (loaded) {
            // Make the clinicalNoteOutput element visible
            const clinicalNoteOutput = document.getElementById('clinicalNoteOutput');
            if (clinicalNoteOutput) {
                clinicalNoteOutput.style.display = 'block';
            }
            // Continue with initialization
            const loadingDiv = document.getElementById('loading');
            const userNameSpan = document.getElementById('userName');
            const promptsBtn = document.getElementById('promptsBtn');
            const linksBtn = document.getElementById('linksBtn');
            const clinical_info_btn = document.getElementById('clinical_info_btn');
            const clinical_info_popup = document.getElementById('clinical_info_popup');
            const toggleThemeBtn = document.getElementById('toggleThemeBtn');
            const printBtn = document.getElementById('printBtn');
            const aiModelToggle = document.getElementById('ai-model-toggle');
            
            // Expose the generateFakeTranscript function globally
            window.generateFakeTranscript = generateFakeTranscript;
            console.log('Exposed generateFakeTranscript to window object');
            
            // ... existing code ...
            function displayFakeTranscript(content) {
                console.log('=== displayFakeTranscript START ===');
                console.log('Attempting to display transcript content:', content);
                
                try {
                    // Get the active transcript pane
                    const activePane = document.querySelector('.transcript-pane.active');
                    console.log('Active transcript pane found:', activePane);
                    
                    if (!activePane) {
                        console.error('No active transcript pane found');
                        // Try to find any transcript pane
                        const anyPane = document.querySelector('.transcript-pane');
                        if (anyPane) {
                            console.log('Found inactive transcript pane, activating it');
                            anyPane.classList.add('active');
                            const tabId = anyPane.id.replace('pane', 'tab');
                            const tab = document.getElementById(tabId);
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
                            activePane.appendChild(textarea);
                        }
                        console.log('Setting content in fallback textarea');
                        textarea.value = content;
                        console.log('Content set in fallback textarea');
                    }
                } catch (error) {
                    console.error('Error in displayFakeTranscript:', error);
                    console.error('Error stack:', error.stack);
                }
                
                console.log('=== displayFakeTranscript END ===');
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

            async function generateFakeTranscript() {
                console.log('=== generateFakeTranscript START ===');
                try {
                    // Get user token
                    const user = auth.currentUser;
                    if (!user) {
                        console.error('No user found');
                        return;
                    }
                    console.log('Got user token');

                    // Generate random patient data inline
                    console.log('Generating random patient data inline');
                    const patientData = generateRandomPatientData();
                    console.log('Random patient data:', patientData);

                    // Get prompts
                    console.log('Fetching prompts');
                    const prompts = await getPrompts();
                    console.log('Prompts fetched:', prompts);

                    // Create enhanced prompt
                    console.log('Creating enhanced prompt');
                    const enhancedPrompt = enhancePrompt(prompts.transcriptPrompt, patientData);
                    console.log('Enhanced prompt created:', enhancedPrompt);

                    // Get token
                    console.log('Getting auth token');
                    const token = await user.getIdToken();
                    if (!token) {
                        console.error('Failed to get token');
                        return;
                    }
                    console.log('Got auth token');

                    // Make API request
                    console.log('Making API request');
                    const response = await fetch('https://clerky-uzni.onrender.com/generateTranscript', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${token}`
                        },
                        body: JSON.stringify({
                            prompt: enhancedPrompt,
                            model: getUserAIPreference()
                        })
                    });

                    if (!response.ok) {
                        throw new Error(`API request failed with status: ${response.status}`);
                    }

                    const data = await response.json();
                    console.log('API response received:', data);

                    // Check for valid response
                    if (data.success && data.response && data.response.content) {
                        console.log('Data contains response content:', data.response.content);
                        
                        // Set the content using setSummaryContent
                        console.log('About to set transcript content');
                        setSummaryContent(data.response.content);
                        console.log('Transcript content set successfully');
                        
                        return data.response.content;
                    } else {
                        console.error('Invalid response format:', data);
                        throw new Error('Invalid response format');
                    }
                } catch (error) {
                    console.error('Error generating fake transcript:', error);
                    throw error;
                } finally {
                    console.log('=== generateFakeTranscript END ===');
                }
            }

            // Expose the function to the global scope
            window.generateFakeTranscript = generateFakeTranscript;
            // ... existing code ...

            // Function to check if user is Ian Nouvel
            function isAdminUser(user) {
                return user && user.email === 'inouvel@gmail.com';
            }

            // Function to update button visibility based on user
            function updateButtonVisibility(user) {
                const adminButtons = [
                    'testBtn',
                    'promptsBtn',
                    'guidelinesBtn',
                    'algosBtn',
                    'linksBtn',
                    'workflowsBtn',
                    'proformaBtn',
                    'exportBtn'
                ];
                
                // Always show these buttons
                const alwaysShowButtons = [
                    'recordBtn',
                    'actionBtn',
                    'generateClinicalNoteBtn'
                ];
                
                // Show/hide admin buttons based on user
                adminButtons.forEach(btnId => {
                    const btn = document.getElementById(btnId);
                    if (btn) {
                        btn.style.display = isAdminUser(user) ? 'inline-block' : 'none';
                    }
                });
                
                // Ensure core buttons are always visible
                alwaysShowButtons.forEach(btnId => {
                    const btn = document.getElementById(btnId);
                    if (btn) {
                        btn.style.display = 'inline-block';
                    }
                });
            }

            // Update the updateUI function to include button visibility
            async function updateUI(user) {
                console.log('updateUI called with user:', user?.email);
                loadingDiv.classList.add('hidden'); // Hide the loading indicator once auth state is determined
                if (user) {
                    try {
                        // Check if user has accepted disclaimer
                        const disclaimerRef = doc(db, 'disclaimerAcceptance', user.uid);
                        console.log('Checking disclaimer acceptance for user:', user.uid);
                        const disclaimerDoc = await getDoc(disclaimerRef);
                        console.log('Disclaimer doc exists:', disclaimerDoc.exists());

                        if (!disclaimerDoc.exists()) {
                            console.log('No disclaimer acceptance found, redirecting to disclaimer page');
                            window.location.href = 'disclaimer.html';
                            return;
                        }
                        
                        // Get current consent preferences if they exist
                        const consentCookie = window.clerkyConsent?.getConsent();
                        if (consentCookie) {
                            // Log the consent status to the database when a user logs in
                            logConsentStatus(user.uid, consentCookie);
                        }

                        console.log('Disclaimer accepted, showing main content');
                        // If disclaimer is accepted, show main content
                        userNameSpan.textContent = user.displayName;
                        userNameSpan.classList.remove('hidden');
                        showMainContent();
                        updateButtonVisibility(user);

                        // Initialize model toggle
                        await initializeModelToggle();

                        // Check if we need to return to a previous page
                        const returnToPage = localStorage.getItem('returnToPage');
                        if (returnToPage) {
                            console.log('Returning to previous page:', returnToPage);
                            localStorage.removeItem('returnToPage'); // Clear the stored page
                            // Only redirect if we're not already on the target page
                            if (window.location.pathname !== '/' + returnToPage) {
                                window.location.href = returnToPage;
                            }
                        }
                    } catch (error) {
                        console.error('Error checking disclaimer:', error);
                        // If there's an error checking the disclaimer, redirect to disclaimer page
                        window.location.href = 'disclaimer.html';
                    }
                } else {
                    console.log('No user, showing landing page');
                    showLandingPage();
                    userNameSpan.classList.add('hidden');
                }
            }

            // Initial check of the auth state
            updateUI(auth.currentUser);

            // Register `onAuthStateChanged` listener to handle future auth state changes
            onAuthStateChanged(auth, updateUI);

            // Attach click listener for algos button
            if (algosBtn) {
                algosBtn.addEventListener('click', function () {
                    window.open('https://iannouvel.github.io/clerky/algos.html', '_blank'); // Open in new tab
                });
            }

            // Speech Recognition functionality
            if (window.SpeechRecognition || window.webkitSpeechRecognition) {
                const recognition = new (window.SpeechRecognition || window.webkitSpeechRecognition)();
                recognition.lang = 'en-US';
                recognition.interimResults = true;
                recognition.continuous = true;
                recognition.maxAlternatives = 1;
                let recording = false;

                recordBtn.addEventListener('click', function () {
                    if (!recording) {
                        recognition.start();
                        recording = true;
                        recordSymbol.textContent = "🔴"; // Show recording symbol
                    } else {
                        recognition.stop();
                        recording = false;
                        recordSymbol.textContent = ""; // Remove recording symbol
                    }
                });

                recognition.onstart = () => {};
                recognition.onend = () => {
                    if (recording) {
                        recognition.start();
                    } else {
                        recordSymbol.textContent = ""; // Reset recording symbol when stopped
                    }
                };

                recognition.onresult = (event) => {
                    const transcript = event.results[event.resultIndex][0].transcript;
                    if (event.results[event.resultIndex].isFinal) {
                        const summaryTextarea = document.getElementById('summary'); // Select the correct element by ID
                        if (summaryTextarea) {
                            const currentContent = getSummaryContent();
                            setSummaryContent(currentContent + transcript + "<br>");
                        } else {
                        }
                    } else {
                    }
                };

                recognition.onerror = (event) => {};
            } else {
            }
            
            let promptsData = JSON.parse(localStorage.getItem('promptsData')) || {}; // Retrieve saved prompts data from local storage

            // Populate filenames and summaries at the start
            let filenames = [];  // Initialize as empty
            let summaries = [];  // Initialize as empty

            fetch('https://raw.githubusercontent.com/iannouvel/clerky/main/guidance/summary/list_of_summaries.json')
                .then(response => {
                    if (!response.ok) { // Check for network errors
                        throw new Error('Network response was not ok ' + response.statusText);
                    }
                    return response.json(); // Parse the response as JSON
                })
                .then(data => {
                    // 'data' is the JSON object containing filenames and summaries
                    filenames = Object.keys(data); // Extract filenames
                    summaries = Object.values(data); // Extract summaries
            
                    // Now you can process the filenames and summaries as needed
            
                    // If you want to process them together:
                    filenames.forEach(filename => {
                        const summary = data[filename];
                    });
                })
                .catch(error => {
                });
            
            function loadPrompts() {
                console.log('Loading prompts into UI');
                // Try loading saved prompts data into the respective text areas
                try {
                    promptIssues.value = promptsData.promptIssues || document.getElementById('promptIssues').defaultValue; // Load issues
                    promptGuidelines.value = promptsData.promptGuidelines || document.getElementById('promptGuidelines').defaultValue; // Load guidelines
                    promptNoteGenerator.value = promptsData.promptNoteGenerator || document.getElementById('promptNoteGenerator').defaultValue; // Load note generator prompt
                    console.log('Loaded prompts into UI:', {
                        promptIssues: promptIssues.value,
                        promptGuidelines: promptGuidelines.value,
                        promptNoteGenerator: promptNoteGenerator.value
                    });
                } catch (error) {
                    console.error('Error loading prompts into UI:', error);
                }
            }

            function savePrompts() {
                // Save the current values of the prompts into local storage
                try {
                    promptsData.promptIssues = promptIssues.value || document.getElementById('promptIssues').defaultValue; // Save issues
                    promptsData.promptGuidelines = promptGuidelines.value || document.getElementById('promptGuidelines').defaultValue; // Save guidelines
                    promptsData.promptNoteGenerator = promptNoteGenerator.value || document.getElementById('promptNoteGenerator').defaultValue; // Save note generator prompt
                    localStorage.setItem('promptsData', JSON.stringify(promptsData)); // Store in local storage
                    alert('Prompts saved successfully!'); // Notify the user on successful save
                } catch (error) {
                }
            }

            savePromptsBtn.addEventListener('click', savePrompts); // Attach the savePrompts function to the save button

            // Select all tabs
            const tabs = document.querySelectorAll('.tab');

            // Handle prompts button click
            if (promptsBtn) {
                promptsBtn.addEventListener('click', () => {
                    window.open('prompts.html', '_blank');
                });
            }

            guidelinesBtn.addEventListener('click', () => {
                // Open guidelines.html in a new tab
                window.open('guidelines.html', '_blank');
            });

            async function loadLinks() {
                // Load links from a file and display them in the UI
                try {
                    const response = await fetch('links.txt'); // Fetch the links from a local file
                    const text = await response.text(); // Get the response text
                    const linksList = document.getElementById('linksList'); // Get the list element
                    linksList.innerHTML = ''; // Clear the list before adding new links
                    const links = text.split('\n'); // Split the text by line to get individual links
                    links.forEach(link => {
                        if (link.trim()) { // Check if the link is not empty
                            const [text, url] = link.split(';'); // Split the text into link description and URL
                            const listItem = document.createElement('li'); // Create a list item
                            const anchor = document.createElement('a'); // Create an anchor tag
                            anchor.href = url.trim(); // Set the anchor href
                            anchor.textContent = text.trim(); // Set the anchor text content
                            anchor.target = '_blank'; // Open the link in a new tab
                            listItem.appendChild(anchor); // Append the anchor to the list item
                            linksList.appendChild(listItem); // Append the list item to the list
                        }
                    });
                } catch (error) {
                }
            }

            async function loadGuidelines() {
                // Load guidelines from a remote file and display them in the UI
                guidelinesList.innerHTML = ''; // Clear existing guidelines

                fetch('https://raw.githubusercontent.com/iannouvel/clerky/main/guidance/list_of_guidelines.txt')
                    .then(response => response.text()) // Get the text response
                    .then(data => {
                        const guidelines = data.split('\n').filter(line => line.trim() !== ''); // Filter non-empty lines
                        guidelines.forEach(guideline => {
                            const listItem = document.createElement('li'); // Create a list item
                            const link = document.createElement('a'); // Create an anchor tag
                            const formattedGuideline = guideline.trim(); // Clean up the guideline text
                            const pdfGuideline = formattedGuideline.replace(/\.txt$/i, '.pdf'); // Convert txt to pdf
                            link.href = `https://github.com/iannouvel/clerky/raw/main/guidance/${encodeURIComponent(pdfGuideline)}`; // Set the URL
                            link.textContent = formattedGuideline; // Set the link text
                            link.target = '_blank'; // Open in a new tab

                            const algoLink = document.createElement('a'); // Create an additional link for algo
                            const htmlFilename = formattedGuideline.replace(/\.pdf$/i, '.html'); // Convert PDF to HTML filename
                            const algoUrl = `https://iannouvel.github.io/clerky/algos/${encodeURIComponent(htmlFilename)}`;
                            algoLink.href = algoUrl; // Set the algo link URL
                            algoLink.textContent = 'Algo'; // Set the algo link text
                            algoLink.target = '_blank'; // Open algo in a new tab
                            algoLink.style.marginLeft = '10px'; // Add space between the links

                            listItem.appendChild(link); // Add the main guideline link
                            listItem.appendChild(algoLink); // Add the algo link
                            guidelinesList.appendChild(listItem); // Append to the guidelines list
                        });
                    })
                    .catch(error => {}); // Log error if loading guidelines fails
            }

            // Add this helper function to collect proforma data
            function collectProformaData() {
                const obsProforma = document.getElementById('obsProforma');
                const gynProforma = document.getElementById('gynProforma');
                
                if (!obsProforma || !gynProforma) {
                    return { type: null, fields: {} };
                }

                const isObstetric = !obsProforma.classList.contains('hidden');
                const data = {
                    type: isObstetric ? 'obstetric' : 'gynaecological',
                    fields: {}
                };

                // Get all inputs from the active proforma
                const proforma = isObstetric ? obsProforma : gynProforma;
                const inputs = proforma.querySelectorAll('input, textarea, select');
                
                inputs.forEach(input => {
                    if (input.id && input.value) {
                        data.fields[input.id] = input.value;
                    }
                });

                return data;
            }

            // Modify generateClinicalNote to check server health first
            async function generateClinicalNote() {
                if (!await ensureServerHealth()) return;
                
                try {
                    const spinner = document.getElementById('spinner');
                    const generateText = document.getElementById('generateText');

                    // Show spinner and hide text
                    spinner.style.display = 'inline-block';
                    generateText.style.display = 'none';

                    // Fetch prompts from prompts.json
                    const prompts = await fetch('https://raw.githubusercontent.com/iannouvel/clerky/main/prompts.json')
                        .then(response => response.json());

                    const summaryDiv = document.getElementById('summary');
                    const text = summaryDiv.textContent.trim();
                    if (text === '') {
                        alert('Please enter text into the summary field.');
                        return;
                    }

                    const proformaData = collectProformaData();
                    
                    // Get the clinical note template and fill it with the text
                    let enhancedPrompt = prompts.clinicalNote.prompt;

                    // Add proforma data if it exists
                    if (proformaData.fields && Object.keys(proformaData.fields).length > 0) {
                        enhancedPrompt += `\n\nAdditional information from the ${proformaData.type} proforma:\n`;
                        for (const [key, value] of Object.entries(proformaData.fields)) {
                            if (value && value.trim()) {
                                const fieldName = key
                                    .replace(/^(obs|gyn)-/, '')
                                    .split('-')
                                    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
                                    .join(' ');
                                enhancedPrompt += `${fieldName}: ${value}\n`;
                            }
                        }
                        enhancedPrompt += '\nClinical transcript:\n';
                    }
                    
                    // Replace the {{text}} placeholder with the actual text
                    enhancedPrompt = enhancedPrompt.replace('{{text}}', text);

                    const user = auth.currentUser;
                    if (!user) {
                        throw new Error('Please sign in first');
                    }
                    const token = await user.getIdToken();

                    const response = await fetch(`${SERVER_URL}/newFunctionName`, {
                        method: 'POST',
                        headers: { 
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${token}`
                        },
                        body: JSON.stringify({ 
                            prompt: enhancedPrompt
                        })
                    });

                    if (!response.ok) {
                        const errorText = await response.text();
                        throw new Error(`Server error: ${errorText}`);
                    }

                    const data = await response.json();

                    if (data.success) {
                        // Extract the content from the response object if needed
                        const responseText = data.response && typeof data.response === 'object' 
                            ? data.response.content 
                            : data.response;
                            
                        if (!responseText) {
                            console.error('Invalid response format:', data.response);
                            throw new Error('Invalid response format from server');
                        }
                        
                        let formattedResponse = responseText
                            .replace(/\n{3,}/g, '\n\n')
                            .trim();
                        
                        // Save current content before replacing it
                        const currentContent = getSummaryContent();
                        
                        // Store the current content if needed for track changes
                        originalClinicalNoteContent = currentContent;
                        
                        // Apply the formatted response with track changes
                        const formattedHtml = formattedResponse.replace(/\n/g, '<br>');
                        const changesResult = applyTrackChanges(summaryEditor, currentContent, formattedHtml);
                        
                        // Add track changes toolbar to allow accepting/rejecting changes
                        addTrackChangesToolbar(changesResult);
                    } else {
                        throw new Error(data.message || 'Failed to generate note');
                    }
                } catch (error) {
                    alert(error.message || 'Failed to generate clinical note. Please try again.');
                } finally {
                    // Hide spinner and restore text
                    spinner.style.display = 'none';
                    generateText.style.display = 'inline-block';
                }
            }

            generateClinicalNoteBtn.addEventListener('click', generateClinicalNote);

            const MAX_RETRIES = 2;

            // Add workflows button click handler
            if (workflowsBtn) {
                workflowsBtn.addEventListener('click', function() {
                    window.open('workflows.html', '_blank');
                });
            }

            // Attach the handleAction function to the action button
            actionBtn.addEventListener('click', handleAction);

            // Add event listener for X-check button
            if (xCheckBtn) {
                xCheckBtn.addEventListener('click', async function() {
                    if (!await ensureServerHealth()) return;
                    
                    // Get spinner and text elements
                    const xCheckSpinner = document.getElementById('xCheckSpinner');
                    const xCheckText = document.getElementById('xCheckText');
                    
                    // Show spinner and hide text
                    if (xCheckSpinner && xCheckText) {
                        xCheckSpinner.style.display = 'inline-block';
                        xCheckText.style.display = 'none';
                    }
                    xCheckBtn.disabled = true;
                    
                    try {
                        const summaryElement = document.getElementById('summary');
                        const suggestedGuidelines = document.getElementById('suggestedGuidelines');
                        
                        if (!summaryElement) {
                            console.error('Required elements not found');
                            return;
                        }

                        const summaryText = getSummaryContent();

                        if (!summaryText) {
                            alert('Please ensure the transcript is populated before X-checking.');
                            return;
                        }

                        // Get the guidelines from the suggested guidelines container
                        const guidelines = Array.from(suggestedGuidelines.querySelectorAll('.accordion-item'))
                            .map(item => {
                                // Get only the text from the header (which contains the issue)
                                const header = item.querySelector('.accordion-header');
                                if (!header) return null;
                                
                                // Get all guideline links from the content
                                const guidelineLinks = Array.from(item.querySelectorAll('.guidelines-list a'))
                                    .filter(a => !a.textContent.includes('Algo')) // Exclude Algo links
                                    .map(a => a.textContent.trim())
                                    .filter(text => text); // Remove empty strings
                                    
                                return guidelineLinks;
                            })
                            .flat() // Flatten the array of arrays
                            .filter(text => text); // Remove null/empty values

                        if (guidelines.length === 0) {
                            alert('No guidelines available to check against. Please add some guidelines first.');
                            return;
                        }

                        // Create popup content with guideline toggles
                        const popupContent = `
                            <h3>Select Guidelines for X-check</h3>
                            <div class="button-group">
                                <button onclick="selectAllGuidelines()" class="secondary">Select All</button>
                                <button onclick="deselectAllGuidelines()" class="secondary">Deselect All</button>
                                <button onclick="performXCheck(this)" class="primary">Run X-check</button>
                            </div>
                            <div id="guidelineToggles" class="popup-grid">
                                <form>
                                    ${guidelines.map((guideline, index) => `
                                        <label>
                                            <input type="checkbox" 
                                                   id="guideline${index}" 
                                                   checked>
                                            <span>${guideline}</span>
                                        </label>
                                    `).join('')}
                                </form>
                            </div>
                            <div class="button-group">
                                <button onclick="this.closest('.popup').remove()" class="secondary">Cancel</button>
                            </div>
                        `;

                        // Show popup
                        const popup = showPopup(popupContent);

                        // Add the selectAllGuidelines and deselectAllGuidelines functions to the window object
                        window.selectAllGuidelines = function() {
                            document.querySelectorAll('#guidelineToggles input[type="checkbox"]').forEach(checkbox => {
                                checkbox.checked = true;
                            });
                        };

                        window.deselectAllGuidelines = function() {
                            document.querySelectorAll('#guidelineToggles input[type="checkbox"]').forEach(checkbox => {
                                checkbox.checked = false;
                            });
                        };

                        // Add the performXCheck function to the window object
                        window.performXCheck = async function(button) {
                            const selectedGuidelines = Array.from(document.querySelectorAll('#guidelineToggles input:checked'))
                                .map((checkbox, index) => guidelines[index]);

                            if (selectedGuidelines.length === 0) {
                                alert('Please select at least one guideline to check against.');
                                return;
                            }

                            // Disable the button and show loading state
                            button.disabled = true;
                            button.innerHTML = '<span class="spinner">&#x21BB;</span> Processing...';

                            try {
                                const user = auth.currentUser;
                                if (!user) {
                                    throw new Error('Please sign in first');
                                }
                                const token = await user.getIdToken();

                                // Add retry logic
                                const MAX_RETRIES = 3;
                                const RETRY_DELAYS = [2000, 4000, 8000]; // 2, 4, 8 seconds
                                let lastError = null;

                                for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
                                    try {
                                        console.log(`Making request to crossCheck endpoint (attempt ${attempt + 1}/${MAX_RETRIES})...`);
                                        
                                        // Log the payload being sent
                                        const payload = {
                                            clinicalNote: getSummaryContent(),
                                            guidelines: selectedGuidelines
                                        };
                                        console.log("X-check request payload:", payload);
                                        
                                        const response = await fetch(`${SERVER_URL}/crossCheck`, {
                                            method: 'POST',
                                            headers: {
                                                'Content-Type': 'application/json',
                                                'Authorization': `Bearer ${token}`
                                            },
                                            body: JSON.stringify(payload)
                                        });

                                        if (response.ok) {
                                            const data = await response.json();
                                            console.log('X-check raw response:', data);
                                            
                                            // Log the extracted content for debugging
                                            let extractedContent = "";
                                            
                                            // Handle the response data
                                            if (typeof data.updatedNote === 'string') {
                                                // Check if the string contains HTML tags (which it should now directly)
                                                if (data.updatedNote.includes('<') && data.updatedNote.includes('>')) {
                                                    console.log('Found direct HTML content from AI');
                                                    extractedContent = data.updatedNote;
                                                    const suggestedHtml = data.updatedNote;
                                                    
                                                    // Count and log the number of <i> tags
                                                    const italicizedMatches = suggestedHtml.match(/<i>(.*?)<\/i>/g);
                                                    const italicCount = italicizedMatches ? italicizedMatches.length : 0;
                                                    console.log(`Number of italicized changes detected: ${italicCount}`);
                                                    if (italicizedMatches) {
                                                        console.log("Italicized changes:", italicizedMatches);
                                                    }
                                                    
                                                    const originalHtml = getSummaryContent();
                                                    originalClinicalNoteContent = originalHtml;
                                                    
                                                    // Add track changes toolbar and apply tracked changes
                                                    console.log("Applying track changes to the editor");
                                                    const changesResult = applyTrackChanges(summaryEditor, originalHtml, suggestedHtml);
                                                    console.log("Track changes result:", changesResult);
                                                    addTrackChangesToolbar(changesResult);
                                                } else {
                                                    // Backward compatibility for the old code block format
                                                    const htmlMatch = data.updatedNote.match(/```html\n([\s\S]*?)\n```/);
                                                    console.log('HTML Match:', htmlMatch);
                                                    
                                                    if (htmlMatch && htmlMatch[1]) {
                                                        console.log('Found HTML content in code block, updating summary with track changes');
                                                        const suggestedHtml = htmlMatch[1];
                                                        const originalHtml = getSummaryContent();
                                                        originalClinicalNoteContent = originalHtml;
                                                        
                                                        // Add track changes toolbar and apply tracked changes
                                                        const changesResult = applyTrackChanges(summaryEditor, originalHtml, suggestedHtml);
                                                        addTrackChangesToolbar(changesResult);
                                                    } else {
                                                        console.log('No HTML content found, using raw response with track changes');
                                                        const suggestedText = data.updatedNote.replace(/\n/g, '<br>');
                                                        const originalHtml = getSummaryContent();
                                                        originalClinicalNoteContent = originalHtml;
                                                        
                                                        // Add track changes toolbar and apply tracked changes
                                                        const changesResult = applyTrackChanges(summaryEditor, originalHtml, suggestedText);
                                                        addTrackChangesToolbar(changesResult);
                                                    }
                                                }
                                            } else if (typeof data.updatedNote === 'object') {
                                                // If it's an object, try to find HTML content in the object
                                                const suggestedHtml = data.updatedNote.html || data.updatedNote.content || JSON.stringify(data.updatedNote);
                                                const originalHtml = getSummaryContent();
                                                originalClinicalNoteContent = originalHtml;
                                                
                                                // Add track changes toolbar and apply tracked changes
                                                const changesResult = applyTrackChanges(summaryEditor, originalHtml, suggestedHtml);
                                                addTrackChangesToolbar(changesResult);
                                            } else {
                                                console.error('Unexpected response format:', data.updatedNote);
                                                throw new Error('Unexpected response format from server');
                                            }

                                            alert('X-check completed successfully. Note has been updated with suggested improvements. You can now accept or reject the changes.');
                                            return; // Success, exit the retry loop
                                        }

                                        // If we get a 502 Bad Gateway or CORS error and haven't exceeded retries
                                        if ((response.status === 502 || response.status === 0) && attempt < MAX_RETRIES - 1) {
                                            const delay = RETRY_DELAYS[attempt];
                                            console.log(`Server returned ${response.status}, retrying in ${delay/1000} seconds...`);
                                            await new Promise(resolve => setTimeout(resolve, delay));
                                            continue;
                                        }

                                        // If we get here, the response wasn't ok and we've either exhausted retries or it's not a retryable error
                                        const errorText = await response.text();
                                        throw new Error(`Server error (${response.status}): ${errorText}`);
                                    } catch (error) {
                                        lastError = error;
                                        console.error(`Attempt ${attempt + 1} failed:`, error);
                                        
                                        // If it's a network error and we haven't exceeded retries
                                        if ((error.name === 'TypeError' || error.message.includes('Failed to fetch')) && attempt < MAX_RETRIES - 1) {
                                            const delay = RETRY_DELAYS[attempt];
                                            console.log(`Network error, retrying in ${delay/1000} seconds...`);
                                            await new Promise(resolve => setTimeout(resolve, delay));
                                            continue;
                                        }
                                        
                                        // If we get here, we've either exhausted retries or it's not a retryable error
                                        throw error;
                                    }
                                }

                                // If we get here, all retries failed
                                throw lastError || new Error('All retry attempts failed');
                            } catch (error) {
                                console.error('Error during X-check:', error);
                                alert('Failed to perform X-check: ' + error.message);
                            } finally {
                                // Close the popup
                                popup.remove();
                            }
                        };
                    } catch (error) {
                        console.error('Error during X-check:', error);
                        alert('Failed to perform X-check: ' + error.message);
                    } finally {
                        // Reset button state
                        if (xCheckSpinner && xCheckText) {
                            xCheckSpinner.style.display = 'none';
                            xCheckText.style.display = 'inline-block';
                        }
                        xCheckBtn.disabled = false;
                    }
                });
            }

            // Set initial model toggle text and state
            const modelToggle = document.getElementById('modelToggle');
            if (modelToggle) {
                const modelName = currentModel === 'OpenAI' ? 'gpt-3.5-turbo' : 'deepseek-chat';
                modelToggle.textContent = `AI: ${currentModel} (${modelName})`;
                modelToggle.classList.toggle('active', currentModel === 'DeepSeek');
                modelToggle.addEventListener('click', updateAIModel);
            }

            initializeEditors();

            // Initialize transcript tabs
            initializeTranscriptTabs();

        } else {
            // Handle the error case
        }
    } catch (error) {
        console.error('Error in DOMContentLoaded:', error);
        alert('Failed to initialize the application. Please try again later.');
    }
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

        const response = await fetch(`${SERVER_URL}/newFunctionName`, {
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

        const response = await fetch(`${SERVER_URL}/newFunctionName`, {
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
                const tabId = anyPane.id.replace('pane', 'tab');
                const tab = document.getElementById(tabId);
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
            const response = await fetch(`${SERVER_URL}/generateTranscript`, {
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
                            const response = await fetch(`${SERVER_URL}/newFunctionName`, {
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
    
    // Add final event handler
    newTestBtn.addEventListener('click', function() {
        console.log("🔘 Test button clicked - Showing clinical issues popup");
        prepareClinicalIssuesAndShowPopup();
    });
    
    // Ensure generateFakeTranscript is available globally
    if (typeof window.generateFakeTranscript !== 'function' && typeof generateFakeTranscript === 'function') {
        window.generateFakeTranscript = generateFakeTranscript;
        console.log("Exposed generateFakeTranscript to window object in FINAL FIX");
    }
    
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
        
        console.log("Selected issue:", selectedIssue.value);
        console.log("Issue type:", selectedIssue.dataset.type);

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
            newPane.appendChild(textarea);
            
            // Add new elements to DOM
            newTabBtn.parentElement.insertBefore(newTab, newTabBtn);
            document.querySelector('.transcript-content').appendChild(newPane);
            
            // Activate the new tab
            newTab.click();
        });
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



