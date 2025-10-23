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
        normalized = normalized.replace(/\s*\(.*?\)\s*/g, ''); // Remove parentheses
        normalized = normalized.replace(/\s*green-top guideline.*$/i, '');
        normalized = normalized.replace(/\s*no\.\s*\d+[a-z]?\s*/i, '');
        normalized = normalized.replace(/[^\w\s]/g, ''); // Remove punctuation
        normalized = normalized.replace(/\s+/g, ' ').trim(); // Normalize whitespace
        return normalized;
    }

    async compareWithDatabase(discoveredGuidelines) {
        console.log('Comparing with current database...');

        const current = await this.getCurrentGuidelines();
        const missing = [];

        for (const guideline of discoveredGuidelines) {
            const { title, year, source } = guideline;

            // Generate potential filenames
            const potentialNames = [];

            if (source === 'RCOG') {
                if (year) {
                    potentialNames.push(`bjog - ${year} - ${title}`.toLowerCase());
                    potentialNames.push(`gtg ${year} - ${title}`.toLowerCase());
                }
                potentialNames.push(`bjog - ${title}`.toLowerCase());
                potentialNames.push(`gtg - ${title}`.toLowerCase());
            } else if (source === 'NICE') {
                const code = guideline.code || '';
                if (year && code) {
                    potentialNames.push(`nice - ${year} - ${title}`.toLowerCase());
                    potentialNames.push(`nice ${code.toLowerCase()} - ${title}`.toLowerCase());
                }
                if (code) {
                    potentialNames.push(`nice - ${code.toLowerCase()}`.toLowerCase());
                }
                potentialNames.push(`nice - ${title}`.toLowerCase());
            }

            // Normalize for comparison
            const normalizedPatterns = potentialNames.map(name => this.normalizeTitle(name));

            // Check if any pattern matches existing guidelines
            let found = false;
            for (const pattern of normalizedPatterns) {
                for (const existing of current) {
                    if (pattern.includes(existing) || existing.includes(pattern)) {
                        found = true;
                        break;
                    }
                }
                if (found) break;
            }

            // Check normalized title match
            if (!found) {
                const normalizedTitle = this.normalizeTitle(title);
                for (const existing of current) {
                    const existingNormalized = this.normalizeTitle(existing);
                    if (normalizedTitle.includes(existingNormalized) || existingNormalized.includes(normalizedTitle)) {
                        found = true;
                        break;
                    }
                }
            }

            if (!found) {
                guideline.status = 'missing';
                guideline.priority = this.assessPriority(guideline);
                missing.push(guideline);
                console.log(`Missing: ${guideline.title}`);
            }
        }

        console.log(`Found ${missing.length} missing guidelines`);
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

