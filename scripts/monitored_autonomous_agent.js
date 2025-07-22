#!/usr/bin/env node

/**
 * Monitored Autonomous AI Testing Agent
 * 
 * Features comprehensive cost monitoring, analytics dashboard, and safety controls
 * to prevent expensive runaway testing while providing meaningful insights.
 */

const admin = require('firebase-admin');
const fetch = require('node-fetch');
const fs = require('fs').promises;
const path = require('path');

class MonitoredAutonomousAgent {
    constructor(options = {}) {
        this.serverUrl = options.serverUrl || 'https://clerky-uzni.onrender.com';
        this.authToken = options.authToken || null;
        this.resultsDir = './monitored_test_results';
        this.dashboardDir = './test_dashboard';
        
        // Cost monitoring and limits
        this.maxCostUSD = parseFloat(options.maxCost) || 5.00; // Default $5 limit
        this.currentCostUSD = 0;
        this.maxTests = parseInt(options.maxTests) || 20; // Default 20 tests max
        this.testCount = 0;
        
        // Performance tracking
        this.providerStats = new Map();
        this.accuracyHistory = [];
        this.costHistory = [];
        this.performanceMetrics = {
            startTime: Date.now(),
            totalRequests: 0,
            successfulRequests: 0,
            totalTokens: 0,
            averageResponseTime: 0,
            responseTimes: []
        };
        
        console.log('🤖 Monitored Autonomous Testing Agent initialized');
        console.log(`   🌐 Server: ${this.serverUrl}`);
        console.log(`   💰 Cost Limit: $${this.maxCostUSD.toFixed(2)}`);
        console.log(`   🧪 Test Limit: ${this.maxTests} tests`);
        
        this.ensureDirectories();
    }
    
    async ensureDirectories() {
        try {
            await fs.mkdir(this.resultsDir, { recursive: true });
            await fs.mkdir(this.dashboardDir, { recursive: true });
            await fs.mkdir(path.join(this.dashboardDir, 'data'), { recursive: true });
        } catch (error) {
            // Directories might already exist
        }
    }
    
    async runMonitoredTest() {
        const sessionId = `monitored_${Date.now()}`;
        
        console.log('\n🚀 Monitored Autonomous Clinical Guidelines Testing');
        console.log('='.repeat(65));
        console.log(`📋 Session: ${sessionId}`);
        console.log(`🌐 Server: ${this.serverUrl}`);
        console.log(`💰 Budget: $${this.maxCostUSD.toFixed(2)} | Tests: ${this.maxTests}`);
        
        try {
            // Initialize monitoring
            await this.initializeMonitoring(sessionId);
            
            // Phase 1: System Analysis
            console.log('\n📊 PHASE 1: Monitored System Analysis');
            const connectivity = await this.monitoredConnectivityTest();
            
            // Phase 2: Controlled Testing
            console.log('\n🔬 PHASE 2: Cost-Controlled Testing');
            const testResults = await this.runCostControlledTests();
            
            // Phase 3: Analytics & Dashboard Generation
            console.log('\n📈 PHASE 3: Analytics & Dashboard Generation');
            const analytics = await this.generateComprehensiveAnalytics(testResults);
            
            // Phase 4: Dashboard Creation
            console.log('\n📊 PHASE 4: Dashboard Creation');
            await this.createMonitoringDashboard(analytics);
            
            const results = {
                sessionId,
                timestamp: new Date().toISOString(),
                server_url: this.serverUrl,
                cost_control: {
                    max_cost_usd: this.maxCostUSD,
                    actual_cost_usd: this.currentCostUSD,
                    max_tests: this.maxTests,
                    actual_tests: this.testCount,
                    cost_per_test: this.testCount > 0 ? this.currentCostUSD / this.testCount : 0
                },
                connectivity,
                test_results: testResults,
                analytics,
                performance_metrics: this.performanceMetrics
            };
            
            await this.saveResults(results);
            await this.updateHistoricalData(results);
            this.displayMonitoredSummary(results);
            
            return results;
            
        } catch (error) {
            console.error('❌ Monitored testing failed:', error.message);
            await this.saveErrorReport(sessionId, error);
            throw error;
        }
    }
    
    async initializeMonitoring(sessionId) {
        console.log('🔧 Initializing monitoring systems...');
        
        // Load historical data if exists
        try {
            const historyPath = path.join(this.dashboardDir, 'data', 'history.json');
            const historyData = await fs.readFile(historyPath, 'utf8');
            const history = JSON.parse(historyData);
            
            this.accuracyHistory = history.accuracy_history || [];
            this.costHistory = history.cost_history || [];
            
            console.log(`   📚 Loaded ${this.accuracyHistory.length} historical accuracy points`);
            console.log(`   💰 Loaded ${this.costHistory.length} historical cost points`);
            
        } catch (error) {
            console.log('   📝 Starting fresh monitoring session');
        }
        
        // Initialize provider tracking
        const providers = ['OpenAI', 'DeepSeek', 'Anthropic', 'Mistral', 'Gemini'];
        providers.forEach(provider => {
            this.providerStats.set(provider, {
                requests: 0,
                successes: 0,
                failures: 0,
                totalCost: 0,
                averageAccuracy: 0,
                averageResponseTime: 0,
                responseTimes: []
            });
        });
        
        console.log('   ✅ Monitoring systems ready');
    }
    
    async checkCostLimits() {
        if (this.currentCostUSD >= this.maxCostUSD) {
            console.log(`\n⚠️ COST LIMIT REACHED: $${this.currentCostUSD.toFixed(4)} >= $${this.maxCostUSD.toFixed(2)}`);
            console.log('   🛑 Stopping autonomous testing to prevent overages');
            return false;
        }
        
        if (this.testCount >= this.maxTests) {
            console.log(`\n⚠️ TEST LIMIT REACHED: ${this.testCount} >= ${this.maxTests}`);
            console.log('   🛑 Stopping autonomous testing - maximum tests completed');
            return false;
        }
        
        const remainingBudget = this.maxCostUSD - this.currentCostUSD;
        const remainingTests = this.maxTests - this.testCount;
        
        console.log(`   💰 Budget: $${remainingBudget.toFixed(4)} remaining | 🧪 Tests: ${remainingTests} remaining`);
        return true;
    }
    
    async monitoredConnectivityTest() {
        console.log('🔍 Running monitored connectivity test...');
        
        const tests = [
            { name: 'Health Check', endpoint: '/health', cost: 0 },
            { name: 'Root Endpoint', endpoint: '/', cost: 0 },
            { name: 'Test AI Routing', endpoint: '/routeToAI', cost: 0.01 }
        ];
        
        const results = [];
        
        for (const test of tests) {
            const startTime = Date.now();
            
            try {
                console.log(`   Testing ${test.name}...`);
                
                // Track estimated cost
                this.currentCostUSD += test.cost;
                
                const response = await fetch(`${this.serverUrl}${test.endpoint}`, {
                    method: 'GET',
                    timeout: 10000
                });
                
                const responseTime = Date.now() - startTime;
                this.performanceMetrics.responseTimes.push(responseTime);
                this.performanceMetrics.totalRequests++;
                
                if (response.ok) {
                    this.performanceMetrics.successfulRequests++;
                }
                
                const status = response.ok ? '✅ Online' : `⚠️ ${response.status}`;
                console.log(`      ${status} (${responseTime}ms)`);
                
                results.push({
                    name: test.name,
                    endpoint: test.endpoint,
                    status: response.status,
                    ok: response.ok,
                    response_time_ms: responseTime,
                    estimated_cost: test.cost
                });
                
            } catch (error) {
                console.log(`      ❌ Failed: ${error.message}`);
                results.push({
                    name: test.name,
                    endpoint: test.endpoint,
                    error: error.message,
                    ok: false,
                    response_time_ms: Date.now() - startTime,
                    estimated_cost: test.cost
                });
            }
        }
        
        // Update average response time
        if (this.performanceMetrics.responseTimes.length > 0) {
            this.performanceMetrics.averageResponseTime = 
                this.performanceMetrics.responseTimes.reduce((a, b) => a + b, 0) / 
                this.performanceMetrics.responseTimes.length;
        }
        
        return results;
    }
    
    async runCostControlledTests() {
        console.log('🧪 Running cost-controlled autonomous tests...');
        
        const transcripts = await this.getRealTranscripts();
        const transcriptKeys = Object.keys(transcripts);
        
        if (transcriptKeys.length === 0) {
            console.log('   ⚠️ No test transcripts available');
            return [];
        }
        
        const results = [];
        let testIndex = 0;
        
        // Continue testing until we hit limits
        while (await this.checkCostLimits() && testIndex < transcriptKeys.length) {
            const condition = transcriptKeys[testIndex % transcriptKeys.length];
            const testScenario = this.generateTestScenario(condition, testIndex);
            
            console.log(`\n   🧪 Test ${this.testCount + 1}: ${testScenario.name}`);
            console.log(`      💰 Estimated cost: $${testScenario.estimated_cost.toFixed(4)}`);
            
            // Pre-flight cost check
            if (this.currentCostUSD + testScenario.estimated_cost > this.maxCostUSD) {
                console.log(`      ⚠️ Skipping test - would exceed budget`);
                break;
            }
            
            try {
                const testResult = await this.runSingleMonitoredTest(testScenario, transcripts);
                results.push(testResult);
                
                this.testCount++;
                this.updateProviderStats(testResult);
                
                const status = testResult.success ? '✅ PASSED' : '❌ FAILED';
                const accuracy = testResult.accuracy_score || 0;
                console.log(`      ${status} (Accuracy: ${accuracy}%)`);
                console.log(`      💰 Actual cost: $${testResult.actual_cost.toFixed(4)}`);
                
                // Record accuracy and cost data points
                this.accuracyHistory.push({
                    timestamp: Date.now(),
                    accuracy: accuracy,
                    test_type: testScenario.type,
                    provider: testResult.ai_provider || 'unknown'
                });
                
                this.costHistory.push({
                    timestamp: Date.now(),
                    cost: testResult.actual_cost,
                    test_type: testScenario.type,
                    provider: testResult.ai_provider || 'unknown'
                });
                
            } catch (error) {
                console.log(`      ❌ ERROR: ${error.message}`);
                results.push({
                    scenario: testScenario.name,
                    success: false,
                    error: error.message,
                    actual_cost: 0.001 // Minimal cost for failed request
                });
                this.testCount++;
            }
            
            testIndex++;
            
            // Small delay to prevent overwhelming the server
            await this.sleep(2000);
        }
        
        return results;
    }
    
    generateTestScenario(condition, index) {
        const scenarios = [
            {
                type: 'basic_advice',
                name: `Basic Clinical Advice Test`,
                endpoint: '/dynamicAdvice',
                estimated_cost: 0.05,
                description: 'Test basic recommendation generation'
            },
            {
                type: 'guideline_search',
                name: `Guideline Relevance Test`,
                endpoint: '/findRelevantGuidelines',
                estimated_cost: 0.03,
                description: 'Test guideline search accuracy'
            },
            {
                type: 'compliance_check',
                name: `Compliance Detection Test`,
                endpoint: '/dynamicAdvice',
                estimated_cost: 0.05,
                description: 'Test compliance violation detection'
            }
        ];
        
        const scenario = scenarios[index % scenarios.length];
        return {
            ...scenario,
            name: `${scenario.name} (${condition})`,
            condition
        };
    }
    
    async runSingleMonitoredTest(scenario, transcripts) {
        const startTime = Date.now();
        const baseTranscript = transcripts[scenario.condition] || 'Sample clinical transcript';
        
        // Create test modification based on scenario type
        let modifiedTranscript = baseTranscript;
        if (scenario.type === 'compliance_check') {
            modifiedTranscript += "\n\nRECOMMENDATION: Patient discharged without follow-up."; // Intentional compliance issue
        } else {
            modifiedTranscript += "\n\nRECOMMENDATION: Continue monitoring as per guidelines.";
        }
        
        try {
            const response = await fetch(`${this.serverUrl}${scenario.endpoint}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(this.authToken && { 'Authorization': `Bearer ${this.authToken}` })
                },
                body: JSON.stringify({
                    transcript: modifiedTranscript,
                    analysis: 'Monitored autonomous testing analysis',
                    guidelineId: 'test_guideline',
                    guidelineTitle: 'Monitored Test Guideline'
                }),
                timeout: 30000
            });
            
            const responseTime = Date.now() - startTime;
            const responseText = await response.text();
            
            let data;
            try {
                data = JSON.parse(responseText);
            } catch (e) {
                data = { raw_response: responseText };
            }
            
            // Calculate actual cost (estimate based on response size and complexity)
            const actualCost = this.estimateActualCost(modifiedTranscript, responseText, responseTime);
            this.currentCostUSD += actualCost;
            
            // Calculate accuracy score
            const accuracyScore = this.calculateAccuracyScore(scenario, data);
            
            // Extract AI provider info if available
            const aiProvider = data.ai_provider || data.provider || 'unknown';
            
            this.performanceMetrics.totalRequests++;
            this.performanceMetrics.responseTimes.push(responseTime);
            
            if (response.ok) {
                this.performanceMetrics.successfulRequests++;
                this.performanceMetrics.totalTokens += (data.token_usage?.total_tokens || 0);
            }
            
            return {
                scenario: scenario.name,
                type: scenario.type,
                condition: scenario.condition,
                endpoint: scenario.endpoint,
                success: response.ok,
                api_status: response.status,
                response_time_ms: responseTime,
                actual_cost: actualCost,
                estimated_cost: scenario.estimated_cost,
                ai_provider: aiProvider,
                accuracy_score: accuracyScore,
                response_data: data,
                suggestions_count: (data.suggestions || []).length,
                has_recommendations: (data.suggestions || []).length > 0,
                token_usage: data.token_usage || null
            };
            
        } catch (error) {
            return {
                scenario: scenario.name,
                type: scenario.type,
                condition: scenario.condition,
                endpoint: scenario.endpoint,
                success: false,
                error: error.message,
                response_time_ms: Date.now() - startTime,
                actual_cost: 0.001,
                accuracy_score: 0
            };
        }
    }
    
    estimateActualCost(input, output, responseTime) {
        // Rough cost estimation based on content length and response time
        const inputTokens = Math.ceil(input.length / 4); // ~4 chars per token
        const outputTokens = Math.ceil(output.length / 4);
        
        // Estimated costs per 1K tokens (rough averages)
        const costPer1KInput = 0.0015;  // $0.0015 per 1K input tokens
        const costPer1KOutput = 0.002;  // $0.002 per 1K output tokens
        
        const inputCost = (inputTokens / 1000) * costPer1KInput;
        const outputCost = (outputTokens / 1000) * costPer1KOutput;
        
        return inputCost + outputCost;
    }
    
    calculateAccuracyScore(scenario, responseData) {
        // Simple accuracy scoring based on scenario type and response quality
        if (!responseData || responseData.error) {
            return 0;
        }
        
        let score = 50; // Base score
        
        // Check for recommendations/suggestions
        if (responseData.suggestions && responseData.suggestions.length > 0) {
            score += 20;
        }
        
        // Check for specific content based on scenario type
        if (scenario.type === 'compliance_check') {
            // Look for compliance-related keywords in response
            const responseText = JSON.stringify(responseData).toLowerCase();
            if (responseText.includes('follow') || responseText.includes('monitor') || 
                responseText.includes('guideline') || responseText.includes('recommend')) {
                score += 20;
            }
        }
        
        // Check for structured response
        if (responseData.success !== undefined) {
            score += 10;
        }
        
        return Math.min(100, score);
    }
    
    updateProviderStats(testResult) {
        if (!testResult.ai_provider || !this.providerStats.has(testResult.ai_provider)) {
            return;
        }
        
        const stats = this.providerStats.get(testResult.ai_provider);
        stats.requests++;
        
        if (testResult.success) {
            stats.successes++;
            stats.totalCost += testResult.actual_cost;
            
            // Update running average accuracy
            const totalAccuracyPoints = stats.averageAccuracy * (stats.successes - 1) + testResult.accuracy_score;
            stats.averageAccuracy = totalAccuracyPoints / stats.successes;
            
            // Update response times
            stats.responseTimes.push(testResult.response_time_ms);
            stats.averageResponseTime = stats.responseTimes.reduce((a, b) => a + b, 0) / stats.responseTimes.length;
        } else {
            stats.failures++;
        }
    }
    
    async generateComprehensiveAnalytics(testResults) {
        console.log('📊 Generating comprehensive analytics...');
        
        const analytics = {
            session_summary: {
                total_tests: testResults.length,
                successful_tests: testResults.filter(t => t.success).length,
                total_cost: this.currentCostUSD,
                average_cost_per_test: testResults.length > 0 ? this.currentCostUSD / testResults.length : 0,
                average_accuracy: this.calculateAverageAccuracy(testResults),
                total_response_time: this.performanceMetrics.responseTimes.reduce((a, b) => a + b, 0),
                average_response_time: this.performanceMetrics.averageResponseTime
            },
            cost_analysis: {
                budget_utilization: (this.currentCostUSD / this.maxCostUSD) * 100,
                cost_efficiency: this.calculateCostEfficiency(testResults),
                cost_per_accuracy_point: this.calculateCostPerAccuracyPoint(testResults)
            },
            accuracy_trends: this.analyzeAccuracyTrends(),
            provider_comparison: this.generateProviderComparison(),
            model_drift_detection: this.detectModelDrift(),
            performance_insights: this.generatePerformanceInsights(testResults)
        };
        
        console.log(`   📈 Analytics generated: ${Object.keys(analytics).length} sections`);
        return analytics;
    }
    
    calculateAverageAccuracy(testResults) {
        const validTests = testResults.filter(t => t.accuracy_score !== undefined);
        if (validTests.length === 0) return 0;
        
        return validTests.reduce((sum, t) => sum + t.accuracy_score, 0) / validTests.length;
    }
    
    calculateCostEfficiency(testResults) {
        const successfulTests = testResults.filter(t => t.success);
        if (successfulTests.length === 0) return 0;
        
        const totalSuccessfulCost = successfulTests.reduce((sum, t) => sum + t.actual_cost, 0);
        const totalAccuracy = successfulTests.reduce((sum, t) => sum + (t.accuracy_score || 0), 0);
        
        return totalAccuracy / totalSuccessfulCost; // Accuracy points per dollar
    }
    
    calculateCostPerAccuracyPoint(testResults) {
        const totalAccuracy = testResults.reduce((sum, t) => sum + (t.accuracy_score || 0), 0);
        return totalAccuracy > 0 ? this.currentCostUSD / totalAccuracy : 0;
    }
    
    analyzeAccuracyTrends() {
        if (this.accuracyHistory.length < 2) {
            return { trend: 'insufficient_data', points: this.accuracyHistory.length };
        }
        
        // Calculate trend over last 10 points
        const recentPoints = this.accuracyHistory.slice(-10);
        const firstHalf = recentPoints.slice(0, Math.floor(recentPoints.length / 2));
        const secondHalf = recentPoints.slice(Math.floor(recentPoints.length / 2));
        
        const firstAvg = firstHalf.reduce((sum, p) => sum + p.accuracy, 0) / firstHalf.length;
        const secondAvg = secondHalf.reduce((sum, p) => sum + p.accuracy, 0) / secondHalf.length;
        
        const change = secondAvg - firstAvg;
        
        return {
            trend: change > 5 ? 'improving' : change < -5 ? 'declining' : 'stable',
            change_percentage: change,
            recent_average: secondAvg,
            historical_average: firstAvg,
            data_points: this.accuracyHistory.length
        };
    }
    
    generateProviderComparison() {
        const comparison = {};
        
        this.providerStats.forEach((stats, provider) => {
            if (stats.requests > 0) {
                comparison[provider] = {
                    total_requests: stats.requests,
                    success_rate: (stats.successes / stats.requests) * 100,
                    average_accuracy: stats.averageAccuracy,
                    average_cost: stats.totalCost / stats.successes || 0,
                    average_response_time: stats.averageResponseTime,
                    cost_efficiency: stats.averageAccuracy / (stats.totalCost / stats.successes || 1)
                };
            }
        });
        
        return comparison;
    }
    
    detectModelDrift() {
        if (this.accuracyHistory.length < 10) {
            return { status: 'insufficient_data', message: 'Need at least 10 data points for drift detection' };
        }
        
        // Simple drift detection: compare recent performance to historical baseline
        const baseline = this.accuracyHistory.slice(0, 5).reduce((sum, p) => sum + p.accuracy, 0) / 5;
        const recent = this.accuracyHistory.slice(-5).reduce((sum, p) => sum + p.accuracy, 0) / 5;
        
        const driftPercentage = ((recent - baseline) / baseline) * 100;
        
        let status = 'stable';
        if (Math.abs(driftPercentage) > 15) {
            status = driftPercentage > 0 ? 'positive_drift' : 'negative_drift';
        }
        
        return {
            status,
            drift_percentage: driftPercentage,
            baseline_accuracy: baseline,
            recent_accuracy: recent,
            confidence: this.accuracyHistory.length >= 20 ? 'high' : 'medium'
        };
    }
    
    generatePerformanceInsights(testResults) {
        const insights = [];
        
        // Cost insights
        if (this.currentCostUSD > this.maxCostUSD * 0.8) {
            insights.push({
                type: 'cost',
                level: 'warning',
                message: `Approaching cost limit: $${this.currentCostUSD.toFixed(4)} of $${this.maxCostUSD.toFixed(2)} used`
            });
        }
        
        // Accuracy insights
        const avgAccuracy = this.calculateAverageAccuracy(testResults);
        if (avgAccuracy > 80) {
            insights.push({
                type: 'accuracy',
                level: 'success',
                message: `Excellent accuracy performance: ${avgAccuracy.toFixed(1)}%`
            });
        } else if (avgAccuracy < 60) {
            insights.push({
                type: 'accuracy',
                level: 'warning',
                message: `Low accuracy detected: ${avgAccuracy.toFixed(1)}% - consider model tuning`
            });
        }
        
        // Response time insights
        if (this.performanceMetrics.averageResponseTime > 5000) {
            insights.push({
                type: 'performance',
                level: 'warning',
                message: `Slow response times: ${this.performanceMetrics.averageResponseTime.toFixed(0)}ms average`
            });
        }
        
        return insights;
    }
    
    async createMonitoringDashboard(analytics) {
        console.log('📊 Creating monitoring dashboard...');
        
        // Generate HTML dashboard
        const dashboardHtml = this.generateDashboardHtml(analytics);
        const dashboardPath = path.join(this.dashboardDir, 'dashboard.html');
        await fs.writeFile(dashboardPath, dashboardHtml);
        
        // Save analytics data as JSON for external tools
        const analyticsPath = path.join(this.dashboardDir, 'data', 'latest_analytics.json');
        await fs.writeFile(analyticsPath, JSON.stringify(analytics, null, 2));
        
        // Generate CSV reports
        await this.generateCsvReports();
        
        console.log(`   📊 Dashboard created: ${dashboardPath}`);
        console.log(`   📈 Analytics saved: ${analyticsPath}`);
        console.log(`   📋 CSV reports generated in: ${path.join(this.dashboardDir, 'data')}`);
    }
    
    generateDashboardHtml(analytics) {
        return `<!DOCTYPE html>
<html>
<head>
    <title>Clerky Autonomous Testing Dashboard</title>
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; background: #f5f5f5; }
        .dashboard { max-width: 1200px; margin: 0 auto; }
        .header { background: #2c3e50; color: white; padding: 20px; border-radius: 8px; margin-bottom: 20px; }
        .metrics-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 20px; margin-bottom: 20px; }
        .metric-card { background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
        .metric-value { font-size: 2em; font-weight: bold; color: #2c3e50; }
        .metric-label { color: #7f8c8d; text-transform: uppercase; font-size: 0.8em; }
        .chart-container { background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); margin-bottom: 20px; }
        .insights { background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
        .insight { padding: 10px; margin: 5px 0; border-radius: 4px; }
        .insight.success { background: #d5edda; border-left: 4px solid #28a745; }
        .insight.warning { background: #fff3cd; border-left: 4px solid #ffc107; }
        .insight.error { background: #f8d7da; border-left: 4px solid #dc3545; }
        .provider-comparison { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px; }
        .provider-card { padding: 15px; border: 1px solid #ddd; border-radius: 8px; }
    </style>
</head>
<body>
    <div class="dashboard">
        <div class="header">
            <h1>🤖 Clerky Autonomous Testing Dashboard</h1>
            <p>Real-time monitoring and analytics for autonomous clinical guidelines testing</p>
            <p><strong>Session:</strong> ${new Date().toISOString()} | <strong>Server:</strong> ${this.serverUrl}</p>
        </div>
        
        <div class="metrics-grid">
            <div class="metric-card">
                <div class="metric-value">${analytics.session_summary.total_tests}</div>
                <div class="metric-label">Total Tests</div>
            </div>
            <div class="metric-card">
                <div class="metric-value">${analytics.session_summary.average_accuracy.toFixed(1)}%</div>
                <div class="metric-label">Average Accuracy</div>
            </div>
            <div class="metric-card">
                <div class="metric-value">$${analytics.session_summary.total_cost.toFixed(4)}</div>
                <div class="metric-label">Total Cost</div>
            </div>
            <div class="metric-card">
                <div class="metric-value">${analytics.session_summary.average_response_time.toFixed(0)}ms</div>
                <div class="metric-label">Avg Response Time</div>
            </div>
            <div class="metric-card">
                <div class="metric-value">${analytics.cost_analysis.budget_utilization.toFixed(1)}%</div>
                <div class="metric-label">Budget Used</div>
            </div>
            <div class="metric-card">
                <div class="metric-value">${analytics.cost_analysis.cost_efficiency.toFixed(2)}</div>
                <div class="metric-label">Cost Efficiency</div>
            </div>
        </div>
        
        <div class="chart-container">
            <h3>📈 Accuracy Trends</h3>
            <canvas id="accuracyChart" width="400" height="200"></canvas>
        </div>
        
        <div class="chart-container">
            <h3>💰 Cost Trends</h3>
            <canvas id="costChart" width="400" height="200"></canvas>
        </div>
        
        <div class="chart-container">
            <h3>🔄 Provider Comparison</h3>
            <div class="provider-comparison">
                ${Object.entries(analytics.provider_comparison).map(([provider, stats]) => `
                    <div class="provider-card">
                        <h4>${provider}</h4>
                        <p><strong>Success Rate:</strong> ${stats.success_rate.toFixed(1)}%</p>
                        <p><strong>Avg Accuracy:</strong> ${stats.average_accuracy.toFixed(1)}%</p>
                        <p><strong>Avg Cost:</strong> $${stats.average_cost.toFixed(4)}</p>
                        <p><strong>Response Time:</strong> ${stats.average_response_time.toFixed(0)}ms</p>
                    </div>
                `).join('')}
            </div>
        </div>
        
        <div class="insights">
            <h3>💡 Performance Insights</h3>
            ${analytics.performance_insights.map(insight => `
                <div class="insight ${insight.level}">
                    <strong>${insight.type.toUpperCase()}:</strong> ${insight.message}
                </div>
            `).join('')}
            
            <h4>🔍 Model Drift Detection</h4>
            <div class="insight ${analytics.model_drift_detection.status === 'negative_drift' ? 'warning' : 'success'}">
                <strong>Status:</strong> ${analytics.model_drift_detection.status.replace('_', ' ').toUpperCase()}<br>
                <strong>Drift:</strong> ${analytics.model_drift_detection.drift_percentage?.toFixed(2)}%<br>
                <strong>Confidence:</strong> ${analytics.model_drift_detection.confidence?.toUpperCase()}
            </div>
            
            <h4>📊 Accuracy Trends</h4>
            <div class="insight ${analytics.accuracy_trends.trend === 'improving' ? 'success' : analytics.accuracy_trends.trend === 'declining' ? 'warning' : 'info'}">
                <strong>Trend:</strong> ${analytics.accuracy_trends.trend.toUpperCase()}<br>
                <strong>Change:</strong> ${analytics.accuracy_trends.change_percentage?.toFixed(2)}%<br>
                <strong>Data Points:</strong> ${analytics.accuracy_trends.data_points}
            </div>
        </div>
    </div>
    
    <script>
        // Accuracy trend chart
        const accuracyData = ${JSON.stringify(this.accuracyHistory.map(h => ({ x: h.timestamp, y: h.accuracy })))};
        new Chart(document.getElementById('accuracyChart'), {
            type: 'line',
            data: {
                datasets: [{
                    label: 'Accuracy %',
                    data: accuracyData,
                    borderColor: '#3498db',
                    backgroundColor: 'rgba(52, 152, 219, 0.1)',
                    tension: 0.4
                }]
            },
            options: {
                responsive: true,
                scales: {
                    x: { type: 'time' },
                    y: { beginAtZero: true, max: 100 }
                }
            }
        });
        
        // Cost trend chart
        const costData = ${JSON.stringify(this.costHistory.map(h => ({ x: h.timestamp, y: h.cost })))};
        new Chart(document.getElementById('costChart'), {
            type: 'line',
            data: {
                datasets: [{
                    label: 'Cost $',
                    data: costData,
                    borderColor: '#e74c3c',
                    backgroundColor: 'rgba(231, 76, 60, 0.1)',
                    tension: 0.4
                }]
            },
            options: {
                responsive: true,
                scales: {
                    x: { type: 'time' },
                    y: { beginAtZero: true }
                }
            }
        });
    </script>
</body>
</html>`;
    }
    
    async generateCsvReports() {
        // Test results CSV
        const testResultsCsv = [
            'timestamp,scenario,type,success,accuracy_score,cost,response_time,provider',
            ...this.accuracyHistory.map(h => 
                `${new Date(h.timestamp).toISOString()},${h.test_type || 'unknown'},${h.test_type},true,${h.accuracy},0,0,${h.provider}`
            )
        ].join('\n');
        
        await fs.writeFile(path.join(this.dashboardDir, 'data', 'test_results.csv'), testResultsCsv);
        
        // Cost analysis CSV
        const costCsv = [
            'timestamp,cost,test_type,provider',
            ...this.costHistory.map(h => 
                `${new Date(h.timestamp).toISOString()},${h.cost},${h.test_type},${h.provider}`
            )
        ].join('\n');
        
        await fs.writeFile(path.join(this.dashboardDir, 'data', 'cost_analysis.csv'), costCsv);
    }
    
    async updateHistoricalData(results) {
        const historyPath = path.join(this.dashboardDir, 'data', 'history.json');
        
        const history = {
            accuracy_history: this.accuracyHistory,
            cost_history: this.costHistory,
            last_updated: new Date().toISOString(),
            total_sessions: 1 // This would increment in a real implementation
        };
        
        await fs.writeFile(historyPath, JSON.stringify(history, null, 2));
    }
    
    async getRealTranscripts() {
        try {
            const transcriptsPath = path.join(process.cwd(), 'fake_transcripts.json');
            const data = await fs.readFile(transcriptsPath, 'utf8');
            const transcripts = JSON.parse(data);
            
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
                "Preeclampsia": "Sample preeclampsia transcript for monitored testing",
                "Gestational diabetes": "Sample diabetes transcript for monitored testing"
            };
        }
    }
    
    async saveResults(results) {
        try {
            const filename = `${results.sessionId}_monitored_results.json`;
            const filepath = path.join(this.resultsDir, filename);
            await fs.writeFile(filepath, JSON.stringify(results, null, 2));
            console.log(`💾 Results saved to: ${filepath}`);
        } catch (error) {
            console.error('❌ Failed to save results:', error.message);
        }
    }
    
    async saveErrorReport(sessionId, error) {
        try {
            const errorReport = {
                sessionId,
                timestamp: new Date().toISOString(),
                error: {
                    message: error.message,
                    stack: error.stack,
                    name: error.name
                },
                cost_at_failure: this.currentCostUSD,
                tests_completed: this.testCount
            };
            
            const filename = `${sessionId}_error_report.json`;
            const filepath = path.join(this.resultsDir, filename);
            await fs.writeFile(filepath, JSON.stringify(errorReport, null, 2));
        } catch (saveError) {
            console.error('❌ Failed to save error report:', saveError.message);
        }
    }
    
    displayMonitoredSummary(results) {
        console.log('\n' + '='.repeat(70));
        console.log('🎉 MONITORED AUTONOMOUS TESTING COMPLETE');
        console.log('='.repeat(70));
        
        console.log(`📋 Session: ${results.sessionId}`);
        console.log(`🌐 Server: ${results.server_url}`);
        
        const cost = results.cost_control;
        console.log(`💰 Cost: $${cost.actual_cost_usd.toFixed(4)} of $${cost.max_cost_usd.toFixed(2)} (${((cost.actual_cost_usd/cost.max_cost_usd)*100).toFixed(1)}%)`);
        console.log(`🧪 Tests: ${cost.actual_tests} of ${cost.max_tests} (${((cost.actual_tests/cost.max_tests)*100).toFixed(1)}%)`);
        console.log(`📊 Cost per test: $${cost.cost_per_test.toFixed(4)}`);
        
        const analytics = results.analytics;
        console.log(`🎯 Average Accuracy: ${analytics.session_summary.average_accuracy.toFixed(1)}%`);
        console.log(`⚡ Average Response: ${analytics.session_summary.average_response_time.toFixed(0)}ms`);
        console.log(`💡 Cost Efficiency: ${analytics.cost_analysis.cost_efficiency.toFixed(2)} accuracy points per $`);
        
        console.log('\n📈 Key Insights:');
        analytics.performance_insights.forEach((insight, i) => {
            const emoji = insight.level === 'success' ? '✅' : insight.level === 'warning' ? '⚠️' : '❌';
            console.log(`   ${i + 1}. ${emoji} ${insight.message}`);
        });
        
        console.log('\n🔍 Model Analysis:');
        console.log(`   • Drift Status: ${analytics.model_drift_detection.status.replace('_', ' ').toUpperCase()}`);
        console.log(`   • Accuracy Trend: ${analytics.accuracy_trends.trend.toUpperCase()}`);
        
        console.log('\n🤖 Monitored Autonomous Features Demonstrated:');
        console.log('   • Real-time cost monitoring and budget protection');
        console.log('   • Comprehensive accuracy tracking and trend analysis');
        console.log('   • Provider performance comparison and optimization');
        console.log('   • Model drift detection and performance insights');
        console.log('   • Interactive dashboard with historical analytics');
        console.log('   • CSV exports for external analysis tools');
        
        console.log(`\n📊 Dashboard available at: ${path.join(this.dashboardDir, 'dashboard.html')}`);
        console.log('='.repeat(70));
    }
    
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

// CLI interface
async function main() {
    console.log('🤖 Monitored Autonomous Clinical Guidelines Testing Agent');
    console.log('='.repeat(60));
    
    const args = process.argv.slice(2);
    const options = {};
    
    for (let i = 0; i < args.length; i++) {
        if (args[i].startsWith('--')) {
            const key = args[i].replace('--', '').replace('-', '_');
            const value = args[i + 1];
            if (value && !value.startsWith('--')) {
                options[key] = value;
                i++;
            }
        }
    }
    
    console.log(`📥 Configuration:`, options);
    
    try {
        const agent = new MonitoredAutonomousAgent(options);
        await agent.runMonitoredTest();
    } catch (error) {
        console.error('❌ Monitored autonomous testing failed:', error.message);
        process.exit(1);
    }
}

if (require.main === module) {
    main();
} 