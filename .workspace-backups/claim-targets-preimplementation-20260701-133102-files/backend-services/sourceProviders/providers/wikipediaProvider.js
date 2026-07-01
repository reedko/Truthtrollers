// backend/services/sourceProviders/providers/wikipediaProvider.js
// Uses the public MediaWiki API — no API key required.

const WIKI_API = "https://en.wikipedia.org/w/api.php";
const TIMEOUT_MS = 8000;

async function fetchWithTimeout(url, ms = TIMEOUT_MS) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { "User-Agent": "VeraStrata/1.0 (source-evaluation; contact@verastrata.com)" },
    });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

async function searchWikipedia(query) {
  const url = `${WIKI_API}?action=query&list=search&srsearch=${encodeURIComponent(query)}&srlimit=3&format=json&origin=*`;
  const res = await fetchWithTimeout(url);
  if (!res.ok) throw new Error(`Wikipedia search HTTP ${res.status}`);
  return res.json();
}

async function getWikipediaSummary(title) {
  const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;
  const res = await fetchWithTimeout(url);
  if (!res.ok) return null;
  return res.json();
}

function normalizeDomain(url) {
  try { return new URL(url.startsWith("http") ? url : `https://${url}`).hostname.replace(/^www\./, ""); }
  catch { return url?.toLowerCase()?.replace(/^www\./, ""); }
}

export const wikipediaProvider = {
  providerName: "wikipedia",
  description: "Wikipedia MediaWiki API — publisher identity and description",

  async healthCheck() {
    const t0 = Date.now();
    try {
      const res = await fetchWithTimeout(`${WIKI_API}?action=query&format=json&titles=Reuters&origin=*`);
      if (!res.ok) return { providerName: "wikipedia", ok: false, status: "unavailable", message: `HTTP ${res.status}`, latencyMs: Date.now() - t0, checkedAt: new Date().toISOString() };
      return { providerName: "wikipedia", ok: true, status: "ok", message: "Wikipedia API reachable", latencyMs: Date.now() - t0, checkedAt: new Date().toISOString() };
    } catch (err) {
      return { providerName: "wikipedia", ok: false, status: err.name === "AbortError" ? "unavailable" : "error", message: err.message, latencyMs: Date.now() - t0, checkedAt: new Date().toISOString() };
    }
  },

  async lookupPublisher({ domain, publisherName, sourceUrl }) {
    const t0 = Date.now();
    const query = publisherName || normalizeDomain(sourceUrl || domain || "") || domain;
    if (!query) return { providerName: "wikipedia", ok: false, matchFound: false, status: "no_match", errorMessage: "No query terms", latencyMs: 0 };

    try {
      const searchData = await searchWikipedia(query);
      const hits = searchData?.query?.search ?? [];
      if (!hits.length) return { providerName: "wikipedia", ok: true, matchFound: false, status: "no_match", latencyMs: Date.now() - t0 };

      const best = hits[0];
      const summary = await getWikipediaSummary(best.title);

      const normalized = {
        publisherName: summary?.title ?? best.title,
        domain: domain ?? normalizeDomain(sourceUrl || ""),
        description: summary?.extract ?? best.snippet?.replace(/<[^>]+>/g, "") ?? "",
        externalUrl: summary?.content_urls?.desktop?.page ?? `https://en.wikipedia.org/wiki/${encodeURIComponent(best.title)}`,
        externalId: `wikipedia:${best.pageid}`,
        sourceType: classifyFromWikipedia(summary?.extract ?? ""),
        reliability: null,
        bias: null,
      };

      return {
        providerName: "wikipedia",
        ok: true,
        matchFound: true,
        confidence: hits[0].snippet?.toLowerCase().includes(query.toLowerCase()) ? "high" : "medium",
        normalized,
        raw: { searchHit: best, summary },
        status: "ok",
        latencyMs: Date.now() - t0,
      };
    } catch (err) {
      return { providerName: "wikipedia", ok: false, matchFound: false, status: err.name === "AbortError" ? "unavailable" : "error", errorMessage: err.message, latencyMs: Date.now() - t0 };
    }
  },

  async lookupClaim() {
    return { providerName: "wikipedia", ok: false, matchFound: false, status: "not_implemented", errorMessage: "Wikipedia does not provide claim fact-check lookups", latencyMs: 0 };
  },

  normalizeResponse(raw) { return raw; },
};

function classifyFromWikipedia(text = "") {
  const t = text.toLowerCase();
  if (/government|ministry|department|federal|parliament|congress|senate/i.test(t)) return "government";
  if (/academic|university|research\s+institute|scientific\s+journal|peer.?reviewed/i.test(t)) return "academic";
  if (/newspaper|news\s+agency|television\s+network|broadcaster|media\s+company|journalism/i.test(t)) return "journalism";
  if (/think\s+tank|advocacy|lobbying|non-?profit|ngo|501\(c\)/i.test(t)) return "advocacy";
  if (/encyclopedia|reference|library/i.test(t)) return "reference";
  return null;
}
