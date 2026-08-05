// backend/scripts/dev/runCfxLiveQueryPlanningFromMysqlBackedCapture.ts
//
// One-off diagnostic (not wired into any request path, not a permanent
// automated test): persists the fresh live CF1-F03 S1/S2 capture at
//   artifacts/claim-foundry/cfx/CF1-F03/cfx-unit-aware-cf1-f03-20260804070737/
//   artifacts/claim-foundry/cfx/CF1-F03/cfx-substantive-review-cf1-f03-20260804070755/
// into an isolated throwaway MySQL database via the existing production
// persistence contract (withTransaction + persistCfxCaseAssertions), reloads
// via the existing production loadProductionCfxEvidenceInputs, and makes
// exactly one real runCfxQueryPlanning (v2) provider call. Stops before
// retrieval. Drops the isolated database in `finally`. Does not regenerate
// S1/S2, does not repair any proposition, does not modify production code.
//
// Usage: npx tsx scripts/dev/runCfxLiveQueryPlanningFromMysqlBackedCapture.ts

import assert from "node:assert/strict";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import mysql from "mysql2/promise";
import { withTransaction } from "../../src/storage/dbTransaction.js";
import { persistCfxCaseAssertions } from "../../src/services/cfxCaseAssertionPersistence.js";
import { loadProductionCfxEvidenceInputs } from "../../src/services/cfxProductionEvidencePipeline.js";
import {
  loadCfxQueryPlanningPrompt,
  runCfxQueryPlanning,
} from "../../src/claimfoundry/cfx/retrieval/queryPlanning.js";
import { createOpenAiCf7StructuredProvider } from "../../src/claimfoundry/shared/provider/index.js";
import { canonicalHash } from "../../src/claimfoundry/shared/sourceUnits/index.js";
import { cfxQueryPlanningOutputSchema } from "../../src/claimfoundry/cfx/retrieval/schema.js";
import {
  createImmutableDirectory,
  writeImmutableJson,
  writeImmutableText,
  hashArtifactTree,
  aggregateArtifactHash,
  sha256,
} from "../../src/claimfoundry/cfx/artifacts/immutableArtifacts.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(here, "../../..");
dotenv.config({ path: path.join(repositoryRoot, "backend/.env") });

function cfxTimestamp(): string {
  return new Date().toISOString().replace(/\D/g, "").slice(0, 14);
}

function rowQuery(connection: mysql.Connection | mysql.PoolConnection | mysql.Pool) {
  return async (sql: string, values: unknown[] = []) => {
    const [rows] = await connection.query(sql, values);
    return rows as Record<string, unknown>[];
  };
}

// Mirrors the same "arity decides promisify-vs-direct" contract that
// withTransaction (src/storage/dbTransaction.js) already applies to
// pool.getConnection()/connection.query() -- this pool exposes
// zero-arity, already-Promise-returning methods, so withTransaction calls
// them directly rather than promisifying, exactly like the prior
// queryInputMysqlIntegration.test.ts real-MySQL harness.
function productionCompatiblePool(pool: mysql.Pool) {
  return {
    async getConnection() {
      const connection = await pool.getConnection();
      return {
        query: rowQuery(connection),
        beginTransaction: () => connection.beginTransaction(),
        commit: () => connection.commit(),
        rollback: () => connection.rollback(),
        release: () => connection.release(),
      };
    },
  };
}

async function createIsolatedSchema(query: ReturnType<typeof rowQuery>) {
  for (const ddl of [
    `CREATE TABLE content (
      content_id INT NOT NULL AUTO_INCREMENT,
      content_name VARCHAR(1000) NULL,
      media_source VARCHAR(255) NULL,
      url TEXT NULL,
      content_type ENUM('task','reference') NOT NULL DEFAULT 'task',
      topic VARCHAR(255) NULL,
      PRIMARY KEY(content_id)
    ) ENGINE=InnoDB`,
    `CREATE TABLE claims (
      claim_id INT NOT NULL AUTO_INCREMENT,
      claim_text TEXT NOT NULL,
      claim_type ENUM('task','reference','snippet') NOT NULL DEFAULT 'task',
      triage_status VARCHAR(80) NULL,
      triaged_by VARCHAR(80) NULL,
      triage_reasoning TEXT NULL,
      veracity_score DECIMAL(8,4) NULL,
      confidence_level DECIMAL(8,4) NULL,
      last_verified DATETIME NULL,
      PRIMARY KEY(claim_id),
      KEY idx_claim_text(claim_type,claim_text(191))
    ) ENGINE=InnoDB`,
    `CREATE TABLE content_claims (
      cc_id INT NOT NULL AUTO_INCREMENT,
      content_id INT NOT NULL,
      claim_id INT NOT NULL,
      relationship_type VARCHAR(80) NULL,
      claim_role ENUM('pillar','evidence') NULL,
      claim_order INT NULL,
      object_claim_text TEXT NULL,
      speaker_entity VARCHAR(1000) NULL,
      article_stance VARCHAR(80) NULL,
      selected_for_evaluation TINYINT(1) NOT NULL DEFAULT 0,
      evaluation_eligible TINYINT(1) NOT NULL DEFAULT 0,
      search_eligible TINYINT(1) NOT NULL DEFAULT 0,
      verdict_eligible TINYINT(1) NOT NULL DEFAULT 0,
      source_eligible TINYINT(1) NOT NULL DEFAULT 0,
      visibility VARCHAR(80) NULL,
      PRIMARY KEY(cc_id),
      UNIQUE KEY uq_content_claim(content_id,claim_id),
      CONSTRAINT cc_content FOREIGN KEY(content_id) REFERENCES content(content_id),
      CONSTRAINT cc_claim FOREIGN KEY(claim_id) REFERENCES claims(claim_id)
    ) ENGINE=InnoDB`,
    `CREATE TABLE claim_evaluation_targets (
      evaluation_target_id INT NOT NULL AUTO_INCREMENT,
      content_id INT NOT NULL,
      claim_id INT NOT NULL,
      target_type VARCHAR(32) NOT NULL DEFAULT 'assertion',
      target_order INT NOT NULL DEFAULT 0,
      target_text TEXT NULL,
      subject_entity VARCHAR(1000) NULL,
      object_text TEXT NULL,
      source_excerpt LONGTEXT NULL,
      article_stance VARCHAR(80) NULL,
      score_transform VARCHAR(32) NULL,
      search_eligible TINYINT(1) NOT NULL DEFAULT 0,
      verdict_eligible TINYINT(1) NOT NULL DEFAULT 0,
      resolution_status VARCHAR(32) NULL,
      mapping_confidence DECIMAL(5,4) NULL,
      mapping_rationale TEXT NULL,
      source_claim_id VARCHAR(64) NULL,
      target_key VARCHAR(64) NULL,
      population_scope VARCHAR(1000) NULL,
      query_hints_json JSON NULL,
      PRIMARY KEY(evaluation_target_id),
      UNIQUE KEY uq_eval_target(content_id,claim_id,target_order),
      CONSTRAINT cet_content FOREIGN KEY(content_id) REFERENCES content(content_id),
      CONSTRAINT cet_claim FOREIGN KEY(claim_id) REFERENCES claims(claim_id)
    ) ENGINE=InnoDB`,
  ]) await query(ddl);
}

function reshapeExpectedDeterministicQueries(
  queries: { literal: string[]; sourceQualified: string[]; studyLookup: string[] },
  substantiveAssertion: string,
) {
  return {
    literalQuery: queries.literal[0] || substantiveAssertion,
    sourceQualifiedQuery: queries.sourceQualified[0] || null,
    studyLookupQueries: queries.studyLookup,
  };
}

async function main(): Promise<void> {
  const report: Record<string, unknown> = {};

  const s1RunDir = path.join(repositoryRoot, "artifacts/claim-foundry/cfx/CF1-F03/cfx-unit-aware-cf1-f03-20260804070737");
  const s2RunDir = path.join(repositoryRoot, "artifacts/claim-foundry/cfx/CF1-F03/cfx-substantive-review-cf1-f03-20260804070755");
  const s2Review = JSON.parse(await readFile(path.join(s2RunDir, "substantive_review.json"), "utf8")) as {
    schemaVersion: string;
    sourceUnitAwareInventoryHash: string;
    results: Array<{
      propositionId: string;
      substantiveAssertion: string;
      assertionSource: string;
      articleStance: string;
      evidenceSearchHandoff: {
        groundingUnitIds: string[];
        groundingText: string;
        literalIdentifiers: Record<string, string[]>;
        lookupHints: Record<string, string[]>;
        queries: { literal: string[]; sourceQualified: string[]; studyLookup: string[] };
      };
    }>;
  };
  assert.equal(s2Review.results.length, 12, "the fresh S2 capture must contain exactly 12 results");
  report.s1RunDirectory = s1RunDir;
  report.s2RunDirectory = s2RunDir;

  if (!(process.env.OPENAI_API_KEY || process.env.REACT_APP_OPENAI_API_KEY)) {
    throw new Error("OpenAI API key is not configured");
  }

  const database = `cfx_live_qp_v2_${process.pid}_${Date.now()}`;
  assert.match(database, /^cfx_live_qp_v2_[0-9_]+$/u);
  assert.notEqual(database, process.env.DB_DATABASE);
  const admin = await mysql.createConnection({
    host: process.env.DB_HOST || "127.0.0.1",
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
  });
  let pool: mysql.Pool | null = null;
  try {
    await admin.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`);
    pool = mysql.createPool({
      host: process.env.DB_HOST || "127.0.0.1",
      port: Number(process.env.DB_PORT || 3306),
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database,
      connectionLimit: 4,
    });
    await createIsolatedSchema(rowQuery(pool));

    const [taskResult] = await pool.query<mysql.ResultSetHeader>(
      "INSERT INTO content(content_name,url,content_type,topic) VALUES " +
        "('CF1-F03 live S1/S2 capture 20260804070737/20260804070755','https://www.porttownsendfreepress.com/2026/04/12/public-healths-truth-about-vaccines-part-1/','task','Fixture')",
    );
    const taskContentId = taskResult.insertId;

    // ---- PERSISTENCE: existing production persistCfxCaseAssertions, called
    // exactly as runCfxCaseAssertionExtractionStage would, but fed the
    // already-captured S2 results directly (S1/S2 are NOT re-run).
    const persisted = await withTransaction(
      ({ query }: { query: (sql: string, values?: unknown[]) => Promise<unknown[]> }) =>
        persistCfxCaseAssertions({ query, taskContentId, results: s2Review.results }),
      { pool: productionCompatiblePool(pool) },
    ) as { claimIds: number[]; claims: Array<{ propositionId: string; claimId: number; assertion: string }> };

    assert.equal(persisted.claimIds.length, 12, "persistence must produce exactly 12 claimIds");
    report.persistedClaimIds = persisted.claimIds;

    for (const [table, expected] of [["claims", 12], ["content_claims", 12], ["claim_evaluation_targets", 12]] as const) {
      const [[row]] = await pool.query<mysql.RowDataPacket[]>(`SELECT COUNT(*) count FROM ${table}`);
      assert.equal(Number(row!.count), expected, table);
    }
    report.rowCounts = { claims: 12, content_claims: 12, claim_evaluation_targets: 12 };

    const [contentClaimRows] = await pool.query<mysql.RowDataPacket[]>(
      "SELECT claim_id, claim_order FROM content_claims WHERE content_id=? ORDER BY claim_order",
      [taskContentId],
    );
    const [targetRows] = await pool.query<mysql.RowDataPacket[]>(
      "SELECT claim_id, target_order FROM claim_evaluation_targets WHERE content_id=? ORDER BY target_order",
      [taskContentId],
    );
    assert.deepEqual(contentClaimRows.map((r) => r.claim_order), Array.from({ length: 12 }, (_, i) => i));
    assert.deepEqual(targetRows.map((r) => r.target_order), Array.from({ length: 12 }, (_, i) => i));

    // ---- RELOAD: existing production loadProductionCfxEvidenceInputs.
    const reloaded = await loadProductionCfxEvidenceInputs({
      query: rowQuery(pool),
      taskContentId,
      claimIds: persisted.claimIds,
    }) as Array<{
      propositionId: string;
      claimId: number;
      substantiveAssertion: string;
      assertionSource: string;
      articleStance: string;
      groundingUnitIds: string[];
      groundingText: string;
      literalIdentifiers: Record<string, string[]>;
      lookupHints: Record<string, string[]>;
      deterministicQueries: { literalQuery: string | null; sourceQualifiedQuery: string | null; studyLookupQueries: string[] };
    }>;
    assert.equal(reloaded.length, 12, "exactly 12 rows must reload");

    const originalByProposition = new Map(s2Review.results.map((r) => [r.propositionId, r]));
    const reloadedByProposition = new Map(reloaded.map((r) => [r.propositionId, r]));
    assert.deepEqual(
      [...reloadedByProposition.keys()].sort(),
      Array.from({ length: 12 }, (_, i) => `P${String(i + 1).padStart(2, "0")}`),
      "reloaded proposition IDs must be exactly P01..P12",
    );

    const fieldMismatches: string[] = [];
    for (const propositionId of originalByProposition.keys()) {
      const original = originalByProposition.get(propositionId)!;
      const actual = reloadedByProposition.get(propositionId)!;
      const checks: Array<[string, boolean]> = [
        ["substantiveAssertion", actual.substantiveAssertion === original.substantiveAssertion],
        ["assertionSource", actual.assertionSource === original.assertionSource],
        ["articleStance", actual.articleStance === original.articleStance],
        ["groundingText", actual.groundingText === original.evidenceSearchHandoff.groundingText],
        ["groundingUnitIds", JSON.stringify(actual.groundingUnitIds) === JSON.stringify(original.evidenceSearchHandoff.groundingUnitIds)],
        ["literalIdentifiers", JSON.stringify(actual.literalIdentifiers) === JSON.stringify(original.evidenceSearchHandoff.literalIdentifiers)],
        ["lookupHints", JSON.stringify(actual.lookupHints) === JSON.stringify(original.evidenceSearchHandoff.lookupHints)],
        ["deterministicQueries", JSON.stringify(actual.deterministicQueries) === JSON.stringify(
          reshapeExpectedDeterministicQueries(original.evidenceSearchHandoff.queries, original.substantiveAssertion),
        )],
      ];
      for (const [field, ok] of checks) if (!ok) fieldMismatches.push(`${propositionId}.${field}`);
    }
    assert.deepEqual(fieldMismatches, [], `DB reload must preserve every field unchanged: ${fieldMismatches.join(", ")}`);
    report.dbReloadEquivalence = fieldMismatches.length === 0 ? "IDENTICAL" : fieldMismatches;

    // ---- PRE-INVOCATION VERIFICATION (before any provider call).
    const loaderSource = await readFile(
      path.join(repositoryRoot, "backend/src/services/cfxProductionEvidencePipeline.js"),
      "utf8",
    );
    // "No synthetic proposition identity" is proven against the ORIGINAL
    // propositionId<->claimId mapping persistCfxCaseAssertions itself
    // recorded (persisted.claims), not against a `P${claimId}` string
    // heuristic -- with claim_id auto-incrementing 1..12 in a fresh isolated
    // database, `P${claimId}` coincidentally equals the real "P10" for
    // claimId=10, which would make that heuristic a false positive.
    const originalPropositionIdByClaimId = new Map(persisted.claims.map((c) => [c.claimId, c.propositionId]));
    const preInvocation = {
      packetCount: reloaded.length,
      propositionIds: reloaded.map((r) => r.propositionId).sort(),
      allHaveRequiredFields: reloaded.every((r) =>
        typeof r.substantiveAssertion === "string" && r.substantiveAssertion.length > 0
        && typeof r.assertionSource === "string" && r.assertionSource.length > 0
        && typeof r.articleStance === "string"
        && Array.isArray(r.groundingUnitIds) && r.groundingUnitIds.length > 0
        && typeof r.groundingText === "string" && r.groundingText.length > 0
        && r.literalIdentifiers && typeof r.literalIdentifiers === "object"
        && r.lookupHints && typeof r.lookupHints === "object"
        && r.deterministicQueries && typeof r.deterministicQueries === "object"),
      noSyntheticPropositionIds: reloaded.every((r) =>
        r.propositionId === originalPropositionIdByClaimId.get(r.claimId)),
      noSyntheticGroundingUnitIds: reloaded.every((r) => r.groundingUnitIds.every((u) => /^U[0-9]+$/u.test(u))),
      loaderDoesNotCallBuildEvidenceSearchHandoff: !loaderSource.includes("buildCfxEvidenceSearchHandoff"),
    };
    assert.equal(preInvocation.packetCount, 12);
    assert.equal(preInvocation.allHaveRequiredFields, true);
    assert.equal(preInvocation.noSyntheticPropositionIds, true);
    assert.equal(preInvocation.loaderDoesNotCallBuildEvidenceSearchHandoff, true);
    report.preInvocationChecks = preInvocation;

    // ---- LIVE QUERY-PLANNING CALL (exactly one real provider call).
    const runId = `cfx-live-query-planning-v2-from-s1-20260804070737-s2-20260804070755-${cfxTimestamp()}`;
    const outputDirectory = path.join(repositoryRoot, "artifacts/claim-foundry/cfx/CF1-F03", runId);
    await createImmutableDirectory(outputDirectory);
    await writeImmutableJson(path.join(outputDirectory, "provenance.json"), {
      s1RunDirectory: path.relative(repositoryRoot, s1RunDir),
      s2RunDirectory: path.relative(repositoryRoot, s2RunDir),
      isolatedDatabase: database,
      taskContentId,
      persistedClaimIds: persisted.claimIds,
    });
    await writeImmutableJson(path.join(outputDirectory, "evidence_inputs.json"), reloaded);
    await writeImmutableJson(path.join(outputDirectory, "pre_invocation_checks.json"), preInvocation);

    const prompt = await loadCfxQueryPlanningPrompt();
    const sourceEvidenceInputHash = canonicalHash(reloaded);
    let providerCallCount = 0;
    let capturedResponseId: string | null = null;
    let capturedUsage: unknown = null;
    let capturedLatencyMs: number | null = null;

    const planning = await runCfxQueryPlanning({
      inputs: reloaded as any,
      sourceEvidenceInputHash,
      provider: createOpenAiCf7StructuredProvider(),
      prompt,
      async beforeInvoke(request) {
        providerCallCount += 1;
        const requestText = `${JSON.stringify(request, null, 2)}\n`;
        await writeImmutableText(path.join(outputDirectory, "requests/query-planning-model.json"), requestText);
        await writeImmutableText(path.join(outputDirectory, "requests/query-planning-model.sha256"), `${sha256(requestText)}\n`);
      },
      async afterResponse(response) {
        capturedResponseId = response.responseId;
        capturedUsage = response.usage;
        capturedLatencyMs = response.latencyMs;
        const rawText = `${JSON.stringify(response.rawResponse, null, 2)}\n`;
        await writeImmutableText(path.join(outputDirectory, "raw-provider-responses/query-planning-model.json"), rawText);
        await writeImmutableText(path.join(outputDirectory, "raw-provider-responses/query-planning-model.sha256"), `${sha256(rawText)}\n`);
        await writeImmutableJson(path.join(outputDirectory, "response_metadata.json"), {
          responseId: response.responseId,
          requestId: response.requestId,
          usage: response.usage,
          latencyMs: response.latencyMs,
        });
        await writeImmutableJson(path.join(outputDirectory, "parsed_response.json"), response.parsedOutput);
      },
    });

    assert.equal(providerCallCount, 1, "exactly one query-planning provider call must occur");
    report.providerCallCount = providerCallCount;
    report.model = planning.model;
    report.responseId = capturedResponseId;
    report.usage = capturedUsage;
    report.latencyMs = capturedLatencyMs;
    report.requestHash = planning.requestHash;
    report.promptHash = planning.promptHash;
    report.schemaHash = planning.schemaHash;

    // ---- SCHEMA VALIDATION (against the real production zod schema).
    const rawResponseJson = JSON.parse(await readFile(path.join(outputDirectory, "parsed_response.json"), "utf8"));
    const schemaValidation = cfxQueryPlanningOutputSchema.safeParse(rawResponseJson);
    await writeImmutableJson(path.join(outputDirectory, "validation.json"), {
      status: schemaValidation.success ? "PASS" : "FAIL",
      issues: schemaValidation.success ? [] : schemaValidation.error.issues,
    });
    report.schemaValidation = schemaValidation.success ? "PASS" : { status: "FAIL", issues: schemaValidation.error.issues };

    await writeImmutableJson(path.join(outputDirectory, "query-plan.json"), planning.plan);

    const files = await hashArtifactTree(outputDirectory);
    const artifactAggregateSha256 = aggregateArtifactHash(files);
    await writeImmutableJson(path.join(outputDirectory, "artifact-hashes.json"), { files, artifactAggregateSha256 });

    report.artifactDirectory = path.relative(repositoryRoot, outputDirectory);
    report.artifactAggregateSha256 = artifactAggregateSha256;

    // ---- PLAN-LEVEL VALIDATION.
    const plans = (rawResponseJson as { plans: Array<{ propositionId: string; queries: Array<{ queryId: string; queryIntent: string; query: string; provider: string; rationale: string }> }> }).plans;
    report.planCount = plans.length;
    const planPropositionIds = plans.map((p) => p.propositionId);
    report.planPropositionIds = [...planPropositionIds].sort();
    report.duplicatePropositionIds = planPropositionIds.filter((id, i) => planPropositionIds.indexOf(id) !== i);
    report.missingPropositionIds = Array.from({ length: 12 }, (_, i) => `P${String(i + 1).padStart(2, "0")}`)
      .filter((id) => !planPropositionIds.includes(id));
    report.unknownPropositionIds = planPropositionIds.filter((id) => !reloadedByProposition.has(id));

    const queryIdCounts: Record<string, number> = {};
    const intentCounts: Record<string, number> = {};
    const perPlanQueryIdSets: string[][] = [];
    let totalQueryCount = 0;
    for (const plan of plans) {
      const queryIds = plan.queries.map((q) => q.queryId);
      perPlanQueryIdSets.push(queryIds);
      totalQueryCount += plan.queries.length;
      for (const q of plan.queries) {
        queryIdCounts[q.queryId] = (queryIdCounts[q.queryId] || 0) + 1;
        intentCounts[q.queryIntent] = (intentCounts[q.queryIntent] || 0) + 1;
      }
    }
    report.totalQueryCount = totalQueryCount;
    report.queryIdCounts = queryIdCounts;
    report.queryIntentCounts = intentCounts;
    report.everyPlanHasExactlyQ2Q4Q5 = perPlanQueryIdSets.every(
      (ids) => JSON.stringify([...ids].sort()) === JSON.stringify(["Q2", "Q4", "Q5"]),
    );
    report.duplicateQueryIdsWithinAnyPlan = perPlanQueryIdSets.some((ids) => new Set(ids).size !== ids.length);

    // ---- IDENTITY PRESERVATION: merged plan vs reloaded inputs.
    const mergedProps = planning.plan.propositions.map((p: { propositionId: string; canonicalAssertion: string }) => p.propositionId);
    report.mergedPlanPropositionIds = [...mergedProps].sort();
    report.mergedPlanPreservesIdentity = JSON.stringify([...mergedProps].sort()) === JSON.stringify(
      Array.from({ length: 12 }, (_, i) => `P${String(i + 1).padStart(2, "0")}`),
    );
    report.canonicalAssertionUnaltered = planning.plan.propositions.every(
      (p: { propositionId: string; canonicalAssertion: string }) =>
        p.canonicalAssertion === reloadedByProposition.get(p.propositionId)!.substantiveAssertion,
    );

    // ---- SEMANTIC REVIEW DATA (reported, not repaired).
    report.samplePlansForSemanticReview = plans.map((p) => ({
      propositionId: p.propositionId,
      assertionSource: originalByProposition.get(p.propositionId)!.assertionSource,
      queries: p.queries.map((q) => ({ queryId: q.queryId, queryIntent: q.queryIntent, query: q.query, provider: q.provider })),
    }));

    console.log(JSON.stringify(report, null, 2));
  } finally {
    await pool?.end();
    await admin.query(`DROP DATABASE IF EXISTS \`${database}\``);
    await admin.end();
  }
}

main().catch((error) => {
  console.error("[LIVE QUERY-PLANNING RUN] FAILED:", error);
  process.exitCode = 1;
});
