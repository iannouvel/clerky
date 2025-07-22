#!/usr/bin/env node

/**
 * Autonomous AI Testing Agent for Clinical Guidelines System
 * 
 * This agent autonomously tests the accuracy of clinical guidelines recommendations
 * by reasoning about testing strategies rather than following pre-programmed logic.
 * 
 * The agent has access to:
 * - Firestore guidelines database
 * - Server API endpoints
 * - AI reasoning capabilities
 * 
 * Usage: node scripts/autonomous_agent.js
 */

const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs, limit, query } = require('firebase/firestore');
const fetch = require('node-fetch');
const fs = require('fs').promises;
const path = require('path');

// Firebase configuration (using your existing setup)
const firebaseConfig = {
    // Add your Firebase config here, or load from environment
    // For demo, we'll use a mock setup
};

class AutonomousTestingAgent {
    constructor(options = {}) {
        this.serverUrl = options.serverUrl || 'http://localhost:3000';
        this.authToken = options.authToken || null;
        this.maxGuidelines = options.maxGuidelines || 10;
        this.resultsDir = options.resultsDir || './autonomous_test_results';
        
        // Initialize Firebase
        if (options.firebaseConfig) {
            this.app = initializeApp(options.firebaseConfig);
            this.db = getFirestore(this.app);
        }
        
        console.log('🤖 Autonomous Testing Agent initialized');
        console.log(`   Server: ${this.serverUrl}`);
        console.log(`   Max Guidelines: ${this.maxGuidelines}`);
    }
    
    async runAutonomousSession(objectives = null) {
        if (!objectives) {
            objectives = [
                "Test if the system detects omitted critical safety steps",
                "Verify the system flags non-compliant clinical advice", 
                "Evaluate performance across different clinical conditions",
                "Identify areas where recommendations could be improved"
            ];
        }
        
        const sessionId = `autonomous_${Date.now()}`;
        console.log(`\n🚀 Starting Autonomous Testing Session: ${sessionId}`);
        console.log('📋 Objectives:', objectives.map(obj => `\n   • ${obj}`).join(''));
        
        try {
            // Phase 1: Autonomous Planning
            console.log('\n📊 PHASE 1: Autonomous Planning');
            const planning = await this.autonomousPlanning(objectives);
            
            // Phase 2: Autonomous Execution
            console.log('\n🔬 PHASE 2: Autonomous Execution');
            const execution = await this.autonomousExecution(planning);
            
            // Phase 3: Autonomous Analysis
            console.log('\n📈 PHASE 3: Autonomous Analysis');
            const analysis = await this.autonomousAnalysis(execution);
            
            // Save results
            const results = {
                sessionId,
                timestamp: new Date().toISOString(),
                objectives,
                planning,
                execution,
                analysis
            };
            
            await this.saveResults(results);
            
            // Display summary
            this.displaySummary(results);
            
            return results;
            
        } catch (error) {
            console.error('❌ Autonomous session failed:', error.message);
            throw error;
        }
    }
    
    async autonomousPlanning(objectives) {
        console.log('🧠 AI Agent analyzing available resources and planning strategy...');
        
        // Get available guidelines from Firestore or local data
        const guidelines = await this.getAvailableGuidelines();
        console.log(`   📚 Found ${guidelines.length} guidelines available for testing`);
        
        // Get available transcripts
        const transcripts = await this.getAvailableTranscripts();
        console.log(`   📝 Found ${Object.keys(transcripts).length} test transcripts available`);
        
        // Use AI to plan testing strategy
        const planningPrompt = `You are an autonomous AI testing agent for a clinical guidelines system. 

AVAILABLE RESOURCES:
- ${guidelines.length} clinical guidelines in database
- Sample guidelines: ${guidelines.slice(0, 3).map(g => g.title || g.id).join(', ')}
- Test transcripts for conditions: ${Object.keys(transcripts).join(', ')}

TESTING OBJECTIVES:
${objectives.map(obj => `- ${obj}`).join('\n')}

TASK: Design an intelligent testing strategy that will effectively evaluate the clinical guidelines system.

Consider:
1. Which guidelines are most critical to test (emergency conditions, high-risk scenarios)
2. What types of test modifications would reveal system weaknesses 
3. How to evaluate if the system responses are clinically appropriate

Return a JSON plan with this structure:
{
  "strategy_overview": "Brief description of your testing approach",
  "selected_guidelines": [
    {
      "guideline_id": "id_from_available_guidelines", 
      "rationale": "Why this guideline is important to test",
      "expected_safety_elements": ["key safety requirements to test"]
    }
  ],
  "test_scenarios": [
    {
      "name": "Descriptive test name",
      "guideline_target": "guideline_id", 
      "transcript_type": "clinical_condition_to_use",
      "modification_strategy": "how to introduce compliance issue",
      "success_criteria": "what indicates the test passed"
    }
  ],
  "evaluation_approach": "How to assess if system responses are appropriate"
}

Focus on the most impactful tests that would reveal critical safety issues.`;

        const planningResult = await this.callAIReasoning(planningPrompt);
        
        try {
            const plan = JSON.parse(planningResult);
            console.log(`   ✅ Strategy: ${plan.strategy_overview}`);
            console.log(`   🎯 Selected ${plan.selected_guidelines?.length || 0} guidelines for testing`);
            console.log(`   🧪 Designed ${plan.test_scenarios?.length || 0} test scenarios`);
            return plan;
        } catch (error) {
            console.log('   ⚠️ AI planning resulted in non-JSON response, using fallback strategy');
            return this.createFallbackPlan(guidelines, transcripts);
        }
    }
    
    async autonomousExecution(plan) {
        console.log('🔧 AI Agent executing planned test scenarios...');
        
        const results = [];
        const scenarios = plan.test_scenarios || [];
        
        for (let i = 0; i < scenarios.length; i++) {
            const scenario = scenarios[i];
            console.log(`\n   🧪 Test ${i + 1}/${scenarios.length}: ${scenario.name}`);
            
            try {
                const testResult = await this.executeTestScenario(scenario, plan);
                results.push(testResult);
                
                const status = testResult.evaluation?.passed ? '✅ PASSED' : '❌ FAILED';
                const confidence = testResult.evaluation?.confidence || 0;
                console.log(`      ${status} (Confidence: ${(confidence * 100).toFixed(0)}%)`);
                
                // Brief pause between tests
                await this.sleep(1000);
                
            } catch (error) {
                console.log(`      ❌ ERROR: ${error.message}`);
                results.push({
                    scenario: scenario.name,
                    status: 'error',
                    error: error.message
                });
            }
        }
        
        console.log(`\n   📊 Execution complete: ${results.filter(r => r.evaluation?.passed).length}/${results.length} tests passed`);
        
        return {
            total_scenarios: scenarios.length,
            completed_tests: results.filter(r => r.status !== 'error').length,
            results
        };
    }
    
    async executeTestScenario(scenario, planContext) {
        // Let AI create a test modification for this scenario
        const modificationPrompt = `You are executing an autonomous test scenario for a clinical guidelines system.

SCENARIO TO EXECUTE:
${JSON.stringify(scenario, null, 2)}

TASK: Create a realistic clinical transcript modification that tests this scenario.

Available transcript types: ${Object.keys(await this.getAvailableTranscripts()).join(', ')}

Return a JSON object:
{
  "original_transcript": "base clinical transcript text",
  "modified_transcript": "transcript with test modification applied", 
  "modification_description": "what you changed and why",
  "expected_system_behavior": "how the system should respond to this modification"
}

Make the modification realistic but clear - it should test whether the system catches the compliance issue.`;

        const modificationResult = await this.callAIReasoning(modificationPrompt);
        
        let modification;
        try {
            modification = JSON.parse(modificationResult);
        } catch (error) {
            // Fallback to a simple modification
            const transcripts = await this.getAvailableTranscripts();
            const transcriptKeys = Object.keys(transcripts);
            const randomTranscript = transcripts[transcriptKeys[0]] || "Sample clinical transcript for testing";
            
            modification = {
                original_transcript: randomTranscript,
                modified_transcript: randomTranscript + "\n\nRecommendation: Continue routine monitoring as planned.",
                modification_description: "Added generic recommendation instead of specific guideline-based advice",
                expected_system_behavior: "System should provide more specific recommendations based on guidelines"
            };
        }
        
        // Test the system with the modified transcript
        console.log('      🔍 Testing system response...');
        const systemResponse = await this.testSystemResponse(modification.modified_transcript, scenario.guideline_target);
        
        // Let AI evaluate the results
        const evaluationPrompt = `Evaluate the results of this autonomous test scenario.

ORIGINAL SCENARIO:
${JSON.stringify(scenario, null, 2)}

MODIFICATION APPLIED:
${JSON.stringify(modification, null, 2)}

SYSTEM RESPONSE:
${JSON.stringify(systemResponse, null, 2)}

EVALUATION TASK: Did the system appropriately identify and address the compliance issue?

Return a JSON evaluation:
{
  "passed": true/false,
  "confidence": 0.0-1.0,
  "detected_issue": "what the system detected",
  "appropriateness": "how appropriate was the system response",
  "areas_for_improvement": ["specific suggestions"],
  "overall_assessment": "summary of test outcome"
}`;

        const evaluationResult = await this.callAIReasoning(evaluationPrompt);
        
        let evaluation;
        try {
            evaluation = JSON.parse(evaluationResult);
        } catch (error) {
            // Simple fallback evaluation
            const hasRecommendations = systemResponse.suggestions?.length > 0;
            evaluation = {
                passed: hasRecommendations,
                confidence: hasRecommendations ? 0.7 : 0.3,
                detected_issue: hasRecommendations ? "System provided recommendations" : "No recommendations provided",
                appropriateness: hasRecommendations ? "Reasonable response" : "Insufficient response",
                areas_for_improvement: ["More detailed evaluation needed"],
                overall_assessment: hasRecommendations ? "Basic functionality working" : "System may need improvement"
            };
        }
        
        return {
            scenario: scenario.name,
            status: 'completed',
            modification,
            system_response: systemResponse,
            evaluation,
            timestamp: new Date().toISOString()
        };
    }
    
    async autonomousAnalysis(execution) {
        console.log('📈 AI Agent analyzing overall test results and generating insights...');
        
        const analysisPrompt = `Analyze the complete results of an autonomous testing session for a clinical guidelines system.

EXECUTION RESULTS:
${JSON.stringify(execution, null, 2)}

ANALYSIS TASK: Provide comprehensive insights about system performance and areas for improvement.

Return a JSON analysis:
{
  "overall_performance": {
    "accuracy_percentage": 0-100,
    "performance_rating": "excellent|good|acceptable|needs_improvement",
    "confidence_level": "high|medium|low"
  },
  "key_findings": ["main discoveries about system performance"],
  "strengths": ["what the system does well"], 
  "weaknesses": ["areas where system struggles"],
  "risk_assessment": {
    "high_risk_areas": ["critical safety concerns"],
    "medium_risk_areas": ["important improvements needed"],
    "low_risk_areas": ["minor enhancements"]
  },
  "recommendations": [
    {
      "priority": "high|medium|low",
      "action": "specific recommendation",
      "rationale": "why this is important"
    }
  ]
}`;

        const analysisResult = await this.callAIReasoning(analysisPrompt);
        
        try {
            const analysis = JSON.parse(analysisResult);
            console.log(`   🎯 Performance: ${analysis.overall_performance?.performance_rating || 'unknown'}`);
            console.log(`   📊 Accuracy: ${analysis.overall_performance?.accuracy_percentage || 'unknown'}%`);
            return analysis;
        } catch (error) {
            // Fallback analysis
            const results = execution.results || [];
            const passedTests = results.filter(r => r.evaluation?.passed).length;
            const accuracy = results.length > 0 ? (passedTests / results.length) * 100 : 0;
            
            return {
                overall_performance: {
                    accuracy_percentage: Math.round(accuracy),
                    performance_rating: accuracy > 70 ? 'good' : 'needs_improvement',
                    confidence_level: 'medium'
                },
                key_findings: [
                    `System passed ${passedTests} out of ${results.length} autonomous tests`,
                    'Autonomous testing successfully demonstrated system capabilities'
                ],
                recommendations: [
                    {
                        priority: 'medium',
                        action: 'Continue autonomous testing with more scenarios',
                        rationale: 'Expanded testing will provide better insights'
                    }
                ]
            };
        }
    }
    
    async getAvailableGuidelines() {
        try {
            // Try to get from Firestore if available
            if (this.db) {
                const guidelinesRef = collection(this.db, 'guidelines');
                const q = query(guidelinesRef, limit(this.maxGuidelines));
                const snapshot = await getDocs(q);
                
                const guidelines = [];
                snapshot.forEach(doc => {
                    guidelines.push({
                        id: doc.id,
                        ...doc.data()
                    });
                });
                
                if (guidelines.length > 0) {
                    return guidelines;
                }
            }
            
            // Fallback to mock guidelines
            return [
                { id: 'preeclampsia_bjog_2019', title: 'Preeclampsia Management (BJOG 2019)', organisation: 'BJOG' },
                { id: 'pph_bjog_2016', title: 'Postpartum Hemorrhage (BJOG 2016)', organisation: 'BJOG' },
                { id: 'gestational_diabetes', title: 'Gestational Diabetes Management', organisation: 'NICE' },
                { id: 'preterm_labour', title: 'Preterm Labour Guidelines', organisation: 'RCOG' },
                { id: 'cervical_insufficiency', title: 'Cervical Insufficiency Management', organisation: 'ACOG' }
            ];
        } catch (error) {
            console.log('   ⚠️ Using mock guidelines data');
            return [
                { id: 'mock_guideline_1', title: 'Sample Clinical Guideline 1' },
                { id: 'mock_guideline_2', title: 'Sample Clinical Guideline 2' }
            ];
        }
    }
    
    async getAvailableTranscripts() {
        try {
            // Try to load from fake_transcripts.json
            const transcriptsPath = path.join(process.cwd(), 'fake_transcripts.json');
            const data = await fs.readFile(transcriptsPath, 'utf8');
            return JSON.parse(data);
        } catch (error) {
            // Fallback transcripts
            return {
                "Preeclampsia": "Sample preeclampsia clinical transcript for autonomous testing",
                "Gestational diabetes": "Sample gestational diabetes clinical transcript for autonomous testing",
                "Postpartum hemorrhage": "Sample postpartum hemorrhage clinical transcript for autonomous testing"
            };
        }
    }
    
    async testSystemResponse(transcript, guidelineId) {
        try {
            const response = await fetch(`${this.serverUrl}/dynamicAdvice`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(this.authToken && { 'Authorization': `Bearer ${this.authToken}` })
                },
                body: JSON.stringify({
                    transcript: transcript,
                    analysis: 'Autonomous testing analysis',
                    guidelineId: guidelineId,
                    guidelineTitle: 'Test Guideline'
                })
            });
            
            if (response.ok) {
                return await response.json();
            } else {
                return { error: `API error: ${response.status}` };
            }
        } catch (error) {
            return { error: error.message };
        }
    }
    
    async callAIReasoning(prompt) {
        try {
            // Use the server's AI routing endpoint
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
                            content: 'You are an expert autonomous testing agent for clinical systems. Provide structured, actionable responses in JSON format when requested.'
                        },
                        {
                            role: 'user', 
                            content: prompt
                        }
                    ]
                })
            });
            
            if (response.ok) {
                const result = await response.json();
                return result.content || result.response || '';
            } else {
                throw new Error(`AI service error: ${response.status}`);
            }
        } catch (error) {
            console.log(`   ⚠️ AI reasoning failed: ${error.message}`);
            return '{"error": "AI reasoning unavailable"}';
        }
    }
    
    createFallbackPlan(guidelines, transcripts) {
        return {
            strategy_overview: "Fallback testing strategy focusing on available guidelines and transcripts",
            selected_guidelines: guidelines.slice(0, 2).map(g => ({
                guideline_id: g.id,
                rationale: "Available for testing",
                expected_safety_elements: ["Standard safety requirements"]
            })),
            test_scenarios: [
                {
                    name: "Basic Compliance Test",
                    guideline_target: guidelines[0]?.id || "test_guideline",
                    transcript_type: Object.keys(transcripts)[0] || "test_transcript",
                    modification_strategy: "Add generic recommendation",
                    success_criteria: "System provides specific guidance"
                }
            ],
            evaluation_approach: "Check if system provides relevant recommendations"
        };
    }
    
    async saveResults(results) {
        try {
            await fs.mkdir(this.resultsDir, { recursive: true });
            
            const filename = `${results.sessionId}_results.json`;
            const filepath = path.join(this.resultsDir, filename);
            
            await fs.writeFile(filepath, JSON.stringify(results, null, 2));
            console.log(`\n💾 Results saved to: ${filepath}`);
        } catch (error) {
            console.error('❌ Failed to save results:', error.message);
        }
    }
    
    displaySummary(results) {
        console.log('\n' + '='.repeat(60));
        console.log('🎉 AUTONOMOUS TESTING SESSION COMPLETE');
        console.log('='.repeat(60));
        console.log(`📋 Session ID: ${results.sessionId}`);
        console.log(`⏰ Timestamp: ${new Date(results.timestamp).toLocaleString()}`);
        
        if (results.analysis?.overall_performance) {
            const perf = results.analysis.overall_performance;
            console.log(`🎯 Performance: ${perf.performance_rating?.toUpperCase() || 'UNKNOWN'}`);
            console.log(`📊 Accuracy: ${perf.accuracy_percentage || 'N/A'}%`);
        }
        
        const totalTests = results.execution?.total_scenarios || 0;
        const completedTests = results.execution?.completed_tests || 0;
        console.log(`🧪 Tests: ${completedTests}/${totalTests} completed`);
        
        if (results.analysis?.recommendations?.length > 0) {
            console.log('\n💡 Key Recommendations:');
            results.analysis.recommendations.slice(0, 3).forEach((rec, i) => {
                console.log(`   ${i + 1}. [${rec.priority?.toUpperCase()}] ${rec.action}`);
            });
        }
        
        console.log('\n🤖 This autonomous agent demonstrated:');
        console.log('   • Intelligent test planning based on available resources');
        console.log('   • Dynamic test scenario creation using AI reasoning');
        console.log('   • Autonomous evaluation of system responses');
        console.log('   • Actionable insights generation for system improvement');
        
        console.log('='.repeat(60));
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
    
    console.log('🤖 Autonomous Clinical Guidelines Testing Agent');
    console.log('='.repeat(50));
    
    try {
        const agent = new AutonomousTestingAgent(options);
        await agent.runAutonomousSession();
    } catch (error) {
        console.error('❌ Autonomous testing failed:', error.message);
        process.exit(1);
    }
}

// Export for use as module
module.exports = { AutonomousTestingAgent };

// Run if called directly
if (require.main === module) {
    main();
} 