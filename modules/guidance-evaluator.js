// Multi-dimensional guidance evaluation system
// Assesses guidance on: accuracy, contextual appropriateness, completeness, precision

/**
 * Evaluates guidance across multiple dimensions
 * @param {Object} evaluationData - Evaluation context
 * @param {string} evaluationData.guidance - The guidance provided by Clerky
 * @param {Object} evaluationData.expectedGuidance - Expected guidance from auditable element
 * @param {Object} evaluationData.scenario - Clinical scenario context
 * @param {Object} evaluationData.element - Auditable element being tested
 * @returns {Promise<Object>} - Multi-dimensional evaluation results
 */
export async function evaluateGuidance(evaluationData) {
    const {
        guidance,
        expectedGuidance,
        scenario,
        element,
        aiProvider = 'DeepSeek'
    } = evaluationData;

    console.log(`[GUIDANCE-EVAL] Evaluating guidance for element: ${element.elementId || element.name}`);

    // Perform multi-dimensional evaluation
    const evaluation = {
        elementId: element.elementId || element.name,
        scenarioId: scenario.variationId || scenario.id,
        timestamp: new Date().toISOString(),
        
        // Dimension scores (0-100)
        accuracyScore: 0,
        contextualScore: 0,
        completenessScore: 0,
        precisionScore: 0,
        
        // Overall score (weighted)
        overallScore: 0,
        
        // Detailed analysis
        accuracyAnalysis: {},
        contextualAnalysis: {},
        completenessAnalysis: {},
        precisionAnalysis: {},
        
        // Issues and recommendations
        issues: [],
        recommendations: [],
        
        // Strengths
        strengths: []
    };

    // 1. Accuracy Evaluation
    evaluation.accuracyAnalysis = await evaluateAccuracy({
        guidance,
        expectedGuidance,
        element,
        scenario
    });
    evaluation.accuracyScore = evaluation.accuracyAnalysis.score;
    evaluation.issues.push(...(evaluation.accuracyAnalysis.issues || []));
    evaluation.strengths.push(...(evaluation.accuracyAnalysis.strengths || []));

    // 2. Contextual Appropriateness Evaluation
    evaluation.contextualAnalysis = await evaluateContextualAppropriateness({
        guidance,
        scenario,
        element
    });
    evaluation.contextualScore = evaluation.contextualAnalysis.score;
    evaluation.issues.push(...(evaluation.contextualAnalysis.issues || []));
    evaluation.strengths.push(...(evaluation.contextualAnalysis.strengths || []));

    // 3. Completeness Evaluation
    evaluation.completenessAnalysis = await evaluateCompleteness({
        guidance,
        expectedGuidance,
        element
    });
    evaluation.completenessScore = evaluation.completenessAnalysis.score;
    evaluation.issues.push(...(evaluation.completenessAnalysis.issues || []));
    evaluation.recommendations.push(...(evaluation.completenessAnalysis.missingElements || []));

    // 4. Precision Evaluation
    evaluation.precisionAnalysis = await evaluatePrecision({
        guidance,
        scenario,
        element,
        expectedChange: scenario.expectedChange
    });
    evaluation.precisionScore = evaluation.precisionAnalysis.score;
    evaluation.issues.push(...(evaluation.precisionAnalysis.issues || []));

    // Calculate overall weighted score
    evaluation.overallScore = calculateOverallScore(evaluation);

    // Generate summary recommendations
    evaluation.recommendations = generateRecommendations(evaluation);

    return evaluation;
}

/**
 * Evaluates accuracy dimension
 */
async function evaluateAccuracy({ guidance, expectedGuidance, element, scenario }) {
    const analysis = {
        score: 0,
        issues: [],
        strengths: [],
        matches: [],
        mismatches: []
    };

    // Use AI to compare guidance with expected guidance
    const prompt = `You are evaluating the accuracy of clinical guidance. Compare the provided guidance with the expected guidance for this auditable element.

AUDITABLE ELEMENT:
${JSON.stringify({
    name: element.name,
    derivedAdvice: element.derivedAdvice,
    expectedGuidance: expectedGuidance
}, null, 2)}

PROVIDED GUIDANCE:
${guidance}

EVALUATION CRITERIA:
1. Does the guidance match the expected advice?
2. Are thresholds correctly applied?
3. Is the guidance clinically appropriate?
4. Are there any errors or contradictions?

Return a JSON object with:
{
  "score": 0-100,
  "matches": ["what matches"],
  "mismatches": ["what doesn't match"],
  "issues": ["specific issues"],
  "strengths": ["what's good"]
}`;

    // This would call AI - for now return structure
    // In server.js, this would use routeToAI
    analysis.needsAIEvaluation = true;
    analysis.prompt = prompt;

    return analysis;
}

/**
 * Evaluates contextual appropriateness dimension
 */
async function evaluateContextualAppropriateness({ guidance, scenario, element }) {
    const analysis = {
        score: 0,
        issues: [],
        strengths: [],
        patientFactors: [],
        missingConsiderations: []
    };

    const prompt = `Evaluate whether the clinical guidance is contextually appropriate for this specific scenario.

SCENARIO CONTEXT:
${JSON.stringify(scenario, null, 2)}

PROVIDED GUIDANCE:
${guidance}

CLINICAL ELEMENT:
${JSON.stringify({
    name: element.name,
    clinicalContext: element.clinicalContext
}, null, 2)}

EVALUATION CRITERIA:
1. Does guidance account for all relevant patient factors?
2. Is guidance tailored to the specific scenario?
3. Are contraindications and precautions mentioned?
4. Is the guidance appropriate for the clinical context?

Return a JSON object with evaluation results.`;

    analysis.needsAIEvaluation = true;
    analysis.prompt = prompt;

    return analysis;
}

/**
 * Evaluates completeness dimension
 */
async function evaluateCompleteness({ guidance, expectedGuidance, element }) {
    const analysis = {
        score: 0,
        issues: [],
        missingElements: [],
        presentElements: []
    };

    // Check if all required elements of advice are provided
    if (expectedGuidance) {
        // Use AI to identify missing elements
        const prompt = `Evaluate the completeness of clinical guidance. Check if all required elements are present.

EXPECTED GUIDANCE ELEMENTS:
${expectedGuidance}

PROVIDED GUIDANCE:
${guidance}

AUDITABLE ELEMENT REQUIREMENTS:
${JSON.stringify({
    inputVariables: element.inputVariables,
    derivedAdvice: element.derivedAdvice
}, null, 2)}

Return a JSON object identifying missing elements and present elements.`;

        analysis.needsAIEvaluation = true;
        analysis.prompt = prompt;
    }

    return analysis;
}

/**
 * Evaluates precision dimension
 */
async function evaluatePrecision({ guidance, scenario, element, expectedChange }) {
    const analysis = {
        score: 0,
        issues: [],
        precisionLevel: 'low|medium|high',
        specificityIssues: []
    };

    // Check if subtle scenario change produced appropriate guidance change
    const prompt = `Evaluate the precision of clinical guidance. Assess whether the guidance appropriately reflects subtle scenario changes.

SCENARIO VARIATION:
${JSON.stringify({
    type: scenario.type,
    expectedChange: expectedChange,
    modifiedParameters: scenario.modifiedParameters
}, null, 2)}

PROVIDED GUIDANCE:
${guidance}

EVALUATION CRITERIA:
1. Does subtle scenario change produce appropriate guidance change?
2. Is guidance sufficiently specific?
3. Are vague generalisations avoided?
4. Does guidance match the expected change type?

Return a JSON object with precision evaluation.`;

    analysis.needsAIEvaluation = true;
    analysis.prompt = prompt;

    return analysis;
}

/**
 * Calculates overall weighted score
 */
function calculateOverallScore(evaluation) {
    // Weighted combination based on plan specifications:
    // Accuracy: 40%, Contextual: 35%, Completeness: 25%, Precision: (bonus/adjustment)
    const weights = {
        accuracy: 0.40,
        contextual: 0.35,
        completeness: 0.25
    };

    let weightedScore = 
        (evaluation.accuracyScore * weights.accuracy) +
        (evaluation.contextualScore * weights.contextual) +
        (evaluation.completenessScore * weights.completeness);

    // Precision can adjust the score ±10%
    const precisionAdjustment = (evaluation.precisionScore - 50) / 500; // -0.1 to +0.1
    weightedScore = weightedScore * (1 + precisionAdjustment);

    return Math.round(Math.max(0, Math.min(100, weightedScore)));
}

/**
 * Generates actionable recommendations from evaluation
 */
function generateRecommendations(evaluation) {
    const recommendations = [];

    if (evaluation.accuracyScore < 70) {
        recommendations.push('Review guidance accuracy - significant mismatches with expected advice');
    }

    if (evaluation.contextualScore < 70) {
        recommendations.push('Improve contextual awareness - guidance should better account for patient factors');
    }

    if (evaluation.completenessScore < 70) {
        recommendations.push('Enhance completeness - missing required elements of advice');
        recommendations.push(...(evaluation.completenessAnalysis.missingElements || []));
    }

    if (evaluation.precisionScore < 70) {
        recommendations.push('Increase precision - guidance should be more specific and reflect scenario variations');
    }

    if (evaluation.overallScore < 75) {
        recommendations.push('Overall guidance quality needs improvement - multiple dimensions below threshold');
    }

    return recommendations;
}

/**
 * Batch evaluates multiple guidance instances
 */
export async function batchEvaluateGuidance(evaluations) {
    const results = [];
    
    for (const evalData of evaluations) {
        try {
            const evaluation = await evaluateGuidance(evalData);
            results.push({
                ...evaluation,
                success: true
            });
        } catch (error) {
            results.push({
                elementId: evalData.element?.elementId,
                scenarioId: evalData.scenario?.variationId,
                success: false,
                error: error.message
            });
        }
    }
    
    return {
        totalEvaluations: evaluations.length,
        successful: results.filter(r => r.success).length,
        failed: results.filter(r => !r.success).length,
        results: results,
        averageScore: results.filter(r => r.success).reduce((sum, r) => sum + (r.overallScore || 0), 0) / results.filter(r => r.success).length
    };
}

