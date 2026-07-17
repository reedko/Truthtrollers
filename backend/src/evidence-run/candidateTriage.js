import { er1CandidateId } from "./ids.js";
import { normalizeUrl } from "./identityRegistry.js";
import { candidateDomain, candidateIdentityKeys, normalizeCandidateIdentifiers,
  primaryCandidateDedupeKey } from "./sourceIdentity.js";

const clean = (value, max = 2_000) => String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
const unique = (values) => [...new Set((values || [])
  .filter((value) => value !== null && value !== undefined && value !== ""))];
const authorNames = (value) => {
  const values = Array.isArray(value) ? value : value == null ? [] : [value];
  return unique(values.flatMap((author) => {
    if (typeof author === "string") return author.split(/\s*[;,]\s*/);
    return [author?.name || author?.display_name || author?.fullName];
  }).map((author) => clean(author, 300)));
};
const STOP = new Set("a an and are as at be by for from has have in into is it of on or that the this to was were with study source article evidence".split(" "));
const tokens = (value) => unique(clean(value, 20_000).toLowerCase().replace(/[^a-z0-9%]+/g, " ")
  .split(/\s+/).filter((x) => x.length >= 3 && !STOP.has(x)));
const overlap = (needles, haystack) => {
  const have = new Set(tokens(haystack));
  const wanted = unique((needles || []).flatMap(tokens));
  const matched = wanted.filter((token) => have.has(token));
  return { score: wanted.length ? matched.length / wanted.length : 0, matched, wanted };
};

function rolesFor(outcome, portfolio) {
  const target = portfolio.tasks.flatMap((task) => task.targets)
    .find((item) => item.targetId === outcome.request.targetId);
  return unique(target?.evidenceNeedCard?.evidenceRolesNeeded || []);
}

function providerRoutes(raw, outcome) {
  const base = raw.retrievalProvenance?.length ? raw.retrievalProvenance : [{
    provider: raw.provider || raw.source || "other", providerRank: raw.providerRank,
    providerQuery: raw.providerQuery || outcome.request.query,
  }];
  return base.map((route) => ({
    provider: clean(route.provider || "other", 80), query: clean(route.providerQuery || outcome.request.query),
    rank: Number(route.providerRank) || null, targetId: outcome.request.targetId,
    identityBundleId: outcome.request.identityBundleId,
    queryClass: outcome.request.queryClass,
    laneFamily: outcome.request.laneFamily,
    contextForTargetIds: unique(outcome.request.relatedTargetIds),
    contextRole: outcome.request.contextRole || null,
    queryLaneIds: outcome.request.queryLaneIds,
    providerQueryId: outcome.request.providerQueryId,
    reason: outcome.request.queryClass === "context_work_resolution" ? "context_work_resolution" :
      outcome.request.identityPriority ? "identity_resolution" : "target_candidate_discovery",
    snippet: clean(raw.snippet || raw.searchSnippet),
  }));
}

export function normalizeProviderOutcomes({ runId, packageId, outcomes, portfolio, identityRegistry, limits }) {
  const identityTaskMap = new Map(identityRegistry.resolutionTasks.map((task) =>
    [task.identityBundleId, task.identityTaskId]));
  const normalized = [];
  for (const outcome of outcomes) for (const [index, raw] of outcome.results.entries()) {
    const url = clean(raw.url, 4_000);
    const normalizedUrl = normalizeUrl(url) || "";
    const canonicalUrl = normalizeUrl(raw.canonicalUrl) || null;
    const identifiers = normalizeCandidateIdentifiers(raw);
    const venue = clean(raw.academicMetadata?.venue || raw.academicMetadata?.journal ||
      raw.academicMetadata?.containerTitle || raw.venue, 500) || null;
    const authors = authorNames(raw.academicMetadata?.authors || raw.authors);
    const provisional = {
      title: clean(raw.title, 1_000), url, normalizedUrl, canonicalUrl,
      publishedAt: clean(raw.publishedAt, 80) || null, venue, identifiers,
    };
    const dedupeKey = primaryCandidateDedupeKey(provisional);
    const routes = providerRoutes(raw, outcome);
    normalized.push({
      candidateId: er1CandidateId(runId, `${dedupeKey}:${outcome.request.providerQueryId}:${index}`),
      runId, packageId,
      targetIds: unique([outcome.request.targetId]),
      identityTaskIds: unique([identityTaskMap.get(outcome.request.identityBundleId)]),
      queryLaneIds: unique(outcome.request.queryLaneIds),
      provider: routes[0]?.provider || "other", query: outcome.request.query,
      rank: Math.max(1, Math.trunc(Number(raw.providerRank || raw.rank || index + 1))),
      ...provisional,
      snippet: clean(raw.searchSnippet || raw.snippet, 2_000), authors,
      sourceRoleHints: rolesFor(outcome, portfolio),
      retrievalPromiseScore: 0, retrievalPromiseReasons: [], preFetchTargetFit: null,
      preFetchStatus: url || identifiers.doi.length || identifiers.pmid.length ? "candidate" : "unresolved_identity",
      dedupeKey, diagnostics: [], routeProvenance: routes,
    });
  }
  return { candidates: normalized, droppedByGlobalLimit: 0,
    discardedByPerQueryCap: outcomes.reduce((n, x) => n + (x.discardedByPerQueryCap || 0), 0),
    globalCapApplied: false, allocationStage: "after_dedupe_and_prefetch_score" };
}

function betterCandidate(first, second) {
  const information = (item) => clean(item.title).length + clean(item.snippet).length +
    Object.values(item.identifiers).flat().length * 200 - (Number(item.rank) || 99);
  return information(second) > information(first) ? second : first;
}

export function dedupeCandidates(candidates = [], runId) {
  const groups = [];
  const keyToGroup = new Map();
  for (const candidate of candidates) {
    const keys = candidateIdentityKeys(candidate);
    const indexes = unique(keys.map((key) => keyToGroup.get(key)).filter((x) => x !== undefined));
    let index = indexes[0];
    if (index === undefined) {
      index = groups.length;
      groups.push({ candidate, keys: new Set(keys), members: [candidate] });
    } else {
      const group = groups[index];
      group.candidate = betterCandidate(group.candidate, candidate);
      group.members.push(candidate);
      keys.forEach((key) => group.keys.add(key));
      for (const extra of indexes.slice(1)) {
        const other = groups[extra];
        if (!other || other === group) continue;
        group.candidate = betterCandidate(group.candidate, other.candidate);
        group.members.push(...other.members);
        other.keys.forEach((key) => group.keys.add(key));
        groups[extra] = null;
      }
    }
    for (const key of groups[index].keys) keyToGroup.set(key, index);
  }
  const audit = [];
  const deduped = groups.filter(Boolean).map((group) => {
    const merged = group.members.reduce((acc, item) => ({
      ...acc,
      targetIds: unique([...acc.targetIds, ...item.targetIds]),
      identityTaskIds: unique([...acc.identityTaskIds, ...item.identityTaskIds]),
      queryLaneIds: unique([...acc.queryLaneIds, ...item.queryLaneIds]),
      sourceRoleHints: unique([...acc.sourceRoleHints, ...item.sourceRoleHints]),
      routeProvenance: [...acc.routeProvenance, ...item.routeProvenance],
    }), { ...group.candidate, targetIds: [], identityTaskIds: [], queryLaneIds: [],
      sourceRoleHints: [], routeProvenance: [] });
    merged.dedupeKey = [...group.keys][0] || merged.dedupeKey;
    merged.candidateId = er1CandidateId(runId, merged.dedupeKey);
    if (group.members.length > 1) merged.diagnostics.push("duplicate_routes_merged");
    audit.push({ candidateId: merged.candidateId, dedupeKey: merged.dedupeKey,
      mergedCandidateIds: group.members.map((x) => x.candidateId), routeCount: merged.routeProvenance.length });
    return merged;
  });
  return { candidates: deduped, audit, duplicateCount: candidates.length - deduped.length };
}

function identityMatch(candidate, registry) {
  const keys = new Set(candidateIdentityKeys(candidate));
  for (const entry of registry.entries) {
    const identity = {
      identifiers: entry.identifiers,
      canonicalUrl: entry.identifiers.canonicalUrls[0],
      title: entry.workLabel, venue: entry.publicationVenue, publishedAt: entry.publicationYear,
    };
    if (candidateIdentityKeys(identity).some((key) => keys.has(key))) return entry;
  }
  return null;
}

export function scoreRetrievalPromise(candidate, portfolio, identityRegistry) {
  if (candidate.preFetchStatus === "unresolved_identity") return {
    ...candidate, retrievalPromiseScore: 0,
    retrievalPromiseReasons: ["missing_url_and_identifier"], preFetchTargetFit: null,
  };
  const reasons = [];
  let score = 0.05;
  let rejectOnly = false;
  const identity = identityMatch(candidate, identityRegistry);
  if (identity) { score += 0.55; reasons.push(`exact_identity:${identity.identityBundleId}`); }
  const targetRows = portfolio.tasks.flatMap((task) => task.targets.map((target) => ({ task, target })));
  const relevant = candidate.targetIds.length
    ? targetRows.filter((row) => candidate.targetIds.includes(row.target.targetId)) : targetRows;
  let bestFit = { score: 0, targetId: null, matchedTerms: [], missingMustMatch: [] };
  for (const { task, target } of relevant) {
    const criteria = target.evidenceNeedCard?.bearingCriteria || {};
    const text = `${candidate.title} ${candidate.snippet} ${candidate.url}`;
    const must = overlap(criteria.mustMatch, text);
    const claim = overlap(tokens(task.claimText).slice(0, 16), text);
    const fit = Math.min(1, must.score * 0.65 + claim.score * 0.35);
    if (fit > bestFit.score) bestFit = { score: fit, targetId: target.targetId,
      matchedTerms: unique([...must.matched, ...claim.matched]).slice(0, 12),
      missingMustMatch: must.wanted.filter((x) => !must.matched.includes(x)).slice(0, 12) };
    const reject = (criteria.rejectIfOnly || []).some((phrase) => overlap([phrase], text).score >= 0.7);
    if (reject && must.score === 0) { rejectOnly = true; reasons.push("reject_if_only_without_required_match"); }
  }
  score += Math.min(0.28, bestFit.score * 0.28);
  if (bestFit.score >= 0.5) reasons.push(`target_fit:${bestFit.targetId}`);
  else if (bestFit.score < 0.15 && !identity) { score -= 0.08; reasons.push("broad_topic_or_weak_target_fit"); }
  if (candidate.sourceRoleHints.length) { score += 0.06; reasons.push("requested_source_role"); }
  if (candidate.rank <= 3) { score += 0.06; reasons.push("high_provider_rank"); }
  if (candidate.snippet.length < 40) { score -= 0.08; reasons.push("low_information_snippet"); }
  if (rejectOnly && !identity) score = Math.min(score, 0.12);
  score = Math.max(0, Math.min(1, Number(score.toFixed(4))));
  return { ...candidate, retrievalPromiseScore: score,
    retrievalPromiseReasons: unique(reasons).slice(0, 12), preFetchTargetFit: bestFit,
    preFetchStatus: score >= 0.45 ? "promising" : score >= 0.18 ? "candidate" : "rejected_pre_fetch" };
}

export function applyCandidateBudgets(candidates, limits) {
  const targetCounts = new Map();
  const domainCounts = new Map();
  return [...candidates].sort((a, b) => b.retrievalPromiseScore - a.retrievalPromiseScore).map((candidate) => {
    let allowed = true;
    const domain = candidateDomain(candidate);
    for (const targetId of candidate.targetIds) {
      const targetCount = targetCounts.get(targetId) || 0;
      const domainKey = `${targetId}:${domain}`;
      if (targetCount >= limits.maxCandidatesPerTarget ||
        (domain && (domainCounts.get(domainKey) || 0) >= limits.maxSameDomainPerTarget)) allowed = false;
    }
    if (!allowed) return { ...candidate, preFetchStatus: "deferred_budget",
      diagnostics: unique([...candidate.diagnostics, "candidate_allocation_limit"]) };
    for (const targetId of candidate.targetIds) {
      targetCounts.set(targetId, (targetCounts.get(targetId) || 0) + 1);
      const key = `${targetId}:${domain}`;
      if (domain) domainCounts.set(key, (domainCounts.get(key) || 0) + 1);
    }
    return candidate;
  });
}
