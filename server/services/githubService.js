const axios = require('axios');
const GITHUB_CONFIG = require('../config/github');

// Mutable token state (initially from config)
let githubToken = GITHUB_CONFIG.token;

// Debug logging helper (simplified for service)
const debugLog = (...args) => {
    if (process.env.DEBUG_LOGGING === 'true') console.log(...args);
};

function validateGitHubToken() {
    debugLog('[DEBUG] validateGitHubToken: Starting GitHub token validation...');

    if (!githubToken) {
        console.error('[ERROR] validateGitHubToken: GITHUB_TOKEN is not set!');
        process.exit(1);
    }

    // Clean the token
    let cleanToken = githubToken.trim().replace(/\n/g, '');

    // Remove Bearer prefix if it exists
    if (cleanToken.startsWith('Bearer ')) {
        cleanToken = cleanToken.substring(7);
    }

    // Update the module-level token
    githubToken = cleanToken;
    debugLog('[DEBUG] validateGitHubToken: Token validation complete');
}

// Call validation on module load (or we could export it and call it explicitly)
validateGitHubToken();

async function getFileSha(filePath) {
    try {
        const url = `https://api.github.com/repos/${GITHUB_CONFIG.owner}/${GITHUB_CONFIG.repo}/contents/${filePath}?ref=${GITHUB_CONFIG.branch}`;
        const headers = {
            'Accept': 'application/vnd.github.v3+json',
            'Authorization': `token ${githubToken}`
        };
        const response = await axios.get(url, { headers });
        return response.data.sha;
    } catch (error) {
        if (error.response?.status === 404) {
            // Expected case - file doesn't exist yet, this is not an error
            return null;
        }
        console.error('Error fetching file SHA:', {
            status: error.response?.status,
            message: error.response?.data?.message
        });
        throw new Error(`Failed to fetch file SHA: ${error.response?.data?.message || error.message}`);
    }
}

async function updateHtmlFileOnGitHub(filePath, newHtmlContent, fileSha) {
    const url = `https://api.github.com/repos/${GITHUB_CONFIG.owner}/${GITHUB_CONFIG.repo}/contents/${filePath}`;

    const body = {
        message: `Update ${filePath} with new content`,
        content: Buffer.from(newHtmlContent).toString('base64'),
        branch: GITHUB_CONFIG.branch
    };

    if (fileSha) {
        body.sha = fileSha;
    }

    try {
        const response = await axios.put(url, body, {
            headers: {
                'Accept': 'application/vnd.github.v3+json',
                'Authorization': `token ${githubToken}`
            }
        });
        return {
            commit: response.data.commit,
            content: response.data.content
        };
    } catch (error) {
        const status = error.response?.status;
        const errorMessage = error.response?.data?.message || error.message;
        const documentationUrl = error.response?.data?.documentation_url;

        console.error('GitHub API Error:', {
            status,
            statusText: error.response?.statusText,
            message: errorMessage,
            documentation_url: documentationUrl
        });

        if (status === 404) {
            throw new Error('Resource not found. Please check the file path and repository details.');
        } else if (status === 409) {
            throw new Error('Conflict detected. Please ensure no concurrent modifications are being made.');
        } else if (status === 422) {
            throw new Error('Validation failed. Please check the request parameters and data.');
        } else {
            throw new Error(`Failed to update file: ${errorMessage}`);
        }
    }
}

module.exports = {
    validateGitHubToken,
    getFileSha,
    updateHtmlFileOnGitHub
};
