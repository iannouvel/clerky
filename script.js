document.getElementById("pageSelector").addEventListener("change", function() {
    const selectedPage = this.value;
    document.getElementById("adviceFrame").src = selectedPage;
});

function copyAdvice() {
    const iframeDoc = document.getElementById('adviceFrame').contentWindow.document;
    const adviceText = iframeDoc.getElementById('advice').innerText;
    const summaryBox = document.getElementById('summaryAdvice');
    summaryBox.value += adviceText + "\n";
}

function copySummaryToClipboard() {
    const summaryBox = document.getElementById('summaryAdvice');
    summaryBox.select();
    document.execCommand('copy');
    alert('Summary copied to clipboard!');
}
