// backend/src/routes/extension-settings.routes.js
import { Router } from "express";
import { authenticateToken } from "../middleware/auth.js";
import { requirePermission } from "../middleware/permissions.js";

export default function createExtensionSettingsRoutes({ query, pool }) {
  const router = Router();

  // GET /api/extension-settings - Get all extension settings (public)
  router.get("/api/extension-settings", async (req, res) => {
    try {
      const settings = await query(
        "SELECT setting_key, setting_value, description, updated_at FROM extension_settings"
      );

      // Convert to key-value object
      const settingsObj = {};
      settings.forEach((row) => {
        settingsObj[row.setting_key] = row.setting_value;
      });

      res.json({
        settings: settingsObj,
        raw: settings, // Include raw data with timestamps
      });
    } catch (err) {
      console.error("Error fetching extension settings:", err);
      res.status(500).json({ error: "Failed to fetch settings" });
    }
  });

  // GET /api/extension-settings/:key - Get specific setting (public)
  router.get("/api/extension-settings/:key", async (req, res) => {
    const { key } = req.params;

    try {
      const [setting] = await query(
        "SELECT setting_key, setting_value, description, updated_at FROM extension_settings WHERE setting_key = ?",
        [key]
      );

      if (!setting) {
        return res.status(404).json({ error: "Setting not found" });
      }

      res.json({
        key: setting.setting_key,
        value: setting.setting_value,
        description: setting.description,
        updated_at: setting.updated_at,
      });
    } catch (err) {
      console.error(`Error fetching setting ${key}:`, err);
      res.status(500).json({ error: "Failed to fetch setting" });
    }
  });

  // PUT /api/extension-settings/:key - Update setting (admin only)
  router.put(
    "/api/extension-settings/:key",
    authenticateToken,
    requirePermission("super_admin"),
    async (req, res) => {
      const { key } = req.params;
      const { value } = req.body;
      const userId = req.user?.user_id;

      if (value === undefined || value === null) {
        return res.status(400).json({ error: "Missing value" });
      }

      try {
        // Update the setting
        const result = await query(
          `UPDATE extension_settings
           SET setting_value = ?, updated_by = ?, updated_at = NOW()
           WHERE setting_key = ?`,
          [String(value), userId, key]
        );

        if (result.affectedRows === 0) {
          return res.status(404).json({ error: "Setting not found" });
        }

        // Return updated setting
        const [updated] = await query(
          "SELECT setting_key, setting_value, description, updated_at FROM extension_settings WHERE setting_key = ?",
          [key]
        );

        res.json({
          success: true,
          setting: {
            key: updated.setting_key,
            value: updated.setting_value,
            description: updated.description,
            updated_at: updated.updated_at,
          },
        });
      } catch (err) {
        console.error(`Error updating setting ${key}:`, err);
        res.status(500).json({ error: "Failed to update setting" });
      }
    }
  );

  // POST /api/extension-settings/bulk-update - Update multiple settings (admin only)
  router.post(
    "/api/extension-settings/bulk-update",
    authenticateToken,
    requirePermission("super_admin"),
    async (req, res) => {
      const { settings } = req.body; // { key1: value1, key2: value2, ... }
      const userId = req.user?.user_id;

      if (!settings || typeof settings !== "object") {
        return res.status(400).json({ error: "Missing or invalid settings object" });
      }

      try {
        const updates = Object.entries(settings);
        const results = [];

        for (const [key, value] of updates) {
          const result = await query(
            `UPDATE extension_settings
             SET setting_value = ?, updated_by = ?, updated_at = NOW()
             WHERE setting_key = ?`,
            [String(value), userId, key]
          );

          if (result.affectedRows > 0) {
            const [updated] = await query(
              "SELECT setting_key, setting_value FROM extension_settings WHERE setting_key = ?",
              [key]
            );
            results.push(updated);
          }
        }

        res.json({
          success: true,
          updated: results.length,
          settings: results,
        });
      } catch (err) {
        console.error("Error bulk updating settings:", err);
        res.status(500).json({ error: "Failed to update settings" });
      }
    }
  );

  return router;
}
