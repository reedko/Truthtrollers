// Focused benchmark follow-up using a stored P1aV7 run: three C01 orientation
// ablations, one O-post call, and an offline balanced-selector V1/V2 comparison.
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
const { buildP1aV7Chunks } = await import(
  "../test/claim-foundry/prompt-benchmark/p1aV7Chunking.js");
const { buildP1aV7ChunkPrompt, normalizeAndVerifyP1aV7ChunkOutput } = await import(
  "../test/claim-foundry/prompt-benchmark/promptSets/p1aV7ChunkAssertion.js");
const { buildP1aV7ChunkOrientationLitePrompt, buildP1aV7ChunkLocalOnlyPrompt } = await import(
  "../test/claim-foundry/prompt-benchmark/promptSets/p1aV7ChunkAblations.js");
const { buildP1aV7OrientationPostPacket, buildP1aV7OrientationPostPrompt,
  verifyP1aV7PostOrientation } = await import(
  "../test/claim-foundry/prompt-benchmark/promptSets/p1aV7OrientationPost.js");
const { selectBalancedCandidatesV1 } = await import(
  "../test/claim-foundry/prompt-benchmark/balancedCandidateSelectorV1.js");
const { selectBalancedCandidatesV2 } = await import(
  "../test/claim-foundry/prompt-benchmark/balancedCandidateSelectorV2.js");
const { selectPillarBalancedCandidatesV1 } = await import(
  "../test/claim-foundry/prompt-benchmark/pillarBalancedCandidateSelectorV1.js");

const sha = (value) => createHash("sha256").update(String(value ?? "")).digest("hex");
const esc = (value) => String(value ?? "").replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
const promptFingerprint = (prompt) => ({ systemSha256: sha(prompt.system),
  userSha256: sha(prompt.user), schemaSha256: sha(JSON.stringify(prompt.responseSchema)),
  fullSha256: sha(`${prompt.system}\n${prompt.user}\n${JSON.stringify(prompt.responseSchema)}`) });

function parseArgs(argv) {
  const options = { run: "", model: "gpt-4o-mini", seed: 3724605090,
    timeoutMs: 180_000, maximum: 16 };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--run") options.run = argv[++index];
    else if (arg === "--model") options.model = argv[++index];
    else if (arg === "--seed") options.seed = Number(argv[++index]);
    else if (arg === "--timeout-ms") options.timeoutMs = Number(argv[++index]);
    else if (arg === "--maximum") options.maximum = Number(argv[++index]);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!options.run) throw new Error("--run must point to a stored P1aV7 results.json or run directory");
  return options;
}

async function invoke({ prompt, label, options }) {
  const events = [];
  const runner = createCf1ModelRunner({ transport: createOpenAiStreamingCf1Transport({
    fieldName: "assertionText", repetitionThreshold: 3,
    onClaim: (event) => { events.push(event);
      console.log(`  ${label} ${event.ordinal}: ${event.claimText.slice(0, 92)}`); },
  }) });
  const startedAt = Date.now();
  const response = await runner.invokeStructured({ ...prompt, model: options.model,
    temperature: 0, seed: options.seed, timeoutMs: options.timeoutMs, maximumAttempts: 1,
    maxOutputTokens: 12_000, usageContext: { component: "claim_foundry",
      path: "benchmark", stage: label } });
  return { output: response.output, usage: response.usage, events,
    elapsedMs: Date.now() - startedAt, fingerprint: promptFingerprint(prompt),
    provider: { responseId: response.rawResponse?.id ?? null,
      systemFingerprint: response.rawResponse?.system_fingerprint ?? null,
      model: response.rawResponse?.model ?? response.model }, prompt };
}

function orientationBlock(label, value) {
  return `<h3>${esc(label)}</h3><dl><dt>Theme</dt><dd>${esc(value.theme.text)} <small>${esc(value.theme.sourceUnitIds.join(", "))}</small></dd><dt>Thesis</dt><dd>${esc(value.thesis.text)} <small>${esc(value.thesis.sourceUnitIds.join(", "))}</small></dd><dt>Hinge</dt><dd>${esc(value.thesisHinge)}</dd></dl><table><thead><tr><th>Pillar</th><th>Importance</th><th>Text</th><th>Units</th></tr></thead><tbody>${value.pillars.map((pillar) => `<tr><td>${esc(pillar.label)}</td><td>${esc(pillar.importance)}</td><td>${esc(pillar.text)}</td><td>${esc(pillar.sourceUnitIds.join(", "))}</td></tr>`).join("\n")}</tbody></table>`;
}

function selectionTable(selection) {
  return `<table><thead><tr><th>#</th><th>Assertion</th><th>Final pillars</th><th>Reason</th><th>Score</th><th>Units</th></tr></thead><tbody>${selection.selected.map((item, index) => `<tr><td>${index + 1}</td><td>${esc(item.claimText)}</td><td>${esc(item.relatedPillarLabels.join("; ") || "No pillar")}</td><td>${esc(item.reason)}</td><td>${esc(item.score)}</td><td>${esc(item.sourceUnitIds.join(", "))}</td></tr>`).join("\n")}</tbody></table>`;
}

function assertionsTable(assertions) {
  return `<table><thead><tr><th>#</th><th>Assertion</th><th>Units</th><th>Materiality</th><th>Pillars</th></tr></thead><tbody>${assertions.map((item, index) => `<tr><td>${index + 1}</td><td>${esc(item.claimText)}</td><td>${esc(item.sourceUnitIds.join(", "))}</td><td>${esc(item.materiality)}</td><td>${esc(item.relatedPillarLabels.join("; "))}</td></tr>`).join("\n")}</tbody></table>`;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is required");
  const runPath = path.resolve(options.run);
  const resultsPath = runPath.endsWith(".json") ? runPath : path.join(runPath, "results.json");
  const stored = JSON.parse(readFileSync(resultsPath));
  const fixturePath = path.join(backend, "test/claim-foundry/fixtures", stored.fixture,
    "article.json");
  const raw = JSON.parse(readFileSync(fixturePath));
  const { article, structuralBlocks, articleDocument } = prepareArticle(raw.article ?? raw);
  if (article.contentHash !== stored.article.contentHash) throw new Error("Stored run article changed");
  const sourceUnits = articleDocument.sourceUnits;
  const chunks = buildP1aV7Chunks({ structuralBlocks, sourceUnits,
    chunkCount: stored.options.chunks, contextUnits: stored.options.contextUnits });
  const chunk = chunks[0];
  const storedChunk = stored.chunkPlan[0];
  if (chunk.firstUnitId !== storedChunk.firstUnitId || chunk.lastUnitId !== storedChunk.lastUnitId) {
    throw new Error("Stored C01 chunk no longer matches deterministic reconstruction");
  }
  const orientation = stored.orientation;
  const builders = [
    { label: "C01-full-orientation-replay", build: buildP1aV7ChunkPrompt },
    { label: "C01-orientation-lite-no-pillars", build: buildP1aV7ChunkOrientationLitePrompt },
    { label: "C01-local-only", build: buildP1aV7ChunkLocalOnlyPrompt },
  ];
  const postPacket = buildP1aV7OrientationPostPacket({ preOrientation: orientation,
    orientationPacket: stored.orientationPacket,
    assertions: stored.v7.merge.mergedAssertions });
  const postPrompt = buildP1aV7OrientationPostPrompt({ postPacket });
  console.log("Three C01 ablations plus O-post (parallel) …");
  const [cResults, postCall] = await Promise.all([
    Promise.all(builders.map(async ({ label, build }) => {
      const prompt = build({ article, chunk, sourceUnits, orientation });
      const call = await invoke({ prompt, label, options });
      const assertions = normalizeAndVerifyP1aV7ChunkOutput({ output: call.output,
        chunk, orientation });
      console.log(`  ${label} completed · ${assertions.length} assertions`);
      return { label, call, assertions };
    })),
    invoke({ prompt: postPrompt, label: "P1aV7-O-post", options }),
  ]);
  const postOrientation = verifyP1aV7PostOrientation(postCall.output, postPacket);
  console.log(`  O-post completed · hinge ${postOrientation.thesisHinge} · ${postOrientation.pillars.length} pillars`);

  const mergedAssertions = stored.v7.merge.mergedAssertions;
  const selectorV1 = selectBalancedCandidatesV1({ candidateClaims: mergedAssertions,
    sourceUnits, maximum: options.maximum });
  const selectorV2 = selectBalancedCandidatesV2({ candidateClaims: mergedAssertions,
    sourceUnits, maximum: options.maximum });
  const pillarSelector = selectPillarBalancedCandidatesV1({
    candidateClaims: mergedAssertions, sourceUnits, maximum: options.maximum,
    pillars: postOrientation.pillars,
    assignments: postOrientation.assertionPillarAssignments,
    unlinkedReserve: Math.min(2, Math.max(1, Math.floor(options.maximum / 8))),
  });
  const selectedV1 = new Set(selectorV1.selectedClaims.map((item) => item.claimText));
  const selectedV2 = new Set(selectorV2.selectedClaims.map((item) => item.claimText));
  const changedRows = mergedAssertions.filter((item) => selectedV1.has(item.claimText)
    !== selectedV2.has(item.claimText)).map((item) => `<tr><td>${selectedV1.has(item.claimText) ? "V1 only" : "V2 only"}</td><td>${esc(item.claimText)}</td><td>${esc(item.sourceUnitIds.join(", "))}</td></tr>`).join("\n");
  const timestamp = new Date().toISOString().replace(/[-:T.]/g, "").slice(0, 14)
    .replace(/(\d{8})(\d{6})/, "$1-$2");
  const outDir = path.join(path.dirname(resultsPath), `followup-${timestamp}`);
  mkdirSync(path.join(outDir, "prompts"), { recursive: true });
  const artifact = { generatedAt: new Date().toISOString(), sourceRun: resultsPath,
    fixture: stored.fixture, options, chunk: { chunkId: chunk.chunkId,
      firstUnitId: chunk.firstUnitId, lastUnitId: chunk.lastUnitId },
    preOrientation: orientation, postOrientation,
    postCall: { ...postCall, prompt: undefined }, cResults: cResults.map((item) => ({
      label: item.label, call: { ...item.call, prompt: undefined }, assertions: item.assertions })),
    selectors: { regionalV1: selectorV1, regionalQualityFloorV2: selectorV2,
      pillarBalancedV1: pillarSelector } };
  writeFileSync(path.join(outDir, "results.json"), JSON.stringify(artifact, null, 2));
  writeFileSync(path.join(outDir, "prompts", "P1aV7-O-post.json"),
    JSON.stringify(postPrompt, null, 2));
  for (const item of cResults) writeFileSync(path.join(outDir, "prompts", `${item.label}.json`),
    JSON.stringify(item.call.prompt, null, 2));
  const csvRows = ["arm,assertionText,sourceUnitIds,materiality,relatedPillarLabels",
    ...cResults.flatMap((item) => item.assertions.map((assertion) =>
      [item.label, assertion.claimText, assertion.sourceUnitIds.join(";"),
        assertion.materiality, assertion.relatedPillarLabels.join(";")]
        .map((value) => `"${String(value).replaceAll('"', '""')}"`).join(",")))];
  writeFileSync(path.join(outDir, "assertions.csv"), `${csvRows.join("\n")}\n`);
  const selectedCsv = ["candidateId,assertionText,sourceUnitIds,finalPillars,selectionReason,score",
    ...pillarSelector.selected.map((item) => [item.candidateId, item.claimText,
      item.sourceUnitIds.join(";"), item.relatedPillarLabels.join(";"), item.reason, item.score]
      .map((value) => `"${String(value).replaceAll('"', '""')}"`).join(","))];
  writeFileSync(path.join(outDir, "selected-pillar-balanced.csv"),
    `${selectedCsv.join("\n")}\n`);
  const html = `<!doctype html><meta charset="utf-8"><title>P1aV7 focused follow-up</title><style>body{font:14px system-ui;margin:24px;color:#202124}section{margin:32px 0}table{border-collapse:collapse;width:100%;margin:12px 0}th,td{border:1px solid #bbb;padding:7px;text-align:left;vertical-align:top}th{background:#eee}pre{white-space:pre-wrap;background:#f6f6f6;padding:12px}dt{font-weight:700;margin-top:8px}small{color:#666}</style><h1>${esc(stored.fixture)} · P1aV7 focused follow-up</h1><p>Stored C01 range ${esc(chunk.firstUnitId)}–${esc(chunk.lastUnitId)}. Three model calls vary only orientation/pillar exposure. O-post uses the stored 72-assertion inventory. No 1B.</p><section><h2>C01 orientation ablation</h2>${cResults.map((item) => `<details open><summary>${esc(item.label)} · ${item.assertions.length} assertions · ${item.call.usage.totalTokens} tokens</summary>${assertionsTable(item.assertions)}<pre>${esc(JSON.stringify({ fingerprint: item.call.fingerprint, provider: item.call.provider }, null, 2))}</pre></details>`).join("\n")}</section><section><h2>Orientation before and after extraction</h2>${orientationBlock("O-pre", orientation)}${orientationBlock("O-post", postOrientation)}<p>O-post assigned every stored assertion to zero or more final pillars; an empty assignment is preserved as a valid no-pillar judgment.</p><details><summary>O-post provenance</summary><pre>${esc(JSON.stringify({ fingerprint: postCall.fingerprint, provider: postCall.provider, usage: postCall.usage }, null, 2))}</pre></details></section><section><h2>Pillar-balanced final selection</h2><p>This is the proposed selector. It covers final pillars first and reserves ${pillarSelector.diagnostics.unlinkedReserve} slot(s) for strong no-pillar assertions. Article quarters are diagnostic only: ${esc(Object.values(pillarSelector.diagnostics.selectedRegionCounts).join(" / "))}. Final pillar counts: ${esc(JSON.stringify(pillarSelector.diagnostics.pillarCounts))}.</p>${selectionTable(pillarSelector)}</section><section><h2>Legacy spatial selector diagnostics</h2><p>These remain only for comparison. V1 selected ${selectorV1.selectedClaims.length}; quality-floor V2 selected ${selectorV2.selectedClaims.length}; V2 deferred ${selectorV2.diagnostics.belowQualityFloorCount} otherwise eligible assertions below score 6. Regions: V1 ${esc(Object.values(selectorV1.diagnostics.regionCounts).join(" / "))}; V2 ${esc(Object.values(selectorV2.diagnostics.regionCounts).join(" / "))}.</p><table><thead><tr><th>Change</th><th>Assertion</th><th>Units</th></tr></thead><tbody>${changedRows}</tbody></table><details><summary>Legacy V2 selected portfolio</summary>${assertionsTable(selectorV2.selectedClaims)}</details></section>`;
  writeFileSync(path.join(outDir, "report.html"), html);
  console.log(`Report: ${path.join(outDir, "report.html")}`);
}

main().catch((error) => { console.error(error); process.exit(1); });
