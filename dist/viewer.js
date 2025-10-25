// PDF.js configuration
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

// Firebase configuration
const firebaseConfig = {
    apiKey: "AIzaSyDEUYN5CyRa-m0Fx1Gr18lFV4jgkYbpQu8",
    authDomain: "clerky-b3be8.firebaseapp.com",
    projectId: "clerky-b3be8",
    storageBucket: "clerky-b3be8.firebasestorage.app",
    messagingSenderId: "452690849034",
    appId: "1:452690849034:web:adea04a6c30d01f6a84fd0"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);

// Server URL
const SERVER_URL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? 'http://localhost:3000'
    : 'https://clerky-b3be8.onrender.com';

// Global variables
let pdfDoc = null;
let currentPage = 1;
let pageRendering = false;
let pageNumPending = null;
let scale = 1.5;
let canvas = null;
let ctx = null;

// Initialize
document.addEventListener('DOMContentLoaded', function() {
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
    
    // Load the PDF
    loadPDF(guidelineId);
});

// Load PDF from server
async function loadPDF(guidelineId) {
    try {
        console.log('[VIEWER] Loading PDF for guideline:', guidelineId);
        
        // Get auth token
        const currentUser = firebase.auth().currentUser;
        if (!currentUser) {
            // Try to wait for auth
            await new Promise((resolve, reject) => {
                const unsubscribe = firebase.auth().onAuthStateChanged(user => {
                    unsubscribe();
                    if (user) {
                        resolve(user);
                    } else {
                        reject(new Error('Not authenticated'));
                    }
                });
                // Timeout after 5 seconds
                setTimeout(() => {
                    unsubscribe();
                    reject(new Error('Authentication timeout'));
                }, 5000);
            });
        }
        
        const idToken = await firebase.auth().currentUser.getIdToken();
        
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
        
        // Update title
        document.getElementById('guideline-title').textContent = `Guideline (ID: ${guidelineId})`;
        
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

