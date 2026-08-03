import { Cf7Error } from "../../shared/errors/Cf7Error.js";
import type {
  Cf7Chunk,
  Cf7ChunkConfig,
  Cf7IngestResult,
  Cf7ParagraphGroup,
  Cf7SourceUnit,
} from "../types/index.js";
import { estimateCf7Tokens } from "./tokenEstimator.js";

export const DEFAULT_CF7_CHUNK_CONFIG: Readonly<Cf7ChunkConfig> = Object.freeze({
  minimumTokens: 800,
  targetTokens: 1_000,
  maximumTokens: 1_200,
  overlapRatio: 0.125,
});

type ChunkPiece = {
  unitIds: string[];
};

type BaseChunk = {
  unitIds: string[];
};

function validateConfig(config: Cf7ChunkConfig): void {
  const valid = Number.isInteger(config.minimumTokens)
    && Number.isInteger(config.targetTokens)
    && Number.isInteger(config.maximumTokens)
    && config.minimumTokens > 0
    && config.minimumTokens <= config.targetTokens
    && config.targetTokens <= config.maximumTokens
    && config.overlapRatio >= 0.10
    && config.overlapRatio <= 0.15;
  if (!valid) {
    throw new Cf7Error("CF7_INVALID_CHUNK_CONFIG", "Invalid CF7 chunk configuration");
  }
}

function textForUnitIds(
  unitIds: string[],
  unitById: Map<string, Cf7SourceUnit>,
  canonicalText: string,
): string {
  const first = unitById.get(unitIds[0]!);
  const last = unitById.get(unitIds.at(-1)!);
  if (!first || !last) {
    throw new Cf7Error("CF7_UNKNOWN_UNIT", "Chunk construction referenced an unknown unit");
  }
  return canonicalText.slice(first.charStart, last.charEnd);
}

function tokenCount(
  unitIds: string[],
  unitById: Map<string, Cf7SourceUnit>,
  canonicalText: string,
): number {
  return estimateCf7Tokens(textForUnitIds(unitIds, unitById, canonicalText));
}

function splitOversizedGroup(
  group: Cf7ParagraphGroup,
  unitById: Map<string, Cf7SourceUnit>,
  canonicalText: string,
  maximumTokens: number,
): ChunkPiece[] {
  if (tokenCount(group.unitIds, unitById, canonicalText) <= maximumTokens) {
    return [{ unitIds: [...group.unitIds] }];
  }

  const pieces: ChunkPiece[] = [];
  let current: string[] = [];
  for (const unitId of group.unitIds) {
    const candidate = [...current, unitId];
    if (
      current.length > 0
      && tokenCount(candidate, unitById, canonicalText) > maximumTokens
    ) {
      pieces.push({ unitIds: current });
      current = [unitId];
    } else {
      current = candidate;
    }
  }
  if (current.length) pieces.push({ unitIds: current });
  return pieces;
}

function paragraphPieces(
  ingest: Cf7IngestResult,
  config: Cf7ChunkConfig,
): ChunkPiece[] {
  const unitById = new Map(ingest.units.map((unit) => [unit.unitId, unit]));
  const associatedGroups: Cf7ParagraphGroup[] = [];

  for (let index = 0; index < ingest.paragraphGroups.length; index += 1) {
    const group = ingest.paragraphGroups[index]!;
    if (group.atomType !== "heading") {
      associatedGroups.push(group);
      continue;
    }
    const unitIds = [...group.unitIds];
    let cursor = index + 1;
    while (
      cursor < ingest.paragraphGroups.length
      && ingest.paragraphGroups[cursor]!.atomType === "heading"
    ) {
      unitIds.push(...ingest.paragraphGroups[cursor]!.unitIds);
      cursor += 1;
    }
    if (cursor < ingest.paragraphGroups.length) {
      unitIds.push(...ingest.paragraphGroups[cursor]!.unitIds);
      index = cursor;
    } else {
      index = cursor - 1;
    }
    associatedGroups.push({
      atomId: group.atomId,
      atomType: "heading_with_content",
      unitIds,
    });
  }

  return associatedGroups.flatMap((group) =>
    splitOversizedGroup(
      group,
      unitById,
      ingest.canonicalText,
      config.maximumTokens,
    ));
}

function buildBaseChunks(
  ingest: Cf7IngestResult,
  pieces: ChunkPiece[],
  config: Cf7ChunkConfig,
): BaseChunk[] {
  const unitById = new Map(ingest.units.map((unit) => [unit.unitId, unit]));
  const chunks: BaseChunk[] = [];
  let current: string[] = [];

  for (const piece of pieces) {
    if (!current.length) {
      current = [...piece.unitIds];
      continue;
    }
    const candidate = [...current, ...piece.unitIds];
    const candidateTokens = tokenCount(candidate, unitById, ingest.canonicalText);
    const currentTokens = tokenCount(current, unitById, ingest.canonicalText);
    const mayFillMinimum = currentTokens < config.minimumTokens
      && candidateTokens <= config.maximumTokens;
    if (candidateTokens <= config.targetTokens || mayFillMinimum) {
      current = candidate;
    } else {
      chunks.push({ unitIds: current });
      current = [...piece.unitIds];
    }
  }
  if (current.length) chunks.push({ unitIds: current });
  return chunks;
}

function chooseOverlap(
  previous: BaseChunk,
  unitById: Map<string, Cf7SourceUnit>,
  canonicalText: string,
  ratio: number,
): string[] {
  if (!previous.unitIds.length) return [];
  const previousTokens = tokenCount(previous.unitIds, unitById, canonicalText);
  const candidates = previous.unitIds.map((_, index) => {
    const unitIds = previous.unitIds.slice(index);
    const tokens = tokenCount(unitIds, unitById, canonicalText);
    return {
      unitIds,
      ratio: tokens / previousTokens,
      distance: Math.abs(tokens / previousTokens - ratio),
    };
  });
  const inRange = candidates.filter((candidate) =>
    candidate.ratio >= 0.10 && candidate.ratio <= 0.15);
  const pool = inRange.length ? inRange : candidates;
  return [...pool.sort((left, right) =>
    left.distance - right.distance
    || left.unitIds.length - right.unitIds.length)[0]!.unitIds];
}

export function chunkArticle(
  ingest: Cf7IngestResult,
  config: Cf7ChunkConfig = DEFAULT_CF7_CHUNK_CONFIG,
): Cf7Chunk[] {
  validateConfig(config);
  if (!ingest.units.length) return [];

  const unitById = new Map(ingest.units.map((unit) => [unit.unitId, unit]));
  const pieces = paragraphPieces(ingest, config);
  const baseChunks = buildBaseChunks(ingest, pieces, config);

  return baseChunks.map((base, index) => {
    const overlapUnitIds = index === 0
      ? []
      : chooseOverlap(
        baseChunks[index - 1]!,
        unitById,
        ingest.canonicalText,
        config.overlapRatio,
      );
    const unitIds = [...overlapUnitIds, ...base.unitIds];
    const regionIds = [...new Set(unitIds.map((unitId) =>
      unitById.get(unitId)!.regionId))];
    return {
      chunkId: `CHUNK-${String(index + 1).padStart(3, "0")}`,
      chunkIndex: index + 1,
      chunkCount: baseChunks.length,
      unitIds,
      regionIds,
      overlapUnitIds,
      tokenEstimate: tokenCount(unitIds, unitById, ingest.canonicalText),
      text: textForUnitIds(unitIds, unitById, ingest.canonicalText),
    };
  });
}
