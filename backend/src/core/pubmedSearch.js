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

async function fetchRetractionNoticeReason(pmid) {
  try {
    const pubmedUrl = new URL(PUBMED_EFETCH);
    pubmedUrl.searchParams.set("db", "pubmed");
    pubmedUrl.searchParams.set("id", pmid);
    pubmedUrl.searchParams.set("retmode", "xml");
    addPubMedParams(pubmedUrl);
    const pubmedResponse = await pubmedFetch(pubmedUrl);
    if (!pubmedResponse.ok) return null;
    const pubmedXml = await pubmedResponse.text();
    const pmcid = decodeXml(
      pubmedXml.match(/<ArticleId\b[^>]*IdType=["']pmc["'][^>]*>([\s\S]*?)<\/ArticleId>/i)?.[1],
    );
    if (!pmcid) return null;

    const pmcUrl = new URL(PUBMED_EFETCH);
    pmcUrl.searchParams.set("db", "pmc");
    pmcUrl.searchParams.set("id", pmcid.replace(/^PMC/i, ""));
    pmcUrl.searchParams.set("retmode", "xml");
    addPubMedParams(pmcUrl);
    const pmcResponse = await pubmedFetch(pmcUrl);
    if (!pmcResponse.ok) return null;
    const pmcXml = await pmcResponse.text();
    const body = pmcXml.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)?.[1] || "";
    const paragraphs = [...body.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)]
      .map((match) => decodeXml(match[1]))
      .filter((text) => /retract|competing interest|peer review|statistical|confidence|validity/i.test(text));
    return paragraphs.slice(0, 3).join(" ").slice(0, 1800) || null;
  } catch (error) {
    logger.warn(`⚠️ [PubMed] Retraction notice reason lookup failed for PMID ${pmid}: ${error.message}`);
    return null;
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

export function parsePubMedPublicationStatusXml(xml) {
  const publicationTypes = [...String(xml || "").matchAll(/<PublicationType\b[^>]*>([\s\S]*?)<\/PublicationType>/gi)]
    .map((match) => decodeXml(match[1]))
    .filter(Boolean);
  const correctionBlocks = [...String(xml || "").matchAll(/<CommentsCorrections\b([^>]*)>([\s\S]*?)<\/CommentsCorrections>/gi)];
  const retractionBlock = correctionBlocks.find((match) =>
    /\bRefType=["']RetractionIn["']/i.test(match[1] || ""),
  );
  const noticePmid = decodeXml(
    retractionBlock?.[2]?.match(/<PMID\b[^>]*>([\s\S]*?)<\/PMID>/i)?.[1],
  ) || null;
  const noticeCitation = decodeXml(
    retractionBlock?.[2]?.match(/<RefSource\b[^>]*>([\s\S]*?)<\/RefSource>/i)?.[1],
  ) || null;
  const noticeDoi = noticeCitation?.match(/10\.\d{4,9}\/[-._;()/:A-Z0-9]+/i)?.[0]?.replace(/[).,;]+$/, "") || null;
  const retracted =
    Boolean(retractionBlock) ||
    publicationTypes.some((type) =>
      /^(retracted publication|withdrawn publication)$/i.test(type),
    );

  return {
    status: retracted ? "retracted" : "unknown",
    source: retracted ? "pubmed_retraction_metadata" : "pubmed_publication_type",
    publicationTypes,
    retractionNotice: noticePmid || noticeDoi || noticeCitation
      ? {
          pmid: noticePmid,
          doi: noticeDoi,
          citation: noticeCitation,
          url: noticePmid
            ? `https://pubmed.ncbi.nlm.nih.gov/${noticePmid}/`
            : noticeDoi
              ? `https://doi.org/${noticeDoi}`
              : null,
          reason: null,
        }
      : null,
  };
}

/** Exact publication status for a known PMID; no title search or inference. */
export async function lookupPubMedPublicationStatus(pmid) {
  const id = String(pmid || "").match(/^\d{5,9}$/)?.[0];
  if (!id) return { status: "unknown", source: "pubmed", publicationTypes: [], retractionNotice: null };
  try {
    const fetchUrl = new URL(PUBMED_EFETCH);
    fetchUrl.searchParams.set("db", "pubmed");
    fetchUrl.searchParams.set("id", id);
    fetchUrl.searchParams.set("retmode", "xml");
    addPubMedParams(fetchUrl);
    const response = await pubmedFetch(fetchUrl);
    if (!response.ok) throw new Error(`PubMed efetch HTTP ${response.status}`);
    const xml = await response.text();
    const status = parsePubMedPublicationStatusXml(xml);
    if (status.retractionNotice?.pmid) {
      const abstracts = await fetchPubMedAbstracts([status.retractionNotice.pmid]);
      status.retractionNotice.reason =
        abstracts.get(status.retractionNotice.pmid) ||
        await fetchRetractionNoticeReason(status.retractionNotice.pmid);
    }
    return status;
  } catch (error) {
    logger.warn(`⚠️ [PubMed] Publication status lookup failed for PMID ${id}: ${error.message}`);
    return { status: "unknown", source: "pubmed", publicationTypes: [], retractionNotice: null };
  }
}
