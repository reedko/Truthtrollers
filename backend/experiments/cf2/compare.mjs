#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[character]);

function option(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function metric(rows) {
  return {
    total: rows.length,
    named: rows.filter((row) => row.sourceName).length,
    externalNamed: rows.filter((row) =>
      row.sourceName && row.sourceKind !== "article_voice").length,
    articleVoice: rows.filter((row) => row.sourceKind === "article_voice").length,
    unresolved: rows.filter((row) => !row.sourceName).length,
    weakens: rows.filter((row) => row.effectIfTrue === "weakens").length,
    challenged: rows.filter((row) => row.articleTreatment === "challenged").length,
  };
}

function sourceLabel(row) {
  if (!row.sourceName) return "Unresolved";
  return `${row.sourceName} · ${row.sourceKind}`;
}

function rowClass(row) {
  if (!row.sourceName) return "unresolved";
  if (row.sourceKind === "article_voice") return "article-voice";
  return "external";
}

const outDir = path.resolve(option("--out", "artifacts/claim-foundry/cf2/comparison"));
const resultPaths = process.argv.slice(2).filter((value, index, all) =>
  value !== "--out" && all[index - 1] !== "--out");
if (resultPaths.length === 0) {
  throw new Error("Pass one or more result.json paths");
}

const runs = resultPaths.map((resultPath, index) => {
  const absolute = path.resolve(resultPath);
  const result = JSON.parse(readFileSync(absolute, "utf8"));
  return {
    id: `R${index + 1}`,
    absolute,
    directory: path.dirname(absolute),
    result,
    selected: metric(result.assertions),
    judgments: metric(result.candidateJudgments),
  };
});

const summaryRows = runs.map((run) => {
  const report = path.relative(outDir, path.join(run.directory, "report.html"));
  const totalTokens = Object.values(run.result.calls)
    .reduce((sum, call) => sum + (call.usage?.totalTokens ?? 0), 0);
  return `<tr>
    <td><a href="${escapeHtml(report)}">${run.id}</a></td>
    <td>${escapeHtml(run.result.article.title)}</td>
    <td>${run.result.candidates.length} / ${run.judgments.total} / ${run.selected.total}</td>
    <td>${run.result.candidateRejections?.length ?? 0}</td>
    <td>${run.selected.externalNamed}</td>
    <td>${run.selected.articleVoice}</td>
    <td>${run.selected.unresolved}</td>
    <td>${run.selected.weakens}</td>
    <td>${run.selected.challenged}</td>
    <td>${(run.result.elapsedMs / 1000).toFixed(1)}s</td>
    <td>${totalTokens.toLocaleString()}</td>
  </tr>`;
}).join("\n");

const runSections = runs.map((run) => {
  const selectedIds = new Set(run.result.assertions.map((row) => row.candidateId));
  const selectedById = new Map(run.result.assertions
    .map((row) => [row.candidateId, row]));
  const rows = run.result.candidateJudgments.map((row) => `<tr class="${rowClass(row)}">
    <td>${selectedIds.has(row.candidateId) ? "✓" : ""}</td>
    <td>${escapeHtml(row.candidateId)}</td>
    <td>${escapeHtml(row.assertionText)}</td>
    <td>${escapeHtml(sourceLabel(row))}</td>
    <td>${escapeHtml(row.sourceNameOrigin || "none")}</td>
    <td>${escapeHtml(row.articleTreatment)}</td>
    <td>${escapeHtml(row.effectIfTrue)}</td>
    <td>${escapeHtml(selectedById.get(row.candidateId)?.selectionBasis ?? "")}</td>
    <td>${escapeHtml(row.groundingUnitIds.join(", "))}</td>
  </tr>`).join("\n");
  return `<section>
    <h2>${run.id} · ${escapeHtml(run.result.article.title)}</h2>
    <p><strong>Thesis:</strong> ${escapeHtml(run.result.thesisAssertion)}</p>
    <p>Selected attribution: ${run.selected.externalNamed} external named ·
      ${run.selected.articleVoice} article voice · ${run.selected.unresolved} unresolved</p>
    <details open><summary>All Call B judgments; ✓ means selected</summary>
      <table><thead><tr><th>Selected</th><th>ID</th><th>Assertion</th>
      <th>Source</th><th>Name origin</th><th>Treatment</th><th>If true</th>
      <th>Selection basis</th><th>Grounding</th></tr></thead><tbody>${rows}</tbody></table>
    </details>
    <details><summary>Prompt and response provenance</summary>
      <pre>${escapeHtml(JSON.stringify({
        callA: {
          model: run.result.calls.callA.returnedModel,
          responseId: run.result.calls.callA.responseId,
          systemFingerprint: run.result.calls.callA.systemFingerprint,
          promptSha256: run.result.calls.callA.promptSha256,
          schemaSha256: run.result.calls.callA.schemaSha256,
        },
        callB: {
          model: run.result.calls.callB.returnedModel,
          responseId: run.result.calls.callB.responseId,
          systemFingerprint: run.result.calls.callB.systemFingerprint,
          promptSha256: run.result.calls.callB.promptSha256,
          schemaSha256: run.result.calls.callB.schemaSha256,
        },
      }, null, 2))}</pre>
    </details>
  </section>`;
}).join("\n");

const html = `<!doctype html><html><head><meta charset="utf-8">
<title>CF2 benchmark comparison</title>
<style>
body{font:14px system-ui;margin:24px;color:#17202a;max-width:1800px}
table{border-collapse:collapse;width:100%;margin:12px 0 24px}
th,td{border:1px solid #ccd3d8;padding:7px;vertical-align:top;text-align:left}
th{background:#edf1f4;position:sticky;top:0}
.external td{background:#eef8ef}.article-voice td{background:#fff8e7}
.unresolved td{background:#fff0f0}summary{cursor:pointer;font-weight:650}
section{border-top:3px solid #435b71;margin-top:32px;padding-top:12px}
pre{white-space:pre-wrap;background:#f4f6f7;padding:12px}
.legend span{display:inline-block;padding:5px 10px;margin-right:8px;border:1px solid #ccd3d8}
</style></head><body>
<h1>CF2 · Benchmark comparison</h1>
<p>Green: named external source. Amber: article voice/byline. Red: unresolved source.
These are coverage labels, not determinations that the attribution is semantically correct.</p>
<p class="legend"><span class="external">External named</span>
<span class="article-voice">Article voice</span><span class="unresolved">Unresolved</span></p>
<table><thead><tr><th>Run</th><th>Fixture</th><th>Candidates / judgments / selected</th>
<th>Quarantined</th><th>External named</th><th>Article voice</th><th>Unresolved</th>
<th>Weakens</th><th>Challenged</th><th>Time</th><th>Tokens</th></tr></thead>
<tbody>${summaryRows}</tbody></table>
${runSections}
</body></html>`;

mkdirSync(outDir, { recursive: true });
writeFileSync(path.join(outDir, "report.html"), html);
writeFileSync(path.join(outDir, "summary.json"), `${JSON.stringify(runs.map((run) => ({
  runId: run.id,
  resultPath: run.absolute,
  title: run.result.article.title,
  thesisAssertion: run.result.thesisAssertion,
  candidates: run.result.candidates.length,
  judgments: run.judgments,
  selected: run.selected,
  quarantined: run.result.candidateRejections?.length ?? 0,
  elapsedMs: run.result.elapsedMs,
})), null, 2)}\n`);
console.log(path.join(outDir, "report.html"));
