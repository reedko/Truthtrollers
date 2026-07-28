import type { ClaimFoundryPersistence } from "./claimFoundryPersistence.js";

export type SourceOffsets = { start: number; end: number };
export type SourceUnit = {
  unitId: string; atomId: string; order: number; type: string; text: string;
  sourceOffsets: SourceOffsets; linkIds?: string[]; citationMarkerIds?: string[];
  articleReferenceIds?: string[];
};
export type ArticleDocument = {
  contentHash: string; canonicalText: string; sourceFamily: string;
  sourceUnits: SourceUnit[]; atoms: Array<{ atomId: string; type: string; text: string; sourceOffsets: SourceOffsets; layoutSignals?: Record<string, unknown> }>;
  links: Array<{ linkId: string; unitId?: string }>;
  citationMarkers: Array<{ markerId: string; sourceUnitId?: string; resolvedReferenceId?: string | null }>;
  references: Array<{ referenceId: string; sourceUnitId?: string }>;
  structureProfile: Record<string, unknown>;
};

export type ClaimFoundryToolContext = {
  runId: string;
  contentId: string;
  articleDocument: ArticleDocument;
  persistence: ClaimFoundryPersistence;
};
