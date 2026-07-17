const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();
const STANCE_HUNTING = /\b(?:support|refute|debunk|proof|disprove)\b|\b(?:contrary|contradictory) evidence\b/gi;
const STANCE_LABELS = new Set(["support", "refute", "qualify", "support_source",
  "refute_source", "qualifying_source"]);

function inferredClass(lane) {
  if (lane.queryClass) return lane.queryClass;
  if (lane.taskId) return "target_evidence";
  return lane.laneType === "named_work" ? "context_work_resolution" : "identity_resolution";
}

function groupsBy(items, keyFor) {
  const groups = new Map();
  for (const item of items) {
    const key = keyFor(item);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  return groups;
}

function basicMetrics(lanePlan, providerQueries = null) {
  const textGroups = groupsBy(lanePlan.lanes, (lane) => clean(lane.query).toLowerCase());
  const classes = { identity_resolution: 0, context_work_resolution: 0, target_evidence: 0 };
  for (const lane of lanePlan.lanes) classes[inferredClass(lane)] += 1;
  return { totalLaneCount: lanePlan.lanes.length,
    providerQueryCount: providerQueries?.selectedCount ?? null,
    uniqueQueryTextCount: textGroups.size,
    duplicateQueryTextCount: [...textGroups.values()].reduce((n, group) => n + group.length - 1, 0),
    identityResolutionQueryCount: providerQueries?.selectedCounts?.identityResolutionQueries ?? classes.identity_resolution,
    contextWorkResolutionQueryCount: providerQueries?.selectedCounts?.contextWorkResolutionQueries ?? classes.context_work_resolution,
    targetEvidenceQueryCount: providerQueries?.selectedCounts?.targetEvidenceQueries ?? classes.target_evidence };
}

function countBy(items, field) {
  const counts = new Map();
  for (const item of items) {
    const key = item[field] || "unspecified";
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return Object.fromEntries([...counts].sort((a, b) => b[1] - a[1]));
}

function fieldsByFamily(lanes) {
  const rows = new Map();
  for (const lane of lanes) {
    const family = lane.laneFamily || lane.laneType;
    if (!rows.has(family)) rows.set(family, new Map());
    for (const field of lane.fieldsUsed || []) {
      const counts = rows.get(family); counts.set(field, (counts.get(field) || 0) + 1);
    }
  }
  return Object.fromEntries([...rows].map(([family, counts]) => [family,
    [...counts].sort((a, b) => b[1] - a[1]).map(([field, count]) => ({ field, count }))]));
}

function familiesByTarget(lanes) {
  const rows = new Map();
  for (const lane of lanes.filter((x) => x.targetId)) {
    if (!rows.has(lane.targetId)) rows.set(lane.targetId, []);
    rows.get(lane.targetId).push({ evidenceRole: lane.evidenceRole,
      falsifiabilityBasis: lane.falsifiabilityBasis, query: lane.query });
  }
  return Object.fromEntries(rows);
}

function literalStanceQueries(lanes) {
  return lanes.filter((x) => x.queryClass === "target_evidence").flatMap((lane) => {
    const matches = [...lane.query.matchAll(STANCE_HUNTING)].map((x) => x[0].toLowerCase());
    return matches.length ? [{ laneId: lane.laneId, targetId: lane.targetId,
      query: lane.query, matches: [...new Set(matches)] }] : [];
  });
}

function logicalOppositeQueries(lanes) {
  return lanes.filter((x) => x.queryClass === "target_evidence").flatMap((lane) => {
    const query = clean(lane.query).toLowerCase();
    const stripped = query.replace(/\b(?:no|not) significant associations?\b/g, "")
      .replace(/\black of (?:an? )?associations?\b/g, "");
    const negative = /\b(?:no|not) significant associations?\b|\black of (?:an? )?associations?\b/.test(query);
    const positive = /\bsignificant associations?\b|\bincreased (?:risk|likelihood)\b/.test(stripped);
    return negative && positive ? [{ laneId: lane.laneId, targetId: lane.targetId,
      query: lane.query, reason: "negative_and_positive_proposition_markers" }] : [];
  });
}

function recursiveKeys(value, found = new Set()) {
  if (!value || typeof value !== "object") return found;
  for (const [key, child] of Object.entries(value)) {
    found.add(key); recursiveKeys(child, found);
  }
  return found;
}

function roleDiversity(lanePlan, packageValue) {
  const cards = new Map((packageValue.evidenceNeedCards || []).map((x) => [x.targetId, x]));
  return Object.entries(familiesByTarget(lanePlan.lanes)).map(([targetId, lanes]) => {
    const falsifiability = cards.get(targetId)?.falsifiability || {};
    const meaningfulInputs = ["wouldSupportIf", "wouldRefuteIf", "wouldQualifyIf"]
      .filter((field) => clean(falsifiability[field]));
    const evidenceRoles = [...new Set(lanes.map((x) => x.evidenceRole))];
    return { targetId, meaningfulFalsifiabilityInputs: meaningfulInputs,
      evidenceRoles, roleDiverseWhenSupported: meaningfulInputs.length < 2 || evidenceRoles.length >= 2 };
  });
}

export function buildQueryQualityReview({ lanePlan, providerQueries, packageValue, before = null }) {
  const after = basicMetrics(lanePlan, providerQueries);
  const articleTitle = clean(packageValue.article?.title).toLowerCase();
  const identityLeaks = lanePlan.lanes.filter((lane) => lane.queryClass !== "identity_resolution" &&
    (/\b10\.\d{4,9}\//i.test(lane.query) || (articleTitle.length > 30 &&
      clean(lane.query).toLowerCase().includes(articleTitle)))).map((lane) => lane.laneId);
  // Surname+year leakage (the blind spot the DOI/full-title check missed): flag a
  // non-identity lane only when BOTH the evaluated article's surname and year appear,
  // so a common surname or a bare year alone does not trip it.
  const author = clean(packageValue.article?.authors?.[0]?.name || packageValue.article?.authors?.[0]);
  const surname = author.split(/\s+/).filter(Boolean).at(-1)?.toLowerCase() || null;
  const year = clean(packageValue.article?.publishedAt).match(/\b(?:19|20)\d{2}\b/)?.[0] || null;
  const surnameYearLeaks = surname && surname.length >= 3 && year
    ? lanePlan.lanes.filter((lane) => lane.queryClass !== "identity_resolution" &&
      new RegExp(`\\b${surname}\\b`, "i").test(lane.query) && lane.query.includes(year))
      .map((lane) => lane.laneId)
    : [];
  const literalStanceHuntingQueries = literalStanceQueries(lanePlan.lanes);
  const logicalOppositeMixes = logicalOppositeQueries(lanePlan.lanes);
  const stanceLaneLabels = lanePlan.lanes.filter((lane) => [lane.laneType, lane.laneFamily,
    lane.evidenceRole].some((value) => STANCE_LABELS.has(clean(value).toLowerCase())))
    .map((lane) => lane.laneId);
  const keys = recursiveKeys({ lanePlan, providerQueries });
  const diversity = roleDiversity(lanePlan, packageValue);
  const warnings = [];
  if (literalStanceHuntingQueries.length) warnings.push("literal_stance_hunting_terms");
  if (logicalOppositeMixes.length) warnings.push("logical_opposites_mixed_in_query");
  if (stanceLaneLabels.length) warnings.push("stance_label_used_as_discovery_lane");
  if (identityLeaks.length) warnings.push("article_identity_outside_identity_lane");
  if (surnameYearLeaks.length) warnings.push("article_surname_year_outside_identity_lane");
  if (diversity.some((x) => !x.roleDiverseWhenSupported)) warnings.push("insufficient_role_diversity");
  if (lanePlan.deferredContextWorks?.length) warnings.push("context_works_deferred_as_unresolvable");
  return { schemaVersion: "er1.queryQualityReview.v2", packageId: packageValue.packageId,
    after, before: before ? basicMetrics(before.lanePlan, before.providerQueries) : null,
    evidenceRoleLaneCounts: countBy(lanePlan.lanes, "evidenceRole"),
    targetRoleDiversity: diversity,
    literalStanceHuntingQueries, logicalOppositeMixes,
    providerQueryLaneTypesUsingStanceLabels: stanceLaneLabels,
    artifactFieldAudit: { stanceFieldPresent: keys.has("stance"),
      bearingScoreFieldPresent: keys.has("bearingScore") },
    genericNamedWorksRejectedOrDeferred: lanePlan.deferredContextWorks || [],
    topFieldsUsedByQueryFamily: fieldsByFamily(lanePlan.lanes),
    queryFamiliesByTarget: familiesByTarget(lanePlan.lanes),
    queriesContainingDoiOrFullTitleOutsideIdentityLanes: identityLeaks,
    queriesContainingArticleSurnameYearOutsideIdentityLanes: surnameYearLeaks,
    warningsBeforeProviderExecution: warnings,
    prohibitedOperations: { sourceBodyFetches: 0, scrapes: 0, pdfExtractions: 0,
      modelCalls: 0, databaseReads: 0, databaseWrites: 0, migrations: 0, projections: 0 } };
}

export function queryQualityMarkdown(review) {
  const lines = ["# ER1-2A.2 query quality review", "", "## Counts", "",
    `- Total/provider lanes: ${review.after.totalLaneCount}/${review.after.providerQueryCount}`,
    `- Identity/context/target: ${review.after.identityResolutionQueryCount}/${review.after.contextWorkResolutionQueryCount}/${review.after.targetEvidenceQueryCount}`,
    `- Duplicate query texts: ${review.after.duplicateQueryTextCount}`, "", "## Evidence roles", ""];
  for (const [role, count] of Object.entries(review.evidenceRoleLaneCounts)) lines.push(`- ${role}: ${count}`);
  lines.push("", "## Terminology and safety", "",
    `- Literal stance-hunting queries: ${review.literalStanceHuntingQueries.length}`,
    `- Logical-opposite query mixes: ${review.logicalOppositeMixes.length}`,
    `- Stance labels used as provider lane types: ${review.providerQueryLaneTypesUsingStanceLabels.length}`,
    `- stance field present: ${review.artifactFieldAudit.stanceFieldPresent}`,
    `- bearingScore field present: ${review.artifactFieldAudit.bearingScoreFieldPresent}`, "",
    "No source-body fetch, scrape, PDF extraction, model call, database read/write, migration, or projection occurred.", "");
  return lines.join("\n");
}
