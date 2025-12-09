// backend/src/core/bingSearch.js
import fetch from "node-fetch";

const BING_API_KEY = process.env.BING_SEARCH_KEY;
const ENDPOINT = "https://api.bing.microsoft.com/v7.0/search";

if (!BING_API_KEY) {
  console.warn("⚠️  Missing BING_SEARCH_KEY in environment variables");
}

/**
 * Perform Bing Web Search, normalize to Tavily-style format
 */
export async function bingSearch({ query, topK = 5, prefer = [], avoid = [] }) {
  if (!BING_API_KEY) return [];

  try {
    const url = `${ENDPOINT}?q=${encodeURIComponent(query)}&count=${topK}`;

    const resp = await fetch(url, {
      headers: {
        "Ocp-Apim-Subscription-Key": BING_API_KEY,
      },
    });

    if (!resp.ok) {
      console.warn("❌ Bing search failed:", await resp.text());
      return [];
    }

    const data = await resp.json();
    const items = data.webPages?.value || [];

    const mapped = items.map((item) => ({
      id: item.url,
      url: item.url,
      title: item.name,
      snippet: item.snippet,
      domain: new URL(item.url).hostname,
      publishedAt: null,
      score: item.rank || item._ranking || 0.8, // fallback
      source: "bing",
    }));

    // Apply preferDomains and avoidDomains
    const filtered = mapped.filter((c) => {
      if (avoid.length && avoid.some((d) => c.domain.includes(d))) return false;
      return true;
    });

    const boosted = filtered.map((c) => {
      let score = c.score ?? 0;
      if (prefer.length && prefer.some((d) => c.domain.includes(d))) {
        score += 0.15;
      }
      return { ...c, score };
    });

    return boosted;
  } catch (err) {
    console.error("❌ Bing search error:", err);
    return [];
  }
}
