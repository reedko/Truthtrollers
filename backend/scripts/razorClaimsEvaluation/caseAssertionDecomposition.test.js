import assert from "node:assert/strict";
import test from "node:test";
import {
  materializeCaseAssertionDecomposition,
  validateCaseAssertionDecomposition,
} from "./caseAssertionDecomposition.js";

const INPUT = [
  { id: 1, text: "Parent one remains exact." },
  { id: 2, text: "Parent two contains two judgeable assertions." },
];

function validDecomposition() {
  return {
    parentAssertionId: 2,
    children: [
      { childAssertion: "First exact model-produced child." },
      { childAssertion: "Second exact model-produced child." },
    ],
  };
}

test("accepts an empty sparse response", () => {
  const result = validateCaseAssertionDecomposition(
    { decompositions: [] },
    INPUT,
  );
  assert.equal(result.valid, true);
  assert.deepEqual(result.acceptedDecompositions, []);
});

test("accepts a valid decomposition with two children", () => {
  const decomposition = validDecomposition();
  const result = validateCaseAssertionDecomposition(
    { decompositions: [decomposition] },
    INPUT,
  );
  assert.equal(result.valid, true);
  assert.equal(result.acceptedDecompositions[0], decomposition);
});

test("rejects a returned decomposition with only one child", () => {
  const decomposition = validDecomposition();
  decomposition.children = [decomposition.children[0]];
  const result = validateCaseAssertionDecomposition(
    { decompositions: [decomposition] },
    INPUT,
  );
  assert.equal(result.valid, false);
  assert.match(result.errors.join("\n"), /at least two children/);
});

test("rejects unknown parent IDs", () => {
  const decomposition = validDecomposition();
  decomposition.parentAssertionId = 999;
  const result = validateCaseAssertionDecomposition(
    { decompositions: [decomposition] },
    INPUT,
  );
  assert.equal(result.valid, false);
  assert.match(result.errors.join("\n"), /999 was not supplied/);
});

test("rejects duplicate returned parent IDs", () => {
  const result = validateCaseAssertionDecomposition(
    { decompositions: [validDecomposition(), validDecomposition()] },
    INPUT,
  );
  assert.equal(result.valid, false);
  assert.match(result.errors.join("\n"), /appears 2 times/);
});

test("rejects empty child assertions", () => {
  const decomposition = validDecomposition();
  decomposition.children[1].childAssertion = "   ";
  const result = validateCaseAssertionDecomposition(
    { decompositions: [decomposition] },
    INPUT,
  );
  assert.equal(result.valid, false);
  assert.match(result.errors.join("\n"), /non-empty string/);
});

test("rejects duplicate children after minimal whitespace normalization", () => {
  const decomposition = validDecomposition();
  decomposition.children[1].childAssertion =
    "  First   exact model-produced child.  ";
  const result = validateCaseAssertionDecomposition(
    { decompositions: [decomposition] },
    INPUT,
  );
  assert.equal(result.valid, false);
  assert.match(result.errors.join("\n"), /duplicates another child/);
});

test("omitted parents materialize unchanged", () => {
  const validation = validateCaseAssertionDecomposition(
    { decompositions: [] },
    INPUT,
  );
  const parents = materializeCaseAssertionDecomposition(INPUT, validation);
  assert.deepEqual(parents[0], {
    parentAssertionId: 1,
    parentAssertion: INPUT[0].text,
    requiresDecomposition: false,
    children: [{ childAssertion: INPUT[0].text }],
  });
});

test("returned decomposition replaces its parent with only its children", () => {
  const decomposition = validDecomposition();
  const validation = validateCaseAssertionDecomposition(
    { decompositions: [decomposition] },
    INPUT,
  );
  const parents = materializeCaseAssertionDecomposition(INPUT, validation);
  assert.deepEqual(parents[1].children, decomposition.children);
  assert.equal(parents[1].requiresDecomposition, true);
  assert.equal(
    parents[1].children.some((child) => child.childAssertion === INPUT[1].text),
    false,
  );
});

test("does not rewrite valid model-produced child strings", () => {
  const decomposition = validDecomposition();
  decomposition.children[0].childAssertion = "  Spacing stays exact.  ";
  const validation = validateCaseAssertionDecomposition(
    { decompositions: [decomposition] },
    INPUT,
  );
  const parents = materializeCaseAssertionDecomposition(INPUT, validation);
  assert.equal(
    parents[1].children[0].childAssertion,
    "  Spacing stays exact.  ",
  );
});
