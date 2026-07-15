import {
  CF1_ARTICLE_ROLES, CF1_ARTICLE_STANCES, CF1_ARTICLE_USES, CF1_ASSERTION_FORMS,
  CF1_CLUSTER_RELATIONSHIPS, CF1_CONSISTENCY_RESOLUTIONS, CF1_CONSISTENCY_TYPES,
  CF1_EVIDENCE_ROLES, CF1_LIMITS, CF1_MAPPING_STATUSES, CF1_MATERIALITY,
  CF1_PILLAR_IMPORTANCE, CF1_PIPELINE_VERSION, CF1_RECONCILIATION_RELATIONSHIPS, CF1_SCHEMA_VERSION,
  CF1_SCORE_TRANSFORMS, CF1_SELECTION_RELEVANCE, CF1_SEMANTIC_FUNCTIONS,
  CF1_STRUCTURAL_TYPES, CF1_TARGET_TYPES,
} from "./contract.js";
import { canonicalizeCf1, hashArticleInput, hashPackage } from "./canonicalJson.js";
import { isPackageId, isRunId } from "./ids.js";
import { verifyProvenance } from "./verifyProvenance.js";
import { verifyTargetsAndCards } from "./verifyTargetCards.js";
import { verifyFieldShapes } from "./verifyFieldShapes.js";
import { validateArticleInput } from "./validateArticleInput.js";
import { verifySourceIdentity } from "./verifySourceIdentity.js";

export const CF1_VERIFIER_VERSION = "cf1-verifier-2";

function makeIssue(code, path, message, relatedIds = []) {
  return { code, path, message, relatedIds: relatedIds.filter(Boolean).slice(0, 20) };
}

function validateEnum(errors, value, allowed, path) {
  if (!allowed.includes(value)) errors.push(makeIssue("CF1_INVALID_ENUM", path, `Unsupported value: ${value}`));
}

function requireText(errors, value, path, maximum) {
  if (typeof value !== "string" || !value.trim() || value.length > maximum) {
    errors.push(makeIssue("CF1_INVALID_TEXT", path, `Required text must contain 1-${maximum} characters`));
  }
}

function requireArray(errors, value, path, maximum) {
  if (!Array.isArray(value) || value.length > maximum) {
    errors.push(makeIssue("CF1_INVALID_ARRAY", path, `Required array may contain at most ${maximum} items`));
    return [];
  }
  return value;
}

function idSet(errors, items, field, pattern, path) {
  const ids = new Set();
  for (const [index, item] of items.entries()) {
    const id = item?.[field];
    if (!pattern.test(id ?? "")) errors.push(makeIssue("CF1_INVALID_LOCAL_ID", `${path}/${index}/${field}`, "Invalid package-local ID", [id]));
    if (ids.has(id)) errors.push(makeIssue("CF1_DUPLICATE_ID", `${path}/${index}/${field}`, "Duplicate package-local ID", [id]));
    ids.add(id);
  }
  return ids;
}

function checkRefs(errors, values, allowed, path, maximum = 30) {
  for (const [index, value] of requireArray(errors, values, path, maximum).entries()) {
    if (!allowed.has(value)) errors.push(makeIssue("CF1_UNRESOLVED_REFERENCE", `${path}/${index}`, "Referenced ID does not exist", [value]));
  }
}

function checkMappedProposition(errors, item, path, blockIds, rawIds) {
  requireText(errors, item?.text, `${path}/text`, 2_000);
  checkRefs(errors, item?.sourceBlockIds, blockIds, `${path}/sourceBlockIds`);
  checkRefs(errors, item?.rawAssertionIds, rawIds, `${path}/rawAssertionIds`);
}

function verifyShapeAndReferences(pkg) {
  const errors = [];
  if (pkg?.schemaVersion !== CF1_SCHEMA_VERSION) errors.push(makeIssue("CF1_SCHEMA_VERSION", "/schemaVersion", "Unsupported CF1 schema version"));
  if (pkg?.pipelineVersion !== CF1_PIPELINE_VERSION) errors.push(makeIssue("CF1_PIPELINE_VERSION", "/pipelineVersion", "Unsupported CF1 pipeline version"));
  if (!isPackageId(pkg?.packageId)) errors.push(makeIssue("CF1_INVALID_PACKAGE_ID", "/packageId", "Invalid package ID"));
  if (!isRunId(pkg?.runId)) errors.push(makeIssue("CF1_INVALID_RUN_ID", "/runId", "Invalid run ID"));
  if (!Number.isInteger(pkg?.packageVersion) || pkg.packageVersion < 1) errors.push(makeIssue("CF1_INVALID_PACKAGE_VERSION", "/packageVersion", "Package version must be positive"));
  if (pkg?.supersedesPackageId !== null && !isPackageId(pkg?.supersedesPackageId)) errors.push(makeIssue("CF1_INVALID_SUPERSESSION_ID", "/supersedesPackageId", "Invalid superseded package ID"));
  try {
    validateArticleInput(pkg?.article);
  } catch (error) {
    errors.push(makeIssue(error.code ?? "CF1_INVALID_ARTICLE", error.path ?? "/article", error.message));
  }
  if (typeof pkg?.article?.title === "string" && typeof pkg?.article?.text === "string"
    && pkg.article.contentHash !== hashArticleInput(pkg.article)) errors.push(makeIssue("CF1_CONTENT_HASH_MISMATCH", "/article/contentHash", "Article hash mismatch"));
  if (pkg?.sourceDocument?.contentHash !== pkg?.article?.contentHash) errors.push(makeIssue(
    "CF1_SOURCE_DOCUMENT_HASH_MISMATCH", "/sourceDocument/contentHash",
    "Source document and article hashes must match"));

  const atoms = requireArray(errors, pkg?.sourceAtoms, "/sourceAtoms", 5_000);
  const units = requireArray(errors, pkg?.sourceUnits, "/sourceUnits", 20_000);
  requireArray(errors, pkg?.sourceLinks, "/sourceLinks", 5_000);
  const blocks = requireArray(errors, pkg?.semanticBlocks, "/semanticBlocks", 10_000);
  const raw = requireArray(errors, pkg?.rawAssertions, "/rawAssertions", 999);
  const selected = requireArray(errors, pkg?.selectedEvaluationClaims, "/selectedEvaluationClaims", 99);
  const targets = requireArray(errors, pkg?.phase3Targets, "/phase3Targets", 999);
  const cards = requireArray(errors, pkg?.evidenceNeedCards, "/evidenceNeedCards", 999);
  const findings = requireArray(errors, pkg?.internalConsistencyFindings, "/internalConsistencyFindings", 99);
  const atomIds = idSet(errors, atoms, "atomId", /^A\d{4}$/, "/sourceAtoms");
  const unitIds = idSet(errors, units, "unitId", /^U\d{4}$/, "/sourceUnits");
  const blockIds = idSet(errors, blocks, "blockId", /^B\d{3}$/, "/semanticBlocks");
  const rawIds = idSet(errors, raw, "rawAssertionId", /^R\d{3}$/, "/rawAssertions");
  const selectedIds = idSet(errors, selected, "selectedClaimId", /^S\d{2}$/, "/selectedEvaluationClaims");
  const targetIds = idSet(errors, targets, "targetId", /^T\d{3}$/, "/phase3Targets");
  idSet(errors, findings, "findingId", /^IC\d{2}$/, "/internalConsistencyFindings");
  idSet(errors, cards, "cardId", /^ENC-T\d{3}$/, "/evidenceNeedCards");

  units.forEach((item, index) => checkRefs(errors, [item.atomId], atomIds,
    `/sourceUnits/${index}/atomId`));
  blocks.forEach((item, index) => {
    const path = `/semanticBlocks/${index}`;
    validateEnum(errors, item.structuralType, CF1_STRUCTURAL_TYPES, `${path}/structuralType`);
    validateEnum(errors, item.semanticFunction, CF1_SEMANTIC_FUNCTIONS, `${path}/semanticFunction`);
    validateEnum(errors, item.articleStance, CF1_ARTICLE_STANCES, `${path}/articleStance`);
    checkRefs(errors, item.atomIds, atomIds, `${path}/atomIds`, 5_000);
    checkRefs(errors, item.sourceUnitIds, unitIds, `${path}/sourceUnitIds`, 20_000);
    checkRefs(errors, item.relatedBlockIds, blockIds, `${path}/relatedBlockIds`);
  });
  raw.forEach((item, index) => {
    const path = `/rawAssertions/${index}`;
    requireText(errors, item.text, `${path}/text`, 2_000);
    validateEnum(errors, item.assertionForm, CF1_ASSERTION_FORMS, `${path}/assertionForm`);
    validateEnum(errors, item.articleUse, CF1_ARTICLE_USES, `${path}/articleUse`);
    checkRefs(errors, item.sourceAtomIds, atomIds, `${path}/sourceAtomIds`, 40);
    checkRefs(errors, item.sourceUnitIds, unitIds, `${path}/sourceUnitIds`, 40);
    checkRefs(errors, item.sourceBlockIds, blockIds, `${path}/sourceBlockIds`);
    validateEnum(errors, item.reconciliation?.relationship, CF1_RECONCILIATION_RELATIONSHIPS, `${path}/reconciliation/relationship`);
    checkRefs(errors, [item.reconciliation?.canonicalRawAssertionId], rawIds, `${path}/reconciliation/canonicalRawAssertionId`);
    checkRefs(errors, item.reconciliation?.relatedRawAssertionIds, rawIds, `${path}/reconciliation/relatedRawAssertionIds`);
  });

  const map = pkg?.articleMap ?? {};
  requireText(errors, map.theme, "/articleMap/theme", 1_000);
  checkMappedProposition(errors, map.thesis, "/articleMap/thesis", blockIds, rawIds);
  const pillars = requireArray(errors, map.pillars, "/articleMap/pillars", 12);
  const pillarIds = idSet(errors, pillars, "pillarId", /^P(?:0[1-9]|1[0-2])$/, "/articleMap/pillars");
  pillars.forEach((item, index) => {
    checkMappedProposition(errors, item, `/articleMap/pillars/${index}`, blockIds, rawIds);
    validateEnum(errors, item.importance, CF1_PILLAR_IMPORTANCE, `/articleMap/pillars/${index}/importance`);
  });
  const clusters = requireArray(errors, map.clusters, "/articleMap/clusters", 30);
  idSet(errors, clusters, "clusterId", /^C\d{2}$/, "/articleMap/clusters");
  clusters.forEach((item, index) => {
    validateEnum(errors, item.relationship, CF1_CLUSTER_RELATIONSHIPS, `/articleMap/clusters/${index}/relationship`);
    checkRefs(errors, item.rawAssertionIds, rawIds, `/articleMap/clusters/${index}/rawAssertionIds`);
  });
  for (const field of ["opponentPositions", "qualifications"]) {
    requireArray(errors, map[field], `/articleMap/${field}`, 12).forEach((item, index) => checkMappedProposition(errors, item, `/articleMap/${field}/${index}`, blockIds, rawIds));
  }

  findings.forEach((item, index) => {
    const path = `/internalConsistencyFindings/${index}`;
    validateEnum(errors, item.type, CF1_CONSISTENCY_TYPES, `${path}/type`);
    validateEnum(errors, item.materiality, CF1_MATERIALITY, `${path}/materiality`);
    validateEnum(errors, item.resolution, CF1_CONSISTENCY_RESOLUTIONS, `${path}/resolution`);
    validateEnum(errors, item.selectionRelevance, CF1_SELECTION_RELEVANCE, `${path}/selectionRelevance`);
    checkRefs(errors, item.blockIds, blockIds, `${path}/blockIds`);
    checkRefs(errors, item.rawAssertionIds, rawIds, `${path}/rawAssertionIds`);
  });
  selected.forEach((item, index) => {
    const path = `/selectedEvaluationClaims/${index}`;
    requireText(errors, item.claimText, `${path}/claimText`, 2_000);
    validateEnum(errors, item.articleRole, CF1_ARTICLE_ROLES, `${path}/articleRole`);
    validateEnum(errors, item.materiality, CF1_MATERIALITY, `${path}/materiality`);
    validateEnum(errors, item.scoreTransform, CF1_SCORE_TRANSFORMS, `${path}/scoreTransform`);
    checkRefs(errors, item.sourceRawAssertionIds, rawIds, `${path}/sourceRawAssertionIds`);
    checkRefs(errors, item.sourceAtomIds, atomIds, `${path}/sourceAtomIds`, 800);
    checkRefs(errors, item.sourceUnitIds, unitIds, `${path}/sourceUnitIds`, 800);
    checkRefs(errors, item.sourceBlockIds, blockIds, `${path}/sourceBlockIds`);
    checkRefs(errors, item.sourceAtomIds, atomIds, `${path}/sourceAtomIds`, 800);
    checkRefs(errors, item.sourceUnitIds, unitIds, `${path}/sourceUnitIds`, 800);
    checkRefs(errors, item.relatedPillarIds, pillarIds, `${path}/relatedPillarIds`);
  });
  targets.forEach((item, index) => {
    const path = `/phase3Targets/${index}`;
    requireText(errors, item.targetText, `${path}/targetText`, 2_000);
    validateEnum(errors, item.targetType, CF1_TARGET_TYPES, `${path}/targetType`);
    validateEnum(errors, item.scoreTransform, CF1_SCORE_TRANSFORMS, `${path}/scoreTransform`);
    validateEnum(errors, item.mappingStatus, CF1_MAPPING_STATUSES, `${path}/mappingStatus`);
    checkRefs(errors, [item.selectedClaimId], selectedIds, `${path}/selectedClaimId`);
    checkRefs(errors, item.sourceBlockIds, blockIds, `${path}/sourceBlockIds`);
    checkRefs(errors, item.sourceRawAssertionIds, rawIds, `${path}/sourceRawAssertionIds`);
  });
  cards.forEach((item, index) => {
    checkRefs(errors, [item.targetId], targetIds, `/evidenceNeedCards/${index}/targetId`);
    for (const role of requireArray(errors, item.evidenceRolesNeeded, `/evidenceNeedCards/${index}/evidenceRolesNeeded`, 8)) validateEnum(errors, role, CF1_EVIDENCE_ROLES, `/evidenceNeedCards/${index}/evidenceRolesNeeded`);
  });
  for (const selectedId of selectedIds) {
    if (!targets.some((target) => target.selectedClaimId === selectedId)) errors.push(makeIssue("CF1_SELECTED_CLAIM_WITHOUT_TARGET", "/phase3Targets", "Every selected claim needs a target", [selectedId]));
  }
  if ((selected.length < 8 || selected.length > 12) && !pkg?.diagnostics?.selectionCountException) errors.push(makeIssue("CF1_SELECTION_COUNT_UNJUSTIFIED", "/diagnostics/selectionCountException", "Selection count outside 8-12 requires justification"));
  return errors;
}

export function verifyCf1Package(packageValue, { clock = () => new Date(), repairAttempted = false, requireFinalHash = false } = {}) {
  let blockingErrors = verifyShapeAndReferences(packageValue);
  blockingErrors.push(...verifyFieldShapes(packageValue), ...verifyProvenance(packageValue),
    ...verifyTargetsAndCards(packageValue), ...verifySourceIdentity(packageValue));
  try {
    if (Buffer.byteLength(canonicalizeCf1(packageValue), "utf8") > CF1_LIMITS.packageBytes) blockingErrors.push(makeIssue("CF1_PACKAGE_TOO_LARGE", "", "Package exceeds 10 MiB"));
    if (Buffer.byteLength(canonicalizeCf1(packageValue?.diagnostics ?? {}), "utf8") > CF1_LIMITS.diagnosticsBytes) blockingErrors.push(makeIssue("CF1_DIAGNOSTICS_TOO_LARGE", "/diagnostics", "Diagnostics exceed 1 MiB"));
  } catch (error) {
    blockingErrors.push(makeIssue("CF1_PACKAGE_NOT_JSON", "", error.message));
  }
  if (requireFinalHash) {
    if (packageValue?.status !== "ready_for_evidence" || packageValue?.verification?.valid !== true) blockingErrors.push(makeIssue("CF1_NOT_FINALIZED", "", "Final package must be ready and contain valid verification"));
    if (packageValue?.packageHash !== hashPackage(packageValue)) blockingErrors.push(makeIssue("CF1_PACKAGE_HASH_MISMATCH", "/packageHash", "Package hash mismatch"));
  }
  blockingErrors = blockingErrors.slice(0, 100);
  return { valid: blockingErrors.length === 0, blockingErrors, warnings: [],
    verifiedAt: clock().toISOString(), verifierVersion: CF1_VERIFIER_VERSION, repairAttempted };
}

const TERMINAL_CODES = new Set([
  "CF1_SCHEMA_VERSION", "CF1_PIPELINE_VERSION", "CF1_INVALID_PACKAGE_ID", "CF1_INVALID_RUN_ID",
  "CF1_INVALID_PACKAGE_VERSION", "CF1_INVALID_SUPERSESSION_ID", "CF1_CONTENT_HASH_MISMATCH",
  "CF1_SOURCE_DOCUMENT_HASH_MISMATCH", "CF1_INVALID_SOURCE_ATOM", "CF1_INVALID_SOURCE_UNIT",
  "CF1_INVALID_BLOCK_PROVENANCE", "CF1_BLOCK_ORDER_OVERLAP",
  "CF1_GROUNDING_DERIVATION_MISMATCH", "CF1_GROUNDING_UNITS_REQUIRED",
  "CF1_GROUNDING_UNKNOWN_UNIT", "CF1_GROUNDING_DUPLICATE_UNIT", "CF1_GROUNDING_UNIT_ORDER",
  "CF1_GROUNDING_UNIT_WITHOUT_BLOCK", "CF1_GROUNDING_AMBIGUOUS_UNIT",
  "CF1_PACKAGE_TOO_LARGE", "CF1_PACKAGE_NOT_JSON", "CF1_PACKAGE_HASH_MISMATCH",
]);

export function classifyRepairability(verification) {
  const blocking = verification?.blockingErrors ?? [];
  const terminalIssues = blocking.filter((item) => TERMINAL_CODES.has(item.code));
  return { repairable: blocking.length > 0 && terminalIssues.length === 0,
    repairableIssues: blocking.filter((item) => !TERMINAL_CODES.has(item.code)), terminalIssues };
}
