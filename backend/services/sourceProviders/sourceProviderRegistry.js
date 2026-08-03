// backend/services/sourceProviders/sourceProviderRegistry.js
//
// Central registry for all external source-data providers.
// Manages: which providers are enabled, caching, dispatch, and diagnostics.
//
// Every provider must export:
//   healthCheck()
//   lookupPublisher({ domain, publisherName, sourceUrl })
//   lookupClaim({ claimText, sourceUrl, publisherName })
//   normalizeResponse(raw)

import { wikipediaProvider }      from "./providers/wikipediaProvider.js";
import { wikipediaPerennialSourcesProvider } from "./providers/wikipediaPerennialSourcesProvider.js";
import { wikidataProvider }       from "./providers/wikidataProvider.js";
import { googleFactCheckProvider }from "./providers/googleFactCheckProvider.js";
import { allsidesProvider }       from "./providers/allsidesProvider.js";
import { adfontesProvider }       from "./providers/adfontesProvider.js";
import { mbfcProvider }           from "./providers/mbfcProvider.js";
import { openSourcesProvider }    from "./providers/openSourcesProvider.js";
import { diffbotProvider }        from "./providers/diffbotProvider.js";
import { waybackProvider }        from "./providers/waybackProvider.js";
import { rdapProvider }           from "./providers/rdapProvider.js";
import { crossrefProvider }       from "./providers/crossrefProvider.js";
import { openAlexProvider }       from "./providers/openAlexProvider.js";
import { gdeltProvider }          from "./providers/gdeltProvider.js";
import { openCorporatesProvider } from "./providers/openCorporatesProvider.js";
import {
  newsGuardProvider,
  irsTeosProvider,
  secEdgarProvider,
} from "./providers/optionalIdentityProviders.js";

// ── Provider list (ordered by priority) ──────────────────────────────────────

const ALL_PROVIDERS = [
  wikipediaProvider,
  wikipediaPerennialSourcesProvider,
  wikidataProvider,
  googleFactCheckProvider,
  allsidesProvider,
  adfontesProvider,
  mbfcProvider,
  openSourcesProvider,
  newsGuardProvider,
  crossrefProvider,
  openAlexProvider,
  diffbotProvider,
  waybackProvider,
  rdapProvider,
  openCorporatesProvider,
  irsTeosProvider,
  secEdgarProvider,
  gdeltProvider,
];

// ── In-memory cache ───────────────────────────────────────────────────────────

const CACHE_TTL_OK_MS   = 60 * 60 * 1000;   // 1 hour for hits
const CACHE_TTL_MISS_MS = 10 * 60 * 1000;   // 10 min for no-match
const CACHE_TTL_ERR_MS  =  2 * 60 * 1000;   // 2 min for errors

const _publisherCache = new Map();
const _claimCache     = new Map();
const _healthCache    = new Map();

function cacheKey(providerName, args) {
  return `${providerName}:${JSON.stringify(args)}`;
}

function publisherCacheKey(provider, args) {
  if (typeof provider.cacheKey === "function") {
    return `${provider.providerName}:${provider.cacheKey(args)}`;
  }
  return cacheKey(provider.providerName, args);
}

function getCached(cache, key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) { cache.delete(key); return null; }
  return entry.value;
}

function setCache(cache, key, value) {
  let ttl = CACHE_TTL_OK_MS;
  if (!value.ok && value.status === "no_match") ttl = CACHE_TTL_MISS_MS;
  else if (!value.ok)                            ttl = CACHE_TTL_ERR_MS;
  cache.set(key, { value, expiresAt: Date.now() + ttl });
}

// ── Dispatch helpers ──────────────────────────────────────────────────────────

async function dispatchSafe(provider, method, args) {
  const t0 = Date.now();
  try {
    const result = await provider[method](args);
    result.latencyMs = Date.now() - t0;
    return result;
  } catch (err) {
    return {
      providerName: provider.providerName,
      ok: false,
      status: "error",
      errorMessage: err.message,
      latencyMs: Date.now() - t0,
    };
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Run healthCheck on all providers.
 * Returns array of health results.
 */
export async function checkAllProviders() {
  const results = await Promise.all(
    ALL_PROVIDERS.map(async (p) => {
      const key = `health:${p.providerName}`;
      const cached = getCached(_healthCache, key);
      if (cached) return cached;
      const result = await dispatchSafe(p, "healthCheck", {});
      setCache(_healthCache, key, result);
      return result;
    })
  );
  return results;
}

/**
 * Run publisher lookup across all (or a subset of) providers.
 * Returns array of individual provider results.
 */
export async function lookupPublisherAllProviders(args = {}, { providers } = {}) {
  const { domain, publisherName, sourceUrl } = args;
  const list = providers
    ? ALL_PROVIDERS.filter(p => providers.includes(p.providerName))
    : ALL_PROVIDERS;

  const providerArgs = { ...args, domain, publisherName, sourceUrl };
  const results = await Promise.all(
    list.map(async (p) => {
      if (typeof p.lookupPublisher !== "function") return notImplemented(p.providerName, "publisher");
      const key = publisherCacheKey(p, providerArgs);
      const cached = getCached(_publisherCache, key);
      if (cached) return { ...cached, cached: true };
      const result = await dispatchSafe(p, "lookupPublisher", providerArgs);
      setCache(_publisherCache, key, result);
      return result;
    })
  );
  return results;
}

/**
 * Remove publisher lookup entries for one identity from the process cache.
 * Force-refresh callers use this after publishing identity changes so an old
 * outlet lookup cannot be reused for the newly rated content supplier.
 */
export function invalidatePublisherProviderCache(args = {}, { providers } = {}) {
  const list = providers
    ? ALL_PROVIDERS.filter((provider) => providers.includes(provider.providerName))
    : ALL_PROVIDERS;
  if (!Object.keys(args).length) {
    const deleted = _publisherCache.size;
    _publisherCache.clear();
    return deleted;
  }
  const providerArgs = {
    ...args,
    domain: args.domain,
    publisherName: args.publisherName,
    sourceUrl: args.sourceUrl,
  };
  let deleted = 0;
  for (const provider of list) {
    const key = publisherCacheKey(provider, providerArgs);
    if (_publisherCache.delete(key)) deleted += 1;
  }
  return deleted;
}

/**
 * Run claim lookup across all providers that support it.
 * Returns array of individual provider results.
 */
export async function lookupClaimAllProviders({ claimText, sourceUrl, publisherName } = {}) {
  const args = { claimText, sourceUrl, publisherName };
  const results = await Promise.all(
    ALL_PROVIDERS.map(async (p) => {
      if (typeof p.lookupClaim !== "function") return notImplemented(p.providerName, "claim");
      const key = cacheKey(p.providerName, args);
      const cached = getCached(_claimCache, key);
      if (cached) return { ...cached, cached: true };
      const result = await dispatchSafe(p, "lookupClaim", args);
      setCache(_claimCache, key, result);
      return result;
    })
  );
  return results;
}

/**
 * Convenience: look up publisher from a single named provider.
 */
export async function lookupPublisherFromProvider(providerName, args) {
  const p = ALL_PROVIDERS.find(x => x.providerName === providerName);
  if (!p) return { providerName, ok: false, status: "error", errorMessage: "Unknown provider" };
  return dispatchSafe(p, "lookupPublisher", args);
}

/**
 * Returns all provider names.
 */
export function listProviders() {
  return ALL_PROVIDERS.map(p => ({ name: p.providerName, description: p.description ?? "" }));
}

// ── Internal ──────────────────────────────────────────────────────────────────

function notImplemented(providerName, type) {
  return {
    providerName,
    ok: false,
    matchFound: false,
    status: "not_implemented",
    errorMessage: `${type} lookup not implemented for ${providerName}`,
    latencyMs: 0,
  };
}
