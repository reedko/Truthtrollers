import test from "node:test";
import assert from "node:assert/strict";
import { assertCensusMintConsistency } from "../../src/claim-foundry/splitCensusValidation.js";

test("accepts a one-to-one mint / mintedClaims pairing", () => {
  assert.doesNotThrow(() => assertCensusMintConsistency({
    censusOutcomes: [
      { censusId: "CEN001", outcome: "mint" },
      { censusId: "CEN002", outcome: "duplicate", duplicateOfCandidateId: "CAND01" },
      { censusId: "CEN003", outcome: "no_proposition" },
    ],
    mintedClaims: [{ censusId: "CEN001", claimText: "P" }],
  }));
});

test("rejects the exact split-20260718-eeda3e pattern: many mint outcomes, zero minted claims", () => {
  const censusOutcomes = Array.from({ length: 60 }, (_, i) => ({
    censusId: `CEN${String(i + 1).padStart(3, "0")}`, outcome: "mint" }));
  assert.throws(
    () => assertCensusMintConsistency({ censusOutcomes, mintedClaims: [] }),
    (error) => {
      assert.equal(error.code, "CF1_SPLIT_CENSUS_MINT_WITHOUT_CLAIM");
      assert.equal(error.retryable, true); // repairable, not silently accepted
      assert.equal(error.details.mintOutcomes, 60);
      assert.equal(error.details.mintedClaims, 0);
      assert.equal(error.details.mintWithoutClaim.length, 60);
      return true;
    });
});

test("rejects a minted claim with no corresponding mint outcome", () => {
  assert.throws(() => assertCensusMintConsistency({
    censusOutcomes: [{ censusId: "CEN001", outcome: "no_proposition" }],
    mintedClaims: [{ censusId: "CEN001", claimText: "orphan" }],
  }), (error) => error.code === "CF1_SPLIT_CENSUS_MINT_WITHOUT_CLAIM"
    && error.details.claimWithoutMint.includes("CEN001"));
});
