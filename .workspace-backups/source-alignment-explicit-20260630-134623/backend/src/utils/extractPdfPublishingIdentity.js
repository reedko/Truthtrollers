import { SOURCE_IDENTITY_VERSION } from "./publishingIdentityContract.js";
import { choosePdfIdentity } from "./pdfIdentityExtractor.js";


function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function confidenceLabel(value) {
  return value >= 0.85 ? "high" : value >= 0.55 ? "medium" : value > 0 ? "low" : "unknown";
}

function identifier(type, scope, value, method, confidence, quote = value) {
  const raw = clean(value);
  if (!raw) return null;
  let normalized = raw;
  if (type === "doi") normalized = raw.replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "").replace(/^doi\s*:\s*/i, "").toLowerCase();
  if (type === "issn" || type === "eissn") normalized = raw.toUpperCase().replace(/[^0-9X]/g, "").replace(/^(\w{4})(\w{4})$/, "$1-$2");
  return { identifier_type: type, identifier_scope: scope, normalized_value: normalized, raw_value: raw, extraction_method: method, extraction_confidence: confidenceLabel(confidence), evidence_quote: clean(quote).slice(0, 500) };
}

function label(text, names) {
  const match = text.slice(0, 30000).match(new RegExp(`(?:^|\\n)\\s*(?:${names.join("|")})\\s*[:：]\\s*([^\\n]{2,220})`, "i"));
  return match ? { value: clean(match[1]), quote: clean(match[0]) } : null;
}

function entity(name, entityType, method, confidence, extra = {}) {
  return { name: name || null, entity_type: entityType, method: name ? method : null, confidence: name ? confidence : 0, evidence: name ? clean(extra.evidence || name).slice(0, 500) : null, ...extra };
}

function flattenMetadata(metadata) {
  if (!metadata) return {};
  if (typeof metadata.getAll === "function") return metadata.getAll();
  return typeof metadata === "object" ? metadata : {};
}

function hostedPdfIdentity(sourceUrl) {
  let host = "";
  try {
    host = new URL(sourceUrl).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }

  // Institutional PDF hosts generally have no useful PDF publisher metadata.
  // These mappings identify the organization that controls the publishing
  // host and keep its publication/site label separate from the organization.
  if (host === "health.uct.ac.za") {
    return {
      organization: "University of Cape Town Faculty of Health Sciences",
      venue: "UCT Health / Faculty of Health Sciences",
      evidence: host,
      method: "institutional_pdf_host",
      confidence: 0.9,
    };
  }

  return null;
}

export function extractPdfPublishingIdentity({ info = {}, metadata = null, text = "", sourceUrl = "" } = {}) {
  const xmp = flattenMetadata(metadata);
  const lines = text.replace(/\r/g, "").split(/\n+/).map(clean).filter(Boolean);
  const firstPageIdentity = choosePdfIdentity(info, lines);
  const hostIdentity = hostedPdfIdentity(sourceUrl);
  const xmpPublisher = clean(xmp["dc:publisher"] || xmp.publisher || info.Publisher);
  const xmpVenue = clean(xmp["prism:publicationName"] || xmp.publicationName || info.Journal);
  const hasExplicitFirstPagePublisher = firstPageIdentity.publisher_name
    && firstPageIdentity.methods.publisher_name !== "choose_pdf_publisher_fallback";

  const organization = hasExplicitFirstPagePublisher
    ? firstPageIdentity.publisher_name
    : xmpPublisher || hostIdentity?.organization || firstPageIdentity.publisher_name || null;
  const organizationMethod = hasExplicitFirstPagePublisher
    ? firstPageIdentity.methods.publisher_name
    : xmpPublisher ? "pdf_xmp" : hostIdentity?.method || firstPageIdentity.methods.publisher_name || null;
  const organizationConfidence = hasExplicitFirstPagePublisher
    ? firstPageIdentity.confidence.publisher_name
    : xmpPublisher ? 0.94 : hostIdentity?.confidence || firstPageIdentity.confidence.publisher_name || 0;
  const organizationEvidence = hasExplicitFirstPagePublisher || !xmpPublisher
    ? hostIdentity?.evidence || firstPageIdentity.evidence.publisher_name
    : xmpPublisher;

  const venue = firstPageIdentity.publication_venue || xmpVenue || hostIdentity?.venue || null;
  const venueMethod = firstPageIdentity.publication_venue
    ? firstPageIdentity.methods.publication_venue
    : xmpVenue ? "pdf_xmp" : hostIdentity?.method || null;
  const venueConfidence = firstPageIdentity.publication_venue
    ? firstPageIdentity.confidence.publication_venue
    : xmpVenue ? 0.94 : hostIdentity?.confidence || 0;
  const venueEvidence = firstPageIdentity.publication_venue
    ? firstPageIdentity.evidence.publication_venue
    : xmpVenue || hostIdentity?.evidence;
  const doi = clean(xmp["prism:doi"] || xmp.doi || info.DOI) || text.slice(0, 30000).match(/\b10\.\d{4,9}\/[-._;()/:A-Z0-9]+\b/i)?.[0];
  const issnMatch = text.slice(0, 30000).match(/\b(?:ISSN)\s*[:：]?\s*(\d{4}-?\d{3}[\dX])\b/i);
  const eissnMatch = text.slice(0, 30000).match(/\b(?:eISSN|electronic ISSN)\s*[:：]?\s*(\d{4}-?\d{3}[\dX])\b/i);
  const identifiers = [
    identifier("doi", "work", doi, xmp["prism:doi"] || info.DOI ? "pdf_xmp" : "pdf_text", xmp["prism:doi"] || info.DOI ? 0.98 : 0.78),
    identifier("issn", "venue", xmp["prism:issn"] || issnMatch?.[1], xmp["prism:issn"] ? "pdf_xmp" : "pdf_text", xmp["prism:issn"] ? 0.98 : 0.82, issnMatch?.[0]),
    identifier("eissn", "venue", xmp["prism:eIssn"] || eissnMatch?.[1], xmp["prism:eIssn"] ? "pdf_xmp" : "pdf_text", xmp["prism:eIssn"] ? 0.98 : 0.82, eissnMatch?.[0]),
  ].filter(Boolean);
  const year = clean(xmp["prism:publicationDate"] || info.CreationDate || text.slice(0, 5000).match(/\b(?:19|20)\d{2}\b/)?.[0]).match(/\b(?:19|20)\d{2}\b/)?.[0] || null;
  const volume = clean(xmp["prism:volume"] || label(text, ["Volume", "Vol\\."])?.value) || null;
  const issue = clean(xmp["prism:number"] || label(text, ["Issue", "No\\."])?.value) || null;
  const articleType = firstPageIdentity.article_type || clean(xmp["dc:type"] || info.Subject) || null;
  const authors = (firstPageIdentity.authors || []).map((author, index) => ({
    name: author.name,
    description: null,
    image: null,
    extraction_method: firstPageIdentity.methods.authors || null,
    extraction_confidence: confidenceLabel(firstPageIdentity.confidence.authors || 0),
    evidence_quote: firstPageIdentity.evidence.authors?.[index] || null,
  }));
  const publicationDate = firstPageIdentity.published_date || null;
  const candidates = [
    organization ? { name: organization, role: "publishing_organization", entity_type: "organization", method: organizationMethod, confidence: organizationConfidence, evidence: organizationEvidence || organization } : null,
    venue ? { name: venue, role: "publication_venue", entity_type: "journal", venue_type: "journal", method: venueMethod, confidence: venueConfidence, evidence: venueEvidence || venue } : null,
  ].filter(Boolean);

  return {
    version: SOURCE_IDENTITY_VERSION,
    source_url: sourceUrl || null,
    document: {
      article_type: articleType,
      authors,
      publication_date: publicationDate,
      publication_year: publicationDate ? Number(publicationDate.slice(0, 4)) : year ? Number(year) : null,
      volume,
      issue,
      identifiers,
    },
    entities: {
      publishing_organization: entity(organization, "organization", organizationMethod, organizationConfidence, { evidence: organizationEvidence || organization }),
      publication_venue: entity(
        venue,
        hostIdentity && venue === hostIdentity.venue ? "publication" : "journal",
        venueMethod,
        venueConfidence,
        { venue_type: hostIdentity && venue === hostIdentity.venue ? "institutional_site" : "journal", evidence: venueEvidence || venue },
      ),
    },
    context: {
      context_type: hostIdentity && !identifiers.length ? "web" : "scholarly",
      platform: "pdf",
      publisher_name_observed: organization,
      venue_name: venue,
      venue_type: venue ? (hostIdentity && venue === hostIdentity.venue ? "institutional_site" : "journal") : null,
      article_type: articleType,
      publication_date: publicationDate,
      volume,
      issue,
      publication_year: publicationDate ? Number(publicationDate.slice(0, 4)) : year ? Number(year) : null,
      extraction_method: organizationMethod || venueMethod || "pdf_text",
      extraction_confidence: Math.max(organizationConfidence, venueConfidence),
      extractor_version: SOURCE_IDENTITY_VERSION,
    },
    candidates,
    warnings: organization || venue ? [] : ["No explicit publisher or publication venue was identified in the PDF."],
  };
}

export function chooseLegacyPdfPublisher(identity) {
  const organization = identity?.entities?.publishing_organization;
  const venue = identity?.entities?.publication_venue;
  if (organization?.name) return organization.name;
  return venue?.name || null;
}
