import test from "node:test";
import assert from "node:assert/strict";
import { assertBudget, chooseExecutionPath, estimateCf1Tokens } from "../../src/claim-foundry/tokenBudget.js";

const LIMITS = { maxTotalTokens: 20_000, maxOutputTokensPerCall: 4_000, maxDurationMs: 60_000 };

test("token estimation is deterministic and conservative for UTF-8 input", () => {
  assert.equal(estimateCf1Tokens("abcdef", { charsPerToken: 3 }), 2);
  assert.equal(estimateCf1Tokens("你好", { charsPerToken: 3 }), 2);
  assert.equal(estimateCf1Tokens({ b: 2, a: 1 }), 5);
});

test("normal path is selected within context and block thresholds", () => {
  const result = chooseExecutionPath({
    article: { text: "x".repeat(3_000) },
    structuralBlocks: Array.from({ length: 10 }, () => ({})),
    modelContextTokens: 10_000,
    promptOverheadTokens: 500,
  });
  assert.equal(result.path, "normal");
  assert.deepEqual(result.reasons, []);
});

test("context pressure or more than 80 blocks selects the long path", () => {
  const contextPressure = chooseExecutionPath({
    article: { text: "x".repeat(18_003) }, structuralBlocks: [], modelContextTokens: 10_000,
  });
  const blockPressure = chooseExecutionPath({
    article: { text: "short article" }, structuralBlocks: Array.from({ length: 81 }, () => ({})), modelContextTokens: 10_000,
  });
  assert.equal(contextPressure.path, "long");
  assert.ok(contextPressure.reasons.includes("primary_context_threshold"));
  assert.equal(blockPressure.path, "long");
  assert.ok(blockPressure.reasons.includes("block_count_threshold"));
});

test("budget accepts usage at configured ceilings", () => {
  assert.equal(assertBudget({
    path: "normal",
    usage: { semanticCalls: 2, batchCalls: 0, totalTokens: 20_000, lastOutputTokens: 4_000, elapsedMs: 60_000 },
    limits: LIMITS,
  }), true);
});

test("architectural call ceilings cannot be raised by configuration", () => {
  assert.throws(() => assertBudget({
    path: "normal",
    usage: { semanticCalls: 3, batchCalls: 0, totalTokens: 1, lastOutputTokens: 1, elapsedMs: 1 },
    limits: { ...LIMITS, maxSemanticCalls: 99 },
  }), (error) => error.code === "CF1_BUDGET_EXCEEDED");
});

test("per-stage primary, synthesis, and repair ceilings are enforced", () => {
  const usage = { semanticCalls: 2, batchCalls: 0, primaryCalls: 1, synthesisCalls: 0,
    repairCalls: 1, totalTokens: 1, lastOutputTokens: 1, elapsedMs: 1 };
  assert.equal(assertBudget({ path: "normal", usage, limits: LIMITS }), true);
  for (const change of [{ primaryCalls: 2 }, { synthesisCalls: 1 }, { repairCalls: 2 }]) {
    assert.throws(
      () => assertBudget({ path: "normal", usage: { ...usage, ...change }, limits: LIMITS }),
      (error) => error.code === "CF1_BUDGET_EXCEEDED",
    );
  }
});

test("long-path batch, token, output, and time ceilings are enforced", () => {
  const base = { semanticCalls: 7, batchCalls: 6, totalTokens: 10_000, lastOutputTokens: 1_000, elapsedMs: 10_000 };
  for (const change of [
    { batchCalls: 7 }, { totalTokens: 20_001 }, { lastOutputTokens: 4_001 }, { elapsedMs: 60_001 },
  ]) {
    assert.throws(
      () => assertBudget({ path: "long", usage: { ...base, ...change }, limits: LIMITS }),
      (error) => error.code === "CF1_BUDGET_EXCEEDED" && error.retryable === false,
    );
  }
});

test("token and time ceilings are mandatory configuration", () => {
  assert.throws(
    () => assertBudget({ path: "normal", usage: {}, limits: {} }),
    (error) => error.code === "CF1_INVALID_BUDGET",
  );
});
