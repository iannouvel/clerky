/**
 * GDPR Cookie Consent Banner
 * Include this script in all pages to display a GDPR-compliant cookie consent banner
 */

(function() {
    // Configuration - customize as needed
    const consentConfig = {
        cookieName: 'clerky_cookie_consent',
        cookieExpiration: 365, // days
        privacyPolicyUrl: 'privacy-policy.html',
        bannerText: 'We use cookies to enhance your experience on our website. By continuing to use our site, you consent to our use of cookies in accordance with our',
        privacyLinkText: 'Privacy Policy',
        acceptText: 'Accept All',
        customizeText: 'Customize',
        rejectText: 'Reject Non-Essential',
        saveText: 'Save Preferences',
        closeText: 'Close',
        categories: [
            {
                id: 'essential',
                name: 'Essential Cookies',
                description: 'These cookies are necessary for the website to function and cannot be turned off.',
                required: true
            },
            {
                id: 'analytics',
                name: 'Analytics Cookies',
                description: 'These cookies help us understand how visitors interact with our website.',
                required: false
            },
            {
                id: 'preferences',
                name: 'Preference Cookies',
                description: 'These cookies allow the website to remember choices you make.',
                required: false
            }
        ]
    };

    // Helper function to set cookie
    function setCookie(name, value, days) {
        const date = new Date();
        date.setTime(date.getTime() + (days * 24 * 60 * 60 * 1000));
        const expires = '; expires=' + date.toUTCString();
        document.cookie = name + '=' + value + expires + '; path=/; SameSite=Lax';
    }

    // Helper function to get cookie
    function getCookie(name) {
        const nameEQ = name + '=';
        const ca = document.cookie.split(';');
        for (let i = 0; i < ca.length; i++) {
            let c = ca[i];
            while (c.charAt(0) === ' ') c = c.substring(1, c.length);
            if (c.indexOf(nameEQ) === 0) return c.substring(nameEQ.length, c.length);
        }
        return null;
    }

    // Helper function to delete cookie
    function deleteCookie(name) {
        document.cookie = name + '=; Path=/; Expires=Thu, 01 Jan 1970 00:00:01 GMT; SameSite=Lax';
    }

    // Create the banner HTML
    function createBanner() {
        // Main container
        const banner = document.createElement('div');
        banner.id = 'cookie-consent-banner';
        banner.style.position = 'fixed';
        banner.style.bottom = '0';
        banner.style.left = '0';
        banner.style.right = '0';
        banner.style.backgroundColor = 'rgba(0, 0, 0, 0.85)';
        banner.style.color = 'white';
        banner.style.padding = '20px';
        banner.style.fontFamily = 'Inter, sans-serif';
        banner.style.zIndex = '9999';
        banner.style.boxShadow = '0 -2px 10px rgba(0, 0, 0, 0.2)';
        
        // Content wrapper
        const contentWrapper = document.createElement('div');
        contentWrapper.style.display = 'flex';
        contentWrapper.style.flexDirection = 'column';
        contentWrapper.style.maxWidth = '1200px';
        contentWrapper.style.margin = '0 auto';
        contentWrapper.style.gap = '15px';
        
        // Banner text
        const bannerText = document.createElement('p');
        bannerText.style.margin = '0';
        bannerText.style.fontSize = '14px';
        bannerText.textContent = consentConfig.bannerText + ' ';
        
        // Privacy policy link
        const privacyLink = document.createElement('a');
        privacyLink.href = consentConfig.privacyPolicyUrl;
        privacyLink.textContent = consentConfig.privacyLinkText;
        privacyLink.style.color = '#4f9cf6';
        privacyLink.style.textDecoration = 'underline';
        bannerText.appendChild(privacyLink);
        contentWrapper.appendChild(bannerText);
        
        // Button container
        const buttonContainer = document.createElement('div');
        buttonContainer.style.display = 'flex';
        buttonContainer.style.gap = '10px';
        buttonContainer.style.flexWrap = 'wrap';
        
        // Accept all button
        const acceptButton = document.createElement('button');
        acceptButton.textContent = consentConfig.acceptText;
        acceptButton.style.padding = '8px 16px';
        acceptButton.style.backgroundColor = '#4f9cf6';
        acceptButton.style.color = 'white';
        acceptButton.style.border = 'none';
        acceptButton.style.borderRadius = '4px';
        acceptButton.style.cursor = 'pointer';
        acceptButton.style.fontWeight = '500';
        acceptButton.style.fontSize = '14px';
        acceptButton.addEventListener('click', () => {
            const consent = {};
            consentConfig.categories.forEach(category => {
                consent[category.id] = true;
            });
            acceptConsent(consent);
        });
        buttonContainer.appendChild(acceptButton);
        
        // Customize button
        const customizeButton = document.createElement('button');
        customizeButton.textContent = consentConfig.customizeText;
        customizeButton.style.padding = '8px 16px';
        customizeButton.style.backgroundColor = 'transparent';
        customizeButton.style.color = 'white';
        customizeButton.style.border = '1px solid white';
        customizeButton.style.borderRadius = '4px';
        customizeButton.style.cursor = 'pointer';
        customizeButton.style.fontWeight = '500';
        customizeButton.style.fontSize = '14px';
        customizeButton.addEventListener('click', showPreferences);
        buttonContainer.appendChild(customizeButton);
        
        // Reject non-essential button
        const rejectButton = document.createElement('button');
        rejectButton.textContent = consentConfig.rejectText;
        rejectButton.style.padding = '8px 16px';
        rejectButton.style.backgroundColor = 'transparent';
        rejectButton.style.color = 'white';
        rejectButton.style.border = '1px solid white';
        rejectButton.style.borderRadius = '4px';
        rejectButton.style.cursor = 'pointer';
        rejectButton.style.fontWeight = '500';
        rejectButton.style.fontSize = '14px';
        rejectButton.addEventListener('click', () => {
            const consent = {};
            consentConfig.categories.forEach(category => {
                consent[category.id] = category.required;
            });
            acceptConsent(consent);
        });
        buttonContainer.appendChild(rejectButton);
        
        contentWrapper.appendChild(buttonContainer);
        banner.appendChild(contentWrapper);
        
        return banner;
    }
    
    // Create preferences modal
    function createPreferencesModal() {
        const modal = document.createElement('div');
        modal.id = 'cookie-preferences-modal';
        modal.style.display = 'none';
        modal.style.position = 'fixed';
        modal.style.top = '0';
        modal.style.left = '0';
        modal.style.right = '0';
        modal.style.bottom = '0';
        modal.style.backgroundColor = 'rgba(0, 0, 0, 0.5)';
        modal.style.zIndex = '10000';
        modal.style.fontFamily = 'Inter, sans-serif';
        
        const modalContent = document.createElement('div');
        modalContent.style.backgroundColor = 'white';
        modalContent.style.color = 'black';
        modalContent.style.maxWidth = '600px';
        modalContent.style.margin = '50px auto';
        modalContent.style.padding = '30px';
        modalContent.style.borderRadius = '8px';
        modalContent.style.maxHeight = 'calc(100vh - 100px)';
        modalContent.style.overflow = 'auto';
        
        // Modal header
        const modalHeader = document.createElement('div');
        modalHeader.style.display = 'flex';
        modalHeader.style.justifyContent = 'space-between';
        modalHeader.style.alignItems = 'center';
        modalHeader.style.marginBottom = '20px';
        
        const modalTitle = document.createElement('h2');
        modalTitle.textContent = 'Cookie Preferences';
        modalTitle.style.margin = '0';
        modalTitle.style.fontSize = '20px';
        modalHeader.appendChild(modalTitle);
        
        const closeButton = document.createElement('button');
        closeButton.textContent = '×';
        closeButton.style.backgroundColor = 'transparent';
        closeButton.style.border = 'none';
        closeButton.style.fontSize = '24px';
        closeButton.style.cursor = 'pointer';
        closeButton.style.padding = '0';
        closeButton.style.lineHeight = '1';
        closeButton.addEventListener('click', () => {
            modal.style.display = 'none';
        });
        modalHeader.appendChild(closeButton);
        
        modalContent.appendChild(modalHeader);
        
        // Modal description
        const modalDescription = document.createElement('p');
        modalDescription.textContent = 'Customize your cookie preferences below. Essential cookies cannot be disabled as they are necessary for the website to function properly.';
        modalDescription.style.marginBottom = '20px';
        modalContent.appendChild(modalDescription);
        
        // Preferences form
        const form = document.createElement('form');
        form.id = 'cookie-preferences-form';
        
        // Get saved preferences
        const savedConsent = getSavedConsent();
        
        // Create toggles for each category
        consentConfig.categories.forEach(category => {
            const categoryItem = document.createElement('div');
            categoryItem.style.marginBottom = '20px';
            categoryItem.style.padding = '15px';
            categoryItem.style.border = '1px solid #eee';
            categoryItem.style.borderRadius = '4px';
            
            const header = document.createElement('div');
            header.style.display = 'flex';
            header.style.justifyContent = 'space-between';
            header.style.alignItems = 'center';
            header.style.marginBottom = '10px';
            
            const label = document.createElement('label');
            label.style.fontWeight = 'bold';
            label.style.display = 'flex';
            label.style.alignItems = 'center';
            label.style.gap = '10px';
            label.setAttribute('for', `cookie-category-${category.id}`);
            label.textContent = category.name;
            
            const toggle = document.createElement('input');
            toggle.type = 'checkbox';
            toggle.id = `cookie-category-${category.id}`;
            toggle.name = category.id;
            toggle.checked = category.required || (savedConsent && savedConsent[category.id]);
            toggle.disabled = category.required;
            
            label.prepend(toggle);
            header.appendChild(label);
            
            if (category.required) {
                const requiredBadge = document.createElement('span');
                requiredBadge.textContent = 'Required';
                requiredBadge.style.backgroundColor = '#f0f0f0';
                requiredBadge.style.padding = '2px 6px';
                requiredBadge.style.borderRadius = '4px';
                requiredBadge.style.fontSize = '12px';
                header.appendChild(requiredBadge);
            }
            
            categoryItem.appendChild(header);
            
            const description = document.createElement('p');
            description.textContent = category.description;
            description.style.margin = '0';
            description.style.fontSize = '14px';
            categoryItem.appendChild(description);
            
            form.appendChild(categoryItem);
        });
        
        // Save preferences button
        const saveButton = document.createElement('button');
        saveButton.type = 'button';
        saveButton.textContent = consentConfig.saveText;
        saveButton.style.padding = '10px 20px';
        saveButton.style.backgroundColor = '#4f9cf6';
        saveButton.style.color = 'white';
        saveButton.style.border = 'none';
        saveButton.style.borderRadius = '4px';
        saveButton.style.cursor = 'pointer';
        saveButton.style.fontWeight = '500';
        saveButton.style.fontSize = '14px';
        saveButton.style.marginTop = '10px';
        saveButton.addEventListener('click', () => {
            const formData = new FormData(form);
            const consent = {};
            
            // Set all categories to false initially
            consentConfig.categories.forEach(category => {
                consent[category.id] = false;
            });
            
            // Then update with form values
            for (const [key, value] of formData.entries()) {
                consent[key] = true;
            }
            
            // Ensure required categories are always true
            consentConfig.categories.forEach(category => {
                if (category.required) {
                    consent[category.id] = true;
                }
            });
            
            acceptConsent(consent);
            modal.style.display = 'none';
        });
        
        form.appendChild(saveButton);
        modalContent.appendChild(form);
        modal.appendChild(modalContent);
        
        return modal;
    }
    
    // Show preferences modal
    function showPreferences() {
        const modal = document.getElementById('cookie-preferences-modal');
        modal.style.display = 'block';
    }
    
    // Get saved consent preferences
    function getSavedConsent() {
        const consentCookie = getCookie(consentConfig.cookieName);
        if (consentCookie) {
            try {
                return JSON.parse(consentCookie);
            } catch (e) {
                console.error('Failed to parse consent cookie:', e);
                return null;
            }
        }
        return null;
    }
    
    // Accept consent and save preferences
    function acceptConsent(consent) {
        // Save consent to cookie
        setCookie(consentConfig.cookieName, JSON.stringify(consent), consentConfig.cookieExpiration);
        
        // Apply cookie consent (enable/disable tracking based on preferences)
        applyCookieConsent(consent);
        
        // Hide banner
        const banner = document.getElementById('cookie-consent-banner');
        if (banner) {
            banner.remove();
        }
        
        // Dispatch event that consent has been updated
        window.dispatchEvent(new CustomEvent('cookieConsentUpdated', { detail: consent }));
    }
    
    // Apply cookie consent based on user preferences
    function applyCookieConsent(consent) {
        // Handle analytics cookies (e.g., Google Analytics)
        if (consent.analytics) {
            // Enable analytics tracking
            enableAnalytics();
        } else {
            // Disable analytics tracking
            disableAnalytics();
        }
        
        // Handle preference cookies
        if (!consent.preferences) {
            // Delete any preference cookies
            // Add code to delete specific preference cookies
        }
    }
    
    // Enable analytics tracking
    function enableAnalytics() {
        // Example for Google Analytics
        window['ga-disable-GA_MEASUREMENT_ID'] = false;
    }
    
    // Disable analytics tracking
    function disableAnalytics() {
        // Example for Google Analytics
        window['ga-disable-GA_MEASUREMENT_ID'] = true;
    }
    
    // Initialize cookie consent system
    function initCookieConsent() {
        // Check if consent has already been given
        const consent = getSavedConsent();
        
        if (!consent) {
            // Show the banner if no consent has been given
            const banner = createBanner();
            document.body.appendChild(banner);
            
            // Create preferences modal
            const modal = createPreferencesModal();
            document.body.appendChild(modal);
        } else {
            // Apply existing consent
            applyCookieConsent(consent);
        }
    }
    
    // Export functions for external access
    window.clerkyConsent = {
        showPreferences: () => {
            // Create modal if it doesn't exist
            if (!document.getElementById('cookie-preferences-modal')) {
                const modal = createPreferencesModal();
                document.body.appendChild(modal);
            }
            showPreferences();
        },
        resetConsent: () => {
            deleteCookie(consentConfig.cookieName);
            location.reload();
        },
        getConsent: getSavedConsent
    };
    
    // Initialize when DOM is fully loaded
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initCookieConsent);
    } else {
        initCookieConsent();
    }
})(); 