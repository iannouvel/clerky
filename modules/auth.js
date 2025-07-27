// Authentication module
import { auth } from './firebase-core.js';

// Check disclaimer acceptance
export async function checkDisclaimerAcceptance() {
    const user = auth.currentUser;
    if (!user) {
        console.log('[DEBUG] No user authenticated, skipping disclaimer check');
        return true; // Allow access if no user (will be handled by auth flow)
    }

    try {
        console.log('[DEBUG] Checking disclaimer acceptance for user:', user.uid);
        const disclaimerRef = doc(db, 'disclaimerAcceptance', user.uid);
        const disclaimerDoc = await getDoc(disclaimerRef);
        
        if (!disclaimerDoc.exists()) {
            console.log('[DEBUG] No disclaimer acceptance found, redirecting to disclaimer page');
            window.location.href = 'disclaimer.html';
            return false;
        }

        // Check if disclaimer was accepted today
        const acceptanceData = disclaimerDoc.data();
        const acceptanceTime = acceptanceData.acceptanceTime.toDate();
        const today = new Date();
        const isToday = acceptanceTime.toDateString() === today.toDateString();
        
        if (!isToday) {
            console.log('[DEBUG] Disclaimer not accepted today, redirecting to disclaimer page');
            window.location.href = 'disclaimer.html';
            return false;
        }

        console.log('[DEBUG] Disclaimer accepted today, allowing access');
        return true;
    } catch (error) {
        console.error('[ERROR] Error checking disclaimer acceptance:', error);
        // On error, redirect to disclaimer page to be safe
        window.location.href = 'disclaimer.html';
        return false;
    }
}

// Initialize authentication
export async function initializeAuth() {
    return new Promise((resolve) => {
        const unsubscribe = auth.onAuthStateChanged((user) => {
            unsubscribe();
            resolve(user);
        });
    });
}

// Get current user
export function getCurrentUser() {
    return auth.currentUser;
}

// Check if user is authenticated
export function isAuthenticated() {
    return auth.currentUser !== null;
} 