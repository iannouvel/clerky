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
