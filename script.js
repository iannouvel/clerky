document.addEventListener('DOMContentLoaded', function() {
    const proformaBtn = document.getElementById('proformaBtn');
    const threeColumnView = document.getElementById('threeColumnView');
    const twoColumnView = document.getElementById('twoColumnView');
    const mainTranscript = document.getElementById('summary');
    const proformaTranscript = document.getElementById('proformaTranscript');
    
    proformaBtn.addEventListener('click', function() {
        const isProformaView = !twoColumnView.classList.contains('hidden');
        
        if (!isProformaView) {
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