// backend/services/sourceProviders/providers/diffbotProvider.js
// Diffbot Article/Entity API — article extraction and organization lookup.
// Requires: DIFFBOT_TOKEN env var.
// Currently a stub — returns missing_config until licensed.

const TIMEOUT_MS = 10000;

function getToken() { return process.env.DIFFBOT_TOKEN; }

export const diffbotProvider = {
  providerName: "diffbot",
  description: "Diffbot Article/Entity API — structured article + org extraction",

  async healthCheck() {
    const t0 = Date.now();
    const token = getToken();
    if (!token) {
      return { providerName: "diffbot", ok: false, status: "missing_config", message: "DIFFBOT_TOKEN not set", latencyMs: Date.now() - t0, checkedAt: new Date().toISOString() };
    }
    try {
      const url = `https://api.diffbot.com/v3/article?url=${encodeURIComponent("https://www.reuters.com")}&token=${token}&timeout=5000`;
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
      const res = await fetch(url, { signal: ctrl.signal });
      clearTimeout(timer);
      if (res.status === 401) return { providerName: "diffbot", ok: false, status: "bad_credentials", message: "Token rejected (401)", latencyMs: Date.now() - t0, checkedAt: new Date().toISOString() };
      if (res.status === 429) return { providerName: "diffbot", ok: false, status: "rate_limited", message: "Rate limited", latencyMs: Date.now() - t0, checkedAt: new Date().toISOString() };
      return { providerName: "diffbot", ok: res.ok, status: res.ok ? "ok" : "unexpected_response", message: res.ok ? "Diffbot API reachable" : `HTTP ${res.status}`, latencyMs: Date.now() - t0, checkedAt: new Date().toISOString() };
    } catch (err) {
      return { providerName: "diffbot", ok: false, status: err.name === "AbortError" ? "unavailable" : "error", message: err.message, latencyMs: Date.now() - t0, checkedAt: new Date().toISOString() };
    }
  },

  async lookupPublisher({ sourceUrl } = {}) {
    const t0 = Date.now();
    const token = getToken();
    if (!token) return { providerName: "diffbot", ok: false, matchFound: false, status: "missing_config", errorMessage: "DIFFBOT_TOKEN not set", latencyMs: 0 };
    if (!sourceUrl) return { providerName: "diffbot", ok: false, matchFound: false, status: "no_match", errorMessage: "No URL provided", latencyMs: 0 };

    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
      const url = `https://api.diffbot.com/v3/article?url=${encodeURIComponent(sourceUrl)}&token=${token}&fields=publisher,author,title,date`;
      const res = await fetch(url, { signal: ctrl.signal });
      clearTimeout(timer);
      if (!res.ok) return { providerName: "diffbot", ok: false, matchFound: false, status: "unexpected_response", errorMessage: `HTTP ${res.status}`, latencyMs: Date.now() - t0 };

      const data = await res.json();
      const article = data?.objects?.[0];
      if (!article) return { providerName: "diffbot", ok: true, matchFound: false, status: "no_match", latencyMs: Date.now() - t0 };

      return {
        providerName: "diffbot",
        ok: true,
        matchFound: true,
        confidence: "medium",
        normalized: {
          publisherName: article.publisher?.name ?? article.siteName ?? null,
          domain: null,
          bias: null,
          reliability: null,
          sourceType: null,
          description: null,
          externalUrl: null,
          externalId: null,
        },
        raw: article,
        status: "ok",
        latencyMs: Date.now() - t0,
      };
    } catch (err) {
      return { providerName: "diffbot", ok: false, matchFound: false, status: err.name === "AbortError" ? "unavailable" : "error", errorMessage: err.message, latencyMs: Date.now() - t0 };
    }
  },

  async lookupClaim() {
    return { providerName: "diffbot", ok: false, matchFound: false, status: "not_implemented", errorMessage: "Diffbot claim lookup not implemented", latencyMs: 0 };
  },

  normalizeResponse(raw) { return raw; },
};
