document.addEventListener('DOMContentLoaded', function() {
    // Get the SpeechRecognition object from the browser (for voice recognition, if needed)
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition; 
    const recognition = new SpeechRecognition(); // Initialize the speech recognition object
    const promptsBtn = document.getElementById('promptsBtn'); // Button to show the prompts section
    const linksBtn = document.getElementById('linksBtn'); // Button to show the links section
    const guidelinesBtn = document.getElementById('guidelinesBtn'); // Button to show the guidelines section
    const mainSection = document.getElementById('mainSection'); // Main content section
    const promptsSection = document.getElementById('promptsSection'); // Section for prompts
    const linksSection = document.getElementById('linksSection'); // Section for links
    const guidelinesSection = document.getElementById('guidelinesSection'); // Section for guidelines
    const savePromptsBtn = document.getElementById('savePromptsBtn'); // Button to save prompts
    const promptIssues = document.getElementById('promptIssues'); // Text area for issues
    const promptGuidelines = document.getElementById('promptGuidelines'); // Text area for guidelines
    const promptNoteGenerator = document.getElementById('promptNoteGenerator'); // Input for note generator prompt
    const recordBtn = document.getElementById('recordBtn'); // Button for recording (if using voice input)
    const generateClinicalNoteBtn = document.getElementById('generateClinicalNoteBtn'); // Button to generate clinical note
    const actionBtn = document.getElementById('actionBtn'); // Button to handle specific AI action
    const summaryTextarea = document.getElementById('summary'); // Text area where summary is entered
    const clinicalNoteOutput = document.getElementById('clinicalNoteOutput'); // Output area for generated clinical notes
    const spinner = document.getElementById('spinner'); // Spinner to show loading state
    const generateText = document.getElementById('generateText'); // Text next to the spinner while generating
    const actionSpinner = document.getElementById('actionSpinner'); // Spinner for action button during processing
    const actionText = document.getElementById('actionText'); // Text displayed on the action button
    const suggestedGuidelinesDiv = document.getElementById('suggestedGuidelines'); // Div to display suggested guidelines
    const exportBtn = document.getElementById('exportBtn'); // Button to export data
    const guidelinesList = document.getElementById('guidelinesList'); // List of guidelines

    document.getElementById('algosBtn').addEventListener('click', function() {
        // Redirect to algorithms page when the algorithms button is clicked
        window.location.href = 'https://iannouvel.github.io/clerky/algos.html'; // Ensure this URL is correct
    });
    
    let recording = false; // Variable to keep track of recording state (for speech input)
    let promptsData = JSON.parse(localStorage.getItem('promptsData')) || {}; // Retrieve saved prompts data from local storage

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
            const response = await fetch('http://localhost:3000/newFunctionName', { // POST request to the server
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
            const response = await fetch('http://localhost:3000/SendToAI', { // POST request to the AI server
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
            // Format the prompt using significant terms data
            const prompt = `${promptGuidelines.value.trim()}\n\n${formatData(filenames, keywords, issue)}\n\nClinical Text: ${issue}`;
            
            // Send the prompt to the AI service and get the response
            const response = await SendToOpenAI({ prompt });

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
        const response = await fetch('http://localhost:3000/SendToAI', { // POST request to the AI server
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
    
    let filenames = []; // Array to hold filenames for significant terms
    let keywords = []; // Array to hold keywords for significant terms

    // Fetch significant terms data from a remote JSON file
    fetch('https://raw.githubusercontent.com/iannouvel/clerky/main/significant_terms.json')
        .then(response => {
            if (!response.ok) { // Check for network errors
                throw new Error('Network response was not ok ' + response.statusText);
            }
            return response.json(); // Parse the response as JSON
        })
        .then(data => {
            filenames = Object.keys(data); // Extract filenames from the data
            keywords = Object.values(data).map(terms => terms.split('\n').map(term => term.trim())); // Extract keywords
        })
        .catch(error => {
            console.error('Error loading significant terms:', error); // Log error if fetching fails
        });

    // Function to format the data for the prompt
    function formatData(filenames, keywords, summaryText) {
        let formattedData = ''; // Initialize an empty string for formatted data
        for (let i = 0; i < filenames.length; i++) {
            formattedData += `${filenames[i]}: ${keywords[i].join(', ')}\n`; // Add filenames and keywords to the string
        }
        formattedData += `\nSummary Text: ${summaryText}\n`; // Add the summary text
        return formattedData; // Return the formatted string
    }

    async function handleAction() {
        // Handle the action when the action button is clicked
        const summaryText = summaryTextarea.value.trim(); // Get the summary text from the textarea
        
        if (summaryText === '') { // If the summary text is empty, alert the user
            alert('Please enter a summary text first.');
            return;
        }

        actionSpinner.style.display = 'inline-block'; // Show the spinner during processing
        actionText.style.display = 'none'; // Hide the button text

        try {
            // Create the prompt for issues
            const issuesPrompt = `${promptGuidelines.value.trim()}\n\n${formatData(filenames, keywords, summaryText)}\n\nClinical Text: ${summaryText}`;

            console.log('Sending prompt for issues:', issuesPrompt); // Log the prompt being sent

            // Send the prompt to the AI service and get the response
            const issuesResponse = await getAIResponse({ prompt: issuesPrompt });

            console.log('Received AI issues response:', issuesResponse); // Log the response

            const issuesList = issuesResponse.response
                .split('\n') // Split the response into individual issues
                .map(issue => issue.trim()) // Trim each issue
                .filter(issue => issue); // Filter out empty issues

            if (issuesList.length === 0) { // If no issues are found, log a warning
                console.warn('No issues found by the AI for the provided text');
            }

            suggestedGuidelinesDiv.innerHTML = '';  // Clear any existing content

            // Iterate through the list of issues and fetch guidelines for each
            for (const issue of issuesList) {
                const issueDiv = document.createElement('div'); // Create a div for each issue
                issueDiv.className = 'accordion-item'; // Add the accordion-item class for styling

                const issueTitle = document.createElement('h4'); // Create a heading for the issue
                issueTitle.className = 'accordion-header'; // Add the accordion-header class
                issueTitle.textContent = issue; // Set the text of the heading

                const contentDiv = document.createElement('div'); // Create a div for the content
                contentDiv.className = 'accordion-content'; // Add the accordion-content class
                contentDiv.style.display = 'none'; // Hide the content by default

                const guidelinesUl = document.createElement('ul'); // Create an unordered list for the guidelines

                // Fetch the guidelines for each issue
                try {
                    const guidelines = await getGuidelinesForIssue(issue); // Get guidelines from AI service

                    console.log(`Fetched guidelines for issue (${issue}):`, guidelines); // Log the fetched guidelines

                    if (guidelines.length === 0) { // If no guidelines are found, show a warning
                        console.warn(`No guidelines found for issue: ${issue}`);
                        const warningLi = document.createElement('li'); // Create a list item for the warning
                        warningLi.textContent = 'No guidelines available for this issue.'; // Set the warning text
                        guidelinesUl.appendChild(warningLi); // Add the warning to the list
                    } else {
                        guidelines.forEach(guideline => { // For each guideline
                            const guidelineLi = document.createElement('li'); // Create a list item
                            const link = document.createElement('a'); // Create a link
                            link.textContent = guideline.replace(/_/g, ' ').replace(/\.pdf$/i, ''); // Format the guideline text
                            link.href = '#';  // Update this if guidelines have actual links
                            link.target = '_blank'; // Open links in a new tab
                            guidelineLi.appendChild(link); // Add the link to the list item
                            guidelinesUl.appendChild(guidelineLi); // Add the list item to the unordered list
                        });
                    }
                } catch (error) {
                    console.error(`Error fetching guidelines for issue (${issue}):`, error); // Log error if fetching fails
                    const errorLi = document.createElement('li'); // Create a list item for the error
                    errorLi.textContent = `Error fetching guidelines for this issue: ${error.message}`; // Set the error message
                    guidelinesUl.appendChild(errorLi); // Add the error message to the list
                }

                contentDiv.appendChild(guidelinesUl); // Add the guidelines list to the content div
                issueDiv.appendChild(issueTitle); // Add the issue title to the issue div
                issueDiv.appendChild(contentDiv); // Add the content div to the issue div
                suggestedGuidelinesDiv.appendChild(issueDiv); // Add the issue div to the guidelines div

                issueTitle.addEventListener('click', () => { // Toggle the content visibility when the issue is clicked
                    const isVisible = contentDiv.style.display === 'block'; // Check if the content is visible
                    contentDiv.style.display = isVisible ? 'none' : 'block'; // Toggle visibility
                    issueTitle.classList.toggle('active', !isVisible); // Toggle the active class for styling
                });
            }
        } catch (error) {
            console.error('Error during handleAction:', error); // Log error if processing fails
            alert('An error occurred while processing the action.'); // Alert the user of the error
        } finally {
            actionSpinner.style.display = 'none'; // Hide the spinner after completion
            actionText.style.display = 'inline'; // Show the action button text again
        }
    }

});
