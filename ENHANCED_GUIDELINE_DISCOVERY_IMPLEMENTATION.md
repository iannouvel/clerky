# Enhanced Multi-Organization Guideline Discovery - Implementation Summary

## Overview

The guideline discovery system has been enhanced to comprehensively scan for guidance from 15+ organizations relevant to Obstetrics & Gynaecology practice in the UK.

## Changes Made

### 1. Expanded AI Discovery Prompt (`server.js`)

**Location:** Lines 8179-8231

**Enhanced to include:**

#### Primary Organizations:
- **RCOG** (rcog.org.uk) - Green-top Guidelines, SIPs, Consent Advice, Good Practice Papers
- **NICE** (nice.org.uk) - All O&G-relevant guidelines with expanded code examples

#### Additional Organizations:
- **FSRH** (fsrh.org) - Sexual & reproductive healthcare guidance
- **BASHH** (bashh.org) - Sexual health and STI guidelines
- **BMS** (thebms.org.uk) - Menopause management guidance
- **BSH** (b-s-h.org.uk) - Haematology guidance relevant to O&G
- **BHIVA** (bhiva.org) - HIV guidance for pregnancy/women's health
- **BAPM** (bapm.org) - Perinatal medicine guidance
- **UK NSC** (gov.uk) - National screening programmes
- **NHS England** (england.nhs.uk) - National maternity policy

#### Subspecialty Societies:
- **BSGE** (bsge.org.uk) - Gynaecological endoscopy
- **BSUG** (bsug.org) - Urogynaecology
- **BGCS** (bgcs.org.uk) - Gynaecological cancer
- **BSCCP** (bsccp.org.uk) - Colposcopy and cervical pathology
- **BFS** (britishfertilitysociety.org.uk) - Fertility
- **BMFMS** (bmfms.org.uk) - Maternal & fetal medicine
- **BritSPAG** (britspag.org) - Paediatric and adolescent gynaecology

### 2. Expanded NICE Guideline Coverage

Added comprehensive O&G-relevant NICE codes to the system prompt:
- **Current codes:** NG201, NG194, NG235, NG121, CG192, CG190, NG4, NG25, NG126, CG149
- **New codes:** NG133, NG137, CG156, NG23

These cover: antenatal care, pregnancy complications, labour, postnatal care, fertility, menopause, and gynaecological conditions.

### 3. Enhanced User Interface (`dev.html`)

**Location:** Line 331

**Changes:**
- Button text updated from "Scan for new guidance (NICE/RCOG)" to "Scan for new guidance (All Organizations)"
- Added comprehensive tooltip listing all organizations being scanned
- Tooltip appears on hover, providing full transparency about scan scope

### 4. Improved Discovery Status Display (`dev.js`)

**Location:** Lines 892-946

**Enhanced features:**
- **Progress indicator:** Shows "🔍 Scanning all organizations..." during search
- **Waiting message:** Lists all organizations being searched
- **Organization-specific counts:** Results show breakdown by organization (e.g., "RCOG: 3, FSRH: 2, NICE: 1")
- **Visual feedback:** Color-coded status messages (blue for scanning, green for success, red for errors)
- **Better error handling:** Clear error messages with visual distinction

### 5. Enhanced Results Display (`dev.js`)

**Location:** Lines 700-722

**Improvements:**
- **Organization badges:** Each result shows organization name in a blue badge
- **Better layout:** Organization badge prominently displayed at the top of metadata
- **Clearer hierarchy:** Title → Organization badge + type + year → URL

## How the AI Discovery Works

### Discovery Process:
1. User clicks "🔎 Scan for new guidance (All Organizations)"
2. System loads existing guidelines and user exclusions from Firestore
3. AI receives comprehensive prompt with all 15+ organizations and their domains
4. AI searches for publicly accessible guidance URLs from all organizations
5. Results are filtered against existing guidelines and user exclusions
6. User sees suggestions with organization badges and can Include/Exclude each one

### AI Instructions:
The AI is instructed to:
- Search official domains for each organization
- Return only publicly accessible PDF URLs
- Avoid duplicates of existing guidelines
- Provide complete metadata (title, organization, type, year, URL)
- Suggest at least 5-10 items from various organizations

## Testing the Enhanced System

### 1. Basic Functionality Test
```
1. Open https://clerkyai.health/dev.html
2. Navigate to "Discovery" tab
3. Click "🔎 Scan for new guidance (All Organizations)"
4. Verify progress message appears
5. Wait for results (30-60 seconds)
6. Check that results show guidelines from multiple organizations
```

### 2. Organization Coverage Test
```
Expected results should include guidelines from:
- RCOG (Green-top, SIPs, etc.)
- NICE (various O&G-relevant codes)
- At least 2-3 other organizations (FSRH, BASHH, BMS, etc.)
```

### 3. User Interaction Test
```
For each suggested guideline:
1. Click "Open" - should preview in iframe or open in new tab
2. Click "Include" - should add to database and remove from list
3. Click "Exclude" - should add to exclusions and remove from list
```

### 4. Status Display Test
```
Verify status message shows:
- Organization-specific counts (e.g., "RCOG: 3, FSRH: 2")
- Total count
- Appropriate visual styling (colors, icons)
```

### 5. UI Elements Test
```
1. Hover over scan button - tooltip should show all organizations
2. Check organization badges on results - should be blue and prominent
3. Verify URL display doesn't break layout
```

## Expected Behavior

### First Scan:
- Should find 10-20+ suggestions from multiple organizations
- Results should include guidance from at least 3-5 different organizations
- Each result should have organization badge clearly visible

### Subsequent Scans:
- Should find fewer suggestions (already added guidelines are excluded)
- May focus on recently published guidance
- Should continue to show diverse organization coverage

### Result Quality:
- All URLs should be from authoritative domains
- PDFs should be publicly accessible
- Metadata should be accurate (title, year, type)
- No obvious duplicates of existing guidelines

## Troubleshooting

### If no results appear:
1. Check browser console for errors
2. Verify authentication (must be signed in)
3. Try refreshing and scanning again
4. Check server logs for AI API errors

### If only RCOG/NICE results appear:
- This is normal initially - AI may focus on most authoritative sources first
- AI learns from user feedback - include guidelines from other orgs to train preferences
- Consider running scan multiple times to get broader coverage

### If URLs are invalid:
- Some organizations may change their URL structures
- Use "Exclude" to remove invalid suggestions
- Report consistently invalid domains for prompt refinement

## Technical Notes

### AI Model Used:
- The system uses the user's configured AI provider (OpenAI or DeepSeek)
- Model is accessed via `routeToAI()` function with system and user prompts
- Token usage is logged for cost tracking

### Firestore Integration:
- Existing guidelines are loaded from the `guidelines` collection
- User preferences (included/excluded) are stored in user-specific subcollections
- Discovery results are compared against both sets to avoid duplicates

### URL Normalisation:
- All URLs are normalised for comparison (lowercase, trimmed)
- Prevents duplicate detection failures due to case or whitespace differences

### Performance:
- Initial scan may take 30-60 seconds depending on AI response time
- Results are processed client-side for faster interaction
- Large result sets are handled efficiently with filtered rendering

## Future Enhancements

Potential improvements for future versions:
1. **Organization filters** - Allow users to select specific organizations to scan
2. **Priority scoring** - AI could rank suggestions by clinical importance
3. **Automatic updates** - Scheduled scans to catch new guidelines
4. **Batch operations** - Include/exclude multiple guidelines at once
5. **Search within results** - Filter discovered guidelines by keyword
6. **Export functionality** - Download discovery results as CSV/JSON

## Files Modified

1. **server.js** (lines 8179-8253)
   - Expanded AI system prompt
   - Updated user prompt with all organizations
   - Enhanced organization metadata handling

2. **dev.html** (line 331)
   - Updated button text
   - Added comprehensive tooltip

3. **dev.js** (lines 700-722, 892-946)
   - Enhanced status display with organization counts
   - Improved progress feedback
   - Added organization badges to results
   - Better error handling and visual feedback

## Conclusion

The enhanced guideline discovery system now provides comprehensive coverage of O&G guidance across 15+ authoritative organizations in the UK. The AI-powered approach ensures flexibility and can adapt to new guidelines as they're published without requiring code changes to scraping logic.

Users can now discover, preview, and add guidance from a wide range of sources through a simple, intuitive interface with clear feedback about what's being searched and what's been found.









