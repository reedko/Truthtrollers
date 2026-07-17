import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadCf1PackageFile, verifyCf1Package } from "../../src/evidence-run/packageLoader.js";
import { ER1_CF1_FIXTURES } from "./fixtures/manifest.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

test("all eight frozen CF1 packages pass offline identity and hash verification", async () => {
  for (const fixture of ER1_CF1_FIXTURES) {
    const loaded = await loadCf1PackageFile(path.join(root, fixture.relativePath), {
      packageId: fixture.packageId,
      expectedPackageSchemaVersion: "cf1.claimPackage.v1",
      expectedPackageHash: fixture.packageHash,
    });
    assert.equal(loaded.verification.valid, true, fixture.fixtureId);
    assert.equal(loaded.verification.targetCount, fixture.targetCount, fixture.fixtureId);
  }
});

test("tampered package and mismatched expected identity are rejected", async () => {
  const fixture = ER1_CF1_FIXTURES[0];
  const value = JSON.parse(await readFile(path.join(root, fixture.relativePath), "utf8"));
  assert.throws(() => verifyCf1Package(value, { packageId: "cf1pkg_wrong" }),
    { code: "ER1_PACKAGE_IDENTITY_MISMATCH" });
  value.selectedEvaluationClaims[0].claimText += " tampered";
  assert.throws(() => verifyCf1Package(value), { code: "ER1_PACKAGE_HASH_MISMATCH" });
});
