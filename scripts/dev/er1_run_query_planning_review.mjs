#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runQueryPlanningReview } from "../../backend/src/evidence-run/runQueryPlanningReview.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const args = process.argv.slice(2);
const value = (flag) => { const index = args.indexOf(flag); return index >= 0 ? args[index + 1] : null; };
const packageArg = value("--package");
if (!packageArg) {
  console.error("Usage: node scripts/dev/er1_run_query_planning_review.mjs --package <package.json> [--out <dir>] [--before <dir>] [--role-diverse]");
  process.exit(2);
}
const retrievalStrategy = { mode: "role_diverse_falsifiability",
  requested: args.includes("--role-diverse") };
const result = await runQueryPlanningReview({
  packagePath: path.resolve(root, packageArg),
  outputDir: path.resolve(root, value("--out") || "artifacts/evidence-run/er1-2a2-query-repair"),
  beforeDir: value("--before") ? path.resolve(root, value("--before")) : null,
  options: { profile: "standard", retrievalStrategy },
  discoveryLimits: { maxTargets: 8, maxProviderQueriesGlobal: 40,
    maxIdentityResolutionQueries: 6, maxContextWorkQueries: 4,
    maxTargetEvidenceQueriesGlobal: 24, maxProviderQueriesPerTarget: 3 },
});
console.log(JSON.stringify({ runId: result.runId,
  lanes: result.lanePlan.laneCount, providerQueries: result.providerQueries.selectedCount,
  counts: result.providerQueries.selectedCounts,
  duplicateQueryTexts: result.qualityReview.after.duplicateQueryTextCount,
  literalStanceQueries: result.qualityReview.literalStanceHuntingQueries.length,
  stanceLaneLabels: result.qualityReview.providerQueryLaneTypesUsingStanceLabels.length,
  outputDir: result.outputDir }, null, 2));
