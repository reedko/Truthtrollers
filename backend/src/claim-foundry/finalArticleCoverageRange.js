function preparedBlocks(structuralBlocks = []) {
  return structuralBlocks
    .filter((block) => Array.isArray(block?.sourceUnitIds) && block.sourceUnitIds.length);
}

function orderedUnitIds(blocks, sourceOrder) {
  return [...new Set(blocks.flatMap((block) => block.sourceUnitIds))]
    .filter((id) => sourceOrder.has(id))
    .sort((a, b) => sourceOrder.get(a) - sourceOrder.get(b));
}

// Content-neutral bounds for the complete structured article. This tells a
// model what it must scan without pretending that every block merits a claim.
export function deriveStructuralArticleRange({ structuralBlocks = [], sourceUnits = [] } = {}) {
  const sourceOrder = new Map(sourceUnits.map((unit, index) => [unit.unitId, index]));
  const blocks = preparedBlocks(structuralBlocks);
  if (!blocks.length) return null;
  const sourceUnitIds = orderedUnitIds(blocks, sourceOrder);
  if (!sourceUnitIds.length) return null;
  return {
    firstBlockId: blocks[0].blockId ?? null,
    lastBlockId: blocks.at(-1).blockId ?? null,
    blockCount: blocks.length,
    firstUnitId: sourceUnitIds[0],
    lastUnitId: sourceUnitIds.at(-1),
  };
}

// Report-only tail sentinel. It detects a later-article miss after the call;
// it is intentionally not presented to the model as a separate retrieval task.
export function deriveFinalArticleCoverageRange({ structuralBlocks = [], sourceUnits = [] } = {}) {
  const sourceOrder = new Map(sourceUnits.map((unit, index) => [unit.unitId, index]));
  const tailBlocks = preparedBlocks(structuralBlocks).slice(-2);
  if (!tailBlocks.length) return null;

  const sourceUnitIds = orderedUnitIds(tailBlocks, sourceOrder);
  if (!sourceUnitIds.length) return null;

  return {
    blockIds: tailBlocks.map((block) => block.blockId).filter(Boolean),
    sourceUnitIds,
    firstUnitId: sourceUnitIds[0],
    lastUnitId: sourceUnitIds.at(-1),
  };
}
