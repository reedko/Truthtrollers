import test from "node:test";
import assert from "node:assert/strict";
import { articleDocumentFromHtml, buildArticleDocument, buildArticleSourceBlocks,
  getReviewedDefaultStructureProfile, verifyArticleSourceBlocks } from "../../src/claim-foundry/article-document/index.js";

test("headings stay with their following structural content", () => {
  const document = articleDocumentFromHtml({ metadata: { title: "Sections" }, html: `
    <article><h2>Findings</h2><p>The first finding is material.</p>
    <blockquote>The quoted result is exact.</blockquote><p>— Study author</p>
    <h2>Data</h2><table><tr><th>Group</th><th>Result</th></tr>
    <tr><td>A</td><td>Positive</td></tr></table><figcaption>Reported values</figcaption></article>`,
  });
  const blocks = buildArticleSourceBlocks(document);
  assert.equal(blocks.length, 2);
  assert.deepEqual(blocks.map((block) => block.heading), ["Findings", "Data"]);
  assert.ok(blocks[0].text.includes("Study author"));
  assert.ok(blocks[1].atomIds.some((id) => document.atoms.find((atom) => atom.atomId === id)?.type === "table_row"));
  assert.equal(verifyArticleSourceBlocks(document, blocks).valid, true);
});

test("lists and tables form readable runs while retaining exact references", () => {
  const document = articleDocumentFromHtml({ metadata: { title: "Runs" }, html: `
    <article><p>${"Context sentence. ".repeat(45)}</p><ul><li>First item</li><li>Second item</li></ul>
    <table><tr><td>Study</td><td>Result</td></tr></table></article>`,
  });
  const blocks = buildArticleSourceBlocks(document);
  assert.deepEqual(blocks.map((block) => block.structuralType), ["paragraph_group", "list", "table"]);
  assert.deepEqual(blocks.flatMap((block) => block.atomIds), document.atoms.map((atom) => atom.atomId));
  assert.deepEqual(blocks.flatMap((block) => block.sourceUnitIds), document.sourceUnits.map((unit) => unit.unitId));
});

test("PDF page changes alone do not create source-block boundaries", () => {
  const profile = getReviewedDefaultStructureProfile("document");
  const document = buildArticleDocument({ sourceKind: "pdf", sourceFamily: "document",
    adapterIdentity: { adapterId: "cf1.adapter.test-pdf", adapterVersion: "1" },
    structureProfile: profile, metadata: { title: "Page flow" }, draftAtoms: [
      { type: "paragraph", text: "The paragraph begins on page one.", layoutSignals: {
        pdfPage: 1, verticalGapAfter: 100 }, links: [] },
      { type: "paragraph", text: "The paragraph continues on page two.", layoutSignals: {
        pdfPage: 2, verticalGapAfter: 10 }, links: [] },
    ] });
  assert.equal(buildArticleSourceBlocks(document).length, 1);
});

test("reviewed visual-gap rules create same-page candidate boundaries", () => {
  const profile = getReviewedDefaultStructureProfile("document");
  const document = buildArticleDocument({ sourceKind: "pdf", sourceFamily: "document",
    adapterIdentity: { adapterId: "cf1.adapter.test-pdf", adapterVersion: "1" },
    structureProfile: profile, metadata: { title: "Visual gap" }, draftAtoms: [
      { type: "paragraph", text: "The first visible region.", layoutSignals: {
        pdfPage: 1, verticalGapAfter: 40 }, links: [] },
      { type: "paragraph", text: "The second visible region.", layoutSignals: {
        pdfPage: 1, verticalGapAfter: 10 }, links: [] },
    ] });
  const blocks = buildArticleSourceBlocks(document);
  assert.equal(blocks.length, 2);
  assert.deepEqual(blocks[1].boundaryReasons, ["large_visual_gap"]);
});

test("source-block verification rejects mutated references and text", () => {
  const document = articleDocumentFromHtml({ metadata: { title: "Mutation" },
    html: "<article><p>The complete source paragraph is retained for checking.</p></article>" });
  const blocks = buildArticleSourceBlocks(document);
  blocks[0].text = "invented";
  blocks[0].sourceUnitIds = [];
  const codes = new Set(verifyArticleSourceBlocks(document, blocks).issues.map((entry) => entry.code));
  assert.ok(codes.has("CF1_SOURCE_BLOCK_TEXT"));
  assert.ok(codes.has("CF1_SOURCE_BLOCK_UNITS"));
  assert.ok(codes.has("CF1_SOURCE_BLOCK_UNIT_COVERAGE"));
});
