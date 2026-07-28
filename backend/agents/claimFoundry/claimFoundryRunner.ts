import {
  runAgent,
  type AgentRunResult,
} from "../shared/agentRuntime.js";
import { AgentRuntimeError, normalizeAgentError } from "../shared/agentErrors.js";
import type { RunBudget } from "../shared/runBudget.js";
import { createClaimFoundryAgentDefinition } from "./claimFoundryAgent.js";
import {
  reconcileClaimFoundryCompletion,
  type ClaimFoundryAgentCompletion,
} from "./claimFoundryCompletion.js";
import type { ClaimFoundryToolContext } from "./claimFoundryContext.js";
import { createClaimFoundryInputFilter } from "./claimFoundryInputFilter.js";

export const CLAIM_FOUNDRY_RUNTIME_BUDGET: Readonly<RunBudget> = Object.freeze({
  maxModelTurns: 12,
  maxToolCalls: 30,
  maxWallTimeMs: 180_000,
});

export function enforceProjectedInputBudget(input: {
  consumedInputTokens: number;
  estimatedNextInputTokens: number;
  maxInputTokens: number;
  turn: number;
}) {
  const conservativeNext = Math.ceil(input.estimatedNextInputTokens * 1.15);
  if (input.consumedInputTokens + conservativeNext > input.maxInputTokens) {
    throw new AgentRuntimeError(
      "budget",
      `Projected cumulative input-token budget exceeded before turn ${input.turn} ` +
      `(${input.consumedInputTokens} + ${conservativeNext} > ${input.maxInputTokens})`,
    );
  }
}

export async function runClaimFoundryManager(input: {
  context: ClaimFoundryToolContext;
  model: string;
  apiKey: string;
  budget?: RunBudget;
}) {
  const budget = input.budget ?? CLAIM_FOUNDRY_RUNTIME_BUDGET;
  const state = await input.context.persistence.load(input.context.runId);
  if (!state) throw new Error("CF6 persisted run state must exist before invoking the manager");
  const definition = createClaimFoundryAgentDefinition({
    context: input.context, model: input.model, runtimeBudget: budget,
    persistedBudget: state.budgets,
  });
  let sdkResult: AgentRunResult<ClaimFoundryAgentCompletion>;
  try {
    sdkResult = await runAgent({
      definition,
      input: `Build and finalize the ClaimFoundry package for content ${input.context.contentId} under run ${input.context.runId}.`,
      model: input.model,
      apiKey: input.apiKey,
      budget,
      runtimeRunId: input.context.runId,
      workflowName: "CF6 ClaimFoundry manager",
      traceMetadata: {
        runId: input.context.runId,
        contentId: input.context.contentId,
        milestone: "CF6-M3",
        instructionVersion: state.versions.instruction,
      },
      callModelInputFilter: createClaimFoundryInputFilter(input.context),
      beforeModelRequest: async snapshot => {
        const requests = await input.context.persistence.modelRequests(input.context.runId);
        const consumed = requests.reduce((sum, request) => sum + request.inputTokens, 0);
        enforceProjectedInputBudget({
          consumedInputTokens: consumed,
          estimatedNextInputTokens: snapshot.estimatedInputTokens,
          maxInputTokens: state.budgets.maxInputTokens,
          turn: snapshot.turn,
        });
      },
      afterModelRequest: observation => input.context.persistence.recordModelRequest({
        runId: input.context.runId,
        ...observation,
      }),
    });
  } catch (error) {
    const normalized = normalizeAgentError(error);
    const telemetry = error instanceof AgentRuntimeError ? error.telemetry : undefined;
    const persisted = await input.context.persistence.load(input.context.runId);
    if (!persisted) throw normalized;
    const terminalStatus = normalized.kind === "budget" ? "budget_exhausted" : "failed";
    const fallback: ClaimFoundryAgentCompletion = {
      runId: input.context.runId,
      contentId: input.context.contentId,
      terminalStatus,
      finalPackageId: null,
      finalPackageHash: null,
      abstentionReason: null,
      reviewReasons: [...persisted.pendingReviewReasons],
      summary: `${normalized.kind}: ${normalized.message}`.slice(0, 2_000),
    };
    sdkResult = {
      finalOutput: fallback,
      toolEvents: telemetry?.toolEvents ?? [],
      sdkEventTypes: [],
      runtimeEvidence: {
        runnerInvocations: 1,
        providerRequests: 0,
        continuationStrategy: "none",
      },
      metadata: {
        runId: input.context.runId,
        traceId: telemetry?.traceId ?? persisted.traceId ?? "unavailable",
        lastResponseId: null,
        model: input.model,
        modelTurns: 0,
        toolCalls: telemetry?.toolEvents.length ?? persisted.counters.toolCalls,
        usage: { inputTokens: null, outputTokens: null, totalTokens: null },
        durationMs: telemetry?.durationMs ?? 0,
        terminationReason: terminalStatus === "budget_exhausted" ? "budget_exceeded" : "failed",
      },
    };
  }
  const reconciled = await reconcileClaimFoundryCompletion({
    proposed: sdkResult.finalOutput,
    runId: input.context.runId,
    contentId: input.context.contentId,
    persistence: input.context.persistence,
  });
  if (sdkResult.metadata.toolCalls !== reconciled.state.counters.toolCalls) {
    throw new Error("CF6 SDK tool count does not reconcile with persisted tool counter");
  }
  return { ...reconciled, sdkResult };
}
