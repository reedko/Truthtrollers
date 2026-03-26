// backend/src/routes/evidence-config.routes.js
// API routes for evidence search configuration (super_admin only)

import { Router } from "express";
import { authenticateToken } from "../middleware/auth.js";

export default function createEvidenceConfigRoutes({ query, pool }) {
  const router = Router();

  /**
   * GET /api/evidence-config
   * Get current evidence search mode and configuration
   */
  router.get("/api/evidence-config", authenticateToken, async (req, res) => {
    try {
      const modeRow = await query(
        `SELECT config_value FROM evidence_search_config WHERE config_key = 'search_mode'`
      );

      const configRow = await query(
        `SELECT config_value FROM evidence_search_config WHERE config_key = 'mode_config'`
      );

      const searchMode = modeRow && modeRow.length > 0 ? modeRow[0].config_value : 'fringe_on_support';
      const allConfigs = configRow && configRow.length > 0 ? JSON.parse(configRow[0].config_value) : {};

      console.log(`📊 GET /api/evidence-config - modeRow:`, modeRow);
      console.log(`📊 GET /api/evidence-config - searchMode:`, searchMode);

      res.json({
        currentMode: searchMode,
        modeConfig: allConfigs[searchMode] || {},
        availableModes: allConfigs,
      });
    } catch (err) {
      console.error("❌ Error fetching evidence config:", err);
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * PUT /api/evidence-config/mode
   * Update evidence search mode (super_admin only)
   * Body: { mode: 'high_quality_only' | 'fringe_on_support' | 'balanced_all_claims' }
   */
  router.put("/api/evidence-config/mode", authenticateToken, async (req, res) => {
    try {
      const { mode } = req.body;
      const userId = req.user?.user_id;
      const userRole = req.user?.role;

      console.log(`📝 PUT /api/evidence-config/mode - User: ${userId}, Role: ${userRole}, Mode: ${mode}`);

      // Only super_admin can change this
      if (userRole !== 'super_admin') {
        return res.status(403).json({ error: 'Only super_admin can change evidence search mode' });
      }

      // Validate mode
      const validModes = ['high_quality_only', 'fringe_on_support', 'balanced_all_claims'];
      if (!validModes.includes(mode)) {
        return res.status(400).json({
          error: 'Invalid mode. Must be one of: ' + validModes.join(', ')
        });
      }

      console.log(`🔄 Updating evidence_search_config to: ${mode}`);

      // Update mode
      const updateResult = await query(
        `UPDATE evidence_search_config SET config_value = ?, updated_by = ?, updated_at = NOW() WHERE config_key = 'search_mode'`,
        [mode, userId]
      );

      console.log(`✅ Updated evidence_search_config: ${mode}, affectedRows:`, updateResult[0]?.affectedRows);

      // Verify the update worked
      const verifyRow = await query(
        `SELECT config_value FROM evidence_search_config WHERE config_key = 'search_mode'`
      );
      const verifiedMode = verifyRow && verifyRow.length > 0 ? verifyRow[0].config_value : null;
      console.log(`🔍 Verified mode in database:`, verifiedMode);

      res.json({
        success: true,
        mode: verifiedMode || mode,
        message: `Evidence search mode updated to: ${mode}`,
      });
    } catch (err) {
      console.error("❌ Error updating evidence config:", err);
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
