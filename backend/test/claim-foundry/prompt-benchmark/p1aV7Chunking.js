const utf8Length = (value) => Buffer.byteLength(String(value ?? ""), "utf8");

function blockWeight(block, unitsById) {
  return utf8Length(block.heading) + (block.sourceUnitIds ?? [])
    .reduce((sum, id) => sum + utf8Length(unitsById.get(id)?.text), 0);
}

function optimalRanges(weights, count) {
  if (!Number.isInteger(count) || count < 1 || count > weights.length) {
    throw new TypeError("chunkCount must fit the available structural blocks");
  }
  const prefix = [0];
  for (const weight of weights) prefix.push(prefix.at(-1) + weight);
  const target = prefix.at(-1) / count;
  const costs = Array.from({ length: count + 1 }, () =>
    Array(weights.length + 1).fill(Number.POSITIVE_INFINITY));
  const previous = Array.from({ length: count + 1 }, () =>
    Array(weights.length + 1).fill(-1));
  costs[0][0] = 0;
  for (let groups = 1; groups <= count; groups += 1) {
    for (let end = groups; end <= weights.length; end += 1) {
      for (let start = groups - 1; start < end; start += 1) {
        const size = prefix[end] - prefix[start];
        const cost = costs[groups - 1][start] + ((size - target) ** 2);
        if (cost < costs[groups][end]) {
          costs[groups][end] = cost;
          previous[groups][end] = start;
        }
      }
    }
  }
  const ranges = [];
  let end = weights.length;
  for (let groups = count; groups > 0; groups -= 1) {
    const start = previous[groups][end];
    ranges.unshift({ start, end });
    end = start;
  }
  return ranges;
}

function adjacentUnitIds(sourceUnits, firstOrder, lastOrder, contextUnits) {
  const before = sourceUnits.slice(Math.max(0, firstOrder - contextUnits), firstOrder)
    .map((unit) => unit.unitId);
  const after = sourceUnits.slice(lastOrder + 1, lastOrder + 1 + contextUnits)
    .map((unit) => unit.unitId);
  return { before, after };
}

export function buildP1aV7Chunks({ structuralBlocks = [], sourceUnits = [],
  chunkCount = 4, contextUnits = 2 } = {}) {
  if (!structuralBlocks.length || !sourceUnits.length) {
    throw new TypeError("V7 chunking requires structural blocks and source units");
  }
  if (!Number.isInteger(contextUnits) || contextUnits < 0) {
    throw new TypeError("contextUnits must be a nonnegative integer");
  }
  const unitsById = new Map(sourceUnits.map((unit) => [unit.unitId, unit]));
  const unitOrder = new Map(sourceUnits.map((unit, index) => [unit.unitId, index]));
  const weights = structuralBlocks.map((block) => blockWeight(block, unitsById));
  const ranges = optimalRanges(weights, chunkCount);
  const chunks = ranges.map(({ start, end }, index) => {
    const blocks = structuralBlocks.slice(start, end);
    const ownedUnitIds = blocks.flatMap((block) => block.sourceUnitIds ?? []);
    const firstOrder = unitOrder.get(ownedUnitIds[0]);
    const lastOrder = unitOrder.get(ownedUnitIds.at(-1));
    if (!Number.isInteger(firstOrder) || !Number.isInteger(lastOrder)) {
      throw new TypeError("Structural blocks contain unknown source-unit IDs");
    }
    const context = adjacentUnitIds(sourceUnits, firstOrder, lastOrder, contextUnits);
    const byteCount = blocks.reduce((sum, block) => sum + blockWeight(block, unitsById), 0);
    return {
      chunkId: `P1aV7-C${String(index + 1).padStart(2, "0")}`,
      order: index,
      blocks,
      ownedBlockIds: blocks.map((block) => block.blockId),
      ownedUnitIds,
      contextBeforeUnitIds: context.before,
      contextAfterUnitIds: context.after,
      firstUnitId: ownedUnitIds[0],
      lastUnitId: ownedUnitIds.at(-1),
      byteCount,
      estimatedArticleTokens: Math.ceil(byteCount / 3),
    };
  });
  verifyP1aV7ChunkCoverage({ chunks, structuralBlocks, sourceUnits });
  return chunks;
}

export function verifyP1aV7ChunkCoverage({ chunks = [], structuralBlocks = [],
  sourceUnits = [] } = {}) {
  const expectedBlocks = structuralBlocks.map((block) => block.blockId);
  const expectedUnits = sourceUnits.map((unit) => unit.unitId);
  const ownedBlocks = chunks.flatMap((chunk) => chunk.ownedBlockIds);
  const ownedUnits = chunks.flatMap((chunk) => chunk.ownedUnitIds);
  const issues = [];
  if (JSON.stringify(ownedBlocks) !== JSON.stringify(expectedBlocks)) {
    issues.push("owned structural-block coverage is not exact and ordered");
  }
  if (JSON.stringify(ownedUnits) !== JSON.stringify(expectedUnits)) {
    issues.push("owned source-unit coverage is not exact and ordered");
  }
  if (new Set(ownedBlocks).size !== ownedBlocks.length) issues.push("owned block duplication");
  if (new Set(ownedUnits).size !== ownedUnits.length) issues.push("owned unit duplication");
  if (issues.length) throw new Error(`Invalid P1aV7 chunk plan: ${issues.join("; ")}`);
  return { valid: true, blockCount: ownedBlocks.length, unitCount: ownedUnits.length };
}

export function buildP1aV7OrientationPacket({ article, chunks = [], structuralBlocks = [],
  sourceUnits = [], sampleUnitsPerEdge = 2 } = {}) {
  const unitsById = new Map(sourceUnits.map((unit) => [unit.unitId, unit]));
  const selectedIds = [];
  const add = (ids) => {
    for (const id of ids ?? []) if (unitsById.has(id) && !selectedIds.includes(id)) selectedIds.push(id);
  };
  add(sourceUnits.slice(0, sampleUnitsPerEdge).map((unit) => unit.unitId));
  for (const block of structuralBlocks.filter((item) => String(item.heading ?? "").trim())) {
    add((block.sourceUnitIds ?? []).slice(0, sampleUnitsPerEdge));
  }
  for (const chunk of chunks) {
    add(chunk.ownedUnitIds.slice(0, sampleUnitsPerEdge));
    add(chunk.ownedUnitIds.slice(-sampleUnitsPerEdge));
  }
  add(sourceUnits.slice(-sampleUnitsPerEdge).map((unit) => unit.unitId));
  selectedIds.sort((a, b) => sourceUnits.findIndex((unit) => unit.unitId === a)
    - sourceUnits.findIndex((unit) => unit.unitId === b));
  return {
    title: article?.title ?? "",
    authors: article?.authors ?? [],
    outline: structuralBlocks.filter((block) => String(block.heading ?? "").trim())
      .map((block) => ({ blockId: block.blockId, heading: block.heading,
        firstUnitId: block.sourceUnitIds?.[0] ?? null })),
    excerpts: selectedIds.map((unitId) => ({ unitId, text: unitsById.get(unitId).text })),
    representedChunkIds: chunks.map((chunk) => chunk.chunkId),
  };
}
