function loadPage() {
    const dropdown = document.getElementById('situationDropdown');
    const iframe = document.getElementById('adviceFrame');
    if (dropdown.value !== "default") {
        iframe.src = dropdown.value;
        iframe.classList.remove('hidden');
        document.querySelectorAll('.hidden').forEach(el => el.classList.remove('hidden'));
    } else {
        iframe.classList.add('hidden');
        document.getElementById('pasteToSummaryBtn').classList.add('hidden');
        document.getElementById('summaryTextbox').classList.add('hidden');
        document.getElementById('copyToClipboardBtn').classList.add('hidden');
        document.querySelectorAll('.red-line').forEach(el => el.classList.add('hidden'));
    }
}

async function pasteFromClipboard() {
    try {
        const clipboardText = await navigator.clipboard.readText();
        const summaryTextbox = document.getElementById('summaryTextbox');
        summaryTextbox.value += clipboardText;
    } catch (err) {
        console.error('Failed to read clipboard:', err);
    }
}

async function copyToClipboard() {
    try {
        const summaryTextbox = document.getElementById('summaryTextbox');
        await navigator.clipboard.writeText(summaryTextbox.value);
        alert('Summary copied to clipboard!');
    } catch (err) {
        console.error('Failed to copy text:', err);
    }
}
