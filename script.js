function initClient() {
    gapi.client.init({
        apiKey: 'AIzaSyCMZGfUnoQGpJYp_JbJsVjbHfCWDCChhLU',
        clientId: '893524187828-7flb9msve2legucnmfhqg3ar4vnqedqb.apps.googleusercontent.com',
        discoveryDocs: ["https://www.googleapis.com/discovery/v1/apis/drive/v3/rest"],
        scope: 'https://www.googleapis.com/auth/drive.metadata.readonly'
    }).then(function () {
        gapi.auth2.getAuthInstance().isSignedIn.listen(updateSigninStatus);
        updateSigninStatus(gapi.auth2.getAuthInstance().isSignedIn.get());
    });
}

function start() {
    gapi.load('client:auth2', initClient);
}

window.onload = start;

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
        'pageSize': 10, // Adjust based on your needs
        'fields': "nextPageToken, files(id, name, webViewLink)",
        'q': "'1y33SUIemiwD35KjsHioFXjqKtkZmCPXN' in parents" // Folder ID here
    }).then(function(response) {
        var files = response.result.files;
        if (files && files.length > 0) {
            populateDropdown(files);
        } else {
            console.log('No files found.');
        }
    });
}

function changeIFrameSource() {
    const selectedValue = document.getElementById("situationDropdown").value;
    const adviceFrame = document.getElementById("adviceFrame");

    if (selectedValue) {
        adviceFrame.style.display = "block";
        adviceFrame.src = selectedValue;
    } else {
        adviceFrame.style.display = "none";
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
    const adviceDiv = document.getElementById('adviceField');
    const adviceText = adviceDiv.innerText;
    sendMessageToParent(adviceText);
}

function sendMessageToParent(adviceText) {
    // Ensure the parent is the intended recipient (use specific origin in production)
    window.parent.postMessage(adviceText, '*');
}
