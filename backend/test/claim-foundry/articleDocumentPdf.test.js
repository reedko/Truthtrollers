import test from "node:test";
import assert from "node:assert/strict";
import { articleDocumentFromPdf, extractPdfLayout, verifyArticleDocument } from "../../src/claim-foundry/article-document/index.js";

const item = (str, x, y, size = 10, fontName = "Body") => ({
  str, width: str.length * size * 0.45, height: size, fontName,
  transform: [size, 0, 0, size, x, y],
});

test("PDF adapter removes repeated edges and retains layout signals", () => {
  const pages = [1, 2].map((pageNumber) => ({ pageNumber, items: [
    item(`Journal page ${pageNumber}`, 40, 780, 8),
    item(pageNumber === 1 ? "RESULTS" : "DISCUSSION", 40, 740, 14, "Heading-Bold"),
    item("The measured associ-", 40, 710),
    item("ation was similar between groups.", 40, 698),
    item(String(pageNumber), 300, 30, 8),
  ], annotations: pageNumber === 1 ? [
    { url: "https://example.org/paper", rect: [35, 690, 300, 715] },
    { url: "https://example.org/reference", rect: [35, 500, 300, 510] },
  ] : [] }));

  const document = articleDocumentFromPdf({ pages, metadata: { title: "PDF study" } });
  assert.equal(document.canonicalText.includes("Journal page"), false);
  assert.equal(document.canonicalText.includes("association was similar"), true);
  assert.equal(document.diagnostics.removedRepeatedLines, 4);
  assert.equal(document.diagnostics.dehyphenatedLines, 2);
  assert.equal(document.atoms[0].type, "heading");
  assert.equal(document.atoms[0].layoutSignals.pdfPage, 1);
  assert.ok(document.links.some((link) => link.url === "https://example.org/paper"));
  assert.equal(document.diagnostics.linkCoverage.annotationLinkCount, 2);
  assert.equal(document.diagnostics.linkCoverage.unattachedAnnotationLinkCount, 1);
  assert.ok(document.links.some((link) => link.url === "https://example.org/reference"
    && link.diagnosticFlags.includes("page_proximity")));
  assert.equal(verifyArticleDocument(document).valid, true);
});

test("PDF layout extraction captures text items and annotations without live routes", async () => {
  const fakePage = {
    pageNumber: 1,
    getTextContent: async () => ({ items: [item("Methods", 40, 700, 12, "Bold")] }),
    getAnnotations: async () => [{ url: "https://example.org/methods", rect: [40, 690, 100, 710] }],
  };
  const fakePdfParse = async (_buffer, options) => {
    await options.pagerender(fakePage);
    return { info: { Title: "Methods" }, numpages: 1 };
  };
  const layout = await extractPdfLayout(Buffer.from("fake"), { pdfParse: fakePdfParse });
  assert.equal(layout.pages[0].items[0].fontName, "Bold");
  assert.equal(layout.pages[0].annotations[0].url, "https://example.org/methods");
  assert.equal(layout.metadata.pageCount, 1);
});
