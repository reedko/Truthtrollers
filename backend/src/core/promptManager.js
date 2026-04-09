// backend/src/core/promptManager.js
// Manages LLM prompts stored in the database

import logger from "../utils/logger.js";

/**
 * Prompt cache to avoid hitting DB on every request
 */
const promptCache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

class PromptManager {
  constructor(query) {
    this.query = query;
  }

  /**
   * Get a prompt by name from database
   * @param {string} promptName - e.g., 'claim_extraction_ranked'
   * @param {object} fallback - Fallback prompt if DB fetch fails
   * @returns {Promise<{system: string, user: string, parameters: object}>}
   */
  async getPrompt(promptName, fallback = null) {
    try {
      // Check cache first
      const cached = promptCache.get(promptName);
      if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
        logger.log(`📋 [PromptManager] Using cached prompt: ${promptName}`);
        return cached.prompt;
      }

      // Fetch from database
      const results = await this.query(
        `SELECT prompt_type, prompt_text, parameters, max_claims, min_sources, max_sources
         FROM llm_prompts
         WHERE prompt_name = ? AND is_active = TRUE
         ORDER BY version DESC
         LIMIT 1`,
        [promptName]
      );

      if (!results || results.length === 0) {
        logger.warn(`⚠️ [PromptManager] No active prompt found: ${promptName}`);
        if (fallback) {
          logger.log(`📋 [PromptManager] Using fallback prompt`);
          return fallback;
        }
        throw new Error(`No prompt found for: ${promptName}`);
      }

      const row = results[0];

      // Parse parameters safely - always create a new object to avoid immutability issues
      let parsedParams = {};
      try {
        if (typeof row.parameters === 'string') {
          parsedParams = JSON.parse(row.parameters);
        } else if (typeof row.parameters === 'object' && row.parameters !== null) {
          parsedParams = row.parameters;
        }
      } catch (err) {
        logger.warn(`⚠️ [PromptManager] Failed to parse parameters for ${promptName}:`, err.message);
      }

      // Create a new mutable object with all parameters
      const parameters = {
        ...parsedParams,
        // Include max_claims and source limits from table columns if they exist
        ...(row.max_claims !== null && row.max_claims !== undefined && { max_claims: row.max_claims }),
        ...(row.min_sources !== null && row.min_sources !== undefined && { min_sources: row.min_sources }),
        ...(row.max_sources !== null && row.max_sources !== undefined && { max_sources: row.max_sources }),
      };

      let prompt;
      if (row.prompt_type === 'combined') {
        // Combined prompt has both system and user in one text field
        // Expected format: "SYSTEM:\n<system text>\n\nUSER:\n<user text>"
        const parts = row.prompt_text.split(/\n\s*USER:\s*\n/);
        const systemPart = parts[0]?.replace(/^SYSTEM:\s*\n/, '') || '';
        const userPart = parts[1] || '';

        prompt = {
          system: systemPart.trim(),
          user: userPart.trim(),
          parameters,
        };
      } else if (row.prompt_type === 'system') {
        prompt = {
          system: row.prompt_text,
          user: '',
          parameters,
        };
      } else if (row.prompt_type === 'user') {
        prompt = {
          system: '',
          user: row.prompt_text,
          parameters,
        };
      } else {
        throw new Error(`Unknown prompt_type: ${row.prompt_type}`);
      }

      // Cache it
      promptCache.set(promptName, {
        prompt,
        timestamp: Date.now(),
      });

      logger.log(`✅ [PromptManager] Loaded prompt from DB: ${promptName} (v${row.version || '?'})`);
      return prompt;

    } catch (err) {
      logger.error(`❌ [PromptManager] Error loading prompt ${promptName}:`, err.message);
      if (fallback) {
        logger.log(`📋 [PromptManager] Using fallback prompt due to error`);
        return fallback;
      }
      throw err;
    }
  }

  /**
   * Clear prompt cache (useful for testing or manual refresh)
   */
  clearCache() {
    promptCache.clear();
    logger.log(`🗑️ [PromptManager] Cleared prompt cache`);
  }

  /**
   * Insert or update a prompt in the database
   */
  async savePrompt({
    promptName,
    promptType,
    promptText,
    parameters = {},
    version = 1,
    isActive = true,
  }) {
    try {
      // Get max prompt_id
      const maxIdResult = await this.query(
        'SELECT COALESCE(MAX(prompt_id), 0) as maxId FROM llm_prompts'
      );
      const nextId = (maxIdResult[0]?.maxId || 0) + 1;

      await this.query(
        `INSERT INTO llm_prompts
         (prompt_id, prompt_name, prompt_type, prompt_text, parameters, version, is_active)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          nextId,
          promptName,
          promptType,
          promptText,
          JSON.stringify(parameters),
          version,
          isActive,
        ]
      );

      // Clear cache for this prompt
      promptCache.delete(promptName);

      logger.log(`✅ [PromptManager] Saved prompt: ${promptName} (v${version})`);
      return nextId;
    } catch (err) {
      logger.error(`❌ [PromptManager] Error saving prompt:`, err.message);
      throw err;
    }
  }

  /**
   * Deactivate old versions and activate a new one
   */
  async updatePromptVersion(promptName, newPromptText, newParameters = {}) {
    try {
      // Deactivate all previous versions
      await this.query(
        `UPDATE llm_prompts SET is_active = FALSE WHERE prompt_name = ?`,
        [promptName]
      );

      // Get the max version for this prompt
      const versionResult = await this.query(
        `SELECT COALESCE(MAX(version), 0) as maxVersion
         FROM llm_prompts
         WHERE prompt_name = ?`,
        [promptName]
      );
      const nextVersion = (versionResult[0]?.maxVersion || 0) + 1;

      // Get the prompt_type from the most recent version
      const typeResult = await this.query(
        `SELECT prompt_type FROM llm_prompts WHERE prompt_name = ? LIMIT 1`,
        [promptName]
      );
      const promptType = typeResult[0]?.prompt_type || 'combined';

      // Insert new version
      return await this.savePrompt({
        promptName,
        promptType,
        promptText: newPromptText,
        parameters: newParameters,
        version: nextVersion,
        isActive: true,
      });
    } catch (err) {
      logger.error(`❌ [PromptManager] Error updating prompt version:`, err.message);
      throw err;
    }
  }
}

export default PromptManager;
