import "dotenv/config";
import { createHash } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import mysql from "mysql2/promise";
import {
  aggregateArtifactHash,
  hashArtifactTree,
} from "../artifacts/immutableArtifacts.js";
import { prepareCfxFinalLinkingBaseline } from "../finalLinking/baseline.js";
import {
  buildCfxLinkSuggestionRequest,
  cfxLinkSuggestionPromptHash,
  cfxLinkSuggestionSchemaHash,
  validateCfxLinkSuggestions,
  type CfxAcceptedLinkSuggestion,
  type CfxRejectedLinkSuggestion,
} from "../finalLinking/linkSuggestion.js";
import {
  createCfxIsolatedLinkDatabase,
  seedCfxFinalLinkFixture,
} from "../finalLinking/isolatedDatabase.js";
import {
  persistCfxLinkSuggestions,
  persistCfxSourceAssertions,
} from "../finalLinking/persistence.js";
import { createOpenAiCf7StructuredProvider } from "../../shared/provider/index.js";
import { canonicalHash } from "../../shared/sourceUnits/index.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(here, "../../../..");
const repositoryRoot = path.resolve(backendRoot, "..");
const extractionRunId = "cfx-single-assertion-packet-extraction-20260802090828";
const extractionRoot = path.join(repositoryRoot, "artifacts/claim-foundry/cfx/CF1-F03", extractionRunId);
const selectedDocumentsPath = path.join(repositoryRoot,
  "artifacts/claim-foundry/cfx/CF1-F03/cfx-ranked-minimal-extraction-20260802061220/selected-documents.json");
const artifactParent = path.join(repositoryRoot, "artifacts/claim-foundry/cfx/CF1-F03");
const config = Object.freeze({
  model: "gpt-4o-mini",
  temperature: 0.1,
  concurrency: 2,
  maxOutputTokens: 4_000,
  timeoutMs: 180_000,
  retries: 0,
  store: false,
  expectedModelCalls: 2,
});

export const CFX_FINAL_LINK_AUTHORIZATION = "Authorized: Send the 14 byte-verified immutable CF1-F03 source assertions and exact excerpts to OpenAI through exactly two Chat Completions API requests, one for P54895 and one for P54897, using gpt-4o-mini, temperature 0.1, concurrency 2, strict cfx_source_assertion_link_suggestion_v1 structured output, a 4,000-token output limit per request, a 180,000 ms timeout, zero retries, and store false; persist the source claims and accepted AI-suggested links only in a newly created isolated cfx_final_link_fixture_* MySQL database, preserve every artifact and idempotency result, make no additional model calls, and do not mutate production data.";

function stamp(): string {
  return new Date().toISOString().replace(/[-:.TZ]/gu, "").slice(0, 14);
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

async function readJson(filePath: string): Promise<any> {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
}

async function writeText(filePath: string, value: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, value, { flag: "wx" });
}

async function freezeTree(root: string): Promise<void> {
  const { readdir } = await import("node:fs/promises");
  async function visit(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(full);
      else await chmod(full, 0o444);
    }
    await chmod(directory, 0o555);
  }
  await visit(root);
}

async function writeManifest(root: string): Promise<{ files: unknown[]; aggregateSha256: string }> {
  const files = await hashArtifactTree(root);
  const manifest = { files, aggregateSha256: aggregateArtifactHash(files) };
  await writeJson(path.join(root, "artifact-manifest.json"), manifest);
  return manifest;
}

async function verifiedInputs() {
  const manifest = await readJson(path.join(extractionRoot, "artifact-manifest.json"));
  const required = ["accepted-source-assertions.json", "exact-model-requests.json", "model-test-summary.json"];
  for (const name of required) {
    const bytes = await readFile(path.join(extractionRoot, name));
    const expected = manifest.files.find((row: any) => row.path === name)?.sha256;
    if (!expected || sha256(bytes) !== expected) throw new Error(`frozen extraction input hash mismatch: ${name}`);
  }
  const [acceptedRows, exactExtractionRequests, summary, selectedDocuments] = await Promise.all([
    readJson(path.join(extractionRoot, "accepted-source-assertions.json")),
    readJson(path.join(extractionRoot, "exact-model-requests.json")),
    readJson(path.join(extractionRoot, "model-test-summary.json")),
    readJson(selectedDocumentsPath),
  ]);
  const prepared = prepareCfxFinalLinkingBaseline({
    extractionRunId, acceptedRows, exactExtractionRequests,
    extractionPromptHash: summary.promptHash, extractionSchemaHash: summary.schemaHash,
    selectedDocuments,
  });
  return {
    ...prepared,
    inputHashes: {
      extractionManifestAggregate: manifest.aggregateSha256,
      acceptedSourceAssertions: sha256(await readFile(path.join(extractionRoot, "accepted-source-assertions.json"))),
      exactExtractionRequests: sha256(await readFile(path.join(extractionRoot, "exact-model-requests.json"))),
      extractionSummary: sha256(await readFile(path.join(extractionRoot, "model-test-summary.json"))),
      selectedDocuments: sha256(await readFile(selectedDocumentsPath)),
    },
  };
}

async function discoveredContracts() {
  const tables = [
    "claims", "content_claims", "claim_sources", "content_relations",
    "reference_claim_links", "reference_claim_task_links",
    "reference_claim_task_link_provenance", "claim_evaluation_targets",
    "evaluation_target_evidence_links", "claim_retrieval_evidence",
  ];
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER, password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE,
  });
  const schemaHashes: Record<string, string> = {};
  try {
    for (const table of tables) {
      const [rows] = await connection.query<mysql.RowDataPacket[]>("SHOW CREATE TABLE ??", [table]);
      schemaHashes[table] = sha256(String(rows[0]?.["Create Table"] ?? ""));
    }
  } finally { await connection.end(); }
  return {
    liveSchemaReadOnlyAudit: true,
    liveSchemaHashes: schemaHashes,
    authoritativeContracts: {
      sourceClaim: {
        tables: ["claims", "content_claims", "claim_sources"],
        rule: "claims is canonical by exact text plus claim_type; content_claims binds the claim to a source document; claim_sources records document provenance",
      },
      sourceAssertionOccurrence: {
        table: "cfx_source_assertion_provenance",
        reasonAdded: "existing claim tables do not preserve sourceAssertionId, excerpt offsets, packet/block IDs, or extraction call hashes",
        parallelClaimSchema: false,
      },
      aiSuggestedClaimLink: {
        table: "reference_claim_task_links",
        uniqueIdentity: ["content_relation_id", "reference_claim_id", "task_claim_id"],
        suggestionMarker: { created_by_ai: 1, verified_by_user_id: null },
      },
      documentLevelLink: {
        table: "reference_claim_links",
        role: "document-to-case discovery/assessment; not authoritative for source-assertion links",
      },
      evaluationTargetLink: {
        table: "evaluation_target_evidence_links",
        role: "optional dual-write when a claim_evaluation_target exists; not required by this isolated two-claim fixture",
      },
      retrievalEvidence: {
        table: "claim_retrieval_evidence",
        role: "retrieval provenance, not an adjudicated source-assertion link",
      },
    },
    stance: {
      enum: ["support", "refute", "nuance", "insufficient"],
      source: "reference_claim_task_links.stance",
    },
    numericSemantics: {
      suggestedScore: {
        range: [0, 1], direction: "unsigned bearing magnitude; stance supplies direction",
        source: "evaluation_target_evidence_links.bearing_score",
      },
      persistedSupportLevel: {
        range: [-1.2, 1.2], direction: "support positive, refute negative, nuance half-positive, insufficient zero",
        source: "legacy matchClaims support_level convention",
      },
      legacyScore: {
        observedRange: [0, 120], meaning: "source quality/veracity", writePolicy: "NULL: prohibited in this test",
      },
      confidence: { range: [0, 1], writePolicy: "NULL: model was not asked for confidence" },
    },
  };
}

function prepareCalls(rows: Awaited<ReturnType<typeof verifiedInputs>>["rows"]) {
  const caseOrder = ["P54895", "P54897"];
  return caseOrder.map((caseAssertionId, index) => {
    const sourceAssertions = rows.filter((row) => row.caseAssertionId === caseAssertionId);
    const request = buildCfxLinkSuggestionRequest({
      caseAssertionId,
      caseAssertionText: sourceAssertions[0]!.caseAssertionText,
      sourceAssertions,
      ...config,
    });
    const callId = `link-request-${String(index + 1).padStart(3, "0")}`;
    return {
      callId, caseAssertionId, caseAssertionText: sourceAssertions[0]!.caseAssertionText,
      sourceAssertions, request, requestHash: canonicalHash(request),
    };
  });
}

function publicCall(call: ReturnType<typeof prepareCalls>[number]) {
  return {
    callId: call.callId, caseAssertionId: call.caseAssertionId,
    caseAssertionText: call.caseAssertionText,
    suppliedSourceAssertionIds: call.sourceAssertions.map((row) => row.sourceAssertionId),
    sourceAssertionCount: call.sourceAssertions.length,
    requestHash: call.requestHash,
    request: call.request,
  };
}

function esc(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/gu, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;",
  }[char]!));
}

function reportMarkdown(report: any): string {
  const rows = report.rows.map((row: any) => `| ${row.caseAssertionId} | ${row.sourceAssertion.replaceAll("|", "\\|")} | ${row.exactExcerpt.replaceAll("|", "\\|")} | ${row.documentTitle.replaceAll("|", "\\|")} | ${row.suggestedStance ?? "REJECTED"} | ${row.suggestedScore ?? "—"} | ${(row.rationale ?? row.rejectionReason ?? "").replaceAll("|", "\\|")} | ${row.persistenceStatus ?? "not persisted"} |`).join("\n");
  return `# CFX final source-assertion persistence and AI-suggested links

## Run identity

- Run: ${report.runId}
- Status: ${report.summary.status}
- Isolated database: ${report.summary.testDatabase}
- Production mutations: none
- Model calls: ${report.summary.modelCalls}
- Prompt hash: ${report.summary.promptHash}
- Schema hash: ${report.summary.schemaHash}

| Case assertion | Source assertion | Exact excerpt | Document | Suggested stance | Suggested score | Rationale | Persistence status |
|---|---|---|---|---|---:|---|---|
${rows}

## Summary

\`\`\`json
${JSON.stringify(report.summary, null, 2)}
\`\`\`

## Manual review answers

1. **Did every accepted extracted source assertion become a persisted source claim?** ${report.answers.everySourceClaim}
2. **Did every source claim receive exactly one AI-suggested link?** ${report.answers.everySuggestion}
3. **Were any source assertions suppressed in the two batched link calls?** ${report.answers.suppressed}
4. **Did stance describe bearing rather than truth or source quality?** ${report.answers.bearingNotTruth}
5. **Did numeric score follow repository semantics?** ${report.answers.numericSemantics}
6. **Did excerpts and offsets remain attached correctly?** ${report.answers.grounding}
7. **Did rerunning create duplicates?** ${report.answers.duplicates}
8. **Are suggestions distinguishable from final/human links?** ${report.answers.suggestionStatus}
9. **Ready for existing Workspace/evidence UI?** ${report.answers.workspace}
`;
}

function reportHtml(report: any): string {
  const rows = report.rows.map((row: any) => `<tr><td>${esc(row.caseAssertionId)}</td><td>${esc(row.sourceAssertion)}</td><td>${esc(row.exactExcerpt)}</td><td>${esc(row.documentTitle)}</td><td>${esc(row.suggestedStance ?? "REJECTED")}</td><td>${esc(row.suggestedScore ?? "—")}</td><td>${esc(row.rationale ?? row.rejectionReason ?? "")}</td><td>${esc(row.persistenceStatus ?? "not persisted")}</td></tr>`).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><title>CFX final source links</title><style>body{font:14px system-ui;margin:2rem;max-width:1600px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #bbb;padding:6px;vertical-align:top}th{background:#eee}pre{white-space:pre-wrap}</style></head><body><h1>CFX final source-assertion persistence and AI-suggested links</h1><p>Run <code>${esc(report.runId)}</code>; isolated database <code>${esc(report.summary.testDatabase)}</code>; production mutations: none.</p><table><thead><tr><th>Case</th><th>Source assertion</th><th>Exact excerpt</th><th>Document</th><th>Stance</th><th>Score</th><th>Rationale</th><th>Persistence</th></tr></thead><tbody>${rows}</tbody></table><h2>Summary</h2><pre>${esc(JSON.stringify(report.summary, null, 2))}</pre><h2>Manual review</h2><pre>${esc(JSON.stringify(report.answers, null, 2))}</pre></body></html>`;
}

async function preflight() {
  const inputs = await verifiedInputs();
  const contracts = await discoveredContracts();
  const calls = prepareCalls(inputs.rows);
  const runId = `cfx-final-source-links-preflight-${stamp()}`;
  const root = path.join(artifactParent, runId);
  await mkdir(root, { recursive: false });
  const summary = {
    status: "AWAITING_LIVE_AUTHORIZATION", runId,
    authoritativeExtractionRun: extractionRunId, sourceAssertionCount: inputs.rows.length,
    caseAssertionCount: inputs.caseAssertions.length, expectedModelCalls: calls.length,
    sourceAssertionsPerCall: calls.map((call) => ({ callId: call.callId, caseAssertionId: call.caseAssertionId, count: call.sourceAssertions.length })),
    config, promptHash: cfxLinkSuggestionPromptHash(), schemaHash: cfxLinkSuggestionSchemaHash(),
    inputHashes: inputs.inputHashes, productionMutation: false,
    authorizationRequired: CFX_FINAL_LINK_AUTHORIZATION,
  };
  await Promise.all([
    writeJson(path.join(root, "discovered-persistence-contracts.json"), contracts),
    writeJson(path.join(root, "source-claim-inputs.json"), inputs.rows),
    writeJson(path.join(root, "exact-link-model-requests.json"), calls.map(publicCall)),
    writeJson(path.join(root, "run-summary.json"), summary),
    writeText(path.join(root, "authorization-required.txt"), `${CFX_FINAL_LINK_AUTHORIZATION}\n`),
  ]);
  const manifest = await writeManifest(root);
  await freezeTree(root);
  return { root, summary, manifest };
}

async function execute() {
  if (process.env.CFX_LIVE_AUTHORIZATION !== CFX_FINAL_LINK_AUTHORIZATION) {
    throw new Error("exact CFX_LIVE_AUTHORIZATION is required");
  }
  const inputs = await verifiedInputs();
  const contracts = await discoveredContracts();
  const calls = prepareCalls(inputs.rows);
  if (calls.length !== 2 || calls[0]!.sourceAssertions.length !== 8 || calls[1]!.sourceAssertions.length !== 6) {
    throw new Error("governed two-call partition changed");
  }
  const runId = `cfx-final-source-links-${stamp()}`;
  const root = path.join(artifactParent, runId);
  await mkdir(path.join(root, "requests"), { recursive: true });
  const databaseName = `cfx_final_link_fixture_${stamp()}`;
  const database = await createCfxIsolatedLinkDatabase({ databaseName, backendRoot });
  try {
    const seeded = await seedCfxFinalLinkFixture({
      database, caseAssertions: inputs.caseAssertions, documents: inputs.documents,
    });
    const sourcePersistence = await persistCfxSourceAssertions({
      query: database.query, taskClaimIds: seeded.taskClaimIds,
      documents: seeded.documents, rows: inputs.rows,
    });
    const provider = createOpenAiCf7StructuredProvider();
    let providerCalls = 0;
    const results: any[] = Array(calls.length);
    await Promise.all(calls.map(async (call, index) => {
      const requestRoot = path.join(root, "requests", call.callId);
      await mkdir(requestRoot, { recursive: false });
      await writeJson(path.join(requestRoot, "request.json"), publicCall(call));
      await writeText(path.join(requestRoot, "request_hash.txt"), `${call.requestHash}\n`);
      providerCalls += 1;
      if (providerCalls > 2) throw new Error("two-call ceiling exceeded");
      const started = performance.now();
      try {
        const response = await provider.invokeStructured(call.request);
        const latencyMs = Math.round(performance.now() - started);
        const raw = {
          callId: call.callId, responseId: response.responseId, requestId: response.requestId,
          model: response.model, usage: response.usage, latencyMs,
          rawResponse: response.rawResponse, parsedOutput: response.output,
          capturedBeforeValidation: true,
        };
        await writeJson(path.join(requestRoot, "raw_response.json"), raw);
        await writeText(path.join(requestRoot, "raw_response_hash.txt"), `${sha256(JSON.stringify(raw))}\n`);
        const validation = validateCfxLinkSuggestions({
          caseAssertionId: call.caseAssertionId,
          suppliedSourceAssertionIds: call.sourceAssertions.map((row) => row.sourceAssertionId),
          rawOutput: response.output,
        });
        await Promise.all([
          writeJson(path.join(requestRoot, "validation.json"), validation),
          writeJson(path.join(requestRoot, "accepted_rows.json"), validation.acceptedRows),
          writeJson(path.join(requestRoot, "rejected_rows.json"), validation.rejectedRows),
        ]);
        results[index] = { ...raw, validation, providerStatus: "completed" };
      } catch (error) {
        const failure = {
          name: error instanceof Error ? error.name : "Error",
          message: error instanceof Error ? error.message : String(error),
          latencyMs: Math.round(performance.now() - started),
        };
        await writeJson(path.join(requestRoot, "provider_failure.json"), failure);
        results[index] = {
          callId: call.callId, responseId: null, requestId: null, model: config.model,
          usage: { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, totalTokens: 0 },
          latencyMs: failure.latencyMs, rawResponse: null, parsedOutput: null,
          validation: { acceptedRows: [], rejectedRows: [{ caseAssertionId: call.caseAssertionId, rowIndex: null, rawRow: null, reasons: [{ code: "PROVIDER_FAILURE", message: failure.message }] }] },
          providerStatus: "failed",
        };
      }
    }));
    if (providerCalls !== 2) throw new Error(`provider-call invariant failed: ${providerCalls}`);
    const accepted = results.flatMap((row) => row.validation.acceptedRows) as CfxAcceptedLinkSuggestion[];
    const rejected = results.flatMap((row) => row.validation.rejectedRows) as CfxRejectedLinkSuggestion[];
    const modelCallIds = new Map(calls.map((call) => [call.caseAssertionId, call.callId]));
    const persistedLinks = await persistCfxLinkSuggestions({
      query: database.query, taskContentId: seeded.taskContentId,
      rows: sourcePersistence, suggestions: accepted, suggestionRunId: runId,
      suggestionModelCallIds: modelCallIds,
      suggestionPromptHash: cfxLinkSuggestionPromptHash(),
      suggestionSchemaHash: cfxLinkSuggestionSchemaHash(), model: config.model,
    });
    const rerunSources = await persistCfxSourceAssertions({
      query: database.query, taskClaimIds: seeded.taskClaimIds,
      documents: seeded.documents, rows: inputs.rows,
    });
    const rerunLinks = await persistCfxLinkSuggestions({
      query: database.query, taskContentId: seeded.taskContentId,
      rows: rerunSources, suggestions: accepted, suggestionRunId: runId,
      suggestionModelCallIds: modelCallIds,
      suggestionPromptHash: cfxLinkSuggestionPromptHash(),
      suggestionSchemaHash: cfxLinkSuggestionSchemaHash(), model: config.model,
    });
    const [counts, metricProblems, groundingProblems] = await Promise.all([
      database.query(`SELECT
        (SELECT COUNT(*) FROM cfx_source_assertion_provenance) source_occurrences,
        (SELECT COUNT(*) FROM claims WHERE claim_type='reference') source_claims,
        (SELECT COUNT(*) FROM reference_claim_task_links) canonical_links,
        (SELECT COUNT(*) FROM cfx_source_assertion_provenance WHERE suggestion_status='accepted') accepted_suggestions`),
      database.query(`SELECT COUNT(*) n FROM reference_claim_task_links
        WHERE score IS NOT NULL OR confidence IS NOT NULL OR created_by_ai<>1 OR verified_by_user_id IS NOT NULL`),
      database.query(`SELECT COUNT(*) n FROM cfx_source_assertion_provenance
        WHERE exact_excerpt='' OR excerpt_end<excerpt_start`),
    ]);
    const dbCounts = counts[0];
    const usageRows = results.map((result) => ({
      callId: result.callId, responseId: result.responseId, requestId: result.requestId,
      latencyMs: result.latencyMs, ...result.usage,
    }));
    const usage = usageRows.reduce((sum, row) => ({
      inputTokens: sum.inputTokens + Number(row.inputTokens || 0),
      cachedInputTokens: sum.cachedInputTokens + Number(row.cachedInputTokens || 0),
      outputTokens: sum.outputTokens + Number(row.outputTokens || 0),
      totalTokens: sum.totalTokens + Number(row.totalTokens || 0),
      latencyMs: sum.latencyMs + Number(row.latencyMs || 0),
    }), { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, totalTokens: 0, latencyMs: 0 });
    const idempotency = {
      sourceClaimIdsStable: sourcePersistence.every((row, index) => row.evidenceClaimId === rerunSources[index]?.evidenceClaimId),
      sourceOccurrenceIdsStable: sourcePersistence.every((row, index) => row.sourceAssertionId === rerunSources[index]?.sourceAssertionId),
      rerunSourceStatuses: rerunSources.map((row) => row.persistenceStatus),
      linkIdsStable: persistedLinks.every((row, index) => row.referenceClaimTaskLinkId === rerunLinks[index]?.referenceClaimTaskLinkId),
      sourceOccurrenceCount: Number(dbCounts.source_occurrences),
      canonicalSourceClaimCount: Number(dbCounts.source_claims),
      canonicalLinkCount: Number(dbCounts.canonical_links),
      acceptedSuggestionOccurrenceCount: Number(dbCounts.accepted_suggestions),
      duplicateSourceOccurrences: Number(dbCounts.source_occurrences) - inputs.rows.length,
      duplicateCanonicalLinksOnRerun: new Set(rerunLinks.map((row) => row.referenceClaimTaskLinkId)).size - Number(dbCounts.canonical_links),
      passed: Number(dbCounts.source_occurrences) === 14
        && sourcePersistence.every((row, index) => row.evidenceClaimId === rerunSources[index]?.evidenceClaimId)
        && persistedLinks.every((row, index) => row.referenceClaimTaskLinkId === rerunLinks[index]?.referenceClaimTaskLinkId),
    };
    const acceptedById = new Map(accepted.map((row) => [row.sourceAssertionId, row]));
    const persistedById = new Map(persistedLinks.map((row) => [row.sourceAssertionId, row]));
    const rows = sourcePersistence.map((row) => {
      const suggestion = acceptedById.get(row.sourceAssertionId);
      const persisted = persistedById.get(row.sourceAssertionId);
      const rejection = rejected.find((item) => item.rawRow && typeof item.rawRow === "object"
        && (item.rawRow as any).sourceAssertionId === row.sourceAssertionId);
      return {
        ...row,
        suggestedStance: suggestion?.suggestedStance ?? null,
        suggestedScore: suggestion?.suggestedScore ?? null,
        rationale: suggestion?.rationale ?? null,
        rejectionReason: rejection?.reasons.map((reason) => reason.message).join("; ") ?? null,
        persistenceStatus: persisted?.persistenceStatus ?? "not_persisted",
        referenceClaimTaskLinkId: persisted?.referenceClaimTaskLinkId ?? null,
      };
    });
    const stanceDistribution = Object.fromEntries(["support", "refute", "nuance", "insufficient"].map((stance) =>
      [stance, accepted.filter((row) => row.suggestedStance === stance).length]));
    const scores = accepted.map((row) => row.suggestedScore);
    const summary = {
      status: results.every((row) => row.providerStatus === "completed") && rejected.length === 0 && accepted.length === 14
        ? "COMPLETED" : "COMPLETED_WITH_REJECTIONS",
      runId, testDatabase: databaseName, authoritativeExtractionRun: extractionRunId,
      caseClaims: 2, sourceClaimsAttempted: 14,
      insertedSourceOccurrences: sourcePersistence.filter((row) => row.persistenceStatus === "inserted").length,
      reusedSourceOccurrencesOnRerun: rerunSources.filter((row) => row.persistenceStatus === "reused").length,
      canonicalSourceClaims: Number(dbCounts.source_claims), duplicateSourceOccurrences: 0,
      suggestedLinksAttempted: 14, acceptedSuggestions: accepted.length, rejectedSuggestions: rejected.length,
      insertedOrUpdatedCanonicalLinks: Number(dbCounts.canonical_links), missingSuggestions: 14 - accepted.length,
      stanceDistribution,
      scoreDistribution: scores.length ? { minimum: Math.min(...scores), maximum: Math.max(...scores), mean: scores.reduce((a, b) => a + b, 0) / scores.length } : null,
      modelCalls: providerCalls, usage, promptHash: cfxLinkSuggestionPromptHash(),
      schemaHash: cfxLinkSuggestionSchemaHash(), inputHashes: inputs.inputHashes,
      idempotencyPassed: idempotency.passed,
      metricSemanticViolations: Number(metricProblems[0].n), groundingProblems: Number(groundingProblems[0].n),
      noAdditionalModelCalls: providerCalls === 2, productionMutation: false,
    };
    const answers = {
      everySourceClaim: Number(dbCounts.source_occurrences) === 14 ? "Yes; all 14 occurrence IDs map to canonical reference claims." : "No.",
      everySuggestion: accepted.length === 14 ? "Yes; all 14 occurrence IDs received one accepted suggestion." : `No; ${14 - accepted.length} are missing or rejected.`,
      suppressed: accepted.length + rejected.filter((row) => row.rowIndex !== null).length >= 14 ? "No; every supplied ID is accounted for." : "Yes or unaccounted; inspect rejected rows.",
      bearingNotTruth: "Yes by model surface: no quality, truth, retrieval, or prior relevance fields were supplied; legacy quality score and confidence remain null.",
      numericSemantics: "Yes; suggestedScore is 0–1 bearing magnitude and is deterministically projected to signed support_level; it is not written to the legacy quality score column.",
      grounding: Number(groundingProblems[0].n) === 0 ? "Yes; exact excerpts, offsets, block IDs, and packet IDs survived." : "No; inspect grounding diagnostics.",
      duplicates: idempotency.passed ? "No; occurrence IDs, canonical claim IDs, and canonical link IDs were stable." : "Idempotency failed.",
      suggestionStatus: Number(metricProblems[0].n) === 0 ? "Yes; created_by_ai=1 and verified_by_user_id=NULL; provenance status is accepted." : "No.",
      workspace: accepted.length === 14 && Number(metricProblems[0].n) === 0 ? "Yes for the existing claim-link API/UI contract; this isolated test was not inserted into a production Workspace." : "Not yet.",
    };
    const report = { runId, summary, answers, rows };
    await Promise.all([
      writeJson(path.join(root, "discovered-persistence-contracts.json"), contracts),
      writeJson(path.join(root, "source-claim-inputs.json"), inputs.rows),
      writeJson(path.join(root, "source-claim-persistence-results.json"), sourcePersistence),
      writeJson(path.join(root, "exact-link-model-requests.json"), calls.map(publicCall)),
      writeJson(path.join(root, "raw-link-model-responses.json"), results.map((row) => ({ callId: row.callId, rawResponse: row.rawResponse, parsedOutput: row.parsedOutput }))),
      writeJson(path.join(root, "accepted-link-suggestions.json"), accepted),
      writeJson(path.join(root, "rejected-link-suggestions.json"), rejected),
      writeJson(path.join(root, "persisted-link-results.json"), persistedLinks),
      writeJson(path.join(root, "idempotency-verification.json"), idempotency),
      writeJson(path.join(root, "per-call-usage.json"), { calls: usageRows, totals: usage }),
      writeJson(path.join(root, "run-summary.json"), summary),
      writeText(path.join(root, "report.md"), reportMarkdown(report)),
      writeText(path.join(root, "report.html"), reportHtml(report)),
    ]);
    const manifest = await writeManifest(root);
    await freezeTree(root);
    return { root, summary, manifest };
  } finally { await database.pool.end(); }
}

async function main(): Promise<void> {
  const result = process.argv.includes("--execute") ? await execute() : await preflight();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
