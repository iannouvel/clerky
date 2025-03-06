// Global variables
const SERVER_URL = 'https://clerky-uzni.onrender.com';

document.addEventListener('DOMContentLoaded', function() {
    const buttons = document.querySelectorAll('.nav-btn');
    const contents = document.querySelectorAll('.tab-content');
    let currentLogIndex = 0;
    let logs = [];

    // Function to update server status indicator
    async function checkServerHealth() {
        const statusElement = document.getElementById('serverStatus');
        statusElement.innerHTML = ''; // Clear existing content
        const statusText = document.createElement('span');
        statusText.textContent = 'Checking server...';
        statusElement.appendChild(statusText);
        
        try {
            const response = await fetch(`${SERVER_URL}/health`);
            if (response.ok) {
                const data = await response.json();
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

    // Function to fetch logs through the server
    async function fetchLogs() {
        const logDisplay = document.getElementById('logDisplay');
        logDisplay.textContent = 'Fetching logs...';
        
        try {
            // Get logs through server endpoint that handles GitHub authentication
            const response = await fetch(`${SERVER_URL}/api/get-logs`);
            
            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Failed to fetch logs: ${response.status} ${response.statusText}\n${errorText}`);
            }
            
            const data = await response.json();
            
            if (!data.logs || data.logs.length === 0) {
                logDisplay.textContent = 'No logs available';
                return;
            }
            
            logs = data.logs;
            
            // If we successfully loaded any logs, display the first one
            if (logs.length > 0) {
                displayLog(0);
            } else {
                logDisplay.textContent = 'No logs available';
            }
        } catch (error) {
            console.error('Error fetching logs:', error);
            logDisplay.textContent = 'Error fetching logs: ' + error.message;
            
            // Fallback to direct folder listing if server endpoint fails
            try {
                logDisplay.textContent += '\n\nAttempting alternative method...';
                await fetchLogsDirectly();
            } catch (fallbackError) {
                console.error('Fallback error:', fallbackError);
                logDisplay.textContent += '\n\nAlternative method also failed.';
            }
        }
    }
    
    // Fallback function to list log files directly if server endpoint fails
    async function fetchLogsDirectly() {
        try {
            // Directly access the logs directory listing
            const response = await fetch(`${window.location.origin}/logs/ai-interactions/`);
            
            if (!response.ok) {
                throw new Error(`Failed to access logs directory: ${response.status}`);
            }
            
            const html = await response.text();
            
            // Extract filenames from directory listing HTML
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, 'text/html');
            const links = Array.from(doc.querySelectorAll('a'))
                .filter(a => a.href.endsWith('.json') || a.href.endsWith('.txt'))
                .map(a => ({
                    filename: a.textContent.trim(),
                    url: a.href
                }));
            
            if (links.length === 0) {
                throw new Error('No log files found in directory listing');
            }
            
            // Sort links by filename (usually contains date)
            links.sort((a, b) => b.filename.localeCompare(a.filename));
            
            // Load the log files
            logs = [];
            const logsToLoad = links.slice(0, 5); // Load only first 5 logs
            
            for (const link of logsToLoad) {
                try {
                    const fileResponse = await fetch(link.url);
                    if (!fileResponse.ok) continue;
                    
                    const content = await fileResponse.text();
                    // Try to extract date from filename
                    const dateMatch = link.filename.match(/(\d{4}-\d{2}-\d{2})/);
                    const date = dateMatch ? new Date(dateMatch[1]) : new Date();
                    
                    logs.push({
                        filename: link.filename,
                        date,
                        content
                    });
                } catch (error) {
                    console.error(`Error loading log file ${link.filename}:`, error);
                }
            }
            
            if (logs.length > 0) {
                displayLog(0);
            } else {
                throw new Error('Could not load any log files');
            }
        } catch (error) {
            throw error;
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
            if (logs[index].filename) {
                navInfo.textContent += ` - ${logs[index].filename}`;
            }
            if (logs[index].date) {
                navInfo.textContent += ` (${new Date(logs[index].date).toLocaleString()})`;
            }
            logDisplay.appendChild(navInfo);
            
            // Add log content
            const contentDiv = document.createElement('pre');
            contentDiv.className = 'log-content';
            contentDiv.textContent = logs[index].content;
            logDisplay.appendChild(contentDiv);
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