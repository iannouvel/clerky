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
                    headers: { 
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`  // Add the auth token
                    },
                    body: JSON.stringify({
                        prompt: "Create a fake transcript of a conversation between an obstetrician and a complex pregnant patient who has had at least 1 prior Caesarean section. Include clinical details, patient questions, and responses from the obstetrician."
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
            window.location.href = 'https://iannouvel.github.io/clerky/algos.html'; // Ensure this URL is correct
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
            
            // Hide all sections first
            mainSection.classList.add('hidden');
            promptsSection.classList.add('hidden');
            guidelinesSection.classList.add('hidden');
            linksSection.classList.add('hidden');
            
            // Show prompts section
            promptsSection.classList.remove('hidden');
            
            // Update active tab
            tabs.forEach(tab => {
                if (tab.dataset.tab === 'prompts') {
                    tab.classList.add('active');
                } else {
                    tab.classList.remove('active');
                }
            });
        });

        linksBtn.addEventListener('click', () => {
            // Toggle the visibility of the main section and links section
            mainSection.classList.toggle('hidden');
            linksSection.classList.toggle('hidden');
            loadLinks(); // Load the links when the links section is shown
        });

        guidelinesBtn.addEventListener('click', () => {
            // Open guidelines.html in the current window
            window.location.href = 'guidelines.html';
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
                generateText.textContent = 'Generate Clinical Note';
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
            
            // Validate input
            if (!summaryText) {
                alert('Please provide a summary text.');
                return;
            }

            // Show loading spinner
            actionSpinner.style.display = 'inline-block';
            actionText.style.display = 'none';

            try {
                // Get the current user's ID token
                const user = auth.currentUser;
                if (!user) {
                    throw new Error('Please sign in first');
                }
                const token = await user.getIdToken();

                // Step 1: Send the summary text to get a list of issues
                const issuesResponse = await fetch('https://clerky-uzni.onrender.com/handleIssues', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                    },
                    body: JSON.stringify({ 
                        prompt: `${prompts.issues.prompt}\n\n${summaryText}`
                    })
                });

                if (!issuesResponse.ok) {
                    const errorText = await issuesResponse.text();
                    throw new Error(`Error from server: ${errorText}`);
                }

                const issuesData = await issuesResponse.json();
                
                if (!issuesData.success) {
                    throw new Error(`Server error: ${issuesData.message}`);
                }

                // Clear previous content
                suggestedGuidelinesDiv.innerHTML = '';

                // Process each issue
                for (const issue of issuesData.issues) {
                    const issueDiv = document.createElement('div');
                    issueDiv.className = 'accordion-item';
                    
                    const issueTitle = document.createElement('h4');
                    issueTitle.className = 'accordion-header';
                    issueTitle.textContent = issue;
                    issueDiv.appendChild(issueTitle);

                    // Create content div for guidelines
                    const contentDiv = document.createElement('div');
                    contentDiv.className = 'accordion-content';

                    // Get guidelines for this issue
                    const guidelinesResponse = await fetch('https://clerky-uzni.onrender.com/handleGuidelines', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${token}`
                        },
                        body: JSON.stringify({
                            prompt: `${prompts.guidelines.prompt}\n\nIssue: ${issue}`,
                            filenames: filenames.slice(0, 50), // Limit to first 50 filenames
                            summaries: summaries.slice(0, 50).map(summary => 
                                typeof summary === 'string' 
                                    ? summary.substring(0, 100) 
                                    : Array.isArray(summary) 
                                        ? summary[0].substring(0, 100) 
                                        : ''
                            )
                        })
                    });

                    if (!guidelinesResponse.ok) {
                        throw new Error(`Error fetching guidelines: ${await guidelinesResponse.text()}`);
                    }

                    const guidelinesData = await guidelinesResponse.json();
                    
                    if (guidelinesData.success) {
                        const guidelinesUl = document.createElement('ul');
                        
                        guidelinesData.guidelines.forEach(guideline => {
                            const li = document.createElement('li');
                            const link = document.createElement('a');
                            
                            // Convert .txt filename to .pdf for the link
                            const pdfFilename = guideline.replace(/\.txt$/, '.pdf');
                            link.href = `https://raw.githubusercontent.com/iannouvel/clerky/main/guidance/${pdfFilename}`;
                            link.textContent = guideline.replace(/\.txt$/, '');
                            link.target = '_blank';
                            
                            li.appendChild(link);
                            guidelinesUl.appendChild(li);
                        });
                        
                        contentDiv.appendChild(guidelinesUl);
                    } else {
                        const noGuidelinesMsg = document.createElement('p');
                        noGuidelinesMsg.textContent = 'No relevant guidelines found.';
                        contentDiv.appendChild(noGuidelinesMsg);
                    }

                    issueDiv.appendChild(contentDiv);
                    suggestedGuidelinesDiv.appendChild(issueDiv);

                    // Add click handler for accordion
                    issueTitle.addEventListener('click', () => {
                        const isVisible = contentDiv.style.display === 'block';
                        contentDiv.style.display = isVisible ? 'none' : 'block';
                        issueTitle.classList.toggle('active', !isVisible);
                    });
                }

            } catch (error) {
                console.error('Error during handleAction:', error);
                alert('An error occurred while processing the action. Please try again.');
            } finally {
                // Hide spinner and restore button text
                actionSpinner.style.display = 'none';
                actionText.style.display = 'inline';
            }
        }
      
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
document.getElementById('summary').addEventListener('input', function() {
    document.getElementById('proformaSummary').value = this.value;
});

document.getElementById('proformaSummary').addEventListener('input', function() {
    document.getElementById('summary').value = this.value;
});

// Add this after the other DOM element declarations in the DOMContentLoaded event listener
const clerkyTitle = document.querySelector('.center-title');

// Update the clerky title click handler
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

// Add this function to get the current prompts
function getPrompts() {
    const savedPrompts = localStorage.getItem('prompts');
    if (savedPrompts) {
        return JSON.parse(savedPrompts);
    }
    return fetch('prompts.json').then(res => res.json());
}

// Then use it in your handlers
async function handleAction() {
    const prompts = await getPrompts();
    // Use prompts.issues.prompt for issues
    // Use prompts.guidelines.prompt for guidelines
    // Use prompts.clinicalNote.prompt for clinical notes
    // Replace {{text}} and {{guidelines}} placeholders as needed
}