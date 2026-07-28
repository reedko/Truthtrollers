// CF5 reusable interactive report builder. Standard format for every CF5 human-
// readable report going forward — see
// ml/cf1-argument-model/data/annotation-prompts/stupidity/
// CF5_REPORTING_STANDARD_2026-07-27.md. Modeled directly on
// artifacts/claim-foundry/prompt-sets/cf1pb-20260717-01/blind/full-f03-screen/review.html:
// one self-contained HTML file, all rows embedded as a single JSON blob, client-side
// search/filter/sort, click-to-expand detail rows, field-provenance tags, tabs. No
// build step, no server — opens directly in a browser.
//
// Callers supply data (JSON-safe) plus small rendering functions (detailRenderer,
// optional rowClassifier, optional extraTabs[].renderer). Those functions are
// serialized via Function.prototype.toString() into the page's own <script> block, so
// the exact same JS that runs here in Node also runs in the browser — no templating
// language, no duplicated logic between "how we computed it" and "how we show it".

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

const BASE_CSS = `
body{font-family:-apple-system,system-ui,sans-serif;margin:1rem 2rem;line-height:1.4;color:#1a1a1a}
.legend{background:#f7f7e8;border:1px solid #ddc;padding:0.6rem 1rem;font-size:0.9rem;margin-bottom:0.6rem}
nav button{margin-right:0.5rem;padding:0.3rem 0.8rem;cursor:pointer}
nav button.active{background:#446;color:#fff}
#filters input,#filters select{margin-right:0.6rem;padding:0.2rem}
table{border-collapse:collapse;width:100%;margin-top:0.6rem}
th,td{border:1px solid #ccc;padding:0.3rem 0.45rem;font-size:0.85rem;text-align:left;vertical-align:top}
th{background:#eee;cursor:pointer;position:sticky;top:0}
tr.row-item:hover{background:#f5f8ff;cursor:pointer}
tr.failed{background:#fff2f2}
.detail{background:#fafaff;border-left:4px solid #446;padding:0.5rem 1rem}
.tag{font-weight:700;font-size:0.75rem;padding:0 0.3rem;border-radius:3px;margin-right:0.3rem;color:#111}
.tag-model{background:#dbeafe}.tag-host{background:#fde8c8}.tag-repair{background:#fee2e2}
.detail ul{margin:0.15rem 0 0.4rem 1.3rem}
details{margin:0.3rem 0}
blockquote{background:#f6f6f6;border-left:3px solid #999;margin:0.3rem 0;padding:0.4rem 0.7rem;
  white-space:pre-wrap;font-size:0.85rem}
.muted{color:#777}
.badge{display:inline-block;padding:.1rem .4rem;border-radius:3px;font-size:.8em;font-weight:600;color:#fff}
.badge-adopted{background:#2a7f2a}.badge-challenged{background:#b03030}.badge-reported{background:#6060b0}
.badge-ok{background:#2a7f2a}.badge-fail{background:#b03030}.badge-ambiguous{background:#b08000}
.badge-absent{background:#888}
.footer-section{background:#eef7ee;border:2px solid #2a7f2a;padding:1rem 1.2rem;margin-top:1.5rem;border-radius:6px}
.indicator{display:inline-block;padding:.1rem .4rem;border-radius:3px;font-size:.75em;font-weight:700;margin-right:.2rem}
.ind-recovered{background:#2a7f2a;color:#fff}.ind-duplicate{background:#b03030;color:#fff}
.ind-compound{background:#b08000;color:#fff}
`;

export function buildReviewHtml({
  title,
  legendHtml,
  rows,
  columns,
  filterKeys = [],
  detailRenderer,
  rowClassifier = null,
  extraTabs = [],
  extraCss = "",
  footerHtml = "",
  extraData = {},
}) {
  if (typeof detailRenderer !== "function") {
    throw new Error("buildReviewHtml requires a detailRenderer(row) function");
  }
  const tabIds = ["main", ...extraTabs.map((t) => t.id)];
  const tabButtons = [`<button id="tab-main" class="active" data-tab="main">${esc(title ? "Rows" : "Rows")}</button>`,
    ...extraTabs.map((t) => `<button id="tab-${esc(t.id)}" data-tab="${esc(t.id)}">${esc(t.label)}</button>`)].join("\n");

  const config = {
    columns,
    filterKeys,
  };

  const extraTabRenderersJs = extraTabs
    .map((t) => `  ${JSON.stringify(t.id)}: (${t.renderer.toString()}),`)
    .join("\n");

  const script = `
const DATA = ${JSON.stringify({ rows, config, extra: extraData }, null, 0)};
const esc = ${esc.toString()};
const list = (v) => (v ?? []).length ? "<ul>" + v.map((x)=>"<li>"+esc(x)+"</li>").join("") + "</ul>" : ' <span class="muted">(none)</span>';
const detailRenderer = (${detailRenderer.toString()});
const rowClassifier = ${rowClassifier ? `(${rowClassifier.toString()})` : "() => \"\""};
const extraTabRenderers = {
${extraTabRenderersJs}
};
let sortKey = null, sortDir = 1, tab = "main";
const S = { q: "" };
for (const key of DATA.config.filterKeys) S[key] = "";

function filtered() {
  return DATA.rows.filter((r) =>
    DATA.config.filterKeys.every((key) => !S[key] || String(r[key]) === S[key])
    && (!S.q || JSON.stringify(r).toLowerCase().includes(S.q.toLowerCase())));
}

function mainView(rows) {
  const cols = DATA.config.columns;
  if (sortKey) rows = [...rows].sort((a, b) =>
    String(a[sortKey] ?? "").localeCompare(String(b[sortKey] ?? "")) * sortDir);
  let h = "<table><thead><tr>" + cols.map(([k, l]) => '<th data-k="' + k + '">' + esc(l) + "</th>").join("") + "</tr></thead><tbody>";
  rows.forEach((r, i) => {
    const extraClass = rowClassifier(r);
    h += '<tr class="row-item' + (extraClass ? " " + extraClass : "") + '" data-i="' + i + '">'
      + cols.map(([k]) => "<td>" + esc(Array.isArray(r[k]) ? r[k].join(", ") : r[k]) + "</td>").join("") + "</tr>"
      + '<tr class="d" id="d' + i + '" style="display:none"><td colspan="' + cols.length + '">' + detailRenderer(r) + "</td></tr>";
  });
  return h + "</tbody></table>";
}

function render() {
  const rows = filtered();
  document.getElementById("count").textContent = rows.length + " rows";
  const view = document.getElementById("view");
  if (tab === "main") {
    view.innerHTML = mainView(rows);
    view.querySelectorAll("tr.row-item").forEach((tr) => tr.addEventListener("click", () => {
      const d = document.getElementById("d" + tr.dataset.i);
      d.style.display = d.style.display === "none" ? "" : "none";
    }));
    view.querySelectorAll("th[data-k]").forEach((th) => th.addEventListener("click", () => {
      sortDir = sortKey === th.dataset.k ? -sortDir : 1; sortKey = th.dataset.k; render();
    }));
  } else {
    view.innerHTML = extraTabRenderers[tab](rows, DATA);
  }
}

for (const key of DATA.config.filterKeys) {
  const sel = document.getElementById("f-" + key);
  if (!sel) continue;
  const values = [...new Set(DATA.rows.map((r) => String(r[key])))].sort();
  for (const v of values) sel.add(new Option(v, v));
  sel.addEventListener("change", (e) => { S[key] = e.target.value; render(); });
}
document.getElementById("search").addEventListener("input", (e) => { S.q = e.target.value; render(); });
document.querySelectorAll("nav button").forEach((btn) => btn.addEventListener("click", () => {
  document.querySelectorAll("nav button").forEach((b) => b.classList.remove("active"));
  btn.classList.add("active");
  tab = btn.dataset.tab;
  render();
}));
render();
`;

  const filterSelectsHtml = filterKeys
    .map((key) => `<select id="f-${esc(key)}"><option value="">all ${esc(key)}</option></select>`)
    .join("\n");

  return `<!doctype html><html><head><meta charset="utf-8">
<title>${esc(title)}</title>
<style>${BASE_CSS}${extraCss}</style></head><body>
<div class="legend">${legendHtml}</div>
<nav>${tabButtons}</nav>
<div id="filters">
<input id="search" placeholder="search text…" size="28">
${filterSelectsHtml}
<span id="count" class="muted"></span></div>
<div id="view"></div>
${footerHtml ? `<div class="footer-section">${footerHtml}</div>` : ""}
<script>${script}</script>
</body></html>`;
}
