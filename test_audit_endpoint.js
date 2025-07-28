const axios = require('axios');

// Test configuration - PRODUCTION
const SERVER_URL = 'https://clerky-uzni.onrender.com';
const TEST_DATA = {
  guidelineId: 'BJOG-2016-Management-of-Bladder-Pain-Syndrome',
  auditableElement: 'Diagnostic criteria for bladder pain syndrome',
  transcript: 'Patient reports pelvic pain for 6 months. No cystoscopy performed. No urine culture documented.'
};

async function testAuditEndpoint() {
  try {
    console.log('🧪 Testing /auditElementCheck endpoint in PRODUCTION...');
    console.log('Server URL:', SERVER_URL);
    console.log('Test data:', JSON.stringify(TEST_DATA, null, 2));
    
    const response = await axios.post(`${SERVER_URL}/auditElementCheck`, TEST_DATA, {
      headers: {
        'Content-Type': 'application/json',
        // Note: Will fail without auth, but confirms endpoint exists
      },
      timeout: 10000 // 10 second timeout
    });
    
    console.log('✅ Success! Response:');
    console.log(JSON.stringify(response.data, null, 2));
    
  } catch (error) {
    if (error.response) {
      console.log('📡 Server responded:');
      console.log('Status:', error.response.status);
      console.log('Data:', JSON.stringify(error.response.data, null, 2));
      
      if (error.response.status === 401) {
        console.log('🔐 Expected: Authentication required');
        console.log('✅ Endpoint exists and is working!');
      } else if (error.response.status === 404) {
        console.log('❌ Endpoint not found - check server deployment');
      }
    } else if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
      console.log('❌ Cannot reach server. Check URL and deployment status');
    } else if (error.code === 'ETIMEDOUT') {
      console.log('⏰ Request timed out - server may be starting up');
    } else {
      console.log('❌ Error:', error.message);
    }
  }
}

// Run the test
testAuditEndpoint(); 