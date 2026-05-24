/**
 * Discussion Units API Routes
 *
 * Endpoints for generating, managing, and posting discussion units to social media
 */

import { Router } from 'express';
import {
  generateDiscussionUnits,
  validateUnit,
  calculateEngagementPotential,
  extractTweetId
} from '../../services/discussionUnitsGenerator.js';
import {
  postThread,
  getTweetMetrics,
  validateTweetText
} from '../../services/xTwitterService.js';

export default function createDiscussionRouter({ query, pool }) {
  const router = Router();

  /**
   * POST /api/discussion/generate
   * Generate discussion units from content
   */
  router.post('/generate', async (req, res) => {
    const { contentId, tone = 'neutral' } = req.body;
    const userId = req.user?.user_id;

    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    if (!contentId) {
      return res.status(400).json({ error: 'contentId is required' });
    }

    try {
      // 1. Fetch content metadata
      const [contentRows] = await query(
        `SELECT content_id, content_name, url, thumbnail, media_source, details, topic
         FROM content
         WHERE content_id = ?`,
        [contentId]
      );

      if (contentRows.length === 0) {
        return res.status(404).json({ error: 'Content not found' });
      }

      const content = contentRows[0];

      // 2. Fetch claims with evidence for this content
      const claims = await query(
        `SELECT
          c.claim_id,
          c.claim_text,
          c.claim_type,
          c.confidence_level,
          c.veracity_score
        FROM claims c
        INNER JOIN content_claims cc ON c.claim_id = cc.claim_id
        WHERE cc.content_id = ?
        ORDER BY c.claim_id`,
        [contentId]
      );

      if (claims.length === 0) {
        return res.status(400).json({
          error: 'No claims found for this content',
          hint: 'Run the claims extraction pipeline first'
        });
      }

      // 3. Fetch evidence (references) for each claim
      for (const claim of claims) {
        const evidence = await query(
          `SELECT
            rcl.ref_claim_link_id,
            rcl.reference_content_id,
            rcl.stance,
            rcl.score,
            rcl.confidence,
            rcl.support_level,
            rcl.rationale,
            rcl.evidence_text as quote,
            rc.content_name,
            rc.url
          FROM reference_claim_links rcl
          INNER JOIN content rc ON rcl.reference_content_id = rc.content_id
          WHERE rcl.claim_id = ?
          ORDER BY ABS(rcl.support_level) DESC
          LIMIT 10`,
          [claim.claim_id]
        );

        claim.references = evidence;
      }

      // 4. Generate discussion units
      const units = await generateDiscussionUnits({
        contentId,
        claims,
        content,
        tone
      });

      // 5. Create bundle in database
      const bundleResult = await query(
        `INSERT INTO discussion_bundles (content_id, created_by, generation_status)
         VALUES (?, ?, 'completed')`,
        [contentId, userId]
      );

      const bundleId = bundleResult.insertId;

      // 6. Insert units
      for (const unit of units) {
        await query(
          `INSERT INTO discussion_units (
            bundle_id, unit_type, unit_text, original_text, unit_order,
            claim_id, reference_content_id, confidence, support_level, stance,
            sources, is_selected_for_posting
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            bundleId,
            unit.unit_type,
            unit.unit_text,
            unit.original_text,
            unit.unit_order,
            unit.claim_id || null,
            unit.reference_content_id || null,
            unit.confidence || null,
            unit.support_level || null,
            unit.stance || null,
            JSON.stringify(unit.sources || []),
            unit.is_selected_for_posting
          ]
        );
      }

      // 7. Calculate engagement potential
      const engagementScore = calculateEngagementPotential(units);

      res.json({
        success: true,
        bundle_id: bundleId,
        content_id: contentId,
        units_count: units.length,
        engagement_potential: engagementScore,
        units: units.map(u => ({
          ...u,
          character_count: u.unit_text.length
        }))
      });

    } catch (error) {
      console.error('Generate discussion units error:', error);
      res.status(500).json({
        error: 'Failed to generate discussion units',
        details: error.message
      });
    }
  });

  /**
   * GET /api/discussion/:contentId
   * Get existing discussion bundle for content
   */
  router.get('/:contentId', async (req, res) => {
    const { contentId } = req.params;
    const userId = req.user?.user_id;

    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    try {
      // Get most recent bundle for this content by this user
      const [bundles] = await query(
        `SELECT * FROM discussion_bundles
         WHERE content_id = ? AND created_by = ?
         ORDER BY created_at DESC
         LIMIT 1`,
        [contentId, userId]
      );

      if (bundles.length === 0) {
        return res.status(404).json({ error: 'No discussion bundle found' });
      }

      const bundle = bundles[0];

      // Get units
      const units = await query(
        `SELECT * FROM discussion_units
         WHERE bundle_id = ?
         ORDER BY unit_order`,
        [bundle.bundle_id]
      );

      // Parse JSON sources
      units.forEach(unit => {
        if (unit.sources) {
          unit.sources = JSON.parse(unit.sources);
        }
      });

      res.json({
        success: true,
        bundle: {
          ...bundle,
          units
        }
      });

    } catch (error) {
      console.error('Get discussion bundle error:', error);
      res.status(500).json({
        error: 'Failed to fetch discussion bundle',
        details: error.message
      });
    }
  });

  /**
   * PUT /api/discussion/units/:unitId
   * Update a discussion unit (edit text, toggle selection)
   */
  router.put('/units/:unitId', async (req, res) => {
    const { unitId } = req.params;
    const { unit_text, is_selected_for_posting } = req.body;
    const userId = req.user?.user_id;

    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    try {
      // Verify ownership
      const [units] = await query(
        `SELECT du.*, db.created_by
         FROM discussion_units du
         INNER JOIN discussion_bundles db ON du.bundle_id = db.bundle_id
         WHERE du.unit_id = ?`,
        [unitId]
      );

      if (units.length === 0) {
        return res.status(404).json({ error: 'Unit not found' });
      }

      if (units[0].created_by !== userId) {
        return res.status(403).json({ error: 'Not authorized to edit this unit' });
      }

      // Build update query
      const updates = [];
      const values = [];

      if (unit_text !== undefined) {
        // Validate
        const validation = validateTweetText(unit_text);
        if (!validation.valid) {
          return res.status(400).json({
            error: 'Invalid unit text',
            validation_errors: validation.errors
          });
        }

        updates.push('unit_text = ?', 'is_edited = TRUE', 'edited_at = NOW()');
        values.push(unit_text);
      }

      if (is_selected_for_posting !== undefined) {
        updates.push('is_selected_for_posting = ?');
        values.push(is_selected_for_posting);
      }

      if (updates.length === 0) {
        return res.status(400).json({ error: 'No updates provided' });
      }

      values.push(unitId);

      await query(
        `UPDATE discussion_units SET ${updates.join(', ')} WHERE unit_id = ?`,
        values
      );

      res.json({ success: true });

    } catch (error) {
      console.error('Update discussion unit error:', error);
      res.status(500).json({
        error: 'Failed to update unit',
        details: error.message
      });
    }
  });

  /**
   * POST /api/discussion/post-to-x
   * Post selected units to X/Twitter
   */
  router.post('/post-to-x', async (req, res) => {
    const {
      bundleId,
      originalPostUrl,
      delayBetweenPosts = 5
    } = req.body;
    const userId = req.user?.user_id;

    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    if (!bundleId) {
      return res.status(400).json({ error: 'bundleId is required' });
    }

    try {
      // 1. Check rate limits
      const [canPost, reason] = await query(
        'CALL check_rate_limit(?, ?, @can_post, @reason); SELECT @can_post as can_post, @reason as reason',
        [userId, 'twitter_x']
      );

      const rateLimitResult = canPost[1][0];
      if (!rateLimitResult.can_post) {
        return res.status(429).json({
          error: 'Rate limit exceeded',
          reason: rateLimitResult.reason
        });
      }

      // 2. Get user's X auth token
      const [tokens] = await query(
        `SELECT * FROM x_auth_tokens
         WHERE user_id = ? AND is_valid = TRUE
         ORDER BY created_at DESC
         LIMIT 1`,
        [userId]
      );

      if (tokens.length === 0) {
        return res.status(400).json({
          error: 'X/Twitter account not connected',
          hint: 'Please authenticate with X first'
        });
      }

      const token = tokens[0];

      // Check if token is expired (implement refresh logic if needed)
      if (token.expires_at && new Date(token.expires_at) < new Date()) {
        return res.status(401).json({
          error: 'X token expired',
          hint: 'Please re-authenticate with X'
        });
      }

      // 3. Get bundle and units
      const [bundles] = await query(
        `SELECT * FROM discussion_bundles WHERE bundle_id = ? AND created_by = ?`,
        [bundleId, userId]
      );

      if (bundles.length === 0) {
        return res.status(404).json({ error: 'Bundle not found' });
      }

      const bundle = bundles[0];

      const selectedUnits = await query(
        `SELECT * FROM discussion_units
         WHERE bundle_id = ? AND is_selected_for_posting = TRUE
         ORDER BY unit_order`,
        [bundleId]
      );

      if (selectedUnits.length === 0) {
        return res.status(400).json({ error: 'No units selected for posting' });
      }

      if (selectedUnits.length > 5) {
        return res.status(400).json({
          error: 'Too many units selected',
          hint: 'Maximum 5 units per post to avoid spam'
        });
      }

      // 4. Extract tweet ID from original post URL
      const tweetId = extractTweetId(originalPostUrl);

      // Update bundle with tweet info
      if (tweetId) {
        await query(
          `UPDATE discussion_bundles
           SET original_post_url = ?, tweet_id = ?
           WHERE bundle_id = ?`,
          [originalPostUrl, tweetId, bundleId]
        );
      }

      // 5. Post thread to X
      const tweets = selectedUnits.map(u => u.unit_text);
      const delayMs = delayBetweenPosts * 1000;

      const results = await postThread(
        token.access_token,
        tweets,
        tweetId,
        delayMs
      );

      // 6. Record posts in database
      const postedCount = results.filter(r => r.success).length;
      const failedCount = results.filter(r => !r.success).length;

      for (let i = 0; i < results.length; i++) {
        const result = results[i];
        const unit = selectedUnits[i];

        await query(
          `INSERT INTO discussion_unit_posts (
            unit_id, bundle_id, user_id, platform,
            external_post_id, external_url, thread_position,
            posted_text, character_count, post_status, post_error, posted_at
          ) VALUES (?, ?, ?, 'twitter_x', ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            unit.unit_id,
            bundleId,
            userId,
            result.tweet_id || null,
            result.url || null,
            result.position,
            unit.unit_text,
            unit.unit_text.length,
            result.success ? 'posted' : 'failed',
            result.error || null,
            result.success ? new Date() : null
          ]
        );
      }

      // 7. Update rate limits
      await query(
        'CALL record_social_post(?, ?, ?)',
        [userId, 'twitter_x', true] // true = is bundle start
      );

      res.json({
        success: true,
        posted_count: postedCount,
        failed_count: failedCount,
        results: results,
        first_tweet_url: results[0]?.url
      });

    } catch (error) {
      console.error('Post to X error:', error);
      res.status(500).json({
        error: 'Failed to post to X',
        details: error.message
      });
    }
  });

  /**
   * GET /api/discussion/bundles/user
   * Get all bundles created by user
   */
  router.get('/bundles/user', async (req, res) => {
    const userId = req.user?.user_id;

    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    try {
      const bundles = await query(
        `SELECT
          db.*,
          c.content_name,
          c.url as content_url,
          COUNT(DISTINCT du.unit_id) as units_count,
          COUNT(DISTINCT dup.post_id) as posts_count,
          SUM(CASE WHEN dup.post_status = 'posted' THEN 1 ELSE 0 END) as successful_posts
        FROM discussion_bundles db
        INNER JOIN content c ON db.content_id = c.content_id
        LEFT JOIN discussion_units du ON db.bundle_id = du.bundle_id
        LEFT JOIN discussion_unit_posts dup ON db.bundle_id = dup.bundle_id
        WHERE db.created_by = ?
        GROUP BY db.bundle_id
        ORDER BY db.created_at DESC
        LIMIT 50`,
        [userId]
      );

      res.json({
        success: true,
        bundles
      });

    } catch (error) {
      console.error('Get user bundles error:', error);
      res.status(500).json({
        error: 'Failed to fetch bundles',
        details: error.message
      });
    }
  });

  /**
   * GET /api/discussion/posts/:bundleId/metrics
   * Get engagement metrics for posted units
   */
  router.get('/posts/:bundleId/metrics', async (req, res) => {
    const { bundleId } = req.params;
    const userId = req.user?.user_id;

    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    try {
      // Get posts for this bundle
      const posts = await query(
        `SELECT * FROM discussion_unit_posts
         WHERE bundle_id = ? AND user_id = ? AND post_status = 'posted'
         ORDER BY thread_position`,
        [bundleId, userId]
      );

      if (posts.length === 0) {
        return res.json({ success: true, metrics: [] });
      }

      // Get user's X token
      const [tokens] = await query(
        `SELECT access_token FROM x_auth_tokens
         WHERE user_id = ? AND is_valid = TRUE
         ORDER BY created_at DESC LIMIT 1`,
        [userId]
      );

      if (tokens.length === 0) {
        return res.status(400).json({ error: 'X account not connected' });
      }

      const accessToken = tokens[0].access_token;

      // Fetch metrics for each post
      const metrics = [];
      for (const post of posts) {
        try {
          const tweetMetrics = await getTweetMetrics(accessToken, post.external_post_id);

          // Update database
          await query(
            `UPDATE discussion_unit_posts
             SET likes_count = ?, retweets_count = ?, replies_count = ?,
                 last_metrics_update = NOW()
             WHERE post_id = ?`,
            [
              tweetMetrics.likes_count,
              tweetMetrics.retweets_count,
              tweetMetrics.replies_count,
              post.post_id
            ]
          );

          metrics.push({
            post_id: post.post_id,
            external_post_id: post.external_post_id,
            ...tweetMetrics
          });

        } catch (error) {
          console.error(`Failed to fetch metrics for post ${post.post_id}:`, error.message);
          metrics.push({
            post_id: post.post_id,
            error: error.message
          });
        }
      }

      res.json({
        success: true,
        metrics
      });

    } catch (error) {
      console.error('Get metrics error:', error);
      res.status(500).json({
        error: 'Failed to fetch metrics',
        details: error.message
      });
    }
  });

  return router;
}
