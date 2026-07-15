#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { buildCf1GateReport } from "../../backend/src/claim-foundry/comparison/report.js";

const args = process.argv.slice(2);
const value = (flag) => args[args.indexOf(flag) + 1];
const inputPath = value("--input");
const outputPath = value("--output");
if (!inputPath || !outputPath) {
  console.error("Usage: cf1_compare_current.mjs --input comparison-runs.json --output gate-report.json");
  process.exitCode = 2;
} else {
  const input = JSON.parse(await readFile(resolve(inputPath), "utf8"));
  const report = buildCf1GateReport(input);
  await writeFile(resolve(outputPath), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ output: resolve(outputPath), gates: report.gates }, null, 2));
  if (Object.values(report.gates).some((gate) => gate.status !== "pass")) process.exitCode = 1;
}
