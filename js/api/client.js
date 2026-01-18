import { SERVER_URL } from './config.js';
import { auth } from '../../firebase-init.js';

/**
 * Helper to get the current user's ID token.
 * Throws error if user is not authenticated.
 */
async function getIdToken() {
    const user = auth.currentUser;
    if (!user) {
        throw new Error('User not authenticated');
    }
    return await user.getIdToken();
}

/**
 * Make an authenticated POST request.
 * @param {string} endpoint - The API endpoint (e.g., '/askGuidelinesQuestion')
 * @param {object} data - The JSON payload
 * @param {AbortSignal} [signal] - Optional abort signal
 * @returns {Promise<any>} - The parsed JSON response
 */
export async function postAuthenticated(endpoint, data, signal = null) {
    const token = await getIdToken();
    const url = `${SERVER_URL}${endpoint}`;

    const options = {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(data)
    };

    if (signal) {
        options.signal = signal;
    }

    const response = await fetch(url, options);

    if (!response.ok) {
        let errorText = await response.text();
        // Try to parse JSON error if possible
        try {
            const jsonError = JSON.parse(errorText);
            if (jsonError.error) errorText = jsonError.error;
        } catch (e) {
            // ignore
        }
        throw new Error(`Server error: ${response.status} - ${errorText}`);
    }

    const responseData = await response.json();
    return responseData;
}

/**
 * Make an unauthenticated GET request.
 * @param {string} endpoint 
 * @returns {Promise<any>}
 */
export async function get(endpoint) {
    const url = `${SERVER_URL}${endpoint}`;
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Server error: ${response.status}`);
    }
    return await response.json();
}
