// backend/services/sourceProviders/providers/optionalIdentityProviders.js
// Credential-gated or conditional providers. They fail silently with
// missing_config unless configured; normalized mapping still records status.

function missing(providerName, envName) {
  return {
    providerName,
    ok: false,
    matchFound: false,
    status: "missing_config",
    errorMessage: `${envName} not configured`,
    latencyMs: 0,
  };
}

function provider(providerName, description, envName, signalKind = "identity") {
  return {
    providerName,
    description,
    async healthCheck() {
      if (!process.env[envName]) {
        return { providerName, ok: false, status: "missing_config", message: `${envName} not configured`, checkedAt: new Date().toISOString() };
      }
      return { providerName, ok: true, status: "configured", message: "Credentials configured; adapter implementation pending", checkedAt: new Date().toISOString() };
    },
    async lookupPublisher({ domain, publisherName } = {}) {
      if (!process.env[envName]) return missing(providerName, envName);
      return {
        providerName,
        ok: false,
        matchFound: false,
        status: "not_implemented",
        errorMessage: `${providerName} credential is configured, but live adapter is not implemented yet`,
        normalized: { domain, publisherName, signalKind },
        latencyMs: 0,
      };
    },
    async lookupClaim() {
      return { providerName, ok: false, matchFound: false, status: "not_implemented", errorMessage: `${providerName} claim lookup not implemented`, latencyMs: 0 };
    },
    normalizeResponse(raw) { return raw; },
  };
}

export const newsGuardProvider = provider("newsguard", "NewsGuard licensed source reliability API", "NEWSGUARD_API_KEY", "direct_reliability");
export const irsTeosProvider = provider("irs_teos", "IRS TEOS nonprofit verification", "IRS_TEOS_API_KEY", "nonprofit_identity");
export const secEdgarProvider = provider("sec_edgar", "SEC EDGAR entity/issuer provenance", "SEC_EDGAR_USER_AGENT", "regulated_entity");
