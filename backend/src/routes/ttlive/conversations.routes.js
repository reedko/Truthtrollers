/**
 * Conversation Index API Routes
 *
 * Handles conversation spaces for imported threads
 */

import { Router } from 'express';
import { authenticateToken } from '../../middleware/auth.js';
import { v4 as uuidv4 } from 'uuid';
// import conversationEvidenceService from '../../services/conversationEvidenceService.js';

export default function createConversationsRouter({ query, pool }) {
  const router = Router();

  // All conversation routes require authentication
  router.use(authenticateToken);

  // =====================================================
  // Conversation Management
  // =====================================================

  /**
   * GET /api/ttlive/conversations/:threadId
   * Get conversation for a thread
   */
  router.get('/:threadId', async (req, res) => {
    try {
      const { threadId } = req.params;

      const [conversation] = await query(`
        SELECT * FROM ttlive_conversations
        WHERE thread_id = ?
      `, [threadId]);

      if (!conversation) {
        return res.status(404).json({ error: 'Conversation not found' });
      }

      res.json({ conversation });
    } catch (error) {
      console.error('Error fetching conversation:', error);
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * GET /api/ttlive/conversations/:threadId/participants
   * Get participants in a conversation
   */
  router.get('/:threadId/participants', async (req, res) => {
    try {
      const { threadId } = req.params;

      // Get conversation
      const [conversation] = await query(`
        SELECT conversation_id FROM ttlive_conversations WHERE thread_id = ?
      `, [threadId]);

      if (!conversation) {
        return res.status(404).json({ error: 'Conversation not found' });
      }

      // Get participants with user details
      const participants = await query(`
        SELECT
          cp.*,
          u.username,
          u.user_profile_image AS user_avatar
        FROM ttlive_conversation_participants cp
        JOIN users u ON cp.user_id = u.user_id
        WHERE cp.conversation_id = ?
        ORDER BY cp.joined_at ASC
      `, [conversation.conversation_id]);

      res.json({ participants });
    } catch (error) {
      console.error('Error fetching participants:', error);
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * POST /api/ttlive/conversations/:threadId/join
   * Join a conversation
   */
  router.post('/:threadId/join', async (req, res) => {
    try {
      const { threadId } = req.params;
      const user_id = req.user.user_id;
      const { join_reason } = req.body;

      // Get conversation
      const [conversation] = await query(`
        SELECT conversation_id FROM ttlive_conversations WHERE thread_id = ?
      `, [threadId]);

      if (!conversation) {
        return res.status(404).json({ error: 'Conversation not found' });
      }

      // Join (or update if already joined)
      await query(`
        INSERT INTO ttlive_conversation_participants (
          conversation_id,
          user_id,
          role,
          join_reason
        ) VALUES (?, ?, 'participant', ?)
        ON DUPLICATE KEY UPDATE
          is_active = TRUE,
          last_active_at = NOW()
      `, [conversation.conversation_id, user_id, join_reason]);

      res.json({ success: true, message: 'Joined conversation' });
    } catch (error) {
      console.error('Error joining conversation:', error);
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * POST /api/ttlive/conversations/:threadId/leave
   * Leave a conversation
   */
  router.post('/:threadId/leave', async (req, res) => {
    try {
      const { threadId } = req.params;
      const user_id = req.user.user_id;

      // Get conversation
      const [conversation] = await query(`
        SELECT conversation_id FROM ttlive_conversations WHERE thread_id = ?
      `, [threadId]);

      if (!conversation) {
        return res.status(404).json({ error: 'Conversation not found' });
      }

      // Mark as inactive
      await query(`
        UPDATE ttlive_conversation_participants
        SET is_active = FALSE, left_at = NOW()
        WHERE conversation_id = ? AND user_id = ?
      `, [conversation.conversation_id, user_id]);

      res.json({ success: true, message: 'Left conversation' });
    } catch (error) {
      console.error('Error leaving conversation:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // =====================================================
  // Conversation Arguments (Point/Counterpoint)
  // =====================================================

  /**
   * GET /api/ttlive/conversations/:threadId/arguments
   * Get all arguments in a conversation (for point/counterpoint view)
   */
  router.get('/:threadId/arguments', async (req, res) => {
    try {
      const { threadId } = req.params;

      // Get or create conversation
      let [conversation] = await query(`
        SELECT conversation_id FROM ttlive_conversations WHERE thread_id = ?
      `, [threadId]);

      if (!conversation) {
        // Check if thread exists
        const [thread] = await query(`
          SELECT thread_id, thread_title FROM ttlive_threads WHERE thread_id = ?
        `, [threadId]);

        if (!thread) {
          return res.status(404).json({ error: 'Thread not found' });
        }

        // Auto-create conversation for this thread
        await query(`
          INSERT INTO ttlive_conversations (thread_id, conversation_title)
          VALUES (?, ?)
        `, [threadId, thread.thread_title]);

        [conversation] = await query(`
          SELECT conversation_id FROM ttlive_conversations WHERE thread_id = ?
        `, [threadId]);
      }

      // Get arguments with author details
      const argumentsList = await query(`
        SELECT
          ca.*,
          u.username AS author_username,
          u.user_profile_image AS author_avatar
        FROM ttlive_conversation_arguments ca
        JOIN users u ON ca.author_user_id = u.user_id
        WHERE ca.conversation_id = ?
        ORDER BY ca.created_at ASC
      `, [conversation.conversation_id]);

      // Get citations for each argument
      for (const arg of argumentsList) {
        arg.citations = await query(`
          SELECT * FROM ttlive_conversation_argument_citations
          WHERE conv_argument_id = ?
        `, [arg.conv_argument_id]);
      }

      res.json({ arguments: argumentsList });
    } catch (error) {
      console.error('Error fetching conversation arguments:', error);
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * POST /api/ttlive/conversations/:threadId/arguments
   * Create an argument in the conversation
   */
  router.post('/:threadId/arguments', async (req, res) => {
    try {
      const { threadId } = req.params;
      const user_id = req.user.user_id;
      const {
        claim,
        stance,
        reasoning,
        reply_to_conv_argument_id,
        reply_to_imported_post_id,
        citations = []
      } = req.body;

      // Validate required fields
      if (!claim || !stance || !reasoning) {
        return res.status(400).json({ error: 'Missing required fields' });
      }

      // Get conversation
      const [conversation] = await query(`
        SELECT conversation_id FROM ttlive_conversations WHERE thread_id = ?
      `, [threadId]);

      if (!conversation) {
        return res.status(404).json({ error: 'Conversation not found' });
      }

      // Calculate depth level
      let depth_level = 0;
      if (reply_to_conv_argument_id) {
        const [parent] = await query(`
          SELECT depth_level FROM ttlive_conversation_arguments
          WHERE conv_argument_id = ?
        `, [reply_to_conv_argument_id]);
        if (parent) {
          depth_level = parent.depth_level + 1;
        }
      }

      // Create argument
      const conv_argument_id = uuidv4();
      await query(`
        INSERT INTO ttlive_conversation_arguments (
          conv_argument_id,
          conversation_id,
          author_user_id,
          claim,
          stance,
          reasoning,
          reply_to_conv_argument_id,
          reply_to_imported_post_id,
          depth_level
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        conv_argument_id,
        conversation.conversation_id,
        user_id,
        claim,
        stance,
        reasoning,
        reply_to_conv_argument_id,
        reply_to_imported_post_id,
        depth_level
      ]);

      // Add citations
      for (const citation of citations) {
        await query(`
          INSERT INTO ttlive_conversation_argument_citations (
            conv_argument_id,
            url,
            title,
            quote_text,
            context_summary
          ) VALUES (?, ?, ?, ?, ?)
        `, [
          conv_argument_id,
          citation.url,
          citation.title,
          citation.quote_text,
          citation.context_summary
        ]);
      }

      // Get created argument with author details
      const [argument] = await query(`
        SELECT
          ca.*,
          u.username AS author_username,
          u.user_profile_image AS author_avatar
        FROM ttlive_conversation_arguments ca
        JOIN users u ON ca.author_user_id = u.user_id
        WHERE ca.conv_argument_id = ?
      `, [conv_argument_id]);

      argument.citations = await query(`
        SELECT * FROM ttlive_conversation_argument_citations
        WHERE conv_argument_id = ?
      `, [conv_argument_id]);

      // Process evidence in background (don't block response)
      // TODO: Re-enable when evidence service is fully tested
      // conversationEvidenceService.processArgumentEvidence(
      //   { query },
      //   conv_argument_id,
      //   { claim, reasoning, author_user_id: user_id }
      // ).catch(err => {
      //   console.error('Background evidence processing failed:', err);
      // });

      res.json({ argument });
    } catch (error) {
      console.error('Error creating conversation argument:', error);
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * GET /api/ttlive/conversations/:threadId/arguments/:argumentId/evidence
   * Get evidence breakdown for an argument
   */
  router.get('/:threadId/arguments/:argumentId/evidence', async (req, res) => {
    try {
      // TODO: Re-enable evidence service
      res.json({ claims: [], references: [] });
    } catch (error) {
      console.error('Error fetching argument evidence:', error);
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * POST /api/ttlive/conversations/:threadId/arguments/:argumentId/stage
   * Move conversation argument to staged arguments system
   */
  router.post('/:threadId/arguments/:argumentId/stage', async (req, res) => {
    try {
      const { threadId, argumentId } = req.params;
      const { task_id, content_id } = req.body;

      // Get conversation argument
      const [convArg] = await query(`
        SELECT * FROM ttlive_conversation_arguments
        WHERE conv_argument_id = ?
      `, [argumentId]);

      if (!convArg) {
        return res.status(404).json({ error: 'Argument not found' });
      }

      if (convArg.is_staged) {
        return res.status(400).json({ error: 'Argument already staged' });
      }

      // Create staged argument
      const staged_argument_id = uuidv4();
      await query(`
        INSERT INTO ttlive_staged_arguments (
          argument_id,
          thread_id,
          author_user_id,
          claim,
          stance,
          reasoning,
          reply_to_imported_post_id,
          task_id,
          content_id,
          status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft')
      `, [
        staged_argument_id,
        threadId,
        convArg.author_user_id,
        convArg.claim,
        convArg.stance,
        convArg.reasoning,
        convArg.reply_to_imported_post_id,
        task_id,
        content_id
      ]);

      // Copy citations
      const citations = await query(`
        SELECT * FROM ttlive_conversation_argument_citations
        WHERE conv_argument_id = ?
      `, [argumentId]);

      for (const citation of citations) {
        await query(`
          INSERT INTO ttlive_argument_citations (
            argument_id,
            url,
            title,
            quote_text,
            context_summary
          ) VALUES (?, ?, ?, ?, ?)
        `, [
          staged_argument_id,
          citation.url,
          citation.title,
          citation.quote_text,
          citation.context_summary
        ]);
      }

      // Mark conversation argument as staged
      await query(`
        UPDATE ttlive_conversation_arguments
        SET is_staged = TRUE, staged_argument_id = ?, staged_at = NOW()
        WHERE conv_argument_id = ?
      `, [staged_argument_id, argumentId]);

      res.json({
        success: true,
        staged_argument_id,
        message: 'Argument moved to staging pipeline'
      });
    } catch (error) {
      console.error('Error staging argument:', error);
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * POST /api/ttlive/conversations/:threadId/arguments/:argumentId/vote
   * Upvote or downvote an argument
   */
  router.post('/:threadId/arguments/:argumentId/vote', async (req, res) => {
    try {
      const { argumentId } = req.params;
      const { vote_type } = req.body; // 'up' or 'down'

      if (vote_type === 'up') {
        await query(`
          UPDATE ttlive_conversation_arguments
          SET upvotes = upvotes + 1
          WHERE conv_argument_id = ?
        `, [argumentId]);
      } else if (vote_type === 'down') {
        await query(`
          UPDATE ttlive_conversation_arguments
          SET downvotes = downvotes + 1
          WHERE conv_argument_id = ?
        `, [argumentId]);
      }

      res.json({ success: true });
    } catch (error) {
      console.error('Error voting:', error);
      res.status(500).json({ error: error.message });
    }
  });

  return router;
}
