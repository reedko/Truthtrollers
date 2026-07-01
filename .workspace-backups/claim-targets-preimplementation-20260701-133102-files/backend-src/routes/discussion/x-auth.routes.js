/**
 * X/Twitter OAuth Routes
 *
 * Handles OAuth 2.0 authentication flow for X/Twitter API access
 */

import { Router } from 'express';
import crypto from 'crypto';
import { authenticateToken } from '../../middleware/auth.js';
import {
  generateAuthUrl,
  exchangeCodeForToken,
  refreshAccessToken,
  getUserInfo
} from '../../services/xTwitterService.js';

// Temporary storage for PKCE verifiers (in production, use Redis or session store)
const pkceStore = new Map();

export default function createXAuthRouter({ query, pool }) {
  const router = Router();

  /**
   * GET /api/x-auth/connect
   * Initiate OAuth flow - redirect user to X authorization page
   */
  router.get('/connect', authenticateToken, async (req, res) => {
    const userId = req.user?.user_id;
    const redirectTo = req.query.redirect || 'social-admin'; // 'ttlive' or 'social-admin'

    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    try {
      // Generate CSRF token with userId embedded
      const state = crypto.randomBytes(16).toString('hex');

      // Generate OAuth URL with PKCE
      const { url, codeVerifier } = generateAuthUrl(state);

      // Store PKCE verifier, state, userId, AND redirect destination (5 min expiry)
      pkceStore.set(state, {
        codeVerifier,
        userId,
        redirectTo,
        timestamp: Date.now()
      });

      // Cleanup old entries (older than 5 minutes)
      const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
      for (const [key, value] of pkceStore.entries()) {
        if (value.timestamp < fiveMinutesAgo) {
          pkceStore.delete(key);
        }
      }

      res.json({
        success: true,
        auth_url: url,
        state: state
      });

    } catch (error) {
      console.error('X auth connect error:', error);
      res.status(500).json({
        error: 'Failed to initiate X authentication',
        details: error.message
      });
    }
  });

  /**
   * GET /api/x-auth/callback
   * OAuth callback - exchange code for access token
   */
  router.get('/callback', async (req, res) => {
    const { code, state, error } = req.query;

    // Handle OAuth errors
    if (error) {
      return res.status(400).json({
        error: 'X authorization failed',
        details: error
      });
    }

    if (!code || !state) {
      return res.status(400).json({
        error: 'Missing authorization code or state'
      });
    }

    try {
      // Retrieve session data from state (includes userId and PKCE verifier)
      const session = pkceStore.get(state);

      if (!session) {
        return res.status(400).json({
          error: 'Invalid or expired OAuth state',
          hint: 'Please retry authentication. The OAuth session may have expired (5 minute timeout).'
        });
      }

      // Get userId from stored session
      const userId = session.userId;

      // Exchange code for token
      const tokenData = await exchangeCodeForToken(code, session.codeVerifier);

      // Get X user info
      const xUserInfo = await getUserInfo(tokenData.access_token);

      // Calculate token expiration
      const expiresAt = new Date(Date.now() + tokenData.expires_in * 1000);

      // Store token in database
      await query(
        `INSERT INTO x_auth_tokens (
          user_id, access_token, refresh_token, token_type,
          expires_at, scope, x_user_id, x_username, x_display_name, is_valid
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, TRUE)
        ON DUPLICATE KEY UPDATE
          access_token = VALUES(access_token),
          refresh_token = VALUES(refresh_token),
          expires_at = VALUES(expires_at),
          scope = VALUES(scope),
          x_user_id = VALUES(x_user_id),
          x_username = VALUES(x_username),
          x_display_name = VALUES(x_display_name),
          is_valid = TRUE,
          updated_at = NOW()`,
        [
          userId,
          tokenData.access_token,
          tokenData.refresh_token || null,
          tokenData.token_type,
          expiresAt,
          tokenData.scope,
          xUserInfo.x_user_id,
          xUserInfo.x_username,
          xUserInfo.x_display_name
        ]
      );

      // Cleanup PKCE session
      pkceStore.delete(state);

      // Determine redirect destination
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
      let redirectPath;

      if (session.redirectTo === 'ttlive') {
        redirectPath = `/ttlive?connected=true&username=${encodeURIComponent(xUserInfo.x_username)}`;
      } else {
        redirectPath = `/admin/social?connected=true&username=${encodeURIComponent(xUserInfo.x_username)}`;
      }

      res.redirect(`${frontendUrl}${redirectPath}`);

    } catch (error) {
      console.error('X auth callback error:', error);
      res.status(500).json({
        error: 'Failed to complete X authentication',
        details: error.message
      });
    }
  });

  /**
   * GET /api/x-auth/status
   * Check if user has connected X account
   */
  router.get('/status', authenticateToken, async (req, res) => {
    const userId = req.user?.user_id;
    const userEmail = req.user?.email;

    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    try {
      // Get current user's email from database
      const [user] = await query(
        `SELECT email, username FROM users WHERE user_id = ?`,
        [userId]
      );

      const tokens = await query(
        `SELECT
          x_user_id, x_username, x_display_name,
          is_valid, expires_at, created_at
        FROM x_auth_tokens
        WHERE user_id = ?
        ORDER BY created_at DESC
        LIMIT 1`,
        [userId]
      );

      if (!tokens || tokens.length === 0) {
        return res.json({
          connected: false,
          truthtrollers_email: user?.email
        });
      }

      const token = tokens[0];

      // Check if token is expired
      const isExpired = token.expires_at && new Date(token.expires_at) < new Date();

      res.json({
        connected: token.is_valid && !isExpired,
        x_username: token.x_username,
        x_display_name: token.x_display_name,
        x_user_id: token.x_user_id,
        expires_at: token.expires_at,
        needs_refresh: isExpired,
        truthtrollers_email: user?.email,
        truthtrollers_username: user?.username
      });

    } catch (error) {
      console.error('X auth status error:', error);
      res.status(500).json({
        error: 'Failed to check X auth status',
        details: error.message
      });
    }
  });

  /**
   * POST /api/x-auth/refresh
   * Refresh expired access token
   */
  router.post('/refresh', authenticateToken, async (req, res) => {
    const userId = req.user?.user_id;

    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    try {
      // Get current token
      const tokens = await query(
        `SELECT * FROM x_auth_tokens
         WHERE user_id = ? AND is_valid = TRUE
         ORDER BY created_at DESC
         LIMIT 1`,
        [userId]
      );

      if (!tokens || tokens.length === 0) {
        return res.status(400).json({
          error: 'No X account connected'
        });
      }

      const currentToken = tokens[0];

      if (!currentToken.refresh_token) {
        return res.status(400).json({
          error: 'No refresh token available',
          hint: 'Please re-authenticate with X'
        });
      }

      // Refresh token
      const newTokenData = await refreshAccessToken(currentToken.refresh_token);

      // Calculate new expiration
      const expiresAt = new Date(Date.now() + newTokenData.expires_in * 1000);

      // Update database
      await query(
        `UPDATE x_auth_tokens
         SET access_token = ?,
             refresh_token = ?,
             expires_at = ?,
             updated_at = NOW()
         WHERE user_id = ? AND token_id = ?`,
        [
          newTokenData.access_token,
          newTokenData.refresh_token,
          expiresAt,
          userId,
          currentToken.token_id
        ]
      );

      res.json({
        success: true,
        expires_at: expiresAt
      });

    } catch (error) {
      console.error('X token refresh error:', error);

      // Mark token as invalid if refresh fails
      await query(
        `UPDATE x_auth_tokens
         SET is_valid = FALSE, revoked_at = NOW()
         WHERE user_id = ?`,
        [userId]
      );

      res.status(500).json({
        error: 'Failed to refresh token',
        details: error.message,
        hint: 'Please re-authenticate with X'
      });
    }
  });

  /**
   * DELETE /api/x-auth/disconnect
   * Revoke X connection
   */
  router.delete('/disconnect', authenticateToken, async (req, res) => {
    const userId = req.user?.user_id;

    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    try {
      await query(
        `UPDATE x_auth_tokens
         SET is_valid = FALSE, revoked_at = NOW()
         WHERE user_id = ?`,
        [userId]
      );

      res.json({
        success: true,
        message: 'X account disconnected'
      });

    } catch (error) {
      console.error('X disconnect error:', error);
      res.status(500).json({
        error: 'Failed to disconnect X account',
        details: error.message
      });
    }
  });

  /**
   * GET /api/x-auth/rate-limits
   * Get user's current rate limit status
   */
  router.get('/rate-limits', authenticateToken, async (req, res) => {
    const userId = req.user?.user_id;

    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    try {
      const limits = await query(
        `SELECT * FROM social_post_rate_limits
         WHERE user_id = ? AND platform = 'twitter_x'`,
        [userId]
      );

      if (!limits || limits.length === 0) {
        return res.json({
          posts_in_last_hour: 0,
          posts_in_last_day: 0,
          bundles_posted_today: 0,
          can_post: true,
          hourly_limit: 10,
          daily_limit: 50
        });
      }

      const limit = limits[0];

      // Check if can post
      const result = await query(
        'CALL check_rate_limit(?, ?, @can_post, @reason); SELECT @can_post as can_post, @reason as reason',
        [userId, 'twitter_x']
      );

      const canPost = result[1][0];

      res.json({
        posts_in_last_hour: limit.posts_in_last_hour,
        posts_in_last_day: limit.posts_in_last_day,
        bundles_posted_today: limit.bundles_posted_today,
        last_post_at: limit.last_post_at,
        can_post: canPost.can_post,
        reason: canPost.reason,
        is_blocked: limit.is_temporarily_blocked,
        blocked_until: limit.blocked_until,
        hourly_limit: 10,
        daily_limit: 50
      });

    } catch (error) {
      console.error('Get rate limits error:', error);
      res.status(500).json({
        error: 'Failed to fetch rate limits',
        details: error.message
      });
    }
  });

  return router;
}
