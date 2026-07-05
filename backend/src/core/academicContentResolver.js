import * as cheerio from "cheerio";
import { SOURCE_IDENTITY_VERSION } from "../utils/publishingIdentityContract.js";

const PUBMED_BASE = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";
const cache = new Map();
let ncbiStartGate = Promise.resolve();
let nextNcbiStartAt = 0;

const clean = (value, max = 60000) => String(value ?? "")
  .replace(/\s+/g, " ")
  .trim()
  .slice(0, max);

function normalizeDoi(value) {
  return clean(value, 500)
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "")
    .replace(/^doi\s*:\s*/i, "")
    .replace(/(?:\.?Article|Pubmed|CrossRef|Keywords|Download|Editor|AbstractThe)$/i, "")
    .replace(/[.,;:)\]}]+$/, "");
}

export function detectAcademicIdentifiers(candidate = {}) {
  const url = String(candidate.url || "");
  const metadata = candidate.academicMetadata || {};
  const haystack = [url, candidate.title, candidate.snippet, metadata.pmid, metadata.pmcid, metadata.doi]
    .filter(Boolean)
    .join(" ");

  const pmcid = clean(
    metadata.pmcid ||
    url.match(/\/articles\/(PMC\d+)/i)?.[1] ||
    haystack.match(/\bPMC(?:ID)?\s*[:#]?\s*(PMC)?(\d{5,9})\b/i)?.[2],
    20,
  );
  const normalizedPmcid = pmcid
    ? (pmcid.toUpperCase().startsWith("PMC") ? pmcid.toUpperCase() : `PMC${pmcid}`)
    : null;
  const pmid = clean(
    metadata.pmid ||
    url.match(/pubmed\.ncbi\.nlm\.nih\.gov\/(\d{6,9})/i)?.[1] ||
    url.match(/\/pubmed\/(\d{6,9})/i)?.[1] ||
    haystack.match(/\bPMID\s*[:#]?\s*(\d{6,9})\b/i)?.[1],
    20,
  ) || null;
  const doiMatch = metadata.doi ||
    (url.match(/https?:\/\/(?:dx\.)?doi\.org\/([^?#\s]+)/i)?.[1]) ||
    haystack.match(/\b(10\.\d{4,9}\/[-._;()/:A-Z0-9]+)\b/i)?.[1];
  const doi = doiMatch ? normalizeDoi(decodeURIComponent(String(doiMatch))) : null;

  return { pmid, pmcid: normalizedPmcid, doi: doi || null };
}

function apiParams(env = {}) {
  return env.PUBMED_API_KEY ? `&api_key=${encodeURIComponent(env.PUBMED_API_KEY)}` : "";
}

export async function rateLimitedNcbiFetch(url, options = {}, fetchImpl = globalThis.fetch, env = process.env) {
  // Injected test transports should stay immediate and deterministic. Real
  // keyless NCBI traffic is globally paced to the documented three requests
  // per second; an API key permits the faster ten-per-second lane.
  if (fetchImpl !== globalThis.fetch) return fetchImpl(url, options);
  const intervalMs = env.PUBMED_API_KEY ? 110 : 350;
  let release;
  const turn = new Promise((resolve) => { release = resolve; });
  const previous = ncbiStartGate;
  ncbiStartGate = turn;
  await previous;
  const waitMs = Math.max(0, nextNcbiStartAt - Date.now());
  if (waitMs) await new Promise((resolve) => setTimeout(resolve, waitMs));
  nextNcbiStartAt = Date.now() + intervalMs;
  release();
  return fetchImpl(url, {
    ...options,
    signal: options.signal || AbortSignal.timeout(12000),
  });
}

async function fetchText(url, fetchImpl, env) {
  const response = await rateLimitedNcbiFetch(url, { headers: { Accept: "application/xml,text/xml" } }, fetchImpl, env);
  if (!response.ok) throw new Error(`NCBI API HTTP ${response.status}`);
  return response.text();
}

async function resolvePmidForDoi(doi, { fetchImpl, env }) {
  if (!doi) return null;
  const url = `${PUBMED_BASE}/esearch.fcgi?db=pubmed&term=${encodeURIComponent(`${doi}[AID]`)}&retmax=1&retmode=json${apiParams(env)}`;
  const response = await rateLimitedNcbiFetch(url, { headers: { Accept: "application/json" } }, fetchImpl, env);
  if (!response.ok) throw new Error(`PubMed DOI lookup HTTP ${response.status}`);
  const body = await response.json();
  return body?.esearchresult?.idlist?.[0] || null;
}

function textList($, selector, maxItems = 30) {
  return $(selector).toArray().map((node) => clean($(node).text(), 500)).filter(Boolean).slice(0, maxItems);
}

function publicationDate($, root) {
  const date = root.find("PubDate").first();
  const year = clean(date.find("Year").first().text(), 4);
  const month = clean(date.find("Month").first().text(), 20);
  const day = clean(date.find("Day").first().text(), 2);
  const medline = clean(date.find("MedlineDate").first().text(), 100);
  return [year, month, day].filter(Boolean).join(" ") || medline || null;
}

export function parsePubmedArticleXml(xml) {
  const $ = cheerio.load(xml || "", { xmlMode: true });
  const record = $("PubmedArticle").first();
  const article = record.find("Article").first();
  const journalNode = article.find("Journal").first();
  const title = clean(article.find("ArticleTitle").first().text(), 1000);
  const abstractParts = article.find("AbstractText").toArray().map((node) => {
    const label = clean($(node).attr("Label") || $(node).attr("NlmCategory"), 100);
    const body = clean($(node).text(), 12000);
    return body ? `${label ? `${label}: ` : ""}${body}` : "";
  }).filter(Boolean);
  const authors = article.find("AuthorList > Author").toArray().map((node) => {
    const collective = clean($(node).find("CollectiveName").first().text(), 300);
    if (collective) return collective;
    return clean([
      $(node).find("ForeName").first().text(),
      $(node).find("LastName").first().text(),
    ].filter(Boolean).join(" "), 300);
  }).filter(Boolean).slice(0, 50);
  const journal = clean(
    journalNode.find("Title").first().text() ||
    record.find("MedlineJournalInfo MedlineTA").first().text(),
    500,
  );
  const meshTerms = textList($, "PubmedArticle MeshHeading DescriptorName", 40);
  const publicationTypes = textList($, "PubmedArticle PublicationType", 20);
  const ids = {};
  $("PubmedArticle ArticleId").each((_, node) => {
    const type = String($(node).attr("IdType") || "").toLowerCase();
    if (type) ids[type] = clean($(node).text(), 500);
  });
  const pmid = clean($("PubmedArticle PMID").first().text(), 20) || ids.pubmed || null;
  const year = clean(
    journalNode.find("JournalIssue PubDate Year").first().text() ||
    article.find("ArticleDate Year").first().text() ||
    journalNode.find("MedlineDate").first().text().match(/\b(19|20)\d{2}\b/)?.[0],
    20,
  ) || null;
  const issn = clean(journalNode.find("ISSN").first().text(), 20) || null;
  const issnType = clean(journalNode.find("ISSN").first().attr("IssnType"), 30).toLowerCase();
  const abstract = clean(abstractParts.join("\n"), 30000);
  return {
    pmid,
    pmcid: ids.pmc ? ids.pmc.toUpperCase() : null,
    doi: ids.doi ? normalizeDoi(ids.doi) : null,
    title,
    abstract,
    authors,
    journal,
    meshTerms,
    publicationTypes,
    publishedAt: year,
    publicationDate: publicationDate($, journalNode),
    volume: clean(journalNode.find("JournalIssue Volume").first().text(), 50) || null,
    issue: clean(journalNode.find("JournalIssue Issue").first().text(), 50) || null,
    issns: issn ? [{ type: issnType === "electronic" ? "eissn" : "issn", value: issn }] : [],
  };
}

export function parsePmcFullTextXml(xml) {
  const $ = cheerio.load(xml || "", { xmlMode: true });
  const front = $("article > front").first();
  const journalMeta = front.find("journal-meta").first();
  const articleMeta = front.find("article-meta").first();
  const title = clean(articleMeta.find("title-group > article-title").first().text(), 1000);
  const abstract = clean(articleMeta.find("abstract").first().text(), 30000);
  const body = $("body").first();
  body.find("xref, table-wrap, fig, supplementary-material").remove();
  const bodyText = clean(body.text(), 60000);
  const fullText = clean([title, abstract, bodyText].filter(Boolean).join("\n\n"), 60000);
  const pmcid = clean(articleMeta.find("article-id[pub-id-type='pmc']").first().text(), 20);
  const pmid = clean(articleMeta.find("article-id[pub-id-type='pmid']").first().text(), 20);
  const doi = normalizeDoi(articleMeta.find("article-id[pub-id-type='doi']").first().text());
  const authors = articleMeta.find("contrib-group contrib[contrib-type='author']").toArray().map((node) => {
    const collective = clean($(node).find("collab").first().text(), 300);
    if (collective) return collective;
    return clean([
      $(node).find("name > given-names").first().text(),
      $(node).find("name > surname").first().text(),
    ].filter(Boolean).join(" "), 300);
  }).filter(Boolean).slice(0, 50);
  const journal = clean(
    journalMeta.find("journal-title-group > journal-title").first().text() ||
    journalMeta.find("journal-id[journal-id-type='nlm-ta']").first().text(),
    500,
  );
  const publisher = clean(journalMeta.find("publisher > publisher-name").first().text(), 500) || null;
  const issns = journalMeta.find("issn").toArray().map((node) => ({
    type: String($(node).attr("pub-type") || "").toLowerCase() === "epub" ? "eissn" : "issn",
    value: clean($(node).text(), 20),
  })).filter((item) => item.value);
  const pubDate = articleMeta.find("pub-date[pub-type='epub'], pub-date[date-type='pub'], pub-date").first();
  const publishedAt = clean(pubDate.find("year").first().text(), 4) || null;
  return {
    pmcid: pmcid ? (pmcid.toUpperCase().startsWith("PMC") ? pmcid.toUpperCase() : `PMC${pmcid}`) : null,
    pmid: pmid || null,
    doi: doi || null,
    title,
    abstract,
    fullText,
    authors,
    journal,
    publisher,
    issns,
    publicationTypes: textList($, "article-meta article-categories subject", 20),
    publishedAt,
    publicationDate: [
      publishedAt,
      clean(pubDate.find("month").first().text(), 20),
      clean(pubDate.find("day").first().text(), 2),
    ].filter(Boolean).join("-") || null,
    volume: clean(articleMeta.find("volume").first().text(), 50) || null,
    issue: clean(articleMeta.find("issue").first().text(), 50) || null,
  };
}

async function fetchCrossrefRecord(doi, { fetchImpl, env }) {
  if (!doi) return null;
  const mailto = env.CROSSREF_MAILTO ? `?mailto=${encodeURIComponent(env.CROSSREF_MAILTO)}` : "";
  const response = await fetchImpl(`https://api.crossref.org/works/${encodeURIComponent(doi)}${mailto}`, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) throw new Error(`Crossref DOI lookup HTTP ${response.status}`);
  const item = (await response.json())?.message || {};
  const dateParts = item.published?.["date-parts"]?.[0] || item["published-print"]?.["date-parts"]?.[0] || [];
  return {
    publisher: clean(item.publisher, 500) || null,
    journal: clean(item["container-title"]?.[0], 500) || null,
    authors: (item.author || []).map((author) => clean(`${author.given || ""} ${author.family || ""}`, 300)).filter(Boolean),
    issns: (item.ISSN || []).map((value) => ({ type: "issn", value: clean(value, 20) })).filter((item) => item.value),
    publicationTypes: item.type ? [clean(item.type, 100)] : [],
    publishedAt: dateParts[0] ? String(dateParts[0]) : null,
    publicationDate: dateParts.length ? dateParts.filter(Boolean).join("-") : null,
    volume: clean(item.volume, 50) || null,
    issue: clean(item.issue, 50) || null,
  };
}

async function fetchPubmedRecord(pmid, { fetchImpl, env }) {
  if (!pmid) return null;
  const url = `${PUBMED_BASE}/efetch.fcgi?db=pubmed&id=${encodeURIComponent(pmid)}&retmode=xml${apiParams(env)}`;
  return parsePubmedArticleXml(await fetchText(url, fetchImpl, env));
}

async function fetchPmcRecord(pmcid, { fetchImpl, env }) {
  if (!pmcid) return null;
  const url = `${PUBMED_BASE}/efetch.fcgi?db=pmc&id=${encodeURIComponent(pmcid)}&retmode=xml${apiParams(env)}`;
  const parsed = parsePmcFullTextXml(await fetchText(url, fetchImpl, env));
  return parsed.fullText.length >= 200 ? parsed : null;
}

async function resolveUncached(candidate, { fetchImpl, env }) {
  const detected = detectAcademicIdentifiers(candidate);
  if (!detected.pmid && !detected.pmcid && !detected.doi) return null;

  let pmid = detected.pmid;
  if (!pmid && detected.doi) {
    try { pmid = await resolvePmidForDoi(detected.doi, { fetchImpl, env }); } catch { /* DOI may not be indexed in PubMed. */ }
  }

  let pmc = null;
  if (detected.pmcid) {
    try { pmc = await fetchPmcRecord(detected.pmcid, { fetchImpl, env }); } catch { /* PubMed fallback may remain usable. */ }
    if (!pmid && pmc?.pmid) pmid = pmc.pmid;
  }
  let pubmed = null;
  if (pmid) {
    try { pubmed = await fetchPubmedRecord(pmid, { fetchImpl, env }); } catch { /* Preserve PMC-only fallback. */ }
  }
  const pmcid = detected.pmcid || pubmed?.pmcid || null;
  if (pmcid && !pmc) {
    try { pmc = await fetchPmcRecord(pmcid, { fetchImpl, env }); } catch { /* Abstract remains usable. */ }
  }

  const doi = detected.doi || pubmed?.doi || pmc?.doi || null;
  let crossref = null;
  if (doi && !pmc?.publisher) {
    try { crossref = await fetchCrossrefRecord(doi, { fetchImpl, env }); } catch { /* Journal metadata remains usable without Crossref. */ }
  }

  const cleanText = pmc?.fullText || pubmed?.abstract || "";
  const retrievalMode = pmc?.fullText
    ? "full_text"
    : pubmed?.abstract
      ? "abstract_only"
      : "metadata_only";
  const title = pmc?.title || pubmed?.title || candidate.title || "Academic source";
  const authors = pubmed?.authors?.length ? pubmed.authors
    : pmc?.authors?.length ? pmc.authors
      : crossref?.authors?.length ? crossref.authors
        : String(candidate.academicMetadata?.authors || "").split(/\s*,\s*/).filter(Boolean);
  const journal = pubmed?.journal || pmc?.journal || crossref?.journal || candidate.academicMetadata?.journal || candidate.academicMetadata?.containerTitle || candidate.academicMetadata?.venue || "";
  const publisher = pmc?.publisher || crossref?.publisher || candidate.academicMetadata?.publisher || "";
  const meshTerms = pubmed?.meshTerms || [];
  const publicationTypes = pubmed?.publicationTypes?.length ? pubmed.publicationTypes
    : pmc?.publicationTypes?.length ? pmc.publicationTypes
      : crossref?.publicationTypes || [];
  const bearingText = clean([
    title,
    cleanText,
    authors.length ? `Authors: ${authors.join(", ")}` : "",
    journal ? `Journal: ${journal}` : "",
    meshTerms.length ? `MeSH: ${meshTerms.join(", ")}` : "",
    publicationTypes.length ? `Publication types: ${publicationTypes.join(", ")}` : "",
  ].filter(Boolean).join(" — "), 40000);

  return {
    apiBacked: true,
    retrievalMode,
    cleanText,
    bearingText,
    title,
    authors,
    journal,
    publisher,
    issns: pubmed?.issns?.length ? pubmed.issns : pmc?.issns?.length ? pmc.issns : crossref?.issns || [],
    meshTerms,
    publicationTypes,
    publishedAt: pubmed?.publishedAt || pmc?.publishedAt || crossref?.publishedAt || candidate.publishedAt || null,
    publicationDate: pubmed?.publicationDate || pmc?.publicationDate || crossref?.publicationDate || null,
    volume: pubmed?.volume || pmc?.volume || crossref?.volume || null,
    issue: pubmed?.issue || pmc?.issue || crossref?.issue || null,
    identifiers: {
      pmid: pmid || pubmed?.pmid || pmc?.pmid || null,
      pmcid: pmcid || pmc?.pmcid || null,
      doi,
    },
  };
}

export function buildAcademicPublishingIdentity(api = {}, sourceUrl = "") {
  const authors = (api.authors || []).map((name) => ({
    name: clean(name, 300),
    extraction_method: "academic_api_metadata",
    extraction_confidence: "high",
    evidence_quote: clean(name, 300),
  })).filter((author) => author.name);
  const identifiers = Object.entries(api.identifiers || {}).filter(([, value]) => value).map(([type, value]) => ({
    identifier_type: type,
    identifier_scope: "article",
    normalized_value: value,
    raw_value: value,
    extraction_method: "academic_api_metadata",
    extraction_confidence: "high",
    evidence_quote: value,
  }));
  identifiers.push(...(api.issns || []).map((item) => ({
    identifier_type: item.type || "issn",
    identifier_scope: "venue",
    normalized_value: item.value,
    raw_value: item.value,
    extraction_method: "academic_api_metadata",
    extraction_confidence: "high",
    evidence_quote: item.value,
  })));
  const repository = api.identifiers?.pmcid ? "PubMed Central" : api.identifiers?.pmid ? "PubMed" : null;
  const publicationType = (api.publicationTypes || []).find(Boolean) || null;
  const confidence = api.publisher ? 0.98 : 0;
  return {
    version: SOURCE_IDENTITY_VERSION,
    source_url: sourceUrl || null,
    document: {
      article_type: publicationType,
      publication_date: api.publicationDate || null,
      publication_year: Number(api.publishedAt) || null,
      volume: api.volume || null,
      issue: api.issue || null,
      identifiers,
      authors,
    },
    entities: {
      publishing_organization: {
        name: api.publisher || null, entity_type: "organization", method: api.publisher ? "crossref_or_pmc_api" : null,
        confidence, evidence: api.publisher || null,
      },
      publication_venue: {
        name: api.journal || null, entity_type: "journal", venue_type: "journal", method: api.journal ? "ncbi_or_crossref_api" : null,
        confidence: api.journal ? 0.98 : 0, evidence: api.journal || null,
      },
      repository: repository ? {
        name: repository, entity_type: "repository", venue_type: "repository", method: "academic_identifier", confidence: 1,
        evidence: api.identifiers?.pmcid || api.identifiers?.pmid,
      } : null,
    },
    context: {
      context_type: "scholarly",
      platform: repository,
      publisher_name_observed: api.publisher || null,
      venue_name: api.journal || null,
      venue_type: "journal",
      article_type: publicationType,
      volume: api.volume || null,
      issue: api.issue || null,
      publication_date: api.publicationDate || null,
      publication_year: Number(api.publishedAt) || null,
      distribution_channel: repository,
      extraction_method: "academic_api_metadata",
      extraction_confidence: api.publisher && api.journal ? 0.98 : 0.9,
      extractor_version: SOURCE_IDENTITY_VERSION,
      raw_metadata: { identifiers: api.identifiers || {}, issns: api.issns || [] },
    },
    candidates: [],
    warnings: api.publisher ? [] : ["Corporate publisher was not present in available academic metadata."],
  };
}

export async function fetchAcademicApiContent(candidate, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const env = options.env || process.env;
  const ids = detectAcademicIdentifiers(candidate);
  if (!ids.pmid && !ids.pmcid && !ids.doi) return null;
  const key = ids.pmcid || ids.pmid || ids.doi;
  if (!options.disableCache && cache.has(key)) return cache.get(key);
  const promise = resolveUncached(candidate, { fetchImpl, env }).catch(() => null);
  if (!options.disableCache) cache.set(key, promise);
  const result = await promise;
  if (!result && !options.disableCache) cache.delete(key);
  return result;
}

export async function enrichAcademicCandidates(candidates = [], options = {}) {
  const input = Array.isArray(candidates) ? candidates : [];
  const output = new Array(input.length);
  let cursor = 0;
  const workerCount = Math.min(3, Math.max(1, input.length));
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (cursor < input.length) {
      const index = cursor++;
      const candidate = input[index];
      const identifiers = detectAcademicIdentifiers(candidate);
      if (!identifiers.pmid && !identifiers.pmcid && !identifiers.doi) {
        output[index] = candidate;
        continue;
      }
      const academicApiContent = await fetchAcademicApiContent(candidate, options);
      const discoveryRoutes = Array.isArray(candidate.discoveryRoutes)
        ? candidate.discoveryRoutes
        : [candidate.discoveryRoute || (/^(?:pubmed|crossref|openalex|semantic_scholar)$/.test(candidate.provider || "")
          ? "direct_academic_search"
          : "web_search")];
      const academicDiscoveryRoute = discoveryRoutes.includes("direct_academic_search") && discoveryRoutes.includes("web_search")
        ? "direct_and_web"
        : discoveryRoutes.includes("direct_academic_search") ? "direct_academic_search" : "web_discovered_identifier";
      output[index] = academicApiContent ? {
        ...candidate,
        title: academicApiContent.title || candidate.title,
        publishedAt: academicApiContent.publishedAt || candidate.publishedAt,
        // Keep the query-conditioned provider excerpt distinct from the
        // authoritative API text used for academic bearing assessment.
        snippet: candidate.snippet || "",
        searchSnippet: candidate.searchSnippet ?? candidate.snippet ?? "",
        bearingText: academicApiContent.bearingText || candidate.snippet || "",
        snippetSource: candidate.snippetSource || "search_provider",
        bearingTextSource: academicApiContent.retrievalMode === "full_text"
          ? "pmc_full_text"
          : academicApiContent.retrievalMode === "abstract_only" ? "pubmed_abstract" : "academic_metadata",
        academicDiscoveryRoute,
        discoveryRoutes,
        academicApiContent,
        academicMetadata: {
          ...(candidate.academicMetadata || {}),
          ...academicApiContent.identifiers,
          authors: academicApiContent.authors.join(", "),
          journal: academicApiContent.journal,
          publisher: academicApiContent.publisher,
          meshTerms: academicApiContent.meshTerms,
          publicationTypes: academicApiContent.publicationTypes,
          retrievalMode: academicApiContent.retrievalMode,
        },
      } : candidate;
    }
  }));
  return output;
}

export function clearAcademicContentCacheForTests() {
  cache.clear();
}
