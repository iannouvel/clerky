'use strict';

const { db } = require('../config/firebase');
const { syncPracticePoints, samplePracticePoints, runCalibrationRun, runCalibrationLoop } = require('../services/calibration');

// In-memory job store — same pattern as evolutionJobs in promptsController
const calibrationJobs = {};

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
            const totalPruned = results.reduce((s, r) => s + (r.pruned || 0), 0);
            return res.json({ success: true, results, totalCreated, totalExisting, totalPruned });
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

/**
 * POST /runCalibration
 * Body: { guidelineId, pointCount?, scenarioCount? }
 *
 * Starts a background calibration run. Returns immediately with a jobId.
 * Poll GET /getCalibrationJobStatus?jobId=xxx for progress.
 */
exports.runCalibration = (req, res) => {
    const { guidelineId, pointCount, scenarioCount } = req.body;
    if (!guidelineId) return res.status(400).json({ success: false, error: 'guidelineId required' });

    const userId = req.user.uid;
    const jobId = `cal_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

    calibrationJobs[jobId] = {
        status: 'running',
        guidelineId,
        step: 'starting',
        stepMessage: 'Initialising...',
        startedAt: new Date().toISOString()
    };

    res.json({ success: true, jobId, message: 'Calibration run started.' });

    // Fire and forget
    runCalibrationRun(
        guidelineId,
        userId,
        { pointCount: parseInt(pointCount) || 10, scenarioCount: parseInt(scenarioCount) || 4 },
        (step, message) => {
            calibrationJobs[jobId] = { ...calibrationJobs[jobId], step, stepMessage: message };
        }
    ).then(result => {
        calibrationJobs[jobId] = { status: 'complete', guidelineId, result, completedAt: new Date().toISOString() };
    }).catch(err => {
        console.error(`[CALIBRATION] Job ${jobId} failed:`, err.message);
        calibrationJobs[jobId] = { status: 'error', guidelineId, error: err.message };
    });

    // Clean up after 1 hour
    setTimeout(() => { delete calibrationJobs[jobId]; }, 60 * 60 * 1000);
};

/**
 * POST /runCalibrationLoop
 * Body: { guidelineId, pointCount?, scenarioCount?, maxIterations?, perfectTarget?, maxPointFailures? }
 *
 * Starts a background calibration loop that repeats until 100% accuracy is achieved
 * consecutively (perfectTarget times) or a practice point is stuck.
 */
exports.runCalibrationLoop = (req, res) => {
    const { guidelineId, pointCount, scenarioCount, maxIterations, perfectTarget, maxPointFailures } = req.body;
    if (!guidelineId) return res.status(400).json({ success: false, error: 'guidelineId required' });

    const userId = req.user.uid;
    const jobId = `calloop_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

    calibrationJobs[jobId] = {
        status: 'running',
        guidelineId,
        step: 'starting',
        stepMessage: 'Initialising calibration loop...',
        startedAt: new Date().toISOString()
    };

    res.json({ success: true, jobId, message: 'Calibration loop started.' });

    // Fire and forget
    runCalibrationLoop(
        guidelineId,
        userId,
        {
            pointCount: parseInt(pointCount) || 10,
            scenarioCount: parseInt(scenarioCount) || 4,
            maxIterations: parseInt(maxIterations) || 10,
            perfectTarget: parseInt(perfectTarget) || 3,
            maxPointFailures: parseInt(maxPointFailures) || 5
        },
        (step, message) => {
            calibrationJobs[jobId] = { ...calibrationJobs[jobId], step, stepMessage: message };
        }
    ).then(result => {
        calibrationJobs[jobId] = { status: 'complete', guidelineId, result, completedAt: new Date().toISOString() };
    }).catch(err => {
        console.error(`[CALIBRATION] Loop job ${jobId} failed:`, err.message);
        calibrationJobs[jobId] = { status: 'error', guidelineId, error: err.message };
    });

    // Clean up after 2 hours (loops take longer)
    setTimeout(() => { delete calibrationJobs[jobId]; }, 2 * 60 * 60 * 1000);
};

/**
 * GET /getCalibrationJobStatus?jobId=xxx
 */
exports.getCalibrationJobStatus = (req, res) => {
    const { jobId } = req.query;
    if (!jobId || !calibrationJobs[jobId]) {
        return res.status(404).json({ success: false, error: 'Job not found' });
    }
    res.json({ success: true, ...calibrationJobs[jobId] });
};

/**
 * GET /getCalibrationRuns?guidelineId=xxx&limit=10
 *
 * Returns recent calibration runs for a guideline, most recent first.
 */
exports.getCalibrationRuns = async (req, res) => {
    try {
        const { guidelineId, limit } = req.query;
        if (!guidelineId) return res.status(400).json({ success: false, error: 'guidelineId required' });

        const snap = await db
            .collection('guidelines')
            .doc(guidelineId)
            .collection('calibrationRuns')
            .orderBy('timestamp', 'desc')
            .limit(parseInt(limit) || 10)
            .get();

        const runs = snap.docs.map(d => d.data());
        res.json({ success: true, guidelineId, count: runs.length, runs });

    } catch (err) {
        console.error('[CALIBRATION] getCalibrationRuns error:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
};
