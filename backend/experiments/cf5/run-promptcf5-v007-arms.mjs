#!/usr/bin/env node
// CF5 PromptCF5-v0007 execution-arm comparison. Same prompt text (PromptCF5-v0007,
// unmodified) run through two different execution paths, to isolate the effect of
// model/API-surface from the effect of prompt wording:
//
//   Arm "reasoning": model gpt-5-mini (o4-mini was the original intent but is not
//     accessible on this project's API key — confirmed via a live 403, and the user
//     picked gpt-5-mini as the substitute), reasoning effort=high, via
//     openAiResponsesTransport.js (reused unmodified) — the Responses API path.
//   Arm "completions": model gpt-4.1-mini (unchanged from the v0007 baseline), via
//     openAiTransport.js/openAiLLM.js (reused unmodified) — the Chat Completions API
//     path, hitting POST /v1/chat/completions.
//
// The original v0007 baseline (Responses API, gpt-4.1-mini, reasoningEffort="none")
// is reused from cf5-promptcf5-v007's existing runs as a third comparison column, and
// v0001's baseline is reused from cf5-promptcf5-v002 for a fourth. 1 repeat per
// fixture per new arm (6 fresh calls total), per default cost-conscious cadence for
// an exploratory two-arm test — not explicitly requested by the user, called out in
// run_config.json and the report.
//
// KNOWN CONFOUND, documented rather than silently absorbed: openAiLLM.js's generate()
// defaults temperature to 0.2 when the caller doesn't supply one, and
// openAiTransport.js's invoke() passes request.temperature through as-is (undefined
// here), so the "completions" arm runs at temperature=0.2. The Responses API path
// used by every other CF5 run this cycle (openAiResponsesTransport.js) does not
// expose or set temperature at all, so those runs use the Responses API's own
// provider default (reported by OpenAI as 1.0 for non-reasoning models). This means
// the "completions" arm differs from every prior CF5 run in two respects at once
// (API surface AND temperature), not API surface alone. Not fixed here because doing
// so would require modifying openAiResponsesTransport.js, which is out of scope for
// a "reuse infra unmodified" experiment — flagged for any follow-up that wants a
// temperature-isolated comparison.
import "dotenv/config";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import { createCf1ModelRunner } from "../../src/claim-foundry/modelRunner.js";
import { createOpenAiResponsesCf1Transport } from "../../src/claim-foundry/openAiResponsesTransport.js";
import { createOpenAiCf1Transport } from "../../src/claim-foundry/openAiTransport.js";
import { buildPromptCF5v007, PROMPT_CF5_V007_VERSION } from "./promptCF5v007.js";
import { buildCf5RepairPrompt } from "./prompts.js";
import { CF5_CLAIMS_SCHEMA_V1 } from "./schemas.js";
import { runGenerationPipeline } from "./pipeline.js";
import { loadFixtureArticle } from "./run-cf5.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../..");
const outDir = path.resolve(root, "artifacts/claim-foundry/cf5-promptcf5-v007-arms");
const v007Dir = path.resolve(root, "artifacts/claim-foundry/cf5-promptcf5-v007");
const v002Dir = path.resolve(root, "artifacts/claim-foundry/cf5-promptcf5-v002");
const fixtures = ["CF1-F02", "CF1-F03", "CF1-F06"];
const timeoutMs = 480000; // raised from 240000 after gpt-5-mini reasoning=high timed out

const hash = (text) => createHash("sha256").update(text).digest("hex").slice(0, 16);
let gitCommit = "unknown";
try { gitCommit = execSync("git rev-parse HEAD", { cwd: root }).toString().trim(); } catch { /* not fatal */ }

if (!process.env.OPENAI_API_KEY && !process.env.REACT_APP_OPENAI_API_KEY) {
  throw new Error("OPENAI_API_KEY is required");
}

mkdirSync(outDir, { recursive: true });
const promptV0007Hash = hash(readFileSync(path.join(v007Dir, "prompt_v0007.txt"), "utf8"));
const promptV0001Hash = hash(readFileSync(path.join(v007Dir, "prompt_v0001.txt"), "utf8"));
const schemaHash = hash(JSON.stringify(CF5_CLAIMS_SCHEMA_V1));

const arms = {
  reasoning: {
    label: "PromptCF5-v0007 (gpt-5-mini, reasoning=high, Responses)",
    model: "gpt-5-mini",
    reasoningEffort: "high",
    runner: createCf1ModelRunner({ transport: createOpenAiResponsesCf1Transport() }),
    maxOutputTokens: 60000, // reasoning tokens count against this budget; raised after
    // F03 (404 source units, the largest fixture) exhausted 22,561 reasoning tokens
    // alone at 25000 and returned incomplete with zero output tokens
    repairMaxOutputTokens: 20000,
  },
  completions: {
    label: "PromptCF5-v0007 (gpt-4.1-mini, Chat Completions)",
    model: "gpt-4.1-mini",
    reasoningEffort: "none",
    runner: createCf1ModelRunner({ transport: createOpenAiCf1Transport() }),
    maxOutputTokens: 6000,
    repairMaxOutputTokens: 3000,
  },
};

const runIndex = [];

for (const fixture of fixtures) {
  const fixtureDir = path.join(outDir, fixture.toLowerCase());
  mkdirSync(fixtureDir, { recursive: true });
  const { article, units } = loadFixtureArticle(fixture);
  const knownUnitIds = new Set(units.map((u) => u.unitId));
  writeFileSync(path.join(fixtureDir, "source-units.json"), JSON.stringify(units, null, 2));

  // --- reuse v0001 baseline (from cf5-promptcf5-v002) ---
  {
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
    const manifest = {
      schemaVersion: "cf5.promptV007ArmsRunManifest.v1",
      fixtureId: fixture, promptVersion: "PromptCF5-v0001", arm: "baseline", repeat: 1,
      reusedFrom: srcDir, requestedModel: "gpt-4.1-mini", returnedModel: srcManifest.returnedModel,
      promptHash: promptV0001Hash, schemaHash, gitCommit, usage: srcManifest.usage,
      latencySeconds: rawResponse.completed_at - rawResponse.created_at,
      repairUsed: srcManifest.repairUsed, finalClaimCount: finalClaims.length,
      hardFailureClaimIds: validationReport.hardFailureClaimIds ?? [],
    };
    writeFileSync(path.join(destDir, "run-manifest.json"), JSON.stringify(manifest, null, 2));
    runIndex.push({ fixture, promptVersion: "PromptCF5-v0001", arm: "baseline", repeat: 1, dir: destDir, manifest, finalClaims });
    console.log(`  ${fixture} v0001 baseline: reused (${finalClaims.length} claims)`);
  }

  // --- reuse original v0007 baseline (Responses API, gpt-4.1-mini, reasoningEffort=none) ---
  {
    const srcDir = path.join(v007Dir, fixture.toLowerCase(), "v0007_repeat1");
    const destDir = path.join(fixtureDir, "v0007_responses-gpt41mini_repeat1");
    mkdirSync(destDir, { recursive: true });
    const rawResponse = JSON.parse(readFileSync(path.join(srcDir, "raw-model-response.json"), "utf8"));
    const finalClaims = JSON.parse(readFileSync(path.join(srcDir, "final-claims.json"), "utf8"));
    const validationReport = JSON.parse(readFileSync(path.join(srcDir, "validation-report.json"), "utf8"));
    const srcManifest = JSON.parse(readFileSync(path.join(srcDir, "run-manifest.json"), "utf8"));
    writeFileSync(path.join(destDir, "raw-model-response.json"), JSON.stringify(rawResponse, null, 2));
    writeFileSync(path.join(destDir, "final-claims.json"), JSON.stringify(finalClaims, null, 2));
    writeFileSync(path.join(destDir, "validation-report.json"), JSON.stringify(validationReport, null, 2));
    const manifest = {
      schemaVersion: "cf5.promptV007ArmsRunManifest.v1",
      fixtureId: fixture, promptVersion: PROMPT_CF5_V007_VERSION, arm: "responses-gpt41mini-baseline", repeat: 1,
      reusedFrom: srcDir, requestedModel: "gpt-4.1-mini", returnedModel: srcManifest.returnedModel,
      promptHash: promptV0007Hash, schemaHash, gitCommit, usage: srcManifest.usage,
      latencySeconds: srcManifest.latencySeconds,
      repairUsed: srcManifest.repairUsed, finalClaimCount: finalClaims.length,
      hardFailureClaimIds: validationReport.hardFailureClaimIds ?? [],
    };
    writeFileSync(path.join(destDir, "run-manifest.json"), JSON.stringify(manifest, null, 2));
    runIndex.push({ fixture, promptVersion: PROMPT_CF5_V007_VERSION, arm: "responses-gpt41mini-baseline", repeat: 1, dir: destDir, manifest, finalClaims });
    console.log(`  ${fixture} v0007 responses-gpt41mini-baseline: reused (${finalClaims.length} claims)`);
  }

  // --- fresh arms ---
  for (const [armId, arm] of Object.entries(arms)) {
    const versionDestDir = path.join(fixtureDir, `v0007_${armId}_repeat1`);
    mkdirSync(versionDestDir, { recursive: true });
    const prompt = buildPromptCF5v007({ article, units });
    const started = performance.now();
    const genRes = await arm.runner.invokeStructured({
      ...prompt, model: arm.model, reasoningEffort: arm.reasoningEffort, timeoutMs,
      maximumAttempts: 1, maxOutputTokens: arm.maxOutputTokens, store: false,
    });
    const latencySeconds = (performance.now() - started) / 1000;
    writeFileSync(path.join(versionDestDir, "raw-model-response.json"), JSON.stringify(genRes.rawResponse, null, 2));
    const rawClaims = genRes.output.claims ?? [];
    let totalUsage = { ...genRes.usage };

    const result = await runGenerationPipeline({
      rawClaims, knownUnitIds,
      repair: async ({ failedClaims, errors }) => {
        const repairPrompt = buildCf5RepairPrompt({ article, units, failedClaims, errors, validUnitIds: [...knownUnitIds] });
        const repairRes = await arm.runner.invokeStructured({
          ...repairPrompt, model: arm.model, reasoningEffort: arm.reasoningEffort, timeoutMs,
          maximumAttempts: 1, maxOutputTokens: arm.repairMaxOutputTokens, store: false,
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
      schemaVersion: "cf5.promptV007ArmsRunManifest.v1",
      fixtureId: fixture, promptVersion: PROMPT_CF5_V007_VERSION, arm: armId, repeat: 1,
      reusedFrom: null,
      requestedModel: arm.model, returnedModel: genRes.model, reasoningEffort: arm.reasoningEffort,
      promptHash: promptV0007Hash, schemaHash, gitCommit,
      usage: totalUsage, latencySeconds,
      repairUsed: Boolean(result.repairResult), finalClaimCount: result.finalClaims.length,
      hardFailureClaimIds: [...result.hardFailureClaimIds],
    };
    writeFileSync(path.join(versionDestDir, "run-manifest.json"), JSON.stringify(manifest, null, 2));
    runIndex.push({ fixture, promptVersion: PROMPT_CF5_V007_VERSION, arm: armId, repeat: 1, dir: versionDestDir, manifest, finalClaims: result.finalClaims });
    console.log(`  ${fixture} v0007 ${armId} (${arm.model}): ${result.finalClaims.length} claims`
      + (result.repairResult ? " (repaired)" : ""));
  }
}

writeFileSync(path.join(outDir, "run_config.json"), JSON.stringify({
  schemaVersion: "cf5.promptV007ArmsRunConfig.v1",
  objective: "Isolate the effect of execution model/API-surface (holding PromptCF5-v0007's "
    + "prompt text fully fixed) by comparing: (1) the original v0007 baseline "
    + "(gpt-4.1-mini, Responses API, reasoningEffort=none), (2) a reasoning arm "
    + "(gpt-5-mini, reasoningEffort=high, Responses API), and (3) a Chat Completions arm "
    + "(gpt-4.1-mini, unchanged model, but /v1/chat/completions instead of /v1/responses). "
    + "PromptCF5-v0001 baseline included for absolute context.",
  fixtures, timeoutMs,
  arms: {
    "responses-gpt41mini-baseline": { model: "gpt-4.1-mini", api: "responses", reasoningEffort: "none", source: "reused from cf5-promptcf5-v007" },
    reasoning: { model: "gpt-5-mini", api: "responses", reasoningEffort: "high", maxOutputTokens: arms.reasoning.maxOutputTokens, source: "run fresh" },
    completions: { model: "gpt-4.1-mini", api: "chat.completions", reasoningEffort: "none", temperature: "0.2 (openAiLLM.js default — not explicitly set by this experiment)", maxOutputTokens: arms.completions.maxOutputTokens, source: "run fresh" },
  },
  repeatsPerFixturePerArm: 1,
  totalGenerationRuns: fixtures.length * 4, // v0001 baseline + v0007 responses baseline + 2 fresh arms
  knownConfound: "The completions arm differs from every other CF5 run this cycle in "
    + "two respects simultaneously: API surface (Chat Completions vs Responses) AND "
    + "temperature (openAiLLM.js defaults to 0.2 when unset; the Responses transport "
    + "used elsewhere never sets temperature and uses the provider default, ~1.0 for "
    + "non-reasoning models). Not isolated in this experiment — see run script header.",
  promptV0001Hash, promptV0007Hash, schemaHash, gitCommit,
  claimsSchemaVersion: CF5_CLAIMS_SCHEMA_V1.name,
  generatedAt: new Date().toISOString(),
}, null, 2));

writeFileSync(path.join(outDir, "results.json"), JSON.stringify(
  runIndex.map(({ dir, ...rest }) => ({ ...rest, dir: path.relative(outDir, dir) })), null, 2));

console.log(`\nPromptCF5-v0007 arms comparison complete → ${outDir}`);
