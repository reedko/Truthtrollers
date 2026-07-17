#!/usr/bin/env node
// THROWAWAY dev runner: same as cf1_run_claim_foundry.mjs but tees the RAW Call 1
// semantic_inventory model output (inventoryRaw — before verifySemanticInventory /
// host critic) to <out>/inventory_raw.json. For inspecting pre-cull candidates over a
// couple of runs. Not production; delete when done.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import dotenv from "dotenv";
import { createCf1ModelRunner } from "../../backend/src/claim-foundry/modelRunner.js";
import { createOpenAiCf1Transport } from "../../backend/src/claim-foundry/openAiTransport.js";
import { runClaimFoundry } from "../../backend/src/claim-foundry/runClaimFoundry.js";
import { writeCf1Artifacts } from "../../backend/src/claim-foundry/artifacts.js";

const args = process.argv.slice(2);
const value = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; };
const articlePath = value("--article");
const outDir = value("--out");
const model = value("--model") ?? "gpt-4o-mini";
if (!articlePath || !outDir) {
  console.error("Usage: node scripts/dev/cf1_run_capture_inventory.mjs --article <article.json> --out <dir> [--model <id>]");
  process.exit(2);
}

dotenv.config({ path: path.resolve("backend/.env"), quiet: true });
const article = JSON.parse(await readFile(path.resolve(articlePath), "utf8"));

// Wrap the live transport to capture the raw Call 1 output before any host processing.
const baseTransport = createOpenAiCf1Transport();
let inventoryRaw = null;
const transport = { invoke: async (request) => {
  const response = await baseTransport.invoke(request);
  if (request.usageContext?.stage === "semantic_inventory") inventoryRaw = response.output;
  return response;
} };

const result = await runClaimFoundry({
  article,
  options: { model, modelContextTokens: 128_000, timeoutMs: 150_000, executionMode: "agent",
    artifactRoot: path.resolve(outDir),
    budgetLimits: { maxTotalTokens: 40_000, maxOutputTokensPerCall: 4_000, maxDurationMs: 200_000 } },
  dependencies: { modelRunner: createCf1ModelRunner({ transport }), artifactWriter: writeCf1Artifacts },
});

const runDir = result.artifactRefs?.artifactRoot ?? path.resolve(outDir);
await mkdir(runDir, { recursive: true });
const rawPath = path.join(runDir, "inventory_raw.json");
await writeFile(rawPath, JSON.stringify(inventoryRaw, null, 2));

console.log(JSON.stringify({
  status: result.run.status,
  packageId: result.claimPackage?.packageId ?? null,
  rawInventoryPath: rawPath,
  rawCandidateCount: Array.isArray(inventoryRaw?.candidateClaims) ? inventoryRaw.candidateClaims.length : null,
  thesisHinge: inventoryRaw?.thesisHinge ?? null,
}, null, 2));
process.exitCode = result.run.status === "ready_for_evidence" ? 0 : 1;
