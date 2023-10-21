const situationDropdown = document.getElementById('situationDropdown');
const parametersFrame = document.getElementById('parametersFrame');
const adviceFrame = document.getElementById('adviceFrame');
const decisionDropdown = document.getElementById('decisionDropdown');
const agreedPlanFrame = document.getElementById('agreedPlanFrame');
const copyToSummaryBtn = document.getElementById('copyToSummaryBtn');
const summaryTextarea = document.getElementById('summaryTextarea');
const copyToClipboardBtn = document.getElementById('copyToClipboardBtn');

situationDropdown.addEventListener('change', function() {
    switch (situationDropdown.value) {
        case 'induction':
            parametersFrame.style.display = 'block';
            parametersFrame.contentDocument.body.innerHTML = `
                <select id="parameterSelect">
                    <option value="select" disabled selected>Select a Parameter</option>
                    <option value="macrosomia">Macrosomia</option>
                    <option value="advancedMaternalAge">Advanced Maternal Age</option>
                </select>
            `;
            break;
    }
});

parametersFrame.onload = function() {
    const parameterSelect = parametersFrame.contentDocument.getElementById('parameterSelect');
    parameterSelect.addEventListener('change', function() {
        switch (parameterSelect.value) {
            case 'macrosomia':
                adviceFrame.style.display = 'block';
                adviceFrame.contentDocument.body.innerHTML = "Macrosomia is associated with X, can choose expectant, sweeps, sweeps and induction, induction, CS";
                
                decisionDropdown.style.display = 'block';
                decisionDropdown.innerHTML = `
                    <option value="select" disabled selected>Select a Decision</option>
                    <option value="expectant">Expectant</option>
                    <option value="sweeps">Sweeps</option>
                    <option value="sweepsAndInduction">Sweeps and Induction</option>
                    <option value="induction">Induction</option>
                    <option value="CS">CS</option>
                `;
                break;
            // ... Add cases for other parameters ...
        }
    });
};

decisionDropdown.addEventListener('change', function() {
    agreedPlanFrame.style.display = 'block';
    switch (decisionDropdown.value) {
        case 'expectant':
            agreedPlanFrame.contentDocument.body.innerHTML = 'Decided for expectant management, can change decision and if so to inform CMW';
            break;
        case 'sweeps':
            agreedPlanFrame.contentDocument.body.innerHTML = 'Sweeps';
            break;
        // ... Add cases for other decisions ...
    }
});

copyToSummaryBtn.addEventListener('click', function() {
    summaryTextarea.style.display = 'block';
    copyToClipboardBtn.style.display = 'block';

    summaryTextarea.value += adviceFrame.contentDocument.body.innerText + "\n";
    summaryTextarea.value += decisionDropdown.options[decisionDropdown.selectedIndex].text + "\n";
    summaryTextarea.value += agreedPlanFrame.contentDocument.body.innerText + "\n";
});

copyToClipboardBtn.addEventListener('click', function() {
    summaryTextarea.select();
    document.execCommand('copy');
});
