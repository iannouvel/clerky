// Quick test - apply baseline alignment with feedback
(function() {
    // Remove any existing test styles first
    const existing = document.getElementById('test-alignment-fix');
    if (existing) {
        existing.remove();
        console.log('Removed existing test styles');
    }
    
    // Create and apply new test styles
    const style = document.createElement('style');
    style.id = 'test-alignment-fix';
    style.textContent = `
        .guideline-content {
            align-items: baseline !important;
        }
        .relevance {
            padding-top: 0 !important;
        }
    `;
    document.head.appendChild(style);
    
    // Verify it was applied
    const testContent = document.querySelector('.guideline-content');
    if (testContent) {
        const computed = window.getComputedStyle(testContent);
        console.log('✅ Test CSS applied!');
        console.log('Current align-items:', computed.alignItems);
        console.log('Expected: baseline');
        
        if (computed.alignItems === 'baseline') {
            console.log('✅ Alignment fix is active! Check the percentages now.');
        } else {
            console.log('⚠️ CSS might not have applied. Check for conflicts.');
        }
    } else {
        console.log('⚠️ No .guideline-content elements found on page');
    }
    
    return 'Test complete - check console messages above';
})();



