import { createHash } from "node:crypto";

const ID_RE = /^[A-Za-z0-9._:-]{1,191}$/;
const SHA_RE = /^[a-f0-9]{64}$/;
const TERMINAL = new Set(["completed", "failed", "expired"]);

const hash = (value) => value == null
  ? null
  : createHash("sha256").update(String(value)).digest("hex");

function boundedId(value, name) {
  const normalized = String(value || "").trim();
  if (!ID_RE.test(normalized)) throw new TypeError(`${name} must be a non-empty bounded identifier`);
  return normalized;
}

function positiveInteger(value, name, nullable = false) {
  if (nullable && (value === null || value === undefined || value === "")) return null;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) throw new TypeError(`${name} must be a positive integer${nullable ? " or null" : ""}`);
  return number;
}

function externalUrl(value, name, nullable = false) {
  if (nullable && (value === null || value === undefined || value === "")) return null;
  let parsed;
  try { parsed = new URL(String(value || "").trim()); } catch { throw new TypeError(`${name} must be an absolute URL`); }
  if (!["http:", "https:"].includes(parsed.protocol)) throw new TypeError(`${name} must use http or https`);
  return parsed.toString();
}

function json(value) {
  return JSON.stringify(value ?? null);
}

function normalizedResolvedUrl(value) {
  const parsed = new URL(externalUrl(value, "resolvedUrl"));
  parsed.hash = "";
  parsed.hostname = parsed.hostname.toLowerCase();
  if ((parsed.protocol === "https:" && parsed.port === "443")
    || (parsed.protocol === "http:" && parsed.port === "80")) parsed.port = "";
  parsed.searchParams.sort();
  return parsed.toString();
}

export function normalizeEvidenceScrapeContext(raw, fallback = {}) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new TypeError("evidenceContext must be an object");
  const openedTabId = positiveInteger(raw.openedTabId, "openedTabId", true);
  const extensionInstanceId = raw.extensionInstanceId ? boundedId(raw.extensionInstanceId, "extensionInstanceId") : null;
  if (openedTabId && !extensionInstanceId) throw new TypeError("extensionInstanceId is required when openedTabId is supplied");
  const s2ArtifactSha256 = String(raw.s2ArtifactSha256 || "").toLowerCase();
  if (!SHA_RE.test(s2ArtifactSha256)) throw new TypeError("s2ArtifactSha256 must be a lowercase SHA-256");
  const groundingUnitIds = Array.isArray(raw.groundingUnitIds) ? raw.groundingUnitIds.map((id) => boundedId(id, "groundingUnitId")) : [];
  if (!groundingUnitIds.length) throw new TypeError("groundingUnitIds must be non-empty");
  return Object.freeze({
    runId: boundedId(raw.runId, "runId"),
    canonicalDocumentId: positiveInteger(raw.canonicalDocumentId, "canonicalDocumentId", true),
    propositionId: boundedId(raw.propositionId, "propositionId"),
    candidateId: boundedId(raw.candidateId, "candidateId"),
    acquisitionArtifactId: boundedId(raw.acquisitionArtifactId, "acquisitionArtifactId"),
    taskContentId: positiveInteger(raw.taskContentId ?? fallback.taskContentId, "taskContentId"),
    targetClaimId: positiveInteger(raw.targetClaimId, "targetClaimId"),
    referenceContentId: positiveInteger(raw.referenceContentId ?? raw.priorReferenceContentId, "referenceContentId", true),
    s2ArtifactPath: String(raw.s2ArtifactPath || "").trim(),
    s2ArtifactSha256,
    groundingUnitIds,
    requestedUrl: externalUrl(raw.requestedUrl ?? fallback.requestedUrl, "requestedUrl"),
    openedTabId,
    extensionInstanceId,
  });
}

export async function insertEvidenceScrapeBinding(query, { scrapeJobId = null, context }) {
  const jobId = positiveInteger(scrapeJobId, "scrapeJobId", true);
  const value = normalizeEvidenceScrapeContext(context);
  const result = await query(
    `INSERT INTO cfx_evidence_acquisition_bindings
       (canonical_document_id,scrape_job_id,task_content_id,target_claim_id,reference_content_id,run_id,
        proposition_id,candidate_id,acquisition_artifact_id,s2_artifact_path,
        s2_artifact_sha256,grounding_unit_ids_json,requested_url,opened_tab_id,
        extension_instance_id)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [value.canonicalDocumentId, jobId, value.taskContentId, value.targetClaimId, value.referenceContentId,
      value.runId, value.propositionId, value.candidateId,
      value.acquisitionArtifactId, value.s2ArtifactPath, value.s2ArtifactSha256,
      json(value.groundingUnitIds), value.requestedUrl, value.openedTabId,
      value.extensionInstanceId],
  );
  return Object.freeze({ bindingId: Number(result?.insertId) || null, scrapeJobId: jobId, ...value });
}

export async function getEvidenceScrapeBinding(query, scrapeJobId) {
  const jobId = positiveInteger(scrapeJobId, "scrapeJobId", true);
  if (!jobId) return null;
  const rows = await query(
    `SELECT binding_id,canonical_document_id,scrape_job_id,task_content_id,target_claim_id,
            reference_content_id,run_id,proposition_id,candidate_id,
            acquisition_artifact_id,s2_artifact_path,s2_artifact_sha256,
            grounding_unit_ids_json,requested_url,opened_tab_id,
            extension_instance_id
       FROM cfx_evidence_acquisition_bindings WHERE scrape_job_id=? LIMIT 1`,
    [jobId],
  );
  const row = rows?.[0];
  if (!row) return null;
  const unitIds = typeof row.grounding_unit_ids_json === "string"
    ? JSON.parse(row.grounding_unit_ids_json)
    : row.grounding_unit_ids_json;
  return Object.freeze({
    bindingId: Number(row.binding_id), scrapeJobId: Number(row.scrape_job_id),
    canonicalDocumentId: row.canonical_document_id == null ? null : Number(row.canonical_document_id),
    taskContentId: Number(row.task_content_id), targetClaimId: Number(row.target_claim_id),
    referenceContentId: row.reference_content_id == null ? null : Number(row.reference_content_id),
    runId: row.run_id, propositionId: row.proposition_id, candidateId: row.candidate_id,
    acquisitionArtifactId: row.acquisition_artifact_id,
    s2ArtifactPath: row.s2_artifact_path, s2ArtifactSha256: row.s2_artifact_sha256,
    groundingUnitIds: unitIds, requestedUrl: row.requested_url,
    openedTabId: row.opened_tab_id == null ? null : Number(row.opened_tab_id),
    extensionInstanceId: row.extension_instance_id,
  });
}

export async function persistEvidenceAcquisitionAttempt(query, input) {
  const bindingId = positiveInteger(input.binding?.bindingId, "bindingId");
  const raw = input.rawResponse == null ? null : String(input.rawResponse);
  let attemptOrdinal = input.attemptOrdinal;
  if (attemptOrdinal === null || attemptOrdinal === undefined) {
    const rows = await query(
      "SELECT COALESCE(MAX(attempt_ordinal),0)+1 AS next_ordinal FROM cfx_evidence_acquisition_attempts WHERE binding_id=?",
      [bindingId],
    );
    attemptOrdinal = Number(rows?.[0]?.next_ordinal) || 1;
  }
  const result = await query(
    `INSERT INTO cfx_evidence_acquisition_attempts
       (binding_id,attempt_ordinal,acquisition_lane,provider,request_url,
        resolved_url,outcome,http_status,provider_request_id,error_code,
        error_message,raw_response,raw_response_sha256,response_metadata_json,
        started_at,completed_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [bindingId, positiveInteger(attemptOrdinal, "attemptOrdinal"),
      input.acquisitionLane || "production_scrape", input.provider || "extension",
      externalUrl(input.requestUrl ?? input.binding.requestedUrl, "requestUrl"),
      externalUrl(input.resolvedUrl, "resolvedUrl", true), input.outcome || "acquired",
      input.httpStatus ?? null, input.providerRequestId ?? null, input.errorCode ?? null,
      input.errorMessage ?? null, raw, hash(raw), json(input.responseMetadata ?? null),
      input.startedAt ?? new Date(), input.completedAt ?? new Date()],
  );
  return Object.freeze({ acquisitionAttemptId: Number(result?.insertId) || null, rawResponseSha256: hash(raw) });
}

const REUSABLE_ACCESS_LEVELS = new Set(["full_text", "substantial_excerpt", "abstract"]);

/**
 * Resolve the latest validated text for a canonical document across run- and
 * assertion-specific acquisition bindings. The immutable versions stay bound
 * to their original acquisitions; this is only a document-scoped read seam.
 */
export async function findReusableEvidenceTextVersion(query, {
  canonicalDocumentId = null,
  referenceContentId = null,
  pmid = null,
  doi = null,
  canonicalUrl = null,
  normalizedResolvedUrl: resolvedIdentityUrl = null,
  maximumAgeMs = 30 * 24 * 60 * 60 * 1000,
  now = new Date(),
  minimumCharacterCount = 100,
} = {}) {
  const canonicalId = positiveInteger(canonicalDocumentId, "canonicalDocumentId", true);
  const contentId = positiveInteger(referenceContentId, "referenceContentId", true);
  const pmidValue = String(pmid || "").trim() || null;
  const doiValue = String(doi || "").trim().toLowerCase() || null;
  const canonicalUrlValue = canonicalUrl ? normalizedResolvedUrl(canonicalUrl) : null;
  const resolvedUrlValue = resolvedIdentityUrl ? normalizedResolvedUrl(resolvedIdentityUrl) : null;
  if (!canonicalId && !contentId && !pmidValue && !doiValue && !canonicalUrlValue && !resolvedUrlValue) return null;
  if (!Number.isFinite(maximumAgeMs) || maximumAgeMs < 0) {
    throw new TypeError("maximumAgeMs must be a non-negative finite number");
  }
  const rows = await query(
    `SELECT t.acquired_text_version_id,t.binding_id,t.reference_content_id,
            t.access_level,t.extraction_method,t.source_url,t.resolved_url,
            t.cleaned_text,t.cleaned_text_sha256,t.character_count,t.word_count,
            t.created_at,b.canonical_document_id,b.run_id
       FROM cfx_evidence_text_versions t
       JOIN cfx_evidence_acquisition_bindings b ON b.binding_id=t.binding_id
       JOIN cfx_canonical_documents d ON d.canonical_document_id=b.canonical_document_id
      WHERE t.selected_for_bearing=1
        AND t.access_level IN ('full_text','substantial_excerpt','abstract')
        AND t.character_count>=?
        AND ((? IS NOT NULL AND b.canonical_document_id=?)
          OR (? IS NOT NULL AND t.reference_content_id=?)
          OR (? IS NOT NULL AND d.pmid=?)
          OR (? IS NOT NULL AND LOWER(d.doi)=?)
          OR (? IS NOT NULL AND d.canonical_url=?)
          OR (? IS NOT NULL AND d.normalized_resolved_url=?))
      ORDER BY (b.canonical_document_id=?) DESC,t.created_at DESC,
               t.acquired_text_version_id DESC
      LIMIT 1`,
    [minimumCharacterCount,
      canonicalId, canonicalId, contentId, contentId,
      pmidValue, pmidValue, doiValue, doiValue,
      canonicalUrlValue, canonicalUrlValue, resolvedUrlValue, resolvedUrlValue,
      canonicalId],
  );
  const row = rows?.[0];
  if (!row || !REUSABLE_ACCESS_LEVELS.has(String(row.access_level))) return null;
  const createdAt = new Date(row.created_at);
  const ageMs = new Date(now).getTime() - createdAt.getTime();
  if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > maximumAgeMs) return null;
  const cleanedText = String(row.cleaned_text || "");
  if (cleanedText.trim().length < minimumCharacterCount) return null;
  if (hash(cleanedText) !== String(row.cleaned_text_sha256 || "")) return null;
  return Object.freeze({
    acquiredTextVersionId: Number(row.acquired_text_version_id),
    bindingId: Number(row.binding_id),
    canonicalDocumentId: row.canonical_document_id == null ? null : Number(row.canonical_document_id),
    referenceContentId: Number(row.reference_content_id),
    sourceRunId: row.run_id,
    accessLevel: row.access_level,
    extractionMethod: row.extraction_method,
    sourceUrl: row.source_url,
    resolvedUrl: row.resolved_url,
    cleanedText,
    cleanedTextSha256: row.cleaned_text_sha256,
    characterCount: Number(row.character_count),
    wordCount: Number(row.word_count),
    createdAt: createdAt.toISOString(),
    ageMs,
    cacheState: "persisted_text_reuse",
  });
}

export async function persistEvidenceTextVersion(query, input) {
  const clean = String(input.cleanedText || "");
  if (!clean.trim()) throw new TypeError("cleanedText is required");
  const bindingId = positiveInteger(input.binding.bindingId, "bindingId");
  const cleanHash = hash(clean);
  const selected = await query(
    `SELECT acquired_text_version_id,cleaned_text_sha256
       FROM cfx_evidence_text_versions
      WHERE binding_id=? AND selected_for_bearing=1
      ORDER BY acquired_text_version_id DESC LIMIT 1 FOR UPDATE`,
    [bindingId],
  );
  const previous = selected?.[0] || null;
  const supersedes = previous && previous.cleaned_text_sha256 !== cleanHash
    ? Number(previous.acquired_text_version_id)
    : null;
  const result = await query(
    `INSERT INTO cfx_evidence_text_versions
       (supersedes_text_version_id,binding_id,acquisition_attempt_id,reference_content_id,access_level,
        extraction_method,source_url,resolved_url,redirect_chain_json,
        cleaned_text,cleaned_text_sha256,character_count,word_count,selected_for_bearing)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON DUPLICATE KEY UPDATE
       acquired_text_version_id=LAST_INSERT_ID(acquired_text_version_id)`,
    [supersedes, bindingId,
      positiveInteger(input.acquisitionAttemptId, "acquisitionAttemptId", true),
      positiveInteger(input.referenceContentId, "referenceContentId"),
      input.accessLevel || "full_text", input.extractionMethod || "extension",
      externalUrl(input.sourceUrl ?? input.binding.requestedUrl, "sourceUrl"),
      externalUrl(input.resolvedUrl, "resolvedUrl", true),
      json(input.redirectChain ?? []), clean, cleanHash, clean.length,
      clean.trim().split(/\s+/u).length, input.selectedForBearing === false ? 0 : 1],
  );
  if (input.selectedForBearing !== false) {
    await query(
      "UPDATE cfx_evidence_text_versions SET selected_for_bearing=0 WHERE binding_id=? AND acquired_text_version_id<>? AND selected_for_bearing=1",
      [bindingId, result.insertId],
    );
  }
  await query(
    "UPDATE cfx_evidence_acquisition_bindings SET reference_content_id=? WHERE binding_id=?",
    [input.referenceContentId, input.binding.bindingId],
  );
  return Object.freeze({
    acquiredTextVersionId: Number(result?.insertId) || null,
    supersedesTextVersionId: supersedes,
    created: !previous || previous.cleaned_text_sha256 !== cleanHash,
    cleanedTextSha256: cleanHash,
    characterCount: clean.length,
    wordCount: clean.trim().split(/\s+/u).length,
  });
}

// Compatibility wrappers used by the established browser route. They now write
// the reconciled attempt/text-version tables, not the superseded receipt/capture tables.
export async function persistRawEvidenceScrapeReceipt(query, input) {
  const raw = input.rawHtml ?? input.rawText;
  if (raw == null) throw new TypeError("rawHtml or rawText is required");
  return persistEvidenceAcquisitionAttempt(query, {
    binding: input.binding, attemptOrdinal: input.attemptOrdinal,
    acquisitionLane: "user_assisted", provider: "extension",
    requestUrl: input.requestedUrl, resolvedUrl: input.resolvedUrl,
    outcome: "acquired", rawResponse: raw,
    responseMetadata: { browserTabId: input.browserTabId ?? null, extensionInstanceId: input.extensionInstanceId ?? null, rawHtmlSha256: hash(input.rawHtml), rawTextSha256: hash(input.rawText) },
  });
}

export async function persistEvidenceScrapeCapture(query, input) {
  const attempt = input.acquisitionAttemptId
    ? { acquisitionAttemptId: input.acquisitionAttemptId }
    : { acquisitionAttemptId: null };
  const cleanedText = String(input.cleanedText || "");
  const structurallyBoundedAccess = input.accessLevel
    || (cleanedText.trim().split(/\s+/u).length >= 80 ? "substantial_excerpt" : "snippet");
  const requestedUrl = externalUrl(input.requestedUrl, "requestedUrl");
  const resolvedUrl = externalUrl(input.resolvedUrl, "resolvedUrl", true);
  const redirectChain = Array.isArray(input.redirectChain)
    ? input.redirectChain
    : resolvedUrl && resolvedUrl !== requestedUrl
      ? [requestedUrl, resolvedUrl]
      : [requestedUrl];
  const version = await persistEvidenceTextVersion(query, {
    binding: input.binding, acquisitionAttemptId: attempt.acquisitionAttemptId,
    referenceContentId: input.referenceContentId, accessLevel: structurallyBoundedAccess,
    extractionMethod: "user_assisted_browser", sourceUrl: requestedUrl,
    resolvedUrl, redirectChain, cleanedText,
    selectedForBearing: true,
  });
  if (input.binding.canonicalDocumentId && resolvedUrl) {
    const normalized = normalizedResolvedUrl(resolvedUrl);
    const identityHash = hash(`resolved_url:${normalized}`);
    const identityMatchHash = hash(`url:${normalized}`);
    await query(
      `UPDATE cfx_canonical_documents
          SET normalized_resolved_url=COALESCE(normalized_resolved_url,?)
        WHERE canonical_document_id=?`,
      [normalized, input.binding.canonicalDocumentId],
    );
    await query(
      `INSERT INTO cfx_canonical_document_identities
         (canonical_document_id,run_id,identity_kind,identity_value,identity_sha256,
          identity_match_sha256)
       VALUES (?,?,'resolved_url',?,?,?)
       ON DUPLICATE KEY UPDATE
         canonical_document_identity_id=canonical_document_identity_id`,
      [input.binding.canonicalDocumentId, input.binding.runId, normalized,
        identityHash, identityMatchHash],
    );
  }
  return Object.freeze({ ...version, scrapeJobId: input.binding.scrapeJobId, acquisitionArtifactId: input.binding.acquisitionArtifactId, rawHtmlSha256: hash(input.rawHtml), rawTextSha256: hash(input.rawText) });
}

export async function publishEvidenceScrapeTerminal(query, input) {
  const jobId = positiveInteger(input.scrapeJobId, "scrapeJobId");
  if (!TERMINAL.has(input.terminalStatus)) throw new TypeError("terminalStatus must be completed, failed, or expired");
  const binding = await getEvidenceScrapeBinding(query, jobId);
  if (!binding) return null;
  const resultContentId = positiveInteger(input.resultContentId, "resultContentId", true);
  await query(
    `INSERT INTO cfx_evidence_terminal_outbox
       (binding_id,scrape_job_id,terminal_status,result_content_id,error_message,payload_json)
     VALUES (?,?,?,?,?,?) ON DUPLICATE KEY UPDATE scrape_job_id=scrape_job_id`,
    [binding.bindingId, jobId, input.terminalStatus, resultContentId,
      input.errorMessage == null ? null : String(input.errorMessage).slice(0, 10_000),
      json({
        runId: binding.runId,
        canonicalDocumentId: binding.canonicalDocumentId,
        propositionId: binding.propositionId,
        candidateId: binding.candidateId,
      })],
  );
  return { ...binding, terminalStatus: input.terminalStatus, resultContentId, errorMessage: input.errorMessage ?? null };
}
