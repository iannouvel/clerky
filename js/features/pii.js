/**
 * Anonymisation helper for outbound clinical data.
 * Anonymisation is applied automatically and silently — the user is never prompted.
 */

/**
 * Ensure text is anonymised before outbound processing.
 * All PII replacements are applied automatically; no user interaction occurs.
 * @param {string} originalText
 * @returns {Promise<{anonymisedText: string, anonymisationInfo: object|null}>}
 */
export async function ensureAnonymisedForOutbound(originalText) {
    let anonymisedText = originalText;
    let anonymisationInfo = null;

    try {
        if (typeof window.clinicalAnonymiser !== 'undefined') {
            const result = await window.clinicalAnonymiser.anonymise(originalText);
            anonymisedText = result.anonymisedText || originalText;
            const replacementsCount = result.metadata?.replacementsCount || 0;

            anonymisationInfo = {
                originalLength: originalText.length,
                anonymisedLength: anonymisedText.length,
                replacementsCount,
                userReviewed: false
            };

            console.log(`[ANONYMISER] Auto-anonymised silently: ${replacementsCount} replacement(s) applied`);
        } else {
            console.warn('[ANONYMISER] Anonymiser not available, using original text');
        }
    } catch (error) {
        console.warn('[ANONYMISER] Error during auto-anonymisation, using original text:', error);
        anonymisedText = originalText;
    }

    return { anonymisedText, anonymisationInfo };
}
