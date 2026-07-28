#!/usr/bin/env node
// CF5 PromptCF5-v002 blind regression — review.html builder. Uses reportBuilder.js
// (the CF5 reporting standard), not a one-off layout.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildReviewHtml } from "./reportBuilder.js";
import { loadGoldTargets } from "./targetMatching.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../..");
const outDir = path.resolve(root, "artifacts/claim-foundry/cf5-promptcf5-v002");

const results = JSON.parse(readFileSync(path.join(outDir, "results.json"), "utf8"));
const analysis = JSON.parse(readFileSync(path.join(outDir, "analysis.json"), "utf8"));
const runConfig = JSON.parse(readFileSync(path.join(outDir, "run_config.json"), "utf8"));
const gold = loadGoldTargets(root);

const unitTextByFixture = {};
for (const fixture of analysis.fixtures) {
  const units = JSON.parse(readFileSync(path.join(outDir, fixture.toLowerCase(), "source-units.json"), "utf8"));
  unitTextByFixture[fixture] = Object.fromEntries(units.map((u) => [u.unitId, u.text]));
}

// Flatten every claim, across every run, into one row, with indicator flags attached.
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
    });
  }
}

const gitCommit = results[0]?.manifest.gitCommit ?? "unknown";
const schemaHash = results[0]?.manifest.schemaHash ?? "unknown";

const legendHtml = `
<h1 style="margin-top:0">CF5 PromptCF5-v002 Blind Regression</h1>
<h2>Executive Summary</h2>
<p><strong>Recommendation: REJECT — do not promote PromptCF5-v0002 to production.</strong></p>
<p><strong>Major improvements:</strong> F03 gold crux recall rose from 4 of 12 target-slots
(across 3 repeats × 4 cruxes) to 6 of 12 under v0002, including one appearance of G03
("CDC officials ordered researchers to destroy evidence...") — a target that has
essentially never appeared under any prior real-word prompt version tested this cycle.
Sample size is 3 repeats; this is a real observation, not asserted as a reliable effect.</p>
<p><strong>Major regressions:</strong> F06 average claim count dropped from 13.7 to 11.3,
and F06 crux recall dipped slightly (14 of 15 → 13 of 15 target-slots). Both are modest
and within plausible run-to-run variance given only 3 repeats per version.</p>
<p><strong>Overall observations:</strong> Zero instances of the nonsense token leaking
into generated claim text across all 9 v0002 runs — the model used it correctly as an
instruction-level placeholder, never as content. One structural repair fired (F03
v0002 repeat 3, malformed source-unit ID) — the same benign, already-known defect class
seen in prior CF5 runs, cleanly auto-resolved. The F06 v0001 "duplicate rate" of 0.244
shown in Aggregate Metrics is a <strong>confirmed metric artifact</strong> (verified by
direct inspection: a short claim sharing common topic words — "Great Barrier Reef",
"Australia" — with many genuinely distinct longer claims), not real duplication. This is
a concrete demonstration of why this report leads with row-level inspection rather than
aggregate numbers.</p>
<p>Net: performance is comparable between v0001 and v0002 across all three fixtures —
no consistent, systematic degradation from replacing "proposition"/"propositions" with a
nonsense token. The experiment's real finding is that the specific semantic word does
not appear to be doing unique, irreplaceable work; the surrounding structural field
definitions carry most of the task specification. That is a genuine, useful finding for
future prompt design — but comparable performance is not a reason to replace a clear,
readable, auditable production prompt with a deliberately unreadable one. See the
Recommendation section below for the full evidence-based conclusion.</p>

<h2>Experiment Configuration</h2>
<table>
<tr><th>Architecture</th><td>CF5</td></tr>
<tr><th>Prompt versions compared</th><td>PromptCF5-v0001 (frozen baseline) vs PromptCF5-v0002 (nonsense-token candidate)</td></tr>
<tr><th>Model</th><td>${runConfig.model}</td></tr>
<tr><th>Fixtures</th><td>${runConfig.fixtures.join(", ")}</td></tr>
<tr><th>Repeats per fixture per version</th><td>${runConfig.repeatsPerFixturePerVersion}</td></tr>
<tr><th>Total generation runs</th><td>${runConfig.totalGenerationRuns} (9 reused as v0001 baseline, 9 run fresh as v0002)</td></tr>
<tr><th>Git commit</th><td>${esc(gitCommit)}</td></tr>
<tr><th>PromptCF5-v0001 hash</th><td>${esc(runConfig.promptV0001Hash)}</td></tr>
<tr><th>PromptCF5-v0002 hash</th><td>${esc(runConfig.promptV0002Hash)}</td></tr>
<tr><th>Schema hash</th><td>${esc(schemaHash)}</td></tr>
</table>

<p>Field provenance: <span class="tag tag-model">MODEL</span>from the generation or
repair call <span class="tag tag-host">HOST</span>deterministically computed
(validation, target-matching, duplicate/compound heuristics).</p>
`;

function esc(v) {
  return String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// detailRenderer must be self-contained JS (it gets toString()'d into the browser
// script) — so unit text lookups need to be embedded client-side too. Fold it into
// each row instead of a separate side-table, simplest and fully self-contained.
for (const row of rows) {
  row.groundingText = row.grounding.map((id) => ({ id, text: (unitTextByFixture[row.fixture][id] ?? "(not found)").slice(0, 500) }));
}

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
    html += `<h3>${fixture}</h3><table><thead><tr><th>Target</th><th>Description</th><th>v0001</th><th>v0002</th></tr></thead><tbody>`;
    for (const targetId of targetIds) {
      const desc = DATA.extra.gold[fixture][targetId];
      const countFor = (version) => new Set(DATA.rows
        .filter((r) => r.fixture === fixture && r.promptVersion === version && r._recoveredTargets.includes(targetId))
        .map((r) => r.repeat)).size;
      html += `<tr><td>${targetId}</td><td>${desc}</td><td>${countFor("PromptCF5-v0001")} of 3</td><td>${countFor("PromptCF5-v0002")} of 3</td></tr>`;
    }
    html += "</tbody></table>";
  }
  return html;
};

const stabilityRenderer = (rows, DATA) => {
  let html = "<table><thead><tr><th>Fixture</th><th>Version</th><th>Claim counts (3 repeats)</th>"
    + "<th>Exact-text stability (Jaccard)</th><th>Target-based stability (per crux, hits/3)</th></tr></thead><tbody>";
  for (const cell of DATA.extra.analysisCells) {
    const targetStability = cell.targetBasedStability.map((t) => `${t.targetId}: ${t.hits}/${t.of}`).join("; ");
    html += `<tr><td>${cell.fixture}</td><td>${cell.promptVersion}</td><td>${cell.claimCounts.join(", ")}</td>`
      + `<td>${cell.exactTextStability}</td><td>${targetStability}</td></tr>`;
  }
  html += "</tbody></table><p class=\"muted\">Exact-text stability is known to understate true "
    + "semantic stability (paraphrasing across independent calls reads as instability under "
    + "exact-text matching). Target-based stability tolerates paraphrasing and is the more "
    + "meaningful figure for judging reliable recovery.</p>";
  return html;
};

const aggregateMetricsRenderer = (rows, DATA) => {
  let html = "<table><thead><tr><th>Fixture</th><th>Version</th><th>Avg claim count</th>"
    + "<th>Duplicate rate</th><th>Compound rate</th><th>Crux precision proxy</th><th>Crux recall</th></tr></thead><tbody>";
  for (const cell of DATA.extra.analysisCells) {
    html += `<tr><td>${cell.fixture}</td><td>${cell.promptVersion}</td><td>${cell.avgClaimCount}</td>`
      + `<td>${cell.duplicateRate}</td><td>${cell.compoundRate}</td><td>${cell.cruxPrecisionProxyAvg}</td>`
      + `<td>${cell.cruxRecall}</td></tr>`;
  }
  html += "</tbody></table><p class=\"muted\">Duplicate rate and compound rate are crude, "
    + "clearly-labeled heuristics (word overlap; word/conjunction count) — review the Rows "
    + "tab's flagged claims directly rather than trusting these numbers alone. Crux precision "
    + "proxy is scoped to gold cruxes only, not the complete gold assertion set. These metrics "
    + "support inspection; they do not replace it.</p>";
  return html;
};

const footerHtml = `
<h2>Recommendation</h2>
<p><strong>Do not promote PromptCF5-v0002 to production.</strong> Across all three
fixtures, replacing every model-facing occurrence of "proposition"/"propositions" with
a nonsense token produced performance comparable to the current production prompt:
unchanged on F02 (10 of 12 crux-slots both versions), a small directional improvement
on F03 (4 of 12 → 6 of 12, n=3, not asserted as reliable), and a small directional
decline on F06 (14 of 15 → 13 of 15). No fixture showed a large, consistent, repeated
degradation or improvement. Zero token leakage into generated content; one benign,
auto-repaired structural defect of an already-known class.</p>
<p>This is a genuine null result on the core hypothesis, not a failure to find an
effect worth reporting: it suggests the specific word "proposition" is not carrying
unique semantic weight that the surrounding structural field definitions (claim,
grounding, articleTreatment, provenance, and their descriptions) don't already supply
in-context. That is useful to know for future prompt design. It is not, on its own,
a reason to ship a deliberately unreadable production prompt when a clear, auditable
one performs the same. PromptCF5-v0001 remains production.</p>
<p class="muted">Future recommendation (not incorporated into v0002, documented
separately per the experiment's instructions): investigate F03's G03 recovery under
v0002 with a larger repeat count before treating it as a real effect one way or the
other — it is the single most interesting data point in this run and deserves more
than n=3 before any conclusion is drawn from it.</p>
`;

// extraTab renderer functions are serialized via Function.prototype.toString() into
// the browser script, which captures the function body only, not its closure — so
// gold targets and the analysis cells they reference are passed as extraData, embedded
// into DATA.extra client-side, and read as DATA.extra.gold / DATA.extra.analysisCells.
const html = buildReviewHtml({
  title: "CF5 PromptCF5-v002 Blind Regression Review",
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
  extraData: { gold, analysisCells: analysis.cells },
});

writeFileSync(path.join(outDir, "review.html"), html);
console.log(`Wrote review.html → ${outDir}`);
