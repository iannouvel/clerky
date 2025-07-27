// Guidelines module - handles guideline loading and management
import { auth } from './firebase-core.js';

// Global variable to store relevant guidelines
let relevantGuidelines = null;

// Cache management
let guidelinesCache = null;
let guidelinesCacheTimestamp = null;
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

// Load guidelines from Firestore with caching
export async function loadGuidelinesFromFirestore() {
    // Check cache first
    if (guidelinesCache && guidelinesCacheTimestamp && 
        (Date.now() - guidelinesCacheTimestamp) < CACHE_DURATION) {
        console.log('[DEBUG] Returning cached guidelines:', guidelinesCache.length);
        return guidelinesCache;
    }

    try {
        console.log('[DEBUG] Loading guidelines from Firestore...');
        
        // Get user ID token
        const user = auth.currentUser;
        if (!user) {
            throw new Error('User not authenticated');
        }
        const idToken = await user.getIdToken();

        // Fetch guidelines from server
        const serverUrl = window.SERVER_URL || 'https://clerky-uzni.onrender.com';
        const response = await fetch(`${serverUrl}/getAllGuidelines`, {
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
        console.log('[DEBUG] Loaded guidelines from Firestore:', guidelines.length);

        // Update cache
        guidelinesCache = guidelines;
        guidelinesCacheTimestamp = Date.now();

        return guidelines;
    } catch (error) {
        console.error('[ERROR] Failed to load guidelines:', error);
        throw error;
    }
}

// Get cached guidelines
export function getCachedGuidelines() {
    return guidelinesCache;
}

// Clear guidelines cache
export function clearGuidelinesCache() {
    guidelinesCache = null;
    guidelinesCacheTimestamp = null;
    console.log('[DEBUG] Guidelines cache cleared');
}

// Get cache info
export function getCacheInfo() {
    if (!guidelinesCache) {
        return { cached: false, count: 0, age: null };
    }
    
    const age = guidelinesCacheTimestamp ? Date.now() - guidelinesCacheTimestamp : null;
    return {
        cached: true,
        count: guidelinesCache.length,
        age: age,
        ageMinutes: age ? Math.round(age / 60000) : null
    };
} 