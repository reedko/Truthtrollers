import crypto from "node:crypto";

const VALID_DECISIONS = new Set(["accept", "edit", "split", "remove"]);
const VALID_DEPLOYMENTS = new Set([
  "endorsed",
  "opponent_to_rebut",
  "rebutted",
  "qualified",
  "reported_neutral",
  "unclear",
]);
const VALID_STANCES = new Set(["supports_thesis", "contradicts_thesis", "neutral", "unclear"]);
const VALID_ROLES = new Set([
  "pillar",
  "pillar_support",
  "opponent_claim",
  "rebuttal",
  "qualification",
  "context",
  "unclear",
]);
const VALID_SOURCE_KINDS = new Set([
  "article_voice",
  "person",
  "institution",
  "document",
  "study",
  "legal_party",
  "unknown",
]);

function clone(value) {
  return structuredClone(value);
}

function normalizeText(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function sha256(value) {
  const input = typeof value === "string" ? value : JSON.stringify(value);
  return crypto.createHash("sha256").update(input).digest("hex");
}

function parsePortfolioInclude(value, key, blockers) {
  if (value === undefined) return undefined;
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  blockers.push({
    code: "invalid_portfolio_value",
    key,
    message: `portfolioInclude must be true or false, received ${JSON.stringify(value)}`,
  });
  return undefined;
}

function splitPropositions(value) {
  return String(value ?? "")
    .split(/\r?\n+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function emptyEvidenceTarget() {
  return {
    disputedProposition: "",
    verificationQuestion: "",
    supportWouldRequire: [],
    refuteWouldRequire: [],
    qualifyWouldRequire: [],
    warrant: "",
  };
}

function expectedDecisionKeys(fixtures) {
  const keys = new Set();
  for (const fixture of fixtures) {
    const fixtureId = fixture.draft.fixtureId;
    keys.add(`${fixtureId}:fixture`);
    keys.add(`${fixtureId}:orientation`);
    for (const argument of fixture.draft.argumentUnits) {
      keys.add(`${fixtureId}:argument:${argument.argumentUnitId}`);
    }
  }
  return keys;
}

function validateDecisionShape(key, value, blockers, warnings) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    blockers.push({ code: "invalid_decision_object", key, message: "Decision must be an object." });
    return;
  }
  if (!VALID_DECISIONS.has(value.decision)) {
    blockers.push({
      code: "invalid_decision",
      key,
      message: `Unsupported decision ${JSON.stringify(value.decision)}.`,
    });
  }
  if (value.correctedDeployment && !VALID_DEPLOYMENTS.has(value.correctedDeployment)) {
    blockers.push({ code: "invalid_deployment", key, message: value.correctedDeployment });
  }
  if (value.correctedContentStance && !VALID_STANCES.has(value.correctedContentStance)) {
    blockers.push({ code: "invalid_stance", key, message: value.correctedContentStance });
  }
  if (value.correctedRole && !VALID_ROLES.has(value.correctedRole)) {
    blockers.push({ code: "invalid_role", key, message: value.correctedRole });
  }
  if (value.correctedAssertionSourceKind && !VALID_SOURCE_KINDS.has(value.correctedAssertionSourceKind)) {
    blockers.push({ code: "invalid_source_kind", key, message: value.correctedAssertionSourceKind });
  }

  const kind = key.split(":")[1];
  if (kind !== "argument") {
    const correctionFields = [
      "correctedProposition",
      "correctedDeployment",
      "correctedContentStance",
      "correctedRole",
      "correctedAssertionSourceKind",
      "correctedAssertionSourceName",
      "portfolioInclude",
    ];
    const present = correctionFields.filter((field) => value[field] !== undefined);
    if (present.length) {
      blockers.push({
        code: "correction_on_non_argument",
        key,
        message: `Argument correction fields are not valid here: ${present.join(", ")}.`,
      });
    }
  }

  if (value.decision === "split") {
    const propositions = splitPropositions(value.correctedProposition);
    if (propositions.length < 2) {
      blockers.push({
        code: "invalid_split",
        key,
        message: "A split requires at least two non-empty corrected propositions.",
      });
    }
    const normalized = propositions.map(normalizeText);
    if (new Set(normalized).size !== normalized.length) {
      blockers.push({ code: "duplicate_split_children", key, message: "Split children must be distinct." });
    }
  }

  if (value.decision === "edit") {
    const correctionFields = [
      "correctedProposition",
      "correctedDeployment",
      "correctedContentStance",
      "correctedRole",
      "correctedAssertionSourceKind",
      "correctedAssertionSourceName",
      "portfolioInclude",
    ];
    if (!correctionFields.some((field) => value[field] !== undefined)) {
      blockers.push({ code: "empty_edit", key, message: "Edit decision contains no explicit correction." });
    }
  }

  const notes = normalizeText(value.notes);
  if (value.decision === "remove" && /\baccept\b.*\bassertion\b/.test(notes)) {
    blockers.push({
      code: "decision_note_conflict",
      key,
      message: "Decision says remove while reviewer notes say to accept the assertion.",
    });
  }
  if (
    value.decision === "accept" &&
    (/\b(remove|delete)\s+(this|the)\s+(row|assertion)\b/.test(notes) ||
      /\bdo not (retain|use)\s+(this|the)\s+(row|assertion)\b/.test(notes))
  ) {
    blockers.push({
      code: "decision_note_conflict",
      key,
      message: "Decision says accept while reviewer notes say to remove the assertion.",
    });
  }
  if (value.assistantSuggestionApplied && value.assistantSuggestionDismissed) {
    warnings.push({
      code: "suggestion_state_conflict",
      key,
      message: "Both assistantSuggestionApplied and assistantSuggestionDismissed are set.",
    });
  }
}

export function validateCompilationInputs({ fixtures, review, resolutionOverlay = null }) {
  const blockers = [];
  const warnings = [];
  if (review.schemaVersion !== "cf1.argumentDraftReviewDecisions.v1") {
    blockers.push({
      code: "unsupported_review_schema",
      key: "review",
      message: `Expected cf1.argumentDraftReviewDecisions.v1, received ${review.schemaVersion}.`,
    });
  }
  if (!review.decisions || typeof review.decisions !== "object" || Array.isArray(review.decisions)) {
    blockers.push({ code: "missing_decisions", key: "review", message: "Review decisions object is required." });
    return { blockers, warnings, decisions: {} };
  }

  const decisions = clone(review.decisions);
  if (resolutionOverlay) {
    if (resolutionOverlay.schemaVersion !== "cf1.adjudicationResolutions.v1") {
      blockers.push({
        code: "unsupported_resolution_schema",
        key: "resolutions",
        message: "Resolution overlay must use cf1.adjudicationResolutions.v1.",
      });
    }
    for (const [key, resolution] of Object.entries(resolutionOverlay.resolutions ?? {})) {
      if (!decisions[key]) {
        blockers.push({ code: "resolution_unknown_key", key, message: "Resolution key is not in review decisions." });
        continue;
      }
      decisions[key] = { ...decisions[key], ...clone(resolution), resolvedByOverlay: true };
    }
  }

  const expected = expectedDecisionKeys(fixtures);
  const actual = new Set(Object.keys(decisions));
  for (const key of expected) {
    if (!actual.has(key)) blockers.push({ code: "missing_decision_key", key, message: "No review decision." });
  }
  for (const key of actual) {
    if (!expected.has(key)) blockers.push({ code: "unknown_decision_key", key, message: "No matching draft item." });
  }
  for (const [key, value] of Object.entries(decisions)) {
    validateDecisionShape(key, value, blockers, warnings);
    parsePortfolioInclude(value.portfolioInclude, key, blockers);
  }
  return { blockers, warnings, decisions };
}

function applyArgumentCorrections(argument, decision, key, blockers) {
  const output = clone(argument);
  if (decision.correctedProposition !== undefined && decision.decision !== "split") {
    output.canonicalAtomicProposition = String(decision.correctedProposition).trim();
  }
  if (decision.correctedAssertionSourceKind !== undefined) {
    output.assertionSource.kind = decision.correctedAssertionSourceKind;
  }
  if (decision.correctedAssertionSourceName !== undefined) {
    output.assertionSource.name = decision.correctedAssertionSourceName;
  }
  if (decision.correctedAssertionSourceKind !== undefined || decision.correctedAssertionSourceName !== undefined) {
    output.assertionSource.basis = decision.notes || "Corrected during adjudication.";
  }
  if (decision.correctedContentStance !== undefined) {
    output.articleTreatment.contentStance = decision.correctedContentStance;
  }
  if (decision.correctedDeployment !== undefined) {
    output.articleTreatment.deployment = decision.correctedDeployment;
  }
  if (decision.correctedRole !== undefined) {
    output.articleTreatment.role = decision.correctedRole;
  }
  if (
    decision.correctedContentStance !== undefined ||
    decision.correctedDeployment !== undefined ||
    decision.correctedRole !== undefined
  ) {
    output.articleTreatment.basis = decision.notes || "Corrected during adjudication.";
  }
  const portfolioInclude = parsePortfolioInclude(decision.portfolioInclude, key, blockers);
  if (portfolioInclude !== undefined) {
    output.portfolio.include = portfolioInclude;
    output.portfolio.basis = decision.notes || "Corrected during adjudication.";
  }
  output.evidenceTarget = emptyEvidenceTarget();
  if (decision.notes) {
    output.notes = [output.notes, `Adjudication: ${decision.notes}`].filter(Boolean).join("\n");
  }
  return output;
}

function materializeArguments({ fixtureId, draftArguments, decisions, blockers, warnings }) {
  const argumentUnits = [];
  const replacementMap = {};
  const lineage = {};
  const splitReview = [];

  for (const argument of draftArguments) {
    const key = `${fixtureId}:argument:${argument.argumentUnitId}`;
    const decision = decisions[key];
    if (!decision) continue;
    if (decision.decision === "remove") {
      replacementMap[argument.argumentUnitId] = [];
      continue;
    }
    if (decision.decision === "split") {
      const propositions = splitPropositions(decision.correctedProposition);
      const childIds = [];
      for (let index = 0; index < propositions.length; index += 1) {
        const childId = `${argument.argumentUnitId}-S${String(index + 1).padStart(2, "0")}`;
        const child = applyArgumentCorrections(argument, decision, key, blockers);
        child.argumentUnitId = childId;
        child.canonicalAtomicProposition = propositions[index];
        child.notes = [
          child.notes,
          `Split from ${argument.argumentUnitId}; child ${index + 1} of ${propositions.length}.`,
        ].filter(Boolean).join("\n");
        argumentUnits.push(child);
        childIds.push(childId);
        lineage[childId] = {
          sourceArgumentUnitId: argument.argumentUnitId,
          reviewDecisionKey: key,
          operation: "split",
          childOrdinal: index + 1,
          childCount: propositions.length,
        };
        splitReview.push({
          fixtureId,
          argumentUnitId: childId,
          sourceArgumentUnitId: argument.argumentUnitId,
          proposition: child.canonicalAtomicProposition,
          grounding: clone(child.grounding),
          assertionSource: clone(child.assertionSource),
          articleTreatment: clone(child.articleTreatment),
          portfolio: clone(child.portfolio),
          reviewerNotes: decision.notes ?? "",
        });
      }
      replacementMap[argument.argumentUnitId] = childIds;
      continue;
    }

    const materialized = applyArgumentCorrections(argument, decision, key, blockers);
    argumentUnits.push(materialized);
    replacementMap[argument.argumentUnitId] = [argument.argumentUnitId];
    lineage[argument.argumentUnitId] = {
      sourceArgumentUnitId: argument.argumentUnitId,
      reviewDecisionKey: key,
      operation: decision.decision,
    };
  }

  const normalizedGroups = new Map();
  for (const argument of argumentUnits) {
    const normalized = normalizeText(argument.canonicalAtomicProposition);
    if (!normalizedGroups.has(normalized)) normalizedGroups.set(normalized, []);
    normalizedGroups.get(normalized).push(argument.argumentUnitId);
  }
  for (const [normalized, ids] of normalizedGroups) {
    if (normalized && ids.length > 1) {
      warnings.push({
        code: "duplicate_materialized_proposition",
        key: fixtureId,
        message: `Equivalent proposition text appears in ${ids.join(", ")}.`,
        argumentUnitIds: ids,
      });
    }
  }

  return { argumentUnits, replacementMap, lineage, splitReview };
}

function materializeCoverage({ fixtureId, passageCoverage, replacementMap }) {
  const output = [];
  const unresolved = [];
  for (const coverage of passageCoverage) {
    const materialized = clone(coverage);
    materialized.argumentUnitIds = (coverage.argumentUnitIds ?? []).flatMap(
      (argumentUnitId) => replacementMap[argumentUnitId] ?? [argumentUnitId],
    );
    if (
      materialized.argumentUnitIds.length === 0 &&
      (coverage.classification === "material_assertion_present" || coverage.classification === "mixed")
    ) {
      unresolved.push({
        fixtureId,
        coverageId: coverage.coverageId,
        originalClassification: coverage.classification,
        proposedClassification: "uncertain",
        sourceUnitIds: clone(coverage.sourceUnitIds),
        removedArgumentUnitIds: clone(coverage.argumentUnitIds),
        basis: "All linked draft assertions were removed during adjudication; passage classification requires review.",
      });
      materialized.classification = "uncertain";
      materialized.basis = "Adjudication removed all linked assertions; classification requires review.";
    }
    output.push(materialized);
  }
  return { passageCoverage: output, unresolvedCoverage: unresolved };
}

function materializeRelations({ fixtureId, relations, replacementMap }) {
  const safe = [];
  const unresolved = [];
  for (const relation of relations) {
    const from = replacementMap[relation.fromArgumentUnitId] ?? [relation.fromArgumentUnitId];
    const to = replacementMap[relation.toArgumentUnitId] ?? [relation.toArgumentUnitId];
    const unchanged =
      from.length === 1 &&
      to.length === 1 &&
      from[0] === relation.fromArgumentUnitId &&
      to[0] === relation.toArgumentUnitId;
    if (unchanged) {
      safe.push(clone(relation));
    } else {
      unresolved.push({
        fixtureId,
        relation: clone(relation),
        candidateFromArgumentUnitIds: clone(from),
        candidateToArgumentUnitIds: clone(to),
        basis: "At least one relation endpoint was split or removed; no automatic fan-out was performed.",
      });
    }
  }
  return { safeRelations: safe, unresolvedRelations: unresolved };
}

function materializeConsistencyFindings({ fixtureId, findings, replacementMap }) {
  const safe = [];
  const unresolved = [];
  for (const finding of findings) {
    const replacements = (finding.argumentUnitIds ?? []).map((argumentUnitId) => ({
      sourceArgumentUnitId: argumentUnitId,
      candidateArgumentUnitIds: clone(replacementMap[argumentUnitId] ?? [argumentUnitId]),
    }));
    const unchanged = replacements.every(
      (replacement) =>
        replacement.candidateArgumentUnitIds.length === 1 &&
        replacement.candidateArgumentUnitIds[0] === replacement.sourceArgumentUnitId,
    );
    if (unchanged) {
      safe.push(clone(finding));
    } else {
      unresolved.push({
        fixtureId,
        finding: clone(finding),
        endpointReplacements: replacements,
        basis: "At least one consistency-finding endpoint was split or removed; remapping requires review.",
      });
    }
  }
  return { safeFindings: safe, unresolvedFindings: unresolved };
}

function compiledAdjudication({ form, review, decisions, fixtureId }) {
  const fixtureDecision = decisions[`${fixtureId}:fixture`];
  const orientationDecision = decisions[`${fixtureId}:orientation`];
  return {
    ...clone(form.adjudication),
    status: "draft",
    approvedAt: null,
    notes: [
      form.adjudication?.notes,
      "Compiled from reviewed model draft. Split children, affected relations, consistency findings, rubric coverage, and evidence targets remain subject to focused review.",
      fixtureDecision?.notes,
      orientationDecision?.notes,
    ].filter(Boolean).join("\n"),
    sourceReviewSchemaVersion: review.schemaVersion,
    sourceReviewExportedAt: review.exportedAt ?? null,
  };
}

export function validateCompiledCandidate(candidate) {
  const errors = [];
  const fixtureId = candidate.fixture?.fixtureId ?? "unknown-fixture";
  const argumentIds = candidate.argumentUnits.map((argument) => argument.argumentUnitId);
  const argumentIdSet = new Set(argumentIds);
  if (argumentIdSet.size !== argumentIds.length) {
    errors.push({ code: "duplicate_compiled_argument_id", key: fixtureId });
  }
  for (const coverage of candidate.passageCoverage) {
    for (const argumentUnitId of coverage.argumentUnitIds ?? []) {
      if (!argumentIdSet.has(argumentUnitId)) {
        errors.push({
          code: "dangling_compiled_coverage_reference",
          key: `${fixtureId}:${coverage.coverageId}`,
          argumentUnitId,
        });
      }
    }
  }
  for (const relation of candidate.relations) {
    for (const argumentUnitId of [relation.fromArgumentUnitId, relation.toArgumentUnitId]) {
      if (!argumentIdSet.has(argumentUnitId)) {
        errors.push({
          code: "dangling_compiled_relation_reference",
          key: `${fixtureId}:${relation.relationId}`,
          argumentUnitId,
        });
      }
    }
  }
  for (const finding of candidate.consistencyFindings) {
    for (const argumentUnitId of finding.argumentUnitIds ?? []) {
      if (!argumentIdSet.has(argumentUnitId)) {
        errors.push({
          code: "dangling_compiled_finding_reference",
          key: `${fixtureId}:${finding.findingId}`,
          argumentUnitId,
        });
      }
    }
  }
  const lineageIds = Object.keys(candidate.compilation?.lineageByArgumentUnitId ?? {});
  if (
    lineageIds.length !== argumentIds.length ||
    lineageIds.some((argumentUnitId) => !argumentIdSet.has(argumentUnitId))
  ) {
    errors.push({ code: "incomplete_compilation_lineage", key: fixtureId });
  }
  if (candidate.adjudication?.status === "approved") {
    errors.push({ code: "compiler_cannot_approve", key: fixtureId });
  }
  for (const argument of candidate.argumentUnits) {
    const evidence = argument.evidenceTarget ?? {};
    if (
      evidence.disputedProposition ||
      evidence.verificationQuestion ||
      evidence.warrant ||
      (evidence.supportWouldRequire ?? []).length ||
      (evidence.refuteWouldRequire ?? []).length ||
      (evidence.qualifyWouldRequire ?? []).length
    ) {
      errors.push({
        code: "unreviewed_evidence_leaked_into_candidate",
        key: `${fixtureId}:${argument.argumentUnitId}`,
      });
    }
  }
  return errors;
}

export function compileAdjudication({ fixtures, review, resolutionOverlay = null, generatedAt = new Date().toISOString() }) {
  const validation = validateCompilationInputs({ fixtures, review, resolutionOverlay });
  const blockers = [...validation.blockers];
  const warnings = [...validation.warnings];
  const decisions = validation.decisions;
  const compiledFixtures = [];
  const reviewQueue = {
    schemaVersion: "cf1.adjudicationReviewQueue.v1",
    generatedAt,
    splitChildren: [],
    relations: [],
    consistencyFindings: [],
    passageCoverage: [],
    rubricCoverage: [],
    attributionSpotChecks: [],
    excludedTrainingTasks: ["evidence_target", "warrant"],
  };

  if (blockers.length) {
    return { blockers, warnings, compiledFixtures, reviewQueue, decisions };
  }

  for (const fixture of fixtures) {
    const fixtureId = fixture.draft.fixtureId;
    const materializedArguments = materializeArguments({
      fixtureId,
      draftArguments: fixture.draft.argumentUnits,
      decisions,
      blockers,
      warnings,
    });
    const coverage = materializeCoverage({
      fixtureId,
      passageCoverage: fixture.draft.passageCoverage,
      replacementMap: materializedArguments.replacementMap,
    });
    const relations = materializeRelations({
      fixtureId,
      relations: fixture.draft.relations,
      replacementMap: materializedArguments.replacementMap,
    });
    const findings = materializeConsistencyFindings({
      fixtureId,
      findings: fixture.draft.consistencyFindings,
      replacementMap: materializedArguments.replacementMap,
    });

    const candidate = {
      schemaVersion: fixture.form.schemaVersion,
      fixture: clone(fixture.form.fixture),
      adjudication: compiledAdjudication({
        form: fixture.form,
        review,
        decisions,
        fixtureId,
      }),
      orientation: clone(fixture.draft.orientation),
      passageCoverage: coverage.passageCoverage,
      argumentUnits: materializedArguments.argumentUnits,
      relations: relations.safeRelations,
      consistencyFindings: findings.safeFindings,
      rubricCoverage: clone(fixture.form.rubricCoverage),
      compilation: {
        schemaVersion: "cf1.adjudicationCompilation.v1",
        generatedAt,
        sourceDraftSchemaVersion: fixture.draft.schemaVersion,
        sourceDraftSha256: fixture.draftSha256,
        sourceFormSha256: fixture.formSha256,
        reviewSha256: fixture.reviewSha256,
        evidenceTargetsApproved: false,
        lineageByArgumentUnitId: materializedArguments.lineage,
        sourceArgumentReplacementMap: materializedArguments.replacementMap,
      },
    };
    const candidateErrors = validateCompiledCandidate(candidate);
    for (const error of candidateErrors) {
      blockers.push({
        ...error,
        message: "Compiled candidate failed its internal integrity check.",
      });
    }
    compiledFixtures.push({ fixtureId, candidate });

    reviewQueue.splitChildren.push(...materializedArguments.splitReview);
    reviewQueue.relations.push(...relations.unresolvedRelations);
    reviewQueue.consistencyFindings.push(...findings.unresolvedFindings);
    reviewQueue.passageCoverage.push(...coverage.unresolvedCoverage);
    reviewQueue.rubricCoverage.push({ fixtureId, ...clone(fixture.form.rubricCoverage) });
    reviewQueue.attributionSpotChecks.push(
      ...candidate.argumentUnits
        .filter((argument) => argument.assertionSource.kind === "unknown")
        .map((argument) => ({
          fixtureId,
          argumentUnitId: argument.argumentUnitId,
          proposition: argument.canonicalAtomicProposition,
          grounding: clone(argument.grounding),
          assertionSource: clone(argument.assertionSource),
          reason: "Assertion source remains unknown.",
        })),
    );
  }

  if (blockers.length) {
    return { blockers, warnings, compiledFixtures: [], reviewQueue, decisions };
  }

  return { blockers, warnings, compiledFixtures, reviewQueue, decisions };
}

export function compilationSummary(result) {
  return {
    blockerCount: result.blockers.length,
    warningCount: result.warnings.length,
    fixtureCount: result.compiledFixtures.length,
    argumentUnitCount: result.compiledFixtures.reduce(
      (sum, fixture) => sum + fixture.candidate.argumentUnits.length,
      0,
    ),
    safeRelationCount: result.compiledFixtures.reduce(
      (sum, fixture) => sum + fixture.candidate.relations.length,
      0,
    ),
    safeConsistencyFindingCount: result.compiledFixtures.reduce(
      (sum, fixture) => sum + fixture.candidate.consistencyFindings.length,
      0,
    ),
    splitChildReviewCount: result.reviewQueue.splitChildren.length,
    unresolvedRelationCount: result.reviewQueue.relations.length,
    unresolvedConsistencyFindingCount: result.reviewQueue.consistencyFindings.length,
    unresolvedCoverageCount: result.reviewQueue.passageCoverage.length,
    attributionSpotCheckCount: result.reviewQueue.attributionSpotChecks.length,
    excludedTrainingTasks: clone(result.reviewQueue.excludedTrainingTasks),
  };
}
