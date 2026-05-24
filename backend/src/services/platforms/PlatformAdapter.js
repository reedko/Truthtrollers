/**
 * Platform Adapter Interface
 *
 * Abstraction for multi-platform feed ingestion
 * Supports: X, Instagram, Facebook, Reddit
 */

/**
 * @typedef {Object} FeedParams
 * @property {number} limit - Max posts to fetch
 * @property {string} [cursor] - Pagination cursor
 * @property {string[]} [accounts] - Specific accounts to watch
 * @property {string} [query] - Search query
 */

/**
 * @typedef {Object} ImportedPost
 * @property {string} platform - Source platform (x, instagram, facebook, reddit)
 * @property {string} post_id - Platform-specific post ID
 * @property {string} post_url - Full URL to original post
 * @property {string} author_username - Author handle
 * @property {string} [author_display_name] - Author display name
 * @property {string} [author_avatar_url] - Author profile picture
 * @property {boolean} author_verified - Verified badge
 * @property {string} post_text - Post content
 * @property {string[]} [media_urls] - Attached media
 * @property {Date} created_at - Original post timestamp
 * @property {Object} engagement - Engagement metrics
 * @property {number} engagement.likes - Like count
 * @property {number} engagement.replies - Reply count
 * @property {number} engagement.shares - Share/retweet count
 * @property {number} engagement.views - View count (if available)
 * @property {string} [conversation_id] - Thread/conversation ID
 * @property {string} [reply_to_post_id] - If this is a reply
 */

/**
 * @typedef {Object} EngagementMetrics
 * @property {string} post_id - Post ID
 * @property {number} likes
 * @property {number} replies
 * @property {number} shares
 * @property {number} views
 * @property {Date} synced_at - When metrics were fetched
 */

/**
 * Platform Adapter Interface
 * All platform adapters must implement these methods
 */
export class PlatformAdapter {
  /**
   * @param {string} platform - Platform name (x, instagram, facebook, reddit)
   */
  constructor(platform) {
    this.platform = platform;
  }

  /**
   * Fetch feed from platform
   * @param {FeedParams} params
   * @returns {Promise<ImportedPost[]>}
   */
  async fetchFeed(params) {
    throw new Error('fetchFeed() must be implemented by platform adapter');
  }

  /**
   * Fetch specific thread/conversation
   * @param {string} postId - Original post ID
   * @returns {Promise<ImportedPost[]>}
   */
  async fetchThread(postId) {
    throw new Error('fetchThread() must be implemented by platform adapter');
  }

  /**
   * Fetch engagement metrics for posts
   * @param {string[]} postIds
   * @returns {Promise<EngagementMetrics[]>}
   */
  async fetchEngagement(postIds) {
    throw new Error('fetchEngagement() must be implemented by platform adapter');
  }

  /**
   * Fetch user timeline (for watching specific accounts)
   * @param {string} username
   * @param {number} limit
   * @returns {Promise<ImportedPost[]>}
   */
  async fetchUserTimeline(username, limit = 20) {
    throw new Error('fetchUserTimeline() must be implemented by platform adapter');
  }

  /**
   * Search posts by query
   * @param {string} query
   * @param {number} limit
   * @returns {Promise<ImportedPost[]>}
   */
  async searchPosts(query, limit = 20) {
    throw new Error('searchPosts() must be implemented by platform adapter');
  }
}

/**
 * Platform Registry
 * Maps platform names to adapter classes
 */
export const PLATFORM_ADAPTERS = {
  x: null, // Will be set by XAdapter
  twitter: null, // Alias for x
  instagram: null, // Future
  facebook: null, // Future
  reddit: null, // Future
};

/**
 * Get adapter for platform
 * @param {string} platform
 * @param {string} accessToken
 * @returns {PlatformAdapter}
 */
export function getAdapter(platform, accessToken) {
  const AdapterClass = PLATFORM_ADAPTERS[platform];

  if (!AdapterClass) {
    throw new Error(`Platform adapter not available: ${platform}`);
  }

  return new AdapterClass(accessToken);
}

export default PlatformAdapter;
