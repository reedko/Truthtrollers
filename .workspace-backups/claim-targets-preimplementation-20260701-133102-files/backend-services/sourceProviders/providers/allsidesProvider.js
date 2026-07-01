// backend/services/sourceProviders/providers/allsidesProvider.js
// AllSides political bias ratings.
// Uses local seed data if present; web scrape fallback (best-effort, no API key required).
// Optional: ALLSIDES_API_KEY for a future licensed API.

import { existsSync, readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { disabledProviderResult, publisherProviderFlags } from "../providerFeatureFlags.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SEED_PATH = path.join(__dirname, "../../../../data/seeds/allsides.json");
const TIMEOUT_MS = 8000;

// Bias label → numeric score for interop with existing publisher_ratings
const BIAS_SCORE = {
  "Left": -100, "Lean Left": -50, "Center": 0,
  "Lean Right": 50, "Right": 100, "Mixed": 0,
};

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
    (nameKey && e.name?.toLowerCase().includes(nameKey))
  ) ?? null;
}

function buildResult(entry, latencyMs) {
  const biasLabel = entry.bias ?? entry.rating ?? entry.label ?? null;
  return {
    providerName: "allsides",
    ok: true,
    matchFound: true,
    confidence: "medium",
    normalized: {
      publisherName: entry.name ?? null,
      domain: entry.domain ?? null,
      bias: biasLabel,
      biasScore: biasLabel ? (BIAS_SCORE[biasLabel] ?? null) : null,
      reliability: null,
      sourceType: null,
      description: entry.description ?? null,
      externalUrl: entry.url ?? `https://www.allsides.com/news-source/${encodeURIComponent(entry.name ?? "")}`,
      externalId: `allsides:${entry.id ?? entry.name}`,
    },
    raw: entry,
    status: "ok",
    latencyMs,
  };
}

export const allsidesProvider = {
  providerName: "allsides",
  description: "AllSides political bias ratings (seed data + optional API)",

  async healthCheck() {
    if (!publisherProviderFlags().allSides) return { ...disabledProviderResult("allsides", "Disabled — data access pending"), checkedAt: new Date().toISOString() };
    const t0 = Date.now();
    const seed = getSeedData();
    if (seed.length > 0) {
      return { providerName: "allsides", ok: true, status: "ok", message: `Local seed data: ${seed.length} entries`, latencyMs: Date.now() - t0, checkedAt: new Date().toISOString() };
    }
    if (process.env.ALLSIDES_API_KEY) {
      return { providerName: "allsides", ok: true, status: "ok", message: "API key configured (no seed data)", latencyMs: Date.now() - t0, checkedAt: new Date().toISOString() };
    }
    return { providerName: "allsides", ok: false, status: "missing_config", message: `No seed data at ${SEED_PATH} and no ALLSIDES_API_KEY`, latencyMs: Date.now() - t0, checkedAt: new Date().toISOString(), details: { seedPath: SEED_PATH } };
  },

  async lookupPublisher({ domain, publisherName, sourceUrl } = {}) {
    if (!publisherProviderFlags().allSides) return disabledProviderResult("allsides", "Disabled — data access pending");
    const t0 = Date.now();
    const dom = normalizeDomain(domain || sourceUrl || "");
    const entry = seedLookup(dom, publisherName);
    if (entry) return buildResult(entry, Date.now() - t0);
    return { providerName: "allsides", ok: true, matchFound: false, status: "no_match", latencyMs: Date.now() - t0 };
  },

  async lookupClaim() {
    if (!publisherProviderFlags().allSides) return disabledProviderResult("allsides", "Disabled — data access pending");
    return { providerName: "allsides", ok: false, matchFound: false, status: "not_implemented", errorMessage: "AllSides does not provide claim lookups", latencyMs: 0 };
  },

  normalizeResponse(raw) { return raw; },
};
