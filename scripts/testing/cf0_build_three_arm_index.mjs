#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";

const outputDir = process.argv[2];
if (!outputDir) throw new Error("Usage: node scripts/testing/cf0_build_three_arm_index.mjs <output-dir>");
const arms = [
  ["simple", "Simple"],
  ["superblind", "Superblind"],
  ["superblind-stance-v2", "Superblind + stance v2"],
];
const entries = await Promise.all(arms.map(async ([id, label]) => {
  const manifest = JSON.parse(await fs.readFile(path.join(outputDir, id, "manifest.json"), "utf8"));
  return { id, label, manifest };
}));
const rows = entries.map(({ id, label, manifest }) => `<tr><td>${label}</td><td>${manifest.claimCount}</td><td>${manifest.usage?.total_tokens ?? "—"}</td><td><a href="${id}/review.html">HTML review</a></td><td><a href="${id}/claims.csv">CSV</a></td></tr>`).join("\n");
const html = `<!doctype html><html><head><meta charset="utf-8"><title>CF0 three-arm comparison</title><style>body{font:16px system-ui;margin:32px;color:#172033}table{border-collapse:collapse}th,td{border:1px solid #cbd5e1;padding:10px;text-align:left}th{background:#eaf2ff}</style></head><body><h1>CF0: Simple vs Superblind vs Superblind + stance v2</h1><p>Each arm is one model call on the same F03 fixture.</p><table><tr><th>Arm</th><th>Claims</th><th>Total tokens</th><th>Review</th><th>CSV</th></tr>${rows}</table></body></html>`;
await fs.writeFile(path.join(outputDir, "comparison.html"), html);
console.log(path.join(outputDir, "comparison.html"));
