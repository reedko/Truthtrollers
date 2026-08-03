import { createHash } from "node:crypto";
import { dualWriteTargetEvidenceLinks } from "../core/evaluationTargetStore.js";

const STANCE = Object.freeze({
  supports: "support",
  challenges: "refute",
  qualifies: "nuance",
  mixed: "nuance",
});

const SUPPORT_MULTIPLIER = Object.freeze({
  support: 1,
  refute: -1,
  nuance: 0.5,
});

const CFX_DOCUMENT_PRODUCER = "cfx_document_bearing_v1";

function boundedNumber(value, minimum, maximum, name) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < minimum || number > maximum) {
    throw new TypeError(`${name} must be between ${minimum} and ${maximum}`);
  }
  return number;
}

/**
 * Project the existing production pair assessment contract onto Workspace's
 * legacy columns without changing the CFX semantic result.
 */
export function projectCfxBearingMetrics(row) {
  const stance = STANCE[row?.bearingRelation];
  if (!stance) throw new TypeError(`unsupported bearing relation ${row?.bearingRelation}`);
  const confidence = boundedNumber(row.confidence, 0, 1, "confidence");
  const quality = boundedNumber(row.quality, 0, 1.2, "quality");
  return Object.freeze({
    stance,
    confidence,
    quality,
    score: Math.round(quality * 100),
    supportLevel: Math.round(
      SUPPORT_MULTIPLIER[stance] * confidence * quality * 1_000,
    ) / 1_000,
  });
}

function cfxDocumentRelation(value) {
  return STANCE[value] || (value === "support" || value === "refute" || value === "nuance"
    ? value
    : "insufficient");
}

/** Exact deterministic confidence calculation from EvidenceEngine.adjudicate. */
export function adjudicateLegacyEvidence(items, now = Date.now()) {
  const buckets = { support: 0, refute: 0, nuance: 0, insufficient: 0 };
  for (const item of items || []) {
    const stance = cfxDocumentRelation(item.stance || item.bearingRelation);
    if (!Object.hasOwn(buckets, stance)) continue;
    const publishedAt = item.publishedAt ? Date.parse(item.publishedAt) : NaN;
    const recencyFactor = Number.isFinite(publishedAt)
      ? Math.max(0.5, 1 - (now - publishedAt) / (1_000 * 60 * 60 * 24 * 365 * 5))
      : 0.8;
    const quality = Math.max(0, Math.min(1.2, Number(item.quality) || 0));
    buckets[stance] += quality * recencyFactor;
  }
  const ranked = Object.entries(buckets).sort((left, right) => right[1] - left[1]);
  const total = Object.values(buckets).reduce((sum, value) => sum + value, 0) || 0.0001;
  const dominance = ranked[0][1] / total;
  return Object.freeze({
    finalVerdict: ranked[0][1] === 0 ? "insufficient" : ranked[0][0],
    confidence: Math.max(0.15, Math.min(0.98,
      0.4 * dominance + 0.6 * Math.min(1, total))),
    buckets: Object.freeze(buckets),
    totalWeight: total,
    dominance,
  });
}

function exactText(value, name) {
  const text = String(value || "");
  if (!text.trim()) throw new TypeError(`${name} is required`);
  return text;
}

function positive(value, name) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) throw new TypeError(`${name} must be a positive integer`);
  return number;
}

function absoluteUrl(value, name) {
  const raw = exactText(value, name);
  const parsed = new URL(raw);
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new TypeError(`${name} must use http or https`);
  }
  return parsed.toString();
}

export async function findOrCreateReferenceContent(query, input) {
  const canonicalUrl = absoluteUrl(input.canonicalUrl || input.url, "canonicalUrl");
  const sourceUrl = absoluteUrl(input.url || canonicalUrl, "url");
  const canonicalUrlHash = createHash("sha256").update(canonicalUrl).digest("hex");
  const rows = await query(
    `SELECT content_id FROM content
      WHERE canonical_url_hash=? OR canonical_url=? OR url=?
      ORDER BY content_id LIMIT 1 FOR UPDATE`,
    [canonicalUrlHash, canonicalUrl, sourceUrl],
  );
  if (rows?.[0]) {
    const contentId = Number(rows[0].content_id);
    await query(
      `UPDATE content SET
         content_name=COALESCE(NULLIF(content_name,''),?),
         canonical_url=COALESCE(canonical_url,?),
         canonical_url_hash=COALESCE(canonical_url_hash,?),
         media_source=COALESCE(media_source,?),
         details=COALESCE(details,?)
       WHERE content_id=?`,
      [String(input.title || "Evidence source").slice(0, 1_000), canonicalUrl,
        canonicalUrlHash, input.provider || null,
        input.snippet ? String(input.snippet).slice(0, 65_535) : null, contentId],
    );
    return contentId;
  }
  const result = await query(
    `INSERT INTO content
       (content_name,media_source,url,assigned,progress,details,topic,
        content_type,is_retracted,is_active,canonical_url_hash,canonical_url)
     VALUES (?,? ,?,'unassigned','unassigned',?,'Evidence','reference',0,1,?,?)`,
    [String(input.title || "Evidence source").slice(0, 1_000),
      input.provider || null, sourceUrl,
      input.snippet ? String(input.snippet).slice(0, 65_535) : null,
      canonicalUrlHash, canonicalUrl],
  );
  return positive(result.insertId, "reference content insertId");
}

export async function findOrCreateCanonicalClaim(query, { claimText, claimType }) {
  const text = exactText(claimText, "claimText");
  if (!["task", "reference", "snippet"].includes(claimType)) throw new TypeError("invalid claimType");
  const rows = await query(
    "SELECT claim_id FROM claims WHERE claim_text=? AND claim_type=? ORDER BY claim_id LIMIT 1 FOR UPDATE",
    [text, claimType],
  );
  if (rows?.[0]) return Number(rows[0].claim_id);
  const result = await query(
    "INSERT INTO claims(claim_text,claim_type,veracity_score,confidence_level,last_verified) VALUES (?,?,0,0,CURRENT_TIMESTAMP)",
    [text, claimType],
  );
  return positive(result.insertId, "claim insertId");
}

export async function ensureContentClaim(query, input) {
  const contentId = positive(input.contentId, "contentId");
  const claimId = positive(input.claimId, "claimId");
  const rows = await query(
    "SELECT cc_id FROM content_claims WHERE content_id=? AND claim_id=? ORDER BY cc_id LIMIT 1 FOR UPDATE",
    [contentId, claimId],
  );
  if (rows?.[0]) return Number(rows[0].cc_id);
  const result = await query(
    `INSERT INTO content_claims
       (content_id,claim_id,relationship_type,claim_role,object_claim_text,
        speaker_entity,article_stance,selected_for_evaluation,
        evaluation_eligible,search_eligible,verdict_eligible,visibility)
     VALUES (?,?,?,?,?,?,?,1,1,1,1,?)`,
    [contentId, claimId, input.relationshipType || "contains",
      input.claimRole || "evidence", input.objectClaimText || null,
      input.speakerEntity || null, input.articleStance || null,
      input.visibility || "source_only"],
  );
  return positive(result.insertId, "content claim insertId");
}

export async function ensureClaimSource(query, { claimId, referenceContentId }) {
  const claim = positive(claimId, "claimId");
  const content = positive(referenceContentId, "referenceContentId");
  const rows = await query(
    "SELECT claim_source_id FROM claim_sources WHERE claim_id=? AND reference_content_id=? ORDER BY claim_source_id LIMIT 1 FOR UPDATE",
    [claim, content],
  );
  if (rows?.[0]) return Number(rows[0].claim_source_id);
  const result = await query(
    "INSERT INTO claim_sources(claim_id,reference_content_id,is_primary,user_id) VALUES (?,?,1,NULL)",
    [claim, content],
  );
  return positive(result.insertId, "claim source insertId");
}

export async function ensureContentRelation(query, { taskContentId, referenceContentId }) {
  const task = positive(taskContentId, "taskContentId");
  const reference = positive(referenceContentId, "referenceContentId");
  if (task === reference) throw new TypeError("task and reference content must differ");
  const rows = await query(
    "SELECT content_relation_id FROM content_relations WHERE content_id=? AND reference_content_id=? LIMIT 1 FOR UPDATE",
    [task, reference],
  );
  if (rows?.[0]) return Number(rows[0].content_relation_id);
  const result = await query(
    "INSERT INTO content_relations(content_id,reference_content_id,added_by_user_id,is_system) VALUES (?,?,NULL,1)",
    [task, reference],
  );
  return positive(result.insertId, "content relation insertId");
}

export async function ensureCfxDocumentDiscoveryLink(query, input) {
  const relationId = await ensureContentRelation(query, input);
  const targetClaimId = positive(input.targetClaimId, "targetClaimId");
  const referenceContentId = positive(input.referenceContentId, "referenceContentId");
  const rows = await query(
    `SELECT ref_claim_link_id FROM reference_claim_links
      WHERE content_relation_id=? AND task_claim_id=? AND reference_content_id=?
      ORDER BY ref_claim_link_id LIMIT 1 FOR UPDATE`,
    [relationId, targetClaimId, referenceContentId],
  );
  if (rows?.[0]) return Number(rows[0].ref_claim_link_id);
  const result = await query(
    `INSERT INTO reference_claim_links
       (claim_id,task_claim_id,content_relation_id,reference_content_id,stance,
        score,confidence,support_level,rationale,evidence_text,evidence_offsets,
        created_by_ai,verified_by_user_id,scrape_status)
     VALUES (?,?,?,?,'insufficient',NULL,NULL,NULL,?,?,?,1,NULL,?)`,
    [targetClaimId, targetClaimId, relationId, referenceContentId,
      input.rationale || "CFX evidence candidate discovered; bearing not yet assessed.",
      input.evidenceText || null,
      JSON.stringify({ producer: "cfx_document_discovery_v1" }),
      input.scrapeStatus || "snippet_only"],
  );
  return positive(result.insertId, "document discovery link insertId");
}

function parseLocator(value) {
  if (!value) return {};
  if (typeof value === "object") return value;
  try { return JSON.parse(value); } catch { return {}; }
}

export async function persistCfxAssessedDocumentRelation(query, input) {
  if (!Array.isArray(input.assertions) || input.assertions.length === 0) return null;
  const relationId = await ensureContentRelation(query, input);
  const targetClaimId = positive(input.targetClaimId, "targetClaimId");
  const referenceContentId = positive(input.referenceContentId, "referenceContentId");
  const retrievalQuality = boundedNumber(input.retrievalQuality, 0, 1.2, "retrievalQuality");
  const documentAdjudication = adjudicateLegacyEvidence(
    input.assertions.map((row) => ({
      stance: row.bearingRelation,
      quality: row.quality,
      publishedAt: null,
    })),
    input.now,
  );
  const documentStance = documentAdjudication.finalVerdict;
  if (documentStance === "insufficient") return null;
  const documentScore = Math.round(retrievalQuality * 100);
  const locator = JSON.stringify({
    producer: CFX_DOCUMENT_PRODUCER,
    retrievalQuality,
    publicationDate: input.publicationDate || null,
    bearingContributions: input.assertions.map((row) => ({
      stance: cfxDocumentRelation(row.bearingRelation),
    })),
  });
  const rows = await query(
    `SELECT ref_claim_link_id,verified_by_user_id FROM reference_claim_links
      WHERE content_relation_id=? AND task_claim_id=? AND reference_content_id=?
      ORDER BY ref_claim_link_id LIMIT 1 FOR UPDATE`,
    [relationId, targetClaimId, referenceContentId],
  );
  let linkId;
  let verifiedValuePreserved = false;
  if (rows?.[0]) {
    linkId = positive(rows[0].ref_claim_link_id, "document link id");
    verifiedValuePreserved = rows[0].verified_by_user_id != null;
    await query(
      `UPDATE reference_claim_links
          SET stance=IF(verified_by_user_id IS NULL,?,stance),
              score=IF(verified_by_user_id IS NULL,?,score),
              confidence=IF(verified_by_user_id IS NULL,NULL,confidence),
              support_level=IF(verified_by_user_id IS NULL,NULL,support_level),
              rationale=IF(verified_by_user_id IS NULL,?,rationale),
              evidence_text=IF(verified_by_user_id IS NULL,?,evidence_text),
              evidence_offsets=IF(verified_by_user_id IS NULL,?,evidence_offsets),
              scrape_status=IF(verified_by_user_id IS NULL,?,scrape_status)
        WHERE ref_claim_link_id=?`,
      [documentStance, documentScore,
        input.rationale || `CFX accepted ${input.assertions.length} bearing assertion(s).`,
        input.evidenceText || input.assertions[0]?.exactExcerpt || null,
        locator, input.scrapeStatus || "full", linkId],
    );
  } else {
    const result = await query(
      `INSERT INTO reference_claim_links
         (claim_id,task_claim_id,content_relation_id,reference_content_id,stance,
          score,confidence,support_level,rationale,evidence_text,evidence_offsets,
          created_by_ai,verified_by_user_id,scrape_status)
       VALUES (?,?,?,?,?,?,NULL,NULL,?,?,?,1,NULL,?)`,
      [targetClaimId, targetClaimId, relationId, referenceContentId,
        documentStance, documentScore,
        input.rationale || `CFX accepted ${input.assertions.length} bearing assertion(s).`,
        input.evidenceText || input.assertions[0]?.exactExcerpt || null,
        locator, input.scrapeStatus || "full"],
    );
    linkId = positive(result.insertId, "assessed document link insertId");
  }

  const assessed = await query(
    `SELECT ref_claim_link_id,stance,score,confidence,support_level,
            evidence_offsets,verified_by_user_id
       FROM reference_claim_links
      WHERE task_claim_id=? AND stance IN ('support','refute','nuance')
        AND score IS NOT NULL`,
    [targetClaimId],
  );
  const aggregateInputs = assessed.flatMap((row) => {
    const metadata = parseLocator(row.evidence_offsets);
    const contributionStances = Array.isArray(metadata.bearingContributions)
      ? metadata.bearingContributions
        .map((contribution) => cfxDocumentRelation(contribution?.stance))
        .filter((stance) => stance !== "insufficient")
      : [];
    const stances = contributionStances.length > 0 ? contributionStances : [row.stance];
    return stances.map((stance) => ({
      stance,
      quality: Math.max(0, Math.min(1.2, Number(row.score) / 100)),
      publishedAt: metadata.publicationDate || null,
    }));
  });
  const aggregate = adjudicateLegacyEvidence(aggregateInputs, input.now);
  const aggregateConfidence = Math.round(aggregate.confidence * 10_000) / 10_000;
  for (const row of assessed) {
    const metadata = parseLocator(row.evidence_offsets);
    if (metadata.producer !== CFX_DOCUMENT_PRODUCER || row.verified_by_user_id != null) continue;
    const quality = Math.max(0, Math.min(1.2, Number(row.score) / 100));
    const supportLevel = Math.round(
      (SUPPORT_MULTIPLIER[row.stance] || 0) * aggregateConfidence * quality * 10_000,
    ) / 10_000;
    await query(
      `UPDATE reference_claim_links SET confidence=?,support_level=?
        WHERE ref_claim_link_id=? AND verified_by_user_id IS NULL`,
      [aggregateConfidence, supportLevel, row.ref_claim_link_id],
    );
    if (Number(row.ref_claim_link_id) === linkId) {
      row.confidence = aggregateConfidence;
      row.support_level = supportLevel;
    }
  }
  const current = assessed.find((row) => Number(row.ref_claim_link_id) === linkId);
  return {
    documentLinkId: linkId,
    metricWriteStatus: verifiedValuePreserved ? "verified_value_preserved" : "cfx_written",
    stance: current?.stance || documentStance,
    score: current?.score == null ? documentScore : Number(current.score),
    confidence: current?.confidence == null ? null : Number(current.confidence),
    supportLevel: current?.support_level == null ? null : Number(current.support_level),
    aggregateConfidence,
  };
}

export async function persistTargetedBearingRun(query, input) {
  const result = await query(
    `INSERT INTO cfx_targeted_bearing_runs
       (binding_id,acquired_text_version_id,target_claim_id,run_id,prompt_sha256,
        schema_sha256,model,exact_request_json,raw_response_json,
        parsed_response_json,provider_response_id,validation_status,
        validation_diagnostics_json,input_tokens,output_tokens,latency_ms,
        started_at,completed_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [positive(input.bindingId, "bindingId"), positive(input.acquiredTextVersionId, "acquiredTextVersionId"),
      positive(input.targetClaimId, "targetClaimId"), exactText(input.runId, "runId"),
      input.promptHash, input.schemaHash, input.model,
      JSON.stringify(input.exactRequest), input.rawResponse == null ? null : JSON.stringify(input.rawResponse),
      input.parsedResponse == null ? null : JSON.stringify(input.parsedResponse),
      input.providerResponseId || null, input.validationStatus,
      JSON.stringify(input.validationDiagnostics || []), input.usage?.inputTokens ?? null,
      input.usage?.outputTokens ?? null, input.latencyMs ?? null,
      input.startedAt || new Date(), input.completedAt || new Date()],
  );
  return positive(result.insertId, "targeted bearing run insertId");
}

export async function persistAcceptedBearingAssertions(query, input) {
  const relationId = await ensureContentRelation(query, input);
  const persisted = [];
  for (const row of input.assertions || []) {
    const evidenceClaimId = await findOrCreateCanonicalClaim(query, {
      claimText: row.evidenceAssertion,
      claimType: "reference",
    });
    await ensureContentClaim(query, {
      contentId: input.referenceContentId,
      claimId: evidenceClaimId,
      relationshipType: "contains",
      claimRole: "evidence",
      objectClaimText: row.evidenceAssertion,
      visibility: "source_only",
    });
    const claimSourceId = await ensureClaimSource(query, {
      claimId: evidenceClaimId,
      referenceContentId: input.referenceContentId,
    });
    const metrics = projectCfxBearingMetrics(row);
    await query(
      `INSERT INTO reference_claim_task_links
       (content_relation_id,reference_claim_id,task_claim_id,stance,score,
        confidence,support_level,rationale,quote,created_by_ai)
       VALUES (?,?,?,?,?,?,?,?,?,1)
       ON DUPLICATE KEY UPDATE
         stance=IF(verified_by_user_id IS NULL,VALUES(stance),stance),
         score=IF(verified_by_user_id IS NULL,VALUES(score),score),
         confidence=IF(verified_by_user_id IS NULL,VALUES(confidence),confidence),
         support_level=IF(verified_by_user_id IS NULL,VALUES(support_level),support_level),
         rationale=IF(verified_by_user_id IS NULL,VALUES(rationale),rationale),
         quote=IF(verified_by_user_id IS NULL,VALUES(quote),quote),
         created_by_ai=IF(verified_by_user_id IS NULL,1,created_by_ai)`,
      [relationId, evidenceClaimId, positive(input.targetClaimId, "targetClaimId"),
        metrics.stance, metrics.score, metrics.confidence, metrics.supportLevel,
        row.whyItBears, row.exactExcerpt],
    );
    const links = await query(
      `SELECT reference_claim_task_links_id,verified_by_user_id,stance,score,
              confidence,support_level
         FROM reference_claim_task_links
       WHERE content_relation_id=? AND reference_claim_id=? AND task_claim_id=? LIMIT 1`,
      [relationId, evidenceClaimId, input.targetClaimId],
    );
    const linkId = positive(links?.[0]?.reference_claim_task_links_id, "reference claim task link id");
    const persistedLink = links[0];
    const verifiedValuePreserved = persistedLink.verified_by_user_id != null;
    await query(
      `INSERT INTO reference_claim_task_link_provenance
       (reference_claim_task_links_id,targeted_bearing_run_id,
        acquired_text_version_id,claim_source_id,validation_status,access_level,
        excerpt_start,excerpt_end,excerpt_locator_json,quote_sha256)
       VALUES (?,?,?,?,'accepted',?,?,?,?,SHA2(?,256))`,
      [linkId, positive(input.targetedBearingRunId, "targetedBearingRunId"),
        positive(input.acquiredTextVersionId, "acquiredTextVersionId"), claimSourceId,
        input.accessLevel, row.sourceLocation?.charStart ?? null,
        row.sourceLocation?.charEnd ?? null, JSON.stringify({
          ...(row.sourceLocation || {}),
          metricProvenance: verifiedValuePreserved
            ? {
                confidence: "historical_verified_value_preserved",
                quality: "cfx_model_pair_quality_not_published",
                score: "historical_verified_value_preserved",
                supportLevel: "historical_verified_value_preserved",
              }
            : {
                confidence: "cfx_model_pair_confidence",
                quality: "cfx_model_pair_quality",
                score: "legacy_quality_projection_round_quality_times_100",
                supportLevel: "legacy_stance_multiplier_times_confidence_times_quality",
              },
        }),
        row.exactExcerpt],
    );
    await dualWriteTargetEvidenceLinks(query, input.taskContentId, [{
      referenceClaimId: evidenceClaimId,
      taskClaimId: positive(input.targetClaimId, "targetClaimId"),
      stance: metrics.stance,
      veracityScore: Math.min(1, metrics.quality),
      confidence: metrics.confidence,
      bearingScore: Math.min(1, metrics.quality),
      supportLevel: metrics.supportLevel,
      rationale: row.whyItBears,
      quote: row.exactExcerpt,
    }], input.referenceContentId);
    persisted.push({
      evidenceClaimId,
      claimSourceId,
      referenceClaimTaskLinkId: linkId,
      metrics: {
        stance: persistedLink.stance ?? metrics.stance,
        score: persistedLink.score == null ? metrics.score : Number(persistedLink.score),
        confidence: persistedLink.confidence == null
          ? metrics.confidence
          : Number(persistedLink.confidence),
        supportLevel: persistedLink.support_level == null
          ? metrics.supportLevel
          : Number(persistedLink.support_level),
      },
      metricWriteStatus: verifiedValuePreserved ? "verified_value_preserved" : "cfx_written",
    });
  }
  return persisted;
}

export async function persistCanonicalCfxTarget(query, input) {
  const claimId = await findOrCreateCanonicalClaim(query, {
    claimText: input.substantiveAssertion,
    claimType: "task",
  });
  await ensureContentClaim(query, {
    contentId: input.taskContentId,
    claimId,
    relationshipType: "contains",
    claimRole: "pillar",
    objectClaimText: input.substantiveAssertion,
    speakerEntity: input.assertionSource,
    articleStance: input.articleStance,
    visibility: "workspace_eval",
  });
  return claimId;
}
