// backend/routes/analyzeContent.js

import { analyzeContentPipeline } from "../core/aiPipeline.js";
import { openAiLLM } from "../core/openAiLLM.js";
import { tavilySearch } from "../core/tavilySearch.js";

/**
 * Simple fetcher for EvidenceEngine: uses cand.text if present,
 * otherwise fetches the URL.
 */
const httpFetcher = {
  async getText(cand) {
    if (cand.text && typeof cand.text === "string") {
      return cand.text;
    }
    if (!cand.url) return null;

    try {
      const resp = await fetch(cand.url);
      const html = await resp.text();
      // truncate to keep prompts reasonable
      return html.slice(0, 50000);
    } catch (err) {
      console.warn(
        "[/api/analyze-content] Failed to fetch candidate URL:",
        cand.url,
        err
      );
      return null;
    }
  },
};

/**
 * Minimal storage adapter for now – logs rows and does nothing.
 */
const noopStorage = {
  async persistResults(results) {
    console.log(
      "[/api/analyze-content] persistResults noop; rows:",
      Array.isArray(results) ? results.length : 0
    );
  },
};

export function registerAnalyzeContentRoute(app) {
  app.post("/api/analyze-content", async (req, res) => {
    try {
      const { content, testimonials, options } = req.body || {};

      if (!content || !content.trim()) {
        return res
          .status(400)
          .json({ error: "Missing 'content' in request body." });
      }

      const includeEvidence = !!options?.includeEvidence;

      // Base deps: always have LLM for claims extraction
      const deps = {
        llm: openAiLLM,
      };

      // Only attach search/fetcher/storage if evidence is requested
      // AND we actually have Tavily configured.
      if (includeEvidence && tavilySearch) {
        deps.search = tavilySearch;
        deps.fetcher = httpFetcher;
        deps.storage = noopStorage;
      } else if (includeEvidence && !tavilySearch) {
        console.warn(
          "[/api/analyze-content] includeEvidence=true but TAVILY_API_KEY is missing; running claims-only."
        );
      }

      const result = await analyzeContentPipeline({
        content,
        testimonials: testimonials || [],
        includeEvidence: includeEvidence && !!tavilySearch,
        deps,
        cfg: {
          limits: {
            queriesPerClaim: 3, // from 6,
            candidates: 6, // from 12,
            evidencePerDoc: 1, // from 2,
            concurrency: 3,
          },
          maxEvidenceCandidates: 2, // ⬅️ NEW: only run extractEvidence on top 2 URLs
          enableRedTeam: false,
          preferDomains: [],
          avoidDomains: [],
          maxCharsPerDoc: 8000,
        },
      });

      // Note: analyzeContentPipeline already returns the shape we want
      // { generalTopic, specificTopics, claims, testimonials, claimSourcePicks, evidenceRefs }
      res.json({
        success: true,
        data: result,
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
