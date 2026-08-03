import { estimateCf7Tokens } from "../chunking/tokenEstimator.js";
import type { Cf7SourceUnit } from "../types/index.js";
import { canonicalHash } from "../../shared/sourceUnits/index.js";
import { CF7_S3_JSON_SCHEMA } from "./schema.js";
import {
  buildCf7S3UserPrompt,
  CF7_S3_SYSTEM_PROMPT,
} from "./prompt.js";
import type {
  Cf7S3Batch,
  Cf7S3BatchConfig,
  Cf7S3BatchManifest,
  Cf7S3ContextUnit,
  Cf7S3ParentRow,
} from "./types.js";
import { Cf7Error } from "../../shared/errors/Cf7Error.js";

export const DEFAULT_CF7_S3_BATCH_CONFIG: Readonly<Cf7S3BatchConfig> =
  Object.freeze({
    maximumRowsPerBatch: 12,
    maximumEstimatedInputTokens: 6_500,
    adjacentContextUnits: 1,
  });

function validateBatchConfig(config: Cf7S3BatchConfig): void {
  if (
    !Number.isInteger(config.maximumRowsPerBatch)
    || config.maximumRowsPerBatch < 1
    || config.maximumRowsPerBatch > 12
    || !Number.isInteger(config.maximumEstimatedInputTokens)
    || config.maximumEstimatedInputTokens < 1_000
    || !Number.isInteger(config.adjacentContextUnits)
    || config.adjacentContextUnits < 0
    || config.adjacentContextUnits > 3
  ) {
    throw new Cf7Error(
      "CF7_S3_INVALID_BATCH_CONFIG",
      "Invalid CF7 S3 batch configuration",
    );
  }
}

function contextForParents(
  parents: Cf7S3ParentRow[],
  units: Cf7SourceUnit[],
  adjacentContextUnits: number,
): Cf7S3ContextUnit[] {
  const indexById = new Map(units.map((unit, index) => [unit.unitId, index]));
  const cited = new Set(parents.flatMap((parent) => parent.groundingUnitIds));
  const included = new Set<number>();
  for (const unitId of cited) {
    const index = indexById.get(unitId);
    if (index === undefined) {
      throw new Cf7Error(
        "CF7_S3_UNKNOWN_GROUNDING_ID",
        `Unknown grounding unit ${unitId}`,
      );
    }
    for (
      let candidate = Math.max(0, index - adjacentContextUnits);
      candidate <= Math.min(units.length - 1, index + adjacentContextUnits);
      candidate += 1
    ) {
      included.add(candidate);
    }
  }
  return [...included].sort((a, b) => a - b).map((index) => {
    const unit = units[index]!;
    return {
      unitId: unit.unitId,
      text: unit.text,
      role: cited.has(unit.unitId) ? "cited" : "adjacent_context",
    };
  });
}

function provisionalPayload(input: {
  parents: Cf7S3ParentRow[];
  contextUnits: Cf7S3ContextUnit[];
}): { user: string; estimatedInputTokens: number; payloadHash: string } {
  const user = buildCf7S3UserPrompt({
    batchIndex: 1,
    batchCount: 1,
    parents: input.parents,
    contextUnits: input.contextUnits,
  });
  const modelVisible = {
    system: CF7_S3_SYSTEM_PROMPT,
    user,
    responseSchema: CF7_S3_JSON_SCHEMA,
  };
  return {
    user,
    estimatedInputTokens: estimateCf7Tokens(
      `${CF7_S3_SYSTEM_PROMPT}\n${user}\n${JSON.stringify(CF7_S3_JSON_SCHEMA)}`,
    ),
    payloadHash: canonicalHash(modelVisible),
  };
}

export function buildCf7S3BatchPlan(input: {
  parents: Cf7S3ParentRow[];
  units: Cf7SourceUnit[];
  config?: Cf7S3BatchConfig;
}): { batches: Cf7S3Batch[]; manifest: Cf7S3BatchManifest } {
  const config = input.config ?? DEFAULT_CF7_S3_BATCH_CONFIG;
  validateBatchConfig(config);
  const parentIds = new Set<string>();
  for (const parent of input.parents) {
    if (parentIds.has(parent.harvestRowId)) {
      throw new Cf7Error(
        "CF7_S3_DUPLICATE_PARENT_INPUT",
        `Duplicate parent ${parent.harvestRowId}`,
      );
    }
    parentIds.add(parent.harvestRowId);
  }

  const provisional: Array<{
    sourceChunkId: string;
    parents: Cf7S3ParentRow[];
    contextUnits: Cf7S3ContextUnit[];
  }> = [];
  let current: Cf7S3ParentRow[] = [];
  let currentChunkId: string | null = null;

  const flush = () => {
    if (current.length === 0 || currentChunkId === null) return;
    provisional.push({
      sourceChunkId: currentChunkId,
      parents: current,
      contextUnits: contextForParents(
        current,
        input.units,
        config.adjacentContextUnits,
      ),
    });
    current = [];
    currentChunkId = null;
  };

  for (const parent of input.parents) {
    if (currentChunkId !== null && parent.chunkId !== currentChunkId) flush();
    if (currentChunkId === null) currentChunkId = parent.chunkId;
    const candidate = [...current, parent];
    const candidateContext = contextForParents(
      candidate,
      input.units,
      config.adjacentContextUnits,
    );
    const estimate = provisionalPayload({
      parents: candidate,
      contextUnits: candidateContext,
    }).estimatedInputTokens;
    if (
      current.length > 0
      && (
        candidate.length > config.maximumRowsPerBatch
        || estimate > config.maximumEstimatedInputTokens
      )
    ) {
      flush();
      currentChunkId = parent.chunkId;
      current = [parent];
      const singleContext = contextForParents(
        current,
        input.units,
        config.adjacentContextUnits,
      );
      const singleEstimate = provisionalPayload({
        parents: current,
        contextUnits: singleContext,
      }).estimatedInputTokens;
      if (singleEstimate > config.maximumEstimatedInputTokens) {
        throw new Cf7Error(
          "CF7_S3_PARENT_EXCEEDS_BATCH_BUDGET",
          `${parent.harvestRowId} requires ${singleEstimate} input tokens`,
        );
      }
    } else {
      current = candidate;
    }
  }
  flush();

  const batchCount = provisional.length;
  const batches = provisional.map((batch, index): Cf7S3Batch => {
    const batchIndex = index + 1;
    const user = buildCf7S3UserPrompt({
      batchIndex,
      batchCount,
      parents: batch.parents,
      contextUnits: batch.contextUnits,
    });
    const payload = {
      system: CF7_S3_SYSTEM_PROMPT,
      user,
      responseSchema: CF7_S3_JSON_SCHEMA,
    };
    return {
      batchId: `S3-BATCH-${String(batchIndex).padStart(3, "0")}`,
      batchIndex,
      batchCount,
      sourceChunkId: batch.sourceChunkId,
      parentRowIds: batch.parents.map((parent) => parent.harvestRowId),
      parents: batch.parents,
      contextUnits: batch.contextUnits,
      estimatedInputTokens: estimateCf7Tokens(
        `${CF7_S3_SYSTEM_PROMPT}\n${user}\n${JSON.stringify(CF7_S3_JSON_SCHEMA)}`,
      ),
      payloadHash: canonicalHash(payload),
    };
  });

  const manifestWithoutHash = {
    schemaVersion: "cf7.s3BatchManifest.v1" as const,
    parentRowCount: input.parents.length,
    expectedRequestCount: batches.length,
    maximumRowsPerBatch: config.maximumRowsPerBatch,
    maximumEstimatedInputTokens: config.maximumEstimatedInputTokens,
    adjacentContextUnits: config.adjacentContextUnits,
    parentRowToRequest: batches.flatMap((batch) =>
      batch.parentRowIds.map((parentHarvestRowId) => ({
        parentHarvestRowId,
        batchId: batch.batchId,
      }))),
    batches: batches.map((batch) => ({
      batchId: batch.batchId,
      batchIndex: batch.batchIndex,
      sourceChunkId: batch.sourceChunkId,
      parentRowIds: batch.parentRowIds,
      contextUnitIds: batch.contextUnits.map((unit) => unit.unitId),
      estimatedInputTokens: batch.estimatedInputTokens,
      payloadHash: batch.payloadHash,
    })),
  };
  const manifest: Cf7S3BatchManifest = {
    ...manifestWithoutHash,
    batchManifestHash: canonicalHash(manifestWithoutHash),
  };
  return { batches, manifest };
}
