// backend/core/tavilySearch.js

import dotenv from "dotenv";

dotenv.config();

const TAVILY_ENDPOINT = "https://api.tavily.com/search";

const TAVILY_API_KEY = process.env.TAVILY_API_KEY || "";

if (!TAVILY_API_KEY) {
  console.warn(
    "[tavilySearch] TAVILY_API_KEY is not set. EvidenceEngine web search will be disabled."
  );
}

/**
 * Search adapter compatible with EvidenceEngine:
 *   - search.internal({ query, topK })
 *   - search.web({ query, topK, prefer, avoid })
 *
 * If TAVILY_API_KEY is missing, tavilySearch will be null and callers
 * should treat that as "no web search available".
 */
function createTavilyAdapter(apiKey) {
  const internal = async () => {
    // No internal DB search yet
    return [];
  };

  const web = async ({ query, topK = 10, prefer = [], avoid = [] }) => {
    if (!query || !query.trim()) return [];

    const body = {
      api_key: apiKey,
      query,
      max_results: topK,
      search_depth: "basic",
    };

    if (Array.isArray(prefer) && prefer.length) {
      body.include_domains = prefer;
    }
    if (Array.isArray(avoid) && avoid.length) {
      body.exclude_domains = avoid;
    }

    try {
      const resp = await fetch(TAVILY_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!resp.ok) {
        console.warn(
          "[tavilySearch] HTTP error from Tavily:",
          resp.status,
          resp.statusText
        );
        return [];
      }

      const data = await resp.json();
      const results = Array.isArray(data.results) ? data.results : [];

      return results.map((r, idx) => {
        let domain = null;
        try {
          domain = r.url ? new URL(r.url).hostname : null;
        } catch {
          domain = null;
        }

        return {
          id: r.id || r.url || `tavily:${idx}`,
          url: r.url,
          title: r.title,
          snippet: r.content || r.snippet || "",
          domain,
          publishedAt: r.published_date || null,
          score: typeof r.score === "number" ? r.score : 1 / (idx + 1), // crude fallback
          source: "web_search",
        };
      });
    } catch (err) {
      console.warn("[tavilySearch] Error calling Tavily:", err);
      return [];
    }
  };

  return { internal, web };
}

export const tavilySearch = TAVILY_API_KEY
  ? createTavilyAdapter(TAVILY_API_KEY)
  : null;
