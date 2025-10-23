# Guideline Discovery System - Node.js Fix

## Problem
The original discovery system used Python, but Clerky runs on Render as a Node.js service. Python dependencies weren't installed, causing:
```
ModuleNotFoundError: No module named 'requests'
```

## Solution
Created a **Node.js version** of the discovery service that works natively with your existing infrastructure.

## What Changed

### Files Modified
1. **`scripts/guideline_discovery_service.js`** - NEW: Node.js version of discovery
2. **`scripts/guideline_discovery_api.js`** - Updated to use Node.js service
3. **`package.json`** - Added `cheerio` dependency for web scraping

### Files Kept (for local use)
- **`scripts/guideline_discovery_service.py`** - Still available for local testing

## How to Deploy

### 1. Commit and Push Changes
```bash
git add .
git commit -m "Add Node.js guideline discovery service"
git push
```

### 2. Render Will Auto-Deploy
Your Render service will automatically:
- Pull latest code
- Run `npm install` (installs cheerio)
- Restart with new code

### 3. Monitor Deployment
Use the Render MCP in Cursor or visit:
https://dashboard.render.com/web/srv-ct27s4a3esus73d590b0

## Using Render MCP for Log Monitoring

### View Recent Logs
In Cursor, you can now use:
```
Show me recent discovery logs from Render
```

### Query Specific Errors
```
Show me any errors in the last hour
```

### Filter by Type
```
Show me build logs
Show me app logs
Show me request logs
```

## Testing the Fix

### Local Testing (Optional)
```bash
cd scripts
node guideline_discovery_service.js
```

This generates: `data/missing_guidelines_report.json`

### Test on Render (After Deploy)
1. Open `guideline-discovery.html`
2. Click "🔍 Run Discovery"
3. Should work without Python errors!

## What the Node.js Version Does

Same functionality as Python version:
- ✅ Scrapes RCOG website
- ✅ Scrapes NICE website  
- ✅ Compares with database
- ✅ Generates priority report
- ✅ No Python dependencies needed!

Uses:
- `axios` for HTTP requests (already installed)
- `cheerio` for HTML parsing (newly installed)
- Native Node.js file system

## Monitoring with Render MCP

### Check Service Status
```javascript
// In Cursor
"What's the status of my Clerky service?"
```

### View Metrics
```javascript
// Check CPU/Memory
"Show me resource usage for the last hour"
```

### Stream Live Logs
```javascript
// Watch logs in real-time
"Show me live logs"
```

## Benefits of Node.js Version

1. **No Python needed** - Works with existing Node.js environment
2. **Faster** - No process spawning overhead
3. **Better error handling** - Direct JavaScript exceptions
4. **Easier debugging** - All in one language
5. **Render-friendly** - Uses packages already in ecosystem

## Rollback Plan

If something goes wrong:

### Option 1: Revert Commit
```bash
git revert HEAD
git push
```

### Option 2: Use Python Locally
The Python version still works locally:
```bash
pip install -r requirements.txt
cd scripts
python guideline_discovery_service.py
```

## Next Steps

1. ✅ Commit and push changes
2. ⏳ Wait for Render auto-deploy (~2-3 minutes)
3. ✅ Test discovery in browser
4. ✅ Monitor logs via Render MCP
5. ✅ Run monthly discovery!

## Troubleshooting

### "cheerio not found"
Run: `npm install`

### Still getting Python errors
- Clear Render cache
- Redeploy from dashboard

### Discovery timing out
- Normal for first run (30-60 seconds)
- Check logs: `Show me discovery logs`

---

**Status**: ✅ Ready to Deploy  
**Next Action**: Commit and push to trigger auto-deploy


