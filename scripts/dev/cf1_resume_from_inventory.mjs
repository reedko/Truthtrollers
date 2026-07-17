#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import path from "node:path";
import dotenv from "dotenv";
import { createCf1ModelRunner } from "../../backend/src/claim-foundry/modelRunner.js";
import { createOpenAiCf1Transport } from "../../backend/src/claim-foundry/openAiTransport.js";
import { runClaimFoundry } from "../../backend/src/claim-foundry/runClaimFoundry.js";
import { writeCf1Artifacts } from "../../backend/src/claim-foundry/artifacts.js";

function argument(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const sourceRoot = path.resolve(argument("--run") ?? "");
const artifactRoot = argument("--artifacts");
const model = argument("--model", "gpt-4o-mini");
if (!argument("--run") || !artifactRoot) {
  throw new Error("--run <completed artifact directory> and --artifacts <directory> are required");
}

dotenv.config({ path: path.resolve("backend/.env"), quiet: true });
const replayEnrichment = process.argv.includes("--replay-enrichment");
const [article, inventory, trace, savedEnrichment] = await Promise.all([
  readFile(path.join(sourceRoot, "article.json"), "utf8").then(JSON.parse),
  readFile(path.join(sourceRoot, "semantic_inventory.json"), "utf8").then(JSON.parse),
  readFile(path.join(sourceRoot, "cf1_agent_trace.json"), "utf8").then(JSON.parse),
  replayEnrichment
    ? readFile(path.join(sourceRoot, "selected_enrichment.json"), "utf8").then(JSON.parse)
    : Promise.resolve(null),
]);
const savedStep = trace.steps.find((step) => step.stage === "semantic_inventory");
const savedEnrichmentStep = trace.steps.find((step) => step.stage === "selected_claim_enrichment");
if (!savedStep?.usage) throw new Error("The source run has no completed semantic inventory usage");
const liveRunner = createCf1ModelRunner({ transport: createOpenAiCf1Transport() });
let replayed = false;
const modelRunner = Object.freeze({ invokeStructured(request) {
  if (request.usageContext?.stage !== "semantic_inventory") {
    if (replayEnrichment && request.usageContext?.stage === "selected_claim_enrichment") {
      return Promise.resolve({ output: structuredClone(savedEnrichment),
        usage: savedEnrichmentStep.usage, model: "saved-selected-enrichment",
        attempts: 0, rawResponse: null });
    }
    return liveRunner.invokeStructured(request);
  }
  if (replayed) throw new Error("Semantic inventory replay was requested more than once");
  replayed = true;
  return Promise.resolve({ output: structuredClone(inventory), usage: savedStep.usage,
    model: "saved-semantic-inventory", attempts: 0, rawResponse: null });
} });

const result = await runClaimFoundry({ article, options: {
  model, modelContextTokens: 128_000, timeoutMs: 75_000, allowRepair: true,
  executionMode: "agent", artifactRoot,
  budgetLimits: { maxTotalTokens: 25_000, maxOutputTokensPerCall: 3_000,
    maxDurationMs: 180_000 },
}, dependencies: { modelRunner, artifactWriter: writeCf1Artifacts } });

console.log(JSON.stringify({ replayedSemanticInventoryFrom: sourceRoot, run: result.run,
  packageHash: result.claimPackage?.packageHash ?? null, artifactRefs: result.artifactRefs }, null, 2));
process.exitCode = result.run.status === "ready_for_evidence" ? 0 : 1;
