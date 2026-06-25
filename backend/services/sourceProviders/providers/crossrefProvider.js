// backend/services/sourceProviders/providers/crossrefProvider.js
// Crossref REST API — DOI/ISSN/journal publisher provenance.

const API = "https://api.crossref.org";
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

function resultFromWork(work, { domain, doi, query }) {
  const message = work?.message || work || {};
  const title = Array.isArray(message.title) ? message.title[0] : message.title;
  const container = Array.isArray(message["container-title"]) ? message["container-title"][0] : message["container-title"];
  const publisher = message.publisher || null;
  const issn = Array.isArray(message.ISSN) ? message.ISSN : [];
  return {
    providerName: "crossref",
    ok: true,
    matchFound: true,
    confidence: doi ? "high" : "medium",
    normalized: {
      domain,
      doi: message.DOI || doi || null,
      doiMatched: Boolean(message.DOI || doi),
      issn,
      issnMatched: issn.length > 0,
      workMatched: true,
      sourceMatched: Boolean(container),
      workTitle: title || query || null,
      sourceName: container || null,
      publisherName: publisher,
      externalUrl: message.URL || (message.DOI ? `https://doi.org/${message.DOI}` : null),
      externalId: message.DOI ? `doi:${message.DOI}` : null,
      claimedScholarly: true,
    },
    raw: message,
    status: "ok",
  };
}

export const crossrefProvider = {
  providerName: "crossref",
  description: "Crossref REST API — DOI, ISSN, and scholarly metadata provenance",

  async healthCheck() {
    const t0 = Date.now();
    try {
      await fetchJson(`${API}/works?rows=0`);
      return { providerName: "crossref", ok: true, status: "ok", latencyMs: Date.now() - t0, checkedAt: new Date().toISOString() };
    } catch (err) {
      return { providerName: "crossref", ok: false, status: err.name === "AbortError" ? "unavailable" : "error", message: err.message, latencyMs: Date.now() - t0, checkedAt: new Date().toISOString() };
    }
  },

  async lookupPublisher({ domain, publisherName, sourceUrl, title, articleText, issn } = {}) {
    const t0 = Date.now();
    const dom = normalizeDomain(domain || sourceUrl || "");
    const haystack = `${sourceUrl || ""} ${title || ""} ${articleText || ""} ${publisherName || ""}`;
    const doi = extractDoi(haystack);
    const issns = extractIssns(issn, haystack);
    const query = title || publisherName;

    try {
      if (doi) {
        const work = await fetchJson(`${API}/works/${encodeURIComponent(doi)}`);
        return { ...resultFromWork(work, { domain: dom, doi, query }), latencyMs: Date.now() - t0 };
      }
      for (const candidateIssn of issns) {
        const journal = await fetchJson(`${API}/journals/${encodeURIComponent(candidateIssn)}`);
        const msg = journal?.message || {};
        if (msg?.ISSN || msg?.title || msg?.publisher) {
          return {
            providerName: "crossref",
            ok: true,
            matchFound: true,
            confidence: "high",
            normalized: {
              domain: dom,
              issn: msg.ISSN || [candidateIssn],
              issnMatched: true,
              sourceMatched: true,
              sourceName: msg.title || publisherName || null,
              publisherName: msg.publisher || null,
              externalUrl: msg.URL || `${API}/journals/${candidateIssn}`,
              externalId: `issn:${candidateIssn}`,
              claimedScholarly: true,
            },
            raw: msg,
            status: "ok",
            latencyMs: Date.now() - t0,
          };
        }
      }
      if (!query || !hasScholarlyContext(haystack)) {
        return { providerName: "crossref", ok: true, matchFound: false, status: "no_match", latencyMs: Date.now() - t0 };
      }
      const data = await fetchJson(`${API}/works?rows=1&query.bibliographic=${encodeURIComponent(query)}`);
      const item = data?.message?.items?.[0];
      if (!item) return { providerName: "crossref", ok: true, matchFound: false, status: "no_match", latencyMs: Date.now() - t0 };
      return { ...resultFromWork({ message: item }, { domain: dom, doi: null, query }), confidence: "low", latencyMs: Date.now() - t0 };
    } catch (err) {
      return { providerName: "crossref", ok: false, matchFound: false, status: err.name === "AbortError" ? "unavailable" : "error", errorMessage: err.message, latencyMs: Date.now() - t0 };
    }
  },

  async lookupClaim() {
    return { providerName: "crossref", ok: false, matchFound: false, status: "not_implemented", errorMessage: "Crossref does not provide claim fact checks", latencyMs: 0 };
  },

  normalizeResponse(raw) { return raw; },
};
