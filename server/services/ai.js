/**
 * @fileoverview AI Service - Core AI routing and clinical analysis functions.
 *
 * This module handles all AI provider interactions, including:
 * - Multi-provider routing with automatic failover (DeepSeek, OpenAI, Anthropic, etc.)
 * - Clinical guideline relevance analysis
 * - Practice point compliance checking
 * - Suggestion generation and refinement
 * - Sense-checking for temporal/logical consistency
 *
 * @module server/services/ai
 * @requires axios
 * @requires string-similarity
 * @requires ../config/firebase
 * @requires ../config/logger
 * @requires ../config/constants
 * @requires ./preferences
 */

const axios = require('axios');
const stringSimilarity = require('string-similarity');
const { db, admin } = require('../config/firebase');
const { debugLog } = require('../config/logger');
const { AI_PROVIDER_PREFERENCE, AI_MODEL_REGISTRY } = require('../config/constants');
const { logAIInteraction } = require('../utils/aiLogger');
const {
    getUserAIPreference,
    getProviderFromModel,
    getUserModelPreferences,
    getNextAvailableProvider,
    getUserChunkDistributionProviders,
    getUserTaskModels
} = require('./preferences');

const SEQUENTIAL_LLM_CHAIN = AI_PROVIDER_PREFERENCE.map(p => ({
    model: p.model,
    displayName: `${p.name} (${p.model})`,
    provider: p.name,
    cost: p.costPer1kTokens
}));

/**
 * Creates an AI prompt for analyzing guideline relevance to a clinical case.
 *
 * @param {string} transcript - The clinical note/transcript text
 * @param {Array<Object>} guidelinesChunk - Array of guideline objects to evaluate
 * @param {string} guidelinesChunk[].id - Unique guideline identifier
 * @param {string} guidelinesChunk[].title - Guideline title
 * @param {string} [guidelinesChunk[].summary] - Optional guideline summary
 * @param {string[]} [guidelinesChunk[].keywords] - Optional keywords for matching
 * @returns {string} Formatted prompt for the AI model
 */
function createPromptForChunk(transcript, guidelinesChunk) {
    const guidelinesText = guidelinesChunk.map(g => {
        let guidelineInfo = `[${g.id}] ${g.title}`;
        if (g.targetPopulation && g.targetPopulation.trim()) {
            guidelineInfo += `\nTarget population: ${g.targetPopulation.trim()}`;
        }
        if (g.summary && g.summary.trim()) {
            guidelineInfo += `\nSummary: ${g.summary.trim()}`;
        }
        if (g.keywords && Array.isArray(g.keywords) && g.keywords.length > 0) {
            guidelineInfo += `\nKeywords: ${g.keywords.slice(0, 10).join(', ')}`;
        }
        return guidelineInfo;
    }).join('\n\n---\n\n');

    return `You are a medical expert reading a clinical case and deciding how relevant each listed guideline is to that specific patient.

Clinical case:
${transcript}

Available guidelines:
${guidelinesText}

For each guideline, use the "Target population" field (where provided) as the primary signal for applicability — if the patient does not belong to that target population, assign a low score (below 0.2). Then consider whether it directly addresses the patient's primary condition and context, whether it applies to their demographics and clinical situation, and whether it might inform management or differential diagnosis. Assign a relevance score between 0.0 and 1.0, where scores above 0.8 mean the guideline directly applies, scores between 0.5 and 0.8 suggest it may be useful for secondary issues, scores between 0.2 and 0.5 indicate limited background relevance, and scores below 0.2 mean the guideline is not applicable to this case.

Respond with a JSON object grouping the guidelines into four arrays — mostRelevant, potentiallyRelevant, lessRelevant, and notRelevant — where each entry contains the guideline id, title, and relevance score. Return only the JSON with no surrounding text.`;
}

/**
 * Merges results from multiple guideline chunk analyses into a single categorized result.
 *
 * Re-categorizes all guidelines by relevance score thresholds:
 * - mostRelevant: score >= 0.8
 * - potentiallyRelevant: score >= 0.6
 * - lessRelevant: score >= 0.3
 * - notRelevant: score < 0.3
 *
 * @param {Array<Object>} chunkResults - Array of chunk analysis results
 * @param {Object} chunkResults[].categories - Categorized guidelines from each chunk
 * @returns {Object} Merged and re-sorted categories
 * @returns {Array} returns.mostRelevant - Highly relevant guidelines
 * @returns {Array} returns.potentiallyRelevant - Moderately relevant guidelines
 * @returns {Array} returns.lessRelevant - Low relevance guidelines
 * @returns {Array} returns.notRelevant - Irrelevant guidelines
 */
function mergeChunkResults(chunkResults) {
    const merged = {
        mostRelevant: [],
        potentiallyRelevant: [],
        lessRelevant: [],
        notRelevant: []
    };

    chunkResults.forEach(result => {
        if (result && result.categories) {
            Object.keys(merged).forEach(category => {
                if (result.categories[category] && Array.isArray(result.categories[category])) {
                    merged[category].push(...result.categories[category]);
                }
            });
        }
    });

    const allGuidelines = [];
    Object.keys(merged).forEach(category => {
        merged[category].forEach(guideline => {
            allGuidelines.push({ ...guideline, originalCategory: category });
        });
    });

    merged.mostRelevant = [];
    merged.potentiallyRelevant = [];
    merged.lessRelevant = [];
    merged.notRelevant = [];

    allGuidelines.forEach(guideline => {
        const score = parseFloat(guideline.relevance) || 0;
        if (score >= 0.8) {
            merged.mostRelevant.push(guideline);
        } else if (score >= 0.6) {
            merged.potentiallyRelevant.push(guideline);
        } else if (score >= 0.3) {
            merged.lessRelevant.push(guideline);
        } else {
            merged.notRelevant.push(guideline);
        }
    });

    Object.keys(merged).forEach(category => {
        merged[category].sort((a, b) => {
            const aScore = parseFloat(a.relevance) || 0;
            const bScore = parseFloat(b.relevance) || 0;
            return bScore - aScore;
        });
    });

    return merged;
}

/**
 * Parses and normalizes AI response for a guideline chunk analysis.
 *
 * Handles various response formats and uses fuzzy matching to resolve
 * guideline titles back to their IDs when the AI returns titles instead.
 *
 * @param {string} responseContent - Raw AI response text (may contain JSON)
 * @param {Array<Object>} [originalChunk=[]] - Original guidelines for ID resolution
 * @returns {Object} Parsing result
 * @returns {boolean} returns.success - Whether parsing succeeded
 * @returns {Object} [returns.categories] - Categorized guidelines if successful
 * @returns {string} [returns.error] - Error message if parsing failed
 */
function parseChunkResponse(responseContent, originalChunk = []) {
    try {
        let cleanContent = responseContent.trim();
        const jsonMatch = cleanContent.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/i);
        if (jsonMatch) cleanContent = jsonMatch[1];

        const parsed = JSON.parse(cleanContent);
        const categoryRoot = (parsed && typeof parsed === 'object' && parsed.categories && typeof parsed.categories === 'object')
            ? parsed.categories
            : parsed;

        const cleanedCategories = {
            mostRelevant: [],
            potentiallyRelevant: [],
            lessRelevant: [],
            notRelevant: []
        };

        const byId = new Map(originalChunk.map(g => [g.id, g]));
        const originalTitles = originalChunk.map(g => g.title);

        const normaliseItem = (item) => {
            if (!item) return null;
            if (typeof item === 'string') return { id: item, relevance: '0.5' };
            if (typeof item !== 'object') return null;
            return { id: item.id, title: item.title, relevance: item.relevance };
        };

        const extractCategoryArray = (root, key) => {
            const v = root ? root[key] : null;
            return Array.isArray(v) ? v : [];
        };

        for (const category of Object.keys(cleanedCategories)) {
            const arr = extractCategoryArray(categoryRoot, category);
            cleanedCategories[category] = arr.map(raw => {
                const item = normaliseItem(raw) || {};
                const relevance = item.relevance || '0.5';

                if (item.id && byId.has(item.id)) return { id: item.id, relevance };

                if (item.title) {
                    const { bestMatch } = stringSimilarity.findBestMatch(item.title, originalTitles);
                    if (bestMatch.rating > 0.7) {
                        const guideline = originalChunk.find(g => g.title === bestMatch.target);
                        if (guideline) return { id: guideline.id, relevance };
                    }
                }
                return { id: item.id || 'unknown-id', relevance: item.relevance || '0.0' };
            });
        }
        return { success: true, categories: cleanedCategories };
    } catch (jsonError) {
        debugLog('[DEBUG] JSON parsing failed:', jsonError.message);
        // Fallback to text parsing (omitted for brevity in this replace, assuming JSON reliability or acceptable fallback)
        return { success: false, error: jsonError.message };
    }
}

/**
 * Formats chat messages for different AI provider APIs.
 *
 * Each provider has slightly different message format requirements:
 * - OpenAI/DeepSeek/Mistral/Groq: Standard {role, content} format
 * - Anthropic: System messages converted to user messages with prefix
 * - Gemini: Uses {role, parts: [{text}]} format
 *
 * @param {Array<Object>} messages - Array of chat messages
 * @param {string} messages[].role - Message role ('system', 'user', 'assistant')
 * @param {string} messages[].content - Message content
 * @param {string} provider - Target provider name
 * @returns {Array<Object>} Provider-formatted messages
 */
function formatMessagesForProvider(messages, provider) {
    switch (provider) {
        case 'OpenAI': return messages;
        case 'DeepSeek': return messages.map(msg => ({ role: msg.role, content: msg.content }));
        case 'Anthropic': return messages.map(msg => ({ role: msg.role === 'system' ? 'user' : msg.role, content: msg.role === 'system' ? `System: ${msg.content}` : msg.content }));
        case 'Mistral': return messages.map(msg => ({ role: msg.role, content: msg.content }));
        case 'Gemini': return messages.map(msg => ({ role: msg.role === 'system' ? 'user' : msg.role, parts: [{ text: msg.content }] }));
        case 'Groq': return messages.map(msg => ({ role: msg.role, content: msg.content }));
        default: return messages;
    }
}

/**
 * Sends a prompt to an AI provider with automatic failover and logging.
 *
 * This is the core AI communication function. It handles:
 * - Provider selection based on model name or user preferences
 * - Automatic failover when API keys are missing
 * - Message formatting for different providers
 * - Response logging to Firestore for analytics
 *
 * @async
 * @param {string|Array<Object>} prompt - Text prompt or array of chat messages
 * @param {string} [model='deepseek-chat'] - Model identifier (determines provider)
 * @param {string|null} [systemPrompt=null] - System prompt (if prompt is string)
 * @param {string|null} [userId=null] - User ID for preference lookup and logging
 * @param {number} [temperature=0] - Sampling temperature (0-1). Default 0 for deterministic, reproducible output.
 * @param {number} [timeoutMs=120000] - Request timeout in milliseconds
 * @param {boolean} [skipUserPreference=false] - Skip user's model preferences
 * @param {number} [maxTokens=4000] - Maximum tokens in response
 * @returns {Promise<Object>} AI response object
 * @returns {string} returns.content - Generated text content
 * @returns {string} returns.ai_provider - Provider that handled request
 * @returns {string} returns.ai_model - Model that was used
 * @returns {Object} returns.token_usage - Token usage statistics
 * @throws {Error} If no AI provider API keys are configured or request fails
 */
async function sendToAI(prompt, model = 'deepseek-chat', systemPrompt = null, userId = null, temperature = 0, timeoutMs = 120000, skipUserPreference = false, maxTokens = 4000, taskComplexity = null) {
    let preferredProvider = 'DeepSeek';
    const sendToAIStartTime = Date.now();

    try {
        if (model.includes('deepseek')) preferredProvider = 'DeepSeek';
        else if (model.includes('claude') || model.includes('anthropic')) preferredProvider = 'Anthropic';
        else if (model.includes('mistral')) preferredProvider = 'Mistral';
        else if (model.includes('gemini')) preferredProvider = 'Gemini';
        else if (model.startsWith('grok-')) preferredProvider = 'Grok';
        else if (model.includes('gpt') && !model.includes('gpt-oss')) preferredProvider = 'OpenAI';
        else if (model.includes('groq/') || model.includes('llama-3') || model.includes('llama-4') || model.includes('gpt-oss') || model.includes('kimi-k2') || model.includes('qwen')) preferredProvider = 'Groq';

        if (userId && !skipUserPreference) {
            try {
                const userModelOrder = await getUserModelPreferences(userId);
                if (userModelOrder && userModelOrder.length > 0) {
                    const firstPreferredModelId = userModelOrder[0];
                    const providerConfig = AI_PROVIDER_PREFERENCE.find(p => p.model === firstPreferredModelId);
                    if (providerConfig && providerConfig.name !== preferredProvider) {
                        preferredProvider = providerConfig.name;
                        model = providerConfig.model;
                    }
                }
            } catch (error) { }
        }

        const availableKeys = {
            hasOpenAIKey: !!process.env.OPENAI_API_KEY,
            hasDeepSeekKey: !!process.env.DEEPSEEK_API_KEY,
            hasAnthropicKey: !!process.env.ANTHROPIC_API_KEY,
            hasMistralKey: !!process.env.MISTRAL_API_KEY,
            hasGeminiKey: !!process.env.GOOGLE_AI_API_KEY,
            hasGroqKey: !!process.env.GROQ_API_KEY,
            hasGrokKey: !!process.env.GROK_API_KEY
        };

        const hasCurrentProviderKey = availableKeys[`has${preferredProvider}Key`];
        if (!hasCurrentProviderKey) {
            let fallbackModelOrder = AI_PROVIDER_PREFERENCE.map(p => p.model);
            if (userId) {
                try {
                    const userModelOrder = await getUserModelPreferences(userId);
                    if (userModelOrder && userModelOrder.length > 0) fallbackModelOrder = userModelOrder;
                } catch (e) { }
            }
            let nextProvider = null;
            const currentIndex = fallbackModelOrder.indexOf(model);
            for (let i = currentIndex + 1; i < fallbackModelOrder.length; i++) {
                const modelId = fallbackModelOrder[i];
                const providerConfig = AI_PROVIDER_PREFERENCE.find(p => p.model === modelId);
                if (providerConfig && availableKeys[`has${providerConfig.name}Key`]) {
                    nextProvider = providerConfig;
                    break;
                }
            }
            if (!nextProvider) {
                for (let i = 0; i < currentIndex; i++) {
                    const modelId = fallbackModelOrder[i];
                    const providerConfig = AI_PROVIDER_PREFERENCE.find(p => p.model === modelId);
                    if (providerConfig && availableKeys[`has${providerConfig.name}Key`]) {
                        nextProvider = providerConfig;
                        break;
                    }
                }
            }

            if (nextProvider) {
                preferredProvider = nextProvider.name;
                model = nextProvider.model;
            } else {
                throw new Error('No AI provider API keys configured');
            }
        }

        let messages = [];
        if (Array.isArray(prompt)) {
            messages = prompt;
        } else {
            if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
            messages.push({ role: 'user', content: prompt });
        }

        console.log(`[SEND-AI] ${preferredProvider}/${model} (maxTokens=${maxTokens})`);
        const formattedMessages = formatMessagesForProvider(messages, preferredProvider);
        let responseData, content, tokenUsage = {};

        if (preferredProvider === 'DeepSeek') {
            const response = await axios.post('https://api.deepseek.com/v1/chat/completions', { model, messages: formattedMessages, temperature, max_tokens: maxTokens }, { headers: { 'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`, 'Content-Type': 'application/json' }, timeout: timeoutMs });
            responseData = response.data;
            content = responseData.choices[0].message.content;
        } else if (preferredProvider === 'OpenAI') {
            const response = await axios.post('https://api.openai.com/v1/chat/completions', { model, messages: formattedMessages, temperature, max_tokens: maxTokens }, { headers: { 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' }, timeout: timeoutMs });
            responseData = response.data;
            content = responseData.choices[0].message.content;
        } else if (preferredProvider === 'Anthropic') {
            const response = await axios.post('https://api.anthropic.com/v1/messages', { model, messages: formattedMessages, max_tokens: maxTokens, temperature }, { headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'Content-Type': 'application/json', 'anthropic-version': '2023-06-01' }, timeout: timeoutMs });
            responseData = response.data;
            content = responseData.content[0].text;
        } else if (preferredProvider === 'Mistral') {
            const response = await axios.post('https://api.mistral.ai/v1/chat/completions', { model, messages: formattedMessages, temperature, max_tokens: maxTokens }, { headers: { 'Authorization': `Bearer ${process.env.MISTRAL_API_KEY}`, 'Content-Type': 'application/json' }, timeout: timeoutMs });
            responseData = response.data;
            content = responseData.choices[0].message.content;
        } else if (preferredProvider === 'Gemini') {
            const geminiMessages = formattedMessages.map(msg => ({ role: msg.role === 'user' ? 'user' : 'model', parts: msg.parts || [{ text: msg.content || '' }] }));
            const generationConfig = { temperature, maxOutputTokens: maxTokens };
            // Gemini 2.5 AND 3 models count "thinking" tokens against
            // maxOutputTokens, which truncates the visible response and breaks
            // JSON parsing — and, with reasoning enabled on large prompts, can
            // blow past the request timeout entirely. Disable thinking for
            // deterministic outputs. (gemini-3-flash-preview is now the default
            // Gemini, so it must be covered too.)
            if (/gemini-(2\.5|3)/.test(model)) {
                generationConfig.thinkingConfig = { thinkingBudget: 0 };
            }
            const response = await axios.post(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, { contents: geminiMessages, generationConfig }, { headers: { 'Content-Type': 'application/json' }, params: { key: process.env.GOOGLE_AI_API_KEY }, timeout: timeoutMs });
            responseData = response.data;
            content = responseData.candidates?.[0]?.content?.parts?.[0]?.text || '';
        } else if (preferredProvider === 'Groq') {
            const response = await axios.post('https://api.groq.com/openai/v1/chat/completions', { model, messages: formattedMessages, temperature, max_tokens: maxTokens }, { headers: { 'Authorization': `Bearer ${process.env.GROQ_API_KEY}`, 'Content-Type': 'application/json' }, timeout: timeoutMs });
            responseData = response.data;
            content = responseData.choices[0].message.content;
        } else if (preferredProvider === 'Grok') {
            const response = await axios.post('https://api.x.ai/v1/chat/completions', { model, messages: formattedMessages, temperature, max_tokens: maxTokens }, { headers: { 'Authorization': `Bearer ${process.env.GROK_API_KEY}`, 'Content-Type': 'application/json' }, timeout: timeoutMs });
            responseData = response.data;
            content = responseData.choices[0].message.content;
        }

        if (responseData && (responseData.usage || responseData.usageMetadata)) {
            const usage = responseData.usage || responseData.usageMetadata;
            tokenUsage = { prompt_tokens: usage.prompt_tokens || usage.promptTokenCount || 0, completion_tokens: usage.completion_tokens || usage.candidatesTokenCount || 0, total_tokens: usage.total_tokens || usage.totalTokenCount || 0 };
        }

        if (db) {
            const latencyMs = Date.now() - sendToAIStartTime;
            const promptStr = typeof prompt === 'string' ? prompt : JSON.stringify(prompt);
            const logEndpoint = taskComplexity ? `sendToAI:${taskComplexity}` : 'sendToAI';
            db.collection('aiInteractions').add({
                timestamp: admin.firestore.FieldValue.serverTimestamp(),
                userId: userId || 'anonymous',
                provider: preferredProvider,
                model,
                endpoint: logEndpoint,
                promptTokens: tokenUsage.prompt_tokens || 0,
                completionTokens: tokenUsage.completion_tokens || 0,
                totalTokens: tokenUsage.total_tokens || 0,
                latencyMs,
                success: true,
                promptLength: promptStr.length,
                responseLength: content?.length || 0,
                fullPrompt: promptStr.substring(0, 50000),
                fullResponse: content ? content.substring(0, 50000) : ''
            })
                .then(ref => console.log(`[AI-LOG] wrote ${ref.id} endpoint=${logEndpoint} provider=${preferredProvider}`))
                .catch(err => console.error(`[AI-LOG] FAILED endpoint=${logEndpoint} provider=${preferredProvider} code=${err.code || 'unknown'} msg=${err.message}`, err.stack));
        } else {
            console.warn(`[AI-LOG] db is falsy — no write attempted endpoint=${taskComplexity ? `sendToAI:${taskComplexity}` : 'sendToAI'}`);
        }

        return { content: content, ai_provider: preferredProvider, ai_model: model, token_usage: tokenUsage };

    } catch (error) {
        console.error('Error in sendToAI:', error.message);
        throw new Error(`AI request failed (${preferredProvider}): ${error.response?.data?.error?.message || error.message}`);
    }
}

/**
 * High-level AI routing function with simplified interface.
 *
 * Automatically selects the best provider based on user preferences
 * and available API keys. Use this for most AI interactions.
 *
 * @async
 * @param {string|Object} prompt - Text prompt or {messages, temperature} object
 * @param {string|null} [userId=null] - User ID for preference lookup
 * @param {string|null} [preferredProvider=null] - Override provider selection
 * @param {number} [maxTokens=4000] - Maximum tokens in response
 * @returns {Promise<Object>} AI response (see sendToAI for structure)
 * @throws {Error} If AI request fails
 *
 * @example
 * // Simple text prompt
 * const result = await routeToAI('Summarize this clinical note', userId);
 *
 * @example
 * // With chat messages and custom temperature
 * const result = await routeToAI({
 *   messages: [
 *     { role: 'system', content: 'You are a clinical advisor.' },
 *     { role: 'user', content: 'Analyze this case...' }
 *   ],
 *   temperature: 0.3
 * }, userId);
 */
async function routeToAI(prompt, userId = null, preferredProvider = null, maxTokens = 4000, taskComplexity = null) {
    try {
        const defaultProvider = AI_PROVIDER_PREFERENCE[0].name;
        let provider = preferredProvider || defaultProvider;

        // Task-specific model override (only if no explicit preferredProvider)
        // taskComplexity may carry an operation label after a colon (e.g. 'evaluation:perPoint')
        // purely for granular log tracing. The ROUTING tier is only the part before the colon;
        // the full string is preserved as-is for the log endpoint label (see sendToAI:411).
        const taskTier = taskComplexity ? String(taskComplexity).split(':')[0] : null;
        if (!preferredProvider && userId && taskTier) {
            try {
                const taskModels = await getUserTaskModels(userId);
                console.log(`[ROUTE-AI] Loaded task models for userId ${userId}: ${JSON.stringify(taskModels)}`);
                const taskModel = taskTier === 'complex' ? taskModels.complexTaskModel
                    : taskTier === 'simple' ? taskModels.simpleTaskModel
                    : taskTier === 'evaluation' ? taskModels.evaluationTaskModel
                    : null;
                console.log(`[ROUTE-AI] Task complexity '${taskComplexity}' → selected model: ${taskModel || '(none - using default)'}`);
                if (taskModel) provider = taskModel;
            } catch (error) {
                console.error('[DEBUG] Error getting task model preference:', error.message);
            }
        }

        if (!preferredProvider && !taskComplexity && userId) {
            try {
                const userPreference = await getUserAIPreference(userId);
                if (userPreference) provider = userPreference;
            } catch (error) { console.error('[DEBUG] Error getting user AI preference:', error.message); }
        }

        let model;
        let modelConfig = AI_PROVIDER_PREFERENCE.find(p => p.model === provider);
        if (modelConfig) {
            model = provider;
            provider = modelConfig.name;
        } else {
            const map = { 'OpenAI': 'gpt-3.5-turbo', 'DeepSeek': 'deepseek-chat', 'Anthropic': 'claude-3-haiku-20240307', 'Mistral': 'mistral-large-latest', 'Gemini': 'gemini-2.5-flash', 'Groq': 'llama-3.3-70b-versatile' };
            model = map[provider] || 'deepseek-chat';
            modelConfig = AI_PROVIDER_PREFERENCE.find(p => p.model === model);
        }

        // Estimate token count and check against context window
        // Rough estimate: 1 token ≈ 4 characters
        const messageText = typeof prompt === 'object' && prompt.messages
            ? prompt.messages.map(m => m.content || '').join(' ')
            : (prompt || '');
        const estimatedTokens = Math.ceil(messageText.length / 4) + maxTokens;

        if (modelConfig?.contextWindow && estimatedTokens > modelConfig.contextWindow) {
            const originalModel = model;
            // Find the cheapest model with a large enough context window
            const suitable = AI_PROVIDER_PREFERENCE
                .filter(p => p.contextWindow && p.contextWindow >= estimatedTokens)
                .sort((a, b) => a.priority - b.priority);
            if (suitable.length > 0) {
                model = suitable[0].model;
                provider = suitable[0].name;
                console.log(`[CONTEXT-CHECK] ${originalModel} context ${modelConfig.contextWindow} too small for ~${estimatedTokens} tokens, upgraded to ${model} (${suitable[0].contextWindow})`);
            } else {
                console.warn(`[CONTEXT-CHECK] No model has a large enough context window for ~${estimatedTokens} tokens, proceeding with ${model}`);
            }
        }

        // routeToAI has already resolved user preferences (via task complexity or
        // direct user pref above), so sendToAI must not re-apply them and silently
        // swap providers — that previously caused log entries where the endpoint
        // label said one provider but the actual call went to another.
        let result;
        let lastError;

        // Try primary provider first, then fallback to others if it fails
        let tryProviders = [provider];
        if (!preferredProvider) {
            // Add other providers as fallback (exclude current one), sorted by health status and priority
            const otherProviders = AI_PROVIDER_PREFERENCE
                .filter(p => p.name !== provider)
                .sort((a, b) => {
                    // Prioritize WORKING providers, then UNKNOWN, then others
                    const aHealth = global.PROVIDER_HEALTH[a.name]?.status || 'UNKNOWN';
                    const bHealth = global.PROVIDER_HEALTH[b.name]?.status || 'UNKNOWN';
                    const healthPriority = { 'WORKING': 0, 'UNKNOWN': 1, 'NOT_CONFIGURED': 2, 'ERROR': 3, 'HTTP_ERROR': 3 };
                    const aPriority = healthPriority[aHealth] !== undefined ? healthPriority[aHealth] : 3;
                    const bPriority = healthPriority[bHealth] !== undefined ? healthPriority[bHealth] : 3;
                    if (aPriority !== bPriority) return aPriority - bPriority;
                    // If health status is equal, use model priority
                    return a.priority - b.priority;
                })
                .map(p => p.name);
            tryProviders = [provider, ...otherProviders];

            // If the resolved primary is itself known-DOWN, don't waste a
            // guaranteed-failed call on it first — lead with the healthiest
            // providers and keep the primary at the end (health can be stale).
            const primaryHealth = global.PROVIDER_HEALTH[provider]?.status || 'UNKNOWN';
            if ((primaryHealth === 'ERROR' || primaryHealth === 'HTTP_ERROR') && otherProviders.length) {
                tryProviders = [...otherProviders, provider];
                console.log(`[ROUTE-AI] Primary ${provider} is ${primaryHealth} — leading with healthier providers (${otherProviders[0]})`);
            }
        }

        for (const tryProvider of tryProviders) {
            const providerHealth = global.PROVIDER_HEALTH[tryProvider]?.status || 'UNKNOWN';

            // Skip providers known to be in ERROR state on second+ attempt
            if (tryProvider !== provider && providerHealth === 'ERROR') {
                console.log(`[ROUTE-AI-FALLBACK] Skipping ${tryProvider} (known ERROR state)`);
                continue;
            }

            try {
                const tryModel = AI_PROVIDER_PREFERENCE.find(p => p.name === tryProvider)?.model || model;
                console.log(`[ROUTE-AI-FALLBACK] Trying provider: ${tryProvider}/${tryModel} (health: ${providerHealth})`);

                if (typeof prompt === 'object' && prompt.messages) {
                    const temperature = prompt.temperature !== undefined ? prompt.temperature : 0;
                    result = await sendToAI(prompt.messages, tryModel, null, userId, temperature, 120000, true, maxTokens, taskComplexity);
                } else {
                    result = await sendToAI(prompt, tryModel, null, userId, 0, 120000, true, maxTokens, taskComplexity);
                }
                console.log(`[ROUTE-AI-FALLBACK] ✓ Success with ${tryProvider}`);
                return result;
            } catch (error) {
                lastError = error;
                console.warn(`[ROUTE-AI-FALLBACK] ✗ ${tryProvider} failed:`, error.message);
                if (tryProvider === tryProviders[tryProviders.length - 1]) {
                    // Last provider in list - throw the error
                    throw lastError;
                }
                // Otherwise continue to next provider
            }
        }

        throw lastError || new Error('All AI providers failed');
    } catch (error) {
        console.error('[DEBUG] Error in routeToAI:', error.message);
        // Log the failure so it's visible in dev.html alongside successful calls
        logAIInteraction(prompt, { error: true, content: error?.message || String(error) }, `routeToAI:error:${taskComplexity || 'default'}`, userId)
            .catch(err => console.warn('[ROUTE-AI] error log failed:', err?.message));
        throw error;
    }
}

/**
 * Checks clinical note compliance against practice points and suggests improvements.
 *
 * Evaluates whether the clinical note addresses each practice point and
 * categorizes them as compliant or non-compliant.
 *
 * @async
 * @param {string} clinicalNote - The clinical note text to evaluate
 * @param {Array<Object>} importantPoints - Practice points to check against
 * @param {number} importantPoints[].originalIndex - Original index in full list
 * @param {string} importantPoints[].point - The practice point text
 * @param {string} userId - User ID for AI routing
 * @returns {Promise<Object>} Compliance results
 * @returns {Array} returns.compliant - Indices of compliant points
 * @returns {Array} returns.nonCompliant - Indices of non-compliant points
 */
async function checkComplianceAndSuggest(clinicalNote, importantPoints, userId) {
    if (importantPoints.length === 0) return { compliant: [], nonCompliant: [] };
    const pointsList = importantPoints.map(p => `[${p.originalIndex}] ${p.point}`).join('\n');
    const prompts = global.prompts || require('../../prompts.json');
    const promptConfig = prompts['checkPracticePointCompliance'];
    const systemPrompt = promptConfig?.system_prompt || 'You are a clinical advisor. Respond with valid JSON only, with no surrounding text or markdown.';
    const userPrompt = (promptConfig?.prompt || `CLINICAL NOTE:\n{{clinicalNote}}\n\nPRACTICE POINTS:\n{{pointsList}}\n\nFor each practice point, ask yourself: "Is this clinical note essentially compliant..."\n\nReturn JSON...`)
        .replace('{{clinicalNote}}', clinicalNote)
        .replace('{{pointsList}}', pointsList);
    const result = await routeToAI({ messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }] }, userId);
    try {
        return JSON.parse(result.content.trim().replace(/```json\n?|\n?```/g, ''));
    } catch (e) {
        return { compliant: [], nonCompliant: [] };
    }
}

/**
 * Filters practice points to identify those relevant to a clinical note.
 *
 * First-pass filter that identifies which practice points from a guideline
 * are applicable to the specific patient case.
 *
 * @async
 * @param {string} clinicalNote - The clinical note text
 * @param {Array<string>} allPoints - All practice points from guidelines
 * @param {string} userId - User ID for AI routing
 * @returns {Promise<Object>} Filter results
 * @returns {Array<number>} returns.relevant - Indices of relevant points (1-based)
 * @returns {Object} returns.irrelevant - Map of irrelevant point indices to reasons
 */
async function filterRelevantPracticePoints(clinicalNote, allPoints, userId) {
    if (!allPoints || allPoints.length === 0) return { relevant: [], irrelevant: {} };
    const pointsList = allPoints.map((p, i) => `[${i + 1}] ${p}`).join('\n');
    const result = await routeToAI({
        messages: [{ role: 'system', content: 'You are a clinical advisor. Respond with valid JSON only, with no surrounding text or markdown.' },
        { role: 'user', content: `Clinical note:\n${clinicalNote}\n\nPractice points:\n${pointsList}\n\nFor each practice point, decide whether it is relevant to this patient's clinical situation. Return a JSON object with two fields: "relevant" (an array of point numbers that apply to this patient) and "irrelevant" (an object mapping point numbers to a brief reason why they don't apply).` }]
    }, userId);
    try {
        return JSON.parse(result.content.trim().replace(/```json\n?|\n?```/g, ''));
    } catch (e) {
        return { relevant: allPoints.map((_, i) => i + 1), irrelevant: {} };
    }
}

/**
 * Filters relevant practice points to identify those with significant clinical impact.
 *
 * Second-pass filter that prioritizes practice points likely to have
 * meaningful impact on patient care.
 *
 * @async
 * @param {string} clinicalNote - The clinical note text
 * @param {Array<Object>} relevantPoints - Pre-filtered relevant points
 * @param {number} relevantPoints[].originalIndex - Original index in full list
 * @param {string} relevantPoints[].point - The practice point text
 * @param {string} userId - User ID for AI routing
 * @returns {Promise<Object>} Filter results
 * @returns {Array<number>} returns.important - Indices of important points
 * @returns {Object} returns.unimportant - Map of unimportant indices to reasons
 */
async function filterImportantPracticePoints(clinicalNote, relevantPoints, userId) {
    if (relevantPoints.length === 0) return { important: [], unimportant: {} };
    const pointsList = relevantPoints.map(p => `[${p.originalIndex}] ${p.point}`).join('\n');
    const messages = [{ role: 'system', content: 'You are a clinical advisor. Respond with valid JSON only, with no surrounding text or markdown.' }, { role: 'user', content: `Clinical note:\n${clinicalNote}\n\nPractice points:\n${pointsList}\n\nFor each practice point, consider whether acting on it would have a meaningful impact on this patient's care. Return a JSON object with two fields: "important" (an array of point numbers that would have significant clinical impact) and "unimportant" (an object mapping point numbers to a brief reason why they are low priority for this patient).` }];
    const result = await routeToAI({ messages }, userId);
    try {
        return JSON.parse(result.content.trim().replace(/```json\n?|\n?```/g, ''));
    } catch (e) {
        return { important: relevantPoints.map(p => p.originalIndex), unimportant: {} };
    }
}

/**
 * Loads accumulated learning/interpretation hints for a guideline from Firestore.
 *
 * The learning system stores insights from previous analysis attempts,
 * which helps improve future AI interpretations of the same guideline.
 *
 * @async
 * @param {string} guidelineId - The guideline document ID
 * @returns {Promise<Object|null>} Learning data or null if not found
 * @returns {string} returns.learningText - Accumulated learning prose
 * @returns {number} returns.version - Learning version number
 */
async function loadGuidelineLearning(guidelineId) {
    try {
        const learningDoc = await db.collection('guidelines').doc(guidelineId).collection('metadata').doc('interpretationHints').get();
        if (!learningDoc.exists) return null;
        const data = learningDoc.data();
        if (data.learningText) return { learningText: data.learningText, version: data.version || 1 };
        if (data.hints && data.hints.length > 0) return { learningText: data.hints.map(h => h.hint).join(' '), version: 0 };
        return null;
    } catch (error) {
        return null;
    }
}
const loadGuidelineHints = loadGuidelineLearning;

/**
 * Formats accumulated learning into a prompt section for AI context.
 *
 * @param {Object|null} learning - Learning object from loadGuidelineLearning
 * @param {string} learning.learningText - The learning content
 * @returns {string} Formatted prompt section or empty string
 */
function formatLearningForPrompt(learning) {
    if (!learning || !learning.learningText) return '';
    return `\n\nNotes from previous analyses of this guideline — please apply these lessons when interpreting it:\n\n${learning.learningText}\n`;
}

/**
 * Analyzes a clinical note against a specific guideline to generate suggestions.
 *
 * Two-step process:
 * 1. Identifies gaps in care (guideline recommendations not covered)
 * 2. Enriches suggestions with patient context and reasoning
 *
 * @async
 * @param {string} clinicalNote - The clinical note text
 * @param {string} guidelineContent - Full text content of the guideline
 * @param {string} guidelineTitle - Title of the guideline
 * @param {string} userId - User ID for AI routing
 * @param {string|null} [guidelineId=null] - Guideline ID for loading learning hints
 * @param {string|null} [targetModel=null] - Specific model to use
 * @returns {Promise<Object>} Analysis results
 * @returns {Object} returns.patientContext - Extracted patient demographics/context
 * @returns {Array<Object>} returns.suggestions - Clinical suggestions
 * @returns {string} returns.suggestions[].suggestion - The suggestion text
 * @returns {string} returns.suggestions[].priority - 'high', 'medium', or 'low'
 * @returns {string} returns.suggestions[].why - Reasoning for the suggestion
 * @returns {string} returns.suggestions[].verbatimQuote - Relevant guideline quote
 * @returns {Array<string>} returns.alreadyCompliant - Points already addressed
 */

/**
 * Per-point analysis path for analyzeGuidelineForPatient.
 * Runs one focused LLM call per practice point in parallel, preceded by a
 * lightweight applicability + patient-context check. Returns the same shape
 * as the single-pass fallback so all callers are unaffected.
 *
 * @param {string} clinicalNote
 * @param {string} guidelineContent
 * @param {string} guidelineTitle
 * @param {string} userId
 * @param {string} guidelineId
 * @param {string|null} model
 * @param {Array<{ id, name, description, advice }>} allPoints
 * @returns {Promise<{ guidelineApplicability, patientContext, suggestions, alreadyCompliant }>}
 */
async function analyzeGuidelineForPatientPerPoint(clinicalNote, guidelineContent, guidelineTitle, userId, guidelineId, model, allPoints) {
    // Step 1: Lightweight applicability + patient context — one cheap call before firing N per-point calls.
    let patientQualifies = true;
    let guidelineApplicability = { patientQualifies: true, targetPopulation: '', reason: '' };
    let patientContext = {};

    try {
        const preResult = await routeToAI({
            messages: [
                {
                    role: 'system',
                    content: `You are a clinical advisor deciding whether a clinical guideline is RELEVANT to a patient's current care — NOT whether any particular treatment is advisable for them.

A guideline is relevant ("patientQualifies": true) if its subject matter concerns this patient's condition, presentation, or the care being considered for them. Crucially, a guideline about an intervention (for example induction of labour) STILL applies to a patient for whom that intervention is being considered, requested, declined, or even contraindicated — because the guideline is precisely what tells the clinician how to act in those situations, including when NOT to proceed and what to do instead. Do NOT mark a patient as outside the population just because the intervention may be inadvisable, contraindicated, premature, or not yet indicated for them.

Set "patientQualifies": false ONLY when the guideline's subject is genuinely unrelated to this patient's presentation and care (for example, a thyroid-disorders guideline for a patient with no thyroid problem). When in any doubt, set it to true.

Return valid JSON only: { "patientQualifies": true|false, "targetPopulation": "...", "reason": "one sentence", "patientContext": {} }`
                },
                {
                    role: 'user',
                    content: `=== CLINICAL NOTE ===\n${clinicalNote}\n\n=== GUIDELINE: ${guidelineTitle} ===\n${guidelineContent.substring(0, 1500)}`
                }
            ]
        }, userId, model, 300);

        if (preResult?.content) {
            const pre = JSON.parse(preResult.content.trim().replace(/```json\n?|\n?```/g, ''));
            patientQualifies = pre.patientQualifies !== false;
            guidelineApplicability = {
                patientQualifies,
                targetPopulation: pre.targetPopulation || '',
                reason: pre.reason || ''
            };
            patientContext = pre.patientContext || {};
        }
    } catch (e) {
        // Pre-check failure is non-fatal — proceed with analysis
    }

    if (!patientQualifies) {
        console.log(`[PER-POINT] ${guidelineId} does not apply: ${guidelineApplicability.reason}`);
        return { guidelineApplicability, patientContext: {}, suggestions: [], alreadyCompliant: [] };
    }

    // Step 2: One call per practice point, all in parallel.
    // Use allSettled, NOT all: a single failed point evaluation (e.g. a transient provider
    // 403/timeout after fallback is exhausted) must not reject the whole batch and zero out
    // every suggestion for the guideline. Failed points are treated as not-applicable.
    const settled = await Promise.allSettled(
        allPoints.map(point => analyzePointForPatient(
            clinicalNote, guidelineContent, guidelineTitle, point, guidelineId, userId, model
        ))
    );
    const pointResults = settled.map((s, i) => s.status === 'fulfilled' ? s.value : {
        pointId: allPoints[i]?.id,
        pointName: allPoints[i]?.name,
        applies: false,
        reason: 'evaluation error: ' + ((s.reason && s.reason.message) || String(s.reason)).slice(0, 140)
    });
    const failedCount = settled.filter(s => s.status === 'rejected').length;
    if (failedCount) {
        console.warn(`[PER-POINT] ${guidelineId}: ${failedCount}/${allPoints.length} point evaluations failed (provider error) — continuing with the ${allPoints.length - failedCount} that succeeded`);
    }

    // Diagnostic: log every point's verdict and reason
    for (const r of pointResults) {
        const verdict = r.applies ? '✓ APPLIES' : '✗ does not apply';
        console.log(`[PER-POINT] ${guidelineId} | ${verdict} | "${(r.pointName || '').substring(0, 80)}" | reason: ${(r.reason || 'none').substring(0, 150)}`);
    }

    // Deterministic safety net: the model sometimes returns applies:true with a suggestion
    // that actually says the action is already done / no action is needed (instead of the
    // intended applies:false). Such "non-suggestions" must never reach the user. This catches
    // the message regardless of which model is judging.
    const NO_ACTION_RE = /\b(no (further )?action (is )?(required|needed|necessary)|already (been )?(documented|done|performed|measured|taken|completed|arranged)|no change (is )?(required|needed)|this (has been|is already) (done|documented|completed))\b/i;
    const isNonSuggestion = (text) => NO_ACTION_RE.test(String(text || ''));

    // Step 3: Collect applicable points as suggestions in the standard shape.
    // originalText comes directly from the per-point LLM call (no separate batch call needed).
    const suggestions = pointResults
        .filter(r => r.applies && r.suggestion && !isNonSuggestion(r.suggestion))
        .map(r => {
            const s = {
                suggestion: r.suggestion,
                priority: r.priority || 'low',
                reasoning: r.reason || '',
                why: r.why || '',
                verbatimQuote: r.verbatimQuote || '',
                evidence: r.evidence || '',
                sourceGuidelineId: r.sourceGuidelineId || guidelineId
            };
            // Only include originalText if it's a verbatim match in the clinical note
            if (r.originalText && clinicalNote.includes(r.originalText)) {
                s.originalText = r.originalText;
                s.category = 'modification';
                console.log(`[PER-POINT] Suggestion "${r.suggestion.substring(0, 60)}..." replaces: "${r.originalText.substring(0, 60)}..."`);
            }
            return s;
        });

    console.log(`[PER-POINT] ${guidelineId}: ${allPoints.length} points evaluated, ${suggestions.length} applicable`);

    return { guidelineApplicability, patientContext, suggestions, alreadyCompliant: [] };
}

// Helper: analyze note structure to identify existing sections and their order
async function analyzeNoteStructure(clinicalNote, userId) {
    const structurePrompt = `Analyze this clinical note and identify its main sections. List only the sections that actually exist in the note.

Possible section types: History/Background, Examination/Physical Findings, Investigations/Results, Assessment/Impression, Plan/Management, Other

For each section found, note:
1. Its title/heading (as it appears in the note)
2. What type it is (from the list above)
3. Its approximate position in the note (beginning/middle/end)

Respond with valid JSON only:
{ "sections": [{ "title": "...", "type": "...", "position": "..." }] }`;

    const result = await routeToAI({ messages: [{ role: 'user', content: `Clinical note:\n\n${clinicalNote}\n\n${structurePrompt}` }] }, userId);

    if (!result?.content) return { sections: [] };

    try {
        return JSON.parse(result.content.trim().replace(/```json\n?|\n?```/g, ''));
    } catch (e) {
        return { sections: [] };
    }
}

async function analyzeGuidelineForPatient(clinicalNote, guidelineContent, guidelineTitle, userId, guidelineId = null, targetModel = null, practicePointsWithSerials = null) {
    // Per-point path: when practice points are synced, run one focused call per point in parallel.
    // This produces cleaner verdicts and allows calibrated advice to be applied with full attention.
    if (guidelineId) {
        const allPoints = practicePointsWithSerials || await loadAllPracticePoints(guidelineId);
        if (allPoints.length > 0) {
            return analyzeGuidelineForPatientPerPoint(
                clinicalNote, guidelineContent, guidelineTitle, userId, guidelineId, targetModel, allPoints
            );
        }
    }

    // Analyze note structure upfront to enable smart placement
    const noteStructure = await analyzeNoteStructure(clinicalNote, userId);
    const sectionsContext = noteStructure.sections.length > 0
        ? `\nCurrent sections in note (in order): ${noteStructure.sections.map(s => s.title).join(', ')}`
        : '\nNote has minimal section structure — suggestions may need to create new sections';

    // Fallback single-pass: for guidelines without synced practice points.
    let hintsText = '';
    if (guidelineId) {
        const [learning, pointAdvice] = await Promise.all([
            loadGuidelineLearning(guidelineId),
            loadPracticePointAdvice(guidelineId)
        ]);
        if (learning) hintsText = formatLearningForPrompt(learning);
        if (pointAdvice.length > 0) hintsText += formatPointAdviceForPrompt(pointAdvice);
    }

    // Single-pass prompt: identify gaps, enrich with patient-specific reasoning and verbatim
    // quotes, extract patient context, identify already-compliant items, AND provide smart placement
    const systemPrompt = `You are a clinical advisor reviewing a clinical note against a guideline. In a single pass:
1. Identify care gaps — recommendations from the guideline not addressed in the clinical note.
2. For each gap: write a concise actionable suggestion, indicate priority (high/medium/low), briefly explain your reasoning, explain why it matters for THIS specific patient ("why"), provide an EXACT verbatim copy-paste from the GUIDELINE TEXT ONLY as "verbatimQuote" (do not paraphrase, and do NOT quote from the clinical note — the quote must be a sentence or phrase that physically appears in the guideline content), and set "sourceGuidelineId" to the guideline ID supplied.
3. Determine PLACEMENT for each suggestion:
   - If an appropriate existing section exists in the note, specify which section
   - If no suitable section exists, create a new section with a clear, clinically relevant title
   - NEVER default to appending at the end — always be intentional about placement
4. Extract key patient context from the clinical note.
5. Identify guideline recommendations that ARE already addressed in the note.

APPLICABILITY CHECK (you MUST complete this first — populate "guidelineApplicability" before generating any suggestions):
1. Identify the target population this guideline is written for (e.g. "patients with a previous caesarean section", "patients with BMI ≥30", "patients with COVID-19").
2. Determine whether this specific patient belongs to that target population.
3. Set "patientQualifies" to true or false and write a one-sentence "reason".
- If patientQualifies is FALSE: set suggestions to [] and stop. Do not generate any suggestions.
- If patientQualifies is TRUE: proceed, but still skip any individual sections that do not apply (e.g. COVID pathway for a non-COVID patient, BMI ≥40 section for a patient with BMI 24).

CRITICAL: verbatimQuote must be copied word-for-word from the "=== GUIDELINE CONTENT ===" section below. Never quote from the clinical note section.

PRACTICE POINTS: For each suggestion, identify which practice point it corresponds to by its SERIAL NUMBER (if any). If a suggestion maps to a practice point, include "practicePointSerialNumber": N in the suggestion object.

PLACEMENT GUIDANCE: For each suggestion, output:
- "section": name of existing section OR new section to create (e.g. "Examination", "Investigations", "Plan")
- "createSection": true/false — whether to create this section if it doesn't exist
- "newSectionTitle": only if createSection is true — the section title to create
- "sectionReason": brief explanation of why it belongs in this section
- "placementLogic": optional — any specific context or anchor text (e.g. "place after vital signs", "at the beginning of plan")

Respond with valid JSON only, using this structure:
{ "guidelineApplicability": { "targetPopulation": "...", "patientQualifies": true, "reason": "..." }, "patientContext": {}, "suggestions": [{ "suggestion": "...", "priority": "high|medium|low", "reasoning": "...", "why": "...", "verbatimQuote": "...", "sourceGuidelineId": "...", "practicePointSerialNumber": 3, "section": "Investigations", "createSection": false, "sectionReason": "Blood tests document investigative results", "placementLogic": "after imaging" }], "alreadyCompliant": [] }`;

    // Build practice points list with serial numbers
    let practicePointsList = '';
    if (practicePointsWithSerials && practicePointsWithSerials.length > 0) {
        practicePointsList = '\n=== PRACTICE POINTS (by serial number) ===\n';
        practicePointsWithSerials.forEach((pp, idx) => {
            const serial = pp.serial || (idx + 1);
            practicePointsList += `${serial}. ${pp.name}\n`;
        });
        practicePointsList += '\nWhen generating suggestions, identify which practice point (by serial number) each suggestion relates to, if any.\n';
    }

    const userPrompt = `=== CLINICAL NOTE (do NOT quote from this section) ===\n${clinicalNote}${sectionsContext}\n\n=== GUIDELINE CONTENT (verbatimQuote must come from here only) ===\nGuideline ID: ${guidelineId || 'unknown'}\nGuideline title: ${guidelineTitle}\n\n${guidelineContent}${practicePointsList}\n\n${hintsText ? `Previous notes on this guideline:\n${hintsText}\n` : ''}Identify care gaps and for each include an exact verbatim quote from the guideline content above. Set sourceGuidelineId to the guideline ID provided above. For each suggestion, determine intelligent placement within existing sections or propose creating a new section. Also identify its practice point serial number (if it maps to one).`;

    const result = await routeToAI({ messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }] }, userId, targetModel);

    if (!result || !result.content) return { patientContext: {}, suggestions: [], alreadyCompliant: [] };

    try {
        const parsed = JSON.parse(result.content.trim().replace(/```json\n?|\n?```/g, ''));

        // Enforce applicability check — discard suggestions if guideline does not apply to this patient
        if (parsed.guidelineApplicability?.patientQualifies === false) {
            console.log(`[APPLICABILITY] Guideline ${guidelineId} does not apply to this patient: ${parsed.guidelineApplicability.reason}`);
            parsed.suggestions = [];
            parsed.alreadyCompliant = [];
        }

        // Normalise sourceGuidelineId on every suggestion
        if (parsed.suggestions && Array.isArray(parsed.suggestions)) {
            parsed.suggestions.forEach(s => {
                if (guidelineId && s.sourceGuidelineId !== guidelineId) {
                    s.sourceGuidelineId = guidelineId;
                }
                if (!s.sourceGuidelineId) s.sourceGuidelineId = guidelineId;
            });
        }

        return parsed;
    } catch (e) {
        return { patientContext: {}, suggestions: [], alreadyCompliant: [] };
    }
}

/**
 * Evaluates the quality of AI-generated suggestions against a guideline.
 *
 * Used for quality assurance and learning improvement. Calculates
 * precision (correctness) and recall (completeness) scores.
 *
 * @async
 * @param {string} clinicalNote - The clinical note text
 * @param {string} guidelineContent - Full guideline text
 * @param {string} guidelineTitle - Guideline title
 * @param {Array<Object>} suggestions - Suggestions to evaluate
 * @param {Array<string>} alreadyCompliant - Points identified as compliant
 * @param {string} userId - User ID for AI routing
 * @returns {Promise<Object>} Evaluation results
 * @returns {number} returns.recallScore - Completeness score (0-1)
 * @returns {number} returns.precisionScore - Accuracy score (0-1)
 * @returns {Object} returns.counts - Count statistics
 * @returns {Array} returns.missedRecommendations - Recommendations AI missed
 * @returns {Array} returns.suggestionEvaluations - Per-suggestion verdicts
 * @returns {Array} returns.falseNegatives - Incorrectly marked as compliant
 */
async function evaluateSuggestions(clinicalNote, guidelineContent, guidelineTitle, suggestions, alreadyCompliant, userId) {
    const promptConfig = (global.prompts || require('../../prompts.json'))['evaluateSuggestions'];
    const systemPrompt = promptConfig?.system_prompt || `You are a clinical guideline expert evaluating whether a set of AI-generated suggestions correctly reflects what a guideline recommends for a specific patient. Respond with valid JSON only, with no surrounding text or markdown.`;
    const userPrompt = (promptConfig?.prompt || `Clinical note:\n{{clinicalNote}}\n\nGuideline title: {{guidelineTitle}}\n\nGuideline content:\n{{guidelineContent}}\n\nSuggestions generated by the AI:\n{{suggestions}}\n\nPoints the AI identified as already compliant:\n{{alreadyCompliant}}\n\nPlease evaluate whether the suggestions are accurate and complete relative to the guideline, and whether any compliant items were incorrectly classified.`)
        .replace('{{clinicalNote}}', clinicalNote).replace('{{guidelineTitle}}', guidelineTitle).replace('{{guidelineContent}}', guidelineContent)
        .replace('{{suggestions}}', JSON.stringify(suggestions)).replace('{{alreadyCompliant}}', JSON.stringify(alreadyCompliant));

    const result = await routeToAI({ messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }] }, userId);
    if (!result || !result.content) {
        return { recallScore: 0, precisionScore: 0, completenessScore: 0, accuracyScore: 0, counts: { suggestionsTotal: 0, correct: 0, incorrect: 0, redundant: 0, missed: 0, falseNegatives: 0 }, missedRecommendations: [], suggestionEvaluations: [], falseNegatives: [], error: 'No response from evaluator' };
    }
    try {
        const parsed = JSON.parse(result.content.trim().replace(/```json\n?|\n?```/g, ''));
        const counts = parsed.counts || { suggestionsTotal: parsed.suggestionEvaluations?.length || 0, correct: parsed.suggestionEvaluations?.filter(e => e.verdict === 'correct').length || 0, incorrect: parsed.suggestionEvaluations?.filter(e => e.verdict === 'incorrect').length || 0, redundant: parsed.suggestionEvaluations?.filter(e => e.verdict === 'redundant').length || 0, missed: parsed.missedRecommendations?.length || 0, falseNegatives: parsed.falseNegatives?.length || 0 };
        const suggestionsTotal = counts.suggestionsTotal || 1;
        const recallScore = parsed.recallScore ?? parsed.completenessScore ?? 0;
        const precisionScore = parsed.precisionScore ?? parsed.accuracyScore ?? 0;
        return { ...parsed, recallScore, precisionScore, counts, completenessScore: recallScore, accuracyScore: precisionScore };
    } catch (e) {
        return { recallScore: 0, precisionScore: 0, completenessScore: 0, accuracyScore: 0, counts: { suggestionsTotal: 0 }, error: 'Failed to parse evaluation' };
    }
}

/**
 * Generates suggested improvements to AI prompts based on evaluation results.
 *
 * Analyzes patterns in evaluation failures to recommend prompt modifications.
 *
 * @async
 * @param {string} currentPrompt - The current prompt being evaluated
 * @param {Array<Object>} evaluationResults - Array of evaluation results
 * @param {number} avgRecall - Average recall score across evaluations
 * @param {number} avgPrecision - Average precision score across evaluations
 * @param {number} avgLatency - Average latency in milliseconds
 * @param {string} userId - User ID for AI routing
 * @param {Object} [additionalMetrics={}] - Extra metrics to consider
 * @returns {Promise<Object>} Improvement suggestions
 * @returns {Object} returns.analysis - Pattern analysis
 * @returns {Array} returns.suggestedChanges - Recommended prompt changes
 */
async function generatePromptImprovements(currentPrompt, evaluationResults, avgRecall, avgPrecision, avgLatency, userId, additionalMetrics = {}) {
    const promptConfig = (global.prompts || require('../../prompts.json'))['generatePromptImprovements'];
    const systemPrompt = promptConfig?.system_prompt || `You are an expert at improving AI prompts for clinical use. Analyse the evaluation results and suggest concrete changes to the prompt that would improve performance.

DESIGN PHILOSOPHY — you MUST follow these principles when rewriting prompts:
1. EXPRESS RULES AS GENERALISABLE REASONING PRINCIPLES, never as specific examples or enumerated cases. Specific example lists grow unwieldy, miss edge cases, and confuse the model into pattern-matching instead of reasoning.
   - BAD: "If the note says 'vital signs within normal limits' or 'obs stable', blood pressure is PRESENT"
   - GOOD: "Use clinical judgement — if a statement logically implies a value is present, treat it as documented"
2. The completeness check prompt is designed for a reasoning LLM to use common sense and clinical judgement. Do NOT add condition-specific checklists, specific criteria lists, or enumerated documentation requirements.
3. Improvements should refine the reasoning framework (e.g. how the model thinks about what counts as "present" or "relevant"), not add content-specific rules.

CRITICAL: Your response MUST include a "newSystemPrompt" field containing the COMPLETE rewritten prompt with your improvements applied. Do not just describe changes — produce the full improved prompt text.

Respond with valid JSON only, with no surrounding text or markdown. The JSON must include these fields:
- "analysis": { "keyPatterns": [...], "rootCauses": [...], "strengthsToPreserve": [...] }
- "suggestedChanges": [{ "changeType": "add|modify|remove", "section": "...", "rationale": "...", "newText": "..." }]
- "newSystemPrompt": "<the COMPLETE rewritten prompt with all improvements applied>"
- "expectedImprovement": { "recall": "...", "precision": "...", "tradeoffs": "..." }`;
    const evaluationSummary = evaluationResults.map((evaluationItem, idx) => ({ scenario: idx + 1, recall: evaluationItem.recallScore, precision: evaluationItem.precisionScore, assessment: evaluationItem.overallAssessment }));
    const userPrompt = (promptConfig?.prompt || `The prompt being evaluated:\n{{currentPrompt}}\n\nEvaluation results across test cases:\n{{evaluationResults}}\n\nOverall recall score: {{avgRecall}}\nOverall precision score: {{avgPrecision}}\n\nBased on these results, suggest specific changes and produce the COMPLETE improved prompt in the "newSystemPrompt" field.`)
        .replace('{{currentPrompt}}', JSON.stringify(currentPrompt)).replace('{{evaluationResults}}', JSON.stringify(evaluationSummary))
        .replace('{{avgRecall}}', avgRecall).replace('{{avgPrecision}}', avgPrecision);

    const result = await routeToAI({ messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }] }, userId);
    if (!result || !result.content) return { analysis: { keyPatterns: [], rootCauses: [] }, suggestedChanges: [], error: 'No response' };
    try {
        return JSON.parse(result.content.trim().replace(/```json\n?|\n?```/g, ''));
    } catch (e) {
        return { analysis: { keyPatterns: [], rootCauses: [] }, suggestedChanges: [], error: 'Failed to parse' };
    }
}

/**
 * Extracts lessons learned from an evaluation for future improvement.
 *
 * Generates prose summaries of what went wrong and how to avoid
 * similar mistakes in future analyses.
 *
 * @async
 * @param {string} guidelineTitle - Title of the evaluated guideline
 * @param {Object} evaluation - Evaluation results
 * @param {Array<Object>} suggestions - The suggestions that were evaluated
 * @param {string} userId - User ID for AI routing
 * @returns {Promise<Object|null>} Lessons learned or null if no issues found
 * @returns {string} returns.learningText - Prose summary of lessons
 */
/**
 * Extracts per-guideline interpretation hints from an evaluation.
 *
 * Produces a concise prose "cheat sheet" focused on what the AI needs to know
 * when applying THIS specific guideline — covering edge cases missed, recommendations
 * over-applied, and nuances the AI failed to recognise. Stored per-guideline in
 * Firestore and injected automatically on future analyses of the same guideline.
 *
 * Only runs when the evaluation found missed recommendations, incorrect suggestions,
 * or redundant suggestions (over-suggestions that shouldn't have been made).
 *
 * @async
 * @param {string} guidelineTitle - Title of the guideline being evaluated
 * @param {Object} evaluation - Output from evaluateSuggestions
 * @param {Array} suggestions - Suggestions that were evaluated
 * @param {string} userId - User ID for AI routing
 * @returns {Promise<Object|null>} { learningText } or null if no issues found
 */
async function extractGuidelineLessons(guidelineTitle, evaluation, suggestions, userId) {
    const hasIssues = (evaluation.missedRecommendations?.length || 0) > 0
        || evaluation.suggestionEvaluations?.some(s => s.verdict === 'incorrect' || s.verdict === 'redundant')
        || false;
    if (!hasIssues) return null;
    const systemPrompt = `You are a clinical guideline expert reviewing how well an AI applied a specific guideline to a patient case. Write a concise "interpretation guide" in plain prose — two or three short paragraphs — describing what the AI needs to know when applying this guideline to future patients. Focus on: (1) recommendations it missed and why, (2) suggestions it made that were redundant or incorrect and under what conditions those mistakes occur, (3) any nuances in how this guideline should be applied that were not handled correctly. Do not describe the evaluation process itself — write directly about the guideline and how to apply it correctly.`;
    const userPrompt = `Guideline: ${guidelineTitle}\n\nEvaluation results:\n${JSON.stringify(evaluation, null, 2)}\n\nSuggestions that were evaluated:\n${JSON.stringify(suggestions, null, 2)}\n\nWrite the interpretation guide for this guideline based on what went wrong.`;
    const result = await routeToAI({ messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }] }, userId);
    if (!result || !result.content) return null;
    return { learningText: result.content.trim() };
}

/**
 * Generates or improves the application guidance for a single practice point
 * based on calibration failures. Replaces (rather than appends to) existing advice.
 *
 * @param {{ id, name, description }} point - The practice point
 * @param {string|null} currentAdvice - Existing advice to improve, or null for first run
 * @param {Array<{ transcript, suggestions, verdict, shouldApply }>} scenarios
 *   Each entry is one calibration scenario that involved this point
 * @param {string} guidelineTitle
 * @param {string} userId
 * @returns {Promise<string|null>} Improved advice text, or null on failure
 */
async function evolvePointAdvice(point, currentAdvice, scenarios, guidelineTitle, userId) {
    const scenarioDescriptions = scenarios.map((s, i) => {
        const suggestionsText = Array.isArray(s.suggestions) && s.suggestions.length
            ? s.suggestions.map((t, j) => `  [S${j+1}] ${t.suggestion || t.action || JSON.stringify(t)}`).join('\n')
            : '  (no suggestions made)';
        const shouldLabel = s.shouldApply ? 'SHOULD be suggested here' : 'should NOT be suggested here';
        const verdictLabel = { hit: 'Hit (correct)', miss: 'Miss (AI failed to suggest)', correct_absence: 'Correct absence', false_positive: 'False positive (AI wrongly suggested)' }[s.verdict] || s.verdict;
        const reasonLine = s.modelReason ? `\nModel's reasoning: ${s.modelReason}` : '';
        return `This point ${shouldLabel}:\nClinical note: ${s.transcript}\nAI suggested:\n${suggestionsText}\nVerdict: ${verdictLabel}${reasonLine}`;
    }).join('\n\n---\n\n');

    const systemPrompt = `You are improving the application guidance for a specific clinical practice point. Write precise, conditional guidance that tells an AI clinician decision support system when to raise this recommendation, when not to, and what contextual factors determine applicability. Your output will be injected verbatim into future analysis prompts — write it as direct instruction to the AI, not as a description of what to do.`;

    const userPrompt = `Guideline: ${guidelineTitle}

Practice point: ${point.name}
Description: ${point.description || point.name}
${currentAdvice ? `\nCurrent guidance (rewrite this with improvements):\n${currentAdvice}\n` : ''}
Calibration evidence — what actually went wrong:
${scenarioDescriptions}

Write improved application guidance for this specific practice point. Structure it exactly as:
SUGGEST WHEN: [specific clinical conditions that warrant raising this recommendation]
DO NOT SUGGEST WHEN: [conditions that make it inapplicable, premature, or already handled]
KEY NUANCE: [timing, staging, or contextual factors — 1-2 sentences]

Important distinction: SUGGEST WHEN describes when to RAISE the recommendation, not when to PERFORM the action. These are different. For example, a follow-up scan at 32 weeks should be recommended as soon as the condition is diagnosed (even at 20 weeks), not only once the patient reaches 32 weeks. Scheduling, planning, and discussing future actions are always appropriate before the action is due.

Be specific and concrete. Describe clinical situations in terms of clinical facts (e.g., "first primary episode near term", "asymptomatic with known recurrent history"). Total length: 3-5 sentences.`;

    // Route via the user's model preference with fallback (no pinned provider).
    const result = await routeToAI({ messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
    ]}, userId, null);

    return result?.content?.trim() || null;
}

/**
 * Loads all practice points with their calibrated advice from practicePointMetrics.
 * Returns only points that have non-null advice.
 *
 * @param {string} guidelineId
 * @returns {Promise<Array<{ id, name, advice }>>}
 */
async function loadPracticePointAdvice(guidelineId) {
    try {
        const snap = await db.collection('guidelines').doc(guidelineId).collection('practicePointMetrics').get();
        return snap.docs
            .map(d => ({ id: d.id, name: d.data().name || d.id, advice: d.data().advice || null }))
            .filter(p => p.advice);
    } catch {
        return [];
    }
}

/**
 * Loads ALL practice points from practicePointMetrics regardless of whether they have advice.
 * Used by the per-point analysis path.
 *
 * @param {string} guidelineId
 * @returns {Promise<Array<{ id, name, description, advice }>>}
 */
async function loadAllPracticePoints(guidelineId) {
    try {
        // Primary source: practicePoints subcollection (from extraction / context evolution)
        const guidelineRef = db.collection('guidelines').doc(guidelineId);
        let snap = await guidelineRef.collection('practicePoints').orderBy('order', 'asc').get();
        if (snap.empty) {
            // Fallback: practicePointMetrics (legacy calibration sync from auditableElements)
            snap = await guidelineRef.collection('practicePointMetrics').get();
            return snap.docs.map(d => ({
                id: d.id,
                name: d.data().name || d.id,
                description: d.data().description || '',
                advice: d.data().advice || null
            }));
        }

        // Map practicePoints docs — also check for calibration advice in practicePointMetrics
        const metricsSnap = await guidelineRef.collection('practicePointMetrics').get();
        const adviceByName = new Map();
        for (const d of metricsSnap.docs) {
            const data = d.data();
            if (data.advice) adviceByName.set((data.name || '').toLowerCase().trim(), data.advice);
        }

        return snap.docs.map(d => {
            const data = d.data();
            const text = data.text || data.name || d.id;
            return {
                id: d.id,
                name: text,
                description: text,
                advice: adviceByName.get(text.toLowerCase().trim()) || null
            };
        });
    } catch {
        return [];
    }
}

/**
 * Strict check: does `quote` appear verbatim in `sourceText`? Normalises only whitespace,
 * curly quotes and dashes so trivial formatting differences still count — it does NOT
 * paraphrase, fuzzy-match or substitute. A quote is genuine or it is not.
 * @param {string} quote
 * @param {string} sourceText
 * @returns {boolean}
 */
function quoteAppearsInSource(quote, sourceText) {
    if (!quote || !sourceText) return false;
    const norm = (s) => String(s)
        .toLowerCase()
        .replace(/[‘’“”]/g, "'")
        .replace(/[–—]/g, '-')
        .replace(/\s+/g, ' ')
        .trim();
    const nq = norm(quote);
    return nq.length > 0 && norm(sourceText).includes(nq);
}

/**
 * Extract a verbatim quote from guideline content that grounds a single practice point.
 * Used by the backfill endpoint to pre-compute and store quotes on every practice point,
 * so runtime analysis uses the stored quote rather than re-extracting per session.
 *
 * @param {{ name: string, description?: string }} point
 * @param {string} guidelineContent
 * @param {string} userId
 * @param {string|null} [model]
 * @returns {Promise<string>} Verified verbatim quote, or '' if none could be extracted
 */
async function extractPracticePointQuote(point, guidelineContent, userId, model = null) {
    if (!guidelineContent || !point?.name) return '';
    // Use (almost) the whole guideline, not the first 16k — recommendations often live
    // deep in the document (e.g. GDM serial-scan schedule "Book serial scans from 28/40."
    // sits ~char 24k). Capping at 16k made later-page quotes unrecoverable. 200k matches
    // the window the per-point analyzer is shown.
    const source = String(guidelineContent).slice(0, 200000);

    const systemPrompt = `You extract exact quotes. Given a practice point and the source guideline text, return the wording from the guideline that states this practice point's recommendation, copied character-for-character. Never paraphrase, summarise, shorten, or compose. If the exact words are not present in the guideline text, return an empty string.`;

    const userPrompt = `PRACTICE POINT:
Name: ${point.name}
${point.description ? `Description: ${point.description}` : ''}

=== GUIDELINE TEXT ===
${source}

Return JSON only:
{ "verbatimQuote": "the exact sentence or phrase from the GUIDELINE TEXT that states this practice point's recommendation, copied word-for-word; empty string if no exact wording covers it" }`;

    try {
        const result = await routeToAI({
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt }
            ]
        }, userId, model, 800, 'evaluation:backfillQuote');
        if (!result?.content) return '';
        const raw = result.content.trim().replace(/```json\n?|\n?```/g, '');
        let parsed;
        try { parsed = JSON.parse(raw); }
        catch {
            const m = raw.match(/"verbatimQuote"\s*:\s*"([^"]*(?:\\.[^"]*)*)"/);
            if (m) parsed = { verbatimQuote: m[1] };
        }
        const quote = typeof parsed?.verbatimQuote === 'string' ? parsed.verbatimQuote.trim() : '';
        if (!quote) return '';
        if (!quoteAppearsInSource(quote, source)) return '';
        return quote;
    } catch (e) {
        console.warn('[QUOTE-BACKFILL] extraction failed:', e.message);
        return '';
    }
}

/**
 * Focused re-extraction: when the per-point call paraphrased instead of copying, ask the
 * model once more with the single job of copying exact wording out of the sources. The
 * caller still re-verifies the result with quoteAppearsInSource — this only improves the
 * chance of recovering a genuine quote rather than blanking it.
 * @returns {Promise<{ verbatimQuote: string, evidence: string }>}
 */
async function reExtractQuotes(suggestionText, guidelineContent, transcript, userId, model) {
    const systemPrompt = `You extract exact quotes. Given a clinical recommendation, the guideline text it came from, and a clinical note, you return wording that already exists in those sources, copied character-for-character. You never paraphrase, summarise, shorten, or compose. If the exact words are not present in a source, you return an empty string for that field.`;

    const userPrompt = `RECOMMENDATION:
${suggestionText}

=== GUIDELINE TEXT ===
${(guidelineContent || '').substring(0, 200000)}

=== CLINICAL NOTE ===
${transcript || ''}

Return JSON only:
{
  "verbatimQuote": "the exact sentence or phrase from the GUIDELINE TEXT that states this recommendation, copied word-for-word; empty string if no exact wording in the guideline text covers it",
  "evidence": "the exact phrase from the CLINICAL NOTE showing this recommendation applies to this patient, copied word-for-word; empty string if the note contains no such phrase"
}`;

    try {
        const result = await routeToAI({
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt }
            ]
        }, userId, model, 800, 'evaluation:reExtractQuote');
        if (!result?.content) return { verbatimQuote: '', evidence: '' };
        const parsed = JSON.parse(result.content.trim().replace(/```json\n?|\n?```/g, ''));
        return {
            verbatimQuote: typeof parsed.verbatimQuote === 'string' ? parsed.verbatimQuote : '',
            evidence: typeof parsed.evidence === 'string' ? parsed.evidence : ''
        };
    } catch (e) {
        console.warn('[VERBATIM-VERIFY] re-extraction failed:', e.message);
        return { verbatimQuote: '', evidence: '' };
    }
}

/**
 * Evaluates whether a single practice point applies to a patient and, if so,
 * generates one actionable suggestion. Designed to be called in parallel across
 * all practice points for a guideline — one focused LLM call per point.
 *
 * @param {string} transcript - Clinical note
 * @param {string} guidelineContent - Full guideline text
 * @param {string} guidelineTitle - Guideline title
 * @param {{ id, name, description, advice }} point - The practice point (advice may be null)
 * @param {string|null} guidelineId
 * @param {string} userId
 * @param {string|null} [model]
 * @returns {Promise<{ pointId, pointName, applies, reason, suggestion, priority, why, verbatimQuote, sourceGuidelineId }>}
 */
async function analyzePointForPatient(transcript, guidelineContent, guidelineTitle, point, guidelineId, userId, model = null) {
    const adviceSection = point.advice
        ? `\n=== APPLICATION GUIDANCE (calibrated from training) ===\n${point.advice}\n`
        : '';

    // Curated applicability context (population + care stage) — the authoritative test of
    // WHETHER this point applies. Without it the model infers applicability from a long PP
    // name and leaks across populations/stages (e.g. firing a pre-existing-diabetes point for
    // a gestational-diabetes patient). These fields are populated on every synced PP.
    const applicabilitySection = (point.condition || point.applicabilityContext)
        ? `\n=== WHEN THIS PRACTICE POINT APPLIES (authoritative) ===\n${point.condition ? `Condition: ${point.condition}\n` : ''}${point.applicabilityContext ? `${point.applicabilityContext}\n` : ''}`
        : '';

    const systemPrompt = `You are a clinical decision support assistant. Given a clinical note, a single practice point from a clinical guideline, and any calibrated guidance on applying it, you decide whether that practice point applies to this patient right now — and if it does, you write one precise, actionable suggestion. You reason only from what the note actually documents, and you never invent patient facts to make a practice point fit.

Write in British English throughout — spellings, clinical terminology, and units of measurement. The deployment context is UK practice.`;

    const userPrompt = `=== CLINICAL NOTE ===
${transcript}

=== GUIDELINE: ${guidelineTitle} (ID: ${guidelineId || 'unknown'}) ===
${guidelineContent.substring(0, 200000)}${guidelineContent.length > 200000 ? '\n...[truncated]' : ''}

=== PRACTICE POINT ===
Name: ${point.name}
Description: ${point.description || point.name}
${applicabilitySection}${adviceSection}
Decide whether this practice point applies to this patient right now, then return JSON.

Two things both have to be true for it to apply. First, the patient genuinely meets the conditions the practice point is written for — check its preconditions against what the note documents, and don't reshape the patient to fit. When a "WHEN THIS PRACTICE POINT APPLIES" section is provided above, treat it as the authoritative statement of which population and which stage of care this point is for: if the patient belongs to a different population (for example a different condition or a different subtype of the same condition) or is at a different stage of care than that section specifies, the point does NOT apply — even if the action itself looks relevant. A point written for an uncomplicated case does not apply to a complicated one; a postnatal point does not apply to an antenatal note; a point for one patient subtype does not apply to a different one; a point for one stage or acuity of care does not apply at another. Second, the action is still genuinely outstanding — not already done, arranged, or in progress, with the action or arrangement EXPLICITLY documented in the note. Do not infer that an action was performed because it is standard for the setting (e.g. do not assume blood pressure was measured because the patient attended triage, or that urinalysis was done because the patient was admitted). Documentation PPs (measurements, examinations, counselling, risk assessment) require explicit textual evidence of the specific element being documented. For action PPs (arranging an investigation, escalating, prescribing), the action or its arrangement must be named in the note. If the note is silent on a required element, the action is outstanding and the practice point applies.

"Outstanding" means missing, not unmade. If the note documents that the clinician has considered the action and explicitly recorded a reason for not doing it — a contraindication, a competing patient priority, a clinical decision against it — the practice point does not apply. A documented why-not is different from the action simply not appearing in the note: surfacing it again would override the clinician's reasoning rather than fill a gap. Read the note for these explicit rule-outs as carefully as you read it for performed actions.

Equally, if the note documents that the action has been done, started, prescribed, arranged, referred or booked, treat the action itself as satisfied — even where secondary detail (exact dose, route, timing or frequency) is omitted. A satisfied action is NOT an outstanding gap: return applies:false for it. Do NOT return applies:true with a suggestion that merely states the item is already done, already documented, or that no further action is required — if there is nothing genuinely outstanding to act on, the practice point does not apply. The only exception is a genuinely missing secondary detail that is itself worth recording, in which case applies:true and the suggestion must ask ONLY for that specific residual detail (never restate the whole already-completed action). Treat "arranged", "referred" or "booked" as satisfying a practice point whose action is to arrange, refer or book that step.

Before deciding "applies", read the documented plan to determine which management pathway the team is on — surgical or conservative, inpatient or outpatient, active or expectant, interventional or watchful, early or late in the relevant timeline. A practice point premised on a different pathway, stage, or timing from the one the plan describes does not apply, regardless of whether its specific action has been ticked off. The question isn't only "is this action documented?" — it is "does this action belong on the path, at the stage, this patient is on?" Practice points whose action is premised on something happening that the note neither documents nor plans — a drug being given, a procedure underway, a finding being present, a clinic the patient could realistically still attend — do not apply.

Draw a hard line between an intervention that is being CONSIDERED, requested, offered, discussed, planned or booked, and one that is actually being CARRIED OUT. While an intervention is only being decided on, the applicable points are the decision-stage ones — whether to proceed, how to counsel, what to offer, arrange or document. The points that govern the CONDUCT of that intervention — its preparation and on-admission/on-commencement steps, its in-progress monitoring, its dosing and titration, and its later phases — do NOT apply until the note shows the intervention is genuinely underway or imminent (for example the patient admitted for it, the agent given, the infusion running, that step actually reached). A note that an intervention is planned, requested or booked is not evidence that its internal steps are now due, and surfacing them prematurely is wrong even though the topic matches.

When a practice point names several required elements — a set of observations, a list of risk factors to document, multiple counselling points, components of an examination, items in an investigation panel — check each named element separately against the clinical note. The goal is 100% compliance with the practice point: every named element documented. If ANY element is missing or not documented, the practice point still applies and you must generate a suggestion that asks for the specific residual elements that are missing. Do not mark the practice point as not applying just because some elements are present; partial documentation is not the same as documentation. Your suggestion must name the missing elements specifically (e.g. "document BP and urinalysis" not "complete observations"), so the clinician knows exactly which residuals to add. Do not re-request elements already documented. Only mark the practice point as not applying if ALL named elements are already documented in the note, or if the clinician has explicitly recorded a reason for not doing each missing element.

Anchor everything in what the note actually says. A practice point only applies if you can point to specific text in the clinical note that triggers it — the documented finding, history, or plan item that brings this patient within its scope. If no such text exists, it does not apply: return applies: false rather than reaching for an assumption. And never state or assume a patient fact the note does not document — a blood group, a weight, a measurement, a test result, a history. Where a recommendation depends on a value the note does not give, the suggestion is to obtain or check that value — never to assert it, and never to act on an assumed one.

If it applies, write one concise suggestion a clinician can act on, specific to this patient. Keep it safe: do not offer an option that is contraindicated for this patient, even as an alternative.

Stay within the scope of THIS practice point. The guideline text is provided so you can quote the line this point comes from, not so you can fold in adjacent recommendations from elsewhere in the document. The suggestion you write must ask for the same single thing the practice point names, no more. Do not widen it into the surrounding workflow or policy section the point is part of, gathering in other actions the point itself does not describe. Each practice point is atomic; the suggestion that comes out of it must be atomic too. If other actions in the wider workflow also belong, those are other practice points' jobs to surface.

Then decide whether the suggestion is essentially *refining* something already documented in the note — adding dose, timing, frequency or other specificity to a plan item that is already there, or naming a value the note refers to obliquely — or whether it is a *new action* the clinician hasn't yet recorded. Only set originalText when the new wording is meant to replace a specific existing line in place — same underlying action, expressed more completely. If the suggestion introduces a different action — a different medication, a different investigation, a different referral, additional counselling, a separate piece of advice — it belongs as a new item; leave originalText null. Being on the same clinical topic, addressing a related risk, or appearing in the same section is not on its own a reason to replace; ask whether the clinician, reading both lines, would feel the new one renders the old one redundant.

Return valid JSON only — no surrounding text or markdown.
If it applies:
{
  "applies": true,
  "reason": "one sentence on why it applies",
  "suggestion": "concise actionable clinical suggestion written for a clinician",
  "priority": "high|medium|low",
  "why": "why this matters for THIS specific patient",
  "verbatimQuote": "the exact phrase from the guideline text above that states this recommendation — the line the suggestion is based on, not just a nearby sentence",
  "evidence": "the exact phrase from the CLINICAL NOTE that triggers this practice point for this patient; if you cannot quote one, the practice point does not apply",
  "originalText": "exact text from the clinical note that this suggestion is rewriting in place — same action, more specific. Null if this is a new action the note doesn't already contain."
}
If it does not apply:
{
  "applies": false,
  "reason": "one sentence on why not"
}`;

    const result = await routeToAI({
        messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
        ]
    }, userId, model, 2000, 'evaluation:perPoint');

    if (!result?.content) return { pointId: point.id, pointName: point.name, applies: false, reason: 'No response' };

    let parsed;
    const raw = result.content.trim().replace(/```json\n?|\n?```/g, '');
    try {
        parsed = JSON.parse(raw);
    } catch (_) {
        // Fallback: extract JSON from malformed response
        try {
            const start = raw.indexOf('{');
            const end = raw.lastIndexOf('}');
            if (start !== -1 && end > start) {
                let block = raw.slice(start, end + 1).replace(/,\s*([\]}])/g, '$1');
                try { parsed = JSON.parse(block); } catch (_2) {
                    // Try appending closing characters for truncated responses
                    for (const suffix of ['"}', '"]}', '"}]']) {
                        try { parsed = JSON.parse(block + suffix); break; } catch (_3) { /* continue */ }
                    }
                }
            }
            // Last resort: regex extraction of key fields
            if (!parsed && start !== -1) {
                const block = raw.slice(start);
                const appliesMatch = block.match(/"applies"\s*:\s*(true|false)/);
                const reasonMatch = block.match(/"reason"\s*:\s*"([^"]*(?:\\.[^"]*)*)"/);
                if (appliesMatch) {
                    parsed = {
                        applies: appliesMatch[1] === 'true',
                        reason: reasonMatch ? reasonMatch[1] : '(reason truncated)'
                    };
                    // Extract additional fields if applies is true
                    if (parsed.applies) {
                        const suggMatch = block.match(/"suggestion"\s*:\s*"([^"]*(?:\\.[^"]*)*)"/);
                        const prioMatch = block.match(/"priority"\s*:\s*"([^"]*(?:\\.[^"]*)*)"/);
                        const whyMatch = block.match(/"why"\s*:\s*"([^"]*(?:\\.[^"]*)*)"/);
                        const quoteMatch = block.match(/"verbatimQuote"\s*:\s*"([^"]*(?:\\.[^"]*)*)"/);
                        const evidMatch = block.match(/"evidence"\s*:\s*"([^"]*(?:\\.[^"]*)*)"/);
                        const origMatch = block.match(/"originalText"\s*:\s*"([^"]*(?:\\.[^"]*)*)"/);
                        if (suggMatch) parsed.suggestion = suggMatch[1];
                        if (prioMatch) parsed.priority = prioMatch[1];
                        if (whyMatch) parsed.why = whyMatch[1];
                        if (quoteMatch) parsed.verbatimQuote = quoteMatch[1];
                        if (evidMatch) parsed.evidence = evidMatch[1];
                        if (origMatch) parsed.originalText = origMatch[1];
                    }
                    console.warn(`[PER-POINT] Recovered malformed JSON via regex for point ${point.id}: applies=${parsed.applies}`);
                }
            }
        } catch (fallbackErr) {
            console.warn(`[PER-POINT] extractJSON fallback failed for point ${point.id}:`, fallbackErr.message);
        }
    }

    if (!parsed) {
        return { pointId: point.id, pointName: point.name, applies: false, reason: 'Parse error: ' + raw.substring(0, 100) };
    }

    const applies = !!parsed.applies;

    // Prefer the pre-computed quote stored on the practice point (from backfill) — it's been
    // verified once against the guideline source and avoids per-session re-extraction.
    const storedQuote = point.verbatimQuote && quoteAppearsInSource(point.verbatimQuote, guidelineContent)
        ? point.verbatimQuote
        : null;

    // "Verbatim" must mean verbatim. Verify each quote is a genuine substring of its source;
    // if the model paraphrased or omitted the quote, give it one focused re-extraction attempt
    // then verify again. A practice point cannot ship to the user without a verifiable quote.
    let verbatimQuote = applies ? (storedQuote || parsed.verbatimQuote || null) : null;
    let evidence = applies ? (parsed.evidence || null) : null;
    if (applies) {
        // Verify against the FULL guideline content. The model is shown up to 200k chars
        // when it picks a quote, so capping verification at a small window wrongly rejects
        // every quote drawn from later in the document and silently drops the suggestion.
        // quoteAppearsInSource is a normalised substring search — no token cost to widen.
        const guidelineSource = guidelineContent || '';
        // storedQuote was already validated against the FULL guidelineContent above.
        const vqOk = !!verbatimQuote && (
            (!!storedQuote && verbatimQuote === storedQuote)
            || quoteAppearsInSource(verbatimQuote, guidelineSource)
        );
        const evOk = !!evidence && quoteAppearsInSource(evidence, transcript);

        // Re-extract when verbatimQuote is missing or unverified (was: only when unverified).
        if (!vqOk || (evidence && !evOk)) {
            const tag = `${guidelineId} "${(point.name || '').substring(0, 50)}"`;
            const re = await reExtractQuotes(parsed.suggestion || point.name, guidelineContent, transcript, userId, model);

            if (!vqOk) {
                if (re.verbatimQuote && quoteAppearsInSource(re.verbatimQuote, guidelineSource)) {
                    console.log(`[VERBATIM-VERIFY] ${tag}: verbatimQuote ${verbatimQuote ? 'recovered' : 'extracted'} by re-extraction`);
                    verbatimQuote = re.verbatimQuote.trim();
                } else {
                    console.log(`[VERBATIM-VERIFY] ${tag}: verbatimQuote ${verbatimQuote ? 'not verifiable — blanked' : 'still missing after re-extraction'}`);
                    verbatimQuote = null;
                }
            }
            if (evidence && !evOk) {
                if (re.evidence && quoteAppearsInSource(re.evidence, transcript)) {
                    console.log(`[VERBATIM-VERIFY] ${tag}: evidence recovered by re-extraction`);
                    evidence = re.evidence.trim();
                } else {
                    console.log(`[VERBATIM-VERIFY] ${tag}: evidence not verifiable — blanked`);
                    evidence = null;
                }
            }
        }

        // A practice point that applies but has no verifiable verbatim quote can't be grounded
        // to the source guideline. Dropping it is safer than showing the user an ungrounded
        // recommendation — the rest of the pipeline expects every shown suggestion to have one.
        if (!verbatimQuote) {
            console.log(`[VERBATIM-VERIFY] ${guidelineId} "${(point.name || '').substring(0, 50)}": dropping — applicable point with no verifiable verbatim quote`);
            return {
                pointId: point.id,
                pointName: point.name,
                applies: false,
                reason: 'No verifiable verbatim quote could be extracted from guideline'
            };
        }
    }

    return {
        pointId: point.id,
        pointName: point.name,
        applies,
        reason: parsed.reason || '',
        suggestion: applies ? (parsed.suggestion || null) : null,
        priority: applies ? (parsed.priority || 'low') : null,
        why: applies ? (parsed.why || null) : null,
        verbatimQuote,
        evidence,
        originalText: applies ? (parsed.originalText || null) : null,
        sourceGuidelineId: guidelineId || null
    };
}

/**
 * Formats per-point calibrated advice into a structured prompt section.
 *
 * @param {Array<{ id, name, advice }>} points
 * @returns {string}
 */
function formatPointAdviceForPrompt(points) {
    if (!points || points.length === 0) return '';
    const lines = points.map(p => `• ${p.name}\n${p.advice}`).join('\n\n');
    return `\n\n=== PRACTICE POINT APPLICATION GUIDE ===\nThe following practice points have been calibrated. Apply each one according to its guidance:\n\n${lines}\n=== END GUIDE ===\n`;
}

/**
 * Extracts cross-scenario lessons from a completeness check evaluation.
 *
 * Produces a prose summary of what general patterns the completeness check
 * missed or got wrong, suitable for feeding into generatePromptImprovements
 * to improve the global completeness prompt. Unlike extractGuidelineLessons,
 * this is about generalising — what principles should apply to ALL note types.
 *
 * @async
 * @param {Object} evaluation - Output from evaluateCompletenessOutput
 * @param {string} userId - User ID for AI routing
 * @returns {Promise<Object|null>} { learningText } or null if no issues found
 */
async function extractCompletenessLessons(evaluation, userId) {
    const hasIssues = (evaluation.falsePositives?.length || 0) > 0
        || (evaluation.missedItems?.length || 0) > 0
        || false;
    if (!hasIssues) return null;
    const systemPrompt = `You are an expert at improving AI completeness checks for clinical documentation. Write a concise analysis in plain prose — two or three short paragraphs — describing what general principles the AI should apply differently when assessing note completeness. Focus on: (1) items it flagged as missing that were actually present or irrelevant (false positives), (2) genuinely missing items it failed to detect, (3) any reasoning patterns that led to these errors. Write as generalisable principles applicable to any clinical note type, not as observations about this specific case.`;
    const userPrompt = `Evaluation results:\n${JSON.stringify(evaluation, null, 2)}\n\nWrite the lessons learned as generalisable principles for improving the completeness check.`;
    const result = await routeToAI({ messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }] }, userId);
    if (!result || !result.content) return null;
    return { learningText: result.content.trim() };
}

/**
 * Synthesizes existing and new learning into a coherent summary using AI.
 *
 * Prevents learning from growing unboundedly by merging new insights
 * with existing knowledge while preserving key lessons.
 *
 * @async
 * @param {string} existingLearning - Current accumulated learning text
 * @param {string} newLearning - New lessons to incorporate
 * @param {string} guidelineTitle - Guideline title for context
 * @param {string} userId - User ID for AI routing
 * @returns {Promise<string>} Synthesized learning text
 */
async function foldLearningWithLLM(existingLearning, newLearning, guidelineTitle, userId) {
    const systemPrompt = `You are an expert at synthesising clinical knowledge. Your role is to merge two sets of notes about the same guideline into a single coherent summary, preserving the most important lessons from both while keeping the result concise.`;
    const userPrompt = `Guideline: ${guidelineTitle}\n\nExisting notes:\n${existingLearning}\n\nNew notes to incorporate:\n${newLearning}\n\nPlease merge these into a single set of notes that captures the most important lessons from both.`;
    const result = await routeToAI({ messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }] }, userId);
    return result?.content?.trim() || newLearning;
}

/**
 * Stores accumulated learning for a guideline in Firestore.
 *
 * If learning already exists, folds new lessons into existing
 * knowledge using AI synthesis.
 *
 * @async
 * @param {string} guidelineId - The guideline document ID
 * @param {Object} newLessons - New lessons to store
 * @param {string} newLessons.learningText - The learning text content
 * @param {string} guidelineTitle - Guideline title for synthesis context
 * @param {string} userId - User ID for AI routing
 * @returns {Promise<void>}
 */
async function storeGuidelineLearning(guidelineId, newLessons, guidelineTitle, userId) {
    if (!newLessons || !newLessons.learningText) return;
    try {
        const learningRef = db.collection('guidelines').doc(guidelineId).collection('metadata').doc('interpretationHints');
        const learningDoc = await learningRef.get();
        let finalLearningText = newLessons.learningText;
        let newVersion = 1;
        if (learningDoc.exists) {
            const existingData = learningDoc.data();
            newVersion = (existingData?.version || 0) + 1;
            if (existingData.learningText) finalLearningText = await foldLearningWithLLM(existingData.learningText, newLessons.learningText, guidelineTitle, userId);
        }
        await learningRef.set({ learningText: finalLearningText, lastUpdated: admin.firestore.FieldValue.serverTimestamp(), version: newVersion });
    } catch (error) { console.error('[EVOLVE-LEARNING] Error storing learning:', error); }
}

/**
 * Refines suggestions based on evaluation feedback.
 *
 * Uses evaluation results to improve a previous set of suggestions,
 * addressing missed recommendations and correcting errors.
 *
 * @async
 * @param {Array<Object>} previousSuggestions - Original suggestions
 * @param {Object} previousEvaluation - Evaluation of original suggestions
 * @param {string} clinicalNote - The clinical note text
 * @param {string} guidelineContent - Full guideline text
 * @param {string} guidelineTitle - Guideline title
 * @param {string} userId - User ID for AI routing
 * @param {string|null} targetProvider - Specific provider to use
 * @param {string|null} [guidelineId=null] - Guideline ID for loading hints
 * @returns {Promise<Object>} Refined analysis results (same structure as analyzeGuidelineForPatient)
 */
async function refineSuggestions(previousSuggestions, previousEvaluation, clinicalNote, guidelineContent, guidelineTitle, userId, targetProvider, guidelineId = null) {
    let hintsText = '';
    if (guidelineId) {
        const learning = await loadGuidelineLearning(guidelineId);
        if (learning) hintsText = formatLearningForPrompt(learning);
    }
    const systemPrompt = `You are a clinical advisor reviewing and improving a set of AI-generated clinical suggestions. Your goal is to correct any inaccuracies, fill in any gaps relative to the guideline, and return an improved set of suggestions. Respond with valid JSON only, with no surrounding text or markdown.`;
    const userPrompt = `Clinical note:\n${clinicalNote}\n\nGuideline:\n${guidelineContent}\n\nPrevious suggestions:\n${JSON.stringify(previousSuggestions)}\n\nEvaluation of those suggestions:\n${JSON.stringify(previousEvaluation)}\n${hintsText}\n\nPlease provide an improved set of suggestions that addresses the shortcomings identified in the evaluation.`;
    const result = await routeToAI({ messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }] }, userId, targetProvider);
    if (!result || !result.content) return { patientContext: {}, suggestions: previousSuggestions, alreadyCompliant: [], refinementNotes: 'No response' };
    try {
        return JSON.parse(result.content.trim().replace(/```json\n?|\n?```/g, ''));
    } catch (e) {
        return { patientContext: {}, suggestions: previousSuggestions, alreadyCompliant: [], refinementNotes: 'Failed to parse' };
    }
}

/**
 * Sense-check suggestions against clinical context to filter out impossible/nonsensical recommendations
 * @param {Array} suggestions - Array of suggestion objects
 * @param {string} clinicalNote - The clinical note text
 * @param {Object} patientContext - Patient context extracted by AI (gestational age, etc.)
 * @param {string} userId - User ID for AI routing
 * @returns {Promise<Object>} - { validSuggestions, filteredOut }
 */
async function senseCheckSuggestions(suggestions, clinicalNote, patientContext, userId) {
    if (!suggestions || suggestions.length === 0) {
        return { validSuggestions: [], filteredOut: [] };
    }

    console.log('[SENSE-CHECK] Checking', suggestions.length, 'suggestions');

    const systemPrompt = `You are a quality auditor reviewing clinical suggestions. Your ONLY job is to remove suggestions that are biologically or physically impossible for this specific patient given their fixed, unchangeable characteristics.

DEFINITION OF "IMPOSSIBLE": A suggestion is impossible only when a fixed, unchangeable patient characteristic (biology, anatomy, demographics) makes the action inherently nonsensical — not inconvenient, not redundant, not already done, but literally impossible. Examples of genuinely impossible suggestions:
- Anti-D prophylaxis for an Rh-positive patient (Rh status is fixed — anti-D has no effect)
- Breastfeeding advice after a confirmed stillbirth (the baby does not exist)
- Preterm management at 41 weeks gestation (the patient is not preterm)
- Twin pregnancy pathway for a confirmed singleton pregnancy

THE MOST COMMON MISTAKE — THIS IS EXPLICITLY FORBIDDEN:
Removing a suggestion because it appears to already be done, documented, or handled. This is wrong. Examples of INVALID removals:
- "Corticosteroids are already being given" — INVALID. Keep it. A second course may be indicated, or documentation may be incomplete. The suggestion is not biologically impossible.
- "The patient has already had a scan" — INVALID. Keep it. Guideline recommendations may have further nuance not captured.
- "The team is already monitoring this" — INVALID. Keep it.
- "This management step is already in the plan" — INVALID. Keep it.
- "The action is no longer possible given the current stage" — INVALID. Keep it. Retrospective audit observations identify care gaps even in the past.
- "This seems unnecessary or low priority" — INVALID. Keep it.

MANDATORY TWO-QUESTION SELF-CHECK before adding anything to filteredOut:
1. What is the SPECIFIC fixed biological or demographic characteristic that makes this impossible? (Name it explicitly — e.g. "Rh-positive status", "singleton pregnancy", "gestational age 41 weeks")
2. Does that characteristic make the suggestion physically impossible — not just redundant, unnecessary, or already done?
If you cannot answer YES to both with a concrete biological/demographic fact, DO NOT filter the suggestion.

If in doubt, keep it. Showing a suggestion that was already done is harmless. Silently hiding a real care gap is dangerous.

Return ONLY valid JSON:
{
  "validSuggestions": [<array of suggestion IDs to keep>],
  "filteredOut": [
    {
      "id": <suggestion ID>,
      "biologicalFact": "<the specific fixed patient characteristic — e.g. 'Rh-positive', 'singleton', '41 weeks gestation'>",
      "reason": "<how that fixed characteristic makes this suggestion biologically impossible, not just redundant>"
    }
  ]
}`;

    const userPrompt = `PATIENT CONTEXT:
${JSON.stringify(patientContext, null, 2)}

CLINICAL NOTE:
${clinicalNote}

SUGGESTIONS TO REVIEW:
${suggestions.map((s, idx) => `[ID: ${idx}] ${s.suggestion || s.name || s.text || ''}`).join('\n')}

Remove only suggestions that are biologically or demographically impossible for this patient. Keep everything else.`;

    try {
        const result = await routeToAI({
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt }
            ]
        }, userId);

        if (!result || !result.content) {
            console.warn('[SENSE-CHECK-AI] No response from AI, keeping all suggestions');
            return { validSuggestions: suggestions, filteredOut: [] };
        }

        const parsed = JSON.parse(result.content.trim().replace(/```json\n?|\n?```/g, ''));
        const validIds = new Set(parsed.validSuggestions || []);
        const filteredOutMap = new Map((parsed.filteredOut || []).map(f => [f.id, f.reason]));

        const validSuggestions = suggestions.filter((_, idx) => validIds.has(idx));
        const filteredOut = suggestions
            .map((s, idx) => ({ ...s, originalIndex: idx, filterReason: filteredOutMap.get(idx) }))
            .filter(s => s.filterReason);

        // Guard: if the model returned both arrays empty it failed silently — keep everything.
        if (validSuggestions.length === 0 && filteredOut.length === 0 && suggestions.length > 0) {
            console.warn(`[SENSE-CHECK-AI] Model returned both arrays empty for ${suggestions.length} suggestion(s) — treating as failure, keeping all`);
            return { validSuggestions: suggestions, filteredOut: [] };
        }

        console.log(`[SENSE-CHECK] Final result: ${validSuggestions.length} valid, ${filteredOut.length} filtered out`);
        if (filteredOut.length > 0) {
            console.log('[SENSE-CHECK-AI] Filtered:', filteredOut.map(f => `"${f.suggestion?.substring(0, 60)}..." (${f.filterReason})`));
        }

        return { validSuggestions, filteredOut };
    } catch (error) {
        console.error('[SENSE-CHECK-AI] Error during AI validation:', error);
        return { validSuggestions: suggestions, filteredOut: [] };
    }
}

/**
 * Collapse near-duplicate suggestions pooled from multiple guidelines/practice points.
 * One AI call groups suggestions that call for the same action (even if worded
 * differently or sourced differently) and keeps the strongest representative of each
 * group. Conservative: only suggestions explicitly flagged as duplicates are dropped,
 * and any failure keeps everything.
 * @param {Array} suggestions - Array of suggestion objects (post impossible-filter)
 * @param {string} clinicalNote - The clinical note text
 * @param {string} userId - User ID for AI routing
 * @returns {Promise<Object>} - { dedupedSuggestions, duplicatesRemoved }
 */
async function dedupeSuggestions(suggestions, clinicalNote, userId) {
    if (!suggestions || suggestions.length <= 1) {
        return { dedupedSuggestions: suggestions || [], duplicatesRemoved: [] };
    }

    console.log('[DEDUPE] Checking', suggestions.length, 'suggestions for near-duplicates');

    const systemPrompt = `You are reviewing a pooled list of clinical suggestions gathered for one patient from several guidelines and practice points. Because each guideline and each practice point was analysed on its own, the same recommendation often appears more than once — sometimes worded differently, sometimes from a different source. Find those repeats so only one of each is kept.

Two suggestions are duplicates ONLY if they call for the exact same clinical act — the same specimen sent, the same form filled, the same person informed, the same drug given, the same decision made. Sharing a clinical context — same diagnosis, same patient stage, same care pathway, same form package — does not make two suggestions duplicates if the underlying act differs. Different verbs (send, prescribe, complete, inform, document, refer, arrange) almost always imply different acts; collapse across verbs only when the wording is genuinely synonymous.

Before listing two suggestions as duplicates, articulate the specific clinical act each one would produce in the world. If those acts are not literally the same act — if you could carry out one without carrying out the other — they are not duplicates. When in doubt, keep both. A minor repeat is a small annoyance; silently dropping a real care gap is dangerous.

For each group of genuine duplicates, choose the single suggestion that is most specific, complete, and actionable to keep, and list the others as duplicates of it.

Return only valid JSON. List only the suggestions to drop; anything not listed is kept:
{
  "duplicates": [
    { "id": <ID of the suggestion to drop>, "duplicateOf": <ID of the equivalent suggestion being kept>, "reason": "<why these are the same recommendation>" }
  ]
}`;

    const userPrompt = `CLINICAL NOTE:
${clinicalNote}

SUGGESTIONS:
${suggestions.map((s, idx) => `[ID: ${idx}] ${s.suggestion || s.name || s.text || ''}${s.sourceGuidelineTitle ? ` (source: ${s.sourceGuidelineTitle})` : ''}`).join('\n')}

Identify the genuine duplicates and return the JSON.`;

    try {
        const result = await routeToAI({
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt }
            ]
        }, userId, null, 2000);

        if (!result || !result.content) {
            console.warn('[DEDUPE] No response from AI, keeping all suggestions');
            return { dedupedSuggestions: suggestions, duplicatesRemoved: [] };
        }

        const parsed = JSON.parse(result.content.trim().replace(/```json\n?|\n?```/g, ''));
        const dropIds = new Set((parsed.duplicates || [])
            .map(d => d.id)
            .filter(id => Number.isInteger(id) && id >= 0 && id < suggestions.length));

        const dedupedSuggestions = suggestions.filter((_, idx) => !dropIds.has(idx));
        const duplicatesRemoved = (parsed.duplicates || [])
            .filter(d => dropIds.has(d.id))
            .map(d => ({ ...suggestions[d.id], duplicateOf: d.duplicateOf, reason: d.reason }));

        // Guard: a model that flags every suggestion as a duplicate has failed — keep everything.
        if (dedupedSuggestions.length === 0 && suggestions.length > 0) {
            console.warn(`[DEDUPE] Model flagged all ${suggestions.length} suggestions as duplicates — treating as failure, keeping all`);
            return { dedupedSuggestions: suggestions, duplicatesRemoved: [] };
        }

        console.log(`[DEDUPE] ${dedupedSuggestions.length} kept, ${duplicatesRemoved.length} near-duplicates removed`);
        if (duplicatesRemoved.length > 0) {
            console.log('[DEDUPE] Removed:', duplicatesRemoved.map(d => `"${(d.suggestion || '').substring(0, 50)}..." (dup of ${d.duplicateOf})`));
        }

        return { dedupedSuggestions, duplicatesRemoved };
    } catch (error) {
        console.error('[DEDUPE] Error during dedup, keeping all suggestions:', error);
        return { dedupedSuggestions: suggestions, duplicatesRemoved: [] };
    }
}

/**
 * Sense-check retrieved guidelines to filter out irrelevant ones
 * @param {Object} categories - Categorized guidelines { mostRelevant: [], potentiallyRelevant: [], ... }
 * @param {string} clinicalNote - The clinical note text
 * @param {string} userId - User ID for AI routing
 * @returns {Promise<Object>} - { validCategories, filteredOut }
 */
async function senseCheckGuidelines(categories, clinicalNote, userId) {
    if (!categories || (!categories.mostRelevant?.length && !categories.potentiallyRelevant?.length)) {
        return { validCategories: categories, filteredOut: [] };
    }

    console.log('[SENSE-CHECK-GUIDELINES] Checking guidelines for relevance to patient');

    // Combine mostRelevant and potentiallyRelevant for checking
    const guidelinesToCheck = [
        ...(categories.mostRelevant || []).map(g => ({ ...g, category: 'mostRelevant' })),
        ...(categories.potentiallyRelevant || []).map(g => ({ ...g, category: 'potentiallyRelevant' }))
    ];

    if (guidelinesToCheck.length === 0) {
        return { validCategories: categories, filteredOut: [] };
    }

    const systemPrompt = `You are reviewing a list of clinical guidelines to decide which ones are worth checking against a patient's clinical note. The only ones worth removing are those that clearly cannot apply — for example, a guideline specifically about sickle cell disease when the patient has no history of sickle cell, or a guideline about twin pregnancy when the patient is not carrying twins. General guidelines, preventive screening guidelines, and anything that could plausibly apply should be kept. When in doubt, keep the guideline. Respond with valid JSON only, using the structure: { "validGuidelines": [list of IDs to keep], "filteredOut": [{ "id": "...", "title": "...", "reason": "one sentence explanation" }] }`;

    const userPrompt = `Clinical note:
${clinicalNote}

Guidelines to review:
${guidelinesToCheck.map((g, idx) => `[ID: ${idx}] ${g.title || g.name || ''}`).join('\n')}

Please identify any guidelines that clearly cannot apply to this patient, and keep everything else.`;

    try {
        const result = await routeToAI({
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt }
            ]
        }, userId);

        if (!result || !result.content) {
            console.warn('[SENSE-CHECK-GUIDELINES] No response from AI, passing all guidelines through');
            return { validCategories: categories, filteredOut: [] };
        }

        const parsed = JSON.parse(result.content.trim().replace(/```json\n?|\n?```/g, ''));
        const validIds = new Set(parsed.validGuidelines || []);
        const filteredOutMap = new Map((parsed.filteredOut || []).map(f => [f.id, f]));

        // Rebuild categories with only valid guidelines
        const validMostRelevant = [];
        const validPotentiallyRelevant = [];
        const filteredOut = [];

        guidelinesToCheck.forEach((guideline, idx) => {
            if (validIds.has(idx)) {
                // Keep guideline in its original category
                if (guideline.category === 'mostRelevant') {
                    validMostRelevant.push(guideline);
                } else {
                    validPotentiallyRelevant.push(guideline);
                }
            } else if (filteredOutMap.has(idx)) {
                // Guideline was filtered out
                const filterInfo = filteredOutMap.get(idx);
                filteredOut.push({
                    ...guideline,
                    filterReason: filterInfo.reason
                });
            } else {
                // Default: keep it if not explicitly filtered
                if (guideline.category === 'mostRelevant') {
                    validMostRelevant.push(guideline);
                } else {
                    validPotentiallyRelevant.push(guideline);
                }
            }
        });

        const validCategories = {
            mostRelevant: validMostRelevant,
            potentiallyRelevant: validPotentiallyRelevant,
            lessRelevant: categories.lessRelevant || [],
            notRelevant: categories.notRelevant || []
        };

        console.log(`[SENSE-CHECK-GUIDELINES] Result: ${validMostRelevant.length + validPotentiallyRelevant.length} valid, ${filteredOut.length} filtered out`);
        if (filteredOut.length > 0) {
            console.log('[SENSE-CHECK-GUIDELINES] Filtered out:', filteredOut.map(f => `"${f.title}" (${f.filterReason})`).join('; '));
        }

        return { validCategories, filteredOut };
    } catch (error) {
        console.error('[SENSE-CHECK-GUIDELINES] Error during validation:', error);
        // On error, pass all guidelines through rather than blocking
        return { validCategories: categories, filteredOut: [] };
    }
}

/**
 * Stage 1: First-pass reasoning review of a clinical note.
 *
 * Uses a strong reasoning model to identify obvious deficiencies in TWO categories:
 *   1. Assessment / discussion / documentation omissions
 *   2. Management plan omissions
 *
 * This pass is guideline-agnostic — it relies on broad clinical reasoning only.
 *
 * @async
 * @param {string} clinicalNote - The clinical note text
 * @param {string} userId - User ID for AI routing
 * @param {string|null} [targetModel=null] - Optional model override (e.g. for Opus/GPT-5.2)
 * @returns {Promise<Object>} First-pass findings
 * @returns {Array} returns.assessment_gaps - Assessment/documentation deficiencies
 * @returns {Array} returns.management_gaps - Management plan deficiencies
 */
async function firstPassReasoning(clinicalNote, userId, targetModel = null) {
    console.log('[FIRST-PASS] Starting guideline-agnostic reasoning review');

    const systemPrompt = `You are an experienced clinician reviewing a clinical note for obvious deficiencies.

Do NOT cite guidelines or policies. Reason from clinical sense only.

Review for deficiencies in TWO areas:

AREA 1 — ASSESSMENT AND DOCUMENTATION
Missing contextual details, incomplete assessment framing, unclear interpretation of findings, missing escalation discussion, undocumented clinical reasoning.

AREA 2 — MANAGEMENT PLAN
Missing next steps, unclear escalation, missing investigations or monitoring, missing safety-netting, unclear timelines, missing communication or follow-up.

For each deficiency:
- "deficiency": name the underlying problem briefly (e.g. "Fetal alcohol risk not quantified")
- "action": write a specific, imperative clinical recommendation beginning with a verb (e.g. "Document the estimated fetal alcohol exposure and risk of fetal alcohol spectrum disorder (FASD) in the assessment"). This is shown directly to the clinician as the suggested action — make it concrete and actionable.
- "why_it_matters": explain why this matters for THIS patient specifically
- "severity": high / medium / low
- "confidence": 0.0–1.0

Be honest about uncertainty. If something might be implied or context-dependent, say so in why_it_matters rather than asserting it is definitely missing. Limit to the 3 most important deficiencies per area.

Respond with valid JSON only, no surrounding text or markdown.`;

    const userPrompt = `CLINICAL NOTE:
${clinicalNote}

Identify the most important deficiencies. Return JSON:
{
  "assessment_gaps": [
    {
      "id": "A1",
      "deficiency": "Brief name of what is missing or unclear",
      "action": "Specific imperative recommendation starting with a verb (e.g. 'Document...', 'Clarify...', 'Add...')",
      "why_it_matters": "Why a clinician would want this for this specific patient",
      "severity": "high|medium|low",
      "confidence": 0.0
    }
  ],
  "management_gaps": [
    {
      "id": "M1",
      "deficiency": "Brief name of what is missing or unclear",
      "action": "Specific imperative recommendation starting with a verb",
      "why_it_matters": "Why a clinician would want this for this specific patient",
      "severity": "high|medium|low",
      "confidence": 0.0
    }
  ]
}`;

    try {
        const result = await routeToAI({
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt }
            ],
            temperature: 0
        }, userId, targetModel);

        if (!result || !result.content) {
            console.warn('[FIRST-PASS] No response from AI');
            return { assessment_gaps: [], management_gaps: [] };
        }

        const parsed = JSON.parse(result.content.trim().replace(/```json\n?|\n?```/g, ''));
        const findings = {
            assessment_gaps: Array.isArray(parsed.assessment_gaps) ? parsed.assessment_gaps : [],
            management_gaps: Array.isArray(parsed.management_gaps) ? parsed.management_gaps : []
        };

        console.log(`[FIRST-PASS] Found ${findings.assessment_gaps.length} assessment gaps, ${findings.management_gaps.length} management gaps`);
        return findings;

    } catch (error) {
        console.error('[FIRST-PASS] Error during reasoning pass:', error.message);
        return { assessment_gaps: [], management_gaps: [] };
    }
}

/**
 * Truncates a guideline quote to a maximum character length, preserving sentence boundaries.
 *
 * @param {string} quote - The verbatim quote text
 * @param {number} [maxChars=150] - Maximum character length
 * @returns {string|null} Truncated quote or null
 */
function truncateQuote(quote, maxChars = 150) {
    if (!quote) return null;
    if (quote.length <= maxChars) return quote;
    const truncated = quote.substring(0, maxChars);
    const lastPeriod = truncated.lastIndexOf('.');
    if (lastPeriod > maxChars * 0.6) {
        return truncated.substring(0, lastPeriod + 1);
    }
    return truncated + '…';
}

/**
 * Merges Stage 1 (first-pass reasoning) findings with Stage 2 (guideline-based) suggestions.
 *
 * For each Stage 1 finding, attempts to match it with a Stage 2 suggestion using
 * keyword overlap. Matched items get guideline evidence attached. Unmatched Stage 1
 * findings are included as "reasoning_only". Unmatched Stage 2 suggestions are
 * included as "guideline_only".
 *
 * @param {Object} stage1Findings - Output from firstPassReasoning()
 * @param {Array} stage2Suggestions - Array of guideline suggestion objects from getPracticePointSuggestions
 * @returns {Object} Merged output with deficiencies array and summary
 */
function mergeFirstPassWithSuggestions(stage1Findings, stage2Suggestions) {
    const merged = [];
    const consumedStage2 = new Set();

    // Normalize text for comparison
    const normalize = (text) => (text || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();

    // Simple keyword-overlap matching
    function findBestMatch(findingText, suggestions) {
        const findingWords = new Set(normalize(findingText).split(' ').filter(w => w.length > 4));
        let bestIdx = -1;
        let bestScore = 0;

        suggestions.forEach((s, idx) => {
            if (consumedStage2.has(idx)) return;
            const suggText = normalize(s.suggestion || s.name || s.description || '');
            const suggWords = suggText.split(' ').filter(w => w.length > 3);
            if (suggWords.length === 0) return;

            const overlap = suggWords.filter(w => findingWords.has(w)).length;
            const score = overlap / Math.max(findingWords.size, suggWords.length);
            if (score > bestScore && score > 0.2) {
                bestScore = score;
                bestIdx = idx;
            }
        });

        return bestIdx >= 0 ? bestIdx : -1;
    }

    // Priority value for sorting
    const priorityVal = { high: 3, critical: 3, medium: 2, important: 2, low: 1, info: 0 };
    const sourceVal = { both: 3, reasoning_only: 2, guideline_only: 1 };

    let defId = 0;

    // 1. Process each Stage 1 finding
    const allFindings = [
        ...(stage1Findings.assessment_gaps || []).map(f => ({ ...f, element: 'assessment' })),
        ...(stage1Findings.management_gaps || []).map(f => ({ ...f, element: 'management' }))
    ];

    for (const finding of allFindings) {
        defId++;
        // Use action as display text; fall back to deficiency or description for older schema
        const displayText = finding.action || finding.description || finding.deficiency || '';
        // Use deficiency + action combined for keyword matching (catches both old and new schema)
        const matchText = [finding.deficiency, finding.description, finding.action].filter(Boolean).join(' ');
        const matchIdx = findBestMatch(matchText, stage2Suggestions);

        if (matchIdx >= 0) {
            const match = stage2Suggestions[matchIdx];
            consumedStage2.add(matchIdx);
            merged.push({
                id: `DEF-${String(defId).padStart(3, '0')}`,
                element: finding.element,
                description: displayText,
                why_it_matters: finding.why_it_matters,
                severity: finding.severity || 'medium',
                confidence: finding.confidence || null,
                source: 'both',
                guideline_status: 'confirmed',
                guideline_id: match.sourceGuidelineId || null,
                guideline_name: match.sourceGuidelineName || null,
                guideline_excerpt: truncateQuote(match.verbatimQuote),
                suggestion_text: match.suggestion || match.name || null
            });
        } else {
            merged.push({
                id: `DEF-${String(defId).padStart(3, '0')}`,
                element: finding.element,
                description: displayText,
                why_it_matters: finding.why_it_matters,
                severity: finding.severity || 'medium',
                confidence: finding.confidence || null,
                source: 'reasoning_only',
                guideline_status: 'no_guideline_match',
                guideline_id: null,
                guideline_name: null,
                guideline_excerpt: null,
                suggestion_text: null
            });
        }
    }

    // 2. Add unmatched Stage 2 suggestions
    stage2Suggestions.forEach((suggestion, idx) => {
        if (consumedStage2.has(idx)) return;
        defId++;

        // Classify element from suggestion content
        const text = normalize(suggestion.suggestion || suggestion.name || '');
        const isManagement = /\b(plan|manage|monitor|escalat|refer|follow|review|prescri|investig|action|treat)\b/.test(text);

        merged.push({
            id: `DEF-${String(defId).padStart(3, '0')}`,
            element: isManagement ? 'management' : 'assessment',
            description: suggestion.suggestion || suggestion.name || '',
            why_it_matters: suggestion.why || suggestion.context || suggestion.reasoning || '',
            severity: suggestion.priority || suggestion.significance || 'medium',
            confidence: null,
            source: 'guideline_only',
            guideline_status: 'confirmed',
            guideline_id: suggestion.sourceGuidelineId || null,
            guideline_name: suggestion.sourceGuidelineName || null,
            guideline_excerpt: truncateQuote(suggestion.verbatimQuote),
            suggestion_text: suggestion.suggestion || suggestion.name || null
        });
    });

    // 3. Sort: severity desc, then source weight desc
    merged.sort((a, b) => {
        const sevDiff = (priorityVal[b.severity] || 0) - (priorityVal[a.severity] || 0);
        if (sevDiff !== 0) return sevDiff;
        return (sourceVal[b.source] || 0) - (sourceVal[a.source] || 0);
    });

    // 4. Build summary
    const summary = {
        total: merged.length,
        by_element: { assessment: 0, management: 0 },
        by_severity: { high: 0, medium: 0, low: 0 },
        by_source: { both: 0, reasoning_only: 0, guideline_only: 0 }
    };
    merged.forEach(d => {
        summary.by_element[d.element] = (summary.by_element[d.element] || 0) + 1;
        summary.by_severity[d.severity] = (summary.by_severity[d.severity] || 0) + 1;
        summary.by_source[d.source] = (summary.by_source[d.source] || 0) + 1;
    });

    console.log(`[MERGE] Merged output: ${summary.total} deficiencies (${summary.by_source.both} confirmed by guideline, ${summary.by_source.reasoning_only} reasoning-only, ${summary.by_source.guideline_only} guideline-only)`);

    return { deficiencies: merged, summary };
}

/**
 * Evaluates the output of the completeness checker against a clinical note.
 * Used by the prompt evolution system to judge whether missing_information items are correct.
 *
 * @async
 * @param {string} clinicalNote - The input clinical note
 * @param {Array<Object>} missingItems - The missing_information array returned by the completeness prompt
 * @param {string} userId - User ID for AI routing
 * @returns {Promise<Object>} Evaluation with recall/precision scores and item-level verdicts
 */
async function evaluateCompletenessOutput(clinicalNote, missingItems, userId) {
    const systemPrompt = `You are an expert clinical documentation auditor. Your task is to evaluate whether an AI system correctly identified missing information in a clinical note.

EVALUATION CRITERIA:
1. PRECISION: For each flagged item, is it genuinely missing and clinically important for this type of note?
   - "correct": The item IS genuinely absent AND safety-relevant for this encounter type
   - "false_positive": The item is already present (explicitly or implicitly) in the note, OR is not appropriate to flag for this type of encounter
   - "borderline": Debatable — could go either way depending on clinical context

2. RECALL: Are there important gaps the AI missed entirely?
   - Consider the encounter type and what documentation standards require
   - Only flag genuinely important omissions, not nice-to-haves

3. DATA TYPE APPROPRIATENESS: Is the suggested input method realistic?
   - Does the data_type match how a clinician would actually document this?

Return ONLY valid JSON, no markdown or commentary.`;

    const userPrompt = `CLINICAL NOTE:
${clinicalNote}

AI-IDENTIFIED MISSING ITEMS:
${JSON.stringify(missingItems, null, 2)}

Evaluate each item and identify any missed gaps. Return JSON:
{
  "precisionScore": 0.0-1.0,
  "recallScore": 0.0-1.0,
  "itemEvaluations": [
    {
      "missing_info": "label from the AI output",
      "verdict": "correct|false_positive|borderline",
      "reason": "why this verdict",
      "dataTypeAppropriate": true/false
    }
  ],
  "missedGaps": [
    {
      "missing_info": "what was missed",
      "importance": "why it matters"
    }
  ],
  "overallAssessment": "brief summary"
}`;

    const result = await routeToAI({ messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }] }, userId, null, 4000, 'complex');
    if (!result || !result.content) {
        return { precisionScore: 0, recallScore: 0, itemEvaluations: [], missedGaps: [], error: 'No response from evaluator' };
    }
    try {
        return JSON.parse(result.content.trim().replace(/```json\n?|\n?```/g, ''));
    } catch (e) {
        return { precisionScore: 0, recallScore: 0, itemEvaluations: [], missedGaps: [], error: 'Failed to parse evaluation' };
    }
}

/**
 * Rewrites an ambiguous practice point into 2–3 distinct, unambiguous sub-points.
 * Called by the calibration loop when a point oscillates (both FP and miss errors
 * across iterations), indicating its applicability boundary is unclear.
 *
 * @param {{ name: string, description: string }} point - The ambiguous practice point
 * @param {Array<{ transcript: string, verdict: string, modelReason: string, shouldApply: boolean }>} errorEvidence - All errors for this point
 * @param {string} guidelineTitle
 * @param {string} guidelineContent - Guideline text for context
 * @param {string} userId
 * @returns {Promise<Array<{ name: string, description: string }>>} Replacement points
 */
async function rewritePracticePoint(point, errorEvidence, guidelineTitle, guidelineContent, userId) {
    const evidenceText = errorEvidence.map((e, i) => {
        const label = e.shouldApply ? 'Ground truth: SHOULD suggest' : 'Ground truth: should NOT suggest';
        const verdictLabel = { miss: 'Miss (model omitted)', false_positive: 'False positive (model suggested)' }[e.verdict] || e.verdict;
        return `Case ${i + 1}:\n${label}\nVerdict: ${verdictLabel}\nModel reasoning: ${e.modelReason || 'n/a'}\nClinical note excerpt: ${(e.transcript || '').substring(0, 300)}`;
    }).join('\n\n---\n\n');

    const systemPrompt = `You are a clinical guideline expert rewriting ambiguous practice points into distinct, testable clinical decision rules. Each replacement point must have a clear, unambiguous trigger condition that an AI system can evaluate against a clinical note.`;

    const userPrompt = `Guideline: ${guidelineTitle}

Guideline content (excerpt):
${guidelineContent.substring(0, 3000)}

The following practice point keeps causing inconsistent results in calibration — sometimes the AI suggests it when it shouldn't (false positive), sometimes it fails to suggest it when it should (miss). This oscillation indicates the point bundles multiple distinct clinical decisions into one.

Ambiguous practice point:
Name: ${point.name}
Description: ${point.description || point.name}

Error evidence showing the oscillation:
${evidenceText}

Rewrite this single ambiguous practice point into 2–3 DISTINCT replacement points. Each replacement must:
1. Describe exactly ONE clinical action or decision
2. Have a clear, unambiguous trigger condition (when it applies vs when it doesn't)
3. Be testable: given a clinical note, it should be obvious whether this point applies or not
4. Preserve the clinical intent of the original guideline recommendation

Common splits:
- Timing recommendations → separate "do not perform before X" from "recommend performing at Y"
- Review/documentation → separate "ensure screening is done" from "review results before proceeding"
- Counselling → separate "inform about risk X" from "document informed consent"

Return ONLY valid JSON:
{
  "replacements": [
    { "name": "Concise practice point name (max 120 chars)", "description": "Full description of when and what action is needed" },
    { "name": "...", "description": "..." }
  ],
  "reasoning": "Brief explanation of why the original was ambiguous and how the split resolves it"
}`;

    // Route via the user's model preference with fallback (no pinned provider).
    const result = await routeToAI({
        messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
        ]
    }, userId, null, 4000);

    if (!result?.content) throw new Error('No response from practice point rewriter');

    const cleaned = result.content.trim().replace(/```json\n?|\n?```/g, '');
    const parsed = JSON.parse(cleaned);

    if (!Array.isArray(parsed.replacements) || parsed.replacements.length === 0) {
        throw new Error('No replacement points returned');
    }

    return parsed;
}

module.exports = {
    createPromptForChunk,
    mergeChunkResults,
    parseChunkResponse,
    routeToAI,
    sendToAI,
    analyzeGuidelineForPatient,
    checkComplianceAndSuggest,
    filterRelevantPracticePoints,
    filterImportantPracticePoints,
    loadGuidelineLearning,
    storeGuidelineLearning,
    evaluateSuggestions,
    evaluateCompletenessOutput,
    generatePromptImprovements,
    extractGuidelineLessons,
    extractCompletenessLessons,
    evolvePointAdvice,
    rewritePracticePoint,
    loadPracticePointAdvice,
    loadAllPracticePoints,
    extractPracticePointQuote,
    quoteAppearsInSource,
    analyzePointForPatient,
    refineSuggestions,
    senseCheckSuggestions,
    dedupeSuggestions,
    senseCheckGuidelines,
    firstPassReasoning,
    mergeFirstPassWithSuggestions,
    truncateQuote,
    SEQUENTIAL_LLM_CHAIN
};
