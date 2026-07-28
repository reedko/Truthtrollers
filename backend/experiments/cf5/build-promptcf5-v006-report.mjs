#!/usr/bin/env node
// CF5 PromptCF5-v0006 blind regression — review.html builder. Reuses reportBuilder.js
// unmodified (no code changes to report generation, per this experiment's constraints).
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildReviewHtml } from "./reportBuilder.js";
import { loadGoldTargets } from "./targetMatching.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../..");
const outDir = path.resolve(root, "artifacts/claim-foundry/cf5-promptcf5-v006");

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
<h1 style="margin-top:0">CF5 PromptCF5-v0006 Blind Regression</h1>
<h2>Executive Summary</h2>
<p><strong>Recommendation: do not promote PromptCF5-v0006 to production on this
evidence, but it is the second consecutive candidate (after v0005) to show a real
crux-recovery improvement over v0001, via a completely different mechanism.</strong>
v0006 reframes ClaimFoundry as extracting "foundational thematic assertions" with
the minimum number of single-predication assertions needed to cover each
contiguous argumentative theme — a coverage framing, distinct from both v0001's
minimality and v0005's maximal-atomicity framing, and it drops the detailed
pronoun-resolution / distinctness-boundary language present in every prior
version.</p>
<p><strong>Claim count rose moderately</strong> (roughly 1.4x-2x, not the ~3x seen
under v0005): F02 15→20.5 avg, F03 14→28 avg, F06 12→18.5 avg. No hard failures
or repairs across any of the 6 fresh v0006 runs.</p>
<p><strong>Crux recall improved on every fixture</strong>, proportionally similar
to or better than v0005: F02 3/4 (75%)→7/8 (87.5%), F03 2/4 (50%)→6/8 (75%), F06
4/5 (80%)→10/10 (100%, perfect on both repeats). F03's Thompson/MMR crux pair
(G02+G03) — the hardest target all cycle — was recovered on <strong>both</strong>
repeats for G02, and repeat 2's claim E006 is the cleanest single-claim recovery
of this crux seen this cycle: "In 2014, CDC scientist William Thompson revealed
data manipulation and cover-ups in a 2004 CDC study that illegally destroyed
evidence linking MMR vaccine to autism." Repeat 1's automated match shows G03 as
"absent," but direct inspection shows this is a <strong>matcher limitation, not a
real miss</strong>: repeat 1's E005 says "...ordering destruction of incriminating
data..." — the regex requires the literal string "destroy" and does not match
"destruction." Read charitably, both repeats plausibly capture G03; this is
flagged here as a targetMatching.js gap for future correction, not fixed in this
experiment.</p>
<p><strong>Zero near-duplicates flagged across all 6 fresh runs</strong> — a
genuinely clean result, in sharp contrast to v0005 (which spiked to 0.5 on F06
from splitting facts about a shared subject into many short claims). Spot
inspection of a 31-claim F03 run confirms the claims are in fact well-formed and
distinct, not merely below the heuristic's detection threshold.</p>
<p><strong>Compound-claim rate is a genuine, verified concern</strong> (F06:
0.432, the highest of any fixture this run). Direct inspection confirms real
compound claims, not heuristic artifacts — e.g. F06 repeat 1's E003 bundles five
independently-verifiable species counts into one claim ("harbored 1,625 species of
fish, 3,000 species of mollusk, 450 species of coral, 220 species of birds, and 30
species of whales and dolphins"), which v0001 and v0005 would very likely have
split. This is the direct, expected consequence of the "minimum number of
single-predication assertions" coverage framing: it explicitly optimizes for
fewer assertions per theme, which trades against per-fact independent
testability.</p>
<p><strong>Run-to-run variance is higher than v0001's historical band</strong>:
F03 claim count varied 25 vs 31 (24% swing) between its two repeats, and exact-text
stability is near zero for all three fixtures (0, 0, 0.057) — meaning the two
repeats' claim texts barely overlap verbatim. This is expected under any looser
framing and is known to understate true semantic stability (paraphrasing reads as
instability under exact-text matching — see Stability tab), but the swing in raw
claim count itself (not just wording) is a real signal of lower determinism than
v0001.</p>

<h2>Experiment Configuration</h2>
<table>
<tr><th>Architecture</th><td>CF5</td></tr>
<tr><th>Prompt versions compared</th><td>PromptCF5-v0001 (frozen baseline) vs PromptCF5-v0006 (thematic single-predication coverage)</td></tr>
<tr><th>Model</th><td>${esc(runConfig.model)}</td></tr>
<tr><th>Fixtures</th><td>${esc(runConfig.fixtures.join(", "))}</td></tr>
<tr><th>Repeats per fixture per version</th><td>v0001: 1 (reused baseline) &middot; v0006: 2 (fresh)</td></tr>
<tr><th>Total generation runs</th><td>${runConfig.totalGenerationRuns} (3 reused as v0001 baseline, 6 run fresh as v0006)</td></tr>
<tr><th>Git commit</th><td>${esc(gitCommit)}</td></tr>
<tr><th>PromptCF5-v0001 hash</th><td>${esc(runConfig.promptV0001Hash)}</td></tr>
<tr><th>PromptCF5-v0006 hash</th><td>${esc(runConfig.promptV0006Hash)}</td></tr>
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
      + `<th>v0001 (of 1)</th><th>v0006 (of 2)</th></tr></thead><tbody>`;
    for (const targetId of targetIds) {
      const desc = DATA.extra.gold[fixture][targetId];
      const countFor = (version) => new Set(DATA.rows
        .filter((r) => r.fixture === fixture && r.promptVersion === version && r._recoveredTargets.includes(targetId))
        .map((r) => r.repeat)).size;
      html += `<tr><td>${targetId}</td><td>${desc}</td>`
        + `<td>${countFor("PromptCF5-v0001")} of 1</td>`
        + `<td>${countFor("PromptCF5-v0006")} of 2</td></tr>`;
    }
    html += "</tbody></table>";
  }
  return html;
};

const stabilityRenderer = (rows, DATA) => {
  let html = `<p class="muted">${esc(DATA.extra.stabilityNote)}</p>`;
  html += "<table><thead><tr><th>Fixture</th><th>Version</th><th>Claim counts</th>"
    + "<th>Exact-text stability (Jaccard)</th><th>Target-based stability (per crux)</th></tr></thead><tbody>";
  for (const cell of DATA.extra.analysisCells) {
    const targetStability = cell.targetBasedStability.map((t) => `${t.targetId}: ${t.hits}/${t.of}`).join("; ");
    html += `<tr><td>${cell.fixture}</td><td>${cell.promptVersion}</td><td>${cell.claimCounts.join(", ")}</td>`
      + `<td>${cell.exactTextStability === null ? "n/a (needs ≥2 repeats)" : cell.exactTextStability}</td>`
      + `<td>${targetStability}</td></tr>`;
  }
  html += "</tbody></table><p class=\"muted\">Exact-text stability is known to understate true "
    + "semantic stability (paraphrasing across independent calls reads as instability under "
    + "exact-text matching). Target-based stability tolerates paraphrasing and is the more "
    + "meaningful figure for judging reliable recovery.</p>";
  return html;
};

const aggregateMetricsRenderer = (rows, DATA) => {
  let html = "<table><thead><tr><th>Fixture</th><th>Version</th><th>Repeats</th><th>Avg claim count</th>"
    + "<th>Duplicate rate</th><th>Compound rate</th><th>Crux precision proxy</th><th>Crux recall</th><th>Hard failures</th><th>Repairs used</th></tr></thead><tbody>";
  for (const cell of DATA.extra.analysisCells) {
    html += `<tr><td>${cell.fixture}</td><td>${cell.promptVersion}</td><td>${cell.repeatCount}</td><td>${cell.avgClaimCount}</td>`
      + `<td>${cell.duplicateRate}</td><td>${cell.compoundRate}</td><td>${cell.cruxPrecisionProxyAvg}</td>`
      + `<td>${cell.cruxRecall}</td><td>${cell.hardFailures}</td><td>${cell.repairsUsed}</td></tr>`;
  }
  html += "</tbody></table><p class=\"muted\">v0001 cells reflect a single reused run per "
    + "fixture (n=1); v0006 cells reflect 2 fresh repeats. F06 PromptCF5-v0006's compound "
    + "rate (0.432) was checked by direct inspection and confirmed genuine — real "
    + "multi-fact claims bundling several independently-verifiable numbers, not a heuristic "
    + "artifact (see Executive Summary). Duplicate rate of 0 across every v0006 cell was "
    + "also spot-checked and confirmed genuine, not merely below the detection threshold. "
    + "Crux precision proxy is scoped to gold cruxes only.</p>";
  return html;
};

const footerHtml = `
<h2>Recommendation</h2>
<p><strong>Do not promote PromptCF5-v0006 to production on this evidence (n=2 per
fixture), but treat it as a second, independently-motivated candidate worth a full
regression alongside v0005.</strong> Reasons:</p>
<ul>
<li><strong>Real crux-recovery gains, via a different mechanism than v0005.</strong>
Perfect recall on F06 (10/10 across both repeats) and a clean, explicit
single-claim recovery of the F03 Thompson/MMR pair on repeat 2 ("...CDC scientist
William Thompson revealed data manipulation and cover-ups... illegally destroyed
evidence linking MMR vaccine to autism"). Unlike v0005, this did not require
tripling the claim count — v0006's cost is roughly 1.4x-2x, not 3x.</li>
<li><strong>A real, named tradeoff: compound claims.</strong> The "minimum number
of single-predication assertions per theme" framing explicitly optimizes against
splitting, and it shows — F06's E003 bundles five independently-verifiable species
counts into one claim. This is the mirror-image problem from v0005 (which
over-split and tripped the duplicate-rate heuristic); v0006 under-splits and trips
the compound-rate heuristic. Both are verified real, not heuristic noise.</li>
<li><strong>Lower run-to-run determinism than v0001.</strong> F03's claim count
swung 25→31 between repeats (24%), and exact-text stability is near zero on all
three fixtures. Two repeats is not enough to call this reliable, but it is a
larger swing than has been seen for v0001 historically and should be tracked in
any follow-up regression.</li>
<li><strong>One matcher limitation surfaced, not fixed here:</strong>
targetMatching.js's G03 pattern requires the literal string "destroy" and misses
"destruction" — repeat 1's plausible G03 recovery reads as "absent" only because
of this. Worth a follow-up fix to targetMatching.js before relying on G03 recall
numbers in any future report.</li>
</ul>
<p class="muted">Future recommendation (not incorporated into this candidate, per
the experiment's instructions): a head-to-head v0005 vs v0006 regression on the
same fixtures with matched repeat counts would directly compare the two
competing failure modes (over-splitting vs under-splitting) now that both have
independently shown real crux-recovery gains over v0001.</p>
`;

const html = buildReviewHtml({
  title: "CF5 PromptCF5-v0006 Blind Regression Review",
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
