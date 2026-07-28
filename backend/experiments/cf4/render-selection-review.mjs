#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../..");
const selectionRoot = path.join(root,
  "artifacts/claim-foundry/cf4/phase2-selection");
const oldRun = path.join(root,
  "artifacts/claim-foundry/cf4/deterministic-phase1/20260725-combined-fix");
const cleanRun = path.join(root,
  "artifacts/claim-foundry/cf4/deterministic-phase1/20260726-s1-short-proper-name-v3");
const out = path.resolve(process.argv[2] ?? path.join(selectionRoot,
  "review-20260726"));

const read = (file) => JSON.parse(readFileSync(file, "utf8"));
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[char]);
const words = (text) => new Set(String(text).toLowerCase()
  .match(/[a-z0-9]+/g)?.filter((word) => word.length > 2) ?? []);
const similarity = (left, right) => {
  const a = words(left);
  const b = words(right);
  const intersection = [...a].filter((word) => b.has(word)).length;
  return intersection / Math.max(1, a.size + b.size - intersection);
};
const fixtures = ["CF1-F02", "CF1-F03", "CF1-F06"];
const score = read(path.join(oldRun, "score-gate-cap3.json"));
const scoreByFixture = new Map(score.fixtures.map((row) => [row.fixtureId, row]));

const results = fixtures.map((fixtureId) => {
  const suffix = fixtureId.toLowerCase().replace("cf1-", "");
  const dir = path.join(selectionRoot, `crux-cf1-${suffix}`);
  const repeats = [1, 2, 3, 4, 5].map((index) =>
    read(path.join(dir, `selection_repeat${index}.json`)));
  const stance = read(path.join(dir, "stance_anchor.json"));
  const oldCandidates = read(path.join(
    oldRun, fixtureId, "s3_candidates.json")).candidates;
  const cleanCandidates = read(path.join(
    cleanRun, fixtureId, "s3_candidates.json")).candidates;
  const oldById = new Map(oldCandidates.map((row) => [row.candidateId, row]));
  const counts = new Map();
  repeats.forEach((repeat, repeatIndex) => {
    repeat.selectedAssertionIds.forEach((id) => {
      const current = counts.get(id) ?? { count: 0, repeats: [] };
      current.count += 1;
      current.repeats.push(repeatIndex + 1);
      counts.set(id, current);
    });
  });
  const selected = [...counts].map(([id, frequency]) => {
    const candidate = oldById.get(id);
    const units = new Set(candidate?.groundingUnitIds ?? []);
    const alternatives = cleanCandidates.filter((row) =>
      row.groundingUnitIds.some((unit) => units.has(unit)));
    const clean = alternatives.map((row) => ({
      ...row, match: similarity(candidate?.assertionText, row.assertionText),
    })).sort((a, b) => b.match - a.match)[0];
    return { id, ...frequency, candidate,
      clean: clean?.match >= 0.35 ? clean : null };
  }).sort((a, b) => b.count - a.count || a.id.localeCompare(b.id));
  const gold = read(path.join(root,
    `backend/experiments/cf4/gold/${fixtureId}.gold.json`)).assertions;
  const matches = new Map(scoreByFixture.get(fixtureId).matches.map(
    (row) => [row.goldId, row]));
  const crux = gold.filter((row) => row.crux).map((row) => {
    const match = matches.get(row.goldId);
    const mappedIds = [...new Set([
      match?.bestCandidateId, ...(match?.unionMemberCandidateIds ?? []),
    ].filter(Boolean))];
    const perRepeat = repeats.map((repeat) =>
      mappedIds.some((id) => repeat.selectedAssertionIds.includes(id)));
    return { ...row, mappedIds, selectedRepeats:
      perRepeat.flatMap((hit, index) => hit ? [index + 1] : []) };
  });
  return {
    fixtureId, stance, repeats, selected, crux,
    inventoryCount: oldCandidates.length,
    cleanInventoryCount: cleanCandidates.length,
  };
});

const lines = [
  "# CF4 Phase 2 selection review",
  "",
  "Generated 2026-07-26. This packet reviews Claude's five-repeat S6 runs.",
  "",
  "> **Input warning:** These S6 calls used the 20260725-combined-fix inventories,",
  "> which contain the over-long coreference replacements subsequently fixed.",
  "> The clean 20260726 S1 inventories have not been passed through S6.",
  "> Cleaned surfaces below are comparison mappings, not model inputs.",
  "",
];
for (const fixture of results) {
  const stable = fixture.selected.filter((row) => row.count >= 4).length;
  lines.push(`## ${fixture.fixtureId}`, "",
    `**Stance:** ${fixture.stance.stanceAnchor}`, "",
    `Inventory: ${fixture.inventoryCount}; clean rerun: ${fixture.cleanInventoryCount}; `
      + `unique selected: ${fixture.selected.length}; stable ≥4/5: ${stable}.`, "",
    "### Crux overlay", "",
    "| Gold | Assertion | Mapped candidates | Selected repeats | Stable 4/5? |",
    "|---|---|---|---|---|");
  fixture.crux.forEach((gold) => lines.push(
    `| ${gold.goldId} | ${gold.testableAssertion} | ${gold.mappedIds.join(", ")} `
    + `| ${gold.selectedRepeats.join(", ") || "none"} `
    + `| ${gold.selectedRepeats.length >= 4 ? "YES" : "NO"} |`));
  lines.push("", "### Selections", "",
    "| Frequency | Candidate | Original model-visible assertion | Clean comparison | Units |",
    "|---:|---|---|---|---|");
  fixture.selected.forEach((row) => lines.push(
    `| ${row.count}/5 | ${row.id} | ${row.candidate?.assertionText ?? "missing"} `
    + `| ${row.clean?.assertionText ?? "No safe automatic mapping"} `
    + `| ${(row.candidate?.groundingUnitIds ?? []).join(", ")} |`));
  lines.push("");
}

const sections = results.map((fixture) => {
  const repeatCounts = fixture.repeats.map((repeat, index) =>
    `<span>R${index + 1}: <b>${repeat.selectedAssertionIds.length}</b></span>`).join("");
  const cruxRows = fixture.crux.map((gold) => `<tr>
    <td><b>${gold.goldId}</b></td><td>${esc(gold.testableAssertion)}</td>
    <td><code>${esc(gold.mappedIds.join(", "))}</code></td>
    <td>${esc(gold.selectedRepeats.join(", ") || "none")}</td>
    <td class="${gold.selectedRepeats.length >= 4 ? "pass" : "fail"}">
      ${gold.selectedRepeats.length >= 4 ? "PASS" : "MISS"}</td></tr>`).join("");
  const selectedRows = fixture.selected.map((row) => `<tr>
    <td><span class="freq f${row.count}">${row.count}/5</span></td>
    <td><code>${row.id}</code></td>
    <td>${esc(row.candidate?.assertionText ?? "missing")}</td>
    <td>${row.clean ? esc(row.clean.assertionText) :
      '<span class="muted">No safe automatic mapping</span>'}</td>
    <td><code>${esc((row.candidate?.groundingUnitIds ?? []).join(", "))}</code></td>
    </tr>`).join("");
  const usage = fixture.repeats.reduce((sum, row) => ({
    input: sum.input + (row.usage?.inputTokens ?? 0),
    output: sum.output + (row.usage?.outputTokens ?? 0),
  }), { input: 0, output: 0 });
  return `<section><h2>${fixture.fixtureId}</h2>
    <div class="stance"><b>Stance anchor</b>${esc(fixture.stance.stanceAnchor)}</div>
    <div class="metrics"><span>Old inventory <b>${fixture.inventoryCount}</b></span>
      <span>Clean inventory <b>${fixture.cleanInventoryCount}</b></span>${repeatCounts}
      <span>S6 tokens <b>${usage.input + usage.output}</b></span></div>
    <h3>Crux overlay</h3><table><thead><tr><th>Gold</th><th>Assertion</th>
      <th>Mapped IDs</th><th>Selected repeats</th><th>4/5 gate</th></tr></thead>
      <tbody>${cruxRows}</tbody></table>
    <h3>All selected assertions across five repeats</h3>
    <table><thead><tr><th>Frequency</th><th>ID</th><th>Model-visible assertion</th>
      <th>Clean comparison</th><th>Units</th></tr></thead><tbody>${selectedRows}</tbody></table>
    </section>`;
}).join("");

const html = `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>CF4 Phase 2 selection review</title><style>
:root{color-scheme:light;background:#f4f2ed;color:#17201f;font:15px/1.45 Inter,system-ui}
body{margin:0}main{max-width:1500px;margin:auto;padding:32px}h1{margin-bottom:6px}
h2{margin-top:0;font-size:26px}h3{margin-top:28px}.warning{background:#fff2cc;
border-left:5px solid #d39b00;padding:16px 18px;margin:22px 0}.stance{background:#e8f0ee;
padding:14px 16px;border-radius:8px}.stance b{display:block;font-size:12px;
text-transform:uppercase;color:#52615f}.metrics{display:flex;gap:8px;flex-wrap:wrap;margin:14px 0}
.metrics span{background:white;border:1px solid #d9ddda;border-radius:99px;padding:6px 11px}
section{background:#fff;padding:24px;margin:24px 0;border:1px solid #d9ddda;border-radius:12px;
box-shadow:0 2px 8px #0000000b;overflow:auto}table{border-collapse:collapse;width:100%;font-size:13px}
th{text-align:left;background:#263b38;color:white;position:sticky;top:0}th,td{padding:9px;
border:1px solid #dfe3e1;vertical-align:top}tr:nth-child(even) td{background:#f7f8f7}
code{white-space:nowrap}.pass{color:#087443;font-weight:800}.fail{color:#b52626;font-weight:800}
.freq{display:inline-block;border-radius:99px;padding:3px 8px;font-weight:800;background:#eee}
.f5,.f4{background:#d7f3e3;color:#075b34}.f1,.f2{background:#fce1df;color:#8d211b}
.muted{color:#7a8380;font-style:italic}.small{color:#59625f}a{color:#075f54}
</style></head><body><main><h1>CF4 Phase 2 selection review</h1>
<p class="small">Five-repeat S6 results for F02, F03 and F06 · generated 2026-07-26</p>
<div class="warning"><b>Input provenance warning.</b> These are Claude’s existing S6
selections over <code>20260725-combined-fix</code>, whose model-visible inventory includes
the over-long coreference corruption. The “clean comparison” column is mapped from
<code>20260726-s1-short-proper-name-v3</code>; it was <b>not</b> supplied to S6. A clean
S6 rerun is still required before treating these selections as final.</div>
${sections}</main></body></html>`;

mkdirSync(out, { recursive: true });
writeFileSync(path.join(out, "report.md"), `${lines.join("\n")}\n`);
writeFileSync(path.join(out, "report.html"), html);
console.log(out);
