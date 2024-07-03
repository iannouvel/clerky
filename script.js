document.addEventListener('DOMContentLoaded', function() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    const recognition = new SpeechRecognition();
    const promptsData = JSON.parse(localStorage.getItem('promptsData')) || {};
    
    // Now you can use promptsData in your script
    console.log(promptsData);
    
    // Example usage: send a prompt to AI
    const aiPrompt = promptsData['yourPromptKey']; // Replace 'yourPromptKey' with the actual key you are using.
    // Use aiPrompt as needed in your code

    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.lang = 'en-US';

    recognition.onresult = (event) => {
        let transcript = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
            if (event.results[i].isFinal) {
                transcript += event.results[i][0].transcript;
            }
        }
        document.getElementById('summary').value += transcript;
    };

    recognition.onerror = (event) => {
        console.error('Speech recognition error detected: ' + event.error);
    };

    recognition.onend = () => {
        if (recording) {
            recognition.start(); // Restart recognition if still recording
        }
    };

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
    const suggestedGuidelinesDiv = document.getElementById('suggestedGuidelines');
    const exportBtn = document.getElementById('exportBtn');
    const promptsBtn = document.getElementById('promptsBtn');

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

    if (exportBtn) {
        exportBtn.addEventListener('click', exportToOneDrive);
    }

    if (promptsBtn) {
        promptsBtn.addEventListener('click', () => {
            window.open('prompts.html', '_blank');
        });
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
            const issuesPrompt = `Please determine the significant clinical issues within this clinical scenario, ie if the patient has had a previous C-section, return: 'Previous C-Section'. Do not list risks, this will be done by the user. Please provide the issues as a list from most clinically important to least.\n\nClinical Text: ${summaryText}`;
            const issuesResponse = await SendToOpenAI({ prompt: issuesPrompt });
            const issuesList = issuesResponse.response
                .split('\n')
                .map(issue => issue.trim())
                .filter(issue => issue);

            suggestedGuidelinesDiv.innerHTML = '';
            for (const issue of issuesList) {
                const issueDiv = document.createElement('div');
                const issueTitle = document.createElement('h4');
                issueTitle.textContent = issue;
                issueDiv.appendChild(issueTitle);

                const guidelinesUl = document.createElement('ul');
                const guidelines = await getGuidelinesForIssue(issue);
                for (const guideline of guidelines) {
                    const guidelineLi = document.createElement('li');
                    const link = document.createElement('a');
                    
                    let encodedGuideline = encodeURIComponent(guideline.trim() + '.pdf');
                    let url = `https://raw.githubusercontent.com/iannouvel/clerky/main/guidance/${encodedGuideline}`;
                    if (url.endsWith('.pdf.pdf')) {
                        url = url.slice(0, -4);
                    }
                    link.href = url;
                    link.textContent = guideline.replace(/_/g, ' ');
                    link.target = '_blank';
                    guidelineLi.appendChild(link);
                    guidelinesUl.append.appendChild(guidelineLi);
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
        const prompt = `Please provide filenames of the 3 most relevant guidelines for the following clinical text. 
        Please only list the filenames, without prior or trailing text.
        The significant terms are listed line-by-line as filenames followed by their associated 
        significant terms:\n\n${formatData(filenames, keywords, issue)}\n\nClinical Text: ${issue}`;
        const response = await SendToOpenAI({ prompt });
        const guidelinesList = response.response
            .split('\n')
            .map(guideline => guideline.replace(/^\d+\.\s*/, '').trim())
            .filter(guideline => guideline);

        return guidelinesList;
    }

    function generateClinicalNote() {
        const text = summaryTextarea.value.trim();
        if (text === '') {
            alert('Please enter text into the summary field.');
            return;
        }

        const prompt = `The following is a transcript from a clinical consultation.
        Please write a concise clinical note using medical terminology 
        Please use vocabulary suitable for healthcare professionals. 
        Please write the note from the perspective of the clinician.
        Please use the following structure, without actually writing the headings: Situation, Issues, Background, Assessment, Discussion and Plan
        If the clinical context is a current pregnancy, please summarise the situation as follows:
        Age, Parity - Previous mode of delivery, Gestation, BMI, Rhesus Status, for example: "36yo, P2 - previous SVD followed by EMCS, 33+2 weeks, BMI 22, Rh+ve"
        Please summarise the issues as single line items
        Please try not to repeat yourself
        Please do not add ANYTHING that hasn't been said to the note
        Thank you.
        Here follows the transcript:
        \n\n${text}`;

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
            if (data.success) {
                clinicalNoteOutput.value = data.response; 
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

    function formatData(filenames, keywords, summaryText) {
        let formattedData = '';
        for (let i = 0; i < filenames.length; i++) {
            formattedData += `${filenames[i]}: ${keywords[i].join(', ')}\n`;
        }
        formattedData += `\nSummary Text: ${summaryText}\n`;
        return formattedData;
    }

    async function exportToOneDrive() {
        const text = clinicalNoteOutput.value;
        if (text.trim() === '') {
            alert('The clinical note output is empty.');
            return;
        }

        const filePath = "C:\\Users\\ianno\\OneDrive - NHS\\Projects\\Clerky\\Clinical Notes\\clinical_note.txt";
        try {
            const response = await fetch('http://localhost:3000/exportToFile', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ text, filePath })
            });

            if (!response.ok) {
                throw new Error('Failed to export the file: ' + response.statusText);
            }

            alert('File exported successfully!');
        } catch (error) {
            console.error('Error exporting file:', error);
            alert('An error occurred while exporting the file.');
        }
    }

    // Add the functionality for loading and saving prompts from localStorage
    const promptsContainer = document.getElementById('promptsContainer');
    const savePromptsBtn = document.getElementById('savePromptsBtn');

    // Define the default prompts
    const defaultPrompts = {
        'Generate Clinical Note': `The following are notes from a clinical consultation.
Please convert them into a clinical note using medical terminology and jargon suitable for healthcare professionals.
Please write the note from the perspective of the doctor or clinician.
Please use the following headings: Situation, Issues, Background, Assessment, Discussion and Plan
If the clinical context is a current pregnancy, please summarise the situation as follows:
Age, Parity, Previous mode of delivery, Gestation, BMI, Rhesus Status
Please summarise the issues as single line items
Please summarise the background with each component of the clinical background on a different line

\${text}`,

        'Guidelines': `Please provide filenames of the 3 most relevant guidelines for the following clinical text.
Please only list the filenames, without prior or trailing text.
The significant terms are listed line-by-line as filenames followed by their associated significant terms:

\${formatData(filenames, keywords, issue)}

Clinical Text: \${issue}`
    };

    // Load prompts from localStorage or set to default prompts
    let promptsData = JSON.parse(localStorage.getItem('promptsData')) || defaultPrompts;

    function loadPrompts() {
        promptsContainer.innerHTML = '';
        for (const [key, value] of Object.entries(promptsData)) {
            const promptDiv = document.createElement('div');
            promptDiv.innerHTML = `
                <h2>${key}</h2>
                <textarea id="${key}Textarea">${value}</textarea>
            `;
            promptsContainer.appendChild(promptDiv);
        }
    }

    loadPrompts();

    savePromptsBtn.addEventListener('click', () => {
        const updatedPrompts = {};
        for (const key in promptsData) {
            updatedPrompts[key] = document.getElementById(`${key}Textarea`).value;
        }
        localStorage.setItem('promptsData', JSON.stringify(updatedPrompts));
        alert('Prompts saved successfully!');
    });
});
