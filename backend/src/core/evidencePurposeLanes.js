// backend/src/core/evidencePurposeLanes.js
//
// Purpose lanes replace the old support/refute/nuance "stance quota" system for
// query generation. Queries are authored to pursue a distinct *evidentiary job*
// — never a desired stance. Stance is classified only after retrieval, from the
// returned content vs. the evaluation target (see snippetBearing.js).
//
// See docs/evidence-query-stance-analysis.md for the rationale.

// Canonical purpose lanes. These describe what kind of document/evidence the
// query is trying to surface, not whether it will support or refute the claim.
export const PURPOSE_LANES = Object.freeze([
  "attribution_record",       // who said/reported it; statements, transcripts, filings
  "study_identity",           // pin the exact study/document identity (title, DOI, PMID)
  "original_document",        // the primary source itself (paper, dataset, official text)
  "alleged_conduct",          // the specific action/behavior the claim alleges
  "official_response",        // responses/statements from the named org/authority
  "independent_methodology",  // independent methodological treatment of the topic/study
  "independent_reanalysis",   // independent re-analysis/replication of the data/study
  "causal_background",        // background evidence on the underlying causal question
  "inference_limitations",    // limits, caveats, data omissions, review critiques
  "legal_or_policy_context",  // legislation, regulation, policy, legal proceedings
  "source_context",           // surrounding context of the source article/publication
]);

const PURPOSE_LANE_SET = new Set(PURPOSE_LANES);

// A safe default lane when nothing more specific is known. It behaves like an
// open, target-bearing search rather than a stance bucket.
export const DEFAULT_PURPOSE_LANE = "alleged_conduct";

// Backward-compatibility neutral values for legacy stance fields. Legacy code
// and persisted rows may still read `intent` / `stanceGoal`; we keep the keys
// but set them to neutral so nothing downstream can treat them as a stance.
export const NEUTRAL_INTENT = "evidence";
export const NEUTRAL_STANCE_GOAL = "open";

export function isPurposeLane(value) {
  return PURPOSE_LANE_SET.has(String(value || "").trim());
}

export function normalizePurposeLane(value, fallback = DEFAULT_PURPOSE_LANE) {
  const lane = String(value || "").trim();
  return PURPOSE_LANE_SET.has(lane) ? lane : fallback;
}

// Suggested purpose lanes per evaluation target type. Used by the deterministic
// query builder to fill distinct evidentiary jobs (not stance buckets).
const LANES_BY_TARGET_TYPE = Object.freeze({
  attribution: ["attribution_record", "official_response", "source_context"],
  attribution_statement: ["attribution_record", "official_response", "source_context"],
  study_identity: ["study_identity", "original_document", "independent_reanalysis"],
  original_study: ["study_identity", "original_document", "independent_methodology"],
  systematic_review: ["causal_background", "independent_methodology", "inference_limitations"],
  dataset: ["original_document", "independent_reanalysis", "inference_limitations"],
  official_statement: ["official_response", "attribution_record", "legal_or_policy_context"],
  primary_source: ["alleged_conduct", "original_document", "official_response"],
  substantive: ["alleged_conduct", "official_response", "independent_methodology", "inference_limitations"],
  other: ["alleged_conduct", "causal_background", "inference_limitations"],
});

export function lanesForTargetType(targetType) {
  const key = String(targetType || "").trim().toLowerCase();
  return LANES_BY_TARGET_TYPE[key] || LANES_BY_TARGET_TYPE.other;
}

// Provider profiles. A profile names the *kind* of sources a lane should reach.
// The gateway maps profiles to concrete providers (web engines + academic APIs).
export const PROVIDER_PROFILES = Object.freeze({
  web_first: ["web"],
  web_and_official: ["web", "official"],
  academic_first: ["academic", "web"],
  academic_and_web: ["academic", "web"],
  official_and_web: ["official", "web"],
  legal_and_web: ["web", "official"],
});

const PROFILE_BY_LANE = Object.freeze({
  attribution_record: "web_first",
  study_identity: "academic_and_web",
  original_document: "academic_and_web",
  alleged_conduct: "web_and_official",
  official_response: "official_and_web",
  independent_methodology: "academic_first",
  independent_reanalysis: "academic_first",
  causal_background: "academic_first",
  inference_limitations: "academic_and_web",
  legal_or_policy_context: "legal_and_web",
  source_context: "web_first",
});

export function providerProfileForLane(lane) {
  return PROFILE_BY_LANE[normalizePurposeLane(lane)] || "web_first";
}

const ACADEMIC_PROVIDERS = ["pubmed", "crossref", "openalex", "semantic_scholar"];
// Official/authoritative-record providers we already have in the gateway map to
// general web engines with domain steering handled elsewhere; we surface them as
// "web" here and let prefer/avoid domains do the steering.
const WEB_PROVIDERS = ["tavily", "brave", "serpapi", "bing"];

// Resolve a provider profile (or lane) into concrete additive providers,
// filtered by which providers the gateway currently has enabled.
export function providersForProfile(profileOrLane, providerEnabled = {}) {
  const profileName = PROVIDER_PROFILES[profileOrLane]
    ? profileOrLane
    : providerProfileForLane(profileOrLane);
  const kinds = PROVIDER_PROFILES[profileName] || ["web"];
  const providers = [];
  for (const kind of kinds) {
    if (kind === "academic") providers.push(...ACADEMIC_PROVIDERS);
    else if (kind === "web" || kind === "official") providers.push(...WEB_PROVIDERS);
  }
  const enabledKeys = Object.keys(providerEnabled || {});
  const filtered = enabledKeys.length
    ? providers.filter((p) => providerEnabled[p])
    : providers;
  return [...new Set(filtered.length ? filtered : providers)];
}

// Whether a lane is allowed to issue a broad, topic-only query. Only the
// background lane may be generic; every other lane must be anchored.
export function laneAllowsGenericTopic(lane) {
  return normalizePurposeLane(lane) === "causal_background";
}

// Instruction-like query detection ("Review whether...", "Investigate...",
// "What evidence exists that...") — these are prompts to a human, not search
// strings, and must be rejected regardless of lane.
const INSTRUCTION_LIKE_RE = /^\s*(?:review|investigate|examine|determine|assess|evaluate|analyze|analyse|explore|consider|discuss|explain|describe|find out|look into|verify whether|check whether)\b/i;
const INTERROGATIVE_INSTRUCTION_RE = /^\s*(?:what|which|does|do|did|is|are|was|were|has|have|should|could|would|can)\b[^?]*\?\s*$/i;

export function isInstructionLikeQuery(text) {
  const value = String(text || "").trim();
  if (!value) return false;
  if (INSTRUCTION_LIKE_RE.test(value)) return true;
  // Full interrogative sentences are conversational, not retrieval strings.
  if (INTERROGATIVE_INSTRUCTION_RE.test(value)) return true;
  return false;
}

// Malformed "glue" queries produced by old deterministic templates, e.g.
// A query made only of connector words and broad topic terms is not a usable
// response query.
// pasted onto anchors with no evidentiary structure.
const GLUE_PREFIX_RE = /^\s*(?:response|reaction|statement|transcript|methodology subgroup protocol)\s+/i;

export function isGlueQuery(text) {
  const value = String(text || "").trim();
  if (!value) return true;
  return GLUE_PREFIX_RE.test(value);
}
