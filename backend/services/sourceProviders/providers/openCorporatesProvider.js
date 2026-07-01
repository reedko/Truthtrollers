// OpenCorporates legal-entity identity/provenance lookup.
// The provider is deliberately conservative: ambiguous name searches are not matches.

import { disabledProviderResult, publisherProviderFlags } from "../providerFeatureFlags.js";

const API = "https://api.opencorporates.com/v0.4";
const TIMEOUT_MS = 10000;
const GENERIC_TOKENS = new Set(["media", "news", "group", "foundation", "network", "press", "publishing", "publisher", "company", "organization", "organisation"]);
const CORPORATE_SUFFIXES = /\b(incorporated|inc|limited|ltd|llc|plc|corp(?:oration)?|company|co|gmbh|ag|sa|sas|bv|pty)\b/gi;

function apiKey() { return process.env.OPENCORPORATES_API_KEY?.trim(); }
function clean(value) { return String(value || "").trim(); }

export function normalizeCompanyName(value) {
  return clean(value)
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(CORPORATE_SUFFIXES, " ")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(value) { return new Set(normalizeCompanyName(value).split(" ").filter(Boolean)); }
function isGenericName(value) {
  const parts = [...tokens(value)];
  return parts.length === 0 || (parts.length <= 2 && parts.every((part) => GENERIC_TOKENS.has(part)));
}
function tokenSimilarity(a, b) {
  const aa = tokens(a); const bb = tokens(b);
  if (!aa.size || !bb.size) return 0;
  const common = [...aa].filter((part) => bb.has(part)).length;
  return (2 * common) / (aa.size + bb.size);
}

function companyAliases(company) {
  return [company?.name, company?.previous_names, company?.alternative_names]
    .flat(2)
    .map((item) => typeof item === "string" ? item : item?.company_name || item?.name)
    .filter(Boolean);
}

function scoreCompany(company, requestedName, jurisdictionHint) {
  const wanted = normalizeCompanyName(requestedName);
  let best = 0;
  let matchedName = company?.name || null;
  const reasons = [];
  for (const alias of companyAliases(company)) {
    const candidate = normalizeCompanyName(alias);
    let score = Math.round(tokenSimilarity(wanted, candidate) * 75);
    if (candidate === wanted) score = 95;
    else if (candidate.includes(wanted) || wanted.includes(candidate)) score = Math.max(score, 82);
    if (score > best) { best = score; matchedName = alias; }
  }
  if (best >= 95) reasons.push("exact normalized legal-name match");
  else if (best >= 82) reasons.push("strong legal-name match");
  else if (best > 0) reasons.push("partial name overlap");
  if (jurisdictionHint && clean(company?.jurisdiction_code).toLowerCase() === clean(jurisdictionHint).toLowerCase()) {
    best = Math.min(100, best + 5);
    reasons.push("jurisdiction match");
  } else if (jurisdictionHint && company?.jurisdiction_code) {
    best = Math.max(0, best - 10);
    reasons.push("jurisdiction differs");
  }
  return { company, score: best, matchedName, reasons };
}

export function selectOpenCorporatesCandidate(companies, { publisherName, aliases = [], jurisdictionCode } = {}) {
  const names = [publisherName, ...aliases].filter(Boolean);
  if (!names.length || names.every(isGenericName)) return { status: "insufficient_identity", candidate: null };
  const ranked = (companies || []).map((company) => {
    const scores = names.map((name) => scoreCompany(company, name, jurisdictionCode)).sort((a, b) => b.score - a.score);
    return scores[0];
  }).filter(Boolean).sort((a, b) => b.score - a.score);
  if (!ranked.length || ranked[0].score < 82) return { status: "no_match", candidate: null };
  if (ranked[1] && ranked[0].score - ranked[1].score < 10) return { status: "ambiguous", candidate: null, candidates: ranked.slice(0, 3) };
  return { status: "ok", candidate: ranked[0] };
}

class OpenCorporatesHttpError extends Error {
  constructor(status) { super(`OpenCorporates request failed (${status})`); this.status = status; }
}

async function fetchJson(path) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${API}${path}`, {
      signal: ctrl.signal,
      headers: { Accept: "application/json", "X-API-TOKEN": apiKey() },
    });
    if (!res.ok) throw new OpenCorporatesHttpError(res.status);
    return res.json();
  } finally { clearTimeout(timer); }
}

function failure(err, latencyMs) {
  if (err?.name === "AbortError") return { status: "unavailable", errorMessage: "OpenCorporates request timed out", latencyMs };
  if ([401, 403].includes(err?.status)) return { status: "bad_credentials", errorMessage: "OpenCorporates credentials were rejected", latencyMs };
  if (err?.status === 404) return { status: "no_match", errorMessage: "OpenCorporates company record not found", latencyMs };
  if (err?.status === 429) return { status: "rate_limited", errorMessage: "OpenCorporates rate limit reached", latencyMs };
  if (err?.status >= 500) return { status: "unavailable", errorMessage: "OpenCorporates is temporarily unavailable", latencyMs };
  return { status: "error", errorMessage: err?.message || "OpenCorporates request failed", latencyMs };
}

function normalizedCompany(company, match, publisherName) {
  const address = company?.registered_address;
  const externalUrl = company?.opencorporates_url || null;
  return {
    providerName: "opencorporates",
    publisherName,
    legalName: company?.name || null,
    companyNumber: company?.company_number || null,
    jurisdictionCode: company?.jurisdiction_code || null,
    companyType: company?.company_type || null,
    currentStatus: company?.current_status || null,
    status: company?.current_status || null,
    incorporationDate: company?.incorporation_date || null,
    dissolutionDate: company?.dissolution_date || null,
    registeredAddress: address ? [address.street_address, address.locality, address.region, address.postal_code, address.country].filter(Boolean).join(", ") : null,
    registryUrl: company?.registry_url || null,
    externalUrl,
    matchedName: match.matchedName,
    matchedDomain: null,
    matchConfidence: match.score / 100,
    matchReasons: match.reasons,
    retrievedAt: new Date().toISOString(),
    provenance: { provider: "OpenCorporates", license: "ODbL-1.0", sourceUrl: externalUrl },
  };
}

function prerequisites() {
  if (!publisherProviderFlags().openCorporates) return disabledProviderResult("opencorporates", "OpenCorporates disabled by OPENCORPORATES_ENABLED");
  if (!apiKey()) return { providerName: "opencorporates", ok: false, matchFound: false, status: "missing_config", errorMessage: "OPENCORPORATES_API_KEY not set", latencyMs: 0 };
  return null;
}

export const openCorporatesProvider = {
  providerName: "opencorporates",
  description: "OpenCorporates legal entity identity and provenance",

  async healthCheck() {
    const blocked = prerequisites();
    if (blocked) return { ...blocked, message: blocked.errorMessage || blocked.message, checkedAt: new Date().toISOString() };
    return { providerName: "opencorporates", ok: true, status: "configured", message: "OpenCorporates enabled and credentials configured", latencyMs: 0, checkedAt: new Date().toISOString() };
  },

  async lookupPublisher({ publisherName, aliases = [], jurisdictionCode } = {}) {
    const t0 = Date.now();
    const blocked = prerequisites();
    if (blocked) return blocked;
    if (!publisherName || isGenericName(publisherName)) return { providerName: "opencorporates", ok: true, matchFound: false, status: "insufficient_identity", errorMessage: "A distinctive publisher or legal name is required", latencyMs: 0 };
    try {
      const search = await fetchJson(`/companies/search?q=${encodeURIComponent(publisherName)}&per_page=10`);
      const companies = (search?.results?.companies || []).map((entry) => entry?.company || entry).filter(Boolean);
      const selected = selectOpenCorporatesCandidate(companies, { publisherName, aliases, jurisdictionCode });
      if (!selected.candidate) return {
        providerName: "opencorporates", ok: true, matchFound: false, status: selected.status,
        candidates: (selected.candidates || []).map((item) => ({
          legalName: item.company?.name || null,
          companyNumber: item.company?.company_number || null,
          jurisdictionCode: item.company?.jurisdiction_code || null,
          externalUrl: item.company?.opencorporates_url || null,
          matchScore: item.score,
          matchReasons: item.reasons,
        })),
        latencyMs: Date.now() - t0,
      };
      const initial = selected.candidate.company;
      let company = initial;
      if (initial.jurisdiction_code && initial.company_number) {
        const detail = await fetchJson(`/companies/${encodeURIComponent(initial.jurisdiction_code)}/${encodeURIComponent(initial.company_number)}`);
        company = detail?.results?.company || initial;
      }
      return {
        providerName: "opencorporates", ok: true, matchFound: true,
        status: "ok", confidence: selected.candidate.score >= 95 ? "high" : "medium",
        normalized: normalizedCompany(company, selected.candidate, publisherName),
        raw: { company }, latencyMs: Date.now() - t0,
      };
    } catch (err) {
      return { providerName: "opencorporates", ok: false, matchFound: false, ...failure(err, Date.now() - t0) };
    }
  },

  async lookupClaim() {
    const blocked = prerequisites();
    if (blocked) return blocked;
    return { providerName: "opencorporates", ok: false, matchFound: false, status: "not_implemented", errorMessage: "OpenCorporates does not provide claim fact checks", latencyMs: 0 };
  },

  normalizeResponse(raw) { return raw; },
};
