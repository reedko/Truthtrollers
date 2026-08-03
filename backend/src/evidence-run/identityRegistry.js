import { er1IdentityTaskId } from "./ids.js";
import {
  normalizeDoi,
  normalizePmid,
  normalizeUrl,
} from "../claimfoundry/shared/evidenceSearch/identityNormalization.js";
export {
  normalizeDoi,
  normalizePmid,
  normalizeUrl,
} from "../claimfoundry/shared/evidenceSearch/identityNormalization.js";

const unique = (values) => [...new Set((values || []).map(String).map((x) => x.trim()).filter(Boolean))];

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
