#!/usr/bin/env node
import { createHash } from "node:crypto";
import dotenv from "dotenv";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createCf1ModelRunner } from "../../src/claim-foundry/modelRunner.js";
import { createOpenAiCf1Transport } from "../../src/claim-foundry/openAiTransport.js";
import { normalizeDiscovery, prepareCf2Article } from "./pipeline.js";
import {
  buildCf2DiscoveryPromptAssertionOnly,
  buildCf2DiscoveryPromptMixedTerminologyLegacy,
} from "./prompts.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const backend = path.resolve(here, "../..");
const root = path.resolve(backend, "..");
dotenv.config({ path: path.join(backend, ".env") });

function option(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const normalized = (value) => String(value ?? "").toLocaleLowerCase()
  .replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const STOP = new Set([
  "a", "an", "and", "are", "as", "at", "be", "been", "by", "for", "from",
  "has", "have", "in", "is", "it", "of", "on", "or", "that", "the", "their",
  "there", "this", "to", "was", "were", "with", "according", "claims",
]);
const tokens = (value) => [...new Set(normalized(value).split(" ")
  .filter((token) => token.length > 1 && !STOP.has(token)))];
const sha256 = (value) => createHash("sha256").update(String(value)).digest("hex");

const TARGETS = [
  {
    id: "ethylmercury_not_harmful",
    terms: ["ethylmercury", "harmful"],
    expectedUnits: ["U0010", "U0297"],
  },
  {
    id: "no_credible_chronic_disease_studies",
    terms: ["credible", "studies", "chronic", "disease"],
    expectedUnits: ["U0011", "U0400"],
  },
  {
    id: "vaccines_tested_more",
    terms: ["vaccines", "tested", "medicine"],
    expectedUnits: ["U0012", "U0401"],
  },
];

function overlap(assertion, unitText) {
  const assertionTokens = tokens(assertion);
  if (assertionTokens.length === 0) return 0;
  const unitTokens = new Set(tokens(unitText));
  return assertionTokens.filter((token) => unitTokens.has(token)).length
    / assertionTokens.length;
}

function evaluate(output, sourceUnits) {
  const byId = new Map(sourceUnits.map((unit) => [unit.unitId, unit]));
  const targetResults = TARGETS.map((target) => {
    const candidate = output.candidates.find((item) => {
      const key = normalized(item.rawAssertion);
      return target.terms.every((term) => key.includes(term));
    });
    return {
      id: target.id,
      present: Boolean(candidate),
      rawAssertion: candidate?.rawAssertion ?? null,
      groundingUnitIds: candidate?.groundingUnitIds ?? [],
      groundingCorrect: Boolean(candidate?.groundingUnitIds
        .some((unitId) => target.expectedUnits.includes(unitId))),
    };
  });
  const grounding = output.candidates.map((candidate) => {
    const scores = candidate.groundingUnitIds
      .map((unitId) => overlap(candidate.rawAssertion, byId.get(unitId)?.text ?? ""));
    const bestOverlap = scores.length > 0 ? Math.max(...scores) : 0;
    return {
      rawAssertion: candidate.rawAssertion,
      groundingUnitIds: candidate.groundingUnitIds,
      bestOverlap,
      obviousMismatch: tokens(candidate.rawAssertion).length >= 4 && bestOverlap < 0.2,
    };
  });
  return {
    candidateCount: output.candidates.length,
    targetResults,
    opponentRecall: targetResults.filter((target) => target.present).length,
    opponentGroundingCorrect: targetResults.filter((target) => target.groundingCorrect).length,
    obviousGroundingMismatches: grounding.filter((item) => item.obviousMismatch).length,
    grounding,
  };
}

function baselineRun(resultPath, sourceUnits) {
  const result = JSON.parse(readFileSync(resultPath, "utf8"));
  const output = result.calls.callA.rawOutput;
  return {
    arm: "baseline",
    run: path.basename(path.dirname(resultPath)),
    promptSha256: result.calls.callA.promptSha256,
    schemaSha256: result.calls.callA.schemaSha256,
    systemFingerprint: result.calls.callA.systemFingerprint,
    elapsedMs: result.calls.callA.elapsedMs,
    usage: result.calls.callA.usage,
    output,
    evaluation: evaluate(output, sourceUnits),
  };
}

const fixture = option("--fixture", "CF1-F03");
const repeats = Number(option("--repeats", "3"));
const paired = option("--paired", "false") === "true";
const seed = Number(option("--seed", "3724605090"));
const model = option("--model", "gpt-4o-mini");
const outDir = path.resolve(option("--out",
  path.join(root, "artifacts/claim-foundry/cf2", `${fixture.toLowerCase()}-terminology-ablation`)));
const baselinePaths = process.argv.slice(2)
  .filter((value, index, all) => value.endsWith("/result.json")
    && all[index - 1] !== "--out");
const fixtureRaw = JSON.parse(readFileSync(
  path.join(backend, "test/claim-foundry/fixtures", fixture, "article.json"),
  "utf8",
));
const { article, sourceUnits } = prepareCf2Article(fixtureRaw.article ?? fixtureRaw);
const assertionPrompt = buildCf2DiscoveryPromptAssertionOnly({ article, sourceUnits });
const baselinePrompt = buildCf2DiscoveryPromptMixedTerminologyLegacy({ article, sourceUnits });
if (!process.env.OPENAI_API_KEY && !process.env.REACT_APP_OPENAI_API_KEY) {
  throw new Error("OPENAI_API_KEY is required");
}
const runner = createCf1ModelRunner({ transport: createOpenAiCf1Transport() });
const runs = baselinePaths.map((resultPath) =>
  baselineRun(path.resolve(resultPath), sourceUnits));

async function runLive(arm, index, prompt) {
  const started = Date.now();
  const response = await runner.invokeStructured({
    ...prompt,
    model,
    temperature: 0.2,
    seed,
    timeoutMs: 180_000,
    maximumAttempts: 1,
    maxOutputTokens: 5_000,
  });
  const normalizedOutput = normalizeDiscovery(response.output, sourceUnits);
  const output = {
    thesisAssertion: normalizedOutput.thesisAssertion,
    candidates: normalizedOutput.candidates.map(({ rawAssertion, groundingUnitIds }) =>
      ({ rawAssertion, groundingUnitIds })),
  };
  const run = {
    arm,
    run: `${arm}-${index + 1}`,
    promptSha256: sha256(`${prompt.system}\n${prompt.user}`),
    schemaSha256: sha256(JSON.stringify(prompt.responseSchema)),
    systemFingerprint: response.rawResponse?.system_fingerprint ?? null,
    responseId: response.rawResponse?.id ?? null,
    elapsedMs: Date.now() - started,
    usage: response.usage,
    output,
    evaluation: evaluate(output, sourceUnits),
  };
  runs.push(run);
  console.log(`${run.run} · ${(run.elapsedMs / 1000).toFixed(1)}s`
    + ` · ${run.usage?.totalTokens ?? "?"} tokens`
    + ` · opponents ${run.evaluation.opponentRecall}/3`
    + ` · correct grounding ${run.evaluation.opponentGroundingCorrect}/3`
    + ` · obvious mismatches ${run.evaluation.obviousGroundingMismatches}`);
}

for (let index = 0; index < repeats; index += 1) {
  if (paired) await runLive("baseline", index, baselinePrompt);
  await runLive("assertion_only", index, assertionPrompt);
}

const aggregate = (arm) => {
  const matching = runs.filter((run) => run.arm === arm);
  return {
    arm,
    runs: matching.length,
    opponentRecall: matching.reduce((sum, run) =>
      sum + run.evaluation.opponentRecall, 0),
    opponentOpportunities: matching.length * TARGETS.length,
    opponentGroundingCorrect: matching.reduce((sum, run) =>
      sum + run.evaluation.opponentGroundingCorrect, 0),
    obviousGroundingMismatches: matching.reduce((sum, run) =>
      sum + run.evaluation.obviousGroundingMismatches, 0),
    candidateCount: matching.reduce((sum, run) =>
      sum + run.evaluation.candidateCount, 0),
    elapsedMs: matching.reduce((sum, run) => sum + run.elapsedMs, 0),
    totalTokens: matching.reduce((sum, run) =>
      sum + (run.usage?.totalTokens ?? 0), 0),
  };
};

const summary = {
  fixture,
  model,
  seed,
  prompts: {
    baseline: baselinePrompt,
    assertionOnly: assertionPrompt,
  },
  aggregates: [aggregate("baseline"), aggregate("assertion_only")],
  runs,
};
mkdirSync(outDir, { recursive: true });
writeFileSync(path.join(outDir, "results.json"), `${JSON.stringify(summary, null, 2)}\n`);
const rows = runs.map((run) => `<tr><td>${run.arm}</td><td>${run.run}</td>
  <td>${run.evaluation.candidateCount}</td><td>${run.evaluation.opponentRecall}/3</td>
  <td>${run.evaluation.opponentGroundingCorrect}/3</td>
  <td>${run.evaluation.obviousGroundingMismatches}</td>
  <td>${(run.elapsedMs / 1000).toFixed(1)}s</td><td>${run.usage?.totalTokens ?? "?"}</td>
  <td><details><summary>Output</summary><pre>${JSON.stringify(run.output, null, 2)}</pre></details></td>
  </tr>`).join("\n");
writeFileSync(path.join(outDir, "report.html"), `<!doctype html><html><head><meta charset="utf-8">
<title>CF2 Call A terminology comparison</title><style>
body{font:14px system-ui;margin:24px;max-width:1600px}table{border-collapse:collapse;width:100%}
th,td{border:1px solid #ccd3d8;padding:7px;vertical-align:top;text-align:left}
th{background:#edf1f4}pre{white-space:pre-wrap;max-height:600px;overflow:auto}
</style></head><body><h1>CF2 Call A terminology comparison</h1>
<pre>${JSON.stringify(summary.aggregates, null, 2)}</pre>
<table><thead><tr><th>Arm</th><th>Run</th><th>Candidates</th><th>Opponent recall</th>
<th>Correct opponent grounding</th><th>Obvious grounding mismatches</th><th>Time</th>
<th>Tokens</th><th>Details</th></tr></thead><tbody>${rows}</tbody></table></body></html>`);
console.log(JSON.stringify(summary.aggregates, null, 2));
console.log(path.join(outDir, "report.html"));
