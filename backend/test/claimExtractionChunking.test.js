import test from "node:test";
import assert from "node:assert/strict";

import { chunkContentForClaimExtraction } from "../src/core/processTaskClaims.js";

test("claim extraction restores the pre-refactor 6000-character chunk contract", () => {
  const text = "x".repeat(12_345);
  const chunks = chunkContentForClaimExtraction(text);

  assert.deepEqual(chunks.map((chunk) => chunk.text.length), [6000, 6000, 345]);
  assert.deepEqual(chunks.map((chunk) => chunk.tokenLength), [1500, 1500, 86]);
  assert.equal(chunks.map((chunk) => chunk.text).join(""), text);
});

test("claim extraction returns no chunks for empty content", () => {
  assert.deepEqual(chunkContentForClaimExtraction(""), []);
});
