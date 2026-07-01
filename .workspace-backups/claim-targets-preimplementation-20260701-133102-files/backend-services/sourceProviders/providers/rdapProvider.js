// backend/services/sourceProviders/providers/rdapProvider.js
// RDAP domain registration lookup. Uses rdap.org as a bootstrap-friendly gateway.

const RDAP_BASE = "https://rdap.org/domain/";
const TIMEOUT_MS = 8000;

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
      headers: { "Accept": "application/rdap+json, application/json", "User-Agent": "VeraStrata/1.0" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  } finally {
    clearTimeout(timer);
  }
}

function eventDate(data, action) {
  return (data?.events || []).find((event) => event.eventAction === action)?.eventDate || null;
}

function yearsSince(dateValue) {
  if (!dateValue) return null;
  const t = new Date(dateValue).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.max(0, (Date.now() - t) / 31557600000);
}

export const rdapProvider = {
  providerName: "rdap",
  description: "RDAP domain registration provenance lookup",

  async healthCheck() {
    const t0 = Date.now();
    try {
      await fetchJson(`${RDAP_BASE}example.com`);
      return { providerName: "rdap", ok: true, status: "ok", latencyMs: Date.now() - t0, checkedAt: new Date().toISOString() };
    } catch (err) {
      return { providerName: "rdap", ok: false, status: err.name === "AbortError" ? "unavailable" : "error", message: err.message, latencyMs: Date.now() - t0, checkedAt: new Date().toISOString() };
    }
  },

  async lookupPublisher({ domain, sourceUrl } = {}) {
    const t0 = Date.now();
    const dom = normalizeDomain(domain || sourceUrl || "");
    if (!dom) return { providerName: "rdap", ok: false, matchFound: false, status: "no_match", errorMessage: "No domain provided", latencyMs: 0 };

    try {
      const data = await fetchJson(`${RDAP_BASE}${encodeURIComponent(dom)}`);
      const created = eventDate(data, "registration") || eventDate(data, "created");
      const updated = eventDate(data, "last changed") || eventDate(data, "last update of RDAP database");
      const registrar = (data?.entities || []).find((entity) => (entity.roles || []).includes("registrar"))?.vcardArray?.[1]
        ?.find((row) => row?.[0] === "fn")?.[3] || null;
      const domainAgeYears = yearsSince(created);

      return {
        providerName: "rdap",
        ok: true,
        matchFound: true,
        confidence: created ? "high" : "medium",
        normalized: {
          domain: dom,
          created,
          updated,
          registrar,
          domainAgeYears,
          statuses: data?.status || [],
          externalUrl: `${RDAP_BASE}${dom}`,
          externalId: `rdap:${dom}`,
        },
        raw: data,
        status: "ok",
        latencyMs: Date.now() - t0,
      };
    } catch (err) {
      return { providerName: "rdap", ok: false, matchFound: false, status: err.name === "AbortError" ? "unavailable" : "error", errorMessage: err.message, latencyMs: Date.now() - t0 };
    }
  },

  async lookupClaim() {
    return { providerName: "rdap", ok: false, matchFound: false, status: "not_implemented", errorMessage: "RDAP does not provide claim lookups", latencyMs: 0 };
  },

  normalizeResponse(raw) { return raw; },
};
