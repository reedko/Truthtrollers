/**
 * TT Live Feed API Routes
 *
 * Feed-first architecture: viewing >> posting
 */

import { Router } from 'express';
import feedIngestionService from '../../services/feedIngestionService.js';

export default function createFeedRouter({ query, pool }) {
  const router = Router();

  /**
   * GET /api/ttlive/feed
   * Get mixed feed (platform + monitored + TT activity)
   */
  router.get('/feed', async (req, res) => {
    try {
      const user_id = req.user?.user_id;
      if (!user_id) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const {
        limit = 20,
        platform = 'x',
        cursor = null,
        include_monitored = 'true',
        include_tt_activity = 'true',
      } = req.query;

      const feed = await feedIngestionService.getMixedFeed({ query }, user_id, {
        limit: parseInt(limit),
        platform,
        cursor,
        include_monitored: include_monitored === 'true',
        include_tt_activity: include_tt_activity === 'true',
      });

      res.json({
        feed,
        has_more: feed.length === parseInt(limit),
        next_cursor: feed.length > 0 ? feed[feed.length - 1].post_id : null,
      });
    } catch (error) {
      console.error('Feed fetch error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * POST /api/ttlive/feed/watch
   * Monitor/watch a specific feed item
   */
  router.post('/feed/watch', async (req, res) => {
    try {
      const user_id = req.user?.user_id;
      if (!user_id) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const { feed_item } = req.body;

      if (!feed_item) {
        return res.status(400).json({ error: 'feed_item required' });
      }

      const result = await feedIngestionService.watchFeedItem(
        { query },
        user_id,
        feed_item
      );

      res.json(result);
    } catch (error) {
      console.error('Watch error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * GET /api/ttlive/feed/monitored
   * Get only monitored/watched content
   */
  router.get('/feed/monitored', async (req, res) => {
    try {
      const user_id = req.user?.user_id;
      if (!user_id) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const { limit = 20 } = req.query;

      // Get user's subscribed threads
      const monitored = await query(`
        SELECT
          t.thread_id,
          t.thread_title,
          t.source_platform,
          t.source_url,
          t.total_posts,
          t.total_tt_posts,
          t.last_activity_at,
          s.notification_level,
          s.is_monitoring,
          ip.source_author_username,
          ip.post_text,
          ip.source_created_at
        FROM ttlive_thread_subscriptions s
        JOIN ttlive_threads t ON s.thread_id = t.thread_id
        LEFT JOIN ttlive_imported_posts ip ON ip.thread_id = t.thread_id AND ip.is_thread_root = TRUE
        WHERE s.user_id = ?
          AND t.is_archived = FALSE
        ORDER BY t.last_activity_at DESC
        LIMIT ?
      `, [user_id, parseInt(limit)]);

      res.json({ monitored });
    } catch (error) {
      console.error('Monitored feed error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * GET /api/ttlive/feed/:feedItemId/thread
   * Get thread for a specific feed item
   */
  router.get('/feed/:feedItemId/thread', async (req, res) => {
    try {
      const { feedItemId } = req.params;

      // Look up thread by imported post ID
      const [imported] = await query(`
        SELECT thread_id FROM ttlive_imported_posts
        WHERE imported_post_id = ?
      `, [feedItemId]);

      if (!imported) {
        return res.status(404).json({ error: 'Thread not found' });
      }

      // Redirect to thread timeline endpoint
      res.redirect(`/api/ttlive/threads/${imported.thread_id}/timeline`);
    } catch (error) {
      console.error('Feed item thread error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  return router;
}
