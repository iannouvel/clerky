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

    // Function to fetch logs from the server
    async function fetchLogs() {
        try {
            const response = await fetch('/logs/ai-interactions');
            logs = await response.json();
            logs.sort((a, b) => new Date(b.date) - new Date(a.date));
            displayLog(0);
        } catch (error) {
            console.error('Error fetching logs:', error);
            document.getElementById('logDisplay').textContent = 'Error fetching logs: ' + error.message;
        }
    }

    // Function to display a log at the specified index
    function displayLog(index) {
        if (logs.length > 0 && index >= 0 && index < logs.length) {
            currentLogIndex = index;
            document.getElementById('logDisplay').textContent = logs[index].content;
        } else if (logs.length === 0) {
            document.getElementById('logDisplay').textContent = 'No logs available';
        } else {
            document.getElementById('logDisplay').textContent = 'Invalid log index';
        }
    }

    // Log navigation button event listeners
    document.getElementById('mostRecentBtn').addEventListener('click', () => displayLog(0));
    document.getElementById('refreshBtn').addEventListener('click', fetchLogs);
    document.getElementById('earlierBtn').addEventListener('click', () => displayLog(currentLogIndex + 1));
    document.getElementById('laterBtn').addEventListener('click', () => displayLog(currentLogIndex - 1));

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