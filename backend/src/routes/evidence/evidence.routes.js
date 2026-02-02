// backend/src/routes/evidence/evidence.routes.js
import { Router } from "express";

import { runEvidenceEngine } from "../../core/runEvidenceEngine.js";
import { persistAIResults } from "../../storage/persistAIResults.js";

export default function createEvidenceRoutes({ query, pool }) {
  const router = Router();

  /**
   * POST /api/run-evidence
   * Body:
   *   { taskContentId, claimIds, readableText }
   */
  router.post("/api/run-evidence", async (req, res) => {
    try {
      const { taskContentId, claimIds, readableText } = req.body;

      if (!taskContentId || !Array.isArray(claimIds)) {
        return res.status(400).json({
          success: false,
          error: "Missing taskContentId or claimIds",
        });
      }

      // Step 1 — AI evidence
      const engineOut = await runEvidenceEngine({
        taskContentId,
        claimIds,
        readableText,
      });

      // Step 2 — Persist AI refs + evidence
      await persistAIResults(query, {
        contentId: taskContentId,
        evidenceRefs: engineOut.aiReferences || [],
        claimIds: claimIds || [],
        claimConfidenceMap: engineOut.claimConfidenceMap || new Map(),
      });

      return res.json({
        success: true,
        ...engineOut,
      });
    } catch (err) {
      console.error("❌ /api/run-evidence:", err);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  return router;
}
