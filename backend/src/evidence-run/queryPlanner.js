import { er1LaneId } from "./ids.js";
import { classifyContextWork, compileTargetLanes, contextWorkQuery } from "./queryCompiler.js";

const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();
const unitNumber = (value) => Number(String(value || "").match(/\d+/)?.[0]);

function contextRoutes(entry, portfolio) {
  const taskIds = [];
  const targetIds = [];
  const reasons = [];
  const label = clean(entry.workLabel).toLowerCase();
  for (const task of portfolio.tasks) for (const target of task.targets) {
    const card = target.evidenceNeedCard || {};
    const explicit = task.identityBundleIds.includes(entry.identityBundleId) ||
      task.namedWorkIds.includes(entry.namedWorkId) ||
      (card.relevantNamedWorkIds || []).includes(entry.namedWorkId);
    const distances = entry.sourceUnitIds.flatMap((a) => target.sourceUnitIds.map((b) =>
      Math.abs(unitNumber(a) - unitNumber(b)))).filter(Number.isFinite);
    const targetText = `${target.targetText} ${card.scope || ""} ` +
      `${(card.bearingCriteria?.mustMatch || []).join(" ")}`.toLowerCase();
    const typeCompatible = entry.workType === "law_or_policy" && /\b(?:law|requirements?|programs?)\b/.test(targetText) ||
      entry.workType === "standard_or_manual" && /\b(?:criteria|diagnos|36 months)\b/.test(targetText);
    const nearby = distances.length && Math.min(...distances) <= 4 &&
      (!["law_or_policy", "standard_or_manual"].includes(entry.workType) || typeCompatible);
    const typed = typeCompatible;
    const labelMatch = label.split(/\s+/).filter((x) => x.length > 4)
      .some((token) => targetText.includes(token));
    if (!explicit && !nearby && !typed && !labelMatch) continue;
    taskIds.push(task.taskId); targetIds.push(target.targetId);
    reasons.push(`${target.targetId}:${explicit ? "explicit" : nearby ? "source_unit_proximity" :
      typed ? "typed_context" : "label_overlap"}`);
  }
  return { taskIds: [...new Set(taskIds)], targetIds: [...new Set(targetIds)], reasons };
}

function identityLane(entry, laneType, laneFamily, query, fieldsUsed, extra = {}) {
  const identity = `${entry.identityBundleId}:${laneType}:${query}`;
  return {
    laneId: er1LaneId("shared", laneType, identity), taskId: null, selectedClaimId: null,
    targetId: null, laneType, laneFamily, queryClass: "identity_resolution",
    query: clean(query), evidenceRole: "identity_resolution", source: "identity_registry",
    identityBundleId: entry.identityBundleId, appliesToTaskIds: [], fieldsUsed,
    avoidTerms: [], legacyQueryHints: [], executionStatus: "not_executed_offline_plan", ...extra,
  };
}

function primaryIdentityLanes(entry) {
  const rows = [];
  for (const doi of entry.identifiers.doi) rows.push(identityLane(entry, "exact_doi",
    "exact_identifier", doi, ["identifiers.doi"], { identifierType: "doi" }));
  for (const pmid of entry.identifiers.pmid) rows.push(identityLane(entry, "exact_pmid",
    "exact_identifier", `PMID ${pmid}`, ["identifiers.pmid"], { identifierType: "pmid" }));
  for (const url of entry.identifiers.canonicalUrls) rows.push(identityLane(entry, "canonical_url",
    "primary_article_identity", url, ["identifiers.canonicalUrls"]));
  if (entry.identityKind === "primary_article" && entry.workLabel) {
    rows.push(identityLane(entry, "primary_article_identity", "primary_article_identity",
      [`"${entry.workLabel}"`, entry.workAuthors[0], entry.publicationYear,
        entry.publicationVenue].filter(Boolean).join(" "),
      ["workLabel", "workAuthors", "publicationYear", "publicationVenue"]));
  }
  return rows;
}

function contextLanes(entry, classification) {
  const rows = [];
  for (const doi of entry.identifiers.doi) rows.push({ laneFamily: "exact_identifier", query: doi,
    fieldsUsed: ["identifiers.doi"], identifierType: "doi" });
  for (const pmid of entry.identifiers.pmid) rows.push({ laneFamily: "exact_identifier",
    query: `PMID ${pmid}`, fieldsUsed: ["identifiers.pmid"], identifierType: "pmid" });
  for (const url of entry.identifiers.canonicalUrls) rows.push({ laneFamily: "context_work_resolution",
    query: url, fieldsUsed: ["identifiers.canonicalUrls"] });
  if (!rows.length) rows.push(contextWorkQuery(entry, classification));
  return rows.map((row) => ({
    laneId: er1LaneId("shared", row.laneFamily, `${entry.identityBundleId}:${row.query}`),
    taskId: null, selectedClaimId: null, targetId: null, laneType: row.laneFamily,
    laneFamily: row.laneFamily, queryClass: "context_work_resolution", query: row.query,
    evidenceRole: "context_work_resolution", source: "context_work_registry",
    identityBundleId: entry.identityBundleId, appliesToTaskIds: [], fieldsUsed: row.fieldsUsed,
    avoidTerms: [], legacyQueryHints: [], contextClassification: classification,
    ...(row.identifierType ? { identifierType: row.identifierType } : {}),
    executionStatus: "not_executed_offline_plan",
  }));
}

export function buildQueryLanePlan({ packageValue, portfolio, identityRegistry, options = {} }) {
  const lanes = [];
  const deferredContextWorks = [];
  const taskIdsByBundle = new Map();
  for (const task of portfolio.tasks) for (const bundleId of task.identityBundleIds) {
    if (!taskIdsByBundle.has(bundleId)) taskIdsByBundle.set(bundleId, []);
    taskIdsByBundle.get(bundleId).push(task.taskId);
  }
  for (const entry of identityRegistry.entries) {
    if (entry.identityKind === "primary_article") {
      lanes.push(...primaryIdentityLanes(entry));
      continue;
    }
    const decision = classifyContextWork(entry);
    if (decision.status === "deferred") {
      deferredContextWorks.push({ identityBundleId: entry.identityBundleId,
        namedWorkId: entry.namedWorkId, workLabel: entry.workLabel,
        classification: decision.classification, reason: "insufficient_resolvable_identity" });
      continue;
    }
    lanes.push(...contextLanes(entry, decision.classification));
  }
  for (const lane of lanes) lane.appliesToTaskIds = taskIdsByBundle.get(lane.identityBundleId) || [];
  for (const lane of lanes.filter((x) => x.queryClass === "context_work_resolution")) {
    const entry = identityRegistry.entries.find((x) => x.identityBundleId === lane.identityBundleId);
    const routes = contextRoutes(entry, portfolio);
    lane.appliesToTaskIds = routes.taskIds;
    lane.relatedTargetIds = routes.targetIds;
    lane.contextRole = lane.contextClassification || lane.laneFamily;
    lane.contextRoutingReasons = routes.reasons;
  }

  for (const task of portfolio.tasks) for (const target of task.targets) {
    for (const compiled of compileTargetLanes({ task, target, article: packageValue.article })) {
      lanes.push({
        laneId: er1LaneId(task.taskId, compiled.laneFamily,
          `${target.targetId}:${compiled.query}`, compiled.evidenceRole),
        taskId: task.taskId, selectedClaimId: task.selectedClaimId, targetId: target.targetId,
        laneType: compiled.laneFamily, laneFamily: compiled.laneFamily,
        queryClass: "target_evidence", query: compiled.query,
        evidenceRole: compiled.evidenceRole, falsifiabilityBasis: compiled.falsifiabilityBasis,
        source: "er1_structured_query_compiler",
        identityBundleId: null, fieldsUsed: compiled.fieldsUsed,
        avoidTerms: compiled.avoidTerms, legacyQueryHints: compiled.legacyQueryHints,
        warnings: compiled.warnings,
        executionStatus: "not_executed_offline_plan",
      });
    }
  }
  return {
    schemaVersion: "er1.queryLanePlan.v3", packageId: packageValue.packageId,
    mode: "offline_role_diverse_falsifiability_compiler",
    retrievalStrategy: options.retrievalStrategy || { mode: "role_diverse_falsifiability" },
    laneCount: lanes.length, lanes, deferredContextWorks,
    laneCounts: {
      identityResolution: lanes.filter((x) => x.queryClass === "identity_resolution").length,
      contextWorkResolution: lanes.filter((x) => x.queryClass === "context_work_resolution").length,
      targetEvidence: lanes.filter((x) => x.queryClass === "target_evidence").length,
    },
  };
}
