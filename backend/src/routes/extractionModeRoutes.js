// Extraction Mode Routes
// Handles getting/setting claim extraction modes for content

const registerExtractionModeRoutes = (app, query) => {
  // Get available extraction modes
  app.get("/api/extraction-modes", async (req, res) => {
    try {
      const [config] = await query(
        `SELECT config_value FROM evidence_search_config WHERE config_key = 'extraction_mode_config'`
      );

      if (!config || !config[0]) {
        return res.json({
          edge: { description: "Thematic extraction with case claim context", default: true },
          ranked: { description: "Material-first extraction", default: false },
          comprehensive: { description: "Cast wide net", default: false }
        });
      }

      const modes = JSON.parse(config[0].config_value);
      res.json(modes);
    } catch (err) {
      console.error("❌ Error fetching extraction modes:", err);
      res.status(500).json({ error: "Failed to fetch extraction modes" });
    }
  });

  // Get current extraction mode for a content
  app.get("/api/content/:contentId/extraction-mode", async (req, res) => {
    const { contentId } = req.params;

    try {
      const [content] = await query(
        `SELECT extraction_mode FROM content WHERE content_id = ?`,
        [contentId]
      );

      if (!content || !content[0]) {
        return res.status(404).json({ error: "Content not found" });
      }

      res.json({
        contentId: parseInt(contentId),
        extractionMode: content[0].extraction_mode || 'edge'
      });
    } catch (err) {
      console.error("❌ Error fetching content extraction mode:", err);
      res.status(500).json({ error: "Failed to fetch extraction mode" });
    }
  });

  // Set extraction mode for a content
  app.put("/api/content/:contentId/extraction-mode", async (req, res) => {
    const { contentId } = req.params;
    const { extractionMode } = req.body;

    // Validate mode
    const validModes = ['edge', 'ranked', 'comprehensive'];
    if (!validModes.includes(extractionMode)) {
      return res.status(400).json({
        error: `Invalid extraction mode. Must be one of: ${validModes.join(', ')}`
      });
    }

    try {
      await query(
        `UPDATE content SET extraction_mode = ? WHERE content_id = ?`,
        [extractionMode, contentId]
      );

      console.log(`✅ Set extraction mode for content ${contentId} to ${extractionMode}`);

      res.json({
        success: true,
        contentId: parseInt(contentId),
        extractionMode
      });
    } catch (err) {
      console.error("❌ Error setting extraction mode:", err);
      res.status(500).json({ error: "Failed to set extraction mode" });
    }
  });

  // Get default extraction mode
  app.get("/api/extraction-mode/default", async (req, res) => {
    try {
      const [config] = await query(
        `SELECT config_value FROM evidence_search_config WHERE config_key = 'extraction_mode'`
      );

      const defaultMode = config && config[0] ? config[0].config_value : 'edge';

      res.json({ defaultMode });
    } catch (err) {
      console.error("❌ Error fetching default extraction mode:", err);
      res.status(500).json({ error: "Failed to fetch default mode" });
    }
  });

  // Set default extraction mode
  app.put("/api/extraction-mode/default", async (req, res) => {
    const { extractionMode } = req.body;

    const validModes = ['edge', 'ranked', 'comprehensive'];
    if (!validModes.includes(extractionMode)) {
      return res.status(400).json({
        error: `Invalid extraction mode. Must be one of: ${validModes.join(', ')}`
      });
    }

    try {
      await query(
        `UPDATE evidence_search_config SET config_value = ? WHERE config_key = 'extraction_mode'`,
        [extractionMode]
      );

      console.log(`✅ Set default extraction mode to ${extractionMode}`);

      res.json({
        success: true,
        defaultMode: extractionMode
      });
    } catch (err) {
      console.error("❌ Error setting default extraction mode:", err);
      res.status(500).json({ error: "Failed to set default mode" });
    }
  });

  // Trigger re-extraction for a content with specific mode
  app.post("/api/content/:contentId/re-extract", async (req, res) => {
    const { contentId } = req.params;
    const { extractionMode, force } = req.body;

    try {
      // Update extraction mode if provided
      if (extractionMode) {
        const validModes = ['edge', 'ranked', 'comprehensive'];
        if (!validModes.includes(extractionMode)) {
          return res.status(400).json({
            error: `Invalid extraction mode. Must be one of: ${validModes.join(', ')}`
          });
        }

        await query(
          `UPDATE content SET extraction_mode = ? WHERE content_id = ?`,
          [extractionMode, contentId]
        );
      }

      // Delete existing claims if force=true
      if (force) {
        await query(`DELETE FROM claims WHERE content_id = ?`, [contentId]);
        console.log(`🗑️ Deleted existing claims for content ${contentId}`);
      }

      // Trigger re-extraction by updating a timestamp
      await query(
        `UPDATE content SET updated_at = NOW() WHERE content_id = ?`,
        [contentId]
      );

      console.log(`✅ Triggered re-extraction for content ${contentId}`);

      res.json({
        success: true,
        message: "Re-extraction triggered. Claims will be extracted using the selected mode.",
        contentId: parseInt(contentId),
        extractionMode: extractionMode || 'current'
      });
    } catch (err) {
      console.error("❌ Error triggering re-extraction:", err);
      res.status(500).json({ error: "Failed to trigger re-extraction" });
    }
  });
};

export default registerExtractionModeRoutes;
