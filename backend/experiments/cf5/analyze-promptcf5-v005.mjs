#!/usr/bin/env node
// CF5 PromptCF5-v0005 blind regression — analysis pass. Reuses targetMatching.js and
// regressionAnalysis.js unmodified (no code changes, per this experiment's
// constraints). Only 1 repeat per fixture per version — exactTextStability and
// targetBasedStability naturally degrade to "not computable" / "single-run presence"
// respectively when given a single repeat; this is not special-cased, it is the
// existing functions' honest behavior with n=1.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { matchTargetsForRun, loadGoldTargets } from "./targetMatching.js";
import {
  findNearDuplicates, findPossiblyCompound, cruxPrecisionProxy,
  exactTextStability, targetBasedStability,
} from "./regressionAnalysis.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../..");
const outDir = path.resolve(root, "artifacts/claim-foundry/cf5-promptcf5-v005");

const results = JSON.parse(readFileSync(path.join(outDir, "results.json"), "utf8"));
const fixtures = [...new Set(results.map((r) => r.fixture))];
const versions = [...new Set(results.map((r) => r.promptVersion))];
const gold = loadGoldTargets(root);

for (const run of results) {
  run.targetMatches = matchTargetsForRun(run.fixture, run.finalClaims, root);
  run.nearDuplicates = findNearDuplicates(run.finalClaims);
  run.possiblyCompound = findPossiblyCompound(run.finalClaims);
  run.cruxPrecision = cruxPrecisionProxy(run.fixture, run.finalClaims, root);
}

const cells = [];
for (const fixture of fixtures) {
  for (const version of versions) {
    const runs = results.filter((r) => r.fixture === fixture && r.promptVersion === version);
    const run = runs[0]; // exactly one repeat per (fixture, version) in this experiment
    const targetIds = Object.keys(gold[fixture] ?? {});
    const cruxHits = run.targetMatches.filter((t) => t.present).length;
    cells.push({
      fixture, promptVersion: version,
      repeatCount: 1,
      claimCount: run.finalClaims.length,
      duplicateRate: run.finalClaims.length ? Math.round((run.nearDuplicates.length / run.finalClaims.length) * 1000) / 1000 : 0,
      compoundRate: run.finalClaims.length ? Math.round((run.possiblyCompound.length / run.finalClaims.length) * 1000) / 1000 : 0,
      cruxPrecisionProxy: Math.round(run.cruxPrecision.precision * 1000) / 1000,
      cruxRecall: `${cruxHits} of ${targetIds.length}`,
      exactTextStability: exactTextStability([run.finalClaims]), // null with n=1, by design
      targetPresence: targetBasedStability(fixture, [run.finalClaims], root),
      hardFailures: run.manifest.hardFailureClaimIds?.length ?? 0,
      repairUsed: run.manifest.repairUsed,
    });
  }
}

writeFileSync(path.join(outDir, "results.json"), JSON.stringify(results, null, 2));
writeFileSync(path.join(outDir, "analysis.json"), JSON.stringify({
  fixtures, versions, cells,
  stabilityNote: "Only 1 repeat per (fixture, version) in this experiment — "
    + "run-to-run stability cannot be computed and is not fabricated here. "
    + "exactTextStability is null by design (regressionAnalysis.js's existing, "
    + "unmodified behavior with a single repeat). targetPresence reports whether each "
    + "crux appeared in this one run, not a stability measure across repeats.",
}, null, 2));

console.log(`Wrote analysis.json → ${outDir}`);
for (const c of cells) {
  console.log(`  ${c.fixture} ${c.promptVersion}: claims=${c.claimCount} dupRate=${c.duplicateRate} `
    + `compoundRate=${c.compoundRate} cruxPrecision=${c.cruxPrecisionProxy} cruxRecall=${c.cruxRecall}`);
}
