// backend/src/core/academicProviders.js
// Evidence retrieval adapters for PubMed, Crossref, OpenAlex, and Semantic Scholar.
// Each adapter accepts { query, topK, env, fetchImpl } and returns raw records
// that the evidence retrieval gateway normalizes to the standard search result shape.

import { rateLimitedNcbiFetch } from "./academicContentResolver.js";

const PUBMED_BASE = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";
const CROSSREF_BASE = "https://api.crossref.org";
const OPENALEX_BASE = "https://api.openalex.org";
const SEMANTIC_SCHOLAR_BASE = "https://api.semanticscholar.org/graph/v1";

// Biomedical / academic detection patterns used to decide when to include
// these adapters for a given query.
const BIOMEDICAL_PATTERNS = [
  /\b(vaccine|vaccination|immuniz|mmr|measles|mumps|rubella|autism|asd)\b/i,
  /\b(cdc|fda|nih|who\b|acip|ema|ncbi|pubmed)\b/i,
  /\b(clinical trial|randomized|cohort|meta.?analysis|systematic review)\b/i,
  /\b(doi|pmid|journal|peer.?review|published in|study|dataset|retract)\b/i,
  /\b(cancer|diabetes|cardiovascular|neurolog|epidemiol|pathogen)\b/i,
  /\b(placebo|double.?blind|control group|adverse event|side effect)\b/i,
];

export function isAcademicQuery(queryText = "") {
  return BIOMEDICAL_PATTERNS.some((re) => re.test(queryText));
}

export async function pubmedSearch({ query, topK = 5, env = {}, fetchImpl = globalThis.fetch }) {
  const keyParam = env.PUBMED_API_KEY ? `&api_key=${encodeURIComponent(env.PUBMED_API_KEY)}` : "";
  const searchUrl = `${PUBMED_BASE}/esearch.fcgi?db=pubmed&term=${encodeURIComponent(query)}&retmax=${topK}&retmode=json${keyParam}`;
  const searchResp = await rateLimitedNcbiFetch(searchUrl, {}, fetchImpl, env);
  if (!searchResp.ok) throw new Error(`PubMed esearch HTTP ${searchResp.status}`);
  const searchData = await searchResp.json();
  const ids = searchData?.esearchresult?.idlist || [];
  if (!ids.length) return [];

  const summaryUrl = `${PUBMED_BASE}/esummary.fcgi?db=pubmed&id=${ids.join(",")}&retmode=json${keyParam}`;
  const summaryResp = await rateLimitedNcbiFetch(summaryUrl, {}, fetchImpl, env);
  if (!summaryResp.ok) throw new Error(`PubMed esummary HTTP ${summaryResp.status}`);
  const summaryData = await summaryResp.json();
  const result = summaryData?.result || {};

  return ids.map((id, index) => {
    const doc = result[id] || {};
    const authors = (doc.authors || []).map((a) => a.name).filter(Boolean).join(", ");
    const journal = doc.fulljournalname || doc.source || "";
    const pubDate = doc.pubdate || null;
    const pubTypes = (doc.pubtype || []);
    const hasRetraction = pubTypes.some((t) => /retract/i.test(t));
    const hasCorrectionOfRecord = pubTypes.some((t) => /correction|errat/i.test(t));
    return {
      pmid: id,
      title: doc.title || "",
      snippet: [doc.title, authors ? `Authors: ${authors}` : null, journal, pubDate].filter(Boolean).join(" — "),
      url: `https://pubmed.ncbi.nlm.nih.gov/${id}/`,
      publishedAt: pubDate,
      authors,
      journal,
      publicationTypes: pubTypes.join(", "),
      hasRetraction,
      hasCorrectionOfRecord,
      score: 1 / (index + 1),
      _provider: "pubmed",
    };
  });
}

export async function crossrefSearch({ query, topK = 5, env = {}, fetchImpl = globalThis.fetch }) {
  const mailtoParam = env.CROSSREF_MAILTO ? `&mailto=${encodeURIComponent(env.CROSSREF_MAILTO)}` : "";
  const url = `${CROSSREF_BASE}/works?query=${encodeURIComponent(query)}&rows=${topK}${mailtoParam}`;
  const resp = await fetchImpl(url, { headers: { Accept: "application/json" } });
  if (!resp.ok) throw new Error(`Crossref HTTP ${resp.status}`);
  const data = await resp.json();
  const items = data?.message?.items || [];
  return items.map((item, index) => {
    const doi = item.DOI || "";
    const title = (item.title || [])[0] || "";
    const authors = (item.author || []).map((a) => `${a.given || ""} ${a.family || ""}`.trim()).filter(Boolean).join(", ");
    const publisher = item.publisher || "";
    const containerTitle = (item["container-title"] || [])[0] || "";
    const published = item.published?.["date-parts"]?.[0] || item["published-print"]?.["date-parts"]?.[0];
    const pubDate = published ? published.filter(Boolean).join("-") : null;
    const itemUrl = doi ? `https://doi.org/${doi}` : (item.URL || "");
    return {
      doi,
      title,
      snippet: [title, authors ? `Authors: ${authors}` : null, containerTitle, publisher, pubDate].filter(Boolean).join(" — "),
      url: itemUrl,
      publishedAt: pubDate,
      authors,
      publisher,
      containerTitle,
      relationType: (item.relation ? Object.keys(item.relation).join(",") : null),
      score: Number(item.score) || 1 / (index + 1),
      _provider: "crossref",
    };
  });
}

export async function openAlexSearch({ query, topK = 5, env = {}, fetchImpl = globalThis.fetch }) {
  const mailto = env.OPENALEX_MAILTO || env.CROSSREF_MAILTO || "";
  const mailtoParam = mailto ? `&mailto=${encodeURIComponent(mailto)}` : "";
  const apiKeyParam = env.OPENALEX_API_KEY ? `&api_key=${encodeURIComponent(env.OPENALEX_API_KEY)}` : "";
  const url = `${OPENALEX_BASE}/works?search=${encodeURIComponent(query)}&per-page=${topK}${mailtoParam}${apiKeyParam}`;
  const resp = await fetchImpl(url, { headers: { Accept: "application/json" } });
  if (!resp.ok) throw new Error(`OpenAlex HTTP ${resp.status}`);
  const data = await resp.json();
  const items = data?.results || [];
  return items.map((work, index) => {
    const doi = work.doi ? work.doi.replace("https://doi.org/", "") : "";
    const title = work.display_name || work.title || "";
    const authors = (work.authorships || []).map((a) => a.author?.display_name).filter(Boolean).join(", ");
    const venue = work.primary_location?.source?.display_name || work.host_venue?.display_name || "";
    const pubYear = work.publication_year ? String(work.publication_year) : null;
    const workUrl = work.primary_location?.landing_page_url
      || (doi ? `https://doi.org/${doi}` : null)
      || work.id
      || "";
    const concepts = (work.concepts || []).slice(0, 5).map((c) => c.display_name).join(", ");
    return {
      openAlexId: work.id,
      doi,
      title,
      snippet: [title, authors ? `Authors: ${authors}` : null, venue, pubYear].filter(Boolean).join(" — "),
      url: workUrl,
      publishedAt: pubYear,
      authors,
      venue,
      citedByCount: work.cited_by_count || 0,
      concepts,
      relatedWorks: (work.related_works || []).slice(0, 5),
      score: 1 / (index + 1),
      _provider: "openalex",
    };
  });
}

export async function semanticScholarSearch({ query, topK = 5, env = {}, fetchImpl = globalThis.fetch }) {
  const fields = "title,abstract,authors,venue,year,citationCount,influentialCitationCount,externalIds,url,openAccessPdf";
  const url = `${SEMANTIC_SCHOLAR_BASE}/paper/search?query=${encodeURIComponent(query)}&limit=${topK}&fields=${fields}`;
  const headers = { Accept: "application/json" };
  if (env.SEMANTIC_SCHOLAR_API_KEY) headers["x-api-key"] = env.SEMANTIC_SCHOLAR_API_KEY;
  const resp = await fetchImpl(url, { headers });
  if (!resp.ok) throw new Error(`Semantic Scholar HTTP ${resp.status}`);
  const data = await resp.json();
  const papers = data?.data || [];
  return papers.map((paper, index) => {
    const doi = paper.externalIds?.DOI || "";
    const pmid = paper.externalIds?.PubMed || paper.externalIds?.PMID || "";
    const title = paper.title || "";
    const authors = (paper.authors || []).map((a) => a.name).filter(Boolean).join(", ");
    const venue = paper.venue || "";
    const pubYear = paper.year ? String(paper.year) : null;
    const paperUrl = paper.openAccessPdf?.url
      || paper.url
      || (doi ? `https://doi.org/${doi}` : null)
      || `https://www.semanticscholar.org/paper/${paper.paperId}`;
    return {
      paperId: paper.paperId,
      doi,
      pmid,
      title,
      snippet: paper.abstract || [title, authors ? `Authors: ${authors}` : null, venue, pubYear].filter(Boolean).join(" — "),
      url: paperUrl,
      publishedAt: pubYear,
      authors,
      venue,
      citationCount: paper.citationCount || 0,
      influentialCitationCount: paper.influentialCitationCount || 0,
      score: 1 / (index + 1),
      _provider: "semantic_scholar",
    };
  });
}
