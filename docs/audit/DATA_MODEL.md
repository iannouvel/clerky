# Enhanced Audit System - Data Model

## Overview

The enhanced audit system uses Firestore collections to store audit tests, interactions, results, and traceability data.

## Collections

### auditTests

Stores test scenarios and configurations.

**Document Structure:**
```javascript
{
  testId: string,                    // Auto-generated document ID
  guidelineId: string,               // Reference to guideline
  scenarios: Array<{                 // Array of scenario groups by element
    elementId: string,
    elementName: string,
    baseScenario: string,            // Baseline scenario transcript
    variations: Array<{              // Scenario variations
      type: string,                  // 'threshold_variation', 'variable_omission', 'edge_case'
      threshold?: string,
      omittedVariable?: string,
      transcript: string,
      expectedGuidance: string
    }>,
    totalVariations: number
  }>,
  totalElements: number,
  generatedBy: string,               // User ID
  generatedAt: Timestamp,
  status: string                     // 'created', 'running', 'completed'
}
```

**Indexes:**
- `guidelineId` (ascending)
- `generatedAt` (descending)
- `status` (ascending)

### auditInteractions

Stores complete LLM interaction logs for audit purposes.

**Document Structure:**
```javascript
{
  interactionId: string,             // Auto-generated document ID
  testId: string,                    // Reference to audit test
  guidelineId: string,
  elementId: string,
  promptChain: {
    systemPrompt: string,
    userPrompt: string,
    fullPrompt: string,
    contextPrompts: Array<string>
  },
  response: {
    content: string,                 // Response text
    metadata: {
      ai_provider: string,
      ai_model: string,
      finish_reason: string,
      created: timestamp
    },
    fullResponse: Object             // Complete response object
  },
  modelConfig: {
    provider: string,
    model: string,
    temperature: number,
    maxTokens: number,
    topP: number,
    frequencyPenalty: number,
    presencePenalty: number
  },
  tokenUsage: {
    prompt_tokens: number,
    completion_tokens: number,
    total_tokens: number,
    estimated_cost_usd: number
  },
  processingTimeMs: number,
  endpoint: string,                  // API endpoint name
  context: Object,                   // Additional context
  timestamp: Timestamp
}
```

**Indexes:**
- `testId` (ascending)
- `guidelineId` (ascending)
- `elementId` (ascending)
- `timestamp` (descending)

### auditResults

Stores evaluation results for each guidance assessment.

**Document Structure:**
```javascript
{
  resultId: string,                  // Auto-generated document ID
  testId: string,                    // Reference to audit test
  interactionId: string,             // Reference to interaction
  elementId: string,
  scenarioId: string,                // Scenario variation ID
  evaluation: {
    accuracyScore: number,           // 0-100
    contextualScore: number,         // 0-100
    completenessScore: number,       // 0-100
    precisionScore: number,          // 0-100
    overallScore: number,            // Weighted overall score
    issues: Array<string>,
    strengths: Array<string>,
    recommendations: Array<string>
  },
  guidance: string,                  // Actual guidance provided
  expectedGuidance: string,          // Expected guidance
  timestamp: Timestamp
}
```

**Indexes:**
- `testId` (ascending)
- `elementId` (ascending)
- `timestamp` (descending)

### auditTraces

Stores traceability chain links.

**Document Structure:**
```javascript
{
  traceId: string,                   // Auto-generated document ID
  guidelineId: string,
  elementId: string,
  testId: string,
  scenarioId: string,
  interactionId: string,
  resultId: string,
  tracePath: {
    guideline: string,
    element: string,
    test: string,
    scenario: string,
    interaction: string,
    result: string
  },
  createdAt: Timestamp
}
```

**Indexes:**
- `guidelineId` (ascending)
- `elementId` (ascending)

### traceabilityMatrix

Stores generated traceability matrices.

**Document Structure:**
```javascript
{
  guidelineId: string,               // Document ID
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
  generatedAt: Timestamp,
  updatedAt: Timestamp
}
```

### auditReports

Stores generated ISO-compliant audit reports.

**Document Structure:**
```javascript
{
  reportId: string,                  // Auto-generated document ID
  guidelineId: string,
  guidelineTitle: string,
  testId: string,
  reportDate: Timestamp,
  isoCompliance: Object,
  testPlan: Object,
  testExecution: Object,
  resultsAnalysis: Object,
  traceability: Object,
  qualityRecords: Object,
  approvalWorkflow: Object,
  format: string,                    // 'json', 'pdf', 'html'
  generatedBy: string,
  generatedAt: Timestamp
}
```

**Indexes:**
- `guidelineId` (ascending)
- `generatedAt` (descending)

## Enhanced Auditable Element Structure

Auditable elements stored in guidelines collection are enhanced with:

```javascript
{
  elementId: string,                 // Unique identifier
  type: string,                      // 'clinical_advice'
  name: string,
  element: string,                   // Detailed description
  significance: string,              // 'high', 'medium', 'low'
  inputVariables: Array<{
    name: string,
    type: string,                    // 'numeric', 'boolean', 'categorical', 'text'
    description: string,
    required: boolean,
    threshold: string,
    thresholdDescription: string,
    variationPoints: Array<string>
  }>,
  derivedAdvice: string,
  expectedGuidance: string,
  variationPoints: Array<{
    parameter: string,
    description: string,
    belowThreshold: string,
    atThreshold: string,
    aboveThreshold: string
  }>,
  thresholds: Array<{
    variable: string,
    thresholdValue: string,
    comparison: string,              // '>=', '>', '<=', '<', '=='
    impact: string
  }>,
  clinicalContext: {
    requiredFactors: Array<string>,
    contraindications: Array<string>,
    patientDemographics: string
  },
  guidelineSection: string
}
```

## Relationships

```
guideline (guidelines collection)
  └─ auditableElements (array)
      └─ elementId
          ├─ auditTests (auditTests collection)
          │   └─ testId
          │       ├─ scenarios (array)
          │       ├─ auditInteractions (auditInteractions collection)
          │       │   └─ interactionId
          │       └─ auditResults (auditResults collection)
          │           └─ resultId
          └─ traceabilityMatrix (traceabilityMatrix collection)
              └─ guidelineId
```

## Data Flow

1. **Guideline** contains **auditableElements** (enhanced structure)
2. **auditTests** generated for guideline elements
3. **scenarios** generated for each element
4. **auditInteractions** logged for each AI call
5. **auditResults** stored for each evaluation
6. **traceabilityMatrix** links everything together
7. **auditReports** generated from all data

## Indexing Strategy

Composite indexes created for common query patterns:
- `guidelineId + status + generatedAt`
- `testId + timestamp`
- `guidelineId + elementId`

## Data Retention

- Audit tests: Retained indefinitely for ISO compliance
- Interactions: Retained for 7 years (regulatory requirement)
- Results: Retained indefinitely
- Reports: Retained indefinitely

## Privacy and Security

- All audit data linked to user ID for access control
- Personal health information should not be included in scenarios
- All interactions logged with full traceability
- Audit logs are immutable once written

