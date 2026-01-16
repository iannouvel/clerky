
const fs = require('fs');
const path = require('path');

const filePath = 'server.js';

try {
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n');

    const funcs = [
        'function routeToAI',
        'function loadGuidelineLearning',
        'function formatLearningForPrompt',
        'function storeGuidelineLearning',
        'function getNextAvailableProvider'
    ];

    lines.forEach((line, index) => {
        funcs.forEach(func => {
            if (line.includes(func)) {
                console.log(`${index + 1}: ${line.trim().substring(0, 100)}`);
            }
        });
    });

} catch (e) {
    console.error('Error:', e);
}
