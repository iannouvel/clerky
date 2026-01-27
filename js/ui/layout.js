/**
 * Layout Management
 * Utilities for controlling main application layout and visibility
 */

/**
 * Show the main application content and hide loading/landing screens
 */
export function showMainContent() {
    console.log('Starting showMainContent...');
    const loading = document.getElementById('loading');
    const landingPage = document.getElementById('landingPage');
    const mainContent = document.getElementById('mainContent');

    console.log('Elements found:', {
        loading: !!loading,
        landingPage: !!landingPage,
        mainContent: !!mainContent
    });

    if (loading) {
        console.log('Hiding loading screen...');
        loading.classList.add('hidden');
    }
    if (landingPage) {
        console.log('Hiding landing page...');
        landingPage.classList.add('hidden');
    }
    if (mainContent) {
        console.log('Showing main content...');
        mainContent.classList.remove('hidden');
    }
}
