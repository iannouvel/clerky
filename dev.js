// Import Firebase instances from firebase-init.js
import { app, db, auth } from './firebase-init.js';
import { GoogleAuthProvider, signInWithPopup, onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import { getAnalytics } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-analytics.js';
import { doc, getDoc } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

// Initialize Analytics
const analytics = getAnalytics(app);

// Global variables
const SERVER_URL = 'https://clerky-uzni.onrender.com';
const GITHUB_API_BASE = 'https://api.github.com/repos/iannouvel/clerky';
const MAX_FILES_TO_LIST = 100; // Maximum number of files to list
const MAX_FILES_TO_LOAD = 5;  // Maximum number of files to actually load content for
let currentModel = 'OpenAI'; // Track current model
const MAX_RETRIES = 3; // Maximum number of retries for API calls
const RETRY_DELAYS = [1000, 3000, 5000]; // Delays between retries in milliseconds

// Initialize Firebase
async function initializeFirebase() {
    try {
        console.log('Firebase initialized successfully');
    } catch (error) {
        console.error('Error initializing Firebase:', error);
        // Show error in UI with alert instead of status element
        alert('Error initializing Firebase. Please refresh the page.');
    }
}

document.addEventListener('DOMContentLoaded', async function() {
    try {
        // Initialize Firebase first
        await initializeFirebase();
        
        const buttons = document.querySelectorAll('.nav-btn');
        const contents = document.querySelectorAll('.tab-content');
        const modelToggle = document.getElementById('modelToggle');
        // Set initial model toggle text
        const modelName = currentModel === 'OpenAI' ? 'gpt-3.5-turbo' : 'deepseek-chat';
        modelToggle.textContent = `AI: ${currentModel} (${modelName})`;
        modelToggle.classList.toggle('active', currentModel === 'DeepSeek');
        
        let currentLogIndex = 0;
        let logs = [];
        let allLogFiles = []; // Store all log files metadata without content
        let costData = null; // Store the cost data

        // Function to fetch API usage costs
        async function fetchApiCosts() {
            const costDisplay = document.getElementById('costDisplay');
            const statusMessage = document.getElementById('costStatusMessage');
            
            statusMessage.textContent = 'Fetching API usage data...';
            costDisplay.innerHTML = '<div class="loading">Loading cost data...</div>';
            
            // Get the current user
            const user = auth.currentUser;
            if (!user) {
                statusMessage.textContent = 'You must be logged in to view cost data';
                costDisplay.innerHTML = '<div class="auth-error">Please log in to view API usage costs</div>';
                return;
            }
            
            // Get Firebase token
            let token;
            try {
                token = await user.getIdToken();
            } catch (error) {
                console.error('Error getting auth token:', error);
                statusMessage.textContent = 'Authentication error';
                costDisplay.innerHTML = '<div class="auth-error">Failed to authenticate. Please try logging in again.</div>';
                return;
            }
            
            // Fetch cost data with retry logic
            for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
                try {
                    if (attempt > 0) {
                        console.log(`Retry attempt ${attempt}/${MAX_RETRIES} for cost data after ${RETRY_DELAYS[attempt-1]/1000} seconds...`);
                        statusMessage.textContent = `Retry ${attempt}/${MAX_RETRIES}...`;
                        await new Promise(resolve => setTimeout(resolve, RETRY_DELAYS[attempt-1]));
                    }
                    
                    console.log(`Fetching API cost data (attempt ${attempt+1}/${MAX_RETRIES+1})...`);
                    const response = await fetch(`${SERVER_URL}/api-usage-stats`, {
                        method: 'GET',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${token}`
                        }
                    });
                    
                    // Handle unauthorized access
                    if (response.status === 401 || response.status === 403) {
                        statusMessage.textContent = 'Access denied';
                        costDisplay.innerHTML = '<div class="auth-error">You do not have permission to view API usage costs</div>';
                        return;
                    }
                    
                    if (!response.ok) {
                        throw new Error(`Server returned status ${response.status}`);
                    }
                    
                    const data = await response.json();
                    costData = data;
                    displayCostData(data);
                    
                    // Update status message
                    const date = new Date();
                    statusMessage.textContent = `Last updated: ${date.toLocaleString()}`;
                    return;
                } catch (error) {
                    console.error(`Error fetching API cost data (attempt ${attempt+1}/${MAX_RETRIES+1}):`, error);
                    
                    // On last attempt, show error message
                    if (attempt === MAX_RETRIES) {
                        statusMessage.textContent = 'Failed to load cost data';
                        costDisplay.innerHTML = '<div class="error">Failed to fetch API usage cost data. Please try again later.</div>';
                    }
                }
            }
        }
        
        // Function to display the cost data
        function displayCostData(data) {
            const costDisplay = document.getElementById('costDisplay');
            
            // Clear previous content
            costDisplay.innerHTML = '';
            
            if (!data || !data.success) {
                costDisplay.innerHTML = '<div class="error">Failed to fetch API usage cost data</div>';
                return;
            }
            
            const { stats } = data;
            
            // Create cost summary section
            const summaryCard = document.createElement('div');
            summaryCard.className = 'cost-card';
            summaryCard.innerHTML = `
                <h3>API Usage Summary</h3>
                <div class="cost-summary">
                    <div class="stat-box">
                        <div class="stat-value">${stats.totalCalls.toLocaleString()}</div>
                        <div class="stat-label">Total API Calls</div>
                    </div>
                    <div class="stat-box">
                        <div class="stat-value">${stats.totalTokensUsed.toLocaleString()}</div>
                        <div class="stat-label">Total Tokens</div>
                    </div>
                    <div class="stat-box">
                        <div class="stat-value">$${stats.estimatedTotalCost.toFixed(4)}</div>
                        <div class="stat-label">Estimated Cost</div>
                    </div>
                </div>
                
                <div class="provider-comparison">
                    <div class="provider-box provider-openai">
                        <h4>OpenAI</h4>
                        <div>Calls: ${stats.byProvider.OpenAI.calls.toLocaleString()}</div>
                        <div>Tokens: ${stats.byProvider.OpenAI.tokensUsed.toLocaleString()}</div>
                        <div>Cost: $${stats.byProvider.OpenAI.estimatedCost.toFixed(4)}</div>
                    </div>
                    <div class="provider-box provider-deepseek">
                        <h4>DeepSeek</h4>
                        <div>Calls: ${stats.byProvider.DeepSeek.calls.toLocaleString()}</div>
                        <div>Tokens: ${stats.byProvider.DeepSeek.tokensUsed.toLocaleString()}</div>
                        <div>Cost: $${stats.byProvider.DeepSeek.estimatedCost.toFixed(4)}</div>
                    </div>
                </div>
            `;
            costDisplay.appendChild(summaryCard);
            
            // Create endpoint breakdown card
            if (stats.byEndpoint && Object.keys(stats.byEndpoint).length > 0) {
                const endpointCard = document.createElement('div');
                endpointCard.className = 'cost-card';
                
                let tableHTML = `
                    <h3>Cost by Endpoint</h3>
                    <table class="cost-table">
                        <thead>
                            <tr>
                                <th>Endpoint</th>
                                <th>Calls</th>
                                <th>Tokens</th>
                                <th>Cost</th>
                            </tr>
                        </thead>
                        <tbody>
                `;
                
                // Sort endpoints by cost (highest first)
                const endpoints = Object.entries(stats.byEndpoint)
                    .sort((a, b) => b[1].estimatedCost - a[1].estimatedCost);
                
                for (const [endpoint, data] of endpoints) {
                    tableHTML += `
                        <tr>
                            <td>${endpoint}</td>
                            <td>${data.calls.toLocaleString()}</td>
                            <td>${data.tokensUsed.toLocaleString()}</td>
                            <td>$${data.estimatedCost.toFixed(4)}</td>
                        </tr>
                    `;
                }
                
                tableHTML += `
                        </tbody>
                    </table>
                `;
                
                endpointCard.innerHTML = tableHTML;
                costDisplay.appendChild(endpointCard);
            }
            
            // Add note about cost calculation
            const noteCard = document.createElement('div');
            noteCard.className = 'cost-card';
            noteCard.innerHTML = `
                <h3>About Cost Calculation</h3>
                <p>These costs are estimates based on current API pricing:</p>
                <ul>
                    <li><strong>OpenAI (gpt-3.5-turbo):</strong> $0.0015 per 1K input tokens, $0.002 per 1K output tokens</li>
                    <li><strong>DeepSeek:</strong> $0.0005 per 1K tokens (both input and output)</li>
                </ul>
                <p>Actual costs may vary based on changes to provider pricing or special discounts.</p>
                <p><small>Data timestamp: ${data.timestamp || 'Unknown'}</small></p>
            `;
            costDisplay.appendChild(noteCard);
        }

        // Attach event to the refresh cost button
        const refreshCostBtn = document.getElementById('refreshCostBtn');
        if (refreshCostBtn) {
            refreshCostBtn.addEventListener('click', fetchApiCosts);
        }
        
        // Function to update the AI model
        async function updateAIModel() {
            const newModel = currentModel === 'OpenAI' ? 'DeepSeek' : 'OpenAI';
            
            // Disable the button and show loading state
            modelToggle.disabled = true;
            const originalText = modelToggle.textContent;
            modelToggle.innerHTML = '<span style="display:inline-block;animation:spin 1s linear infinite;">&#x21BB;</span> Switching...';
            
            try {
                console.log(`Attempting to switch to ${newModel}`);
                
                // Check if user is logged in
                const user = auth.currentUser;
                if (!user) {
                    console.log('User not logged in, redirecting to login page...');
                    // If not logged in, redirect to login page
                    localStorage.setItem('returnToPage', 'dev.html');
                    window.location.href = 'index.html';
                    return;
                }

                console.log('User logged in:', user.email);

                // Get the current Firebase token
                const firebaseToken = await user.getIdToken();
                if (!firebaseToken) {
                    throw new Error('Failed to get authentication token');
                }

                console.log('Sending request to update AI preference...');
                const response = await fetch(`${SERVER_URL}/updateAIPreference`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${firebaseToken}`
                    },
                    body: JSON.stringify({ provider: newModel })
                });

                const responseData = await response.json();
                console.log('Server response:', responseData);

                if (response.ok || response.status === 202) {
                    currentModel = newModel;
                    const modelName = newModel === 'OpenAI' ? 'gpt-3.5-turbo' : 'deepseek-chat';
                    modelToggle.textContent = `AI: ${newModel} (${modelName})`;
                    modelToggle.classList.toggle('active', newModel === 'DeepSeek');
                    console.log(`Successfully switched to ${newModel}`);
                    
                    // Show warning if preference might not persist
                    if (responseData.warning) {
                        console.warn('Warning from server:', responseData.warning);
                    }
                } else {
                    console.error('Failed to update AI model:', responseData);
                    
                    // If token is invalid, show login prompt
                    if (response.status === 401) {
                        console.log('Authentication failed, showing login prompt...');
                        showLoginPrompt();
                    }
                }
            } catch (error) {
                console.error('Error updating AI model:', error);
                
                // If no token or expired token, show login prompt
                if (error.message.includes('token') || error.message.includes('session')) {
                    console.log('Authentication error, showing login prompt...');
                    showLoginPrompt();
                }
            } finally {
                // Always restore button state
                if (modelToggle.textContent.includes('Switching')) {
                    modelToggle.textContent = originalText;
                }
                modelToggle.disabled = false;
            }
        }

        // Function to show login prompt
        function showLoginPrompt() {
            console.log('Showing login prompt');
            
            // Create login button
            const loginButton = document.createElement('button');
            loginButton.textContent = 'Log In';
            loginButton.className = 'nav-btn';
            loginButton.style.marginLeft = '10px';
            loginButton.onclick = () => {
                // Store current page to return to after login
                localStorage.setItem('returnToPage', 'dev.html');
                window.location.href = 'index.html';
            };
            
            // Add login button to the top-bar-center
            document.querySelector('.top-bar-center').appendChild(loginButton);
        }

        // Add click event listener for model toggle
        modelToggle.addEventListener('click', updateAIModel);

        // Check authentication state on page load
        onAuthStateChanged(auth, (user) => {
            console.log('Auth state changed:', user ? 'User logged in' : 'User logged out');
            if (user) {
                // User is signed in
                console.log('User is signed in:', user.email);
                modelToggle.disabled = false;
                // Remove login prompt if it exists
                const loginButton = document.querySelector('.nav-btn[onclick*="index.html"]');
                if (loginButton) {
                    loginButton.remove();
                }
            } else {
                // User is signed out
                console.log('User is signed out');
                modelToggle.disabled = true;
                showLoginPrompt();
            }
        });

        // Function to update server status indicator - with GitHub Pages friendly approach
        async function checkServerHealth() {
            // Simply return true as we now have retry logic for all server calls
            console.log('Server health check disabled - retry logic is active');
            return true;
        }

        // Function to fetch logs from GitHub repository
        async function fetchLogs() {
            const logDisplay = document.getElementById('logDisplay');
            logDisplay.textContent = 'Fetching logs...';
            
            try {
                // Use GitHub's API to get repository contents for the logs directory
                // Add proper headers for GitHub API
                const response = await fetch(`${GITHUB_API_BASE}/contents/logs/ai-interactions`, {
                    headers: {
                        'Accept': 'application/vnd.github.v3+json'
                    }
                });
                
                if (!response.ok) {
                    throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
                }
                
                const files = await response.json();
                
                // Check if we got a valid response
                if (!Array.isArray(files)) {
                    throw new Error('Invalid response from GitHub API');
                }
                
                // Filter for text log files and sort by name (reverse chronological)
                const logFiles = files
                    .filter(file => file.type === 'file' && file.name.endsWith('.txt'))
                    .sort((a, b) => b.name.localeCompare(a.name))
                    .slice(0, MAX_FILES_TO_LIST);  // Limit to MAX_FILES_TO_LIST most recent files
                    
                if (logFiles.length === 0) {
                    logDisplay.textContent = 'No log files found in the repository';
                    return;
                }
                
                // Store file metadata
                allLogFiles = logFiles.map(file => ({
                    name: file.name,
                    path: file.path,
                    sha: file.sha,
                    size: file.size,
                    download_url: file.download_url,
                    html_url: file.html_url
                }));
                
                // Update the display
                logDisplay.textContent = `Found ${allLogFiles.length} log files. Loading ${Math.min(MAX_FILES_TO_LOAD, allLogFiles.length)} most recent...`;
                
                // Load content for the first MAX_FILES_TO_LOAD files
                logs = [];
                const filesToLoad = allLogFiles.slice(0, MAX_FILES_TO_LOAD);
                
                for (const file of filesToLoad) {
                    try {
                        // Fetch individual file contents
                        const contentResponse = await fetch(file.download_url);
                        if (!contentResponse.ok) {
                            console.error(`Failed to fetch content for ${file.name}: ${contentResponse.status}`);
                            continue;
                        }
                        
                        const content = await contentResponse.text();
                        
                        // Extract timestamp from filename (format: YYYY-MM-DDThh-mm-ss-reply.txt)
                        let date = new Date();
                        const timestampMatch = file.name.match(/(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2})/);
                        if (timestampMatch) {
                            // Convert GitHub filename format to ISO format
                            const isoTimestamp = timestampMatch[1].replace(/-/g, (m, i) => i < 13 ? '-' : ':');
                            date = new Date(isoTimestamp);
                        }
                        
                        logs.push({
                            name: file.name,
                            path: file.path,
                            date: date,
                            content: content,
                            size: file.size,
                            html_url: file.html_url
                        });
                    } catch (error) {
                        console.error(`Error loading log file ${file.name}:`, error);
                    }
                }
                
                // Sort logs by date (newest first)
                logs.sort((a, b) => b.date - a.date);
                
                if (logs.length > 0) {
                    displayLog(0);
                } else {
                    logDisplay.textContent = 'Failed to load any log files. Please try again later.';
                }
                
            } catch (error) {
                console.error('Error fetching logs:', error);
                
                // Check if this is a CORS error
                if (error.message && error.message.includes('CORS')) {
                    logDisplay.innerHTML = 'Error fetching logs: CORS policy prevented access.<br><br>' +
                        'GitHub API access might be restricted when accessed from GitHub Pages. ' +
                        'Try accessing this page directly from your local development environment.';
                } else {
                    logDisplay.textContent = 'Error fetching logs: ' + error.message;
                }
            }
        }

        // Function to load more logs when needed
        async function loadMoreLogs(startIndex, count) {
            const logDisplay = document.getElementById('logDisplay');
            const loadingIndicator = document.createElement('div');
            loadingIndicator.className = 'loading-indicator';
            loadingIndicator.textContent = 'Loading more logs...';
            logDisplay.appendChild(loadingIndicator);
            
            try {
                // Get the next batch of files
                const endIndex = Math.min(startIndex + count, allLogFiles.length);
                const filesToLoad = allLogFiles.slice(startIndex, endIndex);
                
                if (filesToLoad.length === 0) {
                    return 0;
                }
                
                // Load each file's content
                const newLogs = [];
                for (const file of filesToLoad) {
                    try {
                        // Use the same headers as in fetchLogs
                        const contentResponse = await fetch(file.download_url, {
                            headers: {
                                'Accept': 'application/vnd.github.v3.raw'
                            }
                        });
                        
                        if (!contentResponse.ok) {
                            console.error(`Failed to fetch content for ${file.name}: ${contentResponse.status}`);
                            continue;
                        }
                        
                        const content = await contentResponse.text();
                        
                        // Extract timestamp from filename
                        let date = new Date();
                        const timestampMatch = file.name.match(/(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2})/);
                        if (timestampMatch) {
                            // Convert GitHub filename format to ISO format
                            const isoTimestamp = timestampMatch[1].replace(/-/g, (m, i) => i < 13 ? '-' : ':');
                            date = new Date(isoTimestamp);
                        }
                        
                        newLogs.push({
                            name: file.name,
                            path: file.path,
                            date: date,
                            content: content,
                            size: file.size,
                            html_url: file.html_url
                        });
                    } catch (error) {
                        console.error(`Error loading log file ${file.name}:`, error);
                    }
                }
                
                // Sort new logs by date
                newLogs.sort((a, b) => b.date - a.date);
                
                // Add the new logs to the existing array
                logs = [...logs, ...newLogs];
                
                // Resort all logs by date
                logs.sort((a, b) => b.date - a.date);
                
                // Update the status message
                const statusElements = document.getElementsByClassName('log-status-info');
                if (statusElements.length > 0) {
                    statusElements[0].textContent = `Loaded ${logs.length} of ${allLogFiles.length} available log files`;
                }
                
                return newLogs.length;
            } catch (error) {
                console.error('Error loading more logs:', error);
                return 0;
            } finally {
                // Remove loading indicator
                if (loadingIndicator.parentNode) {
                    loadingIndicator.parentNode.removeChild(loadingIndicator);
                }
            }
        }

        // Function to display a log at the specified index
        function displayLog(index) {
            const logDisplay = document.getElementById('logDisplay');
            if (logs.length > 0 && index >= 0 && index < logs.length) {
                currentLogIndex = index;
                
                // Clear previous content
                logDisplay.innerHTML = '';
                
                // Add navigation info
                const navInfo = document.createElement('div');
                navInfo.className = 'log-nav-info';
                navInfo.textContent = `Showing log ${index + 1} of ${logs.length}`;
                if (logs[index].name) {
                    navInfo.textContent += ` - ${logs[index].name}`;
                }
                if (logs[index].date) {
                    navInfo.textContent += ` (${logs[index].date.toLocaleString()})`;
                }
                logDisplay.appendChild(navInfo);
                
                // Add GitHub link
                if (logs[index].html_url) {
                    const githubLink = document.createElement('a');
                    githubLink.href = logs[index].html_url;
                    githubLink.target = '_blank';
                    githubLink.textContent = 'View on GitHub';
                    githubLink.className = 'github-link';
                    githubLink.style.display = 'inline-block';
                    githubLink.style.marginBottom = '10px';
                    logDisplay.appendChild(githubLink);
                }
                
                // Add status info if we have more logs available
                if (allLogFiles && allLogFiles.length > logs.length) {
                    const statusInfo = document.createElement('div');
                    statusInfo.className = 'log-status-info';
                    statusInfo.textContent = `Loaded ${logs.length} of ${allLogFiles.length} available log files`;
                    logDisplay.appendChild(statusInfo);
                }
                
                // Add log content
                const contentDiv = document.createElement('pre');
                contentDiv.className = 'log-content';
                contentDiv.textContent = logs[index].content;
                contentDiv.style.whiteSpace = 'pre-wrap';
                contentDiv.style.overflow = 'auto';
                contentDiv.style.maxHeight = 'calc(100vh - 200px)';
                contentDiv.style.padding = '10px';
                contentDiv.style.border = '1px solid #ddd';
                contentDiv.style.borderRadius = '4px';
                logDisplay.appendChild(contentDiv);
                
                // Load more logs if we're getting close to the end of what we've loaded
                if (allLogFiles && index >= logs.length - 2 && logs.length < allLogFiles.length) {
                    loadMoreLogs(logs.length, MAX_FILES_TO_LOAD);
                }
            } else if (logs.length === 0) {
                logDisplay.textContent = 'No logs available';
            } else {
                logDisplay.textContent = 'Invalid log index';
            }
        }

        // Handle tab navigation
        buttons.forEach(button => {
            button.addEventListener('click', () => {
                // Remove active class from all buttons and hide all content
                buttons.forEach(b => b.classList.remove('active'));
                contents.forEach(c => c.style.display = 'none');
                
                // Add active class to clicked button and show corresponding content
                button.classList.add('active');
                const contentId = button.getAttribute('data-content');
                const content = document.getElementById(contentId);
                if (content) {
                    content.style.display = 'block';
                    
                    // If it's the cost tab and we haven't loaded cost data yet, fetch it
                    if (contentId === 'costContent' && costData === null) {
                        fetchApiCosts();
                    }
                    
                    // If it's the logs tab, fetch logs
                    if (contentId === 'logsContent') {
                        fetchLogs();
                    }
                }
            });
        });
        
        // Initial setup - show the first tab
        if (buttons.length > 0) {
            buttons[0].click();
        }
        
        // Set up event listeners for log navigation
        const mostRecentBtn = document.getElementById('mostRecentBtn');
        const refreshBtn = document.getElementById('refreshBtn');
        const earlierBtn = document.getElementById('earlierBtn');
        const laterBtn = document.getElementById('laterBtn');
        const deleteAllLogsBtn = document.getElementById('deleteAllLogsBtn');
        
        if (mostRecentBtn) {
            mostRecentBtn.addEventListener('click', () => {
                currentLogIndex = 0;
                if (logs.length > 0) {
                    displayLog(currentLogIndex);
                } else {
                    fetchLogs();
                }
            });
        }

        if (refreshBtn) {
            refreshBtn.addEventListener('click', fetchLogs);
        }

        if (earlierBtn) {
            earlierBtn.addEventListener('click', async () => {
                if (currentLogIndex >= logs.length - 1) {
                    // If we're at the last log, try to load more logs
                    const currentCount = logs.length;
                    const additionalLogsCount = await loadMoreLogs(currentCount, MAX_FILES_TO_LOAD);
                    
                    if (additionalLogsCount > 0) {
                        displayLog(currentLogIndex + 1);
                    } else {
                        alert('No more logs available');
                    }
                } else {
                    displayLog(currentLogIndex + 1);
                }
            });
        }

        if (laterBtn) {
            laterBtn.addEventListener('click', () => {
                if (currentLogIndex > 0) {
                    displayLog(currentLogIndex - 1);
                } else {
                    alert('Already at the most recent log');
                }
            });
        }

        // Handle delete all logs button
        if (deleteAllLogsBtn) {
            deleteAllLogsBtn.addEventListener('click', async () => {
                if (!confirm('Are you sure you want to delete ALL log files? This action cannot be undone.')) {
                    return;
                }
                
                try {
                    // Get the current user
                    const user = auth.currentUser;
                    if (!user) {
                        alert('You must be logged in to delete logs');
                        return;
                    }
                    
                    // Get Firebase token
                    const token = await user.getIdToken();
                    
                    // Call the server endpoint to delete logs
                    const response = await fetch(`${SERVER_URL}/delete-all-logs`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${token}`
                        }
                    });
                    
                    const result = await response.json();
                    
                    if (result.success) {
                        alert(`Logs deleted successfully! ${result.message}`);
                        // Refresh the logs display
                        fetchLogs();
                    } else {
                        alert(`Failed to delete logs: ${result.message}`);
                    }
                } catch (error) {
                    console.error('Error deleting logs:', error);
                    alert(`Error deleting logs: ${error.message}`);
                }
            });
        }

    } catch (error) {
        console.error('Error in main script:', error);
        alert('An error occurred while initializing the page: ' + error.message);
    }
}); 