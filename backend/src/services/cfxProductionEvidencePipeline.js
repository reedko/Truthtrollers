import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import {
  buildAcademicPublishingIdentity,
  fetchAcademicApiContent,
} from "../core/academicContentResolver.js";
import { withTransaction } from "../storage/dbTransaction.js";
import { processPublishingIdentity } from "./publishingIdentityPipeline.js";
import {
  createProductionCfxStructuredProvider,
  processCfxDocumentEvidenceBinding,
} from "./cfxEvidenceCoordinator.js";
import {
  findReusableEvidenceTextVersion,
  insertEvidenceScrapeBinding,
  persistEvidenceAcquisitionAttempt,
  persistEvidenceTextVersion,
} from "./cfxEvidenceScrapeAdapter.js";
import {
  ensureCfxCanonicalAcquisition,
  persistCfxDiscoveryAssignments,
  retryCfxCanonicalAcquisition,
  upsertCfxCanonicalDocument,
} from "./cfxCanonicalDocumentStore.js";
import {
  ensureClaimSource,
  ensureContentClaim,
  ensureContentRelation,
  ensureCfxDocumentDiscoveryLink,
  findOrCreateCanonicalClaim,
  findOrCreateReferenceContent,
} from "./cfxProductionEvidenceStore.js";
import { ensureCfxSourceQuality } from "./cfxSourceQualityCompatibility.js";
import { ensureCfxSourceCrest } from "./cfxSourceCrestCompatibility.js";
import { acquireCfxDocumentAutomatically } from "./cfxAutomaticAcquisition.js";
import { buildCfxOptionAAliases } from "./cfxOptionAAliases.js";
import {
  resolveCfxPacketSelectionPythonExecutable,
  validateCfxPacketSelectionPythonRuntime,
} from "./cfxPacketSelectionPythonRuntime.js";
import logger from "../utils/logger.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const canonicalJson = (value) => `${JSON.stringify(value, null, 2)}\n`;

function positive(value, name) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) throw new TypeError(`${name} must be a positive integer`);
  return number;
}

/**
 * Thrown by loadProductionCfxEvidenceInputs when a requested claim's persisted
 * CFX rich evidence-search handoff (claim_evaluation_targets.query_hints_json)
 * is missing, malformed, or incomplete. CFX is the only production
 * architecture -- there is no compatibility fallback to recompute a degraded
 * handoff, so any of these conditions must fail the whole production evidence
 * run before query planning, not degrade silently.
 */
export class CfxQueryInputError extends Error {
  constructor(message, { code, claimId, contentId, missingFields } = {}) {
    super(message);
    this.name = "CfxQueryInputError";
    this.code = code;
    this.claimId = claimId;
    this.contentId = contentId;
    if (missingFields) this.missingFields = missingFields;
  }
}

// Matches the exact shape cfxCaseAssertionPersistence.js persists into
// claim_evaluation_targets.query_hints_json (upsertEvaluationTarget):
//   { propositionId, groundingUnitIds, literalIdentifiers, lookupHints,
//     deterministicQueries }
// where deterministicQueries holds the raw handoff.queries shape
// ({literal,sourceQualified,studyLookup}), not the reshaped
// CfxEvidenceInput.deterministicQueries shape. Field lists mirror
// retrieval/loadEvidenceInputs.ts's proven literalIdentifiers/lookupHints/
// queries schemas exactly.
const cfxLiteralIdentifiersSchema = z.object({
  people: z.array(z.string()),
  organizations: z.array(z.string()),
  laws: z.array(z.string()),
  studyTitles: z.array(z.string()),
  journals: z.array(z.string()),
  years: z.array(z.string()),
  dateRanges: z.array(z.string()),
  doi: z.array(z.string()),
  pmid: z.array(z.string()),
  urls: z.array(z.string()),
  citationNumbers: z.array(z.string()),
  acronyms: z.array(z.string()),
}).strict();

const cfxLookupHintsSchema = z.object({
  populations: z.array(z.string()),
  exposures: z.array(z.string()),
  outcomes: z.array(z.string()),
  interventions: z.array(z.string()),
  geography: z.array(z.string()),
  documentTypes: z.array(z.string()),
  topics: z.array(z.string()),
}).strict();

const cfxPersistedQueriesSchema = z.object({
  literal: z.array(z.string()),
  sourceQualified: z.array(z.string()),
  studyLookup: z.array(z.string()),
}).strict();

const cfxQueryHintsSchema = z.object({
  propositionId: z.string().regex(/^P[0-9]+$/u),
  groundingUnitIds: z.array(z.string().regex(/^U[0-9]+$/u)).min(1),
  literalIdentifiers: cfxLiteralIdentifiersSchema,
  lookupHints: cfxLookupHintsSchema,
  deterministicQueries: cfxPersistedQueriesSchema,
}).passthrough();

const CFX_ARTICLE_STANCES = ["adopts", "challenges", "reports"];

/**
 * Requires and validates the persisted CFX rich evidence-search handoff for
 * one claim. Fails loudly and specifically -- missing, malformed, and
 * incomplete/invalid handoffs each throw a distinctly coded CfxQueryInputError
 * naming the claim and content IDs (and, for incomplete/invalid shapes, the
 * exact missing/invalid field paths). There is no fallback: this is the only
 * path loadProductionCfxEvidenceInputs has for producing groundingUnitIds,
 * literalIdentifiers, lookupHints, deterministicQueries, and propositionId.
 */
function requireCfxQueryHints(raw, { claimId, contentId }) {
  if (raw === null || raw === undefined || raw === "") {
    throw new CfxQueryInputError(
      `Claim ${claimId} (content ${contentId}) has no persisted query_hints_json; `
      + "a CFX rich evidence-search handoff is required and there is no compatibility fallback.",
      { code: "MISSING_QUERY_HINTS", claimId, contentId },
    );
  }
  let parsed;
  if (typeof raw === "object") {
    parsed = raw;
  } else {
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      throw new CfxQueryInputError(
        `Claim ${claimId} (content ${contentId}) has malformed query_hints_json: ${error.message}`,
        { code: "MALFORMED_QUERY_HINTS_JSON", claimId, contentId },
      );
    }
  }
  const validated = cfxQueryHintsSchema.safeParse(parsed);
  if (!validated.success) {
    const missingFields = validated.error.issues.map((issue) => issue.path.join(".") || "(root)");
    throw new CfxQueryInputError(
      `Claim ${claimId} (content ${contentId}) has an incomplete or invalid CFX query_hints_json; `
      + `missing/invalid fields: ${missingFields.join(", ")}`,
      { code: "INVALID_QUERY_HINTS_SHAPE", claimId, contentId, missingFields },
    );
  }
  return validated.data;
}

/** Requires the persisted CFX article stance to be exactly one of the three governed values; no synonym normalization, no silent default. */
function requireCfxArticleStance(value, { claimId, contentId }) {
  if (CFX_ARTICLE_STANCES.includes(value)) return value;
  throw new CfxQueryInputError(
    `Claim ${claimId} (content ${contentId}) has an invalid or missing article_stance: ${JSON.stringify(value)}; `
    + `expected one of ${CFX_ARTICLE_STANCES.join(", ")}.`,
    { code: "INVALID_ARTICLE_STANCE", claimId, contentId },
  );
}

/** Requires the persisted grounding excerpt (source_excerpt) to be a non-empty string; groundingText is never part of query_hints_json and is never recomputed. */
function requireCfxGroundingText(value, { claimId, contentId }) {
  const text = typeof value === "string" ? value : "";
  if (text.trim()) return text;
  throw new CfxQueryInputError(
    `Claim ${claimId} (content ${contentId}) has no persisted grounding excerpt (source_excerpt).`,
    { code: "MISSING_GROUNDING_TEXT", claimId, contentId },
  );
}

/** Preserve the legacy evidence-document quality projection (search relevance
 * plus the established-source hostname boost) without another model call. */
export function legacyDocumentQuality(candidate) {
  const value = Number(candidate?.retrievalScore);
  const fallback = 1 / Math.max(1, Number(candidate?.retrievalRank) || 1);
  const base = Number.isFinite(value) ? value : fallback;
  let domain = String(candidate?.domain || "");
  if (!domain) {
    try { domain = new URL(candidate?.canonicalUrl || candidate?.url || "").hostname; }
    catch { domain = ""; }
  }
  const legacyDomainBoost = /(reuters|apnews|nature|nih|who|gov|\.edu)/iu.test(domain)
    ? 0.2
    : 0;
  return Math.max(0, Math.min(1.2, base + legacyDomainBoost));
}

export async function defaultRuntime() {
  const [
    handoff, planning, retrieval, candidates, canonicalDocuments, artifacts, sourceUnits,
    packetSelection, assertionRelativeExtractionModule, sourceAssertionLinkSuggestion, sourceAssertionPersistence,
  ] = await Promise.all([
    import("../../dist/claimfoundry/cfx/evidenceSearch/buildEvidenceSearchHandoff.js"),
    import("../../dist/claimfoundry/cfx/retrieval/queryPlanning.js"),
    import("../../dist/claimfoundry/cfx/retrieval/executeRetrieval.js"),
    import("../../dist/claimfoundry/cfx/retrieval/candidates.js"),
    import("../../dist/claimfoundry/cfx/acquisition/canonicalDocuments.js"),
    import("../../dist/claimfoundry/cfx/artifacts/immutableArtifacts.js"),
    import("../../dist/claimfoundry/shared/sourceUnits/index.js"),
    // Proven, unmodified assertion-relative packet-selection bridge.
    import("../../dist/claimfoundry/cfx/retrieval/assertion_relative/packetSelectionBridge.js"),
    // Proven, unmodified single-assertion packet-extraction runner.
    import("../../dist/claimfoundry/cfx/experiments/singleAssertionPacketExtraction/runExtraction.js"),
    // Proven, unmodified stable source-assertion ID contract (link suggestion
    // itself is not invoked by this seam).
    import("../../dist/claimfoundry/cfx/finalLinking/linkSuggestion.js"),
    // Proven, unmodified provisional source-assertion persistence.
    import("../../dist/claimfoundry/cfx/finalLinking/persistence.js"),
  ]);
  return {
    ...handoff, ...planning, ...retrieval, ...candidates, ...canonicalDocuments, ...artifacts, ...sourceUnits,
    ...packetSelection, ...assertionRelativeExtractionModule,
    ...sourceAssertionLinkSuggestion, ...sourceAssertionPersistence,
  };
}

export async function loadProductionCfxEvidenceInputs({ query, taskContentId, claimIds }) {
  const taskId = positive(taskContentId, "taskContentId");
  const ids = [...new Set(claimIds.map((id) => positive(id, "claimId")))];
  if (!ids.length) throw new TypeError("claimIds must be non-empty");
  const placeholders = ids.map(() => "?").join(",");
  const rows = await query(
    `SELECT c.claim_id,c.claim_text,cc.speaker_entity,
            cet.evaluation_target_id,cet.target_order,
            cet.source_excerpt,cet.article_stance,
            cet.population_scope,cet.query_hints_json
       FROM claims c
       JOIN content_claims cc ON cc.claim_id=c.claim_id AND cc.content_id=?
       LEFT JOIN claim_evaluation_targets cet
         ON cet.claim_id=c.claim_id AND cet.content_id=cc.content_id
      WHERE c.claim_id IN (${placeholders})
      ORDER BY c.claim_id,cet.target_order,cet.evaluation_target_id`,
    [taskId, ...ids],
  );
  const firstByClaim = new Map();
  for (const row of rows) if (!firstByClaim.has(Number(row.claim_id))) firstByClaim.set(Number(row.claim_id), row);
  const missing = ids.filter((id) => !firstByClaim.has(id));
  if (missing.length) throw new Error(`Claims are not attached to task ${taskId}: ${missing.join(", ")}`);

  return ids.map((claimId) => {
    const row = firstByClaim.get(claimId);
    const contentId = taskId;
    const substantiveAssertion = String(row.claim_text || "");
    if (!substantiveAssertion.trim()) {
      throw new CfxQueryInputError(
        `Claim ${claimId} (content ${contentId}) has no canonical claim_text.`,
        { code: "MISSING_CLAIM_TEXT", claimId, contentId },
      );
    }
    const assertionSourceRaw = row.speaker_entity;
    if (typeof assertionSourceRaw !== "string" || !assertionSourceRaw.trim()) {
      throw new CfxQueryInputError(
        `Claim ${claimId} (content ${contentId}) has no persisted CFX assertion source (content_claims.speaker_entity).`,
        { code: "MISSING_ASSERTION_SOURCE", claimId, contentId },
      );
    }
    const assertionSource = assertionSourceRaw;
    const stance = requireCfxArticleStance(row.article_stance, { claimId, contentId });
    const groundingText = requireCfxGroundingText(row.source_excerpt, { claimId, contentId });
    const hints = requireCfxQueryHints(row.query_hints_json, { claimId, contentId });

    return {
      propositionId: hints.propositionId,
      claimId,
      substantiveAssertion,
      assertionSource,
      articleStance: stance,
      groundingUnitIds: hints.groundingUnitIds,
      groundingText,
      literalIdentifiers: hints.literalIdentifiers,
      lookupHints: hints.lookupHints,
      deterministicQueries: {
        literalQuery: hints.deterministicQueries.literal[0] || substantiveAssertion,
        sourceQualifiedQuery: hints.deterministicQueries.sourceQualified[0] || null,
        studyLookupQueries: hints.deterministicQueries.studyLookup,
      },
      compatibility: {
        evaluationTargetId: row.evaluation_target_id == null ? null : Number(row.evaluation_target_id),
        populationScope: row.population_scope || null,
      },
    };
  });
}

function defaultArtifactStore(runtime, taskContentId, runId) {
  const root = path.join(repoRoot, "artifacts/claim-foundry/cfx/production", String(taskContentId), runId);
  return {
    root,
    async initialize() { await runtime.createImmutableDirectory(root); },
    async write(relativePath, value) {
      await runtime.writeImmutableJson(path.join(root, relativePath), value);
    },
    async finalize(status) {
      await runtime.writeImmutableJson(path.join(root, "run_status.json"), status);
      const files = await runtime.hashArtifactTree(root);
      const aggregateSha256 = runtime.aggregateArtifactHash(files);
      await runtime.writeImmutableJson(path.join(root, "artifact_hashes.json"), { files, aggregateSha256 });
      await runtime.freezeArtifactTree(root);
      return { root, aggregateSha256 };
    },
  };
}

function orderCandidates(candidates) {
  return [...candidates].sort((left, right) => {
    const leftPath = left.discoveryPaths[0];
    const rightPath = right.discoveryPaths[0];
    return leftPath.queryId.localeCompare(rightPath.queryId)
      || left.retrievalRank - right.retrievalRank
      || left.candidateId.localeCompare(right.candidateId);
  });
}

function boundedDocumentLimit(value) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 18) {
    throw new TypeError("maxCanonicalDocuments must be an integer from 1 through 18");
  }
  return parsed;
}

function boundedDocumentsPerAssertion(value) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 5) {
    throw new TypeError("documentsPerAssertion must be an integer from 1 through 5");
  }
  return parsed;
}

// fetchWithFallbacks/cfxAutomaticAcquisition report forensic-detail status
// strings ("timeout", "not_found", "empty", "parse_failure", ...); the
// production table stores a smaller, stable outcome enum. Never write a
// raw status string into that enum -- map it down, same as acquisition lane.
// The exact status is never lost: it is preserved verbatim in error_code.
export function outcomeForAcquisitionStatus(status) {
  if (status === "success") return "acquired";
  if (status === "timeout" || status === "failed") return "failed";
  // The request completed but no usable content resulted (nothing found,
  // an empty/too-short body, or content that failed the genuine-article
  // text guard) -- distinct from a technical failure to complete the request.
  if (status === "not_found" || status === "empty" || status === "parse_failure") return "unavailable";
  return "failed";
}

function earliestAssertionDiscovery(document, propositionId) {
  return (document.discoveryAssignments || [])
    .filter((assignment) => assignment.propositionId === propositionId)
    .sort((left, right) => String(left.queryId).localeCompare(String(right.queryId))
      || Number(left.rank ?? Number.MAX_SAFE_INTEGER) - Number(right.rank ?? Number.MAX_SAFE_INTEGER)
      || String(document.documentKey).localeCompare(String(document.documentKey)))[0] || null;
}

/**
 * Active production selection policy: reproduce the former assertion-local
 * search-rank selector on canonical documents, then deduplicate only the union
 * sent to acquisition. Every discovery assignment remains on its document.
 */
export function selectCfxTopRankedDocumentsPerAssertion(inputs, documents, maximum = 5) {
  const limit = boundedDocumentsPerAssertion(maximum);
  const selectedByKey = new Map();
  const perAssertion = inputs.map((input) => {
    const selected = documents
      .map((document) => ({
        document,
        path: earliestAssertionDiscovery(document, input.propositionId),
      }))
      .filter((row) => row.path)
      .sort((left, right) => String(left.path.queryId).localeCompare(String(right.path.queryId))
        || Number(left.path.rank ?? Number.MAX_SAFE_INTEGER)
          - Number(right.path.rank ?? Number.MAX_SAFE_INTEGER)
        || String(left.document.documentKey).localeCompare(String(right.document.documentKey)))
      .slice(0, limit);
    for (const row of selected) selectedByKey.set(row.document.documentKey, row.document);
    return {
      propositionId: input.propositionId,
      selected: selected.map(({ document, path }) => ({
        documentKey: document.documentKey,
        queryId: path.queryId,
        queryIntent: path.queryIntent,
        retrievalRank: path.rank,
        candidateId: path.candidateId,
      })),
    };
  });
  return {
    policy: "former_assertion_specific_search_rank_top_five",
    maximumPerAssertion: limit,
    perAssertion,
    documents: [...selectedByKey.values()],
  };
}

const REQUIRED_CFX_PRODUCTION_TABLES = Object.freeze([
  "cfx_canonical_documents",
  "cfx_canonical_document_identities",
  "cfx_document_discovery_assignments",
  "cfx_evidence_acquisition_bindings",
  "cfx_evidence_text_versions",
  "cfx_document_semantic_executions",
]);

/** Abort before a paid planning call when the live persistence contract is incomplete. */
export async function assertCfxProductionSchemaReady(query) {
  const rows = await query(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema=DATABASE() AND table_name IN (?)`,
    [REQUIRED_CFX_PRODUCTION_TABLES],
  );
  const present = new Set((rows || []).map((row) => row.table_name || row.TABLE_NAME));
  const missing = REQUIRED_CFX_PRODUCTION_TABLES.filter((name) => !present.has(name));
  const columns = await query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema=DATABASE()
        AND table_name='cfx_evidence_acquisition_bindings'
        AND column_name='canonical_document_id'`,
  );
  if (columns?.length !== 1) missing.push("cfx_evidence_acquisition_bindings.canonical_document_id");
  if (missing.length) {
    throw new Error(`CFX_PRODUCTION_SCHEMA_NOT_READY: ${missing.join(", ")}`);
  }
}

/** Discovery-only ordering. It controls work volume, never evidence stance. */
export function selectCfxCanonicalDocumentsForRun(documents, maximum = 12) {
  const limit = boundedDocumentLimit(maximum);
  const identityWeight = { pmid: 400, doi: 350, canonical_url: 200, resolved_url: 100 };
  return [...documents].sort((left, right) => {
    const score = (document) => {
      const assignments = document.discoveryAssignments || [];
      const propositions = new Set(assignments.map((row) => row.propositionId)).size;
      const queries = new Set(assignments.map((row) => row.queryId)).size;
      const providers = new Set(assignments.map((row) => row.provider)).size;
      const repairLane = assignments.some((row) =>
        row.queryIntent === "counterevidence" || row.queryIntent === "qualification") ? 50 : 0;
      return (identityWeight[document.canonicalIdentityKind] || 0)
        + propositions * 20 + queries * 5 + providers * 3 + repairLane;
    };
    return score(right) - score(left)
      || String(left.documentKey).localeCompare(String(right.documentKey));
  }).slice(0, limit);
}

async function createCandidateBinding({
  query,
  pool,
  taskContentId,
  userId,
  runId,
  evidenceInput,
  candidate,
  queueScrape,
  sourceArtifactPath,
  sourceArtifactSha256,
}) {
  const sourceUrl = candidate.canonicalUrl || candidate.url;
  if (!sourceUrl) return null;
  return withTransaction(async ({ query: tx }) => {
    const referenceContentId = await findOrCreateReferenceContent(tx, {
      canonicalUrl: sourceUrl,
      url: candidate.url || sourceUrl,
      title: candidate.title,
      provider: candidate.provider,
      snippet: candidate.abstractOrSnippet,
    });
    await ensureContentRelation(tx, { taskContentId, referenceContentId });
    await ensureCfxDocumentDiscoveryLink(tx, {
      taskContentId,
      targetClaimId: evidenceInput.claimId,
      referenceContentId,
      rationale: `CFX discovery via ${candidate.provider} ${candidate.queryId}.`,
      evidenceText: candidate.abstractOrSnippet || null,
      scrapeStatus: queueScrape
        ? candidate.abstractOrSnippet ? "snippet_only" : "failed"
        : "full",
    });
    const scrapeJob = queueScrape
      ? await tx(
          `INSERT INTO scrape_jobs
             (requested_by_user_id,requested_by_source,scrape_mode,target_url,task_content_id,status)
           VALUES (?,'api','scrape_specific_url',?,?,'pending')`,
          [userId || null, sourceUrl, taskContentId],
        )
      : null;
    const binding = await insertEvidenceScrapeBinding(tx, {
      scrapeJobId: scrapeJob?.insertId ?? null,
      context: {
        runId,
        propositionId: evidenceInput.propositionId,
        candidateId: candidate.candidateId,
        acquisitionArtifactId: `ACQ-${candidate.candidateId}`,
        taskContentId,
        targetClaimId: evidenceInput.claimId,
        referenceContentId,
        s2ArtifactPath: sourceArtifactPath,
        s2ArtifactSha256: sourceArtifactSha256,
        groundingUnitIds: evidenceInput.groundingUnitIds,
        requestedUrl: sourceUrl,
      },
    });
    return {
      binding,
      referenceContentId,
      scrapeJobId: scrapeJob ? Number(scrapeJob.insertId) : null,
      sourceUrl,
    };
  }, { pool });
}

/**
 * Phase 2 persistence boundary. Exact-identity aggregation happens before any
 * acquisition. Every discovery occurrence is retained, while one canonical
 * document owns one production acquisition binding for the run.
 */
export async function materializeCfxPhase2Documents({
  query,
  pool,
  runtime,
  runId,
  taskContentId,
  userId,
  candidateRows,
  canonicalDocuments = null,
  sourceArtifactPath,
  sourceArtifactSha256,
  queueScrapeForDocument = () => true,
  activateDocument = () => true,
}) {
  const claimIdByProposition = new Map(candidateRows.map(({ input }) =>
    [input.propositionId, input.claimId]));
  const inputByProposition = new Map(candidateRows.map(({ input }) =>
    [input.propositionId, input]));
  const documents = canonicalDocuments || runtime.aggregateCfxCanonicalDocuments(
      candidateRows.map(({ input, candidate }) => ({
        candidate,
        targetClaimId: input.claimId,
      })),
    );
  const persisted = [];
  for (const document of documents) {
    const representative = document.representative;
    const sourceUrl = document.canonicalUrl
      || document.normalizedResolvedUrl
      || representative.canonicalUrl
      || representative.resolvedUrl
      || representative.url
      || (document.pmid ? `https://pubmed.ncbi.nlm.nih.gov/${document.pmid}/` : null)
      || (document.doi ? `https://doi.org/${document.doi}` : null);
    if (!sourceUrl) continue;
    const active = activateDocument(document) === true;
    const record = await withTransaction(async ({ query: tx }) => {
      const canonicalDocumentId = await upsertCfxCanonicalDocument(tx, {
        runId,
        document,
      });
      const assignmentResult = await persistCfxDiscoveryAssignments(tx, {
        runId,
        canonicalDocumentId,
        assignments: document.discoveryAssignments,
      });
      if (!active) {
        return {
          canonicalDocumentId,
          referenceContentId: null,
          assignmentResult,
          deferred: true,
        };
      }
      const referenceContentId = await findOrCreateReferenceContent(tx, {
        canonicalUrl: sourceUrl,
        url: representative.url || sourceUrl,
        title: representative.title,
        provider: representative.provider,
        snippet: representative.abstractOrSnippet,
      });
      await ensureContentRelation(tx, { taskContentId, referenceContentId });
      const targetClaimIds = [...new Set(document.discoveryAssignments.map(
        (assignment) => assignment.targetClaimId))];
      for (const targetClaimId of targetClaimIds) {
        const intents = [...new Set(document.discoveryAssignments
          .filter((assignment) => assignment.targetClaimId === targetClaimId)
          .map((assignment) => assignment.queryIntent))];
        await ensureCfxDocumentDiscoveryLink(tx, {
          taskContentId,
          targetClaimId,
          referenceContentId,
          rationale: `CFX discovery via ${intents.join(", ")}; bearing unassessed.`,
          evidenceText: representative.abstractOrSnippet || null,
          scrapeStatus: queueScrapeForDocument(document)
            ? representative.abstractOrSnippet ? "snippet_only" : "failed"
            : "full",
        });
      }
      await tx(
        `UPDATE cfx_canonical_documents SET reference_content_id=?
          WHERE canonical_document_id=?`,
        [referenceContentId, canonicalDocumentId],
      );
      return {
        canonicalDocumentId,
        referenceContentId,
        assignmentResult,
        deferred: false,
      };
    }, { pool });
    if (record.deferred) {
      persisted.push({
        document,
        canonicalDocumentId: record.canonicalDocumentId,
        referenceContentId: null,
        assignmentResult: record.assignmentResult,
        bindingRecord: null,
        acquisitionCreated: false,
        deferred: true,
      });
      continue;
    }
    const representativeInput = inputByProposition.get(
      document.discoveryAssignments[0]?.propositionId,
    );
    const groundingUnitIds = [...new Set(document.discoveryAssignments.flatMap(
      (assignment) => inputByProposition.get(assignment.propositionId)?.groundingUnitIds || [],
    ))];
    const acquisition = await ensureCfxCanonicalAcquisition({
      pool,
      runId,
      canonicalDocumentId: record.canonicalDocumentId,
      taskContentId,
      targetClaimId: document.discoveryAssignments[0]?.targetClaimId
        || claimIdByProposition.get(representative.propositionId),
      referenceContentId: record.referenceContentId,
      userId,
      sourceUrl,
      representative,
      sourceArtifactPath,
      sourceArtifactSha256,
      groundingUnitIds: groundingUnitIds.length
        ? groundingUnitIds
        : representativeInput?.groundingUnitIds || [],
      // Never eagerly queue at binding-creation time. Structured academic
      // APIs are resolved directly; ordinary HTML is queued through the
      // production scrape/retry/browser-assist state machine below.
      queueScrape: false,
    });
    persisted.push({
      document,
      canonicalDocumentId: record.canonicalDocumentId,
      referenceContentId: record.referenceContentId,
      assignmentResult: record.assignmentResult,
      bindingRecord: {
        binding: acquisition.binding,
        referenceContentId: record.referenceContentId,
        scrapeJobId: acquisition.binding.scrapeJobId,
        sourceUrl,
      },
      acquisitionCreated: acquisition.created,
      deferred: false,
    });
  }
  return { documents, persisted };
}

export async function persistCfxAcquiredText({
  query,
  pool,
  userId = null,
  bindingRecord,
  candidate,
  academic,
  sourceQualityEnricher,
  publishingIdentityProcessor,
  sourceCrestProcessor,
  automaticAcquirer = acquireCfxDocumentAutomatically,
  queueRetry = retryCfxCanonicalAcquisition,
  persistedTextResolver = findReusableEvidenceTextVersion,
  persistedTextMaximumAgeMs = 30 * 24 * 60 * 60 * 1000,
  preResolvedReusableText = null,
}) {
  const binding = bindingRecord.binding;
  const reusable = preResolvedReusableText || await persistedTextResolver(query, {
      canonicalDocumentId: binding.canonicalDocumentId,
      referenceContentId: bindingRecord.referenceContentId,
      maximumAgeMs: persistedTextMaximumAgeMs,
    });
  if (reusable) {
    // Keep the established Workspace content seam synchronized. Do not create
    // a duplicate immutable version or make another network acquisition.
    await query(
      "UPDATE content SET content_text=? WHERE content_id=? AND (content_text IS NULL OR content_text<>?)",
      [reusable.cleanedText, bindingRecord.referenceContentId, reusable.cleanedText],
    );
    return {
      accessLevel: reusable.accessLevel,
      source: "persisted_text_reuse",
      reused: true,
      acquiredTextVersionId: reusable.acquiredTextVersionId,
      sourceBindingId: reusable.bindingId,
      sourceRunId: reusable.sourceRunId,
      // Already resolved above (reusable.cleanedText); surfaced here so
      // callers (e.g. the assertion-relative extraction seam) can consume
      // the exact acquired text without a second read of the canonical
      // text-version contract.
      cleanedText: reusable.cleanedText,
      cleanedTextSha256: reusable.cleanedTextSha256,
      characterCount: reusable.characterCount,
      freshnessAgeMs: reusable.ageMs,
      sourceQualityProcessed: false,
      sourceCrestAttempted: false,
      sourceCrestProcessed: false,
    };
  }
  let attemptOrdinal = 0;
  if (academic) {
    attemptOrdinal += 1;
    const attempt = await persistEvidenceAcquisitionAttempt(query, {
      binding,
      attemptOrdinal,
      acquisitionLane: "structured_api",
      provider: academic.identifiers?.pmcid ? "pmc" : academic.identifiers?.pmid ? "pubmed" : "crossref",
      requestUrl: bindingRecord.sourceUrl,
      resolvedUrl: candidate.canonicalUrl || candidate.url,
      outcome: academic.cleanText ? "acquired" : "metadata_only",
      rawResponse: JSON.stringify(academic),
      responseMetadata: {
        retrievalMode: academic.retrievalMode,
        identifiers: academic.identifiers,
        retrievalQuality: legacyDocumentQuality(candidate),
        publicationDate: candidate.publicationDate || academic.publicationDate || null,
      },
    });
    if (academic.cleanText) {
      const fullText = academic.retrievalMode === "full_text";
      await persistEvidenceTextVersion(query, {
        binding,
        acquisitionAttemptId: attempt.acquisitionAttemptId,
        referenceContentId: bindingRecord.referenceContentId,
        accessLevel: fullText ? "full_text" : "abstract",
        extractionMethod: fullText ? "pmc" : "pubmed",
        sourceUrl: bindingRecord.sourceUrl,
        resolvedUrl: candidate.canonicalUrl || candidate.url,
        cleanedText: academic.cleanText,
        selectedForBearing: true,
      });
      // The acquired canonical text must also reach the existing production
      // content record so Workspace and the established scrape lifecycle open
      // the same document that CFX evaluated.
      await query(
        "UPDATE content SET content_text=? WHERE content_id=?",
        [academic.cleanText, bindingRecord.referenceContentId],
      );
      const authors = (academic.authors || [])
        .map((name) => ({ name }))
        .filter((author) => author.name);
      const identityResult = await publishingIdentityProcessor({
        query,
        contentId: bindingRecord.referenceContentId,
        identity: buildAcademicPublishingIdentity(
          academic,
          candidate.canonicalUrl || candidate.url,
        ),
        authors,
      });
      const sourceCrest = await sourceCrestProcessor({
        query,
        referenceContentId: bindingRecord.referenceContentId,
        publisherId: identityResult?.persistence?.primaryEntityId
          || identityResult?.persistence?.publisherId
          || null,
        publisherName: academic.publisher || academic.journal || null,
      });
      await sourceQualityEnricher({
        query,
        referenceContentId: bindingRecord.referenceContentId,
        contentText: academic.cleanText,
        metadata: {
          author: academic.authors?.join(", ") || null,
          publisher: academic.publisher || academic.journal || null,
          date: academic.publicationDate || academic.publishedAt || null,
          citationCount: Array.isArray(academic.references)
            ? academic.references.length
            : undefined,
        },
        url: candidate.canonicalUrl || candidate.url,
      });
      return {
        accessLevel: fullText ? "full_text" : "abstract",
        source: "academic",
        cleanedText: academic.cleanText,
        sourceQualityProcessed: true,
        // attempted prevents an immediate duplicate enrichment inside the
        // bearing coordinator; processed reports the truthful persisted result.
        sourceCrestAttempted: true,
        sourceCrestProcessed: sourceCrest?.completed === true,
        sourceCrest,
      };
    }
  }

  const automatic = await automaticAcquirer({ candidate, academic: null });
  let winningAttemptId = null;
  const acquisitionLaneForTier = (tier) => {
    if (tier === "structured_api" || tier === "provider_text") return "structured_api";
    if (tier === "wayback") return "archive";
    if (tier === "headless") return "production_scrape";
    if (["publisher", "normal_platform_scrape", "direct_retry", "alternate_canonical"].includes(tier)) {
      return "direct_http";
    }
    return "production_scrape";
  };
  for (const row of automatic.attempts || []) {
    attemptOrdinal += 1;
    const persistedAttempt = await persistEvidenceAcquisitionAttempt(query, {
      binding,
      attemptOrdinal,
      // Acquisition tiers are forensic detail; the production table stores a
      // smaller, stable lane enum. Never write a tier name into that enum.
      acquisitionLane: acquisitionLaneForTier(row.tier),
      provider: row.method || "automatic",
      requestUrl: row.url || bindingRecord.sourceUrl,
      resolvedUrl: row.resolvedUrl,
      outcome: outcomeForAcquisitionStatus(row.status),
      httpStatus: row.httpStatus,
      errorCode: row.status === "success" ? null : String(row.status || "failed").toUpperCase(),
      errorMessage: row.diagnostic,
      rawResponse: row.rawResponse,
      responseMetadata: {
        contentType: row.contentType,
        characterCount: row.characterCount,
        timingMs: row.timingMs,
        winningTier: automatic.acquired && row.status === "success" && row.method === automatic.method,
      },
    });
    if (row.status === "success" && row.method === automatic.method) {
      winningAttemptId = persistedAttempt.acquisitionAttemptId;
    }
  }
  if (automatic.acquired && automatic.cleanedText) {
    const accessLevel = automatic.completeness === "abstract"
      ? "abstract"
      : automatic.cleanedText.length >= 400 ? "full_text" : "snippet";
    await persistEvidenceTextVersion(query, {
      binding,
      acquisitionAttemptId: winningAttemptId,
      referenceContentId: bindingRecord.referenceContentId,
      accessLevel,
      extractionMethod: automatic.method,
      sourceUrl: automatic.sourceUrl || bindingRecord.sourceUrl,
      resolvedUrl: automatic.resolvedUrl,
      cleanedText: automatic.cleanedText,
      selectedForBearing: accessLevel !== "snippet",
    });
    const extractedDocument = automatic.extractedDocument || {};
    await query(
      "UPDATE content SET content_text=? WHERE content_id=?",
      [automatic.cleanedText, bindingRecord.referenceContentId],
    );
    if (extractedDocument.title) {
      await query(
        "UPDATE content SET content_name=? WHERE content_id=?",
        [extractedDocument.title, bindingRecord.referenceContentId],
      );
    }
    const identityResult = await publishingIdentityProcessor({
      query,
      contentId: bindingRecord.referenceContentId,
      sourceUrl: automatic.resolvedUrl || automatic.sourceUrl || bindingRecord.sourceUrl,
      ...(extractedDocument.publishingIdentity
        ? { identity: extractedDocument.publishingIdentity }
        : {}),
      authors: extractedDocument.authors || [],
      fallbackPublisher: extractedDocument.publisher || candidate.publication || null,
    });
    const sourceCrest = await sourceCrestProcessor({
      query,
      referenceContentId: bindingRecord.referenceContentId,
      publisherId: identityResult?.persistence?.primaryEntityId
        || identityResult?.persistence?.publisherId
        || null,
      publisherName: extractedDocument.publisher?.name
        || candidate.publication
        || null,
    });
    await sourceQualityEnricher({
      query,
      referenceContentId: bindingRecord.referenceContentId,
      contentText: automatic.cleanedText,
      metadata: {
        author: extractedDocument.authors?.map?.((author) => author?.name || author)
          .filter(Boolean).join(", ") || candidate.authors?.join?.(", ") || null,
        publisher: extractedDocument.publisher?.name || candidate.publication || null,
        date: candidate.publicationDate || null,
        citationCount: extractedDocument.citationCount,
      },
      url: automatic.resolvedUrl || automatic.sourceUrl || bindingRecord.sourceUrl,
    });
    return {
      accessLevel,
      source: automatic.method,
      cleanedText: automatic.cleanedText,
      acquisitionAttempts: automatic.attempts,
      extractedDocument: {
        documentType: extractedDocument.documentType || null,
        title: extractedDocument.title || null,
        authors: extractedDocument.authors || [],
        publisher: extractedDocument.publisher || null,
        extractionMethod: extractedDocument.extractionMethod || null,
        extractionSelector: extractedDocument.extractionSelector || null,
        citationCount: extractedDocument.citationCount ?? null,
      },
      sourceQualityProcessed: true,
      sourceCrestAttempted: true,
      sourceCrestProcessed: sourceCrest?.completed === true,
      sourceCrest,
    };
  }

  // User-assisted recovery is deliberately late: direct/alternate, Wayback,
  // and one bounded headless attempt above must all fail first.
  if (!academic || !academic.cleanText) {
    if (pool) {
      try {
        await queueRetry({ pool, bindingId: binding.bindingId, userId });
      } catch (err) {
        logger.warn(`[CFX_ACQUISITION] Failed to queue production scrape for binding ${binding.bindingId}: ${err.message}`);
      }
    }
  }

  if (candidate.abstractOrSnippet) {
    attemptOrdinal += 1;
    const isAbstract = candidate.provider === "pubmed";
    const attempt = await persistEvidenceAcquisitionAttempt(query, {
      binding,
      attemptOrdinal,
      acquisitionLane: isAbstract ? "structured_api" : "snippet",
      provider: candidate.provider,
      requestUrl: bindingRecord.sourceUrl,
      resolvedUrl: candidate.canonicalUrl || candidate.url,
      outcome: isAbstract ? "acquired" : "snippet_only",
      rawResponse: JSON.stringify(candidate),
      responseMetadata: {
        discoveryPaths: candidate.discoveryPaths,
        retrievalQuality: legacyDocumentQuality(candidate),
        publicationDate: candidate.publicationDate || null,
      },
    });
    await persistEvidenceTextVersion(query, {
      binding,
      acquisitionAttemptId: attempt.acquisitionAttemptId,
      referenceContentId: bindingRecord.referenceContentId,
      accessLevel: isAbstract ? "abstract" : "snippet",
      extractionMethod: isAbstract ? "pubmed" : "search_snippet",
      sourceUrl: bindingRecord.sourceUrl,
      resolvedUrl: candidate.canonicalUrl || candidate.url,
      cleanedText: candidate.abstractOrSnippet,
      selectedForBearing: isAbstract,
    });
    await sourceQualityEnricher({
      query,
      referenceContentId: bindingRecord.referenceContentId,
      contentText: candidate.abstractOrSnippet,
      metadata: {
        author: candidate.authors?.join?.(", ") || null,
        publisher: candidate.publication || null,
        date: candidate.publicationDate || null,
      },
      url: candidate.canonicalUrl || candidate.url,
    });
    return {
      accessLevel: isAbstract ? "abstract" : "user_action_required",
      source: "retrieval",
      cleanedText: candidate.abstractOrSnippet,
      acquisitionAttempts: automatic.attempts,
      sourceQualityProcessed: true,
      sourceCrestProcessed: false,
    };
  }
  await persistEvidenceAcquisitionAttempt(query, {
    binding,
    attemptOrdinal: attemptOrdinal + 1,
    acquisitionLane: "metadata",
    provider: candidate.provider,
    requestUrl: bindingRecord.sourceUrl,
    resolvedUrl: candidate.canonicalUrl || candidate.url,
    outcome: "metadata_only",
    rawResponse: JSON.stringify(candidate),
    responseMetadata: {
      discoveryPaths: candidate.discoveryPaths,
      retrievalQuality: legacyDocumentQuality(candidate),
      publicationDate: candidate.publicationDate || null,
    },
  });
  return null;
}

/**
 * Proven single-assertion packet-extraction model configuration, unchanged
 * from the frozen governed run (cfx-single-assertion-packet-extraction-
 * 20260802090828): temperature 0.1, 8,000-token output limit, 180,000 ms
 * timeout. Not configurable per call -- only the model name has an env
 * override, matching this file's existing CFX_TARGETED_BEARING_MODEL /
 * CFX_DOCUMENT_BEARING_MODEL convention.
 */
const ASSERTION_RELATIVE_EXTRACTION_MODEL_CONFIG = Object.freeze({
  temperature: 0.1,
  maxOutputTokens: 8_000,
  timeoutMs: 180_000,
});

/**
 * For one document, and one proposition already known (via the live
 * selectCfxTopRankedDocumentsPerAssertion result, not
 * document.discoveryAssignments) to have selected it: build Option-A
 * aliases, run the real, unmodified selectCfxAssertionRelativePackets(),
 * and -- unconditionally -- the real, unmodified
 * runCfxSingleAssertionPacketExtraction() (which itself makes zero provider
 * calls when packets are empty; this function does not duplicate that
 * short-circuit). Persists nothing. Returns a plain provenance record and
 * writes matching artifacts; never includes queryIntent.
 */
export async function runCfxAssertionRelativePacketExtractionForPair({
  runtime,
  provider,
  model,
  propositionId,
  evidenceInput,
  documentKey,
  referenceContentId,
  acquiredText,
  packetSelectionOptions = {},
  artifacts,
}) {
  const aliases = buildCfxOptionAAliases(evidenceInput);
  const packetSelectionInput = {
    assertion: {
      assertionId: propositionId,
      text: evidenceInput.substantiveAssertion,
      aliases,
      // Always []: no concept-generation model call, no fixture concept
      // groups. This is the Option-A product decision, not a default that
      // callers can override.
      requiredConceptGroups: [],
    },
    document: {
      documentId: documentKey,
      // The exact acquired cleaned text, wrapped as one block, unmodified --
      // no new normalization or paragraph-splitting system.
      blocks: [{ blockId: "SOURCE-0001", text: acquiredText }],
    },
    // No explicit config: retriever.py's own RetrievalConfig defaults are
    // byte-identical to the proven governed configuration (windowCharacterTarget
    // 700, minimumCombinedScore 0.18, maximumSeedWindows 12, maximumPackets 8,
    // enableEmbeddings/enableBm25 true, requireAllConceptGroups true,
    // minimumConceptGroupScore 0.60) -- overriding them here would be
    // redesigning the proven packet selector, not reusing it.
  };

  let packetSelectionOutput = null;
  let packetSelectionFailure = null;
  try {
    packetSelectionOutput = await runtime.selectCfxAssertionRelativePackets(
      packetSelectionInput,
      packetSelectionOptions,
    );
  } catch (error) {
    packetSelectionFailure = { name: error?.name || "Error", message: error?.message || String(error) };
  }
  const selectedPackets = packetSelectionOutput?.selectedPackets || [];
  const emptyPacketSelection = selectedPackets.length === 0;

  let extraction = null;
  if (!packetSelectionFailure) {
    extraction = await runtime.runCfxSingleAssertionPacketExtraction({
      assertionId: propositionId,
      assertionText: evidenceInput.substantiveAssertion,
      documentId: documentKey,
      selectedPackets,
      provider,
      model,
      ...ASSERTION_RELATIVE_EXTRACTION_MODEL_CONFIG,
    });
  }

  const record = {
    propositionId,
    caseAssertionText: evidenceInput.substantiveAssertion,
    claimId: evidenceInput.claimId,
    targetClaimId: evidenceInput.claimId,
    referenceContentId,
    documentId: documentKey,
    aliases,
    requiredConceptGroups: [],
    emptyPacketSelection,
    packetSelectionFailure,
    packetIds: selectedPackets.map((packet) => packet.packetId),
    blockIds: [...new Set(selectedPackets.flatMap((packet) => packet.blockIds))],
    characterSpans: selectedPackets.map((packet) => ({
      packetId: packet.packetId, charStart: packet.charStart, charEnd: packet.charEnd,
    })),
    extractionStatus: extraction?.status ?? "not_attempted",
    extractionRequestHash: extraction?.requestHash ?? null,
    // The provider's own request ID for the one model call this pair made
    // (null when no call was made, e.g. empty packet selection): the live
    // extractionModelCallId source for provisional source-assertion
    // persistence, already returned by the unmodified extraction runner but
    // not otherwise surfaced.
    extractionModelCallId: extraction?.requestId ?? null,
    extractionPromptHash: extraction?.promptHash ?? null,
    extractionSchemaHash: extraction?.schemaHash ?? null,
    extractionProviderCallCount: extraction?.providerCallCount ?? 0,
    extractionModel: extraction?.model ?? null,
    extractionUsage: extraction?.usage ?? null,
    extractionLatencyMs: extraction?.latencyMs ?? null,
    extractionError: extraction?.error ?? null,
    acceptedRows: extraction?.acceptedRows ?? [],
    rejectedRows: extraction?.rejectedRows ?? [],
  };

  if (artifacts) {
    const base = `assertion-relative-extraction/${documentKey}/${propositionId}`;
    await artifacts.write(`${base}/packet-selection-input.json`, packetSelectionInput);
    await artifacts.write(
      `${base}/packet-selection-output.json`,
      packetSelectionOutput || { failure: packetSelectionFailure },
    );
    await artifacts.write(`${base}/extraction-result.json`, record);
  }

  return record;
}

/**
 * Deterministic projection from validated accepted extraction rows to the
 * proven CfxPersistableSourceAssertion shape (finalLinking/linkSuggestion.js).
 * One accepted extraction row produces exactly one projected row. Rejected
 * rows are never projected. relevanceType is read only to be dropped -- it
 * must never become stance, score, confidence, or any other semantic link
 * field; that mapping belongs to the not-yet-run link-suggestion seam.
 */
export function projectCfxAssertionRelativeSourceAssertions({
  runtime,
  runId,
  documentMetaByKey,
  propositionRecords,
}) {
  const rows = [];
  for (const record of propositionRecords) {
    const documentMeta = documentMetaByKey.get(record.documentId);
    if (!documentMeta) throw new Error(`missing document metadata for ${record.documentId}`);
    for (const accepted of record.acceptedRows) {
      rows.push({
        sourceAssertionId: runtime.stableCfxSourceAssertionId({
          caseAssertionId: record.propositionId,
          documentId: record.documentId,
          exactExcerpt: accepted.exactExcerpt,
          sourceAssertion: accepted.sourceAssertion,
        }),
        caseAssertionId: record.propositionId,
        caseAssertionText: record.caseAssertionText,
        documentId: record.documentId,
        documentTitle: documentMeta.documentTitle,
        documentUrl: documentMeta.documentUrl,
        sourceAssertion: accepted.sourceAssertion,
        exactExcerpt: accepted.exactExcerpt,
        documentCharStart: accepted.grounding.documentCharStart,
        documentCharEnd: accepted.grounding.documentCharEnd,
        sourceBlockIds: accepted.blockIds,
        sourcePacketIds: accepted.packetIds,
        extractionRunId: runId,
        extractionModelCallId: record.extractionModelCallId,
        extractionPromptHash: record.extractionPromptHash,
        extractionSchemaHash: record.extractionSchemaHash,
      });
    }
  }
  return rows;
}

/**
 * Proven link-suggestion model configuration, unchanged from the frozen
 * governed run demonstrated by runFinalSourceAssertionLinking.ts: temperature
 * 0.1, 4,000-token output limit, 180,000 ms timeout. Only the model name has
 * an env override, matching this file's existing per-stage convention.
 */
const LINK_SUGGESTION_MODEL_CONFIG = Object.freeze({
  temperature: 0.1,
  maxOutputTokens: 4_000,
  timeoutMs: 180_000,
});

/**
 * One batched link-suggestion model call for one case assertion against
 * every provisional source assertion persisted for it this run: the real,
 * unmodified buildCfxLinkSuggestionRequest() and validateCfxLinkSuggestions().
 * insufficient decisions are validator-accepted (syntactically valid) but are
 * separated out here, never coerced into nuance and never forwarded to
 * persistCfxLinkSuggestions() -- persistence only ever sees
 * support/refute/nuance. Persists nothing itself. Writes matching artifacts;
 * never includes queryIntent.
 */
export async function runCfxLinkSuggestionForCaseAssertion({
  runtime,
  provider,
  model,
  caseAssertionId,
  caseAssertionText,
  sourceAssertions,
  artifacts,
}) {
  const request = runtime.buildCfxLinkSuggestionRequest({
    caseAssertionId,
    caseAssertionText,
    sourceAssertions,
    model,
    ...LINK_SUGGESTION_MODEL_CONFIG,
  });
  const requestHash = runtime.canonicalHash(request);
  const suppliedSourceAssertionIds = sourceAssertions.map((row) => row.sourceAssertionId);

  let response = null;
  let failure = null;
  let validation = { acceptedRows: [], rejectedRows: [] };
  try {
    response = await provider.invokeStructured(request);
    validation = runtime.validateCfxLinkSuggestions({
      caseAssertionId,
      suppliedSourceAssertionIds,
      rawOutput: response.output,
    });
  } catch (error) {
    failure = { name: error?.name || "Error", message: error?.message || String(error) };
  }

  const approvedSuggestions = validation.acceptedRows.filter((row) => row.suggestedStance !== "insufficient");
  const insufficientSuggestions = validation.acceptedRows.filter((row) => row.suggestedStance === "insufficient");

  const record = {
    caseAssertionId,
    requestHash,
    promptHash: runtime.cfxLinkSuggestionPromptHash(),
    schemaHash: runtime.cfxLinkSuggestionSchemaHash(),
    modelCallId: response?.requestId ?? null,
    responseId: response?.responseId ?? null,
    model: response?.model ?? model,
    usage: response?.usage ?? null,
    providerCallCount: 1,
    failure,
    acceptedRows: validation.acceptedRows,
    rejectedRows: validation.rejectedRows,
    approvedSuggestions,
    insufficientSuggestions,
  };

  if (artifacts) {
    const base = `assertion-relative-link-suggestion/${caseAssertionId}`;
    await artifacts.write(`${base}/candidate-source-assertions.json`, sourceAssertions);
    await artifacts.write(`${base}/request.json`, request);
    await artifacts.write(`${base}/raw-response.json`, {
      rawResponse: response?.rawResponse ?? null,
      parsedOutput: response?.output ?? null,
      failure,
    });
    await artifacts.write(`${base}/validation.json`, validation);
    await artifacts.write(`${base}/approved-links.json`, approvedSuggestions);
    await artifacts.write(`${base}/insufficient-decisions.json`, insufficientSuggestions);
  }

  return record;
}

export async function runCfxProductionEvidencePipeline({
  query,
  pool,
  taskContentId,
  claimIds,
  userId = null,
  provider = createProductionCfxStructuredProvider(),
  bearingProvider = provider,
  webProvider = process.env.CFX_WEB_PROVIDER || "tavily",
  runtimeLoader = defaultRuntime,
  retrievalTransport = null,
  academicResolver = fetchAcademicApiContent,
  automaticAcquirer = acquireCfxDocumentAutomatically,
  bearingProcessor = processCfxDocumentEvidenceBinding,
  sourceQualityEnricher = ensureCfxSourceQuality,
  publishingIdentityProcessor = processPublishingIdentity,
  sourceCrestProcessor = ensureCfxSourceCrest,
  artifactStoreFactory = defaultArtifactStore,
  queueRetry = retryCfxCanonicalAcquisition,
  persistedTextResolver = findReusableEvidenceTextVersion,
  persistedTextMaximumAgeMs = 30 * 24 * 60 * 60 * 1000,
  // No longer defaults to 12: that was a guardrail scoped to the single
  // CF1-F03 fixture this pipeline was first proven against, not a structural
  // requirement -- proposition IDs are already derived from real claim_id /
  // claim_order values throughout, not a fixed count. Pass an explicit
  // integer here (e.g. from a fixture-comparison caller) to restore the old
  // exact-match guardrail; production callers pass whatever claim count a
  // real task actually has.
  expectedClaimCount = null,
  // The active bounded rule is the former per-assertion top-five selector.
  // Canonical deduplication occurs only after each assertion's ranked five
  // have been selected.
  documentsPerAssertion = Number(process.env.CFX_DOCUMENTS_PER_ASSERTION || 5),
  schemaPreflight = assertCfxProductionSchemaReady,
  phase2Only = false,
  // Explicit rollback configuration: the existing document-centric
  // bearingProcessor path remains the default. Setting this true (or
  // CFX_ASSERTION_RELATIVE_EXTRACTION_ENABLED=true) switches this run to the
  // new assertion-relative packet-selection/extraction path INSTEAD of
  // bearingProcessor -- the two paths are mutually exclusive per run, never
  // both invoked.
  assertionRelativeExtraction = process.env.CFX_ASSERTION_RELATIVE_EXTRACTION_ENABLED === "true",
  extractionProvider = provider,
  assertionRelativeExtractionModel = process.env.CFX_ASSERTION_RELATIVE_EXTRACTION_MODEL || "gpt-4o-mini",
  // Separately gated seam, off by default even when assertionRelativeExtraction
  // is on: projects validated accepted extraction rows to provisional
  // cfx_source_assertion_provenance rows via the proven, unmodified
  // persistCfxSourceAssertions(). Has no effect unless assertionRelativeExtraction
  // is also enabled. Stops there -- no link suggestion, no
  // reference_claim_task_links writes -- unless the further-gated
  // assertionRelativeLinkSuggestion stage below is also enabled.
  assertionRelativeSourceAssertionPersistence =
    process.env.CFX_ASSERTION_RELATIVE_SOURCE_PERSISTENCE_ENABLED === "true",
  // Third and final gate: batched link suggestion over this run's persisted
  // provisional source assertions, via the proven, unmodified
  // buildCfxLinkSuggestionRequest()/validateCfxLinkSuggestions()/
  // persistCfxLinkSuggestions(). Has no effect unless both
  // assertionRelativeExtraction and assertionRelativeSourceAssertionPersistence
  // are also enabled. Only support/refute/nuance decisions are ever persisted;
  // insufficient decisions are never coerced into a link.
  assertionRelativeLinkSuggestion =
    process.env.CFX_ASSERTION_RELATIVE_LINK_SUGGESTION_ENABLED === "true",
  linkSuggestionProvider = provider,
  assertionRelativeLinkSuggestionModel =
    process.env.CFX_ASSERTION_RELATIVE_LINK_SUGGESTION_MODEL || "gpt-4o-mini",
  // pythonExecutable is intentionally absent here: it is resolved and
  // validated below via resolvePacketSelectionPythonExecutable /
  // validatePacketSelectionPythonRuntime, never defaulted to a bare
  // "python3" that could silently pick up an interpreter lacking CFX's
  // pinned dependencies (numpy, spacy, sentence-transformers, ...).
  packetSelectionOptions = {
    embeddingModelCache: process.env.CFX_PACKET_SELECTION_EMBEDDING_MODEL_CACHE || undefined,
    embeddingCache: process.env.CFX_PACKET_SELECTION_EMBEDDING_CACHE || undefined,
    lexicalOnly: process.env.CFX_PACKET_SELECTION_LEXICAL_ONLY === "true",
  },
  resolvePacketSelectionPythonExecutable = resolveCfxPacketSelectionPythonExecutable,
  validatePacketSelectionPythonRuntime = validateCfxPacketSelectionPythonRuntime,
} = {}) {
  if (typeof query !== "function" || !pool) throw new TypeError("query and pool are required");
  const taskId = positive(taskContentId, "taskContentId");
  if (!Array.isArray(claimIds) || claimIds.length < 1) {
    throw new TypeError("CFX production evidence requires at least one canonical claim");
  }
  if (Number.isInteger(expectedClaimCount) && claimIds.length !== expectedClaimCount) {
    throw new TypeError(`CFX production evidence requires exactly ${expectedClaimCount} canonical claims`);
  }
  await schemaPreflight(query);
  // Fail closed before query planning/retrieval spend any time or provider
  // budget: the assertion-relative path shells out to a Python CLI with
  // heavy pinned dependencies, so prove that interpreter is governed and
  // actually starts before doing anything expensive. Never runs otherwise.
  let resolvedPacketSelectionOptions = packetSelectionOptions;
  if (assertionRelativeExtraction) {
    const { executable } = resolvePacketSelectionPythonExecutable();
    await validatePacketSelectionPythonRuntime({ executable });
    resolvedPacketSelectionOptions = { ...packetSelectionOptions, pythonExecutable: executable };
  }
  const runtime = await runtimeLoader();
  const runId = `cfx-prod-${taskId}-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const artifacts = artifactStoreFactory(runtime, taskId, runId);
  await artifacts.initialize();
  let finalized = false;
  try {
    const inputs = await loadProductionCfxEvidenceInputs({ query, taskContentId: taskId, claimIds, runtime });
    const sourceBytes = canonicalJson(inputs);
    const sourceArtifactSha256 = sha256(sourceBytes);
    const sourceArtifactPath = path.join(artifacts.root || runId, "evidence_inputs.json");
    await artifacts.write("evidence_inputs.json", inputs);
    const prompt = await runtime.loadCfxQueryPlanningPrompt();
    let planningRawResponse = null;
    const planning = await runtime.runCfxQueryPlanning({
      inputs,
      sourceEvidenceInputHash: runtime.canonicalHash(inputs),
      provider,
      prompt,
      async beforeInvoke(request) { await artifacts.write("query-planning/request.json", request); },
      async afterResponse(response) {
        planningRawResponse = response.rawResponse;
        await artifacts.write("query-planning/raw_response.json", response.rawResponse);
        await artifacts.write("query-planning/response_metadata.json", {
          responseId: response.responseId,
          requestId: response.requestId,
          usage: response.usage,
          latencyMs: response.latencyMs,
        });
      },
    });
    await artifacts.write("query_plan.json", planning.plan);
    const transport = retrievalTransport || runtime.createCfxGatewayRetrievalTransport({ webProvider });
    const retrieval = await runtime.executeCfxRetrieval({
      plan: planning.plan,
      transport,
      concurrency: 4,
      async beforeRequest(request) {
        await artifacts.write(`retrieval/requests/${request.requestId}.json`, request);
      },
      async afterResponse({ request, response, provider: resultProvider, providerRequestId, latencyMs }) {
        await artifacts.write(`retrieval/responses/${request.requestId}.json`, response);
        await artifacts.write(`retrieval/metadata/${request.requestId}.json`, {
          provider: resultProvider,
          providerRequestId,
          latencyMs,
        });
      },
    });
    await artifacts.write("retrieval/outcomes.json", retrieval.outcomes);
    // Proven proposition-scoped candidate dedup (reproduces the CF1-F03 Run-A
    // 261 -> 177 result): dedupeCfxCandidates() is invoked once per
    // proposition, on that proposition's candidates only, then the results
    // are concatenated. This never merges candidates across propositionId
    // boundaries; that cross-proposition consolidation is a separate,
    // later, exact-identity-only step (aggregateCfxCanonicalDocuments).
    const knownPropositionIds = new Set(inputs.map((input) => input.propositionId));
    const candidateRows = [];
    const dedupeAuditRows = [];
    let duplicateCount = 0;
    for (const input of inputs) {
      const discovered = retrieval.outcomes
        .filter((outcome) => outcome.request.propositionId === input.propositionId)
        .flatMap((outcome) => outcome.candidates);
      for (const candidate of discovered) {
        if (!knownPropositionIds.has(candidate.propositionId) || candidate.propositionId !== input.propositionId) {
          throw new Error(
            `CFX candidate ${candidate.candidateId} has an unknown or mismatched propositionId (${candidate.propositionId}); expected ${input.propositionId}`,
          );
        }
      }
      const deduped = runtime.dedupeCfxCandidates(discovered);
      dedupeAuditRows.push(...deduped.audit);
      duplicateCount += deduped.duplicateCount;
      for (const candidate of orderCandidates(deduped.candidates)) {
        candidateRows.push({ input, candidate });
      }
    }
    await artifacts.write("candidates.json", candidateRows.map(({ candidate }) => candidate));
    await artifacts.write("dedupe_audit.json", {
      policy: "proposition-scoped dedupeCfxCandidates, then exact canonical document aggregation across propositions",
      titleOrSemanticMerging: true,
      propositionScoped: true,
      duplicateCount,
      audit: dedupeAuditRows,
    });

    const canonicalDocuments = runtime.aggregateCfxCanonicalDocuments(
      candidateRows.map(({ input, candidate }) => ({
        candidate,
        targetClaimId: input.claimId,
      })),
    );
    await artifacts.write("canonical_documents.json", canonicalDocuments);
    const selection = selectCfxTopRankedDocumentsPerAssertion(
      inputs,
      canonicalDocuments,
      documentsPerAssertion,
    );
    const selectedCanonicalDocuments = selection.documents;
    const selectedDocumentKeys = new Set(selectedCanonicalDocuments.map(
      (document) => document.documentKey,
    ));
    // The assertion-relative fan-out is keyed off this live per-run
    // selection result (selection.perAssertion), not document.
    // discoveryAssignments -- a document can carry discovery assignments
    // from propositions whose top-five selection later excluded it.
    const inputByProposition = new Map(inputs.map((input) => [input.propositionId, input]));
    const propositionIdsByDocumentKey = new Map();
    for (const assertionSelection of selection.perAssertion) {
      for (const selectedDocument of assertionSelection.selected) {
        const existing = propositionIdsByDocumentKey.get(selectedDocument.documentKey) || [];
        existing.push(assertionSelection.propositionId);
        propositionIdsByDocumentKey.set(selectedDocument.documentKey, existing);
      }
    }
    await artifacts.write("selected_canonical_documents.json", {
      policy: selection.policy,
      maximumPerAssertion: selection.maximumPerAssertion,
      perAssertion: selection.perAssertion,
      selectedDocumentKeys: [...selectedDocumentKeys],
      deferredDocumentKeys: canonicalDocuments
        .filter((document) => !selectedDocumentKeys.has(document.documentKey))
        .map((document) => document.documentKey),
    });
    const academicByDocumentKey = new Map();
    const reusableTextByDocumentKey = new Map();
    for (const document of selectedCanonicalDocuments) {
      const candidate = document.representative;
      const reusableText = await persistedTextResolver(query, {
        pmid: candidate.pmid,
        doi: candidate.doi,
        canonicalUrl: candidate.canonicalUrl || candidate.url,
        normalizedResolvedUrl: candidate.resolvedUrl || candidate.canonicalUrl || candidate.url,
        maximumAgeMs: persistedTextMaximumAgeMs,
      });
      reusableTextByDocumentKey.set(document.documentKey, reusableText);
      const academic = reusableText ? null : await academicResolver({
          url: candidate.canonicalUrl || candidate.resolvedUrl || candidate.url,
          title: candidate.title,
          snippet: candidate.abstractOrSnippet,
          academicMetadata: { pmid: candidate.pmid, doi: candidate.doi },
        });
      academicByDocumentKey.set(document.documentKey, academic);
    }
    const phase2 = await materializeCfxPhase2Documents({
      query,
      pool,
      runtime,
      runId,
      taskContentId: taskId,
      userId,
      candidateRows,
      canonicalDocuments,
      sourceArtifactPath,
      sourceArtifactSha256,
      queueScrapeForDocument(document) {
        if (reusableTextByDocumentKey.get(document.documentKey)) return false;
        const academic = academicByDocumentKey.get(document.documentKey);
        return !academic || academic.retrievalMode !== "full_text";
      },
      activateDocument(document) {
        return selectedDocumentKeys.has(document.documentKey);
      },
    });
    await artifacts.write("discovery_assignments.json", phase2.persisted.flatMap(
      ({ document }) => document.discoveryAssignments));

    const results = [];
    const selectedDocumentRecords = phase2.persisted.filter(
      (record) => selectedDocumentKeys.has(record.document.documentKey),
    );
    // Populated once per document below, reused as both the `documents` map
    // persistCfxSourceAssertions() requires and the documentTitle/documentUrl
    // source for the source-assertion projection -- the same candidate.title /
    // candidate.canonicalUrl||candidate.url pair this file already treats as
    // canonical everywhere else it creates or references this document.
    const documentMetaByKey = new Map();
    let documentOrdinal = 0;
    for (const documentRecord of selectedDocumentRecords) {
      documentOrdinal += 1;
      const { document, bindingRecord } = documentRecord;
      const candidate = document.representative;
      const academic = academicByDocumentKey.get(document.documentKey);
      documentMetaByKey.set(document.documentKey, {
        documentId: document.documentKey,
        referenceContentId: bindingRecord.referenceContentId,
        documentTitle: candidate.title,
        documentUrl: candidate.canonicalUrl || candidate.url,
      });
      // Direct, in-process progress signal for /api/run-evidence: this loop
      // runs synchronously inside that request with no other feedback while
      // it's in flight, and acquisition/bearing on one document can take a
      // while (real scrape + LLM calls).
      console.log(`[CFX] run ${runId}: acquiring document ${documentOrdinal}/${selectedDocumentRecords.length} (${document.documentKey})`);
      const acquired = await persistCfxAcquiredText({
        query,
        pool,
        userId,
        bindingRecord,
        candidate,
        academic,
        sourceQualityEnricher,
        publishingIdentityProcessor,
        sourceCrestProcessor,
        automaticAcquirer,
        queueRetry,
        persistedTextResolver,
        persistedTextMaximumAgeMs,
        preResolvedReusableText: reusableTextByDocumentKey.get(document.documentKey),
      });
      console.log(`[CFX] run ${runId}: document ${documentOrdinal}/${selectedDocumentRecords.length} acquired=${acquired ? acquired.source || "yes" : "no"}; starting bearing`);
      const semanticallyEligible = acquired && [
        "full_text", "substantial_excerpt", "abstract",
      ].includes(acquired.accessLevel);
      const notEligibleStatus = acquired?.accessLevel === "user_action_required"
        ? "user_action_required"
        : acquired ? "phase2_complete" : "awaiting_scrape";
      // Mutually exclusive per run: exactly one of bearingProcessor or the
      // new assertion-relative extraction seam runs for this document, never
      // both. Ends after validated extraction results and artifact capture
      // -- no source-assertion or link persistence in this seam.
      let bearing = null;
      let assertionRelativeExtractionResult = null;
      if (assertionRelativeExtraction) {
        if (semanticallyEligible && !phase2Only) {
          const propositionIds = propositionIdsByDocumentKey.get(document.documentKey) || [];
          const propositions = [];
          for (const propositionId of propositionIds) {
            const evidenceInput = inputByProposition.get(propositionId);
            if (!evidenceInput) continue;
            propositions.push(await runCfxAssertionRelativePacketExtractionForPair({
              runtime,
              provider: extractionProvider,
              model: assertionRelativeExtractionModel,
              propositionId,
              evidenceInput,
              documentKey: document.documentKey,
              referenceContentId: bindingRecord.referenceContentId,
              acquiredText: acquired.cleanedText,
              packetSelectionOptions: resolvedPacketSelectionOptions,
              artifacts,
            }));
          }
          assertionRelativeExtractionResult = { status: "attempted", propositions };
        } else {
          assertionRelativeExtractionResult = { status: notEligibleStatus, propositions: [] };
        }
      } else {
        bearing = semanticallyEligible && !phase2Only
          ? await bearingProcessor({
              bindingId: bindingRecord.binding.bindingId,
              resultContentId: bindingRecord.referenceContentId,
              query,
              pool,
              provider: bearingProvider,
              sourceQualityEnricher,
              sourceCrestProcessor,
              sourceQualityAlreadyProcessed: acquired.sourceQualityProcessed,
              sourceCrestAlreadyProcessed: acquired.sourceCrestAttempted === true,
              retrievalQuality: legacyDocumentQuality(candidate),
              publicationDate: candidate.publicationDate || academic?.publicationDate || null,
            })
          : { status: notEligibleStatus, providerCalls: 0 };
      }
      // bindingRecord.scrapeJobId is a pre-acquisition snapshot (bindings are
      // now created without an eager scrape_jobs row); persistCfxAcquiredText
      // may have since queued one via retryCfxCanonicalAcquisition after a
      // failed direct-fetch attempt, so re-read the binding's current value
      // for accurate reporting.
      const bindingNow = await query(
        "SELECT scrape_job_id FROM cfx_evidence_acquisition_bindings WHERE binding_id=?",
        [bindingRecord.binding.bindingId],
      );
      const currentScrapeJobId = bindingNow?.[0]?.scrape_job_id ?? null;
      console.log(`[CFX] run ${runId}: document ${documentOrdinal}/${selectedDocumentRecords.length} bearing=${bearing?.status || assertionRelativeExtractionResult?.status || "n/a"}`);
      results.push({
        documentKey: document.documentKey,
        canonicalIdentity: document.canonicalIdentity,
        discoveryAssignmentCount: document.discoveryAssignments.length,
        candidateId: candidate.candidateId,
        referenceContentId: bindingRecord.referenceContentId,
        scrapeJobId: currentScrapeJobId,
        acquired,
        bearing,
        assertionRelativeExtraction: assertionRelativeExtractionResult,
      });
    }
    // "The pipeline function returned without throwing" is not the same
    // claim as "every document reached a terminal accepted state" -- a
    // hardcoded "completed" here would say the latter while only the former
    // is true. Roll the honest state up from what each document's bearing
    // (or, under the assertion-relative path, extraction) status actually
    // resolved to. The two roll-ups are computed separately because the two
    // paths are mutually exclusive per run and use different status
    // vocabularies (bearingProcessor's vs. runCfxSingleAssertionPacketExtraction's).
    let overallStatus;
    let assertionRelativeExtractionSummary = null;
    if (assertionRelativeExtraction) {
      const allPropositionResults = results.flatMap(
        (row) => row.assertionRelativeExtraction?.propositions || [],
      );
      const anyFailedExtraction = allPropositionResults.some(
        (row) => row.extractionStatus === "failed" || row.packetSelectionFailure,
      );
      const anyPendingDocument = results.some(
        (row) => row.assertionRelativeExtraction?.status !== "attempted",
      );
      overallStatus = anyFailedExtraction && anyPendingDocument
        ? "completed_with_pending_and_failed_extractions"
        : anyFailedExtraction
          ? "completed_with_failed_extractions"
          : anyPendingDocument
            ? "completed_with_pending"
            : "completed";
      assertionRelativeExtractionSummary = {
        documentsAttempted: results.filter((row) => row.assertionRelativeExtraction?.status === "attempted").length,
        propositionDocumentPairs: allPropositionResults.length,
        emptyPacketSelections: allPropositionResults.filter((row) => row.emptyPacketSelection).length,
        packetSelectionFailures: allPropositionResults.filter((row) => row.packetSelectionFailure).length,
        extractionProviderCalls: allPropositionResults.reduce((sum, row) => sum + Number(row.extractionProviderCallCount || 0), 0),
        acceptedRowCount: allPropositionResults.reduce((sum, row) => sum + row.acceptedRows.length, 0),
        rejectedRowCount: allPropositionResults.reduce((sum, row) => sum + row.rejectedRows.length, 0),
        failedExtractions: allPropositionResults.filter((row) => row.extractionStatus === "failed").length,
        persistedSourceAssertions: 0,
        // Stays 0 unless the further-gated assertionRelativeLinkSuggestion
        // stage below both runs and produces at least one approved
        // support/refute/nuance decision.
        persistedLinks: 0,
      };
      // Provisional source-assertion persistence: a second, separately gated
      // flag on top of assertionRelativeExtraction itself. Projects every
      // accepted extraction row across the whole run to the proven
      // CfxPersistableSourceAssertion shape and persists all of them in one
      // explicit transaction -- never per document, never per row -- so a
      // mid-run failure (e.g. a provenance collision) leaves nothing
      // persisted rather than a partial write. Ends at persistence; no
      // buildCfxLinkSuggestionRequest, validateCfxLinkSuggestions,
      // persistCfxLinkSuggestions, or persistAcceptedBearingAssertions call
      // exists past this point.
      if (assertionRelativeSourceAssertionPersistence) {
        const taskClaimIds = new Map(
          [...inputByProposition].map(([propositionId, input]) => [propositionId, input.claimId]),
        );
        const documentsForPersistence = new Map(
          [...documentMetaByKey].map(([documentId, meta]) => [
            documentId,
            { documentId: meta.documentId, referenceContentId: meta.referenceContentId },
          ]),
        );
        const projectedRows = projectCfxAssertionRelativeSourceAssertions({
          runtime, runId, documentMetaByKey, propositionRecords: allPropositionResults,
        });
        await artifacts.write(
          "assertion-relative-extraction/source-assertion-projection.json",
          projectedRows,
        );
        let persistedSourceAssertions = [];
        let persistenceFailure = null;
        if (projectedRows.length > 0) {
          try {
            persistedSourceAssertions = await withTransaction(async ({ query: tx }) =>
              runtime.persistCfxSourceAssertions({
                query: tx,
                store: { ensureClaimSource, ensureContentClaim, ensureContentRelation, findOrCreateCanonicalClaim },
                taskClaimIds, documents: documentsForPersistence, rows: projectedRows,
              }), { pool });
          } catch (error) {
            persistenceFailure = { name: error?.name || "Error", message: error?.message || String(error) };
            throw error;
          } finally {
            await artifacts.write("assertion-relative-extraction/source-assertion-persistence-result.json", {
              transactionOutcome: persistenceFailure ? "rolled_back" : "committed",
              failure: persistenceFailure,
              persisted: persistedSourceAssertions.map((row) => ({
                sourceAssertionId: row.sourceAssertionId,
                caseAssertionId: row.caseAssertionId,
                documentId: row.documentId,
                taskClaimId: row.taskClaimId,
                referenceContentId: row.referenceContentId,
                evidenceClaimId: row.evidenceClaimId,
                claimSourceId: row.claimSourceId,
                persistenceStatus: row.persistenceStatus,
              })),
            });
          }
        }
        assertionRelativeExtractionSummary.persistedSourceAssertions = persistedSourceAssertions.length;

        // Batched link suggestion: a third gate, on top of the first two.
        // Model calls (one per case assertion with at least one persisted
        // provisional source assertion) all happen before the one explicit
        // persistence transaction opens -- never inside it. Only
        // support/refute/nuance decisions ever reach persistCfxLinkSuggestions();
        // insufficient decisions are computed, reported in artifacts, and
        // dropped here, never persisted as a link.
        if (assertionRelativeLinkSuggestion && persistedSourceAssertions.length > 0) {
          const groupedByCaseAssertion = new Map();
          for (const row of persistedSourceAssertions) {
            const group = groupedByCaseAssertion.get(row.caseAssertionId) || [];
            group.push(row);
            groupedByCaseAssertion.set(row.caseAssertionId, group);
          }
          const linkSuggestionResults = await Promise.all(
            [...groupedByCaseAssertion.entries()].map(([caseAssertionId, sourceAssertions]) =>
              runCfxLinkSuggestionForCaseAssertion({
                runtime,
                provider: linkSuggestionProvider,
                model: assertionRelativeLinkSuggestionModel,
                caseAssertionId,
                caseAssertionText: sourceAssertions[0].caseAssertionText,
                sourceAssertions,
                artifacts,
              })),
          );
          const approvedLinkSuggestions = linkSuggestionResults.flatMap((row) => row.approvedSuggestions);

          let persistedLinks = [];
          let linkPersistenceFailure = null;
          if (approvedLinkSuggestions.length > 0) {
            const suggestionModelCallIds = new Map(
              linkSuggestionResults.map((row) => [row.caseAssertionId, row.modelCallId]),
            );
            try {
              persistedLinks = await withTransaction(async ({ query: tx }) =>
                runtime.persistCfxLinkSuggestions({
                  query: tx,
                  store: { ensureClaimSource, ensureContentClaim, ensureContentRelation, findOrCreateCanonicalClaim },
                  taskContentId: taskId,
                  rows: persistedSourceAssertions,
                  suggestions: approvedLinkSuggestions,
                  suggestionRunId: runId,
                  suggestionModelCallIds,
                  suggestionPromptHash: runtime.cfxLinkSuggestionPromptHash(),
                  suggestionSchemaHash: runtime.cfxLinkSuggestionSchemaHash(),
                  model: assertionRelativeLinkSuggestionModel,
                }), { pool });
            } catch (error) {
              linkPersistenceFailure = { name: error?.name || "Error", message: error?.message || String(error) };
              throw error;
            } finally {
              await artifacts.write("assertion-relative-link-suggestion/persistence-result.json", {
                transactionOutcome: linkPersistenceFailure ? "rolled_back" : "committed",
                failure: linkPersistenceFailure,
                persisted: persistedLinks.map((row) => ({
                  sourceAssertionId: row.sourceAssertionId,
                  referenceClaimTaskLinkId: row.referenceClaimTaskLinkId,
                  taskClaimId: row.taskClaimId,
                  referenceContentId: row.referenceContentId,
                  suggestedStance: row.suggestedStance,
                  persistenceStatus: row.persistenceStatus,
                })),
              });
            }
          }
          assertionRelativeExtractionSummary.persistedLinks = persistedLinks.length;
          assertionRelativeExtractionSummary.linkSuggestionCalls = linkSuggestionResults.length;
          assertionRelativeExtractionSummary.approvedLinks = approvedLinkSuggestions.length;
          assertionRelativeExtractionSummary.insufficientDecisions = linkSuggestionResults.reduce(
            (sum, row) => sum + row.insufficientSuggestions.length, 0,
          );
        }
      }
    } else {
      const REJECTED_BEARING_STATUSES = new Set(["rejected", "provider_failed"]);
      const anyRejectedBearing = results.some(
        (row) => REJECTED_BEARING_STATUSES.has(row.bearing?.status),
      );
      const anyPendingBearing = results.some(
        (row) => row.bearing?.status !== "completed"
          && !REJECTED_BEARING_STATUSES.has(row.bearing?.status),
      );
      overallStatus = anyRejectedBearing && anyPendingBearing
        ? "completed_with_pending_and_rejected"
        : anyRejectedBearing
          ? "completed_with_rejected"
          : anyPendingBearing
            ? "completed_with_pending"
            : "completed";
    }
    const summary = {
      status: overallStatus,
      runId,
      taskContentId: taskId,
      claimCount: inputs.length,
      planningProviderCalls: 1,
      retrievalLogicalRequests: retrieval.requestCount,
      retrievalProviderRequests: retrieval.providerRequestCount,
      candidateCount: candidateRows.length,
      canonicalDocumentCount: canonicalDocuments.length,
      selectedCanonicalDocumentCount: selectedCanonicalDocuments.length,
      deferredCanonicalDocumentCount:
        canonicalDocuments.length - selectedCanonicalDocuments.length,
      selectionPolicy: selection.policy,
      documentsPerAssertion: selection.maximumPerAssertion,
      discoveryAssignmentCount: canonicalDocuments.reduce(
        (sum, document) => sum + document.discoveryAssignments.length, 0),
      queuedScrapeJobs: results.filter((row) => row.scrapeJobId).length,
      targetedBearingProviderCalls: results.reduce((sum, row) => sum + Number(row.bearing?.providerCalls || 0), 0),
      assertionRelativeExtractionEnabled: assertionRelativeExtraction,
      assertionRelativeExtractionSummary,
      results,
      planningRawResponsePreserved: planningRawResponse !== null,
    };
    await artifacts.write("run_summary.json", summary);
    const manifest = await artifacts.finalize({ status: overallStatus, runId });
    finalized = true;
    return { ...summary, artifactRoot: manifest.root, artifactAggregateSha256: manifest.aggregateSha256 };
  } catch (error) {
    if (!finalized) {
      try {
        await artifacts.write("failure.json", { name: error?.name || "Error", message: error?.message || String(error) });
        await artifacts.finalize({ status: "failed", runId });
      } catch { /* Preserve the original failure. */ }
    }
    throw error;
  }
}

/** Governed Phase 2 entry: discovery and acquisition only, never bearing. */
export function runCfxPhase2Acquisition(input = {}) {
  return runCfxProductionEvidencePipeline({ ...input, phase2Only: true });
}
