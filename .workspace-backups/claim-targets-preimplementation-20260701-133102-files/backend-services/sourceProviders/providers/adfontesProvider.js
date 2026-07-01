// backend/services/sourceProviders/providers/adfontesProvider.js
// Ad Fontes Media bias/reliability ratings.
// Uses local seed data if present; optional ADFONTES_API_KEY for licensed API.

import { existsSync, readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { disabledProviderResult, publisherProviderFlags } from "../providerFeatureFlags.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SEED_PATH = path.join(__dirname, "../../../../data/seeds/adfontes.json");

let _seedData = null;
function getSeedData() {
  if (_seedData !== null) return _seedData;
  if (existsSync(SEED_PATH)) {
    try { _seedData = JSON.parse(readFileSync(SEED_PATH, "utf8")); }
    catch { _seedData = []; }
  } else {
    _seedData = [];
  }
  return _seedData;
}

function normalizeDomain(url) {
  try { return new URL(url.startsWith("http") ? url : `https://${url}`).hostname.replace(/^www\./, ""); }
  catch { return url?.toLowerCase().replace(/^www\./, ""); }
}

function seedLookup(domain, publisherName) {
  const seed = getSeedData();
  if (!seed.length) return null;
  const domKey = domain?.toLowerCase();
  const nameKey = publisherName?.toLowerCase();
  return seed.find(e =>
    (domKey && e.domain?.toLowerCase() === domKey) ||
    (nameKey && e.name?.toLowerCase() === nameKey) ||
    (nameKey && e.source?.toLowerCase() === nameKey)
  ) ?? null;
}

// Ad Fontes quality score (0-64) → VeraStrata reliability label
function scoreToReliability(score) {
  if (score == null) return null;
  if (score >= 48) return "high";
  if (score >= 32) return "medium";
  if (score >= 16) return "mixed";
  return "low";
}

export const adfontesProvider = {
  providerName: "adfontes",
  description: "Ad Fontes Media bias/reliability ratings (seed data + optional API)",

  async healthCheck() {
    if (!publisherProviderFlags().adFontes) return { ...disabledProviderResult("adfontes", "Ad Fontes disabled by ADFONTES_ENABLED"), checkedAt: new Date().toISOString() };
    const t0 = Date.now();
    const seed = getSeedData();
    if (seed.length > 0) {
      return { providerName: "adfontes", ok: true, status: "ok", message: `Local seed data: ${seed.length} entries`, latencyMs: Date.now() - t0, checkedAt: new Date().toISOString() };
    }
    if (process.env.ADFONTES_API_KEY) {
      return { providerName: "adfontes", ok: true, status: "ok", message: "API key configured (no seed data)", latencyMs: Date.now() - t0, checkedAt: new Date().toISOString() };
    }
    return { providerName: "adfontes", ok: false, status: "missing_config", message: `No seed data at ${SEED_PATH} and no ADFONTES_API_KEY`, latencyMs: Date.now() - t0, checkedAt: new Date().toISOString(), details: { seedPath: SEED_PATH } };
  },

  async lookupPublisher({ domain, publisherName, sourceUrl } = {}) {
    if (!publisherProviderFlags().adFontes) return disabledProviderResult("adfontes", "Ad Fontes disabled by ADFONTES_ENABLED");
    const t0 = Date.now();
    const dom = normalizeDomain(domain || sourceUrl || "");
    const entry = seedLookup(dom, publisherName);
    if (!entry) return { providerName: "adfontes", ok: true, matchFound: false, status: "no_match", latencyMs: Date.now() - t0 };

    const quality = entry.quality ?? entry.reliability_score ?? null;
    const bias    = entry.bias ?? entry.bias_score ?? null;

    return {
      providerName: "adfontes",
      ok: true,
      matchFound: true,
      confidence: "medium",
      normalized: {
        publisherName: entry.name ?? entry.source ?? null,
        domain: entry.domain ?? dom,
        bias:   bias,
        reliability: scoreToReliability(quality),
        reliabilityScore: quality,
        sourceType: null,
        description: null,
        externalUrl: `https://www.adfontesmedia.com/`,
        externalId: `adfontes:${entry.id ?? entry.name ?? entry.source}`,
      },
      raw: entry,
      status: "ok",
      latencyMs: Date.now() - t0,
    };
  },

  async lookupClaim() {
    if (!publisherProviderFlags().adFontes) return disabledProviderResult("adfontes", "Ad Fontes disabled by ADFONTES_ENABLED");
    return { providerName: "adfontes", ok: false, matchFound: false, status: "not_implemented", errorMessage: "Ad Fontes does not provide claim lookups", latencyMs: 0 };
  },

  normalizeResponse(raw) { return raw; },
};
