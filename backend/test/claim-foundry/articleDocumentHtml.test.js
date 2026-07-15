import test from "node:test";
import assert from "node:assert/strict";
import { articleDocumentFromHtml, verifyArticleDocument } from "../../src/claim-foundry/article-document/index.js";

const HTML = `<!doctype html><html><head><title>Wrong shell title</title></head><body>
  <nav><a href="/subscribe">Subscribe</a></nav>
  <article>
    <h1>Bridge Audit</h1>
    <p><strong>Inspectors found delays.</strong> The report names procurement records.</p>
    <blockquote>"Nine months elapsed," the auditor said.</blockquote>
    <h2>Sources</h2>
    <ul><li><a href="/study">Published study</a></li><li>City records</li></ul>
    <table><tr><th>Year</th><th>Delay</th></tr><tr><td>2024</td><td>9 months</td></tr></table>
    <figcaption>Table 1. Recorded delays.</figcaption>
    <aside>Related story should disappear.</aside>
  </article>
</body></html>`;

test("HTML adapter retains structural atoms and content-link proximity", () => {
  const document = articleDocumentFromHtml({ html: HTML, url: "https://news.example/a",
    metadata: { title: "Bridge Audit" } });

  assert.equal(document.diagnostics.selectedRoot, "article");
  assert.deepEqual(document.atoms.map((atom) => atom.type), [
    "heading", "paragraph", "quotation", "heading", "list_item", "list_item",
    "table_row", "table_row", "caption",
  ]);
  assert.equal(document.canonicalText.includes("Related story"), false);
  assert.equal(document.canonicalText.includes("Subscribe"), false);
  assert.equal(document.links.length, 1);
  assert.equal(document.links[0].url, "https://news.example/study");
  assert.equal(document.links[0].atomId, "A0005");
  assert.ok(document.atoms[1].layoutSignals.boldProportion > 0);
  assert.equal(verifyArticleDocument(document).valid, true);
});

test("HTML adapter records horizontal separators on the following atom", () => {
  const document = articleDocumentFromHtml({
    html: "<article><p>First supported point.</p><hr><p>Second supported point.</p></article>",
    url: "https://example.test/article", metadata: { title: "Separator" },
  });
  assert.equal(document.atoms[1].layoutSignals.separatorBefore, true);
});
