import test from "node:test";
import assert from "node:assert/strict";
import {
  canonicalizeCf1,
  hashArticleInput,
  hashPackage,
  sha256Hex,
} from "../../src/claim-foundry/canonicalJson.js";

test("canonical JSON sorts object keys recursively and preserves array order", () => {
  const first = { z: 1, a: { y: 2, x: 3 }, values: ["b", "a"] };
  const second = { values: ["b", "a"], a: { x: 3, y: 2 }, z: 1 };

  assert.equal(canonicalizeCf1(first), canonicalizeCf1(second));
  assert.equal(canonicalizeCf1(first), '{"a":{"x":3,"y":2},"values":["b","a"],"z":1}');
  assert.notEqual(canonicalizeCf1(first), canonicalizeCf1({ ...first, values: ["a", "b"] }));
});

test("canonical JSON rejects unsupported or ambiguous values", () => {
  assert.throws(() => canonicalizeCf1({ value: undefined }), /undefined/);
  assert.throws(() => canonicalizeCf1({ value: Number.NaN }), /finite/);
  const cyclic = {};
  cyclic.self = cyclic;
  assert.throws(() => canonicalizeCf1(cyclic), /cycles/);
});

test("SHA-256 and article hashes are stable", () => {
  assert.equal(sha256Hex("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  const base = { title: "Title", text: "Article text", publisher: "One" };
  assert.equal(hashArticleInput(base), hashArticleInput({ ...base, publisher: "Two" }));
});

test("package hash excludes volatile fields without mutating the package", () => {
  const first = {
    packageId: "same",
    createdAt: "one",
    diagnostics: { calls: 1 },
    verification: { valid: true, verifiedAt: "one" },
    packageHash: "old",
  };
  const second = {
    ...first,
    createdAt: "two",
    diagnostics: { calls: 9 },
    verification: { valid: true, verifiedAt: "two" },
    packageHash: "different",
  };
  assert.equal(hashPackage(first), hashPackage(second));
  assert.equal(first.verification.verifiedAt, "one");
});
