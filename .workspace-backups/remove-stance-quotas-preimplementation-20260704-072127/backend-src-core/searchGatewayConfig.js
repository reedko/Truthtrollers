const DEFAULTS = Object.freeze({
  enabled: true,
  mode: "single",
  provider: "tavily",
  providers: ["tavily", "brave", "serpapi"],
  fallbacks: ["brave", "serpapi", "tavily"],
  retrievalStrategy: "best_bearing_pool",
  minHighBearingClaimsPerTarget: 5,
  maxResultsPerQuery: 10,
  providerBudgetPerTargetUsd: 0.05,
  maxProvidersPerTarget: 7,
  maxSourcesToScrapePerTarget: 10,
  captureProviderMetadata: true,
  metadataInSnippetFallback: false,
  providerEnabled: {
    tavily: true,
    brave: false,
    serpapi: false,
    bing: false,
    pubmed: false,
    crossref: false,
    openalex: false,
    semantic_scholar: false,
  },
});

const asBool = (value, fallback) => value == null ? fallback : value === true || String(value).toLowerCase() === "true";
const asNumber = (value, fallback, min, max) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
};
const canonicalProviderName = (value) => String(value || "").trim().toLowerCase() === "serper"
  ? "serpapi"
  : String(value || "").trim().toLowerCase();
const asList = (value, fallback) => {
  if (Array.isArray(value)) return value.map(canonicalProviderName).filter(Boolean);
  if (typeof value === "string") return value.split(",").map(canonicalProviderName).filter(Boolean);
  return [...fallback];
};

export function normalizeSearchGatewayConfig(raw = {}, env = process.env) {
  const mode = ["single", "fallback", "ensemble"].includes(raw.mode) ? raw.mode : DEFAULTS.mode;
  const retrievalStrategy = ["cost_saver", "best_bearing_pool", "diagnostic_bakeoff"].includes(raw.retrievalStrategy)
    ? raw.retrievalStrategy
    : (env.RETRIEVAL_STRATEGY || DEFAULTS.retrievalStrategy);
  const provider = canonicalProviderName(env.SEARCH_PROVIDER || raw.provider || DEFAULTS.provider);
  const providers = asList(env.SEARCH_PROVIDERS ?? raw.providers, DEFAULTS.providers);
  const fallbacks = asList(env.SEARCH_PROVIDER_FALLBACKS ?? raw.fallbacks, DEFAULTS.fallbacks);
  const providerEnabled = {
    tavily: asBool(raw.providerEnabled?.tavily, DEFAULTS.providerEnabled.tavily),
    // DB (admin panel) wins over .env so the admin panel can enable/disable without redeploying.
    // env var is only used when DB hasn't explicitly set the provider.
    brave: asBool(raw.providerEnabled?.brave ?? env.ENABLE_BRAVE_SEARCH, DEFAULTS.providerEnabled.brave),
    serpapi: asBool(
      raw.providerEnabled?.serpapi ?? raw.providerEnabled?.serper ??
      env.ENABLE_SERPAPI_SEARCH ?? env.ENABLE_SERPER_SEARCH,
      DEFAULTS.providerEnabled.serpapi,
    ),
    bing: asBool(raw.providerEnabled?.bing, DEFAULTS.providerEnabled.bing),
    pubmed: asBool(raw.providerEnabled?.pubmed ?? env.ENABLE_PUBMED_SEARCH, DEFAULTS.providerEnabled.pubmed),
    crossref: asBool(raw.providerEnabled?.crossref ?? env.ENABLE_CROSSREF_SEARCH, DEFAULTS.providerEnabled.crossref),
    openalex: asBool(raw.providerEnabled?.openalex ?? env.ENABLE_OPENALEX_SEARCH, DEFAULTS.providerEnabled.openalex),
    semantic_scholar: asBool(raw.providerEnabled?.semantic_scholar ?? env.ENABLE_SEMANTIC_SCHOLAR_SEARCH, DEFAULTS.providerEnabled.semantic_scholar),
  };
  return {
    enabled: asBool(env.ENABLE_SEARCH_GATEWAY ?? raw.enabled, DEFAULTS.enabled),
    mode: asBool(env.ENABLE_SEARCH_ENSEMBLE, false) ? "ensemble" : mode,
    provider,
    providers,
    fallbacks,
    retrievalStrategy,
    minHighBearingClaimsPerTarget: Math.round(asNumber(env.MIN_HIGH_BEARING_CLAIMS_PER_TARGET ?? raw.minHighBearingClaimsPerTarget, DEFAULTS.minHighBearingClaimsPerTarget, 1, 20)),
    maxResultsPerQuery: Math.round(asNumber(env.SEARCH_MAX_RESULTS_PER_QUERY ?? raw.maxResultsPerQuery, DEFAULTS.maxResultsPerQuery, 1, 50)),
    providerBudgetPerTargetUsd: asNumber(env.SEARCH_PROVIDER_BUDGET_PER_TARGET_USD ?? raw.providerBudgetPerTargetUsd, DEFAULTS.providerBudgetPerTargetUsd, 0, 100),
    maxProvidersPerTarget: Math.round(asNumber(env.SEARCH_MAX_PROVIDERS_PER_TARGET ?? raw.maxProvidersPerTarget, DEFAULTS.maxProvidersPerTarget, 1, 20)),
    maxSourcesToScrapePerTarget: Math.round(asNumber(env.SEARCH_MAX_SOURCES_TO_SCRAPE_PER_TARGET ?? raw.maxSourcesToScrapePerTarget, DEFAULTS.maxSourcesToScrapePerTarget, 1, 100)),
    captureProviderMetadata: asBool(env.ENABLE_PROVIDER_METADATA_CAPTURE ?? raw.captureProviderMetadata, DEFAULTS.captureProviderMetadata),
    metadataInSnippetFallback: asBool(env.ENABLE_PROVIDER_METADATA_IN_SNIPPET_FALLBACK ?? raw.metadataInSnippetFallback, DEFAULTS.metadataInSnippetFallback),
    providerEnabled,
  };
}

export async function loadSearchGatewayConfig({ query = null, env = process.env } = {}) {
  let raw = {};
  if (typeof query === "function") {
    try {
      const rows = await query("SELECT config_value FROM evidence_search_config WHERE config_key = 'search_gateway_config' LIMIT 1");
      raw = rows?.[0]?.config_value ? JSON.parse(rows[0].config_value) : {};
    } catch {
      raw = {};
    }
  }
  return normalizeSearchGatewayConfig(raw, env);
}

export async function saveSearchGatewayConfig(query, config) {
  const normalized = normalizeSearchGatewayConfig(config, {});
  await query(
    `INSERT INTO evidence_search_config (config_key, config_value, description, updated_at)
     VALUES ('search_gateway_config', ?, 'Evidence retrieval gateway provider and budget configuration', NOW())
     ON DUPLICATE KEY UPDATE config_value = VALUES(config_value), description = VALUES(description), updated_at = NOW()`,
    [JSON.stringify(normalized)],
  );
  return normalized;
}

// Academic providers work without API keys (keys/emails improve rate limits only).
const KEYLESS_PROVIDERS = new Set(["pubmed", "crossref", "openalex", "semantic_scholar"]);

export function getSearchProviderStatus(config, env = process.env) {
  const keys = {
    tavily: env.TAVILY_API_KEY,
    brave: env.BRAVE_SEARCH_API_KEY,
    serpapi: env.SERPAPI_API_KEY || env.SERPER_API_KEY,
    bing: env.BING_SEARCH_API_KEY || env.BING_SEARCH_KEY,
    pubmed: env.PUBMED_API_KEY,
    crossref: env.CROSSREF_MAILTO,
    openalex: env.OPENALEX_MAILTO || env.OPENALEX_API_KEY,
    semantic_scholar: env.SEMANTIC_SCHOLAR_API_KEY,
  };
  return Object.fromEntries(Object.keys(keys).map((provider) => {
    const keyOptional = KEYLESS_PROVIDERS.has(provider);
    const configured = Boolean(keys[provider]) || keyOptional;
    const enabled = Boolean(config.providerEnabled?.[provider]);
    return [provider, {
      provider,
      enabled,
      configured,
      keyOptional,
      status: !enabled ? "disabled" : configured ? "configured" : "missing_key",
    }];
  }));
}

export { KEYLESS_PROVIDERS };

export { DEFAULTS as DEFAULT_SEARCH_GATEWAY_CONFIG };
