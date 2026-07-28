#!/usr/bin/env node
// CF5 Prompt Experiment 2 runner. Prompt A data is reused from Experiment 1's Prompt B
// runs (now the adopted production prompt) — same model/settings/schema/preprocessing/
// validation/repair, exactly comparable per the experiment's own reuse rule — reshaped
// into this experiment's directory layout with the same manifest shape Prompt B's
// fresh runs use, so the report builder can treat both arms uniformly. Prompt B (the
// one-sentence addition) is run fresh: 3 fixtures x 3 repeats = 9 generation calls.
import "dotenv/config";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { createCf1ModelRunner } from "../../src/claim-foundry/modelRunner.js";
import { createOpenAiResponsesCf1Transport } from "../../src/claim-foundry/openAiResponsesTransport.js";
import { buildCf5ClaimGenerationPrompt } from "./prompts.js";
import { buildCf5ClaimGenerationPromptExperiment2VariantB } from "./promptExperiment2.js";
import { buildCf5RepairPrompt, CF5_REPAIR_PROMPT_VERSION, CF5_GENERATION_PROMPT_VERSION } from "./prompts.js";
import { CF5_CLAIMS_SCHEMA_V1 } from "./schemas.js";
import { runGenerationPipeline } from "./pipeline.js";
import { loadFixtureArticle } from "./run-cf5.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../..");
const outDir = path.resolve(root, "artifacts/claim-foundry/cf5-experiment2");
const experiment1Dir = path.resolve(root, "artifacts/claim-foundry/cf5-experiment1");
const fixtures = ["CF1-F02", "CF1-F03", "CF1-F06"];
const model = "gpt-4.1-mini";
const timeoutMs = 180000;

const hash = (text) => createHash("sha256").update(text).digest("hex").slice(0, 16);

if (!process.env.OPENAI_API_KEY && !process.env.REACT_APP_OPENAI_API_KEY) {
  throw new Error("OPENAI_API_KEY is required");
}

const promptAText = readFileSync(path.join(outDir, "prompt_a.txt"), "utf8");
const promptBText = readFileSync(path.join(outDir, "prompt_b.txt"), "utf8");
const promptAHash = hash(promptAText);
const promptBHash = hash(promptBText);
const schemaHash = hash(JSON.stringify(CF5_CLAIMS_SCHEMA_V1));

const runner = createCf1ModelRunner({ transport: createOpenAiResponsesCf1Transport() });
mkdirSync(outDir, { recursive: true });

const runIndex = []; // for run_config.json / results.json assembly

for (const fixture of fixtures) {
  const fixtureDir = path.join(outDir, fixture.toLowerCase());
  mkdirSync(fixtureDir, { recursive: true });
  const { article, units } = loadFixtureArticle(fixture);
  const knownUnitIds = new Set(units.map((u) => u.unitId));
  writeFileSync(path.join(fixtureDir, "source-units.json"), JSON.stringify(units, null, 2));

  // --- Prompt A: reuse Experiment 1's first 3 Prompt-B repeats ---
  for (let r = 1; r <= 3; r += 1) {
    const srcDir = path.join(experiment1Dir, fixture.toLowerCase(), `repeat${r}`);
    const destDir = path.join(fixtureDir, `promptA_repeat${r}`);
    mkdirSync(destDir, { recursive: true });
    const rawResponse = JSON.parse(readFileSync(path.join(srcDir, "raw-model-response.json"), "utf8"));
    const finalClaims = JSON.parse(readFileSync(path.join(srcDir, "final-claims.json"), "utf8"));
    const validationReport = JSON.parse(readFileSync(path.join(srcDir, "validation-report.json"), "utf8"));
    const srcManifest = JSON.parse(readFileSync(path.join(srcDir, "run-manifest.json"), "utf8"));
    writeFileSync(path.join(destDir, "raw-model-response.json"), JSON.stringify(rawResponse, null, 2));
    writeFileSync(path.join(destDir, "final-claims.json"), JSON.stringify(finalClaims, null, 2));
    writeFileSync(path.join(destDir, "validation-report.json"), JSON.stringify(validationReport, null, 2));
    const manifest = {
      schemaVersion: "cf5.experiment2RunManifest.v1",
      fixtureId: fixture, promptArm: "A", repeat: r,
      reusedFromExperiment1: true, reusedFromPath: srcDir,
      requestedModel: model, returnedModel: srcManifest.resolvedModel,
      promptVersion: CF5_GENERATION_PROMPT_VERSION, promptHash: promptAHash, schemaHash,
      usage: srcManifest.usage,
      latencySeconds: rawResponse.completed_at - rawResponse.created_at,
      repairUsed: srcManifest.repairUsed, finalClaimCount: finalClaims.length,
      hardFailureClaimIds: validationReport.hardFailureClaimIds ?? [],
    };
    writeFileSync(path.join(destDir, "run-manifest.json"), JSON.stringify(manifest, null, 2));
    runIndex.push({ fixture, arm: "A", repeat: r, dir: destDir, manifest, finalClaims });
    console.log(`  ${fixture} Prompt A repeat ${r}: reused (${finalClaims.length} claims)`);
  }

  // --- Prompt B: fresh, 3 repeats ---
  const promptB = buildCf5ClaimGenerationPromptExperiment2VariantB({ article, units });
  for (let r = 1; r <= 3; r += 1) {
    const destDir = path.join(fixtureDir, `promptB_repeat${r}`);
    mkdirSync(destDir, { recursive: true });
    const started = performance.now();
    const genRes = await runner.invokeStructured({
      ...promptB, model, reasoningEffort: "none", timeoutMs,
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
      schemaVersion: "cf5.experiment2RunManifest.v1",
      fixtureId: fixture, promptArm: "B", repeat: r,
      reusedFromExperiment1: false,
      requestedModel: model, returnedModel: genRes.model,
      promptVersion: "cf5-generation-experiment2-variant-b", promptHash: promptBHash, schemaHash,
      usage: totalUsage, latencySeconds,
      repairUsed: Boolean(result.repairResult), finalClaimCount: result.finalClaims.length,
      hardFailureClaimIds: [...result.hardFailureClaimIds],
    };
    writeFileSync(path.join(destDir, "run-manifest.json"), JSON.stringify(manifest, null, 2));
    runIndex.push({ fixture, arm: "B", repeat: r, dir: destDir, manifest, finalClaims: result.finalClaims });
    console.log(`  ${fixture} Prompt B repeat ${r}: ${result.finalClaims.length} claims`
      + (result.repairResult ? " (repaired)" : ""));
  }
}

writeFileSync(path.join(outDir, "run_config.json"), JSON.stringify({
  schemaVersion: "cf5.experiment2RunConfig.v1",
  objective: "Test whether adding a counterfactual-independence sentence to the proposition-distinctness guidance further improves recovery of independently gradable propositions, without introducing duplicates or excessive splitting.",
  fixtures, model, reasoningEffort: "none", timeoutMs, maxOutputTokensGeneration: 6000, maxOutputTokensRepair: 3000,
  repeatsPerFixturePerArm: 3, totalGenerationRuns: fixtures.length * 3 * 2,
  promptARouting: "reused from cf5-experiment1's Prompt B runs (repeat1-3), now the adopted production prompt; exactly comparable model/settings/schema/preprocessing/validation/repair",
  promptBRouting: "run fresh in this experiment",
  promptAHash, promptBHash, schemaHash,
  claimsSchemaVersion: CF5_CLAIMS_SCHEMA_V1.name,
  generatedAt: new Date().toISOString(),
}, null, 2));

writeFileSync(path.join(outDir, "results.json"), JSON.stringify(
  runIndex.map(({ dir, ...rest }) => ({ ...rest, dir: path.relative(outDir, dir) })), null, 2));

console.log(`\nExperiment 2 runs complete → ${outDir}`);
