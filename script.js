function start() {
  console.log("Starting the application...");
}
// Calling start somewhere in your script
start();


// This function dynamically loads the Google APIs and initializes the client
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

// Initializes the Google API client
function initGoogleClient() {
    gapi.load('client', function() {
        gapi.client.init({
            apiKey: 'AIzaSyCMZGfUnoQGpJYp_JbJsVjbHfCWDCChhLU',
            discoveryDocs: ["https://www.googleapis.com/discovery/v1/apis/drive/v3/rest"],
        }).then(function() {
            updateSigninStatus(); // Handle initial sign-in status
            console.log("Google API client initialized");
        }).catch(function(error) {
            console.error("Failed to initialize the Google API client:", error);
        });
    });
}

// Update sign-in status and potentially list files
function updateSigninStatus() {
    if (gapi.auth2 && gapi.auth2.getAuthInstance().isSignedIn.get()) {
        listFiles();
    } else {
        gapi.auth2.getAuthInstance().signIn();
    }
}

// Lists files in a specific directory
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

// Populates a dropdown with file options
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

// This function sends messages securely to a parent frame
function sendMessageToParent(adviceText) {
    const targetOrigin = 'https://example.com'; // Specify the correct parent origin for security
    window.parent.postMessage(adviceText, targetOrigin);
}

// Adds event listeners after the page has loaded
window.addEventListener('load', function() {
    loadGoogleAPIs();
    if (typeof start === 'function') {
        start(); // Call start if it's defined and necessary
    }
});
