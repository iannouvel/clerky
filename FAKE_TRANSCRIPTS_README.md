# Fake Transcripts System

## Overview
The test functionality has been upgraded to use pre-generated fake transcripts instead of slow API calls. This provides instant loading of clinical interaction scenarios for testing purposes.

## Files
- `fake_transcripts.json` - Contains 101 pre-generated 200-word clinical transcripts
- `clinical_issues.json` - Contains the list of clinical issues (51 obstetrics + 50 gynecology)

## Structure
```json
{
  "obstetrics": {
    "Preeclampsia": "Patient: Good morning, doctor...",
    "Gestational diabetes": "Patient: Good morning, doctor...",
    ...
  },
  "gynecology": {
    "Polycystic ovary syndrome (PCOS)": "Doctor: I've reviewed your test results...",
    "Endometriosis": "Doctor: I've reviewed your test results...",
    ...
  }
}
```

## Features
- ⚡ **Instant loading** - No API calls required
- 📊 **200-word transcripts** - Consistent length for testing
- 🎭 **Varied dialogue styles** - Different conversation templates
- 🏥 **Realistic scenarios** - Clinical interactions between doctors and patients

## Usage
1. Click the "Test" button in the menu
2. Select a clinical issue from the dropdown
3. Click "Load Interaction" 
4. The transcript is instantly loaded into the input field

## Performance Benefits
- **Before**: 3-10 seconds API call + token costs
- **After**: <100ms local file loading + no API costs

## Regenerating Transcripts
If you need to regenerate the transcripts (e.g., to change the template or add new issues):

```javascript
// Create generate_fake_transcripts.js with the generator script
node generate_fake_transcripts.js
```

The generator creates varied dialogue using three different templates:
1. Initial consultation
2. Follow-up appointment  
3. Test results discussion

Each transcript is automatically trimmed to approximately 200 words for consistency.

## Integration
The system integrates with the existing test workflow:
1. Load transcript using the fast system
2. Use "Find Relevant Guidelines" to analyze
3. Use "Process" to run the complete workflow
4. Edit transcript if needed before analysis

This maintains full compatibility with the existing analysis pipeline while dramatically improving test setup speed. 