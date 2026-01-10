// Import Firebase instances from firebase-init.js
import { app, db, auth } from './firebase-init.js';
import { GoogleAuthProvider, signInWithPopup, onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import { getAnalytics } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-analytics.js';
// Updated imports to include collection and getDocs
import { doc, getDoc, collection, getDocs } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

// Fetch guidelines using modular Firestore API
// Removed top-level Firestore fetch; logic moved to syncClinicalIssues function

// Initialize Analytics (disabled in this environment to avoid 403 warnings)
let analytics; // getAnalytics(app) disabled

// Global variables
const SERVER_URL = 'https://clerky-uzni.onrender.com';
const GITHUB_API_BASE = 'https://api.github.com/repos/iannouvel/clerky';
const MAX_FILES_TO_LIST = 100; // Maximum number of files to list
const MAX_FILES_TO_LOAD = 5;  // Maximum number of files to actually load content for
// Track current model - default to DeepSeek to match server and main app
let currentModel = 'DeepSeek';
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

document.addEventListener('DOMContentLoaded', async function () {
    try {
        // Initialize Firebase first
        await initializeFirebase();

        const buttons = document.querySelectorAll('.nav-btn');
        const contents = document.querySelectorAll('.tab-content');

        // If the user is logged in, fetch their saved AI preference so dev tools
        // and the main app share the same provider and default to DeepSeek if unset
        const user = auth.currentUser;
        if (user) {
            try {
                const token = await user.getIdToken();
                const prefResponse = await fetch(`${SERVER_URL}/updateAIPreference`, {
                    method: 'GET',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                    }
                });

                if (prefResponse.ok) {
                    const prefData = await prefResponse.json();
                    if (prefData && prefData.provider) {
                        currentModel = prefData.provider;
                    }
                }
            } catch (prefError) {
                console.warn('Failed to load AI preference for dev tools, using default:', prefError);
            }
        }

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
                        console.log(`Retry attempt ${attempt}/${MAX_RETRIES} for cost data after ${RETRY_DELAYS[attempt - 1] / 1000} seconds...`);
                        statusMessage.textContent = `Retry ${attempt}/${MAX_RETRIES}...`;
                        await new Promise(resolve => setTimeout(resolve, RETRY_DELAYS[attempt - 1]));
                    }

                    console.log(`Fetching API cost data (attempt ${attempt + 1}/${MAX_RETRIES + 1})...`);
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
                    console.error(`Error fetching API cost data (attempt ${attempt + 1}/${MAX_RETRIES + 1}):`, error);

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

        // Tools panel toggle
        const toolsToggleBtn = document.getElementById('toolsToggleBtn');
        const toolsPanel = document.getElementById('toolsPanel');
        const toolsBackdrop = document.getElementById('toolsBackdrop');

        function openTools(open) {
            const shouldOpen = open ?? !toolsPanel.classList.contains('open');
            toolsPanel.classList.toggle('open', shouldOpen);
            toolsBackdrop.style.display = shouldOpen ? 'block' : 'none';
            toolsPanel.setAttribute('aria-hidden', shouldOpen ? 'false' : 'true');
            if (shouldOpen) {
                toolsToggleBtn.textContent = 'Tools ▾';
            } else {
                toolsToggleBtn.textContent = 'Tools ▸';
            }
        }

        if (toolsToggleBtn && toolsPanel && toolsBackdrop) {
            toolsToggleBtn.addEventListener('click', () => openTools());
            toolsBackdrop.addEventListener('click', () => openTools(false));
            document.addEventListener('keydown', (e) => {
                if (e.key === 'Escape' && toolsPanel.classList.contains('open')) {
                    openTools(false);
                }
            });
        }

        // Function to show login prompt
        function showLoginPrompt() {
            console.log('Showing login prompt');

            // Avoid adding multiple login buttons
            if (document.getElementById('devLoginBtn')) {
                // Also update discovery status if present
                const status = document.getElementById('discoveryStatus');
                if (status) status.textContent = 'Please sign in to scan for new guidance.';
                return;
            }

            // Create login button that signs in directly
            const loginButton = document.createElement('button');
            loginButton.id = 'devLoginBtn';
            loginButton.textContent = 'Sign in with Google';
            loginButton.className = 'nav-btn';
            loginButton.style.marginLeft = '10px';
            loginButton.addEventListener('click', async () => {
                try {
                    const provider = new GoogleAuthProvider();
                    await signInWithPopup(auth, provider);
                } catch (err) {
                    console.error('Sign-in failed:', err);
                    alert('Sign-in failed: ' + (err && err.message ? err.message : err));
                }
            });

            const topBarCenter = document.querySelector('.top-bar-center');
            if (topBarCenter) topBarCenter.appendChild(loginButton);

            // Surface inline hint in Discovery tab
            const status = document.getElementById('discoveryStatus');
            if (status) status.textContent = 'Please sign in to scan for new guidance.';
        }

        // Check authentication state on page load
        onAuthStateChanged(auth, (user) => {
            console.log('Auth state changed:', user ? 'User logged in' : 'User logged out');
            if (user) {
                // User is signed in
                console.log('User is signed in:', user.email);
                // Enable discovery scan
                const scanBtnEl = document.getElementById('scanGuidanceBtn');
                if (scanBtnEl) scanBtnEl.disabled = false;
                // Remove any inline login prompt
                const inlineLoginBtn = document.getElementById('devLoginBtn');
                if (inlineLoginBtn) inlineLoginBtn.remove();
                // Remove old login prompt if it exists
                const legacyLoginButton = document.querySelector('.nav-btn[onclick*="index.html"]');
                if (legacyLoginButton) legacyLoginButton.remove();
                // Clear discovery status hint
                const status = document.getElementById('discoveryStatus');
                if (status && status.textContent.includes('Please sign in')) status.textContent = '';
            } else {
                // User is signed out - redirect to login page
                console.log('User is signed out');
                try {
                    // Use sessionStorage so redirect intent is scoped to this tab only
                    sessionStorage.setItem('returnToPage', 'dev.html');
                    sessionStorage.setItem('returnAfterLogin', '1');
                } catch (_) { }
                window.location.href = 'index.html';
            }
        });

        // Function to update server status indicator - with GitHub Pages friendly approach
        async function checkServerHealth() {
            // Simply return true as we now have retry logic for all server calls
            console.log('Server health check disabled - retry logic is active');
            return true;
        }

        // Function to archive old logs if needed (silent operation)
        async function archiveLogsIfNeeded() {
            try {
                // Get the current user
                const user = auth.currentUser;
                if (!user) {
                    console.log('🔍 DEBUG: User not logged in, skipping log archiving');
                    return;
                }

                // Get Firebase token
                const token = await user.getIdToken();

                console.log('🔍 DEBUG: Checking if log archiving is needed...');

                // Call the server endpoint to archive logs if needed
                const response = await fetch(`${SERVER_URL}/admin/archive-logs-if-needed`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                    }
                });

                const result = await response.json();

                if (result.success) {
                    if (result.archivedFiles > 0) {
                        console.log(`🔍 DEBUG: Archived ${result.archivedFiles} old log files (${result.archivedGroups} groups)`);
                    } else {
                        console.log(`🔍 DEBUG: No archiving needed (${result.totalGroups} groups ≤ 100)`);
                    }
                } else {
                    console.warn('🔍 DEBUG: Log archiving failed:', result.message);
                }

            } catch (error) {
                // Fail silently - don't block log fetching if archiving fails
                console.warn('🔍 DEBUG: Log archiving error (continuing anyway):', error.message);
            }
        }

        // OPTIMISATION: Helper function to format optimized log data into readable content
        function formatOptimizedLog(logData) {
            if (!logData) return 'No log data available';

            let content = '';

            // Header with basic info
            content += `AI: ${logData.ai_provider || 'Unknown'} (${logData.ai_model || 'unknown'})\n\n`;

            // Interaction summary
            if (logData.type) {
                content += `Type: ${logData.type}\n`;
            }
            if (logData.endpoint) {
                content += `Endpoint: ${logData.endpoint}\n`;
            }

            // Token usage if available
            if (logData.token_usage) {
                content += `\nToken Usage:\n`;
                if (logData.token_usage.prompt_tokens) {
                    content += `  Prompt: ${logData.token_usage.prompt_tokens} tokens\n`;
                }
                if (logData.token_usage.completion_tokens) {
                    content += `  Response: ${logData.token_usage.completion_tokens} tokens\n`;
                }
                if (logData.token_usage.total_tokens) {
                    content += `  Total: ${logData.token_usage.total_tokens} tokens\n`;
                }
            }

            // Content summary
            content += `\nContent Summary:\n`;
            content += `  Prompt Length: ${logData.prompt_length || 0} chars\n`;
            content += `  Response Length: ${logData.response_length || 0} chars\n`;

            // Previews
            if (logData.prompt_preview) {
                content += `\nPrompt Preview:\n${logData.prompt_preview}\n`;
            }

            if (logData.response_preview) {
                content += `\nResponse Preview:\n${logData.response_preview}\n`;
            }

            // Full data for critical interactions
            if (logData.full_data) {
                content += `\n--- FULL DATA (Critical Interaction) ---\n`;
                content += JSON.stringify(logData.full_data, null, 2);
            }

            return content;
        }

        // Function to fetch logs from GitHub repository
        async function fetchLogs() {
            const logDisplay = document.getElementById('logDisplay');
            logDisplay.textContent = 'Fetching logs...';

            try {
                // Auto-archive old logs if needed (silent operation)
                await archiveLogsIfNeeded();

                logDisplay.textContent = 'Loading recent logs...';

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

                // DEBUG: Log raw GitHub API response
                console.log('🔍 DEBUG: GitHub API returned files:', files.length);
                console.log('🔍 DEBUG: First 10 files from API:', files.map(f => f.name).slice(0, 10));

                // Check if we got a valid response
                if (!Array.isArray(files)) {
                    throw new Error('Invalid response from GitHub API');
                }

                // OPTIMISATION: Filter for JSON log files (no more .txt files)
                const logFiles = files
                    .filter(file => file.type === 'file' && file.name.endsWith('.json'))
                    .sort((a, b) => b.name.localeCompare(a.name))
                    .slice(0, MAX_FILES_TO_LIST);  // Limit to MAX_FILES_TO_LIST most recent files

                // DEBUG: Log filtered and sorted results
                console.log('🔍 DEBUG: Filtered .txt files count:', logFiles.length);
                console.log('🔍 DEBUG: First 10 .txt files after sort:', logFiles.map(f => f.name).slice(0, 10));

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

                // DEBUG: Log files being loaded
                console.log('🔍 DEBUG: Loading content for files:', filesToLoad.map(f => f.name));

                for (const file of filesToLoad) {
                    try {
                        // Fetch individual file contents
                        const contentResponse = await fetch(file.download_url);
                        if (!contentResponse.ok) {
                            console.error(`Failed to fetch content for ${file.name}: ${contentResponse.status}`);
                            continue;
                        }

                        // OPTIMISATION: Parse JSON content for optimized logs
                        const jsonContent = await contentResponse.json();

                        // Create readable content from optimized log format
                        const readableContent = formatOptimizedLog(jsonContent);

                        // Extract timestamp from filename (format: YYYY-MM-DDThh-mm-ss-reply.json)
                        let date = new Date();
                        const timestampMatch = file.name.match(/(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2})/);
                        if (timestampMatch) {
                            // Convert GitHub filename format to ISO format
                            const isoTimestamp = timestampMatch[1].replace(/-/g, (m, i) => i < 13 ? '-' : ':');
                            date = new Date(isoTimestamp);
                        }

                        // DEBUG: Log date parsing for each file
                        console.log('🔍 DEBUG: File:', file.name, '| Parsed date:', date.toISOString(), '| Timestamp match:', timestampMatch?.[1]);

                        logs.push({
                            name: file.name,
                            path: file.path,
                            date: date,
                            content: readableContent,
                            rawData: jsonContent,
                            size: file.size,
                            html_url: file.html_url
                        });
                    } catch (error) {
                        console.error(`Error loading log file ${file.name}:`, error);
                    }
                }

                // Sort logs by date (newest first)
                logs.sort((a, b) => b.date - a.date);

                // DEBUG: Log final sorted logs
                console.log('🔍 DEBUG: Final logs sorted by date (newest first):');
                logs.slice(0, 5).forEach((log, i) => {
                    console.log(`  ${i + 1}. ${log.name} | ${log.date.toISOString()}`);
                });

                if (logs.length > 0) {
                    console.log('🔍 DEBUG: Displaying log at index 0:', logs[0].name);
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

        // ===============================================
        // NEW LOGS FUNCTIONALITY (Firestore-based)
        // ===============================================

        let recentLogs = []; // Store fetched logs
        let selectedLogId = null; // Currently selected log ID

        // Fetch recent AI logs from Firestore via the new endpoint
        async function fetchRecentLogs() {
            const tableBody = document.getElementById('logsTableBody');
            const detailContent = document.getElementById('logsDetailContent');
            const detailTitle = document.getElementById('logsDetailTitle');

            if (!tableBody) return;

            tableBody.innerHTML = '<tr><td colspan="6" class="logs-empty">Loading logs...</td></tr>';

            try {
                const user = auth.currentUser;
                if (!user) {
                    tableBody.innerHTML = '<tr><td colspan="6" class="logs-empty">Please log in to view logs</td></tr>';
                    return;
                }

                const token = await user.getIdToken();

                // Get filter values
                const timeRange = document.getElementById('logsTimeRange')?.value || '1h';
                const endpoint = document.getElementById('logsEndpointFilter')?.value || 'all';
                const provider = document.getElementById('logsProviderFilter')?.value || 'all';
                const successOnly = document.getElementById('logsStatusFilter')?.value || 'all';
                const search = document.getElementById('logsSearchInput')?.value || '';

                const params = new URLSearchParams({
                    limit: 100,
                    timeRange,
                    ...(endpoint !== 'all' && { endpoint }),
                    ...(provider !== 'all' && { provider }),
                    ...(successOnly !== 'all' && { successOnly }),
                    ...(search && { search })
                });

                const response = await fetch(`${SERVER_URL}/getRecentAILogs?${params}`, {
                    headers: {
                        'Authorization': `Bearer ${token}`
                    }
                });

                if (!response.ok) {
                    throw new Error(`Server error: ${response.status}`);
                }

                const data = await response.json();

                if (!data.success) {
                    throw new Error(data.message || 'Failed to fetch logs');
                }

                recentLogs = data.logs || [];

                // Update filter dropdowns with available options
                updateLogsFilterDropdowns(data.filters);

                // Render the table
                renderLogsTable();

                // Clear detail panel
                selectedLogId = null;
                if (detailTitle) detailTitle.textContent = 'Select a log entry to view details';
                if (detailContent) detailContent.innerHTML = '<div class="logs-empty">Click on a row in the table above to view the full prompt and response.</div>';

            } catch (error) {
                console.error('Error fetching recent logs:', error);
                tableBody.innerHTML = `<tr><td colspan="6" class="logs-empty">Error: ${error.message}</td></tr>`;
            }
        }

        // Update filter dropdowns with available values
        function updateLogsFilterDropdowns(filters) {
            const endpointSelect = document.getElementById('logsEndpointFilter');
            const providerSelect = document.getElementById('logsProviderFilter');

            if (endpointSelect && filters?.endpoints) {
                const currentValue = endpointSelect.value;
                endpointSelect.innerHTML = '<option value="all">All Endpoints</option>';
                filters.endpoints.forEach(ep => {
                    const opt = document.createElement('option');
                    opt.value = ep;
                    opt.textContent = ep;
                    endpointSelect.appendChild(opt);
                });
                endpointSelect.value = currentValue || 'all';
            }

            if (providerSelect && filters?.providers) {
                const currentValue = providerSelect.value;
                providerSelect.innerHTML = '<option value="all">All Providers</option>';
                filters.providers.forEach(prov => {
                    const opt = document.createElement('option');
                    opt.value = prov;
                    opt.textContent = prov;
                    providerSelect.appendChild(opt);
                });
                providerSelect.value = currentValue || 'all';
            }
        }

        // Render the logs table
        function renderLogsTable() {
            const tableBody = document.getElementById('logsTableBody');
            if (!tableBody) return;

            if (recentLogs.length === 0) {
                tableBody.innerHTML = '<tr><td colspan="6" class="logs-empty">No logs found for the selected filters</td></tr>';
                return;
            }

            tableBody.innerHTML = recentLogs.map(log => {
                const time = log.timestamp ? new Date(log.timestamp).toLocaleTimeString() : 'N/A';
                const statusClass = log.success ? 'status-success' : 'status-error';
                const statusIcon = log.success ? '✓' : '✗';

                return `
                    <tr data-log-id="${log.id}" class="${log.id === selectedLogId ? 'selected' : ''}">
                        <td>${time}</td>
                        <td title="${log.endpoint || ''}">${(log.endpoint || 'N/A').substring(0, 25)}${(log.endpoint?.length || 0) > 25 ? '...' : ''}</td>
                        <td>${log.provider || 'N/A'}</td>
                        <td>${log.totalTokens || 0}</td>
                        <td>${log.latencyMs ? log.latencyMs + 'ms' : 'N/A'}</td>
                        <td class="${statusClass}">${statusIcon}</td>
                    </tr>
                `;
            }).join('');

            // Add click handlers to rows
            tableBody.querySelectorAll('tr[data-log-id]').forEach(row => {
                row.addEventListener('click', () => {
                    const logId = row.getAttribute('data-log-id');
                    selectLogEntry(logId);

                    // Update row selection visuals
                    tableBody.querySelectorAll('tr').forEach(r => r.classList.remove('selected'));
                    row.classList.add('selected');
                });
            });
        }

        // Show details for a selected log entry
        function selectLogEntry(logId) {
            const log = recentLogs.find(l => l.id === logId);
            if (!log) return;

            selectedLogId = logId;

            const detailTitle = document.getElementById('logsDetailTitle');
            const detailContent = document.getElementById('logsDetailContent');

            if (detailTitle) {
                const time = log.timestamp ? new Date(log.timestamp).toLocaleString() : 'Unknown time';
                detailTitle.textContent = `${log.endpoint || 'Unknown'} - ${time}`;
            }

            if (detailContent) {
                const statusClass = log.success ? 'success' : 'error';
                const statusText = log.success ? 'Success' : (log.errorMessage || 'Error');

                detailContent.innerHTML = `
                    <div class="logs-meta">
                        <span><span class="label">Provider:</span> ${log.provider || 'N/A'}</span>
                        <span><span class="label">Model:</span> ${log.model || 'N/A'}</span>
                        <span><span class="label">Tokens:</span> ${log.promptTokens || 0} in / ${log.completionTokens || 0} out (${log.totalTokens || 0} total)</span>
                        <span><span class="label">Latency:</span> ${log.latencyMs ? log.latencyMs + 'ms' : 'N/A'}</span>
                        <span><span class="label">Cost:</span> $${(log.estimatedCostUsd || 0).toFixed(6)}</span>
                        <span><span class="logs-status ${statusClass}">${statusText}</span></span>
                        ${log.fallbackFrom ? `<span><span class="label">Fallback from:</span> ${log.fallbackFrom}</span>` : ''}
                    </div>
                    
                    <div class="logs-detail-section">
                        <h4>Prompt (${log.promptLength || 0} chars)</h4>
                        <div class="logs-formatted-content">${formatLogContent(log.fullPrompt, 'prompt')}</div>
                    </div>
                    
                    <div class="logs-detail-section">
                        <h4>Response (${log.responseLength || 0} chars)</h4>
                        <div class="logs-formatted-content">${formatLogContent(log.fullResponse || (log.success ? '' : log.errorMessage), 'response')}</div>
                    </div>
                `;
            }
        }

        // Helper to escape HTML
        function escapeHtml(text) {
            if (!text) return '';
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }

        // Format log content for display (handles JSON messages and plain text)
        function formatLogContent(text, type = 'prompt') {
            if (!text) return '<span style="color:#999;font-style:italic;">No content available</span>';

            try {
                // Try to parse as JSON (OpenAI message format)
                const parsed = JSON.parse(text);

                if (Array.isArray(parsed)) {
                    // Array of messages (e.g., [{"role":"user","content":"..."}])
                    return parsed.map((msg, idx) => {
                        const role = msg.role || 'unknown';
                        const content = msg.content || '';
                        const roleColor = role === 'system' ? '#6c757d' : role === 'user' ? '#007bff' : role === 'assistant' ? '#28a745' : '#333';
                        const roleLabel = role.charAt(0).toUpperCase() + role.slice(1);

                        return `<div style="margin-bottom:${idx < parsed.length - 1 ? '16px' : '0'};">
                            <div style="font-weight:600;color:${roleColor};margin-bottom:6px;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;">${escapeHtml(roleLabel)}</div>
                            <div style="white-space:pre-wrap;line-height:1.6;color:#333;">${escapeHtml(content)}</div>
                        </div>`;
                    }).join('');
                } else if (typeof parsed === 'object') {
                    // Single message object
                    if (parsed.content) {
                        return `<div style="white-space:pre-wrap;line-height:1.6;color:#333;">${escapeHtml(parsed.content)}</div>`;
                    }
                    // Generic object - pretty print
                    return `<div style="white-space:pre-wrap;line-height:1.5;color:#333;">${escapeHtml(JSON.stringify(parsed, null, 2))}</div>`;
                }
            } catch (e) {
                // Not valid JSON - treat as plain text
            }

            // Plain text - just format with proper line breaks
            return `<div style="white-space:pre-wrap;line-height:1.6;color:#333;">${escapeHtml(text)}</div>`;
        }

        // Set up logs UI event listeners
        function initLogsUI() {
            const refreshBtn = document.getElementById('refreshLogsBtn');
            const timeRangeSelect = document.getElementById('logsTimeRange');
            const endpointFilter = document.getElementById('logsEndpointFilter');
            const providerFilter = document.getElementById('logsProviderFilter');
            const statusFilter = document.getElementById('logsStatusFilter');
            const searchInput = document.getElementById('logsSearchInput');

            if (refreshBtn) {
                refreshBtn.addEventListener('click', fetchRecentLogs);
            }

            // Auto-refresh on filter changes
            [timeRangeSelect, endpointFilter, providerFilter, statusFilter].forEach(el => {
                if (el) {
                    el.addEventListener('change', fetchRecentLogs);
                }
            });

            // Debounced search
            let searchTimeout;
            if (searchInput) {
                searchInput.addEventListener('input', () => {
                    clearTimeout(searchTimeout);
                    searchTimeout = setTimeout(fetchRecentLogs, 500);
                });
            }

            // Copy All button
            const copyAllBtn = document.getElementById('copyAllLogsBtn');
            if (copyAllBtn) {
                copyAllBtn.addEventListener('click', copyAllLogs);
            }
        }

        // Copy all logs to clipboard as formatted text
        async function copyAllLogs() {
            if (!recentLogs || recentLogs.length === 0) {
                alert('No logs to copy. Click Refresh to load logs first.');
                return;
            }

            const formattedLogs = recentLogs.map((log, idx) => {
                const time = log.timestamp ? new Date(log.timestamp).toLocaleString() : 'Unknown time';
                const divider = '='.repeat(80);

                // Parse prompt content if it's JSON
                let promptText = log.fullPrompt || 'No prompt content';
                try {
                    const parsed = JSON.parse(promptText);
                    if (Array.isArray(parsed)) {
                        promptText = parsed.map(msg => {
                            const role = (msg.role || 'unknown').toUpperCase();
                            return `[${role}]\n${msg.content || ''}`;
                        }).join('\n\n');
                    }
                } catch (e) {
                    // Keep as-is if not valid JSON
                }

                // Response text
                let responseText = log.fullResponse || (log.success ? 'No response content' : (log.errorMessage || 'Error'));

                return `${divider}
LOG ${idx + 1} of ${recentLogs.length}
${divider}
Time: ${time}
Endpoint: ${log.endpoint || 'Unknown'}
Provider: ${log.provider || 'N/A'}
Model: ${log.model || 'N/A'}
Tokens: ${log.promptTokens || 0} in / ${log.completionTokens || 0} out (${log.totalTokens || 0} total)
Latency: ${log.latencyMs ? log.latencyMs + 'ms' : 'N/A'}
Cost: $${(log.estimatedCostUsd || 0).toFixed(6)}
Status: ${log.success ? 'Success' : 'Error'}

--- PROMPT ---
${promptText}

--- RESPONSE ---
${responseText}
`;
            }).join('\n\n');

            try {
                await navigator.clipboard.writeText(formattedLogs);
                const copyBtn = document.getElementById('copyAllLogsBtn');
                if (copyBtn) {
                    const originalText = copyBtn.textContent;
                    copyBtn.textContent = '✅ Copied!';
                    setTimeout(() => {
                        copyBtn.textContent = originalText;
                    }, 2000);
                }
            } catch (err) {
                console.error('Failed to copy:', err);
                alert('Failed to copy to clipboard. Please try again.');
            }
        }

        // Initialize logs UI when DOM is ready
        initLogsUI();

        // ---- Guideline Discovery Client Logic ----

        // URL domain validation for client-side safety check
        const ORGANIZATION_DOMAINS = {
            'RCOG': ['rcog.org.uk'],
            'NICE': ['nice.org.uk'],
            'FSRH': ['fsrh.org'],
            'BASHH': ['bashh.org', 'bashhguidelines.org'],
            'BMS': ['thebms.org.uk'],
            'BSH': ['b-s-h.org.uk'],
            'BHIVA': ['bhiva.org'],
            'BAPM': ['bapm.org'],
            'UK NSC': ['gov.uk'],
            'NHS England': ['england.nhs.uk'],
            'BSGE': ['bsge.org.uk'],
            'BSUG': ['bsug.org'],
            'BGCS': ['bgcs.org.uk'],
            'BSCCP': ['bsccp.org.uk'],
            'BFS': ['britishfertilitysociety.org.uk'],
            'BMFMS': ['bmfms.org.uk'],
            'BritSPAG': ['britspag.org']
        };

        function validateGuidelineUrl(url, organization) {
            if (!url || !organization) return true; // Allow if no organization specified
            const expectedDomains = ORGANIZATION_DOMAINS[organization];
            if (!expectedDomains) return true; // Allow unknown organizations

            try {
                const urlObj = new URL(url);
                const hostname = urlObj.hostname.toLowerCase();
                return expectedDomains.some(domain =>
                    hostname === domain || hostname.endsWith('.' + domain)
                );
            } catch (e) {
                return false; // Invalid URL format
            }
        }

        async function getAuthTokenOrPrompt() {
            const user = auth.currentUser;
            if (!user) {
                showLoginPrompt();
                throw new Error('Not authenticated');
            }
            return user.getIdToken();
        }

        // Load user preferences (included/excluded canonicalIds and excluded URLs)
        let userPrefs = { includedCanonicalIds: [], excludedCanonicalIds: [], excludedSourceUrls: [] };
        async function loadUserPrefs() {
            try {
                const token = await getAuthTokenOrPrompt();
                const res = await fetch(`${SERVER_URL}/userGuidelinePrefs`, {
                    method: 'GET',
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                const data = await res.json();
                if (data.success) {
                    userPrefs = {
                        includedCanonicalIds: data.includedCanonicalIds || [],
                        excludedCanonicalIds: data.excludedCanonicalIds || [],
                        excludedSourceUrls: data.excludedSourceUrls || []
                    };
                }
            } catch (_) { }
        }

        function renderDiscoveryResults(items) {
            const container = document.getElementById('discoveryResults');
            container.innerHTML = '';
            if (!items || items.length === 0) {
                container.innerHTML = '<div style="color:#666">No suggestions found.</div>';
                return;
            }
            // Filter client-side using user preferences (URLs)
            const excludedUrlSet = new Set((userPrefs.excludedSourceUrls || []).map(u => u.toLowerCase()));
            const filtered = items.filter(i => i.url && !excludedUrlSet.has(i.url.toLowerCase()));
            if (filtered.length === 0) {
                container.innerHTML = '<div style="color:#666">All suggestions are excluded.</div>';
                return;
            }
            filtered.forEach(item => {
                const row = document.createElement('div');
                row.style.padding = '8px';
                row.style.marginBottom = '8px';
                row.style.background = '#fff';
                row.style.border = '1px solid #e5e7eb';
                row.style.borderRadius = '6px';
                row.style.transition = 'opacity 0.4s ease, max-height 0.4s ease, margin 0.4s ease, padding 0.4s ease';
                row.style.overflow = 'hidden';
                row.dataset.discoveryUrl = (item.url || '').toLowerCase();

                // Create organization badge with color
                const orgBadge = item.organisation ?
                    `<span style="display:inline-block;background:#0066cc;color:white;padding:2px 6px;border-radius:3px;font-size:11px;font-weight:600;margin-right:6px">${item.organisation}</span>` : '';
                const metaInfo = [item.type, item.year].filter(Boolean).join(' • ');

                // Validate URL matches expected domain
                const isValidUrl = validateGuidelineUrl(item.url, item.organisation);
                const urlWarning = !isValidUrl ?
                    `<div style="background:#fff3cd;border:1px solid #ffc107;padding:4px 6px;border-radius:3px;font-size:11px;margin:4px 0">⚠️ URL domain does not match expected domain for ${item.organisation}</div>` : '';

                row.innerHTML = `
                    <div style="font-weight:600;margin-bottom:4px">${item.title || 'Untitled'}</div>
                    <div style="font-size:12px;color:#555;margin:4px 0">${orgBadge}${metaInfo}</div>
                    ${urlWarning}
                    <div style="font-size:12px;color:#006;word-break:break-all">${item.url}</div>
                `;
                const actions = document.createElement('div');
                actions.style.marginTop = '6px';

                const openBtn = document.createElement('button');
                openBtn.className = 'dev-btn';
                openBtn.textContent = 'Open';
                openBtn.onclick = async () => {
                    try {
                        const token = await getAuthTokenOrPrompt();
                        const previewUrl = `${SERVER_URL}/proxyGuidelineView?url=${encodeURIComponent(item.url)}&id_token=${encodeURIComponent(token)}`;
                        const frame = document.getElementById('guidelinePreview');
                        if (frame) frame.src = previewUrl;
                    } catch (e) {
                        window.open(item.url, '_blank');
                    }
                };

                const includeBtn = document.createElement('button');
                includeBtn.className = 'dev-btn';
                includeBtn.style.marginLeft = '6px';
                includeBtn.textContent = 'Include';
                includeBtn.onclick = async () => {
                    includeBtn.disabled = true;
                    excludeBtn.disabled = true;
                    try {
                        await includeGuidance(item);
                        removeDiscoveryItemByUrl(item.url, 'Included and saved.');
                    } finally {
                        // buttons will be irrelevant after removal; re-enable just in case
                        includeBtn.disabled = false;
                        excludeBtn.disabled = false;
                    }
                };

                const excludeBtn = document.createElement('button');
                excludeBtn.className = 'dev-btn';
                excludeBtn.style.marginLeft = '6px';
                excludeBtn.textContent = 'Exclude';
                excludeBtn.onclick = async () => {
                    includeBtn.disabled = true;
                    excludeBtn.disabled = true;
                    try {
                        await excludeGuidance(item);
                        removeDiscoveryItemByUrl(item.url, 'Excluded.');
                    } finally {
                        includeBtn.disabled = false;
                        excludeBtn.disabled = false;
                    }
                };

                actions.appendChild(openBtn);
                actions.appendChild(includeBtn);
                actions.appendChild(excludeBtn);
                row.appendChild(actions);
                container.appendChild(row);
            });
        }

        function removeDiscoveryItemByUrl(url, statusMessage) {
            const container = document.getElementById('discoveryResults');
            const status = document.getElementById('discoveryStatus');
            if (status && statusMessage) {
                status.style.color = '#155724';
                status.style.background = '#d4edda';
                status.style.border = '1px solid #c3e6cb';
                status.style.padding = '6px 8px';
                status.style.borderRadius = '4px';
                status.textContent = statusMessage;
                setTimeout(() => {
                    status.textContent = '';
                    status.removeAttribute('style');
                }, 2500);
            }
            if (!container) return;
            const target = container.querySelector(`[data-discovery-url="${(url || '').toLowerCase()}"]`);
            if (!target) return;
            // Smooth collapse and fade
            target.style.maxHeight = `${target.scrollHeight}px`;
            requestAnimationFrame(() => {
                target.style.opacity = '0';
                target.style.maxHeight = '0';
                target.style.margin = '0';
                target.style.paddingTop = '0';
                target.style.paddingBottom = '0';
            });
            setTimeout(() => {
                if (target && target.parentNode) target.parentNode.removeChild(target);
                // If list becomes empty, show placeholder
                if (!container.children.length) {
                    container.innerHTML = '<div style="color:#666">No suggestions found.</div>';
                }
            }, 450);
        }

        async function fetchExclusions() {
            // Prefer new prefs endpoint; show excluded URLs list
            await loadUserPrefs();
            const items = (userPrefs.excludedSourceUrls || []).map(u => ({ url: u, reason: 'excluded' }));
            return items;
        }

        function renderExclusions(items) {
            const panel = document.getElementById('exclusionsPanel');
            panel.innerHTML = '';
            if (!items || items.length === 0) {
                panel.innerHTML = '<div style="color:#666">No exclusions recorded.</div>';
                return;
            }
            items.forEach(e => {
                const row = document.createElement('div');
                row.style.padding = '6px';
                row.style.borderBottom = '1px solid #eee';
                row.innerHTML = `
                    <div style="font-size:12px;color:#006;word-break:break-all">${e.url}</div>
                    <div style="font-size:11px;color:#777">${e.reason || 'excluded'}</div>
                `;
                panel.appendChild(row);
            });
        }

        async function excludeGuidance(item) {
            const status = document.getElementById('discoveryStatus');
            status.textContent = 'Excluding...';
            try {
                const token = await getAuthTokenOrPrompt();
                const res = await fetch(`${SERVER_URL}/userGuidelinePrefs/update`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                    },
                    body: JSON.stringify({ url: item.url, status: 'excluded', reason: 'user_excluded' })
                });
                const data = await res.json();
                if (!data.success) throw new Error(data.error || 'Failed to exclude');
                status.textContent = 'Excluded.';
            } catch (err) {
                console.error(err);
                // Check if authentication error
                const isAuthError = err.message && (
                    err.message.includes('Not authenticated') ||
                    err.message.includes('auth/') ||
                    err.message.includes('Firebase') ||
                    err.message.includes('token')
                );
                if (isAuthError) {
                    status.textContent = '🔒 Please sign in to exclude guidelines';
                    status.style.color = '#0066cc';
                    showLoginPrompt();
                } else {
                    status.textContent = `Exclude failed: ${err.message}`;
                }
                throw err;
            }
        }

        async function includeGuidance(item) {
            const status = document.getElementById('discoveryStatus');
            status.textContent = 'Including...';
            try {
                // 1) Build filename
                const urlObj = new URL(item.url);
                const lastSegment = urlObj.pathname.split('/').filter(Boolean).pop() || 'guideline.pdf';
                const ext = lastSegment.toLowerCase().endsWith('.pdf') ? '' : '.pdf';
                const base = (item.organisation ? `${item.organisation} - ` : '') +
                    (item.year ? `${item.year} - ` : '') +
                    (item.title || lastSegment.replace(/\.pdf$/i, ''));
                const safe = base.replace(/[\\\/:*?"<>|]+/g, ' ').trim();
                const filename = `${safe}${ext || ''}`.replace(/\s+/g, ' ').trim() || lastSegment;
                // 2) Server-side import to avoid CORS
                const token = await getAuthTokenOrPrompt();
                const importRes = await fetch(`${SERVER_URL}/importGuidelineFromUrl`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                    },
                    body: JSON.stringify({ url: item.url, filename, markIncluded: true })
                });
                const importData = await importRes.json();
                if (!importRes.ok || !importData.success) throw new Error(importData.error || 'Import failed');
                status.textContent = 'Included and saved.';
            } catch (err) {
                console.error(err);
                // Check if authentication error
                const isAuthError = err.message && (
                    err.message.includes('Not authenticated') ||
                    err.message.includes('auth/') ||
                    err.message.includes('Firebase') ||
                    err.message.includes('token')
                );
                if (isAuthError) {
                    status.textContent = '🔒 Please sign in to include guidelines';
                    status.style.color = '#0066cc';
                    showLoginPrompt();
                } else {
                    status.textContent = `Include failed: ${err.message}`;
                }
                throw err;
            }
        }

        async function runDiscovery() {
            const status = document.getElementById('discoveryStatus');
            const resultsContainer = document.getElementById('discoveryResults');

            // Show progress indicator
            status.textContent = '🔍 Scanning all organizations for new guidance...';
            status.style.color = '#0066cc';
            status.style.fontWeight = '600';
            resultsContainer.innerHTML = '<div style="text-align:center;padding:20px;color:#666">Please wait while AI searches RCOG, NICE, FSRH, BASHH, BMS, BSH, BHIVA, BAPM, UK NSC, NHS England, and subspecialty societies...</div>';

            try {
                await loadUserPrefs();
                const token = await getAuthTokenOrPrompt();
                const res = await fetch(`${SERVER_URL}/discoverGuidelines`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                    },
                    body: JSON.stringify({})
                });
                const data = await res.json();
                if (!data.success) throw new Error(data.error || 'Discovery failed');

                const suggestions = data.suggestions || [];
                renderDiscoveryResults(suggestions);

                // Count by organization
                const orgCounts = {};
                suggestions.forEach(item => {
                    const org = item.organisation || 'Unknown';
                    orgCounts[org] = (orgCounts[org] || 0) + 1;
                });

                // Build detailed status message
                let statusMsg = `✅ Found ${suggestions.length} suggestion${suggestions.length !== 1 ? 's' : ''}`;
                if (Object.keys(orgCounts).length > 0) {
                    const orgSummary = Object.entries(orgCounts)
                        .sort((a, b) => b[1] - a[1])
                        .map(([org, count]) => `${org}: ${count}`)
                        .join(', ');
                    statusMsg += ` (${orgSummary})`;
                }

                status.textContent = statusMsg;
                status.style.color = '#155724';
                status.style.fontWeight = 'normal';
            } catch (err) {
                console.error(err);

                // Check if this is an authentication error
                const isAuthError = err.message && (
                    err.message.includes('Not authenticated') ||
                    err.message.includes('auth/') ||
                    err.message.includes('Firebase') ||
                    err.message.includes('token') ||
                    err.message.includes('securetoken')
                );

                if (isAuthError) {
                    // Show friendly login prompt instead of error
                    status.textContent = '🔒 Please sign in to scan for new guidance';
                    status.style.color = '#0066cc';
                    status.style.fontWeight = 'normal';
                    resultsContainer.innerHTML = '<div style="text-align:center;padding:20px;color:#666">You need to be signed in to use the guideline discovery feature. Please click the "Sign in with Google" button above.</div>';
                    showLoginPrompt();
                } else {
                    // Show error for non-auth issues
                    status.textContent = `❌ Discovery failed: ${err.message}`;
                    status.style.color = '#d9534f';
                    status.style.fontWeight = 'normal';
                    resultsContainer.innerHTML = '<div style="text-align:center;padding:20px;color:#d9534f">Discovery failed. Please try again.</div>';
                }
            }
        }

        const scanBtn = document.getElementById('scanGuidanceBtn');
        if (scanBtn) scanBtn.addEventListener('click', runDiscovery);

        const viewExclusionsBtn = document.getElementById('viewExclusionsBtn');
        if (viewExclusionsBtn) viewExclusionsBtn.addEventListener('click', async () => {
            const panel = document.getElementById('exclusionsPanel');
            const visible = panel.style.display !== 'none';
            if (visible) {
                panel.style.display = 'none';
                return;
            }
            try {
                const items = await fetchExclusions();
                renderExclusions(items);
                panel.style.display = 'block';
            } catch (err) {
                panel.innerHTML = `<div style="color:#a00">${err.message}</div>`;
                panel.style.display = 'block';
            }
        });


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

                    // If it's the logs tab, fetch logs from Firestore
                    if (contentId === 'logsContent') {
                        fetchRecentLogs();
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

        // Handle delete all summaries button
        const deleteAllSummariesBtn = document.getElementById('deleteAllSummariesBtn');
        if (deleteAllSummariesBtn) {
            deleteAllSummariesBtn.addEventListener('click', async () => {
                if (!confirm('Are you sure you want to delete ALL summaries from Firestore? This action cannot be undone.')) {
                    return;
                }

                try {
                    // Get the current user
                    const user = auth.currentUser;
                    if (!user) {
                        alert('You must be logged in to delete summaries');
                        return;
                    }

                    // Get Firebase token
                    const token = await user.getIdToken();

                    // Call the server endpoint to delete summaries
                    const response = await fetch(`${SERVER_URL}/deleteAllSummaries`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${token}`
                        }
                    });

                    const result = await response.json();

                    if (result.success) {
                        alert(`Successfully deleted ${result.count} summaries from Firestore!`);
                    } else {
                        alert(`Failed to delete summaries: ${result.message}`);
                    }
                } catch (error) {
                    console.error('Error deleting summaries:', error);
                    alert(`Error deleting summaries: ${error.message}`);
                }
            });
        }

        // Handle delete all guideline data button
        const deleteAllGuidelineDataBtn = document.getElementById('deleteAllGuidelineDataBtn');
        if (deleteAllGuidelineDataBtn) {
            deleteAllGuidelineDataBtn.addEventListener('click', async () => {
                if (!confirm('Are you sure you want to delete ALL guideline data from Firestore? This will delete all guidelines, summaries, keywords, and condensed versions. This action cannot be undone.')) {
                    return;
                }

                try {
                    // Get the current user
                    const user = auth.currentUser;
                    if (!user) {
                        alert('You must be logged in to delete guideline data');
                        return;
                    }

                    // Get Firebase token
                    const token = await user.getIdToken();

                    // Call the server endpoint to delete all guideline data
                    const response = await fetch(`${SERVER_URL}/deleteAllGuidelineData`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${token}`
                        }
                    });

                    const result = await response.json();

                    if (result.success) {
                        let message = `Successfully deleted ${result.totalDeleted} documents from Firestore!\n\n`;
                        message += 'Breakdown by collection:\n';
                        for (const [collection, count] of Object.entries(result.results)) {
                            message += `${collection}: ${count} documents\n`;
                        }
                        alert(message);
                    } else {
                        alert(`Failed to delete guideline data: ${result.message}`);
                    }
                } catch (error) {
                    console.error('Error deleting guideline data:', error);
                    alert(`Error deleting guideline data: ${error.message}`);
                }
            });
        }

        // Handle PDF upload to Firebase Storage button
        const uploadPDFsToStorageBtn = document.getElementById('uploadPDFsToStorageBtn');
        if (uploadPDFsToStorageBtn) {
            uploadPDFsToStorageBtn.addEventListener('click', async () => {
                if (!confirm('Are you sure you want to upload all PDFs from GitHub to Firebase Storage? This will download all PDF files from the GitHub repository and upload them to Firebase Storage for faster access. This may take several minutes.')) {
                    return;
                }

                try {
                    // Update button state
                    const originalText = uploadPDFsToStorageBtn.textContent;
                    uploadPDFsToStorageBtn.textContent = '⏳ Uploading PDFs...';
                    uploadPDFsToStorageBtn.disabled = true;

                    console.log('🗂️ [PDF_STORAGE] Starting PDF upload to Firebase Storage...');

                    // Get the current user
                    const user = auth.currentUser;
                    if (!user) {
                        alert('You must be logged in to upload PDFs');
                        return;
                    }

                    // Get Firebase token
                    const token = await user.getIdToken();

                    console.log('Starting PDF upload to Firebase Storage...');

                    // Call the new uploadPDFsToStorage endpoint
                    const response = await fetch(`${SERVER_URL}/uploadPDFsToStorage`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${token}`
                        }
                    });

                    if (!response.ok) {
                        const errorText = await response.text();
                        throw new Error(`Server error: ${response.status} - ${errorText}`);
                    }

                    const result = await response.json();

                    if (result.success) {
                        console.log('✅ [PDF_STORAGE] PDF upload to Firebase Storage completed successfully!', result);

                        let message = `🎉 PDF Upload to Firebase Storage Complete!\n\n`;
                        message += `📊 Results:\n`;
                        message += `• Total PDF files found: ${result.results.totalFiles}\n`;
                        message += `• Successfully uploaded: ${result.results.uploaded}\n`;
                        message += `• Already existed: ${result.results.results.filter(r => r.status === 'already_exists').length}\n`;
                        message += `• Errors: ${result.results.errors}\n\n`;

                        if (result.results.results && result.results.results.length > 0) {
                            message += `📁 Upload Details (first 10):\n`;
                            result.results.results.slice(0, 10).forEach(item => {
                                if (item.status === 'uploaded') {
                                    message += `• ✅ ${item.name} (${Math.round(item.size / 1024)} KB)\n`;
                                } else if (item.status === 'already_exists') {
                                    message += `• 📂 ${item.name} (already exists)\n`;
                                } else if (item.status === 'error') {
                                    message += `• ❌ ${item.name} (${item.error})\n`;
                                }
                            });
                            if (result.results.results.length > 10) {
                                message += `• ... and ${result.results.results.length - 10} more\n`;
                            }
                        }

                        // Show success message and detailed logs
                        alert(message);
                        console.log('📊 [PDF_STORAGE] Detailed results:', result.results);
                    } else {
                        throw new Error(result.error || 'PDF upload to Firebase Storage failed');
                    }

                } catch (error) {
                    console.error('Error uploading PDFs to Firebase Storage:', error);
                    alert(`❌ PDF upload to Firebase Storage failed: ${error.message}`);
                } finally {
                    // Reset button state
                    uploadPDFsToStorageBtn.textContent = originalText;
                    uploadPDFsToStorageBtn.disabled = false;
                }
            });
        }

        // Handle AI Model Health Check button
        const testModelHealthBtn = document.getElementById('testModelHealthBtn');
        if (testModelHealthBtn) {
            testModelHealthBtn.addEventListener('click', async () => {
                const resultsDiv = document.getElementById('modelHealthResults');
                const tableBody = document.getElementById('modelHealthTableBody');
                const summarySpan = document.getElementById('modelHealthSummary');

                try {
                    // Update button state
                    const originalText = testModelHealthBtn.textContent;
                    testModelHealthBtn.textContent = '🔄 Testing...';
                    testModelHealthBtn.disabled = true;
                    summarySpan.textContent = 'Testing all models...';
                    resultsDiv.style.display = 'none';

                    // Get auth token
                    const user = auth.currentUser;
                    if (!user) {
                        alert('You must be logged in to test models');
                        return;
                    }

                    const token = await user.getIdToken();
                    const response = await fetch(`${SERVER_URL}/testModelHealth`, {
                        method: 'GET',
                        headers: {
                            'Authorization': `Bearer ${token}`,
                            'Content-Type': 'application/json'
                        }
                    });

                    const data = await response.json();

                    if (!data.success) {
                        throw new Error(data.message || 'Failed to test models');
                    }

                    // Display results
                    tableBody.innerHTML = '';

                    data.results.forEach(result => {
                        const row = document.createElement('tr');
                        const statusIcon = result.status === 'OK' ? '✅' : result.status === 'SKIP' ? '⏭️' : '❌';
                        const statusColor = result.status === 'OK' ? '#28a745' : result.status === 'SKIP' ? '#ffc107' : '#dc3545';

                        row.innerHTML = `
                            <td style="padding:10px;text-align:center;font-size:16px;border-bottom:1px solid #eee;">${statusIcon}</td>
                            <td style="padding:10px;border-bottom:1px solid #eee;font-weight:500;">${result.name}</td>
                            <td style="padding:10px;text-align:right;border-bottom:1px solid #eee;color:#666;">${result.ms}ms</td>
                            <td style="padding:10px;border-bottom:1px solid #eee;color:${statusColor};font-size:12px;">${result.message}</td>
                        `;
                        tableBody.appendChild(row);
                    });

                    resultsDiv.style.display = 'block';

                    // Update summary
                    const { passed, failed, skipped } = data.summary;
                    summarySpan.innerHTML = `<span style="color:#28a745;">${passed} passed</span>, <span style="color:#dc3545;">${failed} failed</span>, <span style="color:#ffc107;">${skipped} skipped</span>`;

                    console.log('[MODEL_HEALTH] Test completed:', data.summary);

                } catch (error) {
                    console.error('Error testing model health:', error);
                    summarySpan.textContent = 'Error: ' + error.message;
                    summarySpan.style.color = '#dc3545';
                } finally {
                    testModelHealthBtn.textContent = '🔍 Test All Models';
                    testModelHealthBtn.disabled = false;
                }
            });
        }

        // Handle content repair button
        const repairContentBtn = document.getElementById('repairContentBtn');
        if (repairContentBtn) {
            let isContentRepairRunning = false;
            let cancelContentRepair = false;

            repairContentBtn.addEventListener('click', async () => {
                // If already running, treat click as "stop"
                if (isContentRepairRunning) {
                    cancelContentRepair = true;
                    repairContentBtn.textContent = '⏳ Stopping...';
                    repairContentBtn.disabled = true;
                    console.log('🛑 [CONTENT_REPAIR] Stop requested by user');
                    return;
                }

                if (!confirm('Are you sure you want to repair content issues?\n\nThis will keep processing batches until no more guidelines need repair (can take a long time).\n\nYou can click the button again to stop.')) {
                    return;
                }

                const originalText = repairContentBtn.textContent;
                const BATCH_SIZE = 5; // Keep small to avoid request timeouts (server processes sequentially)
                const FORCE_REGENERATE = false;

                isContentRepairRunning = true;
                cancelContentRepair = false;
                repairContentBtn.textContent = '🛑 Stop Repair';
                repairContentBtn.disabled = false; // allow stop clicks

                try {
                    console.log('🔧 [CONTENT_REPAIR] Starting continuous content repair process...');

                    const user = auth.currentUser;
                    if (!user) {
                        alert('You must be logged in to repair content');
                        return;
                    }

                    const token = await user.getIdToken();

                    let totalProcessed = 0;
                    let totalSucceeded = 0;
                    let totalFailed = 0;
                    let batches = 0;
                    let lastResult = null;

                    const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

                    while (!cancelContentRepair) {
                        batches++;
                        console.log(`🔄 [CONTENT_REPAIR] Batch ${batches} starting (batchSize=${BATCH_SIZE})...`);

                        const response = await fetch(`${SERVER_URL}/repairGuidelineContent`, {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                'Authorization': `Bearer ${token}`
                            },
                            body: JSON.stringify({
                                batchSize: BATCH_SIZE,
                                forceRegenerate: FORCE_REGENERATE
                            })
                        });

                        if (!response.ok) {
                            const errorText = await response.text();
                            throw new Error(`Server error: ${response.status} - ${errorText}`);
                        }

                        const result = await response.json();
                        lastResult = result;

                        if (!result.success) {
                            throw new Error(result.error || 'Content repair failed');
                        }

                        const processed = Number(result.processed || 0);
                        const succeeded = Number(result.succeeded || 0);
                        const failed = Number(result.failed || 0);
                        const remaining = typeof result.remaining === 'number' ? result.remaining : null;

                        totalProcessed += processed;
                        totalSucceeded += succeeded;
                        totalFailed += failed;

                        console.log(`✅ [CONTENT_REPAIR] Batch ${batches} complete: processed=${processed}, succeeded=${succeeded}, failed=${failed}, remaining=${remaining}`);
                        console.log(`📈 [CONTENT_REPAIR] Totals so far: processed=${totalProcessed}, succeeded=${totalSucceeded}, failed=${totalFailed}`);

                        // Stop when there is nothing left to do
                        if (processed === 0 || remaining === 0) {
                            break;
                        }

                        // Small delay to avoid hammering the server
                        await sleep(500);
                    }

                    const wasCancelled = cancelContentRepair;
                    const totalNeedingRepair = lastResult && typeof lastResult.total === 'number' ? lastResult.total : null;
                    const remainingFinal = lastResult && typeof lastResult.remaining === 'number' ? lastResult.remaining : null;

                    let message = wasCancelled ? `🛑 Content Repair Stopped\n\n` : `🎉 Content Repair Complete!\n\n`;
                    message += `📊 Totals:\n`;
                    if (totalNeedingRepair !== null) message += `• Total needing repair (at start of last batch): ${totalNeedingRepair}\n`;
                    message += `• Total processed: ${totalProcessed}\n`;
                    message += `• Total succeeded: ${totalSucceeded}\n`;
                    message += `• Total failed: ${totalFailed}\n`;
                    if (remainingFinal !== null) message += `• Remaining: ${remainingFinal}\n`;

                    alert(message);
                    console.log('📊 [CONTENT_REPAIR] Finished:', { totalProcessed, totalSucceeded, totalFailed, remainingFinal, wasCancelled });

                } catch (error) {
                    console.error('Error repairing content:', error);
                    alert(`❌ Content repair failed: ${error.message}`);
                } finally {
                    isContentRepairRunning = false;
                    cancelContentRepair = false;
                    repairContentBtn.textContent = originalText;
                    repairContentBtn.disabled = false;
                }
            });
        }

        // Handle reset processing flags button
        const resetProcessingBtn = document.getElementById('resetProcessingBtn');
        if (resetProcessingBtn) {
            resetProcessingBtn.addEventListener('click', async () => {
                if (!confirm('Are you sure you want to reset all processing flags? This will clear the "processing" status from all guidelines in Firestore, allowing the background scanner to pick them up again.')) {
                    return;
                }

                try {
                    resetProcessingBtn.textContent = '🔄 Resetting...';
                    resetProcessingBtn.disabled = true;

                    console.log('🧹 [RESET_FLAGS] Requesting reset of all processing flags...');

                    const token = await auth.currentUser.getIdToken();
                    const response = await fetch(`${SERVER_URL}/resetProcessingFlags`, {
                        method: 'POST',
                        headers: {
                            'Authorization': `Bearer ${token}`,
                            'Content-Type': 'application/json'
                        }
                    });

                    if (!response.ok) {
                        const errorData = await response.json();
                        throw new Error(`Server error: ${response.status} - ${JSON.stringify(errorData)}`);
                    }

                    const result = await response.json();
                    alert(result.message || `Successfully reset flags`);
                    console.log('✅ [RESET_FLAGS] Done:', result);

                } catch (error) {
                    console.error('Error resetting processing flags:', error);
                    alert(`❌ Reset failed: ${error.message}`);
                } finally {
                    resetProcessingBtn.textContent = '🧹 Reset Processing Flags';
                    resetProcessingBtn.disabled = false;
                }
            });
        }



        // Handle database migration button
        const migrateDatabaseBtn = document.getElementById('migrateDatabaseBtn');
        if (migrateDatabaseBtn) {
            migrateDatabaseBtn.addEventListener('click', async () => {
                if (!confirm('Are you sure you want to migrate the database to single collection structure? This will consolidate data from summaries, keywords, and condensed collections into the main guidelines collection. This action cannot be easily undone.')) {
                    return;
                }

                try {
                    migrateDatabaseBtn.textContent = '🔄 Migrating...';
                    migrateDatabaseBtn.disabled = true;

                    console.log('🔄 [DB_MIGRATION] Starting database migration...');

                    const token = await auth.currentUser.getIdToken();
                    const response = await fetch(`${SERVER_URL}/migrateToSingleCollection`, {
                        method: 'POST',
                        headers: {
                            'Authorization': `Bearer ${token}`,
                            'Content-Type': 'application/json'
                        }
                    });

                    if (!response.ok) {
                        const errorData = await response.json();
                        throw new Error(`Server error: ${response.status} - ${JSON.stringify(errorData)}`);
                    }

                    const result = await response.json();
                    console.log('✅ [DB_MIGRATION] Migration completed:', result);

                    // Show detailed results
                    const message = `Database migration completed successfully!\n\n` +
                        `Migrated: ${result.migrated} guidelines\n` +
                        `Collections processed:\n` +
                        `- Guidelines: ${result.collections.guidelines}\n` +
                        `- Summaries: ${result.collections.summaries}\n` +
                        `- Keywords: ${result.collections.keywords}\n` +
                        `- Condensed: ${result.collections.condensed}\n\n` +
                        `All data is now consolidated in the single guidelines collection.`;

                    alert(message);

                } catch (error) {
                    console.error('Error migrating database:', error);
                    alert('Database migration failed: ' + error.message);
                } finally {
                    migrateDatabaseBtn.textContent = '🔄 Migrate to Single Collection';
                    migrateDatabaseBtn.disabled = false;
                }
            });
        }

        // Handle initialize clinical conditions button
        const initClinicalConditionsBtn = document.getElementById('initClinicalConditionsBtn');
        if (initClinicalConditionsBtn) {
            initClinicalConditionsBtn.addEventListener('click', async () => {
                if (!confirm('Are you sure you want to initialize the clinical conditions collection? This will populate Firestore with all clinical conditions from the JSON file. This is needed for transcript generation to work.')) {
                    return;
                }

                const originalText = initClinicalConditionsBtn.textContent;

                try {
                    initClinicalConditionsBtn.textContent = '⏳ Initializing...';
                    initClinicalConditionsBtn.disabled = true;

                    const statusDiv = document.getElementById('maintenanceStatus');
                    statusDiv.style.display = 'block';
                    statusDiv.textContent = 'Initializing clinical conditions collection...';

                    console.log('🏥 [CLINICAL_INIT] Starting clinical conditions initialization...');

                    const token = await auth.currentUser.getIdToken();
                    const response = await fetch(`${SERVER_URL}/initializeClinicalConditions`, {
                        method: 'POST',
                        headers: {
                            'Authorization': `Bearer ${token}`,
                            'Content-Type': 'application/json'
                        }
                    });

                    if (!response.ok) {
                        const errorData = await response.json();
                        throw new Error(`Server error: ${response.status} - ${JSON.stringify(errorData)}`);
                    }

                    const result = await response.json();
                    console.log('✅ [CLINICAL_INIT] Initialization completed:', result);

                    const categoriesText = Object.entries(result.summary.categoriesWithCounts || {})
                        .map(([cat, count]) => `- ${cat}: ${count} conditions`).join('\n');
                    const message = `Clinical conditions initialized successfully!\n\n` +
                        `Total conditions: ${result.totalConditions}\n` +
                        `Categories:\n` + categoriesText;

                    statusDiv.textContent = message;
                    alert(message);

                } catch (error) {
                    console.error('Error initializing clinical conditions:', error);
                    const statusDiv = document.getElementById('maintenanceStatus');
                    statusDiv.textContent = 'Error: ' + error.message;
                    alert('Clinical conditions initialization failed: ' + error.message);
                } finally {
                    initClinicalConditionsBtn.textContent = originalText;
                    initClinicalConditionsBtn.disabled = false;
                }
            });
        }

        // Handle populate display names button
        const populateDisplayNamesBtn = document.getElementById('populateDisplayNamesBtn');
        if (populateDisplayNamesBtn) {
            populateDisplayNamesBtn.addEventListener('click', async () => {
                if (!confirm('Are you sure you want to regenerate displayName fields for all guidelines? This will use AI to generate display names in the format: name (year) - region - trust. It will remove codes, version numbers, and format dates, while preserving organization names and abbreviating trust names. This may take several minutes as it processes each guideline with AI.')) {
                    return;
                }

                const originalText = populateDisplayNamesBtn.textContent;

                try {
                    populateDisplayNamesBtn.textContent = '⏳ Populating...';
                    populateDisplayNamesBtn.disabled = true;

                    const statusDiv = document.getElementById('maintenanceStatus');
                    statusDiv.style.display = 'block';
                    statusDiv.textContent = 'Regenerating displayName fields for all guidelines...';

                    console.log('✨ [DISPLAY_NAMES] Starting displayName regeneration...');

                    const token = await auth.currentUser.getIdToken();
                    const response = await fetch(`${SERVER_URL}/populateDisplayNames`, {
                        method: 'POST',
                        headers: {
                            'Authorization': `Bearer ${token}`,
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({ force: true })
                    });

                    if (!response.ok) {
                        const errorData = await response.json();
                        throw new Error(`Server error: ${response.status} - ${JSON.stringify(errorData)}`);
                    }

                    const result = await response.json();
                    console.log('✅ [DISPLAY_NAMES] Population completed:', result);

                    statusDiv.style.display = 'block';
                    statusDiv.innerHTML = `
                        <strong>✅ Success!</strong><br>
                        Updated ${result.updated} out of ${result.total} guidelines<br>
                        <small style="color:#666">Check console for detailed results</small>
                    `;
                    statusDiv.style.backgroundColor = '#d4edda';
                    statusDiv.style.border = '1px solid #c3e6cb';
                    statusDiv.style.color = '#155724';

                    alert(`Successfully regenerated displayName for ${result.updated} guidelines!`);

                } catch (error) {
                    console.error('❌ [DISPLAY_NAMES] Error:', error);
                    const statusDiv = document.getElementById('maintenanceStatus');
                    statusDiv.style.display = 'block';
                    statusDiv.textContent = `Error: ${error.message}`;
                    statusDiv.style.backgroundColor = '#f8d7da';
                    statusDiv.style.border = '1px solid #f5c6cb';
                    statusDiv.style.color = '#721c24';
                    alert('Error populating display names: ' + error.message);
                } finally {
                    populateDisplayNamesBtn.textContent = originalText;
                    populateDisplayNamesBtn.disabled = false;
                }
            });
        }

        // Handle regenerate display names button (simple formula)
        const regenerateDisplayNamesBtn = document.getElementById('regenerateDisplayNamesBtn');
        if (regenerateDisplayNamesBtn) {
            regenerateDisplayNamesBtn.addEventListener('click', async () => {
                if (!confirm('Regenerate displayName fields for all guidelines using simple formula?\n\nFormula:\n- If national: humanFriendlyName + organisation\n- If local: humanFriendlyName + hospitalTrust\n\nThis will update all guidelines. Continue?')) {
                    return;
                }

                const originalText = regenerateDisplayNamesBtn.textContent;

                try {
                    regenerateDisplayNamesBtn.textContent = '⏳ Regenerating...';
                    regenerateDisplayNamesBtn.disabled = true;

                    const statusDiv = document.getElementById('maintenanceStatus');
                    statusDiv.style.display = 'block';
                    statusDiv.textContent = 'Regenerating displayName fields using simple formula...';

                    console.log('🔄 [REGENERATE_DISPLAY_NAMES] Starting displayName regeneration with simple formula...');

                    const token = await auth.currentUser.getIdToken();
                    const response = await fetch(`${SERVER_URL}/regenerateDisplayNames`, {
                        method: 'POST',
                        headers: {
                            'Authorization': `Bearer ${token}`,
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({ force: true })
                    });

                    if (!response.ok) {
                        const errorData = await response.json();
                        throw new Error(`Server error: ${response.status} - ${JSON.stringify(errorData)}`);
                    }

                    const result = await response.json();
                    console.log('✅ [REGENERATE_DISPLAY_NAMES] Regeneration completed:', result);

                    statusDiv.style.display = 'block';
                    statusDiv.innerHTML = `
                        <strong>✅ Success!</strong><br>
                        Updated ${result.updated} out of ${result.total} guidelines<br>
                        <small style="color:#666">Check console for detailed results</small>
                    `;
                    statusDiv.style.backgroundColor = '#d4edda';
                    statusDiv.style.border = '1px solid #c3e6cb';
                    statusDiv.style.color = '#155724';
                } catch (error) {
                    console.error('❌ [REGENERATE_DISPLAY_NAMES] Error:', error);
                    const statusDiv = document.getElementById('maintenanceStatus');
                    statusDiv.style.display = 'block';
                    statusDiv.textContent = `Error: ${error.message}`;
                    statusDiv.style.backgroundColor = '#f8d7da';
                    statusDiv.style.border = '1px solid #f5c6cb';
                    statusDiv.style.color = '#721c24';
                    alert('Error regenerating display names: ' + error.message);
                } finally {
                    regenerateDisplayNamesBtn.textContent = originalText;
                    regenerateDisplayNamesBtn.disabled = false;
                }
            });
        }

        // Handle clear display names button
        const clearDisplayNamesBtn = document.getElementById('clearDisplayNamesBtn');
        if (clearDisplayNamesBtn) {
            clearDisplayNamesBtn.addEventListener('click', async () => {
                if (!confirm('⚠️ WARNING: This will delete ALL displayName fields from all guidelines. This action cannot be undone. Are you absolutely sure?')) {
                    return;
                }

                const confirmText = prompt('Type "yes" to confirm clearing all display names:');
                if (confirmText !== 'yes') {
                    alert('Confirmation failed. Operation cancelled.');
                    return;
                }

                const originalText = clearDisplayNamesBtn.textContent;

                try {
                    clearDisplayNamesBtn.textContent = '⏳ Clearing...';
                    clearDisplayNamesBtn.disabled = true;

                    const statusDiv = document.getElementById('maintenanceStatus');
                    statusDiv.style.display = 'block';
                    statusDiv.textContent = 'Clearing all displayName fields...';

                    console.log('🗑️ [CLEAR_DISPLAY_NAMES] Starting displayName clearing...');

                    const token = await auth.currentUser.getIdToken();
                    const response = await fetch(`${SERVER_URL}/clearDisplayNames`, {
                        method: 'POST',
                        headers: {
                            'Authorization': `Bearer ${token}`,
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({ confirm: 'yes' })
                    });

                    if (!response.ok) {
                        const errorData = await response.json();
                        throw new Error(`Server error: ${response.status} - ${JSON.stringify(errorData)}`);
                    }

                    const result = await response.json();
                    console.log('✅ [CLEAR_DISPLAY_NAMES] Clearing completed:', result);

                    statusDiv.style.display = 'block';
                    statusDiv.innerHTML = `
                        <strong>✅ Success!</strong><br>
                        Cleared ${result.cleared} out of ${result.total} guidelines<br>
                        <small style="color:#666">Display names will be regenerated automatically for new guidelines</small>
                    `;
                    statusDiv.style.backgroundColor = '#d4edda';
                    statusDiv.style.border = '1px solid #c3e6cb';
                    statusDiv.style.color = '#155724';

                    alert(`Successfully cleared ${result.cleared} displayName fields!`);

                } catch (error) {
                    console.error('❌ [CLEAR_DISPLAY_NAMES] Error:', error);
                    const statusDiv = document.getElementById('maintenanceStatus');
                    statusDiv.style.display = 'block';
                    statusDiv.textContent = `Error: ${error.message}`;
                    statusDiv.style.backgroundColor = '#f8d7da';
                    statusDiv.style.border = '1px solid #f5c6cb';
                    statusDiv.style.color = '#721c24';
                    alert('Error clearing display names: ' + error.message);
                } finally {
                    clearDisplayNamesBtn.textContent = originalText;
                    clearDisplayNamesBtn.disabled = false;
                }
            });
        }

        // Handle enhance metadata button
        const enhanceMetadataBtn = document.getElementById('enhanceMetadataBtn');
        const enhancementStatus = document.getElementById('enhancementStatus');

        if (enhanceMetadataBtn) {
            enhanceMetadataBtn.addEventListener('click', async function () {
                if (!confirm('This will enhance metadata (scope, nation, hospitalTrust) for all guidelines using AI. This may take several minutes. Continue?')) {
                    return;
                }

                enhanceMetadataBtn.disabled = true;
                const originalText = enhanceMetadataBtn.textContent;
                enhanceMetadataBtn.textContent = 'Enhancing...';
                if (enhancementStatus) {
                    enhancementStatus.style.display = 'block';
                    enhancementStatus.textContent = 'Preparing enhancement...';
                }

                try {
                    const user = auth.currentUser;
                    if (!user) {
                        throw new Error('Please sign in first');
                    }
                    const token = await user.getIdToken();

                    // Fetch all guidelines to get their IDs
                    const guidelinesResponse = await fetch(`${SERVER_URL}/getAllGuidelines`, {
                        method: 'GET',
                        headers: {
                            'Authorization': `Bearer ${token}`,
                            'Content-Type': 'application/json'
                        }
                    });

                    const guidelinesResult = await guidelinesResponse.json();
                    if (!guidelinesResult.success || !guidelinesResult.guidelines) {
                        throw new Error('Failed to fetch guidelines');
                    }

                    const allGuidelines = guidelinesResult.guidelines;
                    const guidelineIds = allGuidelines.map(g => g.id || g.guidelineId).filter(id => id);

                    if (guidelineIds.length === 0) {
                        throw new Error('No guidelines found to enhance');
                    }

                    if (enhancementStatus) {
                        enhancementStatus.textContent = `Enhancing metadata for ${guidelineIds.length} guidelines...`;
                    }

                    // Call batch enhancement endpoint
                    const response = await fetch(`${SERVER_URL}/batchEnhanceMetadata`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${token}`
                        },
                        body: JSON.stringify({
                            guidelineIds: guidelineIds,
                            fieldsToEnhance: ['scope', 'nation', 'hospitalTrust']
                        })
                    });

                    const result = await response.json();

                    if (result.success) {
                        if (enhancementStatus) {
                            enhancementStatus.innerHTML = `
                                <strong style="color: #28a745;">✓ Enhancement Complete!</strong><br>
                                ${result.message}<br>
                                Enhanced ${result.results?.reduce((sum, r) => sum + (r.enhancedFields?.length || 0), 0) || 0} fields across ${result.results?.filter(r => r.success).length || 0} guidelines
                            `;
                            enhancementStatus.style.backgroundColor = '#d4edda';
                            enhancementStatus.style.border = '1px solid #c3e6cb';
                            enhancementStatus.style.color = '#155724';
                        }
                    } else {
                        throw new Error(result.error || 'Enhancement failed');
                    }
                } catch (error) {
                    console.error('Error enhancing metadata:', error);
                    if (enhancementStatus) {
                        enhancementStatus.innerHTML = `<strong style="color: #dc3545;">✗ Error:</strong> ${error.message}`;
                        enhancementStatus.style.backgroundColor = '#f8d7da';
                        enhancementStatus.style.border = '1px solid #f5c6cb';
                        enhancementStatus.style.color = '#721c24';
                    }
                } finally {
                    enhanceMetadataBtn.disabled = false;
                    enhanceMetadataBtn.textContent = originalText;
                }
            });
        }

        // Handle guidelines editor
        let allGuidelinesData = [];
        const loadGuidelinesBtn = document.getElementById('loadGuidelinesBtn');
        const guidelinesEditorContainer = document.getElementById('guidelinesEditorContainer');
        const guidelinesEditorStatus = document.getElementById('guidelinesEditorStatus');
        const guidelinesTableBody = document.getElementById('guidelinesTableBody');
        const guidelineSearch = document.getElementById('guidelineSearch');

        async function loadGuidelinesForEditing() {
            try {
                const user = auth.currentUser;
                if (!user) {
                    throw new Error('Please sign in first');
                }
                const token = await user.getIdToken();

                guidelinesEditorStatus.style.display = 'block';
                guidelinesEditorStatus.textContent = 'Loading guidelines...';
                guidelinesEditorStatus.style.backgroundColor = '#f8f9fa';
                guidelinesEditorStatus.style.color = '#6c757d';

                const response = await fetch(`${SERVER_URL}/getAllGuidelines`, {
                    method: 'GET',
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json'
                    }
                });

                const result = await response.json();
                if (!result.success || !result.guidelines) {
                    throw new Error('Failed to fetch guidelines');
                }

                allGuidelinesData = result.guidelines;
                displayGuidelinesTable(allGuidelinesData);

                guidelinesEditorStatus.textContent = `Loaded ${allGuidelinesData.length} guidelines`;
                guidelinesEditorStatus.style.backgroundColor = '#d4edda';
                guidelinesEditorStatus.style.color = '#155724';
                guidelinesEditorContainer.style.display = 'block';

            } catch (error) {
                console.error('Error loading guidelines:', error);
                guidelinesEditorStatus.style.display = 'block';
                guidelinesEditorStatus.textContent = `Error: ${error.message}`;
                guidelinesEditorStatus.style.backgroundColor = '#f8d7da';
                guidelinesEditorStatus.style.color = '#721c24';
            }
        }

        // Helper function to upload PDF from GitHub
        async function uploadPdfFromGitHub(guidelineId, guidelineData, token) {
            try {
                const downloadUrl = guidelineData.downloadUrl;

                if (!downloadUrl || !downloadUrl.includes('github.com')) {
                    return {
                        uploaded: false,
                        error: 'No GitHub download URL found for this guideline',
                        downloadUrl: null
                    };
                }

                // Upload PDF from GitHub
                const uploadResponse = await fetch(`${SERVER_URL}/uploadMissingPdf`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                    },
                    body: JSON.stringify({ guidelineId })
                });

                const uploadResult = await uploadResponse.json();

                if (uploadResult.success) {
                    return { uploaded: true, downloadUrl };
                } else {
                    return {
                        uploaded: false,
                        error: uploadResult.error || 'Upload failed',
                        downloadUrl
                    };
                }

            } catch (error) {
                console.error('Error uploading PDF:', error);
                return {
                    uploaded: false,
                    error: error.message,
                    downloadUrl: guidelineData.downloadUrl || null
                };
            }
        }

        function displayGuidelinesTable(guidelines) {
            guidelinesTableBody.innerHTML = '';

            // Collect unique organisations for the dropdown
            const organisationsSet = new Set();
            guidelines.forEach(guideline => {
                if (guideline.organisation && guideline.organisation.trim()) {
                    organisationsSet.add(guideline.organisation.trim());
                }
            });
            const organisations = Array.from(organisationsSet).sort();

            // Create a datalist for organisation autocomplete (shared across all rows)
            let orgDatalist = document.getElementById('organisationDatalist');
            if (!orgDatalist) {
                orgDatalist = document.createElement('datalist');
                orgDatalist.id = 'organisationDatalist';
                document.body.appendChild(orgDatalist);
            }
            orgDatalist.innerHTML = ''; // Clear existing options
            organisations.forEach(org => {
                const option = document.createElement('option');
                option.value = org;
                orgDatalist.appendChild(option);
            });

            guidelines.forEach(guideline => {
                const row = document.createElement('tr');
                row.style.borderBottom = '1px solid #dee2e6';
                row.dataset.guidelineId = guideline.id || guideline.guidelineId;

                const idCell = document.createElement('td');
                idCell.style.padding = '10px';
                idCell.style.fontSize = '12px';
                idCell.style.fontFamily = 'monospace';
                idCell.style.width = '8%';
                idCell.textContent = (guideline.id || guideline.guidelineId || '').substring(0, 8) + '...';
                idCell.title = guideline.id || guideline.guidelineId || '';

                const titleCell = document.createElement('td');
                titleCell.style.padding = '10px';
                titleCell.style.fontSize = '13px';
                titleCell.style.width = '25%';
                titleCell.style.wordWrap = 'break-word';
                titleCell.style.overflowWrap = 'break-word';
                titleCell.textContent = guideline.title || guideline.humanFriendlyName || 'Untitled';

                const displayNameCell = document.createElement('td');
                displayNameCell.style.padding = '10px';
                displayNameCell.style.width = '35%';
                const displayNameInput = document.createElement('input');
                displayNameInput.type = 'text';
                displayNameInput.value = guideline.displayName || '';
                displayNameInput.style.width = '100%';
                displayNameInput.style.padding = '6px 8px';
                displayNameInput.style.border = '1px solid #ced4da';
                displayNameInput.style.borderRadius = '4px';
                displayNameInput.style.fontSize = '13px';
                displayNameInput.style.fontFamily = "'Inter', sans-serif";
                displayNameInput.style.boxSizing = 'border-box';
                displayNameInput.dataset.originalValue = guideline.displayName || '';

                const orgCell = document.createElement('td');
                orgCell.style.padding = '10px';
                orgCell.style.fontSize = '13px';
                orgCell.style.width = '18%';

                const orgInput = document.createElement('input');
                orgInput.type = 'text';
                orgInput.value = guideline.organisation || '';
                orgInput.setAttribute('list', 'organisationDatalist');
                orgInput.style.width = '100%';
                orgInput.style.padding = '6px 8px';
                orgInput.style.border = '1px solid #ced4da';
                orgInput.style.borderRadius = '4px';
                orgInput.style.fontSize = '13px';
                orgInput.style.fontFamily = "'Inter', sans-serif";
                orgInput.style.boxSizing = 'border-box';
                orgInput.dataset.originalValue = guideline.organisation || '';

                orgCell.appendChild(orgInput);

                const actionsCell = document.createElement('td');
                actionsCell.style.padding = '10px';
                actionsCell.style.textAlign = 'center';
                actionsCell.style.width = '14%';
                const saveBtn = document.createElement('button');
                saveBtn.textContent = 'Save';
                saveBtn.className = 'dev-btn';
                saveBtn.style.padding = '4px 12px';
                saveBtn.style.fontSize = '12px';
                saveBtn.style.marginRight = '5px';
                saveBtn.disabled = true;

                // Function to check for changes in either field
                function checkForChanges() {
                    const displayNameChanged = displayNameInput.value !== displayNameInput.dataset.originalValue;
                    const orgChanged = orgInput.value !== orgInput.dataset.originalValue;
                    const hasChanges = displayNameChanged || orgChanged;

                    saveBtn.disabled = !hasChanges;

                    if (hasChanges) {
                        if (displayNameChanged) {
                            displayNameInput.style.borderColor = '#007bff';
                            displayNameInput.style.backgroundColor = '#f0f8ff';
                        } else {
                            displayNameInput.style.borderColor = '#ced4da';
                            displayNameInput.style.backgroundColor = '#fff';
                        }

                        if (orgChanged) {
                            orgInput.style.borderColor = '#007bff';
                            orgInput.style.backgroundColor = '#f0f8ff';
                        } else {
                            orgInput.style.borderColor = '#ced4da';
                            orgInput.style.backgroundColor = '#fff';
                        }

                        saveBtn.style.backgroundColor = '#28a745';
                        saveBtn.style.color = '#fff';
                        saveBtn.style.borderColor = '#28a745';
                    } else {
                        displayNameInput.style.borderColor = '#ced4da';
                        displayNameInput.style.backgroundColor = '#fff';
                        orgInput.style.borderColor = '#ced4da';
                        orgInput.style.backgroundColor = '#fff';
                        saveBtn.style.backgroundColor = '';
                        saveBtn.style.color = '';
                        saveBtn.style.borderColor = '';
                    }
                }

                displayNameInput.addEventListener('input', checkForChanges);
                orgInput.addEventListener('input', checkForChanges);

                displayNameCell.appendChild(displayNameInput);

                saveBtn.addEventListener('click', async function () {
                    const guidelineId = row.dataset.guidelineId;
                    const newDisplayName = displayNameInput.value;
                    const newOrganisation = orgInput.value.trim();

                    saveBtn.disabled = true;
                    saveBtn.textContent = 'Saving...';

                    try {
                        const user = auth.currentUser;
                        if (!user) {
                            throw new Error('Please sign in first');
                        }
                        const token = await user.getIdToken();

                        // Build update object with only changed fields
                        const updates = {};
                        if (displayNameInput.value !== displayNameInput.dataset.originalValue) {
                            updates.displayName = newDisplayName;
                        }
                        if (orgInput.value !== orgInput.dataset.originalValue) {
                            updates.organisation = newOrganisation || null; // Allow empty string to clear
                        }

                        const response = await fetch(`${SERVER_URL}/guideline/${guidelineId}`, {
                            method: 'PUT',
                            headers: {
                                'Authorization': `Bearer ${token}`,
                                'Content-Type': 'application/json'
                            },
                            body: JSON.stringify(updates)
                        });

                        if (!response.ok) {
                            const errorData = await response.json();
                            throw new Error(errorData.error || 'Failed to save');
                        }

                        // Update original values
                        displayNameInput.dataset.originalValue = newDisplayName;
                        orgInput.dataset.originalValue = newOrganisation;

                        // Show success feedback
                        if (updates.displayName !== undefined) {
                            displayNameInput.style.borderColor = '#28a745';
                            displayNameInput.style.backgroundColor = '#d4edda';
                        }
                        if (updates.organisation !== undefined) {
                            orgInput.style.borderColor = '#28a745';
                            orgInput.style.backgroundColor = '#d4edda';
                        }

                        saveBtn.textContent = 'Saved ✓';
                        saveBtn.style.backgroundColor = '#28a745';
                        saveBtn.style.color = '#fff';

                        setTimeout(() => {
                            displayNameInput.style.borderColor = '#ced4da';
                            displayNameInput.style.backgroundColor = '#fff';
                            orgInput.style.borderColor = '#ced4da';
                            orgInput.style.backgroundColor = '#fff';
                            saveBtn.textContent = 'Save';
                            saveBtn.disabled = true;
                            saveBtn.style.backgroundColor = '';
                            saveBtn.style.color = '';
                        }, 2000);

                    } catch (error) {
                        console.error('Error saving fields:', error);
                        saveBtn.textContent = 'Error';
                        saveBtn.style.backgroundColor = '#dc3545';
                        saveBtn.style.color = '#fff';
                        alert(`Failed to save: ${error.message}`);
                        setTimeout(() => {
                            saveBtn.textContent = 'Save';
                            saveBtn.disabled = false;
                            saveBtn.style.backgroundColor = '';
                            saveBtn.style.color = '';
                        }, 3000);
                    }
                });

                // Create View PDF button
                const viewPdfBtn = document.createElement('button');
                viewPdfBtn.textContent = 'View PDF';
                viewPdfBtn.className = 'dev-btn';
                viewPdfBtn.style.padding = '4px 12px';
                viewPdfBtn.style.fontSize = '12px';
                viewPdfBtn.style.marginLeft = '5px';
                viewPdfBtn.style.backgroundColor = '#007bff';
                viewPdfBtn.style.color = '#fff';
                viewPdfBtn.style.borderColor = '#007bff';

                // Store error state in row dataset
                row.dataset.pdfError = 'false';
                row.dataset.pdfDownloadUrl = guideline.downloadUrl || '';

                // Function to open PDF viewer
                function openPdfViewer(guidelineId, token) {
                    const pdfUrl = `${SERVER_URL}/api/pdf/${guidelineId}?token=${encodeURIComponent(token)}`;
                    const viewerUrl = `/pdfjs/web/viewer.html?file=${encodeURIComponent(pdfUrl)}`;
                    window.open(viewerUrl, '_blank');
                }

                // Function to show error state
                function showPdfError(message, downloadUrl) {
                    row.dataset.pdfError = 'true';
                    viewPdfBtn.textContent = 'Error';
                    viewPdfBtn.style.backgroundColor = '#dc3545';
                    viewPdfBtn.disabled = true;

                    // Create or update error message element
                    let errorMsg = row.querySelector('.pdf-error-msg');
                    if (!errorMsg) {
                        errorMsg = document.createElement('div');
                        errorMsg.className = 'pdf-error-msg';
                        errorMsg.style.fontSize = '11px';
                        errorMsg.style.color = '#dc3545';
                        errorMsg.style.marginTop = '4px';
                        errorMsg.style.padding = '4px';
                        errorMsg.style.background = '#f8d7da';
                        errorMsg.style.borderRadius = '3px';
                        actionsCell.appendChild(errorMsg);
                    }
                    errorMsg.innerHTML = message;

                    // Add retry and GitHub fallback buttons if not already present
                    if (!row.querySelector('.pdf-retry-btn')) {
                        const retryBtn = document.createElement('button');
                        retryBtn.className = 'pdf-retry-btn dev-btn';
                        retryBtn.textContent = 'Retry';
                        retryBtn.style.padding = '2px 8px';
                        retryBtn.style.fontSize = '11px';
                        retryBtn.style.marginTop = '4px';
                        retryBtn.style.backgroundColor = '#007bff';
                        retryBtn.style.color = '#fff';
                        retryBtn.style.borderColor = '#007bff';
                        retryBtn.addEventListener('click', () => viewPdfBtn.click());
                        actionsCell.appendChild(retryBtn);

                        if (downloadUrl) {
                            const githubBtn = document.createElement('button');
                            githubBtn.className = 'pdf-github-btn dev-btn';
                            githubBtn.textContent = 'Open GitHub';
                            githubBtn.style.padding = '2px 8px';
                            githubBtn.style.fontSize = '11px';
                            githubBtn.style.marginTop = '4px';
                            githubBtn.style.marginLeft = '4px';
                            githubBtn.style.backgroundColor = '#6c757d';
                            githubBtn.style.color = '#fff';
                            githubBtn.style.borderColor = '#6c757d';
                            githubBtn.addEventListener('click', () => {
                                window.open(downloadUrl, '_blank');
                            });
                            actionsCell.appendChild(githubBtn);
                        }
                    }
                }

                // Function to reset button state
                function resetPdfButton() {
                    row.dataset.pdfError = 'false';
                    viewPdfBtn.textContent = 'View PDF';
                    viewPdfBtn.style.backgroundColor = '#007bff';
                    viewPdfBtn.disabled = false;

                    // Remove error message and retry buttons
                    const errorMsg = row.querySelector('.pdf-error-msg');
                    if (errorMsg) errorMsg.remove();
                    const retryBtn = row.querySelector('.pdf-retry-btn');
                    if (retryBtn) retryBtn.remove();
                    const githubBtn = row.querySelector('.pdf-github-btn');
                    if (githubBtn) githubBtn.remove();
                }

                viewPdfBtn.addEventListener('click', async function () {
                    const guidelineId = row.dataset.guidelineId;
                    const downloadUrl = row.dataset.pdfDownloadUrl;

                    try {
                        const user = auth.currentUser;
                        if (!user) {
                            alert('Please sign in first to view PDFs');
                            return;
                        }

                        // Reset any previous error state
                        resetPdfButton();

                        // Get fresh ID token
                        const idToken = await user.getIdToken();

                        // Show checking state
                        viewPdfBtn.textContent = 'Checking...';
                        viewPdfBtn.disabled = true;

                        // Check if PDF exists
                        const checkUrl = `${SERVER_URL}/api/pdf/${guidelineId}?token=${encodeURIComponent(idToken)}`;
                        let checkResponse;
                        try {
                            checkResponse = await fetch(checkUrl, { method: 'HEAD' });
                        } catch (fetchError) {
                            // Network error or HEAD not supported, try opening directly (let auto-retry handle it)
                            console.warn('HEAD request failed, opening PDF directly:', fetchError.message);
                            viewPdfBtn.textContent = 'Opening...';
                            openPdfViewer(guidelineId, idToken);
                            setTimeout(() => resetPdfButton(), 1000);
                            return;
                        }

                        if (checkResponse.ok) {
                            // PDF exists, open viewer
                            viewPdfBtn.textContent = 'Opening...';
                            openPdfViewer(guidelineId, idToken);
                            setTimeout(() => resetPdfButton(), 1000);
                            return;
                        } else if (checkResponse.status === 404) {
                            // PDF doesn't exist, upload from GitHub
                            viewPdfBtn.textContent = 'Uploading...';
                            const uploadResult = await uploadPdfFromGitHub(guidelineId, guideline, idToken);

                            if (uploadResult.uploaded) {
                                // PDF was uploaded successfully, open viewer
                                viewPdfBtn.textContent = 'Opening...';
                                openPdfViewer(guidelineId, idToken);

                                // Reset button after a short delay
                                setTimeout(() => {
                                    resetPdfButton();
                                }, 1000);
                            } else {
                                // Upload failed
                                let errorMessage = uploadResult.error || 'Failed to upload PDF';
                                if (!uploadResult.downloadUrl) {
                                    errorMessage = 'PDF not found and no GitHub URL available';
                                } else {
                                    errorMessage = `PDF upload failed: ${errorMessage}`;
                                }
                                showPdfError(errorMessage, uploadResult.downloadUrl || downloadUrl);
                            }
                        } else {
                            // Other error - try opening anyway (might be a CORS issue with HEAD)
                            console.warn(`HEAD request returned ${checkResponse.status}, attempting to open PDF directly`);
                            viewPdfBtn.textContent = 'Opening...';
                            openPdfViewer(guidelineId, idToken);
                            setTimeout(() => resetPdfButton(), 1000);
                        }

                    } catch (error) {
                        console.error('Error opening PDF:', error);
                        showPdfError(`Error: ${error.message}`, downloadUrl);
                    }
                });

                actionsCell.appendChild(saveBtn);
                actionsCell.appendChild(viewPdfBtn);

                row.appendChild(idCell);
                row.appendChild(titleCell);
                row.appendChild(displayNameCell);
                row.appendChild(orgCell);
                row.appendChild(actionsCell);

                guidelinesTableBody.appendChild(row);
            });
        }

        function filterGuidelinesTable(searchTerm) {
            if (!searchTerm) {
                displayGuidelinesTable(allGuidelinesData);
                return;
            }

            const filtered = allGuidelinesData.filter(g => {
                const searchLower = searchTerm.toLowerCase();
                const title = (g.title || '').toLowerCase();
                const displayName = (g.displayName || '').toLowerCase();
                const organisation = (g.organisation || '').toLowerCase();
                const id = (g.id || g.guidelineId || '').toLowerCase();

                return title.includes(searchLower) ||
                    displayName.includes(searchLower) ||
                    organisation.includes(searchLower) ||
                    id.includes(searchLower);
            });

            displayGuidelinesTable(filtered);
        }

        if (loadGuidelinesBtn) {
            loadGuidelinesBtn.addEventListener('click', loadGuidelinesForEditing);
        }

        if (guidelineSearch) {
            guidelineSearch.addEventListener('input', function () {
                filterGuidelinesTable(this.value);
            });
        }

        // Handle fix nation classifications button
        const fixNationsBtn = document.getElementById('fixNationsBtn');
        const fixNationsStatus = document.getElementById('fixNationsStatus');

        if (fixNationsBtn) {
            fixNationsBtn.addEventListener('click', async function () {
                if (!confirm('This will fix incorrect nation classifications for all national guidelines based on their organization. Guidelines incorrectly marked as Scotland will be corrected. Continue?')) {
                    return;
                }

                fixNationsBtn.disabled = true;
                const originalText = fixNationsBtn.textContent;
                fixNationsBtn.textContent = 'Fixing...';
                if (fixNationsStatus) {
                    fixNationsStatus.style.display = 'block';
                    fixNationsStatus.textContent = 'Checking and fixing nation classifications...';
                }

                try {
                    const user = auth.currentUser;
                    if (!user) {
                        throw new Error('Please sign in first');
                    }
                    const token = await user.getIdToken();

                    // Call fix nations endpoint
                    const response = await fetch(`${SERVER_URL}/fixNationClassifications`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${token}`
                        }
                    });

                    const result = await response.json();

                    if (result.success) {
                        if (fixNationsStatus) {
                            fixNationsStatus.innerHTML = `
                                <strong style="color: #28a745;">✓ Fix Complete!</strong><br>
                                ${result.message}<br>
                                Checked: ${result.stats.checked}, Fixed: ${result.stats.fixed}, Skipped: ${result.stats.skipped}, Errors: ${result.stats.errors}
                                ${result.sampleUpdates && result.sampleUpdates.length > 0 ? '<br><br>Sample fixes:<br>' + result.sampleUpdates.map(u => `• ${u.title}: ${u.oldNation || 'null'} → ${u.newNation}`).join('<br>') : ''}
                            `;
                            fixNationsStatus.style.backgroundColor = '#d4edda';
                            fixNationsStatus.style.border = '1px solid #c3e6cb';
                            fixNationsStatus.style.color = '#155724';
                        }
                    } else {
                        throw new Error(result.error || 'Fix failed');
                    }
                } catch (error) {
                    console.error('Error fixing nation classifications:', error);
                    if (fixNationsStatus) {
                        fixNationsStatus.innerHTML = `<strong style="color: #dc3545;">✗ Error:</strong> ${error.message}`;
                        fixNationsStatus.style.backgroundColor = '#f8d7da';
                        fixNationsStatus.style.border = '1px solid #f5c6cb';
                        fixNationsStatus.style.color = '#721c24';
                    }
                } finally {
                    fixNationsBtn.disabled = false;
                    fixNationsBtn.textContent = originalText;
                }
            });
        }

        // Handle Ingest to Pinecone button
        const ingestToPineconeBtn = document.getElementById('ingestToPineconeBtn');

        if (ingestToPineconeBtn) {
            ingestToPineconeBtn.addEventListener('click', async function () {
                if (!confirm('This will re-ingest all guidelines to Pinecone vector database.\n\nThis updates the search index with current humanFriendlyName values.\n\nThis may take several minutes. Continue?')) {
                    return;
                }

                ingestToPineconeBtn.disabled = true;
                const originalText = ingestToPineconeBtn.textContent;
                ingestToPineconeBtn.textContent = '⏳ Ingesting...';

                const maintenanceStatus = document.getElementById('maintenanceStatus');
                if (maintenanceStatus) {
                    maintenanceStatus.style.display = 'block';
                    maintenanceStatus.textContent = 'Starting Pinecone ingestion...';
                    maintenanceStatus.style.backgroundColor = '#fff3cd';
                    maintenanceStatus.style.border = '1px solid #ffc107';
                    maintenanceStatus.style.color = '#856404';
                }

                try {
                    const user = auth.currentUser;
                    if (!user) {
                        throw new Error('Please sign in first');
                    }
                    const token = await user.getIdToken();

                    const response = await fetch(`${SERVER_URL}/ingestGuidelines`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${token}`
                        },
                        body: JSON.stringify({ dryRun: false })
                    });

                    const result = await response.json();

                    if (result.success) {
                        if (maintenanceStatus) {
                            maintenanceStatus.innerHTML = `
                                <strong style="color: #28a745;">✓ Ingestion Complete!</strong><br>
                                Processed: ${result.processedGuidelines || 0} guidelines<br>
                                Chunks uploaded: ${result.uploaded || result.totalChunks || 0}<br>
                                ${result.guidelinesWithoutContent ? `Skipped (no content): ${result.guidelinesWithoutContent}` : ''}
                            `;
                            maintenanceStatus.style.backgroundColor = '#d4edda';
                            maintenanceStatus.style.border = '1px solid #c3e6cb';
                            maintenanceStatus.style.color = '#155724';
                        }
                        console.log('[PINECONE_INGEST] Ingestion complete:', result);
                    } else {
                        throw new Error(result.error || 'Ingestion failed');
                    }
                } catch (error) {
                    console.error('Error ingesting to Pinecone:', error);
                    if (maintenanceStatus) {
                        maintenanceStatus.innerHTML = `<strong style="color: #dc3545;">✗ Error:</strong> ${error.message}`;
                        maintenanceStatus.style.backgroundColor = '#f8d7da';
                        maintenanceStatus.style.border = '1px solid #f5c6cb';
                        maintenanceStatus.style.color = '#721c24';
                    }
                } finally {
                    ingestToPineconeBtn.disabled = false;
                    ingestToPineconeBtn.textContent = originalText;
                }
            });
        }

        // Reingest single guideline to Pinecone handlers
        const reingestGuidelineSelect = document.getElementById('reingestGuidelineSelect');
        const reingestSingleBtn = document.getElementById('reingestSingleBtn');
        const reingestStatus = document.getElementById('reingestStatus');

        // Populate reingest select from getAllGuidelines
        async function loadGuidelinesForReingest() {
            try {
                const token = await auth.currentUser?.getIdToken();
                if (!token) return;

                const response = await fetch(`${SERVER_URL}/getAllGuidelines`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });

                if (response.ok) {
                    const data = await response.json();
                    const guidelines = Array.isArray(data) ? data : (data.guidelines || []);
                    if (reingestGuidelineSelect) {
                        reingestGuidelineSelect.innerHTML = '<option value="">-- Select a guideline --</option>';
                        guidelines.sort((a, b) => (a.title || a.id).localeCompare(b.title || b.id));
                        guidelines.forEach(g => {
                            const option = document.createElement('option');
                            option.value = g.id;
                            const hasContent = g.content && g.content.length > 0;
                            const isIngested = g.vectorDbIngested;
                            const status = isIngested ? '✅' : (hasContent ? '⏳' : '❌');
                            option.textContent = `${status} ${g.title || g.humanFriendlyName || g.id}`;
                            reingestGuidelineSelect.appendChild(option);
                        });
                    }
                }
            } catch (error) {
                console.error('Error loading guidelines for reingest:', error);
            }
        }

        // Load guidelines when auth state changes
        auth.onAuthStateChanged(async (user) => {
            if (user) {
                await loadGuidelinesForReingest();
            }
        });

        // Reingest single guideline button handler
        if (reingestSingleBtn) {
            reingestSingleBtn.addEventListener('click', async () => {
                const selectedId = reingestGuidelineSelect?.value;
                if (!selectedId) {
                    alert('Please select a guideline first');
                    return;
                }

                try {
                    reingestSingleBtn.disabled = true;
                    const originalText = reingestSingleBtn.textContent;
                    reingestSingleBtn.textContent = '⏳ Reingesting...';

                    if (reingestStatus) {
                        reingestStatus.style.display = 'block';
                        reingestStatus.innerHTML = `<strong>Reingesting:</strong> ${selectedId}...`;
                    }

                    const token = await auth.currentUser.getIdToken();
                    const response = await fetch(`${SERVER_URL}/reingestGuideline`, {
                        method: 'POST',
                        headers: {
                            'Authorization': `Bearer ${token}`,
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({ guidelineId: selectedId })
                    });

                    const result = await response.json();

                    if (result.success) {
                        reingestStatus.innerHTML = `<span style="color:green;">✅ <strong>${selectedId}</strong> reingested successfully!</span><br>
                            Chunks: ${result.chunksUpserted || 0}`;
                        // Refresh the list to show updated status
                        await loadGuidelinesForReingest();
                    } else {
                        reingestStatus.innerHTML = `<span style="color:red;">❌ <strong>${selectedId}</strong>: ${result.error || 'Unknown error'}</span>`;
                    }

                    reingestSingleBtn.textContent = originalText;
                    reingestSingleBtn.disabled = false;
                } catch (error) {
                    console.error('Error reingesting guideline:', error);
                    if (reingestStatus) {
                        reingestStatus.innerHTML = `<span style="color:red;">❌ Error: ${error.message}</span>`;
                    }
                    reingestSingleBtn.textContent = '🔍 Reingest to Pinecone';
                    reingestSingleBtn.disabled = false;
                }
            });
        }

        // Re-extract PDF content handlers
        const reextractGuidelineSelect = document.getElementById('reextractGuidelineSelect');
        const reextractSingleBtn = document.getElementById('reextractSingleBtn');
        const reextractAllBtn = document.getElementById('reextractAllBtn');
        const reextractStatus = document.getElementById('reextractStatus');

        // Load guidelines into the select dropdown
        async function loadGuidelinesForReextract() {
            try {
                const token = await auth.currentUser?.getIdToken();
                if (!token) return;

                const response = await fetch(`${SERVER_URL}/getAllGuidelines`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });

                if (response.ok) {
                    const data = await response.json();
                    // Handle both array response and object with guidelines property
                    const guidelines = Array.isArray(data) ? data : (data.guidelines || []);
                    if (reextractGuidelineSelect) {
                        reextractGuidelineSelect.innerHTML = '<option value="">-- Select a guideline --</option>';
                        guidelines.sort((a, b) => (a.title || a.id).localeCompare(b.title || b.id));
                        guidelines.forEach(g => {
                            const option = document.createElement('option');
                            option.value = g.id;
                            option.textContent = `${g.title || g.id} (${g.id})`;
                            reextractGuidelineSelect.appendChild(option);
                        });
                    }
                }
            } catch (error) {
                console.error('Error loading guidelines for re-extract:', error);
            }
        }

        // Load guidelines when auth state changes
        auth.onAuthStateChanged(async (user) => {
            if (user) {
                await loadGuidelinesForReextract();
            }
        });

        // Re-extract single guideline
        if (reextractSingleBtn) {
            reextractSingleBtn.addEventListener('click', async () => {
                const selectedId = reextractGuidelineSelect?.value;
                if (!selectedId) {
                    alert('Please select a guideline first');
                    return;
                }

                try {
                    reextractSingleBtn.disabled = true;
                    const originalText = reextractSingleBtn.textContent;
                    reextractSingleBtn.textContent = '🔄 Re-extracting...';

                    if (reextractStatus) {
                        reextractStatus.style.display = 'block';
                        reextractStatus.innerHTML = `<strong>Processing:</strong> ${selectedId}...`;
                    }

                    const token = await auth.currentUser.getIdToken();
                    const response = await fetch(`${SERVER_URL}/reextractGuidelineContent`, {
                        method: 'POST',
                        headers: {
                            'Authorization': `Bearer ${token}`,
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({ guidelineId: selectedId })
                    });

                    const result = await response.json();

                    if (result.success && result.results?.length > 0) {
                        const r = result.results[0];
                        if (r.success) {
                            reextractStatus.innerHTML = `<span style="color:green;">✅ <strong>${r.id}</strong></span><br>
                                Old content: ${r.oldLength} chars<br>
                                New content: ${r.newLength} chars<br>
                                ${r.spellingCheck ? `Spelling check: "${r.spellingCheck}"` : 'No magnesium spelling found'}`;
                        } else {
                            reextractStatus.innerHTML = `<span style="color:red;">❌ <strong>${r.id}</strong>: ${r.error}</span>`;
                        }
                    } else {
                        reextractStatus.innerHTML = `<span style="color:red;">❌ Error: ${result.error || 'Unknown error'}</span>`;
                    }

                    reextractSingleBtn.textContent = originalText;
                    reextractSingleBtn.disabled = false;

                } catch (error) {
                    console.error('Error re-extracting content:', error);
                    if (reextractStatus) {
                        reextractStatus.innerHTML = `<span style="color:red;">❌ Error: ${error.message}</span>`;
                    }
                    reextractSingleBtn.textContent = '📄 Re-extract Selected';
                    reextractSingleBtn.disabled = false;
                }
            });
        }

        // Re-extract all guidelines
        if (reextractAllBtn) {
            reextractAllBtn.addEventListener('click', async () => {
                if (!confirm('This will re-extract content for ALL guidelines. This may take several minutes. Continue?')) {
                    return;
                }

                try {
                    reextractAllBtn.disabled = true;
                    const originalText = reextractAllBtn.textContent;
                    reextractAllBtn.textContent = '🔄 Processing...';

                    if (reextractStatus) {
                        reextractStatus.style.display = 'block';
                        reextractStatus.innerHTML = '<strong>Processing all guidelines...</strong> This may take a while.';
                    }

                    const token = await auth.currentUser.getIdToken();
                    const response = await fetch(`${SERVER_URL}/reextractGuidelineContent`, {
                        method: 'POST',
                        headers: {
                            'Authorization': `Bearer ${token}`,
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({ processAll: true })
                    });

                    const result = await response.json();

                    if (result.success) {
                        let html = `<strong>Completed:</strong> ${result.successCount} success, ${result.failureCount} failed<br><br>`;

                        // Show successes
                        const successes = result.results.filter(r => r.success);
                        if (successes.length > 0) {
                            html += '<details><summary style="cursor:pointer;color:green;">✅ Successful (' + successes.length + ')</summary><ul style="max-height:200px;overflow:auto;">';
                            successes.forEach(r => {
                                html += `<li>${r.id}: ${r.oldLength} → ${r.newLength} chars ${r.spellingCheck ? `(${r.spellingCheck})` : ''}</li>`;
                            });
                            html += '</ul></details>';
                        }

                        // Show failures
                        const failures = result.results.filter(r => !r.success);
                        if (failures.length > 0) {
                            html += '<details open><summary style="cursor:pointer;color:red;">❌ Failed (' + failures.length + ')</summary><ul style="max-height:200px;overflow:auto;">';
                            failures.forEach(r => {
                                html += `<li>${r.id}: ${r.error}</li>`;
                            });
                            html += '</ul></details>';
                        }

                        reextractStatus.innerHTML = html;
                    } else {
                        reextractStatus.innerHTML = `<span style="color:red;">❌ Error: ${result.error || 'Unknown error'}</span>`;
                    }

                    reextractAllBtn.textContent = originalText;
                    reextractAllBtn.disabled = false;

                } catch (error) {
                    console.error('Error re-extracting all content:', error);
                    if (reextractStatus) {
                        reextractStatus.innerHTML = `<span style="color:red;">❌ Error: ${error.message}</span>`;
                    }
                    reextractAllBtn.textContent = '📚 Re-extract ALL Guidelines';
                    reextractAllBtn.disabled = false;
                }
            });
        }

        // ============================================
        // REGENERATE AUDITABLE ELEMENTS
        // ============================================
        const auditableGuidelineSelect = document.getElementById('auditableGuidelineSelect');
        const regenerateAuditableSingleBtn = document.getElementById('regenerateAuditableSingleBtn');
        const auditableStatus = document.getElementById('auditableStatus');

        // --- NEW BATCH REGEN LOGIC ---
        const batchRegenSearch = document.getElementById('batchRegenSearch');
        const batchRegenOrgFilter = document.getElementById('batchRegenOrgFilter');
        const batchRegenYearFilter = document.getElementById('batchRegenYearFilter');
        const batchRegenDateFilter = document.getElementById('batchRegenDateFilter');
        const batchRegenLoadBtn = document.getElementById('batchRegenLoadBtn');
        const batchRegenTableBody = document.getElementById('batchRegenTableBody');
        const batchRegenSelectAll = document.getElementById('batchRegenSelectAll');
        const batchRegenSelectedCount = document.getElementById('batchRegenSelectedCount');
        const batchRegenTotalInfo = document.getElementById('batchRegenTotalInfo');
        const regenerateAuditableFilteredBtn = document.getElementById('regenerateAuditableFilteredBtn');
        const regenerateAuditableAllBtn = document.getElementById('regenerateAuditableAllBtn');

        let allGuidelinesForBatch = [];
        let filteredGuidelines = [];

        async function loadGuidelinesForBatchRegen() {
            try {
                if (batchRegenLoadBtn) batchRegenLoadBtn.disabled = true;
                if (batchRegenTableBody) batchRegenTableBody.innerHTML = '<tr><td colspan="4" style="padding:20px; text-align:center;">⌛ Loading guidelines...</td></tr>';

                const token = await auth.currentUser?.getIdToken();
                if (!token) return;

                const response = await fetch(`${SERVER_URL}/getAllGuidelines`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });

                if (response.ok) {
                    const data = await response.json();
                    allGuidelinesForBatch = Array.isArray(data) ? data : (data.guidelines || []);

                    // Populate filters
                    const orgs = new Set();
                    const years = new Set();
                    allGuidelinesForBatch.forEach(g => {
                        if (g.organisation) orgs.add(g.organisation);
                        if (g.yearProduced) years.add(g.yearProduced);
                    });

                    if (batchRegenOrgFilter) {
                        const currentOrg = batchRegenOrgFilter.value;
                        batchRegenOrgFilter.innerHTML = '<option value="">All Organisations</option>';
                        Array.from(orgs).sort().forEach(org => {
                            const opt = document.createElement('option');
                            opt.value = org;
                            opt.textContent = org;
                            batchRegenOrgFilter.appendChild(opt);
                        });
                        batchRegenOrgFilter.value = currentOrg;
                    }

                    if (batchRegenYearFilter) {
                        const currentYear = batchRegenYearFilter.value;
                        batchRegenYearFilter.innerHTML = '<option value="">All Years</option>';
                        Array.from(years).sort((a, b) => b - a).forEach(year => {
                            const opt = document.createElement('option');
                            opt.value = year;
                            opt.textContent = year;
                            batchRegenYearFilter.appendChild(opt);
                        });
                        batchRegenYearFilter.value = currentYear;
                    }

                    applyBatchRegenFilters();
                }
            } catch (error) {
                console.error('Error loading guidelines for batch regen:', error);
                if (batchRegenTableBody) batchRegenTableBody.innerHTML = `<tr><td colspan="4" style="padding:20px; text-align:center; color:red;">❌ Failed to load: ${error.message}</td></tr>`;
            } finally {
                if (batchRegenLoadBtn) batchRegenLoadBtn.disabled = false;
            }
        }

        function applyBatchRegenFilters() {
            const search = batchRegenSearch?.value.toLowerCase() || '';
            const org = batchRegenOrgFilter?.value || '';
            const year = batchRegenYearFilter?.value || '';
            const dateFilter = batchRegenDateFilter?.value || '';

            const now = new Date();
            const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            const lastWeek = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
            const lastMonth = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

            filteredGuidelines = allGuidelinesForBatch.filter(g => {
                const matchesSearch = !search ||
                    (g.title && g.title.toLowerCase().includes(search)) ||
                    (g.id && g.id.toLowerCase().includes(search)) ||
                    (g.humanFriendlyName && g.humanFriendlyName.toLowerCase().includes(search));
                const matchesOrg = !org || g.organisation === org;
                const matchesYear = !year || String(g.yearProduced) === String(year);

                let matchesDate = true;
                if (dateFilter) {
                    const extractedAt = g.auditableElementsRegeneratedAt;
                    // Handle Firestore Timestamp or ISO string
                    const date = extractedAt ? (extractedAt._seconds ? new Date(extractedAt._seconds * 1000) : new Date(extractedAt)) : null;

                    if (dateFilter === 'never') {
                        matchesDate = !date;
                    } else if (dateFilter === 'today') {
                        matchesDate = date && date >= today;
                    } else if (dateFilter === 'week') {
                        matchesDate = date && date >= lastWeek;
                    } else if (dateFilter === 'month') {
                        matchesDate = date && date >= lastMonth;
                    }
                }

                return matchesSearch && matchesOrg && matchesYear && matchesDate;
            });

            renderBatchRegenTable();
        }

        function renderBatchRegenTable() {
            if (!batchRegenTableBody) return;

            if (filteredGuidelines.length === 0) {
                batchRegenTableBody.innerHTML = '<tr><td colspan="4" style="padding:20px; text-align:center; color:#666;">No guidelines match your filters</td></tr>';
                if (batchRegenTotalInfo) batchRegenTotalInfo.textContent = `Showing 0 of ${allGuidelinesForBatch.length}`;
                return;
            }

            batchRegenTableBody.innerHTML = '';
            filteredGuidelines.forEach(g => {
                const tr = document.createElement('tr');
                tr.style.borderBottom = '1px solid #eee';

                const elementsCount = g.auditableElements?.length || 0;
                const statusColor = elementsCount > 0 ? '#28a745' : '#6c757d';

                const extractedAt = g.auditableElementsRegeneratedAt;
                let dateStr = '-';
                if (extractedAt) {
                    const date = extractedAt._seconds ? new Date(extractedAt._seconds * 1000) : new Date(extractedAt);
                    dateStr = date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                }

                tr.innerHTML = `
                    <td style="padding:8px; text-align:center;"><input type="checkbox" class="batch-regen-cb" data-id="${g.id}" /></td>
                    <td style="padding:8px;">
                        <div style="font-weight:500;">${g.title || g.id}</div>
                        <div style="font-size:10px; color:#888;">${g.id} • <span style="color:${statusColor}">${elementsCount} elements</span></div>
                    </td>
                    <td style="padding:8px; color:#666;">${g.organisation || '-'}</td>
                    <td style="padding:8px; text-align:center; color:#666;">${g.yearProduced || '-'}</td>
                    <td style="padding:8px; color:#666;">${dateStr}</td>
                `;

                // Allow clicking the row to toggle checkbox
                tr.addEventListener('click', (e) => {
                    if (e.target.type !== 'checkbox') {
                        const cb = tr.querySelector('.batch-regen-cb');
                        cb.checked = !cb.checked;
                        updateBatchSelectedCount();
                    }
                });

                batchRegenTableBody.appendChild(tr);
            });

            if (batchRegenTotalInfo) batchRegenTotalInfo.textContent = `Showing ${filteredGuidelines.length} of ${allGuidelinesForBatch.length}`;

            // Re-add checkbox listeners
            document.querySelectorAll('.batch-regen-cb').forEach(cb => {
                cb.addEventListener('change', updateBatchSelectedCount);
            });

            updateBatchSelectedCount();
        }

        function updateBatchSelectedCount() {
            const count = document.querySelectorAll('.batch-regen-cb:checked').length;
            if (batchRegenSelectedCount) batchRegenSelectedCount.textContent = count;
            if (batchRegenSelectAll) {
                const totalVisible = document.querySelectorAll('.batch-regen-cb').length;
                batchRegenSelectAll.checked = totalVisible > 0 && count === totalVisible;
            }
        }

        // Event Listeners
        if (batchRegenLoadBtn) batchRegenLoadBtn.addEventListener('click', loadGuidelinesForBatchRegen);
        if (batchRegenSearch) batchRegenSearch.addEventListener('input', applyBatchRegenFilters);
        if (batchRegenOrgFilter) batchRegenOrgFilter.addEventListener('change', applyBatchRegenFilters);
        if (batchRegenYearFilter) batchRegenYearFilter.addEventListener('change', applyBatchRegenFilters);
        if (batchRegenDateFilter) batchRegenDateFilter.addEventListener('change', applyBatchRegenFilters);

        if (batchRegenSelectAll) {
            batchRegenSelectAll.addEventListener('change', () => {
                const checked = batchRegenSelectAll.checked;
                document.querySelectorAll('.batch-regen-cb').forEach(cb => {
                    cb.checked = checked;
                });
                updateBatchSelectedCount();
            });
        }

        if (regenerateAuditableFilteredBtn) {
            regenerateAuditableFilteredBtn.addEventListener('click', async () => {
                const selectedIds = Array.from(document.querySelectorAll('.batch-regen-cb:checked'))
                    .map(cb => cb.getAttribute('data-id'));

                if (selectedIds.length === 0) {
                    alert('Please select at least one guideline from the table');
                    return;
                }

                if (!confirm(`Regenerate auditable elements for ${selectedIds.length} selected guidelines?\n\nThis will overwrite existing elements.`)) {
                    return;
                }

                await runRegeneration({ guidelineIds: selectedIds });
            });
        }

        if (regenerateAuditableAllBtn) {
            regenerateAuditableAllBtn.addEventListener('click', async () => {
                if (!confirm('Regenerate auditable elements for ALL guidelines?\n\nThis will overwrite existing elements.')) {
                    return;
                }
                await runRegeneration({ processAll: true });
            });
        }

        async function runRegeneration(body) {
            try {
                if (regenerateAuditableFilteredBtn) regenerateAuditableFilteredBtn.disabled = true;
                if (regenerateAuditableAllBtn) regenerateAuditableAllBtn.disabled = true;

                if (auditableStatus) {
                    auditableStatus.style.display = 'block';
                    auditableStatus.innerHTML = '<strong>Queueing guidelines for processing...</strong>';
                }

                const token = await auth.currentUser.getIdToken();
                const response = await fetch(`${SERVER_URL}/regenerateAuditableElements`, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(body)
                });

                const result = await response.json();

                if (result.success) {
                    let html = `<span style="color:green;">✅ <strong>${result.message}</strong></span><br><br>`;
                    html += `<strong>Queued:</strong> ${result.queued} guidelines<br>`;
                    html += `<strong>Skipped (no content):</strong> ${result.skippedNoContent}<br><br>`;
                    html += `<em>Check server logs for progress.</em><br>`;
                    html += `<strong>Batch ID:</strong> <code>${result.batchId}</code>`;
                    auditableStatus.innerHTML = html;
                } else {
                    auditableStatus.innerHTML = `<span style="color:red;">❌ Error: ${result.error || 'Unknown error'}</span>`;
                }
            } catch (error) {
                console.error('Error queueing regeneration:', error);
                if (auditableStatus) auditableStatus.innerHTML = `<span style="color:red;">❌ Error: ${error.message}</span>`;
            } finally {
                if (regenerateAuditableFilteredBtn) regenerateAuditableFilteredBtn.disabled = false;
                if (regenerateAuditableAllBtn) regenerateAuditableAllBtn.disabled = false;
            }
        }

        // Load when maintenance tab becomes active
        document.querySelector('[data-content="maintenanceContent"]')?.addEventListener('click', () => {
            if (allGuidelinesForBatch.length === 0) {
                loadGuidelinesForBatchRegen();
            }
        });

        // ============================================
        // ENDPOINT PERFORMANCE MONITOR
        // ============================================
        let autoRefreshTimingsInterval = null;

        async function fetchEndpointTimings() {
            const user = auth.currentUser;
            const summaryEl = document.getElementById('timingsSummary');
            const tbodyEl = document.getElementById('timingsTableBody');

            if (!user) {
                if (summaryEl) summaryEl.textContent = 'Please log in to view timings';
                return;
            }

            try {
                if (summaryEl) summaryEl.textContent = 'Loading...';

                const token = await user.getIdToken();
                const response = await fetch(`${SERVER_URL}/api/endpoint-timings`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });

                if (!response.ok) throw new Error('Failed to fetch timings');

                const data = await response.json();
                renderTimingsTable(data);
            } catch (error) {
                console.error('Error fetching timings:', error);
                if (summaryEl) summaryEl.textContent = `Error: ${error.message}`;
            }
        }

        // Toggle between summary and detail views
        let currentView = 'detail'; // 'detail' or 'summary'

        document.getElementById('toggleViewBtn')?.addEventListener('click', () => {
            currentView = currentView === 'detail' ? 'summary' : 'detail';
            const btn = document.getElementById('toggleViewBtn');
            const summaryView = document.getElementById('summaryView');
            const detailView = document.getElementById('detailView');

            if (currentView === 'summary') {
                btn.textContent = '📋 Detail View';
                summaryView.style.display = 'block';
                detailView.style.display = 'none';
            } else {
                btn.textContent = '📊 Summary View';
                summaryView.style.display = 'none';
                detailView.style.display = 'block';
            }

            // Re-render if we have data
            if (window.lastTimingsData) {
                renderTimingsTable(window.lastTimingsData);
            }
        });

        function renderTimingsTable(data) {
            window.lastTimingsData = data; // Store for view toggle

            const tbody = document.getElementById('timingsTableBody');
            const summaryTbody = document.getElementById('summaryTableBody');
            const summary = document.getElementById('timingsSummary');

            if (!summary) return;

            summary.textContent = `${data.summary.totalRequests} requests | ${data.summary.uniqueEndpoints || 0} endpoints | Avg: ${data.summary.avgDuration}ms`;

            // Render Summary View (Aggregated Stats)
            if (summaryTbody && data.aggregatedEndpoints) {
                if (data.aggregatedEndpoints.length === 0) {
                    summaryTbody.innerHTML = '<tr><td colspan="7" style="padding:20px;text-align:center;color:#666;">No timing data available yet</td></tr>';
                } else {
                    // Aggregate model timing data for chunk-based endpoints
                    const endpointModelStats = {};
                    data.timings.forEach(t => {
                        if (t.steps && t.steps.length > 0) {
                            const key = `${t.method} ${t.endpoint}`;
                            if (!endpointModelStats[key]) {
                                endpointModelStats[key] = {};
                            }
                            t.steps.forEach(s => {
                                // Check if this is a chunk step (contains provider name and 'chunk')
                                const isChunkStep = s.name.includes('chunk') &&
                                    (s.name.includes('DeepSeek') || s.name.includes('Mistral') ||
                                        s.name.includes('Anthropic') || s.name.includes('OpenAI') || s.name.includes('Gemini'));
                                if (isChunkStep) {
                                    const provider = s.name.split(' ')[0];
                                    if (!endpointModelStats[key][provider]) {
                                        endpointModelStats[key][provider] = { count: 0, totalDuration: 0, maxDuration: 0 };
                                    }
                                    endpointModelStats[key][provider].count++;
                                    endpointModelStats[key][provider].totalDuration += s.duration;
                                    endpointModelStats[key][provider].maxDuration = Math.max(endpointModelStats[key][provider].maxDuration, s.duration);
                                }
                            });
                        }
                    });

                    summaryTbody.innerHTML = data.aggregatedEndpoints.map((e, idx) => {
                        const avgColor = e.avgDuration > 10000 ? '#dc3545' : e.avgDuration > 3000 ? '#ff9800' : '#28a745';
                        const shortEndpoint = e.endpoint.length > 60 ? e.endpoint.substring(0, 57) + '...' : e.endpoint;
                        const key = `${e.method} ${e.endpoint}`;
                        const modelStats = endpointModelStats[key];
                        const hasModelStats = modelStats && Object.keys(modelStats).length > 0;
                        const expandIcon = hasModelStats ? '<span class="summary-expand-icon" style="margin-right:4px;font-size:10px;">▶</span>' : '';

                        // Build model summary row if applicable
                        let modelRowHtml = '';
                        if (hasModelStats) {
                            const modelSummary = Object.entries(modelStats)
                                .map(([provider, stats]) => ({
                                    provider,
                                    count: stats.count,
                                    avgDuration: Math.round(stats.totalDuration / stats.count),
                                    maxDuration: stats.maxDuration
                                }))
                                .sort((a, b) => b.avgDuration - a.avgDuration);

                            modelRowHtml = `
                                <tr id="summary-model-row-${idx}" class="summary-model-row" style="display:none;background:#f0f7ff;">
                                    <td colspan="7" style="padding:12px 8px 12px 30px;">
                                        <div style="padding:8px;background:#e8f4fd;border-radius:4px;border:1px solid #bee5eb;">
                                            <strong style="color:#0c5460;">🤖 Model Performance (${e.count} request${e.count > 1 ? 's' : ''})</strong>
                                            <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(130px, 1fr));gap:8px;margin-top:8px;">
                                                ${modelSummary.map(m => {
                                const mAvgColor = m.avgDuration > 30000 ? '#dc3545' : m.avgDuration > 15000 ? '#ff9800' : '#28a745';
                                return `<div style="background:#fff;padding:8px;border-radius:4px;text-align:center;border:1px solid #dee2e6;">
                                                        <div style="font-weight:bold;font-size:12px;color:#333;">${m.provider}</div>
                                                        <div style="color:${mAvgColor};font-weight:bold;font-size:14px;">${(m.avgDuration / 1000).toFixed(1)}s avg</div>
                                                        <div style="font-size:10px;color:#666;">${m.count} chunk${m.count > 1 ? 's' : ''} · max ${(m.maxDuration / 1000).toFixed(1)}s</div>
                                                    </div>`;
                            }).join('')}
                                            </div>
                                        </div>
                                    </td>
                                </tr>`;
                        }

                        return `<tr style="border-bottom:1px solid #eee;cursor:${hasModelStats ? 'pointer' : 'default'};" onclick="${hasModelStats ? `toggleSummaryModelRow(${idx})` : ''}">
                            <td style="padding:6px 8px;"><code style="background:#f1f3f4;padding:2px 6px;border-radius:3px;">${e.method}</code></td>
                            <td style="padding:6px 8px;max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${e.endpoint}">${expandIcon}${shortEndpoint}${hasModelStats ? ' 🤖' : ''}</td>
                            <td style="padding:6px 8px;text-align:center;">${e.count}</td>
                            <td style="padding:6px 8px;text-align:right;font-weight:bold;color:${avgColor};">${e.avgDuration.toLocaleString()}ms</td>
                            <td style="padding:6px 8px;text-align:right;color:#666;">${e.minDuration.toLocaleString()}ms</td>
                            <td style="padding:6px 8px;text-align:right;color:#666;">${e.maxDuration.toLocaleString()}ms</td>
                            <td style="padding:6px 8px;text-align:center;color:${e.errorCount > 0 ? '#dc3545' : '#28a745'};">${e.errorCount}${e.errorRate > 0 ? ` (${e.errorRate}%)` : ''}</td>
                        </tr>${modelRowHtml}`;
                    }).join('');
                }
            }

            // Toggle summary model row visibility
            window.toggleSummaryModelRow = function (idx) {
                const modelRow = document.getElementById(`summary-model-row-${idx}`);
                if (modelRow) {
                    const isHidden = modelRow.style.display === 'none';
                    modelRow.style.display = isHidden ? 'table-row' : 'none';

                    // Update expand icon
                    const mainRow = modelRow.previousElementSibling;
                    const expandIcon = mainRow?.querySelector('.summary-expand-icon');
                    if (expandIcon) {
                        expandIcon.textContent = isHidden ? '▼' : '▶';
                    }
                }
            };

            // Render Detail View (Recent Requests)
            if (tbody) {
                if (data.timings.length === 0) {
                    tbody.innerHTML = '<tr><td colspan="5" style="padding:20px;text-align:center;color:#666;">No timing data available yet</td></tr>';
                    return;
                }

                tbody.innerHTML = data.timings.map((t, idx) => {
                    const durationColor = t.duration > 10000 ? '#dc3545' :
                        t.duration > 3000 ? '#ff9800' : '#28a745';
                    const statusColor = t.status >= 400 ? '#dc3545' : '#28a745';
                    const time = new Date(t.requestTime).toLocaleTimeString();
                    const shortEndpoint = t.endpoint.length > 50 ? t.endpoint.substring(0, 47) + '...' : t.endpoint;
                    const hasSteps = t.steps && t.steps.length > 0;
                    const expandIcon = hasSteps ? '<span class="expand-icon" style="margin-right:4px;font-size:10px;">▶</span>' : '';

                    // Create steps row HTML if steps exist
                    // Check if this is a chunk distribution request (has model steps)
                    const chunkSteps = hasSteps ? t.steps.filter(s => s.name.includes('chunk') && (s.name.includes('DeepSeek') || s.name.includes('Mistral') || s.name.includes('Anthropic') || s.name.includes('OpenAI') || s.name.includes('Gemini'))) : [];
                    const otherSteps = hasSteps ? t.steps.filter(s => !chunkSteps.includes(s)) : [];
                    const hasChunkSteps = chunkSteps.length > 0;

                    // Aggregate model stats from chunk steps
                    let modelSummaryHtml = '';
                    if (hasChunkSteps) {
                        const modelStats = {};
                        chunkSteps.forEach(s => {
                            const provider = s.name.split(' ')[0]; // Extract provider name
                            if (!modelStats[provider]) {
                                modelStats[provider] = { count: 0, totalDuration: 0, maxDuration: 0 };
                            }
                            modelStats[provider].count++;
                            modelStats[provider].totalDuration += s.duration;
                            modelStats[provider].maxDuration = Math.max(modelStats[provider].maxDuration, s.duration);
                        });

                        const modelSummary = Object.entries(modelStats)
                            .map(([provider, stats]) => ({
                                provider,
                                count: stats.count,
                                avgDuration: Math.round(stats.totalDuration / stats.count),
                                maxDuration: stats.maxDuration
                            }))
                            .sort((a, b) => b.avgDuration - a.avgDuration);

                        modelSummaryHtml = `
                            <div style="margin-bottom:10px;padding:8px;background:#e8f4fd;border-radius:4px;border:1px solid #bee5eb;">
                                <strong style="color:#0c5460;">🤖 Model Performance Summary</strong>
                                <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(120px, 1fr));gap:8px;margin-top:6px;">
                                    ${modelSummary.map(m => {
                            const avgColor = m.avgDuration > 30000 ? '#dc3545' : m.avgDuration > 15000 ? '#ff9800' : '#28a745';
                            return `<div style="background:#fff;padding:6px;border-radius:4px;text-align:center;">
                                            <div style="font-weight:bold;font-size:11px;">${m.provider}</div>
                                            <div style="color:${avgColor};font-weight:bold;">${(m.avgDuration / 1000).toFixed(1)}s avg</div>
                                            <div style="font-size:10px;color:#666;">${m.count} chunk${m.count > 1 ? 's' : ''} · max ${(m.maxDuration / 1000).toFixed(1)}s</div>
                                        </div>`;
                        }).join('')}
                                </div>
                            </div>`;
                    }

                    const stepsRowHtml = hasSteps ? `
                        <tr id="steps-row-${idx}" class="steps-row" style="display:none;background:#f8f9fa;">
                            <td colspan="5" style="padding:8px 8px 8px 30px;">
                                <div style="font-size:12px;color:#666;">
                                    ${modelSummaryHtml}
                                    ${otherSteps.map(s => {
                        const stepColor = s.duration > 5000 ? '#dc3545' : s.duration > 1000 ? '#ff9800' : '#28a745';
                        return `<div style="display:flex;justify-content:space-between;padding:2px 0;border-bottom:1px dotted #ddd;">
                                            <span>${s.name}</span>
                                            <strong style="color:${stepColor};">${s.duration.toLocaleString()}ms</strong>
                                        </div>`;
                    }).join('')}
                                    ${hasChunkSteps ? `
                                        <details style="margin-top:8px;">
                                            <summary style="cursor:pointer;color:#007bff;font-size:11px;">Show ${chunkSteps.length} individual chunk timings...</summary>
                                            <div style="margin-top:4px;">
                                                ${chunkSteps.map(s => {
                        const stepColor = s.duration > 30000 ? '#dc3545' : s.duration > 15000 ? '#ff9800' : '#28a745';
                        return `<div style="display:flex;justify-content:space-between;padding:2px 0;border-bottom:1px dotted #ddd;">
                                                        <span>${s.name}</span>
                                                        <strong style="color:${stepColor};">${s.duration.toLocaleString()}ms</strong>
                                                    </div>`;
                    }).join('')}
                                            </div>
                                        </details>
                                    ` : ''}
                                </div>
                            </td>
                        </tr>` : '';

                    return `<tr style="border-bottom:1px solid #eee;cursor:${hasSteps ? 'pointer' : 'default'};" onclick="${hasSteps ? `toggleStepsRow(${idx})` : ''}">
                        <td style="padding:6px 8px;white-space:nowrap;">${expandIcon}${time}</td>
                        <td style="padding:6px 8px;"><code style="background:#f1f3f4;padding:2px 6px;border-radius:3px;">${t.method}</code></td>
                        <td style="padding:6px 8px;max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${t.endpoint}">${shortEndpoint}</td>
                        <td style="padding:6px 8px;text-align:center;color:${statusColor};font-weight:bold;">${t.status}</td>
                        <td style="padding:6px 8px;text-align:right;font-weight:bold;color:${durationColor};">${t.duration.toLocaleString()}ms${hasSteps ? ' 📊' : ''}</td>
                    </tr>${stepsRowHtml}`;
                }).join('');
            }
        }

        // Toggle steps row visibility
        window.toggleStepsRow = function (idx) {
            const stepsRow = document.getElementById(`steps-row-${idx}`);
            if (stepsRow) {
                const isHidden = stepsRow.style.display === 'none';
                stepsRow.style.display = isHidden ? 'table-row' : 'none';

                // Update expand icon
                const mainRow = stepsRow.previousElementSibling;
                const expandIcon = mainRow?.querySelector('.expand-icon');
                if (expandIcon) {
                    expandIcon.textContent = isHidden ? '▼' : '▶';
                }
            }
        };

        // Event listeners for timing buttons
        const refreshTimingsBtn = document.getElementById('refreshTimingsBtn');
        const autoRefreshTimingsBtn = document.getElementById('autoRefreshTimingsBtn');

        if (refreshTimingsBtn) {
            refreshTimingsBtn.addEventListener('click', fetchEndpointTimings);
        }

        if (autoRefreshTimingsBtn) {
            autoRefreshTimingsBtn.addEventListener('click', function () {
                if (autoRefreshTimingsInterval) {
                    clearInterval(autoRefreshTimingsInterval);
                    autoRefreshTimingsInterval = null;
                    this.textContent = '⏱️ Auto-refresh: OFF';
                    this.style.backgroundColor = '#6c757d';
                } else {
                    fetchEndpointTimings();
                    autoRefreshTimingsInterval = setInterval(fetchEndpointTimings, 5000);
                    this.textContent = '⏱️ Auto-refresh: ON';
                    this.style.backgroundColor = '#28a745';
                }
            });
        }

        // ============================================
        // MODELS TAB HANDLERS
        // ============================================

        // Store model registry data and test results
        let modelRegistry = {};
        let modelTestResults = {};
        let usageChart = null;

        // Sorting state for model registry
        let modelRegistrySort = { column: null, direction: 'asc' };

        // Sort model registry and re-render
        window.sortModelRegistry = function (column) {
            // Toggle direction if same column, otherwise default to ascending
            if (modelRegistrySort.column === column) {
                modelRegistrySort.direction = modelRegistrySort.direction === 'asc' ? 'desc' : 'asc';
            } else {
                modelRegistrySort.column = column;
                modelRegistrySort.direction = 'asc';
            }

            // Update sort icons
            const costInputIcon = document.getElementById('costInputSortIcon');
            const costOutputIcon = document.getElementById('costOutputSortIcon');

            if (costInputIcon) {
                costInputIcon.textContent = column === 'costInput'
                    ? (modelRegistrySort.direction === 'asc' ? '↑' : '↓')
                    : '⇅';
            }
            if (costOutputIcon) {
                costOutputIcon.textContent = column === 'costOutput'
                    ? (modelRegistrySort.direction === 'asc' ? '↑' : '↓')
                    : '⇅';
            }

            // Re-render the table
            renderModelRegistryTable();
        };

        // Render model registry table (separate from fetch for re-sorting)
        function renderModelRegistryTable() {
            const tbody = document.getElementById('modelRegistryTableBody');
            const summary = document.getElementById('modelRegistrySummary');

            if (!tbody || Object.keys(modelRegistry).length === 0) return;

            // Flatten all models with their provider info
            let allModels = [];
            for (const [providerName, providerData] of Object.entries(modelRegistry)) {
                providerData.models.forEach(model => {
                    allModels.push({
                        providerName,
                        hasApiKey: providerData.hasApiKey,
                        ...model
                    });
                });
            }

            // Sort if a column is selected
            if (modelRegistrySort.column) {
                allModels.sort((a, b) => {
                    let valueA, valueB;
                    if (modelRegistrySort.column === 'costInput') {
                        valueA = a.costPer1kInput;
                        valueB = b.costPer1kInput;
                    } else if (modelRegistrySort.column === 'costOutput') {
                        valueA = a.costPer1kOutput;
                        valueB = b.costPer1kOutput;
                    }

                    const multiplier = modelRegistrySort.direction === 'asc' ? 1 : -1;
                    return (valueA - valueB) * multiplier;
                });
            }

            // Render the table
            let totalModels = allModels.length;
            let availableProviders = new Set();
            let html = '';

            // When sorted, show provider for each row; when unsorted, group by provider
            const isSorted = modelRegistrySort.column !== null;

            if (isSorted) {
                // Sorted view: show provider for each model
                allModels.forEach(model => {
                    if (model.hasApiKey) availableProviders.add(model.providerName);

                    const testResult = modelTestResults[`${model.providerName}/${model.model}`];
                    const statusIcon = testResult ?
                        (testResult.status === 'OK' ? '✅' : testResult.status === 'SKIP' ? '⏭️' : '❌') :
                        (model.hasApiKey ? '⚪' : '🔒');
                    const statusText = testResult ?
                        `${testResult.status} (${testResult.ms}ms)` :
                        (model.hasApiKey ? 'Not tested' : 'No API key');

                    html += `<tr style="border-bottom:1px solid #eee;${!model.hasApiKey ? 'opacity:0.6;' : ''}">
                        <td style="padding:8px;font-weight:500;">${model.providerName}</td>
                        <td style="padding:8px;">
                            <div style="font-weight:500;">${model.displayName}</div>
                            <div style="font-size:11px;color:#666;">${model.model}</div>
                        </td>
                        <td style="padding:8px;text-align:right;font-family:monospace;">$${model.costPer1kInput.toFixed(5)}/1k</td>
                        <td style="padding:8px;text-align:right;font-family:monospace;">$${model.costPer1kOutput.toFixed(5)}/1k</td>
                        <td style="padding:8px;text-align:center;" title="${statusText}">${statusIcon}</td>
                        <td style="padding:8px;text-align:center;">
                            <button class="dev-btn" style="padding:4px 8px;font-size:11px;" 
                                onclick="testSingleModel('${model.providerName}', '${model.model}')"
                                ${!model.hasApiKey ? 'disabled' : ''}>
                                Test
                            </button>
                        </td>
                    </tr>`;
                });
            } else {
                // Default grouped view by provider
                for (const [providerName, providerData] of Object.entries(modelRegistry)) {
                    if (providerData.hasApiKey) availableProviders.add(providerName);

                    providerData.models.forEach((model, idx) => {
                        const testResult = modelTestResults[`${providerName}/${model.model}`];
                        const statusIcon = testResult ?
                            (testResult.status === 'OK' ? '✅' : testResult.status === 'SKIP' ? '⏭️' : '❌') :
                            (providerData.hasApiKey ? '⚪' : '🔒');
                        const statusText = testResult ?
                            `${testResult.status} (${testResult.ms}ms)` :
                            (providerData.hasApiKey ? 'Not tested' : 'No API key');

                        html += `<tr style="border-bottom:1px solid #eee;${!providerData.hasApiKey ? 'opacity:0.6;' : ''}">
                            <td style="padding:8px;font-weight:${idx === 0 ? 'bold' : 'normal'};">${idx === 0 ? providerName : ''}</td>
                            <td style="padding:8px;">
                                <div style="font-weight:500;">${model.displayName}</div>
                                <div style="font-size:11px;color:#666;">${model.model}</div>
                            </td>
                            <td style="padding:8px;text-align:right;font-family:monospace;">$${model.costPer1kInput.toFixed(5)}/1k</td>
                            <td style="padding:8px;text-align:right;font-family:monospace;">$${model.costPer1kOutput.toFixed(5)}/1k</td>
                            <td style="padding:8px;text-align:center;" title="${statusText}">${statusIcon}</td>
                            <td style="padding:8px;text-align:center;">
                                <button class="dev-btn" style="padding:4px 8px;font-size:11px;" 
                                    onclick="testSingleModel('${providerName}', '${model.model}')"
                                    ${!providerData.hasApiKey ? 'disabled' : ''}>
                                    Test
                                </button>
                            </td>
                        </tr>`;
                    });
                }
            }

            tbody.innerHTML = html || '<tr><td colspan="6" style="padding:20px;text-align:center;">No models found</td></tr>';
            summary.textContent = `${totalModels} models across ${Object.keys(modelRegistry).length} providers (${availableProviders.size} with API keys)`;
        }

        // Fetch and display model registry
        async function fetchModelRegistry() {
            const tbody = document.getElementById('modelRegistryTableBody');
            const summary = document.getElementById('modelRegistrySummary');

            if (!tbody) return;

            try {
                summary.textContent = 'Loading registry...';

                const user = auth.currentUser;
                if (!user) {
                    summary.textContent = 'Please log in';
                    return;
                }

                const token = await user.getIdToken();
                const response = await fetch(`${SERVER_URL}/getModelRegistry`, {
                    method: 'GET',
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json'
                    }
                });

                const data = await response.json();

                if (!data.success) {
                    throw new Error(data.message || 'Failed to fetch registry');
                }

                modelRegistry = data.registry;

                // Reset sort icons when refreshing data
                const costInputIcon = document.getElementById('costInputSortIcon');
                const costOutputIcon = document.getElementById('costOutputSortIcon');
                if (costInputIcon) {
                    costInputIcon.textContent = modelRegistrySort.column === 'costInput'
                        ? (modelRegistrySort.direction === 'asc' ? '↑' : '↓')
                        : '⇅';
                }
                if (costOutputIcon) {
                    costOutputIcon.textContent = modelRegistrySort.column === 'costOutput'
                        ? (modelRegistrySort.direction === 'asc' ? '↑' : '↓')
                        : '⇅';
                }

                // Render the table using shared function
                renderModelRegistryTable();

            } catch (error) {
                console.error('Error fetching model registry:', error);
                summary.textContent = 'Error: ' + error.message;
            }
        }

        // Test a single model
        window.testSingleModel = async function (provider, model) {
            const key = `${provider}/${model}`;

            try {
                const user = auth.currentUser;
                if (!user) return;

                const token = await user.getIdToken();
                const response = await fetch(`${SERVER_URL}/testModel`, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ provider, model })
                });

                const data = await response.json();
                modelTestResults[key] = data;

                // Refresh the display
                fetchModelRegistry();

            } catch (error) {
                console.error('Error testing model:', error);
                modelTestResults[key] = { status: 'FAIL', message: error.message, ms: 0 };
                fetchModelRegistry();
            }
        };

        // Test all models
        async function testAllModels() {
            const summary = document.getElementById('modelRegistrySummary');
            const btn = document.getElementById('testAllModelsBtn');

            if (!btn) return;

            try {
                const originalText = btn.textContent;
                btn.textContent = '🔄 Testing...';
                btn.disabled = true;
                summary.textContent = 'Testing all models...';

                const user = auth.currentUser;
                if (!user) {
                    summary.textContent = 'Please log in';
                    return;
                }

                const token = await user.getIdToken();

                // Collect all models to test
                const modelsToTest = [];
                for (const [providerName, providerData] of Object.entries(modelRegistry)) {
                    if (providerData.hasApiKey) {
                        providerData.models.forEach(model => {
                            modelsToTest.push({ provider: providerName, model: model.model });
                        });
                    }
                }

                // Test in parallel (with some concurrency limit)
                let completed = 0;
                const results = await Promise.all(modelsToTest.map(async ({ provider, model }) => {
                    try {
                        const response = await fetch(`${SERVER_URL}/testModel`, {
                            method: 'POST',
                            headers: {
                                'Authorization': `Bearer ${token}`,
                                'Content-Type': 'application/json'
                            },
                            body: JSON.stringify({ provider, model })
                        });
                        const data = await response.json();
                        completed++;
                        summary.textContent = `Testing... ${completed}/${modelsToTest.length}`;
                        return { key: `${provider}/${model}`, ...data };
                    } catch (err) {
                        return { key: `${provider}/${model}`, status: 'FAIL', message: err.message, ms: 0 };
                    }
                }));

                // Store results
                results.forEach(r => {
                    modelTestResults[r.key] = r;
                });

                const passed = results.filter(r => r.status === 'OK').length;
                const failed = results.filter(r => r.status === 'FAIL').length;
                summary.innerHTML = `<span style="color:#28a745;">${passed} passed</span>, <span style="color:#dc3545;">${failed} failed</span>`;

                // Refresh display
                fetchModelRegistry();

            } catch (error) {
                console.error('Error testing all models:', error);
                summary.textContent = 'Error: ' + error.message;
            } finally {
                const btn = document.getElementById('testAllModelsBtn');
                if (btn) {
                    btn.textContent = '🔍 Test All Models';
                    btn.disabled = false;
                }
            }
        }

        // Fetch and display usage analytics
        async function fetchUsageAnalytics() {
            const summary = document.getElementById('analyticsSummary');
            const timeRange = document.getElementById('analyticsTimeRange')?.value || '24h';

            try {
                summary.textContent = 'Loading analytics...';

                const user = auth.currentUser;
                if (!user) {
                    summary.textContent = 'Please log in';
                    return;
                }

                const token = await user.getIdToken();
                const response = await fetch(`${SERVER_URL}/getAIUsageStats?timeRange=${timeRange}`, {
                    method: 'GET',
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json'
                    }
                });

                const data = await response.json();

                if (!data.success) {
                    throw new Error(data.message || 'Failed to fetch analytics');
                }

                // Update summary stats
                document.getElementById('statTotalRequests').textContent = data.aggregated.totalRequests.toLocaleString();
                document.getElementById('statTotalTokens').textContent = data.aggregated.totalTokens.toLocaleString();
                document.getElementById('statTotalCost').textContent = `$${data.aggregated.totalCost.toFixed(4)}`;
                document.getElementById('statAvgLatency').textContent = `${data.aggregated.avgLatency}ms`;

                // Update provider breakdown
                const providerContainer = document.getElementById('providerBreakdownContainer');
                if (providerContainer && data.aggregated.byProvider) {
                    const providers = Object.entries(data.aggregated.byProvider);
                    if (providers.length > 0) {
                        providerContainer.innerHTML = providers.map(([name, stats]) => {
                            const costColor = stats.cost > 0.1 ? '#dc3545' : stats.cost > 0.01 ? '#ff9800' : '#28a745';
                            return `<div style="background:#f8f9fa;padding:12px;border-radius:6px;text-align:center;">
                                <div style="font-weight:bold;margin-bottom:5px;">${name}</div>
                                <div style="font-size:20px;color:#007bff;">${stats.requests}</div>
                                <div style="font-size:11px;color:#666;">requests</div>
                                <div style="font-size:12px;color:${costColor};margin-top:5px;">$${stats.cost.toFixed(4)}</div>
                                <div style="font-size:11px;color:#666;">${stats.avgLatency}ms avg</div>
                            </div>`;
                        }).join('');
                    } else {
                        providerContainer.innerHTML = '<div style="padding:15px;text-align:center;color:#666;">No usage data in this period</div>';
                    }
                }

                // Update time series chart
                if (data.timeSeries && data.timeSeries.length > 0) {
                    updateUsageChart(data.timeSeries);
                }

                // Update recent logs table
                const logsBody = document.getElementById('recentLogsTableBody');
                if (logsBody && data.recentLogs) {
                    if (data.recentLogs.length > 0) {
                        logsBody.innerHTML = data.recentLogs.map(log => {
                            const time = new Date(log.timestamp).toLocaleString();
                            const statusIcon = log.success ? '✅' : '❌';
                            const latencyColor = log.latencyMs > 10000 ? '#dc3545' : log.latencyMs > 3000 ? '#ff9800' : '#28a745';
                            return `<tr style="border-bottom:1px solid #eee;">
                                <td style="padding:6px;font-size:11px;">${time}</td>
                                <td style="padding:6px;">${log.provider || '-'}</td>
                                <td style="padding:6px;font-size:11px;">${log.model || '-'}</td>
                                <td style="padding:6px;text-align:right;">${(log.totalTokens || 0).toLocaleString()}</td>
                                <td style="padding:6px;text-align:right;">$${(log.estimatedCostUsd || 0).toFixed(5)}</td>
                                <td style="padding:6px;text-align:right;color:${latencyColor};">${log.latencyMs || 0}ms</td>
                                <td style="padding:6px;text-align:center;">${statusIcon}</td>
                            </tr>`;
                        }).join('');
                    } else {
                        logsBody.innerHTML = '<tr><td colspan="7" style="padding:20px;text-align:center;color:#666;">No logs in this period</td></tr>';
                    }
                }

                summary.textContent = `${data.totalLogsInRange} interactions in ${timeRange}`;

            } catch (error) {
                console.error('Error fetching usage analytics:', error);
                summary.textContent = 'Error: ' + error.message;
            }
        }

        // Update the usage chart
        function updateUsageChart(timeSeries) {
            const ctx = document.getElementById('usageChart');
            if (!ctx) return;

            // Destroy existing chart if any
            if (usageChart) {
                usageChart.destroy();
            }

            const labels = timeSeries.map(d => {
                const date = new Date(d.hour);
                return date.toLocaleString('en-GB', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
            });

            usageChart = new Chart(ctx, {
                type: 'line',
                data: {
                    labels,
                    datasets: [
                        {
                            label: 'Requests',
                            data: timeSeries.map(d => d.requests),
                            borderColor: '#007bff',
                            backgroundColor: 'rgba(0, 123, 255, 0.1)',
                            fill: true,
                            tension: 0.3,
                            yAxisID: 'y'
                        },
                        {
                            label: 'Cost ($)',
                            data: timeSeries.map(d => d.cost),
                            borderColor: '#dc3545',
                            backgroundColor: 'rgba(220, 53, 69, 0.1)',
                            fill: false,
                            tension: 0.3,
                            yAxisID: 'y1'
                        }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    interaction: {
                        mode: 'index',
                        intersect: false
                    },
                    scales: {
                        x: {
                            display: true,
                            grid: { display: false }
                        },
                        y: {
                            type: 'linear',
                            display: true,
                            position: 'left',
                            title: { display: true, text: 'Requests' }
                        },
                        y1: {
                            type: 'linear',
                            display: true,
                            position: 'right',
                            title: { display: true, text: 'Cost ($)' },
                            grid: { drawOnChartArea: false }
                        }
                    },
                    plugins: {
                        legend: { position: 'top' }
                    }
                }
            });
        }

        // Event listeners for Models tab
        const refreshModelRegistryBtn = document.getElementById('refreshModelRegistryBtn');
        if (refreshModelRegistryBtn) {
            refreshModelRegistryBtn.addEventListener('click', fetchModelRegistry);
        }

        const testAllModelsBtn = document.getElementById('testAllModelsBtn');
        if (testAllModelsBtn) {
            testAllModelsBtn.addEventListener('click', async () => {
                // First ensure registry is loaded
                if (Object.keys(modelRegistry).length === 0) {
                    await fetchModelRegistry();
                }
                await testAllModels();
            });
        }

        const refreshAnalyticsBtn = document.getElementById('refreshAnalyticsBtn');
        if (refreshAnalyticsBtn) {
            refreshAnalyticsBtn.addEventListener('click', fetchUsageAnalytics);
        }

        const analyticsTimeRange = document.getElementById('analyticsTimeRange');
        if (analyticsTimeRange) {
            analyticsTimeRange.addEventListener('change', fetchUsageAnalytics);
        }

        // ============================================
        // TRANSCRIPTS MANAGEMENT PANEL
        // ============================================

        // Store loaded conditions
        let loadedConditions = {};
        let currentEditingConditionId = null;

        // Load conditions button
        const loadTranscriptsBtn = document.getElementById('loadTranscriptsBtn');
        if (loadTranscriptsBtn) {
            loadTranscriptsBtn.addEventListener('click', loadAllConditions);
        }

        // Add condition button
        const addConditionBtn = document.getElementById('addConditionBtn');
        if (addConditionBtn) {
            addConditionBtn.addEventListener('click', addNewCondition);
        }

        // Filter and search handlers
        const transcriptCategoryFilter = document.getElementById('transcriptCategoryFilter');
        const transcriptStatusFilter = document.getElementById('transcriptStatusFilter');
        const transcriptSearchInput = document.getElementById('transcriptSearchInput');

        if (transcriptCategoryFilter) {
            transcriptCategoryFilter.addEventListener('change', filterAndRenderConditions);
        }
        if (transcriptStatusFilter) {
            transcriptStatusFilter.addEventListener('change', filterAndRenderConditions);
        }
        if (transcriptSearchInput) {
            transcriptSearchInput.addEventListener('input', debounce(filterAndRenderConditions, 300));
        }

        // Modal handlers
        const closeTranscriptEditorBtn = document.getElementById('closeTranscriptEditorBtn');
        if (closeTranscriptEditorBtn) {
            closeTranscriptEditorBtn.addEventListener('click', closeTranscriptEditor);
        }

        const saveTranscriptBtn = document.getElementById('saveTranscriptBtn');
        if (saveTranscriptBtn) {
            saveTranscriptBtn.addEventListener('click', saveCurrentTranscript);
        }

        const clearTranscriptBtn = document.getElementById('clearTranscriptBtn');
        if (clearTranscriptBtn) {
            clearTranscriptBtn.addEventListener('click', clearCurrentTranscript);
        }

        const generateTranscriptBtn = document.getElementById('generateTranscriptBtn');
        if (generateTranscriptBtn) {
            generateTranscriptBtn.addEventListener('click', generateTranscriptWithAI);
        }

        // Close modal when clicking backdrop
        const transcriptEditorModal = document.getElementById('transcriptEditorModal');
        if (transcriptEditorModal) {
            transcriptEditorModal.addEventListener('click', (e) => {
                if (e.target === transcriptEditorModal) {
                    closeTranscriptEditor();
                }
            });
        }

        // Simple debounce function
        function debounce(func, wait) {
            let timeout;
            return function executedFunction(...args) {
                const later = () => {
                    clearTimeout(timeout);
                    func(...args);
                };
                clearTimeout(timeout);
                timeout = setTimeout(later, wait);
            };
        }

        // Load all conditions from server
        async function loadAllConditions() {
            const tableBody = document.getElementById('transcriptsTableBody');
            const summary = document.getElementById('transcriptsSummary');
            const btn = document.getElementById('loadTranscriptsBtn');

            try {
                btn.disabled = true;
                btn.textContent = '⏳ Loading...';
                tableBody.innerHTML = '<tr><td colspan="5" style="padding:30px;text-align:center;color:#666;">Loading conditions...</td></tr>';

                const token = await auth.currentUser.getIdToken();
                const response = await fetch(`${SERVER_URL}/clinicalConditions`, {
                    method: 'GET',
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json'
                    }
                });

                if (!response.ok) {
                    throw new Error(`Server error: ${response.status}`);
                }

                const data = await response.json();

                if (!data.success) {
                    throw new Error(data.error || 'Failed to load conditions');
                }

                // Store conditions in flat structure for easier filtering
                loadedConditions = {};
                for (const [category, conditions] of Object.entries(data.conditions)) {
                    for (const [name, conditionData] of Object.entries(conditions)) {
                        loadedConditions[conditionData.id] = {
                            ...conditionData,
                            category: category
                        };
                    }
                }

                const totalConditions = Object.keys(loadedConditions).length;
                const withTranscripts = Object.values(loadedConditions).filter(c => c.hasTranscript).length;
                summary.textContent = `${totalConditions} conditions (${withTranscripts} with transcripts)`;

                filterAndRenderConditions();

            } catch (error) {
                console.error('[TRANSCRIPTS] Error loading conditions:', error);
                tableBody.innerHTML = `<tr><td colspan="5" style="padding:30px;text-align:center;color:#dc3545;">Error: ${error.message}</td></tr>`;
                summary.textContent = 'Error loading conditions';
            } finally {
                btn.disabled = false;
                btn.textContent = '🔄 Load Conditions';
            }
        }

        // Filter and render conditions based on current filters
        function filterAndRenderConditions() {
            const tableBody = document.getElementById('transcriptsTableBody');
            const categoryFilter = document.getElementById('transcriptCategoryFilter').value;
            const statusFilter = document.getElementById('transcriptStatusFilter').value;
            const searchTerm = document.getElementById('transcriptSearchInput').value.toLowerCase().trim();

            // Filter conditions
            let filteredConditions = Object.values(loadedConditions);

            if (categoryFilter !== 'all') {
                filteredConditions = filteredConditions.filter(c => c.category === categoryFilter);
            }

            if (statusFilter === 'has-transcript') {
                filteredConditions = filteredConditions.filter(c => c.hasTranscript);
            } else if (statusFilter === 'no-transcript') {
                filteredConditions = filteredConditions.filter(c => !c.hasTranscript);
            }

            if (searchTerm) {
                filteredConditions = filteredConditions.filter(c =>
                    c.name.toLowerCase().includes(searchTerm) ||
                    c.id.toLowerCase().includes(searchTerm)
                );
            }

            // Sort by category then name
            filteredConditions.sort((a, b) => {
                if (a.category !== b.category) {
                    return a.category.localeCompare(b.category);
                }
                return a.name.localeCompare(b.name);
            });

            // Render table
            if (filteredConditions.length === 0) {
                tableBody.innerHTML = '<tr><td colspan="5" style="padding:30px;text-align:center;color:#666;">No conditions match your filters</td></tr>';
                return;
            }

            tableBody.innerHTML = filteredConditions.map(condition => {
                const categoryBadge = condition.category === 'obstetrics'
                    ? '<span style="background:#e3f2fd;color:#1976d2;padding:2px 8px;border-radius:12px;font-size:11px;">Obstetrics</span>'
                    : '<span style="background:#fce4ec;color:#c2185b;padding:2px 8px;border-radius:12px;font-size:11px;">Gynaecology</span>';

                const transcriptBadge = condition.hasTranscript
                    ? '<span style="background:#d4edda;color:#155724;padding:2px 8px;border-radius:12px;font-size:11px;">✓ Yes</span>'
                    : '<span style="background:#f8f9fa;color:#6c757d;padding:2px 8px;border-radius:12px;font-size:11px;">✗ No</span>';

                const preview = condition.transcript
                    ? condition.transcript.substring(0, 80).replace(/</g, '&lt;').replace(/>/g, '&gt;') + '...'
                    : '<span style="color:#999;font-style:italic;">No transcript</span>';

                return `<tr style="border-bottom:1px solid #eee;">
                    <td style="padding:10px;font-weight:500;">${condition.name}</td>
                    <td style="padding:10px;">${categoryBadge}</td>
                    <td style="padding:10px;text-align:center;">${transcriptBadge}</td>
                    <td style="padding:10px;font-size:11px;color:#666;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${preview}</td>
                    <td style="padding:10px;text-align:center;">
                        <button class="dev-btn edit-transcript-btn" data-condition-id="${condition.id}" style="padding:4px 8px;font-size:11px;margin-right:4px;">✏️ Edit</button>
                        <button class="dev-btn delete-condition-btn" data-condition-id="${condition.id}" data-condition-name="${condition.name}" style="padding:4px 8px;font-size:11px;background:#dc3545;color:#fff;border-color:#dc3545;">🗑️</button>
                    </td>
                </tr>`;
            }).join('');

            // Attach event listeners to buttons
            document.querySelectorAll('.edit-transcript-btn').forEach(btn => {
                btn.addEventListener('click', () => openTranscriptEditor(btn.dataset.conditionId));
            });

            document.querySelectorAll('.delete-condition-btn').forEach(btn => {
                btn.addEventListener('click', () => deleteCondition(btn.dataset.conditionId, btn.dataset.conditionName));
            });
        }

        // Add new condition
        async function addNewCondition() {
            const nameInput = document.getElementById('newConditionName');
            const categorySelect = document.getElementById('newConditionCategory');
            const statusDiv = document.getElementById('addConditionStatus');
            const btn = document.getElementById('addConditionBtn');

            const name = nameInput.value.trim();
            const category = categorySelect.value;

            if (!name) {
                statusDiv.style.display = 'block';
                statusDiv.style.color = '#dc3545';
                statusDiv.textContent = 'Please enter a condition name';
                return;
            }

            try {
                btn.disabled = true;
                btn.textContent = '⏳ Adding...';
                statusDiv.style.display = 'none';

                const token = await auth.currentUser.getIdToken();
                const response = await fetch(`${SERVER_URL}/addClinicalCondition`, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ name, category })
                });

                const data = await response.json();

                if (!response.ok) {
                    throw new Error(data.error || `Server error: ${response.status}`);
                }

                statusDiv.style.display = 'block';
                statusDiv.style.color = '#28a745';
                statusDiv.textContent = `✅ Added "${name}" successfully!`;

                // Clear the input
                nameInput.value = '';

                // Reload the conditions list
                await loadAllConditions();

            } catch (error) {
                console.error('[TRANSCRIPTS] Error adding condition:', error);
                statusDiv.style.display = 'block';
                statusDiv.style.color = '#dc3545';
                statusDiv.textContent = `❌ Error: ${error.message}`;
            } finally {
                btn.disabled = false;
                btn.textContent = '➕ Add';
            }
        }

        // Delete condition
        async function deleteCondition(conditionId, conditionName) {
            if (!confirm(`Are you sure you want to delete "${conditionName}"?\n\nThis will also delete any associated transcript. This action cannot be undone.`)) {
                return;
            }

            try {
                const token = await auth.currentUser.getIdToken();
                const response = await fetch(`${SERVER_URL}/deleteClinicalCondition/${encodeURIComponent(conditionId)}`, {
                    method: 'DELETE',
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json'
                    }
                });

                const data = await response.json();

                if (!response.ok) {
                    throw new Error(data.error || `Server error: ${response.status}`);
                }

                alert(`✅ Deleted "${conditionName}" successfully!`);

                // Reload the conditions list
                await loadAllConditions();

            } catch (error) {
                console.error('[TRANSCRIPTS] Error deleting condition:', error);
                alert(`❌ Error deleting condition: ${error.message}`);
            }
        }

        // Open transcript editor modal
        async function openTranscriptEditor(conditionId) {
            const modal = document.getElementById('transcriptEditorModal');
            const titleEl = document.getElementById('transcriptEditorTitle');
            const conditionIdInput = document.getElementById('transcriptEditorConditionId');
            const contentTextarea = document.getElementById('transcriptEditorContent');
            const statusDiv = document.getElementById('transcriptEditorStatus');

            currentEditingConditionId = conditionId;

            // Get condition data
            const condition = loadedConditions[conditionId];
            if (!condition) {
                alert('Condition not found');
                return;
            }

            titleEl.textContent = `Edit Transcript: ${condition.name}`;
            conditionIdInput.value = conditionId;
            contentTextarea.value = condition.transcript || '';
            statusDiv.style.display = 'none';

            modal.style.display = 'flex';
        }

        // Close transcript editor modal
        function closeTranscriptEditor() {
            const modal = document.getElementById('transcriptEditorModal');
            modal.style.display = 'none';
            currentEditingConditionId = null;
        }

        // Save current transcript
        async function saveCurrentTranscript() {
            if (!currentEditingConditionId) return;

            const contentTextarea = document.getElementById('transcriptEditorContent');
            const statusDiv = document.getElementById('transcriptEditorStatus');
            const btn = document.getElementById('saveTranscriptBtn');

            const transcript = contentTextarea.value.trim();

            try {
                btn.disabled = true;
                btn.textContent = '⏳ Saving...';
                statusDiv.style.display = 'none';

                const token = await auth.currentUser.getIdToken();
                const response = await fetch(`${SERVER_URL}/saveTranscript/${encodeURIComponent(currentEditingConditionId)}`, {
                    method: 'PUT',
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ transcript: transcript || null })
                });

                const data = await response.json();

                if (!response.ok) {
                    throw new Error(data.error || `Server error: ${response.status}`);
                }

                statusDiv.style.display = 'block';
                statusDiv.style.color = '#28a745';
                statusDiv.textContent = '✅ Transcript saved successfully!';

                // Update the local cache
                if (loadedConditions[currentEditingConditionId]) {
                    loadedConditions[currentEditingConditionId].transcript = transcript || null;
                    loadedConditions[currentEditingConditionId].hasTranscript = !!transcript;
                }

                // Re-render the table
                filterAndRenderConditions();

                // Close modal after a short delay
                setTimeout(() => closeTranscriptEditor(), 1000);

            } catch (error) {
                console.error('[TRANSCRIPTS] Error saving transcript:', error);
                statusDiv.style.display = 'block';
                statusDiv.style.color = '#dc3545';
                statusDiv.textContent = `❌ Error: ${error.message}`;
            } finally {
                btn.disabled = false;
                btn.textContent = '💾 Save Transcript';
            }
        }

        // Clear current transcript
        async function clearCurrentTranscript() {
            if (!currentEditingConditionId) return;

            const condition = loadedConditions[currentEditingConditionId];
            if (!confirm(`Are you sure you want to clear the transcript for "${condition?.name}"?`)) {
                return;
            }

            const contentTextarea = document.getElementById('transcriptEditorContent');
            contentTextarea.value = '';
            await saveCurrentTranscript();
        }

        // Generate transcript with AI
        async function generateTranscriptWithAI() {
            if (!currentEditingConditionId) return;

            const contentTextarea = document.getElementById('transcriptEditorContent');
            const statusDiv = document.getElementById('transcriptEditorStatus');
            const btn = document.getElementById('generateTranscriptBtn');

            const condition = loadedConditions[currentEditingConditionId];

            if (contentTextarea.value.trim() && !confirm('This will replace the current transcript content. Continue?')) {
                return;
            }

            try {
                btn.disabled = true;
                btn.textContent = '⏳ Generating...';
                statusDiv.style.display = 'block';
                statusDiv.style.color = '#17a2b8';
                statusDiv.textContent = `🤖 Generating transcript for "${condition?.name}" using AI...`;

                const token = await auth.currentUser.getIdToken();
                const response = await fetch(`${SERVER_URL}/generateTranscript/${encodeURIComponent(currentEditingConditionId)}`, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ forceRegenerate: true })
                });

                const data = await response.json();

                if (!response.ok) {
                    throw new Error(data.error || `Server error: ${response.status}`);
                }

                if (data.transcript) {
                    contentTextarea.value = data.transcript;

                    // Update the local cache
                    if (loadedConditions[currentEditingConditionId]) {
                        loadedConditions[currentEditingConditionId].transcript = data.transcript;
                        loadedConditions[currentEditingConditionId].hasTranscript = true;
                    }

                    // Re-render the table
                    filterAndRenderConditions();
                }

                statusDiv.style.color = '#28a745';
                statusDiv.textContent = '✅ Transcript generated and saved successfully!';

            } catch (error) {
                console.error('[TRANSCRIPTS] Error generating transcript:', error);
                statusDiv.style.display = 'block';
                statusDiv.style.color = '#dc3545';
                statusDiv.textContent = `❌ Error: ${error.message}`;
            } finally {
                btn.disabled = false;
                btn.textContent = '🤖 Generate with AI';
            }
        }

        // ===== PROMPT EVOLUTION SYSTEM =====

        // Store evolution results for later use
        let currentEvolutionResults = null;
        // Store loaded conditions for transcript generation
        let evolveConditionsCache = null;

        // Load scenarios for evolution - uses same source as index.html clinical dropdown
        async function loadEvolveScenarios() {
            const select = document.getElementById('evolveScenarioSelect');
            const status = document.getElementById('evolveStatus');

            if (!select) return;

            try {
                status.textContent = 'Loading scenarios...';

                const token = await auth.currentUser.getIdToken();
                const response = await fetch(`${SERVER_URL}/clinicalConditions`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });

                if (!response.ok) throw new Error('Failed to load conditions');

                const data = await response.json();
                const conditionsByCategory = data.conditions || {};
                evolveConditionsCache = conditionsByCategory;

                select.innerHTML = '';

                // Only show obstetrics category (same as index.html)
                const obstetrics = conditionsByCategory.obstetrics || {};
                let totalConditions = 0;
                let conditionsWithTranscripts = 0;

                Object.entries(obstetrics).forEach(([name, condition]) => {
                    totalConditions++;
                    const option = document.createElement('option');
                    option.value = condition.id || name;
                    option.dataset.name = condition.name || name;

                    if (condition.transcript) {
                        option.textContent = `✓ ${condition.name || name}`;
                        option.dataset.transcript = condition.transcript;
                        option.dataset.hasTranscript = 'true';
                        conditionsWithTranscripts++;
                    } else {
                        option.textContent = `○ ${condition.name || name} (no transcript)`;
                        option.dataset.hasTranscript = 'false';
                    }
                    select.appendChild(option);
                });

                if (totalConditions === 0) {
                    select.innerHTML = '<option value="">No obstetrics scenarios available</option>';
                    status.textContent = 'No scenarios available.';
                } else {
                    status.textContent = `Loaded ${totalConditions} scenarios (${conditionsWithTranscripts} with transcripts)`;
                }

            } catch (error) {
                console.error('[EVOLVE] Error loading scenarios:', error);
                status.textContent = `Error: ${error.message}`;
                select.innerHTML = '<option value="">Error loading scenarios</option>';
            }
        }

        // Generate transcript for a condition if missing
        async function generateTranscriptForCondition(conditionId, conditionName) {
            console.log(`[EVOLVE] Generating transcript for ${conditionName}...`);

            const token = await auth.currentUser.getIdToken();
            const response = await fetch(`${SERVER_URL}/generateTranscript/${encodeURIComponent(conditionId)}`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ forceRegenerate: false })
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Failed to generate transcript');
            }

            const result = await response.json();
            return result.transcript;
        }

        // Find most relevant guideline for a clinical note
        async function findRelevantGuidelineForNote(clinicalNote) {
            console.log('[EVOLVE] Finding relevant guidelines...');

            const token = await auth.currentUser.getIdToken();
            const response = await fetch(`${SERVER_URL}/findRelevantGuidelines`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    transcript: clinicalNote,
                    scope: 'all',
                    hospitalTrust: null
                })
            });

            if (!response.ok) {
                throw new Error('Failed to find relevant guidelines');
            }

            const data = await response.json();

            // Get the most relevant guideline
            const mostRelevant = data.categories?.mostRelevant || [];
            if (mostRelevant.length > 0) {
                return mostRelevant[0]; // Return the top guideline
            }

            // Fall back to potentially relevant
            const potentiallyRelevant = data.categories?.potentiallyRelevant || [];
            if (potentiallyRelevant.length > 0) {
                return potentiallyRelevant[0];
            }

            return null;
        }

        // Run evolution cycle - now auto-finds guidelines
        async function runEvolutionCycle() {
            const scenarioSelect = document.getElementById('evolveScenarioSelect');
            const status = document.getElementById('evolveStatus');
            const progressSection = document.getElementById('evolveProgressSection');
            const progressText = document.getElementById('evolveProgressText');
            const progressPercent = document.getElementById('evolveProgressPercent');
            const progressBar = document.getElementById('evolveProgressBar');
            const resultsSection = document.getElementById('evolveResultsSection');
            const runBtn = document.getElementById('runEvolutionBtn');

            // Get selected scenarios
            const selectedOptions = Array.from(scenarioSelect.selectedOptions);
            if (selectedOptions.length === 0) {
                alert('Please select at least one scenario');
                return;
            }

            try {
                runBtn.disabled = true;
                progressSection.style.display = 'block';
                resultsSection.style.display = 'none';

                const token = await auth.currentUser.getIdToken();
                const scenarios = [];

                // Step 1: Prepare scenarios (generate transcripts if needed)
                for (let i = 0; i < selectedOptions.length; i++) {
                    const opt = selectedOptions[i];
                    const progress = Math.round((i / selectedOptions.length) * 30);
                    progressBar.style.width = `${progress}%`;
                    progressPercent.textContent = `${progress}%`;

                    let transcript = opt.dataset.transcript;

                    if (!transcript || opt.dataset.hasTranscript === 'false') {
                        progressText.textContent = `Generating transcript for ${opt.dataset.name}...`;
                        try {
                            transcript = await generateTranscriptForCondition(opt.value, opt.dataset.name);
                            // Update the option with the new transcript
                            opt.dataset.transcript = transcript;
                            opt.dataset.hasTranscript = 'true';
                            opt.textContent = `✓ ${opt.dataset.name}`;
                        } catch (err) {
                            console.error(`[EVOLVE] Failed to generate transcript for ${opt.dataset.name}:`, err);
                            status.textContent = `Warning: Could not generate transcript for ${opt.dataset.name}`;
                            continue;
                        }
                    }

                    scenarios.push({
                        id: opt.value,
                        name: opt.dataset.name,
                        clinicalNote: transcript
                    });
                }

                if (scenarios.length === 0) {
                    throw new Error('No valid scenarios to process');
                }

                // Step 2: Find relevant guidelines for each scenario
                progressText.textContent = `Finding relevant guidelines for ${scenarios.length} scenarios...`;
                progressBar.style.width = '40%';
                progressPercent.textContent = '40%';

                const scenariosWithGuidelines = [];
                for (let i = 0; i < scenarios.length; i++) {
                    const scenario = scenarios[i];
                    const progress = 40 + Math.round((i / scenarios.length) * 20);
                    progressBar.style.width = `${progress}%`;
                    progressPercent.textContent = `${progress}%`;
                    progressText.textContent = `Finding guidelines for ${scenario.name}...`;

                    try {
                        const relevantGuideline = await findRelevantGuidelineForNote(scenario.clinicalNote);
                        if (relevantGuideline) {
                            scenariosWithGuidelines.push({
                                ...scenario,
                                guidelineId: relevantGuideline.id,
                                guidelineTitle: relevantGuideline.title || relevantGuideline.displayName
                            });
                        } else {
                            console.warn(`[EVOLVE] No relevant guideline found for ${scenario.name}`);
                        }
                    } catch (err) {
                        console.error(`[EVOLVE] Error finding guidelines for ${scenario.name}:`, err);
                    }
                }

                if (scenariosWithGuidelines.length === 0) {
                    throw new Error('Could not find relevant guidelines for any scenario');
                }

                // Step 3: Run evolution
                progressText.textContent = `Processing ${scenariosWithGuidelines.length} scenarios...`;
                progressBar.style.width = '60%';
                progressPercent.textContent = '60%';

                const response = await fetch(`${SERVER_URL}/evolvePrompts`, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ scenariosWithGuidelines })
                });

                progressBar.style.width = '90%';
                progressPercent.textContent = '90%';

                if (!response.ok) {
                    const errorData = await response.json();
                    throw new Error(errorData.error || `Server error: ${response.status}`);
                }

                const result = await response.json();
                currentEvolutionResults = result;

                progressBar.style.width = '100%';
                progressPercent.textContent = '100%';
                progressText.textContent = 'Complete!';

                // Display results
                displayEvolutionResults(result);

                status.textContent = 'Evolution cycle complete';

            } catch (error) {
                console.error('[EVOLVE] Error:', error);
                status.textContent = `Error: ${error.message}`;
                progressText.textContent = `Error: ${error.message}`;
            } finally {
                runBtn.disabled = false;
            }
        }

        // Display evolution results
        function displayEvolutionResults(result) {
            const resultsSection = document.getElementById('evolveResultsSection');

            // Update metrics using new terminology with fallback for backward compatibility
            const metrics = result.aggregatedMetrics || {};

            // Primary metrics (Recall and Precision)
            const avgRecall = metrics.averageRecall ?? metrics.averageCompleteness ?? 0;
            const avgPrecision = metrics.averagePrecision ?? metrics.averageAccuracy ?? 0;

            document.getElementById('evolveMetricRecall').textContent =
                (avgRecall * 100).toFixed(1) + '%';
            document.getElementById('evolveMetricPrecision').textContent =
                (avgPrecision * 100).toFixed(1) + '%';
            document.getElementById('evolveMetricLatency').textContent =
                (metrics.averageLatencyMs || 0).toFixed(0) + 'ms';
            document.getElementById('evolveMetricScenarios').textContent =
                metrics.totalScenarios || 0;

            // Breakdown metrics
            document.getElementById('evolveMetricRedundancy').textContent =
                ((metrics.averageRedundancyRate || 0) * 100).toFixed(1) + '%';
            document.getElementById('evolveMetricFalseNegative').textContent =
                ((metrics.averageFalseNegativeRate || 0) * 100).toFixed(1) + '%';
            document.getElementById('evolveMetricApplicability').textContent =
                ((metrics.averageApplicabilityRate || 0) * 100).toFixed(1) + '%';

            // Display per-scenario results with new terminology
            const scenarioResultsDiv = document.getElementById('evolveScenarioResults');
            let scenarioHtml = '<table style="width:100%;border-collapse:collapse;font-size:13px;">';
            scenarioHtml += '<thead style="background:#f8f9fa;"><tr>';
            scenarioHtml += '<th style="padding:10px;text-align:left;border-bottom:1px solid #dee2e6;">Scenario</th>';
            scenarioHtml += '<th style="padding:10px;text-align:left;border-bottom:1px solid #dee2e6;">Matched Guideline</th>';
            scenarioHtml += '<th style="padding:10px;text-align:center;border-bottom:1px solid #dee2e6;">Recall</th>';
            scenarioHtml += '<th style="padding:10px;text-align:center;border-bottom:1px solid #dee2e6;">Prec.</th>';
            scenarioHtml += '<th style="padding:10px;text-align:center;border-bottom:1px solid #dee2e6;">Redund.</th>';
            scenarioHtml += '<th style="padding:10px;text-align:center;border-bottom:1px solid #dee2e6;">Sugg.</th>';
            scenarioHtml += '<th style="padding:10px;text-align:center;border-bottom:1px solid #dee2e6;">Latency</th>';
            scenarioHtml += '</tr></thead><tbody>';

            (result.scenarioResults || []).forEach(sr => {
                // Use new terminology with fallback
                const recall = ((sr.evaluation?.recallScore ?? sr.evaluation?.completenessScore ?? 0) * 100).toFixed(0);
                const precision = ((sr.evaluation?.precisionScore ?? sr.evaluation?.accuracyScore ?? 0) * 100).toFixed(0);
                const redundancy = ((sr.evaluation?.redundancyRate ?? 0) * 100).toFixed(0);
                const recallColor = recall >= 80 ? '#28a745' : recall >= 60 ? '#ff9800' : '#dc3545';
                const precisionColor = precision >= 80 ? '#28a745' : precision >= 60 ? '#ff9800' : '#dc3545';
                const redundancyColor = redundancy <= 20 ? '#28a745' : redundancy <= 40 ? '#ff9800' : '#dc3545';

                // Truncate guideline title for display
                const guidelineTitle = sr.guidelineTitle || sr.guidelineId || '-';
                const truncatedGuideline = guidelineTitle.length > 40
                    ? guidelineTitle.substring(0, 37) + '...'
                    : guidelineTitle;

                scenarioHtml += '<tr>';
                scenarioHtml += `<td style="padding:10px;border-bottom:1px solid #eee;">${sr.scenarioName}</td>`;
                scenarioHtml += `<td style="padding:10px;border-bottom:1px solid #eee;font-size:12px;color:#555;" title="${guidelineTitle}">${truncatedGuideline}</td>`;
                scenarioHtml += `<td style="padding:10px;text-align:center;border-bottom:1px solid #eee;color:${recallColor};font-weight:bold;">${recall}%</td>`;
                scenarioHtml += `<td style="padding:10px;text-align:center;border-bottom:1px solid #eee;color:${precisionColor};font-weight:bold;">${precision}%</td>`;
                scenarioHtml += `<td style="padding:10px;text-align:center;border-bottom:1px solid #eee;color:${redundancyColor};font-size:11px;">${redundancy}%</td>`;
                scenarioHtml += `<td style="padding:10px;text-align:center;border-bottom:1px solid #eee;">${sr.analysisResult?.suggestionsCount || 0}</td>`;
                scenarioHtml += `<td style="padding:10px;text-align:center;border-bottom:1px solid #eee;">${sr.latencyMs || 0}ms</td>`;
                scenarioHtml += '</tr>';

                // Add assessment row if present
                if (sr.evaluation?.overallAssessment) {
                    scenarioHtml += `<tr><td colspan="6" style="padding:6px 10px 10px 20px;border-bottom:1px solid #dee2e6;font-size:12px;color:#666;background:#fafafa;">📝 ${sr.evaluation.overallAssessment}</td></tr>`;
                }
            });

            scenarioHtml += '</tbody></table>';
            scenarioResultsDiv.innerHTML = scenarioHtml;

            // Display suggested improvements
            const improvementsDiv = document.getElementById('evolveImprovementsSection');
            const improvements = result.suggestedImprovements || {};

            let improvementsHtml = '';

            if (improvements.error) {
                improvementsHtml = `<div style="color:#dc3545;">Error generating improvements: ${improvements.error}</div>`;
            } else {
                // Analysis section
                if (improvements.analysis) {
                    improvementsHtml += '<div style="margin-bottom:15px;">';
                    improvementsHtml += '<h6 style="margin-bottom:8px;">Analysis</h6>';

                    if (improvements.analysis.keyPatterns?.length > 0) {
                        improvementsHtml += '<div style="margin-bottom:8px;"><strong>Key Patterns:</strong></div>';
                        improvementsHtml += '<ul style="margin:0 0 10px 20px;">';
                        improvements.analysis.keyPatterns.forEach(p => {
                            improvementsHtml += `<li>${p}</li>`;
                        });
                        improvementsHtml += '</ul>';
                    }

                    if (improvements.analysis.rootCauses?.length > 0) {
                        improvementsHtml += '<div style="margin-bottom:8px;"><strong>Root Causes:</strong></div>';
                        improvementsHtml += '<ul style="margin:0 0 10px 20px;">';
                        improvements.analysis.rootCauses.forEach(c => {
                            improvementsHtml += `<li>${c}</li>`;
                        });
                        improvementsHtml += '</ul>';
                    }

                    improvementsHtml += '</div>';
                }

                // Suggested changes
                if (improvements.suggestedChanges?.length > 0) {
                    improvementsHtml += '<div style="margin-bottom:15px;">';
                    improvementsHtml += '<h6 style="margin-bottom:8px;">Suggested Changes</h6>';

                    improvements.suggestedChanges.forEach((change, idx) => {
                        improvementsHtml += `<div style="background:#f8f9fa;padding:10px;border-radius:4px;margin-bottom:10px;">`;
                        improvementsHtml += `<div><strong>Change ${idx + 1}:</strong> ${change.changeType} in ${change.section}</div>`;
                        improvementsHtml += `<div style="font-size:12px;color:#666;margin-top:4px;">${change.rationale}</div>`;
                        improvementsHtml += `<div style="font-size:12px;color:#007bff;margin-top:4px;">Expected impact: ${change.expectedImpact}</div>`;
                        improvementsHtml += '</div>';
                    });

                    improvementsHtml += '</div>';
                }

                // New prompt preview
                if (improvements.newPrompt || improvements.newSystemPrompt) {
                    improvementsHtml += '<div style="margin-bottom:15px;">';
                    improvementsHtml += '<h6 style="margin-bottom:8px;">New Prompt (Click "Copy New Prompt" to copy)</h6>';
                    improvementsHtml += '<div style="background:#1e1e1e;color:#d4d4d4;padding:10px;border-radius:4px;font-family:monospace;font-size:11px;max-height:200px;overflow:auto;white-space:pre-wrap;">';

                    if (improvements.newSystemPrompt) {
                        improvementsHtml += `<span style="color:#569cd6;">// System Prompt:</span>\n${improvements.newSystemPrompt}\n\n`;
                    }
                    if (improvements.newPrompt) {
                        improvementsHtml += `<span style="color:#569cd6;">// User Prompt:</span>\n${improvements.newPrompt}`;
                    }

                    improvementsHtml += '</div></div>';
                }

                // Expected improvement (use new terminology with fallback)
                if (improvements.expectedImprovement) {
                    improvementsHtml += '<div style="background:#d4edda;padding:10px;border-radius:4px;">';
                    improvementsHtml += '<strong>Expected Improvement:</strong> ';
                    // Support both new (recall/precision) and old (completeness/accuracy) field names
                    const recallImprovement = improvements.expectedImprovement.recall || improvements.expectedImprovement.completeness || 'N/A';
                    const precisionImprovement = improvements.expectedImprovement.precision || improvements.expectedImprovement.accuracy || 'N/A';
                    improvementsHtml += `Recall: ${recallImprovement}, `;
                    improvementsHtml += `Precision: ${precisionImprovement}`;
                    if (improvements.expectedImprovement.tradeoffs) {
                        improvementsHtml += `<div style="font-size:12px;margin-top:4px;">Tradeoffs: ${improvements.expectedImprovement.tradeoffs}</div>`;
                    }
                    improvementsHtml += '</div>';
                }
            }

            if (!improvementsHtml) {
                improvementsHtml = '<div style="color:#666;">No improvements suggested. The current prompt may already be optimal for these scenarios.</div>';
            }

            improvementsDiv.innerHTML = improvementsHtml;

            // Enable apply button if we have new prompts
            const applyBtn = document.getElementById('applyEvolutionBtn');
            applyBtn.disabled = !(improvements.newPrompt || improvements.newSystemPrompt);

            resultsSection.style.display = 'block';
        }

        // Apply evolution changes
        async function applyEvolutionChanges() {
            if (!currentEvolutionResults?.suggestedImprovements) {
                alert('No improvements to apply');
                return;
            }

            const improvements = currentEvolutionResults.suggestedImprovements;
            const status = document.getElementById('evolveApplyStatus');
            const applyBtn = document.getElementById('applyEvolutionBtn');

            if (!improvements.newPrompt && !improvements.newSystemPrompt) {
                alert('No new prompt generated');
                return;
            }

            if (!confirm('This will update the analyzeGuidelineForPatient prompt. Continue?')) {
                return;
            }

            try {
                applyBtn.disabled = true;
                status.textContent = 'Saving changes...';

                // Load current prompts
                const token = await auth.currentUser.getIdToken();
                const getResponse = await fetch(`${SERVER_URL}/getPrompts`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });

                if (!getResponse.ok) throw new Error('Failed to load current prompts');

                const promptsData = await getResponse.json();
                const prompts = promptsData.prompts || {};

                // Update the analyzeGuidelineForPatient prompt
                if (!prompts.analyzeGuidelineForPatient) {
                    prompts.analyzeGuidelineForPatient = {};
                }

                if (improvements.newSystemPrompt) {
                    prompts.analyzeGuidelineForPatient.system_prompt = improvements.newSystemPrompt;
                }
                if (improvements.newPrompt) {
                    prompts.analyzeGuidelineForPatient.prompt = improvements.newPrompt;
                }

                // Save updated prompts - use FormData to match prompts.html format
                const formData = new FormData();
                formData.append('updatedPrompts', JSON.stringify(prompts));

                const saveResponse = await fetch(`${SERVER_URL}/updatePrompts`, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${token}`
                    },
                    body: formData
                });

                if (!saveResponse.ok) {
                    const errorData = await saveResponse.json();
                    throw new Error(errorData.message || 'Failed to save prompts');
                }

                status.textContent = '✅ Prompt updated successfully!';
                status.style.color = '#28a745';

            } catch (error) {
                console.error('[EVOLVE] Error applying changes:', error);
                status.textContent = `❌ Error: ${error.message}`;
                status.style.color = '#dc3545';
            } finally {
                applyBtn.disabled = false;
            }
        }

        // Copy new prompt to clipboard
        function copyEvolutionPrompt() {
            if (!currentEvolutionResults?.suggestedImprovements) {
                alert('No improvements to copy');
                return;
            }

            const improvements = currentEvolutionResults.suggestedImprovements;
            let promptText = '';

            if (improvements.newSystemPrompt) {
                promptText += '// System Prompt:\n' + improvements.newSystemPrompt + '\n\n';
            }
            if (improvements.newPrompt) {
                promptText += '// User Prompt:\n' + improvements.newPrompt;
            }

            if (promptText) {
                navigator.clipboard.writeText(promptText).then(() => {
                    document.getElementById('evolveApplyStatus').textContent = '📋 Copied to clipboard!';
                }).catch(err => {
                    console.error('Failed to copy:', err);
                    alert('Failed to copy to clipboard');
                });
            } else {
                alert('No new prompt to copy');
            }
        }

        // Select 3 random scenarios with transcripts
        function selectRandomScenarios() {
            const select = document.getElementById('evolveScenarioSelect');
            if (!select) return;

            // Get all options with transcripts
            const optionsWithTranscripts = Array.from(select.options).filter(opt =>
                opt.dataset.hasTranscript === 'true'
            );

            if (optionsWithTranscripts.length === 0) {
                alert('No scenarios with transcripts available');
                return;
            }

            // Deselect all first
            Array.from(select.options).forEach(opt => opt.selected = false);

            // Shuffle and pick 3 (or fewer if not enough)
            const shuffled = optionsWithTranscripts.sort(() => Math.random() - 0.5);
            const toSelect = shuffled.slice(0, Math.min(3, shuffled.length));

            toSelect.forEach(opt => opt.selected = true);

            const status = document.getElementById('evolveStatus');
            if (status) {
                status.textContent = `Selected ${toSelect.length} random scenarios`;
            }
        }

        // Store sequential evolution results
        let sequentialEvolutionResults = null;

        // Run sequential evolution through all LLMs
        async function runSequentialEvolution() {
            const scenarioSelect = document.getElementById('evolveScenarioSelect');
            const status = document.getElementById('evolveStatus');
            const progressSection = document.getElementById('evolveProgressSection');
            const progressText = document.getElementById('evolveProgressText');
            const progressPercent = document.getElementById('evolveProgressPercent');
            const progressBar = document.getElementById('evolveProgressBar');
            const resultsSection = document.getElementById('evolveResultsSection');
            const runBtn = document.getElementById('runSequentialBtn');

            // Get selected scenarios
            const selectedOptions = Array.from(scenarioSelect.selectedOptions);
            if (selectedOptions.length === 0) {
                alert('Please select at least one scenario');
                return;
            }

            try {
                runBtn.disabled = true;
                progressSection.style.display = 'block';
                resultsSection.style.display = 'none';

                const token = await auth.currentUser.getIdToken();
                const scenarios = [];

                // Step 1: Prepare scenarios (generate transcripts if needed)
                for (let i = 0; i < selectedOptions.length; i++) {
                    const opt = selectedOptions[i];
                    const progress = Math.round((i / selectedOptions.length) * 20);
                    progressBar.style.width = `${progress}%`;
                    progressPercent.textContent = `${progress}%`;

                    let transcript = opt.dataset.transcript;

                    if (!transcript || opt.dataset.hasTranscript === 'false') {
                        progressText.textContent = `Generating transcript for ${opt.dataset.name}...`;
                        try {
                            transcript = await generateTranscriptForCondition(opt.value, opt.dataset.name);
                            opt.dataset.transcript = transcript;
                            opt.dataset.hasTranscript = 'true';
                            opt.textContent = `✓ ${opt.dataset.name}`;
                        } catch (err) {
                            console.error(`[EVOLVE-SEQ] Failed to generate transcript for ${opt.dataset.name}:`, err);
                            continue;
                        }
                    }

                    scenarios.push({
                        id: opt.value,
                        name: opt.dataset.name,
                        clinicalNote: transcript
                    });
                }

                if (scenarios.length === 0) {
                    throw new Error('No valid scenarios to process');
                }

                // Step 2: Find relevant guidelines for each scenario
                progressText.textContent = `Finding relevant guidelines for ${scenarios.length} scenarios...`;
                progressBar.style.width = '30%';
                progressPercent.textContent = '30%';

                const scenariosWithGuidelines = [];
                for (let i = 0; i < scenarios.length; i++) {
                    const scenario = scenarios[i];
                    const progress = 30 + Math.round((i / scenarios.length) * 10);
                    progressBar.style.width = `${progress}%`;
                    progressPercent.textContent = `${progress}%`;
                    progressText.textContent = `Finding guidelines for ${scenario.name}...`;

                    try {
                        const relevantGuideline = await findRelevantGuidelineForNote(scenario.clinicalNote);
                        if (relevantGuideline) {
                            scenariosWithGuidelines.push({
                                ...scenario,
                                guidelineId: relevantGuideline.id,
                                guidelineTitle: relevantGuideline.title || relevantGuideline.displayName
                            });
                        }
                    } catch (err) {
                        console.error(`[EVOLVE-SEQ] Error finding guidelines for ${scenario.name}:`, err);
                    }
                }

                if (scenariosWithGuidelines.length === 0) {
                    throw new Error('Could not find relevant guidelines for any scenario');
                }

                // Step 3: Run sequential evolution (all available models)
                progressText.textContent = `Running sequential LLM chain (all models × ${scenariosWithGuidelines.length} scenarios)...`;
                progressBar.style.width = '45%';
                progressPercent.textContent = '45%';

                const response = await fetch(`${SERVER_URL}/evolvePromptsSequential`, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ scenariosWithGuidelines })
                });

                progressBar.style.width = '95%';
                progressPercent.textContent = '95%';

                if (!response.ok) {
                    const errorData = await response.json();
                    throw new Error(errorData.error || `Server error: ${response.status}`);
                }

                const result = await response.json();
                sequentialEvolutionResults = result;

                progressBar.style.width = '100%';
                progressPercent.textContent = '100%';
                progressText.textContent = 'Complete!';

                // Display results
                displaySequentialResults(result);

                status.textContent = 'Sequential evolution complete';

            } catch (error) {
                console.error('[EVOLVE-SEQ] Error:', error);
                status.textContent = `Error: ${error.message}`;
                progressText.textContent = `Error: ${error.message}`;
            } finally {
                runBtn.disabled = false;
            }
        }

        // Display sequential evolution results with comparison table
        function displaySequentialResults(result) {
            const resultsSection = document.getElementById('evolveResultsSection');
            const scenarioResultsDiv = document.getElementById('evolveScenarioResults');

            // Hide the standard metrics section for sequential results
            const metricsRow = document.querySelector('#evolveResultsSection > div:first-child');
            if (metricsRow) {
                metricsRow.style.display = 'none';
            }

            // Use llmProviders for display (array of display names) or fallback
            // Handle null/undefined values in the array
            const rawProviders = result.llmProviders || (result.llmChain || []).map(c =>
                typeof c === 'string' ? c : (c?.displayName || c?.model || 'Unknown')
            );
            const llmProviders = rawProviders.map((p, i) => p || `Model ${i + 1}`);
            const numModels = llmProviders.length;

            let html = '<h5 style="margin-bottom:15px;">Sequential LLM Refinement Results</h5>';
            html += `<p style="font-size:12px;color:#666;margin-bottom:15px;">Testing ${numModels} models. Each LLM sees the previous LLM's output + evaluation. R = Recall, P = Precision. Scroll horizontally to see all models.</p>`;

            // Wrap table in scrollable container for many models
            html += '<div style="overflow-x:auto;max-width:100%;border:1px solid #dee2e6;border-radius:4px;">';
            html += '<table style="border-collapse:collapse;font-size:11px;white-space:nowrap;">';
            html += '<thead style="background:#f8f9fa;position:sticky;top:0;"><tr>';
            html += '<th style="padding:6px 10px;text-align:left;border:1px solid #dee2e6;position:sticky;left:0;background:#f8f9fa;z-index:2;">Scenario</th>';

            llmProviders.forEach((llm, idx) => {
                // Shorten display name for header (take first part before parenthesis or use model ID)
                const shortName = typeof llm === 'string' ?
                    (llm.includes('(') ? llm.split('(')[0].trim() : llm.substring(0, 15)) :
                    String(llm).substring(0, 15);
                html += `<th style="padding:6px 8px;text-align:center;border:1px solid #dee2e6;min-width:70px;" title="${llm}">${idx + 1}. ${shortName}</th>`;
            });
            html += '</tr></thead><tbody>';

            (result.scenarioResults || []).forEach(sr => {
                html += '<tr>';
                html += `<td style="padding:6px 10px;border:1px solid #dee2e6;font-weight:500;position:sticky;left:0;background:#fff;z-index:1;">${sr.scenarioName}<br><span style="font-size:9px;color:#888;">${sr.guidelineTitle?.substring(0, 25) || ''}...</span></td>`;

                let prevRecall = null, prevPrecision = null;

                (sr.iterations || []).forEach((iter, idx) => {
                    // Use new terminology with fallback
                    const recall = Math.round((iter.recallScore ?? iter.completenessScore ?? 0) * 100);
                    const precision = Math.round((iter.precisionScore ?? iter.accuracyScore ?? 0) * 100);

                    // Determine trend arrows (compact)
                    let trend = '';
                    if (prevRecall !== null && prevPrecision !== null) {
                        const improving = (recall > prevRecall || precision > prevPrecision) && recall >= prevRecall && precision >= prevPrecision;
                        const declining = (recall < prevRecall || precision < prevPrecision) && recall <= prevRecall && precision <= prevPrecision;
                        if (improving) trend = '<span style="color:#28a745;">↑</span>';
                        else if (declining) trend = '<span style="color:#dc3545;">↓</span>';
                        else trend = '<span style="color:#888;">~</span>';
                    }

                    // Colour based on combined score
                    const avgScore = (recall + precision) / 2;
                    const bgColor = avgScore >= 80 ? '#d4edda' : avgScore >= 60 ? '#fff3cd' : '#f8d7da';

                    html += `<td style="padding:4px 6px;text-align:center;border:1px solid #dee2e6;background:${bgColor};">`;
                    html += `<strong>${recall}/${precision}</strong>${trend}`;
                    html += `<br><span style="font-size:9px;color:#666;">${Math.round(iter.latencyMs / 1000)}s</span>`;
                    if (iter.error) {
                        html += `<br><span style="font-size:9px;color:#dc3545;">⚠</span>`;
                    }
                    html += '</td>';

                    prevRecall = recall;
                    prevPrecision = precision;
                });

                html += '</tr>';
            });

            html += '</tbody></table></div>';  // Close scrollable container

            // Add summary
            html += '<div style="margin-top:20px;padding:15px;background:#f8f9fa;border-radius:8px;">';
            html += '<h5 style="margin-bottom:10px;">Summary</h5>';

            // Calculate average improvement from first to last LLM (using new terminology)
            let totalRecallImprovement = 0, totalPrecisionImprovement = 0, count = 0;
            let bestModel = null, bestScore = 0;

            (result.scenarioResults || []).forEach(sr => {
                if (sr.iterations && sr.iterations.length >= 2) {
                    const first = sr.iterations[0];
                    const last = sr.iterations[sr.iterations.length - 1];
                    // Use new terminology with fallback
                    const firstRecall = first.recallScore ?? first.completenessScore ?? 0;
                    const lastRecall = last.recallScore ?? last.completenessScore ?? 0;
                    const firstPrecision = first.precisionScore ?? first.accuracyScore ?? 0;
                    const lastPrecision = last.precisionScore ?? last.accuracyScore ?? 0;

                    totalRecallImprovement += lastRecall - firstRecall;
                    totalPrecisionImprovement += lastPrecision - firstPrecision;
                    count++;

                    // Track best performing model
                    sr.iterations.forEach((iter, iterIdx) => {
                        const recall = iter.recallScore ?? iter.completenessScore ?? 0;
                        const precision = iter.precisionScore ?? iter.accuracyScore ?? 0;
                        const score = recall + precision;
                        if (score > bestScore) {
                            bestScore = score;
                            bestModel = iter.provider || iter.modelId || llmProviders[iterIdx] || `Model ${iterIdx + 1}`;
                        }
                    });
                }
            });

            const firstModel = llmProviders[0] || 'First';
            const lastModel = llmProviders[llmProviders.length - 1] || 'Last';

            if (count > 0) {
                const avgRecallImprovement = (totalRecallImprovement / count) * 100;
                const avgPrecisionImprovement = (totalPrecisionImprovement / count) * 100;

                html += `<p style="font-size:13px;"><strong>Models tested:</strong> ${numModels}</p>`;
                html += `<p style="font-size:13px;"><strong>Best performer:</strong> ${bestModel} (${Math.round(bestScore * 50)}% avg)</p>`;
                html += `<p style="font-size:13px;">Average improvement from first to last:</p>`;
                html += `<p style="font-size:13px;">`;
                html += `Recall: <strong style="color:${avgRecallImprovement >= 0 ? '#28a745' : '#dc3545'}">${avgRecallImprovement >= 0 ? '+' : ''}${avgRecallImprovement.toFixed(1)}%</strong> | `;
                html += `Precision: <strong style="color:${avgPrecisionImprovement >= 0 ? '#28a745' : '#dc3545'}">${avgPrecisionImprovement >= 0 ? '+' : ''}${avgPrecisionImprovement.toFixed(1)}%</strong>`;
                html += '</p>';
            }

            html += '</div>';

            scenarioResultsDiv.innerHTML = html;

            // Hide the suggested improvements section for sequential mode
            const suggestedChangesSection = document.getElementById('evolveImprovementsSection');
            if (suggestedChangesSection) {
                suggestedChangesSection.parentElement.style.display = 'none';
            }

            resultsSection.style.display = 'block';
        }

        // Initialize evolution tab when it becomes visible
        function initEvolveTab() {
            loadEvolveScenarios();
        }

        // Set up evolution button handlers
        const runEvolutionBtn = document.getElementById('runEvolutionBtn');
        if (runEvolutionBtn) {
            runEvolutionBtn.addEventListener('click', runEvolutionCycle);
        }

        const randomScenariosBtn = document.getElementById('randomScenariosBtn');
        if (randomScenariosBtn) {
            randomScenariosBtn.addEventListener('click', selectRandomScenarios);
        }

        const runSequentialBtn = document.getElementById('runSequentialBtn');
        if (runSequentialBtn) {
            runSequentialBtn.addEventListener('click', runSequentialEvolution);
        }

        const loadEvolveScenariosBtn = document.getElementById('loadEvolveScenariosBtn');
        if (loadEvolveScenariosBtn) {
            loadEvolveScenariosBtn.addEventListener('click', loadEvolveScenarios);
        }

        const applyEvolutionBtn = document.getElementById('applyEvolutionBtn');
        if (applyEvolutionBtn) {
            applyEvolutionBtn.addEventListener('click', applyEvolutionChanges);
        }

        const copyEvolutionBtn = document.getElementById('copyEvolutionBtn');
        if (copyEvolutionBtn) {
            copyEvolutionBtn.addEventListener('click', copyEvolutionPrompt);
        }

        // Hook into tab switching to initialize evolution tab
        const evolveNavBtn = document.querySelector('[data-content="evolveContent"]');
        if (evolveNavBtn) {
            evolveNavBtn.addEventListener('click', () => {
                // Small delay to let the tab become visible
                setTimeout(initEvolveTab, 100);
            });
        }

    } catch (error) {
        console.error('Error in main script:', error);
        alert('An error occurred while initializing the page: ' + error.message);
    }
});
// ==========================================
// Clinical Issues Synchronization Logic
// ==========================================

let gatheredNewIssues = [];
let originalIssuesData = null;

async function syncClinicalIssues() {
    const statusEl = document.getElementById('syncIssuesStatus');
    const logEl = document.getElementById('syncIssuesLog');
    const progressContainer = document.getElementById('syncProgressContainer');
    const progressBar = document.getElementById('syncProgressBar');
    const progressText = document.getElementById('syncProgressText');
    const progressPercent = document.getElementById('syncProgressPercent');
    const downloadBtn = document.getElementById('downloadIssuesJsonBtn');

    if (!statusEl || !logEl) return;

    // Reset UI
    statusEl.innerHTML = 'Initializing...';
    logEl.style.display = 'block';
    logEl.innerHTML = '';
    progressContainer.style.display = 'block';
    progressBar.style.width = '0%';
    progressPercent.textContent = '0%';
    downloadBtn.style.display = 'none';
    gatheredNewIssues = [];

    try {
        // 1. Fetch existing clinical issues
        statusEl.textContent = 'Fetching clinical_issues.json...';
        const issuesRes = await fetch('/clinical_issues.json');
        if (!issuesRes.ok) throw new Error('Failed to load clinical_issues.json');
        originalIssuesData = await issuesRes.json();

        // Flatten issues for quick lookup
        const allExistingIssues = new Set();
        Object.values(originalIssuesData).forEach(list => {
            if (Array.isArray(list)) list.forEach(i => allExistingIssues.add(i.toLowerCase()));
        });

        // 2. Fetch guidelines from Firestore
        statusEl.textContent = 'Fetching guidelines from Firestore...';
        const snapshot = await getDocs(collection(db, 'guidelines'));
        const guidelines = [];
        snapshot.forEach(doc => {
            const data = doc.data();
            if (data.summary && data.title) {
                guidelines.push({ id: doc.id, ...data });
            }
        });

        statusEl.textContent = `Found ${guidelines.length} guidelines. Starting analysis...`;
        log('INFO', `Loaded ${allExistingIssues.size} existing issues and ${guidelines.length} guidelines.`);

        // 3. Process each guideline
        let processedCount = 0;
        let newIssuesCount = 0;

        for (const guideline of guidelines) {
            processedCount++;
            const pct = Math.round((processedCount / guidelines.length) * 100);
            progressBar.style.width = `${pct}%`;
            progressPercent.textContent = `${pct}%`;
            progressText.textContent = `Processing ${processedCount}/${guidelines.length}`;

            // Quick Client-Side Filter: Check if title matches any existing issue exactly
            if (allExistingIssues.has(guideline.title.toLowerCase())) {
                log('SKIP', `"${guideline.title}" - Exact title match found.`);
                continue;
            }

            try {
                // Call Server Endpoint
                const token = await auth.currentUser.getIdToken();
                const response = await fetch(`${SERVER_URL}/api/admin/identify-clinical-issue`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                    },
                    body: JSON.stringify({
                        guidelineTitle: guideline.title,
                        guidelineSummary: guideline.summary,
                        existingIssues: originalIssuesData // Send structure for context
                    })
                });

                if (!response.ok) {
                    const err = await response.json();
                    throw new Error(err.error || 'Server error');
                }

                const result = await response.json();
                const analysis = result.result.trim();

                if (analysis.startsWith('NEW:')) {
                    // Parse "NEW: Category: Issue Name"
                    const parts = analysis.split(':').map(s => s.trim());
                    if (parts.length >= 3) {
                        const category = parts[1].toLowerCase();
                        const issueName = parts.slice(2).join(':').trim(); // Join back in case name has colons

                        // Validation
                        if (!issueName || issueName.length < 3) {
                            log('WARN', `Invalid issue name suggested: "${issueName}"`);
                            continue;
                        }

                        // Add to our tracked list
                        gatheredNewIssues.push({ category, issue: issueName, source: guideline.title });
                        newIssuesCount++;
                        log('NEW', `[${category}] ${issueName} (Source: ${guideline.title})`, '#28a745');
                    } else {
                        log('WARN', `Malformed NEW response: ${analysis}`);
                    }
                } else if (analysis === 'COVERED') {
                    log('OK', `"${guideline.title}" - Covered.`);
                } else {
                    log('UNK', `Unexpected response for "${guideline.title}": ${analysis}`);
                }

            } catch (err) {
                log('ERR', `Error processing "${guideline.title}": ${err.message}`, 'red');
            }

            // Small delay to prevent UI freezing and generic rate limiting
            await new Promise(r => setTimeout(r, 100));
        }

        // 4. Finish
        statusEl.innerHTML = `Complete! Found <b>${newIssuesCount}</b> new clinical issues.`;
        if (newIssuesCount > 0) {
            downloadBtn.style.display = 'inline-flex';
        }

    } catch (error) {
        console.error(error);
        statusEl.textContent = `Error: ${error.message}`;
        log('FATAL', error.message, 'red');
    }
}

function log(type, message, color = null) {
    const logEl = document.getElementById('syncIssuesLog');
    if (!logEl) return;
    const div = document.createElement('div');
    div.textContent = `[${type}] ${message}`;
    if (color) div.style.color = color;
    logEl.appendChild(div);
    logEl.scrollTop = logEl.scrollHeight;
}

function downloadIssuesJson() {
    if (!originalIssuesData || gatheredNewIssues.length === 0) return;

    // Deep copy original data
    const newData = JSON.parse(JSON.stringify(originalIssuesData));

    // Merge new issues
    gatheredNewIssues.forEach(({ category, issue }) => {
        // Normalize category (e.g., map "obstetric" to "obstetrics")
        let targetCat = category;
        if (targetCat === 'obstetric') targetCat = 'obstetrics';
        if (targetCat === 'gynaecologic') targetCat = 'gynaecology';

        if (!newData[targetCat]) {
            newData[targetCat] = [];
        }

        // Check for duplicates in the target array
        if (!newData[targetCat].includes(issue)) {
            newData[targetCat].push(issue);
        }
    });

    // Sort arrays
    Object.keys(newData).forEach(key => {
        newData[key].sort();
    });

    // Create and trigger download
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(newData, null, 2));
    const downloadAnchorNode = document.createElement('a');
    downloadAnchorNode.setAttribute("href", dataStr);
    downloadAnchorNode.setAttribute("download", "clinical_issues_updated.json");
    document.body.appendChild(downloadAnchorNode); // required for firefox
    downloadAnchorNode.click();
    downloadAnchorNode.remove();
}

// Attach listeners safely
const initSyncTools = () => {
    document.getElementById('syncClinicalIssuesBtn')?.addEventListener('click', syncClinicalIssues);
    document.getElementById('downloadIssuesJsonBtn')?.addEventListener('click', downloadIssuesJson);
};

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initSyncTools);
} else {
    initSyncTools();
}
