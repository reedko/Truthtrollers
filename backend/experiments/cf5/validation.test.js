import test from "node:test";
import assert from "node:assert/strict";
import { validateClaims, applyRepair } from "./validation.js";

const KNOWN_UNITS = new Set(["U0001", "U0002", "U0003"]);

function claim(overrides = {}) {
  return {
    claimId: "E001",
    claim: "The CDC reported a rise in cases.",
    grounding: ["U0001"],
    articleTreatment: "adopted",
    provenance: null,
    ...overrides,
  };
}

test("schema acceptance: a fully valid claim produces no findings and no hard failures", () => {
  const result = validateClaims([claim()], KNOWN_UNITS);
  assert.equal(result.claims.length, 1);
  assert.equal(result.hardFailureClaimIds.size, 0);
});

test("rejection: missing claimId is dropped with a finding, not silently kept", () => {
  const result = validateClaims([{ ...claim(), claimId: undefined }], KNOWN_UNITS);
  assert.equal(result.claims.length, 0);
  assert.ok(result.findings.some((f) => f.code === "CF5_MISSING_CLAIM_ID"));
});

test("rejection: empty claim text is a hard failure", () => {
  const result = validateClaims([claim({ claim: "" })], KNOWN_UNITS);
  assert.ok(result.hardFailureClaimIds.has("E001"));
  assert.ok(result.findings.some((f) => f.code === "CF5_EMPTY_CLAIM"));
});

test("rejection: invalid articleTreatment is a hard failure", () => {
  const result = validateClaims([claim({ articleTreatment: "endorsed" })], KNOWN_UNITS);
  assert.ok(result.hardFailureClaimIds.has("E001"));
  assert.ok(result.findings.some((f) => f.code === "CF5_INVALID_ARTICLE_TREATMENT"));
});

test("rejection: empty grounding array is a hard failure", () => {
  const result = validateClaims([claim({ grounding: [] })], KNOWN_UNITS);
  assert.ok(result.hardFailureClaimIds.has("E001"));
  assert.ok(result.findings.some((f) => f.code === "CF5_EMPTY_GROUNDING"));
});

test("detection: unknown source-unit ID in grounding is a hard failure", () => {
  const result = validateClaims([claim({ grounding: ["U9999"] })], KNOWN_UNITS);
  assert.ok(result.hardFailureClaimIds.has("E001"));
  assert.ok(result.findings.some((f) => f.code === "CF5_UNKNOWN_UNIT_ID" && f.unitId === "U9999"));
});

test("detection: duplicate claimId is a hard failure on the second occurrence", () => {
  const result = validateClaims([
    claim({ claimId: "E001", claim: "First claim text." }),
    claim({ claimId: "E001", claim: "Second, different claim text." }),
  ], KNOWN_UNITS);
  assert.ok(result.hardFailureClaimIds.has("E001"));
  assert.ok(result.findings.some((f) => f.code === "CF5_DUPLICATE_CLAIM_ID"));
});

test("detection: normalized exact-duplicate claim text is dropped, not repaired", () => {
  const result = validateClaims([
    claim({ claimId: "E001", claim: "The CDC reported a rise in cases." }),
    claim({ claimId: "E002", claim: "The CDC reported a rise in cases!!" }),
  ], KNOWN_UNITS);
  assert.equal(result.claims.length, 1);
  assert.equal(result.claims[0].claimId, "E001");
  assert.ok(result.findings.some((f) => f.code === "CF5_EXACT_DUPLICATE_CLAIM" && f.claimId === "E002"));
  assert.equal(result.hardFailureClaimIds.size, 0, "exact duplicates are dropped, not sent to repair");
});

test("nullable provenance: null is valid", () => {
  const result = validateClaims([claim({ provenance: null })], KNOWN_UNITS);
  assert.equal(result.hardFailureClaimIds.size, 0);
});

test("nullable provenance: non-empty string is valid", () => {
  const result = validateClaims([claim({ provenance: "William Thompson" })], KNOWN_UNITS);
  assert.equal(result.hardFailureClaimIds.size, 0);
});

test("nullable provenance: empty string is a hard failure (must be null, not empty)", () => {
  const result = validateClaims([claim({ provenance: "" })], KNOWN_UNITS);
  assert.ok(result.hardFailureClaimIds.has("E001"));
  assert.ok(result.findings.some((f) => f.code === "CF5_INVALID_PROVENANCE"));
});

test("informational: fewer than 8 claims produces a thin-set finding, not a hard failure", () => {
  const claims = ["E001", "E002", "E003"].map((id) => claim({ claimId: id, claim: `Claim ${id}` }));
  const result = validateClaims(claims, KNOWN_UNITS);
  assert.equal(result.claims.length, 3);
  assert.equal(result.hardFailureClaimIds.size, 0);
  assert.ok(result.findings.some((f) => f.code === "CF5_THIN_CLAIM_SET"));
});

test("informational: more than 15 claims produces an oversized-set finding, not a hard failure", () => {
  const claims = Array.from({ length: 16 }, (_, i) => claim({ claimId: `E${i}`, claim: `Claim number ${i}` }));
  const result = validateClaims(claims, KNOWN_UNITS);
  assert.equal(result.claims.length, 16);
  assert.equal(result.hardFailureClaimIds.size, 0);
  assert.ok(result.findings.some((f) => f.code === "CF5_OVERSIZED_CLAIM_SET"));
});

test("applyRepair: only claims flagged as hard failures are replaced", () => {
  const original = [
    claim({ claimId: "E001", grounding: ["U9999"] }),
    claim({ claimId: "E002", claim: "An untouched valid claim." }),
  ];
  const repaired = [claim({ claimId: "E001", grounding: ["U0001"] })];
  const merged = applyRepair(original, repaired, new Set(["E001"]));
  assert.deepEqual(merged[0].grounding, ["U0001"]);
  assert.equal(merged[1].claim, "An untouched valid claim.");
});
