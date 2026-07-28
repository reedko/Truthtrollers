#!/usr/bin/env node
// CF5 Prompt Experiment 1 runner — Prompt B only (the modified duplication-boundary
// text). Prompt A's data is reused from the existing production sweep
// (sweep-20260726-080222), since it used identical model/settings/schema/
// preprocessing/validation/repair on the same fixtures — re-running it would not
// change anything and would only add cost. This script writes Prompt B's output to a
// separate artifacts path so the two are never conflated.
import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createCf1ModelRunner } from "../../src/claim-foundry/modelRunner.js";
import { createOpenAiResponsesCf1Transport } from "../../src/claim-foundry/openAiResponsesTransport.js";
import { buildCf5ClaimGenerationPromptVariantB } from "./promptExperiment1.js";
import { buildCf5RepairPrompt, CF5_REPAIR_PROMPT_VERSION } from "./prompts.js";
import { CF5_CLAIMS_SCHEMA_V1 } from "./schemas.js";
import { runGenerationPipeline } from "./pipeline.js";
import { loadFixtureArticle } from "./run-cf5.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../..");
const option = (name, fallback = null) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
};

const fixtures = (option("--fixtures", "CF1-F02,CF1-F03,CF1-F06")).split(",");
const repeats = Number(option("--repeats", "5"));
const model = option("--model", "gpt-4.1-mini");
const timeoutMs = Number(option("--timeout-ms", "180000"));
const outDir = path.resolve(option("--out",
  path.join(root, "artifacts/claim-foundry/cf5-experiment1")));

if (!process.env.OPENAI_API_KEY && !process.env.REACT_APP_OPENAI_API_KEY) {
  throw new Error("OPENAI_API_KEY is required");
}

const runner = createCf1ModelRunner({ transport: createOpenAiResponsesCf1Transport() });
mkdirSync(outDir, { recursive: true });
console.log(`CF5 Experiment 1 · Prompt B · fixtures: ${fixtures.join(", ")} · ${repeats} repeats · ${model}`);

for (const fixture of fixtures) {
  const fixtureDir = path.join(outDir, fixture.toLowerCase());
  mkdirSync(fixtureDir, { recursive: true });
  const { article, units } = loadFixtureArticle(fixture);
  const knownUnitIds = new Set(units.map((u) => u.unitId));
  const prompt = buildCf5ClaimGenerationPromptVariantB({ article, units });
  writeFileSync(path.join(fixtureDir, "generation-prompt-variant-b.txt"),
    `SYSTEM\n${prompt.system}\n\nUSER\n${prompt.user}\n`);
  writeFileSync(path.join(fixtureDir, "source-units.json"), JSON.stringify(units, null, 2));

  for (let r = 1; r <= repeats; r += 1) {
    const repeatDir = path.join(fixtureDir, `repeat${r}`);
    mkdirSync(repeatDir, { recursive: true });
    try {
      const genRes = await runner.invokeStructured({
        ...prompt, model, reasoningEffort: "none", timeoutMs,
        maximumAttempts: 1, maxOutputTokens: 6000, store: false,
      });
      writeFileSync(path.join(repeatDir, "raw-model-response.json"), JSON.stringify(genRes.rawResponse, null, 2));
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

      writeFileSync(path.join(repeatDir, "final-claims.json"), JSON.stringify(result.finalClaims, null, 2));
      writeFileSync(path.join(repeatDir, "validation-report.json"), JSON.stringify({
        firstPassFindings: result.firstPassFindings,
        hardFailureClaimIds: [...result.hardFailureClaimIds],
        repairUsed: Boolean(result.repairResult),
      }, null, 2));
      writeFileSync(path.join(repeatDir, "usage.json"), JSON.stringify(totalUsage, null, 2));
      writeFileSync(path.join(repeatDir, "run-manifest.json"), JSON.stringify({
        schemaVersion: "cf5.experiment1RunManifest.v1", fixtureId: fixture, repeat: r,
        promptVariant: "B", model, resolvedModel: genRes.model,
        repairPromptVersion: result.repairResult ? CF5_REPAIR_PROMPT_VERSION : null,
        claimsSchemaVersion: CF5_CLAIMS_SCHEMA_V1.name,
        repairUsed: Boolean(result.repairResult), finalClaimCount: result.finalClaims.length,
        usage: totalUsage,
      }, null, 2));
      console.log(`  ${fixture} repeat ${r}: ${result.finalClaims.length} claims`
        + (result.repairResult ? " (repaired)" : ""));
    } catch (error) {
      console.log(`  ${fixture} repeat ${r}: FAILED ${error.message}`);
    }
  }
}
console.log(`artifacts → ${outDir}`);
