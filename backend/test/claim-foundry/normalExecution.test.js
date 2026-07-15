import test from "node:test";
import assert from "node:assert/strict";
import { runNormalCf1Analysis } from "../../src/claim-foundry/normalExecution.js";
import { createAgentDraft, createArticleAndBlocks } from "./fixtures/packages.js";

const LIMITS = { maxTotalTokens: 10_000, maxOutputTokensPerCall: 3_000, maxDurationMs: 30_000 };

function fakeRunner(response, calls) {
  return { invokeStructured: async (request) => {
    calls.push(request);
    return { output: response, usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150, cachedInputTokens: 0 },
      model: "fake-model", attempts: 1, rawResponse: { id: "fake" }, telemetryWarning: null };
  } };
}

test("normal execution makes exactly one primary semantic invocation", async () => {
  const source = createArticleAndBlocks();
  const calls = [];
  const clockValues = [1_000, 1_125];
  const result = await runNormalCf1Analysis({
    ...source, executionDecision: { path: "normal" }, modelRunner: fakeRunner(createAgentDraft(), calls),
    model: "fake-model", timeoutMs: 1_000, budgetLimits: LIMITS, clockMs: () => clockValues.shift(),
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].usageContext.stage, "primary");
  assert.equal(calls[0].maxOutputTokens, LIMITS.maxOutputTokensPerCall);
  assert.equal(result.agentDraft.selectionCountException, "Short unit fixture has one material claim.");
  assert.deepEqual(result.usage, { semanticCalls: 1, primaryCalls: 1, batchCalls: 0, synthesisCalls: 0,
    repairCalls: 0, totalTokens: 150, lastOutputTokens: 50, elapsedMs: 125, transportAttempts: 1 });
});

test("normal execution refuses a long-path decision without calling the model", async () => {
  const source = createArticleAndBlocks();
  const calls = [];
  await assert.rejects(runNormalCf1Analysis({
    ...source, executionDecision: { path: "long" }, modelRunner: fakeRunner({}, calls),
    model: "fake", timeoutMs: 100, budgetLimits: LIMITS,
  }), (error) => error.code === "CF1_WRONG_EXECUTION_PATH");
  assert.equal(calls.length, 0);
});

test("insufficient reserved token budget prevents the primary call", async () => {
  const source = createArticleAndBlocks();
  const calls = [];
  const runner = fakeRunner(createAgentDraft(), calls);
  await assert.rejects(runNormalCf1Analysis({
    ...source, executionDecision: { path: "normal" }, modelRunner: runner,
    model: "fake", timeoutMs: 100, budgetLimits: { ...LIMITS, maxTotalTokens: 100 },
  }), (error) => error.code === "CF1_BUDGET_EXCEEDED" && error.retryable === false);
  assert.equal(calls.length, 0);
});
