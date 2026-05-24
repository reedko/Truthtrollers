/**
 * TruthTrollers Live Feed Service
 *
 * Core business logic for TT Live threads and posts
 */

import { v4 as uuidv4 } from 'uuid';

/**
 * Create a new TT Live thread
 */
export async function createThread({ query }, {
  thread_title = null,
  thread_type = 'native_tt',
  source_platform = 'native',
  source_thread_id = null,
  source_url = null,
  content_id = null,
  task_id = null,
  created_by = null
}) {
  const thread_id = uuidv4();

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
      curated_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    thread_id,
    thread_title,
    thread_type,
    source_platform,
    source_thread_id,
    source_url,
    content_id,
    task_id,
    created_by
  ]);

  const [thread] = await query(`
    SELECT * FROM ttlive_threads WHERE thread_id = ?
  `, [thread_id]);

  return thread;
}

/**
 * Get thread by ID with full details
 */
export async function getThread({ query }, threadId) {
  const [thread] = await query(`
    SELECT * FROM ttlive_threads WHERE thread_id = ?
  `, [threadId]);

  if (!thread) {
    return null;
  }

  // Get all imported posts to build full thread content
  const posts = await query(`
    SELECT
      post_text,
      source_author_username,
      source_author_display_name,
      source_author_avatar_url,
      source_author_verified
    FROM ttlive_imported_posts
    WHERE thread_id = ?
    ORDER BY source_created_at ASC
  `, [threadId]);

  if (posts.length > 0) {
    // Concatenate all posts into full thread text
    thread.full_content = posts.map(p => p.post_text).join('\n\n');
    thread.post_count = posts.length;

    // Add root author info (from first post)
    const rootPost = posts[0];
    thread.author = {
      username: rootPost.source_author_username,
      display_name: rootPost.source_author_display_name,
      avatar_url: rootPost.source_author_avatar_url,
      verified: rootPost.source_author_verified
    };
  } else {
    thread.full_content = '';
    thread.post_count = 0;
    thread.author = null;
  }

  // Get claim pairs data (similar to extension popup)
  if (thread.content_id) {
    console.log(`🔍 Fetching claim pairs for content_id ${thread.content_id}`);

    // Get user score from content_scores
    const [userScoreData] = await query(`
      SELECT verimeter_score FROM content_scores WHERE content_id = ?
    `, [thread.content_id]);

    const userScore = userScoreData?.verimeter_score || null;

    // Calculate AI score from all AI-suggested links (same logic as /api/content/:id/scores/ai)
    const aiLinks = await query(`
      SELECT rctl.support_level, rctl.confidence
      FROM reference_claim_task_links rctl
      JOIN content_claims cc ON rctl.task_claim_id = cc.claim_id
      WHERE cc.content_id = ? AND rctl.created_by_ai = 1
    `, [thread.content_id]);

    let aiScore = null;
    if (aiLinks.length > 0) {
      // Weighted average: sum(support_level * confidence) / sum(confidence)
      const totalWeighted = aiLinks.reduce((sum, link) =>
        sum + (link.support_level * link.confidence), 0);
      const totalConfidence = aiLinks.reduce((sum, link) =>
        sum + link.confidence, 0);

      if (totalConfidence > 0) {
        aiScore = totalWeighted / totalConfidence;
      }
    }

    // Use user score if available, otherwise fall back to AI score
    thread.verimeter_score = (userScore !== null && userScore !== 0) ? userScore : aiScore;
    thread.ai_verimeter_score = aiScore;
    thread.user_verimeter_score = userScore;
    thread.is_ai_rating = (userScore === null || userScore === 0) && aiScore !== null;

    console.log(`📊 Verimeter scores - User: ${userScore}, AI: ${aiScore}, Using: ${thread.verimeter_score}, Is AI: ${thread.is_ai_rating}`);

    // Get task claims (case claims)
    const taskClaims = await query(`
      SELECT c.claim_id, c.claim_text, content.media_source, content.url
      FROM claims c
      JOIN content_claims cc ON c.claim_id = cc.claim_id
      JOIN content ON cc.content_id = content.content_id
      WHERE cc.content_id = ?
      AND cc.relationship_type = 'task'
      ORDER BY cc.created_at ASC
      LIMIT 5
    `, [thread.content_id]);

    console.log(`📋 Found ${taskClaims.length} task claims`);

    // Build claim_pairs array (like extension)
    const claimPairs = [];
    for (const taskClaim of taskClaims) {
      // Get top AI-suggested source claim
      const [topSource] = await query(`
        SELECT
          rctl.reference_claim_id,
          rc.claim_text AS source_claim_text,
          rctl.stance,
          rctl.score,
          rctl.confidence,
          rctl.support_level,
          rctl.rationale,
          sourceContent.media_source AS source_media_source,
          sourceContent.url AS source_url
        FROM reference_claim_task_links rctl
        JOIN claims rc ON rctl.reference_claim_id = rc.claim_id
        JOIN content_claims sourceCC ON rc.claim_id = sourceCC.claim_id
        JOIN content sourceContent ON sourceCC.content_id = sourceContent.content_id
        WHERE rctl.task_claim_id = ?
        ORDER BY ABS(rctl.support_level * rctl.confidence) DESC
        LIMIT 1
      `, [taskClaim.claim_id]);

      if (topSource) {
        claimPairs.push({
          caseClaim: {
            claim_id: taskClaim.claim_id,
            claim_text: taskClaim.claim_text,
            publisher: taskClaim.media_source || 'Unknown',
            url: taskClaim.url || ''
          },
          sourceClaim: {
            claim_id: topSource.reference_claim_id,
            claim_text: topSource.source_claim_text,
            publisher: topSource.source_media_source || 'Unknown',
            url: topSource.source_url || '',
            relationship: topSource.stance || 'neutral'
          },
          verimeter_score: topSource.support_level || 0,
          support_level: topSource.support_level || 0,
          confidence: topSource.confidence || 0,
          rationale: topSource.rationale || ''
        });
      }
    }

    thread.claim_pairs = {
      overall_verimeter: thread.verimeter_score || 0,
      is_ai_rating: thread.is_ai_rating || false,
      claim_pairs: claimPairs
    };

    // Keep legacy top_claims for backwards compatibility
    thread.top_claims = taskClaims.map(tc => ({
      claim_id: tc.claim_id,
      claim_text: tc.claim_text,
      link_count: 0
    }));
  } else {
    console.log(`⚠️  No content_id for thread ${threadId}, skipping claims`);
    thread.claim_pairs = {
      overall_verimeter: 0,
      claim_pairs: []
    };
    thread.top_claims = [];
    thread.verimeter_score = null;
  }

  return thread;
}

/**
 * Get thread timeline (combined imported + TT posts)
 */
export async function getThreadTimeline({ query }, threadId, {
  limit = 50,
  offset = 0,
  order = 'ASC' // ASC = chronological, DESC = reverse chronological
}) {
  const posts = await query(`
    SELECT * FROM v_ttlive_thread_timeline
    WHERE thread_id = ?
    ORDER BY created_at ${order}
    LIMIT ? OFFSET ?
  `, [threadId, limit, offset]);

  return posts;
}

/**
 * Create a native TT post
 */
export async function createTTPost({ query }, {
  thread_id,
  author_user_id,
  author_role = 'contributor',
  post_text,
  post_media_urls = null,
  post_language = 'en',
  stance = 'neutral',
  confidence_level = null,
  tone = 'neutral',
  reply_to_post_id = null,
  reply_to_imported_post_id = null,
  context_claim_id = null,
  evidence_links = []
}) {
  const post_id = uuidv4();

  // Convert media URLs array to JSON
  const media_json = post_media_urls ? JSON.stringify(post_media_urls) : null;

  await query(`
    INSERT INTO ttlive_posts (
      post_id,
      thread_id,
      author_user_id,
      author_role,
      post_text,
      post_media_urls,
      post_language,
      stance,
      confidence_level,
      tone,
      reply_to_post_id,
      reply_to_imported_post_id,
      context_claim_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    post_id,
    thread_id,
    author_user_id,
    author_role,
    post_text,
    media_json,
    post_language,
    stance,
    confidence_level,
    tone,
    reply_to_post_id,
    reply_to_imported_post_id,
    context_claim_id
  ]);

  // Add evidence links if provided
  if (evidence_links && evidence_links.length > 0) {
    for (const evidence of evidence_links) {
      await addPostEvidence({ query }, post_id, author_user_id, evidence);
    }
  }

  // Fetch and return complete post
  const [post] = await query(`
    SELECT * FROM ttlive_posts WHERE post_id = ?
  `, [post_id]);

  return post;
}

/**
 * Add evidence to a TT post
 */
export async function addPostEvidence({ query }, post_id, added_by, {
  evidence_type,
  reference_id = null,
  claim_id = null,
  content_id = null,
  external_url = null,
  support_level = null,
  relevance_score = null,
  quote_text = null
}) {
  const evidence_link_id = uuidv4();

  await query(`
    INSERT INTO ttlive_post_evidence (
      evidence_link_id,
      post_id,
      evidence_type,
      reference_id,
      claim_id,
      content_id,
      external_url,
      support_level,
      relevance_score,
      quote_text,
      added_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    evidence_link_id,
    post_id,
    evidence_type,
    reference_id,
    claim_id,
    content_id,
    external_url,
    support_level,
    relevance_score,
    quote_text,
    added_by
  ]);

  return evidence_link_id;
}

/**
 * Get evidence for a post
 */
export async function getPostEvidence({ query }, post_id) {
  const evidence = await query(`
    SELECT * FROM ttlive_post_evidence WHERE post_id = ?
  `, [post_id]);

  return evidence;
}

/**
 * Update TT post
 */
export async function updateTTPost({ query }, post_id, updates) {
  const allowedFields = [
    'post_text',
    'stance',
    'confidence_level',
    'tone',
    'is_approved',
    'is_flagged',
    'is_hidden',
    'moderated_by',
    'moderation_reason'
  ];

  const fields = [];
  const values = [];

  Object.keys(updates).forEach(key => {
    if (allowedFields.includes(key)) {
      fields.push(`${key} = ?`);
      values.push(updates[key]);
    }
  });

  if (fields.length === 0) {
    throw new Error('No valid fields to update');
  }

  // Add edited_at timestamp
  fields.push('edited_at = NOW()');

  values.push(post_id);

  await query(`
    UPDATE ttlive_posts
    SET ${fields.join(', ')}
    WHERE post_id = ?
  `, values);

  const [post] = await query(`
    SELECT * FROM ttlive_posts WHERE post_id = ?
  `, [post_id]);

  return post;
}

/**
 * Delete TT post (soft delete by hiding)
 */
export async function deleteTTPost({ query }, post_id, moderated_by = null) {
  await query(`
    UPDATE ttlive_posts
    SET is_hidden = TRUE, moderated_by = ?
    WHERE post_id = ?
  `, [moderated_by, post_id]);

  return true;
}

/**
 * Get user's threads
 */
export async function getUserThreads({ query }, user_id, {
  limit = 20,
  offset = 0,
  include_subscribed = true
}) {
  let whereClause = '';
  const params = [];

  if (include_subscribed) {
    // Get threads user participates in OR is subscribed to
    whereClause = `
      WHERE EXISTS (
        SELECT 1 FROM ttlive_posts
        WHERE ttlive_posts.thread_id = t.thread_id
          AND ttlive_posts.author_user_id = ?
      ) OR EXISTS (
        SELECT 1 FROM ttlive_thread_subscriptions
        WHERE ttlive_thread_subscriptions.thread_id = t.thread_id
          AND ttlive_thread_subscriptions.user_id = ?
      )
    `;
    params.push(user_id, user_id);
  } else {
    // Only threads user has posted in
    whereClause = `
      WHERE EXISTS (
        SELECT 1 FROM ttlive_posts
        WHERE ttlive_posts.thread_id = t.thread_id
          AND ttlive_posts.author_user_id = ?
      )
    `;
    params.push(user_id);
  }

  params.push(limit, offset);

  const threads = await query(`
    SELECT t.*
    FROM ttlive_threads t
    ${whereClause}
    ORDER BY t.last_activity_at DESC
    LIMIT ? OFFSET ?
  `, params);

  return threads;
}

/**
 * Subscribe to thread
 */
export async function subscribeToThread({ query }, thread_id, user_id, {
  notification_level = 'all',
  is_monitoring = false
}) {
  const subscription_id = uuidv4();

  await query(`
    INSERT INTO ttlive_thread_subscriptions (
      subscription_id,
      thread_id,
      user_id,
      notification_level,
      is_monitoring
    ) VALUES (?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      notification_level = VALUES(notification_level),
      is_monitoring = VALUES(is_monitoring)
  `, [subscription_id, thread_id, user_id, notification_level, is_monitoring]);

  return subscription_id;
}

/**
 * Unsubscribe from thread
 */
export async function unsubscribeFromThread({ query }, thread_id, user_id) {
  await query(`
    DELETE FROM ttlive_thread_subscriptions
    WHERE thread_id = ? AND user_id = ?
  `, [thread_id, user_id]);

  return true;
}

/**
 * Get user's subscription to thread
 */
export async function getThreadSubscription({ query }, thread_id, user_id) {
  const [subscription] = await query(`
    SELECT * FROM ttlive_thread_subscriptions
    WHERE thread_id = ? AND user_id = ?
  `, [thread_id, user_id]);

  return subscription || null;
}

/**
 * Update thread properties
 */
export async function updateThread({ query }, thread_id, updates) {
  const allowedFields = [
    'thread_title',
    'is_pinned',
    'is_archived',
    'is_locked',
    'curated_by',
    'curation_notes'
  ];

  const fields = [];
  const values = [];

  Object.keys(updates).forEach(key => {
    if (allowedFields.includes(key)) {
      fields.push(`${key} = ?`);
      values.push(updates[key]);
    }
  });

  if (fields.length === 0) {
    throw new Error('No valid fields to update');
  }

  // Add curated_at timestamp if curated_by is being set
  if (updates.curated_by) {
    fields.push('curated_at = NOW()');
  }

  values.push(thread_id);

  await query(`
    UPDATE ttlive_threads
    SET ${fields.join(', ')}
    WHERE thread_id = ?
  `, values);

  const [thread] = await query(`
    SELECT * FROM ttlive_threads WHERE thread_id = ?
  `, [thread_id]);

  return thread;
}

/**
 * Get all threads (for discovery/browse)
 */
export async function getAllThreads({ query }, {
  limit = 20,
  offset = 0,
  thread_type = null,
  source_platform = null,
  is_pinned = null,
  order_by = 'last_activity_at'
}) {
  const conditions = [];
  const params = [];

  if (thread_type) {
    conditions.push('thread_type = ?');
    params.push(thread_type);
  }

  if (source_platform) {
    conditions.push('source_platform = ?');
    params.push(source_platform);
  }

  if (is_pinned !== null) {
    conditions.push('is_pinned = ?');
    params.push(is_pinned);
  }

  // Always exclude archived threads from browse
  conditions.push('is_archived = FALSE');

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  params.push(limit, offset);

  const threads = await query(`
    SELECT * FROM ttlive_threads
    ${whereClause}
    ORDER BY ${order_by} DESC
    LIMIT ? OFFSET ?
  `, params);

  return threads;
}

/**
 * Toggle post vote (upvote/downvote)
 */
export async function voteOnPost({ query }, post_id, user_id, vote_type) {
  // For now, just increment counters
  // In production, you'd want a user_post_votes table to track individual votes
  const field = vote_type === 'upvote' ? 'upvotes_count' : 'downvotes_count';

  await query(`
    UPDATE ttlive_posts
    SET ${field} = ${field} + 1
    WHERE post_id = ?
  `, [post_id]);

  return true;
}

/**
 * Search threads by keyword
 */
export async function searchThreads({ query }, searchTerm, {
  limit = 20,
  offset = 0
}) {
  const threads = await query(`
    SELECT DISTINCT t.*
    FROM ttlive_threads t
    LEFT JOIN ttlive_posts p ON p.thread_id = t.thread_id
    LEFT JOIN ttlive_imported_posts ip ON ip.thread_id = t.thread_id
    WHERE t.is_archived = FALSE
      AND (
        t.thread_title LIKE ?
        OR p.post_text LIKE ?
        OR ip.post_text LIKE ?
      )
    ORDER BY t.last_activity_at DESC
    LIMIT ? OFFSET ?
  `, [
    `%${searchTerm}%`,
    `%${searchTerm}%`,
    `%${searchTerm}%`,
    limit,
    offset
  ]);

  return threads;
}

export default {
  createThread,
  getThread,
  getThreadTimeline,
  createTTPost,
  addPostEvidence,
  getPostEvidence,
  updateTTPost,
  deleteTTPost,
  getUserThreads,
  subscribeToThread,
  unsubscribeFromThread,
  getThreadSubscription,
  updateThread,
  getAllThreads,
  voteOnPost,
  searchThreads
};
