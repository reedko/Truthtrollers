// backend/src/routes/prompts.routes.js
// API endpoints for managing LLM prompts

import { Router } from "express";
import PromptManager from "../core/promptManager.js";

export default function createPromptRoutes({ query }) {
  const router = Router();
  const promptManager = new PromptManager(query);

  /**
   * GET /api/prompts
   * List all prompts (with optional filtering)
   */
  router.get("/api/prompts", async (req, res) => {
    try {
      const { active_only, prompt_name } = req.query;

      let sql = `
        SELECT
          prompt_id,
          prompt_name,
          prompt_type,
          LEFT(prompt_text, 100) as prompt_preview,
          parameters,
          version,
          is_active
        FROM llm_prompts
      `;

      const conditions = [];
      const params = [];

      if (active_only === 'true') {
        conditions.push('is_active = TRUE');
      }

      if (prompt_name) {
        conditions.push('prompt_name = ?');
        params.push(prompt_name);
      }

      if (conditions.length > 0) {
        sql += ' WHERE ' + conditions.join(' AND ');
      }

      sql += ' ORDER BY prompt_name, version DESC';

      const prompts = await query(sql, params);

      return res.json({
        success: true,
        count: prompts.length,
        prompts,
      });
    } catch (err) {
      console.error("❌ GET /api/prompts error:", err);
      return res.status(500).json({
        success: false,
        error: err.message,
      });
    }
  });

  /**
   * GET /api/prompts/:promptName
   * Get a specific prompt (latest active version)
   */
  router.get("/api/prompts/:promptName", async (req, res) => {
    try {
      const { promptName } = req.params;

      const results = await query(
        `SELECT
          prompt_id,
          prompt_name,
          prompt_type,
          prompt_text,
          parameters,
          version,
          is_active
         FROM llm_prompts
         WHERE prompt_name = ?
         ORDER BY version DESC`,
        [promptName]
      );

      if (!results || results.length === 0) {
        return res.status(404).json({
          success: false,
          error: `Prompt not found: ${promptName}`,
        });
      }

      // Return active version first, or latest if none active
      const activePrompt = results.find(p => p.is_active);
      const prompt = activePrompt || results[0];

      return res.json({
        success: true,
        prompt,
        versions: results,
      });
    } catch (err) {
      console.error(`❌ GET /api/prompts/${req.params.promptName} error:`, err);
      return res.status(500).json({
        success: false,
        error: err.message,
      });
    }
  });

  /**
   * POST /api/prompts
   * Create a new prompt or update existing with new version
   * Body: { promptName, promptType, promptText, parameters, isActive }
   */
  router.post("/api/prompts", async (req, res) => {
    try {
      const {
        promptName,
        promptType = 'user',
        promptText,
        parameters = {},
        isActive = true,
      } = req.body;

      if (!promptName || !promptText) {
        return res.status(400).json({
          success: false,
          error: "Missing required fields: promptName, promptText",
        });
      }

      // Check if prompt exists
      const existing = await query(
        'SELECT MAX(version) as maxVersion FROM llm_prompts WHERE prompt_name = ?',
        [promptName]
      );

      const isUpdate = existing[0]?.maxVersion !== null;

      let promptId;
      if (isUpdate) {
        // Update existing (create new version)
        promptId = await promptManager.updatePromptVersion(
          promptName,
          promptText,
          parameters
        );
      } else {
        // Create new
        promptId = await promptManager.savePrompt({
          promptName,
          promptType,
          promptText,
          parameters,
          version: 1,
          isActive,
        });
      }

      return res.json({
        success: true,
        message: isUpdate
          ? `Prompt updated with new version`
          : `Prompt created successfully`,
        promptId,
        promptName,
      });
    } catch (err) {
      console.error("❌ POST /api/prompts error:", err);
      return res.status(500).json({
        success: false,
        error: err.message,
      });
    }
  });

  /**
   * PUT /api/prompts/:promptName/activate/:version
   * Activate a specific version of a prompt (deactivates others)
   */
  router.put("/api/prompts/:promptName/activate/:version", async (req, res) => {
    try {
      const { promptName, version } = req.params;

      // Deactivate all versions
      await query(
        'UPDATE llm_prompts SET is_active = FALSE WHERE prompt_name = ?',
        [promptName]
      );

      // Activate specified version
      const result = await query(
        'UPDATE llm_prompts SET is_active = TRUE WHERE prompt_name = ? AND version = ?',
        [promptName, parseInt(version, 10)]
      );

      if (result.affectedRows === 0) {
        return res.status(404).json({
          success: false,
          error: `Prompt version not found: ${promptName} v${version}`,
        });
      }

      // Clear cache
      promptManager.clearCache();

      return res.json({
        success: true,
        message: `Activated ${promptName} version ${version}`,
      });
    } catch (err) {
      console.error("❌ PUT /api/prompts activate error:", err);
      return res.status(500).json({
        success: false,
        error: err.message,
      });
    }
  });

  /**
   * DELETE /api/prompts/:promptName/version/:version
   * Delete a specific version of a prompt
   */
  router.delete("/api/prompts/:promptName/version/:version", async (req, res) => {
    try {
      const { promptName, version } = req.params;

      // Check if this is the only version
      const versions = await query(
        'SELECT version FROM llm_prompts WHERE prompt_name = ?',
        [promptName]
      );

      if (versions.length === 1) {
        return res.status(400).json({
          success: false,
          error: "Cannot delete the only version of a prompt",
        });
      }

      const result = await query(
        'DELETE FROM llm_prompts WHERE prompt_name = ? AND version = ?',
        [promptName, parseInt(version, 10)]
      );

      if (result.affectedRows === 0) {
        return res.status(404).json({
          success: false,
          error: `Prompt version not found: ${promptName} v${version}`,
        });
      }

      // Clear cache
      promptManager.clearCache();

      return res.json({
        success: true,
        message: `Deleted ${promptName} version ${version}`,
      });
    } catch (err) {
      console.error("❌ DELETE /api/prompts error:", err);
      return res.status(500).json({
        success: false,
        error: err.message,
      });
    }
  });

  /**
   * POST /api/prompts/clear-cache
   * Clear the prompt cache (forces fresh DB load)
   */
  router.post("/api/prompts/clear-cache", async (req, res) => {
    try {
      promptManager.clearCache();

      return res.json({
        success: true,
        message: "Prompt cache cleared",
      });
    } catch (err) {
      console.error("❌ POST /api/prompts/clear-cache error:", err);
      return res.status(500).json({
        success: false,
        error: err.message,
      });
    }
  });

  return router;
}
