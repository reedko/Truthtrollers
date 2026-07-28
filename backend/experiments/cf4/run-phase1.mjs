#!/usr/bin/env node
import { mkdirSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../..");
const stamp = new Date().toISOString().replace(/[-:T.]/g, "").slice(0, 14)
  .replace(/(\d{8})(\d{6})/, "$1-$2");
const outDir = path.resolve(process.argv[2] ?? path.join(root,
  "artifacts/claim-foundry/cf4/deterministic-phase1", stamp));
const fixtureOption = process.argv.find((value) => value.startsWith("--fixtures="));
const fixtureIds = fixtureOption?.slice("--fixtures=".length).split(",").filter(Boolean) ?? [];
if (!fixtureIds.length) throw new Error("Pass --fixtures=<comma-separated fixture IDs>");
mkdirSync(outDir, { recursive: true });

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run("node", [path.join(here, "prepare-phase1.mjs"), outDir, ...fixtureIds]);
for (const fixtureId of fixtureIds) {
  const fixtureOut = path.join(outDir, fixtureId);
  run(path.join(here, ".venv/bin/python"), [
    path.join(here, "phase1.py"),
    "--input", path.join(outDir, `${fixtureId}.json`),
    "--out", fixtureOut,
    "--verbs", path.join(here, "config/reporting-verbs.json"),
  ]);
}
console.log(`CF4 Phase 1 artifacts: ${outDir}`);
