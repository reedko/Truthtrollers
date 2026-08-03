import { createHash } from "node:crypto";
import { withTransaction } from "../storage/dbTransaction.js";
import { insertEvidenceScrapeBinding } from "./cfxEvidenceScrapeAdapter.js";

const INTENTS = new Set([
  "canonical", "entity_predicate", "source_identity", "independent_evidence",
  "counterevidence", "qualification",
]);
const TERMINAL_JOB_STATES = new Set(["completed", "failed", "expired"]);

const sha256 = (value) => createHash("sha256").update(String(value)).digest("hex");

function positive(value, name, nullable = false) {
  if (nullable && (value === null || value === undefined || value === "")) return null;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw new TypeError(`${name} must be a positive integer${nullable ? " or null" : ""}`);
  }
  return number;
}

function bounded(value, name, maximum = 191) {
  const text = String(value || "").trim();
  if (!text || text.length > maximum) throw new TypeError(`${name} is invalid`);
  return text;
}

function json(value) { return JSON.stringify(value ?? null); }

/** Persist one exact-identity group and all aliases without semantic merging. */
export async function upsertCfxCanonicalDocument(query, { runId, document }) {
  const canonicalRunId = bounded(runId, "runId");
  const identityHashes = document.identities.map((identity) => identity.matchHash);
  if (!identityHashes.length) throw new TypeError("document identities are required");
  const placeholders = identityHashes.map(() => "?").join(",");
  const existingAliases = await query(
    `SELECT d.canonical_document_id,d.canonical_identity_kind
       FROM cfx_canonical_document_identities i
       JOIN cfx_canonical_documents d
         ON d.canonical_document_id=i.canonical_document_id
      WHERE i.run_id=? AND i.identity_match_sha256 IN (${placeholders})
      ORDER BY d.canonical_document_id LIMIT 1 FOR UPDATE`,
    [canonicalRunId, ...identityHashes],
  );
  let canonicalDocumentId = existingAliases?.[0]
    ? Number(existingAliases[0].canonical_document_id)
    : null;
  if (!canonicalDocumentId) {
    const inserted = await query(
      `INSERT INTO cfx_canonical_documents
         (run_id,document_key,canonical_identity_kind,canonical_identity_value,
          canonical_identity_sha256,pmid,doi,canonical_url,
          normalized_resolved_url,representative_candidate_id)
       VALUES (?,?,?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE
         canonical_document_id=LAST_INSERT_ID(canonical_document_id)`,
      [canonicalRunId, document.documentKey, document.canonicalIdentity.kind,
        document.canonicalIdentity.value, document.canonicalIdentity.matchHash,
        document.pmid, document.doi, document.canonicalUrl,
        document.normalizedResolvedUrl, document.representative.candidateId],
    );
    canonicalDocumentId = Number(inserted?.insertId);
  }
  if (!canonicalDocumentId) throw new Error("canonical document persistence did not return an identity");

  for (const identity of document.identities) {
    await query(
      `INSERT INTO cfx_canonical_document_identities
         (canonical_document_id,run_id,identity_kind,identity_value,identity_sha256,
          identity_match_sha256)
       VALUES (?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE
         canonical_document_identity_id=canonical_document_identity_id`,
      [canonicalDocumentId, canonicalRunId, identity.kind, identity.value,
        identity.hash, identity.matchHash],
    );
  }
  await query(
    `UPDATE cfx_canonical_documents
        SET pmid=COALESCE(pmid,?),doi=COALESCE(doi,?),
            canonical_url=COALESCE(canonical_url,?),
            normalized_resolved_url=COALESCE(normalized_resolved_url,?)
      WHERE canonical_document_id=?`,
    [document.pmid, document.doi, document.canonicalUrl,
      document.normalizedResolvedUrl, canonicalDocumentId],
  );
  return canonicalDocumentId;
}

/** Every retrieval occurrence is append-only and idempotent by its exact hash. */
export async function persistCfxDiscoveryAssignments(query, {
  runId,
  canonicalDocumentId,
  assignments,
}) {
  const documentId = positive(canonicalDocumentId, "canonicalDocumentId");
  let inserted = 0;
  for (const assignment of assignments) {
    if (!INTENTS.has(assignment.queryIntent)) {
      throw new TypeError(`unsupported queryIntent ${assignment.queryIntent}`);
    }
    const result = await query(
      `INSERT INTO cfx_document_discovery_assignments
         (canonical_document_id,run_id,proposition_id,target_claim_id,candidate_id,
          query_id,query_intent,query_text,provider,retrieval_rank,
          provider_request_id,assignment_sha256)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE
         discovery_assignment_id=LAST_INSERT_ID(discovery_assignment_id)`,
      [documentId, bounded(runId, "runId"), assignment.propositionId,
        positive(assignment.targetClaimId, "targetClaimId"), assignment.candidateId,
        assignment.queryId, assignment.queryIntent, assignment.query,
        assignment.provider, assignment.rank, assignment.requestId,
        assignment.assignmentHash],
    );
    if (Number(result?.affectedRows) === 1) inserted += 1;
  }
  return { assignmentCount: assignments.length, insertedCount: inserted };
}

/**
 * Lock the canonical document, reuse its binding when present, and otherwise
 * create exactly one production scrape job plus one binding in the same
 * transaction. The database unique key is the final concurrency guard.
 */
export async function ensureCfxCanonicalAcquisition({
  pool,
  runId,
  canonicalDocumentId,
  taskContentId,
  targetClaimId,
  referenceContentId,
  userId = null,
  sourceUrl,
  representative,
  sourceArtifactPath,
  sourceArtifactSha256,
  groundingUnitIds,
  queueScrape,
}) {
  return withTransaction(async ({ query }) => {
    await query(
      `SELECT canonical_document_id FROM cfx_canonical_documents
        WHERE canonical_document_id=? AND run_id=? FOR UPDATE`,
      [positive(canonicalDocumentId, "canonicalDocumentId"), bounded(runId, "runId")],
    );
    const existing = await query(
      `SELECT binding_id,scrape_job_id,reference_content_id
         FROM cfx_evidence_acquisition_bindings
        WHERE run_id=? AND canonical_document_id=? LIMIT 1 FOR UPDATE`,
      [runId, canonicalDocumentId],
    );
    if (existing?.[0]) {
      return {
        created: false,
        binding: {
          bindingId: Number(existing[0].binding_id),
          scrapeJobId: existing[0].scrape_job_id == null
            ? null : Number(existing[0].scrape_job_id),
          canonicalDocumentId: Number(canonicalDocumentId),
          runId,
          requestedUrl: sourceUrl,
        },
        referenceContentId: Number(existing[0].reference_content_id),
      };
    }
    const scrapeJob = queueScrape
      ? await query(
          `INSERT INTO scrape_jobs
             (requested_by_user_id,requested_by_source,scrape_mode,target_url,
              task_content_id,status)
           VALUES (?,'api','scrape_specific_url',?,?,'pending')`,
          [userId || null, sourceUrl, taskContentId],
        )
      : null;
    const binding = await insertEvidenceScrapeBinding(query, {
      scrapeJobId: scrapeJob?.insertId ?? null,
      context: {
        canonicalDocumentId,
        runId,
        propositionId: representative.propositionId,
        candidateId: representative.candidateId,
        acquisitionArtifactId: `ACQ-${representative.candidateId}`,
        taskContentId,
        targetClaimId,
        referenceContentId,
        s2ArtifactPath: sourceArtifactPath,
        s2ArtifactSha256: sourceArtifactSha256,
        groundingUnitIds,
        requestedUrl: sourceUrl,
      },
    });
    await query(
      `UPDATE cfx_canonical_documents SET reference_content_id=?
        WHERE canonical_document_id=?`,
      [referenceContentId, canonicalDocumentId],
    );
    return { created: true, binding, referenceContentId };
  }, { pool });
}

/** Retry through the same production queue while preserving one CFX binding. */
export async function retryCfxCanonicalAcquisition({
  pool,
  bindingId,
  userId = null,
  openedTabId = null,
  extensionInstanceId = null,
}) {
  return withTransaction(async ({ query }) => {
    const rows = await query(
      `SELECT b.binding_id,b.scrape_job_id,b.requested_url,b.task_content_id,
              j.status
         FROM cfx_evidence_acquisition_bindings b
         LEFT JOIN scrape_jobs j ON j.scrape_job_id=b.scrape_job_id
        WHERE b.binding_id=? FOR UPDATE`,
      [positive(bindingId, "bindingId")],
    );
    const row = rows?.[0];
    if (!row) throw new Error("CFX acquisition binding not found");
    if (row.scrape_job_id != null && !TERMINAL_JOB_STATES.has(row.status)) {
      return { created: false, scrapeJobId: Number(row.scrape_job_id), status: row.status };
    }
    const job = await query(
      `INSERT INTO scrape_jobs
         (requested_by_user_id,requested_by_source,scrape_mode,target_url,
          task_content_id,status)
       VALUES (?,'dashboard','scrape_specific_url',?,?,'pending')`,
      [userId || null, row.requested_url, row.task_content_id],
    );
    await query(
      `UPDATE cfx_evidence_acquisition_bindings
          SET scrape_job_id=?,opened_tab_id=?,extension_instance_id=?
        WHERE binding_id=?`,
      [job.insertId, positive(openedTabId, "openedTabId", true),
        extensionInstanceId ? bounded(extensionInstanceId, "extensionInstanceId") : null,
        bindingId],
    );
    return { created: true, scrapeJobId: Number(job.insertId), status: "pending" };
  }, { pool });
}

export function phase2IdentityHash(kind, value) {
  return sha256(`${bounded(kind, "kind")}:${bounded(value, "value", 8_000)}`);
}

export function serializeDiscoveryAssignments(assignments) {
  return json(assignments);
}
