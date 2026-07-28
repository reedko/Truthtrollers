#!/usr/bin/env node
// CF5 experimental-fields side-track — per v3 §5 / Task 10. Evaluates whether
// verificationQuestion, support/refutation/qualification conditions, and
// citedWorkNames add real information beyond the canonical five-field claim. NOT part
// of the canonical schema; stored under a separate artifacts path; never read by
// run-cf5.mjs or the canonical defect catalog.
import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createCf1ModelRunner } from "../../src/claim-foundry/modelRunner.js";
import { createOpenAiResponsesCf1Transport } from "../../src/claim-foundry/openAiResponsesTransport.js";
import { buildCf5ExperimentalPrompt, CF5_EXPERIMENTAL_PROMPT_VERSION } from "./prompts.js";
import { loadFixtureArticle } from "./run-cf5.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../..");
const option = (name, fallback = null) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
};

const fixtures = (option("--fixtures", "CF1-F02,CF1-F03,CF1-F06")).split(",");
const model = option("--model", "gpt-4.1-mini");
const timeoutMs = Number(option("--timeout-ms", "180000"));
const stamp = new Date().toISOString().replace(/[-:T.]/g, "").slice(0, 14).replace(/(\d{8})(\d{6})/, "$1-$2");
const outDir = path.resolve(option("--out",
  path.join(root, "artifacts/claim-foundry/cf5-experimental", stamp)));

if (!process.env.OPENAI_API_KEY && !process.env.REACT_APP_OPENAI_API_KEY) {
  throw new Error("OPENAI_API_KEY is required");
}

const runner = createCf1ModelRunner({ transport: createOpenAiResponsesCf1Transport() });
mkdirSync(outDir, { recursive: true });
console.log(`CF5 experimental fields · fixtures: ${fixtures.join(", ")} · ${model}`);
console.log("NOT canonical — this output does not feed the defect catalog or any canonical artifact.");

for (const fixture of fixtures) {
  const fixtureDir = path.join(outDir, fixture.toLowerCase());
  mkdirSync(fixtureDir, { recursive: true });
  const { article, units } = loadFixtureArticle(fixture);
  const prompt = buildCf5ExperimentalPrompt({ article, units });
  writeFileSync(path.join(fixtureDir, "experimental-prompt.txt"),
    `SYSTEM\n${prompt.system}\n\nUSER\n${prompt.user}\n`);

  const res = await runner.invokeStructured({
    ...prompt, model, reasoningEffort: "none", timeoutMs,
    maximumAttempts: 1, maxOutputTokens: 8000, store: false,
  });
  const claims = res.output.experimentalClaims ?? [];
  writeFileSync(path.join(fixtureDir, "raw-model-response.json"), `${JSON.stringify(res.rawResponse, null, 2)}\n`);
  writeFileSync(path.join(fixtureDir, "experimental-claims.json"), `${JSON.stringify({
    schemaVersion: "cf5.experimentalClaims.v1",
    fixtureId: fixture,
    promptVersion: CF5_EXPERIMENTAL_PROMPT_VERSION,
    model: res.model,
    usage: res.usage,
    claims,
  }, null, 2)}\n`);
  console.log(`  ${fixture}: ${claims.length} experimental claims`);
}
console.log(`artifacts → ${outDir}`);
