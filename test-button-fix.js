// Directly loaded script to fix test button
document.addEventListener('DOMContentLoaded', function() {
    console.log('DIRECT FIX: Setting up test button properly');
    const testBtn = document.getElementById('testBtn');
    if (testBtn) {
        // Clone to remove all existing handlers
        const newBtn = testBtn.cloneNode(true);
        testBtn.parentNode.replaceChild(newBtn, testBtn);
        
        // Add the proper click handler
        newBtn.addEventListener('click', function() {
            console.log('Test button clicked - using direct fix');
            
            // Check if guidelines are loaded
            if (!window.guidanceDataLoaded || !window.filenames || !window.filenames.length) {
                alert('Please wait for guidelines to load before generating a test scenario.');
                return;
            }
            
            // Use existing function
            window.showScenarioSelectionPopup();
        });
        
        console.log('DIRECT FIX: Test button handler installed successfully');
    } else {
        console.log('DIRECT FIX: Test button not found');
    }
}); 