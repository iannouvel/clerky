// Audit module - contains only audit-specific functionality
import { auth } from './firebase-core.js';
import { loadGuidelinesFromFirestore } from './guidelines.js';

// Audit page specific functionality
export class AuditPage {
    constructor() {
        this.allGuidelines = [];
        this.selectedGuideline = null;
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

    // Setup event listeners
    setupEventListeners() {
        // Guideline input autocomplete
        const guidelineInput = document.getElementById('guidelineInput');
        const guidelineDropdown = document.getElementById('guidelineDropdown');
        
        if (guidelineInput && guidelineDropdown) {
            guidelineInput.addEventListener('input', (e) => {
                const query = e.target.value.toLowerCase();
                console.log(`🔍 Searching for: "${query}"`);
                
                if (query.length < 2) {
                    guidelineDropdown.style.display = 'none';
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
                this.displayGuidelineOptions(filtered, guidelineDropdown);
            });

            guidelineInput.addEventListener('focus', () => {
                if (guidelineInput.value.length >= 2) {
                    guidelineDropdown.style.display = 'block';
                }
            });

            // Close dropdown when clicking outside
            document.addEventListener('click', (e) => {
                if (!e.target.closest('.guideline-selector')) {
                    guidelineDropdown.style.display = 'none';
                }
            });
        }

        // Run new audit button
        const runNewAuditBtn = document.getElementById('runNewAuditBtn');
        if (runNewAuditBtn) {
            runNewAuditBtn.addEventListener('click', () => this.runNewAudit());
        }

        // Retrieve audits button
        const retrieveAuditsBtn = document.getElementById('retrieveAuditsBtn');
        if (retrieveAuditsBtn) {
            retrieveAuditsBtn.addEventListener('click', () => this.retrievePreviousAudits());
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
            option.addEventListener('click', () => this.selectGuideline(guideline));
            dropdown.appendChild(option);
        });
        
        dropdown.style.display = 'block';
    }

    // Select a guideline
    selectGuideline(guideline) {
        this.selectedGuideline = guideline;
        
        // Use human_friendly_name if available, otherwise fall back to title
        const displayName = guideline.human_friendly_name || guideline.title;
        document.getElementById('guidelineInput').value = displayName;
        document.getElementById('guidelineDropdown').style.display = 'none';
        
        // Update guideline information
        this.updateGuidelineInfo(guideline);
        
        console.log('Selected guideline for audit:', guideline);
    }

    // Update guideline information display
    updateGuidelineInfo(guideline) {
        const infoDiv = document.getElementById('guidelineInfo');
        const noSelectionDiv = document.getElementById('noGuidelineSelected');
        
        if (infoDiv && noSelectionDiv) {
            infoDiv.style.display = 'block';
            noSelectionDiv.style.display = 'none';
            
            // Calculate metadata completeness
            const metadataFields = ['title', 'organisation', 'year', 'summary', 'significant_terms'];
            const completedFields = metadataFields.filter(field => guideline[field] && guideline[field].trim() !== '');
            const completenessPercent = Math.round((completedFields.length / metadataFields.length) * 100);
            
            document.getElementById('metadataPercent').textContent = `${completenessPercent}%`;
            
            // Count auditable elements (placeholder - would need actual implementation)
            const auditableCount = guideline.significant_terms ? guideline.significant_terms.split(',').length : 0;
            document.getElementById('auditableElements').textContent = auditableCount;
            
            // Last updated (placeholder)
            document.getElementById('lastUpdated').textContent = guideline.lastUpdated || 'Unknown';
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
                },
                body: JSON.stringify({
                    guidelineId: this.selectedGuideline.id,
                    guidelineTitle: this.selectedGuideline.title
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
} 