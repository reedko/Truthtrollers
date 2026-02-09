// /backend/src/routes/molecule-views.routes.js
// API routes for managing molecule view tabs and pinned reference cards
import { Router } from "express";

export default function createMoleculeViewsRoutes({ query, pool }) {
  const router = Router();

  /**
   * GET /api/molecule-views/:contentId
   * Get all views for a specific task/content for a user
   * Query params: userId (required)
   */
  router.get(
    "/api/molecule-views/:contentId",
    async (req, res) => {
      const { contentId } = req.params;
      const userId = req.query.userId;

      if (!userId) {
        return res.status(400).json({ error: "userId is required" });
      }

      try {
        console.log(`📋 GET /api/molecule-views/${contentId} for user ${userId}`);

        const views = await query(
          `SELECT
            id,
            user_id,
            content_id,
            name,
            is_default,
            display_mode,
            positions,
            node_settings,
            last_viewed_at,
            created_at,
            updated_at
          FROM molecule_views
          WHERE user_id = ? AND content_id = ?
          ORDER BY
            is_default DESC,
            last_viewed_at DESC,
            created_at DESC`,
          [userId, contentId]
        );

        console.log(`📋 Found ${views.length} views`);

        // For each view, get the pinned references
        for (const view of views) {
          const pins = await query(
            `SELECT
              reference_content_id,
              is_pinned
            FROM molecule_view_pins
            WHERE view_id = ?`,
            [view.id]
          );
          view.pins = pins;
        }

        console.log(`📋 Returning views:`, JSON.stringify(views, null, 2));
        res.json(views);
      } catch (error) {
        console.error("📋 Error fetching molecule views:", error);
        console.error("📋 Error details:", error.message, error.stack);
        res.status(500).json({ error: "Failed to fetch views" });
      }
    }
  );

  /**
   * POST /api/molecule-views
   * Create a new view/tab for a task
   */
  router.post("/api/molecule-views", async (req, res) => {
    const { contentId, name, isDefault = false, displayMode = 'mr_cards', userId } = req.body;

    if (!contentId || !name || !userId) {
      return res.status(400).json({ error: "contentId, name, and userId are required" });
    }

    try {
      // If this should be the default, unset any existing defaults
      if (isDefault) {
        await query(
          `UPDATE molecule_views
          SET is_default = FALSE
          WHERE user_id = ? AND content_id = ?`,
          [userId, contentId]
        );
      }

      const result = await query(
        `INSERT INTO molecule_views (user_id, content_id, name, is_default, display_mode, last_viewed_at)
        VALUES (?, ?, ?, ?, ?, NOW())`,
        [userId, contentId, name, isDefault, displayMode]
      );

      const newView = {
        id: result.insertId,
        user_id: userId,
        content_id: contentId,
        name,
        is_default: isDefault,
        display_mode: displayMode,
        last_viewed_at: new Date(),
        pins: [],
      };

      res.status(201).json(newView);
    } catch (error) {
      console.error("Error creating molecule view:", error);
      if (error.code === "ER_DUP_ENTRY") {
        // If duplicate, just fetch and return the existing view
        console.log("📋 View already exists, fetching existing view");
        try {
          const existingViews = await query(
            `SELECT * FROM molecule_views WHERE user_id = ? AND content_id = ? AND name = ?`,
            [userId, contentId, name]
          );
          if (existingViews.length > 0) {
            const view = existingViews[0];
            view.pins = [];
            return res.status(200).json(view);
          }
        } catch (fetchError) {
          console.error("📋 Error fetching existing view:", fetchError);
        }
        res
          .status(409)
          .json({ error: "A view with this name already exists" });
      } else {
        res.status(500).json({ error: "Failed to create view" });
      }
    }
  });

  /**
   * PUT /api/molecule-views/:viewId
   * Update a view (rename or change default status)
   */
  router.put(
    "/api/molecule-views/:viewId",
    async (req, res) => {
      const { viewId } = req.params;
      const { name, isDefault, userId } = req.body;

      if (!userId) {
        return res.status(400).json({ error: "userId is required" });
      }

      try {
        // Verify ownership
        const view = await query(
          `SELECT * FROM molecule_views WHERE id = ? AND user_id = ?`,
          [viewId, userId]
        );

        if (!view || view.length === 0) {
          return res.status(404).json({ error: "View not found" });
        }

        // If setting as default, unset other defaults for this content
        if (isDefault) {
          await query(
            `UPDATE molecule_views
            SET is_default = FALSE
            WHERE user_id = ? AND content_id = ? AND id != ?`,
            [userId, view[0].content_id, viewId]
          );
        }

        // Update the view
        const updates = [];
        const values = [];

        if (name !== undefined) {
          updates.push("name = ?");
          values.push(name);
        }
        if (isDefault !== undefined) {
          updates.push("is_default = ?");
          values.push(isDefault);
        }
        if (req.body.displayMode !== undefined) {
          updates.push("display_mode = ?");
          values.push(req.body.displayMode);
        }
        if (req.body.positions !== undefined) {
          updates.push("positions = ?");
          values.push(JSON.stringify(req.body.positions));
        }
        if (req.body.nodeSettings !== undefined) {
          updates.push("node_settings = ?");
          values.push(JSON.stringify(req.body.nodeSettings));
        }

        if (updates.length > 0) {
          values.push(viewId, userId);
          await query(
            `UPDATE molecule_views
            SET ${updates.join(", ")}
            WHERE id = ? AND user_id = ?`,
            values
          );
        }

        // Fetch updated view
        const updatedView = await query(
          `SELECT * FROM molecule_views WHERE id = ?`,
          [viewId]
        );

        res.json(updatedView[0]);
      } catch (error) {
        console.error("Error updating molecule view:", error);
        res.status(500).json({ error: "Failed to update view" });
      }
    }
  );

  /**
   * PUT /api/molecule-views/:viewId/positions
   * Update node positions for a view
   */
  router.put(
    "/api/molecule-views/:viewId/positions",
    async (req, res) => {
      const { viewId } = req.params;
      const { positions, userId } = req.body;

      console.log(`💾 PUT /api/molecule-views/${viewId}/positions`, { userId, positionCount: positions ? Object.keys(positions).length : 0 });

      if (!userId) {
        console.error("💾 Missing userId");
        return res.status(400).json({ error: "userId is required" });
      }

      if (!positions || typeof positions !== 'object') {
        console.error("💾 Invalid positions:", typeof positions);
        return res.status(400).json({ error: "positions must be an object" });
      }

      try {
        // Verify ownership
        const view = await query(
          `SELECT * FROM molecule_views WHERE id = ? AND user_id = ?`,
          [viewId, userId]
        );

        console.log(`💾 View lookup result:`, view?.length || 0, "rows");

        if (!view || view.length === 0) {
          console.error(`💾 View not found: viewId=${viewId}, userId=${userId}`);
          return res.status(404).json({ error: "View not found" });
        }

        // Update positions
        console.log(`💾 Updating positions for view ${viewId}...`);
        await query(
          `UPDATE molecule_views SET positions = ? WHERE id = ? AND user_id = ?`,
          [JSON.stringify(positions), viewId, userId]
        );

        console.log(`💾 Successfully updated positions for view ${viewId}`);
        res.json({ success: true, positions });
      } catch (error) {
        console.error("💾 Error updating positions:", error);
        console.error("💾 Error details:", error.message, error.stack);
        res.status(500).json({ error: "Failed to update positions", details: error.message });
      }
    }
  );

  /**
   * DELETE /api/molecule-views/:viewId
   * Delete a view
   * Query params: userId (required)
   */
  router.delete(
    "/api/molecule-views/:viewId",
    async (req, res) => {
      const { viewId } = req.params;
      const userId = req.query.userId;

      if (!userId) {
        return res.status(400).json({ error: "userId is required" });
      }

      try {
        // Verify ownership
        const view = await query(
          `SELECT * FROM molecule_views WHERE id = ? AND user_id = ?`,
          [viewId, userId]
        );

        if (!view || view.length === 0) {
          return res.status(404).json({ error: "View not found" });
        }

        // Delete the view (pins will cascade delete)
        await query(`DELETE FROM molecule_views WHERE id = ?`, [viewId]);

        res.json({ success: true, message: "View deleted" });
      } catch (error) {
        console.error("Error deleting molecule view:", error);
        res.status(500).json({ error: "Failed to delete view" });
      }
    }
  );

  /**
   * POST /api/molecule-views/:viewId/view
   * Mark a view as last viewed (updates last_viewed_at timestamp)
   */
  router.post(
    "/api/molecule-views/:viewId/view",
    async (req, res) => {
      const { viewId } = req.params;
      const { userId } = req.body;

      if (!userId) {
        return res.status(400).json({ error: "userId is required" });
      }

      try {
        // Verify ownership
        const view = await query(
          `SELECT * FROM molecule_views WHERE id = ? AND user_id = ?`,
          [viewId, userId]
        );

        if (!view || view.length === 0) {
          return res.status(404).json({ error: "View not found" });
        }

        // Update last viewed timestamp
        await query(
          `UPDATE molecule_views SET last_viewed_at = NOW() WHERE id = ?`,
          [viewId]
        );

        res.json({ success: true });
      } catch (error) {
        console.error("Error updating last viewed:", error);
        res.status(500).json({ error: "Failed to update last viewed" });
      }
    }
  );

  /**
   * POST /api/molecule-views/:viewId/pins
   * Pin or unpin a reference in a view
   */
  router.post(
    "/api/molecule-views/:viewId/pins",
    async (req, res) => {
      const { viewId } = req.params;
      const { referenceContentId, isPinned, userId } = req.body;

      if (!referenceContentId || isPinned === undefined || !userId) {
        return res
          .status(400)
          .json({ error: "referenceContentId, isPinned, and userId are required" });
      }

      try {
        // Verify ownership of view
        const view = await query(
          `SELECT * FROM molecule_views WHERE id = ? AND user_id = ?`,
          [viewId, userId]
        );

        if (!view || view.length === 0) {
          return res.status(404).json({ error: "View not found" });
        }

        // Upsert the pin status
        await query(
          `INSERT INTO molecule_view_pins (view_id, reference_content_id, is_pinned)
          VALUES (?, ?, ?)
          ON DUPLICATE KEY UPDATE is_pinned = ?`,
          [viewId, referenceContentId, isPinned, isPinned]
        );

        res.json({
          success: true,
          viewId,
          referenceContentId,
          isPinned,
        });
      } catch (error) {
        console.error("Error updating pin status:", error);
        res.status(500).json({ error: "Failed to update pin status" });
      }
    }
  );

  /**
   * POST /api/molecule-views/:viewId/pins/bulk
   * Update multiple pins at once
   */
  router.post(
    "/api/molecule-views/:viewId/pins/bulk",
    async (req, res) => {
      const { viewId } = req.params;
      const { pins, userId } = req.body; // Array of { referenceContentId, isPinned }

      if (!Array.isArray(pins) || !userId) {
        return res
          .status(400)
          .json({ error: "pins must be an array of pin objects and userId is required" });
      }

      try {
        // Verify ownership of view
        const view = await query(
          `SELECT * FROM molecule_views WHERE id = ? AND user_id = ?`,
          [viewId, userId]
        );

        if (!view || view.length === 0) {
          return res.status(404).json({ error: "View not found" });
        }

        // Update all pins
        for (const pin of pins) {
          await query(
            `INSERT INTO molecule_view_pins (view_id, reference_content_id, is_pinned)
            VALUES (?, ?, ?)
            ON DUPLICATE KEY UPDATE is_pinned = ?`,
            [viewId, pin.referenceContentId, pin.isPinned, pin.isPinned]
          );
        }

        res.json({ success: true, updated: pins.length });
      } catch (error) {
        console.error("Error bulk updating pins:", error);
        res.status(500).json({ error: "Failed to update pins" });
      }
    }
  );

  return router;
}
