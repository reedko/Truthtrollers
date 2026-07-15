import test from "node:test";
import assert from "node:assert/strict";
import { runCf1Repair } from "../../src/claim-foundry/repairExecution.js";
import { verifyCf1Package } from "../../src/claim-foundry/verifyPackage.js";
import { createPackageDraft } from "./fixtures/packages.js";

const LIMITS = { maxTotalTokens: 5_000, maxOutputTokensPerCall: 300, maxDurationMs: 10_000 };
const PRIOR_USAGE = { semanticCalls: 1, primaryCalls: 1, batchCalls: 0, synthesisCalls: 0,
  repairCalls: 0, totalTokens: 100, lastOutputTokens: 40, elapsedMs: 100, transportAttempts: 1 };

function runner(output, calls) {
  return { invokeStructured: async (request) => {
    calls.push(request);
    return { output, usage: { inputTokens: 40, outputTokens: 10, totalTokens: 50, cachedInputTokens: 0 },
      model: "fake", attempts: 1, telemetryWarning: null };
  } };
}

function postureDraft() {
  const draft = createPackageDraft();
  draft.phase3Targets[0].scoreTransform = "invert";
  return draft;
}

test("one repair call applies atomically and reverifies the entire package", async () => {
  const draft = postureDraft();
  const calls = [];
  const output = { repairs: [
    { operation: "replace", path: "/phase3Targets/0/scoreTransform", value: "normal",
      rationale: "The article endorses this target.", sourceBlockIds: ["B001"] },
    { operation: "replace", path: "/phase3Targets/0/verdictEligible", value: true,
      rationale: "The resolved substantive target affects verdict.", sourceBlockIds: ["B001"] },
  ], cannotRepair: [] };
  const times = [1_000, 1_050];
  const result = await runCf1Repair({
    packageDraft: draft, verification: verifyCf1Package(draft), modelRunner: runner(output, calls),
    usageSoFar: PRIOR_USAGE, budgetLimits: LIMITS, model: "fake", timeoutMs: 1_000,
    clockMs: () => times.shift(), verificationClock: () => new Date("2026-07-13T12:00:00Z"),
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].usageContext.stage, "repair");
  assert.equal(result.verification.valid, true);
  assert.equal(result.verification.repairAttempted, true);
  assert.equal(result.terminal, false);
  assert.equal(result.usage.semanticCalls, 2);
  assert.equal(result.usage.repairCalls, 1);
  assert.equal(result.usage.totalTokens, 150);
});

test("failed repair terminates without a second repair call", async () => {
  const draft = postureDraft();
  const calls = [];
  const output = { repairs: [], cannotRepair: [{ code: "CF1_INVALID_TARGET_POSTURE", reason: "Cannot ground a change." }] };
  const result = await runCf1Repair({
    packageDraft: draft, verification: verifyCf1Package(draft), modelRunner: runner(output, calls),
    usageSoFar: PRIOR_USAGE, budgetLimits: LIMITS, model: "fake", timeoutMs: 1_000,
  });
  assert.equal(result.terminal, true);
  assert.equal(result.verification.repairAttempted, true);
  await assert.rejects(runCf1Repair({
    packageDraft: result.packageDraft, verification: result.verification, modelRunner: runner(output, calls),
    usageSoFar: result.usage, budgetLimits: LIMITS, model: "fake", timeoutMs: 1_000,
  }), (error) => error.code === "CF1_REPAIR_LIMIT_REACHED");
  assert.equal(calls.length, 1);
});

test("repair budget failure happens before model invocation", async () => {
  const draft = postureDraft();
  const calls = [];
  await assert.rejects(runCf1Repair({
    packageDraft: draft, verification: verifyCf1Package(draft), modelRunner: runner({}, calls),
    usageSoFar: { ...PRIOR_USAGE, totalTokens: 5_000 }, budgetLimits: LIMITS,
    model: "fake", timeoutMs: 1_000,
  }), (error) => error.code === "CF1_BUDGET_EXCEEDED");
  assert.equal(calls.length, 0);
});

test("a completed six-batch long path may use exactly one eighth repair call", async () => {
  const draft = postureDraft();
  const calls = [];
  const output = { repairs: [
    { operation: "replace", path: "/phase3Targets/0/scoreTransform", value: "normal",
      rationale: "The article endorses the target.", sourceBlockIds: ["B001"] },
    { operation: "replace", path: "/phase3Targets/0/verdictEligible", value: true,
      rationale: "The resolved target is verdict eligible.", sourceBlockIds: ["B001"] },
  ], cannotRepair: [] };
  const longUsage = { ...PRIOR_USAGE, semanticCalls: 7, primaryCalls: 0, batchCalls: 6,
    synthesisCalls: 1, totalTokens: 500 };
  const result = await runCf1Repair({ packageDraft: draft, verification: verifyCf1Package(draft),
    modelRunner: runner(output, calls), usageSoFar: longUsage, budgetLimits: LIMITS,
    model: "fake", timeoutMs: 1_000 });
  assert.equal(result.verification.valid, true);
  assert.equal(result.usage.semanticCalls, 8);
  assert.equal(result.usage.repairCalls, 1);
  assert.equal(calls[0].usageContext.path, "long");
});
