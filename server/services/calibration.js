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
            }, userId, 'gemini-2.0-flash', 2000);

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
    }, userId, 'gemini-2.0-flash', 8000);

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
    }, userId, 'gemini-2.0-flash', 8000);

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

// ─── Calibration loop — run until every point graduates ──────────────────────

/**
 * Runs calibration repeatedly until every practice point achieves
 * `graduationThreshold` consecutive correct runs.
 *
 * Each iteration tests only the non-graduated points. A point graduates once
 * it scores 100% (all scenarios correct) in `graduationThreshold` consecutive
 * iterations. If a point fails to graduate after `maxAttemptsPerPoint`
 * iterations it is flagged as stuck and the loop exits.
 *
 * After each iteration the progress callback receives the latest run result
 * and per-point graduation status so clients can render incrementally.
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

    // 1. Load all practice points
    const { title: guidelineTitle } = await getGuidelineForCalibration(guidelineId);
    const snap = await db.collection('guidelines').doc(guidelineId).collection('practicePointMetrics').get();
    if (snap.empty) throw new Error('No practice points found — run syncPracticePoints first');

    let allPoints = snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (a.name || '').localeCompare(b.name || ''));

    if (pointCount > 0) allPoints = allPoints.slice(0, pointCount);
    const totalPoints = allPoints.length;

    log('init', `Starting loop — ${totalPoints} points, graduate at ${graduationThreshold} consecutive correct`);

    // Per-point state
    const consecutiveCorrect = Object.fromEntries(allPoints.map(p => [p.id, 0]));
    const attemptCount    = Object.fromEntries(allPoints.map(p => [p.id, 0]));
    const graduated       = new Set();
    const allRuns         = [];
    const allAdviceEvolution = [];
    let exitReason = 'all_graduated';
    let iteration = 0;

    while (graduated.size < totalPoints) {
        iteration++;

        // Active = non-graduated points
        const activePoints = allPoints.filter(p => !graduated.has(p.id));

        // Abort if any active point has exhausted its attempts
        const stuckPoints = activePoints.filter(p => attemptCount[p.id] >= maxAttemptsPerPoint);
        if (stuckPoints.length > 0) {
            exitReason = 'stuck_points';
            log('timeout', `Stopping — stuck point(s): ${stuckPoints.map(p => p.name).join(', ')}`);
            break;
        }

        log('iteration', `Iteration ${iteration} — ${graduated.size}/${totalPoints} graduated, ${activePoints.length} active`);

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
            // increment attempts so we don't spin forever on a broken point
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

        // Build point status snapshot for the polling client
        const pointStatus = Object.fromEntries(allPoints.map(p => [p.id, {
            name: p.name,
            consecutiveCorrect: consecutiveCorrect[p.id] || 0,
            attempts: attemptCount[p.id] || 0,
            graduated: graduated.has(p.id)
        }]));

        log('run_complete',
            `${graduated.size}/${totalPoints} graduated after iteration ${iteration}`,
            { latestRun: result, iteration, pointStatus, graduatedCount: graduated.size, totalPoints }
        );
    }

    if (graduated.size >= totalPoints) {
        log('complete', `All ${totalPoints} practice points graduated after ${iteration} iteration(s)`);
    }

    const accuracyHistory = allRuns.map(r => r.overallAccuracy).filter(a => a !== null);
    const finalAccuracy = accuracyHistory.length > 0 ? accuracyHistory[accuracyHistory.length - 1] : null;

    return {
        guidelineId,
        guidelineTitle,
        iterations: allRuns.length,
        exitReason,
        graduatedCount: graduated.size,
        totalPoints,
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

module.exports = {
    generatePointId,
    syncPracticePoints,
    samplePracticePoints,
    updatePointAccuracy,
    getGuidelineForCalibration,
    generateCalibrationScenarios,
    evaluateScenarioVerdicts,
    runCalibrationRun,
    runCalibrationLoop
};
