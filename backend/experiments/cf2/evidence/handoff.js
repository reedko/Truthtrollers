import { createHash } from "node:crypto";

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const unique = (values) => [...new Set((values ?? []).filter(Boolean))];
const sha256 = (value) => createHash("sha256").update(String(value)).digest("hex");

const RESIDUAL_REPORTING = /\b(?:according to|claims? made in the article|the study|public health claims?)\b/i;
const GENERIC_SOURCE = /^(?:the study|a study|the article|article|unknown)$/i;

function warningsFor(assertion) {
  const warnings = [];
  if (!assertion.sourceName) warnings.push("unresolved_assertion_source");
  if (GENERIC_SOURCE.test(clean(assertion.sourceName))) {
    warnings.push("generic_assertion_source");
  }
  if (RESIDUAL_REPORTING.test(assertion.assertionText)) {
    warnings.push("residual_reporting_or_attribution_frame");
  }
  if (assertion.effectIfTrue === "no_effect") {
    warnings.push("selected_despite_no_thesis_effect");
  }
  if ((assertion.evidenceAnchors ?? []).length === 0) {
    warnings.push("no_named_evidence_anchor");
  }
  return warnings;
}

function contextFor(assertion, candidatesById) {
  const candidate = candidatesById.get(assertion.candidateId);
  const relevantIds = new Set([
    ...(assertion.groundingUnitIds ?? []),
    ...(assertion.sourceUnitIds ?? []),
    ...(assertion.evidenceAnchors ?? []).flatMap((anchor) => anchor.unitIds ?? []),
  ]);
  return (candidate?.contextUnits ?? [])
    .filter((unit) => relevantIds.has(unit.unitId))
    .map((unit) => ({ unitId: unit.unitId, text: unit.text }));
}

export function compileEvidenceFixture(result, fixtureId) {
  if (!result || !Array.isArray(result.assertions)
    || !Array.isArray(result.candidates)) {
    throw new TypeError("CF2 evidence handoff requires a completed CF2 result");
  }
  const candidatesById = new Map(result.candidates
    .map((candidate) => [candidate.candidateId, candidate]));
  const tasks = result.assertions.map((assertion) => ({
    evidenceTaskId: `${fixtureId}:${assertion.candidateId}`,
    fixtureId,
    candidateId: assertion.candidateId,
    assertionText: assertion.assertionText,
    targetText: assertion.assertionText,
    verificationTarget: "substantive",
    articleTreatment: assertion.articleTreatment,
    effectIfTrue: assertion.effectIfTrue,
    scoreTransform: assertion.scoreTransform,
    selectionBasis: assertion.selectionBasis ?? "thesis_effect",
    assertionSource: {
      name: assertion.sourceName ?? null,
      kind: assertion.sourceKind ?? "unknown",
      unitIds: unique(assertion.sourceUnitIds),
      origin: assertion.sourceNameOrigin ?? null,
      basis: assertion.attributionBasis ?? null,
    },
    groundingUnitIds: unique(assertion.groundingUnitIds),
    groundingContext: contextFor(assertion, candidatesById),
    evidenceAnchors: (assertion.evidenceAnchors ?? []).map((anchor) => ({
      name: anchor.name,
      kind: anchor.kind,
      unitIds: unique(anchor.unitIds),
    })),
    warnings: warningsFor(assertion),
    planningStatus: "needs_evidence_need_card",
  }));
  return {
    schemaVersion: "cf2.evidenceFixture.v1",
    fixtureId,
    title: result.article?.title ?? null,
    thesisAssertion: result.thesisAssertion ?? null,
    sourceResultHash: sha256(JSON.stringify(result)),
    selectedAssertionCount: tasks.length,
    tasks,
  };
}
export function compileEvidenceDocket(entries, {
  baselineId = "cf2-v6-c30-p12-locked-20260724",
  codeCommit = null,
} = {}) {
  const fixtures = entries.map(({ fixtureId, result }) =>
    compileEvidenceFixture(result, fixtureId));
  const tasks = fixtures.flatMap((fixture) => fixture.tasks);
  const warningCounts = {};
  for (const warning of tasks.flatMap((task) => task.warnings)) {
    warningCounts[warning] = (warningCounts[warning] ?? 0) + 1;
  }
  return {
    schemaVersion: "cf2.evidenceDocket.v1",
    baselineId,
    codeCommit,
    fixtureCount: fixtures.length,
    taskCount: tasks.length,
    warningCounts,
    fixtures,
  };
}
