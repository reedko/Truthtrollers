import { detectAcademicIdentifiers } from "../core/academicContentResolver.js";
import { normalizeDoi, normalizePmid, normalizeUrl } from "./identityRegistry.js";

const clean = (value, max = 1_000) => String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
const unique = (values) => [...new Set((values || []).map((value) => clean(value)).filter(Boolean))];

export function normalizeCandidateIdentifiers(raw = {}) {
  const detected = detectAcademicIdentifiers(raw);
  const metadata = raw.academicMetadata || {};
  const doi = unique([detected.doi, metadata.doi, ...(raw.identifiers?.doi || [])])
    .map(normalizeDoi).filter(Boolean);
  const pmid = unique([detected.pmid, metadata.pmid, ...(raw.identifiers?.pmid || [])])
    .map(normalizePmid).filter(Boolean);
  const pmcid = unique([detected.pmcid, metadata.pmcid, ...(raw.identifiers?.pmcid || [])])
    .map((value) => value.toUpperCase().replace(/^PMC/, "PMC")).filter((value) => /^PMC\d+$/.test(value));
  return { doi, pmid, pmcid };
}

function titleKey(title, venue, publishedAt) {
  const normalized = clean(title).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const year = clean(publishedAt, 40).match(/\b(?:19|20)\d{2}\b/)?.[0] || "";
  const venueKey = clean(venue, 300).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  return normalized.length >= 30 && (year || venueKey) ? `work:${normalized}|${venueKey}|${year}` : null;
}

export function candidateIdentityKeys(candidate = {}) {
  const ids = candidate.identifiers || {};
  const keys = [
    ...(ids.doi || []).map((value) => `doi:${value}`),
    ...(ids.pmid || []).map((value) => `pmid:${value}`),
    ...(ids.pmcid || []).map((value) => `pmcid:${value}`),
  ];
  const canonical = normalizeUrl(candidate.canonicalUrl);
  const providerUrl = normalizeUrl(candidate.normalizedUrl || candidate.url);
  if (canonical) keys.push(`url:${canonical}`);
  if (providerUrl) keys.push(`url:${providerUrl}`);
  const fallback = titleKey(candidate.title, candidate.venue, candidate.publishedAt);
  if (fallback) keys.push(fallback);
  return [...new Set(keys)];
}

export function primaryCandidateDedupeKey(candidate = {}) {
  return candidateIdentityKeys(candidate)[0] || `unresolved:${clean(candidate.title, 300).toLowerCase()}`;
}

export function candidateDomain(candidate = {}) {
  try { return new URL(candidate.normalizedUrl || candidate.url).hostname.replace(/^www\./, ""); }
  catch { return ""; }
}
