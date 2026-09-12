import { Router } from "express";
import { authenticateToken } from "../../../middleware/auth.js";
import { createTraceSupportService, traceSupportEnabled } from "./traceSupportService.js";

function idsFrom(req) {
  const body = req.body || {};
  return {
    evidenceClaimId: Number(req.params.claimId),
    parentReferenceContentId: Number(body.parentReferenceContentId || req.query.parentReferenceContentId),
    rootContentId: Number(body.rootContentId || req.query.rootContentId),
  };
}

function valid(ids) {
  return Object.values(ids).every((value) => Number.isInteger(value) && value > 0);
}

export default function createTraceSupportRoutes({ query }) {
  const router = Router();
  const service = createTraceSupportService();

  router.get("/api/trace-support/status", authenticateToken, (_req, res) => {
    res.json({ enabled: traceSupportEnabled() });
  });

  router.get("/api/reference-claims/:claimId/trace-support", authenticateToken, async (req, res) => {
    if (!traceSupportEnabled()) return res.status(404).json({ error: "Trace Support is disabled" });
    const ids = idsFrom(req);
    if (!valid(ids)) return res.status(400).json({ error: "Valid root, parent reference, and claim IDs are required" });
    try {
      const sources = await service.get(query, ids);
      return res.json({ status: sources?.[0]?.resolutionStatus || "not_run", sources: sources || [] });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  });

  router.post("/api/reference-claims/:claimId/trace-support", authenticateToken, async (req, res) => {
    if (!traceSupportEnabled()) return res.status(404).json({ error: "Trace Support is disabled" });
    const ids = idsFrom(req);
    if (!valid(ids)) return res.status(400).json({ error: "Valid root, parent reference, and claim IDs are required" });
    try {
      const sources = await service.run(query, {
        ...ids, userId: req.user?.user_id || null, force: Boolean(req.body?.force),
      });
      return res.json({ status: sources?.[0]?.resolutionStatus || "not_run", sources: sources || [] });
    } catch (error) {
      return res.status(error.statusCode || 500).json({ error: error.message });
    }
  });

  return router;
}
