#!/usr/bin/env node
import { createHash } from "node:crypto";
import dotenv from "dotenv";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createCf1ModelRunner } from "../../../src/claim-foundry/modelRunner.js";
import { createOpenAiCf1Transport } from "../../../src/claim-foundry/openAiTransport.js";
import { repairDiscoveryGrounding } from "../grounding.js";
import { normalizeDiscovery, prepareCf2Article } from "../pipeline.js";
import { buildCf2V6DiscoveryPrompt } from "./prompts.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const backend = path.resolve(here, "../../..");
const root = path.resolve(backend, "..");
dotenv.config({ path: path.join(backend, ".env") });

function option(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const fixture = option("--fixture", "CF1-F03");
const model = option("--model", "gpt-4o-mini");
const repeats = Number(option("--repeats", "1"));
const seed = Number(option("--seed", "3724605090"));
const timeoutMs = Number(option("--timeout-ms", "180000"));
const outDir = path.resolve(option(
  "--out",
  path.join(root, "artifacts/claim-foundry/cf2", `${fixture.toLowerCase()}-v6-call-a`),
));
const fixturePath = path.join(
  backend,
  "test/claim-foundry/fixtures",
  fixture,
  "article.json",
);
const rawFixture = JSON.parse(readFileSync(fixturePath, "utf8"));
const rawArticle = rawFixture.article ?? rawFixture;
const { article, sourceUnits } = prepareCf2Article(rawArticle);
const prompt = buildCf2V6DiscoveryPrompt({ article, sourceUnits });
const runner = createCf1ModelRunner({ transport: createOpenAiCf1Transport() });
const sha256 = (value) => createHash("sha256").update(String(value)).digest("hex");

mkdirSync(outDir, { recursive: true });
const trials = [];
for (let index = 0; index < repeats; index += 1) {
  const startedAt = new Date();
  const response = await runner.invokeStructured({
    ...prompt,
    model,
    temperature: 0.2,
    seed,
    timeoutMs,
    maximumAttempts: 1,
    maxOutputTokens: 5_000,
  });
  const finishedAt = new Date();
  const rawDiscovery = normalizeDiscovery(response.output, sourceUnits);
  const discovery = repairDiscoveryGrounding(rawDiscovery, sourceUnits);
  const trial = {
    repeat: index + 1,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    elapsedMs: finishedAt.getTime() - startedAt.getTime(),
    requestedModel: model,
    returnedModel: response.model ?? model,
    responseId: response.rawResponse?.id ?? null,
    systemFingerprint: response.rawResponse?.system_fingerprint ?? null,
    usage: response.usage ?? null,
    thesisAssertion: discovery.thesisAssertion,
    candidates: discovery.candidates,
    rawOutput: response.output,
  };
  trials.push(trial);
  writeFileSync(
    path.join(outDir, `repeat-${index + 1}.json`),
    `${JSON.stringify(trial, null, 2)}\n`,
  );
  console.log(
    `${model} repeat ${index + 1}: ${trial.candidates.length} candidates`
      + ` · ${(trial.elapsedMs / 1000).toFixed(1)}s`
      + ` · ${trial.usage?.inputTokens ?? "?"} in`
      + ` / ${trial.usage?.outputTokens ?? "?"} out`
      + ` / ${trial.usage?.totalTokens ?? "?"} total`,
  );
}

writeFileSync(
  path.join(outDir, "result.json"),
  `${JSON.stringify({
    architecture: "CF2_V6_CALL_A_ONLY",
    fixture,
    model,
    repeats,
    seed,
    promptSha256: sha256(`${prompt.system}\n${prompt.user}`),
    schemaSha256: sha256(JSON.stringify(prompt.responseSchema)),
    article: {
      title: article.title,
      authors: article.authors ?? [],
      sourceUnitCount: sourceUnits.length,
    },
    trials,
  }, null, 2)}\n`,
);
console.log(outDir);
