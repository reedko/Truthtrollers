import {
  Agent,
  Runner,
  generateTraceId,
  tool,
  type CallModelInputFilter,
  type AgentInputItem,
  type Model,
  type ModelProvider,
  type ModelRequest,
  type ModelResponse,
  type ModelSettings,
  type RunItem,
  type ToolUseBehavior,
} from "@openai/agents";
import type { ZodObject, ZodRawShape } from "zod";
import { createHash, randomUUID } from "node:crypto";
import { AgentRuntimeError, normalizeAgentError } from "./agentErrors.js";
import { createModelProvider } from "./modelProvider.js";
import { assertPositiveBudget, type RunBudget } from "./runBudget.js";
import type { NormalizedTraceMetadata, ToolEvent } from "./traceMetadata.js";

export type RuntimeTool<TShape extends ZodRawShape, TResult> = {
  name: string;
  description: string;
  parameters: ZodObject<TShape>;
  execute: (
    input: ReturnType<ZodObject<TShape>["parse"]>,
    invocation?: { toolCallId: string | null },
  ) => Promise<TResult> | TResult;
  isEnabled?: () => Promise<boolean> | boolean;
};

export type AgentDefinition<TOutput> = {
  name: string;
  instructions: string;
  outputType: ZodObject<any>;
  tools: RuntimeTool<any, any>[];
  modelSettings?: ModelSettings;
  toolUseBehavior?: ToolUseBehavior;
  resetToolChoice?: boolean;
};

export type AgentRunResult<TOutput> = {
  finalOutput: TOutput;
  metadata: NormalizedTraceMetadata;
  toolEvents: ToolEvent[];
  sdkEventTypes: string[];
  runtimeEvidence: {
    runnerInvocations: 1;
    providerRequests: number;
    continuationStrategy: "conversationId" | "previousResponseId" | "none";
  };
};

export type ModelRequestSnapshot = {
  turn: number;
  model: string;
  toolsExposed: string[];
  modelVisibleInputHash: string;
  instructionHash: string;
  toolSchemaHash: string;
  clientInputHash: string;
  clientInputBytes: number;
  clientInputItemCount: number;
  articleMarkerOccurrences: number;
  explicitCacheBreakpointCount: number;
  conversationId: string | null;
  previousResponseId: string | null;
  estimatedInputTokens: number;
  payloadClassTokens: Record<string, number>;
  createdAt: string;
};

export type ModelRequestObservation = ModelRequestSnapshot & {
  responseId: string | null;
  requestId: string | null;
  inputTokens: number;
  cachedInputTokens: number;
  uncachedInputTokens: number;
  outputTokens: number;
  totalTokens: number;
  toolSelected: string | null;
};

function estimatedTokens(value: unknown) {
  return Math.ceil(JSON.stringify(value).length / 4);
}

function occurrences(text: string, marker: string | undefined) {
  if (!marker) return 0;
  let count = 0;
  let offset = 0;
  while ((offset = text.indexOf(marker, offset)) >= 0) {
    count += 1;
    offset += marker.length;
  }
  return count;
}

function requestSnapshot(
  request: ModelRequest,
  turn: number,
  model: string,
  articleMarker?: string,
): ModelRequestSnapshot {
  const toolsExposed = request.tools.map(tool => tool.name);
  const serializedInstructions = JSON.stringify(request.systemInstructions ?? "");
  const serializedTools = JSON.stringify(request.tools);
  const serializedInput = JSON.stringify(request.input);
  const payloadClassTokens = {
    instructions: estimatedTokens(request.systemInstructions ?? ""),
    tools: estimatedTokens(request.tools),
    input: estimatedTokens(request.input),
    terminalSchema: estimatedTokens(request.outputType ?? {}),
  };
  const visible = {
    instructions: request.systemInstructions,
    tools: request.tools,
    input: request.input,
    outputType: request.outputType,
  };
  return {
    turn, model, toolsExposed,
    modelVisibleInputHash: createHash("sha256").update(JSON.stringify(visible)).digest("hex"),
    instructionHash: createHash("sha256").update(serializedInstructions).digest("hex"),
    toolSchemaHash: createHash("sha256").update(serializedTools).digest("hex"),
    clientInputHash: createHash("sha256").update(serializedInput).digest("hex"),
    clientInputBytes: Buffer.byteLength(serializedInput),
    clientInputItemCount: Array.isArray(request.input) ? request.input.length : 1,
    articleMarkerOccurrences: occurrences(serializedInput, articleMarker),
    explicitCacheBreakpointCount: occurrences(serializedInput, "promptCacheBreakpoint"),
    conversationId: request.conversationId ?? null,
    previousResponseId: request.previousResponseId ?? null,
    estimatedInputTokens: Object.values(payloadClassTokens).reduce((sum, value) => sum + value, 0),
    payloadClassTokens,
    createdAt: new Date().toISOString(),
  };
}

function selectedTool(response: ModelResponse): string | null {
  const call = response.output.find(item =>
    item && typeof item === "object" && "type" in item &&
    ["function_call", "tool_call"].includes(String(item.type)));
  return call && "name" in call && typeof call.name === "string" ? call.name : null;
}

export async function runAgent<TOutput>(options: {
  definition: AgentDefinition<TOutput>;
  input: string | AgentInputItem[];
  model: string;
  apiKey?: string;
  modelProvider?: ModelProvider;
  budget: RunBudget;
  runtimeRunId?: string;
  workflowName?: string;
  traceMetadata?: Record<string, string>;
  conversationId?: string;
  previousResponseId?: string;
  maxFunctionToolConcurrency?: number | null;
  articleMarker?: string;
  callModelInputFilter?: CallModelInputFilter;
  beforeModelRequest?: (snapshot: ModelRequestSnapshot) => Promise<void>;
  afterModelRequest?: (observation: ModelRequestObservation) => Promise<void>;
}): Promise<AgentRunResult<TOutput>> {
  assertPositiveBudget(options.budget);
  if (options.conversationId && options.previousResponseId) {
    throw new AgentRuntimeError(
      "runtime",
      "Choose exactly one server-managed continuation strategy",
    );
  }
  if (!options.modelProvider && !options.apiKey) {
    throw new AgentRuntimeError(
      "runtime",
      "An API key or injected model provider is required",
    );
  }
  const runId = options.runtimeRunId ?? randomUUID();
  const traceId = generateTraceId();
  const startedAt = performance.now();
  const toolEvents: ToolEvent[] = [];
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.budget.maxWallTimeMs);

  const sdkTools = options.definition.tools.map((definition) =>
    tool({
      name: definition.name,
      description: definition.description,
      parameters: definition.parameters,
      strict: true,
      execute: async (input, _runContext, details) => {
        if (toolEvents.length >= options.budget.maxToolCalls) {
          throw new AgentRuntimeError(
            "budget",
            `Tool-call budget exceeded (${options.budget.maxToolCalls})`,
          );
        }
        const toolStartedAt = performance.now();
        const output = await definition.execute(input, {
          toolCallId: details?.toolCall?.callId ?? null,
        });
        toolEvents.push({
          name: definition.name,
          validatedArguments: input,
          output,
          durationMs: Math.round(performance.now() - toolStartedAt),
        });
        return output;
      },
      isEnabled: definition.isEnabled,
    }),
  );

  const agent = new Agent({
    name: options.definition.name,
    instructions: options.definition.instructions,
    model: options.model,
    tools: sdkTools,
    outputType: options.definition.outputType,
    modelSettings: options.definition.modelSettings,
    toolUseBehavior: options.definition.toolUseBehavior,
    resetToolChoice: options.definition.resetToolChoice,
  });
  const ownedProvider = options.modelProvider
    ? null
    : createModelProvider({ apiKey: options.apiKey! });
  const provider = options.modelProvider ?? ownedProvider!;
  let modelTurn = 0;
  const observedProvider: ModelProvider = {
    async getModel(modelName?: string): Promise<Model> {
      const underlying = await provider.getModel(modelName);
      return {
        getRetryAdvice: underlying.getRetryAdvice?.bind(underlying),
        async getResponse(request) {
          const nextModelTurn = modelTurn + 1;
          const snapshot = requestSnapshot(
            request,
            nextModelTurn,
            options.model,
            options.articleMarker,
          );
          await options.beforeModelRequest?.(snapshot);
          modelTurn = nextModelTurn;
          const response = await underlying.getResponse(request);
          const usage = response.usage;
          const requestUsage = usage.requestUsageEntries?.[0];
          const inputTokens = requestUsage?.inputTokens ?? usage.inputTokens ?? 0;
          const outputTokens = requestUsage?.outputTokens ?? usage.outputTokens ?? 0;
          const totalTokens = requestUsage?.totalTokens ?? usage.totalTokens ?? inputTokens + outputTokens;
          const details = requestUsage?.inputTokensDetails ??
            usage.inputTokensDetails?.[0] ?? {};
          const cachedInputTokens = Number(details.cached_tokens ?? details.cachedTokens ?? 0);
          await options.afterModelRequest?.({
            ...snapshot,
            responseId: response.responseId ?? null,
            requestId: response.requestId ?? null,
            inputTokens,
            cachedInputTokens,
            uncachedInputTokens: Math.max(0, inputTokens - cachedInputTokens),
            outputTokens,
            totalTokens,
            toolSelected: selectedTool(response),
          });
          return response;
        },
        getStreamedResponse(request) {
          return underlying.getStreamedResponse(request);
        },
      };
    },
  };
  const runner = new Runner({
    modelProvider: observedProvider,
    tracingDisabled: false,
    traceIncludeSensitiveData: false,
    workflowName: options.workflowName ?? "CF6 Milestone 1 smoke",
    traceId,
    traceMetadata: options.traceMetadata ?? { runId, milestone: "CF6-M1" },
  });

  try {
    const result = await runner.run(agent, options.input, {
      maxTurns: options.budget.maxModelTurns,
      signal: controller.signal,
      conversationId: options.conversationId,
      previousResponseId: options.previousResponseId,
      toolExecution: {
        maxFunctionToolConcurrency: options.maxFunctionToolConcurrency,
      },
      callModelInputFilter: options.callModelInputFilter,
    });
    if (result.finalOutput === undefined) {
      throw new AgentRuntimeError("runtime", "Agent completed without a final output");
    }
    const usage = result.runContext.usage;
    const modelTurns = result.rawResponses.length;
    if (modelTurns > options.budget.maxModelTurns) {
      throw new AgentRuntimeError("budget", "Model-turn budget exceeded");
    }
    if (toolEvents.length > options.budget.maxToolCalls) {
      throw new AgentRuntimeError("budget", "Tool-call budget exceeded");
    }
    return {
      finalOutput: result.finalOutput as TOutput,
      toolEvents,
      sdkEventTypes: result.newItems.map((item: RunItem) => item.type),
      runtimeEvidence: {
        runnerInvocations: 1,
        providerRequests: modelTurn,
        continuationStrategy: options.conversationId
          ? "conversationId"
          : options.previousResponseId
            ? "previousResponseId"
            : "none",
      },
      metadata: {
        runId,
        traceId,
        lastResponseId: result.lastResponseId ?? null,
        model: options.model,
        modelTurns,
        toolCalls: toolEvents.length,
        usage: {
          inputTokens: usage.inputTokens ?? null,
          outputTokens: usage.outputTokens ?? null,
          totalTokens: usage.totalTokens ?? null,
        },
        durationMs: Math.round(performance.now() - startedAt),
        terminationReason: "completed",
      },
    };
  } catch (error) {
    const normalized = normalizeAgentError(error);
    throw new AgentRuntimeError(normalized.kind, normalized.message, { cause: normalized }, {
      runId, traceId, model: options.model, toolEvents,
      durationMs: Math.round(performance.now() - startedAt),
    });
  } finally {
    clearTimeout(timeout);
    await ownedProvider?.close();
  }
}
