const { db, admin } = require('../config/firebase');
const { debugLog } = require('../config/logger');
const fs = require('fs');
const path = require('path');

/**
 * Log AI interaction to Firestore or file system as fallback
 * @param {string|object} prompt - The prompt sent to AI
 * @param {string|object} response - The response received from AI
 * @param {string} endpoint - The endpoint or operation name
 * @param {string} userId - The user ID initiating the request
 * @returns {Promise<boolean>} - Success status
 */
async function logAIInteraction(prompt, response, endpoint, userId = null) {
    try {
        // OPTIMISATION: Only log important interactions to reduce noise
        const importantEndpoints = [
            'submit', 'reply', 'findRelevantGuidelines', 'checkAgainstGuidelines',
            'generateClinicalNote', 'error', 'failure', 'handleAction', 'handleIssues',
            'analyzeNoteAgainstGuideline'
        ];

        const shouldLog = importantEndpoints.some(important => endpoint.includes(important)) ||
            (response && response.error) ||
            (response && response.critical);

        if (!shouldLog) {
            // Skipping non-critical endpoint logging to reduce noise
            return true;
        }

        // Get current timestamp
        const timestamp = new Date().toISOString();

        // Clean prompt for logging
        let cleanedPrompt = prompt;
        if (typeof prompt === 'object') {
            cleanedPrompt = JSON.stringify(prompt, null, 2);
        }

        // Clean response for logging
        let cleanedResponse = '';
        let ai_provider = 'DeepSeek'; // Default to DeepSeek
        let ai_model = 'deepseek-chat'; // Default model
        let token_usage = null; // Initialize token usage

        // Extract AI information if it exists in the response
        if (response && typeof response === 'object') {
            // Extract token usage if available
            if (response.token_usage) {
                token_usage = response.token_usage;
            } else if (response.response && response.response.token_usage) {
                token_usage = response.response.token_usage;
            }

            // If response has ai_provider and ai_model directly
            if (response.ai_provider) {
                ai_provider = response.ai_provider;
                ai_model = response.ai_model || (ai_provider === 'OpenAI' ? 'gpt-3.5-turbo' : 'deepseek-chat');
            }
            // If response has nested response property with ai info
            else if (response.response && typeof response.response === 'object') {
                if (response.response.ai_provider) {
                    ai_provider = response.response.ai_provider;
                    ai_model = response.response.ai_model || (ai_provider === 'OpenAI' ? 'gpt-3.5-turbo' : 'deepseek-chat');
                }
            }

            // Extract the actual content from the response structure
            if (endpoint === 'handleGuidelines' || endpoint === 'handleIssues') {
                if (response.success === true && response.response) {
                    if (typeof response.response === 'string') {
                        cleanedResponse = response.response;
                    } else if (Array.isArray(response.response)) {
                        cleanedResponse = response.response.join('\n');
                    } else if (typeof response.response === 'object') {
                        if ('content' in response.response) {
                            cleanedResponse = response.response.content;
                        } else if ('text' in response.response) {
                            cleanedResponse = response.response.text;
                        } else if ('message' in response.response) {
                            cleanedResponse = response.response.message;
                        } else {
                            cleanedResponse = JSON.stringify(response.response, null, 2);
                        }
                    }
                }
            } else {
                if (response.content) {
                    cleanedResponse = response.content;
                } else if (response.response && typeof response.response === 'string') {
                    cleanedResponse = response.response;
                } else if (response.response && response.response.content) {
                    cleanedResponse = response.response.content;
                } else if (response.text) {
                    cleanedResponse = response.text;
                } else if (typeof response === 'string') {
                    cleanedResponse = response;
                } else if (typeof response === 'object') {
                    cleanedResponse = JSON.stringify(response, null, 2);
                }
            }
        }

        if (!cleanedResponse || cleanedResponse.trim() === '') {
            cleanedResponse = '[Empty response or response extraction failed]';
        }

        // Prepare data for Firestore
        const isError = endpoint.includes('error') || endpoint.includes('failure') || (response && response.error);

        // Save to Firestore if available
        if (db) {
            try {
                const MAX_CONTENT_LENGTH = 50000;
                await db.collection('aiInteractions').add({
                    timestamp: admin.firestore.FieldValue.serverTimestamp(),
                    userId: userId || 'system',
                    endpoint: endpoint,
                    provider: ai_provider,
                    model: ai_model,
                    success: !isError,
                    promptLength: cleanedPrompt.length,
                    responseLength: cleanedResponse.length,
                    fullPrompt: cleanedPrompt.length > MAX_CONTENT_LENGTH
                        ? cleanedPrompt.substring(0, MAX_CONTENT_LENGTH) + '\n\n[TRUNCATED]'
                        : cleanedPrompt,
                    fullResponse: cleanedResponse.length > MAX_CONTENT_LENGTH
                        ? cleanedResponse.substring(0, MAX_CONTENT_LENGTH) + '\n\n[TRUNCATED]'
                        : cleanedResponse,
                    tokenUsage: token_usage,
                    critical: isError
                });

                debugLog(`Successfully logged AI interaction to Firestore for endpoint: ${endpoint}`);
                return true;
            } catch (firestoreError) {
                console.error('Error saving to Firestore in logAIInteraction:', firestoreError);
            }
        }

        // Fallback: emergency local save
        try {
            const localLogsDir = path.join(__dirname, '../../logs/emergency-logs');
            if (!fs.existsSync(localLogsDir)) {
                fs.mkdirSync(localLogsDir, { recursive: true });
            }

            const fileTimestamp = timestamp.replace(/[:.]/g, '-');
            const emergencyLogPath = path.join(localLogsDir, `${fileTimestamp}-${endpoint}-emergency.json`);

            fs.writeFileSync(emergencyLogPath, JSON.stringify({
                timestamp,
                userId: userId || 'system',
                endpoint,
                prompt: cleanedPrompt,
                response: cleanedResponse,
                ai_provider,
                ai_model,
                token_usage,
                isError
            }, null, 2));

            return true;
        } catch (emergencyError) {
            console.error('Failed to save emergency logs:', emergencyError);
            return false;
        }
    } catch (error) {
        console.error('Unexpected error in logAIInteraction:', error);
        return false;
    }
}

module.exports = {
    logAIInteraction
};
