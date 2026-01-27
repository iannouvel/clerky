/**
 * Version Display
 * Loads and displays the application version from package.json
 */

/**
 * Load and display version number from package.json
 */
export async function loadVersionNumber() {
    try {
        const response = await fetch('./package.json?v=' + Date.now());
        const packageData = await response.json();
        const versionElement = document.getElementById('appVersion');
        if (versionElement && packageData.version) {
            versionElement.textContent = packageData.version;
            console.log('[VERSION] App version updated to:', packageData.version);
        }
    } catch (error) {
        // Fail silently - version number is not critical for app functionality
    }
}

/**
 * Auto-initialize version display when DOM is ready
 */
export function autoInitializeVersion() {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', loadVersionNumber);
    } else {
        loadVersionNumber();
    }
}
