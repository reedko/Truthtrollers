// Benchmark-only comparison: byte-identical P1aV4 whole-article extraction versus
// P1aV7-O orientation followed by four parallel P1aV7-C assertion chunks.
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

const { prepareArticle } = await import("../test/claim-foundry/prompt-benchmark/generationRun.js");
const { createCf1ModelRunner } = await import("../src/claim-foundry/modelRunner.js");
const { createOpenAiStreamingCf1Transport } = await import(
  "../test/claim-foundry/prompt-benchmark/openAiStreamingTransport.js");
const { collectAttributionSurface } = await import(
  "../src/claim-foundry/attributionSurfaceCensus.js");
const { buildSplitCensusDiagnostic } = await import(
  "../src/claim-foundry/splitCensusDiagnostic.js");
const { detectSplitAtomicRepairSignals } = await import(
  "../src/claim-foundry/splitAtomicRepair.js");
const { selectBalancedCandidatesV1 } = await import(
  "../test/claim-foundry/prompt-benchmark/balancedCandidateSelectorV1.js");
const { buildP1aV4AssertionPrompt } = await import(
  "../test/claim-foundry/prompt-benchmark/promptSets/p1aV4Assertion.js");
const { normalizeP1aVariantOutput } = await import(
  "../test/claim-foundry/prompt-benchmark/promptSets/p1aVariantSchema.js");
const { buildP1aV7Chunks, buildP1aV7OrientationPacket } = await import(
  "../test/claim-foundry/prompt-benchmark/p1aV7Chunking.js");
const { buildP1aV7OrientationPrompt, verifyP1aV7Orientation } = await import(
  "../test/claim-foundry/prompt-benchmark/promptSets/p1aV7Orientation.js");
const { buildP1aV7ChunkPrompt, normalizeAndVerifyP1aV7ChunkOutput } = await import(
  "../test/claim-foundry/prompt-benchmark/promptSets/p1aV7ChunkAssertion.js");
const { mergeP1aV7Assertions, orientationConsistencyDiagnostic, articleRegionCounts }
  = await import("../test/claim-foundry/prompt-benchmark/p1aV7Merge.js");

const sha = (value) => createHash("sha256").update(String(value ?? "")).digest("hex");
const esc = (value) => String(value ?? "").replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
const csv = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
const promptFingerprint = (prompt) => ({ systemSha256: sha(prompt.system),
  userSha256: sha(prompt.user), schemaSha256: sha(JSON.stringify(prompt.responseSchema)),
  fullSha256: sha(`${prompt.system}\n${prompt.user}\n${JSON.stringify(prompt.responseSchema)}`) });
const usageTotal = (usage) => usage?.totalTokens ?? usage?.total_tokens ?? 0;

function parseArgs(argv) {
  const options = { fixture: "CF1-F03", model: "gpt-4o-mini", seed: 3724605090,
    maximum: 16, chunks: 4, contextUnits: 2, timeoutMs: 180_000 };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--fixture") options.fixture = argv[++index];
    else if (arg === "--model") options.model = argv[++index];
    else if (arg === "--seed") options.seed = Number(argv[++index]);
    else if (arg === "--maximum") options.maximum = Number(argv[++index]);
    else if (arg === "--chunks") options.chunks = Number(argv[++index]);
    else if (arg === "--context-units") options.contextUnits = Number(argv[++index]);
    else if (arg === "--timeout-ms") options.timeoutMs = Number(argv[++index]);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function analyzeAssertions(assertions, sourceUnits) {
  const sourceUnitsById = new Map(sourceUnits.map((unit) => [unit.unitId, unit]));
  return assertions.map((assertion, index) => ({ index: index + 1, ...assertion,
    signals: detectSplitAtomicRepairSignals({ claim: {
      ...assertion, claimText: assertion.claimText ?? assertion.assertionText },
    sourceUnitsById }).signals }));
}

async function invoke({ prompt, label, model, seed, timeoutMs, fieldName, onItem }) {
  const events = [];
  const runner = createCf1ModelRunner({ transport: createOpenAiStreamingCf1Transport({
    fieldName, repetitionThreshold: 3,
    onClaim: (event) => { events.push(event); onItem?.(event); },
  }) });
  const startedAt = Date.now();
  const response = await runner.invokeStructured({ ...prompt, model, temperature: 0, seed,
    timeoutMs, maximumAttempts: 1, maxOutputTokens: 12_000,
    usageContext: { component: "claim_foundry", path: "benchmark", stage: label } });
  return { output: response.output, usage: response.usage, events,
    elapsedMs: Date.now() - startedAt, fingerprint: promptFingerprint(prompt),
    provider: { responseId: response.rawResponse?.id ?? null,
      systemFingerprint: response.rawResponse?.system_fingerprint ?? null,
      model: response.rawResponse?.model ?? response.model }, prompt };
}

function selectedTable(assertions, selectedClaims) {
  const selected = new Set(selectedClaims.map((claim) => claim.claimText));
  return assertions.map((item) => `<tr class="${selected.has(item.claimText) ? "selected" : ""}">
<td>${item.index ?? ""}</td><td>${selected.has(item.claimText) ? "✓" : ""}</td>
<td>${esc(item.claimText)}</td><td>${esc((item.sourceUnitIds ?? []).join(", "))}</td>
<td>${esc(item.chunkId ?? item.sourceChunkIds?.join(", ") ?? "whole article")}</td>
<td>${esc(item.materiality ?? "—")}</td><td>${esc((item.relatedPillarLabels ?? []).join("; "))}</td>
<td>${esc((item.signals ?? []).join(", ") || "none")}</td></tr>`).join("\n");
}

function orientationHtml(orientation) {
  return `<dl><dt>Theme</dt><dd>${esc(orientation.theme.text)} <small>${esc(orientation.theme.sourceUnitIds.join(", "))}</small></dd>
<dt>Thesis</dt><dd>${esc(orientation.thesis.text)} <small>${esc(orientation.thesis.sourceUnitIds.join(", "))}</small></dd>
<dt>Thesis hinge</dt><dd>${esc(orientation.thesisHinge)}</dd></dl>
<table><thead><tr><th>Pillar</th><th>Importance</th><th>Text</th><th>Units</th></tr></thead><tbody>
${orientation.pillars.map((pillar) => `<tr><td>${esc(pillar.label)}</td><td>${esc(pillar.importance)}</td><td>${esc(pillar.text)}</td><td>${esc(pillar.sourceUnitIds.join(", "))}</td></tr>`).join("\n")}</tbody></table>`;
}

function censusHtml(census) {
  return `<details><summary>Census diagnostic · ${census.summary.totalPackets} packets · ${census.summary.apparentMatchCount} apparent matches · ${census.summary.noObviousMatchCount} no obvious matches</summary>
<p>The census is diagnostic only. It neither created nor selected assertions and was not sent to a model.</p>
<table><thead><tr><th>ID</th><th>Structural block</th><th>Units</th><th>Trigger</th><th>Snippet</th><th>Assessment</th><th>Match</th></tr></thead><tbody>
${census.items.map((item) => `<tr><td>${esc(item.censusId)}</td><td>${esc(item.semanticChunkId)}</td><td>${esc(item.sourceUnitIds.join(", "))}</td><td>${esc(item.trigger)}</td><td>${esc(item.snippet)}</td><td>${esc(item.assessment)}</td><td>${esc(item.match?.claimText ?? "")}</td></tr>`).join("\n")}</tbody></table></details>`;
}

function writeArtifacts({ outDir, artifact, prompts, rows, html }) {
  mkdirSync(path.join(outDir, "prompts"), { recursive: true });
  writeFileSync(path.join(outDir, "results.json"), JSON.stringify(artifact, null, 2));
  for (const [name, prompt] of Object.entries(prompts)) {
    writeFileSync(path.join(outDir, "prompts", `${name}.json`), JSON.stringify(prompt, null, 2));
  }
  const headings = ["arm", "stage", "chunkId", "candidateId", "selected",
    "assertionText", "sourceUnitIds", "materiality", "relatedPillarLabels", "signals"];
  const csvText = [headings.map(csv).join(","), ...rows.map((row) => headings
    .map((heading) => csv(Array.isArray(row[heading]) ? row[heading].join("; ") : row[heading]))
    .join(","))].join("\n");
  writeFileSync(path.join(outDir, "assertions.csv"), `${csvText}\n`);
  writeFileSync(path.join(outDir, "report.html"), html);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is required");
  const fixturePath = path.join(backend, "test/claim-foundry/fixtures", options.fixture,
    "article.json");
  const raw = JSON.parse(readFileSync(fixturePath));
  const { article, structuralBlocks, articleDocument } = prepareArticle(raw.article ?? raw);
  const sourceUnits = articleDocument.sourceUnits;
  const chunks = buildP1aV7Chunks({ structuralBlocks, sourceUnits,
    chunkCount: options.chunks, contextUnits: options.contextUnits });
  const orientationPacket = buildP1aV7OrientationPacket({ article, chunks,
    structuralBlocks, sourceUnits });
  const timestamp = new Date().toISOString().replace(/[-:T.]/g, "").slice(0, 14)
    .replace(/(\d{8})(\d{6})/, "$1-$2");
  const outDir = path.join(repoRoot, "artifacts/claim-foundry/p1a-v7-chunked",
    `${options.fixture.toLowerCase()}-${timestamp}`);
  mkdirSync(outDir, { recursive: true });

  console.log("P1aV4-assertion comparator …");
  const v4Prompt = buildP1aV4AssertionPrompt({ article, structuralBlocks, sourceUnits });
  const v4Call = await invoke({ prompt: v4Prompt, label: "P1aV4-assertion",
    model: options.model, seed: options.seed, timeoutMs: options.timeoutMs,
    fieldName: "assertionText",
    onItem: (item) => console.log(`  V4 ${item.ordinal}: ${item.claimText.slice(0, 100)}`) });
  const v4Inventory = normalizeP1aVariantOutput(v4Call.output,
    { assertionTerminology: true });
  const v4Assertions = analyzeAssertions(v4Inventory.candidateClaims ?? [], sourceUnits);
  const v4Balanced = selectBalancedCandidatesV1({ candidateClaims: v4Assertions,
    sourceUnits, maximum: options.maximum });
  console.log(`  V4 completed · ${v4Assertions.length} raw · ${v4Balanced.selectedClaims.length} balanced`);

  console.log("P1aV7-O-orientation …");
  const orientationPrompt = buildP1aV7OrientationPrompt({ orientationPacket });
  const orientationCall = await invoke({ prompt: orientationPrompt,
    label: "P1aV7-O-orientation", model: options.model, seed: options.seed,
    timeoutMs: options.timeoutMs, fieldName: "assertionText" });
  const orientation = verifyP1aV7Orientation(orientationCall.output, orientationPacket);
  console.log(`  O completed · hinge ${orientation.thesisHinge} · ${orientation.pillars.length} pillars`);

  console.log("P1aV7-C chunks (parallel) …");
  const chunkCalls = await Promise.all(chunks.map(async (chunk) => {
    const prompt = buildP1aV7ChunkPrompt({ article, chunk, sourceUnits, orientation });
    const call = await invoke({ prompt, label: chunk.chunkId, model: options.model,
      seed: options.seed, timeoutMs: options.timeoutMs, fieldName: "assertionText",
      onItem: (item) => console.log(`  ${chunk.chunkId} ${item.ordinal}: ${item.claimText.slice(0, 86)}`) });
    const assertions = normalizeAndVerifyP1aV7ChunkOutput({ output: call.output,
      chunk, orientation });
    console.log(`  ${chunk.chunkId} completed · ${assertions.length} raw`);
    return { chunk, call, assertions: analyzeAssertions(assertions, sourceUnits) };
  }));

  const allChunkAssertions = chunkCalls.flatMap((entry) => entry.assertions);
  const merged = mergeP1aV7Assertions(allChunkAssertions);
  const mergedAnalyzed = analyzeAssertions(merged.mergedAssertions, sourceUnits);
  const v7Balanced = selectBalancedCandidatesV1({ candidateClaims: mergedAnalyzed,
    sourceUnits, maximum: options.maximum });
  const consistency = orientationConsistencyDiagnostic({ orientation,
    assertions: mergedAnalyzed });
  const census = buildSplitCensusDiagnostic({
    censusItems: collectAttributionSurface({ sourceUnits, structuralBlocks }),
    candidateClaims: mergedAnalyzed, structuralBlocks });
  const v4Census = buildSplitCensusDiagnostic({
    censusItems: collectAttributionSurface({ sourceUnits, structuralBlocks }),
    candidateClaims: v4Assertions, structuralBlocks });
  const v4Regions = { raw: articleRegionCounts(v4Assertions, sourceUnits),
    selected: articleRegionCounts(v4Balanced.selectedClaims, sourceUnits) };
  const v7Regions = { raw: articleRegionCounts(mergedAnalyzed, sourceUnits),
    selected: articleRegionCounts(v7Balanced.selectedClaims, sourceUnits) };
  const selectedV4 = new Set(v4Balanced.selectedClaims.map((item) => item.claimText));
  const selectedV7 = new Set(v7Balanced.selectedClaims.map((item) => item.claimText));

  const artifact = { fixture: options.fixture, generatedAt: new Date().toISOString(), options,
    article: { title: article.title, contentHash: article.contentHash,
      structuralBlockCount: structuralBlocks.length, sourceUnitCount: sourceUnits.length },
    chunkPlan: chunks.map(({ blocks, ...chunk }) => ({ ...chunk,
      blockCount: blocks.length })), orientationPacket, orientation,
    comparator: { label: "P1aV4-assertion", call: { ...v4Call, prompt: undefined },
      inventory: v4Inventory, assertions: v4Assertions, balanced: v4Balanced,
      regions: v4Regions, census: v4Census },
    v7: { label: "P1aV7-chunked", orientationCall: { ...orientationCall, prompt: undefined },
      chunkCalls: chunkCalls.map(({ chunk, call, assertions }) => ({
        chunk: { ...chunk, blocks: undefined }, call: { ...call, prompt: undefined }, assertions })),
      merge: { ...merged, mergedAssertions: mergedAnalyzed }, balanced: v7Balanced,
      regions: v7Regions, orientationConsistency: consistency, census },
  };
  const promptFiles = { "P1aV4-assertion": v4Prompt,
    "P1aV7-O-orientation": orientationPrompt,
    ...Object.fromEntries(chunkCalls.map((entry) =>
      [entry.chunk.chunkId, entry.call.prompt])) };
  const csvRows = [
    ...v4Assertions.map((item) => ({ arm: "P1aV4-assertion", stage: "whole_article",
      chunkId: "", candidateId: item.candidateId ?? `V4-${item.index}`,
      selected: selectedV4.has(item.claimText), assertionText: item.claimText,
      sourceUnitIds: item.sourceUnitIds, materiality: item.materiality,
      relatedPillarLabels: item.relatedPillarLabels, signals: item.signals })),
    ...mergedAnalyzed.map((item) => ({ arm: "P1aV7-chunked", stage: "merged",
      chunkId: item.sourceChunkIds, candidateId: item.candidateId,
      selected: selectedV7.has(item.claimText), assertionText: item.claimText,
      sourceUnitIds: item.sourceUnitIds, materiality: item.materiality,
      relatedPillarLabels: item.relatedPillarLabels, signals: item.signals })),
  ];
  const chunkPlanRows = chunks.map((chunk) => `<tr><td>${esc(chunk.chunkId)}</td><td>${esc(chunk.ownedBlockIds.join(", "))}</td><td>${esc(`${chunk.firstUnitId}–${chunk.lastUnitId}`)}</td><td>${chunk.ownedUnitIds.length}</td><td>${chunk.estimatedArticleTokens}</td><td>${esc(chunk.contextBeforeUnitIds.join(", "))}</td><td>${esc(chunk.contextAfterUnitIds.join(", "))}</td></tr>`).join("\n");
  const chunkSections = chunkCalls.map((entry) => `<details><summary>${esc(entry.chunk.chunkId)} · ${entry.assertions.length} assertions · ${esc(entry.chunk.firstUnitId)}–${esc(entry.chunk.lastUnitId)}</summary><table><thead><tr><th>#</th><th>Assertion</th><th>Units</th><th>Materiality</th><th>Pillars</th><th>Signals</th></tr></thead><tbody>${entry.assertions.map((item) => `<tr><td>${item.index}</td><td>${esc(item.claimText)}</td><td>${esc(item.sourceUnitIds.join(", "))}</td><td>${esc(item.materiality)}</td><td>${esc(item.relatedPillarLabels.join("; "))}</td><td>${esc(item.signals.join(", ") || "none")}</td></tr>`).join("\n")}</tbody></table></details>`).join("\n");
  const totalTokens = usageTotal(v4Call.usage) + usageTotal(orientationCall.usage)
    + chunkCalls.reduce((sum, item) => sum + usageTotal(item.call.usage), 0);
  const html = `<!doctype html><meta charset="utf-8"><title>P1aV7 chunked benchmark</title>
<style>body{font:14px system-ui;margin:24px;color:#202124}section{margin:32px 0}table{border-collapse:collapse;width:100%;margin:12px 0}th,td{border:1px solid #bbb;padding:7px;text-align:left;vertical-align:top}th{background:#eee}.selected{background:#eaf7e8}.metric{font-size:17px}pre{white-space:pre-wrap;background:#f6f6f6;padding:12px}dt{font-weight:700;margin-top:8px}small{color:#666}</style>
<h1>${esc(options.fixture)} · P1aV4 versus P1aV7 chunked</h1>
<p class="metric">Six model calls · ${esc(options.model)} · seed ${options.seed} · ${totalTokens} total tokens. V7-O completed before four parallel V7-C calls. No 1B or O-post call. Census is diagnostic only.</p>
<section><h2>Outcome summary</h2><table><thead><tr><th>Arm</th><th>Raw</th><th>Balanced</th><th>Raw quarters</th><th>Selected quarters</th><th>Atomicity warnings</th></tr></thead><tbody>
<tr><td>P1aV4-assertion</td><td>${v4Assertions.length}</td><td>${v4Balanced.selectedClaims.length}</td><td>${esc(Object.values(v4Regions.raw).join(" / "))}</td><td>${esc(Object.values(v4Regions.selected).join(" / "))}</td><td>${v4Assertions.filter((item) => item.signals.includes("possible_multiple_assertions")).length}</td></tr>
<tr><td>P1aV7-chunked</td><td>${mergedAnalyzed.length} (${allChunkAssertions.length} before exact deduplication)</td><td>${v7Balanced.selectedClaims.length}</td><td>${esc(Object.values(v7Regions.raw).join(" / "))}</td><td>${esc(Object.values(v7Regions.selected).join(" / "))}</td><td>${mergedAnalyzed.filter((item) => item.signals.includes("possible_multiple_assertions")).length}</td></tr></tbody></table></section>
<section><h2>Deterministic chunk plan</h2><p>All ${sourceUnits.length} units and ${structuralBlocks.length} structural blocks have exactly one owner. Boundary context cannot be cited.</p><table><thead><tr><th>Chunk</th><th>Owned blocks</th><th>Owned units</th><th>Unit count</th><th>Estimated article tokens</th><th>Context before</th><th>Context after</th></tr></thead><tbody>${chunkPlanRows}</tbody></table></section>
<section><h2>P1aV7-O orientation</h2>${orientationHtml(orientation)}<p>Pillar linkage after extraction: ${esc(JSON.stringify(consistency.pillarCounts))}. Unlinked assertions: ${consistency.unlinkedCount}. Uncovered pillars: ${esc(consistency.uncoveredPillars.join(", ") || "none")}.</p><details><summary>Orientation packet and prompt fingerprints</summary><pre>${esc(JSON.stringify(orientationPacket, null, 2))}</pre><pre>${esc(JSON.stringify(orientationCall.fingerprint, null, 2))}</pre></details></section>
<section><h2>V7 raw output by chunk</h2>${chunkSections}</section>
<section><h2>P1aV7 merged inventory · ✓ = balanced shortlist</h2><p>Collapsed ${merged.summary.collapsedExactDuplicates} exact normalized duplicates. Near-duplicates were preserved.</p><table><thead><tr><th>#</th><th>Balanced</th><th>Assertion</th><th>Units</th><th>Chunks</th><th>Materiality</th><th>Pillars</th><th>Signals</th></tr></thead><tbody>${selectedTable(mergedAnalyzed, v7Balanced.selectedClaims)}</tbody></table><details><summary>Exact duplicate groups</summary><pre>${esc(JSON.stringify(merged.duplicateGroups, null, 2))}</pre></details>${censusHtml(census)}</section>
<section><h2>P1aV4 whole-article comparator · ✓ = balanced shortlist</h2><table><thead><tr><th>#</th><th>Balanced</th><th>Assertion</th><th>Units</th><th>Input</th><th>Materiality</th><th>Pillars</th><th>Signals</th></tr></thead><tbody>${selectedTable(v4Assertions, v4Balanced.selectedClaims)}</tbody></table>${censusHtml(v4Census)}</section>
<section><h2>Reproducibility</h2><pre>${esc(JSON.stringify({ options,
    v4: { fingerprint: v4Call.fingerprint, provider: v4Call.provider, usage: v4Call.usage },
    orientation: { fingerprint: orientationCall.fingerprint, provider: orientationCall.provider,
      usage: orientationCall.usage }, chunks: chunkCalls.map((entry) => ({ chunkId: entry.chunk.chunkId,
      fingerprint: entry.call.fingerprint, provider: entry.call.provider, usage: entry.call.usage })) }, null, 2))}</pre></section>`;
  writeArtifacts({ outDir, artifact, prompts: promptFiles, rows: csvRows, html });
  console.log(`V7 merged · ${allChunkAssertions.length} raw · ${mergedAnalyzed.length} unique · ${v7Balanced.selectedClaims.length} balanced`);
  console.log(`Report: ${path.join(outDir, "report.html")}`);
  console.log(`CSV: ${path.join(outDir, "assertions.csv")}`);
}

main().catch((error) => { console.error(error); process.exit(1); });
