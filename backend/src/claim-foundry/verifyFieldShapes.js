function issue(code, path, message, relatedIds = []) {
  return { code, path, message, relatedIds };
}

function text(errors, value, path, maximum, optional = false) {
  if (optional && (value === undefined || value === null)) return;
  if (typeof value !== "string" || (!optional && !value.trim()) || value.length > maximum) {
    errors.push(issue("CF1_INVALID_TEXT", path, `Expected ${optional ? "optional " : ""}text up to ${maximum} characters`));
  }
}

function array(errors, value, path, maximum) {
  if (!Array.isArray(value) || value.length > maximum) {
    errors.push(issue("CF1_INVALID_ARRAY", path, `Expected an array with at most ${maximum} items`));
    return [];
  }
  return value;
}

function stringArray(errors, value, path, maximumItems, maximumChars) {
  array(errors, value, path, maximumItems).forEach((item, index) => text(errors, item, `${path}/${index}`, maximumChars));
}

function boolean(errors, value, path) {
  if (typeof value !== "boolean") errors.push(issue("CF1_INVALID_BOOLEAN", path, "Expected a boolean"));
}

function confidence(errors, value, path) {
  if (typeof value !== "number" || value < 0 || value > 1) errors.push(issue("CF1_INVALID_CONFIDENCE", path, "Confidence must be between 0 and 1"));
}

export function verifyFieldShapes(pkg) {
  const errors = [];
  for (const [index, item] of (pkg.semanticBlocks ?? []).entries()) {
    const path = `/semanticBlocks/${index}`;
    if (!Number.isInteger(item.order) || item.order < 0 || item.order > 10_000) errors.push(issue("CF1_INVALID_ORDER", `${path}/order`, "Block order must be a nonnegative integer"));
    text(errors, item.heading, `${path}/heading`, 500, true);
    text(errors, item.text, `${path}/text`, 30_000);
    stringArray(errors, item.speakerEntities, `${path}/speakerEntities`, 20, 300);
    confidence(errors, item.confidence, `${path}/confidence`);
  }
  for (const [index, item] of (pkg.rawAssertions ?? []).entries()) {
    const path = `/rawAssertions/${index}`;
    text(errors, item.sourceExcerpt, `${path}/sourceExcerpt`, 3_000);
    text(errors, item.speakerEntity, `${path}/speakerEntity`, 300, true);
    stringArray(errors, item.namedEntities, `${path}/namedEntities`, 30, 300);
    stringArray(errors, item.namedWorks, `${path}/namedWorks`, 20, 500);
    stringArray(errors, item.numbersAndDates, `${path}/numbersAndDates`, 20, 100);
    text(errors, item.reconciliation?.rationale, `${path}/reconciliation/rationale`, 1_000);
  }
  const map = pkg.articleMap ?? {};
  stringArray(errors, map.mapWarnings, "/articleMap/mapWarnings", 20, 500);
  for (const [index, item] of (map.pillars ?? []).entries()) text(errors, item.label, `/articleMap/pillars/${index}/label`, 200);
  for (const [index, item] of (map.clusters ?? []).entries()) text(errors, item.label, `/articleMap/clusters/${index}/label`, 200);

  for (const [index, item] of (pkg.internalConsistencyFindings ?? []).entries()) {
    const path = `/internalConsistencyFindings/${index}`;
    text(errors, item.description, `${path}/description`, 2_000);
    text(errors, item.resolutionRationale, `${path}/resolutionRationale`, 1_000);
  }
  for (const [index, item] of (pkg.selectedEvaluationClaims ?? []).entries()) {
    const path = `/selectedEvaluationClaims/${index}`;
    text(errors, item.sourceExcerpt, `${path}/sourceExcerpt`, 3_000);
    text(errors, item.counterfactualImpact, `${path}/counterfactualImpact`, 1_000);
    text(errors, item.selectionRationale, `${path}/selectionRationale`, 1_000);
    boolean(errors, item.searchEligible, `${path}/searchEligible`);
    boolean(errors, item.verdictEligible, `${path}/verdictEligible`);
    confidence(errors, item.confidence, `${path}/confidence`);
  }
  for (const [index, item] of (pkg.phase3Targets ?? []).entries()) {
    const path = `/phase3Targets/${index}`;
    text(errors, item.sourceExcerpt, `${path}/sourceExcerpt`, 3_000);
    text(errors, item.mappingRationale, `${path}/mappingRationale`, 1_000);
    boolean(errors, item.searchEligible, `${path}/searchEligible`);
    boolean(errors, item.verdictEligible, `${path}/verdictEligible`);
  }
  for (const [index, item] of (pkg.evidenceNeedCards ?? []).entries()) {
    const path = `/evidenceNeedCards/${index}`;
    boolean(errors, item.searchEligible, `${path}/searchEligible`);
    boolean(errors, item.verdictEligible, `${path}/verdictEligible`);
    const criteria = item.bearingCriteria ?? {};
    stringArray(errors, criteria.mustMatch, `${path}/bearingCriteria/mustMatch`, 12, 500);
    stringArray(errors, criteria.shouldMatch, `${path}/bearingCriteria/shouldMatch`, 12, 500);
    stringArray(errors, criteria.rejectIfOnly, `${path}/bearingCriteria/rejectIfOnly`, 12, 500);
    boolean(errors, criteria.weak, `${path}/bearingCriteria/weak`);
    for (const [seedIndex, seed] of array(errors, item.queryLaneSeeds, `${path}/queryLaneSeeds`, 12).entries()) {
      text(errors, seed.laneType, `${path}/queryLaneSeeds/${seedIndex}/laneType`, 100);
      text(errors, seed.query, `${path}/queryLaneSeeds/${seedIndex}/query`, 1_000);
      text(errors, seed.purpose, `${path}/queryLaneSeeds/${seedIndex}/purpose`, 500);
      stringArray(errors, seed.sourceFieldsUsed, `${path}/queryLaneSeeds/${seedIndex}/sourceFieldsUsed`, 12, 100);
    }
    for (const field of ["doi", "pmid", "titleExact", "authorYear", "quotedDocumentNames", "canonicalSourceIds"]) {
      stringArray(errors, item.identifierHints?.[field], `${path}/identifierHints/${field}`, 12, 500);
    }
  }
  return errors;
}
