#!/usr/bin/env node
// CF5 minimal vertical slice — automated portion of the defect catalog (Task 9).
// Computes the quantitative/structural facts a script can determine without semantic
// judgment: claim counts, structural validation outcomes, repair usage, exact-duplicate
// counts, and cross-run instability (claim-text overlap across the 5 repeats per
// fixture). Semantic defects (missing essential propositions, incorrect treatment,
// misleading provenance, atomicity judgment) require a human/reviewer pass and are
// appended separately, not computed here.
import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";

const option = (name, fallback = null) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
};
const sweepDir = path.resolve(option("--sweep-dir", process.argv[2]));
if (!sweepDir) throw new Error("--sweep-dir <path to sweep output> is required");

function normalizeText(text) {
  return String(text ?? "").toLowerCase().replace(/[^\w\s]/g, " ").split(/\s+/).filter(Boolean).join(" ");
}

function jaccard(setA, setB) {
  const intersection = [...setA].filter((x) => setB.has(x)).length;
  const union = new Set([...setA, ...setB]).size;
  return union === 0 ? 1 : intersection / union;
}

const fixtureDirs = readdirSync(sweepDir).filter((name) =>
  existsSync(path.join(sweepDir, name, "source-units.json")));

const report = { schemaVersion: "cf5.defectCatalog.automated.v1", sweepDir, fixtures: [] };

for (const fixtureName of fixtureDirs.sort()) {
  const fixtureDir = path.join(sweepDir, fixtureName);
  const repeatDirs = readdirSync(fixtureDir)
    .filter((name) => name.startsWith("repeat"))
    .sort((a, b) => Number(a.replace("repeat", "")) - Number(b.replace("repeat", "")));

  const repeats = [];
  const claimTextSets = [];
  for (const repeatName of repeatDirs) {
    const repeatDir = path.join(fixtureDir, repeatName);
    const manifestPath = path.join(repeatDir, "run-manifest.json");
    if (!existsSync(manifestPath)) {
      repeats.push({ repeat: repeatName, status: "missing_manifest" });
      continue;
    }
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    let finalClaims = [];
    let validationReport = null;
    const finalClaimsPath = path.join(repeatDir, "final-claims.json");
    if (existsSync(finalClaimsPath)) finalClaims = JSON.parse(readFileSync(finalClaimsPath, "utf8"));
    const validationPath = path.join(repeatDir, "validation-report.json");
    if (existsSync(validationPath)) validationReport = JSON.parse(readFileSync(validationPath, "utf8"));

    const normalizedSet = new Set(finalClaims.map((c) => normalizeText(c.claim)));
    claimTextSets.push(normalizedSet);

    const treatmentCounts = {};
    for (const c of finalClaims) treatmentCounts[c.articleTreatment] = (treatmentCounts[c.articleTreatment] ?? 0) + 1;
    const nullProvenanceCount = finalClaims.filter((c) => c.provenance === null).length;

    repeats.push({
      repeat: repeatName,
      status: manifest.status,
      repairUsed: manifest.repairUsed,
      claimCount: finalClaims.length,
      treatmentCounts,
      nullProvenanceCount,
      externalProvenanceCount: finalClaims.length - nullProvenanceCount,
      structuralFindingCodes: [...new Set((validationReport?.finalFindings ?? []).map((f) => f.code))],
      usage: manifest.usage ?? null,
    });
  }

  // Cross-run instability: pairwise Jaccard similarity of normalized claim text sets
  // across the 5 repeats. Low similarity = high instability.
  const pairwiseSimilarities = [];
  for (let i = 0; i < claimTextSets.length; i += 1) {
    for (let j = i + 1; j < claimTextSets.length; j += 1) {
      pairwiseSimilarities.push(jaccard(claimTextSets[i], claimTextSets[j]));
    }
  }
  const meanSimilarity = pairwiseSimilarities.length
    ? pairwiseSimilarities.reduce((a, b) => a + b, 0) / pairwiseSimilarities.length
    : null;

  report.fixtures.push({
    fixture: fixtureName,
    repeatCount: repeats.length,
    repeats,
    crossRunInstability: {
      meanPairwiseJaccardSimilarity: meanSimilarity,
      note: "1.0 = identical claim sets every run; lower = more cross-run variance in what gets generated",
    },
  });
}

const outPath = path.join(sweepDir, "cf5-minimal-defect-catalog-automated.json");
writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(`Automated defect catalog → ${outPath}`);
for (const fixture of report.fixtures) {
  const counts = fixture.repeats.map((r) => r.claimCount ?? "?").join(",");
  const repairs = fixture.repeats.filter((r) => r.repairUsed).length;
  console.log(`  ${fixture.fixture}: claim counts [${counts}] · repairs used: ${repairs}/${fixture.repeatCount} `
    + `· mean cross-run similarity: ${fixture.crossRunInstability.meanPairwiseJaccardSimilarity?.toFixed(2)}`);
}
