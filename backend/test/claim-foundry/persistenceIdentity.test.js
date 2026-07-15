import test from "node:test";
import assert from "node:assert/strict";
import { createCf1OptionsHash, deriveCf1IdempotencyKey,
  semanticCf1Options } from "../../src/storage/claimFoundryIdentity.js";

test("semantic option hashing excludes transport and artifact details", () => {
  const first = createCf1OptionsHash({ model: "fixture", temperature: 0,
    timeoutMs: 1_000, artifactRoot: "/tmp/a" });
  const second = createCf1OptionsHash({ artifactRoot: "/tmp/b", timeoutMs: 9_000,
    temperature: 0, model: "fixture" });
  assert.equal(first, second);
  assert.notEqual(first, createCf1OptionsHash({ model: "other", temperature: 0 }));
  assert.deepEqual(semanticCf1Options({ model: "fixture", timeoutMs: 4 }), { model: "fixture" });
});

test("derived idempotency keys are stable and consumer scoped", () => {
  const input = { consumerKey: "consumer-a", consumerContentRef: "article-7",
    inputHash: "a".repeat(64), optionsHash: "b".repeat(64), pipelineVersion: "cf1.0.0" };
  const key = deriveCf1IdempotencyKey(input);
  assert.match(key, /^[a-f0-9]{64}$/);
  assert.equal(key, deriveCf1IdempotencyKey({ ...input }));
  assert.notEqual(key, deriveCf1IdempotencyKey({ ...input, consumerKey: "consumer-b" }));
});
