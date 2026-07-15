import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { validateArticleInput } from "../../src/claim-foundry/validateArticleInput.js";
import { proposeStructuralBlocks } from "../../src/claim-foundry/structuralBlocks.js";
import { chooseExecutionPath } from "../../src/claim-foundry/tokenBudget.js";

async function load(name) {
  const url = new URL(`fixtures/${name}`, import.meta.url);
  return JSON.parse(await readFile(url, "utf8"));
}

for (const fixtureId of ["CF1-F01", "CF1-F02", "CF1-F03", "CF1-F04", "CF1-F05", "CF1-F06", "CF1-F07", "CF1-F08"]) {
  test(`${fixtureId} is grounded with a stable article identity`, async () => {
    const article = await load(`${fixtureId}/article.json`);
    const expectations = await load(`${fixtureId}/expectations.json`);
    const normalized = validateArticleInput(article);
    assert.equal(normalized.contentHash, expectations.source.articleContentHash);
    assert.equal(expectations.status, "frozen");
    assert.equal(expectations.approval.status, "approved");
    assert.equal(expectations.approval.reviewers.length, 2);
    const searchableText = normalized.text.replace(/\s+/g, " ");
    for (const region of expectations.requiredSourceRegions) {
      assert.ok(searchableText.includes(region.excerpt.replace(/\s+/g, " ")),
        `missing required region: ${region.label}`);
    }
    const blocks = proposeStructuralBlocks(normalized);
    const decision = chooseExecutionPath({ article: normalized, structuralBlocks: blocks,
      modelContextTokens: 128_000, promptOverheadTokens: 10_000 });
    assert.equal(decision.path, expectations.expectedExecutionPath);
  });
}

test("F03 deterministically selects the configured long path", async () => {
  const article = await load("CF1-F03/article.json");
  const blocks = proposeStructuralBlocks(article);
  const decision = chooseExecutionPath({ article, structuralBlocks: blocks,
    modelContextTokens: 128_000, promptOverheadTokens: 10_000 });
  assert.equal(decision.path, "long");
  assert.ok(decision.blockCount > 80);
});
