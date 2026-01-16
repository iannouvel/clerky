const axios = require('axios');
const cheerio = require('cheerio');
const { debugLog } = require('../config/logger');

// Web scraping for RCOG guidelines
async function scrapeRCOGGuidelines() {
    const guidelines = [];
    const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    };

    try {
        // Scrape Green-top Guidelines - look for direct PDF links
        const url = 'https://www.rcog.org.uk/guidance/browse-all-guidance/green-top-guidelines/';
        const response = await axios.get(url, { headers, timeout: 30000 });
        const $ = cheerio.load(response.data);

        // Look for PDF links within guideline containers
        // RCOG typically structures as: card/item containing both title link and PDF download link
        $('.o-card, .c-card, .guideline-item, [class*="guideline"]').each((index, container) => {
            const $container = $(container);

            // Find title (look for the main link, usually not a PDF)
            const $titleLink = $container.find('a[href*="green-top-guideline"]:not([href$=".pdf"])').first();
            const title = $titleLink.text().trim();

            // Find PDF link within the same container
            const $pdfLink = $container.find('a[href*=".pdf"], a[href*="/media/"]').first();
            let pdfUrl = $pdfLink.attr('href');

            if (pdfUrl && !pdfUrl.startsWith('http')) {
                pdfUrl = 'https://www.rcog.org.uk' + pdfUrl;
            }

            const numberMatch = title.match(/No\.\s*(\d+[a-z]?)/i);
            const yearMatch = title.match(/\b(20\d{2})\b/);

            // Only add if we have both title and a PDF URL
            if (title && pdfUrl && pdfUrl.includes('.pdf')) {
                guidelines.push({
                    title,
                    organisation: 'RCOG',
                    type: 'Green-top Guideline',
                    year: yearMatch ? parseInt(yearMatch[1]) : null,
                    url: pdfUrl,
                    canonicalId: numberMatch ? `RCOG-GTG-${numberMatch[1]}` : null
                });
            }
        });

        // Fallback: if no PDFs found using container method, try direct PDF link scraping
        if (guidelines.length === 0) {
            console.log('[SCRAPING] No PDFs found in containers, trying direct PDF links...');
            $('a[href*=".pdf"][href*="gtg"], a[href*=".pdf"][href*="green-top"]').each((index, element) => {
                const $el = $(element);
                const linkText = $el.text().trim();
                let pdfUrl = $el.attr('href');

                if (pdfUrl && !pdfUrl.startsWith('http')) {
                    pdfUrl = 'https://www.rcog.org.uk' + pdfUrl;
                }

                // Try to find title from nearby text or link text
                const title = linkText || $el.closest('div, li, article').find('h2, h3, h4, .title').text().trim() || 'Unknown';
                const numberMatch = title.match(/No\.\s*(\d+[a-z]?)/i) || pdfUrl.match(/gtg[_-]?(\d+[a-z]?)/i);
                const yearMatch = title.match(/\b(20\d{2})\b/) || pdfUrl.match(/\b(20\d{2})\b/);

                if (pdfUrl && pdfUrl.includes('.pdf')) {
                    guidelines.push({
                        title,
                        organisation: 'RCOG',
                        type: 'Green-top Guideline',
                        year: yearMatch ? parseInt(yearMatch[1]) : null,
                        url: pdfUrl,
                        canonicalId: numberMatch ? `RCOG-GTG-${numberMatch[1]}` : null
                    });
                }
            });
        }

        debugLog(`[SCRAPING] Found ${guidelines.length} RCOG guidelines`);
    } catch (error) {
        console.error('[SCRAPING] Error scraping RCOG:', error.message);
    }

    return guidelines;
}

// Web scraping for NICE guidelines
async function scrapeNICEGuidelines() {
    const guidelines = [];
    const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    };

    // Expanded O&G-relevant NICE codes
    const maternityCodes = [
        // Pregnancy and antenatal
        'NG201', 'NG194', 'NG235', 'NG121', 'CG190', 'NG3',
        // Intrapartum and postnatal  
        'CG192', 'NG133', 'CG37',
        // Fertility and reproductive health
        'CG156', 'NG23', 'NG137',
        // Gynaecological conditions
        'NG88', 'NG4', 'NG25', 'NG126', 'CG149',
        // Quality standards
        'QS22', 'QS109', 'QS115', 'QS200',
        // Public health
        'PH11', 'PH26', 'PH27'
    ];

    for (const code of maternityCodes) {
        try {
            const url = `https://www.nice.org.uk/guidance/${code.toLowerCase()}`;
            const response = await axios.get(url, {
                headers,
                timeout: 30000,
                validateStatus: status => status === 200
            });

            const $ = cheerio.load(response.data);
            const title = $('h1.page-header__heading').text().trim() ||
                $('h1').first().text().trim() ||
                code;

            const dateText = $('dd.published-date, .published-date, [class*="date"]').text().trim();
            const yearMatch = dateText.match(/\b(20\d{2})\b/) || title.match(/\b(20\d{2})\b/);

            const type = code.startsWith('NG') ? 'NICE Guideline' :
                code.startsWith('CG') ? 'Clinical Guideline' :
                    code.startsWith('QS') ? 'Quality Standard' :
                        code.startsWith('PH') ? 'Public Health Guideline' : 'NICE Guidance';

            // Try to find direct PDF download link
            let pdfUrl = null;

            // Method 1: Look for explicit download links
            const downloadLinks = $('a[href*=".pdf"], a[href*="/resources/"], a:contains("Download"), a:contains("PDF")').toArray();
            for (const link of downloadLinks) {
                const $link = $(link);
                const href = $link.attr('href');
                const linkText = $link.text().toLowerCase();

                // Prefer links that mention "full guideline" or "PDF" and contain the code
                if (href && (href.includes('.pdf') || href.includes('/resources/'))) {
                    const isRelevant = linkText.includes('full') ||
                        linkText.includes('guideline') ||
                        linkText.includes('download') ||
                        linkText.includes('pdf') ||
                        href.toLowerCase().includes(code.toLowerCase());

                    if (isRelevant) {
                        pdfUrl = href.startsWith('http') ? href : `https://www.nice.org.uk${href}`;
                        break;
                    }
                }
            }

            // Method 2: Construct expected PDF URL based on NICE's URL pattern
            if (!pdfUrl) {
                // NICE often uses pattern: /guidance/{code}/resources/{code}-pdf-{number}
                const resourcesUrl = `${url}/resources`;
                try {
                    const resourcesResponse = await axios.get(resourcesUrl, {
                        headers,
                        timeout: 10000,
                        validateStatus: status => status === 200
                    });
                    const $resources = cheerio.load(resourcesResponse.data);
                    const firstPdf = $resources('a[href*=".pdf"]').first().attr('href');
                    if (firstPdf) {
                        pdfUrl = firstPdf.startsWith('http') ? firstPdf : `https://www.nice.org.uk${firstPdf}`;
                    }
                } catch (e) {
                    // Resources page not found, continue
                }
            }

            // Method 3: Try common NICE PDF URL patterns
            if (!pdfUrl) {
                const commonPatterns = [
                    `https://www.nice.org.uk/guidance/${code.toLowerCase()}/resources/${code.toLowerCase()}-pdf`,
                    `https://www.nice.org.uk/guidance/${code.toLowerCase()}/resources/${code.toLowerCase()}-pdf-${Math.floor(Math.random() * 10000000000000)}`, // NICE uses random numbers
                ];

                for (const pattern of commonPatterns) {
                    try {
                        const testResponse = await axios.head(pattern, { headers, timeout: 5000 });
                        if (testResponse.status === 200) {
                            pdfUrl = pattern;
                            break;
                        }
                    } catch (e) {
                        // Pattern didn't work, try next
                    }
                }
            }

            // Use PDF URL if found, otherwise fall back to page URL
            const finalUrl = pdfUrl || url;

            guidelines.push({
                title,
                organisation: 'NICE',
                type,
                year: yearMatch ? parseInt(yearMatch[1]) : null,
                url: finalUrl,
                canonicalId: `NICE-${code.toUpperCase()}`
            });

        } catch (error) {
            // Silently skip codes that don't exist
            if (!error.response || error.response.status !== 404) {
                console.warn(`[SCRAPING] Could not fetch NICE ${code}:`, error.message);
            }
        }
    }

    debugLog(`[SCRAPING] Found ${guidelines.length} NICE guidelines`);
    return guidelines;
}

module.exports = {
    scrapeRCOGGuidelines,
    scrapeNICEGuidelines
};
