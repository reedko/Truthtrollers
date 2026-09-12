import { crossrefProvider } from "../../../../services/sourceProviders/providers/crossrefProvider.js";
import { collectTraceCandidates } from "./traceSupportContext.js";

function normalizeDoi(value) {
  const match = String(value || "").match(/10\.\d{4,9}\/[-._;()/:A-Z0-9]+/i);
  return match?.[0]?.replace(/[).,;]+$/, "") || null;
}

function normalizePmid(value) {
  return String(value || "").match(/\b\d{5,9}\b/)?.[0] || null;
}

export function normalizePublicUrl(value) {
  try {
    const url = new URL(String(value || ""));
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    const host = url.hostname.toLowerCase();
    if (
      host === "localhost" ||
      host.endsWith(".local") ||
      /^127\./.test(host) ||
      /^10\./.test(host) ||
      /^192\.168\./.test(host) ||
      /^169\.254\./.test(host) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
      host === "::1"
    ) return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function normalizedText(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export async function resolveTraceSource({ source, context }) {
  const candidates = collectTraceCandidates(context);
  const contextJson = JSON.stringify(context);
  const doi = normalizeDoi(source.doi || source.url || source.label);
  const pmid = normalizePmid(source.pmid);

  if (doi && contextJson.toLowerCase().includes(doi.toLowerCase())) {
    return { ...source, doi, pmid, url: `https://doi.org/${doi}`, resolutionStatus: "resolved" };
  }
  if (pmid && (context.identifiers?.pmids || []).includes(pmid)) {
    return { ...source, doi: null, pmid, url: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`, resolutionStatus: "resolved" };
  }

  const requestedUrl = normalizePublicUrl(source.url);
  const matchingUrl = requestedUrl
    ? candidates.find((candidate) => normalizePublicUrl(candidate.url) === requestedUrl)
    : null;
  if (matchingUrl) {
    return {
      ...source,
      url: requestedUrl,
      doi: normalizeDoi(requestedUrl),
      pmid: null,
      citationText: source.citationText || matchingUrl.citationText || null,
      resolutionStatus: "resolved",
    };
  }

  const label = normalizedText(source.label);
  const matchingLabel = label
    ? candidates.find((candidate) => {
        const candidateLabel = normalizedText(candidate.label || candidate.citationText);
        return candidateLabel && (candidateLabel.includes(label) || label.includes(candidateLabel));
      })
    : null;
  if (matchingLabel?.url) {
    return {
      ...source,
      url: normalizePublicUrl(matchingLabel.url),
      doi: normalizeDoi(matchingLabel.url),
      pmid: null,
      citationText: source.citationText || matchingLabel.citationText || null,
      resolutionStatus: "resolved",
    };
  }

  if (label && contextJson.toLowerCase().includes(String(source.label).toLowerCase())) {
    const crossref = await crossrefProvider.lookupPublisher({
      title: source.label,
      articleText: `scholarly paper ${source.label}`,
    });
    const resolvedUrl = normalizePublicUrl(crossref?.normalized?.externalUrl);
    const returnedTitle = normalizedText(crossref?.normalized?.workTitle);
    const labelTerms = new Set(label.split(" ").filter(Boolean));
    const returnedTerms = new Set(returnedTitle.split(" ").filter(Boolean));
    const shared = [...labelTerms].filter((term) => returnedTerms.has(term)).length;
    const titleAgreement = shared / Math.max(1, Math.max(labelTerms.size, returnedTerms.size));
    if (crossref?.matchFound && resolvedUrl && (crossref.confidence !== "low" || (labelTerms.size >= 4 && titleAgreement >= 0.75))) {
      return {
        ...source,
        url: resolvedUrl,
        doi: normalizeDoi(crossref.normalized?.doi || resolvedUrl),
        pmid: null,
        resolutionStatus: "resolved",
      };
    }
  }

  return { ...source, url: null, doi, pmid, resolutionStatus: "unresolved" };
}
