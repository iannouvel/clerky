// Variation engine for generating systematic scenario variations for audit testing
// Creates subtle variations to test guidance changes based on input parameter modifications

/**
 * Generates systematic scenario variations for an auditable element
 * @param {Object} element - Auditable element with input variables and thresholds
 * @param {Object} baseScenario - Base clinical scenario transcript
 * @param {Object} options - Generation options
 * @returns {Promise<Array>} - Array of scenario variations
 */
export async function generateScenarioVariations(element, baseScenario, options = {}) {
    const {
        includeBaseline = true,
        includeThresholdVariations = true,
        includeOmissions = true,
        includeEdgeCases = true,
        maxVariations = 10
    } = options;

    const variations = [];

    // 1. Baseline scenario (if requested)
    if (includeBaseline) {
        variations.push({
            variationId: `${element.elementId || 'element'}-baseline`,
            type: 'baseline',
            description: 'Standard case where guidance should apply',
            scenario: baseScenario,
            expectedGuidance: element.derivedAdvice || element.expectedGuidance,
            modifiedParameters: {},
            expectedChange: 'none'
        });
    }

    // 2. Threshold variations
    if (includeThresholdVariations && element.thresholds && element.thresholds.length > 0) {
        for (const threshold of element.thresholds) {
            // Just below threshold
            variations.push({
                variationId: `${element.elementId || 'element'}-threshold-below-${threshold.variable}`,
                type: 'threshold_variation',
                threshold: threshold,
                description: `Scenario with ${threshold.variable} just below threshold (${threshold.thresholdValue})`,
                scenario: modifyScenarioParameter(baseScenario, threshold.variable, getValueBelowThreshold(threshold)),
                expectedGuidance: getGuidanceForThreshold(element, threshold, 'below'),
                modifiedParameters: {
                    [threshold.variable]: getValueBelowThreshold(threshold)
                },
                expectedChange: 'different_guidance_below_threshold'
            });

            // Just above threshold
            variations.push({
                variationId: `${element.elementId || 'element'}-threshold-above-${threshold.variable}`,
                type: 'threshold_variation',
                threshold: threshold,
                description: `Scenario with ${threshold.variable} just above threshold (${threshold.thresholdValue})`,
                scenario: modifyScenarioParameter(baseScenario, threshold.variable, getValueAboveThreshold(threshold)),
                expectedGuidance: getGuidanceForThreshold(element, threshold, 'above'),
                modifiedParameters: {
                    [threshold.variable]: getValueAboveThreshold(threshold)
                },
                expectedChange: 'different_guidance_above_threshold'
            });
        }
    }

    // 3. Variable omissions
    if (includeOmissions && element.inputVariables && element.inputVariables.length > 0) {
        for (const inputVar of element.inputVariables) {
            if (inputVar.required) {
                variations.push({
                    variationId: `${element.elementId || 'element'}-omit-${inputVar.name}`,
                    type: 'variable_omission',
                    omittedVariable: inputVar.name,
                    description: `Scenario missing required variable: ${inputVar.name}`,
                    scenario: removeScenarioParameter(baseScenario, inputVar.name),
                    expectedGuidance: 'Should flag missing information or request clarification',
                    modifiedParameters: {
                        [inputVar.name]: 'omitted'
                    },
                    expectedChange: 'missing_information_detected'
                });
            }
        }
    }

    // 4. Edge cases
    if (includeEdgeCases) {
        variations.push(...generateEdgeCaseVariations(element, baseScenario));
    }

    // Limit to maxVariations
    return variations.slice(0, maxVariations);
}

/**
 * Generates edge case variations
 */
function generateEdgeCaseVariations(element, baseScenario) {
    const edgeCases = [];

    // Boundary conditions
    if (element.inputVariables) {
        for (const inputVar of element.inputVariables) {
            // Minimum value
            if (inputVar.type === 'numeric' && inputVar.threshold) {
                edgeCases.push({
                    variationId: `${element.elementId || 'element'}-edge-min-${inputVar.name}`,
                    type: 'edge_case',
                    edgeType: 'minimum_value',
                    description: `Minimum value for ${inputVar.name}`,
                    scenario: modifyScenarioParameter(baseScenario, inputVar.name, getMinimumValue(inputVar)),
                    expectedGuidance: element.derivedAdvice,
                    modifiedParameters: {
                        [inputVar.name]: getMinimumValue(inputVar)
                    },
                    expectedChange: 'boundary_condition'
                });
            }

            // Maximum realistic value
            if (inputVar.type === 'numeric') {
                edgeCases.push({
                    variationId: `${element.elementId || 'element'}-edge-max-${inputVar.name}`,
                    type: 'edge_case',
                    edgeType: 'maximum_value',
                    description: `Maximum realistic value for ${inputVar.name}`,
                    scenario: modifyScenarioParameter(baseScenario, inputVar.name, getMaximumValue(inputVar)),
                    expectedGuidance: element.derivedAdvice,
                    modifiedParameters: {
                        [inputVar.name]: getMaximumValue(inputVar)
                    },
                    expectedChange: 'boundary_condition'
                });
            }
        }
    }

    return edgeCases;
}

/**
 * Modifies a scenario parameter value
 */
function modifyScenarioParameter(scenario, parameterName, newValue) {
    // This is a simplified implementation - in practice, you'd use NLP/AI to intelligently modify
    // For now, return scenario with modification annotation
    return {
        ...scenario,
        modifications: {
            ...(scenario.modifications || {}),
            [parameterName]: newValue
        },
        modifiedText: scenario.text ? injectParameterModification(scenario.text, parameterName, newValue) : scenario.text
    };
}

/**
 * Removes a parameter from scenario
 */
function removeScenarioParameter(scenario, parameterName) {
    return {
        ...scenario,
        modifications: {
            ...(scenario.modifications || {}),
            [parameterName]: 'omitted'
        },
        omittedVariables: [...(scenario.omittedVariables || []), parameterName]
    };
}

/**
 * Injects parameter modification into text (simplified - AI would do better)
 */
function injectParameterModification(text, parameterName, newValue) {
    // Simple replacement - in practice, use AI to intelligently modify clinical text
    const patterns = {
        'gestational_age': /(\d{1,2}\+\d{1,2}\s*weeks?)/gi,
        'blood_pressure': /(\d{2,3}\/\d{2,3}\s*mmHg)/gi,
        'temperature': /(\d{2,3}\.?\d?\s*°C)/gi
    };
    
    // This is a placeholder - real implementation would use AI
    return text;
}

/**
 * Gets value just below threshold
 */
function getValueBelowThreshold(threshold) {
    // Parse threshold value and return slightly below
    const value = parseThresholdValue(threshold.thresholdValue);
    if (typeof value === 'number') {
        return value - 0.1; // Small decrement
    }
    return threshold.thresholdValue; // Fallback
}

/**
 * Gets value just above threshold
 */
function getValueAboveThreshold(threshold) {
    const value = parseThresholdValue(threshold.thresholdValue);
    if (typeof value === 'number') {
        return value + 0.1; // Small increment
    }
    return threshold.thresholdValue; // Fallback
}

/**
 * Parses threshold value to numeric if possible
 */
function parseThresholdValue(thresholdValue) {
    // Try to extract numeric value (e.g., "26+0 weeks" -> 26)
    const match = thresholdValue.match(/(\d+(?:\.\d+)?)/);
    return match ? parseFloat(match[1]) : thresholdValue;
}

/**
 * Gets guidance for threshold position
 */
function getGuidanceForThreshold(element, threshold, position) {
    const variationPoint = element.variationPoints?.find(vp => vp.parameter === threshold.variable);
    if (variationPoint) {
        if (position === 'below') return variationPoint.belowThreshold || element.derivedAdvice;
        if (position === 'above') return variationPoint.aboveThreshold || element.derivedAdvice;
    }
    return element.derivedAdvice;
}

/**
 * Gets minimum value for numeric variable
 */
function getMinimumValue(inputVar) {
    if (inputVar.type === 'numeric') {
        const threshold = parseThresholdValue(inputVar.threshold || '0');
        return Math.max(0, threshold - 10); // Reasonable minimum
    }
    return null;
}

/**
 * Gets maximum realistic value for numeric variable
 */
function getMaximumValue(inputVar) {
    if (inputVar.type === 'numeric') {
        const threshold = parseThresholdValue(inputVar.threshold || '40');
        return threshold + 20; // Reasonable maximum
    }
    return null;
}

/**
 * Creates a variation description for AI scenario generation
 */
export function createVariationPrompt(element, variation) {
    return `Generate a clinical scenario transcript that satisfies this variation:

AUDITABLE ELEMENT: ${element.name}
TYPE: ${variation.type}
DESCRIPTION: ${variation.description}
MODIFIED PARAMETERS: ${JSON.stringify(variation.modifiedParameters)}
BASE SCENARIO CONTEXT: ${JSON.stringify(variation.scenario)}

The scenario should be clinically realistic and test whether Clerky provides the appropriate guidance for this variation.`;
}

