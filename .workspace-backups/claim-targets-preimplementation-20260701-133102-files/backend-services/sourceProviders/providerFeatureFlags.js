export function envFlag(name, defaultValue = false) {
  const raw = process.env[name];
  if (raw == null || String(raw).trim() === "") return defaultValue;
  return /^(1|true|yes|on)$/i.test(String(raw).trim());
}

export function disabledProviderResult(providerName, message = "Provider disabled") {
  return {
    providerName,
    ok: false,
    matchFound: false,
    status: "disabled",
    errorMessage: message,
    message,
    latencyMs: 0,
  };
}

export function publisherProviderFlags() {
  return {
    openAlex: envFlag("OPENALEX_ENABLED", true),
    googleFactCheck: envFlag("GOOGLE_FACT_CHECK_ENABLED", true),
    openCorporates: envFlag("OPENCORPORATES_ENABLED", false),
    adFontes: envFlag("ADFONTES_ENABLED", false),
    allSides: envFlag("ALLSIDES_ENABLED", false),
    searchLlmFallback: envFlag("PUBLISHER_ENRICHMENT_ALLOW_SEARCH_LLM_FALLBACK", false),
  };
}
