import { ER1_PORTFOLIO_LIMITS } from "./contract.js";
import { candidateDomain } from "./sourceIdentity.js";

// Neutral, deterministic acquisition allocator (MCT §10-sanctioned: caps, coverage,
// dedupe, provenance diversity, runtime clone detection). It does NOT assign source
// TYPES — route/domain-derived source roles were rejected in §10 and belong to the
// ER1-2A-S semantic selector (List C). Pre-fetch coverage is "acquisition-candidate
// proposed per target under caps," never "source roles covered."

const unique = (values) => [...new Set((values || []).filter(Boolean))];
const norm = (value) => String(value || "").toLowerCase().replace(/\s+/g, " ").trim();
const routes = (candidate) => candidate.routeProvenance || [];
const families = (candidate) => unique(routes(candidate).map((route) => route.laneFamily));
const classes = (candidate) => unique(routes(candidate).map((route) => route.queryClass));
const contextTargets = (candidate) => unique(routes(candidate)
  .flatMap((route) => route.contextForTargetIds || []));
const targetOptions = (candidate) => unique([...candidate.targetIds || [], ...contextTargets(candidate)]);

const TITLE_STOP = new Set(("about after among their there these those which with without into "
  + "study children control between first").split(" "));
const titleTokens = (label) => unique(norm(label).match(/[a-z0-9]{5,}/g) || [])
  .filter((token) => !TITLE_STOP.has(token));

// Derive the evaluated article's identity from ER1's identity registry (its
// primary_article entry is the article CF1 read). No per-fixture constants.
export function primaryIdentityFromRegistry(identityRegistry) {
  const entry = (identityRegistry?.entries || []).find((item) => item.identityKind === "primary_article");
  if (!entry) return null;
  const ids = entry.identifiers || {};
  return { doi: unique(ids.doi).map(norm), pmid: unique(ids.pmid).map(norm),
    canonicalUrls: unique(ids.canonicalUrls).map(norm), titleTokens: titleTokens(entry.workLabel) };
}

// A candidate is a copy of the evaluated article when it shares a resolvable identifier
// or its title/URL matches. Runtime only; degrades to zero when there is no identity.
export function isEvaluatedArticleCopy(candidate, primaryIdentity) {
  if (!primaryIdentity) return false;
  const doi = (candidate.identifiers?.doi || []).map(norm);
  const pmid = (candidate.identifiers?.pmid || []).map(norm);
  const text = norm(`${candidate.title || ""} ${candidate.url || ""} ${candidate.normalizedUrl || ""}`);
  if (primaryIdentity.doi.some((value) => doi.includes(value) || (value && text.includes(value)))) return true;
  if (primaryIdentity.pmid.some((value) => pmid.includes(value) || (value && text.includes(value)))) return true;
  if (primaryIdentity.canonicalUrls.some((value) => value && text.includes(value))) return true;
  const tokens = primaryIdentity.titleTokens;
  return tokens.length >= 4 && tokens.every((token) => text.includes(token));
}

const hasResolvableIdentifier = (candidate) =>
  Boolean(candidate.identifiers?.doi?.length || candidate.identifiers?.pmid?.length);

function classify(candidate, primaryIdentity) {
  return { laneFamilies: families(candidate), queryClasses: classes(candidate),
    domain: candidateDomain(candidate),
    primaryClone: isEvaluatedArticleCopy(candidate, primaryIdentity),
    context: classes(candidate).includes("context_work_resolution"),
    availableTargetIds: targetOptions(candidate) };
}

// Utility ranks by cheap retrieval promise plus route-provenance / target / domain
// diversity. No source-type, advocacy, or official-domain terms.
function utility(row, state) {
  const newFamilies = row.meta.laneFamilies.filter((x) => !state.families.has(x)).length;
  const newTargets = row.meta.availableTargetIds.filter((x) => !state.targets.has(x)).length;
  const newDomain = state.domains.has(row.meta.domain) ? 0 : 1;
  return row.candidate.retrievalPromiseScore + newFamilies * 0.18 +
    Math.min(2, newTargets) * 0.12 + newDomain * 0.06 + (row.meta.context ? 0.05 : 0);
}

function assignedTargets(row, state, limits) {
  const possible = row.meta.availableTargetIds.filter((id) =>
    (state.targetCounts.get(id) || 0) < limits.maxAcquisitionCandidatesPerTarget);
  return [...possible].sort((a, b) => {
    const uncovered = Number(!state.targets.has(b)) - Number(!state.targets.has(a));
    return uncovered || (state.targetCounts.get(a) || 0) - (state.targetCounts.get(b) || 0);
  }).slice(0, 1);
}

function canSelect(row, state, limits) {
  if (state.selectedIds.has(row.candidate.candidateId)) return false;
  if (state.selected.length >= limits.maxAcquisitionCandidatesGlobal) return false;
  if ((state.domainCounts.get(row.meta.domain) || 0) >= limits.maxSameDomainGlobal) return false;
  if (row.meta.primaryClone && state.primaryCount >= limits.maxPrimaryPaperCopiesGlobal) return false;
  if (row.meta.context && state.contextCount >= limits.maxContextCandidatesGlobal) return false;
  return row.meta.availableTargetIds.length === 0 || assignedTargets(row, state, limits).length > 0;
}

export function selectCandidatePortfolio(candidates, options = {}) {
  const { primaryIdentity = null, ...overrides } = options;
  const limits = { ...ER1_PORTFOLIO_LIMITS, ...overrides };
  const rows = candidates.map((candidate) => ({ candidate, meta: classify(candidate, primaryIdentity) }));
  const availableTargets = unique(rows.flatMap((x) => x.meta.availableTargetIds)).sort();
  const state = { selected: [], selectedIds: new Set(), families: new Set(),
    targets: new Set(), domains: new Set(), targetCounts: new Map(), domainCounts: new Map(),
    primaryCount: 0, contextCount: 0 };

  function add(row, selectionReason) {
    if (!row || !canSelect(row, state, limits)) return false;
    const plannedTargetIds = assignedTargets(row, state, limits);
    const selectionReasons = unique([selectionReason,
      row.candidate.preFetchStatus !== "promising" && "role_value_over_promising_status",
      row.meta.context && "context_quota",
      row.meta.primaryClone && "bounded_primary_work_copy",
    ]);
    state.selected.push({ candidateId: row.candidate.candidateId, portfolioSelected: true,
      title: row.candidate.title, url: row.candidate.url, domain: row.meta.domain,
      retrievalPromiseScore: row.candidate.retrievalPromiseScore,
      preFetchStatus: row.candidate.preFetchStatus, plannedTargetIds,
      allRoutedTargetIds: row.meta.availableTargetIds, laneFamilies: row.meta.laneFamilies,
      queryClasses: row.meta.queryClasses, primaryArticleCopy: row.meta.primaryClone,
      contextCandidate: row.meta.context, selectionReasons });
    state.selectedIds.add(row.candidate.candidateId);
    row.meta.laneFamilies.forEach((x) => state.families.add(x));
    plannedTargetIds.forEach((id) => { state.targets.add(id);
      state.targetCounts.set(id, (state.targetCounts.get(id) || 0) + 1); });
    state.domains.add(row.meta.domain);
    state.domainCounts.set(row.meta.domain, (state.domainCounts.get(row.meta.domain) || 0) + 1);
    if (row.meta.primaryClone) state.primaryCount += 1;
    if (row.meta.context) state.contextCount += 1;
    return true;
  }

  const sorted = (filter = () => true) => rows.filter(filter)
    .sort((a, b) => utility(b, state) - utility(a, state));
  // Seed one canonical copy of the evaluated article (resolvable identifier) and one
  // directly fetchable copy (a PDF URL) — source-neutral, no fixture domains.
  add(sorted((x) => x.meta.primaryClone && hasResolvableIdentifier(x.candidate))[0],
    "canonical_primary_record");
  add(sorted((x) => x.meta.primaryClone && /\.pdf(?:$|[?#])/i.test(x.candidate.url || ""))[0],
    "fetchable_primary_copy");
  const targetCoverageCapacity = Math.max(limits.minTargetsCoveredIfAvailable,
    limits.maxAcquisitionCandidatesGlobal - 2);
  const targetCoverageGoal = Math.min(availableTargets.length, targetCoverageCapacity);
  while (state.targets.size < targetCoverageGoal) {
    const next = sorted((x) => x.meta.availableTargetIds.some((id) => !state.targets.has(id)))
      .find((x) => canSelect(x, state, limits));
    if (!next || !add(next, "target_coverage")) break;
  }
  for (const row of sorted((x) => x.meta.context)) add(row, "context_work_coverage");
  for (const row of sorted()) add(row, "diverse_score_fill");

  const highScoreSkipped = rows.filter((x) => !state.selectedIds.has(x.candidate.candidateId))
    .sort((a, b) => b.candidate.retrievalPromiseScore - a.candidate.retrievalPromiseScore).slice(0, 20)
    .map((x) => ({ candidateId: x.candidate.candidateId, title: x.candidate.title,
      retrievalPromiseScore: x.candidate.retrievalPromiseScore,
      skipReasons: unique([state.domainCounts.get(x.meta.domain) >= limits.maxSameDomainGlobal && "domain_cap",
        x.meta.primaryClone && state.primaryCount >= limits.maxPrimaryPaperCopiesGlobal && "primary_copy_cap",
        x.meta.context && state.contextCount >= limits.maxContextCandidatesGlobal && "context_cap",
        "lower_portfolio_utility"])}));
  return { schemaVersion: "er1.candidatePortfolioPlan.v2", selectionMode: "prefetch_metadata_only",
    limits, candidateCount: candidates.length, portfolioSelectedCount: state.selected.length,
    candidates: state.selected, coverage: { targetIds: [...state.targets].sort(),
      availableTargetIds: availableTargets, unresolvedTargetIds: availableTargets.filter((x) => !state.targets.has(x)),
      laneFamilies: [...state.families].sort(),
      queryClasses: unique(state.selected.flatMap((x) => x.queryClasses)).sort(),
      domains: [...state.domains].sort() },
    counts: { evaluatedArticleCopies: state.primaryCount, contextCandidates: state.contextCount },
    highScoreSkipped,
    warnings: unique([state.selected.length && state.domains.size === 1 && "portfolio_single_domain",
      state.selected.length && state.selected.every((x) => x.primaryArticleCopy) && "portfolio_only_evaluated_article_copies",
      rows.some((x) => x.meta.context) && state.contextCount === 0 && "context_available_none_selected",
      availableTargets.length && state.targets.size < availableTargets.length && "targets_unresolved"]),
    prohibitedOperations: { sourceBodyFetches: 0, scrapes: 0, pdfExtractions: 0, modelCalls: 0,
      databaseReads: 0, databaseWrites: 0, migrations: 0, projections: 0 } };
}
