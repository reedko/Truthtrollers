#!/usr/bin/env node
// THROWAWAY dev probe: invoke ONLY CF1 Call 1 (semantic_inventory) N times on an article.
// No Call 2, no host critic, no verification, no assembly. Dumps each raw model output +
// token usage. For measuring Call-1 emission variance. Not production; delete when done.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import dotenv from "dotenv";
import { validateArticleInput } from "../../backend/src/claim-foundry/validateArticleInput.js";
import { articleDocumentFromText, buildArticleSourceBlocks } from "../../backend/src/claim-foundry/article-document/index.js";
import { buildSemanticInventoryPrompt } from "../../backend/src/claim-foundry/prompts/semanticInventoryPrompt.js";
import { createCf1ModelRunner } from "../../backend/src/claim-foundry/modelRunner.js";
import { createOpenAiCf1Transport } from "../../backend/src/claim-foundry/openAiTransport.js";

const args = process.argv.slice(2);
const value = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; };
const articlePath = value("--article");
const outDir = value("--out");
const runs = Number.parseInt(value("--runs") ?? "5", 10);
const model = value("--model") ?? "gpt-4o-mini";
if (!articlePath || !outDir) {
  console.error("Usage: node scripts/dev/cf1_call1_only.mjs --article <a.json> --out <dir> [--runs 5] [--model id]");
  process.exit(2);
}

dotenv.config({ path: path.resolve("backend/.env"), quiet: true });
const raw = JSON.parse(await readFile(path.resolve(articlePath), "utf8"));
const a = validateArticleInput(raw);
const doc = articleDocumentFromText({ text: a.text, metadata: { title: a.title, language: a.language } });
const blocks = buildArticleSourceBlocks(doc);
const prompt = buildSemanticInventoryPrompt({ article: a, structuralBlocks: blocks, sourceUnits: doc.sourceUnits });
const runner = createCf1ModelRunner({ transport: createOpenAiCf1Transport() });

await mkdir(path.resolve(outDir), { recursive: true });
let totalTokens = 0;
for (let i = 1; i <= runs; i += 1) {
  const res = await runner.invokeStructured({ ...prompt, model, temperature: 0,
    timeoutMs: 150_000, maximumAttempts: 1, maxOutputTokens: 4_000,
    usageContext: { component: "claim_foundry", path: "agent", stage: "semantic_inventory" } });
  const out = path.join(path.resolve(outDir), `inventory_run_${i}.json`);
  await writeFile(out, JSON.stringify(res.output, null, 2));
  totalTokens += res.usage?.totalTokens ?? 0;
  console.log(JSON.stringify({ run: i, file: out, tokens: res.usage?.totalTokens ?? null,
    candidates: res.output?.candidateClaims?.length ?? null,
    pillars: res.output?.pillars?.length ?? null }));
}
console.log(JSON.stringify({ runs, totalTokens, outDir: path.resolve(outDir) }, null, 2));
