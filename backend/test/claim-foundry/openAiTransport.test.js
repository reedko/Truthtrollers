import test from "node:test";
import assert from "node:assert/strict";
import { createOpenAiCf1Transport } from "../../src/claim-foundry/openAiTransport.js";

test("CF1 adapter maps its structured request to the repository LLM port", async () => {
  let received;
  const transport = createOpenAiCf1Transport({ llm: { generate: async (request) => {
    received = request;
    return { output: { claims: [] }, usage: { total_tokens: 12 }, model: request.model };
  } } });
  const response = await transport.invoke({ system: "system", user: "user",
    responseSchema: { type: "object", required: ["claims"] }, model: "configured-model",
    temperature: 0, timeoutMs: 5_000, maxOutputTokens: 2_000 });
  assert.deepEqual(response.output, { claims: [] });
  assert.equal(received.schemaHint, '{"type":"object","required":["claims"]}');
  assert.equal(received.model, "configured-model");
  assert.equal(received.maxOutputTokens, 2_000);
  assert.equal(received.maxRetries, 1);
  assert.equal(received.timeout, 5_000);
  assert.equal(received.returnMetadata, true);
});

test("CF1 adapter unwraps named strict schemas for the repository JSON-mode port", async () => {
  let received;
  const transport = createOpenAiCf1Transport({ llm: { generate: async (request) => {
    received = request;
    return { output: {}, usage: {}, model: request.model };
  } } });
  await transport.invoke({ system: "system", user: "user",
    responseSchema: { name: "draft", strict: true,
      schema: { type: "object", required: ["articleMap"] } },
    model: "configured-model", temperature: 0, timeoutMs: 5_000, maxOutputTokens: 2_000 });
  assert.equal(received.schemaHint, '{"type":"object","required":["articleMap"]}');
  assert.deepEqual(received.jsonSchema, { name: "draft", strict: true,
    schema: { type: "object", required: ["articleMap"] } });
});

test("CF1 adapter keeps legacy models on repository JSON mode", async () => {
  let received;
  const transport = createOpenAiCf1Transport({ llm: { generate: async (request) => {
    received = request;
    return { output: {}, usage: {}, model: request.model };
  } } });
  await transport.invoke({ system: "system", user: "user",
    responseSchema: { name: "draft", strict: true, schema: { type: "object" } },
    model: "gpt-4-turbo", temperature: 0, timeoutMs: 5_000, maxOutputTokens: 2_000 });
  assert.equal(received.jsonSchema, undefined);
});
