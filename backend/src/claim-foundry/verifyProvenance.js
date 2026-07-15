import { deriveUnitGrounding, inheritAssertionGrounding } from "./grounding.js";

function issue(code, path, message, relatedIds = []) {
  return { code, path, message, relatedIds: relatedIds ?? [] };
}

const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);

function verifySourceRecords(pkg, errors) {
  const text = pkg.article?.text ?? "";
  const atomIds = new Set();
  let previousEnd = 0;
  for (const [index, atom] of (pkg.sourceAtoms ?? []).entries()) {
    const path = `/sourceAtoms/${index}`;
    const { start, end } = atom.sourceOffsets ?? {};
    if (atomIds.has(atom.atomId)) errors.push(issue("CF1_DUPLICATE_ID", `${path}/atomId`,
      "Duplicate source atom ID", [atom.atomId]));
    atomIds.add(atom.atomId);
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < previousEnd
      || end <= start || text.slice(start, end) !== atom.text) {
      errors.push(issue("CF1_INVALID_SOURCE_ATOM", path,
        "Source atom text, order, or offsets do not match the article", [atom.atomId]));
    }
    previousEnd = Number.isInteger(end) ? end : previousEnd;
  }

  const unitIds = new Set();
  let previousOrder = -1;
  for (const [index, unit] of (pkg.sourceUnits ?? []).entries()) {
    const path = `/sourceUnits/${index}`;
    const atom = (pkg.sourceAtoms ?? []).find((item) => item.atomId === unit.atomId);
    const { start, end } = unit.sourceOffsets ?? {};
    if (unitIds.has(unit.unitId)) errors.push(issue("CF1_DUPLICATE_ID", `${path}/unitId`,
      "Duplicate source unit ID", [unit.unitId]));
    unitIds.add(unit.unitId);
    if (!atom || !Number.isInteger(start) || !Number.isInteger(end) || unit.order <= previousOrder
      || start < atom.sourceOffsets.start || end > atom.sourceOffsets.end
      || text.slice(start, end) !== unit.text) {
      errors.push(issue("CF1_INVALID_SOURCE_UNIT", path,
        "Source unit text, order, atom, or offsets do not match the article", [unit.unitId]));
    }
    previousOrder = Number.isInteger(unit.order) ? unit.order : previousOrder;
  }
}

function verifyBlocks(pkg, errors) {
  const text = pkg.article?.text ?? "";
  const atomIds = new Set((pkg.sourceAtoms ?? []).map((item) => item.atomId));
  const unitIds = new Set((pkg.sourceUnits ?? []).map((item) => item.unitId));
  const blockIds = new Set();
  let previousEnd = 0;
  for (const [index, block] of (pkg.semanticBlocks ?? []).entries()) {
    const path = `/semanticBlocks/${index}`;
    const { start, end } = block.sourceOffsets ?? {};
    if (blockIds.has(block.blockId)) errors.push(issue("CF1_DUPLICATE_ID", `${path}/blockId`,
      "Duplicate block ID", [block.blockId]));
    blockIds.add(block.blockId);
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < previousEnd
      || text.slice(start, end) !== block.text) {
      errors.push(issue("CF1_INVALID_BLOCK_PROVENANCE", `${path}/sourceOffsets`,
        "Block text does not match ordered article offsets", [block.blockId]));
    }
    for (const id of block.atomIds ?? []) if (!atomIds.has(id)) errors.push(issue(
      "CF1_UNRESOLVED_REFERENCE", `${path}/atomIds`, "Block references an unknown atom", [id]));
    for (const id of block.sourceUnitIds ?? []) if (!unitIds.has(id)) errors.push(issue(
      "CF1_UNRESOLVED_REFERENCE", `${path}/sourceUnitIds`, "Block references an unknown unit", [id]));
    previousEnd = Number.isInteger(end) ? end : previousEnd;
  }
}

function compareGrounding(item, expected, path, id) {
  const fields = ["sourceUnitIds", "sourceAtomIds", "sourceBlockIds", "sourceSpans",
    "sourceExcerpt", "sourceOffsets"];
  return fields.filter((field) => !same(item[field], expected[field])).map((field) => issue(
    "CF1_GROUNDING_DERIVATION_MISMATCH", `${path}/${field}`,
    `Host-derived ${field} does not match cited source units`, [id]));
}

function verifyGroundedItems(pkg, errors) {
  const articleDocument = { canonicalText: pkg.article?.text ?? "",
    atoms: pkg.sourceAtoms ?? [], sourceUnits: pkg.sourceUnits ?? [] };
  const raw = pkg.rawAssertions ?? [];
  for (const [index, assertion] of raw.entries()) {
    const path = `/rawAssertions/${index}`;
    try {
      const expected = deriveUnitGrounding({ sourceUnitIds: assertion.sourceUnitIds,
        articleDocument, sourceBlocks: pkg.semanticBlocks, path: `${path}/sourceUnitIds` });
      errors.push(...compareGrounding(assertion, expected, path, assertion.rawAssertionId));
    } catch (error) {
      errors.push(issue(error.code ?? "CF1_INVALID_ASSERTION_PROVENANCE", error.path ?? path,
        error.message, error.details?.relatedIds));
    }
  }
  for (const [collection, idField] of [["selectedEvaluationClaims", "selectedClaimId"],
    ["phase3Targets", "targetId"]]) {
    for (const [index, item] of (pkg[collection] ?? []).entries()) {
      const path = `/${collection}/${index}`;
      try {
        const expected = inheritAssertionGrounding({
          sourceRawAssertionIds: item.sourceRawAssertionIds, rawAssertions: raw,
          articleDocument, sourceBlocks: pkg.semanticBlocks,
          path: `${path}/sourceRawAssertionIds`,
        });
        errors.push(...compareGrounding(item, expected, path, item[idField]));
      } catch (error) {
        errors.push(issue(error.code ?? "CF1_INVALID_PROVENANCE", error.path ?? path,
          error.message, error.details?.relatedIds));
      }
    }
  }
}

export function verifyProvenance(packageValue) {
  const errors = [];
  verifySourceRecords(packageValue, errors);
  verifyBlocks(packageValue, errors);
  verifyGroundedItems(packageValue, errors);
  return errors;
}
