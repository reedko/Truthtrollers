import test from "node:test";
import assert from "node:assert/strict";
import { openAiLLM } from "../../src/core/openAiLLM.js";

test("Chat Completions truncation preserves provider termination metadata", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    headers: { get: (name) => ({
      "x-request-id": "req_test",
      "openai-processing-ms": "321",
    })[name] ?? null },
    text: async () => JSON.stringify({
      id: "chatcmpl_test",
      model: "gpt-4o-mini-2024-07-18",
      system_fingerprint: "fp_test",
      choices: [{ finish_reason: "length", message: { content: '{"candidateClaims":[' } }],
      usage: { prompt_tokens: 10, completion_tokens: 40, total_tokens: 50 },
    }),
  });
  try {
    await assert.rejects(openAiLLM.generate({
      system: "system", user: "user", model: "gpt-4o-mini",
      maxRetries: 1, timeout: 1_000, returnMetadata: true,
    }), (error) => {
      assert.equal(error.code, "CF1_MODEL_OUTPUT_TRUNCATED");
      assert.deepEqual(error.providerMetadata, {
        responseId: "chatcmpl_test",
        requestId: "req_test",
        systemFingerprint: "fp_test",
        finishReason: "length",
        model: "gpt-4o-mini-2024-07-18",
        serviceTier: null,
        processingMs: "321",
        usage: { prompt_tokens: 10, completion_tokens: 40, total_tokens: 50 },
      });
      return true;
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
