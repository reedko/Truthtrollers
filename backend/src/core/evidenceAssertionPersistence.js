import { persistClaims } from "../storage/persistClaims.js";
import { dualWriteTargetEvidenceLinks } from "./evaluationTargetStore.js";
import logger from "../utils/logger.js";
import { evaluateTargetFit, logPostScrapeTargetFit } from "./postScrapeTargetFit.js";

const MIN_DIRECT_BEARING = 0.25;

function clamp01(value, fallback = 0) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, Math.min(1, number));
}

function normalizeStance(value) {
  const stance = String(value || "").toLowerCase();
  if (stance === "supports") return "support";
  if (stance === "refutes") return "refute";
  if (stance === "related") return "nuance";
  return ["support", "refute", "nuance", "insufficient"].includes(stance)
    ? stance
    : "insufficient";
}

export function assertionFingerprint(value) {
  const text = typeof value === "string" ? value : value?.text || value?.quote || "";
  return String(text)
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export function buildPreservedEvidenceAssertion(evidence, claimResult, referenceData, traceId = null) {
  const unresolvedTargetIds = Array.isArray(claimResult?.adjudication?.unresolvedTargetIds)
    ? claimResult.adjudication.unresolvedTargetIds.map(Number)
    : null;

  // Step 21: deterministic post-scrape target-fit guard (no LLM). Reduces trust
  // in the combined-prompt output before a direct substantive link is built. For
  // a misconduct/data-handling target, a direct support/refute must address
  // actor + alleged action + object/study/data; otherwise it is reclassified and
  // the stance is downgraded so it cannot persist as substantive proof.
  const claim = claimResult?.claim || {};
  const target = (claim.evaluationTargets || []).find(
    (t) => String(t.evaluationTargetId) === String(evidence?.evidenceTargetId),
  ) || {};
  const targetFit = evaluateTargetFit({ claim, target, evidence });
  logPostScrapeTargetFit({ claim, target, evidence, fit: targetFit, persisted: targetFit.persistAsDirectSubstantive });

  return {
    taskClaimId: Number(evidence?.claimId || claimResult?.claim?.id) || null,
    evaluationTargetId: Number(evidence?.evidenceTargetId) || null,
    evaluationTargetType: evidence?.evidenceTargetType || null,
    evaluationTargetText: evidence?.evaluationTargetText || null,
    quote: evidence?.quote || "",
    summary: evidence?.summary || "",
    // Stance reflects the deterministic target-fit outcome, not the raw LLM label.
    stance: targetFit.finalStance,
    targetFit,
    bearingScore: Number.isFinite(Number(evidence?.bearingScore)) ? Number(evidence.bearingScore) : null,
    bearingType: evidence?.bearingType || null,
    bearingReason: evidence?.bearingReason || "",
    claimComponentAddressed: evidence?.claimComponentAddressed || null,
    sourceUrl: evidence?.url || "",
    referenceContentId: Number(referenceData?.referenceContentId) || null,
    contentRelationId: Number(referenceData?.contentRelationId || referenceData?.content_relation_id) || null,
    confidence: Number(claimResult?.adjudication?.confidence) || null,
    traceId,
    targetUnresolved: unresolvedTargetIds
      ? unresolvedTargetIds.includes(Number(evidence?.evidenceTargetId))
      : true,
  };
}

export function appendPreservedEvidenceAssertion(reference, assertion) {
  if (!reference || !assertion) return false;
  if (!Array.isArray(reference.evidenceAssertions)) reference.evidenceAssertions = [];
  reference.evidenceAssertions.push(assertion);
  return true;
}

export function filterExtractedClaimsAgainstDirectAssertions(extractedClaims, directAssertions) {
  const direct = new Set((directAssertions || []).map(assertionFingerprint).filter(Boolean));
  return (Array.isArray(extractedClaims) ? extractedClaims : []).filter(
    (claim) => !direct.has(assertionFingerprint(claim)),
  );
}

export function buildUnresolvedTargetScope(reference = {}) {
  const assertions = Array.isArray(reference.evidenceAssertions) ? reference.evidenceAssertions : [];
  const unresolved = assertions.filter((assertion) => assertion.targetUnresolved !== false);
  const byTarget = new Map();
  for (const assertion of unresolved) {
    const claimId = Number(assertion.taskClaimId);
    const targetId = Number(assertion.evaluationTargetId);
    if (!claimId || !targetId) continue;
    const key = `${claimId}:${targetId}`;
    if (!byTarget.has(key)) byTarget.set(key, {
      taskClaimId: claimId,
      evaluationTargetId: targetId,
      evaluationTargetType: assertion.evaluationTargetType || null,
      targetText: assertion.evaluationTargetText || assertion.summary || "",
    });
  }
  return {
    hasDirectAssertions: assertions.length > 0,
    shouldExtractAdditional: assertions.length === 0 || byTarget.size > 0,
    unresolvedTargets: [...byTarget.values()],
    existingAssertions: assertions.map((assertion) => assertion.quote).filter(Boolean),
  };
}

export function restrictTaskClaimsToEvidenceScope(taskClaims = [], scope = {}) {
  if (!scope.unresolvedTargets?.length) return [];
  const targetIdsByClaim = new Map();
  for (const target of scope.unresolvedTargets) {
    if (!targetIdsByClaim.has(Number(target.taskClaimId))) targetIdsByClaim.set(Number(target.taskClaimId), new Set());
    targetIdsByClaim.get(Number(target.taskClaimId)).add(Number(target.evaluationTargetId));
  }
  return taskClaims.filter((claim) => targetIdsByClaim.has(Number(claim.id))).map((claim) => {
    const allowed = targetIdsByClaim.get(Number(claim.id));
    const evaluationTargets = (claim.evaluationTargets || []).filter((target) =>
      allowed.has(Number(target.evaluationTargetId))
    );
    return {
      ...claim,
      evaluationTargets,
      text: evaluationTargets[0]?.targetText || claim.text,
    };
  });
}

function isQualifyingAssertion(assertion, minBearing) {
  return Boolean(
    Number(assertion?.taskClaimId) > 0 &&
    Number(assertion?.evaluationTargetId) > 0 &&
    Number(assertion?.referenceContentId) > 0 &&
    assertionFingerprint(assertion) &&
    normalizeStance(assertion?.stance) !== "insufficient" &&
    Number.isFinite(Number(assertion?.bearingScore)) &&
    Number(assertion.bearingScore) >= minBearing
  );
}

function strongerMatch(first, second) {
  const firstStrength = Math.max(
    clamp01(first?.confidence),
    clamp01(first?.bearingScore),
    Math.min(1, Math.abs(Number(first?.supportLevel) || 0) / 1.2),
  );
  const secondStrength = Math.max(
    clamp01(second?.confidence),
    clamp01(second?.bearingScore),
    Math.min(1, Math.abs(Number(second?.supportLevel) || 0) / 1.2),
  );
  return secondStrength > firstStrength ? second : first;
}

export function dedupeClaimMatchesByPair(matches = []) {
  const byPair = new Map();
  for (const match of Array.isArray(matches) ? matches : []) {
    const referenceClaimId = Number(match?.referenceClaimId);
    const taskClaimId = Number(match?.taskClaimId);
    const contentRelationId = Number(match?.contentRelationId || match?.content_relation_id) || 0;
    if (!referenceClaimId || !taskClaimId) continue;
    const key = `${contentRelationId}:${referenceClaimId}:${taskClaimId}`;
    byPair.set(key, byPair.has(key) ? strongerMatch(byPair.get(key), match) : match);
  }
  return [...byPair.values()];
}

export async function upsertReferenceClaimTaskLinks(query, matches = []) {
  const deduped = dedupeClaimMatchesByPair(matches);
  const persisted = [];
  for (const match of deduped) {
    const stance = normalizeStance(match.stance);
    const bearingScore = clamp01(match.bearingScore, Math.abs(Number(match.supportLevel) || 0) / 1.2);
    const confidence = clamp01(match.confidence, bearingScore);
    const score = Math.round(clamp01(match.veracityScore, bearingScore) * 100);
    const supportLevel = match.supportLevel !== null &&
      match.supportLevel !== undefined &&
      Number.isFinite(Number(match.supportLevel))
      ? Number(match.supportLevel)
      : ({ support: 1, refute: -1, nuance: 0.5, insufficient: 0 }[stance] || 0) * confidence * bearingScore;
    const rationale = String(match.rationale || "").slice(0, 2000);
    const quote = String(match.quote || "").slice(0, 10000) || null;
    const contentRelationId = Number(match.contentRelationId || match.content_relation_id) || null;

    await query(
      `INSERT INTO reference_claim_task_links
       (content_relation_id, reference_claim_id, task_claim_id, stance, score, confidence, support_level, rationale, quote, created_by_ai)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
       ON DUPLICATE KEY UPDATE
         content_relation_id = COALESCE(VALUES(content_relation_id), content_relation_id),
         stance = IF(VALUES(confidence) > COALESCE(confidence, 0), VALUES(stance), stance),
         score = GREATEST(COALESCE(score, 0), VALUES(score)),
         support_level = IF(ABS(VALUES(support_level)) >= ABS(COALESCE(support_level, 0)), VALUES(support_level), support_level),
         rationale = IF(VALUES(confidence) > COALESCE(confidence, 0), VALUES(rationale), rationale),
         quote = COALESCE(NULLIF(quote, ''), VALUES(quote)),
         confidence = GREATEST(COALESCE(confidence, 0), VALUES(confidence)),
         created_by_ai = 1`,
      [
        contentRelationId,
        Number(match.referenceClaimId),
        Number(match.taskClaimId),
        stance,
        score,
        confidence,
        supportLevel,
        rationale,
        quote,
      ],
    );
    const rows = await query(
      `SELECT reference_claim_task_links_id
         FROM reference_claim_task_links
        WHERE reference_claim_id = ? AND task_claim_id = ?
          AND (content_relation_id <=> ? OR ? IS NULL)
        LIMIT 1`,
      [Number(match.referenceClaimId), Number(match.taskClaimId), contentRelationId, contentRelationId],
    );
    persisted.push({
      ...match,
      stance,
      bearingScore,
      confidence,
      supportLevel,
      claimLinkId: Number(rows?.[0]?.reference_claim_task_links_id) || null,
    });
  }
  return persisted;
}

export async function persistDirectEvidenceAssertions({
  query,
  taskContentId,
  aiReferences = [],
  repairAudit = null,
  minBearing = MIN_DIRECT_BEARING,
} = {}) {
  if (typeof query !== "function") throw new Error("persistDirectEvidenceAssertions: missing query");
  const attemptedByClaim = new Map();
  const persistedByClaim = new Map();
  const deduplicatedByClaim = new Map();
  const assertionsByReferenceContentId = new Map();
  const outcomes = [];
  const seen = new Set();

  for (const reference of Array.isArray(aiReferences) ? aiReferences : []) {
    const assertions = Array.isArray(reference?.evidenceAssertions)
      ? reference.evidenceAssertions
      : [];
    for (const assertion of assertions) {
      const claimId = Number(assertion?.taskClaimId);
      if (claimId > 0) attemptedByClaim.set(claimId, (attemptedByClaim.get(claimId) || 0) + 1);
      if (!isQualifyingAssertion(assertion, minBearing)) {
        const reason = "assertion_missing_required_target_quote_stance_or_bearing";
        repairAudit?.recordAssertionPersistence(assertion, { status: "rejected", reason });
        outcomes.push({ assertion, status: "rejected", reason });
        continue;
      }

      // Step 21: deterministic target-fit guard. A gated (substantive
      // misconduct/data-handling) assertion that does not directly address
      // actor + action + object must not persist as direct substantive support/
      // refute. Non-gated targets (attribution, study identity) pass through.
      if (assertion.targetFit && assertion.targetFit.gated && !assertion.targetFit.persistAsDirectSubstantive) {
        const reason = `target_fit_${assertion.targetFit.compatibilityLabel}`;
        repairAudit?.recordAssertionPersistence(assertion, { status: "rejected", reason });
        outcomes.push({ assertion, status: "rejected", reason });
        continue;
      }

      const key = [
        Number(assertion.referenceContentId),
        claimId,
        Number(assertion.evaluationTargetId),
        assertionFingerprint(assertion),
      ].join(":");
      if (seen.has(key)) {
        const reason = "duplicate_direct_assertion";
        deduplicatedByClaim.set(claimId, (deduplicatedByClaim.get(claimId) || 0) + 1);
        repairAudit?.recordAssertionPersistence(assertion, { status: "deduplicated", reason });
        outcomes.push({ assertion, status: "deduplicated", reason });
        continue;
      }
      seen.add(key);

      try {
        const [referenceClaimId] = await persistClaims(
          query,
          Number(assertion.referenceContentId),
          [String(assertion.quote).trim()],
          "reference",
          "reference",
          false,
        );
        if (!referenceClaimId) throw new Error("claim persistence returned no claim ID");

        const directMatch = {
          referenceClaimId,
          taskClaimId: claimId,
          contentRelationId: assertion.contentRelationId,
          stance: assertion.stance,
          veracityScore: clamp01(assertion.bearingScore),
          confidence: clamp01(assertion.confidence, assertion.bearingScore),
          bearingScore: clamp01(assertion.bearingScore),
          supportLevel: null,
          rationale: assertion.bearingReason || assertion.summary || "Direct bearing assertion.",
          quote: assertion.quote,
          evaluationTargetId: Number(assertion.evaluationTargetId),
          evaluationTargetType: assertion.evaluationTargetType || null,
        };
        const [persistedLink] = await upsertReferenceClaimTaskLinks(query, [directMatch]);
        await dualWriteTargetEvidenceLinks(
          query,
          taskContentId,
          [directMatch],
          Number(assertion.referenceContentId),
        );
        const targetRows = process.env.ENABLE_MULTI_TARGET_EVIDENCE === "true"
          ? await query(
              `SELECT evaluation_target_evidence_link_id
                 FROM evaluation_target_evidence_links
                WHERE evaluation_target_id = ?
                  AND reference_content_id = ?
                  AND reference_claim_id = ?
                LIMIT 1`,
              [Number(assertion.evaluationTargetId), Number(assertion.referenceContentId), referenceClaimId],
            )
          : [];
        const targetEvidenceLinkId = Number(targetRows?.[0]?.evaluation_target_evidence_link_id) || null;
        if (process.env.ENABLE_MULTI_TARGET_EVIDENCE === "true" && !targetEvidenceLinkId) {
          throw new Error(`exact evaluation target link ${assertion.evaluationTargetId} was not persisted`);
        }

        if (!assertionsByReferenceContentId.has(Number(assertion.referenceContentId))) {
          assertionsByReferenceContentId.set(Number(assertion.referenceContentId), []);
        }
        assertionsByReferenceContentId.get(Number(assertion.referenceContentId)).push(assertion);
        persistedByClaim.set(claimId, (persistedByClaim.get(claimId) || 0) + 1);
        const outcome = {
          assertion,
          status: "persisted",
          referenceClaimId: Number(referenceClaimId),
          claimLinkId: persistedLink?.claimLinkId || null,
          targetEvidenceLinkId,
        };
        repairAudit?.recordAssertionPersistence(assertion, outcome);
        outcomes.push(outcome);
      } catch (error) {
        const reason = String(error?.message || error).slice(0, 240);
        logger.warn(`[R1_DIRECT_ASSERTION] Failed to persist claim=${claimId}: ${reason}`);
        repairAudit?.recordAssertionPersistence(assertion, { status: "failed", reason });
        outcomes.push({ assertion, status: "failed", reason });
      }
    }
  }

  return {
    attemptedByClaim,
    persistedByClaim,
    deduplicatedByClaim,
    assertionsByReferenceContentId,
    outcomes,
  };
}
