import test from "node:test";
import assert from "node:assert/strict";
import { contentClaimReadScope } from "../../src/claim-foundry/veristrata/loadActiveProjection.js";

test("inactive reads exclude every CF1 projection", async () => {
  const scope = await contentClaimReadScope(async () => [], 7);
  assert.equal(scope.sql, "cc.claim_foundry_package_id IS NULL");
  assert.deepEqual(scope.params, []);
});

test("active reads select one package while retaining user-created claims", async () => {
  const scope = await contentClaimReadScope(async () => [{ package_id: "cf1pkg_active" }], 7);
  assert.match(scope.sql, /claim_foundry_package_id = \?/);
  assert.match(scope.sql, /cc\.user_id IS NOT NULL/);
  assert.deepEqual(scope.params, ["cf1pkg_active"]);
});
