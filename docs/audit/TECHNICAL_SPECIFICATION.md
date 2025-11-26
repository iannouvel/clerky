# Enhanced Audit System - Technical Specification

## Overview

The enhanced audit system provides comprehensive, ISO 13485-compliant evaluation of Clerky's clinical guidance provision. It systematically tests each auditable element within guidelines through subtle scenario variations and captures complete LLM interaction data for fine-tuning.

## Architecture

### Core Components

1. **Enhanced Auditable Element Extraction** (`server.js` - `extractAuditableElements`)
   - Extracts elements with variation points, thresholds, and detailed input variables
   - Enhanced JSON structure includes elementId, thresholds, variationPoints, clinicalContext

2. **Audit Logging System** (`modules/audit-logging.js`)
   - Captures complete LLM interactions with full prompt chains
   - Stores model configuration, token usage, and processing time
   - ISO 13485 compliant audit trail

3. **Scenario Generation** (`modules/scenario-generator.js`, `modules/variation-engine.js`)
   - Systematic generation of baseline + threshold + omission + edge case scenarios
   - Subtle parameter modifications to test guidance boundaries

4. **Multi-Dimensional Evaluation** (`modules/guidance-evaluator.js`)
   - Accuracy, Contextual Appropriateness, Completeness, Precision
   - Weighted overall score calculation

5. **Traceability System** (`modules/traceability-matrix.js`)
   - Complete traceability chain: Guidelines → Elements → Scenarios → Interactions → Results
   - ISO 13485 compliance validation

6. **ISO-Compliant Reporting** (`modules/audit-reporting.js`)
   - Test plans, execution records, results analysis
   - Approval workflows and quality records

## Data Model

### Firestore Collections

#### auditTests
```javascript
{
  testId: string,
  guidelineId: string,
  scenarios: Array<{
    elementId: string,
    elementName: string,
    baseScenario: string,
    variations: Array<Variation>,
    totalVariations: number
  }>,
  totalElements: number,
  generatedBy: string,
  generatedAt: timestamp,
  status: string
}
```

#### auditInteractions
```javascript
{
  interactionId: string,
  testId: string,
  guidelineId: string,
  elementId: string,
  promptChain: {
    systemPrompt: string,
    userPrompt: string,
    fullPrompt: string,
    contextPrompts: Array<string>
  },
  response: {
    content: string,
    metadata: Object,
    fullResponse: Object
  },
  modelConfig: {
    provider: string,
    model: string,
    temperature: number,
    maxTokens: number
  },
  tokenUsage: {
    prompt_tokens: number,
    completion_tokens: number,
    total_tokens: number,
    estimated_cost_usd: number
  },
  processingTimeMs: number,
  timestamp: timestamp
}
```

#### auditResults
```javascript
{
  resultId: string,
  testId: string,
  interactionId: string,
  elementId: string,
  scenarioId: string,
  evaluation: {
    accuracyScore: number,
    contextualScore: number,
    completenessScore: number,
    precisionScore: number,
    overallScore: number,
    issues: Array<string>,
    strengths: Array<string>,
    recommendations: Array<string>
  },
  guidance: string,
  expectedGuidance: string,
  timestamp: timestamp
}
```

#### traceabilityMatrix
```javascript
{
  guidelineId: string,
  elements: Array<Element>,
  tests: Array<Test>,
  scenarios: Array<Scenario>,
  interactions: Array<Interaction>,
  results: Array<Result>,
  summary: {
    totalElements: number,
    totalTests: number,
    totalScenarios: number,
    totalInteractions: number,
    totalResults: number
  },
  generatedAt: timestamp
}
```

## API Endpoints

### POST /generateAuditScenarios
Generates systematic scenario variations for auditable elements.

**Request:**
```json
{
  "guidelineId": "string",
  "elementId": "string (optional)",
  "auditableElements": Array<Element>,
  "aiProvider": "string",
  "options": Object
}
```

**Response:**
```json
{
  "success": true,
  "testId": "string",
  "scenarios": Array<ScenarioGroup>,
  "totalScenarios": number
}
```

### POST /evaluateGuidance
Multi-dimensional guidance evaluation.

**Request:**
```json
{
  "guidance": "string",
  "expectedGuidance": "string",
  "element": Object,
  "scenario": Object,
  "testId": "string",
  "aiProvider": "string"
}
```

**Response:**
```json
{
  "success": true,
  "resultId": "string",
  "evaluation": {
    "accuracyScore": number,
    "contextualScore": number,
    "completenessScore": number,
    "precisionScore": number,
    "overallScore": number,
    "issues": Array<string>,
    "strengths": Array<string>,
    "recommendations": Array<string>
  }
}
```

### GET /auditTraceability
Retrieves traceability matrix for a guideline.

**Query Parameters:**
- `guidelineId`: string (required)

**Response:**
```json
{
  "success": true,
  "matrix": {
    "guidelineId": "string",
    "elements": Array<Element>,
    "tests": Array<Test>,
    "scenarios": Array<Scenario>,
    "interactions": Array<Interaction>,
    "results": Array<Result>,
    "summary": Object
  }
}
```

### POST /auditReport
Generates ISO 13485-compliant audit report.

**Request:**
```json
{
  "guidelineId": "string",
  "testId": "string (optional)",
  "format": "string"
}
```

**Response:**
```json
{
  "success": true,
  "report": {
    "reportId": "string",
    "isoCompliance": Object,
    "testPlan": Object,
    "testExecution": Object,
    "resultsAnalysis": Object,
    "traceability": Object,
    "qualityRecords": Object,
    "approvalWorkflow": Object
  }
}
```

### GET /auditMetrics
Retrieves audit performance metrics.

**Query Parameters:**
- `guidelineId`: string (optional)

**Response:**
```json
{
  "success": true,
  "metrics": {
    "totalTests": number,
    "totalScenarios": number,
    "totalInteractions": number,
    "totalResults": number,
    "averageScore": number,
    "totalTokens": number,
    "totalCost": number
  }
}
```

## Algorithm Specifications

### Scenario Variation Generation

For each auditable element:
1. Generate baseline scenario (standard case)
2. For each threshold:
   - Generate "just below threshold" variation
   - Generate "just above threshold" variation
3. For each required input variable:
   - Generate "missing variable" variation
4. Generate edge case variations (boundaries)

### Multi-Dimensional Evaluation

**Score Calculation:**
- Overall Score = (Accuracy × 0.40) + (Contextual × 0.35) + (Completeness × 0.25)
- Precision adjustment: ±10% based on precision score

**Dimension Definitions:**
- **Accuracy**: Guidance matches expected advice and correctly applies thresholds
- **Contextual**: Guidance accounts for all relevant patient factors
- **Completeness**: All required elements of advice are provided
- **Precision**: Guidance reflects subtle scenario changes appropriately

## Performance Targets

- Scenario generation: <5 seconds per element
- Guidance evaluation: <10 seconds per scenario
- Report generation: <30 seconds for full audit
- Data retrieval: <2 seconds for traceability queries

## ISO 13485 Compliance

The system addresses ISO 13485:2016 requirements:

- **Section 7.3**: Design Controls - Documented verification and validation
- **Risk Management**: Systematic identification of guidance failures
- **Traceability**: Complete audit trail
- **Quality Records**: Structured documentation

See `docs/audit/ISO_13485_COMPLIANCE.md` for detailed compliance mapping.

