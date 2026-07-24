#!/usr/bin/env node
// Run B — frozen-inventory argument call, N repeats. Runs the v2 argument call against a
// single fixed inventory (from run-discovery.mjs), removing discovery variance so the
// argument-call behaviour (treatment mix, testableAssertion quality) is attributable.
import "dotenv/config";
import { readFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createCf1ModelRunner } from "../../src/claim-foundry/modelRunner.js";
import { createOpenAiResponsesCf1Transport } from "../../src/claim-foundry/openAiResponsesTransport.js";
import { prepareCf3Article, normalizeArgument, CF3_DEFAULT_PORTFOLIO_SIZE } from "./pipeline.js";
import { buildCf3ArgumentPrompt } from "./prompts.js";
import { writeCf3Artifacts } from "./report.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const backend = path.resolve(here, "../..");
const root = path.resolve(backend, "..");
const option = (name, fallback = null) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
};

const fixture = option("--fixture", "CF1-F03");
const inventoryPath = option("--inventory", null);
if (!inventoryPath) throw new Error("--inventory <path to frozen repeatN-inventory.json> is required");
const repeats = Number(option("--repeats", "3"));
const portfolioSize = Number(option("--portfolio-size", String(CF3_DEFAULT_PORTFOLIO_SIZE)));
const argumentModel = option("--argument-model", "gpt-4.1-mini");
const timeoutMs = Number(option("--timeout-ms", "180000"));
const stamp = new Date().toISOString().replace(/[-:T.]/g, "").slice(0, 14).replace(/(\d{8})(\d{6})/, "$1-$2");
const outDir = path.resolve(option("--out",
  path.join(root, "artifacts/claim-foundry/cf3", `runB-${fixture.toLowerCase()}-${stamp}`)));

if (!process.env.OPENAI_API_KEY && !process.env.REACT_APP_OPENAI_API_KEY) {
  throw new Error("OPENAI_API_KEY is required");
}
const raw = JSON.parse(readFileSync(path.join(backend, "test/claim-foundry/fixtures", fixture, "article.json"), "utf8"));
const { article, sourceUnits } = prepareCf3Article(raw.article ?? raw);
const frozen = JSON.parse(readFileSync(path.resolve(inventoryPath), "utf8"));
const inventory = frozen.inventory;
if (frozen.article?.contentHash && frozen.article.contentHash !== article.contentHash) {
  throw new Error("frozen inventory contentHash does not match fixture — inventory/article mismatch");
}
const runner = createCf1ModelRunner({ transport: createOpenAiResponsesCf1Transport() });
mkdirSync(outDir, { recursive: true });

console.log(`Run B · ${fixture} · frozen inventory ${inventory.length} (${inventory.filter((x) => x.challenged).length} challenged)`
  + ` · ${repeats} repeats · ${argumentModel}`);
const selectionMode = option("--selection-mode", "balanced");
const prompt = buildCf3ArgumentPrompt({ article, sourceUnits, inventory, portfolioSize, selectionMode });
for (let r = 1; r <= repeats; r += 1) {
  const res = await runner.invokeStructured({
    ...prompt, model: argumentModel, reasoningEffort: "none", timeoutMs,
    maximumAttempts: 1, maxOutputTokens: 4000, store: false,
  });
  const mapped = normalizeArgument(res.output, inventory, sourceUnits, portfolioSize);
  const at = {}; mapped.assertions.forEach((a) => { at[a.articleTreatment] = (at[a.articleTreatment] || 0) + 1; });
  const codes = {}; mapped.findings.forEach((f) => { codes[f.code] = (codes[f.code] || 0) + 1; });
  writeCf3Artifacts({
    architecture: "CF3_RUN_B_FROZEN_INVENTORY", portfolioSize,
    article: { ...article, sourceUnitCount: sourceUnits.length },
    chunking: { chunkCount: 0, overlap: 0, chunks: [] },
    stanceAnchor: mapped.stanceAnchor, inventory, assertions: mapped.assertions,
    argumentBranches: mapped.branches, findings: mapped.findings,
    quarterDistribution: mapped.quarterDistribution,
    calls: { discovery: [], argument: { requestedModel: argumentModel, returnedModel: res.model ?? argumentModel,
      usage: res.usage ?? null, prompt, rawOutput: res.output, promptSha256: "", schemaSha256: "", elapsedMs: 0 } },
    elapsedMs: 0, generatedAt: new Date().toISOString(),
  }, path.join(outDir, `repeat${r}`));
  console.log(`  repeat ${r}: treatment ${JSON.stringify(at)} · findings ${JSON.stringify(codes)}`);
}
console.log(`reports → ${outDir}/repeatN/report.html`);
console.log(`Gate B: treatment mixed (not 12/12 reported) in ≥2/${repeats}; A009-class rows clean of `
  + `CF3_REPORTING_RESIDUE + CF3_SOURCE_FUSED + CF3_ASSERTION_VERBATIM_COPY; JCPH rows keep challenged.`);
