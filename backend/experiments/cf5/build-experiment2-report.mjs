#!/usr/bin/env node
// CF5 Prompt Experiment 2 — report builder. Reads results.json (produced by
// run-cf5-experiment2.mjs), computes target matching for every run, writes
// target_comparison.json, report.md, and a standalone report.html.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { matchTargetsForRun, loadGoldTargets, MATCHING_METHOD_DESCRIPTION } from "./targetMatching.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../..");
const outDir = path.resolve(root, "artifacts/claim-foundry/cf5-experiment2");

const runConfig = JSON.parse(readFileSync(path.join(outDir, "run_config.json"), "utf8"));
const results = JSON.parse(readFileSync(path.join(outDir, "results.json"), "utf8"));
const fixtures = runConfig.fixtures;
const gold = loadGoldTargets(root);

const sourceUnitsByFixture = {};
for (const fixture of fixtures) {
  sourceUnitsByFixture[fixture] = JSON.parse(
    readFileSync(path.join(outDir, fixture.toLowerCase(), "source-units.json"), "utf8"));
}
const unitTextById = {};
for (const fixture of fixtures) {
  unitTextById[fixture] = Object.fromEntries(sourceUnitsByFixture[fixture].map((u) => [u.unitId, u.text]));
}

// Attach target matching to every run.
for (const run of results) {
  run.targetMatches = matchTargetsForRun(run.fixture, run.finalClaims, root);
}
writeFileSync(path.join(outDir, "results.json"), JSON.stringify(results, null, 2));

// Aggregate: per fixture x target, count of runs (out of 3) where present, per arm.
const targetComparison = [];
for (const fixture of fixtures) {
  const targetIds = Object.keys(gold[fixture]);
  for (const targetId of targetIds) {
    const description = gold[fixture][targetId];
    const runsForTarget = results.filter((r) => r.fixture === fixture);
    const countFor = (arm) => runsForTarget
      .filter((r) => r.arm === arm)
      .filter((r) => r.targetMatches.find((t) => t.targetId === targetId)?.present).length;
    const ambiguousFor = (arm) => runsForTarget
      .filter((r) => r.arm === arm)
      .filter((r) => r.targetMatches.find((t) => t.targetId === targetId)?.ambiguous).length;
    targetComparison.push({
      fixture, targetId, targetDescription: description,
      promptA: { present: countFor("A"), ambiguous: ambiguousFor("A"), of: 3 },
      promptB: { present: countFor("B"), ambiguous: ambiguousFor("B"), of: 3 },
    });
  }
}
writeFileSync(path.join(outDir, "target_comparison.json"), JSON.stringify({
  method: MATCHING_METHOD_DESCRIPTION, targets: targetComparison,
}, null, 2));

function classify(count) {
  if (count === 0) return "remained absent";
  if (count === 3) return "appeared in all runs";
  if (count >= 2) return "appeared in most runs";
  return "appeared in one run";
}

// ---------- report.md ----------
const mdLines = [];
mdLines.push("# CF5 Prompt Experiment 2 — Proposition Independence Clarification");
mdLines.push("");
mdLines.push(`Date: ${new Date().toISOString().slice(0, 10)}`);
mdLines.push(`Objective: ${runConfig.objective}`);
mdLines.push("");
mdLines.push("## Exact prompt modification");
mdLines.push("");
mdLines.push("One sentence added after \"...could reasonably receive independent evidence "
  + "verdicts.\": *\"Two propositions are also distinct when either proposition could "
  + "reasonably be true while the other is false.\"* Full diff in `prompt_diff.txt`. "
  + "System prompt, schema, field definitions, structural validation, repair behavior, "
  + "and persistence behavior all unchanged.");
mdLines.push("");
mdLines.push(`Model: ${runConfig.model} · Fixtures: ${fixtures.join(", ")} · `
  + `Repeats per fixture per arm: ${runConfig.repeatsPerFixturePerArm} · `
  + `Total generation runs: ${runConfig.totalGenerationRuns}`);
const validationFailures = results.reduce((sum, r) => sum + (r.manifest.hardFailureClaimIds?.length ?? 0), 0);
const repairsUsed = results.filter((r) => r.manifest.repairUsed).length;
mdLines.push(`Validation-failure count: ${validationFailures} · Repair-call count: ${repairsUsed}`);
mdLines.push("");
mdLines.push("Prompt A data source: reused from `cf5-experiment1`'s Prompt B runs "
  + "(repeat1-3) — the now-adopted production prompt, run under identical "
  + "model/settings/schema/preprocessing/validation/repair. Prompt B run fresh.");
mdLines.push("");
mdLines.push("## Target comparison summary");
mdLines.push("");
mdLines.push("| Fixture | Target ID | Target description | Prompt A | Prompt B | Change |");
mdLines.push("| --- | --- | --- | ---: | ---: | --- |");
for (const t of targetComparison) {
  const aStr = `${t.promptA.present} of ${t.promptA.of}`;
  const bStr = `${t.promptB.present} of ${t.promptB.of}`;
  const change = t.promptB.present > t.promptA.present ? "improved"
    : t.promptB.present < t.promptA.present ? "declined" : "unchanged";
  mdLines.push(`| ${t.fixture} | ${t.targetId} | ${t.targetDescription} | ${aStr} | ${bStr} | ${change} |`);
}
mdLines.push("");
mdLines.push("## Written conclusion");
mdLines.push("");
mdLines.push("See `report.html` §Conclusion for the full narrative answer to all seven "
  + "required questions, with distinguishing language (one run / most runs / all runs "
  + "/ absent) per the experiment's own instruction not to call anything \"fixed\" from "
  + "a single appearance.");
mdLines.push("");
mdLines.push("Full per-run output (all five canonical fields, grounding text, run "
  + "metadata, target-matching detail) is in `report.html`, not reproduced here.");
writeFileSync(path.join(outDir, "report.md"), mdLines.join("\n") + "\n");

// ---------- report.html ----------
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function treatmentBadge(t) {
  const cls = t === "adopted" ? "badge-adopted" : t === "challenged" ? "badge-challenged" : "badge-reported";
  return `<span class="badge ${cls}">${esc(t)}</span>`;
}

function groundingCell(groundingIds, fixture) {
  const unitText = unitTextById[fixture];
  const idList = groundingIds.map((id) => esc(id)).join(", ");
  const details = groundingIds.map((id) => `<div class="unit-excerpt"><strong>${esc(id)}</strong>: `
    + `${esc((unitText[id] ?? "(unit text not found)").slice(0, 600))}</div>`).join("");
  return `<div class="grounding-ids">${idList}</div>`
    + `<details class="grounding-detail"><summary>show cited source-unit text</summary>${details}</details>`;
}

function runMetadataBlock(run) {
  const m = run.manifest;
  return `<div class="run-meta">`
    + `<span><strong>Fixture</strong> ${esc(run.fixture)}</span>`
    + `<span><strong>Prompt arm</strong> ${esc(run.arm)}</span>`
    + `<span><strong>Repeat</strong> ${esc(run.repeat)}</span>`
    + `<span><strong>Requested model</strong> ${esc(m.requestedModel)}</span>`
    + `<span><strong>Returned model</strong> ${esc(m.returnedModel)}</span>`
    + `<span><strong>Prompt version</strong> ${esc(m.promptVersion)}</span>`
    + `<span><strong>Prompt hash</strong> ${esc(m.promptHash)}</span>`
    + `<span><strong>Schema hash</strong> ${esc(m.schemaHash)}</span>`
    + `<span><strong>Input tokens</strong> ${esc(m.usage?.inputTokens)}</span>`
    + `<span><strong>Cached input tokens</strong> ${esc(m.usage?.cachedInputTokens ?? "n/a")}</span>`
    + `<span><strong>Output tokens</strong> ${esc(m.usage?.outputTokens)}</span>`
    + `<span><strong>Total tokens</strong> ${esc(m.usage?.totalTokens)}</span>`
    + `<span><strong>Latency</strong> ${esc(m.latencySeconds)}s</span>`
    + `<span><strong>Structural validation</strong> `
    + `${(m.hardFailureClaimIds?.length ?? 0) === 0 ? '<span class="badge badge-ok">pass</span>' : `<span class="badge badge-fail">${m.hardFailureClaimIds.length} hard failure(s)</span>`}</span>`
    + `<span><strong>Repair invoked</strong> ${m.repairUsed ? '<span class="badge badge-repair">yes</span>' : "no"}</span>`
    + `<span><strong>Final claim count</strong> ${esc(m.finalClaimCount)}</span>`
    + `${run.reusedFromExperiment1 ? '<span><strong>Source</strong> reused from Experiment 1</span>' : ""}`
    + `</div>`;
}

function claimsTable(run) {
  const rows = run.finalClaims.map((c) => `<tr>`
    + `<td class="col-id">${esc(c.claimId)}</td>`
    + `<td class="col-claim">${esc(c.claim)}</td>`
    + `<td class="col-grounding">${groundingCell(c.grounding, run.fixture)}</td>`
    + `<td class="col-treatment">${treatmentBadge(c.articleTreatment)}</td>`
    + `<td class="col-provenance">${c.provenance === null
      ? '<span class="provenance-null">null (article voice / no distinct external origin)</span>'
      : esc(c.provenance)}</td>`
    + `</tr>`).join("\n");
  return `<table class="claims-table">
    <thead><tr><th>claimId</th><th>claim</th><th>grounding</th><th>articleTreatment</th><th>provenance</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function targetMatchTable(run) {
  const rows = run.targetMatches.map((t) => `<tr>`
    + `<td>${esc(t.targetId)}</td>`
    + `<td>${esc(t.targetDescription)}</td>`
    + `<td>${t.present ? '<span class="badge badge-ok">present</span>'
        : t.ambiguous ? '<span class="badge badge-ambiguous">ambiguous</span>'
        : '<span class="badge badge-absent">absent</span>'}</td>`
    + `<td>${t.matchingClaimIds.concat(t.ambiguousClaimIds).map(esc).join(", ") || "—"}</td>`
    + `<td>${esc(t.reviewerNote)}</td>`
    + `</tr>`).join("\n");
  return `<table class="target-table">
    <thead><tr><th>Target ID</th><th>Target description</th><th>Present?</th><th>Matching claimId(s)</th><th>Reviewer note</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

const fixtureSections = fixtures.map((fixture) => {
  const runsForFixture = results.filter((r) => r.fixture === fixture)
    .sort((a, b) => (a.arm === b.arm ? a.repeat - b.repeat : a.arm.localeCompare(b.arm)));
  const runBlocks = runsForFixture.map((run) => `
    <div class="run-block">
      <h3>${esc(fixture)} — Prompt ${esc(run.arm)}, Repeat ${esc(run.repeat)}</h3>
      ${runMetadataBlock(run)}
      ${claimsTable(run)}
      <h4>Target comparison for this run</h4>
      ${targetMatchTable(run)}
    </div>`).join("\n");
  return `<section class="fixture-section"><h2>${esc(fixture)}</h2>${runBlocks}</section>`;
}).join("\n");

const summaryRows = targetComparison.map((t) => {
  const change = t.promptB.present > t.promptA.present ? '<span class="change-up">improved</span>'
    : t.promptB.present < t.promptA.present ? '<span class="change-down">declined</span>'
    : '<span class="change-flat">unchanged</span>';
  return `<tr><td>${esc(t.fixture)}</td><td>${esc(t.targetId)}</td><td>${esc(t.targetDescription)}</td>`
    + `<td>${t.promptA.present} of ${t.promptA.of}${t.promptA.ambiguous ? ` (+${t.promptA.ambiguous} ambiguous)` : ""}</td>`
    + `<td>${t.promptB.present} of ${t.promptB.of}${t.promptB.ambiguous ? ` (+${t.promptB.ambiguous} ambiguous)` : ""}</td>`
    + `<td>${change}</td></tr>`;
}).join("\n");

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>CF5 Prompt Experiment 2 — Proposition Independence Clarification</title>
<style>
  body { font-family: -apple-system, system-ui, sans-serif; margin: 2rem; color: #1a1a1a; line-height: 1.5; }
  h1 { border-bottom: 3px solid #333; padding-bottom: .5rem; }
  h2 { margin-top: 3rem; border-bottom: 2px solid #999; padding-bottom: .3rem; }
  h3 { margin-top: 2rem; background: #eef; padding: .5rem; border-radius: 4px; }
  h4 { margin-top: 1rem; color: #555; }
  table { border-collapse: collapse; width: 100%; margin: 1rem 0; }
  th, td { border: 1px solid #ccc; padding: .5rem; text-align: left; vertical-align: top; }
  thead th { position: sticky; top: 0; background: #333; color: #fff; z-index: 1; }
  .summary-table thead th { top: 0; }
  tbody tr:nth-child(even) { background: #f7f7f7; }
  .col-claim { min-width: 320px; max-width: 480px; white-space: normal; word-wrap: break-word; }
  .col-id { width: 4rem; }
  .col-grounding { min-width: 180px; }
  .col-treatment { width: 7rem; }
  .col-provenance { min-width: 200px; }
  .badge { display: inline-block; padding: .15rem .5rem; border-radius: 3px; font-size: .85em; font-weight: 600; color: #fff; }
  .badge-adopted { background: #2a7f2a; }
  .badge-challenged { background: #b03030; }
  .badge-reported { background: #6060b0; }
  .badge-ok { background: #2a7f2a; }
  .badge-fail { background: #b03030; }
  .badge-repair { background: #b08000; }
  .badge-ambiguous { background: #b08000; }
  .badge-absent { background: #888; }
  .provenance-null { color: #888; font-style: italic; }
  .run-meta { display: flex; flex-wrap: wrap; gap: .75rem 1.5rem; background: #f0f0f0; padding: .75rem; border-radius: 4px; margin-bottom: .75rem; font-size: .9em; }
  .run-meta span strong { display: block; font-size: .75em; color: #666; text-transform: uppercase; }
  .grounding-detail summary { cursor: pointer; color: #336; font-size: .85em; }
  .unit-excerpt { font-size: .85em; color: #444; margin: .25rem 0; padding: .25rem; background: #fafafa; border-left: 3px solid #ccc; }
  .run-block { border: 1px solid #ddd; border-radius: 6px; padding: 1rem; margin-bottom: 2rem; }
  .change-up { color: #2a7f2a; font-weight: 700; }
  .change-down { color: #b03030; font-weight: 700; }
  .change-flat { color: #888; }
  .top-summary { background: #f7f7fa; padding: 1rem; border-radius: 6px; margin-bottom: 1rem; }
  .top-summary dl { display: grid; grid-template-columns: max-content 1fr; gap: .3rem 1rem; }
  .top-summary dt { font-weight: 700; }
  code.diff { display: block; background: #222; color: #eee; padding: 1rem; border-radius: 4px; white-space: pre-wrap; }
</style>
</head>
<body>
<h1>CF5 Prompt Experiment 2 — Proposition Independence Clarification</h1>

<div class="top-summary">
<dl>
  <dt>Objective</dt><dd>${esc(runConfig.objective)}</dd>
  <dt>Exact prompt modification</dt><dd>One sentence added after the "materially different evidence...independent evidence verdicts" sentence: <em>"Two propositions are also distinct when either proposition could reasonably be true while the other is false."</em></dd>
  <dt>Model / settings</dt><dd>${esc(runConfig.model)}, reasoningEffort=${esc(runConfig.reasoningEffort)}, maxOutputTokens=${esc(runConfig.maxOutputTokensGeneration)} (generation) / ${esc(runConfig.maxOutputTokensRepair)} (repair)</dd>
  <dt>Fixtures</dt><dd>${esc(fixtures.join(", "))} (${fixtures.length} fixtures)</dd>
  <dt>Repeats per fixture per arm</dt><dd>${esc(runConfig.repeatsPerFixturePerArm)}</dd>
  <dt>Total generation runs</dt><dd>${esc(runConfig.totalGenerationRuns)} (9 reused from Experiment 1 as Prompt A, 9 run fresh as Prompt B)</dd>
  <dt>Validation-failure count</dt><dd>${validationFailures}</dd>
  <dt>Repair-call count</dt><dd>${repairsUsed}</dd>
  <dt>Recommendation status</dt><dd id="recommendation-status">see Conclusion section below</dd>
</dl>
</div>

<h2>Target comparison summary</h2>
<table class="summary-table">
<thead><tr><th>Fixture</th><th>Target ID</th><th>Target description</th><th>Prompt A</th><th>Prompt B</th><th>Change</th></tr></thead>
<tbody>
${summaryRows}
</tbody>
</table>

<h2 id="conclusion-anchor">Conclusion</h2>
<div id="conclusion-content"><!--CONCLUSION_PLACEHOLDER--></div>

${fixtureSections}

</body>
</html>`;

writeFileSync(path.join(outDir, "report.html"), html);
console.log(`Wrote target_comparison.json, report.md, report.html → ${outDir}`);
console.log(`Total runs: ${results.length}, validation failures: ${validationFailures}, repairs: ${repairsUsed}`);
