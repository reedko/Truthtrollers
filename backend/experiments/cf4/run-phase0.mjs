#!/usr/bin/env node
import { mkdirSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../..");
const stamp = new Date().toISOString().replace(/[-:T.]/g, "").slice(0, 14)
  .replace(/(\d{8})(\d{6})/, "$1-$2");
const outDir = path.join(root, "artifacts/claim-foundry/cf4/deterministic-phase0", stamp);
const inputPath = path.join(outDir, "input.json");
const specOption = process.argv.find((value) => value.startsWith("--evaluation="));
if (!specOption) throw new Error("Pass --evaluation=<evaluation JSON path>");
const evaluationPath = path.resolve(specOption.slice("--evaluation=".length));
mkdirSync(outDir, { recursive: true });

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run("node", [path.join(root, "backend/experiments/cf4/prepare-phase0.mjs"),
  inputPath, evaluationPath]);
run(path.join(root, "backend/experiments/cf4/.venv/bin/python"), [
  path.join(root, "backend/experiments/cf4/phase0.py"),
  "--input", inputPath,
  "--out", outDir,
  "--verbs", path.join(root, "backend/experiments/cf4/config/reporting-verbs.json"),
]);
run("node", [path.join(root, "backend/experiments/cf4/report-phase0.mjs"), outDir]);
console.log(`CF4 Phase 0 artifacts: ${outDir}`);
