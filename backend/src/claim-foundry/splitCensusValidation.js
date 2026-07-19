// Census mint-consistency verification for the Call-1 split arm
// (pipeline-y-canonical-relation-split-v1, Host Step, runs between Call 1B and
// finalize). The JSON schema cannot express a cross-array referential constraint, so
// the host enforces it: every censusOutcome with outcome "mint" MUST have a matching
// mintedClaims entry by censusId, and every mintedClaims entry MUST correspond to a
// "mint" outcome. A violation is a repairable verification failure — the split
// run fails loudly rather than silently accepting a recall surface that produced
// nothing (the 60-mint / 0-minted-claim pattern seen in split-20260718-eeda3e).
import { Cf1Error } from "./errors.js";

export function assertCensusMintConsistency(call1bOutput = {}) {
  const outcomes = call1bOutput.censusOutcomes ?? [];
  const minted = call1bOutput.mintedClaims ?? [];
  const mintedIds = new Set(minted.map((m) => m.censusId));
  const mintOutcomeIds = new Set(
    outcomes.filter((o) => o.outcome === "mint").map((o) => o.censusId));

  const mintWithoutClaim = [...mintOutcomeIds].filter((id) => !mintedIds.has(id));
  const claimWithoutMint = minted.map((m) => m.censusId).filter((id) => !mintOutcomeIds.has(id));

  if (mintWithoutClaim.length || claimWithoutMint.length) {
    const error = new Cf1Error("CF1_SPLIT_CENSUS_MINT_WITHOUT_CLAIM",
      "Census mint outcomes and minted claims are not one-to-one",
      { status: 422, retryable: true });
    // Cf1Error does not persist an options.details bag, so attach it to the instance
    // for the runner/report to show which census ids broke the pairing.
    error.details = { mintOutcomes: mintOutcomeIds.size, mintedClaims: mintedIds.size,
      mintWithoutClaim, claimWithoutMint };
    throw error;
  }
}

export function assertCensusOutcomeCoverage(censusItems = [], call1bOutput = {}) {
  const expected = new Set(censusItems.map((item) => item.censusId));
  const actual = (call1bOutput.censusOutcomes ?? []).map((item) => item.censusId);
  const counts = actual.reduce((map, id) => map.set(id, (map.get(id) ?? 0) + 1), new Map());
  const missing = [...expected].filter((id) => !counts.has(id));
  const duplicates = [...counts].filter(([, count]) => count !== 1).map(([id]) => id);
  const unknown = actual.filter((id) => !expected.has(id));
  if (missing.length || duplicates.length || unknown.length) {
    const error = new Cf1Error("CF1_SPLIT_CENSUS_INCOMPLETE", "Every census packet must have exactly one outcome", { status: 422, retryable: true });
    error.details = { missing, duplicates, unknown }; throw error;
  }
}
