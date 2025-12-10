# PDF.js Viewer Implementation

## Overview

Replaced custom PDF highlighting with PDF.js's built-in URL search parameters for reliable, automatic text highlighting in guidelines.

## Implementation Date

October 27, 2025

## Changes Made

### 1. Frontend (`script.js`)

**createGuidelineViewerLink() function (lines 3653-3681)**:
- Extracts quoted text from AI-generated context
- Builds PDF.js viewer URL with search hash parameters
- Format: `/pdfjs/web/viewer.html?file=/api/pdf/[guidelineId]#search=[text]&phrase=true&highlightAll=true`

**prepareViewerAuth() function (lines 3683-3714)**:
- Gets Firebase auth token
- Appends token as URL query parameter
- Opens PDF.js viewer in new window with authentication

### 2. Backend (`server.js`)

**New endpoint: `/api/pdf/:guidelineId` (lines 10467-10540)**:
- Accepts guideline ID as URL parameter
- Authenticates via Bearer token in query string or header
- Fetches PDF from `guidance/` directory
- Streams PDF with proper headers for inline viewing

### 3. PDF.js Viewer Setup

**Downloaded PDF.js v3.11.174** to `/pdfjs/` directory:
- `build/pdf.js` - Core library
- `build/pdf.worker.js` - Worker thread
- `web/viewer.html` - Main viewer interface
- `web/viewer.js` - Viewer logic
- `web/viewer.css` - Viewer styles

**Created custom auth handler (`pdfjs/web/clerky-auth.js`)**:
- Intercepts PDF.js file loading
- Adds Authorization header from URL token parameter
- Handles authentication for API endpoint requests

**Modified `pdfjs/web/viewer.html`**:
- Added `<script src="clerky-auth.js"></script>` before viewer.js

## How It Works

1. **User clicks PDF link** from a dynamic advice suggestion, audit view, or Ask-Guidelines answer.
2. **Frontend determines the search text** for the guideline:
   - If the AI context includes explicit quotes, `extractQuotedText()` pulls out the longest quoted segment.
   - If `hasVerbatimQuote === true` but no explicit quotes are found (for example when Ask-Guidelines passes a `SearchText` snippet via a `[[REF:GuidelineID|LinkText|SearchText]]` marker), `createGuidelineViewerLink()` falls back to using the full context/snippet, cleaned via `cleanQuoteForSearch()`.
3. **Builds viewer URL** with:
   - `file` parameter: `/api/pdf/[guidelineId]`
   - `token` parameter: Firebase auth token
   - Hash parameters: `#search=[text]&phrase=true&highlightAll=true&caseSensitive=false`
4. **PDF.js viewer opens** in new window
5. **clerky-auth.js** intercepts PDF loading and adds auth header
6. **Backend serves PDF** from guidance directory
7. **PDF.js automatically**:
   - Searches for the extracted or fallback verbatim text
   - Highlights all matches in yellow
   - Scrolls to first match
   - Shows search controls

## Benefits

✅ **Reliable highlighting** - Uses PDF.js's native text layer and search
✅ **No coordinate calculations** - PDF.js handles all positioning
✅ **Better UX** - Search navigation, highlight all matches
✅ **Proper authentication** - Token-based access to PDFs
✅ **Standard viewer** - Full PDF.js features (zoom, print, download)

## Testing Instructions

1. Generate a new dynamic advice suggestion
2. Click the PDF link (📄) next to a suggestion
3. Verify:
   - PDF opens in new tab
   - Search term is highlighted in yellow
   - Multiple matches are highlighted
   - Viewer scrolls to first match
   - Can navigate between matches with arrows

## Files Modified

- `script.js` - Updated link generation and auth handling
- `server.js` - Added `/api/pdf/:guidelineId` endpoint
- `pdfjs/web/viewer.html` - Added auth script
- `pdfjs/web/clerky-auth.js` - NEW: Authentication handler

## Dependencies

- PDF.js v3.11.174
- Firebase Authentication
- Express.js static file serving

## Notes

- The old `viewer.html` and `viewer.js` custom viewer can be removed once this is confirmed working
- Auth tokens are passed in URL for cross-window communication
- PDF.js viewer runs in separate window/tab context













