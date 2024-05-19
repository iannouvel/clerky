document.addEventListener('DOMContentLoaded', function() {
    var filenames = [];
    fetch('/clerky/data/files.json')
        .then(response => response.json())
        .then(data => {
            filenames = data;
        })
        .catch(error => {
            console.error('Error loading the file list:', error);
        });

    var fileInput = document.getElementById('fileInput');
    var autocompleteList = document.getElementById('autocomplete-list');
    var issuesList = document.getElementById('issuesList');
    var issueCount = 0;
    var recording = false;
    var recordBtn = document.getElementById('recordBtn');
    var recordSymbol = document.getElementById('recordSymbol');
    var generateClinicalNoteBtn = document.getElementById('generateClinicalNoteBtn');

    recordBtn.addEventListener('click', function() {
        recording = !recording;
        if (recording) {
            recordBtn.innerHTML = '<span id="recordSymbol" class="record-symbol flashing"></span>Stop';
            // Start recording
            recognition.start();
        } else {
            recordBtn.innerHTML = '<span id="recordSymbol" class="record-symbol"></span>Record';
            // Stop recording
            recognition.stop();
        }
    });

    fileInput.addEventListener('focus', function() {
        this.value = '';
    });

    fileInput.addEventListener('input', function() {
        var value = this.value;
        autocompleteList.innerHTML = '';
        if (!value) return false;
        let matches = filenames.filter(file => file.toLowerCase().includes(value.toLowerCase())).slice(0, 10);
        matches.forEach(file => {
            let item = document.createElement('div');
            item.innerHTML = file;
            item.addEventListener('click', function() {
                fileInput.value = this.innerText;
                autocompleteList.innerHTML = '';
                addIssueToList(this.innerText);
                loadFile(this.innerText);
            });
            autocompleteList.appendChild(item);
        });
    });

    function addIssueToList(filename) {
        issueCount++;
        let listItem = document.createElement('li');

        let filenameLink = document.createElement('span');
        filenameLink.style.cursor = 'pointer';
        filenameLink.style.textDecoration = 'none';
        filenameLink.style.color = 'black';
        filenameLink.textContent = issueCount + '. ' + filename;
        filenameLink.addEventListener('click', function(event) {
            event.preventDefault();
            loadFile(filename);
        });

        let removeBtn = document.createElement('span');
        removeBtn.textContent = ' X';
        removeBtn.style.cursor = 'pointer';
        removeBtn.style.marginLeft = '10px';
        removeBtn.addEventListener('click', function() {
            issuesList.removeChild(listItem);
            renumberIssuesList();
        });

        listItem.appendChild(filenameLink);
        listItem.appendChild(removeBtn);
        issuesList.appendChild(listItem);
    }

    function renumberIssuesList() {
        issueCount = 0;
        const listItems = issuesList.querySelectorAll('li');
        listItems.forEach(item => {
            issueCount++;
            const filenameLink = item.querySelector('span');
            filenameLink.textContent = issueCount + '. ' + filenameLink.textContent.split('. ')[1];
        });
    }

    function loadFile(filename) {
        var iframe = document.getElementById('adviceFrame');
        iframe.src = '/clerky/files/' + filename;
        iframe.onload = function() {
            cleanIframe(iframe);
            adjustImageSizeInIframe(iframe);
        };
    }

    function adjustImageSizeInIframe(iframe) {
        var doc = iframe.contentDocument || iframe.contentWindow.document;
        var images = doc.getElementsByTagName('img');
        
        for (var i = 0; i < images.length; i++) {
            images[i].style.maxWidth = '100%';
            images[i].style.maxHeight = '100%';
        }
    }

    function isSimpleContent(content) {
        return /^\d{1,3}$/.test(content.trim()) || /^[a-zA-Z]{1,2}$/.test(content.trim());
    }

    function cleanIframe(iframe) {
        try {
            var doc = iframe.contentWindow.document;
            var rows = doc.querySelectorAll("tr");
            var cols = doc.querySelectorAll("td, th");

            console.log(`Found ${rows.length} rows and ${cols.length} columns to clean.`);

            var cleanedRows = 0;
            var cleanedCols = 0;

            rows.forEach(row => {
                var content = row.textContent.trim();
                if (isSimpleContent(content)) {
                    console.log("Removing row:", row);
                    row.remove();
                    cleanedRows++;
                }
            });

            cols.forEach(col => {
                var content = col.textContent.trim();
                if (isSimpleContent(content)) {
                    console.log("Removing column:", col);
                    col.remove();
                    cleanedCols++;
                }
            });

            console.log(`Cleaned ${cleanedRows} rows and ${cleanedCols} columns.`);
        } catch (error) {
            console.error('Error cleaning iframe content:', error);
        }
    }

    if ('webkitSpeechRecognition' in window) {
        var recognition = new webkitSpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = true;

        recognition.onresult = function(event) {
            var finalTranscript = '';
            for (var i = event.resultIndex; i < event.results.length; ++i) {
                if (event.results[i].isFinal) {
                    finalTranscript += event.results[i][0].transcript;
                }
            }
            document.getElementById('summary').value += finalTranscript;
        };

        document.getElementById('startBtn').onclick = function() {
            recognition.start();
        };

        document.getElementById('stopBtn').onclick = function() {
            recognition.stop();
        };
    } else {
        document.getElementById('startBtn').style.display = 'none';
        document.getElementById('stopBtn').style.display = 'none';
    }

    function generateClinicalNote() {
        var text = document.getElementById('summary').value;
        var fields = "Situation, Background, Assessment, Discussion, Plan";
        var speakers = document.querySelector('input[name="speakers"]:checked').value;
        var prompt = `The following is a transcript of a conversation between ${speakers} person/people. Please convert it into a summary in the style of a medical clinical note:\n\n${text}`;
        var requestData = {
            text: text,
            fields: fields,
            prompt: prompt
        };

        fetch('http://localhost:3000/generate-clinical-note', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestData)
        })
        .then(response => {
            if (!response.ok) {
                if (response.status === 401) {
                    throw new Error('Unauthorized: Invalid API key');
                } else {
                    throw new Error('Failed to fetch');
                }
            }
            return response.json();
        })
        .then(data => {
            if (data.success && data.note) {
                document.getElementById('summary').value = data.note;
            } else {
                console.error('Unexpected response format:', data);
            }
        })
        .catch(error => {
            console.error('Error generating clinical note:', error);
        });
    }

    console.log(generateClinicalNoteBtn);  // Debugging statement

    if (generateClinicalNoteBtn) {
        generateClinicalNoteBtn.addEventListener('click', generateClinicalNote);
    } else {
        console.error("generateClinicalNoteBtn element not found");
    }

    function start() {
        console.log("Starting the application...");
    }

    start();
});
