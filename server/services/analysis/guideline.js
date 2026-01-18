const { db } = require('../../config/firebase');
const { routeToAI } = require('../ai');
const { logAIInteraction } = require('../../utils/aiLogger');
// Load prompts configuration
// Note: In a full refactor, prompt loading should be centralized in a service
let prompts;
try {
    prompts = require('../../../prompts.json');
} catch (error) {
    console.error('Error loading prompts.json:', error);
    prompts = {};
}

/**
 * Analyzes a clinical note/transcript against a specific guideline
 * @param {string} transcript - The clinical note or transcript
 * @param {string} guidelineId - The ID of the guideline to check against
 * @param {string} userId - The user making the request
 * @returns {Promise<string>} - The analysis result
 */
async function analyzeNoteAgainstGuideline(transcript, guidelineId, userId) {
    if (!transcript) {
        throw new Error('Transcript is required');
    }

    if (!guidelineId) {
        throw new Error('Guideline ID is required');
    }

    console.log(`[DEBUG] analyzeNoteAgainstGuideline: Fetching guideline data for ID: ${guidelineId}`);

    const promptConfig = prompts.analyzeClinicalNote; // or guidelineRecommendations
    if (!promptConfig) {
        throw new Error('Prompt configuration not found (analyzeClinicalNote)');
    }

    // Try to get guideline from multiple collections
    const [guidelineDoc, condensedDoc] = await Promise.all([
        db.collection('guidelines').doc(guidelineId).get(),
        db.collection('guidelineCondensed').doc(guidelineId).get()
    ]);

    if (!guidelineDoc.exists) {
        throw new Error(`Guideline not found with ID: ${guidelineId}`);
    }

    const guidelineData = guidelineDoc.data();
    const condensedData = condensedDoc.exists ? condensedDoc.data() : null;

    // Prepare guideline content for AI
    const guidelineTitle = guidelineData.humanFriendlyTitle || guidelineData.title || guidelineData.fileName || guidelineId;
    const guidelineContent = condensedData?.condensed || guidelineData.content || guidelineData.condensed || 'No content available';

    console.log(`[DEBUG] Retrieved guideline: ${guidelineTitle}, content length: ${guidelineContent.length}`);

    // Format the messages for the AI with ID and title
    const messages = [
        { role: 'system', content: promptConfig.system_prompt },
        {
            role: 'user', content: promptConfig.prompt
                .replace('{{text}}', transcript)
                .replace('{{id}}', guidelineId)
                .replace('{{title}}', guidelineTitle)
                .replace('{{content}}', guidelineContent)
        }
    ];

    // Send to AI
    console.log(`[DEBUG] Sending to AI for guideline: ${guidelineId}`);
    const aiResponse = await routeToAI({ messages }, userId);

    console.log(`[DEBUG] AI response received:`, {
        success: !!aiResponse,
        hasContent: !!aiResponse?.content,
        contentLength: aiResponse?.content?.length,
        aiProvider: aiResponse?.ai_provider
    });

    if (!aiResponse || !aiResponse.content) {
        console.error(`[DEBUG] Invalid AI response:`, aiResponse);
        throw new Error('Invalid AI response');
    }

    // Log the interaction
    try {
        await logAIInteraction(
            {
                prompt: messages[1].content, // The user message content
                system_prompt: messages[0].content, // The system prompt
                guideline_id: guidelineId,
                guideline_title: guidelineTitle
            },
            {
                success: true,
                response: aiResponse.content,
                ai_provider: aiResponse.ai_provider,
                ai_model: aiResponse.ai_model,
                token_usage: aiResponse.token_usage
            },
            'analyzeNoteAgainstGuideline',
            userId
        );
    } catch (logError) {
        console.error(`[DEBUG] Error logging AI interaction:`, logError);
        // Don't fail the request if logging fails
    }

    return aiResponse.content;
}

module.exports = {
    analyzeNoteAgainstGuideline
};
