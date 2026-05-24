/**
 * X API Credentials Management Routes
 *
 * Admin endpoints for configuring and testing X/Twitter API credentials
 */

import { Router } from 'express';
import { authenticateToken } from '../../middleware/auth.js';

export default function createXCredentialsRouter({ query, pool }) {
  const router = Router();

  /**
   * GET /api/admin/x-credentials/status
   * Check if X API credentials are configured (database or .env)
   */
  router.get('/status', authenticateToken, async (req, res) => {
    try {
      // Check database first
      const rows = await query(
        'SELECT COUNT(*) as count FROM system_config WHERE config_key IN (?, ?)',
        ['X_CLIENT_ID', 'X_CLIENT_SECRET']
      );

      const hasDbCredentials = rows && rows.length > 0 && rows[0].count === 2;

      // Fallback to .env
      const hasEnvCredentials = !!(process.env.X_CLIENT_ID && process.env.X_CLIENT_SECRET);

      const hasCredentials = hasDbCredentials || hasEnvCredentials;

      res.json({
        has_credentials: hasCredentials,
        source: hasDbCredentials ? 'database' : (hasEnvCredentials ? 'environment' : 'none'),
        message: hasCredentials
          ? `X API credentials are configured (${hasDbCredentials ? 'database' : 'environment'})`
          : 'X API credentials not set'
      });
    } catch (error) {
      console.error('Error checking X credentials status:', error);
      res.status(500).json({
        error: 'Failed to check credentials status',
        message: error.message
      });
    }
  });

  /**
   * GET /api/admin/x-credentials
   * Get X API credentials (only returns client_id, not secret)
   */
  router.get('/', authenticateToken, async (req, res) => {
    try {
      const rows = await query(
        'SELECT config_key, config_value FROM system_config WHERE config_key IN (?, ?)',
        ['X_CLIENT_ID', 'X_CLIENT_SECRET']
      );

      const credentials = {};
      rows.forEach(row => {
        if (row.config_key === 'X_CLIENT_ID') {
          credentials.client_id = row.config_value;
        } else if (row.config_key === 'X_CLIENT_SECRET') {
          // Never return the actual secret, just indicate it exists
          credentials.has_secret = true;
        }
      });

      res.json({
        credentials,
        has_credentials: !!credentials.client_id && !!credentials.has_secret
      });
    } catch (error) {
      console.error('Error fetching X credentials:', error);
      res.status(500).json({
        error: 'Failed to fetch credentials',
        message: error.message
      });
    }
  });

  /**
   * POST /api/admin/x-credentials
   * Save X API credentials
   */
  router.post('/', authenticateToken, async (req, res) => {
    try {
      const { client_id, client_secret } = req.body;

      if (!client_id || !client_secret) {
        return res.status(400).json({
          error: 'Missing credentials',
          message: 'Both client_id and client_secret are required'
        });
      }

      // Check if system_config table exists
      const tables = await query(
        "SHOW TABLES LIKE 'system_config'"
      );

      // Create table if it doesn't exist
      if (!tables || tables.length === 0) {
        await query(`
          CREATE TABLE system_config (
            config_key VARCHAR(100) PRIMARY KEY,
            config_value TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
          )
        `);
        console.log('✅ Created system_config table');
      }

      // Upsert credentials
      await query(
        `INSERT INTO system_config (config_key, config_value)
         VALUES (?, ?)
         ON DUPLICATE KEY UPDATE config_value = VALUES(config_value)`,
        ['X_CLIENT_ID', client_id]
      );

      await query(
        `INSERT INTO system_config (config_key, config_value)
         VALUES (?, ?)
         ON DUPLICATE KEY UPDATE config_value = VALUES(config_value)`,
        ['X_CLIENT_SECRET', client_secret]
      );

      console.log('✅ X API credentials saved');

      res.json({
        success: true,
        message: 'X API credentials saved successfully'
      });
    } catch (error) {
      console.error('Error saving X credentials:', error);
      res.status(500).json({
        error: 'Failed to save credentials',
        message: error.message
      });
    }
  });

  /**
   * POST /api/admin/x-credentials/test
   * Test X API connection with stored credentials (database or .env)
   */
  router.post('/test', authenticateToken, async (req, res) => {
    try {
      // Get stored credentials from database
      const rows = await query(
        'SELECT config_key, config_value FROM system_config WHERE config_key IN (?, ?)',
        ['X_CLIENT_ID', 'X_CLIENT_SECRET']
      );

      const credentials = {};

      // First try database
      rows.forEach(row => {
        if (row.config_key === 'X_CLIENT_ID') {
          credentials.client_id = row.config_value;
        } else if (row.config_key === 'X_CLIENT_SECRET') {
          credentials.client_secret = row.config_value;
        }
      });

      // Fallback to .env
      if (!credentials.client_id && process.env.X_CLIENT_ID) {
        credentials.client_id = process.env.X_CLIENT_ID;
      }
      if (!credentials.client_secret && process.env.X_CLIENT_SECRET) {
        credentials.client_secret = process.env.X_CLIENT_SECRET;
      }

      if (!credentials.client_id || !credentials.client_secret) {
        return res.status(400).json({
          success: false,
          message: 'X API credentials not configured. Please save credentials first or add to .env file.'
        });
      }

      // Test: Validate credentials format
      // Note: Full validation requires OAuth flow with user authorization

      // Basic format validation
      if (credentials.client_id.length < 10 || credentials.client_secret.length < 10) {
        return res.json({
          success: false,
          message: 'Credentials appear to be invalid (too short)',
          details: {
            client_id_length: credentials.client_id.length,
            client_secret_length: credentials.client_secret.length,
            note: 'Valid credentials are typically longer'
          }
        });
      }

      // Check if credentials look valid (basic sanity check)
      const validPattern = /^[A-Za-z0-9_-]+$/;
      if (!validPattern.test(credentials.client_id)) {
        return res.json({
          success: false,
          message: 'Client ID format appears invalid',
          details: {
            note: 'Client ID should only contain alphanumeric characters, hyphens, and underscores'
          }
        });
      }

      // Credentials passed basic validation
      return res.json({
        success: true,
        message: 'Credentials saved and format validated!',
        details: {
          note: 'Credentials format looks correct. Click "Connect X Account" below to test OAuth flow.',
          client_id_preview: credentials.client_id.substring(0, 15) + '...',
          client_secret_length: credentials.client_secret.length,
          redirect_uri: process.env.X_REDIRECT_URI || 'http://localhost:3000/api/x-auth/callback',
          next_step: 'Use "Connect X Account" button to complete OAuth and verify credentials work'
        }
      });
    } catch (error) {
      console.error('Error testing X credentials:', error);
      res.status(500).json({
        success: false,
        message: 'Internal error during test',
        details: {
          error: error.message
        }
      });
    }
  });

  /**
   * DELETE /api/admin/x-credentials
   * Delete stored X API credentials
   */
  router.delete('/', authenticateToken, async (req, res) => {
    try {
      await query(
        'DELETE FROM system_config WHERE config_key IN (?, ?)',
        ['X_CLIENT_ID', 'X_CLIENT_SECRET']
      );

      res.json({
        success: true,
        message: 'X API credentials deleted'
      });
    } catch (error) {
      console.error('Error deleting X credentials:', error);
      res.status(500).json({
        error: 'Failed to delete credentials',
        message: error.message
      });
    }
  });

  return router;
}
