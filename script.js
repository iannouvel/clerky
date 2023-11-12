function changeIFrameSource() {
    const selectedValue = document.getElementById("situationDropdown").value;
    if (selectedValue) {
        document.getElementById("adviceFrame").style.display = "block";
        document.getElementById("adviceFrame").src = selectedValue;
        document.querySelectorAll("hr").forEach(el => el.style.display = "block");
        document.getElementById("pasteButton").style.display = "block";
        document.getElementById("summary").style.display = "block";
        document.getElementById("copyButton").style.display = "block";
    } else {
        document.getElementById("adviceFrame").style.display = "none";
    }
}

async function pasteToSummary() {
    try {
        const text = await navigator.clipboard.readText();
        const summaryElement = document.getElementById("summary");
        summaryElement.value += '\n' + text;
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
