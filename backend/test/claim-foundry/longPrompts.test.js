import test from "node:test";
import assert from "node:assert/strict";
import { buildBlockObservationPrompt } from "../../src/claim-foundry/prompts/blockObservationPrompt.js";
import { buildSynthesisPrompt } from "../../src/claim-foundry/prompts/synthesisPrompt.js";
import { createArticleAndBlocks } from "./fixtures/packages.js";

test("block observation prompt forbids final selection and outside research", () => {
  const { article, structuralBlocks, articleDocument } = createArticleAndBlocks();
  const units = new Map(articleDocument.sourceUnits.map((unit) => [unit.unitId, unit]));
  const blocks = structuralBlocks.map((block) => ({ ...block,
    sourceUnits: block.sourceUnitIds.map((id) => units.get(id)) }));
  const prompt = buildBlockObservationPrompt({ article, batchId: "L01", blocks });
  assert.match(prompt.system, /Do not select final claims/);
  assert.match(prompt.system, /browse, search, fetch/);
  assert.match(prompt.user, /B001/);
  assert.match(prompt.user, /U0002/);
  assert.equal(prompt.responseSchema.strict, true);
});

test("synthesis prompt requires global cross-batch and late-article analysis", () => {
  const { article } = createArticleAndBlocks();
  const prompt = buildSynthesisPrompt({ article, observations: [
    { batchId: "L01", blockIds: ["B001"] }, { batchId: "L02", blockIds: ["B002"] },
  ] });
  assert.match(prompt.user, /cross-batch internal consistency/);
  assert.match(prompt.user, /late assertions/);
  assert.match(prompt.user, /not by batch quota or article order/);
  assert.match(prompt.system, /single whole-article synthesis/);
});
