# Enhanced Audit System - API Documentation

## Base URL
All endpoints are relative to the server base URL (e.g., `https://clerky-uzni.onrender.com`)

## Authentication
All endpoints require authentication via Bearer token in the Authorization header:
```
Authorization: Bearer <firebase_id_token>
```

## Endpoints

### POST /generateAuditScenarios

Generates systematic scenario variations for auditable elements to test guidance provision.

**Request Body:**
```json
{
  "guidelineId": "string (required)",
  "elementId": "string (optional - to generate for specific element only)",
  "auditableElements": [
    {
      "elementId": "string",
      "name": "string",
      "inputVariables": Array,
      "thresholds": Array,
      "derivedAdvice": "string",
      "expectedGuidance": "string"
    }
  ],
  "aiProvider": "DeepSeek|OpenAI|Claude",
  "options": {
    "includeBaseline": true,
    "includeThresholdVariations": true,
    "includeOmissions": true,
    "includeEdgeCases": true,
    "maxVariations": 10
  }
}
```

**Response:**
```json
{
  "success": true,
  "testId": "test-id-123",
  "scenarios": [
    {
      "elementId": "element-id",
      "elementName": "Element Name",
      "baseScenario": "Clinical transcript text...",
      "variations": [
        {
          "type": "threshold_variation",
          "threshold": "gestational_age",
          "direction": "below",
          "transcript": "Modified transcript...",
          "expectedGuidance": "Expected guidance text"
        }
      ],
      "totalVariations": 3
    }
  ],
  "totalScenarios": 15,
  "generated": "2025-01-15T10:30:00.000Z"
}
```

**Error Response:**
```json
{
  "success": false,
  "error": "Error message",
  "details": "Detailed error information"
}
```

### POST /evaluateGuidance

Evaluates guidance across multiple dimensions (accuracy, contextual appropriateness, completeness, precision).

**Request Body:**
```json
{
  "guidance": "The actual guidance provided by Clerky",
  "expectedGuidance": "The expected guidance from the auditable element",
  "element": {
    "elementId": "string",
    "name": "string",
    "inputVariables": Array,
    "thresholds": Array,
    "derivedAdvice": "string"
  },
  "scenario": {
    "variationId": "string",
    "type": "string",
    "transcript": "string"
  },
  "testId": "string (optional)",
  "aiProvider": "DeepSeek|OpenAI|Claude"
}
```

**Response:**
```json
{
  "success": true,
  "resultId": "result-id-123",
  "evaluation": {
    "accuracyScore": 85,
    "contextualScore": 90,
    "completenessScore": 80,
    "precisionScore": 75,
    "overallScore": 84,
    "issues": [
      "Missing mention of specific timeframe"
    ],
    "strengths": [
      "Correctly identifies threshold requirement",
      "Appropriate clinical context"
    ],
    "recommendations": [
      "Add specific timeframe to guidance",
      "Include follow-up monitoring instructions"
    ]
  }
}
```

### GET /auditTraceability

Retrieves complete traceability matrix for a guideline.

**Query Parameters:**
- `guidelineId` (required): Guideline ID

**Response:**
```json
{
  "success": true,
  "matrix": {
    "guidelineId": "guideline-id-123",
    "elements": [
      {
        "elementId": "element-id",
        "elementName": "Element Name"
      }
    ],
    "tests": Array<Test>,
    "scenarios": Array<Scenario>,
    "interactions": Array<Interaction>,
    "results": Array<Result>,
    "summary": {
      "totalElements": 10,
      "totalTests": 3,
      "totalScenarios": 45,
      "totalInteractions": 45,
      "totalResults": 45
    },
    "generatedAt": "2025-01-15T10:30:00.000Z"
  }
}
```

### POST /auditReport

Generates ISO 13485-compliant audit report.

**Request Body:**
```json
{
  "guidelineId": "string (optional if testId provided)",
  "testId": "string (optional if guidelineId provided)",
  "format": "json|pdf|html"
}
```

**Response:**
```json
{
  "success": true,
  "report": {
    "reportId": "AUDIT-1234567890-ABC",
    "reportDate": "2025-01-15T10:30:00.000Z",
    "isoCompliance": {
      "standard": "ISO 13485:2016",
      "section": "7.3 Design and Development - Verification and Validation",
      "purpose": "Clinical Guidance System Verification and Validation Report"
    },
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
- `guidelineId` (optional): Filter by guideline ID

**Response:**
```json
{
  "success": true,
  "metrics": {
    "totalTests": 25,
    "totalScenarios": 150,
    "totalInteractions": 150,
    "totalResults": 150,
    "averageScore": 82.5,
    "totalTokens": 1250000,
    "totalCost": 12.50,
    "byGuideline": {},
    "byElement": {}
  }
}
```

## Error Handling

All endpoints return standard error responses:

```json
{
  "success": false,
  "error": "Human-readable error message",
  "details": "Technical error details (in development mode)"
}
```

**HTTP Status Codes:**
- `200`: Success
- `400`: Bad Request (missing/invalid parameters)
- `401`: Unauthorized (missing/invalid authentication)
- `404`: Not Found (resource doesn't exist)
- `500`: Internal Server Error

## Rate Limiting

Current rate limits:
- `/generateAuditScenarios`: 10 requests per minute
- `/evaluateGuidance`: 30 requests per minute
- `/auditTraceability`: 60 requests per minute
- `/auditReport`: 5 requests per minute
- `/auditMetrics`: 60 requests per minute

## Examples

See `docs/audit/EXAMPLES.md` for detailed usage examples.

