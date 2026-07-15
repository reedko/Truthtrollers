import test from "node:test";
import assert from "node:assert/strict";
import { buildBlindReviewArtifacts } from "../../src/claim-foundry/comparison/blindReview.js";

test("blind review separates randomized packets from the producer key", () => {
  const runs = ["baseline", "cf1"].map((producer) => ({ fixtureId: "CF1-F01", repeat: 0,
    producer, status: "completed", output: { claims: [{ text: producer }] } }));
  const first = buildBlindReviewArtifacts(runs, "stable-seed");
  const second = buildBlindReviewArtifacts(runs, "stable-seed");
  assert.deepEqual(first, second);
  assert.equal(first.packets[0].outputs.A.claims.length, 1);
  assert.equal("producer" in first.packets[0].outputs.A, false);
  assert.deepEqual(new Set([first.key[0].A, first.key[0].B]), new Set(["baseline", "cf1"]));
});
