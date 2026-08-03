import type {
  Cf7StructuredModelRequest,
} from "../../shared/provider/index.js";
import {
  canonicalHash,
} from "../../shared/sourceUnits/index.js";
import type {
  CfxGovernedPrompt,
} from "../prompts/loadPrompt.js";
import {
  CFX_DISCOVERY_WITH_UNITS_JSON_SCHEMA,
  cfxDiscoveryWithUnitsOutputSchema,
} from "../schemas/discoveryWithUnitsSchema.js";
import type {
  CfxDiagnostic,
  CfxFrozenArticle,
  CfxProviderConfig,
  CfxStructuredProvider,
} from "../types/index.js";
import type {
  CfxUnitAwareDiscoveryResult,
  CfxUnitAwareInventory,
} from "./types.js";
import {
  configuredUnitWidth,
  normalizeCfxUnitId,
} from "./normalizeUnitIds.js";

export const DEFAULT_CFX_DISCOVERY_WITH_UNITS_CONFIG: Readonly<
  CfxProviderConfig
> = Object.freeze({
  model: "gpt-4o-mini",
  temperature: 0.1,
  maximumConcurrency: 1,
  maxOutputTokens: 6_000,
  timeoutMs: 180_000,
  retryCount: 0,
  store: false,
});

export function buildCfxDiscoveryWithUnitsRequest(input: {
  article: CfxFrozenArticle;
  prompt: CfxGovernedPrompt;
  config?: CfxProviderConfig;
}): Cf7StructuredModelRequest {
  const config = input.config ?? DEFAULT_CFX_DISCOVERY_WITH_UNITS_CONFIG;
  if (
    config.maximumConcurrency !== 1
    || config.retryCount !== 0
    || config.store !== false
  ) {
    throw new Error("Invalid CFX unit-aware discovery configuration");
  }
  return {
    system: "",
    user: `${input.prompt.prompt}\n\n${input.article.unitProjection}`,
    responseSchema: CFX_DISCOVERY_WITH_UNITS_JSON_SCHEMA,
    model: config.model,
    temperature: config.temperature,
    retryCount: config.retryCount,
    store: config.store,
    maxOutputTokens: config.maxOutputTokens,
    timeoutMs: config.timeoutMs,
  };
}

function structuralDiagnostics(input: {
  article: CfxFrozenArticle;
  rows: Array<{
    assertion: string;
    groundingUnitIds: string[];
  }>;
}): CfxDiagnostic[] {
  const diagnostics: CfxDiagnostic[] = [];
  const knownUnits = new Set(input.article.sourceUnits.map((unit) => unit.unitId));
  const normalizedAssertions = input.rows.map((row) =>
    row.assertion.toLocaleLowerCase("en-US").replace(/\s+/g, " ").trim());
  input.rows.forEach((row, rowIndex) => {
    const propositionId = `P${String(rowIndex + 1).padStart(2, "0")}`;
    if (normalizedAssertions.indexOf(normalizedAssertions[rowIndex]!) !== rowIndex) {
      diagnostics.push({
        code: "DUPLICATE_NORMALIZED_ASSERTION",
        propositionId,
        path: `propositions.${rowIndex}.assertion`,
        message: "Assertion duplicates an earlier proposition after normalization",
      });
    }
    const seen = new Set<string>();
    row.groundingUnitIds.forEach((unitId, unitIndex) => {
      if (!knownUnits.has(unitId)) {
        diagnostics.push({
          code: "UNKNOWN_GROUNDING_UNIT_ID",
          propositionId,
          path: `propositions.${rowIndex}.groundingUnitIds.${unitIndex}`,
          message: `Unknown S0 source unit ${unitId}`,
        });
      }
      if (seen.has(unitId)) {
        diagnostics.push({
          code: "DUPLICATE_GROUNDING_UNIT_ID",
          propositionId,
          path: `propositions.${rowIndex}.groundingUnitIds.${unitIndex}`,
          message: `Duplicate S0 source unit ${unitId}`,
        });
      }
      seen.add(unitId);
    });
  });
  return diagnostics;
}

function normalizeReturnedGroundingUnitIds(input: {
  article: CfxFrozenArticle;
  output: unknown;
}): {
  normalizedOutput: unknown;
  diagnostics: CfxDiagnostic[];
  rejected: boolean;
} {
  const authoritativeUnitIds = input.article.sourceUnits.map(
    (unit) => unit.unitId,
  );
  const width = configuredUnitWidth(authoritativeUnitIds);
  const diagnostics: CfxDiagnostic[] = [];
  let rejected = false;
  if (
    typeof input.output !== "object"
    || input.output === null
    || !Array.isArray((input.output as { propositions?: unknown }).propositions)
  ) {
    return { normalizedOutput: input.output, diagnostics, rejected };
  }
  const normalizedOutput = structuredClone(input.output) as {
    propositions: unknown[];
  };
  normalizedOutput.propositions.forEach((candidate, rowIndex) => {
    if (
      typeof candidate !== "object"
      || candidate === null
      || !Array.isArray(
        (candidate as { groundingUnitIds?: unknown }).groundingUnitIds,
      )
    ) {
      return;
    }
    const propositionId = `P${String(rowIndex + 1).padStart(2, "0")}`;
    const row = candidate as { groundingUnitIds: unknown[] };
    row.groundingUnitIds = row.groundingUnitIds.map(
      (returnedUnitId, unitIndex) => {
        const result = normalizeCfxUnitId({
          returnedUnitId,
          authoritativeUnitIds,
          unitWidth: width,
        });
        const path =
          `propositions.${rowIndex}.groundingUnitIds.${unitIndex}`;
        if (result.status === "rejected") {
          rejected = true;
          diagnostics.push({
            code: result.reason,
            propositionId,
            path,
            message: result.reason === "MALFORMED_UNIT_ID"
              ? "Grounding unit ID must have the exact shape U followed by digits"
              : result.reason === "NONEXISTENT_UNIT_ID"
              ? `Normalized grounding unit does not exist in fixture ${input.article.fixtureId}`
              : `Normalized grounding unit does not resolve uniquely in fixture ${input.article.fixtureId}`,
            comparison: {
              originalReturnedValue: result.originalUnitId,
              canonicalUnitId: result.canonicalUnitId,
              configuredUnitWidth: result.configuredUnitWidth,
              normalizationOccurred: result.normalizationOccurred,
              resolutionCount: result.resolutionCount,
              fixtureId: input.article.fixtureId,
            },
          });
          return returnedUnitId;
        }
        if (result.normalizationOccurred) {
          diagnostics.push({
            code: "GROUNDING_UNIT_ID_NORMALIZED",
            propositionId,
            path,
            message:
              `Normalized ${result.originalUnitId} to ${result.canonicalUnitId}`,
            comparison: {
              originalReturnedValue: result.originalUnitId,
              canonicalUnitId: result.canonicalUnitId,
              configuredUnitWidth: result.configuredUnitWidth,
              normalizationOccurred: result.normalizationOccurred,
              resolutionCount: result.resolutionCount,
              fixtureId: input.article.fixtureId,
            },
          });
        }
        return result.canonicalUnitId;
      },
    );
  });
  return { normalizedOutput, diagnostics, rejected };
}

export async function runCfxDiscoveryWithUnits(input: {
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
}): Promise<CfxUnitAwareDiscoveryResult> {
  const config = input.config ?? DEFAULT_CFX_DISCOVERY_WITH_UNITS_CONFIG;
  const request = buildCfxDiscoveryWithUnitsRequest({
    article: input.article,
    prompt: input.prompt,
    config,
  });
  const requestHash = canonicalHash(request);
  const schemaHash = canonicalHash(CFX_DISCOVERY_WITH_UNITS_JSON_SCHEMA);
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
    const normalization = normalizeReturnedGroundingUnitIds({
      article: input.article,
      output: response.output,
    });
    const parsed = cfxDiscoveryWithUnitsOutputSchema.safeParse(
      normalization.normalizedOutput,
    );
    const validationDiagnostics: CfxDiagnostic[] = parsed.success
      ? structuralDiagnostics({
          article: input.article,
          rows: parsed.data.propositions,
        })
      : parsed.error.issues.map((issue) => ({
          code: "UNIT_AWARE_SCHEMA_VIOLATION",
          path: issue.path.join("."),
          message: issue.message,
        }));
    const diagnostics = [
      ...normalization.diagnostics,
      ...validationDiagnostics,
    ];
    const inventory: CfxUnitAwareInventory | null =
      parsed.success
      && !normalization.rejected
      && validationDiagnostics.length === 0
        ? {
            schemaVersion: "cfx.unitAwarePropositions.v1",
            fixtureId: input.article.fixtureId,
            propositions: parsed.data.propositions.map((row, index) => ({
              propositionId: `P${String(index + 1).padStart(2, "0")}`,
              ...row,
            })),
          }
        : null;
    return {
      status: inventory ? "completed" : "failed",
      providerCallCount: 1,
      inventory,
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
      inventory: null,
      rawOutput: null,
      diagnostics: [{
        code: "UNIT_AWARE_PROVIDER_FAILURE",
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
