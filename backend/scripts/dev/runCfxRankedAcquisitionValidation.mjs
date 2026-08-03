import "dotenv/config";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchAcademicApiContent } from "../../src/core/academicContentResolver.js";
import { acquireCfxDocumentAutomatically } from "../../src/services/cfxAutomaticAcquisition.js";
import { createProductionCfxStructuredProvider } from "../../src/services/cfxEvidenceCoordinator.js";
import { selectCfxTopRankedDocumentsPerAssertion } from "../../src/services/cfxProductionEvidencePipeline.js";

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const repositoryRoot = path.resolve(backendRoot, "..");
const frozenRun = path.join(repositoryRoot,
  "artifacts/claim-foundry/cfx/production/18056/cfx-prod-18056-1785628610989-bde92c10");
const propositionIds = ["P54895", "P54897"];
const config = Object.freeze({
  model: "gpt-4o-mini",
  temperature: 0.1,
  maxOutputTokens: 8_000,
  timeoutMs: 180_000,
  retryCount: 0,
  store: false,
  maximumProviderCalls: 10,
  acquisitionConcurrency: 2,
});
export const AUTHORIZATION = "Authorized: Acquire the canonical-deduplicated union of the former assertion-specific top-five search-rank candidates for frozen CF1-F03 propositions P54895 and P54897 through the connected academic, PDF, direct, retry, alternate-URL, Wayback, and headless acquisition ladder; send each automatically acquired eligible canonical document plus the complete immutable 12-assertion inventory to OpenAI through at most 10 Chat Completions API requests for one governed CFX ranked-acquisition validation using gpt-4o-mini, temperature 0.1, strict governed document-bearing schema, 8,000 output tokens, 180,000 ms timeout, zero retries, and store false; preserve every artifact, do not invoke SourceCrest or publisher enrichment in this artifact-only run, make no overlapping legacy semantic calls, and do not mutate production data.";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
const stamp = () => new Date().toISOString().replace(/[-:TZ.]/gu, "").slice(0, 14);
const escape = (value) => String(value ?? "").replace(/&/gu,"&amp;")
  .replace(/</gu,"&lt;").replace(/>/gu,"&gt;").replace(/"/gu,"&quot;");

async function writeJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, json(value));
}

function accessLevel(acquired) {
  if (!acquired.acquired) return "unavailable";
  if (acquired.completeness === "abstract") return "abstract";
  return acquired.cleanedText?.length >= 400 ? "full_text" : "snippet";
}

function reportHtml(report) {
  const assertionSections = report.selection.perAssertion.map((assertion) => `
    <h2>${escape(assertion.propositionId)}</h2>
    <p>${escape(assertion.assertion)}</p>
    <table><thead><tr><th>Rank</th><th>Document</th><th>Query</th><th>Retrieval rank</th><th>Title</th><th>URL</th></tr></thead><tbody>
    ${assertion.selected.map((row, index) => `<tr><td>${index + 1}</td><td>${escape(row.documentKey)}</td><td>${escape(row.queryId)}</td><td>${escape(row.retrievalRank)}</td><td>${escape(row.title)}</td><td>${escape(row.url)}</td></tr>`).join("")}
    </tbody></table>`).join("");
  const documents = report.documents.map((row) => `
    <details><summary>${escape(row.documentKey)} · ${escape(row.accessLevel)} · ${escape(row.title || row.url)}</summary>
    <p><strong>URL:</strong> ${escape(row.url)}<br><strong>Text:</strong> ${row.textLength} chars<br><strong>Extraction:</strong> ${escape(row.extractionMethod)}<br><strong>Semantic status:</strong> ${escape(row.semanticStatus)}</p>
    <h4>Acquisition attempts</h4><pre>${escape(JSON.stringify(row.attempts, null, 2))}</pre>
    <h4>Evidence assertions</h4><pre>${escape(JSON.stringify(row.evidenceAssertions, null, 2))}</pre></details>`).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><title>CFX ranked acquisition validation</title><style>body{font-family:system-ui;margin:2rem;line-height:1.4}table{border-collapse:collapse;width:100%;font-size:12px}th,td{border:1px solid #bbb;padding:5px;vertical-align:top}th{background:#eee}details{margin:1rem 0;padding:.6rem;border:1px solid #bbb}pre{white-space:pre-wrap}</style></head><body><h1>CFX ranked acquisition validation</h1><p>Run: <code>${escape(report.runId)}</code></p><pre>${escape(JSON.stringify(report.summary,null,2))}</pre>${assertionSections}<h2>Canonical acquisition union</h2>${documents}</body></html>`;
}

async function main() {
  const execute = process.argv.includes("--execute");
  const [documentsBytes, inputsBytes] = await Promise.all([
    readFile(path.join(frozenRun, "canonical_documents.json")),
    readFile(path.join(frozenRun, "evidence_inputs.json")),
  ]);
  const documents = JSON.parse(documentsBytes);
  const inputs = JSON.parse(inputsBytes);
  if (documents.length !== 169) throw new Error(`Expected frozen 169-document pool; got ${documents.length}`);
  const selectedInputs = propositionIds.map((id) => inputs.find((row) => row.propositionId === id));
  if (selectedInputs.some((row) => !row)) throw new Error("Frozen target propositions are missing");
  const selection = selectCfxTopRankedDocumentsPerAssertion(selectedInputs, documents, 5);
  const runId = `cfx-ranked-acquisition-${stamp()}`;
  const root = path.join(repositoryRoot, "artifacts/claim-foundry/cfx/CF1-F03", runId);
  await mkdir(root, { recursive: false });

  const selectedByKey = new Map(selection.documents.map((document) => [document.documentKey, document]));
  const reportedSelection = {
    ...selection,
    documents: undefined,
    perAssertion: selection.perAssertion.map((row) => ({
      propositionId: row.propositionId,
      assertion: selectedInputs.find((input) => input.propositionId === row.propositionId).substantiveAssertion,
      selected: row.selected.map((selected) => {
        const document = selectedByKey.get(selected.documentKey);
        return {
          ...selected,
          title: document.representative.title,
          url: document.canonicalUrl || document.representative.url,
        };
      }),
    })),
  };
  const bearing = await import("../../dist/claimfoundry/cfx/evidenceBearing/documentExtraction.js");
  const diagnostic = await import("../../dist/claimfoundry/cfx/retrieval/snippetPreBearingLikelihood.js");
  const prompt = await bearing.loadCfxDocumentBearingPrompt();
  await writeJson(path.join(root, "preflight.json"), {
    runId,
    execute,
    frozenRun: path.relative(repositoryRoot, frozenRun),
    frozenPoolSha256: sha256(documentsBytes),
    evidenceInputsSha256: sha256(inputsBytes),
    frozenCanonicalDocumentCount: documents.length,
    selectionPolicy: selection.policy,
    selectedPerAssertion: selection.maximumPerAssertion,
    canonicalUnionCount: selection.documents.length,
    config,
    promptHash: prompt.promptHash,
    schemaHash: bearing.cfxDocumentBearingSchemaHash(),
    productionMutation: false,
    sourceCrestEnabled: false,
    sourceCrestModelCalls: 0,
  });
  await writeJson(path.join(root, "ranked_selection.json"), reportedSelection);
  await writeJson(path.join(root, "prebearing_diagnostics_only.json"), selectedInputs.flatMap((input) =>
    documents.filter((document) => document.discoveryAssignments.some((row) =>
      row.propositionId === input.propositionId)).map((document) =>
      diagnostic.scoreCfxSnippetPreBearing(input, document))));
  if (!execute) {
    console.log(json({ status: "preflight_only", runId, root, canonicalUnionCount: selection.documents.length }));
    return;
  }
  if (process.env.CFX_LIVE_AUTHORIZATION !== AUTHORIZATION) {
    throw new Error("Exact CFX_LIVE_AUTHORIZATION is required for --execute");
  }

  const acquisitionRows = Array(selection.documents.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(config.acquisitionConcurrency, selection.documents.length) }, async () => {
    while (cursor < selection.documents.length) {
      const index = cursor++;
      const document = selection.documents[index];
      const candidate = document.representative;
      const documentRoot = path.join(root, "documents", document.documentKey);
      await mkdir(documentRoot, { recursive: true });
      let academic = null;
      try {
        academic = await fetchAcademicApiContent({
          url: candidate.canonicalUrl || candidate.resolvedUrl || candidate.url,
          title: candidate.title,
          snippet: candidate.abstractOrSnippet,
          academicMetadata: { pmid: candidate.pmid, doi: candidate.doi },
        }, { disableCache: true });
      } catch (error) {
        await writeJson(path.join(documentRoot, "academic_resolver_failure.json"), {
          name: error?.name || "Error", message: error?.message || String(error),
        });
      }
      if (academic) await writeJson(path.join(documentRoot, "academic_resolver_result.json"), academic);
      const acquired = await acquireCfxDocumentAutomatically({ candidate, academic });
      const safeAttempts = [];
      for (const attempt of acquired.attempts || []) {
        const name = `attempt-${String(attempt.ordinal).padStart(3, "0")}`;
        if (attempt.rawResponse != null) {
          await writeFile(path.join(documentRoot, `${name}-raw-response.txt`), String(attempt.rawResponse));
        }
        safeAttempts.push({
          ...attempt,
          rawResponse: attempt.rawResponse == null ? null : `${name}-raw-response.txt`,
          rawResponseSha256: attempt.rawResponse == null ? null : sha256(String(attempt.rawResponse)),
        });
      }
      if (acquired.cleanedText) await writeFile(path.join(documentRoot, "immutable-cleaned-text.txt"), acquired.cleanedText);
      const safeAcquired = {
        ...acquired,
        cleanedText: acquired.cleanedText ? "immutable-cleaned-text.txt" : null,
        attempts: safeAttempts,
      };
      await writeJson(path.join(documentRoot, "acquisition.json"), safeAcquired);
      acquisitionRows[index] = { document, documentRoot, acquired, safeAcquired, academic, accessLevel: accessLevel(acquired) };
    }
  }));

  const targets = inputs.map((input, index) => ({
    propositionId: input.propositionId,
    claimId: Number(input.claimId) || index + 1,
    assertion: input.substantiveAssertion,
  }));
  const provider = createProductionCfxStructuredProvider();
  let providerCalls = 0;
  const usage = { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, totalTokens: 0 };
  let semanticLatencyMs = 0;
  for (const row of acquisitionRows) {
    if (!["full_text", "substantial_excerpt", "abstract"].includes(row.accessLevel)) continue;
    if (providerCalls >= config.maximumProviderCalls) throw new Error("Semantic provider-call budget exhausted");
    const text = await readFile(path.join(row.documentRoot, "immutable-cleaned-text.txt"), "utf8");
    const access = {
      candidateId: row.document.documentKey,
      accessLevel: row.accessLevel,
      textSource: row.acquired.method,
      text,
      characterCount: text.length,
      wordCount: text.trim().split(/\s+/u).length,
      sourceUrl: row.acquired.sourceUrl,
      canonicalUrl: row.acquired.resolvedUrl,
      doi: row.document.doi || null,
      pmid: row.document.pmid || null,
      retrievalAttempts: row.safeAcquired.attempts,
      accessDiagnostics: [],
    };
    const planned = bearing.buildCfxDocumentBearingRequests({
      documentId: row.document.documentKey, targets, access, prompt, ...config,
      maximumDocumentCharactersPerRequest: 180_000,
    });
    if (planned.length !== 1) throw new Error(`${row.document.documentKey} requires ${planned.length} semantic calls`);
    providerCalls += 1;
    const result = await bearing.runCfxDocumentBearingExtraction({
      documentId: row.document.documentKey, targets, access, prompt, provider, ...config,
      maximumDocumentCharactersPerRequest: 180_000,
      async beforeInvoke(request) { await writeJson(path.join(row.documentRoot, "semantic-request.json"), request); },
      async afterResponse(value) {
        await writeJson(path.join(row.documentRoot, "semantic-raw-response.json"), value.rawResponse);
        await writeJson(path.join(row.documentRoot, "semantic-response-metadata.json"), value.metadata);
      },
    });
    for (const key of Object.keys(usage)) usage[key] += Number(result.usage[key] || 0);
    semanticLatencyMs += Number(result.latencyMs || 0);
    row.semantic = result;
    await writeJson(path.join(row.documentRoot, "semantic-result.json"), result);
  }

  const report = {
    runId,
    status: "completed",
    selection: reportedSelection,
    summary: {
      frozenPoolCount: documents.length,
      trialAssertionCount: selectedInputs.length,
      selectedPerAssertion: selection.maximumPerAssertion,
      canonicalAcquisitionUnionCount: selection.documents.length,
      acquiredDocumentCount: acquisitionRows.filter((row) => row.acquired.acquired).length,
      semanticallyEligibleDocumentCount: acquisitionRows.filter((row) => row.semantic).length,
      documentCentricModelCalls: providerCalls,
      documentCentricUsage: usage,
      documentCentricLatencyMs: semanticLatencyMs,
      sourceCrestPublisherEnrichmentModelCalls: 0,
      sourceCrestPublisherEnrichmentTokens: 0,
      repairOrRetryModelCalls: 0,
      repairOrRetryTokens: 0,
      otherModelCalls: 0,
      otherModelTokens: 0,
      productionMutation: false,
    },
    documents: acquisitionRows.map((row) => ({
      documentKey: row.document.documentKey,
      title: row.acquired.extractedDocument?.title || row.document.representative.title,
      url: row.acquired.resolvedUrl || row.acquired.sourceUrl || row.document.canonicalUrl,
      accessLevel: row.accessLevel,
      textLength: row.acquired.cleanedText?.length || 0,
      extractionMethod: row.acquired.extractedDocument?.extractionMethod || row.acquired.method,
      attempts: row.safeAcquired.attempts,
      semanticStatus: row.semantic?.status || "not_run",
      usage: row.semantic?.usage || null,
      evidenceAssertions: row.semantic?.evidenceAssertions || [],
      acceptedTargets: row.semantic?.acceptedTargets || [],
      diagnostics: row.semantic?.diagnostics || [],
    })),
  };
  await writeJson(path.join(root, "report.json"), report);
  await writeFile(path.join(root, "report.html"), reportHtml(report));
  console.log(json({ status: "completed", runId, root, report: path.join(root, "report.html"), providerCalls, usage }));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
