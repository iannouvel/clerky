# script.js Modularization Implementation Plan

## Overview
This plan outlines the systematic refactoring of `script.js` into smaller, maintainable ES modules. The goal is to improve code organization, testability, and developer experience without changing functionality.

## Progress Tracking
- **Original**: ~16,868 lines, ~712KB
- **Current**: ~16,166 lines, ~666KB  
- **Lines removed**: ~700
- **Modules created**: 11 new modules (including clinicalData, guidelines, external, layout, logging)

## Current State
- **File size**: ~16,600 lines, ~700KB
- **Functions**: 350+ functions
- **Existing modules**: Some extraction already done (`js/features/pii.js`, `js/features/suggestionWizard.js`, `js/utils/text.js`, etc.)

## Quick Wins Completed ✅
1. ✅ Removed `OLD_displayCombinedInteractiveSuggestions_UNUSED` dead code (~160 lines)
2. ✅ Exported `getIdToken` from `js/api/client.js` for reuse
3. ✅ Created shared `js/utils/relevance.js` utility (extracted 3 duplicate `extractRelevanceScore` implementations)
4. ✅ Removed commented-out debug logging blocks

---

## Phase 1: Low-Risk Utility Extractions
**Goal**: Extract pure utility functions that have no side effects

### 1.1 Create `js/utils/dom.js`
Extract DOM manipulation helpers:
- `updateClearFormattingButton()`
- `setButtonLoading(button, isLoading, originalText)`
- `showError(message)`

### 1.2 Create `js/utils/logging.js`
Extract the `Logger` object and logging utilities:
- The `Logger` object (lines 9540-9571)
- Standardize console logging patterns

### 1.3 Create `js/utils/formatting.js`
Extract text/content formatting:
- `stripSummaryEmojis(text)` 
- `abbreviateOrganization(org)`
- `getCleanDisplayTitle(g, guidelineData)`

---

## Phase 2: State Management Consolidation
**Goal**: Consolidate scattered global variables into organized state objects

### 2.1 Create `js/state/appState.js`
Consolidate core application state:
```javascript
export const AppState = {
    isInitialized: false,
    clinicalIssuesLoaded: false,
    guidanceDataLoaded: false,
    isMobile: false,
    mobileView: 'userInput'
};
```

### 2.2 Create `js/state/suggestionState.js`
Consolidate suggestion-related state:
```javascript
export const SuggestionState = {
    currentAdviceSession: null,
    currentSuggestions: [],
    userDecisions: {},
    reviewState: null,
    reset() { /* ... */ }
};
```

### 2.3 Create `js/state/guidelineState.js`
Consolidate guideline-related state:
```javascript
export const GuidelineState = {
    relevantGuidelines: null,
    globalGuidelines: {},
    cache: null
};
```

---

## Phase 3: Feature Module Extractions
**Goal**: Extract cohesive feature areas into dedicated modules

### 3.1 Create `js/features/mobile.js`
~250 lines - Mobile detection and layout management:
- `detectMobile()`
- `applyMobileLayout()`
- `switchMobileView(view)`
- `initializeMobileDetection()`
- `openMobileSettingsOverlay()`
- `closeMobileSettingsOverlay()`
- `initializeMobileSettingsOverlay()`

### 3.2 Create `js/features/connectivity.js`
~30 lines - Network connectivity monitoring:
- `initializeConnectivityConnection()`

### 3.3 Create `js/features/disclaimer.js`
~50 lines - Disclaimer acceptance management:
- `checkDisclaimerAcceptance()`

### 3.4 Create `js/features/version.js`
~15 lines - Version display:
- `loadVersionNumber()`

### 3.5 Expand `js/features/guidelines.js`
~1500 lines - All guideline-related functionality:
- `loadGuidelinesFromFirestore()`
- `setupGuidelinesListener()`
- `syncGuidelinesInBackground()`
- `processGuidelineContent(guidelineId)`
- `createGuidelineSelectionInterface()`
- `displayRelevantGuidelines()`
- `updateProcessButtonText()`
- Caching functions (`getCachedGuidelines`, `setCachedGuidelines`, etc.)
- `findMissingGuidelines()`
- `compareDuplicates()`

### 3.6 Create `js/features/analysis.js`
~800 lines - Analysis orchestration:
- `checkAgainstGuidelines()`
- `runParallelAnalysis()`
- `performComplianceScoring()`
- `displayComplianceScoring()`

### 3.7 Expand `js/features/suggestions.js`
~1000 lines - Suggestion display and interaction:
- `dynamicAdvice()`
- `displayInteractiveSuggestions()`
- `displayPracticePointSuggestions()`
- `getPracticePointSuggestions()`
- `determineInsertionPoint()`
- `insertTextAtPoint()`
- Decision handling functions

### 3.8 Create `js/features/preferences.js`
~600 lines - User preferences management:
- `showPreferencesModal()`
- Model preference functions
- RAG preference functions
- Chunk distribution functions
- Hospital trust functions (`showHospitalTrustModal`, `saveHospitalTrustSelection`, etc.)

### 3.9 Create `js/features/chat.js`
~400 lines - Chat functionality:
- `switchChat()`
- `deleteChat()`
- `startNewChat()`
- Chat history management

---

## Phase 4: UI Component Extractions
**Goal**: Extract UI rendering and interaction logic

### 4.1 Create `js/ui/streaming.js`
~350 lines - The streaming engine:
- The entire `StreamingEngine` object (lines 3902-4229)
- Related streaming utilities

### 4.2 Create `js/ui/summary.js`
~250 lines - Summary panel management:
- `appendToSummary1()`
- `appendDecisionUIToSummary()`
- `initializeSummaryAutoHeight()`

### 4.3 Create `js/ui/buttons.js`
~100 lines - Button state management:
- `updateAnalyseAndResetButtons()`
- `handleGlobalReset()`
- `showSelectionButtons()`
- `hideSelectionButtons()`

---

## Phase 5: Service Module Extractions
**Goal**: Extract API and service-related code

### 5.1 Expand `js/services/auth.js`
~100 lines - Authentication services:
- Re-export `getIdToken` for backwards compatibility
- Add auth-related helpers

### 5.2 Create `js/services/firestore.js`
~200 lines - Firestore operations:
- Common Firestore patterns
- Guideline document operations

### 5.3 Create `js/services/transcript.js`
~300 lines - Transcript generation:
- `generateFakeClinicalInteraction()`
- Related transcript utilities

---

## Phase 6: Speech Recognition & Clinical Data
**Goal**: Extract specialized functionality

### 6.1 Create `js/features/speechRecognition.js`
~100 lines - Voice input handling

### 6.2 Create `js/features/clinicalData.js`
~200 lines - Clinical issues and conditions:
- `loadClinicalIssues()`
- Clinical conditions cache
- Related utilities

---

## Execution Order

### Week 1: Foundation
1. Phase 1 (Utilities) - Low risk, high reuse
2. Phase 2 (State) - Organize global state

### Week 2: Core Features
3. Phase 3.1-3.4 (Small features) - Quick wins
4. Phase 3.5 (Guidelines) - Large but self-contained

### Week 3: Analysis & Suggestions
5. Phase 3.6 (Analysis)
6. Phase 3.7 (Suggestions)

### Week 4: Preferences & UI
7. Phase 3.8 (Preferences)
8. Phase 3.9 (Chat)
9. Phase 4 (UI components)

### Week 5: Services & Cleanup
10. Phase 5 (Services)
11. Phase 6 (Specialized features)
12. Final cleanup and testing

---

## Guidelines for Each Extraction

### Before Extracting
1. Identify all dependencies (functions called, globals used)
2. Identify all callers (what uses this function)
3. Check for circular dependency risks

### During Extraction
1. Create the new module file
2. Move function(s) with their JSDoc comments
3. Add explicit imports for all dependencies
4. Export the function(s)
5. Update `script.js` to import and use the exported function

### After Extraction
1. Verify syntax: `npx acorn --module --silent script.js`
2. Test in browser - verify no console errors
3. Test affected functionality
4. Commit with descriptive message

---

## Expected Results

| Metric | Before | After |
|--------|--------|-------|
| script.js lines | ~16,600 | ~3,000-4,000 |
| Total modules | 6 | ~25 |
| Average module size | 2,700 lines | 300-500 lines |
| Functions per module | 60 | 5-15 |

---

## Risk Mitigation

### Low Risk Extractions (Do First)
- Pure utility functions
- Self-contained features (mobile, version, connectivity)
- Functions with no state dependencies

### Medium Risk Extractions
- Features that read/write shared state
- UI components with event handlers

### High Risk Extractions (Do Last)
- Core analysis flow
- Tightly coupled functions
- Functions with many callers

### Rollback Strategy
- Git commit after each successful extraction
- Keep old code commented until verified
- Test each extraction in browser before proceeding
