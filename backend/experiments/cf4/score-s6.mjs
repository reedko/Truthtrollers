#!/usr/bin/env node
// CF4 Phase 2 §7 eval — the crux-overlay gate. For each crux-flagged gold row that
// Phase 1 already recalled (extraction is not being re-tested here), checks whether the
// candidate ID(s) that cover it survive S6 selection. Reports per-fixture coverage and,
// across repeats, per-crux stability (spec requires >=4/5).
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const option = (name, fallback = null) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
};

const fixture = option("--fixture", "CF1-F03");
const phase1ScorePath = option("--phase1-score", null);
const selectionDir = option("--selection-dir", null);
const goldDir = option("--gold-dir", null);
const phase1RunDir = option("--phase1-run", null);
if (!phase1ScorePath || !selectionDir || !goldDir || !phase1RunDir) {
  throw new Error("--phase1-score, --selection-dir, --gold-dir, and --phase1-run are required");
}

const phase1Score = JSON.parse(readFileSync(path.resolve(phase1ScorePath), "utf8"));
const fixtureScore = phase1Score.fixtures.find((f) => f.fixtureId === fixture);
if (!fixtureScore) throw new Error(`No Phase 1 score entry for ${fixture}`);

// Optional: candidate text lookup, for the "which candidate realized the crux, and how
// complete is it" report (CF4_WEAK_CRUX_REALIZATION — informational, not a gate).
const candidatesArtifact = JSON.parse(readFileSync(
  path.join(path.resolve(phase1RunDir), fixture, "s3_candidates.json"), "utf8"));
const candidateText = new Map(
  candidatesArtifact.candidates.map((candidate) =>
    [candidate.candidateId, candidate.assertionText]));
if (fixtureScore.candidateCount !== candidatesArtifact.candidates.length) {
  throw new Error(`CF4_EVAL_INVENTORY_MISMATCH: score has ${fixtureScore.candidateCount} `
    + `candidates; inventory has ${candidatesArtifact.candidates.length}`);
}
const wordCount = (text) => (text ?? "").trim().split(/\s+/).filter(Boolean).length;

const cruxRows = fixtureScore.matches.filter((m) => m.crux);
const coverage = new Map(cruxRows.map((m) => [
  m.goldId,
  {
    goldId: m.goldId,
    testableAssertion: m.testableAssertion,
    extractionRecalled: m.recalled,
    coveringCandidateIds: new Set(
      [m.bestCandidateId, ...(m.unionMemberCandidateIds ?? [])].filter(Boolean),
    ),
  },
]));
for (const info of coverage.values()) {
  const ids = [...info.coveringCandidateIds];
  const missing = ids.filter((id) => !candidateText.has(id));
  if (missing.length) {
    throw new Error(`CF4_EVAL_INVENTORY_MISMATCH: missing candidate IDs ${missing.join(",")}`);
  }
  const withText = ids.map((id) => ({ id, text: candidateText.get(id) ?? null }));
  info.covering = withText;
  info.longestCoveringId = withText.length
    ? withText.reduce((a, b) => (wordCount(b.text) > wordCount(a.text) ? b : a)).id
    : null;
}

const selectionFiles = readdirSync(path.resolve(selectionDir))
  .filter((name) => name.startsWith("selection_repeat") && name.endsWith(".json"))
  .sort();
if (!selectionFiles.length) throw new Error(`No selection_repeatN.json files in ${selectionDir}`);

const perCruxHits = new Map([...coverage.keys()].map((id) => [id, 0]));
const perCruxRealizations = new Map([...coverage.keys()].map((id) => [id, []]));
let repeatCount = 0;
for (const file of selectionFiles) {
  const selection = JSON.parse(readFileSync(path.join(path.resolve(selectionDir), file), "utf8"));
  if (!Array.isArray(selection.stanceAssertions)
      || !selection.stanceAssertions.length) {
    throw new Error(`${file} does not contain the stance-assertion array`);
  }
  for (const stance of selection.stanceAssertions) {
    if (!selection.prompt?.user?.includes(stance.stanceId)
        || !selection.prompt.user.includes(stance.assertionText)) {
      throw new Error(`${file} selection prompt omitted stance ${stance.stanceId}`);
    }
  }
  const selected = new Set(selection.selectedAssertionIds ?? []);
  repeatCount += 1;
  for (const [goldId, info] of coverage) {
    const realizedBy = [...info.coveringCandidateIds].filter((id) => selected.has(id));
    if (realizedBy.length) {
      perCruxHits.set(goldId, perCruxHits.get(goldId) + 1);
      perCruxRealizations.get(goldId).push({ repeat: repeatCount, realizedBy });
    }
  }
}

const stabilityThreshold = Math.ceil(repeatCount * 0.8);
const gateable = [...coverage.values()].filter((c) => c.extractionRecalled);
console.log(`CF4 S6 crux-overlay eval · ${fixture} · ${repeatCount} repeats`);
console.log(`Total cruxes: ${coverage.size} (extraction-recalled and gate-eligible: ${gateable.length})`);
let stableCount = 0;
const weakRealizationFindings = [];
for (const [goldId, info] of coverage) {
  const hits = perCruxHits.get(goldId);
  const stable = hits >= stabilityThreshold;
  if (stable && info.extractionRecalled) stableCount += 1;
  const flag = info.extractionRecalled ? "" : " [NOT EXTRACTED — Phase 1 gap, excluded from gate]";
  console.log(`  ${goldId}: selected ${hits}/${repeatCount}${stable ? "" : " UNSTABLE"}`
    + `${flag} :: ${info.testableAssertion}`);
  if (candidateText.size && info.covering.length > 1) {
    const longestWords = wordCount(candidateText.get(info.longestCoveringId));
    for (const { repeat, realizedBy } of perCruxRealizations.get(goldId)) {
      for (const id of realizedBy) {
        const text = candidateText.get(id);
        const weak = id !== info.longestCoveringId && wordCount(text) < longestWords * 0.7;
        console.log(`    repeat ${repeat}: realized by ${id}${weak ? " [CF4_WEAK_CRUX_REALIZATION]" : ""} `
          + `:: ${text}`);
        if (weak) {
          weakRealizationFindings.push({
            goldId, repeat, realizedBy: id, realizedByText: text,
            availableStrongerId: info.longestCoveringId,
            availableStrongerText: candidateText.get(info.longestCoveringId),
          });
        }
      }
    }
  }
}
if (weakRealizationFindings.length) {
  console.log(`\nCF4_WEAK_CRUX_REALIZATION: ${weakRealizationFindings.length} occurrence(s) — `
    + `a weaker fragment was selected over an available fuller candidate covering the same crux `
    + `(informational, not a gate).`);
}
console.log(`Stable crux coverage: ${stableCount}/${gateable.length} gate-eligible cruxes `
  + `(>=${stabilityThreshold}/${repeatCount} repeats)`);
console.log(gateable.length && stableCount === gateable.length ? "GATE: PASS" : "GATE: FAIL");
