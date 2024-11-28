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

document.addEventListener('DOMContentLoaded', function () {
    // Define common elements
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

        // Prepare the prompt for OpenAI
        const prompt = "Create a fake transcript of a conversation between an obstetrician and a complex pregnant patient. Include clinical details, patient questions, and responses from the obstetrician.";
    
        try {
            // Make a request to the server to get the transcript from OpenAI
            const response = await fetch('https://clerky-uzni.onrender.com/SendToAI', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ prompt })
            });
    
            if (!response.ok) {
                throw new Error('Network response was not ok ' + response.statusText);
            }
    
            const data = await response.json();
    
            if (data.success) {
                // Paste the generated transcript into the left column text field
                summaryTextarea.value = data.response;
            } else {
                console.error('Error generating fake transcript:', data.message);
            }
        } catch (error) {
            console.error('Error generating fake transcript:', error);
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

    promptsBtn.addEventListener('click', () => {
        // Toggle the visibility of the main section and prompts section
        mainSection.classList.toggle('hidden');
        promptsSection.classList.toggle('hidden');
    });

    linksBtn.addEventListener('click', () => {
        // Toggle the visibility of the main section and links section
        mainSection.classList.toggle('hidden');
        linksSection.classList.toggle('hidden');
        loadLinks(); // Load the links when the links section is shown
    });

    guidelinesBtn.addEventListener('click', () => {
        // Toggle visibility between the main section and the guidelines section
        mainSection.classList.add('hidden');
        promptsSection.classList.add('hidden');
        linksSection.classList.add('hidden');
        guidelinesSection.classList.remove('hidden');
        loadGuidelines(); // Load the guidelines when the guidelines section is shown
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
                    link.href = `https://github.com/iannouvel/clerky/raw/main/guidance/${formattedGuideline}`; // Set the URL
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

    async function generateClinicalNote() {
        // Generate a clinical note based on the summary entered by the user
        const text = summaryTextarea.value.trim(); // Get the text from the summary textarea
        if (text === '') { // If the text is empty, alert the user
            alert('Please enter text into the summary field.');
            return;
        }

        const prompt = `${promptNoteGenerator.value.trim()}\n\n${text}`; // Combine the note generator prompt and the summary

        spinner.style.display = 'inline-block'; // Show the spinner while processing
        generateText.textContent = 'Generating...'; // Change the button text to show that it's generating

        try {
            const response = await fetch('https://clerky-uzni.onrender.com/newFunctionName', { // POST request to the server
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }, // Set the request headers
                body: JSON.stringify({ prompt }) // Send the prompt data to the server
            });

            if (!response.ok) throw new Error('Network response was not ok ' + response.statusText); // Check for errors

            const data = await response.json(); // Parse the server response
            if (data.success) {
                clinicalNoteOutput.value = data.response; // Display the generated clinical note
            } else {
                console.error('Error:', data.message); // Log error if the server returns an error
            }
        } catch (error) {
            console.error('Error generating clinical note:', error); // Log error if fetching fails
        } finally {
            spinner.style.display = 'none'; // Hide the spinner after completion
            generateText.textContent = 'Generate Clinical Note'; // Reset the button text
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
    // Get the summary text from the textarea
    const summaryText = summaryTextarea.value.trim();

    // Validate the input
    if (!summaryText) {
        alert('Please provide a summary text.');
        return;
    }

    // Show loading spinner while the action is processed
    actionSpinner.style.display = 'inline-block';
    actionText.style.display = 'none';

    try {
        // Step 1: Send the summary text to get a list of issues
        const requestData = {
            prompt: `Please determine the significant clinical issues within the following clinical scenario. 
            For example, if the patient has a BMI of 45, return: 'Morbid obesity: BMI 45'. 
            Do not list risks, as this will be done by the user. Please only return the 'title' of the risk, rather than a sentence or paragraph of text.
            Provide the issues as a prioritized list, from most clinically important to least important.
        
            Here is the clinical transcript:
            
            ${summaryText}`
        };
        
        const response = await fetch('https://clerky-uzni.onrender.com/handleIssues', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestData)
        });

        if (!response.ok) {
            const errorMessage = await response.text();
            throw new Error(`Error from server: ${errorMessage}`);
        }

        const data = await response.json();

        if (data.success) {
            const issuesList = data.issues;

            // Clear previous content
            suggestedGuidelinesDiv.innerHTML = '';

            // Step 2: For each issue, send a request to get the most relevant guidelines
            for (const issue of issuesList) {
                const issueDiv = document.createElement('div');
                issueDiv.className = 'accordion-item';
                const issueTitle = document.createElement('h4');
                issueTitle.className = 'accordion-header';
                issueTitle.textContent = issue;
                issueDiv.appendChild(issueTitle);

                const linkedFilenamesSummaries = filenames.map((filename, index) => `${filename}: ${summaries[index]}`).join('\n');
                const prompt = `Please provide filenames of the 3 most relevant guidelines for the following issue:\n\n${issue}\n\nThe guidelines and their respective summaries are as follows:\n\n${linkedFilenamesSummaries}`;
                
                const requestData = {
                    prompt: prompt, 
                    filenames: filenames, 
                    summaries: summaries
                };
                
                // Log the full request data being sent to the server for debugging
                console.log("Request data being sent to the server:", JSON.stringify(requestData, null, 2));
                            
               const guidelineRequest = await fetch('https://clerky-uzni.onrender.com/handleGuidelines', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(requestData)
                });

                if (!guidelineRequest.ok) {
                    const errorMessage = await guidelineRequest.text();
                    throw new Error(`Error fetching guidelines for issue: ${issue}, ${errorMessage}`);
                }

                const guidelineData = await guidelineRequest.json();

                const contentDiv = document.createElement('div');
                contentDiv.className = 'accordion-content';
                const guidelinesUl = document.createElement('ul');

                if (guidelineData.success) {
                    const guidelines = guidelineData.guidelines;
                
                    guidelines.forEach(guideline => {
                        const listItem = document.createElement('li');
                        const link = document.createElement('a');
                        
                        // Construct the URL for the guideline file
                        link.href = `https://github.com/iannouvel/clerky/raw/main/guidance/${guideline}`;
                        link.textContent = guideline;
                        link.target = '_blank'; // Open the link in a new tab
                        
                        listItem.appendChild(link);
                        guidelinesUl.appendChild(listItem);
                    });
                
                    contentDiv.appendChild(guidelinesUl);
                } else {
                    const noGuidelinesLi = document.createElement('li');
                    noGuidelinesLi.textContent = 'No relevant guidelines found.';
                    guidelinesUl.appendChild(noGuidelinesLi);
                }

                issueDiv.appendChild(contentDiv);
                suggestedGuidelinesDiv.appendChild(issueDiv);

                // Toggle visibility of guideline content when the issue title is clicked
                issueTitle.addEventListener('click', () => {
                    const isVisible = contentDiv.style.display === 'block';
                    contentDiv.style.display = isVisible ? 'none' : 'block';
                    issueTitle.classList.toggle('active', !isVisible);
                });
            }
        } else {
            alert('Failed to fetch issues.');
        }
    } catch (error) {
        console.error('Error during handleAction:', error);
        alert('An error occurred while processing the action.');
    } finally {
        // Hide the spinner and show the button text again
        actionSpinner.style.display = 'none';
        actionText.style.display = 'inline';
    }
}
  
});
