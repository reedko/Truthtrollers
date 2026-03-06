// test-kill-connection.js
// Temporary test endpoint to simulate connection failure
// Add this to server.js temporarily for testing

import express from 'express';
import { query } from './src/db/pool.js';

const router = express.Router();

// Test endpoint: Kill database connection to simulate the error
router.post('/api/test/kill-db-connection', async (req, res) => {
  try {
    console.log('🧪 [TEST] Attempting to kill database connection...');

    // Get current connection ID
    const result = await query('SELECT CONNECTION_ID() as id');
    const connectionId = result[0].id;
    console.log(`   Current connection ID: ${connectionId}`);

    // Kill the connection (this will cause "Cannot enqueue Query" error with old code)
    await query(`KILL ${connectionId}`);

    console.log('💀 [TEST] Connection killed! Next query should fail with old code.');
    res.json({
      success: true,
      message: 'Connection killed. Try submitting text now.',
      connectionId
    });
  } catch (error) {
    console.error('❌ [TEST] Error during connection kill test:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Test endpoint: Verify pool is working
router.get('/api/test/db-health', async (req, res) => {
  try {
    const result = await query('SELECT 1 + 1 AS result, CONNECTION_ID() as conn_id, NOW() as now');
    console.log('✅ [TEST] Database connection healthy:', result[0]);
    res.json({
      success: true,
      healthy: true,
      connectionId: result[0].conn_id,
      serverTime: result[0].now
    });
  } catch (error) {
    console.error('❌ [TEST] Database health check failed:', error.message);
    res.status(500).json({
      success: false,
      healthy: false,
      error: error.message
    });
  }
});

export default router;
