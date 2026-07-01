/**
 * X/Twitter Platform Adapter
 *
 * Handles importing X/Twitter threads into TT Live
 */

import { v4 as uuidv4 } from 'uuid';

/**
 * Extract tweet ID from X URL
 */
export function extractTweetIdFromUrl(url) {
  // Supports:
  // https://x.com/username/status/1234567890
  // https://twitter.com/username/status/1234567890
  const match = url.match(/(?:x\.com|twitter\.com)\/\w+\/status\/(\d+)/);
  return match ? match[1] : null;
}

/**
 * Fetch tweet and thread from X API
 */
export async function fetchXThread(tweetId, accessToken) {
  const X_API_BASE = 'https://api.twitter.com/2';

  try {
    // Fetch the main tweet
    const tweetResponse = await fetch(
      `${X_API_BASE}/tweets/${tweetId}?` +
      new URLSearchParams({
        'tweet.fields': 'created_at,author_id,conversation_id,in_reply_to_user_id,referenced_tweets,public_metrics,lang,note_tweet,article',
        'expansions': 'author_id,referenced_tweets.id,attachments.media_keys',
        'user.fields': 'username,name,profile_image_url,verified',
        'media.fields': 'url,preview_image_url'
      }),
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
        }
      }
    );

    if (!tweetResponse.ok) {
      const error = await tweetResponse.json();
      throw new Error(`X API error: ${error.detail || tweetResponse.statusText}`);
    }

    const tweetData = await tweetResponse.json();

    // If tweet is part of a conversation, fetch the full thread
    const conversationId = tweetData.data.conversation_id;
    let threadTweets = [tweetData.data];

    if (conversationId && conversationId !== tweetId) {
      // Fetch conversation thread
      const conversationResponse = await fetch(
        `${X_API_BASE}/tweets/search/recent?` +
        new URLSearchParams({
          'query': `conversation_id:${conversationId}`,
          'max_results': '100',
          'tweet.fields': 'created_at,author_id,conversation_id,in_reply_to_user_id,referenced_tweets,public_metrics,lang,note_tweet,article',
          'expansions': 'author_id,referenced_tweets.id,attachments.media_keys',
          'user.fields': 'username,name,profile_image_url,verified',
          'media.fields': 'url,preview_image_url'
        }),
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
          }
        }
      );

      if (conversationResponse.ok) {
        const conversationData = await conversationResponse.json();
        threadTweets = conversationData.data || [tweetData.data];
      }
    }

    // Combine includes (users, media)
    const includes = tweetData.includes || {};

    return {
      tweets: threadTweets,
      users: includes.users || [],
      media: includes.media || [],
      conversationId
    };

  } catch (error) {
    console.error('Error fetching X thread:', error);
    throw error;
  }
}

/**
 * Import X thread into TT Live
 */
export async function importXThread({ query }, {
  x_thread_url,
  access_token,
  task_id = null,
  content_id = null,
  imported_by
}) {
  // Extract tweet ID
  const tweetId = extractTweetIdFromUrl(x_thread_url);
  if (!tweetId) {
    throw new Error('Invalid X/Twitter URL');
  }

  // Check if thread already imported
  const [existing] = await query(`
    SELECT thread_id FROM ttlive_threads
    WHERE source_platform IN ('x', 'twitter')
      AND source_thread_id = ?
  `, [tweetId]);

  if (existing) {
    return { thread_id: existing.thread_id, already_imported: true };
  }

  // Fetch thread from X API
  const { tweets, users, media, conversationId } = await fetchXThread(tweetId, access_token);

  // Create user lookup map
  const userMap = {};
  users.forEach(user => {
    userMap[user.id] = user;
  });

  // Create media lookup map
  const mediaMap = {};
  if (media) {
    media.forEach(m => {
      mediaMap[m.media_key] = m;
    });
  }

  // Create TT Live thread
  const thread_id = uuidv4();
  const rootTweet = tweets[0];
  const rootUser = userMap[rootTweet.author_id];
  const rootFullText = rootTweet.article?.content || rootTweet.note_tweet?.text || rootTweet.text;

  await query(`
    INSERT INTO ttlive_threads (
      thread_id,
      thread_title,
      thread_type,
      source_platform,
      source_thread_id,
      source_url,
      content_id,
      task_id,
      curated_by,
      imported_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
  `, [
    thread_id,
    rootFullText.substring(0, 100) + (rootFullText.length > 100 ? '...' : ''),
    'imported_x',
    'x',
    conversationId || tweetId,
    x_thread_url,
    content_id,
    task_id,
    imported_by
  ]);

  // Import each tweet as imported_post
  const postIdMap = {}; // Map tweet ID to imported_post_id

  for (const tweet of tweets) {
    const imported_post_id = uuidv4();
    const author = userMap[tweet.author_id];

    // Get full text (try article.content, note_tweet.text, or tweet.text)
    const fullText = tweet.article?.content || tweet.note_tweet?.text || tweet.text;

    // Get media URLs
    const media_urls = [];
    if (tweet.attachments && tweet.attachments.media_keys) {
      tweet.attachments.media_keys.forEach(key => {
        const m = mediaMap[key];
        if (m) {
          media_urls.push(m.url || m.preview_image_url);
        }
      });
    }

    // Determine if this is the thread root
    const is_thread_root = tweet.id === (conversationId || tweetId);

    // Find reply-to relationship
    let reply_to_imported_post_id = null;
    if (tweet.referenced_tweets) {
      const replyTo = tweet.referenced_tweets.find(ref => ref.type === 'replied_to');
      if (replyTo && postIdMap[replyTo.id]) {
        reply_to_imported_post_id = postIdMap[replyTo.id];
      }
    }

    // Convert ISO datetime to MySQL format
    const mysqlDatetime = tweet.created_at
      ? new Date(tweet.created_at).toISOString().slice(0, 19).replace('T', ' ')
      : null;

    await query(`
      INSERT INTO ttlive_imported_posts (
        imported_post_id,
        thread_id,
        source_platform,
        source_post_id,
        source_url,
        source_author_username,
        source_author_display_name,
        source_author_avatar_url,
        source_author_verified,
        post_text,
        post_media_urls,
        post_language,
        reply_to_imported_post_id,
        is_thread_root,
        source_likes_count,
        source_retweets_count,
        source_replies_count,
        source_created_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      )
    `, [
      imported_post_id,
      thread_id,
      'x',
      tweet.id,
      `https://x.com/${author.username}/status/${tweet.id}`,
      author.username,
      author.name,
      author.profile_image_url,
      author.verified || false,
      fullText,
      media_urls.length > 0 ? JSON.stringify(media_urls) : null,
      tweet.lang || 'en',
      reply_to_imported_post_id,
      is_thread_root,
      tweet.public_metrics?.like_count || 0,
      tweet.public_metrics?.retweet_count || 0,
      tweet.public_metrics?.reply_count || 0,
      mysqlDatetime
    ]);

    postIdMap[tweet.id] = imported_post_id;

    // Set root_post_id on thread
    if (is_thread_root) {
      await query(`
        UPDATE ttlive_threads
        SET root_post_id = ?
        WHERE thread_id = ?
      `, [imported_post_id, thread_id]);
    }
  }

  // Auto-create conversation index for this thread
  await query(`
    INSERT INTO ttlive_conversations (
      thread_id,
      conversation_title,
      conversation_status
    ) VALUES (?, ?, 'active')
    ON DUPLICATE KEY UPDATE conversation_title = ?
  `, [
    thread_id,
    rootFullText.substring(0, 200) + (rootFullText.length > 200 ? '...' : ''),
    rootFullText.substring(0, 200) + (rootFullText.length > 200 ? '...' : '')
  ]);

  // Auto-join the importer as first participant
  const [conversation] = await query(`
    SELECT conversation_id FROM ttlive_conversations WHERE thread_id = ?
  `, [thread_id]);

  if (conversation && imported_by) {
    await query(`
      INSERT INTO ttlive_conversation_participants (
        conversation_id,
        user_id,
        role,
        join_reason
      ) VALUES (?, ?, 'moderator', 'Thread importer')
      ON DUPLICATE KEY UPDATE last_active_at = NOW()
    `, [conversation.conversation_id, imported_by]);
  }

  return {
    thread_id,
    conversation_id: conversation?.conversation_id,
    imported_count: tweets.length,
    already_imported: false
  };
}

/**
 * Export TT post to X
 */
export async function exportPostToX({ query }, post_id, access_token) {
  // Get the post
  const [post] = await query(`
    SELECT * FROM ttlive_posts WHERE post_id = ?
  `, [post_id]);

  if (!post) {
    throw new Error('Post not found');
  }

  if (post.is_exported) {
    throw new Error('Post already exported');
  }

  // Check character limit
  if (post.post_text.length > 280) {
    throw new Error('Post exceeds 280 character limit for X');
  }

  // Determine reply-to tweet ID
  let reply_to_tweet_id = null;

  if (post.reply_to_imported_post_id) {
    // Replying to an imported X post
    const [importedPost] = await query(`
      SELECT source_post_id FROM ttlive_imported_posts
      WHERE imported_post_id = ?
    `, [post.reply_to_imported_post_id]);

    if (importedPost) {
      reply_to_tweet_id = importedPost.source_post_id;
    }
  } else if (post.reply_to_post_id) {
    // Replying to another TT post that was exported
    const [replyToPost] = await query(`
      SELECT exported_post_id FROM ttlive_posts
      WHERE post_id = ? AND is_exported = TRUE
    `, [post.reply_to_post_id]);

    if (replyToPost) {
      reply_to_tweet_id = replyToPost.exported_post_id;
    }
  }

  // Post to X API
  const X_API_BASE = 'https://api.twitter.com/2';

  const payload = {
    text: post.post_text
  };

  if (reply_to_tweet_id) {
    payload.reply = {
      in_reply_to_tweet_id: reply_to_tweet_id
    };
  }

  try {
    const response = await fetch(`${X_API_BASE}/tweets`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`X API error: ${error.detail || response.statusText}`);
    }

    const data = await response.json();
    const tweetId = data.data.id;

    // Update post with export info
    await query(`
      UPDATE ttlive_posts
      SET
        is_exported = TRUE,
        exported_to_platform = 'x',
        exported_post_id = ?,
        exported_at = NOW(),
        export_status = 'success'
      WHERE post_id = ?
    `, [tweetId, post_id]);

    // Log export
    await query(`
      INSERT INTO ttlive_export_log (
        export_log_id,
        post_id,
        exported_by,
        export_platform,
        export_status,
        platform_post_id,
        platform_post_url,
        completed_at
      ) VALUES (?, ?, ?, 'x', 'success', ?, ?, NOW())
    `, [
      uuidv4(),
      post_id,
      post.author_user_id,
      tweetId,
      `https://x.com/i/web/status/${tweetId}`
    ]);

    return {
      success: true,
      tweet_id: tweetId,
      url: `https://x.com/i/web/status/${tweetId}`
    };

  } catch (error) {
    // Log failed export
    await query(`
      INSERT INTO ttlive_export_log (
        export_log_id,
        post_id,
        exported_by,
        export_platform,
        export_status,
        error_message
      ) VALUES (?, ?, ?, 'x', 'failed', ?)
    `, [
      uuidv4(),
      post_id,
      post.author_user_id,
      error.message
    ]);

    throw error;
  }
}

/**
 * Sync engagement metrics from X
 */
export async function syncXEngagement({ query }, imported_post_id, access_token) {
  const [post] = await query(`
    SELECT source_post_id FROM ttlive_imported_posts
    WHERE imported_post_id = ?
  `, [imported_post_id]);

  if (!post) {
    throw new Error('Imported post not found');
  }

  const X_API_BASE = 'https://api.twitter.com/2';

  try {
    const response = await fetch(
      `${X_API_BASE}/tweets/${post.source_post_id}?tweet.fields=public_metrics`,
      {
        headers: {
          'Authorization': `Bearer ${access_token}`,
        }
      }
    );

    if (!response.ok) {
      throw new Error(`X API error: ${response.statusText}`);
    }

    const data = await response.json();
    const metrics = data.data.public_metrics;

    await query(`
      UPDATE ttlive_imported_posts
      SET
        source_likes_count = ?,
        source_retweets_count = ?,
        source_replies_count = ?,
        last_synced_at = NOW()
      WHERE imported_post_id = ?
    `, [
      metrics.like_count || 0,
      metrics.retweet_count || 0,
      metrics.reply_count || 0,
      imported_post_id
    ]);

    return metrics;

  } catch (error) {
    console.error('Error syncing X engagement:', error);
    throw error;
  }
}

export default {
  extractTweetIdFromUrl,
  fetchXThread,
  importXThread,
  exportPostToX,
  syncXEngagement
};
