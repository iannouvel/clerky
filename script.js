window.addEventListener('load', function() {
    loadClient();
    start(); // Make sure 'start' function is defined elsewhere in your code or remove if not needed.
});

window.parent.postMessage(adviceText, 'https://example.com'); // Use the actual parent origin.

async function initClient() {
    await gapi.client.init({
        apiKey: 'AIzaSyCMZGfUnoQGpJYp_JbJsVjbHfCWDCChhLU',
        discoveryDocs: ["https://www.googleapis.com/discovery/v1/apis/drive/v3/rest"],
    });
    updateSigninStatus();
}

function loadClient() {
    // Ensure gapi library is loaded
    gapi.load('client', function() {
        initClient().then(function() {
            updateSigninStatus(); // Make sure this is defined and used correctly
        }).catch(function(error) {
            console.error('Failed to initialize the Google API client:', error);
        });
    });
}

window.addEventListener('load', function() {
    // Only call loadClient here if the gapi script is guaranteed to be loaded. If you have it in <script> tags,
    // ensure they are placed before your own script or are loaded synchronously.
    loadClient();
});

window.onload = loadClient;

window.onload = start;

function handleCredentialResponse(response) {
    const credential = google.accounts.oauth2.initTokenClient({
        client_id: '893524187828-7flb9msve2legucnmfhqg3ar4vnqedqb.apps.googleusercontent.com',
        scope: 'https://www.googleapis.com/auth/drive.metadata.readonly',
        callback: (tokenResponse) => {
            gapi.client.setToken(tokenResponse);
            listFiles();
        },
    });
    credential.callback(response);
}

function renderButton() {
    google.accounts.id.initialize({
        client_id: '893524187828-7flb9msve2legucnmfhqg3ar4vnqedqb.apps.googleusercontent.com',
        callback: handleCredentialResponse
    });
    google.accounts.id.renderButton(
        document.getElementById("buttonDiv"),
        { theme: "outline", size: "large" }  // Customize the button to your liking
    );
}

function updateSigninStatus() {
    gapi.client.drive.files.list({
        // Check if the token is set and list files
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


function updateSigninStatus(isSignedIn) {
    if (isSignedIn) {
        listFiles();
    } else {
        gapi.auth2.getAuthInstance().signIn();
    }
}

function populateDropdown(files) {
    const select = document.getElementById('filePicker');
    files.forEach(function(file) {
        const option = document.createElement('option');
        option.value = file.webViewLink;
        option.textContent = file.name;
        select.appendChild(option);
    });
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
    document.getElementById('someErrorDisplayElement').textContent = 'Failed to load files: ' + error.message;
});

}

function changeIFrameSource() {
    const situationSelect = document.getElementById('situationDropdown');
    const fileSelect = document.getElementById('filePicker');
    const adviceFrame = document.getElementById('adviceFrame');

    if (fileSelect.value) { // If there's a selection in the filePicker, prioritize it
        adviceFrame.src = fileSelect.value;
        adviceFrame.style.display = 'block';
    } else if (situationSelect.value) { // Otherwise, use the situationDropdown
        adviceFrame.src = situationSelect.value;
        adviceFrame.style.display = 'block';
    } else {
        adviceFrame.style.display = 'none'; // Hide iframe if no selection
    }
}


async function pasteToSummary() {
    try {
        const text = await navigator.clipboard.readText();
        const summaryElement = document.getElementById("summary");
        // Add a newline character before the text if the textarea is not empty
        if (summaryElement.value) {
            summaryElement.value += '\n' + text;
        } else {
            summaryElement.value = text;
        }
    } catch (err) {
        console.error('Failed to read clipboard contents: ', err);
    }
}

function copyToClipboard() {
    const summaryText = document.getElementById("summary").value;
    navigator.clipboard.writeText(summaryText)
        .then(() => console.log('Text copied to clipboard'))
        .catch(err => console.error('Could not copy text: ', err));
}

function updateCategory(feature, labelId) {
    var selectedValue = document.getElementById(feature).value;
    document.getElementById(feature + "Category").innerText = selectedValue;

    // Update the color of the label based on the selected value
    var label = document.getElementById(labelId);
    switch (selectedValue) {
        case 'white':
            label.style.color = 'white';
            break;
        case 'amber':
            label.style.color = 'orange'; // Using orange for better visibility
            break;
        case 'red':
            label.style.color = 'red';
            break;
    }
}

function sendMessageToParent(adviceText) {
    // Post the message to the parent window
    window.parent.postMessage(adviceText, '*');
}

// Listen for messages from iframes
window.addEventListener('message', function(event) {
    // Assuming the message is a string to be copied
    const summaryElement = document.getElementById("summary");
    if (summaryElement && typeof event.data === 'string') {
        // Add a newline character before the text if the textarea is not empty
        if (summaryElement.value) {
            summaryElement.value += '\n' + event.data;
        } else {
            summaryElement.value = event.data;
        }
    }
}, false);

function copyAdviceToParent() {
    const adviceDiv = document.getElementById('adviceField'); // Ensure this element exists
    if (adviceDiv) {
        const adviceText = adviceDiv.innerText; // Correctly capturing the inner text
        sendMessageToParent(adviceText); // Pass this text to the function
    } else {
        console.error('Advice field is not found');
    }
}


function sendMessageToParent(adviceText) {
    // Ensure the parent is the intended recipient (use specific origin in production)
    window.parent.postMessage(adviceText, '*');
}
