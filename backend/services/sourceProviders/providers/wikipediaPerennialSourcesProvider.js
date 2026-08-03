import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { disabledProviderResult, publisherProviderFlags } from "../providerFeatureFlags.js";

const PROVIDER_NAME = "wikipedia_perennial_sources";
const DATASET_FILE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../data/wikipedia-perennial-sources.rev-1366002299.json",
);

function loadDataset() {
  try {
    return JSON.parse(fs.readFileSync(DATASET_FILE, "utf8"));
  } catch (error) {
    return { loadError: error instanceof Error ? error.message : String(error), entries: [] };
  }
}

export function normalizePerennialName(value) {
  return String(value || "")
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/&/gu, " and ")
    .replace(/[’']/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

export function normalizePerennialDomain(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    return new URL(/^https?:\/\//iu.test(raw) ? raw : `https://${raw}`).hostname
      .toLocaleLowerCase("en-US").replace(/^(?:www\.|m\.)/u, "").replace(/\.$/u, "");
  } catch {
    return raw.toLocaleLowerCase("en-US").replace(/^(?:www\.|m\.)/u, "").replace(/\.$/u, "");
  }
}

function datasetVersion(dataset) {
  return `${dataset.parserVersion || "unknown"}:rev-${dataset.revisionId || "unknown"}:${dataset.entriesSha256 || "unhashed"}`;
}

function confidenceForMethod(method) {
  if (method === "name_and_domain_exact") return { label: "high", value: 0.99 };
  if (method === "domain_exact") return { label: "high", value: 0.97 };
  if (method === "name_exact") return { label: "high", value: 0.95 };
  return { label: "medium", value: 0.9 };
}

function indexedDataset(dataset) {
  if (!dataset || dataset.loadError || !Array.isArray(dataset.entries)) {
    throw new Error(dataset?.loadError || "Perennial Sources dataset is invalid");
  }
  const names = new Map();
  const domains = new Map();
  for (const entry of dataset.entries) {
    for (const alias of [entry.name, ...(entry.aliases || [])]) {
      const key = normalizePerennialName(alias);
      if (!key) continue;
      const bucket = names.get(key) || [];
      if (!bucket.includes(entry)) bucket.push(entry);
      names.set(key, bucket);
    }
    for (const value of entry.domains || []) {
      const key = normalizePerennialDomain(value);
      if (!key) continue;
      const bucket = domains.get(key) || [];
      if (!bucket.includes(entry)) bucket.push(entry);
      domains.set(key, bucket);
    }
  }
  return { names, domains };
}

function uniqueEntries(values) {
  return [...new Map(values.map((entry) => [entry.entryId, entry])).values()];
}

function resolveMatch(index, { publisherName, publicationName, aliases = [], domain, sourceUrl } = {}) {
  const queriedNames = [publicationName, publisherName, ...(Array.isArray(aliases) ? aliases : [])]
    .map(normalizePerennialName).filter(Boolean);
  const queriedDomain = normalizePerennialDomain(domain || sourceUrl);
  const nameMatches = uniqueEntries(queriedNames.flatMap((value) => index.names.get(value) || []));
  const domainMatches = queriedDomain ? uniqueEntries(index.domains.get(queriedDomain) || []) : [];
  const intersection = nameMatches.filter((entry) => domainMatches.some((candidate) => candidate.entryId === entry.entryId));

  if (intersection.length === 1) return { entry: intersection[0], method: "name_and_domain_exact", queriedNames, queriedDomain, nameMatches, domainMatches };
  if (nameMatches.length === 1 && domainMatches.length === 0) {
    const primaryName = normalizePerennialName(publicationName || publisherName);
    const method = primaryName && [nameMatches[0].name, ...(nameMatches[0].aliases || [])].map(normalizePerennialName).includes(primaryName)
      ? "name_exact" : "alias_exact";
    return { entry: nameMatches[0], method, queriedNames, queriedDomain, nameMatches, domainMatches };
  }
  if (domainMatches.length === 1 && nameMatches.length === 0) return { entry: domainMatches[0], method: "domain_exact", queriedNames, queriedDomain, nameMatches, domainMatches };
  if (nameMatches.length === 1 && domainMatches.length === 1 && nameMatches[0].entryId === domainMatches[0].entryId) {
    return { entry: nameMatches[0], method: "name_and_domain_exact", queriedNames, queriedDomain, nameMatches, domainMatches };
  }
  return { entry: null, method: null, queriedNames, queriedDomain, nameMatches, domainMatches };
}

export function createWikipediaPerennialSourcesProvider(dataset = loadDataset()) {
  const version = datasetVersion(dataset);
  const metadata = Object.freeze({
    sourceUrl: dataset.sourceUrl || null,
    revisionId: dataset.revisionId || null,
    revisionTimestamp: dataset.revisionTimestamp || null,
    revisionSha1: dataset.revisionSha1 || null,
    parserVersion: dataset.parserVersion || null,
    rawHtmlSha256: dataset.rawHtmlSha256 || null,
    entriesSha256: dataset.entriesSha256 || null,
    entryCount: dataset.entryCount || 0,
  });
  let index = null;
  function getIndex() {
    if (!index) index = indexedDataset(dataset);
    return index;
  }

  return {
    providerName: PROVIDER_NAME,
    description: "Revision-pinned Wikipedia Reliable Sources / Perennial Sources classification",
    datasetVersion: version,
    datasetMetadata: metadata,

    cacheKey(args = {}) {
      const domainKey = normalizePerennialDomain(args.domain || args.sourceUrl);
      const nameKey = normalizePerennialName(args.publicationName || args.publisherName || args.aliases?.[0]);
      return `${version}:${domainKey ? `domain:${domainKey}` : `name:${nameKey}`}`;
    },

    async healthCheck() {
      if (!publisherProviderFlags().wikipediaPerennialSources) {
        return { ...disabledProviderResult(PROVIDER_NAME, "Wikipedia Perennial Sources disabled by WIKIPEDIA_PERENNIAL_SOURCES_ENABLED"), datasetVersion: version };
      }
      try {
        getIndex();
        return { providerName: PROVIDER_NAME, ok: true, status: "ok", message: `${dataset.entryCount} pinned Perennial Sources entries loaded`, datasetVersion: version, checkedAt: new Date().toISOString(), latencyMs: 0 };
      } catch (error) {
        return { providerName: PROVIDER_NAME, ok: false, status: "error", message: error.message, errorMessage: error.message, datasetVersion: version, checkedAt: new Date().toISOString(), latencyMs: 0 };
      }
    },

    async lookupPublisher(args = {}) {
      const attemptedAt = new Date().toISOString();
      if (!publisherProviderFlags().wikipediaPerennialSources) {
        return { ...disabledProviderResult(PROVIDER_NAME, "Wikipedia Perennial Sources disabled by WIKIPEDIA_PERENNIAL_SOURCES_ENABLED"), datasetVersion: version, attemptedAt, cached: false };
      }
      try {
        const match = resolveMatch(getIndex(), args);
        const queriedIdentity = {
          publicationName: args.publicationName || null,
          publisherName: args.publisherName || null,
          aliasesTried: Array.isArray(args.aliases) ? [...args.aliases] : [],
          domainTried: match.queriedDomain || null,
          parentPublisher: args.parentPublisherName || null,
        };
        if (!match.entry) {
          const ambiguousEntries = uniqueEntries([...match.nameMatches, ...match.domainMatches]);
          if (ambiguousEntries.length > 1 || (match.nameMatches.length && match.domainMatches.length)) {
            return {
              providerName: PROVIDER_NAME, ok: false, matchFound: false, status: "ambiguous", datasetVersion: version,
              queriedIdentity, attemptedAt, cached: false,
              diagnostics: { reason: "exact_identity_candidates_conflict_or_are_ambiguous", candidates: ambiguousEntries.map((entry) => ({ entryId: entry.entryId, name: entry.name, classification: entry.classification })) },
            };
          }
          return {
            providerName: PROVIDER_NAME, ok: true, matchFound: false, status: "no_match", datasetVersion: version,
            queriedIdentity, attemptedAt, cached: false,
            diagnostics: { reason: "no_exact_name_alias_or_domain_match", parentPublisherNotInferred: Boolean(args.parentPublisherName) },
          };
        }

        const confidence = confidenceForMethod(match.method);
        const entry = match.entry;
        return {
          providerName: PROVIDER_NAME,
          ok: true,
          matchFound: true,
          status: "matched",
          confidence: confidence.label,
          matchConfidence: confidence.value,
          datasetVersion: version,
          attemptedAt,
          cached: false,
          queriedIdentity,
          matchedEntity: entry.name,
          matchMethod: match.method,
          rawClassification: entry.rawClassification,
          normalized: {
            publisherName: entry.name,
            domain: match.queriedDomain || entry.domains?.[0] || null,
            classification: entry.classification,
            rawClassification: entry.rawClassification,
            scopeAndSummary: entry.scopeAndSummary,
            externalUrl: entry.evidenceUrl,
            entryId: entry.entryId,
            aliases: entry.aliases || [],
            domains: entry.domains || [],
            discussionUrls: entry.discussionUrls || [],
            useUrls: entry.useUrls || [],
            datasetVersion: version,
            datasetRevisionId: dataset.revisionId,
            datasetHash: dataset.entriesSha256,
          },
          diagnostics: {
            aliasesTried: match.queriedNames,
            domainTried: match.queriedDomain || null,
            parentPublisherNotInferred: Boolean(args.parentPublisherName),
          },
          raw: { entry, dataset: metadata, status: "matched" },
        };
      } catch (error) {
        return {
          providerName: PROVIDER_NAME, ok: false, matchFound: false, status: "error",
          errorMessage: error instanceof Error ? error.message : String(error), datasetVersion: version,
          attemptedAt, cached: false,
        };
      }
    },

    async lookupClaim() {
      return { providerName: PROVIDER_NAME, ok: false, matchFound: false, status: "not_implemented", errorMessage: "Perennial Sources classifies outlets, not claims", datasetVersion: version, latencyMs: 0 };
    },

    normalizeResponse(raw) { return raw; },
  };
}

export const wikipediaPerennialSourcesProvider = createWikipediaPerennialSourcesProvider();
export const WIKIPEDIA_PERENNIAL_DATASET_VERSION = wikipediaPerennialSourcesProvider.datasetVersion;
export const WIKIPEDIA_PERENNIAL_DATASET_METADATA = wikipediaPerennialSourcesProvider.datasetMetadata;
