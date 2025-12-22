/**
 * RAG Ingestion Module
 * 
 * Processes guideline content from Firestore and uploads to Pinecone vector database.
 * Uses the FULL guideline content for semantic search - not summaries or condensed versions.
 */

const fs = require('fs');
const path = require('path');
const { upsertDocuments, deleteGuidelineChunks, getIndexStats } = require('./vector-db');

// Configuration
const CHUNK_SIZE = 1500; // Characters per chunk (optimized for medical content)
const CHUNK_OVERLAP = 300; // Overlap between chunks for context continuity

/**
 * Split text into overlapping chunks
 * 
 * @param {string} text - The text to chunk
 * @param {number} chunkSize - Maximum characters per chunk
 * @param {number} overlap - Overlap between chunks
 * @returns {Array<string>} - Array of text chunks
 */
function chunkText(text, chunkSize = CHUNK_SIZE, overlap = CHUNK_OVERLAP) {
    if (!text || text.length === 0) {
        return [];
    }

    // If text is smaller than chunk size, return as single chunk
    if (text.length <= chunkSize) {
        return [text.trim()];
    }

    const chunks = [];
    let startIndex = 0;

    while (startIndex < text.length) {
        let endIndex = startIndex + chunkSize;
        
        // Try to break at sentence boundary
        if (endIndex < text.length) {
            // Look for sentence ending within last 20% of chunk
            const searchStart = Math.max(startIndex, endIndex - Math.floor(chunkSize * 0.2));
            const searchText = text.substring(searchStart, endIndex);
            
            // Find last sentence ending
            const sentenceEndMatch = searchText.match(/[.!?]\s+(?=[A-Z])/g);
            if (sentenceEndMatch) {
                const lastMatch = searchText.lastIndexOf(sentenceEndMatch[sentenceEndMatch.length - 1]);
                if (lastMatch !== -1) {
                    endIndex = searchStart + lastMatch + sentenceEndMatch[sentenceEndMatch.length - 1].length;
                }
            }
        }

        const chunk = text.substring(startIndex, endIndex).trim();
        if (chunk.length > 0) {
            chunks.push(chunk);
        }

        // Move start index with overlap
        startIndex = endIndex - overlap;
        
        // Prevent infinite loop
        if (startIndex >= text.length - overlap) {
            break;
        }
    }

    return chunks;
}

/**
 * Extract guideline metadata from filename
 * 
 * @param {string} filename - The filename
 * @param {string} folder - The source folder (condensed, summary, etc.)
 * @returns {Object} - Extracted metadata
 */
function extractMetadata(filename, folder) {
    // Remove .txt extension
    const baseName = filename.replace(/\.txt$/, '');
    
    // Try to extract organisation from common patterns
    const orgPatterns = [
        { regex: /^(NICE|RCOG|BASHH|FSRH|BMS|BSH|BHIVA|BAPM|BJOG|ESHRE|FIGO|WHO|NHS)/i, group: 1 },
        { regex: /^(GTG|CG|NG|QS|PH)/i, org: 'NICE' },
        { regex: /^(MP|GP|CG\d|SP|P\d)/i, org: 'UHSussex' }
    ];

    let organisation = 'Unknown';
    for (const pattern of orgPatterns) {
        const match = baseName.match(pattern.regex);
        if (match) {
            organisation = pattern.org || match[pattern.group];
            break;
        }
    }

    // Try to extract year
    const yearMatch = baseName.match(/\b(19|20)\d{2}\b/);
    const year = yearMatch ? parseInt(yearMatch[0]) : null;

    return {
        title: baseName,
        organisation,
        year,
        sourceFolder: folder,
        filename
    };
}

/**
 * Generate a unique ID for a guideline chunk
 * 
 * @param {string} guidelineId - Base guideline ID
 * @param {number} chunkIndex - Chunk index
 * @returns {string} - Unique chunk ID
 */
function generateChunkId(guidelineId, chunkIndex) {
    // Create a sanitized ID (Pinecone IDs must be alphanumeric with underscores/hyphens)
    const sanitizedId = guidelineId
        .replace(/[^a-zA-Z0-9_-]/g, '_')
        .substring(0, 100); // Limit length
    
    return `${sanitizedId}_chunk_${chunkIndex}`;
}

/**
 * Process a single guideline file
 * 
 * @param {string} filePath - Path to the file
 * @param {string} folder - Source folder name
 * @returns {Array} - Array of document chunks ready for upsert
 */
function processGuidelineFile(filePath, folder) {
    try {
        const filename = path.basename(filePath);
        const content = fs.readFileSync(filePath, 'utf-8');
        
        if (!content || content.trim().length === 0) {
            console.warn(`[RAG-INGESTION] Empty file: ${filename}`);
            return [];
        }

        const metadata = extractMetadata(filename, folder);
        const guidelineId = `${folder}_${filename.replace(/\.txt$/, '')}`;
        
        // Chunk the content
        const chunks = chunkText(content);
        
        if (chunks.length === 0) {
            return [];
        }

        // Create documents for each chunk
        return chunks.map((chunkText, index) => ({
            id: generateChunkId(guidelineId, index),
            text: chunkText,
            metadata: {
                guidelineId,
                title: metadata.title,
                organisation: metadata.organisation,
                year: metadata.year,
                sourceFolder: folder,
                filename: metadata.filename,
                chunkIndex: index,
                totalChunks: chunks.length
            }
        }));
    } catch (error) {
        console.error(`[RAG-INGESTION] Error processing ${filePath}:`, error.message);
        return [];
    }
}

/**
 * Process all guidelines from the guidance folder
 * 
 * @param {string} baseDir - Base directory (usually project root)
 * @param {Object} options - Processing options
 * @returns {Promise<Object>} - Processing results
 */
async function processAllGuidelines(baseDir, options = {}) {
    const { dryRun = false, batchSize = 50, folders = GUIDANCE_FOLDERS } = options;
    
    const guidanceDir = path.join(baseDir, 'guidance');
    const results = {
        totalFiles: 0,
        totalChunks: 0,
        processedFiles: 0,
        errors: [],
        byFolder: {}
    };

    console.log(`[RAG-INGESTION] Starting ingestion from: ${guidanceDir}`);
    console.log(`[RAG-INGESTION] Folders to process: ${folders.join(', ')}`);
    console.log(`[RAG-INGESTION] Dry run: ${dryRun}`);

    // Collect all documents first
    const allDocuments = [];

    for (const folder of folders) {
        const folderPath = path.join(guidanceDir, folder);
        
        if (!fs.existsSync(folderPath)) {
            console.warn(`[RAG-INGESTION] Folder not found: ${folderPath}`);
            continue;
        }

        const files = fs.readdirSync(folderPath).filter(f => f.endsWith('.txt'));
        results.byFolder[folder] = { files: files.length, chunks: 0 };
        results.totalFiles += files.length;

        console.log(`[RAG-INGESTION] Processing ${files.length} files from ${folder}/`);

        for (const file of files) {
            const filePath = path.join(folderPath, file);
            const documents = processGuidelineFile(filePath, folder);
            
            if (documents.length > 0) {
                allDocuments.push(...documents);
                results.processedFiles++;
                results.byFolder[folder].chunks += documents.length;
            }
        }
    }

    results.totalChunks = allDocuments.length;
    console.log(`[RAG-INGESTION] Total chunks prepared: ${results.totalChunks}`);

    // Upload to Pinecone (unless dry run)
    if (!dryRun && allDocuments.length > 0) {
        console.log(`[RAG-INGESTION] Uploading to Pinecone in batches of ${batchSize}...`);
        
        try {
            const upsertResult = await upsertDocuments(allDocuments);
            results.uploaded = upsertResult.upsertedCount;
            console.log(`[RAG-INGESTION] Upload complete: ${results.uploaded} chunks`);
        } catch (error) {
            console.error(`[RAG-INGESTION] Upload failed:`, error.message);
            results.errors.push(error.message);
        }
    }

    return results;
}

/**
 * Re-ingest a specific guideline (after update)
 * 
 * @param {string} guidelineId - The guideline ID
 * @param {string} content - The new content
 * @param {Object} metadata - Guideline metadata
 */
async function reingestGuideline(guidelineId, content, metadata) {
    console.log(`[RAG-INGESTION] Re-ingesting guideline: ${guidelineId}`);

    // First, delete existing chunks
    try {
        await deleteGuidelineChunks(guidelineId);
    } catch (error) {
        console.warn(`[RAG-INGESTION] Could not delete old chunks (may not exist): ${error.message}`);
    }

    // Chunk the new content
    const chunks = chunkText(content);
    
    if (chunks.length === 0) {
        console.warn(`[RAG-INGESTION] No content to ingest for: ${guidelineId}`);
        return { success: false, error: 'No content' };
    }

    // Create documents
    const documents = chunks.map((chunkText, index) => ({
        id: generateChunkId(guidelineId, index),
        text: chunkText,
        metadata: {
            guidelineId,
            title: metadata.title || guidelineId,
            organisation: metadata.organisation || 'Unknown',
            year: metadata.year || null,
            chunkIndex: index,
            totalChunks: chunks.length
        }
    }));

    // Upsert to Pinecone
    try {
        const result = await upsertDocuments(documents);
        console.log(`[RAG-INGESTION] Re-ingested ${result.upsertedCount} chunks for: ${guidelineId}`);
        return { success: true, chunksUpserted: result.upsertedCount };
    } catch (error) {
        console.error(`[RAG-INGESTION] Re-ingestion failed:`, error.message);
        return { success: false, error: error.message };
    }
}

/**
 * Get ingestion status
 */
async function getIngestionStatus() {
    const stats = await getIndexStats();
    return {
        vectorDBAvailable: stats.available,
        totalRecords: stats.totalRecords || 0,
        ...stats
    };
}

/**
 * Process a single guideline from Firestore data
 * Uses the FULL content field - not summaries or condensed versions
 * 
 * @param {Object} guideline - Guideline document from Firestore
 * @returns {Array} - Array of document chunks ready for upsert
 */
function processFirestoreGuideline(guideline) {
    try {
        const guidelineId = guideline.id;
        
        // Use FULL content - this is the verbatim guideline text
        const content = guideline.content;
        
        if (!content || content.trim().length === 0) {
            console.warn(`[RAG-INGESTION] No content for guideline: ${guidelineId}`);
            return [];
        }

        // Extract metadata from guideline
        const title = guideline.humanFriendlyName || guideline.title || guideline.filename || guidelineId;
        const organisation = guideline.organisation || extractOrganisationFromTitle(title);
        
        // Chunk the FULL content
        const chunks = chunkText(content);
        
        if (chunks.length === 0) {
            return [];
        }

        console.log(`[RAG-INGESTION] Chunked "${title}" into ${chunks.length} chunks (${content.length} chars)`);

        // Create documents for each chunk
        return chunks.map((chunkContent, index) => ({
            id: generateChunkId(guidelineId, index),
            text: chunkContent,
            metadata: {
                guidelineId,
                title,
                organisation,
                scope: guideline.scope || 'national',
                hospitalTrust: guideline.hospitalTrust || null,
                chunkIndex: index,
                totalChunks: chunks.length
            }
        }));
    } catch (error) {
        console.error(`[RAG-INGESTION] Error processing guideline ${guideline.id}:`, error.message);
        return [];
    }
}

/**
 * Extract organisation from guideline title
 */
function extractOrganisationFromTitle(title) {
    const orgPatterns = [
        { regex: /^(NICE|RCOG|BASHH|FSRH|BMS|BSH|BHIVA|BAPM|BJOG|ESHRE|FIGO|WHO|NHS)\b/i, group: 1 },
        { regex: /\b(NICE|RCOG|BASHH|FSRH)\b/i, group: 1 },
        { regex: /^(GTG|Green-top)/i, org: 'RCOG' },
        { regex: /^(CG|NG|QS|PH)\d/i, org: 'NICE' },
        { regex: /^(MP|GP|SP|P\d)/i, org: 'UHSussex' },
        { regex: /UHSussex|UHSx/i, org: 'UHSussex' }
    ];

    for (const pattern of orgPatterns) {
        const match = title.match(pattern.regex);
        if (match) {
            return pattern.org || match[pattern.group].toUpperCase();
        }
    }
    
    return 'Unknown';
}

/**
 * Ingest all guidelines from Firestore
 * Uses the FULL content field for each guideline
 * 
 * @param {Object} db - Firestore database instance
 * @param {Object} options - Processing options
 * @returns {Promise<Object>} - Processing results
 */
async function ingestFromFirestore(db, options = {}) {
    const { dryRun = false, batchSize = 100, limit = null } = options;
    
    const results = {
        totalGuidelines: 0,
        guidelinesWithContent: 0,
        guidelinesWithoutContent: 0,
        totalChunks: 0,
        processedGuidelines: 0,
        skipped: [],
        errors: []
    };

    console.log(`[RAG-INGESTION] Starting Firestore ingestion...`);
    console.log(`[RAG-INGESTION] Dry run: ${dryRun}`);
    
    try {
        // Get all guidelines from Firestore
        let query = db.collection('guidelines');
        if (limit) {
            query = query.limit(limit);
        }
        
        const snapshot = await query.get();
        results.totalGuidelines = snapshot.size;
        
        console.log(`[RAG-INGESTION] Found ${results.totalGuidelines} guidelines in Firestore`);

        // Collect all documents
        const allDocuments = [];
        
        for (const doc of snapshot.docs) {
            const guideline = { id: doc.id, ...doc.data() };
            
            // Check if guideline has content
            if (!guideline.content || guideline.content.trim().length === 0) {
                results.guidelinesWithoutContent++;
                results.skipped.push({
                    id: guideline.id,
                    title: guideline.title || guideline.humanFriendlyName,
                    reason: 'No content'
                });
                continue;
            }
            
            results.guidelinesWithContent++;
            
            // Process the guideline
            const chunks = processFirestoreGuideline(guideline);
            
            if (chunks.length > 0) {
                allDocuments.push(...chunks);
                results.processedGuidelines++;
            }
        }

        results.totalChunks = allDocuments.length;
        console.log(`[RAG-INGESTION] Prepared ${results.totalChunks} chunks from ${results.processedGuidelines} guidelines`);
        console.log(`[RAG-INGESTION] Skipped ${results.guidelinesWithoutContent} guidelines without content`);

        // Upload to Pinecone (unless dry run)
        if (!dryRun && allDocuments.length > 0) {
            console.log(`[RAG-INGESTION] Uploading to Pinecone...`);
            
            try {
                const upsertResult = await upsertDocuments(allDocuments);
                results.uploaded = upsertResult.upsertedCount;
                console.log(`[RAG-INGESTION] Upload complete: ${results.uploaded} chunks`);
            } catch (error) {
                console.error(`[RAG-INGESTION] Upload failed:`, error.message);
                results.errors.push(error.message);
            }
        }

        return results;
        
    } catch (error) {
        console.error(`[RAG-INGESTION] Firestore ingestion failed:`, error.message);
        results.errors.push(error.message);
        return results;
    }
}

module.exports = {
    chunkText,
    extractMetadata,
    processGuidelineFile,
    processAllGuidelines,
    processFirestoreGuideline,
    ingestFromFirestore,
    reingestGuideline,
    getIngestionStatus,
    CHUNK_SIZE,
    CHUNK_OVERLAP
};
