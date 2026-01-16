
const fs = require('fs');
const path = require('path');

const filePath = 'server.js';
const outputPath = 'analysis.txt';

try {
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n');
    let output = '';

    const patterns = [
        /app\.(get|post|put|delete)\(/,
        /admin\.initializeApp/,
        /mongoose\.connect/,
        /admin\.firestore/,
        /router\.(get|post|put|delete)\(/,
        /\.listen\(/
    ];

    let count = 0;
    lines.forEach((line, index) => {
        if (patterns.some(p => p.test(line))) {
            if (count < 500) { // Limit to 500 matches
                output += `${index + 1}: ${line.trim()}\n`;
                count++;
            }
        }
    });

    fs.writeFileSync(outputPath, output);
    console.log('Analysis complete. Written to ' + outputPath);
} catch (e) {
    console.error('Error:', e);
}
