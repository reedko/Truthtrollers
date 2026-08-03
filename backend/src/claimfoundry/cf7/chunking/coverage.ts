import type {
  Cf7Chunk,
  Cf7ChunkConfig,
  Cf7CoverageReport,
  Cf7IngestResult,
} from "../types/index.js";
import { estimateCf7Tokens } from "./tokenEstimator.js";

export function buildCoverageReport(
  ingest: Cf7IngestResult,
  chunks: Cf7Chunk[],
  config: Cf7ChunkConfig,
): Cf7CoverageReport {
  const sourceIds = ingest.units.map((unit) => unit.unitId);
  const sourceIdSet = new Set(sourceIds);
  const sourceOrder = new Map(sourceIds.map((unitId, index) => [unitId, index]));
  const occurrences = new Map<string, number[]>();
  const inventedUnitIds = new Set<string>();
  let unitsInSourceOrder = true;
  let sentenceFragmentationCount = 0;

  for (const [chunkIndex, chunk] of chunks.entries()) {
    let previousOrder = -1;
    for (const unitId of chunk.unitIds) {
      const order = sourceOrder.get(unitId);
      if (order === undefined) {
        inventedUnitIds.add(unitId);
        continue;
      }
      if (order <= previousOrder) unitsInSourceOrder = false;
      previousOrder = order;
      const indexes = occurrences.get(unitId) ?? [];
      indexes.push(chunkIndex);
      occurrences.set(unitId, indexes);
    }
    const first = ingest.units[sourceOrder.get(chunk.unitIds[0]!) ?? -1];
    const last = ingest.units[sourceOrder.get(chunk.unitIds.at(-1)!) ?? -1];
    if (
      !first
      || !last
      || chunk.text !== ingest.canonicalText.slice(first.charStart, last.charEnd)
    ) {
      sentenceFragmentationCount += 1;
    }
  }

  const uncoveredUnitIds = sourceIds.filter((unitId) => !occurrences.has(unitId));
  const duplicateNonOverlapUnitIds: string[] = [];
  let overlapAdjacentOnly = true;
  for (const [unitId, indexes] of occurrences) {
    if (indexes.length === 1) continue;
    const validAdjacentPair = indexes.length === 2
      && indexes[1] === indexes[0]! + 1
      && chunks[indexes[1]!]!.overlapUnitIds.includes(unitId);
    if (!validAdjacentPair) {
      duplicateNonOverlapUnitIds.push(unitId);
      overlapAdjacentOnly = false;
    }
  }
  for (const [index, chunk] of chunks.entries()) {
    if (index === 0 && chunk.overlapUnitIds.length) overlapAdjacentOnly = false;
    if (index > 0) {
      const previousIds = new Set(chunks[index - 1]!.unitIds);
      if (chunk.overlapUnitIds.some((unitId) => !previousIds.has(unitId))) {
        overlapAdjacentOnly = false;
      }
    }
  }

  const unavoidableOversizedChunkIds = chunks.filter((chunk) => {
    const nonOverlapIds = chunk.unitIds.filter((unitId) =>
      !chunk.overlapUnitIds.includes(unitId));
    return nonOverlapIds.length === 1
      && estimateCf7Tokens(ingest.units[sourceOrder.get(nonOverlapIds[0]!)!]!.text)
        > config.maximumTokens;
  }).map((chunk) => chunk.chunkId);
  const unavoidableSet = new Set(unavoidableOversizedChunkIds);
  const outOfRangeChunkIds = chunks
    .filter((chunk) =>
      (chunk.tokenEstimate < config.minimumTokens
        || chunk.tokenEstimate > config.maximumTokens)
      && !unavoidableSet.has(chunk.chunkId))
    .map((chunk) => chunk.chunkId);
  const overlapUnitOccurrences = chunks.reduce(
    (sum, chunk) => sum + chunk.overlapUnitIds.length,
    0,
  );
  const uniqueTokens = ingest.units.reduce(
    (sum, unit) => sum + estimateCf7Tokens(unit.text),
    0,
  );
  const overlapTokens = chunks.reduce(
    (sum, chunk) => sum + chunk.overlapUnitIds.reduce(
      (inner, unitId) =>
        inner + estimateCf7Tokens(ingest.units[sourceOrder.get(unitId)!]!.text),
      0,
    ),
    0,
  );

  return {
    schemaVersion: "cf7.coverageReport.v1",
    sourceUnitCount: sourceIds.length,
    coveredUnitCount: sourceIds.length - uncoveredUnitIds.length,
    uncoveredUnitIds,
    inventedUnitIds: [...inventedUnitIds],
    duplicateNonOverlapUnitIds,
    chunkCount: chunks.length,
    coverageComplete: uncoveredUnitIds.length === 0
      && inventedUnitIds.size === 0
      && duplicateNonOverlapUnitIds.length === 0,
    unitsInSourceOrder,
    overlapAdjacentOnly,
    sentenceFragmentationCount,
    outOfRangeChunkIds,
    unavoidableOversizedChunkIds,
    overlapUnitOccurrences,
    overlapPercentage: uniqueTokens === 0 ? 0 : overlapTokens / uniqueTokens,
  };
}
