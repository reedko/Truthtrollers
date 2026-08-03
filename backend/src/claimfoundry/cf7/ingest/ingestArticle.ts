import {
  deriveStructuralBlocks,
  normalizeArticleText,
} from "../../shared/articleNormalization/index.js";
import {
  sourceUnitManifestHash,
} from "../../shared/sourceUnits/index.js";
import { Cf7Error } from "../../shared/errors/Cf7Error.js";
import type {
  Cf7IngestResult,
  Cf7ParagraphGroup,
  Cf7Region,
  Cf7SourceUnit,
} from "../types/index.js";

export type Cf7ArticleInput = {
  text: string;
  title: string;
  language?: string;
  url?: string;
};

function quarterFor(index: number, count: number): 1 | 2 | 3 | 4 {
  return Math.min(4, Math.floor((index * 4) / count) + 1) as 1 | 2 | 3 | 4;
}

export function ingestArticle(input: Cf7ArticleInput): Cf7IngestResult {
  if (!input.text?.trim()) {
    throw new Cf7Error("CF7_EMPTY_ARTICLE", "CF7 requires non-empty article text");
  }
  if (!input.title?.trim()) {
    throw new Cf7Error("CF7_MISSING_TITLE", "CF7 requires an article title");
  }

  const document = normalizeArticleText(input);
  const blocks = deriveStructuralBlocks(document);
  const unitToRegion = new Map<string, string>();
  const regions: Cf7Region[] = blocks.map((block, index) => {
    const regionId = `REGION-${String(index + 1).padStart(3, "0")}`;
    for (const unitId of block.sourceUnitIds) unitToRegion.set(unitId, regionId);
    return {
      regionId,
      heading: block.heading || null,
      structuralType: block.structuralType,
      startUnitId: block.sourceUnitIds[0]!,
      endUnitId: block.sourceUnitIds.at(-1)!,
      unitIds: [...block.sourceUnitIds],
      charStart: block.sourceOffsets.start,
      charEnd: block.sourceOffsets.end,
    };
  });

  const units: Cf7SourceUnit[] = document.sourceUnits.map((unit, index) => {
    const regionId = unitToRegion.get(unit.unitId);
    if (!regionId) {
      throw new Cf7Error(
        "CF7_UNIT_WITHOUT_REGION",
        `Source unit ${unit.unitId} has no structural region`,
      );
    }
    return {
      unitId: unit.unitId,
      text: unit.text,
      charStart: unit.sourceOffsets.start,
      charEnd: unit.sourceOffsets.end,
      regionId,
      quarter: quarterFor(index, document.sourceUnits.length),
      ...(unit.contextUnitIds?.length
        ? { contextUnitIds: [...unit.contextUnitIds] }
        : {}),
      ...(unit.resolvedProjection
        ? { resolvedProjection: unit.resolvedProjection }
        : {}),
    };
  });

  const unitsByAtom = new Map<string, string[]>();
  for (const unit of document.sourceUnits) {
    const ids = unitsByAtom.get(unit.atomId) ?? [];
    ids.push(unit.unitId);
    unitsByAtom.set(unit.atomId, ids);
  }
  const paragraphGroups: Cf7ParagraphGroup[] = document.atoms
    .map((atom) => ({
      atomId: atom.atomId,
      atomType: atom.type,
      unitIds: unitsByAtom.get(atom.atomId) ?? [],
    }))
    .filter((group) => group.unitIds.length > 0);

  return {
    canonicalText: document.canonicalText,
    units,
    regions,
    sourceManifest: {
      schemaVersion: "cf7.sourceManifest.v1",
      contentHash: document.contentHash,
      sourceUnitManifestHash: sourceUnitManifestHash(units),
      sourceUnitCount: units.length,
      regionCount: regions.length,
    },
    paragraphGroups,
  };
}
