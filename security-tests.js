// Import required modules
const fetch = require('node-fetch');

// Test functions here...
async function testRateLimiting() {
    console.log('\nTesting Rate Limiting...');
    const url = 'https://clerky-uzni.onrender.com/newFunctionName';
    const requests = [];
    
    // Try to make 5 requests quickly (for testing - we can increase this number later)
    for(let i = 0; i < 5; i++) {
        requests.push(fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt: 'test' })
        }));
    }
    
    const results = await Promise.all(requests);
    console.log('Rate limiting test results:', results.map(r => r.status));
}

async function testSizeLimit() {
    console.log('\nTesting Size Limit...');
    const url = 'https://clerky-uzni.onrender.com/newFunctionName';
    const largeString = 'x'.repeat(11000); // Create string > 10kb
    
    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: largeString })
    });
    
    console.log('Size limit test status:', response.status);
}

async function testSecurityHeaders() {
    console.log('\nTesting Security Headers...');
    const url = 'https://clerky-uzni.onrender.com';
    const response = await fetch(url);
    
    const headers = {
        'Content-Security-Policy': response.headers.get('Content-Security-Policy'),
        'X-Content-Type-Options': response.headers.get('X-Content-Type-Options'),
        'X-Frame-Options': response.headers.get('X-Frame-Options'),
        'X-XSS-Protection': response.headers.get('X-XSS-Protection')
    };
    
    console.log('Security Headers:', headers);
}

async function runAllTests() {
    console.log('Starting security tests...');
    try {
        await testRateLimiting();
        await testSizeLimit();
        await testSecurityHeaders();
    } catch (error) {
        console.error('Test failed:', error);
    }
}

runAllTests(); 