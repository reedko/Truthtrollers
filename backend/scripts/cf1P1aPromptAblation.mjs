// Four-arm F03 Call 1A-only prompt ablation. The article and model settings are
// identical across arms. No 1B, atomic repair, census recovery, or finalization.
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
const { collectAttributionSurface } = await import("../src/claim-foundry/attributionSurfaceCensus.js");
const { buildSplitCensusDiagnostic } = await import("../src/claim-foundry/splitCensusDiagnostic.js");
const { detectSplitAtomicRepairSignals } = await import("../src/claim-foundry/splitAtomicRepair.js");
const { selectBalancedCandidatesV1 } = await import(
  "../test/claim-foundry/prompt-benchmark/balancedCandidateSelectorV1.js");
const { normalizeP1aVariantOutput } = await import(
  "../test/claim-foundry/prompt-benchmark/promptSets/p1aVariantSchema.js");
const { P1A_V2_BASELINE, buildP1aV2BaselinePrompt } = await import(
  "../test/claim-foundry/prompt-benchmark/promptSets/p1aV2Baseline.js");
const { P1A_V4_ASSERTION, buildP1aV4AssertionPrompt } = await import(
  "../test/claim-foundry/prompt-benchmark/promptSets/p1aV4Assertion.js");
const { P1A_V5_XMAT, buildP1aV5NoMaterialityPrompt } = await import(
  "../test/claim-foundry/prompt-benchmark/promptSets/p1aV5NoMateriality.js");
const { P1A_V6_ASSERT_XMAT, buildP1aV6AssertionNoMaterialityPrompt } = await import(
  "../test/claim-foundry/prompt-benchmark/promptSets/p1aV6AssertionNoMateriality.js");

const sha = (value) => createHash("sha256").update(String(value ?? "")).digest("hex");
const esc = (value) => String(value ?? "").replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
const variants = [
  { label: P1A_V2_BASELINE, build: buildP1aV2BaselinePrompt, assertion: false,
    removeMateriality: false },
  { label: P1A_V4_ASSERTION, build: buildP1aV4AssertionPrompt, assertion: true,
    removeMateriality: false },
  { label: P1A_V5_XMAT, build: buildP1aV5NoMaterialityPrompt, assertion: false,
    removeMateriality: true },
  { label: P1A_V6_ASSERT_XMAT, build: buildP1aV6AssertionNoMaterialityPrompt,
    assertion: true, removeMateriality: true },
];

function parseArgs(argv) {
  const options = { fixture: "CF1-F03", model: "gpt-4o-mini",
    seed: 3724605090, maximum: 16, timeoutMs: 180_000, arms: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--fixture") options.fixture = argv[++index];
    else if (arg === "--model") options.model = argv[++index];
    else if (arg === "--seed") options.seed = Number(argv[++index]);
    else if (arg === "--maximum") options.maximum = Number(argv[++index]);
    else if (arg === "--timeout-ms") options.timeoutMs = Number(argv[++index]);
    else if (arg === "--arms") options.arms = argv[++index].split(",")
      .map((value) => value.trim()).filter(Boolean);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function inspectClaims(claims, sourceUnits) {
  const units = new Map(sourceUnits.map((unit) => [unit.unitId, unit]));
  return claims.map((claim, index) => ({ index: index + 1, ...claim,
    signals: detectSplitAtomicRepairSignals({ claim, sourceUnitsById: units }).signals }));
}

function rows(claims, selectedTexts) {
  return claims.map((claim) => `<tr class="${selectedTexts.has(claim.claimText) ? "selected" : ""}">
<td>${claim.index}</td><td>${selectedTexts.has(claim.claimText) ? "✓" : ""}</td>
<td>${esc(claim.claimText)}</td><td>${esc((claim.sourceUnitIds ?? []).join(", "))}</td>
<td>${esc(claim.materiality ?? "not requested")}</td>
<td>${esc((claim.relatedPillarLabels ?? []).join("; "))}</td>
<td>${esc(claim.signals.join(", ") || "none")}</td></tr>`).join("\n");
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is required");
  const fixturePath = path.join(backend, "test/claim-foundry/fixtures", options.fixture,
    "article.json");
  const raw = JSON.parse(readFileSync(fixturePath));
  const { article, structuralBlocks, articleDocument } = prepareArticle(raw.article ?? raw);
  const input = { article, structuralBlocks, sourceUnits: articleDocument.sourceUnits };
  const timestamp = new Date().toISOString().replace(/[-:T.]/g, "").slice(0, 14)
    .replace(/(\d{8})(\d{6})/, "$1-$2");
  const outDir = path.join(repoRoot, "artifacts/claim-foundry/p1a-ablation",
    `${options.fixture.toLowerCase()}-${timestamp}`);
  mkdirSync(outDir, { recursive: true });
  const results = [];
  const selectedVariants = options.arms
    ? variants.filter((variant) => options.arms.includes(variant.label)) : variants;
  if (options.arms && selectedVariants.length !== options.arms.length) {
    const known = variants.map((variant) => variant.label).join(", ");
    throw new Error(`Unknown or duplicate --arms label. Known labels: ${known}`);
  }
  for (const variant of selectedVariants) {
    const prompt = variant.build(input);
    const events = [];
    const runner = createCf1ModelRunner({ transport: createOpenAiStreamingCf1Transport({
      fieldName: variant.assertion ? "assertionText" : "claimText", repetitionThreshold: 3,
      onClaim: (item) => { events.push(item);
        process.stdout.write(`  ${variant.label} ${item.ordinal}: ${item.claimText.slice(0, 100)}\n`); },
    }) });
    process.stdout.write(`${variant.label} …\n`);
    const startedAt = Date.now();
    try {
      const response = await runner.invokeStructured({ ...prompt, model: options.model,
        temperature: 0, seed: options.seed, timeoutMs: options.timeoutMs,
        maximumAttempts: 1, maxOutputTokens: 12_000,
        usageContext: { component: "claim_foundry", path: "benchmark",
          stage: variant.label } });
      const inventory = normalizeP1aVariantOutput(response.output,
        { assertionTerminology: variant.assertion });
      const analyzedClaims = inspectClaims(inventory.candidateClaims ?? [],
        articleDocument.sourceUnits);
      const balanced = selectBalancedCandidatesV1({ candidateClaims: analyzedClaims,
        sourceUnits: articleDocument.sourceUnits, maximum: options.maximum });
      const census = buildSplitCensusDiagnostic({
        censusItems: collectAttributionSurface({ sourceUnits: articleDocument.sourceUnits,
          structuralBlocks }), candidateClaims: analyzedClaims, structuralBlocks });
      results.push({ status: "completed", label: variant.label,
        assertionTerminology: variant.assertion,
        removeMateriality: variant.removeMateriality, elapsedMs: Date.now() - startedAt,
        promptFingerprint: { systemSha256: sha(prompt.system), userSha256: sha(prompt.user),
          schemaSha256: sha(JSON.stringify(prompt.responseSchema)) },
        provider: { responseId: response.rawResponse?.id ?? null,
          systemFingerprint: response.rawResponse?.system_fingerprint ?? null,
          model: response.rawResponse?.model ?? response.model },
        usage: response.usage, events, output: response.output, inventory,
        analyzedClaims, balanced, census });
      console.log(`  completed · ${analyzedClaims.length} raw · ${balanced.selectedClaims.length} balanced · ${response.usage.totalTokens} tokens`);
    } catch (error) {
      results.push({ status: "failed", label: variant.label,
        assertionTerminology: variant.assertion, removeMateriality: variant.removeMateriality,
        elapsedMs: Date.now() - startedAt, events,
        error: { code: error.code ?? null, message: error.message,
          causeCode: error.cause?.code ?? null, causeMessage: error.cause?.message ?? null,
          providerMetadata: error.cause?.providerMetadata ?? error.providerMetadata ?? null } });
      console.log(`  FAILED · ${error.cause?.code ?? error.code ?? ""} ${error.cause?.message ?? error.message}`);
    }
  }
  const artifact = { fixture: options.fixture, model: options.model, seed: options.seed,
    maximum: options.maximum, generatedAt: new Date().toISOString(), results };
  writeFileSync(path.join(outDir, "results.json"), JSON.stringify(artifact, null, 2));
  const cards = results.map((result) => {
    if (result.status !== "completed") return `<section><h2>${esc(result.label)}</h2><p class="bad">FAILED: ${esc(result.error.causeCode ?? result.error.code)} ${esc(result.error.causeMessage ?? result.error.message)}</p></section>`;
    const selectedTexts = new Set(result.balanced.selectedClaims.map((claim) => claim.claimText));
    const regionCounts = Object.values(result.balanced.diagnostics.regionCounts).join(" / ");
    const materialityCounts = result.analyzedClaims.reduce((counts, claim) => {
      const key = claim.materiality ?? "not requested"; counts[key] = (counts[key] ?? 0) + 1;
      return counts;
    }, {});
    const signalCounts = result.analyzedClaims.flatMap((claim) => claim.signals)
      .reduce((counts, signal) => { counts[signal] = (counts[signal] ?? 0) + 1; return counts; }, {});
    const census = result.census.summary;
    const censusRows = result.census.items.map((item) => `<tr><td>${esc(item.censusId)}</td><td>${esc(item.semanticChunkId)}</td><td>${esc(item.sourceUnitIds.join(", "))}</td><td>${esc(item.trigger)}</td><td>${esc(item.snippet)}</td><td>${esc(item.assessment)}</td><td>${esc(item.match ? `${item.match.claimId ?? ""} ${item.match.claimText ?? ""}` : "")}</td></tr>`).join("\n");
    return `<section><h2>${esc(result.label)}</h2>
<p>${result.analyzedClaims.length} raw · ${result.balanced.selectedClaims.length} balanced · regions ${regionCounts} · ${result.usage.totalTokens} tokens · ${(result.elapsedMs / 1000).toFixed(1)}s</p>
<p>materiality ${esc(JSON.stringify(materialityCounts))} · signals ${esc(JSON.stringify(signalCounts))}</p>
<details><summary>Prompt and fingerprints</summary><pre>${esc(JSON.stringify(result.promptFingerprint, null, 2))}</pre><h3>System</h3><pre>${esc(result.inventory ? variants.find((v) => v.label === result.label).build(input).system : "")}</pre><h3>User instructions (article follows)</h3><pre>${esc(variants.find((v) => v.label === result.label).build(input).user.split("STRUCTURED ARTICLE:")[0])}</pre></details>
<h3>Raw 1A output; ✓ = balanced shortlist</h3><table><thead><tr><th>#</th><th>balanced</th><th>text</th><th>units</th><th>materiality</th><th>pillars</th><th>signals</th></tr></thead><tbody>${rows(result.analyzedClaims, selectedTexts)}</tbody></table>
<details><summary>Census diagnostic · ${census.totalPackets} packets · ${census.apparentMatchCount} apparent matches · ${census.noObviousMatchCount} no obvious matches</summary><table><thead><tr><th>ID</th><th>block</th><th>units</th><th>trigger</th><th>snippet</th><th>assessment</th><th>match</th></tr></thead><tbody>${censusRows}</tbody></table></details></section>`;
  }).join("\n");
  const html = `<!doctype html><meta charset="utf-8"><title>P1A prompt ablation</title><style>body{font:14px system-ui;margin:24px;color:#202124}section{margin:32px 0}table{border-collapse:collapse;width:100%}th,td{border:1px solid #bbb;padding:7px;text-align:left;vertical-align:top}th{background:#eee}.selected{background:#eaf7e8}.bad{color:#a00}pre{white-space:pre-wrap;background:#f6f6f6;padding:12px}</style><h1>${esc(options.fixture)} P1A prompt ablation</h1><p>1A only. Same ${esc(options.model)}, seed ${options.seed}, article, temperature 0, streaming loop guard, and 12,000-token ceiling. Balanced selector ignores model materiality. Census is diagnostic only.</p>${cards}`;
  writeFileSync(path.join(outDir, "report.html"), html);
  console.log(`Report: ${path.join(outDir, "report.html")}`);
  if (results.some((result) => result.status === "failed")) process.exitCode = 1;
}

main().catch((error) => { console.error(error); process.exit(1); });
