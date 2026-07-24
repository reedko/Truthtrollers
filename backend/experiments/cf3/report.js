import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[character]);

const csvCell = (value) => {
  const string = Array.isArray(value) ? value.join(" | ") : String(value ?? "");
  return `"${string.replaceAll('"', '""')}"`;
};

// Client-side script for the interactive report. No backticks (the whole document is
// assembled by a template literal). Styled and structured after the CF1 blinded-review
// report: nav tabs, filters, sortable sticky headers, expandable detail rows.
const CLIENT_SCRIPT = `
const esc = (v) => String(v == null ? "" : v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const arr = (v) => Array.isArray(v) ? v : [];
const list = (v) => arr(v).length ? "<ul>" + arr(v).map((x) => "<li>" + esc(x) + "</li>").join("") + "</ul>" : " <span class=muted>(none)</span>";
const selectedIds = new Set(DATA.assertions.map((a) => a.assertionId));
const sourceLabel = (s) => (!s || s.kind === "unknown" || !s.name) ? "Unknown" : (s.name + " (" + s.kind + ")");
const yn = (b) => b ? "yes" : "no";
const effectClass = (e) => e === "weakens" ? "weakens" : e === "strengthens" ? "strengthens" : "neutral";

let tab = "portfolio", sortKey = null, sortDir = 1;
const S = { q: "", effect: "", treatment: "", inv: "" };

function setTab(t) { tab = t; sortKey = null;
  document.querySelectorAll("nav button").forEach((b) => b.classList.toggle("active", b.dataset.tab === t));
  syncFilters(); render(); }

function syncFilters() {
  document.getElementById("f-effect").style.display = tab === "portfolio" ? "" : "none";
  document.getElementById("f-treatment").style.display = tab === "portfolio" ? "" : "none";
  document.getElementById("f-inv").style.display = tab === "candidates" ? "" : "none";
}

function matchQ(text) { return !S.q || String(text).toLowerCase().indexOf(S.q.toLowerCase()) >= 0; }
function tgl(tr) { const d = tr.nextElementSibling; d.style.display = d.style.display === "none" ? "" : "none"; }

function sortRows(rows, keyOf) {
  if (!sortKey) return rows;
  return rows.slice().sort((a, b) => {
    const va = keyOf(a, sortKey), vb = keyOf(b, sortKey);
    if (va < vb) return -sortDir; if (va > vb) return sortDir; return 0;
  });
}
function header(cols) {
  return "<tr>" + cols.map((c) => "<th data-k=\\"" + c[0] + "\\" onclick=\\"clickSort('" + c[0] + "')\\">" +
    esc(c[1]) + (sortKey === c[0] ? (sortDir > 0 ? " \\u25b2" : " \\u25bc") : "") + "</th>").join("") + "</tr>";
}
function clickSort(k) { if (sortKey === k) sortDir = -sortDir; else { sortKey = k; sortDir = 1; } render(); }

function portfolioView() {
  let rows = DATA.assertions.filter((a) => matchQ(a.assertionId + " " + a.testableAssertion + " " + sourceLabel(a.assertionSource) + " " + a.argumentBranchId));
  if (S.effect) rows = rows.filter((a) => a.thesisEffect === S.effect);
  if (S.treatment) rows = rows.filter((a) => a.articleTreatment === S.treatment);
  const keyOf = (a, k) => k === "source" ? sourceLabel(a.assertionSource) : (a[k] == null ? "" : a[k]);
  rows = sortRows(rows, keyOf);
  const cols = [["assertionId", "ID"], ["testableAssertion", "Testable assertion"], ["source", "Source"],
    ["articleTreatment", "Treatment"], ["thesisEffect", "Thesis effect"], ["argumentBranchId", "Branch"], ["scoreTransform", "Transform"]];
  const body = rows.map((a) => {
    const cells = "<td>" + esc(a.assertionId) + "</td>" +
      "<td><strong>" + esc(a.testableAssertion) + "</strong>" + (a.challenged ? " <span class='tag chal'>challenged</span>" : "") + "</td>" +
      "<td>" + esc(sourceLabel(a.assertionSource)) + "</td>" +
      "<td>" + esc(a.articleTreatment) + "</td>" +
      "<td>" + esc(a.thesisEffect) + "</td>" +
      "<td>" + esc(a.argumentBranchId) + "</td>" +
      "<td>" + esc(a.scoreTransform) + "</td>";
    const cited = arr(a.citedWorks).map((w) => w.name + " (" + w.type + ")");
    const det = "<div class=detail>" +
      "<div><span class='tag arg'>A</span> Testable (final): " + esc(a.testableAssertion) + "</div>" +
      "<div><span class='tag disc'>D</span> Inventory assertion: " + esc(a.inventoryAssertionText) + "</div>" +
      "<div><span class='tag disc'>D</span> Grounding units: " + esc(arr(a.groundingUnitIds).join(", ")) + "</div>" +
      "<div><span class='tag arg'>A</span> Source units: " + esc(arr(a.assertionSource.sourceUnitIds).join(", ") || "none") + "</div>" +
      "<div><span class='tag arg'>A</span> Cited works: " + (cited.length ? esc(cited.join("; ")) : "none") + "</div>" +
      "<div><span class='tag host'>H</span> scoreTransform derived from treatment=" + esc(a.articleTreatment) + " + thesisEffect=" + esc(a.thesisEffect) + " &rarr; " + esc(a.scoreTransform) + "</div>" +
      "</div>";
    return "<tr class='claim " + effectClass(a.thesisEffect) + "' onclick='tgl(this)'>" + cells + "</tr>" +
      "<tr class=detail-row style='display:none'><td colspan=" + cols.length + ">" + det + "</td></tr>";
  }).join("");
  return "<table>" + header(cols) + body + "</table>";
}

function coverageView() {
  const q = DATA.quarterDistribution, max = Math.max(1, q[0], q[1], q[2], q[3]);
  const bars = q.map((n, i) => "<tr><td>Q" + (i + 1) + "</td><td>" + n +
    "</td><td><div class=bar style='width:" + Math.round((n / max) * 220) + "px'></div></td></tr>").join("");
  const counts = {};
  DATA.assertions.forEach((a) => { counts[a.argumentBranchId] = (counts[a.argumentBranchId] || 0) + 1; });
  const branches = arr(DATA.argumentBranches).map((b) =>
    "<tr><td>" + esc(b.branchId) + "</td><td>" + esc(b.branchQuestion) + "</td><td>" + (counts[b.branchId] || 0) + "</td></tr>").join("")
    || "<tr><td colspan=3 class=muted>none</td></tr>";
  const findings = arr(DATA.findings).length
    ? "<ul>" + DATA.findings.map((f) => { const rest = Object.assign({}, f); delete rest.code;
        return "<li><span class='tag host'>H</span> <code>" + esc(f.code) + "</code> " + esc(JSON.stringify(rest)) + "</li>"; }).join("") + "</ul>"
    : "<p class=muted>None.</p>";
  return "<h3>Quarter distribution (selected portfolio)</h3><table><tr><th>Quarter</th><th>Count</th><th></th></tr>" + bars + "</table>" +
    "<h3>Argument branches</h3><table><tr><th>Branch</th><th>Question</th><th>Selected</th></tr>" + branches + "</table>" +
    "<h3>Findings (non-blocking)</h3>" + findings +
    "<h3>Chunking</h3><p class=muted>" + DATA.chunking.chunkCount + " chunks, ~" +
    Math.round(DATA.chunking.overlap * 100) + "% overlap · " + DATA.article.sourceUnitCount + " source units</p>";
}

function inventoryView() {
  let rows = DATA.inventory.filter((a) => matchQ(a.assertionId + " " + a.assertionText));
  if (S.inv === "selected") rows = rows.filter((a) => selectedIds.has(a.assertionId));
  else if (S.inv === "unselected") rows = rows.filter((a) => !selectedIds.has(a.assertionId));
  else if (S.inv === "challenged") rows = rows.filter((a) => a.challenged);
  const keyOf = (a, k) => k === "selected" ? (selectedIds.has(a.assertionId) ? 1 : 0) : (a[k] == null ? "" : a[k]);
  rows = sortRows(rows, keyOf);
  const cols = [["assertionId", "ID"], ["assertionText", "Assertion"], ["challenged", "Challenged"], ["selected", "Selected"], ["groundingUnitIds", "Grounding"]];
  const body = rows.map((a) => {
    const sel = selectedIds.has(a.assertionId);
    return "<tr class='" + (sel ? "sel" : "") + "'>" +
      "<td>" + esc(a.assertionId) + "</td>" +
      "<td>" + esc(a.assertionText) + (a.challenged ? " <span class='tag chal'>challenged</span>" : "") + "</td>" +
      "<td>" + yn(a.challenged) + "</td>" +
      "<td>" + yn(sel) + "</td>" +
      "<td>" + esc(arr(a.groundingUnitIds).join(", ")) + "</td></tr>";
  }).join("");
  const sel = DATA.inventory.filter((a) => selectedIds.has(a.assertionId)).length;
  const ch = DATA.inventory.filter((a) => a.challenged).length;
  const heading = "<h3>Candidates — full discovery inventory</h3>"
    + "<p class=muted>" + DATA.inventory.length + " candidates from discovery · "
    + sel + " selected into the portfolio · " + ch + " flagged challenged. "
    + "Rows shaded blue are selected.</p>";
  return heading + "<table>" + header(cols) + body + "</table>";
}

function render() {
  const view = tab === "portfolio" ? portfolioView() : tab === "coverage" ? coverageView() : inventoryView();
  document.getElementById("view").innerHTML = view;
  const n = tab === "portfolio" ? DATA.assertions.length : tab === "candidates" ? DATA.inventory.length : arr(DATA.argumentBranches).length;
  document.getElementById("count").textContent = tab === "coverage" ? (arr(DATA.argumentBranches).length + " branches")
    : (n + (tab === "portfolio" ? " selected of " + DATA.inventory.length + " candidates" : " candidates"));
}

document.getElementById("search").addEventListener("input", (e) => { S.q = e.target.value; render(); });
document.getElementById("f-effect").addEventListener("change", (e) => { S.effect = e.target.value; render(); });
document.getElementById("f-treatment").addEventListener("change", (e) => { S.treatment = e.target.value; render(); });
document.getElementById("f-inv").addEventListener("change", (e) => { S.inv = e.target.value; render(); });
document.querySelectorAll("nav button").forEach((b) => b.addEventListener("click", () => setTab(b.dataset.tab)));
syncFilters(); render();
`;

export function renderCf3Html(result) {
  const projected = {
    architecture: result.architecture,
    generatedAt: result.generatedAt,
    elapsedMs: result.elapsedMs,
    portfolioSize: result.portfolioSize,
    article: result.article,
    chunking: result.chunking,
    stanceAnchor: result.stanceAnchor,
    quarterDistribution: result.quarterDistribution,
    assertions: result.assertions,
    inventory: result.inventory,
    argumentBranches: result.argumentBranches,
    findings: result.findings,
  };
  const data = JSON.stringify(projected).replace(/</g, "\\u003c");

  const provRow = (label, call) => `<tr><td>${escapeHtml(label)}</td>
    <td>${escapeHtml(call.requestedModel)} → ${escapeHtml(call.returnedModel)}</td>
    <td>${escapeHtml(call.usage?.totalTokens ?? call.usage?.total_tokens ?? "?")}</td>
    <td><code>${escapeHtml((call.promptSha256 ?? "").slice(0, 12))}</code></td>
    <td><code>${escapeHtml((call.schemaSha256 ?? "").slice(0, 12))}</code></td></tr>`;
  const provenance = `<details id="prov"><summary>Model calls &amp; provenance (${result.calls.discovery.length} discovery + 1 argument)</summary>
    <table><tr><th>Call</th><th>Model</th><th>Tokens</th><th>Prompt sha</th><th>Schema sha</th></tr>
    ${result.calls.discovery.map((call) => provRow(`Discovery chunk ${call.chunkIndex}`, call)).join("\n")}
    ${provRow("Argument", result.calls.argument)}</table>
    <p class="muted">Full prompts, schemas, and raw outputs are in result.json.</p></details>`;

  return `<!doctype html><html><head><meta charset="utf-8">
<title>CF3 · Chunked discovery + argument — ${escapeHtml(result.article.title)}</title>
<style>
body{font-family:-apple-system,system-ui,sans-serif;margin:1rem 2rem;line-height:1.4;color:#17202a}
.legend{background:#f7f7e8;border:1px solid #ddc;padding:0.6rem 1rem;font-size:0.9rem}
nav{margin:0.7rem 0}nav button{margin-right:0.5rem;padding:0.3rem 0.8rem;cursor:pointer;border:1px solid #99a;background:#f4f6f7;border-radius:4px}
nav button.active{background:#446;color:#fff}
#filters{margin:0.4rem 0}#filters input,#filters select{margin-right:0.6rem;padding:0.2rem}
table{border-collapse:collapse;width:100%;margin-top:0.6rem}
th,td{border:1px solid #ccc;padding:0.3rem 0.45rem;font-size:0.85rem;text-align:left;vertical-align:top}
th{background:#eee;cursor:pointer;position:sticky;top:0}
tr.claim:hover{background:#f5f8ff;cursor:pointer}
tr.strengthens td{background:#eef8ef}tr.weakens td{background:#fff1e8}tr.neutral td{background:#f8f8f8}
tr.sel td{background:#eef5ff}
.detail{background:#fafaff;border-left:4px solid #446;padding:0.5rem 1rem}
.tag{font-weight:700;font-size:0.7rem;padding:0 0.35rem;border-radius:3px;margin-right:0.3rem}
.disc{background:#dbeafe}.arg{background:#dcfce7}.host{background:#fde8c8}.chal{background:#fde2e2;color:#991b1b}
.bar{background:#446;height:0.8rem;border-radius:2px}
.muted{color:#777}code{background:#eef1f3;padding:1px 4px;border-radius:3px}
h3{margin:0.9rem 0 0.2rem}
</style></head><body>
<div class="legend"><strong>CF3 · Chunked discovery + argument.</strong>
${escapeHtml(result.article.title)} — ${escapeHtml((result.article.authors ?? []).join(", ") || "no byline")},
${escapeHtml(result.article.publisher ?? "n/a")}.<br>
<strong>Stance anchor:</strong> ${escapeHtml(result.stanceAnchor)}<br>
${result.inventory.length} inventory → ${result.assertions.length} selected ·
${result.chunking.chunkCount} discovery chunks · quarters ${escapeHtml(result.quarterDistribution.join("/"))} ·
${result.findings.length} findings · ${(result.elapsedMs / 1000).toFixed(1)}s.<br>
Field provenance: <span class="tag disc">D</span>discovery model
<span class="tag arg">A</span>argument model <span class="tag host">H</span>host-derived.</div>
<nav>
<button data-tab="portfolio" class="active">Selected portfolio</button>
<button data-tab="coverage">Coverage &amp; branches</button>
<button data-tab="candidates">Candidates (full discovery inventory)</button>
</nav>
<div id="filters">
<input id="search" placeholder="search text…" size="28">
<select id="f-effect"><option value="">all effects</option><option>strengthens</option><option>weakens</option><option>no_effect</option></select>
<select id="f-treatment"><option value="">all treatments</option><option>adopted</option><option>challenged</option><option>reported</option></select>
<select id="f-inv"><option value="">all candidates</option><option value="selected">selected only</option><option value="unselected">not selected</option><option value="challenged">challenged only</option></select>
<span id="count" class="muted"></span></div>
<div id="view"></div>
${provenance}
<script>
const DATA = ${data};
${CLIENT_SCRIPT}
</script>
</body></html>`;
}

export function writeCf3Artifacts(result, outDir) {
  mkdirSync(outDir, { recursive: true });
  writeFileSync(path.join(outDir, "result.json"), `${JSON.stringify(result, null, 2)}\n`);
  const columns = [
    "assertionId", "testableAssertion", "inventoryAssertionText", "sourceName", "sourceKind",
    "articleTreatment", "thesisEffect", "scoreTransform", "argumentBranchId", "challenged",
    "groundingUnitIds", "citedWorks",
  ];
  const csv = [
    columns.join(","),
    ...result.assertions.map((assertion) => columns.map((column) => {
      if (column === "sourceName") return csvCell(assertion.assertionSource.name);
      if (column === "sourceKind") return csvCell(assertion.assertionSource.kind);
      if (column === "citedWorks") {
        return csvCell((assertion.citedWorks ?? []).map((work) => `${work.name} (${work.type})`));
      }
      return csvCell(assertion[column]);
    }).join(",")),
  ].join("\n");
  writeFileSync(path.join(outDir, "claims.csv"), `${csv}\n`);
  writeFileSync(path.join(outDir, "report.html"), renderCf3Html(result));
}
