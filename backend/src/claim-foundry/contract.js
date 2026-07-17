export const CF1_SCHEMA_VERSION = "cf1.claimPackage.v1";
export const CF1_PIPELINE_VERSION = "cf1.0.0";

export const CF1_LIMITS = Object.freeze({
  articleTextChars: 500_000,
  titleChars: 1_000,
  urlChars: 4_000,
  publisherChars: 500,
  authorCount: 20,
  authorChars: 300,
  publishedAtChars: 40,
  languageChars: 35,
  metadataWarningCount: 20,
  metadataWarningChars: 500,
  consumerContentRefChars: 200,
  minimumUsefulTextChars: 40,
  packageBytes: 10 * 1024 * 1024,
  diagnosticsBytes: 1024 * 1024,
});

function frozen(values) {
  return Object.freeze([...values]);
}

export const CF1_STRUCTURAL_TYPES = frozen([
  "heading_section", "paragraph_group", "quotation", "list", "table", "caption",
  "transcript", "social_thread", "mixed", "other",
]);

export const CF1_ARTICLE_STANCES = frozen([
  "endorses", "opposes", "reports", "mixed", "unclear",
]);

export const CF1_SEMANTIC_FUNCTIONS = frozen([
  "thesis_framing", "background", "chronology", "endorsed_assertion",
  "opponent_position", "rebuttal", "evidence_example", "study_document_description",
  "methodology_criticism", "causal_explanation", "qualification", "policy_conclusion",
  "anecdote", "call_to_action", "mixed", "unclear",
]);

export const CF1_ASSERTION_FORMS = frozen([
  "direct", "attributed", "quoted", "statistical", "causal", "comparison",
  "study_document", "legal_policy", "inference", "background", "other",
]);

export const CF1_ARTICLE_USES = frozen([
  "endorsed", "opponent_to_rebut", "rejected", "reported", "background",
  "qualification", "unclear",
]);

export const CF1_RECONCILIATION_RELATIONSHIPS = frozen([
  "unique", "same_proposition", "restatement", "narrower", "broader", "qualifies",
  "contradicts", "context_differs",
]);

export const CF1_PILLAR_IMPORTANCE = frozen(["load_bearing", "major", "supporting"]);
export const CF1_MATERIALITY = frozen(["high", "medium", "low"]);

export const CF1_CLUSTER_RELATIONSHIPS = frozen([
  "same_event", "same_proposition_family", "reasoning_chain", "source_family", "other",
]);

export const CF1_CONSISTENCY_TYPES = frozen([
  "direct_contradiction", "scope_shift", "association_causation_shift",
  "attribution_fact_shift", "numeric_conflict", "identity_conflict", "chronology_conflict",
  "qualification_loss", "standard_inconsistency", "thesis_pillar_conflict", "apparent_resolved",
]);

export const CF1_CONSISTENCY_RESOLUTIONS = frozen([
  "unresolved", "resolved_by_context", "unclear",
]);

export const CF1_SELECTION_RELEVANCE = frozen(["hinge", "supporting", "none"]);

export const CF1_ARTICLE_ROLES = frozen([
  "thesis", "pillar", "pillar_support", "opponent_claim", "qualification", "consistency_hinge",
]);

export const CF1_TARGET_TYPES = frozen([
  "article_endorsed_substantive", "opponent_substantive", "attribution_provenance",
  "source_identity", "inference_warrant", "context_scope",
]);

export const CF1_MAPPING_STATUSES = frozen(["resolved", "needs_review", "unresolved"]);

export const CF1_VERIFICATION_TARGETS = frozen([
  "substantive", "both_needed",
]);

// Knob B — attribution-vs-substance hinge. thesisHinge is a once-per-article model
// judgment (Call 1); gradeTarget is host-derived per target and stays verdict-eligible.
export const CF1_THESIS_HINGES = frozen(["substance", "attribution", "mixed"]);
export const CF1_GRADE_TARGETS = frozen(["substance", "attribution"]);

export const CF1_EVIDENCE_ROLES = frozen([
  "target-primary", "study-identity", "attribution-provenance", "official-response",
  "methodology-reanalysis", "primary-record", "context-background",
  "advocacy-restatement", "identifier-search",
]);

export const CF1_SCORE_TRANSFORMS = frozen(["normal", "invert", "none"]);

export const CF1_RUN_STATUSES = frozen([
  "submitted", "running", "verification_failed", "ready_for_evidence", "failed",
]);

export const CF1_PACKAGE_STATUSES = frozen([
  "submitted", "running", "verification_failed", "ready_for_evidence", "superseded",
]);

export const CF1_ID_PREFIXES = Object.freeze({
  run: "cf1run_",
  package: "cf1pkg_",
  lineage: "cf1lin_",
});
