'use strict';

const { db } = require('../config/firebase');
const { analyzeGuidelineForPatient, routeToAI, extractGuidelineLessons, storeGuidelineLearning } = require('./ai');

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

    // Fetch existing docs so we can preserve accumulated accuracy and prune stale points
    const existingSnap = await metricsCol.get();
    const existingDocs = new Map(existingSnap.docs.map(d => [d.id, d.data()]));

    // Compute the canonical IDs for the current auditableElements
    const currentIds = new Set(
        auditableElements
            .map(e => e.name || e.title || '')
            .filter(Boolean)
            .map(generatePointId)
    );

    const batch = db.batch();
    let created = 0;
    let existing = 0;
    let pruned = 0;

    // Add new points; update name/description on existing ones (preserving accuracy data)
    for (const element of auditableElements) {
        const name = element.name || element.title || '';
        if (!name) continue;

        const pointId = generatePointId(name);

        if (existingDocs.has(pointId)) {
            // Update name/description in case wording improved, but keep accuracy data
            batch.update(metricsCol.doc(pointId), {
                name,
                description: element.description || '',
                significance: element.significance || '',
                syncedAt: new Date().toISOString()
            });
            existing++;
        } else {
            batch.set(metricsCol.doc(pointId), {
                name,
                description: element.description || '',
                significance: element.significance || '',
                accuracy: null,
                evaluationCount: 0,
                lastEvaluated: null,
                syncedAt: new Date().toISOString(),
                guidelineId,
                guidelineTitle: title || ''
            });
            created++;
        }
    }

    // Delete orphaned points that have no accuracy data (safe to remove after regeneration)
    for (const [id, data] of existingDocs) {
        if (!currentIds.has(id) && (data.evaluationCount || 0) === 0) {
            batch.delete(metricsCol.doc(id));
            pruned++;
        }
    }

    await batch.commit();

    return { created, existing, pruned, total: auditableElements.length };
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

// ─── Phase 2: Guideline content retrieval ────────────────────────────────────

/**
 * Fetches guideline content using the same fallback chain as the analysis pipeline.
 * Prefers condensed version to keep token counts manageable.
 *
 * @param {string} guidelineId
 * @returns {Promise<{ title: string, content: string }>}
 */
async function getGuidelineForCalibration(guidelineId) {
    const snap = await db.collection('guidelines').doc(guidelineId).get();
    if (!snap.exists) throw new Error(`Guideline ${guidelineId} not found`);
    const data = snap.data();

    let content = data.condensed || data.content || null;

    if (!content) {
        const condensedSub = await db.collection('guidelines').doc(guidelineId).collection('content').doc('condensed').get();
        if (condensedSub.exists) content = condensedSub.data()?.condensed;
    }
    if (!content) {
        const fullSub = await db.collection('guidelines').doc(guidelineId).collection('content').doc('full').get();
        if (fullSub.exists) content = fullSub.data()?.content;
    }
    if (!content) throw new Error(`No content found for guideline ${guidelineId}`);

    return {
        title: data.humanFriendlyTitle || data.title || guidelineId,
        content
    };
}

// ─── Phase 2: Scenario generation ────────────────────────────────────────────

/**
 * Asks an LLM to generate `scenarioCount` realistic clinical notes for the guideline,
 * each with a ground truth declaring which of the `practicePoints` apply and which don't.
 *
 * Each scenario is designed as a contrastive pair set: different patient contexts mean
 * that the 10 practice points apply in different combinations, testing both recall
 * (not missing applicable points) and precision (not over-applying inapplicable ones).
 *
 * @param {string} guidelineTitle
 * @param {string} guidelineContent - Truncated guideline text for context
 * @param {Array<{ id: string, name: string, description: string }>} practicePoints
 * @param {string} userId
 * @param {number} [scenarioCount=4]
 * @returns {Promise<Array<{ name, transcript, groundTruth: { applies: string[], doesNotApply: string[] } }>>}
 */
async function generateCalibrationScenarios(guidelineTitle, guidelineContent, practicePoints, userId, scenarioCount = 4) {
    const pointList = practicePoints.map(p =>
        `ID: ${p.id}\nName: ${p.name}\nDescription: ${p.description || p.name}`
    ).join('\n\n');

    const systemPrompt = `You are a clinical educator generating realistic test cases for an AI system that applies clinical guidelines. You will produce clinical scenarios (patient notes) designed to test whether an AI correctly identifies which practice points from a guideline apply to a specific patient. Be precise about ground truth — only mark a practice point as applicable if the clinical note genuinely warrants it.`;

    const userPrompt = `Guideline: ${guidelineTitle}

Guideline content (excerpt):
${guidelineContent.substring(0, 5000)}${guidelineContent.length > 5000 ? '\n...[truncated]' : ''}

Practice points to test (${practicePoints.length} total):
${pointList}

Generate ${scenarioCount} realistic clinical notes for patients who might be managed under this guideline. Each note should:
1. Describe a plausible clinical presentation in plain prose (150–250 words), written as a clinician would document it
2. Have a varied patient context so different subsets of the practice points apply across scenarios
3. Include enough clinical detail that it is clear whether each practice point applies or not

For each scenario, declare exactly which practice point IDs apply to this specific patient (i.e., the AI SHOULD suggest action on these) and which do not apply (i.e., the AI should NOT suggest action on these — either already done, not indicated, or irrelevant to this patient).

Return ONLY valid JSON in this exact structure:
{
  "scenarios": [
    {
      "name": "Short descriptive title",
      "transcript": "Full clinical note text...",
      "groundTruth": {
        "applies": ["pointId1", "pointId3"],
        "doesNotApply": ["pointId2", "pointId4"]
      }
    }
  ]
}

All ${practicePoints.length} practice point IDs must appear in exactly one of applies or doesNotApply for each scenario.`;

    const result = await routeToAI({
        messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
        ]
    }, userId);

    if (!result?.content) throw new Error('No response from scenario generator');

    const cleaned = result.content.trim().replace(/```json\n?|\n?```/g, '');
    const parsed = JSON.parse(cleaned);

    if (!Array.isArray(parsed.scenarios)) throw new Error('Invalid scenario response format');
    return parsed.scenarios;
}

// ─── Phase 2: Per-point evaluation ───────────────────────────────────────────

/**
 * For a single scenario, evaluates the AI's suggestions against the ground truth
 * on a per-practice-point basis.
 *
 * Returns a verdict for each practice point:
 * - "hit"              — point applies, AI correctly suggested it
 * - "miss"             — point applies, AI failed to suggest it
 * - "correct_absence"  — point doesn't apply, AI correctly omitted it
 * - "false_positive"   — point doesn't apply, AI incorrectly suggested it
 *
 * @param {string} transcript - The clinical note
 * @param {Array} suggestions - AI's suggestions from analyzeGuidelineForPatient
 * @param {Array<{ id, name, description }>} practicePoints
 * @param {{ applies: string[], doesNotApply: string[] }} groundTruth
 * @param {string} userId
 * @returns {Promise<Object.<string, 'hit'|'miss'|'correct_absence'|'false_positive'>>}
 */
async function evaluateScenarioVerdicts(transcript, suggestions, practicePoints, groundTruth, userId) {
    const pointMap = Object.fromEntries(practicePoints.map(p => [p.id, p]));
    const suggestionText = suggestions.map((s, i) => `${i + 1}. ${s.suggestion || s.action || JSON.stringify(s)}`).join('\n');

    const pointEvalList = practicePoints.map(p => {
        const role = groundTruth.applies.includes(p.id) ? 'SHOULD be suggested' : 'should NOT be suggested';
        return `ID: ${p.id} [${role}]\nName: ${p.name}`;
    }).join('\n\n');

    const systemPrompt = `You are evaluating whether an AI clinical system correctly applied a set of practice points to a patient case. For each practice point, determine the verdict based on the AI's suggestions and the declared ground truth.`;

    const userPrompt = `Clinical note:
${transcript}

AI suggestions:
${suggestionText || '(no suggestions made)'}

Practice points to evaluate:
${pointEvalList}

For each practice point ID, return one of these verdicts:
- "hit": the point SHOULD be suggested AND the AI's suggestions address it
- "miss": the point SHOULD be suggested BUT the AI did not address it
- "correct_absence": the point should NOT be suggested AND the AI correctly omitted it
- "false_positive": the point should NOT be suggested BUT the AI incorrectly suggested it

Use semantic matching — if a suggestion clearly addresses the intent of a practice point (even with different wording), count it as addressed.

Return ONLY valid JSON:
{
  "verdicts": {
    "pointId1": "hit",
    "pointId2": "miss",
    "pointId3": "correct_absence"
  }
}`;

    const result = await routeToAI({
        messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
        ]
    }, userId);

    if (!result?.content) throw new Error('No response from evaluator');

    const cleaned = result.content.trim().replace(/```json\n?|\n?```/g, '');
    const parsed = JSON.parse(cleaned);
    return parsed.verdicts || {};
}

// ─── Phase 2: Full calibration run ───────────────────────────────────────────

/**
 * Runs a full calibration cycle for a guideline:
 * 1. Sample practice points (weighted by accuracy)
 * 2. Generate contrastive clinical scenarios with ground truth
 * 3. Run analyzeGuidelineForPatient on each scenario
 * 4. Evaluate per-point verdicts
 * 5. Update accuracy EMA per point
 * 6. Extract lessons for persistently failing points
 * 7. Store run record in Firestore
 *
 * @param {string} guidelineId
 * @param {string} userId
 * @param {{ pointCount?: number, scenarioCount?: number }} [options]
 * @param {Function} [onProgress] - Called with (step, message) during the run
 * @returns {Promise<Object>} Run summary
 */
async function runCalibrationRun(guidelineId, userId, options = {}, onProgress = null) {
    const { pointCount = 10, scenarioCount = 4 } = options;
    const log = (step, msg) => {
        console.log(`[CALIBRATE:${guidelineId}] ${step}: ${msg}`);
        if (onProgress) onProgress(step, msg);
    };

    log('start', `Calibration run started — ${pointCount} points, ${scenarioCount} scenarios`);

    // 1. Guideline content
    const { title: guidelineTitle, content: guidelineContent } = await getGuidelineForCalibration(guidelineId);
    log('content', `Loaded guideline: ${guidelineTitle}`);

    // 2. Sample practice points
    const practicePoints = await samplePracticePoints(guidelineId, pointCount);
    if (practicePoints.length === 0) throw new Error('No practice points available — run syncPracticePoints first');
    log('sample', `Sampled ${practicePoints.length} practice points`);

    // 3. Generate scenarios
    log('generate', 'Generating clinical scenarios...');
    const scenarios = await generateCalibrationScenarios(guidelineTitle, guidelineContent, practicePoints, userId, scenarioCount);
    log('generate', `Generated ${scenarios.length} scenarios`);

    // 4. Run analysis + evaluate each scenario
    const scenarioResults = [];
    for (let i = 0; i < scenarios.length; i++) {
        const scenario = scenarios[i];
        log('analyse', `Scenario ${i + 1}/${scenarios.length}: ${scenario.name}`);

        let suggestions = [];
        try {
            const analysis = await analyzeGuidelineForPatient(
                scenario.transcript, guidelineContent, guidelineTitle, userId, guidelineId
            );
            suggestions = analysis.suggestions || [];
        } catch (err) {
            log('analyse', `Scenario ${i + 1} analysis failed: ${err.message}`);
        }

        let verdicts = {};
        try {
            verdicts = await evaluateScenarioVerdicts(
                scenario.transcript, suggestions, practicePoints, scenario.groundTruth, userId
            );
        } catch (err) {
            log('evaluate', `Scenario ${i + 1} evaluation failed: ${err.message}`);
        }

        scenarioResults.push({ ...scenario, suggestions, verdicts });
    }

    // 5. Compute per-point accuracy for this run
    const pointRunAccuracy = {};  // pointId → { correct, total }
    for (const { groundTruth, verdicts } of scenarioResults) {
        const allPointIds = [...(groundTruth.applies || []), ...(groundTruth.doesNotApply || [])];
        for (const pointId of allPointIds) {
            if (!pointRunAccuracy[pointId]) pointRunAccuracy[pointId] = { correct: 0, total: 0 };
            pointRunAccuracy[pointId].total++;
            const verdict = verdicts[pointId];
            if (verdict === 'hit' || verdict === 'correct_absence') pointRunAccuracy[pointId].correct++;
        }
    }

    const pointAccuracies = {};
    for (const [pointId, { correct, total }] of Object.entries(pointRunAccuracy)) {
        pointAccuracies[pointId] = total > 0 ? correct / total : null;
    }

    const accuracyValues = Object.values(pointAccuracies).filter(v => v !== null);
    const overallAccuracy = accuracyValues.length > 0
        ? accuracyValues.reduce((a, b) => a + b, 0) / accuracyValues.length
        : null;

    log('accuracy', `Overall: ${overallAccuracy !== null ? (overallAccuracy * 100).toFixed(1) + '%' : 'n/a'}`);

    // 6. Update EMA per point
    const updatePromises = Object.entries(pointAccuracies).map(([pointId, acc]) =>
        acc !== null ? updatePointAccuracy(guidelineId, pointId, acc) : Promise.resolve()
    );
    await Promise.all(updatePromises);
    log('update', `Updated accuracy for ${Object.keys(pointAccuracies).length} points`);

    // 7. Extract lessons for failing points (accuracy < 0.7 in this run)
    const failingPoints = Object.entries(pointAccuracies)
        .filter(([, acc]) => acc !== null && acc < 0.7)
        .map(([pointId]) => pointId);

    if (failingPoints.length > 0) {
        log('learn', `${failingPoints.length} failing points — extracting lessons`);
        // Build a synthetic evaluation object targeting failing scenarios
        const missedNames = failingPoints.map(id => {
            const pt = practicePoints.find(p => p.id === id);
            return pt ? pt.name : id;
        });
        const syntheticEval = {
            missedRecommendations: missedNames,
            suggestionEvaluations: scenarioResults.flatMap(r =>
                Object.entries(r.verdicts)
                    .filter(([, v]) => v === 'false_positive')
                    .map(([pointId]) => ({ verdict: 'redundant', pointId }))
            )
        };
        const combinedSuggestions = scenarioResults.flatMap(r => r.suggestions);
        try {
            const lessons = await extractGuidelineLessons(guidelineTitle, syntheticEval, combinedSuggestions, userId);
            if (lessons) {
                await storeGuidelineLearning(guidelineId, lessons, guidelineTitle, userId);
                log('learn', 'Cheat sheet updated with new lessons');
            }
        } catch (err) {
            log('learn', `Lesson extraction failed: ${err.message}`);
        }
    } else {
        log('learn', 'All points at or above 0.7 — no cheat sheet update needed');
    }

    // 8. Store run record
    const runId = `cal_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const runRecord = {
        runId,
        guidelineId,
        guidelineTitle,
        timestamp: new Date().toISOString(),
        userId,
        pointCount: practicePoints.length,
        scenarioCount: scenarios.length,
        practicePointIds: practicePoints.map(p => p.id),
        scenarios: scenarioResults.map(r => ({
            name: r.name,
            transcript: r.transcript.substring(0, 500),  // truncate for storage
            groundTruth: r.groundTruth,
            suggestionsCount: r.suggestions.length,
            verdicts: r.verdicts
        })),
        pointAccuracies,
        overallAccuracy,
        failingPointCount: failingPoints.length,
        cheatSheetUpdated: failingPoints.length > 0
    };

    await db.collection('guidelines').doc(guidelineId).collection('calibrationRuns').doc(runId).set(runRecord);
    log('store', `Run ${runId} stored`);

    return runRecord;
}

module.exports = {
    generatePointId,
    syncPracticePoints,
    samplePracticePoints,
    updatePointAccuracy,
    getGuidelineForCalibration,
    generateCalibrationScenarios,
    evaluateScenarioVerdicts,
    runCalibrationRun
};
