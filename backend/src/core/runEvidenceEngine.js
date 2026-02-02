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
import { EvidenceEngine } from "./evidenceEngine.js";
import { query } from "../db/pool.js";
import { createContentInternal } from "../storage/createContentInternal.js";
import { persistAuthors } from "../storage/persistAuthors.js";
import { persistPublishers } from "../storage/persistPublishers.js";
import { extractAuthors } from "../utils/extractAuthors.js";
import { extractPublisher } from "../utils/extractPublisher.js";
import { getMainHeadline } from "../utils/getMainHeadline.js";
import { getBestImage } from "../utils/getBestImage.js";
import logger from "../utils/logger.js";
import * as cheerio from "cheerio";
import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";

import fetch from "node-fetch";

export async function runEvidenceEngine({
  taskContentId,
  claimIds,
  readableText,
}) {
  logger.log("🟣 [runEvidenceEngine] Starting evidence run…");

  if (!taskContentId) throw new Error("Missing taskContentId");
  if (!Array.isArray(claimIds) || claimIds.length === 0)
    throw new Error("No claims passed to EvidenceEngine");

  // Fetch claim text from DB
  const rows = await query(
    `SELECT claim_id, claim_text FROM claims WHERE claim_id IN (?)`,
    [claimIds]
  );

  const claims = rows.map((row) => ({
    id: row.claim_id,
    text: row.claim_text,
  }));

  // Map to store processed references (URL → metadata)
  const referenceCache = new Map();

  // Track failed candidates for UI fallback (manual dashboard scrape)
  const failedCandidates = [];

  const engine = new EvidenceEngine(
    {
      llm: openAiLLM,
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

              return cached.cleanText;
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
            let title, authors, publisher, thumbnail, cleanText;

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

              authors = pdfAuthors ? [pdfAuthors] : [];
              publisher = null; // PDFs don't have publishers in same way
              thumbnail = ""; // PDFs don't have thumbnails from evidence engine
              cleanText = pdfExtractedText?.slice(0, 60000) || "";
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
              publisher = await extractPublisher($);
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
            // 6. PERSIST AUTHORS & PUBLISHERS
            // ─────────────────────────────────────────────
            await persistAuthors(query, referenceContentId, authors);
            if (publisher) {
              await persistPublishers(query, referenceContentId, publisher);
            }

            // ─────────────────────────────────────────────
            // 7. CACHE REFERENCE METADATA (including search snippet)
            // ─────────────────────────────────────────────
            // Calculate quality for this candidate
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
              claimIndices: claimIndex !== -1 ? [claimIndex] : [], // Track which claim requested this
            });

            logger.log(
              `🎯 [Evidence] Fully processed reference: ${cand.url} → content_id=${referenceContentId}`
            );

            return cleanText;
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
      limits: {
        queriesPerClaim: 4, // ← Increased from 3 to 4 for more diverse queries
        candidates: 12, // ← Try more URLs per claim
        evidencePerDoc: 2, // ← Increased from 1 to 2 to get more evidence per doc
      },
      maxParallelClaims: Infinity, // Process all claims in parallel (was 3)
      maxCharsPerDoc: 8000,
      preferDomains: [],
      avoidDomains: [],
      enableRedTeam: false,
      maxEvidenceCandidates: 2,
      maxParallelSearches: 4,
    }
  );

  // engine.run(claims, contexts, opt)
  // contexts can be null/undefined if not needed
  const runOptions = {
    enableInternal: true,
    enableWeb: true,
    topKQueries: 6,
    searchEngine: "hybrid",
    topKCandidates: 12,
    maxEvidencePerDoc: 2,
    preferDomains: [],
    avoidDomains: [],
    maxCharsPerDoc: 8000,
    enableRedTeam: false,
    maxEvidenceCandidates: 4, // ← Increased from 2 to 4 references per claim
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

  for (let claimIndex = 0; claimIndex < results.length; claimIndex++) {
    const claimResult = results[claimIndex];
    const evidenceItems = claimResult.evidence || [];

    for (const ev of evidenceItems) {
      if (!ev.url) continue;

      // Get reference metadata from cache
      const refData = referenceCache.get(ev.url);
      if (!refData) {
        logger.warn(`⚠️  [Evidence] No cached data for ${ev.url}, skipping`);
        continue;
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
  // Add ALL cached references (even if LLM found no evidence)
  // We still want to extract claims from them OR save search snippets
  // ─────────────────────────────────────────────
  for (const [url, refData] of referenceCache.entries()) {
    if (!evidenceByUrl.has(url)) {
      if (refData.isFailed) {
        // Failed reference - analyze search snippet with LLM to get stance
        let snippetStance = "insufficient";
        let snippetRationale = "Failed to scrape - using search snippet";

        if (refData.snippet && refData.claimIndices && refData.claimIndices.length > 0) {
          // Get the first claim this reference was matched to
          const firstClaimIndex = refData.claimIndices[0];
          const claim = claims[firstClaimIndex];

          if (claim) {
            try {
              // Analyze snippet with LLM
              const snippetAnalysis = await openAiLLM.generate({
                system: "You analyze search snippets to determine if they support, refute, or add nuance to a claim.",
                user: `Claim: ${claim.text}\n\nSource: ${refData.title}\nSnippet: ${refData.snippet}\n\nDoes this snippet support, refute, or add nuance to the claim?`,
                schemaHint: '{"stance":"support|refute|nuance|insufficient","summary":"brief explanation"}',
                temperature: 0.1,
              });

              if (snippetAnalysis?.stance) {
                snippetStance = snippetAnalysis.stance;
                snippetRationale = snippetAnalysis.summary || "Analysis based on search snippet";
              }
            } catch (err) {
              logger.warn(`⚠️  [Evidence] Failed to analyze snippet for ${url}:`, err.message);
            }
          }
        }

        evidenceByUrl.set(url, {
          referenceContentId: refData.referenceContentId,
          url,
          title: refData.title,
          stance: snippetStance,
          why: snippetRationale,
          quote: refData.snippet || null, // Use search engine snippet
          claims: [...(refData.claimIndices || [])], // COPY array to avoid mutation
          quality: refData.quality || 0, // Use cached quality
          cleanText: "", // No text - failed
          scrapeStatus: "snippet_only", // Mark as snippet-only scrape
        });
        logger.log(
          `⚠️  [Evidence] Adding failed reference with analyzed snippet (stance: ${snippetStance}): ${url}`
        );
      } else if (refData.cleanText) {
        // Reference was fetched but LLM found no evidence - use search snippet as fallback
        evidenceByUrl.set(url, {
          referenceContentId: refData.referenceContentId,
          url,
          title: refData.title,
          stance: "insufficient", // No evidence found
          why: "No relevant evidence extracted by LLM - using search snippet",
          quote: refData.snippet || null, // Use search snippet as fallback
          claims: [...(refData.claimIndices || [])], // COPY array to avoid mutation
          quality: refData.quality || 0, // Use cached quality
          cleanText: refData.cleanText,
          scrapeStatus: "full", // Was fully scraped, just no evidence found
        });
        logger.log(
          `📝 [Evidence] Adding reference with no LLM evidence, using snippet for claim extraction: ${url} (claims: ${refData.claimIndices})`
        );
      }
    }
  }

  // Convert to array
  const aiReferences = Array.from(evidenceByUrl.values());

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
  };
}
