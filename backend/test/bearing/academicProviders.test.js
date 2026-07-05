import assert from "node:assert/strict";
import test from "node:test";

import {
  isAcademicQuery,
  pubmedSearch,
  crossrefSearch,
  openAlexSearch,
  semanticScholarSearch,
} from "../../src/core/academicProviders.js";

import { createEvidenceRetrievalGateway } from "../../src/core/evidenceRetrievalGateway.js";

// ─── isAcademicQuery detection ────────────────────────────────────────────────

test("isAcademicQuery: detects vaccine/biomedical terms", () => {
  assert.ok(isAcademicQuery("MMR vaccine and autism CDC study"));
  assert.ok(isAcademicQuery("clinical trial randomized placebo double-blind"));
  assert.ok(isAcademicQuery("doi:10.1016/j.vaccine.2020.01.001 journal retract"));
  assert.ok(isAcademicQuery("NIH WHO CDC cancer randomized"));
});

test("isAcademicQuery: does not flag generic political query", () => {
  assert.equal(isAcademicQuery("Senator voted against the bill"), false);
  assert.equal(isAcademicQuery("election fraud ballot integrity"), false);
});

// ─── PubMed adapter ───────────────────────────────────────────────────────────

function makeFetch(responses) {
  let callIndex = 0;
  return async (url) => {
    const r = responses[callIndex++];
    return { ok: true, json: async () => r };
  };
}

const PUBMED_SEARCH_RESPONSE = {
  esearchresult: { idlist: ["12345678", "87654321"] },
};

const PUBMED_SUMMARY_RESPONSE = {
  result: {
    "12345678": {
      title: "MMR Vaccine Safety Study",
      authors: [{ name: "Smith J" }, { name: "Jones A" }],
      fulljournalname: "Vaccine",
      pubdate: "2020 Jan 15",
      pubtype: ["Journal Article"],
    },
    "87654321": {
      title: "Autism Prevalence in Vaccinated Populations",
      authors: [{ name: "Brown K" }],
      source: "Pediatrics",
      pubdate: "2019 Mar",
      pubtype: ["Journal Article", "Retracted Publication"],
    },
  },
};

test("pubmedSearch: normalizes results to expected shape", async () => {
  const fetchImpl = makeFetch([PUBMED_SEARCH_RESPONSE, PUBMED_SUMMARY_RESPONSE]);
  const results = await pubmedSearch({ query: "MMR autism CDC", topK: 2, env: {}, fetchImpl });
  assert.equal(results.length, 2);
  const first = results[0];
  assert.equal(first.pmid, "12345678");
  assert.equal(first.title, "MMR Vaccine Safety Study");
  assert.equal(first.url, "https://pubmed.ncbi.nlm.nih.gov/12345678/");
  assert.ok(first.snippet.includes("Smith J"));
  assert.equal(first._provider, "pubmed");
  assert.equal(first.hasRetraction, false);
});

test("pubmedSearch: flags retracted publications", async () => {
  const fetchImpl = makeFetch([PUBMED_SEARCH_RESPONSE, PUBMED_SUMMARY_RESPONSE]);
  const results = await pubmedSearch({ query: "autism vaccine", topK: 2, env: {}, fetchImpl });
  assert.equal(results[1].hasRetraction, true);
});

test("pubmedSearch: returns empty array when no results", async () => {
  const fetchImpl = makeFetch([{ esearchresult: { idlist: [] } }]);
  const results = await pubmedSearch({ query: "nothing", topK: 5, env: {}, fetchImpl });
  assert.equal(results.length, 0);
});

// ─── Crossref adapter ─────────────────────────────────────────────────────────

const CROSSREF_RESPONSE = {
  message: {
    items: [
      {
        DOI: "10.1016/j.vaccine.2020.01.001",
        title: ["Safety of MMR Vaccine"],
        author: [{ given: "Jane", family: "Smith" }],
        publisher: "Elsevier",
        "container-title": ["Vaccine"],
        published: { "date-parts": [[2020, 1, 15]] },
        score: 12.5,
        URL: "https://doi.org/10.1016/j.vaccine.2020.01.001",
      },
    ],
  },
};

test("crossrefSearch: normalizes DOI, title, authors, containerTitle", async () => {
  const fetchImpl = async () => ({ ok: true, json: async () => CROSSREF_RESPONSE });
  const results = await crossrefSearch({ query: "MMR vaccine safety", topK: 1, env: {}, fetchImpl });
  assert.equal(results.length, 1);
  const r = results[0];
  assert.equal(r.doi, "10.1016/j.vaccine.2020.01.001");
  assert.equal(r.title, "Safety of MMR Vaccine");
  assert.equal(r.url, "https://doi.org/10.1016/j.vaccine.2020.01.001");
  assert.ok(r.authors.includes("Jane Smith"));
  assert.equal(r.containerTitle, "Vaccine");
  assert.equal(r.publishedAt, "2020-1-15");
  assert.equal(r._provider, "crossref");
});

// ─── OpenAlex adapter ─────────────────────────────────────────────────────────

const OPENALEX_RESPONSE = {
  results: [
    {
      id: "https://openalex.org/W1234567890",
      display_name: "MMR vaccine and autism: a meta-analysis",
      doi: "https://doi.org/10.1001/jama.2020.1234",
      authorships: [
        { author: { display_name: "Alice Researcher" } },
      ],
      primary_location: {
        source: { display_name: "JAMA" },
        landing_page_url: "https://jamanetwork.com/journals/jama/article/1234",
      },
      publication_year: 2020,
      cited_by_count: 87,
      concepts: [
        { display_name: "Vaccination" },
        { display_name: "Autism spectrum disorder" },
      ],
    },
  ],
};

test("openAlexSearch: normalizes work to expected shape", async () => {
  let requestedUrl = "";
  const fetchImpl = async (url) => {
    requestedUrl = String(url);
    return { ok: true, json: async () => OPENALEX_RESPONSE };
  };
  const results = await openAlexSearch({ query: "MMR autism meta-analysis", topK: 1, env: { OPENALEX_API_KEY: "test-key" }, fetchImpl });
  assert.equal(results.length, 1);
  const r = results[0];
  assert.equal(r.openAlexId, "https://openalex.org/W1234567890");
  assert.equal(r.doi, "10.1001/jama.2020.1234");
  assert.equal(r.title, "MMR vaccine and autism: a meta-analysis");
  assert.equal(r.url, "https://jamanetwork.com/journals/jama/article/1234");
  assert.ok(r.authors.includes("Alice Researcher"));
  assert.equal(r.venue, "JAMA");
  assert.equal(r.citedByCount, 87);
  assert.equal(r._provider, "openalex");
  assert.equal(new URL(requestedUrl).searchParams.get("api_key"), "test-key");
});

// ─── Semantic Scholar adapter ─────────────────────────────────────────────────

const S2_RESPONSE = {
  data: [
    {
      paperId: "abc123def456",
      title: "Childhood Vaccines and Autism: A Large-Scale Study",
      abstract: "We analyzed data from 650,000 children and found no association.",
      authors: [{ name: "Robert Johnson" }, { name: "Carol Lee" }],
      venue: "New England Journal of Medicine",
      year: 2019,
      citationCount: 412,
      influentialCitationCount: 38,
      externalIds: { DOI: "10.1056/NEJMoa1901528", PubMed: "30970186" },
      url: "https://www.nejm.org/doi/full/10.1056/NEJMoa1901528",
      openAccessPdf: null,
    },
  ],
};

test("semanticScholarSearch: normalizes with abstract as snippet", async () => {
  const fetchImpl = async () => ({ ok: true, json: async () => S2_RESPONSE });
  const results = await semanticScholarSearch({ query: "childhood vaccines autism", topK: 1, env: {}, fetchImpl });
  assert.equal(results.length, 1);
  const r = results[0];
  assert.equal(r.paperId, "abc123def456");
  assert.equal(r.doi, "10.1056/NEJMoa1901528");
  assert.equal(r.pmid, "30970186");
  assert.ok(r.snippet.includes("650,000 children"), "should use abstract as snippet");
  assert.equal(r.citationCount, 412);
  assert.equal(r._provider, "semantic_scholar");
});

// ─── Gateway integration: academic providers normalize to standard shape ───────

test("gateway: pubmed results come out in standard evidence shape", async () => {
  let callIndex = 0;
  const fetchImpl = async () => {
    const responses = [PUBMED_SEARCH_RESPONSE, PUBMED_SUMMARY_RESPONSE];
    return { ok: true, json: async () => responses[callIndex++] };
  };
  const gateway = createEvidenceRetrievalGateway({
    config: { providerEnabled: { tavily: false, pubmed: true } },
    env: {},
    fetchImpl,
  });
  const results = await gateway.web({ query: "MMR autism CDC", providers: ["pubmed"], topK: 2 });
  assert.ok(results.length > 0);
  const r = results[0];
  assert.ok(r.url.startsWith("https://pubmed.ncbi.nlm.nih.gov/"));
  assert.ok(r.title, "result must have a title");
  assert.ok(r.snippet, "result must have a snippet");
  assert.equal(r.provider, "pubmed");
  assert.equal(r.source, "pubmed");
  assert.ok(r.academicMetadata?.pmid, "academic metadata must include pmid");
});

test("gateway: crossref results include doi in academicMetadata", async () => {
  const fetchImpl = async () => ({ ok: true, json: async () => CROSSREF_RESPONSE });
  const gateway = createEvidenceRetrievalGateway({
    config: { providerEnabled: { tavily: false, crossref: true } },
    env: {},
    fetchImpl,
  });
  const results = await gateway.web({ query: "MMR vaccine safety", providers: ["crossref"], topK: 1 });
  assert.ok(results.length > 0);
  assert.ok(results[0].academicMetadata?.doi, "doi must be in academicMetadata");
  assert.equal(results[0].academicMetadata?.publisher, "Elsevier");
  assert.equal(results[0].source, "crossref");
});

test("gateway: isAcademicQuery auto-includes enabled academic providers", async () => {
  let pubmedCalled = false;
  const fetchImpl = async (url) => {
    if (url.includes("eutils")) {
      pubmedCalled = true;
      if (url.includes("esearch")) return { ok: true, json: async () => ({ esearchresult: { idlist: [] } }) };
      return { ok: true, json: async () => ({ result: {} }) };
    }
    // tavily
    return { ok: true, json: async () => ({ results: [] }) };
  };
  const gateway = createEvidenceRetrievalGateway({
    config: { providerEnabled: { tavily: true, pubmed: true } },
    env: { TAVILY_API_KEY: "test" },
    fetchImpl,
  });
  await gateway.web({ query: "MMR vaccine autism CDC study", topK: 2 });
  assert.ok(pubmedCalled, "PubMed should be called automatically for biomedical queries when enabled");
});
