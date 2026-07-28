// CF5 regression analysis — report-only heuristics for blind prompt-version
// comparisons. Deliberately NOT part of validation.js: these are review-support
// signals for review.html, not deterministic hard checks the canonical pipeline
// enforces (per the v3 architecture's "no deterministic semantic validation of
// atomicity/duplication" rule). Every function here is a clearly-labeled proxy —
// none of them should be read as ground truth without the row-level inspection
// review.html exists to enable.
import { matchTargetsForRun, loadGoldTargets } from "./targetMatching.js";

function normalize(text) {
  return String(text ?? "").toLowerCase().replace(/[^\w\s]/g, " ").split(/\s+/).filter(Boolean).join(" ");
}

function wordOverlapRatio(a, b) {
  const wa = new Set(normalize(a).split(" "));
  const wb = new Set(normalize(b).split(" "));
  if (!wa.size || !wb.size) return 0;
  let intersection = 0;
  for (const w of wa) if (wb.has(w)) intersection += 1;
  return intersection / Math.min(wa.size, wb.size);
}

// Near-duplicate heuristic: word-overlap > threshold, both claims longer than
// minWords (filters the short-claim false-positive pattern found in Experiment 1/2 —
// e.g. "The Great Barrier Reef of Australia is dead." spuriously overlapping many
// unrelated longer claims that happen to share those common words).
export function findNearDuplicates(claims, { threshold = 0.6, minWords = 6 } = {}) {
  const flagged = [];
  for (let i = 0; i < claims.length; i += 1) {
    for (let j = i + 1; j < claims.length; j += 1) {
      const a = claims[i], b = claims[j];
      const wa = normalize(a.claim).split(" ").length;
      const wb = normalize(b.claim).split(" ").length;
      if (wa < minWords || wb < minWords) continue;
      const overlap = wordOverlapRatio(a.claim, b.claim);
      if (overlap > threshold) flagged.push({ a: a.claimId, b: b.claimId, overlap: Math.round(overlap * 100) / 100 });
    }
  }
  return flagged;
}

// Compound-claim heuristic: crude word-count/conjunction-count proxy, same shape as
// the one used in Development Task 1's defect catalog. Explicitly NOT an atomicity
// judgment — flags candidates for human review, nothing more.
export function findPossiblyCompound(claims, { maxWords = 40, maxConjunctions = 1 } = {}) {
  return claims
    .map((c) => {
      const wordCount = normalize(c.claim).split(" ").filter(Boolean).length;
      const conjunctionCount = (c.claim.match(/\band\b/gi) ?? []).length;
      return { claimId: c.claimId, wordCount, conjunctionCount };
    })
    .filter((c) => c.wordCount > maxWords || c.conjunctionCount > maxConjunctions);
}

// Crux-matching precision proxy: fraction of a run's claims that match at least one
// gold crux target. This is NOT full-gold precision (only crux-flagged gold rows have
// matching patterns built — see targetMatching.js) — labeled explicitly as a proxy
// scoped to cruxes, not the complete gold set.
export function cruxPrecisionProxy(fixture, claims, root) {
  const matches = matchTargetsForRun(fixture, claims, root);
  const matchedClaimIds = new Set(matches.flatMap((t) => t.matchingClaimIds));
  return {
    matchedClaimCount: matchedClaimIds.size,
    totalClaimCount: claims.length,
    precision: claims.length ? matchedClaimIds.size / claims.length : 0,
    scope: "crux-only proxy — matched against gold cruxes only, not the complete gold assertion set",
  };
}

// Exact-text stability across repeats: pairwise Jaccard similarity of normalized claim
// text. Known to understate true semantic stability (paraphrasing across independent
// calls reads as instability under exact-text matching) — see Experiment 1's defect
// catalog finding. Report alongside target-based stability, never alone.
export function exactTextStability(repeatsOfClaims) {
  const sets = repeatsOfClaims.map((claims) => new Set(claims.map((c) => normalize(c.claim))));
  const sims = [];
  for (let i = 0; i < sets.length; i += 1) {
    for (let j = i + 1; j < sets.length; j += 1) {
      const inter = [...sets[i]].filter((x) => sets[j].has(x)).length;
      const union = new Set([...sets[i], ...sets[j]]).size;
      sims.push(union === 0 ? 1 : inter / union);
    }
  }
  return sims.length ? sims.reduce((a, b) => a + b, 0) / sims.length : null;
}

// Target-based stability: for each gold crux, the fraction of repeats (out of N) where
// it was present. More meaningful than exact-text Jaccard for judging whether a prompt
// reliably recovers the same content, since it tolerates paraphrasing.
export function targetBasedStability(fixture, repeatsOfClaims, root) {
  const gold = loadGoldTargets(root);
  const targetIds = Object.keys(gold[fixture] ?? {});
  const hitsPerTarget = {};
  for (const targetId of targetIds) hitsPerTarget[targetId] = 0;
  for (const claims of repeatsOfClaims) {
    const matches = matchTargetsForRun(fixture, claims, root);
    for (const m of matches) if (m.present) hitsPerTarget[m.targetId] += 1;
  }
  const n = repeatsOfClaims.length;
  return targetIds.map((targetId) => ({
    targetId, targetDescription: gold[fixture][targetId],
    hits: hitsPerTarget[targetId], of: n,
  }));
}
