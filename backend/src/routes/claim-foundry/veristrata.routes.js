import { Router } from "express";
import { authenticateToken } from "../../middleware/auth.js";
import { cf1ErrorBody, cf1SuccessBody, httpStatusForCf1Error } from "./apiResponse.js";

export default function createVeriStrataShadowRoutes({ runShadow, activateProjection = null,
  activationEnabled = false }) {
  if (typeof runShadow !== "function") throw new TypeError("Shadow routes require runShadow()");
  const router = Router();
  router.post("/api/claim-foundry/run", authenticateToken, async (req, res) => {
    try {
      const result = await runShadow({ contentId: req.body?.contentId,
        idempotencyKey: req.get("idempotency-key"), allowRepair: req.body?.allowRepair,
        includePackageInResponse: req.body?.includePackageInResponse,
        userId: req.user?.user_id, role: req.user?.role });
      if (result.existing) return res.status(result.run.status === "ready_for_evidence" ? 200 : 202)
        .json({ ok: true, existing: true, runId: result.run.run_id,
          packageId: result.run.package_id ?? null, status: result.run.status, mode: "shadow" });
      return res.status(201).json({ ...cf1SuccessBody(result,
        req.body?.includePackageInResponse === true), mode: "shadow", contentId: Number(req.body.contentId) });
    } catch (error) {
      return res.status(httpStatusForCf1Error(error)).json(cf1ErrorBody(error, error.runId));
    }
  });
  if (activateProjection && activationEnabled) router.post("/api/claim-foundry/activate", authenticateToken, async (req, res) => {
    if (req.user?.role !== "super_admin") return res.status(403).json({ ok: false, error: { code: "CF1_ADMIN_REQUIRED" } });
    try {
      const result = await activateProjection({ bindingId: Number(req.body?.bindingId) });
      return res.json({ ok: true, mode: "active", ...result });
    } catch (error) {
      return res.status(httpStatusForCf1Error(error)).json(cf1ErrorBody(error));
    }
  });
  return router;
}
