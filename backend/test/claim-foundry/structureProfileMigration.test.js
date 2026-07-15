import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const backend = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const migration = path.join(backend, "migrations/2026-07-14-01-cf1-structure-profiles.sql");

test("StructureProfile migration is additive, versioned, and inert", async () => {
  const sql = await readFile(migration, "utf8");
  assert.match(sql, /CREATE TABLE IF NOT EXISTS cf1_structure_profiles/);
  assert.match(sql, /UNIQUE KEY uq_cf1_structure_profile_version \(profile_key, profile_version\)/);
  assert.match(sql, /UNIQUE KEY uq_cf1_structure_profile_hash \(profile_hash\)/);
  assert.match(sql, /scope_json JSON NOT NULL/);
  assert.match(sql, /rules_json JSON NOT NULL/);
  assert.doesNotMatch(sql, /\bINSERT\b|\bUPDATE\b|\bTRIGGER\b/i);
  assert.doesNotMatch(sql, /(?:ALTER|DROP|TRUNCATE|DELETE FROM)\s+(?:content|claims|content_claims|claim_evaluation_targets)\b/i);
});
