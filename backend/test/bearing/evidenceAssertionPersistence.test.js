import assert from "node:assert/strict";
import test from "node:test";

import {
  appendPreservedEvidenceAssertion,
  buildPreservedEvidenceAssertion,
  dedupeClaimMatchesByPair,
  filterExtractedClaimsAgainstDirectAssertions,
  persistDirectEvidenceAssertions,
  upsertReferenceClaimTaskLinks,
} from "../../src/core/evidenceAssertionPersistence.js";

test("R1 preserves the complete additive evidenceAssertions contract without mutating evidence", () => {
  const evidence = {
    claimId: 52881,
    evidenceTargetId: 72,
    evidenceTargetType: "substantive",
    quote: "The authors omitted statistically significant information.",
    summary: "Thompson described an omitted subgroup analysis.",
    stance: "support",
    bearingScore: 0.91,
    bearingType: "direct",
    bearingReason: "Directly addresses the omission allegation.",
    claimComponentAddressed: "alleged_action",
    url: "https://abc.example/thompson",
  };
  const original = structuredClone(evidence);
  const assertion = buildPreservedEvidenceAssertion(
    evidence,
    { claim: { id: 52881 }, adjudication: { confidence: 0.84 } },
    { referenceContentId: 9001 },
    "0123456789abcdef",
  );
  const reference = { evidenceAssertions: [] };

  assert.equal(appendPreservedEvidenceAssertion(reference, assertion), true);
  assert.equal(appendPreservedEvidenceAssertion(reference, { ...assertion }), true);
  assert.equal(reference.evidenceAssertions.length, 2, "handoff preserves every engine assertion; persistence performs dedupe");
  assert.deepEqual(reference.evidenceAssertions[0], {
    taskClaimId: 52881,
    evaluationTargetId: 72,
    evaluationTargetType: "substantive",
    evaluationTargetText: null,
    quote: evidence.quote,
    summary: evidence.summary,
    stance: "support",
    bearingScore: 0.91,
    bearingType: "direct",
    bearingReason: evidence.bearingReason,
    claimComponentAddressed: "alleged_action",
    sourceUrl: evidence.url,
    referenceContentId: 9001,
    confidence: 0.84,
    traceId: "0123456789abcdef",
    targetUnresolved: true,
    // Step 21: deterministic target-fit is attached to every assertion. This
    // claim has no evidenceNeed/targets, so the guard is non-gated (pass-through).
    targetFit: {
      compatibilityLabel: "direct_substantive",
      compatibleWithTarget: true,
      finalStance: "support",
      directness: "direct",
      persistAsDirectSubstantive: true,
      rejectedReason: null,
      missingRequiredElements: [],
      originalLlmStance: "support",
      sourceRole: null,
      gated: false,
    },
  });
  assert.deepEqual(evidence, original);
});

test("R1 generic extraction remains additive and excludes assertions already directly persisted", () => {
  const extracted = [
    { id: 1, text: "The authors omitted statistically significant information." },
    { id: 2, text: "The CDC disputed Thompson's characterization." },
  ];
  const snapshot = structuredClone(extracted);
  const filtered = filterExtractedClaimsAgainstDirectAssertions(extracted, [{
    quote: "The authors omitted statistically-significant information!",
  }]);

  assert.deepEqual(filtered.map((claim) => claim.id), [2]);
  assert.deepEqual(extracted, snapshot, "dedupe must not mutate generic extraction output");
});

test("R1 link upsert deduplicates a pair and keeps the stronger match", async () => {
  const calls = [];
  const query = async (sql, params) => {
    calls.push({ sql, params });
    if (sql.includes("SELECT reference_claim_task_links_id")) {
      return [{ reference_claim_task_links_id: 404 }];
    }
    return { affectedRows: 1 };
  };
  const weak = {
    referenceClaimId: 10,
    taskClaimId: 20,
    stance: "nuance",
    bearingScore: 0.3,
    confidence: 0.4,
    rationale: "Weak.",
  };
  const strong = {
    ...weak,
    stance: "refute",
    bearingScore: 0.9,
    confidence: 0.88,
    rationale: "Direct contradiction.",
  };

  assert.deepEqual(dedupeClaimMatchesByPair([weak, strong]), [strong]);
  const persisted = await upsertReferenceClaimTaskLinks(query, [weak, strong]);
  const inserts = calls.filter((call) => call.sql.includes("INSERT INTO reference_claim_task_links"));
  assert.equal(inserts.length, 1);
  assert.match(inserts[0].sql, /ON DUPLICATE KEY UPDATE/);
  assert.match(inserts[0].sql, /GREATEST\(COALESCE\(confidence/);
  assert.match(inserts[0].sql, /VALUES\(confidence\) > COALESCE\(confidence/);
  assert.equal(inserts[0].params[2], "refute");
  assert.equal(persisted[0].claimLinkId, 404);
});

function createPersistenceQueryStub() {
  const claims = new Map();
  const contentClaims = new Set();
  const claimLinks = new Map();
  const targetLinks = new Map();
  let nextClaimId = 700;
  let nextClaimLinkId = 800;
  let nextTargetLinkId = 900;

  const query = async (sql, params = []) => {
    if (sql.includes("SELECT claim_id FROM claims WHERE claim_text")) {
      const id = claims.get(params[0]);
      return id ? [{ claim_id: id }] : [];
    }
    if (sql.includes("INSERT INTO claims")) {
      const id = nextClaimId++;
      claims.set(params[0], id);
      return { insertId: id };
    }
    if (sql.includes("SELECT 1 AS exists_link FROM content_claims")) {
      return contentClaims.has(params.join(":")) ? [{ exists_link: 1 }] : [];
    }
    if (sql.includes("INSERT INTO content_claims")) {
      contentClaims.add(`${params[0]}:${params[1]}:${params[2]}`);
      return { insertId: 1 };
    }
    if (sql.includes("UPDATE content_claims")) return { affectedRows: 1 };
    if (sql.includes("INSERT INTO reference_claim_task_links")) {
      const key = `${params[0]}:${params[1]}`;
      if (!claimLinks.has(key)) claimLinks.set(key, nextClaimLinkId++);
      return { affectedRows: 1 };
    }
    if (sql.includes("SELECT reference_claim_task_links_id")) {
      return [{ reference_claim_task_links_id: claimLinks.get(`${params[0]}:${params[1]}`) }];
    }
    if (sql.includes("FROM claim_evaluation_targets")) {
      return [{ evaluation_target_id: 72, claim_id: 52881, target_type: "substantive" }];
    }
    if (sql.includes("INSERT INTO evaluation_target_evidence_links")) {
      const key = `${params[0]}:${params[1]}:${params[2]}`;
      if (!targetLinks.has(key)) targetLinks.set(key, nextTargetLinkId++);
      return { affectedRows: 1 };
    }
    if (sql.includes("SELECT evaluation_target_evidence_link_id")) {
      return [{ evaluation_target_evidence_link_id: targetLinks.get(`${params[0]}:${params[1]}:${params[2]}`) }];
    }
    throw new Error(`Unexpected SQL in R1 test: ${sql}`);
  };
  return { query, claims, contentClaims, claimLinks, targetLinks };
}

test("R1 directly persists an assertion, exact case-claim link, and exact target link idempotently", async () => {
  const originalFlag = process.env.ENABLE_MULTI_TARGET_EVIDENCE;
  process.env.ENABLE_MULTI_TARGET_EVIDENCE = "true";
  const db = createPersistenceQueryStub();
  const auditOutcomes = [];
  const repairAudit = {
    recordAssertionPersistence(assertion, outcome) {
      auditOutcomes.push({ assertion, outcome });
    },
  };
  const assertion = {
    taskClaimId: 52881,
    evaluationTargetId: 72,
    evaluationTargetType: "substantive",
    quote: "I regret that my co-authors and I omitted statistically significant information.",
    summary: "Thompson described omitted information.",
    stance: "support",
    bearingScore: 0.92,
    bearingReason: "Direct first-person statement.",
    sourceUrl: "https://abc.example/thompson",
    referenceContentId: 9001,
    confidence: 0.86,
    traceId: "abcdef0123456789",
  };

  try {
    const first = await persistDirectEvidenceAssertions({
      query: db.query,
      taskContentId: 16386,
      aiReferences: [{ referenceContentId: 9001, evidenceAssertions: [assertion, { ...assertion }] }],
      repairAudit,
    });
    const second = await persistDirectEvidenceAssertions({
      query: db.query,
      taskContentId: 16386,
      aiReferences: [{ referenceContentId: 9001, evidenceAssertions: [assertion] }],
      repairAudit,
    });

    assert.equal(first.attemptedByClaim.get(52881), 2, "every engine assertion reaches the direct persistence coordinator");
    assert.equal(first.persistedByClaim.get(52881), 1);
    assert.equal(first.deduplicatedByClaim.get(52881), 1);
    assert.equal(first.outcomes[0].referenceClaimId, 700);
    assert.equal(first.outcomes[0].claimLinkId, 800);
    assert.equal(first.outcomes[0].targetEvidenceLinkId, 900);
    assert.equal(second.outcomes[0].referenceClaimId, 700, "retry reuses source claim");
    assert.equal(second.outcomes[0].claimLinkId, 800, "retry upserts the same claim link");
    assert.equal(second.outcomes[0].targetEvidenceLinkId, 900, "retry upserts the same target link");
    assert.equal(db.claims.size, 1);
    assert.equal(db.claimLinks.size, 1);
    assert.equal(db.targetLinks.size, 1);
    assert.equal(auditOutcomes.length, 3);
    assert.deepEqual(auditOutcomes.map(({ outcome }) => outcome.status), ["persisted", "deduplicated", "persisted"]);
  } finally {
    if (originalFlag === undefined) delete process.env.ENABLE_MULTI_TARGET_EVIDENCE;
    else process.env.ENABLE_MULTI_TARGET_EVIDENCE = originalFlag;
  }
});

test("R9 a post-evidence timeout cannot remove a direct link already committed", async () => {
  const originalFlag = process.env.ENABLE_MULTI_TARGET_EVIDENCE;
  process.env.ENABLE_MULTI_TARGET_EVIDENCE = "true";
  const db = createPersistenceQueryStub();
  const assertion = {
    taskClaimId: 52881,
    evaluationTargetId: 72,
    evaluationTargetType: "substantive",
    quote: "The omitted analysis was statistically significant.",
    stance: "support",
    bearingScore: 0.88,
    referenceContentId: 9001,
    confidence: 0.8,
  };

  try {
    await persistDirectEvidenceAssertions({
      query: db.query,
      taskContentId: 16386,
      aiReferences: [{ referenceContentId: 9001, evidenceAssertions: [assertion] }],
    });
    await assert.rejects(async () => {
      throw new Error("simulated post-evidence extraction timeout");
    }, /timeout/);

    assert.equal(db.claims.size, 1);
    assert.equal(db.claimLinks.size, 1);
    assert.equal(db.targetLinks.size, 1);
  } finally {
    if (originalFlag === undefined) delete process.env.ENABLE_MULTI_TARGET_EVIDENCE;
    else process.env.ENABLE_MULTI_TARGET_EVIDENCE = originalFlag;
  }
});
