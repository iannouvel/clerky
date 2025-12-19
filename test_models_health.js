/**
 * Cheap Model Health Check
 * Tests all 5 AI models with minimal tokens (~2 input, ~1 output per model)
 * Estimated total cost: < $0.0001 (fraction of a cent)
 * 
 * Usage: node test_models_health.js [local|deployed]
 */

require('dotenv').config();
const axios = require('axios');

// Configuration
const isLocal = process.argv[2] === 'local';
const SERVER_URL = isLocal ? 'http://localhost:3000' : 'https://clerky-uzni.onrender.com';

// The 5 chunk distribution models
const MODELS = [
    { name: 'DeepSeek', model: 'deepseek-chat', endpoint: 'https://api.deepseek.com/v1/chat/completions', keyEnv: 'DEEPSEEK_API_KEY' },
    { name: 'Mistral', model: 'mistral-large-latest', endpoint: 'https://api.mistral.ai/v1/chat/completions', keyEnv: 'MISTRAL_API_KEY' },
    { name: 'Anthropic', model: 'claude-3-haiku-20240307', endpoint: 'https://api.anthropic.com/v1/messages', keyEnv: 'ANTHROPIC_API_KEY' },
    { name: 'OpenAI', model: 'gpt-3.5-turbo', endpoint: 'https://api.openai.com/v1/chat/completions', keyEnv: 'OPENAI_API_KEY' },
    { name: 'Gemini', model: 'gemini-2.5-flash', endpoint: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent', keyEnv: 'GOOGLE_AI_API_KEY' }
];

// Minimal prompt - uses ~2 input tokens, expects ~1 output token
const MINIMAL_PROMPT = 'Say OK';

async function testModelDirect(modelConfig) {
    const { name, model, endpoint, keyEnv } = modelConfig;
    const apiKey = process.env[keyEnv];
    
    if (!apiKey) {
        return { name, status: 'SKIP', message: `No ${keyEnv} set`, ms: 0 };
    }

    const startTime = Date.now();
    
    try {
        let response;
        
        if (name === 'Anthropic') {
            response = await axios.post(endpoint, {
                model,
                messages: [{ role: 'user', content: MINIMAL_PROMPT }],
                max_tokens: 10
            }, {
                headers: {
                    'x-api-key': apiKey,
                    'Content-Type': 'application/json',
                    'anthropic-version': '2023-06-01'
                },
                timeout: 15000
            });
        } else if (name === 'Gemini') {
            const url = `${endpoint}?key=${apiKey}`;
            response = await axios.post(url, {
                contents: [{ parts: [{ text: MINIMAL_PROMPT }] }],
                generationConfig: { maxOutputTokens: 10 }
            }, {
                headers: { 'Content-Type': 'application/json' },
                timeout: 15000
            });
        } else {
            // OpenAI, DeepSeek, Mistral all use the same format
            response = await axios.post(endpoint, {
                model,
                messages: [{ role: 'user', content: MINIMAL_PROMPT }],
                max_tokens: 10
            }, {
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json'
                },
                timeout: 15000
            });
        }

        const ms = Date.now() - startTime;
        
        // Extract response content
        let content = '';
        if (name === 'Anthropic') {
            content = response.data?.content?.[0]?.text || '';
        } else if (name === 'Gemini') {
            content = response.data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
        } else {
            content = response.data?.choices?.[0]?.message?.content || '';
        }

        return { name, status: 'OK', message: content.trim().substring(0, 20), ms };
        
    } catch (error) {
        const ms = Date.now() - startTime;
        const errMsg = error.response?.data?.error?.message || error.response?.data?.message || error.message;
        return { name, status: 'FAIL', message: errMsg.substring(0, 50), ms };
    }
}

async function runHealthCheck() {
    console.log('🔍 AI Model Health Check (Minimal Tokens)\n');
    console.log(`Mode: ${isLocal ? 'Direct API calls' : 'Direct API calls'}`);
    console.log(`Time: ${new Date().toISOString()}\n`);
    console.log('─'.repeat(60));
    
    // Run all tests in parallel for speed
    const results = await Promise.all(MODELS.map(testModelDirect));
    
    // Display results
    let passCount = 0;
    let failCount = 0;
    let skipCount = 0;
    
    for (const result of results) {
        const icon = result.status === 'OK' ? '✅' : result.status === 'SKIP' ? '⏭️' : '❌';
        const statusColour = result.status === 'OK' ? '\x1b[32m' : result.status === 'SKIP' ? '\x1b[33m' : '\x1b[31m';
        const reset = '\x1b[0m';
        
        console.log(`${icon} ${statusColour}${result.name.padEnd(12)}${reset} ${result.status.padEnd(4)} ${result.ms.toString().padStart(5)}ms  ${result.message}`);
        
        if (result.status === 'OK') passCount++;
        else if (result.status === 'FAIL') failCount++;
        else skipCount++;
    }
    
    console.log('─'.repeat(60));
    console.log(`\n📊 Summary: ${passCount} passed, ${failCount} failed, ${skipCount} skipped`);
    console.log(`💰 Estimated cost: < $0.0001 (fraction of a cent)\n`);
    
    // Exit with error code if any failures
    if (failCount > 0) {
        console.log('⚠️  Some models are not responding correctly!\n');
        process.exit(1);
    } else {
        console.log('✨ All available models are healthy!\n');
        process.exit(0);
    }
}

// Run the health check
runHealthCheck().catch(err => {
    console.error('Fatal error:', err.message);
    process.exit(1);
});

