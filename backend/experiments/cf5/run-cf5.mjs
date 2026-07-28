#!/usr/bin/env node
// CF5 minimal vertical slice — live runner. article → source units → one generation
// call → deterministic validation → at most one repair call → persisted artifacts.
// Per CF5_ARCHITECTURE_MIGRATION_PLAN_2026-07-26_v3.md: no candidate inventory, no
// selection call, no CF1 package shape, no deterministic semantic enrichment.
import "dotenv/config";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createCf1ModelRunner } from "../../src/claim-foundry/modelRunner.js";
import { createOpenAiResponsesCf1Transport } from "../../src/claim-foundry/openAiResponsesTransport.js";
import { articleDocumentFromText } from "../../src/claim-foundry/article-document/index.js";
import {
  buildCf5ClaimGenerationPrompt, buildCf5RepairPrompt,
  CF5_GENERATION_PROMPT_VERSION, CF5_REPAIR_PROMPT_VERSION,
} from "./prompts.js";
import { CF5_CLAIMS_SCHEMA_V1 } from "./schemas.js";
import { runGenerationPipeline } from "./pipeline.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../..");
const option = (name, fallback = null) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
};

export function loadFixtureArticle(fixture) {
  const articlePath = path.join(root, "backend/test/claim-foundry/fixtures", fixture, "article.json");
  const raw = JSON.parse(readFileSync(articlePath, "utf8"));
  const rawArticle = raw.article ?? raw;
  const document = articleDocumentFromText({
    text: rawArticle.text, metadata: { title: rawArticle.title, language: rawArticle.language },
  });
  const units = document.sourceUnits.map((unit) => ({ unitId: unit.unitId, text: unit.text }));
  const article = {
    title: rawArticle.title, authors: rawArticle.authors, publisher: rawArticle.publisher ?? null,
    publishedAt: rawArticle.publishedAt ?? null, contentHash: document.contentHash,
  };
  return { article, units };
}

export async function runCf5Once({ fixture, article, units, model, timeoutMs, runner, outDir, repeatLabel }) {
  const knownUnitIds = new Set(units.map((unit) => unit.unitId));
  const generationPrompt = buildCf5ClaimGenerationPrompt({ article, units });
  const startedAt = new Date().toISOString();

  const generationRes = await runner.invokeStructured({
    ...generationPrompt, model, reasoningEffort: "none", timeoutMs,
    maximumAttempts: 1, maxOutputTokens: 6000, store: false,
  });
  writeFileSync(path.join(outDir, "raw-model-response.json"),
    `${JSON.stringify(generationRes.rawResponse, null, 2)}\n`);
  const rawClaims = generationRes.output.claims ?? [];
  writeFileSync(path.join(outDir, "parsed-claims.json"), `${JSON.stringify(rawClaims, null, 2)}\n`);

  let totalUsage = { ...generationRes.usage };
  const result = await runGenerationPipeline({
    rawClaims, knownUnitIds,
    repair: async ({ failedClaims, errors }) => {
      const repairPrompt = buildCf5RepairPrompt({
        article, units, failedClaims, errors, validUnitIds: [...knownUnitIds],
      });
      writeFileSync(path.join(outDir, "repair-prompt.txt"),
        `SYSTEM\n${repairPrompt.system}\n\nUSER\n${repairPrompt.user}\n`);
      const repairRes = await runner.invokeStructured({
        ...repairPrompt, model, reasoningEffort: "none", timeoutMs,
        maximumAttempts: 1, maxOutputTokens: 3000, store: false,
      });
      writeFileSync(path.join(outDir, "raw-repair-response.json"),
        `${JSON.stringify(repairRes.rawResponse, null, 2)}\n`);
      for (const key of Object.keys(totalUsage)) {
        totalUsage[key] = (totalUsage[key] ?? 0) + (repairRes.usage?.[key] ?? 0);
      }
      return {
        repairedClaims: repairRes.output.repairedClaims ?? [],
        rawResponse: repairRes.rawResponse, usage: repairRes.usage, model: repairRes.model,
      };
    },
  });

  writeFileSync(path.join(outDir, "validation-report.json"), `${JSON.stringify({
    firstPassFindings: result.firstPassFindings,
    hardFailureClaimIds: [...result.hardFailureClaimIds],
    finalFindings: result.finalFindings,
    repairUsed: Boolean(result.repairResult),
    repairInfo: result.repairResult
      ? { attemptedClaimIds: result.repairResult.attemptedClaimIds,
          stillFailingClaimIds: result.repairResult.stillFailingClaimIds }
      : null,
  }, null, 2)}\n`);
  writeFileSync(path.join(outDir, "final-claims.json"), `${JSON.stringify(result.finalClaims, null, 2)}\n`);
  writeFileSync(path.join(outDir, "usage.json"), `${JSON.stringify(totalUsage, null, 2)}\n`);

  const status = result.hardFailureClaimIds.size === 0
    ? "completed"
    : result.repairResult && result.repairResult.stillFailingClaimIds.length === 0
      ? "completed_with_repair"
      : "completed_with_unresolved_failures";

  const manifest = {
    schemaVersion: "cf5.runManifest.v1",
    fixtureId: fixture,
    repeat: repeatLabel,
    articleContentHash: article.contentHash,
    model, resolvedModel: generationRes.model,
    generationPromptVersion: CF5_GENERATION_PROMPT_VERSION,
    repairPromptVersion: result.repairResult ? CF5_REPAIR_PROMPT_VERSION : null,
    schemaVersion_claims: CF5_CLAIMS_SCHEMA_V1.name,
    startedAt, completedAt: new Date().toISOString(),
    status,
    repairUsed: Boolean(result.repairResult),
    finalClaimCount: result.finalClaims.length,
    usage: totalUsage,
    artifacts: [
      "article-input.json", "source-units.json", "generation-prompt.txt", "generation-schema.json",
      "raw-model-response.json", "parsed-claims.json", "validation-report.json",
      ...(result.repairResult ? ["repair-prompt.txt", "raw-repair-response.json"] : []),
      "final-claims.json", "usage.json",
    ],
  };
  writeFileSync(path.join(outDir, "run-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return { manifest, finalClaims: result.finalClaims, findings: result.finalFindings };
}

async function main() {
  const fixture = option("--fixture", "CF1-F03");
  const model = option("--model", "gpt-4.1-mini");
  const repeats = Number(option("--repeats", "1"));
  const timeoutMs = Number(option("--timeout-ms", "180000"));
  const stamp = new Date().toISOString().replace(/[-:T.]/g, "").slice(0, 14).replace(/(\d{8})(\d{6})/, "$1-$2");
  const outDir = path.resolve(option("--out",
    path.join(root, "artifacts/claim-foundry/cf5", `${fixture.toLowerCase()}-${stamp}`)));

  if (!process.env.OPENAI_API_KEY && !process.env.REACT_APP_OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is required");
  }

  mkdirSync(outDir, { recursive: true });
  const { article, units } = loadFixtureArticle(fixture);
  const generationPrompt = buildCf5ClaimGenerationPrompt({ article, units });
  writeFileSync(path.join(outDir, "article-input.json"), `${JSON.stringify(article, null, 2)}\n`);
  writeFileSync(path.join(outDir, "source-units.json"), `${JSON.stringify(units, null, 2)}\n`);
  writeFileSync(path.join(outDir, "generation-prompt.txt"),
    `SYSTEM\n${generationPrompt.system}\n\nUSER\n${generationPrompt.user}\n`);
  writeFileSync(path.join(outDir, "generation-schema.json"),
    `${JSON.stringify(CF5_CLAIMS_SCHEMA_V1, null, 2)}\n`);

  const runner = createCf1ModelRunner({ transport: createOpenAiResponsesCf1Transport() });
  console.log(`CF5 · ${fixture} · ${units.length} source units · ${repeats} repeats · ${model}`);

  for (let r = 1; r <= repeats; r += 1) {
    const repeatDir = path.join(outDir, `repeat${r}`);
    mkdirSync(repeatDir, { recursive: true });
    try {
      const { manifest } = await runCf5Once({
        fixture, article, units, model, timeoutMs, runner, outDir: repeatDir, repeatLabel: r,
      });
      console.log(`  repeat ${r}: ${manifest.status} · ${manifest.finalClaimCount} claims`);
    } catch (error) {
      writeFileSync(path.join(repeatDir, "run-manifest.json"), `${JSON.stringify({
        schemaVersion: "cf5.runManifest.v1", fixtureId: fixture, repeat: r,
        status: "failed", error: error.message,
      }, null, 2)}\n`);
      console.log(`  repeat ${r}: FAILED ${error.message}`);
    }
  }
  console.log(`artifacts → ${outDir}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
