#!/usr/bin/env node
// CF5 PromptCF5-v0005 blind regression — review.html builder. Reuses
// reportBuilder.js unmodified (no code changes to report generation, per this
// experiment's constraints).
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildReviewHtml } from "./reportBuilder.js";
import { loadGoldTargets } from "./targetMatching.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../..");
const outDir = path.resolve(root, "artifacts/claim-foundry/cf5-promptcf5-v005");

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
<h1 style="margin-top:0">CF5 PromptCF5-v0005 Blind Regression</h1>
<h2>Executive Summary</h2>
<p><strong>Recommendation: do not promote PromptCF5-v0005 to production on this
evidence, but its crux-recovery result is the strongest observed all cycle and
justifies a full multi-repeat regression.</strong> v0005 reverses the minimality
framing of every prior version ("Your goal is NOT to minimize the number of
propositions... minimize the semantic content of each proposition") and drops the
8-15 claim count target entirely.</p>
<p><strong>Claim count roughly tripled:</strong> 15→45 (F02), 14→47 (F03), 12→46
(F06), consistent with the prompt's explicit removal of the count ceiling and
instruction to maximize atomicity rather than minimize proposition count.</p>
<p><strong>Crux recall improved on every fixture:</strong> F02 3/4→4/4, F03
2/4→3/4, F06 4/5→5/5 (v0001→v0005). F02 and F06 both hit perfect recovery in a
single run. Most notably, F03 claim E009 ("CDC officials ordered researchers to
destroy evidence linking MMR vaccine to autism and manipulated data to disprove
the link") cleanly and unambiguously recovers <strong>both</strong> G02 and G03 —
the "Thompson/MMR" crux pair that has been the single hardest, most persistently
unrecovered gold target across the entire CF4 and CF5 effort. This was verified by
direct inspection of the claim text, not just the automated matcher. It is still
only one run (n=1), so this cannot yet be called reliable, but it is the cleanest
single recovery of this crux seen this cycle.</p>
<p><strong>Metric artifacts confirmed, not real defects:</strong> F06's
near-duplicate rate spiked to 0.5 (23 flagged pairs across 46 claims). Direct
inspection confirms this is the same false-positive pattern seen repeatedly this
cycle: claims like "The Great Barrier Reef harbored 1,625 species of fish" and
"...3,000 species of mollusk" share a common subject and verb but report distinct,
non-duplicative facts. The word-overlap heuristic cannot distinguish "same topic"
from "same proposition" and flags both. With ~3x more claims sharing the same
few subjects (a direct consequence of maximizing atomicity), this artifact is
mechanically more likely to fire — it is not evidence of real duplication.</p>
<p><strong>Compound-claim rate did not drop as expected:</strong> F03's
possibly-compound rate stayed the highest of the three fixtures (0.319, 15 of 47
claims), essentially flat versus v0001 (0.5, but off a much smaller n=14). Spot
inspection of flagged claims (e.g. E006: "...regurgitates canned answers without
research and demands censorship and medical mandates...") shows genuinely
borderline cases — plausibly two distinct testable behaviors bundled into one
claim, but not obviously wrong either. This was not fully adjudicated one claim at
a time and should be treated as an open question for human review, not a
confirmed finding either way.</p>
<p><strong>New failure mode at this scale:</strong> F02's fresh run needed one
repair — the model referenced a source-unit ID (U00116) that does not exist in the
article, the first CF5_UNKNOWN_UNIT_ID failure seen in any PromptCF5-v0002/v0003/
v0004/v0005 experiment this cycle. Repair succeeded (final set is 45 valid claims).
Producing ~3x more claims appears to raise the risk of an isolated grounding-ID
hallucination, though n=1 cannot establish this is systematic.</p>

<h2>Experiment Configuration</h2>
<table>
<tr><th>Architecture</th><td>CF5</td></tr>
<tr><th>Prompt versions compared</th><td>PromptCF5-v0001 (frozen baseline) vs PromptCF5-v0005 (maximize atomicity, no count ceiling)</td></tr>
<tr><th>Model</th><td>${esc(runConfig.model)}</td></tr>
<tr><th>Fixtures</th><td>${esc(runConfig.fixtures.join(", "))}</td></tr>
<tr><th>Repeats per fixture per version</th><td>${runConfig.repeatsPerFixturePerVersion}</td></tr>
<tr><th>Total generation runs</th><td>${runConfig.totalGenerationRuns} (3 reused as v0001 baseline, 3 run fresh)</td></tr>
<tr><th>Git commit</th><td>${esc(gitCommit)}</td></tr>
<tr><th>PromptCF5-v0001 hash</th><td>${esc(runConfig.promptV0001Hash)}</td></tr>
<tr><th>PromptCF5-v0005 hash</th><td>${esc(runConfig.promptV0005Hash)}</td></tr>
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
      + `<th>v0001</th><th>v0005 (maximize atomicity)</th></tr></thead><tbody>`;
    for (const targetId of targetIds) {
      const desc = DATA.extra.gold[fixture][targetId];
      const hitFor = (version) => DATA.rows.some((r) => r.fixture === fixture && r.promptVersion === version && r._recoveredTargets.includes(targetId));
      html += `<tr><td>${targetId}</td><td>${desc}</td>`
        + `<td>${hitFor("PromptCF5-v0001") ? "present" : "absent"}</td>`
        + `<td>${hitFor("PromptCF5-v0005") ? "present" : "absent"}</td></tr>`;
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
    + "run each, not a reliable rate. F06 PromptCF5-v0005's duplicate rate (0.5) was "
    + "checked by direct inspection and confirmed to be a metric artifact (shared-subject "
    + "word overlap between genuinely distinct claims), not real duplication — see "
    + "Executive Summary. Crux precision proxy is scoped to gold cruxes only, and is "
    + "expected to fall as claim count rises even when recall improves, since the "
    + "denominator (total claims) grows faster than matched claims.</p>";
  return html;
};

const footerHtml = `
<h2>Recommendation</h2>
<p><strong>Do not promote PromptCF5-v0005 to production on this evidence (n=1 per
fixture), but prioritize it for a full 3-5 repeat regression ahead of v0003/v0004.</strong>
Reasons:</p>
<ul>
<li><strong>Strongest crux-recovery result of the cycle.</strong> Perfect recall on
F02 (4/4) and F06 (5/5), and the first clean single-claim recovery of the F03
Thompson/MMR pair (G02+G03 both present in E009) — verified genuine by direct
inspection, not a matcher artifact. This is the specific hard case that motivated
the entire CF4→CF5 pivot.</li>
<li><strong>Cost is real and roughly 3x.</strong> Claim count tripled (12-15 →
45-47), which triples downstream token cost for any consumer of the claim set,
and produced this experiment's only CF5_UNKNOWN_UNIT_ID repair. Whether this
tradeoff is worth it depends entirely on whether the finer-grained claims are
genuinely useful downstream or mostly restate the same testable facts at higher
resolution — the near-duplicate spike suggests at least some of the added volume
is low-marginal-value (same subject, different micro-fact), even though it isn't
"duplicative" in the strict sense the metric flags.</li>
<li><strong>Compound-claim rate on F03 needs a real human pass.</strong> It did not
improve despite v0005's explicit anti-merge language, and the flagged claims from
spot inspection are genuinely borderline rather than clearly right or clearly
wrong. This should be resolved by row-by-row review in this report's default tab,
not by the aggregate heuristic alone.</li>
</ul>
<p class="muted">Future recommendation (not incorporated into this candidate, per
the experiment's instructions): if v0005 is carried forward, a full regression
should specifically track whether the F03 G02/G03 recovery seen here holds up
across repeats, since every prior attempt at this crux (across CF4 selection
experiments and PromptCF5-v0001 through v0004) has recovered it inconsistently at
best.</p>
`;

const html = buildReviewHtml({
  title: "CF5 PromptCF5-v0005 Blind Regression Review",
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
