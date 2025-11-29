/**
 * ISO-Compliant Clinical Guidance Point (CGP) Validation Module
 * 
 * This module implements a multi-stage validation workflow for extracting
 * and validating Clinical Guidance Points from clinical guidelines,
 * ensuring ISO 13485 compliance for Software as a Medical Device (SaMD).
 * 
 * Workflow:
 * 1. Initial extraction with clinical context (LLM 1)
 * 2. Cross-validation and disagreement identification (LLM 2)
 * 3. Arbitration of disagreements (LLM 3)
 * 4. Human clinician review and approval
 */

const admin = require('firebase-admin');

// Note: routeToAI and logAIInteraction will be passed as parameters
// to avoid circular dependencies

/**
 * Get the next available LLM provider that's different from the ones already used
 */
function getNextLLMProvider(usedProviders = []) {
    const availableProviders = ['DeepSeek', 'Anthropic', 'OpenAI', 'Mistral', 'Gemini'];
    const available = availableProviders.filter(p => !usedProviders.includes(p));
    
    // Return first available, or fallback to DeepSeek if all used
    return available.length > 0 ? available[0] : 'DeepSeek';
}

/**
 * Step 1: Extract Clinical Guidance Points with clinical context
 * 
 * @param {string} guidelineContent - The full guideline content
 * @param {string} aiProvider - The LLM provider to use (default user selection)
 * @param {string} userId - User ID for logging
 * @returns {Promise<Object>} Extracted CGPs with metadata
 */
async function extractClinicalGuidancePoints(guidelineContent, aiProvider = 'DeepSeek', userId = null, routeToAIFn = null, logAIFn = null) {
    try {
        console.log(`[CGP] Step 1: Starting CGP extraction with ${aiProvider}`);
        const startTime = Date.now();
        
        const prompt = `You are a clinical guidelines expert. Extract ALL individual pieces of clinical guidance from this guideline. Each time the guideline provides specific advice, recommendation, or instruction, that is a separate Clinical Guidance Point (CGP).

CRITICAL REQUIREMENTS:
1. Extract EVERY piece of clinical guidance - no omissions
2. For each CGP, identify:
   - The specific guidance statement (what action/decision is recommended)
   - The clinical context (when/where/under what circumstances this applies)
   - Input variables that determine when this guidance applies
   - Any thresholds or specific conditions (e.g., gestational age >= 26 weeks, blood pressure > 140/90)
   - The derived clinical advice/action

3. Order CGPs by clinical significance (most significant first)
4. Be comprehensive - err on the side of over-extraction rather than missing guidance

OUTPUT FORMAT:
Return a JSON array of objects, each representing one Clinical Guidance Point:

[
  {
    "cgpId": "Unique identifier (e.g., CGP_001, CGP_002)",
    "guidance": "The specific clinical guidance statement or recommendation",
    "clinicalContext": "Detailed description of when/where/under what circumstances this guidance applies",
    "inputVariables": ["variable1", "variable2"],
    "thresholds": {
      "variable1": "condition or threshold (e.g., '>= 26+0 weeks', '> 140/90 mmHg')"
    },
    "derivedAdvice": "The specific clinical action or decision that follows from this guidance",
    "significance": "high|medium|low",
    "guidelineSection": "Section or subsection reference if available"
  }
]

Guideline content:
${guidelineContent.substring(0, 20000)}${guidelineContent.length > 20000 ? '\n[... content truncated ...]' : ''}`;

        const messages = [
            {
                role: 'system',
                content: 'You are a clinical guidelines expert specialized in extracting comprehensive, actionable clinical guidance. Return ONLY valid JSON array format.'
            },
            {
                role: 'user',
                content: prompt
            }
        ];

        if (!routeToAIFn) {
            throw new Error('routeToAI function not provided');
        }
        const aiResult = await routeToAIFn({ messages }, userId, aiProvider);
        const processingTime = Date.now() - startTime;

        if (!aiResult || !aiResult.content) {
            throw new Error('No response from AI provider');
        }

        // Parse JSON response
        let cleanedContent = aiResult.content.trim();
        if (cleanedContent.startsWith('```json')) {
            cleanedContent = cleanedContent.replace(/^```json\s*/, '');
        }
        if (cleanedContent.startsWith('```')) {
            cleanedContent = cleanedContent.replace(/^```\s*/, '');
        }
        if (cleanedContent.endsWith('```')) {
            cleanedContent = cleanedContent.replace(/\s*```$/, '');
        }

        const extractedCGPs = JSON.parse(cleanedContent);
        
        if (!Array.isArray(extractedCGPs)) {
            throw new Error('AI response is not a valid array');
        }

        // Add metadata to each CGP
        const enrichedCGPs = extractedCGPs.map((cgp, index) => ({
            cgpId: cgp.cgpId || `CGP_${String(index + 1).padStart(3, '0')}`,
            extractedBy: 'llm1',
            extractionTimestamp: admin.firestore.FieldValue.serverTimestamp(),
            guidance: cgp.guidance || '',
            clinicalContext: cgp.clinicalContext || '',
            inputVariables: cgp.inputVariables || [],
            thresholds: cgp.thresholds || {},
            derivedAdvice: cgp.derivedAdvice || '',
            significance: cgp.significance || 'medium',
            guidelineSection: cgp.guidelineSection || null,
            validationStatus: 'extracted',
            crossValidatorAssessment: null,
            arbitratorAssessment: null,
            clinicianReview: null
        }));

        // Log the interaction for ISO compliance
        if (logAIFn) {
            try {
                await logAIFn({
                    prompt: prompt,
                    systemPrompt: messages[0].content,
                    aiProvider: aiProvider,
                    aiModel: aiResult.ai_model || 'unknown',
                    tokenUsage: aiResult.token_usage || {},
                    processingTime: processingTime,
                    endpoint: 'extractClinicalGuidancePoints',
                    userId: userId,
                    guidelineId: null // Will be set by caller
                }, {
                    success: true,
                    cgpsExtracted: enrichedCGPs.length
                });
            } catch (logError) {
                console.error('[CGP] Error logging interaction:', logError);
            }
        }

        console.log(`[CGP] Step 1: Successfully extracted ${enrichedCGPs.length} CGPs in ${processingTime}ms`);

        return {
            success: true,
            cgps: enrichedCGPs,
            metadata: {
                llmProvider: aiProvider,
                timestamp: new Date(),
                elementsExtracted: enrichedCGPs.length,
                processingTime: processingTime,
                tokenUsage: aiResult.token_usage || {}
            }
        };

    } catch (error) {
        console.error(`[CGP] Step 1: Error extracting CGPs:`, error);
        return {
            success: false,
            error: error.message,
            cgps: []
        };
    }
}

/**
 * Step 2: Cross-validate CGPs and identify disagreements
 * 
 * @param {string} guidelineContent - The full guideline content
 * @param {Array} extractedCGPs - CGPs from Step 1
 * @param {string} aiProvider - Different LLM provider from Step 1
 * @param {string} userId - User ID for logging
 * @returns {Promise<Object>} Validation results with disagreements
 */
async function crossValidateClinicalGuidancePoints(guidelineContent, extractedCGPs, aiProvider, userId = null, routeToAIFn = null, logAIFn = null) {
    try {
        console.log(`[CGP] Step 2: Starting cross-validation with ${aiProvider}`);
        const startTime = Date.now();

        const prompt = `You are a clinical guidelines validator. Review the extracted Clinical Guidance Points (CGPs) against the original guideline text.

Your task:
1. For each extracted CGP, assess if:
   - The guidance is correctly extracted (matches guideline content)
   - The clinical context is accurate and complete
   - The input variables and thresholds are correctly identified
   - Nothing important is missing from the CGP

2. Identify any missing CGPs - pieces of guidance that should be extracted but aren't

3. For each CGP, provide one of these assessments:
   - "validated": CGP is correct and complete
   - "missing_context": CGP is correct but missing important clinical context
   - "incorrect_extraction": CGP doesn't accurately reflect the guideline
   - "missing_element": This CGP doesn't exist or should be merged with another

OUTPUT FORMAT:
Return a JSON object with:

{
  "cgpAssessments": [
    {
      "cgpId": "CGP_001",
      "validated": true/false,
      "disagreements": ["missing_context"] or [],
      "notes": "Explanation of assessment"
    }
  ],
  "missingCGPs": [
    {
      "guidance": "Missing guidance statement",
      "clinicalContext": "Context where it applies",
      "reason": "Why this should be extracted"
    }
  ],
  "summary": "Overall assessment summary"
}

Extracted CGPs to validate:
${JSON.stringify(extractedCGPs, null, 2)}

Guideline content:
${guidelineContent.substring(0, 20000)}${guidelineContent.length > 20000 ? '\n[... content truncated ...]' : ''}`;

        const messages = [
            {
                role: 'system',
                content: 'You are a clinical guidelines validator. Your role is to critically assess extracted guidance points for accuracy and completeness. Return ONLY valid JSON format.'
            },
            {
                role: 'user',
                content: prompt
            }
        ];

        if (!routeToAIFn) {
            throw new Error('routeToAI function not provided');
        }
        const aiResult = await routeToAIFn({ messages }, userId, aiProvider);
        const processingTime = Date.now() - startTime;

        if (!aiResult || !aiResult.content) {
            throw new Error('No response from AI provider');
        }

        // Parse JSON response
        let cleanedContent = aiResult.content.trim();
        if (cleanedContent.startsWith('```json')) {
            cleanedContent = cleanedContent.replace(/^```json\s*/, '');
        }
        if (cleanedContent.startsWith('```')) {
            cleanedContent = cleanedContent.replace(/^```\s*/, '');
        }
        if (cleanedContent.endsWith('```')) {
            cleanedContent = cleanedContent.replace(/\s*```$/, '');
        }

        const validationResult = JSON.parse(cleanedContent);
        
        // Update CGPs with validation assessments
        const validatedCGPs = extractedCGPs.map(cgp => {
            const assessment = validationResult.cgpAssessments?.find(a => a.cgpId === cgp.cgpId);
            
            if (assessment) {
                const hasDisagreement = assessment.disagreements && assessment.disagreements.length > 0;
                
                return {
                    ...cgp,
                    validationStatus: assessment.validated && !hasDisagreement ? 'validated' : 'disagreement',
                    crossValidatorAssessment: {
                        validated: assessment.validated,
                        disagreements: assessment.disagreements || [],
                        notes: assessment.notes || ''
                    }
                };
            } else {
                // If no assessment found, mark as validated (no disagreement)
                return {
                    ...cgp,
                    validationStatus: 'validated',
                    crossValidatorAssessment: {
                        validated: true,
                        disagreements: [],
                        notes: 'No specific assessment provided'
                    }
                };
            }
        });

        // Add missing CGPs as new entries
        const missingCGPs = (validationResult.missingCGPs || []).map((missing, index) => ({
            cgpId: `CGP_MISSING_${String(index + 1).padStart(3, '0')}`,
            extractedBy: 'llm2',
            extractionTimestamp: new Date(), // Will be converted to Firestore timestamp in server
            guidance: missing.guidance || '',
            clinicalContext: missing.clinicalContext || '',
            inputVariables: [],
            thresholds: {},
            derivedAdvice: '',
            significance: 'medium',
            guidelineSection: null,
            validationStatus: 'disagreement',
            crossValidatorAssessment: {
                validated: false,
                disagreements: ['missing_element'],
                notes: missing.reason || 'Identified as missing by cross-validator'
            },
            arbitratorAssessment: null,
            clinicianReview: null
        }));

        const allCGPs = [...validatedCGPs, ...missingCGPs];
        const validatedCount = validatedCGPs.filter(cgp => cgp.validationStatus === 'validated').length;
        const disagreementCount = allCGPs.filter(cgp => cgp.validationStatus === 'disagreement').length;

        // Log the interaction
        if (logAIFn) {
            try {
                await logAIFn({
                    prompt: prompt,
                    systemPrompt: messages[0].content,
                    aiProvider: aiProvider,
                    aiModel: aiResult.ai_model || 'unknown',
                    tokenUsage: aiResult.token_usage || {},
                    processingTime: processingTime,
                    endpoint: 'crossValidateClinicalGuidancePoints',
                    userId: userId
                }, {
                    success: true,
                    totalCGPs: allCGPs.length,
                    validated: validatedCount,
                    disagreements: disagreementCount
                });
            } catch (logError) {
                console.error('[CGP] Error logging interaction:', logError);
            }
        }

        console.log(`[CGP] Step 2: Validated ${validatedCount}/${validatedCGPs.length} CGPs, found ${disagreementCount} disagreements in ${processingTime}ms`);

        return {
            success: true,
            cgps: allCGPs,
            metadata: {
                llmProvider: aiProvider,
                timestamp: new Date(),
                totalElements: allCGPs.length,
                validated: validatedCount,
                disagreements: disagreementCount,
                processingTime: processingTime,
                tokenUsage: aiResult.token_usage || {}
            },
            summary: validationResult.summary || ''
        };

    } catch (error) {
        console.error(`[CGP] Step 2: Error cross-validating CGPs:`, error);
        return {
            success: false,
            error: error.message,
            cgps: extractedCGPs // Return original if validation fails
        };
    }
}

/**
 * Step 3: Arbitrate disagreements between Step 1 and Step 2
 * 
 * @param {string} guidelineContent - The full guideline content
 * @param {Array} llm1CGPs - CGPs from Step 1 (initial extraction)
 * @param {Array} llm2CGPs - CGPs from Step 2 (with validation assessments)
 * @param {string} aiProvider - Third different LLM provider
 * @param {string} userId - User ID for logging
 * @returns {Promise<Object>} Arbitrated CGPs with resolutions
 */
async function arbitrateCGPDisagreements(guidelineContent, llm1CGPs, llm2CGPs, aiProvider, userId = null, routeToAIFn = null, logAIFn = null) {
    try {
        console.log(`[CGP] Step 3: Starting arbitration with ${aiProvider}`);
        const startTime = Date.now();

        // Filter to only CGPs with disagreements
        const disagreementCGPs = llm2CGPs.filter(cgp => 
            cgp.validationStatus === 'disagreement' || 
            (cgp.crossValidatorAssessment && cgp.crossValidatorAssessment.disagreements.length > 0)
        );

        if (disagreementCGPs.length === 0) {
            console.log('[CGP] Step 3: No disagreements to arbitrate');
            return {
                success: true,
                cgps: llm2CGPs,
                metadata: {
                    llmProvider: aiProvider,
                    timestamp: new Date(),
                    disagreementsResolved: 0,
                    processingTime: Date.now() - startTime
                }
            };
        }

        // Match LLM1 and LLM2 CGPs for comparison
        const cgpPairs = disagreementCGPs.map(llm2CGP => {
            const matchingLLM1 = llm1CGPs.find(cgp => cgp.cgpId === llm2CGP.cgpId);
            return {
                llm1CGP: matchingLLM1 || null,
                llm2CGP: llm2CGP
            };
        });

        const prompt = `You are an independent clinical guidelines arbitrator. Review disagreements between two LLM extractions of Clinical Guidance Points.

Your task:
For each disagreement, review:
1. LLM 1's extraction
2. LLM 2's assessment and concerns
3. The original guideline content

Determine the most accurate resolution, considering:
- Which extraction better matches the guideline text
- Which has more complete clinical context
- Which better identifies thresholds and conditions

For each disagreement, provide ONE of these resolutions:
- "agree_llm1": LLM 1's extraction is correct
- "agree_llm2": LLM 2's assessment is correct (may include modifications)
- "partial_both": Both have merit, combine them
- "new_interpretation": Neither is fully correct, provide a better interpretation

OUTPUT FORMAT:
Return a JSON object:

{
  "arbitrations": [
    {
      "cgpId": "CGP_001",
      "resolution": "agree_llm1" | "agree_llm2" | "partial_both" | "new_interpretation",
      "resolvedGuidance": "Final guidance statement (or null if unchanged)",
      "resolvedContext": "Final clinical context (or null if unchanged)",
      "reasoning": "Explanation of resolution"
    }
  ]
}

Disagreements to arbitrate:
${JSON.stringify(cgpPairs, null, 2)}

Guideline content:
${guidelineContent.substring(0, 20000)}${guidelineContent.length > 20000 ? '\n[... content truncated ...]' : ''}`;

        const messages = [
            {
                role: 'system',
                content: 'You are an independent clinical guidelines arbitrator. Your role is to resolve disagreements by carefully analyzing both extractions against the source guideline. Return ONLY valid JSON format.'
            },
            {
                role: 'user',
                content: prompt
            }
        ];

        if (!routeToAIFn) {
            throw new Error('routeToAI function not provided');
        }
        const aiResult = await routeToAIFn({ messages }, userId, aiProvider);
        const processingTime = Date.now() - startTime;

        if (!aiResult || !aiResult.content) {
            throw new Error('No response from AI provider');
        }

        // Parse JSON response
        let cleanedContent = aiResult.content.trim();
        if (cleanedContent.startsWith('```json')) {
            cleanedContent = cleanedContent.replace(/^```json\s*/, '');
        }
        if (cleanedContent.startsWith('```')) {
            cleanedContent = cleanedContent.replace(/^```\s*/, '');
        }
        if (cleanedContent.endsWith('```')) {
            cleanedContent = cleanedContent.replace(/\s*```$/, '');
        }

        const arbitrationResult = JSON.parse(cleanedContent);

        // Apply arbitrations to CGPs
        const arbitratedCGPs = llm2CGPs.map(cgp => {
            const arbitration = arbitrationResult.arbitrations?.find(a => a.cgpId === cgp.cgpId);
            
            if (arbitration && cgp.validationStatus === 'disagreement') {
                // Apply resolution
                const resolvedGuidance = arbitration.resolvedGuidance || cgp.guidance;
                const resolvedContext = arbitration.resolvedContext || cgp.clinicalContext;
                
                return {
                    ...cgp,
                    guidance: resolvedGuidance,
                    clinicalContext: resolvedContext,
                    validationStatus: 'arbitrated',
                    arbitratorAssessment: {
                        resolution: arbitration.resolution,
                        resolvedGuidance: arbitration.resolvedGuidance || null,
                        resolvedContext: arbitration.resolvedContext || null,
                        reasoning: arbitration.reasoning || ''
                    }
                };
            }
            
            // If no arbitration found but has disagreement, keep as disagreement
            return cgp;
        });

        // Log the interaction
        if (logAIFn) {
            try {
                await logAIFn({
                    prompt: prompt,
                    systemPrompt: messages[0].content,
                    aiProvider: aiProvider,
                    aiModel: aiResult.ai_model || 'unknown',
                    tokenUsage: aiResult.token_usage || {},
                    processingTime: processingTime,
                    endpoint: 'arbitrateCGPDisagreements',
                    userId: userId
                }, {
                    success: true,
                    disagreementsResolved: (arbitrationResult.arbitrations || []).length
                });
            } catch (logError) {
                console.error('[CGP] Error logging interaction:', logError);
            }
        }

        const resolvedCount = arbitratedCGPs.filter(cgp => cgp.validationStatus === 'arbitrated').length;
        console.log(`[CGP] Step 3: Resolved ${resolvedCount} disagreements in ${processingTime}ms`);

        return {
            success: true,
            cgps: arbitratedCGPs,
            metadata: {
                llmProvider: aiProvider,
                timestamp: new Date(),
                disagreementsResolved: resolvedCount,
                processingTime: processingTime,
                tokenUsage: aiResult.token_usage || {}
            }
        };

    } catch (error) {
        console.error(`[CGP] Step 3: Error arbitrating disagreements:`, error);
        return {
            success: false,
            error: error.message,
            cgps: llm2CGPs // Return validated CGPs if arbitration fails
        };
    }
}

module.exports = {
    extractClinicalGuidancePoints,
    crossValidateClinicalGuidancePoints,
    arbitrateCGPDisagreements,
    getNextLLMProvider
};

