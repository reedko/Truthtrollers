#!/usr/bin/env node
// CF4 Phase 2: one stance-assertion call, then isolated selection repeats.
import "dotenv/config";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createCf1ModelRunner } from "../../src/claim-foundry/modelRunner.js";
import { createOpenAiResponsesCf1Transport } from "../../src/claim-foundry/openAiResponsesTransport.js";
import {
  buildCf4SelectionPrompt,
  buildCf4StanceAssertionsPrompt,
} from "./prompts.js";
import {
  validateSelection,
  validateStanceAssertions,
} from "./phase2-host.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../..");
const option = (name, fallback = null) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
};
const fixture = option("--fixture", "CF1-F03");
const phase1Run = path.resolve(option("--phase1-run", ""));
if (!option("--phase1-run")) {
  throw new Error("--phase1-run <completed Phase 1 run> is required");
}
const repeats = Number(option("--repeats", "1"));
const model = option("--model", "gpt-4.1-mini");
const timeoutMs = Number(option("--timeout-ms", "180000"));
const stamp = new Date().toISOString().replace(/[-:T.]/g, "").slice(0, 14)
  .replace(/(\d{8})(\d{6})/, "$1-$2");
const outDir = path.resolve(option("--out", path.join(root,
  "artifacts/claim-foundry/cf4/phase2-selection",
  `${fixture.toLowerCase()}-${stamp}`)));
if (!process.env.OPENAI_API_KEY && !process.env.REACT_APP_OPENAI_API_KEY) {
  throw new Error("OPENAI_API_KEY is required");
}

const read = (file) => JSON.parse(readFileSync(file, "utf8"));
const write = (name, value) => writeFileSync(
  path.join(outDir, name), `${JSON.stringify(value, null, 2)}\n`);
const hash = (value) => createHash("sha256")
  .update(JSON.stringify(value)).digest("hex");
const receipt = (response, requestedModel, latencyMs) => ({
  requestedModel,
  returnedModel: response.model,
  responseId: response.rawResponse?.id ?? null,
  systemFingerprint: response.rawResponse?.system_fingerprint ?? null,
  usage: response.usage,
  attempts: response.attempts,
  latencyMs,
});
async function invoke(prompt, maxOutputTokens) {
  const started = performance.now();
  const response = await runner.invokeStructured({
    ...prompt,
    model,
    reasoningEffort: "none",
    timeoutMs,
    maximumAttempts: 1,
    maxOutputTokens,
    store: false,
  });
  return { response, latencyMs: Math.round(performance.now() - started) };
}

const article = read(path.join(phase1Run, `${fixture}.json`));
const candidateArtifact = read(path.join(
  phase1Run, fixture, "s3_candidates.json"));
const inventory = candidateArtifact.candidates.map((candidate) => ({
  assertionId: candidate.candidateId,
  assertionText: candidate.assertionText,
  groundingUnitIds: candidate.groundingUnitIds,
}));
const inventoryIds = new Set(inventory.map((item) => item.assertionId));
const unitIds = new Set(article.units.map((unit) => unit.unitId));
const runner = createCf1ModelRunner({
  transport: createOpenAiResponsesCf1Transport(),
});
mkdirSync(outDir, { recursive: true });
console.log(`CF4 S5+S6 · ${fixture} · ${inventory.length} candidates · `
  + `${repeats} selection repeats · ${model}`);

const stancePrompt = buildCf4StanceAssertionsPrompt({
  article: article.article,
  units: article.units,
});
const stanceCall = await invoke(stancePrompt, 1800);
const validatedStance = validateStanceAssertions(
  stanceCall.response.output.stanceAssertions, unitIds);
const stanceArtifactBase = {
  schemaVersion: "cf4.stanceAssertions.v1",
  fixtureId: fixture,
  stanceAssertions: validatedStance.stanceAssertions,
  findings: validatedStance.findings,
  ...receipt(stanceCall.response, model, stanceCall.latencyMs),
  prompt: stancePrompt,
  promptHash: hash(stancePrompt),
  schemaHash: hash(stancePrompt.responseSchema),
};
write("stance_assertions_raw_response.json", stanceCall.response.rawResponse);
write("stance_assertions.json", {
  ...stanceArtifactBase,
  redundancy: null,
  redundancyStatus: "PENDING",
});
const redundancyInput = path.join(outDir, "stance_redundancy_input.json");
writeFileSync(redundancyInput, JSON.stringify(
  validatedStance.stanceAssertions.map((item) => item.assertionText)));
const redundancyRun = spawnSync(path.join(here, ".venv/bin/python"), [
  path.join(here, "semantic_redundancy.py"),
  "--input",
  redundancyInput,
], {
  encoding: "utf8",
  env: { ...process.env, HF_HUB_OFFLINE: process.env.HF_HUB_OFFLINE ?? "1" },
});
if (redundancyRun.status !== 0) {
  throw new Error(`semantic_redundancy.py failed: ${redundancyRun.stderr}`);
}
const redundancy = JSON.parse(
  redundancyRun.stdout.trim().split("\n").pop());
write("stance_assertions.json", {
  ...stanceArtifactBase,
  redundancy,
  redundancyStatus: "COMPLETE",
});
console.log(`  stance assertions: ${validatedStance.stanceAssertions.length}`);
validatedStance.stanceAssertions.forEach((item) =>
  console.log(`    ${item.stanceId} [${item.groundingUnitIds.join(",")}]: `
    + item.assertionText));

const selectionPrompt = buildCf4SelectionPrompt({
  stanceAssertions: validatedStance.stanceAssertions,
  inventory,
});
const calls = [{
  stage: "S5",
  ...receipt(stanceCall.response, model, stanceCall.latencyMs),
}];
for (let repeat = 1; repeat <= repeats; repeat += 1) {
  try {
    const call = await invoke(selectionPrompt, 1000);
    const validated = validateSelection(
      call.response.output.selectedAssertionIds ?? [], inventoryIds);
    write(`selection_repeat${repeat}_raw_response.json`,
      call.response.rawResponse);
    write(`selection_repeat${repeat}.json`, {
      schemaVersion: "cf4.s6Selection.v3",
      fixtureId: fixture,
      stanceAssertions: validatedStance.stanceAssertions,
      selectedAssertionIds: validated.selectedAssertionIds,
      rawSelectedAssertionIds:
        call.response.output.selectedAssertionIds ?? [],
      findings: validated.findings,
      ...receipt(call.response, model, call.latencyMs),
      prompt: selectionPrompt,
      promptHash: hash(selectionPrompt),
      schemaHash: hash(selectionPrompt.responseSchema),
    });
    calls.push({
      stage: "S6",
      repeat,
      ...receipt(call.response, model, call.latencyMs),
    });
    console.log(`  repeat ${repeat}: ${validated.selectedAssertionIds.length} selected`);
  } catch (error) {
    calls.push({
      stage: "S6",
      repeat,
      failed: true,
      code: error.code ?? null,
      message: error.message,
    });
    console.log(`  repeat ${repeat}: FAILED ${error.code ?? error.message}`);
  }
}
write("run_manifest.json", {
  schemaVersion: "cf4.phase2Run.v1",
  fixtureId: fixture,
  phase1Run,
  inventoryCount: inventory.length,
  stanceAssertionCount: validatedStance.stanceAssertions.length,
  requestedSelectionRepeats: repeats,
  calls,
});
console.log(`artifacts → ${outDir}`);
