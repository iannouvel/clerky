'use strict';

const { routeToAI } = require('./ai');

/**
 * Extracts simple practice points from guideline content.
 * Returns an array of simple if/then rule strings.
 */
async function extractPracticePoints(title, content, userId) {
    const prompt = `From this guideline, extract all the relevant practice points for clinical management of individual patients (ie don't worry about audit standards for the unit, this is only to guide individuals making decisions).

Guideline: ${title}

Content:
${content}

Can you summarise this as a numbered list of individual practice points, written in the if-then style? Please break down complex practice points into individual simpler ones, if required.

Return ONLY a JSON array of strings (no numbering). Each string is one simple practice point in if-then style.`;

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
