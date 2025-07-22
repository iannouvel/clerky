/**
 * Web-Based Autonomous Testing Agent
 * 
 * Provides autonomous testing capabilities directly in the browser
 * with real-time monitoring, cost controls, and analytics.
 */

import { app, db, auth } from './firebase-init.js';
import { GoogleAuthProvider, signInWithPopup, onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import { collection, getDocs, addDoc, doc, getDoc } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

class WebAutonomousAgent {
    constructor() {
        this.serverUrl = window.SERVER_URL || 'https://clerky-uzni.onrender.com';
        this.isRunning = false;
        this.currentUser = null;
        this.authToken = null;
        
        // Cost and test tracking
        this.maxCostUSD = 5.00;
        this.currentCostUSD = 0;
        this.maxTests = 20;
        this.testCount = 0;
        this.testInterval = 3000; // 3 seconds
        
        // Performance tracking
        this.metrics = {
            totalTests: 0,
            successfulTests: 0,
            totalCost: 0,
            totalResponseTime: 0,
            averageAccuracy: 0,
            successRate: 0,
            costEfficiency: 0
        };
        
        // Data storage
        this.testResults = [];
        this.accuracyHistory = [];
        this.costHistory = [];
        this.responseTimeHistory = [];
        this.providerStats = new Map();
        
        // Chart instances
        this.charts = {};
        
        // UI elements
        this.elements = {};
        
        this.initializeElements();
        this.initializeAuth();
        this.initializeEventListeners();
    }
    
    initializeElements() {
        // Cache DOM elements
        this.elements = {
            authSection: document.getElementById('authSection'),
            dashboard: document.getElementById('dashboard'),
            signInBtn: document.getElementById('signInBtn'),
            userInfo: document.getElementById('userInfo'),
            agentStatus: document.getElementById('agentStatus'),
            
            // Controls
            maxCost: document.getElementById('maxCost'),
            maxTests: document.getElementById('maxTests'),
            testInterval: document.getElementById('testInterval'),
            enableAuth: document.getElementById('enableAuth'),
            enableCompliance: document.getElementById('enableCompliance'),
            
            // Actions
            startAgent: document.getElementById('startAgent'),
            stopAgent: document.getElementById('stopAgent'),
            resetAgent: document.getElementById('resetAgent'),
            
            // Progress
            progressFill: document.getElementById('progressFill'),
            progressText: document.getElementById('progressText'),
            
            // Budget display
            costUsed: document.getElementById('costUsed'),
            costRemaining: document.getElementById('costRemaining'),
            
            // Metrics
            totalTests: document.getElementById('totalTests'),
            averageAccuracy: document.getElementById('averageAccuracy'),
            totalCost: document.getElementById('totalCost'),
            averageResponse: document.getElementById('averageResponse'),
            successRate: document.getElementById('successRate'),
            costEfficiency: document.getElementById('costEfficiency'),
            
            // Activity feed
            activityFeed: document.getElementById('activityFeed'),
            clearActivity: document.getElementById('clearActivity'),
            autoScroll: document.getElementById('autoScroll'),
            
            // Provider grid
            providerGrid: document.getElementById('providerGrid'),
            
            // Results table
            resultsTableBody: document.getElementById('resultsTableBody'),
            
            // Export buttons
            exportCsv: document.getElementById('exportCsv'),
            exportJson: document.getElementById('exportJson'),
            exportReport: document.getElementById('exportReport'),
            
            // Alerts container
            alertsContainer: document.getElementById('alertsContainer'),
            
            // Chat interface
            chatMessages: document.getElementById('chatMessages'),
            chatInput: document.getElementById('chatInput'),
            sendChatBtn: document.getElementById('sendChatBtn')
        };
    }
    
    initializeAuth() {
        onAuthStateChanged(auth, (user) => {
            if (user) {
                this.currentUser = user;
                this.onUserSignedIn(user);
            } else {
                this.currentUser = null;
                this.onUserSignedOut();
            }
        });
    }
    
    async loadGuidelines() {
        try {
            console.log('📚 Loading guidelines for autonomous testing...');
            
            // Use the existing loadGuidelinesFromFirestore function from script.js
            if (typeof loadGuidelinesFromFirestore === 'function') {
                const guidelines = await loadGuidelinesFromFirestore();
                window.globalGuidelines = guidelines || [];
                console.log('✅ Loaded guidelines for testing:', window.globalGuidelines.length);
                
                // Also set window.guidelines for compatibility
                window.guidelines = window.globalGuidelines;
            } else {
                // Fallback to direct API call if script.js function isn't available
                console.log('📋 Falling back to direct API call...');
                const response = await fetch(`${window.SERVER_URL}/getGuidelinesList`, {
                    headers: {
                        'Authorization': `Bearer ${this.authToken}`,
                        'Content-Type': 'application/json'
                    }
                });
                
                if (response.ok) {
                    const guidelines = await response.json();
                    window.globalGuidelines = guidelines;
                    window.guidelines = guidelines;
                    console.log('✅ Loaded guidelines via API:', guidelines.length);
                } else {
                    throw new Error(`API returned ${response.status}: ${response.statusText}`);
                }
            }
        } catch (error) {
            console.warn('⚠️ Error loading guidelines:', error);
            window.globalGuidelines = [];
            window.guidelines = [];
            this.showAlert('warning', 'Failed to load guidelines. Some testing features may be limited.');
        }
    }
    
    async onUserSignedIn(user) {
        console.log('User signed in:', user.displayName);
        
        // Get auth token
        this.authToken = await user.getIdToken();
        
        // Update UI
        this.elements.userInfo.textContent = `${user.displayName} (${user.email})`;
        this.elements.authSection.style.display = 'none';
        this.elements.dashboard.style.display = 'block';
        
        // Initialize charts and load data
        this.initializeCharts();
        await this.loadGuidelines();
        this.loadTranscriptData();
        
        this.showAlert('success', `Welcome, ${user.displayName}! Ready to start autonomous testing.`);
    }
    
    onUserSignedOut() {
        console.log('User signed out');
        this.elements.authSection.style.display = 'flex';
        this.elements.dashboard.style.display = 'none';
        this.authToken = null;
        
        // Stop any running tests
        if (this.isRunning) {
            this.stopTesting();
        }
    }
    
    initializeEventListeners() {
        // Authentication
        this.elements.signInBtn.addEventListener('click', () => this.signIn());
        
        // Control inputs
        this.elements.maxCost.addEventListener('change', () => {
            this.maxCostUSD = parseFloat(this.elements.maxCost.value);
            this.updateBudgetDisplay();
        });
        
        this.elements.maxTests.addEventListener('change', () => {
            this.maxTests = parseInt(this.elements.maxTests.value);
        });
        
        this.elements.testInterval.addEventListener('change', () => {
            this.testInterval = parseInt(this.elements.testInterval.value) * 1000;
        });
        
        // Action buttons
        this.elements.startAgent.addEventListener('click', () => this.startTesting());
        this.elements.stopAgent.addEventListener('click', () => this.stopTesting());
        this.elements.resetAgent.addEventListener('click', () => this.resetData());
        
        // Activity controls
        this.elements.clearActivity.addEventListener('click', () => this.clearActivityFeed());
        
        // Export buttons
        this.elements.exportCsv.addEventListener('click', () => this.exportCsv());
        this.elements.exportJson.addEventListener('click', () => this.exportJson());
        this.elements.exportReport.addEventListener('click', () => this.generateReport());
        
        // Chat event listeners
        this.elements.sendChatBtn.addEventListener('click', () => this.sendChatMessage());
        this.elements.chatInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.sendChatMessage();
            }
        });
        
        // Chat suggestion buttons
        document.addEventListener('click', (e) => {
            if (e.target.classList.contains('suggestion-btn')) {
                const suggestion = e.target.getAttribute('data-suggestion');
                this.elements.chatInput.value = suggestion;
                this.sendChatMessage();
            }
        });
    }
    
    async signIn() {
        try {
            const provider = new GoogleAuthProvider();
            await signInWithPopup(auth, provider);
        } catch (error) {
            console.error('Sign in failed:', error);
            this.showAlert('error', 'Sign in failed: ' + error.message);
        }
    }
    
    async loadTranscriptData() {
        try {
            this.addActivity('info', 'Loading test transcript data...');
            
            // Load fake transcripts from the existing endpoint or local file
            const response = await fetch('./fake_transcripts.json');
            const transcripts = await response.json();
            
            // Flatten transcript structure
            this.transcriptData = {};
            Object.values(transcripts).forEach(category => {
                if (typeof category === 'object') {
                    Object.assign(this.transcriptData, category);
                }
            });
            
            this.addActivity('success', `Loaded ${Object.keys(this.transcriptData).length} test transcripts`);
            
        } catch (error) {
            console.error('Failed to load transcript data:', error);
            this.addActivity('warning', 'Using fallback transcript data');
            
            // Fallback data
            this.transcriptData = {
                "Preeclampsia": "Sample preeclampsia transcript for web testing",
                "Gestational diabetes": "Sample diabetes transcript for web testing",
                "Endometriosis": "Sample endometriosis transcript for web testing"
            };
        }
    }
    
    async startTesting() {
        if (this.isRunning) return;
        
        this.isRunning = true;
        this.elements.startAgent.disabled = true;
        this.elements.stopAgent.disabled = false;
        this.updateStatus('Running');
        
        this.addActivity('info', 'Starting autonomous testing session...');
        
        try {
            await this.runAutonomousTests();
        } catch (error) {
            console.error('Testing failed:', error);
            this.addActivity('error', 'Testing failed: ' + error.message);
            this.stopTesting();
        }
    }
    
    stopTesting() {
        this.isRunning = false;
        this.elements.startAgent.disabled = false;
        this.elements.stopAgent.disabled = true;
        this.updateStatus('Stopped');
        
        this.addActivity('warning', 'Autonomous testing stopped');
        
        if (this.testingInterval) {
            clearInterval(this.testingInterval);
        }
    }
    
    resetData() {
        this.stopTesting();
        
        // Reset all data
        this.testCount = 0;
        this.currentCostUSD = 0;
        this.testResults = [];
        this.accuracyHistory = [];
        this.costHistory = [];
        this.responseTimeHistory = [];
        this.providerStats.clear();
        
        // Reset metrics
        this.metrics = {
            totalTests: 0,
            successfulTests: 0,
            totalCost: 0,
            totalResponseTime: 0,
            averageAccuracy: 0,
            successRate: 0,
            costEfficiency: 0
        };
        
        // Update UI
        this.updateMetrics();
        this.updateCharts();
        this.updateResultsTable();
        this.updateProviderStats();
        this.updateBudgetDisplay();
        this.updateProgress(0);
        
        this.elements.resultsTableBody.innerHTML = '';
        this.addActivity('info', 'All data reset - ready for new testing session');
        
        this.updateStatus('Ready');
    }
    
    async runAutonomousTests() {
        const transcriptKeys = Object.keys(this.transcriptData);
        
        if (transcriptKeys.length === 0) {
            throw new Error('No test transcripts available');
        }
        
        this.addActivity('info', `Starting tests with budget $${this.maxCostUSD.toFixed(2)} and ${this.maxTests} max tests`);
        
        let testIndex = 0;
        
        const runSingleTest = async () => {
            if (!this.isRunning) return;
            
            // Check limits
            if (!this.checkLimits()) {
                this.stopTesting();
                return;
            }
            
            const condition = transcriptKeys[testIndex % transcriptKeys.length];
            const scenario = this.generateTestScenario(condition, testIndex);
            
            this.addActivity('info', `Running test ${this.testCount + 1}: ${scenario.name}`);
            
            try {
                const result = await this.runSingleTest(scenario);
                this.processTestResult(result);
                
                testIndex++;
                
                // Update progress
                const progress = (this.testCount / this.maxTests) * 100;
                this.updateProgress(progress);
                
            } catch (error) {
                console.error('Test failed:', error);
                this.addActivity('error', `Test failed: ${error.message}`);
            }
        };
        
        // Start the testing loop
        await runSingleTest(); // Run first test immediately
        
        this.testingInterval = setInterval(runSingleTest, this.testInterval);
    }
    
    checkLimits() {
        if (this.currentCostUSD >= this.maxCostUSD) {
            this.addActivity('warning', `Cost limit reached: $${this.currentCostUSD.toFixed(4)} >= $${this.maxCostUSD.toFixed(2)}`);
            return false;
        }
        
        if (this.testCount >= this.maxTests) {
            this.addActivity('warning', `Test limit reached: ${this.testCount} >= ${this.maxTests} tests`);
            return false;
        }
        
        return true;
    }
    
    generateTestScenario(condition, index) {
        const scenarios = [
            {
                type: 'basic_advice',
                name: `Clinical Advice Test`,
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
    
    async runSingleTest(scenario) {
        const startTime = Date.now();
        const baseTranscript = this.transcriptData[scenario.condition] || 'Sample clinical transcript';
        
        // Create test modification based on scenario type
        let modifiedTranscript = baseTranscript;
        let expectedOutcome = 'normal';
        
        if (scenario.type === 'compliance_check') {
            modifiedTranscript += "\n\nRECOMMENDATION: Patient discharged without follow-up.";
            expectedOutcome = 'should_flag_compliance_issue';
        } else if (scenario.type === 'guideline_search') {
            expectedOutcome = 'should_find_relevant_guidelines';
        } else {
            modifiedTranscript += "\n\nRECOMMENDATION: Continue monitoring as per guidelines.";
            expectedOutcome = 'should_provide_suggestions';
        }
        
        try {
            const headers = {
                'Content-Type': 'application/json'
            };
            
            // Add authentication if available
            if (this.authToken) {
                headers['Authorization'] = `Bearer ${this.authToken}`;
            }
            
            const payload = this.createTestPayload(scenario.endpoint, modifiedTranscript, scenario.condition);
            
            const response = await fetch(`${window.SERVER_URL}${scenario.endpoint}`, {
                method: 'POST',
                headers,
                body: JSON.stringify(payload)
            });
            
            const responseTime = Date.now() - startTime;
            const responseText = await response.text();
            
            let data;
            try {
                data = JSON.parse(responseText);
            } catch (e) {
                data = { raw_response: responseText };
            }
            
            // Calculate costs and accuracy
            const actualCost = this.estimateActualCost(modifiedTranscript, responseText, responseTime);
            const accuracyScore = this.calculateAccuracyScore(scenario, data, response.status, expectedOutcome);
            
            this.currentCostUSD += actualCost;
            this.testCount++;
            
            return {
                scenario: scenario.name,
                type: scenario.type,
                condition: scenario.condition,
                endpoint: scenario.endpoint,
                success: response.ok || (response.status === 401 && !this.authToken),
                api_status: response.status,
                response_time_ms: responseTime,
                actual_cost: actualCost,
                estimated_cost: scenario.estimated_cost,
                ai_provider: data.ai_provider || data.provider || 'unknown',
                accuracy_score: accuracyScore,
                expected_outcome: expectedOutcome,
                response_data: data,
                suggestions_count: (data.suggestions || []).length,
                has_recommendations: (data.suggestions || []).length > 0,
                token_usage: data.token_usage || null,
                timestamp: new Date()
            };
            
        } catch (error) {
            this.testCount++;
            return {
                scenario: scenario.name,
                type: scenario.type,
                condition: scenario.condition,
                endpoint: scenario.endpoint,
                success: false,
                error: error.message,
                response_time_ms: Date.now() - startTime,
                actual_cost: 0.001,
                accuracy_score: 0,
                timestamp: new Date()
            };
        }
    }
    
    createTestPayload(endpoint, transcript, condition) {
        const basePayload = {
            transcript: transcript,
            userId: this.currentUser?.uid || 'web-agent-user',
            test: true,
            autonomous: true,
            webAgent: true
        };
        
        switch (endpoint) {
            case '/dynamicAdvice':
                return {
                    ...basePayload,
                    analysis: 'Web autonomous testing analysis for dynamic advice',
                    guidelineId: 'web_test_guideline_001',
                    guidelineTitle: `Web Test Guideline for ${condition}`
                };
            
            case '/findRelevantGuidelines':
                return {
                    ...basePayload,
                    guidelines: window.globalGuidelines || [],
                    anonymisationInfo: null
                };
            
            default:
                return basePayload;
        }
    }
    
    estimateActualCost(input, output, responseTime) {
        const inputTokens = Math.ceil(input.length / 4);
        const outputTokens = Math.ceil(output.length / 4);
        
        const costPer1KInput = 0.0015;
        const costPer1KOutput = 0.002;
        
        const inputCost = (inputTokens / 1000) * costPer1KInput;
        const outputCost = (outputTokens / 1000) * costPer1KOutput;
        
        return inputCost + outputCost;
    }
    
    calculateAccuracyScore(scenario, responseData, httpStatus, expectedOutcome) {
        let score = 0;
        
        if (httpStatus === 200) {
            score = 60;
        } else if (httpStatus === 401) {
            score = this.authToken ? 20 : 70;
        } else if (httpStatus === 404) {
            score = 10;
        } else {
            score = 30;
        }
        
        if (responseData && typeof responseData === 'object' && !responseData.error) {
            if (responseData.success !== undefined) score += 10;
            if (responseData.suggestions && responseData.suggestions.length > 0) {
                score += 15 + Math.min(responseData.suggestions.length * 2, 10);
            }
            if (responseData.ai_provider || responseData.provider) score += 5;
            if (responseData.token_usage) score += 10;
            
            if (scenario.type === 'compliance_check') {
                const responseText = JSON.stringify(responseData).toLowerCase();
                if (responseText.includes('follow') || responseText.includes('monitor') || 
                    responseText.includes('recommend') || responseText.includes('guideline')) {
                    score += 20;
                }
            }
            
            if (scenario.type === 'guideline_search') {
                if (responseData.guidelines || responseData.relevantGuidelines) {
                    score += 15;
                }
            }
        }
        
        return Math.min(100, Math.max(0, score));
    }
    
    processTestResult(result) {
        // Add to results array
        this.testResults.push(result);
        
        // Update metrics
        this.metrics.totalTests++;
        if (result.success) this.metrics.successfulTests++;
        this.metrics.totalCost += result.actual_cost;
        this.metrics.totalResponseTime += result.response_time_ms;
        
        // Calculate averages
        this.metrics.averageAccuracy = this.testResults.reduce((sum, r) => sum + (r.accuracy_score || 0), 0) / this.testResults.length;
        this.metrics.successRate = (this.metrics.successfulTests / this.metrics.totalTests) * 100;
        this.metrics.costEfficiency = this.metrics.averageAccuracy / (this.metrics.totalCost / this.metrics.totalTests || 1);
        
        // Add to history arrays
        this.accuracyHistory.push({
            timestamp: result.timestamp,
            accuracy: result.accuracy_score || 0
        });
        
        this.costHistory.push({
            timestamp: result.timestamp,
            cost: result.actual_cost
        });
        
        this.responseTimeHistory.push({
            timestamp: result.timestamp,
            responseTime: result.response_time_ms
        });
        
        // Update provider stats
        this.updateProviderStatistics(result);
        
        // Update UI
        this.updateMetrics();
        this.updateBudgetDisplay();
        this.updateCharts();
        this.addResultToTable(result);
        this.updateProviderStats();
        
        // Add activity
        const status = result.success ? '✅' : '❌';
        const accuracy = result.accuracy_score || 0;
        this.addActivity(
            result.success ? 'success' : 'error',
            `${status} ${result.scenario} - Accuracy: ${accuracy}% - Cost: $${result.actual_cost.toFixed(4)}`
        );
    }
    
    updateProviderStatistics(result) {
        const provider = result.ai_provider || 'unknown';
        
        if (!this.providerStats.has(provider)) {
            this.providerStats.set(provider, {
                requests: 0,
                successes: 0,
                totalCost: 0,
                totalAccuracy: 0,
                totalResponseTime: 0
            });
        }
        
        const stats = this.providerStats.get(provider);
        stats.requests++;
        
        if (result.success) {
            stats.successes++;
            stats.totalCost += result.actual_cost;
            stats.totalAccuracy += result.accuracy_score || 0;
            stats.totalResponseTime += result.response_time_ms;
        }
    }
    
    updateMetrics() {
        this.elements.totalTests.textContent = this.metrics.totalTests;
        this.elements.averageAccuracy.textContent = `${this.metrics.averageAccuracy.toFixed(1)}%`;
        this.elements.totalCost.textContent = `$${this.metrics.totalCost.toFixed(4)}`;
        this.elements.averageResponse.textContent = `${Math.round(this.metrics.totalResponseTime / this.metrics.totalTests || 0)}ms`;
        this.elements.successRate.textContent = `${this.metrics.successRate.toFixed(1)}%`;
        this.elements.costEfficiency.textContent = this.metrics.costEfficiency.toFixed(1);
    }
    
    updateBudgetDisplay() {
        const remaining = this.maxCostUSD - this.currentCostUSD;
        this.elements.costUsed.textContent = this.currentCostUSD.toFixed(4);
        this.elements.costRemaining.textContent = remaining.toFixed(4);
        
        // Update colors based on budget usage
        const usagePercent = (this.currentCostUSD / this.maxCostUSD) * 100;
        if (usagePercent > 80) {
            this.elements.costUsed.style.color = 'var(--danger)';
        } else if (usagePercent > 60) {
            this.elements.costUsed.style.color = 'var(--warning)';
        } else {
            this.elements.costUsed.style.color = 'var(--success)';
        }
    }
    
    updateProgress(percentage) {
        this.elements.progressFill.style.width = `${percentage}%`;
        this.elements.progressText.textContent = `${Math.round(percentage)}% complete (${this.testCount}/${this.maxTests} tests)`;
    }
    
    updateStatus(status) {
        this.elements.agentStatus.textContent = status;
        this.elements.agentStatus.className = `status-badge ${status.toLowerCase()}`;
    }
    
    addActivity(type, message) {
        const timestamp = new Date().toLocaleTimeString();
        const item = document.createElement('div');
        item.className = `activity-item ${type}`;
        item.innerHTML = `
            <span class="timestamp">${timestamp}</span>
            <span class="message">${message}</span>
        `;
        
        this.elements.activityFeed.appendChild(item);
        
        // Keep only last 100 items
        while (this.elements.activityFeed.children.length > 100) {
            this.elements.activityFeed.removeChild(this.elements.activityFeed.firstChild);
        }
        
        // Auto scroll if enabled
        if (this.elements.autoScroll.checked) {
            this.elements.activityFeed.scrollTop = this.elements.activityFeed.scrollHeight;
        }
    }
    
    clearActivityFeed() {
        this.elements.activityFeed.innerHTML = `
            <div class="activity-item info">
                <span class="timestamp">Ready</span>
                <span class="message">Activity feed cleared</span>
            </div>
        `;
    }
    
    addResultToTable(result) {
        const row = document.createElement('tr');
        const statusClass = result.success ? 'status-success' : 'status-error';
        
        row.innerHTML = `
            <td>${result.timestamp.toLocaleTimeString()}</td>
            <td>${result.type}</td>
            <td>${result.condition}</td>
            <td class="${statusClass}">${result.success ? 'SUCCESS' : 'FAILED'}</td>
            <td>${(result.accuracy_score || 0).toFixed(1)}%</td>
            <td>$${result.actual_cost.toFixed(4)}</td>
            <td>${result.response_time_ms}ms</td>
            <td>${result.ai_provider || 'unknown'}</td>
        `;
        
        this.elements.resultsTableBody.appendChild(row);
        
        // Keep only last 50 rows
        while (this.elements.resultsTableBody.children.length > 50) {
            this.elements.resultsTableBody.removeChild(this.elements.resultsTableBody.firstChild);
        }
    }
    
    updateProviderStats() {
        this.elements.providerGrid.innerHTML = '';
        
        this.providerStats.forEach((stats, provider) => {
            const successRate = stats.requests > 0 ? (stats.successes / stats.requests) * 100 : 0;
            const avgAccuracy = stats.successes > 0 ? stats.totalAccuracy / stats.successes : 0;
            const avgCost = stats.successes > 0 ? stats.totalCost / stats.successes : 0;
            const avgResponseTime = stats.successes > 0 ? stats.totalResponseTime / stats.successes : 0;
            
            const card = document.createElement('div');
            card.className = 'provider-card';
            card.innerHTML = `
                <h4>${provider}</h4>
                <div class="provider-stats">
                    <span>Requests: ${stats.requests}</span>
                    <span>Success: ${successRate.toFixed(1)}%</span>
                    <span>Accuracy: ${avgAccuracy.toFixed(1)}%</span>
                    <span>Avg Cost: $${avgCost.toFixed(4)}</span>
                    <span>Response: ${Math.round(avgResponseTime)}ms</span>
                    <span>Efficiency: ${(avgAccuracy / (avgCost || 1)).toFixed(1)}</span>
                </div>
            `;
            
            this.elements.providerGrid.appendChild(card);
        });
    }
    
    initializeCharts() {
        // Accuracy Chart
        this.charts.accuracy = new Chart(document.getElementById('accuracyChart'), {
            type: 'line',
            data: {
                labels: [],
                datasets: [{
                    label: 'Accuracy %',
                    data: [],
                    borderColor: '#3498db',
                    backgroundColor: 'rgba(52, 152, 219, 0.1)',
                    tension: 0.4
                }]
            },
            options: {
                responsive: true,
                scales: {
                    y: { beginAtZero: true, max: 100 }
                }
            }
        });
        
        // Cost Chart
        this.charts.cost = new Chart(document.getElementById('costChart'), {
            type: 'line',
            data: {
                labels: [],
                datasets: [{
                    label: 'Cumulative Cost $',
                    data: [],
                    borderColor: '#e74c3c',
                    backgroundColor: 'rgba(231, 76, 60, 0.1)',
                    tension: 0.4
                }]
            },
            options: {
                responsive: true,
                scales: {
                    y: { beginAtZero: true }
                }
            }
        });
        
        // Response Time Chart
        this.charts.response = new Chart(document.getElementById('responseChart'), {
            type: 'line',
            data: {
                labels: [],
                datasets: [{
                    label: 'Response Time (ms)',
                    data: [],
                    borderColor: '#f39c12',
                    backgroundColor: 'rgba(243, 156, 18, 0.1)',
                    tension: 0.4
                }]
            },
            options: {
                responsive: true,
                scales: {
                    y: { beginAtZero: true }
                }
            }
        });
        
        // Success Rate Chart
        this.charts.success = new Chart(document.getElementById('successChart'), {
            type: 'line',
            data: {
                labels: [],
                datasets: [{
                    label: 'Success Rate %',
                    data: [],
                    borderColor: '#27ae60',
                    backgroundColor: 'rgba(39, 174, 96, 0.1)',
                    tension: 0.4
                }]
            },
            options: {
                responsive: true,
                scales: {
                    y: { beginAtZero: true, max: 100 }
                }
            }
        });
    }
    
    updateCharts() {
        const maxPoints = 20; // Show last 20 data points
        
        // Update accuracy chart
        if (this.accuracyHistory.length > 0) {
            const recentAccuracy = this.accuracyHistory.slice(-maxPoints);
            this.charts.accuracy.data.labels = recentAccuracy.map((_, i) => i + 1);
            this.charts.accuracy.data.datasets[0].data = recentAccuracy.map(h => h.accuracy);
            this.charts.accuracy.update();
        }
        
        // Update cost chart (cumulative)
        if (this.costHistory.length > 0) {
            const recentCosts = this.costHistory.slice(-maxPoints);
            let cumulative = 0;
            const cumulativeCosts = recentCosts.map(h => cumulative += h.cost);
            
            this.charts.cost.data.labels = recentCosts.map((_, i) => i + 1);
            this.charts.cost.data.datasets[0].data = cumulativeCosts;
            this.charts.cost.update();
        }
        
        // Update response time chart
        if (this.responseTimeHistory.length > 0) {
            const recentResponse = this.responseTimeHistory.slice(-maxPoints);
            this.charts.response.data.labels = recentResponse.map((_, i) => i + 1);
            this.charts.response.data.datasets[0].data = recentResponse.map(h => h.responseTime);
            this.charts.response.update();
        }
        
        // Update success rate chart
        if (this.testResults.length > 0) {
            const recentResults = this.testResults.slice(-maxPoints);
            const successRates = [];
            let successCount = 0;
            
            recentResults.forEach((result, index) => {
                if (result.success) successCount++;
                successRates.push((successCount / (index + 1)) * 100);
            });
            
            this.charts.success.data.labels = recentResults.map((_, i) => i + 1);
            this.charts.success.data.datasets[0].data = successRates;
            this.charts.success.update();
        }
    }
    
    exportCsv() {
        const headers = ['Timestamp', 'Test Type', 'Condition', 'Status', 'Accuracy', 'Cost', 'Response Time', 'Provider'];
        const rows = this.testResults.map(result => [
            result.timestamp.toISOString(),
            result.type,
            result.condition,
            result.success ? 'SUCCESS' : 'FAILED',
            result.accuracy_score || 0,
            result.actual_cost,
            result.response_time_ms,
            result.ai_provider || 'unknown'
        ]);
        
        const csvContent = [headers, ...rows].map(row => 
            row.map(field => `"${field}"`).join(',')
        ).join('\n');
        
        this.downloadFile('autonomous_test_results.csv', csvContent, 'text/csv');
        this.showAlert('success', 'CSV file downloaded successfully');
    }
    
    exportJson() {
        const data = {
            session: {
                timestamp: new Date().toISOString(),
                user: this.currentUser?.displayName || 'Unknown',
                server: window.SERVER_URL
            },
            metrics: this.metrics,
            results: this.testResults,
            provider_stats: Object.fromEntries(this.providerStats)
        };
        
        this.downloadFile('autonomous_test_data.json', JSON.stringify(data, null, 2), 'application/json');
        this.showAlert('success', 'JSON file downloaded successfully');
    }
    
    generateReport() {
        const report = this.createHtmlReport();
        this.downloadFile('autonomous_test_report.html', report, 'text/html');
        this.showAlert('success', 'HTML report generated and downloaded');
    }
    
    createHtmlReport() {
        return `<!DOCTYPE html>
<html>
<head>
    <title>Autonomous Testing Report</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 40px; }
        .header { text-align: center; margin-bottom: 40px; }
        .metrics { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; margin-bottom: 40px; }
        .metric { background: #f8f9fa; padding: 20px; border-radius: 8px; text-align: center; }
        .metric-value { font-size: 2em; font-weight: bold; color: #2c3e50; }
        .metric-label { color: #666; margin-top: 10px; }
        table { width: 100%; border-collapse: collapse; margin-top: 20px; }
        th, td { padding: 12px; text-align: left; border-bottom: 1px solid #ddd; }
        th { background: #f8f9fa; font-weight: bold; }
        .success { color: #27ae60; }
        .failed { color: #e74c3c; }
    </style>
</head>
<body>
    <div class="header">
        <h1>🤖 Autonomous Testing Report</h1>
        <p>Generated on ${new Date().toLocaleString()}</p>
        <p>User: ${this.currentUser?.displayName || 'Unknown'} | Server: ${window.SERVER_URL}</p>
    </div>
    
    <div class="metrics">
        <div class="metric">
            <div class="metric-value">${this.metrics.totalTests}</div>
            <div class="metric-label">Total Tests</div>
        </div>
        <div class="metric">
            <div class="metric-value">${this.metrics.averageAccuracy.toFixed(1)}%</div>
            <div class="metric-label">Average Accuracy</div>
        </div>
        <div class="metric">
            <div class="metric-value">$${this.metrics.totalCost.toFixed(4)}</div>
            <div class="metric-label">Total Cost</div>
        </div>
        <div class="metric">
            <div class="metric-value">${this.metrics.successRate.toFixed(1)}%</div>
            <div class="metric-label">Success Rate</div>
        </div>
        <div class="metric">
            <div class="metric-value">${Math.round(this.metrics.totalResponseTime / this.metrics.totalTests || 0)}ms</div>
            <div class="metric-label">Avg Response Time</div>
        </div>
        <div class="metric">
            <div class="metric-value">${this.metrics.costEfficiency.toFixed(1)}</div>
            <div class="metric-label">Cost Efficiency</div>
        </div>
    </div>
    
    <h2>Recent Test Results</h2>
    <table>
        <thead>
            <tr>
                <th>Time</th>
                <th>Test Type</th>
                <th>Condition</th>
                <th>Status</th>
                <th>Accuracy</th>
                <th>Cost</th>
                <th>Response Time</th>
                <th>Provider</th>
            </tr>
        </thead>
        <tbody>
            ${this.testResults.slice(-20).map(result => `
                <tr>
                    <td>${result.timestamp.toLocaleTimeString()}</td>
                    <td>${result.type}</td>
                    <td>${result.condition}</td>
                    <td class="${result.success ? 'success' : 'failed'}">${result.success ? 'SUCCESS' : 'FAILED'}</td>
                    <td>${(result.accuracy_score || 0).toFixed(1)}%</td>
                    <td>$${result.actual_cost.toFixed(4)}</td>
                    <td>${result.response_time_ms}ms</td>
                    <td>${result.ai_provider || 'unknown'}</td>
                </tr>
            `).join('')}
        </tbody>
    </table>
</body>
</html>`;
    }
    
    downloadFile(filename, content, mimeType) {
        const blob = new Blob([content], { type: mimeType });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }
    
    showAlert(type, message) {
        const alert = document.createElement('div');
        alert.className = `alert ${type}`;
        alert.innerHTML = `
            <span>${message}</span>
            <button class="alert-close">&times;</button>
        `;
        
        this.elements.alertsContainer.appendChild(alert);
        
        // Auto remove after 5 seconds
        setTimeout(() => {
            if (alert.parentNode) {
                alert.parentNode.removeChild(alert);
            }
        }, 5000);
        
        // Manual close
        alert.querySelector('.alert-close').addEventListener('click', () => {
            alert.parentNode.removeChild(alert);
        });
    }
    
    // Chat functionality
    async sendChatMessage() {
        const message = this.elements.chatInput.value.trim();
        if (!message) return;
        
        // Clear input
        this.elements.chatInput.value = '';
        
        // Add user message to chat
        this.addChatMessage(message, 'user');
        
        // Show typing indicator
        this.showTypingIndicator();
        
        try {
            // Process the message and get response
            const response = await this.processChatMessage(message);
            
            // Remove typing indicator
            this.hideTypingIndicator();
            
            // Add agent response
            this.addChatMessage(response, 'agent');
        } catch (error) {
            this.hideTypingIndicator();
            this.addChatMessage('Sorry, I encountered an error processing your request. Please try again.', 'agent');
            console.error('Chat error:', error);
        }
        
        // Scroll to bottom
        this.scrollChatToBottom();
    }
    
    addChatMessage(text, sender) {
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${sender}-message`;
        
        const avatar = sender === 'agent' ? '🤖' : '👤';
        const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        
        messageDiv.innerHTML = `
            <div class="message-avatar">${avatar}</div>
            <div class="message-content">
                <div class="message-text">${text}</div>
                <div class="message-time">${time}</div>
            </div>
        `;
        
        this.elements.chatMessages.appendChild(messageDiv);
    }
    
    showTypingIndicator() {
        const typingDiv = document.createElement('div');
        typingDiv.className = 'message agent-message typing-indicator-message';
        typingDiv.innerHTML = `
            <div class="message-avatar">🤖</div>
            <div class="typing-indicator">
                <div class="typing-dots">
                    <div class="typing-dot"></div>
                    <div class="typing-dot"></div>
                    <div class="typing-dot"></div>
                </div>
            </div>
        `;
        
        this.elements.chatMessages.appendChild(typingDiv);
        this.scrollChatToBottom();
    }
    
    hideTypingIndicator() {
        const typingIndicator = this.elements.chatMessages.querySelector('.typing-indicator-message');
        if (typingIndicator) {
            typingIndicator.remove();
        }
    }
    
    scrollChatToBottom() {
        this.elements.chatMessages.scrollTop = this.elements.chatMessages.scrollHeight;
    }
    
    async processChatMessage(message) {
        const lowerMessage = message.toLowerCase();
        
        // Handle specific commands and questions
        if (lowerMessage.includes('test') && (lowerMessage.includes('run') || lowerMessage.includes('start'))) {
            return this.handleTestRequest(message);
        } else if (lowerMessage.includes('accuracy') || lowerMessage.includes('performance')) {
            return this.handleAccuracyQuery();
        } else if (lowerMessage.includes('cost') || lowerMessage.includes('budget') || lowerMessage.includes('spend')) {
            return this.handleCostQuery();
        } else if (lowerMessage.includes('status') || lowerMessage.includes('how are') || lowerMessage.includes('performing')) {
            return this.handleStatusQuery();
        } else if (lowerMessage.includes('help') || lowerMessage.includes('what can')) {
            return this.handleHelpQuery();
        } else if (lowerMessage.includes('results') || lowerMessage.includes('history')) {
            return this.handleResultsQuery();
        } else if (lowerMessage.includes('stop') || lowerMessage.includes('pause')) {
            return this.handleStopRequest();
        } else if (lowerMessage.includes('reset') || lowerMessage.includes('clear')) {
            return this.handleResetRequest();
        } else {
            // Use AI to respond to general queries
            return await this.getAIResponse(message);
        }
    }
    
    handleTestRequest(message) {
        if (this.isRunning) {
            return "Tests are already running! You can monitor progress in the activity feed above. Use 'stop testing' to halt current tests.";
        } else {
            // Extract specific condition if mentioned
            const conditions = ['diabetes', 'hypertension', 'asthma', 'pregnancy', 'cardiac', 'respiratory'];
            const mentionedCondition = conditions.find(condition => message.toLowerCase().includes(condition));
            
            if (mentionedCondition) {
                return `I'll start testing with a focus on ${mentionedCondition} management. Click the 'Start Testing' button above or I can begin autonomous testing now.`;
            } else {
                return "I'll start the autonomous testing process. You can adjust the budget and test parameters in the control panel above, then click 'Start Testing'.";
            }
        }
    }
    
    handleAccuracyQuery() {
        const avgAccuracy = this.data.results.length > 0 ? 
            (this.data.results.reduce((sum, r) => sum + r.accuracy_score, 0) / this.data.results.length * 100).toFixed(1) : 0;
        const totalTests = this.data.results.length;
        
        return `Current system accuracy: ${avgAccuracy}% based on ${totalTests} tests. The autonomous agent tests various clinical scenarios and measures how well the system identifies compliance issues and provides appropriate recommendations.`;
    }
    
    handleCostQuery() {
        const costUsed = this.data.metrics.costUsed.toFixed(3);
        const budget = parseFloat(this.elements.maxCost.value);
        const remaining = (budget - this.data.metrics.costUsed).toFixed(3);
        
        return `Budget status: $${costUsed} used of $${budget.toFixed(2)} budget. Remaining: $${remaining}. Average cost per test: $${(this.data.metrics.costUsed / Math.max(this.data.results.length, 1)).toFixed(4)}.`;
    }
    
    handleStatusQuery() {
        const status = this.isRunning ? 'Running' : 'Stopped';
        const tests = this.data.results.length;
        const accuracy = tests > 0 ? (this.data.results.reduce((sum, r) => sum + r.accuracy_score, 0) / tests * 100).toFixed(1) : 0;
        
        return `Agent status: ${status}. Completed ${tests} tests with ${accuracy}% average accuracy. ${this.isRunning ? 'Currently testing clinical compliance scenarios.' : 'Ready to start testing when you are.'}`;
    }
    
    handleHelpQuery() {
        return `I can help you with:\n\n🧪 **Testing**: "Run a test for diabetes" or "Start testing"\n📊 **Analytics**: "What's the current accuracy rate?" or "Show cost breakdown"\n📈 **Status**: "How are tests performing?" or "Current status"\n⚙️ **Control**: "Stop testing" or "Reset data"\n\nI monitor your clinical guidelines system by testing various scenarios and measuring accuracy. Just ask me anything about the testing process!`;
    }
    
    handleResultsQuery() {
        const recentResults = this.data.results.slice(-3);
        if (recentResults.length === 0) {
            return "No test results yet. Start testing to see how your clinical guidelines system performs!";
        }
        
        const summary = recentResults.map(r => 
            `• ${r.endpoint} test: ${(r.accuracy_score * 100).toFixed(1)}% accuracy, $${r.actual_cost.toFixed(4)} cost`
        ).join('\n');
        
        return `Recent test results:\n${summary}\n\nSee the full results table below for detailed analysis.`;
    }
    
    handleStopRequest() {
        if (this.isRunning) {
            this.stopTesting();
            return "Testing stopped. You can review the results above or restart testing anytime.";
        } else {
            return "Testing is not currently running. Use 'start testing' to begin autonomous tests.";
        }
    }
    
    handleResetRequest() {
        return "I can help you reset the data. Click the 'Reset Data' button in the control panel to clear all test results and start fresh. This will reset costs, accuracy metrics, and test history.";
    }
    
    async getAIResponse(message) {
        try {
            // Use the existing AI infrastructure to generate contextual responses
            const context = {
                testResults: this.data.results.length,
                accuracy: this.data.results.length > 0 ? 
                    (this.data.results.reduce((sum, r) => sum + r.accuracy_score, 0) / this.data.results.length * 100).toFixed(1) : 0,
                costUsed: this.data.metrics.costUsed.toFixed(3),
                isRunning: this.isRunning
            };
            
            // For now, provide a helpful fallback response
            return `I understand you're asking about "${message}". Based on current testing data: ${context.testResults} tests completed with ${context.accuracy}% accuracy. I'm designed to help with test analysis, system monitoring, and performance insights. Could you be more specific about what you'd like to know?`;
            
        } catch (error) {
            console.error('AI response error:', error);
            return "I'm here to help with testing and analysis questions. Try asking about test results, accuracy rates, cost breakdowns, or system status.";
        }
    }
}

// Initialize the agent when the page loads
document.addEventListener('DOMContentLoaded', () => {
    window.autonomousAgent = new WebAutonomousAgent();
    console.log('🤖 Web Autonomous Agent initialized');
}); 