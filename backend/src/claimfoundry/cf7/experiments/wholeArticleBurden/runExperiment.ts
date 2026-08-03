import type {
  Cf7StructuredProvider,
} from "../../../shared/provider/index.js";
import { canonicalHash } from "../../../shared/sourceUnits/index.js";
import {
  buildWholeArticleBurdenUserPrompt,
} from "./prompt.js";
import {
  WHOLE_ARTICLE_BURDEN_JSON_SCHEMA,
  wholeArticleBurdenOutputSchema,
} from "./schema.js";
import type {
  SemanticGroupingConfig,
  WholeArticleBurdenFrozenInput,
  WholeArticleBurdenRunResult,
} from "./types.js";

export const DEFAULT_WHOLE_ARTICLE_BURDEN_CONFIG: Readonly<
  SemanticGroupingConfig
> = Object.freeze({
  model: "gpt-4o-mini",
  temperature: 0.1,
  maximumConcurrency: 1,
  maxOutputTokens: 6_000,
  timeoutMs: 180_000,
  retryCount: 0,
  store: false,
});

export async function runWholeArticleBurdenExperiment(input: {
  frozen: WholeArticleBurdenFrozenInput;
  provider: Cf7StructuredProvider;
  beforeInvoke?: (request: Record<string, unknown>) => Promise<void>;
  afterResponse?: (input: {
    rawResponse: unknown;
    metadata: Record<string, unknown>;
  }) => Promise<void>;
  config?: SemanticGroupingConfig;
}): Promise<WholeArticleBurdenRunResult> {
  const config = input.config ?? DEFAULT_WHOLE_ARTICLE_BURDEN_CONFIG;
  if (
    config.maximumConcurrency !== 1
    || config.retryCount !== 0
    || config.store !== false
  ) {
    throw new Error("Invalid whole-article burden experiment configuration");
  }
  const request = {
    system: "",
    user: buildWholeArticleBurdenUserPrompt(input.frozen.article.text),
    responseSchema: WHOLE_ARTICLE_BURDEN_JSON_SCHEMA,
    model: config.model,
    temperature: config.temperature,
    retryCount: config.retryCount,
    store: config.store,
    maxOutputTokens: config.maxOutputTokens,
    timeoutMs: config.timeoutMs,
  };
  await input.beforeInvoke?.(request);
  const startedAt = performance.now();
  try {
    const response = await input.provider.invokeStructured(request);
    const latencyMs = Math.round(performance.now() - startedAt);
    await input.afterResponse?.({
      rawResponse: response.rawResponse ?? response,
      metadata: {
        model: response.model,
        responseId: response.responseId,
        providerRequestId: response.requestId,
        usage: response.usage,
        latencyMs,
        capturedBeforeValidation: true,
      },
    });
    const parsed = wholeArticleBurdenOutputSchema.safeParse(response.output);
    return {
      status: parsed.success ? "completed" : "failed",
      providerCallCount: 1,
      output: parsed.success ? parsed.data : null,
      rawOutput: response.output,
      schemaIssues: parsed.success ? [] : parsed.error.issues,
      responseId: response.responseId,
      requestId: response.requestId,
      model: response.model,
      usage: response.usage,
      latencyMs,
      requestHash: canonicalHash(request),
      error: null,
      configuration: { ...config },
    };
  } catch (error) {
    return {
      status: "failed",
      providerCallCount: 1,
      output: null,
      rawOutput: null,
      schemaIssues: [],
      responseId: null,
      requestId: null,
      model: config.model,
      usage: {
        inputTokens: 0,
        cachedInputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
      },
      latencyMs: Math.round(performance.now() - startedAt),
      requestHash: canonicalHash(request),
      error: {
        name: error instanceof Error ? error.name : "Error",
        message: error instanceof Error ? error.message : String(error),
      },
      configuration: { ...config },
    };
  }
}
