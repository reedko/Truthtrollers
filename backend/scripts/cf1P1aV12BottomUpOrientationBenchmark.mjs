#!/usr/bin/env node
// Benchmark only: one full-article bottom-up orientation call, followed by the
// unchanged P1aV7 four-chunk assertion extraction calls.
import dotenv from "dotenv";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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
const { buildP1aV7ChunkPrompt, normalizeAndVerifyP1aV7ChunkOutput } = await import(
  "../test/claim-foundry/prompt-benchmark/promptSets/p1aV7ChunkAssertion.js");
const { P1A_V12_BOTTOM_UP_ORIENTATION, buildP1aV12BottomUpOrientationPrompt,
  verifyP1aV12BottomUpOrientation, adaptP1aV12ForV7ChunkPrompt } = await import(
  "../test/claim-foundry/prompt-benchmark/promptSets/p1aV12BottomUpOrientation.js");

const sha = (value) => createHash("sha256").update(String(value ?? "")).digest("hex");
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[character]);
const csv = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;

function parseArgs(argv) {
  const options = { fixture: "CF1-F03", model: "gpt-4o-mini", seed: 3724605090,
    chunks: 4, contextUnits: 2, timeoutMs: 240_000,
    orientationMaxOutputTokens: 16_000, chunkMaxOutputTokens: 12_000, out: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--fixture") options.fixture = argv[++index];
    else if (arg === "--model") options.model = argv[++index];
    else if (arg === "--seed") options.seed = Number(argv[++index]);
    else if (arg === "--chunks") options.chunks = Number(argv[++index]);
    else if (arg === "--context-units") options.contextUnits = Number(argv[++index]);
    else if (arg === "--timeout-ms") options.timeoutMs = Number(argv[++index]);
    else if (arg === "--orientation-max-output-tokens") {
      options.orientationMaxOutputTokens = Number(argv[++index]);
    } else if (arg === "--chunk-max-output-tokens") {
      options.chunkMaxOutputTokens = Number(argv[++index]);
    } else if (arg === "--out") options.out = argv[++index];
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function fingerprint(prompt) {
  return { systemSha256: sha(prompt.system), userSha256: sha(prompt.user),
    schemaSha256: sha(JSON.stringify(prompt.responseSchema)),
    assembledSha256: sha(`${prompt.system}\n${prompt.user}\n${JSON.stringify(prompt.responseSchema)}`) };
}

async function invoke({ prompt, label, options, fieldName, repetitionThreshold,
  maxOutputTokens }) {
  const events = [];
  const runner = createCf1ModelRunner({ transport: createOpenAiStreamingCf1Transport({
    fieldName, repetitionThreshold, onClaim: (event) => events.push(event),
  }) });
  const startedAt = Date.now();
  const response = await runner.invokeStructured({ ...prompt, model: options.model,
    temperature: 0, seed: options.seed, timeoutMs: options.timeoutMs,
    maximumAttempts: 1, maxOutputTokens,
    usageContext: { component: "claim_foundry", path: "p1a_v12_bottom_up",
      stage: label } });
  return { output: response.output, usage: response.usage,
    elapsedMs: Date.now() - startedAt, events, fingerprint: fingerprint(prompt),
    provider: { responseId: response.rawResponse?.id ?? null,
      requestId: response.rawResponse?.request_id ?? null,
      systemFingerprint: response.rawResponse?.system_fingerprint ?? null,
      model: response.rawResponse?.model ?? response.model,
      finishReason: response.rawResponse?.choices?.[0]?.finish_reason ?? null },
    streaming: response.rawResponse?.streamingDiagnostics ?? null, prompt };
}

function analyzeAssertions(assertions, sourceUnits) {
  const unitsById = new Map(sourceUnits.map((unit) => [unit.unitId, unit]));
  return assertions.map((assertion, index) => ({ ...assertion, index: index + 1,
    groundingText: (assertion.sourceUnitIds ?? []).map((id) =>
      `[${id}] ${unitsById.get(id)?.text ?? "[missing unit]"}`).join("\n"),
    signals: detectSplitAtomicRepairSignals({ claim: assertion,
      sourceUnitsById: unitsById }).signals }));
}

function axisMetrics(assertions, orientation) {
  const counts = Object.fromEntries(orientation.evidenceAxes.map((axis) => [axis.label, 0]));
  let linkedAssertionCount = 0;
  let totalLinks = 0;
  for (const assertion of assertions) {
    const labels = assertion.relatedPillarLabels ?? [];
    if (labels.length) linkedAssertionCount += 1;
    for (const label of labels) {
      counts[label] = (counts[label] ?? 0) + 1;
      totalLinks += 1;
    }
  }
  const usedCounts = Object.values(counts).filter((count) => count > 0);
  return { axisCount: orientation.evidenceAxes.length,
    localQuestionCount: Object.values(orientation.blockAnalyses).reduce((sum, block) =>
      sum + block.localArgumentQuestions.length, 0),
    linkedAssertionCount, unlinkedAssertionCount: assertions.length - linkedAssertionCount,
    linkedAssertionRate: assertions.length ? linkedAssertionCount / assertions.length : 0,
    usedAxisCount: usedCounts.length,
    unusedAxisCount: orientation.evidenceAxes.length - usedCounts.length,
    totalLinks, largestAxisLinkCount: usedCounts.length ? Math.max(...usedCounts) : 0,
    counts };
}

function loadV7Baseline() {
  const baselinePath = path.join(repoRoot,
    "artifacts/claim-foundry/p1a-v7-chunked/cf1-f03-20260721-055025/results.json");
  if (!existsSync(baselinePath)) return null;
  const stored = JSON.parse(readFileSync(baselinePath, "utf8"));
  const assertions = stored.v7.merge.mergedAssertions;
  const counts = {};
  for (const assertion of assertions) for (const label of assertion.relatedPillarLabels ?? []) {
    counts[label] = (counts[label] ?? 0) + 1;
  }
  const linked = assertions.filter((assertion) => assertion.relatedPillarLabels?.length).length;
  const used = Object.values(counts).filter((count) => count > 0);
  return { sourceRun: baselinePath, pillarCount: stored.orientation.pillars.length,
    assertionCount: assertions.length, linkedAssertionCount: linked,
    linkedAssertionRate: linked / assertions.length, usedPillarCount: used.length,
    unusedPillarCount: stored.orientation.pillars.length - used.length,
    largestPillarLinkCount: used.length ? Math.max(...used) : 0, counts };
}

function usageTotal(calls) {
  return calls.reduce((total, call) => ({
    inputTokens: total.inputTokens + (call.usage?.inputTokens ?? 0),
    outputTokens: total.outputTokens + (call.usage?.outputTokens ?? 0),
    totalTokens: total.totalTokens + (call.usage?.totalTokens ?? 0),
    cachedInputTokens: total.cachedInputTokens + (call.usage?.cachedInputTokens ?? 0),
  }), { inputTokens: 0, outputTokens: 0, totalTokens: 0, cachedInputTokens: 0 });
}

function renderReport({ options, article, structuralBlocks, sourceUnits, orientation,
  orientationCall, chunks, chunkCalls, assertions, merge, metrics, baseline, usage,
  wallMs, regions }) {
  const axisRows = orientation.evidenceAxes.map((axis, index) => `<tr><td>${index + 1}</td>
    <td>${esc(axis.label)}</td><td>${esc(axis.question)}</td>
    <td>${metrics.counts[axis.label] ?? 0}</td>
    <td>${esc(axis.sourceBlockIds.join(", "))}</td>
    <td>${esc(axis.sourceUnitIds.join(", "))}</td></tr>`).join("\n");
  const blockRows = Object.entries(orientation.blockAnalyses).map(([blockId, block]) => `<details>
    <summary>${esc(blockId)} · ${block.localArgumentQuestions.length} local questions</summary>
    ${block.localArgumentQuestions.length ? `<ul>${block.localArgumentQuestions.map((item) =>
      `<li>${esc(item.question)} <small>${esc(item.sourceUnitIds.join(", "))}</small></li>`).join("")}</ul>` : "<p>No local argument question.</p>"}
    </details>`).join("\n");
  const assertionRows = assertions.map((item) => `<tr class="claim-row" data-detail="claim-${item.index}">
    <td>${item.index}</td><td>${esc(item.claimText)}</td>
    <td>${esc(item.sourceUnitIds.join(", "))}</td>
    <td>${esc(item.sourceChunkIds?.join(", ") ?? item.chunkId)}</td>
    <td>${esc((item.relatedPillarLabels ?? []).join("; ") || "unlinked")}</td>
    <td>${esc(item.signals.join(", ") || "none")}</td></tr>
    <tr class="detail-row" id="claim-${item.index}"><td colspan="6"><div class="detail">
    <h4>Grounding</h4><pre>${esc(item.groundingText)}</pre>
    <p><b>Materiality:</b> ${esc(item.materiality)} · <b>Scope:</b> ${esc(item.scope)}<br>
    <b>Evidence hint:</b> ${esc(item.evidenceUsefulnessHint)}</p>
    <details><summary>Raw item</summary><pre>${esc(JSON.stringify(item, null, 2))}</pre></details>
    </div></td></tr>`).join("\n");
  const comparison = baseline ? `<table><thead><tr><th>Arm</th><th>Orientation concepts</th>
    <th>Assertions</th><th>Linked assertions</th><th>Linked rate</th><th>Concepts used</th>
    <th>Largest link bucket</th></tr></thead><tbody>
    <tr><td>V7 forward baseline</td><td>${baseline.pillarCount} pillars</td>
    <td>${baseline.assertionCount}</td><td>${baseline.linkedAssertionCount}</td>
    <td>${(baseline.linkedAssertionRate * 100).toFixed(1)}%</td>
    <td>${baseline.usedPillarCount}/${baseline.pillarCount}</td>
    <td>${baseline.largestPillarLinkCount}</td></tr>
    <tr class="selected"><td>V12 bottom-up orientation</td><td>${metrics.axisCount} evidence axes</td>
    <td>${assertions.length}</td><td>${metrics.linkedAssertionCount}</td>
    <td>${(metrics.linkedAssertionRate * 100).toFixed(1)}%</td>
    <td>${metrics.usedAxisCount}/${metrics.axisCount}</td>
    <td>${metrics.largestAxisLinkCount}</td></tr></tbody></table>` : "<p>V7 baseline unavailable.</p>";
  const promptBlocks = [orientationCall, ...chunkCalls.map((item) => item.call)]
    .map((call, index) => `<details><summary>${index === 0 ? "Orientation" : `Chunk ${index}`}
    exact prompt and fingerprint</summary><h3>System</h3><pre>${esc(call.prompt.system)}</pre>
    <h3>User</h3><pre>${esc(call.prompt.user)}</pre><h3>Schema</h3>
    <pre>${esc(JSON.stringify(call.prompt.responseSchema, null, 2))}</pre>
    <h3>Fingerprint/provider/usage</h3><pre>${esc(JSON.stringify({ fingerprint: call.fingerprint,
      provider: call.provider, usage: call.usage, elapsedMs: call.elapsedMs }, null, 2))}</pre>
    </details>`).join("\n");
  return `<!doctype html><html><head><meta charset="utf-8"><title>P1aV12 bottom-up orientation</title>
    <style>body{font:14px system-ui;margin:24px;color:#18212b}section{margin:32px 0;border-top:4px solid #34495e;padding-top:12px}table{border-collapse:collapse;width:100%;margin:12px 0}th,td{border:1px solid #c8ced4;padding:7px;text-align:left;vertical-align:top}th{background:#edf1f4;position:sticky;top:0}.selected{background:#e8f6e8}.claim-row:hover{background:#f0f5ff;cursor:pointer}.detail-row{display:none}.detail{border-left:4px solid #486a9a;padding:4px 14px;background:#f8faff}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f5f6f7;padding:10px}.note{background:#fff8d9;border:1px solid #e1cf72;padding:10px}summary{cursor:pointer;font-weight:650}small{color:#666}</style></head><body>
    <h1>${esc(options.fixture)} · ${esc(P1A_V12_BOTTOM_UP_ORIENTATION)}</h1>
    <p>One full-article bottom-up orientation call followed by four parallel, otherwise unchanged
    V7 assertion chunk calls. ${usage.totalTokens} tokens · ${(wallMs / 1000).toFixed(1)}s wall.</p>
    <p class="note">Objective: more specific orientation concepts, more assertions linked, and
    links distributed across more concepts. No selection, stance, attribution, or evidence planning.</p>
    <section><h2>Objective comparison</h2>${comparison}
    <p>Current raw article quarters: ${esc(Object.values(regions).join(" / "))}. Exact duplicates
    collapsed: ${merge.summary.collapsedExactDuplicates}. Atomicity warnings:
    ${assertions.filter((item) => item.signals.includes("possible_multiple_assertions")).length}.</p></section>
    <section><h2>Bottom-up orientation</h2><dl><dt>Thesis</dt><dd>${esc(orientation.thesis.text)}</dd>
    <dt>Theme</dt><dd>${esc(orientation.theme.text)}</dd><dt>Hinge</dt>
    <dd>${esc(orientation.thesisHinge)}</dd></dl>
    <h3>${metrics.axisCount} evidence axes</h3><table><thead><tr><th>#</th><th>Axis</th>
    <th>Neutral evidence question</th><th>Assertion links</th><th>Blocks</th><th>Units</th>
    </tr></thead><tbody>${axisRows}</tbody></table>
    <h3>${metrics.localQuestionCount} local argument questions by block</h3>${blockRows}</section>
    <section><h2>${assertions.length} merged assertions · click for grounding</h2><table>
    <thead><tr><th>#</th><th>Assertion</th><th>Units</th><th>Chunk</th><th>Evidence axes</th>
    <th>Atomicity signals</th></tr></thead><tbody>${assertionRows}</tbody></table></section>
    <section><h2>Exact prompts and reproducibility</h2>${promptBlocks}</section>
    <script>document.querySelectorAll('.claim-row').forEach((row)=>row.addEventListener('click',()=>{const d=document.getElementById(row.dataset.detail);d.style.display=d.style.display==='table-row'?'none':'table-row';}));</script>
    </body></html>`;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is required");
  const raw = JSON.parse(readFileSync(path.join(backend, "test/claim-foundry/fixtures",
    options.fixture, "article.json"), "utf8"));
  const { article, structuralBlocks, articleDocument } = prepareArticle(raw.article ?? raw);
  const sourceUnits = articleDocument.sourceUnits;
  const chunks = buildP1aV7Chunks({ structuralBlocks, sourceUnits,
    chunkCount: options.chunks, contextUnits: options.contextUnits });
  const generatedAt = new Date().toISOString();
  const stamp = generatedAt.replace(/[-:T.]/g, "").slice(0, 14)
    .replace(/(\d{8})(\d{6})/, "$1-$2");
  const outDir = path.resolve(options.out ?? path.join(repoRoot,
    "artifacts/claim-foundry/p1a-v12-bottom-up-orientation",
    `${options.fixture.toLowerCase()}-${stamp}`));
  mkdirSync(path.join(outDir, "prompts"), { recursive: true });
  const wallStartedAt = Date.now();

  console.log("P1aV12 bottom-up orientation …");
  const orientationPrompt = buildP1aV12BottomUpOrientationPrompt({ article,
    structuralBlocks, sourceUnits });
  const orientationCall = await invoke({ prompt: orientationPrompt,
    label: P1A_V12_BOTTOM_UP_ORIENTATION, options, fieldName: "question",
    repetitionThreshold: 5, maxOutputTokens: options.orientationMaxOutputTokens });
  const orientation = verifyP1aV12BottomUpOrientation(orientationCall.output,
    { structuralBlocks, sourceUnits });
  const adaptedOrientation = adaptP1aV12ForV7ChunkPrompt(orientation);
  console.log(`  orientation · ${Object.values(orientation.blockAnalyses).reduce((sum, block) => sum + block.localArgumentQuestions.length, 0)} local questions · ${orientation.evidenceAxes.length} evidence axes · ${orientationCall.usage.totalTokens} tokens`);

  console.log("P1aV7 assertion chunks using V12 axes (parallel) …");
  const chunkCalls = await Promise.all(chunks.map(async (chunk) => {
    const prompt = buildP1aV7ChunkPrompt({ article, chunk, sourceUnits,
      orientation: adaptedOrientation });
    const call = await invoke({ prompt, label: `P1aV12-${chunk.chunkId}`, options,
      fieldName: "assertionText", repetitionThreshold: 3,
      maxOutputTokens: options.chunkMaxOutputTokens });
    const extracted = normalizeAndVerifyP1aV7ChunkOutput({ output: call.output, chunk,
      orientation: adaptedOrientation });
    const assertions = analyzeAssertions(extracted, sourceUnits);
    console.log(`  ${chunk.chunkId} · ${assertions.length} assertions · ${call.usage.totalTokens} tokens · ${(call.elapsedMs / 1000).toFixed(1)}s`);
    return { chunk, call, assertions };
  }));
  const rawAssertions = chunkCalls.flatMap((item) => item.assertions);
  const merge = mergeP1aV7Assertions(rawAssertions);
  const assertions = analyzeAssertions(merge.mergedAssertions, sourceUnits);
  const metrics = axisMetrics(assertions, orientation);
  const baseline = loadV7Baseline();
  const usage = usageTotal([orientationCall, ...chunkCalls.map((item) => item.call)]);
  const wallMs = Date.now() - wallStartedAt;
  const regions = articleRegionCounts(assertions, sourceUnits);
  const artifact = { label: P1A_V12_BOTTOM_UP_ORIENTATION, fixture: options.fixture,
    generatedAt, options, article: { title: article.title, contentHash: article.contentHash,
      structuralBlockCount: structuralBlocks.length, sourceUnitCount: sourceUnits.length },
    wallMs, usage, orientation, adaptedOrientation,
    orientationCall: { ...orientationCall, prompt: undefined },
    chunkCalls: chunkCalls.map(({ chunk, call, assertions: items }) => ({
      chunk: { ...chunk, blocks: undefined }, call: { ...call, prompt: undefined },
      assertions: items })), merge: { ...merge, mergedAssertions: assertions },
    metrics, baseline, regions };
  writeFileSync(path.join(outDir, "results.json"), JSON.stringify(artifact, null, 2));
  writeFileSync(path.join(outDir, "prompts", "orientation.json"),
    JSON.stringify(orientationPrompt, null, 2));
  for (const item of chunkCalls) writeFileSync(path.join(outDir, "prompts",
    `${item.chunk.chunkId}.json`), JSON.stringify(item.call.prompt, null, 2));
  const claimHeadings = ["index", "assertionText", "sourceUnitIds", "sourceChunkIds",
    "relatedEvidenceAxes", "materiality", "scope", "evidenceUsefulnessHint",
    "atomicitySignals", "groundingText"];
  const claimRows = assertions.map((item) => [item.index, item.claimText,
    item.sourceUnitIds.join(";"), item.sourceChunkIds?.join(";") ?? item.chunkId,
    (item.relatedPillarLabels ?? []).join(";"), item.materiality, item.scope,
    item.evidenceUsefulnessHint, item.signals.join(";"), item.groundingText]
    .map(csv).join(","));
  writeFileSync(path.join(outDir, "claims.csv"),
    `${claimHeadings.map(csv).join(",")}\n${claimRows.join("\n")}\n`);
  const axisHeadings = ["index", "label", "question", "assertionLinkCount",
    "sourceBlockIds", "sourceUnitIds"];
  const axisRows = orientation.evidenceAxes.map((axis, index) => [index + 1, axis.label,
    axis.question, metrics.counts[axis.label] ?? 0, axis.sourceBlockIds.join(";"),
    axis.sourceUnitIds.join(";")].map(csv).join(","));
  writeFileSync(path.join(outDir, "evidence-axes.csv"),
    `${axisHeadings.map(csv).join(",")}\n${axisRows.join("\n")}\n`);
  writeFileSync(path.join(outDir, "report.html"), renderReport({ options, article,
    structuralBlocks, sourceUnits, orientation, orientationCall, chunks, chunkCalls,
    assertions, merge, metrics, baseline, usage, wallMs, regions }));
  console.log(`Result · ${orientation.evidenceAxes.length} axes · ${assertions.length} assertions · ${metrics.linkedAssertionCount} linked (${(metrics.linkedAssertionRate * 100).toFixed(1)}%) · ${metrics.usedAxisCount} axes used`);
  console.log(`Report: ${path.join(outDir, "report.html")}`);
  console.log(`Claims: ${path.join(outDir, "claims.csv")}`);
  console.log(`Axes: ${path.join(outDir, "evidence-axes.csv")}`);
}

main().catch((error) => { console.error(error); process.exit(1); });
