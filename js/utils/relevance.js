/**
 * Utility functions for handling relevance scores in guideline matching.
 */

/**
 * Extract numeric relevance score from descriptive format.
 * Handles various input formats:
 * - Numeric values (0.85)
 * - Descriptive text ("high relevance (score 0.8-1.0)")
 * - Text descriptions ("high", "medium", "low")
 * 
 * @param {string|number} relevanceText - The relevance value to parse
 * @returns {number} A numeric score between 0 and 1
 */
export function extractRelevanceScore(relevanceText) {
    if (typeof relevanceText === 'number') {
        return relevanceText; // Already numeric
    }

    if (!relevanceText) {
        return 0.5; // Default fallback
    }

    // Extract score from formats like "high relevance (score 0.8-1.0)" or "0.85"
    const match = relevanceText.match(/score\s+([\d.]+)(?:-[\d.]+)?|^([\d.]+)$/);
    if (match) {
        return parseFloat(match[1] || match[2]);
    }

    // Fallback based on text description
    const text = relevanceText.toLowerCase();
    if (text.includes('high') || text.includes('most')) return 0.9;
    if (text.includes('medium') || text.includes('potentially')) return 0.65;
    if (text.includes('low') || text.includes('less')) return 0.35;
    if (text.includes('not') || text.includes('irrelevant')) return 0.1;

    return 0.5; // Default fallback
}

/**
 * Format a numeric relevance score for display.
 * 
 * @param {number|string} relevanceValue - The relevance score
 * @returns {string} Formatted string like "85%"
 */
export function formatRelevanceScore(relevanceValue) {
    const numericScore = typeof relevanceValue === 'number'
        ? relevanceValue
        : extractRelevanceScore(relevanceValue);

    // Convert to percentage
    const percentage = Math.round(numericScore * 100);
    return `${percentage}%`;
}

/**
 * Get a descriptive category for a relevance score.
 * 
 * @param {number} score - Numeric score between 0 and 1
 * @returns {string} Category label
 */
export function getRelevanceCategory(score) {
    if (score >= 0.8) return 'mostRelevant';
    if (score >= 0.5) return 'potentiallyRelevant';
    if (score >= 0.2) return 'lessRelevant';
    return 'notRelevant';
}
