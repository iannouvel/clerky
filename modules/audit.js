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
        
        // Show sections that are hidden until a guideline is selected
        const controlsSection = document.getElementById('auditControlsSection');
        if (controlsSection) controlsSection.style.display = 'block';
        const infoSection = document.getElementById('guidelineInformationSection');
        if (infoSection) infoSection.style.display = 'block';
        const noSelectionDiv = document.getElementById('noGuidelineSelected');
        if (noSelectionDiv) noSelectionDiv.style.display = 'none';

        // Update guideline information (now async)
        await this.updateGuidelineInfo(guideline);

        // Check if there are previous audits for this guideline to decide button visibility
        await this.updateRetrieveButtonVisibility(guideline.id);
        
        // Show auditable elements selection if elements are available
        const auditableElementsSelection = document.getElementById('auditableElementsSelection');
        if (auditableElementsSelection) {
            if (this.selectedGuidelineFullData && this.selectedGuidelineFullData.auditableElements && 
                this.selectedGuidelineFullData.auditableElements.length > 0) {
                auditableElementsSelection.style.display = 'block';
            } else {
                auditableElementsSelection.style.display = 'none';
            }
        }
        
        console.log('Selected guideline for audit:', guideline);
    }

    // Show or hide the Retrieve Previous Audits button based on availability
    async updateRetrieveButtonVisibility(guidelineId) {
        const retrieveBtn = document.getElementById('retrieveAuditsBtn');
        if (!retrieveBtn) return;
        
        try {
            const serverUrl = window.SERVER_URL || 'https://clerky-uzni.onrender.com';
            const authToken = await this.getAuthToken();
            const url = `${serverUrl}/getAudits?guidelineId=${encodeURIComponent(guidelineId)}`;
            const response = await fetch(url, {
                headers: authToken ? { 'Authorization': `Bearer ${authToken}` } : {}
            });

            if (!response.ok) {
                // Treat non-200 responses (e.g., 404) as "no audits"
                retrieveBtn.style.display = 'none';
                return;
            }

            const result = await response.json();
            
            if (result.success && Array.isArray(result.audits) && result.audits.length > 0) {
                retrieveBtn.style.display = 'inline-block';
            } else {
                retrieveBtn.style.display = 'none';
            }
        } catch (error) {
            console.warn('Could not determine previous audits; hiding Retrieve button by default.', error);
            retrieveBtn.style.display = 'none';
        }
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
                // Prepare selected guideline data early so later updates persist
                this.selectedGuidelineFullData = { ...fullGuideline };
                
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
                    
                    // Update will audit count and setup listeners
                    this.updateWillAuditCount(fullGuideline.auditableElements || []);
                    this.setupScopeChangeListeners(fullGuideline.auditableElements || []);
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
                                    // persist on both the working copy and original reference
                                    fullGuideline.auditableElements = updatedGuideline.auditableElements;
                                    this.selectedGuidelineFullData.auditableElements = updatedGuideline.auditableElements;
                                }
                                
                                // Show auditable elements selection
                                const auditableElementsSelection = document.getElementById('auditableElementsSelection');
                                if (auditableElementsSelection && auditableCount > 0) {
                                    auditableElementsSelection.style.display = 'block';
                                    // Update will audit count
                                    this.updateWillAuditCount(updatedGuideline.auditableElements || []);
                                    // Setup scope change listeners
                                    this.setupScopeChangeListeners(updatedGuideline.auditableElements || []);
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
                
                // Populate metadata content for expandable view
                this.populateMetadataContent(fullGuideline);
                
                // Update "will be audited" count based on selected scope
                this.updateWillAuditCount(fullGuideline.auditableElements || []);
                
                // Add listeners for scope changes
                this.setupScopeChangeListeners(fullGuideline.auditableElements || []);
                
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
                
                // Show auditable elements selection if elements are available
                const auditableElementsSelection = document.getElementById('auditableElementsSelection');
                if (auditableElementsSelection && auditableCount > 0) {
                    auditableElementsSelection.style.display = 'block';
                    // Update will audit count (using fallback calculation)
                    const fallbackElements = guideline.significant_terms ? 
                        guideline.significant_terms.split(',').map((term, idx) => ({ 
                            significance: 'high',
                            name: term.trim()
                        })) : [];
                    this.updateWillAuditCount(fallbackElements);
                    this.setupScopeChangeListeners(fallbackElements);
                }
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

        // Check if auditable elements are available
        if (!this.selectedGuidelineFullData || !this.selectedGuidelineFullData.auditableElements || 
            this.selectedGuidelineFullData.auditableElements.length === 0) {
            this.showAuditError('No auditable elements found for this guideline. Please ensure auditable elements have been extracted first.');
            return;
        }

        // Get audit scope from radio buttons
        const auditScope = document.querySelector('input[name="auditScope"]:checked')?.value || 'most_significant';
        
        const btn = document.getElementById('runNewAuditBtn');
        const spinner = document.getElementById('runAuditSpinner');
        
        try {
            btn.disabled = true;
            spinner.style.display = 'inline-block';
            
            // Show progress indicator and hide results
            this.showAuditProgress();
            this.updateProgress(1, 'Initialising audit process...', 10);
            
            console.log('Running new audit for guideline:', this.selectedGuideline.id, 'with scope:', auditScope);
            
            const serverUrl = window.SERVER_URL || 'https://clerky-uzni.onrender.com';
            
            // Step 1: Generate the correct audit transcript
            this.updateProgress(1, 'Generating correct transcript...', 20);
            console.log('Step 1: Generating correct audit transcript...');
            
            let transcriptResponse;
            try {
                transcriptResponse = await fetch(`${serverUrl}/generateAuditTranscript`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${await this.getAuthToken()}`
                },
                    body: JSON.stringify({
                        guidelineId: this.selectedGuideline.id,
                        auditableElements: this.selectedGuidelineFullData.auditableElements,
                        auditScope: auditScope,
                        aiProvider: this.currentAIProvider
                    })
                });
            } catch (fetchError) {
                if (fetchError.name === 'TypeError' && fetchError.message.includes('fetch')) {
                    throw new Error('Network error: Unable to connect to the server. Please check your internet connection and try again.');
                }
                throw fetchError;
            }
            
            if (!transcriptResponse.ok) {
                if (transcriptResponse.status === 0 || transcriptResponse.type === 'error') {
                    throw new Error('Network error: Unable to connect to the server. This may be a CORS issue or the server may be unavailable. Please try again later.');
                }
                const errorText = await transcriptResponse.text();
                throw new Error(`Failed to generate transcript (HTTP ${transcriptResponse.status}): ${errorText || 'Unknown error'}`);
            }
            
            const transcriptResult = await transcriptResponse.json();
            
            if (!transcriptResult.success) {
                throw new Error(transcriptResult.error || 'Failed to generate audit transcript');
            }
            
            console.log('Correct transcript generated:', transcriptResult.auditId);
            this.updateProgress(1, 'Transcript generated successfully', 50);
            
            // Step 2: Generate incorrect scripts
            this.updateProgress(2, 'Generating incorrect scripts...', 60);
            console.log('Step 2: Generating incorrect audit scripts...');
            
            // Refresh auth token before second request to avoid expiration during long operations
            const freshAuthToken = await this.getAuthToken(true);
            if (!freshAuthToken) {
                throw new Error('Authentication failed - please sign in again');
            }
            
            let incorrectResponse;
            try {
                incorrectResponse = await fetch(`${serverUrl}/generateIncorrectAuditScripts`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${freshAuthToken}`
                },
                    body: JSON.stringify({
                        auditId: transcriptResult.auditId,
                        correctTranscript: transcriptResult.transcript,
                        auditableElements: transcriptResult.auditableElements,
                        aiProvider: this.currentAIProvider
                    })
                });
            } catch (fetchError) {
                if (fetchError.name === 'TypeError' && fetchError.message.includes('fetch')) {
                    throw new Error('Network error: Unable to connect to the server while generating incorrect scripts. Please check your internet connection and try again.');
                }
                throw fetchError;
            }
            
            // Check for authentication errors or other HTTP errors
            if (!incorrectResponse.ok) {
                if (incorrectResponse.status === 401) {
                    // Token might have expired, try once more with forced refresh
                    this.updateProgress(2, 'Authentication expired, refreshing token...', 65);
                    console.warn('Received 401, attempting token refresh...');
                    const refreshedToken = await this.getAuthToken(true);
                    if (!refreshedToken) {
                        throw new Error('Authentication failed - your session may have expired. Please refresh the page and sign in again.');
                    }
                    
                    // Retry the request with refreshed token
                    this.updateProgress(2, 'Retrying with refreshed token...', 70);
                    let retryResponse;
                    try {
                        retryResponse = await fetch(`${serverUrl}/generateIncorrectAuditScripts`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${refreshedToken}`
                        },
                            body: JSON.stringify({
                                auditId: transcriptResult.auditId,
                                correctTranscript: transcriptResult.transcript,
                                auditableElements: transcriptResult.auditableElements,
                                aiProvider: this.currentAIProvider
                            })
                        });
                    } catch (retryFetchError) {
                        if (retryFetchError.name === 'TypeError' && retryFetchError.message.includes('fetch')) {
                            throw new Error('Network error: Unable to connect to the server. Please check your internet connection and try again.');
                        }
                        throw retryFetchError;
                    }
                    
                    if (!retryResponse.ok) {
                        if (retryResponse.status === 0 || retryResponse.type === 'error') {
                            throw new Error('Network error: Unable to connect to the server. This may be a CORS issue or the server may be unavailable.');
                        }
                        const errorText = await retryResponse.text();
                        throw new Error(`Failed to generate incorrect scripts (HTTP ${retryResponse.status}): ${errorText || 'Unknown error'}`);
                    }
                    
                    const retryResult = await retryResponse.json();
                    if (!retryResult.success) {
                        throw new Error(retryResult.error || 'Failed to generate incorrect scripts after authentication retry');
                    }
                    
                    console.log('Incorrect scripts generated after retry:', retryResult.incorrectScripts?.length || 0);
                    this.updateProgress(2, 'Incorrect scripts generated', 90);
                    
                    // Step 3: Display audit results with retry result
                    this.updateProgress(3, 'Compiling results...', 95);
                    
                    // Small delay to show compilation step
                    await new Promise(resolve => setTimeout(resolve, 300));
                    
                    this.displayAuditResults({
                        auditId: transcriptResult.auditId,
                        correctTranscript: transcriptResult.transcript,
                        auditableElements: transcriptResult.auditableElements,
                        incorrectScripts: retryResult.incorrectScripts,
                        auditScope: auditScope,
                        generated: transcriptResult.generated
                    });
                    
                    this.updateProgress(3, 'Complete!', 100);
                    
                    // Small delay to show completion before hiding progress
                    await new Promise(resolve => setTimeout(resolve, 500));
                    
                    this.hideAuditProgress();
                    this.showAuditSuccess(`Audit completed successfully! Generated ${transcriptResult.auditableElements.length} auditable elements and ${retryResult.incorrectScripts?.length || 0} incorrect scripts.`);
                    
                    // Ensure the Retrieve Previous Audits button is visible
                    const retrieveBtn = document.getElementById('retrieveAuditsBtn');
                    if (retrieveBtn) retrieveBtn.style.display = 'inline-block';
                    
                    return; // Exit early since we handled the retry
                } else if (incorrectResponse.status === 0 || incorrectResponse.type === 'error') {
                    // Network/CORS error
                    throw new Error('Network error: Unable to connect to the server. This may be a CORS issue or the server may be unavailable. Please check your internet connection and try again.');
                } else {
                    // Other HTTP errors
                    const errorText = await incorrectResponse.text();
                    throw new Error(`Failed to generate incorrect scripts (HTTP ${incorrectResponse.status}): ${errorText || 'Unknown error'}`);
                }
            }
            
            const incorrectResult = await incorrectResponse.json();
            
            if (!incorrectResult.success) {
                throw new Error(incorrectResult.error || 'Failed to generate incorrect scripts');
            }
            
            console.log('Incorrect scripts generated:', incorrectResult.incorrectScripts.length);
            this.updateProgress(2, 'Incorrect scripts generated', 90);
            
            // Step 3: Display audit results
            this.updateProgress(3, 'Compiling results...', 95);
            this.displayAuditResults({
                auditId: transcriptResult.auditId,
                correctTranscript: transcriptResult.transcript,
                auditableElements: transcriptResult.auditableElements,
                incorrectScripts: incorrectResult.incorrectScripts,
                auditScope: auditScope,
                generated: transcriptResult.generated
            });
            
            this.updateProgress(3, 'Complete!', 100);
            
            // Small delay to show completion before hiding progress
            await new Promise(resolve => setTimeout(resolve, 500));
            
            this.hideAuditProgress();
            this.showAuditSuccess(`Audit completed successfully! Generated ${transcriptResult.auditableElements.length} auditable elements and ${incorrectResult.incorrectScripts.length} incorrect scripts.`);
            
            // Ensure the Retrieve Previous Audits button is visible after a successful audit
            const retrieveBtn = document.getElementById('retrieveAuditsBtn');
            if (retrieveBtn) retrieveBtn.style.display = 'inline-block';
            
        } catch (error) {
            console.error('Audit failed:', error);
            this.hideAuditProgress();
            
            // Show more helpful error messages
            let errorMessage = error.message;
            if (errorMessage.includes('Network error') || errorMessage.includes('fetch')) {
                errorMessage = 'Network Error: Unable to connect to the server. Please check your internet connection. If the problem persists, the server may be temporarily unavailable.';
            } else if (errorMessage.includes('CORS')) {
                errorMessage = 'Connection Error: There was a CORS (Cross-Origin) issue connecting to the server. Please try again or contact support.';
            }
            
            this.showAuditError('Audit failed: ' + errorMessage);
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

    // Display audit results with tabbed interface
    displayAuditResults(auditData) {
        const resultsDiv = document.getElementById('auditResults');
        resultsDiv.className = 'audit-results';
        
        if (!auditData) {
            resultsDiv.innerHTML = '<div style="text-align: center; color: #6c757d; font-style: italic;">No audit results found</div>';
            return;
        }
        
        // Store audit data for later use
        this.currentAuditData = auditData;
        
        // Create tabbed interface
        const incorrectCount = auditData.incorrectScripts ? auditData.incorrectScripts.length : 0;
        
        let html = `
            <!-- Summary Card -->
            <div class="summary-card">
                <div class="summary-card-header">
                    <h3 class="summary-card-title">Audit Summary</h3>
                    <div style="font-size: 12px; color: #6c757d;">
                        ID: ${auditData.auditId.substring(0, 20)}...
                    </div>
                </div>
                <div class="summary-stats">
                    <div class="summary-stat">
                        <span class="summary-stat-value">${auditData.auditableElements.length}</span>
                        <span class="summary-stat-label">Elements</span>
                    </div>
                    <div class="summary-stat">
                        <span class="summary-stat-value">${incorrectCount}</span>
                        <span class="summary-stat-label">Issues Found</span>
                    </div>
                    <div class="summary-stat">
                        <span class="summary-stat-value">${auditData.auditScope.replace(/_/g, ' ')}</span>
                        <span class="summary-stat-label">Scope</span>
                    </div>
                    <div class="summary-stat">
                        <span class="summary-stat-value" style="font-size: 14px;">${new Date(auditData.generated).toLocaleDateString()}</span>
                        <span class="summary-stat-label">Generated</span>
                    </div>
                </div>
            </div>
            
            <!-- Tab Navigation -->
            <div class="audit-tabs">
                <button class="audit-tab active" data-tab="transcripts">Transcripts</button>
                <button class="audit-tab" data-tab="elements">Elements (${auditData.auditableElements.length})</button>
                ${incorrectCount > 0 ? `<button class="audit-tab" data-tab="issues">Issues (${incorrectCount})</button>` : ''}
            </div>
            
            <!-- Tab Content: Transcripts -->
            <div id="tab-transcripts" class="audit-tab-content active">
                ${this.renderTranscriptsTab(auditData)}
            </div>
            
            <!-- Tab Content: Elements -->
            <div id="tab-elements" class="audit-tab-content">
                ${this.renderElementsTab(auditData)}
            </div>
            
            ${incorrectCount > 0 ? `
            <!-- Tab Content: Issues -->
            <div id="tab-issues" class="audit-tab-content">
                ${this.renderIssuesTab(auditData)}
            </div>
            ` : ''}
            
        `;
        
        resultsDiv.innerHTML = html;
        
        // Set up tab switching
        this.setupTabNavigation();
        
        // Set up transcript modal
        this.setupTranscriptModal();
        
        // Add automated testing if needed
        if (incorrectCount > 0) {
            this.addAutomatedTesting(auditData);
        }
    }
    
    // Render transcripts tab
    renderTranscriptsTab(auditData) {
        // Correct transcript preview
        const transcriptPreview = auditData.correctTranscript.substring(0, 500) + '...';
        
        let html = `
            <div class="transcript-card">
                <div class="transcript-card-header" onclick="this.parentElement.querySelector('.transcript-card-body').classList.toggle('expanded')">
                    <h5>✅ Correct Transcript</h5>
                    <span style="font-size: 12px; color: #6c757d;">Click to expand</span>
                </div>
                <div class="transcript-card-body">
                    <div class="transcript-preview">${this.escapeHtml(auditData.correctTranscript)}</div>
                    <button class="view-full-btn" data-transcript-title="Correct Transcript" data-transcript-content="${this.escapeHtml(JSON.stringify(auditData.correctTranscript))}">
                        View Full Transcript
                    </button>
                </div>
            </div>
        `;
        
        // Incorrect transcripts
        if (auditData.incorrectScripts && auditData.incorrectScripts.length > 0) {
            auditData.incorrectScripts.forEach((script, index) => {
                html += `
                    <div class="transcript-card">
                        <div class="transcript-card-header" onclick="this.parentElement.querySelector('.transcript-card-body').classList.toggle('expanded')">
                            <h5>❌ Incorrect Script ${index + 1}: ${this.escapeHtml(script.elementName)}</h5>
                            <span style="font-size: 12px; color: #6c757d;">Click to expand</span>
                        </div>
                        <div class="transcript-card-body">
                            <div style="margin-bottom: 10px; font-size: 13px;">
                                <strong>Error Type:</strong> ${this.escapeHtml(script.errorType || 'Unknown')}
                            </div>
                            <div class="transcript-preview">${this.escapeHtml(script.incorrectTranscript)}</div>
                            <button class="view-full-btn" data-transcript-title="Incorrect Script ${index + 1}: ${this.escapeHtml(script.elementName)}" data-transcript-content="${this.escapeHtml(JSON.stringify(script.incorrectTranscript))}">
                                View Full Transcript
                            </button>
                        </div>
                    </div>
                `;
            });
        }
        
        return html;
    }
    
    // Render elements tab
    renderElementsTab(auditData) {
        let html = '<div style="display: flex; flex-direction: column; gap: 10px;">';
        
        auditData.auditableElements.forEach((element, index) => {
            const significance = element.significance || 'unknown';
            html += `
                <div class="element-item" onclick="this.classList.toggle('expanded')">
                    <div class="element-header">
                        <div>
                            <span class="element-title">Element ${index + 1}: ${this.escapeHtml(element.name)}</span>
                            <span class="element-badge ${significance}">${significance}</span>
                        </div>
                        <span style="font-size: 12px; color: #6c757d;">▼</span>
                    </div>
                    <div class="element-details">
                        <div style="margin-top: 10px;">
                            <strong>Type:</strong> ${this.escapeHtml(element.type || 'N/A')}<br>
                            <strong>Input Variables:</strong> ${element.inputVariables ? this.escapeHtml(element.inputVariables.join(', ')) : 'None'}<br>
                            <strong>Derived Advice:</strong> ${this.escapeHtml(element.derivedAdvice || 'N/A')}
                        </div>
                    </div>
                </div>
            `;
        });
        
        html += '</div>';
        return html;
    }
    
    // Render issues tab
    renderIssuesTab(auditData) {
        if (!auditData.incorrectScripts || auditData.incorrectScripts.length === 0) {
            return '<div style="text-align: center; color: #6c757d; padding: 40px;">No issues found</div>';
        }
        
        let html = '';
        auditData.incorrectScripts.forEach((script, index) => {
            html += `
                <div class="summary-card" style="border-left: 4px solid #dc3545;">
                    <h4 style="color: #dc3545; margin: 0 0 10px 0;">Issue ${index + 1}: ${this.escapeHtml(script.elementName)}</h4>
                    <div style="margin-bottom: 10px;">
                        <strong>Error Type:</strong> ${this.escapeHtml(script.errorType || 'Unknown')}<br>
                        <strong>Generated:</strong> ${new Date(script.generatedAt).toLocaleString()}
                    </div>
                    <button class="view-full-btn" data-transcript-title="Issue ${index + 1}: ${this.escapeHtml(script.elementName)}" data-transcript-content="${this.escapeHtml(JSON.stringify(script.incorrectTranscript))}">
                        View Full Transcript
                    </button>
                </div>
            `;
        });
        
        return html;
    }
    
    // Set up tab navigation
    setupTabNavigation() {
        const tabs = document.querySelectorAll('.audit-tab');
        const tabContents = document.querySelectorAll('.audit-tab-content');
        
        tabs.forEach(tab => {
            tab.addEventListener('click', () => {
                const targetTab = tab.dataset.tab;
                
                // Remove active from all tabs and contents
                tabs.forEach(t => t.classList.remove('active'));
                tabContents.forEach(c => c.classList.remove('active'));
                
                // Add active to clicked tab and corresponding content
                tab.classList.add('active');
                const content = document.getElementById(`tab-${targetTab}`);
                if (content) {
                    content.classList.add('active');
                }
            });
        });
    }
    
        // Set up transcript modal
        setupTranscriptModal() {
            const modal = document.getElementById('transcriptModal');
            const closeBtn = document.getElementById('transcriptModalClose');
            
            if (closeBtn) {
                closeBtn.addEventListener('click', () => {
                    if (modal) modal.classList.remove('active');
                });
            }
            
            if (modal) {
                modal.addEventListener('click', (e) => {
                    if (e.target === modal) {
                        modal.classList.remove('active');
                    }
                });
            }
            
            // Set up view full transcript buttons
            document.addEventListener('click', (e) => {
                if (e.target.classList.contains('view-full-btn')) {
                    const title = e.target.dataset.transcriptTitle;
                    const contentJson = e.target.dataset.transcriptContent;
                    if (title && contentJson) {
                        try {
                            const content = JSON.parse(contentJson);
                            this.openTranscriptModal(title, content);
                        } catch (error) {
                            console.error('Error parsing transcript content:', error);
                        }
                    }
                }
            });
        }
    
    // Open transcript modal
    openTranscriptModal(title, content) {
        const modal = document.getElementById('transcriptModal');
        const modalTitle = document.getElementById('transcriptModalTitle');
        const modalText = document.getElementById('transcriptModalText');
        
        if (modal && modalTitle && modalText) {
            modalTitle.textContent = title;
            modalText.textContent = content;
            modal.classList.add('active');
        }
    }
    
    // Escape HTML for safe display
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
    
    // Add automated testing section
    addAutomatedTesting(auditData) {
        // Find the issues tab and add testing section there
        const issuesTab = document.getElementById('tab-issues');
        if (!issuesTab) return;
        
        const testingHtml = `
            <div class="summary-card" style="border: 1px solid #ffc107; background: #fffbf0;">
                <h4 style="color: #856404; margin: 0 0 10px 0;">🧪 Automated Testing</h4>
                <p style="margin: 0 0 15px 0; color: #856404;">Test the generated transcripts against the auditable elements using AI validation.</p>
                <button id="runAutomatedTestsBtn" class="audit-btn" style="background: #ffc107; color: #212529;">
                    <span id="automatedTestSpinner" class="spinner" style="display: none;"></span>
                    Run Automated Tests
                </button>
                <div id="automatedTestResults" style="margin-top: 15px; display: none;"></div>
            </div>
        `;
        
        issuesTab.insertAdjacentHTML('beforeend', testingHtml);
        
        const testBtn = document.getElementById('runAutomatedTestsBtn');
        if (testBtn) {
            testBtn.addEventListener('click', () => {
                this.runAutomatedTests(auditData);
            });
        }
    }

    // Show audit error
    showAuditError(message) {
        const resultsDiv = document.getElementById('auditResults');
        resultsDiv.className = 'audit-results';
        resultsDiv.innerHTML = `<div class="audit-error">${message}</div>`;
    }
    
    // Show progress indicator
    showAuditProgress() {
        const progressContainer = document.getElementById('auditProgress');
        const resultsDiv = document.getElementById('auditResults');
        
        if (progressContainer) {
            progressContainer.style.display = 'block';
        }
        
        if (resultsDiv) {
            resultsDiv.className = 'audit-results empty';
            resultsDiv.style.display = 'none';
        }
        
        // Reset all steps
        for (let i = 1; i <= 3; i++) {
            const step = document.getElementById(`step-${i}`);
            if (step) {
                step.classList.remove('active', 'completed');
            }
        }
        
        // Reset progress bar
        const progressBarFill = document.getElementById('progressBarFill');
        const progressPercentage = document.getElementById('progressPercentage');
        if (progressBarFill) progressBarFill.style.width = '0%';
        if (progressPercentage) progressPercentage.textContent = '0%';
    }
    
    // Hide progress indicator
    hideAuditProgress() {
        const progressContainer = document.getElementById('auditProgress');
        if (progressContainer) {
            progressContainer.style.display = 'none';
        }
        
        // Show results again
        const resultsDiv = document.getElementById('auditResults');
        if (resultsDiv) {
            resultsDiv.style.display = 'block';
        }
    }
    
    // Update progress indicator
    updateProgress(stepNumber, statusText, percentage) {
        const statusEl = document.getElementById('progressStatus');
        if (statusEl) {
            statusEl.textContent = statusText || 'Processing...';
        }
        
        // Update step states
        for (let i = 1; i <= 3; i++) {
            const step = document.getElementById(`step-${i}`);
            if (step) {
                step.classList.remove('active', 'completed');
                
                if (i < stepNumber) {
                    step.classList.add('completed');
                } else if (i === stepNumber) {
                    step.classList.add('active');
                }
            }
        }
        
        // Update progress bar
        const progressBarFill = document.getElementById('progressBarFill');
        const progressPercentage = document.getElementById('progressPercentage');
        
        if (progressBarFill) {
            progressBarFill.style.width = `${Math.min(100, Math.max(0, percentage))}%`;
        }
        
        if (progressPercentage) {
            progressPercentage.textContent = `${Math.min(100, Math.max(0, percentage))}%`;
        }
    }

    // Run automated tests using /auditElementCheck endpoint
    async runAutomatedTests(auditData) {
        console.log('[DEBUG] runAutomatedTests method called with auditData:', auditData);
        
        const testBtn = document.getElementById('runAutomatedTestsBtn');
        const spinner = document.getElementById('automatedTestSpinner');
        const resultsDiv = document.getElementById('automatedTestResults');
        
        console.log('[DEBUG] Found elements:', { testBtn: !!testBtn, spinner: !!spinner, resultsDiv: !!resultsDiv });
        
        try {
            testBtn.disabled = true;
            spinner.style.display = 'inline-block';
            resultsDiv.style.display = 'block';
            resultsDiv.innerHTML = '<div style="text-align: center; color: #6c757d;">Running automated tests...</div>';
            
            console.log('🧪 Starting automated tests for audit:', auditData.auditId);
            
            const serverUrl = window.SERVER_URL || 'https://clerky-uzni.onrender.com';
            const authToken = await this.getAuthToken();
            
            const testResults = [];
            let correctTests = 0;
            let incorrectTests = 0;
            
            // Test 1: Correct transcript should pass all elements
            console.log('Testing correct transcript...');
            for (const element of auditData.auditableElements) {
                try {
                    const response = await fetch(`${serverUrl}/auditElementCheck`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${authToken}`
                        },
                        body: JSON.stringify({
                            guidelineId: auditData.guidelineId || this.selectedGuideline.id,
                            auditableElement: element.element,
                            transcript: auditData.correctTranscript
                        })
                    });
                    
                    const result = await response.json();
                    
                    if (result.success) {
                        const testResult = {
                            testType: 'correct_transcript',
                            elementName: element.name,
                            elementSignificance: element.significance,
                            isCorrect: result.result.isCorrect,
                            expected: true,
                            passed: result.result.isCorrect === true,
                            issues: result.result.issues || [],
                            suggestedFixes: result.result.suggestedFixes || []
                        };
                        
                        testResults.push(testResult);
                        if (testResult.passed) correctTests++;
                        else incorrectTests++;
                        
                        console.log(`✅ Correct transcript test for ${element.name}: ${testResult.passed ? 'PASSED' : 'FAILED'}`);
                    }
                } catch (error) {
                    console.error(`❌ Error testing correct transcript for ${element.name}:`, error);
                    testResults.push({
                        testType: 'correct_transcript',
                        elementName: element.name,
                        elementSignificance: element.significance,
                        error: error.message,
                        passed: false
                    });
                    incorrectTests++;
                }
            }
            
            // Test 2: Incorrect scripts should fail their respective elements
            console.log('Testing incorrect scripts...');
            for (const script of auditData.incorrectScripts) {
                try {
                    const response = await fetch(`${serverUrl}/auditElementCheck`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${authToken}`
                        },
                        body: JSON.stringify({
                            guidelineId: auditData.guidelineId || this.selectedGuideline.id,
                            auditableElement: script.auditableElement,
                            transcript: script.incorrectTranscript
                        })
                    });
                    
                    const result = await response.json();
                    
                    if (result.success) {
                        const testResult = {
                            testType: 'incorrect_transcript',
                            elementName: script.elementName,
                            elementSignificance: script.significance,
                            isCorrect: result.result.isCorrect,
                            expected: false,
                            passed: result.result.isCorrect === false,
                            issues: result.result.issues || [],
                            suggestedFixes: result.result.suggestedFixes || []
                        };
                        
                        testResults.push(testResult);
                        if (testResult.passed) correctTests++;
                        else incorrectTests++;
                        
                        console.log(`✅ Incorrect script test for ${script.elementName}: ${testResult.passed ? 'PASSED' : 'FAILED'}`);
                    }
                } catch (error) {
                    console.error(`❌ Error testing incorrect script for ${script.elementName}:`, error);
                    testResults.push({
                        testType: 'incorrect_transcript',
                        elementName: script.elementName,
                        elementSignificance: script.significance,
                        error: error.message,
                        passed: false
                    });
                    incorrectTests++;
                }
            }
            
            // Display results
            this.displayAutomatedTestResults(testResults, correctTests, incorrectTests);
            
        } catch (error) {
            console.error('❌ Automated testing failed:', error);
            resultsDiv.innerHTML = `<div class="audit-error">Automated testing failed: ${error.message}</div>`;
        } finally {
            testBtn.disabled = false;
            spinner.style.display = 'none';
        }
    }
    
    // Display automated test results
    displayAutomatedTestResults(testResults, correctTests, incorrectTests) {
        const resultsDiv = document.getElementById('automatedTestResults');
        if (!resultsDiv) return;
        
        const totalTests = testResults.length;
        const passRate = totalTests > 0 ? ((correctTests / totalTests) * 100).toFixed(1) : 0;
        
        // Create or update test results tab
        this.createTestResultsTab(testResults, correctTests, incorrectTests, totalTests, passRate);
        
        let html = `
            <div style="background: ${passRate >= 80 ? '#d4edda' : passRate >= 60 ? '#fff3cd' : '#f8d7da'}; 
                        color: ${passRate >= 80 ? '#155724' : passRate >= 60 ? '#856404' : '#721c24'}; 
                        padding: 15px; border-radius: 4px; margin-bottom: 15px;">
                <h5 style="margin: 0 0 10px 0;">📊 Test Results Summary</h5>
                <strong>Total Tests:</strong> ${totalTests}<br>
                <strong>Passed:</strong> ${correctTests}<br>
                <strong>Failed:</strong> ${incorrectTests}<br>
                <strong>Pass Rate:</strong> ${passRate}%
            </div>
        `;
        
        // Group tests by type
        const correctTranscriptTests = testResults.filter(t => t.testType === 'correct_transcript');
        const incorrectTranscriptTests = testResults.filter(t => t.testType === 'incorrect_transcript');
        
        // Display correct transcript tests
        if (correctTranscriptTests.length > 0) {
            html += `
                <div style="border: 1px solid #28a745; border-radius: 4px; padding: 15px; margin-bottom: 15px; background: #f8fff9;">
                    <h5 style="color: #28a745; margin: 0 0 10px 0;">✅ Correct Transcript Tests</h5>
            `;
            
            correctTranscriptTests.forEach(test => {
                const status = test.passed ? '✅ PASSED' : '❌ FAILED';
                const statusColor = test.passed ? '#28a745' : '#dc3545';
                
                html += `
                    <div style="background: white; border: 1px solid #e9ecef; border-radius: 4px; padding: 10px; margin: 5px 0;">
                        <strong>${test.elementName}</strong> (${test.elementSignificance}) - <span style="color: ${statusColor};">${status}</span><br>
                        ${test.issues.length > 0 ? `<strong>Issues:</strong> ${test.issues.join(', ')}<br>` : ''}
                        ${test.suggestedFixes.length > 0 ? `<strong>Suggested Fixes:</strong> ${test.suggestedFixes.join(', ')}<br>` : ''}
                        ${test.error ? `<strong>Error:</strong> ${test.error}` : ''}
                    </div>
                `;
            });
            
            html += '</div>';
        }
        
        // Display incorrect transcript tests
        if (incorrectTranscriptTests.length > 0) {
            html += `
                <div style="border: 1px solid #dc3545; border-radius: 4px; padding: 15px; margin-bottom: 15px; background: #fff8f8;">
                    <h5 style="color: #dc3545; margin: 0 0 10px 0;">❌ Incorrect Transcript Tests</h5>
            `;
            
            incorrectTranscriptTests.forEach(test => {
                const status = test.passed ? '✅ PASSED' : '❌ FAILED';
                const statusColor = test.passed ? '#28a745' : '#dc3545';
                
                html += `
                    <div style="background: white; border: 1px solid #e9ecef; border-radius: 4px; padding: 10px; margin: 5px 0;">
                        <strong>${test.elementName}</strong> (${test.elementSignificance}) - <span style="color: ${statusColor};">${status}</span><br>
                        ${test.issues.length > 0 ? `<strong>Issues:</strong> ${test.issues.join(', ')}<br>` : ''}
                        ${test.suggestedFixes.length > 0 ? `<strong>Suggested Fixes:</strong> ${test.suggestedFixes.join(', ')}<br>` : ''}
                        ${test.error ? `<strong>Error:</strong> ${test.error}` : ''}
                    </div>
                `;
            });
            
            html += '</div>';
        }
        
        resultsDiv.innerHTML = html;
        
        // Switch to test results tab
        const testTab = document.querySelector('.audit-tab[data-tab="tests"]');
        if (testTab) {
            testTab.click();
        }
    }
    
    // Create or update test results tab
    createTestResultsTab(testResults, correctTests, incorrectTests, totalTests, passRate) {
        // Check if tab already exists
        let testTab = document.querySelector('.audit-tab[data-tab="tests"]');
        let testTabContent = document.getElementById('tab-tests');
        
        // Create tab button if it doesn't exist
        if (!testTab) {
            const tabsContainer = document.querySelector('.audit-tabs');
            if (tabsContainer) {
                testTab = document.createElement('button');
                testTab.className = 'audit-tab';
                testTab.dataset.tab = 'tests';
                testTab.textContent = `Test Results (${passRate}%)`;
                tabsContainer.appendChild(testTab);
                
                // Set up click handler
                testTab.addEventListener('click', () => {
                    document.querySelectorAll('.audit-tab').forEach(t => t.classList.remove('active'));
                    document.querySelectorAll('.audit-tab-content').forEach(c => c.classList.remove('active'));
                    testTab.classList.add('active');
                    if (testTabContent) testTabContent.classList.add('active');
                });
            }
        } else {
            testTab.textContent = `Test Results (${passRate}%)`;
        }
        
        // Create or update tab content
        if (!testTabContent) {
            testTabContent = document.createElement('div');
            testTabContent.id = 'tab-tests';
            testTabContent.className = 'audit-tab-content';
            const resultsContainer = document.getElementById('auditResults');
            if (resultsContainer) {
                resultsContainer.appendChild(testTabContent);
            }
        }
        
        // Group tests by type
        const correctTranscriptTests = testResults.filter(t => t.testType === 'correct_transcript');
        const incorrectTranscriptTests = testResults.filter(t => t.testType === 'incorrect_transcript');
        
        let html = `
            <div class="summary-card">
                <h4 style="margin: 0 0 15px 0; color: #2c3e50;">📊 Test Results Summary</h4>
                <div class="summary-stats">
                    <div class="summary-stat">
                        <span class="summary-stat-value">${totalTests}</span>
                        <span class="summary-stat-label">Total Tests</span>
                    </div>
                    <div class="summary-stat">
                        <span class="summary-stat-value" style="color: #28a745;">${correctTests}</span>
                        <span class="summary-stat-label">Passed</span>
                    </div>
                    <div class="summary-stat">
                        <span class="summary-stat-value" style="color: #dc3545;">${incorrectTests}</span>
                        <span class="summary-stat-label">Failed</span>
                    </div>
                    <div class="summary-stat">
                        <span class="summary-stat-value" style="color: ${passRate >= 80 ? '#28a745' : passRate >= 60 ? '#ffc107' : '#dc3545'};">${passRate}%</span>
                        <span class="summary-stat-label">Pass Rate</span>
                    </div>
                </div>
            </div>
        `;
        
        // Display correct transcript tests
        if (correctTranscriptTests.length > 0) {
            html += `
                <div class="summary-card" style="border-left: 4px solid #28a745;">
                    <h4 style="color: #28a745; margin: 0 0 15px 0;">✅ Correct Transcript Tests</h4>
            `;
            
            correctTranscriptTests.forEach(test => {
                const status = test.passed ? '✅ PASSED' : '❌ FAILED';
                const statusColor = test.passed ? '#28a745' : '#dc3545';
                
                html += `
                    <div class="element-item" style="cursor: default;" onclick="this.classList.toggle('expanded')">
                        <div class="element-header">
                            <div>
                                <span class="element-title">${this.escapeHtml(test.elementName)}</span>
                                <span class="element-badge ${test.elementSignificance}" style="margin-left: 10px;">${test.elementSignificance}</span>
                                <span style="margin-left: 10px; color: ${statusColor}; font-weight: 600;">${status}</span>
                            </div>
                            <span style="font-size: 12px; color: #6c757d;">▼</span>
                        </div>
                        <div class="element-details">
                            ${test.issues.length > 0 ? `<div style="margin-top: 10px;"><strong>Issues:</strong> ${this.escapeHtml(test.issues.join(', '))}</div>` : ''}
                            ${test.suggestedFixes.length > 0 ? `<div style="margin-top: 10px;"><strong>Suggested Fixes:</strong> ${this.escapeHtml(test.suggestedFixes.join(', '))}</div>` : ''}
                            ${test.error ? `<div style="margin-top: 10px; color: #dc3545;"><strong>Error:</strong> ${this.escapeHtml(test.error)}</div>` : ''}
                        </div>
                    </div>
                `;
            });
            
            html += '</div>';
        }
        
        // Display incorrect transcript tests
        if (incorrectTranscriptTests.length > 0) {
            html += `
                <div class="summary-card" style="border-left: 4px solid #dc3545;">
                    <h4 style="color: #dc3545; margin: 0 0 15px 0;">❌ Incorrect Transcript Tests</h4>
            `;
            
            incorrectTranscriptTests.forEach(test => {
                const status = test.passed ? '✅ PASSED' : '❌ FAILED';
                const statusColor = test.passed ? '#28a745' : '#dc3545';
                
                html += `
                    <div class="element-item" style="cursor: default;" onclick="this.classList.toggle('expanded')">
                        <div class="element-header">
                            <div>
                                <span class="element-title">${this.escapeHtml(test.elementName)}</span>
                                <span class="element-badge ${test.elementSignificance}" style="margin-left: 10px;">${test.elementSignificance}</span>
                                <span style="margin-left: 10px; color: ${statusColor}; font-weight: 600;">${status}</span>
                            </div>
                            <span style="font-size: 12px; color: #6c757d;">▼</span>
                        </div>
                        <div class="element-details">
                            ${test.issues.length > 0 ? `<div style="margin-top: 10px;"><strong>Issues:</strong> ${this.escapeHtml(test.issues.join(', '))}</div>` : ''}
                            ${test.suggestedFixes.length > 0 ? `<div style="margin-top: 10px;"><strong>Suggested Fixes:</strong> ${this.escapeHtml(test.suggestedFixes.join(', '))}</div>` : ''}
                            ${test.error ? `<div style="margin-top: 10px; color: #dc3545;"><strong>Error:</strong> ${this.escapeHtml(test.error)}</div>` : ''}
                        </div>
                    </div>
                `;
            });
            
            html += '</div>';
        }
        
        testTabContent.innerHTML = html;
    }

    // Show audit success
    showAuditSuccess(message) {
        const resultsDiv = document.getElementById('auditResults');
        if (!resultsDiv) return;

        // Prepend success message without replacing existing DOM (preserves event listeners)
        resultsDiv.insertAdjacentHTML('afterbegin', `<div class="audit-success">${message}</div>`);

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
    
    // Calculate how many elements will be audited based on scope
    calculateWillAuditCount(auditableElements, scope) {
        if (!auditableElements || auditableElements.length === 0) {
            return 0;
        }
        
        switch (scope) {
            case 'most_significant':
                return auditableElements.filter(el => el.significance === 'high').slice(0, 1).length;
            case 'high_significance':
                return auditableElements.filter(el => el.significance === 'high').length;
            case 'high_medium':
                return auditableElements.filter(el => 
                    el.significance === 'high' || el.significance === 'medium'
                ).length;
            case 'all_elements':
                return auditableElements.length;
            default:
                return auditableElements.filter(el => el.significance === 'high').slice(0, 1).length;
        }
    }
    
    // Update the "will be audited" count display
    updateWillAuditCount(auditableElements) {
        const willAuditCountEl = document.getElementById('willAuditCount');
        const willAuditElementsEl = document.getElementById('willAuditElements');
        
        if (!willAuditCountEl || !willAuditElementsEl || !auditableElements || auditableElements.length === 0) {
            if (willAuditElementsEl) {
                willAuditElementsEl.style.display = 'none';
            }
            return;
        }
        
        const scope = document.querySelector('input[name="auditScope"]:checked')?.value || 'most_significant';
        const willAuditCount = this.calculateWillAuditCount(auditableElements, scope);
        
        willAuditCountEl.textContent = willAuditCount;
        willAuditElementsEl.style.display = 'inline';
    }
    
    // Setup listeners for scope changes
    setupScopeChangeListeners(auditableElements) {
        const scopeInputs = document.querySelectorAll('input[name="auditScope"]');
        scopeInputs.forEach(input => {
            // Remove existing listeners to avoid duplicates by cloning
            const parent = input.parentNode;
            const newInput = input.cloneNode(true);
            parent.replaceChild(newInput, input);
            
            // Add new listener
            newInput.addEventListener('change', () => {
                this.updateWillAuditCount(auditableElements);
            });
        });
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
    async getAuthToken(forceRefresh = false) {
        try {
            const user = getCurrentUser();
            if (user) {
                // Force token refresh if requested (useful after long operations)
                return await user.getIdToken(forceRefresh);
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
        
        // Ensure we use the latest elements from the stored full data
        const auditableElements = (this.selectedGuidelineFullData && this.selectedGuidelineFullData.auditableElements)
            ? this.selectedGuidelineFullData.auditableElements
            : [];
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
                    <h4 style="margin: 0 0 10px 0; color: #2c3e50;">Element ${index + 1}: ${element.name || 'Unnamed Element'}</h4>
                    <div style="margin-bottom: 10px;">
                        <strong>Type:</strong> ${element.type || 'Unknown'}<br>
                        <strong>Significance:</strong> ${element.significance || 'Unknown'}<br>
                        <strong>Input Variables:</strong> ${element.inputVariables ? element.inputVariables.join(', ') : 'None'}<br>
                        <strong>Derived Advice:</strong> ${element.derivedAdvice || 'Not specified'}
                    </div>
                    <div style="font-family: 'Courier New', monospace; font-size: 14px; color: #495057; 
                                background: white; padding: 10px; border-radius: 4px; border: 1px solid #e9ecef; 
                                white-space: pre-wrap; word-wrap: break-word;">
                        ${element.element || 'No element content available'}
                    </div>
                </div>
            `;
        });
        
        resultsDiv.innerHTML = elementsHtml;
        resultsDiv.classList.remove('empty');
    }
} 