#!/usr/bin/env node
// CF5 PromptCF5-v0007 blind regression — review.html builder. Reuses reportBuilder.js
// unmodified (no code changes to report generation, per this experiment's constraints).
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildReviewHtml } from "./reportBuilder.js";
import { loadGoldTargets } from "./targetMatching.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../..");
const outDir = path.resolve(root, "artifacts/claim-foundry/cf5-promptcf5-v007");

const results = JSON.parse(readFileSync(path.join(outDir, "results.json"), "utf8"));
const analysis = JSON.parse(readFileSync(path.join(outDir, "analysis.json"), "utf8"));
const runConfig = JSON.parse(readFileSync(path.join(outDir, "run_config.json"), "utf8"));
const gold = loadGoldTargets(root);

const unitTextByFixture = {};
for (const fixture of analysis.fixtures) {
  const units = JSON.parse(readFileSync(path.join(outDir, fixture.toLowerCase(), "source-units.json"), "utf8"));
  unitTextByFixture[fixture] = Object.fromEntries(units.map((u) => [u.unitId, u.text]));
}

function esc(v) {
  return String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

const rows = [];
for (const run of results) {
  const dupIds = new Set(run.nearDuplicates.flatMap((p) => [p.a, p.b]));
  const compoundIds = new Set(run.possiblyCompound.map((c) => c.claimId));
  for (const claim of run.finalClaims) {
    const matches = run.targetMatches.filter((t) => t.matchingClaimIds.includes(claim.claimId));
    const indicators = [];
    if (matches.length) indicators.push(`recovered: ${matches.map((m) => m.targetId).join(",")}`);
    if (dupIds.has(claim.claimId)) indicators.push("possible duplicate");
    if (compoundIds.has(claim.claimId)) indicators.push("possibly compound");
    rows.push({
      fixture: run.fixture, promptVersion: run.promptVersion, repeat: run.repeat,
      claimId: claim.claimId, claim: claim.claim, grounding: claim.grounding,
      articleTreatment: claim.articleTreatment, provenance: claim.provenance,
      indicatorSummary: indicators.join("; ") || "—",
      _recoveredTargets: matches.map((m) => m.targetId),
      _isDuplicate: dupIds.has(claim.claimId), _isCompound: compoundIds.has(claim.claimId),
      _gitCommit: run.manifest.gitCommit, _promptHash: run.manifest.promptHash,
      _schemaHash: run.manifest.schemaHash, _returnedModel: run.manifest.returnedModel,
      groundingText: claim.grounding.map((id) => ({ id, text: (unitTextByFixture[run.fixture][id] ?? "(not found)").slice(0, 500) })),
    });
  }
}

const gitCommit = results[0]?.manifest.gitCommit ?? "unknown";
const schemaHash = results[0]?.manifest.schemaHash ?? "unknown";

const legendHtml = `
<h1 style="margin-top:0">CF5 PromptCF5-v0007 Blind Regression</h1>
<h2>Executive Summary</h2>
<p><strong>Recommendation: do not promote PromptCF5-v0007 to production on this
evidence (n=1 per fixture), but it is the third consecutive candidate this cycle
(after v0005 and v0006) to show a real crux-recovery improvement over v0001.</strong>
v0007 combines v0005's single-predication split-on-different-verdicts language (now
with worked GOOD/BAD examples: "Smoking causes cancer." / "Smoking causes heart
disease." vs. the bad "Smoking causes cancer and heart disease.") with v0006's
"minimum number of representative single-predication assertions per theme" coverage
framing, under an explicit MISSION / TASK / OUTPUT section structure not used by any
prior version.</p>
<p><strong>Claim count rose moderately on 2 of 3 fixtures</strong>: F02 15→16 (flat),
F03 14→29 (~2x), F06 12→21 (~1.75x). F06's fresh run needed one repair
(CF5_UNKNOWN_UNIT_ID — a hallucinated unit ID, the same failure class seen once
before in the v0005 experiment; repair succeeded cleanly).</p>
<p><strong>Crux recall improved on 2 of 3 fixtures</strong>: F02 3/4→3/4 (flat),
F03 2/4→3/4, F06 4/5→5/5 (perfect). F03's Thompson/MMR crux pair recovered G02
(claim E004: "The CDC manipulated and concealed data from a 2004 study linking MMR
vaccine to autism by removing groups of children to hide a dramatic increase in
autism after vaccination") but not G03 this run — checked by direct inspection,
and unlike v0006's clean G03 recovery, this is a genuine content difference, not a
targetMatching.js false negative: this run's claims describe data manipulation and
concealment but do not state that evidence was destroyed, so the "absent" verdict
for G03 is accurate for this specific run.</p>
<p><strong>Zero near-duplicates flagged on all 3 fixtures</strong> — the same clean
result seen under v0006, in contrast to v0005's spike to 0.5 on F06. This is a
second, independent data point suggesting the "minimum number of assertions per
theme" framing (present in both v0006 and v0007) avoids the atomized,
shared-subject fragmentation that tripped the duplicate heuristic under v0005.</p>
<p><strong>Compound rate is elevated and only partially verified.</strong> F03
(0.379, 11 of 29 claims) and F06 (0.381, 8 of 21) both flag well above v0001's
baseline. Spot inspection shows a mix: some flagged claims are genuinely borderline
single-predication descriptions of one group's characteristics (e.g. F03's E001-E003
describing different parent subgroups) that plausibly should not be split further,
alongside at least one claim that does bundle multiple distinct mechanisms (F03's
E012: injection bypasses natural defenses, introduces antigens/adjuvants, and
crosses the blood-brain barrier). This was not fully adjudicated claim-by-claim and
should be treated as an open question for human review, not a confirmed defect
count.</p>

<h2>Experiment Configuration</h2>
<table>
<tr><th>Architecture</th><td>CF5</td></tr>
<tr><th>Prompt versions compared</th><td>PromptCF5-v0001 (frozen baseline) vs PromptCF5-v0007 (MISSION/TASK/OUTPUT hybrid)</td></tr>
<tr><th>Model</th><td>${esc(runConfig.model)}</td></tr>
<tr><th>Fixtures</th><td>${esc(runConfig.fixtures.join(", "))}</td></tr>
<tr><th>Repeats per fixture per version</th><td>${runConfig.repeatsPerFixturePerVersion}</td></tr>
<tr><th>Total generation runs</th><td>${runConfig.totalGenerationRuns} (3 reused as v0001 baseline, 3 run fresh)</td></tr>
<tr><th>Git commit</th><td>${esc(gitCommit)}</td></tr>
<tr><th>PromptCF5-v0001 hash</th><td>${esc(runConfig.promptV0001Hash)}</td></tr>
<tr><th>PromptCF5-v0007 hash</th><td>${esc(runConfig.promptV0007Hash)}</td></tr>
<tr><th>Schema hash</th><td>${esc(schemaHash)}</td></tr>
</table>

<p>Field provenance: <span class="tag tag-model">MODEL</span>from the generation call
<span class="tag tag-host">HOST</span>deterministically computed (validation,
target-matching, duplicate/compound heuristics).</p>
`;

const realDetailRenderer = (r) => {
  const groundingHtml = r.groundingText.map((g) => `<div class="unit-excerpt"><strong>${esc(g.id)}</strong>: ${esc(g.text)}</div>`).join("");
  const indicatorBadges = [
    r._recoveredTargets.length ? `<span class="indicator ind-recovered">RECOVERED: ${esc(r._recoveredTargets.join(", "))}</span>` : "",
    r._isDuplicate ? '<span class="indicator ind-duplicate">POSSIBLE DUPLICATE</span>' : "",
    r._isCompound ? '<span class="indicator ind-compound">POSSIBLY COMPOUND</span>' : "",
  ].filter(Boolean).join(" ");
  return `<div class="detail">
    <p>${indicatorBadges || '<span class="muted">no indicators</span>'}</p>
    <p><span class="tag tag-model">MODEL</span><strong>claim:</strong> ${esc(r.claim)}</p>
    <p><span class="tag tag-model">MODEL</span><strong>articleTreatment:</strong> ${esc(r.articleTreatment)}
      &nbsp; <strong>provenance:</strong> ${r.provenance === null ? '<span class="muted">null (article voice)</span>' : esc(r.provenance)}</p>
    <p><span class="tag tag-host">HOST</span><strong>grounding (${r.grounding.length} unit(s)):</strong></p>
    ${groundingHtml}
    <p class="muted">git ${esc(r._gitCommit)} · prompt hash ${esc(r._promptHash)} · schema hash ${esc(r._schemaHash)} · returned model ${esc(r._returnedModel)}</p>
  </div>`;
};

const rowClassifier = (r) => (r._isDuplicate || r._isCompound ? "failed" : "");

const targetComparisonRenderer = (rows, DATA) => {
  let html = "";
  for (const fixture of [...new Set(DATA.rows.map((r) => r.fixture))].sort()) {
    const targetIds = Object.keys(DATA.extra.gold[fixture] ?? {});
    html += `<h3>${fixture}</h3><table><thead><tr><th>Target</th><th>Description</th>`
      + `<th>v0001</th><th>v0007 (MISSION/TASK/OUTPUT hybrid)</th></tr></thead><tbody>`;
    for (const targetId of targetIds) {
      const desc = DATA.extra.gold[fixture][targetId];
      const hitFor = (version) => DATA.rows.some((r) => r.fixture === fixture && r.promptVersion === version && r._recoveredTargets.includes(targetId));
      html += `<tr><td>${targetId}</td><td>${desc}</td>`
        + `<td>${hitFor("PromptCF5-v0001") ? "present" : "absent"}</td>`
        + `<td>${hitFor("PromptCF5-v0007") ? "present" : "absent"}</td></tr>`;
    }
    html += "</tbody></table>";
  }
  return html;
};

const stabilityRenderer = (rows, DATA) => {
  let html = `<p class="muted">${esc(DATA.extra.stabilityNote)}</p>`;
  html += "<table><thead><tr><th>Fixture</th><th>Version</th><th>Claim count (1 run)</th>"
    + "<th>Exact-text stability</th><th>Crux presence (this one run)</th></tr></thead><tbody>";
  for (const cell of DATA.extra.analysisCells) {
    const presence = cell.targetPresence.map((t) => `${t.targetId}: ${t.hits ? "present" : "absent"}`).join("; ");
    html += `<tr><td>${cell.fixture}</td><td>${cell.promptVersion}</td><td>${cell.claimCount}</td>`
      + `<td>${cell.exactTextStability === null ? "n/a (needs ≥2 repeats)" : cell.exactTextStability}</td>`
      + `<td>${presence}</td></tr>`;
  }
  html += "</tbody></table>";
  return html;
};

const aggregateMetricsRenderer = (rows, DATA) => {
  let html = "<table><thead><tr><th>Fixture</th><th>Version</th><th>Claim count</th>"
    + "<th>Duplicate rate</th><th>Compound rate</th><th>Crux precision proxy</th><th>Crux recall</th><th>Hard failures</th><th>Repair used</th></tr></thead><tbody>";
  for (const cell of DATA.extra.analysisCells) {
    html += `<tr><td>${cell.fixture}</td><td>${cell.promptVersion}</td><td>${cell.claimCount}</td>`
      + `<td>${cell.duplicateRate}</td><td>${cell.compoundRate}</td><td>${cell.cruxPrecisionProxy}</td>`
      + `<td>${cell.cruxRecall}</td><td>${cell.hardFailures}</td><td>${cell.repairUsed}</td></tr>`;
  }
  html += "</tbody></table><p class=\"muted\">n=1 per cell — these numbers describe one "
    + "run each, not a reliable rate. Duplicate rate of 0 across all v0007 cells was "
    + "spot-checked and is consistent with v0006's result, not a detection-threshold "
    + "artifact. F03/F06 compound rates were only partially verified by inspection — see "
    + "Executive Summary. Crux precision proxy is scoped to gold cruxes only.</p>";
  return html;
};

const footerHtml = `
<h2>Recommendation</h2>
<p><strong>Do not promote PromptCF5-v0007 to production on this evidence (n=1 per
fixture), but add it to the shortlist (with v0005 and v0006) for a full multi-repeat
regression.</strong> Reasons:</p>
<ul>
<li><strong>Third consecutive real improvement over v0001</strong>, via yet another
distinct mechanism (worked atomicity examples + thematic coverage + explicit
MISSION/TASK/OUTPUT structuring). F06 hit perfect crux recovery, matching v0006's
F06 result on this fixture.</li>
<li><strong>Cheapest of the three "beyond v0001" candidates on F02</strong> — claim
count stayed flat (15→16) on F02, where v0005 and v0006 both grew claim count
substantially. F03 and F06 still grew (~1.75-2x), so this is fixture-dependent, not
a uniform cost advantage.</li>
<li><strong>F03's G03 miss this run reads as genuine</strong>, not a matcher
artifact — worth tracking whether a second repeat reproduces v0006's explicit
"destroyed evidence" phrasing or consistently stops short at "manipulated and
concealed."</li>
<li><strong>Compound-rate concern is real but unresolved</strong>, similar in shape
to v0006's — a full regression should include a dedicated row-by-row compound-claim
audit rather than relying on the word/conjunction-count heuristic alone.</li>
</ul>
<p class="muted">Future recommendation (not incorporated into this candidate, per
the experiment's instructions): with v0005, v0006, and v0007 all now showing
independent crux-recovery gains over v0001 via different mechanisms, the next
useful step is a single head-to-head regression across all three (plus v0001) with
matched repeat counts, rather than further one-off variants.</p>
`;

const html = buildReviewHtml({
  title: "CF5 PromptCF5-v0007 Blind Regression Review",
  legendHtml,
  rows,
  columns: [["fixture", "Fixture"], ["promptVersion", "Version"], ["repeat", "Rep"],
    ["claimId", "ID"], ["claim", "Claim"], ["articleTreatment", "Treatment"], ["indicatorSummary", "Indicators"]],
  filterKeys: ["fixture", "promptVersion", "repeat", "articleTreatment"],
  detailRenderer: realDetailRenderer,
  rowClassifier,
  extraTabs: [
    { id: "targets", label: "Target Comparison", renderer: targetComparisonRenderer },
    { id: "stability", label: "Stability", renderer: stabilityRenderer },
    { id: "metrics", label: "Aggregate Metrics", renderer: aggregateMetricsRenderer },
  ],
  footerHtml,
  extraData: { gold, analysisCells: analysis.cells, stabilityNote: analysis.stabilityNote },
});

writeFileSync(path.join(outDir, "review.html"), html);
console.log(`Wrote review.html → ${outDir}`);
