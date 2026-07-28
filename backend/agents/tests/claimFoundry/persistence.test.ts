import assert from "node:assert/strict";
import test from "node:test";
import { hashPackageValue } from "../../claimFoundry/claimFoundryPersistence.js";
import { harness, pkg } from "./fixtures.js";

test("persisted state recovers independently and event rows are append-only snapshots", async () => {
  const { tools, persistence } = await harness();
  await tools.save_working_package({ idempotencyKey: "persist-save", package: pkg() });
  const recovered = await persistence.load("run-1");
  recovered!.workingPackage!.selectedClaims[0]!.scope = "local mutation";
  assert.notEqual((await persistence.load("run-1"))!.workingPackage!.selectedClaims[0]!.scope, "local mutation");
  const events = await persistence.events("run-1");
  events[0]!.toolName = "tampered";
  assert.equal((await persistence.events("run-1"))[0]!.toolName, "save_working_package");
});

test("final package hash excludes only its self-referential hash field", () => {
  const working = pkg();
  const first = hashPackageValue(working);
  const withHash = { ...working, packageHash: first };
  assert.equal(hashPackageValue(withHash), first);
  assert.notEqual(hashPackageValue({ ...working, status: "final" }), first);
});
