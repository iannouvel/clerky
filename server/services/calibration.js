'use strict';

const { db } = require('../config/firebase');
const { analyzePointForPatient, routeToAI, evolvePointAdvice, rewritePracticePoint } = require('./ai');

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
        .substring(0, 200);
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

    // Delete stale points not in the current auditable elements (accuracy history is preserved in calibration runs)
    for (const [id, data] of existingDocs) {
        if (!currentIds.has(id)) {
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

    // Use full content — condensed loses clinical detail needed for accurate calibration
    let content = data.content || data.condensed || null;

    if (!content) {
        const fullSub = await db.collection('guidelines').doc(guidelineId).collection('content').doc('full').get();
        if (fullSub.exists) content = fullSub.data()?.content;
    }
    if (!content) {
        const condensedSub = await db.collection('guidelines').doc(guidelineId).collection('content').doc('condensed').get();
        if (condensedSub.exists) content = condensedSub.data()?.condensed;
    }
    if (!content) throw new Error(`No content found for guideline ${guidelineId}`);

    return {
        title: data.humanFriendlyTitle || data.title || guidelineId,
        content
    };
}

// ─── Phase 2: Scenario generation ────────────────────────────────────────────

/**
 * Verifies and corrects the ground truth for each scenario using the EXACT same
 * applicability rubric as `analyzePointForPatient`. This eliminates mismatches
 * where the generator assigns ground truth with broad reasoning ("condition present →
 * applies") but the evaluator uses a stricter rule ("indicated AND not already
 * documented → applies").
 *
 * Runs one LLM call per scenario (not per point) for efficiency.
 */
async function verifyScenarioGroundTruths(scenarios, guidelineTitle, practicePoints, userId) {
    const allIds = new Set(practicePoints.map(p => p.id));
    const verified = [];

    for (let i = 0; i < scenarios.length; i++) {
        const scenario = scenarios[i];

        const pointList = practicePoints.map(p => {
            let entry = `ID: ${p.id}\nName: ${p.name}`;
            if (p.advice) entry += `\nApplication guidance:\n${p.advice}`;
            return entry;
        }).join('\n\n---\n\n');

        const prompt = `You are verifying calibration ground truth for a clinical AI system. Read the clinical note and decide, for EACH practice point, whether it applies.

CLINICAL NOTE:
${scenario.transcript}

GUIDELINE: ${guidelineTitle}

PRACTICE POINTS (${practicePoints.length} total):
${pointList}

Use this EXACT rubric for every practice point:
- applies = YES if: the action is clinically indicated AND genuinely outstanding — not yet done, arranged, or implied by what is already documented
- applies = NO if ANY of these are true:

ALREADY DONE OR IMPLIED:
  (a) The note explicitly documents the action as taken, planned, scheduled, or in progress
  (b) The note describes a management plan that necessarily implies this rule is already satisfied — e.g. if emergency delivery is planned, tocolysis contraindication is implicit; if speculum examination is documented, avoiding digital examination is already satisfied; if the MDT is assembled, MDT involvement is met; if the patient is already admitted to a maternity unit, "transfer to a maternity unit" has already occurred
  (c) Equivalent care is documented under a different name — "senior fetal medicine consultant" satisfies "skilled operator"; "extensive counselling" satisfies a counselling point even without quoting exact figures

WRONG STAGE OR CONTEXT:
  (d) The action belongs to a different stage of care than the note describes — postnatal recommendations do not apply to antenatal notes; triage actions (transfer, initial assessment) do not apply once the patient is already in the appropriate setting; pre-procedure steps do not apply after the procedure is complete; acute resuscitation actions do not apply to stable follow-up notes
  (e) Wrong patient subtype — a rule about unexplained APH does not apply when the cause is known; twin-specific guidance does not apply to singletons; a rule gated on a specific finding (e.g. confirmed coagulopathy) does not apply when that finding is absent or unconfirmed
  (f) Clinically inappropriate given current acuity — corticosteroids for lung maturation are not indicated when immediate emergency delivery is underway; long-term antenatal care planning is not appropriate during acute resuscitation
  (g) The application guidance explicitly says not to suggest in this scenario

KEY DISTINCTIONS:
- A patient "considering" or "discussing" a procedure is NOT the same as it being performed or concretely scheduled — timing safety rules only apply when the procedure is actively being performed or definitively booked
- If a patient is already in the correct timing window and proceeding appropriately, timing recommendations are already satisfied → applies = NO
- "Pending results" means the clinician is aware and acting — do NOT flag as a gap unless the action is genuinely omitted

Return ONLY valid JSON — no other text:
{
  "applies": ["id1", "id3"],
  "doesNotApply": ["id2", "id4"]
}

All ${practicePoints.length} IDs must appear in exactly one list.`;

        try {
            const result = await routeToAI({
                messages: [
                    { role: 'system', content: 'You are a clinical educator verifying calibration ground truth. Return ONLY valid JSON. No preamble, no markdown.' },
                    { role: 'user', content: prompt }
                ]
            }, userId, null, 2000, 'simple');

            const cleaned = result?.content?.trim().replace(/```json\n?|\n?```/g, '') || '{}';
            const parsed = JSON.parse(cleaned);

            if (Array.isArray(parsed.applies) && Array.isArray(parsed.doesNotApply)) {
                const verifiedGT = {
                    applies: parsed.applies.filter(id => allIds.has(id)),
                    doesNotApply: parsed.doesNotApply.filter(id => allIds.has(id))
                };
                // Ensure every ID is covered
                const covered = new Set([...verifiedGT.applies, ...verifiedGT.doesNotApply]);
                for (const id of allIds) {
                    if (!covered.has(id)) verifiedGT.doesNotApply.push(id);
                }

                const before = scenario.groundTruth?.applies?.length ?? 0;
                const after = verifiedGT.applies.length;
                if (before !== after) {
                    console.log(`[CALIB] Ground truth corrected for "${scenario.name}": ${before} → ${after} applies`);
                }
                scenario.groundTruth = verifiedGT;
            }
        } catch (e) {
            console.warn(`[CALIB] Ground truth verification failed for "${scenario.name}": ${e.message} — keeping generator assignment`);
        }

        verified.push(scenario);
        await new Promise(resolve => setTimeout(resolve, 150));
    }

    return verified;
}

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
    const pointList = practicePoints.map(p => {
        let entry = `ID: ${p.id}\nName: ${p.name}\nDescription: ${p.description || p.name}`;
        if (p.advice) entry += `\nEvolved advice (from prior calibration runs):\n${p.advice}`;
        return entry;
    }).join('\n\n');

    const systemPrompt = `You are a clinical educator generating realistic test cases for an AI clinical decision support system. Your job is to produce clinical scenarios (patient notes) and a ground truth of which practice points genuinely need acting on in each note.`;

    const userPrompt = `Guideline: ${guidelineTitle}

Guideline content (excerpt):
${guidelineContent.substring(0, 5000)}${guidelineContent.length > 5000 ? '\n...[truncated]' : ''}

Practice points to test (${practicePoints.length} total):
${pointList}

Generate ${scenarioCount} realistic clinical notes for patients who might be managed under this guideline.

=== HOW TO WRITE EACH SCENARIO ===

Step 1 — Choose which practice points will be TESTABLE in this scenario.
Pick 2–4 practice points that should genuinely apply. For each one, decide what clinical situation makes it outstanding (not yet done). The remaining points should clearly not apply (wrong patient, wrong timing, wrong clinical context).

Step 2 — Write the clinical note AROUND those gaps.
Write a 150–250 word clinical note as a clinician would document it. The note must:
- Set up the clinical context so the testable practice points are clearly indicated
- DELIBERATELY OMIT any mention of those actions being done, planned, arranged, or scheduled
- Include enough detail about the patient's situation, timing, and findings so that it is clear which points apply and which do not
- Vary the temporal stage across scenarios (some antenatal, some intrapartum, some postnatal)

The note should read as a snapshot in time where certain actions are needed but have not yet been taken. Do NOT write a comprehensive management plan that documents everything as already handled — that leaves nothing for the AI to suggest.

Step 3 — Assign ground truth by checking each practice point against the note.
For each practice point, ask: "Would a clinician reading ONLY this note right now need to take this action?"
- "applies" = YES: the action is clinically indicated AND the note does not document it as done/planned/scheduled
- "doesNotApply" = NO: the action is not indicated (wrong patient, wrong timing, precondition not met, already documented as done)

Key principles:
- A practice point whose action is already documented in the note (taken, planned, arranged, referred, scheduled) → doesNotApply
- A practice point requiring a clinical finding not documented in the note → doesNotApply
- A practice point for a different temporal stage than the note describes (e.g., postnatal advice in an antenatal note, pre-procedural guidance post-delivery) → doesNotApply
- A practice point for a different patient subtype than described (e.g., monoamniotic guidance for a diamniotic patient) → doesNotApply

IMPORTANT — Evolved advice: Some practice points include "Evolved advice" learned from prior calibration runs. This advice captures known edge cases (e.g., "DO NOT SUGGEST WHEN diagnosis is unconfirmed"). You MUST respect these rules when assigning ground truth. If a scenario matches a "DO NOT SUGGEST WHEN" condition, that point is doesNotApply regardless of surface-level relevance.

For each scenario, declare exactly which practice point IDs apply to this specific patient and which do not apply.

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

    // gemini-2.0-flash: no thinking tokens, so the full output budget goes to actual JSON content
    const result = await routeToAI({
        messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
        ]
    }, userId, null, 8000, 'simple');

    if (!result?.content) throw new Error('No response from scenario generator');

    const cleaned = result.content.trim().replace(/```json\n?|\n?```/g, '');
    const parsed = JSON.parse(cleaned);

    if (!Array.isArray(parsed.scenarios)) throw new Error('Invalid scenario response format');

    // Validate and repair ground truth: every practice point ID must appear in exactly one partition
    const allIds = new Set(practicePoints.map(p => p.id));
    for (const scenario of parsed.scenarios) {
        const gt = scenario.groundTruth || {};
        gt.applies = Array.isArray(gt.applies) ? gt.applies : [];
        gt.doesNotApply = Array.isArray(gt.doesNotApply) ? gt.doesNotApply : [];

        const covered = new Set([...gt.applies, ...gt.doesNotApply]);
        for (const id of allIds) {
            if (!covered.has(id)) {
                // Assign unpartitioned IDs to doesNotApply (conservative default)
                gt.doesNotApply.push(id);
            }
        }
        // Remove any IDs not in the current practice point set
        gt.applies = gt.applies.filter(id => allIds.has(id));
        gt.doesNotApply = gt.doesNotApply.filter(id => allIds.has(id));
        scenario.groundTruth = gt;
    }

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
    const suggestionText = suggestions.length > 0
        ? suggestions.map((s, i) => `[S${i + 1}] ${s.suggestion || s.action || JSON.stringify(s)}`).join('\n')
        : '(no suggestions made)';

    const pointEvalList = practicePoints.map(p => {
        const role = groundTruth.applies.includes(p.id) ? 'SHOULD be suggested' : 'should NOT be suggested';
        return `ID: ${p.id} [${role}]\nName: ${p.name}\nDescription: ${p.description || p.name}`;
    }).join('\n\n');

    const systemPrompt = `You are a strict evaluator assessing whether an AI clinical decision support system correctly applied specific clinical practice points to a patient case. You must be precise: do not conflate distinct clinical actions with each other.`;

    const userPrompt = `Clinical note:
${transcript}

AI suggestions (labelled S1, S2, ...):
${suggestionText}

Practice points to evaluate:
${pointEvalList}

Instructions:
For each practice point, first identify which specific AI suggestion (by label, e.g. S1, S2) directly and unambiguously addresses that practice point. Then assign a verdict.

Verdict rules:
- "hit": the point SHOULD be suggested AND at least one AI suggestion directly addresses this specific clinical action (the match must be unambiguous — a general suggestion about documentation does NOT count as a hit for a specific clinical action like performing a CTG)
- "miss": the point SHOULD be suggested AND no AI suggestion directly addresses it
- "correct_absence": the point should NOT be suggested AND the AI made no suggestion that addresses it
- "false_positive": the point should NOT be suggested BUT an AI suggestion explicitly recommends this specific action

Critical: do NOT assign "hit" unless you can cite the specific suggestion label that addresses this point. Do NOT assign "false_positive" unless an AI suggestion explicitly calls for this specific action. When in doubt, prefer "miss" over "hit" and "correct_absence" over "false_positive".

Return ONLY valid JSON with this exact structure:
{
  "verdicts": {
    "pointId1": { "verdict": "hit", "matchedSuggestion": "S2", "reasoning": "S2 explicitly recommends performing CTG" },
    "pointId2": { "verdict": "miss", "matchedSuggestion": null, "reasoning": "No suggestion addressed advising the patient to report future episodes" }
  }
}

Every practice point ID listed above must have an entry.`;

    // gemini-2.0-flash: no thinking tokens, so the full output budget goes to the verdict JSON
    const result = await routeToAI({
        messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
        ]
    }, userId, null, 8000, 'simple');

    if (!result?.content) throw new Error('No response from evaluator');

    const cleaned = result.content.trim().replace(/```json\n?|\n?```/g, '');
    const parsed = JSON.parse(cleaned);

    // Normalise: accept both { verdict: "..." } objects and bare strings
    const verdicts = {};
    for (const [pointId, value] of Object.entries(parsed.verdicts || {})) {
        verdicts[pointId] = typeof value === 'string' ? value : (value.verdict || 'miss');
    }
    return verdicts;
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
    const { pointCount = 10, scenarioCount = 4, specificPoints = null } = options;
    const log = (step, msg) => {
        console.log(`[CALIBRATE:${guidelineId}] ${step}: ${msg}`);
        if (onProgress) onProgress(step, msg);
    };

    log('start', `Calibration run started — ${specificPoints ? specificPoints.length + ' specific' : pointCount} points, ${scenarioCount} scenarios`);

    // 1. Guideline content
    const { title: guidelineTitle, content: guidelineContent } = await getGuidelineForCalibration(guidelineId);
    log('content', `Loaded guideline: ${guidelineTitle}`);

    // 2. Sample practice points (or use specifically provided ones)
    let practicePoints;
    if (specificPoints && specificPoints.length > 0) {
        practicePoints = specificPoints;
        log('sample', `Using ${practicePoints.length} provided practice points`);
    } else {
        practicePoints = await samplePracticePoints(guidelineId, pointCount);
        if (practicePoints.length === 0) throw new Error('No practice points available — run syncPracticePoints first');
        log('sample', `Sampled ${practicePoints.length} practice points`);
    }

    // Load evolved advice for each point (used by both scenario generator and analyser)
    let pointsWithAdvice = practicePoints;
    try {
        const adviceSnaps = await Promise.all(
            practicePoints.map(p =>
                db.collection('guidelines').doc(guidelineId)
                  .collection('practicePointMetrics').doc(p.id).get()
            )
        );
        pointsWithAdvice = practicePoints.map((p, idx) => ({
            ...p,
            advice: adviceSnaps[idx].exists ? (adviceSnaps[idx].data().advice || null) : null
        }));
    } catch (err) {
        log('advice', `Could not load advice: ${err.message}`);
    }

    // 3. Generate scenarios (with advice so the generator respects known edge cases)
    log('generate', 'Generating clinical scenarios...');
    const rawScenarios = await generateCalibrationScenarios(guidelineTitle, guidelineContent, pointsWithAdvice, userId, scenarioCount);
    log('generate', `Generated ${rawScenarios.length} scenarios — verifying ground truth...`);

    // 3b. Verify ground truth using the evaluator's exact rubric.
    // The generator assigns ground truth with broad reasoning; the evaluator uses a stricter
    // rule ("indicated AND not already documented"). This pass aligns them.
    const scenarios = await verifyScenarioGroundTruths(rawScenarios, guidelineTitle, pointsWithAdvice, userId);
    log('generate', `Ground truth verified for ${scenarios.length} scenarios`);

    // 4. Run per-point analysis on each scenario.
    // Each practice point gets its own focused LLM call (all in parallel per scenario).
    // Verdicts are derived directly from applies:true/false vs ground truth —
    // no separate evaluator LLM needed.
    const scenarioResults = [];
    for (let i = 0; i < scenarios.length; i++) {
        const scenario = scenarios[i];
        log('analyse', `Scenario ${i + 1}/${scenarios.length}: ${scenario.name}`);

        // One call per point, all in parallel
        let pointResults = [];
        try {
            pointResults = await Promise.all(
                pointsWithAdvice.map(p => analyzePointForPatient(
                    scenario.transcript, guidelineContent, guidelineTitle, p, guidelineId, userId, 'gemini-2.0-flash'
                ))
            );
        } catch (err) {
            log('analyse', `Scenario ${i + 1} per-point analysis failed: ${err.message}`);
        }

        // Derive verdicts directly — no evaluator LLM
        const pointResultMap = Object.fromEntries(pointResults.map(r => [r.pointId, r]));
        const verdicts = {};
        const allPointIds = [...(scenario.groundTruth.applies || []), ...(scenario.groundTruth.doesNotApply || [])];
        for (const pointId of allPointIds) {
            const r = pointResultMap[pointId];
            const modelApplies = r ? r.applies : false;
            const shouldApply = (scenario.groundTruth.applies || []).includes(pointId);
            if (modelApplies && shouldApply)       verdicts[pointId] = 'hit';
            else if (!modelApplies && shouldApply) verdicts[pointId] = 'miss';
            else if (!modelApplies && !shouldApply) verdicts[pointId] = 'correct_absence';
            else                                    verdicts[pointId] = 'false_positive';
        }

        // Collect suggestion strings for record-keeping
        const suggestions = pointResults
            .filter(r => r.applies && r.suggestion)
            .map(r => r.suggestion);

        scenarioResults.push({ ...scenario, suggestions, verdicts, pointResults });
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

    // 7. Evolve per-point advice for all points that had any error in this run (accuracy < 1.0).
    // Any miss is a learning signal — 75% (3/4 scenarios correct) still means the model
    // got one case wrong, which warrants advice refinement.
    const failingPointIds = Object.entries(pointAccuracies)
        .filter(([, acc]) => acc !== null && acc < 1.0)
        .map(([id]) => id);

    let adviceUpdated = 0;
    const adviceEvolutionLog = [];   // [{ pointId, pointName, before, after }]

    if (failingPointIds.length > 0) {
        log('learn', `${failingPointIds.length} failing points — evolving per-point advice`);

        for (const pointId of failingPointIds) {
            const point = practicePoints.find(p => p.id === pointId);
            if (!point) continue;

            // Collect every scenario that involved this point, with full context.
            // Pass the model's per-point suggestion and reasoning so evolvePointAdvice
            // has precise evidence of what the model said (and why) rather than the
            // full suggestion list from the old single-pass approach.
            const relevantScenarios = scenarioResults
                .filter(r => [...(r.groundTruth.applies || []), ...(r.groundTruth.doesNotApply || [])].includes(pointId))
                .map(r => {
                    const pr = (r.pointResults || []).find(x => x.pointId === pointId);
                    return {
                        transcript: r.transcript,
                        suggestions: pr?.suggestion ? [{ suggestion: pr.suggestion }] : [],
                        modelReason: pr?.reason || null,
                        verdict: (r.verdicts || {})[pointId] || 'unknown',
                        shouldApply: (r.groundTruth.applies || []).includes(pointId)
                    };
                });

            if (relevantScenarios.length === 0) continue;

            // Load current advice so the evolution can improve on it
            const pointRef = db
                .collection('guidelines').doc(guidelineId)
                .collection('practicePointMetrics').doc(pointId);
            const pointSnap = await pointRef.get();
            const currentAdvice = pointSnap.exists ? (pointSnap.data().advice || null) : null;

            try {
                const newAdvice = await evolvePointAdvice(point, currentAdvice, relevantScenarios, guidelineTitle, userId);
                if (newAdvice) {
                    await pointRef.update({ advice: newAdvice, adviceUpdatedAt: new Date().toISOString() });
                    adviceUpdated++;
                    adviceEvolutionLog.push({
                        pointId,
                        pointName: point.name,
                        before: currentAdvice || null,
                        after: newAdvice
                    });
                    log('learn', `Evolved advice for: ${point.name}`);
                }
            } catch (err) {
                log('learn', `Advice evolution failed for ${pointId}: ${err.message}`);
            }
        }
    } else {
        log('learn', 'All points scored 100% this run — no advice evolution needed');
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
        practicePointNames: Object.fromEntries(practicePoints.map(p => [p.id, p.name])),
        scenarios: scenarioResults.map(r => ({
            name: r.name,
            transcript: r.transcript,
            groundTruth: r.groundTruth,
            suggestions: r.suggestions.map(s => (typeof s === 'string' ? s : (s.suggestion || s.action || JSON.stringify(s))).substring(0, 400)),
            verdicts: r.verdicts,
            // Per-point detail: model's applies decision + full reason for each point
            pointDetail: r.pointResults
                ? Object.fromEntries(r.pointResults.map(pr => [pr.pointId, { applies: pr.applies, reason: pr.reason || '' }]))
                : {}
        })),
        pointAccuracies,
        overallAccuracy,
        failingPointCount: failingPointIds.length,
        adviceUpdated,
        adviceEvolutionLog
    };

    await db.collection('guidelines').doc(guidelineId).collection('calibrationRuns').doc(runId).set(runRecord);
    log('store', `Run ${runId} stored`);

    return runRecord;
}

// ─── Auto-deduplication of stuck points ──────────────────────────────────────

/**
 * When stuck points are detected, uses an LLM call to identify semantic
 * duplicates among them. For each cluster of duplicates, keeps the most
 * detailed version and removes the rest from both practicePointMetrics
 * and auditableElements.
 *
 * @returns {{ removed: string[], kept: string[] }} IDs removed and kept
 */
async function deduplicateStuckPoints(guidelineId, stuckPoints, userId) {
    if (stuckPoints.length < 2) return { removed: [], kept: [] };

    const ruleList = stuckPoints.map((p, i) =>
        `[${i}] ${p.name}`
    ).join('\n');

    const result = await routeToAI({
        messages: [
            { role: 'system', content: 'You are a clinical rule analyst. Return ONLY a valid JSON array. No other text.' },
            { role: 'user', content: `Identify groups of rules below that cover the same underlying clinical decision — same or near-identical condition AND action, even if worded differently.

${ruleList}

Return a JSON array of clusters. Each cluster is an array of integer indices. Only include clusters with 2+ members. Return [] if no duplicates.
Example: [[0,3,7],[2,9]]` }
        ]
    }, userId, null, 1024, 'simple');

    let clusters = [];
    try {
        const raw = result?.content || '[]';
        const cleaned = raw.trim().replace(/```json\n?|\n?```/g, '');
        clusters = JSON.parse(cleaned).filter(c => Array.isArray(c) && c.length >= 2);
    } catch (e) {
        const match = (result?.content || '').match(/\[\s*(?:\[\d[\d,\s]*\]\s*,?\s*)*\]/);
        if (match) try { clusters = JSON.parse(match[0]).filter(c => Array.isArray(c) && c.length >= 2); } catch (_) {}
    }

    if (clusters.length === 0) return { removed: [], kept: [] };

    const guidelineRef = db.collection('guidelines').doc(guidelineId);
    const metricsCol = guidelineRef.collection('practicePointMetrics');
    const removed = [];
    const kept = [];

    for (const cluster of clusters) {
        const members = cluster.map(i => stuckPoints[i]).filter(Boolean);
        if (members.length < 2) continue;

        // Keep the member with the longest name (most detailed wording)
        const best = members.reduce((a, b) => (b.name || '').length > (a.name || '').length ? b : a, members[0]);
        kept.push(best.id);

        const toRemove = members.filter(m => m.id !== best.id);
        for (const dup of toRemove) {
            // Delete from practicePointMetrics
            await metricsCol.doc(dup.id).delete();
            removed.push(dup.id);
            console.log(`[CAL-DEDUP] Removed duplicate "${dup.name}" (keeping "${best.name}")`);
        }

        // Also remove from auditableElements array on the guideline doc
        const guidelineSnap = await guidelineRef.get();
        const data = guidelineSnap.data();
        if (Array.isArray(data.auditableElements)) {
            const removedIds = new Set(toRemove.map(d => d.id));
            const filtered = data.auditableElements.filter(el => {
                const elId = generatePointId(el.name || el.title || '');
                return !removedIds.has(elId);
            });
            if (filtered.length < data.auditableElements.length) {
                await guidelineRef.update({ auditableElements: filtered });
                console.log(`[CAL-DEDUP] Removed ${data.auditableElements.length - filtered.length} duplicate auditableElements`);
            }
        }

        // Reset the kept point's graduation state so it gets a fair retry
        await metricsCol.doc(best.id).update({
            consecutiveCorrect: 0,
            graduated: false,
            graduatedAt: null,
            calibrationAttempts: 0
        });
    }

    return { removed, kept };
}

// ─── Graduation state persistence helpers ────────────────────────────────────

async function persistGraduationState(guidelineId, pointId, consec, isGraduated, attempts) {
    const ref = db.collection('guidelines').doc(guidelineId)
        .collection('practicePointMetrics').doc(pointId);
    const update = {
        consecutiveCorrect: consec,
        graduated: isGraduated,
        calibrationAttempts: attempts
    };
    if (isGraduated) update.graduatedAt = new Date().toISOString();
    await ref.update(update);
}

// ─── Calibration loop — run until every point graduates ──────────────────────

/**
 * Runs calibration repeatedly until every practice point achieves
 * `graduationThreshold` consecutive correct runs.
 *
 * Graduation state is persisted in Firestore so the loop automatically
 * resumes from the last checkpoint. Points that previously graduated are
 * skipped. When stuck points are detected, the loop auto-deduplicates,
 * auto-rewrites (splitting ambiguous points via LLM), or auto-removes
 * (if a rewritten point is still stuck) — the loop never stops due to
 * stuck points.
 *
 * @param {string} guidelineId
 * @param {string} userId
 * @param {Object} [options]
 * @param {number} [options.pointCount=0] - Limit to first N points (0 = all)
 * @param {number} [options.scenarioCount=4]
 * @param {number} [options.graduationThreshold=3] - Consecutive correct runs to graduate
 * @param {number} [options.maxAttemptsPerPoint=15] - Give up after this many attempts
 * @param {Function} [onProgress] - Called with (step, message, extra) during the loop
 * @returns {Promise<Object>} Loop summary
 */
async function runCalibrationLoop(guidelineId, userId, options = {}, onProgress = null) {
    const {
        pointCount = 0,
        scenarioCount = 4,
        graduationThreshold = 3,
        maxAttemptsPerPoint = 15
    } = options;

    const log = (step, msg, extra = null) => {
        console.log(`[CAL-LOOP:${guidelineId}] ${step}: ${msg}`);
        if (onProgress) onProgress(step, msg, extra);
    };

    // 1. Load practice points, filtered to only those matching current auditableElements
    const { title: guidelineTitle, content: guidelineContent } = await getGuidelineForCalibration(guidelineId);
    const guidelineDoc = await db.collection('guidelines').doc(guidelineId).get();
    const auditableElements = guidelineDoc.exists ? (guidelineDoc.data().auditableElements || []) : [];
    const currentIds = new Set(
        auditableElements.map(e => generatePointId(e.name || e.title || '')).filter(Boolean)
    );

    const snap = await db.collection('guidelines').doc(guidelineId).collection('practicePointMetrics').get();
    if (snap.empty) throw new Error('No practice points found — run syncPracticePoints first');

    let allPoints = snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(p => currentIds.has(p.id))  // only points matching current auditableElements
        .sort((a, b) => (a.name || '').localeCompare(b.name || ''));

    if (allPoints.length === 0) throw new Error('No practice points match current auditableElements — re-sync first');
    if (allPoints.length < snap.docs.length) {
        log('filter', `Filtered ${snap.docs.length} metric docs to ${allPoints.length} matching current auditableElements`);
    }

    if (pointCount > 0) allPoints = allPoints.slice(0, pointCount);

    // 2. Restore graduation state from Firestore
    const consecutiveCorrect = {};
    const attemptCount = {};
    const graduated = new Set();
    let alreadyGraduated = 0;

    for (const p of allPoints) {
        consecutiveCorrect[p.id] = p.consecutiveCorrect || 0;
        attemptCount[p.id] = p.calibrationAttempts || 0;
        if (p.graduated) {
            graduated.add(p.id);
            alreadyGraduated++;
        }
    }

    const totalPoints = allPoints.length;

    if (alreadyGraduated > 0) {
        log('resume', `Resuming — ${alreadyGraduated}/${totalPoints} already graduated from previous run`);
    }
    if (graduated.size >= totalPoints) {
        log('complete', `All ${totalPoints} points already graduated — nothing to do`);
        return {
            guidelineId, guidelineTitle, iterations: 0, exitReason: 'all_graduated',
            graduatedCount: totalPoints, totalPoints, graduationThreshold,
            pointStatus: Object.fromEntries(allPoints.map(p => [p.id, {
                name: p.name, consecutiveCorrect: consecutiveCorrect[p.id], attempts: attemptCount[p.id], graduated: true
            }])),
            accuracyHistory: [], finalAccuracy: null, allAdviceEvolution: [], runs: []
        };
    }

    log('init', `Starting loop — ${totalPoints - graduated.size} points remaining, graduate at ${graduationThreshold} consecutive correct`);

    const allRuns = [];
    const allAdviceEvolution = [];
    let exitReason = 'all_graduated';
    let iteration = 0;
    let deduplicatedThisRun = false;  // only auto-dedup once per loop invocation

    // Emit initial state immediately so client sees graduation table before first iteration
    const initialPointStatus = Object.fromEntries(allPoints.map(p => [p.id, {
        name: p.name,
        consecutiveCorrect: consecutiveCorrect[p.id] || 0,
        attempts: attemptCount[p.id] || 0,
        graduated: graduated.has(p.id)
    }]));
    onProgress('init_complete', `Ready to begin: ${totalPoints - graduated.size} active, ${graduated.size} already graduated`, {
        iteration: 0,
        pointStatus: initialPointStatus,
        graduatedCount: graduated.size,
        totalPoints: totalPoints
    });

    while (graduated.size < totalPoints) {
        iteration++;

        // Active = non-graduated points that still exist
        let activePoints = allPoints.filter(p => !graduated.has(p.id));

        // Check for stuck points — auto-rewrite or auto-remove instead of stopping
        const stuckPoints = activePoints.filter(p => attemptCount[p.id] >= maxAttemptsPerPoint);
        if (stuckPoints.length > 0) {
            // First try auto-deduplication if multiple stuck points
            if (!deduplicatedThisRun && stuckPoints.length >= 2) {
                log('dedup', `${stuckPoints.length} stuck points detected — checking for duplicates...`);
                const { removed, kept } = await deduplicateStuckPoints(guidelineId, stuckPoints, userId);

                if (removed.length > 0) {
                    deduplicatedThisRun = true;
                    log('dedup', `Removed ${removed.length} duplicate(s), kept ${kept.length} — retrying`);
                    const removedSet = new Set(removed);
                    allPoints = allPoints.filter(p => !removedSet.has(p.id));
                    for (const id of removed) {
                        delete consecutiveCorrect[id];
                        delete attemptCount[id];
                        graduated.delete(id);
                    }
                    for (const id of kept) {
                        attemptCount[id] = 0;
                        consecutiveCorrect[id] = 0;
                    }
                    const pointStatus = Object.fromEntries(allPoints.map(p => [p.id, {
                        name: p.name,
                        consecutiveCorrect: consecutiveCorrect[p.id] || 0,
                        attempts: attemptCount[p.id] || 0,
                        graduated: graduated.has(p.id)
                    }]));
                    log('run_complete',
                        `After dedup: ${graduated.size}/${allPoints.length} graduated, ${allPoints.length - graduated.size} remaining`,
                        { pointStatus, graduatedCount: graduated.size, totalPoints: allPoints.length }
                    );
                    continue;
                }
            }

            // Auto-rewrite or auto-remove each stuck point
            for (const stuckPoint of stuckPoints) {
                const alreadyRewritten = stuckPoint._rewritten || false;

                if (alreadyRewritten) {
                    // Already rewritten once and still stuck — auto-remove
                    log('auto_remove', `Removing "${stuckPoint.name}" — still stuck after rewrite, likely untestable`);
                    try {
                        await db.collection('guidelines').doc(guidelineId)
                            .collection('practicePointMetrics').doc(stuckPoint.id).delete();
                    } catch (err) {
                        log('auto_remove', `Failed to delete from Firestore: ${err.message}`);
                    }
                    allPoints = allPoints.filter(p => p.id !== stuckPoint.id);
                    delete consecutiveCorrect[stuckPoint.id];
                    delete attemptCount[stuckPoint.id];
                    graduated.delete(stuckPoint.id);
                    continue;
                }

                // Gather error evidence from past runs for this point
                const errorEvidence = [];
                for (const run of allRuns) {
                    if (!run.scenarios) continue;
                    for (const sr of run.scenarios) {
                        const verdict = sr.verdicts?.[stuckPoint.id];
                        if (verdict === 'miss' || verdict === 'false_positive') {
                            const shouldApply = (sr.groundTruth?.applies || []).includes(stuckPoint.id);
                            const detail = sr.pointDetail?.[stuckPoint.id];
                            errorEvidence.push({
                                verdict,
                                shouldApply,
                                modelReason: detail?.reason || '',
                                transcript: sr.transcript || sr.name || ''
                            });
                        }
                    }
                }

                if (errorEvidence.length === 0) {
                    // No error evidence available (e.g. errors happened before we started tracking) — remove
                    log('auto_remove', `Removing "${stuckPoint.name}" — stuck with no error evidence to guide rewrite`);
                    try {
                        await db.collection('guidelines').doc(guidelineId)
                            .collection('practicePointMetrics').doc(stuckPoint.id).delete();
                    } catch (err) {
                        log('auto_remove', `Failed to delete from Firestore: ${err.message}`);
                    }
                    allPoints = allPoints.filter(p => p.id !== stuckPoint.id);
                    delete consecutiveCorrect[stuckPoint.id];
                    delete attemptCount[stuckPoint.id];
                    graduated.delete(stuckPoint.id);
                    continue;
                }

                // Auto-rewrite: call LLM to split into better points
                log('auto_rewrite', `Rewriting "${stuckPoint.name}" — ${errorEvidence.length} error(s) as evidence`);
                try {
                    const rewriteResult = await rewritePracticePoint(
                        stuckPoint, errorEvidence, guidelineTitle, guidelineContent, userId
                    );
                    const replacements = rewriteResult.replacements || [];
                    log('auto_rewrite', `Rewrite produced ${replacements.length} replacement(s): ${rewriteResult.reasoning || ''}`);

                    // Delete old point from Firestore
                    await db.collection('guidelines').doc(guidelineId)
                        .collection('practicePointMetrics').doc(stuckPoint.id).delete();

                    // Remove old point from tracking
                    allPoints = allPoints.filter(p => p.id !== stuckPoint.id);
                    delete consecutiveCorrect[stuckPoint.id];
                    delete attemptCount[stuckPoint.id];
                    graduated.delete(stuckPoint.id);

                    // Create replacement points in Firestore and add to tracking
                    for (const rep of replacements) {
                        const newId = generatePointId(rep.name);
                        const newDoc = {
                            name: rep.name,
                            description: rep.description || rep.name,
                            accuracy: null,
                            evaluationCount: 0,
                            consecutiveCorrect: 0,
                            calibrationAttempts: 0,
                            graduated: false,
                            createdAt: new Date().toISOString(),
                            rewrittenFrom: stuckPoint.id
                        };
                        await db.collection('guidelines').doc(guidelineId)
                            .collection('practicePointMetrics').doc(newId).set(newDoc);

                        const newPoint = { id: newId, ...newDoc, _rewritten: true };
                        allPoints.push(newPoint);
                        consecutiveCorrect[newId] = 0;
                        attemptCount[newId] = 0;
                    }
                } catch (err) {
                    log('auto_rewrite', `Rewrite failed for "${stuckPoint.name}": ${err.message} — removing point`);
                    try {
                        await db.collection('guidelines').doc(guidelineId)
                            .collection('practicePointMetrics').doc(stuckPoint.id).delete();
                    } catch (delErr) { /* best effort */ }
                    allPoints = allPoints.filter(p => p.id !== stuckPoint.id);
                    delete consecutiveCorrect[stuckPoint.id];
                    delete attemptCount[stuckPoint.id];
                    graduated.delete(stuckPoint.id);
                }
            }

            // After processing stuck points, emit updated status and continue
            if (allPoints.length === 0) {
                exitReason = 'all_removed';
                log('complete', 'All points were removed — nothing left to calibrate');
                break;
            }
            const pointStatus = Object.fromEntries(allPoints.map(p => [p.id, {
                name: p.name,
                consecutiveCorrect: consecutiveCorrect[p.id] || 0,
                attempts: attemptCount[p.id] || 0,
                graduated: graduated.has(p.id)
            }]));
            log('run_complete',
                `After auto-remediation: ${graduated.size}/${allPoints.length} graduated, ${allPoints.length - graduated.size} remaining`,
                { pointStatus, graduatedCount: graduated.size, totalPoints: allPoints.length }
            );
            continue;
        }

        log('iteration', `Iteration ${iteration} — ${graduated.size}/${allPoints.length} graduated, ${activePoints.length} active`);

        let result;
        try {
            result = await runCalibrationRun(
                guidelineId,
                userId,
                { specificPoints: activePoints, scenarioCount },
                (step, msg) => log(step, `[iter ${iteration}] ${msg}`)
            );
        } catch (err) {
            log('error', `Iteration ${iteration} failed: ${err.message}`);
            allRuns.push({ iteration, error: err.message, overallAccuracy: null });
            // Don't burn attempt budget on billing/auth errors — abort the loop immediately
            if (/insufficient balance|quota|billing|payment|rate.?limit/i.test(err.message)) {
                throw new Error(`Calibration aborted: ${err.message}`);
            }
            for (const p of activePoints) attemptCount[p.id]++;
            continue;
        }

        allRuns.push({ ...result, iteration });

        for (const entry of (result.adviceEvolutionLog || [])) {
            allAdviceEvolution.push({ ...entry, iteration });
        }

        // Update per-point consecutive counts
        for (const p of activePoints) {
            attemptCount[p.id]++;
            const acc = (result.pointAccuracies || {})[p.id];
            if (acc === 1.0) {
                consecutiveCorrect[p.id]++;
                if (consecutiveCorrect[p.id] >= graduationThreshold) {
                    graduated.add(p.id);
                    log('graduate', `Graduated: "${p.name}" (${graduationThreshold} consecutive correct)`);
                }
            } else {
                if (consecutiveCorrect[p.id] > 0) {
                    log('reset', `Streak reset for "${p.name}" (was ${consecutiveCorrect[p.id]}) — ${acc !== null ? (acc * 100).toFixed(0) + '%' : 'n/a'}`);
                }
                consecutiveCorrect[p.id] = 0;
            }
        }

        // Emit run results IMMEDIATELY so the polling client can render
        const pointStatus = Object.fromEntries(allPoints.map(p => [p.id, {
            name: p.name,
            consecutiveCorrect: consecutiveCorrect[p.id] || 0,
            attempts: attemptCount[p.id] || 0,
            graduated: graduated.has(p.id)
        }]));

        log('run_complete',
            `${graduated.size}/${allPoints.length} graduated after iteration ${iteration}`,
            { latestRun: result, iteration, pointStatus, graduatedCount: graduated.size, totalPoints: allPoints.length }
        );

        // Persist graduation state to Firestore (non-blocking — don't let failures block the loop)
        try {
            await Promise.all(activePoints.map(p =>
                persistGraduationState(guidelineId, p.id, consecutiveCorrect[p.id], graduated.has(p.id), attemptCount[p.id])
            ));
        } catch (err) {
            log('persist_warn', `Graduation state persistence failed (will retry next iteration): ${err.message}`);
        }
    }

    if (graduated.size >= allPoints.length) {
        log('complete', `All ${allPoints.length} practice points graduated after ${iteration} iteration(s)`);
    }

    const accuracyHistory = allRuns.map(r => r.overallAccuracy).filter(a => a !== null);
    const finalAccuracy = accuracyHistory.length > 0 ? accuracyHistory[accuracyHistory.length - 1] : null;

    return {
        guidelineId,
        guidelineTitle,
        iterations: allRuns.length,
        exitReason,
        graduatedCount: graduated.size,
        totalPoints: allPoints.length,
        graduationThreshold,
        pointStatus: Object.fromEntries(allPoints.map(p => [p.id, {
            name: p.name,
            consecutiveCorrect: consecutiveCorrect[p.id] || 0,
            attempts: attemptCount[p.id] || 0,
            graduated: graduated.has(p.id)
        }])),
        accuracyHistory,
        finalAccuracy,
        allAdviceEvolution,
        runs: allRuns
    };
}

// ─── Phase 4: Context Evolution ──────────────────────────────────────────────────

/**
 * Generate a fresh clinical scenario for testing a practice point
 * Returns a unique scenario each time to avoid LLM memorization
 */
async function generateFreshScenario(practicePointText, scenarioType, userId) {
    const prompt = `You are a clinical scenario generator for testing practice point applicability. Create a UNIQUE and REALISTIC clinical note for testing this practice point.

PRACTICE POINT:
"${practicePointText}"

SCENARIO TYPE: ${scenarioType === 'A' ? 'WRONGLY APPLIED' : 'CORRECTLY APPLIED'}

Your task:
1. Generate a detailed, realistic clinical note (2-3 paragraphs) with patient details, test results, demographics, clinical context
2. Ensure uniqueness - make it completely different from any previous scenarios
3. For Scenario ${scenarioType === 'A' ? 'A' : 'B'}: the practice point should ${scenarioType === 'A' ? 'NOT apply' : 'APPLY'}
4. Include specific values, measurements, and clinical context
5. Provide brief explanation of why it ${scenarioType === 'A' ? 'incorrectly' : 'correctly'} applies (or doesn't)

Return ONLY valid JSON (no markdown, no code blocks):
{
  "clinicalNote": "Patient: [detailed note]...",
  "explanation": "This scenario ${scenarioType === 'A' ? 'wrongly' : 'correctly'} applies because..."
}`;

    try {
        const result = await routeToAI(prompt, userId);
        if (!result?.content) throw new Error('No response from LLM');

        let parsed = result.content.trim().replace(/```json\n?|\n?```/g, '');
        const scenario = JSON.parse(parsed);

        if (!scenario.clinicalNote || !scenario.explanation) {
            throw new Error('Invalid scenario structure from LLM');
        }

        return {
            success: true,
            clinicalNote: scenario.clinicalNote,
            explanation: scenario.explanation
        };
    } catch (err) {
        console.error('[CONTEXT_EVOLUTION] Error generating scenario:', err.message);
        return { success: false, error: err.message };
    }
}

/**
 * Test if a practice point applies to a clinical note using current context
 */
async function testScenarioAgainstPoint(practicePointText, clinicalNote, context, userId) {
    const contextStr = `
Triggers:
${context.triggers?.map(t => `• ${t}`).join('\n') || '(none yet)'}

Criteria:
${context.criteria || '(to be defined)'}

Exceptions:
${context.exceptions?.map(e => `• ${e}`).join('\n') || '(none defined)'}

Edge Cases:
${context.edgeCases?.map(ec => `• ${ec}`).join('\n') || '(none identified)'}
`;

    const prompt = `You are a clinical decision support system. Analyze this practice point against the provided clinical note and context.

PRACTICE POINT:
"${practicePointText}"

CONTEXT (Version ${context.version || 1}):
${contextStr}

CLINICAL NOTE:
${clinicalNote}

TASK:
1. Determine if this practice point applies to this patient
2. Answer: "Applicable" or "Not applicable"
3. Provide detailed reasoning that references the context provided
4. Cite specific triggers, criteria, exceptions, or edge cases

Return ONLY valid JSON (no markdown):
{
  "applicable": true/false,
  "answer": "Applicable" or "Not applicable",
  "reasoning": "Detailed explanation referencing context...",
  "citedTriggers": ["trigger 1"],
  "citedCriteria": "the criteria text",
  "citedExceptions": ["exception 1"],
  "citedEdgeCases": ["edge case"],
  "confidence": 0.95
}`;

    try {
        const result = await routeToAI(prompt, userId);
        if (!result?.content) throw new Error('No response from LLM');

        let parsed = result.content.trim().replace(/```json\n?|\n?```/g, '');
        const analysis = JSON.parse(parsed);

        return {
            success: true,
            llmResponse: analysis.reasoning,
            applicable: analysis.applicable,
            answer: analysis.answer,
            reasoning: analysis.reasoning,
            citedTriggers: analysis.citedTriggers || [],
            citedCriteria: analysis.citedCriteria || '',
            citedExceptions: analysis.citedExceptions || [],
            citedEdgeCases: analysis.citedEdgeCases || [],
            confidence: analysis.confidence || 0.5
        };
    } catch (err) {
        console.error('[CONTEXT_EVOLUTION] Error testing scenario:', err.message);
        return { success: false, error: err.message };
    }
}

/**
 * Analyze test result and determine if it's correct
 */
function analyzeTestResult(expectedApplicable, llmApplicable, contextUsage) {
    const isCorrect = expectedApplicable === llmApplicable;

    let resultType;
    if (expectedApplicable === true && llmApplicable === true) resultType = 'TP';
    else if (expectedApplicable === false && llmApplicable === false) resultType = 'TN';
    else if (expectedApplicable === false && llmApplicable === true) resultType = 'FP';
    else resultType = 'FN';

    let reasoningQuality = 'Poor';
    if (contextUsage.citedTriggers.length > 0 || contextUsage.citedCriteria) {
        reasoningQuality = 'Good';
        if (contextUsage.citedTriggers.length > 1 && contextUsage.citedExceptions.length > 0) {
            reasoningQuality = 'Excellent';
        }
    }

    return {
        isCorrect,
        resultType,
        reasoningQuality,
        usedContextCorrectly: contextUsage.citedTriggers.length > 0 || contextUsage.citedCriteria
    };
}

/**
 * Generate context refinement suggestions based on failed test
 */
async function refinePointContext(practicePointText, clinicalNote, failureType, llmReasoning, currentContext, userId) {
    const failureExplanation = failureType === 'FP'
        ? 'The LLM incorrectly marked the point as applicable when it should NOT apply'
        : 'The LLM incorrectly marked the point as NOT applicable when it SHOULD apply';

    const prompt = `You are a clinical guideline refinement expert. Analyze why a practice point's context was inadequate.

PRACTICE POINT:
"${practicePointText}"

CLINICAL NOTE WHERE IT FAILED:
${clinicalNote}

FAILURE TYPE: ${failureExplanation}

LLM'S REASONING:
${llmReasoning}

CURRENT CONTEXT:
Triggers: ${currentContext.triggers?.join(', ') || '(none)'}
Criteria: ${currentContext.criteria || '(none)'}
Exceptions: ${currentContext.exceptions?.join(', ') || '(none)'}
Edge Cases: ${currentContext.edgeCases?.join(', ') || '(none)'}

TASK:
Suggest specific improvements to prevent this error in future testing.

Return ONLY valid JSON:
{
  "suggestedChanges": [
    {
      "field": "triggers" or "criteria" or "exceptions" or "edgeCases",
      "action": "add" or "modify" or "clarify",
      "suggested": "The new text or item",
      "reason": "Why this prevents the error"
    }
  ],
  "summary": "Brief summary of changes needed"
}`;

    try {
        const result = await routeToAI(prompt, userId);
        if (!result?.content) throw new Error('No response from LLM');

        let parsed = result.content.trim().replace(/```json\n?|\n?```/g, '');
        const refinement = JSON.parse(parsed);

        return {
            success: true,
            suggestedChanges: refinement.suggestedChanges || [],
            summary: refinement.summary || ''
        };
    } catch (err) {
        console.error('[CONTEXT_EVOLUTION] Error refining context:', err.message);
        return { success: false, error: err.message };
    }
}

module.exports = {
    generatePointId,
    syncPracticePoints,
    samplePracticePoints,
    updatePointAccuracy,
    getGuidelineForCalibration,
    generateCalibrationScenarios,
    evaluateScenarioVerdicts,
    runCalibrationRun,
    runCalibrationLoop,
    generateFreshScenario,
    testScenarioAgainstPoint,
    analyzeTestResult,
    refinePointContext
};
