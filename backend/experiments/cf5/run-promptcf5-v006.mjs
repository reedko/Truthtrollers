#!/usr/bin/env node
// CF5 PromptCF5-v0006 blind regression runner. v0001 data reused from
// cf5-promptcf5-v002's v0001_repeat1 run (same source already reused unmodified for
// the v0003/v0004 and v0005 experiments). v0006 ("thematic single-predication
// assertions") runs fresh: F02/F03/F06 x 2 repeats = 6 generation calls. No changes to
// model/settings/schema/preprocessing/validation/repair — reuses
// pipeline.js/validation.js/schemas.js exactly as-is. v0001 remains at 1 repeat (as in
// every prior experiment this cycle); v0006 gets 2 repeats per the user's explicit
// request, so exactTextStability/targetBasedStability are computable for v0006 but
// remain null for v0001 (regressionAnalysis.js's existing, unmodified behavior).
import "dotenv/config";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import { createCf1ModelRunner } from "../../src/claim-foundry/modelRunner.js";
import { createOpenAiResponsesCf1Transport } from "../../src/claim-foundry/openAiResponsesTransport.js";
import { buildPromptCF5v006, PROMPT_CF5_V006_VERSION } from "./promptCF5v006.js";
import { buildCf5RepairPrompt } from "./prompts.js";
import { CF5_CLAIMS_SCHEMA_V1 } from "./schemas.js";
import { runGenerationPipeline } from "./pipeline.js";
import { loadFixtureArticle } from "./run-cf5.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../..");
const outDir = path.resolve(root, "artifacts/claim-foundry/cf5-promptcf5-v006");
const v002Dir = path.resolve(root, "artifacts/claim-foundry/cf5-promptcf5-v002");
const fixtures = ["CF1-F02", "CF1-F03", "CF1-F06"];
const repeats = 2;
const model = "gpt-4.1-mini";
const timeoutMs = 180000;

const hash = (text) => createHash("sha256").update(text).digest("hex").slice(0, 16);
let gitCommit = "unknown";
try { gitCommit = execSync("git rev-parse HEAD", { cwd: root }).toString().trim(); } catch { /* not fatal */ }

if (!process.env.OPENAI_API_KEY && !process.env.REACT_APP_OPENAI_API_KEY) {
  throw new Error("OPENAI_API_KEY is required");
}

const promptV0001Hash = hash(readFileSync(path.join(outDir, "prompt_v0001.txt"), "utf8"));
const promptV0006Hash = hash(readFileSync(path.join(outDir, "prompt_v0006.txt"), "utf8"));
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

  // --- v0001: reuse v002 experiment's v0001_repeat1 (verified available) ---
  const srcDir = path.join(v002Dir, fixture.toLowerCase(), "v0001_repeat1");
  const destDir = path.join(fixtureDir, "v0001_repeat1");
  mkdirSync(destDir, { recursive: true });
  const rawResponse = JSON.parse(readFileSync(path.join(srcDir, "raw-model-response.json"), "utf8"));
  const finalClaims = JSON.parse(readFileSync(path.join(srcDir, "final-claims.json"), "utf8"));
  const validationReport = JSON.parse(readFileSync(path.join(srcDir, "validation-report.json"), "utf8"));
  const srcManifest = JSON.parse(readFileSync(path.join(srcDir, "run-manifest.json"), "utf8"));
  writeFileSync(path.join(destDir, "raw-model-response.json"), JSON.stringify(rawResponse, null, 2));
  writeFileSync(path.join(destDir, "final-claims.json"), JSON.stringify(finalClaims, null, 2));
  writeFileSync(path.join(destDir, "validation-report.json"), JSON.stringify(validationReport, null, 2));
  const v0001Manifest = {
    schemaVersion: "cf5.promptV006RunManifest.v1",
    fixtureId: fixture, promptVersion: "PromptCF5-v0001", repeat: 1,
    reusedFrom: srcDir,
    requestedModel: model, returnedModel: srcManifest.returnedModel,
    promptHash: promptV0001Hash, schemaHash, gitCommit,
    usage: srcManifest.usage,
    latencySeconds: rawResponse.completed_at - rawResponse.created_at,
    repairUsed: srcManifest.repairUsed, finalClaimCount: finalClaims.length,
    hardFailureClaimIds: validationReport.hardFailureClaimIds ?? [],
  };
  writeFileSync(path.join(destDir, "run-manifest.json"), JSON.stringify(v0001Manifest, null, 2));
  runIndex.push({ fixture, promptVersion: "PromptCF5-v0001", repeat: 1, dir: destDir, manifest: v0001Manifest, finalClaims });
  console.log(`  ${fixture} v0001 repeat 1: reused (${finalClaims.length} claims)`);

  // --- v0006: fresh, 2 repeats ---
  for (let repeat = 1; repeat <= repeats; repeat++) {
    const versionDestDir = path.join(fixtureDir, `v0006_repeat${repeat}`);
    mkdirSync(versionDestDir, { recursive: true });
    const prompt = buildPromptCF5v006({ article, units });
    const started = performance.now();
    const genRes = await runner.invokeStructured({
      ...prompt, model, reasoningEffort: "none", timeoutMs,
      maximumAttempts: 1, maxOutputTokens: 6000, store: false,
    });
    const latencySeconds = (performance.now() - started) / 1000;
    writeFileSync(path.join(versionDestDir, "raw-model-response.json"), JSON.stringify(genRes.rawResponse, null, 2));
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

    writeFileSync(path.join(versionDestDir, "final-claims.json"), JSON.stringify(result.finalClaims, null, 2));
    writeFileSync(path.join(versionDestDir, "validation-report.json"), JSON.stringify({
      firstPassFindings: result.firstPassFindings,
      hardFailureClaimIds: [...result.hardFailureClaimIds],
      repairUsed: Boolean(result.repairResult),
    }, null, 2));
    const manifest = {
      schemaVersion: "cf5.promptV006RunManifest.v1",
      fixtureId: fixture, promptVersion: PROMPT_CF5_V006_VERSION, repeat,
      reusedFrom: null,
      requestedModel: model, returnedModel: genRes.model,
      promptHash: promptV0006Hash, schemaHash, gitCommit,
      usage: totalUsage, latencySeconds,
      repairUsed: Boolean(result.repairResult), finalClaimCount: result.finalClaims.length,
      hardFailureClaimIds: [...result.hardFailureClaimIds],
    };
    writeFileSync(path.join(versionDestDir, "run-manifest.json"), JSON.stringify(manifest, null, 2));
    runIndex.push({ fixture, promptVersion: PROMPT_CF5_V006_VERSION, repeat, dir: versionDestDir, manifest, finalClaims: result.finalClaims });
    console.log(`  ${fixture} ${PROMPT_CF5_V006_VERSION} repeat ${repeat}: ${result.finalClaims.length} claims`
      + (result.repairResult ? " (repaired)" : ""));
  }
}

writeFileSync(path.join(outDir, "run_config.json"), JSON.stringify({
  schemaVersion: "cf5.promptV006RunConfig.v1",
  objective: "Evaluate PromptCF5-v0006 against PromptCF5-v0001. v0006 reframes "
    + "ClaimFoundry as extracting 'foundational thematic assertions' via minimum "
    + "single-predication coverage of each contiguous argumentative theme, rather than "
    + "a minimal (v0001) or maximal-atomicity (v0005) proposition set, and drops the "
    + "detailed pronoun-resolution / distinctness-boundary language present in every "
    + "prior version. Tests whether this coverage-oriented framing changes "
    + "decomposition granularity or crux recovery.",
  fixtures, model, reasoningEffort: "none", timeoutMs,
  repeatsPerFixturePerVersion: { "PromptCF5-v0001": 1, "PromptCF5-v0006": repeats },
  totalGenerationRuns: fixtures.length * (1 + repeats),
  v0001Routing: "reused from cf5-promptcf5-v002's v0001_repeat1 runs",
  v0006Routing: "run fresh, 2 repeats per fixture",
  promptV0001Hash, promptV0006Hash, schemaHash, gitCommit,
  claimsSchemaVersion: CF5_CLAIMS_SCHEMA_V1.name,
  generatedAt: new Date().toISOString(),
}, null, 2));

writeFileSync(path.join(outDir, "results.json"), JSON.stringify(
  runIndex.map(({ dir, ...rest }) => ({ ...rest, dir: path.relative(outDir, dir) })), null, 2));

console.log(`\nPromptCF5-v0006 blind regression complete → ${outDir}`);
