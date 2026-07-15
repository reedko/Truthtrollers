import test from "node:test";
import assert from "node:assert/strict";
import { createCf1Runtime } from "../../src/routes/claim-foundry/runtime.js";

test("runtime requires explicit model and consumer configuration", () => {
  assert.throws(() => createCf1Runtime({ query: async () => {}, pool: {}, environment: {} }),
    /CF1_MODEL is required/);
  assert.throws(() => createCf1Runtime({ query: async () => {}, pool: {}, environment: {
    CF1_MODEL: "configured", OPENAI_API_KEY: "test-key",
  } }), /consumer key/);
});

test("runtime composes the repository LLM convention into CF1", async () => {
  let received;
  const runtime = createCf1Runtime({ query: async () => {}, pool: {}, environment: {
    CF1_MODEL: "configured", CF1_CONSUMER_KEYS_JSON: '{"secret":"consumer"}',
  }, llm: { generate: async (request) => { received = request; return {
    output: { ready: true }, usage: { total_tokens: 9 }, model: request.model,
  }; } } });
  const response = await runtime.runnerDependencies.modelRunner.invokeStructured({
    system: "system", user: "user", responseSchema: { type: "object" },
    model: "configured", temperature: 0, timeoutMs: 1_000, maxOutputTokens: 200,
  });
  assert.deepEqual(response.output, { ready: true });
  assert.equal(response.usage.totalTokens, 9);
  assert.equal(received.model, "configured");
  assert.equal(received.maxRetries, 1);
  assert.equal(received.returnMetadata, true);
});
