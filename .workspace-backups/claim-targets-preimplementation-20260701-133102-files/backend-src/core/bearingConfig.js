import logger from "../utils/logger.js";

export const DEFAULT_BEARING_GATING_CONFIG = Object.freeze({
  version: 1,
  enableBearingGating: false,
  enableBearingPacket: false,
  enableBearingPacketLive: false,
  minBearingForPacket: 0.35,
  maxEvidencePacketItems: 5,
  minBearingToScrape: 0.35,
  forceSkipBelowBearing: 0.15,
  deterministicForceSkipBelow: 0.10,
  maxClaimsSearchedPerContent: 12,
  globalScrapeLimitPerContent: 16,
  deepenGlobalScrapeLimit: 24,
  maxSnippetCandidatesPerClaim: 12,
  maxOriginSlotsPerClaim: 1,
  maxSteelmanSlotsPerClaim: 1,
  perClaimLimits: Object.freeze({
    thesis: 4,
    pillar: 3,
    pillar_support: 3,
    evidence: 3,
    attribution: 2,
    background: 0,
    default: 3,
  }),
});

function clampNumber(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return Math.max(min, Math.min(max, fallback));
  return Math.max(min, Math.min(max, parsed));
}

function clampInteger(value, fallback, min, max) {
  return Math.round(clampNumber(value, fallback, min, max));
}

function parseJson(value) {
  if (!value) return {};
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

export function normalizeBearingGatingConfig(raw = {}, env = process.env) {
  const defaults = DEFAULT_BEARING_GATING_CONFIG;
  let enableBearingGating = raw.enableBearingGating === true;
  if (env.ENABLE_BEARING_GATING === "true") enableBearingGating = true;
  if (env.ENABLE_BEARING_GATING === "false") enableBearingGating = false;
  let enableBearingPacket = raw.enableBearingPacket === true;
  if (env.ENABLE_BEARING_PACKET === "true") enableBearingPacket = true;
  if (env.ENABLE_BEARING_PACKET === "false") enableBearingPacket = false;
  let enableBearingPacketLive = raw.enableBearingPacketLive === true;
  if (env.ENABLE_BEARING_PACKET_LIVE === "true") enableBearingPacketLive = true;
  if (env.ENABLE_BEARING_PACKET_LIVE === "false") enableBearingPacketLive = false;
  // Live packet adjudication is never allowed to bypass its two prerequisites.
  enableBearingPacketLive = enableBearingPacketLive && enableBearingPacket && enableBearingGating;

  const perClaimLimits = {};
  for (const [role, fallback] of Object.entries(defaults.perClaimLimits)) {
    perClaimLimits[role] = clampInteger(raw?.perClaimLimits?.[role], fallback, 0, 8);
  }
  const minBearingToScrape = clampNumber(raw.minBearingToScrape, defaults.minBearingToScrape, 0, 1);

  return {
    version: 1,
    enableBearingGating,
    enableBearingPacket,
    enableBearingPacketLive,
    minBearingForPacket: clampNumber(raw.minBearingForPacket, defaults.minBearingForPacket, 0, 1),
    maxEvidencePacketItems: clampInteger(raw.maxEvidencePacketItems, defaults.maxEvidencePacketItems, 3, 5),
    minBearingToScrape,
    forceSkipBelowBearing: clampNumber(raw.forceSkipBelowBearing, defaults.forceSkipBelowBearing, 0, minBearingToScrape),
    deterministicForceSkipBelow: clampNumber(raw.deterministicForceSkipBelow, defaults.deterministicForceSkipBelow, 0, minBearingToScrape),
    maxClaimsSearchedPerContent: clampInteger(raw.maxClaimsSearchedPerContent, defaults.maxClaimsSearchedPerContent, 1, 20),
    globalScrapeLimitPerContent: clampInteger(raw.globalScrapeLimitPerContent, defaults.globalScrapeLimitPerContent, 1, 100),
    deepenGlobalScrapeLimit: clampInteger(raw.deepenGlobalScrapeLimit, defaults.deepenGlobalScrapeLimit, 1, 100),
    maxSnippetCandidatesPerClaim: clampInteger(raw.maxSnippetCandidatesPerClaim, defaults.maxSnippetCandidatesPerClaim, 1, 20),
    maxOriginSlotsPerClaim: clampInteger(raw.maxOriginSlotsPerClaim, defaults.maxOriginSlotsPerClaim, 0, 2),
    maxSteelmanSlotsPerClaim: clampInteger(raw.maxSteelmanSlotsPerClaim, defaults.maxSteelmanSlotsPerClaim, 0, 2),
    perClaimLimits,
  };
}

export async function loadBearingGatingConfig({ query = null, env = process.env } = {}) {
  let raw = {};
  if (typeof query === "function") {
    try {
      const rows = await query(
        `SELECT config_value FROM evidence_search_config WHERE config_key = 'bearing_config' LIMIT 1`,
      );
      raw = parseJson(rows?.[0]?.config_value);
    } catch (error) {
      logger.warn(`[BearingConfig] Could not load bearing_config; using safe defaults: ${error.message}`);
    }
  }
  return normalizeBearingGatingConfig(raw, env);
}

export function getPerClaimBearingLimit(claim, config = DEFAULT_BEARING_GATING_CONFIG) {
  if (claim?.evidenceNeed?.claimType === "attribution" || claim?.isAttribution) {
    return config.perClaimLimits.attribution;
  }
  const role = String(claim?.role || claim?.argumentFunction || "default").toLowerCase();
  return config.perClaimLimits[role] ?? config.perClaimLimits.default;
}
