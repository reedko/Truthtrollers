import test from "node:test";
import assert from "node:assert/strict";
import { articleDocumentFromText, verifyArticleDocument } from "../../src/claim-foundry/article-document/index.js";

test("text adapter preserves visible structure and exact canonical provenance", () => {
  const document = articleDocumentFromText({
    text: [
      "# Audit Findings",
      "",
      "The audit found a delay. The agency disputed that conclusion.",
      "",
      "> The record is incomplete.",
      "",
      "- first source",
      "- second source",
      "",
      "Study | Result",
      "Alpha | Positive",
    ].join("\r\n"),
    metadata: { title: "Audit report", language: "en" },
  });

  assert.deepEqual(document.atoms.map((atom) => atom.type), [
    "heading", "paragraph", "quotation", "list_item", "list_item", "table_row", "table_row",
  ]);
  assert.equal(document.sourceUnits.filter((unit) => unit.atomId === "A0002").length, 2);
  assert.equal(document.atoms[3].text, "- first source");
  assert.equal(document.canonicalText.includes("\r"), false);
  assert.equal(document.sourceFamily, "plain_text");
  assert.deepEqual(document.adapterIdentity,
    { adapterId: "cf1.adapter.text-structure", adapterVersion: "2" });
  assert.match(document.structureProfile.profileHash, /^[a-f0-9]{64}$/);
  assert.equal(verifyArticleDocument(document).valid, true);
  for (const unit of document.sourceUnits) {
    assert.equal(document.canonicalText.slice(unit.sourceOffsets.start, unit.sourceOffsets.end), unit.text);
  }
});

test("text transport can record a reviewed transcript profile without a new parser", () => {
  const document = articleDocumentFromText({ text: "00:01 Speaker: This is a transcript turn.",
    metadata: { title: "Transcript" }, sourceFamily: "transcript" });
  assert.equal(document.sourceKind, "text");
  assert.equal(document.sourceFamily, "transcript");
  assert.equal(document.structureProfile.profileId, "cf1sp-default-transcript");
  assert.equal(verifyArticleDocument(document).valid, true);
});

test("visible text URLs retain atom and source-unit proximity", () => {
  const document = articleDocumentFromText({
    text: "The source is https://example.org/study. It describes the methods.",
    metadata: { title: "Linked report" },
  });
  assert.equal(document.links.length, 1);
  assert.equal(document.links[0].url, "https://example.org/study");
  assert.equal(document.links[0].atomId, "A0001");
  assert.equal(document.links[0].unitId, "U0001");
  assert.deepEqual(document.diagnostics.linkCoverage, { visibleUrlCount: 1,
    annotationLinkCount: 0, unattachedAnnotationLinkCount: 0,
    attachmentMode: "visible_text_only", sourceAnnotationsAvailable: false });
});

test("ArticleDocument verifier detects mutated atom and unit provenance", () => {
  const document = articleDocumentFromText({
    text: "A complete factual sentence appears here.", metadata: { title: "Mutation test" },
  });
  document.atoms[0].text = "Invented text";
  document.sourceUnits[0].atomId = "A9999";
  const codes = new Set(verifyArticleDocument(document).issues.map((item) => item.code));
  assert.ok(codes.has("CF1_ARTICLE_ATOM_OFFSETS"));
  assert.ok(codes.has("CF1_ARTICLE_UNIT_ATOM"));
});

test("ArticleDocument verifier detects coverage and link-reference corruption", () => {
  const document = articleDocumentFromText({
    text: "See https://example.org/source for the complete finding.",
    metadata: { title: "Invariant test" },
  });
  document.canonicalText = `X${document.canonicalText}`;
  document.atoms[0].linkIds = ["L9999"];
  const codes = new Set(verifyArticleDocument(document).issues.map((item) => item.code));
  assert.ok(codes.has("CF1_ARTICLE_ATOM_COVERAGE"));
  assert.ok(codes.has("CF1_ARTICLE_ATOM_LINK"));
});
