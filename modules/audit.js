// Audit module - contains only audit-specific functionality
import { auth } from './firebase-core.js';
import { loadGuidelinesFromFirestore } from './guidelines.js';
import { getCurrentUser } from './auth.js';

// Audit page specific functionality
export class AuditPage {
    constructor() {
        this.allGuidelines = [];
        this.selectedGuideline = null;
        this.currentAIProvider = 'DeepSeek'; // Default to cheapest provider
    }

    // Initialize audit page
    async initialize() {
        console.log('Audit page initializing...');
        
        // Wait for authentication
        const user = await this.waitForAuth();
        if (!user) {
            console.log('No user authenticated, redirecting to main page');
            window.location.href = 'index.html';
            return;
        }
        
        console.log('User authenticated:', user.email);
        
        // Load guidelines
        await this.loadGuidelines();
        
        // Setup event listeners
        this.setupEventListeners();
        
        // Setup AI provider selector
        this.setupAIProviderSelector();
        
        console.log('Audit page initialization complete');
    }

    // Wait for authentication
    async waitForAuth() {
        return new Promise((resolve) => {
            const unsubscribe = auth.onAuthStateChanged((user) => {
                unsubscribe();
                resolve(user);
            });
        });
    }

    // Load guidelines for autocomplete
    async loadGuidelines() {
        try {
            console.log('Loading guidelines for audit...');
            this.allGuidelines = await loadGuidelinesFromFirestore();
            console.log(`✅ Successfully loaded ${this.allGuidelines.length} guidelines for audit`);
            
            // Log sample guidelines to debug the structure
            if (this.allGuidelines.length > 0) {
                console.log('📋 Sample guideline structure:', this.allGuidelines[0]);
                
                // Log human-friendly names for debugging
                const humanFriendlyNames = this.allGuidelines
                    .filter(g => g.human_friendly_name)
                    .slice(0, 5)
                    .map(g => g.human_friendly_name);
                
                console.log('🔍 Sample human-friendly names:', humanFriendlyNames);
                
                // Count guidelines with human_friendly_name
                const withHumanFriendly = this.allGuidelines.filter(g => g.human_friendly_name).length;
                console.log(`📊 Guidelines with human_friendly_name: ${withHumanFriendly}/${this.allGuidelines.length}`);
            }
            
        } catch (error) {
            console.error('❌ Failed to load guidelines for audit:', error);
            throw error;
        }
    }

    // Setup AI provider selector
    setupAIProviderSelector() {
        const modelSelect = document.getElementById('auditModelSelect');
        if (modelSelect) {
            // Set default value
            modelSelect.value = this.currentAIProvider;
            
            // Add change event listener
            modelSelect.addEventListener('change', (e) => {
                this.currentAIProvider = e.target.value;
                console.log(`[DEBUG] AI Provider changed to: ${this.currentAIProvider}`);
            });
            
            console.log(`[DEBUG] AI Provider selector initialized with: ${this.currentAIProvider}`);
        }
    }

    // Setup event listeners
    setupEventListeners() {
        // Guideline input autocomplete
        const guidelineInput = document.getElementById('guidelineInput');
        const guidelineDropdown = document.getElementById('guidelineDropdown');
        
        if (guidelineInput) {
            guidelineInput.addEventListener('input', (e) => {
                const query = e.target.value.toLowerCase();
                this.searchGuidelines(query, guidelineDropdown);
            });
            
            guidelineInput.addEventListener('focus', () => {
                if (guidelineInput.value.trim() === '') {
                    this.searchGuidelines('', guidelineDropdown);
                }
            });
            
            // Hide dropdown when clicking outside
            document.addEventListener('click', (e) => {
                if (!guidelineInput.contains(e.target) && !guidelineDropdown.contains(e.target)) {
                    guidelineDropdown.style.display = 'none';
                }
            });
        }
        
        // Audit buttons
        const runNewAuditBtn = document.getElementById('runNewAuditBtn');
        const retrieveAuditsBtn = document.getElementById('retrieveAuditsBtn');
        
        if (runNewAuditBtn) {
            runNewAuditBtn.addEventListener('click', () => this.runNewAudit());
        }
        
        if (retrieveAuditsBtn) {
            retrieveAuditsBtn.addEventListener('click', () => this.retrievePreviousAudits());
        }
        
        // Metadata toggle
        const toggleMetadataBtn = document.getElementById('toggleMetadataBtn');
        if (toggleMetadataBtn) {
            toggleMetadataBtn.addEventListener('click', () => this.toggleMetadataView());
        }
        
        // Auditable elements click handler
        const auditableElementsSpan = document.getElementById('auditableElements');
        if (auditableElementsSpan) {
            auditableElementsSpan.addEventListener('click', () => this.displayAuditableElements());
            auditableElementsSpan.title = 'Click to view auditable elements';
        }
    }

    // Display guideline options in dropdown
    displayGuidelineOptions(guidelines, dropdown) {
        dropdown.innerHTML = '';
        
        if (guidelines.length === 0) {
            dropdown.style.display = 'none';
            return;
        }
        
        guidelines.forEach(guideline => {
            const option = document.createElement('div');
            option.className = 'guideline-option';
            
            // Use human_friendly_name if available, otherwise fall back to title
            const displayName = guideline.human_friendly_name || guideline.title;
            const organisation = guideline.organisation || 'Unknown';
            
            option.textContent = `${displayName} (${organisation})`;
            option.addEventListener('click', async () => await this.selectGuideline(guideline));
            dropdown.appendChild(option);
        });
        
        dropdown.style.display = 'block';
    }

    // Select a guideline
    async selectGuideline(guideline) {
        this.selectedGuideline = guideline;
        
        // Use human_friendly_name if available, otherwise fall back to title
        const displayName = guideline.human_friendly_name || guideline.title;
        document.getElementById('guidelineInput').value = displayName;
        document.getElementById('guidelineDropdown').style.display = 'none';
        
        // Update guideline information (now async)
        await this.updateGuidelineInfo(guideline);
        
        console.log('Selected guideline for audit:', guideline);
    }

    // Update guideline information display
    async updateGuidelineInfo(guideline) {
        const infoDiv = document.getElementById('guidelineInfo');
        const noSelectionDiv = document.getElementById('noGuidelineSelected');
        
        if (infoDiv && noSelectionDiv) {
            infoDiv.style.display = 'block';
            noSelectionDiv.style.display = 'none';
            
            try {
                // Fetch full metadata from Firestore
                console.log('Fetching full metadata for guideline:', guideline.id);
                const fullGuideline = await this.fetchFullGuidelineMetadata(guideline.id);
                
                // Calculate metadata completeness dynamically based on all fields
                const allFields = Object.keys(fullGuideline);
                const completedFields = allFields.filter(field => {
                    const value = fullGuideline[field];
                    if (!value) return false;
                    if (typeof value === 'string') return value.trim() !== '';
                    if (typeof value === 'boolean') return value === true;
                    if (typeof value === 'object') return Object.keys(value).length > 0;
                    if (Array.isArray(value)) return value.length > 0;
                    return true;
                });
                const completenessPercent = Math.round((completedFields.length / allFields.length) * 100);
                
                console.log('Metadata completeness calculation:', {
                    totalFields: allFields.length,
                    completedFields: completedFields.length,
                    completeness: completenessPercent + '%',
                    allFields: allFields,
                    completedFieldsList: completedFields
                });
                
                document.getElementById('metadataPercent').textContent = `${completenessPercent}%`;
                
                // Count auditable elements from full metadata
                let auditableCount = 0;
                let auditableElements = fullGuideline.auditableElements || [];
                
                if (auditableElements.length > 0) {
                    auditableCount = auditableElements.length;
                    const auditableElementsSpan = document.getElementById('auditableElements');
                    auditableElementsSpan.textContent = auditableCount;
                    auditableElementsSpan.className = 'auditable-elements-clickable';
                    auditableElementsSpan.title = `Click to view ${auditableCount} auditable elements`;
                } else {
                    // Show loading indicator and extract auditable elements
                    const auditableElementsSpan = document.getElementById('auditableElements');
                    auditableElementsSpan.textContent = 'Loading...';
                    auditableElementsSpan.className = 'auditable-elements-loading';
                    auditableElementsSpan.title = 'Extracting auditable elements...';
                    
                    try {
                        console.log('No auditable elements found, extracting via AI...');
                        const serverUrl = window.SERVER_URL || 'https://clerky-uzni.onrender.com';
                        const response = await fetch(`${serverUrl}/updateGuidelinesWithAuditableElements`, {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                'Authorization': `Bearer ${await this.getAuthToken()}`
                            },
                            body: JSON.stringify({
                                guidelineId: fullGuideline.id
                            })
                        });
                        
                        const result = await response.json();
                        
                        if (result.success) {
                            // Find the updated guideline data
                            const updatedGuideline = result.results.find(r => r.guidelineId === fullGuideline.id);
                            if (updatedGuideline && updatedGuideline.count > 0) {
                                auditableCount = updatedGuideline.count;
                                console.log(`Successfully extracted ${auditableCount} auditable elements`);
                                
                                // Update display with clickable styling
                                auditableElementsSpan.textContent = auditableCount;
                                auditableElementsSpan.className = 'auditable-elements-clickable';
                                auditableElementsSpan.title = `Click to view ${auditableCount} auditable elements`;
                                
                                // Update the stored data with the new auditable elements
                                if (updatedGuideline.auditableElements) {
                                    this.selectedGuidelineFullData.auditableElements = updatedGuideline.auditableElements;
                                }
                            } else {
                                auditableCount = 0;
                                console.log('No auditable elements extracted');
                                
                                // Update display for no elements
                                auditableElementsSpan.textContent = auditableCount;
                                auditableElementsSpan.className = 'auditable-elements-clickable';
                                auditableElementsSpan.title = 'Click to view auditable elements (none found)';
                            }
                        } else {
                            auditableCount = 0;
                            console.error('Failed to extract auditable elements:', result.error);
                            
                            // Update display for error
                            auditableElementsSpan.textContent = 'Error';
                            auditableElementsSpan.className = 'auditable-elements-error';
                            auditableElementsSpan.title = 'Click to view auditable elements (extraction failed)';
                        }
                        
                    } catch (error) {
                        console.error('Error extracting auditable elements:', error);
                        auditableElementsSpan.textContent = 'Error';
                        auditableElementsSpan.className = 'auditable-elements-error';
                        auditableElementsSpan.title = 'Click to view auditable elements (extraction failed)';
                    }
                }
                
                // Last updated from full metadata
                let lastUpdatedText = 'Unknown';
                if (fullGuideline.lastUpdated) {
                    if (typeof fullGuideline.lastUpdated === 'object' && fullGuideline.lastUpdated._seconds) {
                        // Convert Firestore timestamp to readable date
                        const date = new Date(fullGuideline.lastUpdated._seconds * 1000);
                        lastUpdatedText = date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
                    } else if (typeof fullGuideline.lastUpdated === 'string') {
                        lastUpdatedText = fullGuideline.lastUpdated;
                    }
                }
                document.getElementById('lastUpdated').textContent = lastUpdatedText;
                
                // Store full metadata for expandable view
                this.selectedGuidelineFullData = fullGuideline;
                
                // Populate metadata content for expandable view
                this.populateMetadataContent(fullGuideline);
                
                console.log('Updated guideline info with full metadata:', {
                    completeness: completenessPercent,
                    auditableElements: auditableCount,
                    lastUpdated: fullGuideline.lastUpdated
                });
                
            } catch (error) {
                console.error('Failed to fetch full metadata:', error);
                // Fallback to basic calculation
                const metadataFields = ['title', 'organisation', 'year', 'summary', 'significant_terms'];
                const completedFields = metadataFields.filter(field => guideline[field] && guideline[field].trim() !== '');
                const completenessPercent = Math.round((completedFields.length / metadataFields.length) * 100);
                
                document.getElementById('metadataPercent').textContent = `${completenessPercent}%`;
                
                // Handle auditable elements in fallback case
                const auditableElementsSpan = document.getElementById('auditableElements');
                const auditableCount = guideline.significant_terms ? guideline.significant_terms.split(',').length : 0;
                auditableElementsSpan.textContent = auditableCount;
                auditableElementsSpan.className = 'auditable-elements-clickable';
                auditableElementsSpan.title = `Click to view ${auditableCount} auditable elements`;
                
                document.getElementById('lastUpdated').textContent = guideline.lastUpdated || 'Unknown';
            }
        }
    }

    // Fetch full guideline metadata from Firestore
    async fetchFullGuidelineMetadata(guidelineId) {
        try {
            // Since we already have all guidelines loaded, find the specific one
            const fullGuideline = this.allGuidelines.find(g => g.id === guidelineId);
            
            if (!fullGuideline) {
                throw new Error(`Guideline with ID ${guidelineId} not found in loaded data`);
            }
            
            console.log('Found full guideline metadata:', fullGuideline);
            return fullGuideline;
            
        } catch (error) {
            console.error('Failed to fetch full guideline metadata:', error);
            throw error;
        }
    }

    // Run new audit
    async runNewAudit() {
        if (!this.selectedGuideline) {
            this.showAuditError('Please select a guideline first');
            return;
        }

        const btn = document.getElementById('runNewAuditBtn');
        const spinner = document.getElementById('runAuditSpinner');
        
        try {
            btn.disabled = true;
            spinner.style.display = 'inline-block';
            
            console.log('Running new audit for guideline:', this.selectedGuideline.id);
            
            // Call server endpoint to run audit
            const serverUrl = window.SERVER_URL || 'https://clerky-uzni.onrender.com';
            const response = await fetch(`${serverUrl}/runAudit`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${await this.getAuthToken()}`
                },
                body: JSON.stringify({
                    guidelineId: this.selectedGuideline.id,
                    guidelineTitle: this.selectedGuideline.title,
                    aiProvider: this.currentAIProvider // Pass selected AI provider
                })
            });
            
            const result = await response.json();
            
            if (result.success) {
                this.displayAuditResults(result.audit);
                this.showAuditSuccess('Audit completed successfully');
            } else {
                throw new Error(result.message || 'Audit failed');
            }
            
        } catch (error) {
            console.error('Audit failed:', error);
            this.showAuditError('Audit failed: ' + error.message);
        } finally {
            btn.disabled = false;
            spinner.style.display = 'none';
        }
    }

    // Retrieve previous audits
    async retrievePreviousAudits() {
        if (!this.selectedGuideline) {
            this.showAuditError('Please select a guideline first');
            return;
        }

        const btn = document.getElementById('retrieveAuditsBtn');
        const spinner = document.getElementById('retrieveSpinner');
        
        try {
            btn.disabled = true;
            spinner.style.display = 'inline-block';
            
            console.log('Retrieving previous audits for guideline:', this.selectedGuideline.id);
            
            // Call server endpoint to retrieve audits
            const serverUrl = window.SERVER_URL || 'https://clerky-uzni.onrender.com';
            const response = await fetch(`${serverUrl}/getAudits?guidelineId=${this.selectedGuideline.id}`);
            const result = await response.json();
            
            if (result.success) {
                this.displayAuditResults(result.audits);
                this.showAuditSuccess(`Retrieved ${result.audits.length} previous audits`);
            } else {
                throw new Error(result.message || 'Failed to retrieve audits');
            }
            
        } catch (error) {
            console.error('Failed to retrieve audits:', error);
            this.showAuditError('Failed to retrieve audits: ' + error.message);
        } finally {
            btn.disabled = false;
            spinner.style.display = 'none';
        }
    }

    // Display audit results
    displayAuditResults(audits) {
        const resultsDiv = document.getElementById('auditResults');
        resultsDiv.className = 'audit-results';
        
        if (!audits || audits.length === 0) {
            resultsDiv.innerHTML = '<div style="text-align: center; color: #6c757d; font-style: italic;">No audit results found</div>';
            return;
        }
        
        let html = '<h3>Audit Results</h3>';
        
        audits.forEach((audit, index) => {
            html += `
                <div style="border: 1px solid #ddd; border-radius: 4px; padding: 15px; margin-bottom: 15px;">
                    <h4>Audit #${index + 1} - ${new Date(audit.timestamp).toLocaleString()}</h4>
                    <div style="margin-top: 10px;">
                        <strong>Status:</strong> ${audit.status}<br>
                        <strong>Compliance Score:</strong> ${audit.complianceScore || 'N/A'}%<br>
                        <strong>Issues Found:</strong> ${audit.issuesFound || 0}<br>
                        <strong>Recommendations:</strong> ${audit.recommendations || 0}
                    </div>
                    ${audit.details ? `<div style="margin-top: 10px; padding: 10px; background: #f8f9fa; border-radius: 4px;"><strong>Details:</strong><br>${audit.details}</div>` : ''}
                </div>
            `;
        });
        
        resultsDiv.innerHTML = html;
    }

    // Show audit error
    showAuditError(message) {
        const resultsDiv = document.getElementById('auditResults');
        resultsDiv.className = 'audit-results';
        resultsDiv.innerHTML = `<div class="audit-error">${message}</div>`;
    }

    // Show audit success
    showAuditSuccess(message) {
        const resultsDiv = document.getElementById('auditResults');
        const existingContent = resultsDiv.innerHTML;
        resultsDiv.innerHTML = `<div class="audit-success">${message}</div>` + existingContent;
        
        // Remove success message after 3 seconds
        setTimeout(() => {
            const successDiv = resultsDiv.querySelector('.audit-success');
            if (successDiv) {
                successDiv.remove();
            }
        }, 3000);
    }
    
    // Populate metadata content for expandable view
    populateMetadataContent(guideline) {
        const metadataContent = document.getElementById('metadataContent');
        if (metadataContent) {
            // Format the metadata as JSON for easy reading
            const formattedMetadata = JSON.stringify(guideline, null, 2);
            metadataContent.textContent = formattedMetadata;
        }
    }
    
    // Toggle metadata view
    toggleMetadataView() {
        const toggleBtn = document.getElementById('toggleMetadataBtn');
        const metadataDetails = document.getElementById('metadataDetails');
        
        if (toggleBtn && metadataDetails) {
            const isExpanded = metadataDetails.style.display !== 'none';
            
            if (isExpanded) {
                // Collapse
                metadataDetails.style.display = 'none';
                toggleBtn.classList.remove('expanded');
                toggleBtn.innerHTML = '<span class="toggle-icon">▼</span> View Full Metadata';
            } else {
                // Expand
                metadataDetails.style.display = 'block';
                toggleBtn.classList.add('expanded');
                toggleBtn.innerHTML = '<span class="toggle-icon">▼</span> Hide Full Metadata';
            }
        }
    }
    
    // Get authentication token for API calls
    async getAuthToken() {
        try {
            const user = getCurrentUser();
            if (user) {
                return await user.getIdToken();
            }
            return null;
        } catch (error) {
            console.error('Error getting auth token:', error);
            return null;
        }
    }

    // Search guidelines for autocomplete
    searchGuidelines(query, dropdown) {
        console.log(`🔍 Searching for: "${query}"`);
        
        if (query.length < 2) {
            dropdown.style.display = 'none';
            return;
        }
        
        const filtered = this.allGuidelines.filter(guideline => {
            const title = guideline.title ? guideline.title.toLowerCase() : '';
            const humanFriendlyName = guideline.human_friendly_name ? guideline.human_friendly_name.toLowerCase() : '';
            const organisation = guideline.organisation ? guideline.organisation.toLowerCase() : '';
            
            const matches = title.includes(query) || 
                           humanFriendlyName.includes(query) || 
                           organisation.includes(query);
            
            if (matches) {
                console.log(`✅ Match found: "${guideline.human_friendly_name || guideline.title}" (${guideline.organisation})`);
            }
            
            return matches;
        }).slice(0, 10);
        
        console.log(`📋 Found ${filtered.length} matching guidelines`);
        this.displayGuidelineOptions(filtered, dropdown);
    }

    // Display auditable elements in the right column
    displayAuditableElements() {
        if (!this.selectedGuidelineFullData) {
            this.showAuditError('No guideline selected');
            return;
        }
        
        const auditableElements = this.selectedGuidelineFullData.auditableElements || [];
        const resultsDiv = document.getElementById('auditResults');
        
        if (auditableElements.length === 0) {
            resultsDiv.innerHTML = `
                <div class="audit-error">
                    <h3>No Auditable Elements Found</h3>
                    <p>This guideline does not have any auditable elements extracted yet. 
                    You can run an audit to extract auditable elements from the guideline content.</p>
                </div>
            `;
            return;
        }
        
        let elementsHtml = `
            <div class="audit-success">
                <h3>📋 Auditable Elements for "${this.selectedGuidelineFullData.title || 'Unknown Guideline'}"</h3>
                <p><strong>Total Elements:</strong> ${auditableElements.length}</p>
                <p>These are the clinically relevant advice elements that can be audited for accuracy:</p>
            </div>
        `;
        
        auditableElements.forEach((element, index) => {
            elementsHtml += `
                <div style="background: #f8f9fa; border: 1px solid #e9ecef; border-radius: 8px; padding: 15px; margin: 10px 0;">
                    <h4 style="margin: 0 0 10px 0; color: #2c3e50;">Element ${index + 1}</h4>
                    <div style="font-family: 'Courier New', monospace; font-size: 14px; color: #495057; 
                                background: white; padding: 10px; border-radius: 4px; border: 1px solid #e9ecef; 
                                white-space: pre-wrap; word-wrap: break-word;">
                        ${element}
                    </div>
                </div>
            `;
        });
        
        resultsDiv.innerHTML = elementsHtml;
        resultsDiv.classList.remove('empty');
    }
} 