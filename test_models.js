const axios = require('axios');

// Test configuration
const testPrompt = "What are the key considerations for managing gestational diabetes?";
const SERVER_URL = 'https://clerky-uzni.onrender.com'; // Use deployed URL
const models = [
    { provider: 'OpenAI', model: 'gpt-3.5-turbo' },
    { provider: 'DeepSeek', model: 'deepseek-chat' },
    { provider: 'Anthropic', model: 'claude-3-sonnet-20240229' },
    { provider: 'Mistral', model: 'mistral-large-latest' }
];

async function testModel(provider, model) {
    try {
        console.log(`\n🧪 Testing ${provider} (${model})...`);
        
        const response = await axios.post(`${SERVER_URL}/SendToAI`, {
            prompt: testPrompt,
            userId: 'test-user'
        }, {
            headers: {
                'Content-Type': 'application/json'
            },
            timeout: 30000 // 30 second timeout
        });
        
        if (response.data && response.data.content) {
            console.log(`✅ ${provider} working! Response length: ${response.data.content.length} characters`);
            console.log(`📊 Provider used: ${response.data.ai_provider}, Model: ${response.data.ai_model}`);
            if (response.data.token_usage) {
                console.log(`💰 Estimated cost: $${response.data.token_usage.estimated_cost_usd?.toFixed(6) || 'unknown'}`);
            }
            // Show first 100 characters of response
            console.log(`📝 Response preview: ${response.data.content.substring(0, 100)}...`);
        } else {
            console.log(`❌ ${provider} failed - no content in response`);
        }
    } catch (error) {
        console.log(`❌ ${provider} failed: ${error.response?.data?.message || error.message}`);
        if (error.response?.status) {
            console.log(`   Status: ${error.response.status}`);
        }
    }
}

async function runTests() {
    console.log('🚀 Starting AI Model Tests on deployed server...\n');
    console.log(`🌐 Server URL: ${SERVER_URL}\n`);
    
    for (const { provider, model } of models) {
        await testModel(provider, model);
        // Small delay between tests
        await new Promise(resolve => setTimeout(resolve, 2000));
    }
    
    console.log('\n✨ Test complete!');
}

// Run the tests
runTests().catch(console.error); 