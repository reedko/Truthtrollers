import { sha256Hex } from "../../../claim-foundry/canonicalJson.js";

export type HashableSourceUnit = {
  unitId: string;
  text: string;
  charStart: number;
  charEnd: number;
  contextUnitIds?: string[];
  resolvedProjection?: string;
};

export function sourceUnitManifestHash(units: HashableSourceUnit[]): string {
  return sha256Hex(units.map((unit) => ({
    unitId: unit.unitId,
    text: unit.text,
    sourceOffsets: {
      start: unit.charStart,
      end: unit.charEnd,
    },
    contextUnitIds: unit.contextUnitIds ?? [],
    resolvedProjection: unit.resolvedProjection ?? null,
  })));
}

export function canonicalHash(value: unknown): string {
  return sha256Hex(value);
}
