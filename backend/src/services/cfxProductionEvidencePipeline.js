import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
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
  ensureContentRelation,
  ensureCfxDocumentDiscoveryLink,
  findOrCreateReferenceContent,
} from "./cfxProductionEvidenceStore.js";
import { ensureCfxSourceQuality } from "./cfxSourceQualityCompatibility.js";
import { ensureCfxSourceCrest } from "./cfxSourceCrestCompatibility.js";
import { acquireCfxDocumentAutomatically } from "./cfxAutomaticAcquisition.js";
import logger from "../utils/logger.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const canonicalJson = (value) => `${JSON.stringify(value, null, 2)}\n`;

function positive(value, name) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) throw new TypeError(`${name} must be a positive integer`);
  return number;
}

function parseJson(value) {
  if (!value) return {};
  if (typeof value === "object") return value;
  try { return JSON.parse(value); } catch { return {}; }
}

function articleStance(value) {
  const stance = String(value || "").trim().toLowerCase();
  if (["adopts", "endorses", "supports", "argues", "relies_on"].includes(stance)) return "adopts";
  if (["challenges", "disputes", "refutes", "criticizes", "rejects"].includes(stance)) return "challenges";
  return "reports";
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

function identifierMetadata(row) {
  const raw = String(row.study_identifier || "").trim();
  const identifiers = { doi: [], pmid: [], urls: [] };
  if (/^10\.\d{4,9}\//iu.test(raw)) identifiers.doi.push(raw);
  else if (/^(?:PMID\s*[:#]?\s*)?\d{4,12}$/iu.test(raw)) identifiers.pmid.push(raw.replace(/\D/gu, ""));
  else if (/^https?:\/\//iu.test(raw)) identifiers.urls.push(raw);
  return identifiers;
}

async function defaultRuntime() {
  const [handoff, planning, retrieval, candidates, canonicalDocuments, artifacts, sourceUnits] = await Promise.all([
    import("../../dist/claimfoundry/cfx/evidenceSearch/buildEvidenceSearchHandoff.js"),
    import("../../dist/claimfoundry/cfx/retrieval/queryPlanning.js"),
    import("../../dist/claimfoundry/cfx/retrieval/executeRetrieval.js"),
    import("../../dist/claimfoundry/cfx/retrieval/candidates.js"),
    import("../../dist/claimfoundry/cfx/acquisition/canonicalDocuments.js"),
    import("../../dist/claimfoundry/cfx/artifacts/immutableArtifacts.js"),
    import("../../dist/claimfoundry/shared/sourceUnits/index.js"),
  ]);
  return { ...handoff, ...planning, ...retrieval, ...candidates, ...canonicalDocuments, ...artifacts, ...sourceUnits };
}

export async function loadProductionCfxEvidenceInputs({ query, taskContentId, claimIds, runtime }) {
  const taskId = positive(taskContentId, "taskContentId");
  const ids = [...new Set(claimIds.map((id) => positive(id, "claimId")))];
  if (!ids.length) throw new TypeError("claimIds must be non-empty");
  const placeholders = ids.map(() => "?").join(",");
  const rows = await query(
    `SELECT c.claim_id,c.claim_text,cc.object_claim_text,cc.speaker_entity,
            cc.article_stance AS content_article_stance,
            cet.evaluation_target_id,cet.target_order,cet.target_text,
            cet.source_excerpt,cet.article_stance AS target_article_stance,
            cet.study_title,cet.study_authors,cet.study_year,cet.study_identifier,
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
    const propositionId = `P${claimId}`;
    const substantiveAssertion = String(row.claim_text || "");
    if (!substantiveAssertion.trim()) throw new Error(`Claim ${claimId} has no canonical text`);
    const groundingText = String(row.source_excerpt || row.object_claim_text || row.target_text || substantiveAssertion);
    const unitId = `U${claimId}`;
    const assertionSource = String(row.speaker_entity || "article voice");
    const references = row.study_title || row.study_authors || row.study_year || row.study_identifier
      ? [{
          referenceId: `REF-${claimId}`,
          text: [row.study_title, row.study_authors, row.study_year, row.study_identifier].filter(Boolean).join("; "),
          sourceUnitId: unitId,
          title: row.study_title || null,
          authors: String(row.study_authors || "").split(/\s*[,;]\s*/u).filter(Boolean),
          publicationYear: row.study_year || null,
          identifiers: identifierMetadata(row),
        }]
      : [];
    const handoff = runtime.buildCfxEvidenceSearchHandoff({
      review: {
        propositionId,
        substantiveAssertion,
        assertionSource,
        articleStance: articleStance(row.target_article_stance || row.content_article_stance),
      },
      source: {
        propositionId,
        assertion: substantiveAssertion,
        assertionSource,
        whyItMattersToArticleThesis: "Production canonical evaluation target",
        groundingUnitIds: [unitId],
      },
      article: {
        sourceUnits: [{ unitId, text: groundingText, charStart: 0, charEnd: groundingText.length }],
        citationMetadata: {
          links: [],
          citationMarkers: references.map((reference) => ({
            markerId: `MARKER-${claimId}`,
            displayText: reference.text,
            sourceUnitId: unitId,
            resolvedReferenceId: reference.referenceId,
          })),
          references,
        },
      },
    });
    const hints = parseJson(row.query_hints_json);
    return {
      propositionId,
      claimId,
      substantiveAssertion,
      assertionSource,
      articleStance: articleStance(row.target_article_stance || row.content_article_stance),
      groundingUnitIds: [unitId],
      groundingText: handoff.groundingText,
      literalIdentifiers: handoff.literalIdentifiers,
      lookupHints: handoff.lookupHints,
      deterministicQueries: {
        literalQuery: handoff.queries.literal[0] || substantiveAssertion,
        sourceQualifiedQuery: handoff.queries.sourceQualified[0] || null,
        studyLookupQueries: handoff.queries.studyLookup,
      },
      compatibility: {
        evaluationTargetId: row.evaluation_target_id == null ? null : Number(row.evaluation_target_id),
        populationScope: row.population_scope || null,
        legacyPrimaryQueryIgnored: hints.primaryQueryText || null,
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
      outcome: row.status === "success" ? "acquired" : row.status,
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
    const candidateRows = [];
    for (const input of inputs) {
      const discovered = retrieval.outcomes
        .filter((outcome) => outcome.request.propositionId === input.propositionId)
        .flatMap((outcome) => outcome.candidates);
      for (const candidate of orderCandidates(discovered)) {
        candidateRows.push({ input, candidate });
      }
    }
    await artifacts.write("candidates.json", candidateRows.map(({ candidate }) => candidate));
    await artifacts.write("dedupe_audit.json", {
      policy:"exact canonical document aggregation only",
      titleOrSemanticMerging:false,
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
    let documentOrdinal = 0;
    for (const documentRecord of selectedDocumentRecords) {
      documentOrdinal += 1;
      const { document, bindingRecord } = documentRecord;
      const candidate = document.representative;
      const academic = academicByDocumentKey.get(document.documentKey);
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
      const bearing = semanticallyEligible && !phase2Only
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
        : {
            status: acquired?.accessLevel === "user_action_required"
              ? "user_action_required"
              : acquired ? "phase2_complete" : "awaiting_scrape",
            providerCalls: 0,
          };
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
      console.log(`[CFX] run ${runId}: document ${documentOrdinal}/${selectedDocumentRecords.length} bearing=${bearing?.status || "n/a"}`);
      results.push({
        documentKey: document.documentKey,
        canonicalIdentity: document.canonicalIdentity,
        discoveryAssignmentCount: document.discoveryAssignments.length,
        candidateId: candidate.candidateId,
        referenceContentId: bindingRecord.referenceContentId,
        scrapeJobId: currentScrapeJobId,
        acquired,
        bearing,
      });
    }
    // "The pipeline function returned without throwing" is not the same
    // claim as "every document reached a terminal accepted state" -- a
    // hardcoded "completed" here would say the latter while only the former
    // is true. Roll the honest state up from what each document's bearing
    // status actually resolved to.
    const REJECTED_BEARING_STATUSES = new Set(["rejected", "provider_failed"]);
    const anyRejectedBearing = results.some(
      (row) => REJECTED_BEARING_STATUSES.has(row.bearing?.status),
    );
    const anyPendingBearing = results.some(
      (row) => row.bearing?.status !== "completed"
        && !REJECTED_BEARING_STATUSES.has(row.bearing?.status),
    );
    const overallStatus = anyRejectedBearing && anyPendingBearing
      ? "completed_with_pending_and_rejected"
      : anyRejectedBearing
        ? "completed_with_rejected"
        : anyPendingBearing
          ? "completed_with_pending"
          : "completed";
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
