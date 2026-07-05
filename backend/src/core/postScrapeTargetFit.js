// backend/src/core/postScrapeTargetFit.js
//
// Step 21: deterministic post-scrape target-fit guard.
//
// This adds NO LLM calls and changes NO prompt. It is a deterministic
// post-processing check over the existing combined extraction/evaluation LLM
// output. Its job is to REDUCE trust in that output before a direct substantive
// support/refute link is persisted:
//
//   - For a substantive misconduct/data-handling target, a DIRECT support/refute
//     requires the extracted quote/summary to address actor + alleged action +
//     object/study/data/protocol/subgroup.
//   - Otherwise the assertion is reclassified (attribution_only,
//     allegation_repetition, study_identity_context, methodology_context,
//     official_response, background_causal, topic_only, insufficient) and is NOT
//     persisted as direct substantive proof.
//
// Non-misconduct / non-substantive targets pass through unchanged so attribution
// and study-identity links are not disturbed.

import logger from "../utils/logger.js";
import { tokenizeBearingText } from "./evidenceNeed.js";
import { deriveVerifiedDocumentRole } from "./candidateSurvival.js";

const MISCONDUCT_RE = /\b(manipulat\w*|omit\w*|exclud\w*|destroy\w*|fabricat\w*|falsif\w*|alter(?:ed|ing)?|conceal\w*|cover(?:ed)?[-\s]?up|suppress\w*|withh\w*|rig(?:ged|ging)?|doctor(?:ed|ing)?|tamper\w*)\b/i;
const DATA_OBJECT_RE = /\b(stud(?:y|ies)|data\w*|analys\w*|protocol\w*|subgroup\w*|cohort\w*|results?|methodolog\w*|paper|sample\w*|participants?|figures?|records?)\b/i;
const ATTRIBUTION_VERB_RE = /\b(said|says|stated?|reveal\w*|alleg\w*|claim(?:s|ed)?|according to|testif\w*|admitt?\w*|announc\w*|told|reported)\b/i;
const NO_LINK_RE = /\b(no (?:link|association|correlation|evidence|causal)|not (?:linked|associated|caused)|does not (?:cause|increase|lead)|debunk\w*|no causal)\b/i;

const SUBSTANTIVE_TARGET_TYPES = new Set(["substantive", "primary_source"]);

export const TARGET_FIT_LABELS = Object.freeze({
  DIRECT_SUBSTANTIVE: "direct_substantive",
  ATTRIBUTION_ONLY: "attribution_only",
  ALLEGATION_REPETITION: "allegation_repetition",
  STUDY_IDENTITY_CONTEXT: "study_identity_context",
  METHODOLOGY_CONTEXT: "methodology_context",
  OFFICIAL_RESPONSE: "official_response",
  BACKGROUND_CAUSAL: "background_causal",
  TOPIC_ONLY: "topic_only",
  INSUFFICIENT: "insufficient",
});

// Labels that must never persist as a direct substantive support/refute link.
const NON_DIRECT_LABELS = new Set([
  TARGET_FIT_LABELS.ATTRIBUTION_ONLY,
  TARGET_FIT_LABELS.ALLEGATION_REPETITION,
  TARGET_FIT_LABELS.STUDY_IDENTITY_CONTEXT,
  TARGET_FIT_LABELS.METHODOLOGY_CONTEXT,
  TARGET_FIT_LABELS.OFFICIAL_RESPONSE,
  TARGET_FIT_LABELS.BACKGROUND_CAUSAL,
  TARGET_FIT_LABELS.TOPIC_ONLY,
  TARGET_FIT_LABELS.INSUFFICIENT,
]);

function normalizeStance(value) {
  const s = String(value || "").toLowerCase();
  if (s === "supports") return "support";
  if (s === "refutes") return "refute";
  if (s === "related") return "nuance";
  return ["support", "refute", "nuance", "insufficient"].includes(s) ? s : "insufficient";
}

function overlaps(terms, tokenSet) {
  for (const term of terms || []) {
    for (const token of tokenizeBearingText(term)) {
      if (tokenSet.has(token)) return true;
    }
  }
  return false;
}

// Whether the claim/target is a misconduct/data-handling claim (the only case
// that receives the strict actor+action+object gate).
function isMisconductTarget(targetType, evidenceNeed, targetText, claimText) {
  if (!SUBSTANTIVE_TARGET_TYPES.has(String(targetType || "").toLowerCase())) return false;
  const relation = (evidenceNeed?.relationTerms || []).join(" ");
  return MISCONDUCT_RE.test(`${relation} ${targetText || ""} ${claimText || ""}`);
}

function claimRestatement(claimText, candidateText) {
  const claimTokens = new Set(tokenizeBearingText(claimText));
  if (claimTokens.size === 0) return 0;
  const candTokens = new Set(tokenizeBearingText(candidateText));
  let shared = 0;
  for (const t of claimTokens) if (candTokens.has(t)) shared += 1;
  return shared / claimTokens.size;
}

/**
 * Deterministically evaluate whether an extracted assertion is compatible with
 * its exact evaluation target. Returns a classification, the final stance, and
 * whether it may persist as a direct substantive support/refute.
 */
export function evaluateTargetFit({ claim = {}, target = {}, evidence = {} }) {
  const originalLlmStance = normalizeStance(evidence.stance);
  const targetType = String(target.evaluationTargetType || evidence.evidenceTargetType || "").toLowerCase();
  const evidenceNeed = claim.evidenceNeed || {};
  const targetText = target.targetText || evidence.evaluationTargetText || "";
  const claimText = claim.text || "";
  const text = `${evidence.quote || ""} ${evidence.summary || ""}`.trim();
  // Prefer the source's already-computed document role (propagated onto the
  // evidence item); otherwise derive from the URL/identity role.
  const role = evidence.verifiedDocumentRole
    ? { role: evidence.verifiedDocumentRole, verified: evidence.verifiedDocument !== false }
    : deriveVerifiedDocumentRole({
        url: evidence.url || "",
        title: evidence.sourceTitle || evidence.title || "",
        identityRole: evidence.identityRole || evidence.sourceIdentityRole || null,
        academicApiContent: evidence.academicApiContent || null,
        protectedDocumentIdentity: evidence.protectedDocumentIdentity || false,
      });
  const roleName = role?.role || null;

  // Non-misconduct or non-substantive targets are not gated by this pass. They
  // keep their LLM stance so attribution/study-identity links are not disturbed.
  if (!isMisconductTarget(targetType, evidenceNeed, targetText, claimText)) {
    return {
      compatibilityLabel: TARGET_FIT_LABELS.DIRECT_SUBSTANTIVE,
      compatibleWithTarget: true,
      finalStance: originalLlmStance,
      directness: evidence.bearingType || "direct",
      persistAsDirectSubstantive: originalLlmStance !== "insufficient",
      rejectedReason: null,
      missingRequiredElements: [],
      originalLlmStance,
      sourceRole: roleName,
      gated: false,
    };
  }

  const tokenSet = new Set(tokenizeBearingText(text));
  const hasActor = overlaps(evidenceNeed.subjectTerms, tokenSet) || overlaps(evidenceNeed.speakerEntities, tokenSet);
  const hasAction = MISCONDUCT_RE.test(text) || overlaps(evidenceNeed.relationTerms, tokenSet);
  const hasObject = DATA_OBJECT_RE.test(text) || overlaps(evidenceNeed.objectTerms, tokenSet);

  const missingRequiredElements = [];
  if (!hasActor) missingRequiredElements.push("actor");
  if (!hasAction) missingRequiredElements.push("alleged_action");
  if (!hasObject) missingRequiredElements.push("object_study_data_protocol_subgroup");

  const isAmplifier = roleName === "advocacy_or_press_release_candidate" || roleName === "news_or_commentary_candidate";
  const isPrimaryStatement = roleName === "primary_statement_candidate";
  const isVerifiedIndependent = Boolean(role?.verified) && !isAmplifier;
  // Attribution framing: the text REPORTS that someone made the allegation
  // ("X revealed/alleged/said/testified that ...") rather than independently
  // establishing it. A quote can contain action+object and still only be an
  // allegation being reported.
  const attributionFramed = ATTRIBUTION_VERB_RE.test(text);
  const restatement = claimRestatement(claimText, text);
  const highRestatement = restatement >= 0.7;

  let compatibilityLabel;
  let directSubstantive = false;

  if (isPrimaryStatement) {
    // The whistleblower's own statement attributes the misconduct; it supports
    // WHO alleged it, not that it independently occurred.
    compatibilityLabel = TARGET_FIT_LABELS.ATTRIBUTION_ONLY;
  } else if ((isAmplifier && (restatement >= 0.6 || MISCONDUCT_RE.test(text))) || (!isVerifiedIndependent && highRestatement)) {
    // (6) a non-independent source that merely repeats the article's allegation
    // (recognized amplifier, or any unverified source restating the claim) is
    // never independent substantive proof.
    compatibilityLabel = TARGET_FIT_LABELS.ALLEGATION_REPETITION;
  } else if (attributionFramed) {
    compatibilityLabel = TARGET_FIT_LABELS.ATTRIBUTION_ONLY;
  } else if (hasActor && hasAction && hasObject && !isAmplifier) {
    // (2) direct substantive proof from an independent, non-attribution source.
    compatibilityLabel = TARGET_FIT_LABELS.DIRECT_SUBSTANTIVE;
    directSubstantive = true;
  } else if (NO_LINK_RE.test(text)) {
    // (5) broad "no MMR/autism link" is not a refutation of the specific
    // data-handling misconduct unless it addresses the disputed study/data.
    compatibilityLabel = TARGET_FIT_LABELS.BACKGROUND_CAUSAL;
  } else if (roleName === "official_response_candidate") {
    compatibilityLabel = TARGET_FIT_LABELS.OFFICIAL_RESPONSE;
  } else if (roleName === "related_reanalysis_candidate" || roleName === "methodology_or_review_candidate") {
    compatibilityLabel = TARGET_FIT_LABELS.METHODOLOGY_CONTEXT;
  } else if (roleName === "original_study_candidate" || roleName === "official_study_page_candidate") {
    compatibilityLabel = TARGET_FIT_LABELS.STUDY_IDENTITY_CONTEXT;
  } else if (hasObject && !hasAction) {
    compatibilityLabel = TARGET_FIT_LABELS.BACKGROUND_CAUSAL;
  } else if (tokenSet.size && (overlaps(evidenceNeed.subjectTerms, tokenSet) || overlaps(evidenceNeed.objectTerms, tokenSet))) {
    compatibilityLabel = TARGET_FIT_LABELS.TOPIC_ONLY;
  } else {
    compatibilityLabel = TARGET_FIT_LABELS.INSUFFICIENT;
  }

  if (directSubstantive) {
    return {
      compatibilityLabel,
      compatibleWithTarget: true,
      finalStance: originalLlmStance,
      directness: "direct",
      persistAsDirectSubstantive: originalLlmStance === "support" || originalLlmStance === "refute",
      rejectedReason: null,
      missingRequiredElements: [],
      originalLlmStance,
      sourceRole: roleName,
      gated: true,
    };
  }

  return {
    compatibilityLabel,
    compatibleWithTarget: false,
    // Non-direct outcomes are downgraded to nuance/context and never persist as
    // a direct substantive support/refute link.
    finalStance: NON_DIRECT_LABELS.has(compatibilityLabel) ? "nuance" : originalLlmStance,
    directness: "context",
    persistAsDirectSubstantive: false,
    rejectedReason: compatibilityLabel,
    missingRequiredElements,
    originalLlmStance,
    sourceRole: roleName,
    gated: true,
  };
}

export function logPostScrapeTargetFit({ claim = {}, target = {}, evidence = {}, fit, persisted }) {
  logger.log(`[POST_SCRAPE_TARGET_FIT] ${JSON.stringify({
    event: "post_scrape_target_fit",
    claimId: claim?.id ?? evidence?.claimId ?? null,
    targetId: evidence?.evidenceTargetId ?? target?.evaluationTargetId ?? null,
    targetType: target?.evaluationTargetType || evidence?.evidenceTargetType || null,
    sourceUrl: String(evidence?.url || "").slice(0, 500),
    compatibilityLabel: fit.compatibilityLabel,
    compatibleWithTarget: fit.compatibleWithTarget,
    originalLlmStance: fit.originalLlmStance,
    finalStance: fit.finalStance,
    directness: fit.directness,
    persisted: Boolean(persisted),
    rejectedReason: fit.rejectedReason,
    missingRequiredElements: fit.missingRequiredElements,
    sourceRole: fit.sourceRole,
  })}`);
}
