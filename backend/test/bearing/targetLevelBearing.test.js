import assert from "node:assert/strict";
import test from "node:test";

// ─── buildTargetBearingContext via extractQuotesAndScoreQuality ───────────────
// We verify the target-level bearing rules reach the LLM prompt correctly by
// capturing what was passed to the llm stub and inspecting the user text.

function makeLlmStub(capturedCalls) {
  return {
    generate: async ({ user, system }) => {
      capturedCalls.push({ user, system });
      return {
        quotes: [
          {
            quote: "CDC researchers removed the subgroup analysis.",
            stance: "support",
            summary: "Describes alleged data manipulation.",
            bearing_score: 0.85,
            bearing_type: "direct",
            claim_component_addressed: "whole_claim",
            causal_strength: "causal",
            bearing_reason: "Directly addresses the alleged omission.",
          },
        ],
        quality: {
          author_transparency: 5,
          publisher_transparency: 5,
          evidence_density: 5,
          claim_specificity: 5,
          correction_behavior: 5,
          original_reporting: 5,
          sensationalism_score: 3,
          monetization_pressure: 3,
          reasoning: "test",
        },
      };
    },
  };
}

const { applyEvaluationTargetGuard, extractQuotesAndScoreQuality } = await import("../../src/utils/extractQuote.js");

// ─── substantive target: rules must appear in prompt ─────────────────────────

test("substantive target: bearing rules appear in LLM user prompt", async () => {
  const calls = [];
  await extractQuotesAndScoreQuality({
    claimText: "William Thompson revealed that CDC manipulated MMR/autism data.",
    evaluationTarget: {
      targetType: "substantive",
      targetText: "CDC researchers improperly altered, omitted, or excluded analyses from the MMR/autism study.",
      subjectEntity: "CDC researchers",
      predicate: "improperly altered, omitted, or excluded",
      objectText: "analyses from MMR/autism study",
      allegedAction: "manipulated",
    },
    fullText: "The CDC removed certain subgroup analyses from the 2004 DeStefano paper.",
    llm: makeLlmStub(calls),
    enablePostScrapeBearing: true,
  });
  assert.equal(calls.length, 1);
  const userPrompt = calls[0].user;
  assert.ok(userPrompt.includes("SUBSTANTIVE BEARING RULES"), "must include substantive rules");
  assert.ok(userPrompt.includes("manipulated"), "must reference alleged action");
  assert.ok(userPrompt.includes("Attribution evidence"), "must note attribution does not bear here");
  assert.ok(userPrompt.includes("EVALUATION TARGET"), "must include target header");
});

// ─── attribution target: rules must appear in prompt ─────────────────────────

test("attribution target: bearing rules appear in LLM user prompt", async () => {
  const calls = [];
  await extractQuotesAndScoreQuality({
    claimText: "William Thompson revealed that data linking MMR to autism had been manipulated.",
    evaluationTarget: {
      targetType: "attribution",
      targetText: "William Thompson made a statement about CDC handling of MMR/autism data.",
      subjectEntity: "William Thompson",
      predicate: "made allegation about",
      objectText: "CDC handling of MMR/autism data",
      allegedAction: null,
    },
    fullText: "Thompson told colleagues that data had been manipulated. He then contacted a congressman.",
    llm: makeLlmStub(calls),
    enablePostScrapeBearing: true,
  });
  const userPrompt = calls[0].user;
  assert.ok(userPrompt.includes("ATTRIBUTION BEARING RULES"), "must include attribution rules");
  assert.ok(userPrompt.includes("William Thompson"), "must reference the speaker entity");
  assert.ok(
    userPrompt.includes("underlying assertion is true does NOT bear"),
    "must note substantive evidence doesn't count",
  );
});

// ─── inference target ─────────────────────────────────────────────────────────

test("inference target: bearing rules appear in LLM user prompt", async () => {
  const calls = [];
  await extractQuotesAndScoreQuality({
    claimText: "CDC concealed evidence of MMR-autism link.",
    evaluationTarget: {
      targetType: "inference",
      targetText: "The alleged manipulation concealed evidence of a link between MMR vaccination and autism.",
      subjectEntity: "CDC",
      predicate: "concealed evidence of",
      objectText: "MMR/autism link",
    },
    fullText: "Studies consistently show no MMR-autism association.",
    llm: makeLlmStub(calls),
    enablePostScrapeBearing: true,
  });
  const userPrompt = calls[0].user;
  assert.ok(userPrompt.includes("INFERENCE BEARING RULES"), "must include inference rules");
  assert.ok(userPrompt.includes("underlying facts occurred does NOT automatically"), "must note fact/inference distinction");
});

// ─── study_identity target ────────────────────────────────────────────────────

test("study_identity target: bearing rules appear in LLM user prompt", async () => {
  const calls = [];
  await extractQuotesAndScoreQuality({
    claimText: "CDC researchers improperly altered analyses from the MMR study.",
    evaluationTarget: {
      targetType: "study_identity",
      targetText: "Resolve the exact MMR/autism study, dataset, population, and disputed analysis.",
      subjectEntity: "CDC",
      predicate: "conducted study on",
      objectText: "MMR vaccine and autism",
    },
    fullText: "The DeStefano 2004 study in Pediatrics examined MMR vaccination timing.",
    llm: makeLlmStub(calls),
    enablePostScrapeBearing: true,
  });
  const userPrompt = calls[0].user;
  assert.ok(userPrompt.includes("STUDY IDENTITY BEARING RULES"), "must include study identity rules");
});

// ─── no evaluationTarget: no target context injected ─────────────────────────

test("no evaluation target: no target bearing context in prompt", async () => {
  const calls = [];
  await extractQuotesAndScoreQuality({
    claimText: "CDC researchers manipulated MMR/autism study data.",
    evaluationTarget: null,
    fullText: "Evidence suggests CDC omitted subgroup analysis.",
    llm: makeLlmStub(calls),
    enablePostScrapeBearing: true,
  });
  const userPrompt = calls[0].user;
  assert.ok(!userPrompt.includes("EVALUATION TARGET"), "must NOT inject target context when no target");
  assert.ok(!userPrompt.includes("SUBSTANTIVE BEARING RULES"), "must not include substantive rules when no target");
});

test("target guard rejects a different actor as refutation of CDC conduct", () => {
  const guarded = applyEvaluationTargetGuard({
    targetType: "substantive",
    subjectEntity: "CDC",
    targetText: "CDC manipulated the MMR study data.",
  }, {
    quote: "Wakefield manipulated the data used in his article.",
    summary: "Wakefield, rather than the CDC, manipulated data.",
    stance: "refute",
    bearing_score: 1,
    bearing_type: "direct",
    claim_component_addressed: "whole_claim",
    bearing_reason: "Names another actor.",
  });
  assert.equal(guarded.stance, "insufficient");
  assert.ok(guarded.bearing_score < 0.25);
  assert.match(guarded.bearing_reason, /actor mismatch/i);
});

test("target guard prevents an allegation from proving the substantive target", () => {
  const guarded = applyEvaluationTargetGuard({
    targetType: "substantive",
    subjectEntity: "CDC",
    targetText: "CDC manipulated the MMR study data.",
  }, {
    quote: "William Thompson claimed that the CDC committed fraud.",
    summary: "Thompson made the allegation.",
    stance: "support",
    bearing_score: 0.9,
    bearing_type: "direct",
    claim_component_addressed: "whole_claim",
    bearing_reason: "Reports the allegation.",
  });
  assert.equal(guarded.stance, "insufficient");
  assert.equal(guarded.claim_component_addressed, "attribution");
  assert.ok(guarded.bearing_score < 0.25);
});

// ─── dualWriteTargetEvidenceLinks: bearing score guard ───────────────────────

const { dualWriteTargetEvidenceLinks } = await import("../../src/core/evaluationTargetStore.js");

function makeQueryStub(targetRows, insertLog) {
  return async (sql, params) => {
    if (sql.includes("claim_evaluation_targets")) {
      return targetRows;
    }
    if (sql.includes("evaluation_target_evidence_links")) {
      insertLog.push(params);
    }
    return [];
  };
}

const env = { ...process.env, ENABLE_MULTI_TARGET_EVIDENCE: "true" };
const origEnv = process.env.ENABLE_MULTI_TARGET_EVIDENCE;
process.env.ENABLE_MULTI_TARGET_EVIDENCE = "true";

test("dualWriteTargetEvidenceLinks: skips match below bearing threshold (0.25)", async () => {
  const insertLog = [];
  const targetRows = [{ evaluation_target_id: 10, claim_id: 1, target_type: "substantive" }];
  const query = makeQueryStub(targetRows, insertLog);

  await dualWriteTargetEvidenceLinks(query, 99, [
    { taskClaimId: 1, referenceClaimId: 200, stance: "support", bearingScore: 0.15, confidence: 0.6, rationale: "weak topical match" },
  ], 55);

  assert.equal(insertLog.length, 0, "must not write link when bearingScore < 0.25");
});

test("dualWriteTargetEvidenceLinks: writes link when bearingScore >= 0.25", async () => {
  const insertLog = [];
  const targetRows = [{ evaluation_target_id: 10, claim_id: 1, target_type: "substantive" }];
  const query = makeQueryStub(targetRows, insertLog);

  await dualWriteTargetEvidenceLinks(query, 99, [
    { taskClaimId: 1, referenceClaimId: 200, stance: "support", bearingScore: 0.72, confidence: 0.8, rationale: "direct match" },
  ], 55);

  assert.equal(insertLog.length, 1, "must write link when bearingScore >= 0.25");
  assert.equal(insertLog[0][0], 10); // evaluationTargetId
  assert.equal(insertLog[0][3], "support"); // stance
});

test("dualWriteTargetEvidenceLinks: routes to correct target type when match carries evaluationTargetType", async () => {
  const insertLog = [];
  const targetRows = [
    { evaluation_target_id: 10, claim_id: 1, target_type: "substantive" },
    { evaluation_target_id: 11, claim_id: 1, target_type: "attribution" },
  ];
  const query = makeQueryStub(targetRows, insertLog);

  await dualWriteTargetEvidenceLinks(query, 99, [
    {
      taskClaimId: 1,
      referenceClaimId: 201,
      stance: "support",
      bearingScore: 0.8,
      confidence: 0.85,
      rationale: "Thompson said so",
      evaluationTargetType: "attribution",
    },
  ], 55);

  assert.equal(insertLog.length, 1);
  assert.equal(insertLog[0][0], 11, "must route to attribution target (id=11), not substantive (id=10)");
});

test("dualWriteTargetEvidenceLinks: all target types are eligible (not just substantive)", async () => {
  const insertLog = [];
  const targetRows = [
    { evaluation_target_id: 12, claim_id: 1, target_type: "inference" },
  ];
  const query = makeQueryStub(targetRows, insertLog);

  await dualWriteTargetEvidenceLinks(query, 99, [
    { taskClaimId: 1, referenceClaimId: 202, stance: "refute", bearingScore: 0.5, confidence: 0.7, rationale: "contradicts inference" },
  ], 55);

  assert.equal(insertLog.length, 1, "inference target must also receive links");
  assert.equal(insertLog[0][0], 12); // inference target id
});

test("dualWriteTargetEvidenceLinks never falls back when an explicit target type is absent", async () => {
  const insertLog = [];
  const query = makeQueryStub([
    { evaluation_target_id: 10, claim_id: 1, target_type: "substantive" },
  ], insertLog);
  await dualWriteTargetEvidenceLinks(query, 99, [{
    taskClaimId: 1,
    referenceClaimId: 203,
    stance: "support",
    bearingScore: 0.9,
    confidence: 0.8,
    evaluationTargetType: "attribution",
  }], 55);
  assert.equal(insertLog.length, 0);
});

process.env.ENABLE_MULTI_TARGET_EVIDENCE = origEnv;
