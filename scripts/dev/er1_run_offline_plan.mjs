#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runOfflinePlanning } from "../../backend/src/evidence-run/runOfflinePlanning.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const args = process.argv.slice(2);
const value = (flag) => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : null;
};
const packageArg = value("--package");
if (!packageArg) {
  console.error("Usage: node scripts/dev/er1_run_offline_plan.mjs --package <final_cf1_package.json> [--out <dir>] [--balanced]");
  process.exit(2);
}
const packagePath = path.resolve(root, packageArg);
const outputDir = path.resolve(root, value("--out") || "artifacts/evidence-run/offline-plan");
const balancePolicy = args.includes("--balanced") ? {
  mode: "seek_multiple_bearings", desiredBearing: ["support", "refute", "qualify"],
  minimumIndependentSourcesPerBearing: 1,
} : undefined;

const result = await runOfflinePlanning({ packagePath, outputDir,
  options: { profile: "standard", ...(balancePolicy ? { balancePolicy } : {}) } });
console.log(JSON.stringify({ runId: result.runId, packageId: result.verification.packageId,
  tasks: result.portfolio.taskCount, targets: result.portfolio.targetCount,
  identities: result.identityRegistry.entryCount, lanes: result.lanePlan.laneCount,
  outputDir }, null, 2));
