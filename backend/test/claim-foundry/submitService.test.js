import test from "node:test";
import assert from "node:assert/strict";
import { submitCf1Package } from "../../src/routes/claim-foundry/submitService.js";
import { createValidPackage } from "./fixtures/packages.js";

test("submit service creates, runs, and persists a portable package", async () => {
  const pkg = createValidPackage();
  const statements = [];
  const query = async (sql) => {
    statements.push(sql.replace(/\s+/g, " ").trim());
    if (sql.startsWith("SELECT")) return [];
    return { affectedRows: 1 };
  };
  let persisted;
  const result = await submitCf1Package({ article: pkg.article, consumerKey: "consumer-a",
    headerIdempotencyKey: "request-1", options: { includePackageInResponse: true } }, {
    query, createRunId: () => pkg.runId, defaultOptions: { model: "fixture" },
    runClaimFoundry: async ({ dependencies }) => {
      assert.equal(dependencies.createRunId(), pkg.runId);
      return { run: { status: "ready_for_evidence", usage: { totalTokens: 150 } },
        claimPackage: pkg, artifactRefs: { artifactRoot: null } };
    },
    persistCompletedRun: async (input) => { persisted = input; },
  });
  assert.equal(result.claimPackage.packageId, pkg.packageId);
  assert.equal(persisted.consumerKey, "consumer-a");
  assert.equal(statements.some((sql) => sql.includes("status = 'running'")), true);
});

test("submit service returns an idempotent existing run without model work", async () => {
  const pkg = createValidPackage();
  let modelCalls = 0;
  const row = { run_id: pkg.runId, consumer_key: "consumer-a", idempotency_key: "same",
    input_hash: pkg.article.contentHash, options_hash: null, pipeline_version: pkg.pipelineVersion,
    status: "running" };
  const query = async (_sql, values) => {
    row.options_hash ??= values?.[1] === "same" ? row.options_hash : null;
    return [row];
  };
  // Capture the deterministic options hash on the first lookup boundary.
  const proxyQuery = async (sql, values) => {
    if (sql.startsWith("SELECT")) {
      const { createCf1OptionsHash } = await import("../../src/storage/claimFoundryIdentity.js");
      row.options_hash = createCf1OptionsHash({ model: "fixture" });
    }
    return query(sql, values);
  };
  const result = await submitCf1Package({ article: pkg.article, consumerKey: "consumer-a",
    headerIdempotencyKey: "same" }, { query: proxyQuery, defaultOptions: { model: "fixture" },
    runClaimFoundry: async () => { modelCalls += 1; } });
  assert.equal(result.existing, true);
  assert.equal(result.run.run_id, pkg.runId);
  assert.equal(modelCalls, 0);
});

test("body and header idempotency disagreement is rejected before creating a run", async () => {
  const pkg = createValidPackage();
  let queries = 0;
  await assert.rejects(submitCf1Package({ article: pkg.article, consumerKey: "consumer-a",
    headerIdempotencyKey: "header", options: { idempotencyKey: "body" } },
  { query: async () => { queries += 1; } }), (error) => error.code === "CF1_IDEMPOTENCY_CONFLICT");
  assert.equal(queries, 0);
});

test("public consumers cannot override server model or budget configuration", async () => {
  const pkg = createValidPackage();
  await assert.rejects(submitCf1Package({ article: pkg.article, consumerKey: "consumer-a",
    options: { model: "consumer-choice" } }, { query: async () => [] }),
  (error) => error.code === "CF1_INVALID_OPTIONS");
});
