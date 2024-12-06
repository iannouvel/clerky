document.addEventListener('DOMContentLoaded', function() {
    const mainContainer = document.querySelector('.container');
    const proformaBtn = document.getElementById('proformaBtn');
    
    // Create the two-column view structure
    const twoColumnView = document.createElement('div');
    twoColumnView.className = 'two-column-view hidden';
    twoColumnView.innerHTML = `
        <div class="left-column">
            <div class="column-header">Transcript</div>
            <textarea id="proformaTranscript"></textarea>
        </div>
        <div class="right-column">
            <div class="column-header">Proforma</div>
            <div class="proforma-content"></div>
        </div>
    `;
    
    // Add the two-column view to the container
    mainContainer.appendChild(twoColumnView);
    
    // Get references to the views and textareas
    const threeColumnView = document.querySelector('.container > div:first-child');
    const mainTranscript = document.getElementById('summary');
    const proformaTranscript = document.getElementById('proformaTranscript');
    
    proformaBtn.addEventListener('click', function() {
        const isProformaView = twoColumnView.classList.contains('hidden');
        
        if (isProformaView) {
            // Switch to proforma view
            threeColumnView.classList.add('hidden');
            twoColumnView.classList.remove('hidden');
            proformaBtn.classList.add('active');
            proformaTranscript.value = mainTranscript.value;
        } else {
            // Switch back to main view
            threeColumnView.classList.remove('hidden');
            twoColumnView.classList.add('hidden');
            proformaBtn.classList.remove('active');
            mainTranscript.value = proformaTranscript.value;
        }
    });
    
    // Keep transcripts synchronized
    mainTranscript.addEventListener('input', () => {
        proformaTranscript.value = mainTranscript.value;
    });
    
    proformaTranscript.addEventListener('input', () => {
        mainTranscript.value = proformaTranscript.value;
    });
});