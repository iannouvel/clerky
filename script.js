document.addEventListener('DOMContentLoaded', function() {
    let filenames = [];

    fetch('/clerky/data/files.json')
        .then(response => response.json())
        .then(data => {
            filenames = data;
        })
        .catch(error => {
            console.error('Error loading the file list:', error);
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

    if (suggestionsBtn) {
        suggestionsBtn.addEventListener('click', handleSuggestions);
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
        const text = summaryTextarea.value;
        const fields = "Situation, Background, Assessment, Discussion, Plan";
        const speakers = document.querySelector('input[name="speakers"]:checked').value;
        const prompt = `The following is a transcript of a conversation between ${speakers} person/people. Please convert it into a summary in the style of a medical clinical note:\n\n${text}`;
        const requestData = {
            text,
            fields,
            prompt
        };

        const spinner = document.getElementById('spinner');
        const generateText = document.getElementById('generateText');

        spinner.style.display = 'inline-block';
        generateText.textContent = 'Generating...';

        fetch('http://localhost:3000/generate-clinical-note', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestData)
        })
        .then(response => response.json())
        .then(data => {
            if (data.success && data.note) {
                summaryTextarea.value = data.note;

                return fetch('http://localhost:3000/get-keyword-links', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ text: data.note })
                });
            } else {
                console.error('Unexpected response format:', data);
                throw new Error('Unexpected response format');
            }
        })
        .then(response => response.json())
        .then(linkData => {
            if (linkData.success && linkData.links) {
                const adviceFrame = document.getElementById('adviceFrame');
                const linksHtml = linkData.links.map(link => `<a href="/clerky/files/${link.filename}" target="_blank">${link.keyword}</a>`).join('<br>');
                adviceFrame.contentDocument.body.innerHTML = linksHtml;
            } else {
                console.error('Unexpected response format:', linkData);
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

async function handleSuggestions() {
    console.log('Entered handleSuggestions'); // Debugging log
    const summaryText = summaryTextarea.value;
    if (summaryText.trim() === '') {
        alert('Please enter a summary text first.');
        return;
    }

    try {
        console.log('Sending request to get-suggested-guidelines'); // Debugging log
        const guidelinesResponse = await fetch('http://localhost:3000/get-suggested-guidelines', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ summaryText })
        });

        if (!guidelinesResponse.ok) {
            console.error('Failed to retrieve guidelines suggestions. Status:', guidelinesResponse.status);
            alert('Failed to retrieve guidelines suggestions.');
        } else {
            const guidelinesResult = await guidelinesResponse.json();
            console.log('Response from get-suggested-guidelines:', guidelinesResult); // Debugging log
            const { suggestedGuidelines } = guidelinesResult;
            displaySuggestedGuidelines(suggestedGuidelines);
        }

        console.log('Sending request to get-suggested-links'); // Debugging log
        const linksResponse = await fetch('http://localhost:3000/get-suggested-links', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ summaryText })
        });

        if (!linksResponse.ok) {
            console.error('Failed to retrieve links suggestions. Status:', linksResponse.status);
            alert('Failed to retrieve links suggestions.');
        } else {
            const linksResult = await linksResponse.json();
            console.log('Response from get-suggested-links:', linksResult); // Debugging log
            const { suggestedLinks } = linksResult;
            displaySuggestedLinks(suggestedLinks);
        }
    } catch (error) {
        console.error('Error:', error);
        alert('An error occurred while retrieving suggestions.');
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
        link.href = `/clerky/files/${guideline}.pdf`;
        link.textContent = guideline.replace(/_/g, ' ');
        link.target = '_blank';
        listItem.appendChild(link);
        suggestedGuidelinesDiv.appendChild(listItem);
    });
}

function displaySuggestedLinks(suggestedLinks) {
    console.log('Entered displaySuggestedLinks'); // Debugging log
    console.log('Suggested Links Data:', suggestedLinks); // Debugging log
    suggestedLinksDiv.innerHTML = '';
    if (!Array.isArray(suggestedLinks) || suggestedLinks.length === 0) {
        console.log('No suggested links found.'); // Debugging log
        suggestedLinksDiv.textContent = 'No suggested links found.';
        return;
    }
    suggestedLinks.forEach(link => {
        console.log('Adding link:', link); // Debugging log
        const listItem = document.createElement('li');
        
        const linkElement = document.createElement('a');
        linkElement.href = link.url;
        linkElement.textContent = link.description || link.url; // Use description if available, else use URL
        linkElement.target = '_blank';
        
        listItem.appendChild(linkElement);
        suggestedLinksDiv.appendChild(listItem);
    });
}
