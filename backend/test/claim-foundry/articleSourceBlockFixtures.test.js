import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { articleDocumentFromText, buildArticleSourceBlocks,
  verifyArticleSourceBlocks } from "../../src/claim-foundry/article-document/index.js";

const fixtureRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");

for (const fixtureId of ["CF1-F01", "CF1-F03", "CF1-F05", "CF1-F06"]) {
  test(`${fixtureId} source blocks retain the frozen canonical text`, async () => {
    const article = JSON.parse(await readFile(path.join(fixtureRoot, fixtureId, "article.json"), "utf8"));
    const document = articleDocumentFromText({ text: article.text,
      metadata: { title: article.title, language: article.language },
      sourceDescriptor: { fixtureId } });
    const blocks = buildArticleSourceBlocks(document);
    assert.equal(document.canonicalText, article.text);
    assert.ok(blocks.length > 0);
    assert.equal(verifyArticleSourceBlocks(document, blocks).valid, true);
  });
}
