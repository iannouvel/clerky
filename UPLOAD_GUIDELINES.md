# Uploading Guidelines to Clerky

## Overview

As of November 2025, Clerky has migrated from GitHub-based PDF storage to Firebase Storage. This provides faster access, better reliability, and simpler management of clinical guideline PDFs.

## New Upload Process

### For Users (Web Interface)

1. **Navigate to the Upload Page**
   - Go to: `https://clerky.co.uk/admin-upload.html`
   - Or locally: `http://localhost:3000/admin-upload.html`

2. **Sign In**
   - You must be authenticated with Firebase Auth to upload PDFs
   - The page will redirect to login if you're not signed in

3. **Upload a PDF**
   - Click "Choose a PDF file" or drag-and-drop a PDF
   - (Optional) Enter metadata:
     - Title (defaults to filename if not provided)
     - Organisation (e.g., NICE, RCOG, BAPM)
     - Year Produced
   - Click "Upload & Process PDF"

4. **Processing**
   - The PDF is uploaded to Firebase Storage
   - Text is automatically extracted from the PDF
   - Condensed version is generated using AI
   - Firestore document is created with all metadata
   - Process typically takes 30-60 seconds depending on PDF size

5. **Confirmation**
   - Success message shows the guideline ID and content statistics
   - The guideline is immediately available for use in Clerky

### For Developers (Migration Script)

To migrate existing PDFs from the `guidance/` folder to Firebase:

```bash
# Install dependencies if needed
pip install firebase-admin

# Run migration (dry-run first to check)
python scripts/migrate_to_firebase.py --dry-run --limit 10

# Run actual migration for all PDFs
python scripts/migrate_to_firebase.py

# Check specific pattern
python scripts/migrate_to_firebase.py --pattern "NICE*.pdf"
```

The migration script will:
- Upload PDFs to Firebase Storage (`pdfs/` folder)
- Read existing condensed text from `guidance/condensed/` if available
- Create/update Firestore documents
- Generate a detailed migration report
- Skip duplicates (detected by file hash)

## Architecture Changes

### Before (GitHub-based)
```
User → GitHub API → guidance/*.pdf
                  → guidance/condensed/*.txt
Server → Fetches from GitHub → Processes
```

### After (Firebase-based)
```
User → Web UI → Server → Firebase Storage (pdfs/)
                       → Firestore (guidelines collection)
Server → Fetches from Firebase → Serves
```

## Storage Structure

### Firebase Storage
```
/pdfs/
  ├── NICE - 2025 - Intrapartum Care.pdf
  ├── RCOG - 2024 - Maternal Sepsis.pdf
  └── ...
```

### Firestore
```
guidelines/
  ├── nice-2025-intrapartum-care/
  │   ├── filename: "NICE - 2025 - Intrapartum Care.pdf"
  │   ├── content: "Full extracted text..."
  │   ├── condensed: "AI-generated condensed version..."
  │   ├── fileHash: "sha256..."
  │   └── ...metadata...
  └── ...
```

## API Endpoints

### Upload Endpoint
```
POST /uploadGuidelinePDF
Authorization: Bearer <Firebase-ID-Token>
Content-Type: multipart/form-data

Body:
- file: PDF file (required)
- title: String (optional)
- organisation: String (optional)
- yearProduced: Number (optional)

Response:
{
  "success": true,
  "guidelineId": "nice-2025-intrapartum-care",
  "filename": "NICE - 2025 - Intrapartum Care.pdf",
  "contentLength": 125000,
  "condensedLength": 45000
}
```

### PDF Viewing Endpoint
```
GET /api/pdf/:guidelineId?token=<Firebase-ID-Token>
```

Returns PDF binary for viewing in PDF.js viewer.

## Deprecated Components

The following have been archived (moved to `.github/workflows/archived/`):

1. **GitHub Actions Workflows**
   - `1_process_new_pdf.yml` - No longer processes PDFs from GitHub
   - `update-guideline-list.yml` - No longer updates list_of_guidelines.txt

2. **GitHub-based Functions** (now use Firestore)
   - `fetchCondensedFile()` - Now queries Firestore
   - `getFileContents()` - Now queries Firestore
   - `getGuidelinesList()` - Now queries Firestore

## Firebase Costs

Current usage estimates (as of Nov 2025):
- **Storage**: ~350MB of PDFs (well under 5GB free tier)
- **Bandwidth**: ~10-20GB/month (under 1GB/day free tier)
- **Operations**: Minimal (well under free tier limits)

**Expected cost**: $0/month for current usage levels

## Troubleshooting

### Upload Fails
- Check file size (<100MB recommended)
- Ensure it's a valid PDF file
- Check Firebase Auth token is valid
- Check server logs for extraction errors

### PDF Not Visible
- Verify upload succeeded (check Firestore for document)
- Check Firebase Storage for PDF in `pdfs/` folder
- Verify filename matches in Firestore document

### Migration Issues
- Check `migration.log` for detailed error messages
- Verify Firebase credentials (`gcloud_key.json`)
- Ensure PDF files are readable
- Check for file hash duplicates

## Benefits of New System

1. **Faster**: Direct Firebase CDN access vs GitHub API
2. **Simpler**: One-step upload vs Git commit workflow
3. **Reliable**: No GitHub API rate limits
4. **Scalable**: Firebase Storage designed for files
5. **Secure**: Firebase Auth & Storage rules
6. **Immediate**: No waiting for GitHub Actions

## Support

For issues or questions:
- Check server logs at Render dashboard
- Review Firestore documents in Firebase Console
- Check migration report: `migration_report.json`
- Contact: iannovel@outlook.com



