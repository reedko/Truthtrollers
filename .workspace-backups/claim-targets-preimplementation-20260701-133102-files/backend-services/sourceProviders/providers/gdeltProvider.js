// backend/services/sourceProviders/providers/gdeltProvider.js
// GDELT DOC 2.1 — public independent footprint/context lookup.

const GDELT_DOC_API = "https://api.gdeltproject.org/api/v2/doc/doc";
const TIMEOUT_MS = 10000;

function normalizeDomain(url) {
  try { return new URL(url.startsWith("http") ? url : `https://${url}`).hostname.replace(/^www\./, ""); }
  catch { return String(url || "").toLowerCase().replace(/^www\./, ""); }
}

async function fetchJson(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { "Accept": "application/json", "User-Agent": "VeraStrata/1.0" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  } finally {
    clearTimeout(timer);
  }
}

function isSelfMention(article, domain) {
  const url = String(article?.url || "").toLowerCase();
  const sourceDomain = String(article?.domain || article?.sourceCountry || "").toLowerCase();
  return domain && (url.includes(domain) || sourceDomain.includes(domain));
}

export const gdeltProvider = {
  providerName: "gdelt",
  description: "GDELT DOC API — independent media/entity footprint",

  async healthCheck() {
    const t0 = Date.now();
    try {
      await fetchJson(`${GDELT_DOC_API}?query=${encodeURIComponent("Reuters")}&mode=ArtList&format=json&maxrecords=1`);
      return { providerName: "gdelt", ok: true, status: "ok", latencyMs: Date.now() - t0, checkedAt: new Date().toISOString() };
    } catch (err) {
      return { providerName: "gdelt", ok: false, status: err.name === "AbortError" ? "unavailable" : "error", message: err.message, latencyMs: Date.now() - t0, checkedAt: new Date().toISOString() };
    }
  },

  async lookupPublisher({ domain, publisherName, sourceUrl } = {}) {
    const t0 = Date.now();
    const dom = normalizeDomain(domain || sourceUrl || "");
    const query = publisherName || dom;
    if (!query) return { providerName: "gdelt", ok: false, matchFound: false, status: "no_match", errorMessage: "No publisher name or domain", latencyMs: 0 };

    try {
      const url = `${GDELT_DOC_API}?query=${encodeURIComponent(`"${query}"`)}&mode=ArtList&format=json&maxrecords=25&sort=hybridrel`;
      const data = await fetchJson(url);
      const articles = Array.isArray(data?.articles) ? data.articles : [];
      const independent = articles.filter((article) => !isSelfMention(article, dom));
      const domains = [...new Set(independent.map((article) => {
        try { return new URL(article.url).hostname.replace(/^www\./, ""); }
        catch { return null; }
      }).filter(Boolean))];

      if (!articles.length) {
        return {
          providerName: "gdelt",
          ok: true,
          matchFound: false,
          status: "no_match",
          normalized: { domain: dom, publisherName, mentionCount: 0, independentMentionCount: 0 },
          raw: data,
          latencyMs: Date.now() - t0,
        };
      }

      return {
        providerName: "gdelt",
        ok: true,
        matchFound: true,
        confidence: independent.length >= 5 ? "high" : independent.length >= 1 ? "medium" : "low",
        normalized: {
          domain: dom,
          publisherName,
          mentionCount: articles.length,
          independentMentionCount: independent.length,
          independentDomains: domains.slice(0, 10),
          externalUrl: url,
          externalId: `gdelt:${query}`,
        },
        raw: { ...data, articles: articles.slice(0, 10) },
        status: "ok",
        latencyMs: Date.now() - t0,
      };
    } catch (err) {
      return { providerName: "gdelt", ok: false, matchFound: false, status: err.name === "AbortError" ? "unavailable" : "error", errorMessage: err.message, latencyMs: Date.now() - t0 };
    }
  },

  async lookupClaim() {
    return { providerName: "gdelt", ok: false, matchFound: false, status: "not_implemented", errorMessage: "GDELT provider is used for entity footprint, not claim scoring", latencyMs: 0 };
  },

  normalizeResponse(raw) { return raw; },
};
