/**
 * Guideline Discovery Service - Node.js Version
 * Scrapes RCOG and NICE websites to find missing guidelines
 */

const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs').promises;
const path = require('path');

class GuidelineDiscoveryService {
    constructor() {
        this.rcogBaseUrl = 'https://www.rcog.org.uk';
        this.niceBaseUrl = 'https://www.nice.org.uk';
        this.headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        };
    }

    async getCurrentGuidelines() {
        try {
            const guidelinesFile = path.join(__dirname, '..', 'guidance', 'list_of_guidelines.txt');
            const content = await fs.readFile(guidelinesFile, 'utf8');
            return new Set(
                content.split('\n')
                    .map(line => line.trim().replace('.pdf', '').toLowerCase())
                    .filter(line => line)
            );
        } catch (error) {
            console.warn('Could not load current guidelines:', error.message);
            return new Set();
        }
    }

    async scrapeRCOGGuidelines() {
        console.log('Scraping RCOG Green-top Guidelines...');
        const guidelines = [];

        try {
            const url = `${this.rcogBaseUrl}/guidance/browse-all-guidance/green-top-guidelines/`;
            const response = await axios.get(url, { 
                headers: this.headers,
                timeout: 30000 
            });

            const $ = cheerio.load(response.data);

            // Find all guideline links
            $('a[href*="green-top-guideline"]').each((index, element) => {
                const $el = $(element);
                const title = $el.text().trim();
                let url = $el.attr('href');

                if (!url.startsWith('http')) {
                    url = this.rcogBaseUrl + url;
                }

                // Extract guideline number
                const numberMatch = title.match(/No\.\s*(\d+[a-z]?)/i);
                const guidelineNumber = numberMatch ? numberMatch[1] : null;

                // Extract year
                const yearMatch = title.match(/\b(20\d{2})\b/);
                const year = yearMatch ? yearMatch[1] : null;

                if (title && url) {
                    guidelines.push({
                        source: 'RCOG',
                        title,
                        url,
                        guideline_number: guidelineNumber,
                        year,
                        type: 'Green-top Guideline'
                    });
                }
            });

            console.log(`Found ${guidelines.length} RCOG guidelines`);
        } catch (error) {
            console.error('Error scraping RCOG:', error.message);
        }

        return guidelines;
    }

    async scrapeNICEMaternityGuidelines() {
        console.log('Scraping NICE guidelines...');
        const guidelines = [];

        // Key NICE guideline codes for maternity
        const maternityCodes = [
            'NG201', 'NG194', 'NG235', 'NG121', 'CG192', 'CG190',
            'NG4', 'NG25', 'NG126', 'CG149', 'QS22', 'QS109',
            'QS115', 'QS200', 'PH11', 'PH26', 'PH27'
        ];

        for (const code of maternityCodes) {
            try {
                const url = `${this.niceBaseUrl}/guidance/${code.toLowerCase()}`;
                const response = await axios.get(url, {
                    headers: this.headers,
                    timeout: 30000,
                    validateStatus: status => status === 200
                });

                const $ = cheerio.load(response.data);

                // Extract title
                let title = $('h1.page-header__heading').text().trim() ||
                           $('h1').first().text().trim() ||
                           code;

                // Extract publication date
                let pubDate = null;
                const dateText = $('dd.published-date').text().trim();
                if (dateText) {
                    const yearMatch = dateText.match(/\b(20\d{2})\b/);
                    pubDate = yearMatch ? yearMatch[1] : null;
                }

                guidelines.push({
                    source: 'NICE',
                    title,
                    url,
                    code,
                    year: pubDate,
                    type: this.getNICEType(code)
                });

                console.log(`Found NICE ${code}: ${title}`);
            } catch (error) {
                console.warn(`Could not fetch NICE ${code}:`, error.message);
            }
        }

        console.log(`Found ${guidelines.length} NICE guidelines`);
        return guidelines;
    }

    getNICEType(code) {
        if (code.startsWith('NG')) return 'NICE Guideline';
        if (code.startsWith('CG')) return 'Clinical Guideline';
        if (code.startsWith('QS')) return 'Quality Standard';
        if (code.startsWith('PH')) return 'Public Health Guideline';
        return 'NICE Guidance';
    }

    normalizeTitle(title) {
        let normalized = title.toLowerCase();
        
        // Remove common prefixes and file extensions
        normalized = normalized.replace(/\.(pdf|txt)$/i, '');
        normalized = normalized.replace(/^(bjog|gtg|nice|rcog|bashh|bsh|eshre|bgcs|bms)\s*[-:]?\s*/i, '');
        normalized = normalized.replace(/^\d{4}\s*[-:]?\s*/i, ''); // Remove year prefix
        
        // Remove author names (pattern: "Name - ")
        normalized = normalized.replace(/^[a-z]+\s*[-:]\s*/i, '');
        
        // Remove guideline identifiers
        normalized = normalized.replace(/\s*\(.*?no\.\s*\d+[a-z]?\s*\).*$/i, ''); // (No. XX)
        normalized = normalized.replace(/\s*no\.\s*\d+[a-z]?\s*/gi, ''); // No. XX
        normalized = normalized.replace(/\s*green-top guideline.*$/i, '');
        normalized = normalized.replace(/\s*\[archived\]\s*/gi, ''); // Remove [Archived]
        
        // Remove all guideline codes (NG, CG, QS, PH)
        normalized = normalized.replace(/\s*(ng|cg|qs|ph)\d+\s*/gi, '');
        
        // Remove parentheses and their contents
        normalized = normalized.replace(/\s*\(.*?\)\s*/g, ' ');
        normalized = normalized.replace(/\s*\[.*?\]\s*/g, ' ');
        
        // Normalize common variations
        normalized = normalized.replace(/\b(labor|labour)\b/g, 'labor'); // US/UK
        normalized = normalized.replace(/\btransfusions?\b/g, 'transfusion'); // Singular/plural
        normalized = normalized.replace(/\bbabies\b/g, 'baby');
        normalized = normalized.replace(/\bwomen\b/g, 'woman');
        normalized = normalized.replace(/\bmasses\b/g, 'mass');
        normalized = normalized.replace(/\bcysts\b/g, 'cyst');
        
        // Remove common words that don't help matching
        const stopWords = ['the', 'of', 'and', 'in', 'for', 'to', 'a', 'an', 'during', 'after', 'with'];
        stopWords.forEach(word => {
            normalized = normalized.replace(new RegExp(`\\b${word}\\b`, 'gi'), ' ');
        });
        
        // Remove all punctuation
        normalized = normalized.replace(/[^\w\s]/g, ' ');
        
        // Normalize whitespace
        normalized = normalized.replace(/\s+/g, ' ').trim();
        
        return normalized;
    }

    /**
     * Extract guideline number from title (e.g., "No. 47" -> "47")
     */
    extractGuidelineNumber(title) {
        const match = title.match(/\bno\.\s*(\d+[a-z]?)\b/i);
        return match ? match[1].toLowerCase() : null;
    }

    /**
     * Calculate similarity score between two strings (0-1)
     */
    calculateSimilarity(str1, str2) {
        const longer = str1.length > str2.length ? str1 : str2;
        const shorter = str1.length > str2.length ? str2 : str1;
        
        if (longer.length === 0) return 1.0;
        
        // Exact match
        if (str1 === str2) return 1.0;
        
        // One contains the other
        if (longer.includes(shorter)) return 0.9;
        
        // Calculate Levenshtein distance-based similarity
        const editDistance = this.levenshteinDistance(str1, str2);
        return (longer.length - editDistance) / longer.length;
    }

    /**
     * Levenshtein distance for fuzzy matching
     */
    levenshteinDistance(str1, str2) {
        const matrix = [];
        
        for (let i = 0; i <= str2.length; i++) {
            matrix[i] = [i];
        }
        
        for (let j = 0; j <= str1.length; j++) {
            matrix[0][j] = j;
        }
        
        for (let i = 1; i <= str2.length; i++) {
            for (let j = 1; j <= str1.length; j++) {
                if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
                    matrix[i][j] = matrix[i - 1][j - 1];
                } else {
                    matrix[i][j] = Math.min(
                        matrix[i - 1][j - 1] + 1, // substitution
                        matrix[i][j - 1] + 1,     // insertion
                        matrix[i - 1][j] + 1      // deletion
                    );
                }
            }
        }
        
        return matrix[str2.length][str1.length];
    }

    async compareWithDatabase(discoveredGuidelines) {
        console.log('Comparing with current database...');

        const current = await this.getCurrentGuidelines();
        const missing = [];
        const SIMILARITY_THRESHOLD = 0.85; // 85% similarity required for a match

        for (const guideline of discoveredGuidelines) {
            const { title } = guideline;
            
            // Extract guideline number for RCOG guidelines
            const guidelineNumber = this.extractGuidelineNumber(title);
            
            // Normalize the discovered guideline title
            const normalizedTitle = this.normalizeTitle(title);
            
            let found = false;
            let bestMatch = null;
            let bestScore = 0;

            // Check against each existing guideline
            for (const existingFilename of current) {
                const normalizedExisting = this.normalizeTitle(existingFilename);
                
                // Method 1: Check by guideline number (for RCOG)
                if (guidelineNumber) {
                    const existingNumber = this.extractGuidelineNumber(existingFilename);
                    if (existingNumber && existingNumber === guidelineNumber) {
                        found = true;
                        bestMatch = existingFilename;
                        console.log(`✓ Matched by guideline number (${guidelineNumber}): "${title}" ≈ "${existingFilename}"`);
                        break;
                    }
                }
                
                // Method 2: Calculate similarity score
                const similarity = this.calculateSimilarity(normalizedTitle, normalizedExisting);
                
                if (similarity > bestScore) {
                    bestScore = similarity;
                    bestMatch = existingFilename;
                }
                
                // If we have a very strong match, accept it
                if (similarity >= SIMILARITY_THRESHOLD) {
                    found = true;
                    console.log(`✓ Matched by similarity (${(similarity * 100).toFixed(1)}%): "${title}" ≈ "${existingFilename}"`);
                    break;
                }
            }

            // Log near-misses for debugging
            if (!found && bestScore > 0.7) {
                console.log(`? Near match (${(bestScore * 100).toFixed(1)}%): "${title}" ≈ "${bestMatch}"`);
            }

            if (!found) {
                guideline.status = 'missing';
                guideline.priority = this.assessPriority(guideline);
                missing.push(guideline);
                console.log(`✗ Missing: ${guideline.title}`);
            }
        }

        console.log(`\nFound ${missing.length} missing guidelines`);
        return missing;
    }

    assessPriority(guideline) {
        const title = guideline.title.toLowerCase();
        const year = guideline.year;

        // High priority keywords
        const highPriorityKeywords = [
            'postnatal', 'mental health', 'neonatal infection',
            'intrapartum', 'thyroid', 'sepsis', 'stillbirth'
        ];

        // Medium priority: recently published or updated
        const currentYear = new Date().getFullYear();
        if (year && parseInt(year) >= currentYear - 2) {
            if (highPriorityKeywords.some(keyword => title.includes(keyword))) {
                return 'high';
            }
            return 'medium';
        }

        // High priority based on content
        if (highPriorityKeywords.some(keyword => title.includes(keyword))) {
            return 'high';
        }

        // Public health guidelines are lower priority
        if (guideline.type === 'Public Health Guideline') {
            return 'low';
        }

        return 'medium';
    }

    async generateReport(missingGuidelines, outputFile) {
        const report = {
            generated_at: new Date().toISOString(),
            total_missing: missingGuidelines.length,
            by_source: {},
            by_priority: {
                high: [],
                medium: [],
                low: []
            },
            guidelines: missingGuidelines
        };

        // Categorize
        for (const guideline of missingGuidelines) {
            const source = guideline.source;
            const priority = guideline.priority || 'medium';

            // Count by source
            if (!report.by_source[source]) {
                report.by_source[source] = 0;
            }
            report.by_source[source]++;

            // Group by priority
            report.by_priority[priority].push(guideline);
        }

        // Save to file
        if (outputFile) {
            const outputPath = path.join(__dirname, '..', outputFile);
            const dir = path.dirname(outputPath);
            await fs.mkdir(dir, { recursive: true });
            await fs.writeFile(outputPath, JSON.stringify(report, null, 2));
            console.log(`Report saved to ${outputFile}`);
        }

        return report;
    }

    async runDiscovery(outputFile = 'data/missing_guidelines_report.json') {
        console.log('Starting guideline discovery process...');

        try {
            // Scrape from sources
            const rcogGuidelines = await this.scrapeRCOGGuidelines();
            const niceGuidelines = await this.scrapeNICEMaternityGuidelines();

            const allDiscovered = [...rcogGuidelines, ...niceGuidelines];
            console.log(`Total discovered: ${allDiscovered.length}`);

            // Compare with database
            const missing = await this.compareWithDatabase(allDiscovered);

            // Generate report
            const report = await this.generateReport(missing, outputFile);

            console.log(`Discovery complete. Found ${missing.length} missing guidelines.`);
            console.log(`High priority: ${report.by_priority.high.length}`);
            console.log(`Medium priority: ${report.by_priority.medium.length}`);
            console.log(`Low priority: ${report.by_priority.low.length}`);

            return report;
        } catch (error) {
            console.error('Discovery failed:', error);
            throw error;
        }
    }
}

// Main function
async function main() {
    const service = new GuidelineDiscoveryService();
    const report = await service.runDiscovery();

    console.log('\n' + '='.repeat(60));
    console.log('GUIDELINE DISCOVERY REPORT');
    console.log('='.repeat(60));
    console.log(`Total Missing Guidelines: ${report.total_missing}`);
    console.log(`\nBy Source:`);
    for (const [source, count] of Object.entries(report.by_source)) {
        console.log(`  ${source}: ${count}`);
    }
    console.log(`\nBy Priority:`);
    for (const [priority, guidelines] of Object.entries(report.by_priority)) {
        console.log(`  ${priority.toUpperCase()}: ${guidelines.length}`);
    }
    console.log('='.repeat(60));
}

// Export for use in API
module.exports = { GuidelineDiscoveryService };

// Run if called directly
if (require.main === module) {
    main().catch(console.error);
}

