import axios from 'axios';

const API_URL = 'http://localhost:5001';

async function testLongIP() {
  // Create an extremely long IP address (over 100 chars)
  const longIP = '2001:0db8:85a3:0000:0000:8a2e:0370:7334, 2001:0db8:85a3:0000:0000:8a2e:0370:7335, 2001:0db8:85a3:0000:0000:8a2e:0370:7336, extra_data_to_make_it_really_long_12345678901234567890123456789012345678901234567890';

  console.log('🧪 Testing with IP address length:', longIP.length);
  console.log('🧪 IP address:', longIP);
  console.log('🧪 First 100 chars:', longIP.substring(0, 100));
  console.log('\n---\n');

  try {
    const response = await axios.post(`${API_URL}/api/login`, {
      username: 'nonexistentuser',
      password: 'wrongpassword'
    }, {
      headers: {
        'x-forwarded-for': longIP,
        'x-skip-captcha': 'true',
        'Content-Type': 'application/json'
      }
    });

    console.log('Response:', response.status, response.data);
  } catch (error) {
    if (error.response) {
      console.log('✅ Expected error response:', error.response.status, error.response.data);
    } else {
      console.error('❌ Unexpected error:', error.message);
    }
  }

  console.log('\n🔍 Now check your backend logs for:');
  console.log('   - Any 🚨 banners');
  console.log('   - IP length information');
  console.log('   - ER_DATA_TOO_LONG errors');
}

testLongIP();
