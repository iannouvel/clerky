// Firestore data management for audit system
// Handles storage and retrieval of audit tests, interactions, results, and traces

/**
 * Stores an audit test in Firestore
 * @param {Object} testData - Test data
 * @returns {Promise<Object>} - Stored test with ID
 */
export async function storeAuditTest(testData) {
    const admin = await import('firebase-admin');
    const db = admin.firestore();

    const testId = db.collection('auditTests').doc().id;
    const timestamp = admin.firestore.FieldValue.serverTimestamp();

    const auditTest = {
        testId,
        timestamp,
        ...testData,
        createdAt: timestamp,
        updatedAt: timestamp,
        status: testData.status || 'created'
    };

    await db.collection('auditTests').doc(testId).set(auditTest);

    console.log(`[AUDIT-STORAGE] Stored audit test: ${testId}`);
    return { testId, ...auditTest };
}

/**
 * Stores audit interaction in Firestore
 * @param {Object} interactionData - Interaction data
 * @returns {Promise<Object>} - Stored interaction with ID
 */
export async function storeAuditInteraction(interactionData) {
    const admin = await import('firebase-admin');
    const db = admin.firestore();

    const interactionId = interactionData.interactionId || db.collection('auditInteractions').doc().id;
    const timestamp = admin.firestore.FieldValue.serverTimestamp();

    const interaction = {
        interactionId,
        timestamp,
        ...interactionData,
        createdAt: timestamp
    };

    await db.collection('auditInteractions').doc(interactionId).set(interaction);

    console.log(`[AUDIT-STORAGE] Stored audit interaction: ${interactionId}`);
    return { interactionId, ...interaction };
}

/**
 * Stores audit result in Firestore
 * @param {Object} resultData - Result data
 * @returns {Promise<Object>} - Stored result with ID
 */
export async function storeAuditResult(resultData) {
    const admin = await import('firebase-admin');
    const db = admin.firestore();

    const resultId = db.collection('auditResults').doc().id;
    const timestamp = admin.firestore.FieldValue.serverTimestamp();

    const auditResult = {
        resultId,
        timestamp,
        ...resultData,
        createdAt: timestamp,
        updatedAt: timestamp
    };

    await db.collection('auditResults').doc(resultId).set(auditResult);

    console.log(`[AUDIT-STORAGE] Stored audit result: ${resultId}`);
    return { resultId, ...auditResult };
}

/**
 * Stores audit trace in Firestore
 * @param {Object} traceData - Trace data
 * @returns {Promise<Object>} - Stored trace with ID
 */
export async function storeAuditTrace(traceData) {
    const admin = await import('firebase-admin');
    const db = admin.firestore();

    const traceId = db.collection('auditTraces').doc().id;
    const timestamp = admin.firestore.FieldValue.serverTimestamp();

    const trace = {
        traceId,
        timestamp,
        ...traceData,
        createdAt: timestamp
    };

    await db.collection('auditTraces').doc(traceId).set(trace);

    console.log(`[AUDIT-STORAGE] Stored audit trace: ${traceId}`);
    return { traceId, ...trace };
}

/**
 * Retrieves audit test by ID
 */
export async function getAuditTest(testId) {
    const admin = await import('firebase-admin');
    const db = admin.firestore();

    const doc = await db.collection('auditTests').doc(testId).get();
    if (!doc.exists) {
        return null;
    }
    return { id: doc.id, ...doc.data() };
}

/**
 * Retrieves audit tests with filters
 */
export async function getAuditTests(filters = {}) {
    const admin = await import('firebase-admin');
    const db = admin.firestore();

    let query = db.collection('auditTests');

    if (filters.guidelineId) {
        query = query.where('guidelineId', '==', filters.guidelineId);
    }

    if (filters.elementId) {
        query = query.where('elementId', '==', filters.elementId);
    }

    if (filters.status) {
        query = query.where('status', '==', filters.status);
    }

    query = query.orderBy('createdAt', 'desc');

    if (filters.limit) {
        query = query.limit(filters.limit);
    }

    const snapshot = await query.get();
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}

/**
 * Retrieves audit results for a test
 */
export async function getAuditResultsForTest(testId) {
    const admin = await import('firebase-admin');
    const db = admin.firestore();

    const snapshot = await db.collection('auditResults')
        .where('testId', '==', testId)
        .orderBy('createdAt', 'desc')
        .get();

    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}

/**
 * Retrieves audit interactions for a test
 */
export async function getAuditInteractionsForTest(testId) {
    const admin = await import('firebase-admin');
    const db = admin.firestore();

    const snapshot = await db.collection('auditInteractions')
        .where('testId', '==', testId)
        .orderBy('timestamp', 'desc')
        .get();

    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}

/**
 * Retrieves traceability chain for a guideline
 */
export async function getTraceabilityChain(guidelineId) {
    const admin = await import('firebase-admin');
    const db = admin.firestore();

    // Get all tests for guideline
    const tests = await getAuditTests({ guidelineId });

    // Get all elements
    const elements = [];
    for (const test of tests) {
        if (test.elementId && !elements.find(e => e.elementId === test.elementId)) {
            elements.push({ elementId: test.elementId });
        }
    }

    // Get all scenarios
    const scenarios = [];
    for (const test of tests) {
        if (test.scenarios) {
            scenarios.push(...test.scenarios.map(s => ({ ...s, testId: test.id })));
        }
    }

    // Get all interactions
    const interactions = [];
    for (const test of tests) {
        const testInteractions = await getAuditInteractionsForTest(test.id);
        interactions.push(...testInteractions);
    }

    // Get all results
    const results = [];
    for (const test of tests) {
        const testResults = await getAuditResultsForTest(test.id);
        results.push(...testResults);
    }

    return {
        guidelineId,
        elements,
        tests,
        scenarios,
        interactions,
        results,
        traceabilityComplete: true
    };
}

/**
 * Updates audit test status
 */
export async function updateAuditTestStatus(testId, status) {
    const admin = await import('firebase-admin');
    const db = admin.firestore();

    await db.collection('auditTests').doc(testId).update({
        status,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    return { testId, status };
}

/**
 * Links result to interaction and test
 */
export async function linkAuditResult(resultId, testId, interactionId) {
    const admin = await import('firebase-admin');
    const db = admin.firestore();

    await db.collection('auditResults').doc(resultId).update({
        testId,
        interactionId,
        linked: true,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    return { resultId, testId, interactionId };
}

/**
 * Gets audit statistics for a guideline
 */
export async function getAuditStatistics(guidelineId) {
    const tests = await getAuditTests({ guidelineId });
    const allResults = [];

    for (const test of tests) {
        const results = await getAuditResultsForTest(test.id);
        allResults.push(...results);
    }

    const stats = {
        totalTests: tests.length,
        totalScenarios: tests.reduce((sum, t) => sum + (t.totalScenarios || 0), 0),
        totalResults: allResults.length,
        averageScore: 0,
        scoreDistribution: {
            excellent: 0, // 90-100
            good: 0,      // 75-89
            needsImprovement: 0, // 60-74
            poor: 0       // 0-59
        }
    };

    if (allResults.length > 0) {
        const scores = allResults
            .filter(r => r.overallScore !== undefined)
            .map(r => r.overallScore);
        
        stats.averageScore = scores.reduce((sum, s) => sum + s, 0) / scores.length;

        scores.forEach(score => {
            if (score >= 90) stats.scoreDistribution.excellent++;
            else if (score >= 75) stats.scoreDistribution.good++;
            else if (score >= 60) stats.scoreDistribution.needsImprovement++;
            else stats.scoreDistribution.poor++;
        });
    }

    return stats;
}

