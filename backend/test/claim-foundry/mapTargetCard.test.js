import test from "node:test";
import assert from "node:assert/strict";
import { mapCf1TargetCard } from "../../src/claim-foundry/veristrata/mapTargetCard.js";
import { createValidPackage } from "./fixtures/packages.js";

test("target mapping retains the complete Evidence Need Card and package provenance", () => {
  const pkg = createValidPackage();
  const target = pkg.phase3Targets[0];
  const card = pkg.evidenceNeedCards[0];
  const mapped = mapCf1TargetCard(target, card,
    { packageId: pkg.packageId, contentId: 12, claimId: 34, order: 0 });
  assert.equal(mapped.targetType, "substantive");
  assert.equal(mapped.primaryQueryText, card.queryLaneSeeds[0].query);
  assert.deepEqual(JSON.parse(mapped.cardJson), card);
  assert.deepEqual(JSON.parse(mapped.bearingCriteriaJson), card.bearingCriteria);
  assert.equal(mapped.packageId, pkg.packageId);
  assert.equal(mapped.targetId, "T001");
});
