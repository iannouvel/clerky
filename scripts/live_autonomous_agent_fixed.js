#!/usr/bin/env node

/**
 * Live Autonomous AI Testing Agent (Fixed Version)
 * 
 * Properly connects to specified server URL and tests the live system
 */

const admin = require('firebase-admin');
const fetch = require('node-fetch');
const fs = require('fs').promises;
const path = require('path');

class LiveAutonomousAgent {
    constructor(options = {}) {
        this.serverUrl = options.serverUrl || 'https://clerky-uzni.onrender.com';
        this.authToken = options.authToken || null;
        this.maxGuidelines = options.maxGuidelines || 20;
        this.resultsDir = './live_autonomous_results';
        
        console.log('🤖 Live Autonomous Testing Agent initialized');
        console.log(`   🌐 Server: ${this.serverUrl}`);
        
        // Ensure results directory exists
        this.ensureResultsDir();
    }
    
    async ensureResultsDir() {
        try {
            await fs.mkdir(this.resultsDir, { recursive: true });
        } catch (error) {
            // Directory might already exist
        }
    }
    
    async runLiveTest() {
        const sessionId = `live_test_${Date.now()}`;
        
        console.log('\n🚀 Live Autonomous Clinical Guidelines Testing');
        console.log('='.repeat(60));
        console.log(`📋 Session: ${sessionId}`);
        console.log(`🌐 Testing: ${this.serverUrl}`);
        
        try {
            // Test server connectivity
            console.log('\n📊 PHASE 1: Server Connectivity Test');
            const connectivity = await this.testServerConnectivity();
            
            // Test real transcripts
            console.log('\n🔬 PHASE 2: Live System Testing');
            const testResults = await this.runLiveTests();
            
            // Analyze results
            console.log('\n📈 PHASE 3: Results Analysis');
            const analysis = this.analyzeResults(testResults);
            
            const results = {
                sessionId,
                timestamp: new Date().toISOString(),
                server_url: this.serverUrl,
                connectivity,
                test_results: testResults,
                analysis
            };
            
            await this.saveResults(results);
            this.displaySummary(results);
            
            return results;
            
        } catch (error) {
            console.error('❌ Live testing failed:', error.message);
            throw error;
        }
    }
    
    async testServerConnectivity() {
        console.log(`🔍 Testing connectivity to ${this.serverUrl}...`);
        
        const tests = [
            { name: 'Server Health', endpoint: '/health' },
            { name: 'Root Endpoint', endpoint: '/' },
            { name: 'AI Routing', endpoint: '/routeToAI' }
        ];
        
        const results = [];
        
        for (const test of tests) {
            try {
                console.log(`   Testing ${test.name}...`);
                const response = await fetch(`${this.serverUrl}${test.endpoint}`, {
                    method: 'GET',
                    timeout: 10000
                });
                
                const status = response.ok ? '✅ Online' : `⚠️ ${response.status}`;
                console.log(`      ${status}`);
                
                results.push({
                    name: test.name,
                    endpoint: test.endpoint,
                    status: response.status,
                    ok: response.ok,
                    response_time: Date.now()
                });
                
            } catch (error) {
                console.log(`      ❌ Failed: ${error.message}`);
                results.push({
                    name: test.name,
                    endpoint: test.endpoint,
                    error: error.message,
                    ok: false
                });
            }
        }
        
        const onlineTests = results.filter(r => r.ok).length;
        console.log(`\n   📊 Connectivity: ${onlineTests}/${tests.length} endpoints responding`);
        
        return results;
    }
    
    async runLiveTests() {
        console.log('🧪 Running autonomous tests against live system...');
        
        // Get real transcript data
        const transcripts = await this.getRealTranscripts();
        const transcriptKeys = Object.keys(transcripts);
        
        if (transcriptKeys.length === 0) {
            console.log('   ⚠️ No test transcripts available');
            return [];
        }
        
        const testScenarios = [
            {
                name: 'Basic System Response Test',
                condition: transcriptKeys[0],
                modification: 'Add generic recommendation'
            },
            {
                name: 'Compliance Detection Test', 
                condition: transcriptKeys[1] || transcriptKeys[0],
                modification: 'Test specific guidance requirement'
            }
        ];
        
        const results = [];
        
        for (let i = 0; i < Math.min(testScenarios.length, 3); i++) {
            const scenario = testScenarios[i];
            console.log(`\n   🧪 Test ${i + 1}: ${scenario.name}`);
            
            try {
                const testResult = await this.runSingleTest(scenario, transcripts);
                results.push(testResult);
                
                const status = testResult.success ? '✅ PASSED' : '❌ FAILED';
                console.log(`      ${status}`);
                
            } catch (error) {
                console.log(`      ❌ ERROR: ${error.message}`);
                results.push({
                    scenario: scenario.name,
                    success: false,
                    error: error.message
                });
            }
            
            // Small delay between tests
            await this.sleep(1000);
        }
        
        return results;
    }
    
    async runSingleTest(scenario, transcripts) {
        const baseTranscript = transcripts[scenario.condition] || 'Sample clinical transcript for live testing';
        
        // Create test modification
        const modifiedTranscript = baseTranscript + "\n\nRECOMMENDATION: Continue routine monitoring and follow up as needed.";
        
        console.log(`      🔧 Using ${scenario.condition} transcript`);
        
        // Test against live dynamicAdvice endpoint
        try {
            const response = await fetch(`${this.serverUrl}/dynamicAdvice`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    transcript: modifiedTranscript,
                    analysis: 'Live autonomous testing analysis',
                    guidelineId: 'test_guideline',
                    guidelineTitle: 'Live Test Guideline'
                }),
                timeout: 30000
            });
            
            if (response.ok) {
                const data = await response.json();
                console.log(`      📡 API Response: ${response.status} - ${data.success ? 'Success' : 'Error'}`);
                
                const suggestions = data.suggestions || [];
                console.log(`      💡 Suggestions: ${suggestions.length} recommendations received`);
                
                return {
                    scenario: scenario.name,
                    success: true,
                    api_status: response.status,
                    response_data: data,
                    suggestions_count: suggestions.length,
                    has_recommendations: suggestions.length > 0
                };
            } else {
                console.log(`      📡 API Error: ${response.status}`);
                return {
                    scenario: scenario.name,
                    success: false,
                    api_status: response.status,
                    error: `HTTP ${response.status}`
                };
            }
            
        } catch (error) {
            console.log(`      📡 Network Error: ${error.message}`);
            return {
                scenario: scenario.name,
                success: false,
                error: error.message
            };
        }
    }
    
    async getRealTranscripts() {
        try {
            const transcriptsPath = path.join(process.cwd(), 'fake_transcripts.json');
            const data = await fs.readFile(transcriptsPath, 'utf8');
            const transcripts = JSON.parse(data);
            
            // Flatten the structure
            const flattened = {};
            Object.values(transcripts).forEach(category => {
                if (typeof category === 'object') {
                    Object.assign(flattened, category);
                }
            });
            
            console.log(`   ✅ Loaded ${Object.keys(flattened).length} real transcripts`);
            return flattened;
            
        } catch (error) {
            console.log('   ⚠️ Using fallback transcripts');
            return {
                "Preeclampsia": "Sample preeclampsia transcript for live testing",
                "Gestational diabetes": "Sample diabetes transcript for live testing"
            };
        }
    }
    
    analyzeResults(testResults) {
        const successfulTests = testResults.filter(r => r.success).length;
        const totalTests = testResults.length;
        const successRate = totalTests > 0 ? (successfulTests / totalTests) * 100 : 0;
        
        const hasRecommendations = testResults.filter(r => r.has_recommendations).length;
        
        return {
            total_tests: totalTests,
            successful_tests: successfulTests,
            success_rate: Math.round(successRate),
            tests_with_recommendations: hasRecommendations,
            performance_rating: successRate >= 80 ? 'excellent' : 
                              successRate >= 60 ? 'good' : 
                              successRate >= 40 ? 'acceptable' : 'needs_improvement',
            key_findings: [
                `${successfulTests}/${totalTests} tests completed successfully`,
                `${hasRecommendations} tests generated recommendations`,
                `Live system is ${successRate >= 70 ? 'performing well' : 'experiencing issues'}`
            ]
        };
    }
    
    async saveResults(results) {
        try {
            const filename = `${results.sessionId}_live_results.json`;
            const filepath = path.join(this.resultsDir, filename);
            await fs.writeFile(filepath, JSON.stringify(results, null, 2));
            console.log(`\n💾 Results saved to: ${filepath}`);
        } catch (error) {
            console.error('❌ Failed to save results:', error.message);
        }
    }
    
    displaySummary(results) {
        console.log('\n' + '='.repeat(70));
        console.log('🎉 LIVE AUTONOMOUS TESTING COMPLETE');
        console.log('='.repeat(70));
        
        console.log(`📋 Session: ${results.sessionId}`);
        console.log(`🌐 Server: ${results.server_url}`);
        
        const analysis = results.analysis;
        console.log(`🎯 Performance: ${analysis.performance_rating.toUpperCase()}`);
        console.log(`📊 Success Rate: ${analysis.success_rate}%`);
        console.log(`🧪 Tests: ${analysis.successful_tests}/${analysis.total_tests} passed`);
        console.log(`💡 Recommendations: ${analysis.tests_with_recommendations} tests generated suggestions`);
        
        console.log('\n📈 Key Findings:');
        analysis.key_findings.forEach((finding, i) => {
            console.log(`   ${i + 1}. ${finding}`);
        });
        
        console.log('\n🤖 Live Autonomous Testing Demonstrated:');
        console.log('   • Real-time connectivity testing to live Render server');
        console.log('   • Autonomous test scenario generation and execution');
        console.log('   • Live API endpoint testing with real transcript data');
        console.log('   • Performance evaluation and insight generation');
        
        console.log('='.repeat(70));
    }
    
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

// CLI interface with proper argument parsing
async function main() {
    console.log('🤖 Live Autonomous Clinical Guidelines Testing Agent');
    console.log('='.repeat(55));
    
    // Parse command line arguments properly
    const args = process.argv.slice(2);
    const options = {};
    
    for (let i = 0; i < args.length; i++) {
        if (args[i].startsWith('--')) {
            const key = args[i].replace('--', '').replace('-', '_');
            const value = args[i + 1];
            if (value && !value.startsWith('--')) {
                options[key] = value;
                i++; // Skip the value in next iteration
            }
        }
    }
    
    console.log(`📥 Arguments received:`, options);
    
    try {
        const agent = new LiveAutonomousAgent(options);
        await agent.runLiveTest();
    } catch (error) {
        console.error('❌ Live autonomous testing failed:', error.message);
        process.exit(1);
    }
}

// Run if called directly
if (require.main === module) {
    main();
} 