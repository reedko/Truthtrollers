#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import path from "node:path";
import { scoreRetrievalPromise } from "../../backend/src/evidence-run/candidateTriage.js";
import { selectCandidatePortfolio, primaryIdentityFromRegistry } from
  "../../backend/src/evidence-run/candidatePortfolioSelector.js";
import { candidatePortfolioMarkdown, portfolioQualityReview } from
  "../../backend/src/evidence-run/candidatePortfolioReport.js";
import { writeOfflineArtifacts } from "../../backend/src/evidence-run/artifacts.js";

const args = process.argv.slice(2);
const option = (name) => { const index = args.indexOf(name); return index < 0 ? null : args[index + 1]; };
const inputDir = path.resolve(option("--input") || "");
const outputDir = path.resolve(option("--out") || "");
if (!option("--input") || !option("--out")) {
  console.error("Usage: node scripts/dev/er1_select_candidate_portfolio.mjs --input <run-dir> --out <dir>");
  process.exit(2);
}
const load = async (name, optional = false) => {
  try { return JSON.parse(await readFile(path.join(inputDir, name), "utf8")); }
  catch (error) { if (optional && error.code === "ENOENT") return null; throw error; }
};
const [state, portfolio, identityRegistry, dedupe, retrieval, priorReview] = await Promise.all([
  load("candidate_discovery_state.json"), load("target_portfolio.json"),
  load("identity_registry.json"), load("candidate_dedupe.json"),
  load("retrieval_promise.json"), load("candidate_quality_review.json", true),
]);
const scored = dedupe.candidates.map((candidate) =>
  scoreRetrievalPromise(candidate, portfolio, identityRegistry));
const primaryIdentity = primaryIdentityFromRegistry(identityRegistry);
const plan = { ...selectCandidatePortfolio(scored, { primaryIdentity }), runId: state.runId, packageId: state.packageId,
  sourceArtifactDirectory: inputDir, dedupedCandidateCount: dedupe.count,
  promisingCount: state.promisingCount, priorAllocatedCandidateCount: retrieval.count };
const markdown = candidatePortfolioMarkdown(plan);
const review = portfolioQualityReview(priorReview, plan, state.promisingCount);
const reviewMarkdown = `${markdown}\n## Candidate-quality review update\n\n` +
  `The old promising threshold selected ${state.promisingCount}; the role-diverse portfolio selected ` +
  `${plan.portfolioSelectedCount}. ER1-2B remains blocked pending portfolio review.\n`;
const artifacts = [
  ["candidate_portfolio_plan", "candidate_portfolio_plan.json", plan, "application/json"],
  ["candidate_portfolio_plan_markdown", "candidate_portfolio_plan.md", markdown, "text/markdown"],
  ["candidate_quality_review", "candidate_quality_review.json", review, "application/json"],
  ["candidate_quality_review_markdown", "candidate_quality_review.md", reviewMarkdown, "text/markdown"],
].map(([name, fileName, value, mediaType]) => ({ name, fileName, value, mediaType,
  stage: "candidate_portfolio_selection" }));
await writeOfflineArtifacts({ outputDir, runId: state.runId, packageId: state.packageId, artifacts });
console.log(JSON.stringify({ inputDir, outputDir, dedupedCandidateCount: dedupe.count,
  promisingCount: state.promisingCount, portfolioSelectedCount: plan.portfolioSelectedCount,
  targets: plan.coverage.targetIds, laneFamilies: plan.coverage.laneFamilies,
  counts: plan.counts, warnings: plan.warnings }, null, 2));
