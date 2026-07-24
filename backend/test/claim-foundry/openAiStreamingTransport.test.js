import test from "node:test";
import assert from "node:assert/strict";
import { createOpenAiStreamingCf1Transport }
  from "./prompt-benchmark/openAiStreamingTransport.js";
import { createCf1ModelRunner } from "../../src/claim-foundry/modelRunner.js";

const encoder = new TextEncoder();

function sseResponse({ fragments, finishReason = "stop", usage = {
  prompt_tokens: 10, completion_tokens: 20, total_tokens: 30,
} }) {
  const events = fragments.map((content) => `data: ${JSON.stringify({
    id: "chatcmpl_stream_test", model: "gpt-4o-mini-2024-07-18",
    system_fingerprint: "fp_stream_test", service_tier: "default", created: 123,
    choices: [{ index: 0, delta: { content }, finish_reason: null }],
  })}\n\n`);
  events.push(`data: ${JSON.stringify({ id: "chatcmpl_stream_test",
    model: "gpt-4o-mini-2024-07-18", system_fingerprint: "fp_stream_test",
    choices: [{ index: 0, delta: {}, finish_reason: finishReason }] })}\n\n`);
  events.push(`data: ${JSON.stringify({ id: "chatcmpl_stream_test",
    model: "gpt-4o-mini-2024-07-18", choices: [], usage })}\n\n`);
  events.push("data: [DONE]\n\n");
  const wire = events.join("");
  const pieces = [];
  for (let index = 0; index < wire.length; index += 37) pieces.push(wire.slice(index, index + 37));
  return {
    ok: true,
    headers: { get: (name) => ({ "x-request-id": "req_stream_test",
      "openai-processing-ms": "456" })[name] ?? null },
    body: new ReadableStream({ start(controller) {
      for (const piece of pieces) controller.enqueue(encoder.encode(piece));
      controller.close();
    } }),
  };
}

const request = {
  system: "system", user: "user", model: "gpt-4o-mini", temperature: 0,
  seed: 42, maxOutputTokens: 12_000,
  responseSchema: { name: "test_schema", strict: true,
    schema: { type: "object", additionalProperties: false,
      required: ["candidateClaims"], properties: { candidateClaims: { type: "array",
        maxItems: 40, items: { type: "object", additionalProperties: false,
          required: ["claimText"], properties: { claimText: { type: "string" } } } } } } },
};

test("streaming transport returns structured output and claim diagnostics", async () => {
  let outbound;
  let clock = 1_000;
  const fetchImpl = async (_url, init) => {
    outbound = JSON.parse(init.body);
    return sseResponse({ fragments: [
      '{"candidateClaims":[{"claimText":"First ',
      'claim."},{"claimText":"Second claim."}]}',
    ] });
  };
  const observed = [];
  const transport = createOpenAiStreamingCf1Transport({ fetchImpl,
    getApiKey: () => "test-key", onClaim: (claim) => observed.push(claim),
    now: () => (clock += 10) });
  const result = await transport.invoke(request);
  assert.deepEqual(result.output.candidateClaims.map((item) => item.claimText),
    ["First claim.", "Second claim."]);
  assert.equal(outbound.stream, true);
  assert.deepEqual(outbound.stream_options, { include_usage: true });
  assert.equal(outbound.response_format.json_schema.name, "test_schema");
  assert.equal(result.rawResponse.choices[0].finish_reason, "stop");
  assert.equal(result.rawResponse.request_id, "req_stream_test");
  assert.equal(result.rawResponse.streamingDiagnostics.claimsObserved.length, 2);
  assert.equal(observed.length, 2);
  assert.equal(result.usage.total_tokens, 30);
});

test("streaming transport aborts the third normalized repeated claim", async () => {
  const repeated = [
    '{"candidateClaims":[{"claimText":"Repeated claim."},',
    '{"claimText":"A distinct claim."},{"claimText":"REPEATED CLAIM!"},',
    '{"claimText":"Repeated claim"}]}',
  ];
  const transport = createOpenAiStreamingCf1Transport({
    fetchImpl: async () => sseResponse({ fragments: repeated }),
    getApiKey: () => "test-key", repetitionThreshold: 3,
  });
  await assert.rejects(transport.invoke(request), (error) => {
    assert.equal(error.code, "CF1_MODEL_REPETITION_LOOP");
    assert.equal(error.providerMetadata.streamingDiagnostics.repetition.count, 3);
    assert.equal(error.providerMetadata.streamingDiagnostics.claimsObserved.length, 4);
    return true;
  });
});

test("streaming transport can monitor assertionText instead of claimText", async () => {
  const assertionRequest = { ...request,
    responseSchema: { name: "assertion_schema", strict: true,
      schema: { type: "object", additionalProperties: false,
        required: ["assertions"], properties: { assertions: { type: "array",
          items: { type: "object", additionalProperties: false,
            required: ["assertionText"],
            properties: { assertionText: { type: "string" } } } } } } } };
  const transport = createOpenAiStreamingCf1Transport({
    fetchImpl: async () => sseResponse({ fragments: [
      '{"assertions":[{"assertionText":"Repeated assertion."},',
      '{"assertionText":"REPEATED ASSERTION!"},{"assertionText":"Repeated assertion"}]}',
    ] }),
    getApiKey: () => "test-key", fieldName: "assertionText", repetitionThreshold: 3,
  });
  await assert.rejects(transport.invoke(assertionRequest), (error) => {
    assert.equal(error.code, "CF1_MODEL_REPETITION_LOOP");
    assert.equal(error.providerMetadata.streamingDiagnostics.repetition.fieldName,
      "assertionText");
    return true;
  });
});

test("split-run retry policy makes a detected loop exactly one provider request", async () => {
  let providerRequests = 0;
  const transport = createOpenAiStreamingCf1Transport({
    fetchImpl: async () => {
      providerRequests += 1;
      return sseResponse({ fragments: [
        '{"candidateClaims":[{"claimText":"Looping claim."},',
        '{"claimText":"LOOPING CLAIM!"},{"claimText":"Looping claim"}]}',
      ] });
    },
    getApiKey: () => "test-key", repetitionThreshold: 3,
  });
  const runner = createCf1ModelRunner({ transport });
  await assert.rejects(runner.invokeStructured({ ...request, timeoutMs: 5_000,
    maximumAttempts: 1 }), (error) => {
    assert.equal(error.code, "CF1_MODEL_UNAVAILABLE", `${error.name}: ${error.message}`);
    assert.equal(error.cause?.code, "CF1_MODEL_REPETITION_LOOP");
    return true;
  });
  assert.equal(providerRequests, 1);
});
