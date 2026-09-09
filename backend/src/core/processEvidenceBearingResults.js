import logger from "../utils/logger.js";
import { persistClaims } from "../storage/persistClaims.js";
import { insertReferenceClaimLinksBulk } from "../queries/referenceClaimLinks.js";
import PromptManager from "./promptManager.js";
import { adjudicateEvidenceBearing } from "./adjudicateEvidenceBearing.js";
import { openAiLLM } from "./openAiLLM.js";
import { createConcurrencyLimiter } from "../utils/concurrencyLimiter.js";

export const BEARING_ADJUDICATION_CONCURRENCY = 6;

/**
 * Persist document assertions, adjudicate claim-level bearing, prune acquired
 * documents with no bearing, and retain failed scrapes only through their
 * search-snippet provenance.
 *
 * This encapsulates the proven URL-scrape post-run workflow so other submission
 * routes do not fall back to legacy document-level persistence.
 */
export async function processEvidenceBearingResults({
  query,
  taskContentId,
  taskClaims = [],
  claimIds = [],
  aiReferences = [],
  bearingResults = [],
  dependencies = {},
}) {
  const persistClaimRows = dependencies.persistClaims || persistClaims;
  const adjudicate = dependencies.adjudicateEvidenceBearing || adjudicateEvidenceBearing;
  const insertLinks = dependencies.insertReferenceClaimLinksBulk || insertReferenceClaimLinksBulk;
  const promptManager = dependencies.promptManager || new PromptManager(query);
  const llm = dependencies.llm || openAiLLM;

  const caseAssertionById = new Map(
    taskClaims.map((claim) => [Number(claim.id), claim]),
  );
  const retainedReferenceContentIds = new Set();
  const runWithAdjudicationSlot = createConcurrencyLimiter(
    BEARING_ADJUDICATION_CONCURRENCY,
  );

  logger.log(
    `⚖️ [Bearing] Adjudicating with up to ${BEARING_ADJUDICATION_CONCURRENCY} concurrent documents`,
  );

  await Promise.all(
    bearingResults.map((doc) =>
      runWithAdjudicationSlot(async () => {
        const assertions = doc?.bearing?.assertions || [];

        if (!doc.referenceContentId || assertions.length === 0) return;

        const referenceClaimIds = await persistClaimRows(
          query,
          doc.referenceContentId,
          assertions.map((assertion) => ({
            text: assertion.evidenceAssertion,
          })),
          "reference",
          "reference",
          false,
        );
        const assertionsByTaskClaim = new Map();

        for (let index = 0; index < assertions.length; index++) {
          const assertion = assertions[index];
          const referenceClaimId = referenceClaimIds[index];
          const taskClaimId = Number(assertion.taskClaimId);

          if (!referenceClaimId || !Number.isInteger(taskClaimId)) continue;
          if (!assertionsByTaskClaim.has(taskClaimId)) {
            assertionsByTaskClaim.set(taskClaimId, []);
          }
          assertionsByTaskClaim.get(taskClaimId).push({
            evidenceAssertionId: String(referenceClaimId),
            evidenceAssertion: assertion.evidenceAssertion,
          });
        }

        for (const [taskClaimId, evidenceAssertions] of assertionsByTaskClaim) {
          const caseAssertion = caseAssertionById.get(taskClaimId);
          if (!caseAssertion || evidenceAssertions.length === 0) continue;

          const adjudication = await adjudicate({
            caseAssertion,
            evidenceAssertions,
            llm,
            promptManager,
          });

          for (const result of adjudication.results || []) {
            if (result.bearingScore === null) continue;

            const referenceClaimId = Number(result.evidenceAssertionId);
            if (!Number.isInteger(referenceClaimId)) continue;

            retainedReferenceContentIds.add(Number(doc.referenceContentId));
            const stance =
              result.bearingScore > 0
                ? "support"
                : result.bearingScore < 0
                  ? "refute"
                  : "nuance";

            await query(
              `INSERT INTO reference_claim_task_links
(
  reference_claim_id,
  task_claim_id,
  stance,
  score,
  confidence,
  support_level,
  rationale,
  quote,
  created_by_ai
)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
ON DUPLICATE KEY UPDATE
  stance = VALUES(stance),
  score = VALUES(score),
  confidence = VALUES(confidence),
  support_level = VALUES(support_level),
  rationale = VALUES(rationale),
  quote = VALUES(quote),
  created_by_ai = VALUES(created_by_ai)`,
              [
                referenceClaimId,
                taskClaimId,
                stance,
                50,
                0.5,
                result.bearingScore,
                result.rationale,
                null,
              ],
            );
          }
        }

        logger.log(
          `💾 [Bearing] Persisted ${referenceClaimIds.length} assertions for reference ${doc.referenceContentId}`,
        );
      }),
    ),
  );

  const retainedBearingResults = [];

  for (const doc of bearingResults) {
    const referenceContentId = Number(doc?.referenceContentId);
    if (!Number.isInteger(referenceContentId)) continue;

    if (retainedReferenceContentIds.has(referenceContentId)) {
      retainedBearingResults.push(doc);
      continue;
    }

    logger.log(
      `✂️ [BearingPrune] Pruning acquired reference ${referenceContentId}: no claim-level bearing found`,
    );

    const owners = await query(
      `SELECT content_id
         FROM content_relations
        WHERE reference_content_id = ?`,
      [referenceContentId],
    );
    const currentTaskIsOnlyOwner =
      owners.length === 1 &&
      Number(owners[0].content_id) === Number(taskContentId);
    const hasNoOwners = owners.length === 0;

    if (currentTaskIsOnlyOwner || hasNoOwners) {
      logger.log(
        `🗑️ [BearingPrune] Deleting unowned/exclusive reference ${referenceContentId}`,
      );
      await query("CALL delete_content_cascade(?)", [referenceContentId]);
    } else {
      if (claimIds.length > 0) {
        const placeholders = claimIds.map(() => "?").join(", ");
        await query(
          `DELETE FROM reference_claim_links
            WHERE reference_content_id = ?
              AND claim_id IN (${placeholders})`,
          [referenceContentId, ...claimIds],
        );
      }
      await query(
        `DELETE FROM content_relations
          WHERE content_id = ?
            AND reference_content_id = ?
            AND is_system = 1`,
        [taskContentId, referenceContentId],
      );
      logger.log(
        `♻️ [BearingPrune] Preserved shared reference ${referenceContentId}; removed only task ${taskContentId} relationship`,
      );
    }
  }

  logger.log(
    `✂️ [BearingPrune] Retained ${retainedBearingResults.length}/${bearingResults.length} acquired references`,
  );

  const retainedAiReferences = aiReferences.filter((reference) => {
    if (!reference?.referenceContentId) return false;
    if (reference.scrapeStatus === "snippet_only") return true;
    return retainedReferenceContentIds.has(Number(reference.referenceContentId));
  });
  const referenceClaimLinksToInsert = [];

  for (const doc of retainedBearingResults) {
    if (!doc?.referenceContentId) continue;

    for (const bearing of doc.snippetBearings || []) {
      const bearingScore = bearing.bearingScore == null
        ? null
        : Number(bearing.bearingScore);
      const stance = bearingScore === null
        ? "insufficient"
        : bearingScore > 0
          ? "support"
          : bearingScore < 0
            ? "refute"
            : "nuance";
      const quality = Number(doc.quality ?? 0);

      logger.log(
        `🔗 [SnippetBearing] claim=${bearing.taskClaimId} ref=${doc.referenceContentId} bearingScore=${bearingScore === null ? "null" : bearingScore.toFixed(3)} stance=${stance} quality=${quality.toFixed(3)}`,
      );
      referenceClaimLinksToInsert.push({
        claim_id: bearing.taskClaimId,
        reference_content_id: doc.referenceContentId,
        stance,
        score: Math.round(quality * 100),
        confidence: 0.5,
        support_level: bearingScore ?? 0,
        rationale: bearing.rationale ?? null,
        evidence_text: bearing.snippet || doc.candidate?.snippet || null,
        evidence_offsets: null,
        created_by_ai: 1,
        verified_by_user_id: null,
        scrape_status: "full",
      });
    }
  }

  for (const reference of retainedAiReferences) {
    if (reference.scrapeStatus !== "snippet_only") continue;

    for (const bearing of reference.snippetBearings || []) {
      const taskClaimId = claimIds[bearing.claimIndex];
      if (!taskClaimId) continue;

      const bearingScore = bearing.bearingScore == null
        ? null
        : Number(bearing.bearingScore);
      const stance = bearingScore === null
        ? "insufficient"
        : bearingScore > 0
          ? "support"
          : bearingScore < 0
            ? "refute"
            : "nuance";
      const quality = Number(reference.quality ?? 0);

      referenceClaimLinksToInsert.push({
        claim_id: taskClaimId,
        reference_content_id: reference.referenceContentId,
        stance,
        score: Math.round(quality * 100),
        confidence: 0.5,
        support_level: bearingScore ?? 0,
        rationale: bearing.rationale ?? null,
        evidence_text: bearing.snippet || reference.quote || null,
        evidence_offsets: null,
        created_by_ai: 1,
        verified_by_user_id: null,
        scrape_status: "snippet_only",
      });
      logger.log(
        `🧷 [SnippetOnlyLink] claim=${taskClaimId} ref=${reference.referenceContentId} bearingScore=${bearingScore === null ? "null" : bearingScore.toFixed(3)} stance=${stance}`,
      );
    }
  }

  if (referenceClaimLinksToInsert.length > 0) {
    await insertLinks(query, referenceClaimLinksToInsert);
    logger.log(
      `💾 [SnippetBearing] Persisted ${referenceClaimLinksToInsert.length} reference_claim_links`,
    );
  }

  return {
    retainedAiReferences,
    retainedBearingResults,
    retainedReferenceContentIds,
    referenceClaimLinksInserted: referenceClaimLinksToInsert.length,
  };
}
