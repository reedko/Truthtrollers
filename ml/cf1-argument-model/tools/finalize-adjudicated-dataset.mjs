#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateCompiledCandidate } from "./lib/adjudication-compiler.mjs";

const toolDir = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(toolDir, "..");
const defaultCandidateDir = path.join(projectDir, "data", "adjudication-candidates", "argument-drafts-v1-r2");
const defaultDecisions = path.join(projectDir, "data", "annotation-prompts", "stupidity", "CF1-focused-adjudication-ALL-448-decisions.json");
const defaultOutput = path.join(projectDir, "data", "final", "argument-drafts-v1-assistant-adjudicated");

const PROVENANCE = {
  adjudicationSource: "assistant_adjudicated",
  independentHumanGold: false,
  humanReviewRequired: false,
  trainingGoldStatus: "user_accepted_gold",
};
const VALID = {
  sourceKinds: new Set(["article_voice", "person", "institution", "document", "study", "legal_party", "unknown"]),
  stances: new Set(["supports_thesis", "contradicts_thesis", "neutral", "unclear"]),
  deployments: new Set(["endorsed", "opponent_to_rebut", "rebutted", "qualified", "reported_neutral", "unclear"]),
  roles: new Set(["pillar", "pillar_support", "opponent_claim", "rebuttal", "qualification", "context", "unclear"]),
  relationTypes: new Set(["supports", "rebuts", "qualifies", "contradicts", "elaborates", "provides_evidence_for"]),
  findingTypes: new Set(["contradiction", "tension", "qualification", "not_contradiction"]),
  coverage: new Set(["material_assertion_present", "no_material_assertion", "mixed", "duplicate_expression", "uncertain"]),
};

function parseArgs(argv) {
  const args = { candidateDir: defaultCandidateDir, decisions: defaultDecisions, output: defaultOutput };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--candidate-dir") args.candidateDir = path.resolve(argv[++index]);
    else if (token === "--decisions") args.decisions = path.resolve(argv[++index]);
    else if (token === "--output") args.output = path.resolve(argv[++index]);
    else if (token === "--help") {
      console.log("Usage: node ml/cf1-argument-model/tools/finalize-adjudicated-dataset.mjs [--candidate-dir DIR] [--decisions FILE] [--output DIR]");
      process.exit(0);
    } else throw new Error(`Unknown argument: ${token}`);
  }
  return args;
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function readRaw(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  return { raw, sha256: sha256(raw) };
}

function readJson(filePath) {
  const file = readRaw(filePath);
  return { ...file, value: JSON.parse(file.raw) };
}

function clone(value) {
  return structuredClone(value);
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function writeJsonl(filePath, rows) {
  fs.writeFileSync(filePath, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`);
}

function parseSourceUnits(sourceText) {
  const units = new Map();
  const matcher = /^\[(U\d{4})\]\s*([\s\S]*?)(?=^\[U\d{4}\]\s*|(?![\s\S]))/gm;
  let match;
  while ((match = matcher.exec(sourceText))) units.set(match[1], match[2].trim());
  return units;
}

function contextForUnits(unitIds, unitMap) {
  return unitIds.map((unitId) => ({ unitId, text: unitMap.get(unitId) ?? "" }));
}

function emptyEvidenceTarget() {
  return { disputedProposition: "", verificationQuestion: "", supportWouldRequire: [], refuteWouldRequire: [], qualifyWouldRequire: [], warrant: "" };
}

function decisionType(key) {
  return key.split(":")[1];
}

function validateAuthority({ authority, authorityFile, queue, queueFile, reportFile, candidateDir, fixtures }) {
  const errors = [];
  if (authority.schemaVersion !== "cf1.completeFocusedAdjudication.v1") errors.push("unsupported authority schema");
  if (authority.counts?.totalResolved !== 448 || authority.counts?.remainingUnreviewed !== 0) errors.push("authority does not resolve exactly 448 controls");
  if (authority.provenance.reviewQueueSha256 !== queueFile.sha256) errors.push("review queue hash mismatch");
  if (authority.provenance.compilationReportSha256 !== reportFile.sha256) errors.push("compilation report hash mismatch");
  const reviewedPath = path.join(projectDir, authority.provenance.reviewedDecisionsPath);
  if (readRaw(reviewedPath).sha256 !== authority.provenance.reviewedDecisionsSha256) errors.push("reviewed decisions hash mismatch");
  const expected = new Set([
    ...queue.splitChildren.map((item) => `${item.fixtureId}:splitChild:${item.argumentUnitId}`),
    ...queue.relations.map((item) => `${item.fixtureId}:relation:${item.relation.relationId}`),
    ...queue.consistencyFindings.map((item) => `${item.fixtureId}:finding:${item.finding.findingId}`),
    ...queue.passageCoverage.map((item) => `${item.fixtureId}:coverage:${item.coverageId}`),
    ...queue.attributionSpotChecks.map((item) => `${item.fixtureId}:attribution:${item.argumentUnitId}`),
    ...queue.rubricCoverage.flatMap((item) => item.targets.map((target) => `${item.fixtureId}:rubric:${target.targetId}`)),
    ...queue.rubricCoverage.flatMap((item) => item.prohibitedInterpretations.map((entry) => `${item.fixtureId}:prohibition:${entry.prohibitionId}`)),
  ]);
  const actual = new Set(Object.keys(authority.decisions ?? {}));
  for (const key of expected) if (!actual.has(key)) errors.push(`missing decision ${key}`);
  for (const key of actual) if (!expected.has(key)) errors.push(`unexpected decision ${key}`);
  if (expected.size !== 448 || actual.size !== 448) errors.push(`focused decision count mismatch expected=${expected.size} actual=${actual.size}`);
  for (const fixture of fixtures) {
    const source = authority.provenance.fixtureInputs.find((item) => item.fixtureId === fixture.fixtureId);
    if (!source) errors.push(`missing provenance for ${fixture.fixtureId}`);
    else {
      if (source.candidateSha256 !== fixture.candidateSha256) errors.push(`${fixture.fixtureId} candidate hash mismatch`);
      if (source.draftSha256 !== fixture.draftSha256) errors.push(`${fixture.fixtureId} draft hash mismatch`);
      if (source.sourcePromptSha256 !== fixture.sourcePromptSha256) errors.push(`${fixture.fixtureId} prompt hash mismatch`);
    }
  }
  if (authority.adjudication?.evidenceTargetsAndWarrantsExcluded !== true) errors.push("evidence exclusions missing from authority");
  if (errors.length) throw new Error(`Authority validation failed:\n- ${errors.join("\n- ")}`);
  return { authoritySha256: authorityFile.sha256, candidateDirectory: path.relative(projectDir, candidateDir), expectedDecisionCount: expected.size };
}

function applySplitDecisions(fixtureId, candidate, decisions) {
  const argumentMap = new Map(candidate.argumentUnits.map((argument) => [argument.argumentUnitId, argument]));
  for (const [key, decision] of Object.entries(decisions)) {
    if (!key.startsWith(`${fixtureId}:splitChild:`)) continue;
    const argumentUnitId = key.split(":")[2];
    const argument = argumentMap.get(argumentUnitId);
    if (!argument) throw new Error(`${key}: missing split child`);
    if (!['accept', 'edit'].includes(decision.decision)) throw new Error(`${key}: invalid split decision ${decision.decision}`);
    if (decision.correctedProposition !== undefined) argument.canonicalAtomicProposition = String(decision.correctedProposition).trim();
    if (decision.correctedAssertionSourceKind !== undefined) argument.assertionSource.kind = decision.correctedAssertionSourceKind;
    if (decision.correctedAssertionSourceName !== undefined) argument.assertionSource.name = decision.correctedAssertionSourceName;
    if (decision.correctedContentStance !== undefined) argument.articleTreatment.contentStance = decision.correctedContentStance;
    if (decision.correctedDeployment !== undefined) argument.articleTreatment.deployment = decision.correctedDeployment;
    if (decision.correctedRole !== undefined) argument.articleTreatment.role = decision.correctedRole;
    if (decision.correctedTreatment) {
      const [stance, deployment, role] = String(decision.correctedTreatment).split("|").map((value) => value.trim());
      if (stance) argument.articleTreatment.contentStance = stance;
      if (deployment) argument.articleTreatment.deployment = deployment;
      if (role) argument.articleTreatment.role = role;
    }
    if (decision.portfolioInclude !== undefined) argument.portfolio.include = decision.portfolioInclude === true || decision.portfolioInclude === "true";
    if (decision.decision === "edit") {
      if (decision.correctedAssertionSourceKind !== undefined || decision.correctedAssertionSourceName !== undefined) argument.assertionSource.basis = decision.basis || decision.notes || "Final adjudication correction.";
      if (decision.correctedTreatment || decision.correctedContentStance !== undefined || decision.correctedDeployment !== undefined || decision.correctedRole !== undefined) argument.articleTreatment.basis = decision.basis || decision.notes || "Final adjudication correction.";
      if (decision.portfolioInclude !== undefined) argument.portfolio.basis = decision.basis || decision.notes || "Final adjudication correction.";
    }
    argument.evidenceTarget = emptyEvidenceTarget();
    argument.finalAdjudication = { decisionKey: key, decision: decision.decision, basis: decision.basis ?? "", notes: decision.notes ?? "", ...PROVENANCE };
  }
}

function materializeRelations(fixtureId, candidate, queueItems, decisions) {
  const relationIds = new Set(candidate.relations.map((relation) => relation.relationId));
  for (const item of queueItems.filter((entry) => entry.fixtureId === fixtureId)) {
    const key = `${fixtureId}:relation:${item.relation.relationId}`;
    const decision = decisions[key];
    if (!decision || !["remap", "fan_out"].includes(decision.decision)) throw new Error(`${key}: unresolved relation decision`);
    if (!Array.isArray(decision.mappings) || !decision.mappings.length) throw new Error(`${key}: relation has no mappings`);
    decision.mappings.forEach((mapping, index) => {
      let relationId = index === 0 ? item.relation.relationId : `${item.relation.relationId}-F${String(index + 1).padStart(2, "0")}`;
      while (relationIds.has(relationId)) relationId = `${relationId}-X`;
      relationIds.add(relationId);
      candidate.relations.push({
        relationId,
        fromArgumentUnitId: mapping.fromArgumentUnitId,
        type: mapping.type,
        toArgumentUnitId: mapping.toArgumentUnitId,
        sourceUnitIds: clone(item.relation.sourceUnitIds ?? []),
        basis: decision.basis || item.relation.basis,
        finalAdjudication: { decisionKey: key, decision: decision.decision, sourceRelationId: item.relation.relationId, mappingOrdinal: index + 1, ...PROVENANCE },
      });
    });
  }
}

function materializeFindings(fixtureId, candidate, queueItems, decisions) {
  const findingIds = new Set(candidate.consistencyFindings.map((finding) => finding.findingId));
  for (const item of queueItems.filter((entry) => entry.fixtureId === fixtureId)) {
    const key = `${fixtureId}:finding:${item.finding.findingId}`;
    const decision = decisions[key];
    if (!decision) throw new Error(`${key}: missing finding decision`);
    if (decision.decision === "remove") continue;
    if (decision.decision !== "remap" || !Array.isArray(decision.argumentUnitIds) || !decision.argumentUnitIds.length) throw new Error(`${key}: invalid finding decision`);
    if (findingIds.has(item.finding.findingId)) throw new Error(`${key}: duplicate finding ID`);
    findingIds.add(item.finding.findingId);
    candidate.consistencyFindings.push({
      findingId: item.finding.findingId,
      argumentUnitIds: clone(decision.argumentUnitIds),
      type: decision.findingType || item.finding.type,
      basis: decision.basis || item.finding.basis,
      finalAdjudication: { decisionKey: key, decision: decision.decision, ...PROVENANCE },
    });
  }
}

function applyCoverageAndAttribution(fixtureId, candidate, queue, decisions) {
  for (const item of queue.passageCoverage.filter((entry) => entry.fixtureId === fixtureId)) {
    const key = `${fixtureId}:coverage:${item.coverageId}`;
    const decision = decisions[key];
    if (!decision || decision.decision !== "edit") throw new Error(`${key}: invalid coverage decision`);
    const coverage = candidate.passageCoverage.find((entry) => entry.coverageId === item.coverageId);
    if (!coverage) throw new Error(`${key}: coverage record missing`);
    coverage.classification = decision.classification;
    coverage.argumentUnitIds = clone(decision.argumentUnitIds ?? []);
    coverage.basis = decision.basis || coverage.basis;
    coverage.finalAdjudication = { decisionKey: key, decision: decision.decision, ...PROVENANCE };
  }
  for (const item of queue.attributionSpotChecks.filter((entry) => entry.fixtureId === fixtureId)) {
    const key = `${fixtureId}:attribution:${item.argumentUnitId}`;
    const decision = decisions[key];
    if (!decision || decision.decision !== "accept_unknown") throw new Error(`${key}: invalid attribution decision`);
    const argument = candidate.argumentUnits.find((entry) => entry.argumentUnitId === item.argumentUnitId);
    if (!argument) throw new Error(`${key}: argument missing`);
    argument.assertionSource.kind = decision.sourceKind ?? "unknown";
    argument.assertionSource.name = decision.sourceName ?? argument.assertionSource.name;
    argument.assertionSource.sourceUnitIds = clone(decision.sourceUnitIds ?? argument.assertionSource.sourceUnitIds);
    argument.assertionSource.basis = decision.basis || argument.assertionSource.basis;
    argument.finalAttributionAdjudication = { decisionKey: key, decision: decision.decision, ...PROVENANCE };
  }
}

function applyRubric(fixtureId, candidate, queue, decisions) {
  const rubric = queue.rubricCoverage.find((entry) => entry.fixtureId === fixtureId);
  for (const target of candidate.rubricCoverage.targets) {
    const key = `${fixtureId}:rubric:${target.targetId}`;
    const decision = decisions[key];
    if (!decision || decision.decision !== "matched") throw new Error(`${key}: invalid rubric decision`);
    target.adjudicatorStatus = "matched";
    target.argumentUnitIds = clone(decision.argumentUnitIds ?? []);
    target.relationIds = clone(decision.relationIds ?? []);
    target.notes = decision.notes ?? decision.basis ?? "";
    target.finalAdjudication = { decisionKey: key, ...PROVENANCE };
  }
  for (const prohibition of candidate.rubricCoverage.prohibitedInterpretations) {
    const key = `${fixtureId}:prohibition:${prohibition.prohibitionId}`;
    const decision = decisions[key];
    if (!decision || decision.decision !== "not_violated") throw new Error(`${key}: invalid prohibition decision`);
    prohibition.adjudicatorStatus = "not_violated";
    prohibition.argumentUnitIds = clone(decision.argumentUnitIds ?? []);
    prohibition.notes = decision.notes ?? decision.basis ?? "";
    prohibition.finalAdjudication = { decisionKey: key, ...PROVENANCE };
  }
  if (!rubric) throw new Error(`${fixtureId}: rubric queue record missing`);
}

function finalizeFixture(fixture, queue, authority, generatedAt) {
  const candidate = clone(fixture.candidate);
  const fixtureId = fixture.fixtureId;
  applySplitDecisions(fixtureId, candidate, authority.decisions);
  materializeRelations(fixtureId, candidate, queue.relations, authority.decisions);
  materializeFindings(fixtureId, candidate, queue.consistencyFindings, authority.decisions);
  applyCoverageAndAttribution(fixtureId, candidate, queue, authority.decisions);
  applyRubric(fixtureId, candidate, queue, authority.decisions);
  for (const argument of candidate.argumentUnits) argument.evidenceTarget = emptyEvidenceTarget();
  candidate.adjudication = {
    ...candidate.adjudication,
    status: "assistant_adjudicated",
    approvedAt: null,
    finalizedAt: generatedAt,
    ...PROVENANCE,
    notes: [candidate.adjudication.notes, "Finalized from the complete 448-decision authority. No further review is required for this dataset version."].filter(Boolean).join("\n"),
  };
  candidate.compilation = {
    ...candidate.compilation,
    schemaVersion: "cf1.finalAdjudicationCompilation.v1",
    finalizedAt: generatedAt,
    authoritySha256: fixture.authoritySha256,
    evidenceTargetsApproved: false,
    evidenceTargetsExcluded: true,
    focusedDecisionCount: Object.keys(authority.decisions).filter((key) => key.startsWith(`${fixtureId}:`)).length,
    ...PROVENANCE,
  };
  candidate.schemaVersion = "cf1.argumentAnnotation.final.v1";
  return candidate;
}

function rowBase(fixtureId, task, rowId) {
  return { schemaVersion: "cf1.supervisedTaskRow.v1", rowId, fixtureId, task, ...PROVENANCE };
}

function compileRows(fixture, candidate) {
  const fixtureId = fixture.fixtureId;
  const units = fixture.sourceUnits;
  const argumentMap = new Map(candidate.argumentUnits.map((argument) => [argument.argumentUnitId, argument]));
  const rows = [];
  rows.push({ ...rowBase(fixtureId, "orient", `${fixtureId}:orient`), input: { sourceUnits: [...units].map(([unitId, text]) => ({ unitId, text })) }, output: clone(candidate.orientation) });
  for (const coverage of candidate.passageCoverage) {
    rows.push({ ...rowBase(fixtureId, "detect_assertions", `${fixtureId}:detect:${coverage.coverageId}`), input: { sourceUnits: contextForUnits(coverage.sourceUnitIds ?? [], units) }, output: { classification: coverage.classification, argumentUnitIds: clone(coverage.argumentUnitIds ?? []) } });
  }
  const groundingGroups = new Map();
  for (const argument of candidate.argumentUnits) {
    const key = [...argument.grounding.sourceUnitIds].sort().join(",");
    if (!groundingGroups.has(key)) groundingGroups.set(key, []);
    groundingGroups.get(key).push(argument);
  }
  let extractionIndex = 0;
  for (const argumentsInGroup of groundingGroups.values()) {
    extractionIndex += 1;
    const unitIds = [...new Set(argumentsInGroup.flatMap((argument) => argument.grounding.sourceUnitIds))];
    rows.push({ ...rowBase(fixtureId, "extract_assertions", `${fixtureId}:extract:${String(extractionIndex).padStart(4, "0")}`), input: { sourceUnits: contextForUnits(unitIds, units) }, output: { assertions: argumentsInGroup.map((argument) => ({ argumentUnitId: argument.argumentUnitId, proposition: argument.canonicalAtomicProposition, groundingUnitIds: clone(argument.grounding.sourceUnitIds), scopeQualifiers: clone(argument.scopeQualifiers ?? []) })) } });
  }
  for (const argument of candidate.argumentUnits) {
    const context = contextForUnits(argument.grounding.sourceUnitIds, units);
    rows.push({ ...rowBase(fixtureId, "attribute", `${fixtureId}:attribute:${argument.argumentUnitId}`), input: { argumentUnitId: argument.argumentUnitId, proposition: argument.canonicalAtomicProposition, localContext: context }, output: clone(argument.assertionSource) });
    rows.push({ ...rowBase(fixtureId, "deploy", `${fixtureId}:deploy:${argument.argumentUnitId}`), input: { argumentUnitId: argument.argumentUnitId, proposition: argument.canonicalAtomicProposition, localContext: context, orientation: clone(candidate.orientation) }, output: clone(argument.articleTreatment) });
    rows.push({ ...rowBase(fixtureId, "select", `${fixtureId}:select:${argument.argumentUnitId}`), input: { argumentUnitId: argument.argumentUnitId, proposition: argument.canonicalAtomicProposition, source: clone(argument.assertionSource), treatment: clone(argument.articleTreatment), orientation: clone(candidate.orientation) }, output: clone(argument.portfolio) });
  }
  for (const relation of candidate.relations) {
    const from = argumentMap.get(relation.fromArgumentUnitId);
    const to = argumentMap.get(relation.toArgumentUnitId);
    rows.push({ ...rowBase(fixtureId, "relate", `${fixtureId}:relate:${relation.relationId}`), input: { from: { argumentUnitId: from.argumentUnitId, proposition: from.canonicalAtomicProposition, localContext: contextForUnits(from.grounding.sourceUnitIds, units) }, to: { argumentUnitId: to.argumentUnitId, proposition: to.canonicalAtomicProposition, localContext: contextForUnits(to.grounding.sourceUnitIds, units) }, orientation: clone(candidate.orientation) }, output: { relationType: relation.type, relationId: relation.relationId, basis: relation.basis } });
  }
  return rows;
}

function compileEvaluationRows(fixtureId, candidate) {
  const rows = [];
  for (const target of candidate.rubricCoverage.targets) rows.push({ schemaVersion: "cf1.evaluationRow.v1", rowId: `${fixtureId}:eval:${target.targetId}`, fixtureId, task: "evaluation_key_target", input: { category: target.category, description: target.description, excerpt: target.excerpt ?? null }, expected: { status: target.adjudicatorStatus, argumentUnitIds: clone(target.argumentUnitIds), relationIds: clone(target.relationIds) }, evaluationOnly: true, ...PROVENANCE });
  for (const prohibition of candidate.rubricCoverage.prohibitedInterpretations) rows.push({ schemaVersion: "cf1.evaluationRow.v1", rowId: `${fixtureId}:eval:${prohibition.prohibitionId}`, fixtureId, task: "prohibited_interpretation", input: { description: prohibition.description }, expected: { status: prohibition.adjudicatorStatus, argumentUnitIds: clone(prohibition.argumentUnitIds ?? []) }, evaluationOnly: true, ...PROVENANCE });
  return rows;
}

function validateFinalFixture(candidate, sourceUnits) {
  const errors = validateCompiledCandidate(candidate);
  const argumentIds = new Set(candidate.argumentUnits.map((argument) => argument.argumentUnitId));
  const relationIds = new Set(candidate.relations.map((relation) => relation.relationId));
  const findingIds = new Set(candidate.consistencyFindings.map((finding) => finding.findingId));
  if (relationIds.size !== candidate.relations.length) errors.push({ code: "duplicate_final_relation_id" });
  if (findingIds.size !== candidate.consistencyFindings.length) errors.push({ code: "duplicate_final_finding_id" });
  if (candidate.adjudication.status !== "assistant_adjudicated") errors.push({ code: "invalid_final_status" });
  if (candidate.adjudication.humanReviewRequired !== false) errors.push({ code: "human_review_still_required" });
  for (const coverage of candidate.passageCoverage) {
    if (!VALID.coverage.has(coverage.classification)) errors.push({ code: "invalid_coverage_enum", key: coverage.coverageId, value: coverage.classification });
    for (const unitId of coverage.sourceUnitIds ?? []) if (!sourceUnits.has(unitId)) errors.push({ code: "unknown_coverage_source_unit", key: coverage.coverageId, unitId });
  }
  for (const argument of candidate.argumentUnits) {
    if (!VALID.sourceKinds.has(argument.assertionSource.kind)) errors.push({ code: "invalid_source_kind", key: argument.argumentUnitId, value: argument.assertionSource.kind });
    if (!VALID.stances.has(argument.articleTreatment.contentStance)) errors.push({ code: "invalid_stance", key: argument.argumentUnitId, value: argument.articleTreatment.contentStance });
    if (!VALID.deployments.has(argument.articleTreatment.deployment)) errors.push({ code: "invalid_deployment", key: argument.argumentUnitId, value: argument.articleTreatment.deployment });
    if (!VALID.roles.has(argument.articleTreatment.role)) errors.push({ code: "invalid_role", key: argument.argumentUnitId, value: argument.articleTreatment.role });
    for (const unitId of argument.grounding.sourceUnitIds ?? []) if (!sourceUnits.has(unitId)) errors.push({ code: "unknown_grounding_source_unit", key: argument.argumentUnitId, unitId });
    for (const unitId of argument.assertionSource.sourceUnitIds ?? []) if (!sourceUnits.has(unitId)) errors.push({ code: "unknown_attribution_source_unit", key: argument.argumentUnitId, unitId });
  }
  for (const relation of candidate.relations) if (!VALID.relationTypes.has(relation.type)) errors.push({ code: "invalid_relation_type", key: relation.relationId, value: relation.type });
  for (const finding of candidate.consistencyFindings) if (!VALID.findingTypes.has(finding.type)) errors.push({ code: "invalid_finding_type", key: finding.findingId, value: finding.type });
  for (const target of candidate.rubricCoverage.targets) {
    if (target.adjudicatorStatus !== "matched") errors.push({ code: "unresolved_rubric_target", key: target.targetId });
    for (const id of target.argumentUnitIds) if (!argumentIds.has(id)) errors.push({ code: "dangling_rubric_argument", key: target.targetId, id });
    for (const id of target.relationIds) if (!relationIds.has(id)) errors.push({ code: "dangling_rubric_relation", key: target.targetId, id });
  }
  for (const prohibition of candidate.rubricCoverage.prohibitedInterpretations) if (prohibition.adjudicatorStatus !== "not_violated") errors.push({ code: "unresolved_prohibition", key: prohibition.prohibitionId });
  return errors;
}

function summarizeRows(rows) {
  const byTask = {};
  const byFixture = {};
  for (const row of rows) {
    byTask[row.task] = (byTask[row.task] ?? 0) + 1;
    byFixture[row.fixtureId] ??= {};
    byFixture[row.fixtureId][row.task] = (byFixture[row.fixtureId][row.task] ?? 0) + 1;
  }
  return { total: rows.length, byTask, byFixture };
}

function containsExcludedEvidenceKey(value) {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some(containsExcludedEvidenceKey);
  const excluded = new Set(["evidenceTarget", "verificationQuestion", "supportWouldRequire", "refuteWouldRequire", "qualifyWouldRequire", "warrant"]);
  return Object.entries(value).some(([key, nested]) => excluded.has(key) || containsExcludedEvidenceKey(nested));
}

const args = parseArgs(process.argv.slice(2));
if (fs.existsSync(args.output)) throw new Error(`Refusing to overwrite existing final dataset: ${args.output}`);
const authorityFile = readJson(args.decisions);
const queueFile = readJson(path.join(args.candidateDir, "review-queue.json"));
const reportFile = readJson(path.join(args.candidateDir, "compilation-report.json"));
const fixtureIds = Array.from({ length: 9 }, (_, index) => `CF1-F${String(index + 1).padStart(2, "0")}`);
const fixtures = fixtureIds.map((fixtureId) => {
  const candidateFile = readJson(path.join(args.candidateDir, `${fixtureId}.annotation.candidate.v1.json`));
  const draftFile = readJson(path.join(projectDir, "data", "annotation-prompts", `${fixtureId}.argumentDraft.v1.json`));
  const promptFile = readRaw(path.join(projectDir, "data", "annotation-prompts", `${fixtureId}.chat-prompt.md`));
  return { fixtureId, candidate: candidateFile.value, candidateSha256: candidateFile.sha256, draftSha256: draftFile.sha256, sourcePromptSha256: promptFile.sha256, sourceUnits: parseSourceUnits(promptFile.raw), authoritySha256: authorityFile.sha256 };
});
const authorityValidation = validateAuthority({ authority: authorityFile.value, authorityFile, queue: queueFile.value, queueFile, reportFile, candidateDir: args.candidateDir, fixtures });
const generatedAt = new Date().toISOString();
const finalFixtures = fixtures.map((fixture) => ({ fixtureId: fixture.fixtureId, candidate: finalizeFixture(fixture, queueFile.value, authorityFile.value, generatedAt) }));
const validationErrors = finalFixtures.flatMap(({ fixtureId, candidate }) => validateFinalFixture(candidate, fixtures.find((fixture) => fixture.fixtureId === fixtureId).sourceUnits).map((error) => ({ fixtureId, ...error })));
if (validationErrors.length) throw new Error(`Final fixture validation failed:\n${JSON.stringify(validationErrors, null, 2)}`);
const trainingRows = finalFixtures.flatMap(({ fixtureId, candidate }) => compileRows(fixtures.find((fixture) => fixture.fixtureId === fixtureId), candidate));
const evaluationRows = finalFixtures.flatMap(({ fixtureId, candidate }) => compileEvaluationRows(fixtureId, candidate));
const rowIds = [...trainingRows, ...evaluationRows].map((row) => row.rowId);
if (new Set(rowIds).size !== rowIds.length) throw new Error("Duplicate row IDs detected");
const evidenceLeak = trainingRows.some(containsExcludedEvidenceKey);
if (evidenceLeak) throw new Error("Excluded evidence-target fields leaked into training rows");

fs.mkdirSync(path.dirname(args.output), { recursive: true });
fs.mkdirSync(args.output, { recursive: false });
const fixtureDir = path.join(args.output, "fixtures");
const rowDir = path.join(args.output, "rows");
const taskDir = path.join(rowDir, "by-task");
const foldDir = path.join(args.output, "folds");
fs.mkdirSync(fixtureDir);
fs.mkdirSync(rowDir);
fs.mkdirSync(taskDir);
fs.mkdirSync(foldDir);
for (const { fixtureId, candidate } of finalFixtures) writeJson(path.join(fixtureDir, `${fixtureId}.annotation.final.v1.json`), candidate);
writeJsonl(path.join(rowDir, "training-all.jsonl"), trainingRows);
writeJsonl(path.join(rowDir, "evaluation-key-all.jsonl"), evaluationRows);
for (const task of [...new Set(trainingRows.map((row) => row.task))].sort()) writeJsonl(path.join(taskDir, `${task}.jsonl`), trainingRows.filter((row) => row.task === task));
const folds = [];
for (const heldOutFixtureId of fixtureIds) {
  const output = path.join(foldDir, heldOutFixtureId);
  fs.mkdirSync(output);
  const train = trainingRows.filter((row) => row.fixtureId !== heldOutFixtureId);
  const evaluate = trainingRows.filter((row) => row.fixtureId === heldOutFixtureId);
  const keyEvaluate = evaluationRows.filter((row) => row.fixtureId === heldOutFixtureId);
  writeJsonl(path.join(output, "train.jsonl"), train);
  writeJsonl(path.join(output, "evaluate.jsonl"), evaluate);
  writeJsonl(path.join(output, "evaluation-key.jsonl"), keyEvaluate);
  folds.push({ heldOutFixtureId, trainingFixtureIds: fixtureIds.filter((id) => id !== heldOutFixtureId), trainRowCount: train.length, evaluationRowCount: evaluate.length, evaluationKeyRowCount: keyEvaluate.length });
}
writeJson(path.join(foldDir, "leave-one-fixture-out.json"), { schemaVersion: "cf1.leaveOneFixtureOutSplits.v1", generatedAt, folds, ...PROVENANCE });

const finalFileRecords = finalFixtures.map(({ fixtureId }) => {
  const filePath = path.join(fixtureDir, `${fixtureId}.annotation.final.v1.json`);
  return { fixtureId, path: path.relative(args.output, filePath), sha256: readRaw(filePath).sha256 };
});
const datasetArtifactPaths = [
  path.join(rowDir, "training-all.jsonl"),
  path.join(rowDir, "evaluation-key-all.jsonl"),
  ...fs.readdirSync(taskDir).sort().map((name) => path.join(taskDir, name)),
  path.join(foldDir, "leave-one-fixture-out.json"),
  ...fixtureIds.flatMap((fixtureId) => ["train.jsonl", "evaluate.jsonl", "evaluation-key.jsonl"].map((name) => path.join(foldDir, fixtureId, name))),
];
const datasetArtifacts = datasetArtifactPaths.map((filePath) => ({ path: path.relative(args.output, filePath), sha256: readRaw(filePath).sha256 }));
const manifest = {
  schemaVersion: "cf1.finalDatasetManifest.v1",
  generatedAt,
  ...PROVENANCE,
  sourceAuthority: { path: path.relative(projectDir, args.decisions), sha256: authorityFile.sha256, resolvedDecisionCount: 448 },
  sourceCandidates: authorityValidation,
  evidenceTargetTasksExcluded: true,
  excludedTaskFamilies: ["evidence_target", "warrant"],
  fixtureFiles: finalFileRecords,
  datasetArtifacts,
  trainingRows: summarizeRows(trainingRows),
  evaluationRows: summarizeRows(evaluationRows),
  leaveOneFixtureOutFolds: folds,
};
writeJson(path.join(args.output, "manifest.json"), manifest);
const validationReport = { schemaVersion: "cf1.finalDatasetValidationReport.v1", generatedAt, valid: true, errorCount: 0, errors: [], checks: { authorityHashes: "passed", decisionCoverage448: "passed", schemaAndEnums: "passed", argumentReferences: "passed", relationReferences: "passed", consistencyReferences: "passed", rubricReferences: "passed", duplicateIds: "passed", lineage: "passed", evidenceTargetsExcluded: "passed", trainingRowIds: "passed", articleHeldOutSplits: "passed" }, ...PROVENANCE };
writeJson(path.join(args.output, "validation-report.json"), validationReport);
const report = { schemaVersion: "cf1.finalDatasetCompilationReport.v1", generatedAt, result: "complete", fixtureCount: 9, argumentCount: finalFixtures.reduce((sum, fixture) => sum + fixture.candidate.argumentUnits.length, 0), relationCount: finalFixtures.reduce((sum, fixture) => sum + fixture.candidate.relations.length, 0), consistencyFindingCount: finalFixtures.reduce((sum, fixture) => sum + fixture.candidate.consistencyFindings.length, 0), focusedDecisionCount: 448, remainingReviewCount: 0, trainingRows: manifest.trainingRows, evaluationRows: manifest.evaluationRows, ...PROVENANCE };
writeJson(path.join(args.output, "compilation-report.json"), report);
fs.writeFileSync(path.join(args.output, "COMPILATION_REPORT.md"), `# CF1 Final Dataset Compilation Report\n\nGenerated: ${generatedAt}\n\n- Result: complete\n- Fixtures: 9\n- Assertions: ${report.argumentCount}\n- Relations: ${report.relationCount}\n- Consistency findings: ${report.consistencyFindingCount}\n- Focused decisions applied: 448\n- Remaining review: 0\n- Training rows: ${manifest.trainingRows.total}\n- Evaluation-key rows: ${manifest.evaluationRows.total}\n- Evidence-target and warrant tasks: excluded\n- Adjudication source: assistant_adjudicated\n- User accepted as training gold: yes\n- Independently verified human gold: no\n- Human review required: no\n`);
console.log(JSON.stringify({ output: args.output, fixtures: 9, arguments: report.argumentCount, relations: report.relationCount, consistencyFindings: report.consistencyFindingCount, trainingRows: manifest.trainingRows, evaluationRows: manifest.evaluationRows, remainingReview: 0 }, null, 2));
