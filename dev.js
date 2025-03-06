// dev.js - Functionality specific to dev.html

// Import Firebase modules
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';

// Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyCU4dfGi4vHg_ek-l2V0uksFCv1jL4KV_g",
  authDomain: "clerky-b3be8.firebaseapp.com",
  projectId: "clerky-b3be8",
  storageBucket: "clerky-b3be8.firebasestorage.app",
  messagingSenderId: "193460924609",
  appId: "1:193460924609:web:6e2c696c87292d4a222440",
  measurementId: "G-V07DP1ELDR"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

// Server URL for API calls
const SERVER_URL = 'https://clerky-uzni.onrender.com';

// Main initialization
document.addEventListener('DOMContentLoaded', function() {
    // Initialize UI components
    initializeTabNavigation();
    initializeLogFunctionality();
    checkServerHealth();
    
    // Set up authentication listener
    auth.onAuthStateChanged(user => {
        if (user) {
            // User is signed in
            const userName = document.getElementById('userName');
            if (userName) {
                userName.textContent = user.displayName || user.email;
                userName.classList.remove('hidden');
            }
        } else {
            // User is signed out, redirect to index.html
            window.location.href = 'index.html';
        }
    });
    
    // Sign out functionality
    const signOutBtn = document.getElementById('signOutBtn');
    if (signOutBtn) {
        signOutBtn.addEventListener('click', () => {
            auth.signOut().then(() => {
                window.location.href = 'index.html';
            });
        });
    }
});

// Initialize tab navigation
function initializeTabNavigation() {
    const buttons = document.querySelectorAll('.nav-btn');
    const contents = document.querySelectorAll('.tab-content');
    const topBar = document.querySelector('.top-bar');
    const topBarCenter = document.querySelector('.top-bar-center');
    
    // Function to adjust the position of tab content based on header height
    function adjustTabContentPosition() {
        // Calculate total header height (top-bar + top-bar-center)
        const topBarHeight = topBar.offsetHeight;
        const topBarCenterHeight = topBarCenter.offsetHeight;
        const totalHeaderHeight = topBarHeight + topBarCenterHeight;
        
        // Apply the calculated height to all tab content containers
        contents.forEach(content => {
            content.style.marginTop = `${totalHeaderHeight}px`;
            
            // Adjust the height of the content to fill the remaining space
            const viewportHeight = window.innerHeight;
            content.style.height = `${viewportHeight - totalHeaderHeight}px`;
        });
        
        // Also adjust log navigation if present
        const logNavigation = document.querySelector('.log-navigation');
        if (logNavigation) {
            logNavigation.style.marginTop = '20px';
        }
    }

    // Adjust tab positions initially
    adjustTabContentPosition();
    
    // Re-adjust when window is resized
    window.addEventListener('resize', adjustTabContentPosition);
    
    // Set up tab button click handlers
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

    // Activate the first button by default
    buttons[0].click();
}

// Initialize log functionality
function initializeLogFunctionality() {
    let currentLogIndex = 0;
    let logs = [];
    
    // Function to fetch logs from server or use mock data
    async function fetchLogs() {
        try {
            // Try to fetch from server, but use mock data if it fails
            try {
                const response = await fetch(`${SERVER_URL}/logs/ai-interactions`);
                if (response.ok) {
                    logs = await response.json();
                    logs.sort((a, b) => new Date(b.date) - new Date(a.date));
                    displayLog(0);
                    return;
                }
            } catch (error) {
                console.log('Using mock logs data due to error:', error.message);
            }
            
            // Mock data for development
            logs = [
                { 
                    date: new Date().toISOString(), 
                    content: 'Sample log entry 1 - This is a mock log for development purposes.' 
                },
                { 
                    date: new Date(Date.now() - 3600000).toISOString(), 
                    content: 'Sample log entry 2 - Earlier mock log with sample data.' 
                },
                { 
                    date: new Date(Date.now() - 7200000).toISOString(), 
                    content: 'Sample log entry 3 - Even older mock log entry for testing the UI.' 
                }
            ];
            displayLog(0);
        } catch (error) {
            console.error('Error fetching logs:', error);
            document.getElementById('logDisplay').textContent = 'Error loading logs: ' + error.message;
        }
    }

    // Function to display a log entry
    function displayLog(index) {
        if (logs.length > 0 && index >= 0 && index < logs.length) {
            currentLogIndex = index;
            document.getElementById('logDisplay').textContent = logs[index].content;
        }
    }
    
    // Set up log navigation button handlers
    document.getElementById('mostRecentBtn').addEventListener('click', () => displayLog(0));
    document.getElementById('refreshBtn').addEventListener('click', fetchLogs);
    document.getElementById('earlierBtn').addEventListener('click', () => displayLog(currentLogIndex + 1));
    document.getElementById('laterBtn').addEventListener('click', () => displayLog(currentLogIndex - 1));
}

// Check server health and update status display
async function checkServerHealth() {
    const statusElement = document.getElementById('serverStatus');
    statusElement.innerHTML = ''; // Clear existing content
    
    const spinner = document.createElement('div');
    spinner.className = 'spinner';
    
    const statusText = document.createElement('span');
    statusText.textContent = 'Checking server...';
    
    statusElement.appendChild(statusText);
    statusElement.appendChild(spinner);
    
    try {
        const response = await fetch(`${SERVER_URL}/health`);
        const data = await response.json();
        
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
    } finally {
        spinner.remove();
    }
} 