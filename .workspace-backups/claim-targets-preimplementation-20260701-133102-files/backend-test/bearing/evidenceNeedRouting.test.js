import test from "node:test";
import assert from "node:assert/strict";

import { ClaimExtractor } from "../../src/core/claimsEngine.js";
import {
  buildEvidenceNeedV1,
  buildEvidenceTargetQueries,
  queryPreservesNumericScope,
  validateEvidenceTargetQuery,
  validateEvidenceNeed,
} from "../../src/core/evidenceNeed.js";
import {
  addEvidenceTargetProvenance,
  buildEvidenceQueryContexts,
  buildSearchTargets,
  isEvidenceTargetRoutingEnabled,
} from "../../src/core/runEvidenceEngine.js";
import { EvidenceEngine } from "../../src/core/evidenceEngine.js";

test("claim extraction preserves assertion and fallibility metadata", async () => {
  const claimText = "Agency X omitted the 2024 subgroup data.";
  const extractor = new ClaimExtractor({
    generate: async () => ({
      reasoningStack: {
        thesis: "Agency X reported incomplete results.",
        pillars: [],
        evidenceClaims: [{
          id: "E1",
          text: claimText,
          role: "evidence",
          evidenceType: "dataset",
          namedEntities: ["Agency X"],
          dates: ["2024"],
        }],
        backgroundClaims: [],
        fallibilityCriticalClaims: [{
          id: "F1",
          text: claimText,
          role: "fallibility_critical",
          claimKind: "data_manipulation",
          whyCritical: "The argument depends on the alleged omission.",
        }],
        searchAssertions: [{
          assertion: claimText,
          query: "Agency X 2024 omitted subgroup data",
          derivedFromClaimText: claimText,
          searchIntent: "both",
          mustIncludeTerms: ["Agency X", "2024"],
        }],
      },
    }),
  });
  extractor.loadClaimExtractionPrompts = async () => ({
    system: "Extract claims",
    user: "Return JSON",
    parameters: { max_claims: 12 },
  });

  const result = await extractor.analyzeChunk({
    chunk: claimText,
    tokenLength: 20,
    incomingTestimonials: [],
  });
  const preserved = result.claimsDetailed.find((claim) => claim.text === claimText);

  assert.equal(preserved.evidenceType, "dataset");
  assert.equal(preserved.claimKind, "data_manipulation");
  assert.equal(preserved.isFallibilityCritical, true);
  assert.deepEqual(preserved.namedEntities, ["Agency X"]);
  assert.equal(preserved.searchAssertions.length, 1);
  assert.equal(result.reasoningStack.searchAssertions[0].query, "Agency X 2024 omitted subgroup data");
});

test("mapped object claim is authoritative and assertions produce typed target queries", () => {
  const need = buildEvidenceNeedV1({
    id: 42,
    text: "A commentator said the broad wrapper claim.",
    objectClaim: "Agency X omitted the 2024 subgroup data.",
    evidenceType: "dataset",
    claimKind: "data_manipulation",
    searchAssertions: [{
      id: "sa-1",
      assertion: "Agency X omitted the 2024 subgroup data.",
      query: "Agency X 2024 omitted subgroup data",
      searchIntent: "both",
      mustIncludeTerms: ["Agency X", "2024"],
    }],
  });

  assert.equal(need.effectiveClaimText, "Agency X omitted the 2024 subgroup data.");
  assert.equal(need.derivation.method, "search_assertions_v1");
  assert.equal(validateEvidenceNeed(need).valid, true);
  assert.deepEqual(buildEvidenceTargetQueries(need, 3), [{
    query: "Agency X 2024 omitted subgroup data",
    intent: "both",
    stanceGoal: "both",
    matchedPart: "search_assertion",
    evidenceTargetId: "sa-1",
    evidenceTargetType: "dataset",
    bearingRequirement: "direct_truth_value",
  }]);
});

test("missing assertions retain a safe legacy fallback with provenance", () => {
  const claim = { id: 7, text: "The 2023 report found a 20 percent increase." };
  const need = buildEvidenceNeedV1(claim);
  const legacy = buildSearchTargets(claim);
  const routed = addEvidenceTargetProvenance(legacy, need);

  assert.deepEqual(routed.map(({ stanceGoal, evidenceTargetId, evidenceTargetType, bearingRequirement, ...rest }) => rest), legacy);
  assert.ok(routed.every((target) => target.stanceGoal && target.evidenceTargetId));
  assert.ok(routed.every((target) => target.evidenceTargetType && target.bearingRequirement));
});

test("legacy fallback does not turn sentence-opening words into identity queries", () => {
  for (const claimText of [
    "Each year, about 1 out of every 100 babies born has a heart defect.",
    "Early detection is of critical importance and can increase survival rates.",
    "Congenital heart defects are the most common birth defect.",
  ]) {
    const queries = buildSearchTargets({ text: claimText }).map((target) => target.query);
    assert.deepEqual(queries, [claimText]);
  }
});

test("targeted query validation rejects generic output and preserves exact scope", () => {
  const need = buildEvidenceNeedV1({
    id: 8,
    text: "21% of children requiring cardiac surgery are under 1 month old.",
  });

  assert.equal(validateEvidenceTargetQuery(need, "Early").valid, false);
  assert.equal(validateEvidenceTargetQuery(need, "general research data").valid, false);
  assert.equal(
    validateEvidenceTargetQuery(need, "pediatric cardiac surgery patient age distribution registry").valid,
    true,
  );
  assert.equal(queryPreservesNumericScope(need, "cardiac surgery age distribution"), false);
  assert.equal(queryPreservesNumericScope(need, "21 percent cardiac surgery patients under 1 month"), true);
});

test("misconduct claims search the allegation, corroboration, and underlying study", () => {
  const text = "CDC officials ordered scientists to destroy evidence from the 2004 MMR autism study.";
  const need = buildEvidenceNeedV1({ id: 15, text });
  const targets = buildEvidenceTargetQueries(need, 6);

  assert.equal(need.claimType, "misconduct");
  assert.deepEqual(
    targets.map((target) => target.evidenceTargetId),
    ["misconduct-primary", "misconduct-corroboration", "misconduct-underlying-study"],
  );
  assert.deepEqual(
    targets.map((target) => target.evidenceTargetType),
    ["primary_source", "official_statement", "original_study"],
  );
  assert.equal(targets[2].bearingRequirement, "warrant_test");
  assert.match(targets[2].query, /methodology data analysis confounding/);
});

test("query contexts provide bounded case-level subject clues", () => {
  const contexts = buildEvidenceQueryContexts([
    { id: 1, text: "Congenital heart defects are the most common birth defect." },
    { id: 2, text: "Children with congenital heart defects may require surgery." },
    { id: 3, text: "Early detection can increase survival rates." },
  ]);

  assert.ok(contexts[3].caseSubjectTerms.includes("congenital"));
  assert.ok(contexts[3].caseSubjectTerms.includes("heart"));
  assert.equal(contexts[3].relatedCaseClaims.length, 2);
});

test("an unaligned assertion is rejected after authoritative mapping", () => {
  const need = buildEvidenceNeedV1({
    text: "A wrapper claim about weather.",
    objectClaim: "Agency X omitted the 2024 subgroup data.",
    searchAssertions: [{
      query: "unrelated football transfer rumors",
      assertion: "A player may change clubs.",
      searchIntent: "both",
    }],
  });

  assert.equal(need.searchAssertionCount, 0);
  assert.equal(need.derivation.method, "deterministic_v1");
  assert.ok(need.derivation.warnings.includes("invalid_or_unaligned_search_assertions_ignored"));
  assert.equal(buildEvidenceTargetQueries(need, 3)[0].matchedPart, "object_claim");
});

test("direct target queries preserve order and remain capped in balanced mode", async () => {
  let llmCalls = 0;
  const engine = new EvidenceEngine({ llm: { generate: async () => { llmCalls += 1; return { queries: [] }; } } });
  const searchTargets = [1, 2, 3, 4].map((index) => ({
    query: `query-${index}`,
    intent: "both",
    stanceGoal: "both",
    matchedPart: "search_assertion",
    evidenceTargetId: `target-${index}`,
    evidenceTargetType: "original_study",
    bearingRequirement: "warrant_test",
  }));
  const queries = await engine.generateQueries(
    { id: 9, text: "Claim", searchTargets },
    {},
    3,
    { enableBalancedSearch: true, supportQueries: 3, refuteQueries: 3, nuanceQueries: 3 },
  );

  assert.deepEqual(queries.map((query) => query.query), ["query-1", "query-2", "query-3"]);
  assert.ok(queries.every((query) => query.evidenceTargetId && query.stanceGoal && query.bearingRequirement));
  assert.equal(llmCalls, 0);
});

test("assertion targets run first and target-aware generation fills remaining slots", async () => {
  const calls = [];
  const engine = new EvidenceEngine({
    llm: {
      generate: async (request) => {
        calls.push(request);
        return { queries: [
          {
            query: "congenital heart surgery age distribution registry",
            evidenceTargetId: "data",
            evidenceTargetType: "dataset",
            stanceGoal: "open",
            bearingRequirement: "direct_truth_value",
          },
          {
            query: "pediatric cardiac surgery age cohort study",
            evidenceTargetId: "study",
            evidenceTargetType: "original_study",
            stanceGoal: "open",
            bearingRequirement: "direct_truth_value",
          },
        ] };
      },
    },
  });
  const evidenceNeed = {
    evidenceTargets: [
      { id: "assertion", evidenceTargetType: "dataset", stanceGoal: "open", bearingRequirement: "direct_truth_value" },
      { id: "data", evidenceTargetType: "dataset", stanceGoal: "open", bearingRequirement: "direct_truth_value" },
      { id: "study", evidenceTargetType: "original_study", stanceGoal: "open", bearingRequirement: "direct_truth_value" },
    ],
  };
  const queries = await engine.generateQueries({
    id: 10,
    text: "21% of children requiring cardiac surgery are under 1 month old.",
    evidenceNeed,
    searchTargets: [{
      query: "21 percent pediatric cardiac surgery under one month",
      matchedPart: "search_assertion",
      evidenceTargetId: "assertion",
      evidenceTargetType: "dataset",
      stanceGoal: "open",
      bearingRequirement: "direct_truth_value",
    }],
  }, {}, 3);

  assert.deepEqual(queries.map((query) => query.query), [
    "21 percent pediatric cardiac surgery under one month",
    "congenital heart surgery age distribution registry",
    "pediatric cardiac surgery age cohort study",
  ]);
  assert.equal(calls.length, 1);
  assert.match(calls[0].user, /Produce at most 2 precise queries/);
  assert.doesNotMatch(calls[0].user, /\"id\":\"assertion\"/);
});

test("missing assertions invoke target-aware generation before legacy fallback", async () => {
  let llmCalls = 0;
  const engine = new EvidenceEngine({
    llm: {
      generate: async () => {
        llmCalls += 1;
        return { queries: [{
          query: "pediatric cardiac surgery patient age distribution registry",
          evidenceTargetId: "method-or-data",
          evidenceTargetType: "dataset",
          stanceGoal: "open",
          bearingRequirement: "warrant_test",
        }] };
      },
    },
  });
  const claim = {
    id: 12,
    text: "21% of children requiring cardiac surgery are under 1 month old.",
    searchAssertions: [],
  };
  claim.evidenceNeed = buildEvidenceNeedV1(claim);
  claim.searchTargets = [];
  claim.fallbackSearchTargets = addEvidenceTargetProvenance(buildSearchTargets(claim), claim.evidenceNeed);

  const queries = await engine.generateQueries(claim, {}, 3);

  assert.equal(llmCalls, 1);
  assert.deepEqual(queries.map((query) => query.query), [
    claim.text,
    "pediatric cardiac surgery patient age distribution registry",
  ]);
  assert.ok(queries.some((query) => query.query !== claim.text));
});

test("routing rollback retains legacy direct-target behavior", async () => {
  let llmCalls = 0;
  const engine = new EvidenceEngine({
    llm: { generate: async () => { llmCalls += 1; return { queries: [] }; } },
  });
  const queries = await engine.generateQueries({
    id: 13,
    text: "Claim text",
    searchTargets: [{ query: "legacy direct query", intent: "both" }],
  }, {}, 3);

  assert.deepEqual(queries.map((query) => query.query), ["legacy direct query"]);
  assert.equal(llmCalls, 0);
});

test("target-aware generation failure uses safe legacy fallback", async () => {
  const engine = new EvidenceEngine({
    llm: { generate: async () => { throw new Error("query model unavailable"); } },
  });
  const claimText = "Early detection is of critical importance and can increase survival rates.";
  const evidenceNeed = buildEvidenceNeedV1({ id: 11, text: claimText });
  const fallbackSearchTargets = addEvidenceTargetProvenance(buildSearchTargets({ text: claimText }), evidenceNeed);
  const queries = await engine.generateQueries({
    id: 11,
    text: claimText,
    evidenceNeed,
    searchTargets: [],
    fallbackSearchTargets,
  }, {}, 3);

  assert.deepEqual(queries.map((query) => query.query), [claimText]);
});

test("target routing has an immediate environment rollback", () => {
  assert.equal(isEvidenceTargetRoutingEnabled({}), true);
  assert.equal(isEvidenceTargetRoutingEnabled({ ENABLE_EVIDENCE_TARGET_QUERIES: "false" }), false);
});
