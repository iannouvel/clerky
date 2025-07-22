# Accuracy Testing Agent - Quick Start

## Overview

This automated accuracy testing agent validates your clinical guidelines system by:
- 🎯 Randomly selecting guidelines and extracting safety elements
- 🔧 Modifying transcripts to introduce compliance issues
- 🧪 Testing if the system correctly identifies these issues
- 📊 Generating comprehensive accuracy reports

## Quick Start

### 1. Prerequisites

```bash
# Install Python dependencies
pip install aiohttp asyncio

# Make scripts executable
chmod +x scripts/run_accuracy_tests.sh
```

### 2. Basic Usage

```bash
# Quick test (5 tests)
./scripts/run_accuracy_tests.sh --quick

# Full test (50 tests)  
./scripts/run_accuracy_tests.sh --full

# Custom test
./scripts/run_accuracy_tests.sh --num-tests 20 --log-level DEBUG
```

### 3. View Results

Results are saved to `test_results/` directory:
- `accuracy_report_*.json` - Detailed accuracy reports
- `test_run_*.log` - Execution logs

### 4. Example Output

```
=========================================
ACCURACY TESTING REPORT - 2025-01-15 10:30:00
=========================================
Total Tests: 25
Overall Accuracy: 84.0%

Accuracy by Severity:
  HIGH: 92.0%
  MEDIUM: 81.0%
  LOW: 75.0%

Accuracy by Modification Type:
  Omission: 88.0%
  Non Compliance: 79.0%
  Incorrect Advice: 83.0%

Recommendations:
  1. System performance is satisfactory. Continue regular accuracy monitoring.
=========================================
```

## Test Types

The agent creates three types of test modifications:

### 1. Omissions
- **What**: Removes required safety actions from transcripts
- **Tests**: Whether system detects missing critical steps
- **Example**: Omitting required blood pressure monitoring in preeclampsia

### 2. Non-compliance  
- **What**: Includes advice that contradicts guidelines
- **Tests**: Whether system flags guideline violations
- **Example**: Recommending delayed delivery when immediate action required

### 3. Incorrect Advice
- **What**: Provides clinically inappropriate recommendations
- **Tests**: Whether system corrects wrong advice
- **Example**: Wrong medication dosing or incorrect investigation sequence

## Continuous Testing

Run ongoing accuracy monitoring:

```bash
# Test every hour (10 tests each time)
./scripts/run_accuracy_tests.sh --continuous

# Custom interval testing
./scripts/run_accuracy_tests.sh --continuous --num-tests 20
```

## Configuration Options

| Option | Description | Default |
|--------|-------------|---------|
| `--server-url` | Server URL to test | `http://localhost:3000` |
| `--auth-token` | Authentication token | None |
| `--num-tests` | Number of tests to run | 10 |
| `--log-level` | Logging level | INFO |
| `--results-dir` | Results directory | `test_results` |
| `--quick` | Run 5 quick tests | - |
| `--full` | Run 50 comprehensive tests | - |
| `--continuous` | Run tests every hour | - |

## Accuracy Thresholds

- **>90%**: Excellent - System performing very well
- **85-90%**: Good - System performing adequately  
- **70-85%**: Acceptable - Monitor for improvements
- **<70%**: Poor - Immediate attention required

## Troubleshooting

### Common Issues

1. **Server Connection Failed**
   ```bash
   # Check server is running
   curl http://localhost:3000
   
   # Test with correct URL
   ./scripts/run_accuracy_tests.sh --server-url https://your-server.com
   ```

2. **Authentication Errors**
   ```bash
   # Use authentication token
   ./scripts/run_accuracy_tests.sh --auth-token your_token_here
   ```

3. **No Test Results**
   ```bash
   # Enable debug mode
   ./scripts/run_accuracy_tests.sh --log-level DEBUG
   ```

4. **Python Dependencies Missing**
   ```bash
   pip install aiohttp asyncio
   ```

### Debug Mode

For detailed debugging information:

```bash
./scripts/run_accuracy_tests.sh --log-level DEBUG --num-tests 1
```

This shows:
- AI prompts and responses
- Safety element extraction details
- Transcript modification process
- Evaluation logic step-by-step

## Advanced Usage

### Direct Python Usage

```bash
python3 scripts/accuracy_testing_agent.py \
    --server-url http://localhost:3000 \
    --num-tests 25 \
    --log-level INFO \
    --results-dir ./my_results
```

### Custom Testing Scenarios

To test specific guidelines or conditions, modify the agent's selection logic in `accuracy_testing_agent.py`.

### Integration with CI/CD

Add to your deployment pipeline:

```yaml
# GitHub Actions example
- name: Test Guidelines Accuracy
  run: ./scripts/run_accuracy_tests.sh --quick
  
- name: Upload Results
  uses: actions/upload-artifact@v2
  with:
    name: accuracy-results
    path: test_results/
```

## What Gets Tested

### Safety Elements Extracted
- **Assessments**: Required clinical examinations
- **Investigations**: Mandatory tests and scans
- **Treatments**: Required medications and procedures  
- **Monitoring**: Essential ongoing surveillance
- **Referrals**: Required specialist consultations

### Example Safety Element
```
Condition: "Patient with severe preeclampsia at >34 weeks"
Action: "Administer magnesium sulfate for seizure prophylaxis"
Severity: "high"
Type: "treatment"
```

### Test Modification Example
**Original**: "Plan for cesarean section within 6 hours given severity of condition."

**Modified (Omission)**: "Plan for cesarean section when convenient."

**Expected Detection**: System should flag missing urgency and recommend immediate delivery.

## Performance Tips

1. **Start Small**: Begin with `--quick` to verify setup
2. **Regular Testing**: Run daily quick tests, weekly full tests
3. **Monitor Trends**: Track accuracy changes over time
4. **Focus on High Severity**: Ensure >90% accuracy for critical safety elements
5. **Debug Failures**: Use debug mode to understand failed tests

## Next Steps

1. **Run Your First Test**: `./scripts/run_accuracy_tests.sh --quick`
2. **Review Results**: Check the generated report in `test_results/`
3. **Set Up Regular Testing**: Consider continuous or scheduled testing
4. **Monitor Performance**: Track accuracy trends over time
5. **Improve System**: Use failed test insights to enhance your guidelines system

## Support

For detailed documentation, see: `docs/testing/ACCURACY_TESTING_AGENT.md`

For issues or questions:
1. Check the debug logs
2. Review the comprehensive documentation
3. Examine failed test details in the reports 