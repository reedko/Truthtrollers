#!/usr/bin/env node
// CF5 PromptCF5-v002 blind regression runner. v0001 data reused from
// cf5-experiment2's Prompt A runs (verified byte-identical to current production
// PromptCF5-v0001 — see prompt_diff.txt). v0002 (nonsense-token swap) run fresh:
// F02/F03/F06 x 3 repeats = 9 generation calls. Same model/settings/schema/
// preprocessing/validation/repair as every other CF5 run this cycle.
import "dotenv/config";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import { createCf1ModelRunner } from "../../src/claim-foundry/modelRunner.js";
import { createOpenAiResponsesCf1Transport } from "../../src/claim-foundry/openAiResponsesTransport.js";
import { buildPromptCF5v002, PROMPT_CF5_V002_VERSION } from "./promptCF5v002.js";
import { buildCf5RepairPrompt, CF5_REPAIR_PROMPT_VERSION, CF5_GENERATION_PROMPT_VERSION } from "./prompts.js";
import { CF5_CLAIMS_SCHEMA_V1 } from "./schemas.js";
import { runGenerationPipeline } from "./pipeline.js";
import { loadFixtureArticle } from "./run-cf5.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../..");
const outDir = path.resolve(root, "artifacts/claim-foundry/cf5-promptcf5-v002");
const experiment2Dir = path.resolve(root, "artifacts/claim-foundry/cf5-experiment2");
const fixtures = ["CF1-F02", "CF1-F03", "CF1-F06"];
const model = "gpt-4.1-mini";
const timeoutMs = 180000;

const hash = (text) => createHash("sha256").update(text).digest("hex").slice(0, 16);
let gitCommit = "unknown";
try { gitCommit = execSync("git rev-parse HEAD", { cwd: root }).toString().trim(); } catch { /* not fatal */ }

if (!process.env.OPENAI_API_KEY && !process.env.REACT_APP_OPENAI_API_KEY) {
  throw new Error("OPENAI_API_KEY is required");
}

const promptV0001Text = readFileSync(path.join(outDir, "prompt_v0001.txt"), "utf8");
const promptV0002Text = readFileSync(path.join(outDir, "prompt_v0002.txt"), "utf8");
const promptV0001Hash = hash(promptV0001Text);
const promptV0002Hash = hash(promptV0002Text);
const schemaHash = hash(JSON.stringify(CF5_CLAIMS_SCHEMA_V1));

const runner = createCf1ModelRunner({ transport: createOpenAiResponsesCf1Transport() });
mkdirSync(outDir, { recursive: true });

const runIndex = [];

for (const fixture of fixtures) {
  const fixtureDir = path.join(outDir, fixture.toLowerCase());
  mkdirSync(fixtureDir, { recursive: true });
  const { article, units } = loadFixtureArticle(fixture);
  const knownUnitIds = new Set(units.map((u) => u.unitId));
  writeFileSync(path.join(fixtureDir, "source-units.json"), JSON.stringify(units, null, 2));

  // --- v0001: reuse cf5-experiment2's Prompt A repeats (verified byte-identical) ---
  for (let r = 1; r <= 3; r += 1) {
    const srcDir = path.join(experiment2Dir, fixture.toLowerCase(), `promptA_repeat${r}`);
    const destDir = path.join(fixtureDir, `v0001_repeat${r}`);
    mkdirSync(destDir, { recursive: true });
    const rawResponse = JSON.parse(readFileSync(path.join(srcDir, "raw-model-response.json"), "utf8"));
    const finalClaims = JSON.parse(readFileSync(path.join(srcDir, "final-claims.json"), "utf8"));
    const validationReport = JSON.parse(readFileSync(path.join(srcDir, "validation-report.json"), "utf8"));
    const srcManifest = JSON.parse(readFileSync(path.join(srcDir, "run-manifest.json"), "utf8"));
    writeFileSync(path.join(destDir, "raw-model-response.json"), JSON.stringify(rawResponse, null, 2));
    writeFileSync(path.join(destDir, "final-claims.json"), JSON.stringify(finalClaims, null, 2));
    writeFileSync(path.join(destDir, "validation-report.json"), JSON.stringify(validationReport, null, 2));
    const manifest = {
      schemaVersion: "cf5.promptV002RunManifest.v1",
      fixtureId: fixture, promptVersion: "PromptCF5-v0001", repeat: r,
      reusedFrom: srcDir,
      requestedModel: model, returnedModel: srcManifest.returnedModel,
      promptHash: promptV0001Hash, schemaHash, gitCommit,
      usage: srcManifest.usage,
      latencySeconds: rawResponse.completed_at - rawResponse.created_at,
      repairUsed: srcManifest.repairUsed, finalClaimCount: finalClaims.length,
      hardFailureClaimIds: validationReport.hardFailureClaimIds ?? [],
    };
    writeFileSync(path.join(destDir, "run-manifest.json"), JSON.stringify(manifest, null, 2));
    runIndex.push({ fixture, promptVersion: "PromptCF5-v0001", repeat: r, dir: destDir, manifest, finalClaims });
    console.log(`  ${fixture} v0001 repeat ${r}: reused (${finalClaims.length} claims)`);
  }

  // --- v0002: fresh, 3 repeats ---
  const promptV0002 = buildPromptCF5v002({ article, units });
  for (let r = 1; r <= 3; r += 1) {
    const destDir = path.join(fixtureDir, `v0002_repeat${r}`);
    mkdirSync(destDir, { recursive: true });
    const started = performance.now();
    const genRes = await runner.invokeStructured({
      ...promptV0002, model, reasoningEffort: "none", timeoutMs,
      maximumAttempts: 1, maxOutputTokens: 6000, store: false,
    });
    const latencySeconds = (performance.now() - started) / 1000;
    writeFileSync(path.join(destDir, "raw-model-response.json"), JSON.stringify(genRes.rawResponse, null, 2));
    const rawClaims = genRes.output.claims ?? [];
    let totalUsage = { ...genRes.usage };

    const result = await runGenerationPipeline({
      rawClaims, knownUnitIds,
      repair: async ({ failedClaims, errors }) => {
        const repairPrompt = buildCf5RepairPrompt({ article, units, failedClaims, errors, validUnitIds: [...knownUnitIds] });
        const repairRes = await runner.invokeStructured({
          ...repairPrompt, model, reasoningEffort: "none", timeoutMs,
          maximumAttempts: 1, maxOutputTokens: 3000, store: false,
        });
        for (const key of Object.keys(totalUsage)) totalUsage[key] = (totalUsage[key] ?? 0) + (repairRes.usage?.[key] ?? 0);
        return { repairedClaims: repairRes.output.repairedClaims ?? [], rawResponse: repairRes.rawResponse, usage: repairRes.usage, model: repairRes.model };
      },
    });

    writeFileSync(path.join(destDir, "final-claims.json"), JSON.stringify(result.finalClaims, null, 2));
    writeFileSync(path.join(destDir, "validation-report.json"), JSON.stringify({
      firstPassFindings: result.firstPassFindings,
      hardFailureClaimIds: [...result.hardFailureClaimIds],
      repairUsed: Boolean(result.repairResult),
    }, null, 2));
    const manifest = {
      schemaVersion: "cf5.promptV002RunManifest.v1",
      fixtureId: fixture, promptVersion: PROMPT_CF5_V002_VERSION, repeat: r,
      reusedFrom: null,
      requestedModel: model, returnedModel: genRes.model,
      promptHash: promptV0002Hash, schemaHash, gitCommit,
      usage: totalUsage, latencySeconds,
      repairUsed: Boolean(result.repairResult), finalClaimCount: result.finalClaims.length,
      hardFailureClaimIds: [...result.hardFailureClaimIds],
    };
    writeFileSync(path.join(destDir, "run-manifest.json"), JSON.stringify(manifest, null, 2));
    runIndex.push({ fixture, promptVersion: PROMPT_CF5_V002_VERSION, repeat: r, dir: destDir, manifest, finalClaims: result.finalClaims });
    console.log(`  ${fixture} v0002 repeat ${r}: ${result.finalClaims.length} claims`
      + (result.repairResult ? " (repaired)" : ""));
  }
}

writeFileSync(path.join(outDir, "run_config.json"), JSON.stringify({
  schemaVersion: "cf5.promptV002RunConfig.v1",
  objective: "Test whether replacing every model-facing occurrence of proposition/propositions "
    + "with a nonsense token (qzavrympthunexoljibwok) degrades CF5 claim generation — i.e. whether "
    + "the specific semantic word matters or the task is learnable purely from the surrounding "
    + "structural instructions.",
  fixtures, model, reasoningEffort: "none", timeoutMs,
  repeatsPerFixturePerVersion: 3, totalGenerationRuns: fixtures.length * 3 * 2,
  v0001Routing: "reused from cf5-experiment2's Prompt A runs, verified byte-identical to current production prompts.js",
  v0002Routing: "run fresh in this experiment",
  promptV0001Hash, promptV0002Hash, schemaHash, gitCommit,
  claimsSchemaVersion: CF5_CLAIMS_SCHEMA_V1.name,
  generatedAt: new Date().toISOString(),
}, null, 2));

writeFileSync(path.join(outDir, "results.json"), JSON.stringify(
  runIndex.map(({ dir, ...rest }) => ({ ...rest, dir: path.relative(outDir, dir) })), null, 2));

console.log(`\nPromptCF5-v002 blind regression complete → ${outDir}`);
