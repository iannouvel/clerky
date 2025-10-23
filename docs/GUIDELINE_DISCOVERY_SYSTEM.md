# Guideline Discovery System Documentation

## Overview

The Guideline Discovery System is an automated tool that finds missing RCOG and NICE guidelines by scraping their websites, comparing against your database, and providing a simple yes/no interface for adding them to your collection.

## Architecture

### Components

1. **Python Discovery Service** (`scripts/guideline_discovery_service.py`)
   - Scrapes RCOG and NICE websites
   - Compares discovered guidelines with current database
   - Generates prioritised reports
   - Assesses urgency and importance

2. **Node.js API Layer** (`scripts/guideline_discovery_api.js`)
   - Manages discovery process execution
   - Handles downloads and file management
   - Processes approval decisions
   - Updates guideline lists

3. **Server Endpoints** (added to `server.js`)
   - `POST /discoverMissingGuidelines` - Run discovery
   - `GET /getMissingGuidelines` - Load existing report
   - `POST /saveGuidelineApprovals` - Save user decisions
   - `POST /processApprovedGuidelines` - Download and add approved guidelines

4. **Web Interface** (`guideline-discovery.html`)
   - User-friendly dashboard
   - Priority-based filtering
   - Bulk selection and approval
   - Progress tracking

## How It Works

### Discovery Process

```
1. User clicks "Run Discovery"
   ↓
2. Python service scrapes RCOG/NICE websites
   ↓
3. Compares with guidance/list_of_guidelines.txt
   ↓
4. Generates priority-based report
   ↓
5. Report displayed in web interface
   ↓
6. User selects guidelines to add (Yes/No)
   ↓
7. Selected guidelines downloaded automatically
   ↓
8. Added to guidance/ folder and list_of_guidelines.txt
```

### Priority Assessment

Guidelines are categorised into three priority levels:

**High Priority:**
- Postnatal care
- Mental health
- Neonatal infection
- Intrapartum complications
- Recently published (within 2 years)

**Medium Priority:**
- Standard obstetric guidelines
- Moderately recent publications
- General clinical guidance

**Low Priority:**
- Public health guidelines
- Older publications
- Supplementary guidance

## Installation

### Prerequisites

```bash
# Python dependencies
pip install requests beautifulsoup4 lxml

# Node.js dependencies (if not already installed)
npm install axios
```

### Python Dependencies

Create a file `requirements.txt`:
```
requests>=2.31.0
beautifulsoup4>=4.12.0
lxml>=4.9.0
```

Install:
```bash
pip install -r requirements.txt
```

## Usage

### Method 1: Web Interface (Recommended)

1. **Navigate to Discovery Page**
   ```
   https://yourdomain.com/guideline-discovery.html
   ```

2. **Run Discovery**
   - Click "🔍 Run Discovery" button
   - Wait for scraping to complete (30-60 seconds)
   - Review discovered missing guidelines

3. **Review and Select**
   - Use priority tabs to filter (All, High, Medium, Low)
   - Select individual guidelines or "Select All"
   - Review URLs to verify guidelines

4. **Add to Database**
   - Click "✅ Add Selected Guidelines"
   - Confirm addition
   - Guidelines automatically download and process

### Method 2: Command Line

#### Run Discovery Only

```bash
cd scripts
python guideline_discovery_service.py
```

This generates: `data/missing_guidelines_report.json`

#### View Report

```bash
cat data/missing_guidelines_report.json | python -m json.tool
```

#### Manually Download Guidelines

For guidelines that require manual download:
1. Check the report for URLs
2. Download PDFs manually
3. Save to `guidance/` folder
4. Add filename to `guidance/list_of_guidelines.txt`

## Features

### Intelligent Matching

The system uses multiple strategies to avoid false positives:

1. **Title normalisation** - Removes punctuation, standardises spacing
2. **Multiple filename patterns** - Checks various naming conventions
3. **Partial matching** - Detects similar titles
4. **Year-aware** - Matches across different publication years

### Automatic Download

The system can automatically download:
- ✅ NICE guidelines (most formats)
- ⚠️ RCOG guidelines (may require manual download)

### Priority System

Automatically assesses priority based on:
- Clinical importance keywords
- Publication/update date
- Guideline type (clinical vs. public health)
- Topic relevance to core maternity care

## Admin Access

Only users with admin privileges can access the discovery system:
- Admin flag in Firebase user profile, OR
- Email: `inouvel@gmail.com`

## Data Storage

### Report Location
```
data/missing_guidelines_report.json
```

### Approval Decisions
```
data/guideline_approvals.json
```

### Downloaded Guidelines
```
guidance/[filename].pdf
```

### Guidelines List
```
guidance/list_of_guidelines.txt
```

## API Reference

### POST /discoverMissingGuidelines

Run guideline discovery process.

**Headers:**
```
Authorization: Bearer {idToken}
```

**Response:**
```json
{
  "success": true,
  "message": "Discovery completed successfully",
  "report": {
    "generated_at": "2025-10-23T...",
    "total_missing": 9,
    "by_source": {
      "RCOG": 1,
      "NICE": 8
    },
    "by_priority": {
      "high": [...],
      "medium": [...],
      "low": [...]
    },
    "guidelines": [...]
  }
}
```

### GET /getMissingGuidelines

Load existing discovery report.

**Response:**
```json
{
  "success": true,
  "report": {...},
  "approvals": {...}
}
```

### POST /saveGuidelineApprovals

Save user approval decisions.

**Body:**
```json
{
  "approvals": {
    "guideline_0": "approved",
    "guideline_1": "rejected"
  }
}
```

### POST /processApprovedGuidelines

Download and add approved guidelines.

**Body:**
```json
{
  "guidelineIds": ["guideline_0", "guideline_3", "guideline_5"]
}
```

**Response:**
```json
{
  "success": true,
  "message": "Processing completed",
  "results": [
    {
      "guideline": "NICE - 2021 - Postnatal Care",
      "success": true,
      "filename": "NICE - 2021 - Postnatal Care.pdf",
      "action": "downloaded_and_added"
    }
  ]
}
```

## Troubleshooting

### Discovery Fails

**Problem:** Python script times out or fails

**Solutions:**
1. Check internet connection
2. Verify RCOG/NICE websites are accessible
3. Review Python error logs
4. Run with verbose logging:
   ```python
   logging.basicConfig(level=logging.DEBUG)
   ```

### False Positives (Shows existing guidelines as missing)

**Problem:** System doesn't recognise guidelines you already have

**Solutions:**
1. Check filename format matches expected patterns
2. Verify `list_of_guidelines.txt` is up to date
3. Review normalisation logic in `normalize_title()`

### Download Failures

**Problem:** Automatic download doesn't work

**Solutions:**
1. For RCOG: These often require manual download (members-only)
2. For NICE: Check if PDF URL format has changed
3. Download manually and add to `guidance/` folder

### Permission Errors

**Problem:** "Unauthorized" error

**Solutions:**
1. Verify you're logged in
2. Check admin flag in Firebase
3. Confirm email matches admin list
4. Clear browser cache and re-authenticate

## Maintenance

### Regular Tasks

**Weekly:**
- Run discovery to find newly published guidelines

**Monthly:**
- Review and approve high-priority guidelines
- Verify automated downloads worked correctly
- Update any manually downloaded guidelines

**Quarterly:**
- Full audit of all guidelines (see `GUIDELINES_AUDIT_SUMMARY.md`)
- Check for deprecated/superseded guidelines
- Update discovery service for website changes

### Updating Discovery Service

If RCOG or NICE change their website structure:

1. Update scraping logic in `guideline_discovery_service.py`
2. Test with `python guideline_discovery_service.py`
3. Verify output in `data/missing_guidelines_report.json`
4. Update normalisation rules if needed

## Best Practices

### Before Running Discovery

1. ✅ Ensure `list_of_guidelines.txt` is current
2. ✅ Backup existing data
3. ✅ Check you have admin access
4. ✅ Verify internet connection

### When Reviewing Results

1. ✅ Prioritise high-priority guidelines
2. ✅ Verify URLs before approving
3. ✅ Check for duplicate entries
4. ✅ Review publication dates

### After Adding Guidelines

1. ✅ Verify PDFs downloaded correctly
2. ✅ Check `list_of_guidelines.txt` updated
3. ✅ Run guideline sync to Firestore
4. ✅ Test guideline search functionality

## Future Enhancements

### Planned Features

- [ ] Automatic weekly discovery scheduled task
- [ ] Email notifications for new guidelines
- [ ] Version tracking for guideline updates
- [ ] Comparison with previous versions
- [ ] Integration with guideline processing pipeline
- [ ] Automatic text extraction after download
- [ ] Support for more guideline sources (ACOG, WHO, etc.)

### Extensibility

To add new guideline sources:

1. Create scraping method in `GuidelineDiscoveryService`
2. Add source-specific download logic
3. Update priority assessment rules
4. Add to UI filter tabs

## Support

For issues or questions:
1. Check troubleshooting section above
2. Review system logs
3. Test individual components
4. Contact system administrator

---

**Last Updated:** 23 October 2025  
**Version:** 1.0.0

