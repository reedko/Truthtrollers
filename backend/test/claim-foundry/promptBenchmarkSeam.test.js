import test from "node:test";
import assert from "node:assert/strict";
import { createCf1ModelRunner } from "../../src/claim-foundry/modelRunner.js";
import { runClaimFoundry } from "../../src/claim-foundry/runClaimFoundry.js";
import { runCf1Agent, LIVE_PROMPT_IDENTITY } from "../../src/claim-foundry/agentExecution.js";
import { buildSemanticInventoryPrompt } from "../../src/claim-foundry/prompts/semanticInventoryPrompt.js";
import { buildSelectedEnrichmentPrompt } from "../../src/claim-foundry/prompts/selectedEnrichmentPrompt.js";
import { buildSelectedEnrichmentContext } from "../../src/claim-foundry/selectedEnrichmentContext.js";
import { runHostSemanticCritic } from "../../src/claim-foundry/hostSemanticCritic.js";
import { verifySemanticInventory } from "../../src/claim-foundry/twoCallAgentVerification.js";
import { submitCf1Package } from "../../src/routes/claim-foundry/submitService.js";
import { createArticleAndBlocks, createSelectedEnrichmentOutput,
  createSemanticInventoryOutput } from "./fixtures/packages.js";

const OPTIONS = {
  model: "fake", modelContextTokens: 100_000, timeoutMs: 1_000,
  blockOptions: { targetMinChars: 1, targetMaxChars: 70, hardMaxChars: 100 },
  budgetLimits: { maxTotalTokens: 20_000, maxOutputTokensPerCall: 3_000, maxDurationMs: 30_000 },
};

function runner(calls) {
  return createCf1ModelRunner({ transport: { invoke: async (request) => {
    calls.push(request);
    return { output: request.usageContext.stage === "semantic_inventory"
      ? createSemanticInventoryOutput() : createSelectedEnrichmentOutput(), model: "fake",
      usage: { input_tokens: 100, output_tokens: 50, total_tokens: 150 } };
  } } });
}

test("default agent run records the live prompt identity in diagnostics", async () => {
  const { article } = createArticleAndBlocks();
  const result = await runClaimFoundry({ article, options: OPTIONS,
    dependencies: { modelRunner: runner([]) } });
  assert.equal(result.run.status, "ready_for_evidence");
  assert.deepEqual(result.claimPackage.diagnostics.agentRuntime.promptIdentity,
    { ...LIVE_PROMPT_IDENTITY });
});

test("injected prompt builders replace live prompts and record their identity", async () => {
  const { article } = createArticleAndBlocks();
  const calls = [];
  const identity = { call1Version: "bench-call1-vX", call2Version: "bench-call2-vY" };
  const promptBuilders = {
    buildCall1: (context) => {
      const prompt = buildSemanticInventoryPrompt(context);
      return { ...prompt, system: `BENCH-MARKER ${prompt.system}` };
    },
    buildCall2: buildSelectedEnrichmentPrompt,
    identity,
  };
  const result = await runClaimFoundry({ article, options: OPTIONS,
    dependencies: { modelRunner: runner(calls), promptBuilders } });
  assert.equal(result.run.status, "ready_for_evidence");
  assert.match(calls[0].system, /^BENCH-MARKER /);
  assert.deepEqual(result.claimPackage.diagnostics.agentRuntime.promptIdentity, identity);
});

test("prompt builders missing either call are rejected before any model call", async () => {
  const { article, articleDocument, structuralBlocks } = createArticleAndBlocks();
  await assert.rejects(runCf1Agent({ runId: "cf1run_0190b3f0-0000-7000-8000-000000000000",
    article, structuralBlocks, sourceUnits: articleDocument.sourceUnits,
    modelRunner: runner([]), model: "fake", timeoutMs: 1_000,
    budgetLimits: OPTIONS.budgetLimits, promptBuilders: { buildCall1: () => ({}) } }),
  (error) => error.code === "CF1_INVALID_PROMPT_BUILDERS");
});

test("shared enrichment context reproduces exactly what the live Call 2 receives", async () => {
  const { article, articleDocument, structuralBlocks } = createArticleAndBlocks();
  const sourceUnits = articleDocument.sourceUnits;
  const inventory = verifySemanticInventory(createSemanticInventoryOutput(), { sourceUnits, article });
  const critic = runHostSemanticCritic(structuredClone(inventory),
    { sourceUnits, structuralBlocks, targetMinimum: 1, targetMaximum: 3 });
  const context = buildSelectedEnrichmentContext({ inventory,
    orientation: { theme: inventory.theme.text, thesis: inventory.thesis.text,
      pillars: inventory.pillars }, critic, sourceUnits });
  // Allowed units are the union of selected-claim units, theme/thesis units, and
  // non-supporting pillar units — proven against the live end-to-end Call 2 request.
  const calls = [];
  const result = await runClaimFoundry({ article, options: OPTIONS,
    dependencies: { modelRunner: runner(calls) } });
  assert.equal(result.run.status, "ready_for_evidence");
  const sent = calls[1].user;
  const expectedUnitsBlock = JSON.stringify(context.sourceUnits
    .map(({ unitId, text }) => ({ unitId, text })));
  assert.ok(sent.endsWith(`ALLOWED SOURCE UNITS:\n${expectedUnitsBlock}`),
    "live Call 2 allowed-source-units block must match the shared helper output");
  assert.deepEqual(context.selectedClaims.map((claim) => claim.candidateId),
    critic.selectedClaims.map((claim) => claim.candidateId));
  assert.equal(context.namedWorkPool, inventory.namedWorks);
});

test("public API rejects every prompt-selection option name", async () => {
  const { article } = createArticleAndBlocks();
  for (const key of ["promptSet", "promptSetId", "profile", "promptBuilders"]) {
    await assert.rejects(submitCf1Package({ article, consumerKey: "consumer-a",
      options: { [key]: "set-a-recall-reasoning-v1" } }, {}),
    (error) => error.code === "CF1_INVALID_OPTIONS", `option ${key} must be rejected`);
  }
});
