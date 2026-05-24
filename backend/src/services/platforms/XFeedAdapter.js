/**
 * X (Twitter) Feed Adapter
 *
 * Implements PlatformAdapter for X/Twitter feed ingestion
 */

import PlatformAdapter, { PLATFORM_ADAPTERS } from './PlatformAdapter.js';

const X_API_BASE = 'https://api.twitter.com/2';

export class XFeedAdapter extends PlatformAdapter {
  constructor(accessToken) {
    super('x');
    this.accessToken = accessToken;
  }

  /**
   * Fetch home timeline feed
   */
  async fetchFeed({ limit = 20, cursor = null }) {
    try {
      // Try to fetch home timeline (requires elevated access)
      const params = new URLSearchParams({
        max_results: String(limit),
        'tweet.fields': 'created_at,author_id,conversation_id,in_reply_to_user_id,public_metrics,lang,note_tweet',
        'expansions': 'author_id,attachments.media_keys',
        'user.fields': 'username,name,profile_image_url,verified',
        'media.fields': 'url,preview_image_url',
      });

      if (cursor) {
        params.append('pagination_token', cursor);
      }

      // Note: Home timeline requires OAuth 1.0a or elevated access
      // Fallback to user timeline of watched accounts if not available
      const response = await fetch(
        `${X_API_BASE}/tweets/search/recent?query=-is:retweet&${params}`,
        {
          headers: {
            'Authorization': `Bearer ${this.accessToken}`,
          },
        }
      );

      if (!response.ok) {
        console.warn('X feed fetch failed, will use fallback');
        return [];
      }

      const data = await response.json();
      return this._transformPosts(data);
    } catch (error) {
      console.error('X feed fetch error:', error);
      return [];
    }
  }

  /**
   * Fetch specific user's timeline (for watching accounts)
   */
  async fetchUserTimeline(username, limit = 20) {
    try {
      // Get user ID first
      const userResponse = await fetch(
        `${X_API_BASE}/users/by/username/${username}`,
        {
          headers: {
            'Authorization': `Bearer ${this.accessToken}`,
          },
        }
      );

      if (!userResponse.ok) {
        throw new Error(`User not found: ${username}`);
      }

      const userData = await userResponse.json();
      const userId = userData.data.id;

      // Fetch user's tweets
      const params = new URLSearchParams({
        max_results: String(limit),
        'tweet.fields': 'created_at,author_id,conversation_id,in_reply_to_user_id,public_metrics,lang,note_tweet',
        'expansions': 'attachments.media_keys',
        'media.fields': 'url,preview_image_url',
      });

      const response = await fetch(
        `${X_API_BASE}/users/${userId}/tweets?${params}`,
        {
          headers: {
            'Authorization': `Bearer ${this.accessToken}`,
          },
        }
      );

      if (!response.ok) {
        throw new Error('Failed to fetch user timeline');
      }

      const data = await response.json();

      // Add user info to includes
      data.includes = data.includes || {};
      data.includes.users = [userData.data];

      return this._transformPosts(data);
    } catch (error) {
      console.error(`X user timeline fetch error for ${username}:`, error);
      return [];
    }
  }

  /**
   * Fetch thread/conversation
   */
  async fetchThread(postId) {
    try {
      // Fetch the main tweet
      const tweetResponse = await fetch(
        `${X_API_BASE}/tweets/${postId}?` +
        new URLSearchParams({
          'tweet.fields': 'created_at,author_id,conversation_id,in_reply_to_user_id,public_metrics,lang,note_tweet',
          'expansions': 'author_id,attachments.media_keys',
          'user.fields': 'username,name,profile_image_url,verified',
          'media.fields': 'url,preview_image_url',
        }),
        {
          headers: {
            'Authorization': `Bearer ${this.accessToken}`,
          },
        }
      );

      if (!tweetResponse.ok) {
        throw new Error('Tweet not found');
      }

      const tweetData = await tweetResponse.json();
      const conversationId = tweetData.data.conversation_id;

      // Fetch conversation thread
      const conversationResponse = await fetch(
        `${X_API_BASE}/tweets/search/recent?` +
        new URLSearchParams({
          'query': `conversation_id:${conversationId}`,
          'max_results': '100',
          'tweet.fields': 'created_at,author_id,conversation_id,in_reply_to_user_id,public_metrics,lang,note_tweet',
          'expansions': 'author_id,attachments.media_keys',
          'user.fields': 'username,name,profile_image_url,verified',
          'media.fields': 'url,preview_image_url',
        }),
        {
          headers: {
            'Authorization': `Bearer ${this.accessToken}`,
          },
        }
      );

      let allTweets = [tweetData.data];
      let includes = tweetData.includes || {};

      if (conversationResponse.ok) {
        const conversationData = await conversationResponse.json();
        allTweets = conversationData.data || [tweetData.data];
        includes = conversationData.includes || tweetData.includes || {};
      }

      return this._transformPosts({ data: allTweets, includes });
    } catch (error) {
      console.error('X thread fetch error:', error);
      throw error;
    }
  }

  /**
   * Fetch engagement metrics
   */
  async fetchEngagement(postIds) {
    try {
      const metrics = [];

      // Batch fetch tweets (max 100 per request)
      for (let i = 0; i < postIds.length; i += 100) {
        const batch = postIds.slice(i, i + 100);
        const response = await fetch(
          `${X_API_BASE}/tweets?ids=${batch.join(',')}&tweet.fields=public_metrics,note_tweet`,
          {
            headers: {
              'Authorization': `Bearer ${this.accessToken}`,
            },
          }
        );

        if (response.ok) {
          const data = await response.json();
          data.data?.forEach(tweet => {
            metrics.push({
              post_id: tweet.id,
              likes: tweet.public_metrics?.like_count || 0,
              replies: tweet.public_metrics?.reply_count || 0,
              shares: tweet.public_metrics?.retweet_count || 0,
              views: tweet.public_metrics?.impression_count || 0,
              synced_at: new Date(),
            });
          });
        }
      }

      return metrics;
    } catch (error) {
      console.error('X engagement fetch error:', error);
      return [];
    }
  }

  /**
   * Search posts
   */
  async searchPosts(query, limit = 20) {
    try {
      const response = await fetch(
        `${X_API_BASE}/tweets/search/recent?` +
        new URLSearchParams({
          'query': query,
          'max_results': String(limit),
          'tweet.fields': 'created_at,author_id,conversation_id,public_metrics,lang,note_tweet',
          'expansions': 'author_id,attachments.media_keys',
          'user.fields': 'username,name,profile_image_url,verified',
          'media.fields': 'url,preview_image_url',
        }),
        {
          headers: {
            'Authorization': `Bearer ${this.accessToken}`,
          },
        }
      );

      if (!response.ok) {
        throw new Error('Search failed');
      }

      const data = await response.json();
      return this._transformPosts(data);
    } catch (error) {
      console.error('X search error:', error);
      return [];
    }
  }

  /**
   * Transform X API response to ImportedPost format
   */
  _transformPosts(data) {
    if (!data.data || !Array.isArray(data.data)) {
      return [];
    }

    const users = {};
    const media = {};

    // Build lookup maps
    data.includes?.users?.forEach(user => {
      users[user.id] = user;
    });

    data.includes?.media?.forEach(m => {
      media[m.media_key] = m;
    });

    return data.data.map(tweet => {
      const author = users[tweet.author_id] || {};
      const mediaUrls = [];

      if (tweet.attachments?.media_keys) {
        tweet.attachments.media_keys.forEach(key => {
          const m = media[key];
          if (m) {
            mediaUrls.push(m.url || m.preview_image_url);
          }
        });
      }

      // Debug logging for tweet text
      const fullText = tweet.note_tweet?.text || tweet.text;
      if (tweet.note_tweet) {
        console.log(`📝 [X] Tweet ${tweet.id} has note_tweet (${tweet.note_tweet.text.length} chars)`);
      } else if (tweet.text.length > 270) {
        console.warn(`⚠️ [X] Tweet ${tweet.id} text is ${tweet.text.length} chars but no note_tweet field!`);
      }

      return {
        platform: 'x',
        post_id: tweet.id,
        post_url: `https://x.com/${author.username}/status/${tweet.id}`,
        author_username: author.username || 'unknown',
        author_display_name: author.name || author.username,
        author_avatar_url: author.profile_image_url,
        author_verified: author.verified || false,
        post_text: fullText,
        media_urls: mediaUrls.length > 0 ? mediaUrls : null,
        created_at: new Date(tweet.created_at),
        engagement: {
          likes: tweet.public_metrics?.like_count || 0,
          replies: tweet.public_metrics?.reply_count || 0,
          shares: tweet.public_metrics?.retweet_count || 0,
          views: tweet.public_metrics?.impression_count || 0,
        },
        conversation_id: tweet.conversation_id,
        reply_to_post_id: tweet.in_reply_to_user_id,
      };
    });
  }
}

// Register adapter
PLATFORM_ADAPTERS.x = XFeedAdapter;
PLATFORM_ADAPTERS.twitter = XFeedAdapter; // Alias

export default XFeedAdapter;
