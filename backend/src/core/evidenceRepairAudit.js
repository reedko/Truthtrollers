import { createHash } from "node:crypto";

import logger from "../utils/logger.js";

export const REPAIR_RUN_16386_BASELINE = Object.freeze({
  contentId: 16386,
  visibleCaseClaims: 12,
  aiReferences: 34,
  openAiCalls: 134,
  inputTokens: 440406,
  outputTokens: 75445,
  totalTokens: 515851,
  evidenceEngineTokens: 303182,
  postEvidenceTokens: 192205,
  claimLevelLinks: 43,
  claimsWithClaimLevelLinks: 4,
  claimsWithoutClaimLevelLinks: 8,
});

const LIMITS = Object.freeze({
  claimText: 240,
  query: 280,
  title: 180,
  url: 320,
  quote: 360,
  summary: 240,
  reason: 240,
  maxQueries: 12,
  maxRejectionReasons: 12,
});

function bounded(value, limit) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (text.length <= limit) return text;
  return `${text.slice(0, Math.max(0, limit - 1))}…`;
}

function numericId(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function assertionTraceId({ taskContentId, claimId, evaluationTargetId, sourceUrl, quote }) {
  const material = [
    taskContentId ?? "",
    claimId ?? "",
    evaluationTargetId ?? "",
    sourceUrl ?? "",
    quote ?? "",
  ].join("|");
  return createHash("sha256").update(material).digest("hex").slice(0, 16);
}

function increment(map, key, amount = 1) {
  const normalizedKey = bounded(key || "unspecified", LIMITS.reason);
  map.set(normalizedKey, (map.get(normalizedKey) || 0) + amount);
}

function mapCount(input, claimId) {
  if (input instanceof Map) return Number(input.get(Number(claimId)) || input.get(String(claimId)) || 0);
  if (input && typeof input === "object") return Number(input[claimId] || 0);
  return 0;
}

function uniqueSourceCount(items) {
  return new Set(
    (Array.isArray(items) ? items : [])
      .map((item) => bounded(item?.url, LIMITS.url))
      .filter(Boolean),
  ).size;
}

export function createEvidenceRepairAudit({
  taskContentId,
  claims = [],
  enabled = process.env.ENABLE_EVIDENCE_REPAIR_AUDIT !== "false",
  log = (message) => logger.log(message),
} = {}) {
  const claimStates = new Map();
  const emittedQueryPacks = new Set();
  let finalized = false;

  for (const claim of claims) {
    const claimId = numericId(claim?.id);
    if (claimId === null) continue;
    claimStates.set(claimId, {
      claimId,
      claimText: bounded(claim?.originalText || claim?.text, LIMITS.claimText),
      candidatesRetrieved: 0,
      fullSourcesProcessed: 0,
      bearingAssertionsExtracted: 0,
      evidenceHandoffRecords: 0,
      assertionsPreservedForDirectPersistence: 0,
      assertionsHandedOffAsDocuments: 0,
      assertionsRejectedAtHandoff: 0,
      assertionPersistenceAttempts: 0,
      assertionsDeduplicated: 0,
      assertionPersistenceFailures: 0,
      rejectionReasons: new Map(),
    });
  }

  const emit = (tag, payload) => {
    if (!enabled) return;
    log(`[${tag}] ${JSON.stringify(payload)}`);
  };

  emit("REPAIR_R0_BASELINE", {
    event: "repair_baseline",
    repairPhase: "R0",
    ...REPAIR_RUN_16386_BASELINE,
  });

  const ensureState = (claimId, claimText = "") => {
    const id = numericId(claimId);
    if (id === null) return null;
    if (!claimStates.has(id)) {
      claimStates.set(id, {
        claimId: id,
        claimText: bounded(claimText, LIMITS.claimText),
        candidatesRetrieved: 0,
        fullSourcesProcessed: 0,
        bearingAssertionsExtracted: 0,
        evidenceHandoffRecords: 0,
        assertionsPreservedForDirectPersistence: 0,
        assertionsHandedOffAsDocuments: 0,
        assertionsRejectedAtHandoff: 0,
        assertionPersistenceAttempts: 0,
        assertionsDeduplicated: 0,
        assertionPersistenceFailures: 0,
        rejectionReasons: new Map(),
      });
    }
    return claimStates.get(id);
  };

  return {
    enabled,

    recordQueryPack({ claim, queries = [], status = "planned", reason = null } = {}) {
      if (!enabled) return;
      const state = ensureState(claim?.id, claim?.originalText || claim?.text);
      if (!state || emittedQueryPacks.has(state.claimId)) return;
      emittedQueryPacks.add(state.claimId);
      const boundedQueries = (Array.isArray(queries) ? queries : [])
        .slice(0, LIMITS.maxQueries)
        .map((query, index) => ({
          index,
          query: bounded(query?.query ?? query, LIMITS.query),
          intent: bounded(query?.intent || query?.stanceGoal, 40) || null,
          evaluationTargetId: numericId(query?.evidenceTargetId),
          evidenceLaneId: bounded(query?.evidenceLaneId, 80) || null,
          evaluationTargetType: bounded(query?.evidenceTargetType, 60) || null,
        }));
      emit("REPAIR_R0_QUERY_PACK", {
        event: "query_pack_audit",
        repairPhase: "R0",
        taskContentId: numericId(taskContentId),
        claimId: state.claimId,
        claimText: state.claimText,
        status: bounded(status, 40),
        reason: reason ? bounded(reason, LIMITS.reason) : null,
        queryCount: Array.isArray(queries) ? queries.length : 0,
        queries: boundedQueries,
        queryLogTruncated: (Array.isArray(queries) ? queries.length : 0) > boundedQueries.length,
      });
    },

    recordEngineResult(result = {}) {
      if (!enabled) return;
      const state = ensureState(result?.claim?.id, result?.claim?.originalText || result?.claim?.text);
      if (!state) return;
      state.candidatesRetrieved = Array.isArray(result.candidates) ? result.candidates.length : 0;
      state.fullSourcesProcessed = Array.isArray(result.selectedCandidates)
        ? uniqueSourceCount(result.selectedCandidates)
        : Number(result?.adjudication?.sourcesProcessed || 0);
      state.bearingAssertionsExtracted = Array.isArray(result.evidence) ? result.evidence.length : 0;
    },

    recordEvidenceHandoff(assertion = {}, {
      status,
      reason = null,
      referenceContentId = null,
    } = {}) {
      if (!enabled) return null;
      const state = ensureState(assertion.claimId);
      if (!state) return null;
      const normalizedStatus = ["preserved_for_direct_persistence", "collapsed_to_document_reference"].includes(status)
        ? status
        : "rejected";
      state.evidenceHandoffRecords++;
      if (normalizedStatus === "preserved_for_direct_persistence") {
        state.assertionsPreservedForDirectPersistence++;
      } else if (normalizedStatus === "collapsed_to_document_reference") {
        state.assertionsHandedOffAsDocuments++;
        increment(state.rejectionReasons, "direct_assertion_persistence_not_implemented_until_R1");
      } else {
        state.assertionsRejectedAtHandoff++;
        increment(state.rejectionReasons, reason || "unspecified_handoff_rejection");
      }
      const traceId = assertionTraceId({
        taskContentId,
        claimId: state.claimId,
        evaluationTargetId: assertion.evidenceTargetId,
        sourceUrl: assertion.url,
        quote: assertion.quote,
      });
      emit("REPAIR_R0_EVIDENCE_HANDOFF", {
        event: "evidence_handoff_audit",
        repairPhase: "R0",
        traceId,
        taskContentId: numericId(taskContentId),
        claimId: state.claimId,
        evaluationTargetId: numericId(assertion.evidenceTargetId),
        evaluationTargetType: bounded(assertion.evidenceTargetType, 60) || null,
        sourceUrl: bounded(assertion.url, LIMITS.url) || null,
        referenceContentId: numericId(referenceContentId),
        title: bounded(assertion.title, LIMITS.title) || null,
        quote: bounded(assertion.quote, LIMITS.quote),
        summary: bounded(assertion.summary, LIMITS.summary) || null,
        stance: bounded(assertion.stance, 40) || null,
        bearingScore: Number.isFinite(Number(assertion.bearingScore))
          ? Number(assertion.bearingScore)
          : null,
        bearingType: bounded(assertion.bearingType, 60) || null,
        status: normalizedStatus,
        reason: reason ? bounded(reason, LIMITS.reason) : null,
      });
      return traceId;
    },

    recordAssertionPersistence(assertion = {}, {
      status,
      reason = null,
      referenceClaimId = null,
      claimLinkId = null,
      targetEvidenceLinkId = null,
    } = {}) {
      if (!enabled) return;
      const state = ensureState(assertion.taskClaimId || assertion.claimId);
      if (state) {
        state.assertionPersistenceAttempts++;
        if (status === "deduplicated") state.assertionsDeduplicated++;
        if (["failed", "rejected"].includes(status)) {
          state.assertionPersistenceFailures++;
          increment(state.rejectionReasons, reason || `direct_persistence_${status}`);
        }
      }
      emit("REPAIR_R1_ASSERTION_PERSISTENCE", {
        event: "assertion_persistence_audit",
        repairPhase: "R1",
        traceId: assertion.traceId || assertionTraceId({
          taskContentId,
          claimId: assertion.taskClaimId || assertion.claimId,
          evaluationTargetId: assertion.evaluationTargetId,
          sourceUrl: assertion.sourceUrl || assertion.url,
          quote: assertion.quote,
        }),
        taskContentId: numericId(taskContentId),
        claimId: numericId(assertion.taskClaimId || assertion.claimId),
        evaluationTargetId: numericId(assertion.evaluationTargetId),
        referenceContentId: numericId(assertion.referenceContentId),
        referenceClaimId: numericId(referenceClaimId),
        claimLinkId: numericId(claimLinkId),
        targetEvidenceLinkId: numericId(targetEvidenceLinkId),
        status: bounded(status, 40),
        reason: reason ? bounded(reason, LIMITS.reason) : null,
      });
    },

    finalize({
      assertionsPersistedByClaim = new Map(),
      claimLevelLinksPersistedByClaim = new Map(),
    } = {}) {
      if (!enabled || finalized) return [];
      finalized = true;
      const summaries = [];
      for (const state of claimStates.values()) {
        if (!emittedQueryPacks.has(state.claimId)) {
          this.recordQueryPack({
            claim: { id: state.claimId, text: state.claimText },
            queries: [],
            status: "missing",
            reason: "query_pack_not_recorded",
          });
        }
        const assertionsPersisted = mapCount(assertionsPersistedByClaim, state.claimId);
        const claimLevelLinksPersisted = mapCount(claimLevelLinksPersistedByClaim, state.claimId);
        const unaccountedAfterExtraction = Math.max(
          0,
          state.bearingAssertionsExtracted - state.evidenceHandoffRecords,
        );
        if (unaccountedAfterExtraction > 0) {
          increment(state.rejectionReasons, "missing_evidence_handoff_record", unaccountedAfterExtraction);
        }
        const unpersistedAfterHandoff = Math.max(
          0,
          state.assertionsPreservedForDirectPersistence +
            state.assertionsHandedOffAsDocuments -
            assertionsPersisted -
            state.assertionsDeduplicated,
        );
        const rejectionReasons = Object.fromEntries(
          [...state.rejectionReasons.entries()].slice(0, LIMITS.maxRejectionReasons),
        );
        const summary = {
          event: "per_claim_repair_accounting",
          repairPhase: "R0",
          taskContentId: numericId(taskContentId),
          claimId: state.claimId,
          claimText: state.claimText,
          candidatesRetrieved: state.candidatesRetrieved,
          fullSourcesProcessed: state.fullSourcesProcessed,
          bearingAssertionsExtracted: state.bearingAssertionsExtracted,
          evidenceHandoffRecords: state.evidenceHandoffRecords,
          assertionsPreservedForDirectPersistence: state.assertionsPreservedForDirectPersistence,
          assertionsHandedOffAsDocuments: state.assertionsHandedOffAsDocuments,
          assertionsRejectedAtHandoff: state.assertionsRejectedAtHandoff,
          assertionPersistenceAttempts: state.assertionPersistenceAttempts,
          assertionsPersisted,
          assertionsDeduplicated: state.assertionsDeduplicated,
          assertionPersistenceFailures: state.assertionPersistenceFailures,
          claimLevelLinksPersisted,
          unaccountedAfterExtraction,
          unpersistedAfterHandoff,
          countsReconcile:
            unaccountedAfterExtraction === 0 &&
            state.evidenceHandoffRecords ===
              state.assertionsPreservedForDirectPersistence +
                state.assertionsHandedOffAsDocuments +
                state.assertionsRejectedAtHandoff &&
            state.assertionPersistenceAttempts ===
              state.assertionsPreservedForDirectPersistence,
          rejectionReasons,
        };
        summaries.push(summary);
        emit("REPAIR_R0_CLAIM_ACCOUNTING", summary);
      }
      return summaries;
    },
  };
}
