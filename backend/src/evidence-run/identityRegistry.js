import { er1IdentityTaskId } from "./ids.js";

const TRACKING = /^(utm_.+|fbclid|gclid|mc_cid|mc_eid)$/i;
const unique = (values) => [...new Set((values || []).map(String).map((x) => x.trim()).filter(Boolean))];

export function normalizeDoi(value) {
  return String(value || "").trim().replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "")
    .replace(/^doi:\s*/i, "").toLowerCase();
}

export function normalizePmid(value) {
  const match = String(value || "").match(/\b(\d{4,12})\b/);
  return match?.[1] || null;
}

export function normalizeUrl(value) {
  try {
    const url = new URL(String(value).trim());
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) if (TRACKING.test(key)) url.searchParams.delete(key);
    url.searchParams.sort();
    url.hostname = url.hostname.toLowerCase();
    if ((url.protocol === "https:" && url.port === "443") || (url.protocol === "http:" && url.port === "80")) url.port = "";
    if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, "");
    return url.toString();
  } catch {
    return null;
  }
}

function normalizedIdentifiers(identifiers = {}) {
  return {
    doi: unique(identifiers.doi).map(normalizeDoi).filter(Boolean),
    pmid: unique(identifiers.pmid).map(normalizePmid).filter(Boolean),
    canonicalUrls: unique(identifiers.canonicalUrls).map(normalizeUrl).filter(Boolean),
    other: unique(identifiers.other),
  };
}

export function buildIdentityRegistry(packageValue) {
  const contextById = new Map((packageValue.articleMap?.contextWorks || []).map((work) =>
    [work.namedWorkId, work]));
  const entries = (packageValue.sourceIdentityBundles || []).map((bundle) => ({
    identityBundleId: bundle.identityBundleId,
    identityKind: bundle.identityKind,
    namedWorkId: bundle.namedWorkId || null,
    workType: contextById.get(bundle.namedWorkId)?.workType || null,
    citationCallout: contextById.get(bundle.namedWorkId)?.citationCallout || null,
    workLabel: bundle.workLabel || null,
    workAuthors: unique(bundle.workAuthors),
    publicationVenue: bundle.publicationVenue || null,
    publicationYear: bundle.publicationYear || null,
    publishers: unique(bundle.publishers),
    institutions: unique(bundle.institutions),
    identifiers: normalizedIdentifiers(bundle.identifiers),
    sourceUnitIds: unique(bundle.sourceUnitIds),
    inputResolutionStatus: bundle.resolutionStatus || "unknown",
    offlineStatus: "normalized_unresolved",
  }));
  const knownWorkIds = new Set(entries.map((entry) => entry.namedWorkId).filter(Boolean));
  for (const work of packageValue.articleMap?.contextWorks || []) {
    if (knownWorkIds.has(work.namedWorkId)) continue;
    entries.push({
      identityBundleId: `CONTEXT-${work.namedWorkId}`,
      identityKind: "named_work",
      namedWorkId: work.namedWorkId,
      workType: work.workType || null,
      citationCallout: work.citationCallout || null,
      workLabel: work.mentionText,
      workAuthors: unique(work.peopleOrOrganizations),
      publicationVenue: null,
      publicationYear: work.year || null,
      publishers: [], institutions: [],
      identifiers: normalizedIdentifiers(work.identifiers),
      sourceUnitIds: unique(work.sourceUnitIds),
      inputResolutionStatus: work.linkResolved ? "input_link_resolved" : "mention_only",
      offlineStatus: "normalized_unresolved",
    });
  }
  return {
    schemaVersion: "er1.identityRegistry.v1",
    packageId: packageValue.packageId,
    resolutionMode: "offline_normalization_only",
    entryCount: entries.length,
    entries,
    resolutionTasks: entries.map((entry) => ({
      identityTaskId: er1IdentityTaskId(packageValue.packageId, entry.identityBundleId),
      identityBundleId: entry.identityBundleId,
      priority: entry.identityKind === "primary_article" || entry.identifiers.doi.length ||
        entry.identifiers.pmid.length ? "high" : "review",
      status: "not_executed_offline_plan",
    })),
  };
}
