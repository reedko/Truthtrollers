#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import dotenv from "dotenv";
import { articleDocumentFromText, buildArticleSourceBlocks } from
  "../../backend/src/claim-foundry/article-document/index.js";
import { createCf1ModelRunner } from "../../backend/src/claim-foundry/modelRunner.js";
import { createOpenAiCf1Transport } from "../../backend/src/claim-foundry/openAiTransport.js";
import { buildSemanticInventoryPrompt } from
  "../../backend/src/claim-foundry/prompts/semanticInventoryPrompt.js";
import { validateArticleInput } from "../../backend/src/claim-foundry/validateArticleInput.js";
import { verifySemanticInventory } from "../../backend/src/claim-foundry/twoCallAgentVerification.js";

function argument(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const articlePath = path.resolve(argument("--article") ?? "");
const artifactRoot = path.resolve(argument("--artifacts", "artifacts/claim-foundry/benchmarks/call1"));
const model = argument("--model", "gpt-4o-mini");
const count = Number(argument("--count", 5));
if (!argument("--article") || !Number.isInteger(count) || count < 1 || count > 20) {
  throw new Error("--article <article.json> and --count 1-20 are required");
}

dotenv.config({ path: path.resolve("backend/.env"), quiet: true });
let article = validateArticleInput(JSON.parse(await readFile(articlePath, "utf8")));
const document = articleDocumentFromText({ text: article.text,
  metadata: { title: article.title, language: article.language } });
article = { ...article, text: document.canonicalText, contentHash: document.contentHash };
const structuralBlocks = buildArticleSourceBlocks(document);
const prompt = buildSemanticInventoryPrompt({ article, structuralBlocks,
  sourceUnits: document.sourceUnits });
const runner = createCf1ModelRunner({ transport: createOpenAiCf1Transport() });
await mkdir(artifactRoot, { recursive: true });
const results = [];

for (let index = 1; index <= count; index += 1) {
  const startedAt = new Date().toISOString();
  const started = performance.now();
  const response = await runner.invokeStructured({ ...prompt, model, temperature: 0,
    timeoutMs: 75_000, maximumAttempts: 1, maxOutputTokens: 3_000,
    usageContext: { component: "claim_foundry", path: "benchmark", stage: "semantic_inventory" } });
  const elapsedMs = performance.now() - started;
  const output = verifySemanticInventory(response.output,
    { sourceUnits: document.sourceUnits, article, minimumCandidates: 8 });
  const result = { run: index, startedAt, elapsedMs: Math.round(elapsedMs),
    usage: response.usage, candidateCount: output.candidateClaims.length,
    pillarCount: output.pillars.length, namedWorkCount: output.namedWorks.length };
  results.push(result);
  await writeFile(path.join(artifactRoot, `semantic-inventory-${index}.json`),
    `${JSON.stringify(output, null, 2)}\n`);
  console.log(JSON.stringify(result));
}

const times = results.map((result) => result.elapsedMs).sort((a, b) => a - b);
const mean = times.reduce((sum, value) => sum + value, 0) / times.length;
const median = times[Math.floor(times.length / 2)];
const deviation = Math.sqrt(times.reduce((sum, value) => sum + (value - mean) ** 2, 0) / times.length);
const summary = { article: article.title, model, count, results,
  statistics: { minimumMs: times[0], maximumMs: times.at(-1), meanMs: Math.round(mean),
    medianMs: median, rangeMs: times.at(-1) - times[0], coefficientOfVariation: deviation / mean } };
await writeFile(path.join(artifactRoot, "call1-benchmark.json"),
  `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify({ artifactRoot, statistics: summary.statistics }, null, 2));
