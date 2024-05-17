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

    fileInput.addEventListener('input', function() {
        var value = this.value;
        autocompleteList.innerHTML = '';
        if (!value) return false;
        filenames.forEach(file => {
            if (file.toLowerCase().includes(value.toLowerCase())) {
                let item = document.createElement('div');
                item.innerHTML = file;
                item.addEventListener('click', function() {
                    fileInput.value = this.innerText;
                    autocompleteList.innerHTML = '';
                    addIssueToList(this.innerText);
                    loadFile(this.innerText);
                });
                autocompleteList.appendChild(item);
            }
        });
    });

    function addIssueToList(filename) {
        issueCount++;
        let listItem = document.createElement('li');
        listItem.textContent = issueCount + '. ' + filename;
        issuesList.appendChild(listItem);
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
        var requestData = {
            text: text,
            fields: fields
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

    function generateClinicalNoteFromConversation() {
        var text = document.getElementById('summary').value;
        var prompt = "The following is a transcript of a conversation between two people. Please convert it into a summary in the style of a medical clinical note:\n\n" + text;
        var requestData = {
            prompt: prompt
        };

        fetch('http://localhost:3000/generate-clinical-note-from-conversation', {
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
            console.error('Error generating clinical note from conversation:', error);
        });
    }

    document.getElementById('generateClinicalNoteBtn').onclick = generateClinicalNote;
    document.getElementById('generateClinicalNoteFromConversationBtn').onclick = generateClinicalNoteFromConversation;

    function start() {
        console.log("Starting the application...");
    }

    function loadGoogleAPIs() {
        if (typeof gapi === 'undefined') {
            var script = document.createElement('script');
            script.onload = initGoogleClient; // Start initialization after loading
            script.src = "https://apis.google.com/js/api.js";
            document.head.appendChild(script);
        } else {
            initGoogleClient(); // Directly initialize if already loaded
        }
    }

    function initGoogleClient() {
        gapi.load('client:auth2', function() { // Load both client and auth2 modules
            gapi.client.init({
                apiKey: 'AIzaSyCMZGfUnoQGpJYp_JbJsVjbHfCWDCChhLU',
                clientId: '893524187828-7flb9msve2legucnmfhqg3ar4vnqedqb.apps.googleusercontent.com',
                discoveryDocs: ["https://www.googleapis.com/discovery/v1/apis/drive/v3/rest"],
                scope: 'https://www.googleapis.com/auth/drive.metadata.readonly'
            }).then(function () {
                // Ensure the auth2 module is initialized
                gapi.auth2.init({
                    client_id: 'YOUR_CLIENT_ID',
                    scope: 'https://www.googleapis.com/auth/drive.metadata.readonly'
                }).then(function(){
                    updateSigninStatus(); // Handle initial sign-in status
                    console.log("Google API client and auth2 initialized");
                });
            }).catch(function(error) {
                console.error("Failed to initialize the Google API client:", error);
            });
        });
    }

    function updateSigninStatus() {
        if (gapi.auth2 && gapi.auth2.getAuthInstance()) {
            if (gapi.auth2.getAuthInstance().isSignedIn.get()) {
                listFiles();
            } else {
                gapi.auth2.getAuthInstance().signIn();
            }
        } else {
            console.error('Google Auth2 client not initialized.');
        }
    }

    function listFiles() {
        gapi.client.drive.files.list({
            'pageSize': 10,
            'fields': "nextPageToken, files(id, name, webViewLink)",
            'q': "'1y33SUIemiwD35KjsHioFXjqKtkZmCPXN' in parents"
        }).then(function(response) {
            var files = response.result.files;
            if (files && files.length > 0) {
                populateDropdown(files);
            } else {
                console.log('No files found.');
            }
        }).catch(function(error) {
            console.error('Error fetching files:', error);
        });
    }

    function populateDropdown(files) {
        const select = document.getElementById('filePicker');
        select.innerHTML = ''; // Clear previous options
        files.forEach(function(file) {
            const option = document.createElement('option');
            option.value = file.webViewLink;
            option.textContent = file.name;
            select.appendChild(option);
        });
    }

    start();
    loadGoogleAPIs();
});
