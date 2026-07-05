import logger from "../utils/logger.js";
import { canonicalizeUrl } from "../utils/canonicalizeUrl.js";
import { getSearchProviderStatus, normalizeSearchGatewayConfig, KEYLESS_PROVIDERS } from "./searchGatewayConfig.js";
import { pubmedSearch, crossrefSearch, openAlexSearch, semanticScholarSearch, isAcademicQuery } from "./academicProviders.js";

const ENDPOINTS = {
  tavily: "https://api.tavily.com/search",
  brave: "https://api.search.brave.com/res/v1/web/search",
  serpapi: "https://serpapi.com/search",
  bing: "https://api.bing.microsoft.com/v7.0/search",
  // academic providers: endpoints are managed inside academicProviders.js
  pubmed: "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi",
  crossref: "https://api.crossref.org/works",
  openalex: "https://api.openalex.org/works",
  semantic_scholar: "https://api.semanticscholar.org/graph/v1/paper/search",
};
const providerHealth = new Map();
const ACADEMIC_PROVIDERS = new Set(["pubmed", "crossref", "openalex", "semantic_scholar"]);

export function getEvidenceRetrievalProviderHealth() {
  return Object.fromEntries(providerHealth);
}

const bounded = (value, max = 500) => {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
};

function safeDomain(url) {
  try { return new URL(url).hostname; } catch { return null; }
}

function metadata(raw, provider, extra = {}) {
  return {
    provider,
    ...extra,
    raw_provider_keys: Object.keys(raw || {}).slice(0, 30),
  };
}

function normalizeResult(provider, raw, index, query, captureMetadata) {
  const common = {
    provider,
    providerRank: index + 1,
    providerScore: Number(raw?.score) || 1 / (index + 1),
    providerQuery: query,
  };
  let result;
  if (provider === "tavily") {
    result = { id: raw.id || raw.url || `tavily:${index}`, url: raw.url, title: raw.title, snippet: raw.content || raw.snippet || "", rawContent: raw.raw_content || null, publishedAt: raw.published_date || null, score: Number(raw.score) || 1 / (index + 1), source: "web_search" };
  } else if (provider === "brave") {
    result = { id: raw.url || `brave:${index}`, url: raw.url, title: raw.title, snippet: raw.description || raw.snippet || "", rawContent: null, publishedAt: raw.page_age || raw.age || null, score: 1 / (index + 1), source: "brave" };
  } else if (provider === "serpapi") {
    result = { id: raw.link || `serpapi:${index}`, url: raw.link, title: raw.title, snippet: raw.snippet || "", rawContent: null, publishedAt: raw.date || null, score: 1 / (index + 1), source: "serpapi" };
  } else if (provider === "pubmed") {
    result = { id: raw.pmid ? `pubmed:${raw.pmid}` : (raw.url || `pubmed:${index}`), url: raw.url, title: raw.title, snippet: raw.snippet || "", rawContent: null, publishedAt: raw.publishedAt || null, score: raw.score || 1 / (index + 1), source: "pubmed" };
  } else if (provider === "crossref") {
    result = { id: raw.doi ? `crossref:${raw.doi}` : (raw.url || `crossref:${index}`), url: raw.url, title: raw.title, snippet: raw.snippet || "", rawContent: null, publishedAt: raw.publishedAt || null, score: raw.score || 1 / (index + 1), source: "crossref" };
  } else if (provider === "openalex") {
    result = { id: raw.openAlexId || raw.url || `openalex:${index}`, url: raw.url, title: raw.title, snippet: raw.snippet || "", rawContent: null, publishedAt: raw.publishedAt || null, score: raw.score || 1 / (index + 1), source: "openalex" };
  } else if (provider === "semantic_scholar") {
    result = { id: raw.paperId ? `s2:${raw.paperId}` : (raw.url || `s2:${index}`), url: raw.url, title: raw.title, snippet: raw.snippet || "", rawContent: null, publishedAt: raw.publishedAt || null, score: raw.score || 1 / (index + 1), source: "semantic_scholar" };
  } else {
    result = { id: raw.id || raw.url || `bing:${index}`, url: raw.url, title: raw.name || raw.title, snippet: raw.snippet || "", rawContent: null, publishedAt: raw.dateLastCrawled || null, score: Number(raw.rank) || 1 / (index + 1), source: "bing" };
  }

  // Collect academic identifiers and metadata additively.
  const academicMeta = {};
  if (raw.pmid) academicMeta.pmid = raw.pmid;
  if (raw.doi) academicMeta.doi = raw.doi;
  if (raw.openAlexId) academicMeta.openAlexId = raw.openAlexId;
  if (raw.paperId) academicMeta.semanticScholarId = raw.paperId;
  if (raw.authors) academicMeta.authors = raw.authors;
  if (raw.publisher) academicMeta.publisher = raw.publisher;
  if (raw.journal) academicMeta.journal = raw.journal;
  if (raw.containerTitle) academicMeta.containerTitle = raw.containerTitle;
  if (raw.venue) academicMeta.venue = raw.venue;
  if (raw.citedByCount != null) academicMeta.citedByCount = raw.citedByCount;
  if (raw.citationCount != null) academicMeta.citationCount = raw.citationCount;
  if (raw.influentialCitationCount != null) academicMeta.influentialCitationCount = raw.influentialCitationCount;
  if (raw.hasRetraction != null) academicMeta.hasRetraction = raw.hasRetraction;
  if (raw.hasCorrectionOfRecord != null) academicMeta.hasCorrectionOfRecord = raw.hasCorrectionOfRecord;
  if (raw.publicationTypes) academicMeta.publicationTypes = raw.publicationTypes;
  if (raw.concepts) academicMeta.concepts = raw.concepts;

  return {
    ...result,
    searchSnippet: result.snippet || "",
    snippetSource: "search_provider",
    discoveryRoute: ACADEMIC_PROVIDERS.has(provider) ? "direct_academic_search" : "web_search",
    discoveryRoutes: [ACADEMIC_PROVIDERS.has(provider) ? "direct_academic_search" : "web_search"],
    domain: safeDomain(result.url),
    ...common,
    ...(Object.keys(academicMeta).length ? { academicMetadata: academicMeta } : {}),
    ...(captureMetadata ? { providerMetadata: metadata(raw, provider, { date: result.publishedAt, source_type: raw?.type || null, sitelinks: (raw?.sitelinks || []).slice(0, 10) }) } : {}),
  };
}

function createDefaultProviders({ env, fetchImpl }) {
  return {
    tavily: async ({ query, topK, prefer, avoid, includeRawContent }) => {
      const body = { api_key: env.TAVILY_API_KEY, query, max_results: topK, search_depth: includeRawContent ? "advanced" : "basic", include_raw_content: Boolean(includeRawContent) };
      if (prefer?.length) body.include_domains = prefer;
      if (avoid?.length) body.exclude_domains = avoid;
      const response = await fetchImpl(ENDPOINTS.tavily, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!response.ok) throw new Error(`Tavily HTTP ${response.status}`);
      return (await response.json()).results || [];
    },
    brave: async ({ query, topK }) => {
      const url = `${ENDPOINTS.brave}?q=${encodeURIComponent(query)}&count=${topK}`;
      const response = await fetchImpl(url, { headers: { Accept: "application/json", "X-Subscription-Token": env.BRAVE_SEARCH_API_KEY } });
      if (!response.ok) throw new Error(`Brave HTTP ${response.status}`);
      return (await response.json()).web?.results || [];
    },
    serpapi: async ({ query, topK }) => {
      const params = new URLSearchParams({
        engine: "google",
        q: query,
        num: String(topK),
        api_key: env.SERPAPI_API_KEY || env.SERPER_API_KEY || "",
      });
      const response = await fetchImpl(`${ENDPOINTS.serpapi}?${params.toString()}`, {
        headers: { Accept: "application/json" },
      });
      if (!response.ok) throw new Error(`SerpApi HTTP ${response.status}`);
      return (await response.json()).organic_results || [];
    },
    bing: async ({ query, topK }) => {
      const response = await fetchImpl(`${ENDPOINTS.bing}?q=${encodeURIComponent(query)}&count=${topK}`, { headers: { "Ocp-Apim-Subscription-Key": env.BING_SEARCH_API_KEY || env.BING_SEARCH_KEY } });
      if (!response.ok) throw new Error(`Bing HTTP ${response.status}`);
      return (await response.json()).webPages?.value || [];
    },
    pubmed: async ({ query, topK }) => pubmedSearch({ query, topK, env, fetchImpl }),
    crossref: async ({ query, topK }) => crossrefSearch({ query, topK, env, fetchImpl }),
    openalex: async ({ query, topK }) => openAlexSearch({ query, topK, env, fetchImpl }),
    semantic_scholar: async ({ query, topK }) => semanticScholarSearch({ query, topK, env, fetchImpl }),
  };
}

function mergeResults(calls) {
  const merged = new Map();
  const providerStats = [];

  for (const call of calls) {
    const group = call.results || [];
    let added = 0;
    let deduped = 0;
    const urlsAdded = [];

    for (const result of group) {
      const key = canonicalizeUrl(result.url) || result.url;
      if (!key) continue;
      const existing = merged.get(key);
      if (!existing) {
        merged.set(key, {
          ...result,
          canonicalUrl: key,
          providersSeen: [result.provider],
          discoveryRoutes: [...new Set(result.discoveryRoutes || [result.discoveryRoute])].filter(Boolean),
          snippetVariants: [{ provider: result.provider, rank: result.providerRank, snippet: bounded(result.snippet, 1200) }],
        });
        added++;
        urlsAdded.push(result.url);
      } else {
        const providersSeen = [...new Set([...(existing.providersSeen || []), result.provider])];
        const discoveryRoutes = [...new Set([
          ...(existing.discoveryRoutes || []),
          ...(result.discoveryRoutes || [result.discoveryRoute]),
        ])].filter(Boolean);
        const preferred = Number(result.providerScore) > Number(existing.providerScore) ? result : existing;
        merged.set(key, { ...preferred, canonicalUrl: key, providersSeen, discoveryRoutes,
          searchSnippet: preferred.searchSnippet ?? preferred.snippet ?? "",
          snippetVariants: [
            ...(existing.snippetVariants || [{ provider: existing.provider, rank: existing.providerRank, snippet: bounded(existing.snippet, 1200) }]),
            { provider: result.provider, rank: result.providerRank, snippet: bounded(result.snippet, 1200) },
          ].slice(0, 8),
          retrievalProvenance: [...(existing.retrievalProvenance || [existing]), result]
            .map((item) => ({ provider: item.provider, providerRank: item.providerRank, providerQuery: item.providerQuery })) });
        deduped++;
      }
    }

    providerStats.push({
      provider: call.provider,
      queries: call.query ? [call.query] : [],
      results_returned: call.rawCount ?? group.length,
      unique_candidates_added: added,
      deduped_against_existing: deduped,
      candidate_urls_added: urlsAdded.slice(0, 10),
    });
  }

  return { results: [...merged.values()], providerStats };
}

export function createEvidenceRetrievalGateway({ config = {}, env = process.env, fetchImpl = globalThis.fetch, providers = null, log = logger } = {}) {
  const normalized = normalizeSearchGatewayConfig(config, env);
  const adapters = providers || createDefaultProviders({ env, fetchImpl });
  const status = getSearchProviderStatus(normalized, env);

  async function callProvider(provider, options) {
    if (!normalized.providerEnabled?.[provider]) return { provider, results: [], skipped: "skipped_disabled" };
    if (!status[provider]?.configured && !providers) return { provider, results: [], skipped: "skipped_missing_api_key" };
    if (typeof adapters[provider] !== "function") return { provider, results: [], skipped: "skipped_missing_config" };
    try {
      const raw = await adapters[provider](options);
      providerHealth.set(provider, { lastSuccessfulCall: new Date().toISOString(), lastError: null });
      return { provider, results: raw.map((item, index) => normalizeResult(provider, item, index, options.query, normalized.captureProviderMetadata)), rawCount: raw.length };
    } catch (error) {
      providerHealth.set(provider, { ...(providerHealth.get(provider) || {}), lastError: bounded(error.message, 240), lastErrorAt: new Date().toISOString() });
      return { provider, results: [], error: bounded(error.message, 240) };
    }
  }

  async function web(input = {}) {
    const options = { ...input, topK: Math.min(Number(input.topK) || normalized.maxResultsPerQuery, normalized.maxResultsPerQuery) };
    if (!options.query?.trim()) return [];
    let providerOrder;
    const allUpFront = normalized.retrievalStrategy === "best_bearing_pool" || normalized.retrievalStrategy === "diagnostic_bakeoff";
    if (normalized.mode === "ensemble" || allUpFront) providerOrder = normalized.providers;
    else if (normalized.mode === "fallback") providerOrder = [normalized.provider, ...normalized.fallbacks.filter((item) => item !== normalized.provider)];
    else providerOrder = [normalized.provider];

    // `onlyProviders` is used by bibliographic identity resolution after a
    // web result identifies a likely study page. It must not spend another
    // tranche on general web engines. `providers` remains additive for normal
    // evidence searches.
    if (Array.isArray(input.onlyProviders) && input.onlyProviders.length) {
      providerOrder = [...new Set(input.onlyProviders)];
    } else if (Array.isArray(input.providers) && input.providers.length) {
      providerOrder = [...new Set([...providerOrder, ...input.providers])];
    } else if (input.includeAcademic || isAcademicQuery(options.query)) {
      // Auto-include academic providers that are globally enabled for biomedical queries.
      const academicProviders = ["pubmed", "crossref", "openalex", "semantic_scholar"].filter(
        (p) => normalized.providerEnabled?.[p],
      );
      if (academicProviders.length) providerOrder = [...new Set([...providerOrder, ...academicProviders])];
    }

    providerOrder = [...new Set(providerOrder)].slice(0, normalized.maxProvidersPerTarget);

    const calls = [];
    if (normalized.mode === "fallback" && !allUpFront) {
      for (const provider of providerOrder) {
        const outcome = await callProvider(provider, options);
        calls.push(outcome);
        if (outcome.results.length) break;
      }
    } else {
      calls.push(...await Promise.all(providerOrder.map((provider) => callProvider(provider, options))));
    }
    const callsWithQuery = calls.map((call) => ({ ...call, query: options.query }));
    const { results, providerStats } = mergeResults(callsWithQuery);
    log.log(`[SEARCH_GATEWAY] ${JSON.stringify({ search_gateway_enabled: normalized.enabled, mode: normalized.mode, retrieval_strategy: normalized.retrievalStrategy, query: bounded(options.query, 300), merged_result_count: results.length, provider_metadata_captured: normalized.captureProviderMetadata, providers: calls.map((call) => ({ provider: call.provider, raw_result_count: call.rawCount || 0, normalized_result_count: call.results.length, skipped: call.skipped || null, error: call.error || null })) })}`);
    for (const stat of providerStats) {
      if (stat.results_returned > 0 || stat.unique_candidates_added > 0) {
        log.log(`[SEARCH_GATEWAY_PROVIDER] ${JSON.stringify(stat)}`);
      }
    }
    return results;
  }

  return { internal: async () => [], web, config: normalized, status };
}

export function logMissingSearchProviderKeys(config, env = process.env, log = logger) {
  const status = getSearchProviderStatus(config, env);
  const keyEnvVar = {
    tavily: "TAVILY_API_KEY",
    brave: "BRAVE_SEARCH_API_KEY",
    serpapi: "SERPAPI_API_KEY",
    bing: "BING_SEARCH_API_KEY",
    pubmed: "PUBMED_API_KEY (optional — improves rate limits)",
    crossref: "CROSSREF_MAILTO (optional — improves rate limits)",
    openalex: "OPENALEX_MAILTO (optional — improves rate limits)",
    semantic_scholar: "SEMANTIC_SCHOLAR_API_KEY (optional — improves rate limits)",
  };
  const enableEnvVar = {
    brave: "ENABLE_BRAVE_SEARCH",
    serpapi: "ENABLE_SERPAPI_SEARCH",
    bing: "ENABLE_BING_SEARCH",
    pubmed: "ENABLE_PUBMED_SEARCH",
    crossref: "ENABLE_CROSSREF_SEARCH",
    openalex: "ENABLE_OPENALEX_SEARCH",
    semantic_scholar: "ENABLE_SEMANTIC_SCHOLAR_SEARCH",
  };
  for (const item of Object.values(status)) {
    if (item.enabled && !item.configured) {
      log.warn(`[SEARCH_GATEWAY] ${item.provider} is enabled but ${keyEnvVar[item.provider]} is missing. Add it to .env or disable ${item.provider} in Admin > Evidence Retrieval Providers.`);
    } else if (!item.enabled && item.keyOptional) {
      log.log(`[SEARCH_GATEWAY] ${item.provider} is available (no API key required). To enable: set ${enableEnvVar[item.provider]}=true in .env.`);
    } else if (!item.enabled && !item.configured && keyEnvVar[item.provider]) {
      log.log(`[SEARCH_GATEWAY] ${item.provider} is available but not configured. To enable: add ${keyEnvVar[item.provider]} to .env${enableEnvVar[item.provider] ? ` and set ${enableEnvVar[item.provider]}=true` : ""}.`);
    }
  }
  return status;
}
