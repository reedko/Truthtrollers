// Test GET /api/evidence-config
import axios from 'axios';

try {
  const response = await axios.get('https://localhost:3001/api/evidence-config', {
    headers: {
      'Cookie': 'token=your_token_here' // You'll need a real token
    },
    httpsAgent: new (await import('https')).Agent({ rejectUnauthorized: false })
  });

  console.log('Response:', JSON.stringify(response.data, null, 2));
} catch (error) {
  console.error('Error:', error.response?.data || error.message);
}
