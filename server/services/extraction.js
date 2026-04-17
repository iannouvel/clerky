'use strict';

const { routeToAI } = require('./ai');
const { db } = require('../config/firebase');

const EXTRACTION_PROMPT = `From this guideline, extract all the relevant practice points for clinical management of individual patients.

Can you summarise this as a numbered list of individual practice points, written in the if-then style? Please break down complex practice points into individual simpler ones, if required.

Return ONLY the practice points as a numbered list. Each line should be one simple practice point in if-then style. No JSON, no markdown, just plain numbered list.`;

/**
 * Get raw AI response for practice point extraction (no JSON parsing)
 * Returns the plain text numbered list from the AI
 */
async function extractPracticePointsRaw(title, content, userId) {
    const prompt = `Guideline: ${title}

Content:
${content}

${EXTRACTION_PROMPT}`;

    try {
        const result = await routeToAI(prompt, userId);

        if (!result?.content) throw new Error('No response from LLM');

        return {
            success: true,
            rawResponse: result.content.trim()
        };
    } catch (err) {
        console.error('[EXTRACT_RAW] Error:', err.message);
        return {
            success: false,
            error: err.message
        };
    }
}

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
        const result = await routeToAI(prompt, userId);

        if (!result?.content) throw new Error('No response from LLM');

        let cleaned = result.content.trim().replace(/```json\n?|\n?```/g, '');

        // Handle JSON parsing errors by cleaning problematic content
        let points;
        try {
            points = JSON.parse(cleaned);
        } catch (parseErr) {
            // If initial parse fails, try to extract individual strings manually
            console.warn('[EXTRACT] JSON parse failed, attempting recovery:', parseErr.message);
            console.warn('[EXTRACT] Raw content length:', cleaned.length);

            // Strategy 1: Try to fix common JSON issues
            let fixedJson = cleaned
                // Handle newlines in strings by escaping them
                .replace(/[\r\n]/g, ' ')
                // Remove any trailing commas before ] or }
                .replace(/,(\s*[}\]])/g, '$1')
                // Handle unescaped quotes in values (very basic attempt)
                .replace(/: "([^"]*)([^\\])"([^"])/g, ': "$1$2\\"$3');

            try {
                points = JSON.parse(fixedJson);
                console.log('[EXTRACT] Successfully parsed after fixing common issues');
            } catch (fixErr) {
                // Strategy 2: Extract individual quoted strings as fallback
                console.warn('[EXTRACT] Fixed JSON parse also failed, extracting strings manually');

                // More comprehensive regex pattern for quoted strings
                // Handles escaped quotes and newlines within strings
                const stringPattern = /"(?:[^"\\]|\\.)*"/g;
                const matches = cleaned.match(stringPattern);

                if (!matches || matches.length === 0) {
                    throw new Error(`JSON parse failed and no strings could be extracted: ${parseErr.message}`);
                }

                console.log(`[EXTRACT] Found ${matches.length} quoted strings in response`);

                // Extract and unescape the strings
                points = matches.map(m => {
                    try {
                        return JSON.parse(m);
                    } catch (e) {
                        // Fallback: remove quotes and unescape manually
                        const unquoted = m.slice(1, -1);
                        return unquoted.replace(/\\"/g, '"').replace(/\\\\/g, '\\');
                    }
                });

                console.log(`[EXTRACT] Recovered ${points.length} strings from malformed JSON`);
            }
        }

        if (!Array.isArray(points)) throw new Error('Response is not an array');

        // Simple validation
        const validated = points
            .map(p => String(p || '').trim())
            .filter(p => p.length > 0 && p.length > 10); // Filter out very short strings (likely not practice points)

        console.log(`[EXTRACT] Validated: ${validated.length} practice points (filtered from ${points.length})`);

        return {
            success: true,
            practicePoints: validated,
            count: validated.length
        };
    } catch (err) {
        console.error('[EXTRACT] Error:', err.message);
        console.error('[EXTRACT] Stack:', err.stack);
        return {
            success: false,
            error: err.message
        };
    }
}

/**
 * Saves extracted practice points as individual documents to Firestore
 * Creates a subcollection under the guideline document
 */
async function savePracticePoints(guidelineId, points) {
    try {
        if (!guidelineId || !Array.isArray(points) || points.length === 0) {
            throw new Error('Invalid guidelineId or points array');
        }

        const guidelineRef = db.collection('guidelines').doc(guidelineId);
        const practicePointsRef = guidelineRef.collection('practicePoints');

        const batch = db.batch();
        const savedPoints = [];

        for (const point of points) {
            if (!point || typeof point !== 'string') continue;

            const docRef = practicePointsRef.doc();
            const pointData = {
                text: point.trim(),
                createdAt: new Date(),
                status: 'extracted',
                order: savedPoints.length + 1,
                // Initialize context structure for evolutionary refinement
                context: {
                    triggers: [],           // Clinical conditions that activate this rule
                    criteria: '',           // Patient populations/scenarios where it applies
                    exceptions: [],         // When NOT to apply
                    edgeCases: [],          // Known ambiguities
                    version: 1,
                    lastRefined: new Date()
                },
                // Track application history for context evolution
                applicationHistory: [],
                // Evolution log tracks how context improves over time
                evolution: {
                    version: 1,
                    refinements: []
                }
            };

            batch.set(docRef, pointData);
            savedPoints.push({
                id: docRef.id,
                ...pointData
            });
        }

        await batch.commit();

        return {
            success: true,
            savedCount: savedPoints.length,
            details: {
                guidelineId,
                totalPoints: savedPoints.length,
                points: savedPoints
            }
        };
    } catch (err) {
        console.error('[SAVE_POINTS] Error:', err.message);
        return {
            success: false,
            error: err.message
        };
    }
}

module.exports = { extractPracticePointsRaw, extractPracticePoints, savePracticePoints };
