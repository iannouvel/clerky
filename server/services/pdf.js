const admin = require('firebase-admin');
const axios = require('axios');
const PDFParser = require('pdf-parse');
const { debugLog } = require('../config/logger');

// Function to extract text from PDF buffer
async function extractTextFromPDF(pdfBuffer) {
    try {
        debugLog(`[PDF_EXTRACT] Starting PDF text extraction, buffer size: ${pdfBuffer.length}`);
        const data = await PDFParser(pdfBuffer);
        const extractedText = data.text;

        if (!extractedText || extractedText.trim().length === 0) {
            console.warn(`[PDF_EXTRACT] No text extracted from PDF`);
            return null;
        }

        // Basic text cleanup
        const cleanedText = extractedText
            .replace(/\f/g, '\n')  // Form feeds to newlines
            .replace(/\x0c/g, '\n')  // Form feeds to newlines
            .replace(/\n\s*\n\s*\n/g, '\n\n')  // Multiple newlines to double
            .replace(/ +/g, ' ')  // Multiple spaces to single
            .replace(/\t+/g, ' ')  // Tabs to spaces
            .trim();

        console.log(`[PDF_EXTRACT] Successfully extracted text: ${cleanedText.length} characters`);
        return cleanedText;
    } catch (error) {
        console.error(`[PDF_EXTRACT] Error extracting text from PDF:`, error);
        return null;
    }
}

// Function to fetch PDF from Firebase Storage (with GitHub fallback + upload)
async function fetchAndExtractPDFText(pdfFileName) {
    try {
        debugLog(`[FETCH_PDF] Fetching PDF from Firebase Storage: ${pdfFileName}`);

        const bucket = admin.storage().bucket('clerky-b3be8.firebasestorage.app');
        const file = bucket.file(`pdfs/${pdfFileName}`);

        const [exists] = await file.exists();

        let buffer;

        if (!exists) {
            // PDF not in Firebase Storage - try to fetch from GitHub and upload
            console.log(`[FETCH_PDF] PDF not found in Firebase Storage, attempting GitHub fallback: ${pdfFileName}`);

            const githubUrl = `https://github.com/iannouvel/clerky/raw/main/guidance/${encodeURIComponent(pdfFileName)}`;
            console.log(`[FETCH_PDF] Fetching from GitHub: ${githubUrl}`);

            try {
                const response = await axios.get(githubUrl, {
                    responseType: 'arraybuffer',
                    timeout: 30000,
                    headers: {
                        'User-Agent': 'Clerky-Server/1.0'
                    }
                });

                if (response.status !== 200) {
                    throw new Error(`GitHub returned status ${response.status}`);
                }

                buffer = Buffer.from(response.data);
                console.log(`[FETCH_PDF] Downloaded from GitHub, size: ${buffer.length} bytes`);

                // Upload to Firebase Storage for future use
                console.log(`[FETCH_PDF] Uploading to Firebase Storage for future use...`);
                try {
                    await file.save(buffer, {
                        metadata: {
                            contentType: 'application/pdf',
                            metadata: {
                                uploadedFrom: 'github-fallback',
                                uploadedAt: new Date().toISOString()
                            }
                        }
                    });
                    console.log(`[FETCH_PDF] Successfully uploaded ${pdfFileName} to Firebase Storage`);
                } catch (uploadError) {
                    console.error(`[FETCH_PDF] Failed to upload to Firebase Storage (will continue with extraction):`, uploadError.message);
                    // Continue anyway - we have the buffer
                }

            } catch (githubError) {
                console.error(`[FETCH_PDF] GitHub fallback failed:`, githubError.message);
                throw new Error(`PDF not found in Firebase Storage and GitHub fallback failed: ${pdfFileName}`);
            }
        } else {
            console.log(`[FETCH_PDF] Found PDF in Firebase Storage: ${pdfFileName}`);
            [buffer] = await file.download();
            debugLog(`[FETCH_PDF] Downloaded from Firebase Storage, size: ${buffer.length} bytes`);
        }

        // Extract text from PDF
        const extractedText = await extractTextFromPDF(buffer);
        return extractedText;

    } catch (error) {
        console.error(`[FETCH_PDF] Error fetching/extracting PDF ${pdfFileName}:`, error.message);
        throw error;
    }
}

module.exports = {
    extractTextFromPDF,
    fetchAndExtractPDFText
};
