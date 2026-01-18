const { db } = require('../config/firebase');
const path = require('path');

let cachedPrompts = null; // Module-level cache replacing global.prompts usage

/**
 * Retrieve prompt text by key
 * @param {string} promptKey 
 * @returns {Promise<string>}
 */
async function getPromptText(promptKey) {
    // 1) Module cache
    let loadedPrompts = cachedPrompts;

    // 2) Firestore (only if not already cached)
    if (!loadedPrompts) {
        try {
            const firestoreDoc = await db.collection('settings').doc('prompts').get();
            if (firestoreDoc.exists && firestoreDoc.data()?.prompts) {
                loadedPrompts = firestoreDoc.data().prompts;
                cachedPrompts = loadedPrompts;
                console.log('[PROMPTS] Loaded prompts from Firestore (for promptKey):', promptKey);
            }
        } catch (error) {
            console.warn('[PROMPTS] Failed to load prompts from Firestore, falling back to prompts.json:', error.message);
        }
    }

    // 3) prompts.json fallback
    if (!loadedPrompts) {
        try {
            // Path relative to this file: ../../prompts.json
            const promptsPath = path.join(__dirname, '../../prompts.json');

            // Clear require cache to get fresh version (in case it changed)
            delete require.cache[require.resolve(promptsPath)];
            loadedPrompts = require(promptsPath);
            cachedPrompts = loadedPrompts;
            console.log('[PROMPTS] Loaded prompts from prompts.json (for promptKey):', promptKey);
        } catch (error) {
            console.error('[PROMPTS] Failed to load prompts.json:', error.message);
        }
    }

    const promptConfig = loadedPrompts?.[promptKey];
    const promptText = promptConfig?.prompt;

    if (!promptText || typeof promptText !== 'string') {
        throw new Error(`Prompt '${promptKey}' not found in prompts configuration`);
    }

    return promptText;
}

/**
 * Get all cached prompts
 * @returns {Promise<Object>}
 */
async function getAllPrompts() {
    if (!cachedPrompts) {
        // Trigger load via getPromptText for a dummy key or just replicate load logic
        // Replicating load logic (simplified):
        try {
            const firestoreDoc = await db.collection('settings').doc('prompts').get();
            if (firestoreDoc.exists && firestoreDoc.data()?.prompts) {
                cachedPrompts = firestoreDoc.data().prompts;
            } else {
                const promptsPath = path.join(__dirname, '../../prompts.json');
                delete require.cache[require.resolve(promptsPath)];
                cachedPrompts = require(promptsPath);
            }
        } catch (e) {
            console.error('[PROMPTS] Error loading all prompts:', e);
            const promptsPath = path.join(__dirname, '../../prompts.json');
            cachedPrompts = require(promptsPath);
        }
    }
    return cachedPrompts;
}

/**
 * Update the prompt cache
 * @param {Object} newPrompts 
 */
function updatePromptsCache(newPrompts) {
    cachedPrompts = newPrompts;
    console.log('[PROMPTS] Cache updated manually');
}

module.exports = {
    getPromptText,
    getAllPrompts,
    updatePromptsCache
};
