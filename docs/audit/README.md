# Enhanced Audit System Documentation

## Overview

The Enhanced Audit System provides comprehensive, ISO 13485-compliant evaluation of Clerky's clinical guidance provision. It systematically tests each auditable element within guidelines through subtle scenario variations and captures complete LLM interaction data for fine-tuning.

## Key Features

- **Systematic Evaluation**: Assesses how well Clerky provides contextual advice for each auditable element
- **Granular Testing**: Tests each piece of guidance individually with subtle scenario variations
- **Complete Traceability**: Captures all LLM prompts and responses for ISO 13485 compliance
- **Multi-Dimensional Assessment**: Evaluates guidance across accuracy, contextual appropriateness, completeness, and precision
- **ISO 13485 Compliance**: Meets medical device software QMS requirements

## Documentation Structure

### Technical Documentation

- **[Technical Specification](TECHNICAL_SPECIFICATION.md)**: Complete technical overview, architecture, and algorithms
- **[API Documentation](API_DOCUMENTATION.md)**: Detailed API endpoint specifications and examples
- **[Data Model](DATA_MODEL.md)**: Firestore collection structures and relationships

### Quality Documentation

- **[ISO 13485 Compliance](ISO_13485_COMPLIANCE.md)**: Compliance mapping and requirements
- **[Audit Procedures](AUDIT_PROCEDURES.md)**: Standard operating procedures for audit execution

## Quick Start

### 1. Generate Audit Scenarios

```javascript
POST /generateAuditScenarios
{
  "guidelineId": "guideline-id",
  "auditableElements": [...],
  "aiProvider": "DeepSeek"
}
```

### 2. Evaluate Guidance

```javascript
POST /evaluateGuidance
{
  "guidance": "Provided guidance text",
  "expectedGuidance": "Expected guidance",
  "element": {...},
  "scenario": {...}
}
```

### 3. Generate Report

```javascript
POST /auditReport
{
  "guidelineId": "guideline-id",
  "format": "json"
}
```

## Architecture Components

### Core Modules

1. **audit-logging.js**: Enhanced LLM interaction logging
2. **scenario-generator.js**: Systematic scenario variation generation
3. **variation-engine.js**: Core variation logic
4. **guidance-evaluator.js**: Multi-dimensional assessment
5. **automated-assessment.js**: AI-powered evaluation
6. **element-mapping.js**: Element-to-guideline mapping
7. **audit-storage.js**: Firestore data management
8. **traceability-matrix.js**: Traceability system
9. **audit-reporting.js**: ISO-compliant reporting
10. **audit-risk-management.js**: Risk assessment

### Server Endpoints

- `POST /generateAuditScenarios`: Generate systematic scenario variations
- `POST /evaluateGuidance`: Multi-dimensional guidance assessment
- `GET /auditTraceability`: Retrieve traceability matrix
- `POST /auditReport`: Generate ISO-compliant audit reports
- `GET /auditMetrics`: Performance metrics and statistics

## Enhanced Auditable Elements

Auditable elements now include:
- Element ID for traceability
- Input variables with detailed specifications
- Thresholds with comparison operators
- Variation points showing guidance changes
- Clinical context requirements
- Expected guidance text

## Scenario Variations

For each element, the system generates:
- Baseline scenario (standard case)
- Threshold variations (just above/below)
- Variable omissions (missing required inputs)
- Edge cases (boundary conditions)

## Evaluation Dimensions

1. **Accuracy** (40% weight): Guidance matches expected advice
2. **Contextual Appropriateness** (35% weight): Guidance accounts for patient factors
3. **Completeness** (25% weight): All required elements present
4. **Precision** (adjustment factor): Guidance reflects scenario variations

## ISO 13485 Compliance

The system addresses:
- Section 7.3: Design Controls - Verification and Validation
- Section 4.2: Documentation Requirements
- Section 8.2: Monitoring and Measurement
- Section 8.5: Improvement

See [ISO 13485 Compliance](ISO_13485_COMPLIANCE.md) for detailed mapping.

## Data Flow

```
Guideline → Auditable Elements → Test Scenarios → LLM Interactions → Evaluation Results → Audit Reports
```

Each step is fully traceable through Firestore collections.

## Performance Targets

- Scenario generation: <5 seconds per element
- Guidance evaluation: <10 seconds per scenario
- Report generation: <30 seconds for full audit
- Data retrieval: <2 seconds for traceability queries

## Getting Started

1. Review [Technical Specification](TECHNICAL_SPECIFICATION.md) for architecture
2. Read [Audit Procedures](AUDIT_PROCEDURES.md) for execution steps
3. Check [API Documentation](API_DOCUMENTATION.md) for endpoint usage
4. Review [Data Model](DATA_MODEL.md) for storage structure
5. Understand [ISO 13485 Compliance](ISO_13485_COMPLIANCE.md) requirements

## Support

For questions or issues:
- Review documentation in this directory
- Check server logs for error details
- Review Firestore collections for data integrity

## Version

- Version: 1.0
- Last Updated: 2025-01-15
- Status: Implementation Complete

