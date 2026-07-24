// Benchmark-only P1aV8 pillar-map ablation using a stored P1aV7 assertion inventory.
// Arm A reads the complete article; Arm B reads the same assertions grouped by
// deterministic structural block. Both return the same block-assignment schema.
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
const { buildP1aV8WholeArticlePrompt, buildP1aV8GroupedAssertionPacket,
  buildP1aV8GroupedAssertionPrompt, verifyP1aV8PillarMap,
  mapAssertionsThroughBlocks } = await import(
  "../test/claim-foundry/prompt-benchmark/promptSets/p1aV8PillarMap.js");

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

async function invoke({ prompt, label, options }) {
  const runner = createCf1ModelRunner({ transport: createOpenAiStreamingCf1Transport({
    fieldName: "label", repetitionThreshold: 3,
    onClaim: (item) => console.log(`  ${label} ${item.ordinal}: ${item.claimText}`),
  }) });
  const startedAt = Date.now();
  const response = await runner.invokeStructured({ ...prompt, model: options.model,
    temperature: 0, seed: options.seed, timeoutMs: options.timeoutMs,
    maximumAttempts: 1, maxOutputTokens: 10_000,
    usageContext: { component: "claim_foundry", path: "benchmark", stage: label } });
  return { output: response.output, usage: response.usage,
    elapsedMs: Date.now() - startedAt, fingerprint: fingerprint(prompt),
    provider: { responseId: response.rawResponse?.id ?? null,
      systemFingerprint: response.rawResponse?.system_fingerprint ?? null,
      model: response.rawResponse?.model ?? response.model }, prompt };
}

function summarize({ pillarMap, mappedAssertions }) {
  const labeledBlocks = pillarMap.blockPillarAssignments.filter((item) =>
    item.relatedPillarLabels.length).length;
  const pillarAssertionCounts = Object.fromEntries(pillarMap.pillars.map((pillar) =>
    [pillar.label, mappedAssertions.filter((item) =>
      item.derivedPillarLabels.includes(pillar.label)).length]));
  return { pillarCount: pillarMap.pillars.length, labeledBlocks,
    unlabeledBlocks: pillarMap.blockPillarAssignments.length - labeledBlocks,
    linkedAssertions: mappedAssertions.filter((item) => item.derivedPillarLabels.length).length,
    unlinkedAssertions: mappedAssertions.filter((item) => !item.derivedPillarLabels.length).length,
    pillarAssertionCounts };
}

function orientationHtml(arm) {
  return `<dl><dt>Theme</dt><dd>${esc(arm.pillarMap.theme.text)}</dd><dt>Thesis</dt><dd>${esc(arm.pillarMap.thesis.text)}</dd><dt>Hinge</dt><dd>${esc(arm.pillarMap.thesisHinge)}</dd></dl><table><thead><tr><th>Pillar</th><th>Importance</th><th>Definition</th><th>Grounding</th><th>Mapped assertions</th></tr></thead><tbody>${arm.pillarMap.pillars.map((pillar) => `<tr><td>${esc(pillar.label)}</td><td>${esc(pillar.importance)}</td><td>${esc(pillar.text)}</td><td>${esc(pillar.sourceUnitIds.join(", "))}</td><td>${arm.summary.pillarAssertionCounts[pillar.label] ?? 0}</td></tr>`).join("\n")}</tbody></table>`;
}

function blockTable(arm, structuralBlocks, assertionCounts) {
  const assignment = new Map(arm.pillarMap.blockPillarAssignments
    .map((item) => [item.blockId, item.relatedPillarLabels]));
  return `<table><thead><tr><th>Block</th><th>Units</th><th>Type</th><th>Heading/text</th><th>Extracted assertions</th><th>Assigned pillars</th></tr></thead><tbody>${structuralBlocks.map((block) => `<tr><td>${esc(block.blockId)}</td><td>${esc(`${block.sourceUnitIds[0]}–${block.sourceUnitIds.at(-1)}`)}</td><td>${esc(block.structuralType)}</td><td>${esc(block.heading || block.text.slice(0, 180))}</td><td>${assertionCounts.get(block.blockId) ?? 0}</td><td>${esc((assignment.get(block.blockId) ?? []).join("; ") || "No pillar")}</td></tr>`).join("\n")}</tbody></table>`;
}

function assertionTable(wholeMapped, groupedMapped) {
  const groupedById = new Map(groupedMapped.map((item) => [item.candidateId, item]));
  return `<table><thead><tr><th>ID</th><th>Assertion</th><th>Blocks</th><th>C model labels (diagnostic)</th><th>Whole-article derived</th><th>Grouped-assertion derived</th></tr></thead><tbody>${wholeMapped.map((item) => { const other = groupedById.get(item.candidateId); return `<tr><td>${esc(item.candidateId)}</td><td>${esc(item.claimText)}</td><td>${esc(item.mappedBlockIds.join(", "))}</td><td>${esc((item.relatedPillarLabels ?? []).join("; ") || "None")}</td><td>${esc(item.derivedPillarLabels.join("; ") || "No pillar")}</td><td>${esc((other?.derivedPillarLabels ?? []).join("; ") || "No pillar")}</td></tr>`; }).join("\n")}</tbody></table>`;
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
  const packet = buildP1aV8GroupedAssertionPacket({ article, structuralBlocks, assertions });
  if (packet.unmatchedAssertions.length) throw new Error("An assertion has no structural block");
  const wholePrompt = buildP1aV8WholeArticlePrompt({ article, structuralBlocks });
  const groupedPrompt = buildP1aV8GroupedAssertionPrompt({ packet });
  console.log("P1aV8 pillar-map arms (parallel) …");
  const [wholeCall, groupedCall] = await Promise.all([
    invoke({ prompt: wholePrompt, label: "whole-article", options }),
    invoke({ prompt: groupedPrompt, label: "block-grouped-assertions", options }),
  ]);
  const allowedSourceUnitIds = articleDocument.sourceUnits.map((item) => item.unitId);
  const wholeMap = verifyP1aV8PillarMap(wholeCall.output,
    { structuralBlocks, allowedSourceUnitIds });
  const groupedMap = verifyP1aV8PillarMap(groupedCall.output,
    { structuralBlocks, allowedSourceUnitIds });
  const arms = [
    { label: "Whole article", call: wholeCall, pillarMap: wholeMap,
      mappedAssertions: mapAssertionsThroughBlocks({ assertions, structuralBlocks,
        pillarMap: wholeMap }) },
    { label: "Block-grouped assertions", call: groupedCall, pillarMap: groupedMap,
      mappedAssertions: mapAssertionsThroughBlocks({ assertions, structuralBlocks,
        pillarMap: groupedMap }) },
  ];
  for (const arm of arms) arm.summary = summarize(arm);
  const blockByUnit = new Map();
  for (const block of structuralBlocks) for (const id of block.sourceUnitIds) {
    blockByUnit.set(id, block.blockId);
  }
  const assertionCounts = new Map(structuralBlocks.map((block) => [block.blockId, 0]));
  for (const assertion of assertions) {
    for (const blockId of new Set(assertion.sourceUnitIds.map((id) => blockByUnit.get(id)))) {
      if (blockId) assertionCounts.set(blockId, assertionCounts.get(blockId) + 1);
    }
  }
  const timestamp = new Date().toISOString().replace(/[-:T.]/g, "").slice(0, 14)
    .replace(/(\d{8})(\d{6})/, "$1-$2");
  const outDir = path.join(repoRoot, "artifacts/claim-foundry/p1a-v8-pillar-map",
    `${stored.fixture.toLowerCase()}-${timestamp}`);
  mkdirSync(path.join(outDir, "prompts"), { recursive: true });
  const artifact = { generatedAt: new Date().toISOString(), sourceRun: resultsPath,
    fixture: stored.fixture, options, article: { title: article.title,
      contentHash: article.contentHash, structuralBlockCount: structuralBlocks.length,
      assertionCount: assertions.length }, packet, arms: arms.map((arm) => ({
      label: arm.label, call: { ...arm.call, prompt: undefined }, pillarMap: arm.pillarMap,
      mappedAssertions: arm.mappedAssertions, summary: arm.summary })) };
  writeFileSync(path.join(outDir, "results.json"), JSON.stringify(artifact, null, 2));
  writeFileSync(path.join(outDir, "prompts", "whole-article.json"),
    JSON.stringify(wholePrompt, null, 2));
  writeFileSync(path.join(outDir, "prompts", "block-grouped-assertions.json"),
    JSON.stringify(groupedPrompt, null, 2));
  const csvRows = ["arm,candidateId,assertionText,sourceUnitIds,blockIds,modelDiagnosticPillars,derivedPillars"];
  for (const arm of arms) for (const item of arm.mappedAssertions) csvRows.push([
    arm.label, item.candidateId, item.claimText, item.sourceUnitIds.join(";"),
    item.mappedBlockIds.join(";"), (item.relatedPillarLabels ?? []).join(";"),
    item.derivedPillarLabels.join(";")].map(csv).join(","));
  writeFileSync(path.join(outDir, "assertion-pillar-map.csv"), `${csvRows.join("\n")}\n`);
  const summaryRows = arms.map((arm) => `<tr><td>${esc(arm.label)}</td><td>${arm.summary.pillarCount}</td><td>${arm.pillarMap.thesisHinge}</td><td>${arm.summary.labeledBlocks} / ${arm.summary.unlabeledBlocks}</td><td>${arm.summary.linkedAssertions} / ${arm.summary.unlinkedAssertions}</td><td>${arm.call.usage.totalTokens}</td><td>${(arm.call.elapsedMs / 1000).toFixed(1)}s</td></tr>`).join("\n");
  const html = `<!doctype html><meta charset="utf-8"><title>P1aV8 pillar-map ablation</title><style>body{font:14px system-ui;margin:24px;color:#202124}section{margin:32px 0}table{border-collapse:collapse;width:100%;margin:12px 0}th,td{border:1px solid #bbb;padding:7px;text-align:left;vertical-align:top}th{background:#eee}dt{font-weight:700;margin-top:8px}pre{white-space:pre-wrap;background:#f6f6f6;padding:12px}</style><h1>${esc(stored.fixture)} · P1aV8 pillar-map input ablation</h1><p>Same model, seed, schema, and pillar instructions. Whole-article input versus the stored 72 assertions grouped by 33 deterministic structural blocks. Old C-stage pillar labels are diagnostic only. No stance and no assertion extraction calls.</p><section><h2>Summary</h2><table><thead><tr><th>Arm</th><th>Pillars</th><th>Hinge</th><th>Labeled / unlabeled blocks</th><th>Linked / unlinked assertions</th><th>Tokens</th><th>Elapsed</th></tr></thead><tbody>${summaryRows}</tbody></table></section>${arms.map((arm) => `<section><h2>${esc(arm.label)}</h2>${orientationHtml(arm)}<details><summary>Block-to-pillar assignments</summary>${blockTable(arm, structuralBlocks, assertionCounts)}</details><details><summary>Provenance</summary><pre>${esc(JSON.stringify({ fingerprint: arm.call.fingerprint, provider: arm.call.provider, usage: arm.call.usage }, null, 2))}</pre></details></section>`).join("\n")}<section><h2>Deterministic assertion mapping comparison</h2>${assertionTable(arms[0].mappedAssertions, arms[1].mappedAssertions)}</section>`;
  writeFileSync(path.join(outDir, "report.html"), html);
  for (const arm of arms) console.log(`${arm.label}: ${arm.summary.pillarCount} pillars · ${arm.summary.linkedAssertions}/${assertions.length} assertions linked`);
  console.log(`Report: ${path.join(outDir, "report.html")}`);
}

main().catch((error) => { console.error(error); process.exit(1); });
