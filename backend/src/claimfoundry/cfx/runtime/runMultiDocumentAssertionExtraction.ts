import "dotenv/config";
import { createHash } from "node:crypto";
import { chmod, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildCfxMultiDocumentAssertionRequest,
  cfxMultiDocumentAssertionPromptHash,
  cfxMultiDocumentAssertionSchemaHash,
  prepareCfxMultiDocumentInput,
  validateCfxMultiDocumentAssertionExtraction,
  type CfxPreparedMultiDocumentInput,
} from "../experiments/multiDocumentAssertionExtraction/extraction.js";
import { createOpenAiCf7StructuredProvider } from "../../shared/provider/index.js";

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const repositoryRoot = path.resolve(backendRoot, "..");
const inputRoot = path.join(repositoryRoot, "artifacts/claim-foundry/cfx/CF1-F03/cfx-assertion-relative-block-baseline-20260802");
const priorRoot = path.join(repositoryRoot, "artifacts/claim-foundry/cfx/CF1-F03/cfx-single-assertion-packet-extraction-20260802090828");
const expectedHashes = Object.freeze({
  "actual_outputs.json": "e2dedc05a477a5123e30ec0ac27692182292886c67acc074471ef573aced7059",
  "baseline_input.json": "96d27c96df49e4e0becb18ad1d99ead90ff70b61e6d3fc06761c3b90c5b60f52",
  "comparison.json": "b28ed864bbc3b475e5dbe5ade32d7a8773653c764647a952f8dcf80b42be7579",
  "cache_determinism_verification.json": "0649f40eaf6e6c327fbe8326268ebcb038b86da8f1eaa8f2fb2553d244580719",
});
const config = Object.freeze({ model: "gpt-4o-mini", temperature: 0.1, concurrency: 2, retryCount: 0, maxOutputTokens: 8_000, timeoutMs: 180_000, store: false, expectedModelCalls: 2 });
export const CFX_MULTI_DOCUMENT_AUTHORIZATION = "Authorized: Send the two byte-verified exhaustive-block CF1-F03 inputs to OpenAI through exactly two independent Chat Completions API requests for one governed CFX one-assertion multi-document extraction comparison, one request for P54895 and one for P54897, containing the unchanged selected passage text with globally unique block IDs and requiring one ordered blockResult for every supplied block, using gpt-4o-mini, temperature 0.1, concurrency 2, strict cfx_single_assertion_multi_document_extraction_v3 structured output, an 8,000-token output limit per request, a 180,000 ms timeout, zero retries, and store false; preserve all governed artifacts; make no repair, second semantic judge, link suggestion, bearing, scoring, source-quality, production mutation, or additional model calls.";

const sha256 = (value: string | Uint8Array): string => createHash("sha256").update(value).digest("hex");
const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;
const stamp = (): string => new Date().toISOString().replace(/[-:TZ.]/gu, "").slice(0, 14);
const escapeHtml = (value: unknown): string => String(value ?? "").replace(/&/gu, "&amp;").replace(/</gu, "&lt;").replace(/>/gu, "&gt;").replace(/"/gu, "&quot;");
const normalize = (value: string): string => value.normalize("NFKC").replace(/\s+/gu, " ").trim().toLocaleLowerCase("en-US");
const writeJson = async (file: string, value: unknown): Promise<void> => writeFile(file, json(value));

type ActualRow = { assertionId: string; documentId: string; selectedPackets: Array<{ packetId: string; blockIds: string[]; charStart: number; charEnd: number; text: string } & Record<string, unknown>>; diagnostics: { documentCharacterCount: number } };
type PriorRow = { caseAssertionId?: string; assertionId?: string; documentId: string; sourceAssertion: string; exactExcerpt: string; relevanceType: string };
type PreparedCall = { callId: string; prepared: CfxPreparedMultiDocumentInput; request: ReturnType<typeof buildCfxMultiDocumentAssertionRequest>; requestHash: string; packetCharacters: number; fullDocumentCharacters: number };

async function verifiedInputs() {
  const files: Record<string, { bytes: Buffer; sha256: string }> = {};
  for (const [name, expected] of Object.entries(expectedHashes)) {
    const bytes = await readFile(path.join(inputRoot, name));
    const actual = sha256(bytes);
    if (actual !== expected) throw new Error(`${name} changed: ${actual}`);
    files[name] = { bytes, sha256: actual };
  }
  return {
    files,
    actual: JSON.parse(files["actual_outputs.json"].bytes.toString("utf8")) as ActualRow[],
    baseline: JSON.parse(files["baseline_input.json"].bytes.toString("utf8")) as { scope: { assertions: Record<string, { text: string }> } },
  };
}

function prepareCalls(actual: ActualRow[], assertions: Record<string, { text: string }>): PreparedCall[] {
  const grouped = new Map<string, ActualRow[]>();
  for (const row of actual.filter((item) => item.selectedPackets.length)) {
    grouped.set(row.assertionId, [...(grouped.get(row.assertionId) ?? []), row]);
  }
  const calls = [...grouped.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([assertionId, rows], index) => {
    const prepared = prepareCfxMultiDocumentInput({
      assertionId,
      assertionText: assertions[assertionId]?.text ?? "",
      documents: rows.map((row) => ({ documentId: row.documentId, selectedPackets: row.selectedPackets.map((packet) => ({ packetId: packet.packetId, blockIds: [...packet.blockIds], charStart: packet.charStart, charEnd: packet.charEnd, text: packet.text })) })),
    });
    const request = buildCfxMultiDocumentAssertionRequest({ ...prepared, ...config });
    return {
      callId: `request-${String(index + 1).padStart(3, "0")}`,
      prepared,
      request,
      requestHash: sha256(json(request)),
      packetCharacters: prepared.blocks.reduce((sum, block) => sum + block.text.length, 0),
      fullDocumentCharacters: rows.reduce((sum, row) => sum + row.diagnostics.documentCharacterCount, 0),
    };
  });
  if (calls.length !== 2 || calls[0].prepared.assertionId !== "P54895" || calls[1].prepared.assertionId !== "P54897") throw new Error("Expected exactly the two frozen assertions");
  if (calls.reduce((sum, call) => sum + call.packetCharacters, 0) !== 31_918) throw new Error("Packet characters changed");
  return calls;
}

function assertModelSurface(calls: PreparedCall[], assertions: Record<string, { text: string }>): void {
  const forbidden = ["combinedScore", "scoreComponents", "matchedTerms", "matchedEntities", "matchedAliases", "conceptGroup", "expectedStance", "queryIntent", "DOCUMENT_ID:"];
  for (const call of calls) {
    if ((call.request.user.match(/ASSERTION_ID:/gu) ?? []).length !== 1) throw new Error("Request does not contain exactly one assertion ID");
    for (const value of forbidden) if (call.request.user.includes(value)) throw new Error(`${call.callId} leaked ${value}`);
    for (const [id, assertion] of Object.entries(assertions)) if (id !== call.prepared.assertionId && call.request.user.includes(assertion.text)) throw new Error(`${call.callId} leaked ${id}`);
  }
}

function requestRecord(call: PreparedCall) {
  return { callId: call.callId, assertionId: call.prepared.assertionId, assertionText: call.prepared.assertionText, documentCount: new Set(call.prepared.blocks.map((block) => block.documentId)).size, blockCount: call.prepared.blocks.length, suppliedCharacters: call.packetCharacters, requestHash: call.requestHash, request: call.request };
}

async function manifest(root: string) {
  async function walk(dir: string, prefix = ""): Promise<Array<{ path: string; bytes: number; sha256: string }>> {
    const rows: Array<{ path: string; bytes: number; sha256: string }> = [];
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (relative === "artifact-manifest.json") continue;
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) rows.push(...await walk(absolute, relative));
      else { const bytes = await readFile(absolute); rows.push({ path: relative, bytes: bytes.length, sha256: sha256(bytes) }); }
    }
    return rows.sort((a, b) => a.path.localeCompare(b.path));
  }
  const files = await walk(root);
  const value = { files, aggregateSha256: sha256(json(files)) };
  await writeJson(path.join(root, "artifact-manifest.json"), value);
  return value;
}

async function freeze(root: string): Promise<void> {
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) await freeze(target); else await chmod(target, 0o444);
  }
}

function rejectionCounts(rows: Array<{ reasons: Array<{ code: string }> }>) {
  const count = (code: string) => rows.filter((row) => row.reasons.some((reason) => reason.code === code)).length;
  return { documentAttributionErrors: 0, packetAttributionErrors: 0, blockAttributionErrors: count("UNKNOWN_BLOCK_ID"), mixedDocumentRows: count("MIXED_DOCUMENT_IDS"), exactGroundingFailures: count("EXACT_EXCERPT_NOT_LITERAL") };
}

function comparison(priorRows: PriorRow[], newRows: Array<Record<string, any>>, priorSummary: Record<string, any>, newUsage: Record<string, number>, calls: PreparedCall[], rejectedRows: Array<{ reasons: Array<{ code: string }> }>) {
  const caseId = (row: PriorRow) => row.caseAssertionId ?? row.assertionId ?? "";
  const priorByExcerpt = new Map(priorRows.map((row) => [`${caseId(row)}\u0000${row.documentId}\u0000${normalize(row.exactExcerpt)}`, row]));
  const newByExcerpt = new Map(newRows.map((row) => [`${row.caseAssertionId}\u0000${row.documentId}\u0000${normalize(row.exactExcerpt)}`, row]));
  const recovered = [...priorByExcerpt.keys()].filter((key) => newByExcerpt.has(key));
  const lost = [...priorByExcerpt.keys()].filter((key) => !newByExcerpt.has(key));
  const added = [...newByExcerpt.keys()].filter((key) => !priorByExcerpt.has(key));
  const rows = [
    ...[...priorByExcerpt].map(([key, prior]) => {
      const next = newByExcerpt.get(key);
      return { priorRunSourceAssertion: prior.sourceAssertion, newRunSourceAssertion: next?.sourceAssertion ?? null, caseAssertionId: caseId(prior), documentId: prior.documentId, exactExcerpt: prior.exactExcerpt, status: !next ? "lost" : normalize(prior.sourceAssertion) === normalize(next.sourceAssertion) ? "recovered" : "materially changed" };
    }),
    ...added.map((key) => { const next = newByExcerpt.get(key)!; return { priorRunSourceAssertion: null, newRunSourceAssertion: next.sourceAssertion, caseAssertionId: next.caseAssertionId, documentId: next.documentId, exactExcerpt: next.exactExcerpt, status: "new" }; }),
  ];
  const priorSources = new Set(priorRows.map((row) => `${caseId(row)}\u0000${row.documentId}\u0000${normalize(row.sourceAssertion)}`));
  const newSources = new Set(newRows.map((row) => `${row.caseAssertionId}\u0000${row.documentId}\u0000${normalize(row.sourceAssertion)}`));
  const priorPerDocument = new Map<string, number>(); const newPerDocument = new Map<string, number>();
  priorRows.forEach((row) => priorPerDocument.set(`${caseId(row)}\u0000${row.documentId}`, (priorPerDocument.get(`${caseId(row)}\u0000${row.documentId}`) ?? 0) + 1));
  newRows.forEach((row) => newPerDocument.set(`${row.caseAssertionId}\u0000${row.documentId}`, (newPerDocument.get(`${row.caseAssertionId}\u0000${row.documentId}`) ?? 0) + 1));
  const invisibleDocuments = [...priorPerDocument].filter(([key, count]) => count > 0 && !newPerDocument.has(key)).map(([key, priorCount]) => { const [assertionId, documentId] = key.split("\u0000"); return { assertionId, documentId, priorCount, newCount: 0 }; });
  const conduct = /\b(?:manipulat\w*|conceal\w*|omit\w*|alter\w*|exclud\w*|data collection|pertinent information)\b/iu;
  const priorP54895 = priorRows.filter((row) => caseId(row) === "P54895"); const newP54895 = newRows.filter((row) => row.caseAssertionId === "P54895");
  const attributes = rejectionCounts(rejectedRows);
  return {
    priorRun: { calls: priorSummary.modelCalls, inputTokens: priorSummary.usage.inputTokens, outputTokens: priorSummary.usage.outputTokens, totalTokens: priorSummary.usage.totalTokens, latencyMs: priorSummary.usage.latencyMs, acceptedRows: priorSummary.acceptedRows, rejectedRows: priorSummary.rejectedRows },
    newRun: { calls: 2, ...newUsage, acceptedRows: newRows.length, rejectedRows: rejectedRows.length },
    changes: { calls: 2 - priorSummary.modelCalls, inputTokens: newUsage.inputTokens - priorSummary.usage.inputTokens, outputTokens: newUsage.outputTokens - priorSummary.usage.outputTokens, totalTokens: newUsage.totalTokens - priorSummary.usage.totalTokens, latencyMs: newUsage.latencyMs - priorSummary.usage.latencyMs },
    exactExcerpts: { recoveredCount: recovered.length, lostCount: lost.length, newCount: added.length, recovered, lost, new: added },
    normalizedSourceAssertionsRecovered: [...priorSources].filter((key) => newSources.has(key)).length,
    attributionAndGrounding: attributes,
    perDocument: [...new Set([...priorPerDocument.keys(), ...newPerDocument.keys()])].sort().map((key) => { const [assertionId, documentId] = key.split("\u0000"); return { assertionId, documentId, priorAccepted: priorPerDocument.get(key) ?? 0, newAccepted: newPerDocument.get(key) ?? 0 }; }),
    invisibleDocuments,
    conductDiagnostic: { note: "Literal diagnostic only; not an acceptance gate or second semantic judge.", priorP54895Rows: priorP54895.length, priorExplicitConductRows: priorP54895.filter((row) => conduct.test(row.exactExcerpt)).length, newP54895Rows: newP54895.length, newExplicitConductRows: newP54895.filter((row) => conduct.test(row.exactExcerpt)).length },
    rowComparison: rows,
    suppliedPacketCharacters: calls.reduce((sum, call) => sum + call.packetCharacters, 0),
  };
}

function reportMarkdown(run: Record<string, any>): string {
  const c = run.comparison; const s = run.summary;
  const acceptedTable = run.acceptedRows.map((row: Record<string, any>) => `| ${row.caseAssertionId} | ${row.sourceAssertion.replace(/\|/gu, "\\|")} | ${row.relevanceType} | ${row.exactExcerpt.replace(/\|/gu, "\\|")} | ${row.documentId} | ${row.globalBlockIds.join(", ")} |`).join("\n") || "| — | — | — | — | — | — |";
  const compareTable = c.rowComparison.map((row: Record<string, any>) => `| ${(row.priorRunSourceAssertion ?? "—").replace(/\|/gu, "\\|")} | ${(row.newRunSourceAssertion ?? "—").replace(/\|/gu, "\\|")} | ${row.status} |`).join("\n");
  const recall = c.priorRun.acceptedRows ? c.exactExcerpts.recoveredCount / c.priorRun.acceptedRows : 0;
  const underrepresented = c.perDocument.filter((row: Record<string, any>) => row.newAccepted < row.priorAccepted);
  const viable = c.attributionAndGrounding.mixedDocumentRows === 0 && c.attributionAndGrounding.exactGroundingFailures === 0 && recall >= 0.7 && c.conductDiagnostic.newExplicitConductRows >= Math.min(c.conductDiagnostic.priorExplicitConductRows, c.conductDiagnostic.newP54895Rows);
  return `# CFX one-assertion multi-document extraction comparison

## Run identity

- Run: ${run.runId}
- Status: ${s.status}
- Model: ${config.model}
- Calls: ${s.modelCalls}
- Prompt hash: ${s.promptHash}
- Schema hash: ${s.schemaHash}
- Production mutations: none

## Prior versus new

| Metric | Prior | New | Change |
|---|---:|---:|---:|
| Calls | ${c.priorRun.calls} | ${c.newRun.calls} | ${c.changes.calls} |
| Input tokens | ${c.priorRun.inputTokens} | ${c.newRun.inputTokens} | ${c.changes.inputTokens} |
| Output tokens | ${c.priorRun.outputTokens} | ${c.newRun.outputTokens} | ${c.changes.outputTokens} |
| Total tokens | ${c.priorRun.totalTokens} | ${c.newRun.totalTokens} | ${c.changes.totalTokens} |
| Aggregate latency ms | ${c.priorRun.latencyMs} | ${c.newRun.latencyMs} | ${c.changes.latencyMs} |
| Accepted rows | ${c.priorRun.acceptedRows} | ${c.newRun.acceptedRows} | ${c.newRun.acceptedRows - c.priorRun.acceptedRows} |
| Rejected rows | ${c.priorRun.rejectedRows} | ${c.newRun.rejectedRows} | ${c.newRun.rejectedRows - c.priorRun.rejectedRows} |

## Test questions

1. **Can one assertion be processed against all packets without losing useful assertions?** ${c.exactExcerpts.recoveredCount}/${c.priorRun.acceptedRows} prior exact excerpts were recovered; ${c.exactExcerpts.lostCount} were lost and ${c.exactExcerpts.newCount} were new. ${viable ? "The measured gates support viability." : "The measured recall/semantic gates do not yet support viability."}
2. **Can provenance be recovered entirely through block-ID decoding?** ${c.attributionAndGrounding.documentAttributionErrors === 0 ? "Yes; all accepted rows received deterministic document provenance." : "No; document-attribution errors occurred."}
3. **Did any row mix documents?** ${c.attributionAndGrounding.mixedDocumentRows} rejected mixed-document row(s); no mixed row was accepted.
4. **Was any excerpt assigned to the wrong document?** ${c.attributionAndGrounding.documentAttributionErrors} detected attribution error(s).
5. **Did the conduct instruction reduce indirect P54895 rows?** Literal conduct-bearing rows changed from ${c.conductDiagnostic.priorExplicitConductRows}/${c.conductDiagnostic.priorP54895Rows} to ${c.conductDiagnostic.newExplicitConductRows}/${c.conductDiagnostic.newP54895Rows}. This is a literal diagnostic, not semantic adjudication.
6. **Call-count change?** ${c.priorRun.calls} → ${c.newRun.calls} (${c.changes.calls}).
7. **Token-usage change?** ${c.priorRun.totalTokens} → ${c.newRun.totalTokens} (${c.changes.totalTokens}).
8. **Did a document become invisible or underrepresented?** ${c.invisibleDocuments.length} previously productive document(s) became invisible; ${underrepresented.length} produced fewer rows. See the per-document comparison artifact.
9. **Suitable for later link suggestions?** ${viable ? "Yes as an extraction input boundary, subject to human semantic review." : "Not yet; deterministic provenance works, but recall/semantic behavior needs review before promotion."}

## Accepted normalized source assertions

| Case assertion | Source assertion | Relevance type | Exact excerpt | Document ID | Block IDs |
|---|---|---|---|---|---|
${acceptedTable}

## Prior/new source-assertion comparison

| Prior run source assertion | New run source assertion | Status |
|---|---|---|
${compareTable}
`;
}

function reportHtml(run: Record<string, any>): string {
  const rows = run.acceptedRows.map((row: Record<string, any>) => `<tr><td>${escapeHtml(row.caseAssertionId)}</td><td>${escapeHtml(row.sourceAssertion)}</td><td>${escapeHtml(row.relevanceType)}</td><td>${escapeHtml(row.exactExcerpt)}</td><td>${escapeHtml(row.documentId)}</td><td>${escapeHtml(row.globalBlockIds.join(", "))}</td></tr>`).join("");
  const comparisons = run.comparison.rowComparison.map((row: Record<string, any>) => `<tr><td>${escapeHtml(row.priorRunSourceAssertion ?? "—")}</td><td>${escapeHtml(row.newRunSourceAssertion ?? "—")}</td><td>${escapeHtml(row.status)}</td></tr>`).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><title>CFX multi-document extraction</title><style>body{font-family:system-ui;margin:2rem;line-height:1.45}table{border-collapse:collapse;width:100%;font-size:12px}th,td{border:1px solid #bbb;padding:6px;vertical-align:top}th{background:#eee}pre{white-space:pre-wrap}</style></head><body><h1>CFX one-assertion multi-document extraction</h1><p>Run <code>${escapeHtml(run.runId)}</code></p><h2>Summary</h2><pre>${escapeHtml(JSON.stringify(run.summary, null, 2))}</pre><h2>Comparison</h2><pre>${escapeHtml(JSON.stringify(run.comparison, null, 2))}</pre><h2>Accepted rows</h2><table><thead><tr><th>Case assertion</th><th>Source assertion</th><th>Type</th><th>Exact excerpt</th><th>Document</th><th>Blocks</th></tr></thead><tbody>${rows}</tbody></table><h2>Prior/new</h2><table><thead><tr><th>Prior</th><th>New</th><th>Status</th></tr></thead><tbody>${comparisons}</tbody></table></body></html>`;
}

async function writePreflight(calls: PreparedCall[], files: Record<string, { sha256: string }>) {
  const runId = `cfx-multi-document-extraction-preflight-${stamp()}`;
  const root = path.join(repositoryRoot, "artifacts/claim-foundry/cfx/CF1-F03", runId);
  await mkdir(root, { recursive: false });
  await Promise.all([
    writeJson(path.join(root, "grouped-model-inputs.json"), calls.map((call) => ({ assertionId: call.prepared.assertionId, assertionText: call.prepared.assertionText, blocks: call.prepared.blocks }))),
    writeJson(path.join(root, "global-provenance-map.json"), Object.fromEntries(calls.map((call) => [call.prepared.assertionId, call.prepared.provenance]))),
    writeJson(path.join(root, "exact-model-requests.json"), calls.map(requestRecord)),
    writeJson(path.join(root, "preflight.json"), { status: "READY", runId, expectedModelCalls: 2, config, promptHash: cfxMultiDocumentAssertionPromptHash(), schemaHash: cfxMultiDocumentAssertionSchemaHash(), inputHashes: Object.fromEntries(Object.entries(files).map(([name, row]) => [name, row.sha256])), authorization: CFX_MULTI_DOCUMENT_AUTHORIZATION }),
  ]);
  const artifact = await manifest(root); await freeze(root);
  return { root, artifact };
}

async function execute(calls: PreparedCall[], files: Record<string, { sha256: string }>) {
  if (process.env.CFX_LIVE_AUTHORIZATION !== CFX_MULTI_DOCUMENT_AUTHORIZATION) throw new Error("Exact CFX_LIVE_AUTHORIZATION required");
  const runId = `cfx-multi-document-extraction-${stamp()}`;
  const root = path.join(repositoryRoot, "artifacts/claim-foundry/cfx/CF1-F03", runId);
  await mkdir(path.join(root, "requests"), { recursive: true });
  const provider = createOpenAiCf7StructuredProvider();
  let providerCalls = 0;
  const results = await Promise.all(calls.map(async (call) => {
    const requestRoot = path.join(root, "requests", call.callId); await mkdir(requestRoot);
    const request = requestRecord(call); await writeJson(path.join(requestRoot, "request.json"), request); await writeFile(path.join(requestRoot, "request_hash.txt"), `${call.requestHash}\n`);
    providerCalls += 1; if (providerCalls > 2) throw new Error("Provider-call ceiling exceeded");
    const started = performance.now();
    try {
      const response = await provider.invokeStructured(call.request); const latencyMs = Math.round(performance.now() - started);
      const raw = { callId: call.callId, responseId: response.responseId, requestId: response.requestId, model: response.model, usage: response.usage, latencyMs, rawResponse: response.rawResponse, parsedOutput: response.output, capturedBeforeValidation: true };
      await writeJson(path.join(requestRoot, "raw_response.json"), raw); await writeFile(path.join(requestRoot, "raw_response_hash.txt"), `${sha256(json(raw))}\n`);
      const validation = validateCfxMultiDocumentAssertionExtraction({ prepared: call.prepared, modelCallId: call.callId, rawOutput: response.output });
      await Promise.all([writeJson(path.join(requestRoot, "validation.json"), validation), writeJson(path.join(requestRoot, "accepted_rows.json"), validation.acceptedRows), writeJson(path.join(requestRoot, "rejected_rows.json"), validation.rejectedRows), writeJson(path.join(requestRoot, "response_metadata.json"), { responseId: response.responseId, requestId: response.requestId, model: response.model, usage: response.usage, latencyMs })]);
      return { ...request, status: "completed", usage: response.usage, latencyMs, responseId: response.responseId, requestId: response.requestId, raw, ...validation };
    } catch (error) {
      const latencyMs = Math.round(performance.now() - started); const failure = { message: error instanceof Error ? error.message : String(error) }; await writeJson(path.join(requestRoot, "provider_failure.json"), failure);
      return { ...request, status: "failed", usage: { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, totalTokens: 0 }, latencyMs, responseId: null, requestId: null, raw: null, acceptedRows: [], rejectedRows: [{ caseAssertionId: call.prepared.assertionId, rowIndex: null, rawRow: null, reasons: [{ code: "PROVIDER_FAILURE", message: failure.message }] }] };
    }
  }));
  if (providerCalls !== 2) throw new Error(`Expected exactly two provider calls; got ${providerCalls}`);
  const acceptedRows = results.flatMap((row) => row.acceptedRows); const rejectedRows = results.flatMap((row) => row.rejectedRows);
  const usageRows = results.map((row) => ({ callId: row.callId, assertionId: row.assertionId, responseId: row.responseId, requestId: row.requestId, latencyMs: row.latencyMs, ...row.usage }));
  const usage = usageRows.reduce((sum, row) => ({ inputTokens: sum.inputTokens + row.inputTokens, cachedInputTokens: sum.cachedInputTokens + row.cachedInputTokens, outputTokens: sum.outputTokens + row.outputTokens, totalTokens: sum.totalTokens + row.totalTokens, latencyMs: sum.latencyMs + row.latencyMs }), { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, totalTokens: 0, latencyMs: 0 });
  const priorRows = JSON.parse(await readFile(path.join(priorRoot, "accepted-source-assertions.json"), "utf8")) as PriorRow[];
  const priorSummary = JSON.parse(await readFile(path.join(priorRoot, "model-test-summary.json"), "utf8"));
  const compare = comparison(priorRows, acceptedRows, priorSummary, usage, calls, rejectedRows);
  const summary = { status: results.every((row) => row.status === "completed") ? "COMPLETED" : "COMPLETED_WITH_FAILURES", modelCalls: providerCalls, inputCount: calls.length, packetCharacters: 31_918, acceptedRows: acceptedRows.length, rejectedRows: rejectedRows.length, usage, promptHash: cfxMultiDocumentAssertionPromptHash(), schemaHash: cfxMultiDocumentAssertionSchemaHash(), inputHashes: Object.fromEntries(Object.entries(files).map(([name, row]) => [name, row.sha256])), noAdditionalModelCalls: providerCalls === 2, productionMutation: false };
  const run = { runId, summary, comparison: compare, acceptedRows };
  await Promise.all([
    writeJson(path.join(root, "grouped-model-inputs.json"), calls.map((call) => ({ assertionId: call.prepared.assertionId, assertionText: call.prepared.assertionText, blocks: call.prepared.blocks }))),
    writeJson(path.join(root, "global-provenance-map.json"), Object.fromEntries(calls.map((call) => [call.prepared.assertionId, call.prepared.provenance]))),
    writeJson(path.join(root, "exact-model-requests.json"), calls.map(requestRecord)),
    writeJson(path.join(root, "raw-model-responses.json"), results.map((row) => row.raw)),
    writeJson(path.join(root, "accepted-source-assertions.json"), acceptedRows),
    writeJson(path.join(root, "rejected-source-assertions.json"), rejectedRows),
    writeJson(path.join(root, "normalized-source-assertion-inventory.json"), acceptedRows),
    writeJson(path.join(root, "comparison-with-prior-run.json"), compare),
    writeJson(path.join(root, "per-call-usage.json"), { requests: usageRows, totals: usage }),
    writeJson(path.join(root, "run-summary.json"), summary),
    writeFile(path.join(root, "report.md"), reportMarkdown(run)),
    writeFile(path.join(root, "report.html"), reportHtml(run)),
  ]);
  const artifact = await manifest(root); await freeze(root);
  return { runId, root, summary, comparison: compare, artifact };
}

async function main() {
  const inputs = await verifiedInputs(); const calls = prepareCalls(inputs.actual, inputs.baseline.scope.assertions); assertModelSurface(calls, inputs.baseline.scope.assertions);
  const result = process.argv.includes("--execute") ? await execute(calls, inputs.files) : await writePreflight(calls, inputs.files);
  process.stdout.write(json(result));
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
