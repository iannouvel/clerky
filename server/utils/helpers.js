const { ORGANIZATION_DOMAINS, AI_PROVIDER_PREFERENCE } = require('../config/constants');

// Validate URL matches expected domain for organization
function validateGuidelineUrl(url, organization) {
    if (!url || !organization) return false;

    const expectedDomains = ORGANIZATION_DOMAINS[organization];
    if (!expectedDomains) return false;

    try {
        const urlObj = new URL(url);
        const hostname = urlObj.hostname.toLowerCase();

        return expectedDomains.some(domain =>
            hostname === domain || hostname.endsWith('.' + domain)
        );
    } catch (e) {
        return false;
    }
}

// Helper function to get next available provider in cost order
function getNextAvailableProvider(currentProvider, availableKeys) {
    const currentIndex = AI_PROVIDER_PREFERENCE.findIndex(p => p.name === currentProvider);
    if (currentIndex === -1) return AI_PROVIDER_PREFERENCE[0]; // Default to cheapest

    // Start from the next provider after current
    for (let i = currentIndex + 1; i < AI_PROVIDER_PREFERENCE.length; i++) {
        const provider = AI_PROVIDER_PREFERENCE[i];
        if (availableKeys[`has${provider.name}Key`]) {
            return provider;
        }
    }

    // If no next provider available, try from the beginning
    for (let i = 0; i < currentIndex; i++) {
        const provider = AI_PROVIDER_PREFERENCE[i];
        if (availableKeys[`has${provider.name}Key`]) {
            return provider;
        }
    }

    return null; // No available providers
}

module.exports = {
    validateGuidelineUrl,
    getNextAvailableProvider
};
