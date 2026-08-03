import type {
  Cf7StructuredModelRequest,
  Cf7StructuredModelResponse,
} from "../../shared/provider/index.js";
import type {
  CfxCitationMetadata,
} from "../evidenceSearch/types.js";

export type CfxProviderConfig = {
  model: string;
  temperature: number;
  maximumConcurrency: number;
  maxOutputTokens: number;
  timeoutMs: number;
  retryCount: 0;
  store: false;
};

export type CfxSourceUnit = {
  unitId: string;
  text: string;
  charStart: number;
  charEnd: number;
};

export type CfxFrozenArticle = {
  fixtureId: string;
  fixturePath: string;
  fixtureFileSha256: string;
  articleTextSha256: string;
  normalizedArticleHash: string;
  sourceUnitManifestHash: string;
  articleTitle: string;
  articleText: string;
  canonicalText: string;
  articleCharacterCount: number;
  sourceUnitCount: number;
  sourceUnits: CfxSourceUnit[];
  unitProjection: string;
  unitProjectionSha256: string;
  citationMetadata?: CfxCitationMetadata;
};

export type CfxDiscoveryRow = {
  assertion: string;
  assertionSource: string;
  whyItMattersToArticleThesis: string;
};

export type CfxCanonicalProposition = CfxDiscoveryRow & {
  propositionId: string;
};

export type CfxCanonicalInventory = {
  schemaVersion: "cfx.canonicalPropositions.v1";
  fixtureId: string;
  propositions: CfxCanonicalProposition[];
};

export type CfxUsage = {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  totalTokens: number;
};

export type CfxDiscoveryResult = {
  status: "completed" | "failed";
  providerCallCount: 1;
  canonicalInventory: CfxCanonicalInventory | null;
  rawOutput: unknown;
  diagnostics: CfxDiagnostic[];
  responseId: string | null;
  requestId: string | null;
  model: string;
  usage: CfxUsage;
  latencyMs: number;
  requestHash: string;
  promptHash: string;
  schemaHash: string;
  error: { name: string; message: string } | null;
  configuration: CfxProviderConfig;
};

export const CFX_GROUNDING_STATUSES = [
  "grounded_direct",
  "grounded_distributed",
  "grounded_attributed",
  "partial",
  "ambiguous",
  "unsupported",
] as const;

export type CfxGroundingStatus = typeof CFX_GROUNDING_STATUSES[number];

export const CFX_GROUNDING_TYPES = [
  "direct",
  "distributed",
  "attributed",
  "partial",
  "ambiguous",
  "none",
] as const;

export type CfxGroundingType = typeof CFX_GROUNDING_TYPES[number];

export type CfxEvidenceSegment = {
  sourceUnitIds: string[];
  verbatimEvidence: string;
};

export type CfxGroundingRow = {
  propositionId: string;
  groundingStatus: CfxGroundingStatus;
  groundingType: CfxGroundingType;
  evidenceSegments: CfxEvidenceSegment[];
  supportedComponents: string[];
  unsupportedComponents: string[];
  notes: string | null;
};

export type CfxDiagnostic = {
  code: string;
  message: string;
  propositionId?: string;
  path?: string;
  comparison?: Record<string, unknown>;
};

export type CfxValidatedGrounding = CfxGroundingRow & {
  validationStatus: "accepted";
  citedUnitCount: number;
  quotedCharacterCount: number;
  quotedWordCount: number;
  evidenceSegmentCount: number;
  sourceSnapshots: Array<{
    sourceUnitIds: string[];
    citedUnitText: string;
    exactSubstring: true;
  }>;
};

export type CfxRejectedGrounding = {
  propositionId: string | null;
  rawRow: unknown;
  diagnostics: CfxDiagnostic[];
  validationStatus: "rejected";
};

export type CfxGroundingValidation = {
  status: "PASS" | "FAIL";
  acceptedRows: CfxValidatedGrounding[];
  rejectedRows: CfxRejectedGrounding[];
  diagnostics: CfxDiagnostic[];
};

export type CfxGroundingMode = "wholeArticle" | "perProposition";

export type CfxGroundingRequestRecord = {
  requestIndex: number;
  propositionIds: string[];
  request: Cf7StructuredModelRequest;
  requestHash: string;
};

export type CfxGroundingRequestOutcome = {
  requestIndex: number;
  propositionIds: string[];
  requestHash: string;
  rawOutput: unknown;
  rawResponse: unknown;
  parsedResponse: unknown;
  validation: CfxGroundingValidation;
  responseId: string | null;
  requestId: string | null;
  model: string;
  usage: CfxUsage;
  latencyMs: number;
  providerError: { name: string; message: string } | null;
};

export type CfxS2ArmResult = {
  mode: CfxGroundingMode;
  status: "completed" | "completed_with_quarantine" | "failed";
  expectedRequestCount: number;
  providerCallCount: number;
  canonicalInventoryHashBefore: string;
  canonicalInventoryHashAfter: string;
  canonicalInventoryUnchanged: boolean;
  outcomes: CfxGroundingRequestOutcome[];
  acceptedRows: CfxValidatedGrounding[];
  rejectedRows: CfxRejectedGrounding[];
  diagnostics: CfxDiagnostic[];
  configuration: CfxProviderConfig;
};

export type CfxGroundingArmMetrics = {
  requestCount: number;
  propositionCount: number;
  statusCounts: Record<CfxGroundingStatus, number>;
  exactSubstringPassCount: number;
  parserFailureCount: number;
  validationFailureCount: number;
  averageCitedUnitCount: number;
  medianCitedUnitCount: number;
  averageQuotedWordCount: number;
  medianQuotedWordCount: number;
  evidenceSegmentCount: number;
  duplicatePassageReuseCount: number;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  latencyMs: number;
  estimatedCost: null;
};

export type CfxGroundingComparison = {
  arms: {
    wholeArticle: CfxGroundingArmMetrics;
    perProposition: CfxGroundingArmMetrics;
  };
  perPropositionComparison: Array<{
    propositionId: string;
    wholeArticleStatus: CfxGroundingStatus | "rejected" | "missing";
    perPropositionStatus: CfxGroundingStatus | "rejected" | "missing";
    statusAgrees: boolean;
    citedUnitSetsAgree: boolean;
    exactQuotationsAgree: boolean;
    humanReview: "not_reviewed";
  }>;
};

export type CfxStructuredProvider = {
  invokeStructured(
    request: Cf7StructuredModelRequest,
  ): Promise<Cf7StructuredModelResponse>;
};
