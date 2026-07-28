#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const rootIndex = process.argv.indexOf("--root");
if (rootIndex < 0 || !process.argv[rootIndex + 1]) {
  throw new Error("--root is required");
}
const root = path.resolve(process.argv[rootIndex + 1]);
const fixtureIds = Array.from({ length: 8 }, (_, index) =>
  `CF1-F${String(index + 1).padStart(2, "0")}`);
const results = fixtureIds.map((fixtureId) => {
  const resultPath = path.join(root, fixtureId, "result.json");
  return {
    fixtureId,
    resultPath,
    result: JSON.parse(readFileSync(resultPath, "utf8")),
  };
});

const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[character]);
const csv = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;

function metrics(result) {
  const valid = result.candidateJudgments;
  const selected = new Set(result.assertions.map((item) => item.candidateId));
  return {
    candidates: result.candidates.length,
    valid: valid.length,
    quarantined: result.candidateRejections.length,
    adopted: valid.filter((item) => item.articleTreatment === "adopted").length,
    challenged: valid.filter((item) => item.articleTreatment === "challenged").length,
    reported: valid.filter((item) => item.articleTreatment === "reported").length,
    strengthens: valid.filter((item) => item.effectIfTrue === "strengthens").length,
    weakens: valid.filter((item) => item.effectIfTrue === "weakens").length,
    noEffect: valid.filter((item) => item.effectIfTrue === "no_effect").length,
    selected: selected.size,
    selectedReportedNoEffect: valid.filter((item) =>
      selected.has(item.candidateId)
      && item.articleTreatment === "reported"
      && item.effectIfTrue === "no_effect").length,
    elapsedMs: (result.calls.callA.elapsedMs ?? 0) + (result.calls.callB.elapsedMs ?? 0),
    tokens: (result.calls.callA.usage?.totalTokens ?? 0)
      + (result.calls.callB.usage?.totalTokens ?? 0),
  };
}

const summaryRows = results.map(({ fixtureId, result }) => {
  const m = metrics(result);
  return `<tr${fixtureId === "CF1-F08" ? ' class="focus"' : ""}>
    <td><a href="${esc(`${fixtureId}/report.html`)}">${esc(fixtureId)}</a></td>
    <td>${m.candidates}</td><td>${m.valid}</td><td>${m.quarantined}</td>
    <td>${m.adopted}</td><td>${m.challenged}</td><td>${m.reported}</td>
    <td>${m.strengthens}</td><td>${m.weakens}</td><td>${m.noEffect}</td>
    <td>${m.selected}</td><td>${m.selectedReportedNoEffect}</td>
    <td>${(m.elapsedMs / 1000).toFixed(1)}s</td><td>${m.tokens.toLocaleString()}</td>
  </tr>`;
}).join("\n");

const fixtureSections = results.map(({ fixtureId, result }) => {
  const validById = new Map(result.candidateJudgments
    .map((item) => [item.candidateId, item]));
  const rejectionById = new Map(result.candidateRejections
    .map((item) => [item.candidateId, item]));
  const selectedById = new Map(result.assertions
    .map((item) => [item.candidateId, item]));
  const rows = result.candidates.map((candidate) => {
    const judgment = validById.get(candidate.candidateId);
    const rejection = rejectionById.get(candidate.candidateId);
    const selected = selectedById.get(candidate.candidateId);
    const rowClass = judgment?.effectIfTrue === "weakens" ? "weakens"
      : judgment?.articleTreatment === "challenged" ? "challenged"
        : selected ? "selected" : "";
    return `<tr class="${rowClass}">
      <td>${esc(candidate.candidateId)}</td>
      <td>${selected ? "Yes" : "No"}</td>
      <td>${esc(candidate.rawAssertion)}</td>
      <td>${esc(judgment?.assertionText ?? "Quarantined")}</td>
      <td>${esc(judgment?.articleTreatment ?? rejection?.code ?? "")}</td>
      <td>${esc(judgment?.effectIfTrue ?? "")}</td>
      <td>${esc(selected?.sourceName ?? judgment?.sourceName ?? "")}</td>
      <td>${esc(candidate.groundingUnitIds.join(", "))}</td>
    </tr>`;
  }).join("\n");
  const m = metrics(result);
  return `<details ${fixtureId === "CF1-F08" ? "open" : ""}>
    <summary>${esc(fixtureId)} · ${m.candidates} candidates → ${m.valid} valid
      → ${m.selected} selected</summary>
    <p><strong>Thesis:</strong> ${esc(result.thesisAssertion)}</p>
    <table><thead><tr><th>ID</th><th>Selected</th><th>Call A assertion</th>
      <th>Call B assertion</th><th>Treatment / rejection</th><th>Effect</th>
      <th>Resolved source</th><th>Grounding</th></tr></thead>
      <tbody>${rows}</tbody></table>
  </details>`;
}).join("\n");

const totals = results.reduce((sum, { result }) => {
  const m = metrics(result);
  for (const key of Object.keys(sum)) sum[key] += m[key];
  return sum;
}, {
  candidates: 0, valid: 0, quarantined: 0, adopted: 0, challenged: 0,
  reported: 0, strengthens: 0, weakens: 0, noEffect: 0, selected: 0,
  selectedReportedNoEffect: 0, elapsedMs: 0, tokens: 0,
});

const html = `<!doctype html><html><head><meta charset="utf-8">
<title>CF2 V7 Call A + B · F01–F08</title>
<style>
body{font:14px system-ui;margin:24px;color:#17202a;max-width:1800px}
table{border-collapse:collapse;width:100%;margin:12px 0 24px}
th,td{border:1px solid #ccd3d8;padding:7px;vertical-align:top;text-align:left}
th{background:#edf1f4}.focus td{background:#fff3cd}.weakens td{background:#fff1e8}
.challenged td{background:#fce5ef}.selected td{background:#eef8ef}
details{margin:14px 0}summary{cursor:pointer;font-weight:700}
.meta{background:#eef5ff;border:1px solid #9ebce0;padding:12px}
</style></head><body>
<h1>CF2 V7 · Call A + Call B · F01–F08</h1>
<div class="meta">Prompt ablation: explicit attribution frames only; no synthesized
source suffixes. Call C was bypassed with an empty host result.<br>
${totals.candidates} candidates → ${totals.valid} valid judgments
→ ${totals.selected} selected · ${totals.quarantined} quarantined ·
${(totals.elapsedMs / 1000).toFixed(1)} model seconds ·
${totals.tokens.toLocaleString()} Call A+B tokens.</div>
<h2>Fixture summary</h2>
<table><thead><tr><th>Fixture</th><th>Call A</th><th>Valid B</th><th>Quarantine</th>
<th>Adopted</th><th>Challenged</th><th>Reported</th><th>Strengthens</th>
<th>Weakens</th><th>No effect</th><th>Selected</th>
<th>Selected reported+no effect</th><th>A+B time</th><th>A+B tokens</th>
</tr></thead><tbody>${summaryRows}</tbody></table>
<h2>Every Call A candidate and Call B judgment</h2>
${fixtureSections}
</body></html>`;
writeFileSync(path.join(root, "report.html"), html);

const columns = [
  "fixture", "candidateId", "selected", "rawAssertion", "assertionText",
  "articleTreatment", "effectIfTrue", "resolvedSource", "groundingUnitIds",
  "rejectionCode",
];
const csvRows = [columns.join(",")];
for (const { fixtureId, result } of results) {
  const validById = new Map(result.candidateJudgments
    .map((item) => [item.candidateId, item]));
  const rejectionById = new Map(result.candidateRejections
    .map((item) => [item.candidateId, item]));
  const selectedById = new Map(result.assertions
    .map((item) => [item.candidateId, item]));
  for (const candidate of result.candidates) {
    const judgment = validById.get(candidate.candidateId);
    const rejection = rejectionById.get(candidate.candidateId);
    const selected = selectedById.get(candidate.candidateId);
    csvRows.push([
      fixtureId,
      candidate.candidateId,
      selected ? "true" : "false",
      candidate.rawAssertion,
      judgment?.assertionText ?? "",
      judgment?.articleTreatment ?? "",
      judgment?.effectIfTrue ?? "",
      selected?.sourceName ?? judgment?.sourceName ?? "",
      candidate.groundingUnitIds.join("|"),
      rejection?.code ?? "",
    ].map(csv).join(","));
  }
}
writeFileSync(path.join(root, "claims.csv"), `${csvRows.join("\n")}\n`);
console.log(`${root}/report.html`);
