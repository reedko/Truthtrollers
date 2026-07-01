import test from "node:test";
import assert from "node:assert/strict";

import {
  finishOpenAiUsageCapture,
  getOpenAiUsageCapture,
  recordOpenAiUsage,
  withOpenAiUsageCapture,
} from "../../src/core/openAiUsageTelemetry.js";

test("OpenAI usage capture totals provider-reported tokens and models", async () => {
  const usage = await withOpenAiUsageCapture({ route: "/test" }, async () => {
    recordOpenAiUsage({
      prompt_tokens: 100,
      completion_tokens: 25,
      total_tokens: 125,
      prompt_tokens_details: { cached_tokens: 40 },
    }, "gpt-test");
    recordOpenAiUsage({ prompt_tokens: 50, completion_tokens: 10, total_tokens: 60 }, "gpt-test");
    return finishOpenAiUsageCapture({ contentId: 42 });
  });

  assert.equal(usage.calls, 2);
  assert.equal(usage.inputTokens, 150);
  assert.equal(usage.outputTokens, 35);
  assert.equal(usage.totalTokens, 185);
  assert.equal(usage.cachedInputTokens, 40);
  assert.equal(usage.models["gpt-test"].calls, 2);
  assert.equal(usage.metadata.contentId, 42);
});

test("OpenAI usage capture is isolated across concurrent async runs", async () => {
  const [left, right] = await Promise.all([
    withOpenAiUsageCapture({ id: "left" }, async () => {
      await Promise.resolve();
      recordOpenAiUsage({ prompt_tokens: 10, completion_tokens: 1, total_tokens: 11 }, "left-model");
      return getOpenAiUsageCapture();
    }),
    withOpenAiUsageCapture({ id: "right" }, async () => {
      recordOpenAiUsage({ prompt_tokens: 20, completion_tokens: 2, total_tokens: 22 }, "right-model");
      await Promise.resolve();
      return getOpenAiUsageCapture();
    }),
  ]);

  assert.equal(left.totalTokens, 11);
  assert.deepEqual(Object.keys(left.models), ["left-model"]);
  assert.equal(right.totalTokens, 22);
  assert.deepEqual(Object.keys(right.models), ["right-model"]);
});
