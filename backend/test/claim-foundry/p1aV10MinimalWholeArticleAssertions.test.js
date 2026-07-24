import test from "node:test";
import assert from "node:assert/strict";
import {
  buildP1aV10MinimalWholeArticleAssertionsPrompt,
  P1A_V10_MINIMAL_ASSERTION_SCHEMA,
} from "./prompt-benchmark/promptSets/p1aV10MinimalWholeArticleAssertions.js";

const input = {
  article: { title: "A generic article" },
  structuralBlocks: [
    { blockId: "B001", heading: "Opening", structuralType: "paragraph",
      sourceUnitIds: ["U0001", "U0002"] },
  ],
  sourceUnits: [
    { unitId: "U0001", text: "Institution A states that P." },
    { unitId: "U0002", text: "The author disputes P and advances Q." },
  ],
};

test("P1aV10 exposes only assertion text and grounding IDs", () => {
  const prompt = buildP1aV10MinimalWholeArticleAssertionsPrompt(input);
  const root = prompt.responseSchema.schema;
  const collection = root.properties.assertions;
  assert.deepEqual(root.required, ["assertions"]);
  assert.deepEqual(collection.items.required, ["assertionText", "sourceUnitIds"]);
  assert.deepEqual(Object.keys(collection.items.properties),
    ["assertionText", "sourceUnitIds"]);
});

test("P1aV10 has no model-facing assertion-count floor or ceiling", () => {
  const collection = P1A_V10_MINIMAL_ASSERTION_SCHEMA.schema.properties.assertions;
  assert.equal(Object.hasOwn(collection, "minItems"), false);
  assert.equal(Object.hasOwn(collection, "maxItems"), false);
  const prompt = buildP1aV10MinimalWholeArticleAssertionsPrompt(input);
  assert.doesNotMatch(`${prompt.system}\n${prompt.user}`,
    /\b(?:at least|at most|up to|between|minimum|maximum)\s+\d+/i);
});

test("P1aV10 retains whole-article, atomicity, polarity, and grounding instructions", () => {
  const prompt = buildP1aV10MinimalWholeArticleAssertionsPrompt(input);
  assert.match(prompt.system, /complete supplied article/i);
  assert.match(prompt.system, /one primary subject and one independently testable predicate/i);
  assert.match(prompt.system, /original polarity/i);
  assert.match(prompt.system, /source-unit IDs/i);
  assert.match(prompt.user, /U0001/);
  assert.match(prompt.user, /U0002/);
});

test("P1aV10 prompt is fixture-neutral", () => {
  const prompt = buildP1aV10MinimalWholeArticleAssertionsPrompt(input);
  assert.doesNotMatch(`${prompt.system}\n${prompt.user}`,
    /\b(?:vaccine|vaccination|CDC|JCPH|thimerosal|MMR|autism|Ana Wolpin)\b/i);
});
