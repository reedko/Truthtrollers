import test from "node:test";
import assert from "node:assert/strict";
import {
  assignLocalIds,
  createLineageId,
  createPackageId,
  createRunId,
  isLineageId,
  isPackageId,
  isRunId,
} from "../../src/claim-foundry/ids.js";

test("CF1 creates typed UUIDv7 identities", () => {
  const runId = createRunId();
  const packageId = createPackageId();
  const lineageId = createLineageId();

  assert.equal(isRunId(runId), true);
  assert.equal(isPackageId(packageId), true);
  assert.equal(isLineageId(lineageId), true);
  assert.equal(isPackageId(runId), false);
  assert.ok(runId.length <= 48);
});

test("generated identities remain unique under a focused stress run", () => {
  const ids = Array.from({ length: 10_000 }, createRunId);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.every(isRunId));
});

test("package-local IDs are assigned without mutating inputs", () => {
  const source = [{ text: "one" }, { text: "two" }];
  const assigned = assignLocalIds(source, { prefix: "R", digits: 3, field: "rawAssertionId" });

  assert.deepEqual(assigned, [
    { rawAssertionId: "R001", text: "one" },
    { rawAssertionId: "R002", text: "two" },
  ]);
  assert.deepEqual(source, [{ text: "one" }, { text: "two" }]);
});

test("local ID assignment rejects an exhausted namespace", () => {
  assert.throws(
    () => assignLocalIds(Array.from({ length: 10 }, () => ({})), { prefix: "S", digits: 1, field: "id" }),
    RangeError,
  );
});
