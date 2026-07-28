import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  CLAIM_FOUNDRY_TOOL_NAMES,
  createClaimFoundryAgentDefinition,
} from "../../claimFoundry/claimFoundryAgent.js";
import {
  claimFoundryAgentCompletionSchema,
  reconcileClaimFoundryCompletion,
} from "../../claimFoundry/claimFoundryCompletion.js";
import {
  CLAIM_FOUNDRY_INSTRUCTION_VERSION,
} from "../../claimFoundry/claimFoundryInstructions.js";
import {
  MemoryClaimFoundryPersistence,
  hashValue,
} from "../../claimFoundry/claimFoundryPersistence.js";
import { createRunState } from "../../claimFoundry/claimFoundryState.js";
import { createClaimFoundryTools } from "../../claimFoundry/claimFoundryTools.js";
import { document, manifestHash, pkg } from "../claimFoundry/fixtures.js";

const runtimeBudget = { maxModelTurns: 12, maxToolCalls: 30, maxWallTimeMs: 180_000 };
const persistedBudget = { maxToolCalls: 30, maxUnitsRead: 100, maxRepairRounds: 2 };

async function setup(runId: string) {
  const persistence = new MemoryClaimFoundryPersistence();
  await persistence.create(createRunState({
    runId,
    contentId: "content-1",
    contentHash: document.contentHash,
    sourceUnitManifestHash: manifestHash,
    budgets: persistedBudget,
    traceId: null,
    versions: {
      instruction: CLAIM_FOUNDRY_INSTRUCTION_VERSION,
      toolSchema: "cf6.tools.v1",
      model: "test-model",
      code: "test",
    },
  }));
  return {
    persistence,
    context: { runId, contentId: "content-1", articleDocument: document, persistence },
  };
}

test("manager instructions carry authorized identifiers, never article text", async () => {
  const { context } = await setup("agent-instructions");
  const definition = createClaimFoundryAgentDefinition({
    context, model: "test-model", runtimeBudget, persistedBudget,
  });
  assert.equal(definition.name, "ClaimFoundry");
  assert.match(definition.instructions, /agent-instructions/);
  assert.match(definition.instructions, /content-1/);
  assert.match(definition.instructions, new RegExp(CLAIM_FOUNDRY_INSTRUCTION_VERSION));
  for (const unit of document.sourceUnits) {
    assert.equal(definition.instructions.includes(unit.text), false);
  }
});

test("manager exposes exactly the seven accepted model-free domain tools", async () => {
  const { context } = await setup("agent-tools");
  const definition = createClaimFoundryAgentDefinition({
    context, model: "test-model", runtimeBudget, persistedBudget,
  });
  assert.deepEqual(definition.tools.map(tool => tool.name), CLAIM_FOUNDRY_TOOL_NAMES);
  assert.equal(new Set(definition.tools.map(tool => tool.name)).size, 7);
});

test("terminal schema is strict and typed", () => {
  const valid = {
    runId: "r", contentId: "c", terminalStatus: "failed",
    finalPackageId: null, finalPackageHash: null, abstentionReason: null,
    reviewReasons: [], summary: "Stopped.",
  };
  assert.deepEqual(claimFoundryAgentCompletionSchema.parse(valid), valid);
  assert.throws(() => claimFoundryAgentCompletionSchema.parse({ ...valid, package: {} }));
  assert.throws(() => claimFoundryAgentCompletionSchema.parse({ ...valid, terminalStatus: "done" }));
});

test("completed output requires and reloads the immutable persisted package", async () => {
  const { context, persistence } = await setup("agent-completed");
  const tools = createClaimFoundryTools(context);
  await tools.save_working_package({
    idempotencyKey: "agent-save-complete",
    package: pkg("agent-completed"),
  });
  await tools.validate_working_package({ idempotencyKey: "agent-validate-complete" });
  const finalized = await tools.finalize_claim_package({
    idempotencyKey: "agent-final-complete",
    mode: "complete",
    inspectedContextUnitIds: [],
  });
  const reconciled = await reconcileClaimFoundryCompletion({
    proposed: {
      runId: "agent-completed", contentId: "content-1", terminalStatus: "completed",
      finalPackageId: "model-invented", finalPackageHash: "0".repeat(64),
      abstentionReason: null, reviewReasons: [], summary: "Complete.",
    },
    runId: "agent-completed", contentId: "content-1", persistence,
  });
  assert.equal(reconciled.completion.finalPackageId, finalized.result.packageId);
  assert.equal(reconciled.completion.finalPackageHash, finalized.result.packageHash);
  assert.equal(reconciled.finalPackage?.packageHash, finalized.result.packageHash);

  const missing = await setup("agent-not-final");
  await assert.rejects(reconcileClaimFoundryCompletion({
    proposed: {
      runId: "agent-not-final", contentId: "content-1", terminalStatus: "completed",
      finalPackageId: "invented", finalPackageHash: "0".repeat(64),
      abstentionReason: null, reviewReasons: [], summary: "Complete.",
    },
    runId: "agent-not-final", contentId: "content-1", persistence: missing.persistence,
  }), /persisted state/);
});

test("abstention and review terminal output are reconciled to persisted state", async () => {
  const abstained = await setup("agent-abstained");
  const tools = createClaimFoundryTools(abstained.context);
  await tools.finalize_claim_package({
    idempotencyKey: "agent-abstain-final",
    mode: "abstain",
    abstentionReason: "Insufficient substantive content",
    inspectedContextUnitIds: [],
  });
  const result = await reconcileClaimFoundryCompletion({
    proposed: {
      runId: "agent-abstained", contentId: "content-1", terminalStatus: "abstained",
      finalPackageId: null, finalPackageHash: null, abstentionReason: "model wording",
      reviewReasons: [], summary: "Abstained.",
    },
    runId: "agent-abstained", contentId: "content-1", persistence: abstained.persistence,
  });
  assert.equal(result.completion.abstentionReason, "Insufficient substantive content");

  const review = await setup("agent-review");
  await review.persistence.mutate("agent-review", "test_review", "test-review-key", {}, state => ({
    state: { ...state, status: "awaiting_review", pendingReviewReasons: ["semantic-risk"] },
    result: {},
  }));
  const reviewed = await reconcileClaimFoundryCompletion({
    proposed: {
      runId: "agent-review", contentId: "content-1", terminalStatus: "awaiting_review",
      finalPackageId: null, finalPackageHash: null, abstentionReason: null,
      reviewReasons: ["invented"], summary: "Review.",
    },
    runId: "agent-review", contentId: "content-1", persistence: review.persistence,
  });
  assert.deepEqual(reviewed.completion.reviewReasons, ["semantic-risk"]);
});

test("budget and failure outputs normalize without accepting package text", async () => {
  for (const terminalStatus of ["budget_exhausted", "failed"] as const) {
    const run = await setup(`agent-${terminalStatus}`);
    const result = await reconcileClaimFoundryCompletion({
      proposed: {
        runId: `agent-${terminalStatus}`, contentId: "content-1", terminalStatus,
        finalPackageId: null, finalPackageHash: null, abstentionReason: null,
        reviewReasons: [], summary: terminalStatus,
      },
      runId: `agent-${terminalStatus}`, contentId: "content-1", persistence: run.persistence,
    });
    assert.equal(result.completion.terminalStatus, terminalStatus);
    assert.equal(result.finalPackage, null);
  }
});

test("manager and runner contain no fixed trajectory or forbidden integrations", () => {
  const agentPath = fileURLToPath(new URL("../../claimFoundry/claimFoundryAgent.ts", import.meta.url));
  const runnerPath = fileURLToPath(new URL("../../claimFoundry/claimFoundryRunner.ts", import.meta.url));
  const agentSource = readFileSync(agentPath, "utf8");
  const runnerSource = readFileSync(runnerPath, "utf8");
  const forbidden = [
    "experiments/cf5", "routes/", "EvidenceRun", "child_process", "node:fs",
    "mysql", "redis", "fetch(", "axios", "shell",
  ];
  for (const marker of forbidden) {
    assert.equal(agentSource.includes(marker), false, marker);
    assert.equal(runnerSource.includes(marker), false, marker);
  }
  assert.equal(/get_content_map[\s\S]*await[\s\S]*read_source_units[\s\S]*await[\s\S]*save_working_package/.test(runnerSource), false);
  assert.equal(hashValue(CLAIM_FOUNDRY_TOOL_NAMES).length, 64);
});
