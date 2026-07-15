import test from "node:test";
import assert from "node:assert/strict";
import { assertVeriStrataContentAccess } from "../../src/claim-foundry/veristrata/contentAccess.js";

test("super admin access does not require an assignment query", async () => {
  let queries = 0;
  assert.equal(await assertVeriStrataContentAccess(async () => { queries += 1; },
    { contentId: 7, userId: 2, role: "super_admin" }), true);
  assert.equal(queries, 0);
});

test("ordinary users require a content_users assignment", async () => {
  assert.equal(await assertVeriStrataContentAccess(async (_sql, values) => {
    assert.deepEqual(values, [7, 2]); return [{ allowed: 1 }];
  }, { contentId: 7, userId: 2, role: "user" }), true);
  await assert.rejects(assertVeriStrataContentAccess(async () => [],
    { contentId: 7, userId: 2, role: "user" }),
  (error) => error.code === "CF1_CONTENT_ACCESS_DENIED");
});
