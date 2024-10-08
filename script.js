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
            const prompt = `${promptGuidelines.value.trim()}\n\n${formatData(filenames, summaries, issue)}\n\nClinical Text: ${issue}`;
            
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
    
    let filenames = []; // Array to hold filenames for summaries
    let summaries = []; // Array to hold summaries

    fetch('https://raw.githubusercontent.com/iannouvel/clerky/main/guidance/summary/list_of_summaries.json')
        .then(response => {
            if (!response.ok) { // Check for network errors
                throw new Error('Network response was not ok ' + response.statusText);
            }
            return response.json(); // Parse the response as JSON
        })
        .then(data => {
            // 'data' is the JSON object containing filenames and summaries
            const filenames = Object.keys(data); // Extract filenames
            const summaries = Object.values(data); // Extract summaries
    
            // Now you can process the filenames and summaries as needed
            console.log('Filenames:', filenames);
            console.log('Summaries:', summaries);
    
            // If you want to process them together:
            filenames.forEach(filename => {
                const summary = data[filename];
                console.log(`Filename: ${filename}`);
                console.log(`Summary: ${summary}`);
            });
        })
        .catch(error => {
            console.error('Error fetching summaries:', error);
        });

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
    // Get the summary text and the selected guideline (assuming the guidelines are part of the UI)
    const summaryText = summaryTextarea.value.trim(); // Get the summary from the textarea
    const selectedGuideline = guidelinesList.value; // Assuming you have a dropdown or selection for guidelines

    // Validate inputs
    if (!summaryText || !selectedGuideline) {
        alert('Please provide both summary text and select a guideline.');
        return;
    }

    // Show loading spinner while the action is processed
    actionSpinner.style.display = 'inline-block'; // Show the spinner
    actionText.style.display = 'none'; // Hide the action button text during processing

    try {
        // Prepare the request data
        const requestData = {
            prompt: summaryText,        // Send the summary text as the prompt
            selectedGuideline: selectedGuideline // Send the selected guideline
        };

        // Log the request data for debugging
        console.log('Sending request to AI with data:', requestData);

        // Send the request to the AI service
        const response = await fetch('http://localhost:3000/SendToAI', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json' // Set the headers to JSON
            },
            body: JSON.stringify(requestData) // Convert the request data to JSON
        });

        // Check if the response is successful
        if (!response.ok) {
            const errorMessage = await response.text(); // Get the error message from the response
            throw new Error(`Error from server: ${errorMessage}`); // Throw the error
        }

        // Parse the JSON response
        const data = await response.json();
        console.log('Received AI response:', data); // Log the AI response for debugging

        // Process the response if successful
        if (data.success) {
            const issuesList = data.response
                .split('\n') // Split the response into individual issues
                .map(issue => issue.trim()) // Trim each issue
                .filter(issue => issue); // Filter out empty issues

            if (issuesList.length === 0) {
                console.warn('No issues found by the AI for the provided text.');
            }

            // Clear previous content
            suggestedGuidelinesDiv.innerHTML = ''; 

            // Loop through each issue and fetch guidelines
            for (const issue of issuesList) {
                const issueDiv = document.createElement('div'); // Create a div for the issue
                issueDiv.className = 'accordion-item'; // Style the issue div

                const issueTitle = document.createElement('h4'); // Create a heading for the issue
                issueTitle.className = 'accordion-header'; 
                issueTitle.textContent = issue; // Set the issue text

                const contentDiv = document.createElement('div'); // Create a div for the content
                contentDiv.className = 'accordion-content'; 
                contentDiv.style.display = 'none'; // Hide the content by default

                const guidelinesUl = document.createElement('ul'); // Create a list for the guidelines

                try {
                    // Fetch guidelines for each issue
                    const guidelines = await getGuidelinesForIssue(issue); 

                    if (guidelines.length === 0) {
                        console.warn(`No guidelines found for issue: ${issue}`);
                        const warningLi = document.createElement('li'); 
                        warningLi.textContent = 'No guidelines available for this issue.';
                        guidelinesUl.appendChild(warningLi);
                    } else {
                        guidelines.forEach(guideline => {
                            const guidelineLi = document.createElement('li'); 
                            const link = document.createElement('a'); 
                            link.textContent = guideline.replace(/_/g, ' ').replace(/\.pdf$/i, '');
                            link.href = '#'; 
                            link.target = '_blank'; 
                            guidelineLi.appendChild(link); 
                            guidelinesUl.appendChild(guidelineLi); 
                        });
                    }
                } catch (error) {
                    console.error(`Error fetching guidelines for issue (${issue}):`, error);
                    const errorLi = document.createElement('li'); 
                    errorLi.textContent = `Error fetching guidelines for this issue: ${error.message}`;
                    guidelinesUl.appendChild(errorLi);
                }

                // Append the guidelines list to the content div and the issue to the DOM
                contentDiv.appendChild(guidelinesUl); 
                issueDiv.appendChild(issueTitle); 
                issueDiv.appendChild(contentDiv); 
                suggestedGuidelinesDiv.appendChild(issueDiv);

                // Toggle visibility when the issue title is clicked
                issueTitle.addEventListener('click', () => {
                    const isVisible = contentDiv.style.display === 'block';
                    contentDiv.style.display = isVisible ? 'none' : 'block'; 
                    issueTitle.classList.toggle('active', !isVisible); 
                });
            }
        } else {
            console.error('Error processing AI response:', data.message);
            alert('An error occurred while processing the AI response.');
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
