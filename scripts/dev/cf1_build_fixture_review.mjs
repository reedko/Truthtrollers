#!/usr/bin/env node
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

async function json(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

function seconds(step) {
  if (!step?.startedAt || !step?.completedAt) return 0;
  return (Date.parse(step.completedAt) - Date.parse(step.startedAt)) / 1000;
}

function cell(value) {
  return String(value ?? "").replaceAll("|", "\\|").replaceAll("\n", " ");
}

const rates = { input: 0.15, cachedInput: 0.075, output: 0.60 };
function usageCost(usage = {}) {
  const cached = usage.cachedInputTokens ?? 0;
  const uncached = Math.max(0, (usage.inputTokens ?? 0) - cached);
  return (uncached * rates.input + cached * rates.cachedInput
    + (usage.outputTokens ?? 0) * rates.output) / 1_000_000;
}

function sumUsage(steps) {
  return steps.reduce((sum, step) => ({
    inputTokens: sum.inputTokens + (step.usage?.inputTokens ?? 0),
    cachedInputTokens: sum.cachedInputTokens + (step.usage?.cachedInputTokens ?? 0),
    outputTokens: sum.outputTokens + (step.usage?.outputTokens ?? 0),
  }), { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 });
}

const rootArgument = argument("--root");
if (!rootArgument) throw new Error("--root <eight-fixture artifact directory> is required");
const root = path.resolve(rootArgument);
const fixtureIds = (await readdir(root, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory() && /^CF1-F\d\d$/.test(entry.name))
  .map((entry) => entry.name).sort();
const fixtures = [];

for (const fixtureId of fixtureIds) {
  const fixtureRoot = path.join(root, fixtureId);
  const runNames = (await readdir(fixtureRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("cf1run_"))
    .map((entry) => entry.name).sort();
  if (!runNames.length) throw new Error(`${fixtureId} has no CF1 run directory`);
  const attempts = await Promise.all(runNames.map(async (name) => {
    const attemptRoot = path.join(fixtureRoot, name);
    return { root: attemptRoot, run: await json(path.join(attemptRoot, "run.json")),
      trace: await json(path.join(attemptRoot, "cf1_agent_trace.json")) };
  }));
  const accepted = attempts.findLast((attempt) => attempt.run.status === "ready_for_evidence");
  if (!accepted) throw new Error(`${fixtureId} has no ready_for_evidence run`);
  const runRoot = accepted.root;
  const [run, trace, pkg, initial, markdown, verification] = await Promise.all([
    json(path.join(runRoot, "run.json")),
    json(path.join(runRoot, "cf1_agent_trace.json")),
    json(path.join(runRoot, "final_cf1_package.json")),
    json(path.join(runRoot, "initial_claims.json")),
    readFile(path.join(runRoot, "claim-package.md"), "utf8"),
    json(path.join(runRoot, "verification.json")),
  ]);
  const call1 = trace.steps.find((step) => step.stage === "semantic_inventory");
  const call2 = trace.steps.find((step) => step.stage === "selected_claim_enrichment");
  const physicalSteps = attempts.flatMap((attempt) => attempt.trace.steps)
    .filter((step) => step.modelCall && step.usage && seconds(step) >= 0.1);
  const effective = (step) => seconds(step) >= 0.1 ? step : physicalSteps.find((candidate) =>
    candidate.stage === step.stage
      && candidate.usage.inputTokens === step.usage.inputTokens
      && candidate.usage.outputTokens === step.usage.outputTokens) ?? step;
  fixtures.push({ fixtureId, runRoot, run, pkg, initial, markdown, verification,
    call1: effective(call1), call2: effective(call2), acceptedTrace: trace, attempts, physicalSteps });
}

const acceptedSteps = fixtures.flatMap((item) => item.acceptedTrace.steps)
  .filter((step) => step.modelCall && step.usage);
const acceptedUsage = sumUsage(acceptedSteps);
const physicalSteps = fixtures.flatMap((item) => item.physicalSteps);
const physicalUsage = sumUsage(physicalSteps);
const totalTokens = acceptedUsage.inputTokens + acceptedUsage.outputTokens;
const acceptedCost = usageCost(acceptedUsage);
const physicalCost = usageCost(physicalUsage);
const totalSeconds = fixtures.reduce((sum, item) => sum + seconds(item.call1) + seconds(item.call2), 0);
const lines = [
  "# CF1 compact two-call eight-fixture review",
  "",
  "Each fixture section contains its complete human-readable claim package. Costs use the OpenAI GPT-4o mini text rates checked 2026-07-15: $0.15/M uncached input, $0.075/M cached input, and $0.60/M output.",
  "",
  "Pricing source: https://developers.openai.com/api/docs/models/gpt-4o-mini",
  "",
  "## Run summary",
  "",
  "| Fixture | Candidates | Selected | Named works | Call 1 | Call 2 | Total time | Package cost | Valid | Repair |",
  "|---|---:|---:|---:|---:|---:|---:|---:|:---:|:---:|",
];

for (const item of fixtures) {
  const c1 = `${item.call1?.usage?.inputTokens ?? 0}+${item.call1?.usage?.outputTokens ?? 0} tok / ${seconds(item.call1).toFixed(1)}s`;
  const c2 = `${item.call2?.usage?.inputTokens ?? 0}+${item.call2?.usage?.outputTokens ?? 0} tok / ${seconds(item.call2).toFixed(1)}s`;
  const packageUsage = sumUsage(item.acceptedTrace.steps.filter((step) => step.modelCall && step.usage));
  const elapsed = seconds(item.call1) + seconds(item.call2);
  lines.push(`| ${cell(item.fixtureId)} | ${item.initial.initialCandidates?.length ?? 0} | ${item.pkg.selectedEvaluationClaims.length} | ${item.pkg.articleMap?.contextWorks?.length ?? 0} | ${c1} | ${c2} | ${elapsed.toFixed(1)}s | $${usageCost(packageUsage).toFixed(4)} | ${item.verification.valid ? "yes" : "no"} | ${item.run.usage.repairCalls ? "yes" : "no"} |`);
}

lines.push("", `- Combined tokens: ${totalTokens.toLocaleString("en-US")}`,
  `- Combined accepted-package model time: ${totalSeconds.toFixed(1)} seconds`,
  `- Estimated accepted-package API cost: $${acceptedCost.toFixed(4)}`,
  "- Model calls: 16 (two per fixture)",
  "- Evidence searches: 0", "",
  "Token notation is `input+output`. The accepted-package totals treat F03 as one logical package run: its saved Call 1 plus the successful replacement Call 2.",
  "", "## Rejected attempts and actual suite spend", "",
  "| Fixture | Error | Billed tokens | Billed model time |",
  "|---|---|---:|---:|",
);

for (const item of fixtures) {
  for (const attempt of item.attempts.filter((value) => value.run.status !== "ready_for_evidence")) {
    const steps = attempt.trace.steps.filter((step) => step.modelCall && step.usage && seconds(step) >= 0.1);
    const usage = sumUsage(steps);
    lines.push(`| ${item.fixtureId} | ${attempt.run.error?.code ?? "unknown"} | ${(usage.inputTokens + usage.outputTokens).toLocaleString("en-US")} | ${steps.reduce((sum, step) => sum + seconds(step), 0).toFixed(1)}s |`);
  }
}

lines.push("", `- Actual physical model calls including rejected attempts: ${physicalSteps.length}`,
  `- Actual billed tokens including rejected attempts: ${(physicalUsage.inputTokens + physicalUsage.outputTokens).toLocaleString("en-US")}`,
  `- Actual physical model-call time including rejected attempts: ${physicalSteps.reduce((sum, step) => sum + seconds(step), 0).toFixed(1)} seconds`,
  `- Estimated actual API cost including rejected attempts: $${physicalCost.toFixed(4)}`,
  "- The sandbox DNS failure reached no model and incurred no tokens.",
  "", "## Complete packages", "");

for (const item of fixtures) {
  const body = item.markdown.replace(/^# CF1 Claim Package\s*/u, "").trim();
  lines.push(`# ${item.fixtureId}`, "", body, "", "---", "");
}

const output = path.join(root, "claim-packages-by-fixture.md");
await writeFile(output, `${lines.join("\n")}\n`, "utf8");
console.log(output);
