// Import Firebase modules
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import { getAnalytics } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-analytics.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { getAuth, GoogleAuthProvider, signInWithPopup, onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';

// Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyCU4dfGi4vHg_ek-l2V0uksFCv1jL4KV_g",
  authDomain: "clerky-b3be8.firebaseapp.com",
  projectId: "clerky-b3be8",
  storageBucket: "clerky-b3be8.firebasestorage.app",
  messagingSenderId: "193460924609",
  appId: "1:193460924609:web:6e2c696c87292d4a222440",
  measurementId: "G-V07DP1ELDR"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);
const db = getFirestore(app);
const auth = getAuth(app);

// Declare these variables at the top level of your script
let filenames = [];
let summaries = [];
let guidanceDataLoaded = false;

// Add these at the top level of your script
console.log('Initial filenames and summaries:', { filenames, summaries });

// Function to load guidance data
async function loadGuidanceData() {
    console.log('Starting loadGuidanceData');
    try {
        const response = await fetch('https://raw.githubusercontent.com/iannouvel/clerky/main/guidance/summary/list_of_summaries.json');
        console.log('Response from guidance data fetch:', response);
        if (!response.ok) {
            throw new Error('Network response was not ok ' + response.statusText);
        }
        const data = await response.json();
        console.log('Parsed guidance data:', data);
        
        // Store the data
        filenames = Object.keys(data);
        summaries = Object.values(data);
        
        guidanceDataLoaded = true;
        console.log('After loading guidance data:', {
            filenamesCount: filenames.length,
            summariesCount: summaries.length,
            sampleFilenames: filenames.slice(0, 3)
        });
        return true;
    } catch (error) {
        console.error('Error loading guidance data:', error);
        return false;
    }
}

// Modified DOMContentLoaded event listener
document.addEventListener('DOMContentLoaded', async function() {
    console.log('DOMContentLoaded event fired');
    const loaded = await loadGuidanceData();
    
    if (loaded) {
        console.log('Guidance data loaded successfully');
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
        const clinicalNoteOutput = document.getElementById('clinicalNoteOutput');
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
                console.log(`Signed in as ${user.displayName}`);
                showMainContent();
            } catch (error) {
                if (error.code === 'auth/popup-blocked') {
                    console.error('Popup blocked. Please allow pop-ups for this site.');
                } else if (error.code === 'auth/cancelled-popup-request') {
                    console.warn('Sign-in request cancelled due to another ongoing request.');
                } else {
                    console.error('Error signing in:', error.message);
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
                console.log('User signed out.');
                showLandingPage(); // Transition to the landing page
            } catch (error) {
                console.error('Error signing out:', error.message);
            } finally {
                isSigningOut = false; // Reset flag
            }
        });

        // Generate a fake transcript
        async function generateFakeTranscript() {
            const testSpinner = document.getElementById('testSpinner');
            const testText = document.getElementById('testText');
        
            // Show spinner and change text to indicate loading
            testSpinner.style.display = 'inline-block';
            testText.style.display = 'none';
        
            try {
                // Get the current user's ID token
                const user = auth.currentUser;
                if (!user) {
                    throw new Error('Please sign in first');
                }
                const token = await user.getIdToken();

                const response = await fetch('https://clerky-uzni.onrender.com/newFunctionName', {
                    method: 'POST',
                    credentials: 'include',
                    headers: { 
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`,
                        'Accept': 'application/json'
                    },
                    body: JSON.stringify({
                        prompt: "Create a fake transcript of a conversation between an obstetrician and a complex pregnant patient who has had at least 1 prior Caesarean section and a number of other issues like obesity and anaemia. Include clinical details, patient questions, and responses from the obstetrician."
                    })
                });

                if (!response.ok) {
                    const errorText = await response.text();
                    throw new Error(`Server error: ${errorText}`);
                }

                const data = await response.json();
                
                if (data.success) {
                    summaryTextarea.value = data.response;
                } else {
                    throw new Error(data.message || 'Failed to generate transcript');
                }
            } catch (error) {
                console.error('Error generating fake transcript:', error);
                alert(error.message || 'Failed to generate transcript. Please try again.');
            } finally {
                // Hide spinner and restore text
                testSpinner.style.display = 'none';
                testText.style.display = 'inline-block';
            }
        }
        
        // Attach click event listener to the Test button
        testBtn.addEventListener('click', generateFakeTranscript);

      
        // Function to handle UI based on user state
        function updateUI(user) {
            loadingDiv.classList.add('hidden'); // Hide the loading indicator once auth state is determined
            if (user) {
                console.log('User is signed in:', user);
                showMainContent();
                userNameSpan.textContent = user.displayName;
                userNameSpan.classList.remove('hidden');

                // Attach click listener for sign-out only if not already attached
                if (!userNameSpan.hasAttribute('data-listener-added')) {
                    userNameSpan.addEventListener('click', async () => {
                        try {
                            await signOut(auth);
                            console.log('User signed out.');
                            showLandingPage(); // Ensure we hide the main content when user signs out
                        } catch (error) {
                            console.error('Error signing out:', error.message);
                        }
                    });
                    userNameSpan.setAttribute('data-listener-added', 'true');
                }
            } else {
                console.log('No user is signed in.');
                showLandingPage();
                userNameSpan.classList.add('hidden');
            }
        }

        // Initial check of the auth state
        updateUI(auth.currentUser);

        // Register `onAuthStateChanged` listener to handle future auth state changes
        onAuthStateChanged(auth, updateUI);

        // Attach click listener for algos button
        algosBtn.addEventListener('click', function () {
            window.open('https://iannouvel.github.io/clerky/algos.html', '_blank'); // Open in new tab
        });

        // Speech Recognition functionality
        if (window.SpeechRecognition || window.webkitSpeechRecognition) {
            const recognition = new (window.SpeechRecognition || window.webkitSpeechRecognition)();
            recognition.lang = 'en-US';
            recognition.interimResults = true;
            recognition.continuous = true;
            recognition.maxAlternatives = 1;
            let recording = false;

            recordBtn.addEventListener('click', function () {
                console.log("Record button clicked.");
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

            recognition.onstart = () => console.log('Speech recognition started');
            recognition.onend = () => {
                if (recording) {
                    recognition.start();
                } else {
                    console.log('Speech recognition stopped');
                    recordSymbol.textContent = ""; // Reset recording symbol when stopped
                }
            };

            recognition.onresult = (event) => {
                const transcript = event.results[event.resultIndex][0].transcript;
                if (event.results[event.resultIndex].isFinal) {
                    summaryTextarea.value += transcript + "\n"; // Append the transcript
                } else {
                    console.log('Interim result:', transcript);
                }
            };

            recognition.onerror = (event) => console.error('Speech recognition error:', event.error);
        } else {
            console.error('Speech Recognition is not supported in this browser.');
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
                // console.log('Filenames:', filenames);
                // console.log('Summaries:', summaries);
        
                // If you want to process them together:
                filenames.forEach(filename => {
                    const summary = data[filename];
                    // console.log(`Filename: ${filename}`);
                    // console.log(`Summary: ${summary}`);
                });
            })
            .catch(error => {
                console.error('Error fetching summaries:', error);
            });
        
        function loadPrompts() {
            // Try loading saved prompts data into the respective text areas
            try {
                promptIssues.value = promptsData.promptIssues || document.getElementById('promptIssues').defaultValue; // Load issues
                promptGuidelines.value = promptsData.promptGuidelines || document.getElementById('promptGuidelines').defaultValue; // Load guidelines
                promptNoteGenerator.value = promptsData.promptNoteGenerator || document.getElementById('promptNoteGenerator').defaultValue; // Load note generator prompt
            } catch (error) {
                console.error('Error loading prompts:', error); // Log error if loading fails
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
                console.error('Error saving prompts:', error); // Log error if saving fails
            }
        }

        savePromptsBtn.addEventListener('click', savePrompts); // Attach the savePrompts function to the save button

        // Select all tabs
        const tabs = document.querySelectorAll('.tab');

        // Handle prompts button click
        promptsBtn.addEventListener('click', () => {
            console.log('Prompts button clicked');
            window.open('prompts.html', '_blank');
        });

        linksBtn.addEventListener('click', () => {
            // Toggle the visibility of the main section and links section
            mainSection.classList.toggle('hidden');
            linksSection.classList.toggle('hidden');
            loadLinks(); // Load the links when the links section is shown
        });

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
                console.error('Error loading links:', error); // Log error if loading links fails
            }
        }

        async function loadGuidelines() {
            // Load guidelines from a remote file and display them in the UI
            guidelinesList.innerHTML = ''; // Clear existing guidelines

            fetch('https://raw.githubusercontent.com/iannouvel/clerky/main/list_of_guidelines.txt')
                .then(response => response.text()) // Get the text response
                .then(data => {
                    const guidelines = data.split('\n').filter(line => line.trim() !== ''); // Filter non-empty lines
                    guidelines.forEach(guideline => {
                        const listItem = document.createElement('li'); // Create a list item
                        const link = document.createElement('a'); // Create an anchor tag
                        const formattedGuideline = guideline.trim(); // Clean up the guideline text
                        const pdfGuideline = formattedGuideline.replace(/\.txt$/i, '.pdf'); // Convert txt to pdf
                        link.href = `https://github.com/iannouvel/clerky/raw/main/guidance/${pdfGuideline}`; // Set the URL
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
                .catch(error => console.error('Error loading guidelines:', error)); // Log error if loading guidelines fails
        }

        // Add this helper function to collect proforma data
        function collectProformaData() {
            const obsProforma = document.getElementById('obsProforma');
            const gynProforma = document.getElementById('gynProforma');
            
            if (!obsProforma || !gynProforma) {
                console.log('Proforma elements not found, skipping proforma data collection');
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
            const text = summaryTextarea.value.trim();
            if (text === '') {
                alert('Please enter text into the summary field.');
                return;
            }

            spinner.style.display = 'inline-block';
            generateText.textContent = 'Generating...';

            try {
                // Get the current user's ID token
                const user = auth.currentUser;
                if (!user) {
                    throw new Error('Please sign in first');
                }
                const token = await user.getIdToken();

                // Collect proforma data if available
                const proformaData = collectProformaData();
                
                // Start with the base prompt from promptNoteGenerator
                let enhancedPrompt = `${promptNoteGenerator.value.trim()}\n\n`;

                // Add proforma data if it exists
                if (proformaData.fields && Object.keys(proformaData.fields).length > 0) {
                    enhancedPrompt += `Additional information from the ${proformaData.type} proforma:\n`;
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
                    enhancedPrompt += '\nTranscript:\n';
                }
                
                enhancedPrompt += text;

                const response = await fetch('https://clerky-uzni.onrender.com/newFunctionName', {
                    method: 'POST',
                    headers: { 
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`  // Add the auth token
                    },
                    body: JSON.stringify({ 
                        prompt: enhancedPrompt,
                        temperature: 0.3,
                        max_tokens: 1000,
                        stop: ["\n\n\n"],
                        presence_penalty: 0.1,
                        frequency_penalty: 0.1
                    })
                });

                if (!response.ok) {
                    const errorText = await response.text();
                    throw new Error(`Server error: ${errorText}`);
                }

                const data = await response.json();
                if (data.success) {
                    // Post-process the response to ensure correct formatting
                    let formattedResponse = data.response
                        .replace(/\n{3,}/g, '\n\n') // Remove excessive newlines
                        .trim();
                    
                    clinicalNoteOutput.value = formattedResponse;
                } else {
                    throw new Error(data.message || 'Failed to generate note');
                }
            } catch (error) {
                console.error('Error generating clinical note:', error);
                alert(error.message || 'Failed to generate clinical note. Please try again.');
            } finally {
                spinner.style.display = 'none';
                generateText.textContent = 'Note';
            }
        }

        generateClinicalNoteBtn.addEventListener('click', generateClinicalNote); // Attach the function to the generate button

        actionBtn.addEventListener('click', handleAction); // Attach the handleAction function to the action button

        async function getAIResponse(requestData) {
            // Function to fetch AI response from the server
            try {
                const response = await fetch('https://clerky-uzni.onrender.com/SendToAI', { // POST request to the AI server
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' }, // Set the request headers
                    body: JSON.stringify(requestData) // Send the request data to the server
                });
                
                console.log('Raw AI Response:', response); // Log the raw server response

                if (!response.ok) { // If response status is not ok, throw an error
                    const errorMessage = await response.text(); // Get the error message
                    throw new Error(`Error from server: ${errorMessage}`); // Throw an error with the message
                }

                const data = await response.json(); // Parse the server response
                console.log('Parsed AI Response:', data); // Log the parsed response

                return data; // Return the parsed response data
            } catch (error) {
                console.error('Error fetching AI response:', error); // Log error if fetching fails
                return { response: '' };  // Return an empty response in case of error
            }
        }

        // Function to retrieve guidelines for a specific issue using AI
        async function getGuidelinesForIssue(issue) {
            try {

               const prompt = `Please provide filenames of the 3 most relevant guidelines for the following issue:\n\n${issue}`;
                const requestData = {
                    prompt: prompt, 
                    filenames: filenames, // Pass the list of guideline filenames
                    summaries: summaries  // Pass the list of guideline summaries
                };
            
                // Log the full request data being sent to the server for debugging
                console.log("Request data being sent to the server:", JSON.stringify(requestData, null, 2));
                
                // Send the prompt to the AI service and get the response
                const response = await SendToOpenAI({ requestData });

                // Split the response into individual guidelines and clean up the list
                const guidelinesList = response.response
                    .split('\n')
                    .map(guideline => guideline.replace(/^\d+\.\s*/, '').trim()) // Remove numbering
                    .filter(guideline => guideline); // Filter out empty guidelines

                return guidelinesList; // Return the cleaned-up list of guidelines
            } catch (error) {
                console.error('Error retrieving guidelines:', error); // Log error if fetching fails
                return []; // Return an empty array in case of error
            }
        }

        // Function to send a request to the AI service
        async function SendToOpenAI(requestData) {
            const response = await fetch('https://clerky-uzni.onrender.com/SendToAI', { // POST request to the AI server
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json' // Set the request headers
                },
                body: JSON.stringify(requestData) // Send the request data to the server
            });

            if (!response.ok) { // If response status is not ok, throw an error
                const errorDetails = await response.json(); // Parse the error details
                throw new Error(`Error: ${errorDetails.message}`); // Throw an error with the message
            }

            return await response.json(); // Return the parsed response
        }

        // Function to format the data for the prompt
        function formatData(filenames, summaries, summaryText) {
            let formattedData = ''; // Initialize an empty string for formatted data
            for (let i = 0; i < filenames.length; i++) {
                formattedData += `${filenames[i]}: ${summaries[i].join(', ')}\n`; // Add filenames and summaries to the string
            }
            formattedData += `\nSummary Text: ${summaryText}\n`; // Add the summary text
            return formattedData; // Return the formatted string
        }

        async function handleAction() {
            const prompts = await getPrompts();
            const summaryText = summaryTextarea.value.trim();
            
            console.log('=== Starting handleAction ===');
            console.log('Summary Text:', summaryText);
            console.log('Prompts Data:', prompts);

            if (!summaryText) {
                alert('Please provide a summary text.');
                return;
            }

            actionSpinner.style.display = 'inline-block';
            actionText.style.display = 'none';

            try {
                const user = auth.currentUser;
                if (!user) {
                    throw new Error('Please sign in first');
                }
                const token = await user.getIdToken();

                const issuesPrompt = `${prompts.issues.prompt}\n\n${summaryText}`;
                console.log('=== Complete Issues Request ===');
                console.log('Full prompt being sent:', issuesPrompt);

                const issuesResponse = await fetch('https://clerky-uzni.onrender.com/handleIssues', {
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

                const issuesData = await issuesResponse.json();
                console.log('Processed issues response:', issuesData);

                if (!issuesData.success) {
                    throw new Error(`Server error: ${issuesData.message}`);
                }

                // Add the additional step to merge similar issues
                if (issuesData.success && issuesData.issues && issuesData.issues.length > 0) {
                    console.log('Initial issues:', issuesData.issues);
                    
                    // Send for merging only if there are multiple issues
                    if (issuesData.issues.length > 1) {
                        console.log('Sending issues for merging check...');
                        const mergePrompt = `Please check if any of these clinical issues can be merged into a single issue to avoid duplication. Return ONLY the final list of issues, with one issue per line. If no merging is needed, return the original list unchanged.

Issues:
${issuesData.issues.join('\n')}`;

                        const mergeResponse = await fetch('https://clerky-uzni.onrender.com/handleIssues', {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                'Authorization': `Bearer ${token}`,
                                'Accept': 'application/json'
                            },
                            body: JSON.stringify({ 
                                prompt: mergePrompt
                            })
                        });

                        const mergedIssuesData = await mergeResponse.json();
                        console.log('Merged issues response:', mergedIssuesData);

                        if (mergedIssuesData.success && mergedIssuesData.issues && mergedIssuesData.issues.length > 0) {
                            // Clean up the issues list
                            issuesData.issues = mergedIssuesData.issues
                                .filter(issue => 
                                    issue.trim().length > 0 &&
                                    !issue.toLowerCase().includes('original list unchanged') &&
                                    !issue.toLowerCase().includes('no merging needed')
                                )
                                .map(issue => issue.trim());
                        }
                    }
                    
                    console.log('Final issues after processing:', issuesData.issues);
                }

                // Clear the suggestions div
                const suggestedGuidelinesDiv = document.getElementById('suggestedGuidelines');
                suggestedGuidelinesDiv.innerHTML = '';

                // Check if there are any issues
                if (!issuesData.issues || issuesData.issues.length === 0) {
                    const noIssuesDiv = document.createElement('div');
                    noIssuesDiv.textContent = 'No clinical issues identified.';
                    suggestedGuidelinesDiv.appendChild(noIssuesDiv);
                    return;
                }

                // Process each issue
                for (const issue of issuesData.issues) {
                    console.log('Processing issue:', issue);
                    
                    // Create issue container
                    const issueDiv = document.createElement('div');
                    issueDiv.className = 'accordion-item';
                    
                    // Create issue header
                    const issueTitle = document.createElement('h4');
                    issueTitle.className = 'accordion-header';
                    issueTitle.textContent = issue;
                    issueDiv.appendChild(issueTitle);

                    // Create content container
                    const contentDiv = document.createElement('div');
                    contentDiv.className = 'accordion-content';

                    // Get guidelines for this issue
                    const guidelinesPrompt = prompts.guidelines.prompt
                        .replace('{{text}}', issue)
                        .replace('{{guidelines}}', filenames.map((filename, i) => `${filename}: ${summaries[i]}`).join('\n'));
                    
                    const guidelinesRequestData = {
                        prompt: guidelinesPrompt,
                        filenames: filenames,
                        summaries: summaries
                    };

                    const guidelinesResponse = await fetch('https://clerky-uzni.onrender.com/handleGuidelines', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${token}`
                        },
                        body: JSON.stringify(guidelinesRequestData)
                    });

                    const guidelinesData = await guidelinesResponse.json();
                    
                    if (guidelinesData.success && guidelinesData.guidelines) {
                        // Create list for guidelines
                        const guidelinesList = document.createElement('ul');
                        guidelinesList.className = 'guidelines-list';

                        // Add each guideline
                        guidelinesData.guidelines.forEach(guideline => {
                            const li = document.createElement('li');
                            
                            // Create PDF link
                            const pdfLink = document.createElement('a');
                            pdfLink.href = `https://github.com/iannouvel/clerky/raw/main/guidance/${guideline}`;
                            pdfLink.textContent = 'View PDF';
                            pdfLink.target = '_blank';
                            pdfLink.className = 'guideline-link';
                            
                            // Create Algo link
                            const algoLink = document.createElement('a');
                            const htmlFilename = guideline.replace(/\.pdf$/i, '.html');
                            algoLink.href = `https://iannouvel.github.io/clerky/algos/${htmlFilename}`;
                            algoLink.textContent = 'View Algo';
                            algoLink.target = '_blank';
                            algoLink.className = 'guideline-link';
                            
                            // Add guideline name and links
                            li.textContent = guideline.replace(/\.(txt|pdf)$/i, '') + ' - ';
                            li.appendChild(pdfLink);
                            li.appendChild(document.createTextNode(' | '));
                            li.appendChild(algoLink);
                            
                            guidelinesList.appendChild(li);
                        });

                        contentDiv.appendChild(guidelinesList);
                    }

                    issueDiv.appendChild(contentDiv);
                    suggestedGuidelinesDiv.appendChild(issueDiv);
                    console.log('Added issue to DOM:', {
                        issueText: issue,
                        currentHTML: suggestedGuidelinesDiv.innerHTML
                    });

                    // Add click handler for accordion
                    issueTitle.addEventListener('click', () => {
                        contentDiv.style.display = contentDiv.style.display === 'none' ? 'block' : 'none';
                        issueTitle.classList.toggle('active');
                    });
                    
                    // Initially hide the content
                    contentDiv.style.display = 'none';
                }
            } catch (error) {
                console.error('Error during handleAction:', error);
                alert('An error occurred while processing the action. Please try again.');
            } finally {
                actionSpinner.style.display = 'none';
                actionText.style.display = 'inline';
            }
        }
      
        // Add workflows button click handler
        workflowsBtn.addEventListener('click', function() {
            console.log('Workflows button clicked');
            window.open('workflows.html', '_blank');
        });
      
    } else {
        console.error('Failed to load guidance data');
        // Handle the error case
    }
});

// Add this after the other button declarations in the DOMContentLoaded event listener
const proformaBtn = document.getElementById('proformaBtn');
const threeColumnView = document.getElementById('threeColumnView');
const proformaView = document.getElementById('proformaView');

// Add this to the event listener section
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
    console.log('Starting populate with transcript:', transcript.substring(0, 100) + '...'); // Log first 100 chars of transcript

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
        console.log('Proforma type:', proformaType);
        
        const prompt = `Please extract relevant information from the following clinical transcript to populate a ${proformaType} proforma. 
        Return ONLY a JSON object (no markdown, no code blocks) with the following structure:
        ${getProformaStructure(proformaType)}
        
        Only include fields where information is available in the transcript. Use null for missing values.
        
        Transcript:
        ${transcript}`;

        console.log('Sending request to API...');
        const response = await fetch('https://clerky-uzni.onrender.com/newFunctionName', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt })
        });

        console.log('API response status:', response.status);
        if (!response.ok) {
            throw new Error('Failed to get AI response');
        }

        const data = await response.json();
        console.log('API response data:', data);

        if (data.success) {
            let jsonStr = data.response;
            console.log('Raw response string:', jsonStr);
            
            jsonStr = jsonStr.replace(/```json\n?/g, '');
            jsonStr = jsonStr.replace(/```\n?/g, '');
            jsonStr = jsonStr.trim();
            
            console.log('Cleaned JSON string:', jsonStr);
            
            const proformaData = JSON.parse(jsonStr);
            console.log('Parsed proforma data:', proformaData);
            
            populateProformaFields(proformaData, proformaType);
        } else {
            throw new Error(data.message || 'Failed to process response');
        }
    } catch (error) {
        console.error('Error populating proforma:', error);
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
        console.log(`Skipping null/undefined value for id: ${id}`);
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
            console.log(`Setting value for ${id}:`, value);
            element.value = value;
        }
    } else {
        console.warn(`Element not found for id: ${id}`);
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
    console.log(`Starting to populate ${type} proforma with data:`, data);
    
    if (type === 'obstetric') {
        console.log('Populating obstetric fields...');
        
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
        console.log('Populating gynaecology fields...');
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
    // First try to get prompts from localStorage
    const savedPrompts = localStorage.getItem('prompts');
    if (savedPrompts) {
        console.log('Using saved prompts from localStorage');
        return JSON.parse(savedPrompts);
    }

    // If no saved prompts, fetch from prompts.json
    try {
        console.log('Fetching default prompts from prompts.json');
        const response = await fetch('prompts.json');
        const defaultPrompts = await response.json();
        return defaultPrompts;
    } catch (error) {
        console.error('Error loading prompts:', error);
        // Return a basic default structure if all else fails
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
            }
        };
    }
}

// Then use it in your handlers
async function handleAction() {
    const prompts = await getPrompts();
    // Use prompts.issues.prompt for issues
    // Use prompts.guidelines.prompt for guidelines
    // Use prompts.clinicalNote.prompt for clinical notes
    // Replace {{text}} and {{guidelines}} placeholders as needed
}

// Workflow Functions
async function triggerGitHubWorkflow(workflowId) {
    try {
        // Get the current user's ID token for server authentication
        const user = auth.currentUser;
        if (!user) {
            throw new Error('Please sign in first');
        }
        const token = await user.getIdToken();

        const response = await fetch('https://clerky-uzni.onrender.com/triggerWorkflow', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
                workflowId: workflowId
            })
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        updateWorkflowStatus(`Workflow ${workflowId} triggered successfully!`);
    } catch (error) {
        console.error('Error triggering workflow:', error);
        updateWorkflowStatus(`Error: ${error.message}`);
    }
}

function updateWorkflowStatus(message) {
    const statusElement = document.getElementById('workflowStatus');
    statusElement.textContent = message;
}

function setSpinnerState(buttonId, isLoading) {
    const button = document.getElementById(buttonId);
    const spinner = button.querySelector('.spinner');
    button.disabled = isLoading;
    spinner.style.display = isLoading ? 'inline-block' : 'none';
}

// Event Listeners for Workflow Buttons
document.getElementById('processPdfBtn').addEventListener('click', async () => {
    setSpinnerState('processPdfBtn', true);
    await triggerGitHubWorkflow('1_process_new_pdf.yml');
    setSpinnerState('processPdfBtn', false);
});

document.getElementById('extractTermsBtn').addEventListener('click', async () => {
    setSpinnerState('extractTermsBtn', true);
    await triggerGitHubWorkflow('2_extract_terms.yml');
    setSpinnerState('extractTermsBtn', false);
});

document.getElementById('generateSummaryBtn').addEventListener('click', async () => {
    setSpinnerState('generateSummaryBtn', true);
    await triggerGitHubWorkflow('3_generate_summary.yml');
    setSpinnerState('generateSummaryBtn', false);
});

// Add workflow tab to the existing tab handling
document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
        const tabName = tab.getAttribute('data-tab');
        if (tabName === 'workflows') {
            document.getElementById('workflowsView').classList.remove('hidden');
            document.getElementById('threeColumnView').classList.add('hidden');
            document.getElementById('proformaView').classList.add('hidden');
        }
    });
});

// Add this to your test button click handler
testBtn.addEventListener('click', generateFakeTranscript);

// Add workflows button click handler
document.getElementById('workflowsBtn').addEventListener('click', function() {
    console.log('Workflows button clicked');
    window.open('workflows.html', '_blank');
});

// Remove the old tab handling for workflows since we're using a separate page now
document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
        const tabName = tab.getAttribute('data-tab');
        
        // Update active tab state
        document.querySelectorAll('.tab').forEach(t => {
            t.classList.remove('active');
        });
        tab.classList.add('active');
        
        // Show the appropriate view
        if (tabName === 'main') {
            document.getElementById('threeColumnView').style.display = 'flex';
        }
    });
});