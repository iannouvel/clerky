'use strict';

const { db } = require('../config/firebase');
const { syncPracticePoints, samplePracticePoints, runCalibrationRun, runCalibrationLoop } = require('../services/calibration');
const { evolvePointAdvice, rewritePracticePoint, routeToAI } = require('../services/ai');

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

/**
 * GET /getPracticePointHistory?guidelineId=xxx&pointId=yyy
 *
 * Returns the full history of a single practice point across all calibration runs.
 * Includes all verdicts, reasoning, and trending data for detailed analysis.
 */
exports.getPracticePointHistory = async (req, res) => {
    try {
        const { guidelineId, pointId } = req.query;
        if (!guidelineId || !pointId) {
            return res.status(400).json({ success: false, error: 'guidelineId and pointId required' });
        }

        // Get the practice point metadata
        const pointSnap = await db
            .collection('guidelines')
            .doc(guidelineId)
            .collection('practicePointMetrics')
            .doc(pointId)
            .get();

        if (!pointSnap.exists) {
            return res.status(404).json({ success: false, error: 'Practice point not found' });
        }

        const pointData = pointSnap.data();

        // Get all calibration runs for this guideline
        const runsSnap = await db
            .collection('guidelines')
            .doc(guidelineId)
            .collection('calibrationRuns')
            .orderBy('timestamp', 'asc')
            .get();

        const history = [];
        for (const runDoc of runsSnap.docs) {
            const run = runDoc.data();
            for (const scenario of (run.scenarios || [])) {
                const verdict = (scenario.verdicts || {})[pointId];
                if (verdict) {
                    const detail = (scenario.pointDetail || {})[pointId] || {};
                    history.push({
                        timestamp: run.timestamp,
                        runId: run.runId,
                        iteration: run.iteration || 0,
                        scenario: scenario.name,
                        verdict,
                        applies: detail.applies,
                        reason: detail.reason || '',
                        suggestion: detail.suggestion || ''
                    });
                }
            }
        }

        // Compute trend (hits vs misses by iteration)
        const trends = {};
        for (const entry of history) {
            const iter = entry.iteration;
            if (!trends[iter]) {
                trends[iter] = { hits: 0, misses: 0, falsePos: 0, correctAbs: 0, total: 0 };
            }
            if (entry.verdict === 'hit') trends[iter].hits++;
            else if (entry.verdict === 'miss') trends[iter].misses++;
            else if (entry.verdict === 'false_positive') trends[iter].falsePos++;
            else if (entry.verdict === 'correct_absence') trends[iter].correctAbs++;
            trends[iter].total++;
        }

        res.json({
            success: true,
            guidelineId,
            pointId,
            point: {
                id: pointId,
                name: pointData.name,
                description: pointData.description,
                advice: pointData.advice,
                accuracy: pointData.accuracy,
                evaluationCount: pointData.evaluationCount,
                graduated: pointData.graduated
            },
            history,
            trends,
            totalEvaluations: history.length
        });

    } catch (err) {
        console.error('[CALIBRATION] getPracticePointHistory error:', err.message);
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

/**
 * POST /improvePracticePointAdvice
 * Body: { guidelineId, pointId, feedback }
 *
 * Uses LLM to improve the calibrated advice for a practice point,
 * incorporating user feedback and error history from calibration runs.
 */
exports.improvePracticePointAdvice = async (req, res) => {
    try {
        const { guidelineId, pointId, feedback } = req.body;
        if (!guidelineId || !pointId || !feedback) {
            return res.status(400).json({ success: false, error: 'guidelineId, pointId, and feedback required' });
        }

        const userId = req.user.uid;
        const metricsRef = db.collection('guidelines').doc(guidelineId).collection('practicePointMetrics').doc(pointId);
        const pointSnap = await metricsRef.get();
        if (!pointSnap.exists) return res.status(404).json({ success: false, error: 'Practice point not found' });

        const pointData = pointSnap.data();
        const guidelineSnap = await db.collection('guidelines').doc(guidelineId).get();
        const guidelineTitle = guidelineSnap.exists ? (guidelineSnap.data().humanFriendlyTitle || guidelineSnap.data().title || guidelineId) : guidelineId;

        // Gather error history from calibration runs
        const runsSnap = await db.collection('guidelines').doc(guidelineId).collection('calibrationRuns')
            .orderBy('timestamp', 'desc').limit(10).get();

        const scenarios = [];
        for (const runDoc of runsSnap.docs) {
            const run = runDoc.data();
            for (const scenario of (run.scenarios || [])) {
                const verdict = (scenario.verdicts || {})[pointId];
                if (verdict && verdict !== 'correct_absence') {
                    const detail = (scenario.pointDetail || {})[pointId] || {};
                    scenarios.push({
                        transcript: scenario.transcript || scenario.name,
                        suggestions: detail.suggestion ? [{ suggestion: detail.suggestion }] : [],
                        shouldApply: (scenario.groundTruth?.applies || []).includes(pointId),
                        verdict,
                        modelReason: detail.reason || ''
                    });
                }
            }
        }

        // Build enhanced prompt incorporating user feedback
        const currentAdvice = pointData.advice || '';
        const feedbackEnhanced = currentAdvice
            ? `${currentAdvice}\n\nUSER FEEDBACK (incorporate this into the improved guidance):\n${feedback}`
            : `USER FEEDBACK (use as basis for guidance):\n${feedback}`;

        const newAdvice = await evolvePointAdvice(
            { name: pointData.name, description: pointData.description || pointData.name },
            feedbackEnhanced,
            scenarios,
            guidelineTitle,
            userId
        );

        if (!newAdvice) throw new Error('LLM returned no advice');

        // Save to Firestore
        await metricsRef.update({
            advice: newAdvice,
            adviceLastUpdated: new Date().toISOString(),
            adviceLastFeedback: feedback.substring(0, 500),
            // Reset graduation so the point gets re-tested with new advice
            consecutiveCorrect: 0,
            graduated: false,
            graduatedAt: null
        });

        console.log(`[CALIBRATION] Advice improved for ${pointId} via user feedback`);
        res.json({ success: true, pointId, previousAdvice: currentAdvice, newAdvice });

    } catch (err) {
        console.error('[CALIBRATION] improvePracticePointAdvice error:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
};

/**
 * POST /rewritePracticePointRule
 * Body: { guidelineId, pointId, feedback }
 *
 * Uses LLM to rewrite the practice point itself into clearer, more testable rules.
 * Replaces the original point with 1-3 new ones in Firestore.
 */
exports.rewritePracticePointRule = async (req, res) => {
    try {
        const { guidelineId, pointId, feedback } = req.body;
        if (!guidelineId || !pointId || !feedback) {
            return res.status(400).json({ success: false, error: 'guidelineId, pointId, and feedback required' });
        }

        const userId = req.user.uid;
        const metricsCol = db.collection('guidelines').doc(guidelineId).collection('practicePointMetrics');
        const pointSnap = await metricsCol.doc(pointId).get();
        if (!pointSnap.exists) return res.status(404).json({ success: false, error: 'Practice point not found' });

        const pointData = pointSnap.data();
        const guidelineSnap = await db.collection('guidelines').doc(guidelineId).get();
        const guidelineTitle = guidelineSnap.exists ? (guidelineSnap.data().humanFriendlyTitle || guidelineSnap.data().title || guidelineId) : guidelineId;

        // Get guideline content for context
        let guidelineContent = '';
        if (guidelineSnap.exists) {
            const data = guidelineSnap.data();
            guidelineContent = data.content || data.condensed || '';
        }
        if (!guidelineContent) {
            const fullSnap = await db.collection('guidelines').doc(guidelineId).collection('content').doc('full').get();
            if (fullSnap.exists) guidelineContent = fullSnap.data()?.content || '';
        }

        // Gather error evidence
        const runsSnap = await db.collection('guidelines').doc(guidelineId).collection('calibrationRuns')
            .orderBy('timestamp', 'desc').limit(10).get();

        const errorEvidence = [];
        for (const runDoc of runsSnap.docs) {
            const run = runDoc.data();
            for (const scenario of (run.scenarios || [])) {
                const verdict = (scenario.verdicts || {})[pointId];
                if (verdict === 'miss' || verdict === 'false_positive') {
                    const detail = (scenario.pointDetail || {})[pointId] || {};
                    errorEvidence.push({
                        shouldApply: (scenario.groundTruth?.applies || []).includes(pointId),
                        verdict,
                        modelReason: detail.reason || '',
                        transcript: scenario.transcript || scenario.name
                    });
                }
            }
        }

        // Add user feedback as extra evidence context
        if (feedback) {
            errorEvidence.push({
                shouldApply: true,
                verdict: 'user_feedback',
                modelReason: `User feedback: ${feedback}`,
                transcript: ''
            });
        }

        const result = await rewritePracticePoint(
            { name: pointData.name, description: pointData.description || pointData.name },
            errorEvidence,
            guidelineTitle,
            guidelineContent,
            userId
        );

        // Delete old point and create replacements
        const batch = db.batch();
        batch.delete(metricsCol.doc(pointId));

        const newPointIds = [];
        for (const replacement of result.replacements) {
            const newId = replacement.name
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, '_')
                .replace(/^_+|_+$/g, '')
                .substring(0, 200);

            batch.set(metricsCol.doc(newId), {
                name: replacement.name,
                description: replacement.description || '',
                accuracy: null,
                evaluationCount: 0,
                lastEvaluated: null,
                syncedAt: new Date().toISOString(),
                guidelineId,
                guidelineTitle,
                rewrittenFrom: pointId,
                rewriteReason: result.reasoning
            });
            newPointIds.push(newId);
        }

        await batch.commit();

        console.log(`[CALIBRATION] Rewrote ${pointId} into ${newPointIds.length} new points`);
        res.json({
            success: true,
            originalPointId: pointId,
            replacements: result.replacements,
            reasoning: result.reasoning,
            newPointIds
        });

    } catch (err) {
        console.error('[CALIBRATION] rewritePracticePointRule error:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
};

/**
 * POST /removePracticePoint
 * Body: { guidelineId, pointId, reason }
 *
 * Removes a practice point from the calibration set.
 */
exports.removePracticePoint = async (req, res) => {
    try {
        const { guidelineId, pointId, reason } = req.body;
        if (!guidelineId || !pointId) {
            return res.status(400).json({ success: false, error: 'guidelineId and pointId required' });
        }

        const metricsRef = db.collection('guidelines').doc(guidelineId).collection('practicePointMetrics').doc(pointId);
        const pointSnap = await metricsRef.get();
        if (!pointSnap.exists) return res.status(404).json({ success: false, error: 'Practice point not found' });

        const pointData = pointSnap.data();
        await metricsRef.delete();

        console.log(`[CALIBRATION] Removed practice point ${pointId}: ${reason || 'no reason given'}`);
        res.json({ success: true, pointId, removedName: pointData.name, reason });

    } catch (err) {
        console.error('[CALIBRATION] removePracticePoint error:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
};

// ─── Phase 4: Context Evolution ──────────────────────────────────────────────

const { generateFreshScenario, testScenarioAgainstPoint, analyzeTestResult, refinePointContext } = require('../services/calibration');

/**
 * POST /contextEvolution/generateScenario
 * Body: { practicePointId, practicePointText, scenarioType, guidelineId }
 * Returns: Fresh clinical scenario
 */
exports.generateFreshScenario = async (req, res) => {
    try {
        const { practicePointText, scenarioType } = req.body;
        const userId = req.user.uid;

        if (!practicePointText || !['A', 'B'].includes(scenarioType)) {
            return res.status(400).json({ success: false, error: 'practicePointText and scenarioType (A or B) required' });
        }

        const result = await generateFreshScenario(practicePointText, scenarioType, userId);
        res.json(result);

    } catch (err) {
        console.error('[CALIBRATION] generateFreshScenario error:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
};

/**
 * POST /contextEvolution/testScenario
 * Body: { practicePointText, clinicalNote, context, expectedApplicable }
 * Returns: Full LLM response, analysis, and evaluation
 */
exports.testScenarioAgainstPoint = async (req, res) => {
    try {
        const { practicePointText, clinicalNote, context, expectedApplicable, testNumber, scenarioType } = req.body;
        const userId = req.user.uid;

        if (!practicePointText || !clinicalNote || !context) {
            return res.status(400).json({ success: false, error: 'practicePointText, clinicalNote, and context required' });
        }

        // Get LLM analysis
        const testResult = await testScenarioAgainstPoint(practicePointText, clinicalNote, context, userId);
        if (!testResult.success) throw new Error(testResult.error);

        // Analyze the result
        const analysis = analyzeTestResult(expectedApplicable, testResult.applicable, {
            citedTriggers: testResult.citedTriggers,
            citedCriteria: testResult.citedCriteria,
            citedExceptions: testResult.citedExceptions,
            citedEdgeCases: testResult.citedEdgeCases
        });

        res.json({
            success: true,
            testNumber,
            scenarioType,
            llm: {
                response: testResult.llmResponse,
                applicable: testResult.applicable,
                reasoning: testResult.reasoning,
                confidence: testResult.confidence,
                citations: {
                    triggers: testResult.citedTriggers,
                    criteria: testResult.citedCriteria,
                    exceptions: testResult.citedExceptions,
                    edgeCases: testResult.citedEdgeCases
                }
            },
            evaluation: {
                expectedApplicable,
                isCorrect: analysis.isCorrect,
                resultType: analysis.resultType,
                reasoningQuality: analysis.reasoningQuality,
                usedContextCorrectly: analysis.usedContextCorrectly
            }
        });

    } catch (err) {
        console.error('[CALIBRATION] testScenarioAgainstPoint error:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
};

/**
 * GET /contextEvolution/progress?guidelineId=X&practicePointId=Y
 * Returns: Current test progress (TP/TN counts)
 */
exports.getContextEvolutionProgress = async (req, res) => {
    try {
        const { guidelineId, practicePointId } = req.query;

        if (!guidelineId || !practicePointId) {
            return res.status(400).json({ success: false, error: 'guidelineId and practicePointId required' });
        }

        // Fetch test results for this point
        const resultsSnap = await db.collection('guidelines').doc(guidelineId)
            .collection('practicePoints').doc(practicePointId)
            .collection('contextEvolutionTests')
            .get();

        const tests = resultsSnap.docs.map(d => d.data());
        const tpCount = tests.filter(t => t.evaluation?.resultType === 'TP').length;
        const tnCount = tests.filter(t => t.evaluation?.resultType === 'TN').length;
        const contextVersion = tests[0]?.context?.version || 1;

        res.json({
            success: true,
            tpCount,
            tnCount,
            totalTests: tests.length,
            contextVersion,
            isComplete: tpCount >= 3 && tnCount >= 3
        });

    } catch (err) {
        console.error('[CALIBRATION] getContextEvolutionProgress error:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
};

/**
 * POST /contextEvolution/refineContext
 * Body: { guidelineId, practicePointId, failureType, llmReasoning, currentContext }
 * Returns: Suggested refinements
 */
exports.refinePointContext = async (req, res) => {
    try {
        const { guidelineId, practicePointId, practicePointText, clinicalNote, failureType, llmReasoning, currentContext } = req.body;
        const userId = req.user.uid;

        if (!practicePointText || !clinicalNote || !failureType || !currentContext) {
            return res.status(400).json({ success: false, error: 'Required fields missing' });
        }

        const refinements = await refinePointContext(practicePointText, clinicalNote, failureType, llmReasoning, currentContext, userId);
        res.json(refinements);

    } catch (err) {
        console.error('[CALIBRATION] refinePointContext error:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
};

/**
 * GET /contextEvolution/testHistory?guidelineId=X&practicePointId=Y&limit=10
 * Returns: Last N test results
 */
exports.getContextEvolutionTestHistory = async (req, res) => {
    try {
        const { guidelineId, practicePointId, limit = 10 } = req.query;

        if (!guidelineId || !practicePointId) {
            return res.status(400).json({ success: false, error: 'guidelineId and practicePointId required' });
        }

        const tests = await db.collection('guidelines').doc(guidelineId)
            .collection('practicePoints').doc(practicePointId)
            .collection('contextEvolutionTests')
            .orderBy('timestamp', 'desc')
            .limit(parseInt(limit))
            .get();

        const history = tests.docs.map(d => d.data());

        res.json({
            success: true,
            count: history.length,
            history
        });

    } catch (err) {
        console.error('[CALIBRATION] getContextEvolutionTestHistory error:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
};

// ─── Context Evolution: Run State Persistence ────────────────────────────────

/**
 * POST /contextEvolution/saveRunState
 * Saves the current context evolution run state to Firestore
 */
exports.saveContextEvolutionRunState = async (req, res) => {
    try {
        const userId = req.user.uid;
        const { guidelineId, guidelineName, allPoints, pointIdx, tpCount, tnCount, attempts,
                nextScenarioType, context, pointResults } = req.body;

        if (!guidelineId) {
            return res.status(400).json({ success: false, error: 'guidelineId required' });
        }

        const stateDoc = {
            guidelineId,
            guidelineName: guidelineName || '',
            allPointIds: (allPoints || []).map(p => p.id),  // just IDs to keep doc small
            pointIdx: pointIdx || 0,
            tpCount: tpCount || 0,
            tnCount: tnCount || 0,
            attempts: attempts || 0,
            nextScenarioType: nextScenarioType || 'A',
            context: context || null,
            pointResults: pointResults || {},  // { pointIdx: 'passed'|'failed' }
            updatedAt: new Date().toISOString(),
            status: 'in_progress'
        };

        await db.collection('users').doc(userId)
            .collection('contextEvolutionRuns').doc('current')
            .set(stateDoc, { merge: true });

        res.json({ success: true });
    } catch (err) {
        console.error('[CE_STATE] saveRunState error:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
};

/**
 * GET /contextEvolution/getRunState
 * Returns any saved in-progress run for the current user
 */
exports.getContextEvolutionRunState = async (req, res) => {
    try {
        const userId = req.user.uid;
        const doc = await db.collection('users').doc(userId)
            .collection('contextEvolutionRuns').doc('current').get();

        if (!doc.exists || doc.data().status !== 'in_progress') {
            return res.json({ success: true, hasRunState: false });
        }

        res.json({ success: true, hasRunState: true, state: doc.data() });
    } catch (err) {
        console.error('[CE_STATE] getRunState error:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
};

/**
 * DELETE /contextEvolution/clearRunState
 * Clears the saved run state (on restart or completion)
 */
exports.clearContextEvolutionRunState = async (req, res) => {
    try {
        const userId = req.user.uid;
        await db.collection('users').doc(userId)
            .collection('contextEvolutionRuns').doc('current')
            .delete();

        res.json({ success: true });
    } catch (err) {
        console.error('[CE_STATE] clearRunState error:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
};
