/**
 * Mobile Detection & Layout Management
 * Handles responsive layout changes for mobile devices
 */

// ===== Module State =====
let mobileSettingsInitialized = false;
let mobileSettingsOverlayOpen = false;
let userPreferencesOriginalParent = null;
let userPreferencesOriginalNextSibling = null;

// Initialize global mobile state on window
if (typeof window !== 'undefined') {
    window.isMobile = false;
    window.mobileView = 'userInput'; // 'userInput' or 'summary1'
}

// ===== Settings Overlay Functions =====

/**
 * Opens the mobile settings overlay panel
 */
export function openMobileSettingsOverlay() {
    if (!window.isMobile) return;

    const overlay = document.getElementById('mobileSettingsOverlay');
    const bodyContainer = document.getElementById('mobileSettingsBody');
    const panel = document.getElementById('userPreferencesPanel');

    if (!overlay || !bodyContainer || !panel) {
        console.warn('[MOBILE] Mobile settings elements not found');
        return;
    }

    // Remember original placement on first open
    if (!userPreferencesOriginalParent) {
        userPreferencesOriginalParent = panel.parentElement;
        userPreferencesOriginalNextSibling = panel.nextSibling;
    }

    // Move preferences panel into the overlay body
    if (panel.parentElement !== bodyContainer) {
        bodyContainer.appendChild(panel);
    }

    overlay.classList.remove('hidden');
    document.body.classList.add('mobile-settings-open');
    mobileSettingsOverlayOpen = true;
}

/**
 * Closes the mobile settings overlay panel
 */
export function closeMobileSettingsOverlay() {
    const overlay = document.getElementById('mobileSettingsOverlay');
    const panel = document.getElementById('userPreferencesPanel');

    if (overlay) {
        overlay.classList.add('hidden');
    }

    // Move the panel back to its original location so desktop layout is unchanged
    if (panel && userPreferencesOriginalParent) {
        if (userPreferencesOriginalNextSibling && userPreferencesOriginalNextSibling.parentElement === userPreferencesOriginalParent) {
            userPreferencesOriginalParent.insertBefore(panel, userPreferencesOriginalNextSibling);
        } else {
            userPreferencesOriginalParent.appendChild(panel);
        }
    }

    document.body.classList.remove('mobile-settings-open');
    mobileSettingsOverlayOpen = false;
}

/**
 * Initializes the mobile settings overlay event listeners
 */
export function initializeMobileSettingsOverlay() {
    if (mobileSettingsInitialized) return;

    const toggleBtn = document.getElementById('mobileSettingsToggleBtn');
    const overlay = document.getElementById('mobileSettingsOverlay');
    const closeBtn = document.getElementById('mobileSettingsCloseBtn');

    if (!toggleBtn || !overlay) {
        // Elements may not be ready yet
        return;
    }

    toggleBtn.addEventListener('click', () => {
        if (mobileSettingsOverlayOpen) {
            closeMobileSettingsOverlay();
        } else {
            openMobileSettingsOverlay();
        }
    });

    if (closeBtn) {
        closeBtn.addEventListener('click', () => {
            closeMobileSettingsOverlay();
        });
    }

    // Close when clicking outside the dialog
    overlay.addEventListener('click', (event) => {
        if (event.target === overlay) {
            closeMobileSettingsOverlay();
        }
    });

    // Close on Escape key
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && mobileSettingsOverlayOpen) {
            closeMobileSettingsOverlay();
        }
    });

    mobileSettingsInitialized = true;
}

// ===== Mobile Detection Functions =====

/**
 * Detect if device is mobile based on viewport width and user agent
 * @returns {boolean} Whether the device is in mobile mode
 */
export function detectMobile() {
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
    const isMobileWidth = viewportWidth <= 768;

    // User agent detection for additional mobile device detection
    const userAgent = navigator.userAgent || navigator.vendor || window.opera;
    const isMobileUA = /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/i.test(userAgent.toLowerCase());

    const wasMobile = window.isMobile;
    window.isMobile = isMobileWidth || (isMobileUA && viewportWidth <= 1024);

    // If mobile state changed, update layout
    if (wasMobile !== window.isMobile) {
        applyMobileLayout();
    }

    return window.isMobile;
}

/**
 * Apply mobile layout changes to the DOM
 */
export function applyMobileLayout() {
    const body = document.body;
    const mainContent = document.getElementById('mainContent');
    const chatbotLayout = document.getElementById('chatbotLayout');
    const mobileToggleContainer = document.getElementById('mobileViewToggle');
    const mobileSettingsToggleBtn = document.getElementById('mobileSettingsToggleBtn');

    // If mainContent doesn't exist yet, try again after a short delay
    if (!mainContent) {
        // Retry after a short delay if elements aren't ready
        setTimeout(() => {
            if (document.getElementById('mainContent')) {
                applyMobileLayout();
            }
        }, 100);
        return;
    }

    if (window.isMobile) {
        body.classList.add('mobile-mode');
        mainContent.classList.add('mobile-mode');
        initializeMobileSettingsOverlay();

        // Hide mobile toggle buttons (not needed with chatbot layout)
        if (mobileToggleContainer) {
            mobileToggleContainer.classList.add('hidden');
        }

        if (mobileSettingsToggleBtn) {
            mobileSettingsToggleBtn.classList.remove('hidden');
        }
    } else {
        // Ensure any open mobile settings overlay is closed when leaving mobile mode
        if (mobileSettingsOverlayOpen) {
            closeMobileSettingsOverlay();
        }

        body.classList.remove('mobile-mode');
        mainContent.classList.remove('mobile-mode');

        // Hide mobile toggle buttons
        if (mobileToggleContainer) {
            mobileToggleContainer.classList.add('hidden');
        }

        if (mobileSettingsToggleBtn) {
            mobileSettingsToggleBtn.classList.add('hidden');
        }
    }
}

/**
 * Switch between userInput and summary1 views on mobile
 * @param {string} view - Either 'userInput' or 'summary1'
 */
export function switchMobileView(view) {
    if (!window.isMobile) return;

    const userInputCol = document.querySelector('.user-input-col');
    const summaryCol = document.querySelector('.summary-col');
    const userInputBtn = document.getElementById('mobileViewUserInputBtn');
    const summaryBtn = document.getElementById('mobileViewSummaryBtn');

    window.mobileView = view;
    sessionStorage.setItem('mobileView', view);

    if (view === 'userInput') {
        if (userInputCol) {
            userInputCol.style.display = 'flex';
            // Ensure TipTap editor is properly visible when switching to userInput
            const editorElement = userInputCol.querySelector('.tiptap-editor');
            if (editorElement && window.editors && window.editors.userInput) {
                // Small delay to ensure DOM update completes
                setTimeout(() => {
                    try {
                        window.editors.userInput.commands.focus();
                    } catch (e) {
                        // Editor might not be ready, ignore
                    }
                }, 100);
            }
        }
        if (summaryCol) summaryCol.style.display = 'none';
        if (userInputBtn) userInputBtn.classList.add('active');
        if (summaryBtn) summaryBtn.classList.remove('active');
    } else {
        if (userInputCol) userInputCol.style.display = 'none';
        if (summaryCol) {
            summaryCol.style.display = 'flex';
            // Scroll to top of summary when switching to it
            const summaryPane = summaryCol.querySelector('#summary1');
            if (summaryPane) {
                setTimeout(() => {
                    summaryPane.scrollTop = 0;
                }, 50);
            }
        }
        if (userInputBtn) userInputBtn.classList.remove('active');
        if (summaryBtn) summaryBtn.classList.add('active');
    }
}

/**
 * Initialize mobile detection on page load and resize
 */
export function initializeMobileDetection() {
    detectMobile();

    // Listen for window resize
    let resizeTimeout;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(() => {
            detectMobile();
        }, 150);
    });

    // Set up mobile view toggle buttons
    const userInputBtn = document.getElementById('mobileViewUserInputBtn');
    const summaryBtn = document.getElementById('mobileViewSummaryBtn');

    if (userInputBtn) {
        userInputBtn.addEventListener('click', () => switchMobileView('userInput'));
    }

    if (summaryBtn) {
        summaryBtn.addEventListener('click', () => switchMobileView('summary1'));
    }
}

/**
 * Auto-initialize mobile detection when DOM is ready
 */
export function autoInitializeMobile() {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initializeMobileDetection);
    } else {
        initializeMobileDetection();
    }
}
