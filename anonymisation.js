/**
 * Clinical Data Anonymisation Module
 * 
 * This module provides anonymisation functionality for clinical data before it's sent to the server.
 * It uses the @libretto/redact-pii-light library to remove personally identifiable information
 * while preserving clinical relevance.
 */

// Import the bundled redact-pii-light library
let redactPII = null;

// Load the bundled library
async function loadRedactPII() {
    if (redactPII) return redactPII;
    
    try {
        // Check if the bundled library is available
        if (typeof LibrettoRedact !== 'undefined') {
            redactPII = LibrettoRedact;
            console.log('[ANONYMISER] Bundled library loaded successfully');
            return redactPII;
        }
        
        // Also check for the function directly
        if (typeof redactPii !== 'undefined') {
            redactPII = redactPii;
            console.log('[ANONYMISER] redactPii function found globally');
            return redactPII;
        }
        
        // Fallback: try to load the bundle file
        console.log('[ANONYMISER] Attempting to load bundled library...');
        
        // If we're in a browser environment, we need to load the script
        if (typeof window !== 'undefined') {
            // Check if the script is already loaded
            if (document.querySelector('script[src*="libretto-bundle.js"]')) {
                console.log('[ANONYMISER] Bundle script already loaded');
                return redactPII;
            }
            
            // Load the bundle script
            return new Promise((resolve, reject) => {
                const script = document.createElement('script');
                script.src = '/dist/libretto-bundle.js';
                script.onload = () => {
                    if (typeof LibrettoRedact !== 'undefined') {
                        redactPII = LibrettoRedact;
                        console.log('[ANONYMISER] Bundled library loaded successfully');
                        resolve(redactPII);
                    } else {
                        console.warn('[ANONYMISER] Bundle loaded but LibrettoRedact not found');
                        resolve(null);
                    }
                };
                script.onerror = () => {
                    console.warn('[ANONYMISER] Failed to load bundled library');
                    resolve(null);
                };
                document.head.appendChild(script);
            });
        }
        
        console.warn('[ANONYMISER] Using enhanced fallback anonymisation');
        return null;
    } catch (error) {
        console.warn('[ANONYMISER] Error loading bundled library:', error.message);
        return null;
    }
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
            // DISABLED: Regex patterns cause too many false positives with medical terms
            // Rely solely on Libretto library for PII detection
            
            // Only keep the most critical patterns for emergency fallback
            // (These will only be used if Libretto library completely fails)
            
            // Email addresses (very specific pattern)
            emails: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
            
            // Phone numbers (UK and international) - very specific
            ukPhones: /\b(\+44|0)\s*\d{2,4}\s*\d{3,4}\s*\d{3,4}\b/g,
            
            // NHS numbers (UK format) - very specific
            nhsNumbers: /\b\d{3}[\s-]?\d{3}[\s-]?\d{4}\b/g,
            
            // Social security numbers (US format) - very specific
            ssn: /\b\d{3}-\d{2}-\d{4}\b/g,
            
            // Credit card numbers (basic pattern) - very specific
            creditCards: /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g
            
            // REMOVED: All name-based patterns that cause false positives
            // REMOVED: Date patterns (medical records often contain dates that aren't PII)
            // REMOVED: Address patterns (too broad, catch medical terms)
            // REMOVED: All medical-related patterns (handled by Libretto)
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
                try {
                    const libraryResult = redactPIIFunction(anonymisedText);
                    // The bundled library returns a string directly, not an object with .text property
                    if (typeof libraryResult === 'string') {
                        // Track library replacements by comparing original and anonymised text
                        const libraryReplacements = this.detectLibraryReplacements(text, libraryResult);
                        replacements.push(...libraryReplacements);
                        anonymisedText = libraryResult;
                    } else if (libraryResult && libraryResult.text) {
                        anonymisedText = libraryResult.text;
                    } else {
                        console.warn('[ANONYMISER] Library returned unexpected result type:', typeof libraryResult);
                        anonymisedText = this.enhancedAnonymisation(anonymisedText);
                    }
                } catch (error) {
                    console.warn('[ANONYMISER] Library anonymisation failed, using fallback:', error.message);
                    anonymisedText = this.enhancedAnonymisation(anonymisedText);
                }
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
                    /\b\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}\b/g,  // DD/MM/YYYY
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
     * Detect replacements made by the library by comparing original and anonymised text
     * @param {string} originalText - Original text
     * @param {string} anonymisedText - Anonymised text from library
     * @returns {Array} - Array of replacement objects
     */
    detectLibraryReplacements(originalText, anonymisedText) {
        const replacements = [];
        
        // Common library replacement patterns
        const libraryPatterns = [
            { pattern: /PERSON_NAME/g, type: 'name', description: 'Person name' },
            { pattern: /DIGITS/g, type: 'digits', description: 'Numeric data' },
            { pattern: /EMAIL_ADDRESS/g, type: 'email', description: 'Email address' },
            { pattern: /PHONE_NUMBER/g, type: 'phone', description: 'Phone number' },
            { pattern: /ZIPCODE/g, type: 'postcode', description: 'Postal code' },
            { pattern: /CREDIT_CARD_NUMBER/g, type: 'credit_card', description: 'Credit card number' },
            { pattern: /SSN/g, type: 'ssn', description: 'Social security number' },
            { pattern: /IP_ADDRESS/g, type: 'ip', description: 'IP address' },
            { pattern: /STREET_ADDRESS/g, type: 'address', description: 'Street address' },
            { pattern: /CITY/g, type: 'city', description: 'City name' },
            { pattern: /STATE/g, type: 'state', description: 'State/province' },
            { pattern: /COUNTRY/g, type: 'country', description: 'Country name' }
        ];
        
        // Count library replacements
        let totalReplacements = 0;
        libraryPatterns.forEach(({ pattern, type, description }) => {
            const matches = anonymisedText.match(pattern);
            if (matches) {
                replacements.push({
                    type: `library_${type}`,
                    pattern: pattern.toString(),
                    replacement: description,
                    count: matches.length,
                    source: 'libretto-library'
                });
                totalReplacements += matches.length;
            }
        });
        
        // Add summary replacement if any were found
        if (totalReplacements > 0) {
            replacements.push({
                type: 'library_summary',
                pattern: 'libretto-library',
                replacement: `${totalReplacements} PII elements`,
                count: totalReplacements,
                source: 'libretto-library'
            });
        }
        
        return replacements;
    }

    /**
     * Identify what the Libretto library detected by comparing original and anonymised text
     * @param {string} originalText - Original text
     * @param {string} anonymisedText - Anonymised text from library
     * @returns {Array} - Array of detected items
     */
    identifyLibraryDetections(originalText, anonymisedText) {
        const detectedItems = [];
        
        // List of medical terms that should NOT be considered PII
        const medicalTerms = [
            'Hospital', 'Trust', 'Centre', 'Clinic', 'Ward', 'Department', 'Unit',
            'Consultant', 'Registrar', 'Fellow', 'Specialist', 'Nurse', 'Midwife',
            'Patient', 'Case', 'Diagnosis', 'Treatment', 'Medication', 'Dose',
            'Blood', 'Pressure', 'Heart', 'Rate', 'Temperature', 'Weight', 'Height',
            'BMI', 'Lab', 'Results', 'Test', 'Scan', 'Ultrasound', 'X-ray',
            'Gestational', 'Diabetes', 'Pregnancy', 'Fetal', 'Maternal', 'Obstetric',
            'Gynaecology', 'Miscarriage', 'Delivery', 'Birth', 'Labour', 'Contraction',
            'Twin', 'Twins', 'Previous', 'Current', 'Booking', 'History', 'Presenting',
            'Complaint', 'Relevant', 'Medical', 'Mild', 'Medications', 'Currently',
            'Social', 'Lives', 'Works', 'Examination', 'Alert', 'Uterus', 'Notable',
            'Omissions', 'Growth', 'Management', 'Serum', 'Fasting', 'Full', 'Weekly',
            'Increase', 'Aim', 'Consider', 'Counseling', 'Provided', 'Discussed',
            'Reassured', 'Ongoing', 'Advised', 'Dictated', 'This', 'Pruritus',
            'Unremarkable', 'She', 'Dopplers', 'Start', 'Weekly',
            // Language names - these should NOT be considered PII
            'English', 'French', 'Spanish', 'German', 'Italian', 'Portuguese', 'Dutch',
            'Russian', 'Chinese', 'Japanese', 'Korean', 'Arabic', 'Hindi', 'Bengali',
            'Urdu', 'Turkish', 'Polish', 'Romanian', 'Greek', 'Czech', 'Hungarian',
            'Swedish', 'Norwegian', 'Danish', 'Finnish', 'Estonian', 'Latvian',
            'Lithuanian', 'Slovenian', 'Slovak', 'Croatian', 'Serbian', 'Bulgarian',
            'Albanian', 'Macedonian', 'Bosnian', 'Montenegrin', 'Ukrainian', 'Belarusian',
            'Mandarin', 'Cantonese', 'Tamil', 'Telugu', 'Marathi', 'Gujarati', 'Punjabi',
            'Swahili', 'Afrikaans', 'Zulu', 'Xhosa', 'Yoruba', 'Hausa', 'Igbo',
            'Amharic', 'Somali', 'Oromo', 'Tigrinya', 'Akan', 'Ewe', 'Ga',
            'British', 'American', 'Australian', 'Canadian', 'Irish', 'Scottish', 'Welsh'
        ];
        
        // Look for specific name patterns that the library would detect
        const namePatterns = [
            // Full names in structured format
            /Name:\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/g,
            /Patient:\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/g,
            // Names with titles
            /Ms\.\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/g,
            /Mr\.\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/g,
            /Dr\.\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/g,
            // Standalone capitalized names (likely first/last names)
            /\b([A-Z][a-z]+)\b/g
        ];
        
        // Check each name pattern in the original text
        namePatterns.forEach(pattern => {
            let match;
            while ((match = pattern.exec(originalText)) !== null) {
                const detectedName = match[1];
                
                // Skip if it's a medical term
                if (medicalTerms.some(term => 
                    detectedName.toLowerCase() === term.toLowerCase() ||
                    detectedName.toLowerCase().includes(term.toLowerCase())
                )) {
                    continue;
                }
                
                // Check if this name was changed in the anonymised version
                const namePattern = new RegExp(this.escapeRegExp(detectedName), 'g');
                if (!namePattern.test(anonymisedText)) {
                    // The name was changed, so it's likely PII
                    detectedItems.push(detectedName);
                }
            }
        });
        
        // Also look for other PII patterns
        const otherPatterns = [
            // Ages
            { pattern: /Age:\s*(\d+)/g, type: 'age' },
            // Phone numbers
            { pattern: /(\d{3}[-.\s]?\d{3}[-.\s]?\d{4})/g, type: 'phone' },
            // NHS numbers
            { pattern: /(\d{3}-\d{3}-\d{4})/g, type: 'nhs' },
            // Emails
            { pattern: /([^\s@]+@[^\s@]+\.[^\s@]+)/g, type: 'email' },
            // Dates
            { pattern: /(\d{1,2}\/\d{1,2}\/\d{2,4})/g, type: 'date' },
            { pattern: /(\d{1,2}-\d{1,2}-\d{2,4})/g, type: 'date' }
        ];
        
        otherPatterns.forEach(({ pattern, type }) => {
            let match;
            while ((match = pattern.exec(originalText)) !== null) {
                const detectedText = match[1];
                
                // Check if this text was changed in the anonymised version
                const anonymisedPattern = new RegExp(this.escapeRegExp(detectedText), 'g');
                if (!anonymisedPattern.test(anonymisedText)) {
                    detectedItems.push(detectedText);
                }
            }
        });
        
        return [...new Set(detectedItems)]; // Remove duplicates
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
            'Gynaecology', 'Miscarriage', 'Delivery', 'Birth', 'Labour', 'Contraction',
            // Language names - these should NOT be considered PII
            'English', 'French', 'Spanish', 'German', 'Italian', 'Portuguese', 'Dutch',
            'Russian', 'Chinese', 'Japanese', 'Korean', 'Arabic', 'Hindi', 'Bengali',
            'Urdu', 'Turkish', 'Polish', 'Romanian', 'Greek', 'Czech', 'Hungarian',
            'Swedish', 'Norwegian', 'Danish', 'Finnish', 'Estonian', 'Latvian',
            'Lithuanian', 'Slovenian', 'Slovak', 'Croatian', 'Serbian', 'Bulgarian',
            'Albanian', 'Macedonian', 'Bosnian', 'Montenegrin', 'Ukrainian', 'Belarusian',
            'Mandarin', 'Cantonese', 'Tamil', 'Telugu', 'Marathi', 'Gujarati', 'Punjabi',
            'Swahili', 'Afrikaans', 'Zulu', 'Xhosa', 'Yoruba', 'Hausa', 'Igbo',
            'Amharic', 'Somali', 'Oromo', 'Tigrinya', 'Akan', 'Ewe', 'Ga',
            'British', 'American', 'Australian', 'Canadian', 'Irish', 'Scottish', 'Welsh'
        ];
        
        // Apply only critical PII patterns (avoid medical false positives)
        const criticalPatterns = ['emails', 'ukPhones', 'nhsNumbers', 'ssn', 'creditCards'];
        
        for (const [patternName, pattern] of Object.entries(this.enhancedPatterns)) {
            // Only use critical patterns that are unlikely to cause false positives
            if (!criticalPatterns.includes(patternName)) {
                continue;
            }
            
            const matches = anonymisedText.match(pattern);
            if (matches) {
                anonymisedText = anonymisedText.replace(pattern, `[${patternName.toUpperCase()}]`);
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

        // Store the text for consolidation
        this.lastCheckedText = text;

        const analysis = {
            containsPII: false,
            piiTypes: [],
            riskLevel: 'low',
            recommendations: [],
            matches: [] // Add matches array for consolidation
        };

        try {
            // First, try to use the Libretto library for PII detection
            const redactPIIFunction = await loadRedactPII();
            if (redactPIIFunction) {
                try {
                    // Use the library to detect PII
                    const libraryResult = redactPIIFunction(text);
                    
                    // If the library made changes, it detected PII
                    if (libraryResult !== text) {
                        analysis.containsPII = true;
                        
                        // Try to identify what the library detected by comparing original and anonymised text
                        const detectedItems = this.identifyLibraryDetections(text, libraryResult);
                        
                        if (detectedItems.length > 0) {
                            // Add specific detected items
                            analysis.piiTypes.push({
                                type: 'libretto_detected',
                                count: detectedItems.length,
                                examples: detectedItems.slice(0, 3)
                            });
                            analysis.matches.push({
                                type: 'libretto_detected',
                                count: detectedItems.length,
                                examples: detectedItems
                            });
                        } else {
                            // Fallback if we can't identify specific items
                            analysis.piiTypes.push({
                                type: 'libretto_detected',
                                count: 1,
                                examples: ['PII detected by Libretto library']
                            });
                            analysis.matches.push({
                                type: 'libretto_detected',
                                count: 1,
                                examples: ['PII detected by Libretto library']
                            });
                        }
                        
                        analysis.riskLevel = 'medium';
                        analysis.recommendations.push('PII detected by advanced library, recommend anonymisation');
                        
                        console.log('[ANONYMISER] Libretto library detected PII:', detectedItems);
                        return analysis;
                    }
                } catch (error) {
                    console.warn('[ANONYMISER] Libretto library failed, using fallback patterns:', error.message);
                }
            }

            // Only use fallback patterns if Libretto library completely failed to load
            console.log('[ANONYMISER] Libretto library not available, using minimal fallback patterns');
            const piiPatterns = this.enhancedPatterns;

            // Only check for very specific, non-medical PII patterns
            const criticalPatterns = ['emails', 'ukPhones', 'nhsNumbers', 'ssn', 'creditCards'];
            
            for (const [type, pattern] of Object.entries(piiPatterns)) {
                // Only use the critical patterns that are unlikely to cause false positives
                if (!criticalPatterns.includes(type)) {
                    continue;
                }
                
                const matches = text.match(pattern);
                if (matches && matches.length > 0) {
                    analysis.containsPII = true;
                    analysis.piiTypes.push({
                        type,
                        count: matches.length,
                        examples: matches.slice(0, 3) // Show first 3 examples
                    });
                    // Store all matches for consolidation
                    analysis.matches.push({
                        type,
                        count: matches.length,
                        examples: matches
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
                error: error.message,
                matches: []
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

    /**
     * Consolidate PII matches to merge overlapping and adjacent matches
     * @param {Array} matches - Array of PII matches from checkForPII
     * @returns {Array} - Consolidated matches with start/end positions
     */
    consolidatePIIMatches(matches) {
        if (!matches || !Array.isArray(matches)) {
            return [];
        }

        // Flatten matches from all PII types
        const allMatches = [];
        matches.forEach(piiType => {
            if (piiType.examples && Array.isArray(piiType.examples)) {
                piiType.examples.forEach(example => {
                    allMatches.push({
                        text: example,
                        type: piiType.type,
                        start: 0, // Will be calculated
                        end: 0    // Will be calculated
                    });
                });
            }
        });

        // Find positions of matches in the original text
        const text = this.lastCheckedText || '';
        const positionedMatches = [];

        allMatches.forEach(match => {
            const regex = new RegExp(this.escapeRegExp(match.text), 'gi');
            let result;
            while ((result = regex.exec(text)) !== null) {
                positionedMatches.push({
                    text: match.text,
                    type: match.type,
                    start: result.index,
                    end: result.index + match.text.length
                });
            }
        });

        // Sort by start position
        positionedMatches.sort((a, b) => a.start - b.start);

        // Consolidate overlapping and adjacent matches
        const consolidated = [];
        let i = 0;

        while (i < positionedMatches.length) {
            let current = positionedMatches[i];
            let j = i + 1;

            // Look for overlapping or adjacent matches
            while (j < positionedMatches.length) {
                const next = positionedMatches[j];
                
                // Check if matches overlap or are adjacent (within 1 character)
                if (next.start <= current.end + 1) {
                    // Merge the matches
                    current = {
                        text: text.substring(current.start, Math.max(current.end, next.end)),
                        type: current.type, // Keep the first type
                        start: current.start,
                        end: Math.max(current.end, next.end)
                    };
                    j++;
                } else {
                    break;
                }
            }

            // Clean up the merged text (remove medical prefixes)
            current.text = this.cleanMedicalPrefixes(current.text);
            
            consolidated.push(current);
            i = j;
        }

        console.log('[ANONYMISER] Consolidated matches:', consolidated);
        return consolidated;
    }

    /**
     * Get appropriate replacement for a PII match
     * @param {Object} match - PII match object
     * @returns {string} - Replacement text
     */
    getReplacementForMatch(match) {
        const type = match.type;
        
        // Define replacements based on PII type
        const replacements = {
            'names': '[NAME]',
            'singleNames': '[NAME]',
            'fullNames': '[FULL_NAME]',
            'emails': '[EMAIL]',
            'phones': '[PHONE]',
            'addresses': '[ADDRESS]',
            'dates': '[DATE]',
            'ages': '[AGE]',
            'postcodes': '[POSTCODE]',
            'nhsNumbers': '[NHS_NUMBER]',
            'hospitalNumbers': '[HOSPITAL_NUMBER]',
            'medicalIdentifiers': '[MEDICAL_ID]'
        };

        return replacements[type] || '[PII]';
    }

    /**
     * Escape special regex characters
     * @param {string} string - String to escape
     * @returns {string} - Escaped string
     */
    escapeRegExp(string) {
        return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    /**
     * Clean medical prefixes from names
     * @param {string} text - Text to clean
     * @returns {string} - Cleaned text
     */
    cleanMedicalPrefixes(text) {
        const medicalPrefixes = [
            'Patient', 'Dr.', 'Dr ', 'Doctor', 'Mr.', 'Mr ', 'Mrs.', 'Mrs ', 
            'Ms.', 'Ms ', 'Prof.', 'Professor', 'Consultant', 'Registrar'
        ];

        let cleaned = text;
        medicalPrefixes.forEach(prefix => {
            const regex = new RegExp(`^${this.escapeRegExp(prefix)}\\s+`, 'i');
            cleaned = cleaned.replace(regex, '');
        });

        return cleaned.trim();
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