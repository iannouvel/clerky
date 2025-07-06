# Clinical Clerkings System

## Overview
The test functionality has been upgraded to use pre-generated clinical clerkings instead of slow API calls. This provides instant loading of realistic clinical documentation for testing purposes.

## Files
- `fake_transcripts.json` - Contains 101 pre-generated clinical clerkings using SBAR format
- `clinical_issues.json` - Contains the list of clinical issues (51 obstetrics + 50 gynecology)

## Structure
```json
{
  "obstetrics": {
    "Preeclampsia": "SITUATION: 39-year-old G2P1 at 34+2 weeks with severe preeclampsia\n\nBACKGROUND: Normotensive throughout pregnancy until 32 weeks...",
    "Gestational diabetes": "SITUATION: 36-year-old G3P1 at 28+0 weeks with newly diagnosed gestational diabetes mellitus...",
    ...
  },
  "gynecology": {
    "PCOS": "SITUATION: 28-year-old nulliparous woman with PCOS presenting with irregular menstrual cycles...",
    "Endometriosis": "SITUATION: 41-year-old G1P0 with severe dysmenorrhea and suspected endometriosis...",
    ...
  }
}
```

## SBAR Format
Each clerking follows the professional SBAR structure:

- **SITUATION**: Patient demographics, condition, and presentation
- **BACKGROUND**: Medical history, current status, and relevant details  
- **ASSESSMENT**: Clinical findings, observations, and test results
- **RECOMMENDATION**: Treatment plan, monitoring, and follow-up

### Example (Preeclampsia):
```
SITUATION: 39-year-old G2P1 at 34+2 weeks with severe preeclampsia

BACKGROUND: Normotensive throughout pregnancy until 32 weeks. Presented to triage with severe headache, visual disturbances, and epigastric pain. No previous history of hypertension. Family history of preeclampsia (mother).

ASSESSMENT: BP 165/110 mmHg, significant proteinuria (3+ on dipstick), hyperreflexia present. Bloods show: Hb 12.1, platelets 145, ALT 68, creatinine 89. CTG reactive with baseline 145 bpm.

RECOMMENDATION: Admit to delivery suite. Antihypertensive therapy commenced (labetalol 200mg BD). Magnesium sulfate for seizure prophylaxis. Steroids for fetal lung maturity. Urgent consultant review for delivery planning.
```

## Features
- ⚡ **Instant loading** - No API calls required
- 🏥 **SBAR format** - Professional clinical documentation structure
- 🩺 **Medical terminology** - Realistic jargon and abbreviations
- 📊 **Varied presentations** - Acute, chronic, and follow-up scenarios
- 🎯 **Concise format** - Clinical-style documentation (~88-200 words)

## Usage
1. Click the "Test" button in the menu
2. Select a clinical issue from the dropdown
3. Click "Load Clerking" 
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