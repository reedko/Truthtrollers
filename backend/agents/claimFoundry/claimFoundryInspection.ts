import type { ArticleDocument } from "./claimFoundryContext.js";
import {
  deriveContentRegions,
  type ContentRegionInspection,
} from "./claimFoundryCoverage.js";
import {
  hashWholeArticleWorkingPackage,
  inspectionSchema,
  type WholeArticleInspection,
  type WholeArticleWorkingPackage,
} from "./claimFoundryWorkingPackage.js";

function orderedUnique(values: string[]) {
  return [...new Set(values)];
}

function duplicateIds(values: string[]) {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates].sort();
}

function diagnosticId(code: string, item: string) {
  const safe = `${code}-${item}`.replace(/[^A-Za-z0-9._:-]/g, "-").slice(0, 95);
  return `D${safe}`;
}

export function inspectWholeArticleWorkingPackage(input: {
  pkg: WholeArticleWorkingPackage;
  document: ArticleDocument;
  regions?: ContentRegionInspection[];
  inspectionId: string;
  createdAt?: string;
}): WholeArticleInspection {
  const { pkg, document } = input;
  const regions = input.regions ?? deriveContentRegions(document);
  const diagnostics: WholeArticleInspection["deterministicDiagnostics"] = [];
  const unitIds = new Set(document.sourceUnits.map(unit => unit.unitId));
  const unitOrder = new Map(document.sourceUnits.map((unit, index) => [
    unit.unitId,
    index,
  ]));
  const thesisIds = new Set(pkg.theses.map(thesis => thesis.thesisId));

  for (const id of duplicateIds(pkg.theses.map(thesis => thesis.thesisId))) {
    diagnostics.push({
      diagnosticId: diagnosticId("DUPLICATE_ID", id),
      code: "DUPLICATE_ID",
      itemIds: [id],
      sourceUnitIds: [],
      explanation: `Duplicate thesis ID ${id}`,
      blocking: true,
    });
  }
  for (const id of duplicateIds(pkg.claims.map(claim => claim.claimId))) {
    diagnostics.push({
      diagnosticId: diagnosticId("DUPLICATE_ID", id),
      code: "DUPLICATE_ID",
      itemIds: [id],
      sourceUnitIds: [],
      explanation: `Duplicate claim ID ${id}`,
      blocking: true,
    });
  }

  for (const unit of document.sourceUnits) {
    const { start, end } = unit.sourceOffsets;
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 ||
      end <= start || end > document.canonicalText.length ||
      document.canonicalText.slice(start, end) !== unit.text) {
      diagnostics.push({
        diagnosticId: diagnosticId("SOURCE_INTEGRITY", unit.unitId),
        code: "SOURCE_INTEGRITY",
        itemIds: [],
        sourceUnitIds: [unit.unitId],
        explanation: `Authorized source span is invalid for ${unit.unitId}`,
        blocking: true,
      });
    }
  }

  for (const thesis of pkg.theses) {
    const foreign = thesis.groundingUnitIds.filter(id => !unitIds.has(id));
    if (foreign.length) diagnostics.push({
      diagnosticId: diagnosticId("INVALID_GROUNDING", thesis.thesisId),
      code: "INVALID_GROUNDING",
      itemIds: [thesis.thesisId],
      sourceUnitIds: foreign,
      explanation: `Thesis ${thesis.thesisId} contains foreign grounding`,
      blocking: true,
    });
  }

  const claimIdsWithoutThesis: string[] = [];
  for (const claim of pkg.claims) {
    const grounding = orderedUnique([
      ...claim.attributionUnitIds,
      ...claim.substantiveGroundingUnitIds,
      ...claim.attributionLayers.flatMap(layer => layer.unitIds),
    ]);
    const foreign = grounding.filter(id => !unitIds.has(id));
    if (foreign.length) diagnostics.push({
      diagnosticId: diagnosticId("INVALID_GROUNDING", claim.claimId),
      code: "INVALID_GROUNDING",
      itemIds: [claim.claimId],
      sourceUnitIds: foreign,
      explanation: `Claim ${claim.claimId} contains foreign grounding`,
      blocking: true,
    });
    const invalidTheses = claim.thesisIds.filter(id => !thesisIds.has(id));
    if (invalidTheses.length) diagnostics.push({
      diagnosticId: diagnosticId("INVALID_REFERENCE", claim.claimId),
      code: "INVALID_REFERENCE",
      itemIds: [claim.claimId, ...invalidTheses],
      sourceUnitIds: [],
      explanation: `Claim ${claim.claimId} references unknown thesis IDs`,
      blocking: true,
    });
    if (claim.thesisIds.length === 0) claimIdsWithoutThesis.push(claim.claimId);
  }

  const coveredRegionIds = regions.filter(region => {
    const start = unitOrder.get(region.startUnitId);
    const end = unitOrder.get(region.endUnitId);
    if (start === undefined || end === undefined) return false;
    return pkg.claims.some(claim => claim.substantiveGroundingUnitIds.some(id => {
      const order = unitOrder.get(id);
      return order !== undefined && order >= start && order <= end;
    }));
  }).map(region => region.regionId);
  const regionIds = new Set(regions.map(region => region.regionId));
  const dispositionedRegionIds = orderedUnique(
    pkg.regionDispositions
      .map(item => item.regionId)
      .filter(id => regionIds.has(id)),
  );
  const unaccountedRegionIds = regions
    .map(region => region.regionId)
    .filter(id => !coveredRegionIds.includes(id) &&
      !dispositionedRegionIds.includes(id));

  const linkedThesisIds = pkg.theses
    .map(thesis => thesis.thesisId)
    .filter(id => pkg.claims.some(claim => claim.thesisIds.includes(id)));
  const dispositionedThesisIds = orderedUnique(
    pkg.thesisDispositions
      .map(item => item.thesisId)
      .filter(id => thesisIds.has(id)),
  );
  const unaccountedThesisIds = pkg.theses
    .map(thesis => thesis.thesisId)
    .filter(id => !linkedThesisIds.includes(id) &&
      !dispositionedThesisIds.includes(id));

  for (const regionId of unaccountedRegionIds) diagnostics.push({
    diagnosticId: diagnosticId("UNACCOUNTED_REGION", regionId),
    code: "UNACCOUNTED_REGION",
    itemIds: [regionId],
    sourceUnitIds: [],
    explanation: `Structural region ${regionId} has no claim grounding or disposition`,
    blocking: true,
  });
  for (const thesisId of unaccountedThesisIds) diagnostics.push({
    diagnosticId: diagnosticId("UNACCOUNTED_THESIS", thesisId),
    code: "UNACCOUNTED_THESIS",
    itemIds: [thesisId],
    sourceUnitIds: [],
    explanation: `Declared thesis ${thesisId} has no linked claim or disposition`,
    blocking: true,
  });
  for (const claimId of claimIdsWithoutThesis) diagnostics.push({
    diagnosticId: diagnosticId("CLAIM_WITHOUT_THESIS", claimId),
    code: "CLAIM_WITHOUT_THESIS",
    itemIds: [claimId],
    sourceUnitIds: [],
    explanation: `Claim ${claimId} has no declared thesis link`,
    blocking: true,
  });

  const actualHash = hashWholeArticleWorkingPackage(pkg);
  if (actualHash !== pkg.packageHash) diagnostics.push({
    diagnosticId: diagnosticId("SOURCE_INTEGRITY", "PACKAGE_HASH"),
    code: "SOURCE_INTEGRITY",
    itemIds: [],
    sourceUnitIds: [],
    explanation: "Working-package hash does not match its canonical content",
    blocking: true,
  });

  return inspectionSchema.parse({
    inspectionId: input.inspectionId,
    packageRevision: pkg.packageRevision,
    packageHash: pkg.packageHash,
    deterministicClean: diagnostics.length === 0,
    deterministicDiagnostics: diagnostics,
    nonBlockingHeuristics: [],
    coveredRegionIds,
    dispositionedRegionIds,
    unaccountedRegionIds,
    linkedThesisIds,
    dispositionedThesisIds,
    unaccountedThesisIds,
    claimIdsWithoutThesis,
    createdAt: input.createdAt ?? new Date().toISOString(),
  });
}
