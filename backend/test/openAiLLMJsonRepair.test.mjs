import assert from "node:assert/strict";
import test from "node:test";

import {
  openAiLLM,
  parseOpenAiJsonModeResponse,
} from "../src/core/openAiLLM.js";

function responsesEnvelope(content, overrides = {}) {
  return JSON.stringify({
    status: "completed",
    output: [
      {
        content: [{ type: "output_text", text: content }],
      },
    ],
    ...overrides,
  });
}

test("repairs common malformed assistant JSON", () => {
  const result = parseOpenAiJsonModeResponse(
    responsesEnvelope('{"bearing":"support",}'),
    "responses",
  );

  assert.deepEqual(result.parsed, { bearing: "support" });
  assert.equal(result.repaired, true);
});

test("does not repair an explicitly incomplete response", () => {
  assert.throws(
    () =>
      parseOpenAiJsonModeResponse(
        responsesEnvelope("{", {
          status: "incomplete",
          incomplete_details: { reason: "max_output_tokens" },
        }),
        "responses",
      ),
    (error) =>
      error.code === "OPENAI_INVALID_JSON" &&
      /max_output_tokens/.test(error.message),
  );
});

test("retries a truncated opening brace instead of accepting repaired empty JSON", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;

  globalThis.fetch = async () => {
    calls += 1;
    const body =
      calls === 1
        ? responsesEnvelope("{")
        : responsesEnvelope('{"bearing":"nuance"}');

    return {
      ok: true,
      status: 200,
      text: async () => body,
    };
  };

  try {
    const result = await openAiLLM.generate({
      user: "test",
      api: "responses",
      maxRetries: 2,
      timeout: 1000,
    });

    assert.deepEqual(result, { bearing: "nuance" });
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
