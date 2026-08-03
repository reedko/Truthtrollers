import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  claimCfxDocumentSemanticExecution,
  finishCfxDocumentSemanticExecution,
} from "../../../src/services/cfxDocumentSemanticExecutionStore.js";

const identity = {
  runId: "run-phase3",
  canonicalDocumentId: 80,
  selectedTextVersionId: 40,
  targetInventoryHash: "a".repeat(64),
  promptHash: "b".repeat(64),
  schemaHash: "c".repeat(64),
};

function executionDatabase() {
  let state:any = null;
  const query = async (sql:string, values:unknown[] = []) => {
    if (sql.startsWith("INSERT INTO cfx_document_semantic_executions")) {
      if (!state) state = {
        document_semantic_execution_id: 1, execution_status: "claimed",
        processing_token: values[6], processing_started_at: new Date(),
        attempt_count: 1, accepted_targeted_bearing_run_id: null, is_stale: 0,
      };
      return {insertId:1,affectedRows:1};
    }
    if (sql.includes("FROM cfx_document_semantic_executions") && sql.includes("FOR UPDATE")) {
      return [{...state}];
    }
    if (sql.startsWith("UPDATE cfx_document_semantic_executions") && sql.includes("attempt_count=attempt_count+1")) {
      state.execution_status = "claimed";
      state.processing_token = values[0];
      state.attempt_count += 1;
      state.is_stale = 0;
      return {affectedRows:1};
    }
    if (sql.startsWith("UPDATE cfx_document_semantic_executions")) {
      if (state.execution_status !== "claimed" || state.processing_token !== values[4]) {
        return {affectedRows:0};
      }
      state.execution_status = values[0];
      state.accepted_targeted_bearing_run_id = values[1];
      state.processing_token = null;
      return {affectedRows:1};
    }
    throw new Error(`unexpected SQL ${sql}`);
  };
  const connection = {
    query, async beginTransaction() {}, async commit() {}, async rollback() {}, release() {},
  };
  return { query, pool:{async getConnection() { return connection; }}, get state() { return state; } };
}

test("governed execution identity permits one active call and reuses one accepted result", async () => {
  const database = executionDatabase();
  const first = await claimCfxDocumentSemanticExecution({pool:database.pool,identity});
  assert.equal(first.status, "claimed");
  const racing = await claimCfxDocumentSemanticExecution({pool:database.pool,identity});
  assert.equal(racing.status, "in_progress");
  assert.equal(racing.executionId, first.executionId);
  await finishCfxDocumentSemanticExecution(database.query, {
    executionId:first.executionId,processingToken:first.processingToken!,
    status:"accepted",acceptedTargetedBearingRunId:50,
  });
  const reused = await claimCfxDocumentSemanticExecution({pool:database.pool,identity});
  assert.equal(reused.status, "reused");
  assert.equal(reused.acceptedTargetedBearingRunId, 50);
  assert.equal(database.state.attempt_count, 1);
});

test("a rejected attempt may be replaced without creating a second execution identity", async () => {
  const database = executionDatabase();
  const first = await claimCfxDocumentSemanticExecution({pool:database.pool,identity});
  await finishCfxDocumentSemanticExecution(database.query, {
    executionId:first.executionId,processingToken:first.processingToken!,status:"rejected",
  });
  const replacement = await claimCfxDocumentSemanticExecution({pool:database.pool,identity});
  assert.equal(replacement.status, "claimed");
  assert.equal(replacement.executionId, first.executionId);
  assert.equal(replacement.attemptCount, 2);
});

test("CFX-bound scrape exits before legacy reference semantics while unbound route code remains", async () => {
  const source = await readFile(new URL("../../../src/routes/content/content.scrape.routes.js", import.meta.url), "utf8");
  const boundStart = source.indexOf("if (evidenceBinding) {");
  const boundReturn = source.indexOf("acquisitionOnly: true", boundStart);
  const legacyReferenceExtraction = source.indexOf("refClaims = await processTaskClaims", boundReturn);
  const legacyMatcher = source.indexOf("const claimMatches = await matchClaimsToTaskClaims", legacyReferenceExtraction);
  assert.ok(boundStart >= 0 && boundReturn > boundStart);
  assert.ok(legacyReferenceExtraction > boundReturn);
  assert.ok(legacyMatcher > legacyReferenceExtraction);
});

test("production CFX defaults to the document processor and retains the one-target primitive only by explicit import", async () => {
  const source = await readFile(new URL("../../../src/services/cfxProductionEvidencePipeline.js", import.meta.url), "utf8");
  assert.match(source, /bearingProcessor = processCfxDocumentEvidenceBinding/u);
  assert.doesNotMatch(source, /bearingProcessor = processCfxEvidenceBinding/u);
  assert.doesNotMatch(source, /processTaskClaims|matchClaimsToTaskClaims|extractQuotesAndScoreQuality/u);
  const coordinator = await readFile(new URL("../../../src/services/cfxEvidenceCoordinator.js", import.meta.url), "utf8");
  assert.match(coordinator, /export async function processCfxEvidenceBinding/u);
  assert.match(coordinator, /export async function processCfxDocumentEvidenceBinding/u);
  assert.doesNotMatch(coordinator, /processTaskClaims|matchClaimsToTaskClaims|extractQuotesAndScoreQuality/u);
});

test("CFX evidence route and legacy task-scrape route remain distinct execution modes", async () => {
  const evidenceRoute = await readFile(new URL("../../../src/routes/evidence/evidence.routes.js", import.meta.url), "utf8");
  assert.match(evidenceRoute, /legacyEnabled = process\.env\.CFX_LEGACY_EVIDENCE_ENABLED === "true"/u);
  assert.match(evidenceRoute, /engineOut = await runCfxProductionEvidencePipeline/u);

  const scrapeRoute = await readFile(new URL("../../../src/routes/content/content.scrape.routes.js", import.meta.url), "utf8");
  assert.match(scrapeRoute, /claimType: "reference"/u);
  assert.match(scrapeRoute, /matchClaimsToTaskClaims\(\{/u);
  assert.match(scrapeRoute, /if \(evidenceBinding\) \{/u);
  assert.match(scrapeRoute, /acquisitionOnly: true/u);
});

test("Phase 3 migration enforces the complete governed execution identity", async () => {
  const migration = await readFile(new URL("../../../migrations/2026-08-01-02-cfx-phase3-semantic-execution.sql", import.meta.url), "utf8");
  assert.match(migration, /UNIQUE KEY uq_cfx_document_semantic_identity\s*\(run_id,canonical_document_id,selected_text_version_id,\s*target_inventory_sha256,prompt_sha256,schema_sha256\)/u);
  assert.match(migration, /accepted_targeted_bearing_run_id/u);
});
