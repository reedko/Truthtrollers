#!/usr/bin/env node
// CF5 PromptCF5-v0003/v0004 blind regression — review.html builder. Reuses
// reportBuilder.js unmodified (no code changes to report generation, per this
// experiment's constraints).
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildReviewHtml } from "./reportBuilder.js";
import { loadGoldTargets } from "./targetMatching.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../..");
const outDir = path.resolve(root, "artifacts/claim-foundry/cf5-promptcf5-v003-v004");

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
<h1 style="margin-top:0">CF5 PromptCF5-v0003 / v0004 Blind Regression</h1>
<h2>Executive Summary</h2>
<p><strong>Recommendation: neither v0003 nor v0004 should replace PromptCF5-v0001 on
this evidence.</strong> Both alternative ontologies are directionally plausible but
n=1 per fixture is not enough to act on, and v0004 shows one concrete, directly-verified
quality concern (see below).</p>
<p><strong>Major improvements:</strong> F06 under v0003 ("Basis") recovered all 5 of 5
gold cruxes, the first time any prompt version tested this cycle has hit F06 perfectly
in a single run — it uniquely recovered G06 (coral bleaching mechanism), which v0001
missed. F03 under v0004 ("Evidence Questions") recovered G03 ("CDC officials ordered
researchers to destroy evidence...") — a crux that has appeared in at most 1 of 5 runs
in every other experiment this cycle, including the separate PromptCF5-v0002 experiment,
where it also surfaced under a different alternative framing. Two independent
experiments now each showing one G03 recovery under a non-baseline framing is a
pattern worth tracking, not yet a reliable effect.</p>
<p><strong>Major regressions:</strong> F02 under v0004 recovered only 2 of 4 cruxes
(v0001: 3 of 4) — lost both G02 and G05. More importantly: v0004's F06 run shows a
directly-verified, genuine compound-claim pattern — 8 of 11 claims flagged, word counts
consistently in the high 30s-40s, each packing multiple distinct facts (e.g. one claim
combines the reef's formation epoch, age, "largest living structure" status, and size
statistics into a single 46-word claim). This was checked by direct inspection, not
just the heuristic count, and is real: the "evidence questions" framing appears to push
the model toward consolidating related facts into fewer, denser questions rather than
atomic decomposition — in tension with the v0004 prompt's own stated goal of
"independent" evidence questions.</p>
<p><strong>Overall observations:</strong> No hard validation failures or repairs across
any of the 9 runs. Claim counts varied more under v0003/v0004 than the established
8-15 target band would suggest is typical (F03 v0003/v0004 both dropped to 10; F06
v0003 rose to 15). With only 1 repeat per (fixture, version), <strong>none of these
differences can be distinguished from ordinary run-to-run variance</strong> — every
number in this report should be read as "observed in this one run," not "reliably
caused by this prompt version." See Stability tab.</p>

<h2>Experiment Configuration</h2>
<table>
<tr><th>Architecture</th><td>CF5</td></tr>
<tr><th>Prompt versions compared</th><td>PromptCF5-v0001 (frozen baseline) vs PromptCF5-v0003 (Basis) vs PromptCF5-v0004 (Evidence Questions)</td></tr>
<tr><th>Model</th><td>${esc(runConfig.model)}</td></tr>
<tr><th>Fixtures</th><td>${esc(runConfig.fixtures.join(", "))}</td></tr>
<tr><th>Repeats per fixture per version</th><td>${runConfig.repeatsPerFixturePerVersion}</td></tr>
<tr><th>Total generation runs</th><td>${runConfig.totalGenerationRuns} (3 reused as v0001 baseline, 6 run fresh)</td></tr>
<tr><th>Git commit</th><td>${esc(gitCommit)}</td></tr>
<tr><th>PromptCF5-v0001 hash</th><td>${esc(runConfig.promptV0001Hash)}</td></tr>
<tr><th>PromptCF5-v0003 hash</th><td>${esc(runConfig.promptV0003Hash)}</td></tr>
<tr><th>PromptCF5-v0004 hash</th><td>${esc(runConfig.promptV0004Hash)}</td></tr>
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
      + `<th>v0001</th><th>v0003 (Basis)</th><th>v0004 (Evidence Questions)</th></tr></thead><tbody>`;
    for (const targetId of targetIds) {
      const desc = DATA.extra.gold[fixture][targetId];
      const hitFor = (version) => DATA.rows.some((r) => r.fixture === fixture && r.promptVersion === version && r._recoveredTargets.includes(targetId));
      html += `<tr><td>${targetId}</td><td>${desc}</td>`
        + `<td>${hitFor("PromptCF5-v0001") ? "present" : "absent"}</td>`
        + `<td>${hitFor("PromptCF5-v0003") ? "present" : "absent"}</td>`
        + `<td>${hitFor("PromptCF5-v0004") ? "present" : "absent"}</td></tr>`;
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
    + "<th>Duplicate rate</th><th>Compound rate</th><th>Crux precision proxy</th><th>Crux recall</th></tr></thead><tbody>";
  for (const cell of DATA.extra.analysisCells) {
    html += `<tr><td>${cell.fixture}</td><td>${cell.promptVersion}</td><td>${cell.claimCount}</td>`
      + `<td>${cell.duplicateRate}</td><td>${cell.compoundRate}</td><td>${cell.cruxPrecisionProxy}</td>`
      + `<td>${cell.cruxRecall}</td></tr>`;
  }
  html += "</tbody></table><p class=\"muted\">n=1 per cell — these numbers describe one "
    + "run each, not a reliable rate. F06 PromptCF5-v0004's compound rate (0.727) was "
    + "checked by direct inspection and confirmed genuine (see Executive Summary), not a "
    + "heuristic artifact. Crux precision proxy is scoped to gold cruxes only.</p>";
  return html;
};

const footerHtml = `
<h2>Recommendation</h2>
<p><strong>Do not promote either PromptCF5-v0003 or PromptCF5-v0004 to production on
this evidence.</strong> Both are single-run observations (n=1 per fixture); nothing
here rises to a reliable effect. Specifically:</p>
<ul>
<li><strong>PromptCF5-v0003 (Basis)</strong> is the more promising of the two — F06's
perfect 5/5 crux recovery is a genuinely good single-run result, and no quality concern
was found on direct inspection. Worth a full 3-5 repeat regression (matching the rigor
already applied to v0002) before any adoption decision.</li>
<li><strong>PromptCF5-v0004 (Evidence Questions)</strong> has a real, directly-verified
quality concern: it produces noticeably more compound, multi-fact claims than v0001 or
v0003 (confirmed by inspection, not just the heuristic count), which cuts against its
own stated goal of "independent" evidence questions. This is not disqualifying on n=1,
but it is a specific, named reason to be cautious rather than a vague impression.</li>
</ul>
<p class="muted">Future recommendation (not incorporated into either candidate, per the
experiment's instructions): if PromptCF5-v0003 is carried forward for a full regression,
also re-check whether F03's G03 recovery (now observed once each under two different
non-baseline framings — PromptCF5-v0002 and PromptCF5-v0004 — across two separate
experiments) becomes more reliable under the Basis ontology specifically, since that
crux has been the hardest target all cycle.</p>
`;

const html = buildReviewHtml({
  title: "CF5 PromptCF5-v0003/v0004 Blind Regression Review",
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
