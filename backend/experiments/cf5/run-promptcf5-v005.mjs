#!/usr/bin/env node
// CF5 PromptCF5-v0005 blind regression runner. v0001 data reused from
// cf5-promptcf5-v002's v0001_repeat1 runs (same source already verified
// byte-identical to production prompts.js, and already reused unmodified for the
// v0003/v0004 experiment). v0005 ("maximize atomicity, no count ceiling") runs
// fresh: F02/F03/F06 x 1 repeat = 3 generation calls. No changes to
// model/settings/schema/preprocessing/validation/repair — reuses
// pipeline.js/validation.js/schemas.js exactly as-is.
import "dotenv/config";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import { createCf1ModelRunner } from "../../src/claim-foundry/modelRunner.js";
import { createOpenAiResponsesCf1Transport } from "../../src/claim-foundry/openAiResponsesTransport.js";
import { buildPromptCF5v005, PROMPT_CF5_V005_VERSION } from "./promptCF5v005.js";
import { buildCf5RepairPrompt } from "./prompts.js";
import { CF5_CLAIMS_SCHEMA_V1 } from "./schemas.js";
import { runGenerationPipeline } from "./pipeline.js";
import { loadFixtureArticle } from "./run-cf5.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../..");
const outDir = path.resolve(root, "artifacts/claim-foundry/cf5-promptcf5-v005");
const v002Dir = path.resolve(root, "artifacts/claim-foundry/cf5-promptcf5-v002");
const fixtures = ["CF1-F02", "CF1-F03", "CF1-F06"];
const model = "gpt-4.1-mini";
const timeoutMs = 180000;

const hash = (text) => createHash("sha256").update(text).digest("hex").slice(0, 16);
let gitCommit = "unknown";
try { gitCommit = execSync("git rev-parse HEAD", { cwd: root }).toString().trim(); } catch { /* not fatal */ }

if (!process.env.OPENAI_API_KEY && !process.env.REACT_APP_OPENAI_API_KEY) {
  throw new Error("OPENAI_API_KEY is required");
}

const promptV0001Hash = hash(readFileSync(path.join(outDir, "prompt_v0001.txt"), "utf8"));
const promptV0005Hash = hash(readFileSync(path.join(outDir, "prompt_v0005.txt"), "utf8"));
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
    schemaVersion: "cf5.promptV005RunManifest.v1",
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

  // --- v0005: fresh, 1 repeat ---
  const versionDestDir = path.join(fixtureDir, "v0005_repeat1");
  mkdirSync(versionDestDir, { recursive: true });
  const prompt = buildPromptCF5v005({ article, units });
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
    schemaVersion: "cf5.promptV005RunManifest.v1",
    fixtureId: fixture, promptVersion: PROMPT_CF5_V005_VERSION, repeat: 1,
    reusedFrom: null,
    requestedModel: model, returnedModel: genRes.model,
    promptHash: promptV0005Hash, schemaHash, gitCommit,
    usage: totalUsage, latencySeconds,
    repairUsed: Boolean(result.repairResult), finalClaimCount: result.finalClaims.length,
    hardFailureClaimIds: [...result.hardFailureClaimIds],
  };
  writeFileSync(path.join(versionDestDir, "run-manifest.json"), JSON.stringify(manifest, null, 2));
  runIndex.push({ fixture, promptVersion: PROMPT_CF5_V005_VERSION, repeat: 1, dir: versionDestDir, manifest, finalClaims: result.finalClaims });
  console.log(`  ${fixture} ${PROMPT_CF5_V005_VERSION} repeat 1: ${result.finalClaims.length} claims`
    + (result.repairResult ? " (repaired)" : ""));
}

writeFileSync(path.join(outDir, "run_config.json"), JSON.stringify({
  schemaVersion: "cf5.promptV005RunConfig.v1",
  objective: "Evaluate PromptCF5-v0005 against PromptCF5-v0001. v0005 explicitly "
    + "reverses the minimality framing of v0001 ('Your goal is NOT to minimize the "
    + "number of propositions... minimize the semantic content of each proposition') "
    + "and drops the 8-15 claim count target entirely, adding formal "
    + "independently-evidence-testable and anti-merge language. Tests whether "
    + "maximizing atomicity produces genuinely finer-grained, non-duplicative, "
    + "non-compound decomposition, or trades duplication/compound-claim risk for "
    + "higher claim counts.",
  fixtures, model, reasoningEffort: "none", timeoutMs,
  repeatsPerFixturePerVersion: 1,
  totalGenerationRuns: fixtures.length,
  v0001Routing: "reused from cf5-promptcf5-v002's v0001_repeat1 runs",
  v0005Routing: "run fresh",
  promptV0001Hash, promptV0005Hash, schemaHash, gitCommit,
  claimsSchemaVersion: CF5_CLAIMS_SCHEMA_V1.name,
  generatedAt: new Date().toISOString(),
}, null, 2));

writeFileSync(path.join(outDir, "results.json"), JSON.stringify(
  runIndex.map(({ dir, ...rest }) => ({ ...rest, dir: path.relative(outDir, dir) })), null, 2));

console.log(`\nPromptCF5-v0005 blind regression complete → ${outDir}`);
