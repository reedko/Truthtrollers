import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyPubMedMatch,
  extractFirstPageIdentity,
  resolvePdfScholarlyIdentity,
} from "../src/modules/provenance/traceSupport/traceSupportScholarlyResolver.js";
import { parsePubMedPublicationStatusXml } from "../src/core/pubmedSearch.js";

test("extracts a wrapped title immediately before a credentialed PDF author", () => {
  const identity = extractFirstPageIdentity({
    info: {},
    text: [
      "Journal header",
      "Abstract text",
      "Reanalysis of CDC Data on Autism Incidence",
      "and Time of First MMR Vaccination",
      "Brian S. Hooker, Ph.D., P.E.",
    ].join("\n"),
  });

  assert.equal(
    identity.title,
    "Reanalysis of CDC Data on Autism Incidence and Time of First MMR Vaccination",
  );
  assert.equal(identity.author, "Brian S. Hooker, Ph.D., P.E.");
  assert.equal(identity.pageCountInspected, 1);
});

test("classifies a same-author, overlapping predecessor as related rather than exact", () => {
  const match = classifyPubMedMatch(
    {
      title: "Reanalysis of CDC Data on Autism Incidence and Time of First MMR Vaccination",
      author: "Brian S. Hooker, Ph.D., P.E.",
    },
    {
      title: "Measles-mumps-rubella vaccination timing and autism among young African American boys: a reanalysis of CDC data.",
      authors: ["Hooker BS"],
    },
  );

  assert.equal(match.matchKind, "related");
  assert.ok(match.titleAgreement >= 0.3);
});

test("uses relaxed title-and-author PubMed lookup after an exact title miss", async () => {
  const queries = [];
  const result = await resolvePdfScholarlyIdentity(
    { url: "https://example.org/hooker.pdf" },
    {
      loadIdentity: async () => ({
        title: "Reanalysis of CDC Data on Autism Incidence and Time of First MMR Vaccination",
        author: "Brian S. Hooker, Ph.D., P.E.",
        pageCountInspected: 1,
      }),
      search: async ({ query }) => {
        queries.push(query);
        if (queries.length === 1) return [];
        return [{
          title: "Measles-mumps-rubella vaccination timing and autism among young African American boys: a reanalysis of CDC data.",
          authors: ["Hooker BS"],
          pmid: "25114790",
          doi: "10.1186/2047-9158-3-16",
          url: "https://pubmed.ncbi.nlm.nih.gov/25114790/",
        }];
      },
    },
  );

  assert.equal(queries.length, 2);
  assert.match(queries[0], /\[Title\]$/);
  assert.match(queries[1], /Hooker\[Author\]/);
  assert.equal(result.matchKind, "related");
  assert.equal(result.pmid, "25114790");
});

test("parses a PubMed RetractionIn relationship and notice locator", () => {
  const status = parsePubMedPublicationStatusXml(`
    <PubmedArticle>
      <PublicationTypeList>
        <PublicationType>Retracted Publication</PublicationType>
      </PublicationTypeList>
      <CommentsCorrectionsList>
        <CommentsCorrections RefType="RetractionIn">
          <RefSource>Transl Neurodegener. 2014 Oct 03;3:22. doi: 10.1186/2047-9158-3-22.</RefSource>
          <PMID Version="1">25285211</PMID>
        </CommentsCorrections>
      </CommentsCorrectionsList>
    </PubmedArticle>
  `);

  assert.equal(status.status, "retracted");
  assert.equal(status.retractionNotice.pmid, "25285211");
  assert.equal(status.retractionNotice.doi, "10.1186/2047-9158-3-22");
  assert.equal(status.retractionNotice.url, "https://pubmed.ncbi.nlm.nih.gov/25285211/");
});
