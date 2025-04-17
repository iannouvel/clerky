// Direct fix for the test button problem
(function() {
    console.log("🔧 Direct fix loading...");
    
    function fixTestButton() {
        console.log("🔍 Looking for test button");
        const testBtn = document.getElementById('testBtn');
        
        if (testBtn) {
            console.log("✅ Test button found, applying fix");
            
            // Remove all listeners by cloning
            const newBtn = testBtn.cloneNode(true);
            testBtn.parentNode.replaceChild(newBtn, testBtn);
            
            // Add a single clean implementation
            newBtn.addEventListener('click', function() {
                console.log("🚀 Test button clicked");
                
                // Check if guidelines are loaded
                if (!window.guidanceDataLoaded || !window.filenames || !window.filenames.length) {
                    alert('Please wait for guidelines to load before generating a test scenario.');
                    return;
                }
                
                // Show the popup using the existing function
                if (typeof window.showScenarioSelectionPopup === 'function') {
                    window.showScenarioSelectionPopup();
                } else {
                    console.error("❌ showScenarioSelectionPopup function not found");
                    alert("Error: Could not find the scenario selection function. Please try refreshing the page.");
                }
            });
            
            console.log("✨ Fix successfully applied to test button");
        } else {
            console.log("❓ Test button not found, will try again when DOM is ready");
        }
    }
    
    // Try to run immediately
    fixTestButton();
    
    // Also run when DOM content is loaded
    document.addEventListener('DOMContentLoaded', fixTestButton);
    
    // Also run when window is fully loaded
    window.addEventListener('load', fixTestButton);
    
    console.log("🔧 Direct fix initialized");
})(); 