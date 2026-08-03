export type Cf7SourceUnit = {
  unitId: string;
  text: string;
  charStart: number;
  charEnd: number;
  regionId: string;
  quarter: 1 | 2 | 3 | 4;
  contextUnitIds?: string[];
  resolvedProjection?: string;
};

export type Cf7Region = {
  regionId: string;
  heading: string | null;
  structuralType: string;
  startUnitId: string;
  endUnitId: string;
  unitIds: string[];
  charStart: number;
  charEnd: number;
};

export type Cf7SourceManifest = {
  schemaVersion: "cf7.sourceManifest.v1";
  contentHash: string;
  sourceUnitManifestHash: string;
  sourceUnitCount: number;
  regionCount: number;
};

export type Cf7ParagraphGroup = {
  atomId: string;
  atomType: string;
  unitIds: string[];
};

export type Cf7IngestResult = {
  canonicalText: string;
  units: Cf7SourceUnit[];
  regions: Cf7Region[];
  sourceManifest: Cf7SourceManifest;
  paragraphGroups: Cf7ParagraphGroup[];
};

export type Cf7Chunk = {
  chunkId: string;
  chunkIndex: number;
  chunkCount: number;
  unitIds: string[];
  regionIds: string[];
  overlapUnitIds: string[];
  tokenEstimate: number;
  text: string;
};

export type Cf7ChunkConfig = {
  minimumTokens: number;
  targetTokens: number;
  maximumTokens: number;
  overlapRatio: number;
};

export type Cf7CoverageReport = {
  schemaVersion: "cf7.coverageReport.v1";
  sourceUnitCount: number;
  coveredUnitCount: number;
  uncoveredUnitIds: string[];
  inventedUnitIds: string[];
  duplicateNonOverlapUnitIds: string[];
  chunkCount: number;
  coverageComplete: boolean;
  unitsInSourceOrder: boolean;
  overlapAdjacentOnly: boolean;
  sentenceFragmentationCount: number;
  outOfRangeChunkIds: string[];
  unavoidableOversizedChunkIds: string[];
  overlapUnitOccurrences: number;
  overlapPercentage: number;
};
