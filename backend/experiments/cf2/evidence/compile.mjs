#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { compileEvidenceDocket } from "./handoff.js";

const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g,
  (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;",
    '"': "&quot;", "'": "&#39;" })[character]);

function option(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const outDir = path.resolve(option("--out",
  "artifacts/evidence-run/cf2-v6-locked-handoff-20260724"));
const codeCommit = option("--commit", null);
const inputPaths = process.argv.slice(2).filter((value, index, all) =>
  !["--out", "--commit"].includes(value)
  && !["--out", "--commit"].includes(all[index - 1]));
if (inputPaths.length === 0) {
  throw new Error("Pass one or more CF2 result.json paths");
}

const entries = inputPaths.map((inputPath) => {
  const absolute = path.resolve(inputPath);
  const fixtureId = absolute.match(/\bcf1-f\d{2}\b/i)?.[0]?.toUpperCase();
  if (!fixtureId) throw new Error(`Cannot derive fixture ID from ${inputPath}`);
  return {
    fixtureId,
    result: JSON.parse(readFileSync(absolute, "utf8")),
  };
});
const docket = compileEvidenceDocket(entries, { codeCommit });
const tasks = docket.fixtures.flatMap((fixture) => fixture.tasks);
const rows = tasks.map((task) => `<tr>
  <td>${escapeHtml(task.evidenceTaskId)}</td>
  <td>${escapeHtml(task.assertionText)}</td>
  <td>${escapeHtml(task.assertionSource.name ?? "Unresolved")}</td>
  <td>${escapeHtml(task.articleTreatment)}</td>
  <td>${escapeHtml(task.effectIfTrue)}</td>
  <td>${escapeHtml(task.scoreTransform)}</td>
  <td>${escapeHtml(task.evidenceAnchors.map((anchor) => anchor.name).join("; ") || "None")}</td>
  <td>${escapeHtml(task.warnings.join(", ") || "None")}</td>
</tr>`).join("\n");
const html = `<!doctype html><html><head><meta charset="utf-8">
<title>CF2 locked evidence handoff</title><style>
body{font:14px system-ui;margin:24px;color:#17202a}table{border-collapse:collapse;width:100%}
th,td{border:1px solid #ccd3d8;padding:7px;vertical-align:top;text-align:left}
th{background:#edf1f4;position:sticky;top:0}code{background:#f2f4f5;padding:2px 4px}
</style></head><body><h1>CF2 locked evidence handoff</h1>
<p>Baseline <code>${escapeHtml(docket.baselineId)}</code> · commit
<code>${escapeHtml(docket.codeCommit ?? "not recorded")}</code> ·
${docket.fixtureCount} fixtures · ${docket.taskCount} selected assertion tasks.</p>
<p>This is an immutable handoff docket. Evidence-target planning has not yet run.</p>
<pre>${escapeHtml(JSON.stringify(docket.warningCounts, null, 2))}</pre>
<table><thead><tr><th>Task</th><th>Frozen assertion</th><th>Source</th>
<th>Treatment</th><th>Effect</th><th>Transform</th><th>Named anchors</th>
<th>Handoff warnings</th></tr></thead><tbody>${rows}</tbody></table>
</body></html>`;

mkdirSync(outDir, { recursive: true });
writeFileSync(path.join(outDir, "evidence-docket.json"),
  `${JSON.stringify(docket, null, 2)}\n`);
writeFileSync(path.join(outDir, "evidence-tasks.jsonl"),
  `${tasks.map((task) => JSON.stringify(task)).join("\n")}\n`);
writeFileSync(path.join(outDir, "report.html"), html);
console.log(JSON.stringify({
  outDir,
  fixtures: docket.fixtureCount,
  tasks: docket.taskCount,
  warningCounts: docket.warningCounts,
}, null, 2));
