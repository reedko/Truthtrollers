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
  // Emission provenance defaults to model when the package predates the origin tag.
  assert.equal(JSON.parse(mapped.link.rationale).origin, "model");
  // Baseline predates the hinge fields.
  assert.equal(mapped.link.cf1GradeTarget, null);
  assert.equal(mapped.link.cf1ThesisHinge, null);
});

test("claim-side hinge columns populate (audit List A3: previously absent on claims)", () => {
  const selected = { ...createValidPackage().selectedEvaluationClaims[0], gradeTarget: "substance" };
  const mapped = mapCf1SelectedClaim(selected,
    { packageId: "cfp-test", bindingId: 7, order: 0, thesisHinge: "attribution" });
  assert.equal(mapped.link.cf1GradeTarget, "substance");
  assert.equal(mapped.link.cf1ThesisHinge, "attribution");
});

test("host-backfill origin reaches the projected row's rationale", () => {
  const selected = { ...createValidPackage().selectedEvaluationClaims[0], origin: "host_pillar_backfill" };
  const mapped = mapCf1SelectedClaim(selected, { packageId: "cfp-test", bindingId: 7, order: 0 });
  assert.equal(JSON.parse(mapped.link.rationale).origin, "host_pillar_backfill");
});

test("claim lookup normalization changes whitespace only", () => {
  assert.equal(normalizeClaimLookupText("  a\t b\n c  "), "a b c");
});
