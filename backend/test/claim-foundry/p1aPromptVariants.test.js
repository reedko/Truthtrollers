import test from "node:test";
import assert from "node:assert/strict";
import { prepareArticle } from "./prompt-benchmark/generationRun.js";
import { buildP1aV2BaselinePrompt } from "./prompt-benchmark/promptSets/p1aV2Baseline.js";
import { buildSplitCall1aClaimLanguagePrompt }
  from "./prompt-benchmark/promptSets/splitCall1aDiscoveryPromptClaimLanguageV3.js";
import { buildP1aV4AssertionPrompt }
  from "./prompt-benchmark/promptSets/p1aV4Assertion.js";
import { buildP1aV5NoMaterialityPrompt }
  from "./prompt-benchmark/promptSets/p1aV5NoMateriality.js";
import { buildP1aV6AssertionNoMaterialityPrompt }
  from "./prompt-benchmark/promptSets/p1aV6AssertionNoMateriality.js";

const article = { title: "Test", text: "A sufficiently long article body for prompt assembly.",
  authors: [] };
const prepared = prepareArticle(article);
const input = { article, structuralBlocks: prepared.structuralBlocks,
  sourceUnits: prepared.articleDocument.sourceUnits };

test("P1aV2-baseline is byte-identical to the current executable prompt", () => {
  assert.deepEqual(buildP1aV2BaselinePrompt(input),
    buildSplitCall1aClaimLanguagePrompt(input));
});

test("P1aV4 uses assertion terminology consistently in instructions and schema", () => {
  const prompt = buildP1aV4AssertionPrompt(input);
  const instructions = `${prompt.system}\n${prompt.user.split("TITLE:")[0]}`;
  assert.doesNotMatch(instructions, /\b(?:claim|claims|proposition|propositions)\b/i);
  assert.ok(prompt.responseSchema.schema.properties.assertions);
  assert.ok(prompt.responseSchema.schema.properties.assertions.items.properties.assertionText);
  assert.ok(prompt.responseSchema.schema.properties.assertions.items.properties.materiality);
});

test("P1aV5 removes only materiality from the current model response contract", () => {
  const baseline = buildP1aV2BaselinePrompt(input);
  const xmat = buildP1aV5NoMaterialityPrompt(input);
  assert.equal(xmat.system, baseline.system);
  assert.equal(xmat.user, baseline.user);
  assert.ok(!xmat.responseSchema.schema.properties.candidateClaims.items
    .properties.materiality);
});

test("P1aV6 combines assertion terminology and no-materiality", () => {
  const prompt = buildP1aV6AssertionNoMaterialityPrompt(input);
  const item = prompt.responseSchema.schema.properties.assertions.items;
  assert.ok(item.properties.assertionText);
  assert.ok(!item.properties.materiality);
  assert.ok(!item.required.includes("materiality"));
});
