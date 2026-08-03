import { randomUUID } from "node:crypto";
import { withTransaction } from "../storage/dbTransaction.js";

const HASH = /^[a-f0-9]{64}$/u;

function positive(value, name) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw new TypeError(`${name} must be a positive integer`);
  }
  return number;
}

function bounded(value, name, maximum = 191) {
  const text = String(value || "");
  if (!text || text.length > maximum) throw new TypeError(`${name} is invalid`);
  return text;
}

function hash(value, name) {
  const text = String(value || "").toLowerCase();
  if (!HASH.test(text)) throw new TypeError(`${name} must be a SHA-256 hex digest`);
  return text;
}

/**
 * Atomically claim the one primary semantic execution. Accepted work is
 * reusable; an active claim cannot race; only rejected/provider-failed or
 * stale claims can be replaced.
 */
export async function claimCfxDocumentSemanticExecution({
  pool,
  identity,
  staleAfterMinutes = 10,
} = {}) {
  if (!pool) throw new TypeError("pool is required");
  const token = randomUUID();
  const values = {
    runId: bounded(identity?.runId, "runId"),
    canonicalDocumentId: positive(identity?.canonicalDocumentId, "canonicalDocumentId"),
    selectedTextVersionId: positive(identity?.selectedTextVersionId, "selectedTextVersionId"),
    targetInventoryHash: hash(identity?.targetInventoryHash, "targetInventoryHash"),
    promptHash: hash(identity?.promptHash, "promptHash"),
    schemaHash: hash(identity?.schemaHash, "schemaHash"),
  };
  return withTransaction(async ({ query }) => {
    await query(
      `INSERT INTO cfx_document_semantic_executions
         (run_id,canonical_document_id,selected_text_version_id,
          target_inventory_sha256,prompt_sha256,schema_sha256,
          execution_status,processing_token,processing_started_at,attempt_count)
       VALUES (?,?,?,?,?,?,'claimed',?,NOW(6),1)
       ON DUPLICATE KEY UPDATE
         document_semantic_execution_id=LAST_INSERT_ID(document_semantic_execution_id)`,
      [values.runId, values.canonicalDocumentId, values.selectedTextVersionId,
        values.targetInventoryHash, values.promptHash, values.schemaHash, token],
    );
    const rows = await query(
      `SELECT document_semantic_execution_id,execution_status,processing_token,
              processing_started_at,attempt_count,accepted_targeted_bearing_run_id,
              processing_started_at < DATE_SUB(NOW(6),INTERVAL ? MINUTE) AS is_stale
         FROM cfx_document_semantic_executions
        WHERE run_id=? AND canonical_document_id=? AND selected_text_version_id=?
          AND target_inventory_sha256=? AND prompt_sha256=? AND schema_sha256=?
        FOR UPDATE`,
      [Math.max(1, Number(staleAfterMinutes) || 10), values.runId,
        values.canonicalDocumentId, values.selectedTextVersionId,
        values.targetInventoryHash, values.promptHash, values.schemaHash],
    );
    const row = rows?.[0];
    if (!row) throw new Error("CFX semantic execution claim was not persisted");
    const executionId = Number(row.document_semantic_execution_id);
    if (row.execution_status === "accepted") {
      return {
        status: "reused", executionId, processingToken: null,
        acceptedTargetedBearingRunId: Number(row.accepted_targeted_bearing_run_id) || null,
        attemptCount: Number(row.attempt_count), identity: values,
      };
    }
    if (row.execution_status === "claimed" && row.processing_token !== token && !row.is_stale) {
      return {
        status: "in_progress", executionId, processingToken: null,
        acceptedTargetedBearingRunId: null,
        attemptCount: Number(row.attempt_count), identity: values,
      };
    }
    if (row.processing_token !== token) {
      await query(
        `UPDATE cfx_document_semantic_executions
            SET execution_status='claimed',processing_token=?,
                processing_started_at=NOW(6),attempt_count=attempt_count+1,
                last_error=NULL
          WHERE document_semantic_execution_id=?`,
        [token, executionId],
      );
    }
    return {
      status: "claimed", executionId, processingToken: token,
      acceptedTargetedBearingRunId: null,
      attemptCount: Number(row.attempt_count) + (row.processing_token === token ? 0 : 1),
      identity: values,
    };
  }, { pool });
}

export async function finishCfxDocumentSemanticExecution(query, input) {
  if (typeof query !== "function") throw new TypeError("query is required");
  if (!["accepted", "rejected", "provider_failed"].includes(input?.status)) {
    throw new TypeError("status must be accepted, rejected, or provider_failed");
  }
  const acceptedRunId = input.status === "accepted"
    ? positive(input.acceptedTargetedBearingRunId, "acceptedTargetedBearingRunId")
    : null;
  const result = await query(
    `UPDATE cfx_document_semantic_executions
        SET execution_status=?,accepted_targeted_bearing_run_id=?,
            last_error=?,processing_token=NULL,processing_started_at=NULL
      WHERE document_semantic_execution_id=? AND execution_status='claimed'
        AND processing_token=?`,
    [input.status, acceptedRunId,
      input.error == null ? null : String(input.error).slice(0, 10_000),
      positive(input.executionId, "executionId"), bounded(input.processingToken, "processingToken", 36)],
  );
  if (Number(result?.affectedRows) !== 1) {
    throw new Error("CFX semantic execution claim was lost or already completed");
  }
  return { executionId: Number(input.executionId), status: input.status, acceptedTargetedBearingRunId: acceptedRunId };
}
