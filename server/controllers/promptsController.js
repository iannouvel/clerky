const fs = require('fs');
const path = require('path');
const { db, admin } = require('../config/firebase');
const { StepTimer } = require('../middleware/logging');
const {
    evaluateSuggestions,
    generatePromptImprovements,
    extractLessonsLearned,
    storeGuidelineLearning,
    analyzeGuidelineForPatient,
    refineSuggestions,
    SEQUENTIAL_LLM_CHAIN,
    loadGuidelineLearning,
    formatLearningForPrompt
} = require('../services/ai');

// Helper to access prompts.json safely
function getPromptsJson() {
    const promptsPath = path.join(__dirname, '../../prompts.json');
    if (fs.existsSync(promptsPath)) {
        delete require.cache[require.resolve('../../prompts.json')];
        return require('../../prompts.json');
    }
    return {};
}

// Helper to analyze guideline with specific provider (Step 0 of sequential)
// This mirrors server.js logic but uses the updated analyzeGuidelineForPatient
async function analyzeGuidelineForPatientWithProvider(clinicalNote, guidelineContent, guidelineTitle, userId, targetProvider, guidelineId = null) {
    console.log(`[SEMANTIC-ANALYSIS] ==================================================`);
    console.log(`[SEMANTIC-ANALYSIS] START: "${guidelineTitle}" with ${targetProvider} (Two-Step Chain)`);
    console.log(`[SEMANTIC-ANALYSIS] ==================================================`);

    // analyzeGuidelineForPatient in ai.js now handles this logic including loading hints
    // We just pass targetProvider (search model)
    return analyzeGuidelineForPatient(clinicalNote, guidelineContent, guidelineTitle, userId, guidelineId, targetProvider);
}

exports.debugPrompts = async (req, res) => {
    try {
        const promptKey = 'testTranscript';
        const results = {
            memory: global.prompts?.[promptKey]?.prompt || 'Not in memory',
            firestore: 'Not checked',
            file: 'Not checked'
        };

        // Check Firestore
        try {
            if (db) {
                const doc = await db.collection('settings').doc('prompts').get();
                if (doc.exists && doc.data()?.prompts?.[promptKey]) {
                    results.firestore = doc.data().prompts[promptKey].prompt;
                } else {
                    results.firestore = 'Not found in Firestore';
                }
            } else {
                results.firestore = 'Firestore not initialized';
            }
        } catch (e) {
            results.firestore = 'Error: ' + e.message;
        }

        // Check File
        try {
            const filePrompts = getPromptsJson();
            results.file = filePrompts?.[promptKey]?.prompt || 'Not found in file';
        } catch (e) {
            results.file = 'Error: ' + e.message;
        }

        res.json({
            success: true,
            results
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

exports.getPrompts = async (req, res) => {
    try {
        let loadedPrompts = null;
        let source = 'unknown';

        // Try Firestore first
        if (db) {
            try {
                const firestoreDoc = await db.collection('settings').doc('prompts').get();
                if (firestoreDoc.exists && firestoreDoc.data()?.prompts) {
                    loadedPrompts = firestoreDoc.data().prompts;
                    global.prompts = loadedPrompts;
                    source = 'firestore';
                    console.log('[PROMPTS] Loaded prompts from Firestore for /getPrompts');
                }
            } catch (firestoreError) {
                console.warn('[PROMPTS] Failed to load from Firestore:', firestoreError.message);
            }
        }

        // Fallback to prompts.json
        if (!loadedPrompts) {
            loadedPrompts = global.prompts || getPromptsJson();
            source = 'prompts.json';
            console.log('[PROMPTS] Loaded prompts from prompts.json for /getPrompts');
        }

        res.json({
            success: true,
            prompts: loadedPrompts,
            source
        });
    } catch (error) {
        console.error('Error serving prompts:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to load prompts'
        });
    }
};

exports.updatePrompts = async (req, res) => {
    try {
        const { updatedPrompts } = req.body;
        if (!updatedPrompts) {
            return res.status(400).json({ success: false, message: 'No prompts data provided' });
        }

        const parsedPrompts = typeof updatedPrompts === 'string' ? JSON.parse(updatedPrompts) : updatedPrompts;

        // Update in-memory cache
        global.prompts = parsedPrompts;

        // Write to Firestore (primary storage)
        if (db) {
            await db.collection('settings').doc('prompts').set({
                prompts: parsedPrompts,
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                updatedBy: req.user?.uid || 'unknown'
            });
            console.log('[PROMPTS] Successfully saved prompts to Firestore');
        }

        // Also write to local file (backup)
        const promptsPath = path.join(__dirname, '../../prompts.json');
        fs.writeFileSync(promptsPath, JSON.stringify(parsedPrompts, null, 2));
        console.log('[PROMPTS] Successfully saved prompts to prompts.json');

        res.json({
            success: true,
            message: 'Prompts updated in Firestore and local file'
        });
    } catch (error) {
        console.error('Error updating prompts:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update prompts: ' + error.message
        });
    }
};

exports.syncPromptsToFirestore = async (req, res) => {
    try {
        console.log('[PROMPTS-SYNC] Starting sync from prompts.json to Firestore...');

        // Load fresh prompts from prompts.json
        const filePrompts = getPromptsJson();

        const promptCount = Object.keys(filePrompts).length;
        console.log(`[PROMPTS-SYNC] Loaded ${promptCount} prompts from prompts.json`);

        if (!db) {
            throw new Error('Firestore is not available');
        }

        // Write to Firestore
        await db.collection('settings').doc('prompts').set({
            prompts: filePrompts,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedBy: req.user?.uid || 'migration',
            syncedFromFile: true,
            syncDate: new Date().toISOString()
        });

        // Update in-memory cache
        global.prompts = filePrompts;

        console.log(`[PROMPTS-SYNC] Successfully synced ${promptCount} prompts to Firestore`);

        res.json({
            success: true,
            message: `Successfully synced ${promptCount} prompts from prompts.json to Firestore`,
            promptCount,
            promptKeys: Object.keys(filePrompts)
        });
    } catch (error) {
        console.error('[PROMPTS-SYNC] Error syncing prompts:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to sync prompts: ' + error.message
        });
    }
};

exports.evolvePrompts = async (req, res) => {
    const timer = new StepTimer('/evolvePrompts');
    req.stepTimer = timer;

    try {
        console.log('[EVOLVE] Evolution cycle started');
        const { scenarios, scenariosWithGuidelines, guidelineId } = req.body;
        const userId = req.user.uid;

        let processableScenarios = [];

        if (scenariosWithGuidelines && Array.isArray(scenariosWithGuidelines) && scenariosWithGuidelines.length > 0) {
            processableScenarios = scenariosWithGuidelines;
        } else if (scenarios && Array.isArray(scenarios) && scenarios.length > 0 && guidelineId) {
            processableScenarios = scenarios.map(s => ({ ...s, guidelineId }));
        } else {
            return res.status(400).json({ success: false, error: 'Either scenariosWithGuidelines or (scenarios + guidelineId) is required' });
        }

        timer.step('Validation');

        const currentPrompt = global.prompts?.['analyzeGuidelineForPatient'] || getPromptsJson()['analyzeGuidelineForPatient'];
        const scenarioResults = [];
        let totalLatency = 0;
        const guidelineCache = {};

        for (let i = 0; i < processableScenarios.length; i++) {
            const scenario = processableScenarios[i];
            const scenarioGuidelineId = scenario.guidelineId;

            console.log(`[EVOLVE] Processing scenario ${i + 1}/${processableScenarios.length}: ${scenario.name || 'Unnamed'} with guideline ${scenarioGuidelineId}`);

            let guidelineContent, guidelineTitle;

            if (guidelineCache[scenarioGuidelineId]) {
                guidelineContent = guidelineCache[scenarioGuidelineId].content;
                guidelineTitle = guidelineCache[scenarioGuidelineId].title;
            } else {
                const guidelineDoc = await db.collection('guidelines').doc(scenarioGuidelineId).get();

                if (!guidelineDoc.exists) {
                    console.warn(`[EVOLVE] Guideline not found: ${scenarioGuidelineId}, skipping scenario`);
                    continue;
                }

                const guidelineData = guidelineDoc.data();
                guidelineTitle = scenario.guidelineTitle || guidelineData.humanFriendlyTitle || guidelineData.title || scenarioGuidelineId;
                guidelineContent = guidelineData.content || guidelineData.condensed;

                if (!guidelineContent) {
                    const fullContentDoc = await db.collection('guidelines').doc(scenarioGuidelineId).collection('content').doc('full').get();
                    if (fullContentDoc.exists) guidelineContent = fullContentDoc.data()?.content;
                }

                if (!guidelineContent) {
                    const condensedDoc = await db.collection('guidelines').doc(scenarioGuidelineId).collection('content').doc('condensed').get();
                    if (condensedDoc.exists) guidelineContent = condensedDoc.data()?.condensed;
                }

                if (!guidelineContent) {
                    console.warn(`[EVOLVE] No content for guideline: ${scenarioGuidelineId}, skipping scenario`);
                    continue;
                }

                guidelineCache[scenarioGuidelineId] = { content: guidelineContent, title: guidelineTitle };
            }

            timer.step(`Scenario ${i + 1} fetch guideline`);

            const startTime = Date.now();

            const analysisResult = await analyzeGuidelineForPatient(
                scenario.clinicalNote,
                guidelineContent,
                guidelineTitle,
                userId,
                scenarioGuidelineId
            );

            const analysisLatency = Date.now() - startTime;
            totalLatency += analysisLatency;

            timer.step(`Scenario ${i + 1} analysis`);

            const evaluation = await evaluateSuggestions(
                scenario.clinicalNote,
                guidelineContent,
                guidelineTitle,
                analysisResult.suggestions || [],
                analysisResult.alreadyCompliant || [],
                userId
            );

            timer.step(`Scenario ${i + 1} evaluation`);

            try {
                const lessons = await extractLessonsLearned(guidelineTitle, evaluation, analysisResult.suggestions || [], userId);
                if (lessons && lessons.learningText) {
                    await storeGuidelineLearning(scenarioGuidelineId, lessons, guidelineTitle, userId);
                    console.log(`[EVOLVE] Stored learning for ${guidelineTitle}`);
                }
            } catch (lessonError) {
                console.error('[EVOLVE] Error extracting/storing lessons:', lessonError.message);
            }

            timer.step(`Scenario ${i + 1} lessons`);

            scenarioResults.push({
                scenarioName: scenario.name || `Scenario ${i + 1}`,
                guidelineId: scenarioGuidelineId,
                guidelineTitle: guidelineTitle,
                clinicalNote: scenario.clinicalNote.substring(0, 200) + '...',
                analysisResult: {
                    suggestionsCount: analysisResult.suggestions?.length || 0,
                    alreadyCompliantCount: analysisResult.alreadyCompliant?.length || 0,
                    patientContext: analysisResult.patientContext,
                    suggestions: analysisResult.suggestions
                },
                evaluation,
                latencyMs: analysisLatency
            });
        }

        if (scenarioResults.length === 0) {
            return res.status(400).json({ success: false, error: 'No scenarios could be processed' });
        }

        const avgRecall = scenarioResults.reduce((sum, r) => sum + (r.evaluation.recallScore ?? r.evaluation.completenessScore ?? 0), 0) / scenarioResults.length;
        const avgPrecision = scenarioResults.reduce((sum, r) => sum + (r.evaluation.precisionScore ?? r.evaluation.accuracyScore ?? 0), 0) / scenarioResults.length;
        const avgLatency = totalLatency / scenarioResults.length;
        const avgRedundancyRate = scenarioResults.reduce((sum, r) => sum + (r.evaluation.redundancyRate || 0), 0) / scenarioResults.length;
        const avgFalseNegativeRate = scenarioResults.reduce((sum, r) => sum + (r.evaluation.falseNegativeRate || 0), 0) / scenarioResults.length;
        const avgApplicabilityRate = scenarioResults.reduce((sum, r) => sum + (r.evaluation.applicabilityRate || 0), 0) / scenarioResults.length;

        timer.step('Aggregate metrics');

        const evaluations = scenarioResults.map(r => r.evaluation);
        const improvements = await generatePromptImprovements(
            currentPrompt,
            evaluations,
            avgRecall,
            avgPrecision,
            avgLatency,
            userId,
            { avgRedundancyRate, avgFalseNegativeRate }
        );

        timer.step('Generate improvements');

        console.log(`[EVOLVE] Evolution cycle complete. ${scenarioResults.length} scenarios processed.`);
        console.log('[EVOLVE] Timing:', JSON.stringify(timer.getSummary()));

        res.json({
            success: true,
            scenarioResults,
            aggregatedMetrics: {
                averageRecall: avgRecall,
                averagePrecision: avgPrecision,
                averageRedundancyRate: avgRedundancyRate,
                averageFalseNegativeRate: avgFalseNegativeRate,
                averageApplicabilityRate: avgApplicabilityRate,
                averageLatencyMs: avgLatency,
                totalScenarios: scenarioResults.length,
                averageCompleteness: avgRecall,
                averageAccuracy: avgPrecision
            },
            currentPrompt,
            suggestedImprovements: improvements,
            timing: timer.getSummary()
        });

    } catch (error) {
        console.error('[EVOLVE] Error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

exports.evolvePromptsSequential = async (req, res) => {
    const timer = new StepTimer('/evolvePromptsSequential');
    req.stepTimer = timer;

    try {
        console.log('[EVOLVE-SEQ] Sequential evolution started');
        const { scenariosWithGuidelines } = req.body;
        const userId = req.user.uid;

        if (!scenariosWithGuidelines || !Array.isArray(scenariosWithGuidelines) || scenariosWithGuidelines.length === 0) {
            return res.status(400).json({ success: false, error: 'scenariosWithGuidelines is required' });
        }

        timer.step('Validation');

        const allResults = [];
        const guidelineCache = {};

        for (let scenarioIdx = 0; scenarioIdx < scenariosWithGuidelines.length; scenarioIdx++) {
            const scenario = scenariosWithGuidelines[scenarioIdx];
            const scenarioGuidelineId = scenario.guidelineId;

            console.log(`[EVOLVE-SEQ] Processing scenario ${scenarioIdx + 1}/${scenariosWithGuidelines.length}: ${scenario.name}`);

            let guidelineContent, guidelineTitle;

            if (guidelineCache[scenarioGuidelineId]) {
                guidelineContent = guidelineCache[scenarioGuidelineId].content;
                guidelineTitle = guidelineCache[scenarioGuidelineId].title;
            } else {
                const guidelineDoc = await db.collection('guidelines').doc(scenarioGuidelineId).get();
                if (!guidelineDoc.exists) {
                    console.warn(`[EVOLVE-SEQ] Guideline not found: ${scenarioGuidelineId}, skipping scenario`);
                    continue;
                }

                const guidelineData = guidelineDoc.data();
                guidelineTitle = scenario.guidelineTitle || guidelineData.humanFriendlyTitle || guidelineData.title || scenarioGuidelineId;
                guidelineContent = guidelineData.content || guidelineData.condensed;

                if (!guidelineContent) {
                    const fullContentDoc = await db.collection('guidelines').doc(scenarioGuidelineId).collection('content').doc('full').get();
                    if (fullContentDoc.exists) guidelineContent = fullContentDoc.data()?.content;
                }
                if (!guidelineContent) {
                    const condensedDoc = await db.collection('guidelines').doc(scenarioGuidelineId).collection('content').doc('condensed').get();
                    if (condensedDoc.exists) guidelineContent = condensedDoc.data()?.condensed;
                }

                if (!guidelineContent) {
                    console.warn(`[EVOLVE-SEQ] No content for guideline: ${scenarioGuidelineId}, skipping scenario`);
                    continue;
                }
                guidelineCache[scenarioGuidelineId] = { content: guidelineContent, title: guidelineTitle };
            }

            timer.step(`Scenario ${scenarioIdx + 1} fetch guideline`);

            const iterations = [];
            let currentSuggestions = null;
            let currentEvaluation = null;

            for (let llmIdx = 0; llmIdx < SEQUENTIAL_LLM_CHAIN.length; llmIdx++) {
                const llmConfig = SEQUENTIAL_LLM_CHAIN[llmIdx];
                const modelId = llmConfig.model;
                const displayName = llmConfig.displayName;
                console.log(`[EVOLVE-SEQ] Scenario ${scenarioIdx + 1}, LLM ${llmIdx + 1}/${SEQUENTIAL_LLM_CHAIN.length}: ${displayName}`);

                const startTime = Date.now();
                let analysisResult;

                try {
                    if (llmIdx === 0) {
                        analysisResult = await analyzeGuidelineForPatientWithProvider(
                            scenario.clinicalNote,
                            guidelineContent,
                            guidelineTitle,
                            userId,
                            modelId,
                            scenarioGuidelineId
                        );
                    } else {
                        analysisResult = await refineSuggestions(
                            currentSuggestions,
                            currentEvaluation,
                            scenario.clinicalNote,
                            guidelineContent,
                            guidelineTitle,
                            userId,
                            modelId,
                            scenarioGuidelineId
                        );
                    }
                } catch (llmError) {
                    console.error(`[EVOLVE-SEQ] Error with ${displayName}:`, llmError.message);
                    analysisResult = { patientContext: {}, suggestions: currentSuggestions || [], alreadyCompliant: [], error: llmError.message };
                }

                const analysisLatency = Date.now() - startTime;
                currentSuggestions = analysisResult.suggestions || [];

                timer.step(`Scenario ${scenarioIdx + 1} ${displayName} analysis`);

                let evaluation;
                try {
                    evaluation = await evaluateSuggestions(
                        scenario.clinicalNote,
                        guidelineContent,
                        guidelineTitle,
                        currentSuggestions,
                        analysisResult.alreadyCompliant || [],
                        userId
                    );
                } catch (evalError) {
                    console.error(`[EVOLVE-SEQ] Evaluation error:`, evalError.message);
                    evaluation = { recallScore: 0, precisionScore: 0, completenessScore: 0, accuracyScore: 0, counts: { suggestionsTotal: 0 }, error: evalError.message };
                }

                currentEvaluation = evaluation;
                timer.step(`Scenario ${scenarioIdx + 1} ${displayName} evaluation`);

                if (!evaluation.error && (evaluation.missedRecommendations?.length > 0 || evaluation.suggestionEvaluations?.some(s => s.assessment === 'incorrect' || s.assessment === 'redundant'))) {
                    try {
                        const lessons = await extractLessonsLearned(guidelineTitle, evaluation, currentSuggestions, userId);
                        if (lessons && lessons.learningText) {
                            await storeGuidelineLearning(scenarioGuidelineId, lessons, guidelineTitle, userId);
                            console.log(`[EVOLVE-SEQ] Stored learning from ${displayName} for ${guidelineTitle}`);
                        }
                    } catch (lessonError) {
                        console.error(`[EVOLVE-SEQ] Error extracting/storing lessons from ${displayName}:`, lessonError.message);
                    }
                    timer.step(`Scenario ${scenarioIdx + 1} ${displayName} lessons extracted`);
                }

                iterations.push({
                    provider: displayName,
                    modelId: modelId,
                    suggestionsCount: currentSuggestions.length,
                    recallScore: evaluation.recallScore ?? evaluation.completenessScore ?? 0,
                    precisionScore: evaluation.precisionScore ?? evaluation.accuracyScore ?? 0,
                    redundancyRate: evaluation.redundancyRate || 0,
                    falseNegativeRate: evaluation.falseNegativeRate || 0,
                    completenessScore: evaluation.recallScore ?? evaluation.completenessScore ?? 0,
                    accuracyScore: evaluation.precisionScore ?? evaluation.accuracyScore ?? 0,
                    latencyMs: analysisLatency,
                    overallAssessment: evaluation.overallAssessment,
                    suggestions: currentSuggestions,
                    refinementNotes: analysisResult.refinementNotes,
                    error: analysisResult.error || evaluation.error
                });
            }

            allResults.push({
                scenarioName: scenario.name,
                guidelineId: scenarioGuidelineId,
                guidelineTitle,
                iterations
            });
        }

        if (allResults.length === 0) {
            return res.status(400).json({ success: false, error: 'No scenarios could be processed' });
        }

        timer.step('All scenarios complete');

        console.log(`[EVOLVE-SEQ] Sequential evolution complete. ${allResults.length} scenarios processed through ${SEQUENTIAL_LLM_CHAIN.length} LLMs.`);
        console.log('[EVOLVE-SEQ] Timing:', JSON.stringify(timer.getSummary()));

        res.json({
            success: true,
            llmProviders: SEQUENTIAL_LLM_CHAIN.map(c => c.displayName),
            llmChain: SEQUENTIAL_LLM_CHAIN,
            scenarioResults: allResults,
            timing: timer.getSummary()
        });

    } catch (error) {
        console.error('[EVOLVE-SEQ] Error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};
