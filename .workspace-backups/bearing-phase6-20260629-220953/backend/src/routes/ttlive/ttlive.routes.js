/**
 * TruthTrollers Live Feed API Routes
 */

import { Router } from 'express';
import { authenticateToken } from '../../middleware/auth.js';
import ttLiveService from '../../services/ttLiveService.js';
import xTwitterAdapter from '../../services/platforms/xTwitterAdapter.js';

// Server-side feed cache: userId → { data, cachedAt }
// Avoids hitting the X API on every tab switch / auto-refresh
const feedCache = new Map();
const FEED_CACHE_TTL_MS = 60_000; // 60 seconds

function getCachedFeed(userId) {
  const entry = feedCache.get(userId);
  if (!entry) return null;
  if (Date.now() - entry.cachedAt > FEED_CACHE_TTL_MS) {
    feedCache.delete(userId);
    return null;
  }
  return entry.data;
}

function setCachedFeed(userId, data) {
  feedCache.set(userId, { data, cachedAt: Date.now() });
}

export default function createTTLiveRouter({ query, pool }) {
  const router = Router();

  // =====================================================
  // Thread Routes
  // =====================================================

  /**
   * GET /api/ttlive/threads
   * Get all threads (discovery/browse)
   */
  router.get('/threads', async (req, res) => {
    try {
      const {
        limit = 20,
        offset = 0,
        thread_type,
        source_platform,
        is_pinned,
        order_by = 'last_activity_at'
      } = req.query;

      const threads = await ttLiveService.getAllThreads({ query }, {
        limit: parseInt(limit),
        offset: parseInt(offset),
        thread_type,
        source_platform,
        is_pinned: is_pinned ? is_pinned === 'true' : null,
        order_by
      });

      res.json({
        threads,
        total: threads.length,
        has_more: threads.length === parseInt(limit)
      });
    } catch (error) {
      console.error('Error fetching threads:', error);
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * GET /api/ttlive/threads/user
   * Get user's threads (participated or subscribed)
   */
  router.get('/threads/user', async (req, res) => {
    try {
      const user_id = req.user?.user_id;
      if (!user_id) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const { limit = 20, offset = 0, include_subscribed = 'true' } = req.query;

      const threads = await ttLiveService.getUserThreads({ query }, user_id, {
        limit: parseInt(limit),
        offset: parseInt(offset),
        include_subscribed: include_subscribed === 'true'
      });

      res.json({
        threads,
        total: threads.length,
        has_more: threads.length === parseInt(limit)
      });
    } catch (error) {
      console.error('Error fetching user threads:', error);
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * GET /api/ttlive/threads/search
   * Search threads by keyword
   */
  router.get('/threads/search', async (req, res) => {
    try {
      const { q, limit = 20, offset = 0 } = req.query;

      if (!q) {
        return res.status(400).json({ error: 'Search query required' });
      }

      const threads = await ttLiveService.searchThreads({ query }, q, {
        limit: parseInt(limit),
        offset: parseInt(offset)
      });

      res.json({
        threads,
        query: q,
        total: threads.length
      });
    } catch (error) {
      console.error('Error searching threads:', error);
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * POST /api/ttlive/threads
   * Create a new native TT thread
   */
  router.post('/threads', async (req, res) => {
    try {
      const user_id = req.user?.user_id;
      if (!user_id) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const {
        thread_title,
        thread_type = 'native_tt',
        source_platform = 'native',
        source_url,
        content_id,
        task_id
      } = req.body;

      const thread = await ttLiveService.createThread({ query }, {
        thread_title,
        thread_type,
        source_platform,
        source_url,
        content_id,
        task_id,
        created_by: user_id
      });

      // Auto-subscribe creator to thread
      await ttLiveService.subscribeToThread({ query }, thread.thread_id, user_id, {
        notification_level: 'all',
        is_monitoring: true
      });

      res.status(201).json({ thread });
    } catch (error) {
      console.error('Error creating thread:', error);
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * GET /api/ttlive/threads/:threadId
   * Get thread details
   */
  router.get('/threads/:threadId', async (req, res) => {
    try {
      const { threadId } = req.params;

      const thread = await ttLiveService.getThread({ query }, threadId);

      if (!thread) {
        return res.status(404).json({ error: 'Thread not found' });
      }

      res.json({ thread });
    } catch (error) {
      console.error('Error fetching thread:', error);
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * PATCH /api/ttlive/threads/:threadId
   * Update thread properties (pin, archive, lock, etc.)
   */
  router.patch('/threads/:threadId', async (req, res) => {
    try {
      const user_id = req.user?.user_id;
      if (!user_id) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const { threadId } = req.params;
      const updates = req.body;

      const thread = await ttLiveService.updateThread({ query }, threadId, updates);

      res.json({ thread });
    } catch (error) {
      console.error('Error updating thread:', error);
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * GET /api/ttlive/threads/:threadId/timeline
   * Get thread timeline (combined imported + TT posts)
   */
  router.get('/threads/:threadId/timeline', async (req, res) => {
    try {
      const { threadId } = req.params;
      const { limit = 50, offset = 0, order = 'ASC' } = req.query;

      const posts = await ttLiveService.getThreadTimeline({ query }, threadId, {
        limit: parseInt(limit),
        offset: parseInt(offset),
        order
      });

      res.json({
        posts,
        total: posts.length,
        has_more: posts.length === parseInt(limit)
      });
    } catch (error) {
      console.error('Error fetching timeline:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // =====================================================
  // Post Routes
  // =====================================================

  /**
   * POST /api/ttlive/posts
   * Create a new TT post
   */
  router.post('/posts', async (req, res) => {
    try {
      const user_id = req.user?.user_id;
      if (!user_id) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const {
        thread_id,
        post_text,
        post_media_urls = null,
        stance = 'neutral',
        confidence_level = null,
        tone = 'neutral',
        reply_to_post_id = null,
        reply_to_imported_post_id = null,
        context_claim_id = null,
        evidence_links = []
      } = req.body;

      if (!thread_id || !post_text) {
        return res.status(400).json({ error: 'thread_id and post_text required' });
      }

      // Get user role (for author_role)
      const [user] = await query(`
        SELECT role FROM users WHERE user_id = ?
      `, [user_id]);

      const author_role = user?.role || 'contributor';

      const post = await ttLiveService.createTTPost({ query }, {
        thread_id,
        author_user_id: user_id,
        author_role,
        post_text,
        post_media_urls,
        stance,
        confidence_level,
        tone,
        reply_to_post_id,
        reply_to_imported_post_id,
        context_claim_id,
        evidence_links
      });

      res.status(201).json({ post });
    } catch (error) {
      console.error('Error creating post:', error);
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * PATCH /api/ttlive/posts/:postId
   * Update a TT post
   */
  router.patch('/posts/:postId', async (req, res) => {
    try {
      const user_id = req.user?.user_id;
      if (!user_id) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const { postId } = req.params;
      const updates = req.body;

      // Verify ownership or moderator
      const [existingPost] = await query(`
        SELECT author_user_id FROM ttlive_posts WHERE post_id = ?
      `, [postId]);

      if (!existingPost) {
        return res.status(404).json({ error: 'Post not found' });
      }

      const [user] = await query(`
        SELECT role FROM users WHERE user_id = ?
      `, [user_id]);

      const isModerator = ['moderator', 'admin'].includes(user?.role);
      const isOwner = existingPost.author_user_id === user_id;

      if (!isOwner && !isModerator) {
        return res.status(403).json({ error: 'Not authorized to edit this post' });
      }

      const post = await ttLiveService.updateTTPost({ query }, postId, updates);

      res.json({ post });
    } catch (error) {
      console.error('Error updating post:', error);
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * DELETE /api/ttlive/posts/:postId
   * Delete (hide) a TT post
   */
  router.delete('/posts/:postId', async (req, res) => {
    try {
      const user_id = req.user?.user_id;
      if (!user_id) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const { postId } = req.params;

      // Verify ownership or moderator
      const [existingPost] = await query(`
        SELECT author_user_id FROM ttlive_posts WHERE post_id = ?
      `, [postId]);

      if (!existingPost) {
        return res.status(404).json({ error: 'Post not found' });
      }

      const [user] = await query(`
        SELECT role FROM users WHERE user_id = ?
      `, [user_id]);

      const isModerator = ['moderator', 'admin'].includes(user?.role);
      const isOwner = existingPost.author_user_id === user_id;

      if (!isOwner && !isModerator) {
        return res.status(403).json({ error: 'Not authorized to delete this post' });
      }

      await ttLiveService.deleteTTPost({ query }, postId, user_id);

      res.json({ success: true });
    } catch (error) {
      console.error('Error deleting post:', error);
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * POST /api/ttlive/posts/:postId/vote
   * Vote on a post (upvote/downvote)
   */
  router.post('/posts/:postId/vote', async (req, res) => {
    try {
      const user_id = req.user?.user_id;
      if (!user_id) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const { postId } = req.params;
      const { vote_type } = req.body; // 'upvote' or 'downvote'

      if (!['upvote', 'downvote'].includes(vote_type)) {
        return res.status(400).json({ error: 'vote_type must be upvote or downvote' });
      }

      await ttLiveService.voteOnPost({ query }, postId, user_id, vote_type);

      res.json({ success: true });
    } catch (error) {
      console.error('Error voting on post:', error);
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * GET /api/ttlive/posts/:postId/evidence
   * Get evidence for a post
   */
  router.get('/posts/:postId/evidence', async (req, res) => {
    try {
      const { postId } = req.params;

      const evidence = await ttLiveService.getPostEvidence({ query }, postId);

      res.json({ evidence });
    } catch (error) {
      console.error('Error fetching post evidence:', error);
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * POST /api/ttlive/posts/:postId/evidence
   * Add evidence to a post
   */
  router.post('/posts/:postId/evidence', async (req, res) => {
    try {
      const user_id = req.user?.user_id;
      if (!user_id) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const { postId } = req.params;
      const evidenceData = req.body;

      const evidence_link_id = await ttLiveService.addPostEvidence(
        { query },
        postId,
        user_id,
        evidenceData
      );

      res.status(201).json({ evidence_link_id });
    } catch (error) {
      console.error('Error adding evidence:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // =====================================================
  // Import/Export Routes
  // =====================================================

  /**
   * POST /api/ttlive/import/x
   * Import an X/Twitter thread
   */
  router.post('/import/x', authenticateToken, async (req, res) => {
    console.log('🔵 POST /api/ttlive/import/x - Starting import...');
    try {
      const user_id = req.user?.user_id;
      if (!user_id) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const { x_thread_url, task_id, content_id } = req.body;

      if (!x_thread_url) {
        return res.status(400).json({ error: 'x_thread_url required' });
      }

      // Get user's X auth token
      const [xAuth] = await query(`
        SELECT access_token FROM x_auth_tokens
        WHERE user_id = ? AND is_valid = TRUE
      `, [user_id]);

      if (!xAuth) {
        return res.status(401).json({ error: 'X account not connected' });
      }

      const result = await xTwitterAdapter.importXThread({ query }, {
        x_thread_url,
        access_token: xAuth.access_token,
        task_id,
        content_id,
        imported_by: user_id
      });

      console.log('🔵 Import result:', JSON.stringify(result, null, 2));

      // Process thread content (raw_text mode - same as scrape-task)
      // Always check if we need to process, even if thread already existed
      if (result.thread_id) {
        console.log(`📋 Checking if thread ${result.thread_id} needs content processing...`);

        try {
          // Get thread metadata
          const [thread] = await query(`
            SELECT source_url, thread_title, content_id FROM ttlive_threads WHERE thread_id = ?
          `, [result.thread_id]);

          // Check if this thread already has a content_id
          if (thread.content_id) {
            console.log(`⏭️  Thread already processed as content_id ${thread.content_id}`);
            result.content_id = thread.content_id;
          } else {
            console.log(`🆕 Thread has no content_id, processing now...`);
            // Get all posts to build thread text
            const posts = await query(`
              SELECT
                post_text,
                source_author_username,
                source_author_display_name,
                source_author_avatar_url
              FROM ttlive_imported_posts
              WHERE thread_id = ?
              ORDER BY source_created_at ASC
            `, [result.thread_id]);

            const text = posts.map(p => p.post_text).join('\n\n');
            const rootPost = posts[0];

            console.log(`📄 Processing ${posts.length} tweets as content (${text.length} chars)`);

            // Import scrape-task functions
            const { createContentInternal } = await import('../../storage/createContentInternal.js');
            const { persistAuthors } = await import('../../storage/persistAuthors.js');
            const { processTaskClaims } = await import('../../core/processTaskClaims.js');
            const { runEvidenceEngine } = await import('../../core/runEvidenceEngine.js');
            const { persistAIResults } = await import('../../storage/persistAIResults.js');
            const { matchClaimsToTaskClaims } = await import('../../core/matchClaims.js');
            const { openAiLLM } = await import('../../core/openAiLLM.js');

            // 1. Create task content row (same as raw_text mode)
            const taskContentId = await createContentInternal(query, {
              content_name: thread.thread_title,
              url: thread.source_url,
              media_source: 'twitter',
              topic: 'general',
              subtopics: [],
              content_type: 'task',
              thumbnail: rootPost.source_author_avatar_url || null,
              details: text.slice(0, 500),
            });

            console.log(`✅ Created content_id ${taskContentId}`);

            // 2. Persist authors
            if (rootPost.source_author_username) {
              await persistAuthors(query, taskContentId, [{
                author_name: rootPost.source_author_display_name || rootPost.source_author_username,
                author_handle: rootPost.source_author_username
              }]);
            }

            // 3. Extract & store TASK claims → claimIds (same as scrape-task)
            console.log(`🔍 Extracting claims...`);
            const taskClaims = await processTaskClaims({
              query,
              taskContentId,
              text,
            });

            const claimIds = taskClaims.map((c) => c.id);
            console.log(`📋 Extracted ${claimIds.length} claims`);

            // 4. Run Evidence Engine (same as scrape-task)
            const { aiReferences, claimConfidenceMap } = await runEvidenceEngine({
              taskContentId,
              claimIds,
              claims: taskClaims,
              readableText: text,
            });

            console.log(`🔗 Found ${aiReferences.length} AI references`);

            // 5. Persist AI results (same as scrape-task)
            await persistAIResults(query, {
              contentId: taskContentId,
              evidenceRefs: aiReferences,
              claimIds,
              claimConfidenceMap,
            });

            // 6. Match reference claims to task claims (same as scrape-task)
            console.log(`🔗 Matching source claims to task claims...`);
            let totalClaimLinks = 0;

            for (const ref of aiReferences) {
              if (!ref.referenceContentId) continue;

              try {
                // Extract claims from this reference (only if we have cleanText)
                if (!ref.cleanText || ref.cleanText.length < 100) {
                  console.log(`   ⚠️  Skipping reference ${ref.referenceContentId} - no cleanText (${ref.cleanText?.length || 0} chars)`);
                  continue;
                }

                console.log(`   📄 Extracting claims from reference ${ref.referenceContentId} (${ref.cleanText.length} chars)...`);

                const extractedClaims = await processTaskClaims({
                  query,
                  taskContentId: ref.referenceContentId,
                  text: ref.cleanText,
                  claimType: "reference",
                  taskClaimsContext: taskClaims.map((c) => c.text),
                });

                if (extractedClaims.length === 0) {
                  console.log(`   ⚠️  No claims extracted from reference ${ref.referenceContentId}`);
                  console.log(`      URL: ${ref.url}`);
                  console.log(`      Text length: ${ref.cleanText.length} chars`);
                  continue;
                }

                console.log(`   ✅ Extracted ${extractedClaims.length} claims from reference ${ref.referenceContentId}`);

                if (extractedClaims.length > 0) {
                  // Match reference claims to task claims
                  const taskClaimsForMatching = taskClaims.map(tc => ({
                    id: tc.id,
                    text: tc.text
                  }));

                  const claimMatches = await matchClaimsToTaskClaims({
                    referenceClaims: extractedClaims,
                    taskClaims: taskClaimsForMatching,
                    llm: openAiLLM
                  });

                  // Insert reference_claim_task_links (same table as scrape-task uses)
                  if (claimMatches.length > 0) {
                    const values = claimMatches.map(match => {
                      // Map stance values
                      let mappedStance = match.stance;
                      if (match.stance === 'supports') mappedStance = 'support';
                      else if (match.stance === 'refutes') mappedStance = 'refute';
                      else if (match.stance === 'related') mappedStance = 'nuance';

                      return [
                        match.referenceClaimId,
                        match.taskClaimId,
                        mappedStance,
                        Math.round((match.veracityScore || 0.5) * 100), // score: 0-100
                        match.confidence, // 0.15-0.98
                        match.supportLevel, // -1.2 to +1.2
                        match.rationale,
                        null, // quote
                        1 // created_by_ai
                      ];
                    });

                    // Batch insert
                    const placeholders = values.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ');
                    const flatValues = values.flat();

                    await query(
                      `INSERT INTO reference_claim_task_links
                       (reference_claim_id, task_claim_id, stance, score, confidence, support_level, rationale, quote, created_by_ai)
                       VALUES ${placeholders}`,
                      flatValues
                    );
                    totalClaimLinks += claimMatches.length;
                    console.log(`   ✅ Created ${claimMatches.length} claim links for reference ${ref.referenceContentId}`);
                  }
                }
              } catch (err) {
                console.error(`   ⚠️  Error matching claims for reference ${ref.referenceContentId}:`, err.message);
              }
            }

            console.log(`🔗 Created ${totalClaimLinks} total claim links (source claims → task claims)`);

            // Update thread with content_id
            await query(`
              UPDATE ttlive_threads SET content_id = ? WHERE thread_id = ?
            `, [taskContentId, result.thread_id]);

            result.content_id = taskContentId;
            result.claims_extracted = claimIds.length;
            result.references_found = aiReferences.length;
            result.claim_links_created = totalClaimLinks;

            console.log(`✅ Thread processed: content_id=${taskContentId}, claims=${claimIds.length}, refs=${aiReferences.length}, links=${totalClaimLinks}`);
          }

        } catch (error) {
          console.error('❌ Error processing thread content:', error);
          result.content_processing_error = error.message;
        }
      }

      res.status(201).json(result);
    } catch (error) {
      console.error('Error importing X thread:', error);
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * POST /api/ttlive/export/x
   * Export a TT post to X/Twitter
   */
  router.post('/export/x', async (req, res) => {
    try {
      const user_id = req.user?.user_id;
      if (!user_id) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const { post_id } = req.body;

      if (!post_id) {
        return res.status(400).json({ error: 'post_id required' });
      }

      // Verify post ownership
      const [post] = await query(`
        SELECT author_user_id FROM ttlive_posts WHERE post_id = ?
      `, [post_id]);

      if (!post || post.author_user_id !== user_id) {
        return res.status(403).json({ error: 'Not authorized to export this post' });
      }

      // Get user's X auth token
      const [xAuth] = await query(`
        SELECT access_token FROM x_auth_tokens
        WHERE user_id = ? AND is_valid = TRUE
      `, [user_id]);

      if (!xAuth) {
        return res.status(401).json({ error: 'X account not connected' });
      }

      const result = await xTwitterAdapter.exportPostToX(
        { query },
        post_id,
        xAuth.access_token
      );

      res.json(result);
    } catch (error) {
      console.error('Error exporting to X:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // =====================================================
  // Subscription Routes
  // =====================================================

  /**
   * POST /api/ttlive/threads/:threadId/subscribe
   * Subscribe to a thread
   */
  router.post('/threads/:threadId/subscribe', async (req, res) => {
    try {
      const user_id = req.user?.user_id;
      if (!user_id) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const { threadId } = req.params;
      const { notification_level = 'all', is_monitoring = false } = req.body;

      const subscription_id = await ttLiveService.subscribeToThread(
        { query },
        threadId,
        user_id,
        { notification_level, is_monitoring }
      );

      res.status(201).json({ subscription_id });
    } catch (error) {
      console.error('Error subscribing to thread:', error);
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * DELETE /api/ttlive/threads/:threadId/subscribe
   * Unsubscribe from a thread
   */
  router.delete('/threads/:threadId/subscribe', async (req, res) => {
    try {
      const user_id = req.user?.user_id;
      if (!user_id) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const { threadId } = req.params;

      await ttLiveService.unsubscribeFromThread({ query }, threadId, user_id);

      res.json({ success: true });
    } catch (error) {
      console.error('Error unsubscribing from thread:', error);
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * GET /api/ttlive/threads/:threadId/subscription
   * Get user's subscription status for thread
   */
  router.get('/threads/:threadId/subscription', async (req, res) => {
    try {
      const user_id = req.user?.user_id;
      if (!user_id) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const { threadId } = req.params;

      const subscription = await ttLiveService.getThreadSubscription(
        { query },
        threadId,
        user_id
      );

      res.json({ subscription });
    } catch (error) {
      console.error('Error fetching subscription:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // =====================================================
  // Thread Evidence Scraping
  // =====================================================

  /**
   * POST /api/ttlive/threads/:threadId/scrape-evidence
   * Scrape all imported posts in a thread as task content
   */
  router.post('/threads/:threadId/scrape-evidence', authenticateToken, async (req, res) => {
    try {
      const user_id = req.user?.user_id;
      if (!user_id) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const { threadId } = req.params;

      // Get all imported posts for this thread
      const importedPosts = await query(`
        SELECT
          imported_post_id,
          source_url,
          post_text,
          source_author_username,
          source_author_display_name,
          source_platform
        FROM ttlive_imported_posts
        WHERE thread_id = ?
        ORDER BY created_at ASC
      `, [threadId]);

      if (importedPosts.length === 0) {
        return res.json({
          success: true,
          message: 'No imported posts to scrape',
          scraped: 0,
          skipped: 0,
          errors: 0,
          results: []
        });
      }

      // Import the createContentInternal function
      const { createContentInternal } = await import('../../storage/createContentInternal.js');

      const results = [];
      let scraped = 0;
      let skipped = 0;
      let errors = 0;

      // Process each imported post
      for (const post of importedPosts) {
        try {
          // Check if URL already exists
          const existing = await query(
            'SELECT content_id, content_name FROM content WHERE url = ? LIMIT 1',
            [post.source_url]
          );

          if (existing.length > 0) {
            skipped++;
            results.push({
              imported_post_id: post.imported_post_id,
              url: post.source_url,
              status: 'skipped',
              reason: 'already_exists',
              existing_content_id: existing[0].content_id
            });
            continue;
          }

          // Create content entry using the same function as the extension scraper
          const payload = {
            url: post.source_url,
            content_name: post.post_text?.substring(0, 100) || 'Imported post',
            media_source: post.source_platform || 'twitter',
            content_type: 'task',
            authors: post.source_author_username ? [{
              author_name: post.source_author_display_name || post.source_author_username,
              author_handle: post.source_author_username
            }] : []
          };

          const result = await createContentInternal(query, payload);

          scraped++;
          results.push({
            imported_post_id: post.imported_post_id,
            url: post.source_url,
            status: 'success',
            content_id: result.contentId
          });

        } catch (error) {
          errors++;
          results.push({
            imported_post_id: post.imported_post_id,
            url: post.source_url,
            status: 'error',
            error: error.message
          });
        }
      }

      res.json({
        success: true,
        thread_id: threadId,
        total_posts: importedPosts.length,
        scraped,
        skipped,
        errors,
        results
      });

    } catch (error) {
      console.error('Error scraping thread evidence:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // =====================================================
  // Feed Routes (Viewing-First Architecture)
  // =====================================================

  /**
   * GET /api/ttlive/feed
   * Get user's X/Twitter home timeline with TT overlay
   */
  router.get('/feed', authenticateToken, async (req, res) => {
    try {
      const user_id = req.user?.user_id;
      if (!user_id) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      const {
        limit = 20,
        platform = 'x',
        include_monitored = 'true',
        include_tt_activity = 'true',
        pagination_token = null
      } = req.query;

      // Return cached feed if fresh (skips X API call entirely)
      if (!pagination_token) {
        const cached = getCachedFeed(user_id);
        if (cached) {
          return res.json({ ...cached, from_cache: true });
        }
      }

      // Get user's X auth token AND stored x_user_id in one query
      const tokens = await query(
        `SELECT access_token, x_user_id FROM x_auth_tokens
         WHERE user_id = ? AND is_valid = TRUE
         ORDER BY created_at DESC
         LIMIT 1`,
        [user_id]
      );

      if (!tokens || tokens.length === 0) {
        return res.status(401).json({
          error: 'X account not connected',
          hint: 'Please connect your X account in Social Admin Panel'
        });
      }

      const accessToken = tokens[0].access_token;
      const xUserId = tokens[0].x_user_id;

      if (!xUserId) {
        return res.status(401).json({
          error: 'X user ID not found — please reconnect your X account'
        });
      }

      // Single timeline fetch with all needed fields (no second lookup required)
      const timelineParams = new URLSearchParams({
        max_results: limit,
        'tweet.fields': 'created_at,author_id,public_metrics,entities,note_tweet,article,attachments',
        'expansions': 'author_id,attachments.media_keys',
        'user.fields': 'name,username,profile_image_url,verified',
        'media.fields': 'type,url,preview_image_url,duration_ms,variants'
      });

      if (pagination_token) {
        timelineParams.append('pagination_token', pagination_token);
      }

      const timelineResponse = await fetch(
        `https://api.twitter.com/2/users/${xUserId}/timelines/reverse_chronological?${timelineParams}`,
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          }
        }
      );

      if (!timelineResponse.ok) {
        const errorText = await timelineResponse.text();
        console.error('X API error:', errorText);
        return res.status(timelineResponse.status).json({
          error: 'Failed to fetch timeline from X',
          details: errorText
        });
      }

      const timelineData = await timelineResponse.json();

      // Transform X API response to TT feed format
      const feedItems = [];

      if (timelineData.data && timelineData.data.length > 0) {
        const users = {};
        if (timelineData.includes?.users) {
          timelineData.includes.users.forEach(user => {
            users[user.id] = user;
          });
        }

        // Build media map from timeline includes
        const media = {};
        if (timelineData.includes?.media) {
          timelineData.includes.media.forEach(m => {
            media[m.media_key] = m;
          });
        }

        for (const tweet of timelineData.data) {
          const author = users[tweet.author_id] || {};

          // Get full text: long tweets use note_tweet, Articles use article, else text
          let fullText = '';
          if (tweet.article?.content) {
            fullText = tweet.article.content;
          } else if (tweet.note_tweet?.text) {
            fullText = tweet.note_tweet.text;
          } else {
            fullText = tweet.text || '';
          }

          // Expand t.co short URLs
          if (tweet.entities?.urls) {
            tweet.entities.urls.forEach(urlEntity => {
              if (urlEntity.url && urlEntity.expanded_url) {
                fullText = fullText.replace(urlEntity.url, urlEntity.expanded_url);
              }
            });
          }

          // Extract media URLs from included media
          const mediaUrls = [];
          if (tweet.attachments?.media_keys) {
            tweet.attachments.media_keys.forEach(key => {
              const m = media[key];
              if (!m) return;
              if (m.type === 'video' && m.variants) {
                const best = m.variants
                  .filter(v => v.content_type === 'video/mp4')
                  .sort((a, b) => (b.bit_rate || 0) - (a.bit_rate || 0))[0];
                if (best) mediaUrls.push(best.url);
              } else {
                mediaUrls.push(m.url || m.preview_image_url);
              }
            });
          }

          feedItems.push({
            item_type: 'live_feed',
            post_id: tweet.id,
            thread_id: null,
            platform: 'x',
            post_url: `https://twitter.com/${author.username}/status/${tweet.id}`,
            author_username: author.username || 'unknown',
            author_display_name: author.name || 'Unknown User',
            author_avatar_url: author.profile_image_url || null,
            author_verified: author.verified || false,
            post_text: fullText,
            media_urls: mediaUrls,
            created_at: tweet.created_at,
            engagement: {
              likes: tweet.public_metrics?.like_count || 0,
              shares: tweet.public_metrics?.retweet_count || 0,
              replies: tweet.public_metrics?.reply_count || 0,
              views: tweet.public_metrics?.impression_count || 0
            },
            tt_metadata: {
              discussion_count: 0,
              evidence_count: 0,
              is_monitored: false,
              stance: null,
              verimeter_score: null
            }
          });
        }
      }

      const nextToken = timelineData.meta?.next_token || null;

      const responseData = {
        feed: feedItems,
        total: feedItems.length,
        has_more: !!nextToken,
        next_token: nextToken,
        platform: 'x'
      };

      // Cache first-page results so tab switches don't re-hit X API
      if (!pagination_token) {
        setCachedFeed(user_id, responseData);
      }

      res.json(responseData);

    } catch (error) {
      console.error('Error fetching feed:', error);
      res.status(500).json({
        error: 'Failed to fetch feed',
        details: error.message
      });
    }
  });

  /**
   * GET /api/ttlive/feed/monitored
   * Get all imported threads (showing root post of each thread)
   */
  router.get('/feed/monitored', authenticateToken, async (req, res) => {
    try {
      const user_id = req.user?.user_id;
      if (!user_id) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      const { limit = 20, offset = 0 } = req.query;

      // Single query: 1:1 join on root post, counts via correlated subqueries
      // No GROUP BY needed — is_thread_root=TRUE guarantees at most one fp row per thread
      const rows = await query(
        `SELECT
          t.thread_id,
          t.thread_title,
          t.source_platform,
          t.created_at,
          t.content_id,
          (SELECT COUNT(*) FROM ttlive_imported_posts WHERE thread_id = t.thread_id) AS post_count,
          (SELECT COUNT(*) FROM ttlive_posts        WHERE thread_id = t.thread_id) AS discussion_count,
          fp.imported_post_id                  AS post_id,
          fp.source_url                        AS post_url,
          fp.source_post_id,
          fp.source_author_username            AS author_username,
          fp.source_author_display_name        AS author_display_name,
          fp.source_author_avatar_url          AS author_avatar_url,
          fp.source_author_verified            AS author_verified,
          fp.post_text,
          fp.post_media_urls                   AS media_urls,
          COALESCE(fp.source_likes_count, 0)   AS likes,
          COALESCE(fp.source_retweets_count, 0) AS shares,
          COALESCE(fp.source_replies_count, 0) AS replies
        FROM ttlive_threads t
        LEFT JOIN ttlive_imported_posts fp
          ON fp.thread_id = t.thread_id AND fp.is_thread_root = TRUE
        WHERE t.thread_type = 'imported_x'
        ORDER BY t.created_at DESC
        LIMIT ? OFFSET ?`,
        [parseInt(limit), parseInt(offset)]
      );

      const feedItems = rows
        .filter(r => r.post_id) // skip threads with no imported root post yet
        .map(r => ({
          item_type: 'imported',
          post_id: r.post_id,
          tweet_id: r.source_post_id || null, // pre-parsed ID, no URL splitting needed
          thread_id: r.thread_id,
          platform: r.source_platform || 'x',
          post_url: r.post_url,
          author_username: r.author_username,
          author_display_name: r.author_display_name,
          author_avatar_url: r.author_avatar_url,
          author_verified: r.author_verified,
          post_text: r.post_text,
          media_urls: r.media_urls ? JSON.parse(r.media_urls) : [],
          created_at: r.created_at,
          engagement: {
            likes: r.likes,
            shares: r.shares,
            replies: r.replies,
            views: 0
          },
          tt_metadata: {
            discussion_count: r.discussion_count || 0,
            evidence_count: 0,
            is_monitored: true,
            stance: null,
            verimeter_score: null,
            thread_post_count: r.post_count || 0,
            thread_title: r.thread_title
          }
        }));

      res.json({
        monitored: feedItems,
        total: feedItems.length,
        has_more: feedItems.length === parseInt(limit)
      });

    } catch (error) {
      console.error('Error fetching monitored feed:', error);
      res.status(500).json({
        error: 'Failed to fetch monitored feed',
        details: error.message
      });
    }
  });

  return router;
}
