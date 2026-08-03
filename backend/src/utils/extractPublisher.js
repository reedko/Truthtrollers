import logger from "./logger.js";
import { SOURCE_IDENTITY_VERSION } from "./publishingIdentityContract.js";
import {
  cleanSourceEntityName,
  isUsableSourceEntityName,
} from "./publisherNameValidation.js";

export { SOURCE_IDENTITY_VERSION } from "./publishingIdentityContract.js";

const MAX_EVIDENCE_LENGTH = 500;
const JUNK_NAME_RE = /^(home|news|articles?|content|skip to|toggle|menu|logo|icon|navigation|main content|website|portal|online|search|login|sign in|subscribe|unknown publisher|recaptcha|just a moment|cloudflare|access denied)$/i;
const AGGREGATOR_RE = /(bvs|biblioteca virtual em sa[uú]de|pesquisa bvs|pubmed|ncbi|google scholar|jstor|researchgate|semantic scholar)/i;
const SOCIAL_HOST_RE = /(^|\.)(facebook|instagram|twitter|x|tiktok|reddit|linkedin)\.com$/i;
const REPOSITORY_HOST_RE = /(^|\.)(pubmed\.ncbi\.nlm\.nih\.gov|bvsalud\.org|researchgate\.net|semanticscholar\.org)$/i;

function clean(value) {
  return cleanSourceEntityName(value);
}

function evidence(value) {
  const result = clean(value);
  return result ? result.slice(0, MAX_EVIDENCE_LENGTH) : null;
}

function validName(value, { allowAggregator = false } = {}) {
  const name = clean(value);
  if (!isUsableSourceEntityName(name) || JUNK_NAME_RE.test(name)) return null;
  if (!allowAggregator && AGGREGATOR_RE.test(name)) return null;
  return name;
}

function sourceHost(sourceUrl) {
  try {
    return new URL(sourceUrl).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

export function domainLabel(sourceUrl) {
  const host = sourceHost(sourceUrl);
  if (!host) return null;
  const parts = host.split(".").filter(Boolean);
  const suffixLooksCountryScoped = parts.at(-1)?.length === 2 && parts.at(-2)?.length <= 3;
  const label = suffixLooksCountryScoped ? parts.at(-3) : parts.at(-2);
  return label?.replace(/[-_]+/g, " ") || host;
}

function meta($, names) {
  for (const name of names) {
    const node = $(`meta[name="${name}"], meta[property="${name}"]`).first();
    const value = clean(node.attr("content"));
    if (value) return value;
  }
  return null;
}

function titleSiteName($) {
  const title = clean($("title").first().text());
  if (!title) return null;
  const segments = title.split(/\s+[|｜]\s+/).map(clean).filter(Boolean);
  return segments.length > 1 ? segments.at(-1) : null;
}

function normalizePublicationDate(value) {
  const raw = clean(value);
  if (!raw) return null;
  const iso = raw.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

function jsonLdDocuments($) {
  const documents = [];
  $('script[type="application/ld+json"]').each((_, node) => {
    try {
      const parsed = JSON.parse($(node).text().trim());
      const visit = (value) => {
        if (Array.isArray(value)) return value.forEach(visit);
        if (!value || typeof value !== "object") return;
        documents.push(value);
        if (Array.isArray(value["@graph"])) value["@graph"].forEach(visit);
      };
      visit(parsed);
    } catch (error) {
      logger.warn(`Failed to parse publisher JSON-LD: ${error.message}`);
    }
  });
  return documents;
}

function types(node) {
  return (Array.isArray(node?.["@type"]) ? node["@type"] : [node?.["@type"]]).filter(Boolean);
}

function nestedNames(value) {
  if (Array.isArray(value)) return value.flatMap(nestedNames);
  if (typeof value === "string") return [value];
  if (!value || typeof value !== "object") return [];
  return [value.name, value.headline, ...nestedNames(value.isPartOf)].filter(Boolean);
}

function addCandidate(list, value, details) {
  const name = validName(value, { allowAggregator: details.entity_type === "repository" });
  if (!name) return;
  if (list.some((candidate) => candidate.name.toLowerCase() === name.toLowerCase() && candidate.role === details.role)) return;
  list.push({ name, ...details, evidence: evidence(details.evidence || value) });
}

function selectedEntity(candidate, fallbackType) {
  if (!candidate) {
    return { name: null, entity_type: fallbackType, method: null, confidence: 0, evidence: null };
  }
  return {
    name: candidate.name,
    entity_type: candidate.entity_type || fallbackType,
    ...(candidate.venue_type ? { venue_type: candidate.venue_type } : {}),
    ...(candidate.domain ? { domain: candidate.domain } : {}),
    ...(candidate.relationship_type ? { relationship_type: candidate.relationship_type } : {}),
    ...(candidate.aliases ? { aliases: candidate.aliases } : {}),
    method: candidate.method,
    confidence: candidate.confidence,
    evidence: candidate.evidence,
  };
}

function identifier(type, scope, rawValue, method, confidence, quote = rawValue) {
  let normalized = clean(rawValue);
  if (!normalized) return null;
  if (type === "doi") normalized = normalized.replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "").replace(/^doi\s*:\s*/i, "").toLowerCase();
  if (type === "issn" || type === "eissn") normalized = normalized.toUpperCase().replace(/[^0-9X]/g, "").replace(/^(\w{4})(\w{4})$/, "$1-$2");
  return {
    identifier_type: type,
    identifier_scope: scope,
    normalized_value: normalized,
    raw_value: clean(rawValue),
    extraction_method: method,
    extraction_confidence: confidence,
    evidence_quote: evidence(quote),
  };
}

function uniqueIdentifiers(items) {
  const seen = new Set();
  return items.filter(Boolean).filter((item) => {
    const key = `${item.identifier_type}:${item.normalized_value}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function labeledValue($, labels) {
  // Never treat JavaScript, CSS, templates, or form controls as visible
  // publisher evidence. Tracking code commonly contains strings such as
  // `Publisher: params.utm_source`.
  const visibleRoot = $("body").clone();
  visibleRoot.find("script, style, noscript, template, textarea, input, select, option").remove();
  const body = visibleRoot.text().replace(/\r/g, "\n");
  for (const label of labels) {
    const match = body.match(new RegExp(`${label}\\s*[:：]\\s*([^\\n|]{2,180})(?:\\n|\\||$)`, "i"));
    if (match?.[1]) return { value: clean(match[1]), quote: clean(match[0]) };
  }
  return null;
}

function absoluteHref(value, sourceUrl) {
  try { return new URL(String(value || ""), sourceUrl).toString(); } catch { return null; }
}

function visibleBodyText($) {
  const root = $("body").clone();
  root.find("script, style, noscript, template, textarea, input, select, option").remove();
  return root.text().replace(/\s+/gu, " ").trim();
}

function relationEntity(name, role, method, confidence, evidenceText, extra = {}) {
  const normalized = validName(name);
  if (!normalized) return null;
  return {
    name: normalized,
    role,
    entity_type: "organization",
    method,
    confidence,
    evidence: evidence(evidenceText || name),
    ...extra,
  };
}

/** Deterministic, page-local publishing-provenance extraction. */
export function extractHtmlPublishingProvenance($, sourceUrl = "") {
  const text = visibleBodyText($);
  const sentences = text.match(/[^.!?]{1,360}[.!?]/gu) || [];
  const republishedSentence = sentences.find((sentence) =>
    /\b(?:republished|reprinted|syndicated)\s+from\b/iu.test(sentence)) || null;
  const republishedMatch = republishedSentence?.match(
    /\b(?:republished|reprinted|syndicated)\s+from\s+(.+?)(?:\s+under\s+(?:an?\s+)?(.+?)\s+licen[cs]e|[.;]|$)/iu,
  );
  const republishedEvidence = clean(republishedMatch?.[0]);
  const originalPublisherName = clean(republishedMatch?.[1]);
  let originalUrl = null;
  $("a[href]").each((_, node) => {
    if (originalUrl) return;
    const label = clean($(node).text());
    if (/\boriginal article\b|\bread original\b/iu.test(label || "")) {
      originalUrl = absoluteHref($(node).attr("href"), sourceUrl);
    }
  });

  let parentSubject = null;
  let parentName = null;
  let parentEvidence = null;
  let parentRelationshipType = null;
  for (const sentence of sentences) {
    const program = sentence.match(
      /\b([A-Z][A-Za-z0-9&'’ .-]{2,120}?)\s+is\s+(?:an?\s+)?(program|project|publication|subsidiary)\s+of\s+(?:the\s+)?([A-Z][A-Za-z0-9&'’ .-]{2,120}?)(?=[.;]|$)/u,
    );
    if (program) {
      parentSubject = clean(program[1]);
      parentRelationshipType = `${program[2].toLowerCase()}_of`;
      parentName = clean(program[3]);
      parentEvidence = clean(program[0]);
      break;
    }
  }
  if (!parentName) {
    const part = text.match(/\b(?:now\s+)?part\s+of\s+(?:the\s+)?([A-Z][A-Za-z0-9&'’ .-]{2,100}?)(?=[:.;]|$)/u);
    if (part) {
      parentRelationshipType = "part_of";
      parentName = clean(part[1]);
      parentEvidence = clean(part[0]);
    }
  }

  const hostLabel = sourceHost(sourceUrl)?.split(".")[0] || null;
  const aliases = hostLabel && /^[a-z]{2,8}$/u.test(hostLabel)
    ? [hostLabel.toUpperCase()]
    : [];
  return {
    currentOrganizationName: parentSubject,
    aliases,
    parentOrganization: relationEntity(
      parentName,
      "parent_organization",
      "visible_provenance_statement",
      0.92,
      parentEvidence,
      { relationship_type: parentRelationshipType },
    ),
    originalPublisher: relationEntity(
      originalPublisherName,
      "original_publisher",
      "visible_republication_statement",
      0.96,
      republishedEvidence,
      { domain: sourceHost(originalUrl) },
    ),
    publicationRelationship: originalPublisherName ? {
      type: /syndicated/iu.test(republishedSentence || "") ? "syndicated" : "republished",
      license: clean(republishedMatch?.[2]),
      evidenceText: republishedEvidence,
      originalUrl,
      detectionMethod: "visible_republication_statement",
    } : null,
  };
}

export async function extractHtmlPublishingIdentity($, sourceUrl = "") {
  const candidates = [];
  const docs = jsonLdDocuments($);
  const host = sourceHost(sourceUrl || meta($, ["og:url"]));
  const siteName = meta($, ["og:site_name", "application-name"]) || titleSiteName($);
  const provenance = extractHtmlPublishingProvenance($, sourceUrl);

  for (const doc of docs) {
    for (const name of nestedNames(doc.publisher)) {
      addCandidate(candidates, name, { role: "publishing_organization", entity_type: "organization", method: "json_ld.publisher", confidence: 0.98, evidence: name });
    }
  }

  const publisherMeta = [
    ["citation_publisher", "citation_publisher", 0.96],
    ["dc.publisher", "dc.publisher", 0.93],
    ["DC.publisher", "dc.publisher", 0.93],
    ["prism.publisher", "prism.publisher", 0.92],
  ];
  for (const [field, method, confidence] of publisherMeta) {
    const value = meta($, [field]);
    addCandidate(candidates, value, { role: "publishing_organization", entity_type: "organization", method, confidence, evidence: value });
  }

  // A title suffix/site name is stronger than a bare domain abbreviation.
  // Treat organization-like site names as the publisher while retaining the
  // publication/brand separately as the venue below.
  if (/\b(?:association|society|foundation|university|institute|institution|organization|organisation|agency|department|ministry|company|corporation|press|media|network)\b/i.test(siteName || "")) {
    addCandidate(candidates, siteName, { role: "publishing_organization", entity_type: "organization", method: "site_name", confidence: 0.84, evidence: siteName });
  }

  const visiblePublisher = labeledValue($, ["Publisher", "Editora", "Editorial"]);
  addCandidate(candidates, visiblePublisher?.value, { role: "publishing_organization", entity_type: "organization", method: "visible_label", confidence: 0.82, evidence: visiblePublisher?.quote });

  const footer = $("footer, .footer, [class*='copyright']").text() || $("body").text().slice(-3000);
  const copyright = footer.match(/(?:©|copyright)\s*(?:\d{4}(?:\s*[-–]\s*\d{4})?\s*)?([^\n|,.]{3,160})/i);
  addCandidate(candidates, copyright?.[1], { role: "publishing_organization", entity_type: "organization", method: "copyright", confidence: 0.62, evidence: copyright?.[0] });
  if (provenance.currentOrganizationName) {
    addCandidate(candidates, provenance.currentOrganizationName, {
      role: "publishing_organization",
      entity_type: "organization",
      method: "visible_provenance_statement",
      confidence: 0.92,
      evidence: provenance.parentOrganization?.evidence,
    });
  }

  const venueFields = [
    ["citation_journal_title", "citation_journal_title", 0.98, "journal", "journal"],
    ["prism.publicationName", "prism.publicationName", 0.96, "journal", "journal"],
    ["publicationname", "publicationname", 0.94, "publication", "other"],
  ];
  for (const [field, method, confidence, entityType, venueType] of venueFields) {
    const value = meta($, [field]);
    addCandidate(candidates, value, { role: "publication_venue", entity_type: entityType, venue_type: venueType, method, confidence, evidence: value });
  }
  for (const doc of docs) {
    const isPartOf = doc.isPartOf;
    for (const name of nestedNames(isPartOf)) {
      addCandidate(candidates, name, { role: "publication_venue", entity_type: "journal", venue_type: "journal", method: "json_ld.isPartOf", confidence: 0.94, evidence: name });
    }
    if (types(doc).some((type) => /Periodical|PublicationIssue|PublicationVolume/i.test(type))) {
      addCandidate(candidates, doc.name, { role: "publication_venue", entity_type: "journal", venue_type: "journal", method: "json_ld.periodical", confidence: 0.92, evidence: doc.name });
    }
  }
  for (const field of ["dc.source", "DC.source"]) {
    const value = meta($, [field]);
    addCandidate(candidates, value, { role: "publication_venue", entity_type: "publication", venue_type: "other", method: "dc.source", confidence: 0.86, evidence: value });
  }
  const visibleVenue = labeledValue($, ["Journal", "Published in", "Source", "Revista", "Periódico", "Periodico"]);
  addCandidate(candidates, visibleVenue?.value, { role: "publication_venue", entity_type: "journal", venue_type: "journal", method: "visible_label", confidence: 0.78, evidence: visibleVenue?.quote });
  addCandidate(candidates, siteName, { role: "publication_venue", entity_type: "publication", venue_type: "other", method: "og.site_name", confidence: 0.48, evidence: siteName });

  if (!candidates.some((candidate) => candidate.role === "publishing_organization") && host && !REPOSITORY_HOST_RE.test(host) && !SOCIAL_HOST_RE.test(host)) {
    addCandidate(candidates, domainLabel(sourceUrl), { role: "publishing_organization", entity_type: "organization", method: "domain_fallback", confidence: 0.25, evidence: host });
  }
  if (host && REPOSITORY_HOST_RE.test(host)) {
    addCandidate(candidates, siteName || host, { role: "platform", entity_type: "repository", method: "repository_host", confidence: 0.65, evidence: host });
  }

  const publishingOrganization = provenance.currentOrganizationName
    ? candidates.find((candidate) => candidate.role === "publishing_organization" && candidate.method === "visible_provenance_statement")
    : candidates.find((candidate) => candidate.role === "publishing_organization") || null;
  const publicationVenue = candidates.find((candidate) => candidate.role === "publication_venue") || null;
  const doiValues = [meta($, ["citation_doi"]), meta($, ["prism.doi"]), meta($, ["dc.identifier", "DC.identifier"])];
  for (const doc of docs) doiValues.push(...nestedNames(doc.identifier), ...nestedNames(doc.sameAs).filter((value) => /doi\.org/i.test(value)));
  const canonicalDoi = $('link[rel="canonical"]').attr("href")?.match(/doi\.org\/(10\.\d{4,9}\/[^?#\s]+)/i)?.[1];
  doiValues.push(canonicalDoi);
  const bodyDoi = $("body").text().slice(0, 30000).match(/\b10\.\d{4,9}\/[-._;()/:A-Z0-9]+\b/i)?.[0];
  doiValues.push(bodyDoi);

  const identifiers = uniqueIdentifiers([
    ...doiValues.map((value, index) => identifier("doi", "work", value, index < 3 ? "html_meta" : "json_ld_or_text", index < 3 ? "high" : "medium")),
    identifier("issn", "venue", meta($, ["citation_issn", "prism.issn"]), "html_meta", "high"),
    identifier("eissn", "venue", meta($, ["citation_eissn", "prism.eIssn"]), "html_meta", "high"),
  ]);

  const rawArticleType = meta($, ["dc.type", "DC.type", "prism.aggregationType", "citation_article_type", "article:type", "og:type"]) || docs.flatMap(types).find((type) => /Article|Report|Posting|Scholarly/i.test(type)) || null;
  const publicationName = meta($, ["publicationname", "citation_journal_title", "prism.publicationName"]);
  const articleType = /^article$/i.test(rawArticleType || "") && (/news/i.test(publicationName || "") || /(^|[./_-])news([./_-]|$)/i.test(sourceUrl))
    ? "News article"
    : rawArticleType;
  const dateRaw = meta($, ["datePublished", "publicationDate", "article:published_time", "citation_publication_date", "prism.publicationDate", "dc.date", "DC.date"]) || docs.map((doc) => doc.datePublished).find(Boolean);
  const publicationDate = normalizePublicationDate(dateRaw);
  const yearRaw = publicationDate || dateRaw;
  const year = String(yearRaw || "").match(/\b(19|20)\d{2}\b/)?.[0] || null;
  const volume = meta($, ["citation_volume", "prism.volume"]) || docs.map((doc) => doc.volumeNumber || doc.isPartOf?.volumeNumber).find(Boolean) || null;
  const issue = meta($, ["citation_issue", "prism.number", "prism.issueIdentifier"]) || docs.map((doc) => doc.issueNumber || doc.isPartOf?.issueNumber).find(Boolean) || null;
  const contextType = publicationVenue?.venue_type === "journal" || identifiers.some((item) => ["doi", "issn", "eissn"].includes(item.identifier_type)) ? "scholarly" : host && SOCIAL_HOST_RE.test(host) ? "social" : "web";

  return {
    version: SOURCE_IDENTITY_VERSION,
    source_url: sourceUrl || null,
    document: { article_type: articleType, publication_date: publicationDate, publication_year: year ? Number(year) : null, volume: volume ? clean(volume) : null, issue: issue ? clean(issue) : null, identifiers },
    entities: {
      publishing_organization: selectedEntity(publishingOrganization, "organization"),
      publication_venue: selectedEntity(publicationVenue, "journal"),
      ...(provenance.parentOrganization
        ? { parent_organization: selectedEntity(provenance.parentOrganization, "organization") }
        : {}),
      ...(provenance.originalPublisher
        ? { original_publisher: selectedEntity(provenance.originalPublisher, "organization") }
        : {}),
    },
    context: {
      context_type: contextType,
      platform: host && SOCIAL_HOST_RE.test(host) ? host.split(".").slice(-2)[0] : contextType === "web" ? "web" : contextType,
      publisher_name_observed: publishingOrganization?.name || null,
      venue_name: publicationVenue?.name || null,
      site_name: siteName || null,
      section: meta($, ["article:section", "section"]) || publicationName || null,
      venue_type: publicationVenue?.venue_type || null,
      article_type: articleType,
      publication_date: publicationDate,
      volume: volume ? clean(volume) : null,
      issue: issue ? clean(issue) : null,
      publication_year: year ? Number(year) : null,
      extraction_method: publishingOrganization?.method || publicationVenue?.method || "domain_fallback",
      extraction_confidence: Math.max(publishingOrganization?.confidence || 0, publicationVenue?.confidence || 0),
      extractor_version: SOURCE_IDENTITY_VERSION,
      linked_url: provenance.publicationRelationship?.originalUrl || null,
      linked_publisher_observed: provenance.originalPublisher?.name || null,
      publication_relationship: provenance.publicationRelationship,
      raw_metadata: {
        site_name: siteName || null,
        section: meta($, ["article:section", "section"]) || publicationName || null,
        publication_name: publicationName || null,
        aliases: provenance.aliases,
        publication_relationship: provenance.publicationRelationship,
      },
    },
    candidates,
    warnings: [],
  };
}

export function chooseLegacyPrimaryPublisher(identity) {
  const organization = identity?.entities?.publishing_organization;
  const venue = identity?.entities?.publication_venue;
  const organizationName = isUsableSourceEntityName(organization?.name) ? organization.name : null;
  const venueName = isUsableSourceEntityName(venue?.name) ? venue.name : null;
  if (organizationName && organization.confidence >= 0.5) {
    return { name: organization.name, role: "publisher", confidence: organization.method || "metadata", identity };
  }
  if (venueName) {
    return { name: venue.name, role: "journal", confidence: "proxy", note: "Publication venue used as a legacy publisher proxy.", identity };
  }
  if (organizationName) return { name: organization.name, role: "publisher", confidence: "fallback", identity };
  return { name: "Unknown Publisher", role: "legacy_unspecified", confidence: "unknown", identity };
}

export async function extractPublisher($, sourceUrl = "") {
  return chooseLegacyPrimaryPublisher(await extractHtmlPublishingIdentity($, sourceUrl));
}
