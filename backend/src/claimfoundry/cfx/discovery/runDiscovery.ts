import type {
  Cf7StructuredModelRequest,
} from "../../shared/provider/index.js";
import {
  canonicalHash,
} from "../../shared/sourceUnits/index.js";
import {
  CFX_DISCOVERY_JSON_SCHEMA,
  cfxDiscoveryOutputSchema,
} from "../schemas/discoverySchema.js";
import type {
  CfxGovernedPrompt,
} from "../prompts/loadPrompt.js";
import type {
  CfxCanonicalInventory,
  CfxDiagnostic,
  CfxDiscoveryResult,
  CfxFrozenArticle,
  CfxProviderConfig,
  CfxStructuredProvider,
} from "../types/index.js";

export const DEFAULT_CFX_DISCOVERY_CONFIG: Readonly<CfxProviderConfig> =
  Object.freeze({
    model: "gpt-4o-mini",
    temperature: 0.1,
    maximumConcurrency: 1,
    maxOutputTokens: 6_000,
    timeoutMs: 180_000,
    retryCount: 0,
    store: false,
  });

export function buildCfxDiscoveryRequest(input: {
  article: CfxFrozenArticle;
  prompt: CfxGovernedPrompt;
  config?: CfxProviderConfig;
}): Cf7StructuredModelRequest {
  const config = input.config ?? DEFAULT_CFX_DISCOVERY_CONFIG;
  if (
    config.maximumConcurrency !== 1
    || config.retryCount !== 0
    || config.store !== false
  ) {
    throw new Error("Invalid CFX S1 discovery configuration");
  }
  return {
    system: "",
    user: `${input.prompt.prompt}\n\n${input.article.articleText}`,
    responseSchema: CFX_DISCOVERY_JSON_SCHEMA,
    model: config.model,
    temperature: config.temperature,
    retryCount: config.retryCount,
    store: config.store,
    maxOutputTokens: config.maxOutputTokens,
    timeoutMs: config.timeoutMs,
  };
}

function duplicateDiagnostics(assertions: string[]): CfxDiagnostic[] {
  const normalized = assertions.map((value) =>
    value.toLocaleLowerCase("en-US").replace(/\s+/g, " ").trim());
  return normalized.flatMap((value, index) => {
    const first = normalized.indexOf(value);
    return first === index
      ? []
      : [{
          code: "DUPLICATE_NORMALIZED_ASSERTION",
          propositionId: `P${String(index + 1).padStart(2, "0")}`,
          path: `propositions.${index}.assertion`,
          message: `Assertion duplicates proposition ${first + 1} after byte-stable normalization`,
        }];
  });
}

export async function runCfxDiscovery(input: {
  article: CfxFrozenArticle;
  prompt: CfxGovernedPrompt;
  provider: CfxStructuredProvider;
  config?: CfxProviderConfig;
  beforeInvoke?: (request: Cf7StructuredModelRequest) => Promise<void>;
  afterResponse?: (input: {
    rawResponse: unknown;
    parsedOutput: unknown;
    metadata: Record<string, unknown>;
  }) => Promise<void>;
}): Promise<CfxDiscoveryResult> {
  const config = input.config ?? DEFAULT_CFX_DISCOVERY_CONFIG;
  const request = buildCfxDiscoveryRequest({
    article: input.article,
    prompt: input.prompt,
    config,
  });
  const requestHash = canonicalHash(request);
  const schemaHash = canonicalHash(CFX_DISCOVERY_JSON_SCHEMA);
  await input.beforeInvoke?.(request);
  const startedAt = performance.now();
  try {
    const response = await input.provider.invokeStructured(request);
    const latencyMs = Math.round(performance.now() - startedAt);
    await input.afterResponse?.({
      rawResponse: response.rawResponse ?? response,
      parsedOutput: response.output,
      metadata: {
        model: response.model,
        responseId: response.responseId,
        providerRequestId: response.requestId,
        usage: response.usage,
        latencyMs,
        capturedBeforeValidation: true,
      },
    });
    const parsed = cfxDiscoveryOutputSchema.safeParse(response.output);
    const diagnostics: CfxDiagnostic[] = parsed.success
      ? duplicateDiagnostics(parsed.data.propositions.map((row) => row.assertion))
      : parsed.error.issues.map((issue) => ({
          code: "S1_SCHEMA_VIOLATION",
          path: issue.path.join("."),
          message: issue.message,
        }));
    const canonicalInventory: CfxCanonicalInventory | null =
      parsed.success && diagnostics.length === 0
        ? {
            schemaVersion: "cfx.canonicalPropositions.v1",
            fixtureId: input.article.fixtureId,
            propositions: parsed.data.propositions.map((row, index) => ({
              propositionId: `P${String(index + 1).padStart(2, "0")}`,
              ...row,
            })),
          }
        : null;
    return {
      status: canonicalInventory ? "completed" : "failed",
      providerCallCount: 1,
      canonicalInventory,
      rawOutput: response.output,
      diagnostics,
      responseId: response.responseId,
      requestId: response.requestId,
      model: response.model,
      usage: response.usage,
      latencyMs,
      requestHash,
      promptHash: input.prompt.promptHash,
      schemaHash,
      error: null,
      configuration: { ...config },
    };
  } catch (error) {
    return {
      status: "failed",
      providerCallCount: 1,
      canonicalInventory: null,
      rawOutput: null,
      diagnostics: [{
        code: "S1_PROVIDER_FAILURE",
        message: error instanceof Error ? error.message : String(error),
      }],
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
      requestHash,
      promptHash: input.prompt.promptHash,
      schemaHash,
      error: {
        name: error instanceof Error ? error.name : "Error",
        message: error instanceof Error ? error.message : String(error),
      },
      configuration: { ...config },
    };
  }
}
