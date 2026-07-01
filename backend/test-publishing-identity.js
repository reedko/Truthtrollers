import assert from "node:assert/strict";
import * as cheerio from "cheerio";

import {
  chooseLegacyPrimaryPublisher,
  extractHtmlPublishingIdentity,
} from "./src/utils/extractPublisher.js";
import { extractPdfPublishingIdentity } from "./src/utils/extractPdfPublishingIdentity.js";
import { choosePdfIdentity } from "./src/utils/pdfIdentityExtractor.js";
import { normalizeVenueType, persistSourceIdentity } from "./src/storage/persistPublishers.js";
import { persistAuthors } from "./src/storage/persistAuthors.js";
import { processPublishingIdentity } from "./src/services/publishingIdentityPipeline.js";
import { extractAuthors } from "./src/utils/extractAuthors.js";

const $ = cheerio.load(`
  <html><head>
    <meta name="citation_publisher" content="Fallback Publishing Co">
    <meta name="citation_journal_title" content="Journal of Careful Tests">
    <meta name="citation_doi" content="https://doi.org/10.1234/ABC.5">
    <meta name="citation_issn" content="1234567X">
    <meta property="og:site_name" content="Generic Site Name">
    <script type="application/ld+json">{
      "@context": "https://schema.org",
      "@graph": [{
        "@type": "ScholarlyArticle",
        "publisher": {"@type": "Organization", "name": "Precise Publishing Society"},
        "isPartOf": {"@type": "Periodical", "name": "Journal of Careful Tests"},
        "datePublished": "2025-04-02"
      }]
    }</script>
  </head><body>Article text.</body></html>
`);

const htmlIdentity = await extractHtmlPublishingIdentity($, "https://example.org/article");
assert.equal(htmlIdentity.entities.publishing_organization.name, "Precise Publishing Society");
assert.equal(htmlIdentity.entities.publication_venue.name, "Journal of Careful Tests");
assert.equal(htmlIdentity.context.context_type, "scholarly");
assert.equal(htmlIdentity.document.identifiers.find((item) => item.identifier_type === "doi")?.normalized_value, "10.1234/abc.5");
assert.equal(htmlIdentity.document.identifiers.find((item) => item.identifier_type === "issn")?.normalized_value, "1234-567X");
assert.equal(chooseLegacyPrimaryPublisher(htmlIdentity).name, "Precise Publishing Society");

const ada$ = cheerio.load(`
  <html><head>
    <title>New study finds US fluoride exposure linked to better adolescent cognitive performance | American Dental Association</title>
    <meta name="datePublished" content="2025-11-20">
    <meta name="authors" content='[{"Name":"Olivia Anderson ","Institution":"","AuthorPage":""}]'>
    <meta name="publicationname" content="ADA News">
    <meta property="creator" content="Olivia Anderson ">
    <meta property="og:type" content="article">
  </head><body>
    <main><div class="adan-article-info"><p>by <strong>Olivia Anderson</strong></p><p>November 20, 2025</p></div></main>
    <footer>© 2026 American Dental Association</footer>
  </body></html>
`);
const adaUrl = "https://adanews.ada.org/ada-news/2025/november/example/";
const adaIdentity = await extractHtmlPublishingIdentity(ada$, adaUrl);
const adaAuthors = await extractAuthors(ada$);
assert.equal(adaIdentity.entities.publishing_organization.name, "American Dental Association");
assert.equal(adaIdentity.entities.publication_venue.name, "ADA News");
assert.equal(adaIdentity.context.context_type, "web");
assert.equal(adaIdentity.context.site_name, "American Dental Association");
assert.equal(adaIdentity.context.section, "ADA News");
assert.equal(adaIdentity.document.article_type, "News article");
assert.equal(adaIdentity.document.publication_date, "2025-11-20");
assert.deepEqual(adaAuthors.map((author) => author.name), ["Olivia Anderson"]);

const pdfIdentity = extractPdfPublishingIdentity({
  info: { Creator: "Adobe InDesign", Producer: "Adobe PDF Library" },
  text: `Journal: Clinical Evidence Review\nPublisher: Evidence Medical Society\nDOI: 10.9999/TEST.1\nISSN 2049-3630`,
  sourceUrl: "https://example.org/paper.pdf",
});
assert.equal(pdfIdentity.entities.publishing_organization.name, "Evidence Medical Society");
assert.equal(pdfIdentity.entities.publication_venue.name, "Clinical Evidence Review");
assert.notEqual(pdfIdentity.entities.publishing_organization.method, "pdf_creator");
assert.equal(pdfIdentity.document.identifiers.find((item) => item.identifier_type === "doi")?.normalized_value, "10.9999/test.1");

const medtextLines = [
  "Annals of Clinical Case Studies",
  "Case Study",
  "A difficult but important clinical case",
  "Lennart Hardell1* and Mona Nilsson2",
  "Published date: Jan 31st, 2024",
  "*Corresponding author: Lennart Hardell, The Environment and Cancer Research Foundation, Örebro, Sweden",
  "© 2024 - Medtext Publications. All Rights Reserved.",
];
const medtextIdentity = choosePdfIdentity({}, medtextLines);
assert.equal(medtextIdentity.publisher_name, "Medtext Publications");
assert.equal(medtextIdentity.publication_venue, "Annals of Clinical Case Studies");
assert.equal(medtextIdentity.article_type, "Case Study");
assert.deepEqual(medtextIdentity.authors.map((author) => author.name), ["Lennart Hardell", "Mona Nilsson"]);
assert.equal(medtextIdentity.published_date, "2024-01-31");
assert.equal(medtextIdentity.methods.publisher_name, "first_page_copyright_publisher_line");
assert.equal(medtextIdentity.methods.publication_venue, "first_page_journal_like_title");

const normalizedMedtext = extractPdfPublishingIdentity({
  text: medtextLines.join("\n"),
  sourceUrl: "https://medtextpublications.com/paper.pdf",
});
assert.equal(normalizedMedtext.entities.publishing_organization.name, "Medtext Publications");
assert.equal(normalizedMedtext.entities.publication_venue.name, "Annals of Clinical Case Studies");
assert.equal(normalizedMedtext.document.article_type, "Case Study");
assert.deepEqual(normalizedMedtext.document.authors.map((author) => author.name), ["Lennart Hardell", "Mona Nilsson"]);
assert.equal(normalizedMedtext.document.publication_date, "2024-01-31");

const splitMedtextByline = choosePdfIdentity({}, [
  "Annals of Clinical Case Studies",
  "An Eight Year Old Boy Developed Severe Headache in",
  "A School Close to A Mast with 5G Base Stations",
  "Case Study",
  "Lennart Hardell1*",
  "and Mona Nilsson2",
  "1",
  "The Environment and Cancer Research Foundation, Sweden",
  "2",
  "Swedish Radiation Protection Foundation, Sweden",
  "*Corresponding author: Lennart Hardell, The Environment and Cancer Research Foundation, Örebro, Sweden",
]);
assert.deepEqual(
  splitMedtextByline.authors.map((author) => author.name),
  ["Lennart Hardell", "Mona Nilsson"],
  "split PDF bylines must win over affiliation and corresponding-author lines",
);

const uctFactSheetIdentity = extractPdfPublishingIdentity({
  info: { Author: "Lisa Telford", Creator: "Microsoft Word" },
  text: [
    "CHD Fact Sheet",
    "What is congenital heart disease?",
    "Congenital means present at birth.",
  ].join("\n"),
  sourceUrl: "https://health.uct.ac.za/sites/default/files/CHD%2520Fact%2520Sheet.pdf",
});
assert.equal(
  uctFactSheetIdentity.entities.publishing_organization.name,
  "University of Cape Town Faculty of Health Sciences",
);
assert.equal(
  uctFactSheetIdentity.entities.publication_venue.name,
  "UCT Health / Faculty of Health Sciences",
);
assert.equal(uctFactSheetIdentity.document.article_type, "Fact Sheet");
assert.deepEqual(uctFactSheetIdentity.document.authors.map((author) => author.name), ["Lisa Telford"]);
assert.equal(uctFactSheetIdentity.document.authors[0].extraction_method, "pdf_info_author");
assert.equal(uctFactSheetIdentity.document.authors[0].evidence_quote, "Lisa Telford");
assert.equal(uctFactSheetIdentity.context.venue_type, "other");
assert.equal(normalizeVenueType("institutional_site"), "other");
assert.equal(normalizeVenueType("conference proceedings"), "conference");
assert.equal(normalizeVenueType(null), null);

let nextPublisherId = 40;
const calls = [];
const fakeQuery = async (sql, values = []) => {
  calls.push({ sql: sql.replace(/\s+/g, " ").trim(), values });
  if (sql.includes("CALL InsertOrGetPublisher")) return [[{ publisherId: nextPublisherId++ }]];
  if (sql.includes("INSERT INTO content_publishing_context")) return { insertId: 300 };
  if (sql.includes("SELECT id FROM publisher_relationships")) return [];
  return [];
};
const persisted = await persistSourceIdentity(fakeQuery, 12, htmlIdentity, { transaction: false });
assert.equal(persisted.publishingOrganizationId, 40);
assert.equal(persisted.publicationVenueId, 41);
assert.equal(persisted.primaryEntityId, 41, "scholarly content should rate the venue as primary");
assert(calls.some((call) => call.sql.includes("INSERT INTO content_publishers") && call.values.includes("publication_venue")));
assert(!calls.some((call) => /^DELETE FROM content_publishers WHERE content_id = \?$/.test(call.sql)), "role updates must not delete every source link");

const authorCalls = [];
let authorId = 70;
const authorQuery = async (sql, values = []) => {
  authorCalls.push({ sql: sql.replace(/\s+/g, " ").trim(), values });
  if (sql.includes("CALL InsertOrGetAuthor")) return [[{ authorId: authorId++ }]];
  return [];
};
await persistAuthors(authorQuery, 12, normalizedMedtext.document.authors, { replaceExisting: true });
assert.equal(authorCalls[0].sql, "DELETE FROM content_authors WHERE content_id = ?");
assert.equal(authorCalls.filter((call) => call.sql.includes("INSERT IGNORE INTO content_authors")).length, 2);

authorCalls.length = 0;
await persistAuthors(authorQuery, 12, [], { replaceExisting: true });
assert.equal(
  authorCalls[0].sql,
  "DELETE FROM content_authors WHERE content_id = ?",
  "an authoritative empty author list must clear stale author links",
);

const finalAuthorSelection = await processPublishingIdentity({
  identity: {
    ...normalizedMedtext,
    document: {
      ...normalizedMedtext.document,
      authors: [{ name: "Lennart Hardell" }],
    },
  },
  authors: normalizedMedtext.document.authors,
});
assert.deepEqual(
  finalAuthorSelection.authors.map((author) => author.name),
  ["Lennart Hardell", "Mona Nilsson"],
  "the scrape orchestrator's complete author list must override partial identity metadata",
);

console.log("publishing identity extraction and persistence tests passed");
