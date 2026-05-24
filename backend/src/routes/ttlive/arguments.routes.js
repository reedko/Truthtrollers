/**
 * Staged Arguments API Routes
 *
 * Handles argument construction, validation, signoffs, and export
 */

import { Router } from 'express';
import { authenticateToken } from '../../middleware/auth.js';
import argumentValidationService from '../../services/argumentValidationService.js';

export default function createArgumentsRouter({ query, pool }) {
  const router = Router();

  // All argument routes require authentication
  router.use(authenticateToken);

  // =====================================================
  // Argument CRUD
  // =====================================================

  /**
   * POST /api/ttlive/arguments
   * Create new staged argument
   */
  router.post('/', async (req, res) => {
    try {
      const user_id = req.user.user_id;
      const {
        thread_id,
        claim,
        stance,
        reasoning,
        reply_to_argument_id,
        reply_to_post_id,
        reply_to_imported_post_id,
        citations = []
      } = req.body;

      // Validate required fields
      if (!thread_id || !claim || !stance || !reasoning) {
        return res.status(400).json({
          error: 'Missing required fields: thread_id, claim, stance, reasoning'
        });
      }

      // Create argument (initially in draft status)
      const argumentResult = await query(`
        INSERT INTO ttlive_staged_arguments (
          thread_id,
          author_user_id,
          claim,
          stance,
          reasoning,
          reply_to_argument_id,
          reply_to_post_id,
          reply_to_imported_post_id,
          status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'draft')
      `, [
        thread_id,
        user_id,
        claim,
        stance,
        reasoning,
        reply_to_argument_id || null,
        reply_to_post_id || null,
        reply_to_imported_post_id || null
      ]);

      const argument_id = argumentResult.insertId;

      // Add citations if provided
      if (citations.length > 0) {
        for (const citation of citations) {
          // Score citation relevance
          const { relevanceScore, credibilityScore } =
            await argumentValidationService.scoreCitationRelevance(
              claim,
              reasoning,
              citation.url,
              citation.quote_text || ''
            );

          await query(`
            INSERT INTO ttlive_argument_citations (
              argument_id,
              url,
              title,
              relevance_score,
              source_credibility_score,
              quote_text,
              context_summary,
              added_by
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `, [
            argument_id,
            citation.url,
            citation.title || null,
            relevanceScore,
            credibilityScore,
            citation.quote_text || null,
            citation.context_summary || null,
            user_id
          ]);
        }
      }

      // Fetch complete argument with citations
      const fullArgument = await getArgumentById(query, argument_id);

      // Run validation pipeline
      const validation = await argumentValidationService.validateArgument(fullArgument);

      // Update argument with validation results
      await updateArgumentValidation(query, argument_id, validation);

      // Insert detected fallacies
      if (validation.detected_fallacies && validation.detected_fallacies.length > 0) {
        for (const fallacy of validation.detected_fallacies) {
          await query(`
            INSERT INTO ttlive_argument_fallacies (
              argument_id,
              fallacy_type,
              fallacy_name,
              description,
              text_excerpt,
              confidence_score,
              detected_by_ai
            ) VALUES (?, ?, ?, ?, ?, ?, TRUE)
          `, [
            argument_id,
            fallacy.type || 'other',
            fallacy.name,
            fallacy.description,
            fallacy.excerpt || null,
            fallacy.confidence || 0
          ]);
        }
      }

      // Return complete argument with validation
      const updatedArgument = await getArgumentById(query, argument_id);

      res.status(201).json({
        argument: updatedArgument,
        validation
      });
    } catch (error) {
      console.error('Error creating argument:', error);
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * GET /api/ttlive/arguments/:argumentId
   * Get argument by ID with full details
   */
  router.get('/:argumentId', async (req, res) => {
    try {
      const { argumentId } = req.params;
      const argument = await getArgumentById(query, argumentId);

      if (!argument) {
        return res.status(404).json({ error: 'Argument not found' });
      }

      res.json({ argument });
    } catch (error) {
      console.error('Error fetching argument:', error);
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * GET /api/ttlive/threads/:threadId/arguments
   * Get all arguments in a thread
   */
  router.get('/thread/:threadId', async (req, res) => {
    try {
      const { threadId } = req.params;
      const { status, limit = 50, offset = 0 } = req.query;

      let statusFilter = '';
      let params = [threadId];

      if (status) {
        statusFilter = 'AND sa.status = ?';
        params.push(status);
      }

      params.push(parseInt(limit), parseInt(offset));

      const argumentsList = await query(`
        SELECT
          sa.*,
          u.username AS author_username,
          u.user_profile_image AS author_avatar,
          COUNT(DISTINCT ac.citation_id) AS citation_count,
          COUNT(DISTINCT asf.signoff_id) AS signoff_count
        FROM ttlive_staged_arguments sa
        JOIN users u ON sa.author_user_id = u.user_id
        LEFT JOIN ttlive_argument_citations ac ON sa.argument_id = ac.argument_id
        LEFT JOIN ttlive_argument_signoffs asf ON sa.argument_id = asf.argument_id
        WHERE sa.thread_id = ? ${statusFilter}
        GROUP BY sa.argument_id
        ORDER BY sa.created_at DESC
        LIMIT ? OFFSET ?
      `, params);

      res.json({
        arguments: argumentsList,
        total: argumentsList.length,
        has_more: argumentsList.length === parseInt(limit)
      });
    } catch (error) {
      console.error('Error fetching thread arguments:', error);
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * PATCH /api/ttlive/arguments/:argumentId
   * Update argument (only if draft or needs_revision)
   */
  router.patch('/:argumentId', async (req, res) => {
    try {
      const user_id = req.user.user_id;
      const { argumentId } = req.params;
      const { claim, stance, reasoning } = req.body;

      // Check ownership
      const existing = await query(`
        SELECT author_user_id, status
        FROM ttlive_staged_arguments
        WHERE argument_id = ?
      `, [argumentId]);

      if (existing.length === 0) {
        return res.status(404).json({ error: 'Argument not found' });
      }

      if (existing[0].author_user_id !== user_id) {
        return res.status(403).json({ error: 'Not authorized to edit this argument' });
      }

      if (!['draft', 'needs_revision'].includes(existing[0].status)) {
        return res.status(400).json({
          error: 'Cannot edit argument that is approved or signed off'
        });
      }

      // Update fields
      const updates = [];
      const params = [];

      if (claim !== undefined) {
        updates.push('claim = ?');
        params.push(claim);
      }
      if (stance !== undefined) {
        updates.push('stance = ?');
        params.push(stance);
      }
      if (reasoning !== undefined) {
        updates.push('reasoning = ?');
        params.push(reasoning);
      }

      if (updates.length > 0) {
        params.push(argumentId);
        await query(`
          UPDATE ttlive_staged_arguments
          SET ${updates.join(', ')}, updated_at = NOW()
          WHERE argument_id = ?
        `, params);
      }

      // Re-run validation
      const updatedArgument = await getArgumentById(query, argumentId);
      const validation = await argumentValidationService.validateArgument(updatedArgument);
      await updateArgumentValidation(query, argumentId, validation);

      const finalArgument = await getArgumentById(query, argumentId);

      res.json({
        argument: finalArgument,
        validation
      });
    } catch (error) {
      console.error('Error updating argument:', error);
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * DELETE /api/ttlive/arguments/:argumentId
   * Delete argument (only if draft)
   */
  router.delete('/:argumentId', async (req, res) => {
    try {
      const user_id = req.user.user_id;
      const { argumentId } = req.params;

      // Check ownership and status
      const existing = await query(`
        SELECT author_user_id, status
        FROM ttlive_staged_arguments
        WHERE argument_id = ?
      `, [argumentId]);

      if (existing.length === 0) {
        return res.status(404).json({ error: 'Argument not found' });
      }

      if (existing[0].author_user_id !== user_id && req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Not authorized' });
      }

      if (existing[0].status !== 'draft') {
        return res.status(400).json({
          error: 'Can only delete draft arguments'
        });
      }

      await query(`DELETE FROM ttlive_staged_arguments WHERE argument_id = ?`, [argumentId]);

      res.json({ success: true });
    } catch (error) {
      console.error('Error deleting argument:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // =====================================================
  // Citation Management
  // =====================================================

  /**
   * POST /api/ttlive/arguments/:argumentId/citations
   * Add citation to argument
   */
  router.post('/:argumentId/citations', async (req, res) => {
    try {
      const user_id = req.user.user_id;
      const { argumentId } = req.params;
      const { url, title, quote_text, context_summary } = req.body;

      if (!url) {
        return res.status(400).json({ error: 'Citation URL required' });
      }

      // Get argument for relevance scoring
      const argument = await getArgumentById(query, argumentId);

      if (!argument) {
        return res.status(404).json({ error: 'Argument not found' });
      }

      // Score citation relevance
      const { relevanceScore, credibilityScore, rationale } =
        await argumentValidationService.scoreCitationRelevance(
          argument.claim,
          argument.reasoning,
          url,
          quote_text || ''
        );

      // Insert citation
      const result = await query(`
        INSERT INTO ttlive_argument_citations (
          argument_id,
          url,
          title,
          relevance_score,
          source_credibility_score,
          quote_text,
          context_summary,
          added_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        argumentId,
        url,
        title || null,
        relevanceScore,
        credibilityScore,
        quote_text || null,
        context_summary || rationale,
        user_id
      ]);

      const citation = await query(`
        SELECT * FROM ttlive_argument_citations WHERE citation_id = ?
      `, [result.insertId]);

      res.status(201).json({ citation: citation[0] });
    } catch (error) {
      console.error('Error adding citation:', error);
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * DELETE /api/ttlive/arguments/:argumentId/citations/:citationId
   * Remove citation from argument
   */
  router.delete('/:argumentId/citations/:citationId', async (req, res) => {
    try {
      const { argumentId, citationId } = req.params;

      await query(`
        DELETE FROM ttlive_argument_citations
        WHERE citation_id = ? AND argument_id = ?
      `, [citationId, argumentId]);

      res.json({ success: true });
    } catch (error) {
      console.error('Error deleting citation:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // =====================================================
  // Signoff Management
  // =====================================================

  /**
   * POST /api/ttlive/arguments/:argumentId/signoff
   * Sign off on argument
   */
  router.post('/:argumentId/signoff', async (req, res) => {
    try {
      const user_id = req.user.user_id;
      const { argumentId } = req.params;
      const {
        signoff_type = 'approve',
        feedback_text,
        suggested_improvements,
        personal_quality_rating
      } = req.body;

      // Check if argument is approved
      const argument = await query(`
        SELECT status FROM ttlive_staged_arguments WHERE argument_id = ?
      `, [argumentId]);

      if (argument.length === 0) {
        return res.status(404).json({ error: 'Argument not found' });
      }

      if (argument[0].status !== 'approved') {
        return res.status(400).json({
          error: 'Can only sign off on approved arguments'
        });
      }

      // Insert or update signoff
      await query(`
        INSERT INTO ttlive_argument_signoffs (
          argument_id,
          user_id,
          signoff_type,
          feedback_text,
          suggested_improvements,
          personal_quality_rating
        ) VALUES (?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          signoff_type = VALUES(signoff_type),
          feedback_text = VALUES(feedback_text),
          suggested_improvements = VALUES(suggested_improvements),
          personal_quality_rating = VALUES(personal_quality_rating),
          signed_at = NOW()
      `, [
        argumentId,
        user_id,
        signoff_type,
        feedback_text || null,
        suggested_improvements || null,
        personal_quality_rating || null
      ]);

      // Fetch updated signoffs
      const signoffs = await query(`
        SELECT
          asf.*,
          u.username,
          u.user_profile_image AS user_avatar
        FROM ttlive_argument_signoffs asf
        JOIN users u ON asf.user_id = u.user_id
        WHERE asf.argument_id = ?
        ORDER BY asf.signed_at DESC
      `, [argumentId]);

      res.json({ signoffs });
    } catch (error) {
      console.error('Error adding signoff:', error);
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * DELETE /api/ttlive/arguments/:argumentId/signoff
   * Remove signoff
   */
  router.delete('/:argumentId/signoff', async (req, res) => {
    try {
      const user_id = req.user.user_id;
      const { argumentId } = req.params;

      await query(`
        DELETE FROM ttlive_argument_signoffs
        WHERE argument_id = ? AND user_id = ?
      `, [argumentId, user_id]);

      res.json({ success: true });
    } catch (error) {
      console.error('Error removing signoff:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // =====================================================
  // Fallacy Management
  // =====================================================

  /**
   * PATCH /api/ttlive/arguments/:argumentId/fallacies/:fallacyId/dismiss
   * Dismiss a detected fallacy
   */
  router.patch('/:argumentId/fallacies/:fallacyId/dismiss', async (req, res) => {
    try {
      const user_id = req.user.user_id;
      const { argumentId, fallacyId } = req.params;
      const { dismissal_reason } = req.body;

      await query(`
        UPDATE ttlive_argument_fallacies
        SET
          is_dismissed = TRUE,
          dismissed_by = ?,
          dismissal_reason = ?,
          dismissed_at = NOW()
        WHERE fallacy_id = ? AND argument_id = ?
      `, [user_id, dismissal_reason || null, fallacyId, argumentId]);

      res.json({ success: true });
    } catch (error) {
      console.error('Error dismissing fallacy:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // =====================================================
  // Export
  // =====================================================

  /**
   * POST /api/ttlive/arguments/:argumentId/export
   * Export argument to social media platform
   */
  router.post('/:argumentId/export', async (req, res) => {
    try {
      const user_id = req.user.user_id;
      const { argumentId } = req.params;
      const { export_platform = 'x' } = req.body;

      // Check if argument is signed off
      const argument = await getArgumentById(query, argumentId);

      if (!argument) {
        return res.status(404).json({ error: 'Argument not found' });
      }

      if (argument.status !== 'signed_off') {
        return res.status(400).json({
          error: 'Can only export signed-off arguments'
        });
      }

      // Generate export format
      const exportFormat = await argumentValidationService.generateExportFormat(
        argument,
        export_platform
      );

      // Update argument with export info
      await query(`
        UPDATE ttlive_staged_arguments
        SET
          export_format = ?,
          is_exported = TRUE,
          exported_to_platform = ?,
          exported_at = NOW()
        WHERE argument_id = ?
      `, [exportFormat, export_platform, argumentId]);

      res.json({
        success: true,
        export_format: exportFormat,
        platform: export_platform
      });
    } catch (error) {
      console.error('Error exporting argument:', error);
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * POST /api/ttlive/arguments/validate
   * Validate argument data without creating it (for live validation in UI)
   */
  router.post('/validate', async (req, res) => {
    try {
      const { claim, reasoning, citations = [] } = req.body;

      if (!claim || !reasoning) {
        return res.status(400).json({ error: 'Missing claim or reasoning' });
      }

      // Create temporary argument object for validation
      const tempArgument = {
        claim,
        reasoning,
        citations
      };

      const validation = await argumentValidationService.validateArgument(tempArgument);

      res.json(validation);
    } catch (error) {
      console.error('Error validating argument:', error);
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * POST /api/ttlive/arguments/:argumentId/validate
   * Re-run validation on argument
   */
  router.post('/:argumentId/validate', async (req, res) => {
    try {
      const { argumentId } = req.params;

      const argument = await getArgumentById(query, argumentId);

      if (!argument) {
        return res.status(404).json({ error: 'Argument not found' });
      }

      const validation = await argumentValidationService.validateArgument(argument);
      await updateArgumentValidation(query, argumentId, validation);

      res.json({ validation });
    } catch (error) {
      console.error('Error validating argument:', error);
      res.status(500).json({ error: error.message });
    }
  });

  return router;
}

// =====================================================
// Helper Functions
// =====================================================

async function getArgumentById(query, argumentId) {
  const argumentsList = await query(`
    SELECT
      sa.*,
      u.username AS author_username,
      u.user_profile_image AS author_avatar
    FROM ttlive_staged_arguments sa
    JOIN users u ON sa.author_user_id = u.user_id
    WHERE sa.argument_id = ?
  `, [argumentId]);

  if (argumentsList.length === 0) {
    return null;
  }

  const argument = argumentsList[0];

  // Fetch citations
  argument.citations = await query(`
    SELECT * FROM ttlive_argument_citations
    WHERE argument_id = ?
    ORDER BY relevance_score DESC
  `, [argumentId]);

  // Fetch fallacies
  argument.detected_fallacies = await query(`
    SELECT * FROM ttlive_argument_fallacies
    WHERE argument_id = ? AND is_dismissed = FALSE
    ORDER BY confidence_score DESC
  `, [argumentId]);

  // Fetch signoffs
  argument.signoffs = await query(`
    SELECT
      asf.*,
      u.username,
      u.user_profile_image AS user_avatar
    FROM ttlive_argument_signoffs asf
    JOIN users u ON asf.user_id = u.user_id
    WHERE asf.argument_id = ?
    ORDER BY asf.signed_at DESC
  `, [argumentId]);

  // Parse JSON fields
  if (argument.flagged_terms && typeof argument.flagged_terms === 'string') {
    argument.flagged_terms = JSON.parse(argument.flagged_terms);
  }

  return argument;
}

async function updateArgumentValidation(query, argumentId, validation) {
  await query(`
    UPDATE ttlive_staged_arguments
    SET
      civility_passed = ?,
      flagged_terms = ?,
      fallacy_check_passed = ?,
      min_citations_met = ?,
      citation_count = ?,
      clarity_score = ?,
      logical_strength_score = ?,
      evidence_support_score = ?,
      overall_quality_score = ?,
      status = CASE
        WHEN ? THEN 'approved'
        WHEN NOT ? OR NOT ? OR NOT ? THEN 'needs_revision'
        ELSE status
      END
    WHERE argument_id = ?
  `, [
    validation.civility_passed,
    JSON.stringify(validation.flagged_terms || []),
    validation.fallacy_check_passed,
    validation.min_citations_met,
    validation.citation_count,
    validation.clarity_score,
    validation.logical_strength_score,
    validation.evidence_support_score,
    validation.overall_quality_score,
    validation.can_approve,
    validation.civility_passed,
    validation.fallacy_check_passed,
    validation.min_citations_met,
    argumentId
  ]);
}
