// Enhanced audit logging module for comprehensive LLM interaction capture
// Designed for ISO 13485 compliance and fine-tuning data collection

/**
 * Logs a complete LLM interaction with full context for audit purposes
 * @param {Object} interactionData - Complete interaction data
 * @param {string} interactionData.guidelineId - Guideline ID if applicable
 * @param {string} interactionData.elementId - Auditable element ID if applicable
 * @param {string} interactionData.testId - Test scenario ID if applicable
 * @param {Object} interactionData.promptChain - Full prompt chain with system and user prompts
 * @param {Object} interactionData.response - Complete AI response with metadata
 * @param {Object} interactionData.modelConfig - Model configuration (provider, model, temperature, etc.)
 * @param {Object} interactionData.tokenUsage - Token usage details
 * @param {string} interactionData.endpoint - API endpoint name
 * @param {string} interactionData.userId - User ID
 * @param {number} interactionData.processingTimeMs - Response latency in milliseconds
 * @param {Object} interactionData.context - Additional context (scenario, audit scope, etc.)
 * @returns {Promise<Object>} - Interaction log entry with ID
 */
export async function logAuditInteraction(interactionData) {
    const {
        guidelineId,
        elementId,
        testId,
        promptChain,
        response,
        modelConfig,
        tokenUsage,
        endpoint,
        userId,
        processingTimeMs,
        context = {}
    } = interactionData;

    if (!promptChain || !response) {
        throw new Error('promptChain and response are required for audit logging');
    }

    // Import Firestore admin dynamically to avoid circular dependencies
    const admin = await import('firebase-admin');
    const db = admin.firestore();

    const timestamp = admin.firestore.FieldValue.serverTimestamp();
    const interactionId = db.collection('auditInteractions').doc().id;

    // Extract full prompt chain
    const systemPrompt = promptChain.systemPrompt || promptChain.system || '';
    const userPrompt = promptChain.userPrompt || promptChain.user || '';
    const fullPrompt = promptChain.fullPrompt || `${systemPrompt}\n\n${userPrompt}`;
    const contextPrompts = promptChain.contextPrompts || [];

    // Extract response data
    const responseContent = response.content || response.text || response.response || '';
    const responseMetadata = {
        ai_provider: response.ai_provider || modelConfig?.provider || 'Unknown',
        ai_model: response.ai_model || modelConfig?.model || 'Unknown',
        finish_reason: response.finish_reason || null,
        created: response.created || null
    };

    // Extract model configuration
    const modelInfo = {
        provider: modelConfig?.provider || response.ai_provider || 'Unknown',
        model: modelConfig?.model || response.ai_model || 'Unknown',
        temperature: modelConfig?.temperature || null,
        maxTokens: modelConfig?.maxTokens || modelConfig?.max_tokens || null,
        topP: modelConfig?.topP || modelConfig?.top_p || null,
        frequencyPenalty: modelConfig?.frequencyPenalty || modelConfig?.frequency_penalty || null,
        presencePenalty: modelConfig?.presencePenalty || modelConfig?.presence_penalty || null
    };

    // Extract token usage
    const tokenData = tokenUsage || response.token_usage || {};
    const tokenInfo = {
        prompt_tokens: tokenData.prompt_tokens || tokenData.input_tokens || 0,
        completion_tokens: tokenData.completion_tokens || tokenData.output_tokens || 0,
        total_tokens: tokenData.total_tokens || (tokenInfo?.prompt_tokens + tokenInfo?.completion_tokens) || 0,
        estimated_cost_usd: tokenData.estimated_cost_usd || tokenData.estimated_cost || null
    };

    // Build complete interaction log entry
    const interactionLog = {
        interactionId,
        timestamp,
        userId: userId || 'system',
        
        // Test context
        guidelineId: guidelineId || null,
        elementId: elementId || null,
        testId: testId || null,
        
        // Prompt chain (complete)
        promptChain: {
            systemPrompt,
            userPrompt,
            fullPrompt,
            contextPrompts,
            promptStructure: promptChain.promptStructure || null
        },
        
        // Response (complete)
        response: {
            content: responseContent,
            metadata: responseMetadata,
            fullResponse: response // Store complete response object
        },
        
        // Model information
        modelConfig: modelInfo,
        
        // Token usage
        tokenUsage: tokenInfo,
        
        // Performance metrics
        processingTimeMs: processingTimeMs || null,
        
        // Endpoint and context
        endpoint: endpoint || 'unknown',
        context: context,
        
        // ISO 13485 compliance fields
        auditPurpose: context.auditPurpose || 'guidance_validation',
        traceability: {
            guidelineId: guidelineId || null,
            elementId: elementId || null,
            testId: testId || null,
            scenarioId: context.scenarioId || null
        }
    };

    try {
        // Store in Firestore
        await db.collection('auditInteractions').doc(interactionId).set(interactionLog);
        
        console.log(`[AUDIT-LOG] Logged interaction ${interactionId} for endpoint: ${endpoint}`);
        
        return {
            success: true,
            interactionId,
            logEntry: interactionLog
        };
    } catch (error) {
        console.error('[AUDIT-LOG] Error logging interaction:', error);
        throw error;
    }
}

/**
 * Retrieves audit interactions with filtering options
 * @param {Object} filters - Filter criteria
 * @param {string} filters.guidelineId - Filter by guideline ID
 * @param {string} filters.elementId - Filter by element ID
 * @param {string} filters.testId - Filter by test ID
 * @param {string} filters.userId - Filter by user ID
 * @param {Date} filters.startDate - Start date for time range
 * @param {Date} filters.endDate - End date for time range
 * @param {number} filters.limit - Maximum number of results
 * @returns {Promise<Array>} - Array of interaction logs
 */
export async function getAuditInteractions(filters = {}) {
    const admin = await import('firebase-admin');
    const db = admin.firestore();
    
    let query = db.collection('auditInteractions');
    
    if (filters.guidelineId) {
        query = query.where('guidelineId', '==', filters.guidelineId);
    }
    
    if (filters.elementId) {
        query = query.where('elementId', '==', filters.elementId);
    }
    
    if (filters.testId) {
        query = query.where('testId', '==', filters.testId);
    }
    
    if (filters.userId) {
        query = query.where('userId', '==', filters.userId);
    }
    
    if (filters.startDate) {
        query = query.where('timestamp', '>=', filters.startDate);
    }
    
    if (filters.endDate) {
        query = query.where('timestamp', '<=', filters.endDate);
    }
    
    query = query.orderBy('timestamp', 'desc');
    
    if (filters.limit) {
        query = query.limit(filters.limit);
    }
    
    const snapshot = await query.get();
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}

/**
 * Gets interaction statistics for an audit test
 * @param {string} testId - Test ID
 * @returns {Promise<Object>} - Statistics object
 */
export async function getInteractionStatistics(testId) {
    const admin = await import('firebase-admin');
    const db = admin.firestore();
    
    const interactions = await db.collection('auditInteractions')
        .where('testId', '==', testId)
        .get();
    
    const stats = {
        totalInteractions: interactions.size,
        totalTokens: 0,
        totalCost: 0,
        averageProcessingTime: 0,
        providers: {},
        models: {}
    };
    
    let totalProcessingTime = 0;
    
    interactions.forEach(doc => {
        const data = doc.data();
        
        // Token usage
        if (data.tokenUsage) {
            stats.totalTokens += data.tokenUsage.total_tokens || 0;
            if (data.tokenUsage.estimated_cost_usd) {
                stats.totalCost += data.tokenUsage.estimated_cost_usd;
            }
        }
        
        // Processing time
        if (data.processingTimeMs) {
            totalProcessingTime += data.processingTimeMs;
        }
        
        // Provider/model distribution
        const provider = data.modelConfig?.provider || 'Unknown';
        const model = data.modelConfig?.model || 'Unknown';
        
        stats.providers[provider] = (stats.providers[provider] || 0) + 1;
        stats.models[model] = (stats.models[model] || 0) + 1;
    });
    
    if (stats.totalInteractions > 0) {
        stats.averageProcessingTime = totalProcessingTime / stats.totalInteractions;
    }
    
    return stats;
}

