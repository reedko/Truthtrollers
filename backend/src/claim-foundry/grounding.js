import { Cf1Error } from "./errors.js";

function groundingError(code, message, path, relatedIds = []) {
  throw new Cf1Error(code, message, { status: 422, path,
    details: { relatedIds: relatedIds.slice(0, 20) } });
}

function contextMaps(articleDocument, sourceBlocks) {
  const units = new Map((articleDocument?.sourceUnits ?? []).map((unit) => [unit.unitId, unit]));
  const blocksByUnit = new Map();
  for (const block of sourceBlocks ?? []) {
    for (const unitId of block.sourceUnitIds ?? []) {
      if (blocksByUnit.has(unitId)) groundingError("CF1_GROUNDING_AMBIGUOUS_UNIT",
        "A source unit belongs to multiple source blocks", "/sourceBlocks", [unitId]);
      blocksByUnit.set(unitId, block);
    }
  }
  return { units, blocksByUnit };
}

function validateUnitIds(sourceUnitIds, maps, path) {
  if (!Array.isArray(sourceUnitIds) || !sourceUnitIds.length || sourceUnitIds.length > 40) {
    groundingError("CF1_GROUNDING_UNITS_REQUIRED", "Grounding requires 1-40 source unit IDs", path);
  }
  const seen = new Set();
  let previousOrder = -1;
  return sourceUnitIds.map((unitId, index) => {
    const unit = maps.units.get(unitId);
    if (!unit) groundingError("CF1_GROUNDING_UNKNOWN_UNIT", "Grounding cites an unknown source unit",
      `${path}/${index}`, [unitId]);
    if (seen.has(unitId)) groundingError("CF1_GROUNDING_DUPLICATE_UNIT", "Grounding repeats a source unit",
      `${path}/${index}`, [unitId]);
    if (unit.order <= previousOrder) groundingError("CF1_GROUNDING_UNIT_ORDER",
      "Grounding source units must be in document order", `${path}/${index}`, [unitId]);
    if (!maps.blocksByUnit.has(unitId)) groundingError("CF1_GROUNDING_UNIT_WITHOUT_BLOCK",
      "Grounding source unit has no containing source block", `${path}/${index}`, [unitId]);
    seen.add(unitId);
    previousOrder = unit.order;
    return unit;
  });
}

function spansFor(units, maps, canonicalText) {
  const spans = [];
  for (const [index, unit] of units.entries()) {
    const blockId = maps.blocksByUnit.get(unit.unitId).blockId;
    const previousUnit = units[index - 1];
    const current = spans.at(-1);
    if (current && previousUnit && unit.order === previousUnit.order + 1
      && current.sourceBlockId === blockId) {
      current.sourceUnitIds.push(unit.unitId);
      current.end = unit.sourceOffsets.end;
      current.text = canonicalText.slice(current.start, current.end);
    } else {
      spans.push({ sourceUnitIds: [unit.unitId], sourceBlockId: blockId,
        text: canonicalText.slice(unit.sourceOffsets.start, unit.sourceOffsets.end),
        start: unit.sourceOffsets.start, end: unit.sourceOffsets.end });
    }
  }
  return spans;
}

export function deriveUnitGrounding({ sourceUnitIds, articleDocument, sourceBlocks, path }) {
  const maps = contextMaps(articleDocument, sourceBlocks);
  const units = validateUnitIds(sourceUnitIds, maps, path);
  const spans = spansFor(units, maps, articleDocument.canonicalText);
  return { sourceUnitIds: units.map((unit) => unit.unitId),
    sourceAtomIds: [...new Set(units.map((unit) => unit.atomId))],
    sourceBlockIds: [...new Set(units.map((unit) => maps.blocksByUnit.get(unit.unitId).blockId))],
    sourceSpans: spans,
    sourceExcerpt: spans[0].text,
    sourceOffsets: spans.map(({ start, end }) => ({ start, end })) };
}

export function inheritAssertionGrounding({ sourceRawAssertionIds, rawAssertions,
  articleDocument, sourceBlocks, path }) {
  if (!Array.isArray(sourceRawAssertionIds) || !sourceRawAssertionIds.length
    || sourceRawAssertionIds.length > 20) {
    groundingError("CF1_GROUNDING_ASSERTIONS_REQUIRED",
      "Selected claims and targets require grounded raw assertions", path);
  }
  const rawMap = new Map(rawAssertions.map((assertion) => [assertion.rawAssertionId, assertion]));
  const unitOrders = new Map(articleDocument.sourceUnits.map((unit) => [unit.unitId, unit.order]));
  const unitIds = new Set();
  for (const [index, rawId] of sourceRawAssertionIds.entries()) {
    const assertion = rawMap.get(rawId);
    if (!assertion) groundingError("CF1_GROUNDING_UNKNOWN_ASSERTION",
      "Grounding cites an unknown raw assertion", `${path}/${index}`, [rawId]);
    for (const unitId of assertion.sourceUnitIds) unitIds.add(unitId);
  }
  const ordered = [...unitIds].sort((left, right) => unitOrders.get(left) - unitOrders.get(right));
  return deriveUnitGrounding({ sourceUnitIds: ordered, articleDocument, sourceBlocks,
    path: `${path}/inheritedSourceUnitIds` });
}
