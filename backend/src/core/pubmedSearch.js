import logger from "../utils/logger.js";

const PUBMED_ESEARCH =
  "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi";

const PUBMED_ESUMMARY =
  "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi";

const PUBMED_EFETCH =
  "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi";

// Shared across all parallel PubMed searches in this process.
// NCBI permits ~10 requests/sec with an API key, ~3/sec without.
let pubmedRequestQueue = Promise.resolve();
let nextPubMedRequestAt = 0;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function addPubMedParams(url) {
  const apiKey = String(process.env.PUBMED_API_KEY || "").trim();

  if (apiKey) {
    url.searchParams.set("api_key", apiKey);
  }

  url.searchParams.set("tool", "veristrata");

  const email = String(process.env.PUBMED_EMAIL || "").trim();
  if (email) {
    url.searchParams.set("email", email);
  }

  return url;
}

async function reservePubMedRequestSlot() {
  const hasApiKey = Boolean(String(process.env.PUBMED_API_KEY || "").trim());

  // Stay slightly below NCBI's limits.
  const minimumIntervalMs = hasApiKey ? 110 : 350;

  const slot = pubmedRequestQueue.then(async () => {
    const now = Date.now();
    const waitMs = Math.max(0, nextPubMedRequestAt - now);

    if (waitMs > 0) {
      await sleep(waitMs);
    }

    nextPubMedRequestAt = Date.now() + minimumIntervalMs;
  });

  pubmedRequestQueue = slot.catch(() => {});

  await slot;
}

async function pubmedFetch(url, attempt = 0) {
  await reservePubMedRequestSlot();

  const response = await fetch(url);

  if ((response.status === 429 || response.status >= 500) && attempt < 3) {
    const retryAfter = Number(response.headers.get("retry-after"));
    const delayMs = Number.isFinite(retryAfter)
      ? retryAfter * 1000
      : 500 * 2 ** attempt;

    logger.warn(
      `⚠️ [PubMed] HTTP ${response.status}; retrying in ${delayMs}ms`,
    );

    await sleep(delayMs);

    return pubmedFetch(url, attempt + 1);
  }

  return response;
}

function decodeXml(value) {
  return String(value || "")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) =>
      String.fromCharCode(parseInt(code, 16)),
    )
    .replace(/\s+/g, " ")
    .trim();
}

function parseAbstracts(xml) {
  const abstractsByPmid = new Map();

  const articles =
    String(xml || "").match(/<PubmedArticle\b[\s\S]*?<\/PubmedArticle>/gi) ||
    [];

  for (const article of articles) {
    const pmidMatch = article.match(/<PMID\b[^>]*>([\s\S]*?)<\/PMID>/i);

    const pmid = decodeXml(pmidMatch?.[1]);
    if (!pmid) continue;

    const abstractParts = [];

    const abstractRegex = /<AbstractText\b([^>]*)>([\s\S]*?)<\/AbstractText>/gi;

    for (const match of article.matchAll(abstractRegex)) {
      const attributes = match[1] || "";
      const text = decodeXml(match[2]);

      if (!text) continue;

      const labelMatch = attributes.match(/\bLabel=["']([^"']+)["']/i);

      const label = decodeXml(labelMatch?.[1]);

      abstractParts.push(label ? `${label}: ${text}` : text);
    }

    if (abstractParts.length > 0) {
      abstractsByPmid.set(pmid, abstractParts.join(" "));
    }
  }

  return abstractsByPmid;
}

async function fetchPubMedAbstracts(ids) {
  if (!ids.length) {
    return new Map();
  }

  try {
    const fetchUrl = new URL(PUBMED_EFETCH);

    fetchUrl.searchParams.set("db", "pubmed");
    fetchUrl.searchParams.set("id", ids.join(","));
    fetchUrl.searchParams.set("retmode", "xml");

    addPubMedParams(fetchUrl);

    const response = await pubmedFetch(fetchUrl);

    if (!response.ok) {
      throw new Error(`PubMed efetch HTTP ${response.status}`);
    }

    const xml = await response.text();

    return parseAbstracts(xml);
  } catch (err) {
    // Abstract failure should not destroy otherwise valid PubMed results.
    logger.warn(`⚠️ [PubMed] Abstract fetch failed: ${err.message}`);

    return new Map();
  }
}

export async function searchPubMed({ query, topK = 5 }) {
  const term = String(query || "").trim();

  if (!term) return [];

  try {
    const searchUrl = new URL(PUBMED_ESEARCH);

    searchUrl.searchParams.set("db", "pubmed");
    searchUrl.searchParams.set("term", term);
    searchUrl.searchParams.set("retmode", "json");
    searchUrl.searchParams.set("retmax", String(topK));

    addPubMedParams(searchUrl);

    logger.log(`📚 [PubMed] Searching: "${term}"`);

    const searchResponse = await pubmedFetch(searchUrl);

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

    addPubMedParams(summaryUrl);

    const [summaryResponse, abstractsByPmid] = await Promise.all([
      pubmedFetch(summaryUrl),
      fetchPubMedAbstracts(ids),
    ]);

    if (!summaryResponse.ok) {
      throw new Error(`PubMed esummary HTTP ${summaryResponse.status}`);
    }

    const summaryJson = await summaryResponse.json();

    const results = ids
      .map((pmid, index) => {
        const item = summaryJson?.result?.[pmid];

        if (!item) return null;

        const articleIds = Array.isArray(item.articleids)
          ? item.articleids
          : [];

        const pmcid =
          articleIds.find(
            (articleId) =>
              articleId?.idtype === "pmc" || articleId?.idtype === "pmcid",
          )?.value || null;

        const doi =
          articleIds.find((articleId) => articleId?.idtype === "doi")?.value ||
          null;

        return {
          id: `pubmed:${pmid}`,
          url: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,
          title: item.title || `PubMed ${pmid}`,

          // Abstract now feeds the normal snippet-bearing pipeline.
          snippet: abstractsByPmid.get(String(pmid)) || "",

          source: "pubmed",
          score: Math.max(0, 1 - index * 0.05),

          pmid,
          pmcid,
          doi,

          pubdate: item.pubdate || null,
          authors: Array.isArray(item.authors)
            ? item.authors.map((author) => author.name).filter(Boolean)
            : [],
        };
      })
      .filter(Boolean);

    const withAbstracts = results.filter((result) => result.snippet).length;

    logger.log(
      `📚 [PubMed] Found ${results.length} results (${withAbstracts} with abstracts) for: "${term}"`,
    );

    return results;
  } catch (err) {
    logger.warn(`⚠️ [PubMed] Search failed for "${term}": ${err.message}`);

    return [];
  }
}
