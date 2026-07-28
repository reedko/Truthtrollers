import assert from "node:assert/strict";
import test from "node:test";
import {
  ClaimFoundryRequestAssertions,
} from "../../claimFoundry/claimFoundryRequestAssertions.js";
import type {
  ModelRequestObservation,
  ModelRequestSnapshot,
} from "../../shared/agentRuntime.js";

function snapshot(
  turn: number,
  overrides: Partial<ModelRequestSnapshot> = {},
): ModelRequestSnapshot {
  return {
    turn,
    model: "test-model",
    toolsExposed: [
      "update_working_package",
      "inspect_working_package",
      "finalize_working_package",
      "abstain_or_request_review",
    ],
    modelVisibleInputHash: `${turn}`.repeat(64).slice(0, 64),
    instructionHash: "a".repeat(64),
    toolSchemaHash: "b".repeat(64),
    clientInputHash: "c".repeat(64),
    clientInputBytes: 100,
    clientInputItemCount: 1,
    articleMarkerOccurrences: turn === 1 ? 1 : 0,
    explicitCacheBreakpointCount: turn === 1 ? 1 : 0,
    conversationId: "conv-test",
    previousResponseId: null,
    estimatedInputTokens: 1_400,
    payloadClassTokens: {
      instructions: 100,
      tools: 300,
      input: 1_000,
      terminalSchema: 0,
    },
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function observation(
  turn: number,
  cachedInputTokens: number,
): ModelRequestObservation {
  return {
    ...snapshot(turn),
    responseId: `resp-${turn}`,
    requestId: `req-${turn}`,
    inputTokens: 1_500,
    cachedInputTokens,
    uncachedInputTokens: 1_500 - cachedInputTokens,
    outputTokens: 50,
    totalTokens: 1_550,
    toolSelected: "inspect_working_package",
  };
}

test("cache coverage is measured against the stable prefix, not total request input", () => {
  const assertions = new ClaimFoundryRequestAssertions({
    conversationId: "conv-test",
    stablePrefix: {
      instructionTokens: 100,
      fixedToolSchemaTokens: 300,
      articleTokens: 600,
    },
    reportingToleranceTokens: 10,
  });
  assertions.beforeModelRequest(snapshot(1));
  assertions.beforeModelRequest(snapshot(2));
  assertions.afterModelRequest(observation(2, 890));
  const evidence = assertions.evidence();
  assert.equal(evidence.stablePrefixTokens, 1_000);
  assert.equal(evidence.requiredCachedStablePrefixTokens, 900);
  assert.equal(evidence.cacheCoverage[0]!.passed, true);
  assert.equal(evidence.cacheCoverage[0]!.coveredStablePrefixRatio, 0.9);
});

test("stable-prefix cache miss fails even when cached share of total input is misleading", () => {
  const assertions = new ClaimFoundryRequestAssertions({
    conversationId: "conv-test",
    stablePrefix: {
      instructionTokens: 100,
      fixedToolSchemaTokens: 300,
      articleTokens: 600,
    },
  });
  assertions.beforeModelRequest(snapshot(1));
  assertions.beforeModelRequest(snapshot(2));
  assert.throws(
    () => assertions.afterModelRequest(observation(2, 899)),
    /stable-prefix tokens/,
  );
});

test("request assertions reject article replay, schema drift, and mixed continuation", () => {
  const create = () => new ClaimFoundryRequestAssertions({
    conversationId: "conv-test",
    stablePrefix: {
      instructionTokens: 100,
      fixedToolSchemaTokens: 300,
      articleTokens: 600,
    },
  });

  const replay = create();
  replay.beforeModelRequest(snapshot(1));
  assert.throws(
    () => replay.beforeModelRequest(snapshot(2, { articleMarkerOccurrences: 1 })),
    /replayed/,
  );

  const drift = create();
  drift.beforeModelRequest(snapshot(1));
  assert.throws(
    () => drift.beforeModelRequest(snapshot(2, { toolSchemaHash: "d".repeat(64) })),
    /schemas drifted/,
  );

  const mixed = create();
  assert.throws(
    () => mixed.beforeModelRequest(snapshot(1, { previousResponseId: "resp-prior" })),
    /mixed/,
  );
});
