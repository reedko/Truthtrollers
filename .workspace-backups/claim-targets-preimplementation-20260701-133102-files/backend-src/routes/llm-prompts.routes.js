// backend/src/routes/llm-prompts.routes.js
// API endpoints for managing LLM prompts configuration

import express from 'express';
import logger from '../utils/logger.js';

export default function createLLMPromptsRouter({ query, pool }) {
  const router = express.Router();

/**
 * GET /api/llm-prompts
 * Get all active LLM prompts with their configuration
 */
router.get('/', async (req, res) => {
  try {
    const prompts = await query(`
      SELECT
        prompt_id,
        prompt_name,
        prompt_type,
        max_claims,
        min_sources,
        max_sources,
        version,
        is_active
      FROM llm_prompts
      WHERE is_active = TRUE
      ORDER BY prompt_name, version DESC
    `);

    res.json({ prompts });
  } catch (error) {
    logger.error('[GET /api/llm-prompts] Error:', error);
    res.status(500).json({ error: 'Failed to fetch prompts' });
  }
});

/**
 * GET /api/llm-prompts/:promptName
 * Get a specific prompt by name
 */
router.get('/:promptName', async (req, res) => {
  try {
    const { promptName } = req.params;

    const prompts = await query(`
      SELECT
        prompt_id,
        prompt_name,
        prompt_type,
        prompt_text,
        parameters,
        max_claims,
        min_sources,
        max_sources,
        version,
        is_active
      FROM llm_prompts
      WHERE prompt_name = ? AND is_active = TRUE
      ORDER BY version DESC
      LIMIT 1
    `, [promptName]);

    if (prompts.length === 0) {
      return res.status(404).json({ error: 'Prompt not found' });
    }

    res.json({ prompt: prompts[0] });
  } catch (error) {
    logger.error(`[GET /api/llm-prompts/${req.params.promptName}] Error:`, error);
    res.status(500).json({ error: 'Failed to fetch prompt' });
  }
});

/**
 * PUT /api/llm-prompts/:promptName/config
 * Update max_claims, min_sources, max_sources for a prompt
 */
router.put('/:promptName/config', async (req, res) => {
  try {
    const { promptName } = req.params;
    const { max_claims, min_sources, max_sources } = req.body;

    // Validate inputs
    if (max_claims !== undefined && (max_claims < 1 || max_claims > 100)) {
      return res.status(400).json({ error: 'max_claims must be between 1 and 100' });
    }
    if (min_sources !== undefined && (min_sources < 1 || min_sources > 20)) {
      return res.status(400).json({ error: 'min_sources must be between 1 and 20' });
    }
    if (max_sources !== undefined && (max_sources < 1 || max_sources > 20)) {
      return res.status(400).json({ error: 'max_sources must be between 1 and 20' });
    }

    // Build UPDATE query dynamically
    const updates = [];
    const values = [];

    if (max_claims !== undefined) {
      updates.push('max_claims = ?');
      values.push(max_claims);
    }
    if (min_sources !== undefined) {
      updates.push('min_sources = ?');
      values.push(min_sources);
    }
    if (max_sources !== undefined) {
      updates.push('max_sources = ?');
      values.push(max_sources);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    values.push(promptName);

    await query(`
      UPDATE llm_prompts
      SET ${updates.join(', ')}
      WHERE prompt_name = ? AND is_active = TRUE
    `, values);

    logger.log(`✅ Updated config for prompt: ${promptName}`, { max_claims, min_sources, max_sources });

    // Return updated prompt
    const updated = await query(`
      SELECT
        prompt_id,
        prompt_name,
        max_claims,
        min_sources,
        max_sources
      FROM llm_prompts
      WHERE prompt_name = ? AND is_active = TRUE
      ORDER BY version DESC
      LIMIT 1
    `, [promptName]);

    res.json({
      success: true,
      prompt: updated[0]
    });
  } catch (error) {
    logger.error(`[PUT /api/llm-prompts/${req.params.promptName}/config] Error:`, error);
    res.status(500).json({ error: 'Failed to update prompt config' });
  }
});

  return router;
}
