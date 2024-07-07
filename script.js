document.addEventListener('DOMContentLoaded', function() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    const recognition = new SpeechRecognition();

    const promptsBtn = document.getElementById('promptsBtn');
    const mainSection = document.getElementById('mainSection');
    const promptsSection = document.getElementById('promptsSection');
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

    let recording = false;
    let promptsData = JSON.parse(localStorage.getItem('promptsData')) || {};

    // Function to load prompts into the text areas
    function loadPrompts() {
        promptIssues.value = promptsData.promptIssues || document.getElementById('promptIssues').defaultValue;
        promptGuidelines.value = promptsData.promptGuidelines || document.getElementById('promptGuidelines').defaultValue;
        promptNoteGenerator.value = promptsData.promptNoteGenerator || document.getElementById('promptNoteGenerator').defaultValue;
    }

    // Function to save prompts from the text areas
    function savePrompts() {
        promptsData.promptIssues = promptIssues.value || document.getElementById('promptIssues').defaultValue;
        promptsData.promptGuidelines = promptGuidelines.value || document.getElementById('promptGuidelines').defaultValue;
        promptsData.promptNoteGenerator = promptNoteGenerator.value || document.getElementById('promptNoteGenerator').defaultValue;
        localStorage.setItem('promptsData', JSON.stringify(promptsData));
        alert('Prompts saved successfully!');
    }

    // Handle the save prompts button click
    savePromptsBtn.addEventListener('click', savePrompts);

    // Handle prompts button click to toggle sections
    promptsBtn.addEventListener('click', () => {
        mainSection.classList.toggle('hidden');
        promptsSection.classList.toggle('hidden');
    });

    // Load prompts on page load
    loadPrompts();

    // Speech recognition setup
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
        summaryTextarea.value += transcript;
    };

    recognition.onerror = (event) => {
        console.error('Speech recognition error detected: ' + event.error);
    };

    recognition.onend = () => {
        if (recording) {
            recognition.start(); // Restart recognition if still recording
        }
    };

    // Handle the record button click
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

    // Function to generate clinical note
    async function generateClinicalNote() {
        const text = summaryTextarea.value.trim();
        if (text === '') {
            alert('Please enter text into the summary field.');
            return;
        }

        const prompt = `${promptNoteGenerator.value.trim()}\n\n${text}`;

        spinner.style.display = 'inline-block';
        generateText.textContent = 'Generating...';

        try {
            const response = await fetch('http://localhost:3000/SendToAI', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ prompt })
            });

            if (!response.ok) {
                throw new Error('Network response was not ok ' + response.statusText);
            }

            const data = await response.json();
            if (data.success) {
                clinicalNoteOutput.value = data.response; 
            } else {
                console.error('Error:', data.message);
            }
        } catch (error) {
            console.error('Error:', error);
        } finally {
            spinner.style.display = 'none';
            generateText.textContent = 'Generate Clinical Note';
        }
    }

    generateClinicalNoteBtn.addEventListener('click', generateClinicalNote);

    // Function to handle the action button click
    async function handleAction() {
        const summaryText = summaryTextarea.value;
        if (summaryText.trim() === '') {
            alert('Please enter a summary text first.');
            return;
        }

        actionSpinner.style.display = 'inline-block';
        actionText.style.display = 'none';

        try {
            const issuesPrompt = `${promptIssues.value.trim()}\n\nClinical Text: ${summaryText}`;
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

    actionBtn.addEventListener('click', handleAction);

    // Function to get guidelines for a specific issue
    async function getGuidelinesForIssue(issue) {
        const prompt = `${promptGuidelines.value.trim()}\n\n${formatData(filenames, keywords, issue)}\n\nClinical Text: ${issue}`;
        const response = await SendToOpenAI({ prompt });
        const guidelinesList = response.response
            .split('\n')
            .map(guideline => guideline.replace(/^\d+\.\s*/, '').trim())
            .filter(guideline => guideline);

        return guidelinesList;
    }

    // Function to format data for prompt
    function formatData(filenames, keywords, summaryText) {
        let formattedData = '';
        for (let i = 0; i < filenames.length; i++) {
            formattedData += `${filenames[i]}: ${keywords[i].join(', ')}\n`;
        }
        formattedData += `\nSummary Text: ${summaryText}\n`;
        return formattedData;
    }

    // Function to send data to OpenAI API
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

    // Function to export clinical note to OneDrive
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

    exportBtn.addEventListener('click', exportToOneDrive);

    let filenames = [];
    let keywords = [];

    // Fetch significant terms data
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

    // Tab functionality
    document.querySelectorAll('.tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.tab').forEach(tab => tab.classList.remove('active'));
            tab.classList.add('active');
            const tabName = tab.getAttribute('data-tab');
            document.querySelectorAll('.container').forEach(container => {
                container.classList.add('hidden');
            });
            document.getElementById(tabName + 'Section').classList.remove('hidden');
        });
    });
});
