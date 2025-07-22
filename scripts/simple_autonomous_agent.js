#!/usr/bin/env node

/**
 * Simple Autonomous AI Testing Agent
 * 
 * Demonstrates autonomous testing by reasoning about test strategies
 * and executing them against your clinical guidelines system.
 * 
 * Usage: node scripts/simple_autonomous_agent.js
 */

const fs = require('fs');
const path = require('path');

class SimpleAutonomousAgent {
    constructor(options = {}) {
        this.serverUrl = options.serverUrl || 'http://localhost:3000';
        this.resultsDir = './autonomous_test_results';
        
        // Ensure results directory exists
        if (!fs.existsSync(this.resultsDir)) {
            fs.mkdirSync(this.resultsDir, { recursive: true });
        }
        
        console.log('🤖 Simple Autonomous Testing Agent initialized');
        console.log(`   Server: ${this.serverUrl}`);
    }
    
    async runAutonomousSession(objectives = null) {
        if (!objectives) {
            objectives = [
                "Test if system detects omitted critical safety steps",
                "Verify system flags non-compliant clinical advice",
                "Evaluate performance across different clinical scenarios"
            ];
        }
        
        const sessionId = `autonomous_${Date.now()}`;
        
        console.log('\n🚀 Autonomous Clinical Guidelines Testing Agent');
        console.log('='.repeat(55));
        console.log(`📋 Session ID: ${sessionId}`);
        console.log('🎯 Objectives:');
        objectives.forEach(obj => console.log(`   • ${obj}`));
        
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
            
            // Save and display results
            const results = {
                sessionId,
                timestamp: new Date().toISOString(),
                objectives,
                planning,
                execution,
                analysis
            };
            
            this.saveResults(results);
            this.displaySummary(results);
            
            return results;
            
        } catch (error) {
            console.error('❌ Session failed:', error.message);
            throw error;
        }
    }
    
    async autonomousPlanning(objectives) {
        console.log('🧠 AI Agent analyzing resources and planning strategy...');
        
        // Get available data
        const guidelines = this.getAvailableGuidelines();
        const transcripts = this.getAvailableTranscripts();
        
        console.log(`   📚 Found ${guidelines.length} guidelines available`);
        console.log(`   📝 Found ${Object.keys(transcripts).length} transcript types available`);
        
        // Simulate AI reasoning about strategy
        await this.sleep(1000);
        
        const strategy = {
            approach: "Focus on high-risk clinical scenarios where safety compliance is critical",
            selected_guidelines: [
                {
                    id: "preeclampsia_management",
                    title: "Preeclampsia Management Guidelines", 
                    rationale: "High-risk condition with time-sensitive interventions",
                    safety_focus: ["Blood pressure monitoring", "Magnesium sulfate administration", "Delivery timing"]
                },
                {
                    id: "postpartum_hemorrhage",
                    title: "Postpartum Hemorrhage Management",
                    rationale: "Life-threatening emergency requiring immediate response", 
                    safety_focus: ["Uterine massage", "Medication sequence", "Escalation protocols"]
                }
            ],
            test_scenarios: [
                {
                    name: "Omitted Seizure Prophylaxis",
                    type: "safety_omission",
                    target_condition: "Preeclampsia",
                    test_strategy: "Remove magnesium sulfate recommendation from severe preeclampsia case",
                    expected_detection: "System should flag missing seizure prophylaxis"
                },
                {
                    name: "Inadequate PPH Response",
                    type: "non_compliance", 
                    target_condition: "Postpartum hemorrhage",
                    test_strategy: "Suggest delayed response in active hemorrhage scenario",
                    expected_detection: "System should recommend immediate intervention"
                },
                {
                    name: "Generic Monitoring Advice",
                    type: "insufficient_specificity",
                    target_condition: "Gestational diabetes", 
                    test_strategy: "Provide vague monitoring recommendations instead of specific protocols",
                    expected_detection: "System should suggest specific monitoring guidelines"
                }
            ]
        };
        
        console.log(`   ✅ Strategy: ${strategy.approach}`);
        console.log(`   🎯 Selected ${strategy.selected_guidelines.length} high-priority guidelines`);
        console.log(`   🧪 Designed ${strategy.test_scenarios.length} autonomous test scenarios`);
        
        return strategy;
    }
    
    async autonomousExecution(plan) {
        console.log('🔧 AI Agent executing autonomous test scenarios...');
        
        const results = [];
        const scenarios = plan.test_scenarios;
        
        for (let i = 0; i < scenarios.length; i++) {
            const scenario = scenarios[i];
            console.log(`\n   🧪 Test ${i + 1}/${scenarios.length}: ${scenario.name}`);
            
            // AI creates test modification
            const modification = this.createIntelligentModification(scenario);
            console.log(`      🔧 Modification: ${modification.description}`);
            
            // Simulate testing the system (would call real APIs in production)
            const systemResponse = this.simulateSystemResponse(modification);
            console.log(`      🔍 System response: ${systemResponse.summary}`);
            
            // AI evaluates the result
            const evaluation = this.evaluateTestResult(scenario, modification, systemResponse);
            
            const status = evaluation.passed ? '✅ PASSED' : '❌ FAILED';
            const confidence = Math.round(evaluation.confidence * 100);
            console.log(`      ${status} (Confidence: ${confidence}%)`);
            
            results.push({
                scenario: scenario.name,
                modification,
                system_response: systemResponse,
                evaluation,
                timestamp: new Date().toISOString()
            });
            
            await this.sleep(800);
        }
        
        const passedTests = results.filter(r => r.evaluation.passed).length;
        console.log(`\n   📊 Execution complete: ${passedTests}/${results.length} tests passed`);
        
        return {
            total_scenarios: scenarios.length,
            passed_tests: passedTests,
            results
        };
    }
    
    createIntelligentModification(scenario) {
        const transcripts = this.getAvailableTranscripts();
        const baseTranscript = transcripts[scenario.target_condition] || "Sample clinical transcript";
        
        switch (scenario.type) {
            case 'safety_omission':
                return {
                    original: baseTranscript,
                    modified: baseTranscript.replace(/magnesium sulfate|seizure prophylaxis/gi, 'routine monitoring'),
                    description: "Removed critical safety intervention from recommendations",
                    expected_behavior: "System should detect missing safety protocol"
                };
                
            case 'non_compliance':
                return {
                    original: baseTranscript,
                    modified: baseTranscript + "\n\nRECOMMENDATION: Continue observation and reassess in 2-4 hours.",
                    description: "Added delayed response advice for emergency scenario",
                    expected_behavior: "System should recommend immediate intervention"
                };
                
            case 'insufficient_specificity':
                return {
                    original: baseTranscript,
                    modified: baseTranscript + "\n\nRECOMMENDATION: Monitor blood glucose and follow up as needed.",
                    description: "Provided vague monitoring advice instead of specific protocols",
                    expected_behavior: "System should suggest specific monitoring guidelines"
                };
                
            default:
                return {
                    original: baseTranscript,
                    modified: baseTranscript + "\n\nRECOMMENDATION: Continue standard care.",
                    description: "Added generic recommendation",
                    expected_behavior: "System should provide specific guidance"
                };
        }
    }
    
    simulateSystemResponse(modification) {
        // This would call your actual API endpoints in production
        // For demo, we simulate realistic responses
        
        const hasSpecificRecommendations = modification.modified.includes('magnesium sulfate') || 
                                          modification.modified.includes('immediate') ||
                                          modification.modified.includes('urgent');
        
        const isGeneric = modification.modified.includes('standard care') || 
                         modification.modified.includes('routine monitoring') ||
                         modification.modified.includes('follow up as needed');
        
        if (isGeneric) {
            return {
                suggestions: [
                    {
                        category: 'addition',
                        priority: 'high',
                        text: 'Consider specific monitoring protocols based on current guidelines',
                        context: 'More specific recommendations would improve patient care'
                    }
                ],
                summary: 'System provided recommendations for more specific guidance'
            };
        } else if (!hasSpecificRecommendations && modification.description.includes('Removed critical')) {
            return {
                suggestions: [
                    {
                        category: 'addition', 
                        priority: 'high',
                        text: 'Consider magnesium sulfate for seizure prophylaxis in severe preeclampsia',
                        context: 'Critical safety intervention may be missing'
                    }
                ],
                summary: 'System detected missing critical safety intervention'
            };
        } else {
            return {
                suggestions: [],
                summary: 'System found recommendations appropriate'
            };
        }
    }
    
    evaluateTestResult(scenario, modification, systemResponse) {
        const suggestions = systemResponse.suggestions || [];
        const hasRelevantSuggestions = suggestions.length > 0;
        
        let passed = false;
        let confidence = 0.5;
        let assessment = '';
        
        switch (scenario.type) {
            case 'safety_omission':
                passed = hasRelevantSuggestions && suggestions.some(s => 
                    s.priority === 'high' && s.text.toLowerCase().includes('magnesium'));
                confidence = passed ? 0.9 : 0.2;
                assessment = passed ? 'Successfully detected missing safety intervention' : 
                           'Failed to detect critical safety omission';
                break;
                
            case 'non_compliance':
                passed = hasRelevantSuggestions && suggestions.some(s => 
                    s.priority === 'high' && (s.text.toLowerCase().includes('immediate') || 
                                             s.text.toLowerCase().includes('urgent')));
                confidence = passed ? 0.85 : 0.3;
                assessment = passed ? 'Correctly identified need for urgent intervention' :
                           'Did not adequately address urgency requirement';
                break;
                
            case 'insufficient_specificity':
                passed = hasRelevantSuggestions && suggestions.some(s => 
                    s.text.toLowerCase().includes('specific') || 
                    s.text.toLowerCase().includes('protocol'));
                confidence = passed ? 0.8 : 0.4;
                assessment = passed ? 'Recommended more specific guidance' :
                           'Did not address insufficient specificity';
                break;
                
            default:
                passed = hasRelevantSuggestions;
                confidence = 0.6;
                assessment = 'Basic functionality test';
        }
        
        return {
            passed,
            confidence,
            assessment,
            detected_issues: suggestions.length,
            high_priority_suggestions: suggestions.filter(s => s.priority === 'high').length
        };
    }
    
    async autonomousAnalysis(execution) {
        console.log('📈 AI Agent analyzing results and generating insights...');
        
        await this.sleep(1000);
        
        const results = execution.results;
        const totalTests = results.length;
        const passedTests = execution.passed_tests;
        const accuracy = totalTests > 0 ? (passedTests / totalTests) * 100 : 0;
        
        // Analyze patterns
        const safetyOmissionTests = results.filter(r => r.modification.description.includes('Removed critical'));
        const safetyOmissionPassed = safetyOmissionTests.filter(r => r.evaluation.passed).length;
        
        const nonComplianceTests = results.filter(r => r.modification.description.includes('delayed response'));
        const nonCompliancePassed = nonComplianceTests.filter(r => r.evaluation.passed).length;
        
        const analysis = {
            overall_performance: {
                accuracy_percentage: Math.round(accuracy),
                performance_rating: accuracy >= 80 ? 'excellent' : 
                                  accuracy >= 60 ? 'good' : 
                                  accuracy >= 40 ? 'acceptable' : 'needs_improvement',
                confidence_level: totalTests >= 3 ? 'medium' : 'low'
            },
            detailed_findings: {
                safety_omission_detection: `${safetyOmissionPassed}/${safetyOmissionTests.length} tests passed`,
                non_compliance_detection: `${nonCompliancePassed}/${nonComplianceTests.length} tests passed`,
                average_confidence: Math.round(results.reduce((sum, r) => sum + r.evaluation.confidence, 0) / totalTests * 100)
            },
            key_insights: [
                `System demonstrated ${accuracy >= 70 ? 'good' : 'variable'} performance in autonomous testing`,
                `${safetyOmissionTests.length > 0 ? 
                  `Safety omission detection: ${safetyOmissionPassed > 0 ? 'functioning' : 'needs improvement'}` :
                  'Safety omission detection not tested in this session'}`,
                `Generated ${results.reduce((sum, r) => sum + r.evaluation.detected_issues, 0)} total recommendations across tests`
            ],
            recommendations: [
                {
                    priority: accuracy < 70 ? 'high' : 'medium',
                    action: accuracy < 70 ? 'Improve guideline compliance detection algorithms' : 'Continue regular autonomous testing',
                    rationale: accuracy < 70 ? 'Low accuracy indicates system may miss important compliance issues' : 
                              'Regular testing ensures continued performance'
                },
                {
                    priority: 'medium',
                    action: 'Expand autonomous testing to cover more clinical scenarios',
                    rationale: 'Broader testing coverage will provide more comprehensive system validation'
                }
            ]
        };
        
        console.log(`   🎯 Performance: ${analysis.overall_performance.performance_rating.toUpperCase()}`);
        console.log(`   📊 Accuracy: ${analysis.overall_performance.accuracy_percentage}%`);
        console.log(`   🔍 Key Insight: ${analysis.key_insights[0]}`);
        
        return analysis;
    }
    
    getAvailableGuidelines() {
        // Would get from Firestore in production
        return [
            { id: 'preeclampsia_mgmt', title: 'Preeclampsia Management (BJOG 2019)' },
            { id: 'pph_mgmt', title: 'Postpartum Hemorrhage (BJOG 2016)' },
            { id: 'gestational_diabetes', title: 'Gestational Diabetes Management' },
            { id: 'preterm_labour', title: 'Preterm Labour Guidelines' },
            { id: 'cervical_insufficiency', title: 'Cervical Insufficiency Management' }
        ];
    }
    
    getAvailableTranscripts() {
        try {
            // Try to load real transcripts
            const transcriptsPath = path.join(process.cwd(), 'fake_transcripts.json');
            if (fs.existsSync(transcriptsPath)) {
                const data = fs.readFileSync(transcriptsPath, 'utf8');
                const transcripts = JSON.parse(data);
                
                // Flatten the structure
                const flattened = {};
                Object.values(transcripts).forEach(category => {
                    if (typeof category === 'object') {
                        Object.assign(flattened, category);
                    }
                });
                return flattened;
            }
        } catch (error) {
            console.log('   ⚠️ Using sample transcripts');
        }
        
        // Fallback sample transcripts
        return {
            "Preeclampsia": "SITUATION: 32-year-old G2P1 at 36+4 weeks with severe preeclampsia\n\nBACKGROUND: Progressive hypertension and proteinuria over past week\n\nASSESSMENT: BP 168/112 mmHg, 3+ proteinuria, hyperreflexia present\n\nRECOMMENDATION: Immediate delivery suite admission, antihypertensive therapy, magnesium sulfate for seizure prophylaxis",
            "Postpartum hemorrhage": "SITUATION: 32-year-old experiencing primary PPH 45 minutes post-delivery\n\nBACKGROUND: Normal vaginal delivery, estimated blood loss >800ml and continuing\n\nASSESSMENT: Uterus boggy, continuous heavy bleeding, BP 95/58 mmHg\n\nRECOMMENDATION: Immediate uterine massage, syntocinon infusion, prepare for theatre transfer",
            "Gestational diabetes": "SITUATION: 28-year-old at 26+2 weeks with newly diagnosed GDM\n\nBACKGROUND: OGTT results: fasting 5.9, 2-hour 10.1 mmol/L\n\nASSESSMENT: Requires management plan for glucose control\n\nRECOMMENDATION: Dietary counselling, glucose monitoring QDS, diabetes team referral"
        };
    }
    
    saveResults(results) {
        try {
            const filename = `${results.sessionId}_results.json`;
            const filepath = path.join(this.resultsDir, filename);
            fs.writeFileSync(filepath, JSON.stringify(results, null, 2));
            console.log(`\n💾 Results saved to: ${filepath}`);
        } catch (error) {
            console.error('❌ Failed to save results:', error.message);
        }
    }
    
    displaySummary(results) {
        console.log('\n' + '='.repeat(60));
        console.log('🎉 AUTONOMOUS TESTING SESSION COMPLETE');
        console.log('='.repeat(60));
        
        const analysis = results.analysis;
        console.log(`📋 Session ID: ${results.sessionId}`);
        console.log(`🎯 Performance: ${analysis.overall_performance.performance_rating.toUpperCase()}`);
        console.log(`📊 Accuracy: ${analysis.overall_performance.accuracy_percentage}%`);
        console.log(`🧪 Tests: ${results.execution.passed_tests}/${results.execution.total_scenarios} passed`);
        
        console.log('\n💡 Key Recommendations:');
        analysis.recommendations.forEach((rec, i) => {
            console.log(`   ${i + 1}. [${rec.priority.toUpperCase()}] ${rec.action}`);
        });
        
        console.log('\n🤖 This demonstrates autonomous AI testing:');
        console.log('   • Intelligent strategy planning based on objectives');
        console.log('   • Dynamic test scenario creation and execution');
        console.log('   • Autonomous evaluation and insight generation');
        console.log('   • Actionable recommendations for improvement');
        
        console.log('\n🚀 With real API access, this agent would:');
        console.log('   • Connect directly to your Firestore guidelines database');
        console.log('   • Call your /dynamicAdvice and other endpoints');
        console.log('   • Use advanced AI reasoning for test design');
        console.log('   • Continuously adapt and improve testing strategies');
        
        console.log('='.repeat(60));
    }
    
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

// CLI interface
async function main() {
    const options = {};
    
    // Parse basic command line arguments
    const args = process.argv.slice(2);
    for (let i = 0; i < args.length; i += 2) {
        const key = args[i]?.replace('--', '');
        const value = args[i + 1];
        if (key && value) {
            options[key] = value;
        }
    }
    
    try {
        const agent = new SimpleAutonomousAgent(options);
        await agent.runAutonomousSession();
    } catch (error) {
        console.error('❌ Autonomous testing failed:', error.message);
        process.exit(1);
    }
}

// Run if called directly
if (require.main === module) {
    main();
}

module.exports = { SimpleAutonomousAgent }; 