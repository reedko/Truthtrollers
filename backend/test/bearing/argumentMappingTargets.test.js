import assert from "node:assert/strict";
import test from "node:test";

import { normalizeMappingItem } from "../../src/core/argumentMappingEngine.js";
import {
  normalizeEvaluationTarget,
  enrichTaskClaimsForMatching,
  dualWriteTargetEvidenceLinks,
} from "../../src/core/evaluationTargetStore.js";

// ─── Thompson canonical fixture ──────────────────────────────────────────────

const THOMPSON_CLAIM = {
  id: 52615,
  text: "William Thompson revealed that data linking the MMR vaccine to autism had been manipulated by the CDC.",
  role: "supporting_premise",
  objectText: null,
  speakerEntity: null,
};

const THOMPSON_LLM_RESPONSE_ITEM = {
  claimId: 52615,
  claimText: THOMPSON_CLAIM.text,
  objectClaim: "CDC researchers improperly altered, omitted, or excluded analyses from an MMR/autism study.",
  isAttribution: true,
  speakerEntity: "William Thompson",
  articleStance: "endorses",
  argumentFunction: "supporting_premise",
  scoreTransform: "normal",
  accountabilityEligible: false,
  confidence: 0.88,
  rationale: "Attribution wrapper around a substantive misconduct allegation.",
  targets: [
    {
      targetType: "attribution",
      targetText: "William Thompson made a statement, disclosure, or allegation about CDC handling of MMR/autism data.",
      subjectEntity: "William Thompson",
      predicateText: "made allegation about",
      objectText: "CDC handling of MMR/autism data",
      allegedAction: null,
      studyTitle: null,
      studyAuthors: null,
      studyYear: null,
      studyIdentifier: null,
      populationScope: null,
      sourceExcerpt: "William Thompson revealed that data linking the MMR vaccine to autism had been manipulated by the CDC.",
      articleStance: "endorses",
      scoreTransform: "none",
      searchEligible: true,
      verdictEligible: true,
      resolutionStatus: "mapped",
      mappingConfidence: 0.9,
      mappingRationale: "Whether Thompson made the statement is separate from whether the allegation is true.",
    },
    {
      targetType: "study_identity",
      targetText: "Resolve the exact MMR/autism study, dataset, population, subgroup, and disputed analysis referenced by William Thompson.",
      subjectEntity: "CDC",
      predicateText: "conducted study on",
      objectText: "MMR vaccine and autism",
      allegedAction: null,
      studyTitle: null,
      studyAuthors: null,
      studyYear: null,
      studyIdentifier: null,
      populationScope: null,
      sourceExcerpt: "data linking the MMR vaccine to autism",
      articleStance: "neutral",
      scoreTransform: "none",
      searchEligible: true,
      verdictEligible: false,
      resolutionStatus: "underspecified",
      mappingConfidence: 0.85,
      mappingRationale: "Study identity cannot be resolved from article text alone.",
    },
    {
      targetType: "substantive",
      targetText: "CDC researchers improperly altered, omitted, or excluded analyses from the identified MMR/autism study.",
      subjectEntity: "CDC researchers",
      predicateText: "improperly altered, omitted, or excluded",
      objectText: "analyses from MMR/autism study",
      allegedAction: "manipulated",
      studyTitle: null,
      studyAuthors: null,
      studyYear: null,
      studyIdentifier: null,
      populationScope: null,
      sourceExcerpt: "data linking the MMR vaccine to autism had been manipulated by the CDC",
      articleStance: "endorses",
      scoreTransform: "normal",
      searchEligible: true,
      verdictEligible: true,
      resolutionStatus: "mapped",
      mappingConfidence: 0.87,
      mappingRationale: "Core factual allegation of data manipulation.",
    },
    {
      targetType: "inference",
      targetText: "The alleged manipulation, omission, or exclusion concealed or misrepresented evidence of a link between MMR vaccination and autism.",
      subjectEntity: "CDC",
      predicateText: "concealed evidence of",
      objectText: "MMR/autism link",
      allegedAction: "concealed",
      studyTitle: null,
      studyAuthors: null,
      studyYear: null,
      studyIdentifier: null,
      populationScope: null,
      sourceExcerpt: "data linking the MMR vaccine to autism had been manipulated",
      articleStance: "endorses",
      scoreTransform: "normal",
      searchEligible: true,
      verdictEligible: true,
      resolutionStatus: "mapped",
      mappingConfidence: 0.75,
      mappingRationale: "Article implies concealment of an MMR/autism association.",
    },
  ],
};

// ─── normalizeMappingItem tests ───────────────────────────────────────────────

test("Thompson: normalizeMappingItem returns non-empty targets array", () => {
  const result = normalizeMappingItem(THOMPSON_LLM_RESPONSE_ITEM, THOMPSON_CLAIM);
  assert.ok(Array.isArray(result.targets), "targets must be an array");
  assert.ok(result.targets.length > 0, "targets must not be empty");
});

test("Thompson: at least one attribution target present", () => {
  const result = normalizeMappingItem(THOMPSON_LLM_RESPONSE_ITEM, THOMPSON_CLAIM);
  const attribution = result.targets.filter((t) => t.targetType === "attribution");
  assert.ok(attribution.length >= 1, "expected at least one attribution target");
  assert.ok(
    attribution[0].targetText.includes("William Thompson") || attribution[0].subjectEntity === "William Thompson",
    "attribution target should reference William Thompson",
  );
});

test("Thompson: attribution target does not absorb the substantive allegation", () => {
  const result = normalizeMappingItem(THOMPSON_LLM_RESPONSE_ITEM, THOMPSON_CLAIM);
  const attribution = result.targets.find((t) => t.targetType === "attribution");
  const substantive = result.targets.find((t) => t.targetType === "substantive");
  assert.ok(attribution, "attribution target must exist");
  assert.ok(substantive, "substantive target must exist");
  assert.notEqual(
    attribution.targetText,
    substantive.targetText,
    "attribution and substantive targets must have distinct targetText",
  );
});

test("neutral attribution defaults target transforms independently", () => {
  const result = normalizeMappingItem({
    claimId: 53544,
    objectClaim: "Vaccines are tested more than any other medicine.",
    isAttribution: true,
    speakerEntity: "Jefferson County Public Health",
    articleStanceTowardObjectClaim: "neutral",
    argumentFunction: "reported_neutral",
    scoreTransform: "none",
    targets: [
      { targetType: "attribution", targetText: "Jefferson County Public Health made the statement." },
      { targetType: "substantive", targetText: "Vaccines are tested more than any other medicine." },
    ],
  }, {
    id: 53544,
    text: "Jefferson County Public Health states that vaccines are tested more than any other medicine.",
  });
  assert.equal(result.targets.find((target) => target.targetType === "attribution").scoreTransform, "none");
  assert.equal(result.targets.find((target) => target.targetType === "substantive").scoreTransform, "review");
});

test("Thompson: at least one substantive target with allegedAction populated", () => {
  const result = normalizeMappingItem(THOMPSON_LLM_RESPONSE_ITEM, THOMPSON_CLAIM);
  const substantive = result.targets.find((t) => t.targetType === "substantive");
  assert.ok(substantive, "substantive target must exist");
  assert.ok(substantive.allegedAction && substantive.allegedAction.length > 0, "substantive target must have allegedAction");
});

test("Thompson: study_identity target is not verdict-eligible", () => {
  const result = normalizeMappingItem(THOMPSON_LLM_RESPONSE_ITEM, THOMPSON_CLAIM);
  const studyId = result.targets.find((t) => t.targetType === "study_identity");
  assert.ok(studyId, "study_identity target must exist");
  assert.equal(studyId.verdictEligible, false, "study_identity target must not be verdict-eligible");
});

test("Thompson: study_identity target is search-eligible and underspecified", () => {
  const result = normalizeMappingItem(THOMPSON_LLM_RESPONSE_ITEM, THOMPSON_CLAIM);
  const studyId = result.targets.find((t) => t.targetType === "study_identity");
  assert.ok(studyId, "study_identity target must exist");
  assert.equal(studyId.searchEligible, true, "study_identity target must be search-eligible");
  assert.equal(studyId.resolutionStatus, "underspecified");
});

test("Thompson: isAttribution is true and speakerEntity resolved", () => {
  const result = normalizeMappingItem(THOMPSON_LLM_RESPONSE_ITEM, THOMPSON_CLAIM);
  assert.equal(result.isAttribution, true);
  assert.equal(result.speakerEntity, "William Thompson");
});

test("Thompson: articleStance accepted from camelCase articleStance field", () => {
  const result = normalizeMappingItem(THOMPSON_LLM_RESPONSE_ITEM, THOMPSON_CLAIM);
  assert.equal(result.articleStance, "endorses");
});

test("Thompson: predicateText stored via normalizeEvaluationTarget", () => {
  const raw = THOMPSON_LLM_RESPONSE_ITEM.targets[2];
  const normalized = normalizeEvaluationTarget(raw, { contentId: 16337, claimId: 52615 });
  assert.ok(
    normalized.predicate && normalized.predicate.length > 0,
    "predicate must be populated from predicateText",
  );
  assert.equal(normalized.predicate, raw.predicateText);
});

// ─── Fallback: auto-add substantive when LLM omits targets ───────────────────

test("fallback: auto-adds substantive target when LLM returns no targets array", () => {
  const rawWithoutTargets = {
    claimId: 52615,
    objectClaim: "CDC manipulated data.",
    isAttribution: false,
    articleStance: "endorses",
    argumentFunction: "supporting_premise",
    scoreTransform: "normal",
  };
  const result = normalizeMappingItem(rawWithoutTargets, THOMPSON_CLAIM);
  assert.ok(result.targets.length >= 1, "must auto-add a target");
  assert.ok(result.targets.some((t) => t.targetType === "substantive"), "auto-added target must be substantive");
});

test("fallback: auto-adds attribution target when isAttribution true but targets omit it", () => {
  const rawAttributionNoTargets = {
    claimId: 52615,
    objectClaim: "CDC manipulated data.",
    isAttribution: true,
    speakerEntity: "William Thompson",
    articleStance: "endorses",
    argumentFunction: "supporting_premise",
    scoreTransform: "normal",
  };
  const result = normalizeMappingItem(rawAttributionNoTargets, THOMPSON_CLAIM);
  assert.ok(result.targets.some((t) => t.targetType === "attribution"), "must auto-add attribution target");
  assert.ok(result.targets.some((t) => t.targetType === "substantive"), "must also have substantive target");
});

// ─── enrichTaskClaimsForMatching ─────────────────────────────────────────────

test("enrichTaskClaimsForMatching substitutes substantive target text as claim text", async () => {
  const query = async (sql) => {
    if (sql.includes("claim_evaluation_targets")) return [
      {
        evaluation_target_id: 10,
        content_id: 16337,
        claim_id: 52615,
        target_type: "attribution",
        target_text: "William Thompson made an allegation about CDC data handling.",
        target_order: 0,
      },
      {
        evaluation_target_id: 11,
        content_id: 16337,
        claim_id: 52615,
        target_type: "substantive",
        target_text: "CDC researchers improperly altered analyses.",
        target_order: 1,
      },
    ];
    return [];
  };
  process.env.ENABLE_MULTI_TARGET_EVIDENCE = "true";
  const taskClaims = [{ id: 52615, text: THOMPSON_CLAIM.text }];
  const enriched = await enrichTaskClaimsForMatching(query, 16337, taskClaims);
  assert.equal(enriched[0].text, "CDC researchers improperly altered analyses.");
});

test("enrichTaskClaimsForMatching returns original when no targets exist", async () => {
  const query = async (sql) => {
    if (sql.includes("claim_evaluation_targets")) return [];
    return [];
  };
  process.env.ENABLE_MULTI_TARGET_EVIDENCE = "true";
  const taskClaims = [{ id: 99999, text: "Some claim." }];
  const enriched = await enrichTaskClaimsForMatching(query, 16337, taskClaims);
  assert.equal(enriched[0].text, "Some claim.");
});

// ─── dualWriteTargetEvidenceLinks ─────────────────────────────────────────────

test("dualWriteTargetEvidenceLinks inserts correct row for a matched claim", async () => {
  const insertedRows = [];
  const query = async (sql, params) => {
    if (sql.includes("FROM claim_evaluation_targets")) {
      return [{ evaluation_target_id: 11, claim_id: 52615 }];
    }
    if (sql.includes("INSERT INTO evaluation_target_evidence_links")) {
      insertedRows.push(params);
      return { insertId: 101 };
    }
    return [];
  };
  process.env.ENABLE_MULTI_TARGET_EVIDENCE = "true";
  const claimMatches = [
    {
      taskClaimId: 52615,
      referenceClaimId: 77,
      stance: "supports",
      bearingScore: 0.82,
      confidence: 0.75,
      rationale: "Reference directly confirms CDC data handling allegation.",
    },
  ];
  await dualWriteTargetEvidenceLinks(query, 16337, claimMatches, 9999);
  assert.equal(insertedRows.length, 1, "expected exactly one INSERT");
  const [row] = insertedRows;
  assert.equal(row[0], 11, "evaluation_target_id");
  assert.equal(row[1], 9999, "reference_content_id");
  assert.equal(row[2], 77, "reference_claim_id");
  assert.equal(row[3], "support", "stance normalized from 'supports'");
  assert.ok(row[4] >= 0 && row[4] <= 1, "bearing_score in [0,1]");
});

test("dualWriteTargetEvidenceLinks normalizes 'refutes' stance to 'refute'", async () => {
  const insertedRows = [];
  const query = async (sql, params) => {
    if (sql.includes("FROM claim_evaluation_targets")) return [{ evaluation_target_id: 11, claim_id: 52615 }];
    if (sql.includes("INSERT INTO evaluation_target_evidence_links")) { insertedRows.push(params); return { insertId: 102 }; }
    return [];
  };
  process.env.ENABLE_MULTI_TARGET_EVIDENCE = "true";
  const claimMatches = [{ taskClaimId: 52615, referenceClaimId: 78, stance: "refutes", bearingScore: 0.6, confidence: 0.7, rationale: "" }];
  await dualWriteTargetEvidenceLinks(query, 16337, claimMatches, 9999);
  assert.equal(insertedRows[0][3], "refute");
});

test("dualWriteTargetEvidenceLinks is a no-op when flag is off", async () => {
  const calls = [];
  const query = async (sql) => { calls.push(sql); return []; };
  process.env.ENABLE_MULTI_TARGET_EVIDENCE = "false";
  await dualWriteTargetEvidenceLinks(query, 16337, [{ taskClaimId: 1 }], 9999);
  assert.equal(calls.length, 0, "no DB calls when flag is off");
  process.env.ENABLE_MULTI_TARGET_EVIDENCE = "true";
});
