# Guideline Discovery - Quick Start Guide

## 🚀 Get Started in 5 Minutes

### Prerequisites

- Python 3.8+ installed
- Node.js installed
- Admin access to Clerky
- Internet connection

### Step 1: Install Dependencies

```bash
# Install Python dependencies
pip install requests beautifulsoup4 lxml

# Or use requirements file
pip install -r requirements.txt
```

### Step 2: Access the Discovery Interface

1. Open your browser
2. Navigate to: `https://clerky.ai/guideline-discovery.html`
3. Log in with your admin account

### Step 3: Run Discovery

Click the **"🔍 Run Discovery"** button

Wait 30-60 seconds while the system:
- Scrapes RCOG website
- Scrapes NICE website  
- Compares with your database
- Generates prioritised report

### Step 4: Review Results

The system shows you:
- **Total missing guidelines**
- **High priority** (needs immediate attention)
- **Medium priority** (add soon)
- **Low priority** (nice to have)

### Step 5: Select Guidelines

- Click checkboxes next to guidelines you want to add
- Or click "Select All" for a category
- Use priority tabs to filter

### Step 6: Add to Database

1. Click **"✅ Add Selected Guidelines"**
2. Confirm your selection
3. Wait for downloads to complete

Done! The guidelines are now in your database.

## What Gets Added

When you approve a guideline:

✅ PDF downloaded to `guidance/` folder  
✅ Added to `guidance/list_of_guidelines.txt`  
✅ Ready for AI processing

## Priority Guide

### ⚠️ High Priority - Add These First

- **Postnatal Care (NG194)** - Missing essential pathway component
- **Perinatal Mental Health (CG192)** - Critical safety topic
- **Neonatal Infection (CG149)** - Recently updated 2024
- **Thyroid in Pregnancy (GTG 76)** - Common condition
- **Intrapartum Care for Medical Conditions (NG121)** - Complex scenarios

### 📋 Medium Priority - Add Within 2 Weeks

- Public health guidelines (smoking, nutrition, weight management)
- Supplementary NICE quality standards
- Guideline updates from past 2 years

### 📁 Low Priority - Nice to Have

- Older public health guidance
- Archived versions
- Highly specialized topics

## Troubleshooting

### "No report found"
**Solution:** Click "Run Discovery" first to generate a report

### "Unauthorized"
**Solution:** Ensure you're logged in with an admin account

### "Some downloads failed"
**Solution:** RCOG guidelines may require manual download - URLs provided in results

### Discovery is slow
**Solution:** Normal - scraping websites takes 30-60 seconds

## Manual Download (If Needed)

Some RCOG guidelines require manual download:

1. Check the results for "manual download required"
2. Click the guideline URL
3. Download PDF from RCOG website
4. Save to `c:\Users\ianno\GitHub\clerky\guidance\`
5. Add filename to `guidance\list_of_guidelines.txt`

## After Adding Guidelines

Next steps to make guidelines available in the app:

1. **Process PDFs** (extract text):
   ```bash
   cd scripts
   python 1_process_pdf.py
   ```

2. **Sync to Firestore**:
   - Use the admin panel
   - Or run sync endpoint

3. **Verify** in the main app:
   - Search for the new guideline
   - Confirm it appears in results

## Tips

💡 **Run discovery monthly** to catch new publications  
💡 **Prioritise high-priority guidelines** for better patient care  
💡 **Check URLs** before approving to verify it's the right guideline  
💡 **Use filters** to focus on one category at a time

## Questions?

- 📖 Full docs: `docs/GUIDELINE_DISCOVERY_SYSTEM.md`
- 🐛 Issues: Check troubleshooting section above
- 💬 Support: Contact system administrator

---

**Happy discovering! 🎉**

