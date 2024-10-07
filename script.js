document.addEventListener('DOMContentLoaded', function() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    const recognition = new SpeechRecognition();
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

    document.getElementById('algosBtn').addEventListener('click', function() {
        window.location.href = 'https://iannouvel.github.io/clerky/algos.html'; // Ensure this URL is correct
    });
    
    let recording = false;
    let promptsData = JSON.parse(localStorage.getItem('promptsData')) || {};

    function loadPrompts() {
        try {
            promptIssues.value = promptsData.promptIssues || document.getElementById('promptIssues').defaultValue;
            promptGuidelines.value = promptsData.promptGuidelines || document.getElementById('promptGuidelines').defaultValue;
            promptNoteGenerator.value = promptsData.promptNoteGenerator || document.getElementById('promptNoteGenerator').defaultValue;
        } catch (error) {
            console.error('Error loading prompts:', error);
        }
    }

    function savePrompts() {
        try {
            promptsData.promptIssues = promptIssues.value || document.getElementById('promptIssues').defaultValue;
            promptsData.promptGuidelines = promptGuidelines.value || document.getElementById('promptGuidelines').defaultValue;
            promptsData.promptNoteGenerator = promptNoteGenerator.value || document.getElementById('promptNoteGenerator').defaultValue;
            localStorage.setItem('promptsData', JSON.stringify(promptsData));
            alert('Prompts saved successfully!');
        } catch (error) {
            console.error('Error saving prompts:', error);
        }
    }

    savePromptsBtn.addEventListener('click', savePrompts);

    promptsBtn.addEventListener('click', () => {
        mainSection.classList.toggle('hidden');
        promptsSection.classList.toggle('hidden');
    });

    linksBtn.addEventListener('click', () => {
        mainSection.classList.toggle('hidden');
        linksSection.classList.toggle('hidden');
        loadLinks();
    });

    guidelinesBtn.addEventListener('click', () => {
        mainSection.classList.add('hidden');
        promptsSection.classList.add('hidden');
        linksSection.classList.add('hidden');
        guidelinesSection.classList.remove('hidden');
        loadGuidelines();
    });

    async function loadLinks() {
        try {
            const response = await fetch('links.txt');
            const text = await response.text();
            const linksList = document.getElementById('linksList');
            linksList.innerHTML = ''; 
            const links = text.split('\n');
            links.forEach(link => {
                if (link.trim()) {
                    const [text, url] = link.split(';');
                    const listItem = document.createElement('li');
                    const anchor = document.createElement('a');
                    anchor.href = url.trim();
                    anchor.textContent = text.trim();
                    anchor.target = '_blank';
                    listItem.appendChild(anchor);
                    linksList.appendChild(listItem);
                }
            });
        } catch (error) {
            console.error('Error loading links:', error);
        }
    }

    async function loadGuidelines() {
        guidelinesList.innerHTML = '';

        fetch('https://raw.githubusercontent.com/iannouvel/clerky/main/list_of_guidelines.txt')
            .then(response => response.text())
            .then(data => {
                const guidelines = data.split('\n').filter(line => line.trim() !== '');
                guidelines.forEach(guideline => {
                    const listItem = document.createElement('li');
                    const link = document.createElement('a');
                    const formattedGuideline = guideline.trim();
                    link.href = `https://github.com/iannouvel/clerky/raw/main/guidance/${formattedGuideline}`;
                    link.textContent = formattedGuideline;
                    link.target = '_blank';

                    const algoLink = document.createElement('a');
                    const htmlFilename = formattedGuideline.replace(/\.pdf$/i, '.html');
                    const algoUrl = `https://iannouvel.github.io/clerky/algos/${encodeURIComponent(htmlFilename)}`;
                    algoLink.href = algoUrl;
                    algoLink.textContent = 'Algo';
                    algoLink.target = '_blank';
                    algoLink.style.marginLeft = '10px';

                    listItem.appendChild(link);
                    listItem.appendChild(algoLink);
                    guidelinesList.appendChild(listItem);
                });
            })
            .catch(error => console.error('Error loading guidelines:', error));
    }

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
            const response = await fetch('http://localhost:3000/newFunctionName', { // Changed endpoint here
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ prompt })
            });

            if (!response.ok) throw new Error('Network response was not ok ' + response.statusText);

            const data = await response.json();
            if (data.success) {
                clinicalNoteOutput.value = data.response;
            } else {
                console.error('Error:', data.message);
            }
        } catch (error) {
            console.error('Error generating clinical note:', error);
        } finally {
            spinner.style.display = 'none';
            generateText.textContent = 'Generate Clinical Note';
        }
    }

    generateClinicalNoteBtn.addEventListener('click', generateClinicalNote);

async function handleAction() {
    const summaryText = summaryTextarea.value.trim();
    if (summaryText === '') {
        alert('Please enter a summary text first.');
        return;
    }

    actionSpinner.style.display = 'inline-block';
    actionText.style.display = 'none';

    try {
        console.log('Starting handleAction...');
        console.log('Summary text:', summaryText);

        const issuesPrompt = `${promptIssues.value.trim()}\n\nClinical Text: ${summaryText}`;
        console.log('Issues prompt:', issuesPrompt);

        const issuesResponse = await getAIResponse({ prompt: issuesPrompt });
        console.log('Issues response:', issuesResponse);

        const issuesList = issuesResponse.response
            .split('\n')
            .map(issue => issue.trim())
            .filter(issue => issue);

        console.log('Parsed issues list:', issuesList);

        suggestedGuidelinesDiv.innerHTML = '';
        for (const issue of issuesList) {
            console.log('Processing issue:', issue);

            const issueDiv = document.createElement('div');
            issueDiv.className = 'accordion-item';

            const issueTitle = document.createElement('h4');
            issueTitle.className = 'accordion-header';
            issueTitle.textContent = issue;

            const contentDiv = document.createElement('div');
            contentDiv.className = 'accordion-content';
            contentDiv.style.display = 'none';

            const guidelinesUl = document.createElement('ul');

            // Fetch the guidelines for the current issue
            const guidelines = await getGuidelinesForIssue(issue);
            console.log('Fetched guidelines for issue:', issue, guidelines);

            if (guidelines.length === 0) {
                console.warn('No guidelines found for issue:', issue);
            }

            for (const guideline of guidelines) {
                const guidelineLi = document.createElement('li');
                const link = document.createElement('a');
                let encodedGuideline = encodeURIComponent(guideline.trim() + '.pdf');
                let url = `https://raw.githubusercontent.com/iannouvel/clerky/main/guidance/${encodedGuideline}`;
                if (url.endsWith('.pdf.pdf')) {
                    url = url.slice(0, -4);
                }

                link.href = url;
                link.textContent = guideline.replace(/\.pdf$/i, '').replace(/_/g, ' ');
                link.target = '_blank';

                const algoLink = document.createElement('a');
                const htmlFilename = guideline.replace(/\.pdf$/i, '.html');
                const algoUrl = `https://iannouvel.github.io/clerky/algos/${encodeURIComponent(htmlFilename)}`;
                algoLink.href = algoUrl;
                algoLink.textContent = 'Algo';
                algoLink.target = '_blank';
                algoLink.style.marginLeft = '10px';

                guidelineLi.appendChild(link);
                guidelineLi.appendChild(algoLink);
                guidelinesUl.appendChild(guidelineLi);
            }

            contentDiv.appendChild(guidelinesUl);
            issueDiv.appendChild(issueTitle);
            issueDiv.appendChild(contentDiv);
            suggestedGuidelinesDiv.appendChild(issueDiv);

            issueTitle.addEventListener('click', () => {
                const isVisible = contentDiv.style.display === 'block';
                contentDiv.style.display = isVisible ? 'none' : 'block';
                issueTitle.classList.toggle('active', !isVisible);
            });
        }
    } catch (error) {
        console.error('Error handling action:', error);
        alert('An error occurred while processing the action.');
    } finally {
        actionSpinner.style.display = 'none';
        actionText.style.display = 'inline';
    }
}

    actionBtn.addEventListener('click', handleAction);

    async function getAIResponse(requestData) {
        try {
            const response = await fetch('http://localhost:3000/newFunctionName', { // Changed backend endpoint
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestData)
            });

            if (!response.ok) throw new Error(`Error: ${response.statusText}`);

            return await response.json();
        } catch (error) {
            console.error('Error sending data to server:', error);
            return { response: '' };
        }
    }

    async function getGuidelinesForIssue(issue) {
        try {
            const prompt = `${promptGuidelines.value.trim()}\n\n${issue}`;
            const response = await getAIResponse({ prompt });
            return response.response.split('\n').filter(guideline => guideline.trim());
        } catch (error) {
            console.error('Error getting guidelines for issue:', error);
            return [];
        }
    }
});
