// backend/services/admiraltyEvaluator.js
//
// Admiralty-style source/evidence evaluation.
//
//   Letter A-E = source reliability  (Ø = not yet assessed)
//   Number 1-5 = claim credibility   (Ø = not yet assessed)
//
// This service CONSUMES normalized signals from SourceIdentityResolver,
// SourceLineageResolver, publisher enrichment, and provider lookups.
// It does NOT call external APIs directly — that is the registry's job.
//
// Exported:
//   evaluateAdmiraltyCode(input, options)  → full evaluation result
//   letterLabel(letter)                    → human string
//   numberLabel(number)                    → human string
//   storeEvaluation(query, evaluation)     → persist to admiralty_evaluations

import logger from "../src/utils/logger.js";
import { lookupClaimAllProviders } from "./sourceProviders/sourceProviderRegistry.js";

// ── Human-readable labels ─────────────────────────────────────────────────────

export const LETTER_LABEL = {
  A:  "Highly reliable — authoritative primary source, strong provenance",
  B:  "Usually reliable — good reputation or institutional process",
  C:  "Mixed / context-dependent — may need corroboration",
  D:  "Questionable — advocacy-heavy, poor transparency, or not independent",
  E:  "Unreliable — excerpt/repost chain, misleading framing, or known low quality",
  "Ø": "Source not yet assessed — insufficient identity or provenance data",
};

export const NUMBER_LABEL = {
  1:   "Confirmed by strong independent evidence or authoritative primary source",
  2:   "Probably true — strongly supported",
  3:   "Possibly true — plausible but needs more context or corroboration",
  4:   "Doubtful — weakly supported or contested",
  5:   "Probably false — contradicted by stronger evidence",
  "Ø": "Claim not yet assessed — insufficient evidence available",
};

// ── Source type → base letter mapping ────────────────────────────────────────

const SOURCE_TYPE_BASE = {
  primary:    "A",
  government: "B",
  academic:   "B",
  journalism: "B",
  reference:  "B",  // Wikipedia etc.
  advocacy:   "D",
  corporate:  "C",
  opinion:    "C",
  social:     "D",
  platform:   "D",
  unknown:    "Ø",
};

// Normalize free-form LLM-extracted source_type strings to canonical keys.
// LLMs return values like "parliament", "legislative body", "think tank" that
// don't match SOURCE_TYPE_BASE keys — this catches the most common misses.
function normalizeSourceType(raw) {
  if (!raw) return null;
  const t = raw.toLowerCase();
  if (/parliament|congress|senate|legislative|government|governmental|federal|national agency|ministry|department of|public authority|regulatory body|intergovernmental|supranational|european union|united nations|eu institution/.test(t)) return "government";
  if (/university|universit|college|academic|research institute|scientific institute|research service|research department|peer.review|scholarly|science institute/.test(t)) return "academic";
  if (/journal\b|scientific journal|academic journal|peer.reviewed journal/.test(t)) return "academic";
  if (/fact.?check|fact.?finder|news|press|newspaper|media outlet|broadcast|television|radio|magazine|journalism/.test(t)) return "journalism";
  if (/encyclopedia|dictionary|reference work|library|archive/.test(t)) return "reference";
  if (/think.?tank|policy institute|policy research|policy organization/.test(t)) return "advocacy";
  if (/advocacy|activist|campaign|pressure group|interest group|lobby/.test(t)) return "advocacy";
  if (/corporation|company|business|commercial|industry|trade association|private sector/.test(t)) return "corporate";
  if (/nonprofit|ngo|charity|foundation/.test(t)) return "corporate";  // neutral fallback for orgs
  if (/opinion|editorial|commentary|column|blog/.test(t)) return "opinion";
  if (/social media|platform|user.generated/.test(t)) return "social";
  if (/primary source|official record|firsthand/.test(t)) return "primary";
  return "unknown";
}

// ── Letter ────────────────────────────────────────────────────────────────────

function deriveSourceLetter(signals = {}) {
  const {
    sourceType,
    resolutionLevel,
    lineageType,
    sourceDepth,
    isPlatformHosted,
    publicationContext,
    veracityScore,
    isExcerptOrRepost,
    isPointerSource,
    upstreamScrapeFailed,
    opensourcesFlagged,
    opensourcesFlaggedTypes = [],
    mbfcReliability,
    adfontesReliability,
    allsidesFound,
    wikidataFound,
    wikipediaFound,
  } = signals;

  // ── Ø: no meaningful identity ────────────────────────────────────────────
  if (!sourceType || sourceType === "unknown") {
    if (!resolutionLevel || resolutionLevel <= 1) return "Ø";
    if (resolutionLevel <= 2 && !wikidataFound && !wikipediaFound) return "Ø";
  }

  // ── Start from source-type base ──────────────────────────────────────────
  const canonicalType = normalizeSourceType(sourceType) ?? sourceType;
  let letter = SOURCE_TYPE_BASE[canonicalType] ?? "C";

  // ── Known-problematic signals → E ───────────────────────────────────────
  const dangerTypes = ["fake","conspiracy","propaganda","disinformation","junk science"];
  if (opensourcesFlagged && opensourcesFlaggedTypes.some(t => dangerTypes.includes(t.toLowerCase()))) {
    letter = "E";
  }

  // ── Veracity score adjustments ───────────────────────────────────────────
  if (veracityScore != null) {
    if (veracityScore >= 80 && ["C","D"].includes(letter)) letter = "B";
    if (veracityScore >= 70 && ["C","D"].includes(letter)) letter = letter === "C" ? "B" : "C";
    if (veracityScore < 40  && ["A","B"].includes(letter)) letter = "C";
    if (veracityScore < 40  && letter === "C")             letter = "D";
    if (veracityScore < 25)                                letter = "E";
  }

  // ── MBFC / Ad Fontes overrides ───────────────────────────────────────────
  if (mbfcReliability === "low" || adfontesReliability === "low") {
    if (["A","B"].includes(letter)) letter = "C";
    if (letter === "C")             letter = "D";
  }
  if ((mbfcReliability === "high" || adfontesReliability === "high") && letter === "C") {
    letter = "B";
  }

  // ── Lineage penalties ────────────────────────────────────────────────────
  if (lineageType === "excerpt" || isExcerptOrRepost) {
    if (letter === "A") letter = "B";
    else if (letter === "B") letter = "C";
  }
  if (lineageType === "pointer" || isPointerSource) {
    if (["A","B"].includes(letter)) letter = "C";
  }
  if (lineageType === "repost") {
    if (letter === "A") letter = "B";
  }

  // Each extra hop from original source adds uncertainty
  if (sourceDepth > 1) {
    const steps = Math.min(sourceDepth - 1, 3);
    const ORDER = ["A","B","C","D","E","Ø"];
    const idx = Math.min(ORDER.indexOf(letter) + steps, ORDER.length - 1);
    letter = ORDER[idx];
  }

  // ── Platform-hosted without resolved identity ────────────────────────────
  if (isPlatformHosted && (!resolutionLevel || resolutionLevel < 3)) {
    if (["A","B"].includes(letter)) letter = "D";
    else if (letter === "C")        letter = "D";
  }

  // ── Publication context penalties ────────────────────────────────────────
  if (["opinion","blog","editorial","former_blog_network"].includes(publicationContext)) {
    if (letter === "A") letter = "B";
    else if (letter === "B") letter = "C";
  }
  if (publicationContext === "press_release" && letter === "A") letter = "B";

  return letter;
}

// ── Number ────────────────────────────────────────────────────────────────────

function deriveCredibilityNumber(signals = {}) {
  const {
    googleFactCheckMatches = [],
    supportingEvidenceCount = 0,
    refutingEvidenceCount   = 0,
    primarySourceCount      = 0,
    authoritativeSourceCount = 0,
    scientificConsensusMatch = false,
  } = signals;

  const hasAnyEvidence =
    supportingEvidenceCount > 0 ||
    refutingEvidenceCount > 0 ||
    googleFactCheckMatches.length > 0;

  if (!hasAnyEvidence) return "Ø"; // not yet assessed

  let number = 3; // default: possibly true

  // Google Fact Check is a strong signal
  if (googleFactCheckMatches.length > 0) {
    const ratings = googleFactCheckMatches.map(m =>
      (m.normalized?.rating ?? m.rating ?? "").toLowerCase()
    );
    const isFalse = ratings.some(r => /false|incorrect|misleading|wrong|debunked/.test(r));
    const isTrue  = ratings.some(r => /true|correct|accurate|confirmed/.test(r));
    const isMixed = ratings.some(r => /partial|mixed|mostly/.test(r));

    if (isFalse) number = 5;
    else if (isTrue && !isMixed) number = 2;
    else if (isMixed || (isTrue && isMixed)) number = 3;
  }

  // Primary/authoritative sources improve number
  if ((primarySourceCount > 0 || authoritativeSourceCount >= 2) && number >= 3) {
    number = Math.min(number, 2);
  }

  // Scientific consensus
  if (scientificConsensusMatch) {
    number = number >= 3 ? 1 : Math.min(number, 1);
  }

  // Evidence balance
  if (supportingEvidenceCount > 0 && refutingEvidenceCount === 0 && number > 3) number = 3;
  if (refutingEvidenceCount > 0   && supportingEvidenceCount === 0 && number < 4) number = 4;
  if (refutingEvidenceCount > supportingEvidenceCount * 2 && number < 4) number = 4;
  if (supportingEvidenceCount >= 3 && refutingEvidenceCount === 0 && number > 2) number = 2;

  return number;
}

// ── Confidence ────────────────────────────────────────────────────────────────

function deriveConfidence(sourceSignals, claimSignals, providerResults) {
  const providerHits = providerResults.filter(r => r?.matchFound).length;
  const hasGFC = claimSignals?.googleFactCheckMatches?.length > 0;
  const hasLineage = !!sourceSignals?.lineageType && sourceSignals.lineageType !== "unknown";

  if (providerHits >= 3 || (hasGFC && providerHits >= 2)) return "high";
  if (providerHits >= 1 || hasLineage || hasGFC)           return "medium";
  return "low";
}

// ── Warnings + recommended actions ───────────────────────────────────────────

function buildWarnings(sourceSignals) {
  const warnings = [];
  const { lineageType, sourceDepth, isPlatformHosted, platformName, upstreamScrapeFailed,
          isExcerptOrRepost, isPointerSource, publicationContext, opensourcesFlagged,
          opensourcesFlaggedTypes } = sourceSignals;

  if (isExcerptOrRepost || lineageType === "excerpt") {
    warnings.push("This source appears to quote or excerpt another source.");
  }
  if (isPointerSource || lineageType === "pointer") {
    warnings.push("This source is a link roundup or pointer page, not original content.");
  }
  if (sourceDepth > 1) {
    warnings.push(`This source is ${sourceDepth} step(s) removed from the original.`);
  }
  if (upstreamScrapeFailed) {
    warnings.push("Original or upstream source detected but could not be scraped (bot-wall, paywall, or timeout).");
  }
  if (isPlatformHosted) {
    warnings.push(`Content is hosted on platform: ${platformName ?? "social/platform site"}. Platform is not the publisher.`);
  }
  if (publicationContext === "opinion") warnings.push("This is opinion/editorial content, not news reporting.");
  if (publicationContext === "press_release") warnings.push("This is a press release.");
  if (publicationContext === "blog") warnings.push("This is a blog post.");
  if (opensourcesFlagged) {
    warnings.push(`Source flagged by OpenSources: [${opensourcesFlaggedTypes.join(", ")}].`);
  }

  return warnings;
}

function buildRecommendedActions(letter, number, sourceSignals) {
  const actions = [];
  const { lineageType, isExcerptOrRepost, upstreamScrapeFailed, sourceDepth,
          recommendedEvidenceUrl, sourceType } = sourceSignals;

  if (recommendedEvidenceUrl) {
    actions.push({ action: "use_original_source", label: "Use Original Source Instead", url: recommendedEvidenceUrl });
  }
  if (upstreamScrapeFailed) {
    actions.push({ action: "manual_review", label: "Manually review upstream source" });
  }
  if (["E","Ø"].includes(letter)) {
    actions.push({ action: "resolve_source", label: "Resolve Source Identity" });
  }
  if (number === 5) {
    actions.push({ action: "find_refutations", label: "Find additional refuting evidence" });
  }
  if (number === "Ø") {
    actions.push({ action: "find_evidence", label: "Find corroborating evidence" });
  }
  if (sourceType === "social" || sourceType === "platform") {
    actions.push({ action: "find_original", label: "Locate original published source" });
  }

  return actions;
}

// ── Main evaluator ────────────────────────────────────────────────────────────

/**
 * evaluateAdmiraltyCode(input, options)
 *
 * input: {
 *   sourceUrl, publisherId, publisherName, sourceIdentity, sourceLineage,
 *   publicationContext, author, articleTitle, articleText, claimText,
 *   existingPublisherProfile, existingSourceRatings, factCheckMatches,
 *   scientificConsensusSignals, userVerifiedLinks, providerResults
 * }
 *
 * options: { debug, runClaimLookup }
 *
 * Returns the full Admiralty evaluation object.
 */
export async function evaluateAdmiraltyCode(input = {}, options = {}) {
  const {
    sourceUrl,
    publisherName,
    sourceIdentity,
    sourceLineage,
    publicationContext,
    existingSourceRatings = [],
    factCheckMatches = [],
    scientificConsensusSignals,
    claimText,
    providerResults = [],
  } = input;

  const providerTrace = [];

  // ── Run Google Fact Check if we have a claim and no pre-fetched results ──
  let gcfMatches = factCheckMatches;
  if (claimText && !gcfMatches.length && options.runClaimLookup !== false) {
    try {
      const gcfResults = await lookupClaimAllProviders({ claimText, sourceUrl, publisherName });
      const gcf = gcfResults.find(r => r.providerName === "google_fact_check");
      if (gcf?.matchFound) {
        gcfMatches = gcf.allMatches ?? [gcf];
        providerTrace.push({ providerName: "google_fact_check", lookupType: "claim", status: gcf.status, matchFound: true, latencyMs: gcf.latencyMs, usedInEvaluation: true, reasonUsedOrIgnored: "GFC match found" });
      } else {
        providerTrace.push({ providerName: "google_fact_check", lookupType: "claim", status: gcf?.status ?? "no_match", matchFound: false, latencyMs: gcf?.latencyMs ?? 0, usedInEvaluation: false, reasonUsedOrIgnored: gcf?.errorMessage ?? "No match" });
      }
    } catch { /* never block evaluation */ }
  }

  // ── Build source signals from identity + lineage + enrichment ────────────
  const identity = sourceIdentity ?? {};
  const lineage  = sourceLineage  ?? {};

  // Extract veracity score from existing ratings
  const veracityRating = existingSourceRatings.find(r => r.rating_type === "veracity");
  const veracityScore  = veracityRating?.veracity_score ?? null;

  // Extract provider signals
  const mbfc      = providerResults.find(r => r.providerName === "mbfc");
  const adfontes  = providerResults.find(r => r.providerName === "adfontes");
  const allsides  = providerResults.find(r => r.providerName === "allsides");
  const opensources = providerResults.find(r => r.providerName === "opensources");
  const wikipedia = providerResults.find(r => r.providerName === "wikipedia");
  const wikidata  = providerResults.find(r => r.providerName === "wikidata");

  const sourceSignals = {
    sourceType:           identity.sourceType ?? null,
    resolutionLevel:      identity.resolutionLevel ?? 0,
    lineageType:          lineage.lineageType ?? null,
    sourceDepth:          lineage.sourceDepth ?? 0,
    isPlatformHosted:     identity.isPlatformHosted ?? false,
    platformName:         identity.platformName ?? null,
    publicationContext:   publicationContext ?? lineage.publicationContext ?? null,
    veracityScore,
    isExcerptOrRepost:    lineage.isExcerpt || lineage.isRepost || false,
    isPointerSource:      lineage.isPointer ?? false,
    upstreamScrapeFailed: lineage.upstreamScrapeFailed ?? false,
    recommendedEvidenceUrl: lineage.upstreamUrl ?? null,
    hasOriginalSource:    !!lineage.upstreamUrl,
    opensourcesFlagged:   opensources?.matchFound ?? false,
    opensourcesFlaggedTypes: opensources?.normalized?.flaggedTypes ?? [],
    mbfcReliability:      mbfc?.normalized?.reliability ?? null,
    adfontesReliability:  adfontes?.normalized?.reliability ?? null,
    allsidesFound:        allsides?.matchFound ?? false,
    wikidataFound:        wikidata?.matchFound ?? false,
    wikipediaFound:       wikipedia?.matchFound ?? false,

    // Published indicator fields for full signal object
    publisherProfileFound:  !!wikipedia?.matchFound || !!wikidata?.matchFound,
    publisherRatingSource:  [mbfc?.matchFound && "mbfc", adfontes?.matchFound && "adfontes", allsides?.matchFound && "allsides"].filter(Boolean).join(",") || null,
    sourceIdentityKind:     identity.sourceType ?? "unknown",
    sourceLineageType:      lineage.lineageType ?? "unknown",
    isPlatformHostedFull:   identity.isPlatformHosted ?? false,
    isPointerSourceFull:    lineage.isPointer ?? false,
    isExcerptOrRepostFull:  lineage.isExcerpt || lineage.isRepost || false,
    authorKnown:            !!(identity.authorName || input.author),
    domainKnown:            !!(identity.domain),
    wikipediaMatched:       wikipedia?.matchFound ?? false,
    allsidesMatched:        allsides?.matchFound ?? false,
    adfontesMatched:        adfontes?.matchFound ?? false,
    mbfcMatched:            mbfc?.matchFound ?? false,
    newsguardMatched:       false, // not implemented
  };

  // ── Build claim signals ───────────────────────────────────────────────────
  const claimSignals = {
    googleFactCheckMatches:   gcfMatches,
    supportingEvidenceCount:  input.supportingEvidenceCount ?? 0,
    refutingEvidenceCount:    input.refutingEvidenceCount   ?? 0,
    neutralEvidenceCount:     input.neutralEvidenceCount    ?? 0,
    primarySourceCount:       input.primarySourceCount      ?? 0,
    authoritativeSourceCount: input.authoritativeSourceCount ?? 0,
    scientificConsensusMatch: !!(scientificConsensusSignals?.matched),
    consensusSourceNames:     scientificConsensusSignals?.sourceNames ?? [],
    existingVeraStrataLinks:  input.userVerifiedLinks ?? [],
  };

  // ── Derive code ───────────────────────────────────────────────────────────
  const sourceReliabilityLetter = deriveSourceLetter(sourceSignals);
  const claimCredibilityNumber  = deriveCredibilityNumber(claimSignals);
  const admiraltyCode           = `${sourceReliabilityLetter}${claimCredibilityNumber}`;

  const confidence = deriveConfidence(sourceSignals, claimSignals, providerResults);
  const warnings   = buildWarnings(sourceSignals);
  const recommendedActions = buildRecommendedActions(sourceReliabilityLetter, claimCredibilityNumber, sourceSignals);

  const result = {
    sourceReliabilityLetter,
    claimCredibilityNumber,
    admiraltyCode,
    confidence,
    evaluationStatus: "machine_suggested",
    sourceReliabilityRationale: LETTER_LABEL[sourceReliabilityLetter],
    claimCredibilityRationale:  NUMBER_LABEL[claimCredibilityNumber],
    sourceSignals,
    claimSignals,
    warnings,
    recommendedActions,
  };

  if (options.debug) result.providerTrace = providerTrace;

  return result;
}

// ── Persistence ───────────────────────────────────────────────────────────────

/**
 * Upsert an Admiralty evaluation into admiralty_evaluations.
 * Never throws.
 */
export async function storeEvaluation(query, {
  targetType, targetId, sourceUrl, publisherId,
  evaluation,
}) {
  try {
    const {
      sourceReliabilityLetter: letter,
      claimCredibilityNumber:  number,
      admiraltyCode,
      confidence,
      evaluationStatus,
      sourceReliabilityRationale,
      claimCredibilityRationale,
      sourceSignals,
      claimSignals,
      warnings,
      recommendedActions,
    } = evaluation;

    await query(
      `INSERT INTO admiralty_evaluations
         (target_type, target_id, source_url, publisher_id,
          source_reliability_letter, claim_credibility_number, admiralty_code,
          confidence, evaluation_status,
          source_reliability_rationale, claim_credibility_rationale,
          source_signals_json, claim_signals_json,
          warnings_json, recommended_actions_json,
          created_by)
       VALUES (?,?,?,?, ?,?,?, ?,?, ?,?, ?,?, ?,?, 'system')
       ON DUPLICATE KEY UPDATE
         source_reliability_letter      = IF(evaluation_status NOT IN ('human_confirmed','community_reviewed'), VALUES(source_reliability_letter), source_reliability_letter),
         claim_credibility_number       = IF(evaluation_status NOT IN ('human_confirmed','community_reviewed'), VALUES(claim_credibility_number), claim_credibility_number),
         admiralty_code                 = IF(evaluation_status NOT IN ('human_confirmed','community_reviewed'), VALUES(admiralty_code), admiralty_code),
         confidence                     = VALUES(confidence),
         source_reliability_rationale   = VALUES(source_reliability_rationale),
         claim_credibility_rationale    = VALUES(claim_credibility_rationale),
         source_signals_json            = VALUES(source_signals_json),
         claim_signals_json             = VALUES(claim_signals_json),
         warnings_json                  = VALUES(warnings_json),
         recommended_actions_json       = VALUES(recommended_actions_json),
         updated_at                     = NOW()`,
      [
        targetType, targetId, sourceUrl ?? null, publisherId ?? null,
        letter, (number === "Ø" ? null : number), admiraltyCode,
        confidence, evaluationStatus,
        sourceReliabilityRationale, claimCredibilityRationale,
        JSON.stringify(sourceSignals), JSON.stringify(claimSignals),
        JSON.stringify(warnings), JSON.stringify(recommendedActions),
      ]
    );
  } catch (err) {
    logger.warn(`⚠️ [AdmiraltyEvaluator] Failed to store evaluation: ${err.message}`);
  }
}
