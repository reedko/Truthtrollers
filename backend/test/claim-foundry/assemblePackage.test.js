import test from "node:test";
import assert from "node:assert/strict";
import { finalizeCf1Package } from "../../src/claim-foundry/assemblePackage.js";
import { createPackageDraft } from "./fixtures/packages.js";
import { verifyCf1Package } from "../../src/claim-foundry/verifyPackage.js";

test("package assembly produces an unfinalized portable envelope", () => {
  const draft = createPackageDraft();
  assert.equal(draft.schemaVersion, "cf1.claimPackage.v1");
  assert.equal(draft.status, "verification_failed");
  assert.equal(draft.verification, null);
  assert.equal(draft.packageHash, "");
});

test("only a verified package can be finalized", () => {
  const draft = createPackageDraft();
  assert.throws(() => finalizeCf1Package(draft, { valid: false, blockingErrors: [{ code: "bad" }] }), /Only a valid/);
  const verification = verifyCf1Package(draft);
  const finalized = finalizeCf1Package(draft, verification);
  assert.equal(finalized.status, "ready_for_evidence");
  assert.match(finalized.packageHash, /^[a-f0-9]{64}$/);
  assert.equal(draft.status, "verification_failed");
});
