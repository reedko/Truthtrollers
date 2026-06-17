// backend/services/sourceProviders/providers/waybackProvider.js
// Wayback Machine / Internet Archive — check if URL is archived, get original URL.
// Public API — no API key required.

const CDX_API = "https://archive.org/wayback/available";
const TIMEOUT_MS = 8000;

async function fetchWithTimeout(url, ms = TIMEOUT_MS) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { "User-Agent": "VeraStrata/1.0" },
    });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

export const waybackProvider = {
  providerName: "wayback",
  description: "Wayback Machine / Internet Archive — archive availability check",

  async healthCheck() {
    const t0 = Date.now();
    try {
      const res = await fetchWithTimeout(`${CDX_API}?url=reuters.com`);
      return { providerName: "wayback", ok: res.ok, status: res.ok ? "ok" : "unavailable", message: res.ok ? "Wayback API reachable" : `HTTP ${res.status}`, latencyMs: Date.now() - t0, checkedAt: new Date().toISOString() };
    } catch (err) {
      return { providerName: "wayback", ok: false, status: err.name === "AbortError" ? "unavailable" : "error", message: err.message, latencyMs: Date.now() - t0, checkedAt: new Date().toISOString() };
    }
  },

  async lookupPublisher({ sourceUrl, domain } = {}) {
    const t0 = Date.now();
    const url = sourceUrl || (domain ? `https://${domain}` : null);
    if (!url) return { providerName: "wayback", ok: false, matchFound: false, status: "no_match", errorMessage: "No URL provided", latencyMs: 0 };

    try {
      const res = await fetchWithTimeout(`${CDX_API}?url=${encodeURIComponent(url)}`);
      if (!res.ok) return { providerName: "wayback", ok: false, matchFound: false, status: "unexpected_response", errorMessage: `HTTP ${res.status}`, latencyMs: Date.now() - t0 };

      const data = await res.json();
      const snap = data?.archived_snapshots?.closest;

      if (!snap?.available) {
        return { providerName: "wayback", ok: true, matchFound: false, status: "no_match", notArchived: true, latencyMs: Date.now() - t0 };
      }

      return {
        providerName: "wayback",
        ok: true,
        matchFound: true,
        confidence: "high",
        normalized: {
          publisherName: null,
          domain: domain ?? null,
          archiveUrl: snap.url ?? null,
          archiveTimestamp: snap.timestamp ?? null,
          isArchived: true,
          originalUrl: url,
          bias: null,
          reliability: null,
          sourceType: null,
          description: null,
          externalUrl: snap.url,
          externalId: `wayback:${snap.timestamp}:${url}`,
        },
        raw: data,
        status: "ok",
        latencyMs: Date.now() - t0,
      };
    } catch (err) {
      return { providerName: "wayback", ok: false, matchFound: false, status: err.name === "AbortError" ? "unavailable" : "error", errorMessage: err.message, latencyMs: Date.now() - t0 };
    }
  },

  async lookupClaim() {
    return { providerName: "wayback", ok: false, matchFound: false, status: "not_implemented", errorMessage: "Wayback does not provide claim lookups", latencyMs: 0 };
  },

  normalizeResponse(raw) { return raw; },
};
