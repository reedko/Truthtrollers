import { readFile } from "node:fs/promises";
import path from "node:path";
import { er1RunId } from "./ids.js";
import { loadCf1PackageFile } from "./packageLoader.js";
import { buildTargetPortfolio } from "./targetPortfolio.js";
import { buildIdentityRegistry } from "./identityRegistry.js";
import { buildQueryLanePlan } from "./queryPlanner.js";
import { buildProviderQueries } from "./retrievalCoordinator.js";
import { buildQueryQualityReview, queryQualityMarkdown } from "./queryQuality.js";
import { writeOfflineArtifacts } from "./artifacts.js";

async function optionalJson(filePath) {
  if (!filePath) return null;
  try { return JSON.parse(await readFile(filePath, "utf8")); } catch { return null; }
}

function summary(result) {
  const before = result.qualityReview.before;
  const after = result.qualityReview.after;
  return `# ER1-2A.2 role-diverse query planner repair\n\n` +
    `- Run: ${result.runId}\n- Package: ${result.verification.packageId}\n` +
    `- Provider queries planned: ${after.providerQueryCount}\n` +
    `- Identity/context/target queries: ${after.identityResolutionQueryCount}/` +
    `${after.contextWorkResolutionQueryCount}/${after.targetEvidenceQueryCount}\n` +
    `- Duplicate query texts: ${before?.duplicateQueryTextCount ?? "not measured"} -> ` +
    `${after.duplicateQueryTextCount}\n` +
    `- Literal stance-hunting queries: ${result.qualityReview.literalStanceHuntingQueries.length}\n` +
    `- Stance labels used as discovery lanes: ` +
    `${result.qualityReview.providerQueryLaneTypesUsingStanceLabels.length}\n\n` +
    `Query planning only. No source-body fetch occurred. No scrape occurred. No PDF extraction ` +
    `occurred. No model call occurred. No database read/write occurred. No migration occurred. ` +
    `No projection occurred. No bearingScore was emitted. No stance was emitted.\n`;
}

export async function runQueryPlanningReview({ packagePath, outputDir, beforeDir = null,
  expected = {}, options = {}, discoveryLimits = {}, idempotencyKey = "er1-query-repair-v2" }) {
  const { packageValue, verification } = await loadCf1PackageFile(packagePath, expected);
  const runId = er1RunId(packageValue.packageId, idempotencyKey);
  const portfolio = buildTargetPortfolio(packageValue);
  const identityRegistry = buildIdentityRegistry(packageValue);
  const lanePlan = buildQueryLanePlan({ packageValue, portfolio, identityRegistry, options });
  const providerQueries = buildProviderQueries(lanePlan, portfolio, discoveryLimits);
  const before = beforeDir ? {
    lanePlan: await optionalJson(path.join(beforeDir, "query_lane_plan.json")),
    providerQueries: await optionalJson(path.join(beforeDir, "provider_queries.json")),
  } : null;
  const usableBefore = before?.lanePlan && before?.providerQueries ? before : null;
  const qualityReview = buildQueryQualityReview({ lanePlan, providerQueries, packageValue,
    before: usableBefore });
  const result = { runId, verification, portfolio, identityRegistry, lanePlan,
    providerQueries, qualityReview, outputDir };
  const artifacts = [
    ["query_lane_plan", "query_lane_plan.json", lanePlan, "application/json"],
    ["provider_queries", "provider_queries.json", providerQueries, "application/json"],
    ["query_quality_review_json", "query_quality_review.json", qualityReview, "application/json"],
    ["query_quality_review_markdown", "query_quality_review.md",
      queryQualityMarkdown(qualityReview), "text/markdown"],
    ["run_summary", "run_summary.md", summary(result), "text/markdown"],
  ].map(([name, fileName, value, mediaType]) => ({ name, fileName, value, mediaType,
    stage: "query_planning_review" }));
  result.manifest = await writeOfflineArtifacts({ outputDir, runId,
    packageId: packageValue.packageId, artifacts });
  return result;
}
