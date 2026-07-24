#!/usr/bin/env node
import dotenv from "dotenv";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createCf1ModelRunner } from "../../src/claim-foundry/modelRunner.js";
import { createOpenAiCf1Transport } from "../../src/claim-foundry/openAiTransport.js";
import { createOpenAiResponsesCf1Transport }
  from "../../src/claim-foundry/openAiResponsesTransport.js";
import { runCf2 } from "./pipeline.js";
import { writeCf2Artifacts } from "./report.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const backend = path.resolve(here, "../..");
const root = path.resolve(backend, "..");
dotenv.config({ path: path.join(backend, ".env") });

function option(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const fixture = option("--fixture", "CF1-F03");
const fixturePath = path.join(backend, "test/claim-foundry/fixtures", fixture, "article.json");
const raw = JSON.parse(readFileSync(fixturePath, "utf8"));
const callAModel = option("--call-a-model", "gpt-4o-mini");
const callBModel = option("--call-b-model", "gpt-4.1-mini");
const timeoutMs = Number(option("--timeout-ms", "180000"));
const seedValue = option("--seed", null);
const seed = seedValue === null ? undefined : Number(seedValue);
const stamp = new Date().toISOString().replace(/[-:T.]/g, "").slice(0, 14)
  .replace(/(\d{8})(\d{6})/, "$1-$2");
const outDir = path.resolve(option("--out",
  path.join(root, "artifacts/claim-foundry/cf2", `${fixture.toLowerCase()}-${stamp}`)));

if (!process.env.OPENAI_API_KEY && !process.env.REACT_APP_OPENAI_API_KEY) {
  throw new Error("OPENAI_API_KEY is required");
}

const callARunner = createCf1ModelRunner({
  transport: createOpenAiCf1Transport(),
});
const callBRunner = createCf1ModelRunner({
  transport: createOpenAiResponsesCf1Transport(),
});

console.log(`CF2 ${fixture}: ${callAModel} Chat → ${callBModel} Responses`);
mkdirSync(outDir, { recursive: true });
const progress = [];
const result = await runCf2({
  rawArticle: raw.article ?? raw,
  callARunner,
  callBRunner,
  callAModel,
  callBModel,
  timeoutMs,
  seed,
  onProgress(event) {
    progress.push(event);
    writeFileSync(path.join(outDir, "progress.json"), `${JSON.stringify(progress, null, 2)}\n`);
    console.log(`${event.stage} · ${(event.call.elapsedMs / 1000).toFixed(1)}s`);
  },
});
writeCf2Artifacts(result, outDir);
console.log(`${result.candidates.length} candidates → ${result.assertions.length} assertions`);
console.log(`${(result.elapsedMs / 1000).toFixed(1)}s · ${outDir}`);
