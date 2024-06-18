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

    const recordBtn = document.getElementById('recordBtn');
    const generateClinicalNoteBtn = document.getElementById('generateClinicalNoteBtn');
    const actionBtn = document.getElementById('actionBtn');
    const summaryTextarea = document.getElementById('summary');
    const clinicalNoteOutput = document.getElementById('clinicalNoteOutput');
    const spinner = document.getElementById('spinner');
    const generateText = document.getElementById('generateText');
    const actionSpinner = document.getElementById('actionSpinner');
    const actionText = document.getElementById('actionText');
    const suggestedIssuesField = document.getElementById('suggestedissues');
    const suggestedGuidelinesDiv = document.getElementById('suggestedGuidelines');
    const suggestedLinksDiv = document.getElementById('suggestedLinks');

    let recording = false;

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

    if (generateClinicalNoteBtn) {
        generateClinicalNoteBtn.addEventListener('click', generateClinicalNote);
    }

    if (actionBtn) {
        actionBtn.addEventListener('click', handleAction);
    }

}

                          async function handleAction() {
    const summaryText = summaryTextarea.value;
    if (summaryText.trim() === '') {
        alert('Please enter a summary text first.');
        return;
    }

    actionSpinner.style.display = 'inline-block';
    actionText.style.display = 'none';

    try {
        // Handle Issues
        const issuesPrompt = `Please determine the significant clinical issues within this clinical scenario, ie if the patient has had a previous C-section, return: 'Previous C-Section'. Do not list risks, this will be done by the user. Please provide the issues as a list from most clinically important to least.\n\nClinical Text: ${summaryText}`;
        const issuesResponse = await SendToOpenAI({ prompt: issuesPrompt });
        const issuesList = issuesResponse.response
            .split('\n')
            .map(issue => issue.trim())
            .filter(issue => issue);

        suggestedIssuesField.value = issuesList.join('\n');

        // Fetch and display guidelines for each issue
        suggestedGuidelinesDiv.innerHTML = '';
        for (const issue of issuesList) {
            const guidelines = await getGuidelinesForIssue(issue);
            const issueDiv = document.createElement('div');
            const issueTitle = document.createElement('h4');
            issueTitle.textContent = issue;
            issueDiv.appendChild(issueTitle);

            const guidelinesUl = document.createElement('ul');
            for (const guideline of guidelines) {
                const guidelineLi = document.createElement('li');
                guidelineLi.textContent = guideline;
                guidelinesUl.appendChild(guidelineLi);
            }
            issueDiv.appendChild(guidelinesUl);
            suggestedGuidelinesDiv.appendChild(issueDiv);
        }
    } catch (error) {
        console.error('Error:', error);
        alert('An error occurred while processing the action.');
    } finally {
        actionSpinner.style.display = 'none';
        actionText.style.display = 'inline';
    }
}

async function getGuidelinesForIssue(issue) {
    const guidelinesPrompt = `For the clinical issue "${issue}", please recommend up to 3 guidelines.`;
    const guidelinesResponse = await SendToOpenAI({ prompt: guidelinesPrompt });
    const guidelinesList = guidelinesResponse.response
        .split('\n')
        .map(guideline => guideline.trim())
        .filter(guideline => guideline);

    return guidelinesList;
}

    actionSpinner.style.display = 'inline-block';
    actionText.style.display = 'none';

    try {
        // Handle Issues
        const issuesPrompt = `Please determine the significant clinical issues within this clinical scenario, ie if the patient has had a previous C-section, return: 'Previous C-Section'. Do not list risks, this will be done by the user. Please provide the issues as a list from most clinically important to least.\n\nClinical Text: ${summaryText}`;
        const issuesResponse = await SendToOpenAI({ prompt: issuesPrompt });
        const issuesList = issuesResponse.response
            .split('\n')
            .map(issue => issue.trim())
            .filter(issue => issue);

        suggestedIssuesField.value = issuesList.join('\n');

        // Fetch and display guidelines for each issue
        suggestedGuidelinesDiv.innerHTML = '';
        for (const issue of issuesList) {
            const guidelinesPrompt = `For the clinical issue "${issue}", please recommend up to 3 guidelines.`;
            const guidelinesResponse = await SendToOpenAI({ prompt: guidelinesPrompt });
            const guidelinesList = guidelinesResponse.response
                .split('\n')
                .map(guideline => guideline.trim())
                .filter(guideline => guideline);

            const issueDiv = document.createElement('div');
            const issueTitle = document.createElement('h4');
            issueTitle.textContent = issue;
            issueDiv.appendChild(issueTitle);

            const guidelinesUl = document.createElement('ul');
            for (const guideline of guidelinesList) {
                const guidelineLi = document.createElement('li');
                guidelineLi.textContent = guideline;
                guidelinesUl.appendChild(guidelineLi);
            }
            issueDiv.appendChild(guidelinesUl);
            suggestedGuidelinesDiv.appendChild(issueDiv);
        }
    } catch (error) {
        console.error('Error:', error);
        alert('An error occurred while processing the action.');
    } finally {
        actionSpinner.style.display = 'none';
        actionText.style.display = 'inline';
    }
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
        Please only list the filenames, without prior or trailing text.
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
});
