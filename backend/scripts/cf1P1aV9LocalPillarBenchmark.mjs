// Benchmark-only local pillar derivation from the stored P1aV7 assertion inventory.
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
const { buildP1aV7Chunks } = await import(
  "../test/claim-foundry/prompt-benchmark/p1aV7Chunking.js");
const { buildP1aV9ChunkPacket, buildP1aV9LocalPillarPrompt,
  verifyP1aV9LocalPillars, mergeP1aV9LocalPillars } = await import(
  "../test/claim-foundry/prompt-benchmark/promptSets/p1aV9LocalPillars.js");

const sha = (value) => createHash("sha256").update(String(value ?? "")).digest("hex");
const esc = (value) => String(value ?? "").replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
const csv = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
const fingerprint = (prompt) => ({ systemSha256: sha(prompt.system),
  userSha256: sha(prompt.user), schemaSha256: sha(JSON.stringify(prompt.responseSchema)),
  fullSha256: sha(`${prompt.system}\n${prompt.user}\n${JSON.stringify(prompt.responseSchema)}`) });

function parseArgs(argv) {
  const options = { run: "", model: "gpt-4o-mini", seed: 3724605090,
    timeoutMs: 180_000 };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--run") options.run = argv[++index];
    else if (arg === "--model") options.model = argv[++index];
    else if (arg === "--seed") options.seed = Number(argv[++index]);
    else if (arg === "--timeout-ms") options.timeoutMs = Number(argv[++index]);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!options.run) throw new Error("--run must identify a stored P1aV7 run");
  return options;
}

async function invoke({ prompt, chunkId, options }) {
  const runner = createCf1ModelRunner({ transport: createOpenAiStreamingCf1Transport({
    fieldName: "evidenceQuestion", repetitionThreshold: 3,
    onClaim: (item) => console.log(`  ${chunkId} ${item.ordinal}: ${item.claimText}`),
  }) });
  const startedAt = Date.now();
  const response = await runner.invokeStructured({ ...prompt, model: options.model,
    temperature: 0, seed: options.seed, timeoutMs: options.timeoutMs,
    maximumAttempts: 1, maxOutputTokens: 10_000,
    usageContext: { component: "claim_foundry", path: "benchmark",
      stage: `P1aV9-${chunkId}` } });
  return { output: response.output, usage: response.usage,
    elapsedMs: Date.now() - startedAt, fingerprint: fingerprint(prompt),
    provider: { responseId: response.rawResponse?.id ?? null,
      systemFingerprint: response.rawResponse?.system_fingerprint ?? null,
      model: response.rawResponse?.model ?? response.model }, prompt };
}

function pillarTable(merge, assertionById) {
  return `<table><thead><tr><th>ID</th><th>Evidence question</th><th>Blocks</th><th>Assertions</th></tr></thead><tbody>${merge.pillars.map((pillar) => `<tr><td>${esc(pillar.pillarId)}</td><td>${esc(pillar.evidenceQuestion)}</td><td>${esc(pillar.sourceBlockIds.join(", "))}</td><td>${pillar.assertionIds.map((id) => `<div><b>${esc(id)}</b> ${esc(assertionById.get(id)?.claimText ?? "")}</div>`).join("")}</td></tr>`).join("\n")}</tbody></table>`;
}

function chunkHtml(result, assertionById) {
  return `<details open><summary>${esc(result.chunkId)} · ${result.localPillarCount} local questions · ${result.call.usage.totalTokens} tokens</summary>${result.output.blockAnalyses.map((analysis) => `<h4>${esc(analysis.blockId)}</h4>${analysis.localPillars.length ? `<ul>${analysis.localPillars.map((pillar) => `<li><b>${esc(pillar.evidenceQuestion)}</b><ul>${pillar.assertionIds.map((id) => `<li>${esc(id)} — ${esc(assertionById.get(id)?.claimText ?? "")}</li>`).join("")}</ul></li>`).join("")}</ul>` : "<p>No local evidence question.</p>"}${analysis.unassignedAssertionIds.length ? `<p>Unassigned: ${analysis.unassignedAssertionIds.map((id) => `${esc(id)} — ${esc(assertionById.get(id)?.claimText ?? "")}`).join("<br>")}</p>` : ""}`).join("\n")}</details>`;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is required");
  const sourceRun = path.resolve(options.run);
  const resultsPath = sourceRun.endsWith(".json") ? sourceRun : path.join(sourceRun, "results.json");
  const stored = JSON.parse(readFileSync(resultsPath));
  const fixturePath = path.join(backend, "test/claim-foundry/fixtures", stored.fixture,
    "article.json");
  const raw = JSON.parse(readFileSync(fixturePath));
  const { article, articleDocument, structuralBlocks } = prepareArticle(raw.article ?? raw);
  if (article.contentHash !== stored.article.contentHash) throw new Error("Stored article changed");
  const assertions = stored.v7.merge.mergedAssertions;
  const chunks = buildP1aV7Chunks({ structuralBlocks,
    sourceUnits: articleDocument.sourceUnits, chunkCount: stored.options.chunks,
    contextUnits: stored.options.contextUnits });
  const chunkPackets = chunks.map((chunk) => {
    const ownedUnits = new Set(chunk.ownedUnitIds);
    const chunkAssertions = assertions.filter((assertion) =>
      assertion.sourceUnitIds?.some((id) => ownedUnits.has(id)));
    const packet = buildP1aV9ChunkPacket({ chunkId: chunk.chunkId,
      blocks: chunk.blocks, assertions: chunkAssertions, orientation: stored.orientation });
    if (packet.unmatchedAssertionIds.length) throw new Error(`${chunk.chunkId} has unmatched assertions`);
    return { chunk, packet, prompt: buildP1aV9LocalPillarPrompt({ packet }) };
  });
  console.log("P1aV9 local pillar calls (parallel) …");
  const results = await Promise.all(chunkPackets.map(async ({ chunk, packet, prompt }) => {
    const call = await invoke({ prompt, chunkId: chunk.chunkId, options });
    const output = verifyP1aV9LocalPillars(call.output, packet);
    const localPillarCount = output.blockAnalyses.reduce((sum, item) =>
      sum + item.localPillars.length, 0);
    console.log(`  ${chunk.chunkId} completed · ${localPillarCount} local questions`);
    return { chunkId: chunk.chunkId, packet, output, call, localPillarCount };
  }));
  const merge = mergeP1aV9LocalPillars(results);
  const assertionById = new Map(assertions.map((item) => [item.candidateId, item]));
  const mappedAssertions = assertions.map((assertion) => ({ ...assertion,
    derivedPillarIds: merge.pillarIdsByAssertion[assertion.candidateId] ?? [],
    localPillarQuestions: merge.pillars.filter((pillar) =>
      pillar.assertionIds.includes(assertion.candidateId)).map((pillar) => pillar.evidenceQuestion),
    locallyUnassigned: merge.unassignedAssertionIds.includes(assertion.candidateId) }));
  const timestamp = new Date().toISOString().replace(/[-:T.]/g, "").slice(0, 14)
    .replace(/(\d{8})(\d{6})/, "$1-$2");
  const outDir = path.join(repoRoot, "artifacts/claim-foundry/p1a-v9-local-pillars",
    `${stored.fixture.toLowerCase()}-${timestamp}`);
  mkdirSync(path.join(outDir, "prompts"), { recursive: true });
  const artifact = { generatedAt: new Date().toISOString(), sourceRun: resultsPath,
    fixture: stored.fixture, options, orientationUsed: { theme: stored.orientation.theme,
      thesis: stored.orientation.thesis }, assertionCount: assertions.length,
    chunkResults: results.map((result) => ({ chunkId: result.chunkId,
      packet: result.packet, output: result.output,
      call: { ...result.call, prompt: undefined }, localPillarCount: result.localPillarCount })),
    merge, mappedAssertions };
  writeFileSync(path.join(outDir, "results.json"), JSON.stringify(artifact, null, 2));
  for (const result of results) writeFileSync(path.join(outDir, "prompts",
    `${result.chunkId}.json`), JSON.stringify(result.call.prompt, null, 2));
  const csvRows = ["candidateId,assertionText,sourceUnitIds,modelDiagnosticPillars,localPillarIds,localEvidenceQuestions,locallyUnassigned"];
  for (const item of mappedAssertions) csvRows.push([item.candidateId, item.claimText,
    item.sourceUnitIds.join(";"), (item.relatedPillarLabels ?? []).join(";"),
    item.derivedPillarIds.join(";"), item.localPillarQuestions.join(";"),
    item.locallyUnassigned].map(csv).join(","));
  writeFileSync(path.join(outDir, "assertion-local-pillars.csv"), `${csvRows.join("\n")}\n`);
  const totalTokens = results.reduce((sum, result) => sum + result.call.usage.totalTokens, 0);
  const html = `<!doctype html><meta charset="utf-8"><title>P1aV9 local pillars</title><style>body{font:14px system-ui;margin:24px;color:#202124}section{margin:32px 0}table{border-collapse:collapse;width:100%;margin:12px 0}th,td{border:1px solid #bbb;padding:7px;text-align:left;vertical-align:top}th{background:#eee}details{margin:14px 0;padding:8px;border:1px solid #ccc}summary{font-weight:700}</style><h1>${esc(stored.fixture)} · P1aV9 local pillars from assertions</h1><p>Four parallel calls derived evidence questions independently inside deterministic structural blocks. No old pillar labels were supplied. Exact-normalized question matches were merged; near-duplicates remain separate. No stance or assertion extraction.</p><section><h2>Summary</h2><ul><li>${assertions.length} stored assertions</li><li>${merge.summary.localPillarCount} local evidence questions</li><li>${merge.summary.exactMergedPillarCount} after exact-only merging</li><li>${merge.summary.exactQuestionCollapses} exact question collapses</li><li>${merge.summary.unassignedAssertionCount} locally unassigned assertions</li><li>${totalTokens} total tokens</li></ul></section><section><h2>Merged local pillars</h2>${pillarTable(merge, assertionById)}</section><section><h2>Output by chunk and block</h2>${results.map((result) => chunkHtml(result, assertionById)).join("\n")}</section>`;
  writeFileSync(path.join(outDir, "report.html"), html);
  console.log(`${merge.summary.localPillarCount} local questions · ${merge.summary.exactMergedPillarCount} after exact merge · ${merge.summary.unassignedAssertionCount} unassigned assertions`);
  console.log(`Report: ${path.join(outDir, "report.html")}`);
}

main().catch((error) => { console.error(error); process.exit(1); });
