import { Router } from "express";
import { isPackageId, isRunId } from "../../claim-foundry/ids.js";
import { loadCf1PackageForConsumer } from "../../storage/claimFoundryPackageStore.js";
import { loadCf1RunForConsumer } from "../../storage/claimFoundryRunStore.js";
import { cf1ErrorBody, cf1SuccessBody, httpStatusForCf1Error } from "./apiResponse.js";

function parseJson(value) {
  if (typeof value !== "string") return value;
  try { return JSON.parse(value); } catch { return null; }
}

function existingBody(run) {
  return { ok: true, existing: true, runId: run.run_id, packageId: run.package_id ?? null,
    status: run.status };
}

export default function createCf1PublicRoutes({ auth, submit, query }) {
  if (typeof auth !== "function" || typeof submit !== "function" || typeof query !== "function") {
    throw new TypeError("CF1 routes require auth, submit, and query dependencies");
  }
  const router = Router();
  router.post("/v1/claim-packages", auth, async (req, res) => {
    try {
      const result = await submit({ article: req.body?.article, options: req.body?.options,
        headerIdempotencyKey: req.get("idempotency-key"),
        consumerKey: req.cf1Consumer.consumerKey });
      if (result.existing) return res.status(result.run.status === "ready_for_evidence" ? 200 : 202).json(existingBody(result.run));
      return res.status(201).json(cf1SuccessBody(result, req.body?.options?.includePackageInResponse === true));
    } catch (error) {
      return res.status(httpStatusForCf1Error(error)).json(cf1ErrorBody(error, error.runId));
    }
  });
  router.get("/v1/claim-packages/runs/:runId", auth, async (req, res) => {
    if (!isRunId(req.params.runId)) return res.status(400).json(cf1ErrorBody({ code: "CF1_INVALID_RUN_ID", message: "Invalid run ID" }));
    try {
      const run = await loadCf1RunForConsumer(query, req.params.runId, req.cf1Consumer.consumerKey);
      if (!run) return res.status(404).json(cf1ErrorBody({ code: "CF1_RUN_NOT_FOUND", message: "Run not found", status: 404 }));
      return res.json({ ok: true, run: { runId: run.run_id, status: run.status,
        packageId: run.package_id, error: parseJson(run.error_json), usage: parseJson(run.usage_json),
        artifactPath: run.artifact_root ?? "", createdAt: run.created_at,
        updatedAt: run.updated_at, completedAt: run.completed_at } });
    } catch (error) { return res.status(httpStatusForCf1Error(error)).json(cf1ErrorBody(error)); }
  });
  router.get("/v1/claim-packages/:packageId", auth, async (req, res) => {
    if (!isPackageId(req.params.packageId)) return res.status(400).json(cf1ErrorBody({ code: "CF1_INVALID_PACKAGE_ID", message: "Invalid package ID" }));
    try {
      const loaded = await loadCf1PackageForConsumer(query, req.params.packageId, req.cf1Consumer.consumerKey);
      if (!loaded) return res.status(404).json(cf1ErrorBody({ code: "CF1_PACKAGE_NOT_FOUND", message: "Package not found", status: 404 }));
      return res.json({ ok: true, claimPackage: loaded.claimPackage });
    } catch (error) { return res.status(httpStatusForCf1Error(error)).json(cf1ErrorBody(error)); }
  });
  return router;
}
