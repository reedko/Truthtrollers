// backend/services/sourceProviders/providers/mbfcProvider.js
// Media Bias / Fact Check — local seed data lookup.
// Seed file: backend/data/seeds/mbfc.json
// Expected shape: [{ domain, name, bias, factual_reporting, credibility, url }]

import { existsSync, readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SEED_PATH = path.join(__dirname, "../../../../data/seeds/mbfc.json");

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
    (domKey && normalizeDomain(e.url ?? e.domain ?? "")  === domKey) ||
    (domKey && e.domain?.toLowerCase() === domKey) ||
    (nameKey && e.name?.toLowerCase() === nameKey) ||
    (nameKey && e.name?.toLowerCase().includes(nameKey))
  ) ?? null;
}

// MBFC factual_reporting → reliability label
function factualToReliability(label = "") {
  const l = label.toLowerCase();
  if (l.includes("very high"))    return "high";
  if (l.includes("high"))         return "high";
  if (l.includes("mostly"))       return "medium";
  if (l.includes("mixed"))        return "mixed";
  if (l.includes("low"))          return "low";
  if (l.includes("very low"))     return "low";
  return null;
}

export const mbfcProvider = {
  providerName: "mbfc",
  description: "Media Bias / Fact Check — local seed data",

  async healthCheck() {
    const t0 = Date.now();
    const seed = getSeedData();
    if (seed.length > 0) {
      return { providerName: "mbfc", ok: true, status: "ok", message: `Local seed: ${seed.length} entries`, latencyMs: Date.now() - t0, checkedAt: new Date().toISOString() };
    }
    return { providerName: "mbfc", ok: false, status: "missing_config", message: `No MBFC seed data at ${SEED_PATH}`, latencyMs: Date.now() - t0, checkedAt: new Date().toISOString(), details: { seedPath: SEED_PATH } };
  },

  async lookupPublisher({ domain, publisherName, sourceUrl } = {}) {
    const t0 = Date.now();
    const dom = normalizeDomain(domain || sourceUrl || "");
    const entry = seedLookup(dom, publisherName);
    if (!entry) return { providerName: "mbfc", ok: true, matchFound: false, status: "no_match", latencyMs: Date.now() - t0 };

    return {
      providerName: "mbfc",
      ok: true,
      matchFound: true,
      confidence: "medium",
      normalized: {
        publisherName: entry.name ?? null,
        domain: entry.domain ?? dom,
        bias: entry.bias ?? null,
        reliability: factualToReliability(entry.factual_reporting ?? ""),
        credibility: entry.credibility ?? null,
        sourceType: null,
        description: null,
        externalUrl: entry.url ?? null,
        externalId: `mbfc:${entry.name}`,
      },
      raw: entry,
      status: "ok",
      latencyMs: Date.now() - t0,
    };
  },

  async lookupClaim() {
    return { providerName: "mbfc", ok: false, matchFound: false, status: "not_implemented", errorMessage: "MBFC does not provide claim lookups", latencyMs: 0 };
  },

  normalizeResponse(raw) { return raw; },
};
