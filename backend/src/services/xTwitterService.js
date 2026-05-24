/**
 * X/Twitter API Integration Service
 *
 * Handles OAuth authentication and tweet posting via X API v2
 */

import crypto from 'crypto';

// X API v2 credentials (set via environment variables)
const X_CLIENT_ID = process.env.X_CLIENT_ID;
const X_CLIENT_SECRET = process.env.X_CLIENT_SECRET;
const X_REDIRECT_URI = process.env.X_REDIRECT_URI || 'http://localhost:3000/auth/x/callback';

/**
 * Generate OAuth 2.0 authorization URL
 *
 * @param {string} state - CSRF protection token
 * @param {boolean} forceLogin - Force X to show login screen (for new users)
 * @returns {string} Authorization URL
 */
export function generateAuthUrl(state, forceLogin = true) {
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);

  // Use authorize endpoint (allows switching accounts) instead of authenticate
  const authEndpoint = 'https://twitter.com/i/oauth2/authorize';

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: X_CLIENT_ID,
    redirect_uri: X_REDIRECT_URI,
    scope: 'tweet.read tweet.write users.read offline.access',
    state: state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256'
  });

  // Force login for first-time connections to ensure correct X account
  if (forceLogin) {
    params.append('force_login', 'true');
  }

  return {
    url: `${authEndpoint}?${params.toString()}`,
    codeVerifier // Store this temporarily for token exchange
  };
}

/**
 * Exchange authorization code for access token
 *
 * @param {string} code - Authorization code from callback
 * @param {string} codeVerifier - PKCE code verifier
 * @returns {Promise<Object>} Token data
 */
export async function exchangeCodeForToken(code, codeVerifier) {
  const params = new URLSearchParams({
    grant_type: 'authorization_code',
    code: code,
    redirect_uri: X_REDIRECT_URI,
    code_verifier: codeVerifier,
    client_id: X_CLIENT_ID
  });

  const authHeader = Buffer.from(`${X_CLIENT_ID}:${X_CLIENT_SECRET}`).toString('base64');

  const response = await fetch('https://api.twitter.com/2/oauth2/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': `Basic ${authHeader}`
    },
    body: params.toString()
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Token exchange failed: ${error}`);
  }

  const data = await response.json();

  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_in: data.expires_in, // seconds
    scope: data.scope,
    token_type: data.token_type
  };
}

/**
 * Refresh access token
 *
 * @param {string} refreshToken
 * @returns {Promise<Object>} New token data
 */
export async function refreshAccessToken(refreshToken) {
  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: X_CLIENT_ID
  });

  const authHeader = Buffer.from(`${X_CLIENT_ID}:${X_CLIENT_SECRET}`).toString('base64');

  const response = await fetch('https://api.twitter.com/2/oauth2/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': `Basic ${authHeader}`
    },
    body: params.toString()
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Token refresh failed: ${error}`);
  }

  const data = await response.json();

  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token || refreshToken, // Some don't return new refresh token
    expires_in: data.expires_in,
    scope: data.scope,
    token_type: data.token_type
  };
}

/**
 * Get authenticated user info
 *
 * @param {string} accessToken
 * @returns {Promise<Object>} User data
 */
export async function getUserInfo(accessToken) {
  const response = await fetch('https://api.twitter.com/2/users/me?user.fields=username,name,verified,profile_image_url', {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${accessToken}`
    }
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Get user info failed: ${error}`);
  }

  const data = await response.json();

  return {
    x_user_id: data.data.id,
    x_username: data.data.username,
    x_display_name: data.data.name
  };
}

/**
 * Post a tweet
 *
 * @param {string} accessToken
 * @param {string} text - Tweet text (max 280 chars)
 * @param {string} replyToTweetId - Optional: tweet ID to reply to
 * @returns {Promise<Object>} Tweet data
 */
export async function postTweet(accessToken, text, replyToTweetId = null) {
  if (text.length > 280) {
    throw new Error(`Tweet exceeds 280 characters: ${text.length}`);
  }

  const payload = {
    text: text
  };

  if (replyToTweetId) {
    payload.reply = {
      in_reply_to_tweet_id: replyToTweetId
    };
  }

  const response = await fetch('https://api.twitter.com/2/tweets', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Post tweet failed: ${error.detail || JSON.stringify(error)}`);
  }

  const data = await response.json();

  return {
    tweet_id: data.data.id,
    text: data.data.text,
    url: `https://twitter.com/i/web/status/${data.data.id}`
  };
}

/**
 * Post a thread of tweets
 *
 * @param {string} accessToken
 * @param {Array<string>} tweets - Array of tweet texts
 * @param {string} replyToTweetId - Optional: original tweet to reply to
 * @param {number} delayMs - Delay between tweets (milliseconds)
 * @returns {Promise<Array>} Array of posted tweet data
 */
export async function postThread(accessToken, tweets, replyToTweetId = null, delayMs = 2000) {
  const results = [];
  let currentReplyTo = replyToTweetId;

  for (let i = 0; i < tweets.length; i++) {
    const tweet = tweets[i];

    try {
      // Add delay between tweets (except first)
      if (i > 0) {
        await delay(delayMs);
      }

      const result = await postTweet(accessToken, tweet, currentReplyTo);
      results.push({
        success: true,
        position: i + 1,
        ...result
      });

      // Next tweet replies to this one
      currentReplyTo = result.tweet_id;
    } catch (error) {
      results.push({
        success: false,
        position: i + 1,
        error: error.message,
        text: tweet
      });

      // Stop posting if one fails
      console.error(`Failed to post tweet ${i + 1}:`, error.message);
      break;
    }
  }

  return results;
}

/**
 * Get tweet metrics (engagement)
 *
 * @param {string} accessToken
 * @param {string} tweetId
 * @returns {Promise<Object>} Engagement metrics
 */
export async function getTweetMetrics(accessToken, tweetId) {
  const params = new URLSearchParams({
    'tweet.fields': 'public_metrics'
  });

  const response = await fetch(`https://api.twitter.com/2/tweets/${tweetId}?${params}`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${accessToken}`
    }
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Get tweet metrics failed: ${error}`);
  }

  const data = await response.json();

  return {
    likes_count: data.data.public_metrics.like_count,
    retweets_count: data.data.public_metrics.retweet_count,
    replies_count: data.data.public_metrics.reply_count,
    quote_tweets_count: data.data.public_metrics.quote_count
  };
}

/**
 * Delete a tweet
 *
 * @param {string} accessToken
 * @param {string} tweetId
 * @returns {Promise<boolean>} Success
 */
export async function deleteTweet(accessToken, tweetId) {
  const response = await fetch(`https://api.twitter.com/2/tweets/${tweetId}`, {
    method: 'DELETE',
    headers: {
      'Authorization': `Bearer ${accessToken}`
    }
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Delete tweet failed: ${error}`);
  }

  const data = await response.json();
  return data.data.deleted === true;
}

// ========================================
// Helper Functions
// ========================================

/**
 * Generate PKCE code verifier
 */
function generateCodeVerifier() {
  return crypto.randomBytes(32).toString('base64url');
}

/**
 * Generate PKCE code challenge from verifier
 */
function generateCodeChallenge(verifier) {
  return crypto
    .createHash('sha256')
    .update(verifier)
    .digest('base64url');
}

/**
 * Delay helper
 */
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Validate tweet text
 */
export function validateTweetText(text) {
  const errors = [];

  if (!text || text.trim().length === 0) {
    errors.push('Tweet text cannot be empty');
  }

  if (text.length > 280) {
    errors.push(`Tweet exceeds 280 characters (${text.length})`);
  }

  // Check for problematic characters
  if (text.includes('\u0000')) {
    errors.push('Tweet contains null characters');
  }

  return {
    valid: errors.length === 0,
    errors,
    length: text.length
  };
}

/**
 * Calculate recommended delay between tweets
 * Based on thread length and content
 */
export function calculateRecommendedDelay(threadLength) {
  // Longer threads = more delay to avoid spam detection
  if (threadLength <= 2) return 2000; // 2 seconds
  if (threadLength <= 5) return 5000; // 5 seconds
  return 10000; // 10 seconds for long threads
}
