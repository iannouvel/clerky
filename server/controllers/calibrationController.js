'use strict';

const { db } = require('../config/firebase');
const { syncPracticePoints, samplePracticePoints } = require('../services/calibration');

/**
 * POST /syncPracticePoints
 * Body: { guidelineId } or { all: true }
 *
 * Syncs auditableElements from one or all guidelines into their
 * practicePointMetrics subcollections. Existing accuracy data is preserved.
 */
exports.syncPracticePoints = async (req, res) => {
    try {
        const { guidelineId, all } = req.body;

        if (all) {
            const snap = await db.collection('guidelines').get();
            const results = [];
            for (const doc of snap.docs) {
                try {
                    const r = await syncPracticePoints(doc.id);
                    results.push({ guidelineId: doc.id, title: doc.data().title || doc.id, ...r });
                } catch (err) {
                    results.push({ guidelineId: doc.id, error: err.message });
                }
            }
            const totalCreated = results.reduce((s, r) => s + (r.created || 0), 0);
            const totalExisting = results.reduce((s, r) => s + (r.existing || 0), 0);
            return res.json({ success: true, results, totalCreated, totalExisting });
        }

        if (!guidelineId) return res.status(400).json({ success: false, error: 'guidelineId required' });

        const result = await syncPracticePoints(guidelineId);
        res.json({ success: true, guidelineId, ...result });

    } catch (err) {
        console.error('[CALIBRATION] syncPracticePoints error:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
};

/**
 * GET /getPracticePointMetrics?guidelineId=xxx
 *
 * Returns all practice point metrics for a guideline, sorted by accuracy ascending
 * (failing points first) with unscored points at the top.
 */
exports.getPracticePointMetrics = async (req, res) => {
    try {
        const { guidelineId } = req.query;
        if (!guidelineId) return res.status(400).json({ success: false, error: 'guidelineId required' });

        const snap = await db
            .collection('guidelines')
            .doc(guidelineId)
            .collection('practicePointMetrics')
            .get();

        const points = snap.docs.map(d => ({ id: d.id, ...d.data() }));

        // Sort: unscored first, then by accuracy ascending (worst first)
        points.sort((a, b) => {
            if (a.accuracy === null && b.accuracy !== null) return -1;
            if (b.accuracy === null && a.accuracy !== null) return 1;
            if (a.accuracy === null && b.accuracy === null) return 0;
            return a.accuracy - b.accuracy;
        });

        res.json({ success: true, guidelineId, count: points.length, points });

    } catch (err) {
        console.error('[CALIBRATION] getPracticePointMetrics error:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
};

/**
 * GET /samplePracticePoints?guidelineId=xxx&count=10
 *
 * Returns a weighted-sampled set of practice points for a calibration run.
 * Useful for previewing what a calibration run would exercise.
 */
exports.samplePracticePoints = async (req, res) => {
    try {
        const { guidelineId, count } = req.query;
        if (!guidelineId) return res.status(400).json({ success: false, error: 'guidelineId required' });

        const points = await samplePracticePoints(guidelineId, parseInt(count) || 10);
        res.json({ success: true, guidelineId, count: points.length, points });

    } catch (err) {
        console.error('[CALIBRATION] samplePracticePoints error:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
};
