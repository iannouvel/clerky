// Shared version loader for all HTML pages
// This script loads the version number from package.json and displays it

async function loadAndDisplayVersion() {
    try {
        const response = await fetch('./package.json?v=' + Date.now());
        const packageData = await response.json();
        const versionElement = document.getElementById('appVersion');
        if (versionElement && packageData.version) {
            versionElement.textContent = packageData.version;
            console.log('[VERSION] App version loaded:', packageData.version);
        }
    } catch (error) {
        console.warn('[VERSION] Failed to load version:', error);
        // Fail silently - version number is not critical for app functionality
    }
}

// Call loadAndDisplayVersion when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadAndDisplayVersion);
} else {
    loadAndDisplayVersion();
}






