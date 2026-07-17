import test from "node:test";
import assert from "node:assert/strict";
import { classifyRepairability, verifyCf1Package } from "../../src/claim-foundry/verifyPackage.js";
import { createPackageDraft, createValidPackage } from "./fixtures/packages.js";

function codes(result) {
  return new Set(result.blockingErrors.map((issue) => issue.code));
}

test("a grounded, coherent package passes and its final hash revalidates", () => {
  const finalized = createValidPackage();
  const result = verifyCf1Package(finalized, { requireFinalHash: true });
  assert.equal(result.valid, true);
  assert.deepEqual(result.blockingErrors, []);
});

test("verifier rejects broken references and missing target cards", () => {
  const draft = createPackageDraft();
  draft.phase3Targets[0].selectedClaimId = "S99";
  draft.evidenceNeedCards = [];
  const result = verifyCf1Package(draft);
  assert.equal(result.valid, false);
  assert.ok(codes(result).has("CF1_UNRESOLVED_REFERENCE"));
  assert.ok(codes(result).has("CF1_TARGET_CARD_CARDINALITY"));
  assert.equal(classifyRepairability(result).repairable, true);
});

test("verifier rejects invented provenance and identifiers", () => {
  const draft = createPackageDraft();
  draft.rawAssertions[0].sourceOffsets = [{ start: 0, end: 4 }];
  draft.evidenceNeedCards[0].identifierHints.doi = ["10.9999/invented"];
  const result = verifyCf1Package(draft);
  assert.ok(codes(result).has("CF1_GROUNDING_DERIVATION_MISMATCH"));
  assert.ok(codes(result).has("CF1_UNGROUNDED_IDENTIFIER"));
});

test("verifier enforces target posture and copy consistency", () => {
  const draft = createPackageDraft();
  draft.phase3Targets[0].scoreTransform = "invert";
  draft.evidenceNeedCards[0].targetText = "different text";
  const result = verifyCf1Package(draft);
  assert.ok(codes(result).has("CF1_INVALID_TARGET_POSTURE"));
  assert.ok(codes(result).has("CF1_CARD_TARGET_MISMATCH"));
});

test("verifier blocks an opponent claim whose claim-side transform contradicts its target", () => {
  const draft = createPackageDraft();
  draft.rawAssertions[0].articleUse = "opponent_to_rebut";
  draft.selectedEvaluationClaims[0].articleRole = "opponent_claim";
  draft.selectedEvaluationClaims[0].scoreTransform = "normal";
  draft.phase3Targets[0].targetType = "opponent_substantive";
  draft.phase3Targets[0].scoreTransform = "invert";
  draft.evidenceNeedCards[0].targetType = "opponent_substantive";
  draft.evidenceNeedCards[0].scoreTransform = "invert";

  const result = verifyCf1Package(draft);
  assert.equal(result.valid, false);
  assert.ok(codes(result).has("CF1_CLAIM_TARGET_POSTURE_MISMATCH"));
  assert.ok(codes(result).has("CF1_DERIVED_POSTURE_MISMATCH"));
  assert.ok(codes(result).has("CF1_PROJECTED_STANCE_MISMATCH"));
});

test("source-identity failures are terminal while semantic failures are repairable", () => {
  const draft = createPackageDraft();
  draft.article.contentHash = "a".repeat(64);
  const result = verifyCf1Package(draft);
  const classification = classifyRepairability(result);
  assert.equal(classification.repairable, false);
  assert.ok(classification.terminalIssues.some((issue) => issue.code === "CF1_CONTENT_HASH_MISMATCH"));
});

test("selection count outside the target range requires an explicit exception", () => {
  const draft = createPackageDraft();
  delete draft.diagnostics.selectionCountException;
  assert.ok(codes(verifyCf1Package(draft)).has("CF1_SELECTION_COUNT_UNJUSTIFIED"));
});

test("malformed packages return structured verification errors rather than throwing", () => {
  const draft = createPackageDraft();
  delete draft.article;
  draft.evidenceNeedCards[0].identifierHints.doi = "not-an-array";
  const result = verifyCf1Package(draft);
  assert.equal(result.valid, false);
  assert.ok(codes(result).has("CF1_INVALID_ARTICLE"));
  assert.ok(codes(result).has("CF1_INVALID_ARRAY"));
});

test("nullable optional speaker attribution matches the portable schema", () => {
  const pkg = createPackageDraft();
  pkg.rawAssertions[0].speakerEntity = null;
  assert.equal(verifyCf1Package(pkg).valid, true);
});

test("host source blocks may legitimately contain more than 30 atoms and units", () => {
  const pkg = createPackageDraft();
  const block = pkg.semanticBlocks[0];
  block.atomIds = Array.from({ length: 31 }, (_, index) => `A${String(index + 1).padStart(4, "0")}`);
  block.sourceUnitIds = Array.from({ length: 31 }, (_, index) => `U${String(index + 1).padStart(4, "0")}`);
  const referenceErrors = verifyCf1Package(pkg).blockingErrors.filter((item) =>
    item.code === "CF1_INVALID_ARRAY" && item.path.startsWith("/semanticBlocks/0/"));
  assert.deepEqual(referenceErrors, []);
});
