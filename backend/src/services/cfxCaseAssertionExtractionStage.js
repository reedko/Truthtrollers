// Thin services-layer orchestration for the CFX fresh-article case-assertion
// path:
//
//   fresh scraped article (title, text, sourceUrl)
//     -> runCfxFreshArticleCaseAssertions (S0 -> S1 -> S2)
//     -> withTransaction(({query}) => persistCfxCaseAssertions({query, ...}), {pool})
//     -> claimIds
//
// Hard-fails on S1/S2 failure -- there is no fallback to legacy claim
// extraction here; selecting between this path and legacy extraction is the
// caller's mode-switch decision, not this function's. Makes no retrieval,
// acquisition, packet-selection, linking, SourceCrest, or Workspace calls,
// and contains no retry logic.

import { withTransaction } from "../storage/dbTransaction.js";
import { runCfxFreshArticleCaseAssertions } from "../claimfoundry/cfx/freshArticle/runFreshArticleCaseAssertions.js";
import { persistCfxCaseAssertions } from "./cfxCaseAssertionPersistence.js";

/**
 * @param {{
 *   pool: unknown,
 *   taskContentId: number,
 *   title: string,
 *   text: string,
 *   sourceUrl?: string,
 *   provider: unknown,
 * }} input
 * @returns {Promise<{claimIds: number[], propositionIds: string[], status: "completed"}>}
 */
export async function runCfxCaseAssertionExtractionStage({
  pool, taskContentId, title, text, sourceUrl, provider,
}) {
  const extraction = await runCfxFreshArticleCaseAssertions({
    title,
    text,
    sourceUrl,
    contentId: taskContentId,
    provider,
  });

  if (extraction.status !== "completed" || !extraction.caseAssertions) {
    const error = new Error(
      `CFX fresh-article case-assertion extraction failed at stage ${extraction.failedStage || "unknown"}`,
    );
    error.failedStage = extraction.failedStage;
    error.discoveryStatus = extraction.discovery?.status ?? null;
    error.discoveryDiagnostics = extraction.discovery?.diagnostics ?? null;
    error.substantiveReviewStatus = extraction.substantiveReview?.status ?? null;
    error.substantiveReviewDiagnostics = extraction.substantiveReview?.diagnostics ?? null;
    throw error;
  }

  const persisted = await withTransaction(
    ({ query }) => persistCfxCaseAssertions({ query, taskContentId, results: extraction.caseAssertions }),
    { pool },
  );

  return {
    claimIds: persisted.claimIds,
    propositionIds: persisted.claims.map((claim) => claim.propositionId),
    status: "completed",
  };
}
