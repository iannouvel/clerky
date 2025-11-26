// ISO 13485-compliant audit report generation system
// Generates test plans, execution records, and approval workflows

/**
 * Generates ISO 13485-compliant audit report
 * @param {Object} reportData - Report data
 * @returns {Promise<Object>} - Generated report
 */
export async function generateISOCompliantReport(reportData) {
    const {
        guidelineId,
        guidelineTitle,
        testId,
        tests,
        results,
        statistics
    } = reportData;

    const report = {
        reportId: generateReportId(),
        reportDate: new Date().toISOString(),
        version: '1.0',
        
        // ISO 13485 Compliance Header
        isoCompliance: {
            standard: 'ISO 13485:2016',
            section: '7.3 Design and Development - Verification and Validation',
            purpose: 'Clinical Guidance System Verification and Validation Report'
        },
        
        // Document Control
        documentControl: {
            documentType: 'Verification and Validation Report',
            documentStatus: 'Draft',
            revision: '1.0',
            effectiveDate: new Date().toISOString(),
            approvedBy: null,
            approvedDate: null
        },
        
        // Test Plan
        testPlan: {
            objective: 'Systematic evaluation of clinical guidance provision for guideline compliance',
            scope: {
                guidelineId,
                guidelineTitle,
                testCoverage: calculateTestCoverage(tests),
                elementsTested: extractElementCount(tests)
            },
            testStrategy: {
                approach: 'Systematic scenario variation testing',
                testTypes: [
                    'Baseline scenario validation',
                    'Threshold variation testing',
                    'Variable omission testing',
                    'Edge case validation'
                ]
            },
            acceptanceCriteria: {
                minimumAccuracyScore: 75,
                minimumCompletenessScore: 70,
                minimumContextualScore: 70,
                minimumPrecisionScore: 65,
                overallMinimumScore: 75
            }
        },
        
        // Test Execution Records
        testExecution: {
            executionDate: new Date().toISOString(),
            executedBy: reportData.generatedBy || 'System',
            testEnvironment: 'Production-like environment',
            testResults: formatTestResults(tests, results),
            totalTestsExecuted: tests.length,
            passed: countPassedTests(results),
            failed: countFailedTests(results),
            passRate: calculatePassRate(results)
        },
        
        // Results Analysis
        resultsAnalysis: {
            summary: statistics || {},
            detailedFindings: generateDetailedFindings(results),
            issuesIdentified: extractIssues(results),
            recommendations: generateRecommendations(results),
            riskAssessment: assessRisks(results)
        },
        
        // Traceability
        traceability: {
            guidelineId,
            testIds: tests.map(t => t.testId || t.id),
            elementCoverage: generateElementCoverage(tests),
            testCoverage: calculateTestCoveragePercentage(tests, results)
        },
        
        // Quality Records
        qualityRecords: {
            testPlans: tests.map(t => ({
                testId: t.testId || t.id,
                testDate: t.generatedAt || t.createdAt,
                testPlan: 'Systematic scenario variation testing'
            })),
            executionRecords: formatExecutionRecords(tests, results),
            reviewRecords: []
        },
        
        // Approval Workflow
        approvalWorkflow: {
            status: 'Draft',
            reviews: [],
            approvals: [],
            nextReviewDate: calculateNextReviewDate()
        }
    };
    
    return report;
}

/**
 * Formats test results for ISO report
 */
function formatTestResults(tests, results) {
    const formatted = [];
    
    for (const test of tests) {
        const testResults = results.filter(r => r.testId === (test.testId || test.id));
        
        for (const result of testResults) {
            formatted.push({
                testId: test.testId || test.id,
                elementId: result.elementId,
                scenarioId: result.scenarioId,
                evaluation: result.evaluation,
                status: determineTestStatus(result.evaluation),
                timestamp: result.timestamp
            });
        }
    }
    
    return formatted;
}

/**
 * Determines test status from evaluation
 */
function determineTestStatus(evaluation) {
    if (!evaluation || !evaluation.overallScore) {
        return 'UNKNOWN';
    }
    
    const score = evaluation.overallScore;
    if (score >= 90) return 'EXCELLENT';
    if (score >= 75) return 'PASS';
    if (score >= 60) return 'NEEDS_IMPROVEMENT';
    return 'FAIL';
}

/**
 * Counts passed tests
 */
function countPassedTests(results) {
    return results.filter(r => {
        const status = determineTestStatus(r.evaluation);
        return status === 'PASS' || status === 'EXCELLENT';
    }).length;
}

/**
 * Counts failed tests
 */
function countFailedTests(results) {
    return results.filter(r => {
        const status = determineTestStatus(r.evaluation);
        return status === 'FAIL';
    }).length;
}

/**
 * Calculates pass rate
 */
function calculatePassRate(results) {
    if (results.length === 0) return 0;
    const passed = countPassedTests(results);
    return Math.round((passed / results.length) * 100);
}

/**
 * Generates detailed findings
 */
function generateDetailedFindings(results) {
    const findings = {
        strengths: [],
        weaknesses: [],
        criticalIssues: []
    };
    
    for (const result of results) {
        if (result.evaluation) {
            if (result.evaluation.strengths) {
                findings.strengths.push(...result.evaluation.strengths);
            }
            if (result.evaluation.issues) {
                const criticalIssues = result.evaluation.issues.filter(i => 
                    i.toLowerCase().includes('critical') || 
                    i.toLowerCase().includes('safety') ||
                    i.toLowerCase().includes('serious')
                );
                findings.criticalIssues.push(...criticalIssues);
                findings.weaknesses.push(...result.evaluation.issues.filter(i => !criticalIssues.includes(i)));
            }
        }
    }
    
    return findings;
}

/**
 * Extracts issues from results
 */
function extractIssues(results) {
    const issues = [];
    
    for (const result of results) {
        if (result.evaluation && result.evaluation.issues) {
            issues.push({
                elementId: result.elementId,
                scenarioId: result.scenarioId,
                issues: result.evaluation.issues,
                severity: determineSeverity(result.evaluation)
            });
        }
    }
    
    return issues;
}

/**
 * Determines issue severity
 */
function determineSeverity(evaluation) {
    if (!evaluation || !evaluation.overallScore) {
        return 'UNKNOWN';
    }
    
    const score = evaluation.overallScore;
    if (score < 60) return 'HIGH';
    if (score < 75) return 'MEDIUM';
    return 'LOW';
}

/**
 * Generates recommendations
 */
function generateRecommendations(results) {
    const recommendations = [];
    
    // Analyze common issues
    const issueFrequency = {};
    for (const result of results) {
        if (result.evaluation && result.evaluation.recommendations) {
            for (const rec of result.evaluation.recommendations) {
                issueFrequency[rec] = (issueFrequency[rec] || 0) + 1;
            }
        }
    }
    
    // Sort by frequency
    const sortedRecs = Object.entries(issueFrequency)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([rec, count]) => ({
            recommendation: rec,
            frequency: count,
            priority: count > results.length * 0.5 ? 'HIGH' : 'MEDIUM'
        }));
    
    return sortedRecs;
}

/**
 * Assesses risks from results
 */
function assessRisks(results) {
    const risks = {
        high: [],
        medium: [],
        low: []
    };
    
    for (const result of results) {
        if (result.evaluation) {
            const severity = determineSeverity(result.evaluation);
            const risk = {
                elementId: result.elementId,
                scenarioId: result.scenarioId,
                score: result.evaluation.overallScore,
                issues: result.evaluation.issues || [],
                impact: 'Clinical guidance accuracy and patient safety'
            };
            
            if (severity === 'HIGH') {
                risks.high.push(risk);
            } else if (severity === 'MEDIUM') {
                risks.medium.push(risk);
            } else {
                risks.low.push(risk);
            }
        }
    }
    
    return risks;
}

/**
 * Calculates test coverage
 */
function calculateTestCoverage(tests) {
    const elements = new Set();
    const scenarios = new Set();
    
    for (const test of tests) {
        if (test.scenarios) {
            for (const scenarioGroup of test.scenarios) {
                if (scenarioGroup.elementId) {
                    elements.add(scenarioGroup.elementId);
                }
                if (scenarioGroup.variations) {
                    scenarioGroup.variations.forEach(v => scenarios.add(v.type));
                }
            }
        }
    }
    
    return {
        elementsCovered: elements.size,
        scenarioTypesCovered: scenarios.size
    };
}

/**
 * Extracts element count
 */
function extractElementCount(tests) {
    const elements = new Set();
    
    for (const test of tests) {
        if (test.scenarios) {
            for (const scenarioGroup of test.scenarios) {
                if (scenarioGroup.elementId) {
                    elements.add(scenarioGroup.elementId);
                }
            }
        }
    }
    
    return Array.from(elements);
}

/**
 * Generates element coverage
 */
function generateElementCoverage(tests) {
    const coverage = {};
    
    for (const test of tests) {
        if (test.scenarios) {
            for (const scenarioGroup of test.scenarios) {
                const elementId = scenarioGroup.elementId;
                if (elementId) {
                    if (!coverage[elementId]) {
                        coverage[elementId] = {
                            elementId,
                            elementName: scenarioGroup.elementName,
                            scenariosTested: 0,
                            variationsTested: 0
                        };
                    }
                    coverage[elementId].scenariosTested++;
                    coverage[elementId].variationsTested += scenarioGroup.totalVariations || 0;
                }
            }
        }
    }
    
    return Object.values(coverage);
}

/**
 * Calculates test coverage percentage
 */
function calculateTestCoveragePercentage(tests, results) {
    const totalElements = extractElementCount(tests).length;
    const testedElements = new Set(results.map(r => r.elementId));
    
    if (totalElements === 0) return 0;
    return Math.round((testedElements.size / totalElements) * 100);
}

/**
 * Formats execution records
 */
function formatExecutionRecords(tests, results) {
    return tests.map(test => {
        const testResults = results.filter(r => r.testId === (test.testId || test.id));
        return {
            testId: test.testId || test.id,
            executionDate: test.generatedAt || test.createdAt,
            executedBy: test.generatedBy || 'System',
            testCases: testResults.length,
            passed: countPassedTests(testResults),
            failed: countFailedTests(testResults)
        };
    });
}

/**
 * Generates report ID
 */
function generateReportId() {
    return `AUDIT-${Date.now()}-${Math.random().toString(36).substr(2, 9).toUpperCase()}`;
}

/**
 * Calculates next review date (30 days from now)
 */
function calculateNextReviewDate() {
    const date = new Date();
    date.setDate(date.getDate() + 30);
    return date.toISOString();
}

