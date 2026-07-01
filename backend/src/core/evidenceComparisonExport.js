import { canonicalizeUrl } from "../utils/canonicalizeUrl.js";

export const CLAIM_LINK_HEADERS = [
  "case_claim_id", "case_claim_text", "comparison_bucket",
  "legacy_source_claim_id", "legacy_source_claim_text", "legacy_source_url", "legacy_source_title",
  "legacy_stance", "legacy_confidence", "legacy_support_level", "legacy_veracity",
  "bearing_source_claim_id", "bearing_source_claim_text", "bearing_source_url", "bearing_source_title",
  "bearing_stance", "bearing_score", "bearing_type", "claim_component_addressed", "causal_strength", "bearing_reason",
  "legacy_link_bearing_score", "legacy_link_bearing_decision", "legacy_link_bearing_reason",
  "packet_role", "source_quality_score", "source_quality_label", "publisher_name", "publication_venue", "source_type",
  "human_review", "human_notes", "debug_ids",
];

export const LOAD_HEADERS = [
  "content_id", "case_claim_id", "case_claim_text",
  "legacy_search_candidates", "legacy_urls_scraped", "legacy_quote_extraction_calls",
  "legacy_source_claim_extraction_calls", "legacy_claim_matching_calls", "legacy_adjudication_calls",
  "legacy_total_llm_calls", "legacy_input_tokens", "legacy_output_tokens", "legacy_total_tokens",
  "legacy_estimated_cost_usd", "legacy_elapsed_ms",
  "bearing_search_candidates", "bearing_candidates_scored", "bearing_candidates_skipped_actual",
  "bearing_urls_scraped_actual", "bearing_snippet_bearing_calls", "bearing_quote_extraction_calls_actual",
  "bearing_source_claim_extraction_calls_actual", "bearing_claim_matching_calls_actual",
  "bearing_packet_builder_calls", "bearing_total_llm_calls_actual", "bearing_input_tokens_actual",
  "bearing_output_tokens_actual", "bearing_total_tokens_actual", "bearing_estimated_cost_usd_actual",
  "bearing_elapsed_ms_actual",
  "projected_candidates_skipped", "projected_urls_scraped", "projected_quote_extraction_calls",
  "projected_source_claim_extraction_calls", "projected_claim_matching_calls", "projected_total_llm_calls",
  "projected_input_tokens", "projected_output_tokens", "projected_total_tokens",
  "projected_estimated_cost_usd", "projected_elapsed_ms",
  "urls_scraped_saved", "urls_scraped_saved_pct", "llm_calls_saved", "llm_calls_saved_pct",
  "tokens_saved", "tokens_saved_pct", "estimated_cost_saved_usd", "estimated_cost_saved_pct",
  "elapsed_ms_saved", "elapsed_ms_saved_pct",
  "enable_bearing_shadow", "enable_snippet_bearing_llm", "enable_bearing_gating", "enable_bearing_packet",
  "bearing_config_version", "bearing_prompt_version", "token_usage_is_estimated", "notes",
];

const NA = "not_available";

function bounded(value, limit = 1000) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, limit);
}

function normalizedWords(value) {
  return new Set(
    bounded(value, 3000).toLowerCase().replace(/[^a-z0-9]+/g, " ").split(" ")
      .filter((word) => word.length > 2),
  );
}

function textSimilarity(a, b) {
  const left = normalizedWords(a);
  const right = normalizedWords(b);
  if (left.size === 0 || right.size === 0) return 0;
  let intersection = 0;
  for (const word of left) if (right.has(word)) intersection += 1;
  return intersection / Math.min(left.size, right.size);
}

function sameUrl(a, b) {
  const left = canonicalizeUrl(a) || bounded(a);
  const right = canonicalizeUrl(b) || bounded(b);
  return Boolean(left && right && left === right);
}

function packetRole(item) {
  if (item?.packetRole === "origin_attribution") return "origin";
  if (item?.packetRole === "steelman") return "steelman";
  if (item?.stance === "support") return "support";
  if (item?.stance === "refute") return "refute";
  if (item?.stance === "nuance") return "nuance";
  if (["warrant_test", "backing", "rebuttal_limitation"].includes(item?.packetRole)) return "context";
  return item ? "unknown" : "excluded";
}

function legacyRescore(legacy, evidence, candidates = [], threshold = 0.35) {
  const matches = evidence.filter((item) => sameUrl(item.url, legacy.source_url));
  const scored = matches
    .filter((item) => Number.isFinite(Number(item.bearingScore)))
    .sort((a, b) => Number(b.bearingScore) - Number(a.bearingScore));
  if (scored.length === 0) {
    const candidate = candidates.find((item) => sameUrl(item.url, legacy.source_url));
    const preScore = Number(candidate?.bearingPreScore ?? candidate?.deterministicBearingScore);
    if (!Number.isFinite(preScore)) {
      return { score: NA, decision: "not_scored", reason: "No retained final-bearing passage or pre-scrape bearing score matched this legacy URL." };
    }
    const decision = candidate?.bearingType === "none" || preScore < 0.15
      ? "reject"
      : preScore < threshold ? "downgrade" : "accept";
    return {
      score: preScore,
      decision,
      reason: bounded(candidate?.deterministicBearingReason || `Pre-scrape bearing rescore=${preScore.toFixed(3)}; final passage bearing was unavailable.`, 500),
    };
  }
  const best = scored[0];
  const score = Number(best.bearingScore);
  const decision = best.bearingType === "none" || score < 0.15
    ? "reject"
    : score < threshold ? "downgrade" : "accept";
  return {
    score,
    decision,
    reason: bounded(best.bearingReason || `Best matching passage bearing=${score.toFixed(3)}.`, 500),
  };
}

function linkDebug(legacy, bearing, matchMethod = "") {
  return [
    `task_claim_id=${legacy?.task_claim_id || bearing?.caseClaimId || NA}`,
    `reference_content_id=${legacy?.reference_content_id || bearing?.referenceContentId || NA}`,
    `source_claim_id=${legacy?.reference_claim_id || NA}`,
    `link_id=${legacy?.link_id || NA}`,
    `packet_item_id=${bearing?.evidenceId || NA}`,
    matchMethod ? `match=${matchMethod}` : "",
  ].filter(Boolean).join(";");
}

function baseRow(caseClaim) {
  return Object.fromEntries(CLAIM_LINK_HEADERS.map((header) => [header, ""]));
}

function fillLegacy(row, legacy, rescore) {
  Object.assign(row, {
    legacy_source_claim_id: legacy.reference_claim_id || NA,
    legacy_source_claim_text: legacy.reference_claim_text || legacy.evidence_text || NA,
    legacy_source_url: legacy.source_url || NA,
    legacy_source_title: legacy.source_title || NA,
    legacy_stance: legacy.stance || NA,
    legacy_confidence: legacy.confidence ?? NA,
    legacy_support_level: legacy.support_level ?? NA,
    legacy_veracity: legacy.veracity ?? NA,
    legacy_link_bearing_score: rescore.score,
    legacy_link_bearing_decision: rescore.decision,
    legacy_link_bearing_reason: rescore.reason,
    source_quality_score: legacy.source_quality_score ?? NA,
    source_quality_label: legacy.source_quality_label || NA,
    publisher_name: legacy.publisher_name || NA,
    publication_venue: legacy.publication_venue || NA,
    source_type: legacy.source_type || NA,
  });
}

function fillBearing(row, bearing, sourceMeta = {}) {
  Object.assign(row, {
    bearing_source_claim_id: bearing.sourceClaimId || NA,
    bearing_source_claim_text: bearing.sourceClaimText || bearing.quote || NA,
    bearing_source_url: bearing.url || NA,
    bearing_source_title: bearing.title || sourceMeta.source_title || NA,
    bearing_stance: bearing.stance || NA,
    bearing_score: bearing.finalBearing ?? bearing.bearingScore ?? NA,
    bearing_type: bearing.bearingType || NA,
    claim_component_addressed: bearing.claimComponentAddressed || NA,
    causal_strength: bearing.causalStrength || NA,
    bearing_reason: bearing.inclusionReason || bearing.bearingReason || NA,
    packet_role: packetRole(bearing),
    source_quality_score: bearing.qualityScore ?? sourceMeta.source_quality_score ?? NA,
    source_quality_label: bearing.qualityLabel || sourceMeta.source_quality_label || NA,
    publisher_name: sourceMeta.publisher_name || NA,
    publication_venue: sourceMeta.publication_venue || NA,
    source_type: sourceMeta.source_type || NA,
  });
}

export function buildClaimLinkComparisonRows({
  caseClaims = [],
  legacyLinks = [],
  snapshot = null,
  sourceMetadataByContentId = {},
} = {}) {
  const rows = [];
  const resultByClaimId = new Map((snapshot?.results || []).map((result) => [Number(result.claim.id), result]));
  for (const caseClaim of caseClaims) {
    const result = resultByClaimId.get(Number(caseClaim.claim_id));
    const evidence = result?.evidence || [];
    const bearingItems = [...(result?.evidencePacket?.items || [])];
    const legacyItems = legacyLinks.filter((link) => Number(link.task_claim_id) === Number(caseClaim.claim_id));
    const usedBearing = new Set();

    for (const legacy of legacyItems) {
      const rescore = legacyRescore(
        legacy,
        evidence,
        result?.candidates || [],
        snapshot?.bearingConfig?.minBearingToScrape || 0.35,
      );
      let matchMethod = "";
      let matchIndex = bearingItems.findIndex((bearing, index) =>
        !usedBearing.has(index) && legacy.reference_claim_id &&
        Number(bearing.sourceClaimId) === Number(legacy.reference_claim_id),
      );
      if (matchIndex >= 0) {
        matchMethod = "source_claim_id";
      } else {
        matchIndex = bearingItems.findIndex((bearing, index) =>
          !usedBearing.has(index) && sameUrl(legacy.source_url, bearing.url) &&
          textSimilarity(legacy.reference_claim_text || legacy.evidence_text, bearing.quote || bearing.summary) >= 0.35,
        );
        if (matchIndex >= 0) matchMethod = "url_text_similarity";
      }
      const bearing = matchIndex >= 0 ? bearingItems[matchIndex] : null;
      if (bearing) usedBearing.add(matchIndex);
      const row = baseRow(caseClaim);
      row.case_claim_id = caseClaim.claim_id;
      row.case_claim_text = caseClaim.claim_text;
      row.comparison_bucket = rescore.decision === "reject"
        ? "legacy_rejected"
        : rescore.decision === "downgrade"
          ? "legacy_downgraded"
          : bearing ? "both" : "legacy_only";
      fillLegacy(row, legacy, rescore);
      if (bearing) fillBearing(row, bearing, sourceMetadataByContentId[bearing.referenceContentId] || {});
      row.debug_ids = linkDebug(legacy, bearing, bearing ? matchMethod : "");
      rows.push(row);
    }

    bearingItems.forEach((bearing, index) => {
      if (usedBearing.has(index)) return;
      const row = baseRow(caseClaim);
      row.case_claim_id = caseClaim.claim_id;
      row.case_claim_text = caseClaim.claim_text;
      row.comparison_bucket = Number(bearing.finalBearing) >= 0.65 ? "bearing_upgraded" : "bearing_only";
      fillBearing(row, bearing, sourceMetadataByContentId[bearing.referenceContentId] || {});
      row.debug_ids = linkDebug(null, { ...bearing, caseClaimId: caseClaim.claim_id });
      rows.push(row);
    });
  }
  return rows;
}

function percent(saved, baseline) {
  return Number.isFinite(saved) && Number.isFinite(baseline) && baseline > 0
    ? Number(((saved / baseline) * 100).toFixed(2))
    : NA;
}

function estimatedCost(inputTokens, outputTokens, rates = {}) {
  const inputRate = Number(rates.inputPerMillion);
  const outputRate = Number(rates.outputPerMillion);
  if (!Number.isFinite(inputRate) || !Number.isFinite(outputRate)) return NA;
  return Number((((inputTokens / 1_000_000) * inputRate) + ((outputTokens / 1_000_000) * outputRate)).toFixed(6));
}

export function buildLoadComparisonRows({
  contentId,
  caseClaims = [],
  snapshot = null,
  legacyStatsByClaimId = {},
  costRates = {},
} = {}) {
  if (!snapshot) {
    return caseClaims.map((claim) => Object.fromEntries(LOAD_HEADERS.map((header) => [header,
      header === "content_id" ? contentId
        : header === "case_claim_id" ? claim.claim_id
          : header === "case_claim_text" ? claim.claim_text
            : header === "token_usage_is_estimated" ? true
              : header === "notes" ? "No in-memory bearing run snapshot is available; restart-safe telemetry is not persisted in this version."
                : NA,
    ])));
  }

  const resultByClaimId = new Map(snapshot.results.map((result) => [Number(result.claim.id), result]));
  const claimCount = Math.max(1, snapshot.results.length);
  const perClaimElapsed = snapshot.elapsedMs / claimCount;
  return caseClaims.map((claim) => {
    const result = resultByClaimId.get(Number(claim.claim_id));
    const stats = legacyStatsByClaimId[claim.claim_id] || {};
    const candidates = result?.candidates || [];
    const evidence = result?.evidence || [];
    const actualUrls = new Set(evidence.map((item) => canonicalizeUrl(item.url) || item.url).filter(Boolean));
    const projected = snapshot.projectedGating?.selectedByClaimId?.[claim.claim_id] || [];
    const projectedUrls = new Set(projected.map((item) => canonicalizeUrl(item.url) || item.url).filter(Boolean));
    const legacyAvailable = !snapshot.flags.enableBearingGating;
    const legacyUrls = actualUrls.size;
    const sourceCalls = Number(stats.distinct_reference_contents ?? actualUrls.size);
    const sourceChars = Number(stats.source_content_chars || 0);
    const sourceClaimChars = Number(stats.source_claim_chars || 0);
    const quoteChars = evidence.reduce((sum, item) => sum + bounded(item.quote, 5000).length, 0);
    const claimChars = bounded(claim.claim_text, 3000).length;
    const legacyInput = Math.ceil((sourceChars * 2 + sourceClaimChars + claimChars * Math.max(1, sourceCalls * 2)) / 4);
    const legacyOutput = Math.ceil((sourceClaimChars + quoteChars) / 4);
    const snippetInput = snapshot.flags.enableSnippetBearingLlm
      ? Math.ceil(candidates.reduce((sum, item) => sum + bounded(`${item.title} ${item.snippet}`, 1200).length, 0) / 4)
      : 0;
    const snippetOutput = snapshot.flags.enableSnippetBearingLlm ? candidates.length * 20 : 0;
    const legacyLlmCalls = legacyUrls + sourceCalls + sourceCalls;
    const bearingLlmCalls = legacyLlmCalls + (snapshot.flags.enableSnippetBearingLlm && candidates.length ? 1 : 0);
    const bearingInput = legacyInput + snippetInput;
    const bearingOutput = legacyOutput + snippetOutput;
    const projectedRatio = legacyUrls > 0 ? Math.min(1, projectedUrls.size / legacyUrls) : 0;
    const projectedDownstreamCalls = projectedUrls.size * 3;
    const projectedLlmCalls = projectedDownstreamCalls + (snapshot.flags.enableSnippetBearingLlm && candidates.length ? 1 : 0);
    const projectedInput = Math.ceil(legacyInput * projectedRatio + snippetInput);
    const projectedOutput = Math.ceil(legacyOutput * projectedRatio + snippetOutput);
    const legacyTotal = legacyInput + legacyOutput;
    const bearingTotal = bearingInput + bearingOutput;
    const projectedTotal = projectedInput + projectedOutput;
    const projectedElapsed = Math.round(perClaimElapsed * (0.3 + 0.7 * projectedRatio));
    const legacyCost = estimatedCost(legacyInput, legacyOutput, costRates);
    const bearingCost = estimatedCost(bearingInput, bearingOutput, costRates);
    const projectedCost = estimatedCost(projectedInput, projectedOutput, costRates);
    const savedCost = typeof legacyCost === "number" && typeof projectedCost === "number"
      ? Number((legacyCost - projectedCost).toFixed(6)) : NA;
    const urlsSaved = legacyAvailable ? legacyUrls - projectedUrls.size : NA;
    const callsSaved = legacyAvailable ? legacyLlmCalls - projectedLlmCalls : NA;
    const tokensSaved = legacyAvailable ? legacyTotal - projectedTotal : NA;
    const elapsedSaved = legacyAvailable ? Math.round(perClaimElapsed - projectedElapsed) : NA;
    const row = Object.fromEntries(LOAD_HEADERS.map((header) => [header, NA]));
    Object.assign(row, {
      content_id: contentId,
      case_claim_id: claim.claim_id,
      case_claim_text: claim.claim_text,
      legacy_search_candidates: legacyAvailable ? candidates.length : NA,
      legacy_urls_scraped: legacyAvailable ? legacyUrls : NA,
      legacy_quote_extraction_calls: legacyAvailable ? legacyUrls : NA,
      legacy_source_claim_extraction_calls: legacyAvailable ? sourceCalls : NA,
      legacy_claim_matching_calls: legacyAvailable ? sourceCalls : NA,
      legacy_adjudication_calls: legacyAvailable ? 1 : NA,
      legacy_total_llm_calls: legacyAvailable ? legacyLlmCalls : NA,
      legacy_input_tokens: legacyAvailable ? legacyInput : NA,
      legacy_output_tokens: legacyAvailable ? legacyOutput : NA,
      legacy_total_tokens: legacyAvailable ? legacyTotal : NA,
      legacy_estimated_cost_usd: legacyAvailable ? legacyCost : NA,
      legacy_elapsed_ms: legacyAvailable ? Math.round(perClaimElapsed) : NA,
      bearing_search_candidates: candidates.length,
      bearing_candidates_scored: candidates.filter((item) => Number.isFinite(Number(item.deterministicBearingScore))).length,
      bearing_candidates_skipped_actual: snapshot.flags.enableBearingGating ? Math.max(0, candidates.length - (result?.selectedCandidates?.length || 0)) : 0,
      bearing_urls_scraped_actual: actualUrls.size,
      bearing_snippet_bearing_calls: snapshot.flags.enableSnippetBearingLlm && candidates.length ? 1 : 0,
      bearing_quote_extraction_calls_actual: actualUrls.size,
      bearing_source_claim_extraction_calls_actual: sourceCalls,
      bearing_claim_matching_calls_actual: sourceCalls,
      bearing_packet_builder_calls: result ? 1 : 0,
      bearing_total_llm_calls_actual: bearingLlmCalls,
      bearing_input_tokens_actual: bearingInput,
      bearing_output_tokens_actual: bearingOutput,
      bearing_total_tokens_actual: bearingTotal,
      bearing_estimated_cost_usd_actual: bearingCost,
      bearing_elapsed_ms_actual: Math.round(perClaimElapsed),
      projected_candidates_skipped: Math.max(0, candidates.length - projected.length),
      projected_urls_scraped: projectedUrls.size,
      projected_quote_extraction_calls: projectedUrls.size,
      projected_source_claim_extraction_calls: projectedUrls.size,
      projected_claim_matching_calls: projectedUrls.size,
      projected_total_llm_calls: projectedLlmCalls,
      projected_input_tokens: projectedInput,
      projected_output_tokens: projectedOutput,
      projected_total_tokens: projectedTotal,
      projected_estimated_cost_usd: projectedCost,
      projected_elapsed_ms: projectedElapsed,
      urls_scraped_saved: urlsSaved,
      urls_scraped_saved_pct: typeof urlsSaved === "number" ? percent(urlsSaved, legacyUrls) : NA,
      llm_calls_saved: callsSaved,
      llm_calls_saved_pct: typeof callsSaved === "number" ? percent(callsSaved, legacyLlmCalls) : NA,
      tokens_saved: tokensSaved,
      tokens_saved_pct: typeof tokensSaved === "number" ? percent(tokensSaved, legacyTotal) : NA,
      estimated_cost_saved_usd: savedCost,
      estimated_cost_saved_pct: typeof savedCost === "number" && typeof legacyCost === "number" ? percent(savedCost, legacyCost) : NA,
      elapsed_ms_saved: elapsedSaved,
      elapsed_ms_saved_pct: typeof elapsedSaved === "number" ? percent(elapsedSaved, perClaimElapsed) : NA,
      enable_bearing_shadow: snapshot.flags.enableBearingShadow,
      enable_snippet_bearing_llm: snapshot.flags.enableSnippetBearingLlm,
      enable_bearing_gating: snapshot.flags.enableBearingGating,
      enable_bearing_packet: snapshot.flags.enableBearingPacket,
      bearing_config_version: snapshot.bearingConfig.version || 1,
      bearing_prompt_version: 1,
      token_usage_is_estimated: true,
      notes: [
        "Token counts are conservative character/4 estimates because historical OpenAI usage metadata is not retained.",
        "Packet builder is deterministic and is not included in total LLM calls.",
        snapshot.flags.enableBearingGating
          ? "Legacy actual load is unavailable because this run used live bearing gating."
          : "Shadow actual skipped work is zero; savings columns compare legacy actual with projected gated load.",
        typeof legacyCost !== "number" ? "Cost is not_available until OPENAI_INPUT_COST_PER_1M and OPENAI_OUTPUT_COST_PER_1M are configured." : "",
      ].filter(Boolean).join(" "),
    });
    return row;
  });
}

function csvCell(value) {
  if (value === null || value === undefined) return "";
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function rowsToCsv({ title, metadata = {}, headers, rows }) {
  const metadataText = `${title} | ${Object.entries(metadata).map(([key, value]) => `${key}=${value}`).join(" | ")}`;
  return [
    [metadataText],
    headers,
    ...rows.map((row) => headers.map((header) => row[header] ?? "")),
  ].map((row) => row.map(csvCell).join(",")).join("\r\n");
}

async function optionalQuery(query, sql, params = []) {
  try {
    return await query(sql, params);
  } catch {
    return [];
  }
}

export async function loadEvidenceComparisonDbData(query, contentId, snapshot = null) {
  const contentRows = await query(
    `SELECT content_id, content_name, url, media_source, CHAR_LENGTH(COALESCE(content_text, '')) AS content_text_chars
       FROM content WHERE content_id = ? LIMIT 1`,
    [contentId],
  );
  if (!contentRows.length) return null;

  let caseClaims = await query(
    `SELECT c.claim_id, c.claim_text
       FROM content_claims cc
       JOIN claims c ON c.claim_id = cc.claim_id
      WHERE cc.content_id = ? AND cc.relationship_type IN ('task', 'content')
      ORDER BY COALESCE(cc.claim_order, 999999), c.claim_id`,
    [contentId],
  );
  if (!caseClaims.length) {
    caseClaims = await query(
      `SELECT c.claim_id, c.claim_text
         FROM content_claims cc JOIN claims c ON c.claim_id = cc.claim_id
        WHERE cc.content_id = ? ORDER BY COALESCE(cc.claim_order, 999999), c.claim_id`,
      [contentId],
    );
  }

  const claimLinks = await optionalQuery(query, `
    SELECT
      rctl.reference_claim_task_links_id AS link_id,
      rctl.reference_claim_id,
      rctl.task_claim_id,
      rctl.stance,
      rctl.confidence,
      rctl.support_level,
      rctl.score AS veracity,
      rctl.rationale,
      rctl.quote AS evidence_text,
      ref_claim.claim_text AS reference_claim_text,
      ref_content.content_id AS reference_content_id,
      ref_content.url AS source_url,
      ref_content.content_name AS source_title,
      CHAR_LENGTH(COALESCE(ref_content.content_text, '')) AS source_content_chars
    FROM reference_claim_task_links rctl
    JOIN claims ref_claim ON ref_claim.claim_id = rctl.reference_claim_id
    LEFT JOIN content ref_content ON ref_content.content_id = (
      SELECT cc.content_id FROM content_claims cc JOIN content rc ON rc.content_id = cc.content_id
       WHERE cc.claim_id = rctl.reference_claim_id AND rc.content_id <> ?
       ORDER BY CASE WHEN rc.content_type IN ('reference', 'both') THEN 0 ELSE 1 END, cc.content_id DESC LIMIT 1
    )
    WHERE rctl.task_claim_id IN (?)
    ORDER BY rctl.task_claim_id, rctl.reference_claim_task_links_id`,
  [contentId, caseClaims.map((claim) => claim.claim_id)]);

  const documentLinks = await optionalQuery(query, `
    SELECT
      CONCAT('rcl:', rcl.claim_id, ':', rcl.reference_content_id) AS link_id,
      NULL AS reference_claim_id,
      rcl.claim_id AS task_claim_id,
      rcl.stance,
      rcl.confidence,
      rcl.support_level,
      rcl.score AS veracity,
      rcl.rationale,
      rcl.evidence_text,
      NULL AS reference_claim_text,
      ref_content.content_id AS reference_content_id,
      ref_content.url AS source_url,
      ref_content.content_name AS source_title,
      CHAR_LENGTH(COALESCE(ref_content.content_text, '')) AS source_content_chars
    FROM reference_claim_links rcl
    JOIN content ref_content ON ref_content.content_id = rcl.reference_content_id
    WHERE rcl.claim_id IN (?)
    ORDER BY rcl.claim_id, rcl.reference_content_id`,
  [caseClaims.map((claim) => claim.claim_id)]);

  let legacyLinks = [...claimLinks, ...documentLinks];
  const packetContentIds = [...new Set(
    (snapshot?.results || []).flatMap((result) => result.evidencePacket?.items || [])
      .map((item) => Number(item.referenceContentId)).filter(Boolean),
  )];
  const metadataContentIds = [...new Set([
    ...legacyLinks.map((link) => Number(link.reference_content_id)).filter(Boolean),
    ...packetContentIds,
  ])];
  let packetMetadata = metadataContentIds.length ? await optionalQuery(query, `
    SELECT
      ref_content.content_id AS reference_content_id,
      ref_content.content_name AS source_title,
      sqs.quality_score AS source_quality_score,
      sqs.quality_tier AS source_quality_label,
      (SELECT p.publisher_name FROM content_publishers cp JOIN publishers p ON p.publisher_id = cp.publisher_id
        WHERE cp.content_id = ref_content.content_id ORDER BY COALESCE(cp.is_primary, 0) DESC, cp.content_publisher_id DESC LIMIT 1) AS publisher_name,
      (SELECT cpc.venue_name FROM content_publishing_context cpc WHERE cpc.content_id = ref_content.content_id
        ORDER BY cpc.context_id DESC LIMIT 1) AS publication_venue,
      (SELECT p.source_type FROM content_publishers cp JOIN publishers p ON p.publisher_id = cp.publisher_id
        WHERE cp.content_id = ref_content.content_id ORDER BY COALESCE(cp.is_primary, 0) DESC, cp.content_publisher_id DESC LIMIT 1) AS source_type
    FROM content ref_content LEFT JOIN source_quality_scores sqs ON sqs.content_id = ref_content.content_id
    WHERE ref_content.content_id IN (?)`, [metadataContentIds]) : [];
  if (metadataContentIds.length && !packetMetadata.length) {
    packetMetadata = await optionalQuery(query, `
      SELECT ref_content.content_id AS reference_content_id,
             ref_content.content_name AS source_title,
             sqs.quality_score AS source_quality_score,
             sqs.quality_tier AS source_quality_label,
             (SELECT p.publisher_name FROM content_publishers cp JOIN publishers p ON p.publisher_id = cp.publisher_id
               WHERE cp.content_id = ref_content.content_id ORDER BY cp.content_publisher_id DESC LIMIT 1) AS publisher_name,
             NULL AS publication_venue,
             (SELECT p.source_type FROM content_publishers cp JOIN publishers p ON p.publisher_id = cp.publisher_id
               WHERE cp.content_id = ref_content.content_id ORDER BY cp.content_publisher_id DESC LIMIT 1) AS source_type
        FROM content ref_content LEFT JOIN source_quality_scores sqs ON sqs.content_id = ref_content.content_id
       WHERE ref_content.content_id IN (?)`, [metadataContentIds]);
  }

  const sourceMetadataByContentId = Object.fromEntries(
    packetMetadata.map((item) => [Number(item.reference_content_id), item]),
  );
  legacyLinks = legacyLinks.map((link) => ({
    ...link,
    ...(sourceMetadataByContentId[Number(link.reference_content_id)] || {}),
  }));
  const legacyStatsByClaimId = {};
  for (const claim of caseClaims) {
    const links = legacyLinks.filter((link) => Number(link.task_claim_id) === Number(claim.claim_id));
    const uniqueReferences = new Map();
    for (const link of links) {
      const key = link.reference_content_id || link.source_url;
      if (key && !uniqueReferences.has(key)) uniqueReferences.set(key, link);
    }
    legacyStatsByClaimId[claim.claim_id] = {
      distinct_reference_contents: uniqueReferences.size,
      source_content_chars: [...uniqueReferences.values()].reduce((sum, item) => sum + Number(item.source_content_chars || 0), 0),
      source_claim_chars: links.reduce((sum, item) => sum + bounded(item.reference_claim_text || item.evidence_text, 5000).length, 0),
    };
  }

  return {
    content: contentRows[0],
    caseClaims,
    legacyLinks,
    sourceMetadataByContentId,
    legacyStatsByClaimId,
  };
}
