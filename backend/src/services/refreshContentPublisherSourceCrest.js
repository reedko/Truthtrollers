import { acquireCfxDocumentAutomatically } from "./cfxAutomaticAcquisition.js";
import { processPublishingIdentity } from "./publishingIdentityPipeline.js";
import {
  enrichPublisherIfNeeded,
  reEvaluateAdmiraltyForPublisher,
} from "./publisherEnrichmentService.js";
import { invalidatePublisherProviderCache } from "../../services/sourceProviders/sourceProviderRegistry.js";

function domainFromUrl(value) {
  try {
    return new URL(value).hostname.replace(/^www\./iu, "").toLowerCase();
  } catch {
    return null;
  }
}

function originalUrlFromIdentity(identity, fallback) {
  return identity?.context?.publication_relationship?.originalUrl
    || identity?.context?.raw_metadata?.publication_relationship?.originalUrl
    || fallback;
}

/**
 * Re-scrape a content document, persist the complete publishing-role graph,
 * then refresh SourceCrest for the newly selected rated entity. The source
 * document and outlet are deliberately not rewritten as the rated publisher.
 */
export async function refreshContentPublisherSourceCrest({
  query,
  contentId,
  requestedPublisherId = null,
  sourceUrl = null,
  automaticAcquirer = acquireCfxDocumentAutomatically,
  identityProcessor = processPublishingIdentity,
  cacheInvalidator = invalidatePublisherProviderCache,
  enricher = enrichPublisherIfNeeded,
  evaluator = reEvaluateAdmiraltyForPublisher,
} = {}) {
  const numericContentId = Number(contentId);
  if (!query || !Number.isFinite(numericContentId)) {
    throw new Error("A valid contentId is required for publishing-identity refresh.");
  }

  const [content] = await query(
    `SELECT content_id, content_name, url
       FROM content
      WHERE content_id = ?
      LIMIT 1`,
    [numericContentId],
  );
  if (!content) throw new Error(`Content ${numericContentId} was not found.`);
  const documentUrl = sourceUrl || content.url;
  if (!documentUrl) throw new Error(`Content ${numericContentId} has no source URL.`);

  const beforeRoles = await query(
    `SELECT cp.publisher_id, cp.publisher_role, cp.is_primary, p.publisher_name, p.domain
       FROM content_publishers cp
       JOIN publishers p ON p.publisher_id = cp.publisher_id
      WHERE cp.content_id = ?
      ORDER BY cp.is_primary DESC, cp.content_publisher_id`,
    [numericContentId],
  );

  const acquisition = await automaticAcquirer({
    candidate: {
      url: documentUrl,
      canonicalUrl: documentUrl,
      title: content.content_name || null,
    },
  });
  if (!acquisition?.acquired || !acquisition?.extractedDocument?.publishingIdentity) {
    const lastAttempt = acquisition?.attempts?.at(-1);
    throw new Error(`Publishing-identity rescrape failed${lastAttempt?.diagnostic ? `: ${lastAttempt.diagnostic}` : "."}`);
  }

  const extracted = acquisition.extractedDocument;
  const identity = extracted.publishingIdentity;
  if (acquisition.cleanedText) {
    await query(
      `UPDATE content
          SET content_text = ?
        WHERE content_id = ?`,
      [acquisition.cleanedText, numericContentId],
    );
  }

  const identityResult = await identityProcessor({
    query,
    contentId: numericContentId,
    identity,
    sourceUrl: documentUrl,
    authors: extracted.authors || identity.document?.authors || [],
  });
  const ratedPublisherId = Number(identityResult?.persistence?.publisherId || identityResult?.persistence || 0);
  if (!ratedPublisherId) throw new Error("Publishing identity was extracted but no rated publisher was persisted.");

  const [ratedPublisher] = await query(
    `SELECT publisher_id, publisher_name, domain
       FROM publishers
      WHERE publisher_id = ?
      LIMIT 1`,
    [ratedPublisherId],
  );
  if (!ratedPublisher) throw new Error(`Rated publisher ${ratedPublisherId} was not found after persistence.`);

  const ratingUrl = originalUrlFromIdentity(identity, documentUrl);
  const ratingDomain = ratedPublisher.domain || domainFromUrl(ratingUrl);
  if (ratingDomain) {
    await query(
      `UPDATE publishers
          SET domain = COALESCE(NULLIF(domain, ''), ?)
        WHERE publisher_id = ?`,
      [ratingDomain, ratedPublisherId],
    );
    ratedPublisher.domain = ratingDomain;
  }
  await query(
    `UPDATE source_identity_cache
        SET publisher_id = ?, publisher_name = ?, reliability = NULL,
            resolution_level = GREATEST(COALESCE(resolution_level, 0), 3),
            resolution_status = 'matched_metadata', last_checked_at = NOW()
      WHERE source_url = ? OR normalized_url = ?`,
    [ratedPublisherId, ratedPublisher.publisher_name, documentUrl, documentUrl],
  ).catch((error) => {
    if (error?.code !== "ER_NO_SUCH_TABLE") throw error;
  });

  // A force refresh is an explicit request to discard automatic provider
  // judgments for this entity. Human-reviewed publisher ratings are stored in
  // publisher_ratings and are not deleted here.
  await query(
    `DELETE FROM publisher_external_signals WHERE publisher_id = ?`,
    [ratedPublisherId],
  ).catch((error) => {
    if (error?.code !== "ER_NO_SUCH_TABLE") throw error;
  });
  cacheInvalidator();

  const enrichment = await enricher({
    query,
    publisherId: ratedPublisherId,
    publisherName: ratedPublisher.publisher_name,
    domain: ratingDomain,
    sourceUrl: ratingUrl,
    force: true,
    context: "case_content",
    skipExternalSignals: false,
    skipOwnSiteOrgStatus: false,
    maxProviderConcurrency: 1,
  });
  // enrichPublisherIfNeeded already performs the production Admiralty
  // reevaluation. Only use the explicit evaluator as a compatibility fallback
  // if an older enrichment implementation did not return updated content codes.
  const reevaluatedCodes = Object.keys(enrichment?.admiraltyUpdates || {}).length
    ? {}
    : await evaluator(query, ratedPublisherId, ratedPublisher.publisher_name);
  const admiraltyUpdates = { ...(enrichment?.admiraltyUpdates || {}), ...(reevaluatedCodes || {}) };

  const roles = await query(
    `SELECT cp.publisher_id, cp.publisher_role, cp.is_primary, p.publisher_name, p.domain
       FROM content_publishers cp
       JOIN publishers p ON p.publisher_id = cp.publisher_id
      WHERE cp.content_id = ?
      ORDER BY cp.is_primary DESC, cp.content_publisher_id`,
    [numericContentId],
  );

  return {
    status: "done",
    publisherId: ratedPublisherId,
    publisherName: ratedPublisher.publisher_name,
    ratedPublisher,
    requestedPublisherId: requestedPublisherId == null ? null : Number(requestedPublisherId),
    sourceDocument: { contentId: numericContentId, title: content.content_name, url: documentUrl },
    ratingUrl,
    roles,
    previousRoles: beforeRoles,
    acquisition: {
      method: acquisition.method,
      resolvedUrl: acquisition.resolvedUrl,
      textLength: acquisition.cleanedText?.length || 0,
      attempts: acquisition.attempts,
    },
    enrichment,
    admiraltyCode: admiraltyUpdates[numericContentId] || enrichment?.admiraltyCode || null,
    admiraltyUpdates,
  };
}
