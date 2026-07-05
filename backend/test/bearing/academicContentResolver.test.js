import assert from "node:assert/strict";
import test from "node:test";

import {
  clearAcademicContentCacheForTests,
  buildAcademicPublishingIdentity,
  detectAcademicIdentifiers,
  enrichAcademicCandidates,
  fetchAcademicApiContent,
  parsePmcFullTextXml,
  parsePubmedArticleXml,
} from "../../src/core/academicContentResolver.js";
import { EvidenceEngine } from "../../src/core/evidenceEngine.js";
import { normalizeBearingGatingConfig } from "../../src/core/bearingConfig.js";

const PUBMED_XML = `<?xml version="1.0"?>
<PubmedArticleSet><PubmedArticle><MedlineCitation><PMID>14761240</PMID><Article>
<Journal><JournalIssue><PubDate><Year>2004</Year></PubDate></JournalIssue><Title>Pediatrics</Title></Journal>
<ArticleTitle>Age at first measles-mumps-rubella vaccination in children with autism</ArticleTitle>
<Abstract><AbstractText Label="RESULTS">The distribution of ages at MMR vaccination was similar among case and control children.</AbstractText><AbstractText Label="CONCLUSIONS">No significant associations were found.</AbstractText></Abstract>
<AuthorList><Author><ForeName>Frank</ForeName><LastName>DeStefano</LastName></Author></AuthorList>
<PublicationTypeList><PublicationType>Journal Article</PublicationType></PublicationTypeList>
</Article><MeshHeadingList><MeshHeading><DescriptorName>Autistic Disorder</DescriptorName></MeshHeading></MeshHeadingList></MedlineCitation>
<PubmedData><ArticleIdList><ArticleId IdType="pubmed">14761240</ArticleId><ArticleId IdType="pmc">PMC123456</ArticleId><ArticleId IdType="doi">10.1542/peds.113.2.259</ArticleId></ArticleIdList></PubmedData>
</PubmedArticle></PubmedArticleSet>`;

const PMC_XML = `<?xml version="1.0"?><article><front><journal-meta>
<journal-id journal-id-type="nlm-ta">Pediatrics</journal-id><journal-title-group><journal-title>Pediatrics</journal-title></journal-title-group>
<issn pub-type="ppub">0031-4005</issn><issn pub-type="epub">1098-4275</issn>
</journal-meta><article-meta>
<article-id pub-id-type="pmc">PMC123456</article-id><article-id pub-id-type="pmid">14761240</article-id>
<article-id pub-id-type="doi">10.1542/peds.113.2.259</article-id><title-group><article-title>Full study title</article-title></title-group>
<contrib-group><contrib contrib-type="author"><name><given-names>Frank</given-names><surname>DeStefano</surname></name></contrib></contrib-group>
<pub-date pub-type="epub"><year>2004</year><month>02</month></pub-date><volume>113</volume><issue>2</issue>
<abstract><p>Study abstract text.</p></abstract></article-meta></front>
<body><sec><title>Methods</title><p>Researchers compared vaccination timing in cases and controls using the recorded dataset.</p></sec><sec><title>Results</title><p>No significant association was detected in the primary analysis.</p></sec></body></article>`;

test("detectAcademicIdentifiers recognizes PMID, PMC, DOI, and malformed DOI citation suffix", () => {
  assert.equal(detectAcademicIdentifiers({ url: "https://pubmed.ncbi.nlm.nih.gov/14761240/" }).pmid, "14761240");
  assert.equal(detectAcademicIdentifiers({ url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC123456/" }).pmcid, "PMC123456");
  assert.equal(
    detectAcademicIdentifiers({ url: "https://doi.org/10.1542/peds.113.2.259Article" }).doi,
    "10.1542/peds.113.2.259",
  );
  assert.equal(
    detectAcademicIdentifiers({ url: "https://doi.org/10.1542/peds.113.2.259CrossRef" }).doi,
    "10.1542/peds.113.2.259",
  );
});

test("PubMed XML parser extracts actual abstract and bearing metadata", () => {
  const parsed = parsePubmedArticleXml(PUBMED_XML);
  assert.equal(parsed.pmid, "14761240");
  assert.equal(parsed.pmcid, "PMC123456");
  assert.equal(parsed.authors[0], "Frank DeStefano");
  assert.equal(parsed.journal, "Pediatrics");
  assert.ok(parsed.abstract.includes("No significant associations"));
  assert.deepEqual(parsed.meshTerms, ["Autistic Disorder"]);
  assert.deepEqual(parsed.publicationTypes, ["Journal Article"]);
});

test("PMC XML parser returns full article text", () => {
  const parsed = parsePmcFullTextXml(PMC_XML);
  assert.equal(parsed.pmcid, "PMC123456");
  assert.equal(parsed.pmid, "14761240");
  assert.equal(parsed.journal, "Pediatrics");
  assert.deepEqual(parsed.authors, ["Frank DeStefano"]);
  assert.deepEqual(parsed.issns.map((item) => item.value), ["0031-4005", "1098-4275"]);
  assert.ok(parsed.fullText.includes("Researchers compared vaccination timing"));
  assert.ok(parsed.fullText.includes("No significant association"));
});

test("a PMC-only URL fetches PubMed details and Crossref publisher metadata", async () => {
  clearAcademicContentCacheForTests();
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    if (String(url).includes("api.crossref.org")) {
      return {
        ok: true,
        json: async () => ({ message: {
          publisher: "American Academy of Pediatrics",
          "container-title": ["Pediatrics"],
          ISSN: ["0031-4005", "1098-4275"],
        } }),
      };
    }
    return { ok: true, text: async () => String(url).includes("db=pmc") ? PMC_XML : PUBMED_XML };
  };
  const result = await fetchAcademicApiContent(
    { url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC123456/" },
    { fetchImpl, env: {}, disableCache: true },
  );
  assert.equal(result.publisher, "American Academy of Pediatrics");
  assert.equal(result.journal, "Pediatrics");
  assert.deepEqual(result.authors, ["Frank DeStefano"]);
  assert.ok(calls.some((url) => url.includes("db=pubmed&id=14761240")));
  assert.ok(calls.some((url) => url.includes("api.crossref.org/works/")));
});

test("academic identity keeps publisher, journal, repository, authors, and identifiers separate", () => {
  const identity = buildAcademicPublishingIdentity({
    publisher: "SAGE Publications",
    journal: "Human & Experimental Toxicology",
    authors: ["Neil Z. Miller", "Gary S. Goldman"],
    identifiers: { pmid: "21543527", pmcid: "PMC3170075", doi: "10.1177/0960327111407644" },
    issns: [{ type: "issn", value: "0960-3271" }],
    publicationTypes: ["Journal Article"],
    publishedAt: "2011",
  }, "https://pmc.ncbi.nlm.nih.gov/articles/PMC3170075/");
  assert.equal(identity.entities.publishing_organization.name, "SAGE Publications");
  assert.equal(identity.entities.publication_venue.name, "Human & Experimental Toxicology");
  assert.equal(identity.entities.repository.name, "PubMed Central");
  assert.deepEqual(identity.document.authors.map((author) => author.name), ["Neil Z. Miller", "Gary S. Goldman"]);
  assert.ok(identity.document.identifiers.some((item) => item.identifier_type === "doi"));
});

test("PubMed API resolver upgrades a PMID candidate to PMC full text", async () => {
  clearAcademicContentCacheForTests();
  const fetchImpl = async (url) => ({
    ok: true,
    text: async () => String(url).includes("db=pmc") ? PMC_XML : PUBMED_XML,
  });
  const result = await fetchAcademicApiContent(
    { url: "https://pubmed.ncbi.nlm.nih.gov/14761240/" },
    { fetchImpl, env: {}, disableCache: true },
  );
  assert.equal(result.retrievalMode, "full_text");
  assert.equal(result.identifiers.pmid, "14761240");
  assert.ok(result.bearingText.includes("Frank DeStefano"));
  assert.ok(result.bearingText.includes("Autistic Disorder"));
});

test("academic enrichment preserves search snippet separately from API-backed bearing text", async () => {
  clearAcademicContentCacheForTests();
  const pubmedWithoutPmc = PUBMED_XML.replace("<ArticleId IdType=\"pmc\">PMC123456</ArticleId>", "");
  const fetchImpl = async () => ({ ok: true, text: async () => pubmedWithoutPmc });
  const input = [
    { id: "ordinary", url: "https://example.com/a", snippet: "ordinary" },
    { id: "study", url: "https://pubmed.ncbi.nlm.nih.gov/14761240/", snippet: "search snippet" },
  ];
  const output = await enrichAcademicCandidates(input, { fetchImpl, env: {}, disableCache: true });
  assert.deepEqual(output.map((item) => item.id), ["ordinary", "study"]);
  assert.equal(output[1].academicApiContent.retrievalMode, "abstract_only");
  assert.equal(output[1].snippet, "search snippet");
  assert.equal(output[1].searchSnippet, "search snippet");
  assert.equal(output[1].bearingTextSource, "pubmed_abstract");
  assert.ok(output[1].bearingText.includes("No significant associations"));
  assert.equal(output[1].academicDiscoveryRoute, "web_discovered_identifier");
});

test("abstract-only topic overlap does not satisfy the adaptive bearing quota", async () => {
  const engine = new EvidenceEngine({
    fetcher: { async getText() {
      return { isProcessed: true, cleanText: "An API abstract about MMR and autism with enough text to evaluate directly.", retrievalMode: "abstract_only", apiBacked: true };
    } },
    extractQuotesAndScoreQuality: async () => ({ quotes: [{
      quote: "This abstract discusses MMR and autism generally.",
      stance: "nuance",
      bearing_score: 0.9,
      bearing_type: "context",
      claim_component_addressed: "context",
      bearing_reason: "Topic overlap only.",
    }], qualityScores: null }),
  });
  const claim = { id: 1, text: "CDC manipulated data.", evaluationTargets: [{ evaluationTargetId: 72, targetType: "substantive", verdictEligible: true }] };
  const config = normalizeBearingGatingConfig({
    enableBearingGating: true,
    minDeliveredSourcesPerContent: 1,
    maxSourceAttemptsPerContent: 1,
    minBearingLinksPerClaim: 1,
    maxSourcesComparedPerClaim: 1,
  }, {});
  const run = await engine._runAdaptiveExtractionRoundRobin([{ plan: {
    claim,
    rankedCandidates: [{ id: "study", url: "https://pubmed.ncbi.nlm.nih.gov/14761240/", evidenceTargetId: 72 }],
  } }], { bearingConfig: config, maxSourcesToScrapePerTarget: 1 });
  assert.equal(run.byClaimId.get(1).bearingLinkCount, 0);
});

test("an explicit direct assertion from an abstract may satisfy the bearing quota", async () => {
  const engine = new EvidenceEngine({
    fetcher: { async getText() {
      return { isProcessed: true, cleanText: "An API abstract containing a directly reported methods result.", retrievalMode: "abstract_only", apiBacked: true };
    } },
    extractQuotesAndScoreQuality: async () => ({ quotes: [{
      quote: "The prespecified analysis retained every eligible case in the dataset.",
      stance: "refute",
      bearing_score: 0.9,
      bearing_type: "direct",
      claim_component_addressed: "object",
      bearing_reason: "Directly reports the relevant data handling.",
    }], qualityScores: null }),
  });
  const claim = { id: 2, text: "CDC removed eligible cases.", evaluationTargets: [{ evaluationTargetId: 73, targetType: "substantive", verdictEligible: true }] };
  const config = normalizeBearingGatingConfig({
    enableBearingGating: true,
    minDeliveredSourcesPerContent: 1,
    maxSourceAttemptsPerContent: 1,
    minBearingLinksPerClaim: 1,
    maxSourcesComparedPerClaim: 1,
  }, {});
  const run = await engine._runAdaptiveExtractionRoundRobin([{ plan: {
    claim,
    rankedCandidates: [{ id: "study", url: "https://pubmed.ncbi.nlm.nih.gov/12345678/", evidenceTargetId: 73 }],
  } }], { bearingConfig: config, maxSourcesToScrapePerTarget: 1 });
  assert.equal(run.byClaimId.get(2).bearingLinkCount, 1);
});
