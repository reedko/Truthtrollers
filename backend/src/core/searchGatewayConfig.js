const DEFAULTS = Object.freeze({
  enabled: true,
  mode: "single",
  provider: "tavily",
  providers: ["tavily", "brave", "serper"],
  fallbacks: ["brave", "serper", "tavily"],
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
    serper: false,
    bing: false,
  },
});

const asBool = (value, fallback) => value == null ? fallback : value === true || String(value).toLowerCase() === "true";
const asNumber = (value, fallback, min, max) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
};
const asList = (value, fallback) => {
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim().toLowerCase()).filter(Boolean);
  if (typeof value === "string") return value.split(",").map((item) => item.trim().toLowerCase()).filter(Boolean);
  return [...fallback];
};

export function normalizeSearchGatewayConfig(raw = {}, env = process.env) {
  const mode = ["single", "fallback", "ensemble"].includes(raw.mode) ? raw.mode : DEFAULTS.mode;
  const retrievalStrategy = ["cost_saver", "best_bearing_pool", "diagnostic_bakeoff"].includes(raw.retrievalStrategy)
    ? raw.retrievalStrategy
    : (env.RETRIEVAL_STRATEGY || DEFAULTS.retrievalStrategy);
  const provider = String(env.SEARCH_PROVIDER || raw.provider || DEFAULTS.provider).toLowerCase();
  const providers = asList(env.SEARCH_PROVIDERS ?? raw.providers, DEFAULTS.providers);
  const fallbacks = asList(env.SEARCH_PROVIDER_FALLBACKS ?? raw.fallbacks, DEFAULTS.fallbacks);
  const providerEnabled = {
    tavily: asBool(raw.providerEnabled?.tavily, DEFAULTS.providerEnabled.tavily),
    brave: asBool(env.ENABLE_BRAVE_SEARCH ?? raw.providerEnabled?.brave, DEFAULTS.providerEnabled.brave),
    serper: asBool(env.ENABLE_SERPER_SEARCH ?? raw.providerEnabled?.serper, DEFAULTS.providerEnabled.serper),
    bing: asBool(raw.providerEnabled?.bing, DEFAULTS.providerEnabled.bing),
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

export function getSearchProviderStatus(config, env = process.env) {
  const keys = {
    tavily: env.TAVILY_API_KEY,
    brave: env.BRAVE_SEARCH_API_KEY,
    serper: env.SERPER_API_KEY,
    bing: env.BING_SEARCH_API_KEY || env.BING_SEARCH_KEY,
  };
  return Object.fromEntries(Object.keys(keys).map((provider) => [provider, {
    provider,
    enabled: Boolean(config.providerEnabled?.[provider]),
    configured: Boolean(keys[provider]),
    status: !config.providerEnabled?.[provider] ? "disabled" : keys[provider] ? "configured" : "missing_key",
  }]));
}

export { DEFAULTS as DEFAULT_SEARCH_GATEWAY_CONFIG };
