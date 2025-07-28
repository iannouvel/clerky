const axios = require('axios');

// Test configuration - LOCAL (no auth)
const SERVER_URL = 'http://localhost:3000';
const TEST_DATA = {
  guidelineId: 'BJOG-2016-Management-of-Bladder-Pain-Syndrome',
  auditableElement: 'Diagnostic criteria for bladder pain syndrome',
  transcript: 'Patient reports pelvic pain for 6 months. No cystoscopy performed. No urine culture documented.'
};

async function testAuditEndpointLocal() {
  try {
    console.log('🧪 Testing /auditElementCheck endpoint LOCALLY...');
    console.log('Server URL:', SERVER_URL);
    console.log('Test data:', JSON.stringify(TEST_DATA, null, 2));
    
    const response = await axios.post(`${SERVER_URL}/auditElementCheck`, TEST_DATA, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer test-token' // Mock token for testing
      },
      timeout: 5000
    });
    
    console.log('✅ Success! Response:');
    console.log(JSON.stringify(response.data, null, 2));
    
  } catch (error) {
    if (error.response) {
      console.log('📡 Server responded:');
      console.log('Status:', error.response.status);
      console.log('Data:', JSON.stringify(error.response.data, null, 2));
      
      if (error.response.status === 401) {
        console.log('🔐 Authentication required - endpoint exists!');
      } else if (error.response.status === 404) {
        console.log('❌ Endpoint not found - check if server is running');
      }
    } else if (error.code === 'ECONNREFUSED') {
      console.log('❌ Server not running. Start with: node server.js');
    } else {
      console.log('❌ Error:', error.message);
    }
  }
}

// Run the test
testAuditEndpointLocal(); 