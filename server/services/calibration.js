'use strict';

const { db } = require('../config/firebase');

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Derives a stable Firestore document ID from a practice point name.
 * Lowercases, replaces non-alphanumeric runs with underscores, trims to 100 chars.
 */
function generatePointId(name) {
    return name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .substring(0, 100);
}

/**
 * Sampling weight for a practice point based on its accuracy and evaluation history.
 * Points never tested get the highest weight; near-perfect points are sampled rarely
 * (regression guard only).
 */
function samplingWeight(point) {
    if (point.evaluationCount === 0 || point.accuracy === null || point.accuracy === undefined) return 1.0;
    if (point.accuracy < 0.5)  return 0.8;
    if (point.accuracy < 0.7)  return 0.5;
    if (point.accuracy < 0.9)  return 0.2;
    return 0.05;
}

// ─── Phase 1: Sync practice points ───────────────────────────────────────────

/**
 * Reads auditableElements from a guideline document and syncs them into the
 * practicePointMetrics subcollection. Existing documents (with accumulated
 * accuracy data) are NOT overwritten — only new points are created.
 *
 * @param {string} guidelineId - Firestore document ID of the guideline
 * @returns {Promise<{ created: number, existing: number, total: number }>}
 */
async function syncPracticePoints(guidelineId) {
    const guidelineRef = db.collection('guidelines').doc(guidelineId);
    const guidelineSnap = await guidelineRef.get();

    if (!guidelineSnap.exists) throw new Error(`Guideline ${guidelineId} not found`);

    const { auditableElements, title } = guidelineSnap.data();
    if (!Array.isArray(auditableElements) || auditableElements.length === 0) {
        throw new Error(`Guideline ${guidelineId} has no auditableElements — run practice point extraction first`);
    }

    const metricsCol = guidelineRef.collection('practicePointMetrics');

    // Fetch existing point IDs to avoid overwriting accumulated accuracy data
    const existingSnap = await metricsCol.get();
    const existingIds = new Set(existingSnap.docs.map(d => d.id));

    const batch = db.batch();
    let created = 0;
    let existing = 0;

    for (const element of auditableElements) {
        const name = element.name || element.title || '';
        if (!name) continue;

        const pointId = generatePointId(name);

        if (existingIds.has(pointId)) {
            existing++;
            continue;
        }

        batch.set(metricsCol.doc(pointId), {
            name,
            description: element.description || '',
            significance: element.significance || '',
            accuracy: null,       // not yet evaluated
            evaluationCount: 0,
            lastEvaluated: null,
            syncedAt: new Date().toISOString(),
            guidelineId,
            guidelineTitle: title || ''
        });
        created++;
    }

    if (created > 0) await batch.commit();

    return { created, existing, total: auditableElements.length };
}

// ─── Weighted sampling ────────────────────────────────────────────────────────

/**
 * Returns `count` practice points sampled from the practicePointMetrics subcollection
 * using inverse-accuracy weighting. Points never tested are prioritised; near-perfect
 * points are sampled rarely (regression guard).
 *
 * @param {string} guidelineId
 * @param {number} count - How many points to return (default 10)
 * @returns {Promise<Array<{ id: string, name: string, description: string, accuracy: number|null, evaluationCount: number }>>}
 */
async function samplePracticePoints(guidelineId, count = 10) {
    const snap = await db
        .collection('guidelines')
        .doc(guidelineId)
        .collection('practicePointMetrics')
        .get();

    if (snap.empty) throw new Error(`No practice points found for guideline ${guidelineId} — run syncPracticePoints first`);

    const points = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    if (points.length <= count) return points;

    // Weighted reservoir sampling
    const weights = points.map(p => samplingWeight(p));
    const totalWeight = weights.reduce((a, b) => a + b, 0);

    const selected = [];
    const remaining = [...points.map((p, i) => ({ point: p, weight: weights[i] }))];

    for (let i = 0; i < count; i++) {
        let r = Math.random() * remaining.reduce((a, b) => a + b.weight, 0);
        let idx = 0;
        for (idx = 0; idx < remaining.length; idx++) {
            r -= remaining[idx].weight;
            if (r <= 0) break;
        }
        idx = Math.min(idx, remaining.length - 1);
        selected.push(remaining[idx].point);
        remaining.splice(idx, 1);
    }

    return selected;
}

// ─── Accuracy update ──────────────────────────────────────────────────────────

/**
 * Updates the accuracy EMA for a single practice point after a calibration run.
 * Uses exponential moving average: new = 0.3 × result + 0.7 × current
 * so that improvements show up meaningfully without overreacting to a single run.
 *
 * @param {string} guidelineId
 * @param {string} pointId
 * @param {number} runAccuracy - Accuracy for this point in this run (0–1)
 */
async function updatePointAccuracy(guidelineId, pointId, runAccuracy) {
    const ref = db
        .collection('guidelines')
        .doc(guidelineId)
        .collection('practicePointMetrics')
        .doc(pointId);

    const snap = await ref.get();
    if (!snap.exists) return;

    const data = snap.data();
    const current = data.accuracy;

    const newAccuracy = current === null || current === undefined
        ? runAccuracy                                   // first evaluation: use raw result
        : 0.3 * runAccuracy + 0.7 * current;           // EMA

    await ref.update({
        accuracy: newAccuracy,
        evaluationCount: (data.evaluationCount || 0) + 1,
        lastEvaluated: new Date().toISOString()
    });
}

module.exports = {
    generatePointId,
    syncPracticePoints,
    samplePracticePoints,
    updatePointAccuracy
};
