/**
 * Clinical Data Anonymisation Module
 * 
 * This module provides anonymisation functionality for clinical data before it's sent to the server.
 * It uses the @libretto/redact-pii-light library to remove personally identifiable information
 * while preserving clinical relevance.
 */

// Import the redact-pii-light library
// Note: This will be loaded via CDN for browser compatibility
let redactPII = null;

// Load the library dynamically with multiple fallback options
async function loadRedactPII() {
    if (redactPII) return redactPII;
    
    const cdnUrls = [
        'https://unpkg.com/@libretto/redact-pii-light@1.0.1/dist/index.js',
        'https://cdn.jsdelivr.net/npm/@libretto/redact-pii-light@1.0.1/dist/index.js',
        'https://cdnjs.cloudflare.com/ajax/libs/libretto-redact-pii-light/1.0.1/index.js'
    ];
    
    for (const url of cdnUrls) {
        try {
            console.log(`[ANONYMISER] Attempting to load library from: ${url}`);
            const response = await fetch(url);
            
            if (!response.ok) {
                console.warn(`[ANONYMISER] Failed to load from ${url}: ${response.status}`);
                continue;
            }
            
            const script = await response.text();
            
            // Create a temporary module environment
            const moduleExports = {};
            const module = { exports: moduleExports };
            const exports = moduleExports;
            
            // Execute the script in the module context
            const func = new Function('module', 'exports', 'require', script);
            func(module, exports, () => {});
            
            if (module.exports && module.exports.redactPII) {
                redactPII = module.exports.redactPII;
                console.log(`[ANONYMISER] Library loaded successfully from ${url}`);
                return redactPII;
            } else {
                console.warn(`[ANONYMISER] Library loaded but redactPII function not found from ${url}`);
            }
        } catch (error) {
            console.warn(`[ANONYMISER] Failed to load library from ${url}:`, error.message);
        }
    }
    
    console.warn('[ANONYMISER] All CDN attempts failed, using enhanced fallback anonymisation');
    return null;
}

/**
 * Clinical Data Anonymiser Class
 * Handles anonymisation of clinical data with medical-specific patterns
 */
class ClinicalDataAnonymiser {
    constructor() {
        this.initialized = false;
        this.customPatterns = this.getMedicalPatterns();
        this.enhancedPatterns = this.getEnhancedPIIPatterns();
    }

    /**
     * Initialize the anonymiser
     */
    async initialize() {
        if (this.initialized) return;
        
        try {
            // Test the library is working
            const redactPIIFunction = await loadRedactPII();
            if (redactPIIFunction) {
                const testResult = redactPIIFunction('Test patient John Doe, DOB: 01/01/1990');
                console.log('[ANONYMISER] Library initialized successfully');
            } else {
                console.log('[ANONYMISER] Using enhanced fallback anonymisation');
            }
            this.initialized = true;
        } catch (error) {
            console.error('[ANONYMISER] Failed to initialize:', error);
            this.initialized = true; // Still mark as initialized to use fallback
        }
    }

    /**
     * Get enhanced PII patterns for comprehensive detection
     */
    getEnhancedPIIPatterns() {
        return {
            // Names with titles (comprehensive)
            namesWithTitles: /(Mr\.|Mrs\.|Ms\.|Dr\.|Professor|Prof\.|Miss|Sir|Lady|Lord)\s+[A-Z][a-z]+/g,
            
            // Standalone names (first and last name combinations)
            fullNames: /\b[A-Z][a-z]+\s+[A-Z][a-z]+\b/g,
            
            // Single capitalized names (likely proper nouns) - more specific
            singleNames: /\b[A-Z][a-z]{2,}\b(?!\s+(?:Hospital|Trust|Centre|Clinic|Ward|Department|Unit))/g,
            
            // Email addresses
            emails: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
            
            // Phone numbers (UK and international)
            ukPhones: /\b(\+44|0)\s*\d{2,4}\s*\d{3,4}\s*\d{3,4}\b/g,
            internationalPhones: /\b\+\d{1,3}\s*\d{1,4}\s*\d{1,4}\s*\d{1,4}\b/g,
            
            // NHS numbers (UK format)
            nhsNumbers: /\b\d{3}[\s-]?\d{3}[\s-]?\d{4}\b/g,
            
            // Dates (various formats)
            dates: /\b\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}\b/g,
            isoDates: /\b\d{4}-\d{2}-\d{2}\b/g,
            
            // Addresses
            addresses: /\b\d+\s+[A-Za-z\s]+(?:Street|Road|Avenue|Lane|Close|Drive|Way|Place|Court)\b/gi,
            postcodes: /\b[A-Z]{1,2}\d{1,2}\s*\d[A-Z]{2}\b/gi,
            
            // Medical identifiers
            medicalRecordNumbers: /MRN[:\s]*(\d{6,})/gi,
            hospitalNumbers: /Hosp[:\s]*(\d{6,})/gi,
            patientIds: /Patient[:\s]*ID[:\s]*(\w+)/gi,
            caseNumbers: /Case[:\s]*(\d+)/gi,
            
            // Hospital/Clinic names
            hospitalNames: /(University Hospital|Royal Hospital|General Hospital|Medical Centre|Clinic|NHS Trust|Foundation Trust)/gi,
            
            // Medical staff titles
            medicalTitles: /(Consultant|Registrar|Fellow|Specialist|Nurse|Midwife)\s+[A-Z][a-z]+/g,
            
            // Ward/Department names
            wardNames: /(Ward|Department|Unit)\s+[A-Z0-9]+/gi,
            
            // Medical device serial numbers
            deviceSerials: /(Device|Equipment|Machine)\s+ID[:\s]*(\w+)/gi,
            
            // Social security numbers (US format)
            ssn: /\b\d{3}-\d{2}-\d{4}\b/g,
            
            // Credit card numbers (basic pattern)
            creditCards: /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g
        };
    }

    /**
     * Get medical-specific patterns for anonymisation
     */
    getMedicalPatterns() {
        return {
            // Medical record numbers
            medicalRecordNumber: /MRN[:\s]*(\d{6,})/gi,
            hospitalNumber: /Hosp[:\s]*(\d{6,})/gi,
            nhsNumber: /NHS[:\s]*(\d{3}[\s-]?\d{3}[\s-]?\d{4})/gi,
            
            // UK NHS number format
            nhsNumberFormat: /(\d{3}[\s-]?\d{3}[\s-]?\d{4})/g,
            
            // Medical identifiers
            patientId: /Patient[:\s]*ID[:\s]*(\w+)/gi,
            caseNumber: /Case[:\s]*(\d+)/gi,
            
            // Hospital/Clinic names (common UK hospitals)
            hospitalNames: [
                /(University Hospital|Royal Hospital|General Hospital|Medical Centre|Clinic)/gi,
                /(NHS Trust|Foundation Trust)/gi
            ],
            
            // Medical staff names (titles)
            medicalTitles: [
                /(Dr\.|Doctor|Prof\.|Professor|Mr\.|Mrs\.|Ms\.|Miss)\s+[A-Z][a-z]+/g,
                /(Consultant|Registrar|Fellow|Specialist)\s+[A-Z][a-z]+/g
            ],
            
            // Ward/Department names
            wardNames: /(Ward|Department|Unit)\s+[A-Z0-9]+/gi,
            
            // Medical device serial numbers
            deviceSerial: /(Device|Equipment|Machine)\s+ID[:\s]*(\w+)/gi
        };
    }

    /**
     * Anonymise clinical data
     * @param {string} text - The clinical text to anonymise
     * @param {Object} options - Anonymisation options
     * @returns {Object} - Anonymised text and metadata
     */
    async anonymise(text, options = {}) {
        if (!this.initialized) {
            await this.initialize();
        }

        const {
            preserveClinicalInfo = true,
            preserveDates = false,
            preserveAges = false,
            preserveGenders = false,
            customReplacements = {}
        } = options;

        try {
            console.log('[ANONYMISER] Starting anonymisation of clinical data');
            
            let anonymisedText = text;
            const replacements = [];
            const metadata = {
                originalLength: text.length,
                anonymisedLength: 0,
                replacementsCount: 0,
                preservedClinicalInfo: preserveClinicalInfo
            };

            // Step 1: Use the library's built-in PII detection
            const redactPIIFunction = await loadRedactPII();
            if (redactPIIFunction) {
                const libraryResult = redactPIIFunction(anonymisedText);
                anonymisedText = libraryResult.text;
            } else {
                // Use enhanced fallback anonymisation
                anonymisedText = this.enhancedAnonymisation(anonymisedText);
            }
            
            // Step 2: Apply medical-specific patterns
            for (const [patternName, pattern] of Object.entries(this.customPatterns)) {
                if (Array.isArray(pattern)) {
                    // Handle array of patterns
                    pattern.forEach((p, index) => {
                        const matches = anonymisedText.match(p);
                        if (matches) {
                            const replacement = `[${patternName.toUpperCase()}_${index + 1}]`;
                            anonymisedText = anonymisedText.replace(p, replacement);
                            replacements.push({
                                type: patternName,
                                pattern: p.toString(),
                                replacement: replacement,
                                count: matches.length
                            });
                        }
                    });
                } else {
                    // Handle single pattern
                    const matches = anonymisedText.match(pattern);
                    if (matches) {
                        const replacement = `[${patternName.toUpperCase()}]`;
                        anonymisedText = anonymisedText.replace(pattern, replacement);
                        replacements.push({
                            type: patternName,
                            pattern: pattern.toString(),
                            replacement: replacement,
                            count: matches.length
                        });
                    }
                }
            }

            // Step 3: Apply custom replacements if provided
            if (Object.keys(customReplacements).length > 0) {
                for (const [original, replacement] of Object.entries(customReplacements)) {
                    const regex = new RegExp(original, 'gi');
                    const matches = anonymisedText.match(regex);
                    if (matches) {
                        anonymisedText = anonymisedText.replace(regex, replacement);
                        replacements.push({
                            type: 'custom',
                            pattern: original,
                            replacement: replacement,
                            count: matches.length
                        });
                    }
                }
            }

            // Step 4: Handle clinical information preservation
            if (preserveClinicalInfo) {
                // Preserve important clinical terms while anonymising identifiers
                const clinicalTerms = [
                    'diagnosis', 'symptoms', 'treatment', 'medication', 'dose',
                    'blood pressure', 'heart rate', 'temperature', 'weight',
                    'height', 'BMI', 'lab results', 'test results'
                ];
                
                // Ensure clinical terms are not accidentally anonymised
                clinicalTerms.forEach(term => {
                    const regex = new RegExp(`\\[${term.toUpperCase()}\\]`, 'gi');
                    anonymisedText = anonymisedText.replace(regex, term);
                });
            }

            // Step 5: Handle dates and ages based on options
            if (!preserveDates) {
                // Remove specific dates but keep relative time references
                const datePatterns = [
                    /\b\d{1,2}\/\d{1,2}\/\d{4}\b/g,  // DD/MM/YYYY
                    /\b\d{4}-\d{2}-\d{2}\b/g,         // YYYY-MM-DD
                    /\b\d{1,2}\.\d{1,2}\.\d{4}\b/g   // DD.MM.YYYY
                ];
                
                datePatterns.forEach(pattern => {
                    const matches = anonymisedText.match(pattern);
                    if (matches) {
                        anonymisedText = anonymisedText.replace(pattern, '[DATE]');
                        replacements.push({
                            type: 'date',
                            pattern: pattern.toString(),
                            replacement: '[DATE]',
                            count: matches.length
                        });
                    }
                });
            }

            if (!preserveAges) {
                // Remove specific ages but keep age-related clinical information
                const agePatterns = [
                    /\b(\d{1,2})\s*(?:years?\s*old|y\.?o\.?)\b/gi,
                    /\bAge[:\s]*(\d{1,2})\b/gi
                ];
                
                agePatterns.forEach(pattern => {
                    const matches = anonymisedText.match(pattern);
                    if (matches) {
                        anonymisedText = anonymisedText.replace(pattern, '[AGE]');
                        replacements.push({
                            type: 'age',
                            pattern: pattern.toString(),
                            replacement: '[AGE]',
                            count: matches.length
                        });
                    }
                });
            }

            // Update metadata
            metadata.anonymisedLength = anonymisedText.length;
            metadata.replacementsCount = replacements.length;
            metadata.replacements = replacements;

            console.log('[ANONYMISER] Anonymisation completed successfully', {
                originalLength: metadata.originalLength,
                anonymisedLength: metadata.anonymisedLength,
                replacementsCount: metadata.replacementsCount
            });

            return {
                anonymisedText,
                metadata,
                success: true
            };

        } catch (error) {
            console.error('[ANONYMISER] Error during anonymisation:', error);
            return {
                anonymisedText: text, // Return original text if anonymisation fails
                metadata: {
                    error: error.message,
                    originalLength: text.length,
                    anonymisedLength: text.length,
                    replacementsCount: 0
                },
                success: false
            };
        }
    }

    /**
     * Enhanced anonymisation with medical context awareness
     * @param {string} text - Text to anonymise
     * @returns {string} - Anonymised text
     */
    enhancedAnonymisation(text) {
        let anonymisedText = text;
        
        // List of medical terms that should NOT be anonymised
        const medicalTerms = [
            'Hospital', 'Trust', 'Centre', 'Clinic', 'Ward', 'Department', 'Unit',
            'Consultant', 'Registrar', 'Fellow', 'Specialist', 'Nurse', 'Midwife',
            'Patient', 'Case', 'Diagnosis', 'Treatment', 'Medication', 'Dose',
            'Blood', 'Pressure', 'Heart', 'Rate', 'Temperature', 'Weight', 'Height',
            'BMI', 'Lab', 'Results', 'Test', 'Scan', 'Ultrasound', 'X-ray',
            'Gestational', 'Diabetes', 'Pregnancy', 'Fetal', 'Maternal', 'Obstetric',
            'Gynaecology', 'Miscarriage', 'Delivery', 'Birth', 'Labour', 'Contraction'
        ];
        
        // Apply enhanced PII patterns with medical context awareness
        for (const [patternName, pattern] of Object.entries(this.enhancedPatterns)) {
            if (Array.isArray(pattern)) {
                pattern.forEach(p => {
                    const matches = anonymisedText.match(p);
                    if (matches) {
                        // Check if matches contain medical terms that should be preserved
                        const filteredMatches = matches.filter(match => {
                            return !medicalTerms.some(term => 
                                match.toLowerCase().includes(term.toLowerCase())
                            );
                        });
                        
                        if (filteredMatches.length > 0) {
                            anonymisedText = anonymisedText.replace(p, `[${patternName.toUpperCase()}]`);
                        }
                    }
                });
            } else {
                const matches = anonymisedText.match(pattern);
                if (matches) {
                    // For single names, be more careful about medical context
                    if (patternName === 'singleNames') {
                        const filteredMatches = matches.filter(match => {
                            return !medicalTerms.some(term => 
                                match.toLowerCase() === term.toLowerCase()
                            );
                        });
                        
                        if (filteredMatches.length > 0) {
                            anonymisedText = anonymisedText.replace(pattern, `[${patternName.toUpperCase()}]`);
                        }
                    } else {
                        anonymisedText = anonymisedText.replace(pattern, `[${patternName.toUpperCase()}]`);
                    }
                }
            }
        }
        
        return anonymisedText;
    }

    /**
     * Count replacements made during anonymisation
     * @param {string} originalText - Original text
     * @param {string} anonymisedText - Anonymised text
     * @returns {number} - Number of replacements
     */
    countReplacements(originalText, anonymisedText) {
        const originalWords = originalText.split(/\s+/).length;
        const anonymisedWords = anonymisedText.split(/\s+/).length;
        return Math.abs(originalWords - anonymisedWords);
    }

    /**
     * Check if text contains potentially identifiable information
     * @param {string} text - Text to check
     * @returns {Object} - Analysis result
     */
    async checkForPII(text) {
        if (!this.initialized) {
            await this.initialize();
        }

        const analysis = {
            containsPII: false,
            piiTypes: [],
            riskLevel: 'low',
            recommendations: []
        };

        try {
            // Use enhanced PII patterns for comprehensive detection
            const piiPatterns = this.enhancedPatterns;

            for (const [type, pattern] of Object.entries(piiPatterns)) {
                const matches = text.match(pattern);
                if (matches && matches.length > 0) {
                    analysis.containsPII = true;
                    analysis.piiTypes.push({
                        type,
                        count: matches.length,
                        examples: matches.slice(0, 3) // Show first 3 examples
                    });
                }
            }

            // Determine risk level
            const totalPIIItems = analysis.piiTypes.reduce((sum, item) => sum + item.count, 0);
            if (totalPIIItems > 5) {
                analysis.riskLevel = 'high';
                analysis.recommendations.push('Strongly recommend anonymisation before processing');
            } else if (totalPIIItems > 2) {
                analysis.riskLevel = 'medium';
                analysis.recommendations.push('Consider anonymisation for privacy protection');
            } else if (totalPIIItems > 0) {
                analysis.riskLevel = 'low';
                analysis.recommendations.push('Minor PII detected, anonymisation optional');
            }

            return analysis;

        } catch (error) {
            console.error('[ANONYMISER] Error checking for PII:', error);
            return {
                containsPII: false,
                piiTypes: [],
                riskLevel: 'unknown',
                recommendations: ['Error occurred during PII analysis'],
                error: error.message
            };
        }
    }

    /**
     * Create a summary of anonymisation changes
     * @param {Object} anonymisationResult - Result from anonymise
     * @returns {string} - Human-readable summary
     */
    createAnonymisationSummary(anonymisationResult) {
        if (!anonymisationResult.success) {
            return 'Anonymisation failed - original text preserved';
        }

        const { metadata } = anonymisationResult;
        const summary = [];

        summary.push(`Anonymisation completed successfully:`);
        summary.push(`- Original length: ${metadata.originalLength} characters`);
        summary.push(`- Anonymised length: ${metadata.anonymisedLength} characters`);
        summary.push(`- Replacements made: ${metadata.replacementsCount}`);

        if (metadata.replacements && metadata.replacements.length > 0) {
            summary.push('\nTypes of information anonymised:');
            const typeCounts = {};
            metadata.replacements.forEach(rep => {
                typeCounts[rep.type] = (typeCounts[rep.type] || 0) + rep.count;
            });
            
            Object.entries(typeCounts).forEach(([type, count]) => {
                summary.push(`- ${type}: ${count} instances`);
            });
        }

        return summary.join('\n');
    }
}

// Create a global instance for easy access
const clinicalAnonymiser = new ClinicalDataAnonymiser();

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        ClinicalDataAnonymiser,
        clinicalAnonymiser
    };
}

// Make available globally for browser use
if (typeof window !== 'undefined') {
    window.ClinicalDataAnonymiser = ClinicalDataAnonymiser;
    window.clinicalAnonymiser = clinicalAnonymiser;
} 