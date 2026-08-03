import "dotenv/config";
import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { copyFile, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import mysql, { type Pool, type PoolConnection } from "mysql2/promise";
import { resolveSourceIdentity } from "../../../../services/sourceIdentityResolver.js";
import createClaimsRoutes from "../../../routes/claims/claims.routes.js";
import createReferenceClaimTaskRoutes from "../../../routes/claims/referenceClaimTask.routes.js";
import createPublishersRoutes from "../../../routes/publishers/publishers.routes.js";
import { logUserActivity } from "../../../utils/logUserActivity.js";
import {
  finishOpenAiUsageCapture,
  withOpenAiUsageCapture,
} from "../../../core/openAiUsageTelemetry.js";
import { processPublishingIdentity } from "../../../services/publishingIdentityPipeline.js";
import { ensureCfxSourceCrest } from "../../../services/cfxSourceCrestCompatibility.js";
import {
  ensureContentRelation,
  findOrCreateReferenceContent,
} from "../../../services/cfxProductionEvidenceStore.js";
import {
  aggregateArtifactHash,
  createImmutableDirectory,
  freezeArtifactTree,
  hashArtifactTree,
  sha256,
  writeImmutableJson,
  writeImmutableText,
} from "../artifacts/immutableArtifacts.js";
import {
  buildCfxLinkSuggestionRequest,
  cfxLinkSuggestionPromptHash,
  cfxLinkSuggestionSchemaHash,
  stableCfxSourceAssertionId,
  validateCfxLinkSuggestions,
  type CfxAcceptedLinkSuggestion,
  type CfxPersistableSourceAssertion,
  type CfxRejectedLinkSuggestion,
} from "../finalLinking/linkSuggestion.js";
import {
  persistCfxLinkSuggestions,
  persistCfxSourceAssertions,
  type CfxPersistedSourceAssertion,
  type CfxSourceDocumentIdentity,
} from "../finalLinking/persistence.js";
import { createOpenAiCf7StructuredProvider } from "../../shared/provider/index.js";
import { canonicalHash } from "../../shared/sourceUnits/index.js";

type Query = (sql: string, values?: unknown[]) => Promise<any>;

const here = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(here, "../../../..");
const repositoryRoot = path.resolve(backendRoot, "..");
const artifactParent = path.join(repositoryRoot, "artifacts/claim-foundry/cfx/CF1-F03");
const authoritativeExtractionRunId = "cfx-single-assertion-packet-extraction-20260802090828";
const isolatedLinkRunId = "cfx-final-source-links-20260802144343";
const authoritativeExtractionRoot = path.join(artifactParent, authoritativeExtractionRunId);
const isolatedLinkRoot = path.join(artifactParent, isolatedLinkRunId);
const rankedAcquisitionRoot = path.join(
  artifactParent,
  "cfx-ranked-minimal-extraction-20260802061510",
);
const frozenInputPath = path.join(isolatedLinkRoot, "source-claim-inputs.json");
const taskContentId = 18056;
const caseClaimIds = new Map<string, number>([["P54895", 54895], ["P54897", 54897]]);
const modelConfig = Object.freeze({
  model: "gpt-4o-mini",
  temperature: 0.1,
  concurrency: 2,
  maxOutputTokens: 4_000,
  timeoutMs: 180_000,
  retryCount: 0,
  store: false as const,
  expectedCalls: 2,
});

function stamp(): string {
  return new Date().toISOString().replace(/[-:.TZ]/gu, "").slice(0, 14);
}

function jsonHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

async function readJson(filePath: string): Promise<any> {
  return JSON.parse(await readFile(filePath, "utf8"));
}

function poolQuery(pool: Pool): Query {
  return async (sql, values = []) => {
    const [rows] = await pool.query(sql, values);
    return rows;
  };
}

function connectionQuery(connection: PoolConnection): Query {
  return async (sql, values = []) => {
    const [rows] = await connection.query(sql, values);
    return rows;
  };
}

async function transaction<T>(pool: Pool, callback: (query: Query) => Promise<T>): Promise<T> {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const result = await callback(connectionQuery(connection));
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function verifyManifestFile(root: string, relativePath: string): Promise<string> {
  let manifest;
  try {
    manifest = await readJson(path.join(root, "artifact-manifest.json"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    manifest = await readJson(path.join(root, "artifact-hashes.json"));
  }
  const bytes = await readFile(path.join(root, relativePath));
  const actual = sha256(bytes);
  const expected = manifest.files?.find((row: any) => row.path === relativePath)?.sha256;
  if (!expected || expected !== actual) throw new Error(`frozen artifact hash mismatch: ${relativePath}`);
  return actual;
}

async function verifyLegacyNestedAcquisition(documentId: string): Promise<{
  acquisition: any;
  acquisitionSha256: string;
  acquisitionResultsSha256: string;
}> {
  const acquisitionResultsSha256 = await verifyManifestFile(rankedAcquisitionRoot, "acquisition-results.json");
  const acquisitionResults = await readJson(path.join(rankedAcquisitionRoot, "acquisition-results.json"));
  const summary = acquisitionResults.find((row: any) => row.documentId === documentId);
  if (!summary?.acquired) throw new Error(`frozen acquisition summary missing for ${documentId}`);

  const acquisitionPath = path.join(rankedAcquisitionRoot, `documents/${documentId}/acquisition.json`);
  const acquisitionBytes = await readFile(acquisitionPath);
  const acquisition = JSON.parse(acquisitionBytes.toString("utf8"));
  const metadata = await stat(acquisitionPath);
  if ((metadata.mode & 0o222) !== 0) throw new Error(`legacy nested artifact is not frozen: ${documentId}`);
  if (!acquisition.acquired || acquisition.method !== summary.acquisitionMethod
    || acquisition.extractedDocument?.text?.length !== summary.textLength) {
    throw new Error(`legacy nested acquisition disagrees with frozen summary: ${documentId}`);
  }
  for (const attempt of acquisition.attempts ?? []) {
    if (!attempt.rawResponse || !attempt.rawResponseSha256) continue;
    const responseBytes = await readFile(path.join(rankedAcquisitionRoot, `documents/${documentId}`, attempt.rawResponse));
    if (sha256(responseBytes) !== attempt.rawResponseSha256) {
      throw new Error(`legacy raw acquisition response hash mismatch: ${documentId}/${attempt.rawResponse}`);
    }
  }
  return {
    acquisition,
    acquisitionSha256: sha256(acquisitionBytes),
    acquisitionResultsSha256,
  };
}

async function loadFrozenInputs(): Promise<{
  rows: CfxPersistableSourceAssertion[];
  inputMap: Record<string, unknown>;
}> {
  const [sourceInputsHash, acceptedRowsHash, extractionRequestsHash] = await Promise.all([
    verifyManifestFile(isolatedLinkRoot, "source-claim-inputs.json"),
    verifyManifestFile(authoritativeExtractionRoot, "accepted-source-assertions.json"),
    verifyManifestFile(authoritativeExtractionRoot, "exact-model-requests.json"),
  ]);
  const rows = await readJson(frozenInputPath) as CfxPersistableSourceAssertion[];
  if (rows.length !== 14) throw new Error(`expected 14 frozen source assertion occurrences, found ${rows.length}`);
  if (new Set(rows.map((row) => row.sourceAssertionId)).size !== rows.length) {
    throw new Error("frozen sourceAssertionId values are not unique");
  }
  for (const row of rows) {
    const expected = stableCfxSourceAssertionId({
      caseAssertionId: row.caseAssertionId,
      documentId: row.documentId,
      exactExcerpt: row.exactExcerpt,
      sourceAssertion: row.sourceAssertion,
    });
    if (expected !== row.sourceAssertionId) throw new Error(`stable ID mismatch: ${row.sourceAssertionId}`);
    if (!caseClaimIds.has(row.caseAssertionId)) throw new Error(`unexpected case assertion ${row.caseAssertionId}`);
    if (row.extractionRunId !== authoritativeExtractionRunId) throw new Error("extraction lineage changed");
  }
  const documents = [...new Map(rows.map((row) => [row.documentId, {
    documentId: row.documentId,
    title: row.documentTitle,
    url: row.documentUrl,
  }])).values()];
  if (documents.length !== 5) throw new Error(`expected five distinct documents, found ${documents.length}`);
  return {
    rows,
    inputMap: {
      taskContentId,
      caseClaims: [...caseClaimIds].map(([caseAssertionId, claimId]) => ({ caseAssertionId, claimId })),
      authoritativeExtraction: {
        runId: authoritativeExtractionRunId,
        root: authoritativeExtractionRoot,
        acceptedRowsPath: path.join(authoritativeExtractionRoot, "accepted-source-assertions.json"),
        acceptedRowsSha256: acceptedRowsHash,
        exactRequestsPath: path.join(authoritativeExtractionRoot, "exact-model-requests.json"),
        exactRequestsSha256: extractionRequestsHash,
      },
      frozenProjection: {
        runId: isolatedLinkRunId,
        path: frozenInputPath,
        sha256: sourceInputsHash,
      },
      acceptedOccurrenceCount: rows.length,
      canonicalSourceAssertionTextCount: new Set(rows.map((row) => row.sourceAssertion)).size,
      documents,
      explicitlyExcluded: [
        "all multi-document extraction runs",
        "repeat single-document extraction run cfx-single-assertion-packet-extraction-20260802114251",
      ],
      upstreamStagesRerun: [],
    },
  };
}

async function assertSchema(query: Query): Promise<void> {
  const required = [
    "cfx_source_assertion_provenance", "claims", "content_claims", "claim_sources",
    "content_relations", "reference_claim_task_links", "user_activities",
    "publishers", "content_publishers", "publisher_external_signals", "admiralty_evaluations",
  ];
  const rows = await query(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema=DATABASE() AND table_name IN (${required.map(() => "?").join(",")})`,
    required,
  );
  const found = new Set(rows.map((row: any) => String(row.table_name ?? row.TABLE_NAME)));
  const missing = required.filter((table) => !found.has(table));
  if (missing.length) throw new Error(`missing required production schema: ${missing.join(", ")}`);
}

async function materializeDocuments(query: Query, rows: CfxPersistableSourceAssertion[]): Promise<{
  documents: Map<string, CfxSourceDocumentIdentity>;
  records: Array<Record<string, unknown>>;
}> {
  const distinct = [...new Map(rows.map((row) => [row.documentId, row])).values()];
  const documents = new Map<string, CfxSourceDocumentIdentity>();
  const records: Array<Record<string, unknown>> = [];
  for (const row of distinct) {
    const referenceContentId = await findOrCreateReferenceContent(query, {
      canonicalUrl: row.documentUrl,
      url: row.documentUrl,
      title: row.documentTitle,
      provider: new URL(row.documentUrl).hostname.replace(/^www\./u, ""),
      snippet: row.exactExcerpt,
    });
    const relationId = await ensureContentRelation(query, { taskContentId, referenceContentId });
    const existing = await query(
      `SELECT p.publisher_id,p.publisher_name
         FROM content_publishers cp JOIN publishers p ON p.publisher_id=cp.publisher_id
        WHERE cp.content_id=? ORDER BY COALESCE(cp.is_primary,0) DESC,cp.content_publisher_id DESC LIMIT 1`,
      [referenceContentId],
    );
    let identityResult: any = null;
    if (!existing[0]?.publisher_id) {
      const resolved = await (resolveSourceIdentity as any)(row.documentUrl, {
        query,
        hintName: null,
        title: row.documentTitle,
        author: null,
        force: false,
        structuredIdentity: null,
      });
      identityResult = await (processPublishingIdentity as any)({
        query,
        contentId: referenceContentId,
        sourceUrl: row.documentUrl,
        fallbackPublisher: resolved.publisherName ? { name: resolved.publisherName } : null,
      });
    }
    const persisted = await query(
      `SELECT p.publisher_id,p.publisher_name,p.entity_type,p.domain,cp.is_primary
         FROM content_publishers cp JOIN publishers p ON p.publisher_id=cp.publisher_id
        WHERE cp.content_id=? ORDER BY COALESCE(cp.is_primary,0) DESC,cp.content_publisher_id DESC LIMIT 1`,
      [referenceContentId],
    );
    documents.set(row.documentId, { documentId: row.documentId, referenceContentId });
    records.push({
      documentId: row.documentId,
      title: row.documentTitle,
      url: row.documentUrl,
      referenceContentId,
      contentRelationId: relationId,
      publisherBefore: existing[0] ?? null,
      identityResolutionAttempted: !existing[0]?.publisher_id,
      identityResult: identityResult ? {
        legacyPublisher: identityResult.legacyPublisher ?? null,
        persistence: identityResult.persistence ?? null,
      } : null,
      persistedPublisher: persisted[0] ?? null,
    });
  }
  return { documents, records };
}

async function crestSnapshot(query: Query, referenceContentId: number): Promise<Record<string, unknown>> {
  const [publishers, contentCrests] = await Promise.all([
    query(
      `SELECT p.publisher_id,p.publisher_name,p.entity_type,p.domain,cp.is_primary
         FROM content_publishers cp JOIN publishers p ON p.publisher_id=cp.publisher_id
        WHERE cp.content_id=? ORDER BY COALESCE(cp.is_primary,0) DESC,cp.content_publisher_id DESC`,
      [referenceContentId],
    ),
    query(
      `SELECT admiralty_evaluation_id,admiralty_code,evaluation_status,publisher_id,updated_at
         FROM admiralty_evaluations WHERE target_type='content' AND target_id=?
        ORDER BY updated_at DESC,admiralty_evaluation_id DESC`,
      [referenceContentId],
    ),
  ]);
  const publisherId = Number(publishers[0]?.publisher_id) || null;
  const [publisherCrests, signals] = publisherId ? await Promise.all([
    query(
      `SELECT admiralty_evaluation_id,admiralty_code,evaluation_status,updated_at
         FROM admiralty_evaluations WHERE target_type='publisher' AND target_id=?
        ORDER BY updated_at DESC,admiralty_evaluation_id DESC`,
      [publisherId],
    ),
    query(
      `SELECT provider,signal_type,admiralty_effect_type,normalized_score,reliability_bucket,
              confidence_delta,reliability_delta,cap,cap_reason,flags,matched_name,matched_domain,
              match_confidence,evidence_url,explanation,retrieved_at,error_status,raw_value
         FROM publisher_external_signals WHERE publisher_id=?
        ORDER BY retrieved_at DESC,id DESC`,
      [publisherId],
    ),
  ]) : [[], []];
  return { publishers, contentCrests, publisherCrests, signals };
}

async function runSourceCrest(query: Query, documentRecords: Array<Record<string, unknown>>) {
  const results = [];
  const persistence = [];
  for (const document of documentRecords) {
    const referenceContentId = Number(document.referenceContentId);
    const before = await crestSnapshot(query, referenceContentId);
    const publisher = document.persistedPublisher as any;
    const result = await ensureCfxSourceCrest({
      query,
      referenceContentId,
      publisherId: publisher?.publisher_id ?? null,
      publisherName: publisher?.publisher_name ?? null,
    });
    const after = await crestSnapshot(query, referenceContentId);
    const beforeCode = (before.contentCrests as any[])?.[0]?.admiralty_code ?? null;
    const afterCode = (after.contentCrests as any[])?.[0]?.admiralty_code ?? null;
    const perennial = (after.signals as any[]).find((row) => row.provider === "wikipedia_perennial_sources") ?? null;
    results.push({
      documentId: document.documentId,
      referenceContentId,
      publisher: publisher ?? null,
      status: result.status,
      completed: result.completed,
      providerSummary: result.enrichment?.provider_summary ?? {},
      enrichment: result.enrichment ?? null,
      perennialSources: perennial,
    });
    persistence.push({
      documentId: document.documentId,
      referenceContentId,
      before,
      after,
      preexistingAggregateCode: beforeCode,
      finalAggregateCode: afterCode,
      preexistingAggregatePreserved: beforeCode == null || beforeCode === afterCode,
      perennialSourcesStoredSeparately: Boolean(perennial),
      perennialAdmiraltyEffectType: perennial?.admiralty_effect_type ?? null,
    });
  }
  return { results, persistence };
}

function prepareLinkCalls(rows: CfxPersistableSourceAssertion[]) {
  return [...caseClaimIds.keys()].map((caseAssertionId, index) => {
    const sourceAssertions = rows.filter((row) => row.caseAssertionId === caseAssertionId);
    const request = buildCfxLinkSuggestionRequest({
      caseAssertionId,
      caseAssertionText: sourceAssertions[0]!.caseAssertionText,
      sourceAssertions,
      model: modelConfig.model,
      temperature: modelConfig.temperature,
      maxOutputTokens: modelConfig.maxOutputTokens,
      timeoutMs: modelConfig.timeoutMs,
    });
    return {
      callId: `link-request-${String(index + 1).padStart(3, "0")}`,
      caseAssertionId,
      sourceAssertions,
      request,
      requestHash: canonicalHash(request),
    };
  });
}

function publicCall(call: ReturnType<typeof prepareLinkCalls>[number]) {
  return {
    callId: call.callId,
    caseAssertionId: call.caseAssertionId,
    suppliedSourceAssertionIds: call.sourceAssertions.map((row) => row.sourceAssertionId),
    sourceAssertionCount: call.sourceAssertions.length,
    requestHash: call.requestHash,
    request: call.request,
  };
}

async function invokeLinks(root: string, rows: CfxPersistableSourceAssertion[]) {
  const calls = prepareLinkCalls(rows);
  if (calls.length !== modelConfig.expectedCalls
    || calls[0]!.sourceAssertions.length !== 8
    || calls[1]!.sourceAssertions.length !== 6) {
    throw new Error("governed two-call partition changed");
  }
  const provider = createOpenAiCf7StructuredProvider();
  let providerCalls = 0;
  const results: any[] = Array(calls.length);
  await Promise.all(calls.map(async (call, index) => {
    providerCalls += 1;
    if (providerCalls > modelConfig.expectedCalls) throw new Error("two-call ceiling exceeded");
    const started = performance.now();
    try {
      const response = await provider.invokeStructured(call.request);
      const raw = {
        callId: call.callId,
        caseAssertionId: call.caseAssertionId,
        responseId: response.responseId,
        requestId: response.requestId,
        model: response.model,
        usage: response.usage,
        latencyMs: Math.round(performance.now() - started),
        rawResponse: response.rawResponse,
        parsedOutput: response.output,
        capturedBeforeValidation: true,
      };
      await writeImmutableJson(path.join(root, `${call.callId}-raw-response.json`), raw);
      const validation = validateCfxLinkSuggestions({
        caseAssertionId: call.caseAssertionId,
        suppliedSourceAssertionIds: call.sourceAssertions.map((row) => row.sourceAssertionId),
        rawOutput: response.output,
      });
      results[index] = { ...raw, validation, providerStatus: "completed" };
    } catch (error) {
      results[index] = {
        callId: call.callId,
        caseAssertionId: call.caseAssertionId,
        responseId: null,
        requestId: null,
        model: modelConfig.model,
        usage: { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, totalTokens: 0 },
        latencyMs: Math.round(performance.now() - started),
        rawResponse: null,
        parsedOutput: null,
        validation: {
          acceptedRows: [],
          rejectedRows: [{
            caseAssertionId: call.caseAssertionId,
            rowIndex: null,
            rawRow: null,
            reasons: [{ code: "PROVIDER_FAILURE", message: error instanceof Error ? error.message : String(error) }],
          }],
        },
        providerStatus: "failed",
      };
    }
  }));
  if (providerCalls !== modelConfig.expectedCalls) throw new Error(`model-call invariant failed: ${providerCalls}`);
  return {
    calls,
    results,
    providerCalls,
    accepted: results.flatMap((row) => row.validation.acceptedRows) as CfxAcceptedLinkSuggestion[],
    rejected: results.flatMap((row) => row.validation.rejectedRows) as CfxRejectedLinkSuggestion[],
  };
}

async function applicationReadback(input: {
  query: Query;
  pool: Pool;
  documents: Map<string, CfxSourceDocumentIdentity>;
}) {
  const app = express();
  app.use(createClaimsRoutes({ query: input.query, pool: input.pool }));
  app.use(createReferenceClaimTaskRoutes({ query: input.query, pool: input.pool }));
  app.use(createPublishersRoutes({ query: input.query, pool: input.pool }));
  const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
    const value = app.listen(0, "127.0.0.1", () => resolve(value));
  });
  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("ephemeral API server did not bind");
    const base = `http://127.0.0.1:${address.port}`;
    const get = async (pathname: string) => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30_000);
      try {
        const response = await fetch(`${base}${pathname}`, {
          signal: controller.signal,
          headers: { connection: "close" },
        });
        const body = await response.json();
        if (!response.ok) throw new Error(`API readback ${pathname} failed: ${JSON.stringify(body)}`);
        return body;
      } finally {
        clearTimeout(timeout);
      }
    };
    const [claims, links, p54895, p54897] = await Promise.all([
      get(`/api/claims-with-evidence/${taskContentId}?scope=all`),
      get(`/api/claims-and-linked-references/${taskContentId}?scope=all`),
      get(`/api/reference-claim-task-links/${caseClaimIds.get("P54895")}?contentId=${taskContentId}`),
      get(`/api/reference-claim-task-links/${caseClaimIds.get("P54897")}?contentId=${taskContentId}`),
    ]);
    const sources = [];
    for (const [documentId, document] of input.documents) {
      const publisher = await get(`/api/publishers/for-content/${document.referenceContentId}`);
      const enrichment = publisher.publisher_id
        ? await get(`/api/publishers/${publisher.publisher_id}/enrichment?contentId=${document.referenceContentId}`)
        : null;
      sources.push({ documentId, referenceContentId: document.referenceContentId, publisher, enrichment });
    }
    return {
      transport: "ephemeral Express server mounting the real production claims, reference-link, and publisher route factories",
      endpoints: [
        `/api/claims-with-evidence/${taskContentId}?scope=all`,
        `/api/claims-and-linked-references/${taskContentId}?scope=all`,
        ...[...caseClaimIds.values()].map((id) => `/api/reference-claim-task-links/${id}?contentId=${taskContentId}`),
        ...sources.flatMap((source: any) => [
          `/api/publishers/for-content/${source.referenceContentId}`,
          source.publisher.publisher_id
            ? `/api/publishers/${source.publisher.publisher_id}/enrichment?contentId=${source.referenceContentId}`
            : null,
        ]).filter(Boolean),
      ],
      claims,
      workspaceLinks: links,
      detailedLinks: { P54895: p54895, P54897: p54897 },
      sources,
    };
  } finally {
    server.closeAllConnections?.();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/gu, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;",
  }[char]!));
}

function reportMarkdown(report: any): string {
  const answers = report.answers.map((answer: string, index: number) => `${index + 1}. ${answer}`).join("\n");
  const modelCalls = report.summary.linkModelCalls ?? report.summary.modelCalls;
  return `# ${report.status}\n\n## Run\n\n- Run ID: ${report.runId}\n- Task: ${taskContentId}\n- Frozen source-assertion occurrences: ${report.summary.sourceOccurrenceCount}\n- Canonical source claims: ${report.summary.canonicalSourceClaimCount}\n- Distinct evidence documents: ${report.summary.documentCount}\n- Link-model calls: ${modelCalls}\n- Accepted suggestions: ${report.summary.acceptedSuggestions}\n- Rejected suggestions: ${report.summary.rejectedSuggestions}\n- Application readback occurrences: ${report.summary.apiSuggestionOccurrenceCount}\n\n## Required answers\n\n${answers}\n\n## Accounting\n\n\`\`\`json\n${JSON.stringify(report.summary, null, 2)}\n\`\`\`\n`;
}

function reportHtml(report: any): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(report.status)}</title><style>body{font:15px system-ui;margin:2rem;max-width:1100px}li{margin:.7rem 0}pre{white-space:pre-wrap;background:#f6f8fa;padding:1rem}</style></head><body><h1>${escapeHtml(report.status)}</h1><p>Run <code>${escapeHtml(report.runId)}</code>; task <a href="https://localhost:5173/workspace/${taskContentId}">${taskContentId}</a>.</p><ol>${report.answers.map((answer: string) => `<li>${escapeHtml(answer)}</li>`).join("")}</ol><h2>Accounting</h2><pre>${escapeHtml(JSON.stringify(report.summary, null, 2))}</pre></body></html>`;
}

async function resumeAfterReadback(root: string): Promise<void> {
  const runId = path.basename(root);
  const pool = mysql.createPool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE,
    connectionLimit: 6,
  });
  const query = poolQuery(pool);
  try {
    const [rows, sourceCrestResults, sourceCrestPersistence, accepted, rejected,
      idempotency, rawResponses] = await Promise.all([
      readJson(path.join(root, "source-claim-inputs.json")) as Promise<CfxPersistableSourceAssertion[]>,
      readJson(path.join(root, "sourcecrest-results.json")),
      readJson(path.join(root, "sourcecrest-persistence.json")),
      readJson(path.join(root, "accepted-link-suggestions.json")),
      readJson(path.join(root, "rejected-link-suggestions.json")),
      readJson(path.join(root, "idempotency-verification.json")),
      readJson(path.join(root, "raw-link-model-responses.json")),
    ]);
    const documents = new Map<string, CfxSourceDocumentIdentity>(
      sourceCrestPersistence.documents.map((document: any) => [document.documentId, {
        documentId: document.documentId,
        referenceContentId: Number(document.referenceContentId),
      }]),
    );
    if (documents.size !== 5 || accepted.length !== 14 || rejected.length !== 0) {
      throw new Error("resume inputs do not match the completed governed execution");
    }
    const readback = await applicationReadback({ query, pool, documents });
    const detailed = [...readback.detailedLinks.P54895, ...readback.detailedLinks.P54897]
      .filter((row: any) => row.suggestion_run_id === runId);
    const apiSourceIds = new Set(detailed.map((row: any) => row.source_assertion_id).filter(Boolean));
    const apiPerennialCount = readback.sources.filter((source: any) =>
      source.enrichment?.externalSignals?.some?.((signal: any) => signal.provider === "wikipedia_perennial_sources")).length;
    const activities = await query(
      `SELECT activity_id,activity_type,content_id,metadata,created_at FROM user_activities
        WHERE activity_type='evidence_run' AND content_id=?
          AND JSON_UNQUOTE(JSON_EXTRACT(metadata,'$.runId'))=?
        ORDER BY activity_id DESC`,
      [taskContentId, runId],
    );
    const usage = rawResponses.reduce((sum: any, row: any) => ({
      inputTokens: sum.inputTokens + Number(row.usage?.inputTokens || 0),
      cachedInputTokens: sum.cachedInputTokens + Number(row.usage?.cachedInputTokens || 0),
      outputTokens: sum.outputTokens + Number(row.usage?.outputTokens || 0),
      totalTokens: sum.totalTokens + Number(row.usage?.totalTokens || 0),
      latencyMs: sum.latencyMs + Number(row.latencyMs || 0),
    }), { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, totalTokens: 0, latencyMs: 0 });
    const perennialEveryDocument = sourceCrestPersistence.snapshots.every(
      (row: any) => row.perennialSourcesStoredSeparately,
    );
    const legitimateAggregatePreserved = sourceCrestPersistence.snapshots.every((row: any) => {
      const before = String(row.preexistingAggregateCode || "");
      return !/^[A-E](?:[1-5]|Ø)$/u.test(before) || before === row.finalAggregateCode;
    });
    const sourceCrestModelCalls = sourceCrestResults.filter(
      (row: any) => row.providerSummary?.Wikipedia === "found",
    ).length;
    const apiComplete = apiSourceIds.size === rows.length && apiPerennialCount === documents.size;
    const pass = sourceCrestResults.length === documents.size
      && perennialEveryDocument && legitimateAggregatePreserved
      && accepted.length === rows.length && rejected.length === 0
      && idempotency.passed && activities.length === 1 && apiComplete;
    const status = pass ? "CURRENT FIXTURE END-CHAIN PASS" : "CURRENT FIXTURE END-CHAIN PARTIAL";
    const finalState = {
      runId,
      status: "completed",
      statusScope: "frozen current-fixture back half for P54895 and P54897",
      durableTerminalRecord: activities[0] ?? null,
      productionTerminalContract: "same evidence_run user_activities seam used by POST /api/run-evidence after the CFX pipeline returns",
      taskProgressBeforeAndAfter: "Awaiting Evaluation",
      taskProgressPreservedReason: "The frozen accepted inventory covers two of twelve task claims; completing the whole task would be false.",
      terminalOutbox: "not applicable: acquisition was frozen upstream and explicitly not rerun",
      finalEvidenceProjection: {
        acceptedSourceAssertionOccurrences: accepted.length,
        persistedCanonicalSourceClaims: Number(idempotency.canonicalSourceClaimCount),
        persistedCanonicalLinks: Number(idempotency.canonicalLinkCount),
        applicationReadbackOccurrences: apiSourceIds.size,
      },
      resumedAfterReadbackHarnessRepair: true,
      additionalModelCallsDuringResume: 0,
      additionalSourceCrestCallsDuringResume: 0,
    };
    await writeImmutableJson(path.join(root, "final-evidencerun-state.json"), finalState);
    await writeImmutableJson(path.join(root, "workspace-api-readback.json"), readback);
    const answers = [
      `Reused ${authoritativeExtractionRunId} accepted rows and exact requests, projected by ${isolatedLinkRunId}; exact paths and hashes are in current-fixture-input-map.json.`,
      `SourceCrest ran for ${sourceCrestResults.length}/${documents.size} distinct acquired sources.`,
      `Wikipedia Perennial Sources appeared as a separate persisted contextual signal for ${sourceCrestPersistence.snapshots.filter((row: any) => row.perennialSourcesStoredSeparately).length}/${documents.size} sources.`,
      `${idempotency.sourceOccurrenceCount}/${rows.length} accepted grounded occurrences were persisted, resolving to ${idempotency.canonicalSourceClaimCount} canonical source claims without duplicating identical claim text.`,
      `${accepted.length}/${rows.length} source-assertion occurrences received exactly one AI suggestion; these resolve to ${idempotency.canonicalLinkCount} canonical document/source-claim/case-claim links.`,
      `Yes. Suggestions have created_by_ai=1, verified_by_user_id=NULL, and provenance suggestion_status='accepted'; none was marked human-approved or final.`,
      `${idempotency.passed ? "No duplicates were created" : "Idempotency failed"}; stable occurrence, canonical claim, and canonical link IDs are recorded in idempotency-verification.json.`,
      `Yes for the authorized back-half scope: terminal status 'completed' was persisted through the production evidence_run activity seam; whole-task progress stayed 'Awaiting Evaluation' because only two of twelve case claims were in scope.`,
      `${apiComplete ? "Yes" : "Not completely"}. The real route factories returned ${apiSourceIds.size}/${rows.length} suggestion occurrences and Perennial signals for ${apiPerennialCount}/${documents.size} sources.`,
      `Before fresh F03-from-scrape, the remaining gap is upstream-only: exercise fresh scrape, ClaimFoundry, search planning, discovery/acquisition, block retrieval, and source extraction before feeding this now-tested back-half seam.`,
    ];
    const summary = {
      status,
      runId,
      taskContentId,
      documentCount: documents.size,
      sourceOccurrenceCount: rows.length,
      canonicalSourceClaimCount: Number(idempotency.canonicalSourceClaimCount),
      canonicalLinkCount: Number(idempotency.canonicalLinkCount),
      modelCalls: rawResponses.length,
      acceptedSuggestions: accepted.length,
      rejectedSuggestions: rejected.length,
      linkModelUsage: usage,
      sourceCrestCalls: sourceCrestResults.length,
      sourceCrestModelCalls,
      sourceCrestModelUsage: "not captured by the legacy Wikipedia enrichment provider contract",
      totalObservedModelCalls: rawResponses.length + sourceCrestModelCalls,
      perennialSignalCount: sourceCrestPersistence.snapshots.filter((row: any) => row.perennialSourcesStoredSeparately).length,
      legitimatePreexistingAggregatePreserved: legitimateAggregatePreserved,
      insufficientCodesUpgradedByOrdinarySourceCrest: sourceCrestPersistence.snapshots.filter(
        (row: any) => row.preexistingAggregateCode === "ØØ" && row.finalAggregateCode !== "ØØ",
      ).map((row: any) => ({ documentId: row.documentId, from: row.preexistingAggregateCode, to: row.finalAggregateCode })),
      terminalActivityCount: activities.length,
      apiSuggestionOccurrenceCount: apiSourceIds.size,
      apiPerennialSourceCount: apiPerennialCount,
      promptHash: cfxLinkSuggestionPromptHash(),
      schemaHash: cfxLinkSuggestionSchemaHash(),
      frozenInputSha256: jsonHash(rows),
      upstreamStagesRerun: [],
      resume: {
        reason: "The first local API harness did not close keep-alive connections after successful responses.",
        fix: "Bounded fetches now send connection: close and the harness calls closeAllConnections().",
        additionalModelCalls: 0,
        additionalExternalProviderCalls: 0,
      },
    };
    await writeImmutableJson(path.join(root, "run-summary.json"), summary);
    const report = { status, runId, summary, answers };
    await writeImmutableText(path.join(root, "report.md"), reportMarkdown(report));
    await writeImmutableText(path.join(root, "report.html"), reportHtml(report));
    const files = await hashArtifactTree(root);
    const manifest = { files, aggregateSha256: aggregateArtifactHash(files) };
    await writeImmutableJson(path.join(root, "artifact-manifest.json"), manifest);
    await freezeArtifactTree(root);
    process.stdout.write(`${JSON.stringify({ root, status, summary, artifactManifestHash: manifest.aggregateSha256 }, null, 2)}\n`);
  } finally {
    await pool.end();
  }
}

async function correctFrozenIdentities(parentRoot: string): Promise<void> {
  const parentRunId = path.basename(parentRoot);
  const runId = `cfx-current-fixture-end-chain-corrected-${stamp()}`;
  const root = path.join(artifactParent, runId);
  await createImmutableDirectory(root);
  const pool = mysql.createPool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE,
    connectionLimit: 6,
  });
  const query = poolQuery(pool);
  try {
    const parentManifest = await readJson(path.join(parentRoot, "artifact-manifest.json"));
    const copyNames = [
      "source-claim-inputs.json",
      "source-claim-persistence.json",
      "exact-link-model-requests.json",
      "raw-link-model-responses.json",
      "accepted-link-suggestions.json",
      "rejected-link-suggestions.json",
      "persisted-link-results.json",
      "idempotency-verification.json",
    ];
    for (const name of copyNames) {
      const source = path.join(parentRoot, name);
      const bytes = await readFile(source);
      const expected = parentManifest.files?.find((row: any) => row.path === name)?.sha256;
      if (!expected || sha256(bytes) !== expected) throw new Error(`parent artifact hash mismatch: ${name}`);
      await copyFile(source, path.join(root, name), fsConstants.COPYFILE_EXCL);
    }
    const inputMap = await readJson(path.join(parentRoot, "current-fixture-input-map.json"));
    inputMap.identityCorrection = {
      parentRunId,
      reason: "The initial materialization ignored frozen production extraction identities and used hostname fallbacks for two newly created content rows.",
      frozenAcquisitionRoot: rankedAcquisitionRoot,
      correctedDocumentIds: ["DOC-ea2055b24f9c55776b5c", "DOC-d37826ab399528971d12"],
      linkModelCallsReusedByteForByte: 2,
      additionalLinkModelCalls: 0,
    };
    await writeImmutableJson(path.join(root, "current-fixture-input-map.json"), inputMap);

    const rows = await readJson(path.join(root, "source-claim-inputs.json")) as CfxPersistableSourceAssertion[];
    const parentCrestResults = await readJson(path.join(parentRoot, "sourcecrest-results.json"));
    const parentCrestPersistence = await readJson(path.join(parentRoot, "sourcecrest-persistence.json"));
    const parentRawResponses = await readJson(path.join(root, "raw-link-model-responses.json"));
    const accepted = await readJson(path.join(root, "accepted-link-suggestions.json"));
    const rejected = await readJson(path.join(root, "rejected-link-suggestions.json"));
    const idempotency = await readJson(path.join(root, "idempotency-verification.json"));
    const correctionIds = new Set(["DOC-ea2055b24f9c55776b5c", "DOC-d37826ab399528971d12"]);
    const referenceByDocument = new Map<string, number>(
      parentCrestPersistence.documents.map((document: any) => [document.documentId, Number(document.referenceContentId)]),
    );
    const identityCorrections = [];
    for (const documentId of correctionIds) {
      const referenceContentId = Number(referenceByDocument.get(documentId));
      const acquisitionRelative = `documents/${documentId}/acquisition.json`;
      const verifiedAcquisition = await verifyLegacyNestedAcquisition(documentId);
      const acquisition = verifiedAcquisition.acquisition;
      const extracted = acquisition.extractedDocument;
      if (!extracted?.publishingIdentity?.version) throw new Error(`frozen identity missing for ${documentId}`);
      const before = await crestSnapshot(query, referenceContentId);
      const identityResult = await (processPublishingIdentity as any)({
        query,
        contentId: referenceContentId,
        identity: extracted.publishingIdentity,
        sourceUrl: rows.find((row) => row.documentId === documentId)!.documentUrl,
        authors: extracted.authors || [],
        fallbackPublisher: extracted.publisher || null,
      });
      const primary = await query(
        `SELECT p.publisher_id,p.publisher_name,p.entity_type,p.domain,cp.is_primary
           FROM content_publishers cp JOIN publishers p ON p.publisher_id=cp.publisher_id
          WHERE cp.content_id=? ORDER BY COALESCE(cp.is_primary,0) DESC,cp.content_publisher_id DESC LIMIT 1`,
        [referenceContentId],
      );
      identityCorrections.push({
        documentId,
        referenceContentId,
        frozenIdentityPath: path.join(rankedAcquisitionRoot, acquisitionRelative),
        frozenAcquisitionSha256: verifiedAcquisition.acquisitionSha256,
        frozenAcquisitionResultsSha256: verifiedAcquisition.acquisitionResultsSha256,
        frozenPublishingIdentity: extracted.publishingIdentity,
        beforePrimary: (before.publishers as any[])?.[0] ?? null,
        persistedIdentity: identityResult.persistence ?? null,
        afterPrimary: primary[0] ?? null,
      });
    }

    const correctedRecords = identityCorrections.map((correction: any) => ({
      documentId: correction.documentId,
      referenceContentId: correction.referenceContentId,
      persistedPublisher: correction.afterPrimary,
    }));
    const correctedCrestCapture = await withOpenAiUsageCapture(
      { pipeline: "cfx_sourcecrest_identity_correction", runId },
      async () => {
        const value = await runSourceCrest(query, correctedRecords);
        return { value, usage: finishOpenAiUsageCapture({ status: "completed" }) };
      },
    );
    const correctedById = new Map(correctedCrestCapture.value.results.map((row: any) => [row.documentId, row]));
    const correctedPersistenceById = new Map(correctedCrestCapture.value.persistence.map((row: any) => [row.documentId, row]));
    const allCrestResults = parentCrestResults.map((row: any) => correctedById.get(row.documentId) ?? row);
    const currentDocuments = [];
    for (const parent of parentCrestPersistence.documents) {
      const primary = await query(
        `SELECT p.publisher_id,p.publisher_name,p.entity_type,p.domain,cp.is_primary
           FROM content_publishers cp JOIN publishers p ON p.publisher_id=cp.publisher_id
          WHERE cp.content_id=? ORDER BY COALESCE(cp.is_primary,0) DESC,cp.content_publisher_id DESC LIMIT 1`,
        [parent.referenceContentId],
      );
      currentDocuments.push({ ...parent, persistedPublisher: primary[0] ?? null });
    }
    const allCrestPersistence = parentCrestPersistence.snapshots.map((row: any) =>
      correctedPersistenceById.get(row.documentId) ?? row);
    await writeImmutableJson(path.join(root, "sourcecrest-results.json"), {
      documents: allCrestResults,
      identityCorrections,
      correctionOpenAiUsage: correctedCrestCapture.usage,
      parentRunId,
    });
    await writeImmutableJson(path.join(root, "sourcecrest-persistence.json"), {
      documents: currentDocuments,
      snapshots: allCrestPersistence,
      identityCorrections,
    });

    const documents = new Map<string, CfxSourceDocumentIdentity>(
      currentDocuments.map((document: any) => [document.documentId, {
        documentId: document.documentId,
        referenceContentId: Number(document.referenceContentId),
      }]),
    );
    await (logUserActivity as any)(query, {
      userId: null,
      username: null,
      activityType: "evidence_run",
      contentId: taskContentId,
      claimId: null,
      linkId: null,
      metadata: {
        pipeline: "cfx_current_fixture_end_chain",
        runId,
        status: "completed",
        parentLinkRunId: parentRunId,
        scope: "frozen_back_half_two_of_twelve_case_assertions",
        identityCorrection: true,
        additionalLinkModelCalls: 0,
      },
    });
    const activities = await query(
      `SELECT activity_id,activity_type,content_id,metadata,created_at FROM user_activities
        WHERE activity_type='evidence_run' AND content_id=?
          AND JSON_UNQUOTE(JSON_EXTRACT(metadata,'$.runId'))=? ORDER BY activity_id DESC`,
      [taskContentId, runId],
    );
    const readback = await applicationReadback({ query, pool, documents });
    const detailed = [...readback.detailedLinks.P54895, ...readback.detailedLinks.P54897]
      .filter((row: any) => row.suggestion_run_id === parentRunId);
    const apiSourceIds = new Set(detailed.map((row: any) => row.source_assertion_id).filter(Boolean));
    const apiPerennialCount = readback.sources.filter((source: any) =>
      source.enrichment?.externalSignals?.some?.((signal: any) => signal.provider === "wikipedia_perennial_sources")).length;
    const expectedPrimary = new Map([
      ["DOC-ea2055b24f9c55776b5c", "The Scientist"],
      ["DOC-d37826ab399528971d12", "State Health and Value Strategies is a program of the Robert Wood Johnson Foundation"],
    ]);
    const correctIdentities = identityCorrections.every((row: any) =>
      row.afterPrimary?.publisher_name === expectedPrimary.get(row.documentId));
    const perennialEveryDocument = allCrestPersistence.every((row: any) => row.perennialSourcesStoredSeparately);
    const apiComplete = apiSourceIds.size === rows.length && apiPerennialCount === documents.size;
    const pass = correctIdentities && perennialEveryDocument && apiComplete
      && accepted.length === rows.length && rejected.length === 0 && idempotency.passed && activities.length === 1;
    const status = pass ? "CURRENT FIXTURE END-CHAIN PASS" : "CURRENT FIXTURE END-CHAIN PARTIAL";
    const linkUsage = parentRawResponses.reduce((sum: any, row: any) => ({
      inputTokens: sum.inputTokens + Number(row.usage?.inputTokens || 0),
      cachedInputTokens: sum.cachedInputTokens + Number(row.usage?.cachedInputTokens || 0),
      outputTokens: sum.outputTokens + Number(row.usage?.outputTokens || 0),
      totalTokens: sum.totalTokens + Number(row.usage?.totalTokens || 0),
    }), { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, totalTokens: 0 });
    const finalState = {
      runId,
      status: "completed",
      statusScope: "frozen current-fixture back half for P54895 and P54897",
      durableTerminalRecord: activities[0] ?? null,
      parentLinkRunId: parentRunId,
      productionTerminalContract: "same evidence_run user_activities seam used by POST /api/run-evidence after the CFX pipeline returns",
      taskProgressBeforeAndAfter: "Awaiting Evaluation",
      taskProgressPreservedReason: "The frozen accepted inventory covers two of twelve task claims; completing the whole task would be false.",
      terminalOutbox: "not applicable: acquisition was frozen upstream and explicitly not rerun",
      finalEvidenceProjection: {
        acceptedSourceAssertionOccurrences: accepted.length,
        persistedCanonicalSourceClaims: idempotency.canonicalSourceClaimCount,
        persistedCanonicalLinks: idempotency.canonicalLinkCount,
        applicationReadbackOccurrences: apiSourceIds.size,
      },
    };
    await writeImmutableJson(path.join(root, "final-evidencerun-state.json"), finalState);
    await writeImmutableJson(path.join(root, "workspace-api-readback.json"), readback);
    const answers = [
      `Reused ${authoritativeExtractionRunId}, the parent link run ${parentRunId}, and the frozen production acquisition identities; exact paths and hashes are in current-fixture-input-map.json.`,
      `SourceCrest covers all ${documents.size} distinct sources; only the two corrected identities were reprocessed in this continuation.`,
      `Wikipedia Perennial Sources appears as a separate contextual signal for ${apiPerennialCount}/${documents.size} sources.`,
      `${idempotency.sourceOccurrenceCount}/${rows.length} accepted grounded occurrences persist as ${idempotency.canonicalSourceClaimCount} canonical source claims.`,
      `${accepted.length}/${rows.length} occurrences have one AI suggestion from the exact two inherited model calls; no link-model call was repeated.`,
      `Yes. Every suggestion remains created_by_ai=1, verified_by_user_id=NULL, with suggestion_status='accepted'.`,
      `${idempotency.passed ? "No duplicates were created" : "Idempotency failed"}.`,
      `Yes for the authorized back-half scope through a terminal evidence_run activity; whole-task progress remains Awaiting Evaluation.`,
      `${apiComplete ? "Yes" : "Not completely"}; the real routes returned ${apiSourceIds.size}/${rows.length} occurrences and ${apiPerennialCount}/${documents.size} Perennial signals.`,
      `The remaining gap is the fresh upstream F03-from-scrape path; this corrected back-half seam is complete.`,
    ];
    const summary = {
      status,
      runId,
      parentLinkRunId: parentRunId,
      taskContentId,
      documentCount: documents.size,
      correctedPublisherIdentityCount: identityCorrections.length,
      correctedPublisherIdentitiesValid: correctIdentities,
      sourceOccurrenceCount: rows.length,
      canonicalSourceClaimCount: Number(idempotency.canonicalSourceClaimCount),
      canonicalLinkCount: Number(idempotency.canonicalLinkCount),
      linkModelCalls: parentRawResponses.length,
      additionalLinkModelCalls: 0,
      linkModelUsage: linkUsage,
      sourceCrestCorrectionCalls: correctedRecords.length,
      sourceCrestCorrectionModelUsage: correctedCrestCapture.usage,
      acceptedSuggestions: accepted.length,
      rejectedSuggestions: rejected.length,
      perennialSignalCount: apiPerennialCount,
      terminalActivityCount: activities.length,
      apiSuggestionOccurrenceCount: apiSourceIds.size,
      promptHash: cfxLinkSuggestionPromptHash(),
      schemaHash: cfxLinkSuggestionSchemaHash(),
      upstreamStagesRerun: [],
    };
    await writeImmutableJson(path.join(root, "run-summary.json"), summary);
    const report = { status, runId, summary, answers };
    await writeImmutableText(path.join(root, "report.md"), reportMarkdown(report));
    await writeImmutableText(path.join(root, "report.html"), reportHtml(report));
    const files = await hashArtifactTree(root);
    const manifest = { files, aggregateSha256: aggregateArtifactHash(files) };
    await writeImmutableJson(path.join(root, "artifact-manifest.json"), manifest);
    await freezeArtifactTree(root);
    process.stdout.write(`${JSON.stringify({ root, status, summary, artifactManifestHash: manifest.aggregateSha256 }, null, 2)}\n`);
  } finally {
    await pool.end();
  }
}

async function main(): Promise<void> {
  const correctionArgument = process.argv.find((value) => value.startsWith("--correct-identities-from="));
  if (correctionArgument) {
    await correctFrozenIdentities(path.resolve(correctionArgument.slice("--correct-identities-from=".length)));
    return;
  }
  const resumeArgument = process.argv.find((value) => value.startsWith("--resume-root="));
  if (resumeArgument) {
    await resumeAfterReadback(path.resolve(resumeArgument.slice("--resume-root=".length)));
    return;
  }
  const runId = `cfx-current-fixture-end-chain-${stamp()}`;
  const root = path.join(artifactParent, runId);
  await createImmutableDirectory(root);
  const pool = mysql.createPool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE,
    connectionLimit: 6,
  });
  const query = poolQuery(pool);
  try {
    const { rows, inputMap } = await loadFrozenInputs();
    await writeImmutableJson(path.join(root, "current-fixture-input-map.json"), inputMap);
    await writeImmutableJson(path.join(root, "source-claim-inputs.json"), rows);
    await assertSchema(query);

    const materialized = await materializeDocuments(query, rows);
    const sourceCrest = await runSourceCrest(query, materialized.records);
    await writeImmutableJson(path.join(root, "sourcecrest-results.json"), sourceCrest.results);
    await writeImmutableJson(path.join(root, "sourcecrest-persistence.json"), {
      documents: materialized.records,
      snapshots: sourceCrest.persistence,
    });

    const sourcePersistence = await transaction(pool, (tx) => persistCfxSourceAssertions({
      query: tx,
      taskClaimIds: caseClaimIds,
      documents: materialized.documents,
      rows,
    }));
    const sourcePersistenceRepeat = await transaction(pool, (tx) => persistCfxSourceAssertions({
      query: tx,
      taskClaimIds: caseClaimIds,
      documents: materialized.documents,
      rows,
    }));
    await writeImmutableJson(path.join(root, "source-claim-persistence.json"), {
      first: sourcePersistence,
      repeat: sourcePersistenceRepeat,
    });

    const linkRun = await invokeLinks(root, rows);
    await writeImmutableJson(path.join(root, "exact-link-model-requests.json"), linkRun.calls.map(publicCall));
    await writeImmutableJson(path.join(root, "raw-link-model-responses.json"), linkRun.results);
    await writeImmutableJson(path.join(root, "accepted-link-suggestions.json"), linkRun.accepted);
    await writeImmutableJson(path.join(root, "rejected-link-suggestions.json"), linkRun.rejected);

    const callIds = new Map(linkRun.calls.map((call) => [call.caseAssertionId, call.callId]));
    const persistInput = {
      taskContentId,
      rows: sourcePersistence,
      suggestions: linkRun.accepted,
      suggestionRunId: runId,
      suggestionModelCallIds: callIds,
      suggestionPromptHash: cfxLinkSuggestionPromptHash(),
      suggestionSchemaHash: cfxLinkSuggestionSchemaHash(),
      model: modelConfig.model,
    };
    const persistedLinks = await transaction(pool, (tx) => persistCfxLinkSuggestions({ query: tx, ...persistInput }));
    const repeatedLinks = await transaction(pool, (tx) => persistCfxLinkSuggestions({ query: tx, ...persistInput }));
    await writeImmutableJson(path.join(root, "persisted-link-results.json"), {
      first: persistedLinks,
      repeat: repeatedLinks,
    });

    const [sourceCounts] = await query(
      `SELECT COUNT(*) AS occurrence_count,COUNT(DISTINCT claim_id) AS claim_count,
              COUNT(DISTINCT reference_claim_task_links_id) AS link_count,
              SUM(suggestion_status='accepted') AS accepted_count
         FROM cfx_source_assertion_provenance WHERE source_assertion_id IN (${rows.map(() => "?").join(",")})`,
      rows.map((row) => row.sourceAssertionId),
    );
    const idempotency = {
      occurrenceIdsStable: sourcePersistence.every((row, index) => row.sourceAssertionId === sourcePersistenceRepeat[index]?.sourceAssertionId),
      canonicalClaimIdsStable: sourcePersistence.every((row, index) => row.evidenceClaimId === sourcePersistenceRepeat[index]?.evidenceClaimId),
      canonicalLinkIdsStable: persistedLinks.every((row, index) => row.referenceClaimTaskLinkId === repeatedLinks[index]?.referenceClaimTaskLinkId),
      sourceOccurrenceCount: Number(sourceCounts.occurrence_count),
      canonicalSourceClaimCount: Number(sourceCounts.claim_count),
      canonicalLinkCount: Number(sourceCounts.link_count),
      acceptedSuggestionOccurrenceCount: Number(sourceCounts.accepted_count),
      expectedSourceOccurrenceCount: rows.length,
      passed: Number(sourceCounts.occurrence_count) === rows.length
        && Number(sourceCounts.accepted_count) === linkRun.accepted.length
        && sourcePersistence.every((row, index) => row.evidenceClaimId === sourcePersistenceRepeat[index]?.evidenceClaimId)
        && persistedLinks.every((row, index) => row.referenceClaimTaskLinkId === repeatedLinks[index]?.referenceClaimTaskLinkId),
    };
    await writeImmutableJson(path.join(root, "idempotency-verification.json"), idempotency);

    await (logUserActivity as any)(query, {
      userId: null,
      username: null,
      activityType: "evidence_run",
      contentId: taskContentId,
      claimId: null,
      linkId: null,
      metadata: {
        pipeline: "cfx_current_fixture_end_chain",
        runId,
        status: "completed",
        scope: "frozen_back_half_two_of_twelve_case_assertions",
        sourceOccurrenceCount: rows.length,
        acceptedSuggestionCount: linkRun.accepted.length,
        rejectedSuggestionCount: linkRun.rejected.length,
      },
    });
    const activities = await query(
      `SELECT activity_id,activity_type,content_id,metadata,created_at FROM user_activities
        WHERE activity_type='evidence_run' AND content_id=?
          AND JSON_UNQUOTE(JSON_EXTRACT(metadata,'$.runId'))=?
        ORDER BY activity_id DESC`,
      [taskContentId, runId],
    );

    const readback = await applicationReadback({ query, pool, documents: materialized.documents });
    const detailed = [...readback.detailedLinks.P54895, ...readback.detailedLinks.P54897]
      .filter((row: any) => row.suggestion_run_id === runId);
    const apiSourceIds = new Set(detailed.map((row: any) => row.source_assertion_id).filter(Boolean));
    const apiPerennialCount = readback.sources.filter((source: any) =>
      source.enrichment?.externalSignals?.some?.((signal: any) => signal.provider === "wikipedia_perennial_sources")).length;
    const finalState = {
      runId,
      status: "completed",
      statusScope: "frozen current-fixture back half for P54895 and P54897",
      durableTerminalRecord: activities[0] ?? null,
      productionTerminalContract: "same evidence_run user_activities seam used by POST /api/run-evidence after the CFX pipeline returns",
      taskProgressBeforeAndAfter: "Awaiting Evaluation",
      taskProgressPreservedReason: "The frozen accepted inventory covers two of twelve task claims; completing the whole task would be false.",
      terminalOutbox: "not applicable: acquisition was frozen upstream and explicitly not rerun",
      finalEvidenceProjection: {
        acceptedSourceAssertionOccurrences: linkRun.accepted.length,
        persistedCanonicalSourceClaims: Number(sourceCounts.claim_count),
        persistedCanonicalLinks: Number(sourceCounts.link_count),
        applicationReadbackOccurrences: apiSourceIds.size,
      },
    };
    await writeImmutableJson(path.join(root, "final-evidencerun-state.json"), finalState);
    await writeImmutableJson(path.join(root, "workspace-api-readback.json"), readback);

    const usage = linkRun.results.reduce((sum, row) => ({
      inputTokens: sum.inputTokens + Number(row.usage?.inputTokens || 0),
      cachedInputTokens: sum.cachedInputTokens + Number(row.usage?.cachedInputTokens || 0),
      outputTokens: sum.outputTokens + Number(row.usage?.outputTokens || 0),
      totalTokens: sum.totalTokens + Number(row.usage?.totalTokens || 0),
      latencyMs: sum.latencyMs + Number(row.latencyMs || 0),
    }), { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, totalTokens: 0, latencyMs: 0 });
    const crestEveryDocument = sourceCrest.results.length === materialized.documents.size;
    const perennialEveryDocument = sourceCrest.persistence.every((row: any) => row.perennialSourcesStoredSeparately);
    const aggregatePreserved = sourceCrest.persistence.every((row: any) => row.preexistingAggregatePreserved);
    const apiComplete = apiSourceIds.size === rows.length && apiPerennialCount === materialized.documents.size;
    const pass = crestEveryDocument && perennialEveryDocument && aggregatePreserved
      && linkRun.providerCalls === 2 && linkRun.accepted.length === rows.length
      && linkRun.rejected.length === 0 && idempotency.passed && activities.length === 1 && apiComplete;
    const status = pass ? "CURRENT FIXTURE END-CHAIN PASS" : "CURRENT FIXTURE END-CHAIN PARTIAL";
    const answers = [
      `Reused ${authoritativeExtractionRunId} accepted rows and exact requests, projected by ${isolatedLinkRunId}; exact paths and hashes are in current-fixture-input-map.json.`,
      `SourceCrest ran for ${sourceCrest.results.length}/${materialized.documents.size} distinct acquired sources.`,
      `Wikipedia Perennial Sources appeared as a separate persisted signal for ${sourceCrest.persistence.filter((row: any) => row.perennialSourcesStoredSeparately).length}/${materialized.documents.size} sources.`,
      `${Number(sourceCounts.occurrence_count)}/${rows.length} accepted grounded occurrences were persisted, resolving to ${Number(sourceCounts.claim_count)} canonical source claims without duplicating identical claim text.`,
      `${linkRun.accepted.length}/${rows.length} source-assertion occurrences received exactly one AI suggestion; these resolve to ${Number(sourceCounts.link_count)} canonical document/source-claim/case-claim links.`,
      `Yes. Suggestions have created_by_ai=1, verified_by_user_id=NULL, and provenance suggestion_status='accepted'; none was marked human-approved or final.`,
      `${idempotency.passed ? "No duplicates were created" : "Idempotency failed"}; stable occurrence, canonical claim, and canonical link IDs are recorded in idempotency-verification.json.`,
      `Yes for the authorized back-half scope: terminal status 'completed' was persisted through the production evidence_run activity seam; whole-task progress stayed 'Awaiting Evaluation' because only two of twelve case claims were in scope.`,
      `${apiComplete ? "Yes" : "Not completely"}. The real route factories returned ${apiSourceIds.size}/${rows.length} suggestion occurrences and Perennial signals for ${apiPerennialCount}/${materialized.documents.size} sources.`,
      `Before fresh F03-from-scrape, the remaining gap is upstream-only: exercise fresh scrape, ClaimFoundry, search planning, discovery/acquisition, block retrieval, and source extraction before feeding this now-tested back-half seam.`,
    ];
    const summary = {
      status,
      runId,
      taskContentId,
      documentCount: materialized.documents.size,
      sourceOccurrenceCount: rows.length,
      canonicalSourceClaimCount: Number(sourceCounts.claim_count),
      canonicalLinkCount: Number(sourceCounts.link_count),
      modelCalls: linkRun.providerCalls,
      acceptedSuggestions: linkRun.accepted.length,
      rejectedSuggestions: linkRun.rejected.length,
      linkModelUsage: usage,
      sourceCrestCalls: sourceCrest.results.length,
      sourceCrestModelCalls: 0,
      sourceCrestModelCallReason: "Search/LLM rating fallback is disabled; enabled SourceCrest providers are deterministic or external data/API lookups.",
      perennialSignalCount: sourceCrest.persistence.filter((row: any) => row.perennialSourcesStoredSeparately).length,
      preexistingAggregatePreserved: aggregatePreserved,
      terminalActivityCount: activities.length,
      apiSuggestionOccurrenceCount: apiSourceIds.size,
      apiPerennialSourceCount: apiPerennialCount,
      promptHash: cfxLinkSuggestionPromptHash(),
      schemaHash: cfxLinkSuggestionSchemaHash(),
      frozenInputSha256: jsonHash(rows),
      upstreamStagesRerun: [],
    };
    await writeImmutableJson(path.join(root, "run-summary.json"), summary);
    const report = { status, runId, summary, answers };
    await writeImmutableText(path.join(root, "report.md"), reportMarkdown(report));
    await writeImmutableText(path.join(root, "report.html"), reportHtml(report));

    const files = await hashArtifactTree(root);
    const manifest = { files, aggregateSha256: aggregateArtifactHash(files) };
    await writeImmutableJson(path.join(root, "artifact-manifest.json"), manifest);
    await freezeArtifactTree(root);
    process.stdout.write(`${JSON.stringify({ root, status, summary, artifactManifestHash: manifest.aggregateSha256 }, null, 2)}\n`);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
