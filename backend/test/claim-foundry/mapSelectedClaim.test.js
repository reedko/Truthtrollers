import test from "node:test";
import assert from "node:assert/strict";
import { mapCf1SelectedClaim, normalizeClaimLookupText } from "../../src/claim-foundry/veristrata/mapSelectedClaim.js";
import { createValidPackage } from "./fixtures/packages.js";

test("selected claim mapping preserves wording and creates inactive Workspace fields", () => {
  const selected = createValidPackage().selectedEvaluationClaims[0];
  selected.claimText = "Bridge-repair\n procurement   began nine months late.";
  const mapped = mapCf1SelectedClaim(selected, { packageId: "cfp-test", bindingId: 7, order: 0 });
  assert.equal(mapped.claimText, selected.claimText);
  assert.equal(mapped.lookupText, "Bridge-repair procurement began nine months late.");
  assert.equal(mapped.link.claimRole, "pillar");
  assert.equal(mapped.link.articleStance, "endorses");
  assert.equal(mapped.link.selectedClaimId, "S01");
  assert.equal(JSON.parse(mapped.link.rationale).packageId, "cfp-test");
});

test("claim lookup normalization changes whitespace only", () => {
  assert.equal(normalizeClaimLookupText("  a\t b\n c  "), "a b c");
});
