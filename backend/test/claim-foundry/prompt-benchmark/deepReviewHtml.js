// Self-contained interactive review.html (render-spec v2 deliverables 2+3):
// sortable/filterable claims table, per-claim [C1]/[C2]/[HOST] detail pane with
// grounding excerpt, and a source-region alignment view (claims clustered by
// shared sourceUnitIds, profile columns, per repeat). Blinded: labels only.
export function renderDeepReviewHtml({ phase, mode, rows, orientations }) {
  const profiles = [...new Set(rows.map((row) => row.profile))].sort();
  const payload = JSON.stringify({ phase, mode, profiles, rows, orientations })
    .replace(/<\/script/gi, "<\\/script");
  return `<!doctype html><html><head><meta charset="utf-8">
<title>CF1 blinded deep review — ${phase}</title>
<style>
body{font-family:-apple-system,system-ui,sans-serif;margin:1rem 2rem;line-height:1.4}
.legend{background:#f7f7e8;border:1px solid #ddc;padding:0.6rem 1rem;font-size:0.9rem}
nav button{margin-right:0.5rem;padding:0.3rem 0.8rem;cursor:pointer}
nav button.active{background:#446;color:#fff}
#filters input,#filters select{margin-right:0.6rem;padding:0.2rem}
table{border-collapse:collapse;width:100%;margin-top:0.6rem}
th,td{border:1px solid #ccc;padding:0.3rem 0.45rem;font-size:0.85rem;text-align:left;vertical-align:top}
th{background:#eee;cursor:pointer;position:sticky;top:0}
tr.claim:hover{background:#f5f8ff;cursor:pointer}
tr.failed{background:#fff2f2}
.detail{background:#fafaff;border-left:4px solid #446;padding:0.5rem 1rem}
.tag{font-weight:700;font-size:0.75rem;padding:0 0.3rem;border-radius:3px;margin-right:0.3rem}
.c1{background:#dbeafe}.c2{background:#dcfce7}.host{background:#fde8c8}
.detail ul{margin:0.15rem 0 0.4rem 1.3rem}
details{margin:0.3rem 0}blockquote{background:#f6f6f6;border-left:3px solid #999;
margin:0.3rem 0;padding:0.4rem 0.7rem;white-space:pre-wrap;font-size:0.85rem}
.cluster td{width:${Math.floor(100 / Math.max(profiles.length, 1))}%}
.muted{color:#777}.ov{background:#fce7f3}.bad{background:#fee2e2;color:#991b1b;font-weight:700}
</style></head><body>
<div class="legend"><strong>Blinded review — phase ${phase} (${mode} mode).</strong>
A <em>Profile</em> is ${mode === "call1" ? "one Call 1 prompt arm" : "one complete prompt arm — a Call 1 prompt + Call 2 prompt pair"} — under a
seeded opaque label. Producer identities are withheld until scores are locked. Profiles present:
${profiles.join(", ")}. Field provenance: <span class="tag c1">C1</span>Call 1 (model)
${mode === "call1" ? "Call 1 review is pre-host and pre-Call-2."
    : "<span class=\"tag c2\">C2</span>Call 2 (model) <span class=\"tag host\">HOST</span>deterministic host."}
Failed runs are results: they carry a failure class and stage.</div>
<nav><button id="btn-claims" class="active">Claims</button>
<button id="btn-align">Alignment by source region</button>
<button id="btn-orient">Orientations</button></nav>
<div id="filters">
<input id="search" placeholder="search text…" size="28">
<select id="f-profile"><option value="">all profiles</option></select>
<select id="f-repeat"><option value="">all repeats</option></select>
<select id="f-status"><option value="">all statuses</option>
<option>completed</option><option>failed</option></select>
<span id="count" class="muted"></span></div>
<div id="view"></div>
<script>
const DATA = ${payload};
const esc = (v) => String(v ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;");
const list = (v) => (v ?? []).length ? "<ul>" + v.map((x)=>"<li>"+esc(x)+"</li>").join("") + "</ul>" : " <span class=muted>(none)</span>";
let sortKey = null, sortDir = 1, tab = "claims";
const S = { q:"", profile:"", repeat:"", status:"" };
function filtered(){
  return DATA.rows.filter((r)=>
    (!S.profile || r.profile===S.profile) && (!S.repeat || String(r.repeat)===S.repeat)
    && (!S.status || r.runStatus===S.status)
    && (!S.q || JSON.stringify(r).toLowerCase().includes(S.q.toLowerCase())));
}
function detail(r){
  if (DATA.mode === "call1") {
    const consistency = r.transformConsistent === false
      ? '<b class="bad">CONTRADICTION — effects imply '+esc(r.expectedTransform)+'</b>'
      : r.transformConsistent === true ? "consistent" : "not emitted by this arm";
    return '<div class="detail">'
    + '<details><summary>Source text (units '+esc((r.sourceUnitIds||[]).join(", "))+')</summary>'
    + '<blockquote>'+esc(r.groundingText)+'</blockquote></details>'
    + '<p><span class="tag c1">C1</span>'+esc(r.articleRole)+' | '+esc(r.articleUse)
    + ' | source: '+esc(r.assertionSource)+' | materiality: '+esc(r.materiality)
    + ' | scope: '+esc(r.scope)+' | pillars: '+esc((r.relatedPillarLabels||[]).join(", "))
    + '<br>evidenceUsefulnessHint: '+esc(r.evidenceUsefulnessHint)+'</p>'
    + '<p><span class="tag c1">ORDER TRACE</span>propositionCore: '+esc(r.propositionCore ?? "not emitted by this arm")
    + '<br>if supported: <b>'+esc(r.ifSupportedEffect ?? "not emitted")+'</b>'
    + ' | if refuted: <b>'+esc(r.ifRefutedEffect ?? "not emitted")+'</b>'
    + ' | transform check: <b>'+esc(r.scoreTransformCheck ?? "not emitted")+'</b>'
    + '<br>effect/transform consistency: '+consistency
    + '<br>typed assertion source: '+esc(r.assertionSourceKind ?? "not emitted")
    + ' / '+esc(r.assertionSourceName ?? "not emitted")+'</p>'
    + (r.sourceProposition ? '<p><span class="tag c1">RELATION TRACE</span>source proposition P: '
      + esc(r.sourceProposition)+'<br>article response: <b>'+esc(r.articleResponse)+'</b>'
      + '<details><summary>Article-response text (units '+esc((r.articleResponseUnitIds||[]).join(", "))
      + ')</summary><blockquote>'+esc(r.articleResponseGroundingText)+'</blockquote></details></p>' : '')
    + '</div>';
  }
  const strat = r.hostStrategyOverride
    ? esc(r.sourceStrategy_emitted)+" → "+esc(r.sourceStrategy_resolved)+" <b class=ov>(host override)</b>"
    : esc(r.sourceStrategy_emitted ?? r.sourceStrategy_resolved);
  const traceConsistency = r.transformConsistent === false
    ? '<b class="bad">CONTRADICTION — effects imply '+esc(r.expectedTransform)+'</b>'
    : r.transformConsistent === true ? "consistent" : "not emitted by this arm";
  const trace = r.propositionCore ? '<p><span class="tag c1">C1 TRACE</span>'
    + 'propositionCore: '+esc(r.propositionCore)
    + '<br>if supported: <b>'+esc(r.ifSupportedEffect)+'</b>'
    + ' | if refuted: <b>'+esc(r.ifRefutedEffect)+'</b>'
    + ' | model transform check: <b>'+esc(r.scoreTransformCheck)+'</b>'
    + '<br>expected from effects: <b>'+esc(r.expectedTransform)+'</b>'
    + ' | consistency: '+traceConsistency+'</p>' : '';
  return '<div class="detail">'
  + '<details><summary>Source text (units '+esc((r.sourceUnitIds||[]).join(", "))+')</summary>'
  + '<blockquote>'+esc(r.groundingText)+'</blockquote></details>'
  + '<p><span class="tag c1">C1</span>'+esc(r.articleRole)+' | '+esc(r.articleUse)+' | source: '
  + esc(r.assertionSource)+' | materiality: '+esc(r.materiality)+' | scope: '+esc(r.scope)
  + ' | pillars: '+esc((r.relatedPillarLabels||[]).join(", "))
  + '<br>evidenceUsefulnessHint: '+esc(r.evidenceUsefulnessHint)+'</p>'+trace
  + '<p><span class="tag c2">C2</span>revisedClaimText: '+esc(r.revisedClaimText)
  + '<br>verificationTarget: <b>'+esc(r.verificationTarget)+'</b>'
  + '<br>disputedProposition: '+esc(r.disputedProposition)
  + '<br>stipulatedByArticle: '+esc(r.stipulatedByArticle)
  + '<br>whyThisTarget: '+esc(r.whyThisTarget)
  + '<br>warrant: <b>'+esc(r.warrant ?? "not separately emitted — encoded in bearing criteria")+'</b></p>'
  + '<p><span class="tag c2">C2</span>support:'+list(r.supportCriteria)
  + 'refute:'+list(r.refuteCriteria)+'qualify:'+list(r.qualifyCriteria)
  + 'mustMatch:'+list(r.mustMatch)+'rejectIfOnly (model):'+list(r.rejectIfOnly_model)+'</p>'
  + '<p><span class="tag host">HOST</span>rejectIfOnly (host-appended):'+list(r.rejectIfOnly_host)
  + 'sourceStrategy: '+strat
  + '<br><span class="tag c2">C2</span>searchConcepts:'+list(r.searchConcepts)
  + 'relevantNamedWorkIds: '+esc((r.relevantNamedWorkIds||[]).join(", ")||"(none)")
  + ' | cautions:'+list(r.cautions)+'</p>'
  + '<p><span class="tag host">HOST</span>origin: '+esc(r.origin)
  + ' | gradeTarget: '+esc(r.gradeTarget)+' | scoreTransform: '+esc(r.scoreTransform)
  + ' | packageValid: '+esc(r.packageValid)
  + '<br>verificationQuestion: '+esc(r.verificationQuestion)
  + '<br>host warnings:'+list(r.hostWarnings)+'</p></div>';
}
function claimsView(rows){
  const cols = DATA.mode === "call1" ? [["profile","Profile"],["repeat","Rep"],
    ["runStatus","Status"],["propositionCore","Proposition P"],["claimText","Final claim"],
    ["articleRole","Role"],
    ["articleUse","Use"],["assertionSource","Source"],["ifSupportedEffect","If supported"],
    ["ifRefutedEffect","If refuted"],["scoreTransformCheck","Transform"],["materiality","Mat."]]
    : [["profile","Profile"],["repeat","Rep"],["origin","Origin"],
    ["runStatus","Status"],["failureClass","Failure"],["propositionCore","Proposition P"],
    ["claimText","Final claim"],["articleRole","Role"],["articleUse","Use"],
    ["assertionSource","Source"],["ifSupportedEffect","If supported"],
    ["ifRefutedEffect","If refuted"],["scoreTransformCheck","Transform (C1)"],
    ["scoreTransform","Transform (HOST)"],["verificationTarget","Target"],
    ["sourceStrategy_emitted","Strategy (C2)"],["sourceStrategy_resolved","Strategy (HOST)"],
    ["materiality","Mat."]];
  if (sortKey) rows = [...rows].sort((a,b)=>String(a[sortKey]??"").localeCompare(String(b[sortKey]??""))*sortDir);
  let h = "<table><thead><tr>"+cols.map(([k,l])=>'<th data-k="'+k+'">'+l+"</th>").join("")+"</tr></thead><tbody>";
  rows.forEach((r,i)=>{
    h += '<tr class="claim'+(r.runStatus==="failed"?" failed":"")+'" data-i="'+i+'">'
      + cols.map(([k])=>"<td>"+esc(Array.isArray(r[k])?r[k].join(", "):r[k])+"</td>").join("")+"</tr>"
      + '<tr class="d" id="d'+i+'" style="display:none"><td colspan="'+cols.length+'">'+detail(r)+"</td></tr>";
  });
  return h+"</tbody></table>";
}
function alignView(rows){
  const repeats = [...new Set(rows.map((r)=>r.repeat))].sort((a,b)=>a-b);
  let h = "";
  for (const rep of repeats){
    const rs = rows.filter((r)=>r.repeat===rep && (r.sourceUnitIds||[]).length);
    const parent = rs.map((_,i)=>i);
    const find = (i)=>parent[i]===i?i:(parent[i]=find(parent[i]));
    const unitOwner = new Map();
    rs.forEach((r,i)=>{ for(const u of r.sourceUnitIds){
      if(unitOwner.has(u)) parent[find(i)]=find(unitOwner.get(u)); else unitOwner.set(u,i); }});
    const clusters = new Map();
    rs.forEach((r,i)=>{ const root=find(i);
      if(!clusters.has(root)) clusters.set(root,{units:new Set(),byProfile:{}});
      const c=clusters.get(root); r.sourceUnitIds.forEach((u)=>c.units.add(u));
      (c.byProfile[r.profile] ??= []).push(r); });
    const ordered=[...clusters.values()].sort((a,b)=>[...a.units].sort()[0]<[...b.units].sort()[0]?-1:1);
    h += "<h2>Repeat "+rep+"</h2><table class=cluster><thead><tr><th>Source units</th>"
      + DATA.profiles.map((p)=>"<th>"+p+"</th>").join("")+"</tr></thead><tbody>";
    for (const c of ordered){
      h += "<tr><td>"+[...c.units].sort().join("<br>")+"</td>"
        + DATA.profiles.map((p)=>"<td>"+(c.byProfile[p]??[]).map((r)=>
          "• "+esc(r.claimText)+(r.origin==="host_pillar_backfill"?" <em class=muted>(backfill)</em>":"")).join("<br>")
          +"</td>").join("")+"</tr>";
    }
    const failedHere = DATA.rows.filter((r)=>r.repeat===rep && r.runStatus==="failed");
    const failedProfiles=[...new Set(failedHere.map((r)=>r.profile+" ("+r.failureClass+")"))];
    if(failedProfiles.length) h+="<tr><td class=muted>failed runs</td><td colspan="+DATA.profiles.length
      +" class=muted>"+failedProfiles.join("; ")+"</td></tr>";
    h += "</tbody></table>";
  }
  return h || "<p class=muted>No grounded claims to align.</p>";
}
function orientView(){
  let h = "<table><thead><tr><th>Repeat</th><th>Profile</th><th>Status</th><th>C1 candidates</th>"
    + "<th>Theme [C1]</th><th>Thesis [C1]</th><th>Hinge [C1]</th><th>Pillars [C1]</th>"
    + (DATA.mode === "call1" ? "<th>Opponent census [C1 diagnostic]</th>" : "")
    + "</tr></thead><tbody>";
  for (const o of DATA.orientations.sort((a,b)=>a.repeat-b.repeat||a.profile.localeCompare(b.profile))){
    h += "<tr"+(o.runStatus==="failed"?' class=failed':'')+"><td>"+o.repeat+"</td><td>"+o.profile+"</td><td>"
      + esc(o.runStatus)+(o.failure?" — "+esc(o.failure.failureClass)+":"+esc(o.failure.failureStage):"")
      + "</td><td>"+esc(o.call1CandidateCount)+"</td><td>"+esc(o.theme)+"</td><td>"+esc(o.thesis)
      + "</td><td>"+esc(o.thesisHinge)+"</td><td>"+esc((o.pillars||[]).map((p)=>p.label+" ("+p.importance+")").join("; "))+"</td>"
      + (DATA.mode === "call1" ? "<td>"+esc((o.opponentScan||[]).map((p)=>
        p.propositionCore+" ["+p.articleUse+"; "+(p.assertionSourceName||p.assertionSource||"")+ "]").join("; "))+"</td>" : "")
      + "</tr>";
  }
  return h+"</tbody></table>";
}
function render(){
  const rows = filtered();
  document.getElementById("count").textContent = rows.length+" rows";
  const view = document.getElementById("view");
  view.innerHTML = tab==="claims" ? claimsView(rows) : tab==="align" ? alignView(rows) : orientView();
  if (tab==="claims"){
    view.querySelectorAll("tr.claim").forEach((tr)=>tr.addEventListener("click",()=>{
      const d=document.getElementById("d"+tr.dataset.i);
      d.style.display=d.style.display==="none"?"":"none";}));
    view.querySelectorAll("th[data-k]").forEach((th)=>th.addEventListener("click",()=>{
      sortDir = sortKey===th.dataset.k ? -sortDir : 1; sortKey=th.dataset.k; render();}));
  }
}
for (const p of DATA.profiles) document.getElementById("f-profile").add(new Option(p,p));
for (const r of [...new Set(DATA.rows.map((x)=>x.repeat))].sort((a,b)=>a-b))
  document.getElementById("f-repeat").add(new Option("repeat "+r,String(r)));
document.getElementById("search").addEventListener("input",(e)=>{S.q=e.target.value;render();});
document.getElementById("f-profile").addEventListener("change",(e)=>{S.profile=e.target.value;render();});
document.getElementById("f-repeat").addEventListener("change",(e)=>{S.repeat=e.target.value;render();});
document.getElementById("f-status").addEventListener("change",(e)=>{S.status=e.target.value;render();});
document.getElementById("btn-claims").addEventListener("click",(e)=>{tab="claims";setTab(e.target);});
document.getElementById("btn-align").addEventListener("click",(e)=>{tab="align";setTab(e.target);});
document.getElementById("btn-orient").addEventListener("click",(e)=>{tab="orient";setTab(e.target);});
function setTab(btn){document.querySelectorAll("nav button").forEach((b)=>b.classList.remove("active"));
btn.classList.add("active");render();}
render();
</script></body></html>
`;
}
