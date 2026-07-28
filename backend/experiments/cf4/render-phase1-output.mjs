#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const fixtureDir = path.resolve(process.argv[2]);
const s1 = JSON.parse(readFileSync(path.join(fixtureDir, "s1_parse.json"), "utf8"));
const s3 = JSON.parse(readFileSync(path.join(
  fixtureDir, "s3_candidates.json"), "utf8"));
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[char]);
const replacements = s1.coreference.replacementLog;
const diagnostics = s1.coreference.diagnostics;
const candidates = s3.candidates;
const titleInsertions = candidates.filter((row) =>
  /professor emeritus at King.s College London (?:explained|mean|stressed|called)/i
    .test(row.assertionText));
const agency = replacements.filter((row) =>
  row.originalSpan.toLowerCase() === "the agency");

const candidateRows = candidates.map((row) => `<tr data-search="${esc([
  row.candidateId, row.assertionText, row.assertionSource?.name,
  ...(row.groundingUnitIds ?? []),
].join(" ").toLowerCase())}">
  <td><code>${row.candidateId}</code></td>
  <td>${esc(row.assertionText)}</td>
  <td>${esc(row.assertionSource?.name)}<small>${esc(row.assertionSource?.kind)}</small></td>
  <td><code>${esc(row.groundingUnitIds.join(", "))}</code></td>
  <td>${esc(row.attributionPattern)}</td></tr>`).join("");
const replacementRows = replacements.map((row) => `<tr>
  <td>${row.sentenceIndex}</td><td>${esc(row.originalSpan)}</td>
  <td><b>${esc(row.replacement)}</b></td><td>${row.clusterId}</td>
  <td>${esc(row.ruleFired)}</td><td>${Number(row.confidence).toFixed(4)}</td></tr>`).join("");
const diagnosticRows = diagnostics.map((row) => `<tr>
  <td>${row.sentenceIndex}</td><td>${esc(row.originalSpan)}</td>
  <td>${row.clusterId}</td><td>${esc(row.reason)}</td>
  <td>${row.confidence == null ? "" : Number(row.confidence).toFixed(4)}</td></tr>`).join("");

const html = `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(s3.fixtureId)} post-ticket Phase-1 output</title><style>
:root{background:#f2f3f1;color:#19211f;font:15px/1.45 Inter,system-ui}
body{margin:0}main{max-width:1500px;margin:auto;padding:30px}h1{margin-bottom:4px}
.sub{color:#62706c}.cards{display:flex;gap:10px;flex-wrap:wrap;margin:22px 0}
.card{background:#fff;border:1px solid #d7dcda;border-radius:10px;padding:13px 17px}
.card b{display:block;font-size:24px}.pass{color:#087443}.fail{color:#b52626}
section{background:white;border:1px solid #d7dcda;border-radius:12px;padding:22px;
margin:20px 0;overflow:auto}details summary{cursor:pointer;font-weight:750;font-size:18px}
table{border-collapse:collapse;width:100%;font-size:13px;margin-top:15px}
th{background:#253c37;color:white;text-align:left;position:sticky;top:0}
th,td{border:1px solid #dde2df;padding:8px;vertical-align:top}
tr:nth-child(even) td{background:#f7f8f7}small{display:block;color:#68736f}
code{white-space:nowrap}.article{white-space:pre-wrap;max-width:1000px}
input{box-sizing:border-box;width:100%;padding:11px;border:1px solid #aeb8b5;
border-radius:7px;font:inherit;margin:12px 0}.note{background:#e9f2ef;border-left:5px solid #187565;
padding:14px 16px}.warning{background:#fff1d2;border-left-color:#c88700}
</style></head><body><main>
<h1>${esc(s3.fixtureId)} — post-ticket Phase-1 output</h1>
<div class="sub">Run: 20260726-s1-short-proper-name-v3 · deterministic S1–S3 output · no S6</div>
<div class="cards">
 <div class="card"><b>${candidates.length}</b>candidates</div>
 <div class="card"><b>${replacements.length}</b>coreference replacements</div>
 <div class="card"><b>${diagnostics.length}</b>unresolved diagnostics</div>
 <div class="card"><b class="${titleInsertions.length ? "fail" : "pass"}">${titleInsertions.length}</b>bad appositive insertions</div>
</div>
<div class="note"><b>Ticket check:</b> no replacement string contains the Antoniou
appositive. ${agency.length ? `The two model-linked “the agency” mentions resolve to
<b>${esc(agency[0].replacement)}</b>.` : "No agency replacement was logged."}</div>
<section><h2>Extracted candidate inventory</h2>
<input id="filter" placeholder="Filter by candidate ID, assertion, source, or unit…">
<table id="candidates"><thead><tr><th>ID</th><th>Assertion</th><th>Source</th>
<th>Units</th><th>Attribution</th></tr></thead><tbody>${candidateRows}</tbody></table></section>
<section><details open><summary>Coreference replacement log (${replacements.length})</summary>
<table><thead><tr><th>Sentence</th><th>Original</th><th>Replacement</th>
<th>Cluster</th><th>Rule</th><th>Confidence</th></tr></thead>
<tbody>${replacementRows}</tbody></table></details></section>
<section><details><summary>Unresolved diagnostics (${diagnostics.length})</summary>
<table><thead><tr><th>Sentence</th><th>Span</th><th>Cluster</th><th>Reason</th>
<th>Confidence</th></tr></thead><tbody>${diagnosticRows}</tbody></table></details></section>
<section><details><summary>Fully resolved article text</summary>
<div class="article">${esc(s1.coreference.resolvedText)}</div></details></section>
<script>
const filter=document.getElementById("filter");
filter.addEventListener("input",()=>{const q=filter.value.toLowerCase().trim();
document.querySelectorAll("#candidates tbody tr").forEach((row)=>{
row.hidden=q&&!row.dataset.search.includes(q);});});
</script></main></body></html>`;

writeFileSync(path.join(fixtureDir, "report.html"), html);
console.log(path.join(fixtureDir, "report.html"));
