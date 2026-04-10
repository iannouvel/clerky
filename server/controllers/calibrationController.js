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
    const { guidelineId, pointCount, scenarioCount, graduationThreshold, maxAttemptsPerPoint } = req.body;
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
            pointCount: parseInt(pointCount) || 0,
            scenarioCount: parseInt(scenarioCount) || 4,
            graduationThreshold: parseInt(graduationThreshold) || 3,
            maxAttemptsPerPoint: parseInt(maxAttemptsPerPoint) || 15
        },
        (step, message, extra) => {
            // Only update step/message on the existing object — avoid spreading a large latestRun repeatedly
            const job = calibrationJobs[jobId] || {};
            job.step = step;
            job.stepMessage = message;
            if (extra) {
                // Trim latestRun at storage time to keep the job object small
                if (extra.latestRun) {
                    const lr = extra.latestRun;
                    job.latestRun = {
                        runId: lr.runId,
                        iteration: lr.iteration,
                        overallAccuracy: lr.overallAccuracy,
                        pointCount: lr.pointCount,
                        scenarioCount: lr.scenarioCount,
                        practicePointNames: lr.practicePointNames,
                        pointAccuracies: lr.pointAccuracies,
                        adviceEvolutionLog: lr.adviceEvolutionLog,
                        adviceUpdated: lr.adviceUpdated,
                        scenarios: (lr.scenarios || []).map(s => ({
                            name: s.name,
                            groundTruth: s.groundTruth,
                            verdicts: s.verdicts,
                            suggestions: (s.suggestions || []).map(sg =>
                                (typeof sg === 'string' ? sg : (sg?.suggestion || '')).substring(0, 200)
                            ),
                            pointDetail: Object.fromEntries(
                                Object.entries(s.pointDetail || {}).filter(([id]) => {
                                    const v = (s.verdicts || {})[id];
                                    return v === 'miss' || v === 'false_positive';
                                }).map(([id, d]) => [id, { applies: d.applies, reason: (d.reason || '').substring(0, 300) }])
                            )
                        }))
                    };
                }
                if (extra.pointStatus) job.pointStatus = extra.pointStatus;
                if (extra.iteration !== undefined) job.iteration = extra.iteration;
                if (extra.graduatedCount !== undefined) job.graduatedCount = extra.graduatedCount;
                if (extra.totalPoints !== undefined)    job.totalPoints    = extra.totalPoints;
                console.log(`[CAL-JOB ${jobId}] run_complete: iter=${extra.iteration}, graduated=${extra.graduatedCount}/${extra.totalPoints}`);
            }
            calibrationJobs[jobId] = job;
        }
    ).then(result => {
        calibrationJobs[jobId] = { status: 'complete', guidelineId, result, completedAt: new Date().toISOString() };
    }).catch(err => {
        console.error(`[CALIBRATION] Loop job ${jobId} failed:`, err.message);
        calibrationJobs[jobId] = { status: 'error', guidelineId, error: err.message };
    });

    // Clean up after 4 hours (large guideline loops take time)
    setTimeout(() => { delete calibrationJobs[jobId]; }, 4 * 60 * 60 * 1000);
};

/**
 * GET /getCalibrationJobStatus?jobId=xxx
 *
 * Returns a trimmed version for polling — full run records (with multi-KB
 * transcripts and pointDetail) are stripped to keep the response small.
 * The full result is only sent once on status === 'complete'.
 */
exports.getCalibrationJobStatus = (req, res) => {
    const { jobId } = req.query;
    if (!jobId || !calibrationJobs[jobId]) {
        return res.status(404).json({ success: false, error: 'Job not found' });
    }
    const job = calibrationJobs[jobId];
    // Debug: log what's in the job on polling
    const hasLatestRun = 'latestRun' in job;
    const hasPointStatus = 'pointStatus' in job;
    if (job.status === 'running' && (hasLatestRun || hasPointStatus)) {
        console.log(`[STATUS-POLL ${jobId.slice(-5)}] iter=${job.iteration}, hasLatestRun=${hasLatestRun}, hasPointStatus=${hasPointStatus}, lrSize=${job.latestRun ? 'present' : 'null'}`);
    }
    res.json({ success: true, ...job });
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

/**
 * POST /resetGraduation
 * Body: { guidelineId }
 *
 * Clears all graduation state (consecutiveCorrect, graduated, calibrationAttempts)
 * for every practice point in a guideline, allowing calibration to restart from scratch.
 */
exports.resetGraduation = async (req, res) => {
    try {
        const { guidelineId } = req.body;
        if (!guidelineId) return res.status(400).json({ success: false, error: 'guidelineId required' });

        const metricsCol = db.collection('guidelines').doc(guidelineId).collection('practicePointMetrics');
        const snap = await metricsCol.get();

        const batch = db.batch();
        let count = 0;
        for (const doc of snap.docs) {
            batch.update(metricsCol.doc(doc.id), {
                consecutiveCorrect: 0,
                graduated: false,
                graduatedAt: null,
                calibrationAttempts: 0
            });
            count++;
        }
        await batch.commit();

        res.json({ success: true, guidelineId, count });
    } catch (err) {
        console.error('[CALIBRATION] resetGraduation error:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
};
