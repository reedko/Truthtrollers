import assert from "node:assert/strict";
import test from "node:test";

import {
  createEvidenceRepairAudit,
  REPAIR_RUN_16386_BASELINE,
} from "../../src/core/evidenceRepairAudit.js";

function parsePayload(line) {
  return JSON.parse(line.slice(line.indexOf("{")));
}

test("R0 records the frozen run-16386 repair baseline", () => {
  assert.deepEqual(REPAIR_RUN_16386_BASELINE, {
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
});

test("R0 audit is bounded, traceable, reconciled, and does not mutate inputs", () => {
  const lines = [];
  const claim = {
    id: 52881,
    text: "William Thompson revealed that data linking the MMR vaccine to autism had been manipulated by the CDC.",
  };
  const queries = [{
    query: `William Thompson ${"context ".repeat(100)}`,
    intent: "refute",
    evidenceTargetId: 72,
    evidenceTargetType: "substantive",
  }];
  const evidence = [{
    claimId: 52881,
    evidenceTargetId: 72,
    evidenceTargetType: "substantive",
    url: "https://example.org/source",
    title: "A source",
    quote: "Q".repeat(1000),
    summary: "S".repeat(1000),
    stance: "refute",
    bearingScore: 0.91,
    bearingType: "direct",
  }];
  const snapshot = structuredClone({ claim, queries, evidence });
  const audit = createEvidenceRepairAudit({
    taskContentId: 16386,
    claims: [claim],
    enabled: true,
    log: (line) => lines.push(line),
  });

  audit.recordQueryPack({ claim, queries });
  audit.recordEngineResult({
    claim,
    candidates: [{ url: "https://example.org/source" }],
    selectedCandidates: [{ url: "https://example.org/source" }],
    evidence,
  });
  const traceId = audit.recordEvidenceHandoff(evidence[0], {
    status: "collapsed_to_document_reference",
    reason: "legacy_document_handoff_preserved_in_R0",
    referenceContentId: 901,
  });
  const summaries = audit.finalize({
    assertionsPersistedByClaim: new Map(),
    claimLevelLinksPersistedByClaim: new Map([[52881, 2]]),
  });

  assert.deepEqual({ claim, queries, evidence }, snapshot, "audit instrumentation must not mutate pipeline inputs");
  assert.match(traceId, /^[a-f0-9]{16}$/);
  assert.equal(lines.filter((line) => line.startsWith("[REPAIR_R0_QUERY_PACK]")).length, 1);
  assert.equal(lines.filter((line) => line.startsWith("[REPAIR_R0_EVIDENCE_HANDOFF]")).length, 1);
  assert.equal(lines.filter((line) => line.startsWith("[REPAIR_R0_CLAIM_ACCOUNTING]")).length, 1);

  const queryRecord = parsePayload(lines.find((line) => line.startsWith("[REPAIR_R0_QUERY_PACK]")));
  const handoffRecord = parsePayload(lines.find((line) => line.startsWith("[REPAIR_R0_EVIDENCE_HANDOFF]")));
  assert.ok(queryRecord.queries[0].query.length <= 280);
  assert.ok(handoffRecord.quote.length <= 360);
  assert.ok(handoffRecord.summary.length <= 240);
  assert.equal(handoffRecord.traceId, traceId);

  assert.deepEqual(summaries[0], {
    event: "per_claim_repair_accounting",
    repairPhase: "R0",
    taskContentId: 16386,
    claimId: 52881,
    claimText: claim.text,
    candidatesRetrieved: 1,
    fullSourcesProcessed: 1,
    bearingAssertionsExtracted: 1,
    evidenceHandoffRecords: 1,
    assertionsPreservedForDirectPersistence: 0,
    assertionsHandedOffAsDocuments: 1,
    assertionsRejectedAtHandoff: 0,
    assertionPersistenceAttempts: 0,
    assertionsPersisted: 0,
    assertionsDeduplicated: 0,
    assertionPersistenceFailures: 0,
    claimLevelLinksPersisted: 2,
    unaccountedAfterExtraction: 0,
    unpersistedAfterHandoff: 1,
    countsReconcile: true,
    rejectionReasons: {
      direct_assertion_persistence_not_implemented_until_R1: 1,
    },
  });
});

test("R0 emits one query-pack record per claim and exposes missing handoffs", () => {
  const lines = [];
  const claim = { id: 7, text: "A claim" };
  const audit = createEvidenceRepairAudit({
    taskContentId: 99,
    claims: [claim],
    enabled: true,
    log: (line) => lines.push(line),
  });
  audit.recordQueryPack({ claim, queries: [{ query: "first" }] });
  audit.recordQueryPack({ claim, queries: [{ query: "duplicate should not log" }] });
  audit.recordEngineResult({
    claim,
    candidates: [],
    selectedCandidates: [],
    evidence: [{ claimId: 7, quote: "Unrecorded assertion" }],
  });
  const [summary] = audit.finalize();

  assert.equal(lines.filter((line) => line.startsWith("[REPAIR_R0_QUERY_PACK]")).length, 1);
  assert.equal(summary.unaccountedAfterExtraction, 1);
  assert.equal(summary.countsReconcile, false);
  assert.equal(summary.rejectionReasons.missing_evidence_handoff_record, 1);
});

test("R1 audit traces a preserved assertion to exact persisted claim and link IDs", () => {
  const lines = [];
  const claim = { id: 52881, text: "CDC researchers omitted an analysis." };
  const evidence = {
    claimId: 52881,
    evidenceTargetId: 72,
    evidenceTargetType: "substantive",
    url: "https://abc.example/thompson",
    quote: "The authors omitted statistically significant information.",
    stance: "support",
    bearingScore: 0.9,
  };
  const audit = createEvidenceRepairAudit({
    taskContentId: 16386,
    claims: [claim],
    enabled: true,
    log: (line) => lines.push(line),
  });
  audit.recordQueryPack({ claim, queries: [{ query: "William Thompson CDC omitted analysis", evidenceTargetId: 72 }] });
  audit.recordEngineResult({ claim, candidates: [{}], selectedCandidates: [{ url: evidence.url }], evidence: [evidence] });
  const traceId = audit.recordEvidenceHandoff(evidence, {
    status: "preserved_for_direct_persistence",
    referenceContentId: 9001,
  });
  audit.recordAssertionPersistence({
    ...evidence,
    taskClaimId: 52881,
    evaluationTargetId: 72,
    referenceContentId: 9001,
    traceId,
  }, {
    status: "persisted",
    referenceClaimId: 700,
    claimLinkId: 800,
    targetEvidenceLinkId: 900,
  });
  const [summary] = audit.finalize({
    assertionsPersistedByClaim: new Map([[52881, 1]]),
    claimLevelLinksPersistedByClaim: new Map([[52881, 1]]),
  });

  const persistence = parsePayload(lines.find((line) => line.startsWith("[REPAIR_R1_ASSERTION_PERSISTENCE]")));
  assert.equal(persistence.traceId, traceId);
  assert.equal(persistence.referenceClaimId, 700);
  assert.equal(persistence.claimLinkId, 800);
  assert.equal(persistence.targetEvidenceLinkId, 900);
  assert.equal(summary.assertionPersistenceAttempts, 1);
  assert.equal(summary.assertionsPersisted, 1);
  assert.equal(summary.unpersistedAfterHandoff, 0);
  assert.equal(summary.countsReconcile, true);
});
