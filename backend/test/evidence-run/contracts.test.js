import test from "node:test";
import assert from "node:assert/strict";
import * as schemas from "../../src/evidence-run/schemas/index.js";
import { ER1_BEARING_TYPES, ER1_UNRESOLVED_REASONS } from "../../src/evidence-run/contract.js";

test("ER1-0 exports exact portable schemas and required bearing outcomes", () => {
  assert.deepEqual(Object.keys(schemas).sort(), [
    "ER1_ARTIFACT_MANIFEST_SCHEMA", "ER1_CANDIDATE_SCHEMA", "ER1_ERROR_SCHEMA", "ER1_EVENT_SCHEMA",
    "ER1_REQUEST_SCHEMA", "ER1_RESULT_SCHEMA", "ER1_STATE_SCHEMA",
  ]);
  for (const schema of Object.values(schemas)) {
    assert.equal(schema.$schema, "https://json-schema.org/draft/2020-12/schema");
    assert.ok(schema.$id);
    assert.equal(schema.type, "object");
  }
  for (const value of ["support", "refute", "qualify", "context", "non_bearing"]) {
    assert.ok(ER1_BEARING_TYPES.includes(value));
  }
  assert.ok(ER1_UNRESOLVED_REASONS.includes("requested_bearing_not_found"));
});
