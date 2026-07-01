import logger from "../utils/logger.js";
import { canonicalizeUrl } from "../utils/canonicalizeUrl.js";
import { getSearchProviderStatus, normalizeSearchGatewayConfig } from "./searchGatewayConfig.js";

const ENDPOINTS = {
  tavily: "https://api.tavily.com/search",
  brave: "https://api.search.brave.com/res/v1/web/search",
  serper: "https://google.serper.dev/search",
  bing: "https://api.bing.microsoft.com/v7.0/search",
};

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
  } else if (provider === "serper") {
    result = { id: raw.link || `serper:${index}`, url: raw.link, title: raw.title, snippet: raw.snippet || "", rawContent: null, publishedAt: raw.date || null, score: 1 / (index + 1), source: "serper" };
  } else {
    result = { id: raw.id || raw.url || `bing:${index}`, url: raw.url, title: raw.name || raw.title, snippet: raw.snippet || "", rawContent: null, publishedAt: raw.dateLastCrawled || null, score: Number(raw.rank) || 1 / (index + 1), source: "bing" };
  }
  return {
    ...result,
    domain: safeDomain(result.url),
    ...common,
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
    serper: async ({ query, topK }) => {
      const response = await fetchImpl(ENDPOINTS.serper, { method: "POST", headers: { "Content-Type": "application/json", "X-API-KEY": env.SERPER_API_KEY }, body: JSON.stringify({ q: query, num: topK }) });
      if (!response.ok) throw new Error(`Serper HTTP ${response.status}`);
      return (await response.json()).organic || [];
    },
    bing: async ({ query, topK }) => {
      const response = await fetchImpl(`${ENDPOINTS.bing}?q=${encodeURIComponent(query)}&count=${topK}`, { headers: { "Ocp-Apim-Subscription-Key": env.BING_SEARCH_API_KEY || env.BING_SEARCH_KEY } });
      if (!response.ok) throw new Error(`Bing HTTP ${response.status}`);
      return (await response.json()).webPages?.value || [];
    },
  };
}

function mergeResults(groups) {
  const merged = new Map();
  for (const result of groups.flat()) {
    const key = canonicalizeUrl(result.url) || result.url;
    if (!key) continue;
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, { ...result, canonicalUrl: key, providersSeen: [result.provider] });
      continue;
    }
    const providersSeen = [...new Set([...(existing.providersSeen || []), result.provider])];
    const preferred = Number(result.providerScore) > Number(existing.providerScore) ? result : existing;
    merged.set(key, { ...preferred, canonicalUrl: key, providersSeen, retrievalProvenance: [...(existing.retrievalProvenance || [existing]), result].map((item) => ({ provider: item.provider, providerRank: item.providerRank, providerQuery: item.providerQuery })) });
  }
  return [...merged.values()];
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
      return { provider, results: raw.map((item, index) => normalizeResult(provider, item, index, options.query, normalized.captureProviderMetadata)), rawCount: raw.length };
    } catch (error) {
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
    const results = mergeResults(calls.map((call) => call.results));
    log.log(`[SEARCH_GATEWAY] ${JSON.stringify({ search_gateway_enabled: normalized.enabled, mode: normalized.mode, retrieval_strategy: normalized.retrievalStrategy, providers: calls.map((call) => ({ provider: call.provider, raw_result_count: call.rawCount || 0, normalized_result_count: call.results.length, skipped: call.skipped || null, error: call.error || null })), query: bounded(options.query, 300), merged_result_count: results.length, provider_metadata_captured: normalized.captureProviderMetadata })}`);
    return results;
  }

  return { internal: async () => [], web, config: normalized, status };
}

export function logMissingSearchProviderKeys(config, env = process.env, log = logger) {
  const status = getSearchProviderStatus(config, env);
  for (const item of Object.values(status)) {
    if (item.enabled && !item.configured) log.warn(`${item.provider} Search is enabled but its API key is missing. Add the provider key or disable ${item.provider} in Admin > Evidence Retrieval Providers.`);
  }
  return status;
}
