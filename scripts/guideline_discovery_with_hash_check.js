/**
 * Enhanced Guideline Discovery with Hash-Based Duplicate Detection
 * Downloads PDFs and compares hashes to eliminate false positives
 */

const axios = require('axios');
const crypto = require('crypto');
const { GuidelineDiscoveryService } = require('./guideline_discovery_service');

class HashBasedGuidelineDiscovery extends GuidelineDiscoveryService {
    
    /**
     * Download PDF and calculate its hash
     */
    async downloadAndHashPDF(url, timeout = 30000) {
        try {
            console.log(`[DOWNLOAD] Fetching PDF from: ${url}`);
            
            const response = await axios.get(url, {
                responseType: 'arraybuffer',
                timeout,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                },
                maxContentLength: 50 * 1024 * 1024, // 50MB max
                validateStatus: (status) => status === 200
            });
            
            const buffer = Buffer.from(response.data);
            const hash = crypto.createHash('sha256').update(buffer).digest('hex');
            
            console.log(`[HASH] Calculated hash: ${hash.substring(0, 16)}... (${buffer.length} bytes)`);
            
            return {
                success: true,
                buffer,
                hash,
                size: buffer.length
            };
        } catch (error) {
            console.error(`[DOWNLOAD] Failed to download/hash PDF: ${error.message}`);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Check if hash exists in database
     */
    async checkHashInDatabase(hash, authToken) {
        try {
            const response = await axios.post(
                'https://clerky-uzni.onrender.com/checkDuplicateFiles',
                {
                    hashes: [{ hash, filename: 'check', size: 0 }]
                },
                {
                    headers: {
                        'Authorization': `Bearer ${authToken}`,
                        'Content-Type': 'application/json'
                    },
                    timeout: 10000
                }
            );

            const isDuplicate = response.data.duplicates && response.data.duplicates.includes(hash);
            return {
                success: true,
                isDuplicate,
                message: isDuplicate ? 'File already exists in database' : 'New file'
            };
        } catch (error) {
            console.error(`[DUPLICATE_CHECK] Error: ${error.message}`);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Attempt to get PDF download URL for a guideline
     */
    getPDFUrl(guideline) {
        const { source, code, url } = guideline;
        
        // For NICE guidelines, construct PDF URL
        if (source === 'NICE' && code) {
            const lowerCode = code.toLowerCase();
            return `https://www.nice.org.uk/guidance/${lowerCode}/resources/${lowerCode}-pdf-${Math.random().toString(36).substring(7)}`;
        }
        
        // For RCOG, try to find PDF link on the page
        if (source === 'RCOG') {
            // RCOG PDFs are often behind member walls or require finding download links
            // Return the guideline page URL for now
            return url;
        }
        
        return null;
    }

    /**
     * Run discovery with hash-based duplicate detection
     * Processes high-priority guidelines one-by-one
     */
    async runHashBasedDiscovery(authToken, options = {}) {
        const {
            priorityFilter = 'high', // 'high', 'medium', 'low', or 'all'
            maxToCheck = 10, // Limit for performance
            onProgress = null
        } = options;

        console.log('\n' + '='.repeat(60));
        console.log('HASH-BASED GUIDELINE DISCOVERY');
        console.log('='.repeat(60));

        // First, run normal discovery to find candidates
        console.log('\n[1/3] Running initial discovery...\n');
        const initialReport = await this.runDiscovery();
        
        // Filter by priority
        let candidates = [];
        if (priorityFilter === 'all') {
            candidates = initialReport.guidelines;
        } else {
            candidates = initialReport.by_priority[priorityFilter] || [];
        }

        console.log(`\n[2/3] Found ${candidates.length} ${priorityFilter}-priority candidates`);
        console.log(`      Checking up to ${Math.min(candidates.length, maxToCheck)} with hash verification...\n`);

        const verifiedMissing = [];
        const falsePositives = [];
        const errors = [];

        const toCheck = candidates.slice(0, maxToCheck);

        for (let i = 0; i < toCheck.length; i++) {
            const guideline = toCheck[i];
            const progress = `[${i + 1}/${toCheck.length}]`;
            
            console.log(`\n${progress} ${guideline.title}`);
            
            if (onProgress) {
                onProgress({
                    current: i + 1,
                    total: toCheck.length,
                    guideline
                });
            }

            // Try to get PDF URL
            const pdfUrl = this.getPDFUrl(guideline);
            
            if (!pdfUrl) {
                console.log(`  ⚠️  No direct PDF URL available - manual check needed`);
                guideline.requiresManualCheck = true;
                verifiedMissing.push(guideline);
                continue;
            }

            // Download and hash
            const downloadResult = await this.downloadAndHashPDF(pdfUrl);
            
            if (!downloadResult.success) {
                console.log(`  ⚠️  Download failed: ${downloadResult.error}`);
                guideline.downloadError = downloadResult.error;
                errors.push(guideline);
                continue;
            }

            guideline.hash = downloadResult.hash;
            guideline.size = downloadResult.size;

            // Check hash against database
            const hashCheck = await this.checkHashInDatabase(downloadResult.hash, authToken);
            
            if (!hashCheck.success) {
                console.log(`  ⚠️  Hash check failed: ${hashCheck.error}`);
                guideline.hashCheckError = hashCheck.error;
                errors.push(guideline);
                continue;
            }

            if (hashCheck.isDuplicate) {
                console.log(`  ❌ DUPLICATE - File already in database (hash: ${downloadResult.hash.substring(0, 16)}...)`);
                falsePositives.push(guideline);
            } else {
                console.log(`  ✅ NEW - File not in database (hash: ${downloadResult.hash.substring(0, 16)}...)`);
                verifiedMissing.push(guideline);
            }

            // Small delay to avoid rate limiting
            if (i < toCheck.length - 1) {
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }

        console.log('\n[3/3] Hash verification complete!\n');

        const report = {
            generated_at: new Date().toISOString(),
            priority_filter: priorityFilter,
            total_candidates: candidates.length,
            checked: toCheck.length,
            verified_missing: verifiedMissing,
            false_positives: falsePositives,
            errors: errors,
            summary: {
                truly_missing: verifiedMissing.length,
                false_positives: falsePositives.length,
                errors: errors.length,
                accuracy: toCheck.length > 0 
                    ? ((verifiedMissing.length / toCheck.length) * 100).toFixed(1) + '%'
                    : 'N/A'
            }
        };

        console.log('='.repeat(60));
        console.log('RESULTS');
        console.log('='.repeat(60));
        console.log(`Total candidates checked: ${toCheck.length}`);
        console.log(`✅ Truly missing: ${verifiedMissing.length}`);
        console.log(`❌ False positives (duplicates): ${falsePositives.length}`);
        console.log(`⚠️  Errors: ${errors.length}`);
        console.log(`📊 Accuracy: ${report.summary.accuracy}`);
        console.log('='.repeat(60));

        if (falsePositives.length > 0) {
            console.log('\n📋 False Positives (already in database):');
            falsePositives.forEach(g => {
                console.log(`  - ${g.title}`);
            });
        }

        if (verifiedMissing.length > 0) {
            console.log('\n✅ Verified Missing:');
            verifiedMissing.forEach(g => {
                console.log(`  - ${g.title}`);
                if (g.requiresManualCheck) {
                    console.log(`    (requires manual check - no direct PDF URL)`);
                }
            });
        }

        return report;
    }
}

// Export for use in API
module.exports = { HashBasedGuidelineDiscovery };

// Example usage
async function main() {
    console.log('Hash-based discovery requires authentication token.');
    console.log('Please run this through the web interface or provide a token.\n');
    
    // For testing without token, run basic discovery
    const service = new HashBasedGuidelineDiscovery();
    const basicReport = await service.runDiscovery();
    
    console.log(`\nBasic discovery found ${basicReport.total_missing} potential missing guidelines.`);
    console.log('Use the web interface to run hash-based verification.\n');
}

if (require.main === module) {
    main().catch(console.error);
}

