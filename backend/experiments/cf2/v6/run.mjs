#!/usr/bin/env node
import dotenv from "dotenv";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createCf1ModelRunner } from "../../../src/claim-foundry/modelRunner.js";
import { createOpenAiCf1Transport } from "../../../src/claim-foundry/openAiTransport.js";
import { writeCf2Artifacts } from "../report.js";
import { runCf2V6 } from "./pipeline.js";

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
const timeoutMs = Number(option("--timeout-ms", "180000"));
const replayCallAPath = option("--replay-call-a", null);
const replayCallBPath = option("--replay-call-b", null);
const outDir = path.resolve(option("--out",
  path.join(root, "artifacts/claim-foundry/cf2", `${fixture.toLowerCase()}-v6`)));
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
const callARunner = replayCallAPath
  ? {
      invokeStructured: async (request) => {
        const replay = JSON.parse(readFileSync(path.resolve(replayCallAPath), "utf8"));
        return {
          output: replay.calls?.callA?.rawOutput ?? replay.rawOutput ?? replay,
          model: replay.calls?.callA?.returnedModel ?? request.model,
          attempts: 0,
          usage: {
            inputTokens: 0,
            outputTokens: 0,
            cachedInputTokens: 0,
            totalTokens: 0,
          },
          rawResponse: { id: "local_call_a_replay" },
        };
      },
    }
  : runner;
const callBRunner = replayCallBPath
  ? {
      invokeStructured: async (request) => {
        const replay = JSON.parse(readFileSync(path.resolve(replayCallBPath), "utf8"));
        const event = Array.isArray(replay)
          ? [...replay].reverse().find((item) =>
            ["call_b_completed", "call_b_invalid"].includes(item.stage))
          : null;
        return {
          output: event?.call?.rawOutput
            ?? replay.calls?.callB?.rawOutput
            ?? replay.rawOutput
            ?? replay,
          model: event?.call?.returnedModel
            ?? replay.calls?.callB?.returnedModel
            ?? request.model,
          attempts: 0,
          usage: {
            inputTokens: 0,
            outputTokens: 0,
            cachedInputTokens: 0,
            totalTokens: 0,
          },
          rawResponse: { id: "local_call_b_replay" },
        };
      },
    }
  : runner;
const progress = [];
mkdirSync(outDir, { recursive: true });

console.log(`CF2 V6 ${fixture}: ${callAModel} Chat → ${callBModel} decomposition`
  + ` → ${callCModel} evidence anchors`);
const result = await runCf2V6({
  rawArticle,
  callARunner,
  callBRunner,
  callCRunner: runner,
  callAModel,
  callBModel,
  callCModel,
  timeoutMs,
  seed,
  onProgress: (event) => {
    progress.push(event);
    writeFileSync(path.join(outDir, "progress.json"),
      `${JSON.stringify(progress, null, 2)}\n`);
    const usage = event.call?.usage ?? {};
    console.log(`${event.stage} · ${(event.call.elapsedMs / 1000).toFixed(1)}s`
      + ` · ${event.workItems} outputs`
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
