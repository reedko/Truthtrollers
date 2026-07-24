#!/usr/bin/env node
// Run A — discovery stage only, N repeats. Reports per-repeat challengedAssertions and
// inventory counts, and freezes each repeat's inventory for Run B (run-argument.mjs).
import "dotenv/config";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createCf1ModelRunner } from "../../src/claim-foundry/modelRunner.js";
import { createOpenAiCf1Transport } from "../../src/claim-foundry/openAiTransport.js";
import {
  prepareCf3Article, splitStructural, normalizeChunkDiscovery, buildInventory,
  CF3_DEFAULT_CHUNK_COUNT, CF3_DEFAULT_CHUNK_OVERLAP,
} from "./pipeline.js";
import { buildCf3DiscoveryPrompt } from "./prompts.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const backend = path.resolve(here, "../..");
const root = path.resolve(backend, "..");
const option = (name, fallback = null) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
};

const fixture = option("--fixture", "CF1-F03");
const repeats = Number(option("--repeats", "3"));
const chunkCount = Number(option("--chunks", String(CF3_DEFAULT_CHUNK_COUNT)));
const discoveryModel = option("--discovery-model", "gpt-4o-mini");
const seedBase = option("--seed", null);
const timeoutMs = Number(option("--timeout-ms", "180000"));
// Optional fixture-specific gate: unit range whose items must NOT be filed as
// challenged (e.g. F03 Thompson cluster "U0037-U0044"). Reported per repeat.
const watchRange = option("--challenged-must-exclude", null);
const [watchLo, watchHi] = watchRange
  ? watchRange.replace(/U/gi, "").split("-").map(Number) : [null, null];
const inWatch = (ids) => watchLo != null
  && ids.some((u) => { const n = Number(u.slice(1)); return n >= watchLo && n <= watchHi; });
const stamp = new Date().toISOString().replace(/[-:T.]/g, "").slice(0, 14).replace(/(\d{8})(\d{6})/, "$1-$2");
const outDir = path.resolve(option("--out",
  path.join(root, "artifacts/claim-foundry/cf3", `runA-${fixture.toLowerCase()}-${stamp}`)));

if (!process.env.OPENAI_API_KEY && !process.env.REACT_APP_OPENAI_API_KEY) {
  throw new Error("OPENAI_API_KEY is required");
}
const raw = JSON.parse(readFileSync(path.join(backend, "test/claim-foundry/fixtures", fixture, "article.json"), "utf8"));
const { article, sourceUnits } = prepareCf3Article(raw.article ?? raw);
const chunks = splitStructural(sourceUnits, { count: chunkCount, overlap: CF3_DEFAULT_CHUNK_OVERLAP });
const runner = createCf1ModelRunner({ transport: createOpenAiCf1Transport() });
mkdirSync(outDir, { recursive: true });

console.log(`Run A · ${fixture} · ${repeats} repeats · ${chunkCount}× ${discoveryModel} discovery`);
for (let r = 1; r <= repeats; r += 1) {
  const seed = seedBase === null ? undefined : Number(seedBase) + r;
  const prompts = chunks.map((chunk) => buildCf3DiscoveryPrompt({ chunk }));
  const results = await Promise.all(prompts.map((prompt) => runner.invokeStructured({
    ...prompt, model: discoveryModel, temperature: 0.2,
    ...(Number.isInteger(seed) ? { seed } : {}), timeoutMs, maximumAttempts: 1, maxOutputTokens: 5000,
  })));
  const chunkResults = chunks.map((chunk, i) => normalizeChunkDiscovery(results[i].output, chunk));
  const perChunkChallenged = results.map((res) => (res.output.challengedAssertions ?? []).length);
  const inventory = buildInventory(chunkResults);
  const invChallenged = inventory.filter((x) => x.challenged).length;
  const watchInChallenged = inventory.filter((x) => x.challenged && inWatch(x.groundingUnitIds)).length;
  writeFileSync(path.join(outDir, `repeat${r}-inventory.json`),
    `${JSON.stringify({ fixture, article: { title: article.title, contentHash: article.contentHash }, inventory }, null, 2)}\n`);
  console.log(`  repeat ${r}: inventory ${inventory.length} · challenged ${invChallenged}`
    + ` · per-chunk challengedAssertions [${perChunkChallenged.join(", ")}]`
    + (watchRange ? ` · watch-range mis-filed challenged ${watchInChallenged} (want 0)` : ""));
}
console.log(`frozen inventories → ${outDir}`);
console.log(`Gate A (1): JCPH ad assertions appear in challengedAssertions in ≥2/${repeats} repeats (inspect repeatN-inventory.json).`);
console.log(`Gate A (2): zero ${watchRange ?? "watch-range"} items filed as challenged across repeats.`);
