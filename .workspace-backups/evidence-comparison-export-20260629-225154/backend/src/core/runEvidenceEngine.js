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
import { tavilySearch } from "./tavilySearch.js";
import { bingSearch } from "./bingSearch.js";
import { duckDuckGoSearch } from "./duckDuckGoSearch.js";
import { EvidenceEngine } from "./evidenceEngine.js";
import { SourceQualityScorer } from "./sourceQualityScorer.js";
import { query } from "../db/pool.js";
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
import { buildEvidenceNeedV1, buildEvidenceTargetQueries } from "./evidenceNeed.js";
import { isBearingShadowEnabled } from "./snippetBearing.js";
import { loadBearingGatingConfig } from "./bearingConfig.js";
import logger from "../utils/logger.js";
import * as cheerio from "cheerio";
import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";

import fetch from "node-fetch";

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
  if (!cleaned || cleaned.length < 2) return null;
  if (JUNK_PUBLISHER_RE.test(cleaned)) return null;
  return cleaned;
}

function isLegitSourceCrestCode(code) {
  const normalized = String(code || "").trim().toUpperCase();
  if (!/^[A-EØ][1-5Ø]$/.test(normalized)) return false;
  return !normalized.startsWith("Ø");
}

async function getCachedPublisherCrest(publisherId) {
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

  const cachedCrest = await getCachedPublisherCrest(publisherId);

  return {
    publisherId,
    publisherName,
    sourceType: identity?.sourceType || "unknown",
    resolutionLevel: identity?.resolutionLevel || 3,
    cachedCrest,
  };
}

function enrichReferencePublisherAsync({ referenceContentId, url, publisherLink }) {
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

  const identityTerms = source
    .match(/\b(?:[A-Z][A-Za-z0-9'’.-]+(?:\s+[A-Z][A-Za-z0-9'’.-]+){0,4}|\d{4}|[A-Z]{2,})\b/g);
  if (identityTerms?.length) {
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

export async function runEvidenceEngine({
  taskContentId,
  claimIds,
  claims: claimMetadata = [],
  readableText,
}) {
  logger.log("🟣 [runEvidenceEngine] Starting evidence run…");

  if (!taskContentId) throw new Error("Missing taskContentId");
  if (!Array.isArray(claimIds) || claimIds.length === 0)
    throw new Error("No claims passed to EvidenceEngine");

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

  // Fetch claim text from DB
  const rows = await query(
    `SELECT claim_id, claim_text FROM claims WHERE claim_id IN (?)`,
    [claimIds]
  );

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
      const mappedObjectClaim = String(meta.objectClaim || meta.object_claim_text || meta.objectText || "").trim();
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
        claimKind: meta.claimKind || meta.claim_kind || "",
        evidenceType: meta.evidenceType || meta.evidence_type || "",
        namedEntities: Array.isArray(meta.namedEntities) ? meta.namedEntities : [],
        dates: Array.isArray(meta.dates) ? meta.dates : [],
        studiesOrDocuments: Array.isArray(meta.studiesOrDocuments) ? meta.studiesOrDocuments : [],
        sourceCitedInArticle: meta.sourceCitedInArticle || "",
        isFallibilityCritical: Boolean(meta.isFallibilityCritical || meta.is_fallibility_critical),
        searchAssertions: Array.isArray(meta.searchAssertions) ? meta.searchAssertions : [],
      };
      const targetRoutingEnabled = isEvidenceTargetRoutingEnabled();
      if (targetRoutingEnabled || isBearingShadowEnabled() || bearingConfig.enableBearingGating) {
        claim.evidenceNeed = buildEvidenceNeedV1(claim);
      }
      const assertionTargets = targetRoutingEnabled
        ? buildEvidenceTargetQueries(claim.evidenceNeed, 3).filter((target) => target.matchedPart === "search_assertion")
        : [];
      claim.searchTargets = assertionTargets.length > 0
        ? assertionTargets
        : targetRoutingEnabled
          ? addEvidenceTargetProvenance(buildSearchTargets(claim), claim.evidenceNeed)
          : buildSearchTargets(claim);
      return claim;
    }).sort((a, b) =>
      (b.priority - a.priority) ||
      (b.verifiability - a.verifiability) ||
      (b.centrality - a.centrality)
    );

  claimIds.splice(0, claimIds.length, ...claims.map((claim) => claim.id));

  // Map to store processed references (URL → metadata)
  const referenceCache = new Map();

  // Track failed candidates for UI fallback (manual dashboard scrape)
  const failedCandidates = [];

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
        internal: tavilySearch.internal ?? (() => []),
        web: async (opts) => {
          if (runOptions.searchEngine === "tavily") {
            const start = Date.now();
            const results = await tavilySearch.web(opts);
            const duration = Date.now() - start;
            logger.log(
              `⏱️  [BENCHMARK] Tavily search took ${duration}ms for query: "${opts.query}"`
            );
            return results;
          }
          if (runOptions.searchEngine === "bing") {
            const start = Date.now();
            const results = await bingSearch(opts);
            const duration = Date.now() - start;
            logger.log(
              `⏱️  [BENCHMARK] Bing search took ${duration}ms for query: "${opts.query}"`
            );
            return results;
          }

          // hybrid
          const startTav = Date.now();
          const startBing = Date.now();
          const [tav, bing] = await Promise.all([
            tavilySearch.web(opts).then((r) => {
              const duration = Date.now() - startTav;
              logger.log(
                `⏱️  [BENCHMARK] Tavily (hybrid) took ${duration}ms for query: "${opts.query}"`
              );
              return r;
            }),
            bingSearch(opts).then((r) => {
              const duration = Date.now() - startBing;
              logger.log(
                `⏱️  [BENCHMARK] Bing (hybrid) took ${duration}ms for query: "${opts.query}"`
              );
              return r;
            }),
          ]);
          return [...(tav || []), ...(bing || [])];
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
                isProcessed: true, // Flag that this is already processed
              };
            }

            logger.log(`🌐 [Evidence] Fetching: ${cand.url}`);

            // ─────────────────────────────────────────────
            // 1. FETCH and DETECT content type
            // ─────────────────────────────────────────────
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 15000); // 15s timeout

            const resp = await fetch(cand.url, { signal: controller.signal });
            clearTimeout(timeout);

            const contentType = resp.headers.get('content-type') || '';
            const isPdf = contentType.includes('application/pdf') || cand.url.toLowerCase().match(/\.pdf($|\?)/);

            let html = null;
            let pdfExtractedText = null;
            let pdfTitle = null;
            let pdfAuthors = null;
            let pdfIdentity = null;

            if (isPdf) {
              logger.log(`📄 [Evidence] Detected PDF (Content-Type: ${contentType}), extracting text...`);
              try {
                // Import pdf-parse dynamically
                const pdfParse = (await import('pdf-parse')).default;

                const buffer = await resp.arrayBuffer();
                const parsed = await pdfParse(Buffer.from(buffer));

                let fullText = (parsed.text || "").replace(/\r/g, "");

                // Strip XMP metadata
                fullText = fullText.replace(/<\?xpacket[\s\S]*?<\?xpacket end.*?\?>/gi, '');
                fullText = fullText.replace(/<x:xmpmeta[\s\S]*?<\/x:xmpmeta>/gi, '');
                fullText = fullText.replace(/<rdf:RDF[\s\S]*?<\/rdf:RDF>/gi, '');
                fullText = fullText.replace(/\n{3,}/g, '\n\n').trim();

                pdfExtractedText = fullText;
                pdfTitle = parsed.info?.Title?.trim() || null;
                pdfAuthors = parsed.info?.Author?.trim() || null;
                pdfIdentity = (await processPublishingIdentity({
                  documentType: "pdf",
                  pdfInfo: parsed.info || {},
                  pdfMetadata: parsed.metadata || null,
                  pdfText: fullText,
                  sourceUrl: cand.url,
                })).identity;

                logger.log(`📄 [Evidence] PDF extracted: ${pdfExtractedText.length} chars, ${parsed.numpages} pages`);
              } catch (pdfErr) {
                logger.warn(`⚠️  [Evidence] PDF extraction failed: ${pdfErr.message} - will create stub reference`);
                // Set empty text so it creates a stub reference that can be manually scraped
                pdfExtractedText = "";
              }
            } else {
              // ─────────────────────────────────────────────
              // HTML content - get text
              // ─────────────────────────────────────────────
              html = await resp.text();

              if (!html || html.length < 100) {
                logger.warn(`⚠️  [Evidence] Empty response from ${cand.url}`);
                return null;
              }

              logger.log(`✅ [Evidence] Fetched ${html.length} chars`);
            }

            // ─────────────────────────────────────────────
            // 2. EXTRACT METADATA based on content type
            // ─────────────────────────────────────────────
            let title, authors, publisher, publishingIdentity, thumbnail, cleanText, citationCount = 0;

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

              publishingIdentity = pdfIdentity;
              authors = publishingIdentity?.document?.authors?.length
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
              title =
                cand.title || (await getMainHeadline($)) || "AI Reference";
              authors = await extractAuthors($);
              const identityResult = await processPublishingIdentity({ $, sourceUrl: cand.url });
              publishingIdentity = identityResult.identity;
              publisher = identityResult.legacyPublisher;
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
                topic: "AI Evidence (Failed)",
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

              const persistedStubIdentity = (await processPublishingIdentity({
                query,
                contentId: stubContentId,
                identity: publishingIdentity,
                fallbackPublisher: publisher,
              })).persistence;
              const publisherLink = persistedStubIdentity?.primaryEntityId
                ? {
                    publisherId: persistedStubIdentity.primaryEntityId,
                    publisherName: persistedStubIdentity.primaryEntityId === persistedStubIdentity.publicationVenueId
                      ? publishingIdentity?.entities?.publication_venue?.name
                      : publishingIdentity?.entities?.publishing_organization?.name || publisher?.name,
                    sourceType: publishingIdentity?.context?.context_type || "unknown",
                    resolutionLevel: 5,
                    cachedCrest: await getCachedPublisherCrest(persistedStubIdentity.primaryEntityId),
                  }
                : await ensureReferencePublisherLink({
                    referenceContentId: stubContentId,
                    url: cand.url,
                    publisher,
                    title,
                    author: authors?.[0]?.name || authors?.[0] || null,
                  });
              enrichReferencePublisherAsync({
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
                title,
                authors,
                publisher,
                thumbnail,
                cleanText: "", // Empty - needs manual scrape
                snippet: cand.snippet || "", // Save search engine snippet
                quality, // Store quality
                isFailed: true, // Mark as needing manual scrape
                claimIndices: claimIndex !== -1 ? [claimIndex] : [], // Track which claim requested this
              });

              // Track for UI to display as "needs manual scrape"
              failedCandidates.push({
                url: cand.url,
                title: title || "Unknown",
                reason: `Insufficient text (${cleanText.length} chars)`,
                contentId: stubContentId,
              });

              return null;
            }

            // ─────────────────────────────────────────────
            // 5. CREATE REFERENCE CONTENT ROW
            // ─────────────────────────────────────────────
            const referenceContentId = await createContentInternal(query, {
              content_name: title,
              url: cand.url,
              media_source: publisher?.name || "Unknown",
              topic: "AI Evidence",
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
            await persistAuthors(query, referenceContentId, authors);
            const persistedIdentity = (await processPublishingIdentity({
              query,
              contentId: referenceContentId,
              identity: publishingIdentity,
              fallbackPublisher: publisher?.name && publisher.name !== "Unknown Publisher" ? publisher : null,
            })).persistence;

            const primaryName = persistedIdentity?.primaryEntityId === persistedIdentity?.publicationVenueId
              ? publishingIdentity?.entities?.publication_venue?.name
              : publishingIdentity?.entities?.publishing_organization?.name;
            const publisherLink = persistedIdentity?.primaryEntityId
              ? {
                  publisherId: persistedIdentity.primaryEntityId,
                  publisherName: primaryName || publisher?.name,
                  sourceType: publishingIdentity?.context?.context_type || "unknown",
                  resolutionLevel: 5,
                  cachedCrest: await getCachedPublisherCrest(persistedIdentity.primaryEntityId),
                }
              : await ensureReferencePublisherLink({
                  referenceContentId,
                  url: cand.url,
                  publisher,
                  title,
                  author: authors?.[0]?.name || authors?.[0] || null,
                });
            enrichReferencePublisherAsync({
              referenceContentId,
              url: cand.url,
              publisherLink,
            });

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
              claimIndices: claimIndex !== -1 ? [claimIndex] : [], // Track which claim requested this
            });

            logger.log(
              `🎯 [Evidence] Fully processed reference: ${cand.url} → content_id=${referenceContentId}`
            );

            // Return object with cleanText + citationCount to avoid re-parsing in evidenceEngine
            return {
              cleanText,
              citationCount,
              isProcessed: true, // Flag that this is already processed
            };
          } catch (err) {
            logger.warn(
              `⚠️  [Evidence] Fetch failed for ${cand.url}: ${err.message}`
            );

            // ─────────────────────────────────────────────
            // Create stub content row for failed reference
            // ─────────────────────────────────────────────
            const stubContentId = await createContentInternal(query, {
              content_name: cand.title || "Failed Reference",
              url: cand.url,
              media_source: "Unknown",
              topic: "AI Evidence (Failed)",
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
              referenceContentId: stubContentId,
              url: cand.url,
              publisher: null,
              title: cand.title || "Failed Reference",
              author: null,
            });
            enrichReferencePublisherAsync({
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

  // engine.run(claims, contexts, opt)
  // contexts can be null/undefined if not needed
  const runOptions = {
    ...((isBearingShadowEnabled() || bearingConfig.enableBearingGating || bearingConfig.enableBearingPacket) ? { taskContentId } : {}),
    enableBearingGating: bearingConfig.enableBearingGating,
    enableBearingPacket: bearingConfig.enableBearingPacket,
    bearingConfig,
    maxSnippetCandidatesPerClaim: bearingConfig.maxSnippetCandidatesPerClaim,
    enableInternal: true,
    enableWeb: true,
    searchEngine: "hybrid",
    preferDomains: [],
    avoidDomains: [],
    maxCharsPerDoc: 8000,
    enableRedTeam: false,

    // Apply mode-specific config (or fallback to defaults)
    queriesPerClaim: Math.min(modeConfig.queriesPerClaim || 6, 3),
    topKQueries: Math.min(modeConfig.queriesPerClaim || 6, 3),
    topKCandidates: Math.min(modeConfig.topKCandidates || modeConfig.queriesPerClaim || 6, 9),
    maxEvidencePerDoc: 2,
    maxEvidenceCandidates: Math.min(modeConfig.maxEvidenceCandidates || 4, 9),
    maxSearchTargetsPerClaim: 3,
    maxSourcesComparedPerClaim: 9,
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
  };

  const results = await engine.run(claims, null, runOptions);

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
      if (!ev.url) continue;

      // Get reference metadata from cache
      const refData = referenceCache.get(ev.url);
      if (!refData) {
        logger.warn(`⚠️  [Evidence] No cached data for ${ev.url}, skipping`);
        continue;
      }

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
          scrapeStatus: "full", // Successfully scraped full content
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

      if (refData.isFailed && hasClaimProvenance && snippet) {
        evidenceByUrl.set(url, {
          referenceContentId: refData.referenceContentId,
          url,
          title: refData.title,
          stance: "nuance",
          why:
            "Search result snippet matched this claim, but the source scrape failed. Rescrape the source to verify the document-level match.",
          quote: snippet,
          claims: [...refData.claimIndices],
          quality: refData.quality || 0.25,
          cleanText: "",
          scrapeStatus: "snippet_only",
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

  return {
    aiReferences,
    failedCandidates, // For UI to display as "scrape manually" options
    claimConfidenceMap, // Map of claimIndex → confidence for persistAIResults
    ...(bearingConfig.enableBearingPacket ? { evidencePackets } : {}),
  };
}
