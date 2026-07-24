#!/usr/bin/env node
import "dotenv/config";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createCf1ModelRunner } from "../../src/claim-foundry/modelRunner.js";
import { createOpenAiCf1Transport } from "../../src/claim-foundry/openAiTransport.js";
import { createOpenAiResponsesCf1Transport }
  from "../../src/claim-foundry/openAiResponsesTransport.js";
import { runCf3, CF3_DEFAULT_PORTFOLIO_SIZE } from "./pipeline.js";
import { writeCf3Artifacts } from "./report.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const backend = path.resolve(here, "../..");
const root = path.resolve(backend, "..");

function option(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const fixture = option("--fixture", "CF1-F03");
const fixturePath = path.join(backend, "test/claim-foundry/fixtures", fixture, "article.json");
const raw = JSON.parse(readFileSync(fixturePath, "utf8"));
const discoveryModel = option("--discovery-model", "gpt-4o-mini");
const argumentModel = option("--argument-model", "gpt-4.1-mini");
const argumentReasoningEffort = option("--argument-effort", "none");
const argumentMaxOutputTokens = Number(option("--argument-max-tokens", "4000"));
const portfolioSize = Number(option("--portfolio-size", String(CF3_DEFAULT_PORTFOLIO_SIZE)));
const chunkCount = Number(option("--chunks", "4"));
const timeoutMs = Number(option("--timeout-ms", "180000"));
const seedValue = option("--seed", null);
const seed = seedValue === null ? undefined : Number(seedValue);
const stamp = new Date().toISOString().replace(/[-:T.]/g, "").slice(0, 14)
  .replace(/(\d{8})(\d{6})/, "$1-$2");
const outDir = path.resolve(option("--out",
  path.join(root, "artifacts/claim-foundry/cf3", `${fixture.toLowerCase()}-${stamp}`)));

if (!process.env.OPENAI_API_KEY && !process.env.REACT_APP_OPENAI_API_KEY) {
  throw new Error("OPENAI_API_KEY is required");
}

const discoveryRunner = createCf1ModelRunner({
  transport: createOpenAiCf1Transport(),
});
const argumentRunner = createCf1ModelRunner({
  transport: createOpenAiResponsesCf1Transport(),
});

console.log(`CF3 ${fixture}: ${chunkCount}× ${discoveryModel} Chat → ${argumentModel} Responses`
  + ` (effort ${argumentReasoningEffort}, max_output ${argumentMaxOutputTokens})`);
const result = await runCf3({
  rawArticle: raw.article ?? raw,
  discoveryRunner,
  argumentRunner,
  discoveryModel,
  argumentModel,
  argumentReasoningEffort,
  argumentMaxOutputTokens,
  portfolioSize,
  chunkCount,
  timeoutMs,
  seed,
});
writeCf3Artifacts(result, outDir);
console.log(`${result.inventory.length} inventory → ${result.assertions.length} selected`
  + ` · quarters ${result.quarterDistribution.join("/")}`
  + ` · ${result.findings.length} findings`);
console.log(`${(result.elapsedMs / 1000).toFixed(1)}s · ${outDir}`);
