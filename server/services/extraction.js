'use strict';

const { routeToAI } = require('./ai');

/**
 * Extracts simple practice points from guideline content.
 * Returns an array of {name, description} objects.
 */
async function extractPracticePoints(title, content, userId) {
    const systemPrompt = `You are extracting clinical practice points from a medical guideline.
Extract 50-200+ simple, testable, atomic practice points. Each point should be a clear clinical rule: "if X, then do Y".
Keep points atomic and unambiguous — never bundle multiple actions into one point.
Granular is better than abstract. Return ONLY valid JSON, no other text.`;

    const userPrompt = `Guideline: ${title}

Content:
${content}

Extract ALL practice points as a JSON array. Each point has:
- name: the clinical rule (one sentence, "do X" or "consider X")
- description: what this rule applies to (one sentence)

Example format:
[
  {"name": "Perform CTG monitoring", "description": "For all patients ≥28 weeks with vaginal bleeding"},
  {"name": "Obtain informed consent", "description": "Before any invasive procedure"}
]

Return the JSON array only. Aim for 50-200+ points.`;

    try {
        const result = await routeToAI({
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt }
            ]
        }, userId, null, 65000);

        if (!result?.content) throw new Error('No response from LLM');

        const cleaned = result.content.trim().replace(/```json\n?|\n?```/g, '');
        const points = JSON.parse(cleaned);

        if (!Array.isArray(points)) throw new Error('Response is not an array');

        // Validate structure
        const validated = points.map(p => ({
            name: (p.name || '').substring(0, 300),
            description: (p.description || '').substring(0, 500)
        })).filter(p => p.name.length > 0);

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
