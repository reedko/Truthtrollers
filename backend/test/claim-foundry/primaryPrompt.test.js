import test from "node:test";
import assert from "node:assert/strict";
import { buildPrimaryPrompt } from "../../src/claim-foundry/prompts/primaryPrompt.js";
import { createArticleAndBlocks } from "./fixtures/packages.js";

test("primary prompt supplies the whole article map task and strict draft schema", () => {
  const { article, structuralBlocks, articleDocument } = createArticleAndBlocks();
  const prompt = buildPrimaryPrompt({ article, structuralBlocks,
    sourceUnits: articleDocument.sourceUnits });

  assert.match(prompt.system, /Analyze only the supplied article/);
  assert.match(prompt.system, /Never browse, search, fetch/);
  assert.match(prompt.user, /theme, its actual thesis, load-bearing pillars/);
  assert.match(prompt.user, /Create evidence-facing Phase 3 targets only from selected claims/);
  assert.match(prompt.user, /selectionCountException/);
  assert.match(prompt.user, /B001/);
  assert.match(prompt.user, /U0002/);
  assert.equal(prompt.responseSchema.strict, true);
  assert.ok(prompt.responseSchema.schema.required.includes("evidenceNeedCards"));
  assert.ok(prompt.responseSchema.schema.required.includes("selectionCountException"));
});

test("primary prompt is consumer-neutral and excludes deterministic output fields", () => {
  const prompt = buildPrimaryPrompt(createArticleAndBlocks());
  assert.doesNotMatch(prompt.system + prompt.user, /content_id|content_claims|claim_evaluation_targets/);
  assert.match(prompt.user, /Do not output source offsets, package\/run IDs, hashes/);
});
