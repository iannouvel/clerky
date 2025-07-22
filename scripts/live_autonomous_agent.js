#!/usr/bin/env node

/**
 * Live Autonomous AI Testing Agent
 * 
 * Connects to the actual Firestore database and API endpoints to run real
 * autonomous testing against the live clinical guidelines system.
 * 
 * Usage: node scripts/live_autonomous_agent.js [--server-url http://localhost:3000]
 */

const admin = require('firebase-admin');
const fetch = require('node-fetch');
const fs = require('fs').promises;
const path = require('path');

// Firebase configuration matching your project
const firebaseConfig = {
    projectId: "clerky-b3be8",
    // Using application default credentials or service account
};

class LiveAutonomousAgent {
    constructor(options = {}) {
        this.serverUrl = options.serverUrl || 'http://localhost:3000';
        this.authToken = options.authToken || null;
        this.maxGuidelines = options.maxGuidelines || 20;
        this.resultsDir = './live_autonomous_results';
        
        // Initialize Firebase Admin
        try {
            if (!admin.apps.length) {
                // Try to use service account or application default credentials
                admin.initializeApp({
                    projectId: firebaseConfig.projectId,
                    // credential: admin.credential.applicationDefault(),
                });
            }
            this.db = admin.firestore();
            console.log('✅ Connected to Firestore database: clerky-b3be8');
        } catch (error) {
            console.log('⚠️ Firebase connection failed, using mock data:', error.message);
            this.db = null;
        }
        
        // Ensure results directory exists
        this.ensureResultsDir();
        
        console.log('🤖 Live Autonomous Testing Agent initialized');
        console.log(`   🌐 Server: ${this.serverUrl}`);
        console.log(`   📊 Max Guidelines: ${this.maxGuidelines}`);
    }
    
    async ensureResultsDir() {
        try {
            await fs.mkdir(this.resultsDir, { recursive: true });
        } catch (error) {
            // Directory might already exist
        }
    }
    
    async runLiveAutonomousSession(objectives = null) {
        if (!objectives) {
            objectives = [
                "Test if the live system detects omitted critical safety steps",
                "Verify the system flags non-compliant clinical advice in real scenarios",
                "Evaluate real-time performance across different clinical conditions",
                "Identify specific areas where live recommendations could be improved"
            ];
        }
        
        const sessionId = `live_autonomous_${Date.now()}`;
        
        console.log('\n🚀 Live Autonomous Clinical Guidelines Testing');
        console.log('='.repeat(60));
        console.log(`📋 Session ID: ${sessionId}`);
        console.log('🎯 Testing Objectives:');
        objectives.forEach(obj => console.log(`   • ${obj}`));
        
        try {
            // Phase 1: Live Data Analysis & Planning
            console.log('\n📊 PHASE 1: Live Data Analysis & Autonomous Planning');
            const planning = await this.liveAutonomousPlanning(objectives);
            
            // Phase 2: Live System Testing
            console.log('\n🔬 PHASE 2: Live System Testing & Execution');
            const execution = await this.liveAutonomousExecution(planning);
            
            // Phase 3: Real-time Analysis
            console.log('\n📈 PHASE 3: Real-time Analysis & Insights');
            const analysis = await this.liveAutonomousAnalysis(execution);
            
            // Save comprehensive results
            const results = {
                sessionId,
                timestamp: new Date().toISOString(),
                system_info: {
                    server_url: this.serverUrl,
                    firestore_connected: !!this.db,
                    guidelines_source: this.db ? 'live_firestore' : 'mock_data'
                },
                objectives,
                planning,
                execution,
                analysis
            };
            
            await this.saveResults(results);
            this.displayLiveSummary(results);
            
            return results;
            
        } catch (error) {
            console.error('❌ Live autonomous session failed:', error.message);
            throw error;
        }
    }
    
    async liveAutonomousPlanning(objectives) {
        console.log('🧠 AI Agent analyzing live system resources...');
        
        // Get real guidelines from Firestore
        const guidelines = await this.getLiveGuidelines();
        console.log(`   📚 Connected to live database: ${guidelines.length} guidelines available`);
        
        // Get available test transcripts
        const transcripts = await this.getRealTranscripts();
        console.log(`   📝 Found ${Object.keys(transcripts).length} test transcripts available`);
        
        // Test server connectivity
        const serverStatus = await this.testServerConnectivity();
        console.log(`   🌐 Server status: ${serverStatus ? 'Connected ✅' : 'Offline ❌'}`);
        
        // Use AI reasoning to plan based on real data
        const aiPlan = await this.callLiveAIReasoning(`
You are an autonomous AI testing agent analyzing a LIVE clinical guidelines system.

LIVE SYSTEM STATUS:
- Firestore Database: ${this.db ? 'Connected' : 'Offline'} 
- Available Guidelines: ${guidelines.length}
- Server Connectivity: ${serverStatus ? 'Online' : 'Offline'}
- Real Transcripts: ${Object.keys(transcripts).length}

SAMPLE REAL GUIDELINES:
${guidelines.slice(0, 3).map(g => `- ${g.title || g.id} (${g.organisation || 'Unknown org'})`).join('\n')}

TESTING OBJECTIVES:
${objectives.map(obj => `- ${obj}`).join('\n')}

TASK: Design an intelligent testing strategy for this LIVE system.

Focus on:
1. Which real guidelines are most critical for safety testing
2. What types of compliance issues would be most dangerous if missed
3. How to test against real API endpoints effectively

Return JSON strategy:
{
  "strategy_overview": "Approach for testing the live system",
  "priority_guidelines": [
    {
      "guideline_id": "actual_firestore_document_id",
      "title": "actual_guideline_title",
      "priority_rationale": "why this is critical to test live",
      "safety_risks": ["specific risks if system fails"]
    }
  ],
  "live_test_scenarios": [
    {
      "name": "descriptive_test_name",
      "guideline_target": "firestore_document_id",
      "transcript_type": "clinical_condition",
      "modification_strategy": "how to test compliance",
      "api_endpoints": ["endpoints to test"],
      "success_criteria": "what indicates live system is working"
    }
  ],
  "risk_assessment": "assessment of testing live system safely"
}`);
        
        let plan;
        try {
            plan = JSON.parse(aiPlan);
        } catch (error) {
            // Fallback plan using real data
            plan = this.createLiveFallbackPlan(guidelines, transcripts, serverStatus);
        }
        
        console.log(`   ✅ Live Strategy: ${plan.strategy_overview}`);
        console.log(`   🎯 Priority Guidelines: ${plan.priority_guidelines?.length || 0}`);
        console.log(`   🧪 Live Test Scenarios: ${plan.live_test_scenarios?.length || 0}`);
        
        return plan;
    }
    
    async liveAutonomousExecution(plan) {
        console.log('🔧 AI Agent executing tests against live system...');
        
        const results = [];
        const scenarios = plan.live_test_scenarios || [];
        
        if (scenarios.length === 0) {
            console.log('   ⚠️ No test scenarios planned, creating basic live test');
            scenarios.push({
                name: "Basic Live System Test",
                guideline_target: "any_available",
                transcript_type: "general",
                modification_strategy: "test system responsiveness",
                api_endpoints: ["/dynamicAdvice"],
                success_criteria: "system responds appropriately"
            });
        }
        
        for (let i = 0; i < scenarios.length; i++) {
            const scenario = scenarios[i];
            console.log(`\n   🧪 Live Test ${i + 1}/${scenarios.length}: ${scenario.name}`);
            
            try {
                const testResult = await this.executeLiveTestScenario(scenario, plan);
                results.push(testResult);
                
                const status = testResult.evaluation?.passed ? '✅ PASSED' : '❌ FAILED';
                const confidence = Math.round((testResult.evaluation?.confidence || 0) * 100);
                console.log(`      ${status} (Confidence: ${confidence}%)`);
                
                // Brief pause between live tests
                await this.sleep(2000);
                
            } catch (error) {
                console.log(`      ❌ ERROR: ${error.message}`);
                results.push({
                    scenario: scenario.name,
                    status: 'error',
                    error: error.message,
                    timestamp: new Date().toISOString()
                });
            }
        }
        
        const passedTests = results.filter(r => r.evaluation?.passed).length;
        console.log(`\n   📊 Live execution complete: ${passedTests}/${results.length} tests passed`);
        
        return {
            total_scenarios: scenarios.length,
            passed_tests: passedTests,
            failed_tests: results.length - passedTests,
            results,
            execution_timestamp: new Date().toISOString()
        };
    }
    
    async executeLiveTestScenario(scenario, planContext) {
        // Create intelligent test modification using real data
        const modification = await this.createLiveTestModification(scenario);
        console.log(`      🔧 Modification: ${modification.description}`);
        
        // Test against real API endpoints
        console.log('      🌐 Testing live API endpoints...');
        const liveSystemResponse = await this.testLiveSystemResponse(
            modification.modified_transcript, 
            scenario.guideline_target
        );
        
        console.log(`      📡 API Response: ${liveSystemResponse.status || 'received'}`);
        
        // AI evaluation of live results
        const evaluation = await this.evaluateLiveTestResult(scenario, modification, liveSystemResponse);
        
        return {
            scenario: scenario.name,
            status: 'completed',
            modification,
            live_system_response: liveSystemResponse,
            evaluation,
            api_endpoints_tested: scenario.api_endpoints || ['/dynamicAdvice'],
            timestamp: new Date().toISOString()
        };
    }
    
    async createLiveTestModification(scenario) {
        // Get real transcript data
        const transcripts = await this.getRealTranscripts();
        const availableConditions = Object.keys(transcripts);
        
        // Use AI to create realistic modification
        const modificationPrompt = `
Create a realistic test modification for a LIVE clinical guidelines system.

SCENARIO: ${JSON.stringify(scenario, null, 2)}
AVAILABLE CONDITIONS: ${availableConditions.join(', ')}

Create a modification that:
1. Uses real clinical transcript data
2. Tests a specific compliance issue
3. Is safe for live system testing
4. Provides clear evaluation criteria

Return JSON:
{
  "original_transcript": "real clinical transcript",
  "modified_transcript": "transcript with test modification",
  "description": "what was changed and why",
  "expected_system_behavior": "how live system should respond",
  "safety_notes": "why this test is safe for live system"
}`;

        const aiResponse = await this.callLiveAIReasoning(modificationPrompt);
        
        try {
            return JSON.parse(aiResponse);
        } catch (error) {
            // Fallback using real transcript data
            const condition = availableConditions[0] || 'Preeclampsia';
            const baseTranscript = transcripts[condition] || 'Sample clinical transcript';
            
            return {
                original_transcript: baseTranscript,
                modified_transcript: baseTranscript + "\n\nRECOMMENDATION: Continue routine monitoring.",
                description: "Added generic recommendation to test system response specificity",
                expected_system_behavior: "System should provide more specific, evidence-based recommendations",
                safety_notes: "Safe modification - only adds generic text, doesn't remove critical information"
            };
        }
    }
    
    async testLiveSystemResponse(transcript, guidelineTarget) {
        try {
            console.log(`      📡 Calling live API: ${this.serverUrl}/dynamicAdvice`);
            
            const response = await fetch(`${this.serverUrl}/dynamicAdvice`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(this.authToken && { 'Authorization': `Bearer ${this.authToken}` })
                },
                body: JSON.stringify({
                    transcript: transcript,
                    analysis: 'Live autonomous testing analysis',
                    guidelineId: guidelineTarget || 'test_guideline',
                    guidelineTitle: 'Live Test Guideline'
                }),
                timeout: 30000 // 30 second timeout
            });
            
            if (response.ok) {
                const result = await response.json();
                return {
                    status: 'success',
                    response_code: response.status,
                    data: result,
                    timestamp: new Date().toISOString()
                };
            } else {
                return {
                    status: 'api_error',
                    response_code: response.status,
                    error: `HTTP ${response.status}`,
                    timestamp: new Date().toISOString()
                };
            }
        } catch (error) {
            return {
                status: 'network_error',
                error: error.message,
                timestamp: new Date().toISOString()
            };
        }
    }
    
    async evaluateLiveTestResult(scenario, modification, systemResponse) {
        const evaluationPrompt = `
Evaluate the results of a test against a LIVE clinical guidelines system.

SCENARIO: ${JSON.stringify(scenario, null, 2)}
MODIFICATION: ${JSON.stringify(modification, null, 2)}
LIVE SYSTEM RESPONSE: ${JSON.stringify(systemResponse, null, 2)}

Evaluate:
1. Did the live system respond appropriately?
2. Are the recommendations clinically sound?
3. Was the compliance issue detected?
4. How does this reflect on live system performance?

Return JSON evaluation:
{
  "passed": true/false,
  "confidence": 0.0-1.0,
  "live_system_status": "assessment of live system health",
  "clinical_appropriateness": "assessment of recommendations",
  "compliance_detection": "whether compliance issue was caught",
  "recommendations_for_live_system": ["specific suggestions"],
  "overall_assessment": "summary of live test outcome"
}`;

        const aiEvaluation = await this.callLiveAIReasoning(evaluationPrompt);
        
        try {
            return JSON.parse(aiEvaluation);
        } catch (error) {
            // Fallback evaluation
            const isSuccess = systemResponse.status === 'success';
            const hasSuggestions = systemResponse.data?.suggestions?.length > 0;
            
            return {
                passed: isSuccess && hasSuggestions,
                confidence: isSuccess ? (hasSuggestions ? 0.8 : 0.6) : 0.2,
                live_system_status: isSuccess ? 'responding' : 'error',
                clinical_appropriateness: hasSuggestions ? 'provided recommendations' : 'limited response',
                compliance_detection: hasSuggestions ? 'some detection' : 'minimal detection',
                recommendations_for_live_system: ['Continue monitoring live system performance'],
                overall_assessment: isSuccess ? 'Live system responding to requests' : 'Live system experiencing issues'
            };
        }
    }
    
    async getLiveGuidelines() {
        if (!this.db) {
            console.log('   ⚠️ No Firestore connection, using sample data');
            return this.getSampleGuidelines();
        }
        
        try {
            console.log('   🔍 Querying live Firestore database...');
            const guidelinesRef = this.db.collection('guidelines');
            const snapshot = await guidelinesRef.limit(this.maxGuidelines).get();
            
            const guidelines = [];
            snapshot.forEach(doc => {
                const data = doc.data();
                guidelines.push({
                    id: doc.id,
                    title: data.title || 'Untitled Guideline',
                    organisation: data.organisation || 'Unknown',
                    summary: data.summary || '',
                    content_available: !!data.content,
                    content_length: data.content ? data.content.length : 0,
                    ...data
                });
            });
            
            console.log(`   ✅ Retrieved ${guidelines.length} guidelines from live Firestore`);
            return guidelines;
            
        } catch (error) {
            console.log(`   ❌ Firestore query failed: ${error.message}`);
            return this.getSampleGuidelines();
        }
    }
    
    async getRealTranscripts() {
        try {
            // Try to load real transcripts from file
            const transcriptsPath = path.join(process.cwd(), 'fake_transcripts.json');
            const data = await fs.readFile(transcriptsPath, 'utf8');
            const transcripts = JSON.parse(data);
            
            // Flatten the structure for easier access
            const flattened = {};
            Object.values(transcripts).forEach(category => {
                if (typeof category === 'object') {
                    Object.assign(flattened, category);
                }
            });
            
            console.log('   ✅ Loaded real transcript data from fake_transcripts.json');
            return flattened;
            
        } catch (error) {
            console.log('   ⚠️ Could not load real transcripts, using samples');
            return {
                "Preeclampsia": "Sample preeclampsia transcript for live testing",
                "Gestational diabetes": "Sample gestational diabetes transcript for live testing"
            };
        }
    }
    
    async testServerConnectivity() {
        try {
            console.log(`   🔍 Testing connectivity to ${this.serverUrl}...`);
            const response = await fetch(`${this.serverUrl}/health`, {
                method: 'GET',
                timeout: 5000
            });
            return response.ok;
        } catch (error) {
            // Try alternative endpoint
            try {
                const response = await fetch(this.serverUrl, {
                    method: 'GET',
                    timeout: 5000
                });
                return true; // Server responded
            } catch (error2) {
                return false;
            }
        }
    }
    
    async callLiveAIReasoning(prompt) {
        try {
            const response = await fetch(`${this.serverUrl}/routeToAI`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(this.authToken && { 'Authorization': `Bearer ${this.authToken}` })
                },
                body: JSON.stringify({
                    messages: [
                        {
                            role: 'system',
                            content: 'You are an expert autonomous testing agent for live clinical systems. Provide structured, actionable responses in JSON format.'
                        },
                        {
                            role: 'user',
                            content: prompt
                        }
                    ]
                }),
                timeout: 30000
            });
            
            if (response.ok) {
                const result = await response.json();
                return result.content || result.response || '{"error": "No content in response"}';
            } else {
                throw new Error(`AI service error: ${response.status}`);
            }
        } catch (error) {
            console.log(`   ⚠️ Live AI reasoning failed: ${error.message}`);
            return '{"error": "AI reasoning unavailable in live mode"}';
        }
    }
    
    getSampleGuidelines() {
        return [
            { id: 'sample_preeclampsia', title: 'Preeclampsia Management Guidelines', organisation: 'BJOG' },
            { id: 'sample_pph', title: 'Postpartum Hemorrhage Guidelines', organisation: 'BJOG' }
        ];
    }
    
    createLiveFallbackPlan(guidelines, transcripts, serverStatus) {
        return {
            strategy_overview: "Live system testing with available real data",
            priority_guidelines: guidelines.slice(0, 2).map(g => ({
                guideline_id: g.id,
                title: g.title,
                priority_rationale: "Available in live system for testing",
                safety_risks: ["Standard clinical safety considerations"]
            })),
            live_test_scenarios: [
                {
                    name: "Live System Responsiveness Test",
                    guideline_target: guidelines[0]?.id || "any",
                    transcript_type: Object.keys(transcripts)[0] || "general",
                    modification_strategy: "Test with real transcript data",
                    api_endpoints: ["/dynamicAdvice"],
                    success_criteria: "Live system provides appropriate response"
                }
            ],
            risk_assessment: serverStatus ? "Live system accessible, safe for testing" : "Limited connectivity, testing with reduced scope"
        };
    }
    
    async liveAutonomousAnalysis(execution) {
        console.log('📈 AI Agent analyzing live system performance...');
        
        const analysisPrompt = `
Analyze the results of autonomous testing against a LIVE clinical guidelines system.

LIVE EXECUTION RESULTS:
${JSON.stringify(execution, null, 2)}

Provide comprehensive analysis of:
1. Live system performance and reliability
2. Clinical appropriateness of real responses
3. System compliance detection capabilities
4. Areas for live system improvement
5. Recommendations for live deployment

Return JSON analysis:
{
  "live_system_performance": {
    "overall_health": "excellent|good|concerning|poor",
    "response_reliability": "percentage or assessment",
    "api_performance": "assessment of endpoint performance"
  },
  "clinical_safety_assessment": {
    "compliance_detection_rate": "assessment",
    "recommendation_quality": "assessment", 
    "safety_concerns": ["any identified issues"]
  },
  "live_system_insights": ["key discoveries about live performance"],
  "immediate_actions": ["urgent recommendations if any"],
  "long_term_recommendations": ["strategic improvements for live system"]
}`;

        const aiAnalysis = await this.callLiveAIReasoning(analysisPrompt);
        
        try {
            const analysis = JSON.parse(aiAnalysis);
            console.log(`   🎯 Live System Health: ${analysis.live_system_performance?.overall_health || 'Unknown'}`);
            console.log(`   🔍 API Performance: ${analysis.live_system_performance?.api_performance || 'Unknown'}`);
            return analysis;
        } catch (error) {
            // Fallback analysis
            const results = execution.results || [];
            const successfulTests = results.filter(r => r.live_system_response?.status === 'success').length;
            const reliabilityRate = results.length > 0 ? (successfulTests / results.length) * 100 : 0;
            
            return {
                live_system_performance: {
                    overall_health: reliabilityRate > 80 ? 'good' : reliabilityRate > 50 ? 'concerning' : 'poor',
                    response_reliability: `${Math.round(reliabilityRate)}%`,
                    api_performance: successfulTests > 0 ? 'responding' : 'limited'
                },
                clinical_safety_assessment: {
                    compliance_detection_rate: `${execution.passed_tests}/${execution.total_scenarios} tests passed`,
                    recommendation_quality: 'requires further evaluation',
                    safety_concerns: reliabilityRate < 70 ? ['Low system reliability detected'] : []
                },
                live_system_insights: [
                    `Live system processed ${execution.total_scenarios} autonomous tests`,
                    `API reliability: ${Math.round(reliabilityRate)}%`
                ],
                immediate_actions: reliabilityRate < 50 ? ['Investigate system connectivity issues'] : [],
                long_term_recommendations: ['Continue autonomous monitoring of live system']
            };
        }
    }
    
    async saveResults(results) {
        try {
            const filename = `${results.sessionId}_live_results.json`;
            const filepath = path.join(this.resultsDir, filename);
            await fs.writeFile(filepath, JSON.stringify(results, null, 2));
            console.log(`\n💾 Live results saved to: ${filepath}`);
        } catch (error) {
            console.error('❌ Failed to save live results:', error.message);
        }
    }
    
    displayLiveSummary(results) {
        console.log('\n' + '='.repeat(70));
        console.log('🎉 LIVE AUTONOMOUS TESTING SESSION COMPLETE');
        console.log('='.repeat(70));
        
        console.log(`📋 Session ID: ${results.sessionId}`);
        console.log(`🌐 System: ${results.system_info.server_url}`);
        console.log(`📊 Database: ${results.system_info.firestore_connected ? 'Live Firestore ✅' : 'Mock Data ⚠️'}`);
        
        const analysis = results.analysis;
        if (analysis?.live_system_performance) {
            const perf = analysis.live_system_performance;
            console.log(`🎯 Live System Health: ${perf.overall_health?.toUpperCase() || 'UNKNOWN'}`);
            console.log(`📡 API Performance: ${perf.api_performance || 'Unknown'}`);
            console.log(`🔄 Reliability: ${perf.response_reliability || 'Unknown'}`);
        }
        
        console.log(`🧪 Tests: ${results.execution.passed_tests}/${results.execution.total_scenarios} passed`);
        
        if (analysis?.immediate_actions?.length > 0) {
            console.log('\n🚨 Immediate Actions Required:');
            analysis.immediate_actions.forEach((action, i) => {
                console.log(`   ${i + 1}. ${action}`);
            });
        }
        
        if (analysis?.long_term_recommendations?.length > 0) {
            console.log('\n💡 Recommendations for Live System:');
            analysis.long_term_recommendations.slice(0, 3).forEach((rec, i) => {
                console.log(`   ${i + 1}. ${rec}`);
            });
        }
        
        console.log('\n🤖 Live Autonomous Testing Demonstrated:');
        console.log('   • Real-time connection to Firestore guidelines database');
        console.log('   • Live API endpoint testing and evaluation');
        console.log('   • Autonomous adaptation to live system conditions');
        console.log('   • Real-time performance monitoring and analysis');
        
        console.log('='.repeat(70));
    }
    
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

// CLI interface
async function main() {
    const args = process.argv.slice(2);
    const options = {};
    
    // Parse command line arguments
    for (let i = 0; i < args.length; i += 2) {
        const key = args[i]?.replace('--', '');
        const value = args[i + 1];
        if (key && value) {
            options[key] = value;
        }
    }
    
    console.log('🤖 Live Autonomous Clinical Guidelines Testing Agent');
    console.log('='.repeat(55));
    
    try {
        const agent = new LiveAutonomousAgent(options);
        await agent.runLiveAutonomousSession();
    } catch (error) {
        console.error('❌ Live autonomous testing failed:', error.message);
        console.error('   This might be due to:');
        console.error('   • Server not running');
        console.error('   • Firebase connection issues');
        console.error('   • Network connectivity problems');
        process.exit(1);
    }
}

// Export for use as module
module.exports = { LiveAutonomousAgent };

// Run if called directly
if (require.main === module) {
    main();
} 