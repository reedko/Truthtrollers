import "dotenv/config";
import { createHash } from "node:crypto";
import { chmod, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildCfxSingleAssertionPacketRequest,
  cfxSingleAssertionPacketPromptHash,
  cfxSingleAssertionPacketSchemaHash,
  normalizeCfxExactExcerpt,
  validateCfxSingleAssertionPacketExtraction,
  type CfxPacketExtractionInput,
  type CfxRetrievedPacket,
} from "../experiments/singleAssertionPacketExtraction/extraction.js";
import { createOpenAiCf7StructuredProvider } from "../../shared/provider/index.js";

const currentFile = fileURLToPath(import.meta.url);
const backendRoot = path.resolve(path.dirname(currentFile), "../../../..");
const repositoryRoot = path.resolve(backendRoot, "..");
const inputRoot = path.join(repositoryRoot,
  "artifacts/claim-foundry/cfx/CF1-F03/cfx-assertion-relative-block-baseline-20260802");
const priorExtractionPath = path.join(repositoryRoot,
  "artifacts/claim-foundry/cfx/CF1-F03/cfx-ranked-minimal-extraction-20260802061510/accepted-extraction-rows.json");

const config = Object.freeze({
  model: "gpt-4o-mini",
  temperature: 0.1,
  concurrency: 4,
  retryCount: 0,
  maxOutputTokens: 8_000,
  timeoutMs: 180_000,
  store: false,
  expectedModelCalls: 9,
});

export const CFX_SINGLE_ASSERTION_PACKET_AUTHORIZATION = "Authorized: Send the 9 byte-verified nonempty CF1-F03 assertion-document packet inputs from the frozen cfx-assertion-relative-block-baseline-20260802 artifact to OpenAI through exactly 9 independent Chat Completions API requests for one governed CFX single-assertion packet-extraction test, with each request containing exactly one case assertion, one document ID, and only its selected packet text and packet/source-block identifiers, using the byte-stable governed prompts, gpt-4o-mini, temperature 0.1, concurrency 4, strict cfx_single_assertion_packet_extraction_v1 structured output, an 8,000-token output limit per request, a 180,000 ms timeout, zero retries, and store false; preserve every request, raw response, accepted row, rejected row, grounding offset, usage record, report, and hash; do not send full documents, other assertions, retrieval diagnostics, aliases, expected answers, or evaluator materials; do not make repair, bearing, source-quality, legacy semantic, production-mutation, or any additional model calls.";

const expectedHashes = Object.freeze({
  "actual_outputs.json": "e2dedc05a477a5123e30ec0ac27692182292886c67acc074471ef573aced7059",
  "baseline_input.json": "96d27c96df49e4e0becb18ad1d99ead90ff70b61e6d3fc06761c3b90c5b60f52",
  "comparison.json": "b28ed864bbc3b475e5dbe5ade32d7a8773653c764647a952f8dcf80b42be7579",
  "cache_determinism_verification.json": "0649f40eaf6e6c327fbe8326268ebcb038b86da8f1eaa8f2fb2553d244580719",
});

type ActualOutput = {
  assertionId: string;
  documentId: string;
  selectedPackets: Array<CfxRetrievedPacket & Record<string, unknown>>;
  diagnostics: { documentCharacterCount: number } & Record<string, unknown>;
};

type PriorRow = {
  documentId: string;
  targetAssertionId: string;
  exactExcerpt: string;
  relation: string;
  reason: string;
};

type PreparedCall = {
  callIndex: number;
  callId: string;
  submitted: CfxPacketExtractionInput;
  packetCharacterCount: number;
  fullDocumentCharacterCount: number;
  estimatedPacketTokens: number;
  request: ReturnType<typeof buildCfxSingleAssertionPacketRequest>;
  requestHash: string;
};

const sha256 = (value: string | Uint8Array): string => createHash("sha256").update(value).digest("hex");
const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;
const stamp = (): string => new Date().toISOString().replace(/[-:TZ.]/gu, "").slice(0, 14);
const escapeHtml = (value: unknown): string => String(value ?? "").replace(/&/gu, "&amp;")
  .replace(/</gu, "&lt;").replace(/>/gu, "&gt;").replace(/"/gu, "&quot;");

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, json(value));
}

async function readVerifiedInputs() {
  const entries = await Promise.all(Object.entries(expectedHashes).map(async ([name, expectedSha256]) => {
    const bytes = await readFile(path.join(inputRoot, name));
    const actualSha256 = sha256(bytes);
    if (actualSha256 !== expectedSha256) {
      throw new Error(`${name} changed: expected ${expectedSha256}, received ${actualSha256}`);
    }
    return [name, { bytes, sha256: actualSha256 }] as const;
  }));
  const files = Object.fromEntries(entries);
  return {
    files,
    actualOutputs: JSON.parse(files["actual_outputs.json"].bytes.toString("utf8")) as ActualOutput[],
    baseline: JSON.parse(files["baseline_input.json"].bytes.toString("utf8")) as {
      scope: { assertions: Record<string, { text: string }> };
    },
  };
}

function projectPacket(packet: CfxRetrievedPacket & Record<string, unknown>): CfxRetrievedPacket {
  return {
    packetId: packet.packetId,
    blockIds: [...packet.blockIds],
    charStart: packet.charStart,
    charEnd: packet.charEnd,
    text: packet.text,
  };
}

function prepareCalls(actualOutputs: ActualOutput[], assertions: Record<string, { text: string }>): PreparedCall[] {
  const rows = actualOutputs.filter((row) => row.selectedPackets.length > 0);
  if (rows.length !== config.expectedModelCalls) {
    throw new Error(`Expected exactly ${config.expectedModelCalls} nonempty inputs; got ${rows.length}`);
  }
  return rows.map((row, index) => {
    const assertionText = assertions[row.assertionId]?.text;
    if (!assertionText) throw new Error(`Missing assertion text for ${row.assertionId}`);
    const submitted: CfxPacketExtractionInput = {
      assertionId: row.assertionId,
      assertionText,
      documentId: row.documentId,
      selectedPackets: row.selectedPackets.map(projectPacket),
    };
    const request = buildCfxSingleAssertionPacketRequest({ ...submitted, ...config });
    const packetCharacterCount = submitted.selectedPackets.reduce((sum, packet) => sum + packet.text.length, 0);
    return {
      callIndex: index,
      callId: `request-${String(index + 1).padStart(3, "0")}`,
      submitted,
      packetCharacterCount,
      fullDocumentCharacterCount: Number(row.diagnostics.documentCharacterCount),
      estimatedPacketTokens: Math.ceil(packetCharacterCount / 4),
      request,
      requestHash: sha256(json(request)),
    };
  });
}

function assertCleanModelSurface(calls: PreparedCall[], assertions: Record<string, { text: string }>): void {
  const forbiddenLabels = [
    "combinedScore", "scoreComponents", "matchedTerms", "matchedEntities", "matchedPredicates",
    "matchedAliases", "satisfiedConceptGroups", "seedWindowIds", "neighborWindowIds", "queryIntent",
    "expectedStance", "expansion_terms",
  ];
  for (const call of calls) {
    for (const label of forbiddenLabels) {
      if (call.request.user.includes(label)) throw new Error(`${call.callId} leaked forbidden ${label}`);
    }
    for (const [assertionId, assertion] of Object.entries(assertions)) {
      if (assertionId === call.submitted.assertionId) continue;
      if (call.request.user.includes(assertion.text)) {
        throw new Error(`${call.callId} leaked assertion ${assertionId}`);
      }
    }
    const packetText = call.submitted.selectedPackets.map((packet) => packet.text).join("");
    if (packetText.length !== call.packetCharacterCount) throw new Error(`${call.callId} packet projection changed`);
  }
}

async function artifactManifest(root: string): Promise<{ files: unknown[]; aggregateSha256: string }> {
  async function walk(directory: string, prefix = ""): Promise<Array<{ path: string; bytes: number; sha256: string }>> {
    const output: Array<{ path: string; bytes: number; sha256: string }> = [];
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (relative === "artifact-manifest.json") continue;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) output.push(...await walk(absolute, relative));
      else if (entry.isFile()) {
        const bytes = await readFile(absolute);
        output.push({ path: relative, bytes: bytes.length, sha256: sha256(bytes) });
      }
    }
    return output.sort((left, right) => left.path.localeCompare(right.path));
  }
  const files = await walk(root);
  const manifest = { files, aggregateSha256: sha256(json(files)) };
  await writeJson(path.join(root, "artifact-manifest.json"), manifest);
  return manifest;
}

async function freezeTree(directory: string): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) await freezeTree(target);
    else if (entry.isFile()) await chmod(target, 0o444);
  }
}

function publicRequest(call: PreparedCall) {
  return {
    callId: call.callId,
    assertionId: call.submitted.assertionId,
    assertionText: call.submitted.assertionText,
    documentId: call.submitted.documentId,
    packetCount: call.submitted.selectedPackets.length,
    suppliedCharacters: call.packetCharacterCount,
    estimatedSuppliedTokens: call.estimatedPacketTokens,
    requestHash: call.requestHash,
    request: call.request,
  };
}

async function writePreflight(calls: PreparedCall[], inputFiles: Record<string, { sha256: string }>) {
  const runId = `cfx-single-assertion-packet-extraction-preflight-${stamp()}`;
  const root = path.join(repositoryRoot, "artifacts/claim-foundry/cfx/CF1-F03", runId);
  await mkdir(root, { recursive: false });
  const summary = {
    status: "AWAITING_LIVE_AUTHORIZATION",
    runId,
    inputRoot: path.relative(repositoryRoot, inputRoot),
    inputHashes: Object.fromEntries(Object.entries(inputFiles).map(([name, value]) => [name, value.sha256])),
    nonemptyAssertionDocumentInputs: calls.length,
    emptyInputsSkippedWithoutModelCall: 16 - calls.length,
    expectedModelCalls: calls.length,
    totalPacketCharacters: calls.reduce((sum, call) => sum + call.packetCharacterCount, 0),
    modelConfiguration: config,
    promptHash: cfxSingleAssertionPacketPromptHash(),
    schemaHash: cfxSingleAssertionPacketSchemaHash(),
    contaminationScan: "PASS",
    deterministicRetrievalChanged: false,
    productionMutation: false,
    authorizationRequired: CFX_SINGLE_ASSERTION_PACKET_AUTHORIZATION,
  };
  await Promise.all([
    writeJson(path.join(root, "preflight-summary.json"), summary),
    writeJson(path.join(root, "exact-model-requests.json"), calls.map(publicRequest)),
    writeFile(path.join(root, "authorization-required.txt"), `${CFX_SINGLE_ASSERTION_PACKET_AUTHORIZATION}\n`),
  ]);
  const manifest = await artifactManifest(root);
  await freezeTree(root);
  return { root, summary, manifest };
}

function compareWithPrior(
  calls: PreparedCall[],
  priorRows: PriorRow[],
  acceptedRows: Array<Record<string, unknown>>,
) {
  const callKeys = new Set(calls.map((call) => `${call.submitted.assertionId}\u0000${call.submitted.documentId}`));
  const relevantPriorRows = priorRows.filter((row) =>
    callKeys.has(`${row.targetAssertionId}\u0000${row.documentId}`));
  const details = relevantPriorRows.map((prior) => {
    const call = calls.find((item) => item.submitted.assertionId === prior.targetAssertionId
      && item.submitted.documentId === prior.documentId)!;
    const presentInRetrievedPacket = call.submitted.selectedPackets.some((packet) =>
      packet.text.includes(prior.exactExcerpt));
    const normalizedPrior = normalizeCfxExactExcerpt(prior.exactExcerpt);
    const recoveredExactly = acceptedRows.some((row) =>
      row.assertionId === prior.targetAssertionId && row.documentId === prior.documentId
      && row.normalizedExcerpt === normalizedPrior);
    const recoveredByLiteralContainment = acceptedRows.some((row) => {
      if (row.assertionId !== prior.targetAssertionId || row.documentId !== prior.documentId) return false;
      const normalizedNew = String(row.normalizedExcerpt);
      return normalizedNew.includes(normalizedPrior) || normalizedPrior.includes(normalizedNew);
    });
    return { ...prior, presentInRetrievedPacket, recoveredExactly, recoveredByLiteralContainment };
  });
  return {
    note: "Prior same-target full-document outputs are a comparison proxy, not a semantic gold key.",
    priorSameTargetRowCount: details.length,
    presentInRetrievedPackets: details.filter((row) => row.presentInRetrievedPacket).length,
    recoveredExactly: details.filter((row) => row.recoveredExactly).length,
    recoveredByLiteralContainment: details.filter((row) => row.recoveredByLiteralContainment).length,
    missedByRetrieval: details.filter((row) => !row.presentInRetrievedPacket),
    presentButNotRecovered: details.filter((row) => row.presentInRetrievedPacket && !row.recoveredByLiteralContainment),
    rows: details,
  };
}

function markdownReport(report: Record<string, any>): string {
  const calls = report.calls.map((call: Record<string, any>) => {
    const accepted = call.acceptedRows.length === 0 ? "- None" : call.acceptedRows.map((row: Record<string, any>) => [
      `- **${row.relevanceType}** — ${row.sourceAssertion}`,
      `  - Exact excerpt: “${row.exactExcerpt}”`,
      `  - Reason: ${row.reason}`,
      `  - Grounding: ${row.packetIds.join(", ")} / ${row.blockIds.join(", ")}; document ${row.grounding.documentCharStart}–${row.grounding.documentCharEnd}`,
    ].join("\n")).join("\n");
    return `## ${call.callId}: ${call.assertionId} × ${call.documentId}

**Case assertion:** ${call.assertionText}

- Packets: ${call.packetCount}
- Supplied characters: ${call.suppliedCharacters}
- Estimated supplied tokens: ${call.estimatedSuppliedTokens}
- Provider status: ${call.providerStatus}
- Usage: ${call.usage.inputTokens} input / ${call.usage.outputTokens} output / ${call.usage.totalTokens} total
- Latency: ${call.latencyMs} ms
- Accepted: ${call.acceptedRows.length}
- Rejected: ${call.rejectedRows.length}

### Extracted source assertions

${accepted}

### Rejected rows

\`\`\`json
${JSON.stringify(call.rejectedRows, null, 2)}
\`\`\`
`;
  }).join("\n");
  const q = report.comparisonAnswers;
  return `# CFX single-assertion packet extraction test

## Run identity

- Run: ${report.runId}
- Status: ${report.summary.status}
- Model calls: ${report.summary.modelCalls}
- Model: ${report.config.model}
- Prompt hash: ${report.summary.promptHash}
- Schema hash: ${report.summary.schemaHash}
- Production mutations: none

## Aggregate

| Metric | Value |
|---|---:|
| Nonempty assertion-document inputs | ${report.summary.nonemptyInputs} |
| Model calls | ${report.summary.modelCalls} |
| Packet characters | ${report.summary.totalPacketCharacters} |
| Full-document characters represented | ${report.summary.totalFullDocumentCharacters} |
| Character reduction | ${(report.summary.characterReduction * 100).toFixed(1)}% |
| Model input tokens | ${report.summary.usage.inputTokens} |
| Model output tokens | ${report.summary.usage.outputTokens} |
| Total model tokens | ${report.summary.usage.totalTokens} |
| Accepted source assertions | ${report.summary.acceptedRows} |
| Rejected rows | ${report.summary.rejectedRows} |
| Zero-result calls | ${report.summary.zeroResultCalls.length} |

Token reduction versus hypothetical single-assertion full-document calls is estimated from the measured retained-character ratio: **${(report.summary.characterReduction * 100).toFixed(1)}%**, approximately **${report.summary.estimatedFullDocumentTokens - report.summary.estimatedPacketTokens} input-content tokens avoided**. This is explicitly an estimate, not provider-reported counterfactual usage.

## Comparison answers

1. **Did retrieval preserve passages needed for useful extraction?** ${q.retrievalPreservation}
2. **Did the prompt avoid cross-target nonsense?** ${q.crossTarget}
3. **Did it extract multiple opposing assertions from the whistleblower packet?** ${q.whistleblowerOpposition}
4. **Which previously visible assertions were present but missed?** ${q.presentButMissed}
5. **Which outputs were merely topical?** ${q.topicalOutputs}
6. **How many tokens were saved?** ${q.tokensSaved}
7. **Primary remaining failure class?** ${q.failureClass}

The comparison uses earlier same-target full-document rows only as an objective visibility proxy. It does not treat those model outputs as gold. No second semantic model or host semantic rejection was added.

${calls}`;
}

function htmlReport(report: Record<string, any>): string {
  const callSections = report.calls.map((call: Record<string, any>) => `<details open><summary><code>${escapeHtml(call.callId)}</code> — ${escapeHtml(call.assertionId)} × ${escapeHtml(call.documentId)}</summary><p><strong>${escapeHtml(call.assertionText)}</strong></p><p>${call.packetCount} packet(s), ${call.suppliedCharacters} characters; ${call.usage.inputTokens} input + ${call.usage.outputTokens} output tokens; ${call.latencyMs} ms.</p><table><thead><tr><th>Type</th><th>Source assertion</th><th>Exact excerpt</th><th>Reason</th><th>Grounding</th></tr></thead><tbody>${call.acceptedRows.map((row: Record<string, any>) => `<tr><td>${escapeHtml(row.relevanceType)}</td><td>${escapeHtml(row.sourceAssertion)}</td><td>${escapeHtml(row.exactExcerpt)}</td><td>${escapeHtml(row.reason)}</td><td>${escapeHtml(row.packetIds.join(", "))}<br>${escapeHtml(row.blockIds.join(", "))}<br>${row.grounding.documentCharStart}–${row.grounding.documentCharEnd}</td></tr>`).join("") || "<tr><td colspan=\"5\">Zero assertions</td></tr>"}</tbody></table>${call.rejectedRows.length ? `<h4>Rejected</h4><pre>${escapeHtml(JSON.stringify(call.rejectedRows, null, 2))}</pre>` : ""}</details>`).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><title>CFX single-assertion packet extraction</title><style>body{font-family:system-ui;line-height:1.45;margin:2rem;max-width:1500px}table{border-collapse:collapse;width:100%;font-size:12px}th,td{border:1px solid #bbb;padding:6px;vertical-align:top}th{background:#eee}details{border:1px solid #bbb;padding:.7rem;margin:1rem 0}pre{white-space:pre-wrap}</style></head><body><h1>CFX single-assertion packet extraction</h1><p>Run <code>${escapeHtml(report.runId)}</code></p><h2>Aggregate</h2><pre>${escapeHtml(JSON.stringify(report.summary, null, 2))}</pre><h2>Comparison answers</h2><ol>${Object.values(report.comparisonAnswers).map((answer) => `<li>${escapeHtml(answer)}</li>`).join("")}</ol><h2>Calls</h2>${callSections}</body></html>`;
}

async function runLive(calls: PreparedCall[], inputFiles: Record<string, { sha256: string }>) {
  if (process.env.CFX_LIVE_AUTHORIZATION !== CFX_SINGLE_ASSERTION_PACKET_AUTHORIZATION) {
    throw new Error("Exact CFX_LIVE_AUTHORIZATION is required for --execute");
  }
  const runId = `cfx-single-assertion-packet-extraction-${stamp()}`;
  const root = path.join(repositoryRoot, "artifacts/claim-foundry/cfx/CF1-F03", runId);
  await mkdir(path.join(root, "requests"), { recursive: true });
  const provider = createOpenAiCf7StructuredProvider();
  const results: Array<Record<string, any>> = Array(calls.length);
  let cursor = 0;
  let providerCalls = 0;
  await Promise.all(Array.from({ length: Math.min(config.concurrency, calls.length) }, async () => {
    while (cursor < calls.length) {
      const index = cursor;
      cursor += 1;
      const call = calls[index];
      const requestRoot = path.join(root, "requests", call.callId);
      await mkdir(requestRoot, { recursive: false });
      const requestRecord = publicRequest(call);
      await writeJson(path.join(requestRoot, "request.json"), requestRecord);
      await writeFile(path.join(requestRoot, "request_hash.txt"), `${call.requestHash}\n`);
      providerCalls += 1;
      if (providerCalls > config.expectedModelCalls) throw new Error("Provider-call ceiling exceeded");
      const started = performance.now();
      try {
        const response = await provider.invokeStructured(call.request);
        const latencyMs = Math.round(performance.now() - started);
        const rawRecord = {
          callId: call.callId,
          responseId: response.responseId,
          requestId: response.requestId,
          model: response.model,
          usage: response.usage,
          latencyMs,
          rawResponse: response.rawResponse,
          parsedOutput: response.output,
          capturedBeforeValidation: true,
        };
        await writeJson(path.join(requestRoot, "raw_response.json"), rawRecord);
        await writeFile(path.join(requestRoot, "raw_response_hash.txt"), `${sha256(json(rawRecord))}\n`);
        await writeJson(path.join(requestRoot, "response_metadata.json"), {
          responseId: response.responseId,
          requestId: response.requestId,
          model: response.model,
          usage: response.usage,
          latencyMs,
        });
        const validation = validateCfxSingleAssertionPacketExtraction({
          submitted: call.submitted,
          rawOutput: response.output,
        });
        await Promise.all([
          writeJson(path.join(requestRoot, "validation.json"), validation),
          writeJson(path.join(requestRoot, "accepted_rows.json"), validation.acceptedRows),
          writeJson(path.join(requestRoot, "rejected_rows.json"), validation.rejectedRows),
        ]);
        results[index] = {
          ...requestRecord,
          providerStatus: "completed",
          responseId: response.responseId,
          requestId: response.requestId,
          usage: response.usage,
          latencyMs,
          rawResponse: rawRecord,
          acceptedRows: validation.acceptedRows,
          rejectedRows: validation.rejectedRows,
        };
      } catch (error) {
        const latencyMs = Math.round(performance.now() - started);
        const failure = { name: error instanceof Error ? error.name : "Error", message: error instanceof Error ? error.message : String(error) };
        await writeJson(path.join(requestRoot, "provider_failure.json"), failure);
        results[index] = {
          ...requestRecord,
          providerStatus: "failed",
          responseId: null,
          requestId: null,
          usage: { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, totalTokens: 0 },
          latencyMs,
          rawResponse: null,
          acceptedRows: [],
          rejectedRows: [{ assertionId: call.submitted.assertionId, documentId: call.submitted.documentId, rowIndex: null, rawRow: null, reasons: [{ code: "PROVIDER_FAILURE", message: failure.message }] }],
        };
      }
    }
  }));
  if (providerCalls !== config.expectedModelCalls) {
    throw new Error(`Provider-call invariant failed: expected ${config.expectedModelCalls}, got ${providerCalls}`);
  }

  const acceptedRows = results.flatMap((result) => result.acceptedRows);
  const rejectedRows = results.flatMap((result) => result.rejectedRows);
  const usageRows = results.map((result) => ({
    callId: result.callId,
    assertionId: result.assertionId,
    documentId: result.documentId,
    responseId: result.responseId,
    requestId: result.requestId,
    latencyMs: result.latencyMs,
    ...result.usage,
  }));
  const usage = usageRows.reduce((sum, row) => ({
    inputTokens: sum.inputTokens + row.inputTokens,
    cachedInputTokens: sum.cachedInputTokens + row.cachedInputTokens,
    outputTokens: sum.outputTokens + row.outputTokens,
    totalTokens: sum.totalTokens + row.totalTokens,
    latencyMs: sum.latencyMs + row.latencyMs,
  }), { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, totalTokens: 0, latencyMs: 0 });
  const priorRows = JSON.parse(await readFile(priorExtractionPath, "utf8")) as PriorRow[];
  const priorComparison = compareWithPrior(calls, priorRows, acceptedRows);
  const packetChars = calls.reduce((sum, call) => sum + call.packetCharacterCount, 0);
  const fullChars = calls.reduce((sum, call) => sum + call.fullDocumentCharacterCount, 0);
  const whistleblowerRows = acceptedRows.filter((row) => row.assertionId === "P54895"
    && row.documentId === "DOC-543bc0ef88817a66db53");
  const whistleblowerTypes = new Set(whistleblowerRows.map((row) => row.relevanceType));
  const summary = {
    status: results.every((result) => result.providerStatus === "completed") ? "COMPLETED" : "COMPLETED_WITH_PROVIDER_FAILURES",
    nonemptyInputs: calls.length,
    modelCalls: providerCalls,
    totalPacketCharacters: packetChars,
    totalFullDocumentCharacters: fullChars,
    characterReduction: 1 - packetChars / fullChars,
    estimatedPacketTokens: Math.ceil(packetChars / 4),
    estimatedFullDocumentTokens: Math.ceil(fullChars / 4),
    usage,
    acceptedRows: acceptedRows.length,
    rejectedRows: rejectedRows.length,
    zeroResultCalls: results.filter((result) => result.providerStatus === "completed" && result.acceptedRows.length === 0).map((result) => result.callId),
    assertionsPerCall: results.map((result) => ({ callId: result.callId, count: result.acceptedRows.length })),
    promptHash: cfxSingleAssertionPacketPromptHash(),
    schemaHash: cfxSingleAssertionPacketSchemaHash(),
    inputHashes: Object.fromEntries(Object.entries(inputFiles).map(([name, value]) => [name, value.sha256])),
    noAdditionalModelCalls: providerCalls === 9,
    productionMutation: false,
  };
  const comparisonAnswers = {
    retrievalPreservation: `${priorComparison.presentInRetrievedPackets}/${priorComparison.priorSameTargetRowCount} prior same-target full-document excerpts were literally present in the retrieved packets; ${priorComparison.recoveredByLiteralContainment}/${priorComparison.presentInRetrievedPackets} present excerpts were recovered exactly or by literal containment.`,
    crossTarget: `Yes structurally: every request exposed one assertion only, every response envelope was checked against it, and ${rejectedRows.filter((row) => row.reasons?.some((reason: Record<string, unknown>) => reason.code === "INVALID_RESPONSE_ENVELOPE")).length} cross-target/mismatched envelopes were rejected.`,
    whistleblowerOpposition: whistleblowerTypes.has("contradicts") && (whistleblowerTypes.has("reports_allegation") || whistleblowerTypes.has("affirms"))
      ? `Yes. ${whistleblowerRows.length} grounded rows included both allegation/affirmation and contradiction labels.`
      : `Not fully: ${whistleblowerRows.length} grounded rows produced relevance types ${[...whistleblowerTypes].join(", ") || "none"}.`,
    presentButMissed: priorComparison.presentButNotRecovered.length === 0
      ? "None among the prior same-target full-document proxy excerpts that were literally present in packets."
      : `${priorComparison.presentButNotRecovered.length} proxy excerpt(s); see prior-comparison.json for exact text and document IDs.`,
    topicalOutputs: "Not auto-adjudicated: the test deliberately adds no second semantic judge. Every accepted row is literal-grounded and displayed for direct human review; relevanceType/reason were not used as rejection gates.",
    tokensSaved: `Approximately ${Math.ceil(fullChars / 4) - Math.ceil(packetChars / 4)} input-content tokens (${((1 - packetChars / fullChars) * 100).toFixed(1)}%) versus sending each complete document for each single-assertion call. This is a character-ratio estimate, not counterfactual provider usage.`,
    failureClass: `${priorComparison.missedByRetrieval.length} prior proxy rows were omitted by retrieval; ${priorComparison.presentButNotRecovered.length} were present but not recovered; ${rejectedRows.length} output rows failed deterministic grounding/schema validation. False semantic relevance remains a human-review category because no second semantic call or host semantic rule was authorized.`,
  };
  const report = { runId, config, summary, comparisonAnswers, priorComparison, calls: results.map(({ rawResponse: _raw, request: _request, ...result }) => result) };
  const md = markdownReport(report);
  await Promise.all([
    writeJson(path.join(root, "exact-model-requests.json"), calls.map(publicRequest)),
    writeJson(path.join(root, "raw-model-responses.json"), results.map((result) => result.rawResponse)),
    writeJson(path.join(root, "accepted-source-assertions.json"), acceptedRows),
    writeJson(path.join(root, "rejected-source-assertions.json"), rejectedRows),
    writeJson(path.join(root, "per-call-usage.json"), { requests: usageRows, totals: usage }),
    writeJson(path.join(root, "model-test-summary.json"), summary),
    writeJson(path.join(root, "prior-comparison.json"), priorComparison),
    writeFile(path.join(root, "model-test-report.md"), md),
    writeFile(path.join(root, "report.html"), htmlReport(report)),
  ]);
  const manifest = await artifactManifest(root);
  await freezeTree(root);
  return { root, runId, summary, manifest };
}

async function main(): Promise<void> {
  const execute = process.argv.includes("--execute");
  const inputs = await readVerifiedInputs();
  const calls = prepareCalls(inputs.actualOutputs, inputs.baseline.scope.assertions);
  assertCleanModelSurface(calls, inputs.baseline.scope.assertions);
  if (!execute) {
    const result = await writePreflight(calls, inputs.files);
    process.stdout.write(json({ ...result, authorization: CFX_SINGLE_ASSERTION_PACKET_AUTHORIZATION }));
    return;
  }
  const result = await runLive(calls, inputs.files);
  process.stdout.write(json(result));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
