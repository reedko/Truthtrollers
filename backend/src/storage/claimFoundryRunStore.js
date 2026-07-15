import { Cf1Error } from "../claim-foundry/errors.js";

const SELECT_BY_KEY = `SELECT * FROM claim_foundry_runs
  WHERE consumer_key = ? AND idempotency_key = ? LIMIT 1`;

function sameIdentity(row, input) {
  return row.input_hash === input.inputHash && row.options_hash === input.optionsHash
    && row.pipeline_version === input.pipelineVersion;
}

export async function createOrLoadCf1Run(query, input) {
  const existing = (await query(SELECT_BY_KEY, [input.consumerKey, input.idempotencyKey]))[0];
  if (existing) {
    if (!sameIdentity(existing, input)) {
      throw new Cf1Error("CF1_IDEMPOTENCY_CONFLICT", "Idempotency key belongs to different input or options", { status: 409 });
    }
    return { created: false, run: existing };
  }
  try {
    await query(`INSERT INTO claim_foundry_runs
      (run_id, consumer_key, idempotency_key, input_hash, options_hash, pipeline_version, status)
      VALUES (?, ?, ?, ?, ?, ?, 'submitted')`, [input.runId, input.consumerKey,
      input.idempotencyKey, input.inputHash, input.optionsHash, input.pipelineVersion]);
    return { created: true, run: { ...input, status: "submitted" } };
  } catch (error) {
    if (error?.code !== "ER_DUP_ENTRY") throw error;
    const raced = (await query(SELECT_BY_KEY, [input.consumerKey, input.idempotencyKey]))[0];
    if (!raced || !sameIdentity(raced, input)) {
      throw new Cf1Error("CF1_IDEMPOTENCY_CONFLICT", "Concurrent idempotency conflict", { status: 409 });
    }
    return { created: false, run: raced };
  }
}

export async function lockCf1Run(query, runId) {
  return (await query("SELECT * FROM claim_foundry_runs WHERE run_id = ? FOR UPDATE", [runId]))[0] ?? null;
}

export async function loadCf1RunForConsumer(query, runId, consumerKey) {
  return (await query(`SELECT run_id, status, package_id, error_code, error_json, usage_json,
    artifact_root, created_at, updated_at, completed_at FROM claim_foundry_runs
    WHERE run_id = ? AND consumer_key = ? LIMIT 1`, [runId, consumerKey]))[0] ?? null;
}

export async function markCf1RunRunning(query, runId) {
  return query("UPDATE claim_foundry_runs SET status = 'running' WHERE run_id = ? AND status = 'submitted'", [runId]);
}

export async function markCf1RunFailed(query, runId, error) {
  return query(`UPDATE claim_foundry_runs SET status = ?, error_code = ?, error_json = ?,
    completed_at = CURRENT_TIMESTAMP WHERE run_id = ? AND status IN ('submitted','running')`,
  [error.status ?? "failed", error.code, JSON.stringify(error), runId]);
}

export async function completeCf1Run(query, { runId, packageId, usage, artifactRoot = null }) {
  return query(`UPDATE claim_foundry_runs SET status = 'ready_for_evidence', package_id = ?,
    usage_json = ?, artifact_root = ?, completed_at = CURRENT_TIMESTAMP WHERE run_id = ? AND status = 'running'`,
  [packageId, JSON.stringify(usage ?? {}), artifactRoot, runId]);
}
