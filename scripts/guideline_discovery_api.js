/**
 * Guideline Discovery API
 * Backend endpoints for automated guideline discovery and approval
 */

const fs = require('fs').promises;
const path = require('path');
const axios = require('axios');
const { GuidelineDiscoveryService } = require('./guideline_discovery_service');

/**
 * Run the Node.js discovery service
 */
async function runDiscoveryService() {
    try {
        console.log('[DISCOVERY] Running Node.js discovery service...');
        
        const service = new GuidelineDiscoveryService();
        const report = await service.runDiscovery();
        
        return { success: true, report };
    } catch (error) {
        console.error('[DISCOVERY] Error:', error);
        throw error;
    }
}

/**
 * Load the discovery report
 */
async function loadDiscoveryReport() {
    try {
        const reportPath = path.join(__dirname, '..', 'data', 'missing_guidelines_report.json');
        const reportData = await fs.readFile(reportPath, 'utf8');
        return JSON.parse(reportData);
    } catch (error) {
        console.error('[DISCOVERY] Error loading report:', error);
        throw new Error('Discovery report not found. Run discovery first.');
    }
}

/**
 * Save approval decisions
 */
async function saveApprovalDecisions(decisions) {
    const approvalsPath = path.join(__dirname, '..', 'data', 'guideline_approvals.json');
    
    // Load existing approvals if any
    let existingApprovals = {};
    try {
        const existing = await fs.readFile(approvalsPath, 'utf8');
        existingApprovals = JSON.parse(existing);
    } catch (error) {
        // File doesn't exist yet
    }
    
    // Merge with new decisions
    const updated = {
        ...existingApprovals,
        ...decisions,
        last_updated: new Date().toISOString()
    };
    
    await fs.writeFile(approvalsPath, JSON.stringify(updated, null, 2));
    return updated;
}

/**
 * Load approval decisions
 */
async function loadApprovalDecisions() {
    try {
        const approvalsPath = path.join(__dirname, '..', 'data', 'guideline_approvals.json');
        const data = await fs.readFile(approvalsPath, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        return {};
    }
}

/**
 * Download a guideline PDF
 */
async function downloadGuideline(guideline, outputDir) {
    const url = guideline.url;
    const source = guideline.source;
    
    console.log(`[DOWNLOAD] Downloading ${guideline.title} from ${url}`);
    
    try {
        // For NICE guidelines
        if (source === 'NICE') {
            const code = guideline.code;
            const pdfUrl = `https://www.nice.org.uk/guidance/${code.toLowerCase()}/resources/${code.toLowerCase()}-pdf`;
            
            const response = await axios.get(pdfUrl, {
                responseType: 'arraybuffer',
                timeout: 60000,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                }
            });
            
            // Generate filename
            const year = guideline.year || new Date().getFullYear();
            const filename = `NICE - ${year} - ${sanitizeFilename(guideline.title)}.pdf`;
            const filepath = path.join(outputDir, filename);
            
            await fs.writeFile(filepath, response.data);
            console.log(`[DOWNLOAD] Saved to ${filepath}`);
            
            return { success: true, filename, filepath };
        }
        
        // For RCOG guidelines - more complex, might need manual download
        else if (source === 'RCOG') {
            // RCOG PDFs are often behind member walls or require finding specific download links
            // This is a placeholder - might need manual intervention
            console.log(`[DOWNLOAD] RCOG guideline download may require manual intervention: ${url}`);
            return {
                success: false,
                message: 'RCOG guidelines may require manual download',
                url: url
            };
        }
        
    } catch (error) {
        console.error(`[DOWNLOAD] Error downloading ${guideline.title}:`, error.message);
        return {
            success: false,
            error: error.message,
            url: url
        };
    }
}

/**
 * Sanitize filename
 */
function sanitizeFilename(name) {
    return name
        .replace(/[<>:"/\\|?*]/g, '')  // Remove illegal characters
        .replace(/\s+/g, ' ')  // Normalize whitespace
        .trim()
        .substring(0, 200);  // Limit length
}

/**
 * Process approved guidelines
 */
async function processApprovedGuidelines(approvedGuidelineIds, report) {
    const results = [];
    const guidanceDir = path.join(__dirname, '..', 'guidance');
    
    // Ensure guidance directory exists
    await fs.mkdir(guidanceDir, { recursive: true });
    
    for (const guidelineId of approvedGuidelineIds) {
        // Find the guideline in the report
        const guideline = report.guidelines.find((g, index) => {
            return `guideline_${index}` === guidelineId;
        });
        
        if (!guideline) {
            console.warn(`[PROCESS] Guideline ${guidelineId} not found in report`);
            continue;
        }
        
        console.log(`[PROCESS] Processing: ${guideline.title}`);
        
        // Download the guideline
        const downloadResult = await downloadGuideline(guideline, guidanceDir);
        
        if (downloadResult.success) {
            // Add to list_of_guidelines.txt
            const listPath = path.join(guidanceDir, 'list_of_guidelines.txt');
            await fs.appendFile(listPath, `${downloadResult.filename}\n`);
            
            results.push({
                guideline: guideline.title,
                success: true,
                filename: downloadResult.filename,
                action: 'downloaded_and_added'
            });
        } else {
            results.push({
                guideline: guideline.title,
                success: false,
                message: downloadResult.message || downloadResult.error,
                url: guideline.url,
                action: 'manual_download_required'
            });
        }
    }
    
    return results;
}

module.exports = {
    runDiscoveryService,
    loadDiscoveryReport,
    saveApprovalDecisions,
    loadApprovalDecisions,
    downloadGuideline,
    processApprovedGuidelines
};

