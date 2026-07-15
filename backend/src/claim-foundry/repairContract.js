import { CF1_SCHEMA_VERSION } from "./contract.js";
import { Cf1Error } from "./errors.js";
import { classifyRepairability } from "./verifyPackage.js";

export const CF1_MAX_REPAIR_OPERATIONS = 30;
const OPERATIONS = new Set(["add", "replace", "remove"]);
const FORBIDDEN_SEGMENTS = new Set(["__proto__", "prototype", "constructor"]);

const MUTABLE_PATHS = [
  /^\/semanticBlocks\/\d+\/(semanticFunction|articleStance|speakerEntities|relatedBlockIds|confidence)(?:\/.*)?$/,
  /^\/rawAssertions\/\d+\/(text|sourceUnitIds|speakerEntity|assertionForm|articleUse|namedEntities|namedWorks|numbersAndDates|reconciliation)(?:\/.*)?$/,
  /^\/articleMap\/(theme|thesis|pillars\/\d+\/(label|text|sourceBlockIds|rawAssertionIds|importance)|clusters\/\d+\/(label|rawAssertionIds|relationship)|opponentPositions|qualifications|mapWarnings)(?:\/.*)?$/,
  /^\/internalConsistencyFindings\/\d+\/(type|blockIds|rawAssertionIds|description|materiality|resolution|resolutionRationale|selectionRelevance)(?:\/.*)?$/,
  /^\/selectedEvaluationClaims\/\d+\/(claimText|sourceRawAssertionIds|articleRole|relatedPillarIds|materiality|counterfactualImpact|selectionRationale|scoreTransform|searchEligible|verdictEligible|confidence)(?:\/.*)?$/,
  /^\/phase3Targets\/\d+\/(selectedClaimId|targetText|targetType|scoreTransform|searchEligible|verdictEligible|sourceRawAssertionIds|mappingStatus|mappingRationale)(?:\/.*)?$/,
  /^\/evidenceNeedCards\/(?:\d+|-)\/(evidenceRolesNeeded|bearingCriteria|queryLaneSeeds|identifierHints)(?:\/.*)?$/,
  /^\/evidenceNeedCards\/-$/,
  /^\/diagnostics\/selectionCountException$/,
];

export function isAllowedRepairPath(path) {
  return typeof path === "string" && path.startsWith("/")
    && !path.split("/").some((segment) => FORBIDDEN_SEGMENTS.has(segment))
    && MUTABLE_PATHS.some((pattern) => pattern.test(path));
}

function pathsForIssue(issue) {
  if (issue.code === "CF1_INVALID_TARGET_POSTURE") {
    const base = issue.path.match(/^\/phase3Targets\/\d+/)?.[0];
    return base ? [`${base}/scoreTransform`, `${base}/verdictEligible`] : [];
  }
  if (issue.code === "CF1_UNRESOLVED_TARGET_VERDICT") return [issue.path];
  if (isAllowedRepairPath(issue.path)) return [issue.path];
  return [];
}

function groundingIdsForPath(packageDraft, path) {
  const ids = new Set();
  const add = (values) => (values ?? []).forEach((id) => ids.add(id));
  const match = path.match(/^\/(semanticBlocks|rawAssertions|internalConsistencyFindings|selectedEvaluationClaims|phase3Targets|evidenceNeedCards)\/(\d+)/);
  if (match) {
    const item = packageDraft[match[1]]?.[Number(match[2])];
    if (match[1] === "semanticBlocks" && item?.blockId) ids.add(item.blockId);
    add(item?.sourceBlockIds ?? item?.blockIds);
    if (match[1] === "evidenceNeedCards") {
      const target = packageDraft.phase3Targets?.find((candidate) => candidate.targetId === item?.targetId);
      add(target?.sourceBlockIds);
    }
  }
  const mapMatch = path.match(/^\/articleMap\/(thesis|pillars|opponentPositions|qualifications)(?:\/(\d+))?/);
  if (mapMatch) {
    const value = mapMatch[2] === undefined
      ? packageDraft.articleMap?.[mapMatch[1]]
      : packageDraft.articleMap?.[mapMatch[1]]?.[Number(mapMatch[2])];
    add(value?.sourceBlockIds);
  }
  return ids;
}

function valueAt(root, pointer) {
  if (pointer.endsWith("/-")) return null;
  return pointer.split("/").slice(1).reduce((value, segment) => value?.[segment.replace(/~1/g, "/").replace(/~0/g, "~")], root);
}

export function buildRepairRequest(packageDraft, verification) {
  if (verification?.repairAttempted) throw new Cf1Error("CF1_REPAIR_LIMIT_REACHED", "A repair was already attempted", { status: 422 });
  const blockingErrors = verification?.blockingErrors ?? [];
  if (!classifyRepairability(verification).repairable) {
    throw new Cf1Error("CF1_REPAIR_NOT_ELIGIBLE", "Verification contains terminal or no repairable errors", { status: 422 });
  }
  const allowedPaths = [...new Set(blockingErrors.flatMap((issue) => {
    if (issue.code !== "CF1_TARGET_CARD_CARDINALITY") return pathsForIssue(issue);
    const targetId = issue.relatedIds?.find((id) => /^T\d{3}$/.test(id));
    const count = packageDraft.evidenceNeedCards?.filter((card) => card.targetId === targetId).length ?? 0;
    return count === 0 ? ["/evidenceNeedCards/-"] : [];
  }))];
  if (!blockingErrors.length || !allowedPaths.length) {
    throw new Cf1Error("CF1_REPAIR_NOT_ELIGIBLE", "Verification has no safely repairable paths", { status: 422 });
  }
  const affectedPackageFragments = Object.fromEntries(allowedPaths.map((path) => [path, valueAt(packageDraft, path)]));
  const blockIds = new Set(blockingErrors.flatMap((item) => item.relatedIds ?? []).filter((id) => /^B\d{3}$/.test(id)));
  for (const path of allowedPaths) {
    for (const id of groundingIdsForPath(packageDraft, path)) blockIds.add(id);
    if (path === "/evidenceNeedCards/-") {
      const targetIds = blockingErrors.flatMap((item) => item.relatedIds ?? []).filter((id) => /^T\d{3}$/.test(id));
      for (const targetId of targetIds) {
        const target = packageDraft.phase3Targets?.find((item) => item.targetId === targetId);
        for (const id of target?.sourceBlockIds ?? []) blockIds.add(id);
      }
    }
    if (path === "/diagnostics/selectionCountException") {
      for (const block of packageDraft.semanticBlocks ?? []) blockIds.add(block.blockId);
    }
  }
  const groundingBlocks = (packageDraft.semanticBlocks ?? [])
    .filter((block) => blockIds.has(block.blockId))
    .map(({ blockId, text, sourceOffsets }) => ({ blockId, text, sourceOffsets }));
  return { schemaVersion: CF1_SCHEMA_VERSION, repairAttempt: 1, blockingErrors,
    affectedPackageFragments, groundingBlocks, allowedPaths };
}

export function validateRepairResponse(response, allowedPaths) {
  if (!response || typeof response !== "object" || !Array.isArray(response.repairs)
    || !Array.isArray(response.cannotRepair) || response.repairs.length > CF1_MAX_REPAIR_OPERATIONS
    || response.cannotRepair.length > 100) {
    throw new Cf1Error("CF1_INVALID_REPAIR_RESPONSE", "Malformed repair response", { status: 422 });
  }
  const allowed = new Set(allowedPaths);
  for (const [index, repair] of response.repairs.entries()) {
    if (!OPERATIONS.has(repair.operation) || !allowed.has(repair.path) || !isAllowedRepairPath(repair.path)) {
      throw new Cf1Error("CF1_REPAIR_FORBIDDEN_PATH", `Repair ${index} is not allowlisted`, { status: 422, path: repair.path });
    }
    const proceduralCountJustification = repair.path === "/diagnostics/selectionCountException";
    if (typeof repair.rationale !== "string" || !repair.rationale.trim() || repair.rationale.length > 1_000
      || !Array.isArray(repair.sourceBlockIds)
      || (!proceduralCountJustification && repair.sourceBlockIds.length < 1)
      || repair.sourceBlockIds.length > 12 || repair.sourceBlockIds.some((id) => typeof id !== "string")) {
      throw new Cf1Error("CF1_INVALID_REPAIR_RESPONSE", `Repair ${index} lacks rationale or grounding`, { status: 422 });
    }
    if (!("value" in repair) || (repair.operation === "remove" && repair.value !== null)) {
      throw new Cf1Error("CF1_INVALID_REPAIR_RESPONSE", `Repair ${index} requires a value`, { status: 422 });
    }
  }
  for (const item of response.cannotRepair) {
    if (!item || typeof item.code !== "string" || typeof item.reason !== "string"
      || !item.code || !item.reason || item.code.length > 100 || item.reason.length > 1_000) {
      throw new Cf1Error("CF1_INVALID_REPAIR_RESPONSE", "Malformed cannotRepair entry", { status: 422 });
    }
  }
  return structuredClone(response);
}
