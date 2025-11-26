// Risk management integration for audit system
// Links to ISO 14971 risk management process

/**
 * Assesses risk for a guidance failure
 * @param {Object} failureData - Failure assessment data
 * @returns {Object} - Risk assessment result
 */
export function assessGuidanceFailureRisk(failureData) {
    const {
        evaluation,
        element,
        scenario,
        clinicalImpact
    } = failureData;

    // Determine severity
    const severity = determineFailureSeverity(evaluation, clinicalImpact);
    
    // Determine probability
    const probability = determineFailureProbability(evaluation);
    
    // Calculate risk level
    const riskLevel = calculateRiskLevel(severity, probability);
    
    return {
        elementId: element.elementId || element.name,
        scenarioId: scenario?.variationId || scenario?.id,
        severity,
        probability,
        riskLevel,
        clinicalImpact: clinicalImpact || assessClinicalImpact(element, evaluation),
        mitigationStrategies: generateMitigationStrategies(severity, probability, evaluation),
        priority: determinePriority(riskLevel),
        status: 'OPEN',
        createdAt: new Date().toISOString()
    };
}

/**
 * Determines failure severity
 */
function determineFailureSeverity(evaluation, clinicalImpact) {
    if (clinicalImpact) {
        if (clinicalImpact.includes('patient_safety') || clinicalImpact.includes('critical')) {
            return 'HIGH';
        }
        if (clinicalImpact.includes('moderate') || clinicalImpact.includes('significant')) {
            return 'MEDIUM';
        }
        return 'LOW';
    }
    
    // Base on evaluation scores
    if (evaluation) {
        const score = evaluation.overallScore || 0;
        if (score < 50) return 'HIGH';
        if (score < 70) return 'MEDIUM';
        return 'LOW';
    }
    
    return 'MEDIUM';
}

/**
 * Determines failure probability
 */
function determineFailureProbability(evaluation) {
    if (!evaluation) return 'MEDIUM';
    
    // Analyze issues
    const issueCount = (evaluation.issues || []).length;
    const criticalIssueCount = (evaluation.issues || []).filter(i => 
        i.toLowerCase().includes('critical') || 
        i.toLowerCase().includes('safety')
    ).length;
    
    if (criticalIssueCount > 0 || issueCount > 5) {
        return 'HIGH';
    }
    if (issueCount > 2) {
        return 'MEDIUM';
    }
    return 'LOW';
}

/**
 * Calculates risk level
 */
function calculateRiskLevel(severity, probability) {
    const riskMatrix = {
        'HIGH-HIGH': 'CRITICAL',
        'HIGH-MEDIUM': 'HIGH',
        'HIGH-LOW': 'MEDIUM',
        'MEDIUM-HIGH': 'HIGH',
        'MEDIUM-MEDIUM': 'MEDIUM',
        'MEDIUM-LOW': 'LOW',
        'LOW-HIGH': 'MEDIUM',
        'LOW-MEDIUM': 'LOW',
        'LOW-LOW': 'LOW'
    };
    
    return riskMatrix[`${severity}-${probability}`] || 'MEDIUM';
}

/**
 * Assesses clinical impact
 */
function assessClinicalImpact(element, evaluation) {
    // High significance elements have higher clinical impact
    if (element.significance === 'high') {
        return 'patient_safety_impact_high';
    }
    
    // Check evaluation for safety-related issues
    if (evaluation && evaluation.issues) {
        const safetyIssues = evaluation.issues.filter(i => 
            i.toLowerCase().includes('safety') ||
            i.toLowerCase().includes('critical') ||
            i.toLowerCase().includes('urgent')
        );
        if (safetyIssues.length > 0) {
            return 'patient_safety_impact_medium';
        }
    }
    
    return 'guidance_accuracy_impact';
}

/**
 * Generates mitigation strategies
 */
function generateMitigationStrategies(severity, probability, evaluation) {
    const strategies = [];
    
    if (severity === 'HIGH' || probability === 'HIGH') {
        strategies.push('Immediate review of guidance generation logic');
        strategies.push('Update prompt engineering for affected elements');
        strategies.push('Add additional validation checks');
    }
    
    if (evaluation && evaluation.recommendations) {
        strategies.push(...evaluation.recommendations.slice(0, 3));
    }
    
    if (strategies.length === 0) {
        strategies.push('Monitor and review in next audit cycle');
    }
    
    return strategies;
}

/**
 * Determines priority
 */
function determinePriority(riskLevel) {
    const priorities = {
        'CRITICAL': 'P0',
        'HIGH': 'P1',
        'MEDIUM': 'P2',
        'LOW': 'P3'
    };
    
    return priorities[riskLevel] || 'P2';
}

/**
 * Tracks risk resolution
 */
export async function trackRiskResolution(riskId, resolution) {
    const admin = await import('firebase-admin');
    const db = admin.firestore();
    
    await db.collection('auditRisks').doc(riskId).update({
        ...resolution,
        resolvedAt: admin.firestore.FieldValue.serverTimestamp(),
        status: 'RESOLVED',
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    
    return { riskId, status: 'RESOLVED' };
}

