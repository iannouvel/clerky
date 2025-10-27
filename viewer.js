// PDF.js configuration
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

// NOTE: We do NOT initialize Firebase in the viewer to avoid auth state conflicts
// The auth token is passed via sessionStorage from the main app
console.log('[VIEWER] Viewer initialized - will use token from sessionStorage');

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
let searchText = null;
let highlightedPage = null;
let textMatches = [];

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
    
    // Load the PDF immediately - no Firebase initialization needed
    loadPDF(guidelineId);
});

// Load PDF from server
async function loadPDF(guidelineId) {
    try {
        console.log('[VIEWER] Loading PDF for guideline:', guidelineId);
        
        // Get auth token from localStorage (set by main app before opening viewer)
        const idToken = localStorage.getItem('viewerAuthToken');
        const tokenTime = localStorage.getItem('viewerAuthTokenTime');
        
        if (!idToken) {
            throw new Error('No authentication token found. Please click the link from the main application to view this guideline.');
        }
        
        // Check if token is recent (within 5 minutes)
        if (tokenTime) {
            const tokenAge = Date.now() - parseInt(tokenTime, 10);
            if (tokenAge > 5 * 60 * 1000) {
                console.warn('[VIEWER] Auth token is older than 5 minutes, might be expired');
            }
        }
        
        console.log('[VIEWER] Using auth token from localStorage');
        
        // Clean up token from localStorage for security (one-time use)
        // Do this after a short delay to allow token to be used
        setTimeout(() => {
            localStorage.removeItem('viewerAuthToken');
            localStorage.removeItem('viewerAuthTokenTime');
            console.log('[VIEWER] Cleaned up auth token from localStorage');
        }, 1000);
        
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
        
        // Check if there's search text to find and highlight
        searchText = localStorage.getItem('viewerSearchText');
        if (searchText) {
            console.log('[VIEWER] Search text found:', searchText.substring(0, 50) + '...');
            showSearchStatus('Searching for quoted text in PDF...', 'info');
            
            // Search for text in background after rendering first page
            setTimeout(() => {
                searchPDFForText(searchText);
            }, 500);
        }
        
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
            
            // Reapply highlights if this is the highlighted page
            if (highlightedPage === pageNumber && searchText && textMatches.length > 0) {
                setTimeout(() => {
                    page.getTextContent().then(textContent => {
                        highlightTextOnPage(searchText, textContent);
                    });
                }, 100);
            }
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

// Search PDF for text and navigate to it
async function searchPDFForText(searchTerm) {
    try {
        console.log('[VIEWER] Searching PDF for:', searchTerm);
        
        // Normalize search term - collapse whitespace and lowercase
        const normalizedSearch = searchTerm.toLowerCase().trim().replace(/\s+/g, ' ');
        
        // Search through all pages
        for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
            const page = await pdfDoc.getPage(pageNum);
            const textContent = await page.getTextContent();
            
            // Combine all text items into a single string with better spacing handling
            const pageText = textContent.items.map(item => item.str).join(' ');
            // Normalize page text - collapse whitespace and lowercase
            const normalizedPageText = pageText.toLowerCase().replace(/\s+/g, ' ');
            
            console.log(`[VIEWER] Searching page ${pageNum}/${pdfDoc.numPages}...`);
            
            // Check if this page contains the search text
            if (normalizedPageText.includes(normalizedSearch)) {
                console.log('[VIEWER] Found text on page:', pageNum);
                
                // Navigate to this page
                currentPage = pageNum;
                renderPage(pageNum);
                
                // Store text items for highlighting
                textMatches = textContent.items;
                highlightedPage = pageNum;
                
                // Wait for page to render, then highlight
                setTimeout(() => {
                    highlightTextOnPage(searchTerm, textContent);
                    showSearchStatus(`✓ Found quoted text on page ${pageNum}`, 'success');
                }, 500);
                
                // Clean up search text from localStorage
                localStorage.removeItem('viewerSearchText');
                
                return;
            }
        }
        
        // Text not found
        console.log('[VIEWER] Text not found in PDF');
        showSearchStatus('⚠ Quoted text not found in this guideline PDF', 'warning');
        localStorage.removeItem('viewerSearchText');
        
    } catch (error) {
        console.error('[VIEWER] Error searching PDF:', error);
        showSearchStatus('Error searching PDF', 'warning');
    }
}

// Highlight text on the current page
function highlightTextOnPage(searchTerm, textContent) {
    try {
        console.log('[VIEWER] Highlighting text on page');
        
        const highlightLayer = document.getElementById('highlight-layer');
        if (!highlightLayer) return;
        
        // Clear existing highlights
        highlightLayer.innerHTML = '';
        
        // Normalize search term - collapse whitespace
        const normalizedSearch = searchTerm.toLowerCase().trim().replace(/\s+/g, ' ');
        
        // Build continuous text with position tracking
        let fullText = '';
        let itemPositions = [];
        
        textContent.items.forEach((item, index) => {
            const startPos = fullText.length;
            fullText += item.str + ' ';
            itemPositions.push({
                index,
                startPos,
                endPos: fullText.length - 1,
                item
            });
        });
        
        // Normalize full text - collapse whitespace
        const normalizedFullText = fullText.toLowerCase().replace(/\s+/g, ' ');
        const searchIndex = normalizedFullText.indexOf(normalizedSearch);
        
        if (searchIndex === -1) {
            console.log('[VIEWER] Text not found on this specific page during highlighting');
            // Still try to highlight the first few words as a fallback
            const searchWords = normalizedSearch.split(' ').slice(0, 5).join(' ');
            const fallbackIndex = normalizedFullText.indexOf(searchWords);
            if (fallbackIndex === -1) {
                return;
            }
            console.log('[VIEWER] Highlighting first few words instead');
        }
        
        // Find which text items contain the search text
        const searchEndIndex = searchIndex + normalizedSearch.length;
        const relevantItems = itemPositions.filter(pos => {
            return (pos.startPos <= searchEndIndex && pos.endPos >= searchIndex);
        });
        
        if (relevantItems.length === 0) return;
        
        // Get page and calculate viewport
        pdfDoc.getPage(currentPage).then(page => {
            const viewport = page.getViewport({ scale: scale });
            
            // Create highlight boxes for each relevant text item
            relevantItems.forEach(pos => {
                const item = pos.item;
                
                // Get transform matrix for this text item
                const transform = item.transform;
                const x = transform[4];
                const y = transform[5];
                const width = item.width;
                const height = item.height || 12; // Fallback height
                
                // Convert PDF coordinates to canvas coordinates
                const canvasX = x;
                const canvasY = viewport.height - y - height;
                
                // Create highlight div
                const highlight = document.createElement('div');
                highlight.className = 'text-highlight';
                highlight.style.left = canvasX + 'px';
                highlight.style.top = canvasY + 'px';
                highlight.style.width = width + 'px';
                highlight.style.height = height + 'px';
                
                highlightLayer.appendChild(highlight);
            });
            
            // Update highlight layer dimensions to match canvas
            highlightLayer.style.width = canvas.width + 'px';
            highlightLayer.style.height = canvas.height + 'px';
            
            console.log('[VIEWER] Added', relevantItems.length, 'highlight boxes');
        });
        
    } catch (error) {
        console.error('[VIEWER] Error highlighting text:', error);
    }
}

// Show search status message
function showSearchStatus(message, type = 'info') {
    const container = document.getElementById('search-status-container');
    if (!container) return;
    
    const className = type === 'success' ? 'search-status success' :
                     type === 'warning' ? 'search-status warning' :
                     'search-status';
    
    container.innerHTML = `<div class="${className}">${message}</div>`;
    container.style.display = 'block';
    
    // Auto-hide info messages after 5 seconds
    if (type === 'info') {
        setTimeout(() => {
            container.style.display = 'none';
        }, 5000);
    }
}

