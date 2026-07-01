import test from "node:test";
import assert from "node:assert/strict";

import {
  applyQuantitativeStanceGuard,
  assessQuantitativeClaim,
  extractQuantitativeConstraints,
  extractPrimaryQuantitativeConstraint,
} from "../../src/core/quantitativeClaimGuard.js";

const majorityClaim = "More than half of all babies born with CHD will require surgery in order to survive.";

test("parses percentages, fractions, and comparative thresholds", () => {
  assert.deepEqual(
    (({ comparator, value }) => ({ comparator, value }))(extractPrimaryQuantitativeConstraint(majorityClaim)),
    { comparator: "gt", value: 0.5 },
  );
  assert.equal(extractPrimaryQuantitativeConstraint("Approximately 25% need surgery.").value, 0.25);
  assert.equal(extractPrimaryQuantitativeConstraint("About 1 in 4 need surgery.").value, 0.25);
  assert.equal(extractPrimaryQuantitativeConstraint("One out of every 100 babies.").value, 0.01);
  assert.equal(extractPrimaryQuantitativeConstraint("Nearly one third need surgery.").value, 1 / 3);
});

test("chooses the earliest constraint instead of regex-type priority", () => {
  const constraints = extractQuantitativeConstraints(
    "About 1 in 4 babies need surgery; this does not support more than half.",
  );
  assert.equal(constraints[0].value, 0.25);
  assert.equal(constraints[1].value, 0.5);
});

test("25 percent needing surgery refutes a more-than-half surgery claim", () => {
  const result = assessQuantitativeClaim({
    taskClaimText: majorityClaim,
    evidenceText: "Approximately 25% of children born with a CHD will need heart surgery in their first year of life to survive.",
    proposedStance: "support",
  });
  assert.equal(result.comparable, true);
  assert.equal(result.stance, "refute");
});

test("one-in-four remains 25 percent when rationale later repeats the task threshold", () => {
  const result = assessQuantitativeClaim({
    taskClaimText: majorityClaim,
    evidenceText: "About 1 in 4 babies with complex CHD need surgery in their first year; this does not establish more than half.",
    proposedStance: "support",
  });
  assert.equal(result.comparable, true);
  assert.equal(result.evidence.value, 0.25);
  assert.equal(result.stance, "refute");
  assert.match(result.reason, /evidence=25%/);
});

test("absolute surgery counts cannot support a percentage claim without a denominator", () => {
  const result = applyQuantitativeStanceGuard({
    taskClaimText: majorityClaim,
    evidenceText: "Around 3,000 surgeries or catheter procedures take place on babies under one year of age every year.",
    proposedStance: "support",
  });
  assert.equal(result.comparable, false);
  assert.equal(result.stance, "insufficient");
  assert.equal(result.evidence, null);
  assert.match(result.reason, /absolute count without a denominator/);
});

test("a qualitative age statement cannot support an exact percentage claim", () => {
  const result = applyQuantitativeStanceGuard({
    taskClaimText: "21% of children requiring cardiac surgery are under 1 month old.",
    evidenceText: "Babies with important aortic coarctation usually need surgery within the first few weeks of life.",
    proposedStance: "support",
  });
  assert.equal(result.stance, "insufficient");
  assert.match(result.reason, /no percentage or fraction/);
});

test("selects a later comparable statistic from a multi-statistic snippet", () => {
  const result = assessQuantitativeClaim({
    taskClaimText: "Each year, about 1 out of every 100 babies born has a heart defect.",
    evidenceText: "About 1 in 4 heart defects are critical. Heart defects affect nearly 1% of births.",
    proposedStance: "support",
  });
  assert.equal(result.comparable, true);
  assert.equal(result.evidence.value, 0.01);
  assert.equal(result.stance, "support");
});

test("critical-CHD prevalence followed by a surgery sentence is not the same measure", () => {
  const result = applyQuantitativeStanceGuard({
    taskClaimText: majorityClaim,
    evidenceText: "About 1 in 4 babies born with a heart defect has a critical heart defect. Babies with critical heart defects need surgery.",
    proposedStance: "support",
  });
  assert.equal(result.comparable, false);
  assert.equal(result.stance, "insufficient");
  assert.equal(result.evidenceMetric, "critical_chd_share");
});

test("reversed surgery/age denominator cannot support the 40 percent claim", () => {
  const result = applyQuantitativeStanceGuard({
    taskClaimText: "40% of children requiring cardiac surgery are under 1 year old.",
    evidenceText: "Of babies born with a heart defect, 25% need surgery within the first year.",
    proposedStance: "support",
  });
  assert.equal(result.comparable, false);
  assert.equal(result.stance, "insufficient");
  assert.equal(result.taskMetric, "surgery_patient_age_share");
  assert.equal(result.evidenceMetric, "chd_surgery_share");
});

test("matching surgery-patient age statistic supports the exact claim", () => {
  const result = assessQuantitativeClaim({
    taskClaimText: "40% of children requiring cardiac surgery are under 1 year old.",
    evidenceText: "40 percent of children requiring cardiac surgery were under 1 year old.",
    proposedStance: "support",
  });
  assert.equal(result.comparable, true);
  assert.equal(result.stance, "support");
});

test("non-quantitative tasks are left untouched", () => {
  assert.equal(assessQuantitativeClaim({
    taskClaimText: "Congenital heart defects are common.",
    evidenceText: "About 1 in 100 babies has a heart defect.",
    proposedStance: "support",
  }), null);
});
