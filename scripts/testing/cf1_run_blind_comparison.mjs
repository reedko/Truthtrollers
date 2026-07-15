#!/usr/bin/env node
import { resolve } from "node:path";
import dotenv from "dotenv";
import { runCf1Comparison } from "../../backend/src/claim-foundry/comparison/runComparison.js";

dotenv.config({ path: resolve("backend/.env"), quiet: true });

const args = process.argv.slice(2);
const value = (flag, fallback) => args.includes(flag) ? args[args.indexOf(flag) + 1] : fallback;
const values = (flag) => args.flatMap((item, index) => item === flag ? [args[index + 1]] : []);
const runId = value("--run-id", `cf1cmp-${new Date().toISOString().replace(/[:.]/g, "-")}`);

try {
  const result = await runCf1Comparison({
    fixtureRoot: value("--fixtures", "backend/test/claim-foundry/fixtures"),
    outputRoot: value("--output", `artifacts/claim-foundry/comparisons/${runId}`),
    model: value("--model", "gpt-4o-mini"),
    repeats: Number(value("--repeats", 3)),
    ...(values("--fixture").length ? { fixtureIds: values("--fixture") } : {}),
    ...(values("--producer").length ? { producers: values("--producer") } : {}),
    seed: value("--seed", runId),
    options: { modelContextTokens: Number(value("--context-tokens", 128_000)), timeoutMs: 120_000,
      allowRepair: !args.includes("--no-repair"), budgetLimits: {
        maxTotalTokens: Number(value("--max-total-tokens", 100_000)),
        maxOutputTokensPerCall: Number(value("--max-output-tokens", 8_000)),
        maxDurationMs: Number(value("--max-duration-ms", 300_000)) } },
    onProgress: ({ fixtureId, repeat, producer }) =>
      console.log(`${fixtureId} repeat ${repeat + 1}: ${producer}`),
  });
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(JSON.stringify({ code: error.code ?? "CF1_COMPARISON_FAILED", message: error.message }, null, 2));
  process.exitCode = 1;
}
