import assert from "node:assert/strict";
import test from "node:test";
import {
  compileAdjudication,
  compilationSummary,
  validateCompiledCandidate,
  validateCompilationInputs,
} from "../lib/adjudication-compiler.mjs";

function argument(id, proposition) {
  return {
    argumentUnitId: id,
    grounding: { sourceUnitIds: [`U${id.slice(2).padStart(4, "0")}`], verbatimExcerpt: proposition },
    canonicalAtomicProposition: proposition,
    scopeQualifiers: [],
    assertionSource: { kind: "article_voice", name: "article voice", sourceUnitIds: [], basis: "draft" },
    articleTreatment: {
      contentStance: "supports_thesis",
      deployment: "endorsed",
      role: "pillar_support",
      basis: "draft",
    },
    evidenceTarget: {
      disputedProposition: proposition,
      verificationQuestion: proposition,
      supportWouldRequire: ["draft"],
      refuteWouldRequire: ["draft"],
      qualifyWouldRequire: ["draft"],
      warrant: "draft",
    },
    portfolio: { include: true, basis: "draft" },
    notes: "",
  };
}

function syntheticInputs() {
  const fixtureId = "CF1-F01";
  const draft = {
    schemaVersion: "cf1.argumentDraft.v1",
    fixtureId,
    orientation: {
      theme: "theme",
      thesis: "thesis",
      thesisStatus: "clear",
      thesisHinge: { proposition: "hinge", ifSupportedEffectOnThesis: "strengthens", ifRefutedEffectOnThesis: "weakens" },
      basisSourceUnitIds: ["U0001"],
      notes: "",
    },
    passageCoverage: [
      { coverageId: "COV001", sourceUnitIds: ["U0001"], classification: "material_assertion_present", argumentUnitIds: ["AU001"], basis: "draft" },
      { coverageId: "COV002", sourceUnitIds: ["U0002"], classification: "material_assertion_present", argumentUnitIds: ["AU002"], basis: "draft" },
      { coverageId: "COV003", sourceUnitIds: ["U0003"], classification: "material_assertion_present", argumentUnitIds: ["AU003"], basis: "draft" },
    ],
    argumentUnits: [argument("AU001", "Alpha and beta."), argument("AU002", "Gamma."), argument("AU003", "Delta.")],
    relations: [
      { relationId: "REL001", fromArgumentUnitId: "AU001", type: "supports", toArgumentUnitId: "AU002", sourceUnitIds: ["U0001"], basis: "draft" },
      { relationId: "REL002", fromArgumentUnitId: "AU002", type: "supports", toArgumentUnitId: "AU003", sourceUnitIds: ["U0002"], basis: "draft" },
    ],
    consistencyFindings: [
      { findingId: "CON001", argumentUnitIds: ["AU001", "AU002"], type: "tension", basis: "draft" },
    ],
  };
  const form = {
    schemaVersion: "cf1.argumentAnnotation.v1",
    fixture: { fixtureId },
    adjudication: { status: "draft", approvedAt: null, notes: "" },
    rubricCoverage: { targets: [], prohibitedInterpretations: [], inheritedReviewNotes: [] },
  };
  const review = {
    schemaVersion: "cf1.argumentDraftReviewDecisions.v1",
    exportedAt: "2026-07-22T00:00:00.000Z",
    decisions: {
      [`${fixtureId}:fixture`]: { decision: "accept" },
      [`${fixtureId}:orientation`]: { decision: "accept" },
      [`${fixtureId}:argument:AU001`]: {
        decision: "split",
        correctedProposition: "Alpha.\nBeta.",
        portfolioInclude: "false",
        notes: "Split atomically.",
      },
      [`${fixtureId}:argument:AU002`]: {
        decision: "edit",
        correctedDeployment: "opponent_to_rebut",
        correctedAssertionSourceKind: "institution",
        correctedAssertionSourceName: "Example Institute",
        notes: "Corrected labels.",
      },
      [`${fixtureId}:argument:AU003`]: { decision: "remove", notes: "Remove this row." },
    },
  };
  return {
    fixtures: [{ draft, form, draftSha256: "draft", formSha256: "form", reviewSha256: "review" }],
    review,
  };
}

test("compiles edits and splits without guessing affected relations", () => {
  const inputs = syntheticInputs();
  const result = compileAdjudication({ ...inputs, generatedAt: "2026-07-22T00:00:00.000Z" });
  assert.deepEqual(result.blockers, []);
  const candidate = result.compiledFixtures[0].candidate;
  assert.deepEqual(candidate.argumentUnits.map((item) => item.argumentUnitId), ["AU001-S01", "AU001-S02", "AU002"]);
  assert.equal(candidate.argumentUnits[0].portfolio.include, false);
  assert.equal(candidate.argumentUnits[2].assertionSource.name, "Example Institute");
  assert.equal(candidate.argumentUnits[2].articleTreatment.deployment, "opponent_to_rebut");
  assert.equal(candidate.argumentUnits[0].evidenceTarget.warrant, "");
  assert.deepEqual(candidate.passageCoverage[0].argumentUnitIds, ["AU001-S01", "AU001-S02"]);
  assert.equal(candidate.passageCoverage[2].classification, "uncertain");
  assert.equal(candidate.relations.length, 0);
  assert.equal(result.reviewQueue.relations.length, 2);
  assert.equal(result.reviewQueue.consistencyFindings.length, 1);
  assert.equal(result.reviewQueue.splitChildren.length, 2);
  assert.equal(result.reviewQueue.splitChildren[0].fixtureId, "CF1-F01");
  assert.equal(result.reviewQueue.passageCoverage.length, 1);
  assert.equal(candidate.adjudication.status, "draft");
  assert.deepEqual(validateCompiledCandidate(candidate), []);
  assert.equal(compilationSummary(result).argumentUnitCount, 3);
});

test("fails closed when decision notes contradict removal", () => {
  const inputs = syntheticInputs();
  inputs.review.decisions["CF1-F01:argument:AU003"] = {
    decision: "remove",
    notes: "Accept the source-grounded substantive assertion.",
  };
  const validation = validateCompilationInputs(inputs);
  assert.equal(validation.blockers.some((blocker) => blocker.code === "decision_note_conflict"), true);
  const result = compileAdjudication(inputs);
  assert.equal(result.compiledFixtures.length, 0);
});

test("requires exact decision-key coverage", () => {
  const inputs = syntheticInputs();
  delete inputs.review.decisions["CF1-F01:argument:AU002"];
  inputs.review.decisions["CF1-F01:argument:AU999"] = { decision: "accept" };
  const validation = validateCompilationInputs(inputs);
  assert.equal(validation.blockers.some((blocker) => blocker.code === "missing_decision_key"), true);
  assert.equal(validation.blockers.some((blocker) => blocker.code === "unknown_decision_key"), true);
});

test("explicit resolution overlay can resolve a blocker without mutating the review export", () => {
  const inputs = syntheticInputs();
  inputs.review.decisions["CF1-F01:argument:AU003"] = {
    decision: "remove",
    notes: "Accept the source-grounded substantive assertion.",
  };
  const overlay = {
    schemaVersion: "cf1.adjudicationResolutions.v1",
    resolutions: {
      "CF1-F01:argument:AU003": {
        decision: "accept",
        notes: "Explicit adjudicator resolution: the prior remove decision was incorrect; retain the assertion.",
      },
    },
  };
  const result = compileAdjudication({ ...inputs, resolutionOverlay: overlay });
  assert.deepEqual(result.blockers, []);
  assert.equal(result.compiledFixtures[0].candidate.argumentUnits.some((item) => item.argumentUnitId === "AU003"), true);
});

test("compiled-candidate validator catches dangling references and evidence leakage", () => {
  const inputs = syntheticInputs();
  const result = compileAdjudication(inputs);
  const candidate = structuredClone(result.compiledFixtures[0].candidate);
  candidate.relations.push({
    relationId: "REL999",
    fromArgumentUnitId: "AU999",
    type: "supports",
    toArgumentUnitId: "AU002",
    sourceUnitIds: [],
    basis: "invalid",
  });
  candidate.argumentUnits[0].evidenceTarget.warrant = "unreviewed";
  const errors = validateCompiledCandidate(candidate);
  assert.equal(errors.some((error) => error.code === "dangling_compiled_relation_reference"), true);
  assert.equal(errors.some((error) => error.code === "unreviewed_evidence_leaked_into_candidate"), true);
});
