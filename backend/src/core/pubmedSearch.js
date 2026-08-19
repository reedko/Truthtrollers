import logger from "../utils/logger.js";

const PUBMED_ESEARCH =
  "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi";

const PUBMED_ESUMMARY =
  "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi";

export async function searchPubMed({ query, topK = 5 }) {
  const term = String(query || "").trim();
  if (!term) return [];

  try {
    const searchUrl = new URL(PUBMED_ESEARCH);
    searchUrl.searchParams.set("db", "pubmed");
    searchUrl.searchParams.set("term", term);
    searchUrl.searchParams.set("retmode", "json");
    searchUrl.searchParams.set("retmax", String(topK));

    logger.log(`📚 [PubMed] Searching: "${term}"`);

    const searchResponse = await fetch(searchUrl);

    if (!searchResponse.ok) {
      throw new Error(`PubMed esearch HTTP ${searchResponse.status}`);
    }

    const searchJson = await searchResponse.json();
    const ids = searchJson?.esearchresult?.idlist || [];

    if (!ids.length) {
      logger.log(`📚 [PubMed] No results for: "${term}"`);
      return [];
    }

    const summaryUrl = new URL(PUBMED_ESUMMARY);
    summaryUrl.searchParams.set("db", "pubmed");
    summaryUrl.searchParams.set("id", ids.join(","));
    summaryUrl.searchParams.set("retmode", "json");

    const summaryResponse = await fetch(summaryUrl);

    if (!summaryResponse.ok) {
      throw new Error(`PubMed esummary HTTP ${summaryResponse.status}`);
    }

    const summaryJson = await summaryResponse.json();

    const results = ids
      .map((pmid, index) => {
        const item = summaryJson?.result?.[pmid];
        if (!item) return null;

        return {
          id: `pubmed:${pmid}`,
          url: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,
          title: item.title || `PubMed ${pmid}`,
          snippet: "",
          source: "pubmed",
          score: Math.max(0, 1 - index * 0.05),
          pmid,
          pubdate: item.pubdate || null,
          authors: Array.isArray(item.authors)
            ? item.authors.map((a) => a.name).filter(Boolean)
            : [],
        };
      })
      .filter(Boolean);

    logger.log(`📚 [PubMed] Found ${results.length} results for: "${term}"`);

    return results;
  } catch (err) {
    logger.warn(`⚠️ [PubMed] Search failed for "${term}": ${err.message}`);
    return [];
  }
}
