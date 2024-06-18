document.addEventListener('DOMContentLoaded', function() {
    let filenames = [];
    let keywords = [];

    fetch('https://raw.githubusercontent.com/iannouvel/clerky/main/significant_terms.json')
        .then(response => {
            if (!response.ok) {
                throw new Error('Network response was not ok ' + response.statusText);
            }
            return response.json();
        })
        .then(data => {
            filenames = Object.keys(data);
            keywords = Object.values(data).map(terms => terms.split('\n').map(term => term.trim()));
        })
        .catch(error => {
            console.error('Error loading significant terms:', error);
        });
    
    const fileInput = document.getElementById('fileInput');
    const autocompleteList = document.getElementById('autocomplete-list');
    const issuesList = document.getElementById('issuesList');
    const recordBtn = document.getElementById('recordBtn');
    const generateClinicalNoteBtn = document.getElementById('generateClinicalNoteBtn');
    const suggestedGuidelinesDiv = document.getElementById('suggestedGuidelines');
    const suggestedLinksDiv = document.getElementById('suggestedLinks');
    const suggestionsBtn = document.getElementById('suggestionsBtn');
    const summaryTextarea = document.getElementById('summary');
    const clinicalNoteOutput = document.getElementById('clinicalNoteOutput');
    const spinner = document.getElementById('spinner');
    const generateText = document.getElementById('generateText');
    const suggestionsSpinner = document.getElementById('suggestionsSpinner');
    const suggestionsText = document.getElementById('suggestionsText');
    const issuesBtn = document.getElementById('issuesBtn');
    const suggestedIssuesField = document.getElementById('suggestedissues');

    let issueCount = 0;
    let recording = false;

    if (fileInput) {
        fileInput.addEventListener('focus', () => {
            fileInput.value = '';
        });

        fileInput.addEventListener('input', () => {
            const value = fileInput.value;
            autocompleteList.innerHTML = '';
            if (!value) return;

            const matches = filenames.filter(file => file.toLowerCase().includes(value.toLowerCase())).slice(0, 10);
            matches.forEach(file => {
                const item = document.createElement('div');
                item.textContent = file;
                item.addEventListener('click', () => {
                    fileInput.value = file;
                    autocompleteList.innerHTML = '';
                    addIssueToList(file);
                    loadFile(file);
                });
                autocompleteList.appendChild(item);
            });
        });
    }

  if (issuesBtn) {
        issuesBtn.addEventListener('click', handleIssues);
    }

       async function handleIssues() {
        const summaryText = summaryTextarea.value;
        if (summaryText.trim() === '') {
            alert('Please enter a summary text first.');
            return;
        }

        // Prompt to send to OpenAI
        const prompt = `Please determine the significant clinical issues within this clinical scenario, ie if the patient has had a previous C-section, return: 'Previous C-Section'. Please provide the issues as a list from most clinically important to least.\n\nClinical Text: ${summaryText}`;

        try {
            const response = await SendToOpenAI({ prompt });
            const issuesList = response.response
                .split('\n')
                .map(issue => issue.trim())
                .filter(issue => issue);

            // Populate the suggested issues field
            suggestedIssuesField.value = issuesList.join('\n');
        } catch (error) {
            console.error('Error:', error);
            alert('An error occurred while retrieving the issues.');
        }
    }

    function addIssueToList(filename) {
        issueCount++;
        const listItem = document.createElement('li');

        const filenameLink = document.createElement('span');
        filenameLink.style.cursor = 'pointer';
        filenameLink.textContent = `${issueCount}. ${filename}`;
        filenameLink.addEventListener('click', () => loadFile(filename));

        const removeBtn = document.createElement('span');
        removeBtn.textContent = ' X';
        removeBtn.style.cursor = 'pointer';
        removeBtn.style.marginLeft = '10px';
        removeBtn.addEventListener('click', () => {
            issuesList.removeChild(listItem);
            renumberIssuesList();
        });

        listItem.appendChild(filenameLink);
        listItem.appendChild(removeBtn);
        issuesList.appendChild(listItem);
    }

    function renumberIssuesList() {
        issueCount = 0;
        issuesList.querySelectorAll('li').forEach(item => {
            issueCount++;
            const filenameLink = item.querySelector('span');
            filenameLink.textContent = `${issueCount}. ${filenameLink.textContent.split('. ')[1]}`;
        });
    }

    function loadFile(filename) {
        const iframe = document.getElementById('adviceFrame');
        iframe.src = `/clerky/files/${filename}`;
        iframe.onload = () => {
            cleanIframe(iframe);
            adjustImageSizeInIframe(iframe);
        };
    }

    function adjustImageSizeInIframe(iframe) {
        const doc = iframe.contentDocument || iframe.contentWindow.document;
        const images = doc.getElementsByTagName('img');

        for (let img of images) {
            img.style.maxWidth = '100%';
            img.style.maxHeight = '100%';
        }
    }

    function isSimpleContent(content) {
        return /^\d{1,3}$/.test(content.trim()) || /^[a-zA-Z]{1,2}$/.test(content.trim());
    }

    function cleanIframe(iframe) {
        try {
            const doc = iframe.contentWindow.document;
            const rows = doc.querySelectorAll('tr');
            const cols = doc.querySelectorAll('td, th');

            rows.forEach(row => {
                if (isSimpleContent(row.textContent.trim())) row.remove();
            });

            cols.forEach(col => {
                if (isSimpleContent(col.textContent.trim())) col.remove();
            });
        } catch (error) {
            console.error('Error cleaning iframe content:', error);
        }
    }

    if ('webkitSpeechRecognition' in window) {
        const recognition = new webkitSpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = true;

        recognition.onresult = function(event) {
            let finalTranscript = '';
            for (let i = event.resultIndex; i < event.results.length; ++i) {
                if (event.results[i].isFinal) {
                    finalTranscript += event.results[i][0].transcript;
                }
            }
            summaryTextarea.value += finalTranscript;
        };

        if (recordBtn) {
            recordBtn.addEventListener('click', () => {
                recording = !recording;
                if (recording) {
                    recordBtn.innerHTML = '<span id="recordSymbol" class="record-symbol flashing"></span>Stop';
                    recognition.start();
                } else {
                    recordBtn.innerHTML = '<span id="recordSymbol" class="record-symbol"></span>Record';
                    recognition.stop();
                }
            });
        }
    }

    if (generateClinicalNoteBtn) {
        generateClinicalNoteBtn.addEventListener('click', generateClinicalNote);
    }

    function generateClinicalNote() {
        const text = summaryTextarea.value.trim();
        if (text === '') {
            alert('Please enter text into the summary field.');
            return;
        }

        const prompt = `The following is a transcript of a conversation.
        Please convert it into a summary in the style of a medical entry in the clinical notes
        Using the headings: Situation, Issues, Background, Assessment, Discussion and Plan\n\n${text}`;

        spinner.style.display = 'inline-block';
        generateText.textContent = 'Generating...';

        fetch('http://localhost:3000/SendToAI', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ prompt })
        })
        .then(response => {
            if (!response.ok) {
                throw new Error('Network response was not ok ' + response.statusText);
            }
            return response.json();
        })
        .then(data => {
            console.log(data); // Debugging line
            if (data.success) {
                clinicalNoteOutput.value = data.response; // Set the output to the clinicalNoteOutput field
            } else {
                console.error('Error:', data.message);
            }
        })
        .catch(error => {
            console.error('Error:', error);
        })
        .finally(() => {
            spinner.style.display = 'none';
            generateText.textContent = 'Generate Clinical Note';
        });
    }

    if (suggestionsBtn) {
        suggestionsBtn.addEventListener('click', handleSuggestions);
    }

    async function handleSuggestions() {
        const summaryText = summaryTextarea.value;
        if (summaryText.trim() === '') {
            alert('Please enter a summary text first.');
            return;
        }

        suggestionsSpinner.style.display = 'inline-block';
        suggestionsText.style.display = 'none';

        try {
            // Ensure keywords and filenames are loaded before calling the functions
            if (keywords.length === 0 || filenames.length === 0) {
                alert('Keywords and filenames are not loaded yet. Please try again later.');
                return;
            }

            const suggestedGuidelines = await generateSuggestedGuidelines(summaryText);
            displaySuggestedGuidelines(suggestedGuidelines);
            const suggestedLinks = await generateSuggestedLinks(summaryText);
            displaySuggestedLinks(suggestedLinks);
        } catch (error) {
            console.error('Error:', error);
            alert('An error occurred while retrieving suggestions.');
        } finally {
            suggestionsSpinner.style.display = 'none';
            suggestionsText.style.display = 'inline';
        }
    }

function displaySuggestedGuidelines(suggestedGuidelines) {
    suggestedGuidelinesDiv.innerHTML = '';
    if (!Array.isArray(suggestedGuidelines) || suggestedGuidelines.length === 0) {
        suggestedGuidelinesDiv.textContent = 'No suggested guidelines found.';
        return;
    }
    suggestedGuidelines.forEach(guideline => {
        const listItem = document.createElement('li');
        const link = document.createElement('a');
        
        // Add the .pdf extension and encode the guideline
        let encodedGuideline = encodeURIComponent(guideline.trim() + '.pdf');

        // Log the original and encoded guideline for verification
        console.log('Original guideline:', guideline);
        console.log('Encoded guideline:', encodedGuideline);

        // Construct the URL using the encoded guideline
        let url = `https://raw.githubusercontent.com/iannouvel/clerky/main/guidance/${encodedGuideline}`;

        // Check for doubled .pdf suffix and correct it if needed
        if (url.endsWith('.pdf.pdf')) {
            url = url.slice(0, -4);
        }
        console.log('Constructed URL:', url);

        // Set the link properties
        link.href = url;
        link.textContent = guideline.replace(/_/g, ' ');
        link.target = '_blank';
        listItem.appendChild(link);
        suggestedGuidelinesDiv.appendChild(listItem);
    });
}

    
    function displaySuggestedLinks(suggestedLinks) {
        suggestedLinksDiv.innerHTML = '';
        if (!Array.isArray(suggestedLinks) || suggestedLinks.length === 0) {
            suggestedLinksDiv.textContent = 'No suggested links found.';
            return;
        }
        suggestedLinks.forEach(link => {
            const listItem = document.createElement('li');
            const linkElement = document.createElement('a');
            linkElement.href = link.url;
            linkElement.textContent = link.description;
            linkElement.target = '_blank';
            listItem.appendChild(linkElement);
            suggestedLinksDiv.appendChild(listItem);
        });
    }

    // Function to send requests to OpenAI
    async function SendToOpenAI(requestData) {
        const response = await fetch('http://localhost:3000/SendToAI', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestData)
        });

        if (!response.ok) {
            const errorDetails = await response.json();
            throw new Error(`Error: ${errorDetails.message}`);
        }

        return await response.json();
    }

    // Functions to generate suggested guidelines and links
    async function generateSuggestedGuidelines(summaryText) {
        const prompt = `Please provide filenames of the 3 most relevant guidelines for the following clinical text. 
        Please only list the filenames, without prior or trailling text.
        The significant terms are listed line-by-line as filenames followed by their associated 
        significant terms:\n\n${formatData(filenames, keywords, summaryText)}\n\nClinical Text: ${summaryText}`;
        const response = await SendToOpenAI({ prompt });
        const suggestedGuidelines = response.response
            .split('\n')
            .map(guideline => guideline.replace(/^\d+\.\s*/, '').trim())
            .filter(guideline => guideline);

        return suggestedGuidelines;
    }

    async function generateSuggestedLinks(summaryText) {
        const prompt = `Please provide links to the 3 most relevant online clinical written for clinicians, not patients, as URLs for the following text: ${summaryText}. Format each link as "URL: [URL] Description: [description]".`;
        const response = await SendToOpenAI({ prompt });
        const suggestedLinks = response.response
            .split('\n')
            .map(link => {
                const urlMatch = link.match(/URL:\s*(https?:\/\/[^\s]+)/);
                const descriptionMatch = link.match(/Description:\s*(.*)/);

                return urlMatch && descriptionMatch ? {
                    url: urlMatch[1].trim(),
                    description: descriptionMatch[1].trim()
                } : null;
            })
            .filter(link => link !== null);

        return suggestedLinks;
    }

    function formatData(filenames, keywords, summaryText) {
        let formattedData = '';
        for (let i = 0; i < filenames.length; i++) {
            formattedData += `${filenames[i]}: ${keywords[i].join(', ')}\n`;
        }
        formattedData += `\nSummary Text: ${summaryText}\n`;
        return formattedData;
    }
});
