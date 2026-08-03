import type {
  Cf7StructuredModelResponse,
  Cf7StructuredProvider,
} from "../../shared/provider/index.js";
import { canonicalHash } from "../../shared/sourceUnits/index.js";
import type { Cf7SourceUnit } from "../types/index.js";
import {
  buildCf7S3BatchPlan,
  DEFAULT_CF7_S3_BATCH_CONFIG,
} from "./batching.js";
import {
  buildCf7S3UserPrompt,
  CF7_S3_SYSTEM_PROMPT,
} from "./prompt.js";
import { CF7_S3_JSON_SCHEMA } from "./schema.js";
import { completeCf7S3Grounding } from "./groundingCompleteness.js";
import { buildCf7S3RoutingManifest } from "./routing.js";
import type {
  Cf7S3AtomicClaim,
  Cf7S3BatchConfig,
  Cf7S3BatchValidation,
  Cf7S3Config,
  Cf7S3ForensicAtomicClaim,
  Cf7S3ForensicSink,
  Cf7S3ParentEvaluation,
  Cf7S3ParentRow,
  Cf7S3RejectedParent,
  Cf7S3RequestAccounting,
  Cf7S3RunResult,
} from "./types.js";
import { inspectCf7S3BatchResponse } from "./validateAtomicity.js";
import { createCf7S3BypassEvaluation } from "./validateAtomicity.js";
import { Cf7Error } from "../../shared/errors/Cf7Error.js";

export const DEFAULT_CF7_S3_CONFIG: Readonly<Cf7S3Config> = Object.freeze({
  model: "gpt-4o-mini",
  maximumConcurrency: 4,
  maxOutputTokens: 6_000,
  timeoutMs: 180_000,
  temperature: 0.1,
  retryCount: 0,
  store: false,
});

function validateConfig(config: Cf7S3Config): void {
  if (
    !config.model.trim()
    || !Number.isInteger(config.maximumConcurrency)
    || config.maximumConcurrency < 1
    || config.maximumConcurrency > 16
    || !Number.isInteger(config.maxOutputTokens)
    || config.maxOutputTokens < 1
    || !Number.isInteger(config.timeoutMs)
    || config.timeoutMs < 1
    || !Number.isFinite(config.temperature)
    || config.temperature < 0
    || config.temperature > 2
    || config.retryCount !== 0
    || config.store !== false
  ) {
    throw new Cf7Error(
      "CF7_S3_INVALID_RUN_CONFIG",
      "Invalid CF7 S3 run configuration",
    );
  }
}

function completedAccounting(
  batchId: string,
  response: Cf7StructuredModelResponse,
  latencyMs: number,
): Cf7S3RequestAccounting {
  return {
    batchId,
    status: "completed",
    failureStage: null,
    model: response.model,
    responseId: response.responseId,
    requestId: response.requestId,
    ...response.usage,
    latencyMs,
    error: null,
  };
}

function validationFailedAccounting(
  batchId: string,
  response: Cf7StructuredModelResponse,
  latencyMs: number,
  validation: Cf7S3BatchValidation,
): Cf7S3RequestAccounting {
  return {
    ...completedAccounting(batchId, response, latencyMs),
    status: "failed",
    failureStage: "validation",
    error: {
      name: "Cf7ValidationError",
      message:
        `${validation.violations.length} validation violation(s) in ${batchId}`,
    },
  };
}

function providerFailedAccounting(
  batchId: string,
  config: Cf7S3Config,
  latencyMs: number,
  error: unknown,
): Cf7S3RequestAccounting {
  return {
    batchId,
    status: "failed",
    failureStage: "provider",
    model: config.model,
    responseId: null,
    requestId: null,
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    latencyMs,
    error: {
      name: error instanceof Error ? error.name : "Error",
      message: error instanceof Error ? error.message : String(error),
    },
  };
}

function reassemble(input: {
  evaluations: Cf7S3ParentEvaluation[];
}): {
  atomicInventory: Cf7S3AtomicClaim[];
  sidecars: Cf7S3RunResult["sidecars"];
} {
  const atomicInventory = input.evaluations.flatMap((evaluation) =>
    evaluation.children.map((child) => ({
      atomicClaimId: "",
      assertionText: child.assertionText,
      groundingUnitIds: child.groundingUnitIds,
      parentHarvestRowIds: [evaluation.parentHarvestRowId] as [string],
      sourceChunkIds: [evaluation.parentChunkId] as [string],
      derivation: child.derivation,
      parentRowKinds: [evaluation.parentRowKind] as [
        "assertion" | "disputed",
      ],
    }))).map((row, index) => ({
      ...row,
      atomicClaimId: `A${String(index + 1).padStart(4, "0")}`,
    }));
  return {
    atomicInventory,
    sidecars: {},
  };
}

function forensicAtomicInventory(
  evaluations: Cf7S3ParentEvaluation[],
): Cf7S3ForensicAtomicClaim[] {
  return evaluations.flatMap((evaluation) =>
    evaluation.children.map((child) => ({
      forensicAtomicClaimId: "",
      assertionText: child.assertionText,
      groundingUnitIds: child.groundingUnitIds,
      parentHarvestRowIds: [evaluation.parentHarvestRowId] as [string],
      sourceChunkIds: [evaluation.parentChunkId] as [string],
      derivation: child.derivation,
      parentRowKinds: [evaluation.parentRowKind] as [
        "assertion" | "disputed",
      ],
      publicationStatus: "forensic_validated_only" as const,
    }))).map((row, index) => ({
      ...row,
      forensicAtomicClaimId: `VA${String(index + 1).padStart(4, "0")}`,
    }));
}

function providerFailureValidation(input: {
  batchId: string;
  parents: Cf7S3ParentRow[];
  error: unknown;
}): Cf7S3BatchValidation {
  const message = input.error instanceof Error
    ? input.error.message
    : String(input.error);
  const rejectedRows: Cf7S3RejectedParent[] = input.parents.map((parent) => ({
    parentHarvestRowId: parent.harvestRowId,
    expectedParent: parent,
    rawResult: null,
    violations: [{
      parentHarvestRowId: parent.harvestRowId,
      rule: "providerFailure",
      message: `${input.batchId} provider failure: ${message}`,
      childText: null,
      childGroundingUnitIds: [],
      comparison: {},
    }],
  }));
  return {
    status: "FAIL",
    acceptedRows: [],
    rejectedRows,
    violations: rejectedRows.flatMap((row) => row.violations),
  };
}

export async function runCf7S3Atomicity(input: {
  parents: Cf7S3ParentRow[];
  units: Cf7SourceUnit[];
  provider: Cf7StructuredProvider;
  config?: Cf7S3Config;
  batchConfig?: Cf7S3BatchConfig;
  forensicSink?: Cf7S3ForensicSink;
}): Promise<Cf7S3RunResult> {
  const config = input.config ?? DEFAULT_CF7_S3_CONFIG;
  const batchConfig = input.batchConfig ?? DEFAULT_CF7_S3_BATCH_CONFIG;
  validateConfig(config);
  const grounding = completeCf7S3Grounding({
    parents: input.parents,
    units: input.units,
  });
  const routingManifest = buildCf7S3RoutingManifest(grounding.parents);
  const routedIds = new Set(routingManifest.decisions
    .filter((decision) => decision.routed)
    .map((decision) => decision.parentHarvestRowId));
  const routedParents = grounding.parents.filter(
    (parent) => routedIds.has(parent.harvestRowId),
  );
  const bypassedEvaluations = grounding.parents
    .filter((parent) => !routedIds.has(parent.harvestRowId))
    .map(createCf7S3BypassEvaluation);
  const plan = buildCf7S3BatchPlan({
    parents: routedParents,
    units: input.units,
    config: batchConfig,
  });
  const validationsByBatch = new Array<
    Cf7S3BatchValidation | null
  >(plan.batches.length).fill(null);
  const accountingByBatch = new Array<Cf7S3RequestAccounting | null>(
    plan.batches.length,
  ).fill(null);
  let cursor = 0;
  let providerCallCount = 0;

  async function worker(): Promise<void> {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= plan.batches.length) return;
      const batch = plan.batches[index]!;
      const user = buildCf7S3UserPrompt({
        batchIndex: batch.batchIndex,
        batchCount: batch.batchCount,
        parents: batch.parents,
        contextUnits: batch.contextUnits,
      });
      const request = {
        system: CF7_S3_SYSTEM_PROMPT,
        user,
        responseSchema: CF7_S3_JSON_SCHEMA,
        model: config.model,
        temperature: config.temperature,
        retryCount: config.retryCount,
        store: config.store,
        maxOutputTokens: config.maxOutputTokens,
        timeoutMs: config.timeoutMs,
      };
      await input.forensicSink?.beginRequest({
        requestIndex: batch.batchIndex,
        batch,
        request,
      });
      const startedAt = performance.now();
      let response: Cf7StructuredModelResponse;
      try {
        providerCallCount += 1;
        response = await input.provider.invokeStructured(request);
      } catch (error) {
        const latencyMs = Math.round(performance.now() - startedAt);
        const validation = providerFailureValidation({
          batchId: batch.batchId,
          parents: batch.parents,
          error,
        });
        validationsByBatch[index] = validation;
        await input.forensicSink?.recordProviderError({
          requestIndex: batch.batchIndex,
          error,
          metadata: {
            batchId: batch.batchId,
            model: config.model,
            responseId: null,
            providerRequestId: null,
            usage: null,
            latencyMs,
            capturedBeforeValidation: true,
          },
        });
        await input.forensicSink?.recordValidation({
          requestIndex: batch.batchIndex,
          validation,
        });
        accountingByBatch[index] = providerFailedAccounting(
          batch.batchId,
          config,
          latencyMs,
          error,
        );
        continue;
      }
      const latencyMs = Math.round(performance.now() - startedAt);
      await input.forensicSink?.recordProviderResponse({
        requestIndex: batch.batchIndex,
        rawResponse: response.rawResponse ?? response,
        metadata: {
          batchId: batch.batchId,
          model: response.model,
          responseId: response.responseId,
          providerRequestId: response.requestId,
          usage: response.usage,
          latencyMs,
          capturedBeforeValidation: true,
        },
      });
      const validation = inspectCf7S3BatchResponse({
        expectedParents: batch.parents,
        units: input.units,
        output: response.output,
      });
      validationsByBatch[index] = validation;
      await input.forensicSink?.recordValidation({
        requestIndex: batch.batchIndex,
        validation,
      });
      accountingByBatch[index] = validation.status === "PASS"
        ? completedAccounting(batch.batchId, response, latencyMs)
        : validationFailedAccounting(
          batch.batchId,
          response,
          latencyMs,
          validation,
        );
    }
  }

  await Promise.all(
    Array.from(
      { length: Math.min(config.maximumConcurrency, plan.batches.length) },
      () => worker(),
    ),
  );
  if (providerCallCount !== plan.batches.length) {
    throw new Cf7Error(
      "CF7_S3_PROVIDER_CALL_COUNT_MISMATCH",
      `${providerCallCount} calls for ${plan.batches.length} batches`,
    );
  }
  const accountingRows = accountingByBatch.map((row, index) => {
    if (!row) throw new Error(`Missing accounting for batch ${index + 1}`);
    return row;
  });
  const failedRequestCount = accountingRows.filter(
    (row) => row.status === "failed",
  ).length;
  const validations = validationsByBatch.map((validation, index) => {
    if (!validation) throw new Error(`Missing validation for batch ${index + 1}`);
    return validation;
  });
  const validatedById = new Map([
    ...bypassedEvaluations,
    ...validations.flatMap((validation) => validation.acceptedRows),
  ].map((evaluation) => [evaluation.parentHarvestRowId, evaluation]));
  const validatedEvaluations = grounding.parents.flatMap((parent) => {
    const evaluation = validatedById.get(parent.harvestRowId);
    return evaluation ? [evaluation] : [];
  });
  const quarantinedRows = validations.flatMap(
    (validation) => validation.rejectedRows,
  );
  const status = failedRequestCount === 0
    && quarantinedRows.length === 0
    && validatedEvaluations.length === grounding.parents.length
    ? "completed"
    : "failed";
  const evaluations = status === "completed" ? validatedEvaluations : [];
  const forensicReassembled = reassemble({
    evaluations: validatedEvaluations,
  });
  const canonicalReassembled = status === "completed"
    ? reassemble({ evaluations })
    : { atomicInventory: [] };
  const allViolations = validations.flatMap(
    (validation) => validation.violations,
  );
  const validationSummary = {
    status: status === "completed" ? "PASS" as const : "FAIL" as const,
    expectedParentCount: grounding.parents.length,
    acceptedParentCount: validatedEvaluations.length,
    rejectedParentCount: quarantinedRows.length,
    violationCount: allViolations.length,
    batchesPassed: validations.filter(
      (validation) => validation.status === "PASS",
    ).length,
    batchesFailed: validations.filter(
      (validation) => validation.status === "FAIL",
    ).length,
    violations: allViolations,
  };
  return {
    status,
    expectedRequestCount: plan.batches.length,
    providerCallCount,
    routedParentCount: routedParents.length,
    bypassedParentCount: bypassedEvaluations.length,
    routingManifest,
    groundingCompletions: grounding.completions,
    batchManifest: plan.manifest,
    evaluations,
    atomicInventory: canonicalReassembled.atomicInventory,
    validatedEvaluations,
    quarantinedRows,
    validatedAtomicInventory: forensicAtomicInventory(validatedEvaluations),
    validationSummary,
    sidecars: forensicReassembled.sidecars,
    accounting: {
      requestCount: accountingRows.length,
      completedRequestCount: accountingRows.length - failedRequestCount,
      failedRequestCount,
      inputTokens: accountingRows.reduce((sum, row) => sum + row.inputTokens, 0),
      cachedInputTokens: accountingRows.reduce(
        (sum, row) => sum + row.cachedInputTokens,
        0,
      ),
      outputTokens: accountingRows.reduce((sum, row) => sum + row.outputTokens, 0),
      totalTokens: accountingRows.reduce((sum, row) => sum + row.totalTokens, 0),
      latencyMs: accountingRows.reduce((sum, row) => sum + row.latencyMs, 0),
      requests: accountingRows,
    },
    promptHash: canonicalHash(CF7_S3_SYSTEM_PROMPT),
    schemaHash: canonicalHash(CF7_S3_JSON_SCHEMA),
  };
}
