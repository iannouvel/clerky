/**
 * @fileoverview PDF Service - PDF extraction and fetching utilities.
 *
 * Handles PDF text extraction from buffers and fetching PDFs from
 * Firebase Storage with automatic GitHub fallback for missing files.
 *
 * Two extraction layers:
 *   - extractTextFromPDF: fast, pdf-parse based, produces the canonical `content`
 *     string stored on each guideline. Behaviour is intentionally unchanged.
 *   - extractPDFStructure: richer, pdfjs-dist based, exposes the embedded outline
 *     (TOC/bookmarks) and per-fragment font info so we can derive section
 *     boundaries for structure-aware practice-point extraction.
 *
 * @module server/services/pdf
 * @requires firebase-admin
 * @requires axios
 * @requires pdf-parse
 * @requires pdfjs-dist (lazy-loaded inside extractPDFStructure)
 * @requires ../config/logger
 */

const admin = require('firebase-admin');
const axios = require('axios');
const PDFParser = require('pdf-parse');
const { debugLog } = require('../config/logger');

/**
 * Extracts text content from a PDF buffer.
 *
 * Performs basic text cleanup including:
 * - Converting form feeds to newlines
 * - Normalizing whitespace
 * - Trimming excess blank lines
 *
 * @async
 * @param {Buffer} pdfBuffer - Raw PDF file buffer
 * @returns {Promise<string|null>} Extracted and cleaned text, or null if extraction fails
 */
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

// ─────────────────────────────────────────────────────────────────────────────
// Structure extraction (pdfjs-dist)
//
// Used to derive section boundaries so practice-point extraction can chunk a
// guideline by its real structure instead of re-sending the whole document on
// every per-section LLM call. Produces an outline (when the PDF embeds one) or,
// for outline-less PDFs (e.g. Word exports), a font-analysis heading list.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Lazy-loads the pdfjs-dist legacy (CommonJS) build. Loaded on first use so the
 * server starts without pulling in pdfjs (and its harmless DOMMatrix/Path2D
 * rendering warnings) unless structure extraction is actually exercised.
 *
 * @returns {object} The pdfjs-dist module.
 */
let _pdfjs = null;
function getPdfjs() {
    if (!_pdfjs) {
        _pdfjs = require('pdfjs-dist/legacy/build/pdf.js');
    }
    return _pdfjs;
}

/**
 * Reconstructs visual text lines from raw pdfjs text items on a single page.
 * Items arrive roughly in reading order; consecutive items on (approximately)
 * the same baseline are merged into one line. Each line records its dominant
 * font size (weighted by character count) and font name so headings can be
 * distinguished from body text.
 *
 * @param {Array} items - pdfjs textContent.items for one page
 * @returns {Array<{text:string, y:number, dominantSize:number, fontName:string}>}
 */
function reconstructLines(items) {
    const lines = [];
    let current = null;

    for (const it of items) {
        const str = it.str || '';
        const transform = it.transform || [];
        const y = transform[5] || 0;
        const size = Math.abs(transform[3]) || Math.hypot(transform[2] || 0, transform[3] || 0) || it.height || 0;

        // Start a new line when the baseline shifts by more than ~half a line height.
        if (!current || Math.abs(current.y - y) > Math.max(2, size * 0.5)) {
            current = { y, raw: '', fontName: it.fontName || '', sizes: [] };
            lines.push(current);
        }
        current.raw += str;
        if (str.trim().length > 0) {
            current.sizes.push({ size, len: str.length, fontName: it.fontName || '' });
        }
    }

    for (const ln of lines) {
        // Dominant size = the size covering the most characters on the line.
        const sizeChars = {};
        const fontChars = {};
        for (const s of ln.sizes) {
            const k = Math.round(s.size);
            sizeChars[k] = (sizeChars[k] || 0) + Math.max(1, s.len);
            fontChars[s.fontName] = (fontChars[s.fontName] || 0) + Math.max(1, s.len);
        }
        ln.dominantSize = pickMaxKey(sizeChars, true) ?? 0;
        ln.fontName = pickMaxKey(fontChars, false) ?? ln.fontName;
        ln.text = ln.raw.replace(/\s+/g, ' ').trim();
    }

    return lines.filter(l => l.text.length > 0);
}

/** Returns the key with the largest value. `numericKey` parses the key as a number. */
function pickMaxKey(counts, numericKey) {
    let best = null;
    let bestC = -1;
    for (const [k, c] of Object.entries(counts)) {
        if (c > bestC) { bestC = c; best = numericKey ? Number(k) : k; }
    }
    return best;
}

/**
 * Detects heading lines by typography when a PDF has no embedded outline.
 * A line is treated as a heading when it is short and any of:
 *   - its dominant font is meaningfully larger than the body font, or
 *   - it is a numbered section (e.g. "9.2 Blood pressure targets"), or
 *   - it is ALL CAPS and emphasised (bold or larger).
 *
 * @param {Array} allLines - reconstructed lines across all pages (each with .page)
 * @returns {{headings: Array, bodySize: number, sizeDistribution: object}}
 */
function detectHeadingsFromFont(allLines) {
    // Body font = the size covering the most characters across the document.
    const sizeChars = {};
    for (const ln of allLines) {
        sizeChars[ln.dominantSize] = (sizeChars[ln.dominantSize] || 0) + ln.text.length;
    }
    const bodySize = pickMaxKey(sizeChars, true) ?? 0;

    const headings = [];
    for (const ln of allLines) {
        if (ln.text.length < 3 || ln.text.length > 140) continue;
        // Skip table-of-contents entries (dotted leaders + page number).
        if (/\.{4,}/.test(ln.text)) continue;

        const isLarger = bodySize > 0 && ln.dominantSize >= bodySize + 1 && ln.dominantSize > bodySize * 1.1;
        const isMuchLarger = bodySize > 0 && ln.dominantSize > bodySize * 1.4;
        const isBold = /bold|black|heavy|semibold|demi/i.test(ln.fontName || '');
        const isNumbered = /^\d+(\.\d+)*\.?\s+\S/.test(ln.text);
        const isAllCaps = /[A-Z]/.test(ln.text) && ln.text === ln.text.toUpperCase() && !/[a-z]/.test(ln.text);

        const looksHeading =
            isLarger ||
            isNumbered && (isBold || isLarger || ln.dominantSize >= bodySize) ||
            isAllCaps && (isBold || isLarger);

        if (looksHeading) {
            const level = isMuchLarger ? 0 : isLarger ? 1 : 2;
            headings.push({ title: ln.text, level, page: ln.page });
        }
    }

    return { headings, bodySize, sizeDistribution: sizeChars };
}

/**
 * Resolves an embedded PDF outline (bookmarks) into a flat heading list,
 * resolving each entry's destination to a 1-based page number where possible.
 *
 * @param {object} pdfDoc - pdfjs document proxy
 * @param {Array} nodes - outline nodes (recursive .items)
 * @param {number} level - nesting depth (0 = top level)
 * @param {Array} acc - accumulator
 * @returns {Promise<Array<{title:string, level:number, page:(number|null)}>>}
 */
async function resolveOutlineToHeadings(pdfDoc, nodes, level = 0, acc = []) {
    for (const node of nodes) {
        let page = null;
        try {
            let dest = node.dest;
            if (typeof dest === 'string') dest = await pdfDoc.getDestination(dest);
            if (Array.isArray(dest) && dest[0]) {
                const idx = await pdfDoc.getPageIndex(dest[0]);
                page = idx + 1;
            }
        } catch (e) {
            // Unresolvable destination — keep the heading, leave page null.
        }
        acc.push({ title: (node.title || '').replace(/\s+/g, ' ').trim(), level, page });
        if (node.items && node.items.length) {
            await resolveOutlineToHeadings(pdfDoc, node.items, level + 1, acc);
        }
    }
    return acc;
}

/**
 * Extracts the embedded structure of a PDF: a flat outline (if present), a
 * per-page font-annotated item list, and a derived heading list (from the
 * outline when available, otherwise from font analysis).
 *
 * NOTE: the returned `pages` array is large and intended for transient use
 * (anchor derivation) — do NOT persist it. Persist only outline/headings/
 * fontSummary plus the section anchors derived via deriveSectionAnchors.
 *
 * @async
 * @param {Buffer} pdfBuffer - Raw PDF file buffer
 * @returns {Promise<object|null>} { text, pages, outline, headings, headingSource, fontSummary } or null
 */
async function extractPDFStructure(pdfBuffer) {
    try {
        const pdfjs = getPdfjs();
        const loadingTask = pdfjs.getDocument({
            data: new Uint8Array(pdfBuffer),
            useSystemFonts: false,
            disableFontFace: true,
            isEvalSupported: false
        });
        const pdfDoc = await loadingTask.promise;
        const numPages = pdfDoc.numPages;
        debugLog(`[PDF_STRUCTURE] Opened PDF with ${numPages} pages`);

        const pages = [];
        const allLines = [];
        let fullText = '';

        for (let p = 1; p <= numPages; p++) {
            const page = await pdfDoc.getPage(p);
            const tc = await page.getTextContent();

            const items = tc.items.map(it => {
                const transform = it.transform || [];
                return {
                    text: it.str || '',
                    fontName: it.fontName || '',
                    fontSize: Math.abs(transform[3]) || it.height || 0,
                    x: transform[4] || 0,
                    y: transform[5] || 0
                };
            });
            pages.push({ pageNum: p, items });

            const lines = reconstructLines(tc.items);
            for (const ln of lines) ln.page = p;
            allLines.push(...lines);
            fullText += lines.map(l => l.text).join('\n') + '\n';
        }

        // Tier 1: embedded outline (NICE/RCOG/BJOG style PDFs).
        let rawOutline = null;
        try { rawOutline = await pdfDoc.getOutline(); } catch (e) { /* none */ }

        let outline = [];
        let headings = [];
        let headingSource = 'none';

        if (rawOutline && rawOutline.length) {
            outline = await resolveOutlineToHeadings(pdfDoc, rawOutline, 0, []);
            headings = outline.filter(h => h.title && h.title.length >= 3);
            if (headings.length) headingSource = 'outline';
        }

        // Tier 2: font analysis fallback (Word exports with no TOC).
        const fontInfo = detectHeadingsFromFont(allLines);
        if (headings.length === 0 && fontInfo.headings.length) {
            headings = fontInfo.headings;
            headingSource = 'font';
        }

        if (typeof pdfDoc.cleanup === 'function') {
            try { await pdfDoc.cleanup(); } catch (e) { /* best-effort */ }
        }

        console.log(`[PDF_STRUCTURE] ${numPages} pages, ${headings.length} headings (source: ${headingSource}), body font ~${fontInfo.bodySize}`);

        return {
            text: fullText.trim(),
            pages,
            outline,
            headings,
            headingSource,
            fontSummary: { bodySize: fontInfo.bodySize, sizeDistribution: fontInfo.sizeDistribution }
        };
    } catch (error) {
        console.error(`[PDF_STRUCTURE] Error extracting structure:`, error.message);
        return null;
    }
}

/**
 * Maps a heading list onto character offsets within the canonical `content`
 * string (the pdf-parse output stored on the guideline). Each heading title is
 * located in `content` via a whitespace-tolerant regex, so anchors stay valid
 * even though `content` and the pdfjs text reconstruction differ slightly.
 *
 * Returns sections sorted by start offset; each section's `end` is the next
 * section's `start` (last section runs to end of content). Headings that can't
 * be located in `content` are skipped.
 *
 * @param {string} content - canonical guideline content (from extractTextFromPDF)
 * @param {Array<{title:string, level?:number}>} headings - headings from extractPDFStructure
 * @returns {Array<{title:string, level:number, start:number, end:number}>}
 */
function deriveSectionAnchors(content, headings) {
    if (!content || !Array.isArray(headings) || headings.length === 0) return [];

    // Clean + dedupe heading titles, dropping table-of-contents leader lines.
    const seen = new Set();
    const candidates = [];
    for (const h of headings) {
        const title = (h.title || '').replace(/\s+/g, ' ').trim();
        if (title.length < 3 || /\.{4,}/.test(title)) continue;
        const key = title.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        candidates.push({ title, level: Number.isInteger(h.level) ? h.level : 1 });
    }

    // Locate each heading at its LAST occurrence in `content`: section titles
    // typically appear once in the TOC (early) and again as the real heading in
    // the body (later), so the last occurrence is the body one. Titles that
    // recur many times are running headers/footers, not sections — drop them.
    const anchors = [];
    for (const h of candidates) {
        const offsets = allHeadingOffsets(content, h.title);
        if (offsets.length === 0 || offsets.length > 4) continue;
        anchors.push({ title: h.title, level: h.level, start: offsets[offsets.length - 1] });
    }

    anchors.sort((a, b) => a.start - b.start);

    // Drop duplicate start offsets, then set each section's end to the next start.
    const deduped = anchors.filter((a, i) => i === 0 || a.start !== anchors[i - 1].start);
    for (let i = 0; i < deduped.length; i++) {
        deduped[i].end = i + 1 < deduped.length ? deduped[i + 1].start : content.length;
    }
    return deduped;
}

/**
 * Returns all character offsets at which a heading occurs in `content`,
 * tolerant to whitespace differences between the pdfjs heading text and the
 * pdf-parse content. Used to pick the body occurrence (the last one) and to
 * filter out running headers/footers (titles that recur many times).
 *
 * @param {string} content
 * @param {string} title - normalized heading text
 * @returns {number[]} ascending list of match offsets
 */
function allHeadingOffsets(content, title) {
    const escaped = title
        .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        .replace(/\s+/g, '\\s+');
    const offsets = [];
    let re;
    try {
        re = new RegExp(escaped, 'gi');
    } catch (e) {
        // Pathological title that won't compile to a regex — fall back to plain search.
        let from = 0, idx;
        while ((idx = content.indexOf(title, from)) !== -1) { offsets.push(idx); from = idx + title.length; }
        return offsets;
    }
    let m;
    while ((m = re.exec(content)) !== null) {
        offsets.push(m.index);
        if (m.index === re.lastIndex) re.lastIndex++; // guard against zero-width
    }
    return offsets;
}

/**
 * Downloads a PDF buffer from Firebase Storage, with automatic GitHub fallback
 * (and re-upload) when the file is missing from Storage.
 *
 * @async
 * @param {string} pdfFileName - Name of the PDF file (e.g., 'guideline.pdf')
 * @returns {Promise<Buffer>} The raw PDF buffer
 * @throws {Error} If not found in Storage and the GitHub fallback fails
 */
async function fetchPDFBuffer(pdfFileName) {
    debugLog(`[FETCH_PDF] Fetching PDF from Firebase Storage: ${pdfFileName}`);

    const bucket = admin.storage().bucket('clerky-b3be8.firebasestorage.app');
    const file = bucket.file(`pdfs/${pdfFileName}`);

    const [exists] = await file.exists();

    if (exists) {
        console.log(`[FETCH_PDF] Found PDF in Firebase Storage: ${pdfFileName}`);
        const [buffer] = await file.download();
        debugLog(`[FETCH_PDF] Downloaded from Firebase Storage, size: ${buffer.length} bytes`);
        return buffer;
    }

    // PDF not in Firebase Storage - try to fetch from GitHub and upload.
    console.log(`[FETCH_PDF] PDF not found in Firebase Storage, attempting GitHub fallback: ${pdfFileName}`);

    const githubUrl = `https://github.com/iannouvel/clerky/raw/main/guidance/${encodeURIComponent(pdfFileName)}`;
    console.log(`[FETCH_PDF] Fetching from GitHub: ${githubUrl}`);

    let buffer;
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
    } catch (githubError) {
        console.error(`[FETCH_PDF] GitHub fallback failed:`, githubError.message);
        throw new Error(`PDF not found in Firebase Storage and GitHub fallback failed: ${pdfFileName}`);
    }

    // Upload to Firebase Storage for future use.
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
        // Continue anyway - we have the buffer.
    }

    return buffer;
}

/**
 * Fetches a PDF from Firebase Storage and extracts its text content.
 *
 * If the PDF doesn't exist in Firebase Storage, automatically falls back
 * to fetching from GitHub and uploads to Firebase for future use.
 *
 * @async
 * @param {string} pdfFileName - Name of the PDF file (e.g., 'guideline.pdf')
 * @returns {Promise<string>} Extracted text content
 * @throws {Error} If PDF not found in Firebase Storage and GitHub fallback fails
 *
 * @example
 * const text = await fetchAndExtractPDFText('antenatal-care.pdf');
 * console.log(text); // "Clinical guideline for antenatal care..."
 */
async function fetchAndExtractPDFText(pdfFileName) {
    try {
        const buffer = await fetchPDFBuffer(pdfFileName);
        const extractedText = await extractTextFromPDF(buffer);
        return extractedText;
    } catch (error) {
        console.error(`[FETCH_PDF] Error fetching/extracting PDF ${pdfFileName}:`, error.message);
        throw error;
    }
}

module.exports = {
    extractTextFromPDF,
    extractPDFStructure,
    deriveSectionAnchors,
    fetchPDFBuffer,
    fetchAndExtractPDFText
};
