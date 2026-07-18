import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { validateArticleInput } from "../../src/claim-foundry/validateArticleInput.js";
import { proposeStructuralBlocks } from "../../src/claim-foundry/structuralBlocks.js";
import { chooseExecutionPath } from "../../src/claim-foundry/tokenBudget.js";

// Fixture integrity is proven from SAFE metadata only (fixture-metadata.json:
// identity, hashes, rights, sizing class). Semantic expectations live in the
// sealed evaluation keys under prompt-evaluation-keys/ and must never be read
// by generation-side code or tests (coder plan §10.7).
async function load(name) {
  const url = new URL(`fixtures/${name}`, import.meta.url);
  return JSON.parse(await readFile(url, "utf8"));
}

for (const fixtureId of ["CF1-F01", "CF1-F02", "CF1-F03", "CF1-F04", "CF1-F05", "CF1-F06", "CF1-F07", "CF1-F08"]) {
  test(`${fixtureId} is frozen with a stable article identity`, async () => {
    const article = await load(`${fixtureId}/article.json`);
    const metadata = await load(`${fixtureId}/fixture-metadata.json`);
    assert.equal(metadata.schemaVersion, "cf1.fixtureMetadata.v1");
    assert.equal(metadata.fixtureId, fixtureId);
    const normalized = validateArticleInput(article);
    assert.equal(normalized.contentHash, metadata.source.articleContentHash);
    assert.equal(metadata.status, "frozen");
    assert.equal(metadata.approval.status, "approved");
    assert.equal(metadata.approval.reviewers.length, 2);
    const blocks = proposeStructuralBlocks(normalized);
    const decision = chooseExecutionPath({ article: normalized, structuralBlocks: blocks,
      modelContextTokens: 128_000, promptOverheadTokens: 10_000 });
    assert.equal(decision.path, metadata.expectedExecutionPath);
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
