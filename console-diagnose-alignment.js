// Comprehensive diagnostic and fix for percentage alignment
(function() {
    console.log('=== Diagnosing Alignment Issue ===\n');
    
    const guidelineItems = document.querySelectorAll('.guideline-item');
    const issues = [];
    
    guidelineItems.forEach((item, index) => {
        const title = item.querySelector('.guideline-title');
        const relevance = item.querySelector('.relevance');
        const content = item.querySelector('.guideline-content');
        
        if (title && relevance && content) {
            const titleRect = title.getBoundingClientRect();
            const relevanceRect = relevance.getBoundingClientRect();
            const contentRect = content.getBoundingClientRect();
            
            const titleStyles = window.getComputedStyle(title);
            const relevanceStyles = window.getComputedStyle(relevance);
            const contentStyles = window.getComputedStyle(content);
            
            const titleLineHeight = parseFloat(titleStyles.lineHeight);
            const titleHeight = titleRect.height;
            const estimatedLines = Math.round(titleHeight / titleLineHeight);
            
            // Calculate vertical positions relative to content container
            const titleTop = titleRect.top - contentRect.top;
            const relevanceTop = relevanceRect.top - contentRect.top;
            const difference = Math.abs(relevanceTop - titleTop);
            
            const isWrapped = estimatedLines > 1;
            const isMisaligned = difference > 3; // More than 3px difference
            
            if (isWrapped || isMisaligned) {
                issues.push({
                    index: index + 1,
                    title: title.textContent.substring(0, 50),
                    lines: estimatedLines,
                    titleTop: titleTop.toFixed(1),
                    relevanceTop: relevanceTop.toFixed(1),
                    difference: difference.toFixed(1),
                    isWrapped: isWrapped,
                    isMisaligned: isMisaligned,
                    alignItems: contentStyles.alignItems,
                    titleLineHeight: titleLineHeight,
                    relevanceLineHeight: parseFloat(relevanceStyles.lineHeight)
                });
            }
        }
    });
    
    console.log(`Found ${issues.length} items with potential alignment issues:\n`);
    issues.forEach(issue => {
        console.log(`Item ${issue.index}: "${issue.title}..."`);
        console.log(`  Lines: ${issue.lines}, Difference: ${issue.difference}px`);
        console.log(`  Title top: ${issue.titleTop}px, Relevance top: ${issue.relevanceTop}px`);
        console.log(`  align-items: ${issue.alignItems}`);
        console.log('');
    });
    
    // Try a different fix: align-items: flex-start with matching line-heights
    console.log('=== Applying Alternative Fix ===\n');
    
    const existing = document.getElementById('test-alignment-fix');
    if (existing) existing.remove();
    
    const style = document.createElement('style');
    style.id = 'test-alignment-fix';
    style.textContent = `
        .guideline-content {
            align-items: flex-start !important;
        }
        .guideline-title {
            line-height: 1.3 !important;
        }
        .relevance {
            line-height: 1.3 !important;
            padding-top: 0 !important;
            margin-top: 0 !important;
        }
    `;
    document.head.appendChild(style);
    
    console.log('✅ Applied fix: flex-start alignment with matching line-heights');
    console.log('Check the percentages now - they should align with the first line');
    
    return `Diagnosis complete. ${issues.length} items checked.`;
})();






