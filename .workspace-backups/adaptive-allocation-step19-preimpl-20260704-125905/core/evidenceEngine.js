// backend/src/core/evidenceEngine.js

import logger from "../utils/logger.js";
import {
  assessSnippetBearingBatch,
  isBearingShadowEnabled,
  isSnippetBearingLlmEnabled,
  logBearingShadowEvent,
  logSnippetBearingCalibration,
  scoreCandidatesInBearingShadow,
} from "./snippetBearing.js";
import {
  allocateCandidatesAcrossClaims,
  logBearingGatingAudit,
  reserveAdditionalCandidates,
  selectCandidatesForClaim,
  selectClaimsForBearingGating,
} from "./evidenceCandidateSelector.js";
import { canonicalizeUrl } from "../utils/canonicalizeUrl.js";
import { buildEvidencePacket } from "./evidencePacketBuilder.js";
import {
  queryPreservesNumericScope,
  validateEvidenceTargetQuery,
} from "./evidenceNeed.js";
import { retrievalContextForTarget } from "./retrievalContext.js";
import { buildAnchoredQueryPack } from "./anchoredQueryPack.js";
import { expandCandidateTargetAssignments } from "./evidenceTargetProvenance.js";
import { resolvedWorkCandidatesForClaim, isRejectableEvidenceUrl } from "./citationExpansion.js";
import { enrichAcademicCandidates } from "./academicContentResolver.js";
import { applyIdentityBearing } from "./identityBearing.js";
import {
  DEFAULT_PURPOSE_LANE,
  NEUTRAL_INTENT,
  NEUTRAL_STANCE_GOAL,
  normalizePurposeLane,
  providerProfileForLane,
  providersForProfile,
} from "./evidencePurposeLanes.js";
import {
  DROP_REASONS,
  DROP_STAGES,
  boundCandidateUnion,
  deriveVerifiedDocumentRole,
  logCandidateDrop,
  mergeCanonicalOccurrence,
  orderForLlmBearing,
  resolveSurvivalBounds,
} from "./candidateSurvival.js";

function qualifiesForBearingQuota(item, minBearing) {
  if (!item || item.stance === "insufficient") return false;
  if (item.bearingScore !== undefined && Number(item.bearingScore) < minBearing) return false;
  const retrievalMode = String(item.retrievalMode || "full_text");
  if (retrievalMode === "snippet_only" || retrievalMode === "metadata_only") return false;
  if (retrievalMode !== "abstract_only") return true;

  // Abstract-only evidence may count only when the extractor found an actual,
  // direct assertion in the API abstract. Topic overlap or attribution alone
  // must not terminate substantive full-text retrieval.
  const component = String(item.claimComponentAddressed || "").toLowerCase();
  return String(item.bearingType || "").toLowerCase() === "direct" &&
    String(item.quote || "").trim().length >= 25 &&
    !["", "none", "subject", "attribution", "context"].includes(component);
}

function dedupe(arr, keyFn) {
  const s = new Set();
  const out = [];
  for (const x of arr) {
    const k = keyFn(x);
    if (!s.has(k)) {
      s.add(k);
      out.push(x);
    }
  }
  return out;
}

export class EvidenceEngine {
  constructor(
    deps,
    cfg = {
      preferDomains: [],
      avoidDomains: [],
      limits: {
        queriesPerClaim: 6,
        candidates: 12,
        evidencePerDoc: 2,
        concurrency: 4,
      },
    }
  ) {
    this.deps = deps;
    this.cfg = cfg;
  }

  async generateQueries(claim, ctx, n = 6, searchMode = null) {
    const label = `[EV][queries][${claim.id}]`;
    logger.time(label);

    const queryLimit = Math.max(1, Number(n) || 1);
    const mapDirectTargets = (targets) => dedupe(
      (Array.isArray(targets) ? targets : []).map((target) => {
        const purposeLane = normalizePurposeLane(target.purposeLane, DEFAULT_PURPOSE_LANE);
        return {
          claimId: claim.id,
          query: target.query,
          // Purpose lanes describe the evidentiary job, not a desired stance.
          purposeLane,
          providerProfile: target.providerProfile || providerProfileForLane(purposeLane),
          reasonForQuery: target.reasonForQuery || null,
          // Legacy stance fields retained for backward compatibility only; set to
          // neutral so nothing downstream can treat them as a stance quota.
          intent: NEUTRAL_INTENT,
          stanceGoal: NEUTRAL_STANCE_GOAL,
          matchedPart: target.matchedPart || "object_claim",
          evidenceLaneId: target.evidenceLaneId || null,
          evidenceTargetId: target.evidenceTargetId || null,
          evidenceTargetType: target.evidenceTargetType || "other",
          bearingRequirement: target.bearingRequirement || "direct_truth_value",
        };
      }).filter((query) => String(query.query || "").trim()),
      (query) => String(query.query || "").trim().toLowerCase(),
    );
    const directQueries = mapDirectTargets(claim.searchTargets).slice(0, queryLimit);
    const fallbackQueries = mapDirectTargets(claim.fallbackSearchTargets);
    const targetAware = Boolean(claim.evidenceNeed);

    if ((!targetAware && directQueries.length > 0) || directQueries.length >= queryLimit) {
      logger.log(`🎯 [EV][queries][${claim.id}] Direct targets filled query path:`, directQueries);
      logger.timeEnd(label);
      return directQueries;
    }

    const generatedQueryLimit = queryLimit - directQueries.length;
    const directTargetIds = new Set(directQueries.map((query) => String(query.evidenceLaneId || query.evidenceTargetId || "")).filter(Boolean));
    const allEvidenceTargets = Array.isArray(claim.evidenceNeed?.evidenceTargets)
      ? claim.evidenceNeed.evidenceTargets
      : [];
    const missingEvidenceTargets = allEvidenceTargets.filter((target) => !directTargetIds.has(String(target.id || "")));
    const evidenceNeedForGeneration = targetAware && directQueries.length
      ? {
          ...claim.evidenceNeed,
          evidenceTargets: missingEvidenceTargets.length ? missingEvidenceTargets : allEvidenceTargets,
        }
      : claim.evidenceNeed;

    // Purpose-lane query generation. We no longer request support/refute/nuance
    // stance quotas: those labels never controlled retrieval (the provider only
    // ever receives the query string) and stance is classified after retrieval
    // from returned content vs. the target (see snippetBearing.js). Instead we
    // ask for queries that each pursue a distinct evidentiary *purpose*.
    logger.log(`🎯 [EV][queries][${claim.id}] Purpose-lane query generation`);

    const fallbackSystem =
      "You generate compact search queries for one atomic fact-checking claim. Return strict JSON only. " +
      "Generate search queries that retrieve documents bearing on the target. Do NOT try to force support, " +
      "refutation, or nuance — stance will be classified later from retrieved content. Each query should pursue " +
      "a distinct evidentiary purpose (a purposeLane). Preserve named entities, dates, predicates, scope, and " +
      "causal strength; every query must contain enough claim anchors to be intelligible by itself. Do not output " +
      "generic topic queries except when purposeLane is causal_background.";

    const fallbackUser =
      `Claim: {{claimText}}\nContext: {{context}}\nEvidence need: {{evidenceNeed}}\n\n` +
      `Generate up to {{n}} search queries that retrieve documents bearing on the listed evidence targets. ` +
      `Do not try to force support, refutation, or nuance; stance is classified later from retrieved content. ` +
      `Each query must pursue a distinct evidentiary purpose. Assign each query a purposeLane from: ` +
      `attribution_record, study_identity, original_document, alleged_conduct, official_response, ` +
      `independent_methodology, independent_reanalysis, causal_background, inference_limitations, ` +
      `legal_or_policy_context, source_context. Prefer covering several DIFFERENT purpose lanes over repeating one. ` +
      `Every result must include queryText, purposeLane, evidenceTargetId (the supplied lane id), evidenceTargetType, ` +
      `and reasonForQuery. Preserve exact numbers, populations, dates, doses, and timeframes in at least one query ` +
      `when present. Use purpose-appropriate retrieval language such as registry, cohort, dataset, transcript, ` +
      `original study, systematic review, reanalysis, methodology, or limitations only when it fits the purpose. ` +
      `Do not broaden the claim, do not restate the claim verbatim, and do not write instruction-like queries ` +
      `("Review whether...", "Investigate...").`;

    let system = fallbackSystem;
    let user = fallbackUser;

    // Try to load from database if promptManager is available
    if (this.deps.promptManager) {
      try {
        // Purpose-lane prompt names. These are intentionally NEW names so the
        // stale support/refute/nuance stance-quota prompts are never fetched;
        // until a purpose-lane prompt is stored in the DB the code fallback is
        // authoritative.
        const systemPrompt = await this.deps.promptManager.getPrompt(
          'evidence_purpose_query_generation_system',
          { system: fallbackSystem, user: '', parameters: {} }
        );

        const userPromptName = 'evidence_purpose_query_generation_user';
        logger.log(`🎯 [EV][queries][${claim.id}] Loading prompt: ${userPromptName}`);

        const userPrompt = await this.deps.promptManager.getPrompt(
          userPromptName,
          { system: '', user: fallbackUser, parameters: { n: generatedQueryLimit } }
        );

        system = systemPrompt.system;
        user = userPrompt.user
          .replace(/\{\{claimText\}\}/g, claim.promptText || claim.text)
          .replace(/\{\{context\}\}/g, JSON.stringify(ctx ?? {}))
          .replace(/\{\{evidenceNeed\}\}/g, JSON.stringify(evidenceNeedForGeneration || {}))
          .replace(/\{\{n\}\}/g, generatedQueryLimit);
      } catch (err) {
        logger.warn(`⚠️ [EvidenceEngine] Error loading DB prompts, using fallback:`, err.message);
        // Use fallback - replace template variables
        user = fallbackUser
          .replace(/\{\{claimText\}\}/g, claim.promptText || claim.text)
          .replace(/\{\{context\}\}/g, JSON.stringify(ctx ?? {}))
          .replace(/\{\{evidenceNeed\}\}/g, JSON.stringify(evidenceNeedForGeneration || {}))
          .replace(/\{\{n\}\}/g, generatedQueryLimit);
      }
    } else {
      // No promptManager, use fallback with template replacement
      user = fallbackUser
        .replace(/\{\{claimText\}\}/g, claim.promptText || claim.text)
        .replace(/\{\{context\}\}/g, JSON.stringify(ctx ?? {}))
        .replace(/\{\{evidenceNeed\}\}/g, JSON.stringify(evidenceNeedForGeneration || {}))
        .replace(/\{\{n\}\}/g, generatedQueryLimit);
    }

    // Purpose-lane schema. No stance fields are requested from the model.
    const schema = '{"queries":[{"queryText":"...","purposeLane":"attribution_record|study_identity|original_document|alleged_conduct|official_response|independent_methodology|independent_reanalysis|causal_background|inference_limitations|legal_or_policy_context|source_context","evidenceTargetId":"...","evidenceTargetType":"primary_source|original_study|systematic_review|dataset|official_statement|other","reasonForQuery":"..."}]}';

    let out;
    try {
      out = await this.deps.llm.generate({
        system,
        user,
        schemaHint: schema,
        temperature: 0.2,
      });
    } catch (error) {
      logger.warn(`⚠️ [EV][queries][${claim.id}] Purpose-lane query generation failed; using safe fallback: ${error.message}`);
      // Continue through the deterministic completion path, which fills distinct
      // purpose lanes (never stance quotas).
      out = { queries: [] };
    }

    const queriesArray = out && Array.isArray(out.queries) ? out.queries : [];

    const targetById = new Map(
      allEvidenceTargets.map((target) => [String(target.id), target]),
    );
    const defaultTarget = missingEvidenceTargets[0] || allEvidenceTargets[0] || {};
    const rejectedGeneratedQueries = [];
    const generatedQueries = queriesArray.slice(0, generatedQueryLimit).map((q) => {
      const target = targetById.get(String(q.evidenceTargetId || "")) || defaultTarget;
      const persistedTargetId = target.evaluationTargetId || target.evaluation_target_id || null;
      const purposeLane = normalizePurposeLane(q.purposeLane, DEFAULT_PURPOSE_LANE);
      return {
        claimId: claim.id,
        // Accept queryText (new) or query (legacy) from the model.
        query: q.queryText || q.query,
        purposeLane,
        providerProfile: q.providerProfile || providerProfileForLane(purposeLane),
        reasonForQuery: q.reasonForQuery || null,
        // Legacy stance fields kept neutral for backward compatibility only.
        intent: NEUTRAL_INTENT,
        stanceGoal: NEUTRAL_STANCE_GOAL,
        ...(persistedTargetId ? { evidenceLaneId: target.id || q.evidenceTargetId || null } : {}),
        evidenceTargetId: persistedTargetId || target.id || q.evidenceTargetId || null,
        evidenceTargetType: q.evidenceTargetType || target.evidenceTargetType || "other",
        bearingRequirement: q.bearingRequirement || target.bearingRequirement || "direct_truth_value",
      };
    }).filter((query) => {
      if (!String(query.query || "").trim()) return false;
      const validation = validateEvidenceTargetQuery(claim.evidenceNeed, query.query, query.purposeLane);
      if (validation.valid) return true;
      rejectedGeneratedQueries.push({ query: query.query, purposeLane: query.purposeLane, reasons: validation.reasons });
      return false;
    });

    if (rejectedGeneratedQueries.length) {
      logger.warn(`[EV_QUERY_AUDIT] ${JSON.stringify({
        event: "target_query_rejected",
        claimId: claim.id,
        rejected: rejectedGeneratedQueries,
      })}`);
    }

    const combined = dedupe(
      [...directQueries, ...(generatedQueries.length ? generatedQueries : fallbackQueries)],
      (query) => String(query.query || "").trim().toLowerCase(),
    );
    let queries = combined.length ? combined : fallbackQueries;
    if (targetAware && searchMode?.enableBearingGating) {
      const anchoredPack = buildAnchoredQueryPack({ claim, existingQueries: queries, limit: queryLimit });
      queries = anchoredPack.queries;
      logger.log(`[ANCHORED_QUERY_PACK] ${JSON.stringify({
        event: "anchored_evidence_queries",
        claimId: claim.id,
        accepted: queries.map((query) => ({
          query: String(query.query || "").slice(0, 500),
          purposeLane: query.purposeLane || null,
          providerProfile: query.providerProfile || null,
          reasonForQuery: query.reasonForQuery || null,
          evaluationTargetId: query.evidenceTargetId,
          evaluationTargetType: query.evidenceTargetType,
        })),
        rejected: anchoredPack.rejected.slice(0, 12),
      })}`);
    } else {
      queries = queries.slice(0, queryLimit);
    }
    const requiresNumericCoverage = (claim.evidenceNeed?.scopeTerms || []).some((term) => /\d/.test(String(term)));
    if (requiresNumericCoverage && !queries.some((query) => queryPreservesNumericScope(claim.evidenceNeed, query.query))) {
      const numericFallback = fallbackQueries.find((query) => queryPreservesNumericScope(claim.evidenceNeed, query.query));
      if (numericFallback) {
        queries = dedupe(
          [numericFallback, ...queries],
          (query) => String(query.query || "").trim().toLowerCase(),
        ).slice(0, queryLimit);
      }
    }

    logger.timeEnd(label);
    logger.log(`[EV_TARGET_QUERIES] ${JSON.stringify({
      event: "evidence_target_queries",
      claimId: claim.id,
      claimText: String(claim.text || "").slice(0, 500),
      queries: queries.map((query) => ({
        query: String(query.query || "").slice(0, 300),
        purposeLane: query.purposeLane || null,
        providerProfile: query.providerProfile || null,
        reasonForQuery: query.reasonForQuery || null,
        evidenceTargetId: query.evidenceTargetId,
        evidenceLaneId: query.evidenceLaneId,
        evidenceTargetType: query.evidenceTargetType,
        bearingRequirement: query.bearingRequirement,
        preservesNumericScope: queryPreservesNumericScope(claim.evidenceNeed, query.query),
      })),
    })}`);
    return queries;
  }

  /**
   * Generate fringe-seeking queries to find low-quality refutations
   * Used in two-pass search to map source credibility
   */
  generateFringeQueries(claim, claimType = null, n = 3) {
    logger.log(`🔍 [EV][fringe-queries][${claim.id}] Generating fringe queries for claim type: ${claimType || 'unknown'}`);

    const baseQueries = [
      { query: `${claim.text} hoax`, intent: 'refute-fringe' },
      { query: `${claim.text} false flag`, intent: 'refute-fringe' },
      { query: `${claim.text} conspiracy theory`, intent: 'refute-fringe' },
    ];

    // Claim-type specific fringe sites and keywords
    const typeSpecificQueries = {
      antisemitism: [
        { query: `site:gab.com ${claim.text}`, intent: 'refute-fringe' },
        { query: `site:bitchute.com ${claim.text}`, intent: 'refute-fringe' },
        { query: `"antisemitism myth" ${claim.text}`, intent: 'refute-fringe' },
      ],
      vaccines: [
        { query: `site:naturalnews.com ${claim.text}`, intent: 'refute-fringe' },
        { query: `site:childrenshealthdefense.org ${claim.text}`, intent: 'refute-fringe' },
        { query: `"vaccine dangers coverup" ${claim.text}`, intent: 'refute-fringe' },
      ],
      climate: [
        { query: `site:wattsupwiththat.com ${claim.text}`, intent: 'refute-fringe' },
        { query: `"climate hoax" ${claim.text}`, intent: 'refute-fringe' },
      ],
      covid: [
        { query: `site:naturalnews.com ${claim.text}`, intent: 'refute-fringe' },
        { query: `"covid hoax" ${claim.text}`, intent: 'refute-fringe' },
        { query: `"plandemic" ${claim.text}`, intent: 'refute-fringe' },
      ],
      pesticides: [
        { query: `site:naturalnews.com ${claim.text}`, intent: 'refute-fringe' },
        { query: `"pesticide safety" ${claim.text}`, intent: 'refute-fringe' },
      ],
    };

    const specific = typeSpecificQueries[claimType] || [];
    const allQueries = [...baseQueries, ...specific];

    const fringeQueries = allQueries.slice(0, n).map(q => ({
      claimId: claim.id,
      query: q.query,
      intent: q.intent,
      stanceGoal: "steelman",
      evidenceTargetId: "bounded-steelman",
      evidenceTargetType: "other",
      bearingRequirement: "direct_truth_value",
    }));

    logger.log(`🔍 [DEBUG] Fringe queries for ${claim.id}:`, fringeQueries);

    return dedupe(
      fringeQueries,
      (q) => `${q.intent}|${String(q.query || "").toLowerCase()}`
    );
  }

  /**
   * Detect claim type from text (simple keyword matching)
   */
  detectClaimType(claimText) {
    const text = claimText.toLowerCase();

    if (text.match(/antisemit|jewish|jew|israel|zion/)) return 'antisemitism';
    if (text.match(/vaccine|vax|immuniz/)) return 'vaccines';
    if (text.match(/climate|global warming|carbon|emissions/)) return 'climate';
    if (text.match(/election|vote|ballot|fraud/)) return 'election';
    if (text.match(/covid|coronavirus|pandemic/)) return 'covid';
    if (text.match(/pesticide|herbicide|glyphosate/)) return 'pesticides';

    return null;
  }

  async retrieveCandidates(claim, queries, opt) {
    const topK = opt.topKCandidates ?? 12;
    const limitQueries = queries.slice(0, opt.topKQueries ?? queries.length);

    // Optional throttle (default: unlimited concurrency)
    const maxParallel = opt.maxParallelSearches ?? Infinity;

    const label = `[EV][retrieve][${claim.id}]`;
    logger.time(label);

    // Convert list of queries → list of async tasks
    // Tag each result with the intent of the query that produced it
    const bearingShadowEnabled = isBearingShadowEnabled() || opt.enableBearingGating;
    const tasks = limitQueries.map((q) => async () => {
      const sub = [];

      // Run internal + web in parallel for this query
      await Promise.all(
        [
          opt.enableInternal
            ? (async () => {
                const internal = await this.deps.search.internal({
                  query: q.query,
                  topK,
                  retrievalContext: retrievalContextForTarget(claim, q.evidenceTargetId),
                });
                if (internal?.length) sub.push(...internal);
              })()
            : null,

          opt.enableWeb
            ? (async () => {
                // Provider routing is purpose-based: a query's purposeLane maps
                // to a provider profile (web / academic / official). We pass the
                // resolved providers additively so e.g. study_identity and
                // causal_background reach academic APIs.
                const purposeProviders = providersForProfile(
                  q.providerProfile || q.purposeLane,
                  this.deps.search.providerEnabled || {},
                );
                const web = await this.deps.search.web({
                  query: q.query,
                  topK,
                  prefer: opt.preferDomains,
                  avoid: opt.avoidDomains,
                  ...(purposeProviders.length ? { providers: purposeProviders } : {}),
                  retrievalContext: retrievalContextForTarget(claim, q.evidenceTargetId),
                });
                if (web?.length) sub.push(...web);
              })()
            : null,
        ].filter(Boolean)
      );

      // Tag every result with the query's purpose lane (never a stance). Stance
      // is classified downstream from the returned content vs. the target.
      const retrievalPurpose = q.purposeLane || DEFAULT_PURPOSE_LANE;
      return sub.map(r => ({
        ...r,
        retrievalPurpose,
        purposeLane: retrievalPurpose,
        providerProfile: q.providerProfile || null,
        // Legacy tags kept neutral for backward compatibility; not used for
        // candidate selection or stance.
        searchIntent: NEUTRAL_INTENT,
        matchedPart: q.matchedPart || 'context',
        query: q.query,
        stanceGoal: NEUTRAL_STANCE_GOAL,
        evidenceTargetType: q.evidenceTargetType || null,
        evidenceTargetId: q.evidenceTargetId || null,
        evidenceLaneId: q.evidenceLaneId || null,
        bearingRequirement: q.bearingRequirement || null,
        retrievalContext: retrievalContextForTarget(claim, q.evidenceTargetId),
      }));
    });

    //
    // Execute tasks with optional concurrency limit
    //
    const chunks = [];

    if (maxParallel === Infinity) {
      // No throttle → fastest path
      const results = await Promise.all(tasks.map((t) => t()));
      for (const r of results) chunks.push(...r);
    } else {
      // Throttled runner
      let i = 0;
      const workers = new Array(maxParallel).fill(0).map(async () => {
        while (i < tasks.length) {
          const t = tasks[i++];
          const r = await t();
          if (r?.length) chunks.push(...r);
        }
      });
      await Promise.all(workers);
    }

    logger.timeEnd(label);

    // Deduplicate by URL. When the same URL appears from multiple queries we do
    // NOT simply keep the highest provider-score copy: we keep the RICHEST record
    // (verified identity > API abstract > longest bearing text > source type >
    // provider score) and union all provenance. If one provider returned a weak
    // snippet but another returned an abstract, the canonical record adopts the
    // richer bearing text. (§2 candidate-survival repair.)
    const best = new Map();
    for (const c of chunks) {
      if (!c) continue;
      const id = c.id || c.url || `${c.source}:${c.title}`;
      const occurrence = {
        query: c.query || null,
        provider: c.provider || c.source || null,
        providerScore: Number.isFinite(Number(c.score)) ? Number(c.score) : null,
        purposeLane: c.purposeLane || c.retrievalPurpose || null,
        searchIntent: c.searchIntent || null,
        stanceGoal: c.stanceGoal || null,
        evidenceTargetId: c.evidenceTargetId || null,
        evidenceLaneId: c.evidenceLaneId || null,
        evidenceTargetType: c.evidenceTargetType || null,
        bearingRequirement: c.bearingRequirement || null,
        snippet: c.snippet || null,
        bearingTextSource: c.bearingTextSource || null,
      };
      const prev = best.get(id);
      if (!prev) {
        best.set(id, { ...c, targetProvenance: [occurrence], retrievalProvenance: [occurrence] });
      } else {
        best.set(id, mergeCanonicalOccurrence(prev, { ...c, targetProvenance: [occurrence], retrievalProvenance: [occurrence] }));
      }
    }

    // Enrich PMID/PMC/DOI candidates before the bearing scorer sees them.
    // This preserves ordering while replacing search snippets with API-backed
    // title/abstract/MeSH/publication metadata where available.
    const enrichedAcademic = await enrichAcademicCandidates([...best.values()]);
    best.clear();
    for (const candidate of enrichedAcademic) {
      best.set(candidate.id || candidate.url || `${candidate.source}:${candidate.title}`, candidate);
    }

    // Preserve a bounded UNION of plausible candidates. We no longer trim by
    // provider score before bearing: candidates are cut only by coarse count
    // safety valves (per purpose lane, per claim), verified documents bypass
    // those caps, and every drop is logged for the survival audit. Bearing (not
    // provider score) decides final survival downstream. (§3/§4.)
    const survivalBounds = resolveSurvivalBounds(opt);
    const { kept, dropped } = boundCandidateUnion({
      candidates: [...best.values()],
      bounds: survivalBounds,
    });
    for (const { candidate, reason } of dropped) {
      logCandidateDrop({ claim, taskContentId: opt.taskContentId || null, stage: DROP_STAGES.PRE_BEARING_POOL, candidate, reason });
    }
    let finalCandidates = kept;
    const laneCoverage = finalCandidates.reduce((acc, c) => {
      const lane = c.purposeLane || c.retrievalPurpose || DEFAULT_PURPOSE_LANE;
      acc[lane] = (acc[lane] || 0) + 1;
      return acc;
    }, {});
    logger.log(`🎯 [EV][pool-union][${claim.id}] kept ${finalCandidates.length}, dropped ${dropped.length}, lanes ${JSON.stringify(laneCoverage)}`);

    // Filter out excluded URL (e.g., task URL to prevent self-referencing)
    if (opt.excludeUrl) {
      const beforeCount = finalCandidates.length;
      finalCandidates = finalCandidates.filter(c => c.url !== opt.excludeUrl);
      if (beforeCount > finalCandidates.length) {
        logger.log(
          `🚫 [Evidence] Filtered out task URL from candidates: ${opt.excludeUrl}`
        );
      }
    }

    // Phase 1 shadow instrumentation only. This is deliberately a pure map:
    // no filtering, sorting, canonical dedupe, caps, or selection changes.
    if (bearingShadowEnabled && claim.evidenceNeed) {
      finalCandidates = scoreCandidatesInBearingShadow(
        claim.evidenceNeed,
        finalCandidates,
        { minBearingToScrape: opt.minBearingToScrape },
      );
    }

    logger.log(
      `🟩 [DEBUG] Candidates for ${claim.id}: ${finalCandidates.length} total (purpose-lane-bucketed), scores: ${finalCandidates.map(c => `${c.purposeLane || c.retrievalPurpose || 'unknown'}:${c.score?.toFixed(2) || 'null'}`).join(', ')}`
    );

    return finalCandidates;
  }

  async extractEvidence(claim, cand, opt) {
    const url = cand.url || cand.id || "unknown";
    const shortUrl = url.length > 80 ? url.slice(0, 77) + "..." : url;
    const targetLabel = cand.evidenceTargetId ? `[target:${cand.evidenceTargetId}]` : "";

    const fetchLabel = `[EV][fetch][${claim.id}]${targetLabel}[${shortUrl}]`;
    logger.time(fetchLabel);

    const fetchResult = await this.deps.fetcher.getText(cand, claim);
    logger.timeEnd(fetchLabel);

    if (!fetchResult) {
      logger.log(`🟥 [DEBUG] No text for ${claim.id} from ${shortUrl}`);
      return [];
    }

    // Handle both old format (string) and new format (object with cleanText + citationCount)
    let cleanText, citationCount, html;
    const retrievalMode = typeof fetchResult === "object"
      ? (fetchResult.retrievalMode || "full_text")
      : "full_text";

    if (typeof fetchResult === 'object' && fetchResult.isProcessed) {
      // New format: already processed by runEvidenceEngine
      cleanText = fetchResult.cleanText;
      citationCount = fetchResult.citationCount || 0;
      html = cleanText; // Store for raw_text field
      if (typeof opt.citationSink === "function" && fetchResult.citationCandidates?.length) {
        opt.citationSink(fetchResult.citationCandidates);
      }
      if (!cleanText || !String(cleanText).trim()) return [];
      logger.log(
        `♻️  [Evidence] Using pre-processed text (${citationCount} citations) from ${shortUrl}`
      );
    } else {
      // Old format: raw HTML/text that needs parsing
      html = typeof fetchResult === 'string' ? fetchResult : fetchResult.cleanText || '';
      cleanText = html;
      citationCount = 0;

      try {
        const cheerio = await import("cheerio");
        const $ = cheerio.load(html);

        // Extract citation count before removing elements
        const domRefs = $('a[href]').length;

        $("script, style, link, noscript").remove();
        cleanText = $.text().replace(/\s+/g, " ").trim();

        // Extract inline citations from text
        const { extractInlineRefs } = await import("../utils/extractInlineRefs.js");
        const inlineRefs = extractInlineRefs(cleanText);
        citationCount = (inlineRefs?.length || 0) + domRefs;

        logger.log(
          `📚 [Evidence] Extracted ${citationCount} citations (${inlineRefs?.length || 0} inline + ${domRefs} DOM) from ${shortUrl}`
        );
      } catch (err) {
        // If HTML parsing fails, use original text as-is
        logger.warn(`⚠️ Failed to parse HTML for ${shortUrl}, using raw text`);
      }
    }

    const maxChars = opt.maxCharsPerDoc ?? 8000;
    const maxEvidencePerDoc = opt.maxEvidencePerDoc ?? 2;

    // Use COMBINED quote extraction + quality scoring (saves 1 LLM call per source)
    // Tests may inject the same contract; production continues using the shared utility.
    const extractQuotesAndScoreQuality = this.deps.extractQuotesAndScoreQuality ||
      (await import("../utils/extractQuote.js")).extractQuotesAndScoreQuality;

    const llmLabel = `[EV][llm-evidence+quality][${claim.id}]${targetLabel}[${shortUrl}]`;
    logger.time(llmLabel);

    // Phase 7: pass the specific evaluation target so bearing is scored against
    // the target predicate, not just the visible claim text.
    const evaluationTarget = cand.evidenceTargetId
      ? (claim.evaluationTargets || []).find(
          (t) => String(t.evaluationTargetId) === String(cand.evidenceTargetId),
        ) ?? null
      : null;

    const result = await extractQuotesAndScoreQuality({
      claimText: claim.text,
      evaluationTarget,
      fullText: cleanText,
      sourceTitle: cand.title || cand.url,
      url: cand.url || "",
      domain: cand.domain || "",
      metadata: {
        author: "unknown", // Will be extracted later in runEvidenceEngine
        publisher: "unknown",
        citationCount, // Use actual extracted citations for evidence_density
      },
      maxChars,
      maxQuotes: maxEvidencePerDoc,
    });

    const items = result.quotes || [];
    const qualityScores = result.qualityScores;

    logger.timeEnd(llmLabel);

    logger.log(
      `📘 [DEBUG] LLM raw evidence for ${claim.id}/${shortUrl}:`,
      items
    );

    logger.log(
      `📙 [DEBUG] Parsed ${items.length} evidence items + quality=${qualityScores?.quality_tier || 'unknown'} for ${claim.id}/${shortUrl}`
    );

    const quality = (c) => {
      const base = c.score ?? 0; // Score is already 0-1 range from search engines
      const boost = c.domain?.match(
        /(reuters|apnews|nature|nih|who|gov|\.edu)/i
      )
        ? 0.2
        : 0;
      const q = Math.max(0, Math.min(1.2, base + boost)); // Max 1.2 (1.0 + 0.2 boost)
      logger.log(`🔢 [DEBUG] Quality calc for ${c.url?.slice(0, 50)}: score=${c.score}, base=${base.toFixed(4)}, boost=${boost}, quality=${q.toFixed(4)}`);
      return q;
    };

    let i = 0;
    const arr = [];

    for (const it of items) {
      if (!it || !it.quote) continue;
      arr.push({
        id: `${claim.id}:${cand.id}:${i++}`,
        claimId: claim.id,
        candidateId: cand.id,
        url: cand.url,
        title: cand.title,
        publishedAt: cand.publishedAt,
        quote: String(it.quote).trim(),
        summary: (it.summary || "").trim(),
        stance: it.stance || "insufficient",
        searchIntent: cand.searchIntent || 'background',
        matchedPart: cand.matchedPart || 'context',
        quality: quality(cand),
        location: it.location || undefined,
        raw_text: html,
        qualityScores,
        ...(it.bearing_score !== undefined ? {
          bearingScore: it.bearing_score,
          bearingType: it.bearing_type,
          bearingReason: it.bearing_reason,
          claimComponentAddressed: it.claim_component_addressed,
          causalStrength: it.causal_strength,
          bearingMethod: "post_scrape_llm_v1",
        } : {}),
        bearingPreScore: cand.bearingPreScore ?? cand.combinedBearingPreScore ?? null,
        triageDecision: cand.triageDecision || cand.deterministicBearingDecision || null,
        evidenceTargetId: cand.evidenceTargetId || null,
        evidenceTargetType: cand.evidenceTargetType || (evaluationTarget?.targetType) || null,
        bearingRequirement: cand.bearingRequirement || null,
        evaluationTargetText: evaluationTarget?.targetText || null,
        retrievalMode,
        apiBacked: Boolean(fetchResult?.apiBacked),
      });
    }

    logger.log(
      `🟪 [DEBUG] Final evidence array for ${claim.id}/${shortUrl}:`,
      arr
    );

    return arr;
  }

  buildPacketSidecar(claim, evidence, opt = {}) {
    if (!opt.enableBearingPacket) return null;
    const packet = buildEvidencePacket({
      claim,
      evidence,
      minBearing: opt.bearingConfig?.minBearingForPacket ?? 0.35,
      maxItems: opt.bearingConfig?.maxEvidencePacketItems ?? 5,
      maxQuotesPerDocument: opt.maxEvidencePerDoc ?? 2,
    });
    logger.log(`[BEARING_PACKET] ${JSON.stringify({
      event: opt.enableBearingPacketLive ? "bearing_packet_live" : "bearing_packet_shadow",
      taskContentId: opt.taskContentId || null,
      legacyAdjudicationUnaffected: !opt.enableBearingPacketLive,
      ...packet,
    })}`);
    return packet;
  }

  packetEvidenceForAdjudication(packet) {
    return (packet?.items || []).map((item) => ({
      id: item.evidenceId,
      candidateId: item.candidateId,
      url: item.url,
      title: item.title,
      quote: item.quote,
      stance: item.stance || "insufficient",
      // Final bearing is eligibility plus weight; source quality remains a
      // separate multiplier rather than an authority shortcut.
      quality: Math.max(0, Number(item.qualityScore ?? 0.5)) *
        Math.max(0, Math.min(1, Number(item.finalBearing ?? 0))),
      packetRole: item.packetRole,
    }));
  }

  adjudicate(claim, evidence) {
    logger.log(
      `🟫 [DEBUG] Adjudicating ${claim.id} with evidence count:`,
      evidence.length
    );

    const now = Date.now();

    const w = (e) => {
      const rec = e.publishedAt
        ? Math.max(
            0.5,
            1 -
              (now - Date.parse(e.publishedAt)) /
                (1000 * 60 * 60 * 24 * 365 * 5)
          )
        : 0.8;
      return (e.quality ?? 0) * rec;
    };

    const buckets = { support: 0, refute: 0, nuance: 0, insufficient: 0 };

    for (const e of evidence) {
      const stance = e.stance || "insufficient";
      if (!buckets.hasOwnProperty(stance)) continue;
      buckets[stance] += w(e);
    }

    const ranked = Object.entries(buckets).sort((a, b) => b[1] - a[1]);
    const top = ranked[0];
    const finalVerdict = top[1] === 0 ? "insufficient" : top[0];

    const total = Object.values(buckets).reduce((a, b) => a + b, 0) || 0.0001;
    const dominance = ranked[0][1] / total;
    const confidence = Math.max(
      0.15,
      Math.min(0.98, 0.4 * dominance + 0.6 * Math.min(1, total))
    );

    const sortedEv = [...evidence].sort((a, b) => w(b) - w(a));
    const picks = sortedEv.filter((e) => e.stance === finalVerdict).slice(0, 4);
    const counters = sortedEv
      .filter((e) => e.stance !== finalVerdict && e.stance !== "insufficient")
      .slice(0, 3);

    const cite = (e) => `${e.title || e.url || e.candidateId}`;

    const rationale = [
      picks
        .slice(0, 2)
        .map((e) => `“${e.quote}” — ${cite(e)}`)
        .join("; "),
      counters
        .slice(0, 1)
        .map((e) => `Counterpoint: “${e.quote}” — ${cite(e)}`)
        .join("; "),
    ]
      .filter(Boolean)
      .join(". ");

    logger.log(
      `🟧 [DEBUG] Verdict for ${claim.id}:`,
      finalVerdict,
      "confidence",
      confidence
    );

    return {
      claimId: claim.id,
      finalVerdict,
      confidence,
      rationale,
      evidenceIds: picks.map((e) => e.id),
      counters: counters.map((e) => e.id),
    };
  }
  /**
   * redTeam(claim, adjudication, evidence)
   * --------------------------------------
   * Second-pass adversarial check.
   * Challenges the initial verdict and may revise it.
   */
  async redTeam(claim, adjudication, evidence) {
    logger.log(`🟥 [REDTEAM] Starting red-team for claim ${claim.id}`);

    const system = `
      You are a second-pass adversarial reviewer.
      Your goal is to critically challenge the initial verdict on a claim.
      If there is strong contradictory evidence or uncertainty, adjust the verdict.
      Output ONLY a JSON object following the schema.
    `;

    const user = `
CLAIM:
${claim.text}

INITIAL VERDICT:
${JSON.stringify(adjudication, null, 2)}

EVIDENCE ITEMS:
${JSON.stringify(evidence.slice(0, 12), null, 2)}

TASK:
1. Challenge the logic of the verdict.
2. Look for bias, missing evidence, or misweighting.
3. If needed, revise:
   - finalVerdict (support|refute|nuance|insufficient)
   - confidence (0–1)
   - rationale (short explanation)
4. If initial verdict is solid, keep it but refine rationale.
    `;

    const schemaHint = `{
      "finalVerdict": "support|refute|nuance|insufficient",
      "confidence": 0.0,
      "rationale": "string"
    }`;

    let out = null;
    try {
      out = await this.deps.llm.generate({
        system,
        user,
        schemaHint,
        temperature: 0.3,
      });
    } catch (err) {
      logger.warn("🟥 [REDTEAM] LLM error:", err);
      return adjudication; // fallback
    }

    if (!out || !out.finalVerdict) {
      logger.warn("🟥 [REDTEAM] Invalid red-team result, keeping original.");
      return adjudication;
    }

    const revised = {
      claimId: claim.id,
      finalVerdict: out.finalVerdict || adjudication.finalVerdict,
      confidence: Math.max(
        0.1,
        Math.min(0.99, out.confidence || adjudication.confidence)
      ),
      rationale: out.rationale || adjudication.rationale,
      evidenceIds: adjudication.evidenceIds,
      counters: adjudication.counters,
    };

    logger.log(`🟥 [REDTEAM] Revised verdict for ${claim.id}:`, revised);
    return revised;
  }

  async prepareBearingGatedClaim(claim, index, contexts, opt) {
    const ctx = contexts ? contexts[claim.id] : undefined;
    const queries = await this.generateQueries(
      claim,
      ctx,
      opt.topKQueries ?? opt.queriesPerClaim ?? 6,
      opt,
    );
    let candidates = await this.retrieveCandidates(claim, queries, opt);

    // §7 anchor-poisoning DETECTION (non-destructive). Actual demotion of a
    // false resolved-work anchor lives in the query/retrieval-context layer and
    // is handled by the follow-up pass; here we only surface the problem so it is
    // visible in the survival audit. Flag any resolved work that is used as a
    // required anchor but is not a verified document (e.g. a press release title).
    const requiredAnchorSet = new Set(
      (Array.isArray(claim.retrievalContexts) ? claim.retrievalContexts : [])
        .flatMap((context) => context.requiredAnchors || [])
        .map((anchor) => String(anchor || "").trim().toLowerCase())
        .filter(Boolean),
    );
    for (const work of resolvedWorkCandidatesForClaim(claim)) {
      const title = String(work.title || "").trim();
      if (!title || !requiredAnchorSet.has(title.toLowerCase())) continue;
      const role = deriveVerifiedDocumentRole(work);
      if (!role?.verified) {
        logger.warn(`[ANCHOR_POISONING_AUDIT] ${JSON.stringify({
          event: "unverified_resolved_work_anchor",
          claimId: claim.id,
          title: title.slice(0, 200),
          url: String(work.url || "").slice(0, 500),
          verifiedDocumentRole: role?.role || null,
          recommendation: "demote_anchor_to_optional_or_remove",
        })}`);
      }
    }

    const existingUrls = new Set(candidates.map((candidate) => canonicalizeUrl(candidate.url) || candidate.url));
    for (const candidate of resolvedWorkCandidatesForClaim(claim)) {
      const key = canonicalizeUrl(candidate.url) || candidate.url;
      if (key && !existingUrls.has(key)) {
        candidates.push(candidate);
        existingUrls.add(key);
        logger.log(`[IDENTITY_CANDIDATE_INJECTED] ${JSON.stringify({
          event: "identity_candidate_injected",
          claimId: claim.id,
          url: String(candidate.url || "").slice(0, 500),
          identityRole: candidate.identityRole || candidate.identityBearingType || null,
          identityTargetId: candidate.identityTargetId || null,
          evidenceTargetId: candidate.evidenceTargetId || null,
          targetProvenance: candidate.targetProvenance || [],
        })}`);
      }
    }
    candidates = await enrichAcademicCandidates(candidates);
    // §6: stamp a verifiedDocumentRole derived from the document's OWN properties
    // (DOI/PMID/PMC, official domain, resolved identity) — never from the query's
    // requested evidenceTargetType. A press release returned by an original-study
    // query is not an original study.
    candidates = candidates.map((candidate) => {
      const role = deriveVerifiedDocumentRole(candidate);
      return role
        ? { ...candidate, verifiedDocumentRole: role.role, verifiedDocument: role.verified, verifiedDocumentSignals: role.signals }
        : candidate;
    });
    const academicWorks = new Map();
    for (const candidate of candidates.filter((item) => item.academicApiContent?.apiBacked)) {
      const ids = candidate.academicApiContent.identifiers || {};
      const key = ids.pmid || ids.pmcid || ids.doi || canonicalizeUrl(candidate.url) || candidate.url;
      if (!key) continue;
      const entry = academicWorks.get(key) || { routes: new Set(), urls: new Set(), title: candidate.title || "" };
      for (const route of candidate.discoveryRoutes || []) entry.routes.add(route);
      if (candidate.academicDiscoveryRoute === "direct_academic_search") entry.routes.add("direct_academic_search");
      if (candidate.academicDiscoveryRoute === "web_discovered_identifier") entry.routes.add("web_search");
      if (candidate.academicDiscoveryRoute === "direct_and_web") {
        entry.routes.add("direct_academic_search");
        entry.routes.add("web_search");
      }
      entry.urls.add(candidate.url);
      academicWorks.set(key, entry);
    }
    if (academicWorks.size) {
      const works = [...academicWorks.entries()].map(([identifier, entry]) => {
        const direct = entry.routes.has("direct_academic_search");
        const web = entry.routes.has("web_search");
        return {
          identifier: String(identifier).slice(0, 200),
          route: direct && web ? "direct_and_web" : direct ? "direct_only" : "web_identifier_only",
          title: String(entry.title).slice(0, 300),
          urls: [...entry.urls].slice(0, 4),
        };
      });
      logger.log(`[ACADEMIC_DISCOVERY_ROUTES] ${JSON.stringify({
        event: "academic_discovery_route_summary",
        taskContentId: opt.taskContentId || null,
        claimId: claim.id,
        uniqueAcademicWorks: works.length,
        directOnly: works.filter((work) => work.route === "direct_only").length,
        webIdentifierOnly: works.filter((work) => work.route === "web_identifier_only").length,
        directAndWeb: works.filter((work) => work.route === "direct_and_web").length,
        works: works.slice(0, 20),
      })}`);
    }
    candidates = applyIdentityBearing(claim, candidates);
    if ((isBearingShadowEnabled() || opt.enableBearingGating) && claim.evidenceNeed) {
      candidates = scoreCandidatesInBearingShadow(
        claim.evidenceNeed,
        candidates,
        { minBearingToScrape: opt.minBearingToScrape },
      );
    }
    const snippetBearingLlmEnabled =
      (isBearingShadowEnabled() || opt.enableBearingGating) &&
      isSnippetBearingLlmEnabled() &&
      Boolean(claim.evidenceNeed);
    if (snippetBearingLlmEnabled) {
      const bounds = resolveSurvivalBounds(opt);
      // In the gated bearing path, choose which candidates enter the (expensive)
      // LLM bearing batch by DETERMINISTIC bearing score + verified document role
      // + bearing-text richness — never provider score. Verified documents get
      // reserved slots. Candidates beyond the cap still survive downstream with
      // their deterministic score; they are logged as excluded from the LLM
      // batch. The legacy shadow path keeps its original fetched order.
      if (opt.enableBearingGating) {
        const { ordered, excludedFromLlm } = orderForLlmBearing({ candidates, bounds });
        for (const candidate of excludedFromLlm) {
          logCandidateDrop({
            claim,
            taskContentId: opt.taskContentId || null,
            // Non-verified candidates cut here were ranked below the LLM cap by
            // DETERMINISTIC bearing (verified docs bypass this gate via reserved
            // slots). They still survive downstream with their deterministic score.
            stage: DROP_STAGES.DETERMINISTIC_BEARING_GATE,
            candidate,
            reason: DROP_REASONS.BEYOND_LLM_BEARING_CAP,
          });
        }
        candidates = ordered;
      }
      const batch = await assessSnippetBearingBatch({
        claim,
        evidenceNeed: claim.evidenceNeed,
        candidates,
        llm: this.deps.llm,
        promptManager: this.deps.promptManager || null,
        taskContentId: opt.taskContentId || null,
        maxCandidates: opt.maxSnippetCandidatesPerClaim || bounds.maxLlmBearingCandidatesPerClaim,
        maxCandidatesPerTargetBatch: opt.maxCandidatesPerTargetBatch,
        subBatchTimeoutMs: opt.snippetBearingTimeoutMs,
      });
      candidates = batch.candidates;
    }
    opt.repairAudit?.recordQueryPack({ claim, queries });
    return { claim, index, context: ctx, queries, candidates, snippetBearingLlmEnabled };
  }

  async _runAdaptiveExtraction(claim, candidatePool, opt, runtime = {}) {
    const config = opt.bearingConfig;
    const minHighBearing = config.minHighBearingClaimsPerTarget ?? 5;
    const minBearingForCounting = config.minBearingForPacket ?? 0.35;
    const sourceCeiling = Math.max(
      1,
      Number(opt.maxSourcesToScrapePerTarget ?? config.maxSourcesToScrapePerTarget ?? 10),
    );
    const initialCandidates = runtime.initialCandidates || [];
    const allocation = runtime.allocation || null;
    const orderedCandidates = [];
    const orderedKeys = new Set();
    for (const candidate of [...initialCandidates, ...(candidatePool || [])]) {
      const key = canonicalizeUrl(candidate?.url) || candidate?.url;
      if (!key || orderedKeys.has(key)) continue;
      orderedKeys.add(key);
      orderedCandidates.push(candidate);
    }

    const verdictEligibleTargetIds = new Set(
      (claim.evaluationTargets || [])
        .filter((t) => t.verdictEligible !== false)
        .map((t) => String(t.evaluationTargetId))
        .filter(Boolean),
    );

    const allEvidence = [];
    const highBearingByTargetId = new Map();
    const sourceUrls = new Set();
    const sourceDomains = new Set();
    let sourcesProcessed = 0;
    let ceilingExhausted = false;
    let globalBudgetExhausted = false;
    const processedCandidates = [];

    for (const candidate of orderedCandidates) {
      if (sourcesProcessed >= sourceCeiling) break;
      const isInitial = initialCandidates.some((item) =>
        (canonicalizeUrl(item?.url) || item?.url) === (canonicalizeUrl(candidate?.url) || candidate?.url)
      );
      if (!isInitial && allocation) {
        const reserved = reserveAdditionalCandidates([candidate], allocation, 1);
        if (reserved.length === 0) {
          globalBudgetExhausted = allocation.remainingUniqueSlots <= 0;
          continue;
        }
      }

      let evidence = [];
      try {
        // Complete the active source before checking the threshold. The legacy
        // two-quote cap made a five-assertion target impossible to satisfy from
        // a rich source, so adaptive extraction permits a bounded full tranche.
        evidence = (await Promise.all(expandCandidateTargetAssignments(candidate).map((assignment) =>
          this.extractEvidence(claim, assignment, {
            ...opt,
            maxEvidencePerDoc: Math.max(
              Number(opt.maxEvidencePerDoc) || 0,
              Math.min(12, minHighBearing * 2),
            ),
          })
        ))).flat();
      } catch (error) {
        logger.warn(`[ADAPTIVE_BEARING] claim=${claim.id} source failed; continuing to next candidate: ${error.message}`);
      }
      sourcesProcessed++;
      processedCandidates.push(candidate);
      const sourceKey = canonicalizeUrl(candidate?.url) || candidate?.url;
      if (sourceKey) sourceUrls.add(sourceKey);
      try {
        if (candidate?.url) sourceDomains.add(new URL(candidate.url).hostname.toLowerCase());
      } catch {
        // Invalid URLs were already screened by candidate selection.
      }
      allEvidence.push(...evidence);

      for (const item of evidence) {
        const targetId = item.evidenceTargetId ? String(item.evidenceTargetId) : null;
        if (!targetId) continue;
        const isHighBearing = qualifiesForBearingQuota(item, minBearingForCounting);
        if (isHighBearing) {
          if (!highBearingByTargetId.has(targetId)) highBearingByTargetId.set(targetId, []);
          const fp = String(item.quote || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().slice(0, 500);
          if (fp) {
            const tokens = new Set(fp.split(" ").filter((token) => token.length > 2));
            const equivalent = highBearingByTargetId.get(targetId).some((existing) => {
              if (existing.fp === fp) return true;
              const intersection = [...tokens].filter((token) => existing.tokens.has(token)).length;
              const union = new Set([...tokens, ...existing.tokens]).size;
              return union > 0 && intersection / union >= 0.85;
            });
            if (!equivalent) highBearingByTargetId.get(targetId).push({ fp, tokens });
          }
        }
      }

      if (verdictEligibleTargetIds.size > 0) {
        const allResolved = [...verdictEligibleTargetIds].every(
          (targetId) => (highBearingByTargetId.get(targetId)?.length ?? 0) >= minHighBearing,
        );
        if (allResolved) {
          logger.log(`[ADAPTIVE_BEARING] claim=${claim.id} threshold=${minHighBearing} reached for all targets after ${sourcesProcessed} sources`);
          break;
        }
      }
    }

    const unresolvedTargetIds = [...verdictEligibleTargetIds].filter(
      (targetId) => (highBearingByTargetId.get(targetId)?.length ?? 0) < minHighBearing,
    );

    const poolExhausted = processedCandidates.length >= orderedCandidates.length;
    if (unresolvedTargetIds.length > 0 &&
        (sourcesProcessed >= sourceCeiling || poolExhausted || globalBudgetExhausted)) ceilingExhausted = true;

    const highBearingStats = Object.fromEntries(
      [...highBearingByTargetId.entries()].map(([k, v]) => [k, v.length]),
    );

    logger.log(`[ADAPTIVE_BEARING] ${JSON.stringify({
      event: "adaptive_extraction_complete",
      claimId: claim.id,
      sourcesProcessed,
      ceilingExhausted,
      sourceCeiling,
      poolCandidateCount: orderedCandidates.length,
      globalBudgetExhausted,
      uniqueSourceCount: sourceUrls.size,
      uniqueDomainCount: sourceDomains.size,
      highBearingStats,
      unresolvedTargetIds,
      totalEvidence: allEvidence.length,
    })}`);

    return {
      evidence: allEvidence,
      unresolvedTargetIds,
      ceilingExhausted,
      highBearingStats,
      sourcesProcessed,
      processedCandidates,
      globalBudgetExhausted,
    };
  }

  async _runAdaptiveExtractionRoundRobin(adaptivePlans, opt) {
    const config = opt.bearingConfig;
    const minBearing = config.minBearingForPacket ?? 0.35;
    const minLinks = config.minBearingLinksPerClaim ?? 3;
    const minDelivered = config.minDeliveredSourcesPerContent ?? 24;
    const maxUniqueAttempts = Math.max(minDelivered, config.maxSourceAttemptsPerContent ?? 60);
    const sourceCeiling = Math.max(
      config.maxSourcesComparedPerClaim ?? 20,
      Number(opt.maxSourcesToScrapePerTarget) || 0,
    );
    const states = adaptivePlans.map(({ plan }) => ({
      plan,
      cursor: 0,
      sourcesProcessed: 0,
      protectedStudiesProcessed: 0,
      processedCandidates: [],
      evidence: [],
      bearingSourceUrls: new Set(),
      highBearingByTargetId: new Map(),
      verdictTargetIds: new Set((plan.claim.evaluationTargets || [])
        .filter((target) => target.verdictEligible !== false)
        .map((target) => String(target.evaluationTargetId))
        .filter(Boolean)),
      // Every target this claim legitimately owns. Used as a pre-scrape guard so
      // a candidate (or citation-derived candidate) carrying a foreign target
      // cannot leak evidence onto this claim.
      validTargetIds: new Set((plan.claim.evaluationTargets || [])
        .map((target) => String(target.evaluationTargetId))
        .filter(Boolean)),
    }));
    const attemptedUrls = new Set();
    const deliveredUrls = new Set();
    const maxProtectedStudies = 3;
    const hasPendingProtectedStudy = (state) =>
      state.protectedStudiesProcessed < maxProtectedStudies &&
      state.plan.rankedCandidates.slice(state.cursor).some((candidate) =>
        candidate?.protectedDocumentIdentity === true && Number(candidate.identityBearingScore) >= 0.8
      );
    let madeProgress = true;

    while (madeProgress && (
      attemptedUrls.size < maxUniqueAttempts || states.some(hasPendingProtectedStudy)
    )) {
      madeProgress = false;
      const needGlobalSources = deliveredUrls.size < minDelivered;
      for (const state of states) {
        const needsLinks = state.bearingSourceUrls.size < minLinks;
        const needsProtectedStudy = hasPendingProtectedStudy(state);
        if (!needGlobalSources && !needsLinks && !needsProtectedStudy) continue;
        if (state.sourcesProcessed >= sourceCeiling && !needsProtectedStudy) continue;

        let candidate = null;
        while (state.cursor < state.plan.rankedCandidates.length && !candidate) {
          const next = state.plan.rankedCandidates[state.cursor++];
          const key = canonicalizeUrl(next?.url) || next?.url;
          if (!key) continue;
          // Pre-scrape guards: never spend a scrape slot on an impossible
          // evidence URL (asset/login) or on a candidate whose target does not
          // belong to this claim.
          if (isRejectableEvidenceUrl(next.url)) {
            logger.log(`[CITATION_EXPANSION] ${JSON.stringify({ event: "candidate_rejected_asset_url", claimId: state.plan.claim.id, url: String(next.url || "").slice(0, 500) })}`);
            continue;
          }
          const nextTargetId = next.evidenceTargetId ? String(next.evidenceTargetId) : "";
          if (nextTargetId && state.validTargetIds.size && !state.validTargetIds.has(nextTargetId)) {
            logger.log(`[CITATION_EXPANSION] ${JSON.stringify({ event: "candidate_rejected_target_mismatch", claimId: state.plan.claim.id, url: String(next.url || "").slice(0, 500), candidateTargetId: nextTargetId })}`);
            continue;
          }
          if (attemptedUrls.size >= maxUniqueAttempts &&
            !(next.protectedDocumentIdentity === true && Number(next.identityBearingScore) >= 0.8)) {
            continue;
          }
          candidate = next;
        }
        if (!candidate) continue;
        const sourceKey = canonicalizeUrl(candidate.url) || candidate.url;
        const isNewGlobalAttempt = !attemptedUrls.has(sourceKey);
        const isProtectedStudy = candidate.protectedDocumentIdentity === true &&
          Number(candidate.identityBearingScore) >= 0.8;
        if (isNewGlobalAttempt && attemptedUrls.size >= maxUniqueAttempts && !isProtectedStudy) break;
        attemptedUrls.add(sourceKey);
        madeProgress = true;
        state.sourcesProcessed++;
        if (isProtectedStudy) {
          state.protectedStudiesProcessed++;
        }
        state.processedCandidates.push(candidate);

        let extracted = [];
        try {
          extracted = (await Promise.all(expandCandidateTargetAssignments(candidate).map((assignment) =>
            this.extractEvidence(state.plan.claim, assignment, {
              ...opt,
              maxEvidencePerDoc: Math.max(Number(opt.maxEvidencePerDoc) || 0, 6),
            })
          ))).flat();
        } catch (error) {
          logger.warn(`[ADAPTIVE_BEARING] claim=${state.plan.claim.id} source failed; continuing: ${error.message}`);
        }
        const qualifying = extracted.filter((item) => {
          const targetId = item.evidenceTargetId ? String(item.evidenceTargetId) : "";
          if (!targetId || !state.verdictTargetIds.has(targetId)) return false;
          return qualifiesForBearingQuota(item, minBearing);
        });
        if (typeof opt.onSourceProcessed === "function") {
          await opt.onSourceProcessed({
            claim: state.plan.claim,
            candidate,
            evidence: qualifying,
            attemptedUniqueSources: attemptedUrls.size,
            deliveredBearingSources: deliveredUrls.size + (qualifying.length ? 1 : 0),
          });
        }
        if (!qualifying.length) continue;

        deliveredUrls.add(sourceKey);
        state.bearingSourceUrls.add(sourceKey);
        state.evidence.push(...qualifying);
        for (const item of qualifying) {
          const targetId = String(item.evidenceTargetId);
          if (!state.highBearingByTargetId.has(targetId)) state.highBearingByTargetId.set(targetId, new Set());
          const fingerprint = String(item.quote || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().slice(0, 500);
          if (fingerprint) state.highBearingByTargetId.get(targetId).add(fingerprint);
        }
      }
    }

    const byClaimId = new Map();
    for (const state of states) {
      const highBearingStats = Object.fromEntries(
        [...state.highBearingByTargetId.entries()].map(([id, values]) => [id, values.size]),
      );
      const unresolvedTargetIds = [...state.verdictTargetIds].filter(
        (id) => (state.highBearingByTargetId.get(id)?.size || 0) < (config.minHighBearingClaimsPerTarget ?? 3),
      );
      byClaimId.set(Number(state.plan.claim.id), {
        evidence: state.evidence,
        processedCandidates: state.processedCandidates,
        sourcesProcessed: state.sourcesProcessed,
        bearingLinkCount: state.bearingSourceUrls.size,
        highBearingStats,
        unresolvedTargetIds,
        ceilingExhausted: state.bearingSourceUrls.size < minLinks || unresolvedTargetIds.length > 0,
        globalBudgetExhausted: attemptedUrls.size >= maxUniqueAttempts,
      });
    }
    logger.log(`[ADAPTIVE_BEARING] ${JSON.stringify({
      event: "adaptive_round_robin_complete",
      attemptedUniqueSources: attemptedUrls.size,
      deliveredBearingSources: deliveredUrls.size,
      requiredDeliveredSources: minDelivered,
      requiredBearingLinksPerClaim: minLinks,
      maxUniqueAttempts,
      claims: states.map((state) => ({
        claimId: state.plan.claim.id,
        sourcesProcessed: state.sourcesProcessed,
        bearingLinks: state.bearingSourceUrls.size,
        poolSize: state.plan.rankedCandidates.length,
      })),
    })}`);
    return { byClaimId, attemptedUrls, deliveredUrls };
  }

  async runBearingGated(claims, contexts, opt) {
    const config = opt.bearingConfig;
    const results = new Array(claims.length);
    const { eligible, skipped } = selectClaimsForBearingGating(claims, config);
    const eligibleIds = new Set(eligible.map((claim) => Number(claim.id)));

    for (let index = 0; index < claims.length; index++) {
      const claim = claims[index];
      if (eligibleIds.has(Number(claim.id))) continue;
      const skippedInfo = skipped.find((item) => Number(item.claim.id) === Number(claim.id));
      opt.repairAudit?.recordQueryPack({
        claim,
        queries: [],
        status: "skipped",
        reason: skippedInfo?.reason || "ineligible_claim",
      });
      results[index] = {
        claim,
        context: contexts ? contexts[claim.id] : undefined,
        meta: undefined,
        queries: [],
        candidates: [],
        evidence: [],
        adjudication: {
          claimId: claim.id,
          finalVerdict: "insufficient",
          confidence: 0.15,
          rationale: `Evidence search skipped by bearing gate: ${skippedInfo?.reason || "ineligible claim"}.`,
          evidenceIds: [],
          counters: [],
          unresolved_search_failed: true,
        },
        fringeQueries: [],
        fringeCandidates: [],
        fringeEvidence: [],
        bearingGatingSkipReason: skippedInfo?.reason || "ineligible_claim",
      };
    }

    const prepared = await Promise.all(
      claims
        .map((claim, index) => ({ claim, index }))
        .filter(({ claim }) => eligibleIds.has(Number(claim.id)))
        .map(({ claim, index }) => this.prepareBearingGatedClaim(claim, index, contexts, opt)),
    );
    const plans = prepared.map((item) => ({
      ...selectCandidatesForClaim(item.claim, item.candidates, config),
      prepared: item,
    }));
    opt.onProgress?.({
      counts: {
        sourcesDiscovered: new Set(plans.flatMap((plan) =>
          plan.rankedCandidates.map((candidate) => canonicalizeUrl(candidate.url) || candidate.url)
        ).filter(Boolean)).size,
      },
    });
    const isAdaptivePlan = (plan) => Boolean(
      config.finishActiveSourceOnThreshold && plan.claim.evaluationTargets?.length
    );
    // Reserve only the first source for adaptive claims. The previous code
    // allocated the entire global budget before adaptive retrieval began,
    // leaving no capacity for the required next tranche.
    const allocationPlans = plans.map((plan) => isAdaptivePlan(plan)
      ? { ...plan, selectedCandidates: [] }
      : plan
    );
    const allocation = allocateCandidatesAcrossClaims(allocationPlans, config);

    logger.log(`[BEARING_GATING] ${JSON.stringify({
      event: "bearing_gating_global_allocation",
      taskContentId: opt.taskContentId || null,
      totalClaims: claims.length,
      eligibleClaims: eligible.length,
      skippedClaims: skipped.length,
      uniqueSelectedUrls: allocation.usedCanonicalUrls.size,
      globalLimit: allocation.globalLimit,
      remainingUniqueSlots: allocation.remainingUniqueSlots,
      configVersion: config.version,
    })}`);

    const occurrences = [];
    const adaptivePlansForExtraction = [];
    for (const plan of plans) {
      const selectedCandidates = allocation.selectedByClaimId.get(Number(plan.claim.id)) || [];
      const selectedKeys = new Set(selectedCandidates.map((candidate) => canonicalizeUrl(candidate.url) || candidate.url));
      plan.prepared.candidates.forEach((candidate) => {
        logBearingShadowEvent({
          taskContentId: opt.taskContentId || null,
          claim: plan.claim,
          candidate,
          actualSelected: selectedKeys.has(canonicalizeUrl(candidate.url) || candidate.url),
        });
      });
      logBearingGatingAudit({
        taskContentId: opt.taskContentId || null,
        claim: plan.claim,
        candidates: plan.mergedCandidates,
        selectedCandidates,
        decisions: plan.decisions,
      });
      const isAdaptive = isAdaptivePlan(plan);
      if (isAdaptive) {
        adaptivePlansForExtraction.push({ plan, selectedCandidates });
      } else {
        for (const candidate of selectedCandidates) {
          for (const assignment of expandCandidateTargetAssignments(candidate)) {
            occurrences.push({ plan, candidate: assignment });
          }
        }
      }
    }

    // Fetch each canonical URL once in parallel. Any occurrence of that URL for
    // another claim is extracted only after the first fetch has populated the
    // existing reference cache in runEvidenceEngine.
    const firstByCanonical = new Map();
    const duplicateOccurrences = [];
    for (const occurrence of occurrences) {
      const key = canonicalizeUrl(occurrence.candidate.url) || occurrence.candidate.url;
      if (!firstByCanonical.has(key)) firstByCanonical.set(key, occurrence);
      else duplicateOccurrences.push({ ...occurrence, canonicalKey: key });
    }
    const evidenceByClaimId = new Map(prepared.map((item) => [Number(item.claim.id), []]));
    const extractOccurrence = async (occurrence, canonicalUrlOverride = null) => {
      const candidate = canonicalUrlOverride
        ? { ...occurrence.candidate, originalUrl: occurrence.candidate.url, url: canonicalUrlOverride }
        : occurrence.candidate;
      const evidence = await this.extractEvidence(occurrence.plan.claim, candidate, opt);
      evidenceByClaimId.get(Number(occurrence.plan.claim.id)).push(...evidence);
    };
    await Promise.all([...firstByCanonical.values()].map((occurrence) => extractOccurrence(occurrence)));
    await Promise.all(duplicateOccurrences.map((occurrence) => {
      const first = firstByCanonical.get(occurrence.canonicalKey);
      return extractOccurrence(occurrence, first.candidate.url);
    }));

    const adaptiveMetaByClaimId = new Map();
    if (adaptivePlansForExtraction.length) {
      const adaptiveRun = await this._runAdaptiveExtractionRoundRobin(adaptivePlansForExtraction, opt);
      for (const [claimId, adaptiveResult] of adaptiveRun.byClaimId) {
        evidenceByClaimId.set(claimId, adaptiveResult.evidence);
        adaptiveMetaByClaimId.set(claimId, adaptiveResult);
      }
    }

    for (const plan of plans) {
      const { claim, index, context, queries, candidates, snippetBearingLlmEnabled } = plan.prepared;
      const adaptiveMeta = adaptiveMetaByClaimId.get(Number(claim.id));
      const selectedCandidates = adaptiveMeta?.processedCandidates ||
        allocation.selectedByClaimId.get(Number(claim.id)) || [];
      const evs = (evidenceByClaimId.get(Number(claim.id)) || []).flat();
      if (snippetBearingLlmEnabled) {
        logSnippetBearingCalibration({
          taskContentId: opt.taskContentId || null,
          claim,
          candidates,
          evidence: evs,
          selectedCanonicalUrls: selectedCandidates.map((candidate) => candidate.url),
        });
      }
      const evidencePacket = opt.enableBearingPacket
        ? this.buildPacketSidecar(claim, evs, opt)
        : null;
      const adjudicationEvidence = claim.targetMappingUnresolved
        ? []
        : opt.enableBearingPacketLive
          ? this.packetEvidenceForAdjudication(evidencePacket)
          : evs;
      let adjudication = this.adjudicate(claim, adjudicationEvidence);
      if (adjudicationEvidence.length === 0) {
        adjudication = {
          ...adjudication,
          finalVerdict: "insufficient",
          unresolved_search_failed: true,
          rationale: claim.targetMappingUnresolved
            ? "Target mapping is unresolved; attribution/study-identity retrieval cannot affect the article verdict."
            : opt.enableBearingPacketLive && evs.length > 0
              ? "No verdict-eligible evidence passed the live bearing packet."
              : "No matching evidence found within bearing/source caps.",
        };
      }
      if (adaptiveMeta) {
        adjudication = {
          ...adjudication,
          unresolvedTargetIds: adaptiveMeta.unresolvedTargetIds || [],
          highBearingStats: adaptiveMeta.highBearingStats || {},
          sourcesProcessed: adaptiveMeta.sourcesProcessed || 0,
        };
      }
      if (adaptiveMeta?.unresolvedTargetIds?.length > 0 && adaptiveMeta.ceilingExhausted) {
        adjudication = {
          ...adjudication,
          unresolved_ceiling_exhausted: true,
        };
      }
      if (opt.enableRedTeam) adjudication = await this.redTeam(claim, adjudication, adjudicationEvidence);
      results[index] = {
        claim,
        context,
        meta: undefined,
        queries,
        candidates,
        selectedCandidates,
        evidence: evs,
        ...(evidencePacket ? { evidencePacket } : {}),
        adjudication,
        fringeQueries: [],
        fringeCandidates: [],
        fringeEvidence: [],
      };
    }

    // Preserve the existing optional fringe pass only while global unique URL
    // budget remains. Process in claim order for deterministic allocation.
    if (opt.enableFringeSearch && allocation.remainingUniqueSlots > 0) {
      for (const plan of plans) {
        if (allocation.remainingUniqueSlots <= 0) break;
        const row = results[plan.prepared.index];
        if (row.adjudication.finalVerdict !== "support" || row.adjudication.confidence <= 0.7) continue;
        const fringeQueries = this.generateFringeQueries(
          plan.claim,
          this.detectClaimType(plan.claim.text),
          opt.topKFringeQueries ?? 3,
        );
        let fringeCandidates = await this.retrieveCandidates(plan.claim, fringeQueries, {
          ...opt,
          enableWeb: true,
          enableInternal: false,
          topKCandidates: opt.topKFringeCandidates ?? 3,
          preferDomains: [],
          avoidDomains: [],
        });
        if (plan.prepared.snippetBearingLlmEnabled) {
          const batch = await assessSnippetBearingBatch({
            claim: plan.claim,
            evidenceNeed: plan.claim.evidenceNeed,
            candidates: fringeCandidates,
            llm: this.deps.llm,
            promptManager: this.deps.promptManager || null,
            taskContentId: opt.taskContentId || null,
            maxCandidates: opt.maxSnippetCandidatesPerClaim || 12,
            maxCandidatesPerTargetBatch: opt.maxCandidatesPerTargetBatch,
            subBatchTimeoutMs: opt.snippetBearingTimeoutMs,
          });
          fringeCandidates = batch.candidates;
        }
        const fringePlan = selectCandidatesForClaim(plan.claim, fringeCandidates, config, {
          perClaimLimit: Math.min(1, opt.maxFringeEvidenceCandidates ?? 1),
        });
        const selectedFringe = reserveAdditionalCandidates(
          fringePlan.selectedCandidates,
          allocation,
          Math.min(1, opt.maxFringeEvidenceCandidates ?? 1),
        );
        const fringeEvidence = (
          await Promise.all(selectedFringe.map((candidate) => this.extractEvidence(plan.claim, candidate, opt)))
        ).flat();
        fringeEvidence.forEach((item) => {
          item.isFringe = true;
          item.fringeReason = "Found via bounded fringe/steelman query under bearing gate";
        });
        row.fringeQueries = fringeQueries;
        row.fringeCandidates = fringeCandidates;
        row.fringeEvidence = fringeEvidence;
      }
    }

    if (opt.enableBearingPacket) {
      for (const row of results) {
        if (!row) continue;
        if (!row.evidencePacket || row.fringeEvidence?.length) {
          row.evidencePacket = this.buildPacketSidecar(
            row.claim,
            [...(row.evidence || []), ...(row.fringeEvidence || [])],
            opt,
          );
        }
        if (opt.enableBearingPacketLive && row.fringeEvidence?.length) {
          row.adjudication = this.adjudicate(
            row.claim,
            this.packetEvidenceForAdjudication(row.evidencePacket),
          );
        }
      }
    }

    logger.log("🟩 [DEBUG] Final bearing-gated results before persist:", results);
    return results;
  }

  async run(claims, contexts, opt) {
    if (opt.enableBearingGating) {
      return this.runBearingGated(claims, contexts, opt);
    }

    const maxParallel = this.cfg.maxParallelClaims ?? 3;
    const results = new Array(claims.length);

    // Create async task for each claim
    const tasks = claims.map((claim, index) => async () => {
      const ctx = contexts ? contexts[claim.id] : undefined;

      logger.log(
        `\n🔵 [DEBUG] Starting claim ${claim.id}: "${claim.text.slice(
          0,
          50
        )}..."`
      );

      const claimLabel = `[EV][claim:${claim.id}]`;
      logger.time(`${claimLabel} total`);

      const queries = await this.generateQueries(
        claim,
        ctx,
        opt.topKQueries ?? opt.queriesPerClaim ?? 6,
        opt // Pass full options for balanced search mode detection
      );

      let candidates = await this.retrieveCandidates(claim, queries, opt);
      opt.repairAudit?.recordQueryPack({ claim, queries });

      const snippetBearingLlmEnabled =
        isBearingShadowEnabled() &&
        isSnippetBearingLlmEnabled() &&
        Boolean(claim.evidenceNeed);
      if (snippetBearingLlmEnabled) {
        const batch = await assessSnippetBearingBatch({
          claim,
          evidenceNeed: claim.evidenceNeed,
          candidates,
          llm: this.deps.llm,
          promptManager: this.deps.promptManager || null,
          taskContentId: opt.taskContentId || null,
          maxCandidates: opt.maxSnippetCandidatesPerClaim || 12,
          maxCandidatesPerTargetBatch: opt.maxCandidatesPerTargetBatch,
          subBatchTimeoutMs: opt.snippetBearingTimeoutMs,
        });
        // Phase 3 remains a same-length, same-order map. No gating or sorting.
        candidates = batch.candidates;
      }

      let shadowSelectedCount = 0;
      if (isBearingShadowEnabled() && claim.evidenceNeed) {
        // Observe the exact legacy selection operation without replacing it.
        // The real fetch expression below remains unchanged.
        shadowSelectedCount = candidates.slice(0, opt.maxEvidenceCandidates).length;
        candidates.forEach((candidate, candidateIndex) => {
          logBearingShadowEvent({
            taskContentId: opt.taskContentId || null,
            claim,
            candidate,
            actualSelected: candidateIndex < shadowSelectedCount,
          });
        });
      }

      // Process all candidates in parallel (parallel is faster than sequential early exit)
      const evs = (
        await Promise.all(
          candidates
            .slice(0, opt.maxEvidenceCandidates)
            .map((c) => this.extractEvidence(claim, c, opt))
        )
      ).flat();

      logger.log(
        `🟨 [DEBUG] Evidence items returned for ${claim.id}:`,
        evs.length
      );

      if (snippetBearingLlmEnabled) {
        logSnippetBearingCalibration({
          taskContentId: opt.taskContentId || null,
          claim,
          candidates,
          evidence: evs,
          selectedCandidateCount: shadowSelectedCount,
        });
      }

      const verdictEvidence = claim.targetMappingUnresolved ? [] : evs;
      let adj = this.adjudicate(claim, verdictEvidence);
      if (verdictEvidence.length === 0) {
        adj = {
          ...adj,
          finalVerdict: "insufficient",
          unresolved_search_failed: true,
          rationale: claim.targetMappingUnresolved
            ? "Target mapping is unresolved; attribution/study-identity retrieval cannot affect the article verdict."
            : "No matching evidence found within search/source caps.",
        };
      }
      if (opt.enableRedTeam) {
        adj = await this.redTeam(claim, adj, verdictEvidence);
      }

      // ═══════════════════════════════════════════════════════════════════
      // PASS 2: FRINGE SOURCE DISCOVERY (if enabled)
      // ═══════════════════════════════════════════════════════════════════
      let fringeEvidence = [];
      let fringeQueries = [];
      let fringeCandidates = [];

      if (opt.enableFringeSearch) {
        logger.log(`🔍 [EV][fringe][${claim.id}] Starting fringe source discovery...`);

        // Detect claim type for targeted fringe searches
        const claimType = this.detectClaimType(claim.text);
        logger.log(`🔍 [EV][fringe][${claim.id}] Detected claim type: ${claimType || 'unknown'}`);

        // Generate fringe-seeking queries
        fringeQueries = this.generateFringeQueries(
          claim,
          claimType,
          opt.topKFringeQueries ?? 3
        );

        // Only search for fringe sources if primary verdict is strong support
        // (this is where we expect to find low-quality refutations)
        if (adj.finalVerdict === 'support' && adj.confidence > 0.7) {
          logger.log(`🔍 [EV][fringe][${claim.id}] Primary verdict is strong support - searching for fringe refutations...`);

          fringeCandidates = await this.retrieveCandidates(
            claim,
            fringeQueries,
            {
              ...opt,
              enableWeb: true,
              enableInternal: false,
              topKCandidates: opt.topKFringeCandidates ?? 3,
              preferDomains: [], // Don't filter - we WANT fringe sources
              avoidDomains: [],  // Don't filter
            }
          );

          // Extract evidence from fringe sources (fewer candidates)
          fringeEvidence = (
            await Promise.all(
              fringeCandidates
                .slice(0, opt.maxFringeEvidenceCandidates ?? 2)
                .map((c) => this.extractEvidence(claim, c, opt))
            )
          ).flat();

          logger.log(
            `🔍 [EV][fringe][${claim.id}] Found ${fringeEvidence.length} fringe evidence items`
          );

          // Tag fringe evidence for credibility analysis
          fringeEvidence.forEach(ev => {
            ev.isFringe = true;
            ev.fringeReason = 'Found via fringe-seeking queries';
          });
        } else {
          logger.log(`🔍 [EV][fringe][${claim.id}] Skipping fringe search (verdict not strong support or low confidence)`);
        }
      }

      const row = {
        claim,
        context: ctx,
        meta: undefined,
        queries,
        candidates,
        evidence: evs,
        adjudication: adj,
        // Add fringe data
        fringeQueries,
        fringeCandidates,
        fringeEvidence,
        ...(opt.enableBearingPacket ? {
          evidencePacket: this.buildPacketSidecar(claim, [...evs, ...fringeEvidence], opt),
        } : {}),
      };

      if (opt.enableBearingPacketLive && row.evidencePacket && !claim.targetMappingUnresolved) {
        const packetEvidence = this.packetEvidenceForAdjudication(row.evidencePacket);
        row.adjudication = this.adjudicate(claim, packetEvidence);
        if (packetEvidence.length === 0) {
          row.adjudication = {
            ...row.adjudication,
            finalVerdict: "insufficient",
            rationale: "No verdict-eligible evidence passed the live bearing packet.",
          };
        }
      }

      results[index] = row;

      logger.timeEnd(`${claimLabel} total`);
    });

    // Execute tasks with concurrency limit
    if (maxParallel === Infinity || maxParallel >= tasks.length) {
      // No throttle → process all claims in parallel
      await Promise.all(tasks.map((t) => t()));
    } else {
      // Throttled runner
      let i = 0;
      const workers = new Array(maxParallel).fill(0).map(async () => {
        while (i < tasks.length) {
          const task = tasks[i++];
          await task();
        }
      });
      await Promise.all(workers);
    }

    logger.log("🟩 [DEBUG] Final results before persist:", results);

    return results;
  }
}
