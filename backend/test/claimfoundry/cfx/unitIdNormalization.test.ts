import assert from "node:assert/strict";
import test from "node:test";
import {
  configuredUnitWidth,
  normalizeCfxUnitId,
} from "../../../src/claimfoundry/cfx/discoveryWithUnits/normalizeUnitIds.js";

const fixtureA = ["U0001", "U0009", "U0012"];
const fixtureB = ["U0001", "U0008", "U0012"];

test("already-canonical and one-, two-, and three-digit IDs resolve canonically", () => {
  for (const returnedUnitId of ["U9", "U09", "U009", "U0009"]) {
    const result = normalizeCfxUnitId({
      returnedUnitId,
      authoritativeUnitIds: fixtureA,
    });
    assert.equal(result.status, "accepted");
    if (result.status !== "accepted") continue;
    assert.equal(result.canonicalUnitId, "U0009");
    assert.equal(
      result.normalizationOccurred,
      returnedUnitId !== "U0009",
    );
    assert.equal(result.originalUnitId, returnedUnitId);
  }
  assert.equal(configuredUnitWidth(fixtureA), 4);
});

test("nonexistent normalized IDs are rejected without cross-fixture leakage", () => {
  const acceptedInA = normalizeCfxUnitId({
    returnedUnitId: "U9",
    authoritativeUnitIds: fixtureA,
  });
  const rejectedInB = normalizeCfxUnitId({
    returnedUnitId: "U9",
    authoritativeUnitIds: fixtureB,
  });
  assert.equal(acceptedInA.status, "accepted");
  assert.equal(rejectedInB.status, "rejected");
  if (rejectedInB.status !== "rejected") return;
  assert.equal(rejectedInB.reason, "NONEXISTENT_UNIT_ID");
  assert.equal(rejectedInB.originalUnitId, "U9");
  assert.equal(rejectedInB.canonicalUnitId, "U0009");
  assert.equal(rejectedInB.normalizationOccurred, false);
});

test("malformed, ranged, and mixed IDs preserve the exact returned value", () => {
  for (const returnedUnitId of ["9", "U1-U2", "U9x", "u9", "U 9"]) {
    const result = normalizeCfxUnitId({
      returnedUnitId,
      authoritativeUnitIds: fixtureA,
    });
    assert.equal(result.status, "rejected");
    if (result.status !== "rejected") continue;
    assert.equal(result.reason, "MALFORMED_UNIT_ID");
    assert.equal(result.originalUnitId, returnedUnitId);
    assert.equal(result.canonicalUnitId, null);
  }
});

test("resolution must be unique in the authoritative inventory", () => {
  const result = normalizeCfxUnitId({
    returnedUnitId: "U9",
    authoritativeUnitIds: [...fixtureA, "U0009"],
  });
  assert.equal(result.status, "rejected");
  if (result.status !== "rejected") return;
  assert.equal(result.reason, "NONUNIQUE_UNIT_ID");
  assert.equal(result.resolutionCount, 2);
});
