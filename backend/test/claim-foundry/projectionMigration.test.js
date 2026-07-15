import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const path = new URL("../../migrations/2026-07-13-02-claim-foundry-projection.sql", import.meta.url);

test("projection migration is package-scoped and preserves historical rows", async () => {
  const sql = await readFile(path, "utf8");
  for (const column of ["claim_foundry_package_id", "claim_foundry_selected_claim_id",
    "claim_foundry_binding_id", "claim_foundry_target_id", "claim_foundry_card_id",
    "evidence_need_card_json", "projection_scope_key"]) assert.match(sql, new RegExp(column));
  assert.match(sql, /COALESCE\(claim_foundry_package_id, 'legacy'\)/);
  assert.doesNotMatch(sql, /DELETE\s+FROM\s+(?:claims|content_claims|claim_evaluation_targets)/i);
  assert.doesNotMatch(sql, /DROP\s+(?:TABLE|COLUMN)/i);
});
