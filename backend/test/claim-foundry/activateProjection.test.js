import test from "node:test";
import assert from "node:assert/strict";
import { activateCf1Projection } from "../../src/claim-foundry/veristrata/activateProjection.js";

function harness({ activeBindingId = 4 } = {}) {
  const calls = [];
  const query = async (sql, values) => {
    calls.push({ sql, values });
    if (sql.includes("SELECT binding_id, package_id")) return activeBindingId
      ? [{ binding_id: activeBindingId, package_id: "cf1pkg_old" }] : [];
    return { affectedRows: 1 };
  };
  return { calls, dependencies: {
    withTransaction: (work) => work({ query }),
    lockTarget: async () => ({ binding_id: 8, package_id: "cf1pkg_new", content_id: 12,
      consumer_key: "veristrata", projection_status: "projected" }),
  } };
}

test("activation switches one content atomically and reports rollback identity", async () => {
  const { calls, dependencies } = harness();
  const result = await activateCf1Projection({ bindingId: 8 }, dependencies);
  assert.equal(result.previousBindingId, 4);
  assert.equal(result.packageId, "cf1pkg_new");
  assert.equal(calls.filter(({ sql }) => sql.includes("UPDATE claim_foundry_package_bindings")).length, 2);
});

test("activating the current binding is idempotent", async () => {
  const { calls, dependencies } = harness({ activeBindingId: 8 });
  const result = await activateCf1Projection({ bindingId: 8 }, dependencies);
  assert.equal(result.alreadyActive, true);
  assert.equal(calls.some(({ sql }) => sql.trimStart().startsWith("UPDATE")), false);
});
