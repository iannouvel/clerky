function updateIframe() {
    const situation = document.getElementById('situationDropdown').value;
    const adviceFrame = document.getElementById('adviceFrame');
    const otherElements = document.querySelectorAll('hr, #pasteClipboard, #summary, #copyClipboard');

    if (situation) {
        adviceFrame.style.display = 'block';
        adviceFrame.src = situation;
        otherElements.forEach(el => el.style.display = 'block');
    } else {
        adviceFrame.style.display = 'none';
        otherElements.forEach(el => el.style.display = 'none');
    }
}

async function pasteFromClipboard() {
    const text = await navigator.clipboard.readText();
    const summary = document.getElementById('summary');
    summary.value += text;
}

function copyToClipboard() {
    const summary = document.getElementById('summary');
    navigator.clipboard.writeText(summary.value)
        .then(() => alert("Copied to clipboard!"))
        .catch(err => console.error('Error in copying text: ', err));
}
