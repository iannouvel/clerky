# Automated Accuracy Testing Agent

## Overview

The Automated Accuracy Testing Agent is a comprehensive system designed to test the accuracy of the clinical guidelines recommendation system. It validates that the system correctly identifies safety compliance issues by introducing controlled modifications to clinical transcripts and evaluating the system's responses.

## How It Works

The testing agent follows your proposed approach:

1. **Random Guideline Selection**: Chooses a clinical guideline at random from the available guidelines database
2. **Safety Element Extraction**: Uses AI to identify key safety-critical elements from the guideline that follow "if-then" logic
3. **Transcript Modification**: Intelligently modifies clinical transcripts to introduce compliance issues:
   - **Omissions**: Remove required safety actions
   - **Non-compliance**: Include advice that contradicts guidelines
   - **Incorrect advice**: Provide clinically inappropriate recommendations
4. **System Testing**: Sends modified transcripts to the recommendation system
5. **Accuracy Evaluation**: Assesses whether the system correctly identifies and addresses the compliance issues
6. **Reporting**: Generates comprehensive reports with accuracy metrics and actionable recommendations

## Architecture

### Core Components

#### 1. GuidelineSafetyExtractor
- **Purpose**: Extracts key safety elements from clinical guidelines
- **Method**: Uses AI analysis to identify mandatory safety requirements
- **Output**: Structured safety elements with conditions, actions, and severity levels

#### 2. TranscriptModifier
- **Purpose**: Creates test modifications to introduce compliance issues
- **Types**: 
  - **Omission**: Removes required safety actions
  - **Non-compliance**: Adds contradictory advice
  - **Incorrect advice**: Provides inappropriate recommendations
- **Method**: AI-guided modifications that maintain clinical realism

#### 3. AccuracyTestRunner
- **Purpose**: Orchestrates the entire testing process
- **Functions**:
  - Coordinates random testing workflows
  - Manages system interactions
  - Evaluates test results
  - Tracks accuracy metrics

#### 4. AccuracyReporter
- **Purpose**: Generates comprehensive reports and recommendations
- **Outputs**:
  - Overall accuracy metrics
  - Performance by severity level
  - Performance by modification type
  - Failed test analysis
  - Actionable recommendations

## Safety Element Structure

Safety elements are extracted as structured data:

```python
@dataclass
class SafetyElement:
    id: str              # Unique identifier
    guideline_id: str    # Source guideline ID
    condition: str       # "If" condition that triggers the rule
    action: str          # "Then" required action
    severity: str        # high, medium, low
    element_type: str    # assessment, investigation, treatment, monitoring, referral
    source_text: str     # Original text from guideline
    confidence: float    # AI extraction confidence (0-1)
```

## Test Result Evaluation

The system evaluates test results by:

1. **Keyword Matching**: Analyses suggestions for safety element keywords
2. **Category Mapping**: Checks if suggestion categories match expected responses
3. **Priority Assessment**: Considers suggestion priority levels
4. **Accuracy Scoring**: Calculates confidence-weighted accuracy scores

## Usage

### Basic Usage

```bash
# Quick test (5 tests)
./scripts/run_accuracy_tests.sh --quick

# Full test (50 tests)
./scripts/run_accuracy_tests.sh --full

# Custom number of tests
./scripts/run_accuracy_tests.sh --num-tests 25
```

### Advanced Options

```bash
# Test against remote server
./scripts/run_accuracy_tests.sh --server-url https://api.clerky.com

# With authentication
./scripts/run_accuracy_tests.sh --auth-token your_token_here

# Debug mode
./scripts/run_accuracy_tests.sh --log-level DEBUG

# Custom results directory
./scripts/run_accuracy_tests.sh --results-dir ./my_test_results
```

### Continuous Testing

```bash
# Run 10 tests every hour
./scripts/run_accuracy_tests.sh --continuous

# Run 20 tests every hour
./scripts/run_accuracy_tests.sh --continuous --num-tests 20
```

### Direct Python Usage

```bash
# Basic usage
python3 scripts/accuracy_testing_agent.py \
    --server-url http://localhost:3000 \
    --num-tests 10

# With authentication
python3 scripts/accuracy_testing_agent.py \
    --server-url https://api.clerky.com \
    --auth-token your_token \
    --num-tests 25 \
    --log-level DEBUG
```

## Report Structure

### Accuracy Report

```json
{
  "report_id": "report_1234567890",
  "timestamp": "2025-01-15T10:30:00",
  "total_tests": 25,
  "overall_accuracy": 0.84,
  "accuracy_by_severity": {
    "high": 0.92,
    "medium": 0.81,
    "low": 0.75
  },
  "accuracy_by_modification_type": {
    "omission": 0.88,
    "non_compliance": 0.79,
    "incorrect_advice": 0.83
  },
  "accuracy_by_guideline": {
    "guideline_1": 0.90,
    "guideline_2": 0.75
  },
  "failed_tests": [...],
  "recommendations": [
    "System struggles with detecting omitted safety elements...",
    "Consider improving missing element detection algorithms."
  ]
}
```

### Key Metrics

- **Overall Accuracy**: Percentage of tests where issues were correctly identified
- **Severity-based Accuracy**: Performance for high/medium/low severity safety elements
- **Modification Type Accuracy**: Performance for different types of compliance issues
- **Guideline-specific Accuracy**: Performance for individual guidelines

## Interpretation Guidelines

### Accuracy Thresholds

- **>90%**: Excellent performance
- **85-90%**: Good performance
- **70-85%**: Acceptable performance, monitor for improvements
- **<70%**: Poor performance, immediate attention required

### Critical Performance Areas

1. **High Severity Elements**: Should achieve >90% accuracy
2. **Omission Detection**: Critical for patient safety
3. **Guideline Consistency**: Similar performance across different guidelines

## Troubleshooting

### Common Issues

1. **No Safety Elements Extracted**
   - Check guideline content availability
   - Verify AI service connectivity
   - Review extraction prompts

2. **Low Accuracy Scores**
   - Examine failed test details
   - Check keyword matching algorithms
   - Review suggestion evaluation logic

3. **Server Connection Errors**
   - Verify server URL and accessibility
   - Check authentication tokens
   - Review network connectivity

### Debug Mode

Enable debug logging for detailed information:

```bash
./scripts/run_accuracy_tests.sh --log-level DEBUG
```

This provides:
- AI prompt details
- Response parsing information
- Evaluation step-by-step analysis
- Detailed error messages

## Integration with CI/CD

### Automated Testing

Add to your CI/CD pipeline:

```yaml
# Example GitHub Actions workflow
- name: Run Accuracy Tests
  run: |
    ./scripts/run_accuracy_tests.sh --quick --log-level INFO
  env:
    SERVER_URL: ${{ secrets.SERVER_URL }}
    AUTH_TOKEN: ${{ secrets.AUTH_TOKEN }}

- name: Upload Test Results
  uses: actions/upload-artifact@v2
  with:
    name: accuracy-test-results
    path: test_results/
```

### Quality Gates

Set accuracy thresholds:

```bash
# Fail CI if accuracy drops below 80%
python3 scripts/check_accuracy_threshold.py \
    --results-dir test_results \
    --threshold 0.80
```

## Best Practices

### Regular Testing

1. **Daily Quick Tests**: Run 5-10 tests daily for basic monitoring
2. **Weekly Full Tests**: Run 50+ tests weekly for comprehensive evaluation
3. **Release Testing**: Run extensive tests before major releases

### Monitoring Trends

1. Track accuracy trends over time
2. Monitor performance degradation
3. Identify problematic guidelines or safety elements

### Continuous Improvement

1. Use failed test analysis to improve algorithms
2. Expand safety element extraction rules
3. Enhance transcript modification techniques

## Security Considerations

1. **Data Privacy**: Test data should be anonymised
2. **Authentication**: Use secure tokens for API access
3. **Result Storage**: Encrypt sensitive test results

## Future Enhancements

### Planned Features

1. **Machine Learning Integration**: Learn from test patterns
2. **Adaptive Testing**: Focus on previously failed areas
3. **Real-world Validation**: Compare with actual clinical outcomes
4. **Multi-language Support**: Test guidelines in different languages

### Extensibility

The agent is designed to be extensible:

1. **Custom Safety Extractors**: Add domain-specific extraction logic
2. **Alternative Evaluation Methods**: Implement different accuracy assessment approaches
3. **Additional Report Formats**: Generate reports in various formats (PDF, HTML, etc.)

## Contributing

To contribute to the accuracy testing agent:

1. **Add New Test Types**: Implement additional modification strategies
2. **Improve Evaluation**: Enhance accuracy assessment algorithms
3. **Extend Reporting**: Add new metrics and visualisations
4. **Optimise Performance**: Improve testing speed and resource usage

## Support

For support with the accuracy testing agent:

1. **Documentation**: Refer to this guide and inline code comments
2. **Logs**: Review debug logs for detailed error information
3. **Issues**: Report issues with detailed reproduction steps
4. **Discussions**: Join technical discussions about testing strategies

---

The Automated Accuracy Testing Agent provides a robust framework for validating clinical guidelines system accuracy. Regular use ensures that the system maintains high standards of safety and compliance detection, ultimately improving patient care quality. 