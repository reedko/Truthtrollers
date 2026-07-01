import { pool } from "../db/pool.js";
import logger from "../utils/logger.js";
import { SOURCE_IDENTITY_VERSION } from "../utils/publishingIdentityContract.js";

function json(value) {
  return value == null ? null : JSON.stringify(value);
}

function confidenceNumber(value) {
  const number = Number(value);
  if (Number.isFinite(number)) return Math.max(0, Math.min(1, number));
  return { high: 0.9, medium: 0.65, low: 0.35, unknown: 0 }[String(value || "").toLowerCase()] || 0;
}

function confidenceLabel(value) {
  const number = confidenceNumber(value);
  return number >= 0.8 ? "high" : number >= 0.5 ? "medium" : number > 0 ? "low" : "unknown";
}

const VENUE_TYPES = new Set(["journal", "conference", "book", "report_series", "repository", "other"]);

export function normalizeVenueType(value) {
  if (value == null || String(value).trim() === "") return null;
  const normalized = String(value).trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (VENUE_TYPES.has(normalized)) return normalized;
  if (["periodical", "academic_journal", "scholarly_journal"].includes(normalized)) return "journal";
  if (["proceedings", "conference_proceedings"].includes(normalized)) return "conference";
  if (["monograph", "edited_volume"].includes(normalized)) return "book";
  if (["report", "series"].includes(normalized)) return "report_series";
  if (["archive", "institutional_repository"].includes(normalized)) return "repository";
  return "other";
}

function boundedName(value) {
  const name = String(value || "").replace(/\s+/g, " ").trim();
  return name ? name.slice(0, 255) : null;
}

function normalizedLegacyPublisher(publisher) {
  if (typeof publisher === "string") return { publisher_name: boundedName(publisher) };
  if (!publisher || typeof publisher !== "object") return null;
  return {
    publisher_name: boundedName(publisher.publisher_name || publisher.name),
    publisher_owner: publisher.publisher_owner || null,
    publisher_icon: publisher.publisher_icon || null,
  };
}

function connectionQuery(connection) {
  return (sql, values = []) => new Promise((resolve, reject) => {
    connection.query(sql, values, (error, rows) => error ? reject(error) : resolve(rows));
  });
}

async function inTransaction(fallbackQuery, options, callback) {
  if (options.transactionQuery) return callback(options.transactionQuery);
  if (options.transaction === false) return callback(fallbackQuery);

  const connection = await new Promise((resolve, reject) => {
    pool.getConnection((error, value) => error ? reject(error) : resolve(value));
  });
  const txQuery = connectionQuery(connection);
  try {
    await new Promise((resolve, reject) => connection.beginTransaction((error) => error ? reject(error) : resolve()));
    const result = await callback(txQuery);
    await new Promise((resolve, reject) => connection.commit((error) => error ? reject(error) : resolve()));
    return result;
  } catch (error) {
    await new Promise((resolve) => connection.rollback(() => resolve()));
    throw error;
  } finally {
    connection.release();
  }
}

async function upsertEntity(query, entity) {
  const name = boundedName(entity?.name);
  if (!name) return null;
  const rows = await query("CALL InsertOrGetPublisher(?, NULL, NULL, @publisherId)", [name]);
  const publisherId = rows?.[0]?.[0]?.publisherId || null;
  if (!publisherId) throw new Error(`Could not create or resolve source entity: ${name}`);
  await query(
    `UPDATE publishers
        SET entity_type = COALESCE(entity_type, ?),
            identity_confidence = GREATEST(COALESCE(identity_confidence, 0), ?)
      WHERE publisher_id = ?`,
    [entity.entity_type || "other", confidenceNumber(entity.confidence), publisherId],
  );
  return { ...entity, name, publisherId };
}

export async function linkPublisherRole(query, contentId, {
  publisherId,
  role = "legacy_unspecified",
  isPrimary = false,
  contextId = null,
  confidence = null,
  method = null,
  evidence = null,
  replaceRole = false,
} = {}) {
  if (!contentId || !publisherId) return null;
  try {
    if (replaceRole) {
      await query(
        `DELETE FROM content_publishers
          WHERE content_id = ?
            AND COALESCE(publisher_role, 'legacy_unspecified') IN (?, 'legacy_unspecified')
            AND publisher_id <> ?`,
        [contentId, role, publisherId],
      );
    }
    if (isPrimary) {
      await query("UPDATE content_publishers SET is_primary = 0 WHERE content_id = ?", [contentId]);
    }
    await query(
      `INSERT INTO content_publishers
        (content_id, publisher_id, publisher_role, is_primary, context_id,
         identity_confidence, extraction_method, evidence_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE publisher_role = VALUES(publisher_role),
         is_primary = VALUES(is_primary), context_id = COALESCE(VALUES(context_id), context_id),
         identity_confidence = COALESCE(VALUES(identity_confidence), identity_confidence),
         extraction_method = COALESCE(VALUES(extraction_method), extraction_method),
         evidence_json = COALESCE(VALUES(evidence_json), evidence_json)`,
      [contentId, publisherId, role, isPrimary ? 1 : 0, contextId,
        confidence == null ? null : confidenceNumber(confidence), method, json(evidence)],
    );
  } catch (error) {
    if (!["ER_BAD_FIELD_ERROR", "ER_NO_SUCH_TABLE"].includes(error?.code)) throw error;
    await query(
      "INSERT IGNORE INTO content_publishers (content_id, publisher_id) VALUES (?, ?)",
      [contentId, publisherId],
    );
  }
  return publisherId;
}

export async function unlinkPublisherRole(query, contentId, {
  publisherId = null,
  role = null,
} = {}) {
  if (!contentId) return 0;
  const conditions = ["content_id = ?"];
  const values = [contentId];
  if (publisherId) {
    conditions.push("publisher_id = ?");
    values.push(publisherId);
  }
  if (role) {
    conditions.push("COALESCE(publisher_role, 'legacy_unspecified') = ?");
    values.push(role);
  }
  const result = await query(`DELETE FROM content_publishers WHERE ${conditions.join(" AND ")}`, values);
  return result?.affectedRows || 0;
}

function normalizeIdentifier(item) {
  const type = String(item?.identifier_type || item?.type || "other").toLowerCase();
  let value = String(item?.normalized_value || item?.value || "").trim();
  if (!value) return null;
  if (type === "doi") value = value.replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "").replace(/^doi\s*:\s*/i, "").toLowerCase();
  if (type === "issn" || type === "eissn") value = value.toUpperCase().replace(/[^0-9X]/g, "").replace(/^(\w{4})(\w{4})$/, "$1-$2");
  return { ...item, type, value: value.slice(0, 255) };
}

function hostname(sourceUrl) {
  try { return new URL(sourceUrl).hostname.replace(/^www\./, "").toLowerCase(); } catch { return null; }
}

function rootDomain(domain) {
  if (!domain) return null;
  return domain.split(".").slice(-2).join(".");
}

export async function persistSourceIdentity(query, contentId, identity, options = {}) {
  if (!contentId || identity?.version !== SOURCE_IDENTITY_VERSION) return null;

  return inTransaction(query, options, async (tx) => {
    const organization = await upsertEntity(tx, identity.entities?.publishing_organization);
    const venue = await upsertEntity(tx, identity.entities?.publication_venue);
    const extraEntities = [];
    for (const [role, entity] of Object.entries(identity.entities || {})) {
      if (["publishing_organization", "publication_venue"].includes(role) || !entity?.name) continue;
      const persisted = await upsertEntity(tx, entity);
      if (persisted) extraEntities.push({ ...persisted, role });
    }
    const context = { ...identity.context, ...identity.document };
    const contextType = context.context_type || "web";
    const extractionConfidence = confidenceNumber(context.extraction_confidence);
    const contextResult = await tx(
      `INSERT INTO content_publishing_context
        (content_id, context_type, platform, publisher_name_observed, venue_name,
         venue_type, article_type, volume, issue, publication_date, publication_year,
         distribution_channel, linked_url, linked_publisher_observed, social_provenance,
         extraction_method, extraction_confidence, extractor_version,
         extraction_evidence, raw_metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         context_id = LAST_INSERT_ID(context_id), platform = VALUES(platform),
         publisher_name_observed = VALUES(publisher_name_observed), venue_name = VALUES(venue_name),
         venue_type = VALUES(venue_type), article_type = VALUES(article_type),
         volume = VALUES(volume), issue = VALUES(issue), publication_date = VALUES(publication_date),
         publication_year = VALUES(publication_year),
         distribution_channel = VALUES(distribution_channel), linked_url = VALUES(linked_url),
         linked_publisher_observed = VALUES(linked_publisher_observed), social_provenance = VALUES(social_provenance),
         extraction_method = VALUES(extraction_method), extraction_confidence = VALUES(extraction_confidence),
         extractor_version = VALUES(extractor_version), extraction_evidence = VALUES(extraction_evidence),
         raw_metadata = VALUES(raw_metadata)`,
      [
        contentId, contextType, context.platform || null,
        context.publisher_name_observed || organization?.name || null,
        context.venue_name || venue?.name || null,
        normalizeVenueType(context.venue_type || venue?.venue_type),
        context.article_type || null, context.volume || null, context.issue || null,
        context.publication_date || null, context.publication_year || null,
        context.distribution_channel || null,
        context.linked_url || null, context.linked_publisher_observed || null,
        json(context.social_provenance), context.extraction_method || null,
        confidenceLabel(extractionConfidence), context.extractor_version || identity.version,
        json({
          publishing_organization: identity.entities?.publishing_organization || null,
          publication_venue: identity.entities?.publication_venue || null,
          authors: identity.document?.authors || [],
          publication_date: identity.document?.publication_date || null,
          warnings: identity.warnings || [],
        }),
        json(context.raw_metadata || null),
      ],
    );
    const contextId = contextResult.insertId;

    for (const rawIdentifier of identity.document?.identifiers || []) {
      const item = normalizeIdentifier(rawIdentifier);
      if (!item) continue;
      await tx(
        `INSERT INTO content_publishing_identifiers
          (context_id, identifier_type, identifier_scope, normalized_value, raw_value,
           extraction_method, extraction_confidence, evidence_quote)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE raw_value = VALUES(raw_value),
           identifier_scope = VALUES(identifier_scope), extraction_method = VALUES(extraction_method),
           extraction_confidence = VALUES(extraction_confidence), evidence_quote = VALUES(evidence_quote)`,
        [contextId, item.type, item.identifier_scope || item.scope || "unknown", item.value,
          item.raw_value || item.value || null, item.extraction_method || null,
          confidenceLabel(item.extraction_confidence), String(item.evidence_quote || "").slice(0, 500) || null],
      );
    }

    const links = [
      organization ? { ...organization, role: "publishing_organization" } : null,
      venue ? { ...venue, role: "publication_venue" } : null,
      ...extraEntities,
    ].filter(Boolean);
    const socialPrimary = contextType === "social"
      ? extraEntities.find((entity) => ["distribution_channel", "social_container", "platform"].includes(entity.role))
      : null;
    const primary = socialPrimary || (contextType === "scholarly" && venue && confidenceNumber(venue.confidence) >= 0.6
      ? venue
      : organization || venue || extraEntities[0] || null);

    for (const link of links) {
      await linkPublisherRole(tx, contentId, {
        publisherId: link.publisherId,
        role: link.role,
        isPrimary: link.publisherId === primary?.publisherId,
        contextId,
        confidence: link.confidence,
        method: link.method || null,
        evidence: { evidence: link.evidence || null },
        replaceRole: true,
      });
    }

    if (organization && venue && organization.publisherId !== venue.publisherId) {
      const existing = await tx(
        `SELECT id FROM publisher_relationships
          WHERE publisher_id = ? AND related_publisher_id = ? AND relationship_type = 'publishes'
          LIMIT 1`,
        [organization.publisherId, venue.publisherId],
      );
      if (!existing.length) {
        await tx(
          `INSERT INTO publisher_relationships
            (publisher_id, related_publisher_id, related_entity_name, relationship_type,
             provider, confidence, raw_value)
           VALUES (?, ?, ?, 'publishes', 'source_identity_extractor', ?, ?)`,
          [organization.publisherId, venue.publisherId, venue.name,
            Math.min(confidenceNumber(organization.confidence), confidenceNumber(venue.confidence)),
            json({ source_url: identity.source_url || null, context_id: contextId })],
        );
      }
    }

    const domain = hostname(identity.source_url);
    if (domain && organization && contextType === "web") {
      await tx(
        `INSERT IGNORE INTO publisher_domains
          (publisher_id, domain, root_domain, match_type, confidence, is_platform_host)
         VALUES (?, ?, ?, 'exact', ?, 0)`,
        [organization.publisherId, domain, rootDomain(domain), confidenceLabel(organization.confidence) === "unknown" ? "low" : confidenceLabel(organization.confidence)],
      );
    }
    if (identity.source_url && primary) {
      await tx(
        `UPDATE source_identity_cache
            SET publisher_id = ?, publisher_name = ?, last_checked_at = NOW()
          WHERE source_url = ? OR normalized_url = ?`,
        [primary.publisherId, primary.name, identity.source_url, identity.source_url],
      );
    }

    return {
      publisherId: primary?.publisherId || null,
      primaryEntityId: primary?.publisherId || null,
      publishingOrganizationId: organization?.publisherId || null,
      publicationVenueId: venue?.publisherId || null,
      contextId,
      linkedEntities: links.map((link) => ({ publisherId: link.publisherId, name: link.name, role: link.role })),
    };
  });
}

export async function persistPublishers(query, contentId, publisher = null, options = {}) {
  const identity = publisher?.version === SOURCE_IDENTITY_VERSION ? publisher : publisher?.identity;
  if (identity?.version === SOURCE_IDENTITY_VERSION) {
    try {
      return await persistSourceIdentity(query, contentId, identity, options);
    } catch (error) {
      if (!["ER_NO_SUCH_TABLE", "ER_BAD_FIELD_ERROR"].includes(error?.code)) throw error;
      const fallbackName = identity.entities?.publishing_organization?.name
        || identity.entities?.publication_venue?.name
        || Object.values(identity.entities || {}).find((entity) => entity?.name)?.name;
      logger.warn(`Normalized publisher schema is not available; using legacy write for content ${contentId}.`);
      publisher = { publisher_name: fallbackName };
    }
  }

  const legacy = normalizedLegacyPublisher(publisher);
  if (!contentId || !legacy?.publisher_name) return null;
  const rows = await query("CALL InsertOrGetPublisher(?, ?, ?, @publisherId)", [
    legacy.publisher_name,
    legacy.publisher_owner,
    legacy.publisher_icon,
  ]);
  const publisherId = rows?.[0]?.[0]?.publisherId || null;
  if (!publisherId) return null;
  await linkPublisherRole(query, contentId, {
    publisherId,
    role: "legacy_unspecified",
    isPrimary: true,
    method: "legacy_adapter",
  });
  logger.log(`Persisted legacy publisher ${legacy.publisher_name} for content ${contentId}`);
  return publisherId;
}
