import type {
  CfxEvidenceSearchHandoff,
} from "../evidenceSearch/types.js";

export const CFX_QUERY_IDS = ["Q1", "Q2", "Q3", "Q4", "Q5"] as const;
export type CfxQueryId = typeof CFX_QUERY_IDS[number];

export const CFX_QUERY_LANES = [
  "canonical",
  "entity_predicate",
  "source_identity",
  "independent_evidence",
  "counterevidence",
  "qualification",
] as const;
export type CfxQueryLaneName = typeof CFX_QUERY_LANES[number];
export const CFX_QUERY_INTENTS = CFX_QUERY_LANES;
export type CfxQueryIntent = CfxQueryLaneName;

export type CfxEvidenceInput = {
  propositionId: string;
  substantiveAssertion: string;
  assertionSource: string;
  articleStance: "adopts" | "challenges" | "reports";
  groundingUnitIds: string[];
  groundingText: string;
  literalIdentifiers: CfxEvidenceSearchHandoff["literalIdentifiers"];
  lookupHints: CfxEvidenceSearchHandoff["lookupHints"];
  deterministicQueries: {
    literalQuery: string | null;
    sourceQualifiedQuery: string | null;
    studyLookupQueries: string[];
  };
};

export type CfxPlannedQuery = {
  propositionId: string;
  queryId: CfxQueryId;
  queryIntent: CfxQueryIntent;
  query: string | null;
  quotedDiagnosticVariant: string | null;
  lane: CfxQueryLaneName;
  provider: "web" | "pubmed" | null;
  rationale: string;
  origin: "deterministic" | "model";
  modelProposedQuery: string | null;
  compiledFromLiteralComponents: boolean;
  pubmedFallbacks: Array<{
    step: 2 | 3 | 4;
    label:
      | "remove_date_or_exact_phrase"
      | "relax_outcome_to_or"
      | "core_relationship";
    query: string | null;
    skippedReason: string | null;
  }>;
  missingReason: string | null;
  pubmedApplicabilityReasons: string[];
};

export type CfxQueryPlan = {
  schemaVersion: "cfx.initialQueryPlan.v3";
  sourceEvidenceInputHash: string;
  warnings: string[];
  propositions: Array<{
    propositionId: string;
    canonicalAssertion: string;
    pubmedApplicable: boolean;
    pubmedApplicabilityReasons: string[];
    queries: CfxPlannedQuery[];
  }>;
};

export type CfxRawProviderCandidate = Record<string, unknown>;

export type CfxRetrievalRequest = {
  requestId: string;
  propositionId: string;
  queryId: CfxQueryId;
  queryIntent: CfxQueryIntent;
  query: string;
  provider: "web" | "pubmed";
  topK: 5;
  pubmedFallbacks: CfxPlannedQuery["pubmedFallbacks"];
};

export type CfxRetrievalResponse = {
  provider: string;
  providerRequestId: string | null;
  rawResponse: unknown;
  candidates: CfxRawProviderCandidate[];
};

export type CfxRetrievalTransport = {
  search(request: CfxRetrievalRequest): Promise<CfxRetrievalResponse>;
};

export type CfxCandidateDiscoveryPath = {
  propositionId: string;
  queryId: CfxQueryId;
  queryIntent: CfxQueryIntent;
  query: string;
  provider: string;
  retrievalRank: number;
  requestId: string;
};

export type CfxEvidenceCandidate = {
  candidateId: string;
  propositionId: string;
  queryId: CfxQueryId;
  provider: string;
  providerRecordId: string | null;
  title: string;
  authors: string[];
  publication: string | null;
  publicationDate: string | null;
  doi: string | null;
  pmid: string | null;
  url: string | null;
  canonicalUrl: string | null;
  resolvedUrl: string | null;
  abstractOrSnippet: string | null;
  sourceType: string | null;
  retrievalScore: number;
  retrievalRank: number;
  rawArtifactPath: string;
  discoveryPaths: CfxCandidateDiscoveryPath[];
};

export type CfxRetrievalOutcome = {
  request: CfxRetrievalRequest;
  status: "completed" | "provider_error";
  provider: string;
  providerRequestId: string | null;
  latencyMs: number;
  rawResponse: unknown;
  candidates: CfxEvidenceCandidate[];
  error: { name: string; message: string } | null;
  attempts: Array<{
    requestId: string;
    step: 1 | 2 | 3 | 4;
    query: string;
    status: "completed" | "provider_error";
    resultCount: number;
    latencyMs: number;
    error: { name: string; message: string } | null;
  }>;
};

export type CfxCandidateDedupeAudit = {
  candidateId: string;
  dedupeKey: string;
  mergedCandidateIds: string[];
  discoveryPathCount: number;
};
