import test from "node:test";
import assert from "node:assert/strict";
import { articleDocumentFromHtml, articleDocumentFromText,
  buildArticleSourceBlocks, verifyArticleDocument } from "../../src/claim-foundry/article-document/index.js";
import { validateArticleInput } from "../../src/claim-foundry/validateArticleInput.js";
import { normalizeAgentDraft } from "../../src/claim-foundry/normalizeAgentDraft.js";
import { assembleCf1Package } from "../../src/claim-foundry/assemblePackage.js";
import { verifySourceIdentity } from "../../src/claim-foundry/verifySourceIdentity.js";
import { createPackageId, createRunId } from "../../src/claim-foundry/ids.js";
import { createAgentDraft } from "./fixtures/packages.js";

const documentFor = (body) => articleDocumentFromHtml({
  html: `<article><h1>Citation test</h1>${body}</article>`, url: "https://article.test/item",
  metadata: { title: "Citation test" },
});

test("inline study link retains URL, anchor text, and source-unit offsets", () => {
  const document = documentFor(`<p>The <a href="https://example.org/study">named study</a> reported a result.</p>`);
  assert.deepEqual({ anchorText: document.links[0].anchorText, startOffset: document.links[0].startOffset,
    relation: document.links[0].relation, unitId: document.links[0].unitId },
  { anchorText: "named study", startOffset: 4, relation: "inline_link", unitId: "U0002" });
  assert.equal(verifyArticleDocument(document).valid, true);
});

test("superscript numeric citation resolves to its reference entry", () => {
  const document = documentFor(`<p>Reported result<sup><a href="#ref-12">12</a></sup>.</p>
    <h2>References</h2><ol><li id="ref-12">12. A named report.</li></ol>`);
  assert.equal(document.citationMarkers[0].resolvedReferenceId, "REF001");
  assert.deepEqual(document.references[0].markerIds, ["CM001"]);
  assert.deepEqual(document.sourceUnits[1].citationMarkerIds, ["CM001"]);
});

test("footnote DOI link survives while canonical text remains clean", () => {
  const html = `<article><h1>Citation test</h1><p>A factual sentence appears here.</p>
    <aside role="doc-footnote"><p id="fn-1">1. Report DOI
    <a href="https://doi.org/10.1234/example.7">10.1234/example.7</a></p></aside></article>`;
  const document = articleDocumentFromHtml({ html, url: "https://article.test/item",
    metadata: { title: "Citation test" } });
  assert.match(document.canonicalText, /Report DOI 10\.1234\/example\.7/);
  assert.equal(document.references[0].linkIds[0], document.links[0].linkId);
  assert.equal(document.links[0].classification, "identifier");
  assert.equal(document.canonicalText.includes("<a"), false);
});

test("author-year citation without a link remains an unresolved marker", () => {
  const document = documentFor("<p>The result was replicated (Smith et al., 2020).</p>");
  assert.deepEqual({ text: document.citationMarkers[0].displayText,
    kind: document.citationMarkers[0].kind, reference: document.citationMarkers[0].resolvedReferenceId },
  { text: "Smith et al., 2020", kind: "author_year", reference: null });
});

test("repeated citations resolve to one stable reference", () => {
  const document = documentFor(`<p>First<a href="#ref-4"><sup>4</sup></a>.</p>
    <p>Second<sup><a href="#ref-4">4</a></sup>.</p><h2>References</h2>
    <ol><li id="ref-4">4. Repeated work.</li></ol>`);
  assert.equal(document.references.length, 1);
  assert.deepEqual(document.references[0].markerIds, ["CM001", "CM002"]);
});

test("citation marker offset follows DOM position when the label appears earlier in a DOI", () => {
  const document = documentFor(`<p>DOI:10.1234/12.7 reports a result<sup><a href="#ref-12">12</a></sup>.</p>
    <h2>References</h2><ol><li id="ref-12">12. Repeated-number work.</li></ol>`);
  const marker = document.citationMarkers[0];
  const atom = document.atoms.find((item) => item.atomId === marker.atomId);
  assert.equal(marker.startOffset, atom.text.lastIndexOf("12"));
  assert.equal(atom.text.slice(marker.startOffset, marker.endOffset), "12");
});

test("broken fragment citation is retained with a diagnostic", () => {
  const document = documentFor(`<p>Claim<sup><a href="#missing-ref">9</a></sup>.</p>`);
  assert.equal(document.citationMarkers[0].resolvedReferenceId, null);
  assert.ok(document.citationMarkers[0].diagnosticFlags.includes("unresolved_fragment"));
});

test("navigation and social links do not become retrieval leads", () => {
  const document = articleDocumentFromHtml({ html: `<body><nav><a href="/login">Login</a></nav>
    <article><h1>Citation test</h1><p>A factual sentence with
    <a class="share" href="https://social.test/share">Share</a> context.</p></article></body>`,
  url: "https://article.test/item", metadata: { title: "Citation test" } });
  assert.equal(document.canonicalText.includes("Login"), false);
  assert.equal(document.links.length, 0);
  assert.equal(document.canonicalText.includes("Share"), false);
});

test("plain pasted text without markup creates empty citation sidecars", () => {
  const document = articleDocumentFromText({ text: "A plain article reports a sufficiently detailed factual result.",
    metadata: { title: "Plain article" } });
  assert.deepEqual({ links: document.links, markers: document.citationMarkers,
    references: document.references }, { links: [], markers: [], references: [] });
});

test("package connects a reference identity bundle to claim, target, and card", () => {
  const document = documentFor(`<p>The audit found a delay<sup><a href="#ref-12">12</a></sup>.</p>
    <h2>References</h2><ol><li id="ref-12">12. Named study. doi:10.1234/example.7</li></ol>`);
  const article = validateArticleInput({ title: "Citation test", text: document.canonicalText,
    authors: ["Alex Author"], publisher: "Example Journal", publishedAt: "2020-01-01T00:00:00Z" });
  const blocks = buildArticleSourceBlocks(document, { targetMinChars: 1, targetMaxChars: 500,
    hardMaxChars: 1_000 });
  const draft = createAgentDraft();
  const normalized = normalizeAgentDraft(draft, { article, articleDocument: document,
    structuralBlocks: blocks });
  const pkg = assembleCf1Package({ article, articleDocument: document, normalizedDraft: normalized,
    packageId: createPackageId(), runId: createRunId() });
  const claim = pkg.selectedEvaluationClaims[0];
  const target = pkg.phase3Targets[0];
  const card = pkg.evidenceNeedCards[0];
  const referenceBundle = pkg.sourceIdentityBundles.find((item) =>
    item.articleReferenceIds.includes("REF001"));
  assert.ok(referenceBundle);
  assert.deepEqual(referenceBundle.identifiers.doi, ["10.1234/example.7"]);
  assert.ok(claim.identityBundleIds.includes(referenceBundle.identityBundleId));
  assert.deepEqual(target.identityBundleIds, claim.identityBundleIds);
  assert.deepEqual(card.articleReferenceIds, ["REF001"]);
});

test("a labeled text DOI becomes a grounded primary-article identity hint", () => {
  const document = articleDocumentFromText({ text: "doi:10.7777/plain.9\n\nThe article reports a complete factual result.",
    metadata: { title: "Text DOI" } });
  const article = validateArticleInput({ title: "Text DOI", text: document.canonicalText });
  const blocks = buildArticleSourceBlocks(document, { targetMinChars: 1, targetMaxChars: 500,
    hardMaxChars: 1_000 });
  const normalized = normalizeAgentDraft(createAgentDraft(), { article, articleDocument: document,
    structuralBlocks: blocks });
  assert.deepEqual(normalized.sourceIdentityBundles[0].identifiers.doi, ["10.7777/plain.9"]);
});

test("primary identity strips generic affiliation footnote markers", () => {
  const document = articleDocumentFromText({ text: `From the *National Immunization Program,
    Centers for Disease Control and Prevention; and §National Center on Birth Defects,
    Centers for Disease Control and Prevention. Received for publication January 1.

    The article reports a sufficiently detailed factual result.`,
  metadata: { title: "Affiliation markers" } });
  const article = validateArticleInput({ title: "Affiliation markers", text: document.canonicalText });
  const blocks = buildArticleSourceBlocks(document, { targetMinChars: 1, targetMaxChars: 500,
    hardMaxChars: 1_000 });
  const normalized = normalizeAgentDraft(createAgentDraft(), { article, articleDocument: document,
    structuralBlocks: blocks });
  assert.deepEqual(normalized.sourceIdentityBundles[0].institutions,
    ["National Immunization Program, Centers for Disease Control and Prevention",
      "National Center on Birth Defects, Centers for Disease Control and Prevention."]);
  const pkg = assembleCf1Package({ article, articleDocument: document, normalizedDraft: normalized,
    packageId: createPackageId(), runId: createRunId() });
  assert.equal(verifySourceIdentity(pkg).some((error) =>
    error.code === "CF1_SOURCE_IDENTITY_UNGROUNDED"), false);
});

test("HTML citation metadata becomes host-grounded primary identity fields", () => {
  const document = articleDocumentFromHtml({ html: `<html><head>
    <meta name="citation_title" content="A Grounded Study">
    <meta name="citation_author" content="A. Researcher">
    <meta name="citation_journal_title" content="Example Journal">
    <meta name="citation_publication_date" content="2021-04-03">
    <meta name="citation_doi" content="10.5555/grounded.1"></head><body><article>
    <h1>A Grounded Study</h1><p>The study reports a sufficiently detailed factual result.</p>
    </article></body></html>`, url: "https://article.test/grounded" });
  const article = validateArticleInput({ title: "A Grounded Study", text: document.canonicalText });
  const blocks = buildArticleSourceBlocks(document, { targetMinChars: 1, targetMaxChars: 500,
    hardMaxChars: 1_000 });
  const normalized = normalizeAgentDraft(createAgentDraft(), { article, articleDocument: document,
    structuralBlocks: blocks });
  const primary = normalized.sourceIdentityBundles[0];
  assert.deepEqual({ authors: primary.workAuthors, venue: primary.publicationVenue,
    year: primary.publicationYear, doi: primary.identifiers.doi },
  { authors: ["A. Researcher"], venue: "Example Journal", year: 2021,
    doi: ["10.5555/grounded.1"] });
});

test("source-identity verifier rejects invented bibliographic metadata", () => {
  const document = documentFor(`<p>The audit found a delay<sup><a href="#ref-12">12</a></sup>.</p>
    <h2>References</h2><ol><li id="ref-12">12. Named study. doi:10.1234/example.7</li></ol>`);
  const article = validateArticleInput({ title: "Citation test", text: document.canonicalText,
    authors: ["Alex Author"], publisher: "Example Journal", publishedAt: "2020-01-01T00:00:00Z" });
  const blocks = buildArticleSourceBlocks(document, { targetMinChars: 1, targetMaxChars: 500,
    hardMaxChars: 1_000 });
  const normalized = normalizeAgentDraft(createAgentDraft(), { article, articleDocument: document,
    structuralBlocks: blocks });
  const pkg = assembleCf1Package({ article, articleDocument: document, normalizedDraft: normalized,
    packageId: createPackageId(), runId: createRunId() });
  pkg.sourceIdentityBundles[0].workAuthors.push("Invented Person");
  assert.ok(verifySourceIdentity(pkg).some((error) =>
    error.code === "CF1_SOURCE_IDENTITY_UNGROUNDED"));
});

test("duplicate URL occurrences retain link provenance but share one identity bundle", () => {
  const document = documentFor(`<p>The audit links <a href="https://example.org/work">the work</a>
    and <a href="https://example.org/work">its record</a> in the same claim.</p>`);
  const article = validateArticleInput({ title: "Citation test", text: document.canonicalText });
  const blocks = buildArticleSourceBlocks(document, { targetMinChars: 1, targetMaxChars: 500,
    hardMaxChars: 1_000 });
  const normalized = normalizeAgentDraft(createAgentDraft(), { article, articleDocument: document,
    structuralBlocks: blocks });
  const linkBundles = normalized.sourceIdentityBundles.filter((bundle) =>
    bundle.identityKind === "article_link");
  assert.equal(document.links.length, 2);
  assert.equal(linkBundles.length, 1);
  assert.deepEqual(linkBundles[0].articleLinkIds, ["L0001", "L0002"]);
});
