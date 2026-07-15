#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import dotenv from "dotenv";
import { createCf1ModelRunner } from "../../backend/src/claim-foundry/modelRunner.js";
import { createOpenAiCf1Transport } from "../../backend/src/claim-foundry/openAiTransport.js";
import { runClaimFoundry } from "../../backend/src/claim-foundry/runClaimFoundry.js";
import { writeCf1Artifacts } from "../../backend/src/claim-foundry/artifacts.js";

function argument(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function numberArgument(name, fallback) {
  const value = Number(argument(name, fallback));
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be positive`);
  return value;
}

if (process.argv.includes("--help")) {
  console.log(`Usage:
  node scripts/dev/cf1_run_claim_foundry.mjs \\
    --article <article.json> (--openai | --transport <transport.mjs>) --model <model-id> \\
    [--artifacts <directory>] [--context-tokens 128000] [--max-total-tokens 30000] \\
    [--max-output-tokens 12000] [--timeout-ms 120000] [--no-repair] [--baseline]

--openai uses the repository OpenAI adapter and backend/.env convention.
An injected transport module must export default { invoke(request) } or a named transport object.
The default is the staged CF1 agent. --baseline explicitly runs the legacy one-shot path.
This command performs no persistence, content lookup, evidence search, or live scrape integration.`);
  process.exit(0);
}

try {
  const articlePath = argument("--article");
  const transportPath = argument("--transport");
  const model = argument("--model");
  const useOpenAi = process.argv.includes("--openai");
  if (!articlePath || (!transportPath && !useOpenAi) || !model) {
    throw new Error("--article, --model, and either --openai or --transport are required");
  }
  if (transportPath && useOpenAi) throw new Error("Choose either --openai or --transport, not both");
  if (process.argv.includes("--content-id") || process.argv.includes("--persist")) {
    throw new Error("Persistence and VeriStrata content loading are not implemented in Milestone 4C");
  }
  const article = JSON.parse(await readFile(path.resolve(articlePath), "utf8"));
  dotenv.config({ path: path.resolve("backend/.env"), quiet: true });
  const transport = useOpenAi
    ? createOpenAiCf1Transport()
    : await (async () => {
      const transportModule = await import(pathToFileURL(path.resolve(transportPath)).href);
      return transportModule.default ?? transportModule.transport;
    })();
  const modelRunner = createCf1ModelRunner({ transport });
  const result = await runClaimFoundry({
    article,
    options: {
      model,
      modelContextTokens: numberArgument("--context-tokens", 128_000),
      timeoutMs: numberArgument("--timeout-ms", 120_000),
      allowRepair: !process.argv.includes("--no-repair"),
      executionMode: process.argv.includes("--baseline") ? "baseline" : "agent",
      artifactRoot: argument("--artifacts"),
      budgetLimits: {
        maxTotalTokens: numberArgument("--max-total-tokens", 100_000),
        maxOutputTokensPerCall: numberArgument("--max-output-tokens", 12_000),
        maxDurationMs: numberArgument("--max-duration-ms", 300_000),
      },
    },
    dependencies: { modelRunner, artifactWriter: writeCf1Artifacts },
  });
  console.log(JSON.stringify({ run: result.run, packageHash: result.claimPackage?.packageHash ?? null,
    artifactRefs: result.artifactRefs }, null, 2));
  process.exitCode = result.run.status === "ready_for_evidence" ? 0 : 1;
} catch (error) {
  console.error(JSON.stringify({ code: error.code ?? "CF1_CLI_FAILED", message: error.message }, null, 2));
  process.exitCode = 2;
}
