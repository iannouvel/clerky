document.addEventListener('DOMContentLoaded', function() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    const recognition = new SpeechRecognition();

    // Tab and section references
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

    // Algos tab elements
    const algosBtn = document.querySelector('.tab[data-tab="algos"]');
    const algosSection = document.getElementById('algosSection');
    const guidelineDropdown = document.getElementById('guidelineDropdown');
    const guidelinesDatalist = document.getElementById('guidelinesList');
    const algoContent = document.getElementById('algoContent');

    let recording = false;
    let promptsData = JSON.parse(localStorage.getItem('promptsData')) || {};

    // Function to load prompts into the text areas
    function loadPrompts() {
        try {
            promptIssues.value = promptsData.promptIssues || document.getElementById('promptIssues').defaultValue;
            promptGuidelines.value = promptsData.promptGuidelines || document.getElementById('promptGuidelines').defaultValue;
            promptNoteGenerator.value = promptsData.promptNoteGenerator || document.getElementById('promptNoteGenerator').defaultValue;
        } catch (error) {
            console.error('Error loading prompts:', error);
        }
    }

    // Function to save prompts from the text areas
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

    // Function to load guidelines into the dropdown
    function loadGuidelineOptions() {
        fetch('https://raw.githubusercontent.com/iannouvel/clerky/main/list_of_guidelines.txt')
            .then(response => response.text())
            .then(data => {
                const guidelines = data.split('\n').filter(line => line.trim() !== '');
                guidelinesDatalist.innerHTML = ''; // Clear previous options
                guidelines.forEach(guideline => {
                    const option = document.createElement('option');
                    option.value = guideline.trim();
                    guidelinesDatalist.appendChild(option);
                });
            })
            .catch(error => console.error('Error loading guideline options:', error));
    }

    // Function to display the relevant algorithm content
    function displayAlgorithmContent(guideline) {
        const htmlFilename = guideline.replace(/\.pdf$/i, '.html');
        const algoUrl = `https://iannouvel.github.io/clerky/algos/${encodeURIComponent(htmlFilename)}`;

        fetch(algoUrl)
            .then(response => {
                if (!response.ok) {
                    throw new Error('Algorithm HTML not found');
                }
                return response.text();
            })
            .then(htmlContent => {
                algoContent.innerHTML = htmlContent;
            })
            .catch(error => {
                algoContent.innerHTML = `<p>Error loading algorithm content: ${error.message}</p>`;
            });
    }

    // Handle the save prompts button click
    savePromptsBtn.addEventListener('click', savePrompts);

    // Handle prompts button click to toggle sections
    promptsBtn.addEventListener('click', () => {
        try {
            mainSection.classList.add('hidden');
            linksSection.classList.add('hidden');
            guidelinesSection.classList.add('hidden');
            algosSection.classList.add('hidden');
            promptsSection.classList.remove('hidden');
        } catch (error) {
            console.error('Error toggling prompts section:', error);
        }
    });

    // Handle links button click to toggle sections
    linksBtn.addEventListener('click', () => {
        try {
            mainSection.classList.add('hidden');
            promptsSection.classList.add('hidden');
            guidelinesSection.classList.add('hidden');
            algosSection.classList.add('hidden');
            linksSection.classList.remove('hidden');
            loadLinks(); // Load links when the button is clicked
        } catch (error) {
            console.error('Error toggling links section:', error);
        }
    });

    // Handle guidelines button click to toggle sections and load guidelines
    guidelinesBtn.addEventListener('click', () => {
        try {
            mainSection.classList.add('hidden');
            promptsSection.classList.add('hidden');
            linksSection.classList.add('hidden');
            algosSection.classList.add('hidden');
            guidelinesSection.classList.remove('hidden');
            loadGuidelines(); // Call function to load guidelines when button is clicked
        } catch (error) {
            console.error('Error toggling guidelines section:', error);
        }
    });

    // Handle the 'Algos' tab click
    algosBtn.addEventListener('click', () => {
        mainSection.classList.add('hidden');
        promptsSection.classList.add('hidden');
        linksSection.classList.add('hidden');
        guidelinesSection.classList.add('hidden');
        algosSection.classList.remove('hidden');
        loadGuidelineOptions(); // Load guidelines when the tab is clicked
    });

    // Handle the dropdown selection
    guidelineDropdown.addEventListener('input', () => {
        const selectedGuideline = guidelineDropdown.value.trim();
        if (selectedGuideline) {
            displayAlgorithmContent(selectedGuideline);
        }
    });

    // Function to load links into the links list
    async function loadLinks() {
        try {
            const response = await fetch('links.txt');
            const text = await response.text();
            const linksList = document.getElementById('linksList');
            linksList.innerHTML = ''; // Clear previous links
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

    // Function to load guidelines from list_of_guidelines.txt
    function loadGuidelines() {
        guidelinesList.innerHTML = ''; // Clear the guidelines list before populating it

        fetch('https://raw.githubusercontent.com/iannouvel/clerky/main/list_of_guidelines.txt')
            .then(response => response.text())
            .then(data => {
                const guidelines = data.split('\n').filter(line => line.trim() !== '');
                guidelines.forEach(guideline => {
                    const listItem = document.createElement('li');

                    // Create the link for the PDF in the guidance folder
                    const link = document.createElement('a');
                    const formattedGuideline = guideline.trim();
                    link.href = `https://github.com/iannouvel/clerky/raw/main/guidance/${formattedGuideline}`;
                    link.textContent = formattedGuideline;
                    link.target = '_blank'; // Open in new tab

                    // Create the Algo link
                    const algoLink = document.createElement('a');
                    // Replace .pdf with .html for the algo link
                    const htmlFilename = formattedGuideline.replace(/\.pdf$/i, '.html');
                    const algoUrl = `https://iannouvel.github.io/clerky/algos/${encodeURIComponent(htmlFilename)}`;

                    // Set Algo link properties
                    algoLink.href = algoUrl;
                    algoLink.textContent = 'Algo';
                    algoLink.target = '_blank';
                    algoLink.style.marginLeft = '10px'; // Add some space between the links

                    // Append both the guideline PDF link and the algo link to the list item
                    listItem.appendChild(link);
                    listItem.appendChild(algoLink);

                    guidelinesList.appendChild(listItem);
                });
            })
            .catch(error => console.error('Error loading guidelines:', error));
    }

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
            console.error('Error generating clinical note:', error);
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
                issueDiv.className = 'accordion-item';

                const issueTitle = document.createElement('h4');
                issueTitle.className = 'accordion-header';
                issueTitle.textContent = issue;

                const contentDiv = document.createElement('div');
                contentDiv.className = 'accordion-content';
                contentDiv.style.display = 'none'; // Hide content by default

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
                    link.textContent = guideline.replace(/\.pdf$/i, '').replace(/_/g, ' ');
                    link.target = '_blank';

                    // Create Algo link
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

    // Function to get guidelines for a specific issue
    async function getGuidelinesForIssue(issue) {
        try {
            const prompt = `${promptGuidelines.value.trim()}\n\n${formatData(filenames, keywords, issue)}\n\nClinical Text: ${issue}`;
            const response = await SendToOpenAI({ prompt });
            const guidelinesList = response.response
                .split('\n')
                .map(guideline => guideline.replace(/^\d+\.\s*/, '').trim())
                .filter(guideline => guideline);

            return guidelinesList;
        } catch (error) {
            console.error('Error getting guidelines for issue:', error);
            return [];
        }
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
        try {
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
        } catch (error) {
            console.error('Error sending data to OpenAI:', error);
            return { response: '' };
        }
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
            try {
                document.querySelectorAll('.tab').forEach(tab => tab.classList.remove('active'));
                tab.classList.add('active');
                const tabName = tab.getAttribute('data-tab');
                document.querySelectorAll('.container').forEach(container => {
                    container.classList.add('hidden');
                });
                document.getElementById(tabName + 'Section').classList.remove('hidden');
            } catch (error) {
                console.error('Error switching tabs:', error);
            }
        });
    });

    // Load prompts on page load
    loadPrompts();
});
