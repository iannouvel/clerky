/**
 * Probe a guideline's PDF for machine-readable structure:
 *   - Document outline (bookmarks / TOC)
 *   - Per-page text + font info
 *
 * Doesn't modify anything. Just reports what we can see.
 *
 * Usage: node probe-pdf-structure.js <guidelineId>
 */
require('dotenv').config();
const path = require('path');
const admin = require('firebase-admin');
const SA_PATH = path.join(__dirname, '..', 'server', 'config', 'serviceAccountKey.json');
const id = process.argv[2];
if (!id) { console.error('Usage: node probe-pdf-structure.js <guidelineId>'); process.exit(2); }

// Use pdf-parse's bundled pdfjs
const pdfjsBundled = require('pdf-parse/lib/pdf.js/v1.10.100/build/pdf.js');
const PDFJS = pdfjsBundled.PDFJS;

(async () => {
    if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(require(SA_PATH)) });
    const db = admin.firestore();
    const doc = await db.collection('guidelines').doc(id).get();
    if (!doc.exists) { console.error(`Not found: ${id}`); process.exit(1); }
    const data = doc.data();

    const filename = data.filename || data.originalFilename;
    if (!filename) { console.error('No filename on doc'); process.exit(1); }

    // Download PDF from Firebase Storage
    console.log(`Downloading pdfs/${filename}...`);
    const bucket = admin.storage().bucket('clerky-b3be8.firebasestorage.app');
    const [buf] = await bucket.file(`pdfs/${filename}`).download();
    console.log(`Got ${buf.length} bytes\n`);

    // Open with pdfjs
    const pdfDoc = await PDFJS.getDocument({ data: new Uint8Array(buf) });
    console.log(`Pages: ${pdfDoc.numPages}`);

    // 1. OUTLINE / BOOKMARKS
    console.log('\n=== Outline / Bookmarks ===');
    const outline = await pdfDoc.getOutline();
    if (!outline || outline.length === 0) {
        console.log('  (none — PDF has no embedded TOC)');
    } else {
        const printNode = (node, depth = 0) => {
            const indent = '  '.repeat(depth);
            console.log(`${indent}- "${node.title}"`);
            for (const child of (node.items || [])) printNode(child, depth + 1);
        };
        for (const node of outline) printNode(node);
        console.log(`\n  → ${countNodes(outline)} total entries`);
    }

    // 2. SAMPLE PAGE WITH FONT INFO
    console.log('\n=== Sample: page 5 text items with font info ===');
    if (pdfDoc.numPages >= 5) {
        const page = await pdfDoc.getPage(5);
        const content = await page.getTextContent();
        // Show first 12 items with their font names + sizes
        const items = content.items.slice(0, 12);
        for (const it of items) {
            const tx = it.transform || [];
            const fontSize = tx[0] || tx[3] || '?';
            const fontName = it.fontName || '?';
            const text = (it.str || '').slice(0, 60).replace(/\s+/g, ' ');
            console.log(`  size=${String(fontSize).padEnd(6)} font=${fontName.padEnd(14)} "${text}"`);
        }
    }

    // 3. INFO + METADATA
    console.log('\n=== PDF info ===');
    const info = await pdfDoc.getMetadata();
    console.log(`  Title: ${info.info?.Title || '(none)'}`);
    console.log(`  Author: ${info.info?.Author || '(none)'}`);
    console.log(`  Producer: ${info.info?.Producer || '(none)'}`);
    console.log(`  Creator: ${info.info?.Creator || '(none)'}`);
})().catch(e => { console.error(e); process.exit(1); });

function countNodes(nodes) {
    let n = 0;
    for (const node of nodes) {
        n++;
        n += countNodes(node.items || []);
    }
    return n;
}
