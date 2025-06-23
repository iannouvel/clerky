// Import Firebase instances from firebase-init.js
import { app, db, auth } from './firebase-init.js';
import { GoogleAuthProvider, signInWithPopup, onAuthStateChanged, signOut, signInWithRedirect, getRedirectResult } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import { getAnalytics } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-analytics.js';
import { doc, getDoc, setDoc } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

// Make auth available globally - ADD THIS LINE
window.auth = auth;

// Global variable to store relevant guidelines
let relevantGuidelines = null;

// Function to display relevant guidelines in the summary
function displayRelevantGuidelines(categories) {
    if (!categories || typeof categories !== 'object') {
        console.error('[DEBUG] Invalid categories data:', categories);
        return;
    }

    // Helper function to abbreviate organization names
    function abbreviateOrganization(orgName) {
        if (!orgName) return '';
        
        const mapping = {
            // Major International Organizations
            'World Health Organization': 'WHO',
            'World Health Organisation': 'WHO',
            'WHO': 'WHO',
            
            // UK Organizations
            'Royal College of Obstetricians and Gynaecologists': 'RCOG',
            'Royal College of Obstetricians & Gynaecologists': 'RCOG',
            'RCOG': 'RCOG',
            'National Institute for Health and Care Excellence': 'NICE',
            'National Institute for Health and Clinical Excellence': 'NICE',
            'NICE': 'NICE',
            'British Medical Association': 'BMA',
            'BMA': 'BMA',
            'Royal College of Physicians': 'RCP',
            'RCP': 'RCP',
            'Royal College of Surgeons': 'RCS',
            'RCS': 'RCS',
            'Royal College of General Practitioners': 'RCGP',
            'RCGP': 'RCGP',
            'Royal College of Midwives': 'RCM',
            'RCM': 'RCM',
            'Royal College of Nursing': 'RCN',
            'RCN': 'RCN',
            
            // US Organizations
            'American College of Obstetricians and Gynecologists': 'ACOG',
            'American College of Obstetricians & Gynecologists': 'ACOG',
            'ACOG': 'ACOG',
            'American Medical Association': 'AMA',
            'AMA': 'AMA',
            'Centers for Disease Control and Prevention': 'CDC',
            'CDC': 'CDC',
            'Food and Drug Administration': 'FDA',
            'FDA': 'FDA',
            'American Academy of Pediatrics': 'AAP',
            'AAP': 'AAP',
            
            // European Organizations
            'European Society of Human Reproduction and Embryology': 'ESHRE',
            'ESHRE': 'ESHRE',
            'European Medicines Agency': 'EMA',
            'EMA': 'EMA',
            'European Society of Cardiology': 'ESC',
            'ESC': 'ESC',
            'International Federation of Gynecology and Obstetrics': 'FIGO',
            'International Federation of Gynaecology and Obstetrics': 'FIGO',
            'FIGO': 'FIGO',
            
            // Hospital Trusts and Local Organizations
            'University Hospitals Sussex NHS Foundation Trust': 'University Hospitals Sussex',
            'University Hospitals Sussex': 'University Hospitals Sussex',
            'Sussex University Hospitals': 'University Hospitals Sussex',
            'University Hospital Sussex': 'University Hospitals Sussex',
            'Brighton and Sussex University Hospitals': 'Brighton & Sussex UH',
            'Brighton & Sussex University Hospitals': 'Brighton & Sussex UH',
            'NHS Foundation Trust': 'NHS Trust',
            'Foundation Trust': 'NHS Trust',
            
            // Common Abbreviations and Variations
            'Department of Health': 'DOH',
            'Department of Health and Social Care': 'DHSC',
            'Public Health England': 'PHE',
            'Health and Safety Executive': 'HSE',
            'Medicines and Healthcare products Regulatory Agency': 'MHRA',
            'MHRA': 'MHRA',
            
            // Internal/Local Guidelines (make them more user-friendly)
            'Maternity Services': 'Maternity',
            'Obstetrics and Gynaecology': 'Obs & Gynae',
            'Obstetrics & Gynaecology': 'Obs & Gynae',
            'Emergency Department': 'Emergency Dept',
            'Accident and Emergency': 'A&E',
            'Intensive Care Unit': 'ICU',
            'Neonatal Intensive Care Unit': 'NICU',
            'Special Care Baby Unit': 'SCBU'
        };
        
        // Direct mapping first
        if (mapping[orgName]) {
            return mapping[orgName];
        }
        
        // Partial matching for complex names
        for (const [key, value] of Object.entries(mapping)) {
            if (orgName.toLowerCase().includes(key.toLowerCase()) || 
                key.toLowerCase().includes(orgName.toLowerCase())) {
                return value;
            }
        }
        
        // Special handling for internal codes and hospital names
        // Remove common suffixes that don't add value
        let cleaned = orgName
            .replace(/NHS Foundation Trust$/i, 'NHS Trust')
            .replace(/Foundation Trust$/i, 'NHS Trust')
            .replace(/University Hospitals?/i, 'UH')
            .replace(/Hospital Trust$/i, 'Hospital')
            .replace(/^(MP|CG|SP|MD|GP)\d+\s*-?\s*/i, '') // Remove internal codes like MP053, CG12004
            .trim();
        
        // If no match found, return the cleaned name (but truncated if too long)
        return cleaned.length > 25 ? cleaned.substring(0, 22) + '...' : cleaned;
    }

    // Helper function to extract numeric relevance score from descriptive format
    function extractRelevanceScore(relevanceText) {
        if (typeof relevanceText === 'number') {
            return relevanceText; // Already numeric
        }
        
        // Extract score from formats like "high relevance (score 0.8-1.0)" or "0.85"
        const match = relevanceText.match(/score\s+([\d.]+)(?:-[\d.]+)?|^([\d.]+)$/);
        if (match) {
            return parseFloat(match[1] || match[2]);
        }
        
        // Fallback based on text description
        const text = relevanceText.toLowerCase();
        if (text.includes('high') || text.includes('most')) return 0.9;
        if (text.includes('medium') || text.includes('potentially')) return 0.65;
        if (text.includes('low') || text.includes('less')) return 0.35;
        if (text.includes('not') || text.includes('irrelevant')) return 0.1;
        
        return 0.5; // Default fallback
    }

    // Store ALL relevant guidelines (exclude notRelevant) globally
    const allRelevantGuidelines = [
        ...(categories.mostRelevant || []).map(g => ({...g, category: 'mostRelevant'})),
        ...(categories.potentiallyRelevant || []).map(g => ({...g, category: 'potentiallyRelevant'})),
        ...(categories.lessRelevant || []).map(g => ({...g, category: 'lessRelevant'}))
        // Exclude notRelevant as they're truly not applicable for checking
    ];

    window.relevantGuidelines = allRelevantGuidelines.map(g => ({
        id: g.id, // Use clean document ID only
        title: g.title,
        filename: g.filename || g.title, // Keep both for compatibility
        originalFilename: g.originalFilename || g.title, // Preserve original filename if available
        downloadUrl: g.downloadUrl, // Preserve downloadUrl if available
        relevance: extractRelevanceScore(g.relevance), // Convert to numeric score
        category: g.category,
        originalRelevance: g.relevance, // Keep original for display purposes
        organisation: g.organisation // Preserve organisation for display
    }));

    // Enhanced logging to verify storage
    console.log('[DEBUG] Stored relevant guidelines:', {
        total: window.relevantGuidelines.length,
        byCategory: {
            mostRelevant: window.relevantGuidelines.filter(g => g.category === 'mostRelevant').length,
            potentiallyRelevant: window.relevantGuidelines.filter(g => g.category === 'potentiallyRelevant').length,
            lessRelevant: window.relevantGuidelines.filter(g => g.category === 'lessRelevant').length
        },
        samples: window.relevantGuidelines.slice(0, 3).map(g => ({
            id: g.id, // Use the mapped 'id' property
            title: g.title.substring(0, 50) + '...',
            score: g.relevance,
            category: g.category
        }))
    });

    let formattedGuidelines = '';

    // Helper function to create PDF download link
    function createPdfDownloadLink(guideline) {
        if (!guideline) {
            console.warn('[DEBUG] No guideline provided to createPdfDownloadLink');
            return '';
        }

        // Enhanced debugging - log the full guideline object structure
        console.log('[DEBUG] createPdfDownloadLink called with guideline:', {
            fullObject: guideline,
            allKeys: Object.keys(guideline),
            hasDownloadUrl: !!guideline.downloadUrl,
            hasOriginalFilename: !!guideline.originalFilename,
            hasFilename: !!guideline.filename,
            downloadUrlValue: guideline.downloadUrl,
            originalFilenameValue: guideline.originalFilename,
            filenameValue: guideline.filename,
            id: guideline.id,
            title: guideline.title
        });

        // Only use downloadUrl field if available
        let downloadUrl;
        if (guideline.downloadUrl) {
            downloadUrl = guideline.downloadUrl;
            console.log('[DEBUG] Using stored downloadUrl:', downloadUrl);
        } else if (guideline.originalFilename) {
            // Use original filename if available
            const encodedFilename = encodeURIComponent(guideline.originalFilename);
            downloadUrl = `https://github.com/iannouvel/clerky/raw/main/guidance/${encodedFilename}`;
            console.log('[DEBUG] Constructed downloadUrl from originalFilename:', downloadUrl);
        } else {
            // No reliable download information available - don't show a link
            console.warn('[DEBUG] No downloadUrl or originalFilename available for guideline:', {
                id: guideline.id,
                title: guideline.title,
                allAvailableFields: Object.keys(guideline),
                fullGuidelineObject: guideline
            });
            console.warn('[DEBUG] Database should provide downloadUrl or originalFilename field');
            return '';
        }
        
        console.log('[DEBUG] Created PDF download link:', {
            guidelineId: guideline.id,
            guidelineTitle: guideline.title,
            downloadUrl: downloadUrl
        });
        
        return `<a href="${downloadUrl}" target="_blank" title="Download PDF" class="pdf-download-link">📄</a>`;
    }

    // Generate HTML instead of markdown to properly handle the PDF links
    let htmlContent = '';

    // Add Most Relevant Guidelines
    if (categories.mostRelevant && categories.mostRelevant.length > 0) {
        htmlContent += '<h2>Most Relevant Guidelines</h2><ul>';
        categories.mostRelevant.forEach(g => {
            const pdfLink = createPdfDownloadLink(g);
            const standardizedTitle = standardizeGuidelineTitle(g.title, g.organisation);
            const orgDisplay = g.organisation ? ` - ${abbreviateOrganization(g.organisation)}` : '';
            htmlContent += `<li>${standardizedTitle}${orgDisplay} (${g.relevance}) ${pdfLink}</li>`;
        });
        htmlContent += '</ul>';
    }

    // Add Potentially Relevant Guidelines
    if (categories.potentiallyRelevant && categories.potentiallyRelevant.length > 0) {
        htmlContent += '<h2>Potentially Relevant Guidelines</h2><ul>';
        categories.potentiallyRelevant.forEach(g => {
            const pdfLink = createPdfDownloadLink(g);
            const standardizedTitle = standardizeGuidelineTitle(g.title, g.organisation);
            const orgDisplay = g.organisation ? ` - ${abbreviateOrganization(g.organisation)}` : '';
            htmlContent += `<li>${standardizedTitle}${orgDisplay} (${g.relevance}) ${pdfLink}</li>`;
        });
        htmlContent += '</ul>';
    }

    // Add Less Relevant Guidelines
    if (categories.lessRelevant && categories.lessRelevant.length > 0) {
        htmlContent += '<h2>Less Relevant Guidelines</h2><ul>';
        categories.lessRelevant.forEach(g => {
            const pdfLink = createPdfDownloadLink(g);
            const standardizedTitle = standardizeGuidelineTitle(g.title, g.organisation);
            const orgDisplay = g.organisation ? ` - ${abbreviateOrganization(g.organisation)}` : '';
            htmlContent += `<li>${standardizedTitle}${orgDisplay} (${g.relevance}) ${pdfLink}</li>`;
        });
        htmlContent += '</ul>';
    }

    // Add Not Relevant Guidelines
    if (categories.notRelevant && categories.notRelevant.length > 0) {
        htmlContent += '<h2>Not Relevant Guidelines</h2><ul>';
        categories.notRelevant.forEach(g => {
            const pdfLink = createPdfDownloadLink(g);
            const standardizedTitle = standardizeGuidelineTitle(g.title, g.organisation);
            const orgDisplay = g.organisation ? ` - ${abbreviateOrganization(g.organisation)}` : '';
            htmlContent += `<li>${standardizedTitle}${orgDisplay} (${g.relevance}) ${pdfLink}</li>`;
        });
        htmlContent += '</ul>';
    }

    formattedGuidelines = htmlContent;

    appendToSummary1(formattedGuidelines);
}

function createGuidelineElement(guideline) {
    const div = document.createElement('div');
    div.className = 'guideline-item';
    div.innerHTML = `
                            <h4>${guideline.humanFriendlyTitle || guideline.title}</h4>
        <p>Relevance: ${(guideline.relevance * 100).toFixed(1)}%</p>
        <button onclick="checkAgainstGuidelines('${guideline.id}')">Check Against This Guideline</button>
    `;
    return div;
}

// Application state flags
let isInitialized = false;
let clinicalIssuesLoaded = false;
let guidanceDataLoaded = false;

// Clinical data storage
let clinicalIssues = {
    obstetrics: [],
    gynecology: []
};
let AIGeneratedListOfIssues = [];
let guidelinesForEachIssue = [];

// File and content storage
let filenames = [];
let summaries = [];

// Global data storage
let globalGuidelines = null;
let globalPrompts = null;

// Chat History State
let chatHistory = [];
let currentChatId = null;

// Add session management
let currentSessionId = null;

// Global variables for dynamic advice
let currentAdviceSession = null;
let currentSuggestions = [];
let userDecisions = {};

// Initialize marked library
function initializeMarked() {
    console.log('Starting marked library initialization...');
    return new Promise((resolve, reject) => {
        if (window.marked) {
            console.log('Marked library already loaded');
            resolve();
            return;
        }

        console.log('Creating marked script element...');
        const markedScript = document.createElement('script');
        markedScript.src = 'https://cdn.jsdelivr.net/npm/marked/marked.min.js';
        markedScript.onload = function() {
            console.log('Marked script loaded successfully');
            window.marked = marked;
            console.log('Marked library initialized');
            resolve();
        };
        markedScript.onerror = function(error) {
            console.error('Error loading marked library:', error);
            reject(error);
        };
        console.log('Appending marked script to document head...');
        document.head.appendChild(markedScript);
    });
}

// Make loadClinicalIssues available globally
window.loadClinicalIssues = async function() {
    console.log('Starting loadClinicalIssues...');
    if (clinicalIssuesLoaded) {
        console.log('Clinical issues already loaded');
        return;
    }

    try {
        console.log('Fetching clinical_issues.json...');
        const response = await fetch('clinical_issues.json');
        console.log('Fetch response status:', response.status);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        console.log('Parsing JSON response...');
        const data = await response.json();
        console.log('Clinical issues data loaded:', data);
        clinicalIssues = data;
        clinicalIssuesLoaded = true;
        console.log('Clinical issues loaded successfully');
    } catch (error) {
        console.error('Error loading clinical issues:', error);
        throw error;
    }
};

// Show main content
function showMainContent() {
    console.log('Starting showMainContent...');
    const loading = document.getElementById('loading');
    const landingPage = document.getElementById('landingPage');
    const mainContent = document.getElementById('mainContent');

    console.log('Elements found:', {
        loading: !!loading,
        landingPage: !!landingPage,
        mainContent: !!mainContent
    });

    if (loading) {
        console.log('Hiding loading screen...');
        loading.classList.add('hidden');
    }
    if (landingPage) {
        console.log('Hiding landing page...');
        landingPage.classList.add('hidden');
    }
    if (mainContent) {
        console.log('Showing main content...');
        mainContent.classList.remove('hidden');
    }
}

// Update loadGuidelinesFromFirestore to load from Firestore
async function getGitHubGuidelinesCount() {
    try {
        console.log('[DEBUG] Getting GitHub guidelines count...');
        
        const user = auth.currentUser;
        if (!user) {
            throw new Error('User not authenticated');
        }
        const idToken = await user.getIdToken();

        const response = await fetch(`${window.SERVER_URL}/getGuidelinesList`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${idToken}`
            }
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const guidelinesString = await response.text();
        const guidelinesList = guidelinesString.split('\n').filter(line => line.trim());
        console.log('[DEBUG] GitHub guidelines count:', guidelinesList.length);
        return guidelinesList.length;
    } catch (error) {
        console.error('[DEBUG] Error getting GitHub guidelines count:', error);
        return null; // Return null on error to avoid triggering sync
    }
}

// Function to check if a guideline has complete metadata
function checkMetadataCompleteness(guideline) {
    const essentialFields = [
        'humanFriendlyName',
        'organisation',
        'yearProduced',
        'title',
        'summary',
        'keywords'
    ];
    
    const missingFields = [];
    const incompleteFields = [];
    
    essentialFields.forEach(field => {
        const value = guideline[field];
        if (!value || value === 'N/A' || value === 'Not available' || value === '' || value === null || value === undefined) {
            missingFields.push(field);
        } else if (typeof value === 'string' && value.length < 3) {
            incompleteFields.push(field);
        } else if (Array.isArray(value) && value.length === 0) {
            incompleteFields.push(field);
        }
    });
    
    return {
        isComplete: missingFields.length === 0 && incompleteFields.length === 0,
        missingFields,
        incompleteFields,
        completenessScore: ((essentialFields.length - missingFields.length - incompleteFields.length) / essentialFields.length) * 100
    };
}

// Function to automatically enhance metadata for guidelines with gaps
async function autoEnhanceIncompleteMetadata(guidelines, options = {}) {
    const { 
        maxConcurrent = 3, 
        minCompleteness = 70, 
        dryRun = false,
        onProgress = null 
    } = options;
    
    // Blacklist of guidelines with known content extraction issues
    const PROBLEMATIC_GUIDELINES = [
        'piis0002937822004781-pdf',  // PDF extraction fails - corrupted or protected PDF
        'PIIS0002937822004781',      // Alternative ID format
        // Add more problematic guidelines here as discovered
    ];
    
    // Prevent multiple concurrent enhancement runs in the same session
    if (window.enhancementInProgress) {
        console.log('[METADATA] Enhancement already in progress, skipping...');
        return {
            success: true,
            message: 'Enhancement already in progress',
            processed: 0,
            enhanced: 0
        };
    }
    
    window.enhancementInProgress = true;
    
    try {
        console.log('[METADATA] Starting automatic metadata enhancement...');
        
        // Identify guidelines that need enhancement
        const guidelinesNeedingEnhancement = guidelines.filter(guideline => {
            // Skip blacklisted guidelines
            if (PROBLEMATIC_GUIDELINES.includes(guideline.id) || 
                PROBLEMATIC_GUIDELINES.includes(guideline.title) ||
                PROBLEMATIC_GUIDELINES.includes(guideline.filename) ||
                PROBLEMATIC_GUIDELINES.includes(guideline.originalFilename)) {
                console.log(`[METADATA] Skipping blacklisted guideline: ${guideline.title || guideline.id}`);
                return false;
            }
            
            const completeness = checkMetadataCompleteness(guideline);
            
            // Skip if already processed recently (using multiple fields for tracking)
            const lastEnhanced = guideline.lastMetadataEnhancement || guideline.lastUpdated || guideline.dateAdded;
            if (lastEnhanced) {
                const daysSinceEnhancement = (Date.now() - new Date(lastEnhanced).getTime()) / (1000 * 60 * 60 * 24);
                if (daysSinceEnhancement < 1 && completeness.completenessScore >= minCompleteness) { // Reduced from 7 days to 1 day
                    console.log(`[METADATA] Skipping ${guideline.title || guideline.id} - enhanced recently and complete (${completeness.completenessScore.toFixed(1)}%)`);
                    return false;
                }
            }
            
            // Also skip if completeness is already good enough
            if (completeness.completenessScore >= minCompleteness) {
                console.log(`[METADATA] Skipping ${guideline.title || guideline.id} - already complete (${completeness.completenessScore.toFixed(1)}%)`);
                return false;
            }
            
            return true;
        });
        
        if (guidelinesNeedingEnhancement.length === 0) {
            console.log('[METADATA] All guidelines have complete metadata');
            return {
                success: true,
                message: 'All guidelines have complete metadata',
                processed: 0,
                enhanced: 0
            };
        }
        
        console.log(`[METADATA] Found ${guidelinesNeedingEnhancement.length} guidelines needing enhancement`);
        
        if (dryRun) {
            const report = guidelinesNeedingEnhancement.map(g => {
                const completeness = checkMetadataCompleteness(g);
                return {
                    id: g.id,
                    title: g.title,
                    completenessScore: completeness.completenessScore,
                    missingFields: completeness.missingFields,
                    incompleteFields: completeness.incompleteFields
                };
            });
            
            console.log('[METADATA] Dry run report:', report);
            return {
                success: true,
                message: `Dry run: ${guidelinesNeedingEnhancement.length} guidelines would be enhanced`,
                dryRunReport: report
            };
        }
        
        let processed = 0;
        let enhanced = 0;
        const errors = [];
        
        // Process guidelines in batches to avoid overwhelming the server
        for (let i = 0; i < guidelinesNeedingEnhancement.length; i += maxConcurrent) {
            const batch = guidelinesNeedingEnhancement.slice(i, i + maxConcurrent);
            
            const batchPromises = batch.map(async (guideline) => {
                try {
                    console.log(`[METADATA] Enhancing metadata for: ${guideline.title || guideline.id}`);
                    
                    if (onProgress) {
                        onProgress({
                            current: processed + 1,
                            total: guidelinesNeedingEnhancement.length,
                            guideline: guideline.title || guideline.id
                        });
                    }
                    
                    // Check what fields are missing
                    const completeness = checkMetadataCompleteness(guideline);
                    const fieldsToEnhance = [...completeness.missingFields, ...completeness.incompleteFields];
                    
                    // Call the enhancement function
                    await enhanceGuidelineMetadata(guideline.id, fieldsToEnhance);
                    enhanced++;
                    
                    console.log(`[METADATA] Successfully enhanced: ${guideline.title || guideline.id}`);
                    
                                 } catch (error) {
                     console.error(`[METADATA] Error enhancing ${guideline.title || guideline.id}:`, error);
                     
                     // Check if it's a "no content" error and handle gracefully
                     if (error.message && error.message.includes('No content available for AI analysis')) {
                         console.log(`[METADATA] Skipping ${guideline.title || guideline.id} - no content available for analysis`);
                     } else {
                         errors.push({
                             guidelineId: guideline.id,
                             title: guideline.title,
                             error: error.message
                         });
                     }
                 }
                
                processed++;
            });
            
            // Wait for batch to complete
            await Promise.all(batchPromises);
            
            // Small delay between batches to avoid rate limiting
            if (i + maxConcurrent < guidelinesNeedingEnhancement.length) {
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }
        
        console.log(`[METADATA] Enhancement complete: ${enhanced}/${processed} guidelines enhanced`);
        
        return {
            success: true,
            message: `Enhanced ${enhanced} out of ${processed} guidelines`,
            processed,
            enhanced,
            errors: errors.length > 0 ? errors : undefined
        };
        
    } catch (error) {
        console.error('[METADATA] Error in auto enhancement:', error);
        return {
            success: false,
            error: error.message
        };
    } finally {
        // Always clear the in-progress flag
        window.enhancementInProgress = false;
    }
}

async function loadGuidelinesFromFirestore() {
    try {
        console.log('[DEBUG] Loading guidelines from Firestore...');
        
        // Get user ID token using the imported auth object
        const user = auth.currentUser;
        if (!user) {
            throw new Error('User not authenticated');
        }
        const idToken = await user.getIdToken();

        // Fetch guidelines from Firestore
        const response = await fetch(`${window.SERVER_URL}/getAllGuidelines`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${idToken}`
            }
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const result = await response.json();
        if (!result.success || !result.guidelines) {
            throw new Error('Invalid response format from server');
        }

        const guidelines = result.guidelines;
        const firestoreCount = guidelines.length;
        console.log('[DEBUG] Loaded guidelines from Firestore:', firestoreCount);

        // Check if we need to sync more guidelines from GitHub
        const githubCount = await getGitHubGuidelinesCount();
        if (githubCount !== null && githubCount > firestoreCount) {
            console.log(`[DEBUG] GitHub has ${githubCount} guidelines but Firestore only has ${firestoreCount}. Triggering sync...`);
            
            try {
                const syncResponse = await fetch(`${window.SERVER_URL}/syncGuidelinesWithMetadata`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${idToken}`
                    },
                    body: JSON.stringify({})
                });

                if (syncResponse.ok) {
                    const syncResult = await syncResponse.json();
                    console.log('[DEBUG] Sync completed successfully:', syncResult);
                    
                    // Reload guidelines after sync
                    const updatedResponse = await fetch(`${window.SERVER_URL}/getAllGuidelines`, {
                        method: 'GET',
                        headers: {
                            'Authorization': `Bearer ${idToken}`
                        }
                    });
                    
                    if (updatedResponse.ok) {
                        const updatedResult = await updatedResponse.json();
                        if (updatedResult.success && updatedResult.guidelines) {
                            const updatedGuidelines = updatedResult.guidelines;
                            console.log('[DEBUG] Reloaded guidelines after sync:', updatedGuidelines.length);
                            
                            // Use the updated guidelines
                            guidelines.length = 0; // Clear the array
                            guidelines.push(...updatedGuidelines); // Add updated guidelines
                        }
                    }
                } else {
                    const syncError = await syncResponse.text();
                    console.warn('[DEBUG] Sync failed:', syncError);
                }
            } catch (syncError) {
                console.warn('[DEBUG] Sync error:', syncError);
            }
        } else if (githubCount !== null) {
            console.log(`[DEBUG] Guidelines count is up to date: GitHub=${githubCount}, Firestore=${firestoreCount}`);
        }

        // NEW: Check metadata completeness for all guidelines
        console.log('[METADATA] Checking metadata completeness...');
        let incompleteCount = 0;
        let totalCompletenessScore = 0;
        
        guidelines.forEach(guideline => {
            const completeness = checkMetadataCompleteness(guideline);
            totalCompletenessScore += completeness.completenessScore;
            
            if (!completeness.isComplete) {
                incompleteCount++;
                console.log(`[METADATA] Incomplete metadata for "${guideline.title || guideline.id}": ${completeness.completenessScore.toFixed(1)}% complete`, {
                    missing: completeness.missingFields,
                    incomplete: completeness.incompleteFields
                });
            }
        });
        
        const averageCompleteness = guidelines.length > 0 ? totalCompletenessScore / guidelines.length : 0;
        console.log(`[METADATA] Metadata completeness summary: ${incompleteCount}/${guidelines.length} guidelines need enhancement (average: ${averageCompleteness.toFixed(1)}%)`);
        
        // NEW: Check content status and offer repair if needed
        const contentStatus = checkContentStatus(guidelines);
        console.log('[CONTENT_STATUS] Content analysis:', contentStatus.stats);
        
        // Alert user if significant content issues are found
        const contentIssueThreshold = Math.max(5, Math.floor(guidelines.length * 0.1)); // 10% or minimum 5 guidelines
        const hasSignificantContentIssues = contentStatus.stats.missingBoth > contentIssueThreshold || 
                                           contentStatus.stats.nullContent > contentIssueThreshold * 2;
        
        if (hasSignificantContentIssues) {
            console.warn('[CONTENT_STATUS] Significant content issues detected:', {
                nullContent: contentStatus.stats.nullContent,
                nullCondensed: contentStatus.stats.nullCondensed,
                missingBoth: contentStatus.stats.missingBoth,
                threshold: contentIssueThreshold
            });
            
            // Show content repair option
            showMetadataProgress(`⚠️ Found ${contentStatus.stats.missingBoth} guidelines missing content - repair available`, false);
            
            // Add repair button to the interface
            setTimeout(() => {
                const repairHtml = `
                    <div id="content-repair-notice" style="background: #fff3cd; border: 1px solid #ffeaa7; padding: 15px; margin: 10px 0; border-radius: 5px;">
                        <h4 style="color: #856404; margin: 0 0 10px 0;">⚠️ Content Issues Detected</h4>
                        <p style="margin: 0 0 10px 0; color: #856404;">
                            Found <strong>${contentStatus.stats.nullContent}</strong> guidelines with missing content and 
                            <strong>${contentStatus.stats.nullCondensed}</strong> with missing condensed text.
                            Only <strong>${contentStatus.stats.fullyPopulated}</strong> out of <strong>${contentStatus.stats.total}</strong> guidelines are fully populated.
                        </p>
                        <p style="margin: 0 0 15px 0; color: #856404;">
                            This severely impacts AI analysis quality. The repair process will extract text from PDFs and generate condensed versions automatically.
                        </p>
                        <button onclick="diagnoseAndRepairContent()" style="background: #28a745; color: white; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer;">
                            🔧 Repair Content Issues
                        </button>
                        <button onclick="document.getElementById('content-repair-notice').style.display='none'" style="background: #6c757d; color: white; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer; margin-left: 10px;">
                            Dismiss
                        </button>
                    </div>
                `;
                
                // Try to add the repair notice to the summary area
                const summary1 = document.getElementById('summary1');
                if (summary1 && !document.getElementById('content-repair-notice')) {
                    summary1.insertAdjacentHTML('afterbegin', repairHtml);
                }
            }, 1000);
        } else {
            console.log('[CONTENT_STATUS] Content quality looks good:', {
                fullyPopulated: contentStatus.stats.fullyPopulated,
                percentComplete: Math.round((contentStatus.stats.fullyPopulated / contentStatus.stats.total) * 100)
            });
        }
        
                 // NEW: Automatically enhance metadata for guidelines with low completeness
         if (incompleteCount > 0) {
             console.log('[METADATA] Starting background metadata enhancement...');
             
             // Log progress instead of showing notification (to prevent any popup issues)
             console.log(`[METADATA] Starting enhancement for ${incompleteCount} guidelines...`);
             
             // Run enhancement in background without blocking the UI
             autoEnhanceIncompleteMetadata(guidelines, {
                 maxConcurrent: 1, // Very conservative to avoid quota issues
                 minCompleteness: 60, // Only enhance if less than 60% complete
                 onProgress: (progress) => {
                     console.log(`[METADATA] Progress: ${progress.current}/${progress.total} - ${progress.guideline}`);
                     // Temporarily disable progress notifications to prevent any popup issues
                     // showMetadataProgress(`Enhancing ${progress.current}/${progress.total}: ${progress.guideline.substring(0, 30)}...`);
                 }
             }).then(result => {
                 if (result.success && result.enhanced > 0) {
                     console.log(`[METADATA] Background enhancement completed: ${result.message}`);
                     showMetadataProgress(`✓ Enhanced ${result.enhanced} guidelines`, true);
                     
                     // Enhancement completed - no need to reload as data is already updated in Firestore
                     // Note: Avoiding recursive reload to prevent infinite enhancement loops
                 } else {
                     showMetadataProgress('All guidelines already have complete metadata', true);
                 }
             }).catch(enhancementError => {
                 console.error('[METADATA] Background enhancement failed:', enhancementError);
                 showMetadataProgress('⚠ Metadata enhancement failed', true);
             });
         }

        // Store in global variables using document ID as key
        window.guidelinesList = guidelines.map(g => ({
            id: g.id,
            title: g.title
        }));
        window.guidelinesSummaries = guidelines.map(g => g.summary);
        window.guidelinesKeywords = guidelines.map(g => g.keywords);
        window.guidelinesCondensed = guidelines.map(g => g.condensed);

        // Store full guideline data using document ID as key
        window.globalGuidelines = guidelines.reduce((acc, g) => {
            acc[g.id] = {
                id: g.id,
                title: g.title,
                content: g.content,
                summary: g.summary,
                keywords: g.keywords,
                condensed: g.condensed,
                organisation: g.organisation
            };
            return acc;
        }, {});

        console.log('[DEBUG] Guidelines loaded and stored in global variables');
        return guidelines;
    } catch (error) {
        console.error('[DEBUG] Error loading guidelines from Firestore:', error);
        throw error;
    }
}

// Make loadGuidelinesFromFirestore available globally
window.loadGuidelinesFromFirestore = loadGuidelinesFromFirestore;

// Function to show error messages
function showError(message) {
    alert(message);
    console.error('Error:', message);
}

async function findRelevantGuidelines(suppressHeader = false) {
    const findGuidelinesBtn = document.getElementById('findGuidelinesBtn');
    const originalText = findGuidelinesBtn.textContent;
    
    try {
        const transcript = document.getElementById('userInput').value;
        if (!transcript) {
            alert('Please enter some text first');
            return;
        }

        // Set loading state
        findGuidelinesBtn.classList.add('loading');
        findGuidelinesBtn.disabled = true;

        // Initialize the guideline search summary (unless called from process workflow)
        if (!suppressHeader) {
            let searchProgress = '## Finding Relevant Guidelines\n\n';
            appendToSummary1(searchProgress);
        }

        // Get user ID token
        const user = auth.currentUser;
        if (!user) {
            alert('Please sign in to use this feature');
            return;
        }
        const idToken = await user.getIdToken();

        // Update progress
        const loadingMessage = 'Loading guidelines from database...\n';
        appendToSummary1(loadingMessage, false);

        // Get guidelines and summaries from Firestore
        const guidelines = await loadGuidelinesFromFirestore();
        
        console.log('[DEBUG] Sample guideline from Firestore before processing:', {
            sampleGuideline: guidelines[0],
            allKeys: guidelines[0] ? Object.keys(guidelines[0]) : 'no guidelines',
            hasDownloadUrl: !!(guidelines[0] && guidelines[0].downloadUrl),
            downloadUrlValue: guidelines[0] ? guidelines[0].downloadUrl : 'no guideline'
        });
        
        // Format guidelines with comprehensive information for better relevancy matching
        // PRESERVE downloadUrl and other important fields for the server
        const guidelinesList = guidelines.map(g => ({
            id: g.id,
            title: g.title,
            summary: g.summary,
            condensed: g.condensed,
            keywords: g.keywords,
            downloadUrl: g.downloadUrl, // Important: preserve downloadUrl
            originalFilename: g.originalFilename, // Important: preserve originalFilename  
            filename: g.filename, // Important: preserve filename
            organisation: g.organisation // Important: preserve organisation for display
        }));
        
        console.log('[DEBUG] Sample guideline being sent to server:', {
            sampleGuideline: guidelinesList[0],
            allKeys: guidelinesList[0] ? Object.keys(guidelinesList[0]) : 'no guidelines',
            hasDownloadUrl: !!(guidelinesList[0] && guidelinesList[0].downloadUrl),
            downloadUrlValue: guidelinesList[0] ? guidelinesList[0].downloadUrl : 'no most relevant'
        });

        // Update progress with guideline count
        const analyzeMessage = `Analysing transcript against ${guidelinesList.length} available guidelines...\n`;
        appendToSummary1(analyzeMessage, false);

        console.log('[DEBUG] Sending request to /findRelevantGuidelines with:', {
            transcriptLength: transcript.length,
            guidelinesCount: guidelinesList.length
        });

        const response = await fetch(`${window.SERVER_URL}/findRelevantGuidelines`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${idToken}`
            },
            body: JSON.stringify({
                transcript,
                guidelines: guidelinesList
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('[DEBUG] Server error response:', {
                status: response.status,
                statusText: response.statusText,
                errorText
            });
            throw new Error(`Server error: ${response.status} - ${errorText}`);
        }

        const data = await response.json();
        if (!data.success) {
            throw new Error(data.error || 'Failed to find relevant guidelines');
        }

        console.log('[DEBUG] Server response categories structure:', {
            categories: data.categories,
            mostRelevantCount: data.categories.mostRelevant?.length || 0,
            sampleMostRelevant: data.categories.mostRelevant?.[0],
            sampleKeys: data.categories.mostRelevant?.[0] ? Object.keys(data.categories.mostRelevant[0]) : 'no most relevant',
            hasDownloadUrl: !!(data.categories.mostRelevant?.[0] && data.categories.mostRelevant[0].downloadUrl),
            downloadUrlValue: data.categories.mostRelevant?.[0] ? data.categories.mostRelevant[0].downloadUrl : 'no most relevant'
        });

        // Update progress with completion
        const completionMessage = 'Analysis complete! Categorising relevant guidelines...\n\n';
        appendToSummary1(completionMessage, false);

        // Process and display the results
        displayRelevantGuidelines(data.categories);

        // Add final summary
        const totalRelevant = (data.categories.mostRelevant?.length || 0) + 
                            (data.categories.potentiallyRelevant?.length || 0) + 
                            (data.categories.lessRelevant?.length || 0);
        
        const summaryMessage = `## Summary\n\nFound ${totalRelevant} relevant guidelines out of ${guidelinesList.length} total guidelines.\n\n` +
                              `**Most Relevant:** ${data.categories.mostRelevant?.length || 0} guidelines\n` +
                              `**Potentially Relevant:** ${data.categories.potentiallyRelevant?.length || 0} guidelines\n` +
                              `**Less Relevant:** ${data.categories.lessRelevant?.length || 0} guidelines\n\n` +
                              `💡 **Tip:** Click on the 📄 PDF links next to any guideline to download the full document.\n\n` +
                              `Guidelines are now ready for analysis. Use "Check against guidelines" to proceed.\n`;
        
        appendToSummary1(summaryMessage, false);
    } catch (error) {
        console.error('[DEBUG] Error in findRelevantGuidelines:', {
            error: error.message,
            stack: error.stack
        });
        
        // Display error in summary1
        const errorMessage = `\n❌ **Error finding relevant guidelines:** ${error.message}\n\nPlease try again or contact support if the problem persists.\n`;
        appendToSummary1(errorMessage, false);
        
        alert('Error finding relevant guidelines: ' + error.message);
    } finally {
        // Reset button state
        findGuidelinesBtn.classList.remove('loading');
        findGuidelinesBtn.textContent = originalText;
        findGuidelinesBtn.disabled = false;
    }
}

// Function to generate clinical note
async function generateClinicalNote() {
    console.log('[DEBUG] Starting generateClinicalNote function');
    const button = document.getElementById('generateClinicalNoteBtn');
    const originalText = button.textContent;
    button.textContent = 'Generating...';
    button.disabled = true;

    try {
        // Get the transcript content from either summary1 or userInput
        let transcript = document.getElementById('summary1')?.textContent;
        const userInput = document.getElementById('userInput')?.value;
        
        console.log('[DEBUG] Checking transcript sources:', {
            summary1Length: transcript?.length,
            userInputLength: userInput?.length,
            summary1Preview: transcript?.substring(0, 100) + '...',
            userInputPreview: userInput?.substring(0, 100) + '...'
        });

        // Use userInput if summary1 is empty
        if ((!transcript || transcript.trim() === '') && userInput && userInput.trim() !== '') {
            console.log('[DEBUG] Using content from userInput field');
            transcript = userInput;
        }

        if (!transcript || transcript.trim() === '') {
            console.error('[DEBUG] No transcript content found in either source');
            throw new Error('No transcript found or transcript is empty');
        }

        // Get the current user using imported auth object
        const user = auth.currentUser;
        if (!user) {
            console.error('[DEBUG] No authenticated user found');
            throw new Error('User not authenticated');
        }
        console.log('[DEBUG] User authenticated:', {
            email: user.email,
            uid: user.uid
        });

        // Get ID token for authentication
        const idToken = await user.getIdToken();
        console.log('[DEBUG] Got ID token');

        console.log('[DEBUG] Sending request to server...');
        const response = await fetch(`${window.SERVER_URL}/generateClinicalNote`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${idToken}`
            },
            body: JSON.stringify({ transcript })
        });

        console.log('[DEBUG] Server response status:', response.status);
        if (!response.ok) {
            const errorText = await response.text();
            console.error('[DEBUG] Server response error:', {
                status: response.status,
                errorText
            });
            throw new Error(`Failed to generate clinical note: ${response.status} ${errorText}`);
        }

        const data = await response.json();
        console.log('[DEBUG] Server response data:', {
            success: data.success,
            noteLength: data.note?.length
        });

        if (!data.success || !data.note) {
            console.error('[DEBUG] Invalid response format:', data);
            throw new Error('Invalid response format from server');
        }

        // Append the generated note to summary1
        console.log('[DEBUG] Appending note to summary1');
        appendToSummary1(marked.parse(data.note), false);
        console.log('[DEBUG] Note appended successfully');

    } catch (error) {
        console.error('[DEBUG] Error in generateClinicalNote:', {
            error: error.message,
            stack: error.stack
        });
        alert(`Error generating clinical note: ${error.message}`);
    } finally {
        // Reset button state
        button.textContent = originalText;
        button.disabled = false;
        console.log('[DEBUG] generateClinicalNote function completed');
    }
}

// Function to append content to summary1
// Debounced scrolling to handle rapid successive content additions
let scrollTimeout = null;
let pendingScrollTarget = null;

function appendToSummary1(content, clearExisting = false) {
    console.log('[DEBUG] appendToSummary1 called with:', {
        contentLength: content?.length,
        clearExisting,
        contentPreview: content?.substring(0, 100) + '...'
    });

    const summary1 = document.getElementById('summary1');
    if (!summary1) {
        console.error('[DEBUG] summary1 element not found');
        return;
    }

    try {
        // Store the initial scroll position if not clearing existing content
        const initialScrollTop = clearExisting ? 0 : summary1.scrollTop;
        const initialScrollHeight = clearExisting ? 0 : summary1.scrollHeight;

        // Clear existing content if requested
        if (clearExisting) {
            summary1.innerHTML = '';
            // Reset scroll tracking when clearing content
            pendingScrollTarget = null;
            if (scrollTimeout) {
                clearTimeout(scrollTimeout);
                scrollTimeout = null;
            }
        }

        // Check if content is already HTML
        const isHtml = /<[a-z][\s\S]*>/i.test(content);
        console.log('[DEBUG] Content type check:', { isHtml });

        let processedContent;
        if (isHtml) {
            // If content is already HTML, use it directly
            processedContent = content;
        } else {
            // If content is markdown, parse it with marked
            if (!window.marked) {
                console.error('[DEBUG] Marked library not loaded');
                processedContent = content;
            } else {
                try {
                    processedContent = window.marked.parse(content);
                    console.log('[DEBUG] Marked parsing successful');
                } catch (parseError) {
                    console.error('[DEBUG] Error parsing with marked:', parseError);
                    processedContent = content;
                }
            }
        }

        // Create a temporary container to sanitize the content
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = processedContent;

        // Create a wrapper div for the new content to help with scrolling
        const newContentWrapper = document.createElement('div');
        newContentWrapper.className = 'new-content-entry';
        newContentWrapper.innerHTML = tempDiv.innerHTML;

        // Append the sanitized content
        summary1.appendChild(newContentWrapper);
        console.log('[DEBUG] Content appended successfully');

        // Store the first new content element for scrolling (if we don't have one yet)
        if (!pendingScrollTarget || clearExisting) {
            pendingScrollTarget = newContentWrapper;
            console.log('[DEBUG] Set new scroll target');
        }

        // Clear any existing scroll timeout
        if (scrollTimeout) {
            clearTimeout(scrollTimeout);
        }

        // Set up debounced scrolling - only scroll after content additions have stopped for 300ms
        scrollTimeout = setTimeout(() => {
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    try {
                        // If clearing existing content, scroll to top
                        if (clearExisting) {
                            summary1.scrollTop = 0;
                            console.log('[DEBUG] Scrolled to top (cleared existing content)');
                        } else if (pendingScrollTarget) {
                            // Calculate the scroll position to show the top of the first new content
                            const newContentOffsetTop = pendingScrollTarget.offsetTop;
                            const containerHeight = summary1.clientHeight;
                            
                            // Position the scroll so the top of the new content is visible
                            // Add a small buffer (20px) to ensure it's clearly visible
                            const targetScrollTop = Math.max(0, newContentOffsetTop - 20);
                            
                            summary1.scrollTop = targetScrollTop;
                            
                            console.log('[DEBUG] Debounced scroll to show top of first new content:', {
                                newContentOffsetTop,
                                containerHeight,
                                targetScrollTop,
                                finalScrollTop: summary1.scrollTop,
                                summary1ScrollHeight: summary1.scrollHeight
                            });
                        }

                        // Reset the scroll target after scrolling
                        pendingScrollTarget = null;
                        scrollTimeout = null;

                    } catch (scrollError) {
                        console.error('[DEBUG] Error in debounced scroll:', scrollError);
                        // Simple fallback
                        try {
                            if (!clearExisting && pendingScrollTarget) {
                                const maxScroll = summary1.scrollHeight - summary1.clientHeight;
                                const newContentHeight = pendingScrollTarget.offsetHeight;
                                const targetScroll = Math.max(0, maxScroll - newContentHeight - 50);
                                summary1.scrollTop = targetScroll;
                                console.log('[DEBUG] Fallback scroll completed');
                            }
                        } catch (fallbackError) {
                            console.error('[DEBUG] Fallback scroll also failed:', fallbackError);
                        }
                        
                        // Reset tracking even if scroll failed
                        pendingScrollTarget = null;
                        scrollTimeout = null;
                    }
                });
            });
        }, 300); // Wait 300ms after the last content addition before scrolling

    } catch (error) {
        console.error('[DEBUG] Error in appendToSummary1:', error);
        // Fallback to direct content append if something goes wrong
        summary1.innerHTML += content;
    }
}

// Update checkAgainstGuidelines to use stored relevant guidelines
async function checkAgainstGuidelines(suppressHeader = false) {
    const checkGuidelinesBtn = document.getElementById('checkGuidelinesBtn');
    const originalText = checkGuidelinesBtn.textContent;
    
    try {
        console.log('[DEBUG] Starting checkAgainstGuidelines...');
        
        const transcript = document.getElementById('userInput').value;
        if (!transcript) {
            console.log('[DEBUG] No transcript found in userInput');
            alert('Please enter some text first');
            return;
        }
        console.log('[DEBUG] Transcript length:', transcript.length);

        if (!window.relevantGuidelines || window.relevantGuidelines.length === 0) {
            console.log('[DEBUG] No relevant guidelines found in window.relevantGuidelines');
            console.log('[DEBUG] window.relevantGuidelines:', window.relevantGuidelines);
            alert('Please find relevant guidelines first');
            return;
        }
        console.log('[DEBUG] Number of relevant guidelines:', window.relevantGuidelines.length);

        // Set loading state
        checkGuidelinesBtn.classList.add('loading');
        checkGuidelinesBtn.disabled = true;

        // Get user ID token
        const user = auth.currentUser;
        if (!user) {
            console.log('[DEBUG] No authenticated user found');
            alert('Please sign in to use this feature');
            return;
        }
        console.log('[DEBUG] User authenticated:', { email: user.email, uid: user.uid });
        
        const idToken = await user.getIdToken();
        console.log('[DEBUG] Got ID token');

        // Check if guidelines are loaded in cache
        console.log('[DEBUG] Checking guideline cache status:', {
            hasGlobalGuidelines: !!window.globalGuidelines,
            cacheSize: window.globalGuidelines ? Object.keys(window.globalGuidelines).length : 0,
            cacheKeys: window.globalGuidelines ? Object.keys(window.globalGuidelines) : []
        });

        // Reload guidelines from Firestore to ensure we have the latest data
        try {
            console.log('[DEBUG] Reloading guidelines from Firestore...');
            const guidelines = await window.loadGuidelinesFromFirestore();
            console.log('[DEBUG] Reloaded guidelines from Firestore:', {
                success: !!guidelines,
                count: guidelines?.length || 0
            });
        } catch (error) {
            console.error('[DEBUG] Failed to reload guidelines:', error);
            throw new Error('Failed to load guidelines from Firestore');
        }

        // Initialize the analysis summary (unless called from process workflow)
        let formattedAnalysis = '';
        if (!suppressHeader) {
            formattedAnalysis = '## Analysis Against Guidelines\n\n';
            appendToSummary1(formattedAnalysis);
        }
        
        let successCount = 0;
        let errorCount = 0;

        // Helper function to find guideline by multiple matching criteria
        function findGuidelineInCache(targetGuideline) {
            // Method 1: Direct key lookup (original method)
            let found = window.globalGuidelines[targetGuideline.id];
            if (found) {
                console.log(`[DEBUG] Found guideline by direct ID: ${targetGuideline.id}`);
                return found;
            }

            // Method 2: Search by filename match
            const guidelines = Object.values(window.globalGuidelines);
            found = guidelines.find(g => 
                g.filename === targetGuideline.id || 
                (g.title && g.title === targetGuideline.id)
            );
            if (found) {
                console.log(`[DEBUG] Found guideline by filename match: ${targetGuideline.id} -> ${found.id}`);
                return found;
            }

            // Method 3: Search by title similarity
            const targetTitle = targetGuideline.humanFriendlyTitle || targetGuideline.title || targetGuideline.id;
            if (targetTitle && targetTitle.length > 5) {
                found = guidelines.find(g => {
                    if (!g.title) return false;
                    
                    // Normalize titles for comparison
                    const normalizeTitle = (title) => title.toLowerCase()
                        .replace(/[^a-z0-9\s]/g, ' ')
                        .replace(/\s+/g, ' ')
                        .trim();
                    
                    const normalizedTarget = normalizeTitle(targetTitle);
                    const normalizedGuideline = normalizeTitle(g.title);
                    
                    // Check for exact match first
                    if (normalizedTarget === normalizedGuideline) return true;
                    
                    // Check for substantial overlap (80% match)
                    const targetWords = normalizedTarget.split(' ').filter(w => w.length > 2);
                    const guidelineWords = normalizedGuideline.split(' ').filter(w => w.length > 2);
                    
                    if (targetWords.length === 0 || guidelineWords.length === 0) return false;
                    
                    const matchedWords = targetWords.filter(word => 
                        guidelineWords.some(gWord => gWord.includes(word) || word.includes(gWord))
                    );
                    
                    const similarity = matchedWords.length / Math.max(targetWords.length, guidelineWords.length);
                    return similarity >= 0.6; // 60% word overlap threshold
                });
                
                if (found) {
                    console.log(`[DEBUG] Found guideline by title similarity: "${targetTitle}" -> "${found.title}" (${found.id})`);
                    return found;
                }
            }

            // Method 4: Search by partial filename match (for cases like "ESHRE - PCOS - 2023.pdf" vs "ESHRE - PCOS - 2023")
            found = guidelines.find(g => {
                if (!g.filename || !targetGuideline.id) return false;
                
                const normalizeFilename = (filename) => filename.toLowerCase()
                    .replace('.pdf', '')
                    .replace(/[^a-z0-9\s]/g, ' ')
                    .replace(/\s+/g, ' ')
                    .trim();
                
                const normalizedTarget = normalizeFilename(targetGuideline.id);
                const normalizedFilename = normalizeFilename(g.filename);
                
                return normalizedTarget.includes(normalizedFilename) || 
                       normalizedFilename.includes(normalizedTarget);
            });
            
            if (found) {
                console.log(`[DEBUG] Found guideline by partial filename match: ${targetGuideline.id} -> ${found.filename} (${found.id})`);
                return found;
            }

            return null;
        }

        // Get most relevant guidelines (filter by category)
        const mostRelevantGuidelines = window.relevantGuidelines.filter(g => g.category === 'mostRelevant');
        
        console.log('[DEBUG] Found most relevant guidelines:', {
            total: mostRelevantGuidelines.length,
            guidelines: mostRelevantGuidelines.map(g => ({ id: g.id, title: g.title, relevance: g.relevance }))
        });
        
        // Determine which guidelines to process
        let guidelinesToProcess = [];
        const MAX_AUTO_PROCESS = 5;
        
        if (mostRelevantGuidelines.length === 0) {
            throw new Error('No "most relevant" guidelines found. Please ensure guidelines have been properly categorized.');
        } else if (mostRelevantGuidelines.length <= MAX_AUTO_PROCESS) {
            // Auto-process all if 5 or fewer
            guidelinesToProcess = mostRelevantGuidelines;
            console.log(`[DEBUG] Auto-processing all ${guidelinesToProcess.length} most relevant guidelines`);
        } else {
            // Show selection interface if more than 5
            console.log(`[DEBUG] Found ${mostRelevantGuidelines.length} most relevant guidelines, showing selection interface`);
            
            const selectionMessage = `
                <div class="guideline-auto-selection">
                    <h4>📋 Multiple Relevant Guidelines Found</h4>
                    <p>Found <strong>${mostRelevantGuidelines.length}</strong> highly relevant guidelines. To ensure timely processing, we'll analyze the <strong>top ${MAX_AUTO_PROCESS}</strong> by default.</p>
                    <div class="auto-selected-guidelines">
                        <p><strong>Selected for analysis:</strong></p>
                        <ul>
                            ${mostRelevantGuidelines.slice(0, MAX_AUTO_PROCESS).map(g => {
                                const guidelineData = window.globalGuidelines[g.id];
                                const displayTitle = guidelineData?.humanFriendlyTitle || guidelineData?.title || g.title || g.id;
                                return `<li>${displayTitle} <span class="relevance">(relevance: ${g.relevance || 'N/A'})</span></li>`;
                            }).join('')}
                        </ul>
                    </div>
                    <p><em>💡 After this analysis, you can use "Make Advice Dynamic" to select different guidelines or include additional ones.</em></p>
                </div>
                
                <style>
                .guideline-auto-selection {
                    background: #e8f4fd;
                    border: 1px solid #2196f3;
                    border-radius: 6px;
                    padding: 15px;
                    margin: 10px 0;
                }
                .guideline-auto-selection h4 {
                    margin: 0 0 10px 0;
                    color: #1976d2;
                }
                .auto-selected-guidelines {
                    background: white;
                    border-radius: 4px;
                    padding: 10px;
                    margin: 10px 0;
                }
                .auto-selected-guidelines ul {
                    margin: 5px 0 0 0;
                    padding-left: 20px;
                }
                .auto-selected-guidelines li {
                    margin-bottom: 5px;
                    color: #1976d2;
                }
                .relevance {
                    color: #666;
                    font-size: 0.9em;
                }
                </style>
            `;
            
            appendToSummary1(selectionMessage, false);
            
            // Use top 5 guidelines
            guidelinesToProcess = mostRelevantGuidelines.slice(0, MAX_AUTO_PROCESS);
        }
        
        // Update UI to show guidelines being processed
        const processingStatus = `Analysing against ${guidelinesToProcess.length} most relevant guideline${guidelinesToProcess.length > 1 ? 's' : ''}...\n\n`;
        appendToSummary1(processingStatus, false);
        
        // Process guidelines in parallel for better performance
        const guidelinePromises = guidelinesToProcess.map(async (relevantGuideline, index) => {
            const guidelineData = findGuidelineInCache(relevantGuideline);
            const guidelineTitle = guidelineData?.humanFriendlyTitle || guidelineData?.title || relevantGuideline.filename || relevantGuideline.title;
            
            console.log(`[DEBUG] Processing guideline ${index + 1}/${guidelinesToProcess.length}: ${guidelineTitle}`);
            
            try {
                if (!guidelineData) {
                    console.error('[DEBUG] Guideline not found in cache:', {
                        title: guidelineTitle,
                        availableGuidelines: Object.keys(window.globalGuidelines)
                    });
                    
                    return {
                        guideline: guidelineTitle,
                        error: 'Guideline not found in cache. Please try finding relevant guidelines again.',
                        analysis: null,
                        success: false
                    };
                }

                // Send to server for analysis
                const response = await fetch(`${window.SERVER_URL}/analyzeNoteAgainstGuideline`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${idToken}`
                    },
                    body: JSON.stringify({
                        transcript: transcript,
                        guideline: guidelineData.id
                    })
                });

                console.log(`[DEBUG] Server response for ${guidelineTitle}:`, {
                    status: response.status,
                    ok: response.ok,
                    statusText: response.statusText
                });

                if (!response.ok) {
                    const errorText = await response.text();
                    console.error('[DEBUG] Server error response:', {
                        status: response.status,
                        statusText: response.statusText,
                        errorText,
                        guideline: guidelineTitle
                    });
                    
                    // Try to parse the error message
                    let errorMessage = 'Server error';
                    try {
                        const errorJson = JSON.parse(errorText);
                        errorMessage = errorJson.error || errorMessage;
                    } catch (e) {
                        errorMessage = errorText || errorMessage;
                    }
                    
                    return {
                        guideline: guidelineTitle,
                        error: errorMessage,
                        analysis: null,
                        success: false
                    };
                }

                const result = await response.json();
                if (!result.success) {
                    return {
                        guideline: guidelineTitle,
                        error: result.error || 'Analysis failed',
                        analysis: null,
                        success: false
                    };
                }

                return {
                    guideline: guidelineTitle,
                    analysis: result.analysis,
                    success: true
                };

            } catch (error) {
                console.error(`[DEBUG] Error processing guideline ${guidelineTitle}:`, error);
                return {
                    guideline: guidelineTitle,
                    error: error.message,
                    analysis: null,
                    success: false
                };
            }
        });

        // Wait for all guidelines to be processed
        console.log('[DEBUG] Waiting for all guideline processing to complete...');
        const results = await Promise.all(guidelinePromises);
        
        // Process results
        results.forEach(result => {
            if (result.success) {
                const analysisSection = `### ${result.guideline}\n\n${result.analysis}\n\n`;
                formattedAnalysis += analysisSection;
                successCount++;
                appendToSummary1(analysisSection, false);
            } else {
                                 const errorSection = `### ${result.guideline}\n\n⚠️ Error: ${result.error}\n\n`;
                 formattedAnalysis += errorSection;
                 errorCount++;
                 appendToSummary1(errorSection, false); // Append, don't clear
             }
         });

        // Add summary of results
        console.log('[DEBUG] Analysis summary:', {
            successCount,
            errorCount,
            guidelinesProcessed: guidelinesToProcess.length,
            totalRelevantGuidelines: window.relevantGuidelines.length,
            analyzedMultiple: guidelinesToProcess.length > 1
        });

        const summarySection = `\n## Summary\n\nAnalyzed against ${guidelinesToProcess.length} most relevant guideline${guidelinesToProcess.length > 1 ? 's' : ''}${successCount > 0 ? ' successfully' : ''}.\n`;
        const failureSection = errorCount > 0 ? `${errorCount} analysis failed.\n` : '';
        const additionalInfo = `\n*Note: Found ${window.relevantGuidelines.length} relevant guidelines total, analyzed against the top ${guidelinesToProcess.length} most relevant.*\n`;
        const finalSummary = summarySection + failureSection + additionalInfo;
        
        formattedAnalysis += finalSummary;
        appendToSummary1(finalSummary, false); // Append, don't clear

        // Store the latest analysis result and guideline data for dynamic advice
        if (successCount > 0) {
            console.log('[DEBUG] Storing analysis result for dynamic advice');
            
            // Store the combined analysis and the guidelines that were processed
            const processedGuidelineData = guidelinesToProcess.map(g => {
                const guidelineData = window.globalGuidelines[g.id];
                return {
                    id: g.id,
                    title: guidelineData?.humanFriendlyTitle || guidelineData?.title || g.title || g.id,
                    relevance: g.relevance || 'N/A'
                };
            });
            
            window.latestAnalysis = {
                analysis: formattedAnalysis,
                transcript: transcript,
                guidelineId: processedGuidelineData[0].id, // For backward compatibility
                guidelineTitle: processedGuidelineData[0].title, // For backward compatibility
                processedGuidelines: processedGuidelineData,
                multiGuideline: guidelinesToProcess.length > 1,
                analysisResults: results, // Store all results for auto-processing
                timestamp: new Date().toISOString()
            };
            
            // If multiple guidelines were processed, automatically generate combined suggestions
            if (guidelinesToProcess.length > 1) {
                console.log('[DEBUG] Auto-generating combined suggestions for', successCount, 'successful guidelines');
                
                // Filter to only successful results
                const successfulResults = results.filter(r => !r.error);
                
                // Add a small delay to let the analysis display complete
                setTimeout(async () => {
                    try {
                        await generateCombinedInteractiveSuggestions(successfulResults);
                    } catch (error) {
                        console.error('[DEBUG] Error auto-generating combined suggestions:', error);
                        // Show the fallback button if auto-generation fails
                        const makeDynamicAdviceBtn = document.getElementById('makeDynamicAdviceBtn');
                        if (makeDynamicAdviceBtn) {
                            makeDynamicAdviceBtn.style.display = 'inline-block';
                            console.log('[DEBUG] Showed fallback dynamic advice button');
                        }
                    }
                }, 1000);
            } else {
                // For single guideline, show the "Make Advice Dynamic" button as before
                const makeDynamicAdviceBtn = document.getElementById('makeDynamicAdviceBtn');
                if (makeDynamicAdviceBtn) {
                    makeDynamicAdviceBtn.style.display = 'inline-block';
                    console.log('[DEBUG] Made dynamic advice button visible for single guideline');
                }
            }
        }

        debouncedSaveState(); // Save state after checking guidelines

    } catch (error) {
        console.error('[DEBUG] Error in checkAgainstGuidelines:', error);
        alert(`Error checking guidelines: ${error.message}`);
    } finally {
        // Reset button state
        checkGuidelinesBtn.classList.remove('loading');
        checkGuidelinesBtn.disabled = false;
        console.log('[DEBUG] checkAgainstGuidelines completed');
    }
}

// Dynamic Advice function - converts guideline analysis into interactive suggestions
async function dynamicAdvice(transcript, analysis, guidelineId, guidelineTitle) {
    console.log('[DEBUG] dynamicAdvice function called', {
        transcriptLength: transcript?.length,
        analysisLength: analysis?.length,
        guidelineId,
        guidelineTitle
    });

    try {
        // Get user ID token
        const user = auth.currentUser;
        if (!user) {
            console.log('[DEBUG] dynamicAdvice: No authenticated user found');
            throw new Error('User not authenticated');
        }
        
        const idToken = await user.getIdToken();
        console.log('[DEBUG] dynamicAdvice: Got ID token');

        // Call the dynamicAdvice API
        console.log('[DEBUG] dynamicAdvice: Calling API endpoint');
        const response = await fetch(`${window.SERVER_URL}/dynamicAdvice`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${idToken}`
            },
            body: JSON.stringify({
                transcript,
                analysis,
                guidelineId,
                guidelineTitle
            })
        });

        console.log('[DEBUG] dynamicAdvice: API response received', {
            status: response.status,
            ok: response.ok,
            statusText: response.statusText
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('[DEBUG] dynamicAdvice: API error response:', {
                status: response.status,
                statusText: response.statusText,
                errorText
            });
            throw new Error(`API error: ${response.status} - ${errorText}`);
        }

        const result = await response.json();
        console.log('[DEBUG] dynamicAdvice: API result received', {
            success: result.success,
            sessionId: result.sessionId,
            suggestionsCount: result.suggestions?.length,
            guidelineId: result.guidelineId,
            guidelineTitle: result.guidelineTitle
        });

        if (!result.success) {
            throw new Error(result.error || 'Dynamic advice generation failed');
        }

        // Store session data globally
        currentAdviceSession = result.sessionId;
        currentSuggestions = result.suggestions || [];
        userDecisions = {};

        console.log('[DEBUG] dynamicAdvice: Stored session data', {
            sessionId: currentAdviceSession,
            suggestionsCount: currentSuggestions.length
        });

        // Display interactive suggestions using appendToSummary1
        await displayInteractiveSuggestions(result.suggestions, result.guidelineTitle);

        return result;

    } catch (error) {
        console.error('[DEBUG] dynamicAdvice: Error in function:', {
            error: error.message,
            stack: error.stack,
            transcriptLength: transcript?.length,
            analysisLength: analysis?.length
        });
        
        // Display error message using appendToSummary1
        const errorHtml = `
            <div class="dynamic-advice-error">
                <h3>❌ Error generating interactive suggestions</h3>
                <p><strong>Error:</strong> ${error.message}</p>
                <p>The original analysis is still available above.</p>
            </div>
        `;
        appendToSummary1(errorHtml, false);
        
        throw error;
    }
}

// Display interactive suggestions in summary1
async function displayInteractiveSuggestions(suggestions, guidelineTitle) {
    console.log('[DEBUG] displayInteractiveSuggestions called', {
        suggestionsCount: suggestions?.length,
        guidelineTitle
    });

    if (!suggestions || suggestions.length === 0) {
        console.log('[DEBUG] displayInteractiveSuggestions: No suggestions to display');
        const noSuggestionsHtml = `
            <div class="dynamic-advice-container">
                <h3>💡 Interactive Suggestions</h3>
                <p>No specific suggestions were generated from the guideline analysis.</p>
                <p><em>Guideline: ${guidelineTitle || 'Unknown'}</em></p>
            </div>
        `;
        appendToSummary1(noSuggestionsHtml, false);
        return;
    }

    console.log('[DEBUG] displayInteractiveSuggestions: Creating suggestions HTML');

    // Create the interactive suggestions HTML
    let suggestionsHtml = `
        <div class="dynamic-advice-container">
            <div class="advice-header">
                <h3>💡 Interactive Suggestions</h3>
                <p><em>From: ${guidelineTitle || 'Guideline Analysis'}</em></p>
                <p class="advice-instructions">Review each suggestion below. You can <strong>Accept</strong>, <strong>Reject</strong>, or <strong>Modify</strong> the proposed changes.</p>
                <div class="advice-explanation">
                    <p><strong>Note:</strong> Some suggestions identify <em>missing elements</em> (gaps in documentation) rather than existing text that needs changes. These are marked with ⚠️ and represent content that should be added to improve compliance with guidelines.</p>
                </div>
            </div>
            <div class="suggestions-list">
    `;

    // Add each suggestion
    suggestions.forEach((suggestion, index) => {
        console.log('[DEBUG] displayInteractiveSuggestions: Processing suggestion', {
            index,
            id: suggestion.id,
            category: suggestion.category,
            priority: suggestion.priority
        });

        const priorityClass = `priority-${suggestion.priority || 'medium'}`;
        const categoryIcon = getCategoryIcon(suggestion.category);
        
        suggestionsHtml += `
            <div class="suggestion-item ${priorityClass}" data-suggestion-id="${suggestion.id}">
                <div class="suggestion-header">
                    <div class="suggestion-info">
                        <span class="category-icon">${categoryIcon}</span>
                        <span class="suggestion-id">#${index + 1}</span>
                        <span class="priority-badge ${priorityClass}">${suggestion.priority || 'medium'}</span>
                    </div>
                    <div class="guideline-ref">${suggestion.guidelineReference || ''}</div>
                </div>
                
                <div class="suggestion-content">
                    ${suggestion.originalText ? `
                        <div class="original-text">
                            <label>${getOriginalTextLabel(suggestion.originalText, suggestion.category)}</label>
                            <div class="text-preview ${suggestion.category === 'addition' ? 'missing-element' : ''}">"${suggestion.originalText}"</div>
                        </div>
                    ` : ''}
                    
                    <div class="suggested-text">
                        <label>Suggested ${suggestion.category || 'change'}:</label>
                        <div class="text-preview suggested">"${suggestion.suggestedText}"</div>
                    </div>
                    
                    <div class="suggestion-context">
                        <label>Why this change is suggested:</label>
                        <p>${suggestion.context}</p>
                    </div>
                </div>
                
                <div class="suggestion-actions">
                    <button class="action-btn accept-btn" onclick="handleSuggestionAction('${suggestion.id}', 'accept')">
                        ✅ Accept
                    </button>
                    <button class="action-btn reject-btn" onclick="handleSuggestionAction('${suggestion.id}', 'reject')">
                        ❌ Reject
                    </button>
                    <button class="action-btn modify-btn" onclick="handleSuggestionAction('${suggestion.id}', 'modify')">
                        ✏️ Modify
                    </button>
                </div>
                
                <div class="modify-section" id="modify-${suggestion.id}" style="display: none;">
                    <label for="modify-text-${suggestion.id}">Your modified text:</label>
                    <textarea id="modify-text-${suggestion.id}" class="modify-textarea" 
                              placeholder="Enter your custom text here...">${suggestion.suggestedText}</textarea>
                    <div class="modify-actions">
                        <button class="action-btn confirm-btn" onclick="confirmModification('${suggestion.id}')">
                            ✅ Confirm Modification
                        </button>
                        <button class="action-btn cancel-btn" onclick="cancelModification('${suggestion.id}')">
                            ❌ Cancel
                        </button>
                    </div>
                </div>
                
                <div class="decision-status" id="status-${suggestion.id}" style="display: none;">
                    <!-- Status will be updated by JavaScript -->
                </div>
            </div>
        `;
    });

    // Add apply all button
    suggestionsHtml += `
            </div>
            <div class="advice-footer">
                <button id="applyAllDecisionsBtn" class="apply-all-btn" onclick="applyAllDecisions()" disabled>
                    <span class="apply-spinner" style="display: none;">⏳</span>
                    <span class="apply-text">Apply All Decisions</span>
                </button>
                <div class="decisions-summary" id="decisionsSummary">
                    Make your decisions above, then click "Apply All Decisions" to update the transcript.
                </div>
            </div>
        </div>
    `;

    console.log('[DEBUG] displayInteractiveSuggestions: Adding suggestions HTML to summary1');
    appendToSummary1(suggestionsHtml, false);

    // Update the decisions summary
    updateDecisionsSummary();
    debouncedSaveState(); // Save state after displaying suggestions
}

// Get category icon for suggestion type
function getCategoryIcon(category) {
    const icons = {
        'addition': '➕',
        'modification': '✏️',
        'deletion': '🗑️',
        'formatting': '📝',
        'default': '💡'
    };
    return icons[category] || icons.default;
}

// Get appropriate label for original text based on category and content
function getOriginalTextLabel(originalText, category) {
    if (category === 'addition') {
        // For additions, we're usually dealing with missing elements
        if (originalText.toLowerCase().startsWith('no ') || originalText.toLowerCase().startsWith('did not') || originalText.toLowerCase().includes('missing')) {
            return 'Gap identified:';
        } else if (originalText.toLowerCase().startsWith('missing:') || originalText.toLowerCase().startsWith('gap:')) {
            return 'Issue found:';
        } else {
            return 'Missing element:';
        }
    } else if (category === 'modification') {
        return 'Current text:';
    } else if (category === 'deletion') {
        return 'Text to remove:';
    } else {
        return 'Current text:';
    }
}

// Handle suggestion actions (accept, reject, modify)
function handleSuggestionAction(suggestionId, action) {
    console.log('[DEBUG] handleSuggestionAction called', {
        suggestionId,
        action
    });

    const suggestionElement = document.querySelector(`[data-suggestion-id="${suggestionId}"]`);
    if (!suggestionElement) {
        console.error('[DEBUG] handleSuggestionAction: Suggestion element not found:', suggestionId);
        return;
    }

    // Find the suggestion data
    const suggestion = currentSuggestions.find(s => s.id === suggestionId);
    if (!suggestion) {
        console.error('[DEBUG] handleSuggestionAction: Suggestion data not found:', suggestionId);
        return;
    }

    console.log('[DEBUG] handleSuggestionAction: Processing action', {
        suggestionId,
        action,
        suggestionFound: !!suggestion
    });

    if (action === 'modify') {
        // Show modify section
        const modifySection = document.getElementById(`modify-${suggestionId}`);
        if (modifySection) {
            modifySection.style.display = 'block';
            console.log('[DEBUG] handleSuggestionAction: Showing modify section');
        }
        return;
    }

    // For accept/reject, record the decision immediately
    userDecisions[suggestionId] = {
        action: action,
        suggestion: suggestion,
        timestamp: new Date().toISOString()
    };

    console.log('[DEBUG] handleSuggestionAction: Recorded decision', {
        suggestionId,
        action,
        totalDecisions: Object.keys(userDecisions).length
    });

    // Update UI to show decision
    updateSuggestionStatus(suggestionId, action);
    updateDecisionsSummary();
    debouncedSaveState(); // Save state after a decision is made
}

// Confirm modification with custom text
function confirmModification(suggestionId) {
    console.log('[DEBUG] confirmModification called', { suggestionId });

    const modifyTextarea = document.getElementById(`modify-text-${suggestionId}`);
    if (!modifyTextarea) {
        console.error('[DEBUG] confirmModification: Modify textarea not found:', suggestionId);
        return;
    }

    const modifiedText = modifyTextarea.value.trim();
    if (!modifiedText) {
        alert('Please enter some text for the modification.');
        return;
    }

    // Find the suggestion data
    const suggestion = currentSuggestions.find(s => s.id === suggestionId);
    if (!suggestion) {
        console.error('[DEBUG] confirmModification: Suggestion data not found:', suggestionId);
        return;
    }

    // Record the modification decision
    userDecisions[suggestionId] = {
        action: 'modify',
        modifiedText: modifiedText,
        suggestion: suggestion,
        timestamp: new Date().toISOString()
    };

    console.log('[DEBUG] confirmModification: Recorded modification', {
        suggestionId,
        modifiedTextLength: modifiedText.length,
        totalDecisions: Object.keys(userDecisions).length
    });

    // Hide modify section and update UI
    const modifySection = document.getElementById(`modify-${suggestionId}`);
    if (modifySection) {
        modifySection.style.display = 'none';
    }

    updateSuggestionStatus(suggestionId, 'modify', modifiedText);
    updateDecisionsSummary();
    debouncedSaveState(); // Save state after modification
}

// Cancel modification
function cancelModification(suggestionId) {
    console.log('[DEBUG] cancelModification called', { suggestionId });

    const modifySection = document.getElementById(`modify-${suggestionId}`);
    if (modifySection) {
        modifySection.style.display = 'none';
    }

    // Remove any existing decision for this suggestion
    if (userDecisions[suggestionId]) {
        delete userDecisions[suggestionId];
        console.log('[DEBUG] cancelModification: Removed decision for suggestion:', suggestionId);
    }

    // Reset status
    const statusElement = document.getElementById(`status-${suggestionId}`);
    if (statusElement) {
        statusElement.style.display = 'none';
        statusElement.innerHTML = '';
    }

    // Show the action buttons again since decision was cancelled
    const actionButtonsElement = document.querySelector(`[data-suggestion-id="${suggestionId}"] .suggestion-actions`);
    if (actionButtonsElement) {
        actionButtonsElement.style.display = 'flex';
        actionButtonsElement.style.opacity = '1';
        actionButtonsElement.style.transform = 'scale(1)';
        console.log('[DEBUG] cancelModification: Restored action buttons for suggestion:', suggestionId);
    }

    // Show the suggestion element again if it was hidden
    const suggestionElement = document.querySelector(`[data-suggestion-id="${suggestionId}"]`);
    if (suggestionElement) {
        suggestionElement.classList.remove('hiding', 'decision-accepted', 'decision-rejected', 'decision-modified');
        suggestionElement.style.display = 'block';
        console.log('[DEBUG] cancelModification: Restored suggestion visibility for:', suggestionId);
    }

    updateDecisionsSummary();
    debouncedSaveState(); // Save state after cancelling
}

// Update suggestion status UI
function updateSuggestionStatus(suggestionId, action, modifiedText = null) {
    console.log('[DEBUG] updateSuggestionStatus called', {
        suggestionId,
        action,
        hasModifiedText: !!modifiedText
    });

    const statusElement = document.getElementById(`status-${suggestionId}`);
    if (!statusElement) {
        console.error('[DEBUG] updateSuggestionStatus: Status element not found:', suggestionId);
        return;
    }

    let statusHtml = '';
    let statusClass = '';

    switch (action) {
        case 'accept':
            statusHtml = '<span class="status-icon">✅</span> <strong>Accepted</strong> - This suggestion will be applied';
            statusClass = 'decision-accepted';
            break;
        case 'reject':
            statusHtml = '<span class="status-icon">❌</span> <strong>Rejected</strong> - This suggestion will be ignored';
            statusClass = 'decision-rejected';
            break;
        case 'modify':
            statusHtml = `<span class="status-icon">✏️</span> <strong>Modified</strong> - Will use your custom text: "<em>${modifiedText?.substring(0, 100)}${modifiedText?.length > 100 ? '...' : ''}</em>"`;
            statusClass = 'decision-modified';
            break;
    }

    statusElement.innerHTML = statusHtml;
    statusElement.className = `decision-status ${statusClass}`;
    statusElement.style.display = 'block';

    // Hide the action buttons after decision is made with animation
    const actionButtonsElement = document.querySelector(`[data-suggestion-id="${suggestionId}"] .suggestion-actions`);
    if (actionButtonsElement) {
        actionButtonsElement.style.opacity = '0';
        actionButtonsElement.style.transform = 'scale(0.95)';
        setTimeout(() => {
            actionButtonsElement.style.display = 'none';
        }, 300);
        console.log('[DEBUG] updateSuggestionStatus: Hidden action buttons for suggestion:', suggestionId);
    }

    // Update suggestion item styling and then hide the entire suggestion with animation
    const suggestionElement = document.querySelector(`[data-suggestion-id="${suggestionId}"]`);
    if (suggestionElement) {
        suggestionElement.classList.remove('decision-accepted', 'decision-rejected', 'decision-modified');
        suggestionElement.classList.add(statusClass);
        
        // Hide the entire suggestion after a brief delay to let user see the status
        setTimeout(() => {
            suggestionElement.classList.add('hiding');
            
            // After animation completes, completely hide the element
            setTimeout(() => {
                suggestionElement.style.display = 'none';
                console.log('[DEBUG] updateSuggestionStatus: Completely hidden suggestion element:', suggestionId);
            }, 500);
        }, 1500); // Wait 1.5 seconds to let user see the decision status
        
        console.log('[DEBUG] updateSuggestionStatus: Scheduled suggestion hiding for:', suggestionId);
    }
}

// Update decisions summary and enable/disable apply button
function updateDecisionsSummary() {
    console.log('[DEBUG] updateDecisionsSummary called', {
        totalSuggestions: currentSuggestions.length,
        totalDecisions: Object.keys(userDecisions).length
    });

    const summaryElement = document.getElementById('decisionsSummary');
    const applyButton = document.getElementById('applyAllDecisionsBtn');
    
    if (!summaryElement || !applyButton) {
        console.error('[DEBUG] updateDecisionsSummary: Required elements not found');
        return;
    }

    const totalSuggestions = currentSuggestions.length;
    const totalDecisions = Object.keys(userDecisions).length;
    const decisions = Object.values(userDecisions);
    
    const acceptedCount = decisions.filter(d => d.action === 'accept').length;
    const rejectedCount = decisions.filter(d => d.action === 'reject').length;
    const modifiedCount = decisions.filter(d => d.action === 'modify').length;

    console.log('[DEBUG] updateDecisionsSummary: Decision counts', {
        total: totalDecisions,
        accepted: acceptedCount,
        rejected: rejectedCount,
        modified: modifiedCount
    });

    let summaryText = '';
    if (totalDecisions === 0) {
        summaryText = `Make your decisions above, then click "Apply All Decisions" to update the transcript.`;
        applyButton.disabled = true;
    } else if (totalDecisions < totalSuggestions) {
        summaryText = `Progress: ${totalDecisions}/${totalSuggestions} decisions made. `;
        summaryText += `Accepted: ${acceptedCount}, Rejected: ${rejectedCount}, Modified: ${modifiedCount}`;
        applyButton.disabled = true;
    } else {
        summaryText = `All decisions made! Accepted: ${acceptedCount}, Rejected: ${rejectedCount}, Modified: ${modifiedCount}`;
        applyButton.disabled = false;
    }

    summaryElement.textContent = summaryText;
}

// Apply all user decisions
async function applyAllDecisions() {
    console.log('[DEBUG] applyAllDecisions called', {
        sessionId: currentAdviceSession,
        totalDecisions: Object.keys(userDecisions).length
    });

    if (!currentAdviceSession) {
        console.error('[DEBUG] applyAllDecisions: No active advice session');
        alert('No active advice session found. Please generate suggestions first.');
        return;
    }

    if (Object.keys(userDecisions).length === 0) {
        console.error('[DEBUG] applyAllDecisions: No decisions to apply');
        alert('Please make some decisions on the suggestions first.');
        return;
    }

    const applyButton = document.getElementById('applyAllDecisionsBtn');
    const applySpinner = applyButton?.querySelector('.apply-spinner');
    const applyText = applyButton?.querySelector('.apply-text');

    try {
        // Update UI to show loading state
        if (applyButton) applyButton.disabled = true;
        if (applySpinner) applySpinner.style.display = 'inline';
        if (applyText) applyText.textContent = 'Applying decisions...';

        console.log('[DEBUG] applyAllDecisions: UI updated to loading state');

        // Prepare decisions data for API
        const decisionsData = {};
        Object.entries(userDecisions).forEach(([suggestionId, decision]) => {
            decisionsData[suggestionId] = {
                action: decision.action,
                modifiedText: decision.modifiedText || null
            };
        });

        console.log('[DEBUG] applyAllDecisions: Prepared decisions data', {
            decisionsCount: Object.keys(decisionsData).length,
            actions: Object.values(decisionsData).map(d => d.action)
        });

        // Get user ID token
        const user = auth.currentUser;
        if (!user) {
            throw new Error('User not authenticated');
        }
        
        const idToken = await user.getIdToken();
        console.log('[DEBUG] applyAllDecisions: Got ID token');

        // Call the applyDynamicAdvice API
        console.log('[DEBUG] applyAllDecisions: Calling API endpoint');
        const response = await fetch(`${window.SERVER_URL}/applyDynamicAdvice`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${idToken}`
            },
            body: JSON.stringify({
                sessionId: currentAdviceSession,
                decisions: decisionsData
            })
        });

        console.log('[DEBUG] applyAllDecisions: API response received', {
            status: response.status,
            ok: response.ok
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('[DEBUG] applyAllDecisions: API error response:', {
                status: response.status,
                errorText
            });
            throw new Error(`API error: ${response.status} - ${errorText}`);
        }

        const result = await response.json();
        console.log('[DEBUG] applyAllDecisions: API result received', {
            success: result.success,
            originalLength: result.originalTranscript?.length,
            updatedLength: result.updatedTranscript?.length,
            changesSummary: result.changesSummary
        });

        if (!result.success) {
            throw new Error(result.error || 'Failed to apply decisions');
        }

        // Display the results using appendToSummary1
        const resultsHtml = `
            <div class="apply-results">
                <h3>🎉 Decisions Applied Successfully!</h3>
                <div class="changes-summary">
                    <h4>Changes Summary:</h4>
                    <ul>
                        <li><strong>Accepted:</strong> ${result.changesSummary.accepted} suggestions</li>
                        <li><strong>Modified:</strong> ${result.changesSummary.modified} suggestions</li>
                        <li><strong>Rejected:</strong> ${result.changesSummary.rejected} suggestions</li>
                        <li><strong>Total processed:</strong> ${result.changesSummary.total} suggestions</li>
                    </ul>
                </div>
                <div class="updated-transcript">
                    <h4>Updated Transcript:</h4>
                    <div class="transcript-content">${result.updatedTranscript.replace(/\n/g, '<br>')}</div>
                </div>
                <div class="transcript-actions">
                    <button onclick="copyUpdatedTranscript()" class="action-btn">📋 Copy Updated Transcript</button>
                    <button onclick="replaceOriginalTranscript()" class="action-btn">🔄 Replace Original Transcript</button>
                </div>
            </div>
        `;

        appendToSummary1(resultsHtml, false);

        // Store the updated transcript globally for actions
        window.lastUpdatedTranscript = result.updatedTranscript;

        console.log('[DEBUG] applyAllDecisions: Results displayed successfully');
        debouncedSaveState();

    } catch (error) {
        console.error('[DEBUG] applyAllDecisions: Error applying decisions:', {
            error: error.message,
            stack: error.stack
        });

        const errorHtml = `
            <div class="apply-error">
                <h3>❌ Error applying decisions</h3>
                <p><strong>Error:</strong> ${error.message}</p>
                <p>Please try again or contact support if the problem persists.</p>
            </div>
        `;
        appendToSummary1(errorHtml, false);

    } finally {
        // Reset UI state
        if (applyButton) applyButton.disabled = false;
        if (applySpinner) applySpinner.style.display = 'none';
        if (applyText) applyText.textContent = 'Apply All Decisions';
    }
}

// Helper function to copy updated transcript
function copyUpdatedTranscript() {
    if (window.lastUpdatedTranscript) {
        navigator.clipboard.writeText(window.lastUpdatedTranscript).then(() => {
            alert('Updated transcript copied to clipboard!');
        }).catch(err => {
            console.error('Failed to copy transcript:', err);
            alert('Failed to copy transcript. Please select and copy manually.');
        });
    }
}

// Helper function to replace original transcript in userInput
function replaceOriginalTranscript() {
    if (window.lastUpdatedTranscript) {
        const userInput = document.getElementById('userInput');
        if (userInput) {
            userInput.value = window.lastUpdatedTranscript;
            alert('Original transcript has been replaced with the updated version!');
            debouncedSaveState();
        }
    }
}

// Modify initializeApp to auto-sync guidelines if needed
async function initializeApp() {
    console.log('[DEBUG] Starting initializeApp...');

        console.log('[DEBUG] Initializing marked library...');
        await initializeMarked();
        console.log('[DEBUG] Marked library initialized successfully');

        console.log('[DEBUG] Setting up Firebase auth state listener...');
    window.auth.onAuthStateChanged(async (user) => {
        console.log('[DEBUG] Auth state changed:', user);
        const loading = document.getElementById('loading');
        const landingPage = document.getElementById('landingPage');
        const mainContent = document.getElementById('mainContent');

            if (user) {
            console.log('[DEBUG] User authenticated:', user.displayName || user.email);
            loading.classList.add('hidden');
            landingPage.classList.add('hidden');
            mainContent.classList.remove('hidden');
            
            // Update user info
            const userLabel = document.getElementById('userLabel');
            const userName = document.getElementById('userName');
            if (userLabel && userName) {
                userName.textContent = user.displayName || user.email || 'User';
                userName.classList.remove('hidden');
            }
            
            // Initialize app features
            await initializeMainApp();
                        } else {
            console.log('[DEBUG] User not authenticated, showing landing page');
            loading.classList.add('hidden');
            mainContent.classList.add('hidden');
            landingPage.classList.remove('hidden');
            
            // Set up Google Sign-in button listener
            setupGoogleSignIn();
                    }
    });
}

function setupGoogleSignIn() {
    const signInButton = document.getElementById('googleSignInBtn');
    if (signInButton) {
        // Check if listener is already set up
        if (signInButton.hasAttribute('data-listener-setup')) {
            console.log('[DEBUG] Google Sign-in button listener already set up');
            return;
        }
        
        console.log('[DEBUG] Setting up Google Sign-in button listener...');
        
        let isSigningIn = false; // Prevent concurrent sign-in attempts
        
        signInButton.addEventListener('click', async () => {
            if (isSigningIn) {
                console.log('[DEBUG] Sign-in already in progress, ignoring click');
                return;
            }
            
            try {
                isSigningIn = true;
                console.log('[DEBUG] Google Sign-in button clicked');
                const provider = new window.firebase.auth.GoogleAuthProvider();
                const result = await window.firebase.auth.signInWithPopup(provider);
                console.log('[DEBUG] Sign-in successful:', result.user.email);
            } catch (error) {
                console.error('[ERROR] Sign-in failed:', error);
                if (error.code !== 'auth/cancelled-popup-request') {
                    alert('Sign-in failed: ' + error.message);
                }
            } finally {
                isSigningIn = false;
            }
        });
        
        // Mark that listener has been set up
        signInButton.setAttribute('data-listener-setup', 'true');
        console.log('[DEBUG] Google Sign-in button listener set up successfully');
    } else {
        console.log('[DEBUG] Google Sign-in button not found');
    }
}

// Start initialization when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    console.log('DOM loaded, starting initialization...');
    initializeApp().catch(error => {
        console.error('Failed to initialize application:', error);
        isInitialized = true;
        showMainContent();
    });

    // Add click handler for generate clinical note button
    const generateClinicalNoteBtn = document.getElementById('generateClinicalNoteBtn');
    if (generateClinicalNoteBtn) {
        generateClinicalNoteBtn.addEventListener('click', generateClinicalNote);
    }

    // Add click handler for find relevant guidelines button
    const findGuidelinesBtn = document.getElementById('findGuidelinesBtn');
    if (findGuidelinesBtn) {
        findGuidelinesBtn.addEventListener('click', findRelevantGuidelines);
    }

    // Add click handler for dev button
    const devBtn = document.getElementById('devBtn');
    if (devBtn) {
        devBtn.addEventListener('click', () => {
            console.log('[DEBUG] Dev button clicked, redirecting to dev page...');
            window.location.href = 'dev.html';
        });
    }

    // Add click handler for prompts button
    const promptsBtn = document.getElementById('promptsBtn');
    if (promptsBtn) {
        promptsBtn.addEventListener('click', () => {
            console.log('[DEBUG] Prompts button clicked, redirecting to prompts page...');
            window.location.href = 'prompts.html';
        });
    }

    // Add click handler for guidelines button
    const guidelinesBtn = document.getElementById('guidelinesBtn');
    if (guidelinesBtn) {
        guidelinesBtn.addEventListener('click', () => {
            console.log('[DEBUG] Guidelines button clicked, redirecting to guidelines page...');
            window.location.href = 'guidelines.html';
        });
    }

    // Add click handler for settings button
    const settingsBtn = document.getElementById('settingsBtn');
    const settingsMenu = document.getElementById('settingsMenu');
    const settingsContainer = document.getElementById('settingsContainer');
    if (settingsBtn && settingsMenu) {
        settingsBtn.addEventListener('click', (event) => {
            event.stopPropagation();
            settingsMenu.classList.toggle('hidden');
        });
        
        // Close menu if clicking outside
        window.addEventListener('click', (event) => {
            if (!settingsMenu.classList.contains('hidden') && !settingsContainer.contains(event.target)) {
                settingsMenu.classList.add('hidden');
            }
        });
    }

    // Add click handler for "New Chat" button
    const newChatBtn = document.getElementById('newChatBtn');
    if (newChatBtn) {
        newChatBtn.addEventListener('click', startNewChat);
    }

    // Add click handler for test button - now generates fake clinical interactions
    const testBtn = document.getElementById('testBtn');
    if (testBtn) {
        testBtn.addEventListener('click', async () => {
            console.log('[DEBUG] Test button clicked - showing clinical issues dropdown...');
            await showClinicalIssuesDropdown();
        });
    }

    // Add click handler for generate transcript button
    const directFakeTranscriptBtn = document.getElementById('directFakeTranscriptBtn');
    if (directFakeTranscriptBtn) {
        directFakeTranscriptBtn.addEventListener('click', async () => {
            console.log('[DEBUG] Generate transcript button clicked...');
            const spinner = document.getElementById('directFakeTranscriptSpinner');
            const text = document.getElementById('directFakeTranscriptText');
            try {
                spinner.style.display = 'inline-block';
                text.textContent = 'Generating...';
                const response = await fetch(`${window.SERVER_URL}/generateTranscript`);
                const data = await response.json();
                if (data.success) {
                    document.getElementById('summary1').textContent = data.transcript;
                } else {
                    throw new Error(data.message || 'Failed to generate transcript');
                }
            } catch (error) {
                console.error('Failed to generate transcript:', error);
                alert('Failed to generate transcript: ' + error.message);
            } finally {
                spinner.style.display = 'none';
                text.textContent = 'Generate Transcript';
            }
        });
    }

    // Add click handler for action button
    const actionBtn = document.getElementById('actionBtn');
    if (actionBtn) {
        actionBtn.addEventListener('click', async () => {
            console.log('[DEBUG] Action button clicked...');
            const spinner = document.getElementById('actionSpinner');
            const text = document.getElementById('actionText');
            try {
                spinner.style.display = 'inline-block';
                text.textContent = 'Processing...';
                // TODO: Implement action functionality
                alert('Action functionality not yet implemented');
            } catch (error) {
                console.error('Action failed:', error);
                alert('Action failed: ' + error.message);
            } finally {
                spinner.style.display = 'none';
                text.textContent = 'Process';
            }
        });
    }

    // Add click handler for x-check button
    const xCheckBtn = document.getElementById('xCheckBtn');
    if (xCheckBtn) {
        xCheckBtn.addEventListener('click', async () => {
            console.log('[DEBUG] X-check button clicked...');
            const spinner = document.getElementById('xCheckSpinner');
            const text = document.getElementById('xCheckText');
            try {
                spinner.style.display = 'inline-block';
                text.textContent = 'Verifying...';
                // TODO: Implement x-check functionality
                alert('X-check functionality not yet implemented');
            } catch (error) {
                console.error('X-check failed:', error);
                alert('X-check failed: ' + error.message);
            } finally {
                spinner.style.display = 'none';
                text.textContent = 'Verify';
            }
        });
    }

    // Add click handler for sign out button
    const signOutBtn = document.getElementById('signOutBtn');
    if (signOutBtn) {
        signOutBtn.addEventListener('click', async () => {
            console.log('[DEBUG] Sign out button clicked...');
            try {
                await auth.signOut();
                window.location.reload();
            } catch (error) {
                console.error('Sign out failed:', error);
                alert('Failed to sign out: ' + error.message);
            }
        });
    }

    // Add click handler for save note button
    const saveNoteBtn = document.getElementById('saveNoteBtn');
    if (saveNoteBtn) {
        saveNoteBtn.addEventListener('click', () => {
            console.log('[DEBUG] Save note button clicked...');
            const userInput = document.getElementById('userInput');
            if (userInput && userInput.value.trim()) {
                document.getElementById('summary1').textContent = userInput.value;
                userInput.value = '';
            }
        });
    }

    // Add click handler for clear button
    const clearNoteBtn = document.getElementById('clearNoteBtn');
    if (clearNoteBtn) {
        clearNoteBtn.addEventListener('click', () => {
            console.log('[DEBUG] Clear button clicked...');
            const userInput = document.getElementById('userInput');
            if (userInput) {
                userInput.value = '';
            }
        });
    }

    // Add click handler for check guidelines button
    const checkGuidelinesBtn = document.getElementById('checkGuidelinesBtn');
    if (checkGuidelinesBtn) {
        checkGuidelinesBtn.addEventListener('click', async () => {
            console.log('[DEBUG] Check guidelines button clicked...');
            await checkAgainstGuidelines();
        });
    }

    // Add click handler for process workflow button
    const processBtn = document.getElementById('processBtn');
    if (processBtn) {
        processBtn.addEventListener('click', async () => {
            console.log('[DEBUG] Process button clicked...');
            await processWorkflow();
        });
    }

    // Add click handler for make advice dynamic button
    const makeDynamicAdviceBtn = document.getElementById('makeDynamicAdviceBtn');
    if (makeDynamicAdviceBtn) {
        makeDynamicAdviceBtn.addEventListener('click', async () => {
            console.log('[DEBUG] Make Advice Dynamic button clicked...');
            
            // Check if we have analysis data available
            if (!window.latestAnalysis) {
                console.log('[DEBUG] No latest analysis found');
                alert('Please run "Check against guidelines" first to generate analysis data.');
                return;
            }

            // Check if we have relevant guidelines
            if (!window.relevantGuidelines || window.relevantGuidelines.length === 0) {
                console.log('[DEBUG] No relevant guidelines found');
                alert('Please find relevant guidelines first.');
                return;
            }

            // Get most relevant guidelines for selection
            const mostRelevantGuidelines = window.relevantGuidelines.filter(g => g.category === 'mostRelevant');
            
            if (mostRelevantGuidelines.length === 0) {
                console.log('[DEBUG] No most relevant guidelines found');
                alert('No "most relevant" guidelines found. Please ensure guidelines have been properly categorized.');
                return;
            }

            console.log('[DEBUG] Found most relevant guidelines:', {
                count: mostRelevantGuidelines.length,
                guidelines: mostRelevantGuidelines.map(g => ({ id: g.id, title: g.title }))
            });

            // Show guideline selection interface
            await showGuidelineSelectionInterface(mostRelevantGuidelines);
        });
    }

    // Add click handler for add issue button
    const addIssueBtn = document.getElementById('addIssueBtn');
    if (addIssueBtn) {
        addIssueBtn.addEventListener('click', () => {
            console.log('[DEBUG] Add issue button clicked...');
            // TODO: Implement add issue functionality
            alert('Add issue functionality not yet implemented');
        });
    }

    // Add click handlers for proforma buttons
    const obsProformaBtn = document.getElementById('obsProformaBtn');
    const gynProformaBtn = document.getElementById('gynProformaBtn');
    if (obsProformaBtn && gynProformaBtn) {
        obsProformaBtn.addEventListener('click', () => {
            console.log('[DEBUG] Obstetric proforma button clicked...');
            obsProformaBtn.classList.add('active');
            gynProformaBtn.classList.remove('active');
            document.getElementById('obsProforma').classList.remove('hidden');
            document.getElementById('gynProforma').classList.add('hidden');
        });

        gynProformaBtn.addEventListener('click', () => {
            console.log('[DEBUG] Gynaecology proforma button clicked...');
            gynProformaBtn.classList.add('active');
            obsProformaBtn.classList.remove('active');
            document.getElementById('gynProforma').classList.remove('hidden');
            document.getElementById('obsProforma').classList.add('hidden');
        });
    }

    // Add click handler for populate proforma button
    const populateProformaBtn = document.getElementById('populateProformaBtn');
    if (populateProformaBtn) {
        populateProformaBtn.addEventListener('click', async () => {
            console.log('[DEBUG] Populate proforma button clicked...');
            const spinner = document.getElementById('populateSpinner');
            const text = document.getElementById('populateText');
            try {
                spinner.style.display = 'inline-block';
                text.textContent = 'Populating...';
                // TODO: Implement populate proforma functionality
                alert('Populate proforma functionality not yet implemented');
            } catch (error) {
                console.error('Populate proforma failed:', error);
                alert('Failed to populate proforma: ' + error.message);
            } finally {
                spinner.style.display = 'none';
                text.textContent = 'Populate';
            }
        });
    }

    // Add click handler for save prompts button
    const savePromptsBtn = document.getElementById('savePromptsBtn');
    if (savePromptsBtn) {
        savePromptsBtn.addEventListener('click', async () => {
            console.log('[DEBUG] Save prompts button clicked...');
            try {
                const prompts = {
                    issues: document.getElementById('promptIssues').value,
                    guidelines: document.getElementById('promptGuidelines').value,
                    noteGenerator: document.getElementById('promptNoteGenerator').value
                };
                const response = await fetch(`${window.SERVER_URL}/updatePrompts`, {
                    method: 'POST',
                    headers: { 
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${await auth.currentUser.getIdToken()}`
                    },
                    body: JSON.stringify({ updatedPrompts: prompts })
                });
                const data = await response.json();
                if (data.success) {
                    alert('Prompts saved successfully!');
                } else {
                    throw new Error(data.message || 'Failed to save prompts');
                }
            } catch (error) {
                console.error('Failed to save prompts:', error);
                alert('Failed to save prompts: ' + error.message);
            }
        });
    }

    // Add click handlers for test buttons
    const testServerBtn = document.getElementById('testServerBtn');
    const testGitHubBtn = document.getElementById('testGitHubBtn');
    const testOpenAIBtn = document.getElementById('testOpenAIBtn');

    if (testServerBtn) {
        testServerBtn.addEventListener('click', async () => {
            console.log('[DEBUG] Test server button clicked...');
            try {
                const response = await fetch(`${window.SERVER_URL}/test`);
                const data = await response.json();
                alert(data.message || 'Server is running!');
            } catch (error) {
                console.error('Server test failed:', error);
                alert('Server test failed: ' + error.message);
            }
        });
    }

    if (testGitHubBtn) {
        testGitHubBtn.addEventListener('click', async () => {
            console.log('[DEBUG] Test GitHub button clicked...');
            try {
                const response = await fetch(`${window.SERVER_URL}/testGitHub`);
                const data = await response.json();
                alert(data.message || 'GitHub access is working!');
            } catch (error) {
                console.error('GitHub test failed:', error);
                alert('GitHub test failed: ' + error.message);
            }
        });
    }
        
    if (testOpenAIBtn) {
        testOpenAIBtn.addEventListener('click', async () => {
            console.log('[DEBUG] Test OpenAI button clicked...');
            try {
                const response = await fetch(`${window.SERVER_URL}/testOpenAI`);
                const data = await response.json();
                alert(data.message || 'OpenAI access is working!');
            } catch (error) {
                console.error('OpenAI test failed:', error);
                alert('OpenAI test failed: ' + error.message);
            }
        });
    }

    // Listen for changes on the main text input to auto-save
    const userInput = document.getElementById('userInput');
    if (userInput) {
        userInput.addEventListener('input', debouncedSaveState);
    }

    // --- Speech Recognition Setup ---
    const recordBtn = document.getElementById('recordBtn');
    const userInputEl = document.getElementById('userInput');
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    let recognition;
    let isRecording = false;
    let finalTranscript = '';

    if (SpeechRecognition) {
        recognition = new SpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = 'en-US';

        recognition.onstart = () => {
            isRecording = true;
            finalTranscript = userInputEl.value;
            recordBtn.classList.add('recording');
            recordBtn.innerHTML = `<span id="recordSymbol" class="record-symbol"></span>Stop`;
            console.log('Speech recognition started.');
        };

        recognition.onend = () => {
            isRecording = false;
            recordBtn.classList.remove('recording');
            recordBtn.innerHTML = `<span id="recordSymbol" class="record-symbol"></span>Record`;
            debouncedSaveState();
            console.log('Speech recognition ended.');
        };

        recognition.onerror = (event) => {
            console.error('Speech recognition error:', event.error);
            alert(`Speech recognition error: ${event.error}. Please ensure microphone access is granted.`);
            isRecording = false;
        };

        recognition.onresult = (event) => {
            let interimTranscript = '';
            let currentFinalTranscript = '';

            for (let i = event.resultIndex; i < event.results.length; ++i) {
                const transcriptPart = event.results[i][0].transcript;
                if (event.results[i].isFinal) {
                    currentFinalTranscript += transcriptPart;
                } else {
                    interimTranscript += transcriptPart;
                }
            }
            
            // Append newly finalized parts to the stored final transcript
            if (currentFinalTranscript) {
                // Add a space if the previous text doesn't end with one
                if (finalTranscript.length > 0 && !/\s$/.test(finalTranscript)) {
                    finalTranscript += ' ';
                }
                finalTranscript += currentFinalTranscript;
            }

            userInputEl.value = finalTranscript + interimTranscript;
        };

        recordBtn.addEventListener('click', () => {
            if (isRecording) {
                recognition.stop();
            } else {
                recognition.start();
            }
        });

    } else {
        console.warn('Speech Recognition not supported by this browser.');
        if (recordBtn) recordBtn.style.display = 'none';
    }
    // --- End Speech Recognition ---
});

// Logging utility
const Logger = {
    levels: {
        DEBUG: 'debug',
        INFO: 'info',
        WARN: 'warn',
        ERROR: 'error'
    },
    
    _formatMessage(level, message, data = null) {
        const timestamp = new Date().toISOString();
        const formattedMessage = `[${timestamp}] [${level.toUpperCase()}] ${message}`;
        return data ? `${formattedMessage} ${JSON.stringify(data)}` : formattedMessage;
    },
    
    debug(message, data = null) {
        if (process.env.NODE_ENV === 'development') {
            console.debug(this._formatMessage(this.levels.DEBUG, message, data));
        }
    },
    
    info(message, data = null) {
        console.info(this._formatMessage(this.levels.INFO, message, data));
    },
    
    warn(message, data = null) {
        console.warn(this._formatMessage(this.levels.WARN, message, data));
    },
    
    error(message, data = null) {
        console.error(this._formatMessage(this.levels.ERROR, message, data));
    }
};

// Replace console.log calls with Logger
// Example usage:
// Logger.debug('Starting initializeApp...');
// Logger.info('Application initialized successfully', { userId: user.uid });
// Logger.error('Failed to load data', { error: error.message, stack: error.stack });

// Make dynamic advice functions globally accessible for onclick handlers
window.handleSuggestionAction = handleSuggestionAction;
window.confirmModification = confirmModification;
window.cancelModification = cancelModification;
window.copyUpdatedTranscript = copyUpdatedTranscript;
window.replaceOriginalTranscript = replaceOriginalTranscript;
window.applyAllDecisions = applyAllDecisions;
window.generateFakeClinicalInteraction = generateFakeClinicalInteraction;
window.switchChat = switchChat;
window.deleteChat = deleteChat;
window.startNewChat = startNewChat;

// Show clinical issues dropdown in summary1
async function showClinicalIssuesDropdown() {
    console.log('[DEBUG] showClinicalIssuesDropdown called');
    
    try {
        // Load clinical issues from JSON file
        const response = await fetch('./clinical_issues.json');
        if (!response.ok) {
            throw new Error(`Failed to load clinical issues: ${response.status}`);
        }
        
        const clinicalIssues = await response.json();
        console.log('[DEBUG] Loaded clinical issues:', {
            obstetrics: clinicalIssues.obstetrics?.length,
            gynecology: clinicalIssues.gynecology?.length
        });
        
        // Create dropdown HTML
        let dropdownHtml = `
            <div class="clinical-issues-selector">
                <h3>⚡ Load Clinical Clerking (Fast Mode)</h3>
                <p>Select a clinical issue to instantly load a realistic pre-generated clinical clerking using SBAR format:</p>
                
                <div class="issue-category">
                    <h4>Clinical Issues</h4>
                    <select id="clinical-issues-dropdown" class="clinical-dropdown">
                        <option value="">Select a clinical issue...</option>
                        <optgroup label="Obstetrics">
        `;
        
        // Add obstetrics options
        clinicalIssues.obstetrics.forEach((issue, index) => {
            dropdownHtml += `<option value="${issue}">${issue}</option>`;
        });
        
        dropdownHtml += `
                        </optgroup>
                        <optgroup label="Gynecology">
        `;
        
        // Add gynecology options
        clinicalIssues.gynecology.forEach((issue, index) => {
            dropdownHtml += `<option value="${issue}">${issue}</option>`;
        });
        
        dropdownHtml += `
                        </optgroup>
                    </select>
                </div>
                
                <div class="action-buttons">
                    <button id="generate-interaction-btn" class="nav-btn primary" disabled>
                        <span id="generate-spinner" class="spinner" style="display: none;"></span>
                        <span id="generate-text">Load Clerking</span>
                    </button>
                    <button id="cancel-generation-btn" class="nav-btn secondary">Cancel</button>
                </div>
                
                <div id="generation-status" class="generation-status" style="display: none;"></div>
            </div>
        `;
        
        // Display in summary1
        appendToSummary1(dropdownHtml, true); // Clear existing content
        
        // Add event listeners for the single dropdown
        const clinicalDropdown = document.getElementById('clinical-issues-dropdown');
        const generateBtn = document.getElementById('generate-interaction-btn');
        const cancelBtn = document.getElementById('cancel-generation-btn');
        
        function updateGenerateButton() {
            const selectedValue = clinicalDropdown?.value || '';
            const hasSelection = selectedValue.trim() !== '';
            
            if (generateBtn) {
                generateBtn.disabled = !hasSelection;
            }
        }
        
        if (clinicalDropdown) {
            clinicalDropdown.addEventListener('change', updateGenerateButton);
        }
        
        if (generateBtn) {
            generateBtn.addEventListener('click', async () => {
                const selectedIssue = clinicalDropdown?.value || '';
                
                if (selectedIssue) {
                    await generateFakeClinicalInteraction(selectedIssue);
                }
            });
        }
        
        if (cancelBtn) {
            cancelBtn.addEventListener('click', () => {
                appendToSummary1('Clinical interaction generation cancelled.\n\n', true);
            });
        }
        
    } catch (error) {
        console.error('[DEBUG] Error showing clinical issues dropdown:', error);
        appendToSummary1(`❌ **Error loading clinical issues:** ${error.message}\n\nPlease try again or contact support.\n\n`, true);
    }
}

// Generate fake clinical interaction based on selected issue
async function generateFakeClinicalInteraction(selectedIssue) {
    console.log('[DEBUG] generateFakeClinicalInteraction called with:', selectedIssue);
    
    const generateBtn = document.getElementById('generate-interaction-btn');
    const generateSpinner = document.getElementById('generate-spinner');
    const generateText = document.getElementById('generate-text');
    const statusDiv = document.getElementById('generation-status');
    
    try {
        // Update UI to show loading state
        if (generateBtn) generateBtn.disabled = true;
        if (generateSpinner) generateSpinner.style.display = 'inline';
        if (generateText) generateText.textContent = 'Loading...';
        if (statusDiv) {
            statusDiv.style.display = 'block';
            statusDiv.innerHTML = `<p>📋 Loading pre-generated clinical interaction for: <strong>${selectedIssue}</strong></p>`;
        }
        
        // Load pre-generated fake transcripts from JSON file
        console.log('[DEBUG] Loading fake transcripts...');
        const transcriptsResponse = await fetch('./fake_transcripts.json');
        if (!transcriptsResponse.ok) {
            throw new Error(`Failed to load fake transcripts: ${transcriptsResponse.status}`);
        }
        
        const fakeTranscripts = await transcriptsResponse.json();
        console.log('[DEBUG] Loaded fake transcripts:', {
            obstetrics: Object.keys(fakeTranscripts.obstetrics || {}).length,
            gynecology: Object.keys(fakeTranscripts.gynecology || {}).length
        });
        
        // Find the transcript for the selected issue
        let transcript = null;
        let category = null;
        
        // Check obstetrics category
        if (fakeTranscripts.obstetrics && fakeTranscripts.obstetrics[selectedIssue]) {
            transcript = fakeTranscripts.obstetrics[selectedIssue];
            category = 'obstetrics';
        }
        // Check gynecology category
        else if (fakeTranscripts.gynecology && fakeTranscripts.gynecology[selectedIssue]) {
            transcript = fakeTranscripts.gynecology[selectedIssue];
            category = 'gynecology';
        }
        
        console.log('[DEBUG] Transcript lookup result:', {
            selectedIssue,
            foundTranscript: !!transcript,
            category,
            transcriptLength: transcript?.length,
            transcriptPreview: transcript ? transcript.substring(0, 200) + '...' : 'NO TRANSCRIPT'
        });
        
        if (!transcript) {
            throw new Error(`No pre-generated transcript found for clinical issue: ${selectedIssue}`);
        }
        
        // Update status
        if (statusDiv) {
            statusDiv.innerHTML = `<p>✅ Successfully loaded pre-generated clinical interaction for: <strong>${selectedIssue}</strong></p>`;
        }
        
        // Put the pre-generated transcript in the user input textarea
        const userInput = document.getElementById('userInput');
        console.log('[DEBUG] userInput element check:', {
            elementFound: !!userInput,
            elementId: userInput?.id,
            elementType: userInput?.tagName,
            hasTranscript: !!transcript,
            currentValue: userInput?.value?.length || 0
        });
        
        if (userInput && transcript) {
            userInput.value = transcript;
            console.log('[DEBUG] Transcript added to user input textarea:', {
                transcriptLength: transcript.length,
                newValueLength: userInput.value.length,
                assignmentSuccessful: userInput.value === transcript,
                preview: transcript.substring(0, 100) + '...'
            });
        } else {
            console.error('[DEBUG] Failed to add transcript to userInput:', {
                hasUserInput: !!userInput,
                hasTranscript: !!transcript,
                transcriptType: typeof transcript
            });
        }
        
        // Show success message in summary1 (append, don't clear)
        const successMessage = `## ✅ Clinical Interaction Loaded (Fast Mode)\n\n` +
                              `**Clinical Issue:** ${selectedIssue}\n\n` +
                              `**Category:** ${category}\n\n` +
                              `**Status:** Successfully loaded pre-generated clinical interaction scenario\n\n` +
                              `**Transcript Length:** ${transcript.length} characters (~${Math.round(transcript.split(' ').length)} words)\n\n` +
                              `**Performance:** ⚡ Instant loading from pre-generated database\n\n` +
                              `**Next Steps:** The transcript has been placed in the input area. You can now:\n` +
                              `- Use "Dynamic Advice" to get interactive suggestions based on clinical guidelines\n` +
                              `- Edit the transcript if needed before analysis\n` +
                              `- Save or clear the transcript using the respective buttons\n\n`;
        
        appendToSummary1(successMessage, false); // Don't clear existing content
        
    } catch (error) {
        console.error('[DEBUG] Error loading fake clinical interaction:', {
            error: error.message,
            stack: error.stack,
            selectedIssue
        });
        
        // Update UI to show error
        if (statusDiv) {
            statusDiv.innerHTML = `<p>❌ Error: ${error.message}</p>`;
        }
        
        // Show error message in summary1 (append, don't clear)
        const errorMessage = `## ❌ Loading Failed\n\n` +
                            `**Error:** ${error.message}\n\n` +
                            `**Selected Issue:** ${selectedIssue}\n\n` +
                            `This might indicate the transcript database needs to be regenerated or the selected issue is not available in the pre-generated transcripts.\n\n`;
        
        appendToSummary1(errorMessage, false); // Don't clear existing content
        
    } finally {
        // Reset button state
        if (generateBtn) generateBtn.disabled = false;
        if (generateSpinner) generateSpinner.style.display = 'none';
        if (generateText) generateText.textContent = 'Load Clerking';
        
        console.log('[DEBUG] generateFakeClinicalInteraction cleanup completed');
    }
}

// Comprehensive workflow processing function
async function processWorkflow() {
    console.log('[DEBUG] processWorkflow started');
    
    const processBtn = document.getElementById('processBtn');
    const processSpinner = document.getElementById('processSpinner');
    const originalText = processBtn?.textContent || 'Process';
    
    try {
        // Check if we have transcript content
        const transcript = document.getElementById('userInput').value;
        if (!transcript) {
            alert('Please enter some text first');
            return;
        }

        // Set loading state
        if (processBtn) processBtn.disabled = true;
        if (processSpinner) processSpinner.style.display = 'inline';

        // Initialize the workflow summary
        const workflowStart = '# Complete Workflow Processing\n\nStarting comprehensive analysis workflow...\n\n';
        appendToSummary1(workflowStart);

        console.log('[DEBUG] processWorkflow: Starting step 1 - Find Relevant Guidelines');
        
        // Step 1: Find Relevant Guidelines
        const step1Status = '## Step 1: Finding Relevant Guidelines\n\n';
        appendToSummary1(step1Status, false);
        
        try {
            await findRelevantGuidelines(true); // Suppress header since we show our own step header
            console.log('[DEBUG] processWorkflow: Step 1 completed successfully');
            
            const step1Complete = '✅ **Step 1 Complete:** Relevant guidelines identified\n\n';
            appendToSummary1(step1Complete, false);
            
        } catch (error) {
            console.error('[DEBUG] processWorkflow: Step 1 failed:', error.message);
            throw new Error(`Step 1 (Find Guidelines) failed: ${error.message}`);
        }

        // Check if we have relevant guidelines before proceeding
        if (!window.relevantGuidelines || window.relevantGuidelines.length === 0) {
            console.log('[DEBUG] processWorkflow: No relevant guidelines found, cannot proceed');
            throw new Error('No relevant guidelines were found. Cannot proceed with analysis.');
        }

        console.log('[DEBUG] processWorkflow: Starting step 2 - Check Against Guidelines');
        
        // Step 2: Check Against Guidelines
        const step2Status = '## Step 2: Analysing Against Guidelines\n\n';
        appendToSummary1(step2Status, false);
        
        try {
            await checkAgainstGuidelines(true); // Suppress header since we show our own step header
            console.log('[DEBUG] processWorkflow: Step 2 completed successfully');
            
            const step2Complete = '✅ **Step 2 Complete:** Guideline analysis finished\n\n';
            appendToSummary1(step2Complete, false);
            
        } catch (error) {
            console.error('[DEBUG] processWorkflow: Step 2 failed:', error.message);
            throw new Error(`Step 2 (Check Guidelines) failed: ${error.message}`);
        }

        // Check if we have analysis data before proceeding
        if (!window.latestAnalysis) {
            console.log('[DEBUG] processWorkflow: No analysis data found, cannot proceed');
            throw new Error('No analysis data was generated. Cannot proceed with dynamic advice.');
        }

        console.log('[DEBUG] processWorkflow: Starting step 3 - Make Advice Dynamic');
        
        // Step 3: Make Advice Dynamic
        const step3Status = '## Step 3: Creating Interactive Suggestions\n\n';
        appendToSummary1(step3Status, false);
        
        try {
            await dynamicAdvice(
                window.latestAnalysis.transcript,
                window.latestAnalysis.analysis,
                window.latestAnalysis.guidelineId,
                window.latestAnalysis.guidelineTitle
            );
            console.log('[DEBUG] processWorkflow: Step 3 completed successfully');
            
            const step3Complete = '✅ **Step 3 Complete:** Interactive suggestions ready\n\n';
            appendToSummary1(step3Complete, false);
            
            // Hide the "Make Advice Dynamic" button since it's now redundant
            const makeDynamicAdviceBtn = document.getElementById('makeDynamicAdviceBtn');
            if (makeDynamicAdviceBtn) {
                makeDynamicAdviceBtn.style.display = 'none';
                console.log('[DEBUG] processWorkflow: Hidden makeDynamicAdviceBtn as it\'s now redundant');
            }
            
        } catch (error) {
            console.error('[DEBUG] processWorkflow: Step 3 failed:', error.message);
            throw new Error(`Step 3 (Dynamic Advice) failed: ${error.message}`);
        }

        // Workflow completion summary
        const workflowComplete = `## 🎉 Workflow Complete!\n\n` +
                                `All three steps have been completed successfully:\n` +
                                `1. ✅ Found relevant guidelines\n` +
                                `2. ✅ Analyzed against most relevant guideline\n` +
                                `3. ✅ Generated interactive suggestions\n\n` +
                                `**Next Steps:** Review the suggestions above and make your decisions (Accept/Reject/Modify), then click "Apply All Decisions" to update your transcript.\n\n`;
        
        appendToSummary1(workflowComplete, false);
        
        console.log('[DEBUG] processWorkflow: Complete workflow finished successfully');

    } catch (error) {
        console.error('[DEBUG] processWorkflow: Workflow failed:', {
            error: error.message,
            stack: error.stack
        });
        
        // Display error in summary1
        const errorMessage = `\n❌ **Workflow Error:** ${error.message}\n\n` +
                            `The workflow was interrupted. You can try running individual steps manually or contact support if the problem persists.\n\n`;
        appendToSummary1(errorMessage, false);
        
        alert(`Workflow failed: ${error.message}`);
        
    } finally {
        // Reset button state
        if (processBtn) {
            processBtn.disabled = false;
            processBtn.textContent = originalText;
        }
        if (processSpinner) processSpinner.style.display = 'none';
        
        console.log('[DEBUG] processWorkflow: Cleanup completed');
    }
}

// --- Chat History Management ---

let saveStateTimeout = null;

function debouncedSaveState() {
    if (saveStateTimeout) {
        clearTimeout(saveStateTimeout);
    }
    saveStateTimeout = setTimeout(() => {
        saveCurrentChatState();
    }, 1500); // Save 1.5 seconds after the last change
}

function getChatState() {
    const userInput = document.getElementById('userInput');
    const summary1 = document.getElementById('summary1');
    return {
        userInputContent: userInput ? userInput.value : '',
        summary1Content: summary1 ? summary1.innerHTML : '',
        relevantGuidelines: window.relevantGuidelines,
        latestAnalysis: window.latestAnalysis,
        currentAdviceSession: window.currentAdviceSession,
        currentSuggestions: window.currentSuggestions,
        userDecisions: window.userDecisions,
        lastUpdatedTranscript: window.lastUpdatedTranscript
    };
}

function loadChatState(state) {
    document.getElementById('userInput').value = state.userInputContent || '';
    document.getElementById('summary1').innerHTML = state.summary1Content || '';
    window.relevantGuidelines = state.relevantGuidelines || null;
    window.latestAnalysis = state.latestAnalysis || null;
    window.currentAdviceSession = state.currentAdviceSession || null;
    window.currentSuggestions = state.currentSuggestions || [];
    window.userDecisions = state.userDecisions || {};
    window.lastUpdatedTranscript = state.lastUpdatedTranscript || null;
}

function saveCurrentChatState() {
    if (!currentChatId) return;

    const chatIndex = chatHistory.findIndex(chat => chat.id === currentChatId);
    if (chatIndex === -1) {
        console.warn(`Could not find chat with id ${currentChatId} to save.`);
        return;
    }

    const state = getChatState();
    const previewText = state.userInputContent.substring(0, 40).replace(/\n/g, ' ') || 'Empty chat';

    chatHistory[chatIndex].state = state;
    chatHistory[chatIndex].preview = `${previewText}...`;
    
    // Move the current chat to the top of the list
    const currentChat = chatHistory.splice(chatIndex, 1)[0];
    chatHistory.unshift(currentChat);
    
    localStorage.setItem('chatHistory', JSON.stringify(chatHistory));
    renderChatHistory(); // Re-render to show updated preview and order
    console.log(`[CHAT] Saved state for chat: ${currentChatId}`);
}

function startNewChat() {
    saveCurrentChatState(); // Save the state of the chat we are leaving

    const newChatId = Date.now();
    currentChatId = newChatId;

    const newChat = {
        id: newChatId,
        title: `Chat - ${new Date(newChatId).toLocaleString()}`,
        preview: 'New chat...',
        state: {
            userInputContent: '',
            summary1Content: ''
        }
    };
    
    chatHistory.unshift(newChat);
    loadChatState(newChat.state);

    localStorage.setItem('chatHistory', JSON.stringify(chatHistory));
    renderChatHistory();
    document.getElementById('userInput').focus();
    console.log(`[CHAT] Started new chat: ${newChatId}`);
}

function switchChat(chatId) {
    if (chatId === currentChatId) return;

    saveCurrentChatState(); // Save the current chat before switching

    const chat = chatHistory.find(c => c.id === chatId);
    if (chat) {
        currentChatId = chatId;
        loadChatState(chat.state);
        renderChatHistory();
        console.log(`[CHAT] Switched to chat: ${chatId}`);
    } else {
        console.error(`[CHAT] Could not find chat with id: ${chatId}`);
    }
}

function deleteChat(chatId, event) {
    event.stopPropagation(); // Prevent switchChat from firing

    if (!confirm('Are you sure you want to delete this chat?')) return;

    chatHistory = chatHistory.filter(c => c.id !== chatId);
    localStorage.setItem('chatHistory', JSON.stringify(chatHistory));

    if (currentChatId === chatId) {
        // If we deleted the active chat, load the newest one or start fresh
        if (chatHistory.length > 0) {
            switchChat(chatHistory[0].id);
        } else {
            startNewChat();
        }
    }
    
    renderChatHistory();
    console.log(`[CHAT] Deleted chat: ${chatId}`);
}


function renderChatHistory() {
    console.log('[DEBUG] renderChatHistory called');
    const historyList = document.getElementById('historyList');
    
    console.log('[DEBUG] renderChatHistory:', {
        historyListExists: !!historyList,
        chatHistoryLength: chatHistory.length,
        currentChatId: currentChatId,
        chatHistoryData: chatHistory
    });
    
    if (!historyList) {
        console.error('[DEBUG] historyList element not found!');
        return;
    }

    historyList.innerHTML = '';
    console.log('[DEBUG] Cleared historyList innerHTML');
    
    if (chatHistory.length === 0) {
        console.log('[DEBUG] No chat history to render');
        historyList.innerHTML = '<div class="no-chats">No chat history yet</div>';
        return;
    }
    
    chatHistory.forEach((chat, index) => {
        console.log(`[DEBUG] Rendering chat ${index}:`, {
            id: chat.id,
            title: chat.title,
            preview: chat.preview,
            isActive: chat.id === currentChatId
        });
        
        const item = document.createElement('div');
        item.className = `history-item ${chat.id === currentChatId ? 'active' : ''}`;
        item.setAttribute('data-chat-id', chat.id);
        item.onclick = () => switchChat(chat.id);
        
        item.innerHTML = `
            <div class="history-item-title">${chat.title}</div>
            <div class="history-item-preview">${chat.preview}</div>
            <button class="delete-chat-btn" onclick="deleteChat(${chat.id}, event)" title="Delete Chat">&times;</button>
        `;
        historyList.appendChild(item);
        console.log(`[DEBUG] Added chat item ${index} to historyList`);
    });
    
    console.log('[DEBUG] renderChatHistory completed, historyList.children.length:', historyList.children.length);
}

function initializeChatHistory() {
    console.log('[DEBUG] Initializing chat history...');
    
    // Check if required elements exist
    const historyList = document.getElementById('historyList');
    const historyColumn = document.getElementById('historyColumn');
    console.log('[DEBUG] DOM elements check:', {
        historyList: !!historyList,
        historyColumn: !!historyColumn,
        historyListDisplay: historyList ? getComputedStyle(historyList).display : 'not found',
        historyColumnDisplay: historyColumn ? getComputedStyle(historyColumn).display : 'not found'
    });
    
    // Check localStorage
    const savedHistory = localStorage.getItem('chatHistory');
    console.log('[DEBUG] localStorage check:', {
        hasSavedHistory: !!savedHistory,
        savedHistoryLength: savedHistory ? savedHistory.length : 0,
        savedHistoryPreview: savedHistory ? savedHistory.substring(0, 200) + '...' : 'none'
    });
    
    if (savedHistory) {
        try {
            chatHistory = JSON.parse(savedHistory);
            console.log('[DEBUG] Loaded chat history from localStorage:', {
                count: chatHistory.length,
                chatIds: chatHistory.map(c => c.id),
                firstChatPreview: chatHistory[0] ? {
                    id: chatHistory[0].id,
                    title: chatHistory[0].title,
                    preview: chatHistory[0].preview
                } : 'none'
            });
        } catch (error) {
            console.error('[DEBUG] Error parsing saved chat history:', error);
            chatHistory = [];
        }
    } else {
        console.log('[DEBUG] No saved chat history found');
        chatHistory = [];
    }

    // Always start with a fresh chat on client load
    console.log('[DEBUG] Starting fresh chat on client load');
    try {
        startNewChat();
        console.log('[DEBUG] Started new chat, currentChatId:', currentChatId);
    } catch (error) {
        console.error('[DEBUG] Error starting new chat:', error);
    }
    
    console.log('[DEBUG] About to call renderChatHistory...');
    renderChatHistory();
    console.log('[DEBUG] Chat history initialization completed');
}

// Add debugging to the main app initialization
async function initializeMainApp() {
    try {
        console.log('[DEBUG] Initializing main app features...');
        console.log('[DEBUG] DOM ready state:', document.readyState);
        console.log('[DEBUG] Available elements:', {
            historyList: !!document.getElementById('historyList'),
            historyColumn: !!document.getElementById('historyColumn'),
            transcriptColumn: !!document.getElementById('transcriptColumn'),
            userInput: !!document.getElementById('userInput'),
            summary1: !!document.getElementById('summary1')
        });
        
        // Initialize chat history
        console.log('[DEBUG] Calling initializeChatHistory...');
        initializeChatHistory();
        
        // Load guidelines from Firestore on app initialization
        console.log('[DEBUG] Loading guidelines from Firestore...');
        try {
            await window.loadGuidelinesFromFirestore();
            console.log('[DEBUG] Guidelines loaded successfully during initialization');
        } catch (error) {
            console.warn('[DEBUG] Error during initial loadGuidelinesFromFirestore call:', error.message);
            // Don't throw - allow app to continue functioning even if guidelines fail to load
        }
        
        console.log('[DEBUG] Main app initialization completed');
    } catch (error) {
        console.error('[DEBUG] Error initializing main app:', error);
        console.error('[DEBUG] Error stack:', error.stack);
    }
}

// Add debugging to the auth state change handler
window.auth.onAuthStateChanged(async (user) => {
    console.log('[DEBUG] Auth state changed:', {
        hasUser: !!user,
        userEmail: user?.email,
        userDisplayName: user?.displayName
    });
    
    const loading = document.getElementById('loading');
    const landingPage = document.getElementById('landingPage');
    const mainContent = document.getElementById('mainContent');

    console.log('[DEBUG] Page elements found:', {
        loading: !!loading,
        landingPage: !!landingPage,
        mainContent: !!mainContent
    });

    if (user) {
        console.log('[DEBUG] User authenticated, showing main content');
        loading.classList.add('hidden');
        landingPage.classList.add('hidden');
        mainContent.classList.remove('hidden');
        
        // Update user info
        const userLabel = document.getElementById('userLabel');
        const userName = document.getElementById('userName');
        if (userLabel && userName) {
            userName.textContent = user.displayName || user.email || 'User';
            userName.classList.remove('hidden');
            console.log('[DEBUG] Updated user info display');
        }
        
        // Small delay to ensure DOM is fully rendered
        setTimeout(async () => {
            console.log('[DEBUG] Delayed initialization starting...');
            await initializeMainApp();
        }, 100);
        
    } else {
        console.log('[DEBUG] User not authenticated, showing landing page');
        loading.classList.add('hidden');
        mainContent.classList.add('hidden');
        landingPage.classList.remove('hidden');
        
        // Set up Google Sign-in button listener
        setupGoogleSignIn();
    }
});

// Helper function to standardize guideline titles for better display
function standardizeGuidelineTitle(title, organisation) {
    if (!title) return 'Unknown Guideline';
    
    let standardized = title.trim();
    
    // Remove internal reference codes at the beginning
    standardized = standardized.replace(/^(MP|CG|SP|MD|GP|GAU)\d+\s*[-:]?\s*/i, '');
    
    // Remove common prefixes that don't add value
    standardized = standardized.replace(/^(Guideline|Protocol|Policy|Standard|Procedure)\s*[-:]?\s*/i, '');
    
    // Clean up version information in parentheses
    standardized = standardized.replace(/\s*\(v?\d+(\.\d+)?\)\s*$/i, '');
    standardized = standardized.replace(/\s*\(version\s*\d+(\.\d+)?\)\s*$/i, '');
    
    // Remove file extensions
    standardized = standardized.replace(/\.(pdf|doc|docx|txt)$/i, '');
    
    // Clean up redundant organization mentions in the title
    if (organisation) {
        const orgPatterns = [
            organisation,
            abbreviateOrganization(organisation),
            'NHS Trust',
            'Foundation Trust'
        ];
        
        orgPatterns.forEach(pattern => {
            if (pattern) {
                // Remove org name from end of title if it's already there
                const regex = new RegExp(`\\s*[-–—]?\\s*${pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'i');
                standardized = standardized.replace(regex, '');
            }
        });
    }
    
    // Common title improvements
    const titleMappings = {
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
    
    // Apply title mappings for common abbreviations
    Object.entries(titleMappings).forEach(([abbrev, full]) => {
        const regex = new RegExp(`\\b${abbrev}\\b`, 'gi');
        standardized = standardized.replace(regex, full);
    });
    
    // Capitalize appropriately
    standardized = standardized
        .split(' ')
        .map(word => {
            // Don't capitalize small connecting words unless they're at the start
            const smallWords = ['and', 'or', 'the', 'a', 'an', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by'];
            if (smallWords.includes(word.toLowerCase()) && standardized.indexOf(word) > 0) {
                return word.toLowerCase();
            }
            return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
        })
        .join(' ');
    
    // Ensure first character is capitalized
    standardized = standardized.charAt(0).toUpperCase() + standardized.slice(1);
    
    return standardized.trim();
}

function abbreviateOrganization(orgName) {
    if (!orgName) return '';
    
    const mapping = {
        // Major International Organizations
        'World Health Organization': 'WHO',
        'World Health Organisation': 'WHO',
        'WHO': 'WHO',
        
        // UK Organizations
        'Royal College of Obstetricians and Gynaecologists': 'RCOG',
        'Royal College of Obstetricians & Gynaecologists': 'RCOG',
        'RCOG': 'RCOG',
        'National Institute for Health and Care Excellence': 'NICE',
        'National Institute for Health and Clinical Excellence': 'NICE',
        'NICE': 'NICE',
        'British Medical Association': 'BMA',
        'BMA': 'BMA',
        'Royal College of Physicians': 'RCP',
        'RCP': 'RCP',
        'Royal College of Surgeons': 'RCS',
        'RCS': 'RCS',
        'Royal College of General Practitioners': 'RCGP',
        'RCGP': 'RCGP',
        'Royal College of Midwives': 'RCM',
        'RCM': 'RCM',
        'Royal College of Nursing': 'RCN',
        'RCN': 'RCN',
        
        // US Organizations
        'American College of Obstetricians and Gynecologists': 'ACOG',
        'American College of Obstetricians & Gynecologists': 'ACOG',
        'ACOG': 'ACOG',
        'American Medical Association': 'AMA',
        'AMA': 'AMA',
        'Centers for Disease Control and Prevention': 'CDC',
        'CDC': 'CDC',
        'Food and Drug Administration': 'FDA',
        'FDA': 'FDA',
        'American Academy of Pediatrics': 'AAP',
        'AAP': 'AAP',
        
        // European Organizations
        'European Society of Human Reproduction and Embryology': 'ESHRE',
        'ESHRE': 'ESHRE',
        'European Medicines Agency': 'EMA',
        'EMA': 'EMA',
        'European Society of Cardiology': 'ESC',
        'ESC': 'ESC',
        'International Federation of Gynecology and Obstetrics': 'FIGO',
        'International Federation of Gynaecology and Obstetrics': 'FIGO',
        'FIGO': 'FIGO',
        
        // Hospital Trusts and Local Organizations
        'University Hospitals Sussex NHS Foundation Trust': 'University Hospitals Sussex',
        'University Hospitals Sussex': 'University Hospitals Sussex',
        'Sussex University Hospitals': 'University Hospitals Sussex',
        'University Hospital Sussex': 'University Hospitals Sussex',
        'Brighton and Sussex University Hospitals': 'Brighton & Sussex UH',
        'Brighton & Sussex University Hospitals': 'Brighton & Sussex UH',
        'NHS Foundation Trust': 'NHS Trust',
        'Foundation Trust': 'NHS Trust',
        
        // Common Abbreviations and Variations
        'Department of Health': 'DOH',
        'Department of Health and Social Care': 'DHSC',
        'Public Health England': 'PHE',
        'Health and Safety Executive': 'HSE',
        'Medicines and Healthcare products Regulatory Agency': 'MHRA',
        'MHRA': 'MHRA',
        
        // Internal/Local Guidelines (make them more user-friendly)
        'Maternity Services': 'Maternity',
        'Obstetrics and Gynaecology': 'Obs & Gynae',
        'Obstetrics & Gynaecology': 'Obs & Gynae',
        'Emergency Department': 'Emergency Dept',
        'Accident and Emergency': 'A&E',
        'Intensive Care Unit': 'ICU',
        'Neonatal Intensive Care Unit': 'NICU',
        'Special Care Baby Unit': 'SCBU'
    };
    
    // Direct mapping first
    if (mapping[orgName]) {
        return mapping[orgName];
    }
    
    // Partial matching for complex names
    for (const [key, value] of Object.entries(mapping)) {
        if (orgName.toLowerCase().includes(key.toLowerCase()) || 
            key.toLowerCase().includes(orgName.toLowerCase())) {
            return value;
        }
    }
    
    // Special handling for internal codes and hospital names
    // Remove common suffixes that don't add value
    let cleaned = orgName
        .replace(/NHS Foundation Trust$/i, 'NHS Trust')
        .replace(/Foundation Trust$/i, 'NHS Trust')
        .replace(/University Hospitals?/i, 'UH')
        .replace(/Hospital Trust$/i, 'Hospital')
        .replace(/^(MP|CG|SP|MD|GP)\d+\s*-?\s*/i, '') // Remove internal codes like MP053, CG12004
        .trim();
    
    // If no match found, return the cleaned name (but truncated if too long)
    return cleaned.length > 25 ? cleaned.substring(0, 22) + '...' : cleaned;
}

// Function to enhance metadata for a guideline using AI
async function enhanceGuidelineMetadata(guidelineId, specificFields = null) {
    try {
        // Get user ID token
        const user = auth.currentUser;
        if (!user) {
            console.error('[METADATA] User not authenticated for metadata enhancement');
            return;
        }
        const idToken = await user.getIdToken();

        console.log(`[DEBUG] Enhancing metadata for guideline: ${guidelineId}`);

        const response = await fetch(`${window.SERVER_URL}/enhanceGuidelineMetadata`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${idToken}`
            },
            body: JSON.stringify({
                guidelineId,
                specificFields
            })
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || `Server error: ${response.status}`);
        }

        const result = await response.json();
        
        if (result.success) {
            console.log('[DEBUG] Metadata enhancement successful:', result);
            
            // Check if this should be silent (from auto-enhancement) or show a detailed message
            if (result.silent || window.enhancementInProgress) {
                // Silent mode - just log basic info
                console.log(`[METADATA] Enhanced ${result.enhancedFields?.length || 0} fields for guideline ${guidelineId}`);
            } else {
                // Interactive mode - build detailed message but still just log it
                let message = result.message + '\n\n';
                
                if (result.enhancedFields && result.enhancedFields.length > 0) {
                    message += 'Enhanced fields:\n';
                    result.enhancedFields.forEach(field => {
                        const action = field.action === 'added' ? 'Added' : 'Enhanced';
                        message += `• ${action} ${field.field}: "${field.newValue}"\n`;
                    });
                }
                
                if (result.errors && result.errors.length > 0) {
                    message += '\nWarnings:\n';
                    result.errors.forEach(error => {
                        message += `• ${error}\n`;
                    });
                }
                
                // Log the detailed result 
                console.log('[METADATA] Enhancement result:', message);
            }
            
            // Note: Guidelines are automatically updated in Firestore via the server
            // Avoiding reload to prevent infinite enhancement loops
            console.log('[DEBUG] Metadata enhancement completed - data updated in Firestore');
            
            return result;
        } else {
            throw new Error(result.error || 'Enhancement failed');
        }
        
    } catch (error) {
        console.error('[DEBUG] Error enhancing metadata:', error);
        console.error(`[METADATA] Enhancement failed: ${error.message}`);
        throw error;
    }
}

// Function to batch enhance metadata for multiple guidelines
async function batchEnhanceMetadata(guidelineIds, fieldsToEnhance = null) {
    try {
        // Get user ID token
        const user = auth.currentUser;
        if (!user) {
            console.error('[METADATA] User not authenticated for batch enhancement');
            return;
        }
        const idToken = await user.getIdToken();

        console.log(`[DEBUG] Batch enhancing metadata for ${guidelineIds.length} guidelines`);

        // Log progress instead of showing popup
        const progressMessage = `Starting batch enhancement for ${guidelineIds.length} guidelines...\nThis may take a few minutes.`;
        console.log('[METADATA] Batch enhancement starting:', progressMessage);

        const response = await fetch(`${window.SERVER_URL}/batchEnhanceMetadata`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${idToken}`
            },
            body: JSON.stringify({
                guidelineIds,
                fieldsToEnhance
            })
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || `Server error: ${response.status}`);
        }

        const result = await response.json();
        
        if (result.success) {
            console.log('[DEBUG] Batch metadata enhancement completed:', result);
            
            // Display summary results
            let message = result.message + '\n\n';
            message += `Summary:\n`;
            message += `• Total guidelines: ${result.summary.totalGuidelines}\n`;
            message += `• Successfully enhanced: ${result.summary.successful}\n`;
            message += `• Failed: ${result.summary.failed}\n`;
            message += `• Total fields enhanced: ${result.summary.totalFieldsEnhanced}\n`;
            
            if (result.summary.totalErrors > 0) {
                message += `• Total errors: ${result.summary.totalErrors}\n`;
            }
            
            // Log the batch result instead of showing popup
            console.log('[METADATA] Batch enhancement result:', message);
            
            // Note: Guidelines are automatically updated in Firestore via the server
            // Avoiding reload to prevent infinite enhancement loops
            console.log('[DEBUG] Batch enhancement completed - data updated in Firestore');
            
            return result;
        } else {
            throw new Error(result.error || 'Batch enhancement failed');
        }
        
    } catch (error) {
        console.error('[DEBUG] Error in batch enhancement:', error);
        console.error(`[METADATA] Batch enhancement failed: ${error.message}`);
        throw error;
    }
}

// Make functions globally available
window.enhanceGuidelineMetadata = enhanceGuidelineMetadata;
window.batchEnhanceMetadata = batchEnhanceMetadata;
window.checkMetadataCompleteness = checkMetadataCompleteness;
window.autoEnhanceIncompleteMetadata = autoEnhanceIncompleteMetadata;
window.showMetadataProgress = showMetadataProgress;
window.hideMetadataProgress = hideMetadataProgress;

// Function to show metadata enhancement progress to user
function showMetadataProgress(message, isComplete = false) {
    // Create or update progress notification
    let progressDiv = document.getElementById('metadata-progress');
    
    if (!progressDiv) {
        progressDiv = document.createElement('div');
        progressDiv.id = 'metadata-progress';
        progressDiv.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: #f0f9ff;
            border: 1px solid #0ea5e9;
            border-radius: 8px;
            padding: 12px 16px;
            max-width: 300px;
            z-index: 1000;
            font-size: 14px;
            box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
        `;
        document.body.appendChild(progressDiv);
    }
    
    progressDiv.innerHTML = `
        <div style="display: flex; align-items: center; gap: 8px;">
            ${isComplete ? 
                '<div style="width: 12px; height: 12px; background: #10b981; border-radius: 50%;"></div>' :
                '<div style="width: 12px; height: 12px; border: 2px solid #0ea5e9; border-top: 2px solid transparent; border-radius: 50%; animation: spin 1s linear infinite;"></div>'
            }
            <span>${message}</span>
        </div>
    `;
    
    // Add animation keyframe if not already added
    if (!document.getElementById('metadata-progress-styles')) {
        const style = document.createElement('style');
        style.id = 'metadata-progress-styles';
        style.textContent = `
            @keyframes spin {
                0% { transform: rotate(0deg); }
                100% { transform: rotate(360deg); }
            }
        `;
        document.head.appendChild(style);
    }
    
    // Auto-hide completed messages after 5 seconds
    if (isComplete) {
        setTimeout(() => {
            if (progressDiv && progressDiv.parentNode) {
                progressDiv.remove();
            }
        }, 5000);
    }
}

// Function to hide metadata progress
function hideMetadataProgress() {
    const progressDiv = document.getElementById('metadata-progress');
    if (progressDiv && progressDiv.parentNode) {
        progressDiv.remove();
    }
}

// Show guideline selection interface for multi-guideline dynamic advice
async function showGuidelineSelectionInterface(mostRelevantGuidelines) {
    console.log('[DEBUG] showGuidelineSelectionInterface called with', mostRelevantGuidelines.length, 'guidelines');

    // Create the selection interface HTML
    const selectionHtml = `
        <div class="guideline-selection-container">
            <div class="selection-header">
                <h3>🎯 Select Guidelines for Dynamic Advice</h3>
                <p>Choose which guidelines to include in your dynamic advice generation. Multiple guidelines will be processed in parallel for faster results.</p>
                <div class="selection-stats">
                    <span><strong>${mostRelevantGuidelines.length}</strong> most relevant guidelines available</span>
                </div>
            </div>
            
            <div class="selection-controls">
                <button type="button" class="selection-btn select-all-btn" onclick="selectAllGuidelines(true)">
                    ✅ Select All
                </button>
                <button type="button" class="selection-btn deselect-all-btn" onclick="selectAllGuidelines(false)">
                    ❌ Deselect All
                </button>
            </div>
            
            <div class="guidelines-selection-list">
                ${mostRelevantGuidelines.map((guideline, index) => {
                    const guidelineData = window.globalGuidelines[guideline.id];
                    const displayTitle = guidelineData?.humanFriendlyTitle || guidelineData?.title || guideline.title || guideline.id;
                    const organization = guidelineData?.organisation || 'Unknown';
                    const relevanceScore = guideline.relevance || 'N/A';
                    
                    return `
                        <div class="guideline-selection-item" data-guideline-id="${guideline.id}">
                            <div class="selection-checkbox">
                                <input type="checkbox" id="guideline-${index}" checked="checked" 
                                       data-guideline-id="${guideline.id}" class="guideline-checkbox">
                                <label for="guideline-${index}"></label>
                            </div>
                            <div class="guideline-info">
                                <div class="guideline-title">${displayTitle}</div>
                                <div class="guideline-meta">
                                    <span class="organization">${organization}</span>
                                    <span class="relevance-score">Relevance: ${relevanceScore}</span>
                                </div>
                            </div>
                            <div class="guideline-actions">
                                ${guidelineData?.downloadUrl ? `
                                    <a href="${guidelineData.downloadUrl}" target="_blank" class="pdf-link" title="Download PDF">
                                        📄 PDF
                                    </a>
                                ` : ''}
                            </div>
                        </div>
                    `;
                }).join('')}
            </div>
            
            <div class="selection-actions">
                <button type="button" class="action-btn primary generate-advice-btn" onclick="generateMultiGuidelineAdvice()">
                    <span class="btn-icon">🚀</span>
                    <span class="btn-text">Generate Dynamic Advice</span>
                    <span class="btn-spinner" style="display: none;">⏳</span>
                </button>
                <button type="button" class="action-btn secondary cancel-selection-btn" onclick="cancelGuidelineSelection()">
                    Cancel
                </button>
            </div>
            
            <div class="selection-info">
                <p><strong>How it works:</strong></p>
                <ul>
                    <li>Selected guidelines will be processed simultaneously for faster results</li>
                    <li>All "Very Important Recommendations" will be combined and presented together</li>
                    <li>You can accept, reject, or modify suggestions from all guidelines</li>
                    <li>Processing time scales with the number of selected guidelines</li>
                </ul>
            </div>
        </div>
        
        <style>
        .guideline-selection-container {
            background: #f8f9fa;
            border: 1px solid #dee2e6;
            border-radius: 8px;
            padding: 20px;
            margin: 20px 0;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        }
        
        .selection-header h3 {
            margin: 0 0 10px 0;
            color: #2c3e50;
            font-size: 1.2em;
        }
        
        .selection-header p {
            margin: 0 0 15px 0;
            color: #6c757d;
            line-height: 1.5;
        }
        
        .selection-stats {
            background: #e3f2fd;
            padding: 8px 12px;
            border-radius: 4px;
            font-size: 0.9em;
            color: #1976d2;
        }
        
        .selection-controls {
            margin: 15px 0;
            display: flex;
            gap: 10px;
        }
        
        .selection-btn {
            padding: 8px 16px;
            border: 1px solid #ddd;
            border-radius: 4px;
            background: white;
            cursor: pointer;
            font-size: 0.9em;
            transition: all 0.2s;
        }
        
        .selection-btn:hover {
            background: #f8f9fa;
            border-color: #007bff;
        }
        
        .guidelines-selection-list {
            max-height: 400px;
            overflow-y: auto;
            border: 1px solid #ddd;
            border-radius: 4px;
            background: white;
            margin: 15px 0;
        }
        
        .guideline-selection-item {
            display: flex;
            align-items: center;
            padding: 12px 15px;
            border-bottom: 1px solid #eee;
            transition: background 0.2s;
        }
        
        .guideline-selection-item:hover {
            background: #f8f9fa;
        }
        
        .guideline-selection-item:last-child {
            border-bottom: none;
        }
        
        .selection-checkbox {
            margin-right: 15px;
            position: relative;
        }
        
        .guideline-checkbox {
            width: 18px;
            height: 18px;
            cursor: pointer;
        }
        
        .guideline-info {
            flex: 1;
        }
        
        .guideline-title {
            font-weight: 500;
            color: #2c3e50;
            margin-bottom: 4px;
            line-height: 1.3;
        }
        
        .guideline-meta {
            display: flex;
            gap: 15px;
            font-size: 0.85em;
            color: #6c757d;
        }
        
        .organization {
            font-weight: 500;
        }
        
        .relevance-score {
            color: #28a745;
        }
        
        .guideline-actions {
            margin-left: 15px;
        }
        
        .pdf-link {
            text-decoration: none;
            color: #dc3545;
            font-size: 0.9em;
            padding: 4px 8px;
            border-radius: 3px;
            transition: background 0.2s;
        }
        
        .pdf-link:hover {
            background: #f8f9fa;
            text-decoration: none;
        }
        
        .selection-actions {
            margin: 20px 0 15px 0;
            display: flex;
            gap: 10px;
            align-items: center;
        }
        
        .action-btn {
            padding: 10px 20px;
            border: none;
            border-radius: 5px;
            cursor: pointer;
            font-size: 0.95em;
            font-weight: 500;
            display: flex;
            align-items: center;
            gap: 8px;
            transition: all 0.2s;
        }
        
        .action-btn.primary {
            background: #007bff;
            color: white;
        }
        
        .action-btn.primary:hover {
            background: #0056b3;
        }
        
        .action-btn.primary:disabled {
            background: #6c757d;
            cursor: not-allowed;
        }
        
        .action-btn.secondary {
            background: #6c757d;
            color: white;
        }
        
        .action-btn.secondary:hover {
            background: #545b62;
        }
        
        .selection-info {
            background: #fff3cd;
            border: 1px solid #ffeaa7;
            border-radius: 4px;
            padding: 15px;
            font-size: 0.9em;
        }
        
        .selection-info p {
            margin: 0 0 10px 0;
            font-weight: 500;
            color: #856404;
        }
        
        .selection-info ul {
            margin: 0;
            padding-left: 20px;
            color: #856404;
        }
        
        .selection-info li {
            margin-bottom: 5px;
            line-height: 1.4;
        }
        </style>
    `;

    // Display the selection interface
    appendToSummary1(selectionHtml, false);
    
    console.log('[DEBUG] Guideline selection interface displayed');
}

// Helper function to select/deselect all guidelines
function selectAllGuidelines(select) {
    const checkboxes = document.querySelectorAll('.guideline-checkbox');
    checkboxes.forEach(checkbox => {
        checkbox.checked = select;
    });
    
    console.log('[DEBUG] ' + (select ? 'Selected' : 'Deselected') + ' all guidelines');
}

// Cancel guideline selection
function cancelGuidelineSelection() {
    // Just scroll to the end, the selection interface will remain visible but user can continue with other actions
    console.log('[DEBUG] Guideline selection cancelled');
}

// Generate dynamic advice for multiple selected guidelines
async function generateMultiGuidelineAdvice() {
    console.log('[DEBUG] generateMultiGuidelineAdvice called');
    
    // Get selected guidelines
    const selectedCheckboxes = document.querySelectorAll('.guideline-checkbox:checked');
    const selectedGuidelineIds = Array.from(selectedCheckboxes).map(cb => cb.dataset.guidelineId);
    
    if (selectedGuidelineIds.length === 0) {
        alert('Please select at least one guideline to generate advice.');
        return;
    }
    
    console.log('[DEBUG] Selected guidelines:', {
        count: selectedGuidelineIds.length,
        ids: selectedGuidelineIds
    });
    
    // Update UI to show loading state
    const generateBtn = document.querySelector('.generate-advice-btn');
    const btnText = generateBtn.querySelector('.btn-text');
    const btnSpinner = generateBtn.querySelector('.btn-spinner');
    const btnIcon = generateBtn.querySelector('.btn-icon');
    
    const originalText = btnText.textContent;
    btnText.textContent = 'Processing Guidelines...';
    btnIcon.style.display = 'none';
    btnSpinner.style.display = 'inline';
    generateBtn.disabled = true;
    
    try {
        // Get the selected guidelines data
        const selectedGuidelines = selectedGuidelineIds.map(id => {
            const relevantGuideline = window.relevantGuidelines.find(g => g.id === id);
            const guidelineData = window.globalGuidelines[id];
            const displayTitle = guidelineData?.humanFriendlyTitle || guidelineData?.title || relevantGuideline?.title || id;
            
            return {
                id: id,
                title: displayTitle,
                relevance: relevantGuideline?.relevance || 'N/A',
                data: guidelineData
            };
        });
        
        console.log('[DEBUG] Processing selected guidelines:', selectedGuidelines.map(g => ({ id: g.id, title: g.title })));
        
        // Add progress message
        const progressHtml = `
            <div class="multi-guideline-progress">
                <h3>🔄 Processing Multiple Guidelines</h3>
                <p>Generating dynamic advice from ${selectedGuidelines.length} selected guideline${selectedGuidelines.length > 1 ? 's' : ''}...</p>
                <div class="processing-list">
                    ${selectedGuidelines.map(g => `
                        <div class="processing-item" data-guideline-id="${g.id}">
                            <span class="processing-status">⏳</span>
                            <span class="processing-title">${g.title}</span>
                        </div>
                    `).join('')}
                </div>
                <p><em>Guidelines are being processed in parallel for faster results.</em></p>
            </div>
            
            <style>
            .multi-guideline-progress {
                background: #e3f2fd;
                border: 1px solid #2196f3;
                border-radius: 8px;
                padding: 20px;
                margin: 20px 0;
            }
            
            .multi-guideline-progress h3 {
                margin: 0 0 10px 0;
                color: #1976d2;
            }
            
            .processing-list {
                margin: 15px 0;
            }
            
            .processing-item {
                display: flex;
                align-items: center;
                gap: 10px;
                padding: 5px 0;
                color: #1976d2;
            }
            
            .processing-status {
                width: 20px;
                text-align: center;
            }
            </style>
        `;
        
        appendToSummary1(progressHtml, false);
        
        // Call the multi-guideline dynamic advice function
        await multiGuidelineDynamicAdvice(selectedGuidelines);
        
    } catch (error) {
        console.error('[DEBUG] Error in generateMultiGuidelineAdvice:', error);
        
        const errorHtml = `
            <div class="multi-guideline-error">
                <h3>❌ Error Processing Guidelines</h3>
                <p><strong>Error:</strong> ${error.message}</p>
                <p>Please try again or select fewer guidelines.</p>
            </div>
        `;
        
        appendToSummary1(errorHtml, false);
        alert(`Error generating multi-guideline advice: ${error.message}`);
        
    } finally {
        // Reset button state
        btnText.textContent = originalText;
        btnIcon.style.display = 'inline';
        btnSpinner.style.display = 'none';
        generateBtn.disabled = false;
    }
}

// Multi-guideline dynamic advice - processes multiple guidelines in parallel
async function multiGuidelineDynamicAdvice(selectedGuidelines) {
    console.log('[DEBUG] multiGuidelineDynamicAdvice called with', selectedGuidelines.length, 'guidelines');
    
    try {
        // Get user ID token
        const user = auth.currentUser;
        if (!user) {
            throw new Error('User not authenticated');
        }
        
        const idToken = await user.getIdToken();
        
        // Update processing status for each guideline
        const updateProcessingStatus = (guidelineId, status, emoji = '⏳') => {
            const statusElement = document.querySelector(`[data-guideline-id="${guidelineId}"] .processing-status`);
            if (statusElement) {
                statusElement.textContent = emoji;
                console.log(`[DEBUG] Updated status for ${guidelineId}: ${status}`);
            }
        };
        
        // Process all guidelines in parallel
        console.log('[DEBUG] Starting parallel processing of guidelines...');
        
        const guidelinePromises = selectedGuidelines.map(async (guideline, index) => {
            try {
                updateProcessingStatus(guideline.id, 'processing', '🔄');
                
                console.log(`[DEBUG] Processing guideline ${index + 1}/${selectedGuidelines.length}: ${guideline.title}`);
                
                // Call the dynamicAdvice API for this specific guideline
                const response = await fetch(`${window.SERVER_URL}/dynamicAdvice`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${idToken}`
                    },
                    body: JSON.stringify({
                        transcript: window.latestAnalysis.transcript,
                        analysis: window.latestAnalysis.analysis,
                        guidelineId: guideline.id,
                        guidelineTitle: guideline.title
                    })
                });
                
                if (!response.ok) {
                    const errorText = await response.text();
                    throw new Error(`API error for ${guideline.title}: ${response.status} - ${errorText}`);
                }
                
                const result = await response.json();
                
                if (!result.success) {
                    throw new Error(result.error || `Dynamic advice generation failed for ${guideline.title}`);
                }
                
                updateProcessingStatus(guideline.id, 'completed', '✅');
                
                console.log(`[DEBUG] Successfully processed guideline: ${guideline.title}`, {
                    suggestionsCount: result.suggestions?.length || 0
                });
                
                return {
                    guideline: guideline,
                    result: result,
                    success: true
                };
                
            } catch (error) {
                console.error(`[DEBUG] Error processing guideline ${guideline.title}:`, error);
                updateProcessingStatus(guideline.id, 'error', '❌');
                
                return {
                    guideline: guideline,
                    error: error.message,
                    success: false
                };
            }
        });
        
        // Wait for all guidelines to be processed
        console.log('[DEBUG] Waiting for all guideline processing to complete...');
        const results = await Promise.all(guidelinePromises);
        
        // Separate successful and failed results
        const successfulResults = results.filter(r => r.success);
        const failedResults = results.filter(r => !r.success);
        
        console.log('[DEBUG] Processing completed:', {
            total: results.length,
            successful: successfulResults.length,
            failed: failedResults.length
        });
        
        // Update progress completion
        const progressContainer = document.querySelector('.multi-guideline-progress');
        if (progressContainer) {
            const completionHtml = `
                <div class="processing-completion">
                    <p><strong>Processing Complete!</strong></p>
                    <p>✅ Successfully processed: ${successfulResults.length} guidelines</p>
                    ${failedResults.length > 0 ? `<p>❌ Failed: ${failedResults.length} guidelines</p>` : ''}
                </div>
            `;
            progressContainer.innerHTML += completionHtml;
        }
        
        if (successfulResults.length === 0) {
            throw new Error('No guidelines were successfully processed. Please check the error messages above.');
        }
        
        // Combine and display all suggestions from successful results
        await displayCombinedSuggestions(successfulResults, failedResults);
        
        // Store session data globally (using the first successful result as base)
        const firstResult = successfulResults[0].result;
        currentAdviceSession = firstResult.sessionId;
        currentSuggestions = []; // Will be populated with combined suggestions
        userDecisions = {};
        
        console.log('[DEBUG] Multi-guideline dynamic advice completed successfully');
        
    } catch (error) {
        console.error('[DEBUG] Error in multiGuidelineDynamicAdvice:', error);
        
        const errorHtml = `
            <div class="multi-guideline-error">
                <h3>❌ Error Processing Multiple Guidelines</h3>
                <p><strong>Error:</strong> ${error.message}</p>
                <p>Please try again or contact support if the problem persists.</p>
            </div>
        `;
        appendToSummary1(errorHtml, false);
        
        throw error;
    }
}

// Display combined suggestions from multiple guidelines
async function displayCombinedSuggestions(successfulResults, failedResults) {
    console.log('[DEBUG] displayCombinedSuggestions called', {
        successfulCount: successfulResults.length,
        failedCount: failedResults.length
    });
    
    // Combine all suggestions from successful results
    let allSuggestions = [];
    let suggestionCounter = 1;
    
    successfulResults.forEach(result => {
        const guidelines = result.result.suggestions || [];
        guidelines.forEach(suggestion => {
            // Add guideline source information and renumber
            allSuggestions.push({
                ...suggestion,
                id: `multi_${suggestionCounter++}`,
                sourceGuideline: result.guideline.title,
                sourceGuidelineId: result.guideline.id,
                originalId: suggestion.id
            });
        });
    });
    
    console.log('[DEBUG] Combined suggestions:', {
        totalSuggestions: allSuggestions.length,
        byGuideline: successfulResults.map(r => ({
            guideline: r.guideline.title,
            suggestions: r.result.suggestions?.length || 0
        }))
    });
    
    // Group suggestions by priority and category for better organization
    const priorityOrder = { 'high': 1, 'medium': 2, 'low': 3 };
    allSuggestions.sort((a, b) => {
        const priorityA = priorityOrder[a.priority] || 2;
        const priorityB = priorityOrder[b.priority] || 2;
        return priorityA - priorityB;
    });
    
    // Create the combined suggestions header
    let combinedHtml = `
        <div class="combined-advice-container">
            <div class="combined-header">
                <h3>💡 Combined Interactive Suggestions</h3>
                <div class="combined-stats">
                    <p>Generated from <strong>${successfulResults.length}</strong> guideline${successfulResults.length > 1 ? 's' : ''} with <strong>${allSuggestions.length}</strong> total recommendation${allSuggestions.length !== 1 ? 's' : ''}</p>
                    <div class="source-guidelines">
                        <strong>Source Guidelines:</strong>
                        <ul>
                            ${successfulResults.map(r => `
                                <li>
                                    <span class="guideline-name">${r.guideline.title}</span>
                                    <span class="suggestion-count">(${r.result.suggestions?.length || 0} suggestions)</span>
                                </li>
                            `).join('')}
                        </ul>
                    </div>
                </div>
                ${failedResults.length > 0 ? `
                    <div class="failed-guidelines">
                        <p><strong>⚠️ Note:</strong> ${failedResults.length} guideline${failedResults.length > 1 ? 's' : ''} failed to process:</p>
                        <ul>
                            ${failedResults.map(r => `
                                <li>${r.guideline.title} - ${r.error}</li>
                            `).join('')}
                        </ul>
                    </div>
                ` : ''}
                <p class="advice-instructions">Review each suggestion below. You can <strong>Accept</strong>, <strong>Reject</strong>, or <strong>Modify</strong> the proposed changes. Suggestions are sorted by priority.</p>
            </div>
            <div class="suggestions-list">
    `;
    
    if (allSuggestions.length === 0) {
        combinedHtml += `
                <div class="no-suggestions">
                    <p>No specific suggestions were generated from the processed guidelines.</p>
                    <p>This may indicate that the clinical documentation already aligns well with the guideline recommendations.</p>
                </div>
        `;
    } else {
        // Add each combined suggestion
        allSuggestions.forEach((suggestion, index) => {
            const priorityClass = `priority-${suggestion.priority || 'medium'}`;
            const categoryIcon = getCategoryIcon(suggestion.category);
            
            combinedHtml += `
                <div class="suggestion-item ${priorityClass}" data-suggestion-id="${suggestion.id}">
                    <div class="suggestion-header">
                        <div class="suggestion-info">
                            <span class="category-icon">${categoryIcon}</span>
                            <span class="suggestion-id">#${index + 1}</span>
                            <span class="priority-badge ${priorityClass}">${suggestion.priority || 'medium'}</span>
                            <span class="source-guideline">from ${suggestion.sourceGuideline}</span>
                        </div>
                        <div class="guideline-ref">${suggestion.guidelineReference || ''}</div>
                    </div>
                    
                    <div class="suggestion-content">
                        ${suggestion.originalText ? `
                            <div class="original-text">
                                <label>${getOriginalTextLabel(suggestion.originalText, suggestion.category)}</label>
                                <div class="text-preview ${suggestion.category === 'addition' ? 'missing-element' : ''}">"${suggestion.originalText}"</div>
                            </div>
                        ` : ''}
                        
                        <div class="suggested-text">
                            <label>Suggested ${suggestion.category || 'change'}:</label>
                            <div class="text-preview suggested">"${suggestion.suggestedText}"</div>
                        </div>
                        
                        <div class="suggestion-context">
                            <label>Why this change is suggested:</label>
                            <p>${suggestion.context}</p>
                        </div>
                    </div>
                    
                    <div class="suggestion-actions">
                        <button class="action-btn accept-btn" onclick="handleSuggestionAction('${suggestion.id}', 'accept')">
                            ✅ Accept
                        </button>
                        <button class="action-btn reject-btn" onclick="handleSuggestionAction('${suggestion.id}', 'reject')">
                            ❌ Reject
                        </button>
                        <button class="action-btn modify-btn" onclick="handleSuggestionAction('${suggestion.id}', 'modify')">
                            ✏️ Modify
                        </button>
                    </div>
                    
                    <div class="modify-section" id="modify-${suggestion.id}" style="display: none;">
                        <label for="modify-text-${suggestion.id}">Your modified text:</label>
                        <textarea id="modify-text-${suggestion.id}" class="modify-textarea" 
                                  placeholder="Enter your custom text here...">${suggestion.suggestedText}</textarea>
                        <div class="modify-actions">
                            <button class="action-btn confirm-btn" onclick="confirmModification('${suggestion.id}')">
                                ✅ Confirm Modification
                            </button>
                            <button class="action-btn cancel-btn" onclick="cancelModification('${suggestion.id}')">
                                ❌ Cancel
                            </button>
                        </div>
                    </div>
                    
                    <div class="suggestion-status" id="status-${suggestion.id}" style="display: none;">
                        <!-- Status will be updated by JavaScript -->
                    </div>
                </div>
            `;
        });
    }
    
    combinedHtml += `
            </div>
            
            ${allSuggestions.length > 0 ? `
                <div class="combined-actions">
                    <div class="bulk-actions">
                        <h4>Bulk Actions</h4>
                        <div class="bulk-buttons">
                            <button class="action-btn bulk-accept-btn" onclick="bulkAcceptSuggestions('high')">
                                ✅ Accept All High Priority
                            </button>
                            <button class="action-btn bulk-accept-btn" onclick="bulkAcceptSuggestions('all')">
                                ✅ Accept All Suggestions
                            </button>
                            <button class="action-btn bulk-reject-btn" onclick="bulkRejectSuggestions('all')">
                                ❌ Reject All Suggestions
                            </button>
                        </div>
                    </div>
                    
                    <div class="final-actions">
                        <h4>Final Actions</h4>
                        <div class="decision-summary" id="decisionsSummary">
                            <p>Make your decisions above, then apply changes to your transcript.</p>
                        </div>
                        <div class="final-buttons">
                            <button class="action-btn primary apply-btn" onclick="applyAllDecisions()">
                                🚀 Apply All Decisions
                            </button>
                            <button class="action-btn secondary copy-btn" onclick="copyUpdatedTranscript()">
                                📋 Copy Updated Transcript
                            </button>
                        </div>
                    </div>
                </div>
            ` : ''}
        </div>
        
        <style>
        .combined-advice-container {
            background: #f8f9fa;
            border: 2px solid #007bff;
            border-radius: 8px;
            padding: 20px;
            margin: 20px 0;
        }
        
        .combined-header h3 {
            margin: 0 0 15px 0;
            color: #007bff;
            font-size: 1.3em;
        }
        
        .combined-stats {
            background: #e3f2fd;
            padding: 15px;
            border-radius: 6px;
            margin-bottom: 15px;
        }
        
        .combined-stats p {
            margin: 0 0 10px 0;
            font-weight: 500;
            color: #1976d2;
        }
        
        .source-guidelines ul {
            margin: 10px 0 0 0;
            padding-left: 20px;
        }
        
        .source-guidelines li {
            margin-bottom: 5px;
            color: #1976d2;
        }
        
        .guideline-name {
            font-weight: 500;
        }
        
        .suggestion-count {
            color: #666;
            font-size: 0.9em;
        }
        
        .failed-guidelines {
            background: #fff3cd;
            border: 1px solid #ffc107;
            border-radius: 4px;
            padding: 10px;
            margin-bottom: 15px;
        }
        
        .failed-guidelines p {
            margin: 0 0 5px 0;
            color: #856404;
            font-weight: 500;
        }
        
        .failed-guidelines ul {
            margin: 5px 0 0 0;
            padding-left: 20px;
            color: #856404;
        }
        
        .source-guideline {
            background: #e3f2fd;
            color: #1976d2;
            padding: 2px 6px;
            border-radius: 3px;
            font-size: 0.8em;
            font-weight: 500;
        }
        
        .combined-actions {
            margin-top: 30px;
            padding-top: 20px;
            border-top: 2px solid #dee2e6;
        }
        
        .bulk-actions, .final-actions {
            margin-bottom: 20px;
        }
        
        .bulk-actions h4, .final-actions h4 {
            margin: 0 0 10px 0;
            color: #495057;
        }
        
        .bulk-buttons, .final-buttons {
            display: flex;
            gap: 10px;
            flex-wrap: wrap;
        }
        
        .bulk-accept-btn {
            background: #28a745;
            color: white;
        }
        
        .bulk-reject-btn {
            background: #dc3545;
            color: white;
        }
        
        .decision-summary {
            background: #fff;
            border: 1px solid #dee2e6;
            border-radius: 4px;
            padding: 10px;
            margin-bottom: 10px;
            min-height: 40px;
        }
        
        .no-suggestions {
            text-align: center;
            padding: 40px 20px;
            color: #6c757d;
        }
        
        .no-suggestions p {
            margin-bottom: 10px;
        }
        </style>
    `;
    
    // Display the combined suggestions
    appendToSummary1(combinedHtml, false);
    
    // Update global suggestions for existing functionality
    currentSuggestions = allSuggestions;
    
    console.log('[DEBUG] Combined suggestions displayed successfully');
}

// Bulk accept suggestions based on priority filter
function bulkAcceptSuggestions(priorityFilter) {
    console.log('[DEBUG] bulkAcceptSuggestions called with filter:', priorityFilter);
    
    const suggestions = document.querySelectorAll('.suggestion-item');
    let actionCount = 0;
    
    suggestions.forEach(suggestionElement => {
        const suggestionId = suggestionElement.dataset.suggestionId;
        
        // Check if this suggestion matches the filter
        let shouldAccept = false;
        if (priorityFilter === 'all') {
            shouldAccept = true;
        } else if (priorityFilter === 'high') {
            const priorityBadge = suggestionElement.querySelector('.priority-badge');
            shouldAccept = priorityBadge && priorityBadge.textContent.trim() === 'high';
        }
        
        if (shouldAccept) {
            // Skip if already processed
            const statusElement = suggestionElement.querySelector(`#status-${suggestionId}`);
            if (statusElement && statusElement.style.display !== 'none') {
                return; // Already processed
            }
            
            handleSuggestionAction(suggestionId, 'accept');
            actionCount++;
        }
    });
    
    console.log(`[DEBUG] Bulk accepted ${actionCount} suggestions with filter: ${priorityFilter}`);
    
    // Update decisions summary
    setTimeout(() => {
        updateDecisionsSummary();
    }, 100);
}

// Bulk reject suggestions
function bulkRejectSuggestions(priorityFilter) {
    console.log('[DEBUG] bulkRejectSuggestions called with filter:', priorityFilter);
    
    const suggestions = document.querySelectorAll('.suggestion-item');
    let actionCount = 0;
    
    suggestions.forEach(suggestionElement => {
        const suggestionId = suggestionElement.dataset.suggestionId;
        
        // Check if this suggestion matches the filter
        let shouldReject = false;
        if (priorityFilter === 'all') {
            shouldReject = true;
        } else if (priorityFilter === 'high') {
            const priorityBadge = suggestionElement.querySelector('.priority-badge');
            shouldReject = priorityBadge && priorityBadge.textContent.trim() === 'high';
        }
        
        if (shouldReject) {
            // Skip if already processed
            const statusElement = suggestionElement.querySelector(`#status-${suggestionId}`);
            if (statusElement && statusElement.style.display !== 'none') {
                return; // Already processed
            }
            
            handleSuggestionAction(suggestionId, 'reject');
            actionCount++;
        }
    });
    
    console.log(`[DEBUG] Bulk rejected ${actionCount} suggestions with filter: ${priorityFilter}`);
    
    // Update decisions summary
    setTimeout(() => {
        updateDecisionsSummary();
    }, 100);
}

// Automatically generate combined interactive suggestions from multiple analysis results
async function generateCombinedInteractiveSuggestions(analysisResults) {
    console.log('[DEBUG] generateCombinedInteractiveSuggestions called with', analysisResults.length, 'results');

    try {
        // Get user ID token
        const user = auth.currentUser;
        if (!user) {
            throw new Error('User not authenticated');
        }
        
        const idToken = await user.getIdToken();
        
        // Prepare analysis data for each guideline
        const guidelineAnalyses = analysisResults.map(result => ({
            guidelineId: result.guideline,
            guidelineTitle: result.guidelineTitle || result.guideline,
            analysis: result.analysis
        }));

        console.log('[DEBUG] Sending multiple analyses to dynamicAdvice API');

        // Send all analyses to the dynamic advice API
        const response = await fetch(`${window.SERVER_URL}/multiGuidelineDynamicAdvice`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${idToken}`
            },
            body: JSON.stringify({
                transcript: window.latestAnalysis.transcript,
                guidelineAnalyses: guidelineAnalyses
            })
        });

        console.log('[DEBUG] Multi-guideline dynamic advice API response:', response.status);

        if (!response.ok) {
            const errorText = await response.text();
            console.error('[DEBUG] Multi-guideline API error:', errorText);
            throw new Error(`API error: ${response.status} - ${errorText}`);
        }

        const result = await response.json();
        console.log('[DEBUG] Multi-guideline API result:', {
            success: result.success,
            sessionId: result.sessionId,
            totalSuggestions: result.combinedSuggestions?.length
        });

        if (!result.success) {
            throw new Error(result.error || 'Multi-guideline dynamic advice generation failed');
        }

        // Store session data globally
        currentAdviceSession = result.sessionId;
        currentSuggestions = result.combinedSuggestions || [];
        userDecisions = {};

        // Display combined suggestions
        await displayCombinedInteractiveSuggestions(result.combinedSuggestions, result.guidelinesSummary);

        return result;

    } catch (error) {
        console.error('[DEBUG] Error generating combined suggestions:', error);
        
        // Fallback to single guideline approach
        console.log('[DEBUG] Falling back to single guideline dynamic advice');
        const firstResult = analysisResults[0];
        await dynamicAdvice(
            window.latestAnalysis.transcript, 
            firstResult.analysis, 
            firstResult.guideline, 
            firstResult.guidelineTitle || firstResult.guideline
        );
    }
}

// Display combined interactive suggestions from multiple guidelines
async function displayCombinedInteractiveSuggestions(suggestions, guidelinesSummary) {
    console.log('[DEBUG] displayCombinedInteractiveSuggestions called', {
        suggestionsCount: suggestions?.length,
        guidelinesSummary: guidelinesSummary?.length
    });

    if (!suggestions || suggestions.length === 0) {
        const noSuggestionsHtml = `
            <div class="dynamic-advice-container">
                <h3>💡 Combined Interactive Suggestions</h3>
                <p>No specific suggestions were generated from the multi-guideline analysis.</p>
                <p><em>Analyzed: ${guidelinesSummary?.length || 0} guidelines</em></p>
            </div>
        `;
        appendToSummary1(noSuggestionsHtml, false);
        return;
    }

    // Group suggestions by source guideline
    const suggestionsByGuideline = {};
    suggestions.forEach(suggestion => {
        const source = suggestion.sourceGuideline || 'Unknown Guideline';
        if (!suggestionsByGuideline[source]) {
            suggestionsByGuideline[source] = [];
        }
        suggestionsByGuideline[source].push(suggestion);
    });

    // Create bulk action controls
    const bulkControlsHtml = `
        <div class="bulk-actions">
            <h4>Bulk Actions</h4>
            <div class="bulk-buttons">
                <button onclick="bulkAcceptSuggestions('high')" class="bulk-btn accept-btn">Accept All High Priority</button>
                <button onclick="bulkRejectSuggestions('low')" class="bulk-btn reject-btn">Reject All Low Priority</button>
                <button onclick="bulkAcceptSuggestions('all')" class="bulk-btn accept-btn">Accept All</button>
                <button onclick="bulkRejectSuggestions('all')" class="bulk-btn reject-btn">Reject All</button>
            </div>
        </div>
    `;

    // Create suggestions HTML grouped by guideline
    let groupedSuggestionsHtml = '';
    let suggestionIndex = 1;

    Object.entries(suggestionsByGuideline).forEach(([guideline, guidelineSuggestions]) => {
        groupedSuggestionsHtml += `
            <div class="guideline-group">
                <h4 class="guideline-source">📋 From: ${guideline}</h4>
        `;

        guidelineSuggestions.forEach(suggestion => {
            const suggestionId = `suggestion-${suggestionIndex}`;
            const priorityClass = suggestion.priority === 'high' ? 'high' : 
                                   suggestion.priority === 'medium' ? 'medium' : 'low';
            const categoryIcon = getCategoryIcon(suggestion.category);
            const originalTextLabel = getOriginalTextLabel(suggestion.originalText, suggestion.category);
            
            groupedSuggestionsHtml += `
                <div class="suggestion-item ${priorityClass}" data-suggestion-id="${suggestionId}" data-source-guideline="${guideline}">
                    <div class="suggestion-header">
                        <span class="suggestion-icon">${suggestion.category === 'gap' ? '➕' : '✏️'}</span>
                        <span class="suggestion-number">#${suggestionIndex}</span>
                        <span class="priority-badge ${priorityClass}">${suggestion.priority}</span>
                        <span class="category-label">${categoryIcon} ${suggestion.category}</span>
                    </div>
                    
                    <div class="suggestion-content">
                        <h4>${suggestion.title || 'Suggestion'}</h4>
                        
                        ${suggestion.originalText ? `
                            <div class="original-text">
                                <strong>${originalTextLabel}:</strong>
                                <div class="text-content">"${suggestion.originalText}"</div>
                            </div>
                        ` : `
                            <div class="gap-identified">
                                <strong>Gap identified:</strong>
                                <div class="gap-content">"${suggestion.gapDescription || 'Missing documentation identified'}"</div>
                            </div>
                        `}
                        
                        <div class="suggested-text">
                            <strong>${suggestion.category === 'gap' ? 'Suggested addition:' : 'Suggested modification:'}</strong>
                            <div class="suggestion-text" id="suggestion-text-${suggestionId}">"${suggestion.suggestedText}"</div>
                        </div>
                        
                        <div class="suggestion-reason">
                            <strong>Why this change is suggested:</strong>
                            <p>${suggestion.reason}</p>
                        </div>
                    </div>
                    
                    <div class="suggestion-actions">
                        <button onclick="handleSuggestionAction('${suggestionId}', 'accept')" class="action-btn accept-btn" id="accept-${suggestionId}">✅ Accept</button>
                        <button onclick="handleSuggestionAction('${suggestionId}', 'reject')" class="action-btn reject-btn" id="reject-${suggestionId}">❌ Reject</button>
                        <button onclick="handleSuggestionAction('${suggestionId}', 'modify')" class="action-btn modify-btn" id="modify-${suggestionId}">✏️ Modify</button>
                    </div>
                    
                    <div class="modification-area" id="modification-${suggestionId}" style="display: none;">
                        <textarea id="modification-text-${suggestionId}" placeholder="Enter your modified version...">${suggestion.suggestedText}</textarea>
                        <div class="modification-buttons">
                            <button onclick="confirmModification('${suggestionId}')" class="action-btn accept-btn">Confirm</button>
                            <button onclick="cancelModification('${suggestionId}')" class="action-btn reject-btn">Cancel</button>
                        </div>
                    </div>
                    
                    <div class="suggestion-status" id="status-${suggestionId}"></div>
                </div>
            `;
            
            // Store suggestion data globally
            currentSuggestions.push({
                id: suggestionId,
                ...suggestion
            });
            
            suggestionIndex++;
        });

        groupedSuggestionsHtml += '</div>';
    });

    // Create the complete HTML
    const suggestionsHtml = `
        <div class="dynamic-advice-container multi-guideline">
            <div class="advice-header">
                <h3>💡 Combined Interactive Suggestions</h3>
                <p><em>From: ${guidelinesSummary?.length || Object.keys(suggestionsByGuideline).length} guidelines analyzed</em></p>
                <p class="advice-instructions">Review each suggestion below. You can <strong>Accept</strong>, <strong>Reject</strong>, or <strong>Modify</strong> the proposed changes.</p>
                <div class="advice-explanation">
                    <p><strong>Note:</strong> Some suggestions identify <em>missing elements</em> (gaps in documentation) rather than existing text that needs changes. These are marked with ⚠️ and represent content that should be added to improve compliance with guidelines.</p>
                </div>
            </div>
            
            ${bulkControlsHtml}
            
            <div class="suggestions-list">
                ${groupedSuggestionsHtml}
            </div>
            
            <div class="decisions-summary" id="decisions-summary">
                <div class="summary-stats">
                    <span id="accepted-count">0</span> accepted, 
                    <span id="rejected-count">0</span> rejected, 
                    <span id="modified-count">0</span> modified, 
                    <span id="pending-count">${suggestions.length}</span> pending
                </div>
            </div>
            
            <div class="apply-decisions">
                <button onclick="applyAllDecisions()" class="apply-btn" id="apply-decisions-btn" disabled>Apply All Decisions</button>
                <p class="apply-note">Review your decisions above, then click "Apply All Decisions" to update the transcript.</p>
            </div>
        </div>
    `;

    console.log('[DEBUG] displayCombinedInteractiveSuggestions: Adding suggestions HTML to summary1');
    appendToSummary1(suggestionsHtml, false);

    // Update the decisions summary
    updateDecisionsSummary();
}

// Use existing migrateNullMetadata endpoint for content repair
async function diagnoseAndRepairContent() {
    console.log('[CONTENT_REPAIR] Starting content repair using existing migrateNullMetadata endpoint...');
    
    try {
        // Get user ID token
        const user = auth.currentUser;
        if (!user) {
            throw new Error('User not authenticated');
        }
        
        const idToken = await user.getIdToken();
        
        // Show progress
        showMetadataProgress('🔍 Migrating null metadata and generating missing content...', false);
        
        // Call the existing migrateNullMetadata endpoint
        const response = await fetch(`${window.SERVER_URL}/migrateNullMetadata`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${idToken}`
            }
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Server error: ${response.status} - ${errorText}`);
        }

        const result = await response.json();
        
        console.log('[CONTENT_REPAIR] Migration complete:', result);
        
        if (result.success) {
            // Display results from the existing migration function
            let message = `🎉 Content Repair Complete!\n\n`;
            message += `📊 Migration Results:\n`;
            message += `• Total guidelines processed: ${result.total}\n`;
            message += `• Guidelines updated: ${result.updated}\n`;
            message += `• Migration errors: ${result.errors}\n\n`;
            
            if (result.details && result.details.length > 0) {
                message += `🔧 Updated Guidelines:\n`;
                result.details.slice(0, 5).forEach(detail => {
                    if (detail.updates) {
                        const updatedFields = Object.keys(detail.updates).join(', ');
                        message += `• ${detail.id}: ${updatedFields}\n`;
                    }
                });
                if (result.details.length > 5) {
                    message += `• ... and ${result.details.length - 5} more\n`;
                }
            }
            
            console.log('[CONTENT_REPAIR] Full results:', message);
            showMetadataProgress(`✅ Migration completed! Updated ${result.updated} guidelines`, true);
            
            // Reload guidelines to reflect the repairs
            setTimeout(() => {
                console.log('[CONTENT_REPAIR] Reloading guidelines after migration...');
                loadGuidelinesFromFirestore();
            }, 2000);
            
            return result;
        } else {
            throw new Error(result.error || 'Metadata migration failed');
        }
        
    } catch (error) {
        console.error('[CONTENT_REPAIR] Error:', error);
        showMetadataProgress(`❌ Content repair failed: ${error.message}`, true);
        throw error;
    }
}

// Function to check content status during load
function checkContentStatus(guidelines) {
    const stats = {
        total: guidelines.length,
        nullContent: 0,
        nullCondensed: 0,
        missingBoth: 0,
        hasContent: 0,
        hasCondensed: 0,
        fullyPopulated: 0
    };
    
    const problematicGuidelines = [];
    
    guidelines.forEach(guideline => {
        const hasContent = guideline.content && guideline.content !== null && guideline.content.trim().length > 0;
        const hasCondensed = guideline.condensed && guideline.condensed !== null && guideline.condensed.trim().length > 0;
        
        if (hasContent) stats.hasContent++;
        if (hasCondensed) stats.hasCondensed++;
        if (hasContent && hasCondensed) stats.fullyPopulated++;
        
        if (!hasContent) {
            stats.nullContent++;
            problematicGuidelines.push({
                id: guideline.id,
                title: guideline.title || guideline.humanFriendlyName || 'Unknown',
                issue: 'null_content'
            });
        }
        
        if (!hasCondensed) {
            stats.nullCondensed++;
            if (!problematicGuidelines.find(p => p.id === guideline.id)) {
                problematicGuidelines.push({
                    id: guideline.id,
                    title: guideline.title || guideline.humanFriendlyName || 'Unknown',
                    issue: 'null_condensed'
                });
            } else {
                // Update existing entry to indicate both are missing
                const existing = problematicGuidelines.find(p => p.id === guideline.id);
                existing.issue = 'missing_both';
            }
        }
        
        if (!hasContent && !hasCondensed) {
            stats.missingBoth++;
        }
    });
    
    return { stats, problematicGuidelines };
}

// Global function for manual content repair (can be called from console)
window.repairContent = async function() {
    console.log('🔧 Manual content repair triggered from console...');
    try {
        await diagnoseAndRepairContent();
        console.log('✅ Manual content repair completed successfully!');
    } catch (error) {
        console.error('❌ Manual content repair failed:', error);
    }
};

// Make content status checking available globally for debugging
window.checkContentStatus = checkContentStatus;
window.diagnoseAndRepairContent = diagnoseAndRepairContent;
