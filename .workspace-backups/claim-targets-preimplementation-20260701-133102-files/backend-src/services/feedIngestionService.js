/**
 * Feed Ingestion Service
 *
 * Manages live feed viewing with fallback strategies
 * Core philosophy: viewing first, posting never assumed
 */

import { getAdapter } from './platforms/PlatformAdapter.js';
import XFeedAdapter from './platforms/XFeedAdapter.js';

/**
 * Get mixed feed for user
 * Combines: platform feeds, monitored threads, TT discussions
 */
export async function getMixedFeed({ query }, user_id, {
  limit = 20,
  platform = 'x',
  cursor = null,
  include_monitored = true,
  include_tt_activity = true
}) {
  const feedItems = [];

  try {
    // Try to get platform feed
    const platformFeed = await getPlatformFeed(query, user_id, platform, limit);
    feedItems.push(...platformFeed);

    // Add monitored threads (user's watched content)
    if (include_monitored) {
      const monitored = await getMonitoredFeed(query, user_id, limit);
      feedItems.push(...monitored);
    }

    // Add recent TT activity
    if (include_tt_activity) {
      const ttActivity = await getTTActivityFeed(query, user_id, limit);
      feedItems.push(...ttActivity);
    }

    // Sort by recency
    feedItems.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    // Deduplicate by post_id
    const seen = new Set();
    const uniqueFeed = feedItems.filter(item => {
      if (seen.has(item.post_id)) return false;
      seen.add(item.post_id);
      return true;
    });

    return uniqueFeed.slice(0, limit);
  } catch (error) {
    console.error('Mixed feed error:', error);
    return [];
  }
}

/**
 * Get platform feed (with fallback)
 */
async function getPlatformFeed(query, user_id, platform, limit) {
  try {
    // Get user's platform token
    const [auth] = await query(`
      SELECT access_token FROM x_auth_tokens
      WHERE user_id = ? AND is_valid = TRUE
      LIMIT 1
    `, [user_id]);

    if (!auth) {
      console.log('No platform auth, using fallback');
      return await getFallbackFeed(query, user_id, platform, limit);
    }

    // Try platform adapter
    const adapter = getAdapter(platform, auth.access_token);
    const posts = await adapter.fetchFeed({ limit });

    if (posts.length === 0) {
      console.log('Platform feed empty, using fallback');
      return await getFallbackFeed(query, user_id, platform, limit);
    }

    // Enrich with TT metadata
    return await enrichWithTTMetadata(query, posts);
  } catch (error) {
    console.error('Platform feed fetch failed, using fallback:', error);
    return await getFallbackFeed(query, user_id, platform, limit);
  }
}

/**
 * FALLBACK: Get feed from imported/monitored content
 * This ensures feed always works even without live API access
 */
async function getFallbackFeed(query, user_id, platform, limit) {
  // Get recently imported posts
  const imported = await query(`
    SELECT
      'imported' AS item_type,
      ip.imported_post_id AS post_id,
      ip.source_platform AS platform,
      ip.source_url AS post_url,
      ip.source_author_username AS author_username,
      ip.source_author_display_name AS author_display_name,
      ip.source_author_avatar_url AS author_avatar_url,
      ip.source_author_verified AS author_verified,
      ip.post_text,
      ip.post_media_urls AS media_urls,
      ip.source_created_at AS created_at,
      ip.source_likes_count AS likes,
      ip.source_retweets_count AS shares,
      ip.source_replies_count AS replies,
      0 AS views,
      t.thread_id,
      (SELECT COUNT(*) FROM ttlive_posts WHERE thread_id = t.thread_id AND is_hidden = FALSE) AS tt_discussion_count,
      (SELECT COUNT(*) FROM ttlive_post_evidence pe JOIN ttlive_posts p ON pe.post_id = p.post_id WHERE p.thread_id = t.thread_id) AS evidence_count
    FROM ttlive_imported_posts ip
    JOIN ttlive_threads t ON ip.thread_id = t.thread_id
    WHERE ip.source_platform = ?
      AND t.is_archived = FALSE
    ORDER BY ip.source_created_at DESC
    LIMIT ?
  `, [platform, limit]);

  return imported.map(row => ({
    item_type: 'imported',
    post_id: row.post_id,
    thread_id: row.thread_id,
    platform: row.platform,
    post_url: row.post_url,
    author_username: row.author_username,
    author_display_name: row.author_display_name,
    author_avatar_url: row.author_avatar_url,
    author_verified: Boolean(row.author_verified),
    post_text: row.post_text,
    media_urls: row.media_urls ? JSON.parse(row.media_urls) : [],
    created_at: row.created_at,
    engagement: {
      likes: row.likes,
      shares: row.shares,
      replies: row.replies,
      views: row.views,
    },
    tt_metadata: {
      discussion_count: row.tt_discussion_count,
      evidence_count: row.evidence_count,
      is_monitored: true,
    },
  }));
}

/**
 * Get monitored feed (user's watched threads)
 */
async function getMonitoredFeed(query, user_id, limit) {
  const monitored = await query(`
    SELECT
      'monitored' AS item_type,
      ip.imported_post_id AS post_id,
      t.thread_id,
      ip.source_platform AS platform,
      ip.source_url AS post_url,
      ip.source_author_username AS author_username,
      ip.source_author_display_name AS author_display_name,
      ip.source_author_avatar_url AS author_avatar_url,
      ip.source_author_verified AS author_verified,
      ip.post_text,
      ip.post_media_urls AS media_urls,
      ip.source_created_at AS created_at,
      ip.source_likes_count AS likes,
      ip.source_retweets_count AS shares,
      ip.source_replies_count AS replies,
      0 AS views,
      (SELECT COUNT(*) FROM ttlive_posts WHERE thread_id = t.thread_id AND is_hidden = FALSE) AS tt_discussion_count,
      (SELECT COUNT(*) FROM ttlive_post_evidence pe JOIN ttlive_posts p ON pe.post_id = p.post_id WHERE p.thread_id = t.thread_id) AS evidence_count,
      s.is_monitoring
    FROM ttlive_thread_subscriptions s
    JOIN ttlive_threads t ON s.thread_id = t.thread_id
    JOIN ttlive_imported_posts ip ON ip.thread_id = t.thread_id AND ip.is_thread_root = TRUE
    WHERE s.user_id = ?
      AND t.is_archived = FALSE
    ORDER BY t.last_activity_at DESC
    LIMIT ?
  `, [user_id, Math.floor(limit / 3)]);

  return monitored.map(row => ({
    item_type: 'monitored',
    post_id: row.post_id,
    thread_id: row.thread_id,
    platform: row.platform,
    post_url: row.post_url,
    author_username: row.author_username,
    author_display_name: row.author_display_name,
    author_avatar_url: row.author_avatar_url,
    author_verified: Boolean(row.author_verified),
    post_text: row.post_text,
    media_urls: row.media_urls ? JSON.parse(row.media_urls) : [],
    created_at: row.created_at,
    engagement: {
      likes: row.likes,
      shares: row.shares,
      replies: row.replies,
      views: row.views,
    },
    tt_metadata: {
      discussion_count: row.tt_discussion_count,
      evidence_count: row.evidence_count,
      is_monitored: true,
      is_actively_monitoring: Boolean(row.is_monitoring),
    },
  }));
}

/**
 * Get TT activity feed (recent discussions)
 */
async function getTTActivityFeed(query, user_id, limit) {
  const activity = await query(`
    SELECT
      'tt_activity' AS item_type,
      p.post_id,
      t.thread_id,
      'native' AS platform,
      NULL AS post_url,
      u.username AS author_username,
      u.username AS author_display_name,
      u.user_profile_image AS author_avatar_url,
      FALSE AS author_verified,
      p.post_text,
      p.post_media_urls AS media_urls,
      p.created_at,
      p.upvotes_count AS likes,
      0 AS shares,
      p.replies_count,
      0 AS views,
      p.stance,
      p.verimeter_score,
      (SELECT COUNT(*) FROM ttlive_posts WHERE thread_id = t.thread_id AND is_hidden = FALSE) AS tt_discussion_count,
      (SELECT COUNT(*) FROM ttlive_post_evidence WHERE post_id = p.post_id) AS evidence_count
    FROM ttlive_posts p
    JOIN ttlive_threads t ON p.thread_id = t.thread_id
    JOIN users u ON p.author_user_id = u.user_id
    WHERE p.is_hidden = FALSE
      AND t.is_archived = FALSE
      AND p.author_user_id != ?
    ORDER BY p.created_at DESC
    LIMIT ?
  `, [user_id, Math.floor(limit / 3)]);

  return activity.map(row => ({
    item_type: 'tt_activity',
    post_id: row.post_id,
    thread_id: row.thread_id,
    platform: 'native',
    post_url: null,
    author_username: row.author_username,
    author_display_name: row.author_display_name,
    author_avatar_url: row.author_avatar_url,
    author_verified: false,
    post_text: row.post_text,
    media_urls: row.media_urls ? JSON.parse(row.media_urls) : [],
    created_at: row.created_at,
    engagement: {
      likes: row.likes,
      shares: row.shares,
      replies: row.replies,
      views: row.views,
    },
    tt_metadata: {
      stance: row.stance,
      verimeter_score: row.verimeter_score,
      discussion_count: row.tt_discussion_count,
      evidence_count: row.evidence_count,
      is_tt_native: true,
    },
  }));
}

/**
 * Enrich platform posts with TT metadata
 */
async function enrichWithTTMetadata(query, posts) {
  const enriched = [];

  for (const post of posts) {
    // Check if post is already imported
    const [existing] = await query(`
      SELECT
        t.thread_id,
        (SELECT COUNT(*) FROM ttlive_posts WHERE thread_id = t.thread_id AND is_hidden = FALSE) AS tt_discussion_count,
        (SELECT COUNT(*) FROM ttlive_post_evidence pe JOIN ttlive_posts p ON pe.post_id = p.post_id WHERE p.thread_id = t.thread_id) AS evidence_count
      FROM ttlive_imported_posts ip
      JOIN ttlive_threads t ON ip.thread_id = t.thread_id
      WHERE ip.source_platform = ? AND ip.source_post_id = ?
    `, [post.platform, post.post_id]);

    enriched.push({
      ...post,
      item_type: 'live_feed',
      thread_id: existing?.thread_id || null,
      tt_metadata: {
        discussion_count: existing?.tt_discussion_count || 0,
        evidence_count: existing?.evidence_count || 0,
        is_monitored: !!existing,
      },
    });
  }

  return enriched;
}

/**
 * Watch/monitor a specific feed item
 */
export async function watchFeedItem({ query }, user_id, feed_item_data) {
  // Import the post if not already imported
  // Subscribe user to thread
  // This makes it appear in "monitored" feed

  // Implementation depends on whether item is already imported
  return { success: true };
}

export default {
  getMixedFeed,
  watchFeedItem,
};
