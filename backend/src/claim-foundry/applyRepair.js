import { Cf1Error } from "./errors.js";
import { validateRepairResponse } from "./repairContract.js";
import { deriveUnitGrounding, inheritAssertionGrounding } from "./grounding.js";
import { synchronizePackageClaimPostures } from "./claimPosture.js";

function decode(segment) {
  return segment.replace(/~1/g, "/").replace(/~0/g, "~");
}

function locate(root, pointer) {
  const parts = pointer.split("/").slice(1).map(decode);
  const key = parts.pop();
  let parent = root;
  for (const part of parts) {
    if (parent == null || !(part in parent)) throw new Cf1Error("CF1_REPAIR_PATH_MISSING", `Repair path does not exist: ${pointer}`, { status: 422, path: pointer });
    parent = parent[part];
  }
  return { parent, key };
}

function applyOperation(root, repair) {
  const { parent, key } = locate(root, repair.path);
  if (Array.isArray(parent) && key === "-") {
    if (repair.operation !== "add") throw new Cf1Error("CF1_INVALID_REPAIR_OPERATION", "Only add may use array append", { status: 422 });
    parent.push(structuredClone(repair.value));
    return;
  }
  if (parent == null || (repair.operation !== "add" && !(key in parent))) {
    throw new Cf1Error("CF1_REPAIR_PATH_MISSING", `Repair path does not exist: ${repair.path}`, { status: 422, path: repair.path });
  }
  if (repair.operation === "remove") {
    if (Array.isArray(parent)) parent.splice(Number(key), 1);
    else delete parent[key];
  } else {
    parent[key] = structuredClone(repair.value);
  }
}

function synchronizeCards(packageDraft) {
  for (const card of packageDraft.evidenceNeedCards ?? []) {
    const target = packageDraft.phase3Targets?.find((item) => item.targetId === card.targetId);
    if (!target) continue;
    card.cardId = `ENC-${target.targetId}`;
    for (const field of ["selectedClaimId", "targetText", "targetType", "scoreTransform",
      "searchEligible", "verdictEligible", "namedWorkIds", "identityBundleIds",
      "articleReferenceIds", "articleLinkIds"]) card[field] = structuredClone(target[field]);
  }
}

function recomputeGrounding(packageDraft) {
  const articleDocument = { canonicalText: packageDraft.article.text,
    atoms: packageDraft.sourceAtoms, sourceUnits: packageDraft.sourceUnits };
  for (const [index, assertion] of (packageDraft.rawAssertions ?? []).entries()) {
    Object.assign(assertion, deriveUnitGrounding({ sourceUnitIds: assertion.sourceUnitIds,
      articleDocument, sourceBlocks: packageDraft.semanticBlocks,
      path: `/rawAssertions/${index}/sourceUnitIds` }));
  }
  for (const collection of ["selectedEvaluationClaims", "phase3Targets"]) {
    for (const [index, item] of (packageDraft[collection] ?? []).entries()) {
      Object.assign(item, inheritAssertionGrounding({
        sourceRawAssertionIds: item.sourceRawAssertionIds,
        rawAssertions: packageDraft.rawAssertions, articleDocument,
        sourceBlocks: packageDraft.semanticBlocks,
        path: `/${collection}/${index}/sourceRawAssertionIds`,
      }));
    }
  }
}

function normalizeAddedCards(packageDraft) {
  for (const card of packageDraft.evidenceNeedCards ?? []) {
    if (!card.targetId) throw new Cf1Error("CF1_REPAIR_CARD_TARGET_REQUIRED", "Added card must reference an existing target", { status: 422 });
  }
}

function touchesClaimPosture(repair) {
  return /^\/(?:rawAssertions|selectedEvaluationClaims|phase3Targets)\/\d+\/(?:articleUse|articleRole|sourceRawAssertionIds|selectedClaimId|targetType|scoreTransform|verdictEligible)(?:\/|$)/
    .test(repair.path);
}

export function applyCf1Repair(packageDraft, repairResponse, allowedPaths) {
  const validated = validateRepairResponse(repairResponse, allowedPaths);
  const repaired = structuredClone(packageDraft);
  try {
    const blockIds = new Set(repaired.semanticBlocks?.map((block) => block.blockId) ?? []);
    for (const repair of validated.repairs) {
      if (repair.sourceBlockIds.some((id) => !blockIds.has(id))) {
        throw new Cf1Error("CF1_REPAIR_GROUNDING_INVALID", "Repair cites an unknown grounding block", { status: 422, path: repair.path });
      }
    }
    for (const repair of validated.repairs) applyOperation(repaired, repair);
    normalizeAddedCards(repaired);
    recomputeGrounding(repaired);
    if (validated.repairs.some(touchesClaimPosture)) synchronizePackageClaimPostures(repaired);
    synchronizeCards(repaired);
    return repaired;
  } catch (cause) {
    if (cause instanceof Cf1Error) throw cause;
    throw new Cf1Error("CF1_REPAIR_REJECTED", "Repair could not be applied atomically", { status: 422, cause });
  }
}
