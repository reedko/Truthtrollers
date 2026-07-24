// Frozen evaluation apparatus for CF2/CF3 candidate inventories.
// Normalizes either system's result.json into a common shape, then renders a review
// page with two formats (discourse-tuple review + article-position map), full candidate
// lineage (discovery -> selection/rejection), and six independently-scored dimensions:
//   tuple correctness · position-map quality · treatment · target-specific effect ·
//   relevance · selection.
// Scores persist in the browser (localStorage) keyed by system+fixture+candidateId and
// can be exported as JSON.

const esc = (v) => String(v == null ? "" : v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// ---- normalization -------------------------------------------------------------

function quarterOf(order, total) {
  if (!Number.isFinite(order) || total <= 0) return null;
  return Math.min(3, Math.floor((order / total) * 4));
}
function meanOrder(unitIds) {
  const ns = (unitIds ?? []).map((u) => Number(String(u).slice(1)) - 1).filter(Number.isFinite);
  return ns.length ? ns.reduce((a, b) => a + b, 0) / ns.length : NaN;
}

export function normalizeRun(result, { system, fixture } = {}) {
  const sys = system ?? (result.architecture?.startsWith("CF2") ? "CF2" : "CF3");
  const total = result.article?.sourceUnitCount ?? 0;

  let candidates; let tuplesById;
  if (sys === "CF2") {
    candidates = (result.candidates ?? []).map((c) => ({
      id: c.candidateId, text: c.rawAssertion, grounding: c.groundingUnitIds ?? [], challenged: false,
    }));
    tuplesById = new Map((result.assertions ?? []).map((a) => [a.candidateId, {
      substance: a.assertionText, sourceName: a.sourceName, sourceKind: a.sourceKind,
      treatment: a.articleTreatment, effect: a.effectIfTrue, grounding: a.groundingUnitIds ?? [],
      inventoryText: a.rawAssertion,
    }]));
  } else {
    candidates = (result.inventory ?? []).map((c) => ({
      id: c.assertionId, text: c.assertionText, grounding: c.groundingUnitIds ?? [], challenged: !!c.challenged,
    }));
    tuplesById = new Map((result.assertions ?? []).map((a) => [a.assertionId, {
      substance: a.testableAssertion, sourceName: a.assertionSource?.name, sourceKind: a.assertionSource?.kind,
      treatment: a.articleTreatment, effect: a.thesisEffect, grounding: a.groundingUnitIds ?? [],
      inventoryText: a.inventoryAssertionText,
    }]));
  }

  const rows = candidates.map((c) => {
    const order = meanOrder(c.grounding);
    const t = tuplesById.get(c.id) ?? null;
    return {
      ...c, order, quarter: quarterOf(order, total),
      selected: tuplesById.has(c.id), tuple: t,
    };
  }).sort((a, b) => (a.order || 0) - (b.order || 0));

  return {
    system: sys, fixture: fixture ?? result.article?.fixtureId ?? "unknown",
    title: result.article?.title ?? "", total,
    stance: result.stanceAnchor ?? result.thesisAssertion ?? "",
    candidates: rows,
    selectedCount: rows.filter((r) => r.selected).length,
  };
}

// ---- rendering -----------------------------------------------------------------

const SCORE_FIELDS = [
  ["tuple", "Tuple correctness", ["", "ok", "frame-residue", "source-wrong", "substance-wrong", "multi"]],
  ["treatment", "Treatment", ["", "ok", "wrong", "n/a"]],
  ["effect", "Target effect", ["", "ok", "wrong", "n/a"]],
  ["relevance", "Relevance", ["", "high", "medium", "low", "off-topic"]],
];

const CLIENT = `
const key = (id, dim) => DATA.system + "|" + DATA.fixture + "|" + id + "|" + dim;
function getScore(id, dim){ return localStorage.getItem(key(id,dim)) || ""; }
function setScore(id, dim, v){ if(v) localStorage.setItem(key(id,dim), v); else localStorage.removeItem(key(id,dim)); }
let tab = "tuples";
function setTab(t){ tab = t; document.querySelectorAll("nav button").forEach(b=>b.classList.toggle("active", b.dataset.tab===t)); render(); }
function onScore(e){ setScore(e.target.dataset.id, e.target.dataset.dim, e.target.value); }
function onRunScore(e){ localStorage.setItem(key("_run", e.target.dataset.dim), e.target.value); }
function runScore(dim){ return localStorage.getItem(key("_run", dim)) || ""; }
function sel(id, dim, opts){ return "<select data-id='"+id+"' data-dim='"+dim+"' onchange='onScore(event)'>"+
  opts.map(o=>"<option"+(getScore(id,dim)===o?" selected":"")+">"+o+"</option>").join("")+"</select>"; }

function tuplesView(){
  const rows = DATA.candidates.filter(c=>c.selected).map(c=>{
    const t=c.tuple||{};
    return "<tr><td>"+c.id+"</td>"+
      "<td><b>"+esc(t.substance)+"</b><details><summary>from inventory</summary><i>"+esc(c.text)+"</i></details></td>"+
      "<td>"+esc(t.sourceName||"—")+"<br><small>"+esc(t.sourceKind||"")+"</small></td>"+
      "<td>"+esc(t.treatment||"")+"</td><td>"+esc(t.effect||"")+"</td>"+
      "<td>Q"+((c.quarter??-1)+1)+"</td>"+
      SCORE_FIELDS.map(f=>"<td>"+sel(c.id,f[0],f[2])+"</td>").join("")+"</tr>";
  }).join("");
  return "<p class=muted>Score each selected tuple's decomposition. Substance/attribution/treatment/effect shown; open 'from inventory' to compare against the raw candidate.</p>"+
    "<table><tr><th>ID</th><th>Substance (testable)</th><th>Attribution</th><th>Treatment</th><th>Effect</th><th>Pos</th>"+
    SCORE_FIELDS.map(f=>"<th>"+f[1]+"</th>").join("")+"</tr>"+rows+"</table>";
}

function positionView(){
  const q=[[],[],[],[]];
  DATA.candidates.forEach(c=>{ if(c.quarter!=null) q[c.quarter].push(c); });
  const col = (i)=>{ const cs=q[i]; const sel=cs.filter(c=>c.selected).length;
    return "<td class=qcol><h4>Q"+(i+1)+" — "+cs.length+" cand · "+sel+" selected</h4>"+
      cs.map(c=>"<div class='pin "+(c.selected?"sel":"rej")+(c.challenged?" chal":"")+"'>"+
        (c.selected?"● ":"○ ")+c.id+" "+esc((c.selected&&c.tuple?c.tuple.substance:c.text)).slice(0,70)+"</div>").join("")+"</td>"; };
  const dist = q.map(x=>x.filter(c=>c.selected).length).join(" / ");
  const cand = q.map(x=>x.length).join(" / ");
  return "<p class=muted>Every candidate placed by article position; ● selected, ○ rejected, orange=challenged. "+
    "candidates/quarter "+cand+" · selected/quarter <b>"+dist+"</b>. Front-loading and empty quarters are visible here.</p>"+
    "<div class=runscore>Position-map quality: "+runSel("posmap",["","good","uneven","front-loaded","gap"])+
    " &nbsp; Selection quality: "+runSel("selection",["","good","misses-crux","unbalanced","redundant"])+"</div>"+
    "<table class=pos><tr>"+[0,1,2,3].map(col).join("")+"</tr></table>";
}
function runSel(dim,opts){ return "<select data-dim='"+dim+"' onchange='onRunScore(event)'>"+
  opts.map(o=>"<option"+(runScore(dim)===o?" selected":"")+">"+o+"</option>").join("")+"</select>"; }

function lineageView(){
  const rows=DATA.candidates.map(c=>"<tr class='"+(c.selected?"sel":"")+"'><td>"+c.id+"</td><td>Q"+((c.quarter??-1)+1)+"</td>"+
    "<td>"+(c.challenged?"challenged":"")+"</td><td><b>"+(c.selected?"SELECTED":"rejected")+"</b></td>"+
    "<td>"+esc(c.text).slice(0,110)+"</td></tr>").join("");
  return "<p class=muted>"+DATA.candidates.length+" candidates from discovery · "+DATA.selectedCount+
    " selected · "+(DATA.candidates.length-DATA.selectedCount)+" rejected. Full trace:</p>"+
    "<table><tr><th>ID</th><th>Pos</th><th>Flag</th><th>Fate</th><th>Candidate (discovery text)</th></tr>"+rows+"</table>";
}

function render(){
  document.getElementById("view").innerHTML = tab==="tuples"?tuplesView():tab==="position"?positionView():lineageView();
}
function exportScores(){
  const out={}; for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i);
    if(k.startsWith(DATA.system+"|"+DATA.fixture+"|")) out[k]=localStorage.getItem(k);}
  const blob=new Blob([JSON.stringify(out,null,2)],{type:"application/json"});
  const a=document.createElement("a"); a.href=URL.createObjectURL(blob);
  a.download=DATA.system+"-"+DATA.fixture+"-scores.json"; a.click();
}
document.querySelectorAll("nav button").forEach(b=>b.addEventListener("click",()=>setTab(b.dataset.tab)));
render();
`;

export function renderReview(run) {
  const data = JSON.stringify({
    system: run.system, fixture: run.fixture, title: run.title, total: run.total,
    selectedCount: run.selectedCount,
    candidates: run.candidates.map((c) => ({
      id: c.id, text: c.text, quarter: c.quarter, selected: c.selected, challenged: c.challenged,
      tuple: c.tuple ? { substance: c.tuple.substance, sourceName: c.tuple.sourceName,
        sourceKind: c.tuple.sourceKind, treatment: c.tuple.treatment, effect: c.tuple.effect } : null,
    })),
  }).replace(/</g, "\\u003c");
  return `<!doctype html><html><head><meta charset="utf-8">
<title>${esc(run.system)} · ${esc(run.fixture)} · review</title>
<style>
body{font:14px system-ui;margin:1rem 2rem;color:#17202a}
.legend{background:#f7f7e8;border:1px solid #ddc;padding:.6rem 1rem;font-size:.9rem}
nav{margin:.6rem 0}nav button{margin-right:.4rem;padding:.3rem .8rem;cursor:pointer;border:1px solid #99a;background:#f4f6f7;border-radius:4px}
nav button.active{background:#446;color:#fff}
table{border-collapse:collapse;width:100%;margin-top:.5rem}th,td{border:1px solid #ccd;padding:.3rem .45rem;font-size:.83rem;text-align:left;vertical-align:top}
th{background:#eef1f4;position:sticky;top:0}tr.sel td{background:#eef8ef}
.muted{color:#777}select{font-size:.8rem}
details summary{cursor:pointer;color:#556}
table.pos td.qcol{width:25%;vertical-align:top}
.pin{font-size:.78rem;padding:1px 3px;margin:1px 0;border-radius:3px;overflow-wrap:anywhere}
.pin.sel{background:#e3f4e6}.pin.rej{background:#f2f2f2;color:#777}.pin.chal{border-left:3px solid #e08a3c}
.runscore{background:#eef5ff;border:1px solid #9ebce0;padding:.5rem;margin:.4rem 0}
button#exp{float:right;padding:.3rem .7rem;cursor:pointer}
</style></head><body>
<button id="exp" onclick="exportScores()">Export scores JSON</button>
<div class="legend"><b>${esc(run.system)} · ${esc(run.fixture)}</b> — frozen review.<br>
${esc(run.title)}<br>Stance: ${esc(run.stance).slice(0, 200)}<br>
${run.candidates.length} candidates · ${run.selectedCount} selected. Scores auto-save (localStorage). Six dimensions:
tuple correctness · position-map quality · treatment · target effect · relevance · selection.</div>
<nav>
<button data-tab="tuples" class="active">Discourse tuples</button>
<button data-tab="position">Article-position map</button>
<button data-tab="lineage">Candidate lineage</button>
</nav>
<div id="view"></div>
<script>
const DATA = ${data};
const esc = (v) => String(v==null?"":v).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
const SCORE_FIELDS = ${JSON.stringify(SCORE_FIELDS)};
${CLIENT}
</script>
</body></html>`;
}
