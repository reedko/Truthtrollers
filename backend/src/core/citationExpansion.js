import { canonicalizeUrl } from "../utils/canonicalizeUrl.js";

const clean = (value, max = 1000) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);

// Static assets, scripts, styles, and account/login pages can never be evidence
// documents. Citation extraction over raw HTML routinely surfaces these (e.g.
// NCBI page furniture), so they must be rejected before they can become
// candidates or consume a scrape slot.
const REJECT_EXTENSION = /\.(?:js|mjs|cjs|css|png|jpe?g|gif|svg|webp|ico|bmp|tiff?|avif|woff2?|ttf|otf|eot|map)(?:$|[?#])/i;
const REJECT_PATH_SEGMENT = /\/(?:favicon|login|signin|sign-in|signup|sign-up|register|logout|account|auth|oauth|cart|checkout|subscribe|newsletter|wp-login|wp-admin)(?:[/?#]|$)/i;

export function isRejectableEvidenceUrl(url) {
  const value = String(url ?? "").trim();
  if (!value) return true;
  if (!/^https?:\/\//i.test(value)) return true;
  if (REJECT_EXTENSION.test(value)) return true;
  if (REJECT_PATH_SEGMENT.test(value)) return true;
  return false;
}

function citationContext(text, index, length, radius = 260) {
  const source = String(text || "");
  const start = Math.max(0, Number(index) - radius);
  const end = Math.min(source.length, Number(index) + Number(length || 0) + radius);
  return clean(source.slice(start, end), radius * 2 + Number(length || 0));
}

function identifierUrls(text) {
  const results = [];
  for (const match of String(text || "").matchAll(/\b10\.\d{4,9}\/[-._;()/:A-Z0-9]+/gi)) {
    const normalized = match[0].replace(/[.,;:)]+$/, "");
    results.push({
      url: `https://doi.org/${normalized}`,
      identifier: `DOI ${normalized}`,
      citationContext: citationContext(text, match.index, match[0].length),
    });
  }
  for (const match of text.matchAll(/\bPMID\s*[:#]?\s*(\d{6,9})\b/gi)) {
    results.push({
      url: `https://pubmed.ncbi.nlm.nih.gov/${match[1]}/`,
      identifier: `PMID ${match[1]}`,
      citationContext: citationContext(text, match.index, match[0].length),
    });
  }
  for (const match of text.matchAll(/\bPMC(?:ID)?\s*[:#]?\s*(PMC\d+|\d{5,9})\b/gi)) {
    const id = String(match[1]).toUpperCase().startsWith("PMC") ? String(match[1]).toUpperCase() : `PMC${match[1]}`;
    results.push({
      url: `https://pmc.ncbi.nlm.nih.gov/articles/${id}/`,
      identifier: id,
      citationContext: citationContext(text, match.index, match[0].length),
    });
  }
  return results;
}

function citationUrls(text) {
  return [...String(text || "").matchAll(/https?:\/\/[^\s<>"')\]]+/gi)]
    .map((match) => ({
      url: match[0].replace(/[.,;:!?]+$/, ""),
      identifier: "",
      citationContext: citationContext(text, match.index, match[0].length),
    }))
    .filter(({ url }) => /(?:doi\.org|pubmed\.ncbi\.nlm\.nih\.gov|pmc\.ncbi\.nlm\.nih\.gov|ncbi\.nlm\.nih\.gov\/pmc|\.gov\/.*(?:report|study|document)|\.pdf(?:$|\?))/i.test(url));
}

function isAcademicIdentifierUrl(url) {
  return /(?:doi\.org|pubmed\.ncbi\.nlm\.nih\.gov|pmc\.ncbi\.nlm\.nih\.gov|ncbi\.nlm\.nih\.gov\/pmc)/i.test(String(url || ""));
}

function looksLikePointerWrapper(sourceCandidate = {}) {
  const url = String(sourceCandidate.url || "");
  const title = String(sourceCandidate.title || "").toLowerCase();
  const snippet = String(sourceCandidate.snippet || sourceCandidate.bearingText || "").toLowerCase();
  const text = `${title} ${snippet} ${url.toLowerCase()}`;
  let host = "";
  let path = "";
  try {
    const parsed = new URL(url);
    host = parsed.hostname.toLowerCase().replace(/^www\./, "");
    path = parsed.pathname.toLowerCase();
  } catch {
    // Non-URL candidates are not wrapper pages.
  }
  const archiveLike = host.startsWith("archive.") ||
    host === "web.archive.org" ||
    /(?:^|[.-])archive(?:[.-]|$)/i.test(host) ||
    /\/(?:archive|archived|webcache)\//i.test(path) ||
    /\b(?:archived|archive notice|archived page|archived content)\b/.test(text);
  const pointerLike = /\b(?:study|paper|report|document|publication|article)\b/.test(`${text} ${path}`) &&
    /\b(?:about|notice|summary|page|archive|archived|source|full text|publication)\b/.test(`${text} ${path}`);
  return archiveLike && pointerLike;
}

export function extractCitationDerivedCandidates({ text = "", html = "", sourceCandidate = {} } = {}) {
  // General recursive citation expansion stays retired. Bibliographies,
  // reference widgets, and journal-page furniture are not evidence candidates.
  // Narrow exception: archived/pointer wrapper pages may name the actual
  // study/document by hard academic identifier. Preserve only PMID/PMC/DOI
  // targets so a wrapper can lead us to the canonical source without reopening
  // broad citation recursion.
  if (!looksLikePointerWrapper(sourceCandidate)) return [];
  const byCanonical = new Map();
  for (const item of [
    ...identifierUrls(text),
    ...identifierUrls(html),
    ...citationUrls(text).filter((candidate) => isAcademicIdentifierUrl(candidate.url)),
    ...citationUrls(html).filter((candidate) => isAcademicIdentifierUrl(candidate.url)),
  ]) {
    if (isRejectableEvidenceUrl(item.url)) continue;
    const canonical = canonicalizeUrl(item.url) || item.url;
    if (!canonical || byCanonical.has(canonical)) continue;
    byCanonical.set(canonical, {
      id: `pointer-derived:${canonical}`,
      url: item.url,
      title: item.identifier || "Pointer-derived academic source",
      snippet: item.citationContext || sourceCandidate.snippet || "",
      score: Math.max(0.7, Number(sourceCandidate.score) || 0),
      source: "pointer_citation",
      provider: "pointer_citation",
      citationDerived: true,
      pointerDerived: true,
      originatingSourceUrl: sourceCandidate.url || null,
      purposeLane: sourceCandidate.purposeLane || sourceCandidate.retrievalPurpose || "study_identity",
      retrievalPurpose: sourceCandidate.retrievalPurpose || sourceCandidate.purposeLane || "study_identity",
      evidenceLaneId: sourceCandidate.evidenceLaneId || null,
      evidenceTargetId: sourceCandidate.evidenceTargetId || null,
      evidenceTargetType: sourceCandidate.evidenceTargetType || null,
      bearingRequirement: sourceCandidate.bearingRequirement || null,
      bearingCriteria: sourceCandidate.bearingCriteria || null,
      targetProvenance: sourceCandidate.targetProvenance || [{
        evidenceTargetId: sourceCandidate.evidenceTargetId || null,
        evidenceTargetType: sourceCandidate.evidenceTargetType || null,
        stanceGoal: sourceCandidate.stanceGoal || null,
        bearingRequirement: sourceCandidate.bearingRequirement || null,
        query: sourceCandidate.query || null,
      }],
    });
  }
  return [...byCanonical.values()].slice(0, 5);
}

export function resolvedWorkCandidatesForClaim(claim = {}) {
  const byCanonical = new Map();
  for (const context of claim.retrievalContexts || []) {
    for (const work of context.resolvedWorks || []) {
      const identifiers = String(work.identifier || "");
      const pmid = identifiers.match(/PMID\s+(\d+)/i)?.[1];
      const doi = identifiers.match(/DOI\s+([^;\s]+)/i)?.[1];
      const url = work.url || (pmid ? `https://pubmed.ncbi.nlm.nih.gov/${pmid}/` : doi ? `https://doi.org/${doi}` : "");
      const canonical = canonicalizeUrl(url) || url;
      if (!canonical) continue;
      const occurrence = {
        evidenceTargetId: work.evaluationTargetId || context.evaluationTargetId,
        evidenceTargetType: work.evaluationTargetType || context.evaluationTargetType,
        stanceGoal: "origin",
        bearingRequirement: "warrant_test",
        query: null,
      };
      if (byCanonical.has(canonical)) {
        byCanonical.get(canonical).targetProvenance.push(occurrence);
        continue;
      }
      byCanonical.set(canonical, {
        id: `resolved-work:${canonical}`,
        url,
        title: work.title || work.identifier || "Resolved primary source",
        snippet: [work.authors, work.journalOrInstitution, work.year, work.identifier].filter(Boolean).join(" — "),
        publishedAt: work.year ? String(work.year) : null,
        score: 1,
        source: "resolved_work",
        provider: work.provider || "identity_resolution",
        bearingType: "origin",
        stanceGoal: "origin",
        evidenceTargetId: occurrence.evidenceTargetId,
        evidenceTargetType: occurrence.evidenceTargetType,
        bearingRequirement: "warrant_test",
        citationDerived: false,
        resolvedWorkIdentity: true,
        protectedDocumentIdentity: Boolean(work.verifiedDocumentIdentity),
        identityBearingScore: work.verifiedDocumentIdentity
          ? Math.max(0.8, Number(work.identityScore) || 0)
          : null,
        identityBearingType: work.identityRole || "original_study",
        identityBearingRationale: `Verified ${work.identityRole || "study"} retained by study-object discovery.`,
        identityTargetId: work.identityTargetId || null,
        identityRole: work.identityRole || "original_study",
        originatingSourceUrl: work.url || null,
        targetProvenance: [occurrence],
      });
    }
  }
  return [...byCanonical.values()];
}

export async function extractPdfTextWithFallback(buffer, { primaryParser, fallbackParser, minChars = 100 } = {}) {
  const attempts = [];
  for (const [method, parser] of [["pdf_parse_default", primaryParser], ["pdf_parse_direct", fallbackParser]]) {
    if (typeof parser !== "function") continue;
    try {
      const parsed = await parser(buffer);
      const text = clean(parsed?.text, 120000).replace(/<\?xpacket[\s\S]*?<\?xpacket end.*?\?>/gi, "").trim();
      attempts.push({ method, chars: text.length, error: null });
      if (text.length >= minChars) return { ...parsed, text, method, attempts };
    } catch (error) {
      attempts.push({ method, chars: 0, error: clean(error.message, 200) });
    }
  }
  return { text: "", method: null, attempts };
}
