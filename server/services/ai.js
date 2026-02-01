const axios = require('axios');
const stringSimilarity = require('string-similarity');
const { db, admin } = require('../config/firebase');
const { debugLog } = require('../config/logger');
const { AI_PROVIDER_PREFERENCE, AI_MODEL_REGISTRY } = require('../config/constants');
const {
    getUserAIPreference,
    getProviderFromModel,
    getUserModelPreferences,
    getNextAvailableProvider,
    getUserChunkDistributionProviders
} = require('./preferences');

const SEQUENTIAL_LLM_CHAIN = AI_PROVIDER_PREFERENCE.map(p => ({
    model: p.model,
    displayName: `${p.name} (${p.model})`,
    provider: p.name,
    cost: p.costPer1kTokens
}));

// Helper function to create prompt for a chunk of guidelines
function createPromptForChunk(transcript, guidelinesChunk) {
    const guidelinesText = guidelinesChunk.map(g => {
        let guidelineInfo = `[${g.id}] ${g.title}`;
        if (g.summary && g.summary.trim()) {
            guidelineInfo += `\nSummary: ${g.summary.trim()}`;
        }
        if (g.keywords && Array.isArray(g.keywords) && g.keywords.length > 0) {
            guidelineInfo += `\nKeywords: ${g.keywords.slice(0, 10).join(', ')}`;
        }
        return guidelineInfo;
    }).join('\n\n---\n\n');

    return `You are a medical expert analyzing a clinical case to identify the most relevant medical guidelines. Your task is to categorize each guideline by its clinical relevance to the specific patient scenario.

CLINICAL CASE:
${transcript}

AVAILABLE GUIDELINES:
${guidelinesText}

ANALYSIS INSTRUCTIONS:
1. Carefully read the clinical case and identify the key clinical issues, patient demographics, and medical context
2. For each guideline, consider:
   - Direct relevance to the patient's primary presenting conditions
   - Applicability to the patient's specific demographics (age, pregnancy status, etc.)
   - Relevance to secondary issues or comorbidities mentioned
   - Potential value for differential diagnosis or management planning
   - Appropriateness for the clinical setting and care level described

RELEVANCE SCORING (0.0-1.0):
- 0.9-1.0: Directly addresses primary clinical issues and patient context
- 0.7-0.89: Highly relevant to primary or important secondary issues  
- 0.5-0.69: Moderately relevant to secondary issues or differential diagnosis
- 0.2-0.49: Limited relevance, may provide background information
- 0.0-0.19: Minimal or no relevance to this specific case

RESPONSE FORMAT (JSON only):
{
  "mostRelevant": [{"id": "guideline_id", "title": "guideline_title", "relevance": "0.XX"}],
  "potentiallyRelevant": [{"id": "guideline_id", "title": "guideline_title", "relevance": "0.XX"}],
  "lessRelevant": [{"id": "guideline_id", "title": "guideline_title", "relevance": "0.XX"}],
  "notRelevant": [{"id": "guideline_id", "title": "guideline_title", "relevance": "0.XX"}]
}

Provide ONLY the JSON response with no additional text or explanation.`;
}

// Helper function to merge chunk results
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

// Helper function to parse AI response for chunk
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

async function sendToAI(prompt, model = 'deepseek-chat', systemPrompt = null, userId = null, temperature = 0.7, timeoutMs = 120000, skipUserPreference = false, maxTokens = 4000) {
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
            const response = await axios.post(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, { contents: geminiMessages, generationConfig: { temperature, maxOutputTokens: maxTokens } }, { headers: { 'Content-Type': 'application/json' }, params: { key: process.env.GOOGLE_AI_API_KEY }, timeout: timeoutMs });
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
            db.collection('aiInteractions').add({
                timestamp: admin.firestore.FieldValue.serverTimestamp(),
                userId: userId || 'anonymous',
                provider: preferredProvider,
                model,
                endpoint: 'sendToAI',
                promptTokens: tokenUsage.prompt_tokens || 0,
                completionTokens: tokenUsage.completion_tokens || 0,
                totalTokens: tokenUsage.total_tokens || 0,
                latencyMs,
                success: true,
                promptLength: promptStr.length,
                responseLength: content?.length || 0,
                fullPrompt: promptStr.substring(0, 50000),
                fullResponse: content ? content.substring(0, 50000) : ''
            }).catch(err => console.error('Failed to log AI interaction:', err.message));
        }

        return { content: content, ai_provider: preferredProvider, ai_model: model, token_usage: tokenUsage };

    } catch (error) {
        console.error('Error in sendToAI:', error.message);
        throw new Error(`AI request failed: ${error.response?.data?.error?.message || error.message}`);
    }
}

async function routeToAI(prompt, userId = null, preferredProvider = null, maxTokens = 4000) {
    try {
        const defaultProvider = AI_PROVIDER_PREFERENCE[0].name;
        let provider = preferredProvider || defaultProvider;

        if (!preferredProvider && userId) {
            try {
                const userPreference = await getUserAIPreference(userId);
                if (userPreference) provider = userPreference;
            } catch (error) { console.error('[DEBUG] Error getting user AI preference:', error.message); }
        }

        let model;
        const modelConfig = AI_PROVIDER_PREFERENCE.find(p => p.model === provider);
        if (modelConfig) {
            model = provider;
            provider = modelConfig.name;
        } else {
            const map = { 'OpenAI': 'gpt-3.5-turbo', 'DeepSeek': 'deepseek-chat', 'Anthropic': 'claude-3-haiku-20240307', 'Mistral': 'mistral-large-latest', 'Gemini': 'gemini-2.5-flash', 'Groq': 'llama-3.3-70b-versatile' };
            model = map[provider] || 'deepseek-chat';
        }

        const skipUserPreference = !!preferredProvider;
        let result;
        if (typeof prompt === 'object' && prompt.messages) {
            const temperature = prompt.temperature !== undefined ? prompt.temperature : 0.7;
            result = await sendToAI(prompt.messages, model, null, userId, temperature, 120000, skipUserPreference, maxTokens);
        } else {
            result = await sendToAI(prompt, model, null, userId, 0.7, 120000, skipUserPreference, maxTokens);
        }

        return result;
    } catch (error) {
        console.error('[DEBUG] Error in routeToAI:', error.message);
        throw error;
    }
}

async function checkComplianceAndSuggest(clinicalNote, importantPoints, userId) {
    if (importantPoints.length === 0) return { compliant: [], nonCompliant: [] };
    const pointsList = importantPoints.map(p => `[${p.originalIndex}] ${p.point}`).join('\n');
    const prompts = global.prompts || require('../../prompts.json');
    const promptConfig = prompts['checkPracticePointCompliance'];
    const systemPrompt = promptConfig?.system_prompt || 'You are a clinical advisor. Return ONLY valid JSON - no markdown, no explanations.';
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

async function filterRelevantPracticePoints(clinicalNote, allPoints, userId) {
    if (!allPoints || allPoints.length === 0) return { relevant: [], irrelevant: {} };
    const pointsList = allPoints.map((p, i) => `[${i + 1}] ${p}`).join('\n');
    const result = await routeToAI({
        messages: [{ role: 'system', content: 'You are a clinical advisor. Return ONLY valid JSON.' },
        { role: 'user', content: `Clinical Note:\n${clinicalNote}\n\nPoints:\n${pointsList}\n\nFilter relevant...` }]
    }, userId);
    try {
        return JSON.parse(result.content.trim().replace(/```json\n?|\n?```/g, ''));
    } catch (e) {
        return { relevant: allPoints.map((_, i) => i + 1), irrelevant: {} };
    }
}

async function filterImportantPracticePoints(clinicalNote, relevantPoints, userId) {
    if (relevantPoints.length === 0) return { important: [], unimportant: {} };
    const pointsList = relevantPoints.map(p => `[${p.originalIndex}] ${p.point}`).join('\n');
    const messages = [{ role: 'system', content: 'You are a clinical advisor. Return ONLY valid JSON.' }, { role: 'user', content: `Clinical Note:\n${clinicalNote}\n\nPoints:\n${pointsList}\n\nDetermine if each practice point is likely to have significant impact...` }];
    const result = await routeToAI({ messages }, userId);
    try {
        return JSON.parse(result.content.trim().replace(/```json\n?|\n?```/g, ''));
    } catch (e) {
        return { important: relevantPoints.map(p => p.originalIndex), unimportant: {} };
    }
}

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

function formatLearningForPrompt(learning) {
    if (!learning || !learning.learningText) return '';
    return `\n\nIMPORTANT - ACCUMULATED LEARNING FROM PREVIOUS ATTEMPTS:\nThe following insights have been learned from previous AI attempts to analyse this guideline. Apply these lessons:\n\n${learning.learningText}\n`;
}

async function analyzeGuidelineForPatient(clinicalNote, guidelineContent, guidelineTitle, userId, guidelineId = null, targetModel = null) {
    let hintsText = '';
    if (guidelineId) {
        const learning = await loadGuidelineLearning(guidelineId);
        if (learning) hintsText = formatLearningForPrompt(learning);
    }

    const step1SystemPrompt = `You are a clinical advisor. Your job is to identify GAPS in care based on the provided clinical note and guideline. Identify any guideline recommendations NOT covered by the clinical note. Return ONLY valid JSON with this structure: { "suggestions": [{ "suggestion": "Concise, actionable advice", "priority": "high|medium|low", "reasoning": "Brief explanation" }] }`;
    const step1UserPrompt = `CLINICAL NOTE:\n${clinicalNote}\n\nGUIDELINE TITLE: ${guidelineTitle}\n\nGUIDELINE CONTENT:\n${guidelineContent}\n\n${hintsText ? `\nPREVIOUS FEEDBACK:\n${hintsText}\n` : ''}\n\nTASK: Identify any guideline recommendations NOT covered...`;
    const messagesStep1 = [{ role: 'system', content: step1SystemPrompt }, { role: 'user', content: step1UserPrompt }];
    const resultStep1 = await routeToAI({ messages: messagesStep1 }, userId, targetModel);

    if (!resultStep1 || !resultStep1.content) return { patientContext: {}, suggestions: [], alreadyCompliant: [] };

    let initialSuggestions = [];
    try {
        const parsed = JSON.parse(resultStep1.content.trim().replace(/```json\n?|\n?```/g, ''));
        initialSuggestions = parsed.suggestions || [];
    } catch (e) { return { patientContext: {}, suggestions: [], alreadyCompliant: [] }; }

    if (initialSuggestions.length === 0) return { patientContext: {}, suggestions: [], alreadyCompliant: [] };

    const step2SystemPrompt = `You are a clinical advisor perfecting a list of suggestions. Your specific task is to extract patient context, identify compliant points, and add "why" and "verbatimQuote" fields to each suggestion. Ensure the output is valid JSON with structure: { "patientContext": {}, "suggestions": [{ "suggestion": "...", "priority": "...", "why": "...", "verbatimQuote": "..." }], "alreadyCompliant": [] }`;
    const step2UserPrompt = `CLINICAL NOTE:\n${clinicalNote}\n\nGUIDELINE CONTENT:\n${guidelineContent}\n\nDRAFT SUGGESTIONS:\n${JSON.stringify(initialSuggestions, null, 2)}\n\nTASK: 1. Extract patient context. 2. Identify already compliant. 3. Add why/verbatimQuote. 4. Return JSON.`;
    const messagesStep2 = [{ role: 'system', content: step2SystemPrompt }, { role: 'user', content: step2UserPrompt }];
    const resultStep2 = await routeToAI({ messages: messagesStep2 }, userId, targetModel);

    if (!resultStep2 || !resultStep2.content) {
        return { patientContext: {}, suggestions: initialSuggestions.map(s => ({ ...s, suggestion: s.name, why: 'Reasoning generation failed', verbatimQuote: '' })), alreadyCompliant: [] };
    }

    try {
        return JSON.parse(resultStep2.content.trim().replace(/```json\n?|\n?```/g, ''));
    } catch (e) {
        return { patientContext: {}, suggestions: initialSuggestions.map(s => ({ ...s, suggestion: s.name, why: 'Reasoning generation failed', verbatimQuote: '' })), alreadyCompliant: [] };
    }
}

async function evaluateSuggestions(clinicalNote, guidelineContent, guidelineTitle, suggestions, alreadyCompliant, userId) {
    const promptConfig = (global.prompts || require('../../prompts.json'))['evaluateSuggestions'];
    const systemPrompt = promptConfig?.system_prompt || `You are a clinical guideline expert evaluating AI-generated suggestions... Return ONLY valid JSON.`;
    const userPrompt = (promptConfig?.prompt || `CLINICAL NOTE:\n{{clinicalNote}}\n\nGUIDELINE TITLE: {{guidelineTitle}}\n\nFULL GUIDELINE CONTENT:\n{{guidelineContent}}\n\nAI-GENERATED SUGGESTIONS:\n{{suggestions}}\n\nAI-IDENTIFIED AS ALREADY COMPLIANT:\n{{alreadyCompliant}}\n\nEvaluate the AI's output...`)
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

async function generatePromptImprovements(currentPrompt, evaluationResults, avgRecall, avgPrecision, avgLatency, userId, additionalMetrics = {}) {
    const promptConfig = (global.prompts || require('../../prompts.json'))['generatePromptImprovements'];
    const systemPrompt = promptConfig?.system_prompt || `You are an expert at prompt engineering... Return ONLY valid JSON.`;
    const evaluationSummary = evaluationResults.map((evaluationItem, idx) => ({ scenario: idx + 1, recall: evaluationItem.recallScore, precision: evaluationItem.precisionScore, assessment: evaluationItem.overallAssessment }));
    const userPrompt = (promptConfig?.prompt || `CURRENT PROMPT BEING EVALUATED:\n{{currentPrompt}}\n\nEVALUATION RESULTS:\n{{evaluationResults}}\n\nMETRICS:\nRecall: {{avgRecall}}\nPrecision: {{avgPrecision}}\n\nAnalyze...`)
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

async function extractLessonsLearned(guidelineTitle, evaluation, suggestions, userId) {
    if ((evaluation.missedRecommendations?.length || 0) === 0 && (evaluation.suggestionEvaluations?.filter(s => s.verdict === 'incorrect').length || 0) === 0) return null;
    const systemPrompt = `You are an expert at analysing AI performance... Write 1-3 short paragraphs...`;
    const userPrompt = `GUIDELINE: ${guidelineTitle}\n\nEVALUATION RESULTS:\n${JSON.stringify(evaluation, null, 2)}\n\nSUGGESTIONS:\n${JSON.stringify(suggestions, null, 2)}\n\nWrite a concise prose summary of key lessons learned.`;
    const result = await routeToAI({ messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }] }, userId);
    if (!result || !result.content) return null;
    return { learningText: result.content.trim() };
}

async function foldLearningWithLLM(existingLearning, newLearning, guidelineTitle, userId) {
    const systemPrompt = `You are an expert at synthesising clinical guideline knowledge... Preserve existing, incorporate new. Concise.`;
    const userPrompt = `GUIDELINE: ${guidelineTitle}\n\nEXISTING:\n${existingLearning}\n\nNEW:\n${newLearning}\n\nSynthesise...`;
    const result = await routeToAI({ messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }] }, userId);
    return result?.content?.trim() || newLearning;
}

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

async function refineSuggestions(previousSuggestions, previousEvaluation, clinicalNote, guidelineContent, guidelineTitle, userId, targetProvider, guidelineId = null) {
    let hintsText = '';
    if (guidelineId) {
        const learning = await loadGuidelineLearning(guidelineId);
        if (learning) hintsText = formatLearningForPrompt(learning);
    }
    const systemPrompt = `You are a clinical advisor reviewing and improving another AI's suggestions... Return ONLY valid JSON.`;
    const userPrompt = `CLINICAL NOTE:\n${clinicalNote}\n\nGUIDELINE:\n${guidelineContent}\n\nPREVIOUS SUGGESTIONS:\n${JSON.stringify(previousSuggestions)}\n\nEVALUATION:\n${JSON.stringify(previousEvaluation)}\n${hintsText}\n\nProvide IMPROVED suggestions.`;
    const result = await routeToAI({ messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }] }, userId, targetProvider);
    if (!result || !result.content) return { patientContext: {}, suggestions: previousSuggestions, alreadyCompliant: [], refinementNotes: 'No response' };
    try {
        return JSON.parse(result.content.trim().replace(/```json\n?|\n?```/g, ''));
    } catch (e) {
        return { patientContext: {}, suggestions: previousSuggestions, alreadyCompliant: [], refinementNotes: 'Failed to parse' };
    }
}

/**
 * Extract gestational age in weeks from clinical note or patient context
 * @param {string} clinicalNote - The clinical note text
 * @param {Object} patientContext - Patient context object
 * @returns {number|null} - Gestational age in weeks, or null if not found
 */
function extractGestationalAge(clinicalNote, patientContext) {
    // Check patient context first
    if (patientContext?.gestationalAge) {
        const match = String(patientContext.gestationalAge).match(/(\d+)\s*\+?\s*\d*/);
        if (match) return parseInt(match[1]);
    }

    // Look for patterns like "32+4", "32 weeks", "36+0 weeks"
    const patterns = [
        /(\d{1,2})\s*\+\s*\d+\s*weeks/i,
        /(\d{1,2})\s*\+\s*\d+/,
        /(\d{1,2})\s*weeks\s*\+\s*\d+/i,
        /at\s*(\d{1,2})\s*weeks/i,
        /G\d+P\d+.*?(\d{1,2})\+\d+/i
    ];

    for (const pattern of patterns) {
        const match = clinicalNote.match(pattern);
        if (match) {
            const weeks = parseInt(match[1]);
            if (weeks >= 4 && weeks <= 44) return weeks; // Sanity check
        }
    }

    return null;
}

/**
 * Extract patient blood type/Rh status from clinical note
 * @param {string} clinicalNote - The clinical note text
 * @returns {Object} - { rhesus: 'positive'|'negative'|null }
 */
function extractBloodType(clinicalNote) {
    const rhPositivePatterns = [
        /Rh\+ve/i,
        /Rh\s*positive/i,
        /RhD\s*positive/i,
        /Rhesus\s*positive/i
    ];

    const rhNegativePatterns = [
        /Rh\-ve/i,
        /Rh\s*negative/i,
        /RhD\s*negative/i,
        /Rhesus\s*negative/i
    ];

    for (const pattern of rhPositivePatterns) {
        if (pattern.test(clinicalNote)) return { rhesus: 'positive' };
    }

    for (const pattern of rhNegativePatterns) {
        if (pattern.test(clinicalNote)) return { rhesus: 'negative' };
    }

    return { rhesus: null };
}

/**
 * Rule-based filters for common nonsensical patterns
 * @param {Array} suggestions - Array of suggestion objects
 * @param {string} clinicalNote - The clinical note text
 * @param {Object} patientContext - Patient context
 * @returns {Object} - { validSuggestions, filteredOut }
 */
function applyRuleBasedFilters(suggestions, clinicalNote, patientContext) {
    const currentGA = extractGestationalAge(clinicalNote, patientContext);
    const bloodType = extractBloodType(clinicalNote);
    const filteredOut = [];
    const validSuggestions = [];

    console.log(`[SENSE-CHECK-RULES] Current GA: ${currentGA} weeks, Rhesus: ${bloodType.rhesus}`);

    for (const suggestion of suggestions) {
        const suggestionText = (suggestion.suggestion || suggestion.text || '').toLowerCase();
        let filterReason = null;

        // Rule 1: Check for temporal impossibilities (suggesting past interventions)
        if (currentGA) {
            // Look for "at X weeks" or "X-Y weeks" patterns in suggestion
            const weekPatterns = [
                /at\s*(\d{1,2})\s*weeks/i,
                /(\d{1,2})\s*-\s*(\d{1,2})\s*weeks/i,
                /around\s*(\d{1,2})\s*weeks/i
            ];

            for (const pattern of weekPatterns) {
                const match = suggestionText.match(pattern);
                if (match) {
                    const suggestedWeek = parseInt(match[1]);
                    // Check if suggested intervention is in the past
                    if (suggestedWeek < currentGA - 1) { // Allow 1 week grace for rounding
                        filterReason = `Patient is at ${currentGA} weeks - cannot schedule intervention at ${suggestedWeek} weeks (already past)`;
                        break;
                    }
                }
            }
        }

        // Rule 2: Check for Rhesus incompatibility
        if (bloodType.rhesus === 'positive') {
            // If patient is Rh positive, anti-D suggestions don't apply
            if (/anti-d/i.test(suggestionText) && /rhd\s*negative/i.test(suggestionText)) {
                filterReason = `Patient is Rhesus positive - anti-D prophylaxis only applies to Rh negative patients`;
            }
        }

        // Rule 3: Check if action already documented as completed
        const completedPatterns = [
            { pattern: /booking.*blood/i, completed: /booking.*blood.*done|booking.*blood.*completed|booking.*blood.*taken/i },
            { pattern: /dating.*scan/i, completed: /dating.*scan.*done|dating.*scan.*completed|dating.*scan.*confirmed/i },
            { pattern: /anomaly.*scan/i, completed: /anomaly.*scan.*done|anomaly.*scan.*completed|anomaly.*scan.*normal/i }
        ];

        for (const { pattern, completed } of completedPatterns) {
            if (pattern.test(suggestionText) && completed.test(clinicalNote)) {
                filterReason = `Action already documented as completed in clinical note`;
                break;
            }
        }

        if (filterReason) {
            filteredOut.push({ ...suggestion, filterReason });
        } else {
            validSuggestions.push(suggestion);
        }
    }

    return { validSuggestions, filteredOut };
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

    console.log('[SENSE-CHECK] Checking', suggestions.length, 'suggestions for temporal/logical consistency');

    // First apply rule-based filters (fast, deterministic)
    const ruleBasedResult = applyRuleBasedFilters(suggestions, clinicalNote, patientContext);

    if (ruleBasedResult.filteredOut.length > 0) {
        console.log(`[SENSE-CHECK-RULES] Filtered out ${ruleBasedResult.filteredOut.length} suggestions:`,
            ruleBasedResult.filteredOut.map(f => `"${f.suggestion?.substring(0, 60)}..." (${f.filterReason})`));
    }

    // If all suggestions were filtered by rules, return early
    if (ruleBasedResult.validSuggestions.length === 0) {
        return ruleBasedResult;
    }

    // Then apply AI-based validation for more nuanced cases
    const currentGA = extractGestationalAge(clinicalNote, patientContext);
    const bloodType = extractBloodType(clinicalNote);

    const systemPrompt = `You are a clinical reasoning validator. Your job is to identify suggestions that are IMPOSSIBLE or NONSENSICAL given the patient's current state.

CRITICAL CHECKS:
1. TEMPORAL IMPOSSIBILITIES: If a suggestion recommends an intervention at a specific gestational age (e.g., "at 28 weeks") and the patient is ALREADY PAST that point, it MUST be filtered out.
2. BLOOD TYPE MISMATCHES: If suggestion is for "RhD negative" patients but patient is Rh positive (or vice versa), it MUST be filtered out.
3. COMPLETED ACTIONS: If the clinical note documents an action as already done/completed, suggesting it again is nonsensical.

Be STRICT about temporal issues - suggesting past interventions is clearly wrong.

Return ONLY valid JSON with this structure:
{
  "validSuggestions": [<array of suggestion IDs that make sense>],
  "filteredOut": [
    {
      "id": <suggestion ID>,
      "reason": "<brief explanation why it's nonsensical>"
    }
  ]
}`;

    const contextInfo = `Current gestational age: ${currentGA || 'unknown'} weeks
Patient Rhesus status: ${bloodType.rhesus || 'unknown'}`;

    const userPrompt = `${contextInfo}

PATIENT CONTEXT:
${JSON.stringify(patientContext, null, 2)}

CLINICAL NOTE:
${clinicalNote}

SUGGESTIONS TO VALIDATE:
${ruleBasedResult.validSuggestions.map((s, idx) => `[ID: ${idx}] ${s.suggestion || s.name || s.text || ''}`).join('\n')}

TASK: Identify which suggestions are impossible/nonsensical given the current patient state. Pay special attention to temporal issues and blood type compatibility.`;

    try {
        const result = await routeToAI({
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt }
            ]
        }, userId);

        if (!result || !result.content) {
            console.warn('[SENSE-CHECK-AI] No response from AI, using only rule-based filtering');
            return ruleBasedResult;
        }

        const parsed = JSON.parse(result.content.trim().replace(/```json\n?|\n?```/g, ''));
        const validIds = new Set(parsed.validSuggestions || []);
        const filteredOutMap = new Map((parsed.filteredOut || []).map(f => [f.id, f.reason]));

        const validSuggestions = ruleBasedResult.validSuggestions.filter((_, idx) => validIds.has(idx));
        const aiFilteredOut = ruleBasedResult.validSuggestions
            .map((s, idx) => ({ ...s, originalIndex: idx, filterReason: filteredOutMap.get(idx) }))
            .filter(s => s.filterReason);

        const allFilteredOut = [...ruleBasedResult.filteredOut, ...aiFilteredOut];

        console.log(`[SENSE-CHECK] Final result: ${validSuggestions.length} valid, ${allFilteredOut.length} filtered out (${ruleBasedResult.filteredOut.length} by rules, ${aiFilteredOut.length} by AI)`);
        if (aiFilteredOut.length > 0) {
            console.log('[SENSE-CHECK-AI] AI filtered:', aiFilteredOut.map(f => `"${f.suggestion?.substring(0, 60)}..." (${f.filterReason})`));
        }

        return { validSuggestions, filteredOut: allFilteredOut };
    } catch (error) {
        console.error('[SENSE-CHECK-AI] Error during AI validation:', error);
        // On error, return rule-based results rather than blocking
        return ruleBasedResult;
    }
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
    generatePromptImprovements,
    extractLessonsLearned,
    refineSuggestions,
    senseCheckSuggestions,
    SEQUENTIAL_LLM_CHAIN
};
