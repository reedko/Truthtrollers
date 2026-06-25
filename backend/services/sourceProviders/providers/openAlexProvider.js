// backend/services/sourceProviders/providers/openAlexProvider.js
// OpenAlex scholarly works/sources/institutions provenance lookup.

const API = "https://api.openalex.org";
const TIMEOUT_MS = 10000;

function normalizeDomain(url) {
  try { return new URL(url.startsWith("http") ? url : `https://${url}`).hostname.replace(/^www\./, ""); }
  catch { return String(url || "").toLowerCase().replace(/^www\./, ""); }
}

function extractDoi(text = "") {
  return String(text || "").match(/\b10\.\d{4,9}\/[-._;()/:A-Z0-9]+\b/i)?.[0]?.replace(/[).,;]+$/, "") || null;
}

function normalizeIssn(value = "") {
  const compact = String(value || "").toUpperCase().replace(/[^0-9X]/g, "");
  if (!/^\d{7}[\dX]$/.test(compact)) return null;
  return `${compact.slice(0, 4)}-${compact.slice(4)}`;
}

function extractIssns(...values) {
  const found = new Set();
  for (const value of values) {
    const text = String(value || "");
    const candidates = [
      ...text.matchAll(/\b\d{4}-\d{3}[\dX]\b/gi),
      ...text.matchAll(/\b\d{7}[\dX]\b/gi),
    ];
    for (const match of candidates) {
      const issn = normalizeIssn(match[0]);
      if (issn) found.add(issn);
    }
  }
  return [...found];
}

function hasScholarlyContext(text = "") {
  return /\b(doi|issn|journal|peer[- ]?review|scholarly|academic|article|study|paper|preprint|proceedings|volume|issue)\b/i.test(String(text || ""));
}

async function fetchJson(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { "Accept": "application/json", "User-Agent": "VeraStrata/1.0 (mailto:contact@verastrata.com)" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  } finally {
    clearTimeout(timer);
  }
}

function normalizeWork(work, domain, doi) {
  const source = work?.primary_location?.source || work?.locations?.find((l) => l.source)?.source || null;
  return {
    providerName: "openalex",
    ok: true,
    matchFound: true,
    confidence: doi ? "high" : "medium",
    normalized: {
      domain,
      doi: work?.doi?.replace(/^https:\/\/doi.org\//, "") || doi || null,
      doiMatched: Boolean(doi || work?.doi),
      workMatched: true,
      sourceMatched: Boolean(source),
      workTitle: work?.title || null,
      sourceName: source?.display_name || null,
      publisherName: source?.host_organization_name || null,
      sourceType: source?.type || null,
      issn: source?.issn || [],
      issnMatched: Array.isArray(source?.issn) && source.issn.length > 0,
      externalUrl: work?.id || null,
      externalId: work?.id || null,
      claimedScholarly: true,
    },
    raw: work,
    status: "ok",
  };
}

function normalizeSource(source, dom, publisherName, title, confidence = "medium") {
  return {
    providerName: "openalex",
    ok: true,
    matchFound: true,
    confidence,
    normalized: {
      domain: dom,
      sourceMatched: true,
      sourceName: source.display_name || publisherName,
      publisherName: source.host_organization_name || null,
      sourceType: source.type || null,
      issn: source.issn || [],
      issnMatched: Array.isArray(source.issn) && source.issn.length > 0,
      externalUrl: source.id || null,
      externalId: source.id || null,
      claimedScholarly: /journal|archive|repository|doi|issn|article/i.test(`${publisherName} ${title || ""}`),
    },
    raw: source,
    status: "ok",
  };
}

export const openAlexProvider = {
  providerName: "openalex",
  description: "OpenAlex scholarly works/sources/institutions provenance lookup",

  async healthCheck() {
    const t0 = Date.now();
    try {
      await fetchJson(`${API}/works?per-page=1`);
      return { providerName: "openalex", ok: true, status: "ok", latencyMs: Date.now() - t0, checkedAt: new Date().toISOString() };
    } catch (err) {
      return { providerName: "openalex", ok: false, status: err.name === "AbortError" ? "unavailable" : "error", message: err.message, latencyMs: Date.now() - t0, checkedAt: new Date().toISOString() };
    }
  },

  async lookupPublisher({ domain, publisherName, sourceUrl, title, articleText, issn } = {}) {
    const t0 = Date.now();
    const dom = normalizeDomain(domain || sourceUrl || "");
    const haystack = `${sourceUrl || ""} ${title || ""} ${articleText || ""} ${publisherName || ""}`;
    const doi = extractDoi(haystack);
    const issns = extractIssns(issn, haystack);

    try {
      if (doi) {
        const work = await fetchJson(`${API}/works/https://doi.org/${encodeURIComponent(doi)}`);
        return { ...normalizeWork(work, dom, doi), latencyMs: Date.now() - t0 };
      }

      for (const candidateIssn of issns) {
        const sourceData = await fetchJson(`${API}/sources?filter=issn:${encodeURIComponent(candidateIssn)}&per-page=1`);
        const source = sourceData?.results?.[0];
        if (source) {
          return {
            ...normalizeSource(source, dom, publisherName, title, "high"),
            latencyMs: Date.now() - t0,
          };
        }
      }

      if (publisherName && hasScholarlyContext(haystack)) {
        const sourceData = await fetchJson(`${API}/sources?search=${encodeURIComponent(publisherName)}&per-page=1`);
        const source = sourceData?.results?.[0];
        if (source) {
          return {
            ...normalizeSource(source, dom, publisherName, title, "medium"),
            latencyMs: Date.now() - t0,
          };
        }
      }

      return { providerName: "openalex", ok: true, matchFound: false, status: "no_match", latencyMs: Date.now() - t0 };
    } catch (err) {
      return { providerName: "openalex", ok: false, matchFound: false, status: err.name === "AbortError" ? "unavailable" : "error", errorMessage: err.message, latencyMs: Date.now() - t0 };
    }
  },

  async lookupClaim() {
    return { providerName: "openalex", ok: false, matchFound: false, status: "not_implemented", errorMessage: "OpenAlex does not provide claim fact checks", latencyMs: 0 };
  },

  normalizeResponse(raw) { return raw; },
};
