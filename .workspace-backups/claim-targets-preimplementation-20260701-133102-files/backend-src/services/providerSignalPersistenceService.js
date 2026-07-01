import {
  mapProviderSignalToAdmiralty,
  summarizeProviderSignals,
} from "../../services/providerSignalMapper.js";

function jsonValue(value) {
  if (value == null) return null;
  try {
    return JSON.stringify(value).slice(0, 65000);
  } catch {
    return null;
  }
}

export async function persistProviderSignals(query, {
  publisherId,
  domain,
  entityName,
  providerResults = [],
  matchContext = {},
}) {
  const signals = providerResults.map((result) =>
    mapProviderSignalToAdmiralty(result.providerName, result, {
      domain,
      publisherName: entityName,
      ...matchContext,
    })
  );

  for (const signal of signals) {
    await query(
      `INSERT INTO publisher_external_signals
         (publisher_id, domain, entity_name, provider, signal_type,
          admiralty_effect_type, normalized_score, reliability_bucket,
          confidence_delta, reliability_delta, cap, cap_reason, flags,
          raw_value, matched_name, matched_domain, match_confidence,
          evidence_url, explanation, retrieved_at, expires_at, error_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?, ?)`,
      [
        publisherId || null,
        domain || null,
        entityName || null,
        signal.provider,
        signal.signal_type,
        signal.admiralty_effect_type,
        signal.normalized_score,
        signal.reliability_bucket,
        signal.confidence_delta,
        signal.reliability_delta,
        signal.cap,
        signal.cap_reason,
        jsonValue(signal.flags || []),
        jsonValue(signal.raw),
        signal.matched_name || null,
        signal.matched_domain || null,
        signal.match_confidence,
        signal.evidence_url || null,
        signal.explanation || null,
        null,
        signal.raw?.status && signal.raw?.matchFound === false ? signal.raw.status : null,
      ]
    );

    const relationships = signal.raw?.normalized?.relationships || [];
    for (const rel of relationships) {
      if (!publisherId || !rel?.name || !rel?.type) continue;
      await query(
        `INSERT INTO publisher_relationships
           (publisher_id, related_entity_name, related_entity_id, relationship_type,
            provider, evidence_url, confidence, raw_value)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          publisherId,
          rel.name,
          rel.id || null,
          rel.type,
          signal.provider,
          signal.evidence_url || null,
          signal.match_confidence || null,
          jsonValue(rel),
        ]
      );
    }
  }

  return signals;
}

export async function loadProviderSignals(query, publisherId) {
  if (!publisherId) return [];
  const rows = await query(
    `SELECT provider, signal_type, admiralty_effect_type, normalized_score,
            reliability_bucket, confidence_delta, reliability_delta, cap,
            cap_reason, flags, raw_value, matched_name, matched_domain,
            match_confidence, evidence_url, explanation, error_status
       FROM publisher_external_signals
      WHERE publisher_id = ?
        AND (expires_at IS NULL OR expires_at > NOW())
      ORDER BY retrieved_at DESC, id DESC`,
    [publisherId]
  );
  return rows.map((row) => ({
    provider: row.provider,
    signal_type: row.signal_type,
    admiralty_effect_type: row.admiralty_effect_type,
    normalized_score: row.normalized_score == null ? null : Number(row.normalized_score),
    reliability_bucket: row.reliability_bucket,
    confidence_delta: row.confidence_delta == null ? 0 : Number(row.confidence_delta),
    reliability_delta: row.reliability_delta == null ? 0 : Number(row.reliability_delta),
    cap: row.cap,
    cap_reason: row.cap_reason,
    flags: typeof row.flags === "string" ? JSON.parse(row.flags || "[]") : (row.flags || []),
    raw: typeof row.raw_value === "string" ? JSON.parse(row.raw_value || "{}") : (row.raw_value || {}),
    matched_name: row.matched_name,
    matched_domain: row.matched_domain,
    match_confidence: row.match_confidence == null ? null : Number(row.match_confidence),
    evidence_url: row.evidence_url,
    explanation: row.explanation,
    error_status: row.error_status,
  }));
}

export async function updatePublisherSignalSummary(query, publisherId, signals) {
  if (!publisherId) return null;
  const summary = summarizeProviderSignals(signals || []);
  await query(
    `UPDATE publishers
        SET identity_confidence = ?,
            independent_footprint_score = ?,
            conflict_of_interest_score = ?,
            reliability_signal_present = ?,
            direct_reliability_score = ?,
            contextual_credibility_score = ?,
            provenance_score = ?,
            publication_legitimacy_score = ?,
            reliability_cap = ?,
            reliability_cap_reason = ?,
            reliability_signal_sources = ?,
            last_enriched_at = NOW()
      WHERE publisher_id = ?`,
    [
      summary.identityConfidence,
      summary.independentFootprintScore,
      summary.conflictOfInterestScore,
      summary.reliabilitySignalPresent ? 1 : 0,
      summary.directReliabilityScore,
      summary.contextualCredibilityScore,
      summary.provenanceScore,
      summary.publicationLegitimacyScore,
      summary.strongestCap?.cap || null,
      summary.strongestCap?.reason || null,
      jsonValue(summary.reliabilitySignalSources || []),
      publisherId,
    ]
  );
  return summary;
}
