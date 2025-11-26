// Systematic scenario variation generation engine for audit testing
// Generates baseline + threshold + omission + edge case scenarios for each element

import { generateScenarioVariations, createVariationPrompt } from './variation-engine.js';

/**
 * Generates comprehensive audit scenarios for an auditable element
 * @param {Object} element - Auditable element with full metadata
 * @param {Object} guidelineContent - Guideline content for context
 * @param {Object} options - Generation options
 * @returns {Promise<Object>} - Generated scenarios with metadata
 */
export async function generateAuditScenarios(element, guidelineContent, options = {}) {
    const {
        includeBaseline = true,
        includeThresholdVariations = true,
        includeOmissions = true,
        includeEdgeCases = true,
        maxVariations = 10,
        aiProvider = 'DeepSeek'
    } = options;

    console.log(`[SCENARIO-GEN] Generating scenarios for element: ${element.name || element.elementId}`);

    // Step 1: Generate base scenario using AI
    const baseScenario = await generateBaseScenario(element, guidelineContent, aiProvider);

    // Step 2: Generate systematic variations
    const variations = await generateScenarioVariations(element, baseScenario, {
        includeBaseline,
        includeThresholdVariations,
        includeOmissions,
        includeEdgeCases,
        maxVariations
    });

    // Step 3: Generate actual scenario transcripts for each variation using AI
    const scenariosWithTranscripts = await Promise.all(
        variations.map(async (variation) => {
            const transcript = await generateVariationTranscript(element, variation, guidelineContent, aiProvider);
            return {
                ...variation,
                transcript: transcript,
                generatedAt: new Date().toISOString()
            };
        })
    );

    return {
        elementId: element.elementId || element.name,
        elementName: element.name,
        baseScenario: baseScenario,
        scenarios: scenariosWithTranscripts,
        totalScenarios: scenariosWithTranscripts.length,
        generatedAt: new Date().toISOString()
    };
}

/**
 * Generates base scenario transcript for an element
 */
async function generateBaseScenario(element, guidelineContent, aiProvider) {
    const prompt = `You are a clinical scenario generator for audit testing. Generate a realistic clinical transcript that would trigger this auditable element.

AUDITABLE ELEMENT:
- Name: ${element.name}
- Type: ${element.type}
- Significance: ${element.significance}
- Input Variables: ${JSON.stringify(element.inputVariables || [])}
- Derived Advice: ${element.derivedAdvice}
- Expected Guidance: ${element.expectedGuidance || element.derivedAdvice}

GUIDELINE CONTEXT:
${guidelineContent.substring(0, 5000)}

REQUIREMENTS:
1. Create a realistic clinical scenario transcript
2. Include ALL input variables mentioned in the element
3. Ensure the scenario would trigger the derived advice
4. Use proper medical terminology and British abbreviations
5. Follow SBAR format (Situation, Background, Assessment, Recommendation)
6. Make it clinically authentic with realistic patient demographics
7. Include relevant clinical observations and measurements

FORMAT:
SITUATION: [Demographics, presentation, key clinical issue]
BACKGROUND: [Relevant history, previous episodes, risk factors, medications]
ASSESSMENT: [Clinical findings, vital signs, test results, differential diagnosis]
RECOMMENDATION: [Management plan, monitoring, follow-up, further investigations]

Generate a comprehensive clinical transcript that would test this auditable element.`;

    // Import routeToAI function (would need to be available)
    // For now, return structure - actual AI call would be in server.js
    return {
        elementId: element.elementId,
        prompt: prompt,
        needsAIGeneration: true
    };
}

/**
 * Generates scenario transcript for a variation
 */
async function generateVariationTranscript(element, variation, guidelineContent, aiProvider) {
    const variationPrompt = createVariationPrompt(element, variation);
    
    const fullPrompt = `You are a clinical scenario generator for audit testing. Generate a realistic clinical transcript that tests a specific variation of an auditable element.

${variationPrompt}

GUIDELINE CONTEXT:
${guidelineContent.substring(0, 3000)}

REQUIREMENTS:
1. Create a realistic clinical scenario that matches the variation description
2. Modify ONLY the specified parameters, keep everything else the same
3. Make the modification subtle but clear
4. Use proper medical terminology and British abbreviations
5. Follow SBAR format
6. Ensure clinical realism is maintained

Generate the modified clinical transcript for this variation.`;

    return {
        variationId: variation.variationId,
        prompt: fullPrompt,
        needsAIGeneration: true
    };
}

/**
 * Generates scenarios for multiple elements (batch processing)
 */
export async function generateScenariosForElements(elements, guidelineContent, options = {}) {
    const results = [];
    
    for (const element of elements) {
        try {
            const scenarios = await generateAuditScenarios(element, guidelineContent, options);
            results.push({
                elementId: element.elementId || element.name,
                success: true,
                scenarios: scenarios
            });
        } catch (error) {
            console.error(`[SCENARIO-GEN] Error generating scenarios for element ${element.elementId}:`, error);
            results.push({
                elementId: element.elementId || element.name,
                success: false,
                error: error.message
            });
        }
    }
    
    return {
        totalElements: elements.length,
        successful: results.filter(r => r.success).length,
        failed: results.filter(r => !r.success).length,
        results: results
    };
}

/**
 * Validates generated scenario against element requirements
 */
export function validateScenario(scenario, element) {
    const validation = {
        isValid: true,
        errors: [],
        warnings: []
    };

    // Check if all required input variables are present
    if (element.inputVariables) {
        const requiredVars = element.inputVariables.filter(v => v.required);
        for (const reqVar of requiredVars) {
            if (!scenario.modifications || !scenario.modifications[reqVar.name]) {
                if (scenario.omittedVariables && !scenario.omittedVariables.includes(reqVar.name)) {
                    validation.errors.push(`Required variable ${reqVar.name} is missing`);
                    validation.isValid = false;
                }
            }
        }
    }

    // Check if thresholds are respected (for threshold variations)
    if (scenario.type === 'threshold_variation' && scenario.threshold) {
        const paramValue = scenario.modifications?.[scenario.threshold.variable];
        if (paramValue !== undefined) {
            // Validate threshold logic
            // This would need more sophisticated validation
        }
    }

    return validation;
}

