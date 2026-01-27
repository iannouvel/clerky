/**
 * Guidelines Management
 * Features for syncing, repairing, and viewing guideline data
 */

import { auth } from '../../firebase-init.js';
import { SERVER_URL } from '../api/config.js';
import { unescapeHtml, escapeHtml } from '../utils/text.js';

// Module state
let contentRepairInProgress = false;

/**
 * Sync guidelines in batches to avoid timeout
 * @param {string} idToken - Auth token
 * @param {number} batchSize - Number of items per batch
 * @param {number} maxBatches - Maximum batches to run
 * @returns {Promise<Object>} Sync result stats
 */
export async function syncGuidelinesInBatches(idToken, batchSize = 3, maxBatches = 20) {
    console.log(`[BATCH_SYNC] Starting batch sync with batchSize=${batchSize}, maxBatches=${maxBatches}`);

    let totalProcessed = 0;
    let totalSucceeded = 0;
    let totalFailed = 0;
    let batchCount = 0;
    let remaining = 1; // Start with 1 to enter the loop

    try {
        while (remaining > 0 && batchCount < maxBatches) {
            batchCount++;
            console.log(`[BATCH_SYNC] Starting batch ${batchCount}...`);

            const response = await fetch(`${SERVER_URL}/syncGuidelinesBatch`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${idToken}`
                },
                body: JSON.stringify({ batchSize })
            });

            if (!response.ok) {
                console.error(`[BATCH_SYNC] Batch ${batchCount} failed with status ${response.status}`);
                break;
            }

            const result = await response.json();
            console.log(`[BATCH_SYNC] Batch ${batchCount} result:`, result);

            totalProcessed += result.processed || 0;
            totalSucceeded += result.succeeded || 0;
            totalFailed += result.failed || 0;
            remaining = result.remaining || 0;

            console.log(`[BATCH_SYNC] Progress: ${totalSucceeded} succeeded, ${totalFailed} failed, ${remaining} remaining`);

            // If no more remaining, we're done
            if (remaining === 0) {
                console.log('[BATCH_SYNC] All guidelines synced!');
                break;
            }

            // Small delay between batches to avoid overwhelming the server
            if (remaining > 0) {
                console.log(`[BATCH_SYNC] Waiting 2 seconds before next batch...`);
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
        }

        return {
            success: true,
            totalProcessed,
            totalSucceeded,
            totalFailed,
            batchesRun: batchCount,
            remaining
        };

    } catch (error) {
        console.error('[BATCH_SYNC] Error during batch sync:', error);
        return {
            success: false,
            error: error.message,
            totalProcessed,
            totalSucceeded,
            totalFailed
        };
    }
}

/**
 * Repair content for guidelines with missing content/condensed
 * @param {string} idToken - Auth token
 * @param {number} batchSize - Number of items per batch
 * @param {number} maxBatches - Maximum batches to run
 * @returns {Promise<Object>} Repair result stats
 */
export async function repairGuidelineContent(idToken, batchSize = 5, maxBatches = 10) {
    console.log(`[CONTENT_REPAIR] Starting content repair with batchSize=${batchSize}, maxBatches=${maxBatches}`);

    let totalProcessed = 0;
    let totalSucceeded = 0;
    let totalFailed = 0;
    let batchCount = 0;
    let remaining = 1; // Start with 1 to enter the loop

    try {
        while (remaining > 0 && batchCount < maxBatches) {
            batchCount++;
            console.log(`[CONTENT_REPAIR] Starting batch ${batchCount}...`);

            const response = await fetch(`${SERVER_URL}/repairGuidelineContent`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${idToken}`
                },
                body: JSON.stringify({ batchSize })
            });

            if (!response.ok) {
                console.error(`[CONTENT_REPAIR] Batch ${batchCount} failed with status ${response.status}`);
                break;
            }

            const result = await response.json();
            console.log(`[CONTENT_REPAIR] Batch ${batchCount} result:`, result);

            totalProcessed += result.processed || 0;
            totalSucceeded += result.succeeded || 0;
            totalFailed += result.failed || 0;
            remaining = result.remaining || 0;

            console.log(`[CONTENT_REPAIR] Progress: ${totalSucceeded} succeeded, ${totalFailed} failed, ${remaining} remaining`);

            // If no more remaining, we're done
            if (remaining === 0) {
                console.log('[CONTENT_REPAIR] All guidelines repaired!');
                break;
            }

            // Small delay between batches to avoid overwhelming the server
            if (remaining > 0) {
                console.log(`[CONTENT_REPAIR] Waiting 3 seconds before next batch...`);
                await new Promise(resolve => setTimeout(resolve, 3000));
            }
        }

        return {
            success: true,
            totalProcessed,
            totalSucceeded,
            totalFailed,
            batchesRun: batchCount,
            remaining
        };

    } catch (error) {
        console.error('[CONTENT_REPAIR] Error during content repair:', error);
        return {
            success: false,
            error: error.message,
            totalProcessed,
            totalSucceeded,
            totalFailed
        };
    }
}

// Helper function to extract quoted text from context
export function extractQuotedText(context) {
    if (!context) return null;

    // Find all text within quotation marks (both single and double quotes)
    const quotePatterns = [
        /'([^']{10,})'/g,  // Single quotes with at least 10 chars
        /"([^"]{10,})"/g,  // Double quotes with at least 10 chars
        /'([^']{10,})'/g,  // Curly single quotes
        /"([^"]{10,})"/g   // Curly double quotes
    ];

    let allQuotes = [];

    for (const pattern of quotePatterns) {
        let match;
        while ((match = pattern.exec(context)) !== null) {
            allQuotes.push(match[1]);
        }
    }

    if (allQuotes.length === 0) {
        return null;
    }

    // Return the longest quote (most likely to be the actual guideline quote)
    allQuotes.sort((a, b) => b.length - a.length);
    let longestQuote = allQuotes[0];

    // Clean the quote for PDF search - remove citation markers and formatting
    longestQuote = cleanQuoteForSearch(longestQuote);

    return longestQuote;
}

// Helper function to clean quotes for PDF search
export function cleanQuoteForSearch(quote) {
    if (!quote) return quote;

    // Remove common citation patterns that might not be in the PDF
    let cleaned = quote
        // Remove evidence level citations: [Evidence level 1-3], [Grade A-D], [Grade GPP], etc.
        .replace(/\s*\[Evidence level [^\]]+\]/gi, '')
        .replace(/\s*\[Grade [^\]]+\]/gi, '')
        .replace(/\s*\[Level [^\]]+\]/gi, '')
        .replace(/\s*\[Quality: [^\]]+\]/gi, '')
        .replace(/\s*\[Recommendation: [^\]]+\]/gi, '')
        // Remove reference numbers like [1], [2-5], etc.
        .replace(/\s*\[[0-9,\-–—]+\]/g, '')
        // Remove extra whitespace and normalize
        .replace(/\s+/g, ' ')
        .trim();

    return cleaned;
}

// Helper function to extract key medical terms for fallback search
export function extractKeyTermsForSearch(context, suggestedText) {
    if (!context && !suggestedText) return null;

    const combinedText = (context || '') + ' ' + (suggestedText || '');

    // Medical terms that are likely to be unique and searchable in guidelines
    const medicalPatterns = [
        // Specific measurements and thresholds (very searchable)
        /\d+(?:\.\d+)?\s*(?:weeks?|wk|w)\b/gi,  // gestational ages like "28 weeks"
        /\d+(?:\.\d+)?\s*(?:ml|mg|mcg|g|kg|mmol|mm|cm)\b/gi,  // measurements
        /\d+(?:st|nd|rd|th)\s*(?:centile|percentile)/gi,  // percentiles
        /(?:>|<|≥|≤)\s*\d+/g,  // thresholds

        // Clinical conditions (highly specific)
        /(?:vasa\s+)?praevia/gi,
        /placenta\s+(?:praevia|accreta|percreta)/gi,
        /(?:fetal|foetal)\s+(?:growth\s+)?restriction/gi,
        /intrauterine\s+growth\s+restriction/gi,
        /pre[\-\s]?eclampsia/gi,
        /gestational\s+diabetes/gi,
        /post[\-\s]?partum\s+haemorrhage/gi,
        /caesarean\s+(?:section|delivery)/gi,

        // Procedures and investigations
        /ultrasound|USS|scan/gi,
        /amniocentesis/gi,
        /cordocentesis/gi,
        /doppler/gi,
        /antenatal\s+steroids?/gi,
        /corticosteroids?/gi,

        // Timing terms
        /(?:first|second|third)\s+trimester/gi,
        /elective\s+delivery/gi,
        /planned\s+delivery/gi,
        /timing\s+of\s+delivery/gi
    ];

    let foundTerms = [];

    for (const pattern of medicalPatterns) {
        const matches = combinedText.match(pattern);
        if (matches) {
            foundTerms.push(...matches.map(m => m.trim().toLowerCase()));
        }
    }

    // Deduplicate and take most specific terms (longer = more specific)
    foundTerms = [...new Set(foundTerms)].sort((a, b) => b.length - a.length);

    if (foundTerms.length === 0) {
        // Fallback: extract words with 6+ characters that are likely medical terms
        const words = combinedText.split(/\s+/).filter(w =>
            w.length >= 6 &&
            !/^(should|would|could|because|however|therefore|important|emphasizes?)$/i.test(w)
        );
        // Take first 3-4 significant words
        const significantWords = words.slice(0, 4).map(w => w.toLowerCase().replace(/[^a-z]/g, ''));
        if (significantWords.length >= 2) {
            foundTerms = significantWords;
        }
    }

    if (foundTerms.length === 0) {
        return null;
    }

    // Build search phrase from top terms (up to 6 words for better matching)
    const searchPhrase = foundTerms.slice(0, 6).join(' ');
    console.log('[GUIDELINES] Generated fallback search phrase:', searchPhrase);

    return searchPhrase;
}

// Helper function to create guideline viewer link
export function createGuidelineViewerLink(guidelineId, guidelineTitle, guidelineFilename, context, hasVerbatimQuote, suggestedText) {
    if (!guidelineId && !guidelineFilename) {
        return '<em>Guideline reference not available</em>';
    }

    const linkText = guidelineTitle || guidelineFilename || 'View Guideline PDF';

    // Extract search text from context ONLY if hasVerbatimQuote is explicitly true
    let searchText = null;
    let searchType = null;  // Track whether this is 'verbatim' or 'fallback' search

    if (context && hasVerbatimQuote === true) {
        const decodedContext = unescapeHtml(context);
        searchText = extractQuotedText(decodedContext);

        // Fallback: if there are no explicit quotes but we were told this is a verbatim quote
        if (!searchText) {
            const rawContext = decodedContext.trim();
            if (rawContext.length >= 10) {
                const cleanedContext = cleanQuoteForSearch(rawContext);
                if (cleanedContext && cleanedContext.length >= 10) {
                    searchText = cleanedContext;
                    searchType = 'verbatim';
                }
            }
        } else {
            searchType = 'verbatim';
        }
    } else if (hasVerbatimQuote === false || typeof hasVerbatimQuote === 'undefined') {
        // NEW: When no verbatim quote, try to extract key medical terms for a keyword-based search
        const decodedContext = context ? unescapeHtml(context) : null;
        searchText = extractKeyTermsForSearch(decodedContext, suggestedText);

        if (searchText) {
            searchType = 'fallback';
        }
    }

    // Store search text and guideline ID for auth handler to use
    const linkData = {
        guidelineId: guidelineId,
        searchText: searchText
    };

    const paraphraseNote = '';

    // Create link with data-link-data
    return `<a href="#" data-link-data='${JSON.stringify(linkData)}' class="guideline-link" rel="noopener noreferrer" style="text-decoration: underline; font-weight: normal; cursor: pointer; color: #016A52;">📄 ${escapeHtml(linkText)}</a>${paraphraseNote}`;
}

/**
 * Shared helper function to parse [[CITATION:guidelineId|searchText]] markers
 * and convert them to superscript numbered citations with a references section.
 */
export function parseCitationsToLinks(answerText, guidelinesUsed, callerName = 'parseCitationsToLinks') {
    // Build maps from IDs/titles to canonical IDs and full guideline data
    const guidelineIdMap = new Map();
    const guidelineDataMap = new Map();

    if (Array.isArray(guidelinesUsed)) {
        guidelinesUsed.forEach(g => {
            if (!g) return;
            const id = g.id ? String(g.id) : null;
            const title = g.title ? String(g.title) : null;
            if (id) {
                guidelineIdMap.set(id, id);
                guidelineIdMap.set(id.toLowerCase(), id);
                guidelineDataMap.set(id, g);
            }
            if (title && id) {
                guidelineIdMap.set(title, id);
                guidelineIdMap.set(title.toLowerCase(), id);
            }
        });
    }

    // Citation regex pattern: [[CITATION:guidelineId|searchText]]
    const citationRegex = /\[\[CITATION:([^|]+)\|([^\]]*)\]\]/g;

    // First pass: collect all unique guidelines and assign numbers
    const guidelineRefs = new Map(); // id -> { num, id, title, downloadUrl, quotes: [] }
    let refNum = 0;

    let match;
    const tempText = answerText;
    while ((match = citationRegex.exec(tempText)) !== null) {
        const rawId = match[1].trim();
        const searchText = match[2] ? match[2].trim() : '';

        const canonicalId = guidelineIdMap.get(rawId) || guidelineIdMap.get(rawId.toLowerCase()) || rawId;

        if (!guidelineRefs.has(canonicalId)) {
            refNum++;
            // Note: relies on window.globalGuidelines if not in suggestions
            const guidelineData = guidelineDataMap.get(canonicalId) ||
                window.globalGuidelines?.[canonicalId] || {};
            const displayTitle = guidelineData.displayName ||
                guidelineData.humanFriendlyName ||
                guidelineData.title ||
                canonicalId;

            guidelineRefs.set(canonicalId, {
                num: refNum,
                id: canonicalId,
                title: displayTitle,
                downloadUrl: guidelineData.downloadUrl || null,
                organisation: guidelineData.organisation || null,
                quotes: []
            });
        }

        // Store the quote for potential tooltip/hover use later
        if (searchText.length >= 5) {
            guidelineRefs.get(canonicalId).quotes.push(searchText);
        }
    }

    // Second pass: replace citations with superscript numbers
    let processedText = answerText;
    processedText = processedText.replace(new RegExp(citationRegex), (fullMatch, guidelineId, searchText) => {
        const rawId = guidelineId.trim();
        const canonicalId = guidelineIdMap.get(rawId) || guidelineIdMap.get(rawId.toLowerCase()) || rawId;
        const ref = guidelineRefs.get(canonicalId);

        if (ref) {
            // Create superscript citation link
            return `<sup><a href="#citation-ref-${ref.num}" class="citation-link" title="${ref.title}">[${ref.num}]</a></sup>`;
        }
        return fullMatch; // Fallback if not found
    });

    // Escape remaining HTML but preserve our superscript tags and newlines
    const parts = processedText.split(/(<sup>.*?<\/sup>)/g);
    processedText = parts.map((part, i) => {
        if (part.startsWith('<sup>')) {
            return part; // Don't escape our citation tags
        }
        return escapeHtml(part).replace(/\n/g, '<br>');
    }).join('');

    // Build references HTML section
    let referencesHtml = '';
    if (guidelineRefs.size > 0) {
        referencesHtml = `
            <div class="citation-references" style="margin-top: 25px; padding-top: 15px; border-top: 1px solid var(--border-color, #ddd);">
                <h4 style="margin: 0 0 10px 0; font-size: 1em; color: var(--text-secondary, #666);">References</h4>
                <ol style="margin: 0; padding-left: 20px; font-size: 0.9em;">
        `;

        // Sort by reference number
        const sortedRefs = Array.from(guidelineRefs.values()).sort((a, b) => a.num - b.num);

        for (const ref of sortedRefs) {
            const orgText = ref.organisation ? ` <span style="opacity: 0.7">(${ref.organisation})</span>` : '';

            // Create PDF link if available
            let linkHtml;
            if (ref.downloadUrl) {
                linkHtml = `<a href="${ref.downloadUrl}" target="_blank" style="color: #016A52;">${ref.title}</a>`;
            } else {
                linkHtml = createGuidelineViewerLink(ref.id, ref.title, null, null, false);
            }

            referencesHtml += `
                <li id="citation-ref-${ref.num}" style="margin-bottom: 5px;">
                    ${linkHtml}${orgText}
                </li>
            `;
        }

        referencesHtml += `
                </ol>
            </div>
        `;
    }

    return {
        formattedAnswer: processedText,
        referencesHtml: referencesHtml,
        stats: {
            totalCitations: refNum,
            uniqueGuidelines: guidelineRefs.size
        }
    };
}

// Function to prepare auth token for viewer
export async function prepareViewerAuth(event, linkElement) {
    try {
        event.preventDefault(); // Prevent default navigation

        console.log('[VIEWER] Preparing auth token for PDF.js viewer...');
        const user = auth.currentUser;
        if (!user) {
            console.error('[VIEWER] No user authenticated');
            alert('Please sign in to view guidelines');
            return;
        }

        // Get fresh ID token
        const idToken = await user.getIdToken();

        // Get link data from data attribute
        const linkDataStr = linkElement.getAttribute('data-link-data');
        if (!linkDataStr) {
            console.error('[VIEWER] No link data found');
            return;
        }

        const linkData = JSON.parse(linkDataStr);
        const { guidelineId, searchText } = linkData;

        // Build the complete PDF URL with token, using SERVER_URL
        const baseUrl = SERVER_URL || window.location.origin;
        const pdfUrl = `${baseUrl}/api/pdf/${guidelineId}?token=${encodeURIComponent(idToken)}`;

        // Build PDF.js viewer URL with the PDF file URL
        let viewerUrl = `/pdfjs/web/viewer.html?file=${encodeURIComponent(pdfUrl)}`;

        // Add search hash parameters if we have quoted text
        if (searchText) {
            const searchHash = `#search=${encodeURIComponent(searchText)}&phrase=true&highlightAll=true&caseSensitive=false`;
            viewerUrl += searchHash;
        }

        console.log('[VIEWER] Opening PDF.js viewer:', viewerUrl);

        // Open in new window
        window.open(viewerUrl, '_blank', 'noopener,noreferrer');

    } catch (error) {
        console.error('[VIEWER] Error preparing auth token:', error);
        alert('Failed to prepare authentication. Please try again.');
    }
}

// Function to show metadata enhancement progress to user
export function showMetadataProgress(message, isComplete = false) {
    // Create or update progress notification
    let progressDiv = document.getElementById('metadata-progress');

    if (!progressDiv) {
        progressDiv = document.createElement('div');
        progressDiv.id = 'metadata-progress';
        progressDiv.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: #f0f9ff;
            border: 1px solid #0ea5e9;
            border-radius: 8px;
            padding: 12px 16px;
            max-width: 300px;
            z-index: 1000;
            font-size: 14px;
            box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
        `;
        document.body.appendChild(progressDiv);
    }

    progressDiv.innerHTML = `
        <div style="display: flex; align-items: center; gap: 8px;">
            ${isComplete ?
            '<div style="width: 12px; height: 12px; background: #10b981; border-radius: 50%;"></div>' :
            '<div style="width: 12px; height: 12px; border: 2px solid #0ea5e9; border-top: 2px solid transparent; border-radius: 50%; animation: spin 1s linear infinite;"></div>'
        }
            <span>${message}</span>
        </div>
    `;

    // Add animation keyframe if not already added
    if (!document.getElementById('metadata-progress-styles')) {
        const style = document.createElement('style');
        style.id = 'metadata-progress-styles';
        style.textContent = `
            @keyframes spin {
                0% { transform: rotate(0deg); }
                100% { transform: rotate(360deg); }
            }
        `;
        document.head.appendChild(style);
    }

    // Auto-hide completed messages after 5 seconds
    if (isComplete) {
        setTimeout(() => {
            if (progressDiv && progressDiv.parentNode) {
                progressDiv.remove();
            }
        }, 5000);
    }
}

// Function to hide metadata progress
export function hideMetadataProgress() {
    const progressDiv = document.getElementById('metadata-progress');
    if (progressDiv && progressDiv.parentNode) {
        progressDiv.remove();
    }
}

// Process guidelines one at a time for content repair
export async function diagnoseAndRepairContent() {
    // Prevent multiple simultaneous repairs
    if (contentRepairInProgress) {
        console.log('[REPAIR] ⏳ Content repair already in progress, skipping...');
        return;
    }

    contentRepairInProgress = true;
    console.log('[REPAIR] 🔧 Starting comprehensive content repair process...');
    console.log('[REPAIR] This will process guidelines one at a time to avoid timeouts');

    try {
        // Get user ID token
        const user = auth.currentUser;
        if (!user) {
            console.error('[REPAIR] ❌ User not authenticated');
            throw new Error('User not authenticated');
        }

        console.log('[REPAIR] ✅ User authenticated, getting ID token...');
        const idToken = await user.getIdToken();

        // First, get the list of guidelines needing content
        console.log('[REPAIR] 📋 Getting list of guidelines needing content...');
        const listResponse = await fetch(`${SERVER_URL}/getGuidelinesNeedingContent`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${idToken}`
            }
        });

        if (!listResponse.ok) {
            const errorText = await listResponse.text();
            throw new Error(`Failed to get guidelines list: ${listResponse.status} - ${errorText}`);
        }

        const listResult = await listResponse.json();
        const guidelinesNeedingContent = listResult.guidelines || [];

        console.log(`[REPAIR] 📊 Found ${guidelinesNeedingContent.length} guidelines needing content processing`);

        if (guidelinesNeedingContent.length === 0) {
            showMetadataProgress('✅ All guidelines already have complete content!', true);
            setTimeout(() => hideMetadataProgress(), 3000);
            return;
        }

        // Process guidelines one at a time
        let processed = 0;
        let successful = 0;
        let failed = 0;

        for (const guideline of guidelinesNeedingContent) {
            try {
                processed++;
                const progress = `🔧 Processing ${processed}/${guidelinesNeedingContent.length}: ${guideline.title}`;
                showMetadataProgress(progress, false);

                console.log(`[REPAIR] 📄 Processing guideline ${processed}/${guidelinesNeedingContent.length}: ${guideline.id}`);

                const processResponse = await fetch(`${SERVER_URL}/processGuidelineContent`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${idToken}`
                    },
                    body: JSON.stringify({
                        guidelineId: guideline.id
                    })
                });

                if (processResponse.ok) {
                    const processResult = await processResponse.json();
                    if (processResult.success && processResult.updated) {
                        successful++;
                        console.log(`[REPAIR] ✅ Successfully processed: ${guideline.title}`);
                    } else {
                        console.log(`[REPAIR] ⏭️ No processing needed for: ${guideline.title}`);
                    }
                } else {
                    failed++;
                    const errorText = await processResponse.text();
                    console.error(`[REPAIR] ❌ Failed to process ${guideline.title}: ${errorText}`);
                }

                // Small delay between requests to avoid overwhelming the server
                await new Promise(resolve => setTimeout(resolve, 500));

            } catch (error) {
                failed++;
                console.error(`[REPAIR] ❌ Error processing ${guideline.title}:`, error);
            }
        }

        console.log(`[REPAIR] 📈 Processing complete: ${successful} successful, ${failed} failed, ${processed} total`);

        if (failed === 0) {
            showMetadataProgress(`✅ Content repair completed! Successfully processed ${successful} guidelines.`, true);
        } else {
            showMetadataProgress(`⚠️ Content repair completed with some issues: ${successful} successful, ${failed} failed.`, true);
        }

        // Auto-hide after 5 seconds
        setTimeout(() => {
            hideMetadataProgress();
        }, 5000);

        // Note: Guidelines will be automatically updated via Firestore listeners
        if (successful > 0) {
            console.log('[REPAIR] ✅ Guidelines updated in Firestore, changes will reflect automatically');
        }

    } catch (error) {
        console.error('[REPAIR] ❌ Content repair error:', error);

        showMetadataProgress(`❌ Content repair failed: ${error.message}`, true);

        // Auto-hide error after 10 seconds
        setTimeout(() => {
            hideMetadataProgress();
        }, 10000);

        throw error;

    } finally {
        console.log('[REPAIR] 🏁 Content repair process finished, flag reset');
        contentRepairInProgress = false;
    }
}

// Function to check content status during load
export function checkContentStatus(guidelines) {
    const stats = {
        total: guidelines.length,
        nullContent: 0,
        nullCondensed: 0,
        missingBoth: 0,
        hasContent: 0,
        hasCondensed: 0,
        fullyPopulated: 0
    };

    const problematicGuidelines = [];

    guidelines.forEach(guideline => {
        const hasContent = guideline.content && guideline.content !== null && guideline.content.trim().length > 0;
        const hasCondensed = guideline.condensed && guideline.condensed !== null && guideline.condensed.trim().length > 0;

        if (hasContent) stats.hasContent++;
        if (hasCondensed) stats.hasCondensed++;
        if (hasContent && hasCondensed) stats.fullyPopulated++;

        if (!hasContent) {
            stats.nullContent++;
            problematicGuidelines.push({
                id: guideline.id,
                title: guideline.title || guideline.humanFriendlyName || 'Unknown',
                issue: 'null_content'
            });
        }

        if (!hasCondensed) {
            stats.nullCondensed++;
            if (!problematicGuidelines.find(p => p.id === guideline.id)) {
                problematicGuidelines.push({
                    id: guideline.id,
                    title: guideline.title || guideline.humanFriendlyName || 'Unknown',
                    issue: 'null_condensed'
                });
            } else {
                // Update existing entry to indicate both are missing
                const existing = problematicGuidelines.find(p => p.id === guideline.id);
                existing.issue = 'missing_both';
            }
        }

        if (!hasContent && !hasCondensed) {
            stats.missingBoth++;
        }
    });

    return { stats, problematicGuidelines };
}

// Global manual trigger (for console)
window.repairContent = async function () {
    console.log('🔧 Manual content repair triggered from console...');
    try {
        await diagnoseAndRepairContent();
        console.log('✅ Manual content repair completed successfully!');
    } catch (error) {
        console.error('❌ Manual content repair failed:', error);
    }
};
