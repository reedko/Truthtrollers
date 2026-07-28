#!/usr/bin/env node
// CF5 PromptCF5-v0006 blind regression — analysis pass. Reuses targetMatching.js and
// regressionAnalysis.js unmodified (no code changes, per this experiment's
// constraints). v0001 has 1 repeat (reused baseline, as in every prior experiment this
// cycle) and v0006 has 2 repeats (per the user's explicit request) — repeat counts are
// intentionally asymmetric across versions and each cell reports its own repeatCount.
// exactTextStability/targetBasedStability are honestly null for v0001 (n=1, existing
// unmodified behavior) and computable for v0006 (n=2).
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
const outDir = path.resolve(root, "artifacts/claim-foundry/cf5-promptcf5-v006");

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
    const runs = results.filter((r) => r.fixture === fixture && r.promptVersion === version)
      .sort((a, b) => a.repeat - b.repeat);
    const claimCounts = runs.map((r) => r.finalClaims.length);
    const avgClaimCount = claimCounts.reduce((a, b) => a + b, 0) / claimCounts.length;
    const totalNearDuplicates = runs.reduce((sum, r) => sum + r.nearDuplicates.length, 0);
    const totalCompound = runs.reduce((sum, r) => sum + r.possiblyCompound.length, 0);
    const totalClaims = runs.reduce((sum, r) => sum + r.finalClaims.length, 0);
    const avgPrecision = runs.reduce((sum, r) => sum + r.cruxPrecision.precision, 0) / runs.length;
    const targetIds = Object.keys(gold[fixture] ?? {});
    const cruxHitsPerRun = runs.map((r) => r.targetMatches.filter((t) => t.present).length);
    const totalCruxSlots = targetIds.length * runs.length;
    const totalCruxHits = cruxHitsPerRun.reduce((a, b) => a + b, 0);
    cells.push({
      fixture, promptVersion: version,
      repeatCount: runs.length,
      avgClaimCount: Math.round(avgClaimCount * 10) / 10,
      claimCounts,
      duplicateRate: totalClaims ? Math.round((totalNearDuplicates / totalClaims) * 1000) / 1000 : 0,
      compoundRate: totalClaims ? Math.round((totalCompound / totalClaims) * 1000) / 1000 : 0,
      cruxPrecisionProxyAvg: Math.round(avgPrecision * 1000) / 1000,
      cruxRecall: `${totalCruxHits} of ${totalCruxSlots}`,
      exactTextStability: exactTextStability(runs.map((r) => r.finalClaims)), // null with n=1, by design
      targetBasedStability: targetBasedStability(fixture, runs.map((r) => r.finalClaims), root),
      hardFailures: runs.reduce((sum, r) => sum + (r.manifest.hardFailureClaimIds?.length ?? 0), 0),
      repairsUsed: runs.filter((r) => r.manifest.repairUsed).length,
    });
  }
}

writeFileSync(path.join(outDir, "results.json"), JSON.stringify(results, null, 2));
writeFileSync(path.join(outDir, "analysis.json"), JSON.stringify({
  fixtures, versions, cells,
  stabilityNote: "PromptCF5-v0001 has 1 repeat per fixture (reused baseline, consistent "
    + "with every prior experiment this cycle) — its exactTextStability/"
    + "targetBasedStability are null/single-run by design, not computed as if reliable. "
    + "PromptCF5-v0006 has 2 repeats per fixture — its stability figures are computed "
    + "from 2 runs, which is enough to see gross disagreement but not enough to call a "
    + "rate reliable.",
}, null, 2));

console.log(`Wrote analysis.json → ${outDir}`);
for (const c of cells) {
  console.log(`  ${c.fixture} ${c.promptVersion}: avgClaims=${c.avgClaimCount} dupRate=${c.duplicateRate} `
    + `compoundRate=${c.compoundRate} cruxPrecision=${c.cruxPrecisionProxyAvg} cruxRecall=${c.cruxRecall} `
    + `exactTextStability=${c.exactTextStability}`);
}
