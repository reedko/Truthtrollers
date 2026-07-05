// backend/src/core/runEvidenceEngine.js
// --------------------------------------------------------------
// Purpose: Wrap EvidenceEngine.run() so the extension can request it.
//
// INPUT:
//   taskContentId    = numeric content_id of TASK
//   claimIds         = array of claim_id from processTaskClaims()
//   readableText     = original scraped text (optional but useful)
//
// OUTPUT:
//   { aiReferences } - includes referenceContentId for each reference
//
// DESIGN:
//   References are FULLY PROCESSED during fetch (metadata extraction,
//   content creation, authors/publishers persist) - NO post-processing needed.
// --------------------------------------------------------------

import { openAiLLM } from "./openAiLLM.js";
import { duckDuckGoSearch } from "./duckDuckGoSearch.js";
import { createEvidenceRetrievalGateway } from "./evidenceRetrievalGateway.js";
import { loadSearchGatewayConfig } from "./searchGatewayConfig.js";
import { loadClaimEvaluationTargets } from "./evaluationTargetStore.js";
import { EvidenceEngine } from "./evidenceEngine.js";
import { SourceQualityScorer } from "./sourceQualityScorer.js";
import PromptManager from "./promptManager.js";
import { resolveSourceIdentity } from "../../services/sourceIdentityResolver.js";
import { resolveSourceLineage } from "../../services/sourceLineageResolver.js";
import { createContentInternal } from "../storage/createContentInternal.js";
import { persistAuthors } from "../storage/persistAuthors.js";
import { linkPublisherRole } from "../storage/persistPublishers.js";
import { extractAuthors } from "../utils/extractAuthors.js";
import { processPublishingIdentity } from "../services/publishingIdentityPipeline.js";
import { extractInlineRefs } from "../utils/extractInlineRefs.js";
import { getMainHeadline } from "../utils/getMainHeadline.js";
import { getBestImage } from "../utils/getBestImage.js";
import { buildEvidenceClaimContext } from "../utils/normalizeEvidenceClaim.js";
import { buildEvidenceNeedV1, buildEvidenceTargetQueries, buildEvidenceNeedFromEvaluationTargets, tokenizeBearingText } from "./evidenceNeed.js";
import { isBearingShadowEnabled, isSnippetBearingLlmEnabled } from "./snippetBearing.js";
import { loadBearingGatingConfig } from "./bearingConfig.js";
import { recordEvidenceComparisonRun } from "./evidenceComparisonRegistry.js";
import { createEvidenceRepairAudit } from "./evidenceRepairAudit.js";
import {
  appendPreservedEvidenceAssertion,
  assertionFingerprint,
  buildPreservedEvidenceAssertion,
  persistDirectEvidenceAssertions,
} from "./evidenceAssertionPersistence.js";
import { buildRetrievalContextsForClaim } from "./retrievalContext.js";
import { discoverStudyIdentities } from "./studyIdentityDiscovery.js";
import { extractCitationDerivedCandidates, extractPdfTextWithFallback } from "./citationExpansion.js";
import { buildIdentityDocumentLink } from "./identityBearing.js";
import { buildAcademicPublishingIdentity } from "./academicContentResolver.js";
import logger from "../utils/logger.js";
import * as cheerio from "cheerio";
import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";

import fetch from "node-fetch";
import { isUsableSourceEntityName } from "../utils/publisherNameValidation.js";
import { fetchWaybackSnapshot } from "../utils/fetchWithFallbacks.js";

/**
 * Helper: Ensure content_relations record exists linking reference to task
 * This is critical - without it, references are orphaned in the database
 */
async function ensureContentRelation(query, taskContentId, referenceContentId) {
  if (taskContentId === referenceContentId) {
    logger.warn(`⚠️ [Evidence] Skipping self-referential content_relation for content_id=${taskContentId}`);
    return;
  }
  try {
    // Check if relation already exists
    const existing = await query(
      `SELECT 1 FROM content_relations WHERE content_id = ? AND reference_content_id = ?`,
      [taskContentId, referenceContentId]
    );

    if (existing.length === 0) {
      // Insert the relation with is_system=1 (AI-created)
      await query(
        `INSERT INTO content_relations (content_id, reference_content_id, added_by_user_id, is_system) VALUES (?, ?, NULL, 1)`,
        [taskContentId, referenceContentId]
      );
      logger.log(
        `🔗 [Evidence] Linked reference ${referenceContentId} to task ${taskContentId}`
      );
    } else {
      logger.log(
        `✓ [Evidence] Relation already exists: task ${taskContentId} → reference ${referenceContentId}`
      );
    }
  } catch (err) {
    logger.error(
      `❌ [Evidence] Failed to create content_relation for task ${taskContentId} → reference ${referenceContentId}:`,
      err
    );
    // Don't throw - we want to continue processing other references
  }
}

const JUNK_PUBLISHER_RE = /^(unknown( publisher)?|web|website|home|index|default|page|site|blog|news|online|internet|portal|network|media|publications?|facebook|youtube|twitter|instagram|tiktok|reddit|linkedin|pinterest|snapchat|telegram|x\.com|recaptcha|just a moment|cloudflare|attention required|one more step|checking your browser|access denied|bot protected)$/i;

function domainFromUrl(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

function usablePublisherName(name) {
  const cleaned = String(name || "").trim();
  if (!isUsableSourceEntityName(cleaned)) return null;
  if (JUNK_PUBLISHER_RE.test(cleaned)) return null;
  return cleaned;
}

function isLegitSourceCrestCode(code) {
  const normalized = String(code || "").trim().toUpperCase();
  if (!/^[A-EØ][1-5Ø]$/.test(normalized)) return false;
  return !normalized.startsWith("Ø");
}

async function getCachedPublisherCrest(query, publisherId) {
  if (!publisherId) return null;
  try {
    const rows = await query(
      `SELECT admiralty_code, evaluation_status, updated_at, created_at
         FROM admiralty_evaluations
        WHERE target_type = 'publisher'
          AND target_id = ?
          AND evaluation_status NOT IN ('insufficient_data')
        ORDER BY FIELD(evaluation_status,'human_confirmed','community_reviewed','machine_suggested'),
                 updated_at DESC,
                 created_at DESC
        LIMIT 1`,
      [publisherId]
    );
    const row = rows[0] || null;
    if (!row || !isLegitSourceCrestCode(row.admiralty_code)) return null;
    return row;
  } catch (err) {
    logger.warn(`⚠️  [Evidence] Publisher SourceCrest cache lookup failed for ${publisherId}: ${err.message}`);
    return null;
  }
}

async function ensureReferencePublisherLink({
  query,
  referenceContentId,
  url,
  publisher,
  title,
  author,
}) {
  if (!referenceContentId || !url) return null;

  const hintName = usablePublisherName(publisher?.name);
  let identity = null;
  try {
    identity = await resolveSourceIdentity(url, {
      query,
      hintName,
      title,
      author,
    });
  } catch (err) {
    logger.warn(`⚠️  [Evidence] Source identity resolution failed for ${url}: ${err.message}`);
  }

  const publisherName =
    (publisher?.role === "journal" || publisher?.confidence === "proxy" ? hintName : null) ||
    usablePublisherName(identity?.publisherName) ||
    hintName ||
    usablePublisherName(domainFromUrl(url));

  if (!publisherName) {
    logger.warn(`⚠️  [Evidence] No usable publisher resolved for reference ${referenceContentId}: ${url}`);
    return null;
  }

  let publisherId = identity?.publisherId || null;
  if (!publisherId) {
    const rows = await query(
      `CALL InsertOrGetPublisher(?, NULL, NULL, @publisherId)`,
      [publisherName]
    );
    publisherId = rows[0]?.[0]?.publisherId || null;
  }

  if (!publisherId) {
    logger.warn(`⚠️  [Evidence] InsertOrGetPublisher returned no ID for "${publisherName}"`);
    return null;
  }

  await linkPublisherRole(query, referenceContentId, {
    publisherId,
    role: "primary_source",
    isPrimary: true,
    method: "source_resolver",
  });

  logger.log(
    `🛡 [Evidence] Linked publisher "${publisherName}" (id=${publisherId}) to reference ${referenceContentId}`
  );

  const cachedCrest = await getCachedPublisherCrest(query, publisherId);

  return {
    publisherId,
    publisherName,
    sourceType: identity?.sourceType || "unknown",
    resolutionLevel: identity?.resolutionLevel || 3,
    cachedCrest,
  };
}

function enrichReferencePublisherAsync({ query, referenceContentId, url, publisherLink }) {
  if (!publisherLink?.publisherId) return;
  if (publisherLink.cachedCrest) {
    logger.log(
      `🛡 [Evidence] Using cached publisher SourceCrest ${publisherLink.cachedCrest.admiralty_code} for reference ${referenceContentId}; skipping scrape-time enrichment`
    );
    return;
  }

  (async () => {
    try {
      const { enrichPublisherIfNeeded } = await import("../services/publisherEnrichmentService.js");
      const { evaluateAdmiraltyCode, storeEvaluation } = await import("../../services/admiraltyEvaluator.js");

      const enrichResult = await enrichPublisherIfNeeded({
        query,
        publisherId: publisherLink.publisherId,
        publisherName: publisherLink.publisherName,
        sourceUrl: url,
        force: false,
        context: "reference_source",
      });

      const [profileRows, ratingRows] = await Promise.all([
        query(
          `SELECT source_type FROM publisher_profiles WHERE publisher_id = ? ORDER BY last_checked DESC LIMIT 1`,
          [publisherLink.publisherId]
        ),
        query(
          `SELECT source, rating_label, rating_type, bias_score, veracity_score, score, confidence
             FROM publisher_ratings WHERE publisher_id = ? AND user_id IS NULL ORDER BY last_checked DESC`,
          [publisherLink.publisherId]
        ),
      ]);

      const evaluation = await evaluateAdmiraltyCode({
        sourceUrl: url,
        publisherName: publisherLink.publisherName,
        sourceIdentity: {
          sourceType: profileRows[0]?.source_type || publisherLink.sourceType,
          resolutionLevel: publisherLink.resolutionLevel || 3,
        },
        existingSourceRatings: ratingRows,
      });

      await storeEvaluation(query, {
        targetType: "content",
        targetId: referenceContentId,
        sourceUrl: url,
        publisherId: publisherLink.publisherId,
        evaluation,
      });

      logger.log(
        `🛡 [Evidence] SourceCrest enriched for reference ${referenceContentId}: "${publisherLink.publisherName}" code=${evaluation.admiraltyCode} status=${enrichResult?.status ?? "done"}`
      );
    } catch (err) {
      logger.warn(
        `⚠️  [Evidence] SourceCrest enrichment skipped for reference ${referenceContentId}: ${err.message}`
      );
    }
  })();
}

function clampScore(value, fallback = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(100, n));
}

// Phase 4: structured query plan logging per evaluation target
function logEvidenceQueryPlan(claim) {
  const targets = Array.isArray(claim.evaluationTargets) ? claim.evaluationTargets : [];
  const queries = (Array.isArray(claim.searchTargets) ? claim.searchTargets : []).map((t) => t.query).filter(Boolean);
  const planned = queries.length > 0;

  if (!targets.length) {
    logger.log(`[QUERY_PLAN] ${JSON.stringify({
      claim_id: claim.id,
      evaluation_target_id: null,
      target_type: "legacy",
      target_text: String(claim.searchText || claim.text || "").slice(0, 200),
      queries,
      execution_status: planned ? "planned" : "skipped",
      skip_reason: planned ? null : "no_search_targets_generated",
    })}`);
    return;
  }

  for (const target of targets.filter((t) => t.searchEligible !== false)) {
    logger.log(`[QUERY_PLAN] ${JSON.stringify({
      claim_id: claim.id,
      evaluation_target_id: target.evaluationTargetId || null,
      target_type: target.targetType || "unknown",
      target_text: String(target.targetText || "").slice(0, 200),
      queries,
      execution_status: planned ? "planned" : "skipped",
      skip_reason: planned ? null : "no_search_targets_generated",
    })}`);
  }

  if (targets.some((t) => t.searchEligible !== false) && !planned) {
    logger.warn(`[QUERY_PLAN] claim_id=${claim.id} has search-eligible targets but generated no queries — check evaluation target fields`);
  }
}

export function buildSearchTargets(claim) {
  const text = String(claim?.searchText || claim?.promptText || claim?.text || "").trim();
  const originalText = String(claim?.originalText || claim?.text || "").trim();
  const source = text || originalText;
  if (!source) return [];

  const targets = [];
  const add = (query, matchedPart, intent = "both") => {
    const cleaned = String(query || "").replace(/\s+/g, " ").trim();
    if (!cleaned) return;
    if (targets.some((t) => t.query.toLowerCase() === cleaned.toLowerCase())) return;
    targets.push({ query: cleaned, matchedPart, intent });
  };

  const attributionPattern = /\b(said|says|claimed|claims|alleged|alleges|reported|reports|according to|revealed|stated|wrote|testified)\b/i;
  const hasAttribution = attributionPattern.test(originalText) || attributionPattern.test(source);
  const combinedText = `${source} ${originalText}`.toLowerCase();
  const isCdcMmrAutismClaim =
    /\bcdc\b|centers for disease control/.test(combinedText) &&
    /\bmmr\b|measles/.test(combinedText) &&
    /autism/.test(combinedText);
  const allegesManipulatedData =
    /manipulat|omit|omitted|exclude|excluded|data/.test(combinedText);
  const allegesDestroyedData =
    /destroy|destroyed|shred|shredded|discard|discarded/.test(combinedText);

  if (isCdcMmrAutismClaim && allegesManipulatedData) {
    add(
      "CDC MMR autism DeStefano 2004 data manipulation omitted data",
      "object_claim",
      "refute",
    );
    add(
      "DeStefano 2004 MMR autism study data available Thompson Hooker",
      "study_or_event_identity",
      "refute",
    );
  }

  if (isCdcMmrAutismClaim && allegesDestroyedData) {
    add(
      "CDC MMR autism study raw data destroyed available DeStefano Thompson",
      "object_claim",
      "refute",
    );
  }

  if (hasAttribution) {
    const parts = source.split(attributionPattern).map((part) => part.trim()).filter(Boolean);
    const beforeVerb = parts[0] || "";
    const afterVerb = parts.slice(2).join(" ") || parts[1] || "";

    add(afterVerb || source, "object_claim");
    add([beforeVerb, afterVerb].filter(Boolean).join(" "), "attribution");
  } else {
    add(source, "object_claim");
  }

  const identityTerms = (source
    .match(/\b(?:[A-Z][A-Za-z0-9'’.-]+(?:\s+[A-Z][A-Za-z0-9'’.-]+){0,4}|\d{4}|[A-Z]{2,})\b/g) || [])
    .map((term) => term.trim())
    .filter((term) => {
      if (/^\d{4}$/.test(term) || /^[A-Z]{2,}s?$/.test(term)) return true;
      if (term.includes(" ")) return true;
      // A capitalized sentence opener is not evidence of an entity. This
      // previously produced searches such as "Each", "Early", and
      // "Congenital" from otherwise ordinary claim sentences.
      return !source.toLowerCase().startsWith(`${term.toLowerCase()} `);
    });
  const hasSpecificIdentity = identityTerms.length >= 2 || identityTerms.some((term) => term.includes(" "));
  if (hasSpecificIdentity) {
    add(identityTerms.slice(0, 8).join(" "), "study_or_event_identity", "context");
  }

  add(source, "context", "context");
  return targets.slice(0, 3);
}

export function isEvidenceTargetRoutingEnabled(env = process.env) {
  return String(env.ENABLE_EVIDENCE_TARGET_QUERIES || "true").trim().toLowerCase() !== "false";
}

export function addEvidenceTargetProvenance(searchTargets, evidenceNeed) {
  const targets = Array.isArray(evidenceNeed?.evidenceTargets) ? evidenceNeed.evidenceTargets : [];
  return (Array.isArray(searchTargets) ? searchTargets : []).map((searchTarget, index) => {
    const target = targets[index] || targets[0] || {};
    return {
      ...searchTarget,
      stanceGoal: searchTarget.stanceGoal || target.stanceGoal || searchTarget.intent || "open",
      evidenceTargetId: searchTarget.evidenceTargetId || target.id || "legacy-direct",
      evidenceTargetType: searchTarget.evidenceTargetType || target.evidenceTargetType || "other",
      bearingRequirement: searchTarget.bearingRequirement || target.bearingRequirement || "direct_truth_value",
    };
  });
}

export function buildEvidenceQueryContexts(claims) {
  const safeClaims = Array.isArray(claims) ? claims : [];
  const frequency = new Map();
  for (const claim of safeClaims) {
    for (const token of new Set(tokenizeBearingText(claim?.text))) {
      frequency.set(token, (frequency.get(token) || 0) + 1);
    }
  }
  const caseSubjectTerms = [...frequency.entries()]
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)
    .slice(0, 12)
    .map(([token]) => token);

  return Object.fromEntries(safeClaims.map((claim) => [Number(claim.id), {
    caseSubjectTerms,
    retrievalContext: claim.retrievalContext || null,
    retrievalContexts: Array.isArray(claim.retrievalContexts) ? claim.retrievalContexts : [],
    relatedCaseClaims: safeClaims
      .filter((other) => Number(other.id) !== Number(claim.id))
      .slice(0, 4)
      .map((other) => String(other.text || "").replace(/\s+/g, " ").trim().slice(0, 240)),
  }]));
}

export async function runEvidenceEngine({
  query,
  taskContentId,
  claimIds,
  claims: claimMetadata = [],
  readableText,
  onProgress = null,
}) {
  const evidenceRunStartedAtMs = Date.now();
  logger.log("🟣 [runEvidenceEngine] Starting evidence run…");

  if (typeof query !== "function") throw new Error("runEvidenceEngine: missing promisified query function");
  if (!taskContentId) throw new Error("Missing taskContentId");
  if (!Array.isArray(claimIds) || claimIds.length === 0)
    throw new Error("No claims passed to EvidenceEngine");
  // Phase 4: visible-claim limit applies to claims, not to individual evaluation targets
  logger.log(`[QUERY_PLAN] Processing ${claimIds.length} visible claim(s) for content ${taskContentId}`);

  // Fetch task URL to exclude it from being used as its own reference
  const taskRows = await query(
    `SELECT url FROM content WHERE content_id = ?`,
    [taskContentId]
  );
  const taskUrl = taskRows?.[0]?.url || null;
  if (taskUrl) {
    logger.log(`🚫 [Evidence] Will skip task URL as reference: ${taskUrl}`);
  }

  const bearingConfig = await loadBearingGatingConfig({ query });
  const searchGatewayConfig = await loadSearchGatewayConfig({ query });
  const searchGateway = createEvidenceRetrievalGateway({ config: searchGatewayConfig });

  // Fetch claim text from DB
  const rows = await query(
    `SELECT claim_id, claim_text FROM claims WHERE claim_id IN (?)`,
    [claimIds]
  );
  const persistedTargetsByClaim = await loadClaimEvaluationTargets(query, taskContentId, claimIds);

  const metadataById = new Map(
    Array.isArray(claimMetadata)
      ? claimMetadata.map((claim) => [Number(claim.id), claim])
      : []
  );
  const rowById = new Map(rows.map((row) => [Number(row.claim_id), row]));

  const claims = claimIds
    .map((claimId) => rowById.get(Number(claimId)))
    .filter(Boolean)
    .map((row) => {
      const meta = metadataById.get(Number(row.claim_id)) || {};
      const evaluationTargets = Array.isArray(meta.targets) && meta.targets.length
        ? meta.targets
        : (persistedTargetsByClaim.get(Number(row.claim_id)) || []);
      const primarySubstantiveTarget = evaluationTargets.find((target) =>
        String(target.targetType || target.target_type).toLowerCase() === "substantive"
      );
      const mappedObjectClaim = String(
        meta.objectClaim || meta.object_claim_text || meta.objectText ||
        primarySubstantiveTarget?.targetText || primarySubstantiveTarget?.target_text || ""
      ).trim();
      const searchText = String(mappedObjectClaim || meta.searchText || meta.search_text || "").trim();
      const context = buildEvidenceClaimContext(searchText || row.claim_text);
      if (context.changed) {
        logger.log(
          `🎯 [Evidence] Atomic claim normalization for ${row.claim_id}: "${context.coreText}"`
        );
      }
      const claim = {
        id: row.claim_id,
        text: context.coreText,
        originalText: context.originalText,
        promptText: context.promptText,
        role: meta.role || null,
        centrality: clampScore(meta.centrality, 0),
        verifiability: clampScore(meta.verifiability, 0),
        priority: clampScore(meta.priority, 0),
        searchText,
        objectClaim: mappedObjectClaim,
        isAttribution: Boolean(meta.isAttribution || meta.is_attribution),
        speakerEntity: meta.speakerEntity || meta.speaker_entity || "",
        articleStance: meta.articleStance || meta.article_stance || "",
        argumentFunction: meta.argumentFunction || meta.argument_function || "",
        scoreTransform: meta.scoreTransform || meta.score_transform || "",
        argumentMappingRationale: meta.argumentMappingRationale || meta.argument_mapping_rationale || "",
        targetMappingUnresolved: Boolean(
          meta.targetMappingUnresolved ||
          String(meta.argumentMappingRationale || meta.argument_mapping_rationale || "").startsWith("target_mapping_unresolved:") ||
          evaluationTargets.some((target) => String(target.mappingRationale || target.mapping_rationale || "")
            .startsWith("target_mapping_unresolved:")),
        ),
        claimKind: meta.claimKind || meta.claim_kind || "",
        evidenceType: meta.evidenceType || meta.evidence_type || "",
        namedEntities: Array.isArray(meta.namedEntities) ? meta.namedEntities : [],
        dates: Array.isArray(meta.dates) ? meta.dates : [],
        studiesOrDocuments: Array.isArray(meta.studiesOrDocuments) ? meta.studiesOrDocuments : [],
        sourceCitedInArticle: meta.sourceCitedInArticle || "",
        isFallibilityCritical: Boolean(meta.isFallibilityCritical || meta.is_fallibility_critical),
        searchAssertions: Array.isArray(meta.searchAssertions) ? meta.searchAssertions : [],
        evaluationTargets,
        evaluationTargetId: primarySubstantiveTarget?.evaluationTargetId || primarySubstantiveTarget?.evaluation_target_id || null,
      };
      const targetRoutingEnabled = isEvidenceTargetRoutingEnabled();
      const multiTargetEnabled = process.env.ENABLE_MULTI_TARGET_EVIDENCE === "true";
      const hasPersistedTargets = Array.isArray(evaluationTargets) && evaluationTargets.some((t) => t.searchEligible !== false);
      if (targetRoutingEnabled || isBearingShadowEnabled() || bearingConfig.enableBearingGating) {
        // Phase 5: use typed evaluation targets for richer query lanes when available
        claim.evidenceNeed = (multiTargetEnabled && hasPersistedTargets)
          ? buildEvidenceNeedFromEvaluationTargets(claim, evaluationTargets)
          : buildEvidenceNeedV1(claim);
      }
      claim.retrievalContexts = buildRetrievalContextsForClaim(claim, {
        articleText: readableText,
      });
      claim.retrievalContext = claim.retrievalContexts.find(
        (retrievalContext) => retrievalContext.evaluationTargetType === "substantive",
      ) || claim.retrievalContexts[0] || null;
      const queryLimit = (multiTargetEnabled && hasPersistedTargets) ? 9 : 3;
      const assertionTargets = targetRoutingEnabled
        ? buildEvidenceTargetQueries(claim.evidenceNeed, queryLimit).filter((target) => target.matchedPart === "search_assertion")
        : [];
      const legacySearchTargets = buildSearchTargets(claim);
      claim.searchTargets = targetRoutingEnabled ? assertionTargets : legacySearchTargets;
      claim.fallbackSearchTargets = targetRoutingEnabled
        ? addEvidenceTargetProvenance(legacySearchTargets, claim.evidenceNeed)
        : [];
      return claim;
    }).sort((a, b) =>
      (b.priority - a.priority) ||
      (b.verifiability - a.verifiability) ||
      (b.centrality - a.centrality)
    );

  await discoverStudyIdentities({
    query,
    taskContentId,
    claims,
    search: searchGateway,
  });
  for (const claim of claims) {
    const multiTargetEnabled = process.env.ENABLE_MULTI_TARGET_EVIDENCE === "true";
    const hasPersistedTargets = Array.isArray(claim.evaluationTargets) &&
      claim.evaluationTargets.some((target) => target.searchEligible !== false);
    if (isEvidenceTargetRoutingEnabled() || isBearingShadowEnabled() || bearingConfig.enableBearingGating) {
      claim.evidenceNeed = (multiTargetEnabled && hasPersistedTargets)
        ? buildEvidenceNeedFromEvaluationTargets(claim, claim.evaluationTargets)
        : buildEvidenceNeedV1(claim);
    }
    claim.retrievalContexts = buildRetrievalContextsForClaim(claim, { articleText: readableText });
    claim.retrievalContext = claim.retrievalContexts.find(
      (retrievalContext) => retrievalContext.evaluationTargetType === "substantive",
    ) || claim.retrievalContexts[0] || null;
    const queryLimit = multiTargetEnabled && hasPersistedTargets ? 9 : 3;
    const assertionTargets = isEvidenceTargetRoutingEnabled()
      ? buildEvidenceTargetQueries(claim.evidenceNeed, queryLimit).filter((target) => target.matchedPart === "search_assertion")
      : [];
    const legacySearchTargets = buildSearchTargets(claim);
    claim.searchTargets = isEvidenceTargetRoutingEnabled() ? assertionTargets : legacySearchTargets;
    claim.fallbackSearchTargets = isEvidenceTargetRoutingEnabled()
      ? addEvidenceTargetProvenance(legacySearchTargets, claim.evidenceNeed)
      : [];
    for (const retrievalContext of claim.retrievalContexts) {
      logger.log(`[RETRIEVAL_CONTEXT] ${JSON.stringify({
        event: "retrieval_context_built",
        taskContentId,
        claimId: claim.id,
        ...retrievalContext,
        articlePassageContext: String(retrievalContext.articlePassageContext || "").slice(0, 1200),
      })}`);
    }
    logEvidenceQueryPlan(claim);
  }

  claimIds.splice(0, claimIds.length, ...claims.map((claim) => claim.id));

  // Map to store processed references (URL → metadata)
  const referenceCache = new Map();

  // Track failed candidates for UI fallback (manual dashboard scrape)
  const failedCandidates = [];

  async function persistAcademicApiReference(cand, claimIndex, fallbackReason = "Ordinary scrape unavailable") {
    const api = cand?.academicApiContent;
    const cleanText = String(api?.cleanText || "").trim().slice(0, 60000);
    if (!api?.apiBacked || cleanText.length < 100) return null;

    const title = api.title || cand.title || "Academic source";
    const authors = (api.authors || []).map((name) => ({ name })).filter((item) => item.name);
    const publisherName = usablePublisherName(api.publisher) || usablePublisherName(api.journal) || null;
    const publisher = publisherName ? { name: publisherName } : null;
    const publishingIdentity = buildAcademicPublishingIdentity(api, cand.url);
    const retrievalMode = api.retrievalMode === "full_text" ? "full_text" : "abstract_only";
    const referenceContentId = await createContentInternal(query, {
      content_name: title,
      url: cand.url,
      media_source: publisherName || "PubMed",
      topic: cand.protectedDocumentIdentity
        ? "AI Evidence (Study Identity)"
        : retrievalMode === "full_text" ? "AI Evidence" : "AI Evidence (Abstract Only)",
      subtopics: [],
      content_type: "reference",
      taskContentId,
      thumbnail: "",
      details: `${retrievalMode}: ${cleanText.slice(0, 450)}`,
    });
    await ensureContentRelation(query, taskContentId, referenceContentId);
    await query(`UPDATE content SET content_text = ? WHERE content_id = ?`, [cleanText, referenceContentId]);
    const identityResult = await processPublishingIdentity({
      query,
      contentId: referenceContentId,
      identity: publishingIdentity,
      authors,
    });
    logger.log(`[ACADEMIC_METADATA] Persisted authoritative metadata for reference ${referenceContentId}: ` +
      `authors=${authors.length}, publisher=${api.publisher || "none"}, venue=${api.journal || "none"}; ` +
      `skipped generic author/publisher extraction`);

    const citationCandidates = extractCitationDerivedCandidates({
      text: cleanText,
      sourceCandidate: cand,
    });
    const quality = Math.max(0, Math.min(1.2, Number(cand.score) || 0));
    referenceCache.set(cand.url, {
      referenceContentId,
      title,
      authors,
      publisher,
      publishingIdentity,
      publishingIdentityPersistence: identityResult.persistence,
      thumbnail: "",
      cleanText,
      snippet: cand.snippet || "",
      quality,
      citationCount: citationCandidates.length,
      citationCandidates,
      retrievalMode,
      apiBacked: true,
      ordinaryScrapeFailed: true,
      fallbackReason,
      protectedDocumentIdentity: Boolean(cand.protectedDocumentIdentity),
      identityBearingScore: cand.identityBearingScore || null,
      identityBearingType: cand.identityBearingType || null,
      identityBearingRationale: cand.identityBearingRationale || null,
      identityTargetId: cand.identityTargetId || null,
      url: cand.url,
      claimIndices: claimIndex !== -1 ? [claimIndex] : [],
    });
    if (retrievalMode === "abstract_only") {
      failedCandidates.push({
        url: cand.url,
        title,
        reason: `Abstract retrieved through PubMed API; full webpage unavailable (${fallbackReason})`,
        contentId: referenceContentId,
        scrapeStatus: "abstract_only",
      });
    }
    logger.log(`[ACADEMIC_API] ${JSON.stringify({
      event: "academic_api_reference_persisted",
      url: String(cand.url || "").slice(0, 500),
      referenceContentId,
      retrievalMode,
      textChars: cleanText.length,
      ordinaryScrapeFailure: String(fallbackReason || "").slice(0, 240),
    })}`);
    return {
      cleanText,
      citationCount: citationCandidates.length,
      citationCandidates,
      retrievalMode,
      apiBacked: true,
      isProcessed: true,
    };
  }

  // Initialize promptManager for database-driven prompts
  const promptManager = new PromptManager(query);

  // ═══════════════════════════════════════════════════════════════════
  // LOAD EVIDENCE SEARCH MODE FROM DATABASE
  // (Load BEFORE creating engine so we can pass config to constructor)
  // ═══════════════════════════════════════════════════════════════════
  let searchMode = 'fringe_on_support'; // Default
  let modeConfig = {};

  try {
    const configRows = await query(
      `SELECT config_value FROM evidence_search_config WHERE config_key = 'search_mode'`
    );
    if (configRows && configRows.length > 0) {
      searchMode = configRows[0].config_value;
    }

    const modeConfigRows = await query(
      `SELECT config_value FROM evidence_search_config WHERE config_key = 'mode_config'`
    );
    if (modeConfigRows && modeConfigRows.length > 0) {
      const allConfigs = JSON.parse(modeConfigRows[0].config_value);
      modeConfig = allConfigs[searchMode] || {};
    }

    logger.log(`🔧 [Evidence] Search mode: ${searchMode}`);
    logger.log(`🔧 [Evidence] Mode config:`, modeConfig);
  } catch (err) {
    logger.warn(`⚠️ [Evidence] Failed to load search config, using defaults:`, err.message);
  }

  const engine = new EvidenceEngine(
    {
      llm: openAiLLM,
      promptManager,
      search: {
        internal: searchGateway.internal,
        web: async (opts) => {
          const start = Date.now();
          const results = await searchGateway.web(opts);
          logger.log(`⏱️  [BENCHMARK] Search gateway took ${Date.now() - start}ms for query: "${opts.query}"`);
          return results;
        },
        // Fringe search for low-quality sources (DuckDuckGo - less filtered)
        fringe: async (opts) => {
          const start = Date.now();
          const results = await duckDuckGoSearch.web(opts);
          const duration = Date.now() - start;
          logger.log(
            `⏱️  [BENCHMARK] DuckDuckGo (fringe) took ${duration}ms for query: "${opts.query}"`
          );
          return results;
        },
      },
      fetcher: {
        async getText(cand, claim) {
          // Get claim index for tracking which claim requested this reference
          // (defined outside try/catch so it's available in catch block)
          const claimIndex = claims.findIndex((c) => c.id === claim.id);

          try {
            if (cand.text) return cand.text;
            if (!cand.url) return null;

            // Check cache first (avoid re-processing same URL)
            if (referenceCache.has(cand.url)) {
              logger.log(`♻️  [Evidence] Using cached reference: ${cand.url}`);
              const cached = referenceCache.get(cand.url);

              // Add this claim to the reference's claim list if not already there
              if (
                claimIndex !== -1 &&
                !cached.claimIndices.includes(claimIndex)
              ) {
                cached.claimIndices.push(claimIndex);
              }

              // Return object with cleanText + citationCount to avoid re-parsing
              return {
                cleanText: cached.cleanText,
                citationCount: cached.citationCount || 0,
                citationCandidates: cached.citationCandidates || [],
                retrievalMode: cached.retrievalMode || "full_text",
                apiBacked: Boolean(cached.apiBacked),
                isProcessed: true, // Flag that this is already processed
              };
            }

            // PMC XML is already the full article and is preferable to a
            // brittle HTML scrape. Abstract-only records still attempt the
            // ordinary URL below so accessible publisher full text can upgrade
            // them to `full_text`.
            if (cand.academicApiContent?.retrievalMode === "full_text") {
              return persistAcademicApiReference(cand, claimIndex, "PMC full text retrieved through NCBI API");
            }

            logger.log(`🌐 [Evidence] Fetching: ${cand.url}`);

            // ─────────────────────────────────────────────
            // 1. FETCH and DETECT content type
            // ─────────────────────────────────────────────
            let resp = null;
            let waybackFallback = null;
            try {
              const controller = new AbortController();
              const timeout = setTimeout(() => controller.abort(), 15000); // 15s timeout
              try {
                resp = await fetch(cand.url, { signal: controller.signal });
              } finally {
                clearTimeout(timeout);
              }
              if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            } catch (directFetchError) {
              if (!cand.protectedDocumentIdentity) throw directFetchError;
              logger.log(`[IDENTITY_WAYBACK_FALLBACK] ${JSON.stringify({
                event: "identity_wayback_attempt",
                claimId: claim.id,
                url: String(cand.url || "").slice(0, 500),
                identityRole: cand.identityRole || cand.identityBearingType || null,
                directFetchError: String(directFetchError.message || directFetchError).slice(0, 240),
              })}`);
              waybackFallback = await fetchWaybackSnapshot(cand.url, 60000);
              if (!waybackFallback?.text) throw directFetchError;
            }

            const contentType = waybackFallback ? 'text/html' : (resp.headers.get('content-type') || '');
            const isPdf = !waybackFallback && (contentType.includes('application/pdf') || cand.url.toLowerCase().match(/\.pdf($|\?)/));

            let html = null;
            let pdfExtractedText = null;
            let pdfTitle = null;
            let pdfAuthors = null;
            let pdfIdentity = null;

            if (isPdf) {
              logger.log(`📄 [Evidence] Detected PDF (Content-Type: ${contentType}), extracting text...`);
              try {
                const pdfParse = (await import('pdf-parse')).default;
                const pdfParseDirect = (await import('pdf-parse/lib/pdf-parse.js')).default;
                const buffer = await resp.arrayBuffer();
                const parsed = await extractPdfTextWithFallback(Buffer.from(buffer), {
                  primaryParser: pdfParse,
                  fallbackParser: pdfParseDirect,
                });

                let fullText = (parsed.text || "").replace(/\r/g, "");

                // Strip XMP metadata
                fullText = fullText.replace(/<\?xpacket[\s\S]*?<\?xpacket end.*?\?>/gi, '');
                fullText = fullText.replace(/<x:xmpmeta[\s\S]*?<\/x:xmpmeta>/gi, '');
                fullText = fullText.replace(/<rdf:RDF[\s\S]*?<\/rdf:RDF>/gi, '');
                fullText = fullText.replace(/\n{3,}/g, '\n\n').trim();

                pdfExtractedText = fullText;
                pdfTitle = parsed.info?.Title?.trim() || null;
                pdfAuthors = parsed.info?.Author?.trim() || null;
                pdfIdentity = cand.academicApiContent
                  ? buildAcademicPublishingIdentity(cand.academicApiContent, cand.url)
                  : (await processPublishingIdentity({
                      documentType: "pdf",
                      pdfInfo: parsed.info || {},
                      pdfMetadata: parsed.metadata || null,
                      pdfText: fullText,
                      sourceUrl: cand.url,
                    })).identity;

                logger.log(`📄 [Evidence] PDF extracted: ${pdfExtractedText.length} chars, ${parsed.numpages || 0} pages, method=${parsed.method || 'none'}`);
              } catch (pdfErr) {
                logger.warn(`⚠️  [Evidence] PDF extraction failed: ${pdfErr.message} - will create stub reference`);
                // Set empty text so it creates a stub reference that can be manually scraped
                pdfExtractedText = "";
              }
            } else {
              // ─────────────────────────────────────────────
              // HTML content - get text
              // ─────────────────────────────────────────────
              html = waybackFallback?.text || await resp.text();

              if (!html || html.length < 100) {
                logger.warn(`⚠️  [Evidence] Empty response from ${cand.url}`);
                return null;
              }

              logger.log(`✅ [Evidence] Fetched ${html.length} chars`);
              if (waybackFallback) {
                logger.log(`[IDENTITY_WAYBACK_FALLBACK] ${JSON.stringify({
                  event: "identity_wayback_success",
                  claimId: claim.id,
                  url: String(cand.url || "").slice(0, 500),
                  snapshotUrl: String(waybackFallback.snapshotUrl || "").slice(0, 700),
                  chars: html.length,
                })}`);
              }
            }

            // ─────────────────────────────────────────────
            // 2. EXTRACT METADATA based on content type
            // ─────────────────────────────────────────────
            let title, authors, publisher, publishingIdentity, thumbnail, cleanText, citationCount = 0;
            let retrievalMode = "full_text";
            let apiBacked = false;
            const academicApi = cand.academicApiContent;
            const hasAuthoritativeAcademicMetadata = Boolean(academicApi?.apiBacked && (
              academicApi.authors?.length || academicApi.journal || academicApi.publisher
            ));

            if (isPdf) {
              // PDF metadata extraction
              let pdfTitleBase = pdfTitle || cand.title;

              // If no title from metadata, extract from first line of text
              if (!pdfTitleBase && pdfExtractedText) {
                const lines = pdfExtractedText.split('\n').map(l => l.trim()).filter(Boolean);
                for (const line of lines) {
                  if (line.length > 10 && line.length < 200) {
                    pdfTitleBase = line;
                    break;
                  }
                }
              }

              // Add [PDF] prefix if not already present
              title = pdfTitleBase
                ? (pdfTitleBase.startsWith('[PDF]') ? pdfTitleBase : `[PDF] ${pdfTitleBase}`)
                : "[PDF] Document";

              publishingIdentity = hasAuthoritativeAcademicMetadata
                ? buildAcademicPublishingIdentity(academicApi, cand.url)
                : pdfIdentity;
              authors = hasAuthoritativeAcademicMetadata
                ? (academicApi.authors || []).map((name) => ({ name }))
                : publishingIdentity?.document?.authors?.length
                  ? publishingIdentity.document.authors
                  : pdfAuthors ? [{ name: pdfAuthors }] : [];
              publisher = publishingIdentity
                ? (await processPublishingIdentity({ identity: publishingIdentity })).legacyPublisher
                : null;
              thumbnail = ""; // PDFs don't have thumbnails from evidence engine
              cleanText = pdfExtractedText?.slice(0, 60000) || "";

              // Extract inline citations from PDF text
              if (cleanText.length >= 100) {
                try {
                  const inlineRefs = extractInlineRefs(cleanText);
                  citationCount = inlineRefs?.length || 0;
                  logger.log(
                    `📚 [Evidence] Extracted ${citationCount} inline citations from PDF: ${cand.url}`
                  );
                } catch (err) {
                  logger.warn(`⚠️ [Evidence] Citation extraction failed: ${err.message}`);
                }
              }
            } else {
              // ─────────────────────────────────────────────
              // 2. PARSE HTML (for metadata extraction)
              // ─────────────────────────────────────────────
              const $ = cheerio.load(html);

              // ─────────────────────────────────────────────
              // 3. EXTRACT METADATA (from full HTML)
              // ─────────────────────────────────────────────
              title = academicApi?.title || cand.title || (await getMainHeadline($)) || "AI Reference";
              if (hasAuthoritativeAcademicMetadata) {
                authors = (academicApi.authors || []).map((name) => ({ name }));
                publishingIdentity = buildAcademicPublishingIdentity(academicApi, cand.url);
                publisher = (await processPublishingIdentity({ identity: publishingIdentity })).legacyPublisher;
                logger.log(`[ACADEMIC_METADATA] Using API authors/publishing identity for ${cand.url}; skipped HTML metadata extraction`);
              } else {
                authors = await extractAuthors($);
                const identityResult = await processPublishingIdentity({ $, sourceUrl: cand.url });
                publishingIdentity = identityResult.identity;
                publisher = identityResult.legacyPublisher;
              }
              thumbnail = getBestImage($, cand.url) || "";

              // ─────────────────────────────────────────────
              // 4. EXTRACT CLEAN TEXT (using Readability)
              // ─────────────────────────────────────────────
              try {
                const dom = new JSDOM(html, { url: cand.url });
                const article = new Readability(dom.window.document).parse();

                if (article && article.textContent) {
                  cleanText = article.textContent
                    .replace(/\s+/g, " ")
                    .trim()
                    .slice(0, 60000);
                  logger.log(
                    `📖 [Evidence] Readability extracted ${cleanText.length} chars`
                  );
                } else {
                  logger.warn(
                    `⚠️  [Evidence] Readability failed, falling back to cheerio`
                  );
                  // Fallback to cheerio if Readability fails
                  $("script, style, link, noscript").remove();
                  cleanText = $.text()
                    .replace(/\s+/g, " ")
                    .trim()
                    .slice(0, 60000);
                }
              } catch (readabilityErr) {
                logger.warn(
                  `⚠️  [Evidence] Readability error: ${readabilityErr.message}`
                );
                $("script, style, link, noscript").remove();
                cleanText = $.text().replace(/\s+/g, " ").trim().slice(0, 60000);
              }

              // ─────────────────────────────────────────────
              // 4.5. EXTRACT CITATIONS (for quality scoring)
              // Must be done INSIDE this block where $ is in scope
              // ─────────────────────────────────────────────
              if (cleanText.length >= 100) {
                try {
                  const inlineRefs = extractInlineRefs(cleanText);
                  const domRefs = $('a[href]').length;
                  citationCount = (inlineRefs?.length || 0) + domRefs;
                  logger.log(
                    `📚 [Evidence] Extracted ${citationCount} citations (${inlineRefs?.length || 0} inline + ${domRefs} DOM) from ${cand.url}`
                  );
                } catch (err) {
                  logger.warn(`⚠️ [Evidence] Citation extraction failed: ${err.message}`);
                }
              }
            }

            const api = academicApi;
            if (api?.cleanText?.length >= 100) {
              const academicHost = /(?:pubmed|pmc|ncbi)\.nlm\.nih\.gov/i.test(cand.url || "");
              const likelyBlock = /access denied|captcha|are you a robot|enable javascript|checking your browser/i.test(cleanText || "");
              const ordinaryLooksLikeFullText = !academicHost && !likelyBlock &&
                cleanText.length >= Math.max(1500, api.cleanText.length + 1000);
              if (!ordinaryLooksLikeFullText) {
                cleanText = api.cleanText.slice(0, 60000);
                title = api.title || title;
                authors = (api.authors || []).map((name) => ({ name }));
                publisher = usablePublisherName(api.publisher)
                  ? { name: api.publisher }
                  : usablePublisherName(api.journal) ? { name: api.journal } : publisher;
                retrievalMode = api.retrievalMode === "full_text" ? "full_text" : "abstract_only";
                apiBacked = true;
                logger.log(`[ACADEMIC_API] Using ${retrievalMode} API text for ${cand.url} (${cleanText.length} chars)`);
              }
            }

            const citationCandidates = extractCitationDerivedCandidates({
              text: cleanText,
              html: html || "",
              sourceCandidate: cand,
            });

            if (cleanText.length < 100) {
              logger.warn(
                `⚠️  [Evidence] Insufficient text (${cleanText.length} chars): ${cand.url}`
              );

              // ─────────────────────────────────────────────
              // Create stub content row for failed reference
              // This allows us to create reference_claim_links
              // and the user can fill in the content via dashboard scrape
              // ─────────────────────────────────────────────
              const stubContentId = await createContentInternal(query, {
                content_name: title,
                url: cand.url,
                media_source: publisher?.name || "Unknown",
                topic: cand.protectedDocumentIdentity ? "AI Evidence (Study Identity)" : "AI Evidence (Failed)",
                subtopics: [],
                content_type: "reference",
                taskContentId,
                thumbnail,
                details: `Failed to scrape: ${cleanText.length} chars`,
              });

              logger.log(
                `⚠️  [Evidence] Created stub for failed reference: ${cand.url} → content_id=${stubContentId}`
              );

              // ─────────────────────────────────────────────
              // CRITICAL: Link reference to task via content_relations
              // ─────────────────────────────────────────────
              await ensureContentRelation(query, taskContentId, stubContentId);

              const persistedStubResult = await processPublishingIdentity({
                query,
                contentId: stubContentId,
                identity: publishingIdentity,
                fallbackPublisher: publisher,
                authors: hasAuthoritativeAcademicMetadata ? authors : null,
              });
              const persistedStubIdentity = persistedStubResult.persistence;
              const publisherLink = persistedStubIdentity?.primaryEntityId
                ? {
                    publisherId: persistedStubIdentity.primaryEntityId,
                    publisherName: persistedStubIdentity.primaryEntityId === persistedStubIdentity.publicationVenueId
                      ? publishingIdentity?.entities?.publication_venue?.name
                      : publishingIdentity?.entities?.publishing_organization?.name || publisher?.name,
                    sourceType: publishingIdentity?.context?.context_type || "unknown",
                    resolutionLevel: 5,
                    cachedCrest: await getCachedPublisherCrest(query, persistedStubIdentity.primaryEntityId),
                  }
                : await ensureReferencePublisherLink({
                    query,
                    referenceContentId: stubContentId,
                    url: cand.url,
                    publisher,
                    title,
                    author: authors?.[0]?.name || authors?.[0] || null,
                  });
              if (!hasAuthoritativeAcademicMetadata) {
                enrichReferencePublisherAsync({
                  query,
                  referenceContentId: stubContentId,
                  url: cand.url,
                  publisherLink,
                });
              }

              // Calculate quality for this candidate
              const base = cand.score ?? 0;
              const boost = cand.domain?.match(
                /(reuters|apnews|nature|nih|who|gov|\.edu)/i
              )
                ? 0.2
                : 0;
              const quality = Math.max(0, Math.min(1.2, base + boost));

              // Cache the stub so it can be linked to claims
              // Include search snippet as evidence since full scrape failed
              referenceCache.set(cand.url, {
                referenceContentId: stubContentId,
                title,
                authors,
                publisher,
                thumbnail,
                cleanText: "", // Empty - needs manual scrape
                snippet: cand.snippet || "", // Save search engine snippet
                quality, // Store quality
                citationCandidates,
                isFailed: true, // Mark as needing manual scrape
                protectedDocumentIdentity: Boolean(cand.protectedDocumentIdentity),
                identityBearingScore: cand.identityBearingScore || null,
                identityBearingType: cand.identityBearingType || null,
                identityBearingRationale: cand.identityBearingRationale || null,
                identityTargetId: cand.identityTargetId || null,
                url: cand.url,
                claimIndices: claimIndex !== -1 ? [claimIndex] : [], // Track which claim requested this
              });

              // Track for UI to display as "needs manual scrape"
              failedCandidates.push({
                url: cand.url,
                title: title || "Unknown",
                reason: `Insufficient text (${cleanText.length} chars)`,
                contentId: stubContentId,
              });

              return citationCandidates.length ? {
                cleanText: "",
                citationCount: 0,
                citationCandidates,
                isProcessed: true,
              } : null;
            }

            // ─────────────────────────────────────────────
            // 5. CREATE REFERENCE CONTENT ROW
            // ─────────────────────────────────────────────
            const referenceContentId = await createContentInternal(query, {
              content_name: title,
              url: cand.url,
              media_source: publisher?.name || "Unknown",
              topic: cand.protectedDocumentIdentity ? "AI Evidence (Study Identity)" : "AI Evidence",
              subtopics: [],
              content_type: "reference",
              taskContentId,
              thumbnail,
              details: cleanText.slice(0, 500),
            });

            logger.log(
              `✅ [Evidence] Created reference content_id=${referenceContentId}`
            );

            // ─────────────────────────────────────────────
            // CRITICAL: Link reference to task via content_relations
            // ─────────────────────────────────────────────
            await ensureContentRelation(query, taskContentId, referenceContentId);

            // ─────────────────────────────────────────────
            // 5.5. SAVE FULL CLEANED TEXT (for quality analysis)
            // ─────────────────────────────────────────────
            try {
              await query(
                `UPDATE content SET content_text = ? WHERE content_id = ?`,
                [cleanText, referenceContentId]
              );
              logger.log(
                `📝 [Evidence] Saved content_text (${cleanText.length} chars) for content_id=${referenceContentId}`
              );
            } catch (err) {
              logger.warn(
                `⚠️ [Evidence] Failed to save content_text for content_id=${referenceContentId}: ${err.message}`
              );
            }

            // ─────────────────────────────────────────────
            // 6. PERSIST AUTHORS & PUBLISHERS
            // ─────────────────────────────────────────────
            if (!hasAuthoritativeAcademicMetadata) {
              await persistAuthors(query, referenceContentId, authors);
            }
            const persistedResult = await processPublishingIdentity({
              query,
              contentId: referenceContentId,
              identity: publishingIdentity,
              fallbackPublisher: publisher?.name && publisher.name !== "Unknown Publisher" ? publisher : null,
              authors: hasAuthoritativeAcademicMetadata ? authors : null,
            });
            const persistedIdentity = persistedResult.persistence;

            const primaryName = persistedIdentity?.primaryEntityId === persistedIdentity?.publicationVenueId
              ? publishingIdentity?.entities?.publication_venue?.name
              : publishingIdentity?.entities?.publishing_organization?.name;
            const publisherLink = persistedIdentity?.primaryEntityId
              ? {
                  publisherId: persistedIdentity.primaryEntityId,
                  publisherName: primaryName || publisher?.name,
                  sourceType: publishingIdentity?.context?.context_type || "unknown",
                  resolutionLevel: 5,
                  cachedCrest: await getCachedPublisherCrest(query, persistedIdentity.primaryEntityId),
                }
              : await ensureReferencePublisherLink({
                  query,
                  referenceContentId,
                  url: cand.url,
                  publisher,
                  title,
                  author: authors?.[0]?.name || authors?.[0] || null,
                });
            if (!hasAuthoritativeAcademicMetadata) {
              enrichReferencePublisherAsync({
                query,
                referenceContentId,
                url: cand.url,
                publisherLink,
              });
            } else {
              logger.log(`[ACADEMIC_METADATA] Authoritative authors/publisher/venue persisted for ${referenceContentId}; skipped generic metadata enrichment`);
            }

            // Detect source lineage (excerpt/repost/pointer/archive) — fire-and-forget
            resolveSourceLineage(cand.url, { query }).catch(() => {});

            // ─────────────────────────────────────────────
            // 6.5. QUALITY SCORES WILL BE SAVED FROM EVIDENCE ITEMS
            // (already extracted in extractEvidence via combined LLM call)
            // We'll save them after evidence extraction when we have the scores
            // ─────────────────────────────────────────────

            // ─────────────────────────────────────────────
            // 7. CACHE REFERENCE METADATA (including search snippet)
            // ─────────────────────────────────────────────
            // Calculate quality for this candidate (simple 0-1.2 scale for ranking)
            const base = cand.score ?? 0;
            const boost = cand.domain?.match(
              /(reuters|apnews|nature|nih|who|gov|\.edu)/i
            )
              ? 0.2
              : 0;
            const quality = Math.max(0, Math.min(1.2, base + boost));

            referenceCache.set(cand.url, {
              referenceContentId,
              title,
              authors,
              publisher,
              cleanText,
              snippet: cand.snippet || "", // Store search snippet for fallback
              quality, // Store quality for later use
              citationCount, // Store citation count for quality scoring
              citationCandidates,
              retrievalMode,
              apiBacked,
              protectedDocumentIdentity: Boolean(cand.protectedDocumentIdentity),
              identityBearingScore: cand.identityBearingScore || null,
              identityBearingType: cand.identityBearingType || null,
              identityBearingRationale: cand.identityBearingRationale || null,
              identityTargetId: cand.identityTargetId || null,
              url: cand.url,
              claimIndices: claimIndex !== -1 ? [claimIndex] : [], // Track which claim requested this
            });

            logger.log(
              `🎯 [Evidence] Fully processed reference: ${cand.url} → content_id=${referenceContentId}`
            );

            // Return object with cleanText + citationCount to avoid re-parsing in evidenceEngine
            return {
              cleanText,
              citationCount,
              citationCandidates,
              retrievalMode,
              apiBacked,
              isProcessed: true, // Flag that this is already processed
            };
          } catch (err) {
            logger.warn(
              `⚠️  [Evidence] Fetch failed for ${cand.url}: ${err.message}`
            );

            const apiFallback = await persistAcademicApiReference(cand, claimIndex, err.message);
            if (apiFallback) return apiFallback;

            // ─────────────────────────────────────────────
            // Create stub content row for failed reference
            // ─────────────────────────────────────────────
            const stubContentId = await createContentInternal(query, {
              content_name: cand.title || "Failed Reference",
              url: cand.url,
              media_source: "Unknown",
              topic: cand.protectedDocumentIdentity ? "AI Evidence (Study Identity)" : "AI Evidence (Failed)",
              subtopics: [],
              content_type: "reference",
              taskContentId,
              thumbnail: "",
              details: `Failed to fetch: ${err.message}`,
            });

            logger.log(
              `⚠️  [Evidence] Created stub for failed reference: ${cand.url} → content_id=${stubContentId}`
            );

            // ─────────────────────────────────────────────
            // CRITICAL: Link reference to task via content_relations
            // ─────────────────────────────────────────────
            await ensureContentRelation(query, taskContentId, stubContentId);

            const publisherLink = await ensureReferencePublisherLink({
              query,
              referenceContentId: stubContentId,
              url: cand.url,
              publisher: null,
              title: cand.title || "Failed Reference",
              author: null,
            });
            enrichReferencePublisherAsync({
              query,
              referenceContentId: stubContentId,
              url: cand.url,
              publisherLink,
            });

            // Calculate quality for this candidate
            const base = cand.score ?? 0;
            const boost = cand.domain?.match(
              /(reuters|apnews|nature|nih|who|gov|\.edu)/i
            )
              ? 0.2
              : 0;
            const quality = Math.max(0, Math.min(1.2, base + boost));

            // Cache the stub so it can be linked to claims
            // Include search snippet as evidence since full scrape failed
            referenceCache.set(cand.url, {
              referenceContentId: stubContentId,
              title: cand.title || "Failed Reference",
              authors: [],
              publisher: null,
              thumbnail: "",
              cleanText: "", // Empty - needs manual scrape
              snippet: cand.snippet || "", // Save search engine snippet
              quality, // Store quality
              isFailed: true,
              protectedDocumentIdentity: Boolean(cand.protectedDocumentIdentity),
              identityBearingScore: cand.identityBearingScore || null,
              identityBearingType: cand.identityBearingType || null,
              identityBearingRationale: cand.identityBearingRationale || null,
              identityTargetId: cand.identityTargetId || null,
              url: cand.url,
              claimIndices: claimIndex !== -1 ? [claimIndex] : [], // Track which claim requested this
            });

            // Track for UI fallback
            failedCandidates.push({
              url: cand.url,
              title: cand.title || "Unknown",
              reason: err.message || "Fetch failed",
              contentId: stubContentId,
            });

            return null;
          }
        },
      },
    },
    {
      // Constructor config is now empty - all settings come from database via runOptions
      maxParallelClaims: Infinity, // Process all claims in parallel
    }
  );

  const repairAudit = createEvidenceRepairAudit({
    taskContentId,
    claims,
  });

  // R8: persist each completed source/target result immediately. The final
  // route-level pass remains an idempotent reconciliation pass, but a later
  // timeout can no longer discard links that were already found.
  const processedSourceUrls = new Set();
  const bearingAssertionKeys = new Set();
  const persistedClaimLinkIds = new Set();
  const incrementalAssertions = new Map();
  let reconciledClaimLinkCount = 0;
  const reportProgress = (details) => {
    if (typeof onProgress === "function") onProgress(details);
  };
  const onSourceProcessed = async ({ claim, candidate, evidence = [], ...details }) => {
    const sourceUrl = candidate?.url || evidence[0]?.url || null;
    if (sourceUrl) processedSourceUrls.add(sourceUrl);
    const refData = sourceUrl ? referenceCache.get(sourceUrl) : null;
    const assertions = [];

    if (refData?.referenceContentId) {
      for (const item of evidence) {
        const traceId = repairAudit.recordEvidenceHandoff(item, {
          status: "preserved_for_incremental_persistence",
          reason: "R8_source_target_completed",
          referenceContentId: refData.referenceContentId,
        });
        const assertion = buildPreservedEvidenceAssertion(
          item,
          {
            claim,
            adjudication: {
              unresolvedTargetIds: (claim?.evaluationTargets || [])
                .map((target) => Number(target.evaluationTargetId))
                .filter(Boolean),
            },
          },
          refData,
          traceId,
        );
        const key = [
          assertion.referenceContentId,
          assertion.taskClaimId,
          assertion.evaluationTargetId,
          assertionFingerprint(assertion),
        ].join(":");
        if (!incrementalAssertions.has(key)) {
          incrementalAssertions.set(key, assertion);
          bearingAssertionKeys.add(key);
          assertions.push(assertion);
        }
      }
    }

    if (assertions.length) {
      const persisted = await persistDirectEvidenceAssertions({
        query,
        taskContentId,
        aiReferences: [{
          referenceContentId: refData.referenceContentId,
          url: sourceUrl,
          evidenceAssertions: assertions,
        }],
        repairAudit,
      });
      for (const outcome of persisted.outcomes || []) {
        if (outcome.status === "persisted" && outcome.claimLinkId) {
          persistedClaimLinkIds.add(Number(outcome.claimLinkId));
        }
      }
      try {
        const rows = await query(
          `SELECT COUNT(*) AS count
             FROM reference_claim_task_links
            WHERE task_claim_id IN (?)`,
          [claimIds],
        );
        reconciledClaimLinkCount = Number(rows?.[0]?.count) || 0;
      } catch (error) {
        reconciledClaimLinkCount = persistedClaimLinkIds.size;
        logger.warn(`[R8_PROGRESS] Could not reconcile durable claim-link count: ${error.message}`);
      }
    }

    reportProgress({
      counts: {
        sourcesProcessed: processedSourceUrls.size,
        bearingAssertionsFound: bearingAssertionKeys.size,
        claimLevelLinksPersisted: reconciledClaimLinkCount,
      },
      activeClaimId: Number(claim?.id) || null,
      activeSourceUrl: String(sourceUrl || "").slice(0, 500) || null,
      ...details,
    });
  };

  // engine.run(claims, contexts, opt)
  // contexts can be null/undefined if not needed
  const runOptions = {
    ...((isBearingShadowEnabled() || bearingConfig.enableBearingGating || bearingConfig.enableBearingPacket) ? { taskContentId } : {}),
    enableBearingGating: bearingConfig.enableBearingGating,
    enableBearingPacket: bearingConfig.enableBearingPacket,
    enableBearingPacketLive: bearingConfig.enableBearingPacketLive,
    bearingConfig,
    maxSnippetCandidatesPerClaim: bearingConfig.maxSnippetCandidatesPerClaim,
    maxSourcesToScrapePerTarget: searchGatewayConfig.maxSourcesToScrapePerTarget,
    enableInternal: true,
    enableWeb: true,
    searchEngine: "hybrid",
    preferDomains: [],
    avoidDomains: [],
    maxCharsPerDoc: 8000,
    enableRedTeam: false,

    // Apply mode-specific config (or fallback to defaults)
    queriesPerClaim: bearingConfig.enableBearingGating ? 9 : Math.min(modeConfig.queriesPerClaim || 6, 3),
    topKQueries: bearingConfig.enableBearingGating ? 9 : Math.min(modeConfig.queriesPerClaim || 6, 3),
    topKCandidates: bearingConfig.enableBearingGating ? 12 : Math.min(modeConfig.topKCandidates || modeConfig.queriesPerClaim || 6, 9),
    maxEvidencePerDoc: 2,
    maxEvidenceCandidates: Math.min(modeConfig.maxEvidenceCandidates || 4, 9),
    maxSearchTargetsPerClaim: bearingConfig.enableBearingGating ? 9 : 3,
    maxSourcesComparedPerClaim: bearingConfig.enableBearingGating ? 20 : 9,
    topKPerIntent: bearingConfig.enableBearingGating ? 8 : 4,
    maxRetriesPerClaim: 1,

    // Mode-specific settings
    enableFringeSearch: modeConfig.enableFringeSearch || false,
    topKFringeQueries: modeConfig.topKFringeQueries || 3,
    topKFringeCandidates: modeConfig.topKFringeCandidates || 3,
    maxFringeEvidenceCandidates: modeConfig.maxFringeEvidenceCandidates || 2,

    enableBalancedSearch: modeConfig.enableBalancedSearch || false,
    supportQueries: modeConfig.supportQueries || 3,
    refuteQueries: modeConfig.refuteQueries || 3,
    nuanceQueries: modeConfig.nuanceQueries || 3,
    targetSupport: modeConfig.targetSupport || 3,
    targetRefute: modeConfig.targetRefute || 3,
    targetNuance: modeConfig.targetNuance || 3,
    excludeUrl: taskUrl, // Exclude task URL from being used as its own reference
    repairAudit,
    onProgress: reportProgress,
    onSourceProcessed,
  };

  const results = await engine.run(claims, buildEvidenceQueryContexts(claims), runOptions);
  for (const result of results) repairAudit.recordEngineResult(result);

  // Build confidence map: claimIndex → confidence
  const claimConfidenceMap = new Map();
  for (let claimIndex = 0; claimIndex < results.length; claimIndex++) {
    const adjudication = results[claimIndex].adjudication;
    if (adjudication && typeof adjudication.confidence === "number") {
      claimConfidenceMap.set(claimIndex, adjudication.confidence);
    }
  }

  // Transform results into persistAIResults format
  // Group evidence by URL to avoid duplicates
  const evidenceByUrl = new Map();
  const fringeSourcesFound = []; // Track fringe sources for credibility mapping

  for (let claimIndex = 0; claimIndex < results.length; claimIndex++) {
    const claimResult = results[claimIndex];
    const evidenceItems = claimResult.evidence || [];
    const fringeItems = claimResult.fringeEvidence || [];

    for (const ev of evidenceItems) {
      if (!ev.url) {
        repairAudit.recordEvidenceHandoff(ev, {
          status: "rejected",
          reason: "missing_source_url",
        });
        continue;
      }

      // Get reference metadata from cache
      const refData = referenceCache.get(ev.url);
      if (!refData) {
        repairAudit.recordEvidenceHandoff(ev, {
          status: "rejected",
          reason: "missing_reference_cache",
        });
        logger.warn(`⚠️  [Evidence] No cached data for ${ev.url}, skipping`);
        continue;
      }
      const incrementalKey = [
        Number(refData.referenceContentId),
        Number(ev?.claimId || claimResult?.claim?.id),
        Number(ev?.evidenceTargetId),
        assertionFingerprint(ev),
      ].join(":");
      const incrementallyPersisted = incrementalAssertions.get(incrementalKey);
      const traceId = incrementallyPersisted?.traceId || repairAudit.recordEvidenceHandoff(ev, {
        status: "preserved_for_direct_persistence",
        reason: "R1_evidence_assertion_preserved_on_ai_reference",
        referenceContentId: refData.referenceContentId,
      });
      // Rebuild with the final adjudication so targetUnresolved is accurate,
      // while retaining the one handoff trace created during incremental commit.
      const evidenceAssertion = buildPreservedEvidenceAssertion(ev, claimResult, refData, traceId);

      // ─────────────────────────────────────────────
      // Save quality scores to database (from combined LLM call)
      // ─────────────────────────────────────────────
      if (ev.qualityScores && refData.referenceContentId) {
        try {
          const qs = ev.qualityScores;
          await query(
            `INSERT INTO source_quality_scores (
              content_id, author_transparency, publisher_transparency,
              evidence_density, claim_specificity, correction_behavior,
              domain_reputation, sensationalism_score, monetization_pressure,
              original_reporting, quality_score, risk_score, quality_tier,
              scored_by, scoring_model
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ai', 'gpt-4o-mini')
            ON DUPLICATE KEY UPDATE
              author_transparency = VALUES(author_transparency),
              publisher_transparency = VALUES(publisher_transparency),
              evidence_density = VALUES(evidence_density),
              claim_specificity = VALUES(claim_specificity),
              correction_behavior = VALUES(correction_behavior),
              domain_reputation = VALUES(domain_reputation),
              sensationalism_score = VALUES(sensationalism_score),
              monetization_pressure = VALUES(monetization_pressure),
              original_reporting = VALUES(original_reporting),
              quality_score = VALUES(quality_score),
              risk_score = VALUES(risk_score),
              quality_tier = VALUES(quality_tier),
              scored_at = CURRENT_TIMESTAMP`,
            [
              refData.referenceContentId,
              qs.author_transparency || 5,
              qs.publisher_transparency || 5,
              qs.evidence_density || 5,
              qs.claim_specificity || 5,
              qs.correction_behavior || 5,
              qs.domain_reputation || 5,
              qs.sensationalism_score || 5,
              qs.monetization_pressure || 5,
              qs.original_reporting || 5,
              qs.quality_score || 5,
              qs.risk_score || 5,
              qs.quality_tier || 'mid',
            ]
          );

          logger.log(
            `📊 [Evidence] Saved quality scores: ${qs.quality_tier} (${qs.quality_score}/10) for content_id=${refData.referenceContentId}`
          );
        } catch (err) {
          logger.warn(
            `⚠️ [Evidence] Failed to save quality scores for content_id=${refData.referenceContentId}: ${err.message}`
          );
        }
      }

      const existing = evidenceByUrl.get(ev.url);
      if (existing) {
        appendPreservedEvidenceAssertion(existing, evidenceAssertion);
        // Add this claim to existing reference
        if (!existing.claims.includes(claimIndex)) {
          existing.claims.push(claimIndex);
        }
        // Keep higher quality stance/summary
        if ((ev.quality || 0) > (existing.quality || 0)) {
          existing.stance = ev.stance;
          existing.why = ev.summary || ev.quote;
          existing.quality = ev.quality;
        }
      } else {
        // New reference
        evidenceByUrl.set(ev.url, {
          referenceContentId: refData.referenceContentId, // ← From cache
          url: ev.url,
          title: refData.title, // ← From cache
          stance: ev.stance,
          why: ev.summary || ev.quote,
          quote: ev.quote,
          claims: [claimIndex],
          quality: ev.quality,
          cleanText: refData.cleanText, // ← From cache (for claim extraction)
          scrapeStatus: refData.retrievalMode === "abstract_only" ? "abstract_only" : "full",
          evidenceAssertions: [evidenceAssertion],
        });
      }
    }
  }

  // ─────────────────────────────────────────────
  // Keep failed scrape stubs only when the search snippet still gives us
  // claim provenance. Those become dotted document-level links with a retry
  // affordance. Everything else is unlinked to avoid orphan source cards.
  // ─────────────────────────────────────────────
  for (const [url, refData] of referenceCache.entries()) {
    if (!evidenceByUrl.has(url)) {
      const hasClaimProvenance =
        Array.isArray(refData.claimIndices) && refData.claimIndices.length > 0;
      const snippet = String(refData.snippet || "").trim();

      const identityLink = buildIdentityDocumentLink({
        candidate: { ...refData, url },
        refData,
      });
      if (identityLink && hasClaimProvenance) {
        evidenceByUrl.set(url, identityLink);
        logger.log(`[IDENTITY_BEARING] ${JSON.stringify({
          event: "identity_document_link_preserved",
          taskContentId,
          url: String(url).slice(0, 500),
          referenceContentId: refData.referenceContentId,
          claimIndices: refData.claimIndices,
          identityBearingScore: identityLink.identityBearingScore,
          identityBearingType: identityLink.identityBearingType,
          identityTargetId: identityLink.identityTargetId,
          scrapeStatus: identityLink.scrapeStatus,
        })}`);
        continue;
      }

      if (refData.apiBacked && hasClaimProvenance && refData.cleanText) {
        const status = refData.retrievalMode === "full_text" ? "full_text" : "abstract_only";
        evidenceByUrl.set(url, {
          referenceContentId: refData.referenceContentId,
          url,
          title: refData.title,
          stance: "insufficient",
          why: status === "abstract_only"
            ? "PubMed abstract retrieved through the NCBI API. No explicit claim-level assertion passed bearing; full text can be retried."
            : "PMC full text retrieved through the NCBI API, but no explicit claim-level assertion passed bearing.",
          quote: String(refData.cleanText).slice(0, 1200),
          claims: [...refData.claimIndices],
          quality: refData.quality || 0.35,
          cleanText: refData.cleanText,
          scrapeStatus: status === "abstract_only" ? "abstract_only" : "full",
          documentOnly: true,
        });
        logger.log(`🧷 [Evidence] Keeping API-backed ${status} document link: ${url}`);
        continue;
      }

      if (refData.isFailed && hasClaimProvenance && snippet) {
        evidenceByUrl.set(url, {
          referenceContentId: refData.referenceContentId,
          url,
          title: refData.title,
          stance: "insufficient",
          why:
            "Search result snippet matched this claim, but the source scrape failed. Rescrape the source to verify the document-level match.",
          quote: snippet,
          claims: [...refData.claimIndices],
          quality: refData.quality || 0.25,
          cleanText: "",
          scrapeStatus: "snippet_only",
          documentOnly: true,
        });
        logger.log(
          `🧷 [Evidence] Keeping failed source as snippet-only document link: ${url}`
        );
        continue;
      }

      if (refData.referenceContentId) {
        try {
          await query(
            `DELETE FROM content_relations
             WHERE content_id = ? AND reference_content_id = ? AND is_system = 1`,
            [taskContentId, refData.referenceContentId]
          );
        } catch (err) {
          logger.warn(
            `⚠️  [Evidence] Failed to unlink orphan source ${refData.referenceContentId}: ${err.message}`
          );
        }
      }

      logger.log(`⏭️  [Evidence] Skipping unlinked source with no extracted evidence: ${url}`);
    }
  }

  // Convert to array
  const aiReferences = Array.from(evidenceByUrl.values());
  const evidencePackets = bearingConfig.enableBearingPacket
    ? results
        .filter((result) => result?.evidencePacket)
        .map((result) => result.evidencePacket)
    : [];
  const claimProgress = results.map((result) => {
    const evidenceCount = Array.isArray(result?.evidence) ? result.evidence.length : 0;
    return {
      claimId: Number(result?.claim?.id) || null,
      bearingAssertionsFound: evidenceCount,
      unresolvedTargetIds: Array.isArray(result?.adjudication?.unresolvedTargetIds)
        ? result.adjudication.unresolvedTargetIds.map(Number).filter(Boolean)
        : [],
      unresolvedReason: evidenceCount === 0
        ? String(
            result?.bearingGatingSkipReason ||
            result?.adjudication?.rationale ||
            "Document candidates were found, but no qualifying target-bearing assertion was extracted."
          ).slice(0, 500)
        : null,
    };
  });

  logger.log(
    `🟣 [runEvidenceEngine] Returning ${aiReferences.length} AI references (fully processed)`
  );

  if (failedCandidates.length > 0) {
    logger.log(
      `⚠️  [runEvidenceEngine] ${failedCandidates.length} failed candidates available for manual scrape`
    );

    // Log first 5 failed scrapes with details for debugging
    logger.log(
      `\n📋 [FAILED SCRAPES] Sample of failed references for debugging:\n`
    );
    failedCandidates.slice(0, 5).forEach((failed, idx) => {
      logger.log(
        `  ${idx + 1}. URL: ${failed.url}\n` +
          `     Title: ${failed.title}\n` +
          `     Reason: ${failed.reason}\n` +
          `     Content ID: ${failed.contentId}\n`
      );
    });
  }

  try {
    recordEvidenceComparisonRun({
      contentId: taskContentId,
      startedAtMs: evidenceRunStartedAtMs,
      completedAtMs: Date.now(),
      results,
      aiReferences,
      bearingConfig,
      flags: {
        enableBearingShadow: isBearingShadowEnabled(),
        enableSnippetBearingLlm: isSnippetBearingLlmEnabled(),
        enableBearingGating: bearingConfig.enableBearingGating,
        enableBearingPacket: bearingConfig.enableBearingPacket,
        enableBearingPacketLive: bearingConfig.enableBearingPacketLive,
      },
    });
  } catch (error) {
    logger.warn(`[EvidenceComparison] Could not retain developer comparison snapshot: ${error.message}`);
  }

  return {
    aiReferences,
    failedCandidates, // For UI to display as "scrape manually" options
    claimConfidenceMap, // Map of claimIndex → confidence for persistAIResults
    repairAudit,
    claimProgress,
    ...(bearingConfig.enableBearingPacket ? { evidencePackets } : {}),
  };
}
