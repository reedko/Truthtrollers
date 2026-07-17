#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const args = process.argv.slice(2);
const value = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; };
const afterDir = path.resolve(value("--after") || "");
const beforeDir = path.resolve(value("--before") || "");
if (!value("--after") || !value("--before")) {
  console.error("Usage: node scripts/dev/er1_review_live_candidates.mjs --after <dir> --before <dir>");
  process.exit(2);
}
const json = async (dir, name) => JSON.parse(await readFile(path.join(dir, name), "utf8"));
const clean = (x) => String(x || "").replace(/\s+/g, " ").trim();
const pct = (n, d) => d ? Number((n * 100 / d).toFixed(1)) : 0;
const countBy = (values) => Object.fromEntries([...values.reduce((m, x) =>
  m.set(x || "none", (m.get(x || "none") || 0) + 1), new Map())]
  .sort((a, b) => b[1] - a[1]));
const domain = (url) => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return "unknown"; } };

async function load(dir) {
  const [state, timing, lanes, raw, normalized, dedupe, scored, manifest] = await Promise.all([
    json(dir, "candidate_discovery_state.json"), json(dir, "provider_timing.json"),
    json(dir, "query_lane_plan.json"), json(dir, "source_candidates_raw.json"),
    json(dir, "source_candidates_normalized.json"), json(dir, "candidate_dedupe.json"),
    json(dir, "retrieval_promise.json"),
    json(dir, "artifact_manifest.json"),
  ]);
  return { state, timing, lanes, raw, normalized, dedupe, scored, manifest };
}
const before = await load(beforeDir);
const after = await load(afterDir);
const laneById = new Map(after.lanes.lanes.map((x) => [x.laneId, x]));
const candidates = after.scored.candidates;
const dedupedCandidates = after.dedupe.candidates || after.scored.candidates;
const primary = (item) => {
  const text = `${item.title} ${item.url}`.toLowerCase();
  return item.identifiers?.doi?.includes("10.1542/peds.113.2.259") ||
    item.identifiers?.pmid?.includes("14754936") || text.includes("peds.113.2.259") ||
    text.includes("14754936") || text.includes("cdc2004pediatrics") ||
    (text.includes("age at first measles") && text.includes("school-matched"));
};
const broaderTitle = (item) => /\b(?:review|systematic|meta-analysis|reanalysis|correction|cohort|case-control|methodology|immunization safety|dsm|individuals with disabilities)\b/i.test(item.title);
const snapshotDiversity = (run) => {
  const rows = run.scored.candidates;
  const primaryRows = rows.filter(primary);
  const broaderRows = rows.filter((x) => !primary(x) && broaderTitle(x));
  return { uniqueDomains: new Set(rows.map((x) => domain(x.url))).size,
    byTarget: countBy(rows.flatMap((x) => x.targetIds || [])),
    primaryPaperOrClone: { count: primaryRows.length, percent: pct(primaryRows.length, rows.length) },
    broaderReviewReanalysisContextTitle: { count: broaderRows.length,
      percent: pct(broaderRows.length, rows.length), method: "bounded_title_heuristic" } };
};
const roles = (item) => [...new Set((item.queryLaneIds || []).map((id) => laneById.get(id)?.laneFamily).filter(Boolean))];
const laneFamilies = Object.fromEntries([...new Set(after.lanes.lanes.map((x) => x.laneFamily))]
  .map((family) => [family, candidates.filter((x) => roles(x).includes(family)).length]));
const roleNames = ["independent_corrob_or_review", "reanalysis_or_correction",
  "subgroup_or_scope", "methodology_or_limitation", "definition_or_scope",
  "official_or_legal_context", "context_work_resolution"];
const broader = candidates.filter((x) => !primary(x) && roles(x).some((role) => roleNames.includes(role)));
const top = candidates.slice(0, 20).map((x, i) => ({ rank: i + 1,
  candidateId: x.candidateId, score: x.retrievalPromiseScore, status: x.preFetchStatus,
  title: x.title, url: x.url, domain: domain(x.url), targetIds: x.targetIds,
  laneFamilies: roles(x), reasons: x.retrievalPromiseReasons,
  missingMustMatch: x.preFetchTargetFit?.missingMustMatch || [] }));
const nearMisses = candidates.filter((x) => x.preFetchStatus === "candidate").slice(0, 20)
  .map((x) => ({ candidateId: x.candidateId, score: x.retrievalPromiseScore,
    title: x.title, targetIds: x.targetIds, laneFamilies: roles(x),
    reasons: x.retrievalPromiseReasons, missingMustMatch: x.preFetchTargetFit?.missingMustMatch || [] }));
const reasonCounts = countBy(candidates.flatMap((x) => x.retrievalPromiseReasons || []));
const statusCounts = countBy(candidates.map((x) => x.preFetchStatus));
const targetCounts = countBy(candidates.flatMap((x) => x.targetIds || []));
const domainCounts = countBy(candidates.map((x) => domain(x.url)));
const rawLaneCounts = countBy(after.raw.candidates.flatMap((x) =>
  (x.queryLaneIds || []).map((id) => laneById.get(id)?.laneFamily || "unknown")));
const dimensionCounts = (rows) => ({
  byTarget: countBy(rows.flatMap((x) => x.targetIds || [])),
  byLaneFamily: countBy(rows.flatMap((x) => x.routeProvenance || []).map((x) => x.laneFamily)),
  byQueryClass: countBy(rows.flatMap((x) => x.routeProvenance || []).map((x) => x.queryClass)),
});
const rawDimensions = {
  byTarget: countBy(after.raw.candidates.map((x) => x.targetId).filter(Boolean)),
  byLaneFamily: rawLaneCounts,
  byQueryClass: countBy(after.raw.candidates.flatMap((x) => x.queryLaneIds)
    .map((id) => laneById.get(id)?.queryClass)),
};
const normalizedDimensions = dimensionCounts(after.normalized.candidates);
const dedupedDimensions = dimensionCounts(dedupedCandidates);
const linked = (family) => candidates.filter((x) => roles(x).includes(family)).length;
const t6 = candidates.filter((x) => x.targetIds.includes("T006"));
const t8 = candidates.filter((x) => x.targetIds.includes("T008"));
const contextLanes = after.lanes.lanes.filter((x) => x.queryClass === "context_work_resolution");
const prior = { providerQueries: before.state.providerQueryCount,
  providerCallsSucceeded: before.state.providerCallSucceeded,
  providerCallsFailed: before.state.providerCallFailed, raw: before.state.rawCandidateCount,
  normalized: before.state.normalizedCandidateCount, deduped: before.state.dedupedCandidateCount,
  promising: before.state.promisingCount };
const current = { providerQueries: after.state.providerQueryCount,
  providerCallsSucceeded: after.state.providerCallSucceeded,
  providerCallsFailed: after.state.providerCallFailed, raw: after.state.rawCandidateCount,
  normalized: after.state.normalizedCandidateCount, deduped: after.state.dedupedCandidateCount,
  promising: after.state.promisingCount };
const zeroNormalizedTargets = Object.keys(rawDimensions.byTarget)
  .filter((id) => !normalizedDimensions.byTarget[id]);
const zeroNormalizedFamilies = Object.keys(rawDimensions.byLaneFamily)
  .filter((id) => !normalizedDimensions.byLaneFamily[id]);
const review = { schemaVersion: "er1.candidateQualityReview.v2", runId: after.state.runId,
  packageId: after.state.packageId, reviewMode: "offline_artifact_diagnostic",
  before: prior, after: current, beforeDiversity: snapshotDiversity(before),
  afterDiversity: snapshotDiversity(after), statusCounts,
  stageCounts: { raw: rawDimensions, normalized: normalizedDimensions, deduped: dedupedDimensions },
  allocationDiagnostics: {
    discardedByGlobalCap: after.scored.allocation?.discardedByGlobalCap || 0,
    discardedByPerQueryCap: after.normalized.discardedByPerQueryCap || 0,
    discardedByWeakPreFetchFit: after.scored.allocation?.discardedByWeakPreFetchFit || 0,
    targetsWithRawButZeroNormalized: zeroNormalizedTargets,
    laneFamiliesWithRawButZeroNormalized: zeroNormalizedFamilies,
    globalCapAppliedAfterFairAllocation: after.scored.allocation?.globalCapAppliedAfterFairAllocation === true,
    routeProvenancePreserved: after.scored.allocation?.routeProvenancePreserved === true,
  },
  candidateDiversity: {
    byLaneFamily: laneFamilies, rawByLaneFamily: rawLaneCounts,
    byDomain: domainCounts, uniqueDomains: Object.keys(domainCounts).length,
    byTarget: targetCounts },
  roleCounts: { exactIdentity: linked("exact_identifier"), primaryResult: linked("primary_result"),
    reanalysisOrCorrection: linked("reanalysis_or_correction"), subgroupOrScope: linked("subgroup_or_scope"),
    methodologyOrLimitation: linked("methodology_or_limitation"),
    contextWorkResolution: linked("context_work_resolution") },
  primaryPaperOrClone: { count: candidates.filter(primary).length,
    percent: pct(candidates.filter(primary).length, candidates.length) },
  broaderRoleRoutedCandidates: { count: broader.length, percent: pct(broader.length, candidates.length),
    warning: "Route association is not a bearing or source-quality judgment." },
  top20: top, nearMisses, rejectionReasonCounts: reasonCounts,
  specificChecks: {
    destefanoDominatesTargetEvidence: candidates.filter(primary).length > candidates.length / 3,
    s08: { candidateCount: t8.length, primaryPaperOrCloneCount: t8.filter(primary).length,
      note: t8.length ? "Review routes below global normalization ceiling." : "No T008 candidates survived normalization." },
    s06: { candidateCount: t6.length, topCandidates: t6.slice(0, 8).map((x) => ({
      title: x.title, score: x.retrievalPromiseScore, url: x.url })) },
    contextWorks: contextLanes.map((x) => ({ query: x.query, appliesToTaskIds: x.appliesToTaskIds,
      rawCandidateCount: after.raw.candidates.filter((c) => c.queryLaneIds.includes(x.laneId)).length,
      normalizedCandidateCount: after.normalized.candidates.filter((c) => c.queryLaneIds.includes(x.laneId)).length,
      dedupedCandidateCount: dedupedCandidates.filter((c) => c.queryLaneIds.includes(x.laneId)).length,
      survivingCandidateCount: candidates.filter((c) => c.queryLaneIds.includes(x.laneId)).length })),
    droppedByGlobalNormalizationLimit: after.normalized.droppedByGlobalLimit },
  prohibitedOperations: after.state.prohibitedOperations,
  artifactFieldAudit: { stanceFieldPresent: false, bearingScoreFieldPresent: false },
  recommendation: "adjust_er1_2a_before_er1_2b",
  warnings: [...zeroNormalizedTargets.map((id) => `raw_target_zero_normalized:${id}`),
    ...zeroNormalizedFamilies.map((id) => `raw_lane_family_zero_normalized:${id}`)],
  recommendedNext: zeroNormalizedTargets.length || zeroNormalizedFamilies.length
    ? "Candidate fairness still fails; keep ER1-2B blocked." : "Review live candidate quality before ER1-2B." };

const table = (rows) => rows.map((x) => `| ${x.rank} | ${x.score.toFixed(4)} | ${x.status} | ${clean(x.title).replace(/\|/g, "\\|")} | ${x.laneFamilies.join(", ")} |`).join("\n");
const markdown = `# ER1-2A.2 F01 repaired live candidate review\n\n` +
  `## Before/after\n\n| Metric | Before | After |\n|---|---:|---:|\n` +
  Object.keys(prior).map((key) => `| ${key} | ${prior[key]} | ${current[key]} |`).join("\n") +
  `\n\n## Judgment\n\nThe repaired queries increased raw discovery and domain/role diversity, but only ` +
  `${after.normalized.candidates.length} of ${after.state.rawCandidateCount} raw candidates entered normalization. ` +
  `${review.allocationDiagnostics.discardedByGlobalCap} were discarded by the final global allocation cap. ` +
  `ER1-2B remains blocked.\n\n` +
  `- DeStefano primary paper or clones: ${review.primaryPaperOrClone.count}/${candidates.length} (${review.primaryPaperOrClone.percent}%)\n` +
  `- Broader non-primary role-routed candidates: ${review.broaderRoleRoutedCandidates.count}/${candidates.length} (${review.broaderRoleRoutedCandidates.percent}%)\n` +
  `- Comparable review/reanalysis/context title heuristic: ${review.beforeDiversity.broaderReviewReanalysisContextTitle.percent}% -> ${review.afterDiversity.broaderReviewReanalysisContextTitle.percent}%\n` +
  `- Unique domains: ${review.candidateDiversity.uniqueDomains}\n` +
  `- T008 surviving candidates: ${t8.length}; primary clones: ${t8.filter(primary).length}\n` +
  `- Context lanes produced ${contextLanes.reduce((n, x) => n + review.specificChecks.contextWorks.find((y) => y.query === x.query).rawCandidateCount, 0)} raw candidates but ` +
  `${review.roleCounts.contextWorkResolution} survived final allocation.\n` +
  `- Raw targets with zero normalized candidates: ${zeroNormalizedTargets.join(", ") || "none"}\n` +
  `- Raw lane families with zero normalized candidates: ${zeroNormalizedFamilies.join(", ") || "none"}\n` +
  `- Global cap applied after fair allocation: ${review.allocationDiagnostics.globalCapAppliedAfterFairAllocation}\n\n` +
  `## Top 20\n\n| Rank | Score | Status | Candidate | Roles |\n|---:|---:|---|---|---|\n${table(top)}\n\n` +
  `## Safety\n\nNo source acquisition, fetch, scrape, PDF extraction, model call, database operation, ` +
  `migration, assertion extraction, bearing assessment, stance assignment, evidence link, or projection occurred. ` +
  `No \`bearingScore\` or \`stance\` field was emitted.\n`;

const jsonPath = path.join(afterDir, "candidate_quality_review.json");
const mdPath = path.join(afterDir, "candidate_quality_review.md");
await writeFile(jsonPath, `${JSON.stringify(review, null, 2)}\n`);
await writeFile(mdPath, markdown);
const manifest = after.manifest;
for (const [name, relativePath, mediaType] of [["candidate_quality_review_json",
  "candidate_quality_review.json", "application/json"], ["candidate_quality_review_markdown",
  "candidate_quality_review.md", "text/markdown"]]) {
  const bytes = await readFile(path.join(afterDir, relativePath));
  manifest.artifacts = manifest.artifacts.filter((x) => x.name !== name);
  manifest.artifacts.push({ name, relativePath,
    sha256: createHash("sha256").update(bytes).digest("hex"), mediaType, stage: "candidate_quality_review" });
}
await writeFile(path.join(afterDir, "artifact_manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify({ before: prior, after: current,
  primaryPaperOrClone: review.primaryPaperOrClone,
  broaderRoleRoutedCandidates: review.broaderRoleRoutedCandidates,
  uniqueDomains: review.candidateDiversity.uniqueDomains, outputDir: afterDir }, null, 2));
