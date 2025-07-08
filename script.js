// Import Firebase instances from firebase-init.js
import { app, db, auth } from './firebase-init.js';
import { GoogleAuthProvider, signInWithPopup, onAuthStateChanged, signOut, signInWithRedirect, getRedirectResult } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import { getAnalytics } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-analytics.js';
import { doc, getDoc, setDoc } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

// Make auth available globally - ADD THIS LINE
window.auth = auth;

// Global variable to store relevant guidelines
let relevantGuidelines = null;

// PII Review Interface Function
async function showPIIReviewInterface(originalText, piiAnalysis) {
    return new Promise((resolve) => {
        // Create modal overlay
        const modal = document.createElement('div');
        modal.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.7);
            z-index: 10000;
            display: flex;
            justify-content: center;
            align-items: center;
            font-family: Arial, sans-serif;
        `;

        // Create modal content
        const modalContent = document.createElement('div');
        modalContent.style.cssText = `
            background: white;
            border-radius: 8px;
            padding: 20px;
            max-width: 800px;
            max-height: 80vh;
            overflow-y: auto;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
        `;

        // Get consolidated PII matches
        const consolidatedMatches = window.clinicalAnonymiser.consolidatePIIMatches(piiAnalysis.matches);
        
        // Create header
        const header = document.createElement('div');
        header.innerHTML = `
            <h2 style="margin: 0 0 20px 0; color: #d32f2f;">🔒 Privacy Review Required</h2>
            <p style="margin: 0 0 15px 0; color: #666;">
                The following personal information was detected in your transcript. 
                Please review each item and choose whether to replace it or keep it as is.
            </p>
            <div style="background: #fff3cd; border: 1px solid #ffeaa7; padding: 10px; border-radius: 4px; margin-bottom: 15px;">
                <strong>Risk Level:</strong> ${piiAnalysis.riskLevel.toUpperCase()}<br>
                <strong>PII Types:</strong> ${piiAnalysis.piiTypes.map(t => t.type).join(', ')}
            </div>
        `;

        // Create matches container
        const matchesContainer = document.createElement('div');
        matchesContainer.style.cssText = `
            margin: 15px 0;
            max-height: 400px;
            overflow-y: auto;
        `;

        // Track user decisions
        const userDecisions = new Map();
        let approvedMatches = 0;
        let totalMatches = consolidatedMatches.length;

        // Create match items
        consolidatedMatches.forEach((match, index) => {
            const matchDiv = document.createElement('div');
            matchDiv.style.cssText = `
                border: 1px solid #ddd;
                border-radius: 4px;
                padding: 10px;
                margin: 8px 0;
                background: #f9f9f9;
            `;

            const replacement = window.clinicalAnonymiser.getReplacementForMatch(match);
            
            matchDiv.innerHTML = `
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                    <strong style="color: #d32f2f;">${match.type}</strong>
                    <div>
                        <button class="replace-btn" data-index="${index}" style="
                            background: #4caf50;
                            color: white;
                            border: none;
                            padding: 5px 10px;
                            border-radius: 3px;
                            cursor: pointer;
                            margin-right: 5px;
                        ">Replace</button>
                        <button class="keep-btn" data-index="${index}" style="
                            background: #ff9800;
                            color: white;
                            border: none;
                            padding: 5px 10px;
                            border-radius: 3px;
                            cursor: pointer;
                        ">Keep</button>
                    </div>
                </div>
                <div style="margin-bottom: 8px;">
                    <strong>Original:</strong> <span style="background: #ffebee; padding: 2px 4px; border-radius: 2px;">${match.text}</span>
                </div>
                <div>
                    <strong>Replacement:</strong> <span style="background: #e8f5e8; padding: 2px 4px; border-radius: 2px;">${replacement}</span>
                </div>
            `;

            // Add event listeners
            const replaceBtn = matchDiv.querySelector('.replace-btn');
            const keepBtn = matchDiv.querySelector('.keep-btn');

            replaceBtn.addEventListener('click', () => {
                userDecisions.set(index, 'replace');
                replaceBtn.style.background = '#2e7d32';
                keepBtn.style.background = '#ccc';
                replaceBtn.disabled = true;
                keepBtn.disabled = true;
                approvedMatches++;
                updateSummary();
            });

            keepBtn.addEventListener('click', () => {
                userDecisions.set(index, 'keep');
                keepBtn.style.background = '#e65100';
                replaceBtn.style.background = '#ccc';
                replaceBtn.disabled = true;
                keepBtn.disabled = true;
                updateSummary();
            });

            matchesContainer.appendChild(matchDiv);
        });

        // Create summary section
        const summaryDiv = document.createElement('div');
        summaryDiv.style.cssText = `
            background: #f5f5f5;
            padding: 10px;
            border-radius: 4px;
            margin: 15px 0;
            text-align: center;
        `;

        function updateSummary() {
            const replacements = Array.from(userDecisions.values()).filter(d => d === 'replace').length;
            const kept = Array.from(userDecisions.values()).filter(d => d === 'keep').length;
            const totalReviewed = replacements + kept;
            
            summaryDiv.innerHTML = `
                <strong>Progress:</strong> ${totalReviewed}/${totalMatches} items reviewed<br>
                <strong>Replacements:</strong> ${replacements}<br>
                <strong>Kept:</strong> ${kept}
            `;
        }
        updateSummary();

        // Create action buttons
        const actionButtons = document.createElement('div');
        actionButtons.style.cssText = `
            display: flex;
            justify-content: space-between;
            margin-top: 20px;
            gap: 10px;
        `;

        const cancelBtn = document.createElement('button');
        cancelBtn.textContent = 'Cancel';
        cancelBtn.style.cssText = `
            background: #f44336;
            color: white;
            border: none;
            padding: 10px 20px;
            border-radius: 4px;
            cursor: pointer;
        `;
        cancelBtn.addEventListener('click', () => {
            document.body.removeChild(modal);
            resolve({ approved: false });
        });

        const approveBtn = document.createElement('button');
        approveBtn.textContent = 'Apply Anonymisation';
        approveBtn.style.cssText = `
            background: #2196f3;
            color: white;
            border: none;
            padding: 10px 20px;
            border-radius: 4px;
            cursor: pointer;
        `;
        approveBtn.addEventListener('click', () => {
            const totalReviewed = Array.from(userDecisions.values()).length;
            if (totalReviewed === totalMatches) {
                // Apply user decisions to create anonymised text
                let anonymisedText = originalText;
                const replacements = [];

                // Sort matches by position (last to first) to avoid index shifting
                const sortedMatches = consolidatedMatches
                    .map((match, index) => ({ ...match, originalIndex: index }))
                    .sort((a, b) => b.start - a.start);

                sortedMatches.forEach((match) => {
                    const decision = userDecisions.get(match.originalIndex);
                    if (decision === 'replace') {
                        const replacement = window.clinicalAnonymiser.getReplacementForMatch(match);
                        anonymisedText = anonymisedText.substring(0, match.start) + 
                                       replacement + 
                                       anonymisedText.substring(match.end);
                        replacements.push({
                            original: match.text,
                            replacement: replacement,
                            type: match.type
                        });
                    }
                });

                document.body.removeChild(modal);
                resolve({
                    approved: true,
                    anonymisedText: anonymisedText,
                    replacementsCount: replacements.length,
                    replacements: replacements
                });
            } else {
                alert('Please review all items before proceeding.');
            }
        });

        actionButtons.appendChild(cancelBtn);
        actionButtons.appendChild(approveBtn);

        // Assemble modal
        modalContent.appendChild(header);
        modalContent.appendChild(matchesContainer);
        modalContent.appendChild(summaryDiv);
        modalContent.appendChild(actionButtons);
        modal.appendChild(modalContent);

        // Add to page
        document.body.appendChild(modal);

        // Close on background click
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                document.body.removeChild(modal);
                resolve({ approved: false });
            }
        });
    });
}

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
    // console.log('[DEBUG] Stored relevant guidelines:', {
    //     total: window.relevantGuidelines.length,
    //     byCategory: {
    //         mostRelevant: window.relevantGuidelines.filter(g => g.category === 'mostRelevant').length,
    //         potentiallyRelevant: window.relevantGuidelines.filter(g => g.category === 'potentiallyRelevant').length,
    //         lessRelevant: window.relevantGuidelines.filter(g => g.category === 'lessRelevant').length
    //     },
    //     samples: window.relevantGuidelines.slice(0, 3).map(g => ({
    //         id: g.id, // Use the mapped 'id' property
    //         title: g.title.substring(0, 50) + '...',
    //         score: g.relevance,
    //         category: g.category
    //     }))
    // });

    let formattedGuidelines = '';

    // Helper function to create PDF download link
    function createPdfDownloadLink(guideline) {
        if (!guideline) {
            // console.warn('[DEBUG] No guideline provided to createPdfDownloadLink');
            return '';
        }

        // Enhanced debugging - log the full guideline object structure
        // console.log('[DEBUG] createPdfDownloadLink called with guideline:', {
        //     fullObject: guideline,
        //     allKeys: Object.keys(guideline),
        //     hasDownloadUrl: !!guideline.downloadUrl,
        //     hasOriginalFilename: !!guideline.originalFilename,
        //     hasFilename: !!guideline.filename,
        //     downloadUrlValue: guideline.downloadUrl,
        //     originalFilenameValue: guideline.originalFilename,
        //     filenameValue: guideline.filename,
        //     id: guideline.id,
        //     title: guideline.title
        // });

        // Only use downloadUrl field if available
        let downloadUrl;
        if (guideline.downloadUrl) {
            downloadUrl = guideline.downloadUrl;
            // console.log('[DEBUG] Using stored downloadUrl:', downloadUrl);
        } else if (guideline.originalFilename) {
            // Use original filename if available
            const encodedFilename = encodeURIComponent(guideline.originalFilename);
            downloadUrl = `https://github.com/iannouvel/clerky/raw/main/guidance/${encodedFilename}`;
            // console.log('[DEBUG] Constructed downloadUrl from originalFilename:', downloadUrl);
        } else {
            // No reliable download information available - don't show a link
            // console.warn('[DEBUG] No downloadUrl or originalFilename available for guideline:', {
            //     id: guideline.id,
            //     title: guideline.title,
            //     allAvailableFields: Object.keys(guideline),
            //     fullGuidelineObject: guideline
            // });
            // console.warn('[DEBUG] Database should provide downloadUrl or originalFilename field');
            return '';
        }
        
        // console.log('[DEBUG] Created PDF download link:', {
        //     guidelineId: guideline.id,
        //     guidelineTitle: guideline.title,
        //     downloadUrl: downloadUrl
        // });
        
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

    // Create and display the new guideline selection interface
    createGuidelineSelectionInterface(categories, allRelevantGuidelines);
}

// New function to create guideline selection interface with checkboxes
function createGuidelineSelectionInterface(categories, allRelevantGuidelines) {
    console.log('[DEBUG] createGuidelineSelectionInterface called with:', {
        categories: categories,
        allRelevantGuidelinesLength: allRelevantGuidelines?.length || 0
    });

    // Store ALL relevant guidelines (exclude notRelevant) globally
    const allRelevantGuidelinesArray = [
        ...(categories.mostRelevant || []).map(g => ({...g, category: 'mostRelevant'})),
        ...(categories.potentiallyRelevant || []).map(g => ({...g, category: 'potentiallyRelevant'})),
        ...(categories.lessRelevant || []).map(g => ({...g, category: 'lessRelevant'}))
        // Exclude notRelevant as they're truly not applicable for checking
    ];

    // Helper function to extract numeric relevance score (redefined for scope)
    function extractRelevanceScoreLocal(relevanceText) {
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

    window.relevantGuidelines = allRelevantGuidelinesArray.map(g => ({
        id: g.id, // Use clean document ID only
        title: g.title,
        filename: g.filename || g.title, // Keep both for compatibility
        originalFilename: g.originalFilename || g.title, // Preserve original filename if available
        downloadUrl: g.downloadUrl, // Preserve downloadUrl if available
        relevance: extractRelevanceScoreLocal(g.relevance), // Convert to numeric score
        category: g.category,
        originalRelevance: g.relevance, // Keep original for display purposes
        organisation: g.organisation // Preserve organisation for display
    }));

    console.log('[DEBUG] Set window.relevantGuidelines:', {
        total: window.relevantGuidelines.length,
        byCategory: {
            mostRelevant: window.relevantGuidelines.filter(g => g.category === 'mostRelevant').length,
            potentiallyRelevant: window.relevantGuidelines.filter(g => g.category === 'potentiallyRelevant').length,
            lessRelevant: window.relevantGuidelines.filter(g => g.category === 'lessRelevant').length
        }
    });

    // Helper function to create PDF download link
    function createPdfDownloadLink(guideline) {
        if (!guideline) return '';

        let downloadUrl;
        if (guideline.downloadUrl) {
            downloadUrl = guideline.downloadUrl;
        } else if (guideline.originalFilename) {
            const encodedFilename = encodeURIComponent(guideline.originalFilename);
            downloadUrl = `https://github.com/iannouvel/clerky/raw/main/guidance/${encodedFilename}`;
        } else {
            return '';
        }
        
        return `<a href="${downloadUrl}" target="_blank" title="Download PDF" class="pdf-download-link">📄</a>`;
    }

    // Helper function to format relevance score
    function formatRelevanceScore(relevanceValue) {
        console.log('[DEBUG] formatRelevanceScore called with:', {
            value: relevanceValue,
            type: typeof relevanceValue
        });
        
        // If it's already a number, format it nicely
        if (typeof relevanceValue === 'number') {
            const percentage = Math.round(relevanceValue * 100);
            return `${percentage}%`;
        }
        
        // If it's a string, extract numeric score
        if (typeof relevanceValue === 'string') {
            const numericScore = extractRelevanceScoreLocal(relevanceValue);
            const percentage = Math.round(numericScore * 100);
            console.log('[DEBUG] Extracted score:', {
                original: relevanceValue,
                numeric: numericScore,
                percentage: percentage
            });
            return `${percentage}%`;
        }
        
        // Fallback for unexpected types
        console.warn('[DEBUG] Unexpected relevance value type:', typeof relevanceValue, relevanceValue);
        return '50%';
    }

    // Create the new guideline selection interface
    let htmlContent = `
        <div class="guideline-selection-interface">
            <div class="selection-header">
                <h2>📋 Select Guidelines for Dynamic Advice</h2>
                <p>Check which guidelines to generate dynamic advice for. Most relevant guidelines are pre-selected.</p>
                <div class="selection-controls">
                    <button type="button" class="selection-btn select-all-btn" onclick="selectAllGuidelines(true)">
                        ✅ Select All
                    </button>
                    <button type="button" class="selection-btn deselect-all-btn" onclick="selectAllGuidelines(false)">
                        ❌ Deselect All
                    </button>
                    <button type="button" class="action-btn primary process-selected-btn" onclick="processSelectedGuidelines()">
                        <span class="btn-icon">🚀</span>
                        <span class="btn-text">Process Selected Guidelines</span>
                    </button>
                </div>
            </div>
    `;

    // Add Most Relevant Guidelines (auto-checked)
    if (categories.mostRelevant && categories.mostRelevant.length > 0) {
        htmlContent += '<div class="guideline-category"><h3>🎯 Most Relevant Guidelines</h3><div class="guidelines-list">';
        categories.mostRelevant.forEach((g, index) => {
            const pdfLink = createPdfDownloadLink(g);
            const standardizedTitle = standardizeGuidelineTitle(g.title, g.organisation);
            const orgDisplay = g.organisation ? ` - ${abbreviateOrganization(g.organisation)}` : '';
            
            htmlContent += `
                <div class="guideline-item">
                    <label class="guideline-checkbox-label">
                        <input type="checkbox" 
                               class="guideline-checkbox" 
                               data-guideline-id="${g.id}" 
                               data-category="mostRelevant"
                               checked="checked">
                        <span class="checkmark"></span>
                        <div class="guideline-info">
                            <div class="guideline-title">${standardizedTitle}${orgDisplay}</div>
                            <div class="guideline-meta">
                                <span class="relevance">${formatRelevanceScore(g.relevance)}</span>
                                ${pdfLink}
                            </div>
                        </div>
                    </label>
                </div>
            `;
        });
        htmlContent += '</div></div>';
    }

    // Add Potentially Relevant Guidelines (not checked)
    if (categories.potentiallyRelevant && categories.potentiallyRelevant.length > 0) {
        htmlContent += '<div class="guideline-category"><h3>⚠️ Potentially Relevant Guidelines</h3><div class="guidelines-list">';
        categories.potentiallyRelevant.forEach((g, index) => {
            const pdfLink = createPdfDownloadLink(g);
            const standardizedTitle = standardizeGuidelineTitle(g.title, g.organisation);
            const orgDisplay = g.organisation ? ` - ${abbreviateOrganization(g.organisation)}` : '';
            
            htmlContent += `
                <div class="guideline-item">
                    <label class="guideline-checkbox-label">
                        <input type="checkbox" 
                               class="guideline-checkbox" 
                               data-guideline-id="${g.id}" 
                               data-category="potentiallyRelevant">
                        <span class="checkmark"></span>
                        <div class="guideline-info">
                            <div class="guideline-title">${standardizedTitle}${orgDisplay}</div>
                            <div class="guideline-meta">
                                <span class="relevance">${formatRelevanceScore(g.relevance)}</span>
                                ${pdfLink}
                            </div>
                        </div>
                    </label>
                </div>
            `;
        });
        htmlContent += '</div></div>';
    }

    // Add Less Relevant Guidelines (not checked)
    if (categories.lessRelevant && categories.lessRelevant.length > 0) {
        htmlContent += '<div class="guideline-category"><h3>📉 Less Relevant Guidelines</h3><div class="guidelines-list">';
        categories.lessRelevant.forEach((g, index) => {
            const pdfLink = createPdfDownloadLink(g);
            const standardizedTitle = standardizeGuidelineTitle(g.title, g.organisation);
            const orgDisplay = g.organisation ? ` - ${abbreviateOrganization(g.organisation)}` : '';
            
            htmlContent += `
                <div class="guideline-item">
                    <label class="guideline-checkbox-label">
                        <input type="checkbox" 
                               class="guideline-checkbox" 
                               data-guideline-id="${g.id}" 
                               data-category="lessRelevant">
                        <span class="checkmark"></span>
                        <div class="guideline-info">
                            <div class="guideline-title">${standardizedTitle}${orgDisplay}</div>
                            <div class="guideline-meta">
                                <span class="relevance">${formatRelevanceScore(g.relevance)}</span>
                                ${pdfLink}
                            </div>
                        </div>
                    </label>
                </div>
            `;
        });
        htmlContent += '</div></div>';
    }

    // Add Not Relevant Guidelines (for completeness, not checked)
    if (categories.notRelevant && categories.notRelevant.length > 0) {
        htmlContent += '<div class="guideline-category"><h3>❌ Not Relevant Guidelines</h3><div class="guidelines-list">';
        categories.notRelevant.forEach((g, index) => {
            const pdfLink = createPdfDownloadLink(g);
            const standardizedTitle = standardizeGuidelineTitle(g.title, g.organisation);
            const orgDisplay = g.organisation ? ` - ${abbreviateOrganization(g.organisation)}` : '';
            
            htmlContent += `
                <div class="guideline-item">
                    <label class="guideline-checkbox-label">
                        <input type="checkbox" 
                               class="guideline-checkbox" 
                               data-guideline-id="${g.id}" 
                               data-category="notRelevant">
                        <span class="checkmark"></span>
                        <div class="guideline-info">
                            <div class="guideline-title">${standardizedTitle}${orgDisplay}</div>
                            <div class="guideline-meta">
                                <span class="relevance">${formatRelevanceScore(g.relevance)}</span>
                                ${pdfLink}
                            </div>
                        </div>
                    </label>
                </div>
            `;
        });
        htmlContent += '</div></div>';
    }

    htmlContent += `
            <div class="selection-info">
                <p><strong>How it works:</strong> Selected guidelines will be processed one-by-one. After each guideline is processed and changes are incorporated into your transcript, the system will move to the next selected guideline.</p>
            </div>
        </div>
        
        <style>
        .guideline-selection-interface {
            background: #f8f9fa;
            border: 1px solid #dee2e6;
            border-radius: 8px;
            padding: 20px;
            margin: 20px 0;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        }
        
        .selection-header h2 {
            margin: 0 0 10px 0;
            color: #2c3e50;
            font-size: 1.3em;
        }
        
        .selection-header p {
            margin: 0 0 15px 0;
            color: #6c757d;
            line-height: 1.5;
        }
        
        .selection-controls {
            margin: 15px 0;
            display: flex;
            gap: 10px;
            flex-wrap: wrap;
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
        
        .guideline-selection-interface .action-btn {
            padding: 8px 16px;
            border: 1px solid #ddd;
            border-radius: 4px;
            cursor: pointer;
            font-size: 0.9em;
            transition: all 0.2s;
        }
        
        .action-btn.primary {
            background: #007bff;
            color: white;
            border-color: #007bff;
            font-weight: 500;
        }
        
        .selection-btn:hover {
            background: #f8f9fa;
            border-color: #007bff;
        }
        
        .guideline-selection-interface .action-btn:hover {
            background: #f8f9fa;
            border-color: #007bff;
        }
        
        .action-btn.primary:hover {
            background: #0056b3;
        }
        
        .guideline-category {
            margin: 20px 0;
        }
        
        .guideline-category h3 {
            margin: 0 0 10px 0;
            color: #2c3e50;
            font-size: 1.1em;
            border-bottom: 1px solid #dee2e6;
            padding-bottom: 5px;
        }
        
        .guidelines-list {
            border: 1px solid #ddd;
            border-radius: 4px;
            background: white;
        }
        
        .guideline-item {
            border-bottom: 1px solid #eee;
            transition: background 0.2s;
        }
        
        .guideline-item:hover {
            background: #f8f9fa;
        }
        
        .guideline-item:last-child {
            border-bottom: none;
        }
        
        .guideline-checkbox-label {
            display: flex;
            align-items: center;
            padding: 12px 15px;
            cursor: pointer;
            width: 100%;
        }
        
        .guideline-checkbox {
            margin-right: 12px;
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
            align-items: center;
            font-size: 0.85em;
            color: #6c757d;
        }
        
        .relevance {
            color: #28a745;
            font-weight: 500;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            max-width: 80px;
            display: inline-block;
        }
        
        .guideline-selection-interface .pdf-download-link {
            text-decoration: none !important;
            color: #dc3545 !important;
            font-size: 1.1em;
            background: none !important;
            padding: 0 !important;
            margin: 0 !important;
            border: none !important;
            box-shadow: none !important;
            border-radius: 0 !important;
            display: inline !important;
            width: auto !important;
            height: auto !important;
        }
        
        .selection-info {
            background: #e3f2fd;
            padding: 12px;
            border-radius: 4px;
            margin-top: 20px;
            font-size: 0.9em;
            color: #1976d2;
        }
        </style>
    `;

    htmlContent += `</div>`; // Close the main container div

    // Append the generated HTML to the summary view
    appendToSummary1(htmlContent, false);
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
    // Prevent multiple simultaneous guideline loads
    if (window.guidelinesLoading || window.guidelinesLoaded) {
        console.log('[DEBUG] ⏭️ Guidelines loading already in progress or completed, skipping...');
        
        // Return cached guidelines if available
        if (window.guidelines && window.guidelines.length > 0) {
            console.log('[DEBUG] Returning cached guidelines:', window.guidelines.length);
            return window.guidelines;
        }
        
        // If we don't have cached guidelines but think they're loaded, reset the flag
        console.log('[DEBUG] Guidelines marked as loaded but cache is empty, resetting...');
        window.guidelinesLoaded = false;
        window.guidelinesLoading = false;
    }
    
    window.guidelinesLoading = true;
    
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
        
        // NEW: Check content status and trigger immediate repair for any missing content
        const contentStatus = checkContentStatus(guidelines);
        console.log('[CONTENT_STATUS] Content analysis:', contentStatus.stats);
        
        // If ANY guidelines have missing content, trigger repair immediately
        if (contentStatus.stats.nullContent > 0 || contentStatus.stats.nullCondensed > 0) {
            console.warn('[CONTENT_STATUS] Missing content detected:', {
                nullContent: contentStatus.stats.nullContent,
                nullCondensed: contentStatus.stats.nullCondensed,
                missingBoth: contentStatus.stats.missingBoth
            });
            
            // Show content repair starting
            showMetadataProgress(`🔧 Found ${contentStatus.stats.nullContent + contentStatus.stats.nullCondensed} guidelines with missing content - starting automatic repair...`, false);
            
            // IMMEDIATELY trigger content repair for any missing content (with debouncing)
            if (!window.contentRepairInProgress) {
                console.log('[CONTENT_STATUS] Starting automatic content repair...');
                setTimeout(async () => {
                    try {
                        await diagnoseAndRepairContent();
                        console.log('[CONTENT_STATUS] Automatic content repair completed successfully');
                    } catch (error) {
                        console.error('[CONTENT_STATUS] Automatic content repair failed:', error);
                    }
                }, 1000); // Start immediately
            } else {
                console.log('[CONTENT_STATUS] Content repair already in progress, skipping...');
            }
        } else {
            console.log('[CONTENT_STATUS] All guidelines have complete content:', {
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
        window.guidelinesLoaded = true;
        return guidelines;
    } catch (error) {
        console.error('[DEBUG] Error loading guidelines from Firestore:', error);
        throw error;
    } finally {
        window.guidelinesLoading = false;
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

        // ANONYMISATION STEP: Check and anonymise clinical data before sending to server
        console.log('[ANONYMISER] Checking transcript for PII before processing...');
        let anonymisedTranscript = transcript;
        let anonymisationInfo = null;

        try {
            // Check if anonymiser is available
            if (typeof window.clinicalAnonymiser !== 'undefined') {
                // Check for PII first
                const piiAnalysis = await window.clinicalAnonymiser.checkForPII(transcript);
                console.log('[ANONYMISER] PII Analysis:', piiAnalysis);

                if (piiAnalysis.containsPII) {
                    console.log('[ANONYMISER] PII detected, showing review interface...');
                    
                    // Show PII review interface
                    const reviewResult = await showPIIReviewInterface(transcript, piiAnalysis);
                    
                    if (reviewResult.approved) {
                        // Use the user-approved anonymised text
                        anonymisedTranscript = reviewResult.anonymisedText;
                        anonymisationInfo = {
                            originalLength: transcript.length,
                            anonymisedLength: anonymisedTranscript.length,
                            replacementsCount: reviewResult.replacementsCount,
                            riskLevel: piiAnalysis.riskLevel,
                            piiTypes: piiAnalysis.piiTypes,
                            userReviewed: true
                        };

                        console.log('[ANONYMISER] User approved anonymisation:', anonymisationInfo);
                        
                        // Add anonymisation notice to the summary
                        const anonymisationNotice = `\n🔒 **Privacy Protection Applied (User Reviewed)**\n` +
                            `- Risk Level: ${piiAnalysis.riskLevel.toUpperCase()}\n` +
                            `- PII Types Found: ${piiAnalysis.piiTypes.map(t => t.type).join(', ')}\n` +
                            `- Replacements Made: ${reviewResult.replacementsCount}\n` +
                            `- Clinical Information: Preserved\n\n`;
                        appendToSummary1(anonymisationNotice, false);
                    } else {
                        // User cancelled the review, use original transcript
                        console.log('[ANONYMISER] User cancelled PII review, using original transcript');
                        anonymisedTranscript = transcript;
                        appendToSummary1('\n⚠️ **Privacy Note:** PII review was cancelled, using original data\n\n', false);
                    }
                } else {
                    console.log('[ANONYMISER] No significant PII detected');
                    appendToSummary1('\n✅ **Privacy Check:** No significant personal information detected\n\n', false);
                }
            } else {
                console.warn('[ANONYMISER] Anonymiser not available, using original transcript');
            }
        } catch (anonymisationError) {
            console.error('[ANONYMISER] Error during anonymisation:', anonymisationError);
            // Continue with original transcript if anonymisation fails
            anonymisedTranscript = transcript;
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
            transcriptLength: anonymisedTranscript.length,
            originalLength: transcript.length,
            guidelinesCount: guidelinesList.length,
            anonymisationApplied: anonymisationInfo !== null
        });

        const response = await fetch(`${window.SERVER_URL}/findRelevantGuidelines`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${idToken}`
            },
            body: JSON.stringify({
                transcript: anonymisedTranscript, // Use anonymised transcript
                guidelines: guidelinesList,
                anonymisationInfo: anonymisationInfo // Include anonymisation metadata
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
            downloadUrlValue: data.categories.mostRelevant?.[0] ? data.categories.mostRelevant[0].downloadUrl : 'no most relevant',
            sampleRelevanceValue: data.categories.mostRelevant?.[0] ? data.categories.mostRelevant[0].relevance : 'no most relevant',
            sampleRelevanceType: data.categories.mostRelevant?.[0] ? typeof data.categories.mostRelevant[0].relevance : 'no most relevant'
        });

        // Update progress with completion
        const completionMessage = 'Analysis complete! Categorising relevant guidelines...\n\n';
        appendToSummary1(completionMessage, false);

        // Process and display the results with the new selection interface
        createGuidelineSelectionInterface(data.categories, window.relevantGuidelines);

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

        // ANONYMISATION STEP: Check and anonymise clinical data before sending to server
        console.log('[ANONYMISER] Checking transcript for PII before generating clinical note...');
        let anonymisedTranscript = transcript;
        let anonymisationInfo = null;

        try {
            // Check if anonymiser is available
            if (typeof window.clinicalAnonymiser !== 'undefined') {
                // Check for PII first
                const piiAnalysis = await window.clinicalAnonymiser.checkForPII(transcript);
                console.log('[ANONYMISER] PII Analysis:', piiAnalysis);

                if (piiAnalysis.containsPII) {
                    console.log('[ANONYMISER] PII detected, showing review interface...');
                    
                    // Show PII review interface
                    const reviewResult = await showPIIReviewInterface(transcript, piiAnalysis);
                    
                    if (reviewResult.approved) {
                        // Use the user-approved anonymised text
                        anonymisedTranscript = reviewResult.anonymisedText;
                        anonymisationInfo = {
                            originalLength: transcript.length,
                            anonymisedLength: anonymisedTranscript.length,
                            replacementsCount: reviewResult.replacementsCount,
                            riskLevel: piiAnalysis.riskLevel,
                            piiTypes: piiAnalysis.piiTypes,
                            userReviewed: true
                        };

                        console.log('[ANONYMISER] User approved anonymisation:', anonymisationInfo);
                        
                        // Add anonymisation notice to the summary
                        const anonymisationNotice = `\n🔒 **Privacy Protection Applied (User Reviewed)**\n` +
                            `- Risk Level: ${piiAnalysis.riskLevel.toUpperCase()}\n` +
                            `- PII Types Found: ${piiAnalysis.piiTypes.map(t => t.type).join(', ')}\n` +
                            `- Replacements Made: ${reviewResult.replacementsCount}\n` +
                            `- Clinical Information: Preserved\n\n`;
                        appendToSummary1(anonymisationNotice, false);
                    } else {
                        // User cancelled the review, use original transcript
                        console.log('[ANONYMISER] User cancelled PII review, using original transcript');
                        anonymisedTranscript = transcript;
                        appendToSummary1('\n⚠️ **Privacy Note:** PII review was cancelled, using original data\n\n', false);
                    }
                } else {
                    console.log('[ANONYMISER] No significant PII detected');
                    appendToSummary1('\n✅ **Privacy Check:** No significant personal information detected\n\n', false);
                }
            } else {
                console.warn('[ANONYMISER] Anonymiser not available, using original transcript');
            }
        } catch (anonymisationError) {
            console.error('[ANONYMISER] Error during anonymisation:', anonymisationError);
            // Continue with original transcript if anonymisation fails
            anonymisedTranscript = transcript;
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
            body: JSON.stringify({ 
                transcript: anonymisedTranscript, // Use anonymised transcript
                anonymisationInfo: anonymisationInfo // Include anonymisation metadata
            })
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

        // Call the dynamicAdvice API with retry logic
        console.log('[DEBUG] dynamicAdvice: Calling API endpoint');
        let response;
        let retryCount = 0;
        const maxRetries = 3;
        
        while (retryCount <= maxRetries) {
            try {
                response = await fetch(`${window.SERVER_URL}/dynamicAdvice`, {
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
                
                // If successful, break out of retry loop
                if (response.ok) {
                    break;
                }
                
                // If 502/503/504 (server errors), retry
                if ([502, 503, 504].includes(response.status)) {
                    throw new Error(`Server error ${response.status} - retrying...`);
                }
                
                // For other errors, don't retry
                break;
                
            } catch (error) {
                retryCount++;
                console.log(`[DEBUG] dynamicAdvice: Attempt ${retryCount} failed:`, error.message);
                
                if (retryCount <= maxRetries) {
                    const waitTime = Math.min(1000 * Math.pow(2, retryCount - 1), 10000); // Exponential backoff, max 10s
                    console.log(`[DEBUG] dynamicAdvice: Waiting ${waitTime}ms before retry ${retryCount}/${maxRetries}`);
                    await new Promise(resolve => setTimeout(resolve, waitTime));
                } else {
                    throw error;
                }
            }
        }

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

        // Store session data globally and ensure unique suggestion IDs
        currentAdviceSession = result.sessionId;
        
        // Add session prefix to suggestion IDs to prevent conflicts in sequential processing
        const prefixedSuggestions = (result.suggestions || []).map(suggestion => ({
            ...suggestion,
            originalId: suggestion.id, // Keep original ID for server communication
            id: `${result.sessionId}-${suggestion.id}` // Use prefixed ID for DOM elements
        }));
        
        currentSuggestions = prefixedSuggestions;
        userDecisions = {};

        console.log('[DEBUG] dynamicAdvice: Stored session data', {
            sessionId: currentAdviceSession,
            suggestionsCount: currentSuggestions.length,
            firstSuggestionId: currentSuggestions[0]?.id,
            firstOriginalId: currentSuggestions[0]?.originalId
        });

        // Display interactive suggestions using appendToSummary1 (use prefixed suggestions)
        await displayInteractiveSuggestions(prefixedSuggestions, result.guidelineTitle);

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
        // Processing each suggestion

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
                    <button class="action-btn accept-btn" style="background: #27ae60 !important; color: white !important;" onclick="handleSuggestionAction('${suggestion.id}', 'accept')">
                        ✅ Accept
                    </button>
                    <button class="action-btn reject-btn" style="background: #e74c3c !important; color: white !important;" onclick="handleSuggestionAction('${suggestion.id}', 'reject')">
                        ❌ Reject
                    </button>
                    <button class="action-btn modify-btn" style="background: #f39c12 !important; color: white !important;" onclick="handleSuggestionAction('${suggestion.id}', 'modify')">
                        ✏️ Modify
                    </button>
                </div>
                
                <div class="modify-section" id="modify-${suggestion.id}" style="display: none;">
                    <label for="modify-text-${suggestion.id}">Your modified text:</label>
                    <textarea id="modify-text-${suggestion.id}" class="modify-textarea" 
                              placeholder="Enter your custom text here...">${suggestion.suggestedText}</textarea>
                    <div class="modify-actions">
                        <button class="action-btn confirm-btn" style="background: #00b894 !important; color: white !important;" onclick="confirmModification('${suggestion.id}')">
                            ✅ Confirm Modification
                        </button>
                        <button class="action-btn cancel-btn" style="background: #636e72 !important; color: white !important;" onclick="cancelModification('${suggestion.id}')">
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

    // Add apply all button (with unique IDs based on current session)
    const buttonId = `applyAllDecisionsBtn-${currentAdviceSession}`;
    const summaryId = `decisionsSummary-${currentAdviceSession}`;
    
    suggestionsHtml += `
            </div>
            <div class="advice-footer">
                <button id="${buttonId}" class="apply-all-btn" onclick="applyAllDecisions()" disabled>
                    <span class="apply-spinner" style="display: none;">⏳</span>
                    <span class="apply-text">Apply All Decisions</span>
                </button>
                <div class="decisions-summary" id="${summaryId}">
                    Make your decisions above, then click "Apply All Decisions" to update the transcript.
                </div>
            </div>
        </div>
    `;

    console.log('[DEBUG] displayInteractiveSuggestions: Adding suggestions HTML to summary1', {
        buttonId,
        summaryId,
        currentSession: currentAdviceSession
    });
    appendToSummary1(suggestionsHtml, false);
    
    // Add a data attribute to mark this as the current session's suggestions
    setTimeout(() => {
        const dynamicAdviceContainer = document.querySelector('.dynamic-advice-container:last-of-type');
        if (dynamicAdviceContainer) {
            dynamicAdviceContainer.setAttribute('data-session-id', currentAdviceSession);
            dynamicAdviceContainer.classList.add('active-session');
        }
    }, 100);

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
        action,
        currentChatId: window.currentChatId,
        hasCurrentSuggestions: !!window.currentSuggestions,
        currentSuggestionsCount: window.currentSuggestions?.length || 0
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
        
        // Show helpful error message to user
        const errorMessage = `
            <div style="background: #fff3cd; border: 1px solid #ffeaa7; border-radius: 6px; padding: 15px; margin: 10px 0; color: #856404;">
                <h4>⚠️ Action Not Available</h4>
                <p><strong>Issue:</strong> You're trying to interact with suggestions from a different chat session.</p>
                <p><strong>Solution:</strong> Please switch back to the original chat where these suggestions were generated, or generate new suggestions in the current chat.</p>
                <p><small>Suggestion ID: ${suggestionId} | Current Chat: ${window.currentChatId}</small></p>
            </div>
        `;
        
        // Find the suggestion container and add the error message
        const suggestionContainer = suggestionElement.closest('.suggestion-item');
        if (suggestionContainer) {
            suggestionContainer.insertAdjacentHTML('afterend', errorMessage);
            
            // Remove the error message after 10 seconds
            setTimeout(() => {
                const errorDiv = suggestionContainer.nextElementSibling;
                if (errorDiv && errorDiv.innerHTML.includes('Action Not Available')) {
                    errorDiv.remove();
                }
            }, 10000);
        }
        
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
            }, 500);
        }, 1500); // Wait 1.5 seconds to let user see the decision status
    }
}

// Update decisions summary and enable/disable apply button
function updateDecisionsSummary() {
    // Update decisions summary and enable/disable apply button for current session
    
    if (!currentAdviceSession) {
        console.error('[DEBUG] updateDecisionsSummary: No current advice session');
        return;
    }

    const summaryElement = document.getElementById(`decisionsSummary-${currentAdviceSession}`);
    const applyButton = document.getElementById(`applyAllDecisionsBtn-${currentAdviceSession}`);
    
    if (!summaryElement || !applyButton) {
        console.error('[DEBUG] updateDecisionsSummary: Required elements not found for session:', currentAdviceSession);
        return;
    }

    const totalSuggestions = currentSuggestions.length;
    const totalDecisions = Object.keys(userDecisions).length;
    const decisions = Object.values(userDecisions);
    
    const acceptedCount = decisions.filter(d => d.action === 'accept').length;
    const rejectedCount = decisions.filter(d => d.action === 'reject').length;
    const modifiedCount = decisions.filter(d => d.action === 'modify').length;

    // Calculate decision counts

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

    const applyButton = document.getElementById(`applyAllDecisionsBtn-${currentAdviceSession}`);
    const applySpinner = applyButton?.querySelector('.apply-spinner');
    const applyText = applyButton?.querySelector('.apply-text');

    try {
        // Update UI to show loading state
        if (applyButton) applyButton.disabled = true;
        if (applySpinner) applySpinner.style.display = 'inline';
        if (applyText) applyText.textContent = 'Applying decisions...';

        console.log('[DEBUG] applyAllDecisions: UI updated to loading state');

        // Prepare decisions data for API (map prefixed IDs back to original IDs)
        const decisionsData = {};
        Object.entries(userDecisions).forEach(([prefixedId, decision]) => {
            // Find the original ID by looking up the suggestion
            const suggestion = currentSuggestions.find(s => s.id === prefixedId);
            const originalId = suggestion ? suggestion.originalId : prefixedId;
            
            decisionsData[originalId] = {
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

        // Check if we're in sequential processing mode and need to continue to next guideline
        if (window.sequentialProcessingActive) {
            const queue = window.sequentialProcessingQueue || [];
            const currentIndex = window.sequentialProcessingIndex || 0;
            
            if (currentIndex < queue.length - 1) {
                // Move to next guideline
                window.sequentialProcessingIndex = currentIndex + 1;
                const nextGuidelineId = queue[currentIndex + 1];
                const nextStepNumber = currentIndex + 2;
                
                console.log(`[DEBUG] Sequential processing: Moving to guideline ${nextStepNumber}/${queue.length}`);
                
                // Update status display
                const statusDiv = document.getElementById('processing-status');
                if (statusDiv) {
                    statusDiv.innerHTML = queue.map((id, index) => {
                        const guideline = window.relevantGuidelines.find(g => g.id === id);
                        const title = guideline ? (guideline.title || id) : id;
                        const shortTitle = title.length > 50 ? title.substring(0, 47) + '...' : title;
                        
                        let className = 'processing-step pending';
                        let emoji = '⏳';
                        
                        if (index < window.sequentialProcessingIndex) {
                            className = 'processing-step completed';
                            emoji = '✅';
                        } else if (index === window.sequentialProcessingIndex) {
                            className = 'processing-step current';
                            emoji = '🔄';
                        }
                        
                        return `<div class="${className}">${emoji} ${index + 1}. ${shortTitle}</div>`;
                    }).join('');
                }
                
                // Show transition message
                const transitionMessage = `\n**Incorporating changes and preparing for next guideline...**\n\n`;
                appendToSummary1(transitionMessage, false);
                
                // Update the transcript with applied changes automatically
                if (result.updatedTranscript) {
                    const userInput = document.getElementById('userInput');
                    if (userInput) {
                        userInput.value = result.updatedTranscript;
                        console.log('[DEBUG] Sequential processing: Updated transcript automatically');
                    }
                }
                
                // Process next guideline after a brief delay
                setTimeout(async () => {
                    try {
                        const processingStepMessage = `<h4>🔄 Processing Guideline ${nextStepNumber}/${queue.length}</h4>\n`;
                        appendToSummary1(processingStepMessage, false);
                        
                        await processSingleGuideline(nextGuidelineId, nextStepNumber, queue.length);
                    } catch (error) {
                        console.error(`[DEBUG] Error processing next guideline ${nextGuidelineId}:`, error);
                        
                        // Show detailed error with retry option
                        const errorMessage = `
                            <div class="sequential-processing-error">
                                <h4>❌ Error Processing Guideline ${nextStepNumber}</h4>
                                <p><strong>Error:</strong> ${error.message}</p>
                                <p>This is often due to server deployment or network issues.</p>
                                <div class="error-actions">
                                    <button onclick="retryCurrentGuideline()" class="retry-btn" style="background: #f39c12; color: white; padding: 8px 16px; border: none; border-radius: 4px; cursor: pointer; margin: 5px;">
                                        🔄 Retry This Guideline
                                    </button>
                                    <button onclick="skipCurrentGuideline()" class="skip-btn" style="background: #6c757d; color: white; padding: 8px 16px; border: none; border-radius: 4px; cursor: pointer; margin: 5px;">
                                        ⏭️ Skip This Guideline
                                    </button>
                                </div>
                            </div>
                            
                            <style>
                            .sequential-processing-error {
                                background: #fff3cd;
                                border: 1px solid #ffc107;
                                border-radius: 6px;
                                padding: 15px;
                                margin: 15px 0;
                                color: #856404;
                            }
                            .error-actions {
                                margin-top: 10px;
                            }
                            </style>
                        `;
                        appendToSummary1(errorMessage, false);
                    }
                }, 1000);
                
            } else {
                // All guidelines completed
                window.sequentialProcessingActive = false;
                
                // Update final status
                const statusDiv = document.getElementById('processing-status');
                if (statusDiv) {
                    statusDiv.innerHTML = queue.map((id, index) => {
                        const guideline = window.relevantGuidelines.find(g => g.id === id);
                        const title = guideline ? (guideline.title || id) : id;
                        const shortTitle = title.length > 50 ? title.substring(0, 47) + '...' : title;
                        return `<div class="processing-step completed">✅ ${index + 1}. ${shortTitle}</div>`;
                    }).join('');
                }
                
                // Show completion message
                const finalMessage = `
                    <div class="sequential-processing-complete">
                        <h3>🎉 Sequential Processing Complete!</h3>
                        <p>Successfully processed ${queue.length} guidelines sequentially.</p>
                        <p><strong>All changes have been incorporated into your transcript.</strong></p>
                    </div>
                    
                    <style>
                    .sequential-processing-complete {
                        background: #d4edda;
                        border: 1px solid #28a745;
                        border-radius: 6px;
                        padding: 15px;
                        margin: 15px 0;
                        color: #155724;
                    }
                    </style>
                `;
                
                appendToSummary1(finalMessage, false);
                console.log('[DEBUG] Sequential processing completed successfully');
            }
        }

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

    // Add click handler for ask guidelines question button
    const askGuidelinesQuestionBtn = document.getElementById('askGuidelinesQuestionBtn');
    if (askGuidelinesQuestionBtn) {
        askGuidelinesQuestionBtn.addEventListener('click', askGuidelinesQuestion);
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
        // Load clinical conditions from Firebase (with fallback to JSON)
        await ClinicalConditionsService.loadConditions();
        const clinicalConditions = ClinicalConditionsService.getConditions();
        
        if (!clinicalConditions) {
            throw new Error('Failed to load clinical conditions');
        }
        
        console.log('[DEBUG] Loaded clinical conditions:', ClinicalConditionsService.getSummary());
        
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
        
        // Add options from Firebase data
        Object.entries(clinicalConditions).forEach(([category, conditions]) => {
            const categoryLabel = category.charAt(0).toUpperCase() + category.slice(1);
            
            dropdownHtml += `
                        </optgroup>
                        <optgroup label="${categoryLabel}">
            `;
            
            Object.entries(conditions).forEach(([conditionName, conditionData]) => {
                const hasTranscript = conditionData.hasTranscript ? ' ✓' : '';
                dropdownHtml += `<option value="${conditionName}" data-condition-id="${conditionData.id}">${conditionName}${hasTranscript}</option>`;
            });
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
            statusDiv.innerHTML = `<p>📋 Loading clinical interaction for: <strong>${selectedIssue}</strong></p>`;
        }
        
        // Find the condition in our cached data
        const condition = ClinicalConditionsService.findCondition(selectedIssue);
        
        if (!condition) {
            throw new Error(`Clinical condition not found: ${selectedIssue}`);
        }
        
        console.log('[DEBUG] Found condition:', {
            id: condition.id,
            name: condition.name,
            category: condition.category,
            hasTranscript: condition.hasTranscript
        });
        
        let transcript = null;
        let isGenerated = false;
        
        // Check if we have a cached transcript
        if (condition.hasTranscript && condition.transcript) {
            transcript = condition.transcript;
            console.log('[DEBUG] Using cached transcript:', {
                transcriptLength: transcript.length,
                lastGenerated: condition.lastGenerated
            });
        } else {
            // Generate new transcript using Firebase service
            console.log('[DEBUG] Generating new transcript...');
            if (statusDiv) {
                statusDiv.innerHTML = `<p>🔄 Generating new clinical interaction for: <strong>${selectedIssue}</strong></p>`;
            }
            
            const result = await ClinicalConditionsService.generateTranscript(condition.id, false);
            transcript = result.transcript;
            isGenerated = !result.cached;
            
            console.log('[DEBUG] Generated transcript result:', {
                success: !!result.transcript,
                cached: result.cached,
                transcriptLength: result.transcript?.length
            });
        }
        
        if (!transcript) {
            throw new Error(`Failed to get transcript for clinical issue: ${selectedIssue}`);
        }
        
        // Update status
        if (statusDiv) {
            const statusText = isGenerated ? 'Generated new' : 'Loaded cached';
            statusDiv.innerHTML = `<p>✅ ${statusText} clinical interaction for: <strong>${selectedIssue}</strong></p>`;
        }
        
        // Put the transcript in the user input textarea
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
        const performanceText = isGenerated ? '🔄 Generated using AI' : '⚡ Instant loading from Firebase cache';
        const successMessage = `## ✅ Clinical Interaction Loaded\n\n` +
                              `**Clinical Issue:** ${selectedIssue}\n\n` +
                              `**Category:** ${condition.category}\n\n` +
                              `**Status:** Successfully loaded clinical interaction scenario\n\n` +
                              `**Transcript Length:** ${transcript.length} characters (~${Math.round(transcript.split(' ').length)} words)\n\n` +
                              `**Performance:** ${performanceText}\n\n` +
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
        console.log('[DEBUG] processWorkflow: Checking relevant guidelines:', {
            hasRelevantGuidelines: !!window.relevantGuidelines,
            guidelinesLength: window.relevantGuidelines?.length || 0,
            guidelinesArray: window.relevantGuidelines
        });
        
        if (!window.relevantGuidelines || window.relevantGuidelines.length === 0) {
            console.log('[DEBUG] processWorkflow: No relevant guidelines found, cannot proceed');
            throw new Error('No relevant guidelines were found. Cannot proceed with analysis.');
        }

        console.log('[DEBUG] processWorkflow: Step 1 completed - now showing guideline selection interface');
        
        // Step 2: Show Guideline Selection Interface
        const step2Status = `## Step 2: Select Guidelines to Process\n\n` +
                           `✅ **Step 1 Complete:** Found ${window.relevantGuidelines.length} relevant guidelines\n\n` +
                           `**Next:** Use the interface above to select which guidelines to process. ` +
                           `Most relevant guidelines are pre-selected. Click "Process Selected Guidelines" when ready.\n\n` +
                           `📝 **Note:** Guidelines will be processed one-by-one, with each guideline's suggestions ` +
                           `incorporated before moving to the next guideline.\n\n`;
        
        appendToSummary1(step2Status, false);
        
        // The workflow now pauses here - user needs to manually select guidelines and click "Process Selected Guidelines"
        console.log('[DEBUG] processWorkflow: Workflow paused - waiting for user to select and process guidelines');
        
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

// Firestore chat history functions
async function saveChatToFirestore(chat) {
    const user = window.auth.currentUser;
    if (!user) {
        console.warn('Cannot save chat to Firestore: user not authenticated');
        return false;
    }

    try {
        const idToken = await user.getIdToken();
        const response = await fetch(`${window.SERVER_URL}/saveChatHistory`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${idToken}`
            },
            body: JSON.stringify({
                chat: {
                    ...chat,
                    lastUpdated: new Date().toISOString(),
                    userId: user.uid
                }
            })
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const result = await response.json();
        if (result.success) {
            // Chat saved to Firestore
            return true;
        } else {
            throw new Error(result.error || 'Unknown error saving chat');
        }
    } catch (error) {
        console.error('[FIRESTORE] Error saving chat:', error);
        return false;
    }
}

async function loadChatHistoryFromFirestore() {
    const user = window.auth.currentUser;
    if (!user) {
        console.warn('Cannot load chat history from Firestore: user not authenticated');
        return [];
    }

    try {
        const idToken = await user.getIdToken();
        const response = await fetch(`${window.SERVER_URL}/getChatHistory`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${idToken}`
            }
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const result = await response.json();
        if (result.success) {
            const chats = result.chats || [];
            console.log(`[FIRESTORE] Loaded ${chats.length} chats from Firestore`);
            return chats;
        } else {
            throw new Error(result.error || 'Unknown error loading chat history');
        }
    } catch (error) {
        console.error('[FIRESTORE] Error loading chat history:', error);
        return [];
    }
}

async function deleteChatFromFirestore(chatId) {
    const user = window.auth.currentUser;
    if (!user) {
        console.warn('Cannot delete chat from Firestore: user not authenticated');
        return false;
    }

    try {
        const idToken = await user.getIdToken();
        const response = await fetch(`${window.SERVER_URL}/deleteChatHistory`, {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${idToken}`
            },
            body: JSON.stringify({
                chatId: chatId.toString()
            })
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const result = await response.json();
        if (result.success) {
            console.log(`[FIRESTORE] Deleted chat: ${chatId}`);
            return true;
        } else {
            throw new Error(result.error || 'Unknown error deleting chat');
        }
    } catch (error) {
        console.error('[FIRESTORE] Error deleting chat:', error);
        return false;
    }
}

async function migrateChatHistoryToFirestore() {
    const user = window.auth.currentUser;
    if (!user) return;

    try {
        const savedHistory = localStorage.getItem('chatHistory');
        if (!savedHistory) return;

        const localChats = JSON.parse(savedHistory);
        console.log(`[MIGRATION] Migrating ${localChats.length} chats to Firestore...`);

        // Check if we already have chats in Firestore to avoid duplicates
        const existingChats = await loadChatHistoryFromFirestore();
        const existingChatIds = new Set(existingChats.map(chat => chat.id));

        let migratedCount = 0;
        for (const chat of localChats) {
            if (!existingChatIds.has(chat.id)) {
                const success = await saveChatToFirestore(chat);
                if (success) migratedCount++;
            }
        }

        if (migratedCount > 0) {
            console.log(`[MIGRATION] Successfully migrated ${migratedCount} chats to Firestore`);
            // Clear localStorage after successful migration
            localStorage.removeItem('chatHistory');
            console.log('[MIGRATION] Cleared localStorage chat history after migration');
        }
    } catch (error) {
        console.error('[MIGRATION] Error migrating chat history:', error);
    }
}

function debouncedSaveState() {
    if (saveStateTimeout) {
        clearTimeout(saveStateTimeout);
    }
    saveStateTimeout = setTimeout(async () => {
        try {
            await saveCurrentChatState();
        } catch (error) {
            console.error('[CHAT] Error in debounced save:', error);
        }
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
    
    // Mark suggestion containers as active/inactive based on current session
    setTimeout(() => {
        markSuggestionContainersState();
    }, 100);
}

function markSuggestionContainersState() {
    const allContainers = document.querySelectorAll('.dynamic-advice-container');
    allContainers.forEach(container => {
        const sessionId = container.getAttribute('data-session-id');
        if (sessionId === window.currentAdviceSession) {
            container.classList.add('active-session');
            container.classList.remove('inactive-session');
        } else if (sessionId) {
            container.classList.remove('active-session');
            container.classList.add('inactive-session');
            
            // Add a visual overlay to inactive sessions
            if (!container.querySelector('.inactive-overlay')) {
                const overlay = document.createElement('div');
                overlay.className = 'inactive-overlay';
                overlay.innerHTML = `
                    <div style="background: rgba(0,0,0,0.8); color: white; padding: 10px; border-radius: 4px; text-align: center; margin: 10px;">
                        💤 <strong>Inactive Session</strong><br>
                        <small>Switch back to the original chat to interact with these suggestions</small>
                    </div>
                `;
                overlay.style.cssText = `
                    position: absolute;
                    top: 0;
                    left: 0;
                    right: 0;
                    bottom: 0;
                    background: rgba(255, 255, 255, 0.9);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    z-index: 10;
                    border-radius: 6px;
                `;
                container.style.position = 'relative';
                container.appendChild(overlay);
            }
        }
    });
}

async function saveCurrentChatState() {
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
    
    // Save to Firestore (with fallback to localStorage)
    const firestoreSuccess = await saveChatToFirestore(currentChat);
    if (!firestoreSuccess) {
        // Fallback to localStorage if Firestore fails
        try {
            localStorage.setItem('chatHistory', JSON.stringify(chatHistory));
            console.log(`[CHAT] Saved to localStorage as fallback for chat: ${currentChatId}`);
        } catch (localStorageError) {
            console.error('[CHAT] Both Firestore and localStorage save failed:', localStorageError);
            // If localStorage is full, clear it and try again
            if (localStorageError.name === 'QuotaExceededError') {
                localStorage.removeItem('chatHistory');
                console.log('[CHAT] Cleared localStorage due to quota exceeded');
                try {
                    localStorage.setItem('chatHistory', JSON.stringify([currentChat]));
                    console.log('[CHAT] Saved current chat only to localStorage');
                } catch (retryError) {
                    console.error('[CHAT] Failed to save even after clearing localStorage:', retryError);
                }
            }
        }
    }
    
    renderChatHistory(); // Re-render to show updated preview and order
    console.log(`[CHAT] Saved state for chat: ${currentChatId}`);
}

async function startNewChat() {
    await saveCurrentChatState(); // Save the state of the chat we are leaving

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

    // Save new chat to Firestore (with localStorage fallback)
    const firestoreSuccess = await saveChatToFirestore(newChat);
    if (!firestoreSuccess) {
        try {
            localStorage.setItem('chatHistory', JSON.stringify(chatHistory));
        } catch (error) {
            console.error('[CHAT] Failed to save new chat:', error);
        }
    }
    
    renderChatHistory();
    document.getElementById('userInput').focus();
    console.log(`[CHAT] Started new chat: ${newChatId}`);
}

async function switchChat(chatId) {
    if (chatId === currentChatId) return;

    await saveCurrentChatState(); // Save the current chat before switching

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

async function deleteChat(chatId, event) {
    event.stopPropagation(); // Prevent switchChat from firing

    if (!confirm('Are you sure you want to delete this chat?')) return;

    // Delete from Firestore first
    await deleteChatFromFirestore(chatId);
    
    // Remove from local array
    chatHistory = chatHistory.filter(c => c.id !== chatId);
    
    // Update localStorage as backup
    try {
        localStorage.setItem('chatHistory', JSON.stringify(chatHistory));
    } catch (error) {
        console.warn('[CHAT] Failed to update localStorage after delete:', error);
    }

    if (currentChatId === chatId) {
        // If we deleted the active chat, load the newest one or start fresh
        if (chatHistory.length > 0) {
            await switchChat(chatHistory[0].id);
        } else {
            await startNewChat();
        }
    }
    
    renderChatHistory();
    console.log(`[CHAT] Deleted chat: ${chatId}`);
}


function renderChatHistory() {
    const historyList = document.getElementById('historyList');
    
    if (!historyList) {
        console.error('[DEBUG] historyList element not found!');
        return;
    }

    historyList.innerHTML = '';
    
    if (chatHistory.length === 0) {
        historyList.innerHTML = '<div class="no-chats">No chat history yet</div>';
        return;
    }
    
    chatHistory.forEach((chat, index) => {
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
    });
}

async function initializeChatHistory() {
    // Prevent multiple simultaneous chat history initializations
    if (window.chatHistoryInitializing || window.chatHistoryInitialized) {
        console.log('[DEBUG] ⏭️ Chat history initialization already in progress or completed, skipping...');
        return;
    }
    
    window.chatHistoryInitializing = true;
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
    
    // First, try to migrate any existing localStorage data to Firestore
    await migrateChatHistoryToFirestore();
    
    // Load chat history from Firestore
    try {
        chatHistory = await loadChatHistoryFromFirestore();
        console.log('[DEBUG] Loaded chat history from Firestore:', {
            count: chatHistory.length,
            chatIds: chatHistory.map(c => c.id),
            firstChatPreview: chatHistory[0] ? {
                id: chatHistory[0].id,
                title: chatHistory[0].title,
                preview: chatHistory[0].preview
            } : 'none'
        });
    } catch (error) {
        console.error('[DEBUG] Error loading chat history from Firestore:', error);
        
        // Fallback to localStorage if Firestore fails
        const savedHistory = localStorage.getItem('chatHistory');
        if (savedHistory) {
            try {
                chatHistory = JSON.parse(savedHistory);
                console.log('[DEBUG] Loaded chat history from localStorage (fallback):', {
                    count: chatHistory.length
                });
            } catch (parseError) {
                console.error('[DEBUG] Error parsing saved chat history:', parseError);
                chatHistory = [];
            }
        } else {
            chatHistory = [];
        }
    }

    // Always start with a fresh chat on client load
    console.log('[DEBUG] Starting fresh chat on client load');
    try {
        await startNewChat();
        console.log('[DEBUG] Started new chat, currentChatId:', currentChatId);
    } catch (error) {
        console.error('[DEBUG] Error starting new chat:', error);
    }
    
    console.log('[DEBUG] About to call renderChatHistory...');
    renderChatHistory();
    
    window.chatHistoryInitialized = true;
    console.log('[DEBUG] Chat history initialization completed');
    window.chatHistoryInitializing = false;
}

// Add debugging to the main app initialization
async function initializeMainApp() {
    // Prevent multiple simultaneous initializations
    if (window.mainAppInitializing || window.mainAppInitialized) {
        console.log('[DEBUG] ⏭️ Main app initialization already in progress or completed, skipping...');
        return;
    }
    
    window.mainAppInitializing = true;
    
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
        await initializeChatHistory();
        
        // Load clinical conditions from Firebase (with fallback to JSON)
        console.log('[DEBUG] Loading clinical conditions...');
        try {
            await ClinicalConditionsService.loadConditions();
            const summary = ClinicalConditionsService.getSummary();
            console.log('[DEBUG] Clinical conditions loaded successfully:', summary);
        } catch (error) {
            console.error('[DEBUG] Failed to load clinical conditions:', error);
        }
        
        // Load guidelines from Firestore on app initialization
        console.log('[DEBUG] Loading guidelines from Firestore...');
        try {
            await window.loadGuidelinesFromFirestore();
            console.log('[DEBUG] Guidelines loaded successfully during initialization');
        } catch (error) {
            console.warn('[DEBUG] Error during initial loadGuidelinesFromFirestore call:', error.message);
            // Don't throw - allow app to continue functioning even if guidelines fail to load
        }
        
        window.mainAppInitialized = true;
        console.log('[DEBUG] Main app initialization completed');
    } catch (error) {
        console.error('[DEBUG] Error initializing main app:', error);
        console.error('[DEBUG] Error stack:', error.stack);
    } finally {
        window.mainAppInitializing = false;
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

// Make functions globally accessible
window.selectAllGuidelines = selectAllGuidelines;
window.processSelectedGuidelines = processSelectedGuidelines;

// Cancel guideline selection
function cancelGuidelineSelection() {
    // Just scroll to the end, the selection interface will remain visible but user can continue with other actions
    console.log('[DEBUG] Guideline selection cancelled');
}

// NEW: Process selected guidelines sequentially (one-by-one)
async function processSelectedGuidelines() {
    console.log('[DEBUG] processSelectedGuidelines function called!');
    const button = document.querySelector('.process-selected-btn');
    
    if (!button) {
        console.error('[DEBUG] Process button not found!');
        alert('Process button not found. Please try refreshing the page.');
        return;
    }
    
    const originalText = button.textContent;
    
    try {
        // Get all checked guidelines
        const checkedCheckboxes = document.querySelectorAll('.guideline-checkbox:checked');
        console.log('[DEBUG] Found checkboxes:', checkedCheckboxes.length);
        
        const selectedGuidelineIds = Array.from(checkedCheckboxes).map(cb => cb.dataset.guidelineId);
        console.log('[DEBUG] Selected guideline IDs:', selectedGuidelineIds);
        
        if (selectedGuidelineIds.length === 0) {
            alert('Please select at least one guideline to process');
            return;
        }

        // Set loading state
        button.disabled = true;
        button.innerHTML = '⏳ Processing...';

        console.log('[DEBUG] Starting sequential processing of selected guidelines:', selectedGuidelineIds);

        // Set up sequential processing globals
        window.sequentialProcessingActive = true;
        window.sequentialProcessingQueue = selectedGuidelineIds;
        window.sequentialProcessingIndex = 0;

        const sequentialProcessingMessage = `
            <div class="sequential-processing-container">
                <h3>🔄 Sequential Guideline Processing</h3>
                <p>Processing ${selectedGuidelineIds.length} selected guidelines one-by-one...</p>
                <div class="processing-status" id="processing-status"></div>
            </div>
            
            <style>
            .sequential-processing-container {
                background: #e8f5e8;
                border: 1px solid #4caf50;
                border-radius: 6px;
                padding: 15px 0;
            }
            .processing-status {
                margin-top: 10px;
                font-family: monospace;
                font-size: 0.9em;
            }
            .processing-step {
                padding: 5px 0;
                border-bottom: 1px solid #ddd;
            }
            .processing-step.current {
                background: #fff3cd;
                font-weight: bold;
                padding: 8px;
                border-radius: 4px;
            }
            .processing-step.completed {
                color: #28a745;
            }
            .processing-step.pending {
                color: #6c757d;
            }
            </style>
        `;
        
        appendToSummary1(sequentialProcessingMessage, false);

        // Function to update status display
        function updateSequentialStatus() {
            const statusDiv = document.getElementById('processing-status');
            if (statusDiv) {
                statusDiv.innerHTML = selectedGuidelineIds.map((id, index) => {
                    const guideline = window.relevantGuidelines.find(g => g.id === id);
                    const title = guideline ? (guideline.title || id) : id;
                    const shortTitle = title.length > 50 ? title.substring(0, 47) + '...' : title;
                    
                    let className = 'processing-step pending';
                    let emoji = '⏳';
                    
                    if (index < window.sequentialProcessingIndex) {
                        className = 'processing-step completed';
                        emoji = '✅';
                    } else if (index === window.sequentialProcessingIndex) {
                        className = 'processing-step current';
                        emoji = '🔄';
                    }
                    
                    return `<div class="${className}">${emoji} ${index + 1}. ${shortTitle}</div>`;
                }).join('');
            }
        }

        // Process only the first guideline - rest will be handled by applyAllDecisions
        const i = 0;
            const guidelineId = selectedGuidelineIds[i];
            const stepNumber = i + 1;
            
            // Update status display for first guideline
            updateSequentialStatus();

            console.log(`[DEBUG] Processing guideline ${stepNumber}/${selectedGuidelineIds.length}: ${guidelineId}`);
            
            const processingStepMessage = `
                <h4>🔄 Processing Guideline ${stepNumber}/${selectedGuidelineIds.length}</h4>
            `;
            appendToSummary1(processingStepMessage, false);

            try {
                // Process only the first guideline - the rest will be handled in applyAllDecisions
                await processSingleGuideline(guidelineId, stepNumber, selectedGuidelineIds.length);
                
            } catch (error) {
                console.error(`[DEBUG] Error processing guideline ${guidelineId}:`, error);
                const errorMessage = `❌ **Error processing guideline ${stepNumber}:** ${error.message}\n\n`;
                appendToSummary1(errorMessage, false);
            }

            // Don't show completion message yet - will be shown when all guidelines are done

    } catch (error) {
        console.error('[DEBUG] Error in processSelectedGuidelines:', error);
        const errorMessage = `\n❌ **Sequential Processing Error:** ${error.message}\n\nPlease try again or contact support if the problem persists.\n`;
        appendToSummary1(errorMessage, false);
        alert('Error processing selected guidelines: ' + error.message);
        
    } finally {
        // Reset button state
        button.disabled = false;
        button.textContent = originalText;
    }
}

// Function to process a single guideline (extracted from existing checkAgainstGuidelines logic)
async function processSingleGuideline(guidelineId, stepNumber, totalSteps) {
    console.log(`[DEBUG] processSingleGuideline called for: ${guidelineId}`);
    
    const transcript = document.getElementById('userInput').value;
    if (!transcript) {
        throw new Error('No transcript found');
    }

    // Get user authentication
    const user = auth.currentUser;
    if (!user) {
        throw new Error('User not authenticated');
    }
    const idToken = await user.getIdToken();

    // Find the guideline in our global cache
    const targetGuideline = window.relevantGuidelines.find(g => g.id === guidelineId);
    if (!targetGuideline) {
        throw new Error(`Guideline ${guidelineId} not found in relevant guidelines`);
    }

    // Find the full guideline data
    const guidelineData = window.globalGuidelines[guidelineId];
    if (!guidelineData) {
        throw new Error(`Guideline data not found for ${guidelineId}`);
    }

    console.log(`[DEBUG] Processing guideline: ${guidelineData.humanFriendlyTitle || guidelineData.title}`);

    const analyzeMessage = `Analyzing against: **${guidelineData.humanFriendlyTitle || guidelineData.title}**\n\n`;
    appendToSummary1(analyzeMessage, false);

    // Directly generate dynamic advice for this guideline without server analysis
    // Store the latest analysis for potential dynamic advice
    window.latestAnalysis = {
        transcript: transcript,
        analysis: null, // No separate analysis step
        guidelineId: guidelineId,
        guidelineTitle: guidelineData.humanFriendlyTitle || guidelineData.title
    };

    // Automatically generate dynamic advice for this guideline
    const dynamicAdviceTitle = `### 🎯 Interactive Suggestions for: ${guidelineData.humanFriendlyTitle || guidelineData.title}\n\n`;
    appendToSummary1(dynamicAdviceTitle, false);

    try {
        // For sequential processing, use existing analysis if available, otherwise create a basic one
        let analysisToUse = window.latestAnalysis?.analysis;
        if (!analysisToUse) {
            // Create a basic analysis description for this guideline
            analysisToUse = `Clinical transcript analysis for guideline compliance check against: ${guidelineData.humanFriendlyTitle || guidelineData.title}. ` +
                           `This analysis focuses on identifying areas where the clinical documentation can be improved according to the specific guideline requirements.`;
        }
        
        await dynamicAdvice(
            transcript,
            analysisToUse,
            guidelineId,
            guidelineData.humanFriendlyTitle || guidelineData.title
        );
    } catch (dynamicError) {
        console.error(`[DEBUG] Error generating dynamic advice for ${guidelineId}:`, dynamicError);
        const dynamicErrorMessage = `⚠️ **Note:** Dynamic advice generation failed for this guideline: ${dynamicError.message}\n\n`;
        appendToSummary1(dynamicErrorMessage, false);
    }

    console.log(`[DEBUG] Successfully processed guideline: ${guidelineId}`);
}

// Make the function globally accessible
window.processSelectedGuidelines = processSelectedGuidelines;

// Helper functions for sequential processing error handling
window.retryCurrentGuideline = async function() {
    if (!window.sequentialProcessingActive) return;
    
    const queue = window.sequentialProcessingQueue || [];
    const currentIndex = window.sequentialProcessingIndex || 0;
    const guidelineId = queue[currentIndex];
    const stepNumber = currentIndex + 1;
    
    console.log('[DEBUG] Retrying current guideline:', guidelineId);
    
    const retryMessage = `**🔄 Retrying Guideline ${stepNumber}...**\n\n`;
    appendToSummary1(retryMessage, false);
    
    try {
        await processSingleGuideline(guidelineId, stepNumber, queue.length);
    } catch (error) {
        console.error('[DEBUG] Retry failed:', error);
        const failMessage = `❌ **Retry failed:** ${error.message}\n\nYou can try again or skip this guideline.\n\n`;
        appendToSummary1(failMessage, false);
    }
};

window.skipCurrentGuideline = function() {
    if (!window.sequentialProcessingActive) return;
    
    const queue = window.sequentialProcessingQueue || [];
    const currentIndex = window.sequentialProcessingIndex || 0;
    const stepNumber = currentIndex + 1;
    
    console.log('[DEBUG] Skipping current guideline');
    
    const skipMessage = `**⏭️ Skipped Guideline ${stepNumber}**\n\n`;
    appendToSummary1(skipMessage, false);
    
    // Move to next guideline or complete sequence
    if (currentIndex < queue.length - 1) {
        window.sequentialProcessingIndex = currentIndex + 1;
        const nextGuidelineId = queue[currentIndex + 1];
        const nextStepNumber = currentIndex + 2;
        
        setTimeout(async () => {
            try {
                const processingStepMessage = `<h4>🔄 Processing Guideline ${nextStepNumber}/${queue.length}</h4>\n`;
                appendToSummary1(processingStepMessage, false);
                await processSingleGuideline(nextGuidelineId, nextStepNumber, queue.length);
            } catch (error) {
                console.error('[DEBUG] Error processing next guideline after skip:', error);
            }
        }, 500);
    } else {
        // All done
        window.sequentialProcessingActive = false;
        const finalMessage = `
            <div class="sequential-processing-complete">
                <h3>🎉 Sequential Processing Complete!</h3>
                <p>Processed ${currentIndex + 1} of ${queue.length} guidelines (${queue.length - currentIndex - 1} skipped).</p>
            </div>
        `;
        appendToSummary1(finalMessage, false);
    }
};

// Generate dynamic advice for multiple selected guidelines
async function generateMultiGuidelineAdvice() {
    // console.log('[DEBUG] generateMultiGuidelineAdvice called');
    
    // Get selected guidelines
    const selectedCheckboxes = document.querySelectorAll('.guideline-checkbox:checked');
    const selectedGuidelineIds = Array.from(selectedCheckboxes).map(cb => cb.dataset.guidelineId);
    
    if (selectedGuidelineIds.length === 0) {
        alert('Please select at least one guideline to generate advice.');
        return;
    }
    
    console.log('🔄 Processing', selectedGuidelineIds.length, 'selected guidelines');
    
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
        
        console.log('📋 Selected guidelines:', selectedGuidelines.map(g => g.title));
        
        // Validate essential data
        if (!window.latestAnalysis || !window.latestAnalysis.transcript) {
            throw new Error('No clinical transcript available. Please enter a transcript first.');
        }
        
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
        console.error('❌ Error in generateMultiGuidelineAdvice:', error);
        
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
    console.log('🔄 Processing', selectedGuidelines.length, 'guidelines in parallel...');
    
    try {
        // Get user ID token
        const user = auth.currentUser;
        if (!user) {
            throw new Error('User not authenticated');
        }
        
        const idToken = await user.getIdToken();
        
        // Validate essential data again
        if (!window.latestAnalysis || !window.latestAnalysis.transcript || !window.latestAnalysis.analysis) {
            throw new Error('Essential data missing. Please ensure you have entered a transcript and it has been analyzed.');
        }
        
        // Update processing status for each guideline
        const updateProcessingStatus = (guidelineId, status, emoji = '⏳') => {
            const statusElement = document.querySelector(`[data-guideline-id="${guidelineId}"] .processing-status`);
            if (statusElement) {
                statusElement.textContent = emoji;
                // console.log(`Updated status for ${guidelineId}: ${status}`);
            }
        };
        
        // Process all guidelines in parallel with proper error handling
        console.log('⚡ Starting parallel processing...');
        
        const guidelinePromises = selectedGuidelines.map(async (guideline, index) => {
            try {
                updateProcessingStatus(guideline.id, 'processing', '🔄');
                
                console.log(`📋 Processing ${index + 1}/${selectedGuidelines.length}: ${guideline.title}`);
                
                // Validate individual guideline data
                if (!guideline.id || !guideline.title) {
                    throw new Error(`Invalid guideline data for ${guideline.title || 'unknown guideline'}`);
                }
                
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
                    throw new Error(`API error (${response.status}): ${errorText}`);
                }
                
                const result = await response.json();
                
                if (!result.success) {
                    throw new Error(result.error || 'Dynamic advice generation failed');
                }
                
                updateProcessingStatus(guideline.id, 'completed', '✅');
                
                console.log(`✅ Completed: ${guideline.title} (${result.suggestions?.length || 0} suggestions)`);
                
                return {
                    guideline: guideline,
                    result: result,
                    success: true
                };
                
            } catch (error) {
                console.error(`❌ Error processing ${guideline.title}:`, error.message);
                updateProcessingStatus(guideline.id, 'error', '❌');
                
                return {
                    guideline: guideline,
                    error: error.message,
                    success: false
                };
            }
        });
        
        // Wait for all guidelines to be processed
        console.log('⏳ Waiting for all processing to complete...');
        const results = await Promise.allSettled(guidelinePromises);
        
        // Process results from Promise.allSettled
        const processedResults = results.map(result => {
            if (result.status === 'fulfilled') {
                return result.value;
            } else {
                // Handle rejected promises
                console.error('Promise rejected:', result.reason);
                return {
                    guideline: { title: 'Unknown', id: 'unknown' },
                    error: result.reason?.message || 'Promise rejected',
                    success: false
                };
            }
        });
        
        // Separate successful and failed results
        const successfulResults = processedResults.filter(r => r.success);
        const failedResults = processedResults.filter(r => !r.success);
        
        console.log('📊 Processing completed:', {
            total: processedResults.length,
            successful: successfulResults.length,
            failed: failedResults.length
        });
        
        // Update progress completion
        const progressContainer = document.querySelector('.multi-guideline-progress');
        if (progressContainer) {
            const completionHtml = `
                <div class="processing-completion">
                    <p><strong>Processing Complete!</strong></p>
                    <p>✅ Successfully processed: ${successfulResults.length} guideline${successfulResults.length !== 1 ? 's' : ''}</p>
                    ${failedResults.length > 0 ? `<p>❌ Failed: ${failedResults.length} guideline${failedResults.length !== 1 ? 's' : ''}</p>` : ''}
                </div>
            `;
            progressContainer.innerHTML += completionHtml;
        }
        
        if (successfulResults.length === 0) {
            throw new Error('No guidelines were successfully processed. Please check the error messages above and try again.');
        }
        
        // Combine and display all suggestions from successful results
        await displayCombinedSuggestions(successfulResults, failedResults);
        
        // Store session data globally (using the first successful result as base)
        const firstResult = successfulResults[0].result;
        currentAdviceSession = firstResult.sessionId;
        currentSuggestions = []; // Will be populated with combined suggestions
        userDecisions = {};
        
        console.log('✅ Multi-guideline dynamic advice completed successfully');
        
    } catch (error) {
        console.error('❌ Error in multiGuidelineDynamicAdvice:', error);
        
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
    console.log('📋 Combining suggestions from', successfulResults.length, 'successful guidelines');
    
    // Validate input
    if (!successfulResults || !Array.isArray(successfulResults)) {
        throw new Error('Invalid successful results provided to displayCombinedSuggestions');
    }
    
    // Combine all suggestions from successful results
    let allSuggestions = [];
    let suggestionCounter = 1;
    
    successfulResults.forEach((result, index) => {
        if (!result || !result.result) {
            console.warn(`⚠️ Invalid result at index ${index}, skipping`);
            return;
        }
        
        const suggestions = result.result.suggestions || [];
        suggestions.forEach(suggestion => {
            // Validate suggestion structure
            if (!suggestion || typeof suggestion !== 'object') {
                console.warn(`⚠️ Invalid suggestion in ${result.guideline?.title || 'unknown guideline'}, skipping`);
                return;
            }
            
            // Add guideline source information and renumber
            allSuggestions.push({
                ...suggestion,
                id: `multi_${suggestionCounter++}`,
                sourceGuideline: result.guideline?.title || 'Unknown Guideline',
                sourceGuidelineId: result.guideline?.id || 'unknown',
                originalId: suggestion.id
            });
        });
    });
    
    console.log('💡 Combined', allSuggestions.length, 'suggestions from', successfulResults.length, 'guidelines');
    
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
    
    try {
        // Display the combined suggestions
        appendToSummary1(combinedHtml, false);
        
        // Update global suggestions for existing functionality
        currentSuggestions = allSuggestions;
        
        console.log('✅ Combined suggestions displayed successfully');
        
    } catch (error) {
        console.error('❌ Error displaying combined suggestions:', error);
        
        const errorHtml = `
            <div class="display-error">
                <h3>❌ Error Displaying Suggestions</h3>
                <p><strong>Error:</strong> ${error.message}</p>
                <p>Please try refreshing the page or contact support if the problem persists.</p>
            </div>
        `;
        
        appendToSummary1(errorHtml, false);
        throw error;
    }
}

// Bulk accept suggestions based on priority filter
function bulkAcceptSuggestions(priorityFilter) {
    console.log('📋 Bulk accepting suggestions with filter:', priorityFilter);
    
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
    
    console.log(`✅ Bulk accepted ${actionCount} suggestions with filter: ${priorityFilter}`);
    
    // Update decisions summary
    setTimeout(() => {
        updateDecisionsSummary();
    }, 100);
}

// Bulk reject suggestions
function bulkRejectSuggestions(priorityFilter) {
    console.log('📋 Bulk rejecting suggestions with filter:', priorityFilter);
    
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
    
    console.log(`✅ Bulk rejected ${actionCount} suggestions with filter: ${priorityFilter}`);
    
    // Update decisions summary
    setTimeout(() => {
        updateDecisionsSummary();
    }, 100);
}

// Automatically generate combined interactive suggestions from multiple analysis results
async function generateCombinedInteractiveSuggestions(analysisResults) {
    console.log('🔄 Generating combined suggestions from', analysisResults.length, 'analysis results');

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

        console.log('📡 Sending multiple analyses to API...');

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

        console.log('📡 API response status:', response.status);

        if (!response.ok) {
            const errorText = await response.text();
            console.error('❌ Multi-guideline API error:', errorText);
            throw new Error(`API error: ${response.status} - ${errorText}`);
        }

        const result = await response.json();
        console.log('✅ API result received:', {
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
        console.error('❌ Error generating combined suggestions:', error);
        
        // Fallback to single guideline approach
        console.log('🔄 Falling back to single guideline dynamic advice');
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

// Process guidelines one at a time for content repair
async function diagnoseAndRepairContent() {
    // Prevent multiple simultaneous repairs
    if (window.contentRepairInProgress) {
        console.log('[REPAIR] ⏳ Content repair already in progress, skipping...');
        return;
    }
    
    window.contentRepairInProgress = true;
    console.log('[REPAIR] 🔧 Starting comprehensive content repair process...');
    console.log('[REPAIR] This will process guidelines one at a time to avoid timeouts');
    
    try {
        // Get user ID token
        const user = auth.currentUser;
        if (!user) {
            console.error('[REPAIR] ❌ User not authenticated');
            throw new Error('User not authenticated');
        }
        
        console.log('[REPAIR] ✅ User authenticated, getting ID token...');
        const idToken = await user.getIdToken();
        
        // First, get the list of guidelines needing content
        console.log('[REPAIR] 📋 Getting list of guidelines needing content...');
        const listResponse = await fetch(`${window.SERVER_URL}/getGuidelinesNeedingContent`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${idToken}`
            }
        });

        if (!listResponse.ok) {
            const errorText = await listResponse.text();
            throw new Error(`Failed to get guidelines list: ${listResponse.status} - ${errorText}`);
        }

        const listResult = await listResponse.json();
        const guidelinesNeedingContent = listResult.guidelines || [];
        
        console.log(`[REPAIR] 📊 Found ${guidelinesNeedingContent.length} guidelines needing content processing`);
        
        if (guidelinesNeedingContent.length === 0) {
            showMetadataProgress('✅ All guidelines already have complete content!', true);
            setTimeout(() => hideMetadataProgress(), 3000);
            return;
        }
        
        // Process guidelines one at a time
        let processed = 0;
        let successful = 0;
        let failed = 0;
        
        for (const guideline of guidelinesNeedingContent) {
            try {
                processed++;
                const progress = `🔧 Processing ${processed}/${guidelinesNeedingContent.length}: ${guideline.title}`;
                showMetadataProgress(progress, false);
                
                console.log(`[REPAIR] 📄 Processing guideline ${processed}/${guidelinesNeedingContent.length}: ${guideline.id}`);
                
                const processResponse = await fetch(`${window.SERVER_URL}/processGuidelineContent`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${idToken}`
                    },
                    body: JSON.stringify({
                        guidelineId: guideline.id
                    })
                });

                if (processResponse.ok) {
                    const processResult = await processResponse.json();
                    if (processResult.success && processResult.updated) {
                        successful++;
                        console.log(`[REPAIR] ✅ Successfully processed: ${guideline.title}`);
                    } else {
                        console.log(`[REPAIR] ⏭️ No processing needed for: ${guideline.title}`);
                    }
                } else {
                    failed++;
                    const errorText = await processResponse.text();
                    console.error(`[REPAIR] ❌ Failed to process ${guideline.title}: ${errorText}`);
                }
                
                // Small delay between requests to avoid overwhelming the server
                await new Promise(resolve => setTimeout(resolve, 500));
                
            } catch (error) {
                failed++;
                console.error(`[REPAIR] ❌ Error processing ${guideline.title}:`, error);
            }
        }
        
        console.log(`[REPAIR] 📈 Processing complete: ${successful} successful, ${failed} failed, ${processed} total`);
        
        if (failed === 0) {
            showMetadataProgress(`✅ Content repair completed! Successfully processed ${successful} guidelines.`, true);
        } else {
            showMetadataProgress(`⚠️ Content repair completed with some issues: ${successful} successful, ${failed} failed.`, true);
        }
        
        // Auto-hide after 5 seconds
        setTimeout(() => {
            hideMetadataProgress();
        }, 5000);
        
        // Reload guidelines to see the updates
        if (successful > 0) {
            console.log('[REPAIR] 🔄 Reloading guidelines to reflect changes...');
            await loadGuidelinesFromFirestore();
        }
        
    } catch (error) {
        console.error('[REPAIR] ❌ Content repair error:', error);
        
        showMetadataProgress(`❌ Content repair failed: ${error.message}`, true);
        
        // Auto-hide error after 10 seconds
        setTimeout(() => {
            hideMetadataProgress();
        }, 10000);
        
        throw error;
        
    } finally {
        console.log('[REPAIR] 🏁 Content repair process finished, flag reset');
        window.contentRepairInProgress = false;
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

// Make chat history functions available globally for debugging
window.testFirestoreChat = async function() {
    console.log('🧪 Testing Firestore chat history...');
    try {
        const user = window.auth.currentUser;
        if (!user) {
            console.error('❌ You must be logged in to test Firestore chat history');
            return;
        }
        
        console.log('📊 Current chat history status:', {
            currentChatId: currentChatId,
            chatHistoryLength: chatHistory.length,
            userAuthenticated: !!user,
            userId: user.uid
        });
        
        // Test loading from Firestore
        const firestoreChats = await loadChatHistoryFromFirestore();
        console.log('📥 Loaded from Firestore:', firestoreChats.length, 'chats');
        
        // Test saving current chat
        if (currentChatId) {
            const currentChat = chatHistory.find(c => c.id === currentChatId);
            if (currentChat) {
                const saveSuccess = await saveChatToFirestore(currentChat);
                console.log('💾 Save test result:', saveSuccess ? '✅ Success' : '❌ Failed');
            }
        }
        
        console.log('✅ Firestore chat history test completed!');
    } catch (error) {
        console.error('❌ Firestore chat history test failed:', error);
    }
};

window.clearAllChatHistory = async function() {
    if (!confirm('Are you sure you want to delete ALL chat history? This cannot be undone.')) {
        return;
    }
    
    console.log('🗑️ Clearing all chat history...');
    try {
        const user = window.auth.currentUser;
        if (!user) {
            console.error('❌ You must be logged in to clear chat history');
            return;
        }
        
        // Delete all chats from Firestore
        const firestoreChats = await loadChatHistoryFromFirestore();
        for (const chat of firestoreChats) {
            await deleteChatFromFirestore(chat.id);
        }
        
        // Clear local data
        chatHistory = [];
        localStorage.removeItem('chatHistory');
        
        // Start fresh
        await startNewChat();
        
        console.log('✅ All chat history cleared successfully!');
    } catch (error) {
        console.error('❌ Failed to clear chat history:', error);
    }
};

// ========== DEBUGGING AND TROUBLESHOOTING HELPERS ==========

// Comprehensive debugging helper for multi-guideline processing
window.debugMultiGuideline = function() {
    console.group('🔍 Multi-Guideline Debug Information');
    
    // Check essential data
    console.log('📊 Essential Data Status:');
    console.log('  - window.latestAnalysis:', !!window.latestAnalysis);
    console.log('  - transcript available:', !!(window.latestAnalysis?.transcript));
    console.log('  - analysis available:', !!(window.latestAnalysis?.analysis));
    console.log('  - relevantGuidelines:', window.relevantGuidelines?.length || 0);
    console.log('  - globalGuidelines loaded:', !!(window.globalGuidelines && Object.keys(window.globalGuidelines).length > 0));
    
    // Check user authentication
    const user = window.auth?.currentUser;
    console.log('👤 Authentication Status:');
    console.log('  - User authenticated:', !!user);
    console.log('  - User email:', user?.email || 'N/A');
    
    // Check selected guidelines
    const selectedCheckboxes = document.querySelectorAll('.guideline-checkbox:checked');
    console.log('📋 Selection Status:');
    console.log('  - Selected guidelines:', selectedCheckboxes.length);
    if (selectedCheckboxes.length > 0) {
        console.log('  - Selected IDs:', Array.from(selectedCheckboxes).map(cb => cb.dataset.guidelineId));
    }
    
    // Check current session state
    console.log('🗂️ Session State:');
    console.log('  - currentAdviceSession:', currentAdviceSession);
    console.log('  - currentSuggestions:', currentSuggestions?.length || 0);
    console.log('  - userDecisions:', Object.keys(userDecisions || {}).length);
    
    // Server connectivity
    console.log('🌐 Server Configuration:');
    console.log('  - SERVER_URL:', window.SERVER_URL);
    
    console.groupEnd();
    
    // Return summary for programmatic use
    return {
        hasEssentialData: !!(window.latestAnalysis?.transcript && window.latestAnalysis?.analysis),
        isUserAuthenticated: !!user,
        selectedCount: selectedCheckboxes.length,
        hasRelevantGuidelines: (window.relevantGuidelines?.length || 0) > 0,
        serverConfigured: !!window.SERVER_URL
    };
};

// Test function to validate multi-guideline setup
window.testMultiGuidelineSetup = async function() {
    console.log('🧪 Testing Multi-Guideline Setup...');
    
    const debug = window.debugMultiGuideline();
    const issues = [];
    
    if (!debug.hasEssentialData) {
        issues.push('❌ Missing essential data (transcript/analysis). Please enter and analyze a clinical transcript first.');
    }
    
    if (!debug.isUserAuthenticated) {
        issues.push('❌ User not authenticated. Please sign in first.');
    }
    
    if (!debug.hasRelevantGuidelines) {
        issues.push('❌ No relevant guidelines available. Please find relevant guidelines first.');
    }
    
    if (!debug.serverConfigured) {
        issues.push('❌ Server URL not configured.');
    }
    
    if (debug.selectedCount === 0) {
        issues.push('⚠️ No guidelines selected. Please select at least one guideline for processing.');
    }
    
    if (issues.length === 0) {
        console.log('✅ Multi-guideline setup looks good! Ready for processing.');
        return true;
    } else {
        console.log('❌ Issues found:');
        issues.forEach(issue => console.log('  ' + issue));
        return false;
    }
};

// Manual trigger for multi-guideline processing with validation
window.runMultiGuidelineAdvice = async function() {
    console.log('🚀 Manual Multi-Guideline Advice Trigger');
    
    const isReady = await window.testMultiGuidelineSetup();
    if (!isReady) {
        console.log('❌ Setup validation failed. Please resolve the issues above.');
        return;
    }
    
    try {
        await generateMultiGuidelineAdvice();
    } catch (error) {
        console.error('❌ Multi-guideline processing failed:', error);
        throw error;
    }
};

// Clear all current selections and state
window.clearMultiGuidelineState = function() {
    console.log('🧹 Clearing multi-guideline state...');
    
    // Clear selections
    const checkboxes = document.querySelectorAll('.guideline-checkbox:checked');
    checkboxes.forEach(cb => cb.checked = false);
    
    // Clear session state
    currentAdviceSession = null;
    currentSuggestions = [];
    userDecisions = {};
    
    // Clear any progress displays
    const progressContainers = document.querySelectorAll('.multi-guideline-progress, .multi-guideline-error');
    progressContainers.forEach(container => container.remove());
    
    console.log('✅ Multi-guideline state cleared');
};

console.log('🔧 Multi-guideline debugging helpers loaded. Use:');
console.log('  - window.debugMultiGuideline() - Check current state');
console.log('  - window.testMultiGuidelineSetup() - Validate setup');
console.log('  - window.runMultiGuidelineAdvice() - Manual trigger');
console.log('  - window.clearMultiGuidelineState() - Reset state');

// ============================================
// FIREBASE-BASED CLINICAL CONDITIONS SERVICE
// ============================================

// Global cache for clinical conditions from Firebase
let clinicalConditionsFirebaseCache = null;
let clinicalConditionsFirebaseLoadPromise = null;

// Service to manage clinical conditions from Firebase
const ClinicalConditionsService = {
    // Load clinical conditions from server on startup
    async loadConditions() {
        if (clinicalConditionsFirebaseLoadPromise) {
            return clinicalConditionsFirebaseLoadPromise;
        }
        
        clinicalConditionsFirebaseLoadPromise = this._fetchConditionsFromServer();
        return clinicalConditionsFirebaseLoadPromise;
    },
    
    async _fetchConditionsFromServer() {
        try {
            console.log('[CLINICAL-SERVICE] Loading clinical conditions from Firebase...');
            
            const user = auth.currentUser;
            if (!user) {
                throw new Error('User not authenticated');
            }
            
            const idToken = await user.getIdToken();
            
            const response = await fetch(`${window.SERVER_URL}/clinicalConditions`, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${idToken}`,
                    'Content-Type': 'application/json'
                }
            });
            
            if (!response.ok) {
                throw new Error(`Failed to load clinical conditions: ${response.status}`);
            }
            
            const data = await response.json();
            
            if (!data.success) {
                throw new Error(data.error || 'Failed to load clinical conditions');
            }
            
            // Check if Firebase collection is empty
            const totalConditions = data.summary?.totalConditions || 0;
            if (totalConditions === 0) {
                console.log('[CLINICAL-SERVICE] Firebase collection is empty, initializing...');
                await this._initializeFirebaseCollection();
                
                // Retry loading after initialization
                const retryResponse = await fetch(`${window.SERVER_URL}/clinicalConditions`, {
                    method: 'GET',
                    headers: {
                        'Authorization': `Bearer ${idToken}`,
                        'Content-Type': 'application/json'
                    }
                });
                
                if (retryResponse.ok) {
                    const retryData = await retryResponse.json();
                    if (retryData.success && retryData.summary?.totalConditions > 0) {
                        clinicalConditionsFirebaseCache = retryData.conditions;
                        console.log('[CLINICAL-SERVICE] Successfully loaded clinical conditions after initialization:', {
                            totalCategories: Object.keys(clinicalConditionsFirebaseCache).length,
                            totalConditions: retryData.summary.totalConditions,
                            categoriesWithCounts: retryData.summary.categoriesWithCounts
                        });
                        return clinicalConditionsFirebaseCache;
                    }
                }
                
                // If initialization didn't work, fall back to JSON
                console.log('[CLINICAL-SERVICE] Initialization failed, falling back to JSON...');
                return this._loadFromJsonFallback();
            }
            
            clinicalConditionsFirebaseCache = data.conditions;
            
            console.log('[CLINICAL-SERVICE] Successfully loaded clinical conditions:', {
                totalCategories: Object.keys(clinicalConditionsFirebaseCache).length,
                totalConditions: data.summary.totalConditions,
                categoriesWithCounts: data.summary.categoriesWithCounts
            });
            
            return clinicalConditionsFirebaseCache;
            
        } catch (error) {
            console.error('[CLINICAL-SERVICE] Error loading clinical conditions:', error);
            // Fallback to JSON file if Firebase fails
            return this._loadFromJsonFallback();
        }
    },
    
    async _initializeFirebaseCollection() {
        try {
            console.log('[CLINICAL-SERVICE] Initializing Firebase collection...');
            
            const user = auth.currentUser;
            if (!user) {
                throw new Error('User not authenticated');
            }
            
            const idToken = await user.getIdToken();
            
            const response = await fetch(`${window.SERVER_URL}/initializeClinicalConditions`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${idToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({})
            });
            
            if (!response.ok) {
                throw new Error(`Failed to initialize clinical conditions: ${response.status}`);
            }
            
            const data = await response.json();
            
            if (!data.success) {
                throw new Error(data.error || 'Failed to initialize clinical conditions');
            }
            
            console.log('[CLINICAL-SERVICE] Firebase collection initialized successfully:', data.message);
            return true;
            
        } catch (error) {
            console.error('[CLINICAL-SERVICE] Error initializing Firebase collection:', error);
            throw error;
        }
    },
    
    async _loadFromJsonFallback() {
        console.log('[CLINICAL-SERVICE] Falling back to JSON file...');
        
        try {
            const response = await fetch('./clinical_issues.json');
            if (!response.ok) {
                throw new Error(`Failed to load clinical issues JSON: ${response.status}`);
            }
            
            const clinicalIssues = await response.json();
            
            // Convert to the same format as Firebase
            const conditions = {};
            for (const [category, issues] of Object.entries(clinicalIssues)) {
                conditions[category] = {};
                issues.forEach(issue => {
                    conditions[category][issue] = {
                        id: `${category}-${issue.toLowerCase().replace(/[^a-z0-9]/g, '-')}`,
                        name: issue,
                        category: category,
                        transcript: null, // No pre-generated transcripts in fallback
                        hasTranscript: false,
                        metadata: {
                            source: 'json-fallback'
                        }
                    };
                });
            }
            
            clinicalConditionsFirebaseCache = conditions;
            
            console.log('[CLINICAL-SERVICE] Loaded from JSON fallback:', {
                totalCategories: Object.keys(conditions).length,
                totalConditions: Object.values(conditions).reduce((sum, cat) => sum + Object.keys(cat).length, 0)
            });
            
            return conditions;
            
        } catch (error) {
            console.error('[CLINICAL-SERVICE] Error loading JSON fallback:', error);
            throw error;
        }
    },
    
    // Get all conditions (cached)
    getConditions() {
        return clinicalConditionsFirebaseCache;
    },
    
    // Get conditions by category
    getConditionsByCategory(category) {
        return clinicalConditionsFirebaseCache?.[category] || {};
    },
    
    // Find a specific condition
    findCondition(conditionName) {
        if (!clinicalConditionsFirebaseCache) return null;
        
        for (const [category, conditions] of Object.entries(clinicalConditionsFirebaseCache)) {
            if (conditions[conditionName]) {
                return conditions[conditionName];
            }
        }
        return null;
    },
    
    // Generate transcript for a specific condition
    async generateTranscript(conditionId, forceRegenerate = false) {
        try {
            console.log('[CLINICAL-SERVICE] Generating transcript for condition:', conditionId);
            
            const user = auth.currentUser;
            if (!user) {
                throw new Error('User not authenticated');
            }
            
            const idToken = await user.getIdToken();
            
            const response = await fetch(`${window.SERVER_URL}/generateTranscript/${conditionId}`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${idToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ forceRegenerate })
            });
            
            if (!response.ok) {
                throw new Error(`Failed to generate transcript: ${response.status}`);
            }
            
            const data = await response.json();
            
            if (!data.success) {
                throw new Error(data.error || 'Failed to generate transcript');
            }
            
            // Update cache if transcript was generated/retrieved
            if (data.transcript && clinicalConditionsFirebaseCache) {
                const condition = this.findConditionById(conditionId);
                if (condition) {
                    // Find and update the condition in cache
                    for (const [category, conditions] of Object.entries(clinicalConditionsFirebaseCache)) {
                        for (const [name, cond] of Object.entries(conditions)) {
                            if (cond.id === conditionId) {
                                clinicalConditionsFirebaseCache[category][name].transcript = data.transcript;
                                clinicalConditionsFirebaseCache[category][name].hasTranscript = true;
                                clinicalConditionsFirebaseCache[category][name].lastGenerated = data.generated || data.lastGenerated;
                                break;
                            }
                        }
                    }
                }
            }
            
            return data;
            
        } catch (error) {
            console.error('[CLINICAL-SERVICE] Error generating transcript:', error);
            throw error;
        }
    },
    
    // Helper to find condition by ID
    findConditionById(conditionId) {
        if (!clinicalConditionsFirebaseCache) return null;
        
        for (const [category, conditions] of Object.entries(clinicalConditionsFirebaseCache)) {
            for (const [name, condition] of Object.entries(conditions)) {
                if (condition.id === conditionId) {
                    return condition;
                }
            }
        }
        return null;
    },
    
    // Get summary statistics
    getSummary() {
        if (!clinicalConditionsFirebaseCache) return null;
        
        const summary = {
            totalCategories: Object.keys(clinicalConditionsFirebaseCache).length,
            totalConditions: 0,
            conditionsWithTranscripts: 0,
            categoriesWithCounts: {}
        };
        
        for (const [category, conditions] of Object.entries(clinicalConditionsFirebaseCache)) {
            const categoryCount = Object.keys(conditions).length;
            const categoryWithTranscripts = Object.values(conditions).filter(c => c.hasTranscript).length;
            
            summary.totalConditions += categoryCount;
            summary.conditionsWithTranscripts += categoryWithTranscripts;
            summary.categoriesWithCounts[category] = {
                total: categoryCount,
                withTranscripts: categoryWithTranscripts
            };
        }
        
        return summary;
    }
};

// Ask Guidelines Question functionality
async function askGuidelinesQuestion() {
    const askQuestionBtn = document.getElementById('askGuidelinesQuestionBtn');
    const questionSpinner = document.getElementById('askQuestionSpinner');
    const originalText = askQuestionBtn.textContent;
    
    try {
        const question = document.getElementById('userInput').value;
        if (!question) {
            alert('Please enter a question first');
            return;
        }

        // Set loading state
        askQuestionBtn.classList.add('loading');
        askQuestionBtn.disabled = true;
        questionSpinner.style.display = 'inline-block';

        // Initialize the question search summary
        let searchProgress = '## Asking Guidelines A Question\n\n';
        searchProgress += `**Your Question:** ${question}\n\n`;
        appendToSummary1(searchProgress);

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

        // Get guidelines and summaries from Firestore (reuse existing logic)
        const guidelines = await loadGuidelinesFromFirestore();
        
        // Format guidelines for relevancy matching
        const guidelinesList = guidelines.map(g => ({
            id: g.id,
            title: g.title,
            summary: g.summary,
            condensed: g.condensed,
            keywords: g.keywords,
            downloadUrl: g.downloadUrl,
            originalFilename: g.originalFilename,  
            filename: g.filename,
            organisation: g.organisation
        }));

        // Update progress with guideline count
        const analyzeMessage = `Analysing question against ${guidelinesList.length} available guidelines...\n`;
        appendToSummary1(analyzeMessage, false);

        console.log('[DEBUG] Sending request to /findRelevantGuidelines for question:', {
            questionLength: question.length,
            guidelinesCount: guidelinesList.length
        });

        const response = await fetch(`${window.SERVER_URL}/findRelevantGuidelines`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${idToken}`
            },
            body: JSON.stringify({
                transcript: question,
                guidelines: guidelinesList
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Server error: ${response.status} - ${errorText}`);
        }

        const data = await response.json();
        if (!data.success) {
            throw new Error(data.error || 'Failed to find relevant guidelines');
        }

        // Update progress with completion
        const completionMessage = 'Analysis complete! Please select guidelines to search for your answer...\n\n';
        appendToSummary1(completionMessage, false);

        // Show custom selection interface for Q&A
        await showQuestionGuidelineSelectionInterface(data.categories, question);

    } catch (error) {
        console.error('[DEBUG] Error in askGuidelinesQuestion:', {
            error: error.message,
            stack: error.stack
        });
        
        // Display error in summary1
        const errorMessage = `\n❌ **Error finding relevant guidelines:** ${error.message}\n\nPlease try again or contact support if the problem persists.\n`;
        appendToSummary1(errorMessage, false);
        
        alert('Error finding relevant guidelines: ' + error.message);
    } finally {
        // Reset button state
        askQuestionBtn.classList.remove('loading');
        askQuestionBtn.disabled = false;
        questionSpinner.style.display = 'none';
        askQuestionBtn.textContent = originalText;
    }
}

// Show guideline selection interface specifically for Q&A
async function showQuestionGuidelineSelectionInterface(categories, question) {
    console.log('[DEBUG] showQuestionGuidelineSelectionInterface called with question:', question);

    // Store question globally for later use
    window.currentQuestion = question;

    // Helper function to create PDF download link
    function createPdfDownloadLink(guideline) {
        if (!guideline) return '';

        let downloadUrl;
        if (guideline.downloadUrl) {
            downloadUrl = guideline.downloadUrl;
        } else if (guideline.originalFilename) {
            const encodedFilename = encodeURIComponent(guideline.originalFilename);
            downloadUrl = `https://github.com/iannouvel/clerky/raw/main/guidance/${encodedFilename}`;
        } else {
            return '';
        }
        
        return `<a href="${downloadUrl}" target="_blank" title="Download PDF" class="pdf-download-link">📄</a>`;
    }

    // Helper function to format relevance score
    function formatRelevanceScore(relevanceValue) {
        if (typeof relevanceValue === 'number') {
            const percentage = Math.round(relevanceValue * 100);
            return `${percentage}%`;
        }
        
        if (typeof relevanceValue === 'string') {
            const match = relevanceValue.match(/score\s+([\d.]+)(?:-[\d.]+)?|^([\d.]+)$/);
            if (match) {
                const score = parseFloat(match[1] || match[2]);
                const percentage = Math.round(score * 100);
                return `${percentage}%`;
            }
        }
        
        return '50%';
    }

    // Create the Q&A selection interface HTML
    const selectionHtml = `
        <div class="question-guideline-selection-container">
            <div class="selection-header">
                <h3>❓ Select Guidelines to Search for Your Answer</h3>
                <p><strong>Question:</strong> ${question}</p>
                <p>Choose which guidelines to search for the answer to your question. Each selected guideline will be analyzed individually.</p>
                <div class="selection-stats">
                    <span><strong>Most Relevant:</strong> ${categories.mostRelevant?.length || 0} guidelines</span> |
                    <span><strong>Potentially Relevant:</strong> ${categories.potentiallyRelevant?.length || 0} guidelines</span> |
                    <span><strong>Less Relevant:</strong> ${categories.lessRelevant?.length || 0} guidelines</span>
                </div>
            </div>
            
            <div class="selection-controls">
                <button type="button" class="selection-btn select-all-btn" onclick="selectAllQuestionGuidelines(true)">
                    ✅ Select All Relevant
                </button>
                <button type="button" class="selection-btn deselect-all-btn" onclick="selectAllQuestionGuidelines(false)">
                    ❌ Deselect All
                </button>
            </div>
            
            <div class="guidelines-selection-list">
                ${categories.mostRelevant && categories.mostRelevant.length > 0 ? `
                    <div class="guideline-category">
                        <h4>🎯 Most Relevant Guidelines</h4>
                        ${categories.mostRelevant.map((guideline, index) => {
                            const displayTitle = guideline.title || guideline.id;
                            const organization = guideline.organisation || 'Unknown';
                            const relevanceScore = formatRelevanceScore(guideline.relevance);
                            const pdfLink = createPdfDownloadLink(guideline);
                            
                            return `
                                <div class="guideline-selection-item" data-guideline-id="${guideline.id}">
                                    <div class="selection-checkbox">
                                        <input type="checkbox" id="question-guideline-${index}" checked="checked" 
                                               data-guideline-id="${guideline.id}" class="question-guideline-checkbox">
                                        <label for="question-guideline-${index}"></label>
                                    </div>
                                    <div class="guideline-info">
                                        <div class="guideline-title">${displayTitle}</div>
                                        <div class="guideline-meta">
                                            <span class="organization">${organization}</span>
                                            <span class="relevance-score">Relevance: ${relevanceScore}</span>
                                        </div>
                                    </div>
                                    <div class="guideline-actions">
                                        ${pdfLink}
                                    </div>
                                </div>
                            `;
                        }).join('')}
                    </div>
                ` : ''}
                
                ${categories.potentiallyRelevant && categories.potentiallyRelevant.length > 0 ? `
                    <div class="guideline-category">
                        <h4>⚠️ Potentially Relevant Guidelines</h4>
                        ${categories.potentiallyRelevant.map((guideline, index) => {
                            const displayTitle = guideline.title || guideline.id;
                            const organization = guideline.organisation || 'Unknown';
                            const relevanceScore = formatRelevanceScore(guideline.relevance);
                            const pdfLink = createPdfDownloadLink(guideline);
                            const checkboxIndex = (categories.mostRelevant?.length || 0) + index;
                            
                            return `
                                <div class="guideline-selection-item" data-guideline-id="${guideline.id}">
                                    <div class="selection-checkbox">
                                        <input type="checkbox" id="question-guideline-${checkboxIndex}" 
                                               data-guideline-id="${guideline.id}" class="question-guideline-checkbox">
                                        <label for="question-guideline-${checkboxIndex}"></label>
                                    </div>
                                    <div class="guideline-info">
                                        <div class="guideline-title">${displayTitle}</div>
                                        <div class="guideline-meta">
                                            <span class="organization">${organization}</span>
                                            <span class="relevance-score">Relevance: ${relevanceScore}</span>
                                        </div>
                                    </div>
                                    <div class="guideline-actions">
                                        ${pdfLink}
                                    </div>
                                </div>
                            `;
                        }).join('')}
                    </div>
                ` : ''}
                
                ${categories.lessRelevant && categories.lessRelevant.length > 0 ? `
                    <div class="guideline-category">
                        <h4>📉 Less Relevant Guidelines</h4>
                        ${categories.lessRelevant.map((guideline, index) => {
                            const displayTitle = guideline.title || guideline.id;
                            const organization = guideline.organisation || 'Unknown';
                            const relevanceScore = formatRelevanceScore(guideline.relevance);
                            const pdfLink = createPdfDownloadLink(guideline);
                            const checkboxIndex = (categories.mostRelevant?.length || 0) + (categories.potentiallyRelevant?.length || 0) + index;
                            
                            return `
                                <div class="guideline-selection-item" data-guideline-id="${guideline.id}">
                                    <div class="selection-checkbox">
                                        <input type="checkbox" id="question-guideline-${checkboxIndex}" 
                                               data-guideline-id="${guideline.id}" class="question-guideline-checkbox">
                                        <label for="question-guideline-${checkboxIndex}"></label>
                                    </div>
                                    <div class="guideline-info">
                                        <div class="guideline-title">${displayTitle}</div>
                                        <div class="guideline-meta">
                                            <span class="organization">${organization}</span>
                                            <span class="relevance-score">Relevance: ${relevanceScore}</span>
                                        </div>
                                    </div>
                                    <div class="guideline-actions">
                                        ${pdfLink}
                                    </div>
                                </div>
                            `;
                        }).join('')}
                    </div>
                ` : ''}
            </div>
            
            <div class="selection-actions">
                <button type="button" class="action-btn primary search-guidelines-btn" onclick="processQuestionAgainstGuidelines()">
                    <span class="btn-icon">🔍</span>
                    <span class="btn-text">Search Selected Guidelines</span>
                    <span class="btn-spinner" style="display: none;">⏳</span>
                </button>
                <button type="button" class="action-btn secondary cancel-question-selection-btn" onclick="cancelQuestionSelection()">
                    Cancel
                </button>
            </div>
            
            <div class="selection-info">
                <p><strong>How it works:</strong></p>
                <ul>
                    <li>Each selected guideline will be searched individually for your question</li>
                    <li>Guidelines that contain relevant information will show the answer with context</li>
                    <li>Guidelines without relevant information will be marked as "No answer found"</li>
                    <li>Processing time depends on the number of selected guidelines</li>
                </ul>
            </div>
        </div>
        
        <style>
        .question-guideline-selection-container {
            background: #f8f9fa;
            border: 1px solid #dee2e6;
            border-radius: 8px;
            padding: 20px;
            margin: 20px 0;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        }
        
        .question-guideline-selection-container .selection-header h3 {
            margin: 0 0 10px 0;
            color: #2c3e50;
            font-size: 1.2em;
        }
        
        .question-guideline-selection-container .selection-header p {
            margin: 0 0 10px 0;
            color: #6c757d;
            line-height: 1.5;
        }
        
        .question-guideline-selection-container .guideline-category {
            margin: 15px 0;
        }
        
        .question-guideline-selection-container .guideline-category h4 {
            margin: 0 0 10px 0;
            color: #495057;
            font-size: 1em;
            padding: 8px 0;
            border-bottom: 1px solid #dee2e6;
        }
        </style>
    `;

    // Display the selection interface
    appendToSummary1(selectionHtml, false);
}

// Helper functions for Q&A guideline selection
function selectAllQuestionGuidelines(select) {
    const checkboxes = document.querySelectorAll('.question-guideline-checkbox');
    checkboxes.forEach(checkbox => {
        checkbox.checked = select;
    });
}

function cancelQuestionSelection() {
    const message = 'Question search cancelled.\n\n';
    appendToSummary1(message, false);
}

// Process question against selected guidelines
async function processQuestionAgainstGuidelines() {
    const searchBtn = document.querySelector('.search-guidelines-btn');
    const btnSpinner = document.querySelector('.search-guidelines-btn .btn-spinner');
    const btnText = document.querySelector('.search-guidelines-btn .btn-text');
    const originalText = btnText.textContent;
    
    try {
        // Get selected guidelines
        const selectedCheckboxes = document.querySelectorAll('.question-guideline-checkbox:checked');
        if (selectedCheckboxes.length === 0) {
            alert('Please select at least one guideline to search');
            return;
        }

        const selectedGuidelineIds = Array.from(selectedCheckboxes).map(cb => cb.dataset.guidelineId);
        const question = window.currentQuestion;

        if (!question) {
            alert('Question not found. Please try again.');
            return;
        }

        // Set loading state
        searchBtn.disabled = true;
        btnSpinner.style.display = 'inline-block';
        btnText.textContent = 'Searching...';

        // Get user ID token
        const user = auth.currentUser;
        if (!user) {
            alert('Please sign in to use this feature');
            return;
        }
        const idToken = await user.getIdToken();

        // Start the search process
        let searchProgress = `\n## 🔍 Searching Guidelines for Your Answer\n\n`;
        searchProgress += `**Question:** ${question}\n\n`;
        searchProgress += `**Selected Guidelines:** ${selectedGuidelineIds.length}\n\n`;
        searchProgress += `**Status:** Processing guidelines one by one...\n\n`;
        appendToSummary1(searchProgress, false);

        const results = [];
        
        // Process each guideline individually
        for (let i = 0; i < selectedGuidelineIds.length; i++) {
            const guidelineId = selectedGuidelineIds[i];
            const stepNumber = i + 1;
            const totalSteps = selectedGuidelineIds.length;
            
            try {
                // Update progress
                const progressMessage = `### 📋 Processing Guideline ${stepNumber}/${totalSteps}: ${guidelineId}\n\n`;
                appendToSummary1(progressMessage, false);

                // Call the server endpoint to analyze the question against this guideline
                const response = await fetch(`${window.SERVER_URL}/analyzeNoteAgainstGuideline`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${idToken}`
                    },
                    body: JSON.stringify({
                        transcript: question,
                        guideline: guidelineId
                    })
                });

                if (!response.ok) {
                    throw new Error(`Server error: ${response.status}`);
                }

                const data = await response.json();
                if (!data.success) {
                    throw new Error(data.error || 'Analysis failed');
                }

                // Store the result
                results.push({
                    guidelineId: guidelineId,
                    success: true,
                    analysis: data.analysis
                });

                // Display the result immediately
                const resultMessage = `**Result:** ✅ Analysis complete\n\n${data.analysis}\n\n---\n\n`;
                appendToSummary1(resultMessage, false);

            } catch (error) {
                console.error(`[DEBUG] Error processing guideline ${guidelineId}:`, error);
                
                // Store the error result
                results.push({
                    guidelineId: guidelineId,
                    success: false,
                    error: error.message
                });

                // Display the error
                const errorMessage = `**Result:** ❌ Error - ${error.message}\n\n---\n\n`;
                appendToSummary1(errorMessage, false);
            }
        }

        // Display final summary
        const successCount = results.filter(r => r.success).length;
        const errorCount = results.filter(r => !r.success).length;
        
        const summaryMessage = `## 📊 Search Complete\n\n` +
                              `**Total Guidelines Searched:** ${selectedGuidelineIds.length}\n` +
                              `**Successful Analyses:** ${successCount}\n` +
                              `**Errors:** ${errorCount}\n\n` +
                              `💡 **Tip:** Review the individual results above to find the most relevant answers to your question.\n\n`;
        
        appendToSummary1(summaryMessage, false);

    } catch (error) {
        console.error('[DEBUG] Error in processQuestionAgainstGuidelines:', error);
        
        const errorMessage = `\n❌ **Error searching guidelines:** ${error.message}\n\nPlease try again or contact support if the problem persists.\n`;
        appendToSummary1(errorMessage, false);
        
        alert('Error searching guidelines: ' + error.message);
    } finally {
        // Reset button state
        searchBtn.disabled = false;
        btnSpinner.style.display = 'none';
        btnText.textContent = originalText;
    }
}