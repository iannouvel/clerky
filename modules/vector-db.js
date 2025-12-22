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
        // Pinecone with integrated embedding expects records with 'text' field
        // The embedding model (llama-text-embed-v2) will automatically generate vectors
        const records = documents.map(doc => ({
            id: doc.id,
            text: doc.text,  // Pinecone will embed this automatically
            metadata: {
                ...doc.metadata,
                text_preview: doc.text.substring(0, 500) // Store preview for display
            }
        }));

        // Batch upsert
        // Pinecone integrated-embedding upsert has a hard max batch size of 96 records per request.
        // (We saw: "INVALID_ARGUMENT ... Batch size exceeds 96")
        const BATCH_SIZE = 96;
        let totalUpserted = 0;

        for (let i = 0; i < records.length; i += BATCH_SIZE) {
            const batch = records.slice(i, i + BATCH_SIZE);
            
            // Use the inference namespace for integrated embedding
            await index.upsertRecords(batch);
            
            totalUpserted += batch.length;
            console.log(`[VECTOR-DB] Upserted batch ${Math.floor(i / BATCH_SIZE) + 1}: ${totalUpserted}/${records.length} records`);
        }

        console.log(`[VECTOR-DB] Successfully upserted ${totalUpserted} documents`);
        return { success: true, upsertedCount: totalUpserted };
    } catch (error) {
        console.error('[VECTOR-DB] Upsert failed:', error.message);
        throw error;
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
        console.log(`[VECTOR-DB] Query completed in ${queryTime}ms, found ${results.result?.hits?.length || 0} results`);

        // Transform results to consistent format
        const matches = (results.result?.hits || []).map(hit => ({
            id: hit._id,
            score: hit._score,
            metadata: {
                guidelineId: hit.guidelineId,
                title: hit.title,
                organisation: hit.organisation,
                chunkIndex: hit.chunkIndex,
                totalChunks: hit.totalChunks,
                textPreview: hit.text_preview
            }
        }));

        return {
            success: true,
            matches,
            queryTimeMs: queryTime
        };
    } catch (error) {
        console.error('[VECTOR-DB] Query failed:', error.message);
        throw error;
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
        console.error('[VECTOR-DB] Delete failed:', error.message);
        throw error;
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
        console.error('[VECTOR-DB] Delete guideline chunks failed:', error.message);
        throw error;
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
        console.error('[VECTOR-DB] Failed to get stats:', error.message);
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
    // These thresholds may need tuning based on testing
    const MOST_RELEVANT_THRESHOLD = 0.75;
    const POTENTIALLY_RELEVANT_THRESHOLD = 0.60;
    const LESS_RELEVANT_THRESHOLD = 0.45;

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
