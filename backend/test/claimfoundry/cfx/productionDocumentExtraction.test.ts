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

test("republished article keeps outlet, parent, original publisher, URL, and author distinct", async () => {
  const html = `<!doctype html><html><head>
    <title>Evidence | The Scientist</title>
    <meta property="og:site_name" content="The Scientist">
    <meta name="author" content="Jake Scott, MD, The Conversation">
    <script type="application/ld+json">{
      "@type":"Article","publisher":{"name":"The Scientist Magazine"},
      "isPartOf":{"@type":"Periodical","name":"The Scientist"}
    }</script></head><body><article><p>${prose}</p>
    <p>This article is republished from The Conversation under a Creative Commons license.
       Read the <a href="https://theconversation.com/original-story">original article</a>.</p></article>
    <footer>Now part of the <a href="https://labx.com">LabX Media Group</a>:</footer>
    </body></html>`;
  const document = await extractProductionHtmlDocument({
    rawHtml:html,url:"https://www.the-scientist.com/evidence",
  });
  assert.ok(document.publishingIdentity);
  const identity:any = (document as any).publishingIdentity;
  assert.equal(identity.entities.publication_venue.name, "The Scientist");
  assert.equal(identity.entities.parent_organization.name, "LabX Media Group");
  assert.equal(identity.entities.original_publisher.name, "The Conversation");
  assert.equal(identity.context.publication_relationship.type, "republished");
  assert.equal(identity.context.publication_relationship.license, "Creative Commons");
  assert.equal(identity.context.publication_relationship.originalUrl, "https://theconversation.com/original-story");
  assert.deepEqual(document.authors.map((author:any) => author.name), ["Jake Scott, MD"]);
});

test("program provenance separates SHVS from its parent and preserves the host alias", async () => {
  const html = `<!doctype html><html><head><title>State update</title></head>
    <body><article><p>${prose}</p></article><footer>
    © 2019 State Health and Value Strategies is a program of the Robert Wood Johnson Foundation.
    </footer></body></html>`;
  const document = await extractProductionHtmlDocument({rawHtml:html,url:"https://shvs.org/update"});
  assert.ok(document.publishingIdentity);
  const identity:any = (document as any).publishingIdentity;
  assert.equal(identity.entities.publishing_organization.name, "State Health and Value Strategies");
  assert.equal(identity.entities.parent_organization.name, "Robert Wood Johnson Foundation");
  assert.equal(identity.entities.parent_organization.relationship_type, "program_of");
  assert.deepEqual(identity.context.raw_metadata.aliases, ["SHVS"]);
});
