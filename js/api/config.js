const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

// Base URL for API requests
export const SERVER_URL = isLocalhost ? 'http://localhost:3000' : 'https://clerky-uzni.onrender.com';

export const API_ENDPOINTS = {
    HEALTH: '/health',
    VERSION: '/api/version',
    ASK_GUIDELINES: '/askGuidelinesQuestion',
    SCORE_COMPLIANCE: '/scoreCompliance',
    UPLOAD_GUIDELINE: '/uploadGuideline' // from firebase-init.js
};
