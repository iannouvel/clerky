// PDF.js configuration
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

// Firebase configuration - MUST match the main app configuration
const firebaseConfig = {
    apiKey: "AIzaSyAF5y6k9THaRKxLZemqcYDj4y_EgCcDbX8",
    authDomain: "clerky-b3be8.firebaseapp.com",
    projectId: "clerky-b3be8",
    storageBucket: "clerky-b3be8.appspot.com",
    messagingSenderId: "193460924609",
    appId: "1:193460924609:web:6e2c696c87292d4a222440",
    measurementId: "G-V07DP1ELDR"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);

// Set auth persistence to LOCAL so sessions persist across tabs
firebase.auth().setPersistence(firebase.auth.Auth.Persistence.LOCAL)
    .then(() => {
        console.log('[VIEWER] Auth persistence set to LOCAL');
    })
    .catch((error) => {
        console.error('[VIEWER] Failed to set auth persistence:', error);
    });

// Server URL
const SERVER_URL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? 'http://localhost:3000'
    : 'https://clerky-uzni.onrender.com';

// Global variables
let pdfDoc = null;
let currentPage = 1;
let pageRendering = false;
let pageNumPending = null;
let scale = 1.5;
let canvas = null;
let ctx = null;

// Initialize
document.addEventListener('DOMContentLoaded', async function() {
    canvas = document.getElementById('pdf-canvas');
    ctx = canvas.getContext('2d');
    
    // Get parameters from URL
    const urlParams = new URLSearchParams(window.location.search);
    const guidelineId = urlParams.get('guidelineId');
    const pageParam = urlParams.get('page');
    
    if (pageParam) {
        currentPage = parseInt(pageParam, 10) || 1;
    }
    
    if (!guidelineId) {
        showError('No guideline ID provided', 'Please provide a guideline ID in the URL parameters.');
        return;
    }
    
    // Wait a bit for Firebase to initialize and restore auth state
    console.log('[VIEWER] Waiting for Firebase initialization...');
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Load the PDF
    loadPDF(guidelineId);
});

// Load PDF from server
async function loadPDF(guidelineId) {
    try {
        console.log('[VIEWER] Loading PDF for guideline:', guidelineId);
        
        // Update loading message
        document.getElementById('loading-container').innerHTML = '<div class="loading-spinner"></div><p>Authenticating...</p>';
        
        // Wait for Firebase auth to be ready
        const user = await new Promise((resolve, reject) => {
            // First check if already signed in
            const currentUser = firebase.auth().currentUser;
            if (currentUser) {
                console.log('[VIEWER] User already authenticated');
                resolve(currentUser);
                return;
            }
            
            // Otherwise wait for auth state to change
            console.log('[VIEWER] Waiting for authentication...');
            let timeoutId;
            const unsubscribe = firebase.auth().onAuthStateChanged(user => {
                clearTimeout(timeoutId);
                unsubscribe();
                if (user) {
                    console.log('[VIEWER] User authenticated:', user.email);
                    resolve(user);
                } else {
                    console.log('[VIEWER] No user authenticated');
                    reject(new Error('Not authenticated. Please sign in to view guidelines.'));
                }
            });
            
            // Longer timeout - 30 seconds to allow for auth state restoration
            timeoutId = setTimeout(() => {
                unsubscribe();
                console.error('[VIEWER] Authentication timeout after 30 seconds');
                reject(new Error('Authentication timeout. Please sign in to the main application first, then try opening the guideline viewer again.'));
            }, 30000);
        });
        
        // Update loading message
        document.getElementById('loading-container').innerHTML = '<div class="loading-spinner"></div><p>Loading PDF...</p>';
        
        const idToken = await user.getIdToken();
        
        // Fetch PDF from server
        const response = await fetch(`${SERVER_URL}/getGuidelinePDF?guidelineId=${encodeURIComponent(guidelineId)}`, {
            headers: {
                'Authorization': `Bearer ${idToken}`
            }
        });
        
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
            throw new Error(errorData.error || `Server error: ${response.status}`);
        }
        
        // Get PDF as blob
        const pdfBlob = await response.blob();
        const pdfUrl = URL.createObjectURL(pdfBlob);
        
        console.log('[VIEWER] PDF blob created, loading document...');
        
        // Load PDF with PDF.js
        const loadingTask = pdfjsLib.getDocument(pdfUrl);
        pdfDoc = await loadingTask.promise;
        
        console.log('[VIEWER] PDF loaded, total pages:', pdfDoc.numPages);
        
        // Update page count
        document.getElementById('page-count').textContent = pdfDoc.numPages;
        
        // Update title - show just the guideline ID in a cleaner format
        const titleElement = document.getElementById('guideline-title');
        if (titleElement) {
            // Clean up the guideline ID for display
            const displayTitle = guidelineId
                .replace(/-pdf$/, '')
                .split('-')
                .map(word => word.charAt(0).toUpperCase() + word.slice(1))
                .join(' ');
            titleElement.textContent = `📄 ${displayTitle}`;
        }
        
        // Hide loading, show PDF
        document.getElementById('loading-container').style.display = 'none';
        document.getElementById('pdf-container').style.display = 'flex';
        
        // Render the first (or specified) page
        renderPage(currentPage);
        
        // Enable navigation buttons
        updateNavigationButtons();
        
    } catch (error) {
        console.error('[VIEWER] Error loading PDF:', error);
        showError('Failed to load PDF', error.message);
    }
}

// Render a specific page
function renderPage(pageNumber) {
    if (pageRendering) {
        pageNumPending = pageNumber;
        return;
    }
    
    pageRendering = true;
    
    console.log('[VIEWER] Rendering page:', pageNumber);
    
    // Update page number display
    document.getElementById('page-num').textContent = pageNumber;
    
    pdfDoc.getPage(pageNumber).then(function(page) {
        const viewport = page.getViewport({ scale: scale });
        canvas.height = viewport.height;
        canvas.width = viewport.width;
        
        const renderContext = {
            canvasContext: ctx,
            viewport: viewport
        };
        
        const renderTask = page.render(renderContext);
        
        renderTask.promise.then(function() {
            pageRendering = false;
            
            if (pageNumPending !== null) {
                renderPage(pageNumPending);
                pageNumPending = null;
            }
            
            updateNavigationButtons();
        }).catch(function(error) {
            console.error('[VIEWER] Error rendering page:', error);
            pageRendering = false;
        });
    }).catch(function(error) {
        console.error('[VIEWER] Error getting page:', error);
        pageRendering = false;
    });
}

// Navigation functions
function previousPage() {
    if (currentPage <= 1) {
        return;
    }
    currentPage--;
    renderPage(currentPage);
}

function nextPage() {
    if (currentPage >= pdfDoc.numPages) {
        return;
    }
    currentPage++;
    renderPage(currentPage);
}

function updateNavigationButtons() {
    const prevBtn = document.getElementById('prev-btn');
    const nextBtn = document.getElementById('next-btn');
    
    if (prevBtn) {
        prevBtn.disabled = currentPage <= 1;
    }
    
    if (nextBtn) {
        nextBtn.disabled = currentPage >= pdfDoc.numPages;
    }
}

// Zoom functions
function zoomIn() {
    scale += 0.25;
    if (scale > 3.0) scale = 3.0;
    updateZoomLevel();
    renderPage(currentPage);
}

function zoomOut() {
    scale -= 0.25;
    if (scale < 0.5) scale = 0.5;
    updateZoomLevel();
    renderPage(currentPage);
}

function updateZoomLevel() {
    document.getElementById('zoom-level').textContent = Math.round(scale * 100) + '%';
}

// Error handling
function showError(title, message) {
    document.getElementById('loading-container').style.display = 'none';
    document.getElementById('pdf-container').style.display = 'none';
    
    const errorContainer = document.getElementById('error-container');
    errorContainer.innerHTML = `
        <div class="error">
            <h3>❌ ${title}</h3>
            <p>${message}</p>
            <p style="margin-top: 10px;">
                <a href="javascript:history.back()" style="color: #991b1b; text-decoration: underline;">← Go back</a>
            </p>
        </div>
    `;
    errorContainer.style.display = 'block';
}

// Keyboard navigation
document.addEventListener('keydown', function(e) {
    if (e.key === 'ArrowLeft') {
        previousPage();
    } else if (e.key === 'ArrowRight') {
        nextPage();
    }
});
