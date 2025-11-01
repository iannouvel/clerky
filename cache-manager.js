// IndexedDB Cache Manager for Clerky
// Provides fast local caching for guidelines and clinical conditions

class CacheManager {
    constructor() {
        this.dbName = 'ClerkyCache';
        this.version = 1;
        this.db = null;
        this.initPromise = null;
    }

    // Initialize IndexedDB
    async init() {
        if (this.initPromise) {
            return this.initPromise;
        }

        this.initPromise = new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, this.version);

            request.onerror = () => {
                console.error('[CACHE] IndexedDB initialization failed:', request.error);
                reject(request.error);
            };

            request.onsuccess = () => {
                this.db = request.result;
                console.log('[CACHE] IndexedDB initialized successfully');
                resolve(this.db);
            };

            request.onupgradeneeded = (event) => {
                const db = event.target.result;

                // Create object stores if they don't exist
                if (!db.objectStoreNames.contains('guidelines')) {
                    const guidelinesStore = db.createObjectStore('guidelines', { keyPath: 'id' });
                    guidelinesStore.createIndex('timestamp', 'timestamp', { unique: false });
                    console.log('[CACHE] Created guidelines object store');
                }

                if (!db.objectStoreNames.contains('clinicalConditions')) {
                    const conditionsStore = db.createObjectStore('clinicalConditions', { keyPath: 'id' });
                    conditionsStore.createIndex('timestamp', 'timestamp', { unique: false });
                    console.log('[CACHE] Created clinicalConditions object store');
                }

                if (!db.objectStoreNames.contains('metadata')) {
                    db.createObjectStore('metadata', { keyPath: 'key' });
                    console.log('[CACHE] Created metadata object store');
                }
            };
        });

        return this.initPromise;
    }

    // Get cached guidelines
    async getGuidelines() {
        try {
            await this.init();

            return new Promise((resolve, reject) => {
                const transaction = this.db.transaction(['guidelines', 'metadata'], 'readonly');
                const guidelinesStore = transaction.objectStore('guidelines');
                const metadataStore = transaction.objectStore('metadata');

                // Get metadata to check freshness
                const metadataRequest = metadataStore.get('guidelines');

                metadataRequest.onsuccess = () => {
                    const metadata = metadataRequest.result;
                    
                    // Check if cache is valid (less than 1 hour old)
                    const now = Date.now();
                    const cacheMaxAge = 60 * 60 * 1000; // 1 hour

                    if (!metadata || (now - metadata.timestamp) > cacheMaxAge) {
                        console.log('[CACHE] Guidelines cache expired or missing');
                        resolve(null);
                        return;
                    }

                    // Get all guidelines
                    const getAllRequest = guidelinesStore.getAll();

                    getAllRequest.onsuccess = () => {
                        const guidelines = getAllRequest.result;
                        console.log('[CACHE] Retrieved guidelines from cache:', guidelines.length);
                        resolve(guidelines);
                    };

                    getAllRequest.onerror = () => {
                        console.error('[CACHE] Error retrieving guidelines:', getAllRequest.error);
                        resolve(null);
                    };
                };

                metadataRequest.onerror = () => {
                    console.error('[CACHE] Error retrieving metadata:', metadataRequest.error);
                    resolve(null);
                };
            });
        } catch (error) {
            console.error('[CACHE] Error in getGuidelines:', error);
            return null;
        }
    }

    // Save guidelines to cache
    async saveGuidelines(guidelines) {
        try {
            await this.init();

            return new Promise((resolve, reject) => {
                const transaction = this.db.transaction(['guidelines', 'metadata'], 'readwrite');
                const guidelinesStore = transaction.objectStore('guidelines');
                const metadataStore = transaction.objectStore('metadata');

                // Clear existing guidelines
                const clearRequest = guidelinesStore.clear();

                clearRequest.onsuccess = () => {
                    // Add all guidelines
                    let addedCount = 0;
                    const timestamp = Date.now();

                    guidelines.forEach(guideline => {
                        const guidelineWithTimestamp = { ...guideline, timestamp };
                        guidelinesStore.add(guidelineWithTimestamp);
                    });

                    // Update metadata
                    metadataStore.put({
                        key: 'guidelines',
                        timestamp: timestamp,
                        count: guidelines.length
                    });

                    console.log('[CACHE] Saved guidelines to cache:', guidelines.length);
                };

                transaction.oncomplete = () => {
                    resolve(true);
                };

                transaction.onerror = () => {
                    console.error('[CACHE] Error saving guidelines:', transaction.error);
                    reject(transaction.error);
                };
            });
        } catch (error) {
            console.error('[CACHE] Error in saveGuidelines:', error);
            return false;
        }
    }

    // Get cached clinical conditions
    async getClinicalConditions() {
        try {
            await this.init();

            return new Promise((resolve, reject) => {
                const transaction = this.db.transaction(['clinicalConditions', 'metadata'], 'readonly');
                const conditionsStore = transaction.objectStore('clinicalConditions');
                const metadataStore = transaction.objectStore('metadata');

                // Get metadata to check freshness
                const metadataRequest = metadataStore.get('clinicalConditions');

                metadataRequest.onsuccess = () => {
                    const metadata = metadataRequest.result;
                    
                    // Check if cache is valid (less than 1 hour old)
                    const now = Date.now();
                    const cacheMaxAge = 60 * 60 * 1000; // 1 hour

                    if (!metadata || (now - metadata.timestamp) > cacheMaxAge) {
                        console.log('[CACHE] Clinical conditions cache expired or missing');
                        resolve(null);
                        return;
                    }

                    // Get all conditions
                    const getAllRequest = conditionsStore.getAll();

                    getAllRequest.onsuccess = () => {
                        const conditions = getAllRequest.result;
                        if (conditions.length > 0) {
                            console.log('[CACHE] Retrieved clinical conditions from cache');
                            // Return the stored conditions object
                            resolve(conditions[0].data);
                        } else {
                            resolve(null);
                        }
                    };

                    getAllRequest.onerror = () => {
                        console.error('[CACHE] Error retrieving clinical conditions:', getAllRequest.error);
                        resolve(null);
                    };
                };

                metadataRequest.onerror = () => {
                    console.error('[CACHE] Error retrieving metadata:', metadataRequest.error);
                    resolve(null);
                };
            });
        } catch (error) {
            console.error('[CACHE] Error in getClinicalConditions:', error);
            return null;
        }
    }

    // Save clinical conditions to cache
    async saveClinicalConditions(conditions) {
        try {
            await this.init();

            return new Promise((resolve, reject) => {
                const transaction = this.db.transaction(['clinicalConditions', 'metadata'], 'readwrite');
                const conditionsStore = transaction.objectStore('clinicalConditions');
                const metadataStore = transaction.objectStore('metadata');

                // Clear existing conditions
                const clearRequest = conditionsStore.clear();

                clearRequest.onsuccess = () => {
                    const timestamp = Date.now();

                    // Store conditions as a single object
                    conditionsStore.add({
                        id: 'main',
                        data: conditions,
                        timestamp: timestamp
                    });

                    // Update metadata
                    metadataStore.put({
                        key: 'clinicalConditions',
                        timestamp: timestamp
                    });

                    console.log('[CACHE] Saved clinical conditions to cache');
                };

                transaction.oncomplete = () => {
                    resolve(true);
                };

                transaction.onerror = () => {
                    console.error('[CACHE] Error saving clinical conditions:', transaction.error);
                    reject(transaction.error);
                };
            });
        } catch (error) {
            console.error('[CACHE] Error in saveClinicalConditions:', error);
            return false;
        }
    }

    // Clear all caches
    async clearAll() {
        try {
            await this.init();

            return new Promise((resolve, reject) => {
                const transaction = this.db.transaction(['guidelines', 'clinicalConditions', 'metadata'], 'readwrite');

                transaction.objectStore('guidelines').clear();
                transaction.objectStore('clinicalConditions').clear();
                transaction.objectStore('metadata').clear();

                transaction.oncomplete = () => {
                    console.log('[CACHE] All caches cleared');
                    resolve(true);
                };

                transaction.onerror = () => {
                    console.error('[CACHE] Error clearing caches:', transaction.error);
                    reject(transaction.error);
                };
            });
        } catch (error) {
            console.error('[CACHE] Error in clearAll:', error);
            return false;
        }
    }
}

// Create singleton instance
const cacheManager = new CacheManager();

// Initialize cache manager on load
cacheManager.init().catch(error => {
    console.error('[CACHE] Failed to initialize cache manager:', error);
});

// Expose globally
window.cacheManager = cacheManager;

// Add utility functions to window for debugging
window.clearClerkyCache = () => {
    return cacheManager.clearAll().then(() => {
        console.log('[CACHE] Cache cleared successfully. Reload the page to fetch fresh data.');
        return true;
    });
};

window.getCacheStatus = async () => {
    try {
        const guidelines = await cacheManager.getGuidelines();
        const conditions = await cacheManager.getClinicalConditions();
        
        const status = {
            guidelines: {
                cached: !!guidelines,
                count: guidelines ? guidelines.length : 0
            },
            clinicalConditions: {
                cached: !!conditions
            }
        };
        
        console.log('[CACHE] Cache status:', status);
        return status;
    } catch (error) {
        console.error('[CACHE] Error checking cache status:', error);
        return null;
    }
};

console.log('[CACHE] IndexedDB cache manager loaded. Available commands:');
console.log('  - window.clearClerkyCache() - Clear all cached data');
console.log('  - window.getCacheStatus() - Check what\'s in the cache');

export default cacheManager;

