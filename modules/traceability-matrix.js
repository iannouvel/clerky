// Traceability matrix system for ISO 13485 compliance
// Maps guidelines → elements → scenarios → interactions → results

import { getTraceabilityChain } from './audit-storage.js';

/**
 * Generates complete traceability matrix for a guideline
 * @param {string} guidelineId - Guideline ID
 * @returns {Promise<Object>} - Complete traceability matrix
 */
export async function generateTraceabilityMatrix(guidelineId) {
    console.log(`[TRACEABILITY] Generating traceability matrix for guideline: ${guidelineId}`);

    // Get traceability chain
    const chain = await getTraceabilityChain(guidelineId);

    // Build matrix structure
    const matrix = {
        guidelineId,
        generatedAt: new Date().toISOString(),
        
        // Level 1: Guideline → Elements
        elements: chain.elements.map(element => ({
            elementId: element.elementId,
            elementName: element.name || element.elementId,
            traceability: {
                guidelineId,
                elementId: element.elementId
            }
        })),
        
        // Level 2: Elements → Test Scenarios
        testScenarios: [],
        
        // Level 3: Scenarios → Interactions
        interactions: [],
        
        // Level 4: Interactions → Results
        results: [],
        
        // Summary
        summary: {
            totalElements: chain.elements.length,
            totalTests: chain.tests.length,
            totalScenarios: chain.scenarios.length,
            totalInteractions: chain.interactions.length,
            totalResults: chain.results.length,
            traceabilityComplete: chain.traceabilityComplete
        }
    };

    // Build test scenarios mapping
    for (const test of chain.tests) {
        if (test.scenarios) {
            for (const scenario of test.scenarios) {
                matrix.testScenarios.push({
                    scenarioId: scenario.variationId || scenario.id,
                    elementId: test.elementId,
                    testId: test.id,
                    scenarioType: scenario.type,
                    traceability: {
                        guidelineId,
                        elementId: test.elementId,
                        testId: test.id,
                        scenarioId: scenario.variationId
                    }
                });
            }
        }
    }

    // Build interactions mapping
    for (const interaction of chain.interactions) {
        const scenario = chain.scenarios.find(s => s.id === interaction.scenarioId || s.variationId === interaction.scenarioId);
        const test = chain.tests.find(t => t.id === interaction.testId);
        
        matrix.interactions.push({
            interactionId: interaction.interactionId || interaction.id,
            testId: interaction.testId,
            scenarioId: scenario?.variationId || interaction.scenarioId,
            elementId: test?.elementId || interaction.elementId,
            timestamp: interaction.timestamp,
            traceability: {
                guidelineId,
                elementId: test?.elementId,
                testId: interaction.testId,
                scenarioId: scenario?.variationId,
                interactionId: interaction.interactionId || interaction.id
            }
        });
    }

    // Build results mapping
    for (const result of chain.results) {
        const interaction = chain.interactions.find(i => i.id === result.interactionId || i.interactionId === result.interactionId);
        const test = chain.tests.find(t => t.id === result.testId);
        
        matrix.results.push({
            resultId: result.resultId || result.id,
            testId: result.testId,
            interactionId: result.interactionId,
            elementId: test?.elementId || result.elementId,
            overallScore: result.overallScore,
            traceability: {
                guidelineId,
                elementId: test?.elementId,
                testId: result.testId,
                interactionId: result.interactionId,
                resultId: result.resultId || result.id
            }
        });
    }

    // Store matrix in Firestore
    await storeTraceabilityMatrix(matrix);

    return matrix;
}

/**
 * Stores traceability matrix in Firestore
 */
async function storeTraceabilityMatrix(matrix) {
    const admin = await import('firebase-admin');
    const db = admin.firestore();

    await db.collection('traceabilityMatrix').doc(matrix.guidelineId).set({
        ...matrix,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    console.log(`[TRACEABILITY] Stored traceability matrix for guideline: ${matrix.guidelineId}`);
}

/**
 * Retrieves traceability matrix for a guideline
 */
export async function getTraceabilityMatrix(guidelineId) {
    const admin = await import('firebase-admin');
    const db = admin.firestore();

    const doc = await db.collection('traceabilityMatrix').doc(guidelineId).get();
    
    if (!doc.exists) {
        // Generate if doesn't exist
        return await generateTraceabilityMatrix(guidelineId);
    }

    return { id: doc.id, ...doc.data() };
}

/**
 * Validates traceability completeness
 */
export async function validateTraceability(guidelineId) {
    const matrix = await getTraceabilityMatrix(guidelineId);
    
    const validation = {
        isValid: true,
        issues: [],
        completeness: {
            elements: 0,
            tests: 0,
            scenarios: 0,
            interactions: 0,
            results: 0
        }
    };

    // Check each level
    if (matrix.elements.length === 0) {
        validation.isValid = false;
        validation.issues.push('No auditable elements found');
    }

    if (matrix.testScenarios.length === 0) {
        validation.isValid = false;
        validation.issues.push('No test scenarios found');
    }

    // Check if each element has tests
    for (const element of matrix.elements) {
        const elementTests = matrix.testScenarios.filter(ts => ts.elementId === element.elementId);
        if (elementTests.length === 0) {
            validation.isValid = false;
            validation.issues.push(`Element ${element.elementId} has no test scenarios`);
        }
    }

    // Check if each scenario has interactions
    for (const scenario of matrix.testScenarios) {
        const scenarioInteractions = matrix.interactions.filter(i => i.scenarioId === scenario.scenarioId);
        if (scenarioInteractions.length === 0) {
            validation.isValid = false;
            validation.issues.push(`Scenario ${scenario.scenarioId} has no interactions`);
        }
    }

    // Check if each interaction has results
    for (const interaction of matrix.interactions) {
        const interactionResults = matrix.results.filter(r => r.interactionId === interaction.interactionId);
        if (interactionResults.length === 0) {
            validation.isValid = false;
            validation.issues.push(`Interaction ${interaction.interactionId} has no results`);
        }
    }

    // Calculate completeness percentages
    validation.completeness = {
        elements: matrix.summary.totalElements > 0 ? 100 : 0,
        tests: matrix.summary.totalTests > 0 ? 100 : 0,
        scenarios: matrix.summary.totalScenarios > 0 ? 100 : 0,
        interactions: matrix.summary.totalInteractions > 0 ? 100 : 0,
        results: matrix.summary.totalResults > 0 ? 100 : 0
    };

    return validation;
}

/**
 * Generates traceability report for ISO 13485 compliance
 */
export async function generateTraceabilityReport(guidelineId) {
    const matrix = await getTraceabilityMatrix(guidelineId);
    const validation = await validateTraceability(guidelineId);

    return {
        guidelineId,
        reportDate: new Date().toISOString(),
        matrix,
        validation,
        complianceStatus: validation.isValid ? 'COMPLIANT' : 'NON-COMPLIANT',
        recommendations: validation.isValid ? [] : [
            'Complete traceability chain is required for ISO 13485 compliance',
            ...validation.issues.map(issue => `Fix: ${issue}`)
        ]
    };
}

