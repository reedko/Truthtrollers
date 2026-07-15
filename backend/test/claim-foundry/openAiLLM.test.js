import test from "node:test";
import assert from "node:assert/strict";
import { openAiLLM } from "../../src/core/openAiLLM.js";

function providerResponse(content = '{"ready":true}') {
  return { ok: true, text: async () => JSON.stringify({ model: "returned-model",
    choices: [{ message: { content } }],
    usage: { prompt_tokens: 7, completion_tokens: 3, total_tokens: 10 } }) };
}

test("repository LLM preserves legacy object returns", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => providerResponse();
  try {
    assert.deepEqual(await openAiLLM.generate({ system: "s", user: "u",
      schemaHint: "{}", maxRetries: 1 }), { ready: true });
  } finally { globalThis.fetch = originalFetch; }
});

test("repository LLM optionally returns CF1 metadata and honors server controls", async () => {
  const originalFetch = globalThis.fetch;
  let body;
  globalThis.fetch = async (_url, request) => {
    body = JSON.parse(request.body);
    return providerResponse();
  };
  try {
    const result = await openAiLLM.generate({ system: "s", user: "u", schemaHint: "{}",
      model: "configured-model", maxOutputTokens: 321, maxRetries: 1,
      returnMetadata: true });
    assert.deepEqual(result.output, { ready: true });
    assert.equal(result.usage.total_tokens, 10);
    assert.equal(result.model, "returned-model");
    assert.equal(body.model, "configured-model");
    assert.equal(body.max_tokens, 321);
    assert.deepEqual(body.response_format, { type: "json_object" });
  } finally { globalThis.fetch = originalFetch; }
});

test("repository LLM uses schema enforcement only when a caller supplies a named schema", async () => {
  const originalFetch = globalThis.fetch;
  let body;
  globalThis.fetch = async (_url, request) => { body = JSON.parse(request.body); return providerResponse(); };
  const jsonSchema = { name: "draft", strict: true, schema: { type: "object" } };
  try {
    await openAiLLM.generate({ system: "s", user: "u", schemaHint: "{}",
      jsonSchema, maxRetries: 1 });
    assert.deepEqual(body.response_format, { type: "json_schema", json_schema: jsonSchema });
  } finally { globalThis.fetch = originalFetch; }
});
