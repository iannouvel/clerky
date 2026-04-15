'use strict';

const { routeToAI } = require('./ai');

/**
 * Extracts simple practice points from guideline content.
 * Returns an array of simple if/then rule strings.
 */
async function extractPracticePoints(title, content, userId) {
    const prompt = `From this clinical guideline, extract simple if/then practice points.

Guideline: ${title}

Content:
${content}

Return ONLY a JSON array of strings. Each string is one simple clinical rule. Examples:
["If patient has symptom X, then do Y", "For condition A, consider treatment B"]

Extract all practice points. Return the JSON array only.`;

    try {
        const result = await routeToAI({
            messages: [{ role: 'user', content: prompt }]
        }, userId, null, 65000);

        if (!result?.content) throw new Error('No response from LLM');

        const cleaned = result.content.trim().replace(/```json\n?|\n?```/g, '');
        const points = JSON.parse(cleaned);

        if (!Array.isArray(points)) throw new Error('Response is not an array');

        // Simple validation
        const validated = points
            .map(p => String(p || '').trim())
            .filter(p => p.length > 0);

        return {
            success: true,
            practicePoints: validated,
            count: validated.length
        };
    } catch (err) {
        console.error('[EXTRACT] Error:', err.message);
        return {
            success: false,
            error: err.message
        };
    }
}

module.exports = { extractPracticePoints };
