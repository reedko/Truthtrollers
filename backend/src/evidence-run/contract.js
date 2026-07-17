export const ER1_SCHEMA_VERSION = "er1.result.v1";
export const ER1_REQUEST_SCHEMA_VERSION = "er1.request.v1";
export const ER1_STATE_SCHEMA_VERSION = "er1.state.v1";
export const ER1_EVENT_SCHEMA_VERSION = "er1.event.v1";
export const ER1_ARTIFACT_SCHEMA_VERSION = "er1.artifacts.v1";
export const ER1_CANDIDATE_SCHEMA_VERSION = "er1.sourceCandidate.v1";
export const ER1_PIPELINE_VERSION = "er1.0.0";

const frozen = (values) => Object.freeze([...values]);

export const ER1_RUN_STATUSES = frozen([
  "submitted", "planning", "retrieving", "acquiring", "extracting",
  "criticizing", "verifying", "completed", "partial", "rejected", "failed",
]);

export const ER1_TERMINAL_STATUSES = frozen(["completed", "partial", "rejected", "failed"]);

export const ER1_EVENT_TYPES = frozen([
  "run_started", "target_planned", "identity_resolved", "candidate_found",
  "provider_query_started", "provider_query_completed", "provider_query_failed",
  "source_acquired", "assertion_extracted", "evidence_accepted",
  "target_unresolved", "run_completed", "run_failed",
]);

export const ER1_SOURCE_ROLES = frozen([
  "target_primary", "study_identity", "attribution_provenance", "official_response",
  "methodology_reanalysis", "primary_record", "context_background",
  "advocacy_restatement", "definition_standard", "identifier_resolution", "other",
]);

export const ER1_BEARING_TYPES = frozen([
  "support", "refute", "qualify", "context", "provenance", "non_bearing", "unclear",
]);

export const ER1_ASSERTION_STATUSES = frozen([
  "candidate", "accepted", "rejected", "duplicate", "unresolved",
]);

export const ER1_REJECTION_REASONS = frozen([
  "topical_only", "wrong_entity", "wrong_predicate", "wrong_scope", "wrong_work",
  "unsupported_mapping", "quote_not_exact", "insufficient_source_text",
  "duplicate_assertion", "source_quality_insufficient", "outside_budget", "other",
]);

export const ER1_UNRESOLVED_REASONS = frozen([
  "no_candidates", "no_acquirable_source", "no_bearing_assertion", "identity_ambiguous",
  "source_inaccessible", "budget_exhausted", "deadline_reached", "verification_failed",
  "requested_bearing_not_found",
]);

export const ER1_ACQUISITION_LEVELS = frozen([
  "full_text", "abstract", "snippet", "metadata_only",
]);

export const ER1_LIMITS = Object.freeze({
  standardClaims: 10,
  standardRuntimeMs: 100_000,
  initialFetches: 20,
  followUpWaves: 1,
  assertionTextChars: 2_000,
  excerptChars: 10_000,
  rationaleChars: 2_000,
  sourceUrlChars: 4_000,
  identifiersPerSource: 20,
});

export const ER1_DISCOVERY_LIMITS = Object.freeze({
  maxTargets: 12,
  maxProviderQueriesGlobal: 70,
  maxIdentityResolutionQueries: 6,
  maxContextWorkQueries: 4,
  maxTargetEvidenceQueriesGlobal: 60,
  maxProviderQueriesPerTarget: 5,
  maxCandidatesPerQuery: 8,
  maxCandidatesGlobal: 200,
  maxCandidatesPerTarget: 30,
  maxSameDomainPerTarget: 4,
  minNormalizedCandidatesPerTarget: 6,
  minNormalizedCandidatesPerTargetLaneFamily: 2,
  minContextWorkCandidatesGlobal: 4,
  maxContextWorkCandidatesGlobal: 12,
  deadlineMs: 30_000,
  concurrency: 6,
});

export const ER1_PORTFOLIO_LIMITS = Object.freeze({
  maxAcquisitionCandidatesGlobal: 12,
  maxAcquisitionCandidatesPerTarget: 3,
  maxPrimaryPaperCopiesGlobal: 2,
  maxSameDomainGlobal: 2,
  minDistinctLaneFamiliesGlobal: 4,
  minTargetsCoveredIfAvailable: 6,
  maxContextCandidatesGlobal: 2,
  maxAdvocacyCandidatesGlobal: 1,
});

export const ER1_PREFETCH_STATUSES = frozen([
  "candidate", "promising", "deferred_budget", "duplicate",
  "rejected_pre_fetch", "unresolved_identity", "provider_error",
]);

export const ER1_ID_PREFIXES = Object.freeze({
  run: "er1run_", result: "er1res_", task: "er1task_", candidate: "er1cand_",
  source: "er1src_", assertion: "er1ast_",
  candidate: "er1cand_",
});
