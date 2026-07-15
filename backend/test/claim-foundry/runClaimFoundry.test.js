import test from "node:test";
import assert from "node:assert/strict";
import { createCf1ModelRunner } from "../../src/claim-foundry/modelRunner.js";
import { runClaimFoundry } from "../../src/claim-foundry/runClaimFoundry.js";
import { verifyCf1Package } from "../../src/claim-foundry/verifyPackage.js";
import { createAgentDraft, createArticleAndBlocks } from "./fixtures/packages.js";

const OPTIONS = {
  model: "fake", modelContextTokens: 100_000, timeoutMs: 1_000,
  executionMode: "baseline",
  blockOptions: { targetMinChars: 1, targetMaxChars: 70, hardMaxChars: 100 },
  budgetLimits: { maxTotalTokens: 20_000, maxOutputTokensPerCall: 3_000, maxDurationMs: 30_000 },
};

function modelRunner(handler, calls) {
  return createCf1ModelRunner({ transport: { invoke: async (request) => {
    calls.push(request);
    return { output: handler(request), model: "fake",
      usage: { input_tokens: 100, output_tokens: 50, total_tokens: 150 } };
  } } });
}

test("no-persistence normal run produces only a verified final package", async () => {
  const { article } = createArticleAndBlocks();
  const calls = [];
  const result = await runClaimFoundry({ article, options: OPTIONS,
    dependencies: { modelRunner: modelRunner(() => createAgentDraft(), calls) } });
  assert.equal(result.run.status, "ready_for_evidence");
  assert.equal(calls.length, 1);
  assert.equal(result.run.executionPath, "baseline_normal");
  assert.equal(result.claimPackage.status, "ready_for_evidence");
  assert.equal(verifyCf1Package(result.claimPackage, { requireFinalHash: true }).valid, true);
  assert.equal(result.artifactRefs.artifactRoot, null);
});

test("repairable normal run uses one repair and then finalizes", async () => {
  const { article } = createArticleAndBlocks();
  const calls = [];
  const handler = (request) => {
    if (request.usageContext.stage === "primary") {
      const draft = createAgentDraft();
      draft.phase3Targets[0].scoreTransform = "invert";
      return draft;
    }
    return { repairs: [
      { operation: "replace", path: "/phase3Targets/0/scoreTransform", value: "normal",
        rationale: "Article-endorsed target.", sourceBlockIds: ["B001"] },
      { operation: "replace", path: "/phase3Targets/0/verdictEligible", value: true,
        rationale: "Resolved substantive target.", sourceBlockIds: ["B001"] },
    ], cannotRepair: [] };
  };
  const result = await runClaimFoundry({ article, options: OPTIONS,
    dependencies: { modelRunner: modelRunner(handler, calls) } });
  assert.equal(result.run.status, "ready_for_evidence");
  assert.equal(calls.length, 2);
  assert.equal(result.verification.repairAttempted, true);
  assert.equal(result.run.usage.repairCalls, 1);
});

test("invalid source-unit grounding returns no claim package", async () => {
  const { article } = createArticleAndBlocks();
  const calls = [];
  const handler = () => {
    const draft = createAgentDraft();
    draft.rawAssertions[0].sourceUnitIds = ["U9999"];
    return draft;
  };
  const result = await runClaimFoundry({ article, options: { ...OPTIONS, allowRepair: false },
    dependencies: { modelRunner: modelRunner(handler, calls) } });
  assert.equal(result.run.status, "failed");
  assert.equal(result.run.error.code, "CF1_GROUNDING_UNKNOWN_UNIT");
  assert.equal(result.claimPackage, null);
  assert.equal(calls.length, 1);
});

test("invalid article fails before any model call", async () => {
  const calls = [];
  const result = await runClaimFoundry({ article: { title: "", text: "" }, options: OPTIONS,
    dependencies: { modelRunner: modelRunner(() => ({}), calls) } });
  assert.equal(result.run.status, "failed");
  assert.equal(result.run.error.code, "CF1_REQUIRED_FIELD_EMPTY");
  assert.equal(calls.length, 0);
});
