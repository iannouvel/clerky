// Browser Console Commands to Test Percentage Alignment
// Copy and paste these into your browser's developer console

// 1. Check current CSS values
console.log('=== Current CSS Values ===');
const guidelineContent = document.querySelector('.guideline-content');
if (guidelineContent) {
    const styles = window.getComputedStyle(guidelineContent);
    console.log('guideline-content align-items:', styles.alignItems);
    console.log('guideline-content justify-content:', styles.justifyContent);
    console.log('guideline-content display:', styles.display);
}

const relevance = document.querySelector('.relevance');
if (relevance) {
    const relStyles = window.getComputedStyle(relevance);
    console.log('relevance margin-left:', relStyles.marginLeft);
    console.log('relevance flex-shrink:', relStyles.flexShrink);
    console.log('relevance padding-top:', relStyles.paddingTop);
}

// 2. Apply the fix temporarily to test
console.log('\n=== Applying Test CSS ===');
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
console.log('Test CSS applied! Check the alignment now.');

// 3. Remove the test CSS
// Uncomment and run this to remove the test styles:
// document.getElementById('test-alignment-fix')?.remove();

// 4. Check all guideline items to see which ones have wrapped titles
console.log('\n=== Checking Guideline Items ===');
const guidelineItems = document.querySelectorAll('.guideline-item');
guidelineItems.forEach((item, index) => {
    const title = item.querySelector('.guideline-title');
    const relevance = item.querySelector('.relevance');
    if (title && relevance) {
        const titleHeight = title.offsetHeight;
        const titleLineHeight = parseFloat(window.getComputedStyle(title).lineHeight);
        const lines = Math.round(titleHeight / titleLineHeight);
        const relevanceTop = relevance.offsetTop - item.offsetTop;
        const titleTop = title.offsetTop - item.offsetTop;
        
        console.log(`Item ${index + 1}:`, {
            title: title.textContent.substring(0, 50) + '...',
            lines: lines,
            titleHeight: titleHeight,
            titleTop: titleTop,
            relevanceTop: relevanceTop,
            difference: relevanceTop - titleTop,
            isWrapped: lines > 1
        });
    }
});

// 5. Visual indicator - highlight misaligned items
console.log('\n=== Highlighting Items for Visual Check ===');
guidelineItems.forEach((item, index) => {
    const title = item.querySelector('.guideline-title');
    const relevance = item.querySelector('.relevance');
    if (title && relevance) {
        const titleHeight = title.offsetHeight;
        const titleLineHeight = parseFloat(window.getComputedStyle(title).lineHeight);
        const lines = Math.round(titleHeight / titleLineHeight);
        const relevanceTop = relevance.offsetTop - item.offsetTop;
        const titleTop = title.offsetTop - item.offsetTop;
        const difference = Math.abs(relevanceTop - titleTop);
        
        // Highlight items where percentage is not aligned with first line
        if (lines > 1 && difference > 5) {
            item.style.border = '2px solid red';
            console.log(`⚠️ Item ${index + 1} may be misaligned (difference: ${difference}px)`);
        } else {
            item.style.border = '2px solid green';
        }
    }
});

console.log('\n=== Done! Red borders = potentially misaligned, Green = aligned ===');




