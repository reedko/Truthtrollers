import { Cf1Error } from "./errors.js";
import { assignLocalIds } from "./ids.js";
import { normalizeIdentifierHints } from "./identifierHints.js";
import { CF1_ARTICLE_STANCES, CF1_SEMANTIC_FUNCTIONS } from "./contract.js";
import { deriveUnitGrounding, inheritAssertionGrounding } from "./grounding.js";
import { attachSourceIdentityBundles } from "./sourceIdentityBundles.js";

const ARTICLE_STANCES = new Set(CF1_ARTICLE_STANCES);
const SEMANTIC_FUNCTIONS = new Set(CF1_SEMANTIC_FUNCTIONS);

function clone(value) {
  return structuredClone(value);
}

function mapIds(items, oldField, prefix, digits, newField = oldField) {
  const assigned = assignLocalIds(items ?? [], { prefix, digits, field: newField });
  const idMap = new Map();
  assigned.forEach((item, index) => {
    const oldId = items[index]?.[oldField];
    if (oldId && idMap.has(oldId)) {
      throw new Cf1Error("CF1_DUPLICATE_AGENT_ID", `Duplicate agent ID ${oldId}`, { status: 422 });
    }
    if (oldId) idMap.set(oldId, item[newField]);
    idMap.set(item[newField], item[newField]);
  });
  return { assigned, idMap };
}

function rewrite(value, idMap, path) {
  if (value == null) return value;
  const mapped = idMap.get(value);
  // Preserve unknown references for deterministic verification and one-pass repair.
  // Never guess which canonical ID the model intended.
  return mapped ?? value;
}

function rewriteArray(values, idMap, path) {
  return (values ?? []).map((value, index) => rewrite(value, idMap, `${path}/${index}`));
}

export function normalizeAgentDraft(draft, { article, articleDocument, structuralBlocks }) {
  if (!draft || typeof draft !== "object" || Array.isArray(draft)) {
    throw new Cf1Error("CF1_INVALID_AGENT_DRAFT", "Agent draft must be an object", { status: 422 });
  }
  const blocks = clone(structuralBlocks ?? []);
  const blockMap = new Map(blocks.map((block) => [block.blockId, block.blockId]));
  for (const annotation of draft.semanticBlockAnnotations ?? []) {
    const blockId = rewrite(annotation.blockId, blockMap, "/semanticBlockAnnotations/blockId");
    const index = blocks.findIndex((block) => block.blockId === blockId);
    const structural = blocks[index];
    blocks[index] = { ...structural, ...clone(annotation), blockId, text: structural.text,
      order: structural.order, heading: structural.heading, structuralType: structural.structuralType,
      sourceOffsets: structural.sourceOffsets, atomIds: structural.atomIds,
      sourceUnitIds: structural.sourceUnitIds, linkIds: structural.linkIds,
      boundaryReasons: structural.boundaryReasons,
      relatedBlockIds: rewriteArray(annotation.relatedBlockIds, blockMap, `/semanticBlockAnnotations/${index}/relatedBlockIds`) };
    if (!SEMANTIC_FUNCTIONS.has(blocks[index].semanticFunction)) blocks[index].semanticFunction = "unclear";
    if (!ARTICLE_STANCES.has(blocks[index].articleStance)) blocks[index].articleStance = "unclear";
  }
  let defaultedBlockAnnotations = 0;
  for (const block of blocks) {
    if (block.semanticFunction) continue;
    block.semanticFunction = "unclear";
    block.articleStance = "unclear";
    block.speakerEntities = [];
    block.relatedBlockIds = [];
    block.confidence = 0;
    defaultedBlockAnnotations += 1;
  }

  const raw = mapIds(clone(draft.rawAssertions), "rawAssertionId", "R", 3);
  const pillars = mapIds(clone(draft.articleMap?.pillars), "pillarId", "P", 2);
  const clusters = mapIds(clone(draft.articleMap?.clusters), "clusterId", "C", 2);
  const findings = mapIds(clone(draft.internalConsistencyFindings), "findingId", "IC", 2);
  const selected = mapIds(clone(draft.selectedEvaluationClaims), "selectedClaimId", "S", 2);
  const targets = mapIds(clone(draft.phase3Targets), "targetId", "T", 3);

  for (const [index, assertion] of raw.assigned.entries()) {
    Object.assign(assertion, deriveUnitGrounding({ sourceUnitIds: assertion.sourceUnitIds,
      articleDocument, sourceBlocks: blocks, path: `/rawAssertions/${index}/sourceUnitIds` }));
    const reconciliation = assertion.reconciliation ?? {};
    assertion.reconciliation = {
      ...reconciliation,
      canonicalRawAssertionId: rewrite(reconciliation.canonicalRawAssertionId, raw.idMap, `/rawAssertions/${index}/reconciliation/canonicalRawAssertionId`),
      relatedRawAssertionIds: rewriteArray(reconciliation.relatedRawAssertionIds, raw.idMap, `/rawAssertions/${index}/reconciliation/relatedRawAssertionIds`),
    };
  }

  const mapProposition = (item, path) => ({ ...item,
    sourceBlockIds: rewriteArray(item?.sourceBlockIds, blockMap, `${path}/sourceBlockIds`),
    rawAssertionIds: rewriteArray(item?.rawAssertionIds, raw.idMap, `${path}/rawAssertionIds`) });
  const articleMap = clone(draft.articleMap ?? {});
  articleMap.thesis = mapProposition(articleMap.thesis ?? {}, "/articleMap/thesis");
  articleMap.pillars = pillars.assigned.map((item, index) => mapProposition(item, `/articleMap/pillars/${index}`));
  articleMap.clusters = clusters.assigned.map((item, index) => ({ ...item,
    rawAssertionIds: rewriteArray(item.rawAssertionIds, raw.idMap, `/articleMap/clusters/${index}/rawAssertionIds`) }));
  articleMap.opponentPositions = (articleMap.opponentPositions ?? []).map((item, index) => mapProposition(item, `/articleMap/opponentPositions/${index}`));
  articleMap.qualifications = (articleMap.qualifications ?? []).map((item, index) => mapProposition(item, `/articleMap/qualifications/${index}`));

  findings.assigned.forEach((item, index) => {
    item.blockIds = rewriteArray(item.blockIds, blockMap, `/internalConsistencyFindings/${index}/blockIds`);
    item.rawAssertionIds = rewriteArray(item.rawAssertionIds, raw.idMap, `/internalConsistencyFindings/${index}/rawAssertionIds`);
  });
  selected.assigned.forEach((item, index) => {
    item.sourceRawAssertionIds = rewriteArray(item.sourceRawAssertionIds, raw.idMap, `/selectedEvaluationClaims/${index}/sourceRawAssertionIds`);
    Object.assign(item, inheritAssertionGrounding({ sourceRawAssertionIds: item.sourceRawAssertionIds,
      rawAssertions: raw.assigned, articleDocument, sourceBlocks: blocks,
      path: `/selectedEvaluationClaims/${index}/sourceRawAssertionIds` }));
    item.relatedPillarIds = rewriteArray(item.relatedPillarIds, pillars.idMap, `/selectedEvaluationClaims/${index}/relatedPillarIds`);
  });
  targets.assigned.forEach((item, index) => {
    item.selectedClaimId = rewrite(item.selectedClaimId, selected.idMap, `/phase3Targets/${index}/selectedClaimId`);
    item.sourceRawAssertionIds = rewriteArray(item.sourceRawAssertionIds, raw.idMap, `/phase3Targets/${index}/sourceRawAssertionIds`);
    Object.assign(item, inheritAssertionGrounding({ sourceRawAssertionIds: item.sourceRawAssertionIds,
      rawAssertions: raw.assigned, articleDocument, sourceBlocks: blocks,
      path: `/phase3Targets/${index}/sourceRawAssertionIds` }));
  });

  const cards = (draft.evidenceNeedCards ?? []).map((card, index) => {
    const targetId = rewrite(card.targetId, targets.idMap, `/evidenceNeedCards/${index}/targetId`);
    const target = targets.assigned.find((item) => item.targetId === targetId);
    return { ...clone(card), cardId: `ENC-${targetId}`, targetId,
      selectedClaimId: target.selectedClaimId, targetText: target.targetText,
      targetType: target.targetType, scoreTransform: target.scoreTransform,
      searchEligible: target.searchEligible, verdictEligible: target.verdictEligible,
      identifierHints: normalizeIdentifierHints(card.identifierHints) };
  });
  const sourceIdentityBundles = attachSourceIdentityBundles({ article, articleDocument, articleMap,
    selectedClaims: selected.assigned, targets: targets.assigned, cards });

  return { semanticBlocks: blocks, rawAssertions: raw.assigned, articleMap,
    internalConsistencyFindings: findings.assigned, selectedEvaluationClaims: selected.assigned,
    phase3Targets: targets.assigned, evidenceNeedCards: cards, sourceIdentityBundles,
    selectionCountException: draft.selectionCountException
      ?? (selected.assigned.length < 8 || selected.assigned.length > 12
        ? `The agent selected ${selected.assigned.length} material claims and did not pad the package.` : null),
    agentWarnings: [...(draft.agentWarnings ?? []), ...(defaultedBlockAnnotations
      ? [`Host defaulted ${defaultedBlockAnnotations} omitted semantic block annotations.`] : [])] };
}
