function updateIframe() {
    const situationDropdown = document.getElementById('situationDropdown');
    const adviceFrame = document.getElementById('adviceFrame');
    const hiddenElements = document.querySelectorAll('.hidden');

    if (situationDropdown.value) {
        adviceFrame.src = situationDropdown.value;
        hiddenElements.forEach(element => element.classList.remove('hidden'));
    } else {
        adviceFrame.src = '';
        hiddenElements.forEach(element => element.classList.add('hidden'));
    }
}

async function pasteFromClipboard() {
    try {
        const text = await navigator.clipboard.readText();
        const summaryTextbox = document.getElementById('summaryTextbox');
        summaryTextbox.value += text;
    } catch (err) {
        console.error('Failed to read clipboard:', err);
    }
}

document.addEventListener("DOMContentLoaded", function() {
    var select = document.getElementById("fetalHeartRate");
    for (let i = 0; i <= 200; i += 5) {
        var opt = document.createElement('option');
        opt.value = i;
        opt.innerHTML = i + ' bpm';
        select.appendChild(opt);
    }
    select.value = "130"; // Set default selection
});

function copyToClipboard() {
    const summaryText = document.getElementById('summaryTextbox').value;
    navigator.clipboard.writeText(summaryText)
        .then(() => console.log('Summary copied to clipboard.'))
        .catch(err => console.error('Failed to copy:', err));
}
