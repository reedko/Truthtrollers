import test from "node:test";
import assert from "node:assert/strict";
import {
  CF1_ID_PREFIXES,
  CF1_LIMITS,
  CF1_PIPELINE_VERSION,
  CF1_SCHEMA_VERSION,
  CF1_SCORE_TRANSFORMS,
  CF1_SEMANTIC_FUNCTIONS,
  CF1_TARGET_TYPES,
} from "../../src/claim-foundry/contract.js";
import { Cf1Error, Cf1InputError, isRetryableCf1Error } from "../../src/claim-foundry/errors.js";

test("CF1 contract exposes stable v1 identity and required transforms", () => {
  assert.equal(CF1_SCHEMA_VERSION, "cf1.claimPackage.v1");
  assert.equal(CF1_PIPELINE_VERSION, "cf1.0.0");
  assert.deepEqual(CF1_SCORE_TRANSFORMS, ["normal", "invert", "none"]);
  assert.deepEqual(CF1_ID_PREFIXES, {
    run: "cf1run_",
    package: "cf1pkg_",
    lineage: "cf1lin_",
  });
  assert.equal(CF1_LIMITS.articleTextChars, 500_000);
  assert.ok(CF1_SEMANTIC_FUNCTIONS.includes("opponent_position"));
  assert.ok(CF1_TARGET_TYPES.includes("inference_warrant"));
  assert.ok(Object.isFrozen(CF1_LIMITS));
  assert.ok(Object.isFrozen(CF1_SCORE_TRANSFORMS));
});

test("typed CF1 errors preserve transport-safe properties", () => {
  const inputError = new Cf1InputError("CF1_BAD_INPUT", "bad input", { path: "/text" });
  assert.ok(inputError instanceof Cf1Error);
  assert.equal(inputError.status, 400);
  assert.equal(inputError.path, "/text");
  assert.equal(isRetryableCf1Error(inputError), false);

  const transient = new Cf1Error("CF1_MODEL_UNAVAILABLE", "retry", { retryable: true, status: 503 });
  assert.equal(isRetryableCf1Error(transient), true);
});
