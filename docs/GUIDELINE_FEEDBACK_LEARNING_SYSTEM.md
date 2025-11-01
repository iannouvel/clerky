# Guideline Feedback Learning System

## Overview

The Guideline Feedback Learning System enables Clerky to learn from clinician feedback when guideline suggestions are rejected or modified. This creates a continuous improvement loop where the system becomes more accurate over time by incorporating real-world clinical wisdom.

## How It Works

### User Experience Flow

1. **User Reviews Suggestion**: A clinician reviews a suggestion from a guideline (e.g., "Assisted Vaginal Birth" guideline suggesting cord blood gases)

2. **User Rejects Suggestion**: When clicking the "❌ Reject" button, a modal appears asking:
   > "Help Us Learn: Why is this suggestion not appropriate? (optional)"

3. **Optional Feedback**: The user can either:
   - Enter a reason (e.g., "This was SVD, not AVD - cord gases not required for spontaneous delivery")
   - Skip by clicking "Skip" button

4. **Automatic Submission**: Once all suggestions from a guideline are processed, feedback is automatically submitted to the backend in the background

5. **Thank You Notification**: A subtle notification appears: "✅ Thank you for your feedback - helping improve future suggestions!"

6. **AI Summarisation**: After accumulating feedback (every 5 entries), the system automatically:
   - Analyses all feedback for that guideline
   - Identifies common patterns and themes
   - Generates a concise summary of learned insights

7. **Future Improvements**: When generating suggestions from that guideline in the future:
   - The AI receives the feedback summary
   - Considers previous clinician wisdom
   - Makes more appropriate suggestions

### Example Scenario

**Before Feedback:**
- AVD guideline suggests cord blood gases for all deliveries
- Frequently rejected for SVD cases

**After Feedback (5+ rejections with reasons):**
- System learns: "Clinicians frequently reject cord blood gas suggestions for SVD cases, noting they are only required for assisted vaginal births"
- Future suggestions: AVD guideline recommendations only appear for actual AVD cases

## Technical Architecture

### Database Schema

#### Firestore `guidelines` Collection
Each guideline document now includes:

```javascript
{
  // ... existing fields ...
  
  // Feedback fields
  feedbackEntries: [
    {
      userId: "user123",
      timestamp: Timestamp,
      sessionId: "advice_session_id",
      suggestionId: "1",
      action: "reject", // or "modify"
      rejectionReason: "This was SVD, not AVD",
      clinicalScenario: "Transcript excerpt...",
      modifiedText: "User's modification if applicable",
      originalSuggestion: "Original text...",
      suggestedText: "Suggested text..."
    }
  ],
  feedbackSummary: "AI-generated summary of patterns...",
  feedbackLastSummarised: Timestamp,
  feedbackSummarisedCount: 5,
  feedbackCount: 12,
  lastFeedbackReceived: Timestamp
}
```

### API Endpoints

#### POST `/submitGuidelineFeedback`
Receives and stores feedback for a guideline.

**Request:**
```javascript
{
  guidelineId: "bjog-2020-murphy-assisted-vaginal-birth-pdf",
  sessionId: "advice_1234567890_abc123",
  feedbackEntries: [
    {
      suggestionId: "1",
      action: "reject",
      rejectionReason: "This was SVD, not AVD",
      originalSuggestion: "...",
      suggestedText: "...",
      clinicalScenario: "..."
    }
  ],
  transcript: "Full clinical note..."
}
```

**Response:**
```javascript
{
  success: true,
  feedbackCount: 3,
  totalFeedback: 8
}
```

#### POST `/summariseGuidelineFeedback`
Manually triggers AI summarisation for a guideline (admin/testing).

**Request:**
```javascript
{
  guidelineId: "bjog-2020-murphy-assisted-vaginal-birth-pdf"
}
```

**Response:**
```javascript
{
  success: true,
  result: {
    guidelineId: "...",
    feedbackCount: 5,
    summaryLength: 287
  }
}
```

### Frontend Functions

#### `promptForRejectionFeedback(suggestionId, suggestion)`
Displays modal asking for optional feedback when user rejects a suggestion.

#### `submitRejectionFeedback(suggestionId, includeFeedback)`
Submits the feedback decision (with or without reason text).

#### `checkAndSubmitGuidelineFeedback()`
Checks if all suggestions from a guideline have been processed and submits feedback batch.

#### `submitGuidelineFeedbackBatch(guidelineId, guidelineTitle, feedbackEntries)`
Sends feedback batch to backend asynchronously (fire and forget).

#### `showFeedbackThankYou()`
Displays subtle thank you notification to user.

### Backend Functions

#### `summariseGuidelineFeedback(guidelineId)`
Background async function that:
1. Fetches all feedback entries for guideline
2. Filters to meaningful feedback (>10 characters)
3. Sends to AI for pattern analysis
4. Stores summary in guideline document

**AI Prompt:**
```
Analyse clinician feedback and identify:
1. Recurring themes or patterns in rejections
2. Specific clinical scenarios where guideline may not apply
3. Timing, context, or applicability concerns
4. Actionable insights for future suggestion generation
```

## AI Prompt Integration

### System Prompt Addition

Added section to both `/dynamicAdvice` and `/multiGuidelineDynamicAdvice`:

```
LEARNED CLINICAL PATTERNS:
When available, you will be provided with aggregated feedback from 
experienced clinicians about this guideline's application. This feedback 
represents real-world clinical wisdom about when certain recommendations 
may not be appropriate. Consider these patterns alongside the guideline 
text when making suggestions.
```

### User Prompt Addition

When feedback summary exists and is recent (<30 days):

```
CLINICAL FEEDBACK FROM PREVIOUS USERS:
The following patterns have been identified from clinician feedback on this guideline:

[AI-generated summary]

Please consider this feedback when determining if suggestions are appropriate 
for this specific case.
```

## Configuration

### Feedback Summarisation Triggers

Currently configured to trigger AI summarisation when:
- Total feedback count reaches 5 or more
- AND is a multiple of 5 (5, 10, 15, 20...)

This can be adjusted in `server.js`:
```javascript
const shouldSummarise = newTotalCount >= 5 && 
                        (newTotalCount % 5 === 0 || newTotalCount === 5);
```

### Feedback Summary Freshness

Feedback summaries are only used if they are less than 30 days old. This ensures the system uses recent clinical wisdom.

Configured in both `/dynamicAdvice` and `/multiGuidelineDynamicAdvice` endpoints:
```javascript
const daysSinceSummary = (Date.now() - summaryDate.getTime()) / (1000 * 60 * 60 * 24);
if (daysSinceSummary <= 30) {
    // Use feedback summary
}
```

## Privacy and Security

- **User Attribution**: Feedback includes userId but is aggregated in summaries
- **No PII**: Clinical scenarios are truncated to 500 characters
- **Anonymous Summaries**: AI-generated summaries focus on patterns, not individual users
- **Secure Storage**: All feedback stored in Firestore with proper authentication
- **Backend-Only**: Feedback submission requires authentication and uses server-side admin SDK

## Testing

### Manual Testing Steps

1. **Test Feedback Capture**:
   - Generate suggestions from a guideline
   - Click "Reject" on a suggestion
   - Verify modal appears
   - Enter feedback reason
   - Click "Submit Feedback"
   - Verify modal closes and rejection is recorded

2. **Test Skip Functionality**:
   - Reject a suggestion
   - Click "Skip" in modal
   - Verify rejection is recorded without feedback

3. **Test Feedback Submission**:
   - Complete all suggestions from a guideline (with at least one rejection with feedback)
   - Verify thank you notification appears
   - Check browser console for successful submission log

4. **Test AI Summarisation**:
   - Submit 5 feedback entries for a guideline
   - Use backend logs to confirm summarisation triggered
   - Check Firestore to verify `feedbackSummary` field updated

5. **Test Future Suggestions**:
   - Generate suggestions from guideline with feedback
   - Verify console shows "Using feedback summary"
   - Observe if suggestions are more appropriate

### API Testing

```bash
# Test manual summarisation (requires authentication)
curl -X POST https://your-server/summariseGuidelineFeedback \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"guidelineId": "your-guideline-id"}'
```

## Future Enhancements

1. **User-Specific Learning**: Allow individual clinicians to build personalised feedback profiles
2. **Feedback Analytics Dashboard**: Show admins which guidelines need review based on rejection rates
3. **Explicit Pattern Detection**: Automatically extract structured patterns (e.g., "Don't suggest X for Y scenario")
4. **Feedback Voting**: Allow multiple clinicians to upvote existing feedback
5. **Guideline Author Feedback**: Send aggregate feedback to guideline authors for consideration

## Monitoring

### Key Metrics to Track

- Feedback submission rate (% of rejections with feedback)
- Feedback summaries generated per day/week
- Guidelines with most feedback
- Suggestion rejection rates before/after feedback implementation
- User engagement with feedback prompts

### Firestore Queries

```javascript
// Find guidelines with most feedback
db.collection('guidelines')
  .orderBy('feedbackCount', 'desc')
  .limit(10)
  .get()

// Find recent feedback summaries
db.collection('guidelines')
  .where('feedbackLastSummarised', '>', thirtyDaysAgo)
  .get()

// Find guidelines needing summarisation
db.collection('guidelines')
  .where('feedbackCount', '>=', 5)
  .where('feedbackSummarisedCount', '<', 'feedbackCount')
  .get()
```

## Troubleshooting

### Feedback Not Submitting

1. Check browser console for errors
2. Verify user is authenticated
3. Confirm guideline ID is valid
4. Check network tab for API call

### Summarisation Not Triggering

1. Verify feedback count threshold met (5 entries)
2. Check backend logs for summarisation trigger
3. Confirm AI API is accessible
4. Check for errors in `summariseGuidelineFeedback` function

### Feedback Not Appearing in Future Suggestions

1. Verify `feedbackSummary` field exists in Firestore
2. Check `feedbackLastSummarised` timestamp is recent (<30 days)
3. Confirm console log shows "Using feedback summary"
4. Review AI prompt to ensure feedback is included

## Support

For issues or questions about the Guideline Feedback Learning System:
- Check backend logs for detailed error messages
- Review browser console for frontend issues
- Examine Firestore documents for data verification
- Contact development team with specific guideline IDs and session IDs



