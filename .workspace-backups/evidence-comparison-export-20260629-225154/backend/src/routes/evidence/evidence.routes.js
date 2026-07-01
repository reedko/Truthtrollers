// backend/src/routes/evidence/evidence.routes.js
import { Router } from "express";

import { runEvidenceEngine } from "../../core/runEvidenceEngine.js";
import { persistAIResults } from "../../storage/persistAIResults.js";
import { logUserActivity } from "../../utils/logUserActivity.js";

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

      // Step 3 — Log user activity for engagement tracking
      await logUserActivity(query, {
        userId: req.user?.user_id || null,
        username: req.user?.username || null,
        activityType: 'evidence_run',
        contentId: taskContentId,
        metadata: {
          claimCount: claimIds.length,
          textLength: readableText?.length || 0,
          referencesFound: (engineOut.aiReferences || []).length
        }
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
