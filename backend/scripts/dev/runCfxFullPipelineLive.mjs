// backend/scripts/dev/runCfxFullPipelineLive.mjs
// One-off live run of runCfxProductionEvidencePipeline against a real task
// content_id in the local dev database. Makes real OpenAI, retrieval, and
// (possibly) direct-fetch/scrape calls. Usage:
//   node scripts/dev/runCfxFullPipelineLive.mjs <taskContentId>

import { promisify } from "node:util";
import dotenv from "dotenv";
import mysql from "mysql";
import { runCfxProductionEvidencePipeline } from "../../src/services/cfxProductionEvidencePipeline.js";

dotenv.config();

async function main() {
  const taskContentId = Number(process.argv[2] || 18056);
  if (!(process.env.OPENAI_API_KEY || process.env.REACT_APP_OPENAI_API_KEY)) {
    throw new Error("OPENAI_API_KEY or REACT_APP_OPENAI_API_KEY is required");
  }
  const pool = mysql.createPool({
    connectionLimit: 6,
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE,
    charset: "utf8mb4",
  });
  const query = promisify(pool.query).bind(pool);

  const claimRows = await query(
    `SELECT cc.claim_id FROM content_claims cc
      WHERE cc.content_id = ? AND cc.selected_for_evaluation = 1
      ORDER BY cc.claim_order`,
    [taskContentId],
  );
  const claimIds = claimRows.map((row) => Number(row.claim_id));
  if (!claimIds.length) throw new Error(`No evaluation claims found for content_id ${taskContentId}`);

  console.log(`[LIVE RUN] taskContentId=${taskContentId} claims=${claimIds.length} (${claimIds.join(",")})`);
  console.log(`[LIVE RUN] CFX_LEGACY_EVIDENCE_ENABLED=${process.env.CFX_LEGACY_EVIDENCE_ENABLED || "(unset -> CFX default)"}`);
  console.log(`[LIVE RUN] CFX_WEB_PROVIDER=${process.env.CFX_WEB_PROVIDER || "(unset -> tavily default)"}`);

  const startedAt = Date.now();
  const summary = await runCfxProductionEvidencePipeline({
    query,
    pool,
    taskContentId,
    claimIds,
    userId: null,
  });
  const elapsedMs = Date.now() - startedAt;

  console.log(`\n[LIVE RUN] Completed in ${elapsedMs}ms`);
  console.log(JSON.stringify({
    status: summary.status,
    runId: summary.runId,
    claimCount: summary.claimCount,
    planningProviderCalls: summary.planningProviderCalls,
    retrievalLogicalRequests: summary.retrievalLogicalRequests,
    retrievalProviderRequests: summary.retrievalProviderRequests,
    candidateCount: summary.candidateCount,
    canonicalDocumentCount: summary.canonicalDocumentCount,
    discoveryAssignmentCount: summary.discoveryAssignmentCount,
    queuedScrapeJobs: summary.queuedScrapeJobs,
    targetedBearingProviderCalls: summary.targetedBearingProviderCalls,
    artifactRoot: summary.artifactRoot,
  }, null, 2));

  console.log(`\n[LIVE RUN] Per-document results:`);
  for (const result of summary.results || []) {
    console.log(`  - ${result.documentKey} ref=${result.referenceContentId} scrapeJobId=${result.scrapeJobId} ` +
      `acquired=${result.acquired?.source || "none"}/${result.acquired?.accessLevel || "n/a"} ` +
      `bearing=${result.bearing?.status || "n/a"} assertions=${result.bearing?.evidenceAssertionLinkCount ?? "n/a"}`);
  }

  await promisify(pool.end).bind(pool)();
}

main().catch((err) => {
  console.error("[LIVE RUN] FAILED:", err);
  process.exitCode = 1;
});
