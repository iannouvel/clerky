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

        const prompt = `The following is a transcript of a conversation.
        Please convert it into a clinical note using medical terminology and jargon suitable for healthcare professionals. 
        Please use the following headings: Situation, Issues, Background, Assessment, Discussion and Plan\n\n${text}`;

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
});
