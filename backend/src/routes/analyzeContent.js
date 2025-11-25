// backend/routes/analyzeContent.js

import { analyzeContentPipeline } from "../core/aiPipeline.js";
import { openAiLLM } from "../core/openAiLLM.js";
import { tavilySearch } from "../core/tavilySearch.js";

import { insertReferenceClaimLink } from "../queries/referenceClaimLinks.js";
import {
  lookupClaimIdFromText,
  lookupReferenceIdFromUrl,
} from "../queries/referenceLookups.js";

/**
 * Registers POST /api/analyze-content
 */
export function registerAnalyzeContentRoute(app, query) {
  app.post("/api/analyze-content", async (req, res) => {
    try {
      const { content, testimonials, options } = req.body || {};
      const includeEvidence = !!options?.includeEvidence;

      if (!content || !content.trim()) {
        return res.status(400).json({ error: "Missing 'content'." });
      }

      // -------------------------------------------------------
      // Configure dependencies for pipeline
      // -------------------------------------------------------
      const deps = { llm: openAiLLM };

      if (includeEvidence && tavilySearch) {
        deps.search = tavilySearch;

        deps.fetcher = {
          async getText(cand) {
            try {
              if (cand.text) return cand.text;
              if (!cand.url) return null;
              const resp = await fetch(cand.url);
              const text = await resp.text();
              return text.slice(0, 50000);
            } catch (err) {
              console.warn("[fetcher] Failed:", cand.url, err);
              return null;
            }
          },
        };

        deps.storage = {
          async persistResults(rows) {
            console.log(
              "[analyze-content] persistResults noop; rows:",
              Array.isArray(rows) ? rows.length : 0
            );
          },
        };
      }

      // -------------------------------------------------------
      // RUN PIPELINE
      // -------------------------------------------------------
      const result = await analyzeContentPipeline({
        content,
        testimonials: testimonials || [],
        includeEvidence,
        deps,
        cfg: {
          limits: {
            queriesPerClaim: 3, // old 6
            candidates: 6, // old 12
            evidencePerDoc: 1, // old 2
            concurrency: 3,
          },
          maxEvidenceCandidates: 2,
          enableRedTeam: false,
          preferDomains: [],
          avoidDomains: [],
          maxCharsPerDoc: 8000,
          maxParallelClaims: 3,
          evidenceTimeoutMs: 50000,
        },
      });

      // -------------------------------------------------------
      // INSERT REFERENCE → CLAIM LINKS
      // -------------------------------------------------------
      const referenceLinks = result.referenceClaimLinks || [];
      const insertedIds = [];

      for (const link of referenceLinks) {
        // Resolve claim_id
        const claim_id = await lookupClaimIdFromText(query, link.claim_text);
        if (!claim_id) {
          console.warn("[analyze-content] No matching claim:", link.claim_text);
          continue;
        }

        // Resolve reference content_id
        const reference_content_id = await lookupReferenceIdFromUrl(
          query,
          link.reference_url
        );
        if (!reference_content_id) {
          console.warn(
            "[analyze-content] No matching reference:",
            link.reference_url
          );
          continue;
        }

        // Insert row into DB
        const id = await insertReferenceClaimLink(query, {
          claim_id,
          reference_content_id,
          stance: link.stance,
          score: link.score,
          rationale: link.rationale,
          evidence_text: link.evidence_text,
          created_by_ai: 1,
        });

        if (id) insertedIds.push(id);
      }

      // -------------------------------------------------------
      // RESPOND
      // -------------------------------------------------------
      res.json({
        success: true,
        data: result,
        inserted_reference_links: insertedIds.length,
      });
    } catch (err) {
      console.error("Error in /api/analyze-content:", err);
      res.status(500).json({
        error: "Failed to analyze content.",
        details: err?.message || String(err),
      });
    }
  });
}
