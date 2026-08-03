import {
  canonicalHash,
} from "../../shared/sourceUnits/index.js";
import type {
  CfxGovernedPrompt,
} from "../prompts/loadPrompt.js";
import type {
  CfxCanonicalInventory,
  CfxDiagnostic,
  CfxGroundingMode,
  CfxGroundingRequestOutcome,
  CfxGroundingRequestRecord,
  CfxProviderConfig,
  CfxRejectedGrounding,
  CfxS2ArmResult,
  CfxStructuredProvider,
  CfxFrozenArticle,
} from "../types/index.js";
import { buildCfxGroundingRequest } from "./buildGroundingRequest.js";
import { validateCfxGroundingResponse } from "./validateGrounding.js";

export const DEFAULT_CFX_GROUNDING_CONFIG: Readonly<CfxProviderConfig> =
  Object.freeze({
    model: "gpt-4o-mini",
    temperature: 0.1,
    maximumConcurrency: 4,
    maxOutputTokens: 6_000,
    timeoutMs: 180_000,
    retryCount: 0,
    store: false,
  });

type GroundingHooks = {
  beforeInvoke?: (record: CfxGroundingRequestRecord) => Promise<void>;
  afterResponseBeforeValidation?: (input: {
    record: CfxGroundingRequestRecord;
    rawResponse: unknown;
    parsedResponse: unknown;
    metadata: Record<string, unknown>;
  }) => Promise<void>;
  afterOutcome?: (outcome: CfxGroundingRequestOutcome) => Promise<void>;
};

function providerFailureOutcome(input: {
  record: CfxGroundingRequestRecord;
  error: unknown;
  latencyMs: number;
  model: string;
}): CfxGroundingRequestOutcome {
  const message = input.error instanceof Error
    ? input.error.message
    : String(input.error);
  const diagnostics: CfxDiagnostic[] = input.record.propositionIds.map(
    (propositionId) => ({
      code: "S2_PROVIDER_FAILURE",
      propositionId,
      message,
    }),
  );
  const rejectedRows: CfxRejectedGrounding[] =
    input.record.propositionIds.map((propositionId, index) => ({
      propositionId,
      rawRow: null,
      diagnostics: [diagnostics[index]!],
      validationStatus: "rejected",
    }));
  return {
    requestIndex: input.record.requestIndex,
    propositionIds: [...input.record.propositionIds],
    requestHash: input.record.requestHash,
    rawOutput: null,
    rawResponse: null,
    parsedResponse: null,
    validation: {
      status: "FAIL",
      acceptedRows: [],
      rejectedRows,
      diagnostics,
    },
    responseId: null,
    requestId: null,
    model: input.model,
    usage: {
      inputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
    },
    latencyMs: input.latencyMs,
    providerError: {
      name: input.error instanceof Error ? input.error.name : "Error",
      message,
    },
  };
}

async function mapBounded<T, U>(
  values: T[],
  concurrency: number,
  mapper: (value: T, index: number) => Promise<U>,
): Promise<U[]> {
  const output = new Array<U>(values.length);
  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      output[index] = await mapper(values[index]!, index);
    }
  }
  await Promise.all(
    Array.from(
      { length: Math.min(Math.max(1, concurrency), values.length) },
      () => worker(),
    ),
  );
  return output;
}

export async function runCfxGroundingArm(input: {
  mode: CfxGroundingMode;
  article: CfxFrozenArticle;
  canonicalInventory: CfxCanonicalInventory;
  prompt: CfxGovernedPrompt;
  provider: CfxStructuredProvider;
  config?: CfxProviderConfig;
  hooks?: GroundingHooks;
}): Promise<CfxS2ArmResult> {
  const config = input.config ?? DEFAULT_CFX_GROUNDING_CONFIG;
  if (
    input.canonicalInventory.propositions.length !== 12
    || config.retryCount !== 0
    || config.store !== false
    || config.maximumConcurrency < 1
  ) {
    throw new Error("Invalid CFX S2 grounding configuration or inventory");
  }
  const canonicalInventoryHashBefore = canonicalHash(input.canonicalInventory);
  const propositionSets = input.mode === "wholeArticle"
    ? [input.canonicalInventory.propositions]
    : input.canonicalInventory.propositions.map((proposition) => [proposition]);
  const records = propositionSets.map((propositions, requestIndex) => {
    const request = buildCfxGroundingRequest({
      article: input.article,
      propositions,
      prompt: input.prompt,
      config,
    });
    return {
      requestIndex: requestIndex + 1,
      propositionIds: propositions.map((item) => item.propositionId),
      request,
      requestHash: canonicalHash(request),
    };
  });
  const concurrency = input.mode === "wholeArticle"
    ? 1
    : config.maximumConcurrency;
  const outcomes = await mapBounded(
    records,
    concurrency,
    async (record): Promise<CfxGroundingRequestOutcome> => {
      await input.hooks?.beforeInvoke?.(record);
      const startedAt = performance.now();
      try {
        const response = await input.provider.invokeStructured(record.request);
        const latencyMs = Math.round(performance.now() - startedAt);
        await input.hooks?.afterResponseBeforeValidation?.({
          record,
          rawResponse: response.rawResponse ?? response,
          parsedResponse: response.output,
          metadata: {
            model: response.model,
            responseId: response.responseId,
            providerRequestId: response.requestId,
            usage: response.usage,
            latencyMs,
            capturedBeforeValidation: true,
          },
        });
        const validation = validateCfxGroundingResponse({
          rawOutput: response.output,
          expectedPropositionIds: record.propositionIds,
          article: input.article,
        });
        const outcome: CfxGroundingRequestOutcome = {
          requestIndex: record.requestIndex,
          propositionIds: [...record.propositionIds],
          requestHash: record.requestHash,
          rawOutput: response.output,
          rawResponse: response.rawResponse ?? response,
          parsedResponse: response.output,
          validation,
          responseId: response.responseId,
          requestId: response.requestId,
          model: response.model,
          usage: response.usage,
          latencyMs,
          providerError: null,
        };
        await input.hooks?.afterOutcome?.(outcome);
        return outcome;
      } catch (error) {
        const outcome = providerFailureOutcome({
          record,
          error,
          latencyMs: Math.round(performance.now() - startedAt),
          model: config.model,
        });
        await input.hooks?.afterOutcome?.(outcome);
        return outcome;
      }
    },
  );
  const canonicalInventoryHashAfter = canonicalHash(input.canonicalInventory);
  const canonicalInventoryUnchanged =
    canonicalInventoryHashBefore === canonicalInventoryHashAfter;
  const acceptedRows = outcomes
    .flatMap((outcome) => outcome.validation.acceptedRows)
    .sort((left, right) =>
      left.propositionId.localeCompare(right.propositionId));
  const rejectedRows = outcomes
    .flatMap((outcome) => outcome.validation.rejectedRows)
    .sort((left, right) =>
      (left.propositionId ?? "").localeCompare(right.propositionId ?? ""));
  const diagnostics = outcomes.flatMap(
    (outcome) => outcome.validation.diagnostics,
  );
  if (!canonicalInventoryUnchanged) {
    diagnostics.push({
      code: "CANONICAL_INVENTORY_MUTATED",
      message: "S1 canonical inventory hash changed during S2",
      comparison: {
        before: canonicalInventoryHashBefore,
        after: canonicalInventoryHashAfter,
      },
    });
  }
  return {
    mode: input.mode,
    status: !canonicalInventoryUnchanged
      ? "failed"
      : rejectedRows.length > 0
        ? "completed_with_quarantine"
        : "completed",
    expectedRequestCount: records.length,
    providerCallCount: outcomes.length,
    canonicalInventoryHashBefore,
    canonicalInventoryHashAfter,
    canonicalInventoryUnchanged,
    outcomes,
    acceptedRows,
    rejectedRows,
    diagnostics,
    configuration: { ...config },
  };
}
