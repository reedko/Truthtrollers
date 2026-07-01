// backend/services/sourceProviders/providers/openSourcesProvider.js
// OpenSources — categorized list of problematic news sources.
// Seed file: backend/data/seeds/opensources.json
// Expected shape: { "domain.com": { "types": ["conspiracy", "satire", ...], "source_notes": "..." } }

import { existsSync, readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SEED_PATH = path.join(__dirname, "../../../../data/seeds/opensources.json");

let _seedData = null;
function getSeedData() {
  if (_seedData !== null) return _seedData;
  if (existsSync(SEED_PATH)) {
    try { _seedData = JSON.parse(readFileSync(SEED_PATH, "utf8")); }
    catch { _seedData = {}; }
  } else {
    _seedData = {};
  }
  return _seedData;
}

function normalizeDomain(url) {
  try { return new URL(url.startsWith("http") ? url : `https://${url}`).hostname.replace(/^www\./, ""); }
  catch { return url?.toLowerCase().replace(/^www\./, ""); }
}

// OpenSources categories → VeraStrata reliability label
const DANGEROUS_TYPES = new Set([
  "fake","conspiracy","propaganda","hate","junk science",
  "disinformation","bias","clickbait","credible","unreliable",
  "misleading","satire",
]);

function typesToReliability(types = []) {
  const set = types.map(t => t.toLowerCase());
  if (set.some(t => ["fake","conspiracy","propaganda","disinformation"].includes(t))) return "low";
  if (set.some(t => ["misleading","bias","junk science","clickbait"].includes(t))) return "mixed";
  if (set.some(t => ["satire","unreliable","hate"].includes(t))) return "low";
  return null;
}

export const openSourcesProvider = {
  providerName: "opensources",
  description: "OpenSources — categorized problematic source list",

  async healthCheck() {
    const t0 = Date.now();
    const seed = getSeedData();
    const count = Object.keys(seed).length;
    if (count > 0) {
      return { providerName: "opensources", ok: true, status: "ok", message: `Local seed: ${count} domains`, latencyMs: Date.now() - t0, checkedAt: new Date().toISOString() };
    }
    return { providerName: "opensources", ok: false, status: "missing_config", message: `No OpenSources seed at ${SEED_PATH}`, latencyMs: Date.now() - t0, checkedAt: new Date().toISOString(), details: { seedPath: SEED_PATH } };
  },

  async lookupPublisher({ domain, publisherName, sourceUrl } = {}) {
    const t0 = Date.now();
    const seed = getSeedData();
    const dom  = normalizeDomain(domain || sourceUrl || "");
    const entry = dom ? (seed[dom] ?? seed[`www.${dom}`]) : null;

    if (!entry) {
      // No hit = not in the problematic list (positive signal — source not flagged)
      return { providerName: "opensources", ok: true, matchFound: false, status: "no_match", notFlagged: true, latencyMs: Date.now() - t0 };
    }

    const types = entry.types ?? [];
    return {
      providerName: "opensources",
      ok: true,
      matchFound: true,
      confidence: "medium",
      normalized: {
        publisherName: publisherName ?? dom,
        domain: dom,
        bias: null,
        reliability: typesToReliability(types),
        flaggedTypes: types,
        description: entry.source_notes ?? null,
        sourceType: null,
        externalUrl: null,
        externalId: `opensources:${dom}`,
      },
      raw: entry,
      status: "ok",
      latencyMs: Date.now() - t0,
    };
  },

  async lookupClaim() {
    return { providerName: "opensources", ok: false, matchFound: false, status: "not_implemented", errorMessage: "OpenSources does not provide claim lookups", latencyMs: 0 };
  },

  normalizeResponse(raw) { return raw; },
};
