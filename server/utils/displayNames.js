const { db } = require('../config/firebase');
const { routeToAI } = require('../services/ai');
const { fetchAndExtractPDFText } = require('../services/pdf');
const { debugLog } = require('../config/logger');

// Hospital trust mapping cache (full name -> short name)
let hospitalTrustMappingsCache = null;
let hospitalTrustMappingsCacheTimestamp = 0;
const HOSPITAL_TRUST_CACHE_TTL = 60 * 60 * 1000; // 1 hour cache

/**
 * Load hospital trust mappings from Firestore with caching
 * @returns {Promise<Map<string, string>>} Map of full name to short name
 */
async function loadHospitalTrustMappings() {
    // Return cached data if still valid
    if (hospitalTrustMappingsCache && (Date.now() - hospitalTrustMappingsCacheTimestamp < HOSPITAL_TRUST_CACHE_TTL)) {
        return hospitalTrustMappingsCache;
    }

    if (!db) {
        console.log('[HOSPITAL_TRUST] Firestore not available, returning empty mappings');
        return new Map();
    }

    try {
        console.log('[HOSPITAL_TRUST] Loading hospital trust mappings from Firestore...');
        const snapshot = await db.collection('hospitalTrustMappings').get();

        const mappings = new Map();
        snapshot.forEach(doc => {
            const data = doc.data();
            if (data.fullName && data.shortName) {
                mappings.set(data.fullName, data.shortName);
            }
        });

        // Update cache
        hospitalTrustMappingsCache = mappings;
        hospitalTrustMappingsCacheTimestamp = Date.now();

        console.log(`[HOSPITAL_TRUST] Loaded ${mappings.size} trust mappings`);
        return mappings;
    } catch (error) {
        console.error('[HOSPITAL_TRUST] Error loading mappings:', error);
        return hospitalTrustMappingsCache || new Map();
    }
}

/**
 * Get the short/abbreviated name for a hospital trust
 * @param {string} fullName - The full hospital trust name
 * @returns {Promise<string>} The short name or a generated fallback
 */
async function getShortHospitalTrust(fullName) {
    if (!fullName || typeof fullName !== 'string') {
        return null;
    }

    const mappings = await loadHospitalTrustMappings();

    // Check for exact match first
    if (mappings.has(fullName)) {
        return mappings.get(fullName);
    }

    // Try case-insensitive match
    for (const [key, value] of mappings) {
        if (key.toLowerCase() === fullName.toLowerCase()) {
            return value;
        }
    }

    // Fallback: generate an acronym from the trust name
    console.log(`[HOSPITAL_TRUST] No mapping found for "${fullName}", generating acronym`);
    return generateTrustAcronym(fullName);
}

/**
 * Generate an acronym from a trust name as a fallback
 * @param {string} trustName - The full trust name
 * @returns {string} Generated acronym
 */
function generateTrustAcronym(trustName) {
    if (!trustName) return '';

    // Remove common suffixes
    let cleanName = trustName
        .replace(/\s+NHS\s+(Foundation\s+)?Trust$/i, '')
        .replace(/\s+University\s+Health\s+Board$/i, '')
        .replace(/\s+Health\s+Board$/i, '')
        .replace(/\s+Healthcare\s+NHS\s+Trust$/i, '')
        .trim();

    // If the name is already short (e.g., "Imperial"), return it as-is
    if (cleanName.split(/\s+/).length <= 2 && cleanName.length <= 15) {
        return cleanName;
    }

    // Generate acronym from capitalised words
    const words = cleanName.split(/\s+/);
    const acronym = words
        .filter(word => word.length > 2 || /^(of|and|the)$/i.test(word) === false)
        .map(word => word.charAt(0).toUpperCase())
        .join('');

    return acronym || cleanName.substring(0, 10);
}

function cleanHumanFriendlyName(rawName) {
    if (!rawName || typeof rawName !== 'string') {
        return rawName;
    }

    let cleaned = rawName.trim();

    // Remove common AI response prefixes
    cleaned = cleaned.replace(/^(The\s+)?(human-friendly\s+name\s+or\s+short\s+title\s+of\s+this\s+guideline\s+is\s*[:"]*\s*)/i, '');
    cleaned = cleaned.replace(/^(Human-friendly\s+name\s+or\s+short\s+title\s+of\s+the\s+guideline\s*[:"]*\s*)/i, '');
    cleaned = cleaned.replace(/^(Title\s*[:]*\s*)/i, '');
    cleaned = cleaned.replace(/^(The\s+short\s+title\s+of\s+this\s+guideline\s+is\s*[:"]*\s*)/i, '');

    // Remove internal reference codes at the beginning (MP053, CG12004, etc.)
    cleaned = cleaned.replace(/^(MP|CG|SP|MD|GP|GAU)\d+\s*[-:]?\s*/i, '');

    // Remove common prefixes that don't add value
    cleaned = cleaned.replace(/^(Guideline|Protocol|Policy|Standard|Procedure)\s*[-:]?\s*/i, '');

    // Remove relevance scores and parenthetical information at the end
    cleaned = cleaned.replace(/\s*\([^)]*relevance[^)]*\)$/i, '');
    cleaned = cleaned.replace(/\s*\([^)]*score[^)]*\)$/i, '');
    cleaned = cleaned.replace(/\s*\(high\s+relevance[^)]*\)$/i, '');
    cleaned = cleaned.replace(/\s*\(medium\s+relevance[^)]*\)$/i, '');
    cleaned = cleaned.replace(/\s*\(low\s+relevance[^)]*\)$/i, '');
    cleaned = cleaned.replace(/\s*\(not\s+relevant[^)]*\)$/i, '');

    // Remove standalone numeric scores in parentheses at the end
    cleaned = cleaned.replace(/\s*\(\d*\.?\d+\)$/g, '');

    // Remove version information in parentheses
    cleaned = cleaned.replace(/\s*\(v?\d+(\.\d+)?\)\s*$/i, '');
    cleaned = cleaned.replace(/\s*\(version\s*\d+(\.\d+)?\)\s*$/i, '');

    // Remove file extensions
    cleaned = cleaned.replace(/\.(pdf|doc|docx|txt)$/i, '');

    // Remove quotes at the beginning and end
    cleaned = cleaned.replace(/^["']|["']$/g, '');

    // Remove trailing periods that aren't part of abbreviations
    cleaned = cleaned.replace(/\.$/, '');

    // Common abbreviation expansions for better readability
    const abbreviationMappings = {
        'APH': 'Antepartum Haemorrhage',
        'PPH': 'Postpartum Haemorrhage',
        'BSOTS': 'Blood Saving in Obstetric Theatres',
        'BAC': 'Birth After Caesarean',
        'LSCS': 'Lower Segment Caesarean Section',
        'CTG': 'Cardiotocography',
        'FHR': 'Fetal Heart Rate',
        'PCOS': 'Polycystic Ovary Syndrome',
        'IVF': 'In Vitro Fertilisation',
        'ICSI': 'Intracytoplasmic Sperm Injection'
    };

    // Apply abbreviation expansions for standalone abbreviations at the start
    Object.entries(abbreviationMappings).forEach(([abbrev, expansion]) => {
        const regex = new RegExp(`^${abbrev}\\b`, 'i');
        if (regex.test(cleaned)) {
            cleaned = cleaned.replace(regex, expansion);
        }
    });

    // Clean up multiple spaces and normalize spacing
    cleaned = cleaned.replace(/\s+/g, ' ').trim();

    // Capitalize first letter if it's not already
    if (cleaned.length > 0) {
        cleaned = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
    }

    return cleaned;
}

// Generate elegant display name for guidelines
// This function applies more aggressive cleaning than cleanHumanFriendlyName
// to remove UHSx prefixes, hash codes, dates, version numbers, etc.
// AI-powered display name generation
async function generateDisplayNameWithAI(guidelineData, userId) {
    try {
        // Get content for AI analysis
        let contentForAnalysis = guidelineData.condensed || guidelineData.content;

        // If no content in Firestore, try to get it from PDF
        if (!contentForAnalysis && guidelineData.filename) {
            try {
                contentForAnalysis = await fetchAndExtractPDFText(guidelineData.filename);
            } catch (pdfError) {
                console.log(`[DISPLAY_NAME_AI] PDF extraction failed: ${pdfError.message}`);
            }
        }

        // Get the title/name to use
        const title = guidelineData.humanFriendlyName || guidelineData.title || guidelineData.filename || '';

        if (!title) {
            console.log('[DISPLAY_NAME_AI] No title available for AI generation');
            return null;
        }

        // Get scope and shortHospitalTrust for formatting
        const scope = guidelineData.scope || 'national';
        const hospitalTrust = guidelineData.hospitalTrust || '';

        // Get shortHospitalTrust - use existing field or look it up
        let shortHospitalTrust = guidelineData.shortHospitalTrust || '';
        if (!shortHospitalTrust && hospitalTrust) {
            shortHospitalTrust = await getShortHospitalTrust(hospitalTrust);
        }

        // Get the prompt config
        const promptConfig = global.prompts?.['extractDisplayName'] || require('../routes/prompts.json')['extractDisplayName'];
        if (!promptConfig) {
            console.log('[DISPLAY_NAME_AI] No prompt config found for extractDisplayName');
            return null;
        }

        // Prepare the prompt with title, scope, shortHospitalTrust, and content
        const prompt = promptConfig.prompt
            .replace('{{title}}', title)
            .replace('{{scope}}', scope)
            .replace('{{shortHospitalTrust}}', shortHospitalTrust || 'Not specified')
            .replace('{{text}}', (contentForAnalysis || '').substring(0, 2000));

        const messages = [
            { role: 'system', content: promptConfig.system_prompt },
            { role: 'user', content: prompt }
        ];

        const aiResult = await routeToAI({ messages }, userId);

        if (aiResult && aiResult.content) {
            // Parse and validate model output before persisting (models sometimes include reasoning/markdown)
            const raw = String(aiResult.content || '').trim();

            function normaliseOneLine(value) {
                if (!value || typeof value !== 'string') return null;
                return value.replace(/\r/g, '').replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
            }

            function extractCandidateDisplayName(text) {
                if (!text || typeof text !== 'string') return null;

                // Prefer the last fenced code block content if present
                const fenceMatches = [...text.matchAll(/```[\s\S]*?\n([\s\S]*?)```/g)];
                if (fenceMatches.length > 0) {
                    const lastBlock = fenceMatches[fenceMatches.length - 1][1] || '';
                    const firstLine = lastBlock.split('\n').map(l => l.trim()).filter(Boolean)[0];
                    if (firstLine) return firstLine;
                }

                // Look for an explicit "Final Display Name" section
                const finalLabel = text.match(/final\s+display\s+name[:\s]*([\s\S]*)/i);
                if (finalLabel && finalLabel[1]) {
                    const maybeLine = finalLabel[1].split('\n').map(l => l.trim()).filter(Boolean)[0];
                    if (maybeLine) return maybeLine;
                }

                // Otherwise take the first non-empty line
                const first = text.split('\n').map(l => l.trim()).filter(Boolean)[0];
                return first || null;
            }

            function isSuspiciousDisplayName(value) {
                if (!value || typeof value !== 'string') return true;
                if (value.length < 3) return true;
                if (value.length > 220) return true;
                if (/[<>]/.test(value)) return true;
                if (value.includes('```')) return true;
                if (value.includes('**')) return true;
                if (value.includes('•')) return true;
                const lower = value.toLowerCase();
                if (lower.includes('reasoning summary')) return true;
                if (lower.includes('final display name')) return true;
                return false;
            }

            const extracted = extractCandidateDisplayName(raw);
            const cleaned = normaliseOneLine(extracted)
                ?.replace(/^["']|["']$/g, '')
                .trim();

            if (!cleaned || isSuspiciousDisplayName(cleaned)) {
                console.warn(`[DISPLAY_NAME_AI] Ignoring invalid/suspicious model output for title "${title}"`, {
                    extracted: extracted ? extracted.substring(0, 200) : null,
                    cleaned: cleaned ? cleaned.substring(0, 200) : null
                });
                return null;
            }

            console.log(`[DISPLAY_NAME_AI] Generated: "${cleaned}" from title: "${title}", scope: "${scope}", shortTrust: "${shortHospitalTrust}"`);
            return cleaned;
        }

        return null;
    } catch (error) {
        console.error('[DISPLAY_NAME_AI] Error generating display name with AI:', error);
        return null;
    }
}

/**
 * Generate a simple displayName using the formula:
 * - Local guidelines: humanFriendlyName - shortHospitalTrust
 * - National guidelines: humanFriendlyName - organisation
 * @param {Object} guidelineData - The guideline data object
 * @returns {string} The formatted displayName
 */
function generateSimpleDisplayName(guidelineData) {
    const name = guidelineData.humanFriendlyName || guidelineData.title || guidelineData.filename || '';

    if (!name) {
        return null;
    }

    const scope = guidelineData.scope || 'national';

    if (scope === 'local') {
        // Local: humanFriendlyName - shortHospitalTrust
        const shortTrust = guidelineData.shortHospitalTrust || '';
        if (shortTrust) {
            return `${name} - ${shortTrust}`;
        }
        return name;
    } else {
        // National: humanFriendlyName - organisation
        const org = guidelineData.organisation || '';
        if (org) {
            return `${name} - ${org}`;
        }
        return name;
    }
}

// Fallback rule-based display name generation (kept for backward compatibility)
function generateDisplayName(rawName) {
    if (!rawName || typeof rawName !== 'string') {
        return rawName;
    }

    // Start with the base cleaning function
    let cleaned = cleanHumanFriendlyName(rawName);

    // Remove "UHSx" prefixes (case-insensitive, with optional space after)
    cleaned = cleaned.replace(/^UHSx\s*/i, '');

    // Remove hash codes like "UHS-CG-0009-2023" (pattern: UHS-CG-digits-digits)
    cleaned = cleaned.replace(/\bUHS-CG-\d+-\d+\b/gi, '');

    // Remove version numbers in various formats (v0.0.1, V2, v1.2.3, etc.)
    cleaned = cleaned.replace(/\s+v\d+(\.\d+)*(\.\d+)?\b/gi, '');
    cleaned = cleaned.replace(/\s+V\d+\b/g, '');
    cleaned = cleaned.replace(/\s+version\s+\d+(\.\d+)?/gi, '');

    // Remove dates in various formats (2020-10, 2011v2, etc.)
    cleaned = cleaned.replace(/\b\d{4}-\d{1,2}\b/g, ''); // YYYY-MM format
    cleaned = cleaned.replace(/\b\d{4}v\d+\b/gi, ''); // YYYYvN format
    cleaned = cleaned.replace(/\b\d{4}\s+\d{1,2}\b/g, ''); // YYYY MM format

    // Remove "Appendix X" prefixes (case-insensitive)
    cleaned = cleaned.replace(/^Appendix\s+\d+\s+/i, '');

    // Remove "Proforma" suffixes (case-insensitive, with optional text before)
    cleaned = cleaned.replace(/\s+Proforma\s*$/i, '');
    cleaned = cleaned.replace(/\s+-\s*Proforma\s*$/i, '');

    // Remove common suffixes like "FINAL", "DRAFT", etc.
    cleaned = cleaned.replace(/\s+(FINAL|DRAFT|REVISED|UPDATED)\s*$/i, '');

    // Remove parenthetical hash codes and reference codes
    cleaned = cleaned.replace(/\s*\([^)]*UHS[^)]*\)/gi, '');
    cleaned = cleaned.replace(/\s*\([^)]*CG-\d+[^)]*\)/gi, '');

    // Remove standalone reference codes (e.g., "PID Proforma - June 2011v2")
    cleaned = cleaned.replace(/\b(PID|GAU|MP|CG|SP|MD|GP)\s+Proforma\s*/gi, '');

    // Fix capitalization - Title Case for main words, lowercase for articles/prepositions
    // List of words that should be lowercase (unless first word)
    const lowercaseWords = ['a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'from',
        'in', 'into', 'of', 'on', 'or', 'the', 'to', 'with'];

    // Known medical acronyms that should always be uppercase (even if they appear lowercase in source)
    const knownAcronyms = new Set([
        'BJOG', 'RCOG', 'NICE', 'FSRH', 'BASHH', 'BMS', 'BSH', 'BHIVA', 'BAPM', 'BSGE', 'BSUG',
        'BGCS', 'BSCCP', 'BFS', 'BMFMS', 'BritSPAG', 'ESHRE', 'FIGO', 'ACOG', 'WHO', 'UKMEC',
        'UK NSC', 'COCP', 'POP', 'IUD', 'IUS', 'PID', 'HIV', 'VTE', 'PPH', 'APH', 'VBAC',
        'CS', 'LSCS', 'ECV', 'CTG', 'NIPE', 'FGM', 'GTD', 'OHSS', 'PCOS', 'PMS', 'PMRT'
    ]);

    // Split into words and capitalize appropriately
    const words = cleaned.split(/\s+/);
    const titleCased = words.map((word, index) => {
        if (word.length === 0) return word;

        // Check if this is a known acronym (case-insensitive match)
        const upperWord = word.toUpperCase();
        if (knownAcronyms.has(upperWord)) {
            return upperWord; // Convert to all caps if it's a known acronym
        }

        // Preserve acronyms (words that are all caps and at least 2 characters)
        // Common medical acronyms: BJOG, RCOG, NICE, FSRH, BASHH, BMS, BSH, BHIVA, BAPM, etc.
        if (word.length >= 2 && word === word.toUpperCase() && /^[A-Z]+$/.test(word)) {
            return word; // Keep acronyms as-is
        }

        // Always capitalize first word
        if (index === 0) {
            return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
        }

        // Lowercase articles/prepositions unless they're acronyms (all caps)
        if (lowercaseWords.includes(word.toLowerCase()) && word !== word.toUpperCase()) {
            return word.toLowerCase();
        }

        // Capitalize first letter, lowercase rest
        return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    });

    cleaned = titleCased.join(' ');

    // Clean up multiple spaces and normalize spacing
    cleaned = cleaned.replace(/\s+/g, ' ').trim();

    // Remove leading/trailing dashes and spaces
    cleaned = cleaned.replace(/^[- ]+|[- ]+$/g, '');

    // Ensure first letter is capitalized
    if (cleaned.length > 0) {
        cleaned = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
    }

    return cleaned;
}

module.exports = {
    loadHospitalTrustMappings,
    getShortHospitalTrust,
    cleanHumanFriendlyName,
    generateDisplayNameWithAI,
    generateSimpleDisplayName,
    generateDisplayName
};

