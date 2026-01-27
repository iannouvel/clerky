/**
 * Guidelines Management
 * Features for syncing and repairing guideline data
 */

import { SERVER_URL } from '../api/config.js';

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
