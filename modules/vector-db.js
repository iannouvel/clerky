/**
 * Vector Database Module for RAG-based Guideline Search
 * 
 * Uses Pinecone with integrated embeddings (llama-text-embed-v2)
 * to enable fast semantic search across medical guidelines.
 */

const { Pinecone } = require('@pinecone-database/pinecone');

// Configuration
const PINECONE_API_KEY = process.env.PINECONE_API_KEY;
const PINECONE_INDEX_NAME = process.env.PINECONE_INDEX_NAME || 'clerky-guidelines';
const PINECONE_HOST = process.env.PINECONE_HOST;

// Singleton Pinecone client
let pineconeClient = null;
let pineconeIndex = null;

function stringifyError(err) {
    try {
        if (!err) return 'Unknown error';
        if (typeof err === 'string') return err;
        if (err instanceof Error) {
            // Some SDK errors have empty message but useful attached fields
            const base = err.message && err.message.trim().length > 0 ? err.message : null;
            const extra = {};
            for (const k of ['name', 'code', 'status', 'statusCode', 'cause', 'error', 'errors', 'details', 'body', 'response']) {
                if (err[k] !== undefined) extra[k] = err[k];
            }
            const extraStr = Object.keys(extra).length > 0 ? ` | extra=${safeJson(extra)}` : '';
            return `${base || err.toString()}${extraStr}`;
        }
        return safeJson(err);
    } catch (_) {
        return 'Unknown error (failed to stringify)';
    }
}

function safeJson(obj) {
    try {
        return JSON.stringify(obj, getCircularReplacer(), 2);
    } catch (_) {
        try {
            // Last resort: include enumerable props only
            return JSON.stringify(Object.assign({}, obj), null, 2);
        } catch (__) {
            return '[unserializable]';
        }
    }
}

function getCircularReplacer() {
    const seen = new WeakSet();
    return (key, value) => {
        if (typeof value === 'object' && value !== null) {
            if (seen.has(value)) return '[circular]';
            seen.add(value);
        }
        return value;
    };
}

/**
 * Initialize Pinecone client and index
 */
async function initializePinecone() {
    if (pineconeIndex) {
        return pineconeIndex;
    }

    if (!PINECONE_API_KEY) {
        console.warn('[VECTOR-DB] PINECONE_API_KEY not set - RAG search disabled');
        return null;
    }

    try {
        pineconeClient = new Pinecone({
            apiKey: PINECONE_API_KEY
        });

        // Get the index - use host if provided, otherwise use index name
        if (PINECONE_HOST) {
            pineconeIndex = pineconeClient.index(PINECONE_INDEX_NAME, PINECONE_HOST);
        } else {
            pineconeIndex = pineconeClient.index(PINECONE_INDEX_NAME);
        }

        console.log(`[VECTOR-DB] Connected to Pinecone index: ${PINECONE_INDEX_NAME}`);
        return pineconeIndex;
    } catch (error) {
        console.error('[VECTOR-DB] Failed to initialize Pinecone:', error.message);
        return null;
    }
}

/**
 * Check if vector database is available
 */
function isVectorDBAvailable() {
    return !!PINECONE_API_KEY && !!PINECONE_INDEX_NAME;
}

/**
 * Upsert documents to the vector database
 * Uses Pinecone's integrated embedding (llama-text-embed-v2)
 * 
 * @param {Array} documents - Array of {id, text, metadata} objects
 * @returns {Promise<{success: boolean, upsertedCount: number}>}
 */
async function upsertDocuments(documents) {
    const index = await initializePinecone();
    if (!index) {
        throw new Error('Vector database not available');
    }

    try {
        // Pinecone integrated-embedding upsert expects "records" whose fields are primitives
        // (string/number/boolean or list of strings). It does NOT accept nested objects like
        // { metadata: { ... } }.
        //
        // So we FLATTEN metadata keys into top-level fields.
        const records = documents.map(doc => {
            const safeMeta = {};
            const meta = doc.metadata || {};

            for (const [k, v] of Object.entries(meta)) {
                if (v === null || v === undefined) continue;
                if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
                    safeMeta[k] = v;
                    continue;
                }
                if (Array.isArray(v)) {
                    // Pinecone integrated embedding supports list of strings
                    const stringsOnly = v.filter(x => typeof x === 'string');
                    if (stringsOnly.length > 0) safeMeta[k] = stringsOnly;
                    continue;
                }
                // Fallback: stringify anything else to keep it searchable/debuggable
                safeMeta[k] = String(v);
            }

            return {
                id: doc.id,
                text: doc.text, // Pinecone will embed this automatically
                ...safeMeta,
                text_preview: (doc.text || '').substring(0, 500)
            };
        });

        // Batch upsert
        // Pinecone integrated-embedding upsert has a hard max batch size of 96 records per request.
        // (We saw: "INVALID_ARGUMENT ... Batch size exceeds 96")
        const BATCH_SIZE = 96;
        const MAX_RETRIES = 3;
        const RETRY_DELAY_MS = 2000;
        let totalUpserted = 0;
        let failedBatches = 0;

        for (let i = 0; i < records.length; i += BATCH_SIZE) {
            const batch = records.slice(i, i + BATCH_SIZE);
            const batchNum = Math.floor(i / BATCH_SIZE) + 1;
            let success = false;
            
            // Retry logic for each batch
            for (let attempt = 1; attempt <= MAX_RETRIES && !success; attempt++) {
                try {
                    // Use the inference namespace for integrated embedding
                    await index.upsertRecords(batch);
                    
                    totalUpserted += batch.length;
                    console.log(`[VECTOR-DB] Upserted batch ${batchNum}: ${totalUpserted}/${records.length} records`);
                    success = true;
                } catch (batchError) {
                    const errorDetails = stringifyError(batchError);
                    console.warn(`[VECTOR-DB] Batch ${batchNum} attempt ${attempt}/${MAX_RETRIES} failed: ${errorDetails}`);
                    
                    if (attempt < MAX_RETRIES) {
                        // Wait before retrying (exponential backoff)
                        const delay = RETRY_DELAY_MS * Math.pow(2, attempt - 1);
                        console.log(`[VECTOR-DB] Retrying batch ${batchNum} in ${delay}ms...`);
                        await new Promise(resolve => setTimeout(resolve, delay));
                    }
                }
            }
            
            if (!success) {
                failedBatches++;
                console.error(`[VECTOR-DB] Batch ${batchNum} failed after ${MAX_RETRIES} attempts, skipping ${batch.length} records`);
            }
        }

        console.log(`[VECTOR-DB] Upsert complete: ${totalUpserted} documents uploaded, ${failedBatches} batches failed`);
        return { success: true, upsertedCount: totalUpserted, failedBatches };
    } catch (error) {
        const details = stringifyError(error);
        console.error('[VECTOR-DB] Upsert failed:', details);
        throw new Error(details);
    }
}

/**
 * Query the vector database for similar documents
 * Uses Pinecone's integrated embedding to convert query text to vector
 * 
 * @param {string} queryText - The text to search for
 * @param {Object} options - Query options
 * @param {number} options.topK - Number of results to return (default: 20)
 * @param {Object} options.filter - Metadata filters (optional)
 * @returns {Promise<Array>} - Array of matching documents with scores
 */
async function queryDocuments(queryText, options = {}) {
    const index = await initializePinecone();
    if (!index) {
        throw new Error('Vector database not available');
    }

    const { topK = 20, filter = null } = options;

    try {
        const startTime = Date.now();

        // Query using text - Pinecone will embed it automatically
        const queryOptions = {
            topK,
            includeMetadata: true,
            includeValues: false // Don't need the actual vectors
        };

        // Add filter if provided
        if (filter) {
            queryOptions.filter = filter;
        }

        // Use searchRecords for integrated embedding search
        const results = await index.searchRecords({
            query: {
                topK,
                inputs: { text: queryText },
                filter: filter || undefined
            },
            fields: ['text_preview', 'guidelineId', 'title', 'organisation', 'chunkIndex', 'totalChunks']
        });

        const queryTime = Date.now() - startTime;
        const hits = results.result?.hits || [];
        console.log(`[VECTOR-DB] Query completed in ${queryTime}ms, found ${hits.length} results`);
        
        // Debug: Log first few hit scores to understand Pinecone response
        if (hits.length > 0) {
            const topScores = hits.slice(0, 5).map(h => ({
                score: h._score,
                title: (h.title || h.fields?.title || 'unknown').substring(0, 40)
            }));
            console.log(`[VECTOR-DB] Top 5 scores: ${JSON.stringify(topScores)}`);
        }

        // Transform results to consistent format
        // Note: Pinecone searchRecords may return fields at top level or nested in 'fields' property
        const matches = hits.map(hit => {
            // Try both top-level and nested fields locations
            const guidelineId = hit.guidelineId || hit.fields?.guidelineId;
            const title = hit.title || hit.fields?.title;
            const organisation = hit.organisation || hit.fields?.organisation;
            const chunkIndex = hit.chunkIndex || hit.fields?.chunkIndex;
            const totalChunks = hit.totalChunks || hit.fields?.totalChunks;
            const textPreview = hit.text_preview || hit.fields?.text_preview;
            
            return {
                id: hit._id,
                score: hit._score,
                metadata: {
                    guidelineId,
                    title,
                    organisation,
                    chunkIndex,
                    totalChunks,
                    textPreview
                }
            };
        });

        return {
            success: true,
            matches,
            queryTimeMs: queryTime
        };
    } catch (error) {
        const details = stringifyError(error);
        console.error('[VECTOR-DB] Query failed:', details);
        throw new Error(details);
    }
}

/**
 * Delete documents from the vector database
 * 
 * @param {Array<string>} ids - Array of document IDs to delete
 */
async function deleteDocuments(ids) {
    const index = await initializePinecone();
    if (!index) {
        throw new Error('Vector database not available');
    }

    try {
        await index.deleteMany(ids);
        console.log(`[VECTOR-DB] Deleted ${ids.length} documents`);
        return { success: true, deletedCount: ids.length };
    } catch (error) {
        const details = stringifyError(error);
        console.error('[VECTOR-DB] Delete failed:', details);
        throw new Error(details);
    }
}

/**
 * Delete all documents for a specific guideline
 * 
 * @param {string} guidelineId - The guideline ID
 */
async function deleteGuidelineChunks(guidelineId) {
    const index = await initializePinecone();
    if (!index) {
        throw new Error('Vector database not available');
    }

    try {
        // Delete by metadata filter
        await index.deleteMany({
            filter: { guidelineId: { $eq: guidelineId } }
        });
        console.log(`[VECTOR-DB] Deleted all chunks for guideline: ${guidelineId}`);
        return { success: true };
    } catch (error) {
        const details = stringifyError(error);
        console.error('[VECTOR-DB] Delete guideline chunks failed:', details);
        throw new Error(details);
    }
}

/**
 * Get index statistics
 */
async function getIndexStats() {
    const index = await initializePinecone();
    if (!index) {
        return { available: false };
    }

    try {
        const stats = await index.describeIndexStats();
        return {
            available: true,
            totalRecords: stats.totalRecordCount || 0,
            dimension: stats.dimension,
            namespaces: stats.namespaces
        };
    } catch (error) {
        const details = stringifyError(error);
        console.error('[VECTOR-DB] Failed to get stats:', details);
        return { available: false, error: error.message };
    }
}

/**
 * Categorise search results by similarity score
 * Maps vector similarity scores to the existing category structure
 * 
 * @param {Array} matches - Array of matches from queryDocuments
 * @returns {Object} - Categorised results matching existing format
 */
function categoriseByScore(matches) {
    // Group by guidelineId to avoid duplicate guidelines
    const guidelineMap = new Map();
    
    matches.forEach(match => {
        const guidelineId = match.metadata.guidelineId;
        if (!guidelineMap.has(guidelineId) || guidelineMap.get(guidelineId).score < match.score) {
            guidelineMap.set(guidelineId, match);
        }
    });

    const uniqueMatches = Array.from(guidelineMap.values());
    
    // Sort by score descending
    uniqueMatches.sort((a, b) => b.score - a.score);

    // Categorise based on similarity score thresholds
    // Tuned for Pinecone integrated embeddings (llama-text-embed-v2)
    // These embeddings tend to produce lower scores than traditional models
    const MOST_RELEVANT_THRESHOLD = 0.50;
    const POTENTIALLY_RELEVANT_THRESHOLD = 0.35;
    const LESS_RELEVANT_THRESHOLD = 0.20;

    const categories = {
        mostRelevant: [],
        potentiallyRelevant: [],
        lessRelevant: [],
        notRelevant: []
    };

    uniqueMatches.forEach(match => {
        const result = {
            id: match.metadata.guidelineId,
            title: match.metadata.title,
            organisation: match.metadata.organisation,
            relevanceScore: match.score,
            relevance: match.score, // Also include 'relevance' for frontend compatibility
            snippet: match.metadata.textPreview
        };

        if (match.score >= MOST_RELEVANT_THRESHOLD) {
            categories.mostRelevant.push(result);
        } else if (match.score >= POTENTIALLY_RELEVANT_THRESHOLD) {
            categories.potentiallyRelevant.push(result);
        } else if (match.score >= LESS_RELEVANT_THRESHOLD) {
            categories.lessRelevant.push(result);
        } else {
            categories.notRelevant.push(result);
        }
    });

    return categories;
}

module.exports = {
    initializePinecone,
    isVectorDBAvailable,
    upsertDocuments,
    queryDocuments,
    deleteDocuments,
    deleteGuidelineChunks,
    getIndexStats,
    categoriseByScore
};


