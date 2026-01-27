/**
 * Disclaimer Acceptance
 * Handles checking if the user has accepted the daily disclaimer
 */

import { doc, getDoc } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

/**
 * Check if user has accepted the disclaimer today
 * @param {Object} auth - Firebase auth instance
 * @param {Object} db - Firestore database instance
 * @returns {Promise<boolean>} Whether the user should be allowed access
 */
export async function checkDisclaimerAcceptance(auth, db) {
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

        console.log('[DEBUG] Disclaimer acceptance check:', {
            acceptanceTime: acceptanceTime.toDateString(),
            today: today.toDateString(),
            isToday: isToday
        });

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
