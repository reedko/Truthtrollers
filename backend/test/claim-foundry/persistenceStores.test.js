import test from "node:test";
import assert from "node:assert/strict";
import { createLineageId } from "../../src/claim-foundry/ids.js";
import { createOrLoadCf1Run } from "../../src/storage/claimFoundryRunStore.js";
import { insertCf1Package, loadCf1Package,
  loadReadyCf1Package } from "../../src/storage/claimFoundryPackageStore.js";
import { persistCompletedCf1Run } from "../../src/storage/claimFoundryPersistence.js";
import { createValidPackage } from "./fixtures/packages.js";

test("run creation is idempotent and rejects changed input", async () => {
  let row = null;
  const query = async (sql, values) => {
    if (sql.startsWith("SELECT")) return row ? [row] : [];
    row = { run_id: values[0], consumer_key: values[1], idempotency_key: values[2],
      input_hash: values[3], options_hash: values[4], pipeline_version: values[5], status: "submitted" };
    return { affectedRows: 1 };
  };
  const input = { runId: createValidPackage().runId, consumerKey: "test", idempotencyKey: "once",
    inputHash: "a".repeat(64), optionsHash: "b".repeat(64), pipelineVersion: "cf1.0.0" };
  assert.equal((await createOrLoadCf1Run(query, input)).created, true);
  assert.equal((await createOrLoadCf1Run(query, input)).created, false);
  await assert.rejects(createOrLoadCf1Run(query, { ...input, inputHash: "c".repeat(64) }),
    (error) => error.code === "CF1_IDEMPOTENCY_CONFLICT");
});

test("package store verifies before insert and detects stored tampering", async () => {
  const pkg = createValidPackage();
  let record;
  const query = async (sql, values) => {
    if (sql.startsWith("INSERT")) {
      record = { package_id: values[0], package_hash: values[8], package_json: values[9] };
      return { affectedRows: 1 };
    }
    return record ? [record] : [];
  };
  await insertCf1Package(query, { claimPackage: pkg, lineageId: createLineageId(),
    packageVersion: 1 });
  assert.equal((await loadReadyCf1Package(query, pkg.packageId, pkg.packageHash)).claimPackage.packageId,
    pkg.packageId);
  record.package_json = JSON.stringify({ ...pkg, status: "failed" });
  await assert.rejects(loadCf1Package(query, pkg.packageId),
    (error) => error.code === "CF1_STORED_PACKAGE_HASH_MISMATCH");
});

test("finalization performs package, binding, and run completion in one transaction", async () => {
  const pkg = createValidPackage();
  const statements = [];
  const run = { run_id: pkg.runId, status: "running", input_hash: pkg.article.contentHash,
    pipeline_version: pkg.pipelineVersion };
  const query = async (sql) => {
    statements.push(sql.replace(/\s+/g, " ").trim());
    if (sql.includes("FROM claim_foundry_runs")) return [run];
    if (sql.startsWith("INSERT INTO claim_foundry_package_bindings")) return { insertId: 42 };
    return { affectedRows: 1 };
  };
  let transactions = 0;
  const result = await persistCompletedCf1Run({ claimPackage: pkg, consumerKey: "test",
    consumerContentRef: "article-7", usage: { totalTokens: 150 } }, {
    createLineageId, withTransaction: async (work) => { transactions += 1; return work({ query }); },
  });
  assert.equal(transactions, 1);
  assert.equal(result.bindingId, 42);
  assert.equal(result.packageVersion, 1);
  assert.equal(statements.some((sql) => sql.startsWith("INSERT INTO claim_foundry_packages")), true);
  assert.equal(statements.some((sql) => sql.includes("status = 'ready_for_evidence'")), true);
});

test("supersession locks the head and preserves lineage with the next version", async () => {
  const pkg = createValidPackage();
  pkg.packageVersion = 2;
  pkg.supersedesPackageId = createValidPackage().packageId;
  const { hashPackage } = await import("../../src/claim-foundry/canonicalJson.js");
  pkg.packageHash = hashPackage(pkg);
  const lineageId = createLineageId();
  const priorJson = createValidPackage();
  priorJson.packageId = pkg.supersedesPackageId;
  priorJson.packageHash = hashPackage(priorJson);
  const prior = { package_id: pkg.supersedesPackageId, package_hash: priorJson.packageHash,
    package_json: JSON.stringify(priorJson), lineage_id: lineageId, package_version: 1 };
  const run = { run_id: pkg.runId, status: "running", input_hash: pkg.article.contentHash,
    pipeline_version: pkg.pipelineVersion };
  const query = async (sql) => {
    if (sql.includes("FROM claim_foundry_runs")) return [run];
    if (sql.includes("WHERE package_id =")) return [prior];
    if (sql.includes("WHERE supersedes_package_id")) return [];
    return { insertId: 9, affectedRows: 1 };
  };
  const result = await persistCompletedCf1Run({ claimPackage: pkg, consumerKey: "test",
    supersedesPackageId: prior.package_id }, { withTransaction: (work) => work({ query }) });
  assert.equal(result.lineageId, lineageId);
  assert.equal(result.packageVersion, 2);
});
