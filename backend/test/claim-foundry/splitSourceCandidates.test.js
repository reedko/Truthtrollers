import test from "node:test";
import assert from "node:assert/strict";
import { detectSplitSourceCandidates } from "../../src/claim-foundry/splitSourceCandidates.js";

test("detects an explicit according-to source without declaring it authoritative", () => {
  const out = detectSplitSourceCandidates({ claimUnits: [
    { unitId: "U0001", text: "According to the Coastal Safety Board, the device failed." },
  ] });
  assert.equal(out.sourceCandidateStatus, "candidates_found");
  assert.equal(out.sourceCandidates[0].nameHint, "Coastal Safety Board");
  assert.deepEqual(out.sourceCandidates[0].unitIds, ["U0001"]);
});

test("does not manufacture a candidate from an attribution-context label alone", () => {
  const none = detectSplitSourceCandidates({ claimUnits: [
    { unitId: "U0001", text: "The device failed during testing." },
  ] });
  assert.equal(none.sourceCandidateStatus, "no_candidates_detected");
  assert.deepEqual(none.sourceCandidates, []);

  const contextual = detectSplitSourceCandidates({ attributionContextUnits: [
    { unitId: "U0002", text: "A nearby passage identifies the relevant supplier indirectly." },
  ] });
  assert.equal(contextual.sourceCandidateStatus, "no_candidates_detected");
  assert.deepEqual(contextual.sourceCandidates, []);
});

test("detects generic document-source syntax without inventing a document identity", () => {
  const out = detectSplitSourceCandidates({ claimUnits: [
    { unitId: "U0003", text: "A 2011 study of coastal regions found lower mortality." },
  ] });
  assert.equal(out.sourceCandidateStatus, "candidates_found");
  assert.equal(out.sourceCandidates[0].nameHint, "A 2011 study");
});

test("joins a split personal name to an attribution verb in the next local unit", () => {
  const out = detectSplitSourceCandidates({
    claimUnits: [{ unitId: "U0010", text: "As Jordan K." }],
    localResponseUnits: [{ unitId: "U0011", text: "Rivera observes that failures increased." }],
  });
  const candidate = out.sourceCandidates.find((item) => /Jordan K\. Rivera/.test(item.nameHint));
  assert.ok(candidate);
  assert.equal(candidate.candidateKind, "local_context_external");
  assert.deepEqual(candidate.unitIds, ["U0010", "U0011"]);
  assert.match(candidate.trigger, /cross_unit_continuation/);
});

test("detects a document named by a from-source construction", () => {
  const out = detectSplitSourceCandidates({ claimUnits: [
    { unitId: "U0020", text: "From the 18-page package insert of Pelicanex: the product contains zinc." },
  ] });
  assert.ok(out.sourceCandidates.some((item) => /package insert of Pelicanex/i.test(item.nameHint)));
});
