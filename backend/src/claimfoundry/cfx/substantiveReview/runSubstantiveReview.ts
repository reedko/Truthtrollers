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
  CFX_SUBSTANTIVE_REVIEW_JSON_SCHEMA,
  cfxSubstantiveReviewOutputSchema,
} from "../schemas/substantiveReviewSchema.js";
import type {
  CfxDiagnostic,
  CfxFrozenArticle,
  CfxProviderConfig,
  CfxStructuredProvider,
} from "../types/index.js";
import type {
  CfxUnitAwareInventory,
} from "../discoveryWithUnits/types.js";
import type {
  CfxSubstantiveReviewInventory,
  CfxSubstantiveReviewResult,
} from "./types.js";
import {
  attachCfxEvidenceSearchHandoffs,
} from "../evidenceSearch/buildEvidenceSearchHandoff.js";

export const DEFAULT_CFX_SUBSTANTIVE_REVIEW_CONFIG: Readonly<
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

function propositionProjection(
  inventory: CfxUnitAwareInventory,
): string {
  return inventory.propositions.map((proposition) => [
    "propositionId:",
    proposition.propositionId,
    "",
    "selectedAssertion:",
    proposition.assertion,
    "",
    "currentAssertionSource:",
    proposition.assertionSource,
    "",
    "whyItMattersToArticleThesis:",
    proposition.whyItMattersToArticleThesis,
    "",
    "associatedSourceUnitIds:",
    proposition.groundingUnitIds.join(", "),
  ].join("\n")).join("\n\n");
}

function sourceUnitProjection(article: CfxFrozenArticle): string {
  return article.sourceUnits.map(
    (unit) => `[${unit.unitId}]\n${unit.text}`,
  ).join("\n\n");
}

export function buildCfxSubstantiveReviewRequest(input: {
  article: CfxFrozenArticle;
  inventory: CfxUnitAwareInventory;
  prompt: CfxGovernedPrompt;
  config?: CfxProviderConfig;
}): Cf7StructuredModelRequest {
  const config = input.config ?? DEFAULT_CFX_SUBSTANTIVE_REVIEW_CONFIG;
  if (
    input.inventory.propositions.length !== 12
    || config.maximumConcurrency !== 1
    || config.retryCount !== 0
    || config.store !== false
  ) {
    throw new Error("Invalid CFX substantive-review configuration");
  }
  return {
    system: "",
    user: [
      input.prompt.prompt,
      "FIXED_PROPOSITIONS:",
      propositionProjection(input.inventory),
      "COMPLETE_UNIT_LABELLED_ARTICLE:",
      sourceUnitProjection(input.article),
    ].join("\n\n"),
    responseSchema: CFX_SUBSTANTIVE_REVIEW_JSON_SCHEMA,
    model: config.model,
    temperature: config.temperature,
    retryCount: config.retryCount,
    store: config.store,
    maxOutputTokens: config.maxOutputTokens,
    timeoutMs: config.timeoutMs,
  };
}

function coverageDiagnostics(input: {
  expectedIds: string[];
  actualIds: string[];
}): CfxDiagnostic[] {
  const diagnostics: CfxDiagnostic[] = [];
  const expected = new Set(input.expectedIds);
  const seen = new Set<string>();
  input.actualIds.forEach((propositionId, index) => {
    if (!expected.has(propositionId)) {
      diagnostics.push({
        code: "UNEXPECTED_PROPOSITION_ID",
        propositionId,
        path: `results.${index}.propositionId`,
        message: `Unexpected proposition ID ${propositionId}`,
      });
    }
    if (seen.has(propositionId)) {
      diagnostics.push({
        code: "DUPLICATE_PROPOSITION_ID",
        propositionId,
        path: `results.${index}.propositionId`,
        message: `Duplicate result for ${propositionId}`,
      });
    }
    seen.add(propositionId);
  });
  for (const propositionId of input.expectedIds) {
    if (!seen.has(propositionId)) {
      diagnostics.push({
        code: "MISSING_PROPOSITION_ID",
        propositionId,
        message: `Missing result for ${propositionId}`,
      });
    }
  }
  return diagnostics;
}

export async function runCfxSubstantiveReview(input: {
  article: CfxFrozenArticle;
  inventory: CfxUnitAwareInventory;
  sourceInventoryHash: string;
  prompt: CfxGovernedPrompt;
  provider: CfxStructuredProvider;
  config?: CfxProviderConfig;
  beforeInvoke?: (request: Cf7StructuredModelRequest) => Promise<void>;
  afterResponse?: (input: {
    rawResponse: unknown;
    parsedOutput: unknown;
    metadata: Record<string, unknown>;
  }) => Promise<void>;
}): Promise<CfxSubstantiveReviewResult> {
  const config = input.config ?? DEFAULT_CFX_SUBSTANTIVE_REVIEW_CONFIG;
  const request = buildCfxSubstantiveReviewRequest({
    article: input.article,
    inventory: input.inventory,
    prompt: input.prompt,
    config,
  });
  const requestHash = canonicalHash(request);
  const schemaHash = canonicalHash(CFX_SUBSTANTIVE_REVIEW_JSON_SCHEMA);
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
    const parsed = cfxSubstantiveReviewOutputSchema.safeParse(response.output);
    const diagnostics: CfxDiagnostic[] = parsed.success
      ? coverageDiagnostics({
          expectedIds: input.inventory.propositions.map(
            (item) => item.propositionId,
          ),
          actualIds: parsed.data.results.map((item) => item.propositionId),
        })
      : parsed.error.issues.map((issue) => ({
          code: "SUBSTANTIVE_REVIEW_SCHEMA_VIOLATION",
          path: issue.path.join("."),
          message: issue.message,
        }));
    const validatedInventory: CfxSubstantiveReviewInventory | null =
      parsed.success && diagnostics.length === 0
        ? {
            schemaVersion: "cfx.substantiveReview.v1",
            sourceUnitAwareInventoryHash: input.sourceInventoryHash,
            results: parsed.data.results.map((row) => {
              const { evidenceSearchHandoff: _ignored, ...rest } = row;
              return rest;
            }).sort((left, right) =>
              left.propositionId.localeCompare(right.propositionId)),
          }
        : null;
    const inventory = validatedInventory
      ? attachCfxEvidenceSearchHandoffs({
          reviewInventory: validatedInventory,
          sourceInventory: input.inventory,
          article: input.article,
        })
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
        code: "SUBSTANTIVE_REVIEW_PROVIDER_FAILURE",
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
