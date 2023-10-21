const situationDropdown = document.getElementById('situationDropdown');
const parametersFrame = document.getElementById('parametersFrame');
const adviceFrame = document.getElementById('adviceFrame');
const decisionDropdown = document.getElementById('decisionDropdown');
const agreedPlanFrame = document.getElementById('agreedPlanFrame');
const copyToSummaryBtn = document.getElementById('copyToSummaryBtn');
const summaryTextarea = document.getElementById('summaryTextarea');
const copyToClipboardBtn = document.getElementById('copyToClipboardBtn');

situationDropdown.addEventListener('change', function() {
    // Handle the logic when a situation is selected
    switch (situationDropdown.value) {
        case 'induction':
            parametersFrame.style.display = 'block';
            parametersFrame.contentDocument.body.innerHTML = `
                <select id="parameterSelect">
                    <option value="macrosomia">Macrosomia</option>
                    <option value="advancedMaternalAge">Advanced Maternal Age</option>
                </select>
            `;
            break;
        // ... Add cases for other situations ...
    }
});

parametersFrame.onload = function() {
    // Handle the logic when a parameter is selected
    const parameterSelect = parametersFrame.contentDocument.getElementById('parameterSelect');
    parameterSelect.addEventListener('change', function() {
        // Display advice based on the selected parameter
        switch (parameterSelect.value) {
            case 'macrosomia':
                adviceFrame.contentDocument.body.innerHTML = "Macrosomia is associated with X, can choose expectant, sweeps, sweeps and induction, induction, CS";
                // ... Populate the decisionDropdown based on the advice ...
                break;
            // ... Add cases for other parameters ...
        }
        adviceFrame.style.display = 'block';
    });
};

copyToSummaryBtn.addEventListener('click', function() {
    // Append the Advice, Decision, and Agreed plan to the summary textbox
    summaryTextarea.value += adviceFrame.contentDocument.body.innerText + "\n";
    summaryTextarea.value += decisionDropdown.value + "\n";
    summaryTextarea.value += agreedPlanFrame.contentDocument.body.innerText + "\n";
});

copyToClipboardBtn.addEventListener('click', function() {
    summaryTextarea.select();
    document.execCommand('copy');
});
