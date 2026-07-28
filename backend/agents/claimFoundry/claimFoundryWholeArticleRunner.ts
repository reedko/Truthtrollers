import { createRequire } from "node:module";
import type { ModelProvider } from "@openai/agents";
import { z } from "zod";
import {
  runAgent,
  type AgentRunResult,
} from "../shared/agentRuntime.js";
import { AgentRuntimeError } from "../shared/agentErrors.js";
import type { RunBudget } from "../shared/runBudget.js";
import {
  assertWholeArticleContext,
  buildWholeArticleAgentInput,
  buildWholeArticleContext,
  CF6_ARTICLE_CONTEXT_OPEN,
  supportsExplicitPromptCacheBreakpoint,
  type WholeArticleContextMetadata,
} from "./claimFoundryArticleContext.js";
import type { ClaimFoundryToolContext } from "./claimFoundryContext.js";
import {
  createWholeArticleClaimFoundryAgentDefinition,
  type WholeArticleAgentCompletion,
  type WholeArticleOperationalCompletion,
  type WholeArticleRunCompletion,
} from "./claimFoundryWholeArticleAgent.js";
import {
  createWholeArticleAssertionInputFilter,
} from "./claimFoundryInputFilter.js";
import {
  ClaimFoundryRequestAssertions,
} from "./claimFoundryRequestAssertions.js";
import { transitionState } from "./claimFoundryState.js";

const require = createRequire(import.meta.url);
const {
  encoding_for_model: encodingForModel,
  get_encoding: getEncoding,
} = require("tiktoken") as {
  encoding_for_model: (model: string) => {
    encode(value: string): Uint32Array;
    free(): void;
  };
  get_encoding: (encoding: string) => {
    encode(value: string): Uint32Array;
    free(): void;
  };
};

export const WHOLE_ARTICLE_CLAIM_FOUNDRY_RUNTIME_BUDGET:
Readonly<RunBudget> = Object.freeze({
  maxModelTurns: 6,
  maxToolCalls: 24,
  maxWallTimeMs: 180_000,
});

export type WholeArticleOperationalBudget = {
  maxUncachedInputTokens: number;
  maxCostEquivalentInputTokens: number;
  cachedInputCostCoefficient: number;
};

export const WHOLE_ARTICLE_OPERATIONAL_BUDGET:
Readonly<WholeArticleOperationalBudget> = Object.freeze({
  maxUncachedInputTokens: 45_000,
  maxCostEquivalentInputTokens: 60_000,
  cachedInputCostCoefficient: 0.1,
});

type WholeArticleBudgetReasonCode =
  WholeArticleOperationalCompletion["reasonCode"];
type WholeArticleOperationalBudgetReasonCode = Exclude<
  WholeArticleBudgetReasonCode,
  "TURN_BUDGET_EXHAUSTED"
>;

function operationalBudgetReason(
  requests: Awaited<
    ReturnType<ClaimFoundryToolContext["persistence"]["modelRequests"]>
  >,
  budget: Readonly<WholeArticleOperationalBudget>,
  inclusive: boolean,
): WholeArticleOperationalBudgetReasonCode | null {
  const uncached = requests.reduce(
    (sum, request) => sum + request.uncachedInputTokens,
    0,
  );
  const cached = requests.reduce(
    (sum, request) => sum + request.cachedInputTokens,
    0,
  );
  const costEquivalent =
    uncached + cached * budget.cachedInputCostCoefficient;
  const reached = (value: number, limit: number) =>
    inclusive ? value >= limit : value > limit;
  if (reached(costEquivalent, budget.maxCostEquivalentInputTokens)) {
    return "OPERATIONAL_COST_EQUIVALENT_BUDGET_EXHAUSTED";
  }
  if (reached(uncached, budget.maxUncachedInputTokens)) {
    return "OPERATIONAL_UNCACHED_INPUT_BUDGET_EXHAUSTED";
  }
  return null;
}

function tokenCounter(model: string) {
  let encoding;
  try {
    encoding = encodingForModel(model);
  } catch {
    encoding = getEncoding("o200k_base");
  }
  return {
    count(value: unknown) {
      return encoding.encode(
        typeof value === "string" ? value : JSON.stringify(value),
      ).length;
    },
    close() {
      encoding.free();
    },
  };
}

function serializedFixedTools(
  definition: ReturnType<typeof createWholeArticleClaimFoundryAgentDefinition>,
) {
  return definition.tools.map(tool => ({
    name: tool.name,
    description: tool.description,
    parameters: z.toJSONSchema(tool.parameters),
    strict: true,
  }));
}

async function recordNonTerminalExit(context: ClaimFoundryToolContext) {
  return context.persistence.mutate<{
    recorded: boolean;
    reasonCode?: "TOOL_REQUIRED_PROTOCOL_VIOLATION";
    retainedReasonCode?: "NON_TERMINAL_AGENT_EXIT";
  }>(
    context.runId,
    "record_non_terminal_agent_exit",
    `non-terminal-exit:${context.runId}`,
    {
      reasonCode: "TOOL_REQUIRED_PROTOCOL_VIOLATION",
      retainedReasonCode: "NON_TERMINAL_AGENT_EXIT",
    },
    state => {
      if ([
        "completed",
        "abstained",
        "awaiting_review",
        "budget_exhausted",
      ].includes(state.status)) {
        return { state, result: { recorded: false } };
      }
      const changed = transitionState({
        ...state,
        terminalReasonCode: "TOOL_REQUIRED_PROTOCOL_VIOLATION",
        pendingReviewReasons: [
          ...state.pendingReviewReasons,
          "TOOL_REQUIRED_PROTOCOL_VIOLATION",
          "NON_TERMINAL_AGENT_EXIT",
        ],
      }, "failed");
      return {
        state: changed,
        result: {
          recorded: true,
          reasonCode: "TOOL_REQUIRED_PROTOCOL_VIOLATION" as const,
          retainedReasonCode: "NON_TERMINAL_AGENT_EXIT" as const,
        },
      };
    },
  );
}

export async function recordWholeArticleBudgetExhaustion(
  context: ClaimFoundryToolContext,
  reasonCode: WholeArticleBudgetReasonCode,
) {
  const operational = reasonCode !== "TURN_BUDGET_EXHAUSTED";
  const toolName = operational
    ? "record_operational_budget_exhaustion"
    : "record_turn_budget_exhaustion";
  return context.persistence.mutate(
    context.runId,
    toolName,
    `budget-exhaustion:${reasonCode}:${context.runId}`,
    { reasonCode },
    state => {
      if (state.status === "budget_exhausted") {
        return {
          state,
          result: {
            status: "budget_exhausted" as const,
            reasonCode,
          },
        };
      }
      if (["completed", "abstained", "awaiting_review", "failed"]
        .includes(state.status)) {
        throw new AgentRuntimeError(
          "runtime",
          `Cannot record budget exhaustion from terminal state ${state.status}`,
        );
      }
      const changed = transitionState({
        ...state,
        terminalReasonCode: reasonCode,
        pendingReviewReasons: [
          ...state.pendingReviewReasons,
          reasonCode,
        ],
      }, "budget_exhausted");
      return {
        state: changed,
        result: {
          status: "budget_exhausted" as const,
          reasonCode,
        },
      };
    },
  );
}

export async function recordWholeArticleTurnBudgetExhaustion(
  context: ClaimFoundryToolContext,
) {
  return recordWholeArticleBudgetExhaustion(
    context,
    "TURN_BUDGET_EXHAUSTED",
  );
}

export async function runWholeArticleClaimFoundry(input: {
  context: ClaimFoundryToolContext;
  model: string;
  conversationId: string;
  apiKey?: string;
  modelProvider?: ModelProvider;
  articleMetadata?: WholeArticleContextMetadata;
  runtimeBudget?: RunBudget;
  operationalBudget?: WholeArticleOperationalBudget;
  cacheReportingToleranceTokens?: number;
}) {
  const state = await input.context.persistence.load(input.context.runId);
  if (!state) {
    throw new Error("CF6 persisted run state must exist before the agent run");
  }
  if (state.continuation?.strategy !== "conversationId" ||
    state.continuation.id !== input.conversationId) {
    throw new AgentRuntimeError(
      "configuration",
      "CF6 persisted conversation identity does not match the agent run",
    );
  }

  const definition = createWholeArticleClaimFoundryAgentDefinition({
    context: input.context,
    model: input.model,
  });
  const article = buildWholeArticleContext({
    document: input.context.articleDocument,
    metadata: input.articleMetadata,
  });
  assertWholeArticleContext(article, input.context.articleDocument);
  const counter = tokenCounter(input.model);
  const stablePrefix = {
    instructionTokens: counter.count(definition.instructions),
    fixedToolSchemaTokens: counter.count(serializedFixedTools(definition)),
    articleTokens: counter.count(article.text),
  };
  counter.close();

  const explicitCacheBreakpointSupported =
    supportsExplicitPromptCacheBreakpoint(input.model);
  const assertions = new ClaimFoundryRequestAssertions({
    conversationId: input.conversationId,
    stablePrefix,
    reportingToleranceTokens: input.cacheReportingToleranceTokens ?? 256,
    explicitCacheBreakpointExpected: explicitCacheBreakpointSupported,
  });
  const operationalBudget =
    input.operationalBudget ?? WHOLE_ARTICLE_OPERATIONAL_BUDGET;
  let pendingOperationalBudgetReason:
    WholeArticleOperationalBudgetReasonCode | null = null;
  const initialInput = buildWholeArticleAgentInput({
    article,
    explicitCacheBreakpoint: explicitCacheBreakpointSupported,
    trailingWorkbench: {
      runId: state.runId,
      contentId: state.contentId,
      contentHash: state.contentHash,
      sourceUnitManifestHash: state.sourceUnitManifestHash,
      initialPackageRevision: 0,
      instructionVersion: state.versions.instruction,
      toolSchemaVersion: state.versions.toolSchema,
    },
  });

  let sdkResult: AgentRunResult<WholeArticleRunCompletion>;
  try {
    sdkResult = await runAgent({
      definition,
      input: initialInput,
      model: input.model,
      apiKey: input.apiKey,
      modelProvider: input.modelProvider,
      budget: input.runtimeBudget ?? WHOLE_ARTICLE_CLAIM_FOUNDRY_RUNTIME_BUDGET,
      runtimeRunId: input.context.runId,
      workflowName: "CF6 whole-article ClaimFoundry",
      traceMetadata: {
        runId: state.runId,
        contentId: state.contentId,
        milestone: "CF6-whole-article-v2.1",
      },
      conversationId: input.conversationId,
      maxFunctionToolConcurrency: 1,
      articleMarker: CF6_ARTICLE_CONTEXT_OPEN,
      callModelInputFilter: createWholeArticleAssertionInputFilter(),
      beforeModelRequest: async snapshot => {
        const prior = await input.context.persistence.modelRequests(state.runId);
        pendingOperationalBudgetReason ??= operationalBudgetReason(
          prior,
          operationalBudget,
          true,
        );
        if (pendingOperationalBudgetReason) {
          throw new AgentRuntimeError(
            "budget",
            "CF6 operational budget exhausted before the next request: " +
            pendingOperationalBudgetReason,
          );
        }
        assertions.beforeModelRequest(snapshot);
      },
      afterModelRequest: async observation => {
        await input.context.persistence.recordModelRequest({
          runId: state.runId,
          ...observation,
        });
        assertions.afterModelRequest(observation);
        const requests = await input.context.persistence.modelRequests(state.runId);
        pendingOperationalBudgetReason = operationalBudgetReason(
          requests,
          operationalBudget,
          false,
        );
      },
    });
  } catch (error) {
    const turnBudgetExhausted = error instanceof AgentRuntimeError &&
      error.kind === "budget" &&
      /Max turns/i.test(error.message);
    const reasonCode: WholeArticleBudgetReasonCode | null =
      pendingOperationalBudgetReason ??
      (turnBudgetExhausted ? "TURN_BUDGET_EXHAUSTED" : null);
    if (!(error instanceof AgentRuntimeError) ||
      error.kind !== "budget" ||
      !reasonCode) {
      throw error;
    }
    const exhausted =
      await recordWholeArticleBudgetExhaustion(input.context, reasonCode);
    const requests = await input.context.persistence.modelRequests(state.runId);
    const inputTokens = requests.reduce(
      (sum, request) => sum + request.inputTokens,
      0,
    );
    const outputTokens = requests.reduce(
      (sum, request) => sum + request.outputTokens,
      0,
    );
    const completion: WholeArticleOperationalCompletion = {
      status: "budget_exhausted",
      finalPackageId: null,
      finalPackageHash: null,
      packageRevision:
        exhausted.state.wholeArticleWorkingPackage?.packageRevision ?? null,
      reasonCode,
    };
    sdkResult = {
      finalOutput: completion,
      toolEvents: error.telemetry?.toolEvents ?? [],
      sdkEventTypes: [],
      runtimeEvidence: {
        runnerInvocations: 1,
        providerRequests: requests.length,
        continuationStrategy: "conversationId",
      },
      metadata: {
        runId: state.runId,
        traceId: error.telemetry?.traceId ?? state.traceId ?? "unavailable",
        lastResponseId: requests.at(-1)?.responseId ?? null,
        model: input.model,
        modelTurns: requests.length,
        toolCalls: exhausted.state.counters.toolCalls,
        usage: {
          inputTokens,
          outputTokens,
          totalTokens: inputTokens + outputTokens,
        },
        durationMs: error.telemetry?.durationMs ?? 0,
        terminationReason: "budget_exceeded",
      },
    };
  }

  const persisted = await input.context.persistence.load(state.runId);
  if (!persisted ||
    ![
      "completed",
      "abstained",
      "awaiting_review",
      "budget_exhausted",
    ].includes(persisted.status)) {
    await recordNonTerminalExit(input.context);
    throw new AgentRuntimeError(
      "model_behavior",
      "TOOL_REQUIRED_PROTOCOL_VIOLATION: NON_TERMINAL_AGENT_EXIT",
    );
  }
  const completion = persisted.status === "budget_exhausted"
    ? z.object({
        status: z.literal("budget_exhausted"),
        reasonCode: z.enum([
          "TURN_BUDGET_EXHAUSTED",
          "OPERATIONAL_UNCACHED_INPUT_BUDGET_EXHAUSTED",
          "OPERATIONAL_COST_EQUIVALENT_BUDGET_EXHAUSTED",
        ]),
      }).passthrough().parse(sdkResult.finalOutput)
    : z.object({
        status: z.enum(["completed", "abstained", "awaiting_review"]),
      }).passthrough().parse(sdkResult.finalOutput);
  if (completion.status !== persisted.status) {
    throw new AgentRuntimeError(
      "runtime",
      "CF6 terminal tool receipt does not match persisted run status",
    );
  }

  const requests = await input.context.persistence.modelRequests(state.runId);
  const grossInputTokens = requests.reduce(
    (sum, request) => sum + request.inputTokens,
    0,
  );
  const cachedInputTokens = requests.reduce(
    (sum, request) => sum + request.cachedInputTokens,
    0,
  );
  const uncachedInputTokens = requests.reduce(
    (sum, request) => sum + request.uncachedInputTokens,
    0,
  );
  const costEquivalentInputTokens = uncachedInputTokens +
    cachedInputTokens * operationalBudget.cachedInputCostCoefficient;

  return {
    sdkResult,
    state: persisted,
    finalPackage: persisted.finalPackageId
      ? await input.context.persistence.loadWholeArticleFinalPackage(
          persisted.finalPackageId,
        )
      : null,
    requestEvidence: assertions.evidence(),
    usageEvidence: {
      grossInputTokens,
      cachedInputTokens,
      uncachedInputTokens,
      costEquivalentInputTokens,
      articleTokens: stablePrefix.articleTokens,
      articleCostMultiplier: costEquivalentInputTokens /
        stablePrefix.articleTokens,
    },
  };
}
