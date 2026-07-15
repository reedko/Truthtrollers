import test from "node:test";
import assert from "node:assert/strict";
import { runVeriStrataShadow } from "../../src/claim-foundry/veristrata/runShadow.js";

test("shadow run authorizes, loads, and binds without projecting Workspace rows", async () => {
  const events = [];
  let submitted;
  const result = await runVeriStrataShadow({ contentId: 7, userId: 2, role: "user",
    idempotencyKey: "shadow-7" }, {
    query: async () => assert.fail("injected ports should own queries"), consumerKey: "veristrata-test",
    assertContentAccess: async (_query, input) => { events.push(["access", input]); },
    loadArticle: async () => { events.push(["load"]); return { title: "Title",
      text: "Persisted article content long enough for a shadow execution.", authors: [], metadataWarnings: [] }; },
    submit: async (input) => { submitted = input; events.push(["submit"]); return { existing: false }; },
  });
  assert.equal(result.existing, false);
  assert.deepEqual(events.map((event) => event[0]), ["access", "load", "submit"]);
  assert.equal(submitted.bindingContentId, 7);
  assert.equal(submitted.consumerKey, "veristrata-test");
  assert.equal(submitted.options.persist, true);
  assert.equal(JSON.stringify(submitted).includes("content_claims"), false);
});

test("shadow run stops before loading when access is denied", async () => {
  let loads = 0;
  await assert.rejects(runVeriStrataShadow({ contentId: 7, userId: 2 }, {
    query: async () => [], assertContentAccess: async () => { throw new Error("denied"); },
    loadArticle: async () => { loads += 1; }, submit: async () => {},
  }), /denied/);
  assert.equal(loads, 0);
});
