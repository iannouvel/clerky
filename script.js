// Import Firebase instances from firebase-init.js
import { app, db, auth } from './firebase-init.js';
import { GoogleAuthProvider, signInWithPopup, onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import { getAnalytics } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-analytics.js';
import { doc, getDoc } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

// Initialize Analytics
const analytics = getAnalytics(app);

// Declare these variables at the top level of your script
let filenames = [];
let summaries = [];
let guidanceDataLoaded = false;

const SERVER_URL = 'https://clerky-uzni.onrender.com';

// Add these at the top level of your script

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

// Modified DOMContentLoaded event listener
document.addEventListener('DOMContentLoaded', async function() {
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
        const guidelinesBtn = document.getElementById('guidelinesBtn');
        const workflowsBtn = document.getElementById('workflowsBtn');
        const mainSection = document.getElementById('mainSection');
        const promptsSection = document.getElementById('promptsSection');
        const linksSection = document.getElementById('linksSection');
        const guidelinesSection = document.getElementById('guidelinesSection');
        const savePromptsBtn = document.getElementById('savePromptsBtn');
        const promptIssues = document.getElementById('promptIssues');
        const promptGuidelines = document.getElementById('promptGuidelines');
        const promptNoteGenerator = document.getElementById('promptNoteGenerator');
        const recordBtn = document.getElementById('recordBtn');
        const generateClinicalNoteBtn = document.getElementById('generateClinicalNoteBtn');
        const actionBtn = document.getElementById('actionBtn');
        const summaryTextarea = document.getElementById('summary');
        const spinner = document.getElementById('spinner');
        const generateText = document.getElementById('generateText');
        const actionSpinner = document.getElementById('actionSpinner');
        const actionText = document.getElementById('actionText');
        const suggestedGuidelinesDiv = document.getElementById('suggestedGuidelines');
        const exportBtn = document.getElementById('exportBtn');
        const guidelinesList = document.getElementById('guidelinesList');
        const landingPage = document.getElementById('landingPage');
        const mainContent = document.getElementById('mainContent');
        const algosBtn = document.getElementById('algosBtn');
        const recordSymbol = document.getElementById('recordSymbol');
        const googleSignInBtn = document.getElementById('googleSignInBtn');
        const signOutBtn = document.getElementById('signOutBtn');
        const testBtn = document.getElementById('testBtn');
        const proformaBtn = document.getElementById('proformaBtn');
        const threeColumnView = document.getElementById('threeColumnView');
        const proformaView = document.getElementById('proformaView');
      
        // Firebase Authentication Provider
        const provider = new GoogleAuthProvider();

        // Function to show main content and hide the landing page
        function showMainContent() {
            landingPage.classList.add('hidden');
            mainContent.classList.remove('hidden');
        }

        // Function to show landing page and hide the main content
        function showLandingPage() {
            landingPage.classList.remove('hidden');
            mainContent.classList.add('hidden');
        }

        // Handle Sign-In
        let isSigningIn = false; // Prevent multiple popups
        googleSignInBtn.addEventListener('click', async () => {
            if (isSigningIn) return; // Block multiple sign-in attempts
            isSigningIn = true;
        
            try {
                const result = await signInWithPopup(auth, provider);
                const user = result.user;
                showMainContent();
            } catch (error) {
                if (error.code === 'auth/popup-blocked') {
                } else if (error.code === 'auth/cancelled-popup-request') {
                } else {
                }
            } finally {
                isSigningIn = false; // Reset flag
            }
        });

        // Handle Sign-out
        let isSigningOut = false; // Prevent multiple sign-out attempts
        signOutBtn.addEventListener('click', async () => {
            if (isSigningOut) return; // Block multiple requests
            isSigningOut = true;
        
            try {
                await signOut(auth);
                showLandingPage(); // Transition to the landing page
            } catch (error) {
            } finally {
                isSigningOut = false; // Reset flag
            }
        });

        // Generate a fake transcript
        async function generateFakeTranscript() {
            const testSpinner = document.getElementById('testSpinner');
            const testText = document.getElementById('testText');
        
            // Show spinner and hide text
            testSpinner.style.display = 'inline-block';
            testText.style.display = 'none';
        
            try {
                // Get the current user's ID token
                const user = auth.currentUser;
                if (!user) {
                    throw new Error('Please sign in first');
                }
                const token = await user.getIdToken();

                const prompt = `Create a fictional dialogue between a healthcare professional and a patient. This dialogue is for testing purposes only and should include various topics that might be discussed in a healthcare setting. Please ensure the conversation is entirely fictional and does not provide any real medical advice or information. The transcript should cover 2-3 complex obstetric and/or gynecological issues. The clinician should ensure the patient is asked (if they don't offer) details like age, previous pregnancies, previous delivereies, BMI and their ideas, concerns and expectations following the consultation.`;

                const response = await fetch(`${SERVER_URL}/newFunctionName`, {
                    method: 'POST',
                    credentials: 'include',
                    headers: { 
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`,
                        'Accept': 'application/json'
                    },
                    body: JSON.stringify({ prompt })
                });

                if (!response.ok) {
                    const errorText = await response.text();
                    throw new Error(`Server error: ${errorText}`);
                }

                const data = await response.json();
                
                if (data.success) {
                    const summaryElement = document.getElementById('summary');
                    summaryElement.innerHTML = data.response; // Use innerHTML to render HTML content
                } else {
                    throw new Error(data.message || 'Failed to generate transcript');
                }
            } catch (error) {
                alert(error.message || 'Failed to generate transcript. Please try again.');
            } finally {
                // Hide spinner and restore text
                testSpinner.style.display = 'none';
                testText.style.display = 'inline-block';
            }
        }
        
        // Attach click event listener to the Test button
        testBtn.addEventListener('click', generateFakeTranscript);

      
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

                    console.log('Disclaimer accepted, showing main content');
                    // If disclaimer is accepted, show main content
                    userNameSpan.textContent = user.displayName;
                    userNameSpan.classList.remove('hidden');
                    showMainContent();
                    updateButtonVisibility(user);
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
                        summaryTextarea.textContent += transcript + "\n"; // Append the transcript
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

        async function generateClinicalNote() {
            const spinner = document.getElementById('spinner');
            const generateText = document.getElementById('generateText');

            // Show spinner and hide text
            spinner.style.display = 'inline-block';
            generateText.style.display = 'none';

            try {
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
                    let formattedResponse = data.response
                        .replace(/\n{3,}/g, '\n\n')
                        .trim();
                    if (clinicalNoteOutput) {
                        clinicalNoteOutput.innerHTML = formattedResponse.replace(/\n/g, '<br>');
                    }
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

        async function handleAction(retryCount = 0) {
            actionSpinner.style.display = 'inline-block';
            actionText.style.display = 'none';

            try {
                const user = auth.currentUser;
                if (!user) {
                    throw new Error('Please sign in first');
                }
                const token = await user.getIdToken();

                const prompts = await fetch('https://raw.githubusercontent.com/iannouvel/clerky/main/prompts.json').then(response => response.json());
                const summaryDiv = document.getElementById('summary'); // Access the content-editable div
                const summaryText = summaryDiv.textContent.trim(); // Use textContent for plain text

                if (!summaryText) {
                    alert('Please provide a summary text.');
                    return;
                }

                const issuesPrompt = `${prompts.issues.prompt}

Please identify and return a concise list of clinical issues, following these rules:
1. Merge any symptom/condition with its monitoring/management (e.g., "Anaemia" and "Iron level monitoring" should merge into "Anaemia")
2. Merge any related conditions (e.g., "Previous C-section" and "Potential need for C-section" should merge)
3. Keep medical terminology precise and concise
4. Include relevant context in the merged issue where appropriate
5. Return ONLY the final merged list, one issue per line

Clinical Summary:
${summaryText}`;

                const issuesResponse = await Promise.race([
                    fetch(`${SERVER_URL}/handleIssues`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${token}`,
                            'Accept': 'application/json'
                        },
                        body: JSON.stringify({ 
                            prompt: issuesPrompt
                        })
                    }),
                    new Promise((_, reject) => 
                        setTimeout(() => reject(new Error('Request timeout')), 10000)
                    )
                ]);

                const issuesData = await issuesResponse.json();

                if (!issuesData.success) {
                    throw new Error(`Server error: ${issuesData.message}`);
                }

                // Display the issues directly since they're already merged and formatted
                if (issuesData.success && issuesData.issues && issuesData.issues.length > 0) {
                    displayIssues(issuesData.issues, prompts);
                } else {
                    displayIssues(['No significant clinical issues identified'], prompts);
                }
            } catch (error) {
                // If we haven't exceeded max retries and it's a connection error, retry
                if (retryCount < MAX_RETRIES && 
                    (error.message.includes('Failed to fetch') || 
                     error.message.includes('Request timeout') ||
                     error.message.includes('Connection reset'))) {
                    // Wait for 2 seconds before retrying
                    await new Promise(resolve => setTimeout(resolve, 2000));
                    return handleAction(retryCount + 1);
                }
                
                // If we've exhausted retries or it's a different error, show the error
                alert(retryCount >= MAX_RETRIES ? 
                    'The server appears to be starting up. Please try again in a few moments.' :
                    'An error occurred while processing the action. Please try again.');
            } finally {
                actionSpinner.style.display = 'none';
                actionText.style.display = 'inline-block';
            }
        }

        // Add workflows button click handler
        if (workflowsBtn) {
            workflowsBtn.addEventListener('click', function() {
                window.open('workflows.html', '_blank');
            });
        }

        // Attach the handleAction function to the action button
        actionBtn.addEventListener('click', handleAction);

    } else {
        // Handle the error case
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
        threeColumnView.style.display = isProformaView ? 'none' : 'flex';
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
            let jsonStr = data.response;
            
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

// Add this helper function for date formatting
function formatDateLong(dateStr) {
    if (!dateStr) return '';
    
    const date = new Date(dateStr);
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    
    // Get day with ordinal suffix (1st, 2nd, 3rd, etc)
    const day = date.getDate();
    const suffix = getDayOrdinal(day);
    
    return `${day}${suffix} of ${months[date.getMonth()]}, ${date.getFullYear()}`;
}

// Helper function to get ordinal suffix for a day
function getDayOrdinal(day) {
    if (day > 3 && day < 21) return 'th';
    switch (day % 10) {
        case 1: return 'st';
        case 2: return 'nd';
        case 3: return 'rd';
        default: return 'th';
    }
}

// Update the setValue function
function setValue(id, value) {
    if (value === null || value === undefined) {
        return;
    }
    const element = document.getElementById(id);
    if (element) {
        // Handle date inputs specifically
        if (element.type === 'date' && value) {
            // Store the ISO date as the input value
            if (value.includes('/')) {
                const [day, month, year] = value.split('/');
                element.value = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
            } else {
                element.value = value;
            }
            
            // Add a span after the input to show the formatted date
            let displaySpan = element.nextElementSibling;
            if (!displaySpan || !displaySpan.classList.contains('date-display')) {
                displaySpan = document.createElement('span');
                displaySpan.classList.add('date-display');
                element.parentNode.insertBefore(displaySpan, element.nextSibling);
            }
            displaySpan.textContent = formatDateLong(element.value);
        } else {
            element.value = value;
        }
    } else {
    }
}

// Add this helper function to set current date and time
function setCurrentDateTime(type) {
    const now = new Date();
    const dateStr = now.toISOString().split('T')[0]; // YYYY-MM-DD
    const timeStr = now.toTimeString().slice(0,5);   // HH:MM
    
    const prefix = type === 'obstetric' ? 'obs' : 'gyn';
    setValue(`${prefix}-date`, dateStr);
    setValue(`${prefix}-time`, timeStr);
    return now;
}

// Update the calculateGestation function
function calculateGestation(eddStr, referenceDate = null) {
    if (!eddStr) return null;
    
    // Convert EDD string to Date object
    const edd = new Date(eddStr);
    
    // Use provided reference date or current date
    const reference = referenceDate || new Date();
    
    // Calculate conception date (40 weeks before EDD)
    const conceptionDate = new Date(edd);
    conceptionDate.setDate(conceptionDate.getDate() - 280);
    
    // Calculate days between conception and reference date
    const daysDifference = Math.floor((reference - conceptionDate) / (1000 * 60 * 60 * 24));
    
    // Calculate weeks and remaining days
    const weeks = Math.floor(daysDifference / 7);
    const days = daysDifference % 7;
    
    return `${weeks}+${days}`;
}

// Update the populateProformaFields function
function populateProformaFields(data, type) {
    
    if (type === 'obstetric') {
        
        // Demographics
        setValue('obs-name', data.demographics?.name);
        setValue('obs-age', data.demographics?.age);
        setValue('obs-hospital-no', data.demographics?.hospitalNo);
        
        // Set date and time - if not provided in data, use current
        let referenceDate;
        if (data.demographics?.date) {
            setValue('obs-date', data.demographics.date);
            setValue('obs-time', data.demographics.time || '00:00');
            referenceDate = new Date(data.demographics.date);
        } else {
            referenceDate = setCurrentDateTime(type);
        }
        
        // Obstetric History
        setValue('obs-gravida', data.obstetricHistory?.gravida);
        setValue('obs-para', data.obstetricHistory?.para);
        setValue('obs-edd', data.obstetricHistory?.edd);
        
        // Calculate and set gestation using the reference date
        if (data.obstetricHistory?.edd) {
            const gestation = calculateGestation(data.obstetricHistory.edd, referenceDate);
            setValue('obs-gestation', gestation);
        } else {
            setValue('obs-gestation', data.obstetricHistory?.gestation);
        }
        
        setValue('obs-prev-deliveries', data.obstetricHistory?.previousDeliveries);
        
        // Current Pregnancy
        setValue('obs-antenatal-care', data.currentPregnancy?.antenatalCare);
        setValue('obs-blood-group', data.currentPregnancy?.bloodGroup);
        setValue('obs-rhesus', data.currentPregnancy?.rhesus);
        setValue('obs-bmi', data.currentPregnancy?.bookingBMI);
        setValue('obs-complications', data.currentPregnancy?.complications);
        
        // Current Assessment
        setValue('obs-presenting-complaint', data.currentAssessment?.presentingComplaint);
        setValue('obs-contractions', data.currentAssessment?.contractions);
        setValue('obs-fetal-movements', data.currentAssessment?.fetalMovements);
        setValue('obs-vaginal-loss', data.currentAssessment?.vaginalLoss);
        
        // Examination
        setValue('obs-bp', data.examination?.bp);
        setValue('obs-pulse', data.examination?.pulse);
        setValue('obs-temp', data.examination?.temp);
        setValue('obs-fundal-height', data.examination?.fundalHeight);
        setValue('obs-lie', data.examination?.lie);
        setValue('obs-presentation', data.examination?.presentation);
        setValue('obs-fh', data.examination?.fh);
    } else {
        // Demographics
        setValue('gyn-name', data.demographics?.name);
        setValue('gyn-age', data.demographics?.age);
        setValue('gyn-hospital-no', data.demographics?.hospitalNo);
        setValue('gyn-date', data.demographics?.date);
        setValue('gyn-time', data.demographics?.time);
        
        // Presenting Complaint
        setValue('gyn-presenting-complaint', data.presentingComplaint);
        
        // Gynaecological History
        setValue('gyn-lmp', data.gynaecologicalHistory?.lmp);
        setValue('gyn-menstrual-cycle', data.gynaecologicalHistory?.menstrualCycle);
        setValue('gyn-contraception', data.gynaecologicalHistory?.contraception);
        setValue('gyn-previous-surgery', data.gynaecologicalHistory?.previousSurgery);
        
        // Obstetric History
        setValue('gyn-gravida', data.obstetricHistory?.gravida);
        setValue('gyn-para', data.obstetricHistory?.para);
        setValue('gyn-obstetric-details', data.obstetricHistory?.details);
        
        // Examination
        setValue('gyn-bp', data.examination?.bp);
        setValue('gyn-pulse', data.examination?.pulse);
        setValue('gyn-temp', data.examination?.temp);
        setValue('gyn-abdominal-exam', data.examination?.abdominalExam);
        setValue('gyn-vaginal-exam', data.examination?.vaginalExam);
    }
}

// Update the getPrompts function
async function getPrompts() {
    console.log('Fetching prompts from GitHub');
    try {
        const response = await fetch('https://raw.githubusercontent.com/iannouvel/clerky/main/prompts.json');
        if (!response.ok) {
            throw new Error(`Failed to fetch prompts.json from GitHub: ${response.statusText}`);
        }
        const defaultPrompts = await response.json();
        console.log('Fetched prompts from GitHub:', defaultPrompts);
        return defaultPrompts;
    } catch (error) {
        console.error('Error fetching prompts from GitHub:', error);
        // Fallback to a basic default structure if fetching fails
        return {
            issues: {
                title: "Issues Prompt",
                description: "Identifies clinical issues from the text",
                prompt: "Please analyze this clinical scenario and identify the major issues..."
            },
            guidelines: {
                title: "Guidelines Prompt",
                description: "Matches issues to relevant guidelines",
                prompt: "Please identify relevant guidelines for this issue..."
            },
            applyGuideline: {
                title: "Apply Guideline to Clinical Situation",
                description: "Used to apply a clinical guideline to a specific clinical situation",
                prompt: "I would like you to apply the attached clinical guideline to the following clinical situation.\n\nYour response should include the following, where appropriate:\n1. Further information needed - list what additional information is needed and why\n2. Proposed management according to the guideline\n3. Benefits of the proposed approach\n4. Risks of the proposed approach\n5. Alternative approaches\n\nGuideline:\n{{guideline}}\n\nClinical situation:\n{{situation}}"
            }
        };
    }
}

// Function to create and show popup
function showPopup(content) {
    // Create popup container
    const popup = document.createElement('div');
    popup.style.cssText = `
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: white;
        padding: 20px;
        border-radius: 8px;
        box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        max-width: 80%;
        max-height: 80vh;
        overflow-y: auto;
        z-index: 1000;
    `;

    // Create close button
    const closeButton = document.createElement('button');
    closeButton.textContent = '×';
    closeButton.style.cssText = `
        position: absolute;
        top: 10px;
        right: 10px;
        border: none;
        background: none;
        font-size: 24px;
        cursor: pointer;
        padding: 0;
        width: 30px;
        height: 30px;
        display: flex;
        align-items: center;
        justify-content: center;
    `;

    // Create overlay
    const overlay = document.createElement('div');
    overlay.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0,0,0,0.5);
        z-index: 999;
    `;

    // Create content container
    const contentDiv = document.createElement('div');
    contentDiv.style.marginTop = '20px';
    contentDiv.style.whiteSpace = 'pre-wrap';
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
async function findRelevantGuidelines(issue, prompts) {
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

    try {
        const user = auth.currentUser;
        if (!user) {
            throw new Error('Please sign in first');
        }
        const token = await user.getIdToken();
        
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

        const guidelinesData = await guidelinesResponse.json();
        console.log('Guidelines data parsed:', {
            success: guidelinesData.success,
            guidelinesCount: guidelinesData.guidelines?.length
        });
        
        return guidelinesData;
    } catch (error) {
        console.error('Error finding relevant guidelines:', error);
        throw error;
    }
}

// Update the displayIssues function to use findRelevantGuidelines
async function displayIssues(issues, prompts) {
    console.log('=== displayIssues ===');
    console.log('Input:', {
        issuesCount: issues?.length,
        hasPrompts: !!prompts,
        guidanceDataLoaded,
        filenamesCount: filenames.length,
        summariesCount: summaries.length
    });

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

    // Check if guidance data is loaded
    if (!guidanceDataLoaded || filenames.length === 0 || summaries.length === 0) {
        console.log('Guidance data not loaded, attempting to load...', {
            guidanceDataLoaded,
            filenamesLength: filenames.length,
            summariesLength: summaries.length
        });
        
        const loaded = await loadGuidelineSummaries();
        console.log('loadGuidelineSummaries result:', loaded);
        
        if (!loaded) {
            console.error('Failed to load guidance data');
            const errorDiv = document.createElement('div');
            errorDiv.className = 'error-message';
            errorDiv.textContent = 'Unable to load guidelines. Please refresh the page and try again.';
            suggestedGuidelinesDiv.appendChild(errorDiv);
            return;
        }
    }

    console.log('Processing issues:', issues);
    for (const issue of issues) {
        console.log('Processing issue:', issue);
        
        // Create issue container
        const issueDiv = document.createElement('div');
        issueDiv.className = 'accordion-item';
        issueDiv.style.textAlign = 'left';
        
        // Remove prefix hyphen if present
        const cleanIssue = issue.startsWith('-') ? issue.substring(1).trim() : issue;
        console.log('Cleaned issue:', cleanIssue);

        // Create issue header
        const issueTitle = document.createElement('h4');
        issueTitle.className = 'accordion-header';
        issueTitle.textContent = cleanIssue;
        issueTitle.contentEditable = true;
        issueDiv.appendChild(issueTitle);

        // Create content container
        const contentDiv = document.createElement('div');
        contentDiv.className = 'accordion-content';

        try {
            // Get relevant guidelines for this issue
            const guidelinesData = await findRelevantGuidelines(cleanIssue, prompts);
            
            if (guidelinesData.success && guidelinesData.guidelines) {
                // Create list for guidelines
                const guidelinesList = document.createElement('ul');
                guidelinesList.className = 'guidelines-list';

                // Add each guideline
                guidelinesData.guidelines.forEach((guideline, index) => {
                    console.log(`Processing guideline ${index + 1}:`, guideline);
                    // ... rest of the guideline processing code ...
                });

                contentDiv.appendChild(guidelinesList);
            }
        } catch (error) {
            console.error('Error processing guidelines for issue:', {
                issue: cleanIssue,
                error: error.message,
                type: error.name
            });
            const errorDiv = document.createElement('div');
            errorDiv.className = 'error-message';
            errorDiv.textContent = 'Error loading guidelines for this issue.';
            contentDiv.appendChild(errorDiv);
        }

        issueDiv.appendChild(contentDiv);
        suggestedGuidelinesDiv.appendChild(issueDiv);
        console.log('Issue div added to DOM:', cleanIssue);
    }
    console.log('=== displayIssues complete ===');
}

// ... existing code ...