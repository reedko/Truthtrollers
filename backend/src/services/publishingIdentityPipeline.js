import {
  chooseLegacyPrimaryPublisher,
  extractHtmlPublishingIdentity,
} from "../utils/extractPublisher.js";
import { SOURCE_IDENTITY_VERSION } from "../utils/publishingIdentityContract.js";
import { extractPdfPublishingIdentity } from "../utils/extractPdfPublishingIdentity.js";
import { persistPublishers } from "../storage/persistPublishers.js";
import { persistAuthors } from "../storage/persistAuthors.js";

function buildSocialIdentity({ sourceUrl, platform, distributionChannel, linkedUrl, linkedPublisher, provenance }) {
  const normalizedPlatform = String(platform || provenance?.platform || "social").toLowerCase();
  const containerName = provenance?.containerName
    || provenance?.directSocialPublisher
    || (provenance?.containerId ? `${provenance.platform || platform || "Social"} group ${provenance.containerId}` : distributionChannel)
    || null;
  const method = provenance?.containerName ? "extension_dom" : "social_url";
  const confidence = provenance?.containerName ? 0.85 : containerName ? 0.4 : 0;

  return {
    version: SOURCE_IDENTITY_VERSION,
    source_url: sourceUrl || null,
    document: { article_type: "social_post", publication_year: null, volume: null, issue: null, identifiers: [] },
    entities: {
      publishing_organization: { name: null, entity_type: "organization", method: null, confidence: 0, evidence: null },
      publication_venue: { name: null, entity_type: "journal", venue_type: "journal", method: null, confidence: 0, evidence: null },
      distribution_channel: {
        name: containerName,
        entity_type: "social_container",
        method: containerName ? method : null,
        confidence,
        evidence: provenance?.containerName || provenance?.containerId || distributionChannel || null,
      },
    },
    context: {
      context_type: "social",
      platform: normalizedPlatform,
      distribution_channel: provenance?.containerName || distributionChannel || null,
      linked_url: linkedUrl || null,
      linked_publisher_observed: linkedPublisher || null,
      social_provenance: provenance || null,
      extraction_method: method,
      extraction_confidence: confidence,
      extractor_version: SOURCE_IDENTITY_VERSION,
    },
    candidates: containerName ? [{
      name: containerName,
      role: "distribution_channel",
      entity_type: "social_container",
      method,
      confidence,
      evidence: provenance?.containerName || provenance?.containerId || distributionChannel || null,
    }] : [],
    warnings: containerName ? [] : ["Social container identity was not visible."],
  };
}

export async function processPublishingIdentity({
  query = null,
  contentId = null,
  identity = null,
  sourceUrl = "",
  documentType = null,
  $ = null,
  pdfInfo = {},
  pdfMetadata = null,
  pdfText = null,
  socialContext = null,
  fallbackPublisher = null,
  authors: providedAuthors = null,
  persistenceOptions = {},
} = {}) {
  let resolvedIdentity = identity;
  if (!resolvedIdentity && socialContext) {
    resolvedIdentity = buildSocialIdentity({ sourceUrl, ...socialContext });
  } else if (!resolvedIdentity && (documentType === "pdf" || pdfText != null)) {
    resolvedIdentity = extractPdfPublishingIdentity({
      info: pdfInfo,
      metadata: pdfMetadata,
      text: pdfText || "",
      sourceUrl,
    });
  } else if (!resolvedIdentity && $) {
    resolvedIdentity = await extractHtmlPublishingIdentity($, sourceUrl);
  }

  const legacyCandidate = fallbackPublisher
    || (resolvedIdentity ? chooseLegacyPrimaryPublisher(resolvedIdentity) : null);
  const legacyCandidateName = String(
    legacyCandidate?.name || legacyCandidate?.publisher_name || legacyCandidate || "",
  ).trim();
  const selectedLegacyPublisher = /^unknown(?: publisher)?$/i.test(legacyCandidateName)
    ? null
    : legacyCandidate;
  const persistence = query && contentId
    ? await persistPublishers(
        query,
        contentId,
        resolvedIdentity || selectedLegacyPublisher,
        persistenceOptions,
      )
    : null;
  // A transport may provide a more complete author list than the identity
  // object's metadata (for example PDF fallback extraction merged with XMP).
  // Persist the final normalized list chosen by the scrape orchestrator.
  const authors = Array.isArray(providedAuthors)
    ? providedAuthors
    : resolvedIdentity?.document?.authors || [];
  const hasAuthorDecision = Array.isArray(providedAuthors)
    || Array.isArray(resolvedIdentity?.document?.authors);
  const authorIds = query && contentId && hasAuthorDecision
    ? await persistAuthors(query, contentId, authors, { replaceExisting: true })
    : [];

  return {
    identity: resolvedIdentity,
    legacyPublisher: selectedLegacyPublisher,
    persistence,
    authors,
    authorIds,
  };
}
