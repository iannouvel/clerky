/**
 * Test extractPDFStructure + deriveSectionAnchors against a real guideline PDF.
 * Usage:
 *   node scripts/test-structure-extraction.js <guidelineId>
 *   node scripts/test-structure-extraction.js --find hypertension
 */
require('dotenv').config();
const path = require('path');
const admin = require('firebase-admin');
const SA_PATH = path.join(__dirname, '..', 'server', 'config', 'serviceAccountKey.json');

const {
    extractTextFromPDF,
    extractPDFStructure,
    deriveSectionAnchors,
    fetchPDFBuffer
} = require('../server/services/pdf');

(async () => {
    if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(require(SA_PATH)), storageBucket: 'clerky-b3be8.firebasestorage.app' });
    const db = admin.firestore();

    let id = process.argv[2];
    if (id === '--find') {
        const term = (process.argv[3] || '').toLowerCase();
        const snap = await db.collection('guidelines').get();
        const matches = [];
        snap.forEach(d => {
            const x = d.data();
            const hay = `${x.displayName || ''} ${x.title || ''} ${x.filename || ''} ${x.humanFriendlyName || ''}`.toLowerCase();
            if (hay.includes(term)) matches.push({ id: d.id, name: x.displayName || x.title || x.filename });
        });
        console.log(`Found ${matches.length} matching "${term}":`);
        matches.slice(0, 10).forEach(m => console.log(`  ${m.id}  ${m.name}`));
        if (!matches.length) process.exit(1);
        id = matches[0].id;
        console.log(`\nUsing first match: ${id}\n`);
    }
    if (!id) { console.error('Usage: node test-structure-extraction.js <guidelineId> | --find <term>'); process.exit(2); }

    const doc = await db.collection('guidelines').doc(id).get();
    if (!doc.exists) { console.error(`Not found: ${id}`); process.exit(1); }
    const data = doc.data();
    const filename = data.filename || data.originalFilename;
    console.log(`Guideline: ${data.displayName || data.title || filename}`);
    console.log(`Filename:  ${filename}\n`);

    const buf = await fetchPDFBuffer(filename);

    console.log('── extractTextFromPDF ──');
    const content = await extractTextFromPDF(buf);
    console.log(`content length: ${content ? content.length : 'null'}\n`);

    console.log('── extractPDFStructure ──');
    const structure = await extractPDFStructure(buf);
    if (!structure) { console.error('structure extraction returned null'); process.exit(1); }
    console.log(`heading source: ${structure.headingSource}`);
    console.log(`body font size: ${structure.fontSummary.bodySize}`);
    console.log(`headings found: ${structure.headings.length}`);
    console.log('\nFirst 25 headings:');
    structure.headings.slice(0, 25).forEach(h => console.log(`  [L${h.level}] (p${h.page ?? '?'}) ${h.title}`));

    console.log('\n── deriveSectionAnchors ──');
    const anchors = deriveSectionAnchors(content, structure.headings);
    console.log(`anchors located in content: ${anchors.length} / ${structure.headings.length} headings`);
    console.log('\nSection chunks (title → size):');
    anchors.forEach(a => {
        const size = a.end - a.start;
        console.log(`  ${String(size).padStart(6)} chars  [${a.start}-${a.end}]  ${a.title.slice(0, 70)}`);
    });

    // Preview how anchors pack into ~8k chunks (mirrors server packAnchorsIntoChunks).
    const TARGET = 8000;
    const packed = [];
    let cur = null;
    for (const a of [...anchors].sort((x, y) => x.start - y.start)) {
        if (!cur) { cur = { start: 0, end: a.end, n: 1 }; continue; }
        if (a.end - cur.start <= TARGET) { cur.end = a.end; cur.n++; }
        else { packed.push(cur); cur = { start: a.start, end: a.end, n: 1 }; }
    }
    if (cur) packed.push(cur);
    console.log(`\n── packing preview (target ${TARGET} chars) ──`);
    console.log(`${anchors.length} sections → ${packed.length} chunks (= ${packed.length} LLM calls instead of ${anchors.length})`);
    packed.forEach((c, i) => console.log(`  chunk ${i + 1}: ${String(c.end - c.start).padStart(6)} chars, ${c.n} sections`));

    const total = anchors.reduce((s, a) => s + (a.end - a.start), 0);
    console.log(`\nTotal content: ${content.length} chars; covered by anchors: ${total} chars (${Math.round(100 * total / content.length)}%)`);
    const sizes = anchors.map(a => a.end - a.start);
    if (sizes.length) {
        console.log(`Chunk sizes — min ${Math.min(...sizes)}, max ${Math.max(...sizes)}, avg ${Math.round(total / sizes.length)}`);
    }
    process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
