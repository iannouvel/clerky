/**
 * Clinical Data Management
 * Handles loading and storing clinical issues data
 */

// Global state for clinical issues
export let clinicalIssues = {
    obstetrics: [],
    gynaecology: []
};

export let clinicalIssuesLoaded = false;

/**
 * Load clinical issues from the JSON file
 * @returns {Promise<void>}
 */
export async function loadClinicalIssues() {
    console.log('Starting loadClinicalIssues...');
    if (clinicalIssuesLoaded) {
        console.log('Clinical issues already loaded');
        return;
    }

    try {
        console.log('Fetching clinical_issues.json...');
        const response = await fetch('clinical_issues.json');
        console.log('Fetch response status:', response.status);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        console.log('Parsing JSON response...');
        const data = await response.json();
        console.log('Clinical issues data loaded:', data);

        // Update the exported variables
        clinicalIssues = data;
        clinicalIssuesLoaded = true;

        console.log('Clinical issues loaded successfully');
    } catch (error) {
        console.error('Error loading clinical issues:', error);
        throw error;
    }
}
