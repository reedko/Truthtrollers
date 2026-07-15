import test from "node:test";
import assert from "node:assert/strict";
import { applyCf1Repair } from "../../src/claim-foundry/applyRepair.js";
import { verifyCf1Package } from "../../src/claim-foundry/verifyPackage.js";
import { createPackageDraft } from "./fixtures/packages.js";

function repair(path, value, operation = "replace") {
  return { operation, path, value, rationale: "Grounded correction.", sourceBlockIds: ["B001"] };
}

test("allowlisted repair is immutable and card copies resynchronize", () => {
  const draft = createPackageDraft();
  draft.phase3Targets[0].scoreTransform = "invert";
  const response = { repairs: [repair("/phase3Targets/0/scoreTransform", "normal")], cannotRepair: [] };
  const repaired = applyCf1Repair(draft, response, ["/phase3Targets/0/scoreTransform"]);
  assert.equal(repaired.phase3Targets[0].scoreTransform, "normal");
  assert.equal(repaired.evidenceNeedCards[0].scoreTransform, "normal");
  assert.equal(draft.phase3Targets[0].scoreTransform, "invert");
  assert.equal(verifyCf1Package(repaired).valid, true);
});

test("source-unit repair recomputes every deterministic grounding field", () => {
  const draft = createPackageDraft();
  draft.rawAssertions[0].sourceUnitIds = ["U0001"];
  const path = "/rawAssertions/0/sourceUnitIds";
  const repaired = applyCf1Repair(draft,
    { repairs: [repair(path, ["U0002"])], cannotRepair: [] }, [path]);
  assert.deepEqual(repaired.rawAssertions[0].sourceOffsets, [{ start: 68, end: 141 }]);
  assert.deepEqual(repaired.selectedEvaluationClaims[0].sourceUnitIds, ["U0002"]);
});

test("a missing target card can be added while deterministic copies are host-owned", () => {
  const draft = createPackageDraft();
  draft.evidenceNeedCards = [];
  const value = {
    targetId: "T001", evidenceRolesNeeded: ["primary-record"],
    bearingCriteria: { mustMatch: ["same procurement"], shouldMatch: [], rejectIfOnly: ["general delays"], weak: false },
    queryLaneSeeds: [], identifierHints: { doi: [], pmid: [], titleExact: [], authorYear: [], quotedDocumentNames: [], canonicalSourceIds: [] },
  };
  const repaired = applyCf1Repair(draft, { repairs: [repair("/evidenceNeedCards/-", value, "add")], cannotRepair: [] }, ["/evidenceNeedCards/-"]);
  assert.equal(repaired.evidenceNeedCards[0].cardId, "ENC-T001");
  assert.equal(repaired.evidenceNeedCards[0].targetText, draft.phase3Targets[0].targetText);
  assert.equal(verifyCf1Package(repaired).valid, true);
});

test("multiple operations apply atomically or not at all", () => {
  const draft = createPackageDraft();
  const original = structuredClone(draft);
  const allowed = ["/phase3Targets/0/scoreTransform", "/phase3Targets/9/scoreTransform"];
  assert.throws(() => applyCf1Repair(draft, { repairs: [
    repair(allowed[0], "invert"), repair(allowed[1], "normal"),
  ], cannotRepair: [] }, allowed), (error) => error.code === "CF1_REPAIR_PATH_MISSING");
  assert.deepEqual(draft, original);
});

test("unknown grounding block rejects the entire repair", () => {
  const draft = createPackageDraft();
  const path = "/phase3Targets/0/scoreTransform";
  const operation = { ...repair(path, "normal"), sourceBlockIds: ["B999"] };
  assert.throws(() => applyCf1Repair(draft, { repairs: [operation], cannotRepair: [] }, [path]),
    (error) => error.code === "CF1_REPAIR_GROUNDING_INVALID");
});
