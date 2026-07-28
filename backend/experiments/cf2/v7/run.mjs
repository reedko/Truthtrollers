#!/usr/bin/env node
import dotenv from "dotenv";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createCf1ModelRunner } from "../../../src/claim-foundry/modelRunner.js";
import { createOpenAiCf1Transport } from "../../../src/claim-foundry/openAiTransport.js";
import { writeCf2Artifacts } from "../report.js";
import { runCf2V7 } from "./pipeline.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const backend = path.resolve(here, "../../..");
const root = path.resolve(backend, "..");
dotenv.config({ path: path.join(backend, ".env") });

function option(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const fixture = option("--fixture", "CF1-F03");
const seed = Number(option("--seed", "3724605090"));
const callAModel = option("--call-a-model", "gpt-4o-mini");
const callBModel = option("--call-b-model", "gpt-4.1-mini");
const callCModel = option("--call-c-model", "gpt-4.1-mini");
const candidateMaximum = Number(option("--candidate-maximum", "30"));
const portfolioMaximum = Number(option("--portfolio-maximum", "12"));
const candidateFailureMode = option("--candidate-failure-mode", "quarantine");
const selectionPolicy = option("--selection-policy", "treatment_fallback");
const timeoutMs = Number(option("--timeout-ms", "180000"));
const skipCallC = process.argv.includes("--skip-call-c");
const outDir = path.resolve(option("--out",
  path.join(root, "artifacts/claim-foundry/cf2", `${fixture.toLowerCase()}-v7`)));
const fixturePath = path.join(
  backend,
  "test/claim-foundry/fixtures",
  fixture,
  "article.json",
);
const rawFixture = JSON.parse(readFileSync(fixturePath, "utf8"));
const rawArticle = rawFixture.article ?? rawFixture;

if (!process.env.OPENAI_API_KEY && !process.env.REACT_APP_OPENAI_API_KEY) {
  throw new Error("OPENAI_API_KEY is required");
}

const runner = createCf1ModelRunner({ transport: createOpenAiCf1Transport() });
const callCRunner = skipCallC
  ? {
      invokeStructured: async (request) => {
        const candidateIds = request.responseSchema.schema.properties.attributions
          .items.properties.candidateId.enum;
        return {
          output: {
            attributions: candidateIds.map((candidateId) => ({
              candidateId,
              evidenceAnchors: [],
            })),
          },
          model: "host_noop_call_c",
          attempts: 0,
          usage: {
            inputTokens: 0,
            outputTokens: 0,
            cachedInputTokens: 0,
            totalTokens: 0,
          },
          rawResponse: { id: "host_noop_call_c" },
        };
      },
    }
  : runner;
const progress = [];
mkdirSync(outDir, { recursive: true });

console.log(`CF2 V7 ${fixture}: ${callAModel} Chat → ${callBModel} decomposition`
  + (skipCallC ? " → Call C skipped" : ` → ${callCModel} evidence anchors`)
  + ` · candidate max ${candidateMaximum} / portfolio max ${portfolioMaximum}`
  + ` · candidate failures ${candidateFailureMode}`
  + ` · selection ${selectionPolicy}`);

const result = await runCf2V7({
  rawArticle,
  callARunner: runner,
  callBRunner: runner,
  callCRunner,
  callAModel,
  callBModel,
  callCModel,
  candidateMaximum,
  portfolioMaximum,
  candidateFailureMode,
  selectionPolicy,
  timeoutMs,
  seed,
  onProgress: (event) => {
    progress.push(event);
    writeFileSync(path.join(outDir, "progress.json"),
      `${JSON.stringify(progress, null, 2)}\n`);
    const usage = event.call?.usage ?? {};
    console.log(`${event.stage} · ${(event.call.elapsedMs / 1000).toFixed(1)}s`
      + ` · ${event.workItems} outputs`
      + `${event.rejections?.length ? ` / ${event.rejections.length} quarantined` : ""}`
      + ` · ${usage.inputTokens ?? "?"} in / ${usage.outputTokens ?? "?"} out`
      + ` / ${usage.cachedInputTokens ?? 0} cached`
      + ` / ${usage.totalTokens ?? "?"} total`);
  },
});

writeCf2Artifacts(result, outDir);
const totalTokens = Object.values(result.calls).reduce((sum, call) =>
  sum + (call.usage?.totalTokens ?? 0), 0);
console.log(`${result.candidates.length} candidates → ${result.candidateJudgments.length}`
  + ` judgments → ${result.assertions.length} assertions`);
console.log(`3 calls · ${(result.elapsedMs / 1000).toFixed(1)}s`
  + ` · ${totalTokens} tokens · ${outDir}`);
