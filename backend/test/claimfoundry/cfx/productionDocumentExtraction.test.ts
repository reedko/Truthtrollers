import assert from "node:assert/strict";
import test from "node:test";
import {
  extractProductionHtmlDocument,
  extractProductionReadableHtml,
  isProductionBotChallengeHtml,
  productionDocumentType,
} from "../../../src/core/productionDocumentExtraction.js";

const prose = Array.from({length:90}, (_, index) =>
  `Sentence ${index} records a measured result in the evidence document.`).join(" ");

test("production extraction retains legitimate article HTML before blocker classification", async () => {
  const html = `<!doctype html><html><head>
    <title>Measured evidence</title>
    <meta name="author" content="Ada Researcher">
    <meta property="og:site_name" content="Example Journal">
    </head><body><article><h1>Measured evidence</h1>
    <p>This article discusses why a CAPTCHA can ask whether you are a robot.</p>
    <p>${prose}</p></article></body></html>`;
  assert.equal(isProductionBotChallengeHtml(html), false);
  const document = await extractProductionHtmlDocument({
    rawHtml: html,
    url: "https://example.test/measured-evidence",
  });
  assert.match(document.text, /Sentence 89 records/u);
  assert.equal(document.title, "Measured evidence");
  assert.ok(document.authors.some((author:any) =>
    String(author?.name || author).includes("Ada Researcher")));
  assert.notEqual(document.extractionMethod, "empty");
});

test("production challenge detection requires challenge structure or a small non-article shell", () => {
  assert.equal(isProductionBotChallengeHtml(
    '<html><body><form id="challenge-form"><div class="g-recaptcha"></div></form></body></html>',
  ), true);
  const article = `<html><body><article><p>${prose} Checking your browser is discussed here.</p></article></body></html>`;
  assert.equal(isProductionBotChallengeHtml(article), false);
  assert.match(extractProductionReadableHtml(article).text, /Sentence 89/u);
});

test("production content classification recognizes PDF headers and magic bytes", () => {
  assert.equal(productionDocumentType({
    url:"https://example.test/download?id=7",
    contentType:"application/pdf",
  }), "pdf");
  assert.equal(productionDocumentType({
    url:"https://example.test/download?id=7",
    contentType:"application/octet-stream",
    bodyBuffer:Buffer.from("%PDF-1.7 fake"),
  }), "pdf");
  assert.equal(productionDocumentType({
    url:"https://facebook.com/groups/example/posts/1",
    contentType:"text/html",
  }), "facebook");
});
