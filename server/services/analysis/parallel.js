const { db, admin } = require('../../config/firebase');
const { getPromptText } = require('../../utils/promptManager');
const { routeToAI } = require('../ai');

/**
 * Process batch generation of transcripts
 * @param {Array} conditions 
 * @param {string} userId 
 * @param {number} maxConcurrent 
 * @param {boolean} forceRegenerate 
 * @returns {Promise<Object>}
 */
async function processBatchGeneration(conditions, userId, maxConcurrent = 3, forceRegenerate = false) {
    console.log('[BATCH-GENERATION] Starting processing:', {
        totalConditions: conditions.length,
        maxConcurrent,
        forceRegenerate
    });

    const results = {
        successful: [],
        failed: [],
        skipped: []
    };

    // Load the (editable) test transcript prompt once (Firestore/global cache first, then prompts.json)
    const testPrompt = await getPromptText('testTranscript');

    // Process conditions in chunks to limit concurrent AI calls
    for (let i = 0; i < conditions.length; i += maxConcurrent) {
        const chunk = conditions.slice(i, i + maxConcurrent);

        console.log('[BATCH-GENERATION] Processing chunk:', {
            chunkNumber: Math.floor(i / maxConcurrent) + 1,
            totalChunks: Math.ceil(conditions.length / maxConcurrent),
            chunkSize: chunk.length
        });

        // Process chunk concurrently
        const chunkPromises = chunk.map(async (condition) => {
            try {
                const fullPrompt = testPrompt + condition.name;

                console.log('[BATCH-GENERATION] Generating transcript for:', condition.name);

                const aiResponse = await routeToAI(fullPrompt, userId);

                if (!aiResponse || !aiResponse.content) {
                    throw new Error('Failed to generate transcript from AI');
                }

                const transcript = aiResponse.content;

                // Update the document in Firebase
                const conditionRef = db.collection('clinicalConditions').doc(condition.id);
                await conditionRef.update({
                    transcript: transcript,
                    lastGenerated: admin.firestore.FieldValue.serverTimestamp(),
                    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                    version: admin.firestore.FieldValue.increment(1)
                });

                results.successful.push({
                    id: condition.id,
                    name: condition.name,
                    category: condition.category,
                    transcriptLength: transcript.length
                });

                console.log('[BATCH-GENERATION] Successfully generated transcript for:', condition.name);

            } catch (error) {
                console.error('[BATCH-GENERATION] Failed to generate transcript for:', condition.name, error);
                results.failed.push({
                    id: condition.id,
                    name: condition.name,
                    category: condition.category,
                    error: error.message
                });
            }
        });

        // Wait for chunk to complete before processing next chunk
        await Promise.allSettled(chunkPromises);

        // Add small delay between chunks to avoid overwhelming the AI service
        if (i + maxConcurrent < conditions.length) {
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    }

    console.log('[BATCH-GENERATION] Batch generation completed:', {
        totalProcessed: conditions.length,
        successful: results.successful.length,
        failed: results.failed.length,
        skipped: results.skipped.length
    });

    // Could optionally store results or notify admin
    return results;
}

module.exports = {
    processBatchGeneration
};
