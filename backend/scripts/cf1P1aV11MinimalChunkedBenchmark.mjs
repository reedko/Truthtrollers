#!/usr/bin/env node
// Benchmark only: four non-overlapping local extraction calls, followed by
// deterministic exact deduplication and topic-neutral balanced selection.
import dotenv from "dotenv";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

dotenv.config();
process.env.OPENAI_API_KEY ||= process.env.REACT_APP_OPENAI_API_KEY;

const here = path.dirname(fileURLToPath(import.meta.url));
const backend = path.resolve(here, "..");
const repoRoot = path.resolve(backend, "..");

const { prepareArticle } = await import(
  "../test/claim-foundry/prompt-benchmark/generationRun.js");
const { createCf1ModelRunner } = await import("../src/claim-foundry/modelRunner.js");
const { createOpenAiStreamingCf1Transport } = await import(
  "../test/claim-foundry/prompt-benchmark/openAiStreamingTransport.js");
const { detectSplitAtomicRepairSignals } = await import(
  "../src/claim-foundry/splitAtomicRepair.js");
const { buildP1aV7Chunks } = await import(
  "../test/claim-foundry/prompt-benchmark/p1aV7Chunking.js");
const { mergeP1aV7Assertions, articleRegionCounts } = await import(
  "../test/claim-foundry/prompt-benchmark/p1aV7Merge.js");
const { selectBalancedCandidatesV2 } = await import(
  "../test/claim-foundry/prompt-benchmark/balancedCandidateSelectorV2.js");
const { P1A_V11_MINIMAL_CHUNKED_ASSERTIONS, buildP1aV11MinimalChunkPrompt,
  normalizeAndVerifyP1aV11ChunkOutput } = await import(
  "../test/claim-foundry/prompt-benchmark/promptSets/p1aV11MinimalChunkedAssertions.js");

const sha = (value) => createHash("sha256").update(String(value ?? "")).digest("hex");
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[character]);
const csv = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;

function parseArgs(argv) {
  const options = { fixture: "CF1-F03", model: "gpt-4o-mini", seed: 3724605090,
    chunks: 4, maximum: 16, timeoutMs: 180_000, maxOutputTokens: 12_000,
    out: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--fixture") options.fixture = argv[++index];
    else if (arg === "--model") options.model = argv[++index];
    else if (arg === "--seed") options.seed = Number(argv[++index]);
    else if (arg === "--chunks") options.chunks = Number(argv[++index]);
    else if (arg === "--maximum") options.maximum = Number(argv[++index]);
    else if (arg === "--timeout-ms") options.timeoutMs = Number(argv[++index]);
    else if (arg === "--max-output-tokens") options.maxOutputTokens = Number(argv[++index]);
    else if (arg === "--out") options.out = argv[++index];
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function promptHashes(prompt) {
  return { systemSha256: sha(prompt.system), userSha256: sha(prompt.user),
    schemaSha256: sha(JSON.stringify(prompt.responseSchema)),
    assembledSha256: sha(`${prompt.system}\n${prompt.user}\n${JSON.stringify(prompt.responseSchema)}`) };
}

function analyzeAssertions(assertions, sourceUnits) {
  const sourceUnitsById = new Map(sourceUnits.map((unit) => [unit.unitId, unit]));
  const unitOrder = new Map(sourceUnits.map((unit, index) => [unit.unitId, index]));
  return assertions.map((assertion, index) => {
    const positions = (assertion.sourceUnitIds ?? []).map((id) => unitOrder.get(id))
      .filter(Number.isInteger);
    const first = positions.length ? Math.min(...positions) : null;
    const quarter = first === null ? "unresolved"
      : `Q${Math.min(4, Math.floor((first / sourceUnits.length) * 4) + 1)}`;
    const groundingText = (assertion.sourceUnitIds ?? []).map((id) =>
      `[${id}] ${sourceUnitsById.get(id)?.text ?? "[missing unit]"}`).join("\n");
    const signals = detectSplitAtomicRepairSignals({ claim: {
      ...assertion, claimText: assertion.claimText ?? assertion.assertionText,
    }, sourceUnitsById }).signals;
    return { ...assertion, index: index + 1, quarter, groundingText, signals };
  });
}

function totalUsage(chunkCalls) {
  return chunkCalls.reduce((total, item) => ({
    inputTokens: total.inputTokens + (item.call.usage?.inputTokens ?? 0),
    outputTokens: total.outputTokens + (item.call.usage?.outputTokens ?? 0),
    totalTokens: total.totalTokens + (item.call.usage?.totalTokens ?? 0),
    cachedInputTokens: total.cachedInputTokens + (item.call.usage?.cachedInputTokens ?? 0),
  }), { inputTokens: 0, outputTokens: 0, totalTokens: 0, cachedInputTokens: 0 });
}

function selectionMaps(selection) {
  const selectedByText = new Map(selection.selected.map((item) =>
    [item.claimText, { selected: true, reason: item.reason, score: item.score,
      region: item.region }]));
  for (const item of selection.deferred) selectedByText.set(item.claimText,
    { selected: false, reason: item.reason, score: null, region: null });
  return selectedByText;
}

function assertionsTable(assertions, selection, sourceUnits) {
  const decisions = selectionMaps(selection);
  const sourceOrder = new Map(sourceUnits.map((unit, index) => [unit.unitId, index]));
  return assertions.map((item) => {
    const decision = decisions.get(item.claimText) ?? { selected: false,
      reason: "not_evaluated", score: null };
    const rowId = `claim-${item.index}`;
    const first = Math.min(...(item.sourceUnitIds ?? []).map((id) =>
      sourceOrder.get(id) ?? Number.MAX_SAFE_INTEGER));
    return `<tr class="claim-row ${decision.selected ? "selected" : ""}" data-detail="${rowId}">
      <td>${item.index}</td><td>${decision.selected ? "✓" : ""}</td>
      <td>${esc(item.claimText)}</td><td>${esc(item.quarter)}</td>
      <td>${esc((item.sourceUnitIds ?? []).join(", "))}</td>
      <td>${esc((item.sourceChunkIds ?? [item.chunkId]).filter(Boolean).join(", "))}</td>
      <td>${decision.score ?? "—"}</td><td>${esc(decision.reason)}</td>
      <td>${esc(item.signals.join(", ") || "none")}</td></tr>
      <tr class="detail-row" id="${rowId}"><td colspan="9"><div class="detail">
      <p><b>First source-unit order:</b> ${Number.isFinite(first) ? first + 1 : "unresolved"}
      · <b>Source candidates before exact deduplication:</b>
      ${esc((item.sourceCandidateIds ?? [item.candidateId]).join(", "))}</p>
      <h4>Grounding text</h4><pre>${esc(item.groundingText)}</pre>
      <details><summary>Raw merged item</summary><pre>${esc(JSON.stringify(item, null, 2))}</pre></details>
      </div></td></tr>`;
  }).join("\n");
}

function chunkTable(chunkCalls) {
  return chunkCalls.map(({ chunk, assertions, call }) => `<details>
    <summary>${esc(chunk.chunkId)} · ${assertions.length} assertions ·
    ${esc(chunk.firstUnitId)}–${esc(chunk.lastUnitId)} ·
    ${call.usage.totalTokens} tokens · ${(call.elapsedMs / 1000).toFixed(1)}s</summary>
    <table><thead><tr><th>#</th><th>Assertion</th><th>Units</th><th>Signals</th></tr></thead>
    <tbody>${assertions.map((item) => `<tr><td>${item.index}</td>
    <td>${esc(item.claimText)}</td><td>${esc(item.sourceUnitIds.join(", "))}</td>
    <td>${esc(item.signals.join(", ") || "none")}</td></tr>`).join("\n")}</tbody></table>
    </details>`).join("\n");
}

function renderReport({ options, article, structuralBlocks, sourceUnits, chunks, chunkCalls,
  merged, assertions, selection, usage, wallMs, rawRegions, selectedRegions, prompts }) {
  const atomicFlags = assertions.filter((item) =>
    item.signals.includes("possible_multiple_assertions")).length;
  const planRows = chunks.map((chunk) => `<tr><td>${esc(chunk.chunkId)}</td>
    <td>${esc(chunk.firstUnitId)}–${esc(chunk.lastUnitId)}</td>
    <td>${chunk.ownedUnitIds.length}</td><td>${chunk.ownedBlockIds.length}</td>
    <td>${chunk.estimatedArticleTokens}</td><td>none</td></tr>`).join("\n");
  const promptSections = Object.entries(prompts).map(([chunkId, record]) => `<details>
    <summary>${esc(chunkId)} exact assembled prompt, schema, and fingerprints</summary>
    <h3>System</h3><pre>${esc(record.prompt.system)}</pre>
    <h3>User</h3><pre>${esc(record.prompt.user)}</pre>
    <h3>Schema</h3><pre>${esc(JSON.stringify(record.prompt.responseSchema, null, 2))}</pre>
    <h3>Fingerprints</h3><pre>${esc(JSON.stringify(record.hashes, null, 2))}</pre>
    </details>`).join("\n");
  const provenance = chunkCalls.map(({ chunk, call }) => ({ chunkId: chunk.chunkId,
    fingerprint: call.fingerprint, provider: call.provider, usage: call.usage,
    elapsedMs: call.elapsedMs, streaming: call.streaming }));
  return `<!doctype html><html><head><meta charset="utf-8">
    <title>P1aV11 minimal chunked benchmark</title>
    <style>body{font:14px system-ui;margin:24px;color:#18212b}section{margin:32px 0;border-top:4px solid #34495e;padding-top:12px}table{border-collapse:collapse;width:100%;margin:12px 0}th,td{border:1px solid #c8ced4;padding:7px;text-align:left;vertical-align:top}th{background:#edf1f4;position:sticky;top:0}.selected{background:#e8f6e8}.claim-row:hover{background:#f0f5ff;cursor:pointer}.detail-row{display:none}.detail{border-left:4px solid #486a9a;padding:4px 14px;background:#f8faff}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f5f6f7;padding:10px}.note{background:#fff8d9;border:1px solid #e1cf72;padding:10px}summary{cursor:pointer;font-weight:650}.metrics{font-size:16px}</style></head><body>
    <h1>${esc(options.fixture)} · ${esc(P1A_V11_MINIMAL_CHUNKED_ASSERTIONS)}</h1>
    <p class="metrics">Four parallel ${esc(options.model)} Chat Completions calls · seed ${options.seed} ·
    ${merged.summary.rawCount} raw · ${assertions.length} exact-unique ·
    ${selection.selectedClaims.length} selected · ${usage.totalTokens} total tokens ·
    ${(wallMs / 1000).toFixed(1)}s wall time.</p>
    <p class="note">This arm has no orientation, thesis, pillars, materiality, attribution, stance,
    or census intervention. Each source unit belongs to exactly one prompt. Selection is deterministic,
    topic-neutral, and shown separately from extraction. Atomicity flags are diagnostics, not verdicts.</p>
    <section><h2>Outcome summary</h2><table><thead><tr><th>Raw by chunk</th>
    <th>Exact duplicates collapsed</th><th>Atomicity warnings</th><th>Raw Q1/Q2/Q3/Q4</th>
    <th>Selected Q1/Q2/Q3/Q4</th><th>Selected average score</th>
    <th>Input/output tokens</th></tr></thead><tbody><tr>
    <td>${esc(chunkCalls.map((item) => item.assertions.length).join(" / "))}</td>
    <td>${merged.summary.collapsedExactDuplicates}</td><td>${atomicFlags}</td>
    <td>${esc(Object.values(rawRegions).join(" / "))}</td>
    <td>${esc(Object.values(selectedRegions).join(" / "))}</td>
    <td>${selection.diagnostics.averageScore.toFixed(2)}</td>
    <td>${usage.inputTokens} / ${usage.outputTokens}</td></tr></tbody></table></section>
    <section><h2>Deterministic chunk plan</h2><p>All ${sourceUnits.length} source units and
    ${structuralBlocks.length} structural blocks have exactly one owner. There is no overlap or
    boundary context.</p><table><thead><tr><th>Chunk</th><th>Owned range</th><th>Units</th>
    <th>Blocks</th><th>Estimated article tokens</th><th>Overlap</th></tr></thead>
    <tbody>${planRows}</tbody></table></section>
    <section><h2>Merged inventory · click a row for grounding</h2><p>✓ marks the deterministic
    shortlist. Deferred rows remain visible, with the host's reason.</p><table><thead><tr><th>#</th>
    <th>Selected</th><th>Assertion</th><th>Quarter</th><th>Units</th><th>Chunk</th>
    <th>Score</th><th>Decision</th><th>Atomicity signals</th></tr></thead>
    <tbody>${assertionsTable(assertions, selection, sourceUnits)}</tbody></table></section>
    <section><h2>Raw model output by chunk</h2>${chunkTable(chunkCalls)}</section>
    <section><h2>Exact duplicate groups</h2><pre>${esc(JSON.stringify(merged.duplicateGroups, null, 2))}</pre></section>
    <section><h2>Exact prompts and reproducibility</h2>${promptSections}
    <h3>Provider records</h3><pre>${esc(JSON.stringify(provenance, null, 2))}</pre></section>
    <script>document.querySelectorAll('.claim-row').forEach((row)=>row.addEventListener('click',()=>{const detail=document.getElementById(row.dataset.detail);detail.style.display=detail.style.display==='table-row'?'none':'table-row';}));</script>
    </body></html>`;
}

async function invokeChunk({ prompt, chunk, options }) {
  const events = [];
  const runner = createCf1ModelRunner({ transport: createOpenAiStreamingCf1Transport({
    fieldName: "assertionText", repetitionThreshold: 3,
    onClaim: (event) => events.push(event),
  }) });
  const startedAt = Date.now();
  const response = await runner.invokeStructured({ ...prompt, model: options.model,
    temperature: 0, seed: options.seed, timeoutMs: options.timeoutMs,
    maximumAttempts: 1, maxOutputTokens: options.maxOutputTokens,
    usageContext: { component: "claim_foundry", path: "p1a_v11_minimal_chunked",
      stage: chunk.chunkId } });
  return { output: response.output, usage: response.usage,
    elapsedMs: Date.now() - startedAt, events,
    fingerprint: promptHashes(prompt),
    provider: { responseId: response.rawResponse?.id ?? null,
      systemFingerprint: response.rawResponse?.system_fingerprint ?? null,
      requestId: response.rawResponse?.request_id ?? null,
      model: response.rawResponse?.model ?? response.model,
      finishReason: response.rawResponse?.choices?.[0]?.finish_reason ?? null },
    streaming: response.rawResponse?.streamingDiagnostics ?? null };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is required");
  const fixturePath = path.join(backend, "test/claim-foundry/fixtures", options.fixture,
    "article.json");
  const raw = JSON.parse(readFileSync(fixturePath, "utf8"));
  const { article, structuralBlocks, articleDocument } = prepareArticle(raw.article ?? raw);
  const sourceUnits = articleDocument.sourceUnits;
  const chunks = buildP1aV7Chunks({ structuralBlocks, sourceUnits,
    chunkCount: options.chunks, contextUnits: 0 }).map((chunk, index) => ({
      ...chunk, chunkId: `P1aV11-C${String(index + 1).padStart(2, "0")}`,
    }));
  const generatedAt = new Date().toISOString();
  const stamp = generatedAt.replace(/[-:T.]/g, "").slice(0, 14)
    .replace(/(\d{8})(\d{6})/, "$1-$2");
  const outDir = path.resolve(options.out ?? path.join(repoRoot,
    "artifacts/claim-foundry/p1a-v11-minimal-chunked",
    `${options.fixture.toLowerCase()}-${stamp}`));
  mkdirSync(path.join(outDir, "prompts"), { recursive: true });

  const prompts = Object.fromEntries(chunks.map((chunk) => {
    const prompt = buildP1aV11MinimalChunkPrompt({ article, chunk, sourceUnits });
    return [chunk.chunkId, { prompt, hashes: promptHashes(prompt) }];
  }));
  console.log(`${P1A_V11_MINIMAL_CHUNKED_ASSERTIONS} · four parallel calls …`);
  const wallStartedAt = Date.now();
  const chunkCalls = await Promise.all(chunks.map(async (chunk) => {
    const call = await invokeChunk({ prompt: prompts[chunk.chunkId].prompt, chunk, options });
    const assertions = normalizeAndVerifyP1aV11ChunkOutput({ output: call.output, chunk });
    const analyzed = analyzeAssertions(assertions, sourceUnits);
    console.log(`  ${chunk.chunkId} · ${analyzed.length} assertions · ${call.usage.totalTokens} tokens · ${(call.elapsedMs / 1000).toFixed(1)}s`);
    return { chunk, call, assertions: analyzed };
  }));
  const wallMs = Date.now() - wallStartedAt;
  const rawAssertions = chunkCalls.flatMap((item) => item.assertions);
  const merged = mergeP1aV7Assertions(rawAssertions);
  const assertions = analyzeAssertions(merged.mergedAssertions, sourceUnits);
  const selection = selectBalancedCandidatesV2({ candidateClaims: assertions,
    sourceUnits, maximum: options.maximum });
  const usage = totalUsage(chunkCalls);
  const rawRegions = articleRegionCounts(assertions, sourceUnits);
  const selectedRegions = articleRegionCounts(selection.selectedClaims, sourceUnits);

  const artifact = { label: P1A_V11_MINIMAL_CHUNKED_ASSERTIONS,
    fixture: options.fixture, generatedAt, options, article: { title: article.title,
      contentHash: article.contentHash, structuralBlockCount: structuralBlocks.length,
      sourceUnitCount: sourceUnits.length }, wallMs, usage,
    chunkPlan: chunks.map(({ blocks, ...chunk }) => ({ ...chunk, blockCount: blocks.length })),
    chunkCalls: chunkCalls.map(({ chunk, call, assertions: chunkAssertions }) => ({
      chunk: { ...chunk, blocks: undefined }, call, assertions: chunkAssertions })),
    merge: { ...merged, mergedAssertions: assertions }, selection,
    diagnostics: { rawRegions, selectedRegions,
      atomicityWarningCount: assertions.filter((item) =>
        item.signals.includes("possible_multiple_assertions")).length } };
  writeFileSync(path.join(outDir, "results.json"), JSON.stringify(artifact, null, 2));
  for (const [chunkId, record] of Object.entries(prompts)) {
    writeFileSync(path.join(outDir, "prompts", `${chunkId}.json`),
      JSON.stringify(record, null, 2));
  }
  const decisions = selectionMaps(selection);
  const headings = ["index", "selected", "selectionReason", "score", "assertionText",
    "sourceUnitIds", "quarter", "sourceChunkIds", "atomicitySignals", "groundingText"];
  const rows = assertions.map((item) => {
    const decision = decisions.get(item.claimText) ?? {};
    return [item.index, Boolean(decision.selected), decision.reason ?? "not_evaluated",
      decision.score ?? "", item.claimText, item.sourceUnitIds.join(";"), item.quarter,
      (item.sourceChunkIds ?? [item.chunkId]).filter(Boolean).join(";"),
      item.signals.join(";"), item.groundingText].map(csv).join(",");
  });
  writeFileSync(path.join(outDir, "claims.csv"),
    `${headings.map(csv).join(",")}\n${rows.join("\n")}\n`);
  const html = renderReport({ options, article, structuralBlocks, sourceUnits, chunks,
    chunkCalls, merged, assertions, selection, usage, wallMs, rawRegions,
    selectedRegions, prompts });
  writeFileSync(path.join(outDir, "report.html"), html);
  console.log(`Merged · ${rawAssertions.length} raw · ${assertions.length} exact-unique · ${selection.selectedClaims.length} selected`);
  console.log(`Regions raw ${Object.values(rawRegions).join("/")} · selected ${Object.values(selectedRegions).join("/")}`);
  console.log(`Report: ${path.join(outDir, "report.html")}`);
  console.log(`CSV: ${path.join(outDir, "claims.csv")}`);
}

main().catch((error) => { console.error(error); process.exit(1); });
