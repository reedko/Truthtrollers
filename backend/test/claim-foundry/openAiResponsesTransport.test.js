import test from "node:test";
import assert from "node:assert/strict";
import { createOpenAiResponsesCf1Transport }
  from "../../src/claim-foundry/openAiResponsesTransport.js";

test("CF1 Responses adapter maps the structured request and parses output", async () => {
  let received;
  const client = { responses: { create: async (body) => {
    received = body;
    return { id: "resp_test", model: "gpt-5-test", status: "completed",
      output_text: JSON.stringify({ candidateJudgments: [] }),
      usage: { input_tokens: 10, output_tokens: 3, total_tokens: 13 } };
  } } };
  const transport = createOpenAiResponsesCf1Transport({ client });
  const result = await transport.invoke({ system: "system", user: "user", model: "gpt-5",
    store: false, reasoningEffort: "medium", maxOutputTokens: 2_000,
    responseSchema: { name: "judgments", strict: true,
      schema: { type: "object", additionalProperties: false,
        required: ["candidateJudgments"], properties: { candidateJudgments: { type: "array" } } } } });

  assert.deepEqual(result.output, { candidateJudgments: [] });
  assert.equal(received.instructions, "system");
  assert.equal(received.input, "user");
  assert.equal(received.store, false);
  assert.deepEqual(received.reasoning, { effort: "medium" });
  assert.equal(received.max_output_tokens, 2_000);
  assert.equal(received.text.format.type, "json_schema");
  assert.equal(received.text.format.name, "judgments");
  assert.equal(received.text.format.strict, true);
});

test("CF1 Responses adapter omits reasoning for non-reasoning models", async () => {
  let received;
  const client = { responses: { create: async (body) => {
    received = body;
    return { id: "resp_test", model: "gpt-4.1-mini", status: "completed",
      output_text: JSON.stringify({ candidateJudgments: [] }),
      usage: { input_tokens: 10, output_tokens: 3, total_tokens: 13 } };
  } } };
  const transport = createOpenAiResponsesCf1Transport({ client });
  await transport.invoke({ system: "system", user: "user", model: "gpt-4.1-mini",
    store: false, reasoningEffort: "none",
    responseSchema: { name: "judgments", strict: true,
      schema: { type: "object", additionalProperties: false,
        required: ["candidateJudgments"], properties: { candidateJudgments: { type: "array" } } } } });

  assert.equal("reasoning" in received, false);
});
