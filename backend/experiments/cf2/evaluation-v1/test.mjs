import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { scoreFixture } from "./scoring.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../../..");
const readJson = (filePath) => JSON.parse(readFileSync(filePath, "utf8"));
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const manifest = readJson(path.join(here, "frozen", "manifest.json"));

test("freeze contains exactly the controlled F01/F03/F08 suite", () => {
  assert.deepEqual(
    manifest.fixtures.map((item) => item.fixtureId),
    ["CF1-F01", "CF1-F03", "CF1-F08"],
  );
  assert.equal(manifest.freezeId, "cf2-v7-ab-f01-f03-f08-20260724");
});

for (const entry of manifest.fixtures) {
  test(`${entry.fixtureId} source and generated hashes remain frozen`, () => {
    const sourcePath = path.join(root, entry.sourceResultPath);
    assert.equal(sha256(readFileSync(sourcePath)), entry.sourceResultSha256);
    for (const [relativeKey, hashKey] of [
      ["inventoryPath", "inventorySha256"],
      ["tracePath", "traceSha256"],
      ["observedPredictionPath", "observedPredictionSha256"],
    ]) {
      const filePath = path.join(here, entry[relativeKey]);
      assert.equal(sha256(readFileSync(filePath)), entry[hashKey]);
    }
  });

  test(`${entry.fixtureId} traces every candidate to one terminal outcome`, () => {
    const inventory = readJson(path.join(here, entry.inventoryPath));
    const trace = readJson(path.join(here, entry.tracePath));
    const tuple = readJson(path.join(here, entry.discourseTupleReviewPath));
    const position = readJson(path.join(
      here,
      entry.articlePositionMapReviewPath,
    ));
    assert.equal(inventory.candidates.length, 30);
    assert.equal(trace.candidates.length, inventory.candidates.length);
    assert.equal(
      entry.validJudgmentCount + entry.quarantineCount,
      entry.candidateCount,
    );
    const inventoryIds = inventory.candidates.map((item) => item.candidateId);
    assert.equal(new Set(inventoryIds).size, inventoryIds.length);
    assert.deepEqual(
      trace.candidates.map((item) => item.candidateId),
      inventoryIds,
    );
    assert.deepEqual(
      tuple.items.map((item) => item.candidateId),
      inventoryIds,
    );
    assert.deepEqual(
      position.candidateReviews.map((item) => item.candidateId),
      inventoryIds,
    );
    for (const item of trace.candidates) {
      assert.match(item.disposition.terminalStatus, /^(selected|quarantined|eligible_not_selected|ineligible_not_selected|missing_call_b_judgment)$/);
      assert.equal(
        Boolean(item.callB.validatedJudgment)
          + Boolean(item.callB.rejection),
        1,
      );
    }
  });
}

test("scorer keeps all six dimensions separate and emits no composite", () => {
  const tupleReview = {
    items: [{
      review: {
        status: "reviewed",
        tupleVerdict: "partially_correct",
        fieldVerdicts: {
          surface: "correct",
          layerStructure: "incorrect",
          substantiveAssertion: "correct",
          grounding: "correct",
          contentSupplier: "incorrect",
          verificationTarget: "correct",
        },
      },
    }],
  };
  const positionReview = {
    fixtureId: "CF1-F99",
    freezeId: "synthetic",
    review: {
      mapQuality: {
        coverage: "partial",
        atomicity: "pass",
        direction: "fail",
        genreFit: "pass",
      },
    },
    candidateReviews: [{
      candidateId: "C01",
      review: {
        articleTreatmentGold: "challenged",
        targetRelationsGold: [{
          positionId: "POS01",
          effectIfTrue: "weakens",
        }],
        relevanceGold: "essential",
        selectionGold: true,
      },
    }],
  };
  const prediction = {
    candidateOutputs: [{
      candidateId: "C01",
      articleTreatment: "challenged",
      targetEffects: [{
        positionId: "POS01",
        effectIfTrue: "weakens",
      }],
      relevance: "essential",
      selected: true,
    }],
  };
  const score = scoreFixture({ tupleReview, positionReview, prediction });
  assert.deepEqual(
    Object.keys(score.dimensions),
    [
      "tupleCorrectness",
      "positionMapQuality",
      "articleTreatment",
      "targetSpecificEffect",
      "relevance",
      "selection",
    ],
  );
  assert.equal(score.composite, undefined);
  assert.equal(score.dimensions.tupleCorrectness.meanCredit, 0.5);
  assert.equal(score.dimensions.articleTreatment.strictAccuracy, 1);
  assert.equal(score.dimensions.targetSpecificEffect.strictAccuracy, 1);
  assert.equal(score.dimensions.relevance.strictAccuracy, 1);
  assert.equal(score.dimensions.selection.f1, 1);
});
