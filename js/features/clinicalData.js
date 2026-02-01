/**
 * Clinical Data Management
 * Handles loading and storing clinical issues data from Firebase with caching and fallbacks
 */

import { auth } from '../../firebase-init.js';
import { SERVER_URL } from '../api/config.js';

// Global cache for clinical conditions
let clinicalConditionsCache = null;
let loadPromise = null;

export const ClinicalConditionsService = {
    // Load clinical conditions from server on startup
    async loadConditions() {
        if (loadPromise) {
            return loadPromise;
        }

        loadPromise = this._fetchConditionsFromServer();
        return loadPromise;
    },

    // Get all conditions (synchronous, returns cached)
    getConditions() {
        return clinicalConditionsCache;
    },

    // Get summary statistics
    getSummary() {
        if (!clinicalConditionsCache) return null;

        const summary = {
            totalCategories: Object.keys(clinicalConditionsCache).length,
            totalConditions: 0,
            conditionsWithTranscripts: 0,
            categoriesWithCounts: {}
        };

        for (const [category, conditions] of Object.entries(clinicalConditionsCache)) {
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
    },

    // Find a specific condition by name
    findCondition(conditionName) {
        if (!clinicalConditionsCache) return null;

        for (const [category, conditions] of Object.entries(clinicalConditionsCache)) {
            if (conditions[conditionName]) {
                return conditions[conditionName];
            }
        }
        return null;
    },

    // Find condition by ID
    findConditionById(conditionId) {
        if (!clinicalConditionsCache) return null;

        for (const [category, conditions] of Object.entries(clinicalConditionsCache)) {
            for (const [name, condition] of Object.entries(conditions)) {
                if (condition.id === conditionId) {
                    return condition;
                }
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

            const response = await fetch(`${SERVER_URL}/generateTranscript/${conditionId}`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${idToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ forceRegenerate })
            });

            console.log('[CLINICAL-SERVICE] Server response status:', response.status, response.statusText);

            if (!response.ok) {
                const errorText = await response.text();
                console.error('[CLINICAL-SERVICE] Server error response:', errorText);
                throw new Error(`Failed to generate transcript: ${response.status} - ${errorText}`);
            }

            const data = await response.json();

            if (!data.success) {
                throw new Error(data.error || 'Failed to generate transcript');
            }

            if (!data.transcript) {
                throw new Error('No transcript received from server');
            }

            // Update cache if transcript was generated/retrieved
            if (data.transcript && clinicalConditionsCache) {
                const condition = this.findConditionById(conditionId);
                if (condition) {
                    // Update the condition in cache references
                    condition.transcript = data.transcript;
                    condition.hasTranscript = true;
                    condition.lastGenerated = data.generated || data.lastGenerated;
                }
            }

            return data;

        } catch (error) {
            console.error('[CLINICAL-SERVICE] Error generating transcript:', error);
            throw error;
        }
    },

    // Update transcript for a specific condition
    async updateTranscript(conditionId, newTranscript) {
        try {
            console.log('[CLINICAL-SERVICE] Updating transcript for condition:', conditionId);

            const user = auth.currentUser;
            if (!user) {
                throw new Error('User not authenticated');
            }

            const idToken = await user.getIdToken();

            const response = await fetch(`${SERVER_URL}/updateTranscript/${conditionId}`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${idToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ transcript: newTranscript })
            });

            console.log('[CLINICAL-SERVICE] Server response status:', response.status, response.statusText);

            if (!response.ok) {
                const errorText = await response.text();
                console.error('[CLINICAL-SERVICE] Server error response:', errorText);
                throw new Error(`Failed to update transcript: ${response.status} - ${errorText}`);
            }

            const data = await response.json();

            if (!data.success) {
                throw new Error(data.error || 'Failed to update transcript');
            }

            // Update cache
            if (clinicalConditionsCache) {
                const condition = this.findConditionById(conditionId);
                if (condition) {
                    condition.transcript = newTranscript;
                    condition.hasTranscript = true;
                    condition.lastModified = new Date().toISOString();
                }
            }

            return data;

        } catch (error) {
            console.error('[CLINICAL-SERVICE] Error updating transcript:', error);
            throw error;
        }
    },

    // Internal methods
    _normalizeCategories(conditions) {
        // If there's both 'gynecology' and 'gynaecology', merge into 'gynaecology'
        if (conditions.gynecology && conditions.gynaecology) {
            console.log('[CLINICAL-SERVICE] Merging gynecology into gynaecology');
            conditions.gynaecology = { ...conditions.gynaecology, ...conditions.gynecology };
            delete conditions.gynecology;
        } else if (conditions.gynecology && !conditions.gynaecology) {
            console.log('[CLINICAL-SERVICE] Renaming gynecology to gynaecology');
            conditions.gynaecology = conditions.gynecology;
            delete conditions.gynecology;
        }
        return conditions;
    },

    async _fetchConditionsFromServer() {
        try {
            // Try to get from IndexedDB cache first
            if (window.cacheManager) {
                const cachedConditions = await window.cacheManager.getClinicalConditions();
                if (cachedConditions) {
                    console.log('[CLINICAL-SERVICE] ⚡ Loaded clinical conditions from IndexedDB cache');
                    const normalized = this._normalizeCategories(cachedConditions);
                    clinicalConditionsCache = normalized;
                    return normalized;
                }
            }

            console.log('[CLINICAL-SERVICE] Loading clinical conditions from Firebase...');

            const user = auth.currentUser;
            if (!user) throw new Error('User not authenticated');

            const idToken = await user.getIdToken();

            const response = await fetch(`${SERVER_URL}/clinicalConditions`, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${idToken}`,
                    'Content-Type': 'application/json'
                }
            });

            if (!response.ok) throw new Error(`Failed to load: ${response.status}`);

            const data = await response.json();

            if (!data.success) throw new Error(data.error || 'Failed to load clinical conditions');

            // Check if Firebase collection is empty
            const totalConditions = data.summary?.totalConditions || 0;
            if (totalConditions === 0) {
                console.log('[CLINICAL-SERVICE] Firebase collection is empty, initializing...');
                await this._initializeFirebaseCollection();

                // Retry loading... (simplified logic compared to removed code, assume init works or fallback)
                // Realistically we should retry fetch here, but for brevity sticking to the core path
                // or returning fallback immediately if this is a first-run edge case.

                // Re-fetch logic
                const retryResp = await fetch(`${SERVER_URL}/clinicalConditions`, {
                    method: 'GET',
                    headers: { 'Authorization': `Bearer ${idToken}`, 'Content-Type': 'application/json' }
                });
                if (retryResp.ok) {
                    const retryData = await retryResp.json();
                    if (retryData.success && retryData.summary?.totalConditions > 0) {
                        const normalized = this._normalizeCategories(retryData.conditions);
                        clinicalConditionsCache = normalized;
                        this._saveToCache(normalized);
                        return normalized;
                    }
                }

                return this._loadFromJsonFallback();
            }

            const normalizedConditions = this._normalizeCategories(data.conditions);
            clinicalConditionsCache = normalizedConditions;
            this._saveToCache(normalizedConditions);

            return clinicalConditionsCache;

        } catch (error) {
            console.error('[CLINICAL-SERVICE] Error loading clinical conditions:', error);
            // Fallback to JSON file if Firebase fails
            return this._loadFromJsonFallback();
        }
    },

    _saveToCache(data) {
        if (window.cacheManager) {
            window.cacheManager.saveClinicalConditions(data).catch(err => {
                console.warn('[CLINICAL-SERVICE] Failed to cache conditions:', err);
            });
        }
    },

    async _initializeFirebaseCollection() {
        try {
            console.log('[CLINICAL-SERVICE] Initializing Firebase collection...');
            const idToken = await auth.currentUser.getIdToken();
            const response = await fetch(`${SERVER_URL}/initializeClinicalConditions`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${idToken}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({})
            });
            if (!response.ok) throw new Error(`Init failed: ${response.status}`);
        } catch (error) {
            console.error('[CLINICAL-SERVICE] Error initializing:', error);
            throw error;
        }
    },

    async _loadFromJsonFallback() {
        console.log('[CLINICAL-SERVICE] Falling back to JSON file...');
        try {
            const response = await fetch('./clinical_issues.json');
            if (!response.ok) throw new Error(`Failed to load JSON: ${response.status}`);

            const rawData = await response.json();
            const conditions = {};

            for (const [category, issues] of Object.entries(rawData)) {
                conditions[category] = {};
                issues.forEach(issue => {
                    conditions[category][issue] = {
                        id: `${category}-${issue.toLowerCase().replace(/[^a-z0-9]/g, '-')}`,
                        name: issue,
                        category: category,
                        transcript: null,
                        hasTranscript: false,
                        metadata: { source: 'json-fallback' }
                    };
                });
            }

            clinicalConditionsCache = conditions;
            return conditions;
        } catch (error) {
            console.error('[CLINICAL-SERVICE] Error loading JSON fallback:', error);
            throw error;
        }
    }
};

// Aliases for compatibility
export const loadClinicalIssues = ClinicalConditionsService.loadConditions.bind(ClinicalConditionsService);
export const clinicalIssues = clinicalConditionsCache; // Note: this export reference might not update, so getters are preferred
