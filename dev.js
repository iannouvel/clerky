// Global variables
const SERVER_URL = 'https://clerky-uzni.onrender.com';
const GITHUB_API_BASE = 'https://api.github.com/repos/iannouvel/clerky';
const MAX_FILES_TO_LIST = 100; // Maximum number of files to list
const MAX_FILES_TO_LOAD = 5;  // Maximum number of files to actually load content for

document.addEventListener('DOMContentLoaded', function() {
    const buttons = document.querySelectorAll('.nav-btn');
    const contents = document.querySelectorAll('.tab-content');
    let currentLogIndex = 0;
    let logs = [];
    let allLogFiles = []; // Store all log files metadata without content

    // Function to update server status indicator - with GitHub Pages friendly approach
    async function checkServerHealth() {
        const statusElement = document.getElementById('serverStatus');
        statusElement.innerHTML = ''; // Clear existing content
        const statusText = document.createElement('span');
        statusText.textContent = 'Checking server...';
        statusElement.appendChild(statusText);
        
        try {
            // Simplified fetch without additional headers to avoid CORS issues
            const response = await fetch(`${SERVER_URL}/health`);
            
            if (response.ok) {
                statusText.textContent = 'Server: Live';
                statusElement.style.color = 'green';
            } else {
                statusText.textContent = 'Server: Down';
                statusElement.style.color = 'red';
            }
        } catch (error) {
            statusText.textContent = 'Server: Unreachable';
            statusElement.style.color = 'red';
        }
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

    // Log navigation button event listeners
    document.getElementById('mostRecentBtn').addEventListener('click', () => displayLog(0));
    document.getElementById('refreshBtn').addEventListener('click', fetchLogs);
    document.getElementById('earlierBtn').addEventListener('click', () => {
        if (currentLogIndex < logs.length - 1) {
            displayLog(currentLogIndex + 1);
        } else if (allLogFiles && logs.length < allLogFiles.length) {
            // If there are more logs to load
            const loadingIndicator = document.createElement('div');
            loadingIndicator.className = 'loading-indicator';
            loadingIndicator.textContent = 'Loading earlier logs...';
            document.getElementById('logDisplay').appendChild(loadingIndicator);
            
            loadMoreLogs(logs.length, MAX_FILES_TO_LOAD).then(count => {
                if (count > 0) {
                    displayLog(currentLogIndex + 1);
                } else {
                    alert('No earlier logs available');
                }
            });
        } else {
            alert('No earlier logs available');
        }
    });
    document.getElementById('laterBtn').addEventListener('click', () => {
        if (currentLogIndex > 0) {
            displayLog(currentLogIndex - 1);
        } else {
            alert('No later logs available');
        }
    });

    // Tab navigation buttons event listeners
    buttons.forEach(button => {
        button.addEventListener('click', function() {
            const target = this.getAttribute('data-content');

            contents.forEach(content => {
                content.style.display = content.id === target ? 'block' : 'none';
            });

            buttons.forEach(btn => btn.classList.remove('active'));
            this.classList.add('active');

            if (target === 'logsContent') {
                fetchLogs();
            }
        });
    });

    // Initial setup - click first button and check server health
    checkServerHealth();
    buttons[0].click(); // Activate the first button by default
}); 