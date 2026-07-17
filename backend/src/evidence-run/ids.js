import { createHash } from "node:crypto";
import { ER1_ID_PREFIXES } from "./contract.js";

function stableId(prefix, parts) {
  const digest = createHash("sha256").update(parts.map(String).join("\u001f")).digest("hex");
  return `${prefix}${digest.slice(0, 24)}`;
}

export const er1RunId = (packageId, idempotencyKey) =>
  stableId(ER1_ID_PREFIXES.run, [packageId, idempotencyKey]);

export const er1TaskId = (packageId, selectedClaimId) =>
  stableId(ER1_ID_PREFIXES.task, [packageId, selectedClaimId]);

export const er1IdentityTaskId = (packageId, identityBundleId) =>
  stableId("er1ident_", [packageId, identityBundleId]);

export const er1LaneId = (taskId, laneType, identity, evidenceRole = "any") =>
  stableId("er1lane_", [taskId, laneType, identity, evidenceRole]);

export const er1CandidateId = (runId, dedupeKey) =>
  stableId(ER1_ID_PREFIXES.candidate, [runId, dedupeKey]);
