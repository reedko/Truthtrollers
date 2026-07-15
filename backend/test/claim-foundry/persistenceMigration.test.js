import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const backend = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const migrationPath = path.join(backend, "migrations/2026-07-13-01-claim-foundry-core.sql");

test("core migration defines replay-safe dedicated CF1 persistence", async () => {
  const sql = await readFile(migrationPath, "utf8");
  for (const table of ["claim_foundry_runs", "claim_foundry_packages",
    "claim_foundry_package_bindings"]) {
    assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  }
  assert.match(sql, /UNIQUE KEY uq_cf1_run_idempotency \(consumer_key, idempotency_key\)/);
  assert.match(sql, /GENERATED ALWAYS AS \(COALESCE\(consumer_content_ref, ''\)\) STORED/);
  assert.match(sql, /ON DELETE SET NULL/);
  assert.match(sql, /SIGNAL SQLSTATE '45000'/);
  assert.match(sql, /DROP TRIGGER IF EXISTS claim_foundry_packages_immutable/);
  assert.match(sql, /information_schema\.REFERENTIAL_CONSTRAINTS/);
  assert.doesNotMatch(sql, /(?:ALTER|DROP|TRUNCATE|DELETE FROM)\s+tm4_/i);
  assert.doesNotMatch(sql, /(?:ALTER|DROP|TRUNCATE|DELETE FROM)\s+(?:claims|content_claims|claim_evaluation_targets)\b/i);
});
