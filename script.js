// script.js
document.getElementById("pageSelect").addEventListener("change", function() {
    const selectedPage = this.value;
    document.getElementById("pageFrame").src = selectedPage;
});

function copyToReport() {
    const iframe = document.getElementById('pageFrame').contentWindow.document;
    const advice = iframe.getElementById('advice').innerText;
    const reportBox = document.getElementById('reportBox');
    reportBox.value += advice + "\n";
}

function copyToClipboard() {
    const reportBox = document.getElementById('reportBox');
    reportBox.select();
    document.execCommand('copy');
    alert('Text copied to clipboard!');
}
