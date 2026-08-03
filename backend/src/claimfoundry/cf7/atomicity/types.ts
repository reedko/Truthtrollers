export type Cf7S3ParentRow = {
  harvestRowId: string;
  chunkId: string;
  chunkIndex: number;
  rowKind: "assertion" | "disputed";
  assertionText: string;
  groundingUnitIds: string[];
};

export const CF7_S3_ACTIONS = [
  "keep_verbatim",
  "split",
] as const;

export type Cf7S3Action = typeof CF7_S3_ACTIONS[number];
export type Cf7S3Derivation =
  | "preserved"
  | "split_component";

export type Cf7S3DecisionChild = {
  assertionText: string;
  groundingUnitIds: string[];
};

export type Cf7S3Decision =
  | {
    parentHarvestRowId: string;
    action: "keep_verbatim";
  }
  | {
    parentHarvestRowId: string;
    action: "split";
    children: Cf7S3DecisionChild[];
  };

export type Cf7S3Child = {
  assertionText: string;
  groundingUnitIds: string[];
  derivation: Cf7S3Derivation;
};

export type Cf7S3ParentEvaluation = {
  parentHarvestRowId: string;
  parentChunkId: string;
  parentRowKind: "assertion" | "disputed";
  parentAssertionText: string;
  parentGroundingUnitIds: string[];
  action: Cf7S3Action;
  children: Cf7S3Child[];
  decisionSource: "host_bypass" | "model";
};

export type Cf7S3GroundingCompletion = {
  parentHarvestRowId: string;
  originalGroundingUnitIds: string[];
  effectiveGroundingUnitIds: string[];
  addedContextUnitIds: string[];
  reasons: Array<{
    unitId: string;
    reason:
      | "incomplete_terminal_continuation"
      | "antecedent_context"
      | "declared_context";
  }>;
};

export type Cf7S3RoutingSignal =
  | "semicolon"
  | "not_only_but_also"
  | "multiple_clausal_conjunction"
  | "multiple_independent_predicates"
  | "multiple_dates_or_events"
  | "multiple_named_actors"
  | "multiple_outcomes"
  | "causal_chain"
  | "study_result_and_response";

export type Cf7S3RoutingDecision = {
  parentHarvestRowId: string;
  routed: boolean;
  signals: Cf7S3RoutingSignal[];
};

export type Cf7S3RoutingManifest = {
  schemaVersion: "cf7.s3RoutingManifest.v1";
  classifierVersion: "cf7.compoundCandidate.v1";
  totalParentCount: number;
  routedParentCount: number;
  bypassedParentCount: number;
  decisions: Cf7S3RoutingDecision[];
  routingManifestHash: string;
};

export type Cf7S3ContextUnit = {
  unitId: string;
  text: string;
  role: "cited" | "adjacent_context";
};

export type Cf7S3Batch = {
  batchId: string;
  batchIndex: number;
  batchCount: number;
  sourceChunkId: string;
  parentRowIds: string[];
  parents: Cf7S3ParentRow[];
  contextUnits: Cf7S3ContextUnit[];
  estimatedInputTokens: number;
  payloadHash: string;
};

export type Cf7S3BatchManifest = {
  schemaVersion: "cf7.s3BatchManifest.v1";
  parentRowCount: number;
  expectedRequestCount: number;
  maximumRowsPerBatch: number;
  maximumEstimatedInputTokens: number;
  adjacentContextUnits: number;
  batchManifestHash: string;
  parentRowToRequest: Array<{
    parentHarvestRowId: string;
    batchId: string;
  }>;
  batches: Array<{
    batchId: string;
    batchIndex: number;
    sourceChunkId: string;
    parentRowIds: string[];
    contextUnitIds: string[];
    estimatedInputTokens: number;
    payloadHash: string;
  }>;
};

export type Cf7S3AtomicClaim = {
  atomicClaimId: string;
  assertionText: string;
  groundingUnitIds: string[];
  parentHarvestRowIds: [string];
  sourceChunkIds: [string];
  derivation: Cf7S3Derivation;
  parentRowKinds: ["assertion" | "disputed"];
};

export type Cf7S3Config = {
  model: string;
  maximumConcurrency: number;
  maxOutputTokens: number;
  timeoutMs: number;
  temperature: number;
  retryCount: 0;
  store: false;
};

export type Cf7S3BatchConfig = {
  maximumRowsPerBatch: number;
  maximumEstimatedInputTokens: number;
  adjacentContextUnits: number;
};

export type Cf7S3RequestAccounting = {
  batchId: string;
  status: "completed" | "failed";
  failureStage: "provider" | "validation" | null;
  model: string;
  responseId: string | null;
  requestId: string | null;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  totalTokens: number;
  latencyMs: number;
  error: { name: string; message: string } | null;
};

export type Cf7S3ValidationViolation = {
  parentHarvestRowId: string | null;
  rule:
    | "schema"
    | "providerFailure"
    | "unknownParent"
    | "duplicateParent"
    | "missingParent"
    | "actionCardinality"
    | "duplicateChild"
    | "unknownChildGrounding"
    | "protectedContent";
  message: string;
  childText: string | null;
  childGroundingUnitIds: string[];
  comparison: {
    allowedParentGroundingUnitIds?: string[];
    allowedGroundingText?: Array<{ unitId: string; text: string }>;
    introducedTokens?: Array<{
      token: string;
      category: string;
      reason: string;
    }>;
    expected?: unknown;
    actual?: unknown;
  };
};

export type Cf7S3RejectedParent = {
  parentHarvestRowId: string | null;
  expectedParent: Cf7S3ParentRow | null;
  rawResult: unknown;
  violations: Cf7S3ValidationViolation[];
};

export type Cf7S3BatchValidation = {
  status: "PASS" | "FAIL";
  acceptedRows: Cf7S3ParentEvaluation[];
  rejectedRows: Cf7S3RejectedParent[];
  violations: Cf7S3ValidationViolation[];
};

export type Cf7S3ForensicAtomicClaim = Omit<
  Cf7S3AtomicClaim,
  "atomicClaimId"
> & {
  forensicAtomicClaimId: string;
  publicationStatus: "forensic_validated_only";
};

export type Cf7S3ValidationSummary = {
  status: "PASS" | "FAIL";
  expectedParentCount: number;
  acceptedParentCount: number;
  rejectedParentCount: number;
  violationCount: number;
  batchesPassed: number;
  batchesFailed: number;
  violations: Cf7S3ValidationViolation[];
};

export type Cf7S3ForensicSink = {
  beginRequest(input: {
    requestIndex: number;
    batch: Cf7S3Batch;
    request: Record<string, unknown>;
  }): Promise<void>;
  recordProviderResponse(input: {
    requestIndex: number;
    rawResponse: unknown;
    metadata: Record<string, unknown>;
  }): Promise<void>;
  recordProviderError(input: {
    requestIndex: number;
    error: unknown;
    metadata: Record<string, unknown>;
  }): Promise<void>;
  recordValidation(input: {
    requestIndex: number;
    validation: Cf7S3BatchValidation;
  }): Promise<void>;
};

export type Cf7S3RunResult = {
  status: "completed" | "failed";
  expectedRequestCount: number;
  providerCallCount: number;
  routedParentCount: number;
  bypassedParentCount: number;
  routingManifest: Cf7S3RoutingManifest;
  groundingCompletions: Cf7S3GroundingCompletion[];
  batchManifest: Cf7S3BatchManifest;
  evaluations: Cf7S3ParentEvaluation[];
  atomicInventory: Cf7S3AtomicClaim[];
  validatedEvaluations: Cf7S3ParentEvaluation[];
  quarantinedRows: Cf7S3RejectedParent[];
  validatedAtomicInventory: Cf7S3ForensicAtomicClaim[];
  validationSummary: Cf7S3ValidationSummary;
  sidecars: Record<string, never[]>;
  accounting: {
    requestCount: number;
    completedRequestCount: number;
    failedRequestCount: number;
    inputTokens: number;
    cachedInputTokens: number;
    outputTokens: number;
    totalTokens: number;
    latencyMs: number;
    requests: Cf7S3RequestAccounting[];
  };
  promptHash: string;
  schemaHash: string;
};
