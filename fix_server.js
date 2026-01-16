const fs = require('fs');

try {
    const content = fs.readFileSync('server.js', 'utf8');
    let newContent = content;

    console.log(`Original size: ${content.length} bytes`);

    // Helper to remove block
    function removeBlock(text, startMarker, endMarker, keepStart = true) {
        const startIndex = text.indexOf(startMarker);
        if (startIndex === -1) {
            console.log(`Start marker not found: ${startMarker.substring(0, 50)}...`);
            return text;
        }
        const searchFrom = startIndex + startMarker.length;
        const endIndex = text.indexOf(endMarker, searchFrom);
        if (endIndex === -1) {
            console.log(`End marker not found after start marker: ${endMarker.substring(0, 50)}...`);
            return text;
        }

        console.log(`Removing block between markers...`);
        const before = text.substring(0, startIndex + (keepStart ? startMarker.length : 0));
        const after = text.substring(endIndex);
        return before + "\n\n" + after;
    }

    // 1. Constants/Scrapers
    // garbage starts after: // Constants, Scrapers...
    // garbage ends before: // Initialize Express app
    newContent = removeBlock(newContent,
        "// Constants, Scrapers, and Helpers have been extracted to server/config, server/services, and server/utils",
        "// Initialize Express app"
    );

    // 2. Duplicate prompt endpoints
    newContent = removeBlock(newContent,
        "// Duplicate prompt endpoints removed",
        "// Override console.error"
    );

    // 3. User Prefs
    newContent = removeBlock(newContent,
        "// User Preferences and AI Routine functions moved to server/services/preferences.js and server/services/ai.js",
        "app.post('/handleAction'"
    );

    // 4. AI Analysis
    newContent = removeBlock(newContent,
        "// AI Analysis functions moved to server/services/ai.js",
        "app.post('/getPracticePointSuggestions'"
    );

    // 5. Prompt Routes (Trailing)
    const promptStartMarker = "app.use('/', promptsRouter);";
    const promptStartIndex = newContent.indexOf(promptStartMarker);
    if (promptStartIndex !== -1) {
        console.log("Removing trailing prompt routes...");
        newContent = newContent.substring(0, promptStartIndex + promptStartMarker.length);
        newContent += "\n";
    } else {
        console.log("Prompt start marker not found!");
    }

    console.log(`New size: ${newContent.length} bytes`);
    fs.writeFileSync('server.js', newContent);
    console.log('server.js updated successfully.');

} catch (err) {
    console.error('Error:', err);
}
